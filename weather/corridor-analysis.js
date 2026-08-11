(function () {
  const SAMPLE_SPACING_KM = 2.5;
  const MAX_DISTANCE_KM = 50;
  const WEDGE_HALF_WIDTH_DEG = 5;
  const RAY_OFFSETS_DEG = [-5, -3, -1, 0, 1, 3, 5];
  const DISTANCE_BANDS_KM = [10, 25, 50];
  const BEFORE_TIME = "2026-08-12T18:00:00.000Z";
  const AFTER_TIME = "2026-08-12T19:00:00.000Z";
  const TARGET_TIME = "2026-08-12T18:27:00.000Z";
  const INTERPOLATION_FRACTION = 27 / 60;

  function destination(origin, bearingDegrees, distanceKm) {
    const radiusKm = 6371.0088;
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

  function summarizeWeather(total, low, samples) {
    const centreOrigin = samples.findIndex((sample) => sample.offsetDeg === 0 && sample.distanceKm === 0);
    const summarizeField = (values) => Object.fromEntries(DISTANCE_BANDS_KM.map((distance) => [`km${distance}`, summarize(values, samples, distance)]));
    return {
      cloudAtObserverPct: rounded(total[centreOrigin]),
      lowCloudAtObserverPct: rounded(low[centreOrigin]),
      total: summarizeField(total),
      low: summarizeField(low),
    };
  }

  function interpolateValues(before, after) {
    return before.map((value, index) => value + (after[index] - value) * INTERPOLATION_FRACTION);
  }

  function weatherRating(metrics) {
    const penalty = 0.38 * metrics.low.km10.wedgeMean + 0.22 * metrics.low.km25.wedgeMean + 0.16 * metrics.total.km25.wedgeMean + 0.14 * metrics.total.km50.wedgeMean + 0.10 * metrics.low.km25.wedgeP75;
    const score = Math.max(0, Math.round(100 - penalty));
    return { score, rating: score >= 80 ? "excellent" : score >= 65 ? "good" : score >= 40 ? "mixed" : "poor" };
  }

  function buildSamples(candidate) {
    const distances = Array.from({ length: Math.floor(MAX_DISTANCE_KM / SAMPLE_SPACING_KM) + 1 }, (_, index) => index * SAMPLE_SPACING_KM);
    return RAY_OFFSETS_DEG.flatMap((offsetDeg) => distances.filter((distanceKm) => offsetDeg === 0 || distanceKm > 0).map((distanceKm) => ({
      ...destination(candidate, candidate.azimuthDeg + offsetDeg, distanceKm),
      distanceKm, offsetDeg, bearingDeg: (candidate.azimuthDeg + offsetDeg + 360) % 360,
    })));
  }

  async function analyzeCandidates(candidates, _azimuthDeg, _validTime, onProgress) {
    const prepared = candidates.map((candidate) => ({ candidate, samples: buildSamples(candidate) }));
    const points = prepared.flatMap((item) => item.samples.map(({ lat, lng }) => ({ lat, lng })));
    onProgress?.(0, candidates.length, "AEMET regional grids");
    const values = await EclipseWeather.rasterValues(["total", "low"], points, [BEFORE_TIME, AFTER_TIME]);
    let cursor = 0;
    const results = [];
    for (const { candidate, samples } of prepared) {
      const length = samples.length;
      const beforeTotal = values[BEFORE_TIME].total.slice(cursor, cursor + length);
      const beforeLow = values[BEFORE_TIME].low.slice(cursor, cursor + length);
      const afterTotal = values[AFTER_TIME].total.slice(cursor, cursor + length);
      const afterLow = values[AFTER_TIME].low.slice(cursor, cursor + length);
      cursor += length;
      const before = summarizeWeather(beforeTotal, beforeLow, samples);
      const after = summarizeWeather(afterTotal, afterLow, samples);
      const targetTotal = interpolateValues(beforeTotal, afterTotal);
      const targetLow = interpolateValues(beforeLow, afterLow);
      const target = summarizeWeather(targetTotal, targetLow, samples);
      const rating = weatherRating(target);
      results.push({
        ...candidate,
        score: rating.score,
        weatherRating: rating.rating,
        weather: { before, after, target },
        metrics: target,
        debug: { samples: samples.map((sample, index) => ({ ...sample, total18: beforeTotal[index], total19: afterTotal[index], low18: beforeLow[index], low19: afterLow[index], totalTarget: targetTotal[index], lowTarget: targetLow[index] })) },
      });
      onProgress?.(results.length, candidates.length, candidate.name);
    }
    return results.sort((a, b) => b.score - a.score);
  }

  window.EclipseWeather = window.EclipseWeather || {};
  Object.assign(window.EclipseWeather, {
    analyzeCandidates, destination, SAMPLE_SPACING_KM, MAX_DISTANCE_KM, WEDGE_HALF_WIDTH_DEG,
    RAY_OFFSETS_DEG, BEFORE_TIME, AFTER_TIME, TARGET_TIME, INTERPOLATION_FRACTION,
  });
}());
