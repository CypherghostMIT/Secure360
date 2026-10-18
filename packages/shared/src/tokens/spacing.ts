// L3 §2.2: 4 px base. Values are px numbers so React Native can use them directly; the web appends "px".
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const layout = {
  screenPaddingMobile: 16,
  screenPaddingWeb: 24,
  radiusCard: 8,
  radiusButtonWeb: 6,
  // Android accessibility minimum (L3 §2.2); applies to both dimensions.
  minTouchTarget: 48,
} as const;
