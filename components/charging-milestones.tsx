import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { MilestoneETA } from "@/hooks/use-battery-monitor";

function formatMinutes(minutes: number): string {
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

interface ChargingMilestonesProps {
  milestones: MilestoneETA[];
  currentLevel: number;
  isCalculating: boolean;
}

export function ChargingMilestones({
  milestones,
  currentLevel,
  isCalculating,
}: ChargingMilestonesProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>CHARGE MILESTONES</Text>
      <View style={styles.list}>
        {[...milestones].reverse().map((m, index, arr) => {
          // In reversed order, "next" is the first unreached milestone from the bottom
          // i.e. the last item in the reversed array that is unreached and whose successor (lower %) is reached
          const isNext = !m.reached && (index === arr.length - 1 || arr[index + 1].reached);
          return (
            <View key={m.percent} style={styles.row}>
              {/* Connector line — runs downward to next row */}
              {index < arr.length - 1 && (
                <View
                  style={[
                    styles.connector,
                    m.reached ? styles.connectorReached : styles.connectorPending,
                  ]}
                />
              )}
              {/* Dot */}
              <View
                style={[
                  styles.dot,
                  m.reached
                    ? styles.dotReached
                    : isNext
                    ? styles.dotNext
                    : styles.dotPending,
                ]}
              >
                {m.reached ? (
                  <Text style={styles.checkmark}>✓</Text>
                ) : (
                  <Text style={styles.dotPercent}>{m.percent}</Text>
                )}
              </View>

              {/* Label */}
              <View style={styles.labelContainer}>
                <Text
                  style={[
                    styles.percentLabel,
                    m.reached
                      ? styles.textReached
                      : isNext
                      ? styles.textNext
                      : styles.textPending,
                  ]}
                >
                  {m.percent}%
                  {m.percent === 100 ? " — Full" : ""}
                </Text>
                <Text style={styles.etaLabel}>
                  {m.reached
                    ? "Reached ✓"
                    : isCalculating
                    ? "Calculating..."
                    : m.minutesAway !== null
                    ? `in ${formatMinutes(m.minutesAway)}`
                    : "—"}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#9CA3AF",
    marginBottom: 16,
  },
  list: {
    gap: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 10,
    position: "relative",
  },
  connector: {
    position: "absolute",
    left: 19,
    top: 38,
    width: 2,
    height: 20,
    zIndex: 0,
  },
  connectorReached: {
    backgroundColor: "#1D4ED8",
  },
  connectorPending: {
    backgroundColor: "#E5E7EB",
  },
  dot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  dotReached: {
    backgroundColor: "#1D4ED8",
  },
  dotNext: {
    backgroundColor: "#DC2626",
    borderWidth: 2,
    borderColor: "#F87171",
  },
  dotPending: {
    backgroundColor: "#E5E7EB",
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  checkmark: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  dotPercent: {
    color: "#6B7280",
    fontSize: 10,
    fontWeight: "700",
  },
  labelContainer: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  percentLabel: {
    fontSize: 16,
    fontWeight: "700",
  },
  textReached: {
    color: "#1D4ED8",
  },
  textNext: {
    color: "#111827",
  },
  textPending: {
    color: "#9CA3AF",
  },
  etaLabel: {
    fontSize: 14,
    color: "#6B7280",
    fontWeight: "500",
  },
});
