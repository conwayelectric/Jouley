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
  STORAGE_KEY_SOUND_ENABLED,
  registerBackgroundBatteryTask,
  unregisterBackgroundBatteryTask,
} from "@/lib/background-battery-task";
import { STORAGE_KEY_ONBOARDING_DONE } from "@/components/onboarding-overlay";

export default function SettingsScreen() {
  const [alwaysOn, setAlwaysOn] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notifGranted, setNotifGranted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    const [stored, { status }, lastCheckTs, soundStored] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEY_ALWAYS_ON),
      Notifications.getPermissionsAsync(),
      AsyncStorage.getItem(STORAGE_KEY_LAST_BACKGROUND_CHECK),
      AsyncStorage.getItem(STORAGE_KEY_SOUND_ENABLED),
    ]);
    // Default to true if never set
    setAlwaysOn(stored === null ? true : stored !== "false");
    setSoundEnabled(soundStored === null ? true : soundStored !== "false");
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

  const toggleSound = async (value: boolean) => {
    setSoundEnabled(value);
    await AsyncStorage.setItem(STORAGE_KEY_SOUND_ENABLED, String(value));
  };

  const resetWalkthrough = async () => {
    await AsyncStorage.removeItem(STORAGE_KEY_ONBOARDING_DONE);
    Alert.alert(
      "Walkthrough Reset",
      "The feature walkthrough will appear again the next time you open the Monitor tab.",
      [{ text: "OK" }]
    );
  };

  const requestNotifPermission = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === "granted") {
      setNotifGranted(true);
      // Also register background monitoring task now that we have permission
      const alwaysOn = await AsyncStorage.getItem(STORAGE_KEY_ALWAYS_ON);
      if (alwaysOn !== "false") {
        await registerBackgroundBatteryTask();
      }
    } else {
      Alert.alert(
        "Notifications Disabled",
        "To receive battery reminders, please enable notifications for Jouley in your device Settings.",
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
          <Text style={styles.headerSubtitle}>JOULEY</Text>
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
              trackColor={{ false: "#D1D5DB", true: "#16A34A" }}
              thumbColor={alwaysOn ? "#FFFFFF" : "#F9FAFB"}
              ios_backgroundColor="#D1D5DB"
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

        {/* Sound Section */}
        <Text style={styles.sectionLabel}>SOUND</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Completion Sound</Text>
              <Text style={styles.rowDesc}>
                Plays a sound effect when your battery reaches 100% fully charged.
              </Text>
            </View>
            <Switch
              value={soundEnabled}
              onValueChange={toggleSound}
              trackColor={{ false: "#D1D5DB", true: "#16A34A" }}
              thumbColor={soundEnabled ? "#FFFFFF" : "#F9FAFB"}
              ios_backgroundColor="#D1D5DB"
            />
          </View>
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

        {/* Walkthrough Section */}
        <Text style={styles.sectionLabel}>APP TOUR</Text>
        <View style={styles.card}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Feature Walkthrough</Text>
            <Text style={styles.rowDesc}>
              Re-run the interactive overlay tour that explains each dashboard feature.
            </Text>
          </View>
          <TouchableOpacity
            style={styles.resetButton}
            onPress={resetWalkthrough}
            activeOpacity={0.8}
          >
            <Text style={styles.resetButtonText}>Replay Tour</Text>
          </TouchableOpacity>
        </View>

        {/* Legal Section */}
        <Text style={styles.sectionLabel}>LEGAL</Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => Linking.openURL("https://conwaygoods.com/pages/jouley-privacy-policy")}
            activeOpacity={0.7}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Privacy Policy</Text>
              <Text style={styles.rowDesc}>
                Read how Jouley handles your data.
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
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
  safeArea: { flex: 1, backgroundColor: "#FFFFFF" },
  scroll: { flex: 1, backgroundColor: "#FFFFFF" },
  scrollContent: { paddingBottom: 40 },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { color: "#6B7280", fontSize: 16 },

  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: "#111827",
    letterSpacing: 3,
  },
  headerSubtitle: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.5,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginBottom: 24,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#9CA3AF",
    marginHorizontal: 20,
    marginBottom: 8,
    marginTop: 4,
  },

  card: {
    marginHorizontal: 16,
    marginBottom: 20,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
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
    color: "#111827",
    marginBottom: 4,
  },
  rowDesc: {
    fontSize: 13,
    color: "#6B7280",
    lineHeight: 19,
  },

  infoBox: {
    backgroundColor: "#F0FDF4",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#86EFAC",
  },
  infoText: {
    fontSize: 13,
    color: "#16A34A",
    lineHeight: 19,
  },
  warningBox: {
    backgroundColor: "#FFF7ED",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#FDBA74",
  },
  warningText: {
    fontSize: 13,
    color: "#EA580C",
    lineHeight: 19,
  },
  tipBox: {
    backgroundColor: "#EFF6FF",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  tipText: {
    fontSize: 13,
    color: "#1D4ED8",
    lineHeight: 19,
  },

  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: "flex-start",
    marginTop: 2,
  },
  badgeGranted: { backgroundColor: "#DCFCE7", borderWidth: 1, borderColor: "#16A34A" },
  badgeDenied: { backgroundColor: "#FEE2E2", borderWidth: 1, borderColor: "#DC2626" },
  badgeText: { fontSize: 12, fontWeight: "800", color: "#111827", letterSpacing: 1 },

  resetButton: {
    backgroundColor: "#0a7ea4",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 12,
  },
  resetButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },

  enableButton: {
    backgroundColor: "#111827",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  enableButtonText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },

  infoCardText: {
    fontSize: 14,
    color: "#6B7280",
    lineHeight: 20,
  },
  infoCardSubtext: {
    fontSize: 13,
    color: "#9CA3AF",
    lineHeight: 19,
    marginTop: 4,
  },
  thresholdGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  thresholdBadge: {
    backgroundColor: "#E5E7EB",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  thresholdText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
  },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#111827",
  },
  infoDivider: {
    height: 1,
    backgroundColor: "#E5E7EB",
  },

  chevron: {
    fontSize: 22,
    color: "#9CA3AF",
    alignSelf: "center",
    marginTop: 2,
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
    color: "#9CA3AF",
  },
});
