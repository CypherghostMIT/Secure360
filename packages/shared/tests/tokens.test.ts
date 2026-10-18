import { describe, expect, it } from 'vitest';
import {
  badgeColors,
  colors,
  fontFamilies,
  layout,
  severityColors,
  spacing,
  statusColors,
  typography,
} from '../src/index.js';

// WCAG 2.1 relative luminance and contrast ratio.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe('colour tokens (L3 §2.1, §7.1)', () => {
  it('has the base palette values', () => {
    expect(colors).toEqual({
      primary: '#003366',
      primaryLight: '#E6F0FA',
      surface: '#F8F9FC',
      card: '#FFFFFF',
      border: '#E0E0E0',
      text: '#1E1E1E',
      textSecondary: '#666666',
      danger: '#CC0000',
      success: '#006633',
      offlineBanner: { background: '#FFF4E0', text: '#8F5600' },
    });
  });

  it('has the severity fills and the AA text colours', () => {
    expect(severityColors.fill).toEqual({
      LOW: '#006633',
      MEDIUM: '#B26A00',
      HIGH: '#D35400',
      CRITICAL: '#CC0000',
    });
    expect(severityColors.text.MEDIUM).toBe('#8F5600');
    expect(severityColors.text.HIGH).toBe('#B34700');
  });

  it('has the status fills, with #8F5600 as IN_PROGRESS text', () => {
    expect(statusColors.fill).toEqual({
      NEW: '#003366',
      ASSIGNED: '#5B4B9A',
      IN_PROGRESS: '#B26A00',
      RESOLVED: '#006633',
      CLOSED: '#666666',
    });
    expect(statusColors.text.IN_PROGRESS).toBe('#8F5600');
  });

  // Every colour that may be used as text, with the backgrounds it appears on besides white.
  const textPairs: [string, string, string[]][] = [
    ['text', colors.text, [colors.surface, colors.primaryLight]],
    ['textSecondary', colors.textSecondary, [colors.surface]],
    ['primary', colors.primary, [colors.surface, colors.primaryLight]],
    ['danger', colors.danger, [colors.surface]],
    ['success', colors.success, [colors.surface]],
    ['offlineBanner.text', colors.offlineBanner.text, [colors.offlineBanner.background]],
    ...Object.entries(severityColors.text).map(([k, v]): [string, string, string[]] => [
      `severity.text.${k}`,
      v,
      [colors.surface],
    ]),
    ...Object.entries(statusColors.text).map(([k, v]): [string, string, string[]] => [
      `status.text.${k}`,
      v,
      [colors.surface],
    ]),
  ];

  it.each(textPairs)(
    '%s reaches 4.5:1 on white and on its backgrounds',
    (_name, fg, backgrounds) => {
      for (const bg of [colors.card, ...backgrounds]) {
        expect(contrast(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('has the badge background and text values', () => {
    expect(badgeColors).toEqual({
      severity: {
        LOW: { background: '#E6F4EA', text: '#006633' },
        MEDIUM: { background: '#FFF4E0', text: '#8F5600' },
        HIGH: { background: '#FDEDE3', text: '#B34700' },
        CRITICAL: { background: '#CC0000', text: '#FFFFFF' },
      },
      status: {
        NEW: { background: '#E6F0FA', text: '#003366' },
        ASSIGNED: { background: '#EEEBF7', text: '#5B4B9A' },
        IN_PROGRESS: { background: '#FFF4E0', text: '#8F5600' },
        RESOLVED: { background: '#E6F4EA', text: '#006633' },
        CLOSED: { background: '#EDEDED', text: '#555555' },
      },
    });
  });

  const badgePairs = [
    ...Object.entries(badgeColors.severity).map(([k, v]) => [`severity.${k}`, v] as const),
    ...Object.entries(badgeColors.status).map(([k, v]) => [`status.${k}`, v] as const),
  ];

  it.each(badgePairs)('badge %s text reaches 4.5:1 on its background', (_name, badge) => {
    expect(contrast(badge.text, badge.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('documents why amber and orange fills are not text colours (L3 Table 8)', () => {
    expect(contrast(severityColors.fill.MEDIUM, '#FFFFFF')).toBeLessThan(4.5);
    expect(contrast(severityColors.fill.HIGH, '#FFFFFF')).toBeLessThan(4.5);
    expect(contrast(severityColors.fill.MEDIUM, colors.offlineBanner.background)).toBeLessThan(4.5);
  });

  it('matches the contrast ratios published in L3 Table 8', () => {
    expect(contrast('#8F5600', '#FFFFFF')).toBeCloseTo(6.0, 1);
    expect(contrast('#B34700', '#FFFFFF')).toBeCloseTo(5.5, 1);
    expect(contrast('#8F5600', '#FFF4E0')).toBeCloseTo(5.5, 1);
  });
});

describe('spacing and typography tokens (L3 §2.2)', () => {
  it('uses the 4 px scale and layout values', () => {
    expect(Object.values(spacing)).toEqual([4, 8, 16, 24, 32]);
    expect(layout).toEqual({
      screenPaddingMobile: 16,
      screenPaddingWeb: 24,
      radiusCard: 8,
      radiusButtonWeb: 6,
      minTouchTarget: 48,
    });
  });

  it('has the mobile and web type scales', () => {
    const sizes = (
      scale: Record<string, { fontSize: number; lineHeight: number; fontWeight: string }>,
    ) =>
      Object.fromEntries(
        Object.entries(scale).map(([k, v]) => [k, `${v.fontSize}/${v.lineHeight}/${v.fontWeight}`]),
      );
    expect(sizes(typography.mobile)).toEqual({
      headlineLarge: '24/32/700',
      headlineMedium: '20/28/700',
      body: '16/24/400',
      small: '14/20/400',
      caption: '12/16/400',
    });
    expect(sizes(typography.web)).toEqual({
      headlineLarge: '24/32/600',
      headlineMedium: '18/24/600',
      body: '14/20/400',
      small: '13/18/400',
      caption: '12/16/400',
    });
  });

  it('uses the system font on mobile, Inter on the web, and a monospace stack', () => {
    expect(fontFamilies.mobile).toBe('System');
    expect(fontFamilies.web.startsWith('Inter')).toBe(true);
    expect(fontFamilies.mono).toContain('monospace');
  });
});
