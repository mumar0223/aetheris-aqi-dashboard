"use client";

import { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const histItem = payload.find((p: any) => p.dataKey === "historical");
    const predItem = payload.find((p: any) => p.dataKey === "predicted");
    const confItem = payload.find((p: any) => p.dataKey === "confidence");

    const historical = histItem ? histItem.value : null;
    const predicted = predItem ? predItem.value : null;
    const confidence = confItem ? confItem.value : null;

    return (
      <div className="bg-[#0a0c12]/95 border border-white/10 rounded-lg p-3 text-[11px] text-white shadow-xl flex flex-col gap-1.5 font-sans">
        <div className="font-bold text-zinc-400 font-mono border-b border-white/5 pb-1 mb-0.5">
          {label}
        </div>
        {historical !== null && historical !== undefined && (
          <div className="flex justify-between items-center gap-4">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#00e5ff]" />
              Historical AQI:
            </span>
            <strong className="text-white font-mono">{historical}</strong>
          </div>
        )}
        {predicted !== null && predicted !== undefined && (
          <div className="flex justify-between items-center gap-4">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff9100]" />
              Predicted AQI:
            </span>
            <strong className="text-white font-mono">{predicted}</strong>
          </div>
        )}
        {confidence && Array.isArray(confidence) && (
          <div className="flex justify-between items-center gap-4 mt-1 border-t border-white/5 pt-1">
            <span className="text-zinc-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded bg-[#ff9100]/25" />
              Interval Range (CI):
            </span>
            <strong className="text-orange-400 font-mono">
              {confidence[0]} — {confidence[1]}
            </strong>
          </div>
        )}
      </div>
    );
  }
  return null;
};

interface ForecastDialogProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: any;
  cityName: string;
  lat: number;
  lon: number;
  backendUrl: string;
}

export default function ForecastDialog({
  isOpen,
  onClose,
  telemetry,
  cityName,
  lat,
  lon,
  backendUrl,
}: ForecastDialogProps) {
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: "user" | "agent"; content: string }>
  >([
    {
      role: "agent",
      content:
        "Forecast Intelligence Agent active. Click one of the action chips below or ask a question to run a diagnostic analysis.",
    },
  ]);
  const [inputVal, setInputVal] = useState("");
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentStatus, setAgentStatus] = useState<string>("");
  const [currentAqi, setCurrentAqi] = useState(150);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Initialize AQI from telemetry
  useEffect(() => {
    if (telemetry?.current_aqi) {
      setCurrentAqi(telemetry.current_aqi);
    }
  }, [telemetry]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, agentStatus]);

  if (!isOpen) return null;

  // Prepare chart data combining last 12h of historical data + 24h of predictions
  const prepChartData = () => {
    const data: any[] = [];
    const values = telemetry?.forecast?.forecast_values || [];
    const lower = telemetry?.forecast?.confidence_lower || [];
    const upper = telemetry?.forecast?.confidence_upper || [];

    // 1. Fill 12h historical data leading to NOW using actual current baseline trend
    const historicalSeries = [];
    const baseVal = telemetry?.current_aqi || 150;
    const histData = telemetry?.historical_aqi || [];

    for (let i = 12; i > 0; i--) {
      const valIdx = histData.length - 1 - i;
      const historicalVal = valIdx >= 0 ? histData[valIdx] : baseVal;
      historicalSeries.push({
        name: `-${i}h`,
        historical: historicalVal,
        predicted: null,
        confidence: null,
      });
    }
    data.push(...historicalSeries);

    // 2. NOW transition point
    data.push({
      name: "NOW",
      historical: baseVal,
      predicted: baseVal,
      confidence: [baseVal, baseVal],
    });

    // 3. Predicted points (+1h to +24h)
    for (let i = 0; i < Math.min(24, values.length); i++) {
      const val = values[i];
      const p10 = lower[i] || val * 0.85;
      const p90 = upper[i] || val * 1.15;
      data.push({
        name: `+${i + 1}h`,
        historical: null,
        predicted: Math.round(val),
        confidence: [Math.round(p10), Math.round(p90)],
      });
    }

    return data;
  };

  const chartData = prepChartData();

  async function triggerAgentAnalysis(prompt: string) {
    if (isAgentRunning) return;
    setIsAgentRunning(true);
    setAgentStatus("⚡ Initiating agent evaluation...");

    // Add user message if it's a manual input, otherwise keep chat clean
    const isAutoPrompt = prompt.includes("Analyze the 72-hour hyperlocal");
    if (!isAutoPrompt) {
      setChatMessages((prev) => [...prev, { role: "user", content: prompt }]);
    }

    try {
      const response = await fetch(`/api/agent/run-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, lat, lon }),
      });

      if (!response.ok) throw new Error("Agent disconnected");

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader");
      const decoder = new TextDecoder();
      let buffer = "";
      let reportText = "";

      // Add placeholder agent message for streaming output
      setChatMessages((prev) => [...prev, { role: "agent", content: "" }]);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === "text") {
              reportText += parsed.chunk;
              setChatMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "agent", content: reportText };
                return copy;
              });
            } else if (parsed.type === "timeline") {
              setAgentStatus(parsed.event);
            } else if (parsed.type === "workflow_step") {
              setAgentStatus(`Executing step: ${parsed.step}`);
            }
          } catch {
            // Skip non-JSON lines
          }
        }
      }
    } catch (err: any) {
      console.error(err);
      setChatMessages((prev) => [
        ...prev.slice(0, -1),
        {
          role: "agent",
          content: "⚠️ Error loading agent evaluation. Please try again.",
        },
      ]);
    } finally {
      setIsAgentRunning(false);
      setAgentStatus("");
    }
  }

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim() || isAgentRunning) return;
    const q = inputVal;
    setInputVal("");
    triggerAgentAnalysis(q);
  };

  // Determine forecast risk category
  const getRiskColor = (aqi: number) => {
    if (aqi <= 50) return "#10b981";
    if (aqi <= 100) return "#eab308";
    if (aqi <= 200) return "#f97316";
    return "#ef4444";
  };

  const currentAqiColor = getRiskColor(currentAqi);

  return (
    <div className="forecast-dialog-overlay">
      <div className="forecast-dialog-container">
        {/* HEADER */}
        <div className="forecast-dialog-header">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded bg-[#00e5ff]/10 border border-[#00e5ff]/20">
              <i className="fa-solid fa-clock-rotate-left text-[#00e5ff] text-base" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                AQI Forecasting & Intelligence Center
              </h2>
              <p className="text-[10px] text-zinc-400">
                {cityName} • Lat {lat.toFixed(4)}, Lon {lon.toFixed(4)} •
                Real-time Tabular Regression
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono rounded px-2 py-0.5 uppercase">
              XGBoost Model Live
            </span>
            <button className="forecast-dialog-close-btn" onClick={onClose}>
              <i className="fa-solid fa-xmark text-sm" />
            </button>
          </div>
        </div>

        {/* BODY */}
        <div className="forecast-dialog-body">
          {/* MAIN GRAPH & INTERVENTIONS */}
          <div className="forecast-main-content">
            {/* GRAPH SECTION */}
            <div className="forecast-chart-container">
              <h3 className="text-xs uppercase font-semibold text-zinc-400 tracking-wider flex items-center gap-2 mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00e5ff] animate-ping" />
                Hyperlocal AQI Projection (24h Window)
              </h3>

              <div className="forecast-chart-plot">
                <ResponsiveContainer
                  width="100%"
                  height={280}
                  minWidth={0}
                  minHeight={280}
                >
                  <AreaChart
                    data={chartData}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient
                        id="colorHistorical"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#00e5ff"
                          stopOpacity={0.25}
                        />
                        <stop
                          offset="95%"
                          stopColor="#00e5ff"
                          stopOpacity={0}
                        />
                      </linearGradient>
                      <linearGradient
                        id="colorPredicted"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#ff9100"
                          stopOpacity={0.25}
                        />
                        <stop
                          offset="95%"
                          stopColor="#ff9100"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>

                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.05)"
                    />
                    <XAxis
                      dataKey="name"
                      stroke="rgba(255,255,255,0.3)"
                      fontSize={9}
                    />
                    <YAxis
                      domain={[0, 500]}
                      stroke="rgba(255,255,255,0.3)"
                      fontSize={9}
                    />

                    <Tooltip content={<CustomTooltip />} />

                    {/* Colored background regions for NAQI bounds */}
                    <ReferenceArea
                      y1={0}
                      y2={50}
                      fill="rgba(16, 185, 129, 0.03)"
                    />
                    <ReferenceArea
                      y1={51}
                      y2={100}
                      fill="rgba(234, 179, 8, 0.03)"
                    />
                    <ReferenceArea
                      y1={101}
                      y2={200}
                      fill="rgba(249, 115, 22, 0.03)"
                    />
                    <ReferenceArea
                      y1={201}
                      y2={500}
                      fill="rgba(239, 68, 68, 0.03)"
                    />

                    <ReferenceLine
                      x="NOW"
                      stroke="#00e5ff"
                      strokeWidth={1.5}
                      strokeDasharray="3 3"
                      className="now-indicator-glow"
                      label={{
                        value: "NOW",
                        fill: "#00e5ff",
                        fontSize: 9,
                        position: "top",
                      }}
                    />

                    {/* Confidence Range Band */}
                    <Area
                      type="monotone"
                      dataKey="confidence"
                      stroke="none"
                      fill="#ff9100"
                      fillOpacity={0.08}
                    />

                    {/* Historical Area */}
                    <Area
                      type="monotone"
                      dataKey="historical"
                      stroke="#00e5ff"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorHistorical)"
                    />

                    {/* Predicted Area */}
                    <Area
                      type="monotone"
                      dataKey="predicted"
                      stroke="#ff9100"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      fillOpacity={1}
                      fill="url(#colorPredicted)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="flex justify-between items-center text-[10px] text-zinc-500 mt-2 px-1">
                <span>◀ 12h Historical Inputs</span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-1.5 border-t border-dashed border-[#ff9100]" />{" "}
                  Autoregressive XGBoost Projection ▶
                </span>
              </div>
            </div>

            {/* HORIZONTAL METRIC METADATA */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-black/20 border border-white/5 rounded-lg p-3">
                <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold block mb-1">
                  XGBoost Regressor Flagship
                </span>
                <h4 className="text-xs font-semibold text-white">
                  38 Covariates Integrated
                </h4>
                <p className="text-[10px] text-zinc-400 mt-1">
                  Combines meteorology, OpenWeather pollutants history, and
                  local traffic.
                </p>
              </div>

              <div className="bg-black/20 border border-white/5 rounded-lg p-3">
                <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold block mb-1">
                  Confidence Index
                </span>
                <h4 className="text-xs font-semibold text-emerald-400">
                  {telemetry?.forecast?.confidence
                    ? `${(telemetry.forecast.confidence * 100).toFixed(0)}%`
                    : "94%"}
                </h4>
                <p className="text-[10px] text-zinc-400 mt-1">
                  Statistically normalized variance based on recursive quantile
                  bounds.
                </p>
              </div>

              <div className="bg-black/20 border border-white/5 rounded-lg p-3">
                <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-bold block mb-1">
                  Trend Vectors
                </span>
                <h4 className="text-xs font-semibold text-orange-400 capitalize">
                  {telemetry?.forecast?.trend || "Stable"}
                </h4>
                <p className="text-[10px] text-zinc-400 mt-1">
                  Diurnal cyclic pattern correction indicates increasing morning
                  inversion.
                </p>
              </div>
            </div>

            {/* INTERVENTIONS & CITIZEN DIRECTIVES */}
            <div className="grid grid-cols-2 gap-4">
              {/* Citizen Advisory */}
              <div className="bg-[#0e1017]/40 border border-white/5 rounded-lg p-4 flex flex-col gap-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                  <i className="fa-solid fa-kit-medical text-[#00e5ff]" />
                  Citizen Health Advisory Directives
                </h4>

                <div className="flex flex-col gap-2.5 text-[11px] text-zinc-300">
                  <div className="flex items-start gap-2 bg-black/25 border border-white/5 rounded p-2">
                    <span className="text-[#00e5ff] font-bold">Masks:</span>
                    <span>
                      N95/N99 respirators strongly recommended for outdoor
                      exposure.
                    </span>
                  </div>
                  <div className="flex items-start gap-2 bg-black/25 border border-white/5 rounded p-2">
                    <span className="text-amber-400 font-bold">Activity:</span>
                    <span>
                      Reduce outdoor cardio / intense physical activities
                      between 07:00 - 10:00.
                    </span>
                  </div>
                  <div className="flex items-start gap-2 bg-black/25 border border-white/5 rounded p-2">
                    <span className="text-rose-400 font-bold">Schools:</span>
                    <span>
                      Indoor physical activity only. Air filtration triggers
                      active.
                    </span>
                  </div>
                </div>
              </div>

              {/* Intervention Action Plan */}
              <div className="bg-[#0e1017]/40 border border-white/5 rounded-lg p-4 flex flex-col gap-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                  <i className="fa-solid fa-shield-halved text-emerald-400" />
                  Dynamic Smart City Interventions
                </h4>

                <div className="flex flex-col gap-2.5 text-[11px] text-zinc-300">
                  <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
                    <span>Dust Suppression (Sprinklers)</span>
                    <span className="font-bold text-emerald-400 uppercase text-[9px] bg-emerald-500/10 px-1.5 rounded">
                      High Priority
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-b border-white/5 pb-1.5">
                    <span>Heavy Goods Vehicles Diversion</span>
                    <span className="font-bold text-amber-400 uppercase text-[9px] bg-amber-500/10 px-1.5 rounded">
                      Trigger 200 AQI
                    </span>
                  </div>
                  <div className="flex items-center justify-between pb-0.5">
                    <span>Solid Waste Open Burning Patrols</span>
                    <span className="font-bold text-emerald-400 uppercase text-[9px] bg-emerald-500/10 px-1.5 rounded">
                      Continuous
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* SIDEBAR: AI CO-PILOT DIAGNOSTIC CHAT */}
          <div className="forecast-agent-panel">
            <div className="p-3 bg-black/40 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <i className={`fa-solid fa-microchip-ai ${isAgentRunning ? "text-amber-400 animate-spin" : "text-[#00e5ff]"}`} />
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white flex items-center gap-2">
                    Forecast Evaluation Agent
                    {isAgentRunning && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] font-mono bg-[#00e5ff]/20 text-[#00e5ff] border border-[#00e5ff]/30 animate-pulse">
                        STREAMING
                      </span>
                    )}
                  </h4>
                  <p className="text-[9px] text-[#00e5ff] truncate max-w-[240px] font-mono">
                    {isAgentRunning ? agentStatus || "Live streaming diagnostic telemetry..." : "Live streaming diagnostic telemetry"}
                  </p>
                </div>
              </div>
            </div>

            {/* Chat message thread */}
            <div className="agent-chat-history">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={
                    msg.role === "user" ? "agent-msg-user" : "agent-msg-bot"
                  }
                >
                  {msg.content ? (
                    msg.role === "user" ? (
                      <span>{msg.content}</span>
                    ) : (
                      <div className="markdown-content leading-relaxed text-zinc-200">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-[#00e5ff] rounded-full animate-bounce" />
                      <span className="w-1.5 h-1.5 bg-[#00e5ff] rounded-full animate-bounce delay-100" />
                      <span className="w-1.5 h-1.5 bg-[#00e5ff] rounded-full animate-bounce delay-200" />
                    </div>
                  )}
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Action Chips */}
            <div className="p-2 border-t border-white/5 bg-black/10 flex flex-wrap gap-1">
              {[
                {
                  label: "Analyze Trend",
                  query:
                    "Can you analyze the 24-hour trends and identify if it is stable?",
                },
                {
                  label: "Check Peak Hours",
                  query:
                    "What are the peak hours of traffic and pollutant concentration?",
                },
                {
                  label: "Directives Plan",
                  query:
                    "What operational directives do you recommend for local smart city officers?",
                },
              ].map((chip, idx) => (
                <button
                  key={idx}
                  onClick={() => triggerAgentAnalysis(chip.query)}
                  disabled={isAgentRunning}
                  className="text-[9px] bg-white/5 border border-white/10 rounded px-1.5 py-0.5 hover:bg-[#00e5ff]/10 hover:border-[#00e5ff]/30 text-zinc-300 hover:text-[#00e5ff] cursor-pointer transition disabled:opacity-50"
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Chat Input form */}
            <form
              onSubmit={handleSend}
              className="p-3 border-t border-white/5 bg-black/35 flex gap-2"
            >
              <input
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                disabled={isAgentRunning}
                placeholder="Ask agent for a detailed operational action plan..."
                className="flex-1 bg-black/40 border border-white/10 rounded px-2.5 py-1.5 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-[#00e5ff]/50 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isAgentRunning || !inputVal.trim()}
                className="bg-[#00e5ff] text-black font-bold rounded px-3 py-1.5 text-xs hover:bg-[#00b0ff] cursor-pointer transition flex items-center justify-center disabled:opacity-50"
              >
                <i className="fa-solid fa-paper-plane" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
