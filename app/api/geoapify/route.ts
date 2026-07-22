import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const GEOAPIFY_PLACES_BASE = "https://api.geoapify.com/v2/places";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");
  const radius = searchParams.get("radius") || "100000"; // radius in meters (100km)
  const categories =
    searchParams.get("categories") ||
    "healthcare,education,building.industrial,production";

  const apiKey = process.env.GEOAPIFY_API_KEY || searchParams.get("api_key");

  if (!apiKey) {
    return NextResponse.json(
      { error: "GEOAPIFY_API_KEY is not configured in environment variables." },
      { status: 400 },
    );
  }

  if (!lat || !lon) {
    return NextResponse.json(
      { error: "Missing required query parameters: lat, lon" },
      { status: 400 },
    );
  }

  try {
    // Geoapify filter circle format: circle:longitude,latitude,radiusInMeters
    const circleFilter = `circle:${lon},${lat},${radius}`;
    const proximityBias = `proximity:${lon},${lat}`;
    const url = `${GEOAPIFY_PLACES_BASE}?categories=${encodeURIComponent(
      categories,
    )}&filter=${encodeURIComponent(circleFilter)}&bias=${encodeURIComponent(
      proximityBias,
    )}&limit=200&apiKey=${apiKey}`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "DelhiEnvironmentalPlatform/1.0",
      },
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      console.error("[Geoapify Places API Error]", res.status, errorText);
      return NextResponse.json(
        {
          error: `Geoapify Places API returned HTTP ${res.status}`,
          details: errorText,
        },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    console.error("[Geoapify Proxy Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
