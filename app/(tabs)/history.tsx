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
  Linking,
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
import {
  loadDailyLog,
  loadBaseline,
  computeHealthEstimate,
  buildDrainRateChartData,
  buildThermalChartData,
  DailyHealthEntry,
  HealthBaseline,
} from "@/lib/health-history";
import { HealthLineChart } from "@/components/health-line-chart";

const SCREEN_WIDTH = Dimensions.get("window").width;
const CHART_PADDING = 32;
const CHART_WIDTH = SCREEN_WIDTH - 32 - CHART_PADDING * 2;
const CHART_HEIGHT = 100;
const BAR_GAP = 6;

// ─── Weekly bar chart (existing) ───────────────────────────────────────────────

interface DayBar {
  label: string;
  date: string;
  avgDrainRate: number;
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
  const maxRate = Math.max(...bars.map((b) => b.avgDrainRate), 0.6);
  const barWidth = (CHART_WIDTH - BAR_GAP * (bars.length - 1)) / bars.length;
  const today = new Date().toLocaleDateString("en-US", { weekday: "short" });

  return (
    <View style={chartStyles.card}>
      <Text style={chartStyles.title}>7-DAY DRAIN RATE</Text>
      <Text style={chartStyles.subtitle}>Average drain rate per day (% per minute)</Text>
      <View style={chartStyles.chartArea}>
        <View style={chartStyles.yAxis}>
          <Text style={chartStyles.yLabel}>{maxRate.toFixed(2)}</Text>
          <Text style={chartStyles.yLabel}>{(maxRate / 2).toFixed(2)}</Text>
          <Text style={chartStyles.yLabel}>0</Text>
        </View>
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
  title: { fontSize: 11, fontWeight: "800", letterSpacing: 2, color: "#9CA3AF" },
  subtitle: { fontSize: 11, color: "#6B7280", fontWeight: "500", marginTop: -8 },
  chartArea: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  yAxis: { height: CHART_HEIGHT + 20, justifyContent: "space-between", alignItems: "flex-end", paddingBottom: 20, width: 28 },
  yLabel: { fontSize: 8, color: "#9CA3AF", fontWeight: "600" },
  barsContainer: { flex: 1, flexDirection: "row", alignItems: "flex-end", height: CHART_HEIGHT + 20 },
  barCol: { alignItems: "center" },
  barWrapper: { height: CHART_HEIGHT, justifyContent: "flex-end", width: "100%" },
  bar: { width: "100%", borderRadius: 4, minHeight: 2 },
  barLabel: { fontSize: 9, fontWeight: "700", color: "#9CA3AF", marginTop: 4, letterSpacing: 0.5 },
  barLabelToday: { color: "#111827" },
  barCount: { fontSize: 8, color: "#9CA3AF", fontWeight: "600" },
  legend: { flexDirection: "row", justifyContent: "center", gap: 16, flexWrap: "wrap" },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 10, color: "#6B7280", fontWeight: "500" },
});

// ─── Health trend section ───────────────────────────────────────────────────────

type TrendView = "30" | "90";

interface HealthTrendSectionProps {
  dailyLog: DailyHealthEntry[];
  baseline: HealthBaseline | null;
}

const TIER_COLORS: Record<string, string> = {
  excellent: "#16A34A",
  good: "#65A30D",
  fair: "#D97706",
  declining: "#DC2626",
};

function HealthTrendSection({ dailyLog, baseline }: HealthTrendSectionProps) {
  const [view, setView] = useState<TrendView>("30");
  const days = view === "30" ? 30 : 90;

  const drainPoints = buildDrainRateChartData(dailyLog, days);
  const thermalPoints = buildThermalChartData(dailyLog, days);

  // Compute health estimate from recent 14-day average
  const recent14 = buildDrainRateChartData(dailyLog, 14).filter((p) => p.hasData);
  const recentAvg =
    recent14.length > 0
      ? recent14.reduce((s, p) => s + p.value, 0) / recent14.length
      : null;
  const estimate = computeHealthEstimate(recentAvg, baseline);
  const tierColor = TIER_COLORS[estimate.tier] ?? "#6B7280";

  return (
    <>
      {/* Section header */}
      <View style={healthStyles.sectionHeader}>
        <Text style={healthStyles.sectionTitle}>BATTERY HEALTH TREND</Text>
        <View style={healthStyles.toggleRow}>
          {(["30", "90"] as TrendView[]).map((t) => (
            <TouchableOpacity
              key={t}
              onPress={() => setView(t)}
              style={[healthStyles.toggleBtn, view === t && healthStyles.toggleBtnActive]}
            >
              <Text style={[healthStyles.toggleLabel, view === t && healthStyles.toggleLabelActive]}>
                {t}D
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Health estimate badge */}
      <View style={[healthStyles.estimateCard, { borderLeftColor: tierColor }]}>
        <View style={healthStyles.estimateRow}>
          <Text style={[healthStyles.estimateLabel, { color: tierColor }]}>
            {estimate.label.toUpperCase()}
          </Text>
          {estimate.hasBaseline && (
            <Text style={healthStyles.estimateScore}>
              Score {estimate.score}/100
            </Text>
          )}
        </View>
        <Text style={healthStyles.estimateDesc}>{estimate.description}</Text>
      </View>

      {/* Drain rate line chart */}
      <HealthLineChart
        points={drainPoints}
        series="drain"
        title="DRAIN RATE OVER TIME"
        subtitle={`${days}-day average drain rate (%/min) — lower is better`}
        unit="%/min"
        maxValue={0.8}
      />

      {/* Thermal trend line chart */}
      <HealthLineChart
        points={thermalPoints}
        series="thermal"
        title="THERMAL TREND"
        subtitle={`${days}-day average thermal score — lower is cooler`}
        unit="score"
        maxValue={1.0}
      />

      {/* Thermal legend */}
      <View style={healthStyles.thermalLegend}>
        {[
          { color: "#00C2FF", label: "Cool" },
          { color: "#F5A623", label: "Warm" },
          { color: "#FF6B00", label: "Running Hot" },
          { color: "#FF2D2D", label: "Very Hot" },
        ].map(({ color, label }) => (
          <View key={label} style={healthStyles.legendItem}>
            <View style={[healthStyles.legendDot, { backgroundColor: color }]} />
            <Text style={healthStyles.legendLabel}>{label}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

const healthStyles = StyleSheet.create({
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#9CA3AF",
  },
  toggleRow: {
    flexDirection: "row",
    gap: 4,
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
    padding: 2,
  },
  toggleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  toggleLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.5,
  },
  toggleLabelActive: {
    color: "#111827",
  },
  estimateCard: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: "#F9FAFB",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderLeftWidth: 4,
    padding: 14,
    gap: 6,
  },
  estimateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  estimateLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  estimateScore: {
    fontSize: 11,
    fontWeight: "600",
    color: "#9CA3AF",
  },
  estimateDesc: {
    fontSize: 12,
    color: "#6B7280",
    lineHeight: 18,
  },
  thermalLegend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
    flexWrap: "wrap",
    marginHorizontal: 16,
    marginTop: -4,
    marginBottom: 4,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 10, color: "#6B7280", fontWeight: "500" },
});

// ─── Battery care info section ──────────────────────────────────────────────────

function BatteryCareSection() {
  return (
    <View style={careStyles.wrapper}>
      {/* Section header */}
      <Text style={careStyles.sectionTitle}>BATTERY CARE GUIDE</Text>

      {/* Tips card */}
      <View style={careStyles.card}>
        <Text style={careStyles.cardTitle}>Getting the most from your lithium-ion battery</Text>
        <Text style={careStyles.cardBody}>
          Lithium-ion batteries last longest when kept between 20% and 80% charge. Frequent full
          discharges to 0% and extended time at 100% both accelerate chemical wear. Charging
          overnight is fine occasionally, but making it a nightly habit can shorten overall
          battery lifespan over time.
        </Text>
        <Text style={careStyles.cardBody}>
          Heat is the primary enemy of battery health. Avoid leaving your device in direct sunlight
          or a hot car, and try not to use it heavily while it is charging — both raise internal
          temperature and speed up degradation.
        </Text>

        {/* Tip rows */}
        {[
          { icon: "⚡", tip: "Charge to 80% for daily use, 100% only when you need a full day" },
          { icon: "🌡", tip: "Keep your device cool — heat degrades cells faster than usage" },
          { icon: "🔋", tip: "Avoid draining to 0% regularly — partial cycles are gentler" },
          { icon: "🌙", tip: "Unplug once charged — extended time at 100% adds stress" },
          { icon: "✈", tip: "Store at around 50% if you will not use the device for weeks" },
        ].map(({ icon, tip }, i) => (
          <View key={i} style={careStyles.tipRow}>
            <Text style={careStyles.tipIcon}>{icon}</Text>
            <Text style={careStyles.tipText}>{tip}</Text>
          </View>
        ))}
      </View>

      {/* Extō charger card */}
      <View style={careStyles.extoCard}>
        <View style={careStyles.extoHeader}>
          <Text style={careStyles.extoBrand}>CONWAY ELECTRIC</Text>
          <Text style={careStyles.extoProduct}>Extō USB-C Smart Charger</Text>
        </View>
        <Text style={careStyles.extoBody}>
          Every Conway Electric Extō USB-C charger contains a smart identification chip that
          communicates directly with the connected device. It reads the battery's current state
          and adjusts voltage delivery in real time — providing the fastest safe charging speed
          while actively protecting long-term battery health.
        </Text>
        <Text style={careStyles.extoBody}>
          Unlike standard chargers that push maximum voltage regardless of battery state, the
          Extō chip throttles output as the battery approaches full — reducing heat buildup and
          chemical stress during the final charge phase where most degradation occurs.
        </Text>
        <TouchableOpacity
          style={careStyles.shopBtn}
          onPress={() => Linking.openURL("https://conwaygoods.com")}
        >
          <Text style={careStyles.shopBtnText}>SHOP CONWAYGOODS.COM</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const careStyles = StyleSheet.create({
  wrapper: {
    marginTop: 20,
    marginBottom: 8,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#9CA3AF",
    marginHorizontal: 16,
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#111827",
    lineHeight: 20,
  },
  cardBody: {
    fontSize: 13,
    color: "#6B7280",
    lineHeight: 20,
  },
  tipRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
  },
  tipIcon: {
    fontSize: 15,
    width: 22,
    textAlign: "center",
    marginTop: 1,
  },
  tipText: {
    flex: 1,
    fontSize: 12,
    color: "#374151",
    lineHeight: 18,
  },
  extoCard: {
    marginHorizontal: 16,
    backgroundColor: "#F0F9FF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#BAE6FD",
    padding: 16,
    gap: 10,
  },
  extoHeader: {
    gap: 2,
  },
  extoBrand: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#0EA5E9",
  },
  extoProduct: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0C4A6E",
    letterSpacing: 0.3,
  },
  extoBody: {
    fontSize: 13,
    color: "#0C4A6E",
    lineHeight: 20,
    opacity: 0.85,
  },
  shopBtn: {
    backgroundColor: "#0EA5E9",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 4,
  },
  shopBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 1.5,
  },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<DischargeSession[]>([]);
  const [dailyLog, setDailyLog] = useState<DailyHealthEntry[]>([]);
  const [baseline, setBaseline] = useState<HealthBaseline | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [data, log, bl] = await Promise.all([
      loadSessions(),
      loadDailyLog(),
      loadBaseline(),
    ]);
    setSessions(data);
    setDailyLog(log);
    setBaseline(bl);
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
          <Text style={styles.headerTitle}>CONWAY ELECTRIC</Text>
          <Text style={styles.headerSubtitle}>BATTERY BUDDY · SESSION HISTORY</Text>
        </View>
      </View>
      <View style={styles.dividerLine} />

      {loading ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>Loading...</Text>
        </View>
      ) : sessions.length === 0 ? (
        <FlatList
          data={[]}
          keyExtractor={() => "empty"}
          renderItem={null}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <>
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyIcon}>📋</Text>
                <Text style={styles.emptyTitle}>No Sessions Yet</Text>
                <Text style={styles.emptyText}>
                  Session history is recorded each time you unplug your device after a
                  discharge period. Plug in and unplug to start tracking.
                </Text>
              </View>
              <BatteryCareSection />
            </>
          }
        />
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
              <HealthTrendSection dailyLog={dailyLog} baseline={baseline} />
              <BatteryCareSection />
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
  safeArea: { flex: 1, backgroundColor: "#FFFFFF" },
  header: { alignItems: "center", paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
  headerText: { alignItems: "center" },
  headerTitle: { fontSize: 18, fontWeight: "900", color: "#111827", letterSpacing: 2, textAlign: "center" },
  headerSubtitle: { fontSize: 10, fontWeight: "700", color: "#9CA3AF", letterSpacing: 1.5, marginTop: 2, textAlign: "center" },
  dividerLine: { height: 1, backgroundColor: "#E5E7EB" },
  listContent: { paddingHorizontal: 0, paddingBottom: 40 },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  listHeaderText: { fontSize: 12, fontWeight: "700", color: "#9CA3AF", letterSpacing: 1 },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#FEF2F2", borderRadius: 8, borderWidth: 1, borderColor: "#FECACA" },
  clearBtnText: { fontSize: 12, fontWeight: "700", color: "#EF4444" },
  card: { backgroundColor: "#F9FAFB", borderRadius: 14, borderWidth: 1, borderColor: "#E5E7EB", marginBottom: 12, overflow: "hidden", marginHorizontal: 16 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" },
  cardDate: { fontSize: 13, fontWeight: "700", color: "#111827" },
  cardTime: { fontSize: 12, color: "#6B7280", fontWeight: "500" },
  statsGrid: { flexDirection: "row", paddingVertical: 14 },
  statCell: { flex: 1, alignItems: "center", gap: 4 },
  statDivider: { width: 1, backgroundColor: "#E5E7EB", marginVertical: 4 },
  statValue: { fontSize: 20, fontWeight: "800", color: "#111827" },
  statLabel: { fontSize: 9, fontWeight: "800", color: "#9CA3AF", letterSpacing: 1.5 },
  cardFooter: { flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#E5E7EB", gap: 8 },
  footerItem: { fontSize: 12, color: "#6B7280", fontWeight: "500" },
  emptyContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40, gap: 12 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: "800", color: "#111827", letterSpacing: 0.5 },
  emptyText: { fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 22 },
});
