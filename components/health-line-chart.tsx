/**
 * health-line-chart.tsx
 *
 * A minimal, smooth SVG line chart for battery health trends.
 * Supports two series: drain rate and thermal score.
 *
 * Design principles:
 * - Smooth cubic bezier curves (no sharp corners)
 * - Colors match the battery ring gradient (drain) and thermal gauge (thermal)
 * - Minimal grid — only a few horizontal reference lines
 * - No heavy axis labels; just a light date range at the bottom
 * - Gradient fill under the line for depth
 */

import React, { useMemo } from "react";
import { View, Text, StyleSheet, Dimensions } from "react-native";
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
const CHART_WIDTH = SCREEN_WIDTH - CARD_MARGIN * 2 - CARD_PADDING * 2;
const CHART_HEIGHT = 120;
const GRID_LINES = 3;

// ─── Color helpers ──────────────────────────────────────────────────────────────

/**
 * Maps a drain rate (%/min) to the battery ring gradient color.
 * red ≤0.20, orange 0.20–0.50, yellow 0.50–0.75 (scaled), green >0.75 (low drain)
 *
 * Note: for drain rate, LOWER is better (green), HIGHER is worse (red).
 * We map: 0–0.15 → green, 0.15–0.40 → yellow, 0.40–0.60 → orange, >0.60 → red
 */
export function drainRateColor(rate: number): string {
  if (rate <= 0.15) return "#16A34A"; // green
  if (rate <= 0.40) return "#EAB308"; // yellow
  if (rate <= 0.60) return "#F97316"; // orange
  return "#EF4444";                   // red
}

/**
 * Maps a thermal score (0–1) to the thermal gauge color.
 * Matches ZONE_COLORS in thermal-gauge.tsx.
 */
export function thermalScoreColor(score: number): string {
  if (score < 0.25) return "#00C2FF"; // cool — blue
  if (score < 0.50) return "#F5A623"; // warm — amber
  if (score < 0.75) return "#FF6B00"; // hot — orange
  return "#FF2D2D";                   // critical — red
}

// ─── Smooth path builder ────────────────────────────────────────────────────────

/**
 * Builds a smooth cubic bezier SVG path through a set of (x, y) points.
 * Uses a simple catmull-rom → bezier conversion for natural curves.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";

  const d: string[] = [`M ${points[0].x} ${points[0].y}`];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom control points
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
  }

  return d.join(" ");
}

/**
 * Builds the closed fill path (line + bottom close) for the gradient fill.
 */
function fillPath(
  points: { x: number; y: number }[],
  chartHeight: number
): string {
  if (points.length < 2) return "";
  const line = smoothPath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L ${last.x} ${chartHeight} L ${first.x} ${chartHeight} Z`;
}

// ─── Chart component ────────────────────────────────────────────────────────────

export type ChartSeries = "drain" | "thermal";

interface HealthLineChartProps {
  points: ChartPoint[];
  series: ChartSeries;
  title: string;
  subtitle: string;
  /** Unit label for the y-axis (e.g. "%/min", "score") */
  unit: string;
  /** Max value for y-axis scale; auto-computed if not provided */
  maxValue?: number;
}

export function HealthLineChart({
  points,
  series,
  title,
  subtitle,
  unit,
  maxValue: maxValueProp,
}: HealthLineChartProps) {
  const dataPoints = points.filter((p) => p.hasData);
  const hasEnoughData = dataPoints.length >= 3;

  const { svgPoints, maxVal, minVal, gridValues, lineColor, gradientId } =
    useMemo(() => {
      const values = points.map((p) => p.value);
      const rawMax = maxValueProp ?? Math.max(...values.filter((v) => v > 0), 0.6);
      const rawMin = 0;
      const maxVal = rawMax * 1.15; // 15% headroom
      const minVal = rawMin;
      const range = maxVal - minVal || 1;

      const svgPoints = points.map((p, i) => ({
        x: (i / Math.max(points.length - 1, 1)) * CHART_WIDTH,
        y: p.hasData
          ? CHART_HEIGHT - ((p.value - minVal) / range) * CHART_HEIGHT
          : CHART_HEIGHT, // no-data points sit at baseline
        hasData: p.hasData,
        value: p.value,
        date: p.date,
      }));

      // Grid lines at 0%, 50%, 100% of max
      const gridValues = [0, 0.5, 1.0].map((f) => ({
        y: CHART_HEIGHT - f * CHART_HEIGHT,
        label: (minVal + f * (maxVal - minVal)).toFixed(2),
      }));

      const lineColor =
        series === "drain"
          ? drainRateColor(
              dataPoints.length > 0
                ? dataPoints.reduce((s, p) => s + p.value, 0) / dataPoints.length
                : 0
            )
          : thermalScoreColor(
              dataPoints.length > 0
                ? dataPoints.reduce((s, p) => s + p.value, 0) / dataPoints.length
                : 0
            );

      const gradientId = series === "drain" ? "drainGrad" : "thermalGrad";

      return { svgPoints, maxVal, minVal, gridValues, lineColor, gradientId };
    }, [points, series, maxValueProp, dataPoints]);

  // Only draw the line through points that have data
  // Split into contiguous segments to avoid lines crossing empty gaps
  const segments = useMemo(() => {
    const segs: { x: number; y: number }[][] = [];
    let current: { x: number; y: number }[] = [];

    for (const p of svgPoints) {
      if (p.hasData) {
        current.push({ x: p.x, y: p.y });
      } else {
        if (current.length >= 2) segs.push(current);
        current = [];
      }
    }
    if (current.length >= 2) segs.push(current);
    return segs;
  }, [svgPoints]);

  // Date labels: show first, middle, last
  const dateLabels = useMemo(() => {
    if (points.length === 0) return [];
    const indices = [0, Math.floor(points.length / 2), points.length - 1];
    return indices.map((i) => ({
      x: (i / Math.max(points.length - 1, 1)) * CHART_WIDTH,
      label: points[i].date,
    }));
  }, [points]);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      {!hasEnoughData ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            A few more days of data needed to draw this chart.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.chartWrapper}>
            {/* Y-axis labels */}
            <View style={styles.yAxis}>
              {gridValues.map((g, i) => (
                <Text
                  key={i}
                  style={[styles.yLabel, { top: g.y - 6 }]}
                >
                  {g.label}
                </Text>
              ))}
            </View>

            {/* SVG chart */}
            <Svg
              width={CHART_WIDTH}
              height={CHART_HEIGHT}
              style={styles.svg}
            >
              <Defs>
                <LinearGradient
                  id={gradientId}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <Stop
                    offset="0"
                    stopColor={lineColor}
                    stopOpacity="0.25"
                  />
                  <Stop
                    offset="1"
                    stopColor={lineColor}
                    stopOpacity="0.02"
                  />
                </LinearGradient>
              </Defs>

              {/* Grid lines */}
              {gridValues.map((g, i) => (
                <Line
                  key={i}
                  x1={0}
                  y1={g.y}
                  x2={CHART_WIDTH}
                  y2={g.y}
                  stroke="#E5E7EB"
                  strokeWidth={1}
                  strokeDasharray={i === 0 ? undefined : "4 4"}
                />
              ))}

              {/* Fill + line for each contiguous segment */}
              {segments.map((seg, si) => (
                <React.Fragment key={si}>
                  {/* Gradient fill */}
                  <Path
                    d={fillPath(seg, CHART_HEIGHT)}
                    fill={`url(#${gradientId})`}
                  />
                  {/* Smooth line */}
                  <Path
                    d={smoothPath(seg)}
                    fill="none"
                    stroke={lineColor}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </React.Fragment>
              ))}

              {/* Dots at data points (only for sparse data) */}
              {points.length <= 14 &&
                svgPoints
                  .filter((p) => p.hasData)
                  .map((p, i) => (
                    <Circle
                      key={i}
                      cx={p.x}
                      cy={p.y}
                      r={3}
                      fill={lineColor}
                      opacity={0.85}
                    />
                  ))}
            </Svg>
          </View>

          {/* Date labels */}
          <View style={styles.dateRow}>
            {dateLabels.map((d, i) => (
              <Text
                key={i}
                style={[
                  styles.dateLabel,
                  i === 0 && { textAlign: "left" },
                  i === 1 && { textAlign: "center" },
                  i === 2 && { textAlign: "right" },
                ]}
              >
                {d.label}
              </Text>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: CARD_MARGIN,
    marginTop: 12,
    marginBottom: 4,
    backgroundColor: "#F9FAFB",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: CARD_PADDING,
    gap: 10,
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
    marginTop: -6,
  },
  chartWrapper: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
  },
  yAxis: {
    width: 32,
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
  svg: {
    flex: 1,
  },
  dateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: -4,
  },
  dateLabel: {
    fontSize: 9,
    color: "#9CA3AF",
    fontWeight: "600",
    flex: 1,
  },
  emptyState: {
    height: 80,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 12,
    color: "#9CA3AF",
    textAlign: "center",
    lineHeight: 18,
  },
});
