# Beck's Cognitive Model — Snake Prototype

Design log / running memory for this project. Update this file as we go instead of
relying on chat history.

## Concept

A Snake game that visualizes Beck's cognitive model of depression. The player eats
"distortion" pellets; each one grows the snake and makes survival harder — mirroring
how accumulating cognitive distortions compounds vulnerability to depression rather
than just being decorative flavor text.

Core concepts we're drawing on (from the user's own study notes — not reproduced
verbatim from any source, paraphrased for use in code/labels):
- Negative cognitive triad: negative view of self, world, future
- Negative self-schemas (ineptness, self-blame, negative self-evaluation)
- Six patterns of faulty/distorted thinking, used here as the six food types:
  1. Jumping to Conclusions (≈ arbitrary inference)
  2. All-or-Nothing Thinking (≈ dichotomous thinking)
  3. Blowing Things Out of Proportion (≈ exaggeration/magnification)
  4. Overgeneralizing (≈ overgeneralization)
  5. Taking It Personally (≈ personalization)
  6. Tunnel Vision (≈ selective abstraction)

The actual citations/sourcing for the research write-up will be done later by the
user — this file and the code use paraphrased, plain-language labels only.

## Status: v1 prototype (2026-09-17)

Built a working local Snake game:
- `index.html` — page shell, canvas, sidebar UI
- `style.css` — layout/visuals
- `game.js` — game loop, config-driven distortion types, scoring, game over summary

Mechanics:
- Arrow keys / WASD to steer
- 6 distortion pellet types, each a distinct color + label, randomly spawned one at a time
- Eating a pellet: snake grows by 1 segment, tally for that distortion +1, speed ticks up slightly
- Death on wall or self-collision → game over overlay shows final distortion tally
  (seed for a future "cognitive profile" readout tied to the negative triad)

Code is intentionally config-driven (`DISTORTIONS` array in `game.js`) so future
changes don't require touching the game loop:
- adding a 7th distortion or renaming one = edit the array
- adding "positive"/restructuring pellets = new type with a different effect flag
- triad-based zones/hazards = future addition, not yet built

## Update (2026-09-24)

- Visual redesign: card-based dark UI (Inter/JetBrains Mono, gradient background,
  glowing tally dots), canvas now has a faint grid, rounded/fading snake segments,
  simple directional eyes, and a pulsing glow behind the current food pellet.
  Rendering was split into its own `requestAnimationFrame` loop, decoupled from the
  movement tick interval, purely so animation is smooth — game logic/timing unchanged.
- Added a short educational description per distortion type; eating a pellet now
  pops up a toast (label + one-line description, auto-dismisses) over the board.
  Descriptions are short paraphrased one-liners in the user's/assistant's own words,
  not copied from any source — still placeholders pending the real research pass.

## Update (2026-09-24, cont'd)

- Added a second pellet pool: **coping skills** (Checking the Evidence, Reframing
  the Thought, Taking a Small Step), bright/cool-colored, drawn as rotated diamonds
  with a stronger glow — visually distinct from the now-desaturated/muted distortion
  palette. Coping pellets spawn ~25% of the time (`COPING_SPAWN_CHANCE` in game.js).
  Eating one shrinks the snake by 1 (floor of `MIN_LENGTH`, the starting length) and
  slows the game down slightly, mirroring the "this can slow or stop it" mechanic —
  opposite of the distortion pellets' grow + speed-up.
- Distortion palette changed from bright/rainbow to muted, heavier tones to read as
  "negative" rather than fun candy colors.
- Snake trail now darkens gradually from head to tail (color-mixed, not just alpha)
  over the first ~18 segments, to visualize distortions piling up slowly over time.
- Toasts now stay up longer (`TOAST_DISPLAY_MS` = 3200ms, up from 1500ms) and label
  themselves as "Distortion · trail +1" or "Coping strategy · trail −1".
- Sidebar and game-over screen now show two separate tallies (distortions / coping).
- Still config-driven: `DISTORTIONS`, `COPING`, and shared constants at the top of
  `game.js` are the places to tune counts, colors, spawn odds, or add a 4th pool.

## Update (2026-09-24, UI/mechanics fixes)

- **Toasts fixed**: they were stacking indefinitely over the canvas and blocking
  gameplay. Moved them out of the board entirely into a `#toast-dock` below the
  game area (normal document flow, not an overlay), capped concurrent toasts at 3
  (oldest is dismissed early once the cap is hit), and shortened display time to
  2.2s (from 3.2s).
- **Independent spawn pools**: distortions and coping pellets are no longer a
  single shared food slot — `negativeFoods` (array, usually 1) and `positiveFood`
  (single slot or null) exist simultaneously on the board.
  - Eating a distortion respawns another distortion immediately, plus an 18%
    chance of a second one appearing at the same time (capped at
    `MAX_NEGATIVE_FOODS` = 2 total).
  - Eating a coping pellet clears the board's only positive slot and waits
    `POSITIVE_RESPAWN_DELAY_MS` (4.5s) before another appears — deliberately rarer
    and slower than the distortions.
- **Scoring changed to survival time** (seconds since game start), not pellets
  eaten. Sidebar and game-over screen both show `<n>s`. Distortion/coping tallies
  are still tracked and shown separately as informational stats, just no longer
  drive the score.
- **Smaller board**: `GRID_SIZE` 20 → 14 (canvas 400px → 280px), so there's less
  room to dodge as the trail grows.

## Update (2026-09-24, ambient spawn + toast layout fix)

- **Negative pellets now spawn ambiently over time**, not just on eating: a
  `setInterval` (`NEGATIVE_AMBIENT_SPAWN_MS` = 2.6s) adds another distortion pellet
  whenever the board is under the new cap (`MAX_NEGATIVE_FOODS` raised 2 → 5), even
  if the player avoids eating entirely — pressure builds passively.
- **Toast layout fixed**: the dock was in normal document flow, so it pushed the
  page content up/down every time a toast was added or removed. It's now
  `position: fixed` (bottom-centered, `pointer-events: none`), so it floats over
  the page independent of layout and never reflows anything else. Newest toast
  renders closest to the anchor via `flex-direction: column-reverse`.

## Update (2026-09-24, bigger cells)

- Grid changed from 14×14 @ 20px cells (280px canvas) to 10×10 @ 30px cells
  (300px canvas) — fewer, larger cells per the user's request. Starting snake
  position re-centered for the new grid (`(5,5)`,`(4,5)`,`(3,5)`).

## Update (2026-09-29, freeze fix + bug pass + difficulty)

Root cause of the reported mid-game freeze: `showToast`'s cap-enforcement loop
(`while (toastDock.children.length >= MAX_VISIBLE_TOASTS) dismissToast(...)`)
checked the DOM child count, but `dismissToast` doesn't remove the node
synchronously — it waits on a CSS `transitionend`. The count never dropped
inside the loop, so once a 4th toast tried to show up within ~2.2s (easy once
the board got crowded), the tab hard-locked in an infinite loop. Fixed by
counting only non-dismissing toasts and shifting them off a snapshot list.
Also hardened `dismissToast` with a fallback `setTimeout` removal in case a
toast is dismissed before it ever got `.show` (no transition would otherwise
ever fire, leaking the node and making the freeze condition easier to hit).

Other bugs fixed in the same pass:
- **False death on tail-tip move**: collision check tested the whole snake
  including the segment about to vacate (the tail, which pops off this same
  tick when nothing's eaten). Moving into that cell is legal in real Snake;
  now only checked against the full body when a pellet is being eaten (no pop
  that tick), otherwise against everything but the tail.
- **Arrow keys / space scrolled the page** underneath the game — added
  `preventDefault()` on every recognized control key.
- **`randomFreeCell` had no bail-out** — an unlikely-but-real infinite loop if
  the board ever filled completely. Now gives up after 200 attempts and the
  caller skips that spawn instead of hanging.
- **`#coping-list` / `#final-coping` were missing from the list-styling CSS
  rules** (`style.css`) — they rendered as bare unstyled `<ul>`s (default
  bullets, no flex layout, counts not right-aligned) while `#tally-list` /
  `#final-tally` looked correct. Added to all three shared selectors.
- Toast `.show` `max-height` (60px) was clipping longer two-line distortion
  descriptions; raised to 100px.
- Game-over overlay now also restarts on Enter/Space, not just the button
  click, since keyboard is otherwise the whole interface.
- Perf: the tail color-mix (`mixColor`/`hexToRgb`) was being recomputed for
  up to 18 segments on every single animation frame. Precomputed once into a
  `TRAIL_COLOR_RAMP` lookup array since the head/tail colors are constant.

Difficulty (user feedback: game lasted too long/was too easy):
- Board now starts with **8 negative pellets** (`INITIAL_NEGATIVE_FOODS`, was
  1) instead of spawning up gradually, and the live cap raised 5 → 10
  (`MAX_NEGATIVE_FOODS`) so the ambient spawner can keep pace with a crowded
  start rather than immediately sitting idle at the old cap.

## Update (2026-09-29, cont'd — distinct coping effects)

Each coping skill now does something mechanically different, instead of all
three just shrinking the trail by 1 (`applyCopingEffect` in `game.js`
dispatches on a per-type `effect` field, so a 4th coping skill is just a new
config entry + a new `case`):

- **Checking the Evidence** — shrinks the trail by **2** now (was 1, per
  feedback), floored at `MIN_LENGTH`.
- **Reframing the Thought** — `effect: "clearNegatives"`: removes up to
  `clearCount` (3) random distortion pellets currently on the board, rather
  than touching the snake at all. Reframing undercuts the distortions
  themselves, not just your own accumulated trail.
- **Taking a Small Step** — `effect: "slowdown"`: eases the tick speed by a
  `slowdownFactor` (1.6×) for `slowdownMs` (5s), then reverts. Implemented as
  a `speedMultiplier` layered on top of `speedMs` (rather than overwriting
  it), so it cleanly expires back to whatever `speedMs` has drifted to from
  other eats in the meantime instead of stomping that progression.

Toasts now show a per-type `toastLabel` (e.g. "clears distortions", "slows
things down (5s)") instead of a single generic "trail −1" copy for all coping
pellets, since that's no longer universally true.

User flagged wanting more design backing on this later — current three
effects are a first pass, open to revision once that's ready.

## Update (2026-09-29, cont'd — red distortion palette + shrink tuning)

- **Checking the Evidence** now shrinks the trail by **3** (was 2, per feedback).
- **All 6 distortion pellets recolored to shades of red** (`#ff6b6b` light down
  to `#7a1220` dark maroon), replacing the old mixed muted-tone palette
  (rust/olive/slate/plum). Reads as one obvious "this is negative" family at
  a glance, still visually distinct from the coping pool's bright
  teal/green/blue. Individual distortions are still distinguished by label
  text, not color, since 6 reds aren't reliably tellable apart by hue alone.

## Update (2026-09-29, cont'd — info popups, start screen, toast removal, slower pace)

- **Removed the eat-a-pellet toast entirely** (dock, CSS, `showToast`/
  `dismissToast`, all calls) — per feedback that it was interrupting play.
- **Added a "?" info button next to every pellet's label** in the sidebar key
  (and the game-over tallies). Clicking one opens a small modal with that
  pellet's plain-language description plus a one-line mechanical effect
  summary (e.g. "Shrinks the trail by 3."). One delegated click listener
  handles all of them since the buttons get re-created on every
  `renderTally()` call; Escape, the ✕, or clicking the overlay background all
  close it.
- **Added a Start screen.** The game no longer auto-starts on page load —
  an overlay sits directly on the canvas (`#start-overlay`) with instructions
  and a Start button; the sidebar key (with working info buttons) is visible
  and readable underneath/beside it before the player commits to playing.
  Pressing Start (or Enter/Space) calls the same `startGame()` as "Try
  Again". `handleKey` now guards on `!running` up front, covering both
  "not started yet" and "game over" in one place — also fixes a latent crash
  where pressing an arrow key before Start would have thrown (`direction`
  isn't initialized until `resetState()` runs).
- **Slowed the base tick speed**: `BASE_SPEED_MS` 160 → 190.

## Update (2026-09-29, cont'd — layering bug, game-over popup, uncapped ambient spawn)

- **Fixed a real layering bug**: `.board-overlay` (the Ready/Start screen) had
  an explicit `z-index: 5`, but the fullscreen `.overlay` used by both the
  info modal and the game-over popup had no `z-index` at all (defaulting to
  `auto`/0). Since 5 > 0, the start overlay was painting on top of the info
  modal — clicking a "?" opened it, but it rendered underneath and was
  unreadable/unclickable, exactly as reported. Fixed by giving `.overlay` an
  explicit `z-index: 100`, with `#info-modal` bumped to `110` on top of that
  specifically, since the game-over screen's own tallies also have "?"
  buttons now — opening the info modal from inside that popup needs it to
  outrank the popup too, not just tie with it.
- **Removed the "Try Again" button.** The game-over screen is now a plain
  dismissible popup — an ✕ close button (same `.icon-btn` as the info
  modal's), plus clicking the backdrop or pressing Enter/Space/Escape, all
  just dismiss it back to the Ready/Start screen. It no longer restarts
  anything by itself; the player presses Start again from there, same as the
  very first round. `handleKey` now has explicit precedence — info modal,
  then game-over popup, then the ready screen, then live movement — matching
  the visual stacking order so keyboard input always goes to whichever
  overlay is actually on top. Reading a pellet's definition mid-game (via the
  live sidebar key) now also blocks arrow keys from moving the snake
  underneath while the modal's open.
- **Distortions no longer cap out.** Removed `MAX_NEGATIVE_FOODS`; ambient
  spawning now runs on a self-rescheduling `setTimeout` (`scheduleAmbientSpawn`)
  that keeps going indefinitely — normal pace
  (`NEGATIVE_AMBIENT_SPAWN_MS`, 2.6s) while there are fewer than
  `NEGATIVE_SLOWDOWN_THRESHOLD` (10) on the board, then a slower pace
  (`NEGATIVE_AMBIENT_SPAWN_SLOW_MS`, 6s) once at/above it. It only actually
  stops once the board is completely full, via `randomFreeCell`'s existing
  bail-out (`spawnNegativeFood` silently no-ops rather than crashing).

## Update (2026-09-30 — tail camouflage fix)

`TRAIL_TAIL_COLOR` was `#211e2c` (rgb 33,30,44), almost identical to the
canvas background `#14141f` (rgb 20,20,31) — once a segment reached full
darkening (past `TRAIL_DARKEN_SPAN` = 18 segments back) it effectively
vanished into the board, exactly as reported. Fixed two ways:
- Raised `TRAIL_TAIL_COLOR` to `#3f3a58` — still clearly darker/more muted
  than the head, but with real contrast against the background.
- Added a faint white outline (`rgba(255,255,255,0.12)`, 1px) to every body
  segment as a structural safeguard, so no future palette tweak can make the
  tail blend in again without a visible border still giving it away.

## Update (2026-09-30, cont'd — faster distortion spawning)

Per feedback that distortions should "generally spawn faster":
- `NEGATIVE_AMBIENT_SPAWN_MS` 2600 → 1400 (normal pace).
- `NEGATIVE_AMBIENT_SPAWN_SLOW_MS` 6000 → 3200 (crowded-board pace, kept
  proportionally similar to the normal pace).
- `NEGATIVE_DOUBLE_SPAWN_CHANCE` 0.18 → 0.25 (a bit more likely to get two at once on eating one).

## Update (2026-09-30, cont'd — sound effects)

Added sound effects, synthesized with the Web Audio API rather than audio
files, so the game stays a single self-contained page with nothing to host:
- **Eating a distortion**: a short, slightly harsh descending sawtooth blip.
- **Eating a coping pellet**: a bright two-note ascending sine chime.
- **Game over**: a three-note descending triangle-wave phrase.
- **Start**: a short rising blip — this call also doubles as the user
  gesture that unlocks the browser's `AudioContext` on the very first press
  (autoplay policies block audio before any interaction).
- All tones use a fast-attack/exponential-decay gain envelope so they don't
  click/pop at the edges.
- **Added a mute toggle** (🔊/🔇, top-right corner) since forced audio needs
  an off switch — preference persists via `localStorage` (wrapped in
  try/catch; falls back to unmuted if storage is blocked, e.g. private
  browsing). Unsupported browsers (no `AudioContext`) just silently get no
  sound rather than erroring.

## Update (2026-09-30, cont'd — tail still blending in, take 2)

The previous fix (`#3f3a58`) wasn't enough — still too close to the canvas
background in both hue (cool blue/purple) and value once a lot of segments
piled up. Switched to a warm, clearly-distinct dusty maroon (`#7a4a52`)
instead of another dark blue/purple: strong contrast against the cool
near-black background, and it has a nice side effect of visually echoing the
red distortion pellets that grew the trail. Also strengthened the safeguard
outline from `rgba(255,255,255,0.12)` to `0.22`, since the fainter version
wasn't actually giving segments a visible edge, just a hint of one.

## Update (2026-09-30, cont'd — full re-review, two real bugs found)

Went through the whole game again looking for bugs. Found and fixed:

- **Dangling slowdown timer could revive the snake after death.**
  `gameOver()` cleared `positiveRespawnTimeout` and `ambientSpawnTimeout` but
  never `slowdownTimeout`. If "Taking a Small Step" was eaten and the player
  died within its 5-second window, the pending timeout still fired later,
  reset `speedMultiplier`, and called `restartLoop()` — silently restarting
  the tick interval behind the game-over screen (and potentially
  re-triggering `gameOver()` a second time: replaying its sound and quietly
  changing the displayed final score well after the round actually ended).
  Fixed by clearing it in `gameOver()`, plus added `if (!running) return;` as
  the first line of `restartLoop()` itself as defense in depth, so no future
  caller can accidentally resurrect the loop post-death.
- **Arrow keys silently scrolled the page again** whenever the info modal,
  the game-over popup, or the ready screen was up — those branches of
  `handleKey` returned on an unhandled key without calling
  `preventDefault()`, so the fix from earlier only covered live gameplay.
  All three branches now block the browser's default behavior for every key
  this game recognizes, whether or not that key does anything in that state.
- **Responsive bug**: the mute button (top-right corner, absolutely
  positioned) had no reserved space, so a wrapped title on a narrow screen
  could run underneath it. Added symmetric horizontal padding to `header` so
  the centered title stays clear of it without shifting off-center.

## Update (2026-09-30, cont'd — even faster spawning)

Per further feedback ("pellets should spawn faster in general"):
- `NEGATIVE_AMBIENT_SPAWN_MS` 1400 → 800.
- `NEGATIVE_AMBIENT_SPAWN_SLOW_MS` 3200 → 1800.
- `NEGATIVE_DOUBLE_SPAWN_CHANCE` 0.25 → 0.3.

## Open questions / ideas for next passes

- Should there be rare positive/"cognitive restructuring" pellets that shrink the
  snake or slow it down, to reflect that distortions are workable, not just fatal?
- Should the three negative-triad domains (self/world/future) be visual zones/hazards
  on the board rather than just pellet flavor?
- Should the game-over screen map the tally back to which schema(s) it suggests
  (ineptness / self-blame / negative self-evaluation)?
- Difficulty curve: currently linear speed-up per pellet eaten — worth revisiting once
  more mechanics exist.
- Need real sourcing/citations once user does the research pass — labels in code are
  placeholders in the user's own words, not final copy.

## Working agreement

- Keep the game playable/non-broken after each change; prefer additive, config-driven
  edits over rewrites.
- This file is the source of truth for project history — update it at the end of each
  work session with what changed and what's next.
