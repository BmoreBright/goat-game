import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createNet, snapshotForNet } from './multiplayer';

// ========== ICONS ==========
const TrophyIcon = ({ className = 'w-9 h-9' }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8m-4-4v4m-6.5-8.5A5.5 5.5 0 0112 5.5a5.5 5.5 0 016.5 7.5M6 10h12a2 2 0 012 2v1a6 6 0 01-6 6H10a6 6 0 01-6-6v-1a2 2 0 012-2z" />
  </svg>
);

const PassIcon = ({ className = 'w-16 h-16' }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
  </svg>
);

// ========== SOUNDS ==========
const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
let audioCtx = null;
const getAudioCtx = () => {
  if (!AudioCtx) return null;
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
};
const playTone = (freq, duration = 0.1, type = 'sine', volume = 0.08) => {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.value = volume;
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
};
const sounds = {
  select: () => playTone(520, 0.07, 'sine', 0.06),
  play: () => { playTone(380, 0.08); setTimeout(() => playTone(520, 0.1), 60); },
  flip: () => playTone(300, 0.12, 'triangle', 0.07),
  vote: () => playTone(660, 0.09, 'sine', 0.07),
  voteLock: () => { playTone(520, 0.06); setTimeout(() => playTone(780, 0.12, 'sine', 0.08), 70); },
  deal: () => playTone(240, 0.08, 'sine', 0.05),
  tie: () => { playTone(200, 0.15, 'sawtooth', 0.05); setTimeout(() => playTone(160, 0.2, 'sawtooth', 0.05), 120); },
  win: () => { playTone(523, 0.12); setTimeout(() => playTone(659, 0.12), 100); setTimeout(() => playTone(784, 0.2), 200); },
  click: () => playTone(800, 0.04, 'sine', 0.04),
  shuffle: () => {
    [0, 40, 80, 130, 170, 220, 280, 340].forEach(t => {
      setTimeout(() => playTone(180 + Math.random() * 80, 0.04, 'triangle', 0.045), t);
    });
  },
  chip: () => playTone(900, 0.06, 'sine', 0.05),
  chipLand: () => { playTone(720, 0.05, 'triangle', 0.05); setTimeout(() => playTone(480, 0.08, 'sine', 0.04), 50); },
  ready: () => playTone(440, 0.08, 'sine', 0.05),
  pass: () => playTone(280, 0.1, 'triangle', 0.05),
  tip: () => playTone(990, 0.05, 'sine', 0.035),
  otSting: () => {
    playTone(196, 0.12, 'sawtooth', 0.05);
    setTimeout(() => playTone(247, 0.12, 'sawtooth', 0.05), 100);
    setTimeout(() => playTone(294, 0.18, 'triangle', 0.06), 200);
  },
};

let uidCounter = 0;
const makeUid = (prefix = 'card') => `${prefix}-${Date.now()}-${uidCounter++}-${Math.random().toString(36).slice(2, 7)}`;

const FALLBACK_OT = [
  { id: 401, text: 'Who is the greatest athlete of all time?', category: 'overtime', injury: 0 },
  { id: 402, text: 'Which franchise would you rebuild from scratch first?', category: 'overtime', injury: 0 },
  { id: 403, text: 'What is the most dominant single-season performance ever?', category: 'overtime', injury: 0 },
  { id: 404, text: 'Who is the most clutch performer in sports history?', category: 'overtime', injury: 0 },
  { id: 405, text: 'What is the greatest team dynasty of all time?', category: 'overtime', injury: 0 },
];

const ChipStack = ({ count, large = false }) => {
  const visible = Math.min(Math.max(count, 0), 8);
  return (
    <div className={`seat-chips ${large ? 'chips-large' : ''}`}>
      <div className="chip-stack" style={{ height: `${10 + visible * 4}px` }}>
        {Array.from({ length: visible }).map((_, i) => (
          <div key={i} className="chip" style={{ bottom: `${i * 4}px`, zIndex: i + 1 }} />
        ))}
      </div>
      <div className="chip-count">{count}</div>
    </div>
  );
};

const OnlineSelfReady = ({ onReady }) => {
  useEffect(() => { onReady(); }, [onReady]);
  return null; // immediately ready — no extra screen
};

const PLAYER_HUES = ['#eab308', '#38bdf8', '#f472b6', '#a3e635', '#fb923c', '#c084fc', '#2dd4bf', '#f87171'];

/** Easy layout knobs — change these instead of hunting magic numbers */
const layoutConfig = {
  // Your hand — PTCGP-like scale
  handCardWidth: 148,
  handCardHeight: 220,
  handFanSpread: 72,      // px between card centers (desktop fan)
  handFanRotate: 5.0,     // deg per step from center
  handBottomPad: 8,
  // Mobile hand
  mobileHandCardWidth: 132,
  mobileHandGap: 12,
  // Center / played cards
  centerCardWidth: 96,
  centerCardHeight: 134,
  // Opponent category decks (equal size stacks)
  miniDeckWidth: 44,
  miniDeckHeight: 62,
};



const GameCard = ({
  card,
  selected = false,
  disabled = false,
  flipped = false,
  onClick,
  showOwner = false,
  ownerName = '',
  className = '',
  size = 'hand',
  flyIn = false,
  delayClass = '',
  style = {}
}) => {
  const accent =
    card.category === 'player' ? 'card-accent-player' :
    card.category === 'team' ? 'card-accent-team' :
    card.category === 'moment' ? 'card-accent-moment' : 'card-accent-player';
  // table = piles/seat face-down; reveal = larger readable center cards; hand = private fan
  const sizeClass =
    size === 'reveal' ? 'reveal-size' :
    size === 'center' || size === 'table' ? 'table-size' : 'hand-size';
  const fullText = card?.text || '';

  const catKey = card.category === 'team' ? 'team' : card.category === 'moment' ? 'moment' : 'player';

  return (
    <div
      className={`card-scene ${flyIn ? `card-fly-in ${delayClass}` : ''} ${!flipped ? 'has-tooltip' : ''}`}
      style={style}
    >
      <div className={`card-rotator ${sizeClass} ${flipped ? 'is-flipped' : ''}`}>
        <div
          className={`card ${accent} ${selected ? 'card-selected' : ''} ${disabled ? 'card-disabled' : ''} ${className}`}
          onClick={disabled ? undefined : onClick}
        >
          <div className={`card-face card-front card-front-${catKey}`}>
            {card.injury > 0 && <span className="card-injury-badge">INJ {card.injury}</span>}
            {card.passed && <span className="card-pass-badge">PASS</span>}
            <p className="card-text">{fullText}</p>
            {showOwner && ownerName && (
              <div className="card-owner">{ownerName}</div>
            )}
          </div>
          <div className={`card-face card-back card-back-${catKey}`}>
            <span className="card-back-fallback">{catKey === 'player' ? 'PLAYER' : catKey === 'team' ? 'TEAM' : 'MOMENT'}</span>
          </div>
        </div>
      </div>
      {!flipped && fullText && (
        <div className="card-tooltip" role="tooltip">{fullText}</div>
      )}
    </div>
  );
};

const AnswerCard = ({ text, flipped = false, disabled = false, onClick, label = '', className = '', flyIn = false, delayClass = '' }) => (
  <GameCard
    card={{ text: text || '—', category: 'player', injury: 0 }}
    flipped={flipped}
    disabled={disabled}
    onClick={onClick}
    showOwner={!!label}
    ownerName={label}
    className={className}
    size="reveal"
    flyIn={flyIn}
    delayClass={delayClass}
  />
);

function App() {
  const [options, setOptions] = useState({ freeAgency: true, trades: true, shorthanded: true, injured: true });
  const [tableShape, setTableShape] = useState('football');
  const [visualTheme, setVisualTheme] = useState('arena');
  const [videoBg, setVideoBg] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [revealStep, setRevealStep] = useState(0); // staggered reveal progress
  const [isRevealing, setIsRevealing] = useState(false);
  /** gather | shuffle | spread | flipping | ready */
  const [revealAnim, setRevealAnim] = useState('gather');
  const [tipSeen, setTipSeen] = useState({ freeAgency: false, trades: false, shorthanded: false, injured: false });
  const [activeTip, setActiveTip] = useState(null);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = useRef(null);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const requestAppFullscreen = () => {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) {
      req.call(el).catch(() => {});
      return true;
    }
    // iOS Safari: fullscreen API is limited — prompt install instead
    alert('For a full-screen app experience on iPhone: tap Share → Add to Home Screen. Then open G.O.A.T. from your home screen.');
    return false;
  };
  const [playMode, setPlayMode] = useState('local'); // 'local' | 'online'
  const [netStatus, setNetStatus] = useState({ connected: false, roomCode: null, isHost: false, seat: null, players: [], error: null });
  const [joinCode, setJoinCode] = useState('');
  const [lobbyName, setLobbyName] = useState('');
  const [voiceOn, setVoiceOn] = useState(false);
  const [bottomBarOpen, setBottomBarOpen] = useState(false);
  const netRef = useRef(null);
  const isOnline = playMode === 'online';
  const mySeat = netStatus.seat;
  const isHost = netStatus.isHost;
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);



  const [playerCount, setPlayerCount] = useState(4);
  const [playerNames, setPlayerNames] = useState(['', '', '', '', '', '', '', '']);
  const [currentCoach, setCurrentCoach] = useState(0);
  const [hands, setHands] = useState([]);
  const [decks, setDecks] = useState({ player: [], team: [], moment: [] });
  const [discards, setDiscards] = useState({ player: [], team: [], moment: [] });
  const [currentPrompt, setCurrentPrompt] = useState(null);
  const [playedCards, setPlayedCards] = useState([]);
  const [scores, setScores] = useState([]);
  const [gamePhase, setGamePhase] = useState('setup');
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [votes, setVotes] = useState({});
  const [tally, setTally] = useState({});
  const [winnerIndex, setWinnerIndex] = useState(null);
  const [cardsLoaded, setCardsLoaded] = useState(false);
  const [allData, setAllData] = useState({
    prompts: { player: [], team: [], moment: [], overtime: [] },
    cards: { player: [], team: [], moment: [] }
  });
  const [roundNumber, setRoundNumber] = useState(1);
  const [usedShorthanded, setUsedShorthanded] = useState([]);
  const [shorthandedThisRound, setShorthandedThisRound] = useState([]);
  const [shorthandedQueue, setShorthandedQueue] = useState([]);
  const [shorthandedDeclared, setShorthandedDeclared] = useState([]);
  const [benched, setBenched] = useState({});
  const [phaseReady, setPhaseReady] = useState([]); // per-player done for shared phases
  const [tradeUsedThisRound, setTradeUsedThisRound] = useState([]);
  const [freeAgencyStep, setFreeAgencyStep] = useState({ player: 0 });
  const [tempHands, setTempHands] = useState({ player: [], team: [], moment: [] });
  const [introFlash, setIntroFlash] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [targetScore, setTargetScore] = useState(5);
  const [showHowTo, setShowHowTo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [revealPhase, setRevealPhase] = useState(false);
  const [justPlayedUid, setJustPlayedUid] = useState(null);
  const [pendingNewCards, setPendingNewCards] = useState({});
  const [isShuffling, setIsShuffling] = useState(false);
  const [lastWinner, setLastWinner] = useState(null);
  const [flyingChips, setFlyingChips] = useState([]);
  const [hoveredCategory, setHoveredCategory] = useState(null);
  const [hoveredCardUid, setHoveredCardUid] = useState(null);
  const [dealAnims, setDealAnims] = useState([]);
  const [usedPromptIds, setUsedPromptIds] = useState({ player: [], team: [], moment: [], overtime: [] });
  const [jumpBallAnim, setJumpBallAnim] = useState(false);
  const [setupSlide, setSetupSlide] = useState(0);
  const [arenaSlide, setArenaSlide] = useState(0);
  const [musicOn, setMusicOn] = useState(false);
  const themeAudioRef = useRef(null);

  const [overtimePlayers, setOvertimePlayers] = useState([]);
  const [overtimePrompt, setOvertimePrompt] = useState(null);
  const [overtimeAnswers, setOvertimeAnswers] = useState({});
  const [overtimeAnswerOrder, setOvertimeAnswerOrder] = useState([]);
  const [overtimeVotes, setOvertimeVotes] = useState({});
  const [overtimeTally, setOvertimeTally] = useState({});
  const [overtimeReveal, setOvertimeReveal] = useState(false);
  const [currentOTWriter, setCurrentOTWriter] = useState(0);
  const [tempOTAnswer, setTempOTAnswer] = useState('');
  const [originalShorthanded, setOriginalShorthanded] = useState([]);
  const [resolvedByOvertime, setResolvedByOvertime] = useState(false);
  const [finalOTData, setFinalOTData] = useState(null);

  useEffect(() => {
    fetch('/cards.csv')
      .then(res => res.text())
      .then(text => {
        const lines = text.trim().split('\n').slice(1);
        const prompts = { player: [], team: [], moment: [], overtime: [] };
        const cards = { player: [], team: [], moment: [] };
        lines.forEach(line => {
          if (!line.trim()) return;
          const [type, category, id, ...textParts] = line.split(',');
          const t = textParts.join(',').replace(/^"|"$/g, '');
          const item = { id: parseInt(id, 10), text: t, category, injury: 0 };
          if (type === 'prompt' && prompts[category]) prompts[category].push(item);
          else if (type === 'card' && cards[category]) cards[category].push(item);
        });
        if (!prompts.overtime.length) prompts.overtime = [...FALLBACK_OT];
        setAllData({ prompts, cards });
        setCardsLoaded(true);
      })
      .catch(() => {
        setAllData({
          prompts: {
            player: [{ id: 101, text: 'Most likely to choke in the biggest moment', category: 'player', injury: 0 }],
            team: [{ id: 201, text: 'Most cursed franchise', category: 'team', injury: 0 }],
            moment: [{ id: 301, text: 'Most iconic sports moment', category: 'moment', injury: 0 }],
            overtime: [...FALLBACK_OT]
          },
          cards: {
            player: [
              { id: 1001, text: 'Prime Michael Jordan', category: 'player', injury: 0 },
              { id: 1002, text: 'Tom Brady', category: 'player', injury: 0 },
              { id: 1003, text: 'Serena Williams', category: 'player', injury: 0 },
              { id: 1004, text: 'Lionel Messi', category: 'player', injury: 0 },
              { id: 1005, text: 'Usain Bolt', category: 'player', injury: 0 },
              { id: 1006, text: 'Wayne Gretzky', category: 'player', injury: 0 },
              { id: 1007, text: 'Muhammad Ali', category: 'player', injury: 0 }
            ],
            team: [
              { id: 2001, text: '1990s Chicago Bulls', category: 'team', injury: 0 },
              { id: 2002, text: 'New England Patriots dynasty', category: 'team', injury: 0 },
              { id: 2003, text: '1970s Pittsburgh Steelers', category: 'team', injury: 0 },
              { id: 2004, text: 'Barcelona 2009-2011', category: 'team', injury: 0 },
              { id: 2005, text: 'Golden State Warriors 2015-19', category: 'team', injury: 0 },
              { id: 2006, text: '1980s Lakers', category: 'team', injury: 0 },
              { id: 2007, text: 'All Blacks', category: 'team', injury: 0 }
            ],
            moment: [
              { id: 3001, text: 'The Catch (Dwight Clark)', category: 'moment', injury: 0 },
              { id: 3002, text: 'Miracle on Ice', category: 'moment', injury: 0 },
              { id: 3003, text: 'Tiger Woods 2019 Masters', category: 'moment', injury: 0 },
              { id: 3004, text: 'Jordan Flu Game', category: 'moment', injury: 0 },
              { id: 3005, text: 'Hand of God', category: 'moment', injury: 0 },
              { id: 3006, text: 'Babe Ruth called shot', category: 'moment', injury: 0 },
              { id: 3007, text: 'Ali vs Foreman', category: 'moment', injury: 0 }
            ]
          }
        });
        setCardsLoaded(true);
      });
  }, []);

  const SETUP_SLIDES = [
    '/setup/stadium-night.jpg',
    '/setup/stadium-aerial.jpg',
    '/setup/victory-lift.jpg',
    '/setup/memorabilia.jpg',
  ];

  /** Theme still packs — independent of table shape */
  const THEME_SLIDES = {
    arena: [
      '/arena/arena-floodlights.jpg',
      '/arena/arena-aerial-night.jpg',
      '/arena/arena-scoreboard-haze.jpg',
      '/arena/arena-dusk-field.jpg',
      '/arena/arena-indoor-court.jpg',
      '/arena/arena-crowd-lights.jpg',
    ],
    broadcast: [
      '/arena/broadcast-control.jpg',
      '/arena/broadcast-studio.jpg',
      '/arena/broadcast-stadium.jpg',
      '/arena/arena-scoreboard-haze.jpg',
    ],
    memorabilia: [
      '/arena/memo-jerseys.jpg',
      '/arena/memo-trophies.jpg',
      '/arena/memo-cabinet.jpg',
      '/setup/memorabilia.jpg',
    ],
  };

  /** Optional muted loops — drop files in public/arena/videos/ */
  const THEME_VIDEOS = {
    arena: '/arena/videos/arena-loop.mp4',
    broadcast: '/arena/videos/broadcast-loop.mp4',
    memorabilia: '/arena/videos/memo-loop.mp4',
  };

  const activeSlides = THEME_SLIDES[visualTheme] || THEME_SLIDES.arena;
  const activeVideo = THEME_VIDEOS[visualTheme];

  // Cinematic background crossfade on setup
  useEffect(() => {
    if (gamePhase !== 'setup') return undefined;
    const id = setInterval(() => {
      setSetupSlide(s => (s + 1) % SETUP_SLIDES.length);
    }, 7000);
    return () => clearInterval(id);
  }, [gamePhase]);

  // In-game theme still crossfade (when not using video, or video failed)
  useEffect(() => {
    if (gamePhase === 'setup') return undefined;
    if (videoBg && !videoFailed) return undefined;
    const id = setInterval(() => {
      setArenaSlide(s => (s + 1) % activeSlides.length);
    }, 9000);
    return () => clearInterval(id);
  }, [gamePhase, visualTheme, videoBg, videoFailed, activeSlides.length]);

  // Reset video fail when theme/toggle changes
  useEffect(() => {
    setVideoFailed(false);
    setArenaSlide(0);
  }, [visualTheme, videoBg]);

  const toggleThemeMusic = () => {
    const el = themeAudioRef.current;
    if (!el) {
      // No file yet — still flip UI so user sees control works
      setMusicOn(m => !m);
      sounds.click();
      return;
    }
    if (musicOn) {
      el.pause();
      setMusicOn(false);
    } else {
      el.volume = 0.35;
      el.play().then(() => setMusicOn(true)).catch(() => setMusicOn(false));
    }
    sounds.click();
  };

  
  // ========== MULTIPLAYER ==========
  const applyRemoteState = useCallback((remote) => {
    if (!remote) return;
    // Clients apply host snapshot (skip if we are host — we already have it)
    if (netRef.current?.state?.isHost) return;
    if (remote.gamePhase != null) setGamePhase(remote.gamePhase);
    if (remote.playerCount != null) setPlayerCount(remote.playerCount);
    if (remote.playerNames) setPlayerNames(remote.playerNames);
    if (remote.currentCoach != null) setCurrentCoach(remote.currentCoach);
    if (remote.currentPlayer != null) setCurrentPlayer(remote.currentPlayer);
    if (remote.currentPrompt !== undefined) setCurrentPrompt(remote.currentPrompt);
    if (remote.scores) setScores(remote.scores);
    if (remote.roundNumber != null) setRoundNumber(remote.roundNumber);
    if (remote.targetScore != null) setTargetScore(remote.targetScore);
    if (remote.options) setOptions(remote.options);
    if (remote.tableShape) setTableShape(remote.tableShape);
    if (remote.visualTheme) setVisualTheme(remote.visualTheme);
    if (remote.playedCards) setPlayedCards(remote.playedCards);
    if (remote.votes) setVotes(remote.votes);
    if (remote.tally) setTally(remote.tally);
    if (remote.winnerIndex !== undefined) setWinnerIndex(remote.winnerIndex);
    if (remote.revealPhase != null) setRevealPhase(remote.revealPhase);
    if (remote.revealStep != null) setRevealStep(remote.revealStep);
    if (remote.isRevealing != null) setIsRevealing(remote.isRevealing);
    // Privacy: only keep my own hand from the snapshot
    if (remote.hands) {
      const my = netRef.current?.state?.seat;
      if (my != null && remote.hands[my]) {
        setHands(prev => {
          const base = (Array.isArray(prev) && prev.length === remote.hands.length)
            ? [...prev]
            : remote.hands.map(() => ({ player: [], team: [], moment: [] }));
          base[my] = remote.hands[my];
          return base;
        });
      } else {
        setHands(remote.hands);
      }
    }
    if (remote.decks) setDecks(remote.decks);
    if (remote.discards) setDiscards(remote.discards);
    if (remote.usedShorthanded) setUsedShorthanded(remote.usedShorthanded);
    if (remote.shorthandedThisRound) setShorthandedThisRound(remote.shorthandedThisRound);
    if (remote.shorthandedDeclared) setShorthandedDeclared(remote.shorthandedDeclared);
    if (remote.benched) setBenched(remote.benched);
    if (remote.tradeUsedThisRound) setTradeUsedThisRound(remote.tradeUsedThisRound);
    if (remote.freeAgencyStep) setFreeAgencyStep(remote.freeAgencyStep);
    // tempHands is local-only (selection must not be mirrored)
    if (remote.overtimePlayers) setOvertimePlayers(remote.overtimePlayers);

    if (remote.overtimePrompt !== undefined) setOvertimePrompt(remote.overtimePrompt);
    if (remote.overtimeAnswers) setOvertimeAnswers(remote.overtimeAnswers);
    if (remote.overtimeAnswerOrder) setOvertimeAnswerOrder(remote.overtimeAnswerOrder);
    if (remote.overtimeVotes) setOvertimeVotes(remote.overtimeVotes);
    if (remote.overtimeTally) setOvertimeTally(remote.overtimeTally);
    if (remote.overtimeReveal != null) setOvertimeReveal(remote.overtimeReveal);
    if (remote.currentOTWriter != null) setCurrentOTWriter(remote.currentOTWriter);
    if (remote.resolvedByOvertime != null) setResolvedByOvertime(remote.resolvedByOvertime);
    if (remote.finalOTData !== undefined) setFinalOTData(remote.finalOTData);
    // Online: auto-ready when it is your private turn
    if (remote.currentPlayer != null && netRef.current?.state?.seat === remote.currentPlayer) {
      setIsReady(true);
    } else if (remote.isReady != null) {
      setIsReady(remote.isReady);
    }
    if (remote.phaseReady) setPhaseReady(remote.phaseReady);
  }, []);

  useEffect(() => {
    if (playMode !== 'online') {
      if (netRef.current) {
        netRef.current.disconnect();
        netRef.current = null;
      }
      return undefined;
    }
    const net = createNet({
      onConnection: (ok) => setNetStatus(s => ({ ...s, connected: ok, error: ok ? null : s.error })),
      onJoined: (st) => setNetStatus({
        connected: true,
        roomCode: st.roomCode,
        isHost: st.isHost,
        seat: st.seat,
        players: st.players,
        error: null,
      }),
      onLobby: (players, st) => setNetStatus(s => ({
        ...s,
        players,
        isHost: st.isHost,
        seat: st.seat,
        roomCode: st.roomCode || s.roomCode,
      })),
      onState: (remote) => applyRemoteState(remote),
      onAction: (msg) => {
        // Host handles remote intents
        if (!netRef.current?.state?.isHost) return;
        const { action, payload, seat } = msg;
        window.dispatchEvent(new CustomEvent('goat-net-action', { detail: { action, payload, seat } }));
      },
      onBecameHost: () => setNetStatus(s => ({ ...s, isHost: true })),
      onError: (err) => setNetStatus(s => ({ ...s, error: err })),
    });
    netRef.current = net;
    net.connect();
    return () => {
      net.disconnect();
      netRef.current = null;
    };
  }, [playMode, applyRemoteState]);

  // Host broadcasts state snapshots
  useEffect(() => {
    if (playMode !== 'online') return;
    if (!netRef.current?.state?.isHost) return;
    if (gamePhase === 'setup') return;
    const snap = snapshotForNet({
      gamePhase, playerCount, playerNames, currentCoach, currentPlayer, currentPrompt,
      scores, roundNumber, targetScore, options, tableShape, visualTheme,
      playedCards, votes, tally, winnerIndex, revealPhase, revealStep, isRevealing,
      hands, decks, discards, usedShorthanded, shorthandedThisRound, shorthandedDeclared,
      benched, tradeUsedThisRound, freeAgencyStep, tempHands,
      overtimePlayers, overtimePrompt, overtimeAnswers, overtimeAnswerOrder,
      overtimeVotes, overtimeTally, overtimeReveal, currentOTWriter,
      resolvedByOvertime, finalOTData, isReady, phaseReady,
    });
    const t = setTimeout(() => netRef.current?.pushState(snap), 40);
    return () => clearTimeout(t);
  }, [
    playMode, gamePhase, playerCount, playerNames, currentCoach, currentPlayer, currentPrompt,
    scores, roundNumber, targetScore, options, tableShape, visualTheme,
    playedCards, votes, tally, winnerIndex, revealPhase, revealStep, isRevealing,
    hands, decks, discards, usedShorthanded, shorthandedThisRound, shorthandedDeclared,
    benched, tradeUsedThisRound, freeAgencyStep, tempHands,
    overtimePlayers, overtimePrompt, overtimeAnswers, overtimeAnswerOrder,
    overtimeVotes, overtimeTally, overtimeReveal, currentOTWriter,
    resolvedByOvertime, finalOTData, isReady, phaseReady,
  ]);

  // Host listens for remote actions
  useEffect(() => {
    if (playMode !== 'online') return undefined;
    const handler = (ev) => {
      if (!netRef.current?.state?.isHost) return;
      const { action, payload, seat } = ev.detail || {};
      // Map remote intents onto local handlers when it's that seat's turn
      if (action === 'ready') {
        if (seat === currentPlayer) setIsReady(true);
        return;
      }
      if (action === 'play_card' && gamePhase === 'playing' && seat === currentPlayer) {
        const card = payload?.card;
        if (card) playCard(card);
        return;
      }
      if (action === 'pass' && gamePhase === 'playing' && seat === currentPlayer) {
        passNoLegalCard();
        return;
      }
      if (action === 'vote' && gamePhase === 'voting' && seat === currentPlayer) {
        if (payload?.playedIndex != null) castVote(payload.playedIndex);
        return;
      }
      if (action === 'ot_answer' && gamePhase === 'overtimeWriting') {
        setTempOTAnswer(payload?.text || '');
        setTimeout(() => submitOTAnswer(), 0);
        return;
      }
      if (action === 'ot_vote' && gamePhase === 'overtimeVoting' && seat === currentPlayer) {
        if (payload?.answerPlayerIndex != null) castOTVote(payload.answerPlayerIndex);
        return;
      }
      if (action === 'choose_category' && gamePhase === 'category' && isHost) {
        return;
      }
      if (action === 'trade' && gamePhase === 'tradeWindow' && seat != null) {
        if (payload?.category) doTrade(seat, payload.category);
        return;
      }
      if (action === 'trade_done' && gamePhase === 'tradeWindow' && seat != null) {
        markPhaseReady(seat);
        return;
      }
      if (action === 'short_toggle' && gamePhase === 'shorthandedDeclare' && seat != null) {
        // only toggle that seat
        if (!usedShorthanded[seat]) {
          setShorthandedDeclared(prev =>
            prev.includes(seat) ? prev.filter(i => i !== seat) : [...prev, seat]
          );
        }
        return;
      }
      if (action === 'short_done' && gamePhase === 'shorthandedDeclare' && seat != null) {
        markPhaseReady(seat);
        return;
      }
      if (action === 'fa_toggle' && gamePhase === 'freeAgency' && seat != null) {
        // free agency still host-driven via tempHands on host; optional future
        return;
      }
    };
    window.addEventListener('goat-net-action', handler);
    return () => window.removeEventListener('goat-net-action', handler);
  });

  const netSend = (action, payload) => {
    if (playMode !== 'online') return false;
    if (netRef.current?.state?.isHost) return false; // host acts locally
    return netRef.current?.sendAction(action, payload);
  };

  // Auto-advance shared phases when every player is ready
  useEffect(() => {
    if (gamePhase !== 'tradeWindow' && gamePhase !== 'shorthandedDeclare') return;
    if (!allPhaseReady()) return;
    // slight delay so last click UI paints
    const id = setTimeout(() => {
      if (gamePhase === 'tradeWindow') finishTradeWindow();
      else if (gamePhase === 'shorthandedDeclare') finishShorthandedDeclare();
    }, 350);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseReady, gamePhase, playerCount]);



  const shuffle = (array) => {

    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const getName = (i) => playerNames[i] || `Player ${i + 1}`;
  const playerHue = (i) => PLAYER_HUES[i % PLAYER_HUES.length];

  const TIP_COPY = {
    freeAgency: { title: 'Free Agency', body: 'You were dealt 10 cards per category. Keep exactly 7 in each — the rest return to the deck.' },
    trades: { title: 'Trades', body: 'Until round 5, spend 1 point to redraw a whole category. Optional — skip if you like your hand.' },
    shorthanded: { title: 'Shorthanded', body: 'Once per game you may bench 4 cards. If you win that round, you score 2 points instead of 1.' },
    injured: { title: 'Playing Injured', body: 'Injury cards sit out 1–3 rounds. They return automatically when the counter hits zero.' },
  };

  const showRuleTip = (key) => {
    if (!options[key] || tipSeen[key]) return;
    setTipSeen(prev => ({ ...prev, [key]: true }));
    setActiveTip(key);
    sounds.tip();
  };

  const dismissTip = () => { setActiveTip(null); sounds.click(); };


  /** Draw n cards from category; reshuffle discards into deck if empty */
  const drawFromDeck = (decksIn, discardsIn, category, n) => {
    let remaining = [...(decksIn[category] || [])];
    let discardPile = [...(discardsIn[category] || [])];
    const drawn = [];
    for (let i = 0; i < n; i++) {
      if (remaining.length === 0) {
        if (discardPile.length === 0) break;
        remaining = shuffle(discardPile);
        discardPile = [];
        sounds.shuffle();
      }
      if (remaining.length === 0) break;
      drawn.push({ ...remaining.pop(), uid: makeUid() });
    }
    return {
      drawn,
      decks: { ...decksIn, [category]: remaining },
      discards: { ...discardsIn, [category]: discardPile }
    };
  };

  const pickPrompt = (category) => {
    const list = allData.prompts[category] || [];
    if (!list.length) return null;
    const used = usedPromptIds[category] || [];
    let pool = list.filter(p => !used.includes(p.id));
    if (!pool.length) {
      pool = list;
      setUsedPromptIds(prev => ({ ...prev, [category]: [] }));
    }
    const prompt = pool[Math.floor(Math.random() * pool.length)];
    setUsedPromptIds(prev => ({
      ...prev,
      [category]: [...(prev[category] || []).filter(id => id !== prompt.id), prompt.id]
    }));
    return prompt;
  };

  const needsPrivacy = ['freeAgency', 'playing', 'voting', 'shorthandedSelect', 'overtimeWriting'].includes(gamePhase);

  useEffect(() => {
    setHoveredCardUid(null);
    // Default the hand view to the active prompt category when playing
    if (gamePhase === 'playing' && currentPrompt?.category) {
      setHoveredCategory(currentPrompt.category);
    } else if (gamePhase !== 'playing') {
      setHoveredCategory(null);
    }

    if (!needsPrivacy) {
      setIsReady(true);
      return;
    }

    // Online: auto-ready only when it is THIS client's private turn
    if (isOnline) {
      let myTurn = false;
      if (gamePhase === 'freeAgency') myTurn = mySeat === freeAgencyStep.player;
      else if (gamePhase === 'overtimeWriting') myTurn = mySeat === overtimePlayers[currentOTWriter];
      else myTurn = mySeat === currentPlayer;
      setIsReady(!!myTurn);
      return;
    }

    // Local pass-and-play: always require the hold-to-reveal gate
    setIsReady(false);
  }, [gamePhase, currentPlayer, freeAgencyStep.player, currentOTWriter, isOnline, mySeat, overtimePlayers]);

  const triggerChipFly = (winnerIdx, points = 1) => {
    setLastWinner(winnerIdx);
    sounds.chip();
    const chips = Array.from({ length: points }).map((_, i) => ({ id: makeUid('chip'), delay: i * 80 }));
    setFlyingChips(chips);
    setTimeout(() => { setFlyingChips([]); setLastWinner(null); }, 900);
  };

  const seatDealVectors = {
    3: [{ dx: 0, dy: 150 }, { dx: -190, dy: -30 }, { dx: 190, dy: -30 }],
    4: [{ dx: 0, dy: 160 }, { dx: -210, dy: 0 }, { dx: 0, dy: -160 }, { dx: 210, dy: 0 }],
    5: [{ dx: 0, dy: 160 }, { dx: -190, dy: 70 }, { dx: -150, dy: -110 }, { dx: 150, dy: -110 }, { dx: 190, dy: 70 }],
    6: [{ dx: 0, dy: 160 }, { dx: -200, dy: 65 }, { dx: -200, dy: -65 }, { dx: 0, dy: -160 }, { dx: 200, dy: -65 }, { dx: 200, dy: 65 }]
  };

  const runDealAnimation = () => {
    const vectors = seatDealVectors[playerCount] || seatDealVectors[4];
    const anims = [];
    for (let p = 0; p < playerCount; p++) {
      for (let c = 0; c < 2; c++) {
        anims.push({
          id: makeUid('deal'),
          dx: vectors[p].dx + (Math.random() * 16 - 8),
          dy: vectors[p].dy + (Math.random() * 12 - 6),
          delay: p * 85 + c * 35
        });
      }
    }
    setDealAnims(anims);
    sounds.shuffle();
    setTimeout(() => setDealAnims([]), 850);
  };

  const centerOrder = useMemo(() => {
    if (!playedCards.length) return [];
    const idxs = playedCards.map((_, i) => i);
    const key = playedCards.map(p => p.card.uid).join('|');
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const rng = () => {
      h = Math.imul(h ^ (h >>> 15), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    return idxs;
  }, [playedCards]);

  const getPlayableCards = (playerIdx, category) => {
    const hand = hands[playerIdx]?.[category] || [];
    const bench = benched[playerIdx] || [];
    return hand.filter(c => c.injury <= 0 && !bench.find(b => b.uid === c.uid) && !c.passed);
  };

  // ========== START ==========
  const startGame = () => {
    if (!cardsLoaded) return;

    // ----- Resolve actual players for this match -----
    let count = playerCount;
    let names = playerNames.slice(0, playerCount).map((n, i) => n.trim() || `Player ${i + 1}`);

    if (isOnline) {
      if (!isHost) return; // only host may start
      const connected = (netStatus.players || [])
        .filter(p => p.connected)
        .sort((a, b) => a.seat - b.seat);
      if (connected.length < 2) {
        alert('Need at least 2 players in the room to start.');
        return;
      }
      count = connected.length;
      names = connected.map((p, i) => (p.name || `Player ${i + 1}`).slice(0, 18));
      setPlayerCount(count);
      setPlayerNames(names);
    }

    sounds.click();
    setPlayerNames(names);
    setUsedShorthanded(Array(count).fill(false));
    setShorthandedThisRound(Array(count).fill(false));
    setShorthandedDeclared([]);
    setShorthandedQueue([]);
    setTradeUsedThisRound(Array(count).fill(false));
    setRoundNumber(1);
    setPendingNewCards({});
    setIsReady(false);
    setRevealPhase(false);
    setJustPlayedUid(null);
    setOvertimePlayers([]);
    setOvertimeAnswers({});
    setResolvedByOvertime(false);
    setFinalOTData(null);
    setLastWinner(null);
    setHoveredCategory(null);
    setPlayedCards([]);
    setVotes({});
    setTally({});
    setWinnerIndex(null);
    setUsedPromptIds({ player: [], team: [], moment: [], overtime: [] });
    setDiscards({ player: [], team: [], moment: [] });

    const baseCards = {
      player: [...allData.cards.player],
      team: [...allData.cards.team],
      moment: [...allData.cards.moment]
    };
    if (options.injured) {
      let injId = 9100;
      ['player', 'team', 'moment'].forEach(cat => {
        [1, 2, 3].forEach(rounds => {
          baseCards[cat].push({
            id: injId++,
            text: `INJURED – Out ${rounds} Round${rounds > 1 ? 's' : ''}`,
            category: cat,
            injury: rounds
          });
        });
      });
    }

    let freshDecks = {
      player: shuffle(baseCards.player),
      team: shuffle(baseCards.team),
      moment: shuffle(baseCards.moment)
    };
    const emptyDiscards = { player: [], team: [], moment: [] };
    const dealCount = options.freeAgency ? 10 : 7;

    const newHands = Array.from({ length: count }, () => {
      const hand = { player: [], team: [], moment: [] };
      ['player', 'team', 'moment'].forEach(cat => {
        const result = drawFromDeck(freshDecks, emptyDiscards, cat, dealCount);
        freshDecks = result.decks;
        hand[cat] = result.drawn;
      });
      return hand;
    });
    setHands(newHands);
    setDecks(freshDecks);
    setScores(Array(count).fill(0));
    setCurrentCoach(0);
    setCurrentPlayer(0);

    // Always enter table with cinematic intro + dialogue first
    setFreeAgencyStep({ player: 0 });
    setTempHands({ player: [], team: [], moment: [] });
    setGamePhase('tableIntro');
    setIsReady(true);
    setIntroFlash(true);
    setTimeout(() => setIntroFlash(false), 1100);
  };

  const beginTempHandsForPlayer = (playerIdx, handsSnapshot) => {
    const h = handsSnapshot[playerIdx];
    setTempHands({
      player: (h.player || []).map(c => ({ ...c, selected: false })),
      team: (h.team || []).map(c => ({ ...c, selected: false })),
      moment: (h.moment || []).map(c => ({ ...c, selected: false })),
    });
  };

  const continueFromTableIntro = () => {
    sounds.click();
    if (options.freeAgency) {
      setFreeAgencyStep({ player: 0 });
      beginTempHandsForPlayer(0, hands);
      setGamePhase('freeAgency');
      setIsReady(false);
      setTimeout(() => showRuleTip('freeAgency'), 400);
    } else {
      setGamePhase('dealing');
      setIsReady(true);
      setIsShuffling(true);
      runDealAnimation();
      setTimeout(() => setIsShuffling(false), 700);
    }
  };

  // ========== FREE AGENCY (all 30 cards, keep 7 per category) ==========
  const toggleFreeAgencyCard = (category, uid) => {
    sounds.select();
    setTempHands(prev => {
      const current = [...prev[category]];
      const idx = current.findIndex(c => c.uid === uid);
      if (idx === -1) return prev;
      const selectedCount = current.filter(c => c.selected).length;
      if (current[idx].selected) {
        current[idx] = { ...current[idx], selected: false };
      } else if (selectedCount < 7) {
        current[idx] = { ...current[idx], selected: true };
      }
      return { ...prev, [category]: current };
    });
  };

  const freeAgencyKeepCounts = () => ({
    player: (tempHands.player || []).filter(c => c.selected).length,
    team: (tempHands.team || []).filter(c => c.selected).length,
    moment: (tempHands.moment || []).filter(c => c.selected).length,
  });

  const confirmFreeAgency = () => {
    const counts = freeAgencyKeepCounts();
    const missing = ['player', 'team', 'moment'].filter(cat => counts[cat] !== 7);
    if (missing.length) {
      alert(`Select exactly 7 cards to keep in: ${missing.join(', ')}`);
      return;
    }
    sounds.click();
    const newHands = [...hands];
    const pIdx = freeAgencyStep.player;
    let nextDecks = { ...decks };

    ['player', 'team', 'moment'].forEach(cat => {
      const kept = tempHands[cat].filter(c => c.selected).map(({ selected, ...rest }) => rest);
      const discarded = tempHands[cat].filter(c => !c.selected).map(({ selected, uid, ...rest }) => rest);
      newHands[pIdx][cat] = kept;
      nextDecks = {
        ...nextDecks,
        [cat]: shuffle([...(nextDecks[cat] || []), ...discarded]),
      };
    });

    setHands(newHands);
    setDecks(nextDecks);

    if (pIdx < playerCount - 1) {
      const nextPlayer = pIdx + 1;
      setFreeAgencyStep({ player: nextPlayer });
      beginTempHandsForPlayer(nextPlayer, newHands);
      setIsReady(false);
    } else {
      setGamePhase('dealing');
      setIsReady(true);
      setIsShuffling(true);
      runDealAnimation();
      setTimeout(() => setIsShuffling(false), 700);
    }
  };

  // ========== CATEGORY ==========
  const chooseCategory = (category) => {
    if (gamePhase !== 'category') return;
    sounds.click();
    const prompt = pickPrompt(category);
    if (!prompt) return;
    setCurrentPrompt(prompt);
    setPlayedCards([]);
    setCurrentPlayer(0);
    setVotes({});
    setTally({});
    setWinnerIndex(null);
    setTradeUsedThisRound(Array(playerCount).fill(false));
    setShorthandedThisRound(Array(playerCount).fill(false));
    setShorthandedDeclared([]);
    setShorthandedQueue([]);
    setBenched({});
    setRevealPhase(false);
    setResolvedByOvertime(false);
    setFinalOTData(null);
    setIsReady(false);
    setHoveredCategory(null);
    if (options.trades && roundNumber <= 4) {
      setPhaseReady(Array(playerCount).fill(false));
      setTimeout(() => showRuleTip('trades'), 300);
      setGamePhase('tradeWindow');
    }
    else if (options.shorthanded) {
      setPhaseReady(Array.from({ length: playerCount }, (_, i) => !!usedShorthanded[i]));
      setTimeout(() => showRuleTip('shorthanded'), 300);
      setGamePhase('shorthandedDeclare');
    }
    else {
      if (options.injured) setTimeout(() => showRuleTip('injured'), 300);
      setGamePhase('playing');
    }
  };

  // ========== TRADE ==========
  const doTrade = (playerIdx, category) => {
    if (scores[playerIdx] < 1) { alert(`${getName(playerIdx)} needs at least 1 point to trade`); return; }
    if (tradeUsedThisRound[playerIdx]) return;
    sounds.click();
    const newScores = [...scores];
    newScores[playerIdx]--;
    setScores(newScores);

    const oldCards = hands[playerIdx][category] || [];
    // Return old cards to discard → available for reshuffle
    let nextDiscards = {
      ...discards,
      [category]: [...(discards[category] || []), ...oldCards.map(({ uid, ...rest }) => rest)]
    };
    const result = drawFromDeck(decks, nextDiscards, category, 7);
    setDecks(result.decks);
    setDiscards(result.discards);

    const newHands = [...hands];
    newHands[playerIdx][category] = result.drawn;
    setHands(newHands);

    const used = [...tradeUsedThisRound];
    used[playerIdx] = true;
    setTradeUsedThisRound(used);
  };

  const finishTradeWindow = () => {
    sounds.click();
    if (options.shorthanded) {
      setPhaseReady(Array.from({ length: playerCount }, (_, i) => !!usedShorthanded[i]));
      setGamePhase('shorthandedDeclare');
    } else {
      setGamePhase('playing');
      setIsReady(false);
    }
  };

  const markPhaseReady = (playerIdx) => {
    setPhaseReady(prev => {
      const base = prev.length === playerCount ? [...prev] : Array(playerCount).fill(false);
      base[playerIdx] = true;
      return base;
    });
  };

  const allPhaseReady = () => {
    if (phaseReady.length < playerCount) return false;
    return phaseReady.every(Boolean);
  };


  // ========== SHORTHANDED (multi-player) ==========
  const toggleShorthandedDeclare = (playerIdx) => {
    if (usedShorthanded[playerIdx]) return;
    sounds.select();
    setShorthandedDeclared(prev =>
      prev.includes(playerIdx) ? prev.filter(i => i !== playerIdx) : [...prev, playerIdx]
    );
  };

  const finishShorthandedDeclare = () => {
    sounds.click();
    if (!shorthandedDeclared.length) {
      setGamePhase('playing');
      setCurrentPlayer(0);
      setIsReady(false);
      return;
    }
    const queue = [...shorthandedDeclared];
    setShorthandedQueue(queue.slice(1));
    setCurrentPlayer(queue[0]);
    setGamePhase('shorthandedSelect');
    setIsReady(false);
  };

  const toggleBench = (uid) => {
    sounds.select();
    const cat = currentPrompt.category;
    const already = benched[currentPlayer] || [];
    const isBenched = already.find(c => c.uid === uid);
    if (isBenched) setBenched({ ...benched, [currentPlayer]: already.filter(c => c.uid !== uid) });
    else if (already.length < 4) {
      const card = hands[currentPlayer][cat].find(c => c.uid === uid);
      if (card) setBenched({ ...benched, [currentPlayer]: [...already, card] });
    }
  };

  const confirmShorthanded = () => {
    const selected = benched[currentPlayer] || [];
    if (selected.length !== 4) { alert('You must bench exactly 4 cards'); return; }
    sounds.click();
    const used = [...usedShorthanded];
    used[currentPlayer] = true;
    setUsedShorthanded(used);
    const shortThisRound = [...shorthandedThisRound];
    shortThisRound[currentPlayer] = true;
    setShorthandedThisRound(shortThisRound);

    if (shorthandedQueue.length > 0) {
      const [next, ...rest] = shorthandedQueue;
      setShorthandedQueue(rest);
      setCurrentPlayer(next);
      setIsReady(false);
    } else {
      setGamePhase('playing');
      setCurrentPlayer(0);
      setIsReady(false);
    }
  };


  // Auto-run deal, then go to category (no cutscene gate)
  useEffect(() => {
    if (gamePhase !== 'dealing') return undefined;
    setIsShuffling(true);
    runDealAnimation();
    const t1 = setTimeout(() => setIsShuffling(false), 700);
    const t2 = setTimeout(() => {
      setGamePhase('category');
      setIsReady(true);
    }, 1100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamePhase]);

  // Choreographed reveal: gather → shuffle → spread (face-down) → flip one-by-one → vote
  useEffect(() => {
    if (gamePhase !== 'reveal') return undefined;
    if (revealPhase) {
      setRevealAnim('ready');
      return undefined;
    }
    let cancelled = false;
    const reduce = reduceMotion;
    setRevealAnim('gather');
    setRevealPhase(false);
    setIsRevealing(false);
    setRevealStep(0);

    const timers = [];
    const later = (fn, ms) => {
      const id = setTimeout(() => { if (!cancelled) fn(); }, ms);
      timers.push(id);
    };

    later(() => setRevealAnim('shuffle'), reduce ? 300 : 1100);
    later(() => setRevealAnim('spread'), reduce ? 650 : 2400);
    later(() => {
      setRevealAnim('flipping');
      setIsRevealing(true);
      setRevealStep(0);
      const n = Math.max(1, playedCards.length);
      const stepMs = reduce ? 100 : 700;
      let step = 0;
      const tick = () => {
        if (cancelled) return;
        step += 1;
        setRevealStep(step);
        sounds.flip();
        if (step < n) {
          later(tick, stepMs);
        } else {
          setRevealPhase(true);
          setIsRevealing(false);
          setRevealAnim('ready');
          sounds.ready();
          // Brief beat on the revealed row, then open voting (no extra click)
          later(() => {
            setGamePhase('voting');
            setCurrentPlayer(0);
            setIsReady(true);
          }, reduce ? 400 : 1400);
        }
      };
      later(tick, stepMs);
    }, reduce ? 900 : 3200);

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamePhase, playedCards.length]);

  // ========== PLAY ==========
  const advanceAfterPlay = (newPlayed) => {
    if (newPlayed.length === playerCount) {
      setRevealPhase(false);
      setRevealAnim('gather');
      setGamePhase('reveal');
      setCurrentPlayer(0);
      setIsReady(true);
    } else {
      setCurrentPlayer(currentPlayer + 1);
      setIsReady(false);
    }
  };

  const playCard = (card) => {
    if (gamePhase !== 'playing') return;
    if (isOnline && !isHost) {
      netSend('play_card', { card });
      return;
    }
    if (card.injury > 0) return;
    if (card.category !== currentPrompt.category) return;
    if ((benched[currentPlayer] || []).find(c => c.uid === card.uid)) return;

    sounds.play();
    setJustPlayedUid(card.uid);
    setTimeout(() => setJustPlayedUid(null), 400);
    setHoveredCategory(null);
    setHoveredCardUid(null);

    const newPlayed = [...playedCards, { playerIndex: currentPlayer, card }];
    setPlayedCards(newPlayed);

    const newHands = [...hands];
    newHands[currentPlayer] = {
      ...newHands[currentPlayer],
      [card.category]: newHands[currentPlayer][card.category].filter(c => c.uid !== card.uid)
    };
    setHands(newHands);
    advanceAfterPlay(newPlayed);
  };

  const passNoLegalCard = () => {
    if (gamePhase !== 'playing') return;
    if (isOnline && !isHost) {
      netSend('pass', {});
      return;
    }
    sounds.click();
    const passCard = {
      uid: makeUid('pass'),
      text: '(No legal card — pass)',
      category: currentPrompt.category,
      injury: 0,
      passed: true
    };
    const newPlayed = [...playedCards, { playerIndex: currentPlayer, card: passCard, passed: true }];
    setPlayedCards(newPlayed);
    setHoveredCategory(null);
    advanceAfterPlay(newPlayed);
  };

  // ========== OVERTIME ==========
  const startOvertime = (tiedPlayerIndices) => {
    sounds.tie();
    setTimeout(() => sounds.otSting(), 180);
    let otList = allData.prompts.overtime || [];
    if (!otList.length) otList = FALLBACK_OT;
    const used = usedPromptIds.overtime || [];
    let pool = otList.filter(p => !used.includes(p.id));
    if (!pool.length) pool = otList;
    const prompt = pool[Math.floor(Math.random() * pool.length)];
    setUsedPromptIds(prev => ({
      ...prev,
      overtime: [...(prev.overtime || []).filter(id => id !== prompt.id), prompt.id]
    }));

    setOvertimePlayers(tiedPlayerIndices);
    setOvertimePrompt(prompt);
    setOvertimeAnswers({});
    setOvertimeAnswerOrder([]);
    setOvertimeVotes({});
    setOvertimeTally({});
    setOvertimeReveal(false);
    setCurrentOTWriter(0);
    setTempOTAnswer('');
    setOriginalShorthanded([...shorthandedThisRound]);
    setResolvedByOvertime(false);
    setFinalOTData(null);
    setGamePhase('tieNotice');
    setIsReady(true);
  };

  const submitOTAnswer = () => {
    const answer = tempOTAnswer.trim();
    if (!answer) { alert('Please enter an answer'); return; }
    sounds.click();
    const writerIdx = overtimePlayers[currentOTWriter];
    const newAnswers = { ...overtimeAnswers, [writerIdx]: answer };
    setOvertimeAnswers(newAnswers);
    setTempOTAnswer('');
    if (currentOTWriter + 1 < overtimePlayers.length) {
      setCurrentOTWriter(currentOTWriter + 1);
      setIsReady(false);
    } else {
      setOvertimeAnswerOrder(shuffle([...overtimePlayers]));
      setOvertimeReveal(false);
      setGamePhase('overtimeReveal');
      setIsReady(true);
    }
  };

  const getOTVoters = () => {
    if (overtimePlayers.length === 2) {
      return Array.from({ length: playerCount }, (_, i) => i).filter(i => !overtimePlayers.includes(i));
    }
    return Array.from({ length: playerCount }, (_, i) => i);
  };

  const resolveJumpBall = () => {
    sounds.win();
    setJumpBallAnim(true);
    setTimeout(() => {
      const winner = overtimePlayers[Math.floor(Math.random() * overtimePlayers.length)];
      setJumpBallAnim(false);
      awardPoint(winner, true);
    }, 900);
  };

  const castOTVote = (answerPlayerIndex) => {
    if (answerPlayerIndex === currentPlayer) return;
    if (overtimeVotes[currentPlayer] !== undefined) return;
    if (overtimePlayers.length === 2 && overtimePlayers.includes(currentPlayer)) return;

    sounds.vote();
    const newVotes = { ...overtimeVotes, [currentPlayer]: answerPlayerIndex };
    setOvertimeVotes(newVotes);

    const votersNeeded = getOTVoters();
    if (votersNeeded.length === 0) {
      resolveJumpBall();
      return;
    }

    if (Object.keys(newVotes).length < votersNeeded.length) {
      const remaining = votersNeeded.filter(i => newVotes[i] === undefined);
      setCurrentPlayer(remaining[0]);
      setIsReady(false);
      return;
    }

    const voteTally = {};
    Object.values(newVotes).forEach(v => { voteTally[v] = (voteTally[v] || 0) + 1; });
    setOvertimeTally(voteTally);

    let maxVotes = 0;
    let winners = [];
    Object.entries(voteTally).forEach(([pIdx, count]) => {
      if (count > maxVotes) { maxVotes = count; winners = [parseInt(pIdx, 10)]; }
      else if (count === maxVotes) winners.push(parseInt(pIdx, 10));
    });

    if (winners.length === 1) awardPoint(winners[0], true);
    else startOvertime(winners);
  };

  const awardPoint = (playerIndex, fromOvertime = false) => {
    sounds.win();
    const pts = fromOvertime
      ? (originalShorthanded[playerIndex] ? 2 : 1)
      : (shorthandedThisRound[playerIndex] ? 2 : 1);
    const newScores = [...scores];
    newScores[playerIndex] += pts;
    setScores(newScores);
    triggerChipFly(playerIndex, pts);

    if (fromOvertime) {
      setResolvedByOvertime(true);
      setFinalOTData({
        prompt: overtimePrompt,
        answers: { ...overtimeAnswers },
        order: [...overtimeAnswerOrder],
        tally: { ...overtimeTally },
        winner: playerIndex
      });
    } else {
      setResolvedByOvertime(false);
      setFinalOTData(null);
      const origIdx = playedCards.findIndex(p => p.playerIndex === playerIndex);
      setWinnerIndex(origIdx >= 0 ? origIdx : 0);
    }

    if (newScores[playerIndex] >= targetScore) setGamePhase('gameOver');
    else setGamePhase('results');
  };

  // ========== STAGGERED REVEAL ==========
  const startStaggeredReveal = () => {
    if (isRevealing) return;
    sounds.flip();
    setIsRevealing(true);
    setRevealAnim('flipping');
    setRevealStep(0);
    const n = playedCards.length || 1;
    const stepMs = reduceMotion ? 80 : 480;
    let step = 0;
    const tick = () => {
      step += 1;
      setRevealStep(step);
      if (step < n) {
        sounds.flip();
        setTimeout(tick, stepMs);
      } else {
        setRevealPhase(true);
        setIsRevealing(false);
        setRevealAnim('ready');
        sounds.ready();
      }
    };
    setTimeout(tick, stepMs);
  };

  // ========== VOTING ==========
  const castVote = (playedIndex) => {
    if (playedCards[playedIndex].playerIndex === currentPlayer) return;
    if (votes[currentPlayer] !== undefined) return;
    if (isOnline && !isHost) {
      netSend('vote', { playedIndex });
      return;
    }
    sounds.vote();
    const newVotes = { ...votes, [currentPlayer]: playedIndex };
    setVotes(newVotes);

    if (Object.keys(newVotes).length === playerCount) {
      sounds.voteLock();
      const voteTally = {};
      Object.values(newVotes).forEach(v => { voteTally[v] = (voteTally[v] || 0) + 1; });
      setTally(voteTally);

      let maxVotes = 0;
      let winners = [];
      Object.entries(voteTally).forEach(([idx, count]) => {
        if (count > maxVotes) { maxVotes = count; winners = [parseInt(idx, 10)]; }
        else if (count === maxVotes) winners.push(parseInt(idx, 10));
      });

      if (winners.length === 1) {
        const winningCardIndex = winners[0];
        const winningPlayer = playedCards[winningCardIndex].playerIndex;
        setWinnerIndex(winningCardIndex);
        const pts = shorthandedThisRound[winningPlayer] ? 2 : 1;
        const newScores = [...scores];
        newScores[winningPlayer] += pts;
        setScores(newScores);
        setResolvedByOvertime(false);
        setFinalOTData(null);
        sounds.win();
        triggerChipFly(winningPlayer, pts);
        if (newScores[winningPlayer] >= targetScore) setGamePhase('gameOver');
        else setGamePhase('results');
      } else {
        startOvertime(winners.map(i => playedCards[i].playerIndex));
      }
    } else {
      setCurrentPlayer(currentPlayer + 1);
      setIsReady(false);
    }
  };

  // ========== NEXT ROUND ==========
  const nextRound = () => {
    sounds.click();

    if (Object.keys(benched).length > 0) {
      const newHands = [...hands];
      Object.entries(benched).forEach(([pIdx, cards]) => {
        const cat = currentPrompt?.category;
        if (cat) newHands[pIdx][cat] = [...newHands[pIdx][cat], ...cards];
      });
      setHands(newHands);
      setBenched({});
    }

    // Discard played cards (non-pass) into discard piles
    let nextDiscards = { ...discards };
    let nextDecks = { ...decks };
    if (currentPrompt && playedCards.length) {
      const cat = currentPrompt.category;
      const toDiscard = playedCards
        .filter(p => !p.passed && !p.card.passed)
        .map(p => {
          const { uid, ...rest } = p.card;
          return rest;
        });
      nextDiscards = {
        ...nextDiscards,
        [cat]: [...(nextDiscards[cat] || []), ...toDiscard]
      };
    }

    const dealtThisRound = {};
    if (currentPrompt) {
      const category = currentPrompt.category;
      const newHands = hands.map((hand, pIdx) => {
        let categoryCards = (hand[category] || [])
          .map(c => {
            if (c.injury > 0) {
              const newInjury = c.injury - 1;
              if (newInjury === 0) return null;
              return { ...c, injury: newInjury };
            }
            return c;
          })
          .filter(Boolean);

        const need = Math.max(0, 7 - categoryCards.length);
        const result = drawFromDeck(nextDecks, nextDiscards, category, need);
        nextDecks = result.decks;
        nextDiscards = result.discards;
        if (result.drawn.length) dealtThisRound[pIdx] = result.drawn;
        return { ...hand, [category]: [...categoryCards, ...result.drawn] };
      });
      setHands(newHands);
      setDecks(nextDecks);
      setDiscards(nextDiscards);
    }

    setPendingNewCards(dealtThisRound);
    setPlayedCards([]);
    setRoundNumber(r => r + 1);
    setCurrentCoach((currentCoach + 1) % playerCount);
    setGamePhase('dealing');
    setCurrentPrompt(null);
    setVotes({});
    setTally({});
    setWinnerIndex(null);
    setCurrentPlayer(0);
    setShorthandedThisRound(Array(playerCount).fill(false));
    setShorthandedDeclared([]);
    setShorthandedQueue([]);
    setRevealPhase(false);
    setRevealStep(0);
    setIsRevealing(false);
    setOvertimePlayers([]);
    setOvertimeAnswers({});
    setResolvedByOvertime(false);
    setFinalOTData(null);
    setIsReady(true);
    setIsShuffling(true);
    runDealAnimation();
    setTimeout(() => setIsShuffling(false), 700);
  };

  // ========== TABLE SHAPE / SEATS ==========
  /**
   * Seat 0 at bottom; then counter-clockwise.
   * orientDeg rotates the seat so local +X is tangent (decks lay orthogonal to the radius from center).
   * Name/chips are counter-rotated so labels stay upright.
   */
  const getSeatLayout = (index) => {
    const count = playerCount;
    const round = tableShape !== 'football';
    // Near the rim — close to the edge without clipping decks off the felt
    const rx = round ? 38 : 42;
    const ry = round ? 38 : 35;
    const angle = (Math.PI / 2) + (index * 2 * Math.PI) / count;
    const x = 50 + rx * Math.cos(angle);
    const y = 50 + ry * Math.sin(angle);
    const orientDeg = (angle * 180) / Math.PI - 90;
    return {
      position: {
        left: `${x}%`,
        top: `${y}%`,
        right: 'auto',
        bottom: 'auto',
        transform: `translate(-50%, -50%) rotate(${orientDeg}deg)`,
      },
      orientDeg,
    };
  };

  // ========== TABLE ==========

  const MiniPlayerSeat = ({ idx, side = 'top', interactiveDecks = false }) => {
    const name = getName(idx);
    const played = playedCards.find(p => p.playerIndex === idx);
    const isCoachPick = gamePhase === 'category' && idx === currentCoach;
    const isTurn =
      isCoachPick ||
      (idx === currentPlayer &&
        ['playing', 'voting', 'shorthandedSelect', 'overtimeWriting', 'overtimeVoting', 'freeAgency'].includes(gamePhase));
    const score = scores[idx] ?? 0;
    const counts = {
      player: hands[idx]?.player?.length || 0,
      team: hands[idx]?.team?.length || 0,
      moment: hands[idx]?.moment?.length || 0,
    };
    const showCommit = played && gamePhase === 'playing';
    return (
      <div
        className={[
          'ms',
          `ms-${side}`,
          isTurn ? 'ms-turn' : '',
          isCoachPick ? 'ms-coach' : '',
          interactiveDecks ? 'ms-self' : '',
        ].filter(Boolean).join(' ')}
        style={{ '--hue': playerHue(idx) }}
      >
        <div className="ms-id">
          <span className={`ms-name ${isCoachPick ? 'name-breathe' : ''}`}>
            {name}{interactiveDecks ? ' (you)' : ''}
          </span>
          {gamePhase === 'voting' && votes[idx] !== undefined && (
            <span className="ms-vote-in">Vote is in</span>
          )}
          <div className="ms-chips" title={`${score} pts`}>
            <ChipStack count={score} />
          </div>
        </div>
        <div className="ms-decks">
          {['player', 'team', 'moment'].map(cat => (
            <button
              key={cat}
              type="button"
              className={[
                'ms-deck',
                cat,
                interactiveDecks ? 'ms-deck-live' : '',
                interactiveDecks && hoveredCategory === cat ? 'ms-deck-on' : '',
              ].filter(Boolean).join(' ')}
              disabled={!interactiveDecks}
              title={`${cat}: ${counts[cat]}`}
              onClick={() => interactiveDecks && setHoveredCategory(cat)}
              onMouseEnter={() => interactiveDecks && setHoveredCategory(cat)}
            >
              <span>{counts[cat]}</span>
            </button>
          ))}
        </div>
        {showCommit && (
          <div className={`ms-commit ${justPlayedUid === played.card.uid ? 'ms-commit-in' : ''}`}>
            <GameCard card={played.card} flipped size="table" disabled />
          </div>
        )}
      </div>
    );
  };

  const TableBoard = ({
    decksClickable = false,
    showPromptText = true,
    showCenterPlayed = false,
    centerFaceDown = true,
    centerShowVote = false,
    centerShowResults = false,
    showPromptArrow = false,
  }) => {
    const selfIdx = isOnline && mySeat != null ? mySeat : 0;
    const opp = Array.from({ length: playerCount }, (_, i) => i).filter(i => i !== selfIdx);

    let topIdxs = [];
    let leftIdxs = [];
    let rightIdxs = [];
    if (opp.length === 1) topIdxs = [opp[0]];
    else if (opp.length === 2) {
      leftIdxs = [opp[0]];
      rightIdxs = [opp[1]];
    } else if (opp.length === 3) {
      leftIdxs = [opp[0]];
      topIdxs = [opp[1]];
      rightIdxs = [opp[2]];
    } else if (opp.length >= 4) {
      leftIdxs = opp.slice(0, Math.ceil((opp.length - 2) / 2));
      topIdxs = opp.slice(leftIdxs.length, leftIdxs.length + 2);
      rightIdxs = opp.slice(leftIdxs.length + topIdxs.length);
    }

    const drawCount =
      (decks.player?.length || 0) + (decks.team?.length || 0) + (decks.moment?.length || 0);
    const discardCount =
      (discards.player?.length || 0) + (discards.team?.length || 0) + (discards.moment?.length || 0);

    return (
      <div className="live-table-scroll">
        <div className="live-table">
          <div className="live-table-felt" aria-hidden />

          <div className="lt-top">
            {topIdxs.map(i => (
              <MiniPlayerSeat key={i} idx={i} side="top" />
            ))}
          </div>

          <div className="lt-mid">
            <div className="lt-side lt-left">
              {leftIdxs.map(i => (
                <MiniPlayerSeat key={i} idx={i} side="left" />
              ))}
            </div>

            <div className="lt-center">
              <div className="lt-supply">
                <div className="lt-pile">
                  <div className="lt-deck lt-draw"><span>{drawCount}</span></div>
                  <span className="lt-cap">Draw</span>
                </div>
                <div className="lt-pile">
                  <div className={`lt-deck lt-discard ${discardCount ? '' : 'empty'}`}>
                    <span>{discardCount || ''}</span>
                  </div>
                  <span className="lt-cap">Discard</span>
                </div>
              </div>

              <div className="lt-prompts">
                {showPromptArrow && (
                  <div className="lt-arrow" aria-hidden>
                    <svg viewBox="0 0 72 28">
                      <path d="M10 5 Q36 26 62 5" fill="none" stroke="#facc15" strokeWidth="3" strokeLinecap="round" />
                      <path d="M54 4 L64 5 L56 13" fill="none" stroke="#facc15" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
                <div className="lt-prompts-label">Prompt cards</div>
                <div className="lt-prompts-row">
                  {['moment', 'player', 'team'].map(cat => (
                    <button
                      key={cat}
                      type="button"
                      className={`lt-pile lt-prompt ${cat} ${decksClickable ? 'live' : ''} ${currentPrompt?.category === cat ? 'on' : ''}`}
                      disabled={!decksClickable}
                      onClick={() => decksClickable && chooseCategory(cat)}
                    >
                      <div className={`lt-deck prompt-${cat}`} />
                      <span className={`lt-cap ${cat}`}>{cat}</span>
                    </button>
                  ))}
                </div>
              </div>

              {showPromptText && currentPrompt && (
                <div className={`lt-prompt-banner cat-${currentPrompt.category}`}>
                  <span>{currentPrompt.category}</span>
                  <p>{currentPrompt.text}</p>
                </div>
              )}

              {showCenterPlayed && playedCards.length > 0 && (
                <div className={`lt-played reveal-${revealAnim || 'ready'} ${(centerShowVote || centerShowResults || revealPhase || ['spread','flipping','ready'].includes(revealAnim)) ? 'big' : ''}`}>
                  {centerOrder.map((origIdx, i) => {
                    const p = playedCards[origIdx];
                    const isOwn = centerShowVote && p.playerIndex === currentPlayer;
                    const voteCount = centerShowResults ? (tally[origIdx] || 0) : 0;
                    const isWinner = centerShowResults && origIdx === winnerIndex;
                    let faceDown = true;
                    if (centerShowResults || revealAnim === 'ready' || gamePhase === 'voting') faceDown = false;
                    else if (revealAnim === 'flipping') faceDown = i >= revealStep;
                    else if (['gather', 'shuffle', 'spread'].includes(revealAnim)) faceDown = true;
                    else faceDown = !!centerFaceDown;
                    const canVote = centerShowVote && !isOwn && !faceDown;
                    return (
                      <div
                        key={p.card.uid}
                        className={`lt-played-item ${isWinner ? 'winner-pulse' : ''} ${canVote ? 'can-vote' : ''} ${isOwn ? 'is-own' : ''}`}
                        onClick={() => canVote && castVote(origIdx)}
                        role={canVote ? 'button' : undefined}
                        tabIndex={canVote ? 0 : undefined}
                      >
                        <GameCard
                          card={p.card}
                          flipped={faceDown}
                          size={['spread', 'flipping', 'ready'].includes(revealAnim) || gamePhase === 'voting' || centerShowResults ? 'reveal' : 'table'}
                          showOwner={!!centerShowResults}
                          ownerName={centerShowResults ? getName(p.playerIndex) : undefined}
                          disabled={!canVote}
                        />
                        {centerShowResults && (
                          <div className="stage-vote-count">
                            {voteCount} vote{voteCount !== 1 ? 's' : ''}
                            {isWinner && <span className="text-yellow-400 font-black"> WIN</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="lt-side lt-right">
              {rightIdxs.map(i => (
                <MiniPlayerSeat key={i} idx={i} side="right" />
              ))}
            </div>
          </div>

          <div className="lt-bottom">
            <MiniPlayerSeat idx={selfIdx} side="bottom" interactiveDecks />
          </div>
        </div>
      </div>
    );
  };

  const PassScreen = ({ playerIdx, actionLabel }) => {
    // ---------- ONLINE ----------
    if (isOnline) {
      const mine = mySeat === playerIdx;
      if (!mine) {
        // Someone else's private turn — just wait
        return (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 text-center bg-zinc-950/95">
            <div className="w-10 h-10 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-zinc-400 text-sm uppercase tracking-widest mb-2">Waiting</p>
            <h2 className="text-3xl font-black mb-2" style={{ color: playerHue(playerIdx) }}>{getName(playerIdx)}</h2>
            <p className="text-zinc-500 max-w-sm">{actionLabel}</p>
          </div>
        );
      }
      // My turn — no pass gate, go straight to the real UI
      if (!isReady) {
        return <OnlineSelfReady onReady={() => setIsReady(true)} />;
      }
      return null;
    }
    // ---------- LOCAL (pass-the-device) ----------

    const hue = playerHue(playerIdx);
    const startHold = () => {
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
      setHoldProgress(0);
      const start = Date.now();
      holdTimerRef.current = setInterval(() => {
        const p = Math.min(1, (Date.now() - start) / 650);
        setHoldProgress(p);
        if (p >= 1) {
          clearInterval(holdTimerRef.current);
          holdTimerRef.current = null;
          setHoldProgress(0);
          sounds.ready();
          setIsReady(true);
        }
      }, 30);
    };
    const endHold = () => {
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
      setHoldProgress(0);
    };
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 text-center scale-in pass-screen"
        style={{
          background: `radial-gradient(ellipse 80% 60% at 50% 40%, ${hue}33 0%, #09090b 55%, #09090b 100%)`,
        }}
      >
        <div className="pass-pulse" style={{ borderColor: hue, boxShadow: `0 0 60px ${hue}55` }} />
        <div className="mb-6" style={{ color: hue }}>
          <PassIcon className="w-16 h-16 mx-auto mb-3 opacity-90" />
        </div>
        <p className="text-zinc-400 text-sm uppercase tracking-[0.2em] mb-2">Pass the device</p>
        <h2 className="text-4xl md:text-5xl font-black mb-3 tracking-tight" style={{ color: hue }}>
          {getName(playerIdx)}
        </h2>
        <p className="text-zinc-400 mb-10 max-w-sm text-base">{actionLabel}</p>
        <button
          type="button"
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          className="pass-hold-btn relative overflow-hidden px-12 py-5 text-black text-lg font-bold rounded-2xl btn-press"
          style={{ background: hue }}
        >
          <span className="relative z-10">
            {holdProgress > 0 ? 'Keep holding…' : ('Hold — I\u2019m ' + getName(playerIdx))}
          </span>
          <span
            className="pass-hold-fill"
            style={{ width: `${holdProgress * 100}%`, background: 'rgba(0,0,0,0.2)' }}
          />
        </button>
        <p className="text-zinc-600 text-xs mt-4">Hold to prevent accidental reveal</p>
      </div>
    );
  };

  if (!cardsLoaded) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xl text-zinc-400">Loading the debate cards…</p>
      </div>
    );
  }

  const otVoters = getOTVoters();

  const showArena = gamePhase !== 'setup';

  return (
    <div className={`min-h-screen text-white relative ${showArena ? 'has-arena' : 'bg-zinc-950'}`}>
      {showArena && (
        <div
          className={`arena-backdrop theme-${visualTheme} ${videoBg && !videoFailed ? 'mode-video' : 'mode-stills'}`}
          aria-hidden
        >
          {/* Video only mounts when toggle is ON and file loads */}
          {videoBg && !videoFailed && (
            <video
              key={`vid-${visualTheme}-${activeVideo}`}
              className="arena-video"
              src={activeVideo}
              poster={activeSlides[0]}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              onError={() => setVideoFailed(true)}
            />
          )}
          {/* Stills: always available; animated only as fallback when video fails */}
          {(!videoBg || videoFailed) && (
            activeSlides.map((src, i) => (
              <div
                key={src}
                className={`arena-slide ${videoFailed ? 'animated' : 'static'} ${i === arenaSlide % activeSlides.length ? 'active' : ''}`}
                style={{ backgroundImage: `url(${src})` }}
              />
            ))
          )}
          <div className="arena-vignette" />
          <div className="arena-grain" />
          {visualTheme === 'broadcast' && <div className="arena-scanlines" />}
        </div>
      )}

      {flyingChips.map(chip => (
        <div
          key={chip.id}
          className="chip chip-fly relative z-50"
          style={{
            left: '50%',
            top: '40%',
            '--tx': `${(Math.random() - 0.5) * 200}px`,
            '--ty': `${100 + Math.random() * 80}px`,
            animationDelay: `${chip.delay}ms`
          }}
        />
      ))}

      <header className="sticky top-0 z-40 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/80 px-4 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <TrophyIcon className="w-8 h-8 text-yellow-400" />
            <h1 className="text-xl md:text-2xl font-black tracking-tight">
              G.O.A.T. <span className="text-yellow-400">DEBATE</span>
            </h1>
          </div>
          {gamePhase !== 'setup' && gamePhase !== 'gameOver' && (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-zinc-500">Round {roundNumber}</span>
              <span className="hidden sm:inline text-zinc-600">•</span>
              <span className="text-zinc-400">First to {targetScore}</span>
            </div>
          )}
        </div>
      </header>

      {/* PWA install banner */}
      {showInstallBanner && installPrompt && gamePhase === 'setup' && (
        <div className="install-banner relative z-40">
          <span>Install G.O.A.T. Debate on your home screen</span>
          <div className="install-banner-actions">
            <button type="button" className="install-btn" onClick={async () => {
              installPrompt.prompt();
              const choice = await installPrompt.userChoice;
              setInstallPrompt(null);
              setShowInstallBanner(false);
              if (choice?.outcome === 'accepted') sounds.click();
            }}>Install</button>
            <button type="button" className="install-dismiss" onClick={() => setShowInstallBanner(false)}>Not now</button>
          </div>
        </div>
      )}

      {/* Persistent match HUD */}

      {/* First-time rule tip */}
      {activeTip && TIP_COPY[activeTip] && (
        <div className="tip-toast relative z-50" role="status">
          <div className="tip-toast-inner">
            <div className="tip-toast-title">{TIP_COPY[activeTip].title}</div>
            <p className="tip-toast-body">{TIP_COPY[activeTip].body}</p>
            <button type="button" className="tip-toast-ok" onClick={dismissTip}>Got it</button>
          </div>
        </div>
      )}

      <main className="relative z-10 max-w-5xl mx-auto px-4 py-6 pb-28">
        {gamePhase === 'setup' && (
          <div className="setup-hero scale-in">
            <div className="setup-bg" aria-hidden>
              {SETUP_SLIDES.map((src, i) => (
                <div
                  key={src}
                  className={`setup-bg-slide ${i === setupSlide ? 'active' : ''}`}
                  style={{ backgroundImage: `url(${src})` }}
                />
              ))}
            </div>
            <div className="setup-bg-overlay" />
            <div className="setup-bg-grain" />

            <audio ref={themeAudioRef} src="/audio/theme.mp3" loop preload="none" />
            <button
              type="button"
              className={`setup-music-btn ${musicOn ? '' : 'muted'}`}
              onClick={toggleThemeMusic}
              title={musicOn ? 'Mute theme' : 'Play theme'}
            >
              {musicOn ? '♪ Theme On' : '♪ Theme Off'}
            </button>

            <div className="setup-content">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-yellow-500/15 border border-yellow-500/30 mb-3">
                  <TrophyIcon className="w-8 h-8 text-yellow-400" />
                </div>
                <h2 className="text-3xl md:text-4xl font-black mb-1.5 setup-title-glow tracking-tight">
                  G.O.A.T. <span className="text-yellow-400">DEBATE</span>
                </h2>
                <p className="text-zinc-300/85 text-sm tracking-wide">
                  Pass-and-play • One device
                </p>
              </div>

              <div className="setup-panel">
                {/* Players — only for local mode */}
                {playMode === 'local' && (
                <div className="setup-section">
                  <div className="setup-section-label">Players</div>
                  <div className="setup-segment">
                    {[3, 4, 5, 6].map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { sounds.click(); setPlayerCount(n); }}
                        className={`setup-segment-btn ${playerCount === n ? 'active' : ''}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                )}

                {/* Target score */}
                <div className="setup-section">
                  <div className="setup-section-label">First to</div>
                  <div className="setup-segment">
                    {[3, 5, 7].map(n => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { sounds.click(); setTargetScore(n); }}
                        className={`setup-segment-btn ${targetScore === n ? 'active' : ''}`}
                      >
                        {n} pts
                      </button>
                    ))}
                  </div>
                </div>

                {/* Names — only for local mode */}
                {playMode === 'local' && (
                <div className="setup-section">
                  <div className="setup-section-label">Names</div>
                  <div className="setup-names">
                    {Array.from({ length: playerCount }).map((_, i) => (
                      <div key={i} className="setup-name-row">
                        <span className="setup-name-index">{i + 1}</span>
                        <input
                          type="text"
                          value={playerNames[i]}
                          onChange={(e) => {
                            const n = [...playerNames];
                            n[i] = e.target.value;
                            setPlayerNames(n);
                          }}
                          placeholder={`Player ${i + 1}`}
                          className="setup-name-input"
                        />
                      </div>
                    ))}
                  </div>
                </div>
                )}

                {/* How to play (compact) */}
                <button
                  type="button"
                  onClick={() => { sounds.click(); setShowHowTo(!showHowTo); }}
                  className="setup-link-btn"
                >
                  {showHowTo ? 'Hide How to Play' : 'How to Play'}
                </button>
                {showHowTo && (
                  <div className="setup-howto scale-in">
                    <p><strong>Table:</strong> Coach picks a deck → play face-down → center reveal → anonymous vote.</p>
                    <p><strong>Hand:</strong> Hover category to fan; hover card to lift; click to play.</p>
                    <p><strong>Ties → Overtime</strong> (Jump Ball if only two players).</p>
                  </div>
                )}

                {/* Start button */}
                {playMode === 'local' && (
                  <button type="button" onClick={startGame} className="setup-cta">
                    START THE DEBATE
                  </button>
                )}
                {playMode === 'online' && netStatus.roomCode && netStatus.isHost && (
                  <button
                    type="button"
                    onClick={startGame}
                    className="setup-cta"
                    disabled={(netStatus.players || []).filter(p => p.connected).length < 2}
                  >
                    {(netStatus.players || []).filter(p => p.connected).length < 2
                      ? 'Waiting for players…'
                      : `START THE DEBATE (${(netStatus.players || []).filter(p => p.connected).length} players)`}
                  </button>
                )}

                {/* Multiplayer */}
                <div className="setup-section">
                  <div className="setup-section-label">Play mode</div>
                  <div className="setup-segment">
                    <button type="button" className={`setup-segment-btn ${playMode === 'local' ? 'active' : ''}`}
                      onClick={() => { sounds.click(); setPlayMode('local'); }}>Local</button>
                    <button type="button" className={`setup-segment-btn ${playMode === 'online' ? 'active' : ''}`}
                      onClick={() => { sounds.click(); setPlayMode('online'); }}>Online</button>
                  </div>
                </div>

                {playMode === 'online' && (
                  <div className="setup-section net-lobby">
                    <div className="setup-section-label">
                      Multiplayer {netStatus.connected ? <span className="net-dot on">live</span> : <span className="net-dot">connecting…</span>}
                    </div>
                    {netStatus.error && <p className="text-red-400 text-xs mb-2">{netStatus.error}</p>}
                    {!netStatus.roomCode ? (
                      <div className="net-lobby-forms">
                        <input
                          className="net-input"
                          placeholder="Your name"
                          value={lobbyName}
                          onChange={e => setLobbyName(e.target.value)}
                          maxLength={18}
                        />
                        <button
                          type="button"
                          className="net-btn primary"
                          onClick={() => {
                            sounds.click();
                            const n = lobbyName.trim() || 'Host';
                            setLobbyName(n);
                            netRef.current?.createRoom(n);
                          }}
                        >
                          Create room
                        </button>
                        <div className="net-or">or join</div>
                        <div className="net-join-row">
                          <input
                            className="net-input code"
                            placeholder="CODE"
                            value={joinCode}
                            onChange={e => setJoinCode(e.target.value.toUpperCase())}
                            maxLength={6}
                          />
                          <button
                            type="button"
                            className="net-btn"
                            onClick={() => {
                              sounds.click();
                              const n = lobbyName.trim() || 'Player';
                              netRef.current?.joinRoom(joinCode, n);
                            }}
                          >
                            Join
                          </button>
                        </div>
                        {import.meta.env.DEV && (
                          <p className="net-hint">Dev server: ws://localhost:3847</p>
                        )}
                      </div>
                    ) : (
                      <div className="net-room">
                        <div className="net-code-display">
                          Room <strong>{netStatus.roomCode}</strong>
                          {netStatus.isHost ? ' · Host' : ` · Seat ${(netStatus.seat ?? 0) + 1}`}
                        </div>
                        <ul className="net-player-list">
                          {(netStatus.players || []).map(p => (
                            <li key={p.id} className={p.connected ? '' : 'off'}>
                              <span style={{ color: playerHue(p.seat) }}>{p.name}</span>
                              {p.isHost && ' 👑'}
                              {!p.connected && ' (away)'}
                            </li>
                          ))}
                        </ul>
                        {netStatus.isHost ? (
                          <p className="net-hint">
                            {(netStatus.players || []).filter(p => p.connected).length < 2
                              ? 'Share the room code — need at least 2 players'
                              : 'Everyone is here. Press START when ready.'}
                          </p>
                        ) : (
                          <p className="net-hint">Waiting for host to start the debate…</p>
                        )}

                        {/* Voice chat (Daily.co scaffold) */}
                        <div className="mt-4 pt-3 border-t border-zinc-800">
                          <button
                            type="button"
                            className={`net-btn w-full ${voiceOn ? 'primary' : ''}`}
                            onClick={() => {
                              sounds.click();
                              const room = netStatus.roomCode;
                              if (!room) return;
                              // Opens a Daily.co room named after the game room code.
                              // Create a free account at https://daily.co and set your domain if you want custom branding.
                              const url = `https://goat-debate.daily.co/${room}`;
                              window.open(url, 'goat-voice', 'width=420,height=640');
                              setVoiceOn(true);
                            }}
                          >
                            {voiceOn ? 'Voice room opened' : 'Join Voice Chat'}
                          </button>
                          <p className="net-hint mt-1">Opens a shared voice room for this game code</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Bottom settings entry */}
                <button
                  type="button"
                  className="setup-settings-entry"
                  onClick={() => { sounds.click(); setShowSettings(true); }}
                >
                  <span className="setup-settings-icon" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </span>
                  <span>Settings</span>
                  <span className="setup-settings-badge">
                    {tableShape[0].toUpperCase() + tableShape.slice(1)} · {visualTheme} · {Object.values(options).filter(Boolean).length}/4
                  </span>
                </button>
              </div>
            </div>

            {/* Settings bottom sheet */}
            {showSettings && (
              <div className="settings-sheet-root" role="dialog" aria-modal="true" aria-label="Settings">
                <button
                  type="button"
                  className="settings-sheet-backdrop"
                  aria-label="Close settings"
                  onClick={() => { sounds.click(); setShowSettings(false); }}
                />
                <div className="settings-sheet scale-in">
                  <div className="settings-sheet-handle" />
                  <div className="settings-sheet-header">
                    <h3>Settings</h3>
                    <button
                      type="button"
                      className="settings-sheet-done"
                      onClick={() => { sounds.click(); setShowSettings(false); }}
                    >
                      Done
                    </button>
                  </div>

                  <p className="settings-sheet-sub">Table shape (felt skin matches)</p>
                  <div className="shape-picker">
                    {[
                      { id: 'football', label: 'Football' },
                      { id: 'basketball', label: 'Basketball' },
                      { id: 'baseball', label: 'Baseball' },
                      { id: 'soccer', label: 'Soccer' },
                    ].map(s => (
                      <button
                        key={s.id}
                        type="button"
                        className={`shape-picker-btn ${tableShape === s.id ? 'active' : ''}`}
                        onClick={() => { sounds.select(); setTableShape(s.id); }}
                      >
                        <span className={`shape-preview shape-preview-${s.id}`} aria-hidden />
                        <span>{s.label}</span>
                      </button>
                    ))}
                  </div>

                  <p className="settings-sheet-sub" style={{ marginTop: '1rem' }}>Backdrop theme</p>
                  <div className="shape-picker theme-picker">
                    {[
                      { id: 'arena', label: 'Arena' },
                      { id: 'broadcast', label: 'Broadcast' },
                      { id: 'memorabilia', label: 'Memorabilia' },
                    ].map(s => (
                      <button
                        key={s.id}
                        type="button"
                        className={`shape-picker-btn ${visualTheme === s.id ? 'active' : ''}`}
                        onClick={() => { sounds.select(); setVisualTheme(s.id); }}
                      >
                        <span className={`theme-swatch theme-swatch-${s.id}`} aria-hidden />
                        <span>{s.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="settings-list" style={{ marginTop: '0.75rem' }}>
                    <div className="settings-row">
                      <div className="settings-row-text">
                        <div className="settings-row-label">Video loops</div>
                        <div className="settings-row-desc">
                          {videoBg
                            ? (videoFailed
                              ? 'ON — video missing, showing animated stills'
                              : 'ON — playing muted MP4 for this theme')
                            : 'OFF — static theme photos only (no motion)'}
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={videoBg}
                        className={`toggle-switch ${videoBg ? 'on' : ''}`}
                        onClick={() => { sounds.select(); setVideoBg(v => !v); }}
                      >
                        <span className="toggle-knob" />
                      </button>
                    </div>
                  </div>

                  <p className="settings-sheet-sub" style={{ marginTop: '1rem' }}>Optional rules — all start on</p>
                  <div className="settings-list">
                    {[
                      { key: 'freeAgency', label: 'Free Agency', desc: 'Deal 10 cards, discard 3 — keep a sharper hand' },
                      { key: 'trades', label: 'Trades', desc: 'Until round 5. Spend 1 point to redraw a category' },
                      { key: 'shorthanded', label: 'Shorthanded', desc: 'Once per game: bench 4 cards, win the round for 2 pts' },
                      { key: 'injured', label: 'Playing Injured', desc: 'Injury cards in the deck — sit out for 1–3 rounds' },
                    ].map(opt => (
                      <div key={opt.key} className="settings-row">
                        <div className="settings-row-text">
                          <div className="settings-row-label">{opt.label}</div>
                          <div className="settings-row-desc">{opt.desc}</div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={options[opt.key]}
                          className={`toggle-switch ${options[opt.key] ? 'on' : ''}`}
                          onClick={() => {
                            sounds.select();
                            setOptions({ ...options, [opt.key]: !options[opt.key] });
                          }}
                        >
                          <span className="toggle-knob" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {gamePhase === 'tableIntro' && (
          <div className="py-6 text-center relative">
            {introFlash && <div className="table-intro-flash" aria-hidden />}
            <div className={`table-enter ${introFlash ? 'is-entering' : ''}`}>
              <TableBoard decksClickable={false} showPromptText={false} />
            </div>

            <div className="intro-dialog-root">
              <div className="intro-dialog scale-in">
                <div className="intro-dialog-badge">Welcome to the Table</div>
                <h2 className="intro-dialog-title">
                  {options.freeAgency ? 'Free Agency is On' : 'Cards Are Ready'}
                </h2>
                {options.freeAgency ? (
                  <p className="intro-dialog-body">
                    Each player will be dealt <strong>10 cards</strong> in every category
                    (<span className="text-zinc-500"> (30 total)</span>.
                    Keep <strong>7 per category</strong> — the rest return to the deck.
                    Then the coach picks the first prompt.
                  </p>
                ) : (
                  <p className="intro-dialog-body">
                    Each player is dealt <strong>7 cards</strong> in every category.
                    Coach <strong className="text-yellow-400">{getName(currentCoach)}</strong> may begin
                    by selecting a prompt deck on the table.
                  </p>
                )}
                <button type="button" onClick={continueFromTableIntro} className="intro-dialog-cta">
                  {options.freeAgency ? 'Begin Free Agency →' : 'Deal Cards →'}
                </button>
              </div>
            </div>
          </div>
        )}

        {gamePhase === 'freeAgency' && (
          <>
            {!isReady ? (
              <PassScreen
                playerIdx={freeAgencyStep.player}
                actionLabel="Free Agency — keep 7 cards in each category (Player, Team, Moment)"
              />
            ) : (
              <div className="scale-in fa-screen">
                <div className="text-center mb-4 sticky top-0 z-20 py-3 bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-400 text-sm font-medium mb-2">
                    Free Agency
                  </div>
                  <h2 className="text-xl font-bold">{getName(freeAgencyStep.player)}</h2>
                  <p className="text-zinc-400 text-sm mt-1">
                    Tap cards to <span className="text-emerald-400 font-semibold">keep</span> — choose exactly 7 in each category
                  </p>
                  <div className="flex justify-center gap-3 mt-2 text-xs font-bold">
                    {['player', 'team', 'moment'].map(cat => {
                      const n = (tempHands[cat] || []).filter(c => c.selected).length;
                      const ok = n === 7;
                      return (
                        <span key={cat} className={`px-2.5 py-1 rounded-full capitalize ${ok ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-400'}`}>
                          {cat}: {n}/7
                        </span>
                      );
                    })}
                  </div>
                </div>

                {['player', 'team', 'moment'].map(cat => (
                  <div key={cat} className="fa-category-block">
                    <div className={`fa-category-header fa-header-${cat}`}>
                      <span className="capitalize">{cat}</span>
                      <span className="fa-category-count">
                        {(tempHands[cat] || []).filter(c => c.selected).length}/7 kept
                      </span>
                    </div>
                    <div className="fa-card-grid">
                      {(tempHands[cat] || []).map(card => (
                        <div
                          key={card.uid}
                          onClick={() => toggleFreeAgencyCard(cat, card.uid)}
                          className={`fa-card-wrap ${card.selected ? 'is-kept' : ''}`}
                        >
                          <GameCard card={card} selected={!!card.selected} size="hand" />
                          <span className={`fa-card-tag ${card.selected ? 'kept' : 'out'}`}>
                            {card.selected ? 'KEEP' : 'Tap to keep'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="fa-confirm-bar">
                  <button
                    onClick={confirmFreeAgency}
                    className="px-8 py-3.5 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-2xl btn-press shadow-lg shadow-yellow-500/20"
                  >
                    Confirm Hand
                    <span className="ml-2 text-black/60 text-sm font-semibold">
                      ({['player', 'team', 'moment'].map(c => (tempHands[c] || []).filter(x => x.selected).length).join(' · ')} / 7)
                    </span>
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {gamePhase === 'dealing' && (
          <div className="py-4 text-center scale-in">
            <p className="text-yellow-400 text-sm font-bold tracking-wide uppercase mb-3">Dealing cards…</p>
            <TableBoard decksClickable={false} showPromptText={false} />
          </div>
        )}

        {gamePhase === 'category' && (
          <div className="py-4 scale-in">
            <div className="text-center mb-2">
              <p className="text-sm text-zinc-400">
                Coach — <span className="name-breathe font-bold" style={{ color: playerHue(currentCoach) }}>{getName(currentCoach)}</span>
                {' '}picks a prompt
              </p>
            </div>
            <TableBoard decksClickable showPromptText={false} showPromptArrow />
          </div>
        )}

        {gamePhase === 'tradeWindow' && (
          <div className="text-center py-6 scale-in">
            <TableBoard showPromptText />
            <h2 className="text-xl font-bold mt-4 mb-1">Trade Window</h2>
            <p className="text-zinc-500 text-sm mb-2">Round {roundNumber} • Costs 1 point • Optional</p>
            <p className="text-zinc-600 text-xs mb-6">
              {isOnline
                ? 'Each player decides on their own device, then taps Done'
                : 'Each player chooses, then marks Done — Continue when all ready'}
            </p>
            <div className="space-y-3 max-w-md mx-auto mb-6">
              {Array.from({ length: playerCount }).map((_, i) => {
                const isMe = !isOnline || mySeat === i;
                const ready = phaseReady[i];
                const canAct = isMe && !ready && (isHost || !isOnline || mySeat === i);
                return (
                  <div
                    key={i}
                    className={`bg-zinc-900 rounded-xl p-4 border ${ready ? 'border-emerald-500/40' : 'border-zinc-800'} ${isMe ? 'ring-1 ring-yellow-500/30' : 'opacity-80'}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-left">
                        <div className="font-semibold" style={{ color: playerHue(i) }}>{getName(i)}{isMe ? ' (you)' : ''}</div>
                        <div className="text-xs text-zinc-500">{scores[i]} pts{tradeUsedThisRound[i] ? ' · traded' : ''}</div>
                      </div>
                      {ready ? (
                        <span className="text-emerald-400 text-sm font-medium">Ready ✓</span>
                      ) : (
                        <span className="text-zinc-500 text-xs">Deciding…</span>
                      )}
                    </div>
                    {canAct && (
                      <div className="flex flex-wrap gap-1.5 justify-end items-center">
                        {!tradeUsedThisRound[i] && ['player', 'team', 'moment'].map(cat => (
                          <button
                            key={cat}
                            type="button"
                            disabled={scores[i] < 1}
                            onClick={() => {
                              if (isOnline && !isHost) {
                                netSend('trade', { category: cat });
                                return;
                              }
                              doTrade(i, cat);
                            }}
                            className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30 rounded-lg text-xs capitalize font-medium btn-press"
                          >
                            {cat}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            sounds.click();
                            if (isOnline && !isHost) {
                              netSend('trade_done', {});
                              // optimistic local ready marker for UI
                              markPhaseReady(i);
                              return;
                            }
                            markPhaseReady(i);
                          }}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-bold btn-press"
                        >
                          Done
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="text-zinc-500 text-sm mb-3">
              Ready {phaseReady.filter(Boolean).length}/{playerCount}
            </div>
            {!isOnline && (
              <button
                type="button"
                onClick={finishTradeWindow}
                disabled={!allPhaseReady()}
                className="px-10 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 font-bold rounded-2xl btn-press"
              >
                {allPhaseReady() ? 'Continue →' : 'Waiting for everyone…'}
              </button>
            )}
            {isOnline && allPhaseReady() && (
              <p className="text-emerald-400 text-sm font-medium">All ready — advancing…</p>
            )}
          </div>
        )}

        {gamePhase === 'shorthandedDeclare' && (
          <div className="text-center py-6 scale-in">
            <TableBoard showPromptText />
            <h2 className="text-xl font-bold mt-4 mb-2">Going Shorthanded?</h2>
            <p className="text-zinc-500 text-sm mb-4">
              {isOnline
                ? 'Only toggle for yourself, then tap Done'
                : 'Each player chooses for themselves, then Done'}
            </p>
            <div className="space-y-3 max-w-md mx-auto mb-6">
              {Array.from({ length: playerCount }).map((_, i) => {
                const isMe = !isOnline || mySeat === i;
                const ready = phaseReady[i];
                const on = shorthandedDeclared.includes(i);
                const used = usedShorthanded[i];
                return (
                  <div
                    key={i}
                    className={`bg-zinc-900 rounded-xl p-4 border ${ready ? 'border-emerald-500/40' : 'border-zinc-800'} ${isMe ? 'ring-1 ring-yellow-500/30' : 'opacity-80'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-left">
                        <div className="font-semibold" style={{ color: playerHue(i) }}>{getName(i)}{isMe ? ' (you)' : ''}</div>
                        <div className="text-xs text-zinc-500">
                          {used ? 'Already used this game' : on ? 'Shorthanded this round' : 'Full roster'}
                        </div>
                      </div>
                      {ready ? (
                        <span className="text-emerald-400 text-sm font-medium">Ready ✓</span>
                      ) : isMe && !used ? (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (isOnline && !isHost) {
                                netSend('short_toggle', {});
                                // optimistic
                                setShorthandedDeclared(prev =>
                                  prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]
                                );
                                return;
                              }
                              toggleShorthandedDeclare(i);
                            }}
                            className={`px-3 py-2 rounded-lg text-xs font-bold btn-press ${on ? 'bg-orange-600' : 'bg-zinc-800'}`}
                          >
                            {on ? 'Shorthanded ON' : 'Stay full'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              sounds.click();
                              if (isOnline && !isHost) {
                                netSend('short_done', {});
                                markPhaseReady(i);
                                return;
                              }
                              markPhaseReady(i);
                            }}
                            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-bold btn-press"
                          >
                            Done
                          </button>
                        </div>
                      ) : used ? (
                        <span className="text-zinc-500 text-xs">Used</span>
                      ) : (
                        <span className="text-zinc-500 text-xs">Deciding…</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-zinc-500 text-sm mb-3">
              Ready {phaseReady.filter(Boolean).length}/{playerCount}
            </div>
            {!isOnline && (
              <button
                type="button"
                onClick={finishShorthandedDeclare}
                disabled={!allPhaseReady()}
                className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded-xl font-medium btn-press"
              >
                {allPhaseReady()
                  ? (shorthandedDeclared.length ? `Continue (${shorthandedDeclared.length} shorthanded)` : 'No one — Continue')
                  : 'Waiting for everyone…'}
              </button>
            )}
            {isOnline && allPhaseReady() && (
              <p className="text-emerald-400 text-sm font-medium">All ready — advancing…</p>
            )}
          </div>
        )}

        {gamePhase === 'shorthandedSelect' && (
          <>
            {!isReady ? (
              <PassScreen playerIdx={currentPlayer} actionLabel="Bench exactly 4 cards." />
            ) : (
              <div className="scale-in">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/15 text-orange-400 text-sm font-medium mb-3">Shorthanded</div>
                  <h2 className="text-2xl font-bold">{getName(currentPlayer)}</h2>
                  <p className="text-zinc-400 mt-1">Bench exactly 4 cards</p>
                  {shorthandedQueue.length > 0 && (
                    <p className="text-zinc-600 text-xs mt-1">{shorthandedQueue.length} more player(s) after you</p>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                  {hands[currentPlayer]?.[currentPrompt.category]?.map(card => {
                    const isBenched = (benched[currentPlayer] || []).find(c => c.uid === card.uid);
                    return (
                      <div key={card.uid} onClick={() => toggleBench(card.uid)} className={`cursor-pointer ${isBenched ? 'ring-2 ring-orange-500 scale-[1.02]' : ''}`}>
                        <GameCard card={card} selected={!!isBenched} />
                        {isBenched && <p className="text-center text-orange-400 text-xs mt-2">Benched</p>}
                      </div>
                    );
                  })}
                </div>
                <div className="text-center">
                  <button onClick={confirmShorthanded} className="px-10 py-4 bg-orange-600 hover:bg-orange-500 font-bold rounded-2xl btn-press">
                    Confirm Bench ({(benched[currentPlayer] || []).length}/4)
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {gamePhase === 'playing' && currentPrompt && (
          <>
            {!isReady ? (
              <PassScreen playerIdx={currentPlayer} actionLabel={`Play a ${currentPrompt.category} card`} />
            ) : pendingNewCards[currentPlayer]?.length > 0 ? (
              <div className="py-10 max-w-2xl mx-auto scale-in">
                <div className="text-center mb-8">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-yellow-500/10 text-yellow-400 text-sm font-medium mb-3">New Cards</div>
                  <h2 className="text-2xl font-bold">{getName(currentPlayer)}</h2>
                  <p className="text-zinc-400 mt-1">You received {pendingNewCards[currentPlayer].length} new card{pendingNewCards[currentPlayer].length !== 1 ? 's' : ''}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
                  {pendingNewCards[currentPlayer].map((card, i) => (
                    <GameCard key={card.uid} card={card} disabled flyIn delayClass={`reveal-delay-${Math.min(i, 5)}`} />
                  ))}
                </div>
                <div className="text-center">
                  <button
                    onClick={() => {
                      sounds.click();
                      setPendingNewCards(prev => {
                        const next = { ...prev };
                        delete next[currentPlayer];
                        return next;
                      });
                    }}
                    className="px-10 py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-2xl btn-press"
                  >
                    Got it — Continue
                  </button>
                </div>
              </div>
            ) : (
              <div className="scale-in">
                <TableBoard showPromptText showSeatPlayed />

                <div className="text-center mt-3">
                  <h3 className="text-lg font-bold">
                    {getName(currentPlayer)}
                    <span className="text-zinc-400 font-normal"> — Your turn</span>
                  </h3>
                  {shorthandedThisRound[currentPlayer] && (
                    <p className="text-orange-400 text-sm mt-0.5">Playing Shorthanded</p>
                  )}
                  <p className="text-zinc-500 text-xs mt-1">Hover category → fan • Hover card → lift • Click to play</p>
                </div>

                {getPlayableCards(currentPlayer, currentPrompt.category).length === 0 && (
                  <div className="text-center my-4 p-4 bg-zinc-900 border border-orange-500/30 rounded-xl max-w-md mx-auto">
                    <p className="text-orange-300 text-sm mb-3">No legal cards in <span className="capitalize">{currentPrompt.category}</span> (injured or benched).</p>
                    <button onClick={passNoLegalCard} className="px-6 py-3 bg-orange-600 hover:bg-orange-500 font-bold rounded-xl btn-press">
                      Pass — No Legal Card
                    </button>
                  </div>
                )}

                <div className="category-tabs your-decks hand-deck-fallback">
                  {['player', 'team', 'moment'].map(cat => {
                    const count = hands[currentPlayer]?.[cat]?.length || 0;
                    const isActive = hoveredCategory === cat;
                    const isCorrect = cat === currentPrompt.category;
                    return (
                      <button
                        key={cat}
                        type="button"
                        className={`category-tab deck-tab ${isActive ? `active ${cat}` : ''} ${isCorrect ? 'correct' : ''}`}
                        onMouseEnter={() => setHoveredCategory(cat)}
                        onClick={() => setHoveredCategory(cat)}
                      >
                        <span className={`tab-deck-art ${cat}`} aria-hidden />
                        <span className="tab-deck-meta">
                          <span className="tab-deck-name">{cat}</span>
                          <span className="tab-deck-count">{count}</span>
                        </span>
                        {isCorrect && <span className="tab-deck-playable">Play from here</span>}
                      </button>
                    );
                  })}
                </div>

                <div className="hand-area player-hand-dock">
                  {hoveredCategory && hands[currentPlayer]?.[hoveredCategory] ? (
                    <div className="card-fan">
                      {hands[currentPlayer][hoveredCategory].map((card, idx, arr) => {
                        const total = arr.length;
                        const mid = (total - 1) / 2;
                        const offset = idx - mid;
                        const rotate = offset * layoutConfig.handFanRotate;
                        const translateX = offset * layoutConfig.handFanSpread;
                        const isInjured = card.injury > 0;
                        const isBenched = (benched[currentPlayer] || []).find(b => b.uid === card.uid);
                        const canPlay = hoveredCategory === currentPrompt.category && !isInjured && !isBenched;

                        return (
                          <div
                            key={card.uid}
                            className={`fan-card ${canPlay ? 'playable' : 'disabled'}`}
                            style={{
                              transform: `translateX(${translateX}px) rotate(${rotate}deg)`,
                              zIndex: hoveredCardUid === card.uid ? 80 : 10 + idx,
                            }}
                            onMouseEnter={() => setHoveredCardUid(card.uid)}
                            onMouseLeave={() => setHoveredCardUid(null)}
                            onClick={() => canPlay && playCard(card)}
                          >
                            <div className="fan-card-inner">
                              <GameCard
                                card={card}
                                selected={justPlayedUid === card.uid}
                                disabled={!canPlay}
                                size="hand"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-zinc-600 text-sm">Tap a category above to see your cards</p>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {gamePhase === 'reveal' && (
          <div className="py-4 scale-in">
            <div className="text-center mb-2 min-h-[2.75rem]">
              {revealAnim === 'ready' ? (
                <h2 className="text-xl font-black text-yellow-400 vote-dialog-title">Vote for the best card</h2>
              ) : (
                <div className="h-6" aria-hidden />
              )}
            </div>
            <div className={`reveal-stage anim-${revealAnim}`}>
              <TableBoard
                showPromptText={false}
                showCenterPlayed
                centerFaceDown={revealAnim === 'gather' || revealAnim === 'shuffle' || revealAnim === 'spread' || (revealAnim === 'flipping' && !revealPhase)}
                centerShowVote={revealAnim === 'ready'}
              />
            </div>
          </div>
        )}

        {gamePhase === 'voting' && (
          <div className="py-4 scale-in">
            <div className="vote-dialog">
              <h2 className="vote-dialog-title">Cast your vote</h2>
              <p className="vote-dialog-sub">
                <span className="name-breathe" style={{ color: playerHue(currentPlayer) }}>{getName(currentPlayer)}</span>
                {' '}— choose the best answer
              </p>
              <p className="vote-dialog-hint">Tap a card · you can’t vote for your own</p>
            </div>
            <TableBoard
              showPromptText={false}
              showCenterPlayed
              centerFaceDown={false}
              centerShowVote
            />
          </div>
        )}

        {gamePhase === 'tieNotice' && (
          <div className="py-16 text-center max-w-xl mx-auto tie-entrance">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-orange-500/15 text-orange-400 text-sm font-medium mb-6">TIE</div>
            <h2 className="text-4xl font-black text-yellow-400 mb-4">It&apos;s a Tie!</h2>
            <p className="text-zinc-400 text-lg mb-6">Heading to Overtime:</p>
            <div className="flex flex-wrap justify-center gap-3 mb-8">
              {overtimePlayers.map(pIdx => (
                <div key={pIdx} className="px-5 py-3 bg-zinc-900 border border-yellow-500/40 rounded-xl font-bold text-lg">{getName(pIdx)}</div>
              ))}
            </div>
            <button onClick={() => { sounds.click(); setGamePhase('overtimeWriting'); setIsReady(false); }} className="px-12 py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-2xl text-lg btn-press">
              Continue to Overtime →
            </button>
          </div>
        )}

        {gamePhase === 'overtimeWriting' && (
          <>
            {!isReady ? (
              <PassScreen playerIdx={overtimePlayers[currentOTWriter]} actionLabel="Overtime — write your answer" />
            ) : (
              <div className="max-w-xl mx-auto py-8 scale-in">
                <div className="text-center mb-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/15 text-orange-400 text-sm font-medium mb-3 ot-glow">OVERTIME</div>
                  <h2 className="text-2xl font-bold">{getName(overtimePlayers[currentOTWriter])}</h2>
                </div>
                <div className="bg-zinc-900 border border-yellow-500/30 rounded-2xl p-5 mb-6 text-center">
                  <p className="text-lg font-medium">{overtimePrompt?.text}</p>
                </div>
                <textarea
                  value={tempOTAnswer}
                  onChange={(e) => setTempOTAnswer(e.target.value)}
                  placeholder="Type your answer..."
                  rows={4}
                  className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl focus:outline-none focus:border-yellow-500/60 text-white resize-none"
                />
                <button onClick={submitOTAnswer} className="w-full mt-4 py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-2xl btn-press">
                  Submit Answer
                </button>
              </div>
            )}
          </>
        )}

        {gamePhase === 'overtimeReveal' && (
          <div className="py-6 scale-in">
            <div className="text-center mb-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/15 text-orange-400 text-sm font-medium mb-2 ot-glow">OVERTIME</div>
              <h2 className="text-2xl font-black text-yellow-400 mb-1">{overtimeReveal ? 'Answers Revealed' : 'Answers Are In'}</h2>
              <p className="text-zinc-500 text-sm">{overtimePrompt?.text}</p>
            </div>
            <div className="center-played mb-6" style={{ position: 'relative' }}>
              {overtimeAnswerOrder.map((pIdx, i) => (
                <div key={pIdx} className="center-played-item">
                  <AnswerCard
                    text={overtimeAnswers[pIdx]}
                    flipped={!overtimeReveal}
                    label={overtimeReveal ? getName(pIdx) : ''}
                    flyIn
                    delayClass={`reveal-delay-${Math.min(i, 5)}`}
                  />
                </div>
              ))}
            </div>
            <div className="text-center">
              {!overtimeReveal ? (
                <button onClick={() => { sounds.flip(); setOvertimeReveal(true); }} className="px-10 py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-2xl btn-press">
                  Reveal Answers
                </button>
              ) : otVoters.length === 0 ? (
                <div className={jumpBallAnim ? 'jump-ball-anim' : ''}>
                  <p className="text-zinc-400 text-sm mb-4 max-w-sm mx-auto">
                    Only the tied players remain — no outside voters. The ref calls a <span className="text-yellow-400 font-semibold">Jump Ball</span>.
                  </p>
                  <button onClick={resolveJumpBall} className="px-10 py-4 bg-orange-600 hover:bg-orange-500 font-bold rounded-2xl btn-press">
                    Jump Ball 🏀
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    sounds.click();
                    setCurrentPlayer(otVoters[0]);
                    setOvertimeVotes({});
                    setGamePhase('overtimeVoting');
                    setIsReady(false);
                  }}
                  className="px-10 py-4 bg-emerald-600 hover:bg-emerald-500 font-bold rounded-2xl btn-press"
                >
                  Start Voting →
                </button>
              )}
            </div>
          </div>
        )}

        {gamePhase === 'overtimeVoting' && (
          <>
            {!isReady ? (
              <PassScreen playerIdx={currentPlayer} actionLabel="Overtime vote — pick the best answer" />
            ) : (
              <div className="py-6 scale-in">
                <div className="text-center mb-4">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/15 text-orange-400 text-sm font-medium mb-2 ot-glow">OVERTIME VOTE</div>
                  <h2 className="text-2xl font-black text-yellow-400 mb-1">{getName(currentPlayer)} is voting</h2>
                  <p className="text-zinc-500 text-sm">{overtimePrompt?.text}</p>
                </div>
                <div className="center-played">
                  {overtimeAnswerOrder.map((pIdx) => {
                    const isOwn = pIdx === currentPlayer;
                    const blocked = overtimePlayers.length === 2 && overtimePlayers.includes(currentPlayer);
                    return (
                      <div key={pIdx} className="center-played-item">
                        <AnswerCard
                          text={overtimeAnswers[pIdx]}
                          disabled={isOwn || blocked}
                          label={isOwn ? 'Your answer' : ''}
                          className={isOwn || blocked ? 'opacity-40 grayscale' : ''}
                        />
                        {!isOwn && !blocked && (
                          <button onClick={() => castOTVote(pIdx)} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-lg text-xs btn-press">
                            Vote
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {gamePhase === 'results' && (
          <div className="text-center py-6 scale-in">
            <div className="recap-card mx-auto mb-6">
              <div className="recap-label">{resolvedByOvertime ? 'Overtime Result' : 'Round Recap'}</div>
              <div className="recap-winner">
                {resolvedByOvertime && finalOTData
                  ? getName(finalOTData.winner)
                  : (winnerIndex != null && playedCards[winnerIndex]
                    ? getName(playedCards[winnerIndex].playerIndex)
                    : '—')}
              </div>
              <div className="recap-sub">takes the point{shorthandedThisRound[
                resolvedByOvertime && finalOTData
                  ? finalOTData.winner
                  : (playedCards[winnerIndex]?.playerIndex ?? 0)
              ] ? 's (Shorthanded ×2)' : ''}</div>
              {currentPrompt && (
                <div className={`recap-prompt cat-${currentPrompt.category}`}>
                  <span className="recap-cat">{currentPrompt.category}</span>
                  {currentPrompt.text}
                </div>
              )}
              <div className="recap-scores">
                {scores.map((s, i) => (
                  <div key={i} className="recap-score-row">
                    <span style={{ color: playerHue(i) }}>{getName(i)}</span>
                    <ChipStack count={s} />
                  </div>
                ))}
              </div>
            </div>
            {!resolvedByOvertime && (
              <TableBoard
                showPromptText
                showCenterPlayed
                centerFaceDown={false}
                centerShowResults
              />
            )}
            {resolvedByOvertime && finalOTData && (
              <div className="center-played mb-4">
                {finalOTData.order.map((pIdx) => {
                  const voteCount = finalOTData.tally[pIdx] || 0;
                  const isWinner = pIdx === finalOTData.winner;
                  return (
                    <div key={pIdx} className={`center-played-item ${isWinner ? 'winner-pulse' : ''}`}>
                      <AnswerCard text={finalOTData.answers[pIdx]} label={getName(pIdx)} disabled />
                      <div className="text-sm">
                        <span className="font-bold">{voteCount} vote{voteCount !== 1 ? 's' : ''}</span>
                        {isWinner && <span className="ml-1 text-yellow-400 font-black text-xs">WIN</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <button onClick={nextRound} className="mt-8 px-12 py-4 bg-emerald-600 hover:bg-emerald-500 text-lg font-bold rounded-2xl btn-press">
              Next Round →
            </button>
          </div>
        )}

        {gamePhase === 'gameOver' && (
          <div className="text-center py-12 scale-in">
            <TrophyIcon className="w-20 h-20 text-yellow-400 mx-auto mb-4" />
            <h2 className="text-4xl font-black text-yellow-400 mb-2">G.O.A.T.!</h2>
            <p className="text-zinc-400 mb-8">The debate is settled</p>
            <div className="bg-zinc-900 rounded-2xl p-6 max-w-sm mx-auto mb-10 border border-yellow-500/30">
              {scores
                .map((s, i) => ({ score: s, name: getName(i), idx: i }))
                .sort((a, b) => b.score - a.score)
                .map((p, rank) => (
                  <div key={p.idx} className={`flex justify-between items-center py-2.5 ${rank === 0 ? 'text-yellow-400 font-bold text-lg' : 'text-zinc-300'}`}>
                    <span>{rank === 0 ? '👑 ' : `${rank + 1}. `}{p.name}</span>
                    <span>{p.score}</span>
                  </div>
                ))}
            </div>
            <button
              onClick={() => {
                sounds.click();
                setGamePhase('setup');
                setHands([]);
                setScores([]);
                setRoundNumber(1);
                setPlayedCards([]);
              }}
              className="px-10 py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-2xl btn-press"
            >
              Play Again
            </button>
          </div>
        )}
      </main>

      {gamePhase !== 'setup' && gamePhase !== 'gameOver' && gamePhase !== 'freeAgency' && gamePhase !== 'tableIntro' && (
        <div className={`bottom-tray ${bottomBarOpen ? 'is-open' : 'is-closed'}`}>
          <button
            type="button"
            className="bottom-tray-grip"
            aria-label={bottomBarOpen ? 'Hide menu' : 'Show menu'}
            onClick={() => { sounds.click(); setBottomBarOpen(v => !v); }}
          >
            <span className="bottom-tray-grip-bar" />
          </button>
          <div className="bottom-tray-panel">
            <button
              type="button"
              className="bottom-tray-end"
              onClick={() => { sounds.click(); requestAppFullscreen(); }}
            >
              Full Screen
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm('End the game now and show final standings?')) {
                  sounds.click();
                  setGamePhase('gameOver');
                }
              }}
              className="bottom-tray-end"
            >
              End Game
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
