# Eclipse Locator handover

Last reviewed: 13 August 2026, immediately after the 2026 eclipse season.

This document is the starting point for resuming development. `README.md` explains the product and local setup; `WEATHER.md` contains the detailed AEMET, terrain and scoring design.

## Live system snapshot

- Frontend: `https://jdlm.info/eclipse-locator/`, deployed from this repository's `main` branch through GitHub Pages.
- Weather/terrain proxy configured in `config.js`: `https://eclipse-weather-proxy-497090215181.europe-west1.run.app`.
- Google Cloud project/service/region: `eclipse-locator` / `eclipse-weather-proxy` / `europe-west1`.
- Verified on 13 August 2026: the Pages site and manifest returned HTTP 200, and the proxy `/health` endpoint returned `ok: true`.
- Cloud Run settings observed on that date: maximum 3 instances, concurrency 8, request timeout 60 seconds, 1 vCPU, 512 MiB memory and startup CPU boost enabled. These are deployment settings, not fully encoded in this repository; verify them after any redeploy.
- The service's Cloud Run status URL was `https://eclipse-weather-proxy-ajx7k5452a-ew.a.run.app`. `config.js` uses another working service URL. Treat `gcloud run services describe` as authoritative if either changes.
- There are no API keys or credentials in the frontend or proxy source. The proxy is deliberately public and unauthenticated. Its CORS allowlist is not access control; the Cloud Run maximum-instance setting is the hard cost ceiling.

Useful operational checks:

```sh
curl -fsS https://eclipse-weather-proxy-497090215181.europe-west1.run.app/health

gcloud run services describe eclipse-weather-proxy \
  --project eclipse-locator \
  --region europe-west1 \
  --format='yaml(status.url,spec.template.metadata.annotations,spec.template.spec.containerConcurrency,spec.template.spec.timeoutSeconds,spec.template.spec.containers[0].resources)'
```

## Architecture at a glance

The frontend is intentionally static: no bundler, framework or build step is required.

- `index.html`, `styles.css`, `app.js`: application shell, map/planning UI, URL state, saved places, AR and install UI.
- `manifest.webmanifest`, `icons/`: installable web-app metadata. There is intentionally no service worker; installation does not imply offline operation.
- `weather/solar-verification.js`: authoritative Astronomy Engine solar geometry and independent SunCalc comparison.
- `weather/corridor-analysis.js`: curvature-aware ±5° cloud corridor through nominal 3/8/15 km cloud layers, sampled every 2.5 km and capped at 150 km.
- `weather/terrain-analysis.js`: dense terrain horizon across centre, ±0.25°, ±0.5° and contextual ±5° rays.
- `weather/aemet-client.js`: direct AEMET WMS display plus numeric proxy client.
- `weather/climatology.js`: ERA5 clear-or-nearly-clear cloud climatology client and planning-period presentation.
- `weather/digest.js`: saved-place enrichment, ranking and Markdown/JSON export.
- `server/server.js`: public Cloud Run proxy for AEMET WCS/WMS sampling and AWS Terrain Tiles.
- `tests/ui-smoke.mjs`: broad browser regression test, including the 2026 Gijón geometry reference and simulated AR.
- `tests/weather-live.mjs`: historical direct-AEMET probe; its forecast time is fixed to 12 August 2026 and must be updated or made dynamic before it is useful again.

The main app selects eclipses dynamically using Astronomy Engine. It is not tied to Gijón or 2026. Cloud forecasts are the exception: they appear only within the short forecast horizon and the current AEMET Spain bounding box. Terrain and eclipse calculations are global.

## State and data ownership

- Share URLs contain latitude, longitude, place name, time zone, eclipse peak and optionally the selected place's note.
- Saved places and notes are stored only in browser `localStorage`, grouped by eclipse date. Clearing site data or changing browser/profile loses them.
- Comparison digests and the latest camera field-of-view calibration are also local-only.
- A shared URL restores one place, not the complete saved-place collection.
- There is no general saved-plan backup/import feature. Before clearing a device, copy the Markdown/JSON digest and important individual share links.

Storage keys are declared at the top of `app.js`. If their schemas change, either preserve compatibility or deliberately version/migrate them.

## Resume checklist

### Early planning

1. Pull `main`, run `npm install`, then `npm run test:ui`.
2. Check the live Pages site and proxy `/health` endpoint.
3. At representative locations, confirm that the automatically selected eclipse and local circumstances match an authoritative calculator. The existing IMCCE assertions cover only Gijón in 2026.
4. Verify `Astronomy Engine`, Leaflet, SunCalc and Playwright versions before upgrading. CDN versions are pinned in `index.html`; npm is used only for the test harness.
5. Re-check the AWS Terrain Tiles service and attribution. Terrain excludes buildings, trees and atmospheric refraction.
6. Decide whether next season still uses AEMET. The weather integration is provider-specific and Spain-only; making forecasts global should be a separate provider-adapter project rather than widening the existing AEMET bounds.

### When the eclipse enters forecast range

1. Verify the AEMET viewer, WMS layer names, WCS coverage identifiers, valid-time dimension, styles/legend and CORS behaviour. This public aviation endpoint is convenient but not a stable contracted API.
2. Update or replace `tests/weather-live.mjs`; its 2026 valid time is intentionally stale.
3. Exercise both the visual WMS overlay and numeric corridor analysis. They use different paths and one can work while the other fails.
4. Test saved-place comparison with multiple Spanish sites plus at least one out-of-area site. Out-of-area sites should remain as terrain-only results.
5. Confirm Cloud Run limits remain maximum 3 instances, concurrency 8 and timeout 60 seconds. A 10-second timeout was tried and is too short for cold/slow AEMET requests.
6. Watch proxy logs, latency, instance count and billing. In-memory caches are per instance and disappear on restart: weather is fresh for 15 minutes, stale-on-error for up to 2 hours, and identical in-flight requests are coalesced.

### Field-device pass

1. Test current Safari on the intended iPhone and current Chrome on an Android device. Camera/orientation behaviour cannot be fully simulated by the smoke test.
2. Test geolocation denial, poor accuracy, already-granted permission and a selected map point that differs from the device position.
3. Test installed/standalone launch. There is no service worker, so code, map, terrain and forecast loading still need connectivity.
4. Test AR in the actual magnetic environment. Android browsers may expose only relative motion; the app rejects it rather than showing confidently wrong AR. iOS compass accuracy can also be poor.
5. Only perform Sun calibration with a visible Sun and correctly fitted solar filter. Calibration retains camera field of view, not compass correction.
6. Confirm solar safety wording remains prominent anywhere the app suggests looking at the sky.

## Testing notes

```sh
npm run test:ui
```

The smoke test starts its own local server and currently expects Google Chrome at the macOS path `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. It depends on external CDNs and map/weather resources, so an occasional resource/network timeout should be retried once; deterministic assertion failures should not be ignored. Screenshots are written to `test-artifacts/`.

The test fixture deliberately pins the 12 August 2026 Gijón eclipse. The fixed 2026 values in the following places are regression fixtures or harmless initial HTML placeholders, not the production event selector:

- the shared test URL and IMCCE checks in `tests/ui-smoke.mjs`;
- initial weather `<option>` elements in `index.html`, replaced dynamically after eclipse selection;
- exported default/test constants in `weather/corridor-analysis.js`.

Before generalizing tests, retain at least one fixed external solar-geometry reference so longitude signs, UTC handling and azimuth conventions remain guarded.

## Deployment

Frontend changes deploy through GitHub Pages after pushing `main`. Static assets use explicit query-string cache busters in `index.html`; bump the relevant value when changing CSS or JavaScript so mobile Safari does not retain an old file.

Deploy proxy changes from the repository root:

```sh
gcloud run deploy eclipse-weather-proxy \
  --source server \
  --project eclipse-locator \
  --region europe-west1 \
  --allow-unauthenticated \
  --env-vars-file server/env.yaml
```

After deployment:

1. Verify `/health`.
2. Check the maximum-instance, concurrency and timeout settings explicitly.
3. If the service URL changed, update `config.js` and redeploy Pages.
4. Confirm `server/env.yaml` includes the production Pages origin and required localhost development origins.

## Known limitations and likely next work

- Short-range weather is Spain/AEMET-only and appears when the selected eclipse is between 3 hours in the past and 72 hours in the future (the proxy accepts a slightly wider −8/+78-hour window). Elsewhere, the UI falls back to ERA5 historical clear-or-nearly-clear frequency through the proxy.
- Historical planning uses 2001–2025 with ±14 days around the eclipse date and also computes the WMO 1991–2020 standard period for progressive disclosure. Advance the planning period deliberately after validating a complete/finalized new season; the years are currently explicit constants rather than silently rolling.
- Forecast scoring is a pragmatic sorting aid, not a validated probability of eclipse visibility. Raw cloud and terrain values should drive decisions.
- AEMET exposes valid time but not model initialization, so apparent “trend” is comparison with the previous saved digest, not a reliably identified model-run change.
- Exact cloud height is not plotted; forecast scoring uses nominal low/middle/high layer boundaries, while the sightline strip is low-layer cloud percentage by distance and non-cumulative.
- Terrain resolution cannot detect buildings, trees, narrow ridges or local structures. The main badge is green at ≥2° angular terrain clearance, concerning at 0–2°, and obstructed below 0°.
- Current location is a point fix (`getCurrentPosition`), not continuous live tracking.
- AR is an experimental camera overlay, not WebXR or survey-grade navigation. Sensor quality and browser support dominate accuracy.
- Saved plans have no bulk import/export or cloud synchronization.
- The PWA manifest provides home-screen installation, but there is no offline cache/update strategy.
- OpenStreetMap standard tiles are suitable for this modest use, but broader traffic should prompt a tile-provider/usage-policy review.
- The “other eclipses” view finds events visible at the exact observer. It does not yet search paths of totality within a chosen travel radius.

Good candidates for a next design/engineering cycle are provider-neutral weather adapters, saved-plan backup/import, travel-radius/path discovery, a deterministic local test fixture that removes CDN dependence, and splitting the large `app.js` into focused modules without introducing a heavy framework.
