(function () {
  const SAMPLE_SPACING_KM = 2.5;
  const MAX_DISTANCE_KM = 150;
  const EARTH_RADIUS_KM = 6371.0088;
  const CLOUD_LAYER_TOPS_KM = { low: 3, middle: 8, high: 15 };
  const WEDGE_HALF_WIDTH_DEG = 5;
  const RAY_OFFSETS_DEG = [-5, -3, -1, 0, 1, 3, 5];
  const DISTANCE_BANDS_KM = [10, 25, 50];
  const BEFORE_TIME = "2026-08-12T18:00:00.000Z";
  const AFTER_TIME = "2026-08-12T19:00:00.000Z";
  const TARGET_TIME = "2026-08-12T18:27:00.000Z";
  const INTERPOLATION_FRACTION = 27 / 60;

  function forecastWindow(targetTime) {
    const target = new Date(targetTime);
    if (Number.isNaN(target.getTime())) throw new Error("forecast target time is invalid");
    const before = new Date(target);
    before.setUTCMinutes(0, 0, 0);
    const after = new Date(before.getTime() + 3600000);
    return {
      before: before.toISOString(),
      after: after.toISOString(),
      target: target.toISOString(),
      fractionAfter: (target - before) / 3600000,
    };
  }

  function destination(origin, bearingDegrees, distanceKm) {
    const radiusKm = EARTH_RADIUS_KM;
    const angular = distanceKm / radiusKm;
    const bearing = bearingDegrees * Math.PI / 180;
    const lat1 = origin.lat * Math.PI / 180;
    const lng1 = origin.lng * Math.PI / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lng2 = lng1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: lat2 * 180 / Math.PI, lng: lng2 * 180 / Math.PI };
  }

  function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * fraction;
    const lower = Math.floor(index);
    const weight = index - lower;
    return sorted[lower + 1] === undefined ? sorted[lower] : sorted[lower] * (1 - weight) + sorted[lower + 1] * weight;
  }

  function rounded(value) { return Math.round(value); }

  function summarize(values, samples, limit) {
    const wedge = values.filter((_, index) => samples[index].distanceKm <= limit);
    const centre = values.filter((_, index) => samples[index].distanceKm <= limit && samples[index].offsetDeg === 0);
    return {
      centreMean: rounded(centre.reduce((sum, value) => sum + value, 0) / centre.length),
      wedgeMean: rounded(wedge.reduce((sum, value) => sum + value, 0) / wedge.length),
      wedgeP75: rounded(percentile(wedge, 0.75)),
      wedgeMax: rounded(Math.max(...wedge)),
    };
  }

  function summarizeRange(values, samples, fromKm, toKm) {
    const selected = values.filter((_, index) => samples[index].distanceKm >= fromKm && samples[index].distanceKm <= toKm);
    const centre = values.filter((_, index) => samples[index].offsetDeg === 0 && samples[index].distanceKm >= fromKm && samples[index].distanceKm <= toKm);
    const usable = selected.length ? selected : values.filter((_, index) => samples[index].distanceKm <= toKm);
    const usableCentre = centre.length ? centre : values.filter((_, index) => samples[index].offsetDeg === 0 && samples[index].distanceKm <= toKm);
    return {
      fromKm: Number(fromKm.toFixed(1)), toKm: Number(toKm.toFixed(1)),
      centreMean: rounded(usableCentre.reduce((sum, value) => sum + value, 0) / usableCentre.length),
      wedgeMean: rounded(usable.reduce((sum, value) => sum + value, 0) / usable.length),
      wedgeP75: rounded(percentile(usable, 0.75)), wedgeMax: rounded(Math.max(...usable)),
    };
  }

  function summarizeWeather(total, low, high, samples, geometry) {
    const centreOrigin = samples.findIndex((sample) => sample.offsetDeg === 0 && sample.distanceKm === 0);
    const summarizeField = (values) => Object.fromEntries(DISTANCE_BANDS_KM.map((distance) => [`km${distance}`, summarize(values, samples, distance)]));
    return {
      cloudAtObserverPct: rounded(total[centreOrigin]),
      lowCloudAtObserverPct: rounded(low[centreOrigin]),
      total: summarizeField(total),
      low: summarizeField(low),
      layers: {
        low: summarizeRange(low, samples, geometry.layers.low.fromKm, geometry.layers.low.toKm),
        middle: summarizeRange(total, samples, geometry.layers.middle.fromKm, geometry.layers.middle.toKm),
        high: summarizeRange(high, samples, geometry.layers.high.fromKm, geometry.layers.high.toKm),
      },
    };
  }

  function interpolateValues(before, after, fractionAfter) {
    return before.map((value, index) => value + (after[index] - value) * fractionAfter);
  }

  function weatherRating(metrics) {
    const penalty = 0.45 * metrics.layers.low.wedgeMean + 0.30 * metrics.layers.middle.wedgeMean + 0.20 * metrics.layers.high.wedgeMean + 0.05 * Math.max(metrics.layers.low.wedgeP75, metrics.layers.middle.wedgeP75, metrics.layers.high.wedgeP75);
    const score = Math.max(0, Math.round(100 - penalty));
    return { score, rating: score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 40 ? "mixed" : "poor" };
  }

  function distanceToAltitudeKm(elevationDeg, altitudeKm) {
    if (!Number.isFinite(elevationDeg) || !Number.isFinite(altitudeKm) || altitudeKm < 0) throw new Error("sightline geometry needs a finite solar elevation and cloud altitude");
    if (altitudeKm === 0) return 0;
    if (elevationDeg <= 0) return MAX_DISTANCE_KM;
    const tangent = Math.tan(elevationDeg * Math.PI / 180);
    // Solve h = d*tan(elevation) + d²/(2R) for ground distance d.
    // The quadratic term raises the ray above the curved Earth sooner than
    // the flat-Earth h/tan(elevation) approximation.
    return Math.min(MAX_DISTANCE_KM, EARTH_RADIUS_KM * (Math.sqrt(tangent * tangent + 2 * altitudeKm / EARTH_RADIUS_KM) - tangent));
  }

  function cloudSightlineGeometry(elevationDeg) {
    const lowEndKm = distanceToAltitudeKm(elevationDeg, CLOUD_LAYER_TOPS_KM.low);
    const middleEndKm = distanceToAltitudeKm(elevationDeg, CLOUD_LAYER_TOPS_KM.middle);
    const highEndKm = distanceToAltitudeKm(elevationDeg, CLOUD_LAYER_TOPS_KM.high);
    const maxDistanceKm = Math.max(SAMPLE_SPACING_KM, Math.min(MAX_DISTANCE_KM, Math.ceil(highEndKm / SAMPLE_SPACING_KM) * SAMPLE_SPACING_KM));
    return {
      elevationDeg, maxDistanceKm, earthCurvature: true, atmosphericRefraction: false,
      layerTopsKm: { ...CLOUD_LAYER_TOPS_KM },
      layers: {
        low: { fromKm: 0, toKm: lowEndKm },
        middle: { fromKm: lowEndKm, toKm: middleEndKm },
        high: { fromKm: middleEndKm, toKm: highEndKm },
      },
    };
  }

  function buildSamples(candidate) {
    const geometry = cloudSightlineGeometry(candidate.sunElevationDeg);
    const distances = Array.from({ length: Math.floor(geometry.maxDistanceKm / SAMPLE_SPACING_KM) + 1 }, (_, index) => index * SAMPLE_SPACING_KM);
    return RAY_OFFSETS_DEG.flatMap((offsetDeg) => distances.filter((distanceKm) => offsetDeg === 0 || distanceKm > 0).map((distanceKm) => ({
      ...destination(candidate, candidate.azimuthDeg + offsetDeg, distanceKm),
      distanceKm, offsetDeg, bearingDeg: (candidate.azimuthDeg + offsetDeg + 360) % 360,
    })));
  }

  async function analyzeCandidates(candidates, targetTime = TARGET_TIME, _validTime, onProgress) {
    const times = forecastWindow(targetTime);
    const prepared = candidates.map((candidate) => ({ candidate, geometry: cloudSightlineGeometry(candidate.sunElevationDeg), samples: buildSamples(candidate) }));
    const points = prepared.flatMap((item) => item.samples.map(({ lat, lng }) => ({ lat, lng })));
    onProgress?.(0, candidates.length, "AEMET regional grids");
    const values = await EclipseWeather.rasterValues(["total", "low", "high"], points, [times.before, times.after]);
    let cursor = 0;
    const results = [];
    for (const { candidate, geometry, samples } of prepared) {
      const length = samples.length;
      const beforeTotal = values[times.before].total.slice(cursor, cursor + length);
      const beforeLow = values[times.before].low.slice(cursor, cursor + length);
      const beforeHigh = values[times.before].high.slice(cursor, cursor + length);
      const afterTotal = values[times.after].total.slice(cursor, cursor + length);
      const afterLow = values[times.after].low.slice(cursor, cursor + length);
      const afterHigh = values[times.after].high.slice(cursor, cursor + length);
      cursor += length;
      const before = summarizeWeather(beforeTotal, beforeLow, beforeHigh, samples, geometry);
      const after = summarizeWeather(afterTotal, afterLow, afterHigh, samples, geometry);
      const targetTotal = interpolateValues(beforeTotal, afterTotal, times.fractionAfter);
      const targetLow = interpolateValues(beforeLow, afterLow, times.fractionAfter);
      const targetHigh = interpolateValues(beforeHigh, afterHigh, times.fractionAfter);
      const target = summarizeWeather(targetTotal, targetLow, targetHigh, samples, geometry);
      const rating = weatherRating(target);
      results.push({
        ...candidate,
        score: rating.score,
        weatherRating: rating.rating,
        weather: { before, after, target, times, geometry },
        metrics: target,
        debug: { samples: samples.map((sample, index) => ({ ...sample, total18: beforeTotal[index], total19: afterTotal[index], low18: beforeLow[index], low19: afterLow[index], high18: beforeHigh[index], high19: afterHigh[index], totalTarget: targetTotal[index], lowTarget: targetLow[index], highTarget: targetHigh[index] })) },
      });
      onProgress?.(results.length, candidates.length, candidate.name);
    }
    return results.sort((a, b) => b.score - a.score);
  }

  window.EclipseWeather = window.EclipseWeather || {};
  Object.assign(window.EclipseWeather, {
    analyzeCandidates, destination, forecastWindow, cloudSightlineGeometry, distanceToAltitudeKm, SAMPLE_SPACING_KM, MAX_DISTANCE_KM, WEDGE_HALF_WIDTH_DEG, CLOUD_LAYER_TOPS_KM,
    RAY_OFFSETS_DEG, BEFORE_TIME, AFTER_TIME, TARGET_TIME, INTERPOLATION_FRACTION,
  });
}());
