/* global L, SunCalc */

const GIJON = { lat: 43.5322, lng: -5.6611 };
const MAX_DISTANCE_KM = 60;
const WEDGE_DEGREES = 4;
const DISTANCES_KM = [5, 10, 20, 30, 50];
const TERRAIN_SAMPLE_COUNT = 100;
const EARTH_RADIUS_M = 6371008.8;
const EYE_HEIGHT_M = 1.7;
const ECLIPSE_PHASES = [
  { label: "Partial begins", time: "2026-08-12T19:30:57+02:00" },
  { label: "Totality 20:26:42–20:28:27", time: "2026-08-12T20:27:35+02:00", displayTime: "maximum 20:27:35", totality: true },
  { label: "Partial ends", time: "2026-08-12T21:20:39+02:00" },
];
const CALIBRATION_STORAGE_KEY = "eclipse-locator-ar-calibrations-v1";
const CALIBRATION_POINTS = [
  { name: "centre", x: 0.5, y: 0.5 },
  { name: "left target", x: 0.2, y: 0.5 },
  { name: "right target", x: 0.8, y: 0.5 },
  { name: "upper target", x: 0.5, y: 0.27 },
  { name: "lower target", x: 0.5, y: 0.63 },
];

const state = {
  observer: { ...GIJON },
  azimuth: 0,
  elevation: 0,
  settingLocation: false,
  firstLocation: true,
  terrainSamples: [],
  terrainRequest: null,
  profileRangeKm: 5,
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
  },
};

const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView(GIJON, 9);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

const observerIcon = L.divIcon({ className: "", html: '<div class="observer-pin"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
const observerMarker = L.marker(GIJON, { icon: observerIcon, draggable: true, zIndexOffset: 1000 }).addTo(map);
const sightlineLayer = L.layerGroup().addTo(map);
const distanceLayer = L.layerGroup().addTo(map);
const terrainLayer = L.layerGroup().addTo(map);

const dateTimeInput = document.querySelector("#date-time");
const azimuthOutput = document.querySelector("#azimuth");
const elevationOutput = document.querySelector("#elevation");
const directionOutput = document.querySelector("#direction");
const heightTable = document.querySelector("#height-table");
const heightNote = document.querySelector("#height-note");
const statusOutput = document.querySelector("#status");
const setLocationButton = document.querySelector("#set-location-button");
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
  const sun = SunCalc.getPosition(date, state.observer.lat, state.observer.lng);
  return {
    azimuth: normalizeAngle(toDegrees(sun.azimuth) + 180),
    elevation: toDegrees(sun.altitude),
  };
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
  arCalibrationSelect.innerHTML = '<option value="">Saved calibrations…</option>' + calibrations.map((calibration) => {
    const date = new Date(calibration.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
    return `<option value="${calibration.id}">${date} · ${calibration.horizontalFov.toFixed(1)}° × ${calibration.verticalFov.toFixed(1)}° · error ${calibration.rmsError.toFixed(1)}°</option>`;
  }).join("");
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
  // Spend 56 of the API's 100 points in the first 5 km: about 91 m apart,
  // matching the source DEM's useful resolution. Space the rest evenly.
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
  const distanceM = distanceKm * 1000;
  const riseM = distanceM * Math.tan(toRadians(state.elevation));
  const curvatureM = distanceM * distanceM / (2 * EARTH_RADIUS_M);
  return observerElevationM + EYE_HEIGHT_M + riseM + curvatureM;
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
  const query = new URLSearchParams({
    latitude: locations.map((point) => point[0].toFixed(6)).join(","),
    longitude: locations.map((point) => point[1].toFixed(6)).join(","),
  });

  try {
    const response = await fetch(`https://api.open-meteo.com/v1/elevation?${query}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`Elevation service returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.elevation) || data.elevation.length !== distances.length) throw new Error("Unexpected elevation response");
    if (state.terrainRequest !== controller) return;

    const observerElevationM = data.elevation[0];
    state.terrainSamples = distances.map((distanceKm, index) => {
      const altitudeM = rayAltitudeM(distanceKm, observerElevationM);
      return {
        distanceKm,
        location: locations[index],
        terrainElevationM: data.elevation[index],
        rayAltitudeM: altitudeM,
        clearanceM: altitudeM - data.elevation[index],
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
  return ECLIPSE_PHASES.map((phase) => ({
    ...phase,
    ...sunPositionAt(new Date(phase.time)),
    timeLabel: phase.displayTime || new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Madrid" }).format(new Date(phase.time)),
  }));
}

function createArMarkers() {
  state.ar.targets = buildArTargets();
  arMarkers.innerHTML = state.ar.targets.map((target, index) => {
    const classes = ["ar-marker", target.totality ? "totality" : ""].filter(Boolean).join(" ");
    return `<div class="${classes}" data-target="${index}"><div class="ar-marker-dot"></div><div class="ar-marker-label"><b>${target.label}</b><small>${target.timeLabel} · ${target.azimuth.toFixed(1)}° / ${target.elevation.toFixed(1)}°</small></div></div>`;
  }).join("");
}

function renderArOverlay() {
  if (!state.ar.active) return;
  if (state.ar.rawHeading === null || state.ar.rawPitch === null) {
    arOffscreenArrow.hidden = true;
    return;
  }

  const heading = normalizeAngle(state.ar.rawHeading + state.ar.headingOffset);
  const pitch = state.ar.rawPitch + state.ar.pitchOffset;
  const horizontalFov = state.ar.horizontalFov;
  const verticalFov = state.ar.verticalFov;
  const screenBounds = { left: 0.08, right: 0.92, top: 0.12, bottom: 0.68 };
  let totalityScreenPosition = null;

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
    if (target.totality) totalityScreenPosition = { x: screenX, y: screenY, visible, bearingDelta, elevationDelta };
  });

  if (!totalityScreenPosition || totalityScreenPosition.visible || state.ar.calibrationStep !== null) {
    arOffscreenArrow.hidden = true;
    return;
  }
  const arrowOrigin = { x: 0.5, y: 0.42 };
  const dx = totalityScreenPosition.bearingDelta / horizontalFov;
  const dy = -totalityScreenPosition.elevationDelta / verticalFov;
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
  if (heading !== null) state.ar.rawHeading = heading;
  if (Number.isFinite(event.beta)) state.ar.rawPitch = event.beta - 90;
  if (state.ar.rawHeading !== null && state.ar.rawPitch !== null) {
    const now = performance.now();
    state.ar.orientationHistory.push({ time: now, heading: state.ar.rawHeading, pitch: state.ar.rawPitch });
    state.ar.orientationHistory = state.ar.orientationHistory.filter((sample) => now - sample.time <= 1200);
  }
  renderArOverlay();
}

async function requestOrientation() {
  if (typeof DeviceOrientationEvent === "undefined") return "Orientation sensors are unavailable.";
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    const permission = await DeviceOrientationEvent.requestPermission();
    if (permission !== "granted") return "Orientation permission was not granted; camera view only.";
  }
  window.addEventListener("deviceorientation", handleOrientation, true);
  return "Camera and orientation active.";
}

async function openArView() {
  state.ar.active = true;
  state.ar.rawHeading = null;
  state.ar.rawPitch = null;
  state.ar.headingOffset = 0;
  state.ar.pitchOffset = 0;
  arView.hidden = false;
  createArMarkers();
  refreshCalibrationSelect();
  arStatus.textContent = "Requesting orientation and camera access…";

  let orientationMessage;
  try {
    orientationMessage = await requestOrientation();
  } catch (error) {
    orientationMessage = `Orientation unavailable: ${error.message}`;
  }

  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access requires HTTPS and a supported browser");
    state.ar.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    arVideo.srcObject = state.ar.stream;
    await arVideo.play();
    arStatus.textContent = orientationMessage;
  } catch (error) {
    arStatus.textContent = `${orientationMessage} Camera unavailable: ${error.message}`;
  }
}

function closeArView() {
  state.ar.active = false;
  state.ar.calibrationStep = null;
  state.ar.calibrationSamples = [];
  state.ar.orientationHistory = [];
  arView.classList.remove("calibrating");
  arMainControls.hidden = false;
  arCalibrationSettings.hidden = true;
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
  const currentSun = sunPositionAt(new Date());
  if (currentSun.elevation <= 1) {
    arStatus.textContent = "The current Sun is too close to or below the horizon for calibration.";
    return;
  }
  if (state.ar.rawHeading === null || state.ar.rawPitch === null) {
    arStatus.textContent = "Orientation has not initialized yet. Move the phone and try again.";
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
  const orientation = averagedRecentOrientation();
  if (!orientation) {
    arStatus.textContent = "Not enough stable sensor readings. Hold still briefly and try again.";
    return;
  }
  const point = CALIBRATION_POINTS[state.ar.calibrationStep];
  state.ar.calibrationSamples.push({ point, sun: sunPositionAt(new Date()), ...orientation });
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
  const selectedDate = new Date(dateTimeInput.value);
  if (Number.isNaN(selectedDate.getTime())) return;

  const sun = SunCalc.getPosition(selectedDate, state.observer.lat, state.observer.lng);
  state.azimuth = (toDegrees(sun.azimuth) + 180 + 360) % 360;
  state.elevation = toDegrees(sun.altitude);

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

function locateUser() {
  if (!navigator.geolocation) {
    setObserver(GIJON, "Geolocation unavailable; using central Gijón.", true);
    return;
  }
  statusOutput.textContent = "Finding your location…";
  navigator.geolocation.getCurrentPosition(
    (position) => setObserver({ lat: position.coords.latitude, lng: position.coords.longitude }, `Using your location (accuracy ±${Math.round(position.coords.accuracy)} m).`, true),
    () => setObserver(GIJON, "Location permission unavailable; using central Gijón.", true),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
  );
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

dateTimeInput.addEventListener("change", () => updateCalculations());
document.querySelector("#locate-button").addEventListener("click", locateUser);
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
document.querySelector("#ar-calibrate").addEventListener("click", startSunCalibration);
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
document.querySelector("#gijon-button").addEventListener("click", () => setObserver(GIJON, "Using central Gijón.", true));
document.querySelectorAll(".profile-ranges button").forEach((button) => {
  button.addEventListener("click", () => {
    state.profileRangeKm = Number(button.dataset.range);
    document.querySelectorAll(".profile-ranges button").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    if (state.terrainSamples.length) renderTerrainProfile(state.terrainSamples);
  });
});
setLocationButton.addEventListener("click", () => {
  state.settingLocation = !state.settingLocation;
  setLocationButton.classList.toggle("active", state.settingLocation);
  setLocationButton.textContent = state.settingLocation ? "Tap a map location…" : "Set observer on map";
  statusOutput.textContent = state.settingLocation ? "Tap the map to place the observer." : "Observer placement cancelled.";
});
observerMarker.on("dragend", (event) => setObserver(event.target.getLatLng(), "Observer moved to"));
map.on("click", (event) => {
  if (state.settingLocation) {
    state.settingLocation = false;
    setLocationButton.classList.remove("active");
    setLocationButton.textContent = "Set observer on map";
    setObserver(event.latlng, "Observer set to");
  } else {
    inspectPoint(event.latlng);
  }
});

updateCalculations({ fit: true });
refreshCalibrationSelect();
locateUser();
