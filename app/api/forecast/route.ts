import { NextRequest, NextResponse } from "next/server";
import { Client } from "@gradio/client";
import { calibrateForecastToOfficialAqi, isValidAqi } from "@/lib/forecast/official-calibration";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { aqi_history, lat, lon, current_aqi } = await req.json();

    if (!aqi_history || !Array.isArray(aqi_history) || aqi_history.length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid aqi_history" },
        { status: 400 },
      );
    }

    const history = aqi_history
      .map((value: unknown) => Number(value))
      .filter((value: number) => Number.isFinite(value) && value >= 0 && value <= 500);
    if (history.length === 0) {
      return NextResponse.json({ error: "aqi_history has no valid AQI values" }, { status: 400 });
    }
    const officialCurrentAqi = isValidAqi(Number(current_aqi)) ? Number(current_aqi) : undefined;

    const backendUrl =
      process.env.FORECAST_BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "";
    const hfToken =
      process.env.HF_TOKEN || process.env.NEXT_PUBLIC_HF_TOKEN || "";
    const spaceId = process.env.HF_SPACE || "mohdumar0223/hackathon";

    const normalizeResponse = (data: Record<string, unknown>) =>
      calibrateForecastToOfficialAqi(data, officialCurrentAqi);

    const gradioTargets = [...new Set([backendUrl, spaceId].filter(Boolean))];
    let lastError: unknown = null;

    for (const target of gradioTargets) {
      try {
        console.log(`[API Forecast Proxy] Connecting to Gradio target: ${target}`);
        const client = await Client.connect(target, {
          token: hfToken as `hf_${string}` | undefined,
        });
        const result = await client.predict(0, [
          history.join(","),
          lat ? lat.toString() : "28.6139",
          lon ? lon.toString() : "77.209",
        ]);

        const serialized = Array.isArray(result.data)
          ? [...result.data].reverse().find((value): value is string => typeof value === "string" && value.trim().startsWith("{"))
          : undefined;
        if (!serialized) throw new Error("Gradio response did not include forecast JSON");
        const data = JSON.parse(serialized) as Record<string, unknown>;
        return NextResponse.json(normalizeResponse(data));
      } catch (error) {
        lastError = error;
        console.warn(`[API Forecast Proxy] Gradio target failed: ${target}`, error);
      }
    }

    throw lastError instanceof Error ? lastError : new Error("All forecast backends are unavailable");
  } catch (error: any) {
    console.error("[API Forecast Proxy Error]:", error);
    return NextResponse.json(
      { error: error.message || "Forecast prediction failed" },
      { status: 500 },
    );
  }
}
