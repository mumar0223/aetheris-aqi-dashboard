// Official CPCB station AQI client service.

import { CONFIG } from "../config";
import { calculateIndiaAqi } from "../math/naqi";
import { resolveUrl } from "./url";

export interface CpcbStation {
  station: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  aqi: number;
  aqi_category: string;
  dominant_pollutant?: string;
  pollutants: Record<string, number>;
  last_update: string;
  pm25: number;
  pm10: number;
  no2: number;
  so2: number;
  co: number;
  o3: number;
  nh3: number;
  distance_km?: number;
  data_source?: "data.gov.in" | "official cache";
  is_stale?: boolean;
}

const cpcbCache: Record<
  string,
  { timestamp: number; data: CpcbStation[] }
> = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 mins cache window for live API calls

export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Radius of Earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Fetches official CPCB AQI stations via the server-side government-source adapter.
 */
export async function fetchCpcbStations(
  state: string = "Delhi",
  lat?: number,
  lon?: number,
  radiusKm: number = CONFIG.STATION_SEARCH_RADIUS_KM,
  apiKey?: string,
  onProgress?: (stations: CpcbStation[]) => void,
): Promise<CpcbStation[]> {
  const cacheKey = `${state.toLowerCase().trim()}_${lat ?? 0}_${lon ?? 0}_${radiusKm}`;
  const now = Date.now();

  if (
    cpcbCache[cacheKey] &&
    now - cpcbCache[cacheKey].timestamp < CACHE_TTL_MS
  ) {
    const cachedData = cpcbCache[cacheKey].data;
    if (onProgress) onProgress(cachedData);
    return cachedData;
  }

  try {
    let proxyUrl = `/api/cpcb?city=${encodeURIComponent(state)}`;
    if (lat !== undefined && lon !== undefined) {
      proxyUrl += `&lat=${lat}&lon=${lon}&radius=${Math.round(radiusKm)}`;
    }

    const res = await fetch(resolveUrl(proxyUrl));
    if (res.ok) {
      const data = await res.json();
      const stations = data.stations || [];
      if (Array.isArray(stations) && stations.length > 0) {
        cpcbCache[cacheKey] = { timestamp: Date.now(), data: stations };
        if (onProgress) onProgress(stations);
        return stations;
      }
    }
  } catch (err) {
    console.error(
      "[fetchCpcbStations] Error fetching official CPCB stations:",
      err,
    );
  }

  return cpcbCache[cacheKey]?.data || [];
}


export async function getNearestCpcbStation(
  lat: number,
  lon: number,
  state: string = "Delhi",
): Promise<CpcbStation | null> {
  const stations = await fetchCpcbStations(state, lat, lon, 100.0);
  if (stations.length === 0) return null;

  let nearest = stations[0];
  let minDist = haversineDistanceKm(lat, lon, nearest.lat, nearest.lon);

  for (let i = 1; i < stations.length; i++) {
    const d = haversineDistanceKm(lat, lon, stations[i].lat, stations[i].lon);
    if (d < minDist) {
      minDist = d;
      nearest = stations[i];
    }
  }

  return {
    ...nearest,
    distance_km: Math.round(minDist * 100) / 100,
  };
}


export async function getStationByName(
  stationName: string,
  state: string = "Delhi",
): Promise<CpcbStation | null> {
  const stations = await fetchCpcbStations(state);
  for (const s of stations) {
    if (s.station.toLowerCase() === stationName.toLowerCase()) {
      return s;
    }
  }
  return null;
}

/**
 * Fetches real-time AQI and pollutant concentrations from live APIs only (Open-Meteo or OpenWeather).
 */
export async function fetchCurrentAqi(
  lat: number,
  lon: number,
  apiKey: string = "",
): Promise<{
  aqi: number;
  pm25: number;
  pm10: number;
  no2: number;
  so2: number;
  o3: number;
  co: number;
  nh3: number;
  timestamp: string;
  source: string;
}> {
  // 1. Try OpenWeather API if key provided
  if (apiKey) {
    try {
      const url = `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${apiKey}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const entry = data.list?.[0] || {};
        const components = entry.components || {};
        const pm25 = components.pm2_5 || 0;
        const pm10 = components.pm10 || 0;
        const indiaAqi = calculateIndiaAqi(pm25, pm10);

        return {
          aqi: indiaAqi,
          pm25: Math.round(pm25 * 10) / 10,
          pm10: Math.round(pm10 * 10) / 10,
          no2: Math.round((components.no2 || 0) * 10) / 10,
          so2: Math.round((components.so2 || 0) * 10) / 10,
          o3: Math.round((components.o3 || 0) * 10) / 10,
          co: Math.round((components.co || 0) * 10) / 10,
          nh3: Math.round((components.nh3 || 0) * 10) / 10,
          timestamp: new Date().toISOString(),
          source: "openweather",
        };
      }
    } catch (err) {
      console.warn(
        "[fetchCurrentAqi] OpenWeather fetch failed, trying Open-Meteo live API:",
        err,
      );
    }
  }

  // 2. Fetch live measurements from Open-Meteo Air Quality API via server proxy
  try {
    const omUrl = resolveUrl(
      `/api/weather?type=air_quality&lat=${lat}&lon=${lon}`,
    );
    const omRes = await fetch(omUrl);
    if (omRes.ok) {
      const omData = await omRes.json();
      const curr = omData.current || {};
      const pm25 = curr.pm2_5 || 0;
      const pm10 = curr.pm10 || 0;

      const indiaAqi = calculateIndiaAqi(pm25, pm10);

      return {
        aqi: indiaAqi,
        pm25: Math.round(pm25 * 10) / 10,
        pm10: Math.round(pm10 * 10) / 10,
        no2: Math.round((curr.nitrogen_dioxide || 0) * 10) / 10,
        so2: Math.round((curr.sulphur_dioxide || 0) * 10) / 10,
        o3: Math.round((curr.ozone || 0) * 10) / 10,
        co: Math.round((curr.carbon_monoxide || 0) * 10) / 10,
        nh3: 0,
        timestamp: curr.time || new Date().toISOString(),
        source: "open-meteo",
      };
    }
  } catch (err) {
    console.error("[fetchCurrentAqi] Open-Meteo fetch failed:", err);
  }

  throw new Error("Unable to fetch live AQI from real API sources.");
}

/**
 * Fetches real historical AQI series live from Open-Meteo Air Quality API.
 */
export async function fetchHistoricalAqi(
  lat: number,
  lon: number,
  hours: number = 168,
): Promise<number[]> {
  const days = Math.min(7, Math.max(1, Math.ceil(hours / 24)));
  const omUrl = resolveUrl(
    `/api/weather?type=air_quality&lat=${lat}&lon=${lon}&past_days=${days}`,
  );

  try {
    const res = await fetch(omUrl);
    if (res.ok) {
      const data = await res.json();
      const pm25Arr: number[] = data.hourly?.pm2_5 || [];
      const pm10Arr: number[] = data.hourly?.pm10 || [];

      const result: number[] = [];
      const count = Math.min(hours, pm25Arr.length);

      for (let i = 0; i < count; i++) {
        const pm25 = pm25Arr[i] ?? 0;
        const pm10 = pm10Arr[i] ?? 0;
        const aqi = calculateIndiaAqi(pm25, pm10);
        result.push(aqi);
      }

      if (result.length > 0) return result;
    }
  } catch (err) {
    console.error(
      "[fetchHistoricalAqi] Open-Meteo historical fetch failed:",
      err,
    );
  }

  throw new Error("Unable to fetch live historical AQI data.");
}
