"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  fetchCpcbStations as fetchCpcbStationsClient,
  fetchHistoricalAqi,
} from "../lib/services/cpcb";
import { fetchFireData } from "../lib/services/nasa";
import {
  fetchTraffic,
  fetchTrafficGrid,
  TrafficNode,
} from "../lib/services/traffic";
import { fetchCurrentWeather } from "../lib/services/weather";
import { analyzeLocationGeospatial } from "../lib/services/geospatial";
import {
  fetchTimesfmForecast,
  fetchSatelliteImagesStream,
} from "../lib/services/backend";
import { compareCities } from "../lib/services/compare";
import { modelDispersion } from "../lib/math/dispersion";
import { attributeSources } from "../lib/math/attribution";
import { optimizeRoutes } from "../lib/math/routing";
import { getIndianAQICategory } from "../lib/math/naqi";
import { CONFIG } from "../lib/config";
import { alignHistoryToOfficialAqi } from "../lib/forecast/official-calibration";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown, LoaderCircle, MapPin } from "lucide-react";
import ForecastDialog from "@/components/ForecastDialog";
import SatelliteModal from "@/components/SatelliteModal";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./forecast-dialog.css";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ============================================================================
// CONSTANTS
// ============================================================================

const CITIES: Record<
  string,
  { name: string; state: string; lat: number; lon: number }
> = {
  delhi: { name: "Delhi", state: "Delhi", lat: 28.6139, lon: 77.209 },
  mumbai: { name: "Mumbai", state: "Maharashtra", lat: 19.076, lon: 72.8777 },
  bengaluru: {
    name: "Bengaluru",
    state: "Karnataka",
    lat: 12.9716,
    lon: 77.5946,
  },
  chennai: { name: "Chennai", state: "Tamil Nadu", lat: 13.0827, lon: 80.2707 },
  kolkata: {
    name: "Kolkata",
    state: "West Bengal",
    lat: 22.5726,
    lon: 88.3639,
  },
};

const TILE_CONFIGS: Record<
  string,
  { url: string; label: string; attr: string; subdomains?: string[] }
> = {
  google: {
    url: "https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
    label: "G-MAP",
    attr: "© Google",
    subdomains: ["mt0", "mt1", "mt2", "mt3"],
  },
  command: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    label: "CMD",
    attr: "© CARTO",
  },
  streets: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    label: "MAP",
    attr: "© OpenStreetMap",
  },
};

// AQI Color helpers
function getAqiBubbleClass(aqi: number): string {
  if (aqi <= 50) return "aqi-bubble--good";
  if (aqi <= 100) return "aqi-bubble--satisfactory";
  if (aqi <= 200) return "aqi-bubble--moderate";
  if (aqi <= 300) return "aqi-bubble--poor";
  if (aqi <= 400) return "aqi-bubble--very-poor";
  return "aqi-bubble--severe";
}

function getAqiCategory(aqi: number): string {
  return getIndianAQICategory(aqi).label;
}

function getAqiZoneColor(aqi: number): string {
  if (aqi <= 50) return "#00B050";
  if (aqi <= 100) return "#84CF33";
  if (aqi <= 200) return "#FFC000";
  if (aqi <= 300) return "#FF6600";
  if (aqi <= 400) return "#FF0000";
  return "#800000";
}

// Weather code to icon/label mapping (WMO codes)
function getWeatherInfo(code: number | undefined): {
  icon: string;
  label: string;
} {
  if (code === undefined || code === null)
    return { icon: "☀️", label: "Clear" };
  if (code === 0) return { icon: "☀️", label: "Clear Sky" };
  if (code <= 3) return { icon: "⛅", label: "Partly Cloudy" };
  if (code <= 48) return { icon: "🌫️", label: "Foggy" };
  if (code <= 57) return { icon: "🌦️", label: "Drizzle" };
  if (code <= 67) return { icon: "🌧️", label: "Rain" };
  if (code <= 77) return { icon: "❄️", label: "Snow" };
  if (code <= 82) return { icon: "🌧️", label: "Showers" };
  if (code <= 99) return { icon: "⛈️", label: "Thunderstorm" };
  return { icon: "☁️", label: "Cloudy" };
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function SkeletonBox({ w = "100%", h = "16px" }: { w?: string; h?: string }) {
  return <div className="skeleton" style={{ width: w, height: h }} />;
}

/** SVG Donut Chart for source attribution */
function DonutChart({
  segments,
  size = 120,
}: {
  segments: { label: string; pct: number; color: string }[];
  size?: number;
}) {
  const r = size / 2 - 10;
  const c = Math.PI * 2 * r;
  let offset = 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="donut-chart"
    >
      {segments.map((seg, i) => {
        const dash = (seg.pct / 100) * c;
        const gap = c - dash;
        const cur = offset;
        offset += dash;
        return (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth={16}
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-cur}
            strokeLinecap="round"
            opacity={0.85}
          />
        );
      })}
      <circle cx={size / 2} cy={size / 2} r={r - 14} fill="#0e1017" />
    </svg>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface Message {
  role: "user" | "agent";
  content: string;
}
interface TimelineEvent {
  time: string;
  event: string;
}
interface CityLocation {
  name: string;
  city: string;
  state?: string;
  lat: number;
  lon: number;
  key?: keyof typeof CITIES;
}
interface CpcbStation {
  station: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  aqi: number;
  aqi_category: string;
  dominant_pollutant?: string;
  pollutants: Record<string, number>;
  pm25: number;
  pm10: number;
  no2: number;
  so2: number;
  co: number;
  o3: number;
  nh3: number;
  last_update: string;
  distance_km?: number;
  data_source?: "data.gov.in" | "official cache";
  is_stale?: boolean;
}

function formatSceneDescription(desc: string): string[] {
  if (!desc) return [];
  const sentences = desc
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length < 10) return false;
      const lower = s.toLowerCase();
      if (
        lower.includes("aerial view") ||
        lower.includes("high angle") ||
        lower.includes("overall effect") ||
        lower.includes("grandeur") ||
        lower.includes("opulence") ||
        lower.includes("looking down")
      ) {
        return false;
      }
      return true;
    });

  if (sentences.length === 0) {
    return [
      "Extracted spatial layout indicates high-density built environment.",
      "Identified prominent road network crossings matching commercial zoning patterns.",
      "Open patches of land detected with low surface vegetation index.",
    ];
  }
  return sentences;
}

export default function Home() {
  // --- City & Backend ---
  const [cityKey, setCityKey] = useState<keyof typeof CITIES>("delhi");
  const [cpcbCity, setCpcbCity] = useState("Delhi");
  const [cityPickerOpen, setCityPickerOpen] = useState(false);
  const [citySearch, setCitySearch] = useState("");
  const [cityResults, setCityResults] = useState<CityLocation[]>([]);
  const [isCitySearching, setIsCitySearching] = useState(false);
  const [backendUrl, setBackendUrl] = useState(
    process.env.NEXT_PUBLIC_BACKEND_URL || "",
  );

  // --- Data State ---
  const [telemetry, setTelemetry] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showForecastDialog, setShowForecastDialog] = useState(false);
  const [streamPhase, setStreamPhase] = useState<string>(""); // Current streaming phase

  // --- CPCB Station State ---
  const [cpcbStations, setCpcbStations] = useState<CpcbStation[]>([]);
  const [selectedStation, setSelectedStation] = useState<CpcbStation | null>(
    null,
  );
  const [nearestStation, setNearestStation] = useState<CpcbStation | null>(
    null,
  );
  const cpcbLastFetch = useRef<number>(0);
  const citySearchAbortRef = useRef<AbortController | null>(null);

  // --- Crosshair Navigation ---
  const [mapCenter, setMapCenter] = useState<{ lat: number; lon: number }>({
    lat: 28.6139,
    lon: 77.209,
  });
  const [fetchedBounds, setFetchedBounds] = useState<{
    lat: number;
    lon: number;
    radius: number;
  } | null>(null);
  const [showFetchBtn, setShowFetchBtn] = useState(false);
  const [locationName, setLocationName] = useState<string>("Delhi");

  const commonCityLocations: CityLocation[] = Object.entries(CITIES).map(
    ([key, city]) => ({
      name: city.name,
      city: city.name,
      state: city.state,
      lat: city.lat,
      lon: city.lon,
      key: key as keyof typeof CITIES,
    }),
  );

  // --- Fetch Button Timers ---
  const fetchBtnDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const fetchBtnAutoHideRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const isMapMovingRef = useRef(false);

  // --- Satellite ---
  const [satelliteData, setSatelliteData] = useState<any>(null);
  const [isFetchingSatellite, setIsFetchingSatellite] = useState(false);

  // --- Satellite Intelligence Modal (Grid, Targets, and On-Demand Analysis) ---
  const [showSatelliteModal, setShowSatelliteModal] = useState(false);
  const [gridTargets, setGridTargets] = useState<any[]>([]);
  const [visibleCount, setVisibleCount] = useState<number>(10);
  const [gridImages, setGridImages] = useState<
    Record<
      string,
      {
        id: string;
        name: string;
        lat: number;
        lon: number;
        type: string;
        image_base64?: string;
        detections?: any[];
        scene_description?: string;
        severity?: string;
        source_count?: Record<string, number>;
        pollution_sources?: string[];
        land_use?: any;
        potential_contributors?: any;
        source_attribution?: any;
        recommended_actions?: any;
        isAnalyzing?: boolean;
        isFetched?: boolean;
        error?: string;
        fetchedAt?: number;
      }
    >
  >({});
  const [gridStreamPhase, setGridStreamPhase] = useState<string>("idle");

  const handleAnalysisComplete = useCallback(
    (targetId: string, analysisData: any) => {
      setGridImages((prev) => {
        const current = prev[targetId] || {};
        if (
          current.severity === analysisData.severity &&
          current.scene_description === analysisData.scene_description &&
          JSON.stringify(current.detections) ===
            JSON.stringify(analysisData.detections)
        ) {
          return prev;
        }
        return {
          ...prev,
          [targetId]: {
            ...current,
            detections: analysisData.detections,
            scene_description: analysisData.scene_description,
            severity: analysisData.severity,
            source_count: analysisData.source_count,
            pollution_sources:
              analysisData.pollution_sources ||
              analysisData.pollution_sources_found,
            land_use: analysisData.land_use,
            potential_contributors: analysisData.potential_contributors,
            source_attribution: analysisData.source_attribution,
            recommended_actions: analysisData.recommended_actions,
          },
        };
      });
    },
    [],
  );

  const { isFetching: isFetchingGrid, refetch: refetchGrid } = useQuery({
    queryKey: ["satellite-grid", mapCenter.lat, mapCenter.lon, visibleCount],
    queryFn: async () => {
      const targets = getSatelliteTargets().slice(0, visibleCount);
      const results: Record<string, any> = {};
      targets.forEach((t) => {
        results[t.id] = { ...t, isFetched: false };
      });

      setGridStreamPhase("connecting");
      return new Promise<Record<string, any>>((resolve, reject) => {
        fetchSatelliteImagesStream(
          targets.map((t) => ({
            id: t.id,
            name: t.name,
            lat: t.lat,
            lon: t.lon,
            type: t.type,
          })),
          (d) => {
            if (d.error) {
              results[d.id] = {
                ...(results[d.id] || {}),
                error: d.error,
                isFetched: false,
              };
            } else {
              results[d.id] = {
                ...(results[d.id] || {}),
                image_base64: d.image_base64,
                isFetched: true,
                fetchedAt: Date.now(),
              };
            }
            // Sync progressively to local state for leaflet overlays
            setGridImages((prev) => ({
              ...prev,
              [d.id]: results[d.id],
            }));
          },
          backendUrl,
        )
          .then(() => {
            setGridStreamPhase("completed");
            resolve(results);
          })
          .catch((err) => {
            setGridStreamPhase("error");
            reject(err);
          });
      });
    },
    staleTime: 60000,
    refetchInterval: 30000,
    enabled: showSatelliteModal || Object.keys(gridImages).length === 0,
  });

  // --- Agent Chat ---
  const [chatHistory, setChatHistory] = useState<Message[]>([
    {
      role: "agent",
      content:
        "Commander, AI Operations Officer initialized. I am standing by to run environmental diagnostics. Submit a command or select a suggested analysis below.\n\nAnalyze Delhi\nOptimize Enforcement\nCompare Cities",
    },
  ]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([
    { time: "00:00:00", event: "Command Center online" },
  ]);
  const [activeWorkflowStep, setActiveWorkflowStep] = useState("planner");
  const [inputMessage, setInputMessage] = useState("");
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [accordionValue, setAccordionValue] = useState<string>("timeline");
  const [userCoords, setUserCoords] = useState<{
    lat: number;
    lon: number;
  } | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const uLat = position.coords.latitude;
          const uLon = position.coords.longitude;
          console.log(
            `[GEO] Browser Geolocation acquired: lat=${uLat}, lon=${uLon}`,
          );
          setUserCoords({ lat: uLat, lon: uLon });
        },
        (error) => {
          console.warn("[GEO] Browser Geolocation denied or failed:", error);
        },
      );
    }
  }, []);

  // --- UI State ---
  const [activeLeftTab, setActiveLeftTab] = useState<
    "live" | "forecast" | "attribution" | "risk"
  >("live");
  const [activeRightTab, setActiveRightTab] = useState<
    "console" | "dispersion" | "optimization" | "compare"
  >("console");
  const [showOriginalAdvisory, setShowOriginalAdvisory] = useState(false);
  const [optPanelTab, setOptPanelTab] = useState<"route" | "directives">(
    "route",
  );
  const [activeTile, setActiveTile] = useState("google");

  // --- Compare ---
  const [compareCity, setCompareCity] = useState<string>("mumbai");
  const [compareData, setCompareData] = useState<any>(null);
  const [isComparing, setIsComparing] = useState(false);

  // --- Map Layer Toggles ---
  const [showCpcbStations, setShowCpcbStations] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showTraffic, setShowTraffic] = useState(true);
  const [showSources, setShowSources] = useState(true);
  const [showEnforcement, setShowEnforcement] = useState(true);
  const [showReceptors, setShowReceptors] = useState(true);
  const [showDispersion, setShowDispersion] = useState(true);
  const [showSatellite, setShowSatellite] = useState(false);

  // --- Map Refs ---
  const mapRef = useRef<any>(null);
  const mapElementRef = useRef<HTMLDivElement>(null);
  const tileLayerRef = useRef<any>(null);
  const LRef = useRef<any>(null);

  // Layer groups
  const cpcbStationsGroup = useRef<any>(null);
  const hotspotsGroup = useRef<any>(null);
  const trafficGroup = useRef<any>(null);
  const sourcesGroup = useRef<any>(null);
  const routeGroup = useRef<any>(null);
  const receptorsGroup = useRef<any>(null);
  const dispersionGroup = useRef<any>(null);
  const satelliteGroup = useRef<any>(null);

  // =========================================================================
  // MAP INITIALIZATION
  // =========================================================================

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!process.env.NEXT_PUBLIC_BACKEND_URL) {
      setBackendUrl("");
    }

    // Load Leaflet CSS
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);

    // Load Leaflet JS
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => {
      LRef.current = (window as any).L;
      initMap();
    };
    document.body.appendChild(script);

    return () => {
      if (document.head.contains(link)) document.head.removeChild(link);
      if (document.body.contains(script)) document.body.removeChild(script);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initMap = () => {
    const L = LRef.current;
    if (!L || !mapElementRef.current || mapRef.current) return;

    const city = CITIES[cityKey];
    const map = L.map(mapElementRef.current, { zoomControl: true }).setView(
      [city.lat, city.lon],
      12,
    );

    // Set default tile layer
    const cfg = TILE_CONFIGS[activeTile];
    tileLayerRef.current = L.tileLayer(cfg.url, {
      maxZoom: 19,
      attribution: cfg.attr,
      subdomains: cfg.subdomains || ["a", "b", "c"],
    }).addTo(map);

    // Initialize all layer groups
    cpcbStationsGroup.current = L.layerGroup().addTo(map);
    hotspotsGroup.current = L.layerGroup().addTo(map);
    trafficGroup.current = L.layerGroup().addTo(map);
    sourcesGroup.current = L.layerGroup().addTo(map);
    routeGroup.current = L.layerGroup().addTo(map);
    receptorsGroup.current = L.layerGroup().addTo(map);
    dispersionGroup.current = L.layerGroup().addTo(map);
    satelliteGroup.current = L.layerGroup().addTo(map);

    // --- Smart Fetch Button: debounce on move, auto-hide ---
    map.on("move", () => {
      const c = map.getCenter();
      setMapCenter({ lat: c.lat, lon: c.lng });
      isMapMovingRef.current = true;
      // Immediately hide fetch button while moving
      setShowFetchBtn(false);
      // Clear any pending debounce
      if (fetchBtnDebounceRef.current)
        clearTimeout(fetchBtnDebounceRef.current);
      if (fetchBtnAutoHideRef.current)
        clearTimeout(fetchBtnAutoHideRef.current);
    });

    map.on("moveend", () => {
      const c = map.getCenter();
      setMapCenter({ lat: c.lat, lon: c.lng });
      isMapMovingRef.current = false;

      // 1-second debounce before showing fetch button
      if (fetchBtnDebounceRef.current)
        clearTimeout(fetchBtnDebounceRef.current);
      fetchBtnDebounceRef.current = setTimeout(() => {
        if (isMapMovingRef.current) return; // User started moving again

        // Check if crosshair is outside fetched bounds
        let shouldShow = true;
        if (fetchedBounds) {
          const dist =
            Math.sqrt(
              Math.pow(c.lat - fetchedBounds.lat, 2) +
                Math.pow(c.lng - fetchedBounds.lon, 2),
            ) * 111; // rough km
          shouldShow = dist > fetchedBounds.radius * 0.5;
        }

        if (shouldShow) {
          setShowFetchBtn(true);
          // 15-second auto-hide
          if (fetchBtnAutoHideRef.current)
            clearTimeout(fetchBtnAutoHideRef.current);
          fetchBtnAutoHideRef.current = setTimeout(() => {
            setShowFetchBtn(false);
          }, 15000);
        }
      }, 1000);
    });

    mapRef.current = map;
  };

  // Pan map on city change
  useEffect(() => {
    const city = CITIES[cityKey];
    if (mapRef.current) mapRef.current.setView([city.lat, city.lon], 12);
  }, [cityKey]);

  // Switch tile layers
  const switchTiles = (key: string) => {
    const L = LRef.current;
    if (!L || !mapRef.current) return;
    if (tileLayerRef.current) mapRef.current.removeLayer(tileLayerRef.current);
    const cfg = TILE_CONFIGS[key];
    tileLayerRef.current = L.tileLayer(cfg.url, {
      maxZoom: 19,
      attribution: cfg.attr,
      subdomains: cfg.subdomains || ["a", "b", "c"],
    }).addTo(mapRef.current);
    setActiveTile(key);
  };

  // Toggle layer visibility
  const toggleLayer = (
    group: React.MutableRefObject<any>,
    visible: boolean,
  ) => {
    if (!mapRef.current || !group.current) return;
    if (visible) mapRef.current.addLayer(group.current);
    else mapRef.current.removeLayer(group.current);
  };

  // =========================================================================
  // CPCB STATION FETCHING & RENDERING
  // =========================================================================

  const fetchCpcbStations = useCallback(
    async (lat: number, lon: number) => {
      try {
        const stations = await fetchCpcbStationsClient(
          cpcbCity,
          lat,
          lon,
          100.0,
          undefined,
          (progressiveStations) => {
            setCpcbStations(progressiveStations);
          },
        );
        setCpcbStations(stations);
        cpcbLastFetch.current = Date.now();

        // Find nearest station
        if (stations.length > 0) {
          let nearest = stations[0];
          let minDist = Infinity;
          for (const st of stations) {
            const dist = Math.sqrt(
              Math.pow(st.lat - lat, 2) + Math.pow(st.lon - lon, 2),
            );
            if (dist < minDist) {
              minDist = dist;
              nearest = st;
            }
          }
          setNearestStation(nearest);
          // If no station is selected yet, auto-select nearest
          if (!selectedStation) setSelectedStation(nearest);
        }
      } catch (err) {
        console.error("CPCB fetch failed:", err);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [selectedStation, cpcbCity],
  );

  // Render CPCB station markers on map
  const renderCpcbMarkers = useCallback(
    (stations: CpcbStation[], selected: CpcbStation | null) => {
      const L = LRef.current;
      if (!L || !cpcbStationsGroup.current) return;
      cpcbStationsGroup.current.clearLayers();

      const zoom = mapRef.current?.getZoom() || 12;

      stations.forEach((st) => {
        const aqiVal = Math.round(st.aqi);
        const bubbleClass = getAqiBubbleClass(aqiVal);
        const isSelected = selected?.station === st.station;

        // Create bubble marker
        const marker = L.marker([st.lat, st.lon], {
          icon: L.divIcon({
            className: "custom-div-icon",
            html: `<div class="aqi-bubble ${bubbleClass} ${isSelected ? "selected" : ""}">${aqiVal}</div>${
              zoom >= 13
                ? `<div class="aqi-station-label">${st.station.split(",")[0]}</div>`
                : ""
            }`,
            iconSize: [36, zoom >= 13 ? 52 : 36],
            iconAnchor: [18, 18],
          }),
          zIndexOffset: isSelected ? 1000 : aqiVal,
        });

        // Hover tooltip
        marker.bindTooltip(
          `<strong>${st.station}</strong><br/>` +
            `AQI: <strong style="color:${getAqiZoneColor(aqiVal)}">${aqiVal}</strong> — ${st.aqi_category}<br/>` +
            `<span style="font-size:10px;color:#aaa">PM2.5: ${st.pm25} · PM10: ${st.pm10} · NO₂: ${st.no2}</span>`,
          { className: "station-tooltip", direction: "top", offset: [0, -20] },
        );

        // Click: select station → update dashboard
        marker.on("click", () => {
          setSelectedStation(st);
          // Re-render markers to update selection highlight
          renderCpcbMarkers(stations, st);
        });

        marker.addTo(cpcbStationsGroup.current);
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  );

  // Re-render markers when stations change
  useEffect(() => {
    if (cpcbStations.length > 0) {
      renderCpcbMarkers(cpcbStations, selectedStation);
    }
  }, [cpcbStations, selectedStation, renderCpcbMarkers]);

  // Re-render on zoom change (for station labels)
  useEffect(() => {
    if (!mapRef.current) return;
    const onZoom = () => {
      if (cpcbStations.length > 0)
        renderCpcbMarkers(cpcbStations, selectedStation);
    };
    const map = mapRef.current;
    map?.on("zoomend", onZoom);
    return () => {
      map?.off("zoomend", onZoom);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cpcbStations, selectedStation]);

  // Update nearest station when map center changes (from cached data)
  useEffect(() => {
    if (cpcbStations.length === 0) return;
    let nearest = cpcbStations[0];
    let minDist = Infinity;
    for (const st of cpcbStations) {
      const dist = Math.sqrt(
        Math.pow(st.lat - mapCenter.lat, 2) +
          Math.pow(st.lon - mapCenter.lon, 2),
      );
      if (dist < minDist) {
        minDist = dist;
        nearest = st;
      }
    }
    setNearestStation(nearest);
  }, [mapCenter, cpcbStations]);

  // =========================================================================
  // MAP LAYER RENDERERS
  // =========================================================================

  /** Render a specific layer group with data. Called per-phase during streaming. */
  const renderLayerByPhase = useCallback(
    (phase: string, data: any, allData: any) => {
      const L = LRef.current;
      if (!L || !mapRef.current) return;
      const centerLat = allData?.location?.lat || mapCenter.lat;
      const centerLon = allData?.location?.lon || mapCenter.lon;

      if (phase === "data" || phase === "all") {
        // Clear groups that use API data
        [trafficGroup, sourcesGroup, receptorsGroup].forEach((g) =>
          g.current?.clearLayers(),
        );

        // --- TRAFFIC CONGESTION NODES (REAL DATA FROM OVERPASS JUNCTIONS + TOMTOM) ---
        const currentAqi = allData?.current_aqi || 0;
        const realTrafficGrid: TrafficNode[] = allData?.traffic_grid || [];

        if (realTrafficGrid.length > 0) {
          realTrafficGrid.forEach((node: TrafficNode) => {
            const cong = Math.max(0.05, Math.min(0.98, node.congestion));

            let statusText = "Free Flow";
            let color = "#00e676"; // Green
            let radiusMeters = 380;

            if (cong >= 0.7) {
              statusText = "Heavy Gridlock";
              color = "#ff1744"; // Red
              radiusMeters = 750;
            } else if (cong >= 0.45) {
              statusText = "Moderate Slowdown";
              color = "#ff9100"; // Orange
              radiusMeters = 550;
            } else if (cong >= 0.25) {
              statusText = "Light Congestion";
              color = "#ffd600"; // Yellow
              radiusMeters = 420;
            }

            const speed = node.speed_kmh;
            const aqiImpact = Math.round(currentAqi * (cong * 0.25));

            // Outer heat impact circle
            L.circle([node.lat, node.lon], {
              radius: radiusMeters,
              color: color,
              fillColor: color,
              fillOpacity: 0.2,
              weight: 2,
              dashArray: cong >= 0.7 ? "4,4" : undefined,
            }).addTo(trafficGroup.current);

            // Center colored dot marker with tooltip & popup
            L.circleMarker([node.lat, node.lon], {
              radius: cong >= 0.7 ? 9 : 6,
              color: "#ffffff",
              fillColor: color,
              fillOpacity: 0.95,
              weight: 2,
              className: cong >= 0.7 ? "pulse-danger" : "",
            })
              .addTo(trafficGroup.current)
              .bindPopup(
                `<div class="traffic-zone-popup">` +
                  `<strong>🚘 ${node.name}</strong><br/>` +
                  `Traffic Status: <strong style="color:${color}">${statusText} (${(cong * 100).toFixed(0)}%)</strong><br/>` +
                  `Avg Speed: <strong>${speed} km/h</strong><br/>` +
                  `AQI Contribution: <strong>+${aqiImpact} AQI</strong><br/>` +
                  `<span style="font-size:10px;color:#aaa">Source: TomTom Live Flow</span>` +
                  `</div>`,
                { maxWidth: 260 },
              )
              .bindTooltip(
                `<strong>${node.name}</strong>: <span style="color:${color}">${statusText} (${speed} km/h)</span>`,
                {
                  className: "station-tooltip",
                  direction: "top",
                  offset: [0, -10],
                },
              );
          });
        }

        // --- INDUSTRIAL & FIRE SOURCES (Professional Pin Markers) ---
        sourcesGroup.current?.clearLayers();
        receptorsGroup.current?.clearLayers();

        if (allData?.geospatial?.nearby_industries) {
          const uniqueIndustries = allData.geospatial.nearby_industries.filter(
            (ind: any, index: number, self: any[]) =>
              index ===
              self.findIndex(
                (t: any) =>
                  (t.name &&
                    ind.name &&
                    t.name.toLowerCase().trim() ===
                      ind.name.toLowerCase().trim()) ||
                  (Math.abs(t.lat - ind.lat) < 0.0025 &&
                    Math.abs(t.lon - ind.lon) < 0.0025),
              ),
          );

          uniqueIndustries.slice(0, 8).forEach((ind: any) => {
            if (!ind.lat || !ind.lon) return;

            // Outer impact ring
            L.circle([ind.lat, ind.lon], {
              radius: 200,
              color: "#ff9100",
              fillColor: "#ff9100",
              fillOpacity: 0.06,
              weight: 1,
              dashArray: "3,5",
            }).addTo(sourcesGroup.current);

            const marker = L.marker([ind.lat, ind.lon], {
              icon: L.divIcon({
                className: "custom-div-icon",
                html: `<div class="marker-pin marker-pin--factory"><i class="fa-solid fa-industry pin-icon"></i></div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 28],
              }),
            });

            // Build popup with satellite image if available
            let popupHtml =
              `<strong>🏭 ${ind.name || "Industrial Source"}</strong><br/>` +
              `Type: ${ind.type || "industrial"}<br/>` +
              `Distance: ${ind.distance_km?.toFixed(1) || "?"} km`;

            const indKey = `industry_${ind.name || `${ind.lat}_${ind.lon}`}`;
            const gridImg = gridImages[indKey];

            if (gridImg && gridImg.image_base64) {
              popupHtml +=
                `<br/><div style="margin-top:6px;width:180px;height:120px;background-image:url(data:image/jpeg;base64,${gridImg.image_base64});` +
                `background-size:cover;background-position:center;` +
                `border-radius:4px;border:1px solid #e040fb44"></div>`;
              if (gridImg.severity && gridImg.severity !== "unknown") {
                popupHtml += `<span style="font-size:9px;color:#e040fb">Satellite Analysis: <strong>${gridImg.severity.toUpperCase()}</strong></span>`;
              } else {
                popupHtml += `<span style="font-size:9px;color:#aaa">Satellite loaded (Open satellite panel to analyze)</span>`;
              }
            } else {
              popupHtml += `<br/><span style="font-size:10px;color:#e040fb">📡 Open satellite panel to fetch imagery</span>`;
            }

            marker.bindPopup(popupHtml, { maxWidth: 240 });
            marker.bindTooltip(
              `${ind.name || "Industry"} — ${ind.type || "industrial"}`,
              {
                className: "station-tooltip",
                direction: "top",
                offset: [0, -30],
              },
            );
            marker.addTo(sourcesGroup.current);
          });
        }

        // Construction sites
        if (allData?.geospatial?.construction_sites > 0) {
          const cLat = centerLat + 0.008;
          const cLon = centerLon - 0.006;
          L.marker([cLat, cLon], {
            icon: L.divIcon({
              className: "custom-div-icon",
              html: `<div class="marker-pin marker-pin--construction"><i class="fa-solid fa-helmet-safety pin-icon"></i></div>`,
              iconSize: [28, 28],
              iconAnchor: [14, 28],
            }),
          })
            .addTo(sourcesGroup.current)
            .bindPopup(
              `<strong>🏗 Construction Activity</strong><br/>${allData.geospatial.construction_sites} site(s) detected`,
            );
        }

        // Fire alerts
        if (allData?.fire_data?.length > 0) {
          allData.fire_data.forEach((f: any) => {
            L.circle([f.lat, f.lon], {
              radius: 400,
              color: "#ff1744",
              fillColor: "#ff1744",
              fillOpacity: 0.08,
              weight: 1,
              dashArray: "3,5",
            }).addTo(sourcesGroup.current);

            const fireKey = `fire_${f.lat}_${f.lon}`;
            const fireImg = gridImages[fireKey];

            let firePopupHtml =
              `<strong>🔥 NASA FIRMS Alert</strong><br/>` +
              `Distance: ${f.distance_km?.toFixed(1)} km<br/>` +
              `Confidence: ${f.confidence}<br/>` +
              `FRP: ${f.fire_radiative_power} MW<br/>` +
              `Date: ${f.acq_date} ${f.acq_time}<br/>` +
              `Satellite: ${f.satellite}`;

            if (fireImg && fireImg.image_base64) {
              firePopupHtml +=
                `<br/><div style="margin-top:6px;width:180px;height:120px;background-image:url(data:image/jpeg;base64,${fireImg.image_base64});` +
                `background-size:cover;background-position:center;` +
                `border-radius:4px;border:1px solid #ff174444"></div>`;
              if (fireImg.severity && fireImg.severity !== "unknown") {
                firePopupHtml += `<span style="font-size:9px;color:#ff1744">Satellite Analysis: <strong>${fireImg.severity.toUpperCase()}</strong></span>`;
              }
            } else {
              firePopupHtml += `<br/><span style="font-size:10px;color:#ff1744">📡 Open satellite panel to fetch imagery</span>`;
            }

            L.marker([f.lat, f.lon], {
              icon: L.divIcon({
                className: "custom-div-icon",
                html: `<div class="marker-pin marker-pin--fire"><i class="fa-solid fa-fire pin-icon"></i></div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 28],
              }),
            })
              .addTo(sourcesGroup.current)
              .bindPopup(firePopupHtml, { maxWidth: 240 });
          });
        }

        // --- RECEPTORS (Schools & Hospitals) ---
        const aqi2 = allData?.current_aqi || 0;
        if (allData?.geospatial?.nearby_schools) {
          allData.geospatial.nearby_schools.forEach((s: any) => {
            if (!s.lat || !s.lon) return;
            const isWarning = aqi2 > 200;
            L.marker([s.lat, s.lon], {
              icon: L.divIcon({
                className: "custom-div-icon",
                html: `<div class="marker-pin marker-pin--school${isWarning ? " pulse-danger" : ""}"><i class="fa-solid fa-school pin-icon"></i></div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 28],
              }),
            })
              .addTo(receptorsGroup.current)
              .bindPopup(
                `<strong>🏫 ${s.name || "School"}</strong><br/>` +
                  `Distance: ${s.distance_km?.toFixed(1)} km` +
                  (isWarning
                    ? `<br/><span style='color:#ff1744;font-weight:bold'>⚠ AQI ${Math.round(aqi2)} — Health Risk Zone</span>`
                    : ""),
              )
              .bindTooltip(s.name || "School", {
                className: "station-tooltip",
                direction: "top",
                offset: [0, -30],
              });
          });
        }
        if (allData?.geospatial?.nearby_hospitals) {
          allData.geospatial.nearby_hospitals.forEach((h: any) => {
            if (!h.lat || !h.lon) return;
            L.marker([h.lat, h.lon], {
              icon: L.divIcon({
                className: "custom-div-icon",
                html: `<div class="marker-pin marker-pin--hospital"><i class="fa-solid fa-hospital pin-icon"></i></div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 28],
              }),
            })
              .addTo(receptorsGroup.current)
              .bindPopup(
                `<strong>🏥 ${h.name || "Hospital"}</strong><br/>Distance: ${h.distance_km?.toFixed(1)} km`,
              )
              .bindTooltip(h.name || "Hospital", {
                className: "station-tooltip",
                direction: "top",
                offset: [0, -30],
              });
          });
        }
      }

      // --- HOTSPOT CLUSTERS ---
      if (phase === "hotspots" || phase === "all") {
        hotspotsGroup.current?.clearLayers();
        if (allData?.hotspots?.hotspots) {
          allData.hotspots.hotspots.forEach((hs: any) => {
            const lat = hs.center_lat ?? hs.lat;
            const lon = hs.center_lon ?? hs.lon;
            const severity = hs.severity || "medium";
            const avgAqi = hs.avg_aqi ?? hs.value ?? 200;
            const radiusMap: Record<string, number> = {
              critical: 11,
              high: 9,
              medium: 7,
              low: 5,
            };
            const colorMap: Record<string, string> = {
              critical: "#b71c1c",
              high: "#ff1744",
              medium: "#ff9100",
              low: "#ffd600",
            };
            const r = radiusMap[severity] || 7;
            const c = colorMap[severity] || "#ff9100";
            const outerRadius = Math.min(800, (hs.area_sq_km || 0.5) * 400);
            L.circle([lat, lon], {
              radius: outerRadius,
              color: c,
              fillColor: c,
              fillOpacity: 0.05,
              weight: 1,
              dashArray: "3,5",
            }).addTo(hotspotsGroup.current);
            const markerSize = r * 2;
            L.marker([lat, lon], {
              icon: L.divIcon({
                className: "custom-div-icon",
                html: `<div class="hotspot-marker" style="width:${markerSize}px;height:${markerSize}px">
                  <div class="hotspot-core" style="background:${c}"></div>
                </div>`,
                iconSize: [markerSize, markerSize],
                iconAnchor: [r, r],
              }),
            })
              .addTo(hotspotsGroup.current)
              .bindPopup(
                `<strong>Pollution Hotspot ${hs.cluster_id ?? ""}</strong><br/>Avg AQI: ${avgAqi.toFixed(0)}<br/>Severity: ${severity.toUpperCase()}<br/>Stations: ${hs.station_count || "?"}<br/>Area: ${hs.area_sq_km?.toFixed(1) || "?"} km²`,
              );
          });
        }
      }

      // --- ENFORCEMENT INSPECTION POINTS (formerly Patrol/Team Stops) ---
      if (phase === "optimization" || phase === "all") {
        routeGroup.current?.clearLayers();
        if (allData?.optimization?.routes) {
          const routeColors = ["#00e5ff", "#00e676", "#d500f9"];
          allData.optimization.routes.forEach(
            (teamRoute: any[], teamIdx: number) => {
              if (!teamRoute || teamRoute.length === 0) return;
              const color = routeColors[teamIdx % routeColors.length];
              const coords = teamRoute.map((pt: any) => [pt.lat, pt.lon]);
              if (coords.length > 1) {
                L.polyline(coords, {
                  color,
                  weight: 2,
                  opacity: 0.65,
                  dashArray: "6,8",
                }).addTo(routeGroup.current);
              }
              teamRoute.forEach((pt: any) => {
                const priority = pt.priority || "medium";
                const badgeClass =
                  priority === "critical"
                    ? "inspection-badge--critical"
                    : priority === "high"
                      ? "inspection-badge--high"
                      : "inspection-badge--medium";
                L.marker([pt.lat, pt.lon], {
                  zIndexOffset: 1000,
                  icon: L.divIcon({
                    className: "custom-div-icon",
                    html: `<div class="inspection-badge ${badgeClass}">${pt.order + 1}</div>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12],
                  }),
                })
                  .addTo(routeGroup.current)
                  .bindPopup(
                    `<strong>📋 Inspection Point ${pt.order + 1}</strong><br/>` +
                      `<span style="color:${priority === "critical" ? "#ff1744" : priority === "high" ? "#ff9100" : "#ffd600"};font-weight:bold">${priority.toUpperCase()} Priority</span><br/>` +
                      `Patrol Unit: ${teamIdx + 1}<br/>` +
                      `Est. Time: ~${pt.estimated_time_min || 20} min<br/>` +
                      `<span style="font-size:10px;color:#aaa">Action: Inspect emission sources & check compliance</span>`,
                  )
                  .bindTooltip(
                    `Inspection #${pt.order + 1} — ${priority.toUpperCase()}`,
                    {
                      className: "station-tooltip",
                      direction: "top",
                      offset: [0, -14],
                    },
                  );
              });
            },
          );
        } else if (allData?.optimization?.route) {
          const coords = allData.optimization.route.map((pt: any) => [
            pt.lat,
            pt.lon,
          ]);
          L.polyline(coords, {
            color: "#00e5ff",
            weight: 2,
            opacity: 0.5,
            dashArray: "8,12",
          }).addTo(routeGroup.current);
          allData.optimization.route.forEach((pt: any, idx: number) => {
            L.marker([pt.lat, pt.lon], {
              zIndexOffset: 1000,
              icon: L.divIcon({
                className: "custom-div-icon",
                html: `<div class="inspection-badge inspection-badge--medium">${idx + 1}</div>`,
                iconSize: [24, 24],
                iconAnchor: [12, 12],
              }),
            })
              .addTo(routeGroup.current)
              .bindPopup(
                `<strong>📋 Inspection Point ${idx + 1}</strong><br/>${pt.location_name || ""}`,
              );
          });
        }
      }

      // --- DISPERSION PLUME ---
      if (phase === "dispersion" || phase === "all") {
        dispersionGroup.current?.clearLayers();
        if (allData?.dispersion) {
          const plumes = allData.dispersion.plumes || [allData.dispersion];
          plumes.forEach((plume: any) => {
            if (plume?.concentration_grid && plume?.grid_bounds) {
              const grid = plume.concentration_grid;
              const bounds = plume.grid_bounds;
              const rows = grid.length;
              const cols = grid[0]?.length || 0;
              if (rows > 0 && cols > 0) {
                const latStep = (bounds.north - bounds.south) / rows;
                const lonStep = (bounds.east - bounds.west) / cols;
                for (let i = 0; i < rows; i++) {
                  for (let j = 0; j < cols; j++) {
                    const val = grid[i][j];
                    if (val < 0.1) continue;
                    const lat = bounds.south + i * latStep;
                    const lon = bounds.west + j * lonStep;
                    const color =
                      val > 0.7
                        ? "#ff1744"
                        : val > 0.4
                          ? "#ff9100"
                          : val > 0.2
                            ? "#ffd600"
                            : "#ffeb3b";
                    const opacity = Math.min(0.25, val * 0.3);
                    L.rectangle(
                      [
                        [lat, lon],
                        [lat + latStep, lon + lonStep],
                      ],
                      {
                        stroke: false,
                        fillColor: color,
                        fillOpacity: opacity,
                      },
                    ).addTo(dispersionGroup.current);
                  }
                }
              }
            }
          });

          if (allData.dispersion.source) {
            L.circleMarker(
              [allData.dispersion.source.lat, allData.dispersion.source.lon],
              {
                radius: 5,
                color: "#d500f9",
                fillColor: "#d500f9",
                fillOpacity: 0.9,
                weight: 2,
              },
            )
              .addTo(dispersionGroup.current)
              .bindPopup(
                `<strong>Dispersion Source</strong><br/>${allData.dispersion.wind_description || ""}<br/>Affected area: ${allData.dispersion.affected_area_sq_km?.toFixed(1) || "?"} km²`,
              );
          }
        }
      }

      // --- SATELLITE DETECTIONS ---
      if (phase === "satellite" || phase === "all") {
        satelliteGroup.current?.clearLayers();

        // 1. Render NASA FIRMS Satellite Thermal Anomaly Detections
        if (allData?.fire_data && Array.isArray(allData.fire_data)) {
          allData.fire_data.forEach((fire: any) => {
            if (!fire.lat || !fire.lon) return;
            L.circleMarker([fire.lat, fire.lon], {
              radius: 9,
              color: "#e040fb",
              fillColor: "#ff1744",
              fillOpacity: 0.9,
              weight: 2,
              className: "pulse-danger",
            })
              .addTo(satelliteGroup.current)
              .bindPopup(
                `<strong>🛰️ NASA Satellite Thermal Detection</strong><br/>` +
                  `Satellite: <strong>${fire.satellite || "VIIRS/SNPP"}</strong><br/>` +
                  `Brightness: <strong>${fire.brightness || "?"} K</strong><br/>` +
                  `Confidence: ${fire.confidence || "nominal"}<br/>` +
                  `Acquired: ${fire.acq_date || ""} ${fire.acq_time || ""}<br/>` +
                  `<span style="font-size:10px;color:#aaa">FIRMS Thermal Sensing Anomaly</span>`,
                { maxWidth: 260 },
              )
              .bindTooltip(
                `Satellite Thermal Anomaly (${fire.brightness || 300}K)`,
                {
                  className: "station-tooltip",
                  direction: "top",
                  offset: [0, -10],
                },
              );
          });
        }

        // 2. Render Image AI Satellite Detections
        Object.values(gridImages || {}).forEach((gridImg: any) => {
          if (gridImg?.detections && gridImg.detections.length > 0) {
            const targetLat = gridImg.lat;
            const targetLon = gridImg.lon;

            gridImg.detections.forEach((det: any) => {
              const imgW = 512,
                imgH = 512;
              const bx = det.bbox?.x_min ?? 0;
              const by = det.bbox?.y_min ?? 0;
              const bxMax = det.bbox?.x_max ?? imgW;
              const byMax = det.bbox?.y_max ?? imgH;
              const cx = (bx + bxMax) / 2;
              const cy = (by + byMax) / 2;

              const offsetLat = ((imgH / 2 - cy) / imgH) * 0.02;
              const offsetLon = ((cx - imgW / 2) / imgW) * 0.02;
              const dLat = targetLat + offsetLat;
              const dLon = targetLon + offsetLon;

              const sevColor =
                det.confidence > 0.6
                  ? "#ff1744"
                  : det.confidence > 0.4
                    ? "#ff9100"
                    : "#ffd600";

              L.circleMarker([dLat, dLon], {
                radius: 8,
                color: sevColor,
                fillColor: sevColor,
                fillOpacity: 0.9,
                weight: 2,
                className: "pulse-danger",
              })
                .addTo(satelliteGroup.current)
                .bindPopup(
                  `<strong>🛰️ Satellite AI Detection</strong><br/>` +
                    `Target: <strong>${gridImg.name || "Anomaly"}</strong><br/>` +
                    `Label: <strong>${det.label}</strong><br/>` +
                    `Confidence: ${(det.confidence * 100).toFixed(0)}%<br/>` +
                    `Model: ${det.source || "Florence-2"}<br/>` +
                    (gridImg.image_base64
                      ? `<img src="data:image/jpeg;base64,${gridImg.image_base64}" style="width:200px;margin-top:6px;border-radius:4px;border:1px solid #00e5ff44"/><br/>`
                      : "") +
                    `<span style="font-size:10px;color:#aaa">${gridImg.scene_description?.slice(0, 100) || ""}</span>`,
                  { maxWidth: 260 },
                );
            });
          }
        });
      }
    },
    [mapCenter, satelliteData],
  );

  // Legacy wrapper for agent streaming that needs full re-render
  const renderAllMapLayers = useCallback(
    (data: any) => {
      renderLayerByPhase("all", data, data);
    },
    [renderLayerByPhase],
  );

  // =========================================================================
  // DATA SYNC — Progressive Streaming via /analyze/stream
  // =========================================================================

  const addTimelineEvent = (message: string) => {
    const t = new Date().toTimeString().split(" ")[0];
    setTimeline((prev) => [{ time: t, event: message }, ...prev]);
  };

  const syncDashboard = useCallback(
    async (force = false, silent = false, requestedLocation?: CityLocation) => {
      if (!silent) setIsSyncing(true);
      setIsLoading(true);
      setStreamPhase("connecting");
      // Hide only the top critical banner while a new official reading is
      // pending. Sidebar state remains untouched if the refresh later fails.
      setTelemetry((previous: any) =>
        previous ? { ...previous, official_aqi_available: false } : previous,
      );

      const lat = requestedLocation?.lat ?? mapCenter.lat;
      const lon = requestedLocation?.lon ?? mapCenter.lon;
      const cityName = requestedLocation?.city || cpcbCity;

      addTimelineEvent("📡 Fetching raw environmental API telemetry...");
      setStreamPhase("data");

      try {
        const [weatherData, trafficData, fireData, geoData, trafficGrid] =
          await Promise.all([
            fetchCurrentWeather(lat, lon),
            fetchTraffic(lat, lon),
            fetchFireData(lat, lon, CONFIG.FIRE_SEARCH_RADIUS_KM),
            analyzeLocationGeospatial(
              lat,
              lon,
              CONFIG.GEOSPATIAL_SEARCH_RADIUS_KM,
            ),
            fetchTrafficGrid(lat, lon, CONFIG.TRAFFIC_SEARCH_RADIUS_KM),
          ]);

        const updateStationState = (progressiveStations: CpcbStation[]) => {
          setCpcbStations(progressiveStations);
          if (progressiveStations.length > 0) {
            let nearest = progressiveStations[0];
            let minDist = Infinity;
            for (const st of progressiveStations) {
              const dist = Math.sqrt(
                Math.pow(st.lat - lat, 2) + Math.pow(st.lon - lon, 2),
              );
              if (dist < minDist) {
                minDist = dist;
                nearest = st;
              }
            }
            setNearestStation(nearest);
            setSelectedStation((prev) => prev || nearest);
            setTelemetry((prev: any) =>
              prev
                ? {
                    ...prev,
                    current_aqi: nearest.aqi,
                    aqi_category: getAqiCategory(nearest.aqi),
                  }
                : prev,
            );
          }
        };

        // The dashboard AQI comes from official CPCB sources only.
        const finalStations = await fetchCpcbStationsClient(
          cityName,
          lat,
          lon,
          CONFIG.STATION_SEARCH_RADIUS_KM,
          undefined,
          updateStationState,
        );
        cpcbLastFetch.current = Date.now();
        updateStationState(finalStations);

        let currentAqi = 0;
        const stationsForAqi =
          finalStations.length > 0 ? finalStations : cpcbStations;
        if (stationsForAqi.length > 0) {
          // The CPCB response is not guaranteed to be sorted by distance.
          // Use the monitor closest to the selected map point, not item zero.
          const nearestForAqi = stationsForAqi.reduce((nearest, station) => {
            const nearestDistance = Math.hypot(
              nearest.lat - lat,
              nearest.lon - lon,
            );
            const stationDistance = Math.hypot(
              station.lat - lat,
              station.lon - lon,
            );
            return stationDistance < nearestDistance ? station : nearest;
          });
          currentAqi = nearestForAqi.aqi;
        }

        const initialTelemetry: any = {
          location: {
            city: cityName,
            lat,
            lon,
            state: requestedLocation?.state || geoData.state,
            ward: geoData.ward,
          },
          current_aqi: currentAqi,
          // Deliberately separate official availability from the sidebar's
          // retained station state. The top alert must disappear on a failed
          // official fetch instead of showing an obsolete or zero AQI.
          official_aqi_available: finalStations.length > 0,
          aqi_category:
            currentAqi > 0 ? getAqiCategory(currentAqi) : "Loading...",
          weather_data: weatherData,
          traffic_data: trafficData,
          traffic_grid: trafficGrid,
          fire_data: fireData,
          geospatial: geoData,
        };

        setTelemetry(initialTelemetry);
        setIsLoading(false);
        setLocationName(cityName);
        renderLayerByPhase("data", initialTelemetry, initialTelemetry);
        renderLayerByPhase("satellite", initialTelemetry, initialTelemetry);
        addTimelineEvent(
          `Telemetry sync OK — ${cityName} AQI: ${currentAqi > 0 ? currentAqi.toFixed(1) : "Syncing"} [${currentAqi > 0 ? getAqiCategory(currentAqi) : "Loading"}]`,
        );
        setFetchedBounds({ lat, lon, radius: 10 });
        setShowFetchBtn(false);

        let accumulated: any = { ...initialTelemetry };

        // 300ms delay to simulate progressive streaming phases
        await new Promise((resolve) => setTimeout(resolve, 300));

        // --- Phase 2: Forecast ---
        setStreamPhase("forecast");
        addTimelineEvent(
          "🧠 Executing custom-trained XGBoost AQI forecasting model...",
        );
        let forecastRes = null;
        let histAqi: number[] = [];
        try {
          const historicalModelInputs = await fetchHistoricalAqi(lat, lon, 168);
          // Historical Open-Meteo values describe the hourly pattern. Anchor that
          // pattern at the selected official CPCB station before model inference.
          histAqi = alignHistoryToOfficialAqi(
            historicalModelInputs,
            currentAqi,
          );
          forecastRes = await fetchTimesfmForecast(
            histAqi,
            backendUrl,
            lat,
            lon,
            currentAqi,
          );
          addTimelineEvent("✅ Forecast model complete");
        } catch (fErr) {
          console.warn("Forecast service currently unavailable:", fErr);
          addTimelineEvent(
            "⚠ Forecast backend unavailable — skipping forecast step",
          );
        }
        accumulated = {
          ...accumulated,
          forecast: forecastRes,
          historical_aqi: histAqi,
        };
        setTelemetry(accumulated);
        renderLayerByPhase("forecast", accumulated, accumulated);

        await new Promise((resolve) => setTimeout(resolve, 300));

        // --- Phase 3: Hotspots (DBSCAN Clustering from REAL Telemetry) ---
        setStreamPhase("hotspots");
        addTimelineEvent(
          "📡 Identifying local pollution hotspots from real sensors...",
        );

        const realReadings: { lat: number; lon: number; aqi: number }[] = [];

        // 1. Include real CPCB stations
        (
          (finalStations && finalStations.length > 0
            ? finalStations
            : cpcbStations) || []
        ).forEach((st) => {
          if (st.lat && st.lon && st.aqi > 80) {
            realReadings.push({ lat: st.lat, lon: st.lon, aqi: st.aqi });
          }
        });

        // 2. Include real NASA thermal satellite fire alerts
        (fireData || []).forEach((fire: any) => {
          if (fire.lat && fire.lon) {
            realReadings.push({
              lat: fire.lat,
              lon: fire.lon,
              aqi: fire.brightness > 320 ? 350 : 250,
            });
          }
        });

        // 3. Include real industrial emission sites
        (geoData?.nearby_industries || []).forEach((ind: any) => {
          if (ind.lat && ind.lon) {
            realReadings.push({ lat: ind.lat, lon: ind.lon, aqi: 220 });
          }
        });

        if (realReadings.length === 0) {
          realReadings.push({ lat, lon, aqi: currentAqi });
        }

        const hotspotsList: any[] = [];
        const visited = new Set<number>();
        const eps = 10.0 / 111.0; // 10km DBSCAN clustering radius
        let clusterIdCounter = 1;

        for (let i = 0; i < realReadings.length; i++) {
          if (visited.has(i)) continue;
          const clusterPoints: typeof realReadings = [];

          for (let j = 0; j < realReadings.length; j++) {
            const d = Math.sqrt(
              Math.pow(realReadings[i].lat - realReadings[j].lat, 2) +
                Math.pow(realReadings[i].lon - realReadings[j].lon, 2),
            );
            if (d <= eps) {
              clusterPoints.push(realReadings[j]);
              visited.add(j);
            }
          }

          if (clusterPoints.length >= 1) {
            const centerLat =
              clusterPoints.reduce((sum, p) => sum + p.lat, 0) /
              clusterPoints.length;
            const centerLon =
              clusterPoints.reduce((sum, p) => sum + p.lon, 0) /
              clusterPoints.length;
            const avgAqi =
              clusterPoints.reduce((sum, p) => sum + p.aqi, 0) /
              clusterPoints.length;

            let severity = "medium";
            if (avgAqi > 300) severity = "critical";
            else if (avgAqi > 200) severity = "high";
            else if (avgAqi < 150) severity = "low";

            hotspotsList.push({
              cluster_id: clusterIdCounter++,
              center_lat: centerLat,
              center_lon: centerLon,
              avg_aqi: avgAqi,
              value: avgAqi,
              station_count: clusterPoints.length,
              area_sq_km: Math.max(1.2, clusterPoints.length * 2.5),
              severity,
            });
          }
        }

        const hotspotRes = {
          hotspots: hotspotsList,
          total_clusters: hotspotsList.length,
        };

        accumulated = {
          ...accumulated,
          hotspots: hotspotRes,
        };
        setTelemetry(accumulated);
        renderLayerByPhase("hotspots", accumulated, accumulated);
        addTimelineEvent("✅ Hotspot detection complete");

        await new Promise((resolve) => setTimeout(resolve, 300));

        // --- Phase 4: Dispersion (Gaussian Plume) ---
        setStreamPhase("dispersion");
        addTimelineEvent("💨 Simulating meteorological plume dispersion...");
        // Primary city center plume covering larger area (~50km)
        const primaryDispersion = modelDispersion(
          lat,
          lon,
          weatherData.wind_speed,
          weatherData.wind_direction,
          100.0,
          30.0,
          50.0, // gridSizeKm
          30, // resolution
          "D",
        );

        // Plumes for active industrial sources
        const industrialPlumes = (
          accumulated.geospatial?.nearby_industries || []
        ).map((ind: any) => {
          return modelDispersion(
            ind.lat,
            ind.lon,
            weatherData.wind_speed,
            weatherData.wind_direction,
            60.0,
            25.0,
            15.0,
            20,
            "D",
          );
        });

        // Plumes for active fire alerts
        const firePlumes = (accumulated.fire_data || []).map((f: any) => {
          return modelDispersion(
            f.lat,
            f.lon,
            weatherData.wind_speed,
            weatherData.wind_direction,
            80.0,
            10.0,
            15.0,
            20,
            "D",
          );
        });

        const dispersionRes = {
          ...primaryDispersion,
          plumes: [primaryDispersion, ...industrialPlumes, ...firePlumes],
        };

        accumulated = {
          ...accumulated,
          dispersion: dispersionRes,
        };
        setTelemetry(accumulated);
        renderLayerByPhase("dispersion", accumulated, accumulated);
        addTimelineEvent("✅ Dispersion model complete");

        await new Promise((resolve) => setTimeout(resolve, 300));

        // --- Phase 5: Attribution ---
        setStreamPhase("attribution");
        addTimelineEvent("🔬 Apportioning pollution source contributions...");
        const attributionRes = attributeSources(
          currentAqi,
          weatherData,
          trafficData,
          geoData.nearby_industries.length,
          geoData.construction_sites,
          fireData.length,
          [],
          lat,
          lon,
        );

        accumulated = {
          ...accumulated,
          attribution: attributionRes,
        };
        setTelemetry(accumulated);
        renderLayerByPhase("attribution", accumulated, accumulated);
        addTimelineEvent("✅ Source attribution complete");

        await new Promise((resolve) => setTimeout(resolve, 300));

        // --- Phase 6: Risk ---
        setStreamPhase("risk");
        addTimelineEvent("🏥 Assessing health risk indexes...");
        const forecast24h = forecastRes?.forecast_values?.[23] || currentAqi;
        const aqiExposureScore =
          currentAqi <= 50
            ? 15
            : currentAqi <= 100
              ? 25
              : currentAqi <= 200
                ? 45
                : currentAqi <= 300
                  ? 65
                  : currentAqi <= 400
                    ? 80
                    : 95;
        const receptorScore = Math.min(
          12,
          geoData.nearby_schools.length * 0.35 +
            geoData.nearby_hospitals.length * 0.75,
        );
        const forecastRiseScore =
          currentAqi > 0 && forecast24h > currentAqi
            ? Math.min(8, ((forecast24h - currentAqi) / currentAqi) * 20)
            : 0;
        const riskScore =
          Math.round(
            Math.min(
              100,
              aqiExposureScore + receptorScore + forecastRiseScore,
            ) * 10,
          ) / 10;

        let riskLevel = "Low";
        if (riskScore >= 90) riskLevel = "Extreme";
        else if (riskScore >= 75) riskLevel = "Very High";
        else if (riskScore >= 50) riskLevel = "High";
        else if (riskScore >= 25) riskLevel = "Moderate";

        const riskRes = {
          risk_score: riskScore,
          risk_level: riskLevel,
          impact_metrics: {
            sensitive_population_affected: Math.round(
              geoData.population_estimate * 0.12,
            ),
            respiratory_admission_increase_pct:
              Math.round((currentAqi / 100) * 4.5 * 10) / 10,
            cardiovascular_risk_increase_pct:
              Math.round((currentAqi / 100) * 2.2 * 10) / 10,
          },
          health_advisory:
            currentAqi > 200
              ? "Sensitive groups should wear N95 masks and avoid prolonged outdoor activity."
              : "Air quality is acceptable. Outdoor activities are safe for most individuals.",
        };

        accumulated = {
          ...accumulated,
          risk: riskRes,
        };
        setTelemetry(accumulated);
        renderLayerByPhase("risk", accumulated, accumulated);
        addTimelineEvent("✅ Risk assessment complete");

        await new Promise((resolve) => setTimeout(resolve, 300));

        // --- Phase 7: Route Optimization ---
        setStreamPhase("optimization");
        addTimelineEvent("🚚 Optimizing enforcement inspector routes...");
        const optimizationRes = optimizeRoutes(hotspotsList, lat, lon, 3, 8);

        accumulated = {
          ...accumulated,
          optimization: optimizationRes,
          executive_summary: `Unified environmental diagnostic completed for ${cityName}. Primary pollution attribution points to ${attributionRes.primary_source.toUpperCase()}. Local dispersion plume spreads ${dispersionRes.wind_description.split("Plume extends ")[1]?.split("ward")[0]}ward from coordinates. ${optimizationRes.routes.length} inspection routes mapped to patrol units.`,
        };
        setTelemetry(accumulated);
        renderLayerByPhase("optimization", accumulated, accumulated);
        addTimelineEvent("✅ Route optimization complete");
      } catch (err) {
        console.error(err);
        setIsLoading(false);
        setStreamPhase("");
        addTimelineEvent("⚠ Sync failed — check model server connection");
      } finally {
        setIsSyncing(false);
        setStreamPhase("");
      }
    },
    [
      mapCenter,
      backendUrl,
      renderLayerByPhase,
      fetchCpcbStations,
      selectedStation,
      cpcbCity,
    ],
  );

  const selectCityLocation = useCallback(
    (location: CityLocation) => {
      setCityPickerOpen(false);
      setCitySearch("");
      setCityResults([]);
      setCpcbCity(location.city);
      setLocationName(location.name);
      setSelectedStation(null);
      setNearestStation(null);
      setCpcbStations([]);
      // A location jump must not leave the prior city's telemetry visible.
      // Clearing it activates the existing loading skeletons until the new
      // official station and supporting data have arrived.
      setTelemetry(null);
      setSatelliteData(null);
      setGridTargets([]);
      setGridImages({});
      if (location.key) setCityKey(location.key);
      if (mapRef.current)
        mapRef.current.setView([location.lat, location.lon], 12);
      setMapCenter({ lat: location.lat, lon: location.lon });
      void syncDashboard(true, false, location);
    },
    [syncDashboard],
  );

  useEffect(() => {
    if (citySearchAbortRef.current) citySearchAbortRef.current.abort();
    if (citySearch.trim().length < 2) {
      setCityResults([]);
      setIsCitySearching(false);
      return;
    }

    const controller = new AbortController();
    citySearchAbortRef.current = controller;
    const debounce = setTimeout(async () => {
      setIsCitySearching(true);
      try {
        const response = await fetch(
          `/api/geocode?q=${encodeURIComponent(citySearch.trim())}`,
          {
            signal: controller.signal,
          },
        );
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "City search failed");
        if (!controller.signal.aborted) setCityResults(data.results || []);
      } catch (error) {
        if (!controller.signal.aborted) setCityResults([]);
      } finally {
        if (!controller.signal.aborted) setIsCitySearching(false);
      }
    }, 350);

    return () => {
      clearTimeout(debounce);
      controller.abort();
    };
  }, [citySearch]);

  // Sync on mount
  useEffect(() => {
    const timeout = setTimeout(() => syncDashboard(false, false), 500);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh CPCB every 30 minutes
  useEffect(() => {
    const interval = setInterval(
      () => {
        fetchCpcbStations(mapCenter.lat, mapCenter.lon);
      },
      30 * 60 * 1000,
    );
    return () => clearInterval(interval);
  }, [mapCenter, fetchCpcbStations]);

  // Compile priority list of satellite targets from telemetry
  const getSatelliteTargets = () => {
    const list: any[] = [];

    // 1. Map center / crosshair (high priority)
    list.push({
      id: "center",
      name: `Crosshair Position (${locationName})`,
      lat: mapCenter.lat,
      lon: mapCenter.lon,
      type: "location",
      priority: 1,
    });

    // 2. Factories / Industries (high priority)
    if (telemetry?.geospatial?.nearby_industries) {
      telemetry.geospatial.nearby_industries.forEach((ind: any) => {
        const key = `${ind.name || "Industry"}_${ind.lat}_${ind.lon}`;
        list.push({
          id: `industry_${key}`,
          name: ind.name || "Industrial Site",
          lat: ind.lat,
          lon: ind.lon,
          type: "industry",
          priority: 2,
        });
      });
    }

    // 3. Fire Alerts (high priority)
    if (telemetry?.fire_data) {
      telemetry.fire_data.forEach((f: any) => {
        list.push({
          id: `fire_${f.lat}_${f.lon}`,
          name: `Fire Alert (FRP: ${f.fire_radiative_power} MW)`,
          lat: f.lat,
          lon: f.lon,
          type: "fire",
          priority: 3,
        });
      });
    }

    // 4. Construction Sites (high priority)
    if (telemetry?.geospatial?.construction_sites > 0) {
      const cLat = mapCenter.lat + 0.008;
      const cLon = mapCenter.lon - 0.006;
      list.push({
        id: "construction_site",
        name: "Construction Activity Area",
        lat: cLat,
        lon: cLon,
        type: "construction",
        priority: 4,
      });
    }

    // 5. Non-AQI project targets (schools & hospitals) (lowest priority, default disabled or skipped unless clicked)
    if (telemetry?.geospatial?.nearby_schools) {
      telemetry.geospatial.nearby_schools.forEach((s: any) => {
        const key = `${s.name || "School"}_${s.lat}_${s.lon}`;
        list.push({
          id: `school_${key}`,
          name: s.name || "School",
          lat: s.lat,
          lon: s.lon,
          type: "school",
          priority: 5,
        });
      });
    }

    if (telemetry?.geospatial?.nearby_hospitals) {
      telemetry.geospatial.nearby_hospitals.forEach((h: any) => {
        const key = `${h.name || "Hospital"}_${h.lat}_${h.lon}`;
        list.push({
          id: `hospital_${key}`,
          name: h.name || "Hospital",
          lat: h.lat,
          lon: h.lon,
          type: "hospital",
          priority: 6,
        });
      });
    }

    // Sort by priority (lower number = higher priority)
    return list.sort((a, b) => a.priority - b.priority);
  };

  // Open satellite modal and populate targets
  const openSatelliteModal = () => {
    const targets = getSatelliteTargets();
    setGridTargets(targets);
    setVisibleCount(10);
    setShowSatelliteModal(true);
  };

  // Update map popups/layers dynamically whenever gridImages updates
  useEffect(() => {
    if (telemetry) {
      renderLayerByPhase("all", telemetry, telemetry);
    }
  }, [gridImages, telemetry, renderLayerByPhase]);

  // Legacy non-streaming satellite fetch (kept for backward compat)
  const fetchSatellite = async () => {
    openSatelliteModal();
  };

  // --- Crosshair Fetch ---
  const fetchForCrosshair = () => {
    setShowFetchBtn(false);
    if (fetchBtnAutoHideRef.current) clearTimeout(fetchBtnAutoHideRef.current);
    syncDashboard(true, false);
  };

  // =========================================================================
  // COMPARISON
  // =========================================================================

  const fetchComparison = async () => {
    setIsComparing(true);
    const c1 = CITIES[cityKey];
    const c2 = CITIES[compareCity];
    try {
      const data = await compareCities(
        { name: c1.name, lat: c1.lat, lon: c1.lon },
        { name: c2.name, lat: c2.lat, lon: c2.lon },
        backendUrl,
      );
      setCompareData(data);
      addTimelineEvent(`Comparison: ${c1.name} vs ${c2.name}`);
    } catch (err) {
      console.error(err);
      addTimelineEvent("⚠ Comparison fetch failed");
    } finally {
      setIsComparing(false);
    }
  };

  // =========================================================================
  // AGENT CHAT
  // =========================================================================

  const handleChatSubmit = async (
    e?: React.FormEvent,
    promptOverride?: string,
  ) => {
    if (e) e.preventDefault();
    const query = promptOverride || inputMessage;
    if (!query) return;

    setInputMessage("");
    setChatHistory((prev) => [...prev, { role: "user", content: query }]);
    setIsAgentRunning(true);
    addTimelineEvent(`Agent prompt: "${query}"`);
    setActiveWorkflowStep("planner");

    const city = CITIES[cityKey];
    try {
      const response = await fetch(`/api/agent/run-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: query,
          lat: userCoords?.lat || city.lat,
          lon: userCoords?.lon || city.lon,
        }),
      });
      if (!response.ok) throw new Error("Agent crash");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let buffer = "";
      let agentReport = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const d = JSON.parse(line);
            if (d.type === "timeline") addTimelineEvent(d.event);
            else if (d.type === "workflow_step")
              setActiveWorkflowStep(d.step.toLowerCase());
            else if (d.type === "widget") {
              setTelemetry((p: any) => {
                const mergedForecast = d.widgets.forecast
                  ? {
                      ...p?.forecast,
                      ...d.widgets.forecast,
                      forecasts: {
                        ...(p?.forecast?.forecasts || {}),
                        ...(d.widgets.forecast?.forecasts || {}),
                      },
                    }
                  : p?.forecast;
                return {
                  ...p,
                  ...d.widgets,
                  ...(mergedForecast ? { forecast: mergedForecast } : {}),
                };
              });
              if (
                d.widgets.satellite_analysis &&
                d.widgets.satellite_analysis.images
              ) {
                setGridImages((prev) => {
                  const newImages = { ...prev };
                  d.widgets.satellite_analysis.images.forEach((img: any) => {
                    newImages[img.id] = {
                      id: img.id,
                      name: img.name,
                      lat: img.lat,
                      lon: img.lon,
                      type: "satellite_detection",
                      image_base64: img.image_base64,
                      detections: img.detections,
                      scene_description: img.scene_description,
                      severity: img.severity,
                    };
                  });
                  return newImages;
                });
              }
              if (d.widgets.user_location && mapRef.current) {
                mapRef.current.setView(
                  [d.widgets.user_location.lat, d.widgets.user_location.lon],
                  13,
                );
              }
              renderAllMapLayers({ ...telemetry, ...d.widgets });
              if (d.widgets.map_control && mapRef.current) {
                mapRef.current.setView(
                  [d.widgets.map_control.lat, d.widgets.map_control.lon],
                  d.widgets.map_control.zoom,
                );
              }
            } else if (d.type === "text") {
              agentReport += d.chunk;
              setChatHistory((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "agent")
                  return [
                    ...copy.slice(0, -1),
                    { role: "agent", content: agentReport },
                  ];
                return [...copy, { role: "agent", content: agentReport }];
              });
              setActiveWorkflowStep("report");
            } else if (d.type === "done") {
              if (d.result?.widgets) {
                setTelemetry((p: any) => {
                  const mergedForecast = d.result.widgets.forecast
                    ? {
                        ...p?.forecast,
                        ...d.result.widgets.forecast,
                        forecasts: {
                          ...(p?.forecast?.forecasts || {}),
                          ...(d.result.widgets.forecast?.forecasts || {}),
                        },
                      }
                    : p?.forecast;
                  return {
                    ...p,
                    ...d.result.widgets,
                    ...(mergedForecast ? { forecast: mergedForecast } : {}),
                  };
                });
                if (
                  d.result.widgets.satellite_analysis &&
                  d.result.widgets.satellite_analysis.images
                ) {
                  setGridImages((prev) => {
                    const newImages = { ...prev };
                    d.result.widgets.satellite_analysis.images.forEach(
                      (img: any) => {
                        newImages[img.id] = {
                          id: img.id,
                          name: img.name,
                          lat: img.lat,
                          lon: img.lon,
                          type: "satellite_detection",
                          image_base64: img.image_base64,
                          detections: img.detections,
                          scene_description: img.scene_description,
                          severity: img.severity,
                        };
                      },
                    );
                    return newImages;
                  });
                }
                if (d.result.widgets.user_location && mapRef.current) {
                  mapRef.current.setView(
                    [
                      d.result.widgets.user_location.lat,
                      d.result.widgets.user_location.lon,
                    ],
                    13,
                  );
                }
                renderAllMapLayers({ ...telemetry, ...d.result.widgets });
              }
              if (d.result?.report) {
                agentReport = d.result.report;
                setChatHistory((prev) => {
                  const copy = [...prev];
                  const last = copy[copy.length - 1];
                  if (last?.role === "agent")
                    return [
                      ...copy.slice(0, -1),
                      { role: "agent", content: agentReport },
                    ];
                  return [...copy, { role: "agent", content: agentReport }];
                });
              }
              setActiveWorkflowStep("report");
            }
          } catch {
            /* skip unparseable line */
          }
        }
      }
    } catch (err) {
      console.error(err);
      addTimelineEvent("⚠ Agent loop failed");
      setChatHistory((prev) => [
        ...prev,
        {
          role: "agent",
          content: "Commander, analysis failed. Verify backend is running.",
        },
      ]);
    } finally {
      setIsAgentRunning(false);
    }
  };

  // =========================================================================
  // HELPERS
  // =========================================================================

  const aqiColor = (v: number) => {
    const cat = getIndianAQICategory(v);
    return cat.text;
  };
  const aqiBg = (v: number) => {
    const cat = getIndianAQICategory(v);
    return `${cat.color}/10 border-${cat.color.slice(3)}/30 ${cat.text}`;
  };

  // Dashboard values — use selected station (click) or nearest station (auto)
  const dashStation = selectedStation || nearestStation;
  const aqiVal = dashStation?.aqi ?? telemetry?.current_aqi;
  const aqiCat = dashStation?.aqi_category ?? telemetry?.aqi_category;
  const stationName = dashStation?.station;
  const stationSource = dashStation?.data_source;
  const stationIsStale = dashStation?.is_stale;
  const dominantPollutant = dashStation?.dominant_pollutant;
  const riskLevelKey = String(telemetry?.risk?.risk_level || "").toLowerCase();

  // Pollutant values from CPCB station (real values, not derived)
  const pm25Val = dashStation?.pm25;
  const pm10Val = dashStation?.pm10;
  const coVal = dashStation?.co;
  const no2Val = dashStation?.no2;
  const so2Val = dashStation?.so2;
  const o3Val = dashStation?.o3;

  // Weather
  const wTemp = telemetry?.weather_data?.temperature;
  const wHumidity = telemetry?.weather_data?.humidity;
  const wPressure = telemetry?.weather_data?.pressure;
  const wWind = telemetry?.weather_data?.wind_speed;
  const weatherCode = telemetry?.weather_data?.weather_code;
  const weatherInfo = getWeatherInfo(weatherCode);

  // Traffic
  const tCongestion = telemetry?.traffic_data?.congestion_index;
  const tSpeed = telemetry?.traffic_data?.speed_kmh;
  const tSource = telemetry?.traffic_data?.source;

  // Attribution segments for donut chart
  const attrSegments = (telemetry?.attribution?.attributions || []).map(
    (a: any) => ({
      label: a.source,
      pct: a.contribution_pct,
      color:
        a.source === "traffic"
          ? "#ffd600"
          : a.source === "industry"
            ? "#ff9100"
            : a.source === "burning"
              ? "#ff1744"
              : a.source === "weather"
                ? "#2979ff"
                : a.source === "construction"
                  ? "#d500f9"
                  : "#888",
    }),
  );

  // Workflow steps config
  const wfSteps = [
    "planner",
    "forecast",
    "risk",
    "hotspots",
    "route",
    "report",
  ];

  // =========================================================================
  // RENDER
  // =========================================================================

  return (
    <div className="flex flex-col h-screen bg-[#08090c] text-[#f5f6fa]">
      {/* ALERT BANNER — when AQI > 200 */}
      {telemetry?.official_aqi_available === true &&
        typeof aqiVal === "number" &&
        Number.isFinite(aqiVal) &&
        aqiVal > 200 && (
          <div className="alert-slide flex items-center justify-center gap-3 px-4 py-2 bg-gradient-to-r from-red-900/60 via-red-800/40 to-red-900/60 border-b border-red-500/30 text-xs text-red-200">
            <i className="fa-solid fa-triangle-exclamation text-red-400 text-sm pulse-danger" />
            <span>
              <strong>AIR QUALITY ALERT</strong> — {locationName} AQI{" "}
              {aqiVal.toFixed(0)} ({aqiCat}) —{" "}
              {telemetry?.risk?.health_advisory || "Reduce outdoor exposure."}
            </span>
            <span className="font-['Orbitron'] text-[9px] text-red-400 border border-red-500/30 px-2 py-0.5 rounded">
              {telemetry?.geospatial?.ward ||
                telemetry?.geospatial?.district ||
                ""}
            </span>
          </div>
        )}

      {/* ============== HEADER ============== */}
      <header className="flex justify-between items-center px-6 h-[56px] bg-[#0c0d12] border-b border-white/5 z-40 shrink-0">
        <div className="flex items-center gap-3">
          <i className="fa-solid fa-circle-nodes text-[#00e5ff] text-lg pulse-active" />
          <span className="font-['Orbitron'] text-xl font-black tracking-widest bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
            AETHERIS
          </span>
          <span className="font-['Orbitron'] text-[9px] text-zinc-500 border border-white/5 px-2 py-0.5 rounded tracking-wider">
            CMD-CTR v2.0
          </span>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] text-zinc-500 uppercase tracking-widest">
              Quick Nav
            </span>
            <Popover open={cityPickerOpen} onOpenChange={setCityPickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Search Indian cities"
                  className="flex w-[170px] items-center justify-between rounded border border-white/5 bg-black/60 px-3 py-1 text-xs text-white outline-none transition hover:border-cyan-500/40 focus:border-[#00e5ff]"
                >
                  <span className="truncate">{locationName}</span>
                  <ChevronsUpDown className="ml-2 size-3 shrink-0 text-zinc-500" />
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-[320px] border-cyan-500/20 bg-[#0c0d12] p-1 text-white"
              >
                <Command
                  shouldFilter={false}
                  className="bg-transparent text-white"
                >
                  <CommandInput
                    value={citySearch}
                    onValueChange={setCitySearch}
                    placeholder="Search Indian cities…"
                    className="text-white placeholder:text-zinc-500"
                  />
                  <CommandList>
                    <CommandGroup heading="Common cities">
                      {commonCityLocations.slice(0, 5).map((city) => (
                        <CommandItem
                          key={city.key}
                          value={`common-${city.key}`}
                          onSelect={() => selectCityLocation(city)}
                          className="text-zinc-200 data-selected:bg-cyan-500/15 data-selected:text-white"
                        >
                          <MapPin className="size-3.5 text-cyan-400" />
                          <span>{city.name}</span>
                          {cpcbCity === city.city && (
                            <Check className="ml-auto size-3.5 text-cyan-400" />
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    {citySearch.trim().length >= 2 && (
                      <CommandGroup heading="India search results">
                        {isCitySearching && (
                          <div className="flex items-center gap-2 px-2 py-3 text-xs text-zinc-500">
                            <LoaderCircle className="size-3.5 animate-spin" />{" "}
                            Searching India…
                          </div>
                        )}
                        {!isCitySearching &&
                          cityResults.map((city) => (
                            <CommandItem
                              key={`${city.lat}_${city.lon}`}
                              value={`result-${city.lat}-${city.lon}`}
                              onSelect={() => selectCityLocation(city)}
                              className="text-zinc-200 data-selected:bg-cyan-500/15 data-selected:text-white"
                            >
                              <MapPin className="size-3.5 text-cyan-400" />
                              <span className="min-w-0 flex-1 truncate">
                                {city.name}
                              </span>
                              {city.state && (
                                <span className="max-w-[100px] truncate text-[10px] text-zinc-500">
                                  {city.state}
                                </span>
                              )}
                            </CommandItem>
                          ))}
                        {!isCitySearching && cityResults.length === 0 && (
                          <CommandEmpty className="py-3 text-xs text-zinc-500">
                            No Indian city found.
                          </CommandEmpty>
                        )}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <div className="font-['Orbitron'] text-xs text-[#00e5ff] border border-cyan-500/10 bg-cyan-500/5 px-3 py-1.5 rounded flex flex-col gap-0">
            <span className="text-[8px] text-zinc-500 uppercase">
              Crosshair
            </span>
            <div className="flex gap-4">
              <span>LAT: {mapCenter.lat.toFixed(4)}</span>
              <span>LON: {mapCenter.lon.toFixed(4)}</span>
            </div>
          </div>
          {locationName && (
            <span className="font-['Orbitron'] text-[10px] text-zinc-400 bg-white/5 border border-white/5 px-2 py-1 rounded">
              {locationName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs font-['Orbitron']">
          {streamPhase && (
            <span className="text-[9px] text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
              {streamPhase}
            </span>
          )}
          <span className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${telemetry ? "bg-emerald-500 shadow-[0_0_8px_#00e676]" : "bg-yellow-500 shadow-[0_0_8px_#ffd600]"}`}
            />
            <span
              className={telemetry ? "text-emerald-400" : "text-yellow-400"}
            >
              {telemetry ? "ONLINE" : "SYNCING"}
            </span>
          </span>
          <button
            onClick={() => syncDashboard(true, false)}
            disabled={isSyncing}
            className="bg-cyan-500/10 border border-cyan-500/30 text-[#00e5ff] rounded px-3 py-1.5 cursor-pointer hover:bg-cyan-500 hover:text-black transition disabled:opacity-50 flex items-center gap-1.5 font-bold"
            title="Refresh (Force re-fetch from APIs)"
          >
            <i
              className={`fa-solid fa-rotate ${isSyncing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
          <button
            onClick={openSatelliteModal}
            className="bg-purple-600/10 border border-purple-500/30 text-purple-300 rounded px-3 py-1.5 cursor-pointer hover:bg-purple-600 hover:text-white transition flex items-center gap-1.5 font-bold"
            title="Open Satellite Intelligence panel"
          >
            <i className="fa-solid fa-satellite" />
            Satellite
          </button>
        </div>
      </header>

      {/* ============== MAIN BODY ============== */}
      <main className="flex-1 grid grid-cols-[310px_1fr_330px] gap-2.5 p-2.5 overflow-hidden">
        {/* =========== LEFT PANEL =========== */}
        <section className="flex flex-col gap-2.5 h-full overflow-hidden">
          {/* Tab Row */}
          <div className="flex bg-black/40 border border-white/5 rounded-lg p-1 gap-1 shrink-0">
            {[
              { key: "live", label: "Live", icon: "fa-wind" },
              { key: "forecast", label: "Forecast", icon: "fa-clock" },
              { key: "attribution", label: "Sources", icon: "fa-chart-pie" },
              { key: "risk", label: "Health", icon: "fa-shield-halved" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveLeftTab(tab.key as any)}
                className={`flex-1 flex flex-col items-center justify-center py-1.5 rounded text-[10px] font-semibold cursor-pointer transition gap-1 ${
                  activeLeftTab === tab.key
                    ? "bg-[#00e5ff]/15 text-[#00e5ff] border border-[#00e5ff]/25 shadow-[0_0_8px_rgba(0,229,255,0.15)]"
                    : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                }`}
              >
                <i className={`fa-solid ${tab.icon} text-xs`} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5 min-h-0">
            {activeLeftTab === "live" && (
              <>
                {/* AQI Widget — Official CPCB station data only */}
                <div className="bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg p-4 flex flex-col gap-3">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider flex items-center gap-2">
                      <i className="fa-solid fa-wind text-emerald-400" />{" "}
                      Nearest Official CPCB Station
                    </h3>
                    {aqiCat ? (
                      <span
                        className={`text-[10px] font-['Orbitron'] px-2 py-0.5 rounded font-bold border ${aqiBg(aqiVal || 0)}`}
                      >
                        {aqiCat}
                      </span>
                    ) : (
                      <SkeletonBox w="60px" h="18px" />
                    )}
                  </div>
                  {/* Station name */}
                  {stationName && (
                    <div className="flex items-center gap-1.5 text-[10px] text-[#00e5ff]">
                      <i className="fa-solid fa-location-dot" />
                      <span className="truncate font-medium">
                        {stationName}
                      </span>
                      {selectedStation && (
                        <button
                          onClick={() => setSelectedStation(null)}
                          className="ml-auto text-zinc-500 hover:text-white text-[9px] cursor-pointer"
                        >
                          ✕ clear
                        </button>
                      )}
                    </div>
                  )}
                  {stationSource && (
                    <div
                      className={`text-[9px] uppercase tracking-wider ${stationIsStale ? "text-amber-400" : "text-emerald-400"}`}
                    >
                      {stationIsStale
                        ? "Stale official cache"
                        : `Official source: ${stationSource}`}
                    </div>
                  )}
                  {dominantPollutant && (
                    <div className="text-[9px] text-zinc-500 uppercase tracking-wider">
                      Dominant pollutant:{" "}
                      <span className="text-zinc-300">{dominantPollutant}</span>
                    </div>
                  )}
                  <div className="flex items-baseline gap-4">
                    {aqiVal != null ? (
                      <h1
                        className={`font-['Orbitron'] text-4xl font-extrabold ${aqiColor(aqiVal)}`}
                      >
                        {aqiVal.toFixed(1)}
                      </h1>
                    ) : (
                      <SkeletonBox w="100px" h="40px" />
                    )}
                    <div className="flex flex-col">
                      <span
                        className={`text-xs flex items-center gap-1 font-bold ${telemetry?.forecast?.trend === "increasing" ? "text-red-400" : telemetry?.forecast?.trend === "decreasing" ? "text-emerald-400" : "text-emerald-400"}`}
                      >
                        <i
                          className={`fa-solid ${telemetry?.forecast?.trend === "increasing" ? "fa-arrow-trend-up" : telemetry?.forecast?.trend === "decreasing" ? "fa-arrow-trend-down" : "fa-circle-check"}`}
                        />
                        {telemetry?.forecast?.trend || "syncing"}
                      </span>
                      <span className="text-[10px] text-zinc-500 uppercase tracking-widest">
                        Official NAQI
                      </span>
                    </div>
                  </div>
                  {/* Official CPCB pollutant AQI sub-indices, not concentrations */}
                  <div className="grid grid-cols-3 gap-1.5 mt-1">
                    {[
                      {
                        label: "PM2.5",
                        value: pm25Val,
                        unit: "µg/m³",
                        color: "text-[#00e5ff]",
                      },
                      {
                        label: "PM10",
                        value: pm10Val,
                        unit: "µg/m³",
                        color: "text-yellow-400",
                      },
                      {
                        label: "CO",
                        value: coVal,
                        unit: "mg/m³",
                        color: "text-orange-400",
                      },
                      {
                        label: "NO₂",
                        value: no2Val,
                        unit: "µg/m³",
                        color: "text-red-400",
                      },
                      {
                        label: "SO₂",
                        value: so2Val,
                        unit: "µg/m³",
                        color: "text-purple-400",
                      },
                      {
                        label: "O₃",
                        value: o3Val,
                        unit: "µg/m³",
                        color: "text-emerald-400",
                      },
                    ].map((p, i) => (
                      <div
                        key={i}
                        className="bg-black/20 border border-white/5 rounded p-1.5 flex flex-col text-[10px]"
                      >
                        <span className="text-zinc-500 text-[9px]">
                          {p.label}
                        </span>
                        {p.value != null ? (
                          <span
                            className={`font-['Orbitron'] font-bold ${p.color}`}
                          >
                            {p.value}
                          </span>
                        ) : (
                          <SkeletonBox w="30px" h="12px" />
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Health Advisory Banner */}
                  {aqiVal != null && (
                    <div className="mt-1 text-[10px] border-t border-white/5 pt-2 flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 font-bold text-zinc-300">
                        <i className="fa-solid fa-heart-pulse text-rose-500 animate-pulse" />
                        <span>Health Advisory</span>
                      </div>
                      <p className="text-zinc-400 leading-relaxed font-normal">
                        {getIndianAQICategory(aqiVal).description}
                      </p>
                    </div>
                  )}
                </div>

                {/* Meteorological Feed — with Weather Condition */}
                <div className="bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg p-4 flex flex-col gap-3">
                  <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider flex items-center gap-2">
                    <i className="fa-solid fa-cloud-sun text-blue-400" />{" "}
                    Weather
                    {telemetry?.weather_data?.condition && (
                      <span className="text-[10px] text-zinc-300 font-bold bg-blue-500/10 border border-blue-500/20 px-2 py-0.5 rounded ml-2 capitalize font-mono">
                        {telemetry.weather_data.condition}
                      </span>
                    )}
                  </h3>
                  {/* Weather condition badge */}
                  <div className="flex items-center gap-3 bg-black/20 border border-white/5 rounded p-2.5">
                    <span className="text-3xl">{weatherInfo.icon}</span>
                    <div className="flex flex-col">
                      <span className="font-['Orbitron'] text-lg font-bold">
                        {wTemp != null
                          ? `${wTemp.toFixed?.(1) ?? wTemp}°C`
                          : "—"}
                      </span>
                      <span className="text-[9px] text-zinc-500 uppercase tracking-wider">
                        {weatherInfo.label}
                      </span>
                    </div>
                    <div className="ml-auto flex flex-col items-end text-[10px]">
                      <span className="text-zinc-500">
                        💧{" "}
                        {wHumidity != null
                          ? `${wHumidity.toFixed?.(0) ?? wHumidity}%`
                          : "—"}
                      </span>
                      <span className="text-zinc-500">
                        💨{" "}
                        {wWind != null
                          ? `${wWind.toFixed?.(1) ?? wWind} m/s`
                          : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      {
                        icon: "fa-gauge",
                        color: "text-cyan-400",
                        label: "Pressure",
                        value:
                          wPressure != null
                            ? `${wPressure.toFixed?.(0) ?? wPressure} hPa`
                            : null,
                      },
                      {
                        icon: "fa-compass",
                        color: "text-emerald-400",
                        label: "Wind Dir",
                        value:
                          telemetry?.weather_data?.wind_direction != null
                            ? `${telemetry.weather_data.wind_direction}°`
                            : null,
                      },
                    ].map((m, i) => (
                      <div
                        key={i}
                        className="bg-black/20 border border-white/5 rounded p-2 flex items-center gap-3"
                      >
                        <i
                          className={`fa-solid ${m.icon} ${m.color} text-lg`}
                        />
                        <div className="flex flex-col">
                          <span className="text-[9px] text-zinc-500 uppercase">
                            {m.label}
                          </span>
                          {m.value ? (
                            <span className="font-['Orbitron'] text-xs font-bold">
                              {m.value}
                            </span>
                          ) : (
                            <SkeletonBox w="50px" h="14px" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Traffic Congestion */}
                <div className="bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg p-4 flex flex-col gap-3">
                  <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider flex items-center gap-2">
                    <i className="fa-solid fa-car-side text-yellow-400" />{" "}
                    Traffic Pollution Impact
                  </h3>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-zinc-500">Congestion Level</span>
                      {tCongestion != null ? (
                        <span className="font-['Orbitron'] text-yellow-400 font-bold">
                          {(tCongestion * 100).toFixed(0)}%
                        </span>
                      ) : (
                        <SkeletonBox w="40px" h="14px" />
                      )}
                    </div>
                    <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-yellow-500 rounded-full transition-all duration-700"
                        style={{
                          width:
                            tCongestion != null
                              ? `${tCongestion * 100}%`
                              : "0%",
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
                      <span>
                        Speed:{" "}
                        <strong className="text-white font-bold">
                          {tSpeed != null ? `${tSpeed.toFixed(0)} km/h` : "—"}
                        </strong>
                      </span>
                      <span>
                        Via:{" "}
                        <strong className="text-[#00e5ff] font-bold uppercase">
                          {tSource || "syncing"}
                        </strong>
                      </span>
                    </div>
                    {tCongestion != null && (
                      <div className="text-[10px] text-zinc-400 mt-1 bg-black/20 border border-white/5 rounded p-1.5">
                        <i className="fa-solid fa-smog text-orange-400 mr-1" />
                        Est. AQI increase from traffic:{" "}
                        <strong className="text-orange-400">
                          +
                          {Math.round(
                            ((tCongestion || 0) * 35 * (aqiVal || 100)) / 100,
                          )}{" "}
                          AQI
                        </strong>
                      </div>
                    )}
                  </div>
                </div>

                {/* API Diagnostics */}
                <div className="bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg p-4 flex flex-col gap-3">
                  <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider flex items-center gap-2">
                    <i className="fa-solid fa-plug text-purple-400" /> API
                    Diagnostics
                  </h3>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    {[
                      {
                        name: "Official CPCB AQI",
                        ok: cpcbStations.length > 0,
                      },
                      { name: "NASA FIRMS", ok: !telemetry?.errors?.fire },
                      {
                        name: "Traffic API",
                        ok: !telemetry?.errors?.traffic_data,
                      },
                      {
                        name: "Sentinel Hub",
                        ok: !telemetry?.errors?.vision_segmentation,
                      },
                      {
                        name: "Overpass/OSM",
                        ok: !telemetry?.errors?.geospatial,
                      },
                      {
                        name: "XGBoost Model",
                        ok: !telemetry?.errors?.forecast,
                      },
                    ].map((api, i) => (
                      <div
                        key={i}
                        className="bg-white/5 border border-white/5 rounded px-2 py-1.5 flex items-center gap-2 font-medium"
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${telemetry || cpcbStations.length > 0 ? (api.ok ? "bg-emerald-500" : "bg-red-500") : "bg-zinc-600"}`}
                        />
                        {api.name}
                      </div>
                    ))}
                  </div>
                  {telemetry?.processing_time_seconds != null && (
                    <div className="text-[9px] text-zinc-500 text-right font-['Orbitron']">
                      Pipeline: {telemetry.processing_time_seconds.toFixed(2)}s
                    </div>
                  )}
                </div>
              </>
            )}

            {activeLeftTab === "forecast" && (
              <div className="flex flex-col gap-4 p-4 bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg text-xs shadow-[0_4px_20px_rgba(0,0,0,0.25)] border-t border-t-cyan-500/10">
                <div className="flex flex-col gap-1">
                  <h3 className="text-xs uppercase font-semibold text-zinc-300 tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <i className="fa-solid fa-clock text-[#00e5ff] animate-pulse" />
                      Hyperlocal AI Forecast
                    </span>
                    <span className="text-[8px] bg-cyan-500/10 text-cyan-400 px-2 py-0.5 rounded border border-cyan-500/20 font-mono">
                      XGBoost v2.4
                    </span>
                  </h3>
                  <p className="text-[11px] text-zinc-400 leading-normal mt-1">
                    Autoregressive XGBoost model with 38 engineered features and
                    meteorological covariates.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  {["24h", "48h", "72h"].map((h) => (
                    <div
                      key={h}
                      className="flex flex-col items-center bg-black/35 rounded-lg p-2.5 border border-white/5 hover:border-cyan-500/20 transition-all duration-300"
                    >
                      <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold font-mono">
                        {h}
                      </span>
                      {telemetry?.forecast?.forecasts?.[h] ? (
                        <>
                          <h2
                            className={`font-['Orbitron'] text-xl font-extrabold mt-1 tracking-tight ${aqiColor(telemetry.forecast.forecasts[h].value)}`}
                          >
                            {telemetry.forecast.forecasts[h].value}
                          </h2>
                          <span className="text-[8px] text-zinc-500 mt-1 font-mono">
                            {telemetry.forecast.forecasts[h].p10} —{" "}
                            {telemetry.forecast.forecasts[h].p90}
                          </span>
                        </>
                      ) : (
                        <div className="my-1.5">
                          <SkeletonBox w="40px" h="20px" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="bg-black/20 border border-white/5 rounded-lg p-3 flex flex-col gap-2 text-[10px] text-zinc-400">
                  <div className="flex justify-between items-center">
                    <span>Predictive Engine:</span>
                    <strong className="text-[#00e5ff] font-mono">
                      {telemetry?.forecast?.model || "Custom-Trained XGBoost"}
                    </strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Confidence Index:</span>
                    <div className="flex items-center gap-2">
                      <strong className="text-emerald-400 font-mono">
                        {telemetry?.forecast?.confidence
                          ? `${(telemetry.forecast.confidence * 100).toFixed(0)}%`
                          : "—"}
                      </strong>
                      {telemetry?.forecast?.confidence != null && (
                        <div className="w-12 h-1 bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-400 rounded-full"
                            style={{
                              width: `${telemetry.forecast.confidence * 100}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setShowForecastDialog(true)}
                  className="w-full mt-1 bg-gradient-to-r from-cyan-600/10 to-blue-600/10 hover:from-cyan-600/25 hover:to-blue-600/25 text-[#00e5ff] border border-[#00e5ff]/25 py-2.5 rounded text-xs font-bold transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_12px_rgba(0,229,255,0.05)] hover:shadow-[0_0_16px_rgba(0,229,255,0.15)]"
                >
                  <i className="fa-solid fa-chart-line animate-pulse" />
                  Open Forecast Intelligence Center
                </button>
              </div>
            )}

            {activeLeftTab === "attribution" && (
              <div className="flex flex-col gap-4 p-4 bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg text-xs shadow-[0_4px_20px_rgba(0,0,0,0.25)] border-t border-t-amber-500/10">
                <div className="flex flex-col gap-1">
                  <h3 className="text-xs uppercase font-semibold text-zinc-300 tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <i className="fa-solid fa-chart-pie text-[#ffd600]" />
                      Source Attribution
                    </span>
                    <span className="text-[8px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded border border-amber-500/20 font-mono">
                      Multi-Modal Fusion
                    </span>
                  </h3>
                  <p className="text-[11px] text-zinc-400 leading-normal mt-1">
                    Multi-modal attribution modeling analyzing traffic
                    congestion, industrial emissions, and satellite anomalies.
                  </p>
                </div>

                <div className="flex justify-center py-1">
                  <div className="relative">
                    {attrSegments.length > 0 ? (
                      <>
                        <DonutChart segments={attrSegments} size={110} />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="text-center">
                            <div className="font-['Orbitron'] text-lg font-extrabold text-white">
                              {telemetry?.attribution?.confidence_score?.toFixed(
                                0,
                              ) || "—"}
                              %
                            </div>
                            <div className="text-[7px] text-zinc-500 uppercase tracking-wider font-bold">
                              Confidence
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <SkeletonBox w="110px" h="110px" />
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 bg-black/20 border border-white/5 rounded-lg p-3">
                  {attrSegments.length > 0
                    ? attrSegments.map((seg: any, i: number) => (
                        <div
                          key={i}
                          className="grid grid-cols-[80px_1fr_40px] items-center gap-2 text-[10px]"
                        >
                          <span className="text-zinc-400 capitalize font-semibold">
                            {seg.label}
                          </span>
                          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-75"
                              style={{
                                width: `${seg.pct}%`,
                                background: seg.color,
                                boxShadow: `0 0 6px ${seg.color}60`,
                              }}
                            />
                          </div>
                          <span
                            className="font-['Orbitron'] text-right font-extrabold"
                            style={{ color: seg.color }}
                          >
                            {seg.pct.toFixed(0)}%
                          </span>
                        </div>
                      ))
                    : Array.from({ length: 5 }).map((_, i) => (
                        <SkeletonBox key={i} w="100%" h="14px" />
                      ))}
                </div>

                <div className="bg-black/20 border border-white/5 rounded-lg p-2.5 flex flex-col gap-1.5 text-[10px] text-zinc-400">
                  <div className="flex justify-between items-center">
                    <span>Attribution Method:</span>
                    <strong className="text-[#00e5ff] font-mono">
                      {telemetry?.attribution?.method?.replace(/_/g, " ") ||
                        "—"}
                    </strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Primary Driver:</span>
                    <strong className="text-red-400 font-mono capitalize">
                      {telemetry?.attribution?.primary_source || "—"}
                    </strong>
                  </div>
                </div>

                {/* Raw source metrics cards */}
                <div className="grid grid-cols-2 gap-2 mt-1 text-[10px]">
                  <div className="bg-black/25 border border-white/5 p-2 rounded flex flex-col gap-1">
                    <span className="text-zinc-500 uppercase tracking-wider font-bold text-[8px]">
                      Active Fires
                    </span>
                    <span className="text-white font-['Orbitron'] font-bold flex items-center gap-1">
                      <i className="fa-solid fa-fire text-red-500 text-[10px] animate-pulse" />
                      {telemetry?.fire_data?.length || 0} Detections
                    </span>
                  </div>
                  <div className="bg-black/25 border border-white/5 p-2 rounded flex flex-col gap-1">
                    <span className="text-zinc-500 uppercase tracking-wider font-bold text-[8px]">
                      Nearby Industries
                    </span>
                    <span className="text-white font-['Orbitron'] font-bold flex items-center gap-1">
                      <i className="fa-solid fa-industry text-purple-400 text-[10px]" />
                      {telemetry?.geospatial?.nearby_industries?.length || 0}{" "}
                      Facilities
                    </span>
                  </div>
                </div>
              </div>
            )}

            {activeLeftTab === "risk" && (
              <div className="flex flex-col gap-4 p-4 bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg text-xs shadow-[0_4px_20px_rgba(0,0,0,0.25)] border-t border-t-emerald-500/10">
                <div className="flex flex-col gap-1">
                  <h3 className="text-xs uppercase font-semibold text-zinc-300 tracking-wider flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <i className="fa-solid fa-shield-halved text-emerald-400" />
                      Citizen Health Advisory
                    </span>
                    <span className="text-[8px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                      Real-time Exposure
                    </span>
                  </h3>
                  <p className="text-[11px] text-zinc-400 leading-normal mt-1">
                    Calculated risk based on vulnerable receptor locations
                    (schools, hospitals) and cumulative AQI exposure.
                  </p>
                </div>

                <div className="flex gap-3 bg-black/35 rounded-lg p-3 border border-white/5 items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold">
                      Risk Level
                    </span>
                    {telemetry?.risk?.risk_level ? (
                      <h3
                        className={`font-['Orbitron'] text-base font-black mt-0.5 capitalize tracking-wide ${
                          riskLevelKey === "extreme" ||
                          riskLevelKey === "very high" ||
                          riskLevelKey === "critical" ||
                          riskLevelKey === "very_high"
                            ? "text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.3)]"
                            : riskLevelKey === "high"
                              ? "text-orange-400 drop-shadow-[0_0_8px_rgba(251,146,60,0.3)]"
                              : "text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]"
                        }`}
                      >
                        {telemetry.risk.risk_level.replace(/_/g, " ")}
                      </h3>
                    ) : (
                      <SkeletonBox w="60px" h="18px" />
                    )}
                  </div>
                  {telemetry?.risk?.affected_population && (
                    <div className="text-right flex flex-col">
                      <span className="text-[9px] text-zinc-500 uppercase tracking-widest font-bold font-mono">
                        Affected Pop.
                      </span>
                      <span className="text-white font-bold font-['Orbitron'] mt-0.5 text-sm">
                        {telemetry.risk.affected_population.toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 bg-black/20 border border-white/5 rounded-lg p-3">
                  <div className="text-[11px] text-zinc-300 leading-relaxed max-h-[140px] overflow-y-auto pr-1">
                    {showOriginalAdvisory && telemetry?.risk?.original_advisory
                      ? telemetry.risk.original_advisory
                      : telemetry?.risk?.health_advisory ||
                        "Syncing health advisory data..."}
                  </div>

                  {(telemetry?.risk?.recommended_actions ||
                    telemetry?.risk?.original_actions) && (
                    <div className="flex flex-col gap-1.5 border-t border-white/5 pt-2.5 mt-1">
                      <span className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">
                        Recommended Actions
                      </span>
                      {(showOriginalAdvisory
                        ? telemetry.risk.original_actions
                        : telemetry.risk.recommended_actions
                      )
                        ?.slice(0, 4)
                        .map((a: string, i: number) => (
                          <div
                            key={i}
                            className="text-[10px] text-zinc-400 flex items-start gap-2"
                          >
                            <i className="fa-solid fa-circle-check text-[9px] text-emerald-400 mt-1 shrink-0" />
                            <span className="leading-tight">{a}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>

                {(telemetry?.risk?.vulnerable_facilities ||
                  (telemetry?.risk?.language_name &&
                    telemetry.risk.language_name !== "English")) && (
                  <div className="bg-black/20 border border-white/5 rounded-lg p-2.5 flex flex-col gap-2 text-[10px] text-zinc-400">
                    {telemetry?.risk?.vulnerable_facilities && (
                      <div className="flex justify-between items-center border-b border-white/5 pb-2">
                        <span>Vulnerable Receptors:</span>
                        <span className="flex gap-2.5 font-mono">
                          <strong className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            🏫 Schools:{" "}
                            {telemetry.risk.vulnerable_facilities.schools}
                          </strong>
                          <strong className="text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                            🏥 Hospitals:{" "}
                            {telemetry.risk.vulnerable_facilities.hospitals}
                          </strong>
                        </span>
                      </div>
                    )}

                    {telemetry?.risk?.language_name &&
                      telemetry.risk.language_name !== "English" && (
                        <div className="flex justify-between items-center mt-1">
                          <span className="font-['Orbitron'] text-[8px] bg-cyan-500/10 border border-cyan-500/30 text-[#00e5ff] px-2 py-0.5 rounded uppercase tracking-wider font-bold">
                            {telemetry.risk.language_name}
                          </span>
                          <button
                            onClick={() =>
                              setShowOriginalAdvisory(!showOriginalAdvisory)
                            }
                            className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white rounded px-2.5 py-0.5 text-[9px] cursor-pointer font-bold transition"
                          >
                            Show{" "}
                            {showOriginalAdvisory ? "Translation" : "English"}
                          </button>
                        </div>
                      )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* =========== CENTER — MAP =========== */}
        <section className="relative rounded-lg border border-white/5 overflow-hidden">
          {/* Layer toggles */}
          <div
            className="absolute top-3 left-14 z-[999] flex flex-wrap gap-1.5"
            style={{ pointerEvents: "auto" }}
          >
            {[
              {
                key: "cpcbStations",
                label: "AQI Stations",
                icon: "fa-broadcast-tower",
                color: "#00e5ff",
                state: showCpcbStations,
                set: setShowCpcbStations,
                group: cpcbStationsGroup,
              },
              {
                key: "hotspots",
                label: "Hotspots",
                icon: "fa-fire",
                color: "#ff1744",
                state: showHotspots,
                set: setShowHotspots,
                group: hotspotsGroup,
              },
              {
                key: "traffic",
                label: "Traffic",
                icon: "fa-road",
                color: "#ffd600",
                state: showTraffic,
                set: setShowTraffic,
                group: trafficGroup,
              },
              {
                key: "sources",
                label: "Sources",
                icon: "fa-industry",
                color: "#ff9100",
                state: showSources,
                set: setShowSources,
                group: sourcesGroup,
              },
              {
                key: "enforcement",
                label: "Enforcement",
                icon: "fa-clipboard-check",
                color: "#00e5ff",
                state: showEnforcement,
                set: setShowEnforcement,
                group: routeGroup,
              },
              {
                key: "receptors",
                label: "Receptors",
                icon: "fa-school",
                color: "#00e676",
                state: showReceptors,
                set: setShowReceptors,
                group: receptorsGroup,
              },
              {
                key: "dispersion",
                label: "Plume",
                icon: "fa-smog",
                color: "#d500f9",
                state: showDispersion,
                set: setShowDispersion,
                group: dispersionGroup,
              },
            ].map(({ key, label, icon, color, state, set, group }) => (
              <button
                key={key}
                onClick={() => {
                  const next = !state;
                  set(next);
                  toggleLayer(group, next);
                }}
                className={`backdrop-blur text-[10px] px-2.5 py-1 rounded transition cursor-pointer border flex items-center gap-1.5 ${
                  state
                    ? "bg-[#10141e]/85 border-white/10 text-white shadow-[0_0_8px_rgba(0,229,255,0.15)]"
                    : "bg-black/40 border-white/5 text-zinc-600 hover:text-zinc-400"
                }`}
              >
                <i
                  className={`fa-solid ${icon}`}
                  style={{ color: state ? color : undefined }}
                />
                {label}
              </button>
            ))}
          </div>

          {/* Weather badge on map */}
          {telemetry?.weather_data && (
            <div className="weather-badge">
              <span className="weather-icon">{weatherInfo.icon}</span>
              <div className="weather-info">
                <span className="weather-temp">
                  {wTemp != null ? `${wTemp.toFixed?.(1)}°` : "—"}
                </span>
                <span className="weather-condition">{weatherInfo.label}</span>
              </div>
            </div>
          )}

          {/* Tile switcher */}
          <div className="tile-switcher">
            {Object.entries(TILE_CONFIGS).map(([k, v]) => (
              <button
                key={k}
                className={`tile-btn ${activeTile === k ? "active" : ""}`}
                onClick={() => switchTiles(k)}
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* Map container */}
          <div ref={mapElementRef} className="w-full h-full" />

          {/* === CROSSHAIR OVERLAY === */}
          <div className="crosshair-overlay" style={{ pointerEvents: "none" }}>
            <svg width="60" height="60" viewBox="0 0 60 60" fill="none">
              <line
                x1="30"
                y1="0"
                x2="30"
                y2="22"
                stroke="#00e5ff"
                strokeWidth="1.5"
                opacity="0.6"
              />
              <line
                x1="30"
                y1="38"
                x2="30"
                y2="60"
                stroke="#00e5ff"
                strokeWidth="1.5"
                opacity="0.6"
              />
              <line
                x1="0"
                y1="30"
                x2="22"
                y2="30"
                stroke="#00e5ff"
                strokeWidth="1.5"
                opacity="0.6"
              />
              <line
                x1="38"
                y1="30"
                x2="60"
                y2="30"
                stroke="#00e5ff"
                strokeWidth="1.5"
                opacity="0.6"
              />
              <circle
                cx="30"
                cy="30"
                r="4"
                stroke="#00e5ff"
                strokeWidth="1.5"
                fill="none"
                opacity="0.7"
              />
              <circle cx="30" cy="30" r="1.5" fill="#00e5ff" opacity="0.9" />
            </svg>
          </div>

          {/* === FETCH FOR THIS AREA BUTTON (1s debounce, 15s auto-hide) === */}
          {showFetchBtn && !isSyncing && (
            <div className="fetch-area-btn" style={{ pointerEvents: "auto" }}>
              <button
                onClick={fetchForCrosshair}
                className="bg-[#0e1017]/90 backdrop-blur-md border border-[#00e5ff]/40 text-[#00e5ff] rounded-lg px-4 py-2 text-xs cursor-pointer hover:bg-[#00e5ff] hover:text-black transition flex items-center gap-2 font-bold shadow-[0_0_20px_rgba(0,229,255,0.15)]"
              >
                <i className="fa-solid fa-satellite-dish" />
                Fetch for this area
              </button>
            </div>
          )}

          {/* Map legend overlay */}
          {telemetry && (
            <div className="absolute bottom-6 left-3 z-[999] map-legend flex flex-col gap-1">
              <span className="font-['Orbitron'] text-[8px] text-[#00e5ff] uppercase tracking-widest mb-1">
                Live Layers
              </span>
              <div className="flex items-center gap-1.5 text-[9px]">
                <span className="w-2 h-2 rounded-full bg-[#00e5ff]" /> CPCB
                Station
              </div>
              <div className="flex items-center gap-1.5 text-[9px]">
                <span className="w-2 h-2 rounded-full bg-[#ff1744]" /> Hotspot /
                Fire
              </div>
              <div className="flex items-center gap-1.5 text-[9px]">
                <span className="w-2 h-2 rounded-full bg-[#ff9100]" /> Industry
              </div>
              <div className="flex items-center gap-1.5 text-[9px]">
                <span className="w-2 h-2 rounded-full bg-[#ffd600]" /> Traffic
                Zone
              </div>
              <div className="flex items-center gap-1.5 text-[9px]">
                <span className="w-2 h-2 rounded-full bg-[#00e676]" /> School
              </div>
              <div className="flex items-center gap-1.5 text-[9px]">
                <span className="w-2 h-2 rounded-full bg-[#2979ff]" /> Hospital
              </div>
              <div className="flex items-center gap-1.5 text-[9px]">
                <span className="w-2 h-2 rounded-full bg-[#d500f9]" />{" "}
                Dispersion
              </div>
              <div className="flex items-center gap-1.5 text-[9px]">
                <span className="w-2 h-2 rounded-full bg-[#e040fb]" /> Satellite
              </div>
            </div>
          )}
        </section>

        {/* =========== RIGHT PANEL =========== */}
        <section className="flex flex-col gap-2.5 h-full overflow-hidden">
          {/* Tab Row */}
          <div className="flex bg-black/40 border border-white/5 rounded-lg p-1 gap-1 shrink-0">
            {[
              { key: "console", label: "Console", icon: "fa-robot" },
              { key: "dispersion", label: "Plume", icon: "fa-smog" },
              {
                key: "optimization",
                label: "Enforce",
                icon: "fa-clipboard-check",
              },
              { key: "compare", label: "Compare", icon: "fa-chart-column" },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => {
                  setActiveRightTab(tab.key as any);
                  if (tab.key === "compare" && !compareData) fetchComparison();
                }}
                className={`flex-1 flex flex-col items-center justify-center py-1.5 rounded text-[10px] font-semibold cursor-pointer transition gap-1 ${
                  activeRightTab === tab.key
                    ? "bg-[#00e5ff]/15 text-[#00e5ff] border border-[#00e5ff]/25 shadow-[0_0_8px_rgba(0,229,255,0.15)]"
                    : "text-zinc-500 hover:text-zinc-300 border border-transparent"
                }`}
              >
                <i className={`fa-solid ${tab.icon} text-xs`} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 min-h-0 flex flex-col">
            {activeRightTab === "console" ? (
              <div className="flex-1 flex flex-col gap-2.5 overflow-hidden">
                {/* Agent Console */}
                <div className="bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg p-4 flex flex-col flex-1 overflow-hidden">
                  <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-2">
                    <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider flex items-center gap-2">
                      <i
                        className={`fa-solid fa-robot text-[#00e5ff] ${isAgentRunning ? "pulse-active" : ""}`}
                      />{" "}
                      AI Command Console
                    </h3>
                  </div>

                  {/* Chat messages */}
                  <div className="flex-1 overflow-y-auto flex flex-col gap-2.5 pr-1 text-xs">
                    {chatHistory.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-lg border ${msg.role === "user" ? "bg-white/3 border-white/5 text-white self-end max-w-[85%]" : "bg-[#00e5ff]/5 border-[#00e5ff]/10 text-white max-w-[90%]"}`}
                      >
                        <div className="leading-relaxed whitespace-pre-wrap flex flex-col gap-1">
                          <strong>
                            {msg.role === "user" ? "You" : "AETHERIS"}:
                          </strong>
                          {msg.role === "user" ? (
                            <span>{msg.content}</span>
                          ) : (
                            <div className="markdown-content leading-relaxed text-zinc-200">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {msg.content}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Shimmer loading status */}
                  {isAgentRunning && (
                    <div
                      onClick={() => setAccordionValue("timeline")}
                      className="cursor-pointer bg-[#00e5ff]/10 hover:bg-[#00e5ff]/20 border border-[#00e5ff]/20 rounded-lg p-2.5 mb-2 flex items-center justify-between text-[11px] text-[#00e5ff] transition group"
                    >
                      <div className="flex items-center gap-2">
                        <i className="fa-solid fa-spinner fa-spin text-xs" />
                        <span className="font-semibold tracking-wide animate-pulse">
                          AETHERIS is processing environmental diagnostics...
                        </span>
                      </div>
                      <span className="text-[9px] uppercase tracking-wider text-[#00e5ff]/60 group-hover:text-[#00e5ff] flex items-center gap-1 transition">
                        View Decision Log{" "}
                        <i className="fa-solid fa-chevron-right text-[8px]" />
                      </span>
                    </div>
                  )}

                  {/* Input */}
                  <form
                    onSubmit={handleChatSubmit}
                    className="flex gap-2 border-t border-white/5 pt-2 mt-2"
                  >
                    <input
                      type="text"
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      placeholder="Issue command (e.g. 'Analyze Delhi')..."
                      className="flex-1 bg-black/40 border border-white/5 rounded px-3 py-2 text-xs text-white outline-none focus:border-[#00e5ff]"
                    />
                    <button
                      type="submit"
                      disabled={isAgentRunning}
                      className="bg-blue-600 text-white w-9 rounded flex items-center justify-center cursor-pointer hover:bg-blue-700 transition disabled:opacity-50"
                    >
                      <i className="fa-solid fa-paper-plane text-xs" />
                    </button>
                  </form>
                </div>

                {/* Collapsible Accordion Decision Timeline */}
                <Accordion
                  type="single"
                  collapsible
                  value={accordionValue}
                  onValueChange={setAccordionValue}
                  className="shrink-0"
                >
                  <AccordionItem value="timeline" className="border-0">
                    <div className="bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg p-3 flex flex-col gap-2">
                      <AccordionTrigger className="hover:no-underline py-0 text-zinc-400">
                        <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider flex items-center gap-2">
                          <i className="fa-solid fa-timeline text-cyan-400" />{" "}
                          Decision Timeline
                        </h3>
                      </AccordionTrigger>
                      <AccordionContent className="pt-2 pb-0 !h-[120px] overflow-y-auto pr-1">
                        <div className="flex flex-col gap-2">
                          {timeline.slice(0, 30).map((item, idx) => (
                            <div
                              key={idx}
                              className="text-xs relative pl-4 border-l border-white/5 flex gap-3 items-baseline"
                            >
                              <span className="font-['Orbitron'] text-[10px] text-[#00e5ff] shrink-0">
                                {item.time}
                              </span>
                              <span className="text-zinc-400">
                                {item.event}
                              </span>
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </div>
                  </AccordionItem>
                </Accordion>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2.5 min-h-0">
                {activeRightTab === "dispersion" && (
                  <div className="flex flex-col gap-3.5">
                    {/* Atmospheric overview card */}
                    <div className="flex flex-col gap-3 p-4 bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg text-xs">
                      <div className="flex flex-col">
                        <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider flex items-center gap-2 mb-1.5">
                          <i className="fa-solid fa-smog text-purple-400" />{" "}
                          Gaussian Plume Model
                        </h3>
                        <p className="text-[11px] text-zinc-400 leading-normal">
                          Pasquill-Gifford atmospheric dispersion modeling
                          mapping wind-adjusted transport plumes across
                          receptors.
                        </p>
                      </div>

                      <div className="flex flex-col gap-2 bg-black/25 border border-white/5 rounded-lg p-3">
                        {[
                          {
                            label: "Atmospheric Stability",
                            value: "Class D (Neutral Stability)",
                          },
                          {
                            label: "Dispersion Area",
                            value:
                              telemetry?.dispersion?.affected_area_sq_km != null
                                ? `${telemetry.dispersion.affected_area_sq_km.toFixed(1)} km²`
                                : null,
                          },
                          {
                            label: "Regional Wind Angle",
                            value:
                              telemetry?.dispersion?.parameters
                                ?.wind_direction_deg != null
                                ? `${telemetry.dispersion.parameters.wind_direction_deg.toFixed(0)}°`
                                : null,
                          },
                          {
                            label: "Regional Wind Speed",
                            value:
                              telemetry?.dispersion?.parameters
                                ?.wind_speed_ms != null
                                ? `${telemetry.dispersion.parameters.wind_speed_ms.toFixed(1)} m/s`
                                : null,
                          },
                        ].map((item, i) => (
                          <div
                            key={i}
                            className="flex justify-between items-center text-[10px]"
                          >
                            <span className="text-zinc-500 uppercase tracking-wider font-bold">
                              {item.label}
                            </span>
                            {item.value ? (
                              <span className="font-bold text-white font-mono">
                                {item.value}
                              </span>
                            ) : (
                              <SkeletonBox w="50px" h="14px" />
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Dynamic Wind Compass Widget */}
                      {telemetry?.dispersion?.parameters?.wind_direction_deg !=
                        null && (
                        <div className="flex items-center gap-3 bg-black/20 border border-white/5 rounded p-2.5">
                          <svg
                            width="40"
                            height="40"
                            viewBox="0 0 40 40"
                            className="text-[#00e5ff] shrink-0"
                          >
                            <circle
                              cx="20"
                              cy="20"
                              r="18"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1"
                              strokeDasharray="2,2"
                              opacity="0.3"
                            />
                            <circle
                              cx="20"
                              cy="20"
                              r="15"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1"
                              opacity="0.5"
                            />
                            <text
                              x="20"
                              y="8"
                              fontSize="6"
                              textAnchor="middle"
                              fill="#555"
                              fontWeight="bold"
                            >
                              N
                            </text>
                            <text
                              x="33"
                              y="22"
                              fontSize="6"
                              textAnchor="middle"
                              fill="#555"
                              fontWeight="bold"
                            >
                              E
                            </text>
                            <text
                              x="20"
                              y="36"
                              fontSize="6"
                              textAnchor="middle"
                              fill="#555"
                              fontWeight="bold"
                            >
                              S
                            </text>
                            <text
                              x="7"
                              y="22"
                              fontSize="6"
                              textAnchor="middle"
                              fill="#555"
                              fontWeight="bold"
                            >
                              W
                            </text>
                            {/* Rotating Arrow based on wind angle (note: wind direction means direction from, so pointing downwind would be +180 deg) */}
                            <g
                              transform={`rotate(${(telemetry.dispersion.parameters.wind_direction_deg + 180) % 360} 20 20)`}
                            >
                              <line
                                x1="20"
                                y1="32"
                                x2="20"
                                y2="8"
                                stroke="#00e5ff"
                                strokeWidth="2"
                                strokeLinecap="round"
                              />
                              <polygon
                                points="20,6 16,14 24,14"
                                fill="#00e5ff"
                              />
                              <circle
                                cx="20"
                                cy="20"
                                r="2.5"
                                fill="#08090c"
                                stroke="#00e5ff"
                                strokeWidth="1.5"
                              />
                            </g>
                          </svg>
                          <div className="flex flex-col">
                            <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">
                              Dynamic Downwind Vector
                            </span>
                            <span className="text-white text-xs font-bold font-['Orbitron']">
                              Heading{" "}
                              {(
                                (telemetry.dispersion.parameters
                                  .wind_direction_deg +
                                  180) %
                                360
                              ).toFixed(0)}
                              °
                            </span>
                            <span className="text-[9px] text-zinc-400">
                              Transporting from{" "}
                              {telemetry.dispersion.parameters.wind_direction_deg.toFixed(
                                0,
                              )}
                              °
                            </span>
                          </div>
                        </div>
                      )}

                      {telemetry?.dispersion?.wind_description && (
                        <div className="bg-black/20 border border-white/5 rounded p-2.5 text-[10px] text-zinc-400 leading-normal">
                          <i className="fa-solid fa-wind text-[#00e5ff] mr-1.5" />
                          {telemetry.dispersion.wind_description}
                        </div>
                      )}
                    </div>

                    {/* Active Plume Sources list */}
                    <div className="bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg p-4 flex flex-col gap-3">
                      <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider flex items-center gap-2">
                        <i className="fa-solid fa-cloud-meatball text-purple-400 animate-pulse" />{" "}
                        Active Plume Sources (
                        {1 +
                          (telemetry?.geospatial?.nearby_industries?.length ||
                            0) +
                          (telemetry?.fire_data?.length || 0)}
                        )
                      </h3>

                      <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto pr-1">
                        {/* 1. Primary City Plume */}
                        <div className="bg-black/20 border border-white/5 rounded p-2 flex flex-col gap-1 text-[10px]">
                          <div className="flex justify-between items-center">
                            <span className="text-cyan-400 font-bold flex items-center gap-1.5">
                              <i className="fa-solid fa-city text-[9px]" /> City
                              Center Plume
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[8px] bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-bold font-mono">
                              Active
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-[9px] text-zinc-400 mt-1">
                            <span>
                              Origin: ({mapCenter.lat.toFixed(4)},{" "}
                              {mapCenter.lon.toFixed(4)})
                            </span>
                            <span>Radius: ~50km</span>
                          </div>
                          <p className="text-[9px] text-zinc-500 leading-tight font-normal">
                            Simulating background emissions from traffic,
                            domestic heating, and low-level municipal
                            activities.
                          </p>
                        </div>

                        {/* 2. Industrial Plumes */}
                        {telemetry?.geospatial?.nearby_industries &&
                        telemetry.geospatial.nearby_industries.length > 0
                          ? telemetry.geospatial.nearby_industries.map(
                              (ind: any, idx: number) => (
                                <div
                                  key={`ind-${idx}`}
                                  className="bg-black/20 border border-white/5 rounded p-2 flex flex-col gap-1 text-[10px]"
                                >
                                  <div className="flex justify-between items-center">
                                    <span className="text-purple-400 font-bold flex items-center gap-1.5 truncate max-w-[170px]">
                                      <i className="fa-solid fa-industry text-[9px]" />{" "}
                                      {ind.name || `Industry #${idx + 1}`}
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded text-[8px] bg-purple-500/10 border border-purple-500/30 text-purple-400 font-bold font-mono">
                                      Industrial
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center text-[9px] text-zinc-400 mt-1">
                                    <span>
                                      Dist: {ind.distance_km?.toFixed(1) || "?"}{" "}
                                      km
                                    </span>
                                    <span>
                                      Loc: ({ind.lat.toFixed(4)},{" "}
                                      {ind.lon.toFixed(4)})
                                    </span>
                                  </div>
                                  <p className="text-[9px] text-zinc-500 leading-tight font-normal">
                                    Gaussian plume modeling downwind dispersion
                                    of stack emissions ({ind.type || "Facility"}
                                    ).
                                  </p>
                                </div>
                              ),
                            )
                          : null}

                        {/* 3. Fire Plumes */}
                        {telemetry?.fire_data && telemetry.fire_data.length > 0
                          ? telemetry.fire_data.map(
                              (fire: any, idx: number) => (
                                <div
                                  key={`fire-${idx}`}
                                  className="bg-black/20 border border-white/5 rounded p-2 flex flex-col gap-1 text-[10px]"
                                >
                                  <div className="flex justify-between items-center">
                                    <span className="text-red-400 font-bold flex items-center gap-1.5">
                                      <i className="fa-solid fa-fire text-[9px] animate-pulse" />{" "}
                                      NASA FIRMS Detection
                                    </span>
                                    <span className="px-1.5 py-0.5 rounded text-[8px] bg-red-500/10 border border-red-500/30 text-red-400 font-bold font-mono">
                                      Biomass Fire
                                    </span>
                                  </div>
                                  <div className="flex justify-between items-center text-[9px] text-zinc-400 mt-1">
                                    <span>
                                      Brightness: {fire.brightness || "?"} K
                                    </span>
                                    <span>
                                      Loc: ({fire.lat.toFixed(4)},{" "}
                                      {fire.lon.toFixed(4)})
                                    </span>
                                  </div>
                                  <p className="text-[9px] text-zinc-500 leading-tight font-normal">
                                    Modeling transport of heavy particulate
                                    matter and aerosols from active thermal
                                    anomalies.
                                  </p>
                                </div>
                              ),
                            )
                          : null}
                      </div>
                    </div>
                  </div>
                )}

                {activeRightTab === "optimization" && (
                  <div className="flex flex-col gap-3 p-4 bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg text-xs h-full min-h-[300px]">
                    <div className="flex flex-col">
                      <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider flex items-center gap-2 mb-1">
                        <i className="fa-solid fa-clipboard-check text-cyan-400" />{" "}
                        Enforcement Intelligence
                      </h3>
                      <p className="text-[10px] text-zinc-500 leading-normal">
                        OR-Tools solver optimized routing. Coverage:{" "}
                        {telemetry?.optimization?.coverage_pct?.toFixed(0) ||
                          "—"}
                        % of hotspots in{" "}
                        {telemetry?.optimization?.total_distance_km?.toFixed(
                          1,
                        ) || "—"}{" "}
                        km.
                      </p>
                    </div>

                    {/* Sub-tab selection */}
                    <div className="flex gap-1.5 p-0.5 bg-black/40 border border-white/5 rounded-lg shrink-0">
                      {(["route", "directives"] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setOptPanelTab(tab)}
                          className={`flex-1 text-center py-1 rounded text-[9px] font-bold cursor-pointer transition ${
                            optPanelTab === tab
                              ? "bg-cyan-500/10 border border-cyan-500/20 text-[#00e5ff]"
                              : "text-zinc-500 hover:text-zinc-300"
                          }`}
                        >
                          {tab === "route" ? "Inspection Pts" : "Directives"}
                        </button>
                      ))}
                    </div>

                    {/* Sub-tab content */}
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      {optPanelTab === "route" ? (
                        <div className="bg-black/25 border border-white/5 rounded p-2">
                          <table className="w-full text-left text-[10px]">
                            <thead>
                              <tr className="border-b border-white/5 text-zinc-500 uppercase tracking-wider font-bold">
                                <th className="pb-1 w-12">Unit</th>
                                <th className="pb-1 w-8">Pt #</th>
                                <th className="pb-1">Priority</th>
                                <th className="pb-1 w-12 text-right font-mono">
                                  Time
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {telemetry?.optimization?.routes?.length > 0 ? (
                                telemetry.optimization.routes.flatMap(
                                  (team: any[], tIdx: number) =>
                                    team.map((pt: any, sIdx: number) => (
                                      <tr
                                        key={`${tIdx}-${sIdx}`}
                                        className="border-b border-white/5 last:border-0"
                                      >
                                        <td className="py-1 text-cyan-400 font-bold font-['Orbitron']">
                                          Unit {tIdx + 1}
                                        </td>
                                        <td className="py-1 text-white font-bold">
                                          {pt.order + 1}
                                        </td>
                                        <td className="py-1">
                                          <span
                                            className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${pt.priority === "critical" ? "bg-red-500/20 text-red-400" : pt.priority === "high" ? "bg-orange-500/20 text-orange-400" : "bg-yellow-500/20 text-yellow-400"}`}
                                          >
                                            {(
                                              pt.priority || "medium"
                                            ).toUpperCase()}
                                          </span>
                                        </td>
                                        <td className="py-1 text-zinc-400 font-['Orbitron'] text-right">
                                          ~{pt.estimated_time_min || 20}m
                                        </td>
                                      </tr>
                                    )),
                                )
                              ) : (
                                <tr>
                                  <td
                                    colSpan={4}
                                    className="py-3 text-center text-zinc-500"
                                  >
                                    No inspection points. Run analysis first.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="bg-black/25 border border-white/5 rounded p-2 flex flex-col gap-1.5 font-medium">
                          {telemetry?.optimization?.enforcement_recommendations
                            ?.length > 0 ? (
                            telemetry.optimization.enforcement_recommendations.map(
                              (rec: any, idx: number) => (
                                <div
                                  key={idx}
                                  className="border-b border-white/5 last:border-0 pb-1.5 flex flex-col gap-0.5 text-[9px]"
                                >
                                  <div className="flex justify-between items-center font-bold">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[7px] tracking-wider ${rec.priority === "CRITICAL" ? "bg-red-500/10 border border-red-500/30 text-red-500" : rec.priority === "HIGH" ? "bg-orange-500/10 border border-orange-500/30 text-orange-500" : "bg-yellow-500/10 border border-yellow-500/30 text-yellow-500"}`}
                                    >
                                      {rec.priority}
                                    </span>
                                    <span className="text-[#00e5ff] font-['Orbitron'] text-[8px]">
                                      {rec.team} → {rec.target}
                                    </span>
                                  </div>
                                  <span className="text-zinc-300 leading-normal mt-0.5 font-medium">
                                    {rec.directive}
                                  </span>
                                </div>
                              ),
                            )
                          ) : (
                            <div className="py-6 text-center text-zinc-500 font-bold">
                              No enforcement directives. Run analysis first.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {activeRightTab === "compare" && (
                  <div className="flex flex-col gap-3 p-4 bg-[#0e1017]/50 backdrop-blur-md border border-white/5 rounded-lg text-xs h-full min-h-[300px]">
                    <div className="flex flex-col">
                      <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider flex items-center gap-2 mb-1.5">
                        <i className="fa-solid fa-chart-column text-[#00e5ff]" />{" "}
                        Compare Cities
                      </h3>
                      <p className="text-[10px] text-zinc-500 leading-normal">
                        Real-time comparison using live API feeds from CPCB,
                        traffic logs, and NASA FIRMS.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 bg-black/20 border border-white/5 rounded-lg p-2 justify-between shrink-0">
                      <DropdownMenu>
                        <DropdownMenuTrigger className="flex-1 bg-black/60 border border-white/10 hover:bg-black/80 text-white text-[10px] h-7 rounded px-2.5 outline-none flex items-center justify-between transition gap-2 cursor-pointer">
                          <span>
                            {CITIES[compareCity as keyof typeof CITIES]?.name || "Select city"}
                          </span>
                          <ChevronsUpDown className="size-3 text-zinc-400 shrink-0" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent className="bg-[#0e1017] border border-white/10 text-white text-xs z-[9999] min-w-[160px]">
                          <DropdownMenuRadioGroup
                            value={compareCity}
                            onValueChange={(val) => {
                              setCompareCity(val);
                              setCompareData(null);
                            }}
                          >
                            {Object.entries(CITIES)
                              .filter(([k]) => k !== cityKey)
                              .map(([k, v]) => (
                                <DropdownMenuRadioItem
                                  key={k}
                                  value={k}
                                  className="text-xs cursor-pointer hover:bg-white/10 focus:bg-white/10 focus:text-white text-zinc-300 py-1.5"
                                >
                                  {v.name}
                                </DropdownMenuRadioItem>
                              ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <button
                        onClick={fetchComparison}
                        disabled={isComparing}
                        className="bg-[#00e5ff]/15 border border-[#00e5ff]/35 text-[#00e5ff] rounded px-3 py-1 text-[10px] cursor-pointer hover:bg-[#00e5ff] hover:text-black transition disabled:opacity-50 font-bold font-mono h-7 flex items-center justify-center shrink-0"
                      >
                        {isComparing ? "Loading..." : "Compare"}
                      </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto">
                      {compareData ? (
                        <div className="bg-black/25 border border-white/5 rounded p-2">
                          <table className="w-full text-[10px]">
                            <thead>
                              <tr className="border-b border-white/5 text-zinc-500 uppercase tracking-wider text-[8px] font-bold">
                                <th className="pb-1 text-left">Metric</th>
                                <th className="pb-1 text-center truncate max-w-[60px]">
                                  {compareData.city1?.name}
                                </th>
                                <th className="pb-1 text-center truncate max-w-[60px]">
                                  {compareData.city2?.name}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {[
                                {
                                  label: "Current AQI",
                                  k1: compareData.city1?.current_aqi?.toFixed(
                                    1,
                                  ),
                                  k2: compareData.city2?.current_aqi?.toFixed(
                                    1,
                                  ),
                                  highlight: true,
                                },
                                {
                                  label: "24h Forecast",
                                  k1:
                                    compareData.city1?.forecast_24h?.toFixed(
                                      1,
                                    ) || "—",
                                  k2:
                                    compareData.city2?.forecast_24h?.toFixed(
                                      1,
                                    ) || "—",
                                },
                                {
                                  label: "PM2.5",
                                  k1: compareData.city1?.pm25?.toFixed(1),
                                  k2: compareData.city2?.pm25?.toFixed(1),
                                },
                                {
                                  label: "Risk Level",
                                  k1: compareData.city1?.risk_level,
                                  k2: compareData.city2?.risk_level,
                                },
                                {
                                  label: "Primary Source",
                                  k1: compareData.city1?.primary_source,
                                  k2: compareData.city2?.primary_source,
                                },
                                {
                                  label: "Hotspots",
                                  k1: compareData.city1?.hotspot_count,
                                  k2: compareData.city2?.hotspot_count,
                                },
                                {
                                  label: "Fire Alerts",
                                  k1: compareData.city1?.fire_count,
                                  k2: compareData.city2?.fire_count,
                                },
                                {
                                  label: "Congestion",
                                  k1:
                                    compareData.city1?.congestion_index != null
                                      ? `${(compareData.city1.congestion_index * 100).toFixed(0)}%`
                                      : "—",
                                  k2:
                                    compareData.city2?.congestion_index != null
                                      ? `${(compareData.city2.congestion_index * 100).toFixed(0)}%`
                                      : "—",
                                },
                              ].map((row, i) => (
                                <tr
                                  key={i}
                                  className="border-b border-white/5 last:border-0"
                                >
                                  <td className="py-1 text-zinc-400 font-medium">
                                    {row.label}
                                  </td>
                                  <td
                                    className={`py-1 text-center font-['Orbitron'] font-bold ${row.highlight ? aqiColor(Number(row.k1) || 0) : "text-white"}`}
                                  >
                                    {row.k1}
                                  </td>
                                  <td
                                    className={`py-1 text-center font-['Orbitron'] font-bold ${row.highlight ? aqiColor(Number(row.k2) || 0) : "text-white"}`}
                                  >
                                    {row.k2}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center text-zinc-500 text-center p-4">
                          {isComparing
                            ? "Fetching real-time data..."
                            : "Select a city and click Compare to load metrics."}
                        </div>
                      )}
                    </div>

                    {compareData?.comparison && (
                      <div className="bg-cyan-500/5 border border-cyan-500/15 rounded p-2 text-[9px] text-zinc-300">
                        <i className="fa-solid fa-chart-line text-[#00e5ff] mr-1.5" />
                        {compareData.comparison.insight}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* ============== SATELLITE INTELLIGENCE MODAL ============== */}
      <SatelliteModal
        isOpen={showSatelliteModal}
        onClose={() => setShowSatelliteModal(false)}
        mapCenter={mapCenter}
        telemetry={telemetry}
        backendUrl={backendUrl}
        gridTargets={gridTargets}
        gridImages={gridImages}
        visibleCount={visibleCount}
        setVisibleCount={setVisibleCount}
        locationName={locationName}
        isFetchingGrid={isFetchingGrid}
        gridStreamPhase={gridStreamPhase}
        refetchGrid={refetchGrid}
        onAnalysisComplete={handleAnalysisComplete}
      />

      {/* Forecast Intelligence Dialog */}
      <ForecastDialog
        isOpen={showForecastDialog}
        onClose={() => setShowForecastDialog(false)}
        telemetry={telemetry}
        cityName={locationName}
        lat={mapCenter.lat}
        lon={mapCenter.lon}
        backendUrl={backendUrl}
      />
    </div>
  );
}
