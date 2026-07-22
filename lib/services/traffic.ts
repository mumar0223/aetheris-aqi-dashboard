// TomTom Traffic Congestion Fetcher
// Fetches real live traffic flow segment data via server proxy API route

import { resolveUrl } from "./url";

export interface TrafficData {
  congestion_index: number;
  speed_kmh: number;
  description: string;
  source: string;
}

export function getCongestionDescription(index: number): string {
  if (index < 0.2) return "Free flow";
  if (index < 0.4) return "Light traffic";
  if (index < 0.6) return "Moderate traffic";
  if (index < 0.8) return "Heavy traffic";
  return "Gridlock";
}

export async function fetchTraffic(
  lat: number,
  lon: number,
  apiKey: string = "",
): Promise<TrafficData> {
  const url = resolveUrl(
    `/api/traffic?lat=${lat}&lon=${lon}&key=${encodeURIComponent(apiKey)}`,
  );
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TomTom Traffic API returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const flow = data.flowSegmentData || {};
  const currentSpeed = flow.currentSpeed || 0;
  const freeFlowSpeed = flow.freeFlowSpeed || 0;

  let congestion = 0;
  if (freeFlowSpeed > 0) {
    congestion = Math.max(
      0.0,
      Math.min(1.0, 1.0 - currentSpeed / freeFlowSpeed),
    );
  }

  return {
    congestion_index: Math.round(congestion * 100) / 100,
    speed_kmh: Math.round(currentSpeed * 10) / 10,
    description: getCongestionDescription(congestion),
    source: "tomtom",
  };
}

// === Real Traffic Grid: queries TomTom at distributed grid points across area ===

import { CONFIG } from "../config";

export interface TrafficNode {
  name: string;
  lat: number;
  lon: number;
  congestion: number;
  speed_kmh: number;
  description: string;
  source: string;
}

/**
 * Fetch live traffic congestion at a grid of points across 100km area.
 * Uses TomTom Flow Segment API directly at evenly-spaced grid points.
 * Returns traffic nodes with ABSOLUTE lat/lon. Zero synthetic fallbacks.
 */
export async function fetchTrafficGrid(
  lat: number,
  lon: number,
  radiusKm: number = CONFIG.TRAFFIC_SEARCH_RADIUS_KM,
  apiKey: string = "",
): Promise<TrafficNode[]> {
  const gridPoints: { lat: number; lon: number }[] = [];
  const stepKm = Math.max(10, radiusKm / 4); // Spacing for 100km radius coverage

  // Generate grid from -radius to +radius in steps
  for (let dLat = -radiusKm; dLat <= radiusKm; dLat += stepKm) {
    for (let dLon = -radiusKm; dLon <= radiusKm; dLon += stepKm) {
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      if (dist > radiusKm) continue; // Stay within circular radius

      const pLat = lat + dLat / 111.0;
      const pLon = lon + dLon / (111.0 * Math.cos((lat * Math.PI) / 180));
      gridPoints.push({ lat: pLat, lon: pLon });
    }
  }

  const samplePoints = gridPoints.slice(0, 24);

  // Query TomTom at each grid point in parallel
  const promises = samplePoints.map(async (pt, idx) => {
    try {
      const url = resolveUrl(
        `/api/traffic?lat=${pt.lat}&lon=${pt.lon}&key=${encodeURIComponent(apiKey)}`,
      );
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const flow = data.flowSegmentData || {};
        const currentSpeed = flow.currentSpeed || 0;
        const freeFlowSpeed = flow.freeFlowSpeed || 0;

        let congestion = 0;
        if (freeFlowSpeed > 0) {
          congestion = Math.max(
            0,
            Math.min(1, 1 - currentSpeed / freeFlowSpeed),
          );
        }
        congestion = Math.round(congestion * 100) / 100;

        // Use the actual road coordinates from TomTom (midpoint of the flow segment)
        const coords = flow.coordinates?.coordinate;
        let nodeLat = pt.lat;
        let nodeLon = pt.lon;
        if (coords && coords.length > 0) {
          const mid = coords[Math.floor(coords.length / 2)];
          nodeLat = mid.latitude ?? pt.lat;
          nodeLon = mid.longitude ?? pt.lon;
        }

        const frcNames: Record<string, string> = {
          FRC0: "Motorway",
          FRC1: "Major Highway",
          FRC2: "Secondary Highway",
          FRC3: "Primary Road",
          FRC4: "Secondary Road",
          FRC5: "Local Road",
          FRC6: "Minor Road",
        };
        const roadType = frcNames[flow.frc] || "Road";
        const roadName = `${roadType} Segment #${idx + 1}`;

        return {
          name: roadName,
          lat: nodeLat,
          lon: nodeLon,
          congestion,
          speed_kmh: Math.round(currentSpeed * 10) / 10,
          description: getCongestionDescription(congestion),
          source: "tomtom",
        } as TrafficNode;
      }
    } catch {
      // Ignore failed individual points
    }

    return null;
  });

  const settled = await Promise.all(promises);
  const results: TrafficNode[] = [];
  for (const node of settled) {
    if (node) results.push(node);
  }

  return results;
}
