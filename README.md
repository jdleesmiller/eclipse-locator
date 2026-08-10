# Eclipse Locator

A small, mobile-first map for finding the next solar eclipse visible from a chosen location and exploring the Sun's sightline. It uses Leaflet, OpenStreetMap, SunCalc, Astronomy Engine and Open-Meteo services, with no API keys or build step.

## Run locally

From this directory, start any static file server:

```sh
python3 -m http.server 8080
```

Then open <http://localhost:8080>. An internet connection is still needed for the Leaflet, SunCalc and Astronomy Engine CDN files, OpenStreetMap tiles, place search and terrain elevation samples.

To view it on an iPhone on the same Wi-Fi network, find the computer's local IP address and open `http://COMPUTER-IP:8080` on the phone. The map and manual observer placement work this way, but browser geolocation generally requires HTTPS (except on `localhost`). For reliable phone geolocation, deploy to an HTTPS host such as GitHub Pages or serve locally with a trusted HTTPS certificate.

## Browser permissions and limitations

- Geolocation requires user permission and, on normal hostnames/IP addresses, a secure HTTPS context. If it fails, search for a place using the key-free Open-Meteo geocoding service. The map does not load until a location is chosen.
- The next eclipse whose maximum occurs above the local horizon is calculated in the browser. Use **Next eclipse** to advance to another event or **Next total/annular** to skip partial eclipses.
- Calculated event summaries use the chosen location's time zone when it is available from place search. The editable date/time input is interpreted in the browser/device's current time zone, which matters when exploring a remote location.
- The optional AR camera view requires HTTPS and explicit camera and orientation permission. On iOS, permission is requested after tapping the **AR** button. Compass readings can drift and the browser does not report the camera's exact field of view, so use the calibration and camera-width controls rather than treating marker placement as survey-grade.
- Never look directly at the uneclipsed or partially eclipsed Sun without suitable solar viewing protection. Use an appropriate solar filter over the camera lens during partial phases; the phone screen is not eye protection.

## Hosting

The repository can be published directly with GitHub Pages because all files are static. No Google Maps key is needed.

## Eclipse calculations, terrain and experimental AR

Local eclipse circumstances are calculated using [Astronomy Engine](https://github.com/cosinekitty/astronomy). Partial, annular and total eclipses are supported. The event maximum is used as the default map sightline and as the primary AR target; for total and annular events the central phase interval is also displayed.

The terrain profile samples 100 points from the Open-Meteo Elevation API. The first 5 km is sampled about every 91 m to match the useful resolution of the 90 m Copernicus digital elevation model; the remaining samples cover 5–60 km. The chart can switch between 5, 20 and 60 km views, each with its own vertical scale. The sightline comparison includes observer elevation, a nominal 1.7 m eye height and Earth curvature, but not atmospheric refraction, buildings or vegetation. Terrain results are planning estimates rather than a visibility guarantee.

Elevation data: [Open-Meteo](https://open-meteo.com/en/docs/elevation-api), using the Copernicus DEM.

The experimental AR mode uses `getUserMedia()` for the rear camera and `DeviceOrientationEvent` for heading and pitch. Its phase times and Sun positions come from the calculated local eclipse. Off-screen navigation points to totality, annularity or maximum partial eclipse as appropriate. This is a directional planning aid rather than survey-grade AR. WebXR immersive AR support on iPhone Safari remains limited, so a camera-video overlay is the more portable approach.

Camera and orientation permission requests are initiated together from the AR button gesture for iOS compatibility. Markers remain hidden until camera playback begins, multiple finite orientation samples arrive and the phone registers some movement. Where iOS reports compass accuracy, poor readings produce a warning or temporarily prevent the overlay from appearing.

AR calibration uses the current calculated Sun as a reference. With a suitable filter secured over the camera lens, place the Sun on five guided screen targets. The app averages recent orientation readings and fits compass/pitch offsets plus horizontal and vertical camera field of view. Results and camera metadata are stored only in the browser's local storage; up to 20 calibrations can be selected, reapplied or deleted. Recalibrate when changing location or magnetic surroundings because a saved camera FOV is generally more stable than a saved compass correction.
