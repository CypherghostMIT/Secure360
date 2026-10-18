// L3 §2.1 palette with the WCAG AA corrections of L3 §7.1 (Table 8).
// Fills (badge backgrounds, chart series, icons) and text colours are separate on purpose:
// amber #B26A00 and orange #D35400 fail 4.5:1 as text, so text uses #8F5600 and #B34700.

export const colors = {
  primary: '#003366',
  primaryLight: '#E6F0FA',
  surface: '#F8F9FC',
  card: '#FFFFFF',
  border: '#E0E0E0',
  text: '#1E1E1E',
  textSecondary: '#666666',
  danger: '#CC0000',
  success: '#006633',
  offlineBanner: {
    background: '#FFF4E0',
    text: '#8F5600',
  },
} as const;

export const severityColors = {
  fill: {
    LOW: '#006633',
    MEDIUM: '#B26A00',
    HIGH: '#D35400',
    CRITICAL: '#CC0000',
  },
  text: {
    LOW: '#006633',
    MEDIUM: '#8F5600',
    HIGH: '#B34700',
    CRITICAL: '#CC0000',
  },
} as const;

// Badges are a tinted background with dark text; only CRITICAL is a solid fill with white text, so it stands out.
// White text on the amber and orange fills fails AA (4.2:1), which is why the other badges are not solid.
export const badgeColors = {
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
} as const;

export const statusColors = {
  fill: {
    NEW: '#003366',
    ASSIGNED: '#5B4B9A',
    IN_PROGRESS: '#B26A00',
    RESOLVED: '#006633',
    CLOSED: '#666666',
  },
  text: {
    NEW: '#003366',
    ASSIGNED: '#5B4B9A',
    IN_PROGRESS: '#8F5600',
    RESOLVED: '#006633',
    CLOSED: '#666666',
  },
} as const;
