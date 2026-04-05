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

// Mirror the same gradient stops as battery-ring.tsx
// red:    0–16% solid, 16–28% blend → orange
// orange: 28–44% solid, 44–56% blend → yellow (#FFE135)
// yellow: 56–69% solid, 69–81% blend → green
// green:  81–100% solid
const GRADIENT_STOPS: Array<{ pct: number; r: number; g: number; b: number }> = [
  { pct: 0,   r: 220, g: 38,  b: 38  },
  { pct: 16,  r: 220, g: 38,  b: 38  },
  { pct: 28,  r: 234, g: 88,  b: 12  },
  { pct: 44,  r: 234, g: 88,  b: 12  },
  { pct: 56,  r: 255, g: 225, b: 53  },
  { pct: 69,  r: 255, g: 225, b: 53  },
  { pct: 81,  r: 22,  g: 163, b: 74  },
  { pct: 100, r: 22,  g: 163, b: 74  },
];

function interpolateColor(pct: number): string {
  let lo = GRADIENT_STOPS[0];
  let hi = GRADIENT_STOPS[GRADIENT_STOPS.length - 1];
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    if (pct >= GRADIENT_STOPS[i].pct && pct <= GRADIENT_STOPS[i + 1].pct) {
      lo = GRADIENT_STOPS[i];
      hi = GRADIENT_STOPS[i + 1];
      break;
    }
  }
  const span = hi.pct - lo.pct;
  const t = span === 0 ? 0 : (pct - lo.pct) / span;
  const r = Math.round(lo.r + t * (hi.r - lo.r));
  const g = Math.round(lo.g + t * (hi.g - lo.g));
  const b = Math.round(lo.b + t * (hi.b - lo.b));
  return `rgb(${r},${g},${b})`;
}

// Darken a color slightly for border/text use
function darkenColor(pct: number): string {
  let lo = GRADIENT_STOPS[0];
  let hi = GRADIENT_STOPS[GRADIENT_STOPS.length - 1];
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    if (pct >= GRADIENT_STOPS[i].pct && pct <= GRADIENT_STOPS[i + 1].pct) {
      lo = GRADIENT_STOPS[i];
      hi = GRADIENT_STOPS[i + 1];
      break;
    }
  }
  const span = hi.pct - lo.pct;
  const t = span === 0 ? 0 : (pct - lo.pct) / span;
  const r = Math.round((lo.r + t * (hi.r - lo.r)) * 0.75);
  const g = Math.round((lo.g + t * (hi.g - lo.g)) * 0.75);
  const b = Math.round((lo.b + t * (hi.b - lo.b)) * 0.75);
  return `rgb(${r},${g},${b})`;
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
          // arr is reversed: index 0 = 100%, last index = 10%
          // "next" milestone = not yet reached, but the one below it (index - 1) IS reached
          // (or it's the very bottom milestone and nothing is reached yet)
          const isNext = !m.reached && (index === 0 || arr[index - 1].reached);
          const milestoneColor = interpolateColor(m.percent);
          const milestoneDark = darkenColor(m.percent);

          return (
            <View key={m.percent} style={styles.row}>
              {/* Connector line */}
              {index < arr.length - 1 && (
                <View
                  style={[
                    styles.connector,
                    { backgroundColor: m.reached ? milestoneColor : "#E5E7EB" },
                  ]}
                />
              )}

              {/* Dot */}
              <View
                style={[
                  styles.dot,
                  m.reached
                    ? { backgroundColor: milestoneColor }
                    : isNext
                    ? { backgroundColor: milestoneColor, borderWidth: 2, borderColor: milestoneDark }
                    : styles.dotPending,
                ]}
              >
                {m.reached ? (
                  <Text style={[
                    styles.checkmark,
                    // Use dark text on bright yellow, white on darker colors
                    m.percent >= 44 && m.percent <= 69 ? { color: "#78350F" } : { color: "#FFFFFF" },
                  ]}>✓</Text>
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
                      ? { color: milestoneColor }
                      : isNext
                      ? { color: milestoneDark }
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
  dot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  dotPending: {
    backgroundColor: "#E5E7EB",
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  checkmark: {
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
  textPending: {
    color: "#9CA3AF",
  },
  etaLabel: {
    fontSize: 14,
    color: "#6B7280",
    fontWeight: "500",
  },
});
