/**
 * health-history.ts
 *
 * Stores a rolling 90-day log of daily battery health snapshots.
 * Each day records:
 *   - Average drain rate (%/min) across all sessions that day
 *   - Average thermal score (0–1) sampled throughout the day
 *   - Number of sessions recorded
 *
 * Also stores a "baseline" drain rate from the first 7 days of use,
 * used to compute a relative health estimate.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY_DAILY = "conway_health_daily_log";
const STORAGE_KEY_BASELINE = "conway_health_baseline";
const MAX_DAYS = 90;

export interface DailyHealthEntry {
  /** ISO date string, e.g. "2026-04-05" */
  date: string;
  /** Average drain rate across all sessions that day (%/min) */
  avgDrainRate: number;
  /** Average thermal score (0–1) sampled that day */
  avgThermalScore: number;
  /** Number of discharge sessions recorded */
  sessionCount: number;
  /** Running sum for incremental averaging */
  drainRateSum: number;
  thermalScoreSum: number;
  thermalSampleCount: number;
  /** Total % dropped across all sessions today (for charge frequency proxy) */
  totalPercentDropped?: number;
}

export interface HealthBaseline {
  /** Average drain rate from first 7 days of use (%/min) */
  avgDrainRate: number;
  /** Average sessions per day from first 7 days (charge frequency baseline) */
  avgSessionsPerDay?: number;
  /** ISO date when baseline was established */
  establishedDate: string;
  /** Number of sessions used to compute baseline */
  sessionCount: number;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Daily log ─────────────────────────────────────────────────────────────────

export async function loadDailyLog(): Promise<DailyHealthEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_DAILY);
    if (!raw) return [];
    return JSON.parse(raw) as DailyHealthEntry[];
  } catch {
    return [];
  }
}

async function saveDailyLog(log: DailyHealthEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_DAILY, JSON.stringify(log));
  } catch {
    // non-critical
  }
}

/**
 * Record a completed discharge session's drain rate into today's entry.
 */
export async function recordSessionDrainRate(drainRate: number): Promise<void> {
  if (drainRate <= 0) return;
  const log = await loadDailyLog();
  const today = todayKey();
  const existing = log.find((e) => e.date === today);

  if (existing) {
    existing.drainRateSum += drainRate;
    existing.sessionCount += 1;
    existing.avgDrainRate = existing.drainRateSum / existing.sessionCount;
  } else {
    log.push({
      date: today,
      avgDrainRate: drainRate,
      avgThermalScore: 0,
      sessionCount: 1,
      drainRateSum: drainRate,
      thermalScoreSum: 0,
      thermalSampleCount: 0,
    });
  }

  // Trim to MAX_DAYS, keeping most recent
  const trimmed = log
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_DAYS);

  await saveDailyLog(trimmed);
  await maybeEstablishBaseline(trimmed);
}

/**
 * Record a thermal score sample into today's entry.
 * Call this periodically (e.g., every 30 seconds) from the dashboard.
 */
export async function recordThermalSample(thermalScore: number): Promise<void> {
  const log = await loadDailyLog();
  const today = todayKey();
  const existing = log.find((e) => e.date === today);

  if (existing) {
    existing.thermalScoreSum += thermalScore;
    existing.thermalSampleCount += 1;
    existing.avgThermalScore =
      existing.thermalScoreSum / existing.thermalSampleCount;
  } else {
    log.push({
      date: today,
      avgDrainRate: 0,
      avgThermalScore: thermalScore,
      sessionCount: 0,
      drainRateSum: 0,
      thermalScoreSum: thermalScore,
      thermalSampleCount: 1,
    });
  }

  const trimmed = log
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_DAYS);

  await saveDailyLog(trimmed);
}

// ─── Baseline ──────────────────────────────────────────────────────────────────

export async function loadBaseline(): Promise<HealthBaseline | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY_BASELINE);
    if (!raw) return null;
    return JSON.parse(raw) as HealthBaseline;
  } catch {
    return null;
  }
}

async function maybeEstablishBaseline(log: DailyHealthEntry[]): Promise<void> {
  const existing = await loadBaseline();
  if (existing) return; // baseline already set

  // Need at least 3 days with sessions to establish a baseline
  const daysWithSessions = log.filter((e) => e.sessionCount > 0 && e.avgDrainRate > 0);
  if (daysWithSessions.length < 3) return;

  // Use up to the first 7 days of data
  const baselineDays = daysWithSessions.slice(-7); // oldest 7 (log is sorted newest-first)
  const totalSessions = baselineDays.reduce((s, d) => s + d.sessionCount, 0);
  const weightedSum = baselineDays.reduce(
    (s, d) => s + d.avgDrainRate * d.sessionCount,
    0
  );
  const avgDrainRate = totalSessions > 0 ? weightedSum / totalSessions : 0;

  const avgSessionsPerDay = totalSessions / baselineDays.length;

  const baseline: HealthBaseline = {
    avgDrainRate,
    avgSessionsPerDay,
    establishedDate: todayKey(),
    sessionCount: totalSessions,
  };

  try {
    await AsyncStorage.setItem(STORAGE_KEY_BASELINE, JSON.stringify(baseline));
  } catch {
    // non-critical
  }
}

// ─── Health estimate ────────────────────────────────────────────────────────────

export type HealthTier = "excellent" | "good" | "fair" | "declining";

export interface BatteryHealthEstimate {
  tier: HealthTier;
  label: string;
  description: string;
  /** 0–100 score (higher = healthier) */
  score: number;
  hasBaseline: boolean;
}

export function computeHealthEstimate(
  recentAvgDrainRate: number | null,
  baseline: HealthBaseline | null
): BatteryHealthEstimate {
  if (!baseline || !recentAvgDrainRate || recentAvgDrainRate <= 0) {
    return {
      tier: "good",
      label: "Building baseline",
      description:
        "A few more days of use and the app will have enough data to estimate battery health.",
      score: 75,
      hasBaseline: false,
    };
  }

  // Ratio: how much worse is current drain vs baseline?
  // 1.0 = same as baseline (excellent), 1.5 = 50% worse (fair), 2.0+ = declining
  const ratio = recentAvgDrainRate / baseline.avgDrainRate;
  const score = Math.max(0, Math.min(100, Math.round((2.0 - ratio) * 100)));

  let tier: HealthTier;
  let label: string;
  let description: string;

  if (ratio < 1.1) {
    tier = "excellent";
    label = "Performing well";
    description =
      "Your battery is draining at about the same rate as when you first started tracking. That is a good sign.";
  } else if (ratio < 1.3) {
    tier = "good";
    label = "Looking good";
    description =
      "Drain rate is slightly higher than your baseline, which is normal over time. Nothing to be concerned about.";
  } else if (ratio < 1.6) {
    tier = "fair";
    label = "Showing some wear";
    description =
      "Drain rate is noticeably higher than your baseline. This can be a sign of natural battery aging or heavier usage patterns.";
  } else {
    tier = "declining";
    label = "Worth monitoring";
    description =
      "Drain rate is significantly higher than your baseline. If this continues, it may be worth checking Settings → Battery → Battery Health on your device.";
  }

  return { tier, label, description, score, hasBaseline: true };
}

// ─── Capacity estimation ───────────────────────────────────────────────────────

/**
 * Computes a 0–100 estimated battery capacity score for a single day.
 *
 * Algorithm:
 *  1. Drain rate factor: how much faster is today's drain vs baseline?
 *     ratio = today.avgDrainRate / baseline.avgDrainRate
 *     drainScore = clamp(100 - (ratio - 1) * 80, 0, 100)
 *
 *  2. Thermal penalty: sustained heat accelerates degradation.
 *     thermalPenalty = today.avgThermalScore * 8   (max ~8 pts/day at critical)
 *
 *  3. Charge frequency factor: more sessions/day than baseline → heavier use
 *     freqRatio = today.sessionCount / baseline.avgSessionsPerDay
 *     freqPenalty = clamp((freqRatio - 1) * 5, 0, 10)
 *
 *  Final = clamp(drainScore - thermalPenalty - freqPenalty, 0, 100)
 *
 * The score is then smoothed across the window using a 3-day rolling average.
 */
export function computeCapacityScore(
  entry: DailyHealthEntry,
  baseline: HealthBaseline
): number {
  if (entry.avgDrainRate <= 0) return -1; // no data

  const ratio = entry.avgDrainRate / baseline.avgDrainRate;
  const drainScore = Math.max(0, Math.min(100, 100 - (ratio - 1) * 80));

  const thermalPenalty = (entry.avgThermalScore ?? 0) * 8;

  const baseFreq = baseline.avgSessionsPerDay ?? 1;
  const freqRatio = entry.sessionCount / Math.max(baseFreq, 0.5);
  const freqPenalty = Math.max(0, Math.min(10, (freqRatio - 1) * 5));

  return Math.max(0, Math.min(100, Math.round(drainScore - thermalPenalty - freqPenalty)));
}

// ─── Chart data helpers ─────────────────────────────────────────────────────────

export interface ChartPoint {
  date: string;   // "Apr 5"
  value: number;
  hasData: boolean;
}

/**
 * Returns the last N days as chart points for drain rate.
 * Days with no data are included with hasData=false.
 */
export function buildDrainRateChartData(
  log: DailyHealthEntry[],
  days: number = 30
): ChartPoint[] {
  const points: ChartPoint[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const entry = log.find((e) => e.date === key);

    points.push({
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      value: entry && entry.avgDrainRate > 0 ? entry.avgDrainRate : 0,
      hasData: !!(entry && entry.avgDrainRate > 0),
    });
  }

  return points;
}

/**
 * Returns the last N days as chart points for thermal score.
 */
export function buildThermalChartData(
  log: DailyHealthEntry[],
  days: number = 30
): ChartPoint[] {
  const points: ChartPoint[] = [];
  const now = new Date();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const entry = log.find((e) => e.date === key);

    points.push({
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      value:
        entry && entry.thermalSampleCount > 0 ? entry.avgThermalScore : 0,
      hasData: !!(entry && entry.thermalSampleCount > 0),
    });
  }

  return points;
}

/**
 * Returns the last N days as chart points for estimated battery capacity (0–100%).
 * Applies a 3-day rolling average to smooth the line.
 */
export function buildCapacityChartData(
  log: DailyHealthEntry[],
  baseline: HealthBaseline,
  days: number = 30
): ChartPoint[] {
  const now = new Date();

  // First pass: raw scores per day
  const raw: { date: string; label: string; score: number; hasData: boolean }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const entry = log.find((e) => e.date === key);
    const score = entry ? computeCapacityScore(entry, baseline) : -1;
    raw.push({
      date: key,
      label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      score,
      hasData: score >= 0,
    });
  }

  // Second pass: 3-day rolling average on valid points
  return raw.map((pt, i) => {
    if (!pt.hasData) return { date: pt.label, value: 0, hasData: false };
    const window = raw.slice(Math.max(0, i - 2), i + 1).filter((p) => p.hasData);
    const avg = window.reduce((s, p) => s + p.score, 0) / window.length;
    return { date: pt.label, value: Math.round(avg), hasData: true };
  });
}
