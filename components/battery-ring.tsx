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
// so transitions are wide enough to be clearly visible as smooth gradients:
//
//  red    (#DC2626): 0–12.5% solid
//  blend  12.5–27.5%: red → orange  (centered on 20%)
//  orange (#EA580C): 27.5–42.5% solid
//  blend  42.5–57.5%: orange → yellow  (centered on 50%)
//  yellow (#FFE135): 57.5–67.5% solid
//  blend  67.5–82.5%: yellow → green  (centered on 75%)
//  green  (#16A34A): 82.5–100% solid
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

// Mix a color toward white by factor 0–1 (0 = original, 1 = white)
function lighten(c: { r: number; g: number; b: number }, factor: number): string {
  return `rgb(${Math.round(c.r + (255 - c.r) * factor)},${Math.round(c.g + (255 - c.g) * factor)},${Math.round(c.b + (255 - c.b) * factor)})`;
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

// Build 1° segments with optional sweep brightness overlay.
// sweepProgress 0→1: the bright wave front moves from windowStart to windowEnd.
// Segments inside the wave window get lightened by a bell-curve amount.
function buildSegments(
  level: number,
  sweepProgress: number, // 0–1, only used when charging
  isCharging: boolean
): Array<{ startDeg: number; endDeg: number; color: string }> {
  if (level <= 0) return [];
  const fillDeg = ARC_DEG * (level / 100);
  const segs: Array<{ startDeg: number; endDeg: number; color: string }> = [];

  // Sweep window in percentage points
  const SWEEP_WINDOW = 20;
  const windowEnd = level; // top of sweep = current level
  const windowStart = Math.max(0, level - SWEEP_WINDOW);
  // The wave front position within the window (0 = bottom of window, 1 = top)
  const waveFrontPct = windowStart + sweepProgress * (windowEnd - windowStart);

  let deg = 0;
  while (deg < fillDeg) {
    const segEnd = Math.min(deg + 1, fillDeg);
    const midPct = ((deg + segEnd) / 2 / ARC_DEG) * 100;
    const baseColor = interpolateColor(midPct);

    let color: string;
    if (isCharging && midPct >= windowStart && midPct <= windowEnd) {
      // Bell-curve brightness: peaks at the wave front, falls off behind it
      const distFromFront = waveFrontPct - midPct; // positive = behind front
      // Segments ahead of the front are dark (not yet lit), behind are fading
      if (midPct > waveFrontPct) {
        // Ahead of wave front — dim (unlit portion of window)
        color = lighten(baseColor, 0.0);
      } else {
        // Behind wave front — bright at front, fading over 10 pts
        const fadeDistance = Math.min(distFromFront / 10, 1);
        const brightness = Math.max(0, 0.45 * (1 - fadeDistance));
        color = lighten(baseColor, brightness);
      }
    } else {
      color = colorToString(baseColor);
    }

    segs.push({ startDeg: START_DEG + deg, endDeg: START_DEG + segEnd, color });
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

  // Charging sweep animation: wave front travels from bottom to top of window, then resets
  useEffect(() => {
    if (mode === "charging") {
      const listener = sweepAnim.addListener(({ value }) => setSweepProgress(value));
      const loop = Animated.loop(
        Animated.timing(sweepAnim, {
          toValue: 1,
          duration: 1500,
          easing: Easing.linear,
          useNativeDriver: false, // must be false — drives JS state
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
  const segments = buildSegments(effectiveLevel, sweepProgress, isCharging);

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

          {/* Gradient fill: 1° stroked segments */}
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

          {/* Tip fade cap */}
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
