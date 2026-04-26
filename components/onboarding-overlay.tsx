/**
 * Onboarding Overlay Walkthrough — Battery Friend
 *
 * Renders a warm, bright overlay over the dashboard.
 * Each step highlights a specific area with a spotlight cutout and
 * shows a friendly tooltip card with a description and Next button.
 */
import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Dimensions,
  ScrollView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const STORAGE_KEY_ONBOARDING_DONE = "conway_onboarding_done";

const { width: W, height: H } = Dimensions.get("window");

// ─── Brand colours ─────────────────────────────────────────────────────────────
const BRAND_GREEN = "#16A34A";
const BRAND_TEAL  = "#0891B2";
const CARD_BG     = "#F0FDF4";   // very light green — warm and friendly
const OVERLAY_BG  = "rgba(0,40,20,0.55)"; // softer, slightly green-tinted dark

// ─── Step definitions ──────────────────────────────────────────────────────────
interface Step {
  id: string;
  title: string;
  tagline?: string;
  body: string;
  spotlight: { x: number; y: number; w: number; h: number } | null;
  tooltipPosition: "top" | "bottom" | "middle";
}

const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Welcome to JOULEY",
    tagline: "Keep your battery alive",
    body: "Hi there! Jouley is here to keep you calm and informed about your battery — no stress, just friendly reminders and helpful tips. Let's take a quick tour so you know where everything is.",
    spotlight: null,
    tooltipPosition: "middle",
  },
  {
    id: "ring",
    title: "Your Battery Ring",
    body: "This ring shows your current battery level at a glance. The colour tells you where you stand:\n\n🟢 Green: 85–100% — fully charged and ready\n🟡 Yellow: 50–70% — still plenty of time\n🟠 Amber: 25–40% — worth thinking about a charger\n🔴 Orange: 0–15% — time to plug in soon",
    spotlight: { x: W * 0.1, y: H * 0.12, w: W * 0.8, h: W * 0.8 },
    tooltipPosition: "bottom",
  },
  {
    id: "message",
    title: "Your Personal Status",
    body: "This friendly message is tailored to both your battery level and how fast it is draining — so you always know how much time you actually have, not just what the percentage says.",
    spotlight: { x: W * 0.05, y: H * 0.52, w: W * 0.9, h: H * 0.06 },
    tooltipPosition: "bottom",
  },
  {
    id: "time",
    title: "Time Remaining",
    body: "This shows how many minutes or hours of use you have left, calculated from your real drain rate — not a generic estimate. It updates every few seconds as your usage changes.",
    spotlight: { x: W * 0.05, y: H * 0.58, w: W * 0.9, h: H * 0.1 },
    tooltipPosition: "bottom",
  },
  {
    id: "stats",
    title: "Drain Rate",
    body: "These numbers show how fast your battery is draining right now. A low drain rate means you have more time than the percentage alone suggests — even at 15% you may have an hour left.",
    spotlight: { x: W * 0.05, y: H * 0.68, w: W * 0.9, h: H * 0.08 },
    tooltipPosition: "top",
  },
  {
    id: "notifications",
    title: "Friendly Reminders",
    body: "Battery Friend will send you gentle, positive reminders at 20, 15, 10, 7, 5, and 2 minutes remaining — always worded to help you feel in control, not stressed.",
    spotlight: null,
    tooltipPosition: "middle",
  },
  {
    id: "history",
    title: "Session History",
    body: "Tap the History tab to see your past sessions and a 7-day chart of your average drain rate. Great for spotting patterns and understanding your battery habits over time.",
    spotlight: null,
    tooltipPosition: "middle",
  },
];

// ─── Component ─────────────────────────────────────────────────────────────────

interface OnboardingOverlayProps {
  onDone: () => void;
}

export function OnboardingOverlay({ onDone }: OnboardingOverlayProps) {
  const [step, setStep] = React.useState(0);
  const fadeAnim   = useRef(new Animated.Value(0)).current;
  const tooltipAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    tooltipAnim.setValue(0);
    Animated.timing(tooltipAnim, { toValue: 1, duration: 240, useNativeDriver: true }).start();
  }, [step]);

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleDone();
    }
  };

  const handleDone = async () => {
    Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }).start(async () => {
      await AsyncStorage.setItem(STORAGE_KEY_ONBOARDING_DONE, "true");
      onDone();
    });
  };

  const current  = STEPS[step];
  const isLast   = step === STEPS.length - 1;
  const spotlight = current.spotlight;

  const TOOLTIP_HEIGHT    = 280;
  const SAFE_BOTTOM_MARGIN = 110;
  const maxTop = H - TOOLTIP_HEIGHT - SAFE_BOTTOM_MARGIN;

  let tooltipTop: number;
  if (current.tooltipPosition === "top") {
    tooltipTop = H * 0.08;
  } else if (current.tooltipPosition === "bottom") {
    const spotBottom = spotlight ? spotlight.y + spotlight.h : H * 0.5;
    tooltipTop = spotBottom + 18;
  } else {
    tooltipTop = H * 0.3;
  }
  tooltipTop = Math.min(tooltipTop, maxTop);
  tooltipTop = Math.max(tooltipTop, H * 0.06);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]} pointerEvents="box-none">
      {/* Overlay panels */}
      {spotlight ? (
        <>
          <View style={[styles.overlay, { top: 0, left: 0, right: 0, height: spotlight.y }]} />
          <View style={[styles.overlay, { top: spotlight.y + spotlight.h, left: 0, right: 0, bottom: 0 }]} />
          <View style={[styles.overlay, { top: spotlight.y, left: 0, width: spotlight.x, height: spotlight.h }]} />
          <View style={[styles.overlay, { top: spotlight.y, left: spotlight.x + spotlight.w, right: 0, height: spotlight.h }]} />
          {/* Bright spotlight border */}
          <View
            style={[
              styles.spotlightBorder,
              { top: spotlight.y - 4, left: spotlight.x - 4, width: spotlight.w + 8, height: spotlight.h + 8 },
            ]}
            pointerEvents="none"
          />
        </>
      ) : (
        <View style={[styles.overlay, StyleSheet.absoluteFillObject]} />
      )}

      {/* Tooltip card */}
      <Animated.View
        style={[
          styles.tooltip,
          {
            top: tooltipTop,
            opacity: tooltipAnim,
            transform: [{ translateY: tooltipAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
          },
        ]}
      >
        {/* Header row */}
        <View style={styles.stepRow}>
          <View style={styles.stepPill}>
            <Text style={styles.stepCounter}>{step + 1} of {STEPS.length}</Text>
          </View>
          <TouchableOpacity onPress={handleDone} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.skipText}>Skip tour</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.tooltipTitle}>{current.title}</Text>
        {current.tagline ? <Text style={styles.tooltipTagline}>{current.tagline}</Text> : null}

        <ScrollView style={styles.bodyScroll} showsVerticalScrollIndicator={false} bounces={false}>
          <Text style={styles.tooltipBody}>{current.body}</Text>
        </ScrollView>

        {/* Progress dots */}
        <View style={styles.dotsRow}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>

        {/* Navigation */}
        <View style={styles.navRow}>
          {step > 0 && (
            <TouchableOpacity style={styles.backBtn} onPress={() => setStep(step - 1)}>
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.nextBtn, isLast && styles.nextBtnDone]}
            onPress={handleNext}
          >
            <Text style={styles.nextBtnText}>{isLast ? "Let's go" : "Next"}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
  },
  overlay: {
    position: "absolute",
    backgroundColor: OVERLAY_BG,
  },
  spotlightBorder: {
    position: "absolute",
    borderWidth: 2.5,
    borderColor: "#86EFAC", // bright green border around spotlight
    borderRadius: 16,
  },
  tooltip: {
    position: "absolute",
    left: 18,
    right: 18,
    backgroundColor: CARD_BG,
    borderRadius: 20,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 18,
    gap: 10,
    maxHeight: "62%",
    borderWidth: 1.5,
    borderColor: "#BBF7D0", // soft green border on card
  },
  bodyScroll: {
    maxHeight: 130,
  },
  stepRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stepPill: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  stepCounter: {
    fontSize: 11,
    fontWeight: "700",
    color: BRAND_GREEN,
    letterSpacing: 0.5,
  },
  skipText: {
    fontSize: 13,
    color: "#6B7280",
    fontWeight: "500",
  },
  tooltipTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: "#064E3B",
    letterSpacing: -0.3,
    lineHeight: 25,
  },
  tooltipTagline: {
    fontSize: 12,
    fontWeight: "400",
    color: "#059669",
    letterSpacing: 0.5,
    fontStyle: "italic",
    marginTop: 2,
    marginBottom: 4,
  },
  tooltipBody: {
    fontSize: 14,
    color: "#1F4E3D",
    lineHeight: 22,
    fontWeight: "400",
  },
  dotsRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#BBF7D0",
  },
  dotActive: {
    backgroundColor: BRAND_GREEN,
    width: 20,
    borderRadius: 3,
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },
  backBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6B7280",
  },
  nextBtn: {
    backgroundColor: BRAND_TEAL,
    paddingHorizontal: 28,
    paddingVertical: 13,
    borderRadius: 14,
    minWidth: 110,
    alignItems: "center",
  },
  nextBtnDone: {
    backgroundColor: BRAND_GREEN,
  },
  nextBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
});
