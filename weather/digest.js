(function () {
  const TREND_THRESHOLD_PCT = 10;

  function candidateMetrics(candidate) {
    const target = candidate.weather?.target;
    if (!target) return null;
    return {
      cloudAtObserverPct: target.cloudAtObserverPct,
      lowCloudAtObserverPct: target.lowCloudAtObserverPct,
      lowCloud10kmPct: target.low.km10.wedgeMean,
      lowCloud25kmPct: target.low.km25.wedgeMean,
      lowCloud50kmPct: target.low.km50.wedgeMean,
    };
  }

  function trendAgainst(candidate, previousDigest) {
    const previous = previousDigest?.candidates?.find((item) => candidate.id && item.id ? item.id === candidate.id : item.name === candidate.name);
    const currentMetrics = candidateMetrics(candidate);
    const previousMetrics = previous ? candidateMetrics(previous) : null;
    if (!currentMetrics || !previousMetrics) return { previousRunAvailable: false, classification: "unavailable", thresholdPctPoints: TREND_THRESHOLD_PCT };
    const deltas = Object.fromEntries(Object.keys(currentMetrics).map((key) => [key.replace(/Pct$/, "DeltaPct"), Math.round(currentMetrics[key] - previousMetrics[key])]));
    const meanDeltaPct = Object.values(deltas).reduce((sum, value) => sum + value, 0) / Object.values(deltas).length;
    return {
      previousRunAvailable: true,
      previousRetrievedAt: previousDigest.retrievedAt,
      ...deltas,
      meanDeltaPct: Number(meanDeltaPct.toFixed(1)),
      thresholdPctPoints: TREND_THRESHOLD_PCT,
      classification: meanDeltaPct > TREND_THRESHOLD_PCT ? "worsening" : meanDeltaPct < -TREND_THRESHOLD_PCT ? "improving" : "broadly unchanged",
    };
  }

  function overallFor(candidate) {
    const terrain = candidate.terrain.classification;
    const weather = candidate.weatherRating;
    const climate = candidate.climateRating;
    let recommendation;
    if (terrain === "blocked") recommendation = "unsuitable";
    else if (!candidate.weather && candidate.climatology) {
      if (terrain === "marginal" || climate === "concerning") recommendation = "risky";
      else if ((terrain === "comfortable" || terrain === "acceptable") && climate === "favourable") recommendation = "strong candidate";
      else recommendation = "viable";
    }
    else if (!candidate.weather) recommendation = terrain === "marginal" ? "risky" : "terrain only";
    else if (terrain === "marginal" || weather === "poor") recommendation = "risky";
    else if ((terrain === "comfortable" || terrain === "acceptable") && (weather === "excellent" || weather === "good")) recommendation = "strong candidate";
    else recommendation = "viable";
    return { weatherRating: weather, climateRating: climate || null, terrainRating: terrain, trendRating: candidate.trend.classification, recommendation };
  }

  function lowCloudDistanceProfile(candidate) {
    const groups = new Map();
    const lowLayerEndKm = candidate.weather?.geometry?.layers?.low?.toKm ?? Infinity;
    for (const sample of candidate.debug?.samples || []) {
      if (!Number.isFinite(sample.distanceKm) || sample.distanceKm > lowLayerEndKm || !Number.isFinite(sample.lowTarget)) continue;
      const values = groups.get(sample.distanceKm) || [];
      values.push(sample.lowTarget);
      groups.set(sample.distanceKm, values);
    }
    return [...groups].map(([distanceKm, values]) => ({
      distanceKm,
      lowCloudPct: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)),
    })).sort((a, b) => a.distanceKm - b.distanceKm);
  }

  function enrichCandidates(candidates, previousDigest) {
    const rank = { "strong candidate": 4, viable: 3, "terrain only": 2, risky: 1, unsuitable: 0 };
    return candidates.map((candidate) => {
      const trend = trendAgainst(candidate, previousDigest);
      const enriched = { ...candidate, trend };
      return { ...enriched, overall: overallFor(enriched) };
    }).sort((a, b) => rank[b.overall.recommendation] - rank[a.overall.recommendation] || (b.score ?? -1) - (a.score ?? -1));
  }

  function createDigest({ sun, candidates, targetTime, warnings = [], includeDebug = false }) {
    const forecastCandidate = candidates.find((candidate) => candidate.weather);
    const hasClimatology = candidates.some((candidate) => candidate.climatology);
    const times = forecastCandidate?.weather.times || EclipseWeather.forecastWindow(targetTime);
    return {
      schemaVersion: 3,
      retrievedAt: new Date().toISOString(),
      source: `${forecastCandidate ? "AEMET AMA HARMONIE-AROME public WCS/WMS; " : ""}${hasClimatology ? "ERA5 via Open-Meteo; " : ""}AWS Terrain Tiles`,
      dataset: `${forecastCandidate ? "ama_netcdf total/low/high cloud cover; " : ""}${hasClimatology ? "ERA5 direct-normal irradiance and total/low/middle/high cloud; " : ""}Terrarium terrain tiles`,
      modelRun: null,
      modelRunNote: "Initialization time is not exposed by the public AEMET services.",
      validTimes: times,
      interpolation: forecastCandidate
        ? { applied: true, method: "linear interpolation of each grid-cell percentage", fractionAfter: times.fractionAfter, label: "Target-time approximation; not an AEMET model output time" }
        : { applied: false, method: null, fractionAfter: null, label: "Historical eclipse-time climatology" },
      sun: {
        azimuthDeg: Number(sun.azimuthDeg.toFixed(2)), elevationDeg: Number(sun.elevationDeg.toFixed(2)),
        calculationEngine: "Astronomy Engine 2.1.19",
        verifiedAgainst: sun.verifiedAgainst, reference: sun.reference,
        azimuthDifferenceDeg: Number(sun.azimuthDifferenceDeg.toFixed(4)), elevationDifferenceDeg: Number(sun.elevationDifferenceDeg.toFixed(4)),
        convention: sun.convention,
      },
      wedge: { halfWidthDeg: EclipseWeather.WEDGE_HALF_WIDTH_DEG, rayOffsetsDeg: EclipseWeather.RAY_OFFSETS_DEG, nominalRaySpacingDeg: 2, distanceSpacingKm: EclipseWeather.SAMPLE_SPACING_KM },
      terrainSampling: { rayOffsetsDeg: EclipseWeather.TERRAIN_RAY_OFFSETS_DEG, classificationHalfWidthDeg: EclipseWeather.TERRAIN_CLASSIFICATION_HALF_WIDTH_DEG, contextHalfWidthDeg: 5, nearSpacingKm: EclipseWeather.TERRAIN_NEAR_SPACING_KM, maxDistanceKm: 50, eyeHeightM: EclipseWeather.TERRAIN_EYE_HEIGHT_M, earthCurvature: true, atmosphericRefraction: false, safetyMarginDeg: 2 },
      candidates: candidates.map((candidate) => ({
        id: candidate.id, name: candidate.name, notes: candidate.notes || "", lat: candidate.lat, lng: candidate.lng,
        sun: { azimuthDeg: Number(candidate.azimuthDeg.toFixed(2)), elevationDeg: Number(candidate.sunElevationDeg.toFixed(2)) },
        terrain: includeDebug ? candidate.terrain : { ...candidate.terrain, debugSamples: undefined },
        weather: candidate.weather,
        climatology: candidate.climatology || null,
        cloudUnavailableReason: candidate.cloudUnavailableReason || null,
        lowCloudDistanceProfile: lowCloudDistanceProfile(candidate),
        trend: candidate.trend,
        overall: { ...candidate.overall, weatherScore: candidate.score ?? null },
        ...(includeDebug ? { debug: candidate.debug } : {}),
      })),
      warnings,
    };
  }

  function digestMarkdown(digest) {
    const lines = [
      "# Eclipse weather digest",
      `Target: ${digest.validTimes.target}${digest.interpolation.applied ? ` (interpolated approximation between AEMET ${digest.validTimes.before} and ${digest.validTimes.after} grids)` : " (historical eclipse-time climatology)"}`,
      `Sun: ${digest.sun.azimuthDeg}° az / ${digest.sun.elevationDeg}° alt · wedge ±${digest.wedge.halfWidthDeg}°`, "",
    ];
    for (const candidate of digest.candidates) {
      const terrain = candidate.terrain;
      lines.push(
        `## ${candidate.name}`,
        ...(candidate.notes ? [`Notes: ${candidate.notes}`] : []),
        ...(candidate.weather ? (() => {
          const target = candidate.weather.target;
          return [`Weather: ${candidate.overall.weatherRating}; low cloud here ${target.lowCloudAtObserverPct}%, wedge mean 10/25/50 km ${target.low.km10.wedgeMean}/${target.low.km25.wedgeMean}/${target.low.km50.wedgeMean}% (p75 ${target.low.km10.wedgeP75}/${target.low.km25.wedgeP75}/${target.low.km50.wedgeP75}%).`];
        })() : candidate.climatology
          ? [`Historical outlook: ${candidate.climatology.nearClearDirectSunPct}% near-clear direct-sun frequency (${candidate.climatology.period.startYear}–${candidate.climatology.period.endYear}, ±${candidate.climatology.dateWindowDays} days, ${candidate.climatology.sampleCount} samples); median total cloud ${candidate.climatology.medianCloudCoverPct}%.`]
          : [`Weather: unavailable (${candidate.cloudUnavailableReason || "outside the available forecast coverage"}).`]),
        `Terrain: ${terrain.classification}; centre ${terrain.centreRayHorizonDeg}°, ±0.25° max ${terrain.within025DegMaxAngleDeg}°, ±0.5° max ${terrain.within05DegMaxAngleDeg}° at ${terrain.within05DegMaxDistanceKm} km, Sun ${terrain.sunElevationDeg}°, clearance ${terrain.clearanceDeg >= 0 ? "+" : ""}${terrain.clearanceDeg}°; ±5° context ${terrain.contextWedgeMaxAngleDeg}°.`,
        `Trend: ${candidate.trend.classification}. Overall: ${candidate.overall.recommendation}.`, "",
      );
    }
    lines.push("Terrain uses a DEM and geometric angles only; buildings, trees and atmospheric refraction are excluded. Forecast percentages are model estimates, not observations.");
    return lines.join("\n");
  }

  window.EclipseWeather = window.EclipseWeather || {};
  Object.assign(window.EclipseWeather, { createDigest, digestMarkdown, enrichCandidates, TREND_THRESHOLD_PCT });
}());
