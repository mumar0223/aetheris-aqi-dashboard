import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const latStr = searchParams.get("lat");
  const lonStr = searchParams.get("lon");
  const apiKey = searchParams.get("key") || process.env.NASA_FIRMS_API_KEY || "";

  if (!latStr || !lonStr) {
    return NextResponse.json(
      { error: "Missing required query parameters: lat, lon" },
      { status: 400 },
    );
  }

  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  try {
    const area = `${lon - 0.5},${lat - 0.5},${lon + 0.5},${lat + 0.5}`;
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/VIIRS_SNPP_NRT/${area}/1`;

    const res = await fetch(url, {
      headers: {
        "User-Agent": "DelhiEnvironmentalPlatform/1.0",
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[NASA FIRMS Proxy Error] HTTP ${res.status}:`, errText);
      return NextResponse.json(
        { error: `NASA FIRMS HTTP ${res.status}`, details: errText },
        { status: res.status },
      );
    }

    const csvText = await res.text();
    return new NextResponse(csvText, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  } catch (err: any) {
    console.error("[NASA FIRMS Proxy Error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
