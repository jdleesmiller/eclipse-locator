import http from "node:http";
import { fromArrayBuffer } from "geotiff";
import { PNG } from "pngjs";

const PORT = Number(process.env.PORT || 8080);
const AEMET_WMS_URL = "https://ama.aemet.es/geoserver/wms";
const AEMET_WCS_URL = "https://ama.aemet.es/geoserver/wcs";
const OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const FIELD_LAYERS = {
  total: "ama_netcdf:ama_pen_cob_nub",
  low: "ama_netcdf:ama_pen_cob_nub_bajas",
  high: "ama_netcdf:ama_pen_cob_nub_altas",
  base: "ama_netcdf:ama_pen_base_nub",
};
const FIELD_COVERAGES = {
  total: "ama_netcdf__ama_pen_cob_nub",
  low: "ama_netcdf__ama_pen_cob_nub_bajas",
  high: "ama_netcdf__ama_pen_cob_nub_altas",
};
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || "https://jdlm.info,http://localhost:8080,http://127.0.0.1:8080").split(",").map((value) => value.trim()).filter(Boolean));
const cache = new Map();
const inFlight = new Map();
const terrainTileCache = new Map();
const terrainTileInFlight = new Map();
const CACHE_MS = 15 * 60 * 1000;
const STALE_CACHE_MS = 2 * 60 * 60 * 1000;
const CLIMATOLOGY_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const FORECAST_PAST_MS = 8 * 60 * 60 * 1000;
const FORECAST_FUTURE_MS = 78 * 60 * 60 * 1000;
const MAX_TERRAIN_TILES_PER_REQUEST = 250;
const AEMET_BOUNDS = { south: 33.5, north: 46.5, west: -14, east: 6 };

function createLimiter(limit) {
  let active = 0;
  const waiting = [];
  return async function run(callback) {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    active += 1;
    try { return await callback(); }
    finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

const withAemetSlot = createLimiter(4);
const withTerrainSlot = createLimiter(6);

function forecastTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("time must be an ISO-8601 forecast valid time");
  if (date.getUTCMinutes() || date.getUTCSeconds() || date.getUTCMilliseconds()) throw new Error("forecast times must use whole UTC hours");
  const delta = date.getTime() - Date.now();
  if (delta < -FORECAST_PAST_MS || delta > FORECAST_FUTURE_MS) throw new Error("forecast times must be within the supported forecast window");
  return date.toISOString();
}

async function cachedRequest(key, producer, freshMs = CACHE_MS, staleMs = STALE_CACHE_MS) {
  const cached = cache.get(key);
  const age = cached ? Date.now() - cached.createdAt : Infinity;
  if (cached && age < freshMs) return { ...cached.value, cached: true, stale: false };
  if (inFlight.has(key)) return inFlight.get(key);
  const pending = (async () => {
    try {
      const value = await producer();
      cache.set(key, { createdAt: Date.now(), value });
      if (cache.size > 300) cache.delete(cache.keys().next().value);
      return value;
    } catch (error) {
      if (cached && age < staleMs) {
        return { ...cached.value, cached: true, stale: true, warning: `Upstream refresh failed; serving ${Math.round(age / 60000)}-minute-old cached data` };
      }
      throw error;
    }
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.has("*") ? "*" : ALLOWED_ORIGINS.has(origin) ? origin : "";
  return allowed ? { "Access-Control-Allow-Origin": allowed, Vary: "Origin" } : {};
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  response.end(JSON.stringify(body));
}

function parseRequest(url) {
  const fields = url.searchParams.get("fields")?.split(",").filter(Boolean) || [];
  if (!fields.length || fields.length > 4 || fields.some((field) => !FIELD_LAYERS[field])) throw new Error("fields must use total, low, high or base");
  const time = url.searchParams.get("time") || "";
  const normalizedTime = forecastTime(time);
  const points = (url.searchParams.get("points") || "").split(";").filter(Boolean).map((pair) => {
    const [lat, lng] = pair.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < AEMET_BOUNDS.south || lat > AEMET_BOUNDS.north || lng < AEMET_BOUNDS.west || lng > AEMET_BOUNDS.east) throw new Error("points must be inside the AEMET Iberian forecast region");
    return { lat, lng };
  });
  if (!points.length || points.length > 30) throw new Error("provide between 1 and 30 points");
  return { fields, time: normalizedTime, points };
}

async function readBody(request, maxBytes = 160000) {
  if (!(request.headers["content-type"] || "").toLowerCase().startsWith("application/json")) throw new Error("request Content-Type must be application/json");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("request body is too large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("request body must be valid JSON"); }
}

function parseRasterRequest(body) {
  const fields = Array.isArray(body?.fields) ? body.fields : [];
  if (!fields.length || fields.length > 3 || fields.some((field) => !FIELD_COVERAGES[field])) throw new Error("fields must use total, low or high");
  const times = Array.isArray(body?.times) ? body.times.map(forecastTime) : [];
  if (!times.length || times.length > 2) throw new Error("times must contain one or two ISO-8601 forecast valid times");
  const points = Array.isArray(body?.points) ? body.points.map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) })) : [];
  if (!points.length || points.length > 1800) throw new Error("provide between 1 and 1800 points");
  if (points.some(({ lat, lng }) => !Number.isFinite(lat) || !Number.isFinite(lng) || lat < AEMET_BOUNDS.south || lat > AEMET_BOUNDS.north || lng < AEMET_BOUNDS.west || lng > AEMET_BOUNDS.east)) throw new Error("points must be inside the AEMET Iberian forecast region");
  const latitudes = points.map((point) => point.lat);
  const longitudes = points.map((point) => point.lng);
  if (Math.max(...latitudes) - Math.min(...latitudes) > 4 || Math.max(...longitudes) - Math.min(...longitudes) > 4) throw new Error("weather comparison locations must be within a four-degree region");
  return { fields: [...new Set(fields)], times: [...new Set(times)], points };
}

function parseTerrainRequest(body) {
  const points = Array.isArray(body?.points) ? body.points.map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) })) : [];
  if (!points.length || points.length > 2500) throw new Error("provide between 1 and 2500 terrain points");
  if (points.some(({ lat, lng }) => !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -85 || lat > 85 || lng < -180 || lng > 180)) throw new Error("terrain points must use valid Web Mercator coordinates");
  return { points };
}

function parseClimatologyRequest(body) {
  const points = Array.isArray(body?.points) ? body.points.map((point) => ({ id: String(point.id || ""), lat: Number(point.lat), lng: Number(point.lng) })) : [];
  if (!points.length || points.length > 9) throw new Error("provide between 1 and 9 climatology points");
  if (points.some(({ lat, lng }) => !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180)) throw new Error("climatology points must use valid global coordinates");
  const target = new Date(body?.targetTime);
  if (Number.isNaN(target.getTime())) throw new Error("climatology targetTime must be an ISO-8601 time");
  const startYear = Number(body?.startYear);
  const endYear = Number(body?.endYear);
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear < 1940 || endYear > new Date().getUTCFullYear() || endYear < startYear || endYear - startYear + 1 > 30) throw new Error("climatology years must specify at most 30 years from 1940 through the present");
  const dateWindowDays = Number(body?.dateWindowDays);
  if (!Number.isInteger(dateWindowDays) || dateWindowDays < 0 || dateWindowDays > 31) throw new Error("climatology dateWindowDays must be between 0 and 31");
  return { points, targetTime: target.toISOString(), startYear, endYear, dateWindowDays };
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const weight = position - lower;
  return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] * (1 - weight) + sorted[lower + 1] * weight;
}

function isoDate(date) { return date.toISOString().slice(0, 10); }

async function openMeteoClimatologyYear(request, year) {
  const target = new Date(request.targetTime);
  const centre = new Date(Date.UTC(year, target.getUTCMonth(), target.getUTCDate()));
  const start = new Date(centre.getTime() - request.dateWindowDays * 86400000);
  const end = new Date(centre.getTime() + request.dateWindowDays * 86400000);
  const params = new URLSearchParams({
    latitude: request.points.map((point) => point.lat.toFixed(5)).join(","),
    longitude: request.points.map((point) => point.lng.toFixed(5)).join(","),
    start_date: isoDate(start), end_date: isoDate(end), timezone: "GMT", models: "era5",
    hourly: "direct_normal_irradiance_instant,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high",
  });
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(`${OPEN_METEO_ARCHIVE_URL}?${params}`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Open-Meteo archive returned ${response.status}`);
      const data = await response.json();
      const locations = Array.isArray(data) ? data : [data];
      if (locations.length !== request.points.length) throw new Error("Open-Meteo archive returned an unexpected number of locations");
      return locations;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

function sampledClimatology(locationYears, yearList, request, pointIndex, startYear = request.startYear, endYear = request.endYear) {
  const target = new Date(request.targetTime);
  const hour = target.getUTCHours();
  const fraction = (target.getUTCMinutes() * 60 + target.getUTCSeconds()) / 3600;
  const samples = [];
  for (let yearIndex = 0; yearIndex < locationYears.length; yearIndex += 1) {
    const year = yearList[yearIndex];
    if (year < startYear || year > endYear) continue;
    const location = locationYears[yearIndex][pointIndex];
    const hourly = location?.hourly;
    if (!Array.isArray(hourly?.time)) continue;
    const indices = new Map(hourly.time.map((time, index) => [time, index]));
    const centre = new Date(Date.UTC(year, target.getUTCMonth(), target.getUTCDate()));
    for (let offset = -request.dateWindowDays; offset <= request.dateWindowDays; offset += 1) {
      const day = new Date(centre.getTime() + offset * 86400000);
      const beforeTime = `${isoDate(day)}T${String(hour).padStart(2, "0")}:00`;
      const afterDate = new Date(day.getTime() + (hour === 23 ? 86400000 : 0));
      const afterTime = `${isoDate(afterDate)}T${String((hour + 1) % 24).padStart(2, "0")}:00`;
      const before = indices.get(beforeTime);
      const after = indices.get(afterTime);
      if (before === undefined || after === undefined) continue;
      const interpolate = (field) => {
        const a = Number(hourly[field]?.[before]);
        const b = Number(hourly[field]?.[after]);
        return Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * fraction : null;
      };
      const sample = {
        dni: interpolate("direct_normal_irradiance_instant"), total: interpolate("cloud_cover"),
        low: interpolate("cloud_cover_low"), mid: interpolate("cloud_cover_mid"), high: interpolate("cloud_cover_high"),
      };
      if (Object.values(sample).every(Number.isFinite)) samples.push(sample);
    }
  }
  if (!samples.length) throw new Error("Open-Meteo archive returned no usable eclipse-time samples");
  const field = (name) => samples.map((sample) => sample[name]);
  const roundedPercentile = (name, fractionValue) => Math.round(percentile(field(name), fractionValue));
  const brightSunCount = samples.filter((sample) => sample.dni >= 120).length;
  const brightSunPct = Math.round(brightSunCount / samples.length * 100);
  return {
    source: "ERA5 via Open-Meteo Historical Weather API", targetTime: request.targetTime,
    gridCell: { lat: request.points[pointIndex].lat, lng: request.points[pointIndex].lng, resolutionDeg: 0.25 },
    period: { startYear, endYear }, dateWindowDays: request.dateWindowDays,
    sampleCount: samples.length, brightSunThresholdWm2: 120, brightSunPct, noBrightSunPct: 100 - brightSunPct,
    medianCloudCoverPct: roundedPercentile("total", 0.5), cloudCoverP25Pct: roundedPercentile("total", 0.25), cloudCoverP75Pct: roundedPercentile("total", 0.75),
    medianLowCloudPct: roundedPercentile("low", 0.5), medianMidCloudPct: roundedPercentile("mid", 0.5), medianHighCloudPct: roundedPercentile("high", 0.5),
  };
}

async function climatologyValues(request) {
  const gridded = { ...request, points: request.points.map((point) => ({ ...point, lat: Math.round(point.lat * 4) / 4, lng: Math.round(point.lng * 4) / 4 })) };
  const cacheShape = { ...gridded, points: gridded.points.map(({ lat, lng }) => ({ lat, lng })) };
  const key = `climatology:${JSON.stringify(cacheShape)}`;
  return cachedRequest(key, async () => {
    const firstYear = Math.min(1991, gridded.startYear);
    const lastYear = Math.max(2020, gridded.endYear);
    const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => firstYear + index);
    const locationYears = await mapLimit(years, 5, (year) => openMeteoClimatologyYear(gridded, year));
    const results = gridded.points.map((_, pointIndex) => {
      const planning = sampledClimatology(locationYears, years, gridded, pointIndex);
      planning.standardNormal = sampledClimatology(locationYears, years, gridded, pointIndex, 1991, 2020);
      return planning;
    });
    return {
      source: "ERA5 via Open-Meteo Historical Weather API", retrievedAt: new Date().toISOString(),
      results, cached: false, stale: false,
    };
  }, CLIMATOLOGY_CACHE_MS, CLIMATOLOGY_CACHE_MS * 2);
}

function tilePosition(point, zoom = 11) {
  const scale = 2 ** zoom;
  const xFloat = (point.lng + 180) / 360 * scale;
  const latRad = point.lat * Math.PI / 180;
  const yFloat = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * scale;
  const x = Math.max(0, Math.min(scale - 1, Math.floor(xFloat)));
  const y = Math.max(0, Math.min(scale - 1, Math.floor(yFloat)));
  return { zoom, x, y, pixelX: Math.max(0, Math.min(255, Math.floor((xFloat - x) * 256))), pixelY: Math.max(0, Math.min(255, Math.floor((yFloat - y) * 256))) };
}

async function terrainTile(tile) {
  const key = `${tile.zoom}/${tile.x}/${tile.y}`;
  if (terrainTileCache.has(key)) return terrainTileCache.get(key);
  if (terrainTileInFlight.has(key)) return terrainTileInFlight.get(key);
  const pending = (async () => {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const png = await withTerrainSlot(async () => {
          const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`, { signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error(`terrain tile source returned ${response.status}`);
          return PNG.sync.read(Buffer.from(await response.arrayBuffer()));
        });
        terrainTileCache.set(key, png);
        if (terrainTileCache.size > 300) terrainTileCache.delete(terrainTileCache.keys().next().value);
        return png;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 400));
      }
    }
    throw lastError;
  })().finally(() => terrainTileInFlight.delete(key));
  terrainTileInFlight.set(key, pending);
  return pending;
}

async function terrainValues(request) {
  const positioned = request.points.map((point) => ({ point, tile: tilePosition(point) }));
  const tiles = [...new Map(positioned.map((item) => [`${item.tile.zoom}/${item.tile.x}/${item.tile.y}`, item.tile])).values()];
  if (tiles.length > MAX_TERRAIN_TILES_PER_REQUEST) throw new Error(`terrain request spans too many unique tiles (maximum ${MAX_TERRAIN_TILES_PER_REQUEST})`);
  const pngs = await mapLimit(tiles, 4, terrainTile);
  const requestTiles = new Map(tiles.map((tile, index) => [`${tile.zoom}/${tile.x}/${tile.y}`, pngs[index]]));
  const values = positioned.map(({ tile }) => {
    const png = requestTiles.get(`${tile.zoom}/${tile.x}/${tile.y}`);
    const offset = (tile.pixelY * png.width + tile.pixelX) * 4;
    return Number((png.data[offset] * 256 + png.data[offset + 1] + png.data[offset + 2] / 256 - 32768).toFixed(1));
  });
  return { source: "AWS Terrain Tiles (Terrarium; source dataset varies by region)", zoom: 11, retrievedAt: new Date().toISOString(), tileCount: tiles.length, values };
}

async function aemetRaster(field, time, points) {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const south = Math.max(AEMET_BOUNDS.south, Math.min(...lats) - 0.075);
  const north = Math.min(AEMET_BOUNDS.north, Math.max(...lats) + 0.075);
  const west = Math.max(AEMET_BOUNDS.west, Math.min(...lngs) - 0.075);
  const east = Math.min(AEMET_BOUNDS.east, Math.max(...lngs) + 0.075);
  const params = new URLSearchParams({
    service: "WCS", version: "2.0.1", request: "GetCoverage",
    coverageId: FIELD_COVERAGES[field], format: "image/tiff",
  });
  params.append("subset", `Lat(${south},${north})`);
  params.append("subset", `Long(${west},${east})`);
  params.append("subset", `time(\"${time}\")`);
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await withAemetSlot(async () => {
        const response = await fetch(`${AEMET_WCS_URL}?${params}`, { signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error(`AEMET returned ${response.status}`);
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("tiff") && !contentType.includes("octet-stream")) {
          const detail = (await response.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
          throw new Error(`AEMET WCS did not return a raster${detail ? `: ${detail}` : ""}`);
        }
        const tiff = await fromArrayBuffer(await response.arrayBuffer());
        const image = await tiff.getImage();
        const [westEdge, southEdge, eastEdge, northEdge] = image.getBoundingBox();
        const width = image.getWidth();
        const height = image.getHeight();
        const [raster] = await image.readRasters();
        const values = points.map((point) => {
          const x = Math.max(0, Math.min(width - 1, Math.floor((point.lng - westEdge) / (eastEdge - westEdge) * width)));
          const y = Math.max(0, Math.min(height - 1, Math.floor((northEdge - point.lat) / (northEdge - southEdge) * height)));
          const value = Number(raster[y * width + x]);
          return value === -32768 || !Number.isFinite(value) ? null : value;
        });
        if (values.some((value) => value === null)) throw new Error(`AEMET returned incomplete ${field} raster data`);
        return { values, grid: { width, height, bbox: [westEdge, southEdge, eastEdge, northEdge] } };
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function weatherRasterValues(request) {
  const roundedPoints = request.points.map(({ lat, lng }) => ({ lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) }));
  const key = `raster:${JSON.stringify({ ...request, points: roundedPoints })}`;
  return cachedRequest(key, async () => {
    const jobs = request.times.flatMap((time) => request.fields.map((field) => ({ field, time })));
    const results = await mapLimit(jobs, 2, (job) => aemetRaster(job.field, job.time, roundedPoints));
    const values = Object.fromEntries(request.times.map((time) => [time, {}]));
    const grids = Object.fromEntries(request.times.map((time) => [time, {}]));
    jobs.forEach((job, index) => {
      values[job.time][job.field] = results[index].values;
      grids[job.time][job.field] = results[index].grid;
    });
    return { source: "AEMET AMA HARMONIE-AROME WCS", validTimes: request.times, retrievedAt: new Date().toISOString(), values, grids, cached: false, stale: false };
  });
}

async function aemetPoint(field, point, time) {
  const delta = 0.04;
  const params = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetFeatureInfo",
    LAYERS: FIELD_LAYERS[field], QUERY_LAYERS: FIELD_LAYERS[field], STYLES: "",
    SRS: "EPSG:4326", BBOX: `${point.lng - delta},${point.lat - delta},${point.lng + delta},${point.lat + delta}`,
    WIDTH: "101", HEIGHT: "101", X: "50", Y: "50", FORMAT: "image/png",
    INFO_FORMAT: "application/json", FEATURE_COUNT: "1", TIME: time,
  });
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await withAemetSlot(async () => {
        const response = await fetch(`${AEMET_WMS_URL}?${params}`, { signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`AEMET returned ${response.status}`);
        const data = await response.json();
        const value = Number(data?.features?.[0]?.properties?.GRAY_INDEX);
        if (!Number.isFinite(value)) throw new Error(`AEMET returned no ${field} value`);
        return value;
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await callback(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function weatherPoints(request) {
  const key = `points:${JSON.stringify(request)}`;
  return cachedRequest(key, async () => {
    const jobs = request.fields.flatMap((field) => request.points.map((point, index) => ({ field, point, index })));
    const rawValues = await mapLimit(jobs, 10, (job) => aemetPoint(job.field, job.point, request.time));
    const values = Object.fromEntries(request.fields.map((field) => [field, new Array(request.points.length)]));
    jobs.forEach((job, index) => { values[job.field][job.index] = rawValues[index]; });
    return { source: "AEMET AMA HARMONIE-AROME WMS", validTime: request.time, retrievedAt: new Date().toISOString(), values, cached: false, stale: false };
  });
}

const server = http.createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  const cors = corsHeaders(origin);
  if (request.method === "OPTIONS") {
    if (!Object.keys(cors).length) return json(response, 403, { error: "Origin not allowed" });
    response.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" });
    return response.end();
  }
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/health") return json(response, 200, {
    ok: true,
    weatherCacheEntries: cache.size,
    weatherRequestsInFlight: inFlight.size,
    terrainTileCacheEntries: terrainTileCache.size,
    terrainTilesInFlight: terrainTileInFlight.size,
  }, { ...cors, "Cache-Control": "no-store" });
  if (origin && !Object.keys(cors).length) return json(response, 403, { error: "Origin not allowed" });
  try {
    if (request.method === "POST" && url.pathname === "/weather-raster-values") {
      const result = await weatherRasterValues(parseRasterRequest(await readBody(request)));
      return json(response, 200, result, { ...cors, "Cache-Control": "public, max-age=900, stale-if-error=7200" });
    }
    if (request.method === "POST" && url.pathname === "/terrain-values") {
      const result = await terrainValues(parseTerrainRequest(await readBody(request)));
      return json(response, 200, result, { ...cors, "Cache-Control": "public, max-age=3600" });
    }
    if (request.method === "POST" && url.pathname === "/climatology") {
      const result = await climatologyValues(parseClimatologyRequest(await readBody(request)));
      return json(response, 200, result, { ...cors, "Cache-Control": "public, max-age=2592000, stale-if-error=2592000" });
    }
    if (request.method !== "GET" || url.pathname !== "/weather-points") return json(response, 404, { error: "Not found" }, cors);
    const parsed = parseRequest(url);
    const result = await weatherPoints(parsed);
    return json(response, 200, result, { ...cors, "Cache-Control": "public, max-age=900, stale-if-error=7200" });
  } catch (error) {
    const clientError = /fields|times must|time must|forecast times|forecast window|points must|provide between|request body|Content-Type|unique tiles|climatology/.test(error.message);
    return json(response, clientError ? 400 : 502, { error: error.message }, cors);
  }
});

server.listen(PORT, () => console.log(`Eclipse weather proxy listening on ${PORT}`));
