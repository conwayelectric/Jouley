/**
 * Daily Check-In Notifications
 *
 * Schedules four repeating daily notifications at 7 AM, 11 AM, 3 PM, and 7 PM.
 * Each notification is a gentle reminder to open JOULEY and check battery status.
 *
 * Uses the DAILY trigger type (SchedulableTriggerInputTypes.DAILY) which is the
 * simplest and most reliable way to fire a notification at a fixed time every day
 * on iOS. Each notification has a stable identifier so rescheduling cancels the
 * old one first without creating duplicates.
 *
 * Controlled by the "Daily Reminders" toggle in Settings (stored in AsyncStorage).
 */
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const STORAGE_KEY_DAILY_CHECKIN_ENABLED = "conway_daily_checkin_enabled";

const NOTIFICATION_TITLE = "JOULEY";
const NOTIFICATION_BODY =
  "Let's keep you charged. Open the JOULEY app and see how your battery is doing.";

// Four daily check-in slots: identifier, hour (24h), minute
const DAILY_SLOTS: Array<{ id: string; hour: number; minute: number }> = [
  { id: "jouley-checkin-0700", hour: 7, minute: 0 },
  { id: "jouley-checkin-1100", hour: 11, minute: 0 },
  { id: "jouley-checkin-1500", hour: 15, minute: 0 },
  { id: "jouley-checkin-1900", hour: 19, minute: 0 },
];

/**
 * Schedule all four daily check-in notifications.
 * Safe to call multiple times — cancels existing ones first.
 */
export async function scheduleDailyCheckIns(): Promise<void> {
  try {
    // Cancel any existing check-in notifications first to avoid duplicates
    await cancelDailyCheckIns();

    for (const slot of DAILY_SLOTS) {
      await Notifications.scheduleNotificationAsync({
        identifier: slot.id,
        content: {
          title: NOTIFICATION_TITLE,
          body: NOTIFICATION_BODY,
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: slot.hour,
          minute: slot.minute,
        },
      });
    }
    console.log("[DailyCheckIns] Scheduled 4 daily check-in notifications.");
  } catch (error) {
    console.warn("[DailyCheckIns] Failed to schedule daily check-ins:", error);
  }
}

/**
 * Cancel all four daily check-in notifications.
 */
export async function cancelDailyCheckIns(): Promise<void> {
  try {
    await Promise.all(
      DAILY_SLOTS.map((slot) =>
        Notifications.cancelScheduledNotificationAsync(slot.id).catch(() => {})
      )
    );
  } catch (error) {
    console.warn("[DailyCheckIns] Failed to cancel daily check-ins:", error);
  }
}

/**
 * Get whether daily check-ins are enabled (default: true).
 */
export async function getDailyCheckInEnabled(): Promise<boolean> {
  try {
    const val = await AsyncStorage.getItem(STORAGE_KEY_DAILY_CHECKIN_ENABLED);
    return val !== "false"; // default enabled
  } catch {
    return true;
  }
}

/**
 * Enable or disable daily check-in notifications.
 * Schedules or cancels them immediately.
 */
export async function setDailyCheckInEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY_DAILY_CHECKIN_ENABLED, enabled ? "true" : "false");
  if (enabled) {
    await scheduleDailyCheckIns();
  } else {
    await cancelDailyCheckIns();
  }
}
