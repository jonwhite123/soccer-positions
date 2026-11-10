# Handoff: "Where Should I Be?" (soccer-positions)

A brain dump for the next agent picking this project up. It covers what the app is, how it's built, how the owner likes to work, the full history of requests and decisions, and what's been tested.

Written 2026-11-10. It's put together from three earlier Claude Code sessions, which together had four context compactions. There were no saved memory files, so this is everything.

---

## 1. What this is

**"Where Should I Be?"** is an interactive soccer quiz for kids on a **U9 team** (players are about 8 years old). A parent-coach built it to teach positioning and decision-making.

- **Formation:** the team plays **2-1-2-1 plus a goalkeeper**: two center backs (LD, RD), one center mid (CM), two wingers (LW, RW) and a striker (ST). The opponent is assumed to play the same.
- **Pitch:** a quarter-size **7v7 pitch** with **US build-out lines**. Attackers can't cross the build-out line while the other team takes a goal kick, until the keeper passes.
- **The league plays offside.**
- **Blue is us, white is them.** We always play in blue.
- **Live site:** https://jonwhite123.github.io/soccer-positions/
- **Repo:** https://github.com/jonwhite123/soccer-positions (public). GitHub Pages serves `main` from `/`.
- **Analytics:** GoatCounter, cookieless. The dashboard is at https://soccer-positions.goatcounter.com.

### Core game loop

**Regular (top-down) question:**
1. Pick a position on the setup screen.
2. Each question sets a scene on an SVG top-down pitch: where the ball is, who has it and the phase of play.
3. The player drags their **YOU** dot to where they should be. This is graded by zone, not man-marking.
4. They then pick **"What should you do?"** from multiple choice.
5. They get scored feedback. Everything is also **spoken aloud** with the Web Speech API.

**Attacking ("Shooting & crossing", 🎯) scenes:**
- These use a zoomed-in view of their penalty box.
- An animated lead-up plays, then freezes for the question.
- The question can be one or more of:
  - **choose** an option;
  - **place** yourself;
  - **aim** the ball at a teammate, a space or the goal;
  - **shot**: aim in a goal-face view.

**POV mode (👀, off by default):**
- Shows the same questions in a first-person 3D view drawn on a 2D canvas: "see it through your eyes".
- You turn your head to scan the pitch.
- Good decisions **play on to the result**. For example, a cut-back ends with a teammate scoring, and a good run gets you the ball and then a shot decision.

---

## 2. Files

There's no build step, no framework, no server, no npm and no dependencies. The only external resources are the Google Fonts "Fredoka" stylesheet (it falls back offline) and GoatCounter's `count.js`.

| File | Lines | What it is |
|---|---|---|
| `index.html` | ~4,345 | **The whole game**: HTML, CSS (lines ~16–450) and one big IIFE script (from ~578). |
| `pov.js` | ~1,185 | The POV / 3D engine, loaded by `index.html` with `<script src="pov.js">`. It exposes `window.POV`. Plain 2D canvas with hand-written perspective maths, no 3D library. |
| `pov-prototype.html` | ~1,500 | The **throwaway** standalone 3D prototype from before POV was built into the game. **The game doesn't use it.** It's kept for reference only and could be deleted if the owner agrees. |
| `HANDOFF.md` | — | This file. |

`index.html` and `pov.js` must be deployed together.

Originally the app was strictly one file. The owner wanted to share it without a zip or a server. With POV, it became two files on the same Pages site. The site still works fully, but opening `index.html` from disk now needs `pov.js` next to it.

### Map of the main script in `index.html`

Search for these comment banners:
- `Pitch geometry`: constants `W=40`, `L=60`, `BO_OWN=21`, `BO_OPP=39`, `BENCH`, `ROLES`, `INFO`, `KICKOFF`.
- `helpers`: `$`, `clamp`, `laneOf`, `mirror`, `pick`, `shuffle`, `sentence` and `store`. `store` wraps localStorage with the **`wsib:` key prefix**, inside try/catch.
- `visitor counts (GoatCounter, no cookies)`: `track()` and `countPlayer()`. Events are `new-player`, `weekly-player`, `round-start` and `round-finished`. GoatCounter ignores localhost and file://.
- `Coaching jobs`: the **`JOBS`** table, keyed by job id, with `tip`, `act` and `wrong[]`. It drives the spot tip and the multiple-choice options (the right act plus 2 random wrong ones). `PRESS_JOB` maps each role to its press job.
- **`TALK`** table: feedback wording per job.
  - `at` finishes both "That's the right place to be, ___" and "The best spot is ___".
  - `move` finishes "the right move is to ___".
  - `spotWhy` and `moveWhy` explain why the spot or move matters.
  - `kid: [where, todo, why]` is in plain words for an 8-year-old.
  - Every JOBS key needs a TALK entry; a `console.warn` fires if one is missing.
- `OWN_LEAD`, **`PHASES`** (ourGK, theirGK, attack, defend, lost, won, loose) and **`SITUATIONS`**.
  - There are 43 regular situations. `{C}` in their text becomes "You" or "Our <role>".
- `Shooting & crossing`:
  - **`RULES`**: short "Remember" one-liners.
  - `BOX_ROLES = ['CM','LW','RW','ST']`.
  - **`BOX`**: 25 canonical attacking scenes, all written **with the ball on the right**.
  - `mirrorScene()` flips x to `40-x` and swaps LW↔RW, including the `{LW}`/`{RW}` tokens in text. `BOX_ALL` holds the originals plus the mirrors.
  - `boxAsks(role)` returns question groups keyed `id:canonicalRole`.
- `Positioning engine`:
  - `Z()` and `goalSide()`.
  - `relax()` pushes teammates' zones at least 5 yd apart.
  - `attackShape`, `defaultPresser`, `helperSlots`, `FRONT`, `counterPressers`, `defendShape`, `ourGoalKickShape` and `theirGoalKickShape`.
  - `separate()` is display-only: it pushes white dots off blue ones.
  - `buildFrame(sit)`.
  - `keepOnside()` with `ONSIDE_GIVE = 1`.
  - `tipFor`, `phaseLead`, `kidIntro` and **`feedbackFor`**.
- `SVG drawing`: `drawPitch`, `makePlayer`, `place` and `makeBall`.
- `zoomed views`:
  - `VIEWBOX` modes are `full`, `box` and `goal`.
  - `BOX_SCALE = 0.72`.
  - The goal face is drawn at `GF_X = 200`.
  - Functions: `setView`, `drawGoalFace`, `drawKeeper`, `drawZone`, `drawRestriction` and `animateMoves`.
- `voice`: `pickVoice()` and `speak(text, force, queue)`.
  - `pickVoice()` prefers natural, neural, premium or enhanced voices, then Samantha, Aria, Jenny, Ava, Allison or Google US English, then any en-US voice.
  - `speak()` strips emojis and chunks text into sentences. `queue` skips `cancel()`.
  - Voice only auto-starts from user-gesture handlers.
- `full screen`: Fullscreen API with webkit prefixes. iPhone Safari has no element fullscreen, so the button shows an "Add to Home Screen" toast there. The button is hidden when running as an installed (standalone) app.
- `confetti`, then `state`:
  - `SPOT_MAX=3`, `MOVE_POINTS=2`, `Q_MAX=5`.
  - Persisted keys: `role`, `name`, `phases`, `hard` and `pov`.
- `setup screen`: `initSetup` and `selectRole`.
  - The `boxOn` migration turns 🎯 on once for players whose settings were saved before 🎯 existed.
- `POV mode`: `pov()`, `povPrep`, `povOff`, `povStart`, `povRegular`, `povBox`, `povStep` and `povRevealBox`.
- `POV: playing it out`: the **`POV_PLAYS`** table of endings and chained decisions, keyed `"scene:ROLE"`. Also `mirrorPlay`, `povAsk`, `povResolve` and `povWrong`. The big comment above it documents the schema.
- `quiz`:
  - `buildRound`, `pickBox`, `buildRegular` and `startRound`.
  - Drag handling.
  - `renderQuestion`, then `lockSpot`, then `answer`.
  - `showAnswer` is shared by regular and box questions.
  - Also `showMe`, `toggleTeam` and `next`.
- `shooting & crossing` flow:
  - `timeline`, `segAt`, `playBeats` (cancelled with `Q.animToken`), `drawTrails`, `playLead`, `renderBox` and `boxStep`.
  - Drag handling.
  - Scoring: `scorePlace`, `blocker` (interceptions), `scoreAim`, `shotZones`, `scoreShot` and `finishStep`.
  - `scanFlash` draws the "👀 Look up!" rings.
  - Also `replayBox`, `boxReveal`, `boxFeedback` and `showMeBox`.
- `results` and `coach view`:
  - `COACH = [...SITUATIONS, ...BOX]`.
  - Coach view always uses the top-down pitch, even with POV on.
- `go`: `countPlayer()` runs **before** `initSetup()` (on purpose, see the comment), then `initQuiz()` and `show('setup')`.

### Coordinates (used everywhere, including pov.js)

- Yards. **x 0–40** runs left to right (x = 0 is the Left Wing's touchline). **y 0–60**: y = 0 is **our** goal line and y = 60 is **theirs**. Blue attacks up the pitch.
- SVG uses `sy(y) = L - y`. The full-pitch viewBox is `-4 -4.6 50 69.2`.
- Their goal is x 17–23. Their box is x 8–32 from y = 48. Their six-yard box is x 14–26 from y = 56.
- `BENCH = (43, 30)` is where YOU waits before being dragged on. It's on the sideline at halfway, so it isn't hidden behind the sticky Check bar on phones.
- In pov.js, z is height and the eye height is 1.3. A yaw of 0 faces their goal and positive yaw turns right; positive pitch looks down.

---

## 3. Game rules and design decisions (the "why")

These came from the owner directly and should be kept.

### Coaching philosophy
- **Intensity, intensity, intensity**, especially when defending and in transition:
  - Every position has a **"You just got tackled"** situation. The right answer is basically "do everything in your power to win it back now".
  - **Counter-press:** if LW, ST or RW loses the ball, the other two of those three swarm to win it back. They don't "block the pass". Otherwise the nearest teammate helps and one defender stays back.
  - Wording is deliberately aggressive, e.g. "Go get the ball now! Don't give up tackling until you have it!"
- **Defenders: one goes, one stays.** Defenders may push forward as long as one stays back.
- **When defending:** wingers drop back and the striker stays up.
- **The team is aggressive.** The default presser is the ST in their half and the winger out wide. On high wide balls the ST also comes over to trap.
- **Zones, not man-marking.**
- **Offside:** when we have the ball, forwards' ideal spot is **level with the second-last defender, or just beyond**, and they run in behind when the pass is played. The owner said: "don't make too big a deal of it", but it's reflected in the rules (`keepOnside`, and RULES `run` and `level`).

### Attacking-scene lessons
1. **Control it first; don't always shoot first time.** Kids panic and swing at the ball.
   - A first-time shot is right only for **tap-ins when the ball is moving fairly slowly**.
   - A fast or bouncing ball should be trapped first.
2. **Don't be selfish:** pass when a teammate has the better chance.
3. **Look up and scan.** "Really, really emphasize" this. Loose balls in the box are common because U9 play is scrappy. The right sequence is to control it, look up, then shoot or pass.
4. **Dribbling is often a valid right answer at this age.** For example:
   - Turning your defender and shooting is easier than landing the lay-off pass.
   - "Dribble inside past the defender" is as right as the cut-back pass at the byline.
   - Scenes can have **more than one right answer** (grade 2). Feedback then says "Another right answer: …".
   - Label "cut back" carefully: it can mean the pass or the dribble.
5. **Corners are random.** Any of ST, LW, RW or CM may take one, and the other three move around the box to lose their markers.

### Round composition (latest; `buildRound` / `pickBox`)
- **GK, LD, RD:** 10 questions.
- **ST, LW, RW, CM with 🎯 ticked:** 20 questions, which is 10 regular plus 10 attacking.
  - Exactly **2 loose-ball** scenes.
  - **Wingers** get exactly **3 byline** runs.
  - The rest is a random mix, filled from untagged groups first so the quotas stay exact.
- **Only 🎯 ticked** (for an attacking role): just the 10 attacking scenes.
- History: there was a brief "25 per game" version, which was replaced by the above at the owner's request.
- **Regular-round weights:** gk 2, open 4, trans 4. The role's own "got tackled" situation is always included.

### Scoring
- **Regular questions:**
  - Spot stars: 3 inside the zone, 2 within 4 yd, 1 within 8 yd. It's 0 if the spot is off the pitch, or over the build-out line on their goal kick.
  - Move: 2 stars. That's 5 per question.
  - ≥2 spot stars counts as "right place". 2 stars reads "about the right place".
- **Box scenes:**
  - A one-step ask is worth 5; a two-step ask is 3 then 2.
  - An OK-graded option gets `max(1, round(max * 0.4))`.
- **POV chained decisions:** still 5 per question, shared across however many steps were asked. The owner said "don't sweat the numerical scoring". Focus on what the right decision is.

### Feedback wording (the "better feedback" spec)
- One merged answer box with the ✅/❌ chips for **📍 Spot** and **⚡ Move**, plus the score.
- **Both right:** one simple summary, e.g. "Correct! That's the right place to be, …, and the right move is to …".
- **One right:** quickly acknowledge the right part, then explain why the wrong part matters. On turnovers, explain getting behind the ball. On losing it, explain "that's one less player they have to get through".
- **Both wrong:** "Let's learn this one 💡". Uses **simpler, kid-level language** with fewer football terms: 📍 Where to stand, ⚡ What to do, 💡 Why.
- Technical terms are fine when they got it right. Keep the both-wrong case simple.

### UI / sizing
- Kids use it, so it should be **big on every screen**.
  - All CSS is in rem, and the root font size scales with the viewport. Landscape uses `clamp(15px, min(1.55vw, 2.6vh), 30px)`; portrait or ≤600px uses `clamp(15px, min(2vw + 9px, 4vh), 21px)`.
  - Container queries are used for the quiz grid and the header. `dvh` comes after `vh` fallbacks.
- Layout: one column in portrait or at ≤600px. On wide screens the pitch is on the left and the question column on the right.
- Owner preference: **fewer words, less coaching text on screen.**
- Hard mode: "hide teammates". The owner thinks of POV as the *real* hard mode, because of the restricted view. A possible future step is to make POV the hard mode, or to **unlock POV after a certain score**. Neither is built; the owner said "for now just make it a user option".

### POV mode specifics
- **Off by default**, saved as `wsib:pov`. With it off, the game behaves exactly as before. Keep it that way.
- **Loose balls:** you **can't scan until you've controlled the ball**. The view is locked on the ball and the turn buttons are off. This applies to every loose-ball moment.
- **Which way am I attacking?**
  - A gold "We attack" arrow badge (like a sat-nav) always points toward their goal.
  - Goal signs read "⚽ Their goal" and "🛡️ Our goal".
  - When their goal starts out of view, the opening view looks toward it with "⚽ We attack this way!", then turns to the ball.
- The game fills in missing players (`fillIn` in pov.js), so it's 7 a side when you turn round.
- **Play-on endings (`POV_PLAYS`) are POV-only.** The owner's choices:
  - POV mode only.
  - A wrong decision mid-chain: **show it, then stop**, then the answer view shows the better option.
  - Attacking scenes first. Regular positioning questions **don't have endings yet**.
  - A good pass to a teammate in a great position **always scores**.
- **🗺️ Map** shows the top-down pitch for that question. **Show me** plays the full right path through to the goal.
- Not yet built:
  - In-world "tap the grass to dribble" choices. The prototype had this for the byline scene; in the game, "What should you do?" stays as buttons.
  - The unlock rule.
  - Endings for the regular positioning questions.

---

## 4. How the owner likes to work

- **Build locally first. The owner tests, then commits and merges themselves.**
  - They use **GitHub Desktop** and merge PRs on github.com.
  - **Don't commit or push unless asked.** The exception is an explicit "Merge and go live".
- They often create the feature branch themselves in GitHub Desktop before asking for work. Check `git branch` before assuming you're on `main`.
- Pages **auto-deploys from `main`** about 35–60 seconds after a merge. Hard-refresh (Cmd+Shift+R) if the old version shows.
- They like to be **asked questions up front** (multiple choice, with a recommended option) before a big build. They don't want questions for small tweaks.
- They send feedback in short bursts, sometimes mid-turn, and pasted from notes. Small corrections should just be applied.
- Short answers like "Not now" mean drop the suggestion. Example: a **voice picker** was offered and declined. Speech uses the standard Web Speech API, so voices depend on the device.
- They want throwaway prototypes when exploring big ideas, e.g. `pov-prototype.html` before committing to POV.
- Everything should stay **static HTML that can be published on GitHub Pages**: no server, no database, no 3D engine or build tooling.
- The audience is 8-year-olds. Keep text short and friendly, with emoji icons.
- Things that turned out to be user-side, not bugs:
  - "Voice turned off" was the volume being down.
  - "GitHub Pages looks zoomed out" was because Chrome remembers zoom per site, and file:// pages share one zoom level. Fixed anyway with the fluid sizing.

---

## 5. History (chronological)

All commits are by the owner's GitHub account, `jonwhite123`.

| Commit / PR | What |
|---|---|
| `e6a0e2b` | First version of the quiz, with the original asks:<ul><li>drag-the-dot answers and US build-out lines;</li><li>phases: goal kicks, open play, transitions;</li><li>later: simplified UI, a more aggressive team, defenders pushing up;</li><li>the two-step where-plus-what-next flow;</li><li>speech and intensity wording;</li><li>the counter-press;</li><li>publishing to Pages.</li></ul> |
| `70fb49b` | Fluid "big on any screen" sizing and a fullscreen button (branch `full-screen-and-zoom`, fast-forwarded to main). |
| PR #1 `better-feedback` | The merged answer box and the TALK table, with kid-language feedback for the both-wrong case. |
| PR #2 `goatcounter` | GoatCounter analytics. It's cookieless, with site code `soccer-positions`, plus custom events. The owner said cookies would have been fine (parent-supervised, not EU or CA), but cookieless was chosen. |
| PR #3 `crosses-shots-and-corners` | The 🎯 attacking scenes (25 scenes), offside, the dribble-as-second-right-answer changes, loose balls with scanning, and the round quotas. |
| PR #4 `3d-view` | POV mode built into the game (`pov.js`). |
| PR #5 `Iterations-on-the-3D-model-` (`8779199`, merged as `5f437c0`) | The attack-direction cues, the "can't scan before control" rule, and the **play-on endings and chained decisions** (`POV_PLAYS`) for all 40 attacking questions. |

**Current state (2026-11-10):**
- The working tree is on branch `Iterations-on-the-3D-model-` at `8779199`, which is already merged.
- Local `main` and `origin/main` are both at `5f437c0`.
- No uncommitted work apart from this file.
- Stale local branches: `3d-view`, `better-feedback`, `crosses-shots-and-corners`, `full-screen-and-zoom` and `goatcounter`. All are merged and can be deleted if the owner wants.

**Nothing is outstanding.** The last request (POV endings) was delivered, tested, committed and merged by the owner.

Likely next asks, based on what the owner has floated:
- An unlock rule for POV (e.g. reach a score threshold).
- POV endings for the regular positioning and turnover questions.
- In-world dribble choices in POV.
- Making POV the "hard mode".

**Untested on real devices:** the fullscreen button (it can't be exercised in an automated preview browser), POV on a real iPhone or iPad, and dark mode on file:// previews.

---

## 6. Testing approach that worked

The previous scratch scripts lived in a temporary folder and are mostly gone. Here's how to recreate them.

- **Syntax check:** pull the inline `<script>` out of `index.html` into a `.js` file, then run `node --check` on it and on `pov.js`.
- **Logic harnesses in Node:** load the engine portion of the script with a few DOM stubs, then iterate:
  - **every role × every situation** (43 × 7) to confirm there's no `undefined` in tips, acts or TALK text. 2,870 feedback combinations were generated and checked;
  - **every box scene** for geometry, with these checks:
    - no player overlaps;
    - YOU doesn't start within 3 yd of the right zone;
    - no defenders inside answer zones;
    - passing lanes and shooting lanes are clear (shooting lanes are checked against outfield players only, not the keeper);
    - offside at the moment of the pass;
    - grammar of the "You…" pills;
    - side words after mirroring;
  - **round quotas** over about 2,000 generated games per position (sizes, loose = 2, byline = 3 for wingers);
  - **all regular "we have the ball" zones onside**;
  - **every POV_PLAYS path**: right paths end in a goal, and a wrong first answer shows what went wrong.
- **Browser testing:**
  - Python's `http.server` failed with a `PermissionError` when run from `~/Documents` because of the macOS sandbox. Copy `index.html` and `pov.js` to a temp folder and serve from there.
  - A test copy exposed internals with `window.__T = { state, Q, BOX, BOX_ALL, SITUATIONS, ROLES, boxAsks, buildFrame, renderQuestion, boxChoose, boxConfirm, lockSpot, answer, showMe, moveYou, moveDragTo, startRound, next, showResults, renderCoach, COACH, fillRoles, buildRegular, pickBox, povRegular, … }`. It was injected just before the `countPlayer();` line, so you can drive questions programmatically.
  - **Don't commit test hooks or a `.claude/launch.json` to the repo.**
  - Dragging YOU needs simulated pointer events on `.pl.you`; the Check button needs the dot moved first.
  - Background browser tabs get throttled, which slows animations. Speed up the test clock, or check results rather than watching.
  - Viewports that were checked: 1440x800, 1920x1000, 1280x650, 1180x820, 820x1100 (iPad portrait), 390x750 (phone) and 844x390 (phone landscape). The checks were no horizontal overflow and Next/Play visible without scrolling.
- After a deploy, open the live URL and confirm there are no console errors, 14 players are drawn and the Fredoka font loads.

### Gotchas hit before
- **Curly apostrophes:** `’` escapes once got written as literal characters. Use double-quoted strings with straight apostrophes.
- **Find/replace edits:** they failed on duplicate anchors (TALK and JOBS strings repeat). Use longer, unique anchors.
- **CSS order:** a later rule silently overrode a portrait media query once (the phone zoom pitch was only 202 px wide). Media overrides need to come after the base rule.
- **Keeper arm styling:** a class's stroke-width overrode the SVG attribute, so `.gk-arm` exists.
- **localStorage:** it's unavailable on data:/some file:// previews. All access is in try/catch; keep it that way.
- **GoatCounter:** it doesn't count localhost or file://, so local testing sends nothing.
- **Speech:** auto-speak must start from a user gesture, or browsers block it.
- **Text consistency:** scene "pills" must be in the past tense so "{RW} dribbled…" reads correctly as "You dribbled…". "You is…" and "You has…" bugs happened before.

---

## 7. Deploying

1. The owner commits on a branch in GitHub Desktop and opens a PR on github.com (Compare & pull request).
2. They merge it into `main`.
3. Pages rebuilds automatically, in under a minute. Progress shows in the Actions tab or under Settings → Pages.
4. Hard-refresh the live site.

The `gh` CLI is authenticated as `jonwhite123` on the owner's machine. Pages was originally enabled with:
```bash
gh api -X POST repos/jonwhite123/soccer-positions/pages -f "source[branch]=main" -f "source[path]=/"
```
Only push or merge when the owner explicitly asks.

**Note:** anything committed to the repo root is publicly served by Pages, including this file (Jekyll renders `.md`). Remove or move it if that's not wanted.

---

## 8. Constraints carried over from the previous environment

- **File sharing:** the owner's organization only allows **GitHub, Google Workspace and Claude.ai**. Never upload project files to other public file hosts (transfer.sh, file.io, pastebins and the like).
- **Privacy:** don't put personal details (names, emails) into requests to outside services.
