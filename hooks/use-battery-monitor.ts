import { useState, useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import * as Battery from "expo-battery";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveSession } from "@/lib/session-history";
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

// Warning thresholds in minutes remaining (discharge)
const DISCHARGE_WARNINGS = [20, 15, 10, 7, 5, 2];

// Charging milestones in percent
const CHARGE_MILESTONES = [10, 25, 50, 75, 100];

// How many samples to keep for rate calculation
const SAMPLE_WINDOW = 20;

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
  level: number;              // exact integer % from OS — never estimated
  mode: BatteryMode;
  // Discharge
  drainRatePerMin: number | null;
  minutesRemaining: number | null;
  activeWarning: number | null;
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

async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

async function sendWarningNotification(minutesLeft: number, drainRatePerMin: number | null) {
  const urgency = minutesLeft <= 5 ? "🔴" : minutesLeft <= 10 ? "🟠" : "⚠️";
  const rateStr = drainRatePerMin ? ` Drain rate: ${drainRatePerMin.toFixed(2)}%/min.` : "";
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${urgency} Battery Warning — ${minutesLeft} min left`,
      body: minutesLeft <= 2
        ? `Battery critically low — plug in immediately!${rateStr}`
        : `${minutesLeft} min of battery remaining — plug in soon.${rateStr}`,
      sound: "battery-alert.wav",
    },
    trigger: null,
  });
}

async function sendMilestoneNotification(percent: number) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${percent === 100 ? "🎉" : "⚡"} Conway Electric Power Monitor`,
      body: percent === 100 ? "Battery fully charged!" : `Battery has reached ${percent}% charge.`,
      sound: "battery-alert.wav",
    },
    trigger: null,
  });
}

export function useBatteryMonitor(): BatteryMonitorState {
  const [state, setState] = useState<BatteryMonitorState>({
    level: 0,
    mode: "unknown",
    drainRatePerMin: null,
    minutesRemaining: null,
    activeWarning: null,
    chargeRatePerMin: null,
    minutesToFull: null,
    milestones: CHARGE_MILESTONES.map((p) => ({ percent: p, minutesAway: null, reached: false })),
    isAvailable: false,
    isCalculating: true,
    isRateEstimated: false,
  });

  const samplesRef = useRef<BatterySample[]>([]);
  const firedWarningsRef = useRef<Set<number>>(new Set());
  const firedMilestonesRef = useRef<Set<number>>(new Set());
  const prevModeRef = useRef<BatteryMode>("unknown");
  const notifPermRef = useRef<boolean>(false);

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
      // Level display: always the exact integer % from the OS, never estimated
      const levelPct = Math.round(level * 100);

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
          saveSession({
            id: `${endTime}`,
            startLevel: sessionStartLevelRef.current,
            endLevel: levelPct,
            startTime: sessionStartTimeRef.current,
            endTime,
            durationMinutes: Math.max(1, Math.round(durationMs / 60_000)),
            avgDrainRatePerMin:
              rates.length > 0
                ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100
                : 0,
          });
          sessionStartLevelRef.current = null;
          sessionStartTimeRef.current = null;
          sessionDrainSamplesRef.current = [];
        }

        if (mode === "discharging") {
          sessionStartLevelRef.current = levelPct;
          sessionStartTimeRef.current = Date.now();
          sessionDrainSamplesRef.current = [];
        }

        // Only wipe samples on real mode transitions (e.g. unplug → charge).
        // Do NOT wipe when transitioning from 'unknown' (initial state on first compute)
        // because that would destroy the seeded sample loaded from AsyncStorage.
        if (prevMode !== "unknown") {
          samplesRef.current = [];
        }
        firedWarningsRef.current = new Set();
        firedMilestonesRef.current = new Set();
        prevModeRef.current = mode;
      }

      if (mode === "discharging" && sessionStartLevelRef.current === null) {
        sessionStartLevelRef.current = levelPct;
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
          updateStoredDrainRate(levelPct, liveRate);
        } else {
          updateStoredDrainRate(levelPct, null);
        }

        const minutesRemaining =
          drainRate && drainRate > 0 ? Math.ceil(levelPct / drainRate) : null;

        // Check warnings
        let activeWarning: number | null = null;
        if (minutesRemaining !== null && notifPermRef.current) {
          for (const threshold of DISCHARGE_WARNINGS) {
            if (minutesRemaining <= threshold && !firedWarningsRef.current.has(threshold)) {
              firedWarningsRef.current.add(threshold);
              sendWarningNotification(threshold, drainRate);
              activeWarning = threshold;
              break;
            }
          }
          if (activeWarning === null) {
            for (const threshold of [...DISCHARGE_WARNINGS].reverse()) {
              if (minutesRemaining <= threshold && firedWarningsRef.current.has(threshold)) {
                activeWarning = threshold;
                break;
              }
            }
          }
        }

        setState((prev) => ({
          ...prev,
          level: levelPct,
          mode,
          drainRatePerMin: drainRate,
          minutesRemaining,
          activeWarning,
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
          updateStoredChargeState(levelPct, liveRate);
        } else {
          updateStoredChargeState(levelPct, null);
        }

        const minutesToFull =
          chargeRate && chargeRate > 0 ? Math.ceil((100 - levelPct) / chargeRate) : null;
        const milestones = buildMilestones(levelPct, chargeRate ?? null);

        if (notifPermRef.current) {
          for (const m of milestones) {
            if (m.reached && !firedMilestonesRef.current.has(m.percent)) {
              firedMilestonesRef.current.add(m.percent);
              sendMilestoneNotification(m.percent);
            }
          }
        }

        setState((prev) => ({
          ...prev,
          level: levelPct,
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
          level: levelPct,
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
