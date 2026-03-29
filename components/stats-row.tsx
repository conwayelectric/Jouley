import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface StatTileProps {
  label: string;
  value: string;
  accent?: string;
}

function StatTile({ label, value, accent = "#111827" }: StatTileProps) {
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
  const rateAccent = mode === "charging" ? "#1D4ED8" : "#DC2626";

  return (
    <View style={styles.container}>
      <StatTile label="CURRENT" value={`${level}%`} accent="#111827" />
      <View style={styles.divider} />
      <StatTile label={rateLabel} value={rateStr} accent={rateAccent} />
      <View style={styles.divider} />
      <StatTile label={timeLabel} value={timeValue} accent="#6B7280" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
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
    color: "#9CA3AF",
  },
  divider: {
    width: 1,
    height: 36,
    backgroundColor: "#E5E7EB",
  },
});
