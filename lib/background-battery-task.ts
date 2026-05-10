/**
 * Background Battery Monitoring Task
 *
 * Registered globally (outside React) so it runs even when the app is closed.
 *
 * This task ONLY stores battery state for use by the in-app hook and the
 * predictive nudge notification system. It does NOT fire its own notifications
 * — all notifications are handled by scheduled-nudge-notifications.ts (which
 * schedules future iOS-native notifications that fire on time even when the
 * app is closed) and daily-checkin-notifications.ts (four daily reminders).
 *
 * Controlled by the "Always-On Monitoring" toggle in Settings (stored in AsyncStorage).
 */
import * as TaskManager from "expo-task-manager";
import * as BackgroundFetch from "expo-background-fetch";
import * as Battery from "expo-battery";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const BACKGROUND_BATTERY_TASK = "background-battery-monitor";

// Storage keys
export const STORAGE_KEY_ALWAYS_ON = "conway_always_on_monitoring";
export const STORAGE_KEY_LAST_LEVEL = "conway_last_battery_level";
export const STORAGE_KEY_LAST_TIMESTAMP = "conway_last_battery_timestamp";
export const STORAGE_KEY_LAST_DRAIN_RATE = "conway_last_drain_rate";
export const STORAGE_KEY_LAST_MODE = "conway_last_battery_mode"; // "discharging" | "charging"
export const STORAGE_KEY_LAST_CHARGE_LEVEL = "conway_last_charge_level";
export const STORAGE_KEY_LAST_CHARGE_TIMESTAMP = "conway_last_charge_timestamp";
export const STORAGE_KEY_LAST_CHARGE_RATE = "conway_last_charge_rate";
export const STORAGE_KEY_FIRED_WARNINGS = "conway_fired_warnings"; // JSON array of fired thresholds
export const STORAGE_KEY_FIRST_LAUNCH = "conway_first_launch_done";
export const STORAGE_KEY_SOUND_ENABLED = "conway_sound_enabled"; // "true" | "false", default true
export const STORAGE_KEY_LAST_BACKGROUND_CHECK = "conway_last_background_check";

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

    // ── Store battery state for in-app hook and nudge notification system ──
    // This task no longer fires its own notifications. All notifications are
    // handled by scheduled-nudge-notifications.ts (future-scheduled iOS alerts)
    // and daily-checkin-notifications.ts (four daily reminders).
    // This task only keeps drain rate data fresh for accurate nudge scheduling.

    // Retrieve stored state to update drain rate
    const [prevLevelStr, prevTimestampStr, prevDrainRateStr] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_LAST_LEVEL),
      AsyncStorage.getItem(STORAGE_KEY_LAST_TIMESTAMP),
      AsyncStorage.getItem(STORAGE_KEY_LAST_DRAIN_RATE),
    ]);

    const prevLevel = prevLevelStr ? parseFloat(prevLevelStr) : null;
    const prevTimestamp = prevTimestampStr ? parseInt(prevTimestampStr, 10) : null;
    // Update drain rate if we have a fresh reading while discharging
    if (
      batteryState === Battery.BatteryState.UNPLUGGED &&
      prevLevel !== null &&
      prevTimestamp !== null
    ) {
      const deltaMin = (now - prevTimestamp) / 60_000;
      const deltaLevel = prevLevel - levelPct; // positive = draining
      if (deltaMin >= 5 && deltaLevel > 0) {
        const freshRate = Math.min(deltaLevel / deltaMin, 1.5);
        await AsyncStorage.setItem(STORAGE_KEY_LAST_DRAIN_RATE, String(freshRate));
      }
    }

    // Save current level and timestamp for next background run
    await AsyncStorage.setItem(STORAGE_KEY_LAST_LEVEL, String(levelPct));
    await AsyncStorage.setItem(STORAGE_KEY_LAST_TIMESTAMP, String(now));
    await AsyncStorage.setItem(STORAGE_KEY_LAST_BACKGROUND_CHECK, String(now));

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
 * Called from the in-app hook to persist the current battery state so that:
 * - The background task's predictive algorithm always has a fresh drain rate.
 * - On next app open, the sample window can be seeded immediately for both
 *   discharging (drain rate) and charging (charge rate) modes.
 */
export async function updateStoredDrainRate(
  levelPct: number,
  drainRatePerMin: number | null
): Promise<void> {
  const now = Date.now();
  await AsyncStorage.multiSet([
    [STORAGE_KEY_LAST_LEVEL, String(levelPct)],
    [STORAGE_KEY_LAST_TIMESTAMP, String(now)],
    [STORAGE_KEY_LAST_MODE, "discharging"],
    ...(drainRatePerMin !== null
      ? [[STORAGE_KEY_LAST_DRAIN_RATE, String(drainRatePerMin)] as [string, string]]
      : []),
  ]);
}

/**
 * Called from the in-app hook while charging to persist the current level and
 * timestamp. On next app open in charging mode, this seeds the sample window
 * so the charge rate calculates immediately instead of waiting MIN_RATE_WINDOW_MS.
 */
export async function updateStoredChargeState(
  levelPct: number,
  chargeRatePerMin: number | null = null
): Promise<void> {
  const now = Date.now();
  await AsyncStorage.multiSet([
    [STORAGE_KEY_LAST_CHARGE_LEVEL, String(levelPct)],
    [STORAGE_KEY_LAST_CHARGE_TIMESTAMP, String(now)],
    [STORAGE_KEY_LAST_MODE, "charging"],
    ...(chargeRatePerMin !== null
      ? [[STORAGE_KEY_LAST_CHARGE_RATE, String(chargeRatePerMin)] as [string, string]]
      : []),
  ]);
}
