/**
 * health-line-chart.tsx
 *
 * A minimal, smooth SVG line chart for battery health trends.
 * Always renders the full chart frame — when data is insufficient a ghost
 * preview line is shown with a gentle overlay message so users can see
 * what the chart will look like once it populates.
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
const CHART_WIDTH = SCREEN_WIDTH - CARD_MARGIN * 2 - CARD_PADDING * 2 - 36; // subtract y-axis width
const CHART_HEIGHT = 120;

// ─── Color helpers ───────────────────────────────────────────────────────────

export function drainRateColor(rate: number): string {
  if (rate <= 0.15) return "#16A34A";
  if (rate <= 0.40) return "#EAB308";
  if (rate <= 0.60) return "#F97316";
  return "#EF4444";
}

export function thermalScoreColor(score: number): string {
  if (score < 0.25) return "#00C2FF";
  if (score < 0.50) return "#F5A623";
  if (score < 0.75) return "#FF6B00";
  return "#FF2D2D";
}

// ─── Smooth path builder ─────────────────────────────────────────────────────

function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  const d: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
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
  const line = smoothPath(pts);
  return `${line} L ${pts[pts.length - 1].x} ${h} L ${pts[0].x} ${h} Z`;
}

/**
 * Generates a gentle ghost/preview sine-wave-like path for the empty state.
 * This gives users a sense of what the chart will look like when populated.
 */
function ghostPoints(n: number, h: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    const wave = Math.sin(t * Math.PI * 2.5) * 0.18 + Math.sin(t * Math.PI * 1.2) * 0.10;
    const y = h * 0.45 + wave * h;
    return { x: t * CHART_WIDTH, y };
  });
}

// ─── Chart component ─────────────────────────────────────────────────────────

export type ChartSeries = "drain" | "thermal";

interface HealthLineChartProps {
  points: ChartPoint[];
  series: ChartSeries;
  title: string;
  subtitle: string;
  unit: string;
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

  const defaultLineColor = series === "drain" ? "#16A34A" : "#00C2FF";
  const gradientId = series === "drain" ? "drainGrad" : "thermalGrad";
  const ghostGradId = series === "drain" ? "drainGhostGrad" : "thermalGhostGrad";

  const { svgPoints, gridValues, lineColor } = useMemo(() => {
    const rawMax = maxValueProp ?? Math.max(...dataPoints.map((p) => p.value), 0.6);
    const maxVal = rawMax * 1.15;
    const range = maxVal || 1;

    const svgPoints = points.map((p, i) => ({
      x: (i / Math.max(points.length - 1, 1)) * CHART_WIDTH,
      y: p.hasData ? CHART_HEIGHT - (p.value / range) * CHART_HEIGHT : CHART_HEIGHT,
      hasData: p.hasData,
      value: p.value,
      date: p.date,
    }));

    const gridValues = [0, 0.5, 1.0].map((f) => ({
      y: CHART_HEIGHT - f * CHART_HEIGHT,
      label: (f * maxVal).toFixed(2),
    }));

    const avg =
      dataPoints.length > 0
        ? dataPoints.reduce((s, p) => s + p.value, 0) / dataPoints.length
        : 0;
    const lineColor =
      series === "drain" ? drainRateColor(avg) : thermalScoreColor(avg);

    return { svgPoints, gridValues, lineColor };
  }, [points, series, maxValueProp, dataPoints]);

  // Split into contiguous segments
  const segments = useMemo(() => {
    const segs: { x: number; y: number }[][] = [];
    let cur: { x: number; y: number }[] = [];
    for (const p of svgPoints) {
      if (p.hasData) {
        cur.push({ x: p.x, y: p.y });
      } else {
        if (cur.length >= 2) segs.push(cur);
        cur = [];
      }
    }
    if (cur.length >= 2) segs.push(cur);
    return segs;
  }, [svgPoints]);

  // Ghost preview points for empty state
  const ghost = useMemo(() => ghostPoints(30, CHART_HEIGHT), []);

  // Date labels: first / middle / last
  const dateLabels = useMemo(() => {
    if (points.length === 0) return [];
    const indices = [0, Math.floor(points.length / 2), points.length - 1];
    return indices.map((i) => ({ label: points[i].date }));
  }, [points]);

  const activeColor = hasEnoughData ? lineColor : defaultLineColor;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>

      {/* Chart always renders */}
      <View style={styles.chartWrapper}>
        {/* Y-axis */}
        <View style={styles.yAxis}>
          {gridValues.map((g, i) => (
            <Text key={i} style={[styles.yLabel, { top: g.y - 6 }]}>
              {g.label}
            </Text>
          ))}
        </View>

        {/* SVG + overlay container */}
        <View style={styles.svgContainer}>
          <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
            <Defs>
              {/* Real data gradient */}
              <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={activeColor} stopOpacity="0.28" />
                <Stop offset="1" stopColor={activeColor} stopOpacity="0.02" />
              </LinearGradient>
              {/* Ghost gradient */}
              <LinearGradient id={ghostGradId} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#D1D5DB" stopOpacity="0.35" />
                <Stop offset="1" stopColor="#D1D5DB" stopOpacity="0.02" />
              </LinearGradient>
            </Defs>

            {/* Grid lines */}
            {gridValues.map((g, i) => (
              <Line
                key={i}
                x1={0} y1={g.y} x2={CHART_WIDTH} y2={g.y}
                stroke="#E5E7EB"
                strokeWidth={1}
                strokeDasharray={i === 0 ? undefined : "4 4"}
              />
            ))}

            {hasEnoughData ? (
              <>
                {segments.map((seg, si) => (
                  <React.Fragment key={si}>
                    <Path d={fillPath(seg, CHART_HEIGHT)} fill={`url(#${gradientId})`} />
                    <Path
                      d={smoothPath(seg)}
                      fill="none"
                      stroke={activeColor}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </React.Fragment>
                ))}
                {/* Dots for sparse data */}
                {points.length <= 14 &&
                  svgPoints.filter((p) => p.hasData).map((p, i) => (
                    <Circle key={i} cx={p.x} cy={p.y} r={3} fill={activeColor} opacity={0.85} />
                  ))}
              </>
            ) : (
              <>
                {/* Ghost preview line */}
                <Path d={fillPath(ghost, CHART_HEIGHT)} fill={`url(#${ghostGradId})`} />
                <Path
                  d={smoothPath(ghost)}
                  fill="none"
                  stroke="#D1D5DB"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="6 4"
                />
              </>
            )}
          </Svg>

          {/* Overlay message when not enough data */}
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
    backgroundColor: "rgba(255,255,255,0.88)",
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
    marginTop: -4,
  },
  dateLabel: {
    fontSize: 9,
    color: "#9CA3AF",
    fontWeight: "600",
    flex: 1,
  },
});
