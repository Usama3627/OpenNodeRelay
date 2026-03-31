import React from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {useDaemon} from '../context/DaemonContext';
import {COLORS, FONT_MONO, FONT_SIZE, SPACING} from '../utils/theme';

export function ConnectionBar({onDisconnect}) {
  const {state} = useDaemon();
  const isConnected = state.connectionStatus === 'connected';

  return (
    <View style={styles.bar}>
      <View style={styles.left}>
        <View
          style={[
            styles.dot,
            {backgroundColor: isConnected ? COLORS.green : COLORS.red},
          ]}
        />
        <Text style={styles.text}>
          {isConnected
            ? `Connected${state.pairingCode ? '  ' + state.pairingCode : ''}`
            : state.connectionStatusText || 'Disconnected'}
        </Text>
      </View>
      {isConnected && onDisconnect && (
        <TouchableOpacity onPress={onDisconnect} style={styles.disconnectBtn}>
          <Text style={styles.disconnectText}>disconnect</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: COLORS.bgCard,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgBorder,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    letterSpacing: 0.5,
  },
  disconnectBtn: {
    paddingVertical: 2,
    paddingHorizontal: SPACING.sm,
  },
  disconnectText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xs,
    color: COLORS.red,
    letterSpacing: 0.5,
  },
});
