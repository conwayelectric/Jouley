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
        {milestones.map((m, index) => {
          const isNext = !m.reached && (index === 0 || milestones[index - 1].reached);
          return (
            <View key={m.percent} style={styles.row}>
              {/* Connector line */}
              {index < milestones.length - 1 && (
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
    backgroundColor: "#1A1A1A",
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: "#2E2E2E",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#9A9A9A",
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
    backgroundColor: "#5B8DB8",
  },
  connectorPending: {
    backgroundColor: "#2E2E2E",
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
    backgroundColor: "#5B8DB8",
  },
  dotNext: {
    backgroundColor: "#E8450A",
    borderWidth: 2,
    borderColor: "#FF6B35",
  },
  dotPending: {
    backgroundColor: "#2E2E2E",
    borderWidth: 1,
    borderColor: "#3E3E3E",
  },
  checkmark: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  dotPercent: {
    color: "#9A9A9A",
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
    color: "#5B8DB8",
  },
  textNext: {
    color: "#FFFFFF",
  },
  textPending: {
    color: "#6B6B6B",
  },
  etaLabel: {
    fontSize: 14,
    color: "#9A9A9A",
    fontWeight: "500",
  },
});
