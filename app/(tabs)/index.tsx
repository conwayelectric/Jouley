import React, { useState, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
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

export default function HomeScreen() {
  const battery = useBatteryMonitor();
  const [isLowPowerMode, setIsLowPowerMode] = useState(false);
  const [lowPowerDismissed, setLowPowerDismissed] = useState(false);
  const [slowChargerDismissed, setSlowChargerDismissed] = useState(false);

  // Load persisted dismissals on mount
  useEffect(() => {
    AsyncStorage.multiGet(["dismiss_lowpower", "dismiss_slowcharger"]).then((pairs) => {
      if (pairs[0][1] === "1") setLowPowerDismissed(true);
      if (pairs[1][1] === "1") setSlowChargerDismissed(true);
    }).catch(() => {});
  }, []);
  const discount = useDiscountCode();
  const [discountCopied, setDiscountCopied] = useState(false);

  const thermal = useThermalState(
    battery.mode === "discharging" ? battery.drainRatePerMin : null,
    isLowPowerMode
  );

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
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.headerTitle}>CONWAY ELECTRIC</Text>
            <Text style={styles.headerSubtitle}>POWER MONITOR · {headerSubtitle.toUpperCase()}</Text>
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
                ? " Your battery is in good shape."
                : " Consider charging soon to avoid interruption."}
            </Text>
            <Text style={styles.infoCardNote}>
              Warnings will appear at 20, 15, 10, 7, 5, and 2 minutes remaining.
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
                Your battery is low. Go to Settings → Battery and turn on Low Power Mode to extend battery life.
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
              <Text style={[styles.suggestionTitle, styles.suggestionTitleBlue]}>Slow Charger Detected</Text>
              <Text style={[styles.suggestionBody, styles.suggestionBodyBlue]}>
                Charging at less than 0.2%/min. Try a higher-wattage charger or a different cable for faster charging.
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
              15% off your next Conway Electric purchase. Single-use code — valid for 30 days.
            </Text>
          </View>
        )}

        {/* Share Button */}
        <TouchableOpacity
          style={styles.shareButton}
          onPress={() => {
            const iosUrl = "https://apps.apple.com/app/id000000000"; // replace with real App Store ID after publish
            const androidUrl = "https://play.google.com/store/apps/details?id=space.manus.battery.guardian"; // replace after publish
            const storeUrl = Platform.OS === "android" ? androidUrl : iosUrl;
            Share.share({
              message: `I use the Conway Electric Power Monitor app so I always know how much time I have left in my battery. You can download it here: ${storeUrl}`,
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0D0D0D",
  },
  scroll: {
    flex: 1,
    backgroundColor: "#0D0D0D",
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
    color: "#FFFFFF",
    letterSpacing: 2,
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 10,
    fontWeight: "700",
    color: "#6B6B6B",
    letterSpacing: 1.5,
    marginTop: 2,
    textAlign: "center",
  },
  dividerLine: {
    height: 1,
    backgroundColor: "#2E2E2E",
    marginHorizontal: 0,
  },

  // Ring
  ringContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 28,
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
    color: "#FFFFFF",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  timeSubtext: {
    fontSize: 13,
    color: "#9A9A9A",
    textAlign: "center",
    fontWeight: "500",
  },

  // Info card
  infoCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#1A1A1A",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: "#2E2E2E",
    gap: 8,
  },
  infoCardTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#9A9A9A",
  },
  infoCardText: {
    fontSize: 14,
    color: "#FFFFFF",
    lineHeight: 22,
    fontWeight: "500",
  },
  infoCardNote: {
    fontSize: 12,
    color: "#6B6B6B",
    lineHeight: 18,
  },

  // Full charged banner
  fullBanner: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#0D2E1A",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1.5,
    borderColor: "#22C55E",
    gap: 14,
  },
  fullBannerIcon: {
    fontSize: 32,
  },
  fullBannerTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#22C55E",
    marginBottom: 4,
  },
  fullBannerText: {
    fontSize: 14,
    color: "#FFFFFF",
    fontWeight: "500",
  },

  // Unavailable
  unavailableCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#1A1A1A",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: "#2E2E2E",
  },
  unavailableText: {
    fontSize: 14,
    color: "#9A9A9A",
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
    color: "#3E3E3E",
  },

  // Web fallback
  webFallback: {
    flex: 1,
    backgroundColor: "#0D0D0D",
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  webText: {
    color: "#9A9A9A",
    textAlign: "center",
    fontSize: 16,
    lineHeight: 24,
  },

  // Device info card
  deviceCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#1A1A1A",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2E2E2E",
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
    backgroundColor: "#2E2E2E",
    marginHorizontal: 18,
  },
  deviceLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#6B6B6B",
  },
  deviceValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
    textAlign: "right",
    flex: 1,
    marginLeft: 16,
  },

  // Charging speed badge
  speedBadge: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: "#1A1A1A",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2E4A6E",
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: "center",
    gap: 4,
  },
  speedText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#5B8DB8",
    letterSpacing: 0.5,
  },
  speedSub: {
    fontSize: 11,
    fontWeight: "600",
    color: "#6B6B6B",
    letterSpacing: 1,
  },

  // Shared suggestion card (Low Power Mode + Slow Charger)
  suggestionCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#1A1200",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EAB30844",
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 18,
    paddingVertical: 14,
    gap: 12,
  },
  suggestionCardBlue: {
    backgroundColor: "#001A2A",
    borderColor: "#3B82F644",
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
    color: "#EAB308",
  },
  suggestionTitleBlue: {
    color: "#60A5FA",
  },
  suggestionBody: {
    fontSize: 12,
    color: "#A89040",
    fontWeight: "500",
    lineHeight: 18,
  },
  suggestionBodyBlue: {
    color: "#5B8DB8",
  },
  suggestionDismiss: {
    paddingLeft: 4,
    paddingTop: 2,
    alignSelf: "flex-start",
  },
  suggestionDismissText: {
    fontSize: 16,
    color: "#6B6B6B",
    fontWeight: "400",
    lineHeight: 20,
  },

  // Discount code card
  discountCard: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#0D1F0D",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#22C55E55",
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
    color: "#22C55E",
  },
  discountExpiry: {
    fontSize: 10,
    fontWeight: "600",
    color: "#6B6B6B",
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
    color: "#FFFFFF",
    letterSpacing: 3,
    flex: 1,
  },
  discountCopyBtn: {
    backgroundColor: "#22C55E22",
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#22C55E55",
  },
  discountCopyText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#22C55E",
    letterSpacing: 0.5,
  },
  discountBody: {
    fontSize: 12,
    color: "#5A8A5A",
    fontWeight: "500",
    lineHeight: 18,
  },

  // Share button
  shareButton: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: "#1A1A1A",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#3A3A3A",
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
});
