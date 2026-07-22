// Source Attribution Solver - Weighted rule-based pollution source contributions
// Translated from python rule-based scoring engine to client-side TypeScript

export interface SourceContribution {
  source: string;
  contribution_pct: number;
  confidence: number;
  evidence: string[];
}

export interface AttributionResult {
  attributions: SourceContribution[];
  primary_source: string;
  confidence_score: number;
  method: string;
}

export function attributeSources(
  aqi: number,
  weather: any,
  traffic: any,
  nearbyIndustries: number = 0,
  nearbyConstruction: number = 0,
  fireDetections: number = 0,
  visionSources: string[] = [],
  lat: number = 28.6,
  lon: number = 77.2
): AttributionResult {
  const now = new Date();
  const hour = now.getHours();
  const month = now.getMonth() + 1; // JS getMonth() is 0-indexed

  // Initialize raw scores
  const scores: Record<string, number> = {
    traffic: 0.0,
    industry: 0.0,
    construction: 0.0,
    weather: 0.0,
    burning: 0.0,
  };

  const evidence: Record<string, string[]> = {
    traffic: [],
    industry: [],
    construction: [],
    weather: [],
    burning: [],
  };

  // ---- 1. TRAFFIC ----
  const congestion = traffic?.congestion_index ?? 0.5;
  scores.traffic += congestion * 30;

  if ((hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 21)) {
    scores.traffic += 20;
    evidence.traffic.push("Rush hour traffic period");
  }

  if (congestion > 0.7) {
    scores.traffic += 15;
    evidence.traffic.push(`High traffic congestion (${Math.round(congestion * 100)}%)`);
  }

  if (visionSources.includes("traffic")) {
    scores.traffic += 10;
    evidence.traffic.push("Heavy vehicles detected in satellite imagery");
  }

  // ---- 2. INDUSTRY ----
  if (nearbyIndustries > 0) {
    const industryScore = Math.min(40, nearbyIndustries * 8);
    scores.industry += industryScore;
    evidence.industry.push(`${nearbyIndustries} industrial sites within 5km`);
  }

  const windSpeed = weather?.wind_speed ?? 5;

  if (visionSources.includes("industrial_emission")) {
    scores.industry += 25;
    evidence.industry.push("Industrial emissions detected in satellite imagery");
  }

  if (hour >= 22 || hour <= 5) {
    scores.industry += 10;
    evidence.industry.push("Nighttime industrial activity period");
  }

  // ---- 3. CONSTRUCTION ----
  if (nearbyConstruction > 0) {
    scores.construction += Math.min(30, nearbyConstruction * 10);
    evidence.construction.push(`${nearbyConstruction} construction sites nearby`);
  }

  if (visionSources.includes("construction_dust")) {
    scores.construction += 20;
    evidence.construction.push("Construction activity detected in satellite imagery");
  }

  if (hour >= 9 && hour <= 17) {
    scores.construction += 5;
    evidence.construction.push("Active construction hours");
  }

  // ---- 4. WEATHER ----
  const humidity = weather?.humidity ?? 50;
  const temperature = weather?.temperature ?? 30;
  const precipitation = weather?.precipitation ?? 0;

  if (temperature < 15 && hour >= 5 && hour <= 9) {
    scores.weather += 25;
    evidence.weather.push("Potential temperature inversion (cold winter morning)");
  }

  if (windSpeed < 3) {
    scores.weather += 20;
    evidence.weather.push(`Low wind speed (${windSpeed.toFixed(1)} m/s) — poor dispersion`);
  }

  if (humidity > 80) {
    scores.weather += 10;
    evidence.weather.push(`High humidity (${Math.round(humidity)}%) — pollutant trapping`);
  }

  if (temperature > 40 && humidity < 30) {
    scores.weather += 15;
    evidence.weather.push("Hot & dry conditions — dust suspension likely");
  }

  if (precipitation > 2) {
    scores.weather -= 15;
    evidence.weather.push("Rainfall helps wash out atmospheric pollutants");
  }

  // ---- 5. BURNING (Stubble, Waste, Biomass) ----
  if (fireDetections > 0) {
    scores.burning += Math.min(40, fireDetections * 10);
    evidence.burning.push(`${fireDetections} thermal alerts/fires detected by NASA FIRMS`);
  }

  if (month >= 10 && month <= 11 && lat > 25) {
    scores.burning += 20;
    evidence.burning.push("Stubble burning season in North India");
  }

  if (visionSources.includes("burning")) {
    scores.burning += 20;
    evidence.burning.push("Open burning detected in satellite imagery");
  }

  // ---- Normalize to Percentages ----
  let total = 0;
  Object.keys(scores).forEach((key) => {
    scores[key] = Math.max(0, scores[key]);
    total += scores[key];
  });
  if (total === 0) total = 1;

  const attributions: SourceContribution[] = [];
  Object.keys(scores).forEach((source) => {
    const pct = (scores[source] / total) * 100;
    const confidence = Math.min(0.95, 0.4 + pct / 200);
    attributions.push({
      source,
      contribution_pct: Math.round(pct * 10) / 10,
      confidence: Math.round(confidence * 100) / 100,
      evidence: evidence[source] || [],
    });
  });

  // Sort by contribution descending
  attributions.sort((a, b) => b.contribution_pct - a.contribution_pct);

  // Compute global confidence score based on sensor/vision data density
  let baseConfidence = 65.0;
  if (visionSources.length > 0) baseConfidence += 15.0;
  if (fireDetections > 0) baseConfidence += 10.0;
  if (traffic?.congestion_index !== undefined && traffic?.source !== "fallback") baseConfidence += 5.0;
  if (weather?.wind_speed !== undefined && weather?.source !== "fallback") baseConfidence += 5.0;

  const globalConfidence = Math.min(98.0, baseConfidence);

  return {
    attributions,
    primary_source: attributions[0]?.source || "unknown",
    confidence_score: Math.round(globalConfidence * 10) / 10,
    method: "rule_based_multimodal_fusion",
  };
}
export default attributeSources;
