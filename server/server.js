import http from "node:http";

const PORT = Number(process.env.PORT || 8080);
const AEMET_WMS_URL = "https://ama.aemet.es/geoserver/wms";
const FIELD_LAYERS = {
  total: "ama_netcdf:ama_pen_cob_nub",
  low: "ama_netcdf:ama_pen_cob_nub_bajas",
  high: "ama_netcdf:ama_pen_cob_nub_altas",
  base: "ama_netcdf:ama_pen_base_nub",
};
const ALLOWED_ORIGINS = new Set((process.env.ALLOWED_ORIGINS || "https://jdlm.info,http://localhost:8080,http://127.0.0.1:8080").split(",").map((value) => value.trim()).filter(Boolean));
const cache = new Map();
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
    response.writeHead(204, { ...cors, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" });
    return response.end();
  }
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === "/health") return json(response, 200, { ok: true, cacheEntries: cache.size }, cors);
  if (request.method !== "GET" || url.pathname !== "/weather-points") return json(response, 404, { error: "Not found" }, cors);
  if (origin && !Object.keys(cors).length) return json(response, 403, { error: "Origin not allowed" });
  try {
    const parsed = parseRequest(url);
    const result = await weatherPoints(parsed);
    return json(response, 200, result, { ...cors, "Cache-Control": "public, max-age=300" });
  } catch (error) {
    const clientError = /fields|time must|points must|provide between/.test(error.message);
    return json(response, clientError ? 400 : 502, { error: error.message }, cors);
  }
});

server.listen(PORT, () => console.log(`Eclipse weather proxy listening on ${PORT}`));
