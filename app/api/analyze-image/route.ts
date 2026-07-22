import { NextRequest, NextResponse } from "next/server";
import { Client } from "@gradio/client";

export async function POST(req: NextRequest) {
  try {
    const { image_base64 } = await req.json();

    if (!image_base64) {
      return NextResponse.json({ error: "Missing image_base64 payload" }, { status: 400 });
    }

    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "";
    const hfToken = process.env.HF_TOKEN || process.env.NEXT_PUBLIC_HF_TOKEN || "";

    // Gradio Client (works on local app.py and deployed HF Space)
    const spaceId = process.env.HF_SPACE || "mohdumar0223/hackathon";

    console.log(`[API Analyze-Image Proxy] Connecting to Gradio: ${spaceId} (url: ${backendUrl})`);
    
    const client = await Client.connect(backendUrl.startsWith("http") ? backendUrl : spaceId, {
      token: hfToken as `hf_${string}` | undefined,
    });

    const base64Data = image_base64.replace(/^data:image\/\w+;base64,/, "");
    const imageBuffer = Buffer.from(base64Data, "base64");
    const imageBlob = new Blob([imageBuffer], { type: "image/png" });

    const result = await client.predict(1, [
      imageBlob
    ]);

    if (!result.data || !Array.isArray(result.data) || !result.data[1]) {
      throw new Error("Invalid response from Gradio space");
    }

    const successData = JSON.parse(result.data[1] as string);
    return NextResponse.json(successData);

  } catch (error: any) {
    console.error("[API Analyze-Image Proxy Error]:", error);
    return NextResponse.json({ error: error.message || "Vision analysis failed" }, { status: 500 });
  }
}
