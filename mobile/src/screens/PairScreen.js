import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import {useDaemon} from '../context/DaemonContext';
import {connectToDaemon} from '../services/connection';
import {
  getPairedDaemons,
  savePairedDaemon,
  getSignalingUrl,
} from '../utils/storage';
import {COLORS, FONT_MONO, FONT_SIZE, SPACING} from '../utils/theme';

export function PairScreen({navigation}) {
  const {state, dispatch, setConnected} = useDaemon();

  const [code, setCode] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [recentDaemons, setRecentDaemons] = useState([]);
  const inputRef = useRef(null);
  const cancelRef = useRef(false);

  // Load recent daemons on mount
  useEffect(() => {
    loadRecentDaemons();
    // If already connected, go straight to dashboard
    if (state.connectionStatus === 'connected') {
      navigation.replace('Terminal');
    } else {
      // Focus input smoothly after screen transition
      setTimeout(() => {
        if (!cancelRef.current && inputRef.current) {
          inputRef.current.focus();
        }
      }, 400);
    }
  }, [state.connectionStatus, navigation]);

  async function loadRecentDaemons() {
    const daemons = await getPairedDaemons();
    setRecentDaemons(daemons);
  }

  const handleConnect = useCallback(
    async (pairingCode) => {
      const trimmed = (pairingCode || code).trim().toUpperCase();
      if (trimmed.length !== 6) {
        Alert.alert('Invalid Code', 'Please enter a 6-character pairing code.');
        return;
      }

      cancelRef.current = false;
      setConnecting(true);
      setStatusText('');

      dispatch({
        type: 'SET_CONNECTION_STATUS',
        status: 'connecting',
        text: 'Connecting...',
      });

      try {
        const signalingUrl = await getSignalingUrl();
        const {pc, dc} = await connectToDaemon(
          trimmed,
          signalingUrl,
          text => {
            if (!cancelRef.current) {
              setStatusText(text);
            }
          },
        );

        if (cancelRef.current) {
          pc.close();
          return;
        }

        await savePairedDaemon({pairingCode: trimmed});
        setConnected(pc, dc, trimmed);
        // Navigation happens via effect watching connectionStatus
      } catch (err) {
        if (!cancelRef.current) {
          setConnecting(false);
          setStatusText('');
          dispatch({
            type: 'SET_CONNECTION_STATUS',
            status: 'error',
            text: err.message,
          });
        }
      }
    },
    [code, dispatch, setConnected],
  );

  function handleCancel() {
    cancelRef.current = true;
    setConnecting(false);
    setStatusText('');
    dispatch({
      type: 'SET_CONNECTION_STATUS',
      status: 'disconnected',
      text: '',
    });
  }

  function handleCodeChange(text) {
    // Allow only alphanumeric, max 6 chars, uppercase
    const filtered = text.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
    setCode(filtered);
  }

  const isError = state.connectionStatus === 'error';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>OpenNodeRelay</Text>
        <Text style={styles.subtitle}>Bring Your Own Compute</Text>
      </View>

      {/* Pairing form */}
      <View style={styles.form}>
        <Text style={styles.label}>{'>'} Enter pairing code</Text>

        <TextInput
          ref={inputRef}
          style={styles.codeInput}
          value={code}
          onChangeText={handleCodeChange}
          placeholder="______"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
          editable={!connecting}
          returnKeyType="go"
          onSubmitEditing={() => handleConnect()}
          selectionColor={COLORS.green}
        />

        {isError && (
          <Text style={styles.errorText}>{state.connectionStatusText}</Text>
        )}

        {connecting ? (
          <View style={styles.connectingRow}>
            <ActivityIndicator color={COLORS.green} size="small" />
            <Text style={styles.statusText}>{statusText || 'Connecting...'}</Text>
            <TouchableOpacity onPress={handleCancel} style={styles.cancelBtn}>
              <Text style={styles.cancelText}>cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.connectBtn,
              code.length !== 6 && styles.connectBtnDisabled,
            ]}
            onPress={() => handleConnect()}
            disabled={code.length !== 6}>
            <Text style={styles.connectBtnText}>Connect</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Recent connections */}
      {recentDaemons.length > 0 && (
        <View style={styles.recent}>
          <Text style={styles.recentTitle}>Recent Connections</Text>
          <FlatList
            data={recentDaemons}
            keyExtractor={item => item.pairingCode}
            renderItem={({item}) => (
              <TouchableOpacity
                style={styles.recentItem}
                onPress={() => {
                  setCode(item.pairingCode);
                  handleConnect(item.pairingCode);
                }}
                disabled={connecting}>
                <View style={styles.recentLeft}>
                  <Text style={styles.recentCode}>{item.pairingCode}</Text>
                  <Text style={styles.recentName}>{item.name}</Text>
                </View>
                <Text style={styles.recentTime}>
                  {formatRelativeTime(item.lastConnected)}
                </Text>
              </TouchableOpacity>
            )}
            ItemSeparatorComponent={() => (
              <View style={styles.separator} />
            )}
          />
        </View>
      )}

      {/* Settings link */}
      <TouchableOpacity
        style={styles.settingsBtn}
        onPress={() => navigation.navigate('Settings')}>
        <Text style={styles.settingsBtnText}>settings</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingHorizontal: SPACING.xl,
    paddingTop: 60,
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xxl * 1.5,
  },
  title: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.hero,
    color: COLORS.green,
    letterSpacing: 8,
    fontWeight: 'bold',
  },
  subtitle: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    letterSpacing: 2,
    marginTop: SPACING.sm,
  },
  form: {
    marginBottom: SPACING.xxl,
  },
  label: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.green,
    marginBottom: SPACING.md,
    letterSpacing: 0.5,
  },
  codeInput: {
    fontFamily: FONT_MONO,
    fontSize: 40,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.bgBorder,
    borderRadius: 6,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.lg,
    textAlign: 'center',
    letterSpacing: 16,
    marginBottom: SPACING.lg,
  },
  errorText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.red,
    marginBottom: SPACING.md,
    letterSpacing: 0.3,
  },
  connectBtn: {
    backgroundColor: COLORS.green,
    borderRadius: 6,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  connectBtnDisabled: {
    backgroundColor: COLORS.greenMuted,
    borderWidth: 1,
    borderColor: COLORS.bgBorder,
  },
  connectBtnText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.lg,
    color: COLORS.bg,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  connectingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingVertical: SPACING.md,
  },
  statusText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    flex: 1,
    letterSpacing: 0.3,
  },
  cancelBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  cancelText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.red,
  },
  recent: {
    flex: 1,
  },
  recentTitle: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    letterSpacing: 1,
    marginBottom: SPACING.md,
    textTransform: 'uppercase',
  },
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
  },
  recentLeft: {
    flex: 1,
  },
  recentCode: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.lg,
    color: COLORS.green,
    letterSpacing: 4,
  },
  recentName: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    marginTop: 2,
    letterSpacing: 0.5,
  },
  recentTime: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.bgBorder,
  },
  settingsBtn: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
  settingsBtnText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    letterSpacing: 1,
  },
});
