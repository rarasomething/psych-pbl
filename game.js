// Snake game visualizing Beck's cognitive model of depression.
// Two pellet pools: DISTORTIONS (grow the snake, dull/heavy palette) and
// COPING skills (shrink the snake, bright/distinct palette). Config-driven
// so new types or effects can be added without touching the core loop
// (see PROGRESS.md for the plan).

const GRID_SIZE = 10; // cells per side (fewer, bigger cells)
const CELL_PX = 30; // canvas is GRID_SIZE * CELL_PX
const BASE_SPEED_MS = 190; // starting tick interval (slowed down a bit from 160)
const MIN_SPEED_MS = 60; // fastest the game will get
const SPEED_STEP_MS = 4; // speed change per pellet eaten
const MIN_LENGTH = 3; // snake can't shrink shorter than its starting length

// Distortions and coping pellets are two independent, simultaneous spawns —
// not a single shared pellet slot.
const INITIAL_NEGATIVE_FOODS = 8; // board starts crowded — much less room to dodge
// No hard cap anymore — distortions keep ambiently spawning until the board
// is literally full (randomFreeCell returns null then, and the spawn is skipped).
// Past NEGATIVE_SLOWDOWN_THRESHOLD pellets on the board, ambient spawning
// just slows down rather than stopping outright.
const NEGATIVE_SLOWDOWN_THRESHOLD = 10;
const NEGATIVE_DOUBLE_SPAWN_CHANCE = 0.3; // chance a second distortion appears immediately too (was 0.18, then 0.25)
const NEGATIVE_AMBIENT_SPAWN_MS = 800; // ambient spawn interval below the threshold (was 2600, then 1400)
const NEGATIVE_AMBIENT_SPAWN_SLOW_MS = 1800; // ambient spawn interval once at/above the threshold (was 6000, then 3200)
const POSITIVE_RESPAWN_DELAY_MS = 4500; // coping pellets wait a bit before reappearing
const POSITIVE_RETRY_MS = 1000; // if the board's full when a coping pellet is due, try again this often
// New distortions never appear within this many cells (Manhattan distance)
// of the snake's head, so the player always gets at least a move or two to
// steer around them instead of eating one they had no chance to avoid.
const SPAWN_SAFE_DISTANCE = 2;
const MAX_QUEUED_TURNS = 2; // buffered key presses, so quick double turns aren't dropped
const FLOATING_TEXT_MS = 1100; // how long a coping-effect label floats over the board
const BEST_SCORE_KEY = "snakeBestScore";

// All distortions are shades of red now (light -> dark maroon) so the
// "negative pool" reads as one visually obvious family at a glance, distinct
// from the coping pool's bright teal/green/blue. Individual types are still
// told apart by label text, not color alone.
const DISTORTIONS = [
  {
    id: "jumping",
    kind: "distortion",
    label: "Jumping to Conclusions",
    color: "#ff6b6b",
    effect: "grow",
    description: "Deciding something bad is true without enough evidence.",
  },
  {
    id: "allOrNothing",
    kind: "distortion",
    label: "All-or-Nothing Thinking",
    color: "#e64545",
    effect: "grow",
    description: "Seeing things as either perfect or a total failure.",
  },
  {
    id: "blowingUp",
    kind: "distortion",
    label: "Blowing Things Out of Proportion",
    color: "#cc3333",
    effect: "grow",
    description: "Treating a small problem like a huge disaster.",
  },
  {
    id: "overgeneralizing",
    kind: "distortion",
    label: "Overgeneralizing",
    color: "#b3232f",
    effect: "grow",
    description: "Taking one bad event and deciding it will always happen.",
  },
  {
    id: "personalizing",
    kind: "distortion",
    label: "Taking It Personally",
    color: "#99182b",
    effect: "grow",
    description: "Believing something bad happened because of you.",
  },
  {
    id: "tunnelVision",
    kind: "distortion",
    label: "Tunnel Vision",
    color: "#7a1220",
    effect: "grow",
    description: "Focusing on one negative detail and ignoring everything else.",
  },
];

// Each coping skill now has a distinct effect (see applyCopingEffect) rather
// than all three just shrinking the trail — picked to mirror what the skill
// actually does cognitively, not just for mechanical variety:
//  - checking the evidence -> shrinks your own trail (undoing internalized growth)
//  - reframing             -> undercuts the distortions themselves, clearing some off the board
//  - a small step          -> doesn't erase anything, just steadies the pace for a bit
const COPING = [
  {
    id: "checkingEvidence",
    kind: "coping",
    label: "Checking the Evidence",
    color: "#5eead4",
    effect: "shrink",
    shrinkAmount: 3,
    description: "Looking at the facts to see if a thought is really true.",
  },
  {
    id: "reframing",
    kind: "coping",
    label: "Reframing the Thought",
    color: "#a3e635",
    effect: "clearNegatives",
    clearFraction: 0.5, // share of the distortions on the board, rounded up
    description: "Finding a more balanced way to look at a situation.",
  },
  {
    id: "smallStep",
    kind: "coping",
    label: "Taking a Small Step",
    color: "#38bdf8",
    effect: "slowdown",
    slowdownMs: 5000,
    slowdownFactor: 1.6,
    description: "Doing one small, doable thing when you feel stuck.",
  },
];

const ALL_TYPES = [...DISTORTIONS, ...COPING];

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const tallyListEl = document.getElementById("tally-list");
const copingListEl = document.getElementById("coping-list");
const scoreEl = document.getElementById("score");
const gameOverEl = document.getElementById("game-over");
const finalTallyEl = document.getElementById("final-tally");
const finalCopingEl = document.getElementById("final-coping");
const finalScoreEl = document.getElementById("final-score");
const gameOverCloseBtn = document.getElementById("game-over-close");
const startOverlayEl = document.getElementById("start-overlay");
const startBtn = document.getElementById("start-btn");
const infoModalEl = document.getElementById("info-modal");
const infoTitleEl = document.getElementById("info-title");
const infoDescEl = document.getElementById("info-desc");
const infoEffectEl = document.getElementById("info-effect");
const infoCloseBtn = document.getElementById("info-close");
const muteBtn = document.getElementById("mute-btn");
const helpModalEl = document.getElementById("help-modal");
const helpBtn = document.getElementById("help-btn");
const pauseOverlayEl = document.getElementById("pause-overlay");
const resumeBtn = document.getElementById("resume-btn");
const bestScoreEl = document.getElementById("best-score");
const slowBadgeEl = document.getElementById("slow-badge");
const takeawayEl = document.getElementById("takeaway");
const newBestEl = document.getElementById("new-best");
const playAgainBtn = document.getElementById("play-again-btn");
const dpadEl = document.getElementById("dpad");

// ---- Sound effects ----------------------------------------------------
// Synthesized with the Web Audio API rather than audio files, so the game
// stays a single self-contained page with nothing to host or load.
let audioCtx = null;
let muted = false;
try {
  muted = localStorage.getItem("snakeMuted") === "1";
} catch {
  // localStorage can throw (private browsing, blocked storage, etc.) —
  // just default to unmuted rather than breaking sound entirely.
}

// Browsers refuse to start an AudioContext before a user gesture, so this is
// only ever called from inside a click/keydown handler (Start, mute toggle).
function ensureAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null; // unsupported browser — sounds just don't play
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// One short tone with a fast attack / exponential decay envelope (avoids the
// click/pop a hard on-off would make). `endFreq` sweeps the pitch across the
// tone's duration instead of holding flat; `delay` offsets the start so
// several calls can be chained into a little melody.
function playTone({ freq, endFreq, duration = 0.12, type = "sine", gain = 0.12, delay = 0 }) {
  if (muted) return;
  const ac = ensureAudioContext();
  if (!ac) return;

  const osc = ac.createOscillator();
  const gainNode = ac.createGain();
  const startTime = ac.currentTime + delay;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + duration);

  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gainNode).connect(ac.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.02);
}

function playEatDistortion() {
  // low, slightly harsh descending blip — matches the red/negative pellets
  playTone({ freq: 220, endFreq: 140, duration: 0.14, type: "sawtooth", gain: 0.08 });
}

function playEatCoping() {
  // bright two-note ascending chime — matches the coping pellets
  playTone({ freq: 660, duration: 0.1, type: "sine", gain: 0.11 });
  playTone({ freq: 880, duration: 0.16, type: "sine", gain: 0.11, delay: 0.08 });
}

function playGameOver() {
  // descending three-note phrase
  playTone({ freq: 392, duration: 0.16, type: "triangle", gain: 0.11 });
  playTone({ freq: 330, duration: 0.16, type: "triangle", gain: 0.11, delay: 0.14 });
  playTone({ freq: 262, duration: 0.3, type: "triangle", gain: 0.11, delay: 0.28 });
}

function playStart() {
  playTone({ freq: 440, endFreq: 660, duration: 0.12, type: "sine", gain: 0.09 });
}

function updateMuteBtn() {
  muteBtn.textContent = muted ? "🔇" : "🔊";
  muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
}

muteBtn.addEventListener("click", () => {
  muted = !muted;
  try {
    localStorage.setItem("snakeMuted", muted ? "1" : "0");
  } catch {
    // best-effort persistence only
  }
  updateMuteBtn();
  // drop focus so Space/Enter during play don't re-press this button
  muteBtn.blur();
  if (!muted) ensureAudioContext(); // unlock audio on the same gesture that unmutes
});

updateMuteBtn(); // reflect the restored preference immediately

function findType(id) {
  return ALL_TYPES.find((t) => t.id === id);
}

// Plain-language summary of what eating this pellet actually does, shown in
// the info modal alongside its description — kept separate from `description`
// since that's about the cognitive concept, this is about the game mechanic.
function effectSummary(type) {
  if (type.kind === "distortion") return "Grows the trail by 1 and speeds the game up slightly.";
  switch (type.effect) {
    case "shrink":
      return `Shrinks the trail by ${type.shrinkAmount ?? 1} and eases the speed slightly.`;
    case "clearNegatives":
      return `Clears ${Math.round(type.clearFraction * 100)}% of the distortion pellets on the board.`;
    case "slowdown":
      return `Slows the game down for ${Math.round((type.slowdownMs ?? 0) / 1000)} seconds.`;
    default:
      return "";
  }
}

function showInfoModal(type) {
  infoTitleEl.textContent = type.label;
  infoDescEl.textContent = type.description;
  infoEffectEl.textContent = effectSummary(type);
  infoModalEl.classList.remove("hidden");
  pauseGame("info"); // reading a definition shouldn't cost the player the round
}

function hideInfoModal() {
  infoModalEl.classList.add("hidden");
  resumeGame("info");
}

// The how-to-play popup starts visible (no "hidden" class in the HTML) so it
// greets the player on page load; after that it only reopens via the "?"
// button. Like the info modal, it pauses a round that's in progress.
function showHelpModal() {
  helpModalEl.classList.remove("hidden");
  pauseGame("help");
}

function hideHelpModal() {
  helpModalEl.classList.add("hidden");
  resumeGame("help");
}

helpBtn.addEventListener("click", () => {
  helpBtn.blur(); // same reason as the mute button: keep Space/Enter for the game
  showHelpModal();
});

// Closing the game-over popup (✕, backdrop, Escape) just returns to the
// Ready/Start screen; "Play again" (or Enter/Space) starts a new round directly.
function dismissGameOver() {
  gameOverEl.classList.add("hidden");
  startOverlayEl.classList.remove("hidden");
}

// Event delegation: info buttons are re-created every renderTally() call, so
// one listener here covers all of them (present and future) instead of
// re-binding on every render.
document.addEventListener("click", (e) => {
  const infoBtn = e.target.closest(".info-btn");
  if (infoBtn) {
    // drop focus so a later Enter/Space during play doesn't reopen the modal
    infoBtn.blur();
    const type = findType(infoBtn.dataset.id);
    if (type) showInfoModal(type);
    return;
  }
  if (e.target === helpModalEl || e.target.closest("#help-close, #help-ok")) {
    hideHelpModal();
    return;
  }
  if (e.target === infoModalEl || e.target === infoCloseBtn) {
    hideInfoModal();
    return;
  }
  if (e.target === gameOverEl || e.target === gameOverCloseBtn) {
    dismissGameOver();
  }
});

playAgainBtn.addEventListener("click", () => {
  playAgainBtn.blur();
  startGame();
});

resumeBtn.addEventListener("click", () => {
  resumeBtn.blur();
  resumeGame("manual");
});

// Leaving the tab mid-round pauses it (browsers throttle timers in hidden
// tabs, which slowed the snake while the score clock kept counting). It uses
// the same "manual" pause as P/Esc, so coming back shows the Paused screen
// instead of dropping the player straight back into a moving game.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseGame("manual");
});

let snake, direction, negativeFoods, positiveFood, positiveRespawnTimeout, ambientSpawnTimeout;
let positiveDueAt = null; // performance.now() when the next coping pellet is due, else null
let tally, speedMs, loopHandle, running, startTime;
let directionQueue = []; // turns pressed but not yet applied, oldest first (see queueDirection)
let speedMultiplier, slowdownEndsAt; // "Taking a Small Step"'s temporary easing, layered on top of speedMs
let waitingForFirstMove; // true from Start until the first accepted direction key (see beginMoving)
let pausedAt = null; // performance.now() when the round was paused, else null
// Why the round is paused — "help"/"info" (a popup is open) or "manual"
// (P/Esc, the touch pause button, or leaving the tab). It only resumes once
// every reason is cleared, so e.g. closing a popup can't unpause a round the
// player had paused themselves.
const pauseReasons = new Set();
let floatingTexts = []; // short-lived labels/rings drawn over the board (see addFloatingText)
let bestScore = 0;
try {
  bestScore = Number(localStorage.getItem(BEST_SCORE_KEY)) || 0;
} catch {
  // storage blocked — best score just won't persist between visits
}

function occupiedCells() {
  const occupied = new Set(snake.map((s) => `${s.x},${s.y}`));
  negativeFoods.forEach((f) => occupied.add(`${f.x},${f.y}`));
  if (positiveFood) occupied.add(`${positiveFood.x},${positiveFood.y}`);
  return occupied;
}

// Picks uniformly from the actual free cells (the board is only 100 cells, so
// listing them is cheap) — returns null only when there genuinely is no room.
function randomFreeCell({ awayFromHead = false } = {}) {
  const occupied = occupiedCells();
  const head = snake[0];
  const free = [];
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      if (occupied.has(`${x},${y}`)) continue;
      if (awayFromHead && Math.abs(x - head.x) + Math.abs(y - head.y) <= SPAWN_SAFE_DISTANCE) continue;
      free.push({ x, y });
    }
  }
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}

function spawnNegativeFood() {
  const cell = randomFreeCell({ awayFromHead: true });
  if (!cell) return; // board's full — skip this spawn rather than crash
  const type = DISTORTIONS[Math.floor(Math.random() * DISTORTIONS.length)];
  negativeFoods.push({ ...cell, type });
}

// The due time is tracked (not just the timeout) so pausing can stop the
// countdown and resuming can pick it back up with whatever time was left.
function schedulePositiveSpawn(delay) {
  clearTimeout(positiveRespawnTimeout);
  positiveDueAt = performance.now() + delay;
  positiveRespawnTimeout = setTimeout(spawnPositiveFood, delay);
}

function spawnPositiveFood() {
  if (!running) return;
  const cell = pausedAt === null ? randomFreeCell() : null;
  if (!cell) {
    // board's full (or the round is paused) — keep retrying instead of
    // leaving the round without coping pellets for good
    schedulePositiveSpawn(POSITIVE_RETRY_MS);
    return;
  }
  positiveDueAt = null;
  const type = COPING[Math.floor(Math.random() * COPING.length)];
  positiveFood = { ...cell, type };
}

// Recursive setTimeout instead of setInterval so the delay can change each
// cycle: normal pace while the board's relatively clear, slower once it's
// crowded (NEGATIVE_SLOWDOWN_THRESHOLD+ pellets) — but never stops outright.
// spawnNegativeFood() is itself a no-op once the board is completely full
// (randomFreeCell returns null), so this just keeps trying at a calmer pace
// rather than needing its own "is the board full" check.
function scheduleAmbientSpawn() {
  clearTimeout(ambientSpawnTimeout);
  const delay = negativeFoods.length >= NEGATIVE_SLOWDOWN_THRESHOLD
    ? NEGATIVE_AMBIENT_SPAWN_SLOW_MS
    : NEGATIVE_AMBIENT_SPAWN_MS;
  ambientSpawnTimeout = setTimeout(() => {
    if (!running) return;
    if (pausedAt === null) spawnNegativeFood();
    scheduleAmbientSpawn();
  }, delay);
}

function resetState() {
  snake = [
    { x: 5, y: 5 },
    { x: 4, y: 5 },
    { x: 3, y: 5 },
  ];
  direction = { x: 1, y: 0 };
  directionQueue = [];
  tally = Object.fromEntries(ALL_TYPES.map((d) => [d.id, 0]));
  speedMs = BASE_SPEED_MS;
  speedMultiplier = 1;
  slowdownEndsAt = null;
  floatingTexts = [];
  running = true;
  // The round is "on" (running=true) as soon as Start is pressed, but
  // everything that actually progresses time — the tick loop, ambient
  // spawning, the score clock — waits until the first direction key, via
  // beginMoving(). Board and pellets are already visible and static in the
  // meantime, so the player has a moment to get oriented instead of the
  // snake immediately taking off.
  waitingForFirstMove = true;
  pausedAt = null;
  pauseReasons.clear();
  pauseOverlayEl.classList.add("hidden");

  clearTimeout(positiveRespawnTimeout);
  clearTimeout(ambientSpawnTimeout);
  positiveDueAt = null;
  negativeFoods = [];
  positiveFood = null;
  for (let i = 0; i < INITIAL_NEGATIVE_FOODS; i++) spawnNegativeFood();
  spawnPositiveFood();

  renderTally(tallyListEl, DISTORTIONS);
  renderTally(copingListEl, COPING);
  scoreEl.textContent = "0s";
  gameOverEl.classList.add("hidden");
  startOverlayEl.classList.add("hidden");
}

// Called once, on the first accepted direction key after Start — this is
// what actually kicks the round into motion.
function beginMoving() {
  waitingForFirstMove = false;
  startTime = performance.now(); // score counts from the first real move, not from Start
  scheduleAmbientSpawn();
  restartLoop();
}

function renderTally(el, types) {
  el.innerHTML = "";
  for (const d of types) {
    const li = document.createElement("li");

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = d.color;
    swatch.style.color = d.color;

    const label = document.createElement("span");
    label.textContent = d.label;

    const infoBtn = document.createElement("button");
    infoBtn.type = "button";
    infoBtn.className = "info-btn";
    infoBtn.textContent = "?";
    infoBtn.dataset.id = d.id;
    infoBtn.setAttribute("aria-label", `What is ${d.label}?`);

    const count = document.createElement("span");
    count.className = "count";
    count.textContent = tally[d.id];

    li.append(swatch, label, infoBtn, count);
    el.appendChild(li);
  }
}

function tick() {
  // "Taking a Small Step" wears off here rather than on its own timer, so a
  // pause (which shifts slowdownEndsAt forward) can't eat into it
  if (slowdownEndsAt !== null && performance.now() >= slowdownEndsAt) {
    speedMultiplier = 1;
    slowdownEndsAt = null;
    restartLoop();
  }
  if (directionQueue.length) direction = directionQueue.shift();
  const head = {
    x: snake[0].x + direction.x,
    y: snake[0].y + direction.y,
  };

  const negIndex = negativeFoods.findIndex((f) => f.x === head.x && f.y === head.y);
  const atePositive = positiveFood && head.x === positiveFood.x && head.y === positiveFood.y;
  // Eating anything means no pop() happens this tick, so the tail segment
  // stays occupied — collide against the whole body in that case. Otherwise
  // the tail tip is about to vacate, so moving into it is legal (this was
  // registering as a false death before).
  const bodyToCheck = negIndex !== -1 || atePositive ? snake : snake.slice(0, -1);

  if (
    head.x < 0 ||
    head.y < 0 ||
    head.x >= GRID_SIZE ||
    head.y >= GRID_SIZE ||
    bodyToCheck.some((seg) => seg.x === head.x && seg.y === head.y)
  ) {
    return gameOver();
  }

  snake.unshift(head);

  if (negIndex !== -1) {
    const type = negativeFoods[negIndex].type;
    negativeFoods.splice(negIndex, 1);
    tally[type.id]++;
    renderTally(tallyListEl, DISTORTIONS);
    playEatDistortion();
    addFloatingText("+1", head, "#ff8a8a");

    // unshift already added the head; skip the pop so the snake grows by 1
    speedMs = Math.max(MIN_SPEED_MS, speedMs - SPEED_STEP_MS);

    spawnNegativeFood(); // eating a distortion immediately spawns another
    if (Math.random() < NEGATIVE_DOUBLE_SPAWN_CHANCE) {
      spawnNegativeFood(); // small chance of a second one appearing too (a no-op if the board's full)
    }
    restartLoop();
  } else if (atePositive) {
    const type = positiveFood.type;
    positiveFood = null;
    tally[type.id]++;
    renderTally(copingListEl, COPING);
    playEatCoping();

    // undo the unshift's growth — this happens for every coping type,
    // regardless of its specific effect below
    snake.pop();
    applyCopingEffect(type, head);

    schedulePositiveSpawn(POSITIVE_RESPAWN_DELAY_MS);
    restartLoop();
  } else {
    snake.pop();
  }
}

// Each effect also floats a label over the board (and reframing rings the
// pellets it removed) so the player can see what the coping skill just did.
function applyCopingEffect(type, at) {
  switch (type.effect) {
    case "shrink": {
      // shrink by shrinkAmount, but never below the starting length
      let removed = 0;
      for (let i = 0; i < (type.shrinkAmount ?? 1); i++) {
        if (snake.length > MIN_LENGTH) {
          snake.pop();
          removed++;
        }
      }
      speedMs = Math.min(BASE_SPEED_MS, speedMs + SPEED_STEP_MS * 2);
      addFloatingText(removed ? `−${removed} trail` : "Trail at minimum", at, type.color);
      break;
    }
    case "clearNegatives": {
      // reframing undercuts the distortions themselves — remove a share of
      // whichever ones are on the board right now (rounded up, so at least
      // one goes whenever any are there)
      const count = Math.min(Math.ceil(negativeFoods.length * (type.clearFraction ?? 1)), negativeFoods.length);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * negativeFoods.length);
        const [cleared] = negativeFoods.splice(idx, 1);
        addRing(cleared, type.color);
      }
      addFloatingText(count ? `−${count} distortion${count === 1 ? "" : "s"}` : "Nothing to clear", at, type.color);
      break;
    }
    case "slowdown": {
      // ease the pace for a few seconds, layered on top of speedMs (which
      // keeps tracking distortions/other coping eats independently) rather
      // than overwriting it, so the easing cleanly expires back to whatever
      // speedMs has become by then
      speedMultiplier = type.slowdownFactor ?? 1.5;
      slowdownEndsAt = performance.now() + (type.slowdownMs ?? 5000);
      addFloatingText("Slowing down", at, type.color);
      break;
    }
  }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function mixColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

const TRAIL_HEAD_COLOR = "#8a90c9";
// The tail color has to stay clearly visible against the near-black canvas
// background ("#14141f", rgb 20,20,31) no matter how far back a segment is —
// it was originally "#211e2c" (basically the same as the background, so the
// tail vanished), then "#3f3a58" (still too close in both hue and value to
// read as "on the board" once a lot of segments piled up). Switched to a
// warm, clearly-distinct dusty maroon instead of another dark blue/purple —
// good contrast against the cool near-black background, and it visually
// echoes the red distortion pellets that grew the trail in the first place.
const TRAIL_TAIL_COLOR = "#7a4a52";
const TRAIL_DARKEN_SPAN = 18; // segments until the trail reaches full darkness

// The head/tail colors never change, so the interpolated color per depth is
// constant too — precompute the whole ramp once instead of re-parsing hex
// and re-mixing on every segment of every animation frame (was up to
// TRAIL_DARKEN_SPAN mixColor calls * 60fps, for no reason).
const TRAIL_COLOR_RAMP = Array.from({ length: TRAIL_DARKEN_SPAN + 1 }, (_, i) =>
  mixColor(TRAIL_HEAD_COLOR, TRAIL_TAIL_COLOR, i / TRAIL_DARKEN_SPAN)
);

function draw(timeMs) {
  ctx.fillStyle = "#14141f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // faint grid
  ctx.strokeStyle = "rgba(255,255,255,0.03)";
  ctx.lineWidth = 1;
  for (let i = 1; i < GRID_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL_PX, 0);
    ctx.lineTo(i * CELL_PX, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * CELL_PX);
    ctx.lineTo(canvas.width, i * CELL_PX);
    ctx.stroke();
  }

  // glow behind each food — coping pellets pulse to draw the eye; distortions
  // get a steady, dimmer glow so the board doesn't throb as it fills up
  const pulse = 0.5 + 0.5 * Math.sin(timeMs / 220);
  const allFoods = positiveFood ? [...negativeFoods, positiveFood] : negativeFoods;
  for (const item of allFoods) {
    const isCoping = item.type.kind === "coping";
    const fx = item.x * CELL_PX + CELL_PX / 2;
    const fy = item.y * CELL_PX + CELL_PX / 2;
    const glowR = CELL_PX * (isCoping ? 1.3 + pulse * 0.35 : 1);
    const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, glowR);
    glow.addColorStop(0, item.type.color + (isCoping ? "cc" : "88"));
    glow.addColorStop(1, item.type.color + "00");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(fx, fy, glowR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = item.type.color;
    if (isCoping) {
      // bright rotated diamond, visually distinct from the dull distortion pellets
      const size = CELL_PX - 8;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    } else {
      roundRect(item.x * CELL_PX + 3, item.y * CELL_PX + 3, CELL_PX - 6, CELL_PX - 6, 4);
      ctx.fill();
    }
  }

  // snake, tail-first so the head renders on top; body darkens the further
  // back it is, visualizing distortions piling up gradually over time
  for (let i = snake.length - 1; i >= 0; i--) {
    const seg = snake[i];
    const isHead = i === 0;
    if (isHead) {
      ctx.fillStyle = "#f1f1f6";
    } else {
      const depth = Math.min(TRAIL_DARKEN_SPAN, i - 1);
      ctx.fillStyle = TRAIL_COLOR_RAMP[depth];
    }
    roundRect(seg.x * CELL_PX + 1, seg.y * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2, 5);
    ctx.fill();
    // Outline on every segment so the tail can never fully blend into the
    // background, whatever the fill color ends up being — belt-and-braces on
    // top of the TRAIL_TAIL_COLOR change above (was 0.12 alpha, too faint to
    // actually read as an edge once the fill itself got close to the
    // background — raised so it gives real definition, not just a hint).
    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // eyes on the head, oriented with travel direction
  const head = snake[0];
  const cx = head.x * CELL_PX + CELL_PX / 2;
  const cy = head.y * CELL_PX + CELL_PX / 2;
  const offX = direction.x * 4;
  const offY = direction.y * 4;
  const perpX = direction.y * 3;
  const perpY = -direction.x * 3;
  ctx.fillStyle = "#14141f";
  [-1, 1].forEach((s) => {
    ctx.beginPath();
    ctx.arc(cx + offX + perpX * s, cy + offY + perpY * s, 1.6, 0, Math.PI * 2);
    ctx.fill();
  });

  drawFloatingTexts(timeMs);
}

function addFloatingText(text, cell, color) {
  floatingTexts.push({ text, cell, color, born: performance.now() });
}

function addRing(cell, color) {
  floatingTexts.push({ ring: true, cell, color, born: performance.now() });
}

// Labels rise and fade over FLOATING_TEXT_MS; rings expand and fade where a
// reframed distortion used to be.
function drawFloatingTexts(timeMs) {
  floatingTexts = floatingTexts.filter((f) => timeMs - f.born < FLOATING_TEXT_MS);
  for (const f of floatingTexts) {
    const t = Math.max(0, (timeMs - f.born) / FLOATING_TEXT_MS);
    const cx = f.cell.x * CELL_PX + CELL_PX / 2;
    const cy = f.cell.y * CELL_PX + CELL_PX / 2;
    ctx.globalAlpha = 1 - t;
    if (f.ring) {
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, CELL_PX * (0.3 + t * 0.6), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.font = "600 13px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const width = ctx.measureText(f.text).width;
      // keep the label fully on the board even when eaten next to an edge
      const x = Math.min(Math.max(cx, width / 2 + 4), canvas.width - width / 2 - 4);
      const y = Math.max(cy - 14 - t * 24, 10);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#14141f";
      ctx.strokeText(f.text, x, y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, x, y);
    }
  }
  ctx.globalAlpha = 1;
}

function renderLoop(timeMs) {
  draw(timeMs);
  // Clock stays at 0s while waiting for the first move — startTime isn't
  // set yet at that point (it's set in beginMoving()), so computing against
  // it here would read a stale/undefined value.
  if (running && !waitingForFirstMove) {
    const now = pausedAt ?? performance.now(); // clock freezes while paused
    scoreEl.textContent = `${Math.floor((now - startTime) / 1000)}s`;
  }
  const slowLeft = running && slowdownEndsAt !== null
    ? Math.ceil((slowdownEndsAt - (pausedAt ?? performance.now())) / 1000)
    : 0;
  slowBadgeEl.classList.toggle("hidden", slowLeft <= 0);
  if (slowLeft > 0) slowBadgeEl.textContent = `Slowed · ${slowLeft}s`;
  requestAnimationFrame(renderLoop);
}

function gameOver() {
  running = false;
  clearInterval(loopHandle);
  clearTimeout(positiveRespawnTimeout);
  clearTimeout(ambientSpawnTimeout);
  slowdownEndsAt = null;
  playGameOver();
  renderTally(finalTallyEl, DISTORTIONS);
  renderTally(finalCopingEl, COPING);
  const secondsSurvived = Math.floor((performance.now() - startTime) / 1000);
  finalScoreEl.textContent = `${secondsSurvived}s`;
  scoreEl.textContent = `${secondsSurvived}s`; // the render loop stops updating it once running is false
  takeawayEl.textContent = takeawayText();

  const isNewBest = secondsSurvived > bestScore;
  newBestEl.classList.toggle("hidden", !isNewBest);
  if (isNewBest) {
    bestScore = secondsSurvived;
    try {
      localStorage.setItem(BEST_SCORE_KEY, String(bestScore));
    } catch {
      // best-effort persistence only
    }
    renderBestScore();
  }
  gameOverEl.classList.remove("hidden");
}

// One-line recap of the round for the game-over popup, connecting the counts
// back to the idea the game is built on.
function takeawayText() {
  const sum = (types) => types.reduce((n, t) => n + tally[t.id], 0);
  const distortions = sum(DISTORTIONS);
  const coping = sum(COPING);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (coping === 0) {
    return `${plural(distortions, "distortion")} piled up, and no coping skills were used to push back.`;
  }
  return `${plural(distortions, "distortion")} piled up, and you used ${plural(coping, "coping skill")} to push back.`;
}

function renderBestScore() {
  bestScoreEl.textContent = `Best ${bestScore}s`;
}

// Pause only matters once the snake is actually moving — before the first
// move nothing is ticking anyway, and after game over there's nothing to pause.
function pauseGame(reason) {
  if (!running || waitingForFirstMove) return;
  pauseReasons.add(reason);
  pauseOverlayEl.classList.toggle("hidden", !pauseReasons.has("manual"));
  if (pausedAt !== null) return;
  pausedAt = performance.now();
  clearInterval(loopHandle);
  clearTimeout(positiveRespawnTimeout); // picked back up in resumeGame
}

function resumeGame(reason) {
  pauseReasons.delete(reason);
  pauseOverlayEl.classList.toggle("hidden", !pauseReasons.has("manual"));
  if (pausedAt === null || pauseReasons.size) return;
  // paused time counts toward neither the score nor an active slowdown
  const pausedFor = performance.now() - pausedAt;
  startTime += pausedFor;
  if (slowdownEndsAt !== null) slowdownEndsAt += pausedFor;
  pausedAt = null;
  if (positiveDueAt !== null) {
    schedulePositiveSpawn(Math.max(0, positiveDueAt + pausedFor - performance.now()));
  }
  restartLoop();
}

function togglePause() {
  if (pauseReasons.has("manual")) resumeGame("manual");
  else pauseGame("manual");
}

function restartLoop() {
  // Defense in depth for the bug above: whatever calls this, never actually
  // start ticking again once the round is over (or while it's paused).
  if (!running || pausedAt !== null) return;
  clearInterval(loopHandle);
  loopHandle = setInterval(tick, speedMs * speedMultiplier);
}

const DIRECTION_KEYS = {
  arrowup: { x: 0, y: -1 },
  w: { x: 0, y: -1 },
  arrowdown: { x: 0, y: 1 },
  s: { x: 0, y: 1 },
  arrowleft: { x: -1, y: 0 },
  a: { x: -1, y: 0 },
  arrowright: { x: 1, y: 0 },
  d: { x: 1, y: 0 },
};

function handleKey(e) {
  // Leave browser/OS shortcuts alone (Cmd+P to print, Ctrl+S to save, ...)
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  // Holding a direction key is harmless (repeats of the same turn are
  // ignored), but a held Enter/Space/P/Esc would fire again and again — e.g.
  // closing the help popup and then immediately starting a round, or
  // flickering pause on and off.
  if (e.repeat && !Object.prototype.hasOwnProperty.call(DIRECTION_KEYS, key)) {
    e.preventDefault();
    return;
  }
  // A visible button or link that has keyboard focus (reached with Tab)
  // should do its own thing on Enter/Space, not whatever the game would do.
  // Mouse clicks blur their buttons, so this only ever applies to keyboard users.
  const focused = e.target.closest?.("button, a");
  if (focused && focused.getClientRects().length && (key === "enter" || key === " ")) return;
  // True for any key this game ever acts on — used below to block the
  // browser's default scroll/find behavior even in states where we don't
  // actually act on the key (e.g. arrow keys while an overlay is up). This
  // was missing from the overlay branches: they returned without acting on
  // unrecognized keys, but never called preventDefault either, so arrow
  // keys silently scrolled the page again whenever the info modal, the
  // game-over popup, or the ready screen was showing.
  const isOwnKey = Object.prototype.hasOwnProperty.call(DIRECTION_KEYS, key) ||
    key === "enter" || key === " " || key === "escape" || key === "p";

  // Whichever overlay is on top gets the keyboard first, so precedence here
  // has to match the visual stacking order (help/info modal > game-over
  // popup > ready/start screen > live play):
  if (!helpModalEl.classList.contains("hidden")) {
    if (isOwnKey) e.preventDefault();
    if (key === "escape" || key === "enter" || key === " ") hideHelpModal();
    return;
  }

  if (!infoModalEl.classList.contains("hidden")) {
    if (isOwnKey) e.preventDefault();
    // swallow everything else so arrow keys don't move the snake underneath
    // while someone's reading a definition
    if (key === "escape") hideInfoModal();
    return;
  }

  if (!gameOverEl.classList.contains("hidden")) {
    if (isOwnKey) e.preventDefault();
    // Enter/Space = "Play again"; Escape = close back to the Ready screen
    if (key === "enter" || key === " ") startGame();
    else if (key === "escape") dismissGameOver();
    return;
  }

  // Not running + no popup showing = the Ready/Start screen, before the
  // very first round or after dismissing game-over.
  if (!running) {
    if (isOwnKey) e.preventDefault();
    if (key === "enter" || key === " ") startGame();
    return;
  }

  // Arrow keys and Space scroll the page by default, and Space/Enter would
  // press whichever button still has focus — block both during play.
  if (isOwnKey) e.preventDefault();

  if (pauseReasons.has("manual")) {
    if (key === "p" || key === "escape" || key === "enter" || key === " ") resumeGame("manual");
    return; // direction keys don't steer a paused snake
  }
  if (key === "p" || key === "escape") {
    pauseGame("manual");
    return;
  }

  const dir = DIRECTION_KEYS[key];
  if (dir) steer(dir);
}

// Shared by the keyboard, the on-screen arrow pad, and swipes.
function steer(dir) {
  if (!running || pausedAt !== null) return;
  // Compare against the last *queued* turn, not the current direction, so a
  // fast up-then-left both land instead of the second overwriting the first.
  const last = directionQueue.length ? directionQueue[directionQueue.length - 1] : direction;
  // prevent reversing directly into the snake's own neck (also blocks
  // turning back into it as the very first move, before anything has moved)
  if (dir.x === -last.x && dir.y === -last.y) return;
  const isSame = dir.x === last.x && dir.y === last.y;
  if (!isSame && directionQueue.length < MAX_QUEUED_TURNS) directionQueue.push(dir);
  if (waitingForFirstMove) beginMoving();
}

document.addEventListener("keydown", handleKey);

// ---- Touch controls ---------------------------------------------------
// Arrow pad (only shown on touch screens, see style.css) plus swipes on the
// board itself. pointerdown rather than click so a tap registers instantly.
dpadEl.addEventListener("pointerdown", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  e.preventDefault();
  if (btn.dataset.dir) steer(DIRECTION_KEYS[btn.dataset.dir]);
  else if (btn.dataset.action === "pause") togglePause();
});

const SWIPE_MIN_PX = 20;
let swipeStart = null;
canvas.addEventListener("touchstart", (e) => {
  const t = e.changedTouches[0];
  swipeStart = { x: t.clientX, y: t.clientY };
}, { passive: true });
canvas.addEventListener("touchend", (e) => {
  if (!swipeStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipeStart.x;
  const dy = t.clientY - swipeStart.y;
  swipeStart = null;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN_PX) return;
  if (Math.abs(dx) > Math.abs(dy)) steer({ x: Math.sign(dx), y: 0 });
  else steer({ x: 0, y: Math.sign(dy) });
});
startBtn.addEventListener("click", () => {
  startBtn.blur();
  startGame();
});
// gameOverCloseBtn's click is handled by the delegated document click
// listener above (dismissGameOver), same as the info modal's close button.

let renderStarted = false;

function startGame() {
  playStart(); // also the user gesture that unlocks the AudioContext on the very first press
  resetState();
  // No restartLoop() here on purpose — the tick loop, ambient spawning, and
  // the score clock all start together in beginMoving(), on the first
  // accepted direction key, so the snake sits still (and nothing else
  // progresses) right after Start instead of immediately taking off.
  if (!renderStarted) {
    renderStarted = true;
    requestAnimationFrame(renderLoop);
  }
}

// Populate the key (with working "?" info buttons) immediately so it's
// readable before the player ever presses Start — the game itself
// (spawning, timers, loop) doesn't begin until startGame() runs.
tally = Object.fromEntries(ALL_TYPES.map((d) => [d.id, 0]));
renderTally(tallyListEl, DISTORTIONS);
renderTally(copingListEl, COPING);
renderBestScore();
