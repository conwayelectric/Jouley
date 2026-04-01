/**
 * Good Morning Notification
 *
 * Schedules a friendly daily notification at 7am if the battery starts the day below 50%.
 * The notification is scheduled once per day when the app opens, and automatically
 * reschedules itself for the next day.
 */
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY_GOOD_MORNING_SCHEDULED = "conway_good_morning_scheduled_date";
const NOTIFICATION_ID = "good-morning-low-battery";

/**
 * Schedule a good morning notification for 7am tomorrow if battery is below 50%.
 * Only schedules once per day (checks AsyncStorage to avoid duplicate scheduling).
 */
export async function scheduleGoodMorningNotification(currentBatteryLevel: number): Promise<void> {
  try {
    // Only schedule if battery is below 50%
    if (currentBatteryLevel >= 50) return;

    // Check if we've already scheduled for today
    const lastScheduled = await AsyncStorage.getItem(STORAGE_KEY_GOOD_MORNING_SCHEDULED);
    const today = new Date().toDateString();
    if (lastScheduled === today) return; // already scheduled for today

    // Cancel any existing good morning notification
    await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID);

    // Schedule for 7am tomorrow — calculate seconds from now
    const now = new Date();
    const tomorrow7am = new Date();
    tomorrow7am.setDate(now.getDate() + 1);
    tomorrow7am.setHours(7, 0, 0, 0);
    const secondsUntil7am = Math.max(60, Math.floor((tomorrow7am.getTime() - now.getTime()) / 1000));

    await Notifications.scheduleNotificationAsync({
      identifier: NOTIFICATION_ID,
      content: {
        title: "Good Morning",
        body: `Looks like your battery is starting at ${currentBatteryLevel}% today — worth grabbing a charger before you head out.`,
        sound: false,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsUntil7am,
        repeats: false,
      },
    });

    // Mark as scheduled for today
    await AsyncStorage.setItem(STORAGE_KEY_GOOD_MORNING_SCHEDULED, today);
  } catch (error) {
    // Silently fail — this is a nice-to-have feature
    console.warn("Failed to schedule good morning notification:", error);
  }
}

/**
 * Cancel the good morning notification (e.g. when battery is charged above 50%).
 */
export async function cancelGoodMorningNotification(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(NOTIFICATION_ID);
    await AsyncStorage.removeItem(STORAGE_KEY_GOOD_MORNING_SCHEDULED);
  } catch (error) {
    console.warn("Failed to cancel good morning notification:", error);
  }
}
