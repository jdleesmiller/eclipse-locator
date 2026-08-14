(function () {
  const TEST_MODE = new URLSearchParams(window.location.search).get("test") === "1";
  const CLEAR_OR_NEARLY_CLEAR_THRESHOLD_PCT = 12.5;
  const CLEAR_OR_FEW_CLOUDS_THRESHOLD_PCT = 25;
  const DEFAULT_START_YEAR = 2001;
  const DEFAULT_END_YEAR = 2025;
  const DATE_WINDOW_DAYS = 14;
  const memoryCache = new Map();

  function rating(clearOrNearlyClearPct) {
    if (clearOrNearlyClearPct >= 60) return "favourable";
    if (clearOrNearlyClearPct >= 30) return "mixed";
    return "concerning";
  }

  function testResult(candidate, targetTime, startYear, endYear) {
    const coastalVariation = 8 * Math.sin((candidate.lng + 4) * 1.7) - 5 * Math.cos((candidate.lat - 37) * 1.9);
    const clearOrNearlyClearPct = Math.max(10, Math.min(88, Math.round(52 + coastalVariation)));
    const sampleCount = (endYear - startYear + 1) * (DATE_WINDOW_DAYS * 2 + 1);
    const standardClearPct = Math.max(8, Math.min(90, clearOrNearlyClearPct - 2));
    return {
      ...candidate,
      climatology: {
        source: "ERA5 via Open-Meteo Historical Weather API",
        targetTime: new Date(targetTime).toISOString(),
        period: { startYear, endYear },
        dateWindowDays: DATE_WINDOW_DAYS,
        sampleCount,
        clearOrNearlyClearThresholdPct: CLEAR_OR_NEARLY_CLEAR_THRESHOLD_PCT,
        clearOrNearlyClearPct,
        moreThanOneOktaPct: 100 - clearOrNearlyClearPct,
        clearOrFewCloudsThresholdPct: CLEAR_OR_FEW_CLOUDS_THRESHOLD_PCT,
        clearOrFewCloudsPct: Math.min(96, clearOrNearlyClearPct + 14),
        medianCloudCoverPct: Math.round(100 - clearOrNearlyClearPct * 0.72),
        cloudCoverP25Pct: Math.max(0, Math.round(70 - clearOrNearlyClearPct * 0.72)),
        cloudCoverP75Pct: Math.min(100, Math.round(130 - clearOrNearlyClearPct)),
        medianLowCloudPct: Math.max(0, Math.round(48 - clearOrNearlyClearPct * 0.45)),
        medianMidCloudPct: Math.max(0, Math.round(38 - clearOrNearlyClearPct * 0.32)),
        medianHighCloudPct: Math.max(0, Math.round(52 - clearOrNearlyClearPct * 0.4)),
        standardNormal: {
          period: { startYear: 1991, endYear: 2020 }, dateWindowDays: DATE_WINDOW_DAYS, sampleCount: 870,
          clearOrNearlyClearThresholdPct: CLEAR_OR_NEARLY_CLEAR_THRESHOLD_PCT, clearOrNearlyClearPct: standardClearPct, moreThanOneOktaPct: 100 - standardClearPct,
        },
      },
      climateRating: rating(clearOrNearlyClearPct),
      score: clearOrNearlyClearPct,
    };
  }

  async function climatologyCandidates(candidates, targetTime, { startYear = DEFAULT_START_YEAR, endYear = DEFAULT_END_YEAR } = {}) {
    if (!Array.isArray(candidates) || !candidates.length) throw new Error("provide at least one location for historical cloud analysis");
    if (TEST_MODE) return candidates.map((candidate) => testResult(candidate, targetTime, startYear, endYear));
    if (!EclipseWeather.PROXY_URL) throw new Error("weather proxy is not configured; historical cloud analysis needs its Cloud Run URL");
    const normalized = candidates.map((candidate) => ({ id: candidate.id, lat: Number(candidate.lat.toFixed(5)), lng: Number(candidate.lng.toFixed(5)) }));
    const key = JSON.stringify({ normalized, targetTime: new Date(targetTime).toISOString(), startYear, endYear });
    if (memoryCache.has(key)) return memoryCache.get(key);
    const pending = (async () => {
      const response = await fetch(`${EclipseWeather.PROXY_URL}/climatology`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: normalized, targetTime: new Date(targetTime).toISOString(), startYear, endYear, dateWindowDays: DATE_WINDOW_DAYS }),
      });
      if (!response.ok) {
        let detail = "";
        try { detail = (await response.json()).error || ""; } catch { /* response was not JSON */ }
        throw new Error(`historical weather service returned ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      const data = await response.json();
      if (!Array.isArray(data.results) || data.results.length !== candidates.length) throw new Error("historical weather service returned incomplete location data");
      return candidates.map((candidate, index) => {
        const climatology = data.results[index];
        return { ...candidate, climatology, climateRating: rating(climatology.clearOrNearlyClearPct), score: climatology.clearOrNearlyClearPct };
      });
    })();
    memoryCache.set(key, pending);
    try { return await pending; }
    catch (error) { memoryCache.delete(key); throw error; }
  }

  window.EclipseWeather = window.EclipseWeather || {};
  Object.assign(window.EclipseWeather, {
    climatologyCandidates, climatologyRating: rating, CLEAR_OR_NEARLY_CLEAR_THRESHOLD_PCT, CLEAR_OR_FEW_CLOUDS_THRESHOLD_PCT,
    CLIMATOLOGY_START_YEAR: DEFAULT_START_YEAR, CLIMATOLOGY_END_YEAR: DEFAULT_END_YEAR, CLIMATOLOGY_DATE_WINDOW_DAYS: DATE_WINDOW_DAYS,
  });
}());
