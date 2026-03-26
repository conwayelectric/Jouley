import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Switch,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  TouchableOpacity,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import {
  STORAGE_KEY_ALWAYS_ON,
  STORAGE_KEY_LAST_BACKGROUND_CHECK,
  registerBackgroundBatteryTask,
  unregisterBackgroundBatteryTask,
} from "@/lib/background-battery-task";

export default function SettingsScreen() {
  const [alwaysOn, setAlwaysOn] = useState(true);
  const [notifGranted, setNotifGranted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const [stored, { status }, lastCheckTs] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_ALWAYS_ON),
      Notifications.getPermissionsAsync(),
      AsyncStorage.getItem(STORAGE_KEY_LAST_BACKGROUND_CHECK),
    ]);
    // Default to true if never set
    setAlwaysOn(stored === null ? true : stored !== "false");
    setNotifGranted(status === "granted");
    if (lastCheckTs) {
      const d = new Date(parseInt(lastCheckTs, 10));
      setLastChecked(
        d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
        " at " +
        d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const toggleAlwaysOn = async (value: boolean) => {
    setAlwaysOn(value);
    await AsyncStorage.setItem(STORAGE_KEY_ALWAYS_ON, String(value));
    if (value) {
      await registerBackgroundBatteryTask();
    } else {
      await unregisterBackgroundBatteryTask();
    }
  };

  const requestNotifPermission = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === "granted") {
      setNotifGranted(true);
    } else {
      Alert.alert(
        "Notifications Disabled",
        "To receive battery warnings, please enable notifications for Conway Electric Power Monitor in your device Settings.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Settings",
            onPress: () => Linking.openSettings(),
          },
        ]
      );
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>SETTINGS</Text>
          <Text style={styles.headerSubtitle}>CONWAY ELECTRIC POWER MONITOR</Text>
        </View>
        <View style={styles.divider} />

        {/* Background Monitoring Section */}
        <Text style={styles.sectionLabel}>MONITORING</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Always-On Monitoring</Text>
              <Text style={styles.rowDesc}>
                Monitors battery in real time while the app is active, and uses OS-scheduled checks when the app is closed.
              </Text>
            </View>
            <Switch
              value={alwaysOn}
              onValueChange={toggleAlwaysOn}
              trackColor={{ false: "#3E3E3E", true: "#22C55E" }}
              thumbColor={alwaysOn ? "#FFFFFF" : "#9A9A9A"}
              ios_backgroundColor="#3E3E3E"
            />
          </View>
          {alwaysOn && (
            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                ✅ Active{"\n\n"}
                • App on screen: real-time monitoring every 15 seconds.{"\n"}
                • App in background (recently switched away): every 15 seconds for a few minutes. iOS may suspend the app after a short period to conserve battery.{"\n"}
                • App fully closed (swiped away): OS-scheduled check every ~15 minutes. Between checks, your stored drain rate is used to predict battery level and fire any missed warnings.{"\n\n"}
                All notifications include your current drain rate and estimated time remaining.
              </Text>
            </View>
          )}
          {!alwaysOn && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                ⚠️ Disabled — battery warnings will only appear while the app is open.
              </Text>
            </View>
          )}
        </View>

        {/* Notifications Section */}
        <Text style={styles.sectionLabel}>NOTIFICATIONS</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Push Notifications</Text>
              <Text style={styles.rowDesc}>
                Required for battery warnings at 20, 15, 10, 7, 5, and 2 minutes
                remaining, and for charging milestone alerts.
              </Text>
            </View>
            <View
              style={[
                styles.statusBadge,
                notifGranted ? styles.badgeGranted : styles.badgeDenied,
              ]}
            >
              <Text style={styles.badgeText}>
                {notifGranted ? "ON" : "OFF"}
              </Text>
            </View>
          </View>
          {!notifGranted && (
            <TouchableOpacity
              style={styles.enableButton}
              onPress={requestNotifPermission}
              activeOpacity={0.8}
            >
              <Text style={styles.enableButtonText}>Enable Notifications</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Warning Thresholds Info */}
        <Text style={styles.sectionLabel}>DISCHARGE WARNINGS</Text>
        <View style={styles.card}>
          <Text style={styles.infoCardText}>
            Push notifications are sent when battery time remaining reaches:
          </Text>
          <View style={styles.thresholdGrid}>
            {[20, 15, 10, 7, 5, 2].map((t) => (
              <View key={t} style={styles.thresholdBadge}>
                <Text style={styles.thresholdText}>{t} min</Text>
              </View>
            ))}
          </View>
          <Text style={styles.infoCardSubtext}>
            Each notification includes the current drain rate so you know how
            fast your battery is being used.
          </Text>
        </View>

        {/* Monitoring Status */}
        <Text style={styles.sectionLabel}>MONITORING STATUS</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Last Background Check</Text>
            <Text style={styles.infoValue}>
              {lastChecked ?? "Not yet run"}
            </Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Check Interval</Text>
            <Text style={styles.infoValue}>~15 min (OS scheduled)</Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Active Monitoring</Text>
            <Text style={styles.infoValue}>Every 15 sec (app open)</Text>
          </View>
        </View>

        {/* Device Info */}
        <Text style={styles.sectionLabel}>DEVICE</Text>
        <View style={styles.card}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Model</Text>
            <Text style={styles.infoValue}>
              {Device.modelName ?? "Unknown"}
            </Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>OS</Text>
            <Text style={styles.infoValue}>
              {Device.osName ?? Platform.OS} {Device.osVersion ?? ""}
            </Text>
          </View>
          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Brand</Text>
            <Text style={styles.infoValue}>
              {Device.brand ?? Device.manufacturer ?? "Apple"}
            </Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>CONWAY ELECTRIC · STAY CHARGED</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#0D0D0D" },
  scroll: { flex: 1, backgroundColor: "#0D0D0D" },
  scrollContent: { paddingBottom: 40 },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { color: "#9A9A9A", fontSize: 16 },

  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 3,
  },
  headerSubtitle: {
    fontSize: 10,
    fontWeight: "700",
    color: "#6B6B6B",
    letterSpacing: 1.5,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: "#2E2E2E",
    marginBottom: 24,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#6B6B6B",
    marginHorizontal: 20,
    marginBottom: 8,
    marginTop: 4,
  },

  card: {
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: "#1A1A1A",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2E2E2E",
    padding: 18,
    gap: 12,
  },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  rowText: { flex: 1 },
  rowTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  rowDesc: {
    fontSize: 13,
    color: "#9A9A9A",
    lineHeight: 19,
  },

  infoBox: {
    backgroundColor: "#0F2A1A",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#22C55E33",
  },
  infoText: {
    fontSize: 13,
    color: "#22C55E",
    lineHeight: 19,
  },
  warningBox: {
    backgroundColor: "#2A1A0F",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#F9731633",
  },
  warningText: {
    fontSize: 13,
    color: "#F97316",
    lineHeight: 19,
  },
  tipBox: {
    backgroundColor: "#1A1A2E",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#3B82F633",
  },
  tipText: {
    fontSize: 13,
    color: "#93C5FD",
    lineHeight: 19,
  },

  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: "flex-start",
    marginTop: 2,
  },
  badgeGranted: { backgroundColor: "#22C55E22", borderWidth: 1, borderColor: "#22C55E" },
  badgeDenied: { backgroundColor: "#EF444422", borderWidth: 1, borderColor: "#EF4444" },
  badgeText: { fontSize: 12, fontWeight: "800", color: "#FFFFFF", letterSpacing: 1 },

  enableButton: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  enableButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0D0D0D",
    letterSpacing: 0.5,
  },

  infoCardText: {
    fontSize: 14,
    color: "#9A9A9A",
    lineHeight: 20,
  },
  infoCardSubtext: {
    fontSize: 13,
    color: "#6B6B6B",
    lineHeight: 19,
    marginTop: 4,
  },
  thresholdGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  thresholdBadge: {
    backgroundColor: "#2E2E2E",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  thresholdText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#6B6B6B",
    letterSpacing: 1,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  infoDivider: {
    height: 1,
    backgroundColor: "#2E2E2E",
  },

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
});
