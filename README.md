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
- Device orientation and camera access are not used in this version. On iOS they require HTTPS and explicit user gestures/permission; compass readings also require calibration and are not precise enough to be the only alignment method.

## Hosting

The repository can be published directly with GitHub Pages because all files are static. No Google Maps key is needed.

## Future terrain and AR work

The terrain profile samples 100 points from the Open-Meteo Elevation API. The first 5 km is sampled about every 91 m to match the useful resolution of the 90 m Copernicus digital elevation model; the remaining samples cover 5–60 km. The chart can switch between 5, 20 and 60 km views, each with its own vertical scale. The sightline comparison includes observer elevation, a nominal 1.7 m eye height and Earth curvature, but not atmospheric refraction, buildings or vegetation. Terrain results are planning estimates rather than a visibility guarantee.

Elevation data: [Open-Meteo](https://open-meteo.com/en/docs/elevation-api), using the Copernicus DEM.

A web-based AR mode is feasible in a limited form: use `getUserMedia()` for the camera, geolocation, and `DeviceOrientationEvent` for heading/pitch, then draw eclipse waypoints over the video. iOS requires HTTPS and user-granted camera/orientation permissions. Sensor heading and pitch drift can make overlays visibly inaccurate, so a practical version should include horizon/landmark calibration. WebXR immersive AR support on iPhone Safari is limited; a camera-video overlay is the more portable web approach.
