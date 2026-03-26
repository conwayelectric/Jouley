import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  loadSessions,
  clearSessions,
  formatSessionDate,
  formatSessionTime,
  formatDuration,
  DischargeSession,
} from "@/lib/session-history";

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<DischargeSession[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await loadSessions();
    setSessions(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleClear = () => {
    Alert.alert(
      "Clear History",
      "Are you sure you want to delete all session history? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear All",
          style: "destructive",
          onPress: async () => {
            await clearSessions();
            setSessions([]);
          },
        },
      ]
    );
  };

  const renderSession = ({ item }: { item: DischargeSession }) => {
    const dropped = item.startLevel - item.endLevel;
    const dropColor =
      dropped >= 30 ? "#EF4444" : dropped >= 15 ? "#F97316" : "#EAB308";

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardDate}>{formatSessionDate(item.startTime)}</Text>
          <Text style={styles.cardTime}>{formatSessionTime(item.startTime)}</Text>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{item.startLevel}%</Text>
            <Text style={styles.statLabel}>START</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statValue}>{item.endLevel}%</Text>
            <Text style={styles.statLabel}>END</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: dropColor }]}>
              -{dropped}%
            </Text>
            <Text style={styles.statLabel}>DROPPED</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <Text style={styles.footerItem}>
            ⏱ {formatDuration(item.durationMinutes)}
          </Text>
          {item.avgDrainRatePerMin > 0 && (
            <Text style={styles.footerItem}>
              📉 {item.avgDrainRatePerMin.toFixed(2)}%/min avg
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>CONWAY ELECTRIC</Text>
          <Text style={styles.headerSubtitle}>POWER MONITOR · SESSION HISTORY</Text>
        </View>
      </View>
      <View style={styles.dividerLine} />

      {loading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No Sessions Yet</Text>
          <Text style={styles.emptyText}>
            Session history is recorded each time you unplug your device after a
            discharge period. Plug in and unplug to start tracking.
          </Text>
        </View>
      ) : (
        <>
          <FlatList
            data={sessions}
            keyExtractor={(item) => item.id}
            renderItem={renderSession}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListHeaderComponent={
              <View style={styles.listHeader}>
                <Text style={styles.listHeaderText}>
                  {sessions.length} session{sessions.length !== 1 ? "s" : ""} recorded
                </Text>
                <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
                  <Text style={styles.clearBtnText}>Clear All</Text>
                </TouchableOpacity>
              </View>
            }
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#0D0D0D",
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
  },

  // List
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
  },
  listHeaderText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6B6B6B",
    letterSpacing: 1,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#2A1A1A",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#5A2020",
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#EF4444",
  },

  // Session card
  card: {
    backgroundColor: "#1A1A1A",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2E2E2E",
    marginBottom: 12,
    overflow: "hidden",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#2E2E2E",
  },
  cardDate: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  cardTime: {
    fontSize: 12,
    color: "#6B6B6B",
    fontWeight: "500",
  },
  statsGrid: {
    flexDirection: "row",
    paddingVertical: 14,
  },
  statCell: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  statDivider: {
    width: 1,
    backgroundColor: "#2E2E2E",
    marginVertical: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  statLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#6B6B6B",
    letterSpacing: 1.5,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#2E2E2E",
    gap: 8,
  },
  footerItem: {
    fontSize: 12,
    color: "#9A9A9A",
    fontWeight: "500",
  },

  // Empty state
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  emptyText: {
    fontSize: 14,
    color: "#6B6B6B",
    textAlign: "center",
    lineHeight: 22,
  },
});
