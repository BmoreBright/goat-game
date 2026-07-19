/**
 * Browser WebSocket client for G.O.A.T. Debate multiplayer.
 * Host-authoritative: host pushes state; clients send actions.
 *
 * Production: set VITE_WS_URL in your frontend env (e.g. wss://your-app.up.railway.app)
 */

const DEFAULT_URL = () => {
  if (typeof window === 'undefined') return 'ws://localhost:3847';

  // 1. Explicit override via query string (handy for testing)
  const params = new URLSearchParams(window.location.search);
  if (params.get('ws')) return params.get('ws');

  // 2. Production / staging – set this in Vercel (or Netlify) environment variables
  //    Example value: wss://goat-debate-server.up.railway.app
  const PROD_WS = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_URL) || null;
  if (PROD_WS) return PROD_WS;

  // 3. Local development fallback
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (window.location.port && window.location.port !== '3847') {
    return `${proto}//${window.location.hostname}:3847`;
  }
  return `${proto}//${window.location.host}`;
};

export function createNet(handlers = {}) {
  let ws = null;
  let url = DEFAULT_URL();
  let reconnectTimer = null;
  let intentionalClose = false;

  const state = {
    connected: false,
    roomCode: null,
    playerId: null,
    seat: null,
    isHost: false,
    players: [],
    lastError: null,
  };

  const emit = (type, payload = {}) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type, ...payload }));
    return true;
  };

  const applyJoined = (msg) => {
    state.roomCode = msg.roomCode;
    state.playerId = msg.playerId;
    state.seat = msg.seat;
    state.isHost = !!msg.isHost;
    state.players = msg.players || [];
    state.lastError = null;
    handlers.onJoined?.(state);
    handlers.onLobby?.(state.players, state);
  };

  const connect = (overrideUrl) => {
    if (overrideUrl) url = overrideUrl;
    intentionalClose = false;
    if (ws) {
      try { ws.close(); } catch { /* */ }
    }
    ws = new WebSocket(url);

    ws.onopen = () => {
      state.connected = true;
      state.lastError = null;
      handlers.onConnection?.(true);
    };

    ws.onclose = () => {
      state.connected = false;
      handlers.onConnection?.(false);
      if (!intentionalClose) {
        reconnectTimer = setTimeout(() => connect(), 2000);
      }
    };

    ws.onerror = () => {
      state.lastError = 'Connection error';
      handlers.onError?.(state.lastError);
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'joined':
          applyJoined(msg);
          break;
        case 'lobby':
          state.players = msg.players || [];
          if (msg.hostId && state.playerId === msg.hostId) state.isHost = true;
          handlers.onLobby?.(state.players, state);
          break;
        case 'state':
          handlers.onState?.(msg.state);
          break;
        case 'action':
          handlers.onAction?.(msg);
          break;
        case 'you_are_host':
          state.isHost = true;
          handlers.onBecameHost?.(state);
          break;
        case 'error':
          state.lastError = msg.message || 'Error';
          handlers.onError?.(state.lastError);
          break;
        case 'pong':
          handlers.onPong?.(msg);
          break;
        default:
          break;
      }
    };
  };

  return {
    get state() {
      return { ...state };
    },
    connect,
    disconnect() {
      intentionalClose = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
      state.connected = false;
      state.roomCode = null;
    },
    createRoom(name) {
      return emit('create', { name });
    },
    joinRoom(code, name) {
      return emit('join', { code, name });
    },
    setName(name) {
      return emit('set_name', { name });
    },
    setSeat(seat) {
      return emit('set_seat', { seat });
    },
    /** Host only */
    pushState(gameState) {
      if (!state.isHost) return false;
      return emit('state', { state: gameState });
    },
    /** Client → host */
    sendAction(action, payload = {}) {
      return emit('action', { action, payload });
    },
    ping() {
      return emit('ping');
    },
  };
}

/** Fields the host should broadcast (keep payloads lean).
 *  Private data (full hands / tempHands selections) is intentionally
 *  limited — clients must only apply their own seat.
 */
export function snapshotForNet(app) {
  return {
    gamePhase: app.gamePhase,
    playerCount: app.playerCount,
    playerNames: app.playerNames,
    currentCoach: app.currentCoach,
    currentPlayer: app.currentPlayer,
    currentPrompt: app.currentPrompt,
    scores: app.scores,
    roundNumber: app.roundNumber,
    targetScore: app.targetScore,
    options: app.options,
    tableShape: app.tableShape,
    visualTheme: app.visualTheme,
    playedCards: app.playedCards,
    votes: app.votes,
    tally: app.tally,
    winnerIndex: app.winnerIndex,
    revealPhase: app.revealPhase,
    revealStep: app.revealStep,
    isRevealing: app.isRevealing,
    // Still sent for now so dealing works; clients filter to own seat only
    hands: app.hands,
    decks: app.decks,
    discards: app.discards,
    usedShorthanded: app.usedShorthanded,
    shorthandedThisRound: app.shorthandedThisRound,
    shorthandedDeclared: app.shorthandedDeclared,
    benched: app.benched,
    tradeUsedThisRound: app.tradeUsedThisRound,
    freeAgencyStep: app.freeAgencyStep,
    // Do NOT broadcast tempHands — selection state must stay local
    // tempHands: app.tempHands,
    overtimePlayers: app.overtimePlayers,
    overtimePrompt: app.overtimePrompt,
    overtimeAnswers: app.overtimeAnswers,
    overtimeAnswerOrder: app.overtimeAnswerOrder,
    overtimeVotes: app.overtimeVotes,
    overtimeTally: app.overtimeTally,
    overtimeReveal: app.overtimeReveal,
    currentOTWriter: app.currentOTWriter,
    resolvedByOvertime: app.resolvedByOvertime,
    finalOTData: app.finalOTData,
    isReady: app.isReady,
    phaseReady: app.phaseReady,
  };
}

