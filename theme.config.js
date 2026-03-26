/** @type {const} */
// Conway Electric brand colors
const themeColors = {
  primary:    { light: '#E8450A', dark: '#E8450A' }, // Conway Electric orange
  background: { light: '#FFFFFF', dark: '#0D0D0D' }, // White / near-black
  surface:    { light: '#F5F0E8', dark: '#1A1A1A' }, // Cream / dark card
  foreground: { light: '#0D0D0D', dark: '#FFFFFF' }, // Black / white text
  muted:      { light: '#6B6B6B', dark: '#9A9A9A' }, // Gray
  border:     { light: '#D4CFC7', dark: '#2E2E2E' }, // Subtle border
  success:    { light: '#22C55E', dark: '#4ADE80' }, // Green (healthy battery)
  warning:    { light: '#F59E0B', dark: '#FBBF24' }, // Amber warning
  error:      { light: '#E8450A', dark: '#FF4500' }, // Conway orange-red (critical)
  charging:   { light: '#5B8DB8', dark: '#5B8DB8' }, // Martha Blue (charging)
};
module.exports = { themeColors };
