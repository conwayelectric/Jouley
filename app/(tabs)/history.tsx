import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  StatusBar,
  Dimensions,
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

const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_PADDING = 32; // horizontal padding inside the chart card
const CHART_WIDTH = SCREEN_WIDTH - 32 - CHART_PADDING * 2; // card margins + inner padding
const CHART_HEIGHT = 100;
const BAR_GAP = 6;

interface DayBar {
  label: string; // e.g. "Mon"
  date: string;  // e.g. "Apr 1"
  avgDrainRate: number; // 0 if no sessions
  sessionCount: number;
}

function buildWeeklyBars(sessions: DischargeSession[]): DayBar[] {
  const bars: DayBar[] = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd = dayStart + 24 * 60 * 60 * 1000;

    const daySessions = sessions.filter(
      (s) => s.startTime >= dayStart && s.startTime < dayEnd && s.avgDrainRatePerMin > 0
    );

    const avgDrainRate =
      daySessions.length > 0
        ? daySessions.reduce((sum, s) => sum + s.avgDrainRatePerMin, 0) / daySessions.length
        : 0;

    bars.push({
      label: d.toLocaleDateString("en-US", { weekday: "short" }),
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      avgDrainRate,
      sessionCount: daySessions.length,
    });
  }

  return bars;
}

function drainColor(rate: number): string {
  if (rate <= 0) return "#E5E7EB";
  if (rate <= 0.15) return "#16A34A";
  if (rate <= 0.6) return "#D97706";
  return "#DC2626";
}

function WeeklyChart({ sessions }: { sessions: DischargeSession[] }) {
  const bars = buildWeeklyBars(sessions);
  const maxRate = Math.max(...bars.map((b) => b.avgDrainRate), 0.6); // at least 0.6 for scale
  const barWidth = (CHART_WIDTH - BAR_GAP * (bars.length - 1)) / bars.length;
  const today = new Date().toLocaleDateString("en-US", { weekday: "short" });

  return (
    <View style={chartStyles.card}>
      <Text style={chartStyles.title}>7-DAY DRAIN RATE</Text>
      <Text style={chartStyles.subtitle}>Average drain rate per day (% per minute)</Text>

      <View style={chartStyles.chartArea}>
        {/* Y-axis labels */}
        <View style={chartStyles.yAxis}>
          <Text style={chartStyles.yLabel}>{maxRate.toFixed(2)}</Text>
          <Text style={chartStyles.yLabel}>{(maxRate / 2).toFixed(2)}</Text>
          <Text style={chartStyles.yLabel}>0</Text>
        </View>

        {/* Bars */}
        <View style={chartStyles.barsContainer}>
          {bars.map((bar, i) => {
            const barH = bar.avgDrainRate > 0 ? (bar.avgDrainRate / maxRate) * CHART_HEIGHT : 2;
            const isToday = bar.label === today;
            return (
              <View key={i} style={[chartStyles.barCol, { width: barWidth, marginRight: i < bars.length - 1 ? BAR_GAP : 0 }]}>
                <View style={chartStyles.barWrapper}>
                  <View
                    style={[
                      chartStyles.bar,
                      {
                        height: barH,
                        backgroundColor: drainColor(bar.avgDrainRate),
                        opacity: bar.avgDrainRate === 0 ? 0.3 : 1,
                      },
                    ]}
                  />
                </View>
                <Text style={[chartStyles.barLabel, isToday && chartStyles.barLabelToday]}>
                  {bar.label}
                </Text>
                {bar.sessionCount > 0 && (
                  <Text style={chartStyles.barCount}>{bar.sessionCount}</Text>
                )}
              </View>
            );
          })}
        </View>
      </View>

      {/* Legend */}
      <View style={chartStyles.legend}>
        {[
          { color: "#16A34A", label: "Low (≤0.15)" },
          { color: "#D97706", label: "Medium" },
          { color: "#DC2626", label: "High (>0.6)" },
        ].map(({ color, label }) => (
          <View key={label} style={chartStyles.legendItem}>
            <View style={[chartStyles.legendDot, { backgroundColor: color }]} />
            <Text style={chartStyles.legendLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: CHART_PADDING,
    gap: 12,
  },
  title: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#9CA3AF",
  },
  subtitle: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "500",
    marginTop: -8,
  },
  chartArea: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
  },
  yAxis: {
    height: CHART_HEIGHT + 20,
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingBottom: 20,
    width: 28,
  },
  yLabel: {
    fontSize: 8,
    color: "#9CA3AF",
    fontWeight: "600",
  },
  barsContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    height: CHART_HEIGHT + 20,
  },
  barCol: {
    alignItems: "center",
  },
  barWrapper: {
    height: CHART_HEIGHT,
    justifyContent: "flex-end",
    width: "100%",
  },
  bar: {
    width: "100%",
    borderRadius: 4,
    minHeight: 2,
  },
  barLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#9CA3AF",
    marginTop: 4,
    letterSpacing: 0.5,
  },
  barLabelToday: {
    color: "#111827",
  },
  barCount: {
    fontSize: 8,
    color: "#9CA3AF",
    fontWeight: "600",
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    flexWrap: "wrap",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 10,
    color: "#6B7280",
    fontWeight: "500",
  },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────

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
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>BATTERY BUDDY</Text>
          <Text style={styles.headerSubtitle}>SESSION HISTORY</Text>
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
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          renderItem={renderSession}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              <WeeklyChart sessions={sessions} />
              <View style={styles.listHeader}>
                <Text style={styles.listHeaderText}>
                  {sessions.length} session{sessions.length !== 1 ? "s" : ""} recorded
                </Text>
                <TouchableOpacity onPress={handleClear} style={styles.clearBtn}>
                  <Text style={styles.clearBtnText}>Clear All</Text>
                </TouchableOpacity>
              </View>
            </>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FFFFFF",
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
  dividerLine: {
    height: 1,
    backgroundColor: "#E5E7EB",
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
    color: "#9CA3AF",
    letterSpacing: 1,
  },
  clearBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#FEF2F2",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  clearBtnText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#EF4444",
  },

  // Session card
  card: {
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
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
    borderBottomColor: "#E5E7EB",
  },
  cardDate: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
  },
  cardTime: {
    fontSize: 12,
    color: "#6B7280",
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
    backgroundColor: "#E5E7EB",
    marginVertical: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: "800",
    color: "#111827",
  },
  statLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#9CA3AF",
    letterSpacing: 1.5,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    gap: 8,
  },
  footerItem: {
    fontSize: 12,
    color: "#6B7280",
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
    color: "#111827",
    letterSpacing: 0.5,
  },
  emptyText: {
    fontSize: 14,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 22,
  },
});
