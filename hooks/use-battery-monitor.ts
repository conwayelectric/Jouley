import { useState, useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import * as Battery from "expo-battery";
import * as Notifications from "expo-notifications";
import { saveSession } from "@/lib/session-history";

// Warning thresholds in minutes remaining (discharge)
const DISCHARGE_WARNINGS = [20, 15, 10, 7, 5, 2];

// Charging milestones in percent
const CHARGE_MILESTONES = [10, 25, 50, 75, 100];

// How many samples to keep for rate calculation
const SAMPLE_WINDOW = 20;

// Display refresh interval (5 seconds) — keeps displayed % in sync with phone.
// iOS addBatteryLevelListener fires at most once/min, so we poll frequently to catch changes fast.
const DISPLAY_POLL_INTERVAL = 5_000;

// Minimum elapsed time (ms) before we trust the rate calculation
const MIN_RATE_WINDOW_MS = 5 * 60_000; // 5 minutes

// Maximum realistic drain rate (% per minute) — ~1.5%/min is very heavy use
const MAX_DRAIN_RATE = 1.5;

// Maximum realistic charge rate (% per minute) — ~1.2%/min is fast charging
const MAX_CHARGE_RATE = 1.2;

export type BatteryMode = "discharging" | "charging" | "full" | "unknown";

export interface BatterySample {
  level: number; // 0–1
  timestamp: number; // ms
}

export interface MilestoneETA {
  percent: number;
  minutesAway: number | null; // null = already reached
  reached: boolean;
}

export interface BatteryMonitorState {
  level: number; // 0–100 integer
  mode: BatteryMode;
  // Discharge
  drainRatePerMin: number | null; // % per minute, positive
  minutesRemaining: number | null;
  activeWarning: number | null; // current warning threshold triggered
  // Charging
  chargeRatePerMin: number | null; // % per minute, positive
  minutesToFull: number | null;
  milestones: MilestoneETA[];
  // Meta
  isAvailable: boolean;
  isCalculating: boolean;
}

function calcRatePerMin(
  samples: BatterySample[],
  maxRate: number,
  requireMinWindow = true
): number | null {
  if (samples.length < 2) return null;
  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const elapsedMs = newest.timestamp - oldest.timestamp;

  // Require a minimum observation window to avoid noise-inflated readings
  if (requireMinWindow && elapsedMs < MIN_RATE_WINDOW_MS) return null;

  const deltaMin = elapsedMs / 60_000;
  if (deltaMin < 0.5) return null;

  const deltaLevel = Math.abs(newest.level - oldest.level) * 100; // in %
  if (deltaLevel < 0.01) return null; // no meaningful change

  const rate = deltaLevel / deltaMin;

  // Cap at realistic maximum to filter sensor noise
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
    trigger: null, // fire immediately
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

  // Session tracking — records discharge sessions for history log
  const sessionStartLevelRef = useRef<number | null>(null);
  const sessionStartTimeRef = useRef<number | null>(null);
  const sessionDrainSamplesRef = useRef<number[]>([]); // drain rates during session

  const addSample = useCallback((level: number) => {
    const sample: BatterySample = { level, timestamp: Date.now() };
    samplesRef.current = [...samplesRef.current.slice(-SAMPLE_WINDOW + 1), sample];
  }, []);

  const compute = useCallback(
    async (level: number, batteryState: Battery.BatteryState) => {
      const levelPct = Math.round(level * 100);
      let mode: BatteryMode = "unknown";

      if (batteryState === Battery.BatteryState.CHARGING) mode = "charging";
      else if (batteryState === Battery.BatteryState.FULL) mode = "full";
      else if (batteryState === Battery.BatteryState.UNPLUGGED) mode = "discharging";

      // Handle mode transitions — record session end/start
      if (mode !== prevModeRef.current) {
        const prevMode = prevModeRef.current;

        // If we were discharging and now switched to charging/full, save the session
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

        // If we just started discharging, record session start
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

      // On first discharge detection (initial load)
      if (mode === "discharging" && sessionStartLevelRef.current === null) {
        sessionStartLevelRef.current = levelPct;
        sessionStartTimeRef.current = Date.now();
        sessionDrainSamplesRef.current = [];
      }

      addSample(level);

      if (mode === "discharging") {
        const drainRate = calcRatePerMin(samplesRef.current, MAX_DRAIN_RATE);
        // Accumulate drain rate samples for session average
        if (drainRate !== null && drainRate > 0) {
          sessionDrainSamplesRef.current.push(drainRate);
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
          // Keep showing the most recent triggered warning
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
          isCalculating: samplesRef.current.length < 2 || (samplesRef.current.length >= 2 && (samplesRef.current[samplesRef.current.length-1].timestamp - samplesRef.current[0].timestamp) < MIN_RATE_WINDOW_MS),
        }));
      } else if (mode === "charging" || mode === "full") {
        const chargeRate = mode === "full" ? null : calcRatePerMin(samplesRef.current, MAX_CHARGE_RATE);
        const minutesToFull =
          chargeRate && chargeRate > 0 ? Math.ceil((100 - levelPct) / chargeRate) : null;
        const milestones = buildMilestones(levelPct, chargeRate ?? null);

        // Fire milestone notifications
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
          isCalculating: mode === "charging" && (samplesRef.current.length < 2 || (samplesRef.current.length >= 2 && (samplesRef.current[samplesRef.current.length-1].timestamp - samplesRef.current[0].timestamp) < MIN_RATE_WINDOW_MS)),
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
      await compute(level, batteryState);

      // Listen for level changes
      levelSub = Battery.addBatteryLevelListener(async ({ batteryLevel }) => {
        const currentState = await Battery.getBatteryStateAsync();
        await compute(batteryLevel, currentState);
      });

      // Listen for state changes (plug/unplug)
      stateSub = Battery.addBatteryStateListener(async ({ batteryState: newState }) => {
        const currentLevel = await Battery.getBatteryLevelAsync();
        await compute(currentLevel, newState);
      });

      // Fast display poll: refresh every 5s so the UI stays in sync with the real device level.
      // iOS addBatteryLevelListener fires at most once per minute, so we cannot rely on it alone.
      // We call the full compute() here so level, mode, and all derived state update together.
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
