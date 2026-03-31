import {Platform} from 'react-native';

export const FONT_MONO = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
});

export const COLORS = {
  // Backgrounds
  bg: '#0D1117',
  bgCard: '#161B22',
  bgInput: '#0D1117',
  bgBorder: '#30363D',

  // Terminal green
  green: '#00FF00',
  greenDim: '#00CC00',
  greenMuted: '#1A3A1A',

  // Text
  textPrimary: '#E6EDF3',
  textSecondary: '#8B949E',
  textMuted: '#484F58',

  // Status
  red: '#FF6B6B',
  redDim: '#CC4444',
  yellow: '#F0C040',
  gray: '#484F58',

  // Misc
  white: '#FFFFFF',
  transparent: 'transparent',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const FONT_SIZE = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
  xxl: 28,
  hero: 48,
};
