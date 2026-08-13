# Eclipse Locator

For the operational snapshot, resumption checklist, deployment state and known technical debt, start with [HANDOVER.md](HANDOVER.md).

A small, mobile-first map for finding the next solar eclipse visible from a chosen location and exploring the Sun's sightline. The static frontend uses Leaflet, OpenStreetMap, SunCalc, Astronomy Engine and Open-Meteo services with no frontend build step or API keys.

When a selected eclipse is within the short forecast horizon and the observer is in Spain, the app provides AEMET HARMONIE-AROME total/low/high-cloud and cloud-base overlays. Outside that coverage it instead shows an ERA5 historical outlook: the frequency of near-clear direct sunlight at the eclipse-time hour during a ±14-day seasonal window, using 2001–2025 for planning and disclosing the 1991–2020 standard normal in details. Near-clear means ERA5 direct normal irradiance reached at least 85% of an NREL-style clear-sky reference. The opening planning screen keeps locally saved places grouped by eclipse, with editable names and notes. Saved groups can be compared on demand with forecast or historical conditions as available plus global terrain analysis. See [WEATHER.md](WEATHER.md) for source discovery, architecture, metrics and limitations.

The selected location, time zone and eclipse are stored in the URL, so **Share this view** can send a restorable link. Locations that are opened, searched or selected on the map are also saved locally under that eclipse. Each saved location has an optional local-only notes field; neither the shortlist nor its notes are uploaded by the static app. Browser Back returns from the map to the opening place-selection screen and steps through map selections.

## Run locally

From this directory, start any static file server:

```sh
python3 -m http.server 8080
```

Then open <http://localhost:8080>. An internet connection is still needed for the Leaflet, SunCalc and Astronomy Engine CDN files, OpenStreetMap tiles, place search and terrain elevation samples.

Cloud overlays require access to `https://ama.aemet.es`. Live numeric site comparison additionally requires the small Google Cloud Run proxy described in [WEATHER.md](WEATHER.md). No AEMET API key is required.

For a desktop interaction harness, open <http://localhost:8080/?test=1>. Test mode selects a fixed Gijón location and simulates camera/orientation readiness plus consistent calibration readings. It is useful for checking the AR panels and five-step calibration wizard, but does not test real camera, compass or iOS permission behaviour.

The automated mobile-sized smoke test is self-contained: `npm run test:ui` starts its own temporary local server, uses the installed Google Chrome, reports browser console errors, checks Astronomy Engine against both SunCalc and the supplied IMCCE altitudes, exercises the planning, weather-digest and filtered-Sun calibration flows, writes screenshots to `test-artifacts/`, and then stops the server.

To view it on an iPhone on the same Wi-Fi network, find the computer's local IP address and open `http://COMPUTER-IP:8080` on the phone. The map and manual observer placement work this way, but browser geolocation generally requires HTTPS (except on `localhost`). For reliable phone geolocation, deploy to an HTTPS host such as GitHub Pages or serve locally with a trusted HTTPS certificate.

## Install on a phone

The site includes a web app manifest, standalone display metadata and home-screen icons. Use **Install on this device** on the opening screen for platform-specific instructions. Compatible Chromium browsers can show a native install prompt; on iPhone, open the site in Safari and use **Share → Add to Home Screen**, with **Open as Web App** enabled. There is deliberately no service worker yet: the installed app still needs an internet connection for its code, maps, terrain and forecasts.

## Browser permissions and limitations

- Geolocation requires user permission and, on normal hostnames/IP addresses, a secure HTTPS context. If it fails, search for a place using the key-free Open-Meteo geocoding service. The map does not load until a location is chosen.
- The next eclipse whose maximum occurs above the local horizon is calculated in the browser. **Choose another eclipse** lists upcoming local events and future total or annular events visible from the selected point.
- Calculated event summaries use the chosen location's time zone when it is available from place search. The sightline time is fixed at the selected eclipse's maximum.
- The optional camera view is shown only when the selected map observer is close to a successful browser geolocation fix. A blue dot denotes that current-ish fix; other selected or shared places use a map pin. Camera mode requires HTTPS and explicit camera and orientation permission. On iOS, permission is requested after tapping **Show eclipse position on my camera**. Compass readings can drift and the browser does not report the camera's exact field of view, so use the optional filtered-Sun calibration rather than treating marker placement as survey-grade.
- Never look directly at the uneclipsed or partially eclipsed Sun without suitable solar viewing protection. Use an appropriate solar filter over the camera lens during partial phases; the phone screen is not eye protection.

## Hosting

The repository can be published directly with GitHub Pages because all files are static. No Google Maps key is needed.

## Eclipse calculations, terrain and experimental AR

Local eclipse circumstances are calculated using [Astronomy Engine](https://github.com/cosinekitty/astronomy). Partial, annular and total eclipses are supported. The event maximum is used as the default map sightline and as the primary AR target; for total and annular events the central phase interval is also displayed.

The terrain profile samples 100 points from public AWS Terrain Tiles via the same caching proxy used by saved-location comparison. It concentrates samples within the first 5 km and extends to the curvature-aware cloud sightline distance. The profile controls end at that full distance rather than a fixed 60 km. Forecast cloud sampling derives the same distance from solar elevation and nominal low/middle/high layer tops at 3, 8 and 15 km, capped at 150 km. Opening **Sightline profile** lazily requests the low-layer portion of a numeric seven-ray cloud corridor for the displayed place; this is separate from the visual WMS map tiles. Both terrain views use the same observer elevation, nominal 1.7 m eye height and spherical-Earth curvature assumptions, but not atmospheric refraction, buildings or vegetation. Terrain results are planning estimates rather than a visibility guarantee.

Saved-location comparison reports the centre-ray horizon and maxima within ±0.25°, ±0.5° and ±5°, using the same terrain source and geometry. The ±0.5° horizon drives clearance and classification; ±5° is context only. It samples at 100 m through the first 2 km, 250 m from 2–5 km and 2.5 km farther out. Clearances are classified as comfortable (>5°), acceptable (2–5°), marginal (0–2°) or blocked (<0°), independently of weather. Up to nine saved locations can be compared; terrain and ERA5 history are global, while AEMET-eligible locations are divided into bounded regional forecast batches.

Elevation data: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/); the source mosaic uses EU-DEM in Asturias and other documented sources elsewhere.

The experimental AR mode uses `getUserMedia()` for the rear camera and `DeviceOrientationEvent` for heading and pitch. Its phase times and Sun positions come from the calculated local eclipse. Off-screen navigation points to totality, annularity or maximum partial eclipse as appropriate. This is a directional planning aid rather than survey-grade AR. WebXR immersive AR support on iPhone Safari remains limited, so a camera-video overlay is the more portable approach.

Camera and orientation permission requests are initiated together from the AR button gesture for iOS compatibility. On Android, the app prefers `deviceorientationabsolute` and calculates the rear-camera direction from alpha, beta and gamma; relative-only orientation is rejected because it cannot place an eclipse against true north. There is no additional compass-heading permission that a website can request, although Chrome's **Settings → Site settings → Motion sensors** setting must allow access. A device may contain a magnetometer without its browser exposing north-referenced orientation. Readings are briefly averaged to reduce jitter. Markers remain hidden until camera playback begins, multiple finite absolute-or-iOS-compass samples arrive and the phone registers some movement. Where iOS reports compass accuracy, poor readings produce a warning or temporarily prevent the overlay from appearing.

AR calibration requires both a visible Sun and a suitable filter secured over the camera lens. Place the Sun on five guided screen targets; the app averages recent orientation readings and fits compass/pitch offsets plus horizontal and vertical camera field of view. Only the latest calibration is retained locally. Its camera field of view is reused on later sessions, but its compass/pitch correction is not, because magnetic conditions can change substantially between sessions and locations.
