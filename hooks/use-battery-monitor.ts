import { useState, useEffect, useRef, useCallback } from "react";
import { Platform } from "react-native";
import * as Battery from "expo-battery";
import * as Notifications from "expo-notifications";

// Warning thresholds in minutes remaining (discharge)
const DISCHARGE_WARNINGS = [20, 15, 10, 7, 5, 2];

// Charging milestones in percent
const CHARGE_MILESTONES = [10, 25, 50, 75, 100];

// How many samples to keep for rate calculation
const SAMPLE_WINDOW = 10;

// Polling interval in ms (30 seconds)
const POLL_INTERVAL = 30_000;

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

function calcRatePerMin(samples: BatterySample[]): number | null {
  if (samples.length < 2) return null;
  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const deltaLevel = Math.abs(newest.level - oldest.level) * 100; // in %
  const deltaMin = (newest.timestamp - oldest.timestamp) / 60_000;
  if (deltaMin < 0.1) return null;
  return deltaLevel / deltaMin;
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

async function sendWarningNotification(minutesLeft: number) {
  const urgency = minutesLeft <= 5 ? "🔴" : "⚠️";
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${urgency} Conway Electric Power Monitor`,
      body:
        minutesLeft <= 2
          ? "Battery critically low — plug in immediately!"
          : `${minutesLeft} minutes of battery remaining — consider charging soon.`,
      sound: true,
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
      sound: true,
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

      // Reset samples when mode changes
      if (mode !== prevModeRef.current) {
        samplesRef.current = [];
        firedWarningsRef.current = new Set();
        firedMilestonesRef.current = new Set();
        prevModeRef.current = mode;
      }

      addSample(level);
      const rate = calcRatePerMin(samplesRef.current);

      if (mode === "discharging") {
        const drainRate = rate;
        const minutesRemaining =
          drainRate && drainRate > 0 ? (levelPct / drainRate) : null;

        // Check warnings
        let activeWarning: number | null = null;
        if (minutesRemaining !== null && notifPermRef.current) {
          for (const threshold of DISCHARGE_WARNINGS) {
            if (
              minutesRemaining <= threshold &&
              !firedWarningsRef.current.has(threshold)
            ) {
              firedWarningsRef.current.add(threshold);
              sendWarningNotification(threshold);
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
          isCalculating: samplesRef.current.length < 2,
        }));
      } else if (mode === "charging" || mode === "full") {
        const chargeRate = mode === "full" ? null : rate;
        const minutesToFull =
          chargeRate && chargeRate > 0 ? ((100 - levelPct) / chargeRate) : null;
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
          isCalculating: mode === "charging" && samplesRef.current.length < 2,
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
    let pollTimer: ReturnType<typeof setInterval> | undefined;

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

      // Poll every 30s for rate calculation even if level hasn't changed 1%
      pollTimer = setInterval(async () => {
        const [lvl, bState] = await Promise.all([
          Battery.getBatteryLevelAsync(),
          Battery.getBatteryStateAsync(),
        ]);
        await compute(lvl, bState);
      }, POLL_INTERVAL);
    })();

    return () => {
      levelSub?.remove();
      stateSub?.remove();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [compute]);

  return state;
}
