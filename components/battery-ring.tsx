import React, { useEffect, useRef } from "react";
import { View, Text, Image, StyleSheet, Animated, Easing } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { BatteryMode } from "@/hooks/use-battery-monitor";

const SIZE = 260;
const STROKE = 18;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_RATIO = 1.0; // 360° full circle — 50% = half, 100% = full

// Ring colors based on battery level
const COLOR_GREEN  = "#22C55E"; // 80–100%
const COLOR_ORANGE = "#F97316"; // 50–79%
const COLOR_YELLOW = "#EAB308"; // 21–49%
const COLOR_RED    = "#EF4444"; // 0–20%
const COLOR_TRACK  = "#2E2E2E";

function getRingColor(level: number, mode: BatteryMode): string {
  if (mode === "full") return COLOR_GREEN;
  if (level >= 80) return COLOR_GREEN;
  if (level >= 50) return COLOR_ORANGE;
  if (level >= 21) return COLOR_YELLOW;
  return COLOR_RED;
}

interface BatteryRingProps {
  level: number;
  mode: BatteryMode;
  isCalculating: boolean;
}

// Animated SVG wrapper — only the ring scales, nothing else
const AnimatedSvgWrapper = Animated.createAnimatedComponent(View);

export function BatteryRing({ level, mode, isCalculating }: BatteryRingProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for charging mode — only applied to the SVG wrapper
  useEffect(() => {
    if (mode === "charging") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.07,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [mode]);

  const ringColor = getRingColor(level, mode);
  const fillRatio = (level / 100) * ARC_RATIO;
  const strokeDashoffset = CIRCUMFERENCE * (1 - fillRatio);
  const rotation = -90; // arc starts at top (12 o'clock position)

  return (
    <View style={styles.container}>
      {/* Ring SVG — this is the ONLY thing that pulses */}
      <AnimatedSvgWrapper
        style={[
          styles.svgWrapper,
          { transform: [{ scale: pulseAnim }] },
        ]}
      >
        <Svg width={SIZE} height={SIZE}>
          {/* Track arc */}
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={COLOR_TRACK}
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={`${CIRCUMFERENCE * ARC_RATIO} ${CIRCUMFERENCE}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            transform={`rotate(${rotation} ${SIZE / 2} ${SIZE / 2})`}
          />
          {/* Fill arc */}
          <Circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            stroke={ringColor}
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={`${CIRCUMFERENCE * ARC_RATIO} ${CIRCUMFERENCE}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(${rotation} ${SIZE / 2} ${SIZE / 2})`}
          />
        </Svg>
      </AnimatedSvgWrapper>

      {/* Center content — NEVER moves or scales */}
      <View style={styles.centerContent} pointerEvents="none">
        <Image
          source={require("@/assets/images/conway_streetlight_logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={[styles.percentText, { color: ringColor }]}>
          {level}%
        </Text>
        <Text style={styles.modeLabel}>
          {mode === "charging"
            ? "CHARGING ⚡"
            : mode === "full"
            ? "FULLY CHARGED"
            : mode === "discharging"
            ? isCalculating
              ? "MEASURING..."
              : "DISCHARGING"
            : "UNKNOWN"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SIZE,
    height: SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  // The SVG wrapper sits absolutely behind center content
  svgWrapper: {
    position: "absolute",
    width: SIZE,
    height: SIZE,
  },
  // Center content is layered on top, perfectly still
  centerContent: {
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  logo: {
    width: 56,
    height: 56,
    marginBottom: 2,
  },
  percentText: {
    fontSize: 52,
    fontWeight: "800",
    letterSpacing: -2,
    lineHeight: 56,
  },
  modeLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    color: "#9A9A9A",
    textTransform: "uppercase",
  },
});
