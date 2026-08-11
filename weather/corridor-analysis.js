(function () {
  const SAMPLE_SPACING_KM = 2.5;
  const MAX_DISTANCE_KM = 50;

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

  function summarize(values, distances, limit) {
    const selected = values.filter((_, index) => distances[index] <= limit);
    return {
      mean: Math.round(selected.reduce((sum, value) => sum + value, 0) / selected.length),
      max: Math.round(Math.max(...selected)),
    };
  }

  async function analyzeCandidate(candidate, azimuthDeg, validTime) {
    const distances = Array.from({ length: Math.floor(MAX_DISTANCE_KM / SAMPLE_SPACING_KM) + 1 }, (_, index) => index * SAMPLE_SPACING_KM);
    const points = distances.map((distance) => destination(candidate, azimuthDeg, distance));
    const values = await EclipseWeather.pointValues(["total", "low"], points, validTime);
    const total = values.total;
    const low = values.low;
    const metrics = {
      cloudAtObserverPct: Math.round(total[0]),
      lowCloudAtObserverPct: Math.round(low[0]),
      total: { km10: summarize(total, distances, 10), km25: summarize(total, distances, 25), km50: summarize(total, distances, 50) },
      low: { km10: summarize(low, distances, 10), km25: summarize(low, distances, 25), km50: summarize(low, distances, 50) },
    };
    const penalty = 0.38 * metrics.low.km10.mean + 0.22 * metrics.low.km25.mean + 0.16 * metrics.total.km25.mean + 0.14 * metrics.total.km50.mean + 0.10 * metrics.low.km25.max;
    return { ...candidate, metrics, score: Math.max(0, Math.round(100 - penalty)) };
  }

  async function analyzeCandidates(candidates, azimuthDeg, validTime, onProgress) {
    const results = [];
    for (const candidate of candidates) {
      results.push(await analyzeCandidate(candidate, candidate.azimuthDeg ?? azimuthDeg, validTime));
      onProgress?.(results.length, candidates.length, candidate.name);
    }
    return results.sort((a, b) => b.score - a.score);
  }

  window.EclipseWeather = window.EclipseWeather || {};
  Object.assign(window.EclipseWeather, { analyzeCandidate, analyzeCandidates, SAMPLE_SPACING_KM });
}());
