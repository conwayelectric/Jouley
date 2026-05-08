/**
 * Scheduled Nudge Notifications
 *
 * Replaces the old threshold-based immediate notifications with a predictive
 * scheduling system. Instead of firing when a threshold is crossed, we calculate
 * WHEN each threshold will be crossed and schedule a future notification for that
 * exact time. iOS delivers scheduled notifications on time even when the app is
 * completely closed — no more bursts, no more missed alerts.
 *
 * Three urgency tiers (discharge only, suppressed above 60%):
 *
 *  Tier 1 — Gentle (battery 40–60%)
 *    "Stay charged today"
 *    "Tap to open JOULEY so we can keep an eye on your battery."
 *
 *  Tier 2 — Moderate (battery below 40%)
 *    "It's been a while since you checked your power level"
 *    "Tap to open JOULEY so we can see how your battery is doing."
 *
 *  Tier 3 — Urgent (battery below 25%)
 *    "Your battery may be getting low"
 *    "Tap to check your battery now."
 *
 * Scheduling logic:
 *  - Tier 1 fires when predicted time-to-40% arrives (if currently above 40%)
 *  - Tier 2 fires when predicted time-to-25% arrives (if currently above 25%)
 *  - Tier 3 fires when predicted time-to-15% arrives (if currently above 15%)
 *  - All tiers cancelled immediately when plugged in
 *  - Rescheduled whenever drain rate changes by >30% (e.g. video call, gaming spike)
 */

import * as Notifications from "expo-notifications";
import { SchedulableTriggerInputTypes } from "expo-notifications";

// Notification identifiers — fixed so we can cancel/replace individually
const NOTIF_ID_TIER1 = "jouley-nudge-tier1";
const NOTIF_ID_TIER2 = "jouley-nudge-tier2";
const NOTIF_ID_TIER3 = "jouley-nudge-tier3";

// Battery level thresholds that trigger each tier
const TIER1_LEVEL = 40; // gentle nudge fires when battery reaches 40%
const TIER2_LEVEL = 25; // moderate nudge fires when battery reaches 25%
const TIER3_LEVEL = 15; // urgent nudge fires when battery reaches 15%

// Minimum seconds in the future for a scheduled notification (avoid near-instant)
const MIN_SECONDS_AHEAD = 30;

// Track the last drain rate we scheduled for — to detect significant changes
let lastScheduledDrainRate: number | null = null;

/**
 * Calculate seconds from now until the battery reaches a target level.
 * Returns null if the battery is already at or below the target, or if no rate.
 */
function secondsUntilLevel(
  currentLevelPct: number,
  targetLevelPct: number,
  drainRatePerMin: number
): number | null {
  if (currentLevelPct <= targetLevelPct) return null; // already past this threshold
  if (drainRatePerMin <= 0) return null;
  const minutesUntil = (currentLevelPct - targetLevelPct) / drainRatePerMin;
  const seconds = Math.floor(minutesUntil * 60);
  return seconds < MIN_SECONDS_AHEAD ? null : seconds;
}

/**
 * Schedule (or reschedule) the three-tier nudge notifications based on current
 * battery level and drain rate. Call this whenever the drain rate is updated.
 *
 * @param levelPct       Current battery level (0–100 integer)
 * @param drainRatePerMin Current drain rate (%/min, must be > 0)
 * @param force          If true, reschedule even if drain rate hasn't changed much
 */
export async function scheduleNudgeNotifications(
  levelPct: number,
  drainRatePerMin: number,
  force = false
): Promise<void> {
  // Suppress all notifications above 60% — no urgency at high charge
  if (levelPct > 60) {
    await cancelNudgeNotifications();
    // Reset so the next compute below 60% always reschedules fresh
    lastScheduledDrainRate = null;
    return;
  }

  // Only reschedule if drain rate changed by >30% (avoid thrashing every 5s).
  // A 30% change is meaningful — e.g. starting a video call or gaming session
  // that significantly accelerates drain, making the original schedule stale.
  if (!force && lastScheduledDrainRate !== null) {
    const changePct = Math.abs(drainRatePerMin - lastScheduledDrainRate) / lastScheduledDrainRate;
    if (changePct < 0.3) return;
  }

  lastScheduledDrainRate = drainRatePerMin;

  // Cancel existing nudge notifications before rescheduling
  await cancelNudgeNotifications();

  // Tier 1 — Gentle (only fires if battery is currently above 40%)
  const tier1Seconds = secondsUntilLevel(levelPct, TIER1_LEVEL, drainRatePerMin);
  if (tier1Seconds !== null) {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIF_ID_TIER1,
      content: {
        title: "Stay charged today",
        body: "Tap to open JOULEY so we can keep an eye on your battery.",
        sound: "battery-alert.wav",
      },
      trigger: {
        type: SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: tier1Seconds,
        repeats: false,
      },
    }).catch((e) => { console.warn('[JOULEY] Failed to schedule tier1 nudge:', e); });
  }

  // Tier 2 — Moderate (only fires if battery is currently above 25%)
  const tier2Seconds = secondsUntilLevel(levelPct, TIER2_LEVEL, drainRatePerMin);
  if (tier2Seconds !== null) {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIF_ID_TIER2,
      content: {
        title: "It's been a while since you checked your power level",
        body: "Tap to open JOULEY so we can see how your battery is doing.",
        sound: "battery-alert.wav",
      },
      trigger: {
        type: SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: tier2Seconds,
        repeats: false,
      },
    }).catch((e) => { console.warn('[JOULEY] Failed to schedule tier2 nudge:', e); });
  }

  // Tier 3 — Urgent (only fires if battery is currently above 15%)
  const tier3Seconds = secondsUntilLevel(levelPct, TIER3_LEVEL, drainRatePerMin);
  if (tier3Seconds !== null) {
    await Notifications.scheduleNotificationAsync({
      identifier: NOTIF_ID_TIER3,
      content: {
        title: "Your battery may be getting low",
        body: "Tap to check your battery now.",
        sound: "battery-alert.wav",
      },
      trigger: {
        type: SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: tier3Seconds,
        repeats: false,
      },
    }).catch((e) => { console.warn('[JOULEY] Failed to schedule tier3 nudge:', e); });
  }
}

/**
 * Cancel all scheduled nudge notifications.
 * Call this when the device is plugged in, fully charged, or monitoring is disabled.
 */
export async function cancelNudgeNotifications(): Promise<void> {
  await Promise.all([
    Notifications.cancelScheduledNotificationAsync(NOTIF_ID_TIER1).catch(() => {}),
    Notifications.cancelScheduledNotificationAsync(NOTIF_ID_TIER2).catch(() => {}),
    Notifications.cancelScheduledNotificationAsync(NOTIF_ID_TIER3).catch(() => {}),
  ]);
}

/**
 * Reset the drain rate tracking so the next call to scheduleNudgeNotifications
 * will always reschedule (e.g. after a mode transition).
 */
export function resetNudgeSchedule(): void {
  lastScheduledDrainRate = null;
}
