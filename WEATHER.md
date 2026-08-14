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
- `weather/corridor-analysis.js` — curvature-aware, solar-elevation-dependent ±5° wedge construction, 2.5 km sampling, cloud-layer metrics and weather scoring.
- `weather/terrain-analysis.js` — dense near-horizon sampling using public AWS Terrain Tiles (EU-DEM in Asturias).
- `weather/solar-verification.js` — authoritative Astronomy Engine geometry plus an independent SunCalc approximation check.
- `weather/digest.js` — JSON and Markdown digest generation.
- `weather/climatology.js` — ERA5 clear-or-nearly-clear cloud climatology client and ratings outside short-forecast coverage.
- Browser local storage — per-eclipse viewing-location shortlist and user notes; no locale-specific candidates are built into the app.

Map imagery remains direct from AEMET. A failed WMS tile is retried individually at most twice, after approximately 2 and 6 seconds with a small random jitter. The app never refreshes the whole layer in response to a tile failure and reports partial gaps to the user.

Numeric analysis is deliberately on demand. Opening the selected place's **Sightline profile** lazily requests its cloud corridor; refreshing the saved-place comparison batches eligible shortlisted corridors. For the selected eclipse time, the browser uses the two surrounding UTC-hour grids and sends the wedge coordinates in bounded regional batches. The proxy downloads total, low and high regional rasters at the two hours with bounded concurrency and retry, then samples the requested coordinates locally. Identical in-flight requests are coalesced, successful weather responses are cached in memory for 15 minutes, and cached data up to two hours old can be served if an upstream refresh fails. Merely moving the map does not fetch numeric data.

Outside applicable AEMET forecast coverage, the browser sends up to nine locations to the proxy's `/climatology` endpoint. The proxy makes one multi-location Open-Meteo ERA5 request per historical year with bounded concurrency and caches the compact result for 30 days. It samples the eclipse-time UTC hour across ±14 days per year, linearly interpolating between surrounding hourly values. The planning period is 2001–2025; the same upstream batch calculates the WMO 1991–2020 standard normal for progressive disclosure.

All terrain is sampled from the public AWS Terrain Tiles Terrarium pyramid at zoom 11 (about 55 m pixels at Asturias). The proxy coalesces identical tile downloads, applies a global per-instance upstream-concurrency limit, retry and an in-memory tile cache, and rejects requests spanning more than 250 unique tiles. The candidate analysis reports the centre-ray horizon and maxima within ±0.25°, ±0.5° and ±5°. Only the ±0.5° maximum drives clearance/classification; ±5° is contextual. It uses 100 m steps through the first 2 km because nearby ridges dominate this low-Sun problem. The main profile and candidate wedges share the same elevation client and the same 1.7 m eye-height and spherical-Earth-curvature functions.

## Deploy the Google Cloud Run proxy

From the repository root:

```sh
gcloud run deploy eclipse-weather-proxy \
  --source server \
  --region europe-west1 \
  --allow-unauthenticated \
  --env-vars-file server/env.yaml
```

Copy the resulting HTTPS service URL into `config.js`, without a trailing slash, then deploy the static site to GitHub Pages. No API key or secret is required. The proxy validates JSON content type, fields, whole-hour forecast times, point counts, origins and the public AEMET Iberian layer bounds. Accepted weather times are limited to the current forecast window (eight hours behind to 78 hours ahead). A comparison is limited to nine saved locations; the browser divides cloud-eligible sites into regional batches that fit the proxy's four-degree raster limit and divides terrain work into smaller requests. Configure a Cloud Run maximum-instance cap as the hard cost ceiling; application CORS is not authentication or denial-of-service protection.

For local end-to-end testing, start the proxy separately:

```sh
PORT=8787 node server/server.js
```

Then open `http://localhost:8080/?weatherProxy=http://localhost:8787`. The query parameter is a development convenience; production should use `config.js`.

## Metrics and score

For forecast cloud, the app analyses seven rays at offsets −5°, −3°, −1°, 0°, +1°, +3° and +5°. Corridor length comes from solar elevation, spherical-Earth curvature and nominal layer tops at 3 km (low), 8 km (middle) and 15 km (high), capped at 150 km. Numeric scoring samples AEMET low cloud over the low-layer segment, total cloud over the middle-layer segment and high cloud over the high-layer segment. Spatial values use the nearest AEMET raster cell; atmospheric refraction is excluded.

The historical headline is the fraction of samples whose ERA5 total cloud cover is no greater than one okta (⅛ of the sky, 12.5%), framed as “Clear or nearly clear on X% of comparable occasions.” Details disclose the frequency with few clouds or better (no more than two oktas / 25%), median total/low/middle/high cloud, total-cloud interquartile range, sample count and the 1991–2020 standard-period comparison. The earlier WMO 120 W/m² bright-sun metric was removed because its low threshold saturated in partly cloudy locations; an experimental DNI clear-sky ratio was also rejected because its simplified denominator was not the operational NLR method. Total cloud cover is a grid-cell fraction, not a direct probability that cloud will cover the Sun. This is climatology rather than a forecast, and ERA5's approximately 0.25° grid cannot resolve coastal or mountain microclimates.

Both UTC-hour fields surrounding eclipse maximum are retained. The target estimate is a point-by-point linear interpolation using the elapsed fraction of that hour; the UI and digest label it as an approximation, not an AEMET output time.

The provisional score is `100 − penalty`, where the penalty is:

```text
45% low-cloud mean over the low-layer segment
30% total-cloud mean over the middle-layer segment
20% high-cloud mean over the high-layer segment
5% maximum layer p75
```

This score is only a compact sorting aid. Raw components remain visible and should drive decisions. Terrain is classified separately; a terrain-blocked site is always marked unsuitable and cannot rank first. A previous digest is saved in local storage. Five target-time cloud deltas are averaged; more than +10 percentage points is worsening, less than −10 is improving, and the middle range is broadly unchanged.

## Solar geometry check

Astronomy Engine 2.1.19 is authoritative throughout the map, AR, weather wedges and terrain analysis. Azimuth is clockwise from true north, times are UTC instants, and elevation is geometric (no atmospheric refraction). SunCalc remains as an independent lightweight approximation check with a 0.25° guard against time-zone, longitude-sign or azimuth-convention errors. A tighter automated check compares Astronomy Engine against the supplied IMCCE altitudes at Gijón—10.29°, 10.13° and 9.97° around totality—with a 0.03° tolerance.

## Limitations and next steps

- The AEMET cloud UI is shown only for observers in the approximate mainland-Spain/Balearic bounding box and eclipses from three hours ago through 72 hours ahead. ERA5 historical cloud climatology and terrain are global fallbacks.
- The WMS does not expose the model initialization time, so genuine run-to-run comparison cannot be identified reliably yet.
- Cloud-base is available as a visual overlay, but line-of-sight/cloud-base intersection metrics are not included.
- Linear time interpolation smooths percentages but cannot predict cloud advection or formation between model hours.
- Forecasts are model output, not observations, and can change markedly between runs.
- AEMET could change or restrict the AMA endpoint. Only the small Cloud Run proxy should need updating if the upstream interface changes.

The proxy accepts the advertised AEMET Iberian layer domain but rejects comparison batches spanning more than four degrees, preventing accidental country-scale raster downloads. A future gridded-data backend should attach an explicit model-run identifier if obtainable. Keep any future AEMET API key in a Cloud Run environment variable only.

## References

- [AEMET AMA variable viewer](https://ama.aemet.es/visor-de-variables)
- [AEMET HARMONIE-AROME viewer](https://www.aemet.es/es/eltiempo/prediccion/modelosnumericos/harmonie_arome)
- [AEMET HARMONIE-AROME data-download help](https://www.aemet.es/en/eltiempo/prediccion/modelosnumericos/harmonie_arome/ayuda)
- [AEMET OpenData FAQ](https://opendata.aemet.es/centrodedescargas/docs/FAQs130917.pdf)
- [AWS Open Data Terrain Tiles](https://registry.opendata.aws/terrain-tiles/)
- [WMO okta definitions](https://worldweather.wmo.int/oktas.htm)
- [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api)
