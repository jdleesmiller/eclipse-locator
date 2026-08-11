# Eclipse Locator

A small, mobile-first map for finding the next solar eclipse visible from a chosen location and exploring the Sun's sightline. The static frontend uses Leaflet, OpenStreetMap, SunCalc, Astronomy Engine and Open-Meteo services with no frontend build step or API keys.

For the 12 August 2026 eclipse it also provides live AEMET HARMONIE-AROME total/low/high-cloud and cloud-base overlays, plus on-demand cloud-wedge and terrain-horizon comparisons for six Asturias viewing sites. See [WEATHER.md](WEATHER.md) for source discovery, architecture, metrics and limitations.

## Run locally

From this directory, start any static file server:

```sh
python3 -m http.server 8080
```

Then open <http://localhost:8080>. An internet connection is still needed for the Leaflet, SunCalc and Astronomy Engine CDN files, OpenStreetMap tiles, place search and terrain elevation samples.

Cloud overlays require access to `https://ama.aemet.es`. Live numeric site comparison additionally requires the small Google Cloud Run proxy described in [WEATHER.md](WEATHER.md). No AEMET API key is required.

For a desktop interaction harness, open <http://localhost:8080/?test=1>. Test mode selects a fixed Gijón location and simulates camera/orientation readiness plus consistent calibration readings. It is useful for checking the AR panels and five-step calibration wizard, but does not test real camera, compass or iOS permission behaviour.

With the local server running, the automated mobile-sized smoke test can be run with `npm run test:ui`. It uses the installed Google Chrome, reports browser console errors, verifies SunCalc against Astronomy Engine at 18:00, 18:27 and 19:00 UTC, exercises the weather digest and filtered-Sun calibration flow, and writes screenshots to `test-artifacts/`.

To view it on an iPhone on the same Wi-Fi network, find the computer's local IP address and open `http://COMPUTER-IP:8080` on the phone. The map and manual observer placement work this way, but browser geolocation generally requires HTTPS (except on `localhost`). For reliable phone geolocation, deploy to an HTTPS host such as GitHub Pages or serve locally with a trusted HTTPS certificate.

## Browser permissions and limitations

- Geolocation requires user permission and, on normal hostnames/IP addresses, a secure HTTPS context. If it fails, search for a place using the key-free Open-Meteo geocoding service. The map does not load until a location is chosen.
- The next eclipse whose maximum occurs above the local horizon is calculated in the browser. **Explore other eclipses** lists upcoming local events and future total or annular events visible from the selected point.
- Calculated event summaries use the chosen location's time zone when it is available from place search. The sightline time is fixed at the selected eclipse's maximum.
- The optional AR camera view requires HTTPS and explicit camera and orientation permission. On iOS, permission is requested after tapping **Preview direction in AR**. Compass readings can drift and the browser does not report the camera's exact field of view, so use the optional filtered-Sun calibration rather than treating marker placement as survey-grade.
- Never look directly at the uneclipsed or partially eclipsed Sun without suitable solar viewing protection. Use an appropriate solar filter over the camera lens during partial phases; the phone screen is not eye protection.

## Hosting

The repository can be published directly with GitHub Pages because all files are static. No Google Maps key is needed.

## Eclipse calculations, terrain and experimental AR

Local eclipse circumstances are calculated using [Astronomy Engine](https://github.com/cosinekitty/astronomy). Partial, annular and total eclipses are supported. The event maximum is used as the default map sightline and as the primary AR target; for total and annular events the central phase interval is also displayed.

The terrain profile samples 100 points from the Open-Meteo Elevation API. The first 5 km is sampled about every 91 m to match the useful resolution of the 90 m Copernicus digital elevation model; the remaining samples cover 5–60 km. The chart can switch between 5, 20 and 60 km views, each with its own vertical scale. The sightline comparison includes observer elevation, a nominal 1.7 m eye height and Earth curvature, but not atmospheric refraction, buildings or vegetation. Terrain results are planning estimates rather than a visibility guarantee.

The six-site weather comparison performs a separate horizon calculation across the same ±5° Sun-facing wedge using public AWS Terrain Tiles (EU-DEM in Asturias). It samples at 100 m through the first 2 km, 250 m from 2–5 km and 2.5 km farther out. This candidate comparison uses the simple geometric `atan2` angle requested for easy auditing; it intentionally excludes curvature, buildings and vegetation. Clearances are classified as comfortable (>5°), acceptable (2–5°), marginal (0–2°) or blocked (<0°), independently of the cloud score.

Elevation data: [Open-Meteo](https://open-meteo.com/en/docs/elevation-api), using the Copernicus DEM.

The experimental AR mode uses `getUserMedia()` for the rear camera and `DeviceOrientationEvent` for heading and pitch. Its phase times and Sun positions come from the calculated local eclipse. Off-screen navigation points to totality, annularity or maximum partial eclipse as appropriate. This is a directional planning aid rather than survey-grade AR. WebXR immersive AR support on iPhone Safari remains limited, so a camera-video overlay is the more portable approach.

Camera and orientation permission requests are initiated together from the AR button gesture for iOS compatibility. Markers remain hidden until camera playback begins, multiple finite orientation samples arrive and the phone registers some movement. Where iOS reports compass accuracy, poor readings produce a warning or temporarily prevent the overlay from appearing.

AR calibration uses the current calculated Sun as a reference. With a suitable filter secured over the camera lens, place the Sun on five guided screen targets. The app averages recent orientation readings and fits compass/pitch offsets plus horizontal and vertical camera field of view. Results and camera metadata are stored only in the browser's local storage; up to 20 calibrations can be selected, reapplied or deleted. Recalibrate when changing location or magnetic surroundings because a saved camera FOV is generally more stable than a saved compass correction.
