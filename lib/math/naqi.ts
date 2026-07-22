// National AQI (NAQI) Breakpoint and Category Calculations for India
// Standard CPCB (Ministry of Environment, Forest and Climate Change) Specification (2014)

/**
 * CPCB National AQI sub-index for particulate matter.
 *
 * `concentration` must be the CPCB averaging-period concentration in µg/m³
 * (a 24-hour rolling average for PM2.5 and PM10), not an AQI from another
 * standard and not a one-off sensor reading.
 */
export function calculateIndianAQI(
  concentration: number,
  pollutant: "pm25" | "pm10",
): number | null {
  const key = pollutant === "pm25" ? "PM2.5" : "PM10";
  return calcSubIndex(key, concentration);
}

export function getIndianAQICategory(aqi: number) {
  if (aqi <= 50) return { label: 'Good', color: 'bg-emerald-500', text: 'text-emerald-500', description: 'Minimal Impact' };
  if (aqi <= 100) return { label: 'Satisfactory', color: 'bg-emerald-600', text: 'text-emerald-600', description: 'May cause minor breathing discomfort to sensitive people.' };
  if (aqi <= 200) return { label: 'Moderate', color: 'bg-yellow-500', text: 'text-yellow-500', description: 'May cause breathing discomfort to people with lung disease such as asthma, and discomfort to people with heart disease, children and older adults.' };
  if (aqi <= 300) return { label: 'Poor', color: 'bg-orange-500', text: 'text-orange-500', description: 'May cause breathing discomfort to people on prolonged exposure, and discomfort to people with heart disease.' };
  if (aqi <= 400) return { label: 'Very Poor', color: 'bg-red-500', text: 'text-red-500', description: 'May cause respiratory illness to the people on prolonged exposure. Effect may be more pronounced in people with lung and heart diseases.' };
  return { label: 'Severe', color: 'bg-rose-900', text: 'text-rose-900', description: 'May cause respiratory impact even on healthy people, and serious health impacts on people with lung/heart disease.' };
}

export interface Pollutants {
  "PM2.5"?: number;
  "PM10"?: number;
  "SO2"?: number;
  "NO2"?: number;
  "CO"?: number;
  "O3"?: number;
  "NH3"?: number;
  "Pb"?: number;
  [key: string]: number | undefined;
}

export interface StationAqiResult {
  aqi: number;
  category: string;
  dominantPollutant: string;
  subIndexes: Record<string, number>;
  isValid: boolean; // Minimum 3 pollutants required, including PM2.5 or PM10
}

/**
 * Official CPCB NAQI Breakpoints Array:
 * Format: [BP_LO, BP_HI, I_LO, I_HI]
 */
export const NAQI_BREAKPOINTS: Record<string, [number, number, number, number][]> = {
  "PM2.5": [
    [0, 30, 0, 50],
    [31, 60, 51, 100],
    [61, 90, 101, 200],
    [91, 120, 201, 300],
    [121, 250, 301, 400],
    [251, 380, 401, 500],
  ],
  "PM10": [
    [0, 50, 0, 50],
    [51, 100, 51, 100],
    [101, 250, 101, 200],
    [251, 350, 201, 300],
    [351, 430, 301, 400],
    [431, 500, 401, 500],
  ],
  "SO2": [
    [0, 40, 0, 50],
    [41, 80, 51, 100],
    [81, 380, 101, 200],
    [381, 800, 201, 300],
    [801, 1600, 301, 400],
    [1601, 2400, 401, 500],
  ],
  "NO2": [
    [0, 40, 0, 50],
    [41, 80, 51, 100],
    [81, 180, 101, 200],
    [181, 280, 201, 300],
    [281, 400, 301, 400],
    [401, 600, 401, 500],
  ],
  "CO": [
    [0, 1.0, 0, 50],
    [1.1, 2.0, 51, 100],
    [2.1, 10.0, 101, 200],
    [10.1, 17.0, 201, 300],
    [17.1, 34.0, 301, 400],
    [34.1, 50.0, 401, 500],
  ],
  "O3": [
    [0, 50, 0, 50],
    [51, 100, 51, 100],
    [101, 168, 101, 200],
    [169, 208, 201, 300],
    [209, 748, 301, 500],
  ],
  "OZONE": [
    [0, 50, 0, 50],
    [51, 100, 51, 100],
    [101, 168, 101, 200],
    [169, 208, 201, 300],
    [209, 748, 301, 500],
  ],
  "NH3": [
    [0, 200, 0, 50],
    [201, 400, 51, 100],
    [401, 800, 101, 200],
    [801, 1200, 201, 300],
    [1201, 1800, 301, 400],
    [1801, 2400, 401, 500],
  ],
  "Pb": [
    [0, 0.5, 0, 50],
    [0.51, 1.0, 51, 100],
    [1.1, 2.0, 101, 200],
    [2.1, 3.0, 201, 300],
    [3.1, 3.5, 301, 400],
    [3.51, 5.0, 401, 500],
  ],
};

/**
 * Piecewise Linear Sub-Index Equation:
 * I_p = ((I_HI - I_LO) / (BP_HI - BP_LO)) * (C_p - BP_LO) + I_LO
 */
export function calcSubIndex(pollutant: string, concentration: number): number | null {
  if (!Number.isFinite(concentration) || concentration < 0) return null;

  const normalizedKey = pollutant.trim().toUpperCase().replace(".", "");
  if (normalizedKey === "PM25" || normalizedKey === "PM2.5") {
    return calculateFromBreakpoints(NAQI_BREAKPOINTS["PM2.5"], concentration);
  }
  if (normalizedKey === "PM10") {
    return calculateFromBreakpoints(NAQI_BREAKPOINTS.PM10, concentration);
  }

  const key = normalizedKey === "OZONE" ? "O3" : normalizedKey;
  const bps = NAQI_BREAKPOINTS[key];
  if (!bps) return null;

  return calculateFromBreakpoints(bps, concentration);
}

function calculateFromBreakpoints(
  breakpoints: [number, number, number, number][],
  concentration: number,
): number {
  for (const [bp_lo, bp_hi, i_lo, i_hi] of breakpoints) {
    if (concentration <= bp_hi) {
      const subIndex = ((i_hi - i_lo) / (bp_hi - bp_lo)) * (concentration - bp_lo) + i_lo;
      return Math.round(Math.min(500, Math.max(0, subIndex)));
    }
  }

  // NAQI is capped at 500.  Do not invent a wider concentration range and
  // interpolate it, which artificially changes severe-pollution AQIs.
  const lastBp = breakpoints[breakpoints.length - 1];
  const [bp_lo, bp_hi, i_lo, i_hi] = lastBp;
  const extrapolated = ((i_hi - i_lo) / (bp_hi - bp_lo)) * (concentration - bp_lo) + i_lo;
  return Math.round(Math.min(500, Math.max(0, extrapolated)));
}

export function calculateIndiaAqi(pm25Raw?: number, pm10Raw?: number): number {
  const subPm25 = pm25Raw == null ? 0 : calculateIndianAQI(pm25Raw, "pm25") ?? 0;
  const subPm10 = pm10Raw == null ? 0 : calculateIndianAQI(pm10Raw, "pm10") ?? 0;

  const overall = Math.max(subPm25, subPm10);
  return Math.min(500, Math.round(overall));
}

/**
 * Complete Station-Level CPCB NAQI Calculation:
 * Requires minimum 3 pollutants, one of which MUST be PM2.5 or PM10.
 * AQI = Max(I_PM2.5, I_PM10, I_SO2, I_NO2, I_CO, I_O3, I_NH3, I_Pb)
 */
export function calculateStationAqi(pollutants: Pollutants): StationAqiResult {
  const subIndexes: Record<string, number> = {};
  let maxAqi = 0;
  let dominantPollutant = "PM2.5";
  let validCount = 0;
  let hasPm = false;

  for (const [key, val] of Object.entries(pollutants)) {
    if (val != null && !isNaN(val) && val >= 0) {
      const sub = calcSubIndex(key, val);
      if (sub !== null) {
        subIndexes[key] = sub;
        validCount++;

        const upperKey = key.toUpperCase();
        if (upperKey.includes("PM2.5") || upperKey.includes("PM10")) {
          hasPm = true;
        }

        if (sub > maxAqi) {
          maxAqi = sub;
          dominantPollutant = key;
        }
      }
    }
  }

  const finalAqi = Math.round(Math.min(500, maxAqi));
  const isValid = validCount >= 3 && hasPm;

  return {
    aqi: finalAqi,
    category: getAqiCategory(finalAqi),
    dominantPollutant,
    subIndexes,
    isValid,
  };
}

/** Calculate overall AQI across all provided pollutants */
export function calculateOverallAqi(pollutants: Record<string, number>): number {
  return calculateStationAqi(pollutants).aqi;
}

/** City-Wide Weighted Average AQI equation */
export function calculateCityWideAqi(stationAqis: number[]): number {
  if (!stationAqis || stationAqis.length === 0) return 0;
  const validAqis = stationAqis.filter((a) => a != null && !isNaN(a) && a > 0);
  if (validAqis.length === 0) return 0;

  const sum = validAqis.reduce((acc, curr) => acc + curr, 0);
  return Math.round(sum / validAqis.length);
}

export function getAqiCategory(aqi: number): string {
  return getIndianAQICategory(aqi).label;
}

export function getAqiColorClass(aqi: number): string {
  if (aqi <= 50) return "text-emerald-400";
  if (aqi <= 100) return "text-green-400";
  if (aqi <= 200) return "text-yellow-400";
  if (aqi <= 300) return "text-orange-400";
  if (aqi <= 400) return "text-red-400";
  return "text-red-600 font-extrabold animate-pulse";
}

export function getAqiBgClass(aqi: number): string {
  if (aqi <= 50) return "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
  if (aqi <= 100) return "bg-green-500/10 border-green-500/20 text-green-400";
  if (aqi <= 200) return "bg-yellow-500/10 border-yellow-500/20 text-yellow-400";
  if (aqi <= 300) return "bg-orange-500/10 border-orange-500/20 text-orange-400";
  if (aqi <= 400) return "bg-red-500/10 border-red-500/20 text-red-400";
  return "bg-red-950/20 border-red-600/30 text-red-500";
}
