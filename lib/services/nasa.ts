// NASA FIRMS (Fire Information for Resource Management System) Alert Fetcher
// Direct client-side fetch of thermal anomaly / open burning detections

import { haversineDistanceKm } from "./cpcb";
import { CONFIG } from "../config";
import { resolveUrl } from "./url";

export interface FireAlert {
  lat: number;
  lon: number;
  distance_km: number;
  confidence: string;
  brightness: number;
  fire_radiative_power: number;
  acq_date: string;
  acq_time: string;
  satellite: string;
}

export async function fetchFireData(
  lat: number,
  lon: number,
  radiusKm: number = CONFIG.FIRE_SEARCH_RADIUS_KM,
  apiKey: string = "",
): Promise<FireAlert[]> {
  try {
    const url = resolveUrl(
      `/api/nasa?lat=${lat}&lon=${lon}&key=${encodeURIComponent(apiKey)}`,
    );
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`NASA FIRMS Proxy responded with HTTP ${res.status}`);
    }

    const csvText = await res.text();
    return parseFirmsCsv(csvText, lat, lon, radiusKm);
  } catch (err) {
    console.error("NASA FIRMS fetcher failed:", err);
    return [];
  }
}

function parseFirmsCsv(
  csvText: string,
  centerLat: number,
  centerLon: number,
  radiusKm: number,
): FireAlert[] {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",");
  const fires: FireAlert[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    if (values.length < headers.length) continue;

    // Create record mapping headers to values
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = values[idx]?.trim() || "";
    });

    try {
      const fireLat = parseFloat(row.latitude);
      const fireLon = parseFloat(row.longitude);
      if (isNaN(fireLat) || isNaN(fireLon)) continue;

      const confidence = row.confidence || "nominal";
      const brightness = parseFloat(row.bright_ti4) || 0;
      const frp = parseFloat(row.frp) || 0;

      const dist = haversineDistanceKm(centerLat, centerLon, fireLat, fireLon);
      if (dist <= radiusKm) {
        fires.push({
          lat: fireLat,
          lon: fireLon,
          distance_km: Math.round(dist * 100) / 100,
          confidence,
          brightness,
          fire_radiative_power: frp,
          acq_date: row.acq_date || "",
          acq_time: row.acq_time || "",
          satellite: row.satellite || "VIIRS",
        });
      }
    } catch (e) {
      console.warn("Error parsing FIRMS row:", e);
    }
  }

  return fires;
}
