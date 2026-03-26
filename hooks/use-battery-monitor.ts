import { useState, useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import * as Battery from "expo-battery";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveSession } from "@/lib/session-history";
import {
  STORAGE_KEY_LAST_LEVEL,
  STORAGE_KEY_LAST_TIMESTAMP,
  STORAGE_KEY_LAST_CHARGE_LEVEL,
  STORAGE_KEY_LAST_CHARGE_TIMESTAMP,
  updateStoredDrainRate,
  updateStoredChargeState,
} from "@/lib/background-battery-task";

// Warning thresholds in minutes remaining (discharge)
const DISCHARGE_WARNINGS = [20, 15, 10, 7, 5, 2];

// Charging milestones in percent
const CHARGE_MILESTONES = [10, 25, 50, 75, 100];

// How many samples to keep for rate calculation
const SAMPLE_WINDOW = 20;

// Display refresh interval (5 seconds) — keeps displayed % in sync with phone.
// iOS addBatteryLevelListener fires at most once/min, so we poll frequently to catch changes fast.
const DISPLAY_POLL_INTERVAL = 5_000;

// Minimum elapsed time (ms) before we trust the rate calculation.
// 30 seconds is enough to produce a usable reading. The rate naturally
// becomes more accurate as more samples accumulate over time.
const MIN_RATE_WINDOW_MS = 30_000; // 30 seconds

// Maximum realistic drain rate (% per minute) — ~1.5%/min is very heavy use
const MAX_DRAIN_RATE = 1.5;

// Maximum realistic charge rate (% per minute) — ~1.2%/min is fast charging
const MAX_CHARGE_RATE = 1.2;

export type BatteryMode = "discharging" | "charging" | "full" | "unknown";

export interface BatterySample {
  level: number; // 0–1 (raw from OS)
  timestamp: number; // ms
}

export interface MilestoneETA {
  percent: number;
  minutesAway: number | null;
  reached: boolean;
}

export interface BatteryMonitorState {
  level: number;        // exact integer % from OS — never estimated
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
  isCalculating: boolean;
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
  if (deltaMin < 0.1) return null; // require at least 6 seconds of elapsed time

  const deltaLevel = Math.abs(newest.level - oldest.level) * 100; // in %
  if (deltaLevel < 0.01) return null; // no meaningful change

  const rate = deltaLevel / deltaMin;
  return Math.min(rate, maxRate);
}

function buildMilestones(
  currentLevel: number,
  chargeRatePerMin: number | null
): MilestoneETA[] {
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

async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === "granted") return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

async function sendWarningNotification(minutesLeft: number, drainRatePerMin: number | null) {
  const urgency = minutesLeft <= 5 ? "🔴" : minutesLeft <= 10 ? "🟠" : "⚠️";
  const rateStr = drainRatePerMin
    ? ` Drain rate: ${drainRatePerMin.toFixed(2)}%/min.`
    : "";
  const body =
    minutesLeft <= 2
      ? `Battery critically low — plug in immediately!${rateStr}`
      : `${minutesLeft} min of battery remaining — plug in soon.${rateStr}`;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${urgency} Battery Warning — ${minutesLeft} min left`,
      body,
      sound: "battery-alert.wav",
    },
    trigger: null,
  });
}

async function sendMilestoneNotification(percent: number) {
  const emoji = percent === 100 ? "🎉" : "⚡";
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${emoji} Conway Electric Power Monitor`,
      body:
        percent === 100
          ? "Battery fully charged!"
          : `Battery has reached ${percent}% charge.`,
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
    milestones: CHARGE_MILESTONES.map((p) => ({
      percent: p,
      minutesAway: null,
      reached: false,
    })),
    isAvailable: false,
    isCalculating: true,
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

  const addSample = useCallback((level: number) => {
    const sample: BatterySample = { level, timestamp: Date.now() };
    samplesRef.current = [...samplesRef.current.slice(-SAMPLE_WINDOW + 1), sample];
  }, []);

  const compute = useCallback(
    async (level: number, batteryState: Battery.BatteryState) => {
      // ── Level display: always the exact integer % from the OS, never estimated ──
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
          const durationMinutes = Math.max(1, Math.round(durationMs / 60_000));
          const rates = sessionDrainSamplesRef.current.filter((r) => r > 0);
          const avgDrainRate =
            rates.length > 0
              ? rates.reduce((a, b) => a + b, 0) / rates.length
              : 0;
          saveSession({
            id: `${endTime}`,
            startLevel: sessionStartLevelRef.current,
            endLevel: levelPct,
            startTime: sessionStartTimeRef.current,
            endTime,
            durationMinutes,
            avgDrainRatePerMin: Math.round(avgDrainRate * 100) / 100,
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

        samplesRef.current = [];
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
        const drainRate = calcRatePerMin(samplesRef.current, MAX_DRAIN_RATE);
        if (drainRate !== null && drainRate > 0) {
          sessionDrainSamplesRef.current.push(drainRate);
          // Keep background task's stored drain rate in sync
          updateStoredDrainRate(levelPct, drainRate);
        } else {
          // Still persist level + timestamp even before rate is ready,
          // so the next app open can seed the sample window immediately
          updateStoredDrainRate(levelPct, null);
        }

        const minutesRemaining =
          drainRate && drainRate > 0 ? Math.ceil(levelPct / drainRate) : null;

        // Check warnings
        let activeWarning: number | null = null;
        if (minutesRemaining !== null && notifPermRef.current) {
          for (const threshold of DISCHARGE_WARNINGS) {
            if (
              minutesRemaining <= threshold &&
              !firedWarningsRef.current.has(threshold)
            ) {
              firedWarningsRef.current.add(threshold);
              sendWarningNotification(threshold, drainRate);
              activeWarning = threshold;
              break;
            }
          }
          if (activeWarning === null) {
            for (const threshold of [...DISCHARGE_WARNINGS].reverse()) {
              if (
                minutesRemaining <= threshold &&
                firedWarningsRef.current.has(threshold)
              ) {
                activeWarning = threshold;
                break;
              }
            }
          }
        }

        const elapsedMs =
          samplesRef.current.length >= 2
            ? samplesRef.current[samplesRef.current.length - 1].timestamp -
              samplesRef.current[0].timestamp
            : 0;

        setState((prev) => ({
          ...prev,
          level: levelPct,
          mode,
          drainRatePerMin: drainRate,
          minutesRemaining,
          activeWarning,
          chargeRatePerMin: null,
          minutesToFull: null,
          milestones: CHARGE_MILESTONES.map((p) => ({
            percent: p,
            minutesAway: null,
            reached: false,
          })),
          isCalculating: elapsedMs < MIN_RATE_WINDOW_MS,
        }));
      } else if (mode === "charging" || mode === "full") {
        const chargeRate =
          mode === "full" ? null : calcRatePerMin(samplesRef.current, MAX_CHARGE_RATE);
        const minutesToFull =
          chargeRate && chargeRate > 0
            ? Math.ceil((100 - levelPct) / chargeRate)
            : null;
        const milestones = buildMilestones(levelPct, chargeRate ?? null);

        if (notifPermRef.current) {
          for (const m of milestones) {
            if (m.reached && !firedMilestonesRef.current.has(m.percent)) {
              firedMilestonesRef.current.add(m.percent);
              sendMilestoneNotification(m.percent);
            }
          }
        }

        // Persist charge level + timestamp so next app open seeds the sample window
        updateStoredChargeState(levelPct);

        const elapsedMs =
          samplesRef.current.length >= 2
            ? samplesRef.current[samplesRef.current.length - 1].timestamp -
              samplesRef.current[0].timestamp
            : 0;

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
          isCalculating: mode === "charging" && elapsedMs < MIN_RATE_WINDOW_MS,
        }));
      } else {
        setState((prev) => ({
          ...prev,
          level: levelPct,
          mode,
          isCalculating: false,
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

      // ── Seed the sample window with the last known reading from AsyncStorage ──
      // This lets the rate calculate immediately on first open instead of
      // waiting MIN_RATE_WINDOW_MS from scratch. The stored readings come
      // from the previous session or background task run.
      const now = Date.now();

      if (batteryState === Battery.BatteryState.UNPLUGGED) {
        // Discharging: seed from last stored discharge reading
        const [storedLevelStr, storedTimestampStr] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_LAST_LEVEL),
          AsyncStorage.getItem(STORAGE_KEY_LAST_TIMESTAMP),
        ]);
        if (storedLevelStr && storedTimestampStr) {
          const storedLevel = parseFloat(storedLevelStr) / 100; // convert % back to 0–1
          const storedTimestamp = parseInt(storedTimestampStr, 10);
          const ageMs = now - storedTimestamp;
          // Only use if within last 2 hours and level was higher (device was draining)
          if (ageMs < 2 * 60 * 60_000 && storedLevel > level) {
            samplesRef.current = [{ level: storedLevel, timestamp: storedTimestamp }];
          }
        }
      } else if (batteryState === Battery.BatteryState.CHARGING) {
        // Charging: seed from last stored charge reading
        const [storedChargeLevelStr, storedChargeTimestampStr] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_LAST_CHARGE_LEVEL),
          AsyncStorage.getItem(STORAGE_KEY_LAST_CHARGE_TIMESTAMP),
        ]);
        if (storedChargeLevelStr && storedChargeTimestampStr) {
          const storedChargeLevel = parseFloat(storedChargeLevelStr) / 100; // convert % back to 0–1
          const storedChargeTimestamp = parseInt(storedChargeTimestampStr, 10);
          const ageMs = now - storedChargeTimestamp;
          // Only use if within last 2 hours and level was lower (device was charging up)
          if (ageMs < 2 * 60 * 60_000 && storedChargeLevel < level) {
            samplesRef.current = [{ level: storedChargeLevel, timestamp: storedChargeTimestamp }];
          }
        }
      }

      await compute(level, batteryState);

      // Listen for level changes (iOS fires at most once/min, so we also poll below)
      levelSub = Battery.addBatteryLevelListener(async ({ batteryLevel }) => {
        const currentState = await Battery.getBatteryStateAsync();
        await compute(batteryLevel, currentState);
      });

      // Listen for state changes (plug/unplug)
      stateSub = Battery.addBatteryStateListener(async ({ batteryState: newState }) => {
        const currentLevel = await Battery.getBatteryLevelAsync();
        await compute(currentLevel, newState);
      });

      // Poll every 5s — ensures the display stays in sync regardless of listener throttling
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
