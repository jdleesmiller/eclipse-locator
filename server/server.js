import http from "node:http";
import { fromArrayBuffer } from "geotiff";
import { PNG } from "pngjs";

const PORT = Number(process.env.PORT || 8080);
const AEMET_WMS_URL = "https://ama.aemet.es/geoserver/wms";
const AEMET_WCS_URL = "https://ama.aemet.es/geoserver/wcs";
const FIELD_LAYERS = {
  total: "ama_netcdf:ama_pen_cob_nub",
  low: "ama_netcdf:ama_pen_cob_nub_bajas",
  high: "ama_netcdf:ama_pen_cob_nub_altas",
  base: "ama_netcdf:ama_pen_base_nub",
};
const FIELD_COVERAGES = {
  total: "ama_netcdf__ama_pen_cob_nub",
  low: "ama_netcdf__ama_pen_cob_nub_bajas",
};
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || "https://jdlm.info,http://localhost:8080,http://127.0.0.1:8080").split(",").map((value) => value.trim()).filter(Boolean));
const cache = new Map();
const terrainTileCache = new Map();
const CACHE_MS = 5 * 60 * 1000;

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
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) throw new Error("time must be an ISO-8601 forecast valid time");
  const points = (url.searchParams.get("points") || "").split(";").filter(Boolean).map((pair) => {
    const [lat, lng] = pair.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 42.5 || lat > 44.2 || lng < -7.0 || lng > -4.0) throw new Error("points must be inside the Asturias forecast region");
    return { lat, lng };
  });
  if (!points.length || points.length > 30) throw new Error("provide between 1 and 30 points");
  return { fields, time: date.toISOString(), points };
}

async function readBody(request, maxBytes = 160000) {
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
  if (!fields.length || fields.length > 2 || fields.some((field) => !FIELD_COVERAGES[field])) throw new Error("fields must use total or low");
  const times = Array.isArray(body?.times) ? body.times.map((value) => new Date(value)) : [];
  if (!times.length || times.length > 2 || times.some((date) => Number.isNaN(date.getTime()))) throw new Error("times must contain one or two ISO-8601 forecast valid times");
  const points = Array.isArray(body?.points) ? body.points.map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) })) : [];
  if (!points.length || points.length > 1200) throw new Error("provide between 1 and 1200 points");
  if (points.some(({ lat, lng }) => !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 42.5 || lat > 44.2 || lng < -7 || lng > -4)) throw new Error("points must be inside the Asturias forecast region");
  return { fields: [...new Set(fields)], times: [...new Set(times.map((date) => date.toISOString()))], points };
}

function parseTerrainRequest(body) {
  const points = Array.isArray(body?.points) ? body.points.map((point) => ({ lat: Number(point.lat), lng: Number(point.lng) })) : [];
  if (!points.length || points.length > 2500) throw new Error("provide between 1 and 2500 terrain points");
  if (points.some(({ lat, lng }) => !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -85 || lat > 85 || lng < -180 || lng > 180)) throw new Error("terrain points must use valid Web Mercator coordinates");
  return { points };
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
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`terrain tile source returned ${response.status}`);
      const png = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
      terrainTileCache.set(key, png);
      if (terrainTileCache.size > 200) terrainTileCache.delete(terrainTileCache.keys().next().value);
      return png;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 400));
    }
  }
  throw lastError;
}

async function terrainValues(request) {
  const positioned = request.points.map((point) => ({ point, tile: tilePosition(point) }));
  const tiles = [...new Map(positioned.map((item) => [`${item.tile.zoom}/${item.tile.x}/${item.tile.y}`, item.tile])).values()];
  await mapLimit(tiles, 4, terrainTile);
  const values = positioned.map(({ tile }) => {
    const png = terrainTileCache.get(`${tile.zoom}/${tile.x}/${tile.y}`);
    const offset = (tile.pixelY * png.width + tile.pixelX) * 4;
    return Number((png.data[offset] * 256 + png.data[offset + 1] + png.data[offset + 2] / 256 - 32768).toFixed(1));
  });
  return { source: "AWS Terrain Tiles (Terrarium; source dataset varies by region)", zoom: 11, retrievedAt: new Date().toISOString(), tileCount: tiles.length, values };
}

async function aemetRaster(field, time, points) {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const south = Math.max(42.5, Math.min(...lats) - 0.075);
  const north = Math.min(44.2, Math.max(...lats) + 0.075);
  const west = Math.max(-7, Math.min(...lngs) - 0.075);
  const east = Math.min(-4, Math.max(...lngs) + 0.075);
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
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

async function weatherRasterValues(request) {
  const roundedPoints = request.points.map(({ lat, lng }) => ({ lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)) }));
  const key = JSON.stringify({ ...request, points: roundedPoints });
  const cached = cache.get(key);
  if (cached && Date.now() - cached.createdAt < CACHE_MS) return { ...cached.value, cached: true };
  const jobs = request.times.flatMap((time) => request.fields.map((field) => ({ field, time })));
  const results = await mapLimit(jobs, 2, (job) => aemetRaster(job.field, job.time, roundedPoints));
  const values = Object.fromEntries(request.times.map((time) => [time, {}]));
  const grids = Object.fromEntries(request.times.map((time) => [time, {}]));
  jobs.forEach((job, index) => {
    values[job.time][job.field] = results[index].values;
    grids[job.time][job.field] = results[index].grid;
  });
  const value = { source: "AEMET AMA HARMONIE-AROME WCS", validTimes: request.times, retrievedAt: new Date().toISOString(), values, grids, cached: false };
  cache.set(key, { createdAt: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
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
      const response = await fetch(`${AEMET_WMS_URL}?${params}`, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`AEMET returned ${response.status}`);
      const data = await response.json();
      const value = Number(data?.features?.[0]?.properties?.GRAY_INDEX);
      if (!Number.isFinite(value)) throw new Error(`AEMET returned no ${field} value`);
      return value;
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
  const key = JSON.stringify(request);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.createdAt < CACHE_MS) return { ...cached.value, cached: true };
  const jobs = request.fields.flatMap((field) => request.points.map((point, index) => ({ field, point, index })));
  const rawValues = await mapLimit(jobs, 10, (job) => aemetPoint(job.field, job.point, request.time));
  const values = Object.fromEntries(request.fields.map((field) => [field, new Array(request.points.length)]));
  jobs.forEach((job, index) => { values[job.field][job.index] = rawValues[index]; });
  const value = { source: "AEMET AMA HARMONIE-AROME WMS", validTime: request.time, retrievedAt: new Date().toISOString(), values, cached: false };
  cache.set(key, { createdAt: Date.now(), value });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return value;
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
  if (url.pathname === "/health") return json(response, 200, { ok: true, cacheEntries: cache.size }, cors);
  if (origin && !Object.keys(cors).length) return json(response, 403, { error: "Origin not allowed" });
  try {
    if (request.method === "POST" && url.pathname === "/weather-raster-values") {
      const result = await weatherRasterValues(parseRasterRequest(await readBody(request)));
      return json(response, 200, result, { ...cors, "Cache-Control": "public, max-age=300" });
    }
    if (request.method === "POST" && url.pathname === "/terrain-values") {
      const result = await terrainValues(parseTerrainRequest(await readBody(request)));
      return json(response, 200, result, { ...cors, "Cache-Control": "public, max-age=3600" });
    }
    if (request.method !== "GET" || url.pathname !== "/weather-points") return json(response, 404, { error: "Not found" }, cors);
    const parsed = parseRequest(url);
    const result = await weatherPoints(parsed);
    return json(response, 200, result, { ...cors, "Cache-Control": "public, max-age=300" });
  } catch (error) {
    const clientError = /fields|times must|time must|points must|provide between|request body/.test(error.message);
    return json(response, clientError ? 400 : 502, { error: error.message }, cors);
  }
});

server.listen(PORT, () => console.log(`Eclipse weather proxy listening on ${PORT}`));
