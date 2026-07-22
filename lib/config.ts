// Central Configuration File for Environmental & Geospatial Data Pipeline
// Easily change search radiuses and thresholds across all services from here

export const CONFIG = {
  // Maximum number of official CPCB stations returned around the map point.
  // Increase or decrease this single value to control map density and API payload size.
  OFFICIAL_AQI_STATION_LIMIT: 25,

  // Master search & coverage radius in kilometers for all telemetry & facilities
  DEFAULT_SEARCH_RADIUS_KM: 50.0,

  // Specific service default radius fallbacks (inherits master radius by default)
  STATION_SEARCH_RADIUS_KM: 50.0,
  GEOSPATIAL_SEARCH_RADIUS_KM: 50.0,
  TRAFFIC_SEARCH_RADIUS_KM: 50.0,
  FIRE_SEARCH_RADIUS_KM: 50.0,
};
