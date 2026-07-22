import { NextRequest, NextResponse } from "next/server";
import { getAqiCategory } from "@/lib/math/naqi";
import { CONFIG } from "@/lib/config";

export const runtime = "nodejs";
export const maxDuration = 40;

const DATA_GOV_RESOURCE_ID = "3b01bcb8-0b14-4abf-b6f2-c1bfd384ba69";
const DATA_GOV_URL = `https://api.data.gov.in/resource/${DATA_GOV_RESOURCE_ID}`;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SOURCE_TIMEOUT_MS = 8_000;
// Initial request plus three retries before reporting official data unavailable.
const MAX_CPCB_FETCH_ATTEMPTS = 4;
const CPCB_RETRY_DELAY_MS = 1_000;

interface CpcbApiRecord {
  country?: string;
  state?: string;
  city?: string;
  station?: string;
  last_update?: string;
  latitude?: string | number;
  longitude?: string | number;
  pollutant_id?: string;
  pollutant_avg?: string | number;
  avg_value?: string | number;
}

interface OfficialStation {
  station: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  aqi: number;
  aqi_category: string;
  dominant_pollutant: string;
  pollutants: Record<string, number>;
  pm25: number;
  pm10: number;
  no2: number;
  so2: number;
  co: number;
  o3: number;
  nh3: number;
  last_update: string;
  data_source: "data.gov.in" | "official cache";
  is_stale: boolean;
  distance_km?: number;
}

const cache = new Map<string, { timestamp: number; stations: OfficialStation[] }>();

function asFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalPollutant(value: string | undefined): string | null {
  const normalized = (value || "").trim().toUpperCase().replaceAll("_", "");
  const aliases: Record<string, string> = {
    "PM2.5": "PM2.5",
    PM25: "PM2.5",
    PM10: "PM10",
    NO2: "NO2",
    SO2: "SO2",
    CO: "CO",
    O3: "O3",
    OZONE: "O3",
    NH3: "NH3",
    AMMONIA: "NH3",
    PB: "Pb",
  };
  return aliases[normalized] || null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * In this CPCB dataset pollutant_avg is already the pollutant AQI sub-index,
 * not a concentration. The station AQI is therefore the largest valid
 * pollutant_avg at that station; applying concentration breakpoints again
 * would corrupt the official value.
 */
function groupOfficialStations(records: CpcbApiRecord[]): OfficialStation[] {
  const grouped = new Map<string, {
    station: string;
    city: string;
    state: string;
    lat: number;
    lon: number;
    lastUpdate: string;
    pollutants: Record<string, number>;
  }>();

  for (const record of records) {
    const station = record.station?.trim();
    const lat = asFiniteNumber(record.latitude);
    const lon = asFiniteNumber(record.longitude);
    const pollutant = canonicalPollutant(record.pollutant_id);
    // data.gov.in currently returns avg_value; pollutant_avg is retained for
    // compatibility with the older documented response shape.
    const subIndex = asFiniteNumber(record.avg_value ?? record.pollutant_avg);
    if (!station || lat === null || lon === null || !pollutant || subIndex === null || subIndex < 0 || subIndex > 500) continue;

    const key = `${station}|${lat}|${lon}`;
    const existing = grouped.get(key) || {
      station,
      city: record.city?.trim() || "Unknown city",
      state: record.state?.trim() || "Unknown state",
      lat,
      lon,
      lastUpdate: record.last_update?.trim() || "",
      pollutants: {},
    };
    existing.pollutants[pollutant] = Math.round(subIndex);
    if (record.last_update?.trim()) existing.lastUpdate = record.last_update.trim();
    grouped.set(key, existing);
  }

  return [...grouped.values()].flatMap((group) => {
    const entries = Object.entries(group.pollutants);
    const hasPm = group.pollutants["PM2.5"] !== undefined || group.pollutants.PM10 !== undefined;
    if (entries.length < 3 || !hasPm) return [];

    const [dominantPollutant, aqi] = entries.reduce((highest, current) =>
      current[1] > highest[1] ? current : highest,
    );

    return [{
      station: group.station,
      city: group.city,
      state: group.state,
      lat: group.lat,
      lon: group.lon,
      aqi,
      aqi_category: getAqiCategory(aqi),
      dominant_pollutant: dominantPollutant,
      pollutants: group.pollutants,
      pm25: group.pollutants["PM2.5"] ?? 0,
      pm10: group.pollutants.PM10 ?? 0,
      no2: group.pollutants.NO2 ?? 0,
      so2: group.pollutants.SO2 ?? 0,
      co: group.pollutants.CO ?? 0,
      o3: group.pollutants.O3 ?? 0,
      nh3: group.pollutants.NH3 ?? 0,
      last_update: group.lastUpdate,
      data_source: "data.gov.in" as const,
      is_stale: false,
    }];
  });
}

function nearestStations(stations: OfficialStation[], lat: number, lon: number, radiusKm: number): OfficialStation[] {
  return stations
    .map((station) => ({ ...station, distance_km: haversineKm(lat, lon, station.lat, station.lon) }))
    .filter((station) => station.distance_km! <= radiusKm)
    .sort((a, b) => a.distance_km! - b.distance_km!)
    .slice(0, CONFIG.OFFICIAL_AQI_STATION_LIMIT);
}

async function fetchOfficialCpcbRecords(city: string): Promise<CpcbApiRecord[]> {
  const apiKey = process.env.DATA_GOV_API_KEY;
  if (!apiKey) throw new Error("DATA_GOV_API_KEY is not configured");

  const params = new URLSearchParams({
    "api-key": apiKey,
    format: "json",
    limit: "1000",
    "filters[city]": city,
  });
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_CPCB_FETCH_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
    try {
      const response = await fetch(`${DATA_GOV_URL}?${params.toString()}`, {
        headers: { Accept: "application/json", "User-Agent": "Aetheris/1.0" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`data.gov.in returned HTTP ${response.status}`);
      const payload = await response.json() as { records?: unknown };
      if (!Array.isArray(payload.records) || payload.records.length === 0) {
        throw new Error("data.gov.in returned no station records");
      }
      return payload.records as CpcbApiRecord[];
    } catch (error) {
      lastError = error;
      if (attempt < MAX_CPCB_FETCH_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, CPCB_RETRY_DELAY_MS));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : "Unknown error";
  throw new Error(`data.gov.in unavailable after ${MAX_CPCB_FETCH_ATTEMPTS} attempts: ${reason}`);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const city = searchParams.get("city")?.trim() || "";
  const radiusKm = Math.min(250, Math.max(1, Number(searchParams.get("radius")) || 50));

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !city) {
    return NextResponse.json({ error: "Valid city, lat, and lon are required" }, { status: 400 });
  }

  const cacheKey = `${city.toLowerCase()}_${lat.toFixed(3)}_${lon.toFixed(3)}_${radiusKm}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ stations: cached.stations, total: cached.stations.length, source: "official cache", cached: true });
  }

  try {
    const records = await fetchOfficialCpcbRecords(city);
    const stations = nearestStations(groupOfficialStations(records), lat, lon, radiusKm);
    cache.set(cacheKey, { timestamp: Date.now(), stations });
    return NextResponse.json({ stations, total: stations.length, source: "data.gov.in", cached: false });
  } catch (error) {
    return NextResponse.json({
      stations: [],
      total: 0,
      source: null,
      error: error instanceof Error ? error.message : "Official CPCB data unavailable",
    }, { status: 503 });
  }
}
