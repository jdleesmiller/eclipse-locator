(function () {
  const NEAR_SPACING_KM = 0.1;
  const MID_SPACING_KM = 0.25;
  const FAR_SPACING_KM = 2.5;
  const MAX_DISTANCE_KM = 50;
  const EARTH_RADIUS_M = 6371008.8;
  const EYE_HEIGHT_M = 1.7;
  const TERRAIN_RAY_OFFSETS_DEG = [-5, -3, -1, -0.5, -0.25, 0, 0.25, 0.5, 1, 3, 5];
  const CLASSIFICATION_HALF_WIDTH_DEG = 0.5;

  function terrainDistances() {
    const values = [0];
    for (let distance = NEAR_SPACING_KM; distance <= 2.0001; distance += NEAR_SPACING_KM) values.push(Number(distance.toFixed(2)));
    for (let distance = 2.25; distance <= 5.0001; distance += MID_SPACING_KM) values.push(Number(distance.toFixed(2)));
    for (let distance = 7.5; distance <= MAX_DISTANCE_KM; distance += FAR_SPACING_KM) values.push(distance);
    return values;
  }

  function buildSamples(candidate) {
    return TERRAIN_RAY_OFFSETS_DEG.flatMap((offsetDeg) => terrainDistances().filter((distanceKm) => offsetDeg === 0 || distanceKm > 0).map((distanceKm) => ({
      ...EclipseWeather.destination(candidate, candidate.azimuthDeg + offsetDeg, distanceKm),
      distanceKm, offsetDeg, bearingDeg: (candidate.azimuthDeg + offsetDeg + 360) % 360,
    })));
  }

  function curvatureDropM(distanceKm) {
    const distanceM = distanceKm * 1000;
    return distanceM * distanceM / (2 * EARTH_RADIUS_M);
  }

  function terrainApparentAngleDeg(targetElevationM, observerElevationM, distanceKm) {
    if (distanceKm <= 0) return null;
    const relativeHeightM = targetElevationM - observerElevationM - EYE_HEIGHT_M - curvatureDropM(distanceKm);
    return Math.atan2(relativeHeightM, distanceKm * 1000) * 180 / Math.PI;
  }

  function solarRayAltitudeM(distanceKm, observerElevationM, solarElevationDeg) {
    const distanceM = distanceKm * 1000;
    return observerElevationM + EYE_HEIGHT_M + distanceM * Math.tan(solarElevationDeg * Math.PI / 180) + curvatureDropM(distanceKm);
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
    const elevations = await EclipseWeather.terrainValues(points);
    let cursor = 0;
    return prepared.map(({ candidate, samples }, candidateIndex) => {
      const terrainElevations = elevations.slice(cursor, cursor + samples.length);
      cursor += samples.length;
      const centreOriginIndex = samples.findIndex((sample) => sample.offsetDeg === 0 && sample.distanceKm === 0);
      const observerElevationM = terrainElevations[centreOriginIndex];
      const detailed = samples.map((sample, index) => ({
        ...sample,
        elevationM: terrainElevations[index],
        terrainAngleDeg: terrainApparentAngleDeg(terrainElevations[index], observerElevationM, sample.distanceKm),
      }));
      const centreMax = maximum(detailed, (sample) => sample.offsetDeg === 0 && sample.distanceKm > 0);
      const near025Max = maximum(detailed, (sample) => Math.abs(sample.offsetDeg) <= 0.25 && sample.distanceKm > 0);
      const near05Max = maximum(detailed, (sample) => Math.abs(sample.offsetDeg) <= CLASSIFICATION_HALF_WIDTH_DEG && sample.distanceKm > 0);
      const contextWedgeMax = maximum(detailed, (sample) => sample.distanceKm > 0);
      const clearanceDeg = candidate.sunElevationDeg - near05Max.terrainAngleDeg;
      const result = {
        observerElevationM: Math.round(observerElevationM),
        centreRayHorizonDeg: Number(centreMax.terrainAngleDeg.toFixed(2)),
        centreRayHorizonDistanceKm: centreMax.distanceKm,
        within025DegMaxAngleDeg: Number(near025Max.terrainAngleDeg.toFixed(2)),
        within025DegMaxDistanceKm: near025Max.distanceKm,
        within025DegMaxRayOffsetDeg: near025Max.offsetDeg,
        within05DegMaxAngleDeg: Number(near05Max.terrainAngleDeg.toFixed(2)),
        within05DegMaxDistanceKm: near05Max.distanceKm,
        within05DegMaxRayOffsetDeg: near05Max.offsetDeg,
        contextWedgeMaxAngleDeg: Number(contextWedgeMax.terrainAngleDeg.toFixed(2)),
        contextWedgeMaxDistanceKm: contextWedgeMax.distanceKm,
        contextWedgeMaxRayOffsetDeg: contextWedgeMax.offsetDeg,
        centreRayMaxAngleDeg: Number(centreMax.terrainAngleDeg.toFixed(2)),
        centreRayMaxDistanceKm: centreMax.distanceKm,
        wedgeMaxAngleDeg: Number(contextWedgeMax.terrainAngleDeg.toFixed(2)),
        blockingDistanceKm: near05Max.distanceKm,
        blockingRayOffsetDeg: near05Max.offsetDeg,
        sunElevationDeg: Number(candidate.sunElevationDeg.toFixed(2)),
        clearanceDeg: Number(clearanceDeg.toFixed(2)),
        classificationHalfWidthDeg: CLASSIFICATION_HALF_WIDTH_DEG,
        safetyMarginDeg: 2,
        classification: classification(clearanceDeg),
        method: "AWS Terrain Tiles (EU-DEM, Terrarium z11); 1.7 m eye height and spherical-Earth curvature; no atmospheric refraction/buildings/vegetation",
        debugSamples: detailed,
      };
      onProgress?.(candidateIndex + 1, candidates.length, candidate.name);
      return { ...candidate, terrain: result };
    });
  }

  window.EclipseWeather = window.EclipseWeather || {};
  Object.assign(window.EclipseWeather, { analyzeTerrain, terrainDistances, terrainApparentAngleDeg, solarRayAltitudeM, TERRAIN_RAY_OFFSETS_DEG, TERRAIN_CLASSIFICATION_HALF_WIDTH_DEG: CLASSIFICATION_HALF_WIDTH_DEG, TERRAIN_NEAR_SPACING_KM: NEAR_SPACING_KM, TERRAIN_EYE_HEIGHT_M: EYE_HEIGHT_M });
}());
