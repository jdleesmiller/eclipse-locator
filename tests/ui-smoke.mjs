import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const filePath = resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
  if (!filePath.startsWith(`${root}/`) && filePath !== resolve(root, "index.html")) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});
await new Promise((resolveListen, reject) => {
  server.once("error", reject);
  server.listen(8080, "127.0.0.1", resolveListen);
});

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
await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:8080" });

const failures = [];
page.on("console", (message) => {
  if (message.type() === "error") failures.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => failures.push(`page: ${error.message}`));

try {
  await page.goto("http://localhost:8080/?test=1", { waitUntil: "networkidle" });
  await page.locator("#event-kind").waitFor({ state: "visible" });
  const urlState = new URL(page.url());
  if (!urlState.searchParams.get("lat") || !urlState.searchParams.get("lng") || !urlState.searchParams.get("eclipse")) throw new Error("Shareable URL state is incomplete");
  if ((await page.locator("#gate-title").textContent()) !== "Find the best place to see your next solar eclipse") throw new Error("Opening explanation heading is incorrect");
  if (await page.locator("#event-obscuration-fact").isVisible()) throw new Error("Obscuration should be hidden for a total eclipse");
  if (await page.locator("#share-button").count() !== 1) throw new Error("Expected one top-level share control");
  if (await page.locator("#locate-button svg").count() !== 1) throw new Error("Expected an SVG location control");
  if (await page.locator(".panel-actions > button").count() !== 2) throw new Error("Expected symmetric eclipse and location actions");
  await page.evaluate(() => history.back());
  await page.locator("#location-gate").waitFor({ state: "visible" });
  await page.evaluate(() => history.forward());
  await page.locator("#location-gate").waitFor({ state: "hidden" });
  await page.locator("#event-kind").waitFor({ state: "visible" });
  await page.locator("#cloud-result").filter({ hasText: "% low" }).waitFor();
  await page.locator("#choose-location-button").click();
  await page.locator("#saved-locations-card").waitFor({ state: "visible" });
  await page.screenshot({ path: "test-artifacts/opening.png", fullPage: true });
  if (await page.locator(".saved-location").count() !== 1) throw new Error("Expected the loaded location to be saved for this eclipse");
  if (Number.parseFloat(await page.locator(".saved-location-open").first().evaluate((element) => getComputedStyle(element).fontSize)) < 13) throw new Error("Saved location links are too small");
  if (await page.locator("#weather-legend img").count() !== 0) throw new Error("Expected the local horizontal weather legend, not a remote image");
  await page.getByRole("button", { name: /Rename/ }).first().click();
  const savedName = page.locator(".saved-location-name").first();
  await savedName.fill("Edited smoke-test location");
  await savedName.press("Tab");
  if (new URL(page.url()).searchParams.get("name") !== "Edited smoke-test location") throw new Error("Edited saved name was not reflected in the share URL");
  await page.locator(".saved-location-notes summary").first().click();
  const notes = page.locator(".saved-location textarea").first();
  await notes.fill("Smoke-test viewing note");
  await notes.press("Tab");
  if (new URL(page.url()).searchParams.get("note") !== "Smoke-test viewing note") throw new Error("Saved notes were not reflected in the share URL");
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
  const orientationChecks = await page.evaluate(() => [
    { actual: cameraOrientation(0, 90, 0), heading: 0, pitch: 0 },
    { actual: cameraOrientation(180, 90, 0), heading: 180, pitch: 0 },
    { actual: cameraOrientation(0, 120, 0), heading: 0, pitch: 30 },
  ]);
  for (const check of orientationChecks) {
    if (Math.abs(check.actual.heading - check.heading) > 0.01 || Math.abs(check.actual.pitch - check.pitch) > 0.01) throw new Error(`Rear-camera orientation conversion failed: ${JSON.stringify(check)}`);
  }
  if (await page.locator("#phase-technical > div").count() !== 5) throw new Error("Expected detailed total-eclipse phases under technical details");
  await page.locator(".saved-eclipse-heading button").first().click();
  await page.locator(".weather-result").first().waitFor({ state: "visible" });
  if (await page.locator(".weather-result").count() !== 1) throw new Error("Expected one result for the initially saved location");
  await page.locator("#weather-status").filter({ hasText: "Comparison refreshed" }).waitFor();
  await page.locator("#weather-digest").waitFor({ state: "visible" });
  await page.locator("#copy-weather-json").click();
  const digest = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
  if (!digest.validTimes.target.startsWith("2026-08-12T18:27:")) throw new Error("Digest target time is incorrect");
  if (digest.validTimes.before !== "2026-08-12T18:00:00.000Z" || digest.validTimes.after !== "2026-08-12T19:00:00.000Z") throw new Error("Digest interpolation window is incorrect");
  if (digest.wedge.halfWidthDeg !== 5 || digest.wedge.rayOffsetsDeg.length !== 7) throw new Error("Digest wedge configuration is incorrect");
  if (!digest.candidates.every((candidate) => candidate.weather.before && candidate.weather.after && candidate.weather.target && candidate.terrain.classification)) throw new Error("Digest is missing dual-time weather or terrain analysis");
  if (!digest.candidates.every((candidate) => candidate.lowCloudDistanceProfile?.length >= 20)) throw new Error("Digest is missing the compact low-cloud distance profile");
  if (digest.candidates[0].notes !== "Smoke-test viewing note") throw new Error("Digest is missing the saved location note");
  if (digest.candidates[0].name !== "Edited smoke-test location") throw new Error("Digest is missing the edited saved location name");
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
  await page.screenshot({ path: "test-artifacts/planner.png", fullPage: true });

  await page.locator(".saved-location-open").first().click();
  await page.locator("#terrain-result").filter({ hasText: /OK|Concerning|Obstructed/ }).waitFor();
  await page.locator(".terrain-details summary").click();
  if (await page.locator("#terrain-profile rect").count() < 1) throw new Error("Expected a distance-based low-cloud strip in the terrain profile");
  if (!await page.locator("#profile-cloud-caption").isVisible()) throw new Error("Expected a visible explanation above the low-cloud strip");
  if (!/not cumulative/i.test(await page.locator("#profile-cloud-caption").textContent())) throw new Error("Cloud strip should explicitly say that it is not cumulative");
  if (!await page.locator("#profile-cloud-key").isVisible()) throw new Error("Expected the terrain profile low-cloud legend");
  if (await page.locator(".distance-label").count() !== 0) throw new Error("Distance-ring labels should be removed");
  if (await page.locator(".eclipse-symbol").count() !== 3) throw new Error("Expected central and partial eclipse sightline symbols");
  await page.screenshot({ path: "test-artifacts/main.png", fullPage: true });
  await page.locator("#ar-button").click();
  if ((await page.locator(".ar-marker small").allTextContents()).some((label) => label.includes("°"))) throw new Error("AR labels should show times without angles");
  if (await page.locator("svg.ar-eclipse-icon").count() !== 3 || await page.locator(".ar-eclipse-icon .ar-sun-disc").count() !== 3) throw new Error("Expected rendered SVG eclipse-phase icons in AR");
  await page.screenshot({ path: "test-artifacts/ar.png" });
  await page.locator("#ar-open-calibration").click();
  await page.locator("#ar-filter-check").waitFor({ state: "visible" });
  await page.locator("#ar-filter-cancel").click();
  await page.locator("#ar-calibration-settings").waitFor({ state: "visible" });
  await page.locator("#ar-calibrate").click();
  await page.locator("#ar-filter-confirm").click();
  await page.locator("#ar-calibration-panel").waitFor({ state: "visible" });
  await page.screenshot({ path: "test-artifacts/calibration.png" });

  for (let step = 0; step < 5; step += 1) {
    await page.locator("#ar-capture-calibration").click();
  }
  await page.locator("#ar-status").filter({ hasText: "Calibration saved" }).waitFor();
  await page.evaluate(() => showCalibrationUnavailable("The Sun is below, or too close to, the horizon."));
  await page.locator("#ar-calibration-unavailable").waitFor({ state: "visible" });
  if (await page.locator("#ar-calibration-settings").isVisible() || await page.locator("#ar-main-controls").isVisible()) throw new Error("Unavailable calibration should have a dedicated state");
  await page.locator("#ar-calibration-unavailable-close").click();
  await page.locator("#ar-main-controls").waitFor({ state: "visible" });

  await page.locator("#ar-close").click();
  await page.evaluate(() => setObserver({ lat: 44.5, lng: -5.6 }, "Smoke-test alternate place"));
  await page.locator("#ar-button").waitFor({ state: "hidden" });
  if (await page.locator(".place-pin").count() !== 1) throw new Error("A selected place away from the device should use a map pin");
  if (!await page.locator("#ar-location-note").isVisible()) throw new Error("Expected an explanation when camera view is unavailable away from the device");
  await page.evaluate(() => history.back());
  await page.locator("#ar-button").waitFor({ state: "visible" });
  if (await page.locator(".observer-pin").count() !== 1) throw new Error("The device-matched observer should use the current-location dot");

  if (failures.length) throw new Error(failures.join("\n"));
  console.log("UI smoke test passed. Screenshots: test-artifacts/opening.png, planner.png, main.png, ar.png and calibration.png");
} finally {
  await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
