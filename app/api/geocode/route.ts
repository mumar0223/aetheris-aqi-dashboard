import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const GEOAPIFY_GEOCODE_URL = "https://api.geoapify.com/v1/geocode/search";
const CACHE_TTL_MS = 15 * 60 * 1000;
const searchCache = new Map<string, { timestamp: number; results: CitySearchResult[] }>();

export interface CitySearchResult {
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
}

interface GeoapifyResult {
  formatted?: string;
  name?: string;
  city?: string;
  state?: string;
  country_code?: string;
  lat?: number;
  lon?: number;
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q")?.trim() || "";
  if (query.length < 2 || query.length > 80) {
    return NextResponse.json({ error: "Enter 2 to 80 characters to search cities." }, { status: 400 });
  }

  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEOAPIFY_API_KEY is not configured." }, { status: 503 });
  }

  const cacheKey = query.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ results: cached.results, cached: true });
  }

  const params = new URLSearchParams({
    text: query,
    type: "city",
    filter: "countrycode:in",
    format: "json",
    limit: "8",
    lang: "en",
    apiKey,
  });

  try {
    const response = await fetch(`${GEOAPIFY_GEOCODE_URL}?${params.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": "Aetheris/1.0" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Geoapify returned HTTP ${response.status}`);

    const payload = await response.json() as { results?: GeoapifyResult[] };
    const results = (payload.results || [])
      // Defence in depth: never return a non-Indian location even if the
      // provider ignores the request filter.
      .filter((result) => result.country_code?.toLowerCase() === "in")
      .flatMap((result): CitySearchResult[] => {
        if (!Number.isFinite(result.lat) || !Number.isFinite(result.lon)) return [];
        const city = result.city?.trim() || result.name?.trim();
        if (!city) return [];
        return [{
          name: result.formatted?.trim() || city,
          city,
          state: result.state?.trim() || "",
          lat: result.lat!,
          lon: result.lon!,
        }];
      });

    searchCache.set(cacheKey, { timestamp: Date.now(), results });
    if (searchCache.size > 100) searchCache.delete(searchCache.keys().next().value!);
    return NextResponse.json({ results, cached: false });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "City search is unavailable." },
      { status: 503 },
    );
  }
}
