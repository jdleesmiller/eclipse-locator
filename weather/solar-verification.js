(function () {
  function normalize(degrees) { return ((degrees % 360) + 360) % 360; }
  function difference(a, b) { return Math.abs(((a - b + 540) % 360) - 180); }

  function sunCalcPosition(date, lat, lng) {
    const position = SunCalc.getPosition(date, lat, lng);
    return { azimuthDeg: normalize(position.azimuth * 180 / Math.PI + 180), elevationDeg: position.altitude * 180 / Math.PI };
  }

  function astronomyEnginePosition(date, lat, lng) {
    const observer = new Astronomy.Observer(lat, lng, 0);
    const equatorial = Astronomy.Equator("Sun", date, observer, true, true);
    const horizon = Astronomy.Horizon(date, observer, equatorial.ra, equatorial.dec, "normal");
    return { azimuthDeg: normalize(horizon.azimuth), elevationDeg: horizon.altitude };
  }

  function verifySunPosition(date, lat, lng) {
    const primary = sunCalcPosition(date, lat, lng);
    const reference = astronomyEnginePosition(date, lat, lng);
    const azimuthDifferenceDeg = difference(primary.azimuthDeg, reference.azimuthDeg);
    const elevationDifferenceDeg = Math.abs(primary.elevationDeg - reference.elevationDeg);
    return {
      ...primary,
      verifiedAgainst: "Astronomy Engine 2.1.19 (normal atmospheric refraction)",
      reference,
      azimuthDifferenceDeg,
      elevationDifferenceDeg,
      maximumDifferenceDeg: Math.max(azimuthDifferenceDeg, elevationDifferenceDeg),
      convention: "Azimuth clockwise from true north; apparent elevation with standard refraction; UTC instant",
    };
  }

  window.EclipseWeather = window.EclipseWeather || {};
  Object.assign(window.EclipseWeather, { sunCalcPosition, astronomyEnginePosition, verifySunPosition });
}());
