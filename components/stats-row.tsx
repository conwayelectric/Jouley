import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface StatTileProps {
  label: string;
  value: string;
  accent?: string;
}

function StatTile({ label, value, accent = "#FFFFFF" }: StatTileProps) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.value, { color: accent }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

interface StatsRowProps {
  level: number;
  ratePerMin: number | null;
  timeValue: string;
  timeLabel: string;
  mode: "discharging" | "charging" | "full" | "unknown";
}

export function StatsRow({ level, ratePerMin, timeValue, timeLabel, mode }: StatsRowProps) {
  const rateStr = ratePerMin !== null ? `${ratePerMin.toFixed(2)}%/min` : "—";
  const rateLabel = mode === "charging" ? "CHARGE RATE" : "DRAIN RATE";
  const rateAccent = mode === "charging" ? "#5B8DB8" : "#E8450A";

  return (
    <View style={styles.container}>
      <StatTile label="CURRENT" value={`${level}%`} accent="#FFFFFF" />
      <View style={styles.divider} />
      <StatTile label={rateLabel} value={rateStr} accent={rateAccent} />
      <View style={styles.divider} />
      <StatTile label={timeLabel} value={timeValue} accent="#9A9A9A" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#1A1A1A",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2E2E2E",
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  tile: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  value: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  label: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    color: "#6B6B6B",
  },
  divider: {
    width: 1,
    height: 36,
    backgroundColor: "#2E2E2E",
  },
});
