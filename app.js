/* global L, SunCalc */

const GIJON = { lat: 43.5322, lng: -5.6611 };
const MAX_DISTANCE_KM = 60;
const WEDGE_DEGREES = 4;
const DISTANCES_KM = [5, 10, 20, 30, 50];
const TERRAIN_SAMPLE_COUNT = 100;
const EARTH_RADIUS_M = 6371008.8;
const EYE_HEIGHT_M = 1.7;

const state = {
  observer: { ...GIJON },
  azimuth: 0,
  elevation: 0,
  settingLocation: false,
  firstLocation: true,
  terrainSamples: [],
  terrainRequest: null,
  profileRangeKm: 5,
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
locateUser();
