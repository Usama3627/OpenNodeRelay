import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {COLORS, FONT_MONO, FONT_SIZE, SPACING} from '../utils/theme';

const CONFIG = {
  running: {color: COLORS.green, label: 'running'},
  completed: {color: COLORS.textSecondary, label: 'done'},
  failed: {color: COLORS.red, label: 'failed'},
  unknown: {color: COLORS.gray, label: '?'},
};

export function StateBadge({state, style}) {
  const cfg = CONFIG[state] || CONFIG.unknown;
  return (
    <View style={[styles.badge, {borderColor: cfg.color}, style]}>
      <View style={[styles.dot, {backgroundColor: cfg.color}]} />
      <Text style={[styles.label, {color: cfg.color}]}>{cfg.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    gap: SPACING.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xs,
    letterSpacing: 0.5,
  },
});
