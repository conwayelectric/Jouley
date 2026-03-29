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
const CX = SIZE / 2;
const CY = SIZE / 2;
const COLOR_TRACK = "#E5E7EB";

// Zone color boundaries (exact):
// 0–20%   → red   (#DC2626)
// 20–50%  → orange (#EA580C), blending from red at 20%
// 50–75%  → yellow (#CA8A04), blending from orange at 50%
// 75–100% → green  (#16A34A), blending from yellow at 75%
//
// Each blend zone spans 8 percentage points centered on the boundary.
// Outside blend zones the color is held solid.
const GRADIENT_STOPS: Array<{ pct: number; r: number; g: number; b: number }> = [
  { pct: 0,   r: 220, g: 38,  b: 38  }, // red (start)
  { pct: 16,  r: 220, g: 38,  b: 38  }, // red solid until here
  { pct: 24,  r: 234, g: 88,  b: 12  }, // orange (blend from red complete)
  { pct: 38,  r: 234, g: 88,  b: 12  }, // orange solid until here — blend to yellow begins
  { pct: 50,  r: 202, g: 138, b: 4   }, // yellow fully established AT 50%
  { pct: 68,  r: 202, g: 138, b: 4   }, // yellow solid until here — blend to green begins
  { pct: 78,  r: 22,  g: 163, b: 74  }, // green (blend from yellow complete)
  { pct: 100, r: 22,  g: 163, b: 74  }, // green (hold to end)
];

function interpolateColor(pct: number): string {
  // Find surrounding stops
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

function getRingColor(level: number, mode: BatteryMode): string {
  if (mode === "full") return interpolateColor(100);
  return interpolateColor(level);
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

// Build the list of colored arc segments for the filled portion.
// Each segment is 2° wide (135 segments total for full arc).
// Color is interpolated at the midpoint of each segment.
const SEGMENT_DEG = 2; // degrees per segment
function buildSegments(level: number): Array<{ startDeg: number; endDeg: number; color: string }> {
  if (level <= 0) return [];
  const fillDeg = ARC_DEG * (level / 100);
  const segs: Array<{ startDeg: number; endDeg: number; color: string }> = [];
  let deg = 0;
  while (deg < fillDeg) {
    const segEnd = Math.min(deg + SEGMENT_DEG, fillDeg);
    const midPct = ((deg + segEnd) / 2 / ARC_DEG) * 100;
    segs.push({
      startDeg: START_DEG + deg,
      endDeg: START_DEG + segEnd,
      color: interpolateColor(midPct),
    });
    deg = segEnd;
  }
  return segs;
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
  const segments = buildSegments(mode === "full" ? 100 : level);

  // Tip fade cap: last 5% of the filled arc fades to transparent
  const fillEndDeg = START_DEG + ARC_DEG * ((mode === "full" ? 100 : level) / 100);
  const FADE_PCT = 5;
  const effectiveLevel = mode === "full" ? 100 : level;
  const fadeSpanPct = Math.min(FADE_PCT, Math.max(0, effectiveLevel));
  const fadeStartDeg = START_DEG + ARC_DEG * ((effectiveLevel - fadeSpanPct) / 100);
  const fadePath = effectiveLevel >= 2 ? arcPath(fadeStartDeg, fillEndDeg, RADIUS, STROKE) : null;
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
              strokeDasharray={`${CIRCUMFERENCE * ARC_RATIO} ${CIRCUMFERENCE}`}
              strokeLinecap="butt"
              transform={`rotate(${START_DEG} ${CX} ${CY})`}
            />

            {/* Colored segments — each 2° wide, color interpolated from gradient stops */}
            {segments.map((seg, i) => (
              <Path
                key={i}
                d={arcPath(seg.startDeg, seg.endDeg, RADIUS, STROKE)}
                fill={seg.color}
              />
            ))}

            {/* Tip fade cap on top */}
            {fadePath && (
              <Path d={fadePath} fill="url(#tipFade)" />
            )}

            {/* Tick marks + labels */}
            {tickPercents.map((pct) => {
              const tickDeg = START_DEG + ARC_DEG * (pct / 100);
              const tickRad = (tickDeg * Math.PI) / 180;
              const innerR = RADIUS - STROKE / 2 - 2;
              const outerR = innerR - TICK_LENGTH;
              const x1 = CX + innerR * Math.cos(tickRad);
              const y1 = CY + innerR * Math.sin(tickRad);
              const x2 = CX + outerR * Math.cos(tickRad);
              const y2 = CY + outerR * Math.sin(tickRad);
              const isActive = pct <= effectiveLevel;
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
          {effectiveLevel}%
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
