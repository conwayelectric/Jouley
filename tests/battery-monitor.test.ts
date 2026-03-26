import { describe, it, expect } from "vitest";

// ── Pure utility functions extracted for testing ──────────────────────────────

const DISCHARGE_WARNINGS = [20, 15, 10, 7, 5, 2];
const CHARGE_MILESTONES = [10, 25, 50, 75, 100];

interface BatterySample {
  level: number;
  timestamp: number;
}

function calcRatePerMin(samples: BatterySample[]): number | null {
  if (samples.length < 2) return null;
  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const deltaLevel = Math.abs(newest.level - oldest.level) * 100;
  const deltaMin = (newest.timestamp - oldest.timestamp) / 60_000;
  if (deltaMin < 0.1) return null;
  return deltaLevel / deltaMin;
}

function buildMilestones(currentLevel: number, chargeRatePerMin: number | null) {
  return CHARGE_MILESTONES.map((pct) => {
    if (currentLevel >= pct) {
      return { percent: pct, minutesAway: null, reached: true };
    }
    if (!chargeRatePerMin || chargeRatePerMin <= 0) {
      return { percent: pct, minutesAway: null, reached: false };
    }
    const minutesAway = (pct - currentLevel) / chargeRatePerMin;
    return { percent: pct, minutesAway, reached: false };
  });
}

function formatTime(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("calcRatePerMin", () => {
  it("returns null with fewer than 2 samples", () => {
    expect(calcRatePerMin([])).toBeNull();
    expect(calcRatePerMin([{ level: 0.8, timestamp: 0 }])).toBeNull();
  });

  it("returns null when time delta is too small", () => {
    const samples = [
      { level: 0.80, timestamp: 0 },
      { level: 0.79, timestamp: 5_000 }, // only 5 seconds
    ];
    expect(calcRatePerMin(samples)).toBeNull();
  });

  it("calculates drain rate correctly", () => {
    // 5% drain over 5 minutes = 1%/min
    const samples = [
      { level: 0.80, timestamp: 0 },
      { level: 0.75, timestamp: 5 * 60_000 },
    ];
    expect(calcRatePerMin(samples)).toBeCloseTo(1.0);
  });

  it("calculates charge rate correctly", () => {
    // 10% gain over 10 minutes = 1%/min
    const samples = [
      { level: 0.50, timestamp: 0 },
      { level: 0.60, timestamp: 10 * 60_000 },
    ];
    expect(calcRatePerMin(samples)).toBeCloseTo(1.0);
  });

  it("calculates faster drain rate correctly", () => {
    // 2% drain over 1 minute = 2%/min
    const samples = [
      { level: 0.60, timestamp: 0 },
      { level: 0.58, timestamp: 60_000 },
    ];
    expect(calcRatePerMin(samples)).toBeCloseTo(2.0);
  });
});

describe("buildMilestones", () => {
  it("marks milestones below current level as reached", () => {
    const milestones = buildMilestones(60, 1.0);
    expect(milestones.find((m) => m.percent === 10)?.reached).toBe(true);
    expect(milestones.find((m) => m.percent === 25)?.reached).toBe(true);
    expect(milestones.find((m) => m.percent === 50)?.reached).toBe(true);
    expect(milestones.find((m) => m.percent === 75)?.reached).toBe(false);
    expect(milestones.find((m) => m.percent === 100)?.reached).toBe(false);
  });

  it("calculates correct ETA for unreached milestones", () => {
    // At 60%, charging at 1%/min: 75% is 15 min away, 100% is 40 min away
    const milestones = buildMilestones(60, 1.0);
    expect(milestones.find((m) => m.percent === 75)?.minutesAway).toBeCloseTo(15);
    expect(milestones.find((m) => m.percent === 100)?.minutesAway).toBeCloseTo(40);
  });

  it("returns null minutesAway when no charge rate available", () => {
    const milestones = buildMilestones(30, null);
    expect(milestones.find((m) => m.percent === 50)?.minutesAway).toBeNull();
  });

  it("marks all milestones reached at 100%", () => {
    const milestones = buildMilestones(100, null);
    expect(milestones.every((m) => m.reached)).toBe(true);
  });
});

describe("formatTime", () => {
  it("returns — for null", () => {
    expect(formatTime(null)).toBe("—");
  });

  it("returns < 1 min for values under 1", () => {
    expect(formatTime(0.5)).toBe("< 1 min");
  });

  it("formats minutes correctly", () => {
    expect(formatTime(5)).toBe("5 min");
    expect(formatTime(20)).toBe("20 min");
    expect(formatTime(59)).toBe("59 min");
  });

  it("formats hours and minutes correctly", () => {
    expect(formatTime(60)).toBe("1h");
    expect(formatTime(90)).toBe("1h 30m");
    expect(formatTime(125)).toBe("2h 5m");
  });
});

describe("discharge warning thresholds", () => {
  it("has correct warning thresholds in descending order", () => {
    expect(DISCHARGE_WARNINGS).toEqual([20, 15, 10, 7, 5, 2]);
  });

  it("triggers warning when minutes remaining falls at or below threshold", () => {
    const firedWarnings = new Set<number>();
    const minutesRemaining = 9.5;

    // The warnings array is [20, 15, 10, 7, 5, 2] - iterate in order
    // 9.5 <= 20 fires first (20 is the first threshold it's under)
    for (const threshold of DISCHARGE_WARNINGS) {
      if (minutesRemaining <= threshold && !firedWarnings.has(threshold)) {
        firedWarnings.add(threshold);
        break;
      }
    }
    // 9.5 min is <= 20, 15, 10 — the first match in the array is 20
    expect(firedWarnings.has(20)).toBe(true);
    expect(firedWarnings.has(7)).toBe(false);
  });

  it("fires the smallest matching threshold (most specific) when sorted ascending", () => {
    // Sort ascending [2,5,7,10,15,20] to find smallest threshold that still applies
    const sortedWarnings = [...DISCHARGE_WARNINGS].sort((a, b) => a - b); // [2,5,7,10,15,20]
    const firedWarnings = new Set<number>();
    const minutesRemaining = 4.2;

    // Find the smallest threshold >= minutesRemaining
    for (const threshold of sortedWarnings) {
      if (minutesRemaining <= threshold && !firedWarnings.has(threshold)) {
        firedWarnings.add(threshold);
        break;
      }
    }
    // 4.2 min: smallest threshold it falls under is 5
    expect(firedWarnings.has(5)).toBe(true);
    expect(firedWarnings.has(2)).toBe(false);
  });
});

describe("charge milestones", () => {
  it("has correct milestone percentages", () => {
    expect(CHARGE_MILESTONES).toEqual([10, 25, 50, 75, 100]);
  });
});
