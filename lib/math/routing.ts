// Capacitated Vehicle Routing / Travelling Salesperson Problem (TSP) Solver
// Greedy nearest-neighbor routing engine running directly on the client side

import { haversineDistanceKm } from "../services/cpcb";

export interface RoutePoint {
  order: number;
  lat: number;
  lon: number;
  priority: string;
  estimated_time_min: number;
}

export interface DirectiveItem {
  id: number;
  team: string;
  priority: string;
  target: string;
  lat: number;
  lon: number;
  reason: string;
  directive: string;
}

export interface OptimizationResult {
  routes: RoutePoint[][];
  total_distance_km: number;
  total_time_hours: number;
  coverage_pct: number;
  enforcement_recommendations: DirectiveItem[];
}

export function optimizeRoutes(
  hotspots: any[],
  depotLat: number,
  depotLon: number,
  maxInspectors: number = 3,
  maxTimeHours: number = 8
): OptimizationResult {
  if (!hotspots || hotspots.length === 0) {
    return {
      routes: [],
      total_distance_km: 0,
      total_time_hours: 0,
      coverage_pct: 0,
      enforcement_recommendations: [],
    };
  }

  // Sort hotspots by priority (severity × avg_aqi)
  const severityWeight: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
  };

  // Clone hotspots to avoid mutations
  const targets = hotspots.map((h, index) => {
    const severity = h.severity || "low";
    const avgAqi = h.avg_aqi ?? h.value ?? 100;
    const priorityScore = (severityWeight[severity] || 1) * avgAqi;
    return {
      ...h,
      priority_score: priorityScore,
      h_lat: h.center_lat ?? h.lat ?? 0,
      h_lon: h.center_lon ?? h.lon ?? 0,
      originalIndex: index,
    };
  });

  targets.sort((a, b) => b.priority_score - a.priority_score);

  const avgSpeedKmh = 30;
  const maxDistPerTeam = maxTimeHours * avgSpeedKmh;
  const inspectionTimeKm = 15; // ~30 min inspection ≈ 15km equivalent travel distance constraints

  const routes: RoutePoint[][] = Array.from({ length: maxInspectors }, () => []);
  const teamPos: [number, number][] = Array.from({ length: maxInspectors }, () => [depotLat, depotLon]);
  const teamDist: number[] = Array.from({ length: maxInspectors }, () => 0.0);

  const assigned = new Set<number>();

  // Assign hotspots to nearest inspector team based on priorities
  for (const h of targets) {
    let bestTeam = -1;
    let bestDist = Infinity;

    for (let t = 0; t < maxInspectors; t++) {
      const d = haversineDistanceKm(teamPos[t][0], teamPos[t][1], h.h_lat, h.h_lon);
      const newTotal = teamDist[t] + d + inspectionTimeKm;
      
      if (newTotal < maxDistPerTeam && d < bestDist) {
        bestDist = d;
        bestTeam = t;
      }
    }

    if (bestTeam >= 0) {
      const order = routes[bestTeam].length;
      const inspectionTime = h.severity === "critical" || h.severity === "high" ? 30 : 20;
      routes[bestTeam].push({
        order,
        lat: h.h_lat,
        lon: h.h_lon,
        priority: h.severity || "medium",
        estimated_time_min: inspectionTime,
      });
      teamDist[bestTeam] += bestDist + inspectionTimeKm;
      teamPos[bestTeam] = [h.h_lat, h.h_lon];
      assigned.add(h.originalIndex);
    }
  }

  // Remove empty routes
  const activeRoutes = routes.filter((r) => r.length > 0);
  const totalDist = teamDist.reduce((a, b) => a + b, 0);
  const covered = activeRoutes.reduce((sum, r) => sum + r.length, 0);
  const totalSpots = hotspots.length;

  const recommendations = generateEnforcementRecommendations(activeRoutes, targets);

  return {
    routes: activeRoutes,
    total_distance_km: Math.round(totalDist * 100) / 100,
    total_time_hours: Math.round((totalDist / avgSpeedKmh + covered * 0.5) * 100) / 100,
    coverage_pct: totalSpots > 0 ? Math.round((covered / totalSpots) * 100 * 10) / 10 : 0,
    enforcement_recommendations: recommendations,
  };
}

function generateEnforcementRecommendations(routes: RoutePoint[][], hotspots: any[]): DirectiveItem[] {
  const recommendations: DirectiveItem[] = [];
  let recId = 1;

  routes.forEach((route, teamIdx) => {
    route.forEach((stop) => {
      const priority = stop.priority.toUpperCase();
      const lat = stop.lat;
      const lon = stop.lon;

      let sourceDesc = "unidentified emissions / open burning";
      let clusterName = `Cluster ${stop.order}`;

      for (const h of hotspots) {
        if (Math.abs(h.h_lat - lat) < 0.001 && Math.abs(h.h_lon - lon) < 0.001) {
          sourceDesc = h.source || "heavy smoke or thermal spike";
          clusterName = `Zone Cluster ${h.cluster_id ?? recId}`;
          break;
        }
      }

      let directive = "";
      if (priority === "CRITICAL") {
        directive = `Immediate Halt and Cease-and-Desist order for active open fires or heavy smoke emissions in ${clusterName}.`;
      } else if (priority === "HIGH") {
        directive = `Deploy enforcement inspectors to check construction compliance and dust suppression controls in ${clusterName}.`;
      } else {
        directive = `Conduct standard emissions compliance check on local boiler/stack emissions in ${clusterName}.`;
      }

      recommendations.push({
        id: recId,
        team: `Team ${teamIdx + 1}`,
        priority,
        target: clusterName,
        lat,
        lon,
        reason: `Active hotspot source: ${sourceDesc}`,
        directive,
      });
      recId++;
    });
  });

  const prioOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  recommendations.sort((a, b) => (prioOrder[a.priority] ?? 4) - (prioOrder[b.priority] ?? 4));
  return recommendations;
}
export default optimizeRoutes;
