import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

// Simple in-memory cache for queries (15 minute TTL)
const queryCache = new Map<string, { timestamp: number; data: any }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 mins

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();

    if (!query) {
      return NextResponse.json(
        { error: "Missing query parameter" },
        { status: 400 },
      );
    }

    // Check cache
    const cached = queryCache.get(query);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      console.log("[Overpass Proxy] Cache hit for query!");
      return NextResponse.json(cached.data);
    }

    // Race mirrors, but treat an aborted/failed losing mirror as expected. Only
    // write a diagnostic when every mirror is unavailable.
    const controllers = new Map<string, AbortController>();
    const failures: string[] = [];
    let winner: string | null = null;

    const mirrorPromises = OVERPASS_MIRRORS.map(async (mirrorUrl) => {
      const controller = new AbortController();
      controllers.set(mirrorUrl, controller);
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

      try {
        const start = Date.now();
        const res = await fetch(mirrorUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "application/json, text/javascript, */*; q=0.01",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DelhiEnvironmentalPlatform/1.0",
          },
          body: new URLSearchParams({ data: query }),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const elapsed = Date.now() - start;

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!winner) {
          winner = mirrorUrl;
          for (const [otherUrl, otherController] of controllers) {
            if (otherUrl !== mirrorUrl) otherController.abort();
          }
        }
        return data;
      } catch (err: any) {
        // Losing races are deliberately aborted after the first success and
        // must not flood the server console with stack traces.
        if (!winner) {
          failures.push(`${new URL(mirrorUrl).hostname}: ${err.name === "AbortError" ? "timeout" : err.message}`);
        }
        throw err;
      } finally {
        clearTimeout(timeoutId);
      }
    });

    try {
      const data = await Promise.any(mirrorPromises);

      // Cache result
      queryCache.set(query, { timestamp: Date.now(), data });
      if (queryCache.size > 200) {
        const oldestKey = queryCache.keys().next().value;
        if (oldestKey) queryCache.delete(oldestKey);
      }

      return NextResponse.json(data);
    } catch (aggregateErr: any) {
      const errors = failures.length > 0 ? failures : ["No Overpass response"];
      console.warn(`[Overpass Proxy] All ${OVERPASS_MIRRORS.length} mirrors failed: ${errors.join("; ")}`);
      return NextResponse.json(
        {
          error: "All Overpass server mirrors failed or timed out.",
          details: errors,
        },
        { status: 504 },
      );
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
