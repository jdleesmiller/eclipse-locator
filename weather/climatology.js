(function () {
  const TEST_MODE = new URLSearchParams(window.location.search).get("test") === "1";
  const BRIGHT_SUN_THRESHOLD_W_M2 = 120;
  const DEFAULT_START_YEAR = 2001;
  const DEFAULT_END_YEAR = 2025;
  const DATE_WINDOW_DAYS = 14;
  const memoryCache = new Map();

  function rating(brightSunPct) {
    if (brightSunPct >= 80) return "favourable";
    if (brightSunPct >= 60) return "mixed";
    return "concerning";
  }

  function testResult(candidate, targetTime, startYear, endYear) {
    const coastalVariation = 8 * Math.sin((candidate.lng + 4) * 1.7) - 5 * Math.cos((candidate.lat - 37) * 1.9);
    const brightSunPct = Math.max(35, Math.min(94, Math.round(76 + coastalVariation)));
    const sampleCount = (endYear - startYear + 1) * (DATE_WINDOW_DAYS * 2 + 1);
    const standardBrightSunPct = Math.max(30, Math.min(96, brightSunPct - 2));
    return {
      ...candidate,
      climatology: {
        source: "ERA5 via Open-Meteo Historical Weather API",
        targetTime: new Date(targetTime).toISOString(),
        period: { startYear, endYear },
        dateWindowDays: DATE_WINDOW_DAYS,
        sampleCount,
        brightSunThresholdWm2: BRIGHT_SUN_THRESHOLD_W_M2,
        brightSunPct,
        noBrightSunPct: 100 - brightSunPct,
        medianCloudCoverPct: Math.round(100 - brightSunPct * 0.72),
        cloudCoverP25Pct: Math.max(0, Math.round(70 - brightSunPct * 0.72)),
        cloudCoverP75Pct: Math.min(100, Math.round(130 - brightSunPct)),
        medianLowCloudPct: Math.max(0, Math.round(48 - brightSunPct * 0.45)),
        medianMidCloudPct: Math.max(0, Math.round(38 - brightSunPct * 0.32)),
        medianHighCloudPct: Math.max(0, Math.round(52 - brightSunPct * 0.4)),
        standardNormal: {
          period: { startYear: 1991, endYear: 2020 }, dateWindowDays: DATE_WINDOW_DAYS, sampleCount: 870,
          brightSunThresholdWm2: BRIGHT_SUN_THRESHOLD_W_M2, brightSunPct: standardBrightSunPct, noBrightSunPct: 100 - standardBrightSunPct,
        },
      },
      climateRating: rating(brightSunPct),
      score: brightSunPct,
    };
  }

  async function climatologyCandidates(candidates, targetTime, { startYear = DEFAULT_START_YEAR, endYear = DEFAULT_END_YEAR } = {}) {
    if (!Array.isArray(candidates) || !candidates.length) throw new Error("provide at least one location for historical sunshine analysis");
    if (TEST_MODE) return candidates.map((candidate) => testResult(candidate, targetTime, startYear, endYear));
    if (!EclipseWeather.PROXY_URL) throw new Error("weather proxy is not configured; historical sunshine analysis needs its Cloud Run URL");
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
        return { ...candidate, climatology, climateRating: rating(climatology.brightSunPct), score: climatology.brightSunPct };
      });
    })();
    memoryCache.set(key, pending);
    try { return await pending; }
    catch (error) { memoryCache.delete(key); throw error; }
  }

  window.EclipseWeather = window.EclipseWeather || {};
  Object.assign(window.EclipseWeather, {
    climatologyCandidates, climatologyRating: rating, BRIGHT_SUN_THRESHOLD_W_M2,
    CLIMATOLOGY_START_YEAR: DEFAULT_START_YEAR, CLIMATOLOGY_END_YEAR: DEFAULT_END_YEAR, CLIMATOLOGY_DATE_WINDOW_DAYS: DATE_WINDOW_DAYS,
  });
}());
