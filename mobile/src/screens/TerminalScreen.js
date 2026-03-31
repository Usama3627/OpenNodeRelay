import React, {useRef, useEffect, useState, useCallback} from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Keyboard,
} from 'react-native';
import {WebView} from 'react-native-webview';
import {useDaemon} from '../context/DaemonContext';
import {COLORS, FONT_MONO, FONT_SIZE, SPACING} from '../utils/theme';

const XTERM_HTML = `
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
    <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
    <style>
        body, html { 
            margin: 0; padding: 0; height: 100%; width: 100%; 
            background-color: ${COLORS.bg}; overflow: hidden; 
        }
        #terminal-container { 
            padding: 4px; height: 100%; width: 100%; box-sizing: border-box; 
        }
        .xterm-viewport { background-color: ${COLORS.bg} !important; }
        .xterm-screen { width: 100% !important; height: 100% !important; }
    </style>
</head>
<body>
    <div id="terminal-container"></div>
    <script>
        const term = new Terminal({
            theme: { background: '${COLORS.bg}', foreground: '${COLORS.textPrimary}' },
            fontFamily: 'monospace',
            fontSize: 14,
            cursorBlink: true,
            disableStdin: false
        });
        const fitAddon = new FitAddon.FitAddon();
        term.loadAddon(fitAddon);
        term.open(document.getElementById('terminal-container'));
        
        // Wait for next tick to fit
        setTimeout(() => {
            fitAddon.fit();
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'resize',
                cols: term.cols,
                rows: term.rows
            }));
        }, 100);

        window.addEventListener('resize', () => {
            fitAddon.fit();
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'resize',
                cols: term.cols,
                rows: term.rows
            }));
        });

        term.onData(data => {
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'input',
                data: data
            }));
        });

        // Ensure term receives focus when tapped
        document.body.addEventListener('click', () => {
            term.focus();
        });

        document.addEventListener('message', function(event) {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'write') {
                    term.write(msg.data);
                }
            } catch (e) {}
        });
        window.addEventListener('message', function(event) {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'write') {
                    term.write(msg.data);
                }
            } catch (e) {}
        });
    </script>
</body>
</html>
`;

export function TerminalScreen({navigation}) {
  const {state, sendInput, sendResize, disconnect, setOnRawOutput} = useDaemon();
  const webViewRef = useRef(null);
  const [ctrlActive, setCtrlActive] = useState(false);

  // Navigate back on disconnect
  useEffect(() => {
    if (state.connectionStatus === 'disconnected') {
      navigation.replace('Pair');
    }
  }, [state.connectionStatus, navigation]);

  // Subscribe to raw output to send to xterm
  useEffect(() => {
    setOnRawOutput(rawData => {
      if (webViewRef.current && rawData) {
        // We use injectJavaScript to postMessage to the WebView window safely.
        const js = `window.postMessage(JSON.stringify({type: 'write', data: ${JSON.stringify(rawData)}}), '*'); true;`;
        webViewRef.current.injectJavaScript(js);
      }
    });
    return () => setOnRawOutput(null);
  }, [setOnRawOutput]);

  const handleDisconnect = useCallback(() => {
    disconnect('Disconnected by user.');
  }, [disconnect]);

  const onWebViewMessage = useCallback(
    event => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === 'input') {
          // If Ctrl mode is active and the user typed a letter, convert to control character
          let {data} = msg;
          if (ctrlActive && data.length === 1) {
            const charCode = data.charCodeAt(0);
            // Convert lowercase/uppercase letters to control codes (1-26)
            if (charCode >= 97 && charCode <= 122) {
              data = String.fromCharCode(charCode - 96);
            } else if (charCode >= 65 && charCode <= 90) {
              data = String.fromCharCode(charCode - 64);
            }
            setCtrlActive(false);
          }
          sendInput(data);
        } else if (msg.type === 'resize') {
          sendResize(msg.rows, msg.cols);
        }
      } catch (e) {
        // ignore
      }
    },
    [sendInput, sendResize, ctrlActive],
  );

  const injectKey = useCallback(
    keySequence => {
      sendInput(keySequence);
    },
    [sendInput],
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusLeft}>
          <View style={styles.greenDot} />
          <Text style={styles.statusText}>connected</Text>
          {state.pairingCode && (
            <Text style={styles.statusCode}>{state.pairingCode}</Text>
          )}
        </View>
        <TouchableOpacity onPress={handleDisconnect}>
          <Text style={styles.disconnectBtn}>disconnect</Text>
        </TouchableOpacity>
      </View>

      {/* Terminal output (WebView xterm.js) */}
      <View style={styles.outputContainer}>
        <WebView
          ref={webViewRef}
          source={{html: XTERM_HTML}}
          style={styles.webview}
          onMessage={onWebViewMessage}
          bounces={false}
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          keyboardDisplayRequiresUserAction={false}
          hideKeyboardAccessoryView={true}
        />
      </View>

      {/* Custom Keyboard Accessory Rows */}
      <View style={styles.accessoryContainer}>
        {/* Top Row: Arrows */}
        <View style={styles.accessoryRow}>
          <TouchableOpacity
            style={styles.accessoryBtn}
            onPress={() => injectKey('\x1b[A')}>
            <Text style={styles.accessoryBtnText}>▲</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.accessoryBtn}
            onPress={() => injectKey('\x1b[B')}>
            <Text style={styles.accessoryBtnText}>▼</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.accessoryBtn}
            onPress={() => injectKey('\x1b[D')}>
            <Text style={styles.accessoryBtnText}>◀</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.accessoryBtn}
            onPress={() => injectKey('\x1b[C')}>
            <Text style={styles.accessoryBtnText}>▶</Text>
          </TouchableOpacity>
        </View>

        {/* Bottom Row: Utilities */}
        <View style={styles.accessoryRow}>
          <TouchableOpacity
            style={[styles.accessoryBtn, ctrlActive && styles.accessoryBtnActive]}
            onPress={() => setCtrlActive(!ctrlActive)}>
            <Text style={[styles.accessoryBtnText, ctrlActive && styles.accessoryBtnTextActive]}>
              Ctrl
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.accessoryBtn}
            onPress={() => injectKey('\x1b')}>
            <Text style={styles.accessoryBtnText}>Esc</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.accessoryBtn}
            onPress={() => injectKey('\t')}>
            <Text style={styles.accessoryBtnText}>Tab</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.accessoryBtn}
            onPress={() => injectKey('|')}>
            <Text style={styles.accessoryBtnText}>|</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.accessoryBtn}
            onPress={() => injectKey('/')}>
            <Text style={styles.accessoryBtnText}>/</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.accessoryBtn}
            onPress={() => injectKey('-')}>
            <Text style={styles.accessoryBtnText}>-</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.accessoryBtn}
            onPress={() => {
              Keyboard.dismiss();
              setCtrlActive(false);
            }}>
            <Text style={styles.accessoryBtnText}>⌨</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingTop: Platform.OS === 'ios' ? 54 : SPACING.md,
    paddingBottom: SPACING.sm,
    backgroundColor: COLORS.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.bgBorder,
    zIndex: 10,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  greenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.green,
  },
  statusText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
  statusCode: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textMuted,
    letterSpacing: 2,
  },
  disconnectBtn: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.red,
  },
  outputContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  accessoryContainer: {
    backgroundColor: COLORS.bgCard,
    borderTopWidth: 1,
    borderTopColor: COLORS.bgBorder,
    paddingVertical: SPACING.xs,
  },
  accessoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: SPACING.xs,
    paddingVertical: SPACING.xs,
  },
  accessoryBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.bg,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: COLORS.bgBorder,
  },
  accessoryBtnActive: {
    backgroundColor: COLORS.greenMuted,
    borderColor: COLORS.green,
  },
  accessoryBtnText: {
    fontFamily: FONT_MONO,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textPrimary,
  },
  accessoryBtnTextActive: {
    color: COLORS.green,
    fontWeight: 'bold',
  },
});

