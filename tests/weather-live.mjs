import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage();
try {
  await page.goto("http://localhost:8080/", { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(() => new Promise((resolve, reject) => {
    const callback = `__aemetLiveTest${Date.now()}`;
    const script = document.createElement("script");
    const params = new URLSearchParams({
      SERVICE: "WMS", VERSION: "1.1.1", REQUEST: "GetFeatureInfo",
      LAYERS: "ama_netcdf:ama_pen_cob_nub_bajas", QUERY_LAYERS: "ama_netcdf:ama_pen_cob_nub_bajas",
      SRS: "EPSG:4326", BBOX: "-5.7,43.5,-5.6,43.6", WIDTH: "101", HEIGHT: "101", X: "40", Y: "69",
      FORMAT: "image/png", INFO_FORMAT: "text/javascript", FEATURE_COUNT: "1",
      TIME: "2026-08-12T18:00:00.000Z", FORMAT_OPTIONS: `callback:${callback}`,
    });
    const timer = setTimeout(() => reject(new Error("AEMET JSONP timed out")), 15000);
    window[callback] = (data) => {
      clearTimeout(timer);
      resolve(data.features?.[0]?.properties?.GRAY_INDEX);
    };
    script.onerror = () => reject(new Error("AEMET JSONP script failed"));
    script.src = `https://ama.aemet.es/geoserver/wms?${params}`;
    document.head.append(script);
  }));
  console.log(`Live AEMET browser request passed. Gijón low-cloud grid value: ${result}%`);
} finally {
  await browser.close();
}
