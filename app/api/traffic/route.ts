import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const apiKey = searchParams.get("key") || process.env.TOMTOM_API_KEY || "";

  if (!lat || !lon) {
    return NextResponse.json(
      { error: "Missing required query parameters: lat, lon" },
      { status: 400 },
    );
  }

  try {
    const url = `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?key=${apiKey}&point=${lat},${lon}&unit=KMPH`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "DelhiEnvironmentalPlatform/1.0",
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[TomTom Proxy Error] HTTP ${res.status}:`, errText);
      return NextResponse.json(
        { error: `TomTom HTTP ${res.status}`, details: errText },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("[Traffic Proxy Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
