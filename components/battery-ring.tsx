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
const START_DEG = 135; // arc starts at bottom-left, goes clockwise

// Ring colors based on battery level
const COLOR_GREEN  = "#22C55E"; // 76–100%
const COLOR_YELLOW = "#EAB308"; // 51–75%
const COLOR_ORANGE = "#F97316"; // 21–50%
const COLOR_RED    = "#EF4444"; // 0–20%
const COLOR_TRACK  = "#2E2E2E";
const CX = SIZE / 2;
const CY = SIZE / 2;

function getRingColor(level: number, mode: BatteryMode): string {
  if (mode === "full") return COLOR_GREEN;
  if (level >= 76) return COLOR_GREEN;
  if (level >= 51) return COLOR_YELLOW;
  if (level >= 21) return COLOR_ORANGE;
  return COLOR_RED;
}

/** Dim a hex colour for the gradient start (darker/more transparent version) */
function dimColor(hex: string): string {
  // Return a 50%-opacity version by appending alpha — used as gradient start
  return hex + "80";
}

/** Convert polar angle (degrees, 0=right, clockwise) to SVG x,y */
function polarToXY(angleDeg: number, r: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

/**
 * Build an SVG arc path for a partial circle (filled band).
 * startDeg / endDeg are in SVG coordinate space (0=right, clockwise).
 */
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
  const fillEndDeg = arcStartDeg + ARC_DEG * (level / 100);
  const arcLength = CIRCUMFERENCE * ARC_RATIO;

  // The fill arc as a path so we can apply a gradient fill to it
  const fillArcPath = level > 0 ? arcPath(arcStartDeg, fillEndDeg, RADIUS, STROKE) : null;

  // Gradient: runs from arc start point → arc tip point (both on the centre-line of the stroke)
  // gradientUnits="userSpaceOnUse" with raw pixel coords — required by react-native-svg
  const gradStartPt = polarToXY(arcStartDeg, RADIUS);
  const gradEndPt   = polarToXY(fillEndDeg, RADIUS);

  // Tick marks — 75 is explicitly listed so its label renders
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
                Full-arc gradient: from a dim/transparent version of the ring colour
                at the arc start → full ring colour at the tip.
                gradientUnits="userSpaceOnUse" with raw pixel coords is required.
              */}
              <LinearGradient
                id="arcGradient"
                x1={gradStartPt.x}
                y1={gradStartPt.y}
                x2={gradEndPt.x}
                y2={gradEndPt.y}
                gradientUnits="userSpaceOnUse"
              >
                <Stop offset="0"   stopColor={ringColor} stopOpacity="0.25" />
                <Stop offset="0.6" stopColor={ringColor} stopOpacity="0.85" />
                <Stop offset="1"   stopColor={ringColor} stopOpacity="1" />
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

            {/* Fill arc — gradient-filled path */}
            {fillArcPath && (
              <Path
                d={fillArcPath}
                fill="url(#arcGradient)"
              />
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

              // Default label position: further inside the ring along the radial
              const labelR = innerR - TICK_LENGTH - 10;
              let lx = CX + labelR * Math.cos(tickRad);
              let ly = CY + labelR * Math.sin(tickRad);

              // 75% sits at 337.5° (top-right of arc) — nudge it counter-clockwise
              // by shifting along the tangent direction so it clears the tick mark
              if (pct === 75) {
                const tangentRad = tickRad - Math.PI / 2; // 90° CCW = tangent direction
                lx += Math.cos(tangentRad) * 7;
                ly += Math.sin(tangentRad) * 7;
              }

              return (
                <React.Fragment key={pct}>
                  <Line
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke={isActive ? "#FFFFFF" : "#555555"}
                    strokeWidth={pct % 10 === 0 ? 2 : 1.2}
                    strokeLinecap="butt"
                  />
                  {showLabel && (
                    <SvgText
                      x={lx}
                      y={ly}
                      textAnchor="middle"
                      alignmentBaseline="middle"
                      fontSize={8}
                      fontWeight="700"
                      fill={isActive ? "#CCCCCC" : "#444444"}
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

      {/* Center content — never moves or scales */}
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
    color: "#9A9A9A",
    textTransform: "uppercase",
  },
  lowPowerBadge: {
    backgroundColor: "#2D2000",
    borderWidth: 1,
    borderColor: "#EAB308",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  lowPowerText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#EAB308",
    letterSpacing: 1.5,
  },
});
