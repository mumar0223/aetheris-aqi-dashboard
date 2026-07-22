// Client-side Side-by-Side Multi-City Comparison Fetcher
// Aggregates real-time values from weather, traffic, NASA alerts, and model forecasts client-side

import { fetchCurrentWeather } from "./weather";
import { fetchTraffic } from "./traffic";
import { fetchFireData } from "./nasa";
import { fetchCurrentAqi, fetchHistoricalAqi } from "./cpcb";
import { fetchTimesfmForecast } from "./backend";
import { attributeSources } from "../math/attribution";
import { analyzeLocationGeospatial } from "./geospatial";

export interface CompareCityInput {
  name: string;
  lat: number;
  lon: number;
}

export interface CitySnapshot {
  name: string;
  lat: number;
  lon: number;
  current_aqi: number;
  pm25: number;
  pm10: number;
  forecast_24h: number | null;
  trend: string;
  temperature: number;
  humidity: number;
  wind_speed: number;
  congestion_index: number;
  hotspot_count: number;
  fire_count: number;
  primary_source: string;
  risk_level: string;
  data_source: string;
  timestamp: string;
  errors: Record<string, string>;
}

export interface ComparisonResult {
  city1: CitySnapshot;
  city2: CitySnapshot;
  comparison: {
    aqi_difference: number;
    worse_city: string;
    better_city: string;
    insight: string;
  };
  timestamp: string;
}

async function fetchCitySnapshot(
  city: CompareCityInput,
  backendUrl: string,
): Promise<CitySnapshot> {
  const lat = city.lat;
  const lon = city.lon;
  const errors: Record<string, string> = {};

  let currentAqiVal = 150;
  let pm25 = 90;
  let pm10 = 160;
  let dataSource = "live";

  try {
    const curAqi = await fetchCurrentAqi(lat, lon);
    currentAqiVal = curAqi.aqi;
    pm25 = curAqi.pm25;
    pm10 = curAqi.pm10;
    dataSource = curAqi.source;
  } catch (e: any) {
    errors["aqi"] = e.message || String(e);
  }

  let weatherData: any = {
    temperature: 30,
    humidity: 50,
    wind_speed: 5,
    wind_direction: 180,
  };
  try {
    weatherData = await fetchCurrentWeather(lat, lon);
  } catch (e: any) {
    errors["weather"] = e.message || String(e);
  }

  let trafficData: any = {
    congestion_index: 0.5,
    speed_kmh: 30,
    source: "live",
  };
  try {
    trafficData = await fetchTraffic(lat, lon);
  } catch (e: any) {
    errors["traffic"] = e.message || String(e);
  }

  let fireCount = 0;
  try {
    const fireData = await fetchFireData(lat, lon, 100.0);
    fireCount = fireData.length;
  } catch (e: any) {
    errors["fire"] = e.message || String(e);
  }

  let geoData: any = null;
  try {
    geoData = await analyzeLocationGeospatial(lat, lon, 100.0);
  } catch (e: any) {
    errors["geospatial"] = e.message || String(e);
  }

  let forecastVal: number | null = null;
  let trend = "stable";
  try {
    const histAqi = await fetchHistoricalAqi(lat, lon, 168);
    const forecastResult = await fetchTimesfmForecast(
      histAqi,
      backendUrl,
      lat,
      lon,
    );
    if (
      forecastResult &&
      forecastResult.forecast_values &&
      forecastResult.forecast_values.length > 0
    ) {
      forecastVal = forecastResult.forecast_values[23] || null; // 24h forecast

      const lastHist = histAqi[histAqi.length - 1] || currentAqiVal;
      const change = forecastVal ? forecastVal - lastHist : 0;
      if (change > 15) trend = "increasing";
      else if (change < -15) trend = "decreasing";
    }
  } catch (e: any) {
    errors["forecast"] = e.message || String(e);
  }

  const hotspotCount = fireCount;
  const nearbyIndustriesCount = geoData?.nearby_industries?.length || 0;
  const nearbyConstructionCount = geoData?.construction_sites || 0;

  // Attribution
  let primarySource = "unknown";
  try {
    const attr = attributeSources(
      currentAqiVal,
      weatherData,
      trafficData,
      nearbyIndustriesCount,
      nearbyConstructionCount,
      fireCount,
      [],
      lat,
      lon,
    );
    primarySource = attr.primary_source;
  } catch (e) {
    console.warn("Attribution calculation failed in comparison:", e);
  }

  // Risk
  let riskLevel = "Moderate";
  const riskScore =
    (currentAqiVal / 500) * 60 +
    (forecastVal ? forecastVal - currentAqiVal : 0);
  if (riskScore > 75) riskLevel = "Extreme";
  else if (riskScore > 50) riskLevel = "High";
  else if (riskScore < 25) riskLevel = "Low";

  return {
    name: city.name,
    lat,
    lon,
    current_aqi: Math.round(currentAqiVal * 10) / 10,
    pm25: Math.round(pm25 * 10) / 10,
    pm10: Math.round(pm10 * 10) / 10,
    forecast_24h: forecastVal ? Math.round(forecastVal * 10) / 10 : null,
    trend,
    temperature: weatherData.temperature,
    humidity: weatherData.humidity,
    wind_speed: weatherData.wind_speed,
    congestion_index: trafficData.congestion_index,
    hotspot_count: hotspotCount,
    fire_count: fireCount,
    primary_source: primarySource,
    risk_level: riskLevel,
    data_source: dataSource,
    timestamp: new Date().toISOString(),
    errors,
  };
}

export async function compareCities(
  city1: CompareCityInput,
  city2: CompareCityInput,
  backendUrl: string,
): Promise<ComparisonResult> {
  const [city1Snapshot, city2Snapshot] = await Promise.all([
    fetchCitySnapshot(city1, backendUrl),
    fetchCitySnapshot(city2, backendUrl),
  ]);

  const aqiDiff = Math.abs(
    city1Snapshot.current_aqi - city2Snapshot.current_aqi,
  );
  const worseCity =
    city1Snapshot.current_aqi > city2Snapshot.current_aqi
      ? city1Snapshot.name
      : city2Snapshot.name;
  const betterCity =
    worseCity === city1Snapshot.name ? city2Snapshot.name : city1Snapshot.name;

  let insight = `${worseCity} has ${Math.round(aqiDiff)} points higher AQI than ${betterCity}.`;
  if (aqiDiff < 10) {
    insight = `Both cities have comparable air quality levels (difference: ${Math.round(aqiDiff)} AQI points).`;
  }

  return {
    city1: city1Snapshot,
    city2: city2Snapshot,
    comparison: {
      aqi_difference: Math.round(aqiDiff * 10) / 10,
      worse_city: worseCity,
      better_city: betterCity,
      insight,
    },
    timestamp: new Date().toISOString(),
  };
}
