import React, { useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Image,
  Platform,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const STORAGE_KEY_ONBOARDING_DONE = "conway_onboarding_done";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface OnboardingSlide {
  id: string;
  emoji: string;
  title: string;
  body: string;
  highlight?: string; // optional coloured highlight line
  highlightColor?: string;
}

const SLIDES: OnboardingSlide[] = [
  {
    id: "welcome",
    emoji: "⚡",
    title: "Welcome to Battery Buddy",
    body: "Battery Buddy keeps you informed about your battery in a calm, positive way — so you're never caught off guard.",
  },
  {
    id: "ring",
    emoji: "🔋",
    title: "Your Battery Ring",
    body: "The large ring shows your current battery level at a glance. The colour tells you where you stand:",
    highlight: "Green (75–100%) · Yellow (50–75%) · Orange (20–50%) · Red (0–20%)",
    highlightColor: "#16A34A",
  },
  {
    id: "time",
    emoji: "⏱",
    title: "Time Remaining",
    body: "Below the ring you'll see how many minutes or hours of use you have left, based on your actual drain rate — not a generic estimate.",
  },
  {
    id: "message",
    emoji: "💬",
    title: "Your Status Message",
    body: "The one-line message between the ring and the time display is personalised to your battery level and how fast it's draining. It's there to reassure you, not stress you out.",
  },
  {
    id: "drain",
    emoji: "📊",
    title: "Drain Rate",
    body: "The stats row shows your current drain rate in % per minute. A low drain rate means you have more time than the percentage alone suggests.",
  },
  {
    id: "notifications",
    emoji: "🔔",
    title: "Friendly Reminders",
    body: "You'll receive gentle reminders at 20, 15, 10, 7, 5, and 2 minutes remaining — always worded positively so you have time to act without feeling stressed.",
  },
  {
    id: "spike",
    emoji: "⚡",
    title: "Higher Drain Alerts",
    body: "If your battery starts draining faster than usual, a card will appear suggesting you check Settings → Battery. This can help you spot a power-hungry app running in the background.",
  },
  {
    id: "history",
    emoji: "📅",
    title: "Session History",
    body: "The History tab keeps a log of your discharge sessions and shows a weekly chart so you can spot patterns in your battery usage over time.",
  },
  {
    id: "ready",
    emoji: "✅",
    title: "You're All Set",
    body: "That's everything you need to know. Enjoy using Battery Buddy — and remember, your battery is in good hands.",
  },
];

interface OnboardingWalkthroughProps {
  onDone: () => void;
}

export function OnboardingWalkthrough({ onDone }: OnboardingWalkthroughProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  const goTo = (index: number) => {
    scrollRef.current?.scrollTo({ x: index * SCREEN_WIDTH, animated: true });
    setCurrentIndex(index);
  };

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      goTo(currentIndex + 1);
    } else {
      handleDone();
    }
  };

  const handleDone = async () => {
    await AsyncStorage.setItem(STORAGE_KEY_ONBOARDING_DONE, "true");
    onDone();
  };

  const handleScroll = (event: { nativeEvent: { contentOffset: { x: number } } }) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setCurrentIndex(index);
  };

  const isLast = currentIndex === SLIDES.length - 1;

  return (
    <View style={styles.container}>
      {/* Logo header */}
      <View style={styles.logoRow}>
        <Image
          source={require("@/assets/images/conway_streetlight_logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.brandName}>CONWAY ELECTRIC</Text>
      </View>

      {/* Slides */}
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleScroll}
        style={styles.slideScroll}
      >
        {SLIDES.map((slide) => (
          <View key={slide.id} style={styles.slide}>
            <Text style={styles.slideEmoji}>{slide.emoji}</Text>
            <Text style={styles.slideTitle}>{slide.title}</Text>
            <Text style={styles.slideBody}>{slide.body}</Text>
            {slide.highlight && (
              <View style={[styles.highlightBox, { borderColor: slide.highlightColor ?? "#0a7ea4" }]}>
                <Text style={[styles.highlightText, { color: slide.highlightColor ?? "#0a7ea4" }]}>
                  {slide.highlight}
                </Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {/* Dot indicators */}
      <View style={styles.dotsRow}>
        {SLIDES.map((_, i) => (
          <TouchableOpacity key={i} onPress={() => goTo(i)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <View style={[styles.dot, i === currentIndex && styles.dotActive]} />
          </TouchableOpacity>
        ))}
      </View>

      {/* Navigation buttons */}
      <View style={styles.navRow}>
        {currentIndex > 0 ? (
          <TouchableOpacity style={styles.backBtn} onPress={() => goTo(currentIndex - 1)}>
            <Text style={styles.backBtnText}>Back</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.backBtn} />
        )}

        <TouchableOpacity style={[styles.nextBtn, isLast && styles.nextBtnGreen]} onPress={handleNext}>
          <Text style={styles.nextBtnText}>{isLast ? "Get Started" : "Next"}</Text>
        </TouchableOpacity>
      </View>

      {/* Skip link — only on first slide */}
      {currentIndex === 0 && (
        <TouchableOpacity style={styles.skipBtn} onPress={handleDone}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: 40,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginBottom: 8,
    paddingHorizontal: 24,
  },
  logo: {
    width: 32,
    height: 32,
  },
  brandName: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 2,
    color: "#111827",
  },
  slideScroll: {
    flex: 1,
  },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
    gap: 16,
  },
  slideEmoji: {
    fontSize: 64,
    lineHeight: 76,
  },
  slideTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#111827",
    textAlign: "center",
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  slideBody: {
    fontSize: 16,
    fontWeight: "400",
    color: "#374151",
    textAlign: "center",
    lineHeight: 24,
  },
  highlightBox: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 4,
  },
  highlightText: {
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 22,
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#D1D5DB",
  },
  dotActive: {
    backgroundColor: "#111827",
    width: 20,
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 8,
  },
  backBtn: {
    width: 80,
    alignItems: "flex-start",
  },
  backBtnText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#6B7280",
  },
  nextBtn: {
    backgroundColor: "#111827",
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 14,
    minWidth: 130,
    alignItems: "center",
  },
  nextBtnGreen: {
    backgroundColor: "#16A34A",
  },
  nextBtnText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.5,
  },
  skipBtn: {
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipText: {
    fontSize: 14,
    color: "#9CA3AF",
    fontWeight: "500",
  },
});
