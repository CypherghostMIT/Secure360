// L3 §2.2 Table 3 (size / line height in px).
// Mobile uses the platform font (Roboto on Android): bundling none keeps the APK small (BNF20).
// The web uses Inter. Monospace is for identifiers users copy: references (SFC-2026-001234) and audit actions.

export const fontFamilies = {
  mobile: 'System',
  web: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

export const typography = {
  mobile: {
    headlineLarge: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
    headlineMedium: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
    body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
    small: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  },
  web: {
    headlineLarge: { fontSize: 24, lineHeight: 32, fontWeight: '600' },
    headlineMedium: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
    body: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
    small: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
  },
} as const;
