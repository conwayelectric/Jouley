/**
 * Onboarding Overlay Walkthrough
 *
 * Renders a semi-transparent dark overlay over the dashboard.
 * Each step highlights a specific area with a "spotlight" cutout and
 * shows a tooltip card with a description and Next/Done button.
 *
 * Steps are positioned relative to known dashboard layout regions.
 * Uses absolute positioning so the dashboard remains fully visible beneath.
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
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const STORAGE_KEY_ONBOARDING_DONE = "conway_onboarding_done";

const { width: W, height: H } = Dimensions.get("window");

// ─── Step definitions ──────────────────────────────────────────────────────────
// Each step defines:
//   spotlight: the rectangular region to "cut out" (highlight)
//   tooltip:   where to position the tooltip card ("top" | "bottom" | "middle")
//   title / body: the explanation text

interface Step {
  id: string;
  title: string;
  body: string;
  spotlight: { x: number; y: number; w: number; h: number } | null;
  tooltipPosition: "top" | "bottom" | "middle";
}

// Positions are expressed as fractions of screen dimensions for responsiveness
const STEPS: Step[] = [
  {
    id: "ring",
    title: "Battery Ring",
    body: "This ring shows your current battery level. The colour tells you where you stand:\n\n🟢 Green: 100 to 75%\n🟡 Yellow: 75 to 50%\n🟠 Orange: 50 to 20%\n🔴 Red: 20 to 0%",
    spotlight: { x: W * 0.1, y: H * 0.12, w: W * 0.8, h: W * 0.8 },
    tooltipPosition: "bottom",
  },
  {
    id: "message",
    title: "Status Message",
    body: "This personalised message reflects both your battery level and how fast it is draining — so you always know how much time you actually have, not just what the percentage says.",
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
    title: "Drain Rate Stats",
    body: "These numbers show how fast your battery is draining right now. A low drain rate means you have more time than the percentage alone suggests — even at 15% you may have an hour left.",
    spotlight: { x: W * 0.05, y: H * 0.68, w: W * 0.9, h: H * 0.08 },
    tooltipPosition: "top",
  },
  {
    id: "notifications",
    title: "Friendly Reminders",
    body: "You will receive gentle reminders at 20, 15, 10, 7, 5, and 2 minutes remaining. They are always worded positively so you have time to act without feeling stressed.",
    spotlight: null,
    tooltipPosition: "middle",
  },
  {
    id: "history",
    title: "Session History",
    body: "Tap the History tab to see a log of your past discharge sessions and a 7-day chart showing your average drain rate per day. Great for spotting patterns in your usage.",
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
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const tooltipAnim = useRef(new Animated.Value(0)).current;

  // Fade in on mount
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, []);

  // Animate tooltip on step change
  useEffect(() => {
    tooltipAnim.setValue(0);
    Animated.timing(tooltipAnim, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [step]);

  const handleNext = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      handleDone();
    }
  };

  const handleDone = async () => {
    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(async () => {
      await AsyncStorage.setItem(STORAGE_KEY_ONBOARDING_DONE, "true");
      onDone();
    });
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const spotlight = current.spotlight;

  // Estimated tooltip card height (title + body + dots + buttons + padding)
  const TOOLTIP_HEIGHT = 260;
  const SAFE_BOTTOM_MARGIN = 100; // tab bar + safe area
  const maxTop = H - TOOLTIP_HEIGHT - SAFE_BOTTOM_MARGIN;

  // Build tooltip vertical position
  let tooltipTop: number;
  if (current.tooltipPosition === "top") {
    tooltipTop = H * 0.08;
  } else if (current.tooltipPosition === "bottom") {
    const spotBottom = spotlight ? spotlight.y + spotlight.h : H * 0.5;
    tooltipTop = spotBottom + 16;
  } else {
    tooltipTop = H * 0.35;
  }
  // Clamp so the card never overflows the bottom of the screen
  tooltipTop = Math.min(tooltipTop, maxTop);
  tooltipTop = Math.max(tooltipTop, H * 0.06);

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]} pointerEvents="box-none">
      {/* Dark overlay — rendered as 4 rectangles around the spotlight */}
      {spotlight ? (
        <>
          {/* Top */}
          <View style={[styles.overlay, { top: 0, left: 0, right: 0, height: spotlight.y }]} />
          {/* Bottom */}
          <View style={[styles.overlay, { top: spotlight.y + spotlight.h, left: 0, right: 0, bottom: 0 }]} />
          {/* Left */}
          <View style={[styles.overlay, { top: spotlight.y, left: 0, width: spotlight.x, height: spotlight.h }]} />
          {/* Right */}
          <View style={[styles.overlay, { top: spotlight.y, left: spotlight.x + spotlight.w, right: 0, height: spotlight.h }]} />
          {/* Spotlight border */}
          <View
            style={[
              styles.spotlightBorder,
              {
                top: spotlight.y - 3,
                left: spotlight.x - 3,
                width: spotlight.w + 6,
                height: spotlight.h + 6,
              },
            ]}
            pointerEvents="none"
          />
        </>
      ) : (
        // Full overlay when no spotlight
        <View style={[styles.overlay, StyleSheet.absoluteFillObject]} />
      )}

      {/* Tooltip card */}
      <Animated.View
        style={[
          styles.tooltip,
          {
            top: tooltipTop,
            opacity: tooltipAnim,
            transform: [{ translateY: tooltipAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          },
        ]}
      >
        {/* Step counter */}
        <View style={styles.stepRow}>
          <Text style={styles.stepCounter}>{step + 1} of {STEPS.length}</Text>
          <TouchableOpacity onPress={handleDone} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.tooltipTitle}>{current.title}</Text>
        <ScrollView
          style={styles.bodyScroll}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <Text style={styles.tooltipBody}>{current.body}</Text>
        </ScrollView>

        {/* Dot indicators */}
        <View style={styles.dotsRow}>
          {STEPS.map((_, i) => (
            <View key={i} style={[styles.dot, i === step && styles.dotActive]} />
          ))}
        </View>

        {/* Navigation buttons */}
        <View style={styles.navRow}>
          {step > 0 && (
            <TouchableOpacity style={styles.backBtn} onPress={() => setStep(step - 1)}>
              <Text style={styles.backBtnText}>Back</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.nextBtn, isLast && styles.nextBtnGreen]}
            onPress={handleNext}
          >
            <Text style={styles.nextBtnText}>{isLast ? "Got it" : "Next"}</Text>
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
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  spotlightBorder: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
    borderRadius: 14,
  },
  tooltip: {
    position: "absolute",
    left: 20,
    right: 20,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 20,
    gap: 10,
    // Prevent the card from ever growing taller than ~60% of the screen
    maxHeight: "60%",
  },
  bodyScroll: {
    maxHeight: 120,
  },
  stepRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stepCounter: {
    fontSize: 11,
    fontWeight: "700",
    color: "#9CA3AF",
    letterSpacing: 1,
  },
  skipText: {
    fontSize: 13,
    color: "#9CA3AF",
    fontWeight: "500",
  },
  tooltipTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.3,
    lineHeight: 24,
  },
  tooltipBody: {
    fontSize: 14,
    color: "#374151",
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
    backgroundColor: "#D1D5DB",
  },
  dotActive: {
    backgroundColor: "#111827",
    width: 18,
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
    backgroundColor: "#111827",
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 100,
    alignItems: "center",
  },
  nextBtnGreen: {
    backgroundColor: "#16A34A",
  },
  nextBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
});
