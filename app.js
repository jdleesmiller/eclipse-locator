/* global L, Astronomy */

const WEDGE_DEGREES = 4;
const TERRAIN_SAMPLE_COUNT = 100;
const CALIBRATION_STORAGE_KEY = "eclipse-locator-ar-calibrations-v1";
const LAST_LOCATION_STORAGE_KEY = "eclipse-locator-last-location-v1";
const WEATHER_DIGEST_STORAGE_KEY = "eclipse-locator-weather-digest-v2";
const SAVED_LOCATIONS_STORAGE_KEY = "eclipse-locator-saved-locations-v1";
const INITIAL_URL_PARAMS = new URLSearchParams(window.location.search);
const TEST_MODE = INITIAL_URL_PARAMS.get("test") === "1";
const SPAIN_WEATHER_BOUNDS = { south: 35, north: 44.5, west: -10, east: 4.5 };
const WEATHER_PAST_GRACE_MS = 3 * 3600000;
const WEATHER_FUTURE_HORIZON_MS = 72 * 3600000;
const CALIBRATION_POINTS = [
  { name: "centre", x: 0.5, y: 0.5 },
  { name: "left target", x: 0.2, y: 0.5 },
  { name: "right target", x: 0.8, y: 0.5 },
  { name: "upper target", x: 0.5, y: 0.27 },
  { name: "lower target", x: 0.5, y: 0.63 },
];

const state = {
  observer: null,
  deviceLocation: null,
  deviceLocationAccuracyM: null,
  locationName: "",
  locationTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  eclipse: null,
  viewingDate: null,
  azimuth: 0,
  elevation: 0,
  terrainSamples: [],
  terrainRequest: null,
  profileRangeKm: 5,
  weather: { layer: null, results: null, digest: null, debug: false, indicatorRequest: 0, climateRequest: 0, climateResult: null, profileRequest: 0, profileLoadingId: null, profileAttemptedId: null, profileError: null },
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
    orientationAbsolute: false,
    orientationEventNames: [],
    validOrientationCount: 0,
    initialOrientation: null,
    orientationMotionDegrees: 0,
    compassAccuracy: null,
    compassWarningActive: false,
    readyAnnounced: false,
  },
};

const observerIcon = L.divIcon({ className: "", html: '<div class="observer-pin"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
const placeIcon = L.divIcon({ className: "", html: '<div class="place-pin"></div>', iconSize: [26, 32], iconAnchor: [13, 31] });
let map = null;
let observerMarker = null;
let sightlineLayer = null;
let terrainLayer = null;
let weatherLayer = null;
let lastLocationChoice = null;
let shareStatusTimer = null;
let deferredInstallPrompt = null;

const azimuthOutput = document.querySelector("#azimuth");
const elevationOutput = document.querySelector("#elevation");
const directionOutput = document.querySelector("#direction");
const sightlineTechnical = document.querySelector("#sightline-technical");
const statusOutput = document.querySelector("#status");
const terrainProfile = document.querySelector("#terrain-profile");
const profileCloudKey = document.querySelector("#profile-cloud-key");
const profileCloudCaption = document.querySelector("#profile-cloud-caption");
const profileCloudStrip = document.querySelector("#profile-cloud-strip");
const profileCloudStatus = document.querySelector("#profile-cloud-status");
const loadCloudProfileButton = document.querySelector("#load-cloud-profile");
const sightlineCard = document.querySelector(".sightline-card");
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
const arFilterCheck = document.querySelector("#ar-filter-check");
const arCalibrationUnavailable = document.querySelector("#ar-calibration-unavailable");
const arCalibrationUnavailableReason = document.querySelector("#ar-calibration-unavailable-reason");
const arLocationNote = document.querySelector("#ar-location-note");
const arUseCurrentLocation = document.querySelector("#ar-use-current-location");
const arLocationMessage = document.querySelector("#ar-location-message");
const eclipseExplorer = document.querySelector("#eclipse-explorer");
const installGuide = document.querySelector("#install-guide");
const installInstructions = document.querySelector("#install-instructions");
const locationGate = document.querySelector("#location-gate");
const panel = document.querySelector(".panel");
const gateStatus = document.querySelector("#gate-status");
const gateLocateButton = document.querySelector("#gate-locate");
const placeResults = document.querySelector("#place-results");
const lastLocationButton = document.querySelector("#last-location");
const eventKindOutput = document.querySelector("#event-kind");
const eventSummaryOutput = document.querySelector("#event-summary");
const eventDateOutput = document.querySelector("#event-date");
const eventObscurationOutput = document.querySelector("#event-obscuration");
const eventObscurationFact = document.querySelector("#event-obscuration-fact");
const eventEyebrow = document.querySelector("#event-eyebrow");
const eventTitle = document.querySelector("#event-title");
const arOffscreenLabel = arOffscreenArrow.querySelector("b");
const weatherCard = document.querySelector("#weather-card");
const weatherLayerSelect = document.querySelector("#weather-layer");
const weatherTimeSelect = document.querySelector("#weather-time");
const weatherLayerNote = document.querySelector("#weather-layer-note");
const weatherMapStatus = document.querySelector("#weather-map-status");
const weatherLegend = document.querySelector("#weather-legend");
const cloudResult = document.querySelector("#cloud-result");
const climateCard = document.querySelector("#climate-card");
const climateResult = document.querySelector("#climate-result");
const climateHeadline = document.querySelector("#climate-headline");
const climateSummary = document.querySelector("#climate-summary");
const climateDetailContent = document.querySelector("#climate-detail-content");
const weatherStatus = document.querySelector("#weather-status");
const weatherResults = document.querySelector("#weather-results");
const weatherDigest = document.querySelector("#weather-digest");
const weatherDebugToggle = document.querySelector("#weather-debug");
const savedLocationList = document.querySelector("#saved-location-list");
const savedLocationCount = document.querySelector("#saved-location-count");
const savedLocationsCard = document.querySelector("#saved-locations-card");
const savedComparison = document.querySelector("#saved-comparison");
const shareStatus = document.querySelector("#share-status");
const shareButton = document.querySelector("#share-button");
const shareMenu = document.querySelector("#share-menu");
const copyShareLinkButton = document.querySelector("#copy-share-link");
const systemShareButton = document.querySelector("#system-share");
const arButton = document.querySelector("#ar-button");
const arEntrySafety = document.querySelector("#ar-entry-safety");

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

// W3C Device Orientation appendix A.1: heading/elevation of the vector
// perpendicular to the screen and pointing out through the rear camera.
function cameraOrientation(alpha, beta, gamma) {
  if (![alpha, beta, gamma].every(Number.isFinite)) return null;
  const x = toRadians(beta);
  const y = toRadians(gamma);
  const z = toRadians(alpha);
  const cX = Math.cos(x);
  const cY = Math.cos(y);
  const cZ = Math.cos(z);
  const sX = Math.sin(x);
  const sY = Math.sin(y);
  const sZ = Math.sin(z);
  const vx = -cZ * sY - sZ * sX * cY;
  const vy = -sZ * sY + cZ * sX * cY;
  const vz = -cX * cY;
  return {
    heading: normalizeAngle(toDegrees(Math.atan2(vx, vy))),
    pitch: toDegrees(Math.asin(Math.max(-1, Math.min(1, vz)))),
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function eclipseStorageKey(eclipse = state.eclipse) {
  return eclipse ? eventDate(eclipse.peak).toISOString().slice(0, 10) : "";
}

function locationId(location) {
  return `${Number(location.lat).toFixed(5)},${Number(location.lng).toFixed(5)}`;
}

function loadSavedLocationGroups() {
  try {
    const groups = JSON.parse(localStorage.getItem(SAVED_LOCATIONS_STORAGE_KEY) || "{}");
    return groups && typeof groups === "object" && !Array.isArray(groups) ? groups : {};
  } catch {
    return {};
  }
}

function savedLocationsForCurrentEclipse() {
  const locations = loadSavedLocationGroups()[eclipseStorageKey()];
  return Array.isArray(locations) ? locations : [];
}

function storeSavedLocationGroup(key, locations) {
  if (!key) return;
  const groups = loadSavedLocationGroups();
  if (locations.length) groups[key] = locations.slice(0, 30);
  else delete groups[key];
  try { localStorage.setItem(SAVED_LOCATIONS_STORAGE_KEY, JSON.stringify(groups)); } catch { /* optional local feature */ }
}

function storeSavedLocationsForCurrentEclipse(locations) {
  storeSavedLocationGroup(eclipseStorageKey(), locations);
}

function savedCurrentLocation() {
  if (!state.observer || !state.eclipse) return null;
  const id = locationId(state.observer);
  return savedLocationsForCurrentEclipse().find((location) => location.id === id) || null;
}

function updateUrlState() {
  if (!state.observer || !state.eclipse) return;
  const params = new URLSearchParams();
  for (const key of ["test", "weatherProxy"]) if (INITIAL_URL_PARAMS.has(key)) params.set(key, INITIAL_URL_PARAMS.get(key));
  params.set("lat", state.observer.lat.toFixed(6));
  params.set("lng", state.observer.lng.toFixed(6));
  params.set("name", state.locationName);
  params.set("tz", state.locationTimezone);
  params.set("eclipse", eventDate(state.eclipse.peak).toISOString());
  const note = savedCurrentLocation()?.notes?.trim();
  if (note) params.set("note", note);
  history.replaceState({ view: locationGate.hidden ? "map" : "gate" }, "", `${window.location.pathname}?${params}${window.location.hash}`);
}

function observerMatchesDevice() {
  if (!state.observer || !state.deviceLocation) return false;
  if (Number.isFinite(state.deviceLocationAccuracyM) && state.deviceLocationAccuracyM > 2000) return false;
  const distanceM = L.latLng(state.observer).distanceTo(L.latLng(state.deviceLocation));
  const toleranceM = Math.max(250, Math.min(1500, (state.deviceLocationAccuracyM || 100) * 2));
  return distanceM <= toleranceM;
}

function refreshObserverContext() {
  const matches = observerMatchesDevice();
  if (observerMarker) observerMarker.setIcon(matches ? observerIcon : placeIcon);
  arButton.hidden = !matches;
  arEntrySafety.hidden = !matches;
  arLocationNote.hidden = matches;
  if (!matches) {
    const canUseCurrentLocation = !state.deviceLocation;
    arUseCurrentLocation.hidden = !canUseCurrentLocation;
    arLocationMessage.textContent = state.deviceLocation && state.deviceLocationAccuracyM > 2000
      ? "Camera view is hidden because your current-location fix is not accurate enough."
      : state.deviceLocation
        ? "Camera view is hidden because this viewing point differs from your current location."
        : " to enable the camera view for this viewing point.";
  }
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
  observerMarker = L.marker(state.observer, { icon: placeIcon, draggable: true, zIndexOffset: 1000 }).addTo(map);
  sightlineLayer = L.layerGroup().addTo(map);
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

function formatUtcHour(iso) {
  return new Date(iso).toISOString().slice(11, 16);
}

function inSpainWeatherBounds(location) {
  return location && location.lat >= SPAIN_WEATHER_BOUNDS.south && location.lat <= SPAIN_WEATHER_BOUNDS.north
    && location.lng >= SPAIN_WEATHER_BOUNDS.west && location.lng <= SPAIN_WEATHER_BOUNDS.east;
}

function rememberCurrentLocation(seedNote) {
  if (!state.observer || !state.eclipse) return;
  const locations = savedLocationsForCurrentEclipse();
  const id = locationId(state.observer);
  const existingIndex = locations.findIndex((location) => location.id === id);
  const existing = existingIndex >= 0 ? locations[existingIndex] : null;
  const location = {
    id,
    name: state.locationName,
    lat: state.observer.lat,
    lng: state.observer.lng,
    timezone: state.locationTimezone,
    eclipsePeak: eventDate(state.eclipse.peak).toISOString(),
    notes: seedNote !== undefined ? seedNote : existing?.notes || "",
    updatedAt: new Date().toISOString(),
  };
  if (existingIndex >= 0) locations.splice(existingIndex, 1, location);
  else locations.unshift(location);
  storeSavedLocationsForCurrentEclipse(locations);
  renderSavedLocations();
  state.weather.results = null;
  state.weather.digest = null;
  weatherResults.replaceChildren();
  weatherDigest.hidden = true;
  updateUrlState();
}

function inferredEclipsePeak(groupKey, location) {
  return location.eclipsePeak || `${groupKey}T12:00:00.000Z`;
}

function compareSavedGroup(groupKey, locations) {
  const anchor = locations.find(inSpainWeatherBounds) || locations[0];
  if (!anchor) return;
  activateLocation(anchor, { eclipsePeak: inferredEclipsePeak(groupKey, anchor), keepGate: true });
  savedComparison.hidden = false;
  analyzeWeather();
}

function renderSavedLocations() {
  const groups = loadSavedLocationGroups();
  const entries = Object.entries(groups)
    .filter(([, locations]) => Array.isArray(locations) && locations.length)
    .sort(([a], [b]) => a.localeCompare(b));
  const total = entries.reduce((sum, [, locations]) => sum + locations.length, 0);
  savedLocationsCard.hidden = total === 0;
  lastLocationButton.hidden = total > 0 || !lastLocationChoice;
  savedLocationCount.textContent = `${total} place${total === 1 ? "" : "s"}`;
  savedLocationList.replaceChildren();
  for (const [groupKey, locations] of entries) {
    const group = document.createElement("section");
    group.className = "saved-eclipse-group";
    const groupHeading = document.createElement("div");
    groupHeading.className = "saved-eclipse-heading";
    const groupTitle = document.createElement("strong");
    groupTitle.textContent = new Date(`${groupKey}T12:00:00Z`).toLocaleDateString([], { dateStyle: "long" });
    const compareButton = document.createElement("button");
    compareButton.type = "button";
    compareButton.className = "secondary";
    compareButton.textContent = "Compare places";
    compareButton.addEventListener("click", () => compareSavedGroup(groupKey, locations));
    groupHeading.append(groupTitle, compareButton);
    group.append(groupHeading);

    for (const location of locations) {
      const item = document.createElement("article");
      item.className = "saved-location";
      const header = document.createElement("div");
      header.className = "saved-location-header";
      const openLocation = () => {
        const comparisonResults = state.weather.results;
        activateLocation(location, { eclipsePeak: inferredEclipsePeak(groupKey, location) });
        state.weather.results = comparisonResults;
      };
      const nameButton = document.createElement("button");
      nameButton.type = "button";
      nameButton.className = "saved-location-open";
      nameButton.textContent = location.name;
      nameButton.addEventListener("click", openLocation);
      const nameInput = document.createElement("input");
      nameInput.className = "saved-location-name";
      nameInput.value = location.name;
      nameInput.setAttribute("aria-label", "Viewing location name");
      nameInput.hidden = true;
      const finishNameEdit = (save = true) => {
        if (nameInput.hidden) return;
        const latest = loadSavedLocationGroups()[groupKey] || [];
        const match = latest.find((candidate) => candidate.id === location.id);
        if (!match) return;
        match.name = save ? (nameInput.value.trim() || `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`) : location.name;
        nameInput.value = match.name;
        location.name = match.name;
        nameButton.textContent = match.name;
        match.updatedAt = new Date().toISOString();
        storeSavedLocationGroup(groupKey, latest);
        nameInput.hidden = true;
        nameButton.hidden = false;
        if (groupKey === eclipseStorageKey() && state.observer && location.id === locationId(state.observer)) {
          state.locationName = match.name;
          eventTitle.textContent = match.name;
          eventSummaryOutput.textContent = match.name;
          updateUrlState();
        }
      };
      nameInput.addEventListener("blur", () => finishNameEdit(true));
      nameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") nameInput.blur();
        if (event.key === "Escape") finishNameEdit(false);
      });
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "secondary saved-location-icon";
      editButton.textContent = "✎";
      editButton.setAttribute("aria-label", `Rename ${location.name}`);
      editButton.addEventListener("click", () => {
        nameButton.hidden = true;
        nameInput.hidden = false;
        nameInput.focus();
        nameInput.select();
      });
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "secondary saved-location-icon";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `Remove ${location.name}`);
      removeButton.addEventListener("click", () => {
        storeSavedLocationGroup(groupKey, locations.filter((candidate) => candidate.id !== location.id));
        renderSavedLocations();
        if (groupKey === eclipseStorageKey() && state.observer && location.id === locationId(state.observer)) updateUrlState();
        state.weather.results = null;
        weatherResults.replaceChildren();
        weatherDigest.hidden = true;
      });
      const nameCell = document.createElement("div");
      nameCell.className = "saved-location-name-cell";
      nameCell.append(nameButton, nameInput);
      header.append(nameCell, editButton, removeButton);
      const notesDetails = document.createElement("details");
      notesDetails.className = "saved-location-notes";
      const notesSummary = document.createElement("summary");
      notesSummary.textContent = location.notes ? "Edit notes" : "Add notes";
      const notes = document.createElement("textarea");
      notes.placeholder = "Access, transport, facilities…";
      notes.setAttribute("aria-label", `Notes for ${location.name}`);
      notes.value = location.notes || "";
      notes.addEventListener("change", () => {
        const latest = loadSavedLocationGroups()[groupKey] || [];
        const match = latest.find((candidate) => candidate.id === location.id);
        if (!match) return;
        match.notes = notes.value.trim();
        location.notes = match.notes;
        match.updatedAt = new Date().toISOString();
        storeSavedLocationGroup(groupKey, latest);
        notesSummary.textContent = match.notes ? "Edit notes" : "Add notes";
        if (groupKey === eclipseStorageKey() && state.observer && location.id === locationId(state.observer)) updateUrlState();
      });
      notesDetails.append(notesSummary, notes);
      const coordinates = document.createElement("small");
      coordinates.textContent = `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`;
      item.append(header, notesDetails, coordinates);
      group.append(item);
    }
    savedLocationList.append(group);
  }
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
  const phases = [{ label: "Partial begins", date: eventDate(eclipse.partial_begin), iconSide: -1, visualObscuration: 0.38 }];
  if (kind === "partial") {
    phases.push({ label: "Maximum eclipse", date: eventDate(eclipse.peak), primary: true, iconSide: 1, visualObscuration: eclipse.obscuration });
  } else {
    const phaseName = kind === "total" ? "Totality" : "Annularity";
    phases.push({
      label: phaseName,
      date: eventDate(eclipse.peak),
      primary: true,
      iconSide: 1,
      visualObscuration: eclipse.obscuration,
    });
  }
  phases.push({ label: "Partial ends", date: eventDate(eclipse.partial_end), iconSide: 1, visualObscuration: 0.38 });
  return phases;
}

function eclipseIconSvg(obscuration, side, className, clipId = "") {
  const shift = (1 - Math.max(0, Math.min(1, obscuration))) * 19 * side;
  const moonX = 16 + shift;
  const clip = clipId ? `<defs><clipPath id="${clipId}"><circle cx="16" cy="16" r="12"/></clipPath></defs>` : "";
  const clipAttribute = clipId ? ` clip-path="url(#${clipId})"` : "";
  return `<svg class="${className}" viewBox="0 0 32 32" aria-hidden="true">${clip}<circle class="eclipse-sun-disc" cx="16" cy="16" r="12"/><circle class="eclipse-moon-disc" cx="${moonX.toFixed(1)}" cy="16" r="12"${clipAttribute}/><circle class="eclipse-disc-outline" cx="16" cy="16" r="13.5"/></svg>`;
}

function renderPhaseTechnical() {
  if (!state.eclipse) return;
  const kind = eclipseKindName(state.eclipse.kind);
  const phases = [
    { label: "Partial begins", date: eventDate(state.eclipse.partial_begin) },
    ...(kind !== "partial" ? [{ label: kind === "total" ? "Totality begins" : "Annularity begins", date: eventDate(state.eclipse.total_begin) }] : []),
    { label: "Maximum", date: eventDate(state.eclipse.peak) },
    ...(kind !== "partial" ? [{ label: kind === "total" ? "Totality ends" : "Annularity ends", date: eventDate(state.eclipse.total_end) }] : []),
    { label: "Partial ends", date: eventDate(state.eclipse.partial_end) },
  ];
  document.querySelector("#phase-technical").innerHTML = phases.map((phase) => {
    const sun = sunPositionAt(phase.date);
    return `<div><span>${phase.label}</span><b>${formatLocationTime(phase.date, false, true)}</b><small>${sun.azimuth.toFixed(1)}° bearing · ${sun.elevation.toFixed(1)}° elevation</small></div>`;
  }).join("");
}

function formatDistanceKm(distanceKm) {
  return Number(distanceKm.toFixed(1)).toString();
}

function updateProfileRanges() {
  if (!Number.isFinite(state.elevation)) return;
  const maxDistanceKm = EclipseWeather.cloudSightlineGeometry(state.elevation).maxDistanceKm;
  const proposed = maxDistanceKm <= 5 ? [maxDistanceKm]
    : maxDistanceKm <= 20 ? [5, Math.min(10, maxDistanceKm), maxDistanceKm]
      : [5, 20, maxDistanceKm];
  const ranges = [...new Set(proposed.map((value) => Number(value.toFixed(1))))];
  if (!ranges.includes(state.profileRangeKm)) state.profileRangeKm = ranges[0];
  const buttons = [...document.querySelectorAll(".profile-ranges button")];
  buttons.forEach((button, index) => {
    const range = ranges[index];
    button.hidden = range === undefined;
    if (range === undefined) return;
    button.dataset.range = String(range);
    button.textContent = index === ranges.length - 1 ? `Full sightline · ${formatDistanceKm(range)} km` : index === 0 ? `First ${formatDistanceKm(range)} km` : `${formatDistanceKm(range)} km`;
    button.classList.toggle("active", range === state.profileRangeKm);
  });
  document.querySelector(".profile-ranges").style.gridTemplateColumns = `repeat(${ranges.length}, 1fr)`;
}

function renderSightlineTechnical() {
  if (!state.observer || !Number.isFinite(state.elevation)) return;
  const geometry = EclipseWeather.cloudSightlineGeometry(state.elevation);
  const layers = geometry.layers;
  const currentId = locationId(state.observer);
  const forecast = state.weather.results?.find((candidate) => candidate.id === currentId)?.weather?.target;
  const climate = state.weather.climateResult;
  const cloudRow = weatherApplies()
    ? forecast
      ? `<div><span>Forecast cloud by layer</span><b>${forecast.layers.low.wedgeMean} / ${forecast.layers.middle.wedgeMean} / ${forecast.layers.high.wedgeMean}%</b><small>Low / middle / high means along their corresponding sightline segments.</small></div>`
      : `<div><span>Forecast cloud by layer</span><b>Not loaded</b><small>Open Sightline profile to load numeric low/middle/high corridor values.</small></div>`
    : climate
      ? `<div><span>Historical cloud at ERA5 cell</span><b>${climate.medianLowCloudPct} / ${climate.medianMidCloudPct} / ${climate.medianHighCloudPct}%</b><small>Median low / middle / high cloud; clear or nearly clear on ${climate.clearOrNearlyClearPct}% of comparable occasions.</small></div>`
      : `<div><span>Historical cloud</span><b>Loading…</b><small>ERA5 eclipse-time climatology for this location.</small></div>`;
  sightlineTechnical.innerHTML = `<div><span>Cloud sightline reach</span><b>${formatDistanceKm(geometry.maxDistanceKm)} km</b><small>Curvature-aware distance to the nominal 15 km high-cloud top at ${state.elevation.toFixed(1)}° solar elevation.</small></div>
    <div><span>Layer ground ranges</span><b>0–${formatDistanceKm(layers.low.toKm)} / ${formatDistanceKm(layers.middle.fromKm)}–${formatDistanceKm(layers.middle.toKm)} / ${formatDistanceKm(layers.high.fromKm)}–${formatDistanceKm(layers.high.toKm)} km</b><small>Low 0–3 km / middle 3–8 km / high 8–15 km altitude layers.</small></div>
    ${cloudRow}`;
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
  eventObscurationFact.hidden = kind === "total";
  eventObscurationFact.parentElement.classList.toggle("total", kind === "total");
  eventSummaryOutput.textContent = state.locationName;
  eventEyebrow.textContent = "ECLIPSE LOCATOR";
  eventTitle.textContent = state.locationName;
  arOffscreenLabel.textContent = kind === "partial" ? "Maximum eclipse" : kind === "total" ? "Totality" : "Annularity";
  renderPhaseTechnical();
  updateCalculations({ fit });
  updateWeatherTimeOptions();
  refreshWeatherAvailability();
  rememberCurrentLocation();
}

function weatherTimeApplies() {
  if (!(state.viewingDate instanceof Date)) return false;
  if (TEST_MODE) return true;
  const delta = state.viewingDate.getTime() - Date.now();
  return delta >= -WEATHER_PAST_GRACE_MS && delta <= WEATHER_FUTURE_HORIZON_MS;
}

function weatherApplies() {
  return inSpainWeatherBounds(state.observer) && weatherTimeApplies();
}

function updateWeatherTimeOptions() {
  if (!(state.viewingDate instanceof Date)) return;
  const windowTimes = EclipseWeather.forecastWindow(state.viewingDate);
  const before = new Date(windowTimes.before);
  const options = Array.from({ length: 5 }, (_, index) => new Date(before.getTime() + (index - 1) * 3600000));
  weatherTimeSelect.replaceChildren(...options.map((date) => {
    const option = document.createElement("option");
    option.value = date.toISOString();
    option.textContent = `${formatUtcHour(option.value)} UTC · ${formatLocationTime(date)}`;
    option.selected = date.toISOString() === windowTimes.before;
    return option;
  }));
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
  weatherLayerNote.textContent = `${labels[kind]} Valid ${formatUtcHour(validTime)} UTC (${formatLocationTime(new Date(validTime))} locally), ${Math.abs(minutesFromEclipse)} minutes ${minutesFromEclipse >= 0 ? "before" : "after"} maximum.`;
  weatherLegend.hidden = kind === "none";
  weatherLegend.classList.toggle("base", kind === "base");
  const legendLabels = kind === "base" ? ["Low", "", "", "", "High"] : ["0%", "25%", "50%", "75%", "100%"];
  weatherLegend.querySelectorAll(".weather-legend-labels span").forEach((label, index) => { label.textContent = legendLabels[index]; });
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

async function updateCloudIndicator() {
  const request = ++state.weather.indicatorRequest;
  cloudResult.className = "result-badge";
  cloudResult.textContent = "Checking…";
  const times = EclipseWeather.forecastWindow(state.viewingDate);
  const point = [{ lat: state.observer.lat, lng: state.observer.lng }];
  try {
    const [before, after] = await Promise.all([
      EclipseWeather.pointValues(["low"], point, times.before),
      EclipseWeather.pointValues(["low"], point, times.after),
    ]);
    if (request !== state.weather.indicatorRequest) return;
    const lowCloudPct = Math.round(before.low[0] + (after.low[0] - before.low[0]) * times.fractionAfter);
    const classification = lowCloudPct <= 25 ? "clear" : lowCloudPct <= 60 ? "concerning" : "blocked";
    const label = classification === "clear" ? "OK" : classification === "concerning" ? "Mixed" : "Cloudy";
    cloudResult.className = `result-badge ${classification}`;
    cloudResult.textContent = `${label} · ${lowCloudPct}% low`;
  } catch {
    if (request !== state.weather.indicatorRequest) return;
    cloudResult.className = "result-badge";
    cloudResult.textContent = "Unavailable";
  }
}

function renderClimateIndicator(climatology) {
  const classification = climatology.clearOrNearlyClearPct >= 60 ? "clear" : climatology.clearOrNearlyClearPct >= 30 ? "concerning" : "blocked";
  const label = EclipseWeather.climatologyRating(climatology.clearOrNearlyClearPct);
  climateResult.className = `result-badge ${classification}`;
  climateResult.textContent = `${label[0].toUpperCase()}${label.slice(1)} · ${climatology.clearOrNearlyClearPct}%`;
  climateHeadline.innerHTML = `Clear or nearly clear on <strong>${climatology.clearOrNearlyClearPct}%</strong> of comparable occasions in the recent planning period.`;
  climateSummary.textContent = `${climatology.period.startYear}–${climatology.period.endYear} planning period · ±${climatology.dateWindowDays} days · eclipse-time hour · ${climatology.sampleCount} samples`;
  climateDetailContent.innerHTML = `<div class="climate-detail-grid">
    <span>Recent planning period (${climatology.period.startYear}–${climatology.period.endYear})</span><b>${climatology.clearOrNearlyClearPct}% clear or nearly clear</b>
    <span>WMO standard normal (${climatology.standardNormal?.period?.startYear ?? 1991}–${climatology.standardNormal?.period?.endYear ?? 2020})</span><b>${climatology.standardNormal?.clearOrNearlyClearPct ?? "—"}% clear or nearly clear</b>
    <span>Few clouds or better (≤${climatology.clearOrFewCloudsThresholdPct}% cloud)</span><b>${climatology.clearOrFewCloudsPct}%</b>
    <span>More than one okta of cloud</span><b>${climatology.moreThanOneOktaPct}%</b>
    <span>Median total cloud</span><b>${climatology.medianCloudCoverPct}%</b>
    <span>Total-cloud middle 50%</span><b>${climatology.cloudCoverP25Pct}–${climatology.cloudCoverP75Pct}%</b>
    <span>Median low / middle / high cloud</span><b>${climatology.medianLowCloudPct} / ${climatology.medianMidCloudPct} / ${climatology.medianHighCloudPct}%</b>
  </div><p>“Clear or nearly clear” means ERA5 total cloud cover was no more than one okta (⅛ of the sky, ${climatology.clearOrNearlyClearThresholdPct}%). Cloud may not be uniformly distributed within the grid cell, so this is historical context rather than a probability that the Sun will be unobscured. ERA5 grid resolution is approximately 25 km.</p>`;
  renderSightlineTechnical();
}

async function updateClimateIndicator() {
  const request = ++state.weather.climateRequest;
  climateResult.className = "result-badge";
  climateResult.textContent = "Checking…";
  climateHeadline.textContent = "Loading comparable historical conditions…";
  climateSummary.textContent = "";
  climateDetailContent.replaceChildren();
  state.weather.climateResult = null;
  renderSightlineTechnical();
  try {
    const id = locationId(state.observer);
    const [result] = await EclipseWeather.climatologyCandidates([{ id, lat: state.observer.lat, lng: state.observer.lng }], state.viewingDate);
    if (request !== state.weather.climateRequest) return;
    state.weather.climateResult = result.climatology;
    renderClimateIndicator(result.climatology);
  } catch (error) {
    if (request !== state.weather.climateRequest) return;
    climateResult.className = "result-badge";
    climateResult.textContent = "Unavailable";
    climateHeadline.textContent = "Historical cloud conditions could not be loaded.";
    climateSummary.textContent = error.message;
  }
}

function refreshWeatherAvailability() {
  weatherCard.hidden = !weatherApplies();
  climateCard.hidden = weatherApplies();
  if (weatherApplies()) {
    updateWeatherOverlay();
    updateCloudIndicator();
  }
  else {
    if (!weatherApplies()) updateClimateIndicator();
    if (weatherLayer && map) {
      map.removeLayer(weatherLayer);
      weatherLayer = null;
    }
  }
}

function renderWeatherResults(results) {
  weatherResults.replaceChildren();
  for (const result of results) {
    const item = document.createElement("article");
    item.className = "weather-result";
    const terrain = result.terrain;
    const trend = result.trend.classification;
    const trendLabel = trend === "unavailable" ? "no previous digest" : trend;
    const placeLabel = result.name;
    const safePlaceLabel = escapeHtml(placeLabel);
    const notesDetail = result.notes ? `<details class="site-access-detail"><summary>Location notes</summary><p>${escapeHtml(result.notes)}</p></details>` : "";
    if (result.weather) {
      const target = result.weather.target;
      const times = result.weather.times;
      const targetLabel = `${formatUtcHour(times.target)} estimate`;
      const beforeLabel = formatUtcHour(times.before);
      const afterLabel = formatUtcHour(times.after);
      item.innerHTML = `<button class="weather-result-main" type="button"><strong>${safePlaceLabel}</strong><b class="weather-score">${result.overall.recommendation}</b><span>${result.weatherRating} weather (${result.score}/100) · ${terrain.classification} terrain · ${trendLabel}</span></button>
      <small><b>${targetLabel}:</b> low / middle / high sightline cloud ${target.layers.low.wedgeMean}/${target.layers.middle.wedgeMean}/${target.layers.high.wedgeMean}% · sampled to ${result.weather.geometry.maxDistanceKm} km<br><b>Terrain:</b> ±0.5° horizon ${terrain.within05DegMaxAngleDeg}° at ${terrain.within05DegMaxDistanceKm} km · Sun ${terrain.sunElevationDeg}° · clearance ${terrain.clearanceDeg >= 0 ? "+" : ""}${terrain.clearanceDeg}°</small>
      ${notesDetail}
      <details><summary>Hourly and wedge details</summary><div class="weather-detail-grid">
        <span></span><b>${beforeLabel}</b><b>${formatUtcHour(times.target)}*</b><b>${afterLabel}</b>
        <span>Low here</span><span>${result.weather.before.lowCloudAtObserverPct}%</span><span>${target.lowCloudAtObserverPct}%</span><span>${result.weather.after.lowCloudAtObserverPct}%</span>
        <span>Low 10 km wedge</span><span>${result.weather.before.low.km10.wedgeMean}%</span><span>${target.low.km10.wedgeMean}%</span><span>${result.weather.after.low.km10.wedgeMean}%</span>
        <span>Low 25 km wedge</span><span>${result.weather.before.low.km25.wedgeMean}%</span><span>${target.low.km25.wedgeMean}%</span><span>${result.weather.after.low.km25.wedgeMean}%</span>
        <span>Low 50 km wedge</span><span>${result.weather.before.low.km50.wedgeMean}%</span><span>${target.low.km50.wedgeMean}%</span><span>${result.weather.after.low.km50.wedgeMean}%</span>
      </div><p><b>Curvature-aware cloud layers</b><br>Low 0–3 km altitude: ${target.layers.low.wedgeMean}% mean over 0–${target.layers.low.toKm} km.<br>Middle 3–8 km altitude: ${target.layers.middle.wedgeMean}% mean over ${target.layers.middle.fromKm}–${target.layers.middle.toKm} km.<br>High 8–15 km altitude: ${target.layers.high.wedgeMean}% mean over ${target.layers.high.fromKm}–${target.layers.high.toKm} km.</p><p><b>Terrain horizons</b> centre ${terrain.centreRayHorizonDeg}° · ±0.25° max ${terrain.within025DegMaxAngleDeg}° · ±0.5° max ${terrain.within05DegMaxAngleDeg}° (used for classification) · ±5° max ${terrain.contextWedgeMaxAngleDeg}° (context only).</p><p>* Linear interpolation; not an AEMET model output time.</p></details>
      <details class="weather-debug-detail" ${state.weather.debug ? "" : "hidden"}><summary>Debug samples (${result.debug.samples.length} cloud / ${terrain.debugSamples.length} terrain)</summary><pre>${state.weather.debug ? JSON.stringify({ cloud: result.debug.samples, terrain: terrain.debugSamples }, null, 2) : ""}</pre></details>`;
    } else if (result.climatology) {
      const climate = result.climatology;
      item.classList.add("climatology-result");
      item.innerHTML = `<button class="weather-result-main" type="button"><strong>${safePlaceLabel}</strong><b class="weather-score">${result.overall.recommendation}</b><span>${result.climateRating} historical outlook (${climate.clearOrNearlyClearPct}% clear or nearly clear) · ${terrain.classification} terrain</span></button>
        <small><b>Historical outlook:</b> clear or nearly clear on ${climate.clearOrNearlyClearPct}% of comparable occasions · more than one okta ${climate.moreThanOneOktaPct}%<br><b>Terrain:</b> ±0.5° horizon ${terrain.within05DegMaxAngleDeg}° at ${terrain.within05DegMaxDistanceKm} km · Sun ${terrain.sunElevationDeg}° · clearance ${terrain.clearanceDeg >= 0 ? "+" : ""}${terrain.clearanceDeg}°</small>
        ${notesDetail}
        <details><summary>Historical cloud details</summary><p>${climate.period.startYear}–${climate.period.endYear} · ±${climate.dateWindowDays} days · eclipse-time hour · ${climate.sampleCount} samples.</p><p><b>Clear or nearly clear (≤${climate.clearOrNearlyClearThresholdPct}% cloud)</b> ${climate.clearOrNearlyClearPct}%. <b>Few clouds or better (≤${climate.clearOrFewCloudsThresholdPct}% cloud)</b> ${climate.clearOrFewCloudsPct}%.</p><p><b>Total cloud</b> median ${climate.medianCloudCoverPct}%, middle 50% ${climate.cloudCoverP25Pct}–${climate.cloudCoverP75Pct}%. <b>Median low / middle / high cloud</b> ${climate.medianLowCloudPct}/${climate.medianMidCloudPct}/${climate.medianHighCloudPct}%.</p><p><b>1991–2020 standard normal:</b> ${climate.standardNormal?.clearOrNearlyClearPct ?? "—"}% clear or nearly clear (${climate.standardNormal?.sampleCount ?? "—"} samples).</p><p>The headline threshold is the WMO one-okta boundary. Historical context is not a forecast or a direct probability that the Sun will be unobscured.</p><p><b>Terrain horizons</b> centre ${terrain.centreRayHorizonDeg}° · ±0.25° max ${terrain.within025DegMaxAngleDeg}° · ±0.5° max ${terrain.within05DegMaxAngleDeg}° (used for classification) · ±5° max ${terrain.contextWedgeMaxAngleDeg}° (context only).</p></details>
        <details class="weather-debug-detail" ${state.weather.debug ? "" : "hidden"}><summary>Debug samples (${terrain.debugSamples.length} terrain)</summary><pre>${state.weather.debug ? JSON.stringify({ climatology: climate, terrain: terrain.debugSamples }, null, 2) : ""}</pre></details>`;
    } else {
      item.classList.add("terrain-only-result");
      item.innerHTML = `<button class="weather-result-main" type="button"><strong>${safePlaceLabel}</strong><b class="weather-score">${result.overall.recommendation}</b><span>cloud unavailable · ${terrain.classification} terrain</span></button>
        <small><b>Cloud:</b> ${escapeHtml(result.cloudUnavailableReason)}<br><b>Terrain:</b> ±0.5° horizon ${terrain.within05DegMaxAngleDeg}° at ${terrain.within05DegMaxDistanceKm} km · Sun ${terrain.sunElevationDeg}° · clearance ${terrain.clearanceDeg >= 0 ? "+" : ""}${terrain.clearanceDeg}°</small>
        ${notesDetail}
        <details><summary>Terrain details</summary><p><b>Terrain horizons</b> centre ${terrain.centreRayHorizonDeg}° · ±0.25° max ${terrain.within025DegMaxAngleDeg}° · ±0.5° max ${terrain.within05DegMaxAngleDeg}° (used for classification) · ±5° max ${terrain.contextWedgeMaxAngleDeg}° (context only).</p></details>
        <details class="weather-debug-detail" ${state.weather.debug ? "" : "hidden"}><summary>Debug samples (${terrain.debugSamples.length} terrain)</summary><pre>${state.weather.debug ? JSON.stringify({ terrain: terrain.debugSamples }, null, 2) : ""}</pre></details>`;
    }
    item.querySelector(".weather-result-main").addEventListener("click", () => {
      const comparisonResults = state.weather.results;
      activateLocation(result, { eclipsePeak: result.weather?.times.target || result.eclipsePeak || state.viewingDate.toISOString() });
      state.weather.results = comparisonResults;
    });
    weatherResults.append(item);
  }
}

async function copyWeatherDigest(format) {
  if (!state.weather.digest) return;
  const text = format === "json" ? JSON.stringify(state.weather.digest, null, 2) : EclipseWeather.digestMarkdown(state.weather.digest);
  try {
    await navigator.clipboard.writeText(text);
    weatherStatus.textContent = `${format === "json" ? "JSON" : "Markdown"} copied.`;
  } catch {
    window.prompt(`Copy the ${format === "json" ? "JSON" : "Markdown"} digest:`, text);
    weatherStatus.textContent = "Copy the digest from the dialog.";
  }
}

function loadPreviousWeatherDigest() {
  try { return JSON.parse(localStorage.getItem(`${WEATHER_DIGEST_STORAGE_KEY}:${eclipseStorageKey()}`) || "null"); }
  catch { return null; }
}

function buildWeatherDigest(results) {
  const sun = EclipseWeather.verifySunPosition(state.viewingDate, state.observer.lat, state.observer.lng);
  const hasForecast = results.some((candidate) => candidate.weather);
  return EclipseWeather.createDigest({
    sun, candidates: results, targetTime: state.viewingDate, includeDebug: state.weather.debug,
    warnings: [
      ...(hasForecast ? [
        "Target-time values are linearly interpolated approximations between the surrounding hourly AEMET grids.",
        "Model initialization time is not exposed by AEMET's public services.",
      ] : []),
      "Historical clear-or-nearly-clear frequency uses the WMO one-okta threshold (ERA5 total cloud cover ≤12.5%); it is climatology, not a forecast or a direct probability of an unobscured Sun.",
      "Cloud values use nearest model raster cells; terrain excludes buildings, trees and atmospheric refraction.",
    ],
  });
}

function weatherCandidateBatches(candidates) {
  const batches = [];
  for (const candidate of candidates) {
    const batch = batches.find((items) => {
      if (items.length >= 9) return false;
      const combined = [...items, candidate];
      const latitudes = combined.map((item) => item.lat);
      const longitudes = combined.map((item) => item.lng);
      // Leave room inside the proxy's four-degree raster limit for a
      // curvature-aware corridor that can extend as far as 150 km.
      return Math.max(...latitudes) - Math.min(...latitudes) <= 1
        && Math.max(...longitudes) - Math.min(...longitudes) <= 1;
    });
    if (batch) batch.push(candidate);
    else batches.push([candidate]);
  }
  return batches;
}

async function analyzeWeather() {
  const button = document.querySelector("#analyze-weather");
  button.disabled = true;
  weatherResults.replaceChildren();
  weatherDigest.hidden = true;
  const forecastTimes = EclipseWeather.forecastWindow(state.viewingDate);
  weatherStatus.textContent = weatherTimeApplies()
    ? `Loading ${formatUtcHour(forecastTimes.before)} and ${formatUtcHour(forecastTimes.after)} UTC cloud grids for eligible sites…`
    : "The eclipse is outside the cloud-forecast window; comparing terrain only…";
  try {
    const candidates = savedLocationsForCurrentEclipse();
    if (!candidates.length) throw new Error("save at least one location first");
    if (candidates.length > 9) throw new Error("comparison is limited to 9 saved locations at a time");
    const preparedCandidates = candidates.map((candidate) => {
      const sun = EclipseWeather.solarPosition(state.viewingDate, candidate.lat, candidate.lng);
      return { ...candidate, azimuthDeg: sun.azimuthDeg, sunElevationDeg: sun.elevationDeg };
    });
    const cloudCandidates = weatherTimeApplies() ? preparedCandidates.filter(inSpainWeatherBounds) : [];
    const cloudResults = [];
    const cloudFailures = new Map();
    for (const batch of weatherCandidateBatches(cloudCandidates)) {
      try {
        const batchResults = await EclipseWeather.analyzeCandidates(batch, state.viewingDate, null, (complete, total, name) => {
          weatherStatus.textContent = complete ? `Processed cloud wedge for ${name} (${cloudResults.length + complete} of ${cloudCandidates.length})…` : "Downloading AEMET regional cloud grids…";
        });
        cloudResults.push(...batchResults);
      } catch (error) {
        batch.forEach((candidate) => cloudFailures.set(candidate.id, `AEMET cloud analysis failed: ${error.message}`));
      }
    }
    const cloudById = new Map(cloudResults.map((candidate) => [candidate.id, candidate]));
    const fallbackCandidates = preparedCandidates.filter((candidate) => !cloudById.has(candidate.id));
    const climateById = new Map();
    if (fallbackCandidates.length) {
      weatherStatus.textContent = `Loading historical clear-or-nearly-clear frequencies for ${fallbackCandidates.length} place${fallbackCandidates.length === 1 ? "" : "s"}…`;
      try {
        const climateResults = await EclipseWeather.climatologyCandidates(fallbackCandidates, state.viewingDate);
        climateResults.forEach((candidate) => climateById.set(candidate.id, candidate));
      } catch (error) {
        fallbackCandidates.forEach((candidate) => cloudFailures.set(candidate.id, `Historical cloud analysis failed: ${error.message}`));
      }
    }
    const terrainCandidates = preparedCandidates.map((candidate) => cloudById.get(candidate.id) || climateById.get(candidate.id) || {
      ...candidate,
      weather: null,
      weatherRating: "unavailable",
      score: null,
      debug: { samples: [] },
      cloudUnavailableReason: cloudFailures.get(candidate.id)
        || (weatherTimeApplies() ? "This location is outside the AEMET forecast area and historical cloud data was unavailable." : "Historical cloud data was unavailable outside the short forecast window."),
    });
    weatherStatus.textContent = "Sampling the terrain-tile horizon, with 100 m spacing through the first 2 km…";
    const terrainResults = [];
    for (let offset = 0; offset < terrainCandidates.length; offset += 4) {
      const batch = terrainCandidates.slice(offset, offset + 4);
      const batchResults = await EclipseWeather.analyzeTerrain(batch, (complete, _total, name) => {
        weatherStatus.textContent = `Processed terrain for ${name} (${offset + complete} of ${terrainCandidates.length})…`;
      });
      terrainResults.push(...batchResults);
    }
    const results = EclipseWeather.enrichCandidates(terrainResults, loadPreviousWeatherDigest());
    state.weather.results = results;
    renderWeatherResults(results);
    state.weather.digest = buildWeatherDigest(results);
    try { localStorage.setItem(`${WEATHER_DIGEST_STORAGE_KEY}:${eclipseStorageKey()}`, JSON.stringify(state.weather.digest)); } catch { /* persistence is optional */ }
    weatherDigest.hidden = false;
    const forecastCount = results.filter((candidate) => candidate.weather).length;
    const climateCount = results.filter((candidate) => candidate.climatology).length;
    const terrainOnlyCount = results.length - forecastCount - climateCount;
    weatherStatus.textContent = `Comparison refreshed. ${forecastCount ? `Short-range forecast for ${forecastCount}; ` : ""}${climateCount ? `historical cloud for ${climateCount}; ` : ""}${terrainOnlyCount ? `terrain only for ${terrainOnlyCount}; ` : ""}${results.length} place${results.length === 1 ? "" : "s"} total.`;
    button.textContent = "Refresh comparison";
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

function findAndSelectRequestedEclipse(peakValue, fit = true) {
  const requested = new Date(peakValue);
  if (Number.isNaN(requested.getTime())) return findAndSelectEclipse({ fit });
  const startDate = new Date(requested.getTime() - 36 * 3600000);
  eventKindOutput.textContent = "Calculating eclipse…";
  try {
    const eclipse = nextVisibleEclipse(startDate);
    if (Math.abs(eventDate(eclipse.peak) - requested) > 48 * 3600000) throw new Error("That eclipse is not visible from this location");
    selectEclipse(eclipse, fit);
  } catch (error) {
    eventKindOutput.textContent = "Selected eclipse unavailable here";
    eventSummaryOutput.textContent = error.message;
    findAndSelectEclipse({ fit });
  }
}

function activateLocation(location, { eclipsePeak, seedNote, keepGate = false, skipHistory = false } = {}) {
  const wasGateVisible = !locationGate.hidden;
  if (!keepGate && !skipHistory && !wasGateVisible && state.observer) {
    history.pushState({ view: "map" }, "", window.location.href);
  }
  const currentPeak = state.eclipse ? eventDate(state.eclipse.peak).toISOString() : null;
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
  locationGate.hidden = !keepGate;
  if (!keepGate && !skipHistory && wasGateVisible) history.pushState({ view: "map" }, "", window.location.href);
  refreshObserverContext();
  if (!keepGate) panel.scrollTop = 0;
  statusOutput.textContent = "";
  const requestedPeak = eclipsePeak || location.eclipsePeak || currentPeak;
  if (requestedPeak) findAndSelectRequestedEclipse(requestedPeak);
  else findAndSelectEclipse();
  if (seedNote !== undefined) rememberCurrentLocation(seedNote);
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
    localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibrations.slice(0, 1)));
    return true;
  } catch {
    return false;
  }
}

function applyRememberedCameraFov() {
  const calibration = loadSavedCalibrations()[0];
  if (!calibration || !Number.isFinite(calibration.horizontalFov) || !Number.isFinite(calibration.verticalFov)) return;
  state.ar.horizontalFov = calibration.horizontalFov;
  state.ar.verticalFov = calibration.verticalFov;
  arFov.value = String(Math.round(calibration.horizontalFov));
  arFovValue.textContent = `${calibration.horizontalFov.toFixed(1)}°`;
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
  const maxDistanceKm = EclipseWeather.cloudSightlineGeometry(state.elevation).maxDistanceKm;
  // Spend 56 of the profile's 100 points in the first 5 km: about 91 m apart,
  // close to the useful source resolution. Space the rest evenly.
  const nearLimitKm = Math.min(5, maxDistanceKm);
  const nearCount = maxDistanceKm <= 5 ? TERRAIN_SAMPLE_COUNT : 56;
  const near = Array.from({ length: nearCount }, (_, index) => nearLimitKm * index / (nearCount - 1));
  const farCount = TERRAIN_SAMPLE_COUNT - nearCount;
  const far = Array.from({ length: farCount }, (_, index) => nearLimitKm + (maxDistanceKm - nearLimitKm) * (index + 1) / farCount);
  return [...near, ...far];
}

function rayAltitudeM(distanceKm, observerElevationM) {
  return EclipseWeather.solarRayAltitudeM(distanceKm, observerElevationM, state.elevation);
}

function cloudColour(percent) {
  const stops = percent <= 60
    ? { from: [255, 255, 255], to: [158, 25, 215], fraction: percent / 60 }
    : { from: [158, 25, 215], to: [93, 25, 142], fraction: (percent - 60) / 40 };
  const rgb = stops.from.map((value, index) => Math.round(value + (stops.to[index] - value) * stops.fraction));
  return `rgb(${rgb.join(",")})`;
}

function currentCloudDistanceProfile(maxDistanceKm) {
  if (!state.observer) return [];
  const currentId = locationId(state.observer);
  const result = state.weather.results?.find((candidate) => candidate.id === currentId);
  if (result?.debug?.samples) {
    const groups = new Map();
    for (const sample of result.debug.samples) {
      const lowLayerEndKm = result.weather?.geometry?.layers?.low?.toKm ?? Infinity;
      if (sample.distanceKm > maxDistanceKm || sample.distanceKm > lowLayerEndKm || !Number.isFinite(sample.lowTarget)) continue;
      const values = groups.get(sample.distanceKm) || [];
      values.push(sample.lowTarget);
      groups.set(sample.distanceKm, values);
    }
    return [...groups].map(([distanceKm, values]) => ({
      distanceKm,
      lowCloudPct: values.reduce((sum, value) => sum + value, 0) / values.length,
    })).sort((a, b) => a.distanceKm - b.distanceKm);
  }
  const digestCandidate = loadPreviousWeatherDigest()?.candidates?.find((candidate) => candidate.id === currentId);
  if (digestCandidate?.lowCloudDistanceProfile?.length) {
    return digestCandidate.lowCloudDistanceProfile.filter((sample) => sample.distanceKm <= maxDistanceKm);
  }
  return [];
}

async function loadCurrentCloudProfile() {
  if (!state.observer || !weatherApplies()) return;
  const id = locationId(state.observer);
  const contextId = `${eclipseStorageKey()}:${id}`;
  if (state.weather.profileLoadingId === contextId) return;
  if (currentCloudDistanceProfile(state.profileRangeKm).length) {
    if (state.terrainSamples.length) renderTerrainProfile(state.terrainSamples);
    return;
  }

  const request = ++state.weather.profileRequest;
  state.weather.profileLoadingId = contextId;
  state.weather.profileAttemptedId = contextId;
  state.weather.profileError = null;
  profileCloudStatus.hidden = false;
  profileCloudStatus.textContent = "Loading cloud percentages along the ±5° corridor…";
  loadCloudProfileButton.hidden = true;
  try {
    const sun = EclipseWeather.solarPosition(state.viewingDate, state.observer.lat, state.observer.lng);
    const [result] = await EclipseWeather.analyzeCandidates([{
      id,
      name: state.locationName,
      lat: state.observer.lat,
      lng: state.observer.lng,
      timezone: state.locationTimezone,
      azimuthDeg: sun.azimuthDeg,
      sunElevationDeg: sun.elevationDeg,
    }], state.viewingDate);
    if (request !== state.weather.profileRequest || contextId !== `${eclipseStorageKey()}:${locationId(state.observer)}`) return;
    state.weather.results = [result, ...(state.weather.results || []).filter((candidate) => candidate.id !== id)];
    state.weather.profileAttemptedId = null;
    profileCloudStatus.hidden = true;
    if (state.terrainSamples.length) renderTerrainProfile(state.terrainSamples);
    renderSightlineTechnical();
  } catch (error) {
    if (request !== state.weather.profileRequest || contextId !== `${eclipseStorageKey()}:${locationId(state.observer)}`) return;
    state.weather.profileError = error.message;
    profileCloudStatus.hidden = false;
    profileCloudStatus.textContent = `Cloud profile unavailable: ${error.message}. The map tiles use a separate service and may still display.`;
    loadCloudProfileButton.hidden = false;
  } finally {
    if (request === state.weather.profileRequest) state.weather.profileLoadingId = null;
  }
}

function renderTerrainProfile(samples, maxDistanceKm = state.profileRangeKm) {
  const visibleSamples = samples.filter((sample) => sample.distanceKm <= maxDistanceKm);
  const width = 360;
  const height = 126;
  const pad = { top: 9, right: 8, bottom: 32, left: 35 };
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
  const cloudProfile = currentCloudDistanceProfile(maxDistanceKm);
  const currentId = state.observer && locationId(state.observer);
  const currentProfileContext = currentId && `${eclipseStorageKey()}:${currentId}`;
  const canLoadCloudProfile = !cloudProfile.length && weatherApplies();
  profileCloudKey.hidden = cloudProfile.length === 0;
  profileCloudCaption.hidden = cloudProfile.length === 0;
  profileCloudStrip.hidden = cloudProfile.length === 0;
  profileCloudStatus.hidden = !canLoadCloudProfile || (!state.weather.profileLoadingId && !state.weather.profileError);
  if (state.weather.profileLoadingId === currentProfileContext) profileCloudStatus.textContent = "Loading cloud percentages along the ±5° corridor…";
  loadCloudProfileButton.hidden = !canLoadCloudProfile || !state.weather.profileError;
  const cloudProfileEndKm = cloudProfile.length ? Math.max(...cloudProfile.map((sample) => sample.distanceKm)) : 0;
  if (cloudProfile.length) profileCloudCaption.querySelector("span").textContent = `Per-distance mean across ±5°—not cumulative. Sampled to ${cloudProfileEndKm} km; lighter is clearer.`;
  const cloudStrip = cloudProfile.map((sample, index) => {
    const previous = cloudProfile[index - 1];
    const next = cloudProfile[index + 1];
    const startDistance = previous ? (previous.distanceKm + sample.distanceKm) / 2 : 0;
    const endDistance = next ? (sample.distanceKm + next.distanceKm) / 2 : Math.min(maxDistanceKm, sample.distanceKm + 1.25);
    return `<rect x="${x(startDistance).toFixed(1)}" y="1" width="${Math.max(1, x(endDistance) - x(startDistance)).toFixed(1)}" height="16" fill="${cloudColour(sample.lowCloudPct)}"><title>${sample.distanceKm} km: ${Math.round(sample.lowCloudPct)}% mean low cloud across wedge</title></rect>`;
  }).join("");
  const unsampledStartKm = Math.min(maxDistanceKm, cloudProfileEndKm + 1.25);
  const unsampledCloud = cloudProfile.length && unsampledStartKm < maxDistanceKm
    ? `<rect x="${x(unsampledStartKm).toFixed(1)}" y="1" width="${(x(maxDistanceKm) - x(unsampledStartKm)).toFixed(1)}" height="16" fill="rgba(156,171,185,.28)"><title>No cloud-by-distance samples beyond ${cloudProfileEndKm} km</title></rect>`
    : "";
  profileCloudStrip.innerHTML = cloudProfile.length
    ? `<svg viewBox="0 0 ${width} 18" role="img" aria-label="Non-cumulative low-cloud percentage by distance"><text x="${pad.left - 4}" y="12" fill="#9cabb9" font-size="7" text-anchor="end">cloud</text>${cloudStrip}${unsampledCloud}</svg>`
    : "";
  if (canLoadCloudProfile && sightlineCard.open && state.weather.profileLoadingId !== currentProfileContext && state.weather.profileAttemptedId !== currentProfileContext) {
    queueMicrotask(loadCurrentCloudProfile);
  }

  terrainProfile.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Terrain elevation and solar sightline altitude over ${maxDistanceKm} kilometres${cloudProfile.length ? ", with mean low-cloud percentage across the sampled wedge" : ""}">
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
  terrainResult.className = "result-badge";
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
    const horizon = relevant.reduce((highest, sample) => {
      const terrainAngleDeg = EclipseWeather.terrainApparentAngleDeg(sample.terrainElevationM, observerElevationM, sample.distanceKm);
      return !highest || terrainAngleDeg > highest.terrainAngleDeg ? { ...sample, terrainAngleDeg } : highest;
    }, null);
    const clearanceDeg = state.elevation - horizon.terrainAngleDeg;
    const classification = EclipseWeather.terrainClearanceClassification(clearanceDeg);
    const blocked = relevant.filter((sample) => sample.clearanceM < 0);
    if (classification === "blocked") {
      const first = blocked[0];
      terrainResult.className = "result-badge blocked";
      terrainResult.textContent = "Obstructed";
      terrainNote.textContent = `First sampled obstruction at ${first.distanceKm.toFixed(1)} km. The centre-ray terrain horizon is ${horizon.terrainAngleDeg.toFixed(1)}°, leaving ${clearanceDeg.toFixed(1)}° clearance.`;
      for (const sample of blocked) {
        L.circleMarker(sample.location, { radius: 3, color: "#fff", weight: 1, fillColor: "#e64f43", fillOpacity: 0.9, interactive: false }).addTo(terrainLayer);
      }
    } else if (classification === "marginal") {
      terrainResult.className = "result-badge concerning";
      terrainResult.textContent = "Concerning";
      terrainNote.textContent = `The centre-ray terrain horizon is ${horizon.terrainAngleDeg.toFixed(1)}°, leaving only ${clearanceDeg.toFixed(1)}° clearance. Buildings, trees and narrow features are not included.`;
    } else {
      terrainResult.className = "result-badge clear";
      terrainResult.textContent = "OK";
      terrainNote.textContent = `The centre-ray terrain horizon is ${horizon.terrainAngleDeg.toFixed(1)}°, leaving ${clearanceDeg.toFixed(1)}° clearance. Buildings, trees and narrow features are not included.`;
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    terrainResult.className = "result-badge";
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
    timeLabel: formatLocationTime(phase.date),
  }));
}

function createArMarkers() {
  state.ar.targets = buildArTargets();
  arMarkers.innerHTML = state.ar.targets.map((target, index) => {
    const classes = ["ar-marker", target.primary ? "primary" : ""].filter(Boolean).join(" ");
    return `<div class="${classes}" data-target="${index}">${eclipseIconSvg(target.visualObscuration, target.iconSide, "ar-eclipse-icon")}<div class="ar-marker-label"><b>${target.label}</b><small>${target.timeLabel}</small></div></div>`;
  }).join("");
}

function setArStatus(message, tone = "waiting") {
  arStatus.textContent = message;
  arStatus.className = `ar-status-${tone}`;
}

function updateArReadiness() {
  const accuracyBlocks = Number.isFinite(state.ar.compassAccuracy) && state.ar.compassAccuracy > 45;
  const enoughReadings = state.ar.validOrientationCount >= 5;
  const motionDetected = state.ar.orientationMotionDegrees >= 1;
  state.ar.orientationReady = state.ar.orientationPermissionGranted && enoughReadings && motionDetected && !accuracyBlocks;

  if (state.ar.cameraError) {
    setArStatus(`Camera unavailable: ${state.ar.cameraError}`, "error");
  } else if (!state.ar.cameraReady) {
    setArStatus("Starting rear camera…");
  } else if (state.ar.orientationError) {
    setArStatus(`${state.ar.orientationError} Android does not provide a separate compass permission that this website can request. Check Chrome Settings → Site settings → Motion sensors.`, "error");
  } else if (!state.ar.orientationPermissionGranted) {
    setArStatus("Waiting for orientation permission…");
  } else if (accuracyBlocks) {
    setArStatus("Compass accuracy is very poor. Move away from metal or magnets, then move the phone gently.", "error");
  } else if (!enoughReadings || !motionDetected) {
    setArStatus("Initializing compass—move the phone gently through a small arc.");
  } else if (Number.isFinite(state.ar.compassAccuracy) && state.ar.compassAccuracy > 25) {
    setArStatus(`AR active, but compass accuracy is only about ±${Math.round(state.ar.compassAccuracy)}°. Move away from metal or magnets.`, "warning");
    state.ar.compassWarningActive = true;
    state.ar.readyAnnounced = true;
  } else if (state.ar.compassWarningActive) {
    setArStatus("AR ready. Compass accuracy has improved.", "ready");
    state.ar.compassWarningActive = false;
  } else if (!state.ar.readyAnnounced) {
    const accuracy = Number.isFinite(state.ar.compassAccuracy) && state.ar.compassAccuracy >= 0 ? ` Compass accuracy approximately ±${Math.round(state.ar.compassAccuracy)}°.` : "";
    setArStatus(`AR ready.${accuracy}`, "ready");
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
  const camera = cameraOrientation(event.alpha, event.beta, event.gamma);
  let heading = null;
  if (Number.isFinite(event.webkitCompassHeading)) {
    heading = event.webkitCompassHeading;
    state.ar.orientationAbsolute = true;
  } else if (camera && (event.type === "deviceorientationabsolute" || event.absolute === true)) {
    heading = camera.heading;
    state.ar.orientationAbsolute = true;
  } else {
    if (!state.ar.orientationAbsolute) {
      state.ar.orientationError = "This browser is providing relative motion only, not a north-referenced compass heading. AR placement cannot be trusted on this device.";
      updateArReadiness();
    }
    return;
  }
  const pitch = camera?.pitch ?? null;
  if (Number.isFinite(event.webkitCompassAccuracy)) state.ar.compassAccuracy = event.webkitCompassAccuracy;
  if (heading !== null && pitch !== null) {
    state.ar.orientationError = null;
    const now = performance.now();
    state.ar.orientationHistory.push({ time: now, heading, pitch });
    state.ar.orientationHistory = state.ar.orientationHistory.filter((sample) => now - sample.time <= 600);
    const sinMean = state.ar.orientationHistory.reduce((sum, sample) => sum + Math.sin(toRadians(sample.heading)), 0);
    const cosMean = state.ar.orientationHistory.reduce((sum, sample) => sum + Math.cos(toRadians(sample.heading)), 0);
    state.ar.rawHeading = normalizeAngle(toDegrees(Math.atan2(sinMean, cosMean)));
    state.ar.rawPitch = state.ar.orientationHistory.reduce((sum, sample) => sum + sample.pitch, 0) / state.ar.orientationHistory.length;
    state.ar.validOrientationCount += 1;
    if (!state.ar.initialOrientation) {
      state.ar.initialOrientation = { heading: state.ar.rawHeading, pitch: state.ar.rawPitch };
    } else {
      const headingMotion = Math.abs(signedAngleDifference(state.ar.rawHeading, state.ar.initialOrientation.heading));
      const pitchMotion = Math.abs(state.ar.rawPitch - state.ar.initialOrientation.pitch);
      state.ar.orientationMotionDegrees = Math.max(state.ar.orientationMotionDegrees, headingMotion, pitchMotion);
    }
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
  const permissionApi = typeof DeviceOrientationEvent.requestPermission === "function";
  state.ar.orientationEventNames = permissionApi
    ? ["deviceorientation"]
    : ["deviceorientation", ...("ondeviceorientationabsolute" in window ? ["deviceorientationabsolute"] : [])];
  for (const eventName of state.ar.orientationEventNames) window.addEventListener(eventName, handleOrientation, true);
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
  state.ar.orientationAbsolute = false;
  state.ar.orientationEventNames = [];
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
  applyRememberedCameraFov();
  setArStatus("Requesting orientation and camera access…");

  if (TEST_MODE) {
    const primaryTarget = state.ar.targets.find((target) => target.primary) || state.ar.targets[0];
    state.ar.cameraReady = true;
    state.ar.orientationPermissionGranted = true;
    state.ar.orientationReady = true;
    state.ar.rawHeading = primaryTarget.azimuth;
    state.ar.rawPitch = primaryTarget.elevation;
    state.ar.validOrientationCount = 10;
    state.ar.orientationMotionDegrees = 5;
    state.ar.orientationHistory = Array.from({ length: 8 }, () => ({ heading: primaryTarget.azimuth, pitch: primaryTarget.elevation }));
    setArStatus("Test mode: simulated camera and orientation are active.", "ready");
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
  state.ar.orientationAbsolute = false;
  arView.classList.remove("calibrating");
  arMainControls.hidden = false;
  arCalibrationSettings.hidden = true;
  arFilterCheck.hidden = true;
  arCalibrationUnavailable.hidden = true;
  arCalibrationPanel.hidden = true;
  arCalibrationTarget.hidden = true;
  arMarkers.hidden = false;
  for (const eventName of state.ar.orientationEventNames) window.removeEventListener(eventName, handleOrientation, true);
  state.ar.orientationEventNames = [];
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

function showCalibrationUnavailable(reason) {
  arMainControls.hidden = true;
  arCalibrationSettings.hidden = true;
  arFilterCheck.hidden = true;
  arCalibrationPanel.hidden = true;
  arCalibrationTarget.hidden = true;
  arCalibrationUnavailableReason.textContent = reason;
  arCalibrationUnavailable.hidden = false;
}

function calibrationAvailability() {
  const currentSun = TEST_MODE ? { azimuth: 205, elevation: 30 } : sunPositionAt(new Date());
  if (currentSun.elevation <= 1) return { available: false, currentSun, reason: "The Sun is below, or too close to, the horizon. Try again when it is clearly visible." };
  if (!state.ar.cameraReady) return { available: false, currentSun, reason: "The rear camera is not ready." };
  if (!state.ar.orientationPermissionGranted || state.ar.rawHeading === null || state.ar.rawPitch === null) {
    return { available: false, currentSun, reason: "A north-referenced compass heading is not available, so the Sun cannot be used to align this device." };
  }
  return { available: true, currentSun };
}

function startSunCalibration() {
  const availability = calibrationAvailability();
  if (!availability.available) {
    showCalibrationUnavailable(availability.reason);
    return false;
  }
  const { currentSun } = availability;
  state.ar.calibrationStep = 0;
  state.ar.calibrationSamples = [];
  arView.classList.add("calibrating");
  arMainControls.hidden = true;
  arCalibrationSettings.hidden = true;
  arCalibrationPanel.hidden = false;
  arCalibrationTarget.hidden = false;
  arMarkers.hidden = true;
  arCalibrationUnavailable.hidden = true;
  setArStatus(`Current Sun: ${currentSun.azimuth.toFixed(1)}° bearing, ${currentSun.elevation.toFixed(1)}° elevation.`, "ready");
  showCalibrationStep();
  return true;
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
  setArStatus(message, message.toLowerCase().includes("cancel") ? "waiting" : "ready");
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

  const origin = [state.observer.lat, state.observer.lng];
  const corridorDistanceKm = EclipseWeather.cloudSightlineGeometry(state.elevation).maxDistanceKm;
  const arrowLengthKm = Math.min(4, corridorDistanceKm * 0.22);
  const end = destinationPoint(state.observer, state.azimuth, corridorDistanceKm);
  const arrowUnderlayTip = destinationPoint(state.observer, state.azimuth, corridorDistanceKm + Math.min(0.7, corridorDistanceKm * 0.04));
  const arrowBaseDistanceKm = Math.max(0, corridorDistanceKm - arrowLengthKm);
  const arrowBase = destinationPoint(state.observer, state.azimuth, arrowBaseDistanceKm);
  const left = destinationPoint(state.observer, state.azimuth - WEDGE_DEGREES, corridorDistanceKm);
  const right = destinationPoint(state.observer, state.azimuth + WEDGE_DEGREES, corridorDistanceKm);

  L.polygon([origin, left, right], { color: "#f7a928", weight: 1, opacity: 0.75, fillColor: "#ffcf4a", fillOpacity: 0.18, interactive: false }).addTo(sightlineLayer);
  L.polyline([origin, arrowBase], { color: "#fff", weight: 7, opacity: 0.9, interactive: false }).addTo(sightlineLayer);
  const arrowUnderlayLeft = destinationPoint(state.observer, state.azimuth - 0.9, Math.max(0, arrowBaseDistanceKm - Math.min(0.6, corridorDistanceKm * 0.03)));
  const arrowUnderlayRight = destinationPoint(state.observer, state.azimuth + 0.9, Math.max(0, arrowBaseDistanceKm - Math.min(0.6, corridorDistanceKm * 0.03)));
  L.polygon([arrowUnderlayTip, arrowUnderlayLeft, arrowUnderlayRight], { stroke: false, fillColor: "#fff", fillOpacity: 0.9, interactive: false }).addTo(sightlineLayer);
  L.polyline([origin, arrowBase], { color: "#ed7b21", weight: 3, opacity: 1, interactive: false }).addTo(sightlineLayer);
  const arrowLeft = destinationPoint(state.observer, state.azimuth - 0.7, arrowBaseDistanceKm);
  const arrowRight = destinationPoint(state.observer, state.azimuth + 0.7, arrowBaseDistanceKm);
  L.polygon([end, arrowLeft, arrowRight], { stroke: false, fillColor: "#ed7b21", fillOpacity: 1, interactive: false }).addTo(sightlineLayer);

  const symbolDistanceKm = Math.max(1, corridorDistanceKm * 0.75);
  const kind = eclipseKindName(state.eclipse?.kind);
  const symbols = [
    { point: destinationPoint(state.observer, state.azimuth - WEDGE_DEGREES, symbolDistanceKm), obscuration: 0.38, side: -1, className: "partial" },
    { point: destinationPoint(state.observer, state.azimuth, symbolDistanceKm), obscuration: state.eclipse.obscuration, side: 1, className: kind === "partial" ? "partial" : "central" },
    { point: destinationPoint(state.observer, state.azimuth + WEDGE_DEGREES, symbolDistanceKm), obscuration: 0.38, side: 1, className: "partial" },
  ];
  symbols.forEach((symbol, index) => {
    L.marker(symbol.point, {
      interactive: false,
      icon: L.divIcon({ className: "", html: `<div class="eclipse-symbol ${symbol.className}">${eclipseIconSvg(symbol.obscuration, symbol.side, "map-eclipse-icon", `map-eclipse-clip-${index}`)}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
    }).addTo(sightlineLayer);
  });
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
  updateProfileRanges();
  renderSightlineTechnical();

  observerMarker.setLatLng(state.observer);
  refreshObserverContext();
  renderSightline();
  loadTerrain();
  if (state.ar.active) {
    createArMarkers();
    renderArOverlay();
  }
  if (fit) {
    map.stop();
    const end = destinationPoint(state.observer, state.azimuth, EclipseWeather.cloudSightlineGeometry(state.elevation).maxDistanceKm);
    const sidePanelPadding = window.matchMedia("(min-width: 760px)").matches
      ? Math.ceil(panel.getBoundingClientRect().width) + 45
      : 45;
    map.fitBounds(L.latLngBounds([[state.observer.lat, state.observer.lng], end]), {
      paddingTopLeft: [45, 45],
      paddingBottomRight: [sidePanelPadding, 45],
      maxZoom: 10,
      animate: false,
    });
    const keepObserverClearOfPanel = () => {
      if (!window.matchMedia("(min-width: 760px)").matches) return;
      const mapLeft = map.getContainer().getBoundingClientRect().left;
      const unobscuredRight = panel.getBoundingClientRect().left - mapLeft - 28;
      const observerPoint = map.latLngToContainerPoint(state.observer);
      if (observerPoint.x > unobscuredRight) {
        const zoom = map.getZoom();
        const shiftedCentre = map.project(map.getCenter(), zoom).add([observerPoint.x - unobscuredRight, 0]);
        map.setView(map.unproject(shiftedCentre, zoom), zoom, { animate: false });
      }
    };
    keepObserverClearOfPanel();
    requestAnimationFrame(keepObserverClearOfPanel);
  }
}

function setObserver(latlng, message, fit = false) {
  history.pushState({ view: "map" }, "", window.location.href);
  const selectedPeak = state.eclipse ? eventDate(state.eclipse.peak).toISOString() : null;
  state.observer = { lat: latlng.lat, lng: latlng.lng };
  state.locationName = `Custom location ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
  statusOutput.textContent = "";
  if (selectedPeak) findAndSelectRequestedEclipse(selectedPeak, fit);
  else findAndSelectEclipse({ fit });
}

function setGateLocationLoading(loading) {
  gateLocateButton.disabled = loading;
  gateLocateButton.textContent = loading ? "Requesting location…" : "Start with my location";
}

function locateUser(fromGate = false) {
  if (!navigator.geolocation) {
    const message = "This browser does not provide geolocation. Search for a place instead.";
    if (fromGate) gateStatus.textContent = message;
    else statusOutput.textContent = message;
    return;
  }
  if (fromGate) {
    gateStatus.textContent = "";
    setGateLocationLoading(true);
  }
  else statusOutput.textContent = "Finding your location…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (fromGate) {
        setGateLocationLoading(false);
        gateStatus.textContent = "";
      }
      state.deviceLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
      state.deviceLocationAccuracyM = position.coords.accuracy;
      activateLocation({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        name: "Current location",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (position.coords.accuracy > 1000) statusOutput.textContent = `Location accuracy is poor (approximately ±${Math.round(position.coords.accuracy / 100) / 10} km). Choose or move the viewing point before relying on the sightline.`;
    },
    () => {
      if (fromGate) setGateLocationLoading(false);
      state.deviceLocation = null;
      state.deviceLocationAccuracyM = null;
      refreshObserverContext();
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

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function installPlatform() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  return { ios, safari };
}

function renderInstallInstructions() {
  const { ios, safari } = installPlatform();
  if (isStandaloneApp()) {
    installInstructions.innerHTML = "<h3>Already installed</h3><p>Eclipse Locator is currently running as a standalone web app.</p>";
  } else if (ios) {
    installInstructions.innerHTML = `<h3>Install from Safari</h3><ol><li>${safari ? "Tap Safari’s Share button." : "Open this page in Safari, then tap Share."}</li><li>Choose <b>Add to Home Screen</b>.</li><li>Turn on <b>Open as Web App</b>.</li><li>Tap <b>Add</b>.</li></ol>`;
  } else {
    installInstructions.innerHTML = "<h3>Install from your browser</h3><p>Open the browser menu and choose <b>Install app</b>, <b>Add to Home screen</b>, or similar. If that option is not shown, this browser may not support web-app installation.</p>";
  }
}

async function openInstallGuide() {
  if (deferredInstallPrompt && !isStandaloneApp()) {
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") return;
  }
  renderInstallInstructions();
  installGuide.hidden = false;
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

function sharedLocationFromUrl(params = new URLSearchParams(window.location.search)) {
  if (!params.has("lat") || !params.has("lng")) return null;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -85 || lat > 85 || lng < -180 || lng > 180) return null;
  return {
    lat,
    lng,
    name: params.get("name") || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    timezone: params.get("tz") || Intl.DateTimeFormat().resolvedOptions().timeZone,
    eclipsePeak: params.get("eclipse") || undefined,
    notes: params.get("note") || undefined,
  };
}

function currentShareData() {
  updateUrlState();
  return {
    title: `${state.locationName} · Eclipse Locator`,
    text: `${eventKindOutput.textContent} viewed from ${state.locationName}`,
    url: window.location.href,
  };
}

function showShareStatus(message) {
  shareStatus.textContent = message;
  clearTimeout(shareStatusTimer);
  shareStatusTimer = message ? setTimeout(() => { shareStatus.textContent = ""; }, 2500) : null;
}

async function copyCurrentViewLink() {
  const shareData = currentShareData();
  try {
    await navigator.clipboard.writeText(shareData.url);
    showShareStatus("Share link copied.");
  } catch {
    window.prompt("Copy this share link:", shareData.url);
    showShareStatus("Copy the link shown to share this view.");
  }
  shareMenu.hidden = true;
  shareButton.setAttribute("aria-expanded", "false");
}

async function systemShareCurrentView() {
  if (!navigator.share) return;
  try {
    await navigator.share(currentShareData());
    showShareStatus("Share sheet opened.");
  } catch (error) {
    if (error.name !== "AbortError") showShareStatus("System sharing was unavailable. You can still copy the link.");
  }
  shareMenu.hidden = true;
  shareButton.setAttribute("aria-expanded", "false");
}

function toggleShareMenu() {
  showShareStatus("");
  shareMenu.hidden = !shareMenu.hidden;
  shareButton.setAttribute("aria-expanded", String(!shareMenu.hidden));
  if (!shareMenu.hidden) copyShareLinkButton.focus();
}

document.querySelector("#locate-button").addEventListener("click", () => locateUser(false));
arUseCurrentLocation.addEventListener("click", () => locateUser(false));
gateLocateButton.addEventListener("click", () => locateUser(true));
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
arButton.addEventListener("click", openArView);
document.querySelector("#ar-close").addEventListener("click", closeArView);
document.querySelector("#ar-open-calibration").addEventListener("click", () => {
  const availability = calibrationAvailability();
  if (!availability.available) {
    showCalibrationUnavailable(availability.reason);
    return;
  }
  arMainControls.hidden = true;
  arFilterCheck.hidden = false;
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
});
document.querySelector("#ar-filter-cancel").addEventListener("click", () => {
  arFilterCheck.hidden = true;
  arCalibrationSettings.hidden = false;
});
document.querySelector("#ar-calibration-unavailable-close").addEventListener("click", () => {
  arCalibrationUnavailable.hidden = true;
  arMainControls.hidden = false;
});
document.querySelector("#ar-capture-calibration").addEventListener("click", captureSunCalibration);
document.querySelector("#ar-cancel-calibration").addEventListener("click", () => cancelSunCalibration());
arFov.addEventListener("input", () => {
  state.ar.horizontalFov = Number(arFov.value);
  const stageRatio = arView.clientHeight / Math.max(arView.clientWidth, 1);
  state.ar.verticalFov = toDegrees(2 * Math.atan(Math.tan(toRadians(state.ar.horizontalFov / 2)) * stageRatio));
  arFovValue.textContent = `${arFov.value}°`;
  renderArOverlay();
});
function showLocationGate() {
  locationGate.hidden = false;
  history.pushState({ view: "gate" }, "", window.location.href);
}

document.querySelector("#choose-location-button").addEventListener("click", showLocationGate);
document.querySelector("#map-close-button").addEventListener("click", showLocationGate);
document.querySelector("#explore-eclipses").addEventListener("click", openEclipseExplorer);
shareButton.setAttribute("aria-haspopup", "menu");
shareButton.setAttribute("aria-expanded", "false");
systemShareButton.hidden = !navigator.share;
shareButton.addEventListener("click", toggleShareMenu);
copyShareLinkButton.addEventListener("click", copyCurrentViewLink);
systemShareButton.addEventListener("click", systemShareCurrentView);
document.addEventListener("click", (event) => {
  if (shareMenu.hidden || shareMenu.contains(event.target) || shareButton.contains(event.target)) return;
  shareMenu.hidden = true;
  shareButton.setAttribute("aria-expanded", "false");
});
document.querySelector("#close-explorer").addEventListener("click", () => { eclipseExplorer.hidden = true; });
document.querySelector("#install-app").addEventListener("click", openInstallGuide);
document.querySelector("#close-install-guide").addEventListener("click", () => { installGuide.hidden = true; });
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (!installGuide.hidden) renderInstallInstructions();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  if (!installGuide.hidden) renderInstallInstructions();
});
weatherLayerSelect.addEventListener("change", updateWeatherOverlay);
weatherTimeSelect.addEventListener("change", () => {
  updateWeatherOverlay();
  const times = EclipseWeather.forecastWindow(state.viewingDate);
  weatherStatus.textContent = `Map overlay time changed. Comparison still interpolates the ${formatUtcHour(times.before)} and ${formatUtcHour(times.after)} UTC grids.`;
});
document.querySelector("#analyze-weather").addEventListener("click", analyzeWeather);
weatherDebugToggle.addEventListener("change", () => {
  state.weather.debug = weatherDebugToggle.checked;
  if (!state.weather.results) return;
  renderWeatherResults(state.weather.results);
  state.weather.digest = buildWeatherDigest(state.weather.results);
});
document.querySelector("#copy-weather-digest").addEventListener("click", () => copyWeatherDigest("markdown"));
document.querySelector("#copy-weather-json").addEventListener("click", () => copyWeatherDigest("json"));
document.querySelectorAll(".profile-ranges button").forEach((button) => {
  button.addEventListener("click", () => {
    state.profileRangeKm = Number(button.dataset.range);
    document.querySelectorAll(".profile-ranges button").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
    if (state.terrainSamples.length) renderTerrainProfile(state.terrainSamples);
  });
});
sightlineCard.addEventListener("toggle", () => {
  if (!sightlineCard.open) return;
  if (state.terrainSamples.length) renderTerrainProfile(state.terrainSamples);
  else loadCurrentCloudProfile();
});
loadCloudProfileButton.addEventListener("click", () => {
  state.weather.profileAttemptedId = null;
  state.weather.profileError = null;
  loadCurrentCloudProfile();
});
prepareLocationGate();
renderSavedLocations();
history.replaceState({ view: "gate" }, "", window.location.href);
window.addEventListener("popstate", (event) => {
  eclipseExplorer.hidden = true;
  if (event.state?.view === "gate") {
    locationGate.hidden = false;
    return;
  }
  const location = sharedLocationFromUrl();
  if (location) activateLocation(location, { eclipsePeak: location.eclipsePeak, seedNote: location.notes, skipHistory: true });
});
const sharedLocation = sharedLocationFromUrl();
if (sharedLocation) activateLocation(sharedLocation, { eclipsePeak: sharedLocation.eclipsePeak, seedNote: sharedLocation.notes });
else if (TEST_MODE) {
  state.deviceLocation = { lat: 43.5322, lng: -5.6611 };
  state.deviceLocationAccuracyM = 10;
  activateLocation({ lat: 43.5322, lng: -5.6611, name: "Gijón test location", timezone: "Europe/Madrid" });
}
