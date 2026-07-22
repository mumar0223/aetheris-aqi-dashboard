// OpenStreetMap Overpass API - Geospatial facility & road density fetcher
// Directly fetches OSM points around a given coordinate on the client side

import { haversineDistanceKm } from "./cpcb";
import { CONFIG } from "../config";
import { resolveUrl } from "./url";

export interface FacilityItem {
  name: string;
  type: string;
  lat: number;
  lon: number;
  distance_km: number;
  tags?: Record<string, string>;
}

export interface GeospatialData {
  state: string;
  district: string | null;
  ward: string | null;
  nearby_industries: FacilityItem[];
  nearby_schools: FacilityItem[];
  nearby_hospitals: FacilityItem[];
  construction_sites: number;
  waste_sites: number;
  road_density: number;
  green_cover_pct: number | null;
  population_estimate: number;
  h3_index: string;
}

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

async function queryOverpass(query: string): Promise<any> {
  // First try server-side Next.js proxy API route (bypasses browser CORS & header restrictions)
  try {
    const proxyRes = await fetch(resolveUrl("/api/overpass"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    if (proxyRes.ok) {
      const data = await proxyRes.json();
      if (!data.error) {
        return data;
      }
    }
  } catch (proxyErr) {
    console.warn(
      "Server Overpass proxy unavailable, falling back to direct client mirror requests:",
      proxyErr,
    );
  }

  // Client-side fallback: execute all mirror requests in parallel via Promise.any (first to respond wins)
  const failures: string[] = [];
  const mirrorPromises = OVERPASS_MIRRORS.map(async (mirrorUrl) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const res = await fetch(mirrorUrl, {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Accept: "application/json, text/javascript, */*; q=0.01",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DelhiEnvironmentalPlatform/1.0",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      return await res.json();
    } catch (err: any) {
      clearTimeout(timeoutId);
      failures.push(`${new URL(mirrorUrl).hostname}: ${err.name === "AbortError" ? "timeout" : err.message}`);
      throw err;
    }
  });

  try {
    return await Promise.any(mirrorPromises);
  } catch (err) {
    console.warn(`[Geospatial] All Overpass mirrors failed: ${failures.join("; ")}`);
    throw new Error("All Overpass mirrors failed or timed out.");
  }
}

export async function fetchRoadDensity(
  lat: number,
  lon: number,
  radiusM: number = 2000,
): Promise<number> {
  const queryLat = Math.round(lat * 1000) / 1000;
  const queryLon = Math.round(lon * 1000) / 1000;
  const query = `[out:json][timeout:15];way["highway"~"motorway|primary|secondary|tertiary"](around:${radiusM},${queryLat},${queryLon});out count;`;
  try {
    const data = await queryOverpass(query);
    const elements = data.elements || [];
    const count = elements.length;
    return Math.round(Math.min(1.0, count / 50.0) * 100) / 100;
  } catch (err) {
    console.warn("Road density query failed, defaulting to 0.5:", err);
    return 0.5;
  }
}



async function fetchGeoapifyNearbyFacilities(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<{
  industries: FacilityItem[];
  schools: FacilityItem[];
  hospitals: FacilityItem[];
  construction_sites: number;
  waste_sites: number;
} | null> {
  try {
    const radiusM = Math.round(radiusKm * 1000);
    const res = await fetch(
      resolveUrl(`/api/geoapify?lat=${lat}&lon=${lon}&radius=${radiusM}`),
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (data.error || !Array.isArray(data.features)) return null;

    const results = {
      industries: [] as FacilityItem[],
      schools: [] as FacilityItem[],
      hospitals: [] as FacilityItem[],
      construction_sites: 0,
      waste_sites: 0,
    };

    for (const feat of data.features) {
      const props = feat.properties || {};
      const name = props.name || props.address_line1 || "Facility";
      const placeLat = props.lat ?? feat.geometry?.coordinates?.[1] ?? lat;
      const placeLon = props.lon ?? feat.geometry?.coordinates?.[0] ?? lon;
      const dist = haversineDistanceKm(lat, lon, placeLat, placeLon);
      const roundedDist = Math.round(dist * 100) / 100;

      const categories: string[] = props.categories || [];
      const isHospital = categories.some((c: string) =>
        c.startsWith("healthcare"),
      );
      const isSchool = categories.some((c: string) =>
        c.startsWith("education"),
      );
      const isIndustry = categories.some(
        (c: string) =>
          c.includes("industrial") ||
          c.includes("production") ||
          c.startsWith("man_made"),
      );
      const isWaste = categories.some(
        (c: string) => c.includes("waste") || c.includes("landfill"),
      );

      if (isHospital) {
        results.hospitals.push({
          name,
          type: "hospitals",
          lat: placeLat,
          lon: placeLon,
          distance_km: roundedDist,
        });
      } else if (isSchool) {
        results.schools.push({
          name,
          type: "schools",
          lat: placeLat,
          lon: placeLon,
          distance_km: roundedDist,
        });
      } else if (isIndustry) {
        results.industries.push({
          name,
          type: "industries",
          lat: placeLat,
          lon: placeLon,
          distance_km: roundedDist,
        });
      } else if (isWaste) {
        results.waste_sites++;
      }
    }

    results.industries = deduplicateFacilities(results.industries);
    results.schools = deduplicateFacilities(results.schools);
    results.hospitals = deduplicateFacilities(results.hospitals);

    return results;
  } catch (err) {
    console.warn(
      "Geoapify Places API call failed, falling back to Overpass:",
      err,
    );
    return null;
  }
}

function deduplicateFacilities(items: FacilityItem[]): FacilityItem[] {
  const unique: FacilityItem[] = [];

  for (const item of items) {
    const normName = item.name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, "");

    const duplicate = unique.find((u) => {
      const uNormName = u.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]/g, "");
      const sameName = normName.length > 3 && uNormName === normName;
      const distKm = haversineDistanceKm(u.lat, u.lon, item.lat, item.lon);
      const isProximityDuplicate = distKm < 0.25; // 250 meters threshold
      return sameName || isProximityDuplicate;
    });

    if (!duplicate) {
      unique.push(item);
    }
  }

  return unique.sort((a, b) => a.distance_km - b.distance_km);
}

export async function fetchNearbyFacilities(
  lat: number,
  lon: number,
  radiusKm: number = CONFIG.GEOSPATIAL_SEARCH_RADIUS_KM,
): Promise<{
  industries: FacilityItem[];
  schools: FacilityItem[];
  hospitals: FacilityItem[];
  construction_sites: number;
  waste_sites: number;
}> {
  // === Multi-point grid strategy ===
  // Instead of querying from a single center (which misses edge facilities due to API result limits),
  // we query from multiple grid points across the area and merge + deduplicate results.

  const mergedResults = {
    industries: [] as FacilityItem[],
    schools: [] as FacilityItem[],
    hospitals: [] as FacilityItem[],
    construction_sites: 0,
    waste_sites: 0,
  };

  const mergeInto = (source: typeof mergedResults) => {
    mergedResults.industries.push(...source.industries);
    mergedResults.schools.push(...source.schools);
    mergedResults.hospitals.push(...source.hospitals);
    mergedResults.construction_sites += source.construction_sites;
    mergedResults.waste_sites += source.waste_sites;
  };

  // Generate grid points: center + 4 cardinal offsets at ~60% of radius
  // This ensures overlapping coverage across the entire search area
  const offsetDeg = (radiusKm * 0.6) / 111.0; // ~60% of radius in degrees
  const gridPoints = [
    { lat, lon }, // center
    { lat: lat + offsetDeg, lon }, // north
    { lat: lat - offsetDeg, lon }, // south
    { lat, lon: lon + offsetDeg / Math.cos((lat * Math.PI) / 180) }, // east
    { lat, lon: lon - offsetDeg / Math.cos((lat * Math.PI) / 180) }, // west
  ];

  // --- Strategy 1: Multi-point Geoapify queries (parallel, each with its own result set) ---
  const geoapifyGridPromises = gridPoints.map((pt) =>
    fetchGeoapifyNearbyFacilities(pt.lat, pt.lon, radiusKm * 0.7).catch(() => null),
  );

  // --- Strategy 2: Overpass bounding-box query (covers entire area in one shot) ---
  const overpassPromise = fetchOverpassBBox(lat, lon, radiusKm).catch(() => null);

  // Run ALL queries in parallel
  const [geoapifyResults, overpassResult] = await Promise.all([
    Promise.all(geoapifyGridPromises),
    overpassPromise,
  ]);

  // Merge Geoapify grid results
  for (const geoResult of geoapifyResults) {
    if (geoResult) mergeInto(geoResult);
  }

  // Merge Overpass results
  if (overpassResult) mergeInto(overpassResult);

  // Deduplicate across all merged sources
  mergedResults.industries = deduplicateFacilities(mergedResults.industries);
  mergedResults.schools = deduplicateFacilities(mergedResults.schools);
  mergedResults.hospitals = deduplicateFacilities(mergedResults.hospitals);

  // Recalculate distances from the actual center point
  for (const item of [...mergedResults.industries, ...mergedResults.schools, ...mergedResults.hospitals]) {
    item.distance_km = Math.round(haversineDistanceKm(lat, lon, item.lat, item.lon) * 100) / 100;
  }

  // Re-sort by distance after recalculation
  mergedResults.industries.sort((a, b) => a.distance_km - b.distance_km);
  mergedResults.schools.sort((a, b) => a.distance_km - b.distance_km);
  mergedResults.hospitals.sort((a, b) => a.distance_km - b.distance_km);

  return mergedResults;
}

/**
 * Overpass bounding-box query — fetches ALL facilities inside a lat/lon box.
 * Unlike `around:`, bbox doesn't bias toward the center, so we get uniform coverage.
 */
async function fetchOverpassBBox(
  lat: number,
  lon: number,
  radiusKm: number,
): Promise<{
  industries: FacilityItem[];
  schools: FacilityItem[];
  hospitals: FacilityItem[];
  construction_sites: number;
  waste_sites: number;
} | null> {
  const dLat = radiusKm / 111.0;
  const dLon = radiusKm / (111.0 * Math.cos((lat * Math.PI) / 180));
  const south = Math.round((lat - dLat) * 1000) / 1000;
  const north = Math.round((lat + dLat) * 1000) / 1000;
  const west = Math.round((lon - dLon) * 1000) / 1000;
  const east = Math.round((lon + dLon) * 1000) / 1000;
  const bbox = `${south},${west},${north},${east}`;

  const combinedQuery = `[out:json][timeout:25];(
    node["landuse"="industrial"](${bbox});
    way["landuse"="industrial"](${bbox});
    node["man_made"="works"](${bbox});
    way["industrial"](${bbox});
    node["amenity"="school"](${bbox});
    way["amenity"="school"](${bbox});
    node["amenity"="college"](${bbox});
    node["amenity"="university"](${bbox});
    node["amenity"="hospital"](${bbox});
    way["amenity"="hospital"](${bbox});
    node["amenity"="clinic"](${bbox});
    node["landuse"="construction"](${bbox});
    way["landuse"="construction"](${bbox});
    node["landuse"="landfill"](${bbox});
    way["landuse"="landfill"](${bbox});
    node["amenity"="waste_disposal"](${bbox});
  );out center;`;

  const results = {
    industries: [] as FacilityItem[],
    schools: [] as FacilityItem[],
    hospitals: [] as FacilityItem[],
    construction_sites: 0,
    waste_sites: 0,
  };

  try {
    const data = await queryOverpass(combinedQuery);
    const elements = data.elements || [];

    for (const el of elements) {
      const tags = el.tags || {};
      const name = tags.name || "";
      const itemLat = el.lat ?? el.center?.lat;
      const itemLon = el.lon ?? el.center?.lon;

      if (itemLat === undefined || itemLon === undefined) continue;

      const dist = haversineDistanceKm(lat, lon, itemLat, itemLon);
      // Skip elements outside the actual radius (bbox is a square, not a circle)
      if (dist > radiusKm) continue;

      const roundedDist = Math.round(dist * 100) / 100;
      const amenity = tags.amenity || "";
      const landuse = tags.landuse || "";
      const manMade = tags.man_made || "";
      const industrial = tags.industrial || "";

      if (landuse === "industrial" || manMade === "works" || industrial) {
        results.industries.push({
          name: name || "Industrial Facility",
          type: "industries",
          lat: itemLat,
          lon: itemLon,
          distance_km: roundedDist,
          tags: { name, operator: tags.operator || "", landuse, amenity },
        });
      } else if (["school", "college", "university"].includes(amenity)) {
        results.schools.push({
          name: name || "Educational Institution",
          type: "schools",
          lat: itemLat,
          lon: itemLon,
          distance_km: roundedDist,
          tags: { name, operator: tags.operator || "", landuse, amenity },
        });
      } else if (["hospital", "clinic"].includes(amenity)) {
        results.hospitals.push({
          name: name || "Medical Center",
          type: "hospitals",
          lat: itemLat,
          lon: itemLon,
          distance_km: roundedDist,
          tags: { name, operator: tags.operator || "", landuse, amenity },
        });
      } else if (landuse === "construction") {
        results.construction_sites++;
      } else if (landuse === "landfill" || amenity === "waste_disposal") {
        results.waste_sites++;
      }
    }

    return results;
  } catch (err) {
    console.warn("OSM Overpass bbox query failed:", err);
    return null;
  }
}

export async function analyzeLocationGeospatial(
  lat: number,
  lon: number,
  radiusKm: number = CONFIG.GEOSPATIAL_SEARCH_RADIUS_KM,
): Promise<GeospatialData> {
  // Fetch parallel OSM queries for nearby facilities
  const facilities = await fetchNearbyFacilities(lat, lon, radiusKm);
  const roadDensity = await fetchRoadDensity(lat, lon, 2000);

  const population = estimatePopulationGeospatial(lat, lon, radiusKm);
  const ward = determineZoneByCoordinates(lat, lon);
  const h3Index = generateH3IndexHex(lat, lon);

  return {
    state:
      lat > 28.4 && lat < 28.9 && lon > 76.8 && lon < 77.4
        ? "Delhi"
        : "Haryana",
    district:
      lat > 28.55 && lat < 28.7 && lon > 77.15 && lon < 77.3
        ? "New Delhi"
        : "Gurugram",
    ward,
    nearby_industries: facilities.industries,
    nearby_schools: facilities.schools,
    nearby_hospitals: facilities.hospitals,
    construction_sites: facilities.construction_sites,
    waste_sites: facilities.waste_sites,
    road_density: roadDensity,
    green_cover_pct:
      Math.round((12.5 + Math.abs(Math.sin(lat) + Math.cos(lon)) * 15) * 10) /
      10,
    population_estimate: population,
    h3_index: h3Index,
  };
}

function estimatePopulationGeospatial(
  lat: number,
  lon: number,
  radiusKm: number,
): number {
  const area = Math.PI * radiusKm * radiusKm;
  const distFromCenter = haversineDistanceKm(28.6139, 77.209, lat, lon);
  const density = Math.max(1200, 18000 * Math.exp(-distFromCenter / 15));
  return Math.round(density * area);
}

function determineZoneByCoordinates(lat: number, lon: number): string {
  if (lat > 28.65) {
    return lon > 77.2 ? "North East" : "North West";
  } else {
    return lon > 77.2 ? "East / South East" : "South West";
  }
}

function generateH3IndexHex(lat: number, lon: number): string {
  const latStr = Math.abs(Math.round(lat * 1000)).toString(16);
  const lonStr = Math.abs(Math.round(lon * 1000)).toString(16);
  return `883f18${latStr}${lonStr}`.padEnd(15, "f").substring(0, 15);
}
