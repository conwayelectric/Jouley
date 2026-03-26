/**
 * Background Battery Monitoring Task
 *
 * Registered globally (outside React) so it runs even when the app is closed.
 *
 * PREDICTIVE ESTIMATION ALGORITHM:
 * iOS limits background fetch to ~15 min intervals. Between those intervals,
 * this module stores:
 *   - The last known real battery level (from the OS)
 *   - The last known drain rate (%/min, calculated in-app)
 *   - The timestamp of the last real reading
 *
 * When the background task fires, it:
 *   1. Gets the real current level from the OS
 *   2. Also computes a "predicted" level = lastLevel - (drainRate × elapsed minutes)
 *   3. Uses the real level for accuracy but cross-checks with the prediction to
 *      detect if a warning threshold was crossed between the last real reading
 *      and now — even if the OS skipped an interval.
 *   4. Fires notifications for any warning thresholds crossed in that window.
 *
 * Controlled by the "Always-On Monitoring" toggle in Settings (stored in AsyncStorage).
 */
import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";
import * as Battery from "expo-battery";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const BACKGROUND_BATTERY_TASK = "background-battery-monitor";

// Storage keys
export const STORAGE_KEY_ALWAYS_ON = "conway_always_on_monitoring";
export const STORAGE_KEY_LAST_LEVEL = "conway_last_battery_level";
export const STORAGE_KEY_LAST_TIMESTAMP = "conway_last_battery_timestamp";
export const STORAGE_KEY_LAST_DRAIN_RATE = "conway_last_drain_rate";
export const STORAGE_KEY_FIRED_WARNINGS = "conway_fired_warnings"; // JSON array of fired thresholds
export const STORAGE_KEY_FIRST_LAUNCH = "conway_first_launch_done";
export const STORAGE_KEY_LAST_BACKGROUND_CHECK = "conway_last_background_check";

// Low battery threshold for background alert
const LOW_BATTERY_THRESHOLD = 30;

// Warning thresholds in minutes remaining (must match in-app hook)
const DISCHARGE_WARNINGS_MIN = [20, 15, 10, 7, 5, 2];

/**
 * Predict battery level at a given time using linear drain model.
 * predictedLevel = lastLevel - drainRate * elapsedMinutes
 */
function predictLevel(
  lastLevel: number,
  drainRatePerMin: number,
  elapsedMs: number
): number {
  const elapsedMin = elapsedMs / 60_000;
  return Math.max(0, lastLevel - drainRatePerMin * elapsedMin);
}

/**
 * Predict minutes remaining from a given level and drain rate.
 */
function predictMinutesRemaining(level: number, drainRatePerMin: number): number | null {
  if (drainRatePerMin <= 0) return null;
  return Math.ceil(level / drainRatePerMin);
}

// Define the background task — MUST be in global scope
TaskManager.defineTask(BACKGROUND_BATTERY_TASK, async () => {
  try {
    // Check if always-on monitoring is enabled
    const alwaysOn = await AsyncStorage.getItem(STORAGE_KEY_ALWAYS_ON);
    if (alwaysOn === "false") {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    const [level, batteryState] = await Promise.all([
      Battery.getBatteryLevelAsync(),
      Battery.getBatteryStateAsync(),
    ]);

    const levelPct = Math.round(level * 100);
    const now = Date.now();

    // Only alert when discharging
    if (batteryState !== Battery.BatteryState.UNPLUGGED) {
      // Reset fired warnings when charging
      await AsyncStorage.multiRemove([
        STORAGE_KEY_FIRED_WARNINGS,
      ]);
      // Store current level for next comparison
      await AsyncStorage.setItem(STORAGE_KEY_LAST_LEVEL, String(levelPct));
      await AsyncStorage.setItem(STORAGE_KEY_LAST_TIMESTAMP, String(now));
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }

    // ── Retrieve stored state ──────────────────────────────────────────────
    const [prevLevelStr, prevTimestampStr, prevDrainRateStr, firedWarningsStr] =
      await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY_LAST_LEVEL),
        AsyncStorage.getItem(STORAGE_KEY_LAST_TIMESTAMP),
        AsyncStorage.getItem(STORAGE_KEY_LAST_DRAIN_RATE),
        AsyncStorage.getItem(STORAGE_KEY_FIRED_WARNINGS),
      ]);

    const prevLevel = prevLevelStr ? parseFloat(prevLevelStr) : null;
    const prevTimestamp = prevTimestampStr ? parseInt(prevTimestampStr, 10) : null;
    const storedDrainRate = prevDrainRateStr ? parseFloat(prevDrainRateStr) : null;
    const firedWarnings: number[] = firedWarningsStr
      ? JSON.parse(firedWarningsStr)
      : [];

    // ── Calculate real drain rate from this OS reading ─────────────────────
    let drainRatePerMin: number | null = storedDrainRate;
    if (prevLevel !== null && prevTimestamp !== null) {
      const deltaMin = (now - prevTimestamp) / 60_000;
      const deltaLevel = prevLevel - levelPct; // positive = draining
      if (deltaMin >= 5 && deltaLevel > 0) {
        // Fresh rate from real OS reading — cap at 1.5%/min
        drainRatePerMin = Math.min(deltaLevel / deltaMin, 1.5);
        await AsyncStorage.setItem(
          STORAGE_KEY_LAST_DRAIN_RATE,
          String(drainRatePerMin)
        );
      }
    }

    // ── Predictive gap-fill: estimate level at intermediate points ─────────
    // If we have a drain rate and a previous reading, check if any warning
    // thresholds were crossed between the last real reading and now.
    if (prevLevel !== null && prevTimestamp !== null && drainRatePerMin !== null) {
      const elapsedMs = now - prevTimestamp;
      // Sample every 1 minute between last reading and now
      const steps = Math.floor(elapsedMs / 60_000);
      for (let i = 1; i <= steps; i++) {
        const sampleElapsedMs = i * 60_000;
        const estimatedLevel = predictLevel(prevLevel, drainRatePerMin, sampleElapsedMs);
        const estimatedMinRemaining = predictMinutesRemaining(
          estimatedLevel,
          drainRatePerMin
        );
        if (estimatedMinRemaining === null) continue;

        // Check each warning threshold
        for (const threshold of DISCHARGE_WARNINGS_MIN) {
          if (
            estimatedMinRemaining <= threshold &&
            !firedWarnings.includes(threshold)
          ) {
            firedWarnings.push(threshold);
            await Notifications.scheduleNotificationAsync({
              content: {
                title: `⚡ ${threshold} Minutes of Battery Remaining`,
                body: `Estimated ${threshold} min left (${estimatedLevel.toFixed(0)}%). Drain rate: ${drainRatePerMin.toFixed(2)}%/min. Plug in soon!`,
                sound: "battery-alert.wav",
              },
              trigger: null, // fire immediately
            });
          }
        }
      }
    }

    // ── Real-level check: fire 30% low battery alert ───────────────────────
    const minutesRemaining = drainRatePerMin
      ? predictMinutesRemaining(levelPct, drainRatePerMin)
      : null;

    if (levelPct <= LOW_BATTERY_THRESHOLD && !firedWarnings.includes(-30)) {
      firedWarnings.push(-30); // use -30 as sentinel for the 30% level alert
      const rateStr = drainRatePerMin
        ? ` Drain rate: ${drainRatePerMin.toFixed(2)}%/min.`
        : "";
      const minutesStr = minutesRemaining
        ? ` (~${minutesRemaining} min remaining)`
        : "";
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `🔴 Low Battery — ${levelPct}% remaining`,
          body: `Your battery is running low.${minutesStr} Plug in soon.${rateStr}`,
          sound: "battery-alert.wav",
        },
        trigger: null,
      });
    }

    // ── Save state for next background run ────────────────────────────────
    await AsyncStorage.setItem(STORAGE_KEY_LAST_LEVEL, String(levelPct));
    await AsyncStorage.setItem(STORAGE_KEY_LAST_TIMESTAMP, String(now));
    await AsyncStorage.setItem(STORAGE_KEY_LAST_BACKGROUND_CHECK, String(now));
    await AsyncStorage.setItem(
      STORAGE_KEY_FIRED_WARNINGS,
      JSON.stringify(firedWarnings)
    );

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch (e) {
    console.error("[BackgroundBatteryTask] Error:", e);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/** Register the background task (call when always-on is enabled) */
export async function registerBackgroundBatteryTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_BATTERY_TASK
    );
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(BACKGROUND_BATTERY_TASK, {
        minimumInterval: 15 * 60, // 15 minutes (iOS minimum enforced by OS)
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch (e) {
    console.warn("[BackgroundBatteryTask] Registration failed:", e);
  }
}

/** Unregister the background task (call when always-on is disabled) */
export async function unregisterBackgroundBatteryTask(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      BACKGROUND_BATTERY_TASK
    );
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_BATTERY_TASK);
    }
  } catch (e) {
    console.warn("[BackgroundBatteryTask] Unregistration failed:", e);
  }
}

/**
 * Called from the in-app hook to keep the background task's stored drain rate
 * up to date. This ensures the predictive algorithm uses the most recent rate.
 */
export async function updateStoredDrainRate(
  levelPct: number,
  drainRatePerMin: number | null
): Promise<void> {
  const now = Date.now();
  await AsyncStorage.setItem(STORAGE_KEY_LAST_LEVEL, String(levelPct));
  await AsyncStorage.setItem(STORAGE_KEY_LAST_TIMESTAMP, String(now));
  if (drainRatePerMin !== null) {
    await AsyncStorage.setItem(
      STORAGE_KEY_LAST_DRAIN_RATE,
      String(drainRatePerMin)
    );
  }
}
