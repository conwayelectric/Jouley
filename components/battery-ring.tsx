import React, { useEffect, useRef } from "react";
import { View, Text, Image, StyleSheet, Animated, Easing } from "react-native";
import Svg, { Circle, Line, Path, Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";
import { BatteryMode } from "@/hooks/use-battery-monitor";

const SIZE = 260;
const STROKE = 18;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_RATIO = 0.75; // 270° arc
const ARC_DEG = 270;
const START_DEG = 135;

// Light-mode ring colors
const COLOR_GREEN  = "#16A34A"; // 76–100%
const COLOR_YELLOW = "#CA8A04"; // 51–75%
const COLOR_ORANGE = "#EA580C"; // 21–50%
const COLOR_RED    = "#DC2626"; // 0–20%
const COLOR_TRACK  = "#E5E7EB"; // light grey track
const CX = SIZE / 2;
const CY = SIZE / 2;

function getRingColor(level: number, mode: BatteryMode): string {
  if (mode === "full") return COLOR_GREEN;
  if (level >= 76) return COLOR_GREEN;
  if (level >= 51) return COLOR_YELLOW;
  if (level >= 21) return COLOR_ORANGE;
  return COLOR_RED;
}

function polarToXY(angleDeg: number, r: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arcPath(startDeg: number, endDeg: number, r: number, strokeW: number): string {
  const inner = r - strokeW / 2;
  const outer = r + strokeW / 2;
  const s1 = polarToXY(startDeg, outer);
  const e1 = polarToXY(endDeg, outer);
  const s2 = polarToXY(endDeg, inner);
  const e2 = polarToXY(startDeg, inner);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return [
    `M ${s1.x} ${s1.y}`,
    `A ${outer} ${outer} 0 ${largeArc} 1 ${e1.x} ${e1.y}`,
    `L ${s2.x} ${s2.y}`,
    `A ${inner} ${inner} 0 ${largeArc} 0 ${e2.x} ${e2.y}`,
    "Z",
  ].join(" ");
}

interface BatteryRingProps {
  level: number;
  mode: BatteryMode;
  isCalculating: boolean;
  isLowPowerMode?: boolean;
}

const AnimatedSvgWrapper = Animated.createAnimatedComponent(View);

export function BatteryRing({ level, mode, isCalculating, isLowPowerMode }: BatteryRingProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const criticalOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (mode === "charging") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.07, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [mode]);

  useEffect(() => {
    if (mode === "discharging" && level <= 10) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(criticalOpacity, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(criticalOpacity, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      criticalOpacity.setValue(1);
    }
  }, [mode, level <= 10]);

  const ringColor = getRingColor(level, mode);

  // Arc geometry
  const arcStartDeg = START_DEG;
  const arcLength = CIRCUMFERENCE * ARC_RATIO;
  const filledLength = arcLength * (level / 100);
  const fillEndDeg = arcStartDeg + ARC_DEG * (level / 100);

  // Full-arc multi-color gradient path (red→orange→yellow→green across 270°)
  // The gradient runs from arc start → arc end using the full 270° span.
  // We always render the full gradient path, then mask it with the solid fill arc
  // by drawing the track on top of the unfilled portion — but since we need the
  // gradient to show only up to the current level, we render it as a filled path
  // that only covers the filled portion.
  const fullArcPath = level > 0 ? arcPath(arcStartDeg, fillEndDeg, RADIUS, STROKE) : null;

  // Gradient endpoints: start of arc → end of arc (full 270° span)
  // This makes the gradient span the entire possible arc so colors are consistent
  // regardless of current level.
  const gradFullStart = polarToXY(arcStartDeg, RADIUS);
  const gradFullEnd   = polarToXY(arcStartDeg + ARC_DEG, RADIUS);

  // Tip fade cap: last 5% of the filled arc fades to transparent
  const FADE_PCT = 5;
  const fadeSpanPct = Math.min(FADE_PCT, Math.max(0, level));
  const fadeStartDeg = arcStartDeg + ARC_DEG * ((level - fadeSpanPct) / 100);
  const fadePath = level >= 2 ? arcPath(fadeStartDeg, fillEndDeg, RADIUS, STROKE) : null;
  const gradTipStart = polarToXY(fadeStartDeg, RADIUS);
  const gradTipEnd   = polarToXY(fillEndDeg, RADIUS);

  // Tick marks
  const tickPercents = [5, 10, 20, 30, 40, 50, 60, 70, 75, 80, 90, 100];
  const TICK_LENGTH = 6;

  return (
    <View style={styles.container}>
      <AnimatedSvgWrapper
        style={[styles.svgWrapper, { transform: [{ scale: pulseAnim }] }]}
      >
        <Animated.View style={[styles.svgWrapper, { opacity: criticalOpacity }]}>
          <Svg width={SIZE} height={SIZE}>
            <Defs>
              {/*
                Full-arc multi-color gradient: red (arc start/0%) →
                orange (21%) → yellow (51%) → green (76%→100%).
                Gradient spans the full 270° arc from start to end point.
                gradientUnits="userSpaceOnUse" with raw pixel coords required.
              */}
              <LinearGradient
                id="arcMultiColor"
                x1={gradFullStart.x}
                y1={gradFullStart.y}
                x2={gradFullEnd.x}
                y2={gradFullEnd.y}
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset="0"    stopColor={COLOR_RED}    stopOpacity="1" />
                <Stop offset="0.20" stopColor={COLOR_RED}    stopOpacity="1" />
                <Stop offset="0.21" stopColor={COLOR_ORANGE} stopOpacity="1" />
                <Stop offset="0.50" stopColor={COLOR_ORANGE} stopOpacity="1" />
                <Stop offset="0.51" stopColor={COLOR_YELLOW} stopOpacity="1" />
                <Stop offset="0.75" stopColor={COLOR_YELLOW} stopOpacity="1" />
                <Stop offset="0.76" stopColor={COLOR_GREEN}  stopOpacity="1" />
                <Stop offset="1"    stopColor={COLOR_GREEN}  stopOpacity="1" />
              </LinearGradient>

              {/* Tip fade: full colour → transparent over last 5% */}
              <LinearGradient
                id="tipFade"
                x1={gradTipStart.x}
                y1={gradTipStart.y}
                x2={gradTipEnd.x}
                y2={gradTipEnd.y}
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset="0" stopColor={ringColor} stopOpacity="1" />
                <Stop offset="1" stopColor={ringColor} stopOpacity="0" />
              </LinearGradient>
            </Defs>

            {/* Track arc */}
            <Circle
              cx={CX} cy={CY} r={RADIUS}
              stroke={COLOR_TRACK}
              strokeWidth={STROKE}
              fill="none"
              strokeDasharray={`${arcLength} ${CIRCUMFERENCE}`}
              strokeLinecap="butt"
              transform={`rotate(${START_DEG} ${CX} ${CY})`}
            />

            {/* Multi-color gradient fill arc */}
            {fullArcPath && (
              <Path d={fullArcPath} fill="url(#arcMultiColor)" />
            )}

            {/* Tip fade cap on top */}
            {fadePath && (
              <Path d={fadePath} fill="url(#tipFade)" />
            )}

            {/* Tick marks + labels */}
            {tickPercents.map((pct) => {
              const tickDeg = arcStartDeg + ARC_DEG * (pct / 100);
              const tickRad = (tickDeg * Math.PI) / 180;
              const innerR = RADIUS - STROKE / 2 - 2;
              const outerR = innerR - TICK_LENGTH;
              const x1 = CX + innerR * Math.cos(tickRad);
              const y1 = CY + innerR * Math.sin(tickRad);
              const x2 = CX + outerR * Math.cos(tickRad);
              const y2 = CY + outerR * Math.sin(tickRad);
              const isActive = pct <= level;
              const showLabel = pct === 5 || pct === 10 || pct === 20 || pct === 50 || pct === 75 || pct === 100;

              const labelR = innerR - TICK_LENGTH - 10;
              let lx = CX + labelR * Math.cos(tickRad);
              let ly = CY + labelR * Math.sin(tickRad);

              if (pct === 75) {
                const tangentRad = tickRad - Math.PI / 2;
                lx += Math.cos(tangentRad) * 7;
                ly += Math.sin(tangentRad) * 7;
              }

              return (
                <React.Fragment key={pct}>
                  <Line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={isActive ? "#555555" : "#BBBBBB"}
                    strokeWidth={pct % 10 === 0 ? 2 : 1.2}
                    strokeLinecap="butt"
                  />
                  {showLabel && (
                    <SvgText
                      x={lx} y={ly}
                      textAnchor="middle"
                      alignmentBaseline="middle"
                      fontSize={8}
                      fontWeight="700"
                      fill={isActive ? "#333333" : "#AAAAAA"}
                      letterSpacing={0.5}
                    >
                      {pct}%
                    </SvgText>
                  )}
                </React.Fragment>
              );
            })}
          </Svg>
        </Animated.View>
      </AnimatedSvgWrapper>

      {/* Center content */}
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
        {isLowPowerMode && (
          <View style={styles.lowPowerBadge}>
            <Text style={styles.lowPowerText}>🐢 LOW POWER</Text>
          </View>
        )}
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
  svgWrapper: {
    position: "absolute",
    width: SIZE,
    height: SIZE,
  },
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
    color: "#6B7280",
    textTransform: "uppercase",
  },
  lowPowerBadge: {
    backgroundColor: "#FEF9C3",
    borderWidth: 1,
    borderColor: "#CA8A04",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  lowPowerText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#CA8A04",
    letterSpacing: 1.5,
  },
});
