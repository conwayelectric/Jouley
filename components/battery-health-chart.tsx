/**
 * battery-health-chart.tsx
 *
 * A single unified chart showing three normalized health series:
 *   1. Estimated Battery Capacity  (0–100%)  — green→red, primary line
 *   2. Drain Rate                  (0–100% normalized) — amber/orange
 *   3. Temperature Trend           (0–100% normalized) — blue→red thermal
 *
 * All three series are normalized to the same 0–100 y-axis so they can
 * coexist on one canvas without a secondary axis. The y-axis label always
 * reads "0–100" and a legend below identifies each line.
 *
 * When data is insufficient the chart renders a ghost preview with an
 * overlay pill so users see the UI immediately.
 */

import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, Dimensions, TouchableOpacity } from "react-native";
import Svg, {
  Path,
  Defs,
  LinearGradient,
  Stop,
  Line,
  Circle,
} from "react-native-svg";
import type { ChartPoint } from "@/lib/health-history";

const SCREEN_WIDTH = Dimensions.get("window").width;
const CARD_MARGIN = 16;
const CARD_PADDING = 16;
const Y_AXIS_WIDTH = 28;
const CHART_WIDTH =
  SCREEN_WIDTH - CARD_MARGIN * 2 - CARD_PADDING * 2 - Y_AXIS_WIDTH - 4;
const CHART_HEIGHT = 150;

// ─── Series color palette ────────────────────────────────────────────────────
// Capacity: mirrors the battery ring gradient (high = green, low = red)
// Drain:    amber — consistent with the drain rate color at moderate levels
// Thermal:  cool blue — consistent with the thermal gauge cool zone

const SERIES_COLORS = {
  capacity: "#16A34A",   // green (healthy capacity)
  drain: "#F97316",      // orange (drain rate)
  thermal: "#00C2FF",    // cool blue (temperature)
} as const;

// ─── Smooth path helpers ─────────────────────────────────────────────────────

function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  const d: string[] = [`M ${pts[0].x} ${pts[0].y}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
  }
  return d.join(" ");
}

function fillPath(pts: { x: number; y: number }[], h: number): string {
  if (pts.length < 2) return "";
  return `${smoothPath(pts)} L ${pts[pts.length - 1].x} ${h} L ${pts[0].x} ${h} Z`;
}

/** Ghost sine-wave preview for empty state */
function ghostPts(n: number, h: number, phase: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const wave =
      Math.sin(t * Math.PI * 2.5 + phase) * 0.15 +
      Math.sin(t * Math.PI * 1.1 + phase) * 0.08;
    return { x: t * CHART_WIDTH, y: h * 0.45 + wave * h };
  });
}

// ─── Normalise a ChartPoint array to 0–100 y-scale ──────────────────────────

/**
 * Converts raw ChartPoint values to SVG y-coordinates on a 0–100 scale.
 * `inputMax` is the real-world maximum for the series (e.g. 100 for capacity,
 * 0.8 for drain rate, 1.0 for thermal score).
 */
function toSvgPoints(
  points: ChartPoint[],
  inputMax: number
): { x: number; y: number; hasData: boolean }[] {
  return points.map((p, i) => ({
    x: (i / Math.max(points.length - 1, 1)) * CHART_WIDTH,
    y: p.hasData
      ? CHART_HEIGHT - (Math.min(p.value, inputMax) / inputMax) * CHART_HEIGHT
      : CHART_HEIGHT,
    hasData: p.hasData,
  }));
}

/** Split an array of svg points into contiguous segments of hasData=true */
function segments(pts: { x: number; y: number; hasData: boolean }[]) {
  const segs: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (const p of pts) {
    if (p.hasData) {
      cur.push({ x: p.x, y: p.y });
    } else {
      if (cur.length >= 2) segs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) segs.push(cur);
  return segs;
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface BatteryHealthChartProps {
  /** Estimated capacity points, values 0–100 */
  capacityPoints: ChartPoint[];
  /** Drain rate points, values in %/min (max ~0.8) */
  drainPoints: ChartPoint[];
  /** Thermal score points, values 0–1 */
  thermalPoints: ChartPoint[];
  /** Current capacity score for the badge (0–100, or null if no baseline) */
  currentCapacity: number | null;
  /** Human-readable health label */
  healthLabel: string;
  /** Color matching the health tier */
  healthColor: string;
  /** "30" or "90" day view */
  days: number;
}

export function BatteryHealthChart({
  capacityPoints,
  drainPoints,
  thermalPoints,
  currentCapacity,
  healthLabel,
  healthColor,
  days,
}: BatteryHealthChartProps) {
  const [infoVisible, setInfoVisible] = useState(false);

  const hasEnoughData =
    capacityPoints.filter((p) => p.hasData).length >= 3 ||
    drainPoints.filter((p) => p.hasData).length >= 3;

  const { capSvg, drainSvg, thermalSvg, dateLabels } = useMemo(() => {
    const capSvg = toSvgPoints(capacityPoints, 100);
    // Drain: normalise 0–0.8 → 0–100 (higher drain = higher on chart = worse)
    const drainSvg = toSvgPoints(drainPoints, 0.8);
    // Thermal: normalise 0–1 → 0–100
    const thermalSvg = toSvgPoints(thermalPoints, 1.0);

    const pts = capacityPoints.length > 0 ? capacityPoints : drainPoints;
    const indices =
      pts.length >= 3
        ? [0, Math.floor(pts.length / 2), pts.length - 1]
        : pts.length === 2
        ? [0, pts.length - 1]
        : [0];
    const dateLabels = indices.map((i) => pts[i]?.date ?? "");

    return { capSvg, drainSvg, thermalSvg, dateLabels };
  }, [capacityPoints, drainPoints, thermalPoints]);

  // Ghost lines for empty state
  const ghosts = useMemo(
    () => [
      ghostPts(30, CHART_HEIGHT, 0),
      ghostPts(30, CHART_HEIGHT, 1.2),
      ghostPts(30, CHART_HEIGHT, 2.4),
    ],
    []
  );

  // Grid lines at 0, 25, 50, 75, 100
  const gridLines = [0, 25, 50, 75, 100].map((v) => ({
    y: CHART_HEIGHT - (v / 100) * CHART_HEIGHT,
    label: `${v}`,
  }));

  return (
    <View style={styles.card}>
      {/* Header row */}
      <View style={styles.headerRow}>
        <View style={styles.titleGroup}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>BATTERY HEALTH OVERVIEW</Text>
            <TouchableOpacity
              onPress={() => setInfoVisible((v) => !v)}
              style={styles.infoBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.infoBtnText}>ⓘ</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.subtitle}>{days}-day trend — est. battery life, drain rate &amp; temperature</Text>
        </View>
        {/* Current capacity badge */}
        <View style={[styles.badge, { borderColor: healthColor }]}>
          {currentCapacity !== null ? (
            <>
              <Text style={[styles.badgeScore, { color: healthColor }]}>
                {currentCapacity}%
              </Text>
              <Text style={styles.badgeLabel}>Battery Life</Text>
            </>
          ) : (
            <Text style={[styles.badgeLabel, { color: "#9CA3AF" }]}>
              Building…
            </Text>
          )}
        </View>
      </View>

      {/* Chart */}
      <View style={styles.chartWrapper}>
        {/* Y-axis */}
        <View style={styles.yAxis}>
          {gridLines
            .filter((_, i) => i % 2 === 0) // show 0, 50, 100
            .map((g) => (
              <Text key={g.label} style={[styles.yLabel, { top: g.y - 6 }]}>
                {g.label}
              </Text>
            ))}
        </View>

        {/* SVG + overlay */}
        <View style={styles.svgContainer}>
          <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
            <Defs>
              {/* Capacity fill gradient */}
              <LinearGradient id="capGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={SERIES_COLORS.capacity} stopOpacity="0.18" />
                <Stop offset="1" stopColor={SERIES_COLORS.capacity} stopOpacity="0.01" />
              </LinearGradient>
              {/* Ghost gradient */}
              <LinearGradient id="ghostGrad" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#D1D5DB" stopOpacity="0.3" />
                <Stop offset="1" stopColor="#D1D5DB" stopOpacity="0.01" />
              </LinearGradient>
            </Defs>

            {/* Grid */}
            {gridLines.map((g, i) => (
              <Line
                key={i}
                x1={0} y1={g.y} x2={CHART_WIDTH} y2={g.y}
                stroke="#E5E7EB"
                strokeWidth={i === 0 || i === gridLines.length - 1 ? 1 : 0.75}
                strokeDasharray={i === 0 || i === gridLines.length - 1 ? undefined : "3 4"}
              />
            ))}

            {hasEnoughData ? (
              <>
                {/* Capacity fill (only for capacity — primary series) */}
                {segments(capSvg).map((seg, si) => (
                  <Path
                    key={`capfill-${si}`}
                    d={fillPath(seg, CHART_HEIGHT)}
                    fill="url(#capGrad)"
                  />
                ))}

                {/* Capacity line */}
                {segments(capSvg).map((seg, si) => (
                  <Path
                    key={`cap-${si}`}
                    d={smoothPath(seg)}
                    fill="none"
                    stroke={SERIES_COLORS.capacity}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}

                {/* Drain rate line */}
                {segments(drainSvg).map((seg, si) => (
                  <Path
                    key={`drain-${si}`}
                    d={smoothPath(seg)}
                    fill="none"
                    stroke={SERIES_COLORS.drain}
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="5 3"
                  />
                ))}

                {/* Thermal line */}
                {segments(thermalSvg).map((seg, si) => (
                  <Path
                    key={`thermal-${si}`}
                    d={smoothPath(seg)}
                    fill="none"
                    stroke={SERIES_COLORS.thermal}
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="2 4"
                  />
                ))}

                {/* Endpoint dots for capacity (sparse data only) */}
                {capacityPoints.length <= 14 &&
                  capSvg
                    .filter((p) => p.hasData)
                    .map((p, i) => (
                      <Circle
                        key={`cdot-${i}`}
                        cx={p.x} cy={p.y} r={3}
                        fill={SERIES_COLORS.capacity}
                        opacity={0.8}
                      />
                    ))}
              </>
            ) : (
              <>
                {/* Ghost preview lines */}
                {ghosts.map((g, gi) => {
                  const ghostColors = [
                    SERIES_COLORS.capacity,
                    SERIES_COLORS.drain,
                    SERIES_COLORS.thermal,
                  ];
                  return (
                    <React.Fragment key={`ghost-${gi}`}>
                      {gi === 0 && (
                        <Path
                          d={fillPath(g, CHART_HEIGHT)}
                          fill="url(#ghostGrad)"
                        />
                      )}
                      <Path
                        d={smoothPath(g)}
                        fill="none"
                        stroke={ghostColors[gi]}
                        strokeWidth={gi === 0 ? 2 : 1.5}
                        strokeLinecap="round"
                        strokeDasharray="5 4"
                        opacity={0.35}
                      />
                    </React.Fragment>
                  );
                })}
              </>
            )}
          </Svg>

          {/* Empty state overlay */}
          {!hasEnoughData && (
            <View style={styles.overlay} pointerEvents="none">
              <View style={styles.overlayPill}>
                <Text style={styles.overlayText}>
                  Building — a few more days of use will populate this chart
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>

      {/* Date labels */}
      {dateLabels.length > 0 && (
        <View style={styles.dateRow}>
          {dateLabels.map((label, i) => (
            <Text
              key={i}
              style={[
                styles.dateLabel,
                i === 0 && { textAlign: "left" },
                i === Math.floor(dateLabels.length / 2) && { textAlign: "center" },
                i === dateLabels.length - 1 && { textAlign: "right" },
              ]}
            >
              {label}
            </Text>
          ))}
        </View>
      )}

      {/* Info panel — shown when ⓘ is tapped */}
      {infoVisible && (
        <View style={styles.infoPanel}>
          <Text style={styles.infoPanelTitle}>ABOUT THIS CHART</Text>
          <Text style={styles.infoPanelText}>
            <Text style={{ fontWeight: "700" }}>Est. Battery Life</Text> is a relative performance score (0–100%) based on how your battery behaves compared to your personal baseline from the first week of use. It tracks drain speed, charge frequency, and thermal exposure over time.
          </Text>
          <Text style={styles.infoPanelText}>
            <Text style={{ fontWeight: "700" }}>Apple’s Battery Health</Text> (Settings → Battery → Battery Health) is a direct electrochemical measurement of remaining cell capacity. The two numbers measure different things and will not match.
          </Text>
          <Text style={styles.infoPanelNote}>
            Tip: use Apple’s Battery Health for the authoritative reading, and this chart to watch whether your day-to-day performance is trending down over time.
          </Text>
        </View>
      )}

      {/* Legend */}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: SERIES_COLORS.capacity }]} />
          <Text style={styles.legendLabel}>Est. Battery Life</Text>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[
              styles.legendLine,
              { backgroundColor: SERIES_COLORS.drain, opacity: 0.85 },
            ]}
          />
          <Text style={styles.legendLabel}>Drain Rate</Text>
        </View>
        <View style={styles.legendItem}>
          <View
            style={[
              styles.legendLine,
              { backgroundColor: SERIES_COLORS.thermal, opacity: 0.85 },
            ]}
          />
          <Text style={styles.legendLabel}>Temperature</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: CARD_MARGIN,
    marginTop: 16,
    marginBottom: 4,
    backgroundColor: "#F9FAFB",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: CARD_PADDING,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  title: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
    color: "#9CA3AF",
  },
  subtitle: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "500",
    marginTop: 2,
  },
  badge: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 64,
    backgroundColor: "#FFFFFF",
  },
  badgeScore: {
    fontSize: 18,
    fontWeight: "900",
    lineHeight: 22,
  },
  badgeLabel: {
    fontSize: 9,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  chartWrapper: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
  },
  yAxis: {
    width: Y_AXIS_WIDTH,
    height: CHART_HEIGHT,
    position: "relative",
  },
  yLabel: {
    position: "absolute",
    right: 0,
    fontSize: 8,
    color: "#9CA3AF",
    fontWeight: "600",
    textAlign: "right",
  },
  svgContainer: {
    flex: 1,
    height: CHART_HEIGHT,
    position: "relative",
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  overlayPill: {
    backgroundColor: "rgba(255,255,255,0.90)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  overlayText: {
    fontSize: 11,
    color: "#6B7280",
    fontWeight: "600",
    textAlign: "center",
  },
  dateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -6,
  },
  dateLabel: {
    fontSize: 9,
    color: "#9CA3AF",
    fontWeight: "600",
    flex: 1,
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 18,
    paddingTop: 2,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendLine: {
    width: 18,
    height: 2.5,
    borderRadius: 2,
  },
  legendLabel: {
    fontSize: 10,
    color: "#6B7280",
    fontWeight: "600",
  },
  titleGroup: {
    flex: 1,
    marginRight: 8,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  infoBtn: {
    marginTop: -1,
  },
  infoBtnText: {
    fontSize: 14,
    color: "#9CA3AF",
    lineHeight: 16,
  },
  infoPanel: {
    backgroundColor: "#F0F9FF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#BAE6FD",
    padding: 12,
    gap: 6,
  },
  infoPanelTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#0369A1",
    letterSpacing: 0.5,
  },
  infoPanelText: {
    fontSize: 12,
    color: "#374151",
    lineHeight: 18,
    fontWeight: "400",
  },
  infoPanelNote: {
    fontSize: 11,
    color: "#6B7280",
    lineHeight: 16,
    fontStyle: "italic",
  },
});
