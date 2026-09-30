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
// is literally full (randomFreeCell's own bail-out handles that gracefully).
// Past NEGATIVE_SLOWDOWN_THRESHOLD pellets on the board, ambient spawning
// just slows down rather than stopping outright.
const NEGATIVE_SLOWDOWN_THRESHOLD = 10;
const NEGATIVE_DOUBLE_SPAWN_CHANCE = 0.3; // chance a second distortion appears immediately too (was 0.18, then 0.25)
const NEGATIVE_AMBIENT_SPAWN_MS = 800; // ambient spawn interval below the threshold (was 2600, then 1400)
const NEGATIVE_AMBIENT_SPAWN_SLOW_MS = 1800; // ambient spawn interval once at/above the threshold (was 6000, then 3200)
const POSITIVE_RESPAWN_DELAY_MS = 4500; // coping pellets wait a bit before reappearing
const MAX_FREE_CELL_ATTEMPTS = 200; // bail out instead of spinning forever if the board is packed

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
    description: "You assumed the worst with barely any evidence to back it up.",
  },
  {
    id: "allOrNothing",
    kind: "distortion",
    label: "All-or-Nothing Thinking",
    color: "#e64545",
    effect: "grow",
    description: "It's either perfect or a total failure — no middle ground allowed.",
  },
  {
    id: "blowingUp",
    kind: "distortion",
    label: "Blowing Things Out of Proportion",
    color: "#cc3333",
    effect: "grow",
    description: "A small setback suddenly feels like an absolute catastrophe.",
  },
  {
    id: "overgeneralizing",
    kind: "distortion",
    label: "Overgeneralizing",
    color: "#b3232f",
    effect: "grow",
    description: "One bad moment gets rewritten as 'this always happens to me.'",
  },
  {
    id: "personalizing",
    kind: "distortion",
    label: "Taking It Personally",
    color: "#99182b",
    effect: "grow",
    description: "You're sure it was about you, even without any real proof.",
  },
  {
    id: "tunnelVision",
    kind: "distortion",
    label: "Tunnel Vision",
    color: "#7a1220",
    effect: "grow",
    description: "You fixate on the one negative detail and tune out everything else.",
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
    description: "You paused to test the thought against the facts instead of assuming.",
  },
  {
    id: "reframing",
    kind: "coping",
    label: "Reframing the Thought",
    color: "#a3e635",
    effect: "clearNegatives",
    clearCount: 3,
    description: "You found a more balanced way to see it — a few distortions lose their grip.",
  },
  {
    id: "smallStep",
    kind: "coping",
    label: "Taking a Small Step",
    color: "#38bdf8",
    effect: "slowdown",
    slowdownMs: 5000,
    slowdownFactor: 1.6,
    description: "You acted in a small way instead of freezing up — the pace eases for a bit.",
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
      return `Shrinks the trail by ${type.shrinkAmount ?? 1}.`;
    case "clearNegatives":
      return `Clears up to ${type.clearCount} distortion pellets off the board.`;
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
}

function hideInfoModal() {
  infoModalEl.classList.add("hidden");
}

// Dismissing the game-over popup just returns to the Ready/Start screen —
// it does NOT restart the round itself. The player has to press Start
// again, same as the very first time.
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
    const type = findType(infoBtn.dataset.id);
    if (type) showInfoModal(type);
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

let snake, direction, nextDirection, negativeFoods, positiveFood, positiveRespawnTimeout, ambientSpawnTimeout;
let tally, speedMs, loopHandle, running, startTime;
let speedMultiplier, slowdownTimeout; // "Taking a Small Step"'s temporary easing, layered on top of speedMs
let waitingForFirstMove; // true from Start until the first accepted direction key (see beginMoving)

function occupiedCells() {
  const occupied = new Set(snake.map((s) => `${s.x},${s.y}`));
  negativeFoods.forEach((f) => occupied.add(`${f.x},${f.y}`));
  if (positiveFood) occupied.add(`${positiveFood.x},${positiveFood.y}`);
  return occupied;
}

function randomFreeCell() {
  const occupied = occupiedCells();
  // Bail out instead of spinning forever if the board is nearly full — with
  // the board now starting crowded (8 pellets) and an ambient spawner still
  // adding more as the snake grows, an all-cells-occupied state is reachable
  // well before the old "94-segment snake" margin assumed.
  for (let attempt = 0; attempt < MAX_FREE_CELL_ATTEMPTS; attempt++) {
    const pos = {
      x: Math.floor(Math.random() * GRID_SIZE),
      y: Math.floor(Math.random() * GRID_SIZE),
    };
    if (!occupied.has(`${pos.x},${pos.y}`)) return pos;
  }
  return null;
}

function spawnNegativeFood() {
  const cell = randomFreeCell();
  if (!cell) return; // board's full — skip this spawn rather than crash
  const type = DISTORTIONS[Math.floor(Math.random() * DISTORTIONS.length)];
  negativeFoods.push({ ...cell, type });
}

function spawnPositiveFood() {
  if (!running) return;
  const cell = randomFreeCell();
  if (!cell) return;
  const type = COPING[Math.floor(Math.random() * COPING.length)];
  positiveFood = { ...cell, type };
}

// Recursive setTimeout instead of setInterval so the delay can change each
// cycle: normal pace while the board's relatively clear, slower once it's
// crowded (NEGATIVE_SLOWDOWN_THRESHOLD+ pellets) — but never stops outright.
// spawnNegativeFood() is itself a no-op once the board is completely full
// (randomFreeCell's bail-out), so this just keeps trying at a calmer pace
// rather than needing its own "is the board full" check.
function scheduleAmbientSpawn() {
  clearTimeout(ambientSpawnTimeout);
  const delay = negativeFoods.length >= NEGATIVE_SLOWDOWN_THRESHOLD
    ? NEGATIVE_AMBIENT_SPAWN_SLOW_MS
    : NEGATIVE_AMBIENT_SPAWN_MS;
  ambientSpawnTimeout = setTimeout(() => {
    if (!running) return;
    spawnNegativeFood();
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
  nextDirection = direction;
  tally = Object.fromEntries(ALL_TYPES.map((d) => [d.id, 0]));
  speedMs = BASE_SPEED_MS;
  speedMultiplier = 1;
  running = true;
  // The round is "on" (running=true) as soon as Start is pressed, but
  // everything that actually progresses time — the tick loop, ambient
  // spawning, the score clock — waits until the first direction key, via
  // beginMoving(). Board and pellets are already visible and static in the
  // meantime, so the player has a moment to get oriented instead of the
  // snake immediately taking off.
  waitingForFirstMove = true;

  clearTimeout(positiveRespawnTimeout);
  clearTimeout(ambientSpawnTimeout);
  clearTimeout(slowdownTimeout);
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
  direction = nextDirection;
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
    applyCopingEffect(type);

    clearTimeout(positiveRespawnTimeout);
    positiveRespawnTimeout = setTimeout(spawnPositiveFood, POSITIVE_RESPAWN_DELAY_MS);
    restartLoop();
  } else {
    snake.pop();
  }
}

function applyCopingEffect(type) {
  switch (type.effect) {
    case "shrink": {
      // shrink by shrinkAmount, but never below the starting length
      for (let i = 0; i < (type.shrinkAmount ?? 1); i++) {
        if (snake.length > MIN_LENGTH) snake.pop();
      }
      speedMs = Math.min(BASE_SPEED_MS, speedMs + SPEED_STEP_MS * 2);
      break;
    }
    case "clearNegatives": {
      // reframing undercuts the distortions themselves — remove a handful
      // of whichever ones happen to be on the board right now
      const count = Math.min(type.clearCount ?? negativeFoods.length, negativeFoods.length);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * negativeFoods.length);
        negativeFoods.splice(idx, 1);
      }
      break;
    }
    case "slowdown": {
      // ease the pace for a few seconds, layered on top of speedMs (which
      // keeps tracking distortions/other coping eats independently) rather
      // than overwriting it, so the easing cleanly expires back to whatever
      // speedMs has become by then
      speedMultiplier = type.slowdownFactor ?? 1.5;
      clearTimeout(slowdownTimeout);
      slowdownTimeout = setTimeout(() => {
        speedMultiplier = 1;
        restartLoop();
      }, type.slowdownMs ?? 5000);
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

  // pulsing glow behind each food — brighter/wider for coping pellets
  const pulse = 0.5 + 0.5 * Math.sin(timeMs / 220);
  const allFoods = positiveFood ? [...negativeFoods, positiveFood] : negativeFoods;
  for (const item of allFoods) {
    const isCoping = item.type.kind === "coping";
    const fx = item.x * CELL_PX + CELL_PX / 2;
    const fy = item.y * CELL_PX + CELL_PX / 2;
    const glowR = CELL_PX * ((isCoping ? 1.3 : 0.85) + pulse * 0.35);
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
}

function renderLoop(timeMs) {
  draw(timeMs);
  // Clock stays at 0s while waiting for the first move — startTime isn't
  // set yet at that point (it's set in beginMoving()), so computing against
  // it here would read a stale/undefined value.
  if (running && !waitingForFirstMove) {
    scoreEl.textContent = `${Math.floor((performance.now() - startTime) / 1000)}s`;
  }
  requestAnimationFrame(renderLoop);
}

function gameOver() {
  running = false;
  clearInterval(loopHandle);
  clearTimeout(positiveRespawnTimeout);
  clearTimeout(ambientSpawnTimeout);
  // Was missing: if a "Taking a Small Step" slowdown was still active when
  // the player died, its pending timeout would fire 5s later regardless,
  // reset speedMultiplier, and call restartLoop() — silently reviving the
  // tick loop (and re-triggering gameOver(), replaying its sound and
  // quietly changing the displayed score) well after death.
  clearTimeout(slowdownTimeout);
  playGameOver();
  renderTally(finalTallyEl, DISTORTIONS);
  renderTally(finalCopingEl, COPING);
  const secondsSurvived = Math.floor((performance.now() - startTime) / 1000);
  finalScoreEl.textContent = `${secondsSurvived}s`;
  gameOverEl.classList.remove("hidden");
}

function restartLoop() {
  // Defense in depth for the bug above: whatever calls this, never actually
  // start ticking again once the round is over.
  if (!running) return;
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
  const key = e.key.toLowerCase();
  // True for any key this game ever acts on — used below to block the
  // browser's default scroll/find behavior even in states where we don't
  // actually act on the key (e.g. arrow keys while an overlay is up). This
  // was missing from the overlay branches: they returned without acting on
  // unrecognized keys, but never called preventDefault either, so arrow
  // keys silently scrolled the page again whenever the info modal, the
  // game-over popup, or the ready screen was showing.
  const isOwnKey = Object.prototype.hasOwnProperty.call(DIRECTION_KEYS, key) ||
    key === "enter" || key === " " || key === "escape";

  // Whichever overlay is on top gets the keyboard first, so precedence here
  // has to match the visual stacking order (info modal > game-over popup >
  // ready/start screen > live play):
  if (!infoModalEl.classList.contains("hidden")) {
    if (isOwnKey) e.preventDefault();
    // swallow everything else so arrow keys don't move the snake underneath
    // while someone's reading a definition
    if (key === "escape") hideInfoModal();
    return;
  }

  if (!gameOverEl.classList.contains("hidden")) {
    if (isOwnKey) e.preventDefault();
    // dismiss only — same as the X/backdrop click. Does NOT restart; the
    // player has to press Start again on the screen this reveals.
    if (key === "enter" || key === " " || key === "escape") dismissGameOver();
    return;
  }

  // Not running + no popup showing = the Ready/Start screen, before the
  // very first round or after dismissing game-over.
  if (!running) {
    if (isOwnKey) e.preventDefault();
    if (key === "enter" || key === " ") startGame();
    return;
  }

  const dir = DIRECTION_KEYS[key];
  if (!dir) return;
  // Arrow keys (and space, handled above) scroll the page by default —
  // block that since they're the game's whole control scheme.
  e.preventDefault();
  // prevent reversing directly into the snake's own neck (also blocks
  // turning back into it as the very first move, before anything has moved)
  if (dir.x === -direction.x && dir.y === -direction.y) return;
  nextDirection = dir;
  if (waitingForFirstMove) beginMoving();
}

document.addEventListener("keydown", handleKey);
startBtn.addEventListener("click", startGame);
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
