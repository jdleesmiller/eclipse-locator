import { chromium } from "playwright-core";

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

const page = await browser.newPage({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const failures = [];
page.on("console", (message) => {
  if (message.type() === "error") failures.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => failures.push(`page: ${error.message}`));

try {
  await page.goto("http://localhost:8080/?test=1", { waitUntil: "networkidle" });
  await page.locator("#event-kind").waitFor({ state: "visible" });
  const solarChecks = await page.evaluate(() => ["2026-08-12T18:00:00.000Z", "2026-08-12T18:27:00.000Z", "2026-08-12T19:00:00.000Z"].map((time) => ({ time, ...EclipseWeather.verifySunPosition(new Date(time), 43.5322, -5.6611) })));
  for (const check of solarChecks) {
    // SunCalc is a deliberately lightweight approximation; Astronomy Engine is
    // authoritative and the difference must remain small enough to catch convention errors.
    if (check.maximumDifferenceDeg >= 0.25) throw new Error(`Solar verification failed at ${check.time}: ${JSON.stringify(check)}`);
  }
  const imcceChecks = await page.evaluate(() => [
    ["2026-08-12T18:26:46.000Z", 10.29],
    ["2026-08-12T18:27:41.000Z", 10.13],
    ["2026-08-12T18:28:35.000Z", 9.97],
  ].map(([time, expectedElevationDeg]) => ({ time, expectedElevationDeg, actual: EclipseWeather.solarPosition(new Date(time), 43.54736, -5.66353) })));
  for (const check of imcceChecks) {
    if (Math.abs(check.actual.elevationDeg - check.expectedElevationDeg) >= 0.03) throw new Error(`IMCCE altitude check failed at ${check.time}: ${JSON.stringify(check)}`);
  }
  console.log("Solar checks:", solarChecks.map((check) => `${check.time.slice(11, 16)} ${check.azimuthDeg.toFixed(2)}°/${check.elevationDeg.toFixed(2)}° (max Δ ${check.maximumDifferenceDeg.toFixed(3)}°)`).join("; "));
  await page.locator("#analyze-weather").click();
  await page.locator(".weather-result").first().waitFor({ state: "visible" });
  if (await page.locator(".weather-result").count() !== 6) throw new Error("Expected six weather candidate results");
  await page.locator("#weather-status").filter({ hasText: "Comparison complete" }).waitFor();
  await page.locator("#weather-digest").waitFor({ state: "visible" });
  await page.locator("#weather-digest").locator("summary").click();
  await page.locator("#show-json-digest").click();
  const digest = JSON.parse(await page.locator("#weather-digest-text").inputValue());
  if (digest.validTimes.target !== "2026-08-12T18:27:00.000Z") throw new Error("Digest target time is incorrect");
  if (digest.wedge.halfWidthDeg !== 5 || digest.wedge.rayOffsetsDeg.length !== 7) throw new Error("Digest wedge configuration is incorrect");
  if (!digest.candidates.every((candidate) => candidate.weather.before && candidate.weather.after && candidate.weather.target && candidate.terrain.classification)) throw new Error("Digest is missing dual-time weather or terrain analysis");
  if (digest.terrainSampling.classificationHalfWidthDeg !== 0.5) throw new Error("Terrain classification wedge is not ±0.5°");
  for (const candidate of digest.candidates) {
    const terrain = candidate.terrain;
    if (![terrain.centreRayHorizonDeg, terrain.within025DegMaxAngleDeg, terrain.within05DegMaxAngleDeg, terrain.contextWedgeMaxAngleDeg].every(Number.isFinite)) throw new Error(`Missing terrain horizon bands for ${candidate.name}`);
    if (Math.abs(terrain.clearanceDeg - (terrain.sunElevationDeg - terrain.within05DegMaxAngleDeg)) > 0.02) throw new Error(`Terrain clearance does not use ±0.5° horizon for ${candidate.name}`);
  }
  if (digest.candidates.some((candidate, index) => candidate.terrain.classification === "blocked" && index === 0)) throw new Error("A terrain-blocked candidate ranked first");
  const retryResult = await page.evaluate(() => new Promise((resolve, reject) => {
    const layer = EclipseWeather.createWmsLayer("low", "2026-08-12T18:00:00.000Z");
    let urlCalls = 0;
    let retryEvents = 0;
    layer.getTileUrl = () => urlCalls++ === 0 ? "data:image/png;base64,AAAA" : "/favicon.svg";
    layer.on("weatherretry", () => { retryEvents += 1; });
    const timeout = setTimeout(() => reject(new Error("Weather tile retry test timed out")), 5000);
    const tile = layer.createTile({ x: 0, y: 0, z: 0 }, (error) => {
      clearTimeout(timeout);
      tile.remove();
      if (error) reject(error); else resolve({ urlCalls, retryEvents });
    });
    document.body.append(tile);
  }));
  if (retryResult.urlCalls !== 2 || retryResult.retryEvents !== 1) throw new Error(`Unexpected weather retry result: ${JSON.stringify(retryResult)}`);
  await page.screenshot({ path: "test-artifacts/main.png", fullPage: true });

  await page.locator("#ar-button").click();
  await page.locator("#ar-open-calibration").click();
  await page.locator("#ar-calibrate").click();
  await page.locator("#ar-filter-confirm").click();
  await page.locator("#ar-calibration-panel").waitFor({ state: "visible" });
  await page.screenshot({ path: "test-artifacts/calibration.png" });

  for (let step = 0; step < 5; step += 1) {
    await page.locator("#ar-capture-calibration").click();
  }
  await page.locator("#ar-status").filter({ hasText: "Calibration saved" }).waitFor();

  if (failures.length) throw new Error(failures.join("\n"));
  console.log("UI smoke test passed. Screenshots: test-artifacts/main.png and test-artifacts/calibration.png");
} finally {
  await browser.close();
}
