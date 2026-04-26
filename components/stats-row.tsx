import React from "react";
import { View, Text, StyleSheet } from "react-native";

// ─── Conway brand color zones (mirrors battery-ring.tsx GRADIENT_STOPS) ──────
// critical (0–20%):   Conway Electric orange #E8450A
// low      (20–40%):  amber #F59E0B
// moderate (40–60%):  yellow #EAB308
// good     (60–100%): green #22C55E

/** Returns the gauge color for a given battery level (0–100). */
export function gaugeColorForLevel(level: number): string {
  if (level <= 20) return "#E8450A"; // Conway orange — critical
  if (level <= 40) return "#F59E0B"; // amber — low
  if (level <= 60) return "#EAB308"; // yellow — moderate
  return "#22C55E";                   // green — good
}

/**
 * Drain rate color rules:
 *   >= 1.0 %/min  → Conway orange (high drain = critical)
 *   >= 0.5 %/min  → amber (moderate drain)
 *   <  0.5 %/min  → green (low drain = good)
 */
export function gaugeColorForDrainRate(rate: number): string {
  if (rate >= 1.0) return "#E8450A";
  if (rate >= 0.5) return "#F59E0B";
  return "#22C55E";
}

/**
 * Time remaining color rules (minutes):
 *   < 20 min  → Conway orange (critical)
 *   < 45 min  → amber (low)
 *   >= 45 min → green (good)
 */
export function gaugeColorForMinutes(minutes: number): string {
  if (minutes < 20) return "#E8450A";
  if (minutes < 45) return "#F59E0B";
  return "#22C55E";
}

// Keep old names as aliases so existing imports in index.tsx don't break
export const pastelColorForLevel = gaugeColorForLevel;
export const pastelColorForDrainRate = gaugeColorForDrainRate;
export const pastelColorForMinutes = gaugeColorForMinutes;

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

  // Current % — matches ring color zone
  const levelAccent = gaugeColorForLevel(level);

  // Drain/charge rate accent
  let rateAccent = "#9CA3AF";
  if (ratePerMin !== null) {
    if (mode === "charging") {
      // Charge rate: faster = better = greener
      rateAccent = ratePerMin >= 1.0 ? "#22C55E" : ratePerMin >= 0.5 ? "#EAB308" : "#F59E0B";
    } else {
      rateAccent = gaugeColorForDrainRate(ratePerMin);
    }
  }

  // Time remaining / time to full accent
  let timeAccent = "#9CA3AF";
  if (mode === "discharging" && minutesRemaining !== null) {
    timeAccent = gaugeColorForMinutes(minutesRemaining);
  } else if (mode === "charging" && minutesToFull !== null) {
    // For charging, less time to full = better = greener
    timeAccent = minutesToFull < 20 ? "#22C55E" : minutesToFull < 45 ? "#EAB308" : "#F59E0B";
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
