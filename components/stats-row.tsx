import React from "react";
import { View, Text, StyleSheet } from "react-native";

// ─── Shared pastel palette (mirrors battery-ring.tsx gradient stops) ──────────
// Rose  (#F9A8A8): low battery / high drain / low time
// Peach (#FDBA8C): mid-low
// Yellow(#FDE68A): mid
// Sage  (#86EFAC): good / low drain / plenty of time

/** Returns the pastel ring color for a given battery level (0–100). */
export function pastelColorForLevel(level: number): string {
  if (level <= 20) return "#F9A8A8";   // pastel rose
  if (level <= 45) return "#FDBA8C";   // pastel peach
  if (level <= 70) return "#FDE68A";   // pastel yellow
  return "#86EFAC";                     // pastel sage green
}

/**
 * Drain rate color rules:
 *   >= 1.0 %/min  → pastel rose (high drain)
 *   >= 0.5 %/min  → pastel yellow (moderate)
 *   <  0.5 %/min  → pastel sage (low drain)
 */
export function pastelColorForDrainRate(rate: number): string {
  if (rate >= 1.0) return "#F9A8A8";
  if (rate >= 0.5) return "#FDE68A";
  return "#86EFAC";
}

/**
 * Time remaining color rules (minutes):
 *   < 20 min  → pastel rose
 *   < 45 min  → pastel yellow
 *   >= 45 min → pastel sage
 */
export function pastelColorForMinutes(minutes: number): string {
  if (minutes < 20) return "#F9A8A8";
  if (minutes < 45) return "#FDE68A";
  return "#86EFAC";
}

// ─────────────────────────────────────────────────────────────────────────────

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
  minutesRemaining: number | null;
  minutesToFull: number | null;
}

export function StatsRow({
  level,
  ratePerMin,
  timeValue,
  timeLabel,
  mode,
  minutesRemaining,
  minutesToFull,
}: StatsRowProps) {
  const rateStr = ratePerMin !== null ? `${ratePerMin.toFixed(2)}%/min` : "—";
  const rateLabel = mode === "charging" ? "CHARGE RATE" : "DRAIN RATE";

  // Current % — matches ring color
  const levelAccent = pastelColorForLevel(level);

  // Drain/charge rate accent
  let rateAccent = "#9CA3AF";
  if (ratePerMin !== null) {
    if (mode === "charging") {
      // Charge rate: faster = better = greener
      rateAccent = ratePerMin >= 1.0 ? "#86EFAC" : ratePerMin >= 0.5 ? "#FDE68A" : "#FDBA8C";
    } else {
      rateAccent = pastelColorForDrainRate(ratePerMin);
    }
  }

  // Time remaining / time to full accent
  let timeAccent = "#9CA3AF";
  if (mode === "discharging" && minutesRemaining !== null) {
    timeAccent = pastelColorForMinutes(minutesRemaining);
  } else if (mode === "charging" && minutesToFull !== null) {
    // For charging, less time to full = better = greener
    timeAccent = minutesToFull < 20 ? "#86EFAC" : minutesToFull < 45 ? "#FDE68A" : "#FDBA8C";
  }

  return (
    <View style={styles.container}>
      <StatTile label="CURRENT" value={`${level}%`} accent={levelAccent} />
      <View style={styles.divider} />
      <StatTile label={rateLabel} value={rateStr} accent={rateAccent} />
      <View style={styles.divider} />
      <StatTile label={timeLabel} value={timeValue} accent={timeAccent} />
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
