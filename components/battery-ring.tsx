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

// Colour zone definitions: each zone has a solid colour and spans [startPct, endPct].
// Boundaries are shared — the end of one zone is the start of the next.
// At each boundary we place a radial linearGradient whose axis runs from the
// ring centre outward through the boundary angle, so the colour transition line
// is exactly perpendicular to the arc stroke.
const ZONE_COLORS = {
  red:    { r: 220, g: 38,  b: 38  },  // #DC2626
  orange: { r: 234, g: 88,  b: 12  },  // #EA580C
  yellow: { r: 255, g: 225, b: 53  },  // #FFE135
  green:  { r: 22,  g: 163, b: 74  },  // #16A34A
};

// Zone boundaries in % (must match the user-specified ranges)
// red 0–20%, orange 20–50%, yellow 50–75%, green 75–100%
// Each boundary has a 5-point blend zone centred on it so the transition is smooth.
const BLEND = 5; // half-width of blend zone in %
const ZONES: Array<{ startPct: number; endPct: number; fromColor: typeof ZONE_COLORS.red; toColor: typeof ZONE_COLORS.red; id: string }> = [
  // Solid red
  { startPct: 0,            endPct: 20 - BLEND,     fromColor: ZONE_COLORS.red,    toColor: ZONE_COLORS.red,    id: "red_solid" },
  // Red → orange blend (centred on 20%)
  { startPct: 20 - BLEND,   endPct: 20 + BLEND,     fromColor: ZONE_COLORS.red,    toColor: ZONE_COLORS.orange, id: "red_orange" },
  // Solid orange
  { startPct: 20 + BLEND,   endPct: 50 - BLEND,     fromColor: ZONE_COLORS.orange, toColor: ZONE_COLORS.orange, id: "orange_solid" },
  // Orange → yellow blend (centred on 50%)
  { startPct: 50 - BLEND,   endPct: 50 + BLEND,     fromColor: ZONE_COLORS.orange, toColor: ZONE_COLORS.yellow, id: "orange_yellow" },
  // Solid yellow
  { startPct: 50 + BLEND,   endPct: 75 - BLEND,     fromColor: ZONE_COLORS.yellow, toColor: ZONE_COLORS.yellow, id: "yellow_solid" },
  // Yellow → green blend (centred on 75%)
  { startPct: 75 - BLEND,   endPct: 75 + BLEND,     fromColor: ZONE_COLORS.yellow, toColor: ZONE_COLORS.green,  id: "yellow_green" },
  // Solid green
  { startPct: 75 + BLEND,   endPct: 100,            fromColor: ZONE_COLORS.green,  toColor: ZONE_COLORS.green,  id: "green_solid" },
];

function colorToString(c: { r: number; g: number; b: number }): string {
  return `rgb(${c.r},${c.g},${c.b})`;
}

function interpolateZoneColor(pct: number): { r: number; g: number; b: number } {
  for (const zone of ZONES) {
    if (pct >= zone.startPct && pct <= zone.endPct) {
      const span = zone.endPct - zone.startPct;
      const t = span === 0 ? 0 : (pct - zone.startPct) / span;
      return {
        r: Math.round(zone.fromColor.r + t * (zone.toColor.r - zone.fromColor.r)),
        g: Math.round(zone.fromColor.g + t * (zone.toColor.g - zone.fromColor.g)),
        b: Math.round(zone.fromColor.b + t * (zone.toColor.b - zone.fromColor.b)),
      };
    }
  }
  return ZONE_COLORS.green;
}

function getRingColorString(level: number, mode: BatteryMode): string {
  if (mode === "full") return colorToString(ZONE_COLORS.green);
  return colorToString(interpolateZoneColor(level));
}

function polarToXY(angleDeg: number, r: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

// Arc path from startDeg to endDeg
function arcStrokePath(startDeg: number, endDeg: number, r: number): string {
  const s = polarToXY(startDeg, r);
  const e = polarToXY(endDeg, r);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

/**
 * Build a radial gradient axis for a blend zone.
 * The gradient axis runs from the ring centre outward through the midpoint angle
 * of the zone, so the colour boundary is perpendicular to the arc stroke.
 * We extend the axis well past the ring edge so the gradient covers the full stroke.
 */
function radialGradientAxis(startDeg: number, endDeg: number): { x1: number; y1: number; x2: number; y2: number } {
  const midDeg = (startDeg + endDeg) / 2;
  const midRad = (midDeg * Math.PI) / 180;
  // Axis: from centre outward past the outer edge of the stroke
  const outerR = RADIUS + STROKE;
  return {
    x1: CX,
    y1: CY,
    x2: CX + outerR * Math.cos(midRad),
    y2: CY + outerR * Math.sin(midRad),
  };
}

/**
 * Render the coloured arc up to `endPct`, split into zones.
 * Each zone uses its own linearGradient with a radial axis so transitions
 * are perpendicular to the arc stroke.
 */
function renderArcZones(endPct: number): React.ReactNode {
  if (endPct <= 0) return null;
  const nodes: React.ReactNode[] = [];

  for (const zone of ZONES) {
    if (zone.startPct >= endPct) break;
    const zoneTo = Math.min(zone.endPct, endPct);
    const zoneFrom = zone.startPct;
    if (zoneTo <= zoneFrom) continue;

    const startDeg = START_DEG + ARC_DEG * (zoneFrom / 100);
    const endDeg   = START_DEG + ARC_DEG * (zoneTo   / 100);
    const isSolid  = zone.fromColor === zone.toColor;
    const gradId   = `grad_${zone.id}`;

    if (isSolid) {
      // Solid zone — no gradient needed, just a single colour stroke
      nodes.push(
        <Path
          key={zone.id}
          d={arcStrokePath(startDeg, endDeg, RADIUS)}
          stroke={colorToString(zone.fromColor)}
          strokeWidth={STROKE}
          strokeLinecap="butt"
          fill="none"
        />
      );
    } else {
      // Blend zone — radial gradient axis through the midpoint angle
      const axis = radialGradientAxis(startDeg, endDeg);
      // Interpolate the actual start/end colours within this zone
      // (handles partial zones when endPct cuts through a blend)
      const t = (zoneTo - zoneFrom) / (zone.endPct - zone.startPct);
      const endColor = {
        r: Math.round(zone.fromColor.r + t * (zone.toColor.r - zone.fromColor.r)),
        g: Math.round(zone.fromColor.g + t * (zone.toColor.g - zone.fromColor.g)),
        b: Math.round(zone.fromColor.b + t * (zone.toColor.b - zone.fromColor.b)),
      };
      nodes.push(
        <React.Fragment key={zone.id}>
          <Defs>
            <LinearGradient
              id={gradId}
              x1={axis.x1} y1={axis.y1}
              x2={axis.x2} y2={axis.y2}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0%" stopColor={colorToString(zone.fromColor)} stopOpacity="1" />
              <Stop offset="100%" stopColor={colorToString(endColor)} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Path
            d={arcStrokePath(startDeg, endDeg, RADIUS)}
            stroke={`url(#${gradId})`}
            strokeWidth={STROKE}
            strokeLinecap="butt"
            fill="none"
          />
        </React.Fragment>
      );
    }
  }
  return nodes;
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

  // Fully-charged green pulse animation
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

  // Critical low battery blink (≤10%)
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

  // Charging sweep: 20-point window that animates
  const SWEEP_WINDOW = 20;
  const windowStart = Math.max(0, effectiveLevel - SWEEP_WINDOW);
  const sweepTip = windowStart + sweepProgress * (effectiveLevel - windowStart);

  // Solid portion ends at windowStart when charging (sweep handles the rest)
  const solidEndPct = isCharging ? windowStart : effectiveLevel;

  // Tick marks
  const tickPercents = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];
  const TICK_LENGTH = 6;
  const INNER_EDGE = RADIUS - STROKE / 2 - 1;

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.svgWrapper, { opacity: mode === "full" ? fullPulse : criticalOpacity }]}>
        <Svg width={SIZE} height={SIZE}>

          {/* LAYER 1: Tick marks — behind the arc ring */}
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

          {/* LAYER 3: Solid portion — zone-split arcs with radial gradient boundaries */}
          {renderArcZones(solidEndPct)}

          {/* LAYER 4 (charging only): Animated sweep portion */}
          {isCharging && sweepTip > windowStart && renderArcZones(sweepTip)}

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
