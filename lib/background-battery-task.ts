/**
 * Background Battery Monitoring Task
 *
 * Registered globally (outside React) so it runs even when the app is closed.
 * Fires a push notification when battery drops below 30%, including drain rate.
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
export const STORAGE_KEY_FIRED_30 = "conway_fired_30_warning";
export const STORAGE_KEY_FIRST_LAUNCH = "conway_first_launch_done";

// Low battery threshold for background alert
const LOW_BATTERY_THRESHOLD = 30;

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
      // Reset the 30% warning flag when charging
      await AsyncStorage.removeItem(STORAGE_KEY_FIRED_30);
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }

    // Calculate drain rate from stored previous sample
    const [prevLevelStr, prevTimestampStr] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_LAST_LEVEL),
      AsyncStorage.getItem(STORAGE_KEY_LAST_TIMESTAMP),
    ]);

    let drainRatePerMin: number | null = null;
    if (prevLevelStr && prevTimestampStr) {
      const prevLevel = parseFloat(prevLevelStr);
      const prevTimestamp = parseInt(prevTimestampStr, 10);
      const deltaMin = (now - prevTimestamp) / 60_000;
      const deltaLevel = prevLevel - levelPct; // positive = draining
      if (deltaMin >= 5 && deltaLevel > 0) {
        drainRatePerMin = Math.min(deltaLevel / deltaMin, 1.5);
      }
    }

    // Store current reading for next comparison
    await AsyncStorage.setItem(STORAGE_KEY_LAST_LEVEL, String(levelPct));
    await AsyncStorage.setItem(STORAGE_KEY_LAST_TIMESTAMP, String(now));

    // Fire the 30% warning if not already fired this discharge cycle
    if (levelPct <= LOW_BATTERY_THRESHOLD) {
      const alreadyFired = await AsyncStorage.getItem(STORAGE_KEY_FIRED_30);
      if (alreadyFired !== "true") {
        await AsyncStorage.setItem(STORAGE_KEY_FIRED_30, "true");

        const rateStr = drainRatePerMin
          ? ` Drain rate: ${drainRatePerMin.toFixed(2)}%/min.`
          : "";
        const minutesStr = drainRatePerMin
          ? ` (~${Math.ceil(levelPct / drainRatePerMin)} min remaining)`
          : "";

        await Notifications.scheduleNotificationAsync({
          content: {
            title: `🔴 Low Battery — ${levelPct}% remaining`,
            body: `Your battery is running low.${minutesStr} Plug in soon.${rateStr}`,
            sound: true,
          },
          trigger: null,
        });
      }
    }

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
        minimumInterval: 15 * 60, // 15 minutes (iOS minimum)
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
