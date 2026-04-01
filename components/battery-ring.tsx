import React, { useRef, useState, useEffect } from "react";
import { View, Text, Image, StyleSheet, Animated, Easing } from "react-native";
import Svg, {
  Circle, Line, Path, Defs, LinearGradient, Stop,
  Text as SvgText, ClipPath, G, Rect,
} from "react-native-svg";
import { BatteryMode } from "@/hooks/use-battery-monitor";

const SIZE = 260;
const STROKE = 18;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC_RATIO = 0.75; // 270° arc
const ARC_DEG = 270;
const START_DEG = 135; // arc starts at bottom-left
const CX = SIZE / 2;
const CY = SIZE / 2;
const COLOR_TRACK = "#E5E7EB";

// ─── Colour palette ────────────────────────────────────────────────────────────
// red 0–20%, orange 20–50%, yellow 50–75%, green 75–100%
// The conic gradient circle has these colours placed at the correct angular
// positions around the full 360° circle, so when the arc ring masks it the
// transitions are naturally perpendicular to the stroke.

// Map battery % → angle on the SVG circle (degrees, SVG convention: 0° = right)
function pctToDeg(pct: number): number {
  return START_DEG + ARC_DEG * (pct / 100);
}

// The colour stops we want at specific % positions on the arc
// (placed at the angular position that corresponds to that battery level)
const COLOR_STOPS: Array<{ pct: number; color: string }> = [
  { pct: 0,   color: "#DC2626" }, // red
  { pct: 20,  color: "#DC2626" }, // red → boundary
  { pct: 20,  color: "#EA580C" }, // orange boundary
  { pct: 50,  color: "#EA580C" }, // orange → boundary
  { pct: 50,  color: "#FFE135" }, // yellow boundary
  { pct: 75,  color: "#FFE135" }, // yellow → boundary
  { pct: 75,  color: "#16A34A" }, // green boundary
  { pct: 100, color: "#16A34A" }, // green
];

// Interpolate colour at any % for the centre text
function interpolateArcColor(pct: number): string {
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (pct >= a.pct && pct <= b.pct && a.color !== b.color) {
      // blend between the two
      const t = (pct - a.pct) / (b.pct - a.pct);
      const parse = (hex: string) => [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
      const [r1, g1, b1] = parse(a.color);
      const [r2, g2, b2] = parse(b.color);
      const r = Math.round(r1 + t * (r2 - r1));
      const g = Math.round(g1 + t * (g2 - g1));
      const bv = Math.round(b1 + t * (b2 - b1));
      return `rgb(${r},${g},${bv})`;
    }
    if (pct >= a.pct && pct <= b.pct) return a.color;
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1].color;
}

function getRingColorString(level: number, mode: BatteryMode): string {
  if (mode === "full") return "#16A34A";
  return interpolateArcColor(level);
}

function polarToXY(angleDeg: number, r: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arcPath(startDeg: number, endDeg: number, r: number): string {
  const s = polarToXY(startDeg, r);
  const e = polarToXY(endDeg, r);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

// ─── Conic gradient simulation ─────────────────────────────────────────────────
// We approximate a conic gradient by splitting the full 360° circle into thin
// pie wedges. Each wedge is a filled triangle from the centre to two points on
// the circumference, coloured with a linearGradient whose axis runs along the
// wedge (tangentially), so the colour changes smoothly around the circle.
// The arc ring ClipPath then masks everything so only the narrow band is visible.

const WEDGE_DEG = 3; // degrees per wedge — small enough for smooth transitions
const CIRCLE_R = SIZE; // large enough to fill the entire SVG

function buildConicWedges(upToDeg: number): React.ReactNode[] {
  const wedges: React.ReactNode[] = [];
  const gradDefs: React.ReactNode[] = [];

  // We only need wedges from START_DEG to upToDeg (the filled portion)
  const totalDeg = upToDeg - START_DEG;
  if (totalDeg <= 0) return [];

  const numWedges = Math.ceil(totalDeg / WEDGE_DEG);

  for (let i = 0; i < numWedges; i++) {
    const wStartDeg = START_DEG + i * WEDGE_DEG;
    const wEndDeg = Math.min(START_DEG + (i + 1) * WEDGE_DEG, upToDeg);
    const wPctStart = ((wStartDeg - START_DEG) / ARC_DEG) * 100;
    const wPctEnd = ((wEndDeg - START_DEG) / ARC_DEG) * 100;

    const colorStart = interpolateArcColor(Math.min(wPctStart, 100));
    const colorEnd = interpolateArcColor(Math.min(wPctEnd, 100));

    const p1 = polarToXY(wStartDeg, CIRCLE_R);
    const p2 = polarToXY(wEndDeg, CIRCLE_R);

    // Gradient axis runs from p1 to p2 (tangentially around the circle)
    const gradId = `cg${i}`;

    gradDefs.push(
      <LinearGradient
        key={`gd${i}`}
        id={gradId}
        x1={p1.x} y1={p1.y}
        x2={p2.x} y2={p2.y}
        gradientUnits="userSpaceOnUse"
      >
        <Stop offset="0%" stopColor={colorStart} stopOpacity="1" />
        <Stop offset="100%" stopColor={colorEnd} stopOpacity="1" />
      </LinearGradient>
    );

    // Filled triangle: centre → p1 → p2
    const d = `M ${CX} ${CY} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y} Z`;
    wedges.push(
      <Path key={`w${i}`} d={d} fill={`url(#${gradId})`} stroke="none" />
    );
  }

  return [
    <Defs key="wedge-defs">{gradDefs}</Defs>,
    <G key="wedge-group">{wedges}</G>,
  ];
}

// ─── Arc clip path ─────────────────────────────────────────────────────────────
// The clip path is the arc stroke itself — a thick stroked path with no fill.
// We use a Path with a large strokeWidth equal to STROKE, which clips to just
// the ring band.
function arcClipPath(id: string, startDeg: number, endDeg: number): React.ReactNode {
  if (endDeg <= startDeg) return null;
  return (
    <ClipPath id={id}>
      <Path
        d={arcPath(startDeg, endDeg, RADIUS)}
        stroke="white"
        strokeWidth={STROKE}
        strokeLinecap="butt"
        fill="none"
      />
    </ClipPath>
  );
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

  // Charging sweep animation
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

  // Fully-charged green pulse
  useEffect(() => {
    if (mode === "full") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(fullPulse, { toValue: 0.55, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(fullPulse, { toValue: 1,    duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => { pulse.stop(); fullPulse.setValue(1); };
    } else {
      fullPulse.setValue(1);
    }
  }, [mode, fullPulse]);

  // Critical blink ≤10%
  useEffect(() => {
    if (mode === "discharging" && level <= 10) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(criticalOpacity, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(criticalOpacity, { toValue: 1,    duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
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

  // Charging sweep: 20-point window
  const SWEEP_WINDOW = 20;
  const windowStart = Math.max(0, effectiveLevel - SWEEP_WINDOW);
  const sweepTip = windowStart + sweepProgress * (effectiveLevel - windowStart);

  const solidEndPct = isCharging ? windowStart : effectiveLevel;
  const solidEndDeg = pctToDeg(solidEndPct);
  const sweepEndDeg = pctToDeg(sweepTip);

  // Tick marks
  const tickPercents = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];
  const TICK_LENGTH = 6;
  const INNER_EDGE = RADIUS - STROKE / 2 - 1;

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.svgWrapper, { opacity: mode === "full" ? fullPulse : criticalOpacity }]}>
        <Svg width={SIZE} height={SIZE}>
          <Defs>
            {/* Clip paths for the arc bands */}
            {solidEndPct > 0 && arcClipPath("solidClip", START_DEG, solidEndDeg)}
            {isCharging && sweepTip > windowStart && arcClipPath("sweepClip", pctToDeg(windowStart), sweepEndDeg)}
          </Defs>

          {/* LAYER 1: Tick marks — behind everything */}
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
            if (pct === 75) {
              const inwardRad = tickRad + Math.PI;
              lx += Math.cos(inwardRad) * 8;
              ly += Math.sin(inwardRad) * 8;
            }
            return (
              <React.Fragment key={pct}>
                <Line x1={x1} y1={y1} x2={x2} y2={y2}
                  stroke={isActive ? "#999999" : "#CCCCCC"}
                  strokeWidth={1.2} strokeLinecap="butt" />
                {showLabel && (
                  <SvgText x={lx} y={ly}
                    textAnchor="middle" alignmentBaseline="middle"
                    fontSize={8} fontWeight="700"
                    fill={isActive ? "#555555" : "#AAAAAA"}
                    letterSpacing={0.5}>
                    {pct} %
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

          {/* LAYER 3: Conic gradient circle, clipped to the solid arc band */}
          {solidEndPct > 0 && (
            <G clipPath="url(#solidClip)">
              {buildConicWedges(solidEndDeg)}
            </G>
          )}

          {/* LAYER 4 (charging only): Conic gradient circle, clipped to the sweep band */}
          {isCharging && sweepTip > windowStart && (
            <G clipPath="url(#sweepClip)">
              {buildConicWedges(sweepEndDeg)}
            </G>
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
            ? isCalculating ? "MEASURING..." : "DISCHARGING"
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
