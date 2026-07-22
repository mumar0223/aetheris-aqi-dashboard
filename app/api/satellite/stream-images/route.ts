import { NextRequest } from "next/server";

async function fetchEsriTile(lat: number, lon: number): Promise<string> {
  const z = 16;
  const x = Math.floor(((lon + 180) / 360) * Math.pow(2, z));
  const y = Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * Math.pow(2, z)
  );
  const tileUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
  const response = await fetch(tileUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch ESRI tile: HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

let _cachedToken = "";
let _tokenExpiry = 0;

async function fetchSentinelHubImage(
  lat: number,
  lon: number,
  clientId: string,
  clientSecret: string
): Promise<string> {
  let token = _cachedToken;
  if (!token || Date.now() >= _tokenExpiry - 60000) {
    const authRes = await fetch(
      "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
      }
    );
    if (!authRes.ok) {
      throw new Error(`Sentinel Hub Auth failed: ${authRes.status}`);
    }
    const authData = await authRes.json();
    token = authData.access_token;
    _cachedToken = token;
    _tokenExpiry = Date.now() + (authData.expires_in || 300) * 1000;
  }

  const delta = 0.01;
  const bbox = [lon - delta, lat - delta, lon + delta, lat + delta];
  const toDate = new Date().toISOString();
  const fromDate = new Date(Date.now() - 30 * 24 * 3600000).toISOString();

  const processRes = await fetch("https://services.sentinel-hub.com/api/v1/process", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: {
        bounds: {
          bbox: bbox,
          properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
        },
        data: [
          {
            type: "sentinel-2-l2a",
            dataFilter: {
              timeRange: { from: fromDate, to: toDate },
              mosaickingOrder: "leastCC",
            },
          },
        ],
      },
      output: {
        width: 512,
        height: 512,
        responses: [{ identifier: "default", format: { type: "image/jpeg" } }],
      },
      evalscript: `
        //VERSION=3
        function setup() {
          return {
            input: ["B04", "B03", "B02"],
            output: { bands: 3 }
          };
        }
        function evaluatePixel(sample) {
          return [2.5 * sample.B04, 2.5 * sample.B03, 2.5 * sample.B02];
        }
      `,
    }),
  });

  if (!processRes.ok) {
    throw new Error(`Sentinel Hub Process failed: HTTP ${processRes.status}`);
  }
  const buffer = await processRes.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

export async function POST(req: NextRequest) {
  try {
    const { targets } = await req.json();

    const planetInsightClientId = process.env.PLANET_INSIGHT_CLIENT_ID || "";
    const planetInsightClientSecret = process.env.PLANET_INSIGHT_CLIENT_SECRET || "";

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (const target of targets) {
          try {
            let imageBase64 = "";
            let source = "esri";

            if (planetInsightClientId && planetInsightClientSecret) {
              try {
                imageBase64 = await fetchSentinelHubImage(
                  target.lat,
                  target.lon,
                  planetInsightClientId,
                  planetInsightClientSecret
                );
                source = "sentinel_hub";
              } catch (err) {
                console.warn(`Sentinel Hub failed for ${target.name}, falling back to ESRI`, err);
              }
            }

            if (!imageBase64) {
              imageBase64 = await fetchEsriTile(target.lat, target.lon);
              source = "esri";
            }

            const payload = {
              id: target.id,
              name: target.name,
              lat: target.lat,
              lon: target.lon,
              type: target.type,
              image_base64: imageBase64,
              source: source,
            };

            controller.enqueue(encoder.encode(JSON.stringify(payload) + "\n"));
          } catch (err: any) {
            controller.enqueue(encoder.encode(
              JSON.stringify({ id: target.id, error: err.message || "Fetch error" }) + "\n"
            ));
          }
        }
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
