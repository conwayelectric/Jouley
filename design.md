# Battery Guardian — Design Document

## App Concept
A real-time battery monitoring app that acts like a personal battery assistant. It tracks drain rate, estimates how much time is left, fires progressive warnings before the battery dies, and — when charging — shows exactly how long until each key milestone is reached.

---

## Color Palette

| Role | Color | Hex |
|---|---|---|
| Background (dark) | Deep Navy | `#0A0E1A` |
| Card surface | Dark Slate | `#141828` |
| Primary accent (healthy) | Electric Green | `#39FF14` |
| Warning accent | Amber | `#F5A623` |
| Critical accent | Crimson Red | `#FF3B30` |
| Charging accent | Sky Blue | `#00C6FF` |
| Text primary | White | `#FFFFFF` |
| Text secondary | Cool Gray | `#8E9BB5` |
| Divider / border | Subtle Slate | `#2A3050` |

The dark navy background gives a high-tech "power dashboard" feel. The neon green ring communicates healthy battery at a glance; it transitions through amber → red as the battery drains.

---

## Screen List

### 1. Home Screen (single-screen app)
The entire app lives on one scrollable screen with two dynamic modes:

- **Discharge Mode** — shown when the phone is unplugged
- **Charging Mode** — shown when the phone is plugged in

---

## Primary Content & Functionality

### Discharge Mode Layout (top → bottom)

1. **App Header Bar**
   - App name "Battery Guardian" in small caps
   - Settings icon (top-right) for notification preferences

2. **Battery Ring Gauge** (center, large)
   - Circular arc progress ring (270° sweep)
   - Ring color: green → amber (≤40%) → red (≤20%)
   - Large percentage number in center (e.g., "73%")
   - Sub-label: "Discharging" in cool gray

3. **Time Remaining Card**
   - Bold headline: e.g., "~2 h 34 min remaining"
   - Sub-text: drain rate, e.g., "Draining at 0.8% / min"
   - Confidence note: "Based on last 5 minutes of usage"

4. **Warning Banner** (appears when ≤20 min remaining)
   - Full-width colored banner with icon + message
   - Color escalates: amber (20/15/10 min) → red (7/5/2 min)
   - Message examples:
     - "⚠️ 20 minutes of battery remaining — consider charging soon"
     - "🔴 2 minutes left — plug in immediately!"

5. **Drain History Sparkline**
   - Small inline chart showing battery % over the last 30 minutes
   - Thin line chart, green → red gradient

6. **Stats Row**
   - Current level | Drain rate | Est. empty time (3 tiles)

---

### Charging Mode Layout (top → bottom)

1. **App Header Bar** (same)

2. **Battery Ring Gauge** (center, large)
   - Ring color: Sky Blue (#00C6FF) with animated pulse
   - Large percentage in center
   - Sub-label: "Charging ⚡" in sky blue

3. **Charge Rate Card**
   - Headline: e.g., "Charging at +1.2% / min"
   - Sub-text: "Full charge in ~45 minutes"

4. **Milestone Timeline**
   - Vertical list of 5 milestone rows:
     - 🔵 10% — Already reached / "in X min"
     - 🔵 25% — "in X min"
     - 🔵 50% — "in X min"
     - 🔵 75% — "in X min"
     - 🔵 100% — "in X min"
   - Completed milestones show a green checkmark
   - Current milestone pulses

5. **Stats Row**
   - Current level | Charge rate | Est. full time (3 tiles)

---

## Key User Flows

### Flow A — Discharge Warning
1. User opens app → sees ring gauge + time remaining
2. Battery drains → time estimate updates every 30 seconds
3. At 20 min: amber banner appears + local notification fires
4. At 15, 10, 7, 5 min: banner updates + new notifications fire
5. At 2 min: red banner + urgent notification fires
6. User plugs in → app transitions to Charging Mode

### Flow B — Charging Milestone Tracking
1. User plugs in → ring turns blue, charging mode activates
2. App measures charge rate over first 60 seconds
3. Milestone ETAs populate and update in real time
4. As each milestone is passed, it gets a green checkmark
5. At 100% (FULL state): "Fully charged! 🎉" banner appears

---

## Typography

| Element | Font | Size | Weight |
|---|---|---|---|
| Battery % (ring center) | System (SF Pro) | 56pt | Bold |
| Time remaining headline | System | 24pt | Semibold |
| Card labels | System | 14pt | Regular |
| Stats tiles | System | 18pt | Semibold |
| Warning banner | System | 15pt | Semibold |

---

## Interaction Notes

- The ring gauge animates smoothly on level change (spring animation)
- Warning banners slide in from the top with a bounce
- Milestone rows animate in sequentially on charging mode entry
- The app uses a 30-second polling interval for drain/charge rate calculation
- All times shown as "X h Y min" when > 60 min, "X min" when < 60 min
