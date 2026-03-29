import React, { useEffect, useRef, useState } from "react";
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

// Gradient color zones — 15-point wide blends (7.5 each side of boundary)
// Transitions are wide enough to be clearly visible as smooth gradients.
// Tick marks are drawn OUTSIDE the arc so they never cross the colored fill.
const GRADIENT_STOPS: Array<{ pct: number; r: number; g: number; b: number }> = [
  { pct: 0,    r: 220, g: 38,  b: 38  }, // red start
  { pct: 12.5, r: 220, g: 38,  b: 38  }, // red solid end
  { pct: 27.5, r: 234, g: 88,  b: 12  }, // orange solid start
  { pct: 42.5, r: 234, g: 88,  b: 12  }, // orange solid end
  { pct: 57.5, r: 255, g: 225, b: 53  }, // yellow #FFE135 solid start
  { pct: 67.5, r: 255, g: 225, b: 53  }, // yellow solid end
  { pct: 82.5, r: 22,  g: 163, b: 74  }, // green solid start
  { pct: 100,  r: 22,  g: 163, b: 74  }, // green solid end
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

function arcStrokePath(startDeg: number, endDeg: number, r: number): string {
  const s = polarToXY(startDeg, r);
  const e = polarToXY(endDeg, r);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

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

// Build 1° segments for the static base fill (0 to level%).
// While charging, the sweep window (windowStart to level%) is left empty
// so the animated sweep layer renders on top of the track color.
function buildBaseSegments(
  level: number,
  isCharging: boolean
): Array<{ startDeg: number; endDeg: number; color: string }> {
  if (level <= 0) return [];
  const SWEEP_WINDOW = 20;
  const windowStart = Math.max(0, level - SWEEP_WINDOW);
  // When charging, only render solid fill below the sweep window
  const solidUpTo = isCharging ? windowStart : level;
  if (solidUpTo <= 0) return [];

  const fillDeg = ARC_DEG * (solidUpTo / 100);
  const segs: Array<{ startDeg: number; endDeg: number; color: string }> = [];
  let deg = 0;
  while (deg < fillDeg) {
    const segEnd = Math.min(deg + 1, fillDeg);
    const midPct = ((deg + segEnd) / 2 / ARC_DEG) * 100;
    segs.push({
      startDeg: START_DEG + deg,
      endDeg: START_DEG + segEnd,
      color: colorToString(interpolateColor(midPct)),
    });
    deg = segEnd;
  }
  return segs;
}

// Build 1° segments for the animated sweep fill.
// sweepProgress 0→1: fill grows from windowStart to waveFront (which travels to level%).
// When sweepProgress=1 the fill covers the full window; then it resets to 0.
function buildSweepSegments(
  level: number,
  sweepProgress: number
): Array<{ startDeg: number; endDeg: number; color: string }> {
  const SWEEP_WINDOW = 20;
  const windowStart = Math.max(0, level - SWEEP_WINDOW);
  const waveFrontPct = windowStart + sweepProgress * (level - windowStart);
  if (waveFrontPct <= windowStart) return [];

  const startDegAbs = START_DEG + ARC_DEG * (windowStart / 100);
  const endDegAbs = START_DEG + ARC_DEG * (waveFrontPct / 100);
  const totalDeg = endDegAbs - startDegAbs;
  if (totalDeg <= 0) return [];

  const segs: Array<{ startDeg: number; endDeg: number; color: string }> = [];
  let deg = 0;
  while (deg < totalDeg) {
    const segEnd = Math.min(deg + 1, totalDeg);
    const midPct = windowStart + ((deg + segEnd) / 2 / ARC_DEG) * 100;
    segs.push({
      startDeg: startDegAbs + deg,
      endDeg: startDegAbs + segEnd,
      color: colorToString(interpolateColor(midPct)),
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

export function BatteryRing({ level, mode, isCalculating, isLowPowerMode }: BatteryRingProps) {
  const sweepAnim = useRef(new Animated.Value(0)).current;
  const criticalOpacity = useRef(new Animated.Value(1)).current;
  const [sweepProgress, setSweepProgress] = useState(0);

  // Charging sweep: fill grows from (level-20%) to level%, resets, repeats
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
  }, [mode, level <= 10]);

  const effectiveLevel = mode === "full" ? 100 : level;
  const isCharging = mode === "charging";
  const ringColor = getRingColorString(level, mode);

  const baseSegments = buildBaseSegments(effectiveLevel, isCharging);
  const sweepSegments = isCharging ? buildSweepSegments(effectiveLevel, sweepProgress) : [];

  // Tip fade cap: last 5% of arc fades to transparent (follows sweep tip when charging)
  const FADE_PCT = 5;
  const tipLevel = isCharging
    ? Math.max(0, effectiveLevel - 20) + sweepProgress * Math.min(20, effectiveLevel)
    : effectiveLevel;
  const fadeSpanPct = Math.min(FADE_PCT, Math.max(0, tipLevel));
  const fillEndDeg = START_DEG + ARC_DEG * (tipLevel / 100);
  const fadeStartDeg = START_DEG + ARC_DEG * ((tipLevel - fadeSpanPct) / 100);
  const gradTipStart = polarToXY(fadeStartDeg, RADIUS);
  const gradTipEnd = polarToXY(fillEndDeg, RADIUS);
  const tipColor = colorToString(interpolateColor(tipLevel));

  // Tick marks drawn OUTSIDE the arc (beyond outer edge) so they never cross the fill
  const tickPercents = [5, 10, 20, 30, 40, 50, 60, 70, 75, 80, 90, 100];
  const TICK_LENGTH = 6;
  // outerEdge = center of arc + half stroke width + small gap
  const OUTER_EDGE = RADIUS + STROKE / 2 + 2;

  return (
    <View style={styles.container}>
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
              <Stop offset="0" stopColor={tipColor} stopOpacity="1" />
              <Stop offset="1" stopColor={tipColor} stopOpacity="0" />
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

          {/* Static base fill (below sweep window when charging) */}
          {baseSegments.map((seg, i) => (
            <Path
              key={`base-${i}`}
              d={arcStrokePath(seg.startDeg, seg.endDeg, RADIUS)}
              stroke={seg.color}
              strokeWidth={STROKE}
              strokeLinecap="butt"
              fill="none"
            />
          ))}

          {/* Animated sweep fill (grows from windowStart to level% while charging) */}
          {sweepSegments.map((seg, i) => (
            <Path
              key={`sweep-${i}`}
              d={arcStrokePath(seg.startDeg, seg.endDeg, RADIUS)}
              stroke={seg.color}
              strokeWidth={STROKE}
              strokeLinecap="butt"
              fill="none"
            />
          ))}

          {/* Tip fade cap — follows the sweep front when charging */}
          {tipLevel >= 2 && (
            <Path
              d={arcFillPath(fadeStartDeg, fillEndDeg, RADIUS, STROKE)}
              fill="url(#tipFade)"
            />
          )}

          {/* Tick marks — drawn OUTSIDE the arc to avoid crossing the colored fill */}
          {tickPercents.map((pct) => {
            const tickDeg = START_DEG + ARC_DEG * (pct / 100);
            const tickRad = (tickDeg * Math.PI) / 180;
            // Start at outer edge of arc, extend outward
            const x1 = CX + OUTER_EDGE * Math.cos(tickRad);
            const y1 = CY + OUTER_EDGE * Math.sin(tickRad);
            const x2 = CX + (OUTER_EDGE + TICK_LENGTH) * Math.cos(tickRad);
            const y2 = CY + (OUTER_EDGE + TICK_LENGTH) * Math.sin(tickRad);
            const isActive = pct <= effectiveLevel;
            const showLabel = pct === 5 || pct === 10 || pct === 20 || pct === 50 || pct === 75 || pct === 100;

            const labelR = OUTER_EDGE + TICK_LENGTH + 10;
            let lx = CX + labelR * Math.cos(tickRad);
            let ly = CY + labelR * Math.sin(tickRad);

            // Nudge 75% label slightly counter-clockwise to avoid overlap with tick
            if (pct === 75) {
              const tangentRad = tickRad - Math.PI / 2;
              lx += Math.cos(tangentRad) * 5;
              ly += Math.sin(tangentRad) * 5;
            }

            return (
              <React.Fragment key={pct}>
                <Line
                  x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={isActive ? "#555555" : "#BBBBBB"}
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
