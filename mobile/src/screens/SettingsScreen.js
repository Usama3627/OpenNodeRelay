import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import {
  getSignalingUrl,
  setSignalingUrl,
  DEFAULT_SIGNALING_URL,
  getPairedDaemons,
  forgetPairedDaemon,
} from '../utils/storage';
import {COLORS, FONT_MONO, FONT_SIZE, SPACING} from '../utils/theme';

const APP_VERSION = '1.0.0';

export function SettingsScreen({navigation}) {
  const [signalingUrl, setSignalingUrlState] = useState(DEFAULT_SIGNALING_URL);
  const [urlDirty, setUrlDirty] = useState(false);
  const [daemons, setDaemons] = useState([]);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    const [url, storedDaemons] = await Promise.all([
      getSignalingUrl(),
      getPairedDaemons(),
    ]);
    setSignalingUrlState(url);
    setDaemons(storedDaemons);
  }

  async function handleSaveUrl() {
    const trimmed = signalingUrl.trim();
    if (!trimmed.startsWith('http')) {
      Alert.alert('Invalid URL', 'Signaling URL must start with http or https.');
      return;
    }
    await setSignalingUrl(trimmed);
    setUrlDirty(false);
    Alert.alert('Saved', 'Signaling URL updated.');
  }

  async function handleResetUrl() {
    setSignalingUrlState(DEFAULT_SIGNALING_URL);
    await setSignalingUrl(DEFAULT_SIGNALING_URL);
    setUrlDirty(false);
  }

  async function handleForget(pairingCode) {
    Alert.alert(
      'Forget Daemon',
      `Remove ${pairingCode} from recent connections?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Forget',
          style: 'destructive',
          onPress: async () => {
            await forgetPairedDaemon(pairingCode);
            setDaemons(prev => prev.filter(d => d.pairingCode !== pairingCode));
          },
        },
      ],
    );
  }

  const renderDaemon = useCallback(
    ({item}) => (
      <View style={styles.daemonRow}>
        <View style={styles.daemonLeft}>
          <Text style={styles.daemonCode}>{item.pairingCode}</Text>
          <Text style={styles.daemonName}>{item.name}</Text>
          <Text style={styles.daemonTime}>
            Last connected: {new Date(item.lastConnected).toLocaleDateString()}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.forgetBtn}
          onPress={() => handleForget(item.pairingCode)}>
          <Text style={styles.forgetBtnText}>forget</Text>
        </TouchableOpacity>
      </View>
    ),
    [],
  );

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">

      {/* Back */}
      <TouchableOpacity
        style={styles.backBtn}
        onPress={() => navigation.goBack()}>
        <Text style={styles.backText}>{'<'} back</Text>
      </TouchableOpacity>

      <Text style={styles.screenTitle}>Settings</Text>

      {/* Signaling URL */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Signaling Server</Text>
        <Text style={styles.sectionDesc}>
          The server used for initial WebRTC handshake only. Your data never
          passes through it.
        </Text>
        <TextInput
          style={styles.urlInput}
          value={signalingUrl}
          onChangeText={text => {
            setSignalingUrlState(text);
            setUrlDirty(true);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          selectionColor={COLORS.green}
          placeholderTextColor={COLORS.textMuted}
        />
        <View style={styles.urlActions}>
          <TouchableOpacity
            style={[styles.btn, !urlDirty && styles.btnDisabled]}
            onPress={handleSaveUrl}
            disabled={!urlDirty}>
            <Text style={styles.btnText}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={handleResetUrl}>
            <Text style={styles.btnSecondaryText}>Reset to default</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Paired daemons */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Paired Daemons</Text>
        {daemons.length === 0 ? (
          <Text style={styles.emptyText}>No saved daemons.</Text>
        ) : (
          <FlatList
            data={daemons}
            keyExtractor={item => item.pairingCode}
            renderItem={renderDaemon}
            scrollEnabled={false}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Version</Text>
          <Text style={styles.aboutValue}>{APP_VERSION}</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Protocol</Text>
          <Text style={styles.aboutValue}>WebRTC DataChannel (DTLS)</Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Signaling</Text>
          <Text style={styles.aboutValue} numberOfLines={1}>
            Cloudflare Workers KV
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    padding: SPACING.xl,
    paddingTop: Platform.OS === 'ios' ? 60 : SPACING.xl,
    paddingBottom: SPACING.xxl * 2,
  },
  backBtn: {
    marginBottom: SPACING.lg,
  },
  backText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.green,
    letterSpacing: 0.5,
  },
  screenTitle: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xxl,
    color: COLORS.textPrimary,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: SPACING.xxl,
  },

  section: {
    marginBottom: SPACING.xxl,
  },
  sectionTitle: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: SPACING.md,
  },
  sectionDesc: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
    lineHeight: FONT_SIZE.xs * 1.6,
    marginBottom: SPACING.md,
  },

  urlInput: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.bgBorder,
    borderRadius: 4,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    letterSpacing: 0.3,
    marginBottom: SPACING.sm,
  },
  urlActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  btn: {
    backgroundColor: COLORS.green,
    borderRadius: 4,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  btnDisabled: {
    backgroundColor: COLORS.greenMuted,
    borderWidth: 1,
    borderColor: COLORS.bgBorder,
  },
  btnText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.bg,
    fontWeight: 'bold',
  },
  btnSecondary: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  btnSecondaryText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },

  daemonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.bgCard,
    paddingHorizontal: SPACING.md,
    borderRadius: 4,
    gap: SPACING.md,
  },
  daemonLeft: {
    flex: 1,
    gap: 2,
  },
  daemonCode: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.lg,
    color: COLORS.green,
    letterSpacing: 4,
  },
  daemonName: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
  daemonTime: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xs,
    color: COLORS.textMuted,
  },
  forgetBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.red,
    borderRadius: 4,
  },
  forgetBtnText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.xs,
    color: COLORS.red,
    letterSpacing: 0.5,
  },
  separator: {
    height: SPACING.sm,
  },
  emptyText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
  },

  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgBorder,
  },
  aboutLabel: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
  aboutValue: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textPrimary,
    flex: 1,
    textAlign: 'right',
    marginLeft: SPACING.md,
  },
});
