import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "current";
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const days = searchParams.get("days") || "3";

  if (!lat || !lon) {
    return NextResponse.json(
      { error: "Missing required query parameters: lat, lon" },
      { status: 400 },
    );
  }

  try {
    let targetUrl = "";

    if (type === "current") {
      targetUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,rain,cloud_cover,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code&timezone=auto`;
    } else if (type === "forecast") {
      targetUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,wind_speed_10m,wind_direction_10m,surface_pressure&forecast_days=${days}&timezone=auto`;
    } else if (type === "historical") {
      const today = new Date();
      const startDate = new Date();
      startDate.setDate(today.getDate() - parseInt(days, 10));
      const formatDt = (d: Date) => d.toISOString().split("T")[0];
      targetUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${formatDt(startDate)}&end_date=${formatDt(today)}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,surface_pressure&timezone=auto`;
    } else if (type === "air_quality") {
      const pastDays = searchParams.get("past_days") || "7";
      targetUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=pm10,pm2_5,carbon_monoxide,nitrogen_dioxide,sulphur_dioxide,ozone,us_aqi&hourly=pm10,pm2_5,us_aqi&past_days=${pastDays}`;
    } else {
      return NextResponse.json(
        { error: "Invalid weather query type" },
        { status: 400 },
      );
    }

    let res: Response | null = null;
    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        res = await fetch(targetUrl, {
          headers: {
            Accept: "application/json",
            "User-Agent": "DelhiEnvironmentalPlatform/1.0",
          },
        });
        if (res.ok) break;
      } catch (err) {
        lastError = err;
        if (attempt < 3) {
          console.warn(`[Weather Proxy] Attempt ${attempt} failed, retrying in 1s...`, err);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    if (!res || !res.ok) {
      const errText = res ? await res.text().catch(() => "") : (lastError?.message || "Unknown connection error");
      console.error(`[Weather API Proxy Error] HTTP ${res ? res.status : 500}:`, errText);
      return NextResponse.json(
        { error: `Open-Meteo HTTP request failed`, details: errText },
        { status: res ? res.status : 500 },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("[Weather Proxy Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
