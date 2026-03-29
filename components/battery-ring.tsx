import React, { useRef, useState, useEffect } from "react";
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

// Gradient color zones — 15-point wide blends centered on each boundary:
//  red    (#DC2626): 0–12.5% solid
//  blend  12.5–27.5%: red → orange  (centered on 20%)
//  orange (#EA580C): 27.5–42.5% solid
//  blend  42.5–57.5%: orange → yellow  (centered on 50%)
//  yellow (#FFE135): 57.5–67.5% solid
//  blend  67.5–82.5%: yellow → green  (centered on 75%)
//  green  (#16A34A): 82.5–100% solid
const GRADIENT_STOPS: Array<{ pct: number; r: number; g: number; b: number }> = [
  { pct: 0,    r: 220, g: 38,  b: 38  },
  { pct: 12.5, r: 220, g: 38,  b: 38  },
  { pct: 27.5, r: 234, g: 88,  b: 12  },
  { pct: 42.5, r: 234, g: 88,  b: 12  },
  { pct: 57.5, r: 255, g: 225, b: 53  },
  { pct: 67.5, r: 255, g: 225, b: 53  },
  { pct: 82.5, r: 22,  g: 163, b: 74  },
  { pct: 100,  r: 22,  g: 163, b: 74  },
];

function interpolateColor(pct: number): { r: number; g: number; b: number } {
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
  return {
    r: Math.round(lo.r + t * (hi.r - lo.r)),
    g: Math.round(lo.g + t * (hi.g - lo.g)),
    b: Math.round(lo.b + t * (hi.b - lo.b)),
  };
}

function colorToString(c: { r: number; g: number; b: number }): string {
  return `rgb(${c.r},${c.g},${c.b})`;
}

function getRingColorString(level: number, mode: BatteryMode): string {
  if (mode === "full") return colorToString(interpolateColor(100));
  return colorToString(interpolateColor(level));
}

function polarToXY(angleDeg: number, r: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

// Single continuous arc path from startDeg to endDeg at radius r
function arcStrokePath(startDeg: number, endDeg: number, r: number): string {
  const s = polarToXY(startDeg, r);
  const e = polarToXY(endDeg, r);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

// Build SVG linearGradient stop offsets for a sub-range of the full 0–100% arc.
// Returns an array of {offset, color} pairs mapped to the gradient stops that
// fall within [startPct, endPct], so the gradient covers exactly that range.
function buildGradientStops(
  startPct: number,
  endPct: number
): Array<{ offset: string; color: string }> {
  if (endPct <= startPct) return [];
  const span = endPct - startPct;
  const result: Array<{ offset: string; color: string }> = [];

  // Always add a stop at the start
  result.push({
    offset: "0%",
    color: colorToString(interpolateColor(startPct)),
  });

  // Add stops for any GRADIENT_STOPS that fall within the range
  for (const stop of GRADIENT_STOPS) {
    if (stop.pct > startPct && stop.pct < endPct) {
      const offset = ((stop.pct - startPct) / span) * 100;
      result.push({
        offset: `${offset.toFixed(2)}%`,
        color: colorToString({ r: stop.r, g: stop.g, b: stop.b }),
      });
    }
  }

  // Always add a stop at the end
  result.push({
    offset: "100%",
    color: colorToString(interpolateColor(endPct)),
  });

  return result;
}

// Compute the bounding box endpoints for a linearGradient that runs along the arc
// from startDeg to endDeg. We use the midpoint angle direction for the gradient axis
// so it flows roughly along the arc direction.
function arcGradientEndpoints(
  startDeg: number,
  endDeg: number
): { x1: number; y1: number; x2: number; y2: number } {
  const s = polarToXY(startDeg, RADIUS);
  const e = polarToXY(endDeg, RADIUS);
  return { x1: s.x, y1: s.y, x2: e.x, y2: e.y };
}

interface BatteryRingProps {
  level: number;
  mode: BatteryMode;
  isCalculating: boolean;
  isLowPowerMode?: boolean;
}

export function BatteryRing({ level, mode, isCalculating, isLowPowerMode }: BatteryRingProps) {
  const sweepAnim = useRef(new Animated.Value(0)).current;
  const criticalOpacity = useRef(new Animated.Value(1)).current;
  const fullPulse = useRef(new Animated.Value(1)).current;
  const [sweepProgress, setSweepProgress] = useState(0);

  // Charging sweep: sweepProgress 0→1 controls how much of the 20-point window is revealed
  useEffect(() => {
    if (mode === "charging") {
      const listener = sweepAnim.addListener(({ value }) => setSweepProgress(value));
      const loop = Animated.loop(
        Animated.timing(sweepAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.linear,
          useNativeDriver: false,
        })
      );
      loop.start();
      return () => {
        loop.stop();
        sweepAnim.removeListener(listener);
        sweepAnim.setValue(0);
        setSweepProgress(0);
      };
    } else {
      sweepAnim.setValue(0);
      setSweepProgress(0);
    }
  }, [mode]);

  // Fully-charged green pulse animation
  useEffect(() => {
    if (mode === "full") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(fullPulse, { toValue: 0.55, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(fullPulse, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => { pulse.stop(); fullPulse.setValue(1); };
    } else {
      fullPulse.setValue(1);
    }
  }, [mode, fullPulse]);

  // Critical low battery blink (≤10%)
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
  }, [mode, level]);

  const effectiveLevel = mode === "full" ? 100 : level;
  const isCharging = mode === "charging";
  const ringColor = getRingColorString(level, mode);

  // Sweep window: the 20-point range below current level that animates during charging
  const SWEEP_WINDOW = 20;
  const windowStart = Math.max(0, effectiveLevel - SWEEP_WINDOW);

  // sweepTip moves from windowStart → windowEnd as sweepProgress goes 0 → 1
  const sweepTip = windowStart + sweepProgress * (effectiveLevel - windowStart);

  // Arc degree positions
  const solidEndPct = isCharging ? windowStart : effectiveLevel;
  const solidStartDeg = START_DEG;
  const solidEndDeg = START_DEG + ARC_DEG * (solidEndPct / 100);

  const animStartDeg = START_DEG + ARC_DEG * (windowStart / 100);
  const animEndDeg = START_DEG + ARC_DEG * (sweepTip / 100);

  // Gradient endpoints for each arc
  const solidGrad = arcGradientEndpoints(solidStartDeg, solidEndDeg);
  const animGrad = arcGradientEndpoints(animStartDeg, animEndDeg);

  // Gradient stops for each arc
  const solidStops = buildGradientStops(0, solidEndPct);
  const animStops = buildGradientStops(windowStart, sweepTip);

  // Tick marks
  const tickPercents = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];
  const TICK_LENGTH = 6;
  const INNER_EDGE = RADIUS - STROKE / 2 - 1;

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.svgWrapper, { opacity: mode === "full" ? fullPulse : criticalOpacity }]}>
        <Svg width={SIZE} height={SIZE}>
          <Defs>
            {/* Gradient for the solid (already-charged) arc */}
            {solidStops.length >= 2 && (
              <LinearGradient
                id="solidGrad"
                x1={solidGrad.x1} y1={solidGrad.y1}
                x2={solidGrad.x2} y2={solidGrad.y2}
                gradientUnits="userSpaceOnUse"
              >
                {solidStops.map((s, i) => (
                  <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity="1" />
                ))}
              </LinearGradient>
            )}
            {/* Gradient for the animated charging sweep arc */}
            {isCharging && animStops.length >= 2 && (
              <LinearGradient
                id="animGrad"
                x1={animGrad.x1} y1={animGrad.y1}
                x2={animGrad.x2} y2={animGrad.y2}
                gradientUnits="userSpaceOnUse"
              >
                {animStops.map((s, i) => (
                  <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity="1" />
                ))}
              </LinearGradient>
            )}
          </Defs>

          {/* LAYER 1: Tick marks — drawn first, behind the arc ring */}
          {tickPercents.map((pct) => {
            const tickDeg = START_DEG + ARC_DEG * (pct / 100);
            const tickRad = (tickDeg * Math.PI) / 180;
            const x1 = CX + INNER_EDGE * Math.cos(tickRad);
            const y1 = CY + INNER_EDGE * Math.sin(tickRad);
            const x2 = CX + (INNER_EDGE - TICK_LENGTH) * Math.cos(tickRad);
            const y2 = CY + (INNER_EDGE - TICK_LENGTH) * Math.sin(tickRad);
            const isActive = pct <= effectiveLevel;
            const showLabel = pct === 5 || pct === 10 || pct === 20 || pct === 50 || pct === 75 || pct === 100;

            const labelR = INNER_EDGE - TICK_LENGTH - 10;
            let lx = CX + labelR * Math.cos(tickRad);
            let ly = CY + labelR * Math.sin(tickRad);

            // Push 75% label further inward to clear the tick
            if (pct === 75) {
              const inwardRad = tickRad + Math.PI;
              lx += Math.cos(inwardRad) * 8;
              ly += Math.sin(inwardRad) * 8;
            }

            return (
              <React.Fragment key={pct}>
                <Line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={isActive ? "#999999" : "#CCCCCC"}
                  strokeWidth={1.2}
                  strokeLinecap="butt"
                />
                {showLabel && (
                  <SvgText
                    x={lx} y={ly}
                    textAnchor="middle"
                    alignmentBaseline="middle"
                    fontSize={8}
                    fontWeight="700"
                    fill={isActive ? "#555555" : "#AAAAAA"}
                    letterSpacing={0.5}
                  >
                    {pct} %
                  </SvgText>
                )}
              </React.Fragment>
            );
          })}

          {/* LAYER 2: Full gray track (entire 270° arc) */}
          <Circle
            cx={CX} cy={CY} r={RADIUS}
            stroke={COLOR_TRACK}
            strokeWidth={STROKE}
            fill="none"
            strokeDasharray={`${CIRCUMFERENCE * ARC_RATIO} ${CIRCUMFERENCE}`}
            strokeLinecap="butt"
            transform={`rotate(${START_DEG} ${CX} ${CY})`}
          />

          {/* LAYER 3: Single continuous gradient arc — solid portion (0 to solidEndPct) */}
          {solidStops.length >= 2 && solidEndPct > 0 && (
            <Path
              d={arcStrokePath(solidStartDeg, solidEndDeg, RADIUS)}
              stroke="url(#solidGrad)"
              strokeWidth={STROKE}
              strokeLinecap="butt"
              fill="none"
            />
          )}

          {/* LAYER 4 (charging only): Single continuous gradient arc — animated sweep portion */}
          {isCharging && animStops.length >= 2 && sweepTip > windowStart && (
            <Path
              d={arcStrokePath(animStartDeg, animEndDeg, RADIUS)}
              stroke="url(#animGrad)"
              strokeWidth={STROKE}
              strokeLinecap="butt"
              fill="none"
            />
          )}
        </Svg>
      </Animated.View>

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
