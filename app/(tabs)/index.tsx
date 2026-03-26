import React from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Platform,
  Image,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { useBatteryMonitor } from "@/hooks/use-battery-monitor";
import { BatteryRing } from "@/components/battery-ring";
import { ChargingMilestones } from "@/components/charging-milestones";
import { StatsRow } from "@/components/stats-row";

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
          />
        </View>

        {/* Time Remaining / Time to Full Card */}
        <View style={styles.timeCard}>
          {battery.isCalculating ? (
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
                    ? `Charging at +${battery.chargeRatePerMin.toFixed(2)}% per minute`
                    : "Measuring charge rate..."
                  : battery.drainRatePerMin
                  ? `Draining at ${battery.drainRatePerMin.toFixed(2)}% per minute`
                  : "Measuring drain rate..."}
              </Text>
            </>
          )}
        </View>

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

        {/* Discharge info card */}
        {!isCharging && !battery.isCalculating && battery.minutesRemaining !== null && battery.minutesRemaining > 20 && (
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
});
