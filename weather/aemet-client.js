(function () {
  const WMS_URL = "https://ama.aemet.es/geoserver/wms";
  const TEST_MODE = new URLSearchParams(window.location.search).get("test") === "1";
  const PROXY_URL = String(new URLSearchParams(window.location.search).get("weatherProxy") || window.ECLIPSE_WEATHER_PROXY_URL || "").replace(/\/$/, "");
  const LAYERS = {
    total: { label: "Total cloud", name: "ama_netcdf:ama_pen_cob_nub", unit: "%" },
    low: { label: "Low cloud", name: "ama_netcdf:ama_pen_cob_nub_bajas", unit: "%" },
    high: { label: "High cloud", name: "ama_netcdf:ama_pen_cob_nub_altas", unit: "%" },
    base: { label: "Cloud base", name: "ama_netcdf:ama_pen_base_nub", unit: "thousand ft" },
  };
  let requestNumber = 0;

  function wmsLayerOptions(kind, validTime) {
    return {
      layers: LAYERS[kind].name,
      format: "image/png",
      transparent: true,
      version: "1.1.1",
      time: validTime,
      opacity: 0.58,
      attribution: '<a href="https://ama.aemet.es/visor-de-variables" target="_blank" rel="noreferrer">AEMET HARMONIE-AROME</a>',
    };
  }

  function testValue(kind, lat, lng) {
    const coastal = Math.max(0, Math.min(1, (lat - 43.15) / 0.42));
    const wave = (Math.sin((lng + 5.7) * 9) + 1) * 8;
    return Math.round(Math.max(0, Math.min(100, (kind === "low" ? 18 : 28) + coastal * (kind === "low" ? 66 : 55) + wave)));
  }

  function pointValue(kind, lat, lng, validTime, timeoutMs = 12000) {
    if (TEST_MODE) return Promise.resolve(testValue(kind, lat, lng));
    const callbackName = `__aemetCloud${Date.now()}_${requestNumber += 1}`;
    const delta = 0.04;
    const params = new URLSearchParams({
      SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetFeatureInfo",
      LAYERS: LAYERS[kind].name, QUERY_LAYERS: LAYERS[kind].name,
      STYLES: "", SRS: "EPSG:4326",
      BBOX: `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`,
      WIDTH: "101", HEIGHT: "101", X: "50", Y: "50",
      FORMAT: "image/png", INFO_FORMAT: "text/javascript", FEATURE_COUNT: "1",
      TIME: validTime, FORMAT_OPTIONS: `callback:${callbackName}`,
    });
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timer = window.setTimeout(() => finish(new Error("AEMET point request timed out")), timeoutMs);
      function finish(error, value) {
        window.clearTimeout(timer);
        script.remove();
        delete window[callbackName];
        if (error) reject(error); else resolve(value);
      }
      window[callbackName] = (data) => {
        const raw = data?.features?.[0]?.properties?.GRAY_INDEX;
        const value = Number(raw);
        finish(Number.isFinite(value) ? null : new Error("No AEMET grid value at this point"), value);
      };
      script.onerror = () => finish(new Error("AEMET point request failed"));
      script.src = `${WMS_URL}?${params}`;
      document.head.append(script);
    });
  }

  async function pointValues(kinds, points, validTime) {
    if (TEST_MODE) {
      return Object.fromEntries(kinds.map((kind) => [kind, points.map((point) => testValue(kind, point.lat, point.lng))]));
    }
    if (!PROXY_URL) throw new Error("weather proxy is not configured; add its Cloud Run URL to config.js");
    const params = new URLSearchParams({
      fields: kinds.join(","),
      time: validTime,
      points: points.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join(";"),
    });
    const response = await fetch(`${PROXY_URL}/weather-points?${params}`);
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json()).error || ""; } catch { /* response was not JSON */ }
      throw new Error(`weather proxy returned ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    const data = await response.json();
    for (const kind of kinds) {
      if (!Array.isArray(data.values?.[kind]) || data.values[kind].length !== points.length) throw new Error(`weather proxy returned incomplete ${kind} cloud data`);
    }
    return data.values;
  }

  window.EclipseWeather = window.EclipseWeather || {};
  Object.assign(window.EclipseWeather, { WMS_URL, LAYERS, PROXY_URL, wmsLayerOptions, pointValue, pointValues });
}());
