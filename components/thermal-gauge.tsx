import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";

export type ThermalZone = "cool" | "warm" | "hot" | "critical";

export interface ThermalGaugeProps {
  /** 0.0 – 1.0 where 0 = coolest, 1 = critical */
  value: number;
  zone: ThermalZone;
  label?: string;
}

const ZONE_COLORS: Record<ThermalZone, string> = {
  cool:     "#00C2FF",
  warm:     "#F5A623",
  hot:      "#FF6B00",
  critical: "#FF2D2D",
};

const ZONE_LABELS: Record<ThermalZone, string> = {
  cool:     "COOL",
  warm:     "WARM",
  hot:      "HOT",
  critical: "CRITICAL",
};

// Tick positions as fractions of the bar width (0–1)
const TICKS = [0, 0.25, 0.5, 0.75, 1.0];
const TICK_LABELS = ["C", "W", "H", "!", ""];

export function ThermalGauge({ value, zone, label }: ThermalGaugeProps) {
  const clampedValue = Math.max(0, Math.min(1, value));
  const animValue = useRef(new Animated.Value(clampedValue)).current;

  useEffect(() => {
    Animated.timing(animValue, {
      toValue: clampedValue,
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [clampedValue, animValue]);

  const activeColor = ZONE_COLORS[zone];

  return (
    <View style={styles.container}>
      {/* Row 1: Centered "DEVICE TEMP" title */}
      <Text style={styles.headerLabel}>DEVICE TEMP</Text>

      {/* Row 2: Colored zone label + optional detail, centered, below title */}
      <Text style={[styles.zoneLabel, { color: activeColor }]}>
        {ZONE_LABELS[zone]}{label ? `  ·  ${label}` : ""}
      </Text>

      {/* Row 3: Gauge bar */}
      <View style={styles.gaugeWrapper}>
        {/* Background track — segmented colour zones */}
        <View style={styles.track}>
          <View style={[styles.segment, { backgroundColor: ZONE_COLORS.cool, flex: 1 }]} />
          <View style={[styles.segment, { backgroundColor: ZONE_COLORS.warm, flex: 1 }]} />
          <View style={[styles.segment, { backgroundColor: ZONE_COLORS.hot, flex: 1 }]} />
          <View style={[styles.segment, { backgroundColor: ZONE_COLORS.critical, flex: 1 }]} />
        </View>

        {/* Dimming overlay — covers everything to the right of the needle */}
        <Animated.View
          style={[
            styles.dimOverlay,
            {
              left: animValue.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />

        {/* Needle / cursor */}
        <Animated.View
          style={[
            styles.needle,
            {
              left: animValue.interpolate({
                inputRange: [0, 1],
                outputRange: ["0%", "100%"],
              }),
              borderColor: activeColor,
            },
          ]}
        />

        {/* Tick marks */}
        {TICKS.map((pos, i) => (
          <View
            key={i}
            style={[styles.tick, { left: `${pos * 100}%` as any }]}
          />
        ))}
      </View>

      {/* Row 4: Tick labels */}
      <View style={styles.tickLabelRow}>
        {TICK_LABELS.map((lbl, i) => (
          <Text
            key={i}
            style={[
              styles.tickLabel,
              i === TICK_LABELS.length - 1 && { textAlign: "right" },
            ]}
          >
            {lbl}
          </Text>
        ))}
      </View>

      {/* Row 5: Zone description */}
      <Text style={[styles.zoneDescription, { color: activeColor }]}>
        {zone === "cool" && "Normal operating temperature — battery impact minimal"}
        {zone === "warm" && "Elevated temperature — slight increase in drain rate"}
        {zone === "hot" && "High load detected — battery draining faster than usual"}
        {zone === "critical" && "Critical thermal load — consider closing background apps"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: "#F9FAFB",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
    gap: 6,
  },
  headerLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1.5,
    textAlign: "center",
  },
  zoneLabel: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
    textAlign: "center",
    flexWrap: "wrap",
    flexShrink: 1,
  },
  gaugeWrapper: {
    height: 28,
    position: "relative",
    justifyContent: "center",
  },
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 4,
    bottom: 4,
    flexDirection: "row",
    borderRadius: 3,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#D1D5DB",
  },
  segment: {
    height: "100%",
    opacity: 0.35,
  },
  dimOverlay: {
    position: "absolute",
    top: 4,
    bottom: 4,
    right: 0,
    backgroundColor: "#FFFFFF",
    opacity: 0.72,
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  needle: {
    position: "absolute",
    width: 3,
    top: 0,
    bottom: 0,
    marginLeft: -1.5,
    borderRadius: 2,
    borderWidth: 1,
    backgroundColor: "#374151",
    shadowColor: "#374151",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 4,
  },
  tick: {
    position: "absolute",
    width: 1,
    top: 0,
    bottom: 0,
    backgroundColor: "#D1D5DB",
    marginLeft: -0.5,
  },
  tickLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  tickLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#6B7280",
    letterSpacing: 1,
    width: 16,
    textAlign: "center",
  },
  zoneDescription: {
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.3,
    opacity: 0.85,
  },
});
