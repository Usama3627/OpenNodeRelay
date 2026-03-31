import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  PAIRED_DAEMONS: 'paired_daemons',
  SETTINGS_SIGNALING_URL: 'settings.signaling_url',
  SETTINGS_THEME: 'settings.theme',
};

export const DEFAULT_SIGNALING_URL =
  'https://opennoderelay-signal.opennoderelay.workers.dev';

// ─── Paired Daemons ─────────────────────────────────────────────────────────

/**
 * @returns {Promise<Array<{id: string, name: string, pairingCode: string, lastConnected: number}>>}
 */
export async function getPairedDaemons() {
  try {
    const raw = await AsyncStorage.getItem(KEYS.PAIRED_DAEMONS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Upsert a daemon entry. If an entry with the same pairingCode exists it is
 * updated; otherwise a new one is created.
 *
 * @param {{pairingCode: string, name?: string}} daemon
 */
export async function savePairedDaemon(daemon) {
  const daemons = await getPairedDaemons();
  const idx = daemons.findIndex(d => d.pairingCode === daemon.pairingCode);
  const entry = {
    id: daemon.id || daemon.pairingCode,
    name: daemon.name || `Daemon ${daemon.pairingCode}`,
    pairingCode: daemon.pairingCode,
    lastConnected: Date.now(),
  };
  if (idx >= 0) {
    daemons[idx] = entry;
  } else {
    daemons.unshift(entry);
  }
  await AsyncStorage.setItem(KEYS.PAIRED_DAEMONS, JSON.stringify(daemons));
}

/**
 * Remove a daemon by pairingCode.
 * @param {string} pairingCode
 */
export async function forgetPairedDaemon(pairingCode) {
  const daemons = await getPairedDaemons();
  const filtered = daemons.filter(d => d.pairingCode !== pairingCode);
  await AsyncStorage.setItem(KEYS.PAIRED_DAEMONS, JSON.stringify(filtered));
}

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getSignalingUrl() {
  try {
    const val = await AsyncStorage.getItem(KEYS.SETTINGS_SIGNALING_URL);
    return val || DEFAULT_SIGNALING_URL;
  } catch {
    return DEFAULT_SIGNALING_URL;
  }
}

export async function setSignalingUrl(url) {
  await AsyncStorage.setItem(KEYS.SETTINGS_SIGNALING_URL, url);
}

export async function getTheme() {
  try {
    const val = await AsyncStorage.getItem(KEYS.SETTINGS_THEME);
    return val || 'dark';
  } catch {
    return 'dark';
  }
}

export async function setTheme(theme) {
  await AsyncStorage.setItem(KEYS.SETTINGS_THEME, theme);
}
