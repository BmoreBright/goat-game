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
        if (payload?.category) chooseCategory(payload.category);
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

    // Enter dealing (or free agency if enabled) — no tableIntro cutscene
    setFreeAgencyStep({ player: 0 });
    if (options.freeAgency) {
      const h0 = newHands[0];
      setTempHands({
        player: (h0.player || []).map(c => ({ ...c, selected: false })),
        team: (h0.team || []).map(c => ({ ...c, selected: false })),
        moment: (h0.moment || []).map(c => ({ ...c, selected: false })),
      });
      setGamePhase('freeAgency');
      setIsReady(true);
      setTimeout(() => showRuleTip('freeAgency'), 400);
    } else {
      setTempHands({ player: [], team: [], moment: [] });
      setGamePhase('dealing');
      setIsReady(true);
      setIsShuffling(true);
      runDealAnimation();
      setTimeout(() => setIsShuffling(false), 700);
    }
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
    if (isOnline && !isHost) {
      netSend('choose_category', { category });
      return;
    }
    // Online: only the coach seat should pick (host enforces)
    if (isOnline && isHost && mySeat != null && mySeat !== currentCoach) {
      // Host device may still be coach — allow if host is coach
    }
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
  }, [gamePhase]);

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
          {gamePhase === 'playing' && played && (
            <span className="ms-vote-in">Pick is in</span>
          )}
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
                <div className={`lt-active-prompt cat-${currentPrompt.category}`}>
                  <div className="lt-active-prompt-card">
                    <GameCard
                      card={currentPrompt}
                      flipped={false}
                      size="reveal"
                      disabled
                    />
                  </div>
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
            {showCenterPlayed && playedCards.length > 0 && (
              <div
                className={[
                  'lt-played',
                  `n-${playedCards.length}`,
                  `reveal-${revealAnim || 'ready'}`,
                  (centerShowVote || centerShowResults || revealPhase || gamePhase === 'voting' || gamePhase === 'reveal' || ['gather','shuffle','spread', 'flipping', 'ready'].includes(revealAnim)) ? 'big' : '',
                  playedCards.length <= 2 ? 'cols-2' : playedCards.length <= 4 ? 'cols-2' : 'cols-3',
                ].filter(Boolean).join(' ')}
              >
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
                  const justFlipped = revealAnim === 'flipping' && !faceDown && i === revealStep - 1;
                  const canVote = centerShowVote && !isOwn && !faceDown;
                  return (
                    <div
                      key={p.card.uid}
                      className={[
                        'lt-played-item',
                        isWinner ? 'winner-pulse' : '',
                        canVote ? 'can-vote' : '',
                        isOwn ? 'is-own' : '',
                        justFlipped ? 'just-flipped' : '',
                        faceDown ? 'is-face-down' : 'is-face-up',
                      ].filter(Boolean).join(' ')}
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
                        className={justFlipped ? 'flip-pop' : ''}
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
      </div>
    );
  };
  const PassScreen = ({ playerIdx, actionLabel }) => (
    <div className="pass-screen">
      <PassIcon className="w-14 h-14 text-yellow-500/80 mx-auto mb-3" />
      <h2 className="text-2xl font-black text-yellow-400 mb-1">Pass to {getName(playerIdx)}</h2>
      <p className="text-zinc-400 text-sm mb-6">{actionLabel}</p>
      <button
        type="button"
        className="px-10 py-3 bg-emerald-600 hover:bg-emerald-500 font-bold rounded-2xl btn-press"
        onClick={() => { sounds.click(); setIsReady(true); }}
      >
        I&apos;m {getName(playerIdx)} — continue
      </button>
    </div>
  );

  const selfIdx = isOnline && mySeat != null ? mySeat : 0;
  const handCats = ['player', 'team', 'moment'];
  const activeHand =
    gamePhase === 'playing' && currentPrompt
      ? (hands[selfIdx]?.[currentPrompt.category] || [])
      : hoveredCategory
        ? (hands[selfIdx]?.[hoveredCategory] || [])
        : [];

  const phaseDialogue = (() => {
    if (gamePhase === 'category') {
      return {
        title: 'Pick a prompt card',
        body: `${getName(currentCoach)} — select Player, Team, or Moment`,
      };
    }
    if (gamePhase === 'playing') {
      return {
        title: `${getName(currentPlayer)}'s turn`,
        body: currentPrompt
          ? `Play a ${currentPrompt.category} card that best matches the prompt`
          : 'Play a card',
      };
    }
    if (gamePhase === 'reveal') {
      if (revealAnim === 'ready') {
        return { title: 'Cast your vote', body: 'Pick the card that best matches the prompt' };
      }
      return { title: 'Revealing answers', body: 'Cards gather over the prompt decks' };
    }
    if (gamePhase === 'voting') {
      return {
        title: 'Cast your vote',
        body: `${getName(currentPlayer)} — choose the best answer (not your own)`,
      };
    }
    if (gamePhase === 'results') {
      const winP = winnerIndex != null && playedCards[winnerIndex]
        ? getName(playedCards[winnerIndex].playerIndex)
        : '—';
      return { title: `${winP} wins the round`, body: 'Points awarded · cards discarded' };
    }
    if (gamePhase === 'dealing') {
      return { title: `Begin Round ${roundNumber}`, body: 'Dealing new cards…' };
    }
    return null;
  })();

  // Open the matching hand category when play starts
  useEffect(() => {
    if (gamePhase === 'playing' && currentPrompt?.category) {
      setHoveredCategory(currentPrompt.category);
    }
  }, [gamePhase, currentPrompt?.category]);

  // Auto-advance results → nextRound (no click)
  useEffect(() => {
    if (gamePhase !== 'results') return undefined;
    const t = setTimeout(() => nextRound(), reduceMotion ? 1200 : 3200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gamePhase]);

  return (
    <div className={`app-shell theme-${visualTheme}`}>
      {/* Header */}
      <header className="app-header">
        <div className="app-brand">
          <span className="app-logo">🏆</span>
          <span className="app-title">G.O.A.T. <em>DEBATE</em></span>
        </div>
        {gamePhase !== 'setup' && (
          <div className="app-meta">
            {isOnline && netStatus.roomCode && (
              <span className="online-pill" title="Online room">
                Online · {netStatus.roomCode}
              </span>
            )}
            <span>Round {roundNumber} · First to {targetScore}</span>
          </div>
        )}
      </header>

      <main className="app-main">
        {/* SETUP */}
        {gamePhase === 'setup' && (
          <div className="setup-panel scale-in">
            <h1 className="text-3xl font-black text-yellow-400 mb-2">G.O.A.T. Debate</h1>
            <p className="text-zinc-400 mb-5">Sports arguments. Settled at the table.</p>

            {/* Mode: Local vs Online */}
            <div className="setup-block">
              <label className="setup-label">How are you playing?</label>
              <div className="mode-toggle">
                <button
                  type="button"
                  className={`mode-btn ${playMode === 'local' ? 'on' : ''}`}
                  onClick={() => { sounds.click(); setPlayMode('local'); }}
                >
                  <span className="mode-btn-title">Pass &amp; Play</span>
                  <span className="mode-btn-sub">One device · local</span>
                </button>
                <button
                  type="button"
                  className={`mode-btn ${playMode === 'online' ? 'on' : ''}`}
                  onClick={() => { sounds.click(); setPlayMode('online'); }}
                >
                  <span className="mode-btn-title">Online</span>
                  <span className="mode-btn-sub">Friends · any device</span>
                </button>
              </div>
            </div>

            {/* —— ONLINE LOBBY —— */}
            {playMode === 'online' && (
              <div className="online-lobby">
                <div className={`net-status ${netStatus.connected ? 'live' : 'down'}`}>
                  <span className="net-dot" />
                  {netStatus.connected ? 'Connected to server' : (netStatus.error || 'Connecting…')}
                </div>

                <div className="setup-block">
                  <label className="setup-label">Your name</label>
                  <input
                    className="setup-input"
                    placeholder="Enter your name"
                    value={lobbyName}
                    maxLength={18}
                    onChange={e => setLobbyName(e.target.value)}
                  />
                </div>

                {!netStatus.roomCode ? (
                  <div className="online-actions">
                    <button
                      type="button"
                      className="px-6 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold rounded-xl btn-press"
                      disabled={!netStatus.connected || !lobbyName.trim()}
                      onClick={() => {
                        sounds.click();
                        const name = lobbyName.trim() || 'Host';
                        netRef.current?.createRoom(name);
                      }}
                    >
                      Create room
                    </button>
                    <div className="online-join-row">
                      <input
                        className="setup-input join-code-input"
                        placeholder="Room code"
                        value={joinCode}
                        maxLength={6}
                        onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                      />
                      <button
                        type="button"
                        className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 font-bold rounded-xl btn-press"
                        disabled={!netStatus.connected || !joinCode.trim() || joinCode.trim().length < 4}
                        onClick={() => {
                          sounds.click();
                          const name = lobbyName.trim() || 'Player';
                          netRef.current?.joinRoom(joinCode.trim(), name);
                        }}
                      >
                        Join
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="room-panel">
                    <div className="room-code-row">
                      <span className="setup-label" style={{ margin: 0 }}>Room code</span>
                      <button
                        type="button"
                        className="room-code-pill"
                        title="Copy code"
                        onClick={() => {
                          sounds.click();
                          try {
                            navigator.clipboard?.writeText(netStatus.roomCode);
                          } catch { /* */ }
                        }}
                      >
                        {netStatus.roomCode}
                        <span className="room-code-hint">tap to copy</span>
                      </button>
                    </div>
                    <p className="text-zinc-500 text-xs mb-3">
                      Share this code with friends. {isHost ? 'You are the host.' : 'Waiting for host to start…'}
                    </p>
                    <ul className="lobby-players">
                      {(netStatus.players || []).map((p, i) => (
                        <li key={p.id || i} className={`lobby-player ${p.connected ? '' : 'off'} ${p.isHost ? 'host' : ''}`}>
                          <span className="lobby-seat">P{(p.seat ?? i) + 1}</span>
                          <span className="lobby-name">{p.name || `Player ${(p.seat ?? i) + 1}`}</span>
                          {p.isHost && <span className="lobby-badge">Host</span>}
                          {!p.connected && <span className="lobby-badge dim">Away</span>}
                          {netStatus.seat === p.seat && <span className="lobby-badge you">You</span>}
                        </li>
                      ))}
                    </ul>
                    {isHost ? (
                      <button
                        type="button"
                        className="mt-4 px-10 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-black rounded-2xl btn-press"
                        disabled={!cardsLoaded || (netStatus.players || []).filter(p => p.connected).length < 2}
                        onClick={() => { sounds.click(); startGame(); }}
                      >
                        {!cardsLoaded
                          ? 'Loading cards…'
                          : (netStatus.players || []).filter(p => p.connected).length < 2
                            ? 'Need at least 2 players'
                            : `Start game · ${(netStatus.players || []).filter(p => p.connected).length} players`}
                      </button>
                    ) : (
                      <p className="mt-4 text-sm text-zinc-400 font-medium">Waiting for host to start the game…</p>
                    )}
                    <button
                      type="button"
                      className="mt-3 text-xs text-zinc-500 underline"
                      onClick={() => {
                        sounds.click();
                        netRef.current?.disconnect();
                        setNetStatus(s => ({ ...s, roomCode: null, isHost: false, seat: null, players: [], error: null }));
                        // reconnect socket for a new room
                        setTimeout(() => {
                          if (playMode === 'online') {
                            setPlayMode('local');
                            setTimeout(() => setPlayMode('online'), 50);
                          }
                        }, 100);
                      }}
                    >
                      Leave room
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* —— LOCAL SETUP —— */}
            {playMode === 'local' && (
              <>
                <div className="setup-block">
                  <label className="setup-label">Players</label>
                  <div className="flex gap-2 flex-wrap justify-center">
                    {[3, 4, 5, 6].map(n => (
                      <button
                        key={n}
                        type="button"
                        className={`px-4 py-2 rounded-xl font-bold ${playerCount === n ? 'bg-yellow-500 text-black' : 'bg-zinc-800'}`}
                        onClick={() => { sounds.click(); setPlayerCount(n); }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setup-block">
                  <label className="setup-label">Names</label>
                  {Array.from({ length: playerCount }).map((_, i) => (
                    <input
                      key={i}
                      className="setup-input"
                      placeholder={`Player ${i + 1}`}
                      value={playerNames[i]}
                      onChange={e => {
                        const next = [...playerNames];
                        next[i] = e.target.value;
                        setPlayerNames(next);
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Shared options */}
            {(playMode === 'local' || (playMode === 'online' && isHost && netStatus.roomCode)) && (
              <>
                <div className="setup-block">
                  <label className="setup-label">First to</label>
                  <div className="flex gap-2 justify-center">
                    {[3, 5, 7, 10].map(n => (
                      <button
                        key={n}
                        type="button"
                        className={`px-3 py-2 rounded-xl font-bold ${targetScore === n ? 'bg-yellow-500 text-black' : 'bg-zinc-800'}`}
                        onClick={() => { sounds.click(); setTargetScore(n); }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="setup-block flex flex-wrap gap-3 justify-center text-sm">
                  {[
                    ['freeAgency', 'Free Agency'],
                    ['trades', 'Trades'],
                    ['shorthanded', 'Shorthanded'],
                    ['injured', 'Injured'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={options[key]}
                        onChange={() => setOptions(o => ({ ...o, [key]: !o[key] }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </>
            )}

            {playMode === 'local' && (
              <button
                type="button"
                className="mt-6 px-12 py-4 bg-yellow-500 hover:bg-yellow-400 text-black font-black rounded-2xl text-lg btn-press"
                disabled={!cardsLoaded}
                onClick={() => { sounds.click(); startGame(); }}
              >
                {cardsLoaded ? 'Start Game' : 'Loading cards…'}
              </button>
            )}
          </div>
        )}

        {/* In-game dialogue (sketches: text directs players) */}
        {gamePhase !== 'setup' && gamePhase !== 'gameOver' && phaseDialogue && (
          <div className="turn-dialog">
            <h2 className="turn-dialog-title">{phaseDialogue.title}</h2>
            <p className="turn-dialog-body">{phaseDialogue.body}</p>
          </div>
        )}

        {/* TABLE — always visible after setup */}
        {gamePhase !== 'setup' && gamePhase !== 'gameOver' && (
          <TableBoard
            decksClickable={gamePhase === 'category' && (!isOnline || isHost || mySeat === currentCoach)}
            showPromptText={!!currentPrompt && gamePhase !== 'category'}
            showCenterPlayed={['reveal', 'voting', 'results'].includes(gamePhase)}
            centerFaceDown={gamePhase === 'reveal' && !['ready', 'flipping'].includes(revealAnim)}
            centerShowVote={gamePhase === 'voting'}
            centerShowResults={gamePhase === 'results'}
            showPromptArrow={gamePhase === 'category'}
          />
        )}

        {/* HAND — only your decks expand below the table */}
        {gamePhase === 'playing' && isReady && (
          <div className="player-hand-dock">
            <div className="hand-deck-tabs">
              {handCats.map(cat => {
                const n = hands[selfIdx]?.[cat]?.length || 0;
                const isPromptCat = currentPrompt?.category === cat;
                const active = hoveredCategory === cat || (!hoveredCategory && isPromptCat);
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`hand-tab ${cat} ${active ? 'on' : ''} ${isPromptCat ? 'is-prompt-cat' : ''}`}
                    onClick={() => { sounds.select(); setHoveredCategory(cat); }}
                  >
                    <span className={`tab-deck-art ${cat}`} />
                    <span>{cat} · {n}</span>
                  </button>
                );
              })}
            </div>
            {(hoveredCategory || currentPrompt) && (
              <div className="hand-fan">
                {(hoveredCategory
                  ? hands[selfIdx]?.[hoveredCategory] || []
                  : hands[selfIdx]?.[currentPrompt.category] || []
                ).map(card => {
                  const cat = card.category;
                  const legal =
                    currentPrompt &&
                    cat === currentPrompt.category &&
                    !(card.injury > 0) &&
                    currentPlayer === selfIdx;
                  return (
                    <div
                      key={card.uid}
                      className={`hand-card-wrap ${hoveredCardUid === card.uid ? 'lifted' : ''} ${!legal ? 'dim' : ''}`}
                      onMouseEnter={() => setHoveredCardUid(card.uid)}
                      onMouseLeave={() => setHoveredCardUid(null)}
                    >
                      <GameCard
                        card={card}
                        size="hand"
                        disabled={!legal}
                        onClick={() => {
                          if (!legal) return;
                          if (isOnline && !isHost && mySeat !== currentPlayer) return;
                          playCard(card);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {currentPlayer !== selfIdx && !isOnline && (
              <div className="text-center mt-3">
                <button
                  type="button"
                  className="px-6 py-2 bg-zinc-800 rounded-xl text-sm"
                  onClick={() => { sounds.click(); setIsReady(false); }}
                >
                  Pass device to {getName(currentPlayer)}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Local pass-the-device for voting */}
        {gamePhase === 'voting' && !isOnline && !isReady && (
          <PassScreen playerIdx={currentPlayer} actionLabel="Vote for the best card (not your own)" />
        )}
        {gamePhase === 'playing' && !isOnline && !isReady && (
          <PassScreen playerIdx={currentPlayer} actionLabel="Play a card that matches the prompt" />
        )}

        {/* FREE AGENCY — keep 7 per category */}
        {gamePhase === 'freeAgency' && isReady && (
          <div className="setup-panel scale-in">
            <h2 className="text-xl font-black text-yellow-400 mb-1">Free Agency</h2>
            <p className="text-zinc-400 text-sm mb-4">{getName(freeAgencyStep.player)} — keep exactly 7 per category</p>
            {['player', 'team', 'moment'].map(cat => (
              <div key={cat} className="mb-4 text-left">
                <div className="text-xs font-bold uppercase tracking-wide text-zinc-500 mb-2">
                  {cat} · {(tempHands[cat] || []).filter(c => c.selected).length}/7 kept
                </div>
                <div className="flex flex-wrap gap-2 justify-center">
                  {(tempHands[cat] || []).map((card, i) => (
                    <button
                      key={card.uid || i}
                      type="button"
                      className={`px-2 py-1 rounded-lg text-xs border ${card.selected ? 'border-yellow-500 bg-yellow-500/15' : 'border-zinc-700 bg-zinc-900'}`}
                      onClick={() => {
                        sounds.select();
                        setTempHands(th => ({
                          ...th,
                          [cat]: th[cat].map((c, j) => j === i ? { ...c, selected: !c.selected } : c),
                        }));
                      }}
                    >
                      {card.text.slice(0, 28)}{card.text.length > 28 ? '…' : ''}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button
              type="button"
              className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 font-bold rounded-2xl btn-press"
              onClick={confirmFreeAgency}
            >
              Confirm keep 7
            </button>
          </div>
        )}
        {gamePhase === 'freeAgency' && !isReady && !isOnline && (
          <PassScreen playerIdx={freeAgencyStep.player} actionLabel="Free Agency — keep 7 cards per category" />
        )}

        {/* GAME OVER */}
        {gamePhase === 'gameOver' && (
          <div className="setup-panel text-center scale-in">
            <h2 className="text-4xl font-black text-yellow-400 mb-2">Game Over</h2>
            <p className="text-xl text-zinc-300 mb-6">
              {getName(scores.indexOf(Math.max(...scores)))} is the G.O.A.T.
            </p>
            <ul className="mb-8 space-y-1">
              {scores.map((s, i) => (
                <li key={i} className="text-zinc-400">{getName(i)} — {s} pts</li>
              ))}
            </ul>
            <button
              type="button"
              className="px-10 py-3 bg-yellow-500 text-black font-bold rounded-2xl"
              onClick={() => { sounds.click(); setGamePhase('setup'); }}
            >
              Back to setup
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
