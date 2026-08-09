# Gijón Eclipse Locator

A small, mobile-first map for exploring the Sun's sightline near the 12 August 2026 total solar eclipse. It uses Leaflet, OpenStreetMap, SunCalc and Open-Meteo elevation data, with no API keys or build step.

## Run locally

From this directory, start any static file server:

```sh
python3 -m http.server 8080
```

Then open <http://localhost:8080>. An internet connection is still needed for the Leaflet/SunCalc CDN files, OpenStreetMap tiles and terrain elevation samples.

To view it on an iPhone on the same Wi-Fi network, find the computer's local IP address and open `http://COMPUTER-IP:8080` on the phone. The map and manual observer placement work this way, but browser geolocation generally requires HTTPS (except on `localhost`). For reliable phone geolocation, deploy to an HTTPS host such as GitHub Pages or serve locally with a trusted HTTPS certificate.

## Browser permissions and limitations

- Geolocation requires user permission and, on normal hostnames/IP addresses, a secure HTTPS context. If it fails, the app falls back to central Gijón; the observer marker can also be dragged or positioned with **Set observer on map**.
- The selected date/time is interpreted in the browser/device's current time zone. Set an iPhone to Spain time when using the 20:27 default, or adjust the input for its active time zone.
- The optional AR camera view requires HTTPS and explicit camera and orientation permission. On iOS, permission is requested after tapping the **AR** button. Compass readings can drift and the browser does not report the camera's exact field of view, so use the calibration and camera-width controls rather than treating marker placement as survey-grade.
- Never look directly at the uneclipsed or partially eclipsed Sun without suitable solar viewing protection. Use an appropriate solar filter over the camera lens during partial phases; the phone screen is not eye protection.

## Hosting

The repository can be published directly with GitHub Pages because all files are static. No Google Maps key is needed.

## Terrain and experimental AR

The terrain profile samples 100 points from the Open-Meteo Elevation API. The first 5 km is sampled about every 91 m to match the useful resolution of the 90 m Copernicus digital elevation model; the remaining samples cover 5–60 km. The chart can switch between 5, 20 and 60 km views, each with its own vertical scale. The sightline comparison includes observer elevation, a nominal 1.7 m eye height and Earth curvature, but not atmospheric refraction, buildings or vegetation. Terrain results are planning estimates rather than a visibility guarantee.

Elevation data: [Open-Meteo](https://open-meteo.com/en/docs/elevation-api), using the Copernicus DEM.

The experimental AR mode uses `getUserMedia()` for the rear camera and `DeviceOrientationEvent` for heading and pitch. It overlays approximate Gijón contact times for the partial and total phases, with off-screen navigation pointing to totality. The hard-coded contact times are local circumstances for central Gijón; the Sun positions are recalculated for the chosen observer location. This is a directional planning aid, not a precision eclipse-contact calculator. WebXR immersive AR support on iPhone Safari remains limited, so a camera-video overlay is the more portable approach.

AR calibration uses the current calculated Sun as a reference. With a suitable filter secured over the camera lens, place the Sun on five guided screen targets. The app averages recent orientation readings and fits compass/pitch offsets plus horizontal and vertical camera field of view. Results and camera metadata are stored only in the browser's local storage; up to 20 calibrations can be selected, reapplied or deleted. Recalibrate when changing location or magnetic surroundings because a saved camera FOV is generally more stable than a saved compass correction.
