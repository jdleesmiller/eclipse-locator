# AEMET cloud forecast integration

## Source discovery

The urgent implementation uses the public GeoServer behind AEMET's AMA aviation variable viewer:

- Viewer: `https://ama.aemet.es/visor-de-variables`
- WMS: `https://ama.aemet.es/geoserver/wms`
- Authentication: none
- Published cloud layers:
  - `ama_netcdf:ama_pen_cob_nub` — total cloud cover (%)
  - `ama_netcdf:ama_pen_cob_nub_bajas` — low cloud cover (%)
  - `ama_netcdf:ama_pen_cob_nub_altas` — high cloud cover (%)
  - `ama_netcdf:ama_pen_base_nub` — cloud base (thousands of feet)
- Map format: OGC WMS, including transparent PNG.
- Point values: WMS `GetFeatureInfo`, exposed as `GRAY_INDEX` (retained as a compatibility endpoint).
- Regional values: WCS 2.0.1 `GetCoverage` as small GeoTIFF rasters. AEMET does not send a CORS permission header for WCS, so the Cloud Run proxy downloads and samples these rasters.
- CRS: EPSG:4326 / CRS:84.
- Domain advertised by the cloud layers: longitude −14.025…6.025, latitude 33.475…46.525.
- Current valid-time dimension: hourly. On 11 August 2026 the service advertised 11 August 00:00 UTC through 14 August 00:00 UTC, including the eclipse window.
- Resolution: AEMET's HARMONIE-AROME download help states 0.025° for cloud and most other raster fields (roughly 2–3 km here).
- Model runs: AEMET documents 00, 06, 12 and 18 UTC runs and a nominal 48-hour range. The public WMS exposes forecast valid time but not model initialization/reference time, so the app does not invent a run timestamp.

AEMET OpenData itself is not used. Its July 2025 FAQ says numerical-model outputs are not considered OpenData. The AMA WMS is nevertheless a public, keyless endpoint used by AEMET's own viewer. This makes it convenient but less contractually stable than a documented OpenData product.

## Browser architecture

The WMS imagery needs no backend. Safari blocks the cross-origin JavaScript response used for numeric point sampling, so numeric corridor analysis uses the small proxy in `server/`:

- `weather/aemet-client.js` — WMS overlay configuration and batched proxy access.
- `weather/corridor-analysis.js` — geodesic ±5° wedge construction, 2.5 km sampling, hourly/interpolated metrics and weather scoring.
- `weather/terrain-analysis.js` — dense near-horizon sampling using public AWS Terrain Tiles (EU-DEM in Asturias).
- `weather/solar-verification.js` — authoritative Astronomy Engine geometry plus an independent SunCalc approximation check.
- `weather/digest.js` — JSON and Markdown digest generation.
- `data/candidates.js` — seven-site shortlist: six pinned from the official Eclipse Asturias observation-point feed plus Oviedo's municipal summit site on Monte Naranco, including source and mobility links.

Map imagery remains direct from AEMET. A failed WMS tile is retried individually at most twice, after approximately 2 and 6 seconds with a small random jitter. The app never refreshes the whole layer in response to a tile failure and reports partial gaps to the user.

Numeric analysis is deliberately on demand. The browser sends all candidate wedge coordinates in one bounded request. The proxy downloads four small regional rasters—total and low cloud at 18:00 and 19:00 UTC—with two-at-a-time concurrency, three-attempt upstream retry and a five-minute in-memory cache. It then samples the requested coordinates locally. This replaces more than a thousand potential `GetFeatureInfo` calls while preserving the existing WMS pipeline and point endpoint. Moving the map does not trigger analysis.

All terrain is sampled from the public AWS Terrain Tiles Terrarium pyramid at zoom 11 (about 55 m pixels at Asturias). The proxy downloads each unique PNG tile once, with four-at-a-time concurrency, retry and an in-memory tile cache, then decodes requested elevations locally. The candidate analysis reports the centre-ray horizon and maxima within ±0.25°, ±0.5° and ±5°. Only the ±0.5° maximum drives clearance/classification; ±5° is contextual. It uses 100 m steps through the first 2 km because nearby ridges dominate this low-Sun problem. The main profile and candidate wedges share the same elevation client and the same 1.7 m eye-height and spherical-Earth-curvature functions.

## Deploy the Google Cloud Run proxy

From the repository root:

```sh
gcloud run deploy eclipse-weather-proxy \
  --source server \
  --region europe-west1 \
  --allow-unauthenticated \
  --env-vars-file server/env.yaml
```

Copy the resulting HTTPS service URL into `config.js`, without a trailing slash, then deploy the static site to GitHub Pages. No API key or secret is required. The proxy validates fields, valid times, point counts, origins, and an Asturias-area bounding box.

For local end-to-end testing, start the proxy separately:

```sh
PORT=8787 node server/server.js
```

Then open `http://localhost:8080/?weatherProxy=http://localhost:8787`. The query parameter is a development convenience; production should use `config.js`.

## Metrics and score

For total and low cloud, the app analyses seven rays at offsets −5°, −3°, −1°, 0°, +1°, +3° and +5°. At 10, 25 and 50 km it reports centre-ray mean plus wedge mean, 75th percentile and maximum. Spatial values use the nearest AEMET raster cell.

Both the 18:00 and 19:00 UTC model fields are retained. The 18:27 target estimate is a point-by-point linear interpolation with fraction `27/60 = 0.45`; the UI and digest label it as an approximation, not an AEMET output time.

The provisional score is `100 − penalty`, where the penalty is:

```text
38% low-cloud wedge mean, first 10 km
22% low-cloud wedge mean, first 25 km
16% total-cloud wedge mean, first 25 km
14% total-cloud wedge mean, first 50 km
10% low-cloud wedge p75, first 25 km
```

This score is only a compact sorting aid. Raw components remain visible and should drive decisions. Terrain is classified separately; a terrain-blocked site is always marked unsuitable and cannot rank first. A previous digest is saved in local storage. Five target-time cloud deltas are averaged; more than +10 percentage points is worsening, less than −10 is improving, and the middle range is broadly unchanged.

## Solar geometry check

Astronomy Engine 2.1.19 is authoritative throughout the map, AR, weather wedges and terrain analysis. Azimuth is clockwise from true north, times are UTC instants, and elevation is geometric (no atmospheric refraction). SunCalc remains as an independent lightweight approximation check with a 0.25° guard against time-zone, longitude-sign or azimuth-convention errors. A tighter automated check compares Astronomy Engine against the supplied IMCCE altitudes at Gijón—10.29°, 10.13° and 9.97° around totality—with a 0.03° tolerance.

## Limitations and next steps

- The WMS does not expose the model initialization time, so genuine run-to-run comparison cannot be identified reliably yet.
- Cloud-base is available as a visual overlay, but line-of-sight/cloud-base intersection metrics are not included.
- Linear time interpolation smooths percentages but cannot predict cloud advection or formation between model hours.
- Forecasts are model output, not observations, and can change markedly between runs.
- AEMET could change or restrict the AMA endpoint. Only the small Cloud Run proxy should need updating if the upstream interface changes.

The current proxy allows a slightly wider box (longitude −7…−4, latitude 42.5…44.2) because a 50 km WNW sightline from Avilés extends beyond the initial −6.3 longitude boundary. A future gridded-data backend should attach an explicit model-run identifier if obtainable. Keep any future AEMET API key in a Cloud Run environment variable only.

## References

- [AEMET AMA variable viewer](https://ama.aemet.es/visor-de-variables)
- [AEMET HARMONIE-AROME viewer](https://www.aemet.es/es/eltiempo/prediccion/modelosnumericos/harmonie_arome)
- [AEMET HARMONIE-AROME data-download help](https://www.aemet.es/en/eltiempo/prediccion/modelosnumericos/harmonie_arome/ayuda)
- [AEMET OpenData FAQ](https://opendata.aemet.es/centrodedescargas/docs/FAQs130917.pdf)
- [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
