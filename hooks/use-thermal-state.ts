/**
 * use-thermal-state.ts
 *
 * Derives a thermal zone and score from available device signals:
 *   - Screen brightness (high brightness = more GPU/CPU load)
 *   - Low Power Mode (if on, device is conserving — likely cooler)
 *   - Drain rate vs device baseline (elevated drain = heavy background load)
 *   - Device year class (older devices run hotter under load)
 *
 * iOS does not expose a direct thermal state API to third-party apps,
 * so we infer it from these correlated signals.
 *
 * Also exports `estimateInitialDrainRate` — used to produce an instant
 * drain rate estimate on first launch before any live samples are collected.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Platform } from "react-native";
import * as Battery from "expo-battery";
import * as Brightness from "expo-brightness";
import * as Device from "expo-device";
import type { ThermalZone } from "@/components/thermal-gauge";

export interface ThermalState {
  zone: ThermalZone;
  /** 0.0 – 1.0 normalised thermal score */
  score: number;
  /** Human-readable description of contributing factors */
  detail: string;
}

// Typical baseline drain rates (%/min) by device year class at moderate use.
// Source: empirical averages from battery benchmarks.
const BASELINE_BY_YEAR: Record<number, number> = {
  2024: 0.28,
  2023: 0.30,
  2022: 0.33,
  2021: 0.35,
  2020: 0.38,
  2019: 0.42,
  2018: 0.46,
};

function getBaseline(yearClass: number | null): number {
  if (!yearClass) return 0.38; // conservative default
  const years = Object.keys(BASELINE_BY_YEAR).map(Number).sort((a, b) => b - a);
  for (const y of years) {
    if (yearClass >= y) return BASELINE_BY_YEAR[y];
  }
  return 0.55; // older than 2018
}

/**
 * Produces an instant drain rate estimate (%/min) using device signals.
 * Used on first launch before any live samples are collected.
 */
export async function estimateInitialDrainRate(
  isLowPowerMode: boolean
): Promise<number> {
  if (Platform.OS === "web") return 0.35;

  const yearClass = Device.deviceYearClass;
  let base = getBaseline(yearClass);

  // Low Power Mode throttles CPU/GPU — drain is ~25% lower
  if (isLowPowerMode) base *= 0.75;

  // Read screen brightness — high brightness adds ~15% to drain
  let brightness = 0.5;
  try {
    brightness = await Brightness.getBrightnessAsync();
  } catch {
    // brightness unavailable — use midpoint
  }
  // Scale: 0.0 brightness = -10%, 1.0 brightness = +20%
  const brightnessMultiplier = 0.9 + brightness * 0.3;
  base *= brightnessMultiplier;

  return Math.round(base * 1000) / 1000; // 3 decimal places
}

/**
 * Derives the thermal zone from available signals.
 * Updates every 10 seconds.
 */
export function useThermalState(
  drainRatePerMin: number | null,
  isLowPowerMode: boolean
): ThermalState {
  const [thermal, setThermal] = useState<ThermalState>({
    zone: "cool",
    score: 0.1,
    detail: "Initialising...",
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const compute = useCallback(async () => {
    if (Platform.OS === "web") return;

    const yearClass = Device.deviceYearClass;
    const baseline = getBaseline(yearClass);

    let score = 0;
    const factors: string[] = [];

    // Signal 1: Screen brightness (0–0.3 contribution)
    let brightness = 0.5;
    try {
      brightness = await Brightness.getBrightnessAsync();
    } catch {
      // ignore
    }
    const brightnessScore = brightness * 0.3;
    score += brightnessScore;
    if (brightness > 0.75) factors.push("high screen brightness");

    // Signal 2: Drain rate vs baseline (0–0.5 contribution)
    if (drainRatePerMin !== null && drainRatePerMin > 0) {
      const ratio = drainRatePerMin / baseline;
      // ratio 1.0 = normal, 2.0+ = very hot
      const drainScore = Math.min((ratio - 1.0) * 0.5, 0.5);
      if (drainScore > 0) {
        score += drainScore;
        if (ratio > 1.5) factors.push("elevated drain rate");
      }
    }

    // Signal 3: Low Power Mode active (negative — device is cooler)
    if (isLowPowerMode) {
      score = Math.max(0, score - 0.15);
      factors.push("Low Power Mode active");
    }

    // Signal 4: Device age — older devices run hotter under same load
    if (yearClass && yearClass < 2020) {
      score += 0.1;
      factors.push("older device");
    }

    // Clamp to 0–1
    score = Math.max(0, Math.min(1, score));

    // Map score to zone
    let zone: ThermalZone;
    if (score < 0.25) zone = "cool";
    else if (score < 0.5) zone = "warm";
    else if (score < 0.75) zone = "hot";
    else zone = "critical";

    const detail = factors.length > 0 ? factors.join(", ") : "normal operating conditions";

    setThermal({ zone, score, detail });
  }, [drainRatePerMin, isLowPowerMode]);

  useEffect(() => {
    if (Platform.OS === "web") {
      setThermal({ zone: "cool", score: 0.05, detail: "N/A on web" });
      return;
    }

    compute();
    timerRef.current = setInterval(compute, 10_000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [compute]);

  return thermal;
}
