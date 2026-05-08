/**
 * Daily Check-In Notifications
 *
 * Schedules four repeating daily notifications at fixed times:
 *   7:00 AM, 11:00 AM, 3:00 PM, 7:00 PM
 *
 * Each fires every day with the message:
 *   "Let's keep you charged. Open the JOULEY app and see how your battery is doing."
 *
 * These are independent of drain rate — they're gentle daily reminders to open
 * the app and check in. They complement the drain-rate-based nudge notifications.
 *
 * Uses CALENDAR trigger (hour/minute) so iOS reschedules them automatically
 * every day without any app involvement.
 */

import * as Notifications from "expo-notifications";
import { SchedulableTriggerInputTypes } from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const STORAGE_KEY_DAILY_CHECKIN_ENABLED = "conway_daily_checkin_enabled";

// Fixed notification identifiers — one per time slot
const NOTIF_ID_7AM  = "jouley-checkin-7am";
const NOTIF_ID_11AM = "jouley-checkin-11am";
const NOTIF_ID_3PM  = "jouley-checkin-3pm";
const NOTIF_ID_7PM  = "jouley-checkin-7pm";

const CHECK_IN_TITLE = "Let's keep you charged";
const CHECK_IN_BODY  = "Open the JOULEY app and see how your battery is doing.";

// The four daily check-in times [hour (24h), minute]
const CHECK_IN_TIMES: Array<{ id: string; hour: number; minute: number }> = [
  { id: NOTIF_ID_7AM,  hour: 7,  minute: 0 },
  { id: NOTIF_ID_11AM, hour: 11, minute: 0 },
  { id: NOTIF_ID_3PM,  hour: 15, minute: 0 },
  { id: NOTIF_ID_7PM,  hour: 19, minute: 0 },
];

/**
 * Schedule all four daily check-in notifications.
 * Each uses a CALENDAR trigger so iOS repeats them automatically every day.
 * Safe to call multiple times — cancels existing ones first to avoid duplicates.
 */
export async function scheduleDailyCheckIns(): Promise<void> {
  try {
    // Cancel any existing check-in notifications first
    await cancelDailyCheckIns();

    await Promise.all(
      CHECK_IN_TIMES.map(({ id, hour, minute }) =>
        Notifications.scheduleNotificationAsync({
          identifier: id,
          content: {
            title: CHECK_IN_TITLE,
            body: CHECK_IN_BODY,
            sound: false, // quiet reminder — no alert sound
          },
          trigger: {
            type: SchedulableTriggerInputTypes.CALENDAR,
            hour,
            minute,
            repeats: true, // fires every day at this time
          },
        }).catch((e) => {
          console.warn(`[JOULEY] Failed to schedule daily check-in ${id}:`, e);
        })
      )
    );
  } catch (error) {
    console.warn("[JOULEY] Failed to schedule daily check-ins:", error);
  }
}

/**
 * Cancel all four daily check-in notifications.
 */
export async function cancelDailyCheckIns(): Promise<void> {
  try {
    await Promise.all(
      CHECK_IN_TIMES.map(({ id }) =>
        Notifications.cancelScheduledNotificationAsync(id).catch(() => {})
      )
    );
  } catch (error) {
    console.warn("[JOULEY] Failed to cancel daily check-ins:", error);
  }
}

/**
 * Load the user's daily check-in preference from AsyncStorage.
 * Defaults to true (enabled) if never set.
 */
export async function getDailyCheckInEnabled(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY_DAILY_CHECKIN_ENABLED);
    return stored === null ? true : stored !== "false";
  } catch {
    return true;
  }
}

/**
 * Save the user's daily check-in preference and schedule/cancel accordingly.
 */
export async function setDailyCheckInEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY_DAILY_CHECKIN_ENABLED, String(enabled));
    if (enabled) {
      await scheduleDailyCheckIns();
    } else {
      await cancelDailyCheckIns();
    }
  } catch (error) {
    console.warn("[JOULEY] Failed to save daily check-in setting:", error);
  }
}
