/* global L, Astronomy */

const MAX_DISTANCE_KM = 60;
const WEDGE_DEGREES = 4;
const DISTANCES_KM = [5, 10, 20, 30, 50];
const TERRAIN_SAMPLE_COUNT = 100;
const CALIBRATION_STORAGE_KEY = "eclipse-locator-ar-calibrations-v1";
const LAST_LOCATION_STORAGE_KEY = "eclipse-locator-last-location-v1";
const WEATHER_DIGEST_STORAGE_KEY = "eclipse-locator-weather-digest-v2";
const TEST_MODE = new URLSearchParams(window.location.search).get("test") === "1";
const CALIBRATION_POINTS = [
  { name: "centre", x: 0.5, y: 0.5 },
  { name: "left target", x: 0.2, y: 0.5 },
  { name: "right target", x: 0.8, y: 0.5 },
  { name: "upper target", x: 0.5, y: 0.27 },
  { name: "lower target", x: 0.5, y: 0.63 },
];

const state = {
  observer: null,
  locationName: "",
  locationTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  eclipse: null,
  viewingDate: null,
  azimuth: 0,
  elevation: 0,
  terrainSamples: [],
  terrainRequest: null,
  profileRangeKm: 5,
  weather: { layer: null, results: null, digest: null, digestFormat: "markdown", debug: false },
  ar: {
    active: false,
    stream: null,
    rawHeading: null,
    rawPitch: null,
    headingOffset: 0,
    pitchOffset: 0,
    horizontalFov: 60,
    verticalFov: 80,
    targets: [],
    orientationHistory: [],
    calibrationStep: null,
    calibrationSamples: [],
    cameraReady: false,
    cameraError: null,
    orientationPermissionGranted: false,
    orientationError: null,
    orientationReady: false,
    validOrientationCount: 0,
    initialOrientation: null,
    orientationMotionDegrees: 0,
    compassAccuracy: null,
    compassWarningActive: false,
    readyAnnounced: false,
  },
};

const observerIcon = L.divIcon({ className: "", html: '<div class="observer-pin"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
let map = null;
let observerMarker = null;
let sightlineLayer = null;
let distanceLayer = null;
let terrainLayer = null;
let weatherLayer = null;
let lastLocationChoice = null;

const azimuthOutput = document.querySelector("#azimuth");
const elevationOutput = document.querySelector("#elevation");
const directionOutput = document.querySelector("#direction");
const heightTable = document.querySelector("#height-table");
const heightNote = document.querySelector("#height-note");
const statusOutput = document.querySelector("#status");
const terrainProfile = document.querySelector("#terrain-profile");
const terrainResult = document.querySelector("#terrain-result");
const terrainNote = document.querySelector("#terrain-note");
const arView = document.querySelector("#ar-view");
const arVideo = document.querySelector("#ar-video");
const arMarkers = document.querySelector("#ar-markers");
const arOffscreenArrow = document.querySelector("#ar-offscreen-arrow");
const arStatus = document.querySelector("#ar-status");
const arFov = document.querySelector("#ar-fov");
const arFovValue = document.querySelector("#ar-fov-value");
const arMainControls = document.querySelector("#ar-main-controls");
const arCalibrationSettings = document.querySelector("#ar-calibration-settings");
const arCalibrationPanel = document.querySelector("#ar-calibration-panel");
const arCalibrationTarget = document.querySelector("#ar-calibration-target");
const arCalibrationInstruction = document.querySelector("#ar-calibration-instruction");
const arCalibrationSelect = document.querySelector("#ar-calibration-select");
const arFilterCheck = document.querySelector("#ar-filter-check");
const eclipseExplorer = document.querySelector("#eclipse-explorer");
const locationGate = document.querySelector("#location-gate");
const gateStatus = document.querySelector("#gate-status");
const placeResults = document.querySelector("#place-results");
const lastLocationButton = document.querySelector("#last-location");
const eventKindOutput = document.querySelector("#event-kind");
const eventSummaryOutput = document.querySelector("#event-summary");
const eventDateOutput = document.querySelector("#event-date");
const eventObscurationOutput = document.querySelector("#event-obscuration");
const eventEyebrow = document.querySelector("#event-eyebrow");
const eventTitle = document.querySelector("#event-title");
const arOffscreenLabel = arOffscreenArrow.querySelector("b");
const weatherCard = document.querySelector("#weather-card");
const weatherLayerSelect = document.querySelector("#weather-layer");
const weatherTimeSelect = document.querySelector("#weather-time");
const weatherLayerNote = document.querySelector("#weather-layer-note");
const weatherMapStatus = document.querySelector("#weather-map-status");
const weatherLegend = document.querySelector("#weather-legend");
const weatherStatus = document.querySelector("#weather-status");
const weatherResults = document.querySelector("#weather-results");
const weatherDigest = document.querySelector("#weather-digest");
const weatherDigestText = document.querySelector("#weather-digest-text");
const weatherDebugToggle = document.querySelector("#weather-debug");

function destinationPoint(origin, bearingDegrees, distanceKm) {
  const earthRadiusKm = 6371.0088;
  const angularDistance = distanceKm / earthRadiusKm;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(origin.lat);
  const lng1 = toRadians(origin.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing));
  const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1), Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2));
  return [toDegrees(lat2), toDegrees(lng2)];
}

function initialBearing(from, to) {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

function toRadians(degrees) { return degrees * Math.PI / 180; }
function toDegrees(radians) { return radians * 180 / Math.PI; }

function compassPoint(degrees) {
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return points[Math.round(degrees / 22.5) % 16];
}

function normalizeAngle(degrees) {
  return ((degrees % 360) + 360) % 360;
}

function signedAngleDifference(target, current) {
  return ((target - current + 540) % 360) - 180;
}

function sunPositionAt(date) {
  const sun = EclipseWeather.solarPosition(date, state.observer.lat, state.observer.lng);
  return { azimuth: sun.azimuthDeg, elevation: sun.elevationDeg };
}

function initializeMap() {
  if (map) return;
  map = L.map("map", { zoomControl: true, preferCanvas: true }).setView(state.observer, 9);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  observerMarker = L.marker(state.observer, { icon: observerIcon, draggable: true, zIndexOffset: 1000 }).addTo(map);
  sightlineLayer = L.layerGroup().addTo(map);
  distanceLayer = L.layerGroup().addTo(map);
  terrainLayer = L.layerGroup().addTo(map);
  observerMarker.on("dragend", (event) => setObserver(event.target.getLatLng(), "Observer moved to"));
  map.on("click", (event) => setObserver(event.latlng, "Viewing point set to"));
}

function eclipseKindName(kind) {
  const value = String(kind).toLowerCase();
  if (value.includes("total")) return "total";
  if (value.includes("annular")) return "annular";
  return "partial";
}

function eventDate(event) {
  return event.time.date instanceof Date ? event.time.date : new Date(event.time.date);
}

function formatLocationTime(date, includeDate = false, includeSeconds = false) {
  return new Intl.DateTimeFormat([], {
    ...(includeDate ? { weekday: "short", year: "numeric", month: "short", day: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    timeZone: state.locationTimezone,
    timeZoneName: includeDate ? "short" : undefined,
  }).format(date);
}

function nextVisibleEclipse(startDate, centralOnly = false) {
  const observer = new Astronomy.Observer(state.observer.lat, state.observer.lng, 0);
  let eclipse = Astronomy.SearchLocalSolarEclipse(startDate, observer);
  for (let attempts = 0; attempts < 300; attempts += 1) {
    const kind = eclipseKindName(eclipse.kind);
    if (eclipse.peak.altitude > 0 && (!centralOnly || kind !== "partial")) return eclipse;
    eclipse = Astronomy.NextLocalSolarEclipse(eclipse.peak.time, observer);
  }
  throw new Error("No suitable eclipse found within the search range");
}

function eclipseArPhases(eclipse) {
  const kind = eclipseKindName(eclipse.kind);
  const phases = [{ label: "Partial begins", date: eventDate(eclipse.partial_begin) }];
  if (kind === "partial") {
    phases.push({ label: `Maximum partial · ${Math.round(eclipse.obscuration * 100)}%`, date: eventDate(eclipse.peak), primary: true });
  } else {
    const phaseName = kind === "total" ? "Totality" : "Annularity";
    phases.push({
      label: `${phaseName} ${formatLocationTime(eventDate(eclipse.total_begin), false, true)}–${formatLocationTime(eventDate(eclipse.total_end), false, true)}`,
      date: eventDate(eclipse.peak),
      displayTime: `maximum ${formatLocationTime(eventDate(eclipse.peak), false, true)}`,
      primary: true,
    });
  }
  phases.push({ label: "Partial ends", date: eventDate(eclipse.partial_end) });
  return phases;
}

function selectEclipse(eclipse, fit = true) {
  state.eclipse = eclipse;
  const kind = eclipseKindName(eclipse.kind);
  const peakDate = eventDate(eclipse.peak);
  state.viewingDate = peakDate;
  const kindLabel = kind === "total" ? "Total solar eclipse" : kind === "annular" ? "Annular solar eclipse" : "Partial solar eclipse";
  eventKindOutput.textContent = kindLabel;
  eventDateOutput.textContent = formatLocationTime(peakDate, true);
  eventObscurationOutput.textContent = `${Math.round(eclipse.obscuration * 100)}%`;
  eventSummaryOutput.textContent = state.locationName;
  eventEyebrow.textContent = "ECLIPSE LOCATOR";
  eventTitle.textContent = state.locationName;
  arOffscreenLabel.textContent = kind === "partial" ? "Maximum eclipse" : kind === "total" ? "Totality" : "Annularity";
  updateCalculations({ fit });
  refreshWeatherAvailability();
}

function weatherApplies() {
  return state.viewingDate instanceof Date && state.viewingDate.toISOString().slice(0, 10) === "2026-08-12";
}

function updateWeatherOverlay() {
  if (!map) return;
  if (weatherLayer) map.removeLayer(weatherLayer);
  weatherLayer = null;
  weatherMapStatus.textContent = "";
  const kind = weatherLayerSelect.value;
  const validTime = weatherTimeSelect.value;
  const labels = {
    low: "Low-cloud percentage; cloud bases below approximately 8,200 ft.",
    total: "Total percentage of sky covered as seen from the surface.",
    high: "High-cloud percentage; cloud bases above approximately 16,400 ft.",
    base: "Forecast cloud-base height in thousands of feet.",
    none: "Cloud overlay hidden.",
  };
  const minutesFromEclipse = Math.round((state.viewingDate - new Date(validTime)) / 60000);
  weatherLayerNote.textContent = `${labels[kind]} Valid ${validTime.slice(11, 16)} UTC (${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }).format(new Date(validTime))} CEST), ${Math.abs(minutesFromEclipse)} minutes ${minutesFromEclipse >= 0 ? "before" : "after"} maximum.`;
  weatherLegend.hidden = kind === "none";
  if (kind !== "none") {
    const legendParams = new URLSearchParams({ REQUEST: "GetLegendGraphic", VERSION: "1.0.0", FORMAT: "image/png", WIDTH: "20", HEIGHT: "20", LAYER: EclipseWeather.LAYERS[kind].name });
    weatherLegend.src = `${EclipseWeather.WMS_URL}?${legendParams}`;
  }
  if (kind !== "none") {
    const retryingTiles = new Set();
    let failedTiles = 0;
    weatherLayer = EclipseWeather.createWmsLayer(kind, validTime);
    weatherLayer.on("weatherretry", (event) => {
      retryingTiles.add(event.tile);
      weatherMapStatus.textContent = `AEMET tile unavailable; retrying ${retryingTiles.size} tile${retryingTiles.size === 1 ? "" : "s"} gently…`;
    });
    weatherLayer.on("weatherretryload", (event) => {
      retryingTiles.delete(event.tile);
      weatherMapStatus.textContent = failedTiles
        ? `${failedTiles} forecast tile${failedTiles === 1 ? " is" : "s are"} still unavailable.`
        : retryingTiles.size ? `Retrying ${retryingTiles.size} forecast tile${retryingTiles.size === 1 ? "" : "s"}…` : "Forecast tiles recovered.";
    });
    weatherLayer.on("weatherfinalerror", (event) => {
      retryingTiles.delete(event.tile);
      failedTiles += 1;
      weatherMapStatus.textContent = `${failedTiles} forecast tile${failedTiles === 1 ? " is" : "s are"} unavailable after two retries. Pan or change time to try again.`;
    });
    weatherLayer.addTo(map);
  }
}

function refreshWeatherAvailability() {
  weatherCard.hidden = !weatherApplies();
  if (weatherApplies()) updateWeatherOverlay();
  else if (weatherLayer && map) {
    map.removeLayer(weatherLayer);
    weatherLayer = null;
  }
}

function renderWeatherResults(results) {
  weatherResults.replaceChildren();
  for (const result of results) {
    const item = document.createElement("article");
    item.className = "weather-result";
    const target = result.weather.target;
    const terrain = result.terrain;
    const trend = result.trend.classification;
    const trendLabel = trend === "unavailable" ? "no previous digest" : trend;
    item.innerHTML = `<button class="weather-result-main" type="button"><strong>${result.name}</strong><b class="weather-score">${result.overall.recommendation}</b><span>${result.weatherRating} weather (${result.score}/100) · ${terrain.classification} terrain · ${trendLabel}</span></button>
      <small><b>18:27 estimate:</b> low cloud here ${target.lowCloudAtObserverPct}% · wedge mean 10/25/50 km ${target.low.km10.wedgeMean}/${target.low.km25.wedgeMean}/${target.low.km50.wedgeMean}%<br><b>Terrain:</b> ±0.5° horizon ${terrain.within05DegMaxAngleDeg}° at ${terrain.within05DegMaxDistanceKm} km · Sun ${terrain.sunElevationDeg}° · clearance ${terrain.clearanceDeg >= 0 ? "+" : ""}${terrain.clearanceDeg}°</small>
      <details><summary>Hourly and wedge details</summary><div class="weather-detail-grid">
        <span></span><b>18:00</b><b>18:27*</b><b>19:00</b>
        <span>Low here</span><span>${result.weather.before.lowCloudAtObserverPct}%</span><span>${target.lowCloudAtObserverPct}%</span><span>${result.weather.after.lowCloudAtObserverPct}%</span>
        <span>Low 10 km wedge</span><span>${result.weather.before.low.km10.wedgeMean}%</span><span>${target.low.km10.wedgeMean}%</span><span>${result.weather.after.low.km10.wedgeMean}%</span>
        <span>Low 25 km wedge</span><span>${result.weather.before.low.km25.wedgeMean}%</span><span>${target.low.km25.wedgeMean}%</span><span>${result.weather.after.low.km25.wedgeMean}%</span>
        <span>Low 50 km wedge</span><span>${result.weather.before.low.km50.wedgeMean}%</span><span>${target.low.km50.wedgeMean}%</span><span>${result.weather.after.low.km50.wedgeMean}%</span>
      </div><p><b>18:27 low cloud</b> centre mean 10/25/50 km ${target.low.km10.centreMean}/${target.low.km25.centreMean}/${target.low.km50.centreMean}% · wedge p75 ${target.low.km10.wedgeP75}/${target.low.km25.wedgeP75}/${target.low.km50.wedgeP75}% · max ${target.low.km10.wedgeMax}/${target.low.km25.wedgeMax}/${target.low.km50.wedgeMax}%.</p><p><b>18:27 total cloud</b> centre mean ${target.total.km10.centreMean}/${target.total.km25.centreMean}/${target.total.km50.centreMean}% · wedge mean ${target.total.km10.wedgeMean}/${target.total.km25.wedgeMean}/${target.total.km50.wedgeMean}% · p75 ${target.total.km10.wedgeP75}/${target.total.km25.wedgeP75}/${target.total.km50.wedgeP75}% · max ${target.total.km10.wedgeMax}/${target.total.km25.wedgeMax}/${target.total.km50.wedgeMax}%.</p><p><b>Terrain horizons</b> centre ${terrain.centreRayHorizonDeg}° · ±0.25° max ${terrain.within025DegMaxAngleDeg}° · ±0.5° max ${terrain.within05DegMaxAngleDeg}° (used for classification) · ±5° max ${terrain.contextWedgeMaxAngleDeg}° (context only).</p><p>* Linear interpolation; not an AEMET model output time.</p></details>
      <details class="weather-debug-detail" ${state.weather.debug ? "" : "hidden"}><summary>Debug samples (${result.debug.samples.length} cloud / ${terrain.debugSamples.length} terrain)</summary><pre>${state.weather.debug ? JSON.stringify({ cloud: result.debug.samples, terrain: terrain.debugSamples }, null, 2) : ""}</pre></details>`;
    item.querySelector(".weather-result-main").addEventListener("click", () => activateLocation({ lat: result.lat, lng: result.lng, name: result.name, timezone: "Europe/Madrid" }));
    weatherResults.append(item);
  }
}

function showDigest(format = state.weather.digestFormat) {
  if (!state.weather.digest) return;
  state.weather.digestFormat = format;
  weatherDigestText.value = format === "json" ? JSON.stringify(state.weather.digest, null, 2) : EclipseWeather.digestMarkdown(state.weather.digest);
  document.querySelector("#show-json-digest").textContent = format === "json" ? "Show Markdown" : "Show JSON";
  document.querySelector("#copy-weather-digest").textContent = format === "json" ? "Copy JSON" : "Copy Markdown";
}

function loadPreviousWeatherDigest() {
  try { return JSON.parse(localStorage.getItem(WEATHER_DIGEST_STORAGE_KEY) || "null"); }
  catch { return null; }
}

function buildWeatherDigest(results) {
  const sun = EclipseWeather.verifySunPosition(new Date(EclipseWeather.TARGET_TIME), state.observer.lat, state.observer.lng);
  return EclipseWeather.createDigest({
    sun, candidates: results, includeDebug: state.weather.debug,
    warnings: [
      "The 18:27 values are linearly interpolated approximations between the 18:00 and 19:00 AEMET grids.",
      "Model initialization time is not exposed by AEMET's public services.",
      "Cloud values use nearest model raster cells; terrain excludes buildings, trees and atmospheric refraction.",
    ],
  });
}

async function analyzeWeather() {
  const button = document.querySelector("#analyze-weather");
  button.disabled = true;
  weatherResults.replaceChildren();
  weatherDigest.hidden = true;
  weatherStatus.textContent = "Loading 18:00 and 19:00 cloud grids for seven-ray wedges…";
  try {
    const candidates = window.ECLIPSE_CANDIDATES.map((candidate) => {
      const sun = EclipseWeather.solarPosition(new Date(EclipseWeather.TARGET_TIME), candidate.lat, candidate.lng);
      return { ...candidate, azimuthDeg: sun.azimuthDeg, sunElevationDeg: sun.elevationDeg };
    });
    const cloudResults = await EclipseWeather.analyzeCandidates(candidates, state.azimuth, null, (complete, total, name) => {
      weatherStatus.textContent = complete ? `Processed cloud wedge for ${name} (${complete} of ${total})…` : "Downloading four small AEMET regional rasters…";
    });
    weatherStatus.textContent = "Sampling the terrain-tile horizon, with 100 m spacing through the first 2 km…";
    const terrainResults = await EclipseWeather.analyzeTerrain(cloudResults, (complete, total, name) => {
      weatherStatus.textContent = `Processed terrain for ${name} (${complete} of ${total})…`;
    });
    const results = EclipseWeather.enrichCandidates(terrainResults, loadPreviousWeatherDigest());
    state.weather.results = results;
    renderWeatherResults(results);
    state.weather.digest = buildWeatherDigest(results);
    try { localStorage.setItem(WEATHER_DIGEST_STORAGE_KEY, JSON.stringify(state.weather.digest)); } catch { /* persistence is optional */ }
    showDigest("markdown");
    weatherDigest.hidden = false;
    weatherStatus.textContent = `Comparison complete. ${results[0].name}: ${results[0].overall.recommendation}. Tap a site to move the map.`;
  } catch (error) {
    weatherStatus.textContent = `Site comparison unavailable: ${error.message}. The map overlay may still work.`;
  } finally {
    button.disabled = false;
  }
}

function upcomingEclipses(count, centralOnly = false) {
  const eclipses = [];
  let startDate = new Date();
  while (eclipses.length < count) {
    const eclipse = nextVisibleEclipse(startDate, centralOnly);
    eclipses.push(eclipse);
    startDate = new Date(eventDate(eclipse.peak).getTime() + 24 * 3600000);
  }
  return eclipses;
}

function eclipseChoice(eclipse) {
  const kind = eclipseKindName(eclipse.kind);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "eclipse-choice";
  const description = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = `${kind[0].toUpperCase()}${kind.slice(1)} solar eclipse`;
  const date = document.createElement("span");
  date.textContent = formatLocationTime(eventDate(eclipse.peak), true);
  description.append(name, date);
  const obscuration = document.createElement("b");
  obscuration.textContent = `${Math.round(eclipse.obscuration * 100)}%`;
  button.append(description, obscuration);
  button.addEventListener("click", () => {
    eclipseExplorer.hidden = true;
    selectEclipse(eclipse, true);
  });
  return button;
}

function openEclipseExplorer() {
  const localList = document.querySelector("#local-eclipse-list");
  const centralList = document.querySelector("#central-eclipse-list");
  document.querySelector("#explorer-location").textContent = `Eclipses calculated for ${state.locationName}. Select one to inspect its viewing direction.`;
  localList.textContent = "Calculating…";
  centralList.textContent = "Calculating…";
  eclipseExplorer.hidden = false;
  requestAnimationFrame(() => {
    try {
      localList.replaceChildren(...upcomingEclipses(5).map(eclipseChoice));
      centralList.replaceChildren(...upcomingEclipses(3, true).map(eclipseChoice));
    } catch (error) {
      localList.textContent = `Could not calculate events: ${error.message}`;
      centralList.textContent = "";
    }
  });
}

function findAndSelectEclipse({ startDate = new Date(), centralOnly = false, fit = true } = {}) {
  eventKindOutput.textContent = "Calculating eclipse…";
  try {
    selectEclipse(nextVisibleEclipse(startDate, centralOnly), fit);
  } catch (error) {
    eventKindOutput.textContent = "Eclipse calculation failed";
    eventSummaryOutput.textContent = error.message;
  }
}

function activateLocation(location) {
  state.observer = { lat: Number(location.lat), lng: Number(location.lng) };
  state.locationName = location.name || `${state.observer.lat.toFixed(4)}, ${state.observer.lng.toFixed(4)}`;
  state.locationTimezone = location.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  lastLocationChoice = { ...state.observer, name: state.locationName, timezone: state.locationTimezone };
  lastLocationButton.hidden = false;
  lastLocationButton.textContent = `Use last location: ${state.locationName}`;
  try { localStorage.setItem(LAST_LOCATION_STORAGE_KEY, JSON.stringify(lastLocationChoice)); } catch { /* optional convenience only */ }
  initializeMap();
  observerMarker.setLatLng(state.observer);
  map.setView(state.observer, 9);
  locationGate.hidden = true;
  statusOutput.textContent = `Observer: ${state.locationName} (${state.observer.lat.toFixed(5)}, ${state.observer.lng.toFixed(5)})`;
  findAndSelectEclipse();
}

function loadSavedCalibrations() {
  try {
    const saved = JSON.parse(localStorage.getItem(CALIBRATION_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function storeSavedCalibrations(calibrations) {
  try {
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibrations.slice(0, 20)));
    return true;
  } catch {
    return false;
  }
}

function refreshCalibrationSelect(selectedId = "") {
  const calibrations = loadSavedCalibrations();
  arCalibrationSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Saved calibrations…";
  arCalibrationSelect.append(placeholder);
  for (const calibration of calibrations) {
    const date = new Date(calibration.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    const place = calibration.locationName || (Number.isFinite(calibration.latitude) ? `${calibration.latitude.toFixed(2)}, ${calibration.longitude.toFixed(2)}` : "Unknown location");
    const option = document.createElement("option");
    option.value = calibration.id;
    option.textContent = `${place} · ${date} · ${calibration.horizontalFov.toFixed(1)}° × ${calibration.verticalFov.toFixed(1)}° · error ${calibration.rmsError.toFixed(1)}°`;
    arCalibrationSelect.append(option);
  }
  arCalibrationSelect.value = selectedId;
}

function applyCalibration(calibration) {
  state.ar.headingOffset = calibration.headingOffset;
  state.ar.pitchOffset = calibration.pitchOffset;
  state.ar.horizontalFov = calibration.horizontalFov;
  state.ar.verticalFov = calibration.verticalFov;
  arFov.value = String(Math.round(calibration.horizontalFov));
  arFovValue.textContent = `${calibration.horizontalFov.toFixed(1)}°`;
  arStatus.textContent = `Applied saved calibration (${calibration.rmsError.toFixed(1)}° fit error). Recalibrate if the magnetic environment has changed.`;
  renderArOverlay();
}

function lineOfSightHeightKm(distanceKm) {
  return distanceKm * Math.tan(toRadians(state.elevation));
}

function terrainSampleDistances() {
  // Spend 56 of the profile's 100 points in the first 5 km: about 91 m apart,
  // close to the useful source resolution. Space the rest evenly.
  const nearCount = 56;
  const near = Array.from({ length: nearCount }, (_, index) => 5 * index / (nearCount - 1));
  const farCount = TERRAIN_SAMPLE_COUNT - nearCount;
  const far = Array.from({ length: farCount }, (_, index) => 5 + (MAX_DISTANCE_KM - 5) * (index + 1) / farCount);
  return [...near, ...far];
}

// Coarse distance readouts; the terrain profile uses a separate, denser sample set.
function buildSightlineSamples() {
  return DISTANCES_KM.map((distanceKm) => ({
    distanceKm,
    location: destinationPoint(state.observer, state.azimuth, distanceKm),
    lineOfSightHeightKm: lineOfSightHeightKm(distanceKm),
    terrainElevationM: null,
  }));
}

function rayAltitudeM(distanceKm, observerElevationM) {
  return EclipseWeather.solarRayAltitudeM(distanceKm, observerElevationM, state.elevation);
}

function renderTerrainProfile(samples, maxDistanceKm = state.profileRangeKm) {
  const visibleSamples = samples.filter((sample) => sample.distanceKm <= maxDistanceKm);
  const width = 360;
  const height = 112;
  const pad = { top: 9, right: 8, bottom: 18, left: 35 };
  const values = visibleSamples.flatMap((sample) => [sample.terrainElevationM, sample.rayAltitudeM]);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const valuePadding = Math.max(10, (rawMax - rawMin) * 0.08);
  const minValue = rawMin - valuePadding;
  const maxValue = rawMax + valuePadding;
  const range = maxValue - minValue;
  const x = (distance) => pad.left + distance / maxDistanceKm * (width - pad.left - pad.right);
  const y = (value) => pad.top + (maxValue - value) / range * (height - pad.top - pad.bottom);
  const terrainPoints = visibleSamples.map((sample) => `${x(sample.distanceKm).toFixed(1)},${y(sample.terrainElevationM).toFixed(1)}`).join(" ");
  const rayPoints = visibleSamples.map((sample) => `${x(sample.distanceKm).toFixed(1)},${y(sample.rayAltitudeM).toFixed(1)}`).join(" ");
  const grid = [minValue, minValue + range / 2, maxValue].map((value) => `<line x1="${pad.left}" y1="${y(value)}" x2="${width - pad.right}" y2="${y(value)}" stroke="rgba(255,255,255,.09)"/><text x="${pad.left - 4}" y="${y(value) + 3}" fill="#9cabb9" font-size="8" text-anchor="end">${Math.round(value)}m</text>`).join("");

  terrainProfile.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Terrain elevation and solar sightline altitude over ${maxDistanceKm} kilometres">
    ${grid}
    <polygon points="${pad.left},${height - pad.bottom} ${terrainPoints} ${width - pad.right},${height - pad.bottom}" fill="rgba(143,166,184,.22)"/>
    <polyline points="${terrainPoints}" fill="none" stroke="#8fa6b8" stroke-width="2"/>
    <polyline points="${rayPoints}" fill="none" stroke="#ffcf4a" stroke-width="2.5"/>
    <text x="${pad.left}" y="${height - 5}" fill="#9cabb9" font-size="8">0 km</text>
    <text x="${width - pad.right}" y="${height - 5}" fill="#9cabb9" font-size="8" text-anchor="end">${maxDistanceKm} km</text>
  </svg>`;
}

async function loadTerrain() {
  if (state.terrainRequest) state.terrainRequest.abort();
  const controller = new AbortController();
  state.terrainRequest = controller;
  state.terrainSamples = [];
  terrainLayer.clearLayers();
  terrainResult.className = "";
  terrainResult.textContent = "Loading…";
  terrainNote.textContent = "Sampling at approximately 90 m intervals through the first 5 km…";
  terrainProfile.innerHTML = "";

  const distances = terrainSampleDistances();
  const locations = distances.map((distance) => destinationPoint(state.observer, state.azimuth, distance));
  try {
    const elevations = await EclipseWeather.terrainValues(locations.map(([lat, lng]) => ({ lat, lng })), { signal: controller.signal });
    if (state.terrainRequest !== controller) return;

    const observerElevationM = elevations[0];
    state.terrainSamples = distances.map((distanceKm, index) => {
      const altitudeM = rayAltitudeM(distanceKm, observerElevationM);
      return {
        distanceKm,
        location: locations[index],
        terrainElevationM: elevations[index],
        rayAltitudeM: altitudeM,
        clearanceM: altitudeM - elevations[index],
      };
    });

    renderTerrainProfile(state.terrainSamples);
    const relevant = state.terrainSamples.slice(1);
    const worst = relevant.reduce((lowest, sample) => sample.clearanceM < lowest.clearanceM ? sample : lowest);
    const blocked = relevant.filter((sample) => sample.clearanceM < 0);
    if (blocked.length) {
      const first = blocked[0];
      terrainResult.className = "blocked";
      terrainResult.textContent = "Potentially blocked";
      terrainNote.textContent = `First sampled obstruction at ${first.distanceKm.toFixed(1)} km; terrain is ${Math.round(-first.clearanceM)} m above the solar ray. Minimum clearance: ${Math.round(worst.clearanceM)} m.`;
      for (const sample of blocked) {
        L.circleMarker(sample.location, { radius: 3, color: "#fff", weight: 1, fillColor: "#e64f43", fillOpacity: 0.9, interactive: false }).addTo(terrainLayer);
      }
    } else {
      terrainResult.className = "clear";
      terrainResult.textContent = "Sampled terrain clears";
      terrainNote.textContent = `Minimum sampled clearance is ${Math.round(worst.clearanceM)} m at ${worst.distanceKm.toFixed(1)} km. Buildings and narrow features are not included.`;
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    terrainResult.className = "";
    terrainResult.textContent = "Unavailable";
    terrainNote.textContent = "Terrain could not be loaded. The geometric sightline estimates above still work.";
  } finally {
    if (state.terrainRequest === controller) state.terrainRequest = null;
  }
}

function buildArTargets() {
  if (!state.eclipse) return [];
  return eclipseArPhases(state.eclipse).map((phase) => ({
    ...phase,
    ...sunPositionAt(phase.date),
    timeLabel: phase.displayTime || formatLocationTime(phase.date, false, true),
  }));
}

function createArMarkers() {
  state.ar.targets = buildArTargets();
  arMarkers.innerHTML = state.ar.targets.map((target, index) => {
    const classes = ["ar-marker", target.primary ? "primary" : ""].filter(Boolean).join(" ");
    return `<div class="${classes}" data-target="${index}"><div class="ar-marker-dot"></div><div class="ar-marker-label"><b>${target.label}</b><small>${target.timeLabel} · ${target.azimuth.toFixed(1)}° / ${target.elevation.toFixed(1)}°</small></div></div>`;
  }).join("");
}

function updateArReadiness() {
  const accuracyBlocks = Number.isFinite(state.ar.compassAccuracy) && state.ar.compassAccuracy > 45;
  const enoughReadings = state.ar.validOrientationCount >= 5;
  const motionDetected = state.ar.orientationMotionDegrees >= 1;
  state.ar.orientationReady = state.ar.orientationPermissionGranted && enoughReadings && motionDetected && !accuracyBlocks;

  if (state.ar.cameraError) {
    arStatus.textContent = `Camera unavailable: ${state.ar.cameraError}`;
  } else if (!state.ar.cameraReady) {
    arStatus.textContent = "Starting rear camera…";
  } else if (state.ar.orientationError) {
    arStatus.textContent = state.ar.orientationError;
  } else if (!state.ar.orientationPermissionGranted) {
    arStatus.textContent = "Waiting for orientation permission…";
  } else if (accuracyBlocks) {
    arStatus.textContent = "Compass accuracy is very poor. Move away from metal or magnets, then move the phone gently.";
  } else if (!enoughReadings || !motionDetected) {
    arStatus.textContent = "Initializing compass—move the phone gently through a small arc.";
  } else if (Number.isFinite(state.ar.compassAccuracy) && state.ar.compassAccuracy > 25) {
    arStatus.textContent = `AR active, but compass accuracy is only about ±${Math.round(state.ar.compassAccuracy)}°. Move away from metal or magnets.`;
    state.ar.compassWarningActive = true;
    state.ar.readyAnnounced = true;
  } else if (state.ar.compassWarningActive) {
    arStatus.textContent = "AR ready. Compass accuracy has improved.";
    state.ar.compassWarningActive = false;
  } else if (!state.ar.readyAnnounced) {
    const accuracy = Number.isFinite(state.ar.compassAccuracy) && state.ar.compassAccuracy >= 0 ? ` Compass accuracy approximately ±${Math.round(state.ar.compassAccuracy)}°.` : "";
    arStatus.textContent = `AR ready.${accuracy}`;
    state.ar.readyAnnounced = true;
  }
}

function renderArOverlay() {
  if (!state.ar.active) return;
  if (!state.ar.cameraReady || !state.ar.orientationReady || state.ar.rawHeading === null || state.ar.rawPitch === null) {
    arOffscreenArrow.hidden = true;
    arMarkers.hidden = true;
    return;
  }
  if (state.ar.calibrationStep === null) arMarkers.hidden = false;

  const heading = normalizeAngle(state.ar.rawHeading + state.ar.headingOffset);
  const pitch = state.ar.rawPitch + state.ar.pitchOffset;
  const horizontalFov = state.ar.horizontalFov;
  const verticalFov = state.ar.verticalFov;
  const screenBounds = { left: 0.08, right: 0.92, top: 0.12, bottom: 0.68 };
  let primaryScreenPosition = null;

  arMarkers.querySelectorAll(".ar-marker").forEach((marker) => {
    const target = state.ar.targets[Number(marker.dataset.target)];
    const bearingDelta = signedAngleDifference(target.azimuth, heading);
    const elevationDelta = target.elevation - pitch;
    const xOffset = Math.tan(toRadians(bearingDelta)) / (2 * Math.tan(toRadians(horizontalFov / 2)));
    const yOffset = Math.tan(toRadians(elevationDelta)) / (2 * Math.tan(toRadians(verticalFov / 2)));
    const screenX = 0.5 + xOffset;
    const screenY = 0.5 - yOffset;
    const visible = screenX >= screenBounds.left && screenX <= screenBounds.right && screenY >= screenBounds.top && screenY <= screenBounds.bottom && Math.abs(bearingDelta) < 80 && Math.abs(elevationDelta) < 80;
    marker.style.left = `${screenX * 100}%`;
    marker.style.top = `${screenY * 100}%`;
    marker.style.opacity = visible ? "1" : "0";
    if (target.primary) primaryScreenPosition = { x: screenX, y: screenY, visible, bearingDelta, elevationDelta };
  });

  if (!primaryScreenPosition || primaryScreenPosition.visible || state.ar.calibrationStep !== null) {
    arOffscreenArrow.hidden = true;
    return;
  }
  const arrowOrigin = { x: 0.5, y: 0.42 };
  const dx = primaryScreenPosition.bearingDelta / horizontalFov;
  const dy = -primaryScreenPosition.elevationDelta / verticalFov;
  const horizontalScale = Math.abs(dx) < 0.0001 ? Infinity : dx > 0 ? (screenBounds.right - arrowOrigin.x) / dx : (screenBounds.left - arrowOrigin.x) / dx;
  const verticalScale = Math.abs(dy) < 0.0001 ? Infinity : dy > 0 ? (screenBounds.bottom - arrowOrigin.y) / dy : (screenBounds.top - arrowOrigin.y) / dy;
  const scale = Math.max(0, Math.min(horizontalScale, verticalScale));
  arOffscreenArrow.style.left = `${(arrowOrigin.x + dx * scale) * 100}%`;
  arOffscreenArrow.style.top = `${(arrowOrigin.y + dy * scale) * 100}%`;
  arOffscreenArrow.style.setProperty("--arrow-angle", `${toDegrees(Math.atan2(dy, dx))}deg`);
  arOffscreenArrow.hidden = false;
}

function handleOrientation(event) {
  let heading = null;
  if (Number.isFinite(event.webkitCompassHeading)) {
    heading = event.webkitCompassHeading;
  } else if (Number.isFinite(event.alpha)) {
    const screenAngle = screen.orientation?.angle || window.orientation || 0;
    heading = normalizeAngle(360 - event.alpha + screenAngle);
  }
  const pitch = Number.isFinite(event.beta) ? event.beta - 90 : null;
  if (Number.isFinite(event.webkitCompassAccuracy)) state.ar.compassAccuracy = event.webkitCompassAccuracy;
  if (heading !== null && pitch !== null) {
    state.ar.rawHeading = heading;
    state.ar.rawPitch = pitch;
    state.ar.validOrientationCount += 1;
    if (!state.ar.initialOrientation) {
      state.ar.initialOrientation = { heading, pitch };
    } else {
      const headingMotion = Math.abs(signedAngleDifference(heading, state.ar.initialOrientation.heading));
      const pitchMotion = Math.abs(pitch - state.ar.initialOrientation.pitch);
      state.ar.orientationMotionDegrees = Math.max(state.ar.orientationMotionDegrees, headingMotion, pitchMotion);
    }
    const now = performance.now();
    state.ar.orientationHistory.push({ time: now, heading, pitch });
    state.ar.orientationHistory = state.ar.orientationHistory.filter((sample) => now - sample.time <= 1200);
  }
  updateArReadiness();
  renderArOverlay();
}

async function requestOrientation() {
  if (typeof DeviceOrientationEvent === "undefined") return "Orientation sensors are unavailable.";
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    const permission = await DeviceOrientationEvent.requestPermission();
    if (permission !== "granted") return "Orientation permission was not granted; camera view only.";
  }
  if (!state.ar.active) return "AR was closed before orientation initialized.";
  state.ar.orientationPermissionGranted = true;
  window.addEventListener("deviceorientation", handleOrientation, true);
  return "Camera and orientation active.";
}

async function startArCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires HTTPS and a supported browser");
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
  if (!state.ar.active) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  state.ar.stream = stream;
  arVideo.srcObject = stream;
  await arVideo.play();
  state.ar.cameraReady = true;
  updateArReadiness();
  renderArOverlay();
}

async function openArView() {
  state.ar.active = true;
  state.ar.rawHeading = null;
  state.ar.rawPitch = null;
  state.ar.headingOffset = 0;
  state.ar.pitchOffset = 0;
  state.ar.cameraReady = false;
  state.ar.cameraError = null;
  state.ar.orientationPermissionGranted = false;
  state.ar.orientationError = null;
  state.ar.orientationReady = false;
  state.ar.validOrientationCount = 0;
  state.ar.initialOrientation = null;
  state.ar.orientationMotionDegrees = 0;
  state.ar.compassAccuracy = null;
  state.ar.compassWarningActive = false;
  state.ar.readyAnnounced = false;
  state.ar.orientationHistory = [];
  arView.hidden = false;
  createArMarkers();
  arMarkers.hidden = true;
  arOffscreenArrow.hidden = true;
  refreshCalibrationSelect();
  arStatus.textContent = "Requesting orientation and camera access…";

  if (TEST_MODE) {
    state.ar.cameraReady = true;
    state.ar.orientationPermissionGranted = true;
    state.ar.orientationReady = true;
    state.ar.rawHeading = 200;
    state.ar.rawPitch = 25;
    state.ar.validOrientationCount = 10;
    state.ar.orientationMotionDegrees = 5;
    state.ar.orientationHistory = Array.from({ length: 8 }, () => ({ heading: 200, pitch: 25 }));
    arStatus.textContent = "Test mode: simulated camera and orientation are active.";
    arMarkers.hidden = false;
    renderArOverlay();
    return;
  }

  // Start both permission-sensitive operations before awaiting either one so
  // both remain associated with the AR button's user gesture on iOS.
  let orientationMessage = "";
  const cameraTask = startArCamera().catch((error) => { state.ar.cameraError = error.message; });
  const orientationTask = requestOrientation()
    .then((message) => { orientationMessage = message; })
    .catch((error) => { orientationMessage = `Orientation unavailable: ${error.message}`; });
  await Promise.all([cameraTask, orientationTask]);
  if (!state.ar.active) return;
  if (!state.ar.orientationPermissionGranted) state.ar.orientationError = orientationMessage;
  updateArReadiness();
}

function closeArView() {
  state.ar.active = false;
  state.ar.calibrationStep = null;
  state.ar.calibrationSamples = [];
  state.ar.orientationHistory = [];
  state.ar.cameraReady = false;
  state.ar.cameraError = null;
  state.ar.orientationPermissionGranted = false;
  state.ar.orientationError = null;
  state.ar.orientationReady = false;
  arView.classList.remove("calibrating");
  arMainControls.hidden = false;
  arCalibrationSettings.hidden = true;
  arFilterCheck.hidden = true;
  arCalibrationPanel.hidden = true;
  arCalibrationTarget.hidden = true;
  arMarkers.hidden = false;
  window.removeEventListener("deviceorientation", handleOrientation, true);
  if (state.ar.stream) state.ar.stream.getTracks().forEach((track) => track.stop());
  state.ar.stream = null;
  arVideo.srcObject = null;
  arView.hidden = true;
}

function showCalibrationStep() {
  const point = CALIBRATION_POINTS[state.ar.calibrationStep];
  arCalibrationTarget.style.left = `${point.x * 100}%`;
  arCalibrationTarget.style.top = `${point.y * 100}%`;
  arCalibrationInstruction.textContent = `Step ${state.ar.calibrationStep + 1} of ${CALIBRATION_POINTS.length}: place the filtered Sun in the ${point.name}, hold still, then capture.`;
}

function startSunCalibration() {
  const currentSun = TEST_MODE ? { azimuth: 205, elevation: 30 } : sunPositionAt(new Date());
  if (currentSun.elevation <= 1) {
    arStatus.textContent = "The current Sun is too close to or below the horizon for calibration.";
    return;
  }
  if (!state.ar.cameraReady || !state.ar.orientationPermissionGranted || state.ar.rawHeading === null || state.ar.rawPitch === null) {
    arStatus.textContent = "Camera and orientation readings are not available yet. Move the phone gently and try again.";
    return;
  }
  state.ar.calibrationStep = 0;
  state.ar.calibrationSamples = [];
  arView.classList.add("calibrating");
  arMainControls.hidden = true;
  arCalibrationSettings.hidden = true;
  arCalibrationPanel.hidden = false;
  arCalibrationTarget.hidden = false;
  arMarkers.hidden = true;
  arStatus.textContent = `Current Sun: ${currentSun.azimuth.toFixed(1)}° bearing, ${currentSun.elevation.toFixed(1)}° elevation.`;
  showCalibrationStep();
}

function cancelSunCalibration(message = "Calibration cancelled.", returnToSettings = true) {
  state.ar.calibrationStep = null;
  state.ar.calibrationSamples = [];
  arView.classList.remove("calibrating");
  arMainControls.hidden = returnToSettings;
  arCalibrationSettings.hidden = !returnToSettings;
  arCalibrationPanel.hidden = true;
  arCalibrationTarget.hidden = true;
  arMarkers.hidden = false;
  arStatus.textContent = message;
}

function averagedRecentOrientation() {
  const cutoff = performance.now() - 450;
  const recent = state.ar.orientationHistory.filter((sample) => sample.time >= cutoff);
  if (recent.length < 3) return null;
  const sinMean = recent.reduce((sum, sample) => sum + Math.sin(toRadians(sample.heading)), 0) / recent.length;
  const cosMean = recent.reduce((sum, sample) => sum + Math.cos(toRadians(sample.heading)), 0) / recent.length;
  return {
    heading: normalizeAngle(toDegrees(Math.atan2(sinMean, cosMean))),
    pitch: recent.reduce((sum, sample) => sum + sample.pitch, 0) / recent.length,
    readingCount: recent.length,
  };
}

function fitProjection(points, minFov = 20, maxFov = 150) {
  let best = null;
  for (let fov = minFov; fov <= maxFov; fov += 0.05) {
    const projected = points.map((point) => toDegrees(Math.atan(2 * point.screenOffset * Math.tan(toRadians(fov / 2)))));
    const offset = points.reduce((sum, point, index) => sum + point.angle - projected[index], 0) / points.length;
    const residuals = points.map((point, index) => point.angle - offset - projected[index]);
    const squaredError = residuals.reduce((sum, residual) => sum + residual * residual, 0);
    if (!best || squaredError < best.squaredError) best = { fov, offset, residuals, squaredError };
  }
  return best;
}

function finishSunCalibration() {
  const headingPoints = state.ar.calibrationSamples.map((sample) => ({
    screenOffset: sample.point.x - 0.5,
    angle: signedAngleDifference(sample.sun.azimuth, sample.heading),
  }));
  const pitchPoints = state.ar.calibrationSamples.map((sample) => ({
    screenOffset: 0.5 - sample.point.y,
    angle: sample.sun.elevation - sample.pitch,
  }));
  const headingFit = fitProjection(headingPoints, 20, 130);
  const pitchFit = fitProjection(pitchPoints, 20, 150);
  const residuals = [...headingFit.residuals, ...pitchFit.residuals];
  const rmsError = Math.sqrt(residuals.reduce((sum, residual) => sum + residual * residual, 0) / residuals.length);
  const horizontalFov = headingFit.fov;
  const verticalFov = pitchFit.fov;

  const fitAtBoundary = horizontalFov <= 20.1 || horizontalFov >= 129.9 || verticalFov <= 20.1 || verticalFov >= 149.9;
  if (!Number.isFinite(horizontalFov) || !Number.isFinite(verticalFov) || fitAtBoundary || rmsError > 5) {
    cancelSunCalibration("Calibration fit was not reliable. Keep the phone upright, hold each position steady and repeat the sequence.");
    return;
  }

  const track = state.ar.stream?.getVideoTracks()[0];
  const calibration = {
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(Date.now()),
    createdAt: new Date().toISOString(),
    latitude: state.observer.lat,
    longitude: state.observer.lng,
    locationName: state.locationName,
    headingOffset: headingFit.offset,
    pitchOffset: pitchFit.offset,
    horizontalFov,
    verticalFov,
    rmsError,
    cameraLabel: track?.label || "Rear camera",
    cameraSettings: track?.getSettings ? track.getSettings() : {},
  };
  const calibrations = [calibration, ...loadSavedCalibrations()];
  const stored = storeSavedCalibrations(calibrations);
  applyCalibration(calibration);
  refreshCalibrationSelect(calibration.id);
  cancelSunCalibration(`Calibration ${stored ? "saved" : "applied but could not be saved"}: ${horizontalFov.toFixed(1)}° × ${verticalFov.toFixed(1)}° FOV, ${rmsError.toFixed(1)}° fit error.`, false);
}

function captureSunCalibration() {
  const point = CALIBRATION_POINTS[state.ar.calibrationStep];
  const testHorizontalAngle = toDegrees(Math.atan(2 * (point.x - 0.5) * Math.tan(toRadians(52 / 2))));
  const testVerticalAngle = toDegrees(Math.atan(2 * (0.5 - point.y) * Math.tan(toRadians(64 / 2))));
  const orientation = TEST_MODE
    ? { heading: normalizeAngle(205 - testHorizontalAngle - 5), pitch: 30 - testVerticalAngle + 2, readingCount: 8 }
    : averagedRecentOrientation();
  if (!orientation) {
    arStatus.textContent = "Not enough stable sensor readings. Hold still briefly and try again.";
    return;
  }
  const calibrationSun = TEST_MODE ? { azimuth: 205, elevation: 30 } : sunPositionAt(new Date());
  state.ar.calibrationSamples.push({ point, sun: calibrationSun, ...orientation });
  state.ar.calibrationStep += 1;
  if (state.ar.calibrationStep >= CALIBRATION_POINTS.length) finishSunCalibration();
  else showCalibrationStep();
}

function renderSightline() {
  sightlineLayer.clearLayers();
  distanceLayer.clearLayers();

  const origin = [state.observer.lat, state.observer.lng];
  const end = destinationPoint(state.observer, state.azimuth, MAX_DISTANCE_KM);
  const left = destinationPoint(state.observer, state.azimuth - WEDGE_DEGREES, MAX_DISTANCE_KM);
  const right = destinationPoint(state.observer, state.azimuth + WEDGE_DEGREES, MAX_DISTANCE_KM);

  L.polygon([origin, left, right], { color: "#f7a928", weight: 1, opacity: 0.75, fillColor: "#ffcf4a", fillOpacity: 0.18, interactive: false }).addTo(sightlineLayer);
  L.polyline([origin, end], { color: "#fff", weight: 7, opacity: 0.9, interactive: false }).addTo(sightlineLayer);
  L.polyline([origin, end], { color: "#ed7b21", weight: 3, opacity: 1, interactive: false }).addTo(sightlineLayer);

  for (const distanceKm of DISTANCES_KM) {
    L.circle(origin, { radius: distanceKm * 1000, color: "#354e63", weight: 1, opacity: 0.65, fill: false, interactive: false }).addTo(distanceLayer);
    const labelPoint = destinationPoint(state.observer, state.azimuth, distanceKm);
    L.marker(labelPoint, {
      interactive: false,
      icon: L.divIcon({ className: "distance-label", html: `${distanceKm} km`, iconSize: [40, 16], iconAnchor: [20, 8] }),
    }).addTo(distanceLayer);
  }
}

function updateCalculations({ fit = false } = {}) {
  const selectedDate = state.viewingDate;
  if (!(selectedDate instanceof Date) || Number.isNaN(selectedDate.getTime())) return;

  const sun = EclipseWeather.solarPosition(selectedDate, state.observer.lat, state.observer.lng);
  state.azimuth = sun.azimuthDeg;
  state.elevation = sun.elevationDeg;

  azimuthOutput.textContent = `${state.azimuth.toFixed(1)}°`;
  elevationOutput.textContent = `${state.elevation.toFixed(1)}°`;
  directionOutput.textContent = compassPoint(state.azimuth);

  const samples = buildSightlineSamples();
  heightTable.innerHTML = samples.map((sample) => {
    const height = sample.lineOfSightHeightKm;
    const display = height >= 0 ? (height < 1 ? `${Math.round(height * 1000)} m` : `${height.toFixed(1)} km`) : "below horizon";
    return `<div class="height-item"><b>${display}</b><span>${sample.distanceKm} km away</span></div>`;
  }).join("");
  heightNote.textContent = state.elevation > 0
    ? "Height above the observer's local level; use the terrain profile below for ground clearance."
    : "The Sun is below the geometric horizon at this selected time.";

  observerMarker.setLatLng(state.observer);
  renderSightline();
  loadTerrain();
  if (state.ar.active) {
    createArMarkers();
    renderArOverlay();
  }
  if (fit) {
    const end = destinationPoint(state.observer, state.azimuth, MAX_DISTANCE_KM);
    map.fitBounds(L.latLngBounds([[state.observer.lat, state.observer.lng], end]), { padding: [45, 45], maxZoom: 10 });
  }
}

function setObserver(latlng, message, fit = false) {
  state.observer = { lat: latlng.lat, lng: latlng.lng };
  statusOutput.textContent = `${message} ${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
  updateCalculations({ fit });
}

function locateUser(fromGate = false) {
  if (!navigator.geolocation) {
    const message = "This browser does not provide geolocation. Search for a place instead.";
    if (fromGate) gateStatus.textContent = message;
    else statusOutput.textContent = message;
    return;
  }
  if (fromGate) gateStatus.textContent = "Requesting your location…";
  else statusOutput.textContent = "Finding your location…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      activateLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        name: "Current location",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (position.coords.accuracy > 1000) statusOutput.textContent = `Location accuracy is poor (approximately ±${Math.round(position.coords.accuracy / 100) / 10} km). Choose or move the viewing point before relying on the sightline.`;
    },
    () => {
      locationGate.hidden = false;
      gateStatus.textContent = "Location permission was unavailable. Search for a city or place instead.";
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
}

async function searchPlaces(query) {
  const params = new URLSearchParams({ name: query, count: "6", language: navigator.language?.split("-")[0] || "en", format: "json" });
  const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
  if (!response.ok) throw new Error(`Place search returned ${response.status}`);
  const data = await response.json();
  return Array.isArray(data.results) ? data.results : [];
}

function renderPlaceResults(results) {
  placeResults.replaceChildren();
  if (!results.length) {
    gateStatus.textContent = "No matching places found. Try a broader name.";
    return;
  }
  gateStatus.textContent = "Choose the intended place:";
  for (const result of results) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "place-result";
    const title = document.createElement("span");
    title.textContent = result.name;
    const detail = document.createElement("small");
    detail.textContent = [result.admin1, result.country].filter(Boolean).join(", ");
    button.append(title, detail);
    button.addEventListener("click", () => activateLocation({ lat: result.latitude, lng: result.longitude, name: [result.name, result.country_code].filter(Boolean).join(", "), timezone: result.timezone }));
    placeResults.append(button);
  }
}

function prepareLocationGate() {
  try {
    const lastLocation = JSON.parse(localStorage.getItem(LAST_LOCATION_STORAGE_KEY) || "null");
    if (lastLocation && Number.isFinite(lastLocation.lat) && Number.isFinite(lastLocation.lng)) {
      lastLocationChoice = lastLocation;
      lastLocationButton.hidden = false;
      lastLocationButton.textContent = `Use last location: ${lastLocation.name || `${lastLocation.lat.toFixed(3)}, ${lastLocation.lng.toFixed(3)}`}`;
    }
  } catch { /* ignore unavailable or malformed storage */ }
  lastLocationButton.addEventListener("click", () => { if (lastLocationChoice) activateLocation(lastLocationChoice); });
}

function inspectPoint(latlng) {
  const distanceKm = map.distance(state.observer, latlng) / 1000;
  const bearing = initialBearing(state.observer, latlng);
  const heightKm = lineOfSightHeightKm(distanceKm);
  const heightText = heightKm >= 0 ? (heightKm < 1 ? `${Math.round(heightKm * 1000)} m` : `${heightKm.toFixed(2)} km`) : "below horizon";
  const angularOffset = Math.abs((((bearing - state.azimuth) + 540) % 360) - 180);
  const corridorText = angularOffset <= WEDGE_DEGREES ? "Inside the ±4° corridor" : `${angularOffset.toFixed(1)}° from the solar ray`;
  let terrainText = "";
  if (angularOffset <= WEDGE_DEGREES && state.terrainSamples.length) {
    const nearest = state.terrainSamples.reduce((best, sample) => Math.abs(sample.distanceKm - distanceKm) < Math.abs(best.distanceKm - distanceKm) ? sample : best);
    terrainText = `<br>Nearest terrain sample ${Math.round(nearest.terrainElevationM)} m ASL<br>Ray clearance ${Math.round(nearest.clearanceM)} m`;
  }
  L.popup({ className: "inspect-popup" })
    .setLatLng(latlng)
    .setContent(`<strong>${distanceKm.toFixed(1)} km from observer</strong><br>Bearing ${bearing.toFixed(1)}°<br>Solar-line height ${heightText}${terrainText}<br><small>${corridorText}</small>`)
    .openOn(map);
}

document.querySelector("#locate-button").addEventListener("click", () => locateUser(false));
document.querySelector("#gate-locate").addEventListener("click", () => locateUser(true));
document.querySelector("#place-search-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = document.querySelector("#place-search").value.trim();
  if (query.length < 2) {
    gateStatus.textContent = "Enter at least two characters.";
    return;
  }
  gateStatus.textContent = "Searching…";
  placeResults.replaceChildren();
  try {
    renderPlaceResults(await searchPlaces(query));
  } catch (error) {
    gateStatus.textContent = `Place search unavailable: ${error.message}`;
  }
});
document.querySelector("#ar-button").addEventListener("click", openArView);
document.querySelector("#ar-close").addEventListener("click", closeArView);
document.querySelector("#ar-open-calibration").addEventListener("click", () => {
  arMainControls.hidden = true;
  arCalibrationSettings.hidden = false;
});
document.querySelector("#ar-close-calibration").addEventListener("click", () => {
  arCalibrationSettings.hidden = true;
  arMainControls.hidden = false;
});
document.querySelector("#ar-calibrate").addEventListener("click", () => {
  arCalibrationSettings.hidden = true;
  arFilterCheck.hidden = false;
});
document.querySelector("#ar-filter-confirm").addEventListener("click", () => {
  arFilterCheck.hidden = true;
  startSunCalibration();
  if (state.ar.calibrationStep === null) arCalibrationSettings.hidden = false;
});
document.querySelector("#ar-filter-cancel").addEventListener("click", () => {
  arFilterCheck.hidden = true;
  arCalibrationSettings.hidden = false;
});
document.querySelector("#ar-capture-calibration").addEventListener("click", captureSunCalibration);
document.querySelector("#ar-cancel-calibration").addEventListener("click", () => cancelSunCalibration());
document.querySelector("#ar-apply-calibration").addEventListener("click", () => {
  const calibration = loadSavedCalibrations().find((candidate) => candidate.id === arCalibrationSelect.value);
  if (calibration) applyCalibration(calibration);
  else arStatus.textContent = "Choose a saved calibration first.";
});
document.querySelector("#ar-delete-calibration").addEventListener("click", () => {
  const selectedId = arCalibrationSelect.value;
  if (!selectedId) {
    arStatus.textContent = "Choose a saved calibration first.";
    return;
  }
  if (!window.confirm("Delete this saved AR calibration?")) return;
  storeSavedCalibrations(loadSavedCalibrations().filter((calibration) => calibration.id !== selectedId));
  refreshCalibrationSelect();
  arStatus.textContent = "Saved calibration deleted.";
});
arFov.addEventListener("input", () => {
  state.ar.horizontalFov = Number(arFov.value);
  const stageRatio = arView.clientHeight / Math.max(arView.clientWidth, 1);
  state.ar.verticalFov = toDegrees(2 * Math.atan(Math.tan(toRadians(state.ar.horizontalFov / 2)) * stageRatio));
  arFovValue.textContent = `${arFov.value}°`;
  renderArOverlay();
});
document.querySelector("#choose-location-button").addEventListener("click", () => { locationGate.hidden = false; });
document.querySelector("#explore-eclipses").addEventListener("click", openEclipseExplorer);
document.querySelector("#close-explorer").addEventListener("click", () => { eclipseExplorer.hidden = true; });
weatherLayerSelect.addEventListener("change", updateWeatherOverlay);
weatherTimeSelect.addEventListener("change", () => {
  updateWeatherOverlay();
  weatherStatus.textContent = "Map overlay time changed. Site comparison still uses both 18:00 and 19:00 grids.";
});
document.querySelector("#analyze-weather").addEventListener("click", analyzeWeather);
weatherDebugToggle.addEventListener("change", () => {
  state.weather.debug = weatherDebugToggle.checked;
  if (!state.weather.results) return;
  renderWeatherResults(state.weather.results);
  state.weather.digest = buildWeatherDigest(state.weather.results);
  showDigest(state.weather.digestFormat);
});
document.querySelector("#show-json-digest").addEventListener("click", () => showDigest(state.weather.digestFormat === "json" ? "markdown" : "json"));
document.querySelector("#copy-weather-digest").addEventListener("click", async () => {
  const text = weatherDigestText.value;
  try {
    await navigator.clipboard.writeText(text);
    weatherStatus.textContent = `${state.weather.digestFormat === "json" ? "JSON" : "Markdown"} digest copied.`;
  } catch {
    weatherDigestText.focus();
    weatherDigestText.select();
    weatherStatus.textContent = "Clipboard access was unavailable; the digest text is selected for copying.";
  }
});
document.querySelectorAll(".profile-ranges button").forEach((button) => {
  button.addEventListener("click", () => {
    state.profileRangeKm = Number(button.dataset.range);
    document.querySelectorAll(".profile-ranges button").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    if (state.terrainSamples.length) renderTerrainProfile(state.terrainSamples);
  });
});
refreshCalibrationSelect();
prepareLocationGate();
if (TEST_MODE) activateLocation({ lat: 43.5322, lng: -5.6611, name: "Gijón test location", timezone: "Europe/Madrid" });
