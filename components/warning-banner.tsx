import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";

interface WarningBannerProps {
  minutesLeft: number | null;
  activeWarning: number | null;
}

function getWarningStyle(minutes: number) {
  if (minutes <= 5) {
    return {
      bg: "#E8450A",
      border: "#FF6B35",
      text: "#FFFFFF",
      icon: "🔴",
    };
  }
  if (minutes <= 10) {
    return {
      bg: "#B83200",
      border: "#E8450A",
      text: "#FFFFFF",
      icon: "⚠️",
    };
  }
  return {
    bg: "#1A1A1A",
    border: "#F59E0B",
    text: "#F59E0B",
    icon: "⚠️",
  };
}

function getWarningMessage(minutes: number): string {
  if (minutes <= 2) return "Battery critically low — plug in immediately!";
  if (minutes <= 5) return `Only ${minutes} minutes remaining — charge now!`;
  if (minutes <= 7) return `${minutes} minutes of battery left — find a charger.`;
  if (minutes <= 10) return `${minutes} minutes remaining — consider charging soon.`;
  if (minutes <= 15) return `${minutes} minutes of battery remaining.`;
  return `${minutes} minutes of battery remaining.`;
}

export function WarningBanner({ minutesLeft, activeWarning }: WarningBannerProps) {
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  const shouldShow = activeWarning !== null && minutesLeft !== null && minutesLeft <= 20;

  useEffect(() => {
    if (shouldShow) {
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          tension: 80,
          friction: 10,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -80,
          duration: 250,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [shouldShow, activeWarning]);

  if (!shouldShow || minutesLeft === null) return null;

  const style = getWarningStyle(minutesLeft);
  const message = getWarningMessage(minutesLeft);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: style.bg,
          borderColor: style.border,
          transform: [{ translateY: slideAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      <Text style={styles.icon}>{style.icon}</Text>
      <View style={styles.textContainer}>
        <Text style={[styles.title, { color: style.text }]}>BATTERY WARNING</Text>
        <Text style={[styles.message, { color: style.text }]}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    gap: 12,
  },
  icon: {
    fontSize: 24,
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
  },
  message: {
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
});
