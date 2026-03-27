import React, { useEffect, useRef } from "react";
import { View, Text, Image, StyleSheet, Animated, Easing } from "react-native";
import Svg, { Circle, Line, Defs, LinearGradient, Stop, Text as SvgText } from "react-native-svg";
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

/** Convert polar angle (degrees, 0=right, clockwise) to SVG x,y */
function polarToXY(angleDeg: number, r: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: CX + r * Math.cos(rad),
    y: CY + r * Math.sin(rad),
  };
}

/**
 * Build an SVG arc path for a partial circle.
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

// Animated SVG wrapper — only the ring scales, nothing else
const AnimatedSvgWrapper = Animated.createAnimatedComponent(View);

export function BatteryRing({ level, mode, isCalculating, isLowPowerMode }: BatteryRingProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const criticalOpacity = useRef(new Animated.Value(1)).current;

  // Charging pulse — gentle scale on the SVG wrapper
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

  // Critical pulse — slow red opacity flash at ≤10%
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
  // START_DEG=135 in SVG space (0=right, clockwise), arc spans 270°
  const arcStartDeg = START_DEG;
  const arcEndDeg = START_DEG + ARC_DEG; // 405° = same as 45°

  // Filled portion end angle
  const fillEndDeg = arcStartDeg + ARC_DEG * (level / 100);

  // strokeDasharray approach for track (simpler, no path needed for track)
  const arcLength = CIRCUMFERENCE * ARC_RATIO;
  const filledLength = arcLength * (level / 100);

  // Tick marks: at 5%, 10%, 20%, 30%, ... 100%
  const tickPercents = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const TICK_INNER_OFFSET = STROKE / 2 + 4;  // inside the arc
  const TICK_LENGTH = 6;

  return (
    <View style={styles.container}>
      {/* Ring SVG — this is the ONLY thing that pulses (charging) */}
      <AnimatedSvgWrapper
        style={[
          styles.svgWrapper,
          { transform: [{ scale: pulseAnim }] },
        ]}
      >
        {/* Critical pulse overlay — only the fill arc fades */}
        <Animated.View style={[styles.svgWrapper, { opacity: criticalOpacity }]}>
          <Svg width={SIZE} height={SIZE}>
            <Defs>
              {/* Gradient for the leading tip of the fill arc — fades to transparent */}
              <LinearGradient id="tipFade" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={ringColor} stopOpacity="1" />
                <Stop offset="0.7" stopColor={ringColor} stopOpacity="1" />
                <Stop offset="1" stopColor={ringColor} stopOpacity="0" />
              </LinearGradient>
            </Defs>

            {/* Track arc — flat ends via strokeLinecap="butt" */}
            <Circle
              cx={CX}
              cy={CY}
              r={RADIUS}
              stroke={COLOR_TRACK}
              strokeWidth={STROKE}
              fill="none"
              strokeDasharray={`${arcLength} ${CIRCUMFERENCE}`}
              strokeLinecap="butt"
              transform={`rotate(${START_DEG} ${CX} ${CY})`}
            />

            {/* Fill arc — solid colour, flat ends */}
            {level > 0 && (
              <Circle
                cx={CX}
                cy={CY}
                r={RADIUS}
                stroke={ringColor}
                strokeWidth={STROKE}
                fill="none"
                strokeDasharray={`${filledLength} ${CIRCUMFERENCE}`}
                strokeLinecap="butt"
                transform={`rotate(${START_DEG} ${CX} ${CY})`}
              />
            )}

            {/* Gradient fade cap at the leading tip — a short arc segment at the tip */}
            {level > 2 && (
              (() => {
                // Draw a short arc segment at the leading edge of the fill,
                // covering the last ~8% of the filled arc, using gradient stroke.
                const fadeLengthPct = Math.min(8, level * 0.4);
                const fadeStartPct = level - fadeLengthPct;
                const fadeFilledLength = arcLength * (level / 100);
                const fadeStartLength = arcLength * (fadeStartPct / 100);
                const fadeSectionLength = fadeFilledLength - fadeStartLength;

                // We render this as a separate Circle with dashoffset to start at fadeStartLength
                return (
                  <Circle
                    cx={CX}
                    cy={CY}
                    r={RADIUS}
                    stroke={`url(#tipFade)`}
                    strokeWidth={STROKE}
                    fill="none"
                    strokeDasharray={`${fadeSectionLength} ${CIRCUMFERENCE}`}
                    strokeDashoffset={-fadeStartLength}
                    strokeLinecap="butt"
                    transform={`rotate(${START_DEG} ${CX} ${CY})`}
                  />
                );
              })()
            )}

            {/* Inner tick marks + labels at 25/50/75/100% */}
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
              // Label positions — placed further inside the ring
              const showLabel = pct === 5 || pct === 10 || pct === 25 || pct === 50 || pct === 75 || pct === 100;
              const labelR = innerR - TICK_LENGTH - 10;
              const lx = CX + labelR * Math.cos(tickRad);
              const ly = CY + labelR * Math.sin(tickRad);
              return (
                <React.Fragment key={pct}>
                  <Line
                    x1={x1} y1={y1}
                    x2={x2} y2={y2}
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
