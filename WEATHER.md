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
- Point values: WMS `GetFeatureInfo`, exposed as `GRAY_INDEX`. The app uses GeoServer's `text/javascript` response so a static GitHub Pages site can obtain values without CORS access or an API key.
- CRS: EPSG:4326 / CRS:84.
- Domain advertised by the cloud layers: longitude −14.025…6.025, latitude 33.475…46.525.
- Current valid-time dimension: hourly. On 11 August 2026 the service advertised 11 August 00:00 UTC through 14 August 00:00 UTC, including the eclipse window.
- Resolution: AEMET's HARMONIE-AROME download help states 0.025° for cloud and most other raster fields (roughly 2–3 km here).
- Model runs: AEMET documents 00, 06, 12 and 18 UTC runs and a nominal 48-hour range. The public WMS exposes forecast valid time but not model initialization/reference time, so the app does not invent a run timestamp.

AEMET OpenData itself is not used. Its July 2025 FAQ says numerical-model outputs are not considered OpenData. The AMA WMS is nevertheless a public, keyless endpoint used by AEMET's own viewer. This makes it convenient but less contractually stable than a documented OpenData product.

## Browser architecture

The WMS imagery needs no backend. Safari blocks the cross-origin JavaScript response used for numeric point sampling, so numeric corridor analysis uses the small proxy in `server/`:

- `weather/aemet-client.js` — WMS overlay configuration and batched proxy access.
- `weather/corridor-analysis.js` — geodesic ray construction, 2.5 km sampling, component metrics and experimental scoring.
- `weather/digest.js` — JSON and Markdown digest generation.
- `data/candidates.js` — editable Asturias candidate list.

Numeric analysis is deliberately on demand. The browser makes six batched proxy requests. The proxy resolves six candidates × 21 points × two fields as 252 small AEMET `GetFeatureInfo` requests with a concurrency limit of ten and a five-minute in-memory cache. Moving the map does not trigger new weather requests.

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

For total and low cloud, the app exposes observer value plus mean and maximum values within 10, 25 and 50 km along the forecast Sun azimuth. Values are nearest AEMET model grid values; there is no spatial or temporal interpolation.

The provisional score is `100 − penalty`, where the penalty is:

```text
38% low-cloud mean, first 10 km
22% low-cloud mean, first 25 km
16% total-cloud mean, first 25 km
14% total-cloud mean, first 50 km
10% low-cloud maximum, first 25 km
```

This score is only a compact sorting aid. Raw components remain visible and should drive decisions.

## Limitations and next steps

- The WMS does not expose the model initialization time, so genuine run-to-run comparison cannot be identified reliably yet.
- Cloud-base is available as a visual overlay, but line-of-sight/cloud-base intersection metrics are not in the urgent first slice.
- The 18:25–18:30 UTC eclipse instant is represented by the 18:00 or 19:00 hourly model field; no time interpolation is performed.
- Forecasts are model output, not observations, and can change markedly between runs.
- AEMET could change or restrict the AMA endpoint. Only the small Cloud Run proxy should need updating if the upstream interface changes.

The current proxy allows a slightly wider box (longitude −7…−4, latitude 42.5…44.2) because a 50 km WNW sightline from Avilés extends beyond the initial −6.3 longitude boundary. A future gridded-data backend should attach an explicit model-run identifier if obtainable. Keep any future AEMET API key in a Cloud Run environment variable only.

## References

- [AEMET AMA variable viewer](https://ama.aemet.es/visor-de-variables)
- [AEMET HARMONIE-AROME viewer](https://www.aemet.es/es/eltiempo/prediccion/modelosnumericos/harmonie_arome)
- [AEMET HARMONIE-AROME data-download help](https://www.aemet.es/en/eltiempo/prediccion/modelosnumericos/harmonie_arome/ayuda)
- [AEMET OpenData FAQ](https://opendata.aemet.es/centrodedescargas/docs/FAQs130917.pdf)
