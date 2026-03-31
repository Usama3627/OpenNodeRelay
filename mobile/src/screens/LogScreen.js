import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
  Dimensions,
} from 'react-native';
import {useDaemon} from '../context/DaemonContext';
import {StateBadge} from '../components/StateBadge';
import {COLORS, FONT_MONO, FONT_SIZE, SPACING} from '../utils/theme';

const MAX_RENDERED_LINES = 5000;

export function LogScreen({route, navigation}) {
  const {processId, command, state: initialState} = route.params;
  const {state, sendCommand} = useDaemon();

  const scrollRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [scrollViewHeight, setScrollViewHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);

  const process = state.processes.find(p => p.id === processId) || {
    id: processId,
    command,
    state: initialState,
    exit_code: null,
    started_at: null,
  };

  const logLines = state.logs[processId] || [];
  const isActive = process.state === 'running';

  // Auto-scroll to bottom when new logs arrive and user hasn't scrolled up
  useEffect(() => {
    if (autoScroll && scrollRef.current && logLines.length > 0) {
      // Defer to allow layout to complete
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({animated: false});
      }, 30);
    }
  }, [logLines.length, autoScroll]);

  function handleScrollEnd({nativeEvent}) {
    const {contentOffset, contentSize, layoutMeasurement} = nativeEvent;
    const isAtBottom =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 20;
    setAutoScroll(isAtBottom);
  }

  function scrollToBottom() {
    scrollRef.current?.scrollToEnd({animated: true});
    setAutoScroll(true);
  }

  async function handleStop() {
    try {
      await sendCommand('stop', {process_id: processId});
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  async function handleKill() {
    Alert.alert('Kill Process', `Kill "${command}"?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Kill',
        style: 'destructive',
        onPress: async () => {
          try {
            await sendCommand('kill', {process_id: processId});
          } catch (err) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  }

  const renderLine = useCallback((entry, index) => {
    const isStderr = entry.stream === 'stderr';
    return (
      <Text
        key={index}
        style={[
          styles.logLine,
          isStderr ? styles.stderrLine : styles.stdoutLine,
        ]}
        selectable>
        <Text style={styles.streamIndicator}>
          {isStderr ? '[err] ' : '[out] '}
        </Text>
        {entry.line}
      </Text>
    );
  }, []);

  // Only render the last MAX_RENDERED_LINES to keep the ScrollView performant
  const visibleLines = useMemo(() => {
    if (logLines.length <= MAX_RENDERED_LINES) {
      return logLines;
    }
    return logLines.slice(logLines.length - MAX_RENDERED_LINES);
  }, [logLines]);

  const truncated = logLines.length > MAX_RENDERED_LINES;

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>{'<'} back</Text>
        </TouchableOpacity>

        <View style={styles.topCenter}>
          <Text style={styles.topCommand} numberOfLines={1}>
            {command}
          </Text>
          <StateBadge state={process.state} style={styles.topBadge} />
        </View>

        <View style={styles.topActions}>
          {isActive && (
            <TouchableOpacity style={styles.stopBtn} onPress={handleStop}>
              <Text style={styles.stopBtnText}>stop</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.killBtn} onPress={handleKill}>
            <Text style={styles.killBtnText}>kill</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Log output */}
      <ScrollView
        ref={scrollRef}
        style={styles.logContainer}
        contentContainerStyle={styles.logContent}
        onScrollEndDrag={handleScrollEnd}
        onMomentumScrollEnd={handleScrollEnd}
        showsVerticalScrollIndicator={true}
        indicatorStyle="white">
        {truncated && (
          <Text style={styles.truncatedNote}>
            ... (showing last {MAX_RENDERED_LINES.toLocaleString()} lines)
          </Text>
        )}
        {logLines.length === 0 ? (
          <Text style={styles.noLogsText}>
            {isActive ? 'Waiting for output...' : 'No output captured.'}
          </Text>
        ) : (
          visibleLines.map((entry, i) => renderLine(entry, i))
        )}
      </ScrollView>

      {/* Scroll-to-bottom FAB */}
      {!autoScroll && (
        <TouchableOpacity
          style={styles.scrollFab}
          onPress={scrollToBottom}
          activeOpacity={0.8}>
          <Text style={styles.scrollFabText}>v</Text>
        </TouchableOpacity>
      )}

      {/* Status footer */}
      <View style={styles.footer}>
        <Text style={styles.footerText}>
          {logLines.length} line{logLines.length !== 1 ? 's' : ''}
          {process.state !== 'running' && process.exit_code !== null
            ? `  |  exit: ${process.exit_code}`
            : ''}
          {process.started_at
            ? `  |  started: ${formatStarted(process.started_at)}`
            : ''}
        </Text>
      </View>
    </View>
  );
}

function formatStarted(startedAt) {
  if (!startedAt) {
    return '';
  }
  const ts =
    typeof startedAt === 'string' ? parseInt(startedAt, 10) * 1000 : startedAt;
  const d = new Date(ts);
  return d.toLocaleTimeString();
}

const {width} = Dimensions.get('window');

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgBorder,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    paddingTop: Platform.OS === 'ios' ? 44 : SPACING.sm,
    gap: SPACING.sm,
  },
  backBtn: {
    paddingVertical: SPACING.xs,
    paddingRight: SPACING.sm,
  },
  backText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.green,
    letterSpacing: 0.5,
  },
  topCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    overflow: 'hidden',
  },
  topCommand: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textPrimary,
    flex: 1,
    letterSpacing: 0.3,
  },
  topBadge: {
    flexShrink: 0,
  },
  topActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  stopBtn: {
    backgroundColor: COLORS.yellow,
    borderRadius: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  stopBtnText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xs,
    color: COLORS.bg,
    fontWeight: 'bold',
  },
  killBtn: {
    backgroundColor: COLORS.red,
    borderRadius: 4,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
  },
  killBtnText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xs,
    color: COLORS.white,
    fontWeight: 'bold',
  },

  // Log area
  logContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  logContent: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  logLine: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    lineHeight: FONT_SIZE.sm * 1.7,
    letterSpacing: 0.2,
  },
  stdoutLine: {
    color: COLORS.green,
  },
  stderrLine: {
    color: COLORS.red,
  },
  streamIndicator: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZE.xs,
  },
  noLogsText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    marginTop: SPACING.xl,
    textAlign: 'center',
  },
  truncatedNote: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },

  // Scroll FAB
  scrollFab: {
    position: 'absolute',
    bottom: 50,
    right: SPACING.lg,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.green,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollFabText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.md,
    color: COLORS.green,
    fontWeight: 'bold',
  },

  // Footer
  footer: {
    backgroundColor: COLORS.bgCard,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgBorder,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  footerText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    letterSpacing: 0.3,
  },
});
