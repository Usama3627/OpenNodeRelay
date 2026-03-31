/**
 * DaemonContext — Terminal mode
 *
 * Manages a persistent shell session over WebRTC DataChannel.
 * The daemon runs a single bash process; we send input and receive output.
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useRef,
  useCallback,
} from 'react';

const MAX_LINES = 5000;

// Strip ANSI escape codes from PTY output
function stripAnsi(str) {
  return str.replace(
    // eslint-disable-next-line no-control-regex
    /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    '',
  );
}

const initialState = {
  connectionStatus: 'disconnected',
  connectionStatusText: '',
  pairingCode: null,
  lines: [], // [{stream: 'stdout'|'stderr'|'system'|'input', text: string, ts: number}]
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_CONNECTION_STATUS':
      return {
        ...state,
        connectionStatus: action.status,
        connectionStatusText: action.text || '',
      };

    case 'SET_PAIRING_CODE':
      return {...state, pairingCode: action.code};

    case 'APPEND_LINE': {
      const newLines = [...state.lines, action.line];
      return {
        ...state,
        lines:
          newLines.length > MAX_LINES
            ? newLines.slice(newLines.length - MAX_LINES)
            : newLines,
      };
    }

    case 'BATCH_APPEND_LINES': {
      const newLines = [...state.lines, ...action.lines];
      return {
        ...state,
        lines:
          newLines.length > MAX_LINES
            ? newLines.slice(newLines.length - MAX_LINES)
            : newLines,
      };
    }

    case 'DISCONNECT':
      return {
        ...initialState,
        connectionStatus: 'disconnected',
        connectionStatusText: action.reason || '',
      };

    default:
      return state;
  }
}

const DaemonContext = createContext(null);

export function DaemonProvider({children}) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const pcRef = useRef(null);
  const dcRef = useRef(null);
  const onRawOutputRef = useRef(null);

  // Batch buffer for output lines
  const batchRef = useRef([]);
  const flushTimerRef = useRef(null);

  const flushBatch = useCallback(() => {
    flushTimerRef.current = null;
    const lines = batchRef.current;
    if (lines.length === 0) return;
    batchRef.current = [];
    dispatch({type: 'BATCH_APPEND_LINES', lines});
  }, []);

  const scheduleBatchFlush = useCallback(() => {
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(flushBatch, 100);
    }
  }, [flushBatch]);

  function decodeData(data) {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      return String.fromCharCode.apply(null, bytes);
    }
    return String(data);
  }

  const handleMessage = useCallback(
    event => {
      let msg;
      try {
        msg = JSON.parse(decodeData(event.data));
      } catch {
        return;
      }

      if (msg.type === 'output') {
        if (onRawOutputRef.current) {
          onRawOutputRef.current(msg.line || '');
        }

        // PTY output comes as raw chunks — split into lines for display
        const text = msg.line || '';
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.length > 0) {
            batchRef.current.push({
              stream: msg.stream || 'stdout',
              text: stripAnsi(line),
              ts: Date.now(),
            });
          }
        }
        scheduleBatchFlush();
      }
    },
    [scheduleBatchFlush],
  );

  const setOnRawOutput = useCallback(cb => {
    onRawOutputRef.current = cb;
  }, []);

  const attachDataChannel = useCallback(
    (pc, dc) => {
      pcRef.current = pc;
      dcRef.current = dc;

      dc.addEventListener('message', event => {
        handleMessage(event);
      });

      dc.addEventListener('close', () => {
        dispatch({
          type: 'DISCONNECT',
          reason: 'Connection lost.',
        });
        pcRef.current = null;
        dcRef.current = null;
      });

      pc.addEventListener('connectionstatechange', () => {
        if (
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed'
        ) {
          dispatch({
            type: 'DISCONNECT',
            reason: 'Connection lost.',
          });
          pcRef.current = null;
          dcRef.current = null;
        }
      });
    },
    [handleMessage],
  );

  const setConnected = useCallback(
    (pc, dc, pairingCode) => {
      attachDataChannel(pc, dc);
      dispatch({type: 'SET_PAIRING_CODE', code: pairingCode});
      dispatch({
        type: 'SET_CONNECTION_STATUS',
        status: 'connected',
        text: 'Connected',
      });
    },
    [attachDataChannel],
  );

  /**
   * Send a line of input to the daemon's shell.
   */
  const sendInput = useCallback(text => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') return;

    // PTY echoes input back, so no need to append locally
    dc.send(JSON.stringify({type: 'input', text}));
  }, []);

  /**
   * Send terminal resize to daemon.
   */
  const sendResize = useCallback((rows, cols) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== 'open') return;
    dc.send(JSON.stringify({type: 'resize', rows, cols}));
  }, []);

  const disconnect = useCallback(reason => {
    const pc = pcRef.current;
    const dc = dcRef.current;
    if (dc) {
      try { dc.close(); } catch {}
    }
    if (pc) {
      try { pc.close(); } catch {}
    }
    pcRef.current = null;
    dcRef.current = null;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    batchRef.current = [];
    dispatch({type: 'DISCONNECT', reason});
  }, []);

  const value = {
    state,
    dispatch,
    sendInput,
    sendResize,
    setConnected,
    disconnect,
    setOnRawOutput,
  };

  return (
    <DaemonContext.Provider value={value}>{children}</DaemonContext.Provider>
  );
}

export function useDaemon() {
  const ctx = useContext(DaemonContext);
  if (!ctx) {
    throw new Error('useDaemon must be used inside DaemonProvider');
  }
  return ctx;
}
