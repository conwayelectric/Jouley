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

// Gradient color zones with tight 10% total blend (5% each side of boundary):
//
//  red    (#DC2626): 0–20% solid
//  blend  20–25%: red → orange
//  orange (#EA580C): 25–45% solid
//  blend  45–55%: orange → yellow
//  yellow (#FFE135): 55–70% solid
//  blend  70–80%: yellow → green
//  green  (#16A34A): 80–100% solid
//
// This keeps each color zone visually distinct and the transitions short and sharp.
const GRADIENT_STOPS: Array<{ pct: number; r: number; g: number; b: number }> = [
  { pct: 0,   r: 220, g: 38,  b: 38  }, // red solid start
  { pct: 20,  r: 220, g: 38,  b: 38  }, // red solid end → blend begins
  { pct: 25,  r: 234, g: 88,  b: 12  }, // orange solid start (blend from red complete)
  { pct: 45,  r: 234, g: 88,  b: 12  }, // orange solid end → blend begins
  { pct: 55,  r: 255, g: 225, b: 53  }, // yellow #FFE135 solid start (blend from orange complete)
  { pct: 70,  r: 255, g: 225, b: 53  }, // yellow solid end → blend begins
  { pct: 80,  r: 22,  g: 163, b: 74  }, // green solid start (blend from yellow complete)
  { pct: 100, r: 22,  g: 163, b: 74  }, // green solid end
];

function interpolateColor(pct: number): string {
  const stops = GRADIENT_STOPS;
  let lo = stops[0];
  let hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (pct >= stops[i].pct && pct <= stops[i + 1].pct) {
      lo = stops[i];
      hi = stops[i + 1];
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

// Center-line arc path for stroked rendering (no fill seams)
function arcStrokePath(startDeg: number, endDeg: number, r: number): string {
  const s = polarToXY(startDeg, r);
  const e = polarToXY(endDeg, r);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

// Filled annular wedge path (used only for tip fade cap)
function arcFillPath(startDeg: number, endDeg: number, r: number, strokeW: number): string {
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

// 1° segments — each colored by interpolating at its midpoint percentage
function buildSegments(level: number): Array<{ startDeg: number; endDeg: number; color: string }> {
  if (level <= 0) return [];
  const fillDeg = ARC_DEG * (level / 100);
  const segs: Array<{ startDeg: number; endDeg: number; color: string }> = [];
  let deg = 0;
  while (deg < fillDeg) {
    const segEnd = Math.min(deg + 1, fillDeg);
    const midPct = ((deg + segEnd) / 2 / ARC_DEG) * 100;
    segs.push({ startDeg: START_DEG + deg, endDeg: START_DEG + segEnd, color: interpolateColor(midPct) });
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

  const effectiveLevel = mode === "full" ? 100 : level;
  const ringColor = getRingColor(level, mode);
  const segments = buildSegments(effectiveLevel);

  // Tip fade cap: last 5% of arc fades to transparent
  const FADE_PCT = 5;
  const fadeSpanPct = Math.min(FADE_PCT, Math.max(0, effectiveLevel));
  const fillEndDeg = START_DEG + ARC_DEG * (effectiveLevel / 100);
  const fadeStartDeg = START_DEG + ARC_DEG * ((effectiveLevel - fadeSpanPct) / 100);
  const gradTipStart = polarToXY(fadeStartDeg, RADIUS);
  const gradTipEnd = polarToXY(fillEndDeg, RADIUS);

  const tickPercents = [5, 10, 20, 30, 40, 50, 60, 70, 75, 80, 90, 100];
  const TICK_LENGTH = 6;

  return (
    <View style={styles.container}>
      <AnimatedSvgWrapper style={[styles.svgWrapper, { transform: [{ scale: pulseAnim }] }]}>
        <Animated.View style={[styles.svgWrapper, { opacity: criticalOpacity }]}>
          <Svg width={SIZE} height={SIZE}>
            <Defs>
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

            {/* Gradient fill: 1° stroked segments, no fill-seam artifacts */}
            {segments.map((seg, i) => (
              <Path
                key={i}
                d={arcStrokePath(seg.startDeg, seg.endDeg, RADIUS)}
                stroke={seg.color}
                strokeWidth={STROKE}
                strokeLinecap="butt"
                fill="none"
              />
            ))}

            {/* Tip fade cap — filled wedge with gradient so it blends to transparent */}
            {effectiveLevel >= 2 && (
              <Path
                d={arcFillPath(fadeStartDeg, fillEndDeg, RADIUS, STROKE)}
                fill="url(#tipFade)"
              />
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

              // Nudge 75% label away from its tick
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
        {/* Percentage text color matches the arc color at the current level */}
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
