import { resolveUrl } from "./url";

export interface CurrentWeather {
  temperature: number;
  humidity: number;
  apparent_temperature?: number;
  wind_speed: number;
  wind_direction: number;
  wind_gusts?: number;
  pressure: number;
  precipitation: number;
  rain: number;
  cloud_cover: number;
  condition: string;
  source: string;
}

export interface WeatherForecast {
  timestamps: string[];
  temperature: number[];
  humidity: number[];
  wind_speed: number[];
  wind_direction: number[];
  pressure: number[];
  precip_probability: number[];
  source: string;
}

export interface HistoricalWeather {
  timestamps: string[];
  temperature: number[];
  humidity: number[];
  wind_speed: number[];
  wind_direction: number[];
  pressure: number[];
  source: string;
}

export const WMO_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

export function getWindDirectionName(degrees: number): string {
  const directions = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"
  ];
  const idx = Math.round(degrees / 22.5) % 16;
  return directions[idx];
}



export async function fetchCurrentWeather(lat: number, lon: number): Promise<CurrentWeather> {
  try {
    const url = resolveUrl(`/api/weather?type=current&lat=${lat}&lon=${lon}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Weather Proxy HTTP ${res.status}`);

    const data = await res.json();
    const current = data.current || {};
    const wCode = current.weather_code || 0;
    const condition = WMO_CODES[wCode] || "Clear sky";

    return {
      temperature: current.temperature_2m ?? 30,
      humidity: current.relative_humidity_2m ?? 50,
      apparent_temperature: current.apparent_temperature ?? current.temperature_2m,
      wind_speed: current.wind_speed_10m ?? 5,
      wind_direction: current.wind_direction_10m ?? 180,
      wind_gusts: current.wind_gusts_10m,
      pressure: current.surface_pressure ?? 1013,
      precipitation: current.precipitation ?? 0,
      rain: current.rain ?? 0,
      cloud_cover: current.cloud_cover ?? 50,
      condition,
      source: "open_meteo",
    };
  } catch (err) {
    console.error("Failed to fetch weather from Open-Meteo API:", err);
    throw err;
  }
}
