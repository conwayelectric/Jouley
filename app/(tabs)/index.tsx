import React, { useEffect, useRef, useState } from "react";
import { OnboardingOverlay, STORAGE_KEY_ONBOARDING_DONE } from "@/components/onboarding-overlay";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import { STORAGE_KEY_SOUND_ENABLED } from "@/lib/background-battery-task";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  Image,
  StatusBar,
  TouchableOpacity,
  Linking,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import * as Battery from "expo-battery";
import { useBatteryMonitor } from "@/hooks/use-battery-monitor";
import { useThermalState } from "@/hooks/use-thermal-state";
import { BatteryRing } from "@/components/battery-ring";
import { ChargingMilestones } from "@/components/charging-milestones";
import { StatsRow } from "@/components/stats-row";
import { ThermalGauge } from "@/components/thermal-gauge";
import { useDiscountCode } from "@/hooks/use-discount-code";
import * as Clipboard from "expo-clipboard";

const fullyChargedSound = require("@/assets/sounds/fully-charged.mp3");

// Notifications only appear as native pop-ups when the app is backgrounded or closed.
// When the app is open, the dashboard shows live minutes remaining instead.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: false,   // suppress in-app alert
    shouldShowBanner: false,  // suppress in-app banner
    shouldShowList: true,     // still log to notification centre
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function formatTime(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/**
 * Discharge contextual message. Thresholds tuned to typical iPhone usage:
 * low ≤0.15%/min, medium 0.15–0.6%/min, high >0.6%/min.
 */
function getContextMessage(level: number, drainRatePerMin: number | null): string {
  if (level > 50) return "Looking good";
  const isLowDrain = drainRatePerMin !== null && drainRatePerMin <= 0.15;
  const isMedDrain = drainRatePerMin !== null && drainRatePerMin > 0.15 && drainRatePerMin <= 0.6;
  if (level > 30) {
    if (isLowDrain) return "You have plenty of time — your drain rate is nice and low";
    if (isMedDrain) return "Still a comfortable amount of battery left";
    return "A good time to start thinking about a charger";
  }
  if (level > 20) {
    if (isLowDrain) return "Battery is getting lower, but your drain rate is slow — no rush";
    if (isMedDrain) return "Getting lower — worth keeping an eye out for a charger";
    return "Now is a great time to find a charger";
  }
  if (level > 10) {
    if (isLowDrain) return "Battery is low, but your drain rate is low too — you have time to find a charge";
    return "Battery is getting low — a charger nearby would be helpful";
  }
  if (isLowDrain) return "No worries — battery is low but so is your drain rate, you have time to find a charge";
  return "Battery is very low — plugging in soon would be a good move";
}

/** Charging contextual message based on current level. */
function getChargingMessage(level: number, chargeRatePerMin: number | null): string {
  if (level >= 100) return "Fully charged — great time to unplug and go";
  if (level >= 80) return "Almost there — nearly fully charged";
  if (level >= 60) return "Charging nicely — you\'ll be back to full soon";
  if (level >= 40) {
    if (chargeRatePerMin !== null && chargeRatePerMin >= 1.0) return "Fast charging — you\'ll be good to go in no time";
    return "On your way back up — good progress";
  }
  if (level >= 20) return "On your way back up — keep it plugged in a little longer";
  return "Starting to charge — every minute plugged in helps";
}

export default function HomeScreen() {
  const battery = useBatteryMonitor();
  const [showOverlay, setShowOverlay] = useState(false);
  const [isLowPowerMode, setIsLowPowerMode] = useState(false);
  const [lowPowerDismissed, setLowPowerDismissed] = useState(false);

  // Check if onboarding overlay should be shown
  useEffect(() => {
    if (Platform.OS === "web") return;
    AsyncStorage.getItem(STORAGE_KEY_ONBOARDING_DONE).then((val) => {
      if (val !== "true") setShowOverlay(true);
    }).catch(() => {});
  }, []);
  const [slowChargerDismissed, setSlowChargerDismissed] = useState(false);
  const [drainSpikeDismissed, setDrainSpikeDismissed] = useState(false);
  const [unplugDismissed, setUnplugDismissed] = useState(false);
  const [fullChargeTime, setFullChargeTime] = useState<number | null>(null); // timestamp when battery first hit 100%
  const [healthData, setHealthData] = useState<{ avgDrainRate: number; sessionCount: number } | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const soundEnabledRef = useRef(true);
  const soundPlayer = useAudioPlayer(fullyChargedSound);
  const soundFiredRef = useRef(false); // prevent repeat within same full session

  // Load health data from session history
  useEffect(() => {
    import("@/lib/session-history").then(({ loadSessions }) => {
      loadSessions().then((sessions) => {
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const recent = sessions.filter((s) => s.startTime >= sevenDaysAgo && s.avgDrainRatePerMin > 0);
        if (recent.length >= 2) {
          const avg = recent.reduce((sum, s) => sum + s.avgDrainRatePerMin, 0) / recent.length;
          setHealthData({ avgDrainRate: avg, sessionCount: recent.length });
        }
      }).catch(() => {});
    });
  }, []);

  // Track when battery reaches 100% (for unplug tip)
  useEffect(() => {
    if (battery.mode === "full" && fullChargeTime === null) {
      setFullChargeTime(Date.now());
    }
    if (battery.mode !== "full") {
      setFullChargeTime(null);
      setUnplugDismissed(false);
    }
  }, [battery.mode, fullChargeTime]);

  // Schedule good morning notification if battery is below 50%
  useEffect(() => {
    if (Platform.OS === "web") return;
    import("@/lib/good-morning-notification").then(({ scheduleGoodMorningNotification }) => {
      scheduleGoodMorningNotification(battery.level).catch(() => {});
    });
  }, []); // Run once on mount

  // Load persisted dismissals and sound preference on mount
  useEffect(() => {
    AsyncStorage.multiGet(["dismiss_lowpower", "dismiss_slowcharger", STORAGE_KEY_SOUND_ENABLED]).then((pairs) => {
      if (pairs[0][1] === "1") setLowPowerDismissed(true);
      if (pairs[1][1] === "1") setSlowChargerDismissed(true);
      // Note: drain spike dismissal is session-only (not persisted) — resets each time app opens
      const soundVal = pairs[2][1];
      const enabled = soundVal === null ? true : soundVal !== "false";
      setSoundEnabled(enabled);
      soundEnabledRef.current = enabled;
    }).catch(() => {});

    // Enable audio playback in iOS silent mode
    if (Platform.OS !== "web") {
      setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
    }
  }, []);

  // Play Jacob's ladder sound when battery reaches 100% (fully charged)
  useEffect(() => {
    if (battery.mode === "full" && !soundFiredRef.current && soundEnabledRef.current && Platform.OS !== "web") {
      soundFiredRef.current = true;
      soundPlayer.seekTo(0);
      soundPlayer.play();
    }
    // Reset so it can fire again next time the battery reaches full
    if (battery.mode !== "full") {
      soundFiredRef.current = false;
    }
  }, [battery.mode, soundPlayer]);
  const discount = useDiscountCode();
  const [discountCopied, setDiscountCopied] = useState(false);

  const thermal = useThermalState(
    battery.mode === "discharging" ? battery.drainRatePerMin : null,
    isLowPowerMode
  );

  // Record thermal score to health history every 60 seconds
  useEffect(() => {
    if (Platform.OS === "web") return;
    const interval = setInterval(() => {
      import("@/lib/health-history").then(({ recordThermalSample }) => {
        recordThermalSample(thermal.score).catch(() => {});
      });
    }, 60_000);
    return () => clearInterval(interval);
  }, [thermal.score]);

  // Reset dismissals when mode changes (e.g. plug in / unplug) and clear storage
  const prevMode = useRef(battery.mode);
  useEffect(() => {
    if (prevMode.current !== battery.mode) {
      setLowPowerDismissed(false);
      setSlowChargerDismissed(false);
      AsyncStorage.multiRemove(["dismiss_lowpower", "dismiss_slowcharger"]).catch(() => {});
      prevMode.current = battery.mode;
    }
  }, [battery.mode]);

  // Persist dismissal helpers
  const dismissLowPower = () => {
    setLowPowerDismissed(true);
    AsyncStorage.setItem("dismiss_lowpower", "1").catch(() => {});
  };
  const dismissSlowCharger = () => {
    setSlowChargerDismissed(true);
    AsyncStorage.setItem("dismiss_slowcharger", "1").catch(() => {});
  };
  const dismissDrainSpike = () => {
    setDrainSpikeDismissed(true);
    // Session-only dismissal — no AsyncStorage persistence
  };
  const dismissUnplug = () => setUnplugDismissed(true);

  // How long has the battery been at 100%?
  const minutesAtFull = fullChargeTime !== null ? Math.floor((Date.now() - fullChargeTime) / 60000) : 0;

  // Detect Low Power Mode
  useEffect(() => {
    if (Platform.OS === "web") return;
    Battery.isLowPowerModeEnabledAsync().then(setIsLowPowerMode).catch(() => {});
    const sub = Battery.addLowPowerModeListener(({ lowPowerMode }) => {
      setIsLowPowerMode(lowPowerMode);
    });
    return () => sub.remove();
  }, []);

  const isCharging = battery.mode === "charging" || battery.mode === "full";

  const timeValue = isCharging
    ? formatTime(battery.minutesToFull)
    : formatTime(battery.minutesRemaining);

  const timeLabel = isCharging ? "TIME TO FULL" : "TIME LEFT";

  const headerSubtitle = isCharging
    ? battery.mode === "full"
      ? "Fully Charged"
      : "Charging"
    : battery.mode === "discharging"
    ? "On Battery"
    : "Monitoring...";

  if (Platform.OS === "web") {
    return (
      <View style={styles.webFallback}>
        <Text style={styles.webText}>
          Battery monitoring requires a physical iOS or Android device.
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>CONWAY ELECTRIC</Text>
            <Text style={styles.headerSubtitle}>JOULEY · {headerSubtitle.toUpperCase()}</Text>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.dividerLine} />

        {/* Battery Ring */}
        <View style={styles.ringContainer}>
          <BatteryRing
            level={battery.level}
            mode={battery.mode}
            isCalculating={battery.isCalculating}
            isLowPowerMode={isLowPowerMode}
          />
        </View>

        {/* Contextual positive status message */}
        {!battery.isCalculating && (
          <Text style={styles.contextMessage}>
            {isCharging
              ? getChargingMessage(battery.level, battery.chargeRatePerMin)
              : battery.mode === "discharging"
              ? getContextMessage(battery.level, battery.drainRatePerMin)
              : null}
          </Text>
        )}

        {/* Time Remaining / Time to Full Card */}
        <View style={styles.timeCard}>
          {battery.isCalculating ? (
            // Only shown on very first ever launch with zero stored data
            <>
              <Text style={styles.timeValue}>Calculating...</Text>
              <Text style={styles.timeSubtext}>
                Measuring {isCharging ? "charge" : "drain"} rate — please wait a moment
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.timeValue}>
                {isCharging
                  ? battery.mode === "full"
                    ? "Fully Charged 🎉"
                    : `Full in ${timeValue}`
                  : `${timeValue} remaining`}
              </Text>
              <Text style={styles.timeSubtext}>
                {isCharging
                  ? battery.chargeRatePerMin
                    ? `${battery.isRateEstimated ? "~" : ""}Charging at +${battery.chargeRatePerMin.toFixed(2)}% per minute${battery.isRateEstimated ? " (refining..." : ""}${battery.isRateEstimated ? ")" : ""}`
                    : "Measuring charge rate..."
                  : battery.drainRatePerMin
                  ? `${battery.isRateEstimated ? "~" : ""}Draining at ${battery.drainRatePerMin.toFixed(2)}% per minute${battery.isRateEstimated ? " (refining...)" : ""}`
                  : "Measuring drain rate..."}
              </Text>
            </>
          )}
        </View>

        {/* Charging Speed Label */}
        {isCharging && battery.mode !== "full" && battery.chargeRatePerMin !== null && (
          <View style={styles.speedBadge}>
            <Text style={styles.speedText}>
              {battery.chargeRatePerMin >= 0.5
                ? battery.chargeRatePerMin >= 1.0
                  ? "⚡ Fast Charging"
                  : "⚡ Standard Charging"
                : "🐢 Slow Charging"}
            </Text>
            <Text style={styles.speedSub}>
              {battery.chargeRatePerMin >= 0.5
                ? battery.chargeRatePerMin >= 1.0
                  ? "Approx. 20W+"
                  : "Approx. 12W"
                : "Approx. 5W or less"}
            </Text>
          </View>
        )}

        {/* Stats Row */}
        <StatsRow
          level={battery.level}
          ratePerMin={isCharging ? battery.chargeRatePerMin : battery.drainRatePerMin}
          timeValue={timeValue}
          timeLabel={timeLabel}
          mode={battery.mode}
        />

        {/* Device Model — single line, OS/Brand details live in Settings */}
        <View style={styles.deviceCard}>
          <View style={styles.deviceRow}>
            <Text style={styles.deviceLabel}>DEVICE</Text>
            <Text style={styles.deviceValue}>
              {Device.modelName ?? Device.deviceName ?? "Unknown Device"}
            </Text>
          </View>
        </View>

        {/* Charging Milestones (charging mode only) */}
        {isCharging && battery.mode !== "full" && (
          <ChargingMilestones
            milestones={battery.milestones}
            currentLevel={battery.level}
            isCalculating={battery.isCalculating}
          />
        )}

        {/* Fully Charged Banner */}
        {battery.mode === "full" && (
          <View style={styles.fullBanner}>
            <Text style={styles.fullBannerIcon}>🎉</Text>
            <View>
              <Text style={styles.fullBannerTitle}>BATTERY FULL</Text>
              <Text style={styles.fullBannerText}>
                Your device is fully charged. You can unplug now.
              </Text>
            </View>
          </View>
        )}

        {/* Thermal Gauge — shown when discharging and rate is available */}
        {!isCharging && (
          <ThermalGauge
            value={thermal.score}
            zone={thermal.zone}
            label={thermal.detail}
          />
        )}

        {/* Discharge info card */}
        {!isCharging && battery.minutesRemaining !== null && battery.minutesRemaining > 20 && (
          <View style={styles.infoCard}>
            <Text style={styles.infoCardTitle}>BATTERY STATUS</Text>
            <Text style={styles.infoCardText}>
              You have approximately {formatTime(battery.minutesRemaining)} of use remaining.
              {battery.minutesRemaining > 60
                ? " You're in great shape — plenty of power ahead."
                : " You're doing well. A charge now would keep you going all day."}
            </Text>
            <Text style={styles.infoCardNote}>
              We'll give you friendly reminders at 20, 15, 10, 7, 5, and 2 minutes so you're never caught off guard.
            </Text>
          </View>
        )}

        {/* Not available fallback */}
        {!battery.isAvailable && (
          <View style={styles.unavailableCard}>
            <Text style={styles.unavailableText}>
              Battery information is not available on this device or simulator.
              Please run on a physical device for full functionality.
            </Text>
          </View>
        )}

        {/* Low Power Mode suggestion — only shown when battery ≤20%, Low Power Mode is off, and not dismissed */}
        {battery.level <= 20 && !isLowPowerMode && battery.mode === "discharging" && !lowPowerDismissed && (
          <View style={styles.suggestionCard}>
            <Text style={styles.suggestionIcon}>🐢</Text>
            <View style={styles.suggestionText}>
              <Text style={styles.suggestionTitle}>Enable Low Power Mode</Text>
              <Text style={styles.suggestionBody}>
                Want to stretch your battery further? Go to Settings → Battery and turn on Low Power Mode — it can add significant extra time.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.suggestionDismiss}
              onPress={dismissLowPower}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.suggestionDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Slow charger tip — only shown when charging slowly and not dismissed */}
        {isCharging && battery.mode !== "full" && battery.chargeRatePerMin !== null && battery.chargeRatePerMin < 0.2 && !slowChargerDismissed && (
          <View style={[styles.suggestionCard, styles.suggestionCardBlue]}>
            <Text style={styles.suggestionIcon}>🔌</Text>
            <View style={styles.suggestionText}>
              <Text style={[styles.suggestionTitle, styles.suggestionTitleBlue]}>Boost Your Charge Speed</Text>
              <Text style={[styles.suggestionBody, styles.suggestionBodyBlue]}>
                You're charging, which is great. For even faster results, try a higher-wattage charger or a different cable.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.suggestionDismiss}
              onPress={dismissSlowCharger}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.suggestionDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Battery Health Estimate Card — shown when we have 7-day data */}
        {healthData !== null && !isCharging && (
          <View style={styles.healthCard}>
            <Text style={styles.healthCardTitle}>7-DAY BATTERY HEALTH</Text>
            <View style={styles.healthRow}>
              <View style={styles.healthStat}>
                <Text style={styles.healthStatValue}>{healthData.avgDrainRate.toFixed(2)}%</Text>
                <Text style={styles.healthStatLabel}>AVG DRAIN / MIN</Text>
              </View>
              <View style={styles.healthDivider} />
              <View style={styles.healthStat}>
                <Text style={styles.healthStatValue}>{healthData.sessionCount}</Text>
                <Text style={styles.healthStatLabel}>SESSIONS</Text>
              </View>
              <View style={styles.healthDivider} />
              <View style={styles.healthStat}>
                <Text style={[
                  styles.healthStatValue,
                  { color: healthData.avgDrainRate <= 0.15 ? "#16A34A" : healthData.avgDrainRate <= 0.6 ? "#D97706" : "#DC2626" }
                ]}>
                  {healthData.avgDrainRate <= 0.15 ? "Low" : healthData.avgDrainRate <= 0.6 ? "Medium" : "High"}
                </Text>
                <Text style={styles.healthStatLabel}>DRAIN TIER</Text>
              </View>
            </View>
            <Text style={styles.healthNote}>
              {healthData.avgDrainRate <= 0.15
                ? "Your battery usage over the past week has been very efficient. Keep it up."
                : healthData.avgDrainRate <= 0.6
                ? "Your battery usage is typical for normal smartphone use."
                : "Your drain rate has been higher than average this week. Check the Power Save Tips below for ways to extend your battery life."}
            </Text>
          </View>
        )}

        {/* Unplug Tip — shown when battery has been at 100% for 30+ minutes */}
        {battery.mode === "full" && minutesAtFull >= 30 && !unplugDismissed && (
          <View style={[styles.suggestionCard, styles.suggestionCardGreen]}>
            <Text style={styles.suggestionIcon}>🔌</Text>
            <View style={styles.suggestionText}>
              <Text style={[styles.suggestionTitle, styles.suggestionTitleGreen]}>Good Time to Unplug</Text>
              <Text style={[styles.suggestionBody, styles.suggestionBodyGreen]}>
                Your battery has been at 100% for {minutesAtFull} minutes. Unplugging now is good for your battery's long-term health.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.suggestionDismiss}
              onPress={dismissUnplug}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.suggestionDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Drain Spike Card — shown when drain rate spikes 2× above baseline */}
        {battery.drainSpike && !isCharging && !drainSpikeDismissed && (
          <View style={[styles.suggestionCard, styles.suggestionCardAmber]}>
            <Text style={styles.suggestionIcon}>⚡</Text>
            <View style={styles.suggestionText}>
              <Text style={[styles.suggestionTitle, styles.suggestionTitleAmber]}>Higher Drain Detected</Text>
              <Text style={[styles.suggestionBody, styles.suggestionBodyAmber]}>
                Your battery is draining faster than usual. A power-hungry app may be running in the background. Check Settings → Battery to see which apps are using the most power.
              </Text>
              <TouchableOpacity
                onPress={() => Linking.openURL("App-prefs:BATTERY_USAGE").catch(() => Linking.openURL("App-prefs:root=BATTERY_USAGE").catch(() => {}))}
                style={styles.spikeButton}
              >
                <Text style={styles.spikeButtonText}>Check Battery Usage</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.suggestionDismiss}
              onPress={dismissDrainSpike}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.suggestionDismissText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Discount Code Card — shown until code expires (30 days after generation) */}
        {!discount.isLoading && discount.code && !discount.isExpired && (
          <View style={styles.discountCard}>
            <View style={styles.discountHeader}>
              <Text style={styles.discountLabel}>YOUR EXCLUSIVE DISCOUNT</Text>
              {discount.expiresAt && (
                <Text style={styles.discountExpiry}>
                  Expires {discount.expiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </Text>
              )}
            </View>
            <View style={styles.discountCodeRow}>
              <Text style={styles.discountCode}>{discount.code}</Text>
              <TouchableOpacity
                style={styles.discountCopyBtn}
                onPress={async () => {
                  if (discount.code) {
                    await Clipboard.setStringAsync(discount.code);
                    setDiscountCopied(true);
                    setTimeout(() => setDiscountCopied(false), 2000);
                  }
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.discountCopyText}>{discountCopied ? "✓ Copied" : "Copy"}</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.discountBody}>
              Conway Electric offers premium smart charging power cords and advanced lighting. Save 15% off your next purchase with this exclusive Jouley discount code. Single-use code — valid for 30 days.
            </Text>
            <TouchableOpacity
              style={styles.shopNowBtn}
              onPress={() => Linking.openURL("https://conwaygoods.com")}
              activeOpacity={0.75}
            >
              <Text style={styles.shopNowText}>SHOP CONWAYGOODS.COM</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Power Save Recommendations */}
        <View style={styles.powerSaveCard}>
          <Text style={styles.powerSaveTitle}>⚡ POWER SAVE TIPS</Text>
          <Text style={styles.powerSaveSubtitle}>Extend your battery life with these steps</Text>
          <View style={styles.powerSaveDivider} />
          {[
            { icon: "🐢", tip: "Enable Low Power Mode", detail: "Settings → Battery → Low Power Mode. Reduces background activity and visual effects." },
            { icon: "🌑", tip: "Use Dark Mode", detail: "Dark mode on OLED screens can reduce battery draw by up to 30% at full brightness." },
            { icon: "📵", tip: "Close Background Apps", detail: "Swipe away apps you are not using. Background refresh consumes power even when idle." },
            { icon: "📡", tip: "Turn Off Wi-Fi & Bluetooth When Unused", detail: "Both radios constantly scan for networks and devices. Disable them when not needed." },
            { icon: "🔅", tip: "Lower Screen Brightness", detail: "The display is the single largest power consumer. Drop brightness to 50% or below." },
            { icon: "🎬", tip: "Avoid Streaming Video", detail: "Video streaming keeps the screen on, the CPU busy, and the radio active simultaneously." },
            { icon: "📍", tip: "Limit Location Services", detail: "Set apps to \"While Using\" only. GPS is one of the most power-intensive sensors." },
            { icon: "🔔", tip: "Reduce Push Notifications", detail: "Each notification wakes the screen and radio. Disable non-essential app notifications." },
            { icon: "✈️", tip: "Use Airplane Mode in Low Signal Areas", detail: "Searching for a weak signal drains battery fast. Use Airplane Mode + Wi-Fi instead." },
            { icon: "🔄", tip: "Disable Auto-Updates & Background Refresh", detail: "Settings → General → Background App Refresh. Turn off for apps that don't need it." },
          ].map(({ icon, tip, detail }, i) => (
            <View key={i} style={styles.powerSaveRow}>
              <Text style={styles.powerSaveIcon}>{icon}</Text>
              <View style={styles.powerSaveText}>
                <Text style={styles.powerSaveTip}>{tip}</Text>
                <Text style={styles.powerSaveDetail}>{detail}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Share Button */}
        <TouchableOpacity
          style={styles.shareButton}
          onPress={() => {
            const iosUrl = "https://apps.apple.com/app/id000000000"; // replace with real App Store ID after publish
            const androidUrl = "https://play.google.com/store/apps/details?id=space.manus.battery.guardian"; // replace after publish
            const storeUrl = Platform.OS === "android" ? androidUrl : iosUrl;
            Share.share({
              message: `I use Jouley so I always know how much time I have left in my battery. You can download it here: ${storeUrl}`,
              url: storeUrl, // iOS uses this for the native share sheet URL preview
            });
          }}
          activeOpacity={0.75}
        >
          <Text style={styles.shareIcon}>↑</Text>
          <Text style={styles.shareButtonText}>SHARE THIS APP</Text>
        </TouchableOpacity>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>CONWAY ELECTRIC · STAY CHARGED</Text>
        </View>
      </ScrollView>
      {/* Onboarding overlay — shown on first launch, sits above the dashboard */}
      {showOverlay && (
        <OnboardingOverlay onDone={() => setShowOverlay(false)} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  scroll: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  scrollContent: {
    paddingBottom: 40,
  },

  // Header
  header: {
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
  },
  headerText: {
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#111827",
    letterSpacing: 2,
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.5,
    marginTop: 2,
    textAlign: "center",
  },
  headerTagline: {
    fontSize: 11,
    fontWeight: "400",
    color: "#9CA3AF",
    letterSpacing: 0.5,
    marginTop: 3,
    textAlign: "center",
    fontStyle: "italic",
  },
  dividerLine: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginHorizontal: 0,
  },

  // Ring
  ringContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
  },
  contextMessage: {
    fontSize: 14,
    fontWeight: "500",
    color: "#374151",
    textAlign: "center",
    marginHorizontal: 24,
    marginBottom: 6,
    lineHeight: 20,
  },

  // Time card
  timeCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    alignItems: "center",
    gap: 6,
  },
  timeValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  timeSubtext: {
    fontSize: 13,
    color: "#6B7280",
    textAlign: "center",
    fontWeight: "500",
  },

  // Info card
  infoCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 8,
  },
  infoCardTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#9CA3AF",
  },
  infoCardText: {
    fontSize: 14,
    color: "#111827",
    lineHeight: 22,
    fontWeight: "500",
  },
  infoCardNote: {
    fontSize: 12,
    color: "#6B7280",
    lineHeight: 18,
  },

  // Full charged banner
  fullBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#F0FDF4",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1.5,
    borderColor: "#16A34A",
    gap: 14,
  },
  fullBannerIcon: {
    fontSize: 32,
  },
  fullBannerTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#16A34A",
    marginBottom: 4,
  },
  fullBannerText: {
    fontSize: 14,
    color: "#166534",
    fontWeight: "500",
  },

  // Unavailable
  unavailableCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  unavailableText: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 22,
  },

  // Footer
  footer: {
    alignItems: "center",
    paddingTop: 24,
    paddingBottom: 8,
  },
  footerText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 2,
    color: "#9CA3AF",
  },

  // Web fallback
  webFallback: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  webText: {
    color: "#6B7280",
    textAlign: "center",
    fontSize: 16,
    lineHeight: 24,
  },

  // Device info card
  deviceCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    overflow: "hidden",
  },
  deviceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  deviceDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginHorizontal: 18,
  },
  deviceLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#9CA3AF",
  },
  deviceValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
    textAlign: "right",
    flex: 1,
    marginLeft: 16,
  },

  // Charging speed badge
  speedBadge: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: "#EFF6FF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: "center",
    gap: 4,
  },
  speedText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#1D4ED8",
    letterSpacing: 0.5,
  },
  speedSub: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6B7280",
    letterSpacing: 1,
  },

  // Shared suggestion card (Low Power Mode + Slow Charger)
  suggestionCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#FFFBEB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FDE68A",
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 12,
  },
  suggestionCardBlue: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  suggestionIcon: {
    fontSize: 22,
    marginTop: 1,
  },
  suggestionText: {
    flex: 1,
    gap: 4,
  },
  suggestionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#92400E",
  },
  suggestionTitleBlue: {
    color: "#1D4ED8",
  },
  suggestionBody: {
    fontSize: 12,
    color: "#78350F",
    fontWeight: "500",
    lineHeight: 18,
  },
  suggestionBodyBlue: {
    color: "#1E40AF",
  },
  suggestionCardAmber: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FCD34D",
  },
  suggestionTitleAmber: {
    color: "#92400E",
  },
  suggestionBodyAmber: {
    color: "#78350F",
  },
  spikeButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: "#F59E0B",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  spikeButtonText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  suggestionDismiss: {
    paddingLeft: 4,
    paddingTop: 2,
    alignSelf: "flex-start",
  },
  suggestionDismissText: {
    fontSize: 16,
    color: "#9CA3AF",
    fontWeight: "400",
    lineHeight: 20,
  },

  // Discount code card
  discountCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#F0FDF4",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#86EFAC",
    padding: 18,
    gap: 10,
  },
  discountHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  discountLabel: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#16A34A",
  },
  discountExpiry: {
    fontSize: 10,
    fontWeight: "600",
    color: "#6B7280",
    letterSpacing: 0.5,
  },
  discountCodeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  discountCode: {
    fontSize: 22,
    fontWeight: "900",
    color: "#166534",
    letterSpacing: 3,
    flex: 1,
  },
  discountCopyBtn: {
    backgroundColor: "#DCFCE7",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  discountCopyText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#16A34A",
    letterSpacing: 0.5,
  },
  discountBody: {
    fontSize: 12,
    color: "#166534",
    fontWeight: "500",
    lineHeight: 18,
  },

  // Share button
  shareButton: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: "#111827",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#374151",
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  shareIcon: {
    fontSize: 18,
    color: "#FFFFFF",
    fontWeight: "700",
  },
  shareButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 2,
  },

  // Shop Now button inside discount card
  shopNowBtn: {
    marginTop: 12,
    backgroundColor: "#14532D",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  shopNowText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 1,
  },

  // Battery Health card
  healthCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 18,
    gap: 12,
  },
  healthCardTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#9CA3AF",
  },
  healthRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  healthStat: {
    alignItems: "center",
    flex: 1,
    gap: 4,
  },
  healthStatValue: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.5,
  },
  healthStatLabel: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: "#9CA3AF",
    textAlign: "center",
  },
  healthDivider: {
    width: 1,
    height: 40,
    backgroundColor: "#E5E7EB",
  },
  healthNote: {
    fontSize: 12,
    color: "#6B7280",
    lineHeight: 18,
    fontWeight: "500",
  },

  // Green suggestion card (unplug tip)
  suggestionCardGreen: {
    backgroundColor: "#F0FDF4",
    borderColor: "#86EFAC",
  },
  suggestionTitleGreen: {
    color: "#166534",
  },
  suggestionBodyGreen: {
    color: "#166534",
  },

  // Power Save Tips card
  powerSaveCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#F0F9FF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#BAE6FD",
    padding: 18,
  },
  powerSaveTitle: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
    color: "#0369A1",
    marginBottom: 4,
  },
  powerSaveSubtitle: {
    fontSize: 12,
    color: "#0284C7",
    fontWeight: "500",
    marginBottom: 12,
  },
  powerSaveDivider: {
    height: 1,
    backgroundColor: "#BAE6FD",
    marginBottom: 12,
  },
  powerSaveRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#E0F2FE",
  },
  powerSaveIcon: {
    fontSize: 18,
    width: 26,
    textAlign: "center",
    marginTop: 1,
  },
  powerSaveText: {
    flex: 1,
    gap: 2,
  },
  powerSaveTip: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0C4A6E",
    lineHeight: 20,
  },
  powerSaveDetail: {
    fontSize: 12,
    color: "#0369A1",
    lineHeight: 18,
    fontWeight: "400",
  },
});
