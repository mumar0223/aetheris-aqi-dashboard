// Gaussian Plume Atmospheric Dispersion Math Model
// Translated from numpy-based backend model to pure TypeScript

export interface DispersionData {
  concentration_grid: number[][];
  grid_bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
  affected_area_sq_km: number;
  max_concentration_lat: number;
  max_concentration_lon: number;
  wind_description: string;
  source: { lat: number; lon: number };
  parameters: {
    wind_speed_ms: number;
    wind_direction_deg: number;
    emission_rate_gs: number;
    stack_height_m: number;
  };
}

export function modelDispersion(
  sourceLat: number,
  sourceLon: number,
  windSpeed: number,
  windDirection: number,
  emissionRate: number = 100.0,
  stackHeight: number = 30.0,
  gridSizeKm: number = 10.0,
  gridResolution: number = 50,
  stabilityClass: string = "D"
): DispersionData {
  const u = Math.max(0.5, windSpeed);
  // Meteorological wind direction (wind comes FROM direction)
  // Shift by 180 degrees to get mathematical wind vector (wind blows TO direction)
  const windToDirRad = (((windDirection + 180) % 360) * Math.PI) / 180;

  const halfGrid = gridSizeKm / 2;
  const kmPerDegLat = 111.0;
  const kmPerDegLon = 111.0 * Math.cos((sourceLat * Math.PI) / 180);

  const latRange = halfGrid / kmPerDegLat;
  const lonRange = halfGrid / kmPerDegLon;

  const lats: number[] = [];
  const lons: number[] = [];
  for (let i = 0; i < gridResolution; i++) {
    lats.push((sourceLat - latRange) + (i * (latRange * 2)) / (gridResolution - 1));
    lons.push((sourceLon - lonRange) + (i * (lonRange * 2)) / (gridResolution - 1));
  }

  // Pasquill-Gifford dispersion parameters (rural/standard coefficients)
  // sigma_y = a * x^b, sigma_z = c * x^d
  const stabilityParams: Record<string, { a: number; b: number; c: number; d: number }> = {
    A: { a: 0.22, b: 0.894, c: 0.20, d: 0.894 }, // Very unstable
    B: { a: 0.16, b: 0.894, c: 0.12, d: 0.894 }, // Unstable
    C: { a: 0.11, b: 0.894, c: 0.08, d: 0.894 }, // Slightly unstable
    D: { a: 0.08, b: 0.894, c: 0.06, d: 0.894 }, // Neutral
    E: { a: 0.06, b: 0.894, c: 0.03, d: 0.894 }, // Slightly stable
    F: { a: 0.04, b: 0.894, c: 0.016, d: 0.894 }, // Stable
  };

  const params = stabilityParams[stabilityClass] || stabilityParams["D"];
  const { a, b, c, d } = params;

  // Rotation coefficients to align coordinates with wind heading vector
  const cosWind = Math.cos(-windToDirRad + Math.PI / 2);
  const sinWind = Math.sin(-windToDirRad + Math.PI / 2);

  const concentrationGrid: number[][] = [];
  let maxConc = 0;
  let maxI = 0;
  let maxJ = 0;

  for (let i = 0; i < gridResolution; i++) {
    const row: number[] = [];
    const lat = lats[i];
    const dy = (lat - sourceLat) * kmPerDegLat * 1000; // y-distance from source (m)

    for (let j = 0; j < gridResolution; j++) {
      const lon = lons[j];
      const dx = (lon - sourceLon) * kmPerDegLon * 1000; // x-distance from source (m)

      // Rotate coordinates into wind-aligned frame
      // xRot is downwind distance (must be > 0), yRot is crosswind distance
      const xRot = dx * cosWind + dy * sinWind;
      const yRot = -dx * sinWind + dy * cosWind;

      let conc = 0;
      if (xRot > 0) {
        const xPos = Math.max(xRot, 1.0);
        const sigmaY = Math.max(a * Math.pow(xPos, b), 1.0);
        const sigmaZ = Math.max(c * Math.pow(xPos, d), 1.0);

        // Standard ground-level (z=0) Gaussian Plume equation
        const term1 = emissionRate / (2 * Math.PI * u * sigmaY * sigmaZ);
        const term2 = Math.exp(-0.5 * Math.pow(yRot / sigmaY, 2));
        const term3 = Math.exp(-0.5 * Math.pow(stackHeight / sigmaZ, 2));
        conc = term1 * term2 * term3;
      }

      row.push(conc);
      if (conc > maxConc) {
        maxConc = conc;
        maxI = i;
        maxJ = j;
      }
    }
    concentrationGrid.push(row);
  }

  // Normalize grid from 0.0 to 1.0 and calculate total affected area
  const normGrid: number[][] = [];
  let affectedCells = 0;
  for (let i = 0; i < gridResolution; i++) {
    const normRow: number[] = [];
    for (let j = 0; j < gridResolution; j++) {
      const val = maxConc > 0 ? concentrationGrid[i][j] / maxConc : 0;
      normRow.push(val);
      if (val > 0.1) {
        affectedCells++;
      }
    }
    normGrid.push(normRow);
  }

  const cellAreaSqKm = Math.pow(gridSizeKm / gridResolution, 2);
  const affectedArea = affectedCells * cellAreaSqKm;

  // Wind direction compass description
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const windDirName = directions[Math.round(windDirection / 22.5) % 16] || "N";
  const oppositeWindDir = windDirName
    .replace(/N/g, "TempS").replace(/S/g, "N").replace(/TempS/g, "S")
    .replace(/E/g, "TempW").replace(/W/g, "E").replace(/TempW/g, "W");

  const windDescription = `Wind from ${windDirName} at ${u.toFixed(1)} m/s. Pollution plume extends ${oppositeWindDir}ward. Affected area: ${affectedArea.toFixed(1)} sq km.`;

  return {
    concentration_grid: normGrid,
    grid_bounds: {
      north: lats[gridResolution - 1],
      south: lats[0],
      east: lons[gridResolution - 1],
      west: lons[0],
    },
    affected_area_sq_km: Math.round(affectedArea * 100) / 100,
    max_concentration_lat: Math.round(lats[maxI] * 10000) / 10000,
    max_concentration_lon: Math.round(lons[maxJ] * 10000) / 10000,
    wind_description: windDescription,
    source: { lat: sourceLat, lon: sourceLon },
    parameters: {
      wind_speed_ms: u,
      wind_direction_deg: windDirection,
      emission_rate_gs: emissionRate,
      stack_height_m: stackHeight,
    },
  };
}
