(function () {
  function createDigest({ validTime, azimuthDeg, elevationDeg, candidates, warnings = [] }) {
    return {
      retrievedAt: new Date().toISOString(),
      source: "AEMET AMA HARMONIE-AROME public WMS",
      dataset: "ama_netcdf cloud-cover layers",
      modelRun: null,
      modelRunNote: "Initialization time is not exposed by the public WMS capabilities.",
      validTime,
      localTime: new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid", timeZoneName: "short" }).format(new Date(validTime)),
      sampling: { spacingKm: EclipseWeather.SAMPLE_SPACING_KM, method: "AEMET model grid value via WMS GetFeatureInfo; no interpolation" },
      sun: { azimuthDeg: Number(azimuthDeg.toFixed(1)), elevationDeg: Number(elevationDeg.toFixed(1)) },
      candidates: candidates.map(({ name, lat, lng, score, metrics }) => ({ name, lat, lng, score, ...metrics })),
      warnings,
    };
  }

  function digestMarkdown(digest) {
    const lines = [
      `# Eclipse cloud digest`,
      `AEMET HARMONIE-AROME · valid ${digest.validTime} (${digest.localTime})`,
      `Sun ${digest.sun.azimuthDeg}° azimuth / ${digest.sun.elevationDeg}° elevation`, "",
    ];
    for (const candidate of digest.candidates) {
      lines.push(`- ${candidate.name}: score ${candidate.score}/100; low cloud observer ${candidate.lowCloudAtObserverPct}%; low mean 10/25/50 km ${candidate.low.km10.mean}/${candidate.low.km25.mean}/${candidate.low.km50.mean}%; total mean 10/25/50 km ${candidate.total.km10.mean}/${candidate.total.km25.mean}/${candidate.total.km50.mean}%`);
    }
    lines.push("", "Model initialization time is not exposed by this WMS. Scores are experimental; inspect the component values.");
    return lines.join("\n");
  }

  window.EclipseWeather = window.EclipseWeather || {};
  Object.assign(window.EclipseWeather, { createDigest, digestMarkdown });
}());
