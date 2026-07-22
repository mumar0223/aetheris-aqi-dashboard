/**
 * Forecast calibration helpers.
 *
 * The ML model learns the hourly shape from its covariates, while CPCB is the
 * authoritative value for the level at the selected station. These helpers
 * align the model's last historical point and all predictions to that official
 * level without fabricating or recalculating the CPCB AQI itself.
 */

export function isValidAqi(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 500;
}

export function clampAqi(value: number): number {
  return Math.round(Math.min(500, Math.max(0, value)) * 10) / 10;
}

export function alignHistoryToOfficialAqi(history: number[], officialAqi: number): number[] {
  const validHistory = history.filter(isValidAqi);
  if (!isValidAqi(officialAqi)) return validHistory;
  if (validHistory.length === 0) return Array.from({ length: 24 }, () => officialAqi);

  const correction = officialAqi - validHistory[validHistory.length - 1];
  return validHistory.map((value) => clampAqi(value + correction));
}

type ForecastPoint = { value?: unknown; p10?: unknown; p50?: unknown; p90?: unknown };
type ForecastPayload = {
  current_aqi?: unknown;
  hourly?: unknown;
  forecast_values?: unknown;
  confidence_lower?: unknown;
  confidence_upper?: unknown;
  forecasts?: Record<string, ForecastPoint>;
  [key: string]: unknown;
};

function numericArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers = value.map((item) => (typeof item === "number" ? item : Number(item)));
  return numbers.every((item) => Number.isFinite(item)) ? numbers : null;
}

/** Align a model response to the selected station's official CPCB AQI. */
export function calibrateForecastToOfficialAqi(
  payload: ForecastPayload,
  officialAqi: number | undefined,
): ForecastPayload {
  if (!isValidAqi(officialAqi)) return payload;

  // The first hourly forecast is the model's actual starting level. Some
  // backends report a correct current_aqi but accidentally emit a zero-valued
  // forecast array; using the first forecast prevents a 55 -> 0 discontinuity.
  const primarySeries = numericArray(payload.hourly) ?? numericArray(payload.forecast_values);
  const modelCurrent = typeof payload.current_aqi === "number" && Number.isFinite(payload.current_aqi)
    ? payload.current_aqi
    : 0;
  const modelBaseline = primarySeries && primarySeries.length > 0
    ? primarySeries[0]
    : modelCurrent;
  const correction = officialAqi - modelBaseline;
  const calibrate = (value: unknown) => {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? clampAqi(numeric + correction) : value;
  };
  const calibrateSeries = (value: unknown) => numericArray(value)?.map(calibrate) ?? value;

  const calibrated: ForecastPayload = {
    ...payload,
    current_aqi: officialAqi,
    official_current_aqi: officialAqi,
    level_calibration: "official-cpcb",
    hourly: calibrateSeries(payload.hourly),
    forecast_values: calibrateSeries(payload.forecast_values),
    confidence_lower: calibrateSeries(payload.confidence_lower),
    confidence_upper: calibrateSeries(payload.confidence_upper),
  };

  if (payload.forecasts) {
    calibrated.forecasts = Object.fromEntries(
      Object.entries(payload.forecasts).map(([horizon, point]) => [
        horizon,
        {
          ...point,
          value: calibrate(point.value),
          p10: calibrate(point.p10),
          p50: calibrate(point.p50),
          p90: calibrate(point.p90),
        },
      ]),
    );
  }

  return calibrated;
}
