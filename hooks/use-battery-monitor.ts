import { useState, useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import * as Battery from "expo-battery";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveSession } from "@/lib/session-history";
import { recordSessionDrainRate } from "@/lib/health-history";
import { estimateInitialDrainRate } from "@/hooks/use-thermal-state";
import {
  STORAGE_KEY_LAST_LEVEL,
  STORAGE_KEY_LAST_TIMESTAMP,
  STORAGE_KEY_LAST_DRAIN_RATE,
  STORAGE_KEY_LAST_CHARGE_LEVEL,
  STORAGE_KEY_LAST_CHARGE_TIMESTAMP,
  STORAGE_KEY_LAST_CHARGE_RATE,
  updateStoredDrainRate,
  updateStoredChargeState,
} from "@/lib/background-battery-task";
import {
  scheduleNudgeNotifications,
  cancelNudgeNotifications,
  resetNudgeSchedule,
} from "@/lib/scheduled-nudge-notifications";

// Charging milestones in percent
const CHARGE_MILESTONES = [10, 25, 50, 75, 100];

// How many samples to keep for rate calculation
const SAMPLE_WINDOW = 20;

// Short window for spike detection (~2 minutes at 5s poll = 24 samples, use last 4 for ~20s)
const SPIKE_WINDOW = 4;

// Spike threshold: short-window rate must be this multiple of baseline to flag a spike
const SPIKE_MULTIPLIER = 2.0;

// Minimum baseline rate before spike detection activates (avoid false positives at very low drain)
const SPIKE_MIN_BASELINE = 0.1;

// Display refresh interval (5 seconds)
const DISPLAY_POLL_INTERVAL = 5_000;

// Minimum elapsed time (ms) between oldest and newest sample before we trust
// the live-calculated rate. 30 seconds is enough for a usable reading.
const MIN_RATE_WINDOW_MS = 30_000;

// Maximum realistic drain rate (% per minute)
const MAX_DRAIN_RATE = 1.5;

// Maximum realistic charge rate (% per minute)
const MAX_CHARGE_RATE = 1.2;

// Max age of a stored rate before we consider it stale (2 hours)
const MAX_STORED_RATE_AGE_MS = 2 * 60 * 60_000;

export type BatteryMode = "discharging" | "charging" | "full" | "unknown";

export interface BatterySample {
  level: number;    // 0–1 raw from OS
  timestamp: number;
}

export interface MilestoneETA {
  percent: number;
  minutesAway: number | null;
  reached: boolean;
}

export interface BatteryMonitorState {
  level: number;              // interpolated display % (whole number, updated every 5s)
  mode: BatteryMode;
  // Discharge
  drainRatePerMin: number | null;
  minutesRemaining: number | null;
  activeWarning: number | null;
  drainSpike: boolean;        // true when short-window drain rate is 2× the baseline
  // Charging
  chargeRatePerMin: number | null;
  minutesToFull: number | null;
  milestones: MilestoneETA[];
  // Meta
  isAvailable: boolean;
  isCalculating: boolean;   // true only on very first ever launch with zero stored data
  isRateEstimated: boolean; // true when showing stored rate, false when live samples confirm it
}

function calcRatePerMin(
  samples: BatterySample[],
  maxRate: number,
): number | null {
  if (samples.length < 2) return null;
  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const elapsedMs = newest.timestamp - oldest.timestamp;

  if (elapsedMs < MIN_RATE_WINDOW_MS) return null;

  const deltaMin = elapsedMs / 60_000;
  if (deltaMin < 0.1) return null;

  const deltaLevel = Math.abs(newest.level - oldest.level) * 100;
  if (deltaLevel < 0.01) return null;

  return Math.min(deltaLevel / deltaMin, maxRate);
}

function buildMilestones(
  currentLevel: number,
  chargeRatePerMin: number | null
): MilestoneETA[] {
  return CHARGE_MILESTONES.map((pct) => {
    if (currentLevel >= pct) return { percent: pct, minutesAway: null, reached: true };
    if (!chargeRatePerMin || chargeRatePerMin <= 0)
      return { percent: pct, minutesAway: null, reached: false };
    return { percent: pct, minutesAway: (pct - currentLevel) / chargeRatePerMin, reached: false };
  });
}

/**
 * Interpolate a display-only battery percentage between iOS reports.
 *
 * iOS reports battery level in whole integer steps, sometimes minutes apart.
 * This function uses the known drain/charge rate and elapsed time since the
 * last iOS-reported level to estimate a smoother current value — still in
 * whole 1% steps, never decimal.
 *
 * Rules:
 * - Only interpolates when a confident rate is available (not during warmup).
 * - Discharging: result is clamped so it never goes BELOW the OS-reported level
 *   (we can estimate ahead of iOS, but we never contradict a confirmed drop).
 * - Charging: result is clamped so it never goes ABOVE the OS-reported level.
 * - Result is always a whole integer (Math.round).
 * - Result is always clamped to [0, 100].
 */
function interpolateLevel(
  osLevelPct: number,
  osLevelTimestamp: number,
  ratePerMin: number | null,
  mode: BatteryMode,
): number {
  if (ratePerMin === null || ratePerMin <= 0) return osLevelPct;
  if (mode !== "discharging" && mode !== "charging") return osLevelPct;

  const elapsedMin = (Date.now() - osLevelTimestamp) / 60_000;
  const delta = ratePerMin * elapsedMin;

  let interpolated: number;
  if (mode === "discharging") {
    // Drain: level decreases. Clamp so we never go below osLevelPct
    // (iOS will confirm the drop when it happens; we only estimate ahead of it).
    interpolated = Math.round(osLevelPct - delta);
    interpolated = Math.max(interpolated, osLevelPct - 1); // max 1% ahead of iOS
    interpolated = Math.max(interpolated, 0);
  } else {
    // Charge: level increases. Clamp so we never go above osLevelPct.
    interpolated = Math.round(osLevelPct + delta);
    interpolated = Math.min(interpolated, osLevelPct + 1); // max 1% ahead of iOS
    interpolated = Math.min(interpolated, 100);
  }

  return interpolated;
}

async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}


export function useBatteryMonitor(): BatteryMonitorState {
  const [state, setState] = useState<BatteryMonitorState>({
    level: 0,
    mode: "unknown",
    drainRatePerMin: null,
    minutesRemaining: null,
    activeWarning: null,
    drainSpike: false,
    chargeRatePerMin: null,
    minutesToFull: null,
    milestones: CHARGE_MILESTONES.map((p) => ({ percent: p, minutesAway: null, reached: false })),
    isAvailable: false,
    isCalculating: true,
    isRateEstimated: false,
  });

  const samplesRef = useRef<BatterySample[]>([]);
  const prevModeRef = useRef<BatteryMode>("unknown");
  const notifPermRef = useRef<boolean>(false);
  const baselineDrainRateRef = useRef<number | null>(null); // long-window baseline for spike detection
  // Force-reschedule nudge notifications on first compute after mount (bypasses the 30% change gate)
  const firstComputeRef = useRef<boolean>(true);

  // Track the last OS-confirmed level and its timestamp for interpolation
  const osLevelPctRef = useRef<number>(0);
  const osLevelTimestampRef = useRef<number>(Date.now());

  // Session tracking
  const sessionStartLevelRef = useRef<number | null>(null);
  const sessionStartTimeRef = useRef<number | null>(null);
  const sessionDrainSamplesRef = useRef<number[]>([]);

  // Stored fallback rates — loaded from AsyncStorage on mount, used until live samples are ready
  const storedDrainRateRef = useRef<number | null>(null);
  const storedChargeRateRef = useRef<number | null>(null);

  const addSample = useCallback((level: number) => {
    samplesRef.current = [
      ...samplesRef.current.slice(-SAMPLE_WINDOW + 1),
      { level, timestamp: Date.now() },
    ];
  }, []);

  const compute = useCallback(
    async (level: number, batteryState: Battery.BatteryState) => {
      // OS-reported integer % — used for all rate calculations and as the interpolation anchor
      const osLevelPct = Math.round(level * 100);

      // Update the OS anchor whenever iOS gives us a new reading
      osLevelPctRef.current = osLevelPct;
      osLevelTimestampRef.current = Date.now();

      let mode: BatteryMode = "unknown";
      if (batteryState === Battery.BatteryState.CHARGING) mode = "charging";
      else if (batteryState === Battery.BatteryState.FULL) mode = "full";
      else if (batteryState === Battery.BatteryState.UNPLUGGED) mode = "discharging";

      // Handle mode transitions
      if (mode !== prevModeRef.current) {
        const prevMode = prevModeRef.current;
        if (
          prevMode === "discharging" &&
          (mode === "charging" || mode === "full") &&
          sessionStartLevelRef.current !== null &&
          sessionStartTimeRef.current !== null
        ) {
          const endTime = Date.now();
          const durationMs = endTime - sessionStartTimeRef.current;
          const rates = sessionDrainSamplesRef.current.filter((r) => r > 0);
          const avgRate =
            rates.length > 0
              ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100
              : 0;
          saveSession({
            id: `${endTime}`,
            startLevel: sessionStartLevelRef.current,
            endLevel: osLevelPct,
            startTime: sessionStartTimeRef.current,
            endTime,
            durationMinutes: Math.max(1, Math.round(durationMs / 60_000)),
            avgDrainRatePerMin: avgRate,
          });
          if (avgRate > 0) recordSessionDrainRate(avgRate).catch(() => {});
          sessionStartLevelRef.current = null;
          sessionStartTimeRef.current = null;
          sessionDrainSamplesRef.current = [];
        }

        if (mode === "discharging") {
          sessionStartLevelRef.current = osLevelPct;
          sessionStartTimeRef.current = Date.now();
          sessionDrainSamplesRef.current = [];
        }

        // Only wipe samples on real mode transitions (e.g. unplug → charge).
        // Do NOT wipe when transitioning from 'unknown' (initial state on first compute)
        // because that would destroy the seeded sample loaded from AsyncStorage.
        if (prevMode !== "unknown") {
          samplesRef.current = [];
        }
        prevModeRef.current = mode;
        // Reset nudge schedule so next compute reschedules from scratch
        resetNudgeSchedule();
        // Force-reschedule on the next compute after a mode transition
        firstComputeRef.current = true;
        // Cancel scheduled nudge notifications when plugging in
        if (mode === "charging" || mode === "full") {
          cancelNudgeNotifications().catch(() => {});
        }

      }

      if (mode === "discharging" && sessionStartLevelRef.current === null) {
        sessionStartLevelRef.current = osLevelPct;
        sessionStartTimeRef.current = Date.now();
        sessionDrainSamplesRef.current = [];
      }

      addSample(level);

      if (mode === "discharging") {
        // Try live calculation first; fall back to stored rate if live isn't ready yet
        const liveRate = calcRatePerMin(samplesRef.current, MAX_DRAIN_RATE);
        const drainRate = liveRate ?? storedDrainRateRef.current;
        const isRateEstimated = liveRate === null && drainRate !== null;

        if (liveRate !== null && liveRate > 0) {
          sessionDrainSamplesRef.current.push(liveRate);
          storedDrainRateRef.current = liveRate; // keep ref in sync
          updateStoredDrainRate(osLevelPct, liveRate);
          // Update baseline: use long-window rate as the stable reference
          if (baselineDrainRateRef.current === null) {
            baselineDrainRateRef.current = liveRate;
          } else {
            // Slowly update baseline with exponential smoothing (alpha=0.1)
            baselineDrainRateRef.current = baselineDrainRateRef.current * 0.9 + liveRate * 0.1;
          }
        } else {
          updateStoredDrainRate(osLevelPct, null);
        }

        // Spike detection: compare short-window rate to smoothed baseline
        const shortRate = calcRatePerMin(samplesRef.current.slice(-SPIKE_WINDOW), MAX_DRAIN_RATE);
        const baseline = baselineDrainRateRef.current;
        const drainSpike =
          shortRate !== null &&
          baseline !== null &&
          baseline >= SPIKE_MIN_BASELINE &&
          shortRate >= SPIKE_MIN_BASELINE &&
          shortRate >= baseline * SPIKE_MULTIPLIER;

        // Interpolated display level — smoother than raw OS level
        // Uses the OS-confirmed level as anchor; only steps 1% at a time
        const displayLevel = interpolateLevel(osLevelPct, osLevelTimestampRef.current, drainRate, mode);

        const minutesRemaining =
          drainRate && drainRate > 0 ? Math.ceil(displayLevel / drainRate) : null;

        // Schedule predictive nudge notifications based on drain rate
        // These are scheduled for future delivery so iOS delivers them on time
        // even when the app is closed — no more bursts or missed alerts.
        // Force-reschedule on first compute after mount so the 30% change gate
        // doesn't block scheduling when the app opens with a cached drain rate.
        const activeWarning: number | null = null;
        if (drainRate !== null && drainRate > 0 && notifPermRef.current) {
          const forceSchedule = firstComputeRef.current;
          firstComputeRef.current = false;
          scheduleNudgeNotifications(osLevelPct, drainRate, forceSchedule).catch(() => {});
        }

        setState((prev) => ({
          ...prev,
          level: displayLevel,
          mode,
          drainRatePerMin: drainRate,
          minutesRemaining,
          activeWarning,
          drainSpike,
          chargeRatePerMin: null,
          minutesToFull: null,
          milestones: CHARGE_MILESTONES.map((p) => ({ percent: p, minutesAway: null, reached: false })),
          // isCalculating only true if we have absolutely no rate at all
          isCalculating: drainRate === null,
          isRateEstimated: isRateEstimated ?? false,
        }));

      } else if (mode === "charging" || mode === "full") {
        const liveRate = mode === "full" ? null : calcRatePerMin(samplesRef.current, MAX_CHARGE_RATE);
        const chargeRate = liveRate ?? (mode === "full" ? null : storedChargeRateRef.current);
        const isRateEstimated = liveRate === null && chargeRate !== null;

        if (liveRate !== null && liveRate > 0) {
          storedChargeRateRef.current = liveRate;
          updateStoredChargeState(osLevelPct, liveRate);
        } else {
          updateStoredChargeState(osLevelPct, null);
        }

        // Interpolated display level for charging
        const displayLevel = mode === "full"
          ? 100
          : interpolateLevel(osLevelPct, osLevelTimestampRef.current, chargeRate, mode);

        const minutesToFull =
          chargeRate && chargeRate > 0 ? Math.ceil((100 - displayLevel) / chargeRate) : null;
        const milestones = buildMilestones(displayLevel, chargeRate ?? null);

        setState((prev) => ({
          ...prev,
          level: displayLevel,
          mode,
          drainRatePerMin: null,
          minutesRemaining: null,
          activeWarning: null,
          chargeRatePerMin: chargeRate,
          minutesToFull,
          milestones,
          // isCalculating only true if we have absolutely no rate at all (and not full)
          isCalculating: mode === "charging" && chargeRate === null,
          isRateEstimated: isRateEstimated ?? false,
        }));

      } else {
        setState((prev) => ({
          ...prev,
          level: osLevelPct,
          mode,
          isCalculating: false,
          isRateEstimated: false,
        }));
      }
    },
    [addSample]
  );

  useEffect(() => {
    if (Platform.OS === "web") {
      setState((prev) => ({ ...prev, isAvailable: false, isCalculating: false }));
      return;
    }

    let levelSub: Battery.Subscription | undefined;
    let stateSub: Battery.Subscription | undefined;
    let displayTimer: ReturnType<typeof setInterval> | undefined;

    (async () => {
      const available = await Battery.isAvailableAsync();
      if (!available) {
        setState((prev) => ({ ...prev, isAvailable: false, isCalculating: false }));
        return;
      }

      notifPermRef.current = await requestNotificationPermission();

      const [level, batteryState] = await Promise.all([
        Battery.getBatteryLevelAsync(),
        Battery.getBatteryStateAsync(),
      ]);

      setState((prev) => ({ ...prev, isAvailable: true }));

      // ── Always load BOTH stored rates on mount, regardless of current battery state ──
      // This handles FULL, UNKNOWN, and any other state iOS may briefly report at startup.
      // compute() will pick the correct rate based on the resolved mode.
      const now = Date.now();

      const [
        storedLevelStr,
        storedTimestampStr,
        storedDrainRateStr,
        storedChargeLevelStr,
        storedChargeTimestampStr,
        storedChargeRateStr,
      ] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_LAST_LEVEL),
        AsyncStorage.getItem(STORAGE_KEY_LAST_TIMESTAMP),
        AsyncStorage.getItem(STORAGE_KEY_LAST_DRAIN_RATE),
        AsyncStorage.getItem(STORAGE_KEY_LAST_CHARGE_LEVEL),
        AsyncStorage.getItem(STORAGE_KEY_LAST_CHARGE_TIMESTAMP),
        AsyncStorage.getItem(STORAGE_KEY_LAST_CHARGE_RATE),
      ]);

      // Populate drain rate ref — used immediately as fallback in compute()
      if (storedDrainRateStr) {
        const rate = parseFloat(storedDrainRateStr);
        if (rate > 0 && rate <= MAX_DRAIN_RATE) storedDrainRateRef.current = rate;
      } else if (batteryState === Battery.BatteryState.UNPLUGGED) {
        // No stored rate at all (first ever launch) — generate an instant estimate
        // from device model, brightness, and Low Power Mode so the display is
        // never blank. This estimate is clearly marked with isRateEstimated = true.
        const isLPM = await Battery.isLowPowerModeEnabledAsync().catch(() => false);
        const estimated = await estimateInitialDrainRate(isLPM);
        if (estimated > 0) storedDrainRateRef.current = estimated;
      }

      // Populate charge rate ref — used immediately as fallback in compute()
      if (storedChargeRateStr) {
        const rate = parseFloat(storedChargeRateStr);
        if (rate > 0 && rate <= MAX_CHARGE_RATE) storedChargeRateRef.current = rate;
      }

      // Seed sample window based on current state to help live rate warm up faster.
      // Condition is relaxed: only require the stored reading to be fresh (< 2h),
      // not that the level moved in the expected direction — that check was too strict
      // and prevented seeding when level hadn't changed much yet.
      const isDischarging = batteryState === Battery.BatteryState.UNPLUGGED;
      const isCharging = batteryState === Battery.BatteryState.CHARGING;

      if (isDischarging && storedLevelStr && storedTimestampStr) {
        const storedLevel = parseFloat(storedLevelStr) / 100;
        const storedTimestamp = parseInt(storedTimestampStr, 10);
        const ageMs = now - storedTimestamp;
        // Seed if fresh and stored level was higher (device was draining since last open)
        if (ageMs < MAX_STORED_RATE_AGE_MS && storedLevel > level) {
          samplesRef.current = [{ level: storedLevel, timestamp: storedTimestamp }];
        }
      } else if (isCharging && storedChargeLevelStr && storedChargeTimestampStr) {
        const storedChargeLevel = parseFloat(storedChargeLevelStr) / 100;
        const storedChargeTimestamp = parseInt(storedChargeTimestampStr, 10);
        const ageMs = now - storedChargeTimestamp;
        // Seed if fresh and stored level was lower (device was charging since last open)
        if (ageMs < MAX_STORED_RATE_AGE_MS && storedChargeLevel < level) {
          samplesRef.current = [{ level: storedChargeLevel, timestamp: storedChargeTimestamp }];
        }
      }

      // First compute — will immediately show stored rate if available
      await compute(level, batteryState);

      // Listen for level changes (iOS fires at most once/min)
      levelSub = Battery.addBatteryLevelListener(async ({ batteryLevel }) => {
        const currentState = await Battery.getBatteryStateAsync();
        await compute(batteryLevel, currentState);
      });

      // Listen for state changes (plug/unplug)
      stateSub = Battery.addBatteryStateListener(async ({ batteryState: newState }) => {
        const currentLevel = await Battery.getBatteryLevelAsync();
        await compute(currentLevel, newState);
      });

      // Poll every 5s — keeps display in sync and refines rate continuously
      // Also drives the interpolated level update between iOS reports
      displayTimer = setInterval(async () => {
        const [lvl, bState] = await Promise.all([
          Battery.getBatteryLevelAsync(),
          Battery.getBatteryStateAsync(),
        ]);
        await compute(lvl, bState);
      }, DISPLAY_POLL_INTERVAL);
    })();

    return () => {
      levelSub?.remove();
      stateSub?.remove();
      if (displayTimer) clearInterval(displayTimer);
    };
  }, [compute]);

  return state;
}
