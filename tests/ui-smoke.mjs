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
  await page.locator("#analyze-weather").click();
  await page.locator(".weather-result").first().waitFor({ state: "visible" });
  if (await page.locator(".weather-result").count() !== 6) throw new Error("Expected six weather candidate results");
  await page.locator("#weather-status").filter({ hasText: "Comparison complete" }).waitFor();
  await page.locator("#weather-digest").waitFor({ state: "visible" });
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
