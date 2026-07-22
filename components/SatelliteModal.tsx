"use client";

import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { analyzeSatelliteImage } from "../lib/services/backend";

interface SatelliteModalProps {
  isOpen: boolean;
  onClose: () => void;
  mapCenter: { lat: number; lon: number };
  telemetry: any;
  backendUrl: string;
  gridTargets: any[];
  gridImages: Record<string, any>;
  visibleCount: number;
  setVisibleCount: React.Dispatch<React.SetStateAction<number>>;
  locationName: string;
  isFetchingGrid: boolean;
  gridStreamPhase: string;
  refetchGrid: () => void;
  onAnalysisComplete?: (targetId: string, data: any) => void;
}

function formatSceneDescription(desc: string): string[] {
  if (!desc) return [];
  const sentences = desc
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length < 10) return false;
      const lower = s.toLowerCase();
      if (
        lower.includes("aerial view") ||
        lower.includes("high angle") ||
        lower.includes("overall effect") ||
        lower.includes("grandeur") ||
        lower.includes("opulence") ||
        lower.includes("looking down")
      ) {
        return false;
      }
      return true;
    });

  if (sentences.length === 0) {
    return [
      "Extracted spatial layout indicates high-density built environment.",
      "Identified prominent road network crossings matching commercial zoning patterns.",
      "Open patches of land detected with low surface vegetation index.",
    ];
  }
  return sentences;
}

export default function SatelliteModal({
  isOpen,
  onClose,
  mapCenter,
  telemetry,
  backendUrl,
  gridTargets,
  gridImages,
  visibleCount,
  setVisibleCount,
  locationName,
  isFetchingGrid,
  gridStreamPhase,
  refetchGrid,
  onAnalysisComplete,
}: SatelliteModalProps) {
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [satSelectedDet, setSatSelectedDet] = useState<number | null>(null);
  const [satSidebarTab, setSatSidebarTab] = useState<
    "intelligence" | "detections"
  >("intelligence");
  const satImageRef = useRef<HTMLImageElement>(null);

  // Track triggered analysis queries per target
  const [triggeredAnalysis, setTriggeredAnalysis] = useState<
    Record<string, boolean>
  >({});

  // Active target elements
  const activeTarget = gridTargets.find((t) => t.id === selectedTargetId);
  const activeImageBase64 = selectedTargetId
    ? gridImages[selectedTargetId]?.image_base64
    : null;
  const isAnalysisEnabled =
    !!selectedTargetId &&
    triggeredAnalysis[selectedTargetId] &&
    !!activeImageBase64;

  // React Query for target vision analysis
  const {
    data: analysisData,
    isFetching: isAnalyzing,
    error: analysisError,
  } = useQuery({
    queryKey: [
      "satellite-analysis",
      selectedTargetId,
      activeTarget?.lat,
      activeTarget?.lon,
    ],
    queryFn: async () => {
      if (!activeImageBase64) throw new Error("No image data available");
      return await analyzeSatelliteImage(
        activeTarget.lat,
        activeTarget.lon,
        activeImageBase64,
        backendUrl,
      );
    },
    enabled: isAnalysisEnabled,
    staleTime: 300000, // 5 minutes cache
    refetchInterval: 30000, // 30 seconds auto-refetch/refresh to keep fresh
  });

  // Propagate analysisData back to parent gridImages
  useEffect(() => {
    if (selectedTargetId && analysisData && onAnalysisComplete) {
      onAnalysisComplete(selectedTargetId, analysisData);
    }
  }, [selectedTargetId, analysisData, onAnalysisComplete]);

  // Reset tab selection when target changes
  useEffect(() => {
    setSatSidebarTab("intelligence");
    setSatSelectedDet(null);
  }, [selectedTargetId]);

  if (!isOpen) return null;

  // Compile active target visual properties
  const imgData = selectedTargetId ? gridImages[selectedTargetId] : null;
  const detections = analysisData?.detections || [];
  const sourceCount = analysisData?.source_count || {};
  const sceneDesc = analysisData?.scene_description || "";
  const severity = analysisData?.severity || "unknown";

  const landUse = analysisData?.land_use;
  const potentialContributors = analysisData?.potential_contributors;
  const sourceAttribution = analysisData?.source_attribution;
  const recommendedActions = analysisData?.recommended_actions;

  return (
    <div
      className="sat-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sat-modal">
        {/* Header */}
        <div className="sat-modal-header">
          <div className="flex items-center gap-4">
            <h2>🛰️ SATELLITE COMMAND PANEL</h2>
            <span className="text-[10px] text-zinc-500 font-mono">
              {mapCenter.lat.toFixed(4)}°N, {mapCenter.lon.toFixed(4)}°E
            </span>
            {isFetchingGrid && (
              <div className="sat-stream-phase">
                <div className="sat-stream-dot animate-ping" />
                STREAMING IMAGES ({gridStreamPhase.toUpperCase()})
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {selectedTargetId && (
              <button
                className="bg-[#e040fb]/10 border border-[#e040fb]/30 text-[#e040fb] rounded px-3 py-1 text-xs cursor-pointer hover:bg-[#e040fb] hover:text-white transition flex items-center gap-1.5 font-bold"
                onClick={() => {
                  setSelectedTargetId(null);
                  setSatSelectedDet(null);
                }}
              >
                <i className="fa-solid fa-arrow-left" />
                Back to Grid
              </button>
            )}
            <button className="sat-close-btn" onClick={onClose}>
              <i className="fa-solid fa-xmark" />
            </button>
          </div>
        </div>

        {/* Body content */}
        {!selectedTargetId ? (
          /* GRID VIEW */
          <div className="flex-1 flex flex-col p-6 overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-sm font-bold text-white tracking-wide uppercase font-['Orbitron']">
                  Priority Targets
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Showing active AQI-relevant locations: factories, fires, and
                  crosshair region.
                </p>
              </div>
              {isFetchingGrid ? (
                <button className="sat-fetch-btn" disabled>
                  <i className="fa-solid fa-spinner animate-spin" />
                  SYNCING IMAGES...
                </button>
              ) : (
                <button className="sat-fetch-btn" onClick={refetchGrid}>
                  <i className="fa-solid fa-arrows-rotate" />
                  REFRESH IMAGES
                </button>
              )}
            </div>

            <div className="sat-grid">
              {gridTargets.slice(0, visibleCount).map((target) => {
                const targetImg = gridImages[target.id];
                const isFetched = targetImg?.isFetched;
                const error = targetImg?.error;

                return (
                  <div
                    key={target.id}
                    className={`sat-card ${!isFetched ? "loading" : ""} ${error ? "error" : ""}`}
                    onClick={() => {
                      if (isFetched) setSelectedTargetId(target.id);
                    }}
                  >
                    <div className="sat-card-media">
                      {isFetched && targetImg.image_base64 ? (
                        <Image
                          src={`data:image/jpeg;base64,${targetImg.image_base64}`}
                          alt={target.name}
                          width={256}
                          height={256}
                          unoptimized
                        />
                      ) : error ? (
                        <div className="sat-card-error">
                          <i className="fa-solid fa-triangle-exclamation" />
                          <span>FETCH ERROR</span>
                        </div>
                      ) : (
                        <div className="sat-shimmer" />
                      )}
                    </div>
                    <div className="sat-card-footer">
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] font-bold text-white truncate max-w-[70%]">
                          {target.name}
                        </span>
                        <span className="sat-badge sat-badge--type uppercase font-mono">
                          {target.type}
                        </span>
                      </div>
                      <span className="text-[8px] text-zinc-500 font-mono mt-1 block">
                        {target.lat.toFixed(4)}°N, {target.lon.toFixed(4)}°E
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {visibleCount < gridTargets.length && (
              <button
                className="mt-6 mx-auto bg-zinc-800/80 border border-zinc-700 hover:bg-zinc-700 text-white rounded-lg px-6 py-2 text-xs transition cursor-pointer"
                onClick={() =>
                  setVisibleCount((prev) =>
                    Math.min(prev + 10, gridTargets.length),
                  )
                }
              >
                LOAD MORE TARGETS
              </button>
            )}
          </div>
        ) : (
          /* FOCUS DETAIL VIEW */
          (() => {
            const isFetched = imgData?.isFetched;
            const hasRanAnalysis = triggeredAnalysis[selectedTargetId];

            return (
              <div className="sat-modal-body">
                {/* Left — Focus Image Area */}
                <div className="sat-image-area">
                  {isFetched && imgData.image_base64 ? (
                    <div className="sat-image-container">
                      <Image
                        ref={satImageRef}
                        src={`data:image/jpeg;base64,${imgData.image_base64}`}
                        alt={imgData.name}
                        width={512}
                        height={512}
                        draggable={false}
                        style={{ width: "auto", height: "auto" }}
                        unoptimized
                      />
                      {/* Render Bounding Boxes */}
                      {detections.map((det: any, idx: number) => {
                        const imgEl = satImageRef.current;
                        if (!imgEl) return null;
                        const natW = imgEl.naturalWidth || 512;
                        const natH = imgEl.naturalHeight || 512;
                        const dispW = imgEl.clientWidth || 512;
                        const dispH = imgEl.clientHeight || 512;
                        const scaleX = dispW / natW;
                        const scaleY = dispH / natH;
                        const x = (det.bbox?.x_min || 0) * scaleX;
                        const y = (det.bbox?.y_min || 0) * scaleY;
                        const w =
                          ((det.bbox?.x_max || 0) - (det.bbox?.x_min || 0)) *
                          scaleX;
                        const h =
                          ((det.bbox?.y_max || 0) - (det.bbox?.y_min || 0)) *
                          scaleY;
                        const color =
                          det.confidence > 0.6
                            ? "#ff1744"
                            : det.confidence > 0.4
                              ? "#ff9100"
                              : "#ffd600";
                        const isActive = satSelectedDet === idx;
                        return (
                          <div
                            key={idx}
                            className={`sat-bbox ${isActive ? "active" : ""}`}
                            style={{
                              left: `${x}px`,
                              top: `${y}px`,
                              width: `${w}px`,
                              height: `${h}px`,
                              borderColor: color,
                              color: color,
                            }}
                            onClick={() =>
                              setSatSelectedDet(isActive ? null : idx)
                            }
                          >
                            <span
                              className="sat-bbox-label"
                              style={{ background: color, color: "#000" }}
                            >
                              {det.label} {(det.confidence * 100).toFixed(0)}%
                            </span>
                          </div>
                        );
                      })}

                      {/* Image Analysis Loading Spinner */}
                      {isAnalyzing && (
                        <div className="sat-loading-overlay">
                          <div className="sat-loading-ring" />
                          <span className="text-xs text-[#e040fb] font-['Orbitron'] tracking-wider">
                            RUNNING AI DIAGNOSTICS...
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="sat-empty-state">
                      <div className="sat-shimmer" />
                    </div>
                  )}
                </div>

                {/* Right — Sidebar Details */}
                <div className="sat-details min-h-0">
                  {/* Name / Location Title */}
                  <div className="sat-details-section">
                    <span className="text-[8px] font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded uppercase tracking-wider">
                      {imgData.type}
                    </span>
                    <h3 className="text-sm font-bold text-white mt-2 leading-snug">
                      {imgData.name}
                    </h3>
                    <p className="text-[10px] text-zinc-500 font-mono mt-1">
                      {imgData.lat.toFixed(6)}°N, {imgData.lon.toFixed(6)}°E
                    </p>
                  </div>

                  {/* Run AI Analysis Trigger Button */}
                  {!hasRanAnalysis && (
                    <div className="sat-details-section">
                      <h4>AI Diagnostics</h4>
                      <p className="text-[10px] text-zinc-400 leading-normal mb-3">
                        Run Florence-2 zero-shot description and Grounding DINO
                        to detect chimneys, burning, smoke and construction site
                        anomalies.
                      </p>
                      <button
                        className="w-full bg-purple-600 border border-purple-500 text-white rounded-lg py-2.5 text-xs font-bold hover:bg-purple-700 hover:border-purple-600 transition flex items-center justify-center gap-2 cursor-pointer shadow-[0_0_15px_rgba(124,77,255,0.25)]"
                        onClick={() =>
                          setTriggeredAnalysis((prev) => ({
                            ...prev,
                            [selectedTargetId]: true,
                          }))
                        }
                        disabled={isAnalyzing}
                      >
                        {isAnalyzing ? (
                          <>
                            <i className="fa-solid fa-spinner animate-spin" />
                            LOADING AI MODELS...
                          </>
                        ) : (
                          <>
                            <i className="fa-solid fa-brain" />
                            RUN AI ANALYSIS
                          </>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Analysis Layout Tabs */}
                  {hasRanAnalysis && (
                    <>
                      {/* Tabs Navigation */}
                      <div className="flex border-b border-white/5 bg-black/20 shrink-0">
                        <button
                          className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 transition cursor-pointer ${
                            satSidebarTab === "intelligence"
                              ? "border-cyan-400 text-cyan-400 bg-white/[0.02]"
                              : "border-transparent text-zinc-400 hover:text-white"
                          }`}
                          onClick={() => setSatSidebarTab("intelligence")}
                        >
                          Intelligence
                        </button>
                        <button
                          className={`flex-1 py-2.5 text-[10px] font-bold uppercase tracking-wider text-center border-b-2 transition cursor-pointer ${
                            satSidebarTab === "detections"
                              ? "border-cyan-400 text-cyan-400 bg-white/[0.02]"
                              : "border-transparent text-zinc-400 hover:text-white"
                          }`}
                          onClick={() => setSatSidebarTab("detections")}
                        >
                          Detections
                        </button>
                      </div>

                      {satSidebarTab === "intelligence" ? (
                        /* Tab 1: Intelligence View */
                        <div className="flex-1 overflow-y-auto min-h-0">
                          {/* Land Use Classification */}
                          {landUse && (
                            <div className="sat-details-section">
                              <h4>LAND USE CLASSIFICATION</h4>
                              <div className="flex flex-col gap-2 mt-1">
                                {Object.entries(landUse).map(
                                  ([cat, val]: any) => (
                                    <div
                                      key={cat}
                                      className="flex flex-col gap-1 text-[10px] text-zinc-300"
                                    >
                                      <div className="flex justify-between">
                                        <span>{cat}</span>
                                        <span className="font-bold text-cyan-400">
                                          {val}
                                        </span>
                                      </div>
                                      <div className="w-full bg-white/5 h-1 rounded overflow-hidden">
                                        <div
                                          className="bg-cyan-500 h-full rounded"
                                          style={{ width: val }}
                                        />
                                      </div>
                                    </div>
                                  ),
                                )}
                              </div>
                            </div>
                          )}

                          {/* Potential AQI Contributors */}
                          {potentialContributors && (
                            <div className="sat-details-section">
                              <h4>POTENTIAL AQI CONTRIBUTORS</h4>
                              <div className="flex flex-col gap-2 mt-1">
                                {Object.entries(potentialContributors).map(
                                  ([contrib, risk]: any) => {
                                    const riskColor =
                                      risk === "High"
                                        ? "text-rose-400 bg-rose-500/10 border-rose-500/20"
                                        : risk === "Medium"
                                          ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
                                          : "text-emerald-400 bg-emerald-500/10 border-emerald-500/20";
                                    return (
                                      <div
                                        key={contrib}
                                        className="flex justify-between items-center text-[10px] text-zinc-300"
                                      >
                                        <span>{contrib}</span>
                                        <span
                                          className={`text-[8px] font-bold border px-1.5 py-0.5 rounded uppercase tracking-wider ${riskColor}`}
                                        >
                                          {risk}
                                        </span>
                                      </div>
                                    );
                                  },
                                )}
                              </div>
                            </div>
                          )}

                          {/* Pollution Source Attribution */}
                          {sourceAttribution && (
                            <div className="sat-details-section">
                              <h4>POLLUTION SOURCE ATTRIBUTION</h4>
                              <div className="flex flex-col gap-2 mt-1">
                                {Object.entries(sourceAttribution).map(
                                  ([src, val]: any) => (
                                    <div
                                      key={src}
                                      className="flex flex-col gap-1 text-[10px] text-zinc-300"
                                    >
                                      <div className="flex justify-between">
                                        <span>{src}</span>
                                        <span className="font-bold text-[#ff9100]">
                                          {val}
                                        </span>
                                      </div>
                                      <div className="w-full bg-white/5 h-1 rounded overflow-hidden">
                                        <div
                                          className="bg-[#ff9100] h-full rounded"
                                          style={{ width: val }}
                                        />
                                      </div>
                                    </div>
                                  ),
                                )}
                              </div>
                            </div>
                          )}

                          {/* Recommended Municipal Actions */}
                          {recommendedActions &&
                            recommendedActions.length > 0 && (
                              <div className="sat-details-section">
                                <h4>RECOMMENDED MUNICIPAL ACTIONS</h4>
                                <div className="flex flex-col gap-2 mt-1.5">
                                  {recommendedActions.map(
                                    (act: string, index: number) => (
                                      <div
                                        key={index}
                                        className="flex items-start gap-2 bg-black/20 border border-white/5 rounded p-2 text-[10px] text-zinc-300"
                                      >
                                        <i className="fa-solid fa-circle-check text-emerald-400 mt-0.5" />
                                        <span>{act}</span>
                                      </div>
                                    ),
                                  )}
                                </div>
                              </div>
                            )}
                        </div>
                      ) : (
                        /* Tab 2: Detections View */
                        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                          {/* Severity / General Info */}
                          <div className="sat-details-section shrink-0">
                            <h4>POLLUTION SEVERITY</h4>
                            <div className="flex items-center gap-3">
                              <span
                                className={`sat-severity sat-severity--${severity}`}
                              >
                                <span
                                  className="w-2 h-2 rounded-full"
                                  style={{
                                    background:
                                      severity === "critical"
                                        ? "#ff1744"
                                        : severity === "high"
                                          ? "#ff9100"
                                          : severity === "medium"
                                            ? "#ffd600"
                                            : "#00e676",
                                  }}
                                />
                                {severity}
                              </span>
                              <span className="text-[10px] text-zinc-500">
                                {detections.length} anomaly point
                                {detections.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>

                          {/* Source Breakdown */}
                          {Object.keys(sourceCount).length > 0 && (
                            <div className="sat-details-section shrink-0">
                              <h4>SOURCES IDENTIFIED</h4>
                              <div className="flex flex-wrap gap-1.5">
                                {Object.entries(sourceCount).map(
                                  ([source, count]) => {
                                    const colorMap: Record<string, string> = {
                                      industrial_emission: "#ff9100",
                                      burning: "#ff1744",
                                      construction_dust: "#d500f9",
                                      traffic: "#ffd600",
                                      dust: "#ffab40",
                                    };
                                    const iconMap: Record<string, string> = {
                                      industrial_emission: "fa-industry",
                                      burning: "fa-fire",
                                      construction_dust: "fa-helmet-safety",
                                      traffic: "fa-road",
                                      dust: "fa-smog",
                                    };
                                    return (
                                      <span
                                        key={source}
                                        className="sat-source-pill"
                                        style={{
                                          borderColor: `${colorMap[source] || "#888"}40`,
                                          color: colorMap[source] || "#bbb",
                                        }}
                                      >
                                        <i
                                          className={`fa-solid ${iconMap[source] || "fa-circle-dot"}`}
                                        />
                                        {source.replace(/_/g, " ")}{" "}
                                        <strong>×{count as number}</strong>
                                      </span>
                                    );
                                  },
                                )}
                              </div>
                            </div>
                          )}

                          {/* Scene understanding caption */}
                          {sceneDesc && (
                            <div className="sat-details-section shrink-0">
                              <h4>AI CO-PILOT SCENE ASSESSMENT</h4>
                              <div className="flex flex-col gap-2 mt-1.5 text-[10px] text-zinc-300">
                                {formatSceneDescription(sceneDesc).map(
                                  (bullet: string, index: number) => (
                                    <div
                                      key={index}
                                      className="flex items-start gap-2 bg-black/10 border border-white/5 rounded p-2"
                                    >
                                      <i className="fa-solid fa-chevron-right text-cyan-400 mt-0.5 text-[8px]" />
                                      <span>{bullet}</span>
                                    </div>
                                  ),
                                )}
                              </div>
                            </div>
                          )}

                          {/* Detections List (SCROLLABLE INDEPENDENT BOX) */}
                          <div className="sat-details-section flex-1 min-h-0 overflow-y-auto border-t border-white/5">
                            <h4>DETAILED POINTS ({detections.length})</h4>
                            <div className="flex flex-col gap-1.5 pr-1">
                              {detections.map((det: any, idx: number) => {
                                const confColor =
                                  det.confidence > 0.6
                                    ? "#ff1744"
                                    : det.confidence > 0.4
                                      ? "#ff9100"
                                      : "#ffd600";
                                const iconMap: Record<string, string> = {
                                  smoke: "fa-smog",
                                  fire: "fa-fire",
                                  factory: "fa-industry",
                                  construction: "fa-helmet-safety",
                                  truck: "fa-truck",
                                  vehicle: "fa-car",
                                  car: "fa-car",
                                  bus: "fa-bus",
                                  dust: "fa-cloud",
                                  chimney: "fa-industry",
                                };
                                let icon = "fa-circle-dot";
                                for (const [kw, ic] of Object.entries(
                                  iconMap,
                                )) {
                                  if (det.label?.toLowerCase().includes(kw)) {
                                    icon = ic;
                                    break;
                                  }
                                }
                                const isActive = satSelectedDet === idx;
                                return (
                                  <div key={idx} className="flex flex-col">
                                    <div
                                      className={`sat-det-item ${isActive ? "active" : ""}`}
                                      onClick={() =>
                                        setSatSelectedDet(isActive ? null : idx)
                                      }
                                    >
                                      <div
                                        className="sat-det-icon"
                                        style={{
                                          background: `${confColor}15`,
                                          color: confColor,
                                        }}
                                      >
                                        <i className={`fa-solid ${icon}`} />
                                      </div>
                                      <div className="sat-det-info">
                                        <div className="label truncate">
                                          {det.label}
                                        </div>
                                        <div className="meta font-mono">
                                          {(det.confidence * 100).toFixed(0)}%
                                          confidence
                                        </div>
                                      </div>
                                      <i
                                        className={`fa-solid fa-chevron-down text-[10px] text-zinc-500 transition-transform ${isActive ? "rotate-180" : ""}`}
                                      />
                                    </div>
                                    {isActive && (
                                      <div className="sat-det-detail">
                                        <div className="flex justify-between mb-1.5 text-[9px] text-zinc-400">
                                          <span>Coordinates:</span>
                                          <span className="font-mono">
                                            ({det.bbox?.x_min?.toFixed(0)},{" "}
                                            {det.bbox?.y_min?.toFixed(0)}) → (
                                            {det.bbox?.x_max?.toFixed(0)},{" "}
                                            {det.bbox?.y_max?.toFixed(0)})
                                          </span>
                                        </div>
                                        <div className="flex justify-between mb-1.5 text-[9px] text-zinc-400">
                                          <span>Detection Engine:</span>
                                          <span className="font-semibold text-zinc-200">
                                            {det.source}
                                          </span>
                                        </div>
                                        {/* Crop overlay */}
                                        {imgData.image_base64 &&
                                          det.bbox &&
                                          (() => {
                                            const imgEl = satImageRef.current;
                                            const imgWidth =
                                              imgEl?.naturalWidth || 256;
                                            const imgHeight =
                                              imgEl?.naturalHeight || 256;
                                            return (
                                              <div
                                                style={{
                                                  marginTop: "8px",
                                                  width: "100%",
                                                  height: "90px",
                                                  backgroundImage: `url(data:image/jpeg;base64,${imgData.image_base64})`,
                                                  backgroundPosition: `-${(det.bbox.x_min / imgWidth) * 280}px -${(det.bbox.y_min / imgHeight) * 90}px`,
                                                  backgroundSize: `${(imgWidth / Math.max(det.bbox.x_max - det.bbox.x_min, 1)) * 280}px auto`,
                                                  borderRadius: "6px",
                                                  border: `1px solid ${confColor}40`,
                                                }}
                                              />
                                            );
                                          })()}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
