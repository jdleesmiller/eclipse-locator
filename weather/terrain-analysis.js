(function () {
  const NEAR_SPACING_KM = 0.1;
  const MID_SPACING_KM = 0.25;
  const FAR_SPACING_KM = 2.5;
  const MAX_DISTANCE_KM = 50;
  const TEST_MODE = new URLSearchParams(window.location.search).get("test") === "1";

  function terrainDistances() {
    const values = [0];
    for (let distance = NEAR_SPACING_KM; distance <= 2.0001; distance += NEAR_SPACING_KM) values.push(Number(distance.toFixed(2)));
    for (let distance = 2.25; distance <= 5.0001; distance += MID_SPACING_KM) values.push(Number(distance.toFixed(2)));
    for (let distance = 7.5; distance <= MAX_DISTANCE_KM; distance += FAR_SPACING_KM) values.push(distance);
    return values;
  }

  function buildSamples(candidate) {
    return EclipseWeather.RAY_OFFSETS_DEG.flatMap((offsetDeg) => terrainDistances().filter((distanceKm) => offsetDeg === 0 || distanceKm > 0).map((distanceKm) => ({
      ...EclipseWeather.destination(candidate, candidate.azimuthDeg + offsetDeg, distanceKm),
      distanceKm, offsetDeg, bearingDeg: (candidate.azimuthDeg + offsetDeg + 360) % 360,
    })));
  }

  async function elevationValues(points) {
    if (TEST_MODE) return points.map((point) => Math.round(180 + 90 * Math.sin((point.lat - 43.2) * 20) + 55 * Math.cos((point.lng + 5.7) * 18)));
    if (!EclipseWeather.PROXY_URL) throw new Error("weather/terrain proxy is not configured");
    const response = await fetch(`${EclipseWeather.PROXY_URL}/terrain-values`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: points.map((point) => ({ lat: Number(point.lat.toFixed(5)), lng: Number(point.lng.toFixed(5)) })) }),
    });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json()).error || ""; } catch { /* response was not JSON */ }
      throw new Error(`terrain proxy returned ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const data = await response.json();
    if (!Array.isArray(data.values) || data.values.length !== points.length) throw new Error("terrain proxy returned incomplete elevation data");
    return data.values.map(Number);
  }

  function maximum(samples, predicate) {
    return samples.filter(predicate).reduce((best, sample) => !best || sample.terrainAngleDeg > best.terrainAngleDeg ? sample : best, null);
  }

  function classification(clearanceDeg) {
    if (clearanceDeg > 5) return "comfortable";
    if (clearanceDeg >= 2) return "acceptable";
    if (clearanceDeg >= 0) return "marginal";
    return "blocked";
  }

  async function analyzeTerrain(candidates, onProgress) {
    const prepared = candidates.map((candidate) => ({ candidate, samples: buildSamples(candidate) }));
    const points = prepared.flatMap((item) => item.samples.map(({ lat, lng }) => ({ lat, lng })));
    const elevations = await elevationValues(points);
    let cursor = 0;
    return prepared.map(({ candidate, samples }, candidateIndex) => {
      const terrainElevations = elevations.slice(cursor, cursor + samples.length);
      cursor += samples.length;
      const centreOriginIndex = samples.findIndex((sample) => sample.offsetDeg === 0 && sample.distanceKm === 0);
      const observerElevationM = terrainElevations[centreOriginIndex];
      const detailed = samples.map((sample, index) => ({
        ...sample,
        elevationM: terrainElevations[index],
        terrainAngleDeg: sample.distanceKm === 0 ? null : Math.atan2(terrainElevations[index] - observerElevationM, sample.distanceKm * 1000) * 180 / Math.PI,
      }));
      const centreMax = maximum(detailed, (sample) => sample.offsetDeg === 0 && sample.distanceKm > 0);
      const wedgeMax = maximum(detailed, (sample) => sample.distanceKm > 0);
      const clearanceDeg = candidate.sunElevationDeg - wedgeMax.terrainAngleDeg;
      const result = {
        observerElevationM: Math.round(observerElevationM),
        centreRayMaxAngleDeg: Number(centreMax.terrainAngleDeg.toFixed(2)),
        centreRayMaxDistanceKm: centreMax.distanceKm,
        wedgeMaxAngleDeg: Number(wedgeMax.terrainAngleDeg.toFixed(2)),
        blockingDistanceKm: wedgeMax.distanceKm,
        blockingRayOffsetDeg: wedgeMax.offsetDeg,
        sunElevationDeg: Number(candidate.sunElevationDeg.toFixed(2)),
        clearanceDeg: Number(clearanceDeg.toFixed(2)),
        safetyMarginDeg: 2,
        classification: classification(clearanceDeg),
        method: "AWS Terrain Tiles (EU-DEM, Terrarium z11); geometric atan2 angle, no curvature/refraction/buildings/vegetation",
        debugSamples: detailed,
      };
      onProgress?.(candidateIndex + 1, candidates.length, candidate.name);
      return { ...candidate, terrain: result };
    });
  }

  window.EclipseWeather = window.EclipseWeather || {};
  Object.assign(window.EclipseWeather, { analyzeTerrain, terrainDistances, TERRAIN_NEAR_SPACING_KM: NEAR_SPACING_KM });
}());
