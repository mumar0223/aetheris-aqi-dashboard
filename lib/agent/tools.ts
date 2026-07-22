import { fetchHistoricalAqi, fetchCurrentAqi, fetchCpcbStations } from "../services/cpcb";
import { fetchTraffic } from "../services/traffic";
import { fetchCurrentWeather } from "../services/weather";
import { fetchTimesfmForecast, analyzeSatelliteImage } from "../services/backend";
import { compareCities } from "../services/compare";
import { modelDispersion } from "../math/dispersion";
import { attributeSources } from "../math/attribution";
import { optimizeRoutes } from "../math/routing";
import { analyzeLocationGeospatial } from "../services/geospatial";
import { fetchFireData } from "../services/nasa";
import { alignHistoryToOfficialAqi } from "../forecast/official-calibration";

export interface ToolResult {
  status: "success" | "error";
  message: string;
  widgets?: Record<string, any>;
  data?: any;
}

// Sentinel Hub and Esri fetching helpers (moved to TS frontend)
async function fetchEsriTile(lat: number, lon: number): Promise<string> {
  const z = 16;
  const x = Math.floor(((lon + 180) / 360) * Math.pow(2, z));
  const y = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * Math.pow(2, z)
  );
  const tileUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  const response = await fetch(tileUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ESRI tile: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

let _cachedToken = "";
let _tokenExpiry = 0;

async function fetchSentinelHubImage(
  lat: number,
  lon: number,
  clientId: string,
  clientSecret: string
): Promise<string> {
  let token = _cachedToken;
  if (!token || Date.now() >= _tokenExpiry - 60000) {
    const authRes = await fetch(
      "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
      }
    );
    if (!authRes.ok) {
      throw new Error(`Sentinel Hub Auth failed: ${authRes.status}`);
    }
    const authData = await authRes.json();
    token = authData.access_token;
    _cachedToken = token;
    _tokenExpiry = Date.now() + (authData.expires_in || 300) * 1000;
  }

  const delta = 0.01;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta];
  const toDate = new Date().toISOString();
  const fromDate = new Date(Date.now() - 30 * 24 * 3600000).toISOString();

  const processRes = await fetch("https://services.sentinel-hub.com/api/v1/process", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        bounds: {
          bbox: bbox,
          properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
        },
        data: [
          {
            type: "sentinel-2-l2a",
            dataFilter: {
              timeRange: { from: fromDate, to: toDate },
              mosaickingOrder: "leastCC",
            },
          },
        ],
      },
      output: {
        width: 512,
        height: 512,
        responses: [{ identifier: "default", format: { type: "image/jpeg" } }],
      },
      evalscript: `
        //VERSION=3
        function setup() {
          return {
            input: ["B04", "B03", "B02"],
            output: { bands: 3 }
          };
        }
        function evaluatePixel(sample) {
          return [2.5 * sample.B04, 2.5 * sample.B03, 2.5 * sample.B02];
        }
      `,
    }),
  });

  if (!processRes.ok) {
    throw new Error(`Sentinel Hub Process failed: HTTP ${processRes.status}`);
  }
  const buffer = await processRes.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

export async function show_forecast(lat: number, lon: number): Promise<ToolResult> {
  console.log(`[TOOL] show_forecast running for lat=${lat}, lon=${lon}`);
  try {
    const curAqiObj = await fetchCurrentAqi(lat, lon);
    const currentAqi = curAqiObj?.aqi || 150;
    const historicalModelInputs = await fetchHistoricalAqi(lat, lon, 168);
    const histAqi = alignHistoryToOfficialAqi(historicalModelInputs, currentAqi);
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "";
    const res = await fetchTimesfmForecast(histAqi, backendUrl, lat, lon, currentAqi);

    const values: number[] = res?.forecast_values || res?.hourly || [];
    const lower: number[] = res?.confidence_lower || values.map((v) => Math.round(v * 0.88));
    const upper: number[] = res?.confidence_upper || values.map((v) => Math.round(v * 1.12));

    const getHorizonPoint = (hourIdx: number) => {
      const idx = Math.min(hourIdx, Math.max(0, values.length - 1));
      const val = values.length > 0 ? Math.round(values[idx]) : currentAqi;
      const p10Val = lower.length > 0 && lower[idx] != null ? Math.round(lower[idx]) : Math.round(val * 0.88);
      const p90Val = upper.length > 0 && upper[idx] != null ? Math.round(upper[idx]) : Math.round(val * 1.12);
      return {
        value: val,
        p10: p10Val,
        p50: val,
        p90: p90Val,
      };
    };

    if (!res.forecasts || Object.keys(res.forecasts).length === 0) {
      res.forecasts = {
        "24h": getHorizonPoint(23),
        "48h": getHorizonPoint(47),
        "72h": getHorizonPoint(71),
      };
    }

    return {
      status: "success",
      message: "Forecast card populated",
      widgets: { forecast: res }
    };
  } catch (err: any) {
    console.error("[TOOL] show_forecast error:", err);
    return { status: "error", message: err.message };
  }
}

export async function show_hotspots(lat: number, lon: number, radius_km: number = 5.0): Promise<ToolResult> {
  console.log(`[TOOL] show_hotspots running for lat=${lat}, lon=${lon}, radius_km=${radius_km}`);
  try {
    const readings = await fetchCpcbStations("Delhi", lat, lon, radius_km);
    const hotspotsList: any[] = [];
    const visited = new Set<number>();
    const eps = 5.0 / 111.0;
    let clusterIdCounter = 1;

    for (let i = 0; i < readings.length; i++) {
      if (visited.has(i) || readings[i].aqi < 150) continue;
      const clusterPoints: typeof readings = [];
      
      for (let j = 0; j < readings.length; j++) {
        if (readings[j].aqi < 150) continue;
        const d = Math.sqrt(
          Math.pow(readings[i].lat - readings[j].lat, 2) +
            Math.pow(readings[i].lon - readings[j].lon, 2)
        );
        if (d <= eps) {
          clusterPoints.push(readings[j]);
          visited.add(j);
        }
      }

      if (clusterPoints.length >= 2) {
        const centerLat = clusterPoints.reduce((sum, p) => sum + p.lat, 0) / clusterPoints.length;
        const centerLon = clusterPoints.reduce((sum, p) => sum + p.lon, 0) / clusterPoints.length;
        const avgAqi = clusterPoints.reduce((sum, p) => sum + p.aqi, 0) / clusterPoints.length;

        let severity = "medium";
        if (avgAqi > 350) severity = "critical";
        else if (avgAqi > 250) severity = "high";
        else if (avgAqi < 180) severity = "low";

        hotspotsList.push({
          cluster_id: clusterIdCounter++,
          center_lat: centerLat,
          center_lon: centerLon,
          avg_aqi: avgAqi,
          value: avgAqi,
          station_count: clusterPoints.length,
          area_sq_km: clusterPoints.length * 0.45,
          severity,
        });
      }
    }

    const res = {
      hotspots: hotspotsList,
      total_clusters: hotspotsList.length,
    };

    return {
      status: "success",
      message: `Found ${hotspotsList.length} hotspots`,
      widgets: { hotspots: res }
    };
  } catch (err: any) {
    console.error("[TOOL] show_hotspots error:", err);
    return { status: "error", message: err.message };
  }
}

export async function show_risk(lat: number, lon: number): Promise<ToolResult> {
  console.log(`[TOOL] show_risk running for lat=${lat}, lon=${lon}`);
  try {
    const current_aqi_data = await fetchCurrentAqi(lat, lon);
    const aqi_val = current_aqi_data?.aqi || 150;
    
    let city_name = "Delhi";
    if (Math.abs(lat - 12.9716) < 1.0) city_name = "Bengaluru";
    else if (Math.abs(lat - 13.0827) < 1.0) city_name = "Chennai";
    else if (Math.abs(lat - 22.5726) < 1.0) city_name = "Kolkata";
    else if (Math.abs(lat - 19.0760) < 1.0) city_name = "Mumbai";

    const risk_score = Math.min(100, Math.max(10, (aqi_val / 500) * 80 + 10));
    let risk_level = "Moderate";
    let health_advisory = "Sensitive groups should reduce heavy outdoor activity.";
    
    if (risk_score > 75) {
      risk_level = "Extreme";
      health_advisory = "Everyone should avoid outdoor physical exertion. Wear N95 masks.";
    } else if (risk_score > 50) {
      risk_level = "High";
      health_advisory = "Avoid prolonged outdoor exposure. Keep windows closed.";
    } else if (risk_score < 25) {
      risk_level = "Low";
      health_advisory = "Air quality is ideal for outdoor activities.";
    }

    const res = {
      city_name,
      aqi: aqi_val,
      risk_score,
      risk_level,
      health_advisory,
      cardiovascular_risk_increase_pct: Math.round((aqi_val / 100) * 12 * 10) / 10,
      respiratory_admission_increase_pct: Math.round((aqi_val / 100) * 18 * 10) / 10,
    };

    return {
      status: "success",
      message: "Health Advisory card populated",
      widgets: { risk: res }
    };
  } catch (err: any) {
    console.error("[TOOL] show_risk error:", err);
    return { status: "error", message: err.message };
  }
}

export async function show_route(lat: number, lon: number): Promise<ToolResult> {
  console.log(`[TOOL] show_route running for lat=${lat}, lon=${lon}`);
  try {
    const hotspotsRes = await show_hotspots(lat, lon);
    const hotspots = hotspotsRes.widgets?.hotspots?.hotspots || [];
    const res = await optimizeRoutes(hotspots, lat, lon);
    return {
      status: "success",
      message: "Patrol route calculated and drawn",
      widgets: { optimization: res }
    };
  } catch (err: any) {
    console.error("[TOOL] show_route error:", err);
    return { status: "error", message: err.message };
  }
}

export async function show_attribution(lat: number, lon: number): Promise<ToolResult> {
  console.log(`[TOOL] show_attribution running for lat=${lat}, lon=${lon}`);
  try {
    const curAqi = await fetchCurrentAqi(lat, lon);
    const weatherData = await fetchCurrentWeather(lat, lon);
    const trafficData = await fetchTraffic(lat, lon);
    const geoData = await analyzeLocationGeospatial(lat, lon);

    const industriesCount = geoData.nearby_industries.length;
    const constructionCount = geoData.construction_sites;

    const res = await attributeSources(
      curAqi.aqi,
      weatherData,
      trafficData,
      industriesCount,
      constructionCount,
      0,
      [],
      lat,
      lon
    );

    return {
      status: "success",
      message: "Source Attribution card populated",
      widgets: { attribution: res }
    };
  } catch (err: any) {
    console.error("[TOOL] show_attribution error:", err);
    return { status: "error", message: err.message };
  }
}

export async function show_dispersion(lat: number, lon: number): Promise<ToolResult> {
  console.log(`[TOOL] show_dispersion running for lat=${lat}, lon=${lon}`);
  try {
    const weatherData = await fetchCurrentWeather(lat, lon);
    const windSpeed = weatherData.wind_speed || 3.5;
    const windDir = weatherData.wind_direction || 270;

    // 1. Primary city center plume covering larger area (~50km)
    const primaryDispersion = modelDispersion(
      lat,
      lon,
      windSpeed,
      windDir,
      100.0,
      30.0,
      50.0, // gridSizeKm
      30,   // resolution
      "D"
    );

    // 2. Fetch industrial sources in the background
    let industrialPlumes: any[] = [];
    try {
      const geo = await analyzeLocationGeospatial(lat, lon);
      const sources = geo.nearby_industries || [];
      industrialPlumes = sources.map((ind: any) => {
        return modelDispersion(
          ind.lat,
          ind.lon,
          windSpeed,
          windDir,
          60.0,
          25.0,
          15.0,
          20,
          "D"
        );
      });
    } catch (e) {
      console.error("[TOOL] show_dispersion geospatial fetch error:", e);
    }

    // 3. Fetch active fire detections in the background
    let firePlumes: any[] = [];
    try {
      const fireData = await fetchFireData(lat, lon);
      const fires = fireData || [];
      firePlumes = fires.map((f: any) => {
        return modelDispersion(
          f.lat,
          f.lon,
          windSpeed,
          windDir,
          80.0,
          10.0,
          15.0,
          20,
          "D"
        );
      });
    } catch (e) {
      console.error("[TOOL] show_dispersion fire fetch error:", e);
    }

    const dispersionRes = {
      ...primaryDispersion,
      plumes: [
        primaryDispersion,
        ...industrialPlumes,
        ...firePlumes
      ]
    };

    return {
      status: "success",
      message: "Atmospheric Dispersion card populated with multiple plumes",
      widgets: { dispersion: dispersionRes }
    };
  } catch (err: any) {
    console.error("[TOOL] show_dispersion error:", err);
    return { status: "error", message: err.message };
  }
}

export async function show_satellite(
  lat: number,
  lon: number,
  clientId?: string,
  clientSecret?: string,
  onProgress?: (msg: string) => void
): Promise<ToolResult> {
  console.log(`[TOOL] show_satellite running for lat=${lat}, lon=${lon}`);
  try {
    const locations = [
      { name: "Center Coordinate", lat, lon, id: `sat_center_${lat}_${lon}` },
      { name: "North-East Offset", lat: lat + 0.012, lon: lon + 0.012, id: `sat_ne_${lat}_${lon}` },
      { name: "South-West Offset", lat: lat - 0.012, lon: lon - 0.012, id: `sat_sw_${lat}_${lon}` },
    ];

    const analyzedImages: any[] = [];
    let totalDetections = 0;

    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      onProgress?.(`🛰️ [Satellite ${i + 1}/${locations.length}] Fetching imagery for ${loc.name}...`);

      let imageBase64 = "";
      let source = "esri";

      if (clientId && clientSecret) {
        try {
          imageBase64 = await fetchSentinelHubImage(loc.lat, loc.lon, clientId, clientSecret);
          source = "sentinel_hub";
        } catch (err) {
          // Fallback
        }
      }

      if (!imageBase64) {
        imageBase64 = await fetchEsriTile(loc.lat, loc.lon);
        source = "esri";
      }

      onProgress?.(`🔬 [Satellite ${i + 1}/${locations.length}] Analyzing imagery with AI Vision...`);
      const visionData = await analyzeSatelliteImage(loc.lat, loc.lon, imageBase64);

      const detectionsCount = visionData.detections?.length || 0;
      totalDetections += detectionsCount;

      onProgress?.(`✅ [Satellite ${i + 1}/${locations.length}] Analysis complete. Detected ${detectionsCount} anomaly/anomalies.`);

      analyzedImages.push({
        id: loc.id,
        name: loc.name,
        lat: loc.lat,
        lon: loc.lon,
        image_base64: imageBase64,
        detections: visionData.detections,
        scene_description: visionData.scene_description,
        severity: visionData.severity,
      });

      // Brief delay to allow UI updates to stream smoothly
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const res = {
      satellite: {
        source: analyzedImages[0].source || "esri",
        image_base64: analyzedImages[0].image_base64,
        timestamp: new Date().toISOString(),
      },
      vision: {
        severity: analyzedImages[0].severity,
        scene_description: analyzedImages[0].scene_description,
        detections: analyzedImages[0].detections,
      },
      satellite_analysis: {
        images: analyzedImages,
      }
    };

    return {
      status: "success",
      message: `Completed processing ${locations.length} nearby satellite tiles. Total AI anomalies detected: ${totalDetections}`,
      widgets: res
    };
  } catch (err: any) {
    console.error("[TOOL] show_satellite error:", err);
    return { status: "error", message: err.message };
  }
}

export async function zoom_map(lat: number, lon: number, zoom: number): Promise<ToolResult> {
  console.log(`[TOOL] zoom_map running for lat=${lat}, lon=${lon}, zoom=${zoom}`);
  return {
    status: "success",
    message: `Map viewport updated to zoom ${zoom}`,
    widgets: {
      map_control: { lat, lon, zoom }
    }
  };
}

export async function compare_cities(
  city1_name: string, city1_lat: number, city1_lon: number,
  city2_name: string, city2_lat: number, city2_lon: number
): Promise<ToolResult> {
  console.log(`[TOOL] compare_cities running for ${city1_name} and ${city2_name}`);
  try {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "";
    const res = await compareCities(
      { name: city1_name, lat: city1_lat, lon: city1_lon },
      { name: city2_name, lat: city2_lat, lon: city2_lon },
      backendUrl
    );
    return {
      status: "success",
      message: `Comparison completed between ${city1_name} and ${city2_name}`,
      widgets: { comparison: res }
    };
  } catch (err: any) {
    console.error("[TOOL] compare_cities error:", err);
    return { status: "error", message: err.message };
  }
}
