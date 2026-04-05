import { describe, it, expect } from "vitest";
import {
  computeHealthEstimate,
  buildDrainRateChartData,
  buildThermalChartData,
  type DailyHealthEntry,
  type HealthBaseline,
} from "../lib/health-history";

// ─── computeHealthEstimate ──────────────────────────────────────────────────────

describe("computeHealthEstimate", () => {
  const baseline: HealthBaseline = {
    avgDrainRate: 0.30,
    establishedDate: "2026-01-01",
    sessionCount: 10,
  };

  it("returns 'building baseline' when no baseline exists", () => {
    const result = computeHealthEstimate(0.30, null);
    expect(result.hasBaseline).toBe(false);
    expect(result.tier).toBe("good");
  });

  it("returns 'building baseline' when drain rate is null", () => {
    const result = computeHealthEstimate(null, baseline);
    expect(result.hasBaseline).toBe(false);
  });

  it("returns 'excellent' when drain rate matches baseline", () => {
    const result = computeHealthEstimate(0.30, baseline);
    expect(result.tier).toBe("excellent");
    expect(result.hasBaseline).toBe(true);
  });

  it("returns 'good' for slight increase (1.1–1.3×)", () => {
    const result = computeHealthEstimate(0.36, baseline); // 1.2× baseline
    expect(result.tier).toBe("good");
  });

  it("returns 'fair' for moderate increase (1.3–1.6×)", () => {
    const result = computeHealthEstimate(0.42, baseline); // 1.4× baseline
    expect(result.tier).toBe("fair");
  });

  it("returns 'declining' for large increase (>1.6×)", () => {
    const result = computeHealthEstimate(0.55, baseline); // ~1.83× baseline
    expect(result.tier).toBe("declining");
  });

  it("score is between 0 and 100", () => {
    const r1 = computeHealthEstimate(0.30, baseline);
    const r2 = computeHealthEstimate(1.00, baseline);
    expect(r1.score).toBeGreaterThanOrEqual(0);
    expect(r1.score).toBeLessThanOrEqual(100);
    expect(r2.score).toBeGreaterThanOrEqual(0);
    expect(r2.score).toBeLessThanOrEqual(100);
  });
});

// ─── buildDrainRateChartData ────────────────────────────────────────────────────

function makeLog(daysBack: number, rate: number): DailyHealthEntry {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  const date = d.toISOString().slice(0, 10);
  return {
    date,
    avgDrainRate: rate,
    avgThermalScore: 0.2,
    sessionCount: 2,
    drainRateSum: rate * 2,
    thermalScoreSum: 0.4,
    thermalSampleCount: 2,
  };
}

describe("buildDrainRateChartData", () => {
  it("returns exactly N points for N days", () => {
    const log: DailyHealthEntry[] = [makeLog(0, 0.3), makeLog(5, 0.4)];
    const points = buildDrainRateChartData(log, 30);
    expect(points).toHaveLength(30);
  });

  it("marks today's entry as hasData=true", () => {
    const log: DailyHealthEntry[] = [makeLog(0, 0.3)];
    const points = buildDrainRateChartData(log, 7);
    const today = points[points.length - 1];
    expect(today.hasData).toBe(true);
    expect(today.value).toBeCloseTo(0.3);
  });

  it("marks missing days as hasData=false with value 0", () => {
    const log: DailyHealthEntry[] = [];
    const points = buildDrainRateChartData(log, 7);
    expect(points.every((p) => !p.hasData && p.value === 0)).toBe(true);
  });

  it("entries older than the window are not included", () => {
    const log: DailyHealthEntry[] = [makeLog(35, 0.5)]; // 35 days ago, outside 30-day window
    const points = buildDrainRateChartData(log, 30);
    expect(points.every((p) => !p.hasData)).toBe(true);
  });
});

// ─── buildThermalChartData ──────────────────────────────────────────────────────

describe("buildThermalChartData", () => {
  it("returns correct thermal score for a logged day", () => {
    const log: DailyHealthEntry[] = [makeLog(1, 0)]; // yesterday
    // Override thermal score
    log[0].avgThermalScore = 0.45;
    log[0].thermalSampleCount = 5;
    const points = buildThermalChartData(log, 7);
    const yesterday = points[points.length - 2];
    expect(yesterday.hasData).toBe(true);
    expect(yesterday.value).toBeCloseTo(0.45);
  });

  it("returns N points for N days", () => {
    const points = buildThermalChartData([], 90);
    expect(points).toHaveLength(90);
  });
});
