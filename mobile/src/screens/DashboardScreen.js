import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  RefreshControl,
  Alert,
  Animated,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import {useDaemon} from '../context/DaemonContext';
import {ConnectionBar} from '../components/ConnectionBar';
import {StateBadge} from '../components/StateBadge';
import {COLORS, FONT_MONO, FONT_SIZE, SPACING} from '../utils/theme';

export function DashboardScreen({navigation}) {
  const {state, sendCommand, disconnect} = useDaemon();
  const [commandText, setCommandText] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [runningCommand, setRunningCommand] = useState(false);
  const inputRef = useRef(null);

  // Fetch process list on mount
  useEffect(() => {
    if (state.connectionStatus === 'connected') {
      fetchProcessList();
    } else if (state.connectionStatus === 'disconnected') {
      navigation.replace('Pair');
    }
  }, []);

  // Handle disconnect while on dashboard
  useEffect(() => {
    if (
      state.connectionStatus === 'disconnected' ||
      state.connectionStatus === 'error'
    ) {
      navigation.replace('Pair');
    }
  }, [state.connectionStatus]);

  async function fetchProcessList() {
    try {
      await sendCommand('list');
    } catch (err) {
      console.warn('[Dashboard] list failed:', err.message);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await fetchProcessList();
    setRefreshing(false);
  }

  async function handleRunCommand() {
    const cmd = commandText.trim();
    if (!cmd) {
      return;
    }
    setRunningCommand(true);
    try {
      await sendCommand('start', {command: cmd});
      setCommandText('');
      // Fetch updated list after short delay
      setTimeout(fetchProcessList, 500);
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setRunningCommand(false);
    }
  }

  function handleDisconnect() {
    Alert.alert('Disconnect', 'Disconnect from the daemon?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Disconnect',
        style: 'destructive',
        onPress: () => {
          disconnect('Disconnected by user.');
        },
      },
    ]);
  }

  function openLogs(process) {
    navigation.navigate('Logs', {
      processId: process.id,
      command: process.command,
      state: process.state,
    });
  }

  async function handleStop(process) {
    try {
      await sendCommand('stop', {process_id: process.id});
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  async function handleKill(process) {
    Alert.alert('Kill Process', `Kill "${process.command}"?`, [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Kill',
        style: 'destructive',
        onPress: async () => {
          try {
            await sendCommand('kill', {process_id: process.id});
          } catch (err) {
            Alert.alert('Error', err.message);
          }
        },
      },
    ]);
  }

  const renderProcess = useCallback(
    ({item}) => (
      <ProcessRow
        process={item}
        onPress={() => openLogs(item)}
        onStop={() => handleStop(item)}
        onKill={() => handleKill(item)}
      />
    ),
    [],
  );

  const processes = state.processes;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>
      <ConnectionBar onDisconnect={handleDisconnect} />

      {/* Process list */}
      <FlatList
        style={styles.list}
        data={processes}
        keyExtractor={item => item.id}
        renderItem={renderProcess}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No processes running.</Text>
            <Text style={styles.emptyHint}>
              Type a command below and press Run.
            </Text>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.green}
            colors={[COLORS.green]}
          />
        }
        contentContainerStyle={
          processes.length === 0 ? styles.emptyList : styles.listContent
        }
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

      {/* Command input */}
      <View style={styles.inputBar}>
        <Text style={styles.prompt}>{'>'}</Text>
        <TextInput
          ref={inputRef}
          style={styles.commandInput}
          value={commandText}
          onChangeText={setCommandText}
          placeholder="command..."
          placeholderTextColor={COLORS.textMuted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="send"
          onSubmitEditing={handleRunCommand}
          blurOnSubmit={false}
          editable={!runningCommand}
          selectionColor={COLORS.green}
        />
        <TouchableOpacity
          style={[
            styles.runBtn,
            (!commandText.trim() || runningCommand) && styles.runBtnDisabled,
          ]}
          onPress={handleRunCommand}
          disabled={!commandText.trim() || runningCommand}>
          <Text style={styles.runBtnText}>Run</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── ProcessRow ───────────────────────────────────────────────────────────────

function ProcessRow({process, onPress, onStop, onKill}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const [actionsVisible, setActionsVisible] = useState(false);

  // Swipe logic using PanResponder would add complexity; instead use a
  // long-press to reveal actions for simplicity and broad device support.
  function toggleActions() {
    if (actionsVisible) {
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
      setActionsVisible(false);
    } else {
      Animated.spring(translateX, {
        toValue: -120,
        useNativeDriver: true,
      }).start();
      setActionsVisible(true);
    }
  }

  function handleStop() {
    Animated.spring(translateX, {toValue: 0, useNativeDriver: true}).start();
    setActionsVisible(false);
    onStop();
  }

  function handleKill() {
    Animated.spring(translateX, {toValue: 0, useNativeDriver: true}).start();
    setActionsVisible(false);
    onKill();
  }

  const isActive = process.state === 'running';

  return (
    <View style={styles.rowWrapper}>
      {/* Swipe-reveal action buttons */}
      <View style={styles.rowActions}>
        {isActive && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.stopBtn]}
            onPress={handleStop}>
            <Text style={styles.actionBtnText}>stop</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.actionBtn, styles.killBtn]}
          onPress={handleKill}>
          <Text style={styles.actionBtnText}>kill</Text>
        </TouchableOpacity>
      </View>

      <Animated.View
        style={[styles.rowContent, {transform: [{translateX}]}]}>
        <TouchableOpacity
          style={styles.rowTouchable}
          onPress={onPress}
          onLongPress={toggleActions}
          activeOpacity={0.7}>
          <View style={styles.rowMain}>
            <Text style={styles.commandText} numberOfLines={1}>
              {process.command}
            </Text>
            <View style={styles.rowMeta}>
              <StateBadge state={process.state} />
              <Text style={styles.timeText}>
                {formatStarted(process.started_at)}
              </Text>
            </View>
          </View>
          <Text style={styles.chevron}>{'>'}</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function formatStarted(startedAt) {
  if (!startedAt) {
    return '';
  }
  const ts = typeof startedAt === 'string' ? parseInt(startedAt, 10) * 1000 : startedAt;
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  return `${hours}h ago`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: SPACING.sm,
  },
  emptyList: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: SPACING.xxl * 2,
  },
  emptyText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  emptyHint: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.bgBorder,
  },

  // Row
  rowWrapper: {
    overflow: 'hidden',
    backgroundColor: COLORS.bgCard,
  },
  rowActions: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionBtn: {
    height: '100%',
    width: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stopBtn: {
    backgroundColor: COLORS.yellow,
  },
  killBtn: {
    backgroundColor: COLORS.red,
  },
  actionBtnText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.bg,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  rowContent: {
    backgroundColor: COLORS.bgCard,
  },
  rowTouchable: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  rowMain: {
    flex: 1,
    gap: SPACING.xs,
  },
  commandText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.md,
    color: COLORS.textPrimary,
    letterSpacing: 0.3,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  timeText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
  },
  chevron: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    marginLeft: SPACING.sm,
  },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgCard,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgBorder,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  prompt: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.lg,
    color: COLORS.green,
    marginRight: 2,
  },
  commandInput: {
    flex: 1,
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.md,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.bgInput,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.bgBorder,
    letterSpacing: 0.3,
  },
  runBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 4,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  runBtnDisabled: {
    backgroundColor: COLORS.greenMuted,
    borderWidth: 1,
    borderColor: COLORS.bgBorder,
  },
  runBtnText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.bg,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
});
