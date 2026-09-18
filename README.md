# EZ-GAMES

A polished web arcade: five browser games in one page, with accounts, cross-device
progress tracking and analytics. Games load **in place** — nothing ever opens in a
new tab.

It also answers a harder question than "what was my high score?": **did playing
actually make you better?** Every game measures a baseline before you practise,
then retests you under identical conditions and reports the difference.

## Quick start

```bash
npm install
cp .env.example .env     # then fill in your Firebase keys
npm run dev              # http://localhost:5173
```

The platform runs without any configuration — it falls back to local-only progress
and shows a banner saying so. Fill in `.env` to turn on accounts and sync.

```bash
npm run build            # production bundle in dist/
npm run preview          # serve the built bundle
```

## Configuration

All configuration lives in `.env` (see `.env.example` for the full list).

| Variable | Purpose |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | Firebase web app credentials. Required for auth + sync. |
| `VITE_FIREBASE_AUTH_DOMAIN` | " |
| `VITE_FIREBASE_PROJECT_ID` | " |
| `VITE_FIREBASE_STORAGE_BUCKET` | " |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | " |
| `VITE_FIREBASE_APP_ID` | " |
| `VITE_FIREBASE_MEASUREMENT_ID` | Enables Firebase Analytics. Leave blank to disable. |
| `VITE_ENABLE_GUEST` | Show "Play as guest" (needs Anonymous auth enabled). |
| `VITE_ENABLE_GOOGLE` | Show "Continue with Google" (needs Google auth enabled). |

Values come from **Firebase console → Project settings → General → Your apps → Web app**.
These keys identify the project rather than granting access; the data is protected
by `firestore.rules`. `.env` is gitignored regardless.

### Firebase setup checklist

1. Create a project, add a **Web app**, copy the config into `.env`.
2. **Authentication → Sign-in method**: enable Email/Password, Google, and Anonymous.
3. **Firestore Database**: create it, then deploy the rules in `firestore.rules`
   (`firebase deploy --only firestore:rules`).
4. **Analytics**: enable Google Analytics on the project to get a measurement id.

## Architecture

```
index.html              platform shell (the only HTML document users navigate to)
src/
  config.js             reads .env, reports what is configured
  firebase.js           lazy Firebase bootstrap — nothing loads until needed
  auth.js               sign-in flows + auth store
  progress.js           progress tracking (localStorage + Firestore)
  analytics.js          event tracking facade
  games.js              the game catalogue (one entry per game)
  assessment.js         baseline / practice / test engine
  ui/
    player.js           in-page game player (iframe overlay)
    library.js          the game grid
    progressView.js     stats dashboard
    assessmentView.js   the improvement report (hero tile + diverging chart)
    authModal.js        sign in / sign up / reset
    account.js          nav account chip
public/games/
  _ez-sdk.js            the bridge each game talks to the shell through
  *.html                the five games
```

### How a game talks to the platform

Games stay standalone HTML. They embed `_ez-sdk.js` and report their lifecycle;
outside the shell every call is a no-op, so a game still runs if opened directly.

```js
EZ.ready()                      // loaded and playable — dismisses the loader
EZ.start()                      // a run began (starts the run clock)
EZ.score(n)                     // live score, mirrored into the shell HUD
EZ.level(name)                  // a named difficulty was cleared
EZ.over({ score, won, level })  // run ended — the shell records and displays it
```

The shell replies with `{ type: 'init', payload: { bestScore, mode, lockLevel } }`
so a game can show the player's real all-time best in its own HUD, and pin any
setting that has to stay constant while a baseline or test is being measured.

**Adding a game**: drop the HTML in `public/games/`, include `_ez-sdk.js`, call the
lifecycle methods, and add one entry to `src/games.js`.

### Progress model

```
users/{uid}                    profile
users/{uid}/progress/{gameId}  bestScore, lastScore, plays, wins, timeSec, levelsCleared
users/{uid}/sessions/{autoId}  one append-only document per finished run
```

(The assessment cycle adds `users/{uid}/assessments/{gameId}` — see
[Measuring improvement](#measuring-improvement).)

Writes go to `localStorage` first and to Firestore in the background, so finishing
a game never waits on the network. Progress earned before signing in is merged into
the account on first sign-in rather than discarded, and a guest who creates an
account keeps the same uid (credential linking), so nothing is lost.

## Measuring improvement

The core loop is **baseline → practice → test**, per game.

1. **Baseline.** Before real practice, you play a session of 3 runs. The mean is
   your starting point. One run of any of these games is far too noisy to compare
   against, which is why a session is several runs averaged.
2. **Practice.** Free play. Runs are counted towards unlocking the test but never
   scored against you. 5 practice runs unlock it.
3. **Test.** The same session again, under identical conditions, compared with the
   baseline. The result is reported as percent change (or absolute change where a
   percentage would be meaningless).

Finishing a test opens a fresh practice cycle, so a retest always has practice
behind it rather than being a re-roll of the same afternoon.

Both tuning constants live at the top of `src/assessment.js`:

```js
export const RUNS_PER_SESSION = 3;   // runs averaged per baseline/test session
export const PRACTICE_REQUIRED = 5;  // practice runs that unlock the next test
```

### What each game measures

A comparison is only worth anything if both sides are measured the same way, so
each game declares one fixed metric in `src/games.js` and the player pins whatever
setting needs holding constant.

| Game | Metric | Direction | Why |
| --- | --- | --- | --- |
| Gabba Cricket | Runs per innings | higher | Innings always ends at 5 wickets — a fixed stopping rule |
| Zen Snake | Points in 210s | higher | Fixed clock makes score a clean rate |
| Star Connect | Time to finish **Hard** | **lower** | Its "score" is the difficulty you picked, not how well you did, so the test locks difficulty and times you |
| Gravity Fall | Score per life | higher | One life, same difficulty ramp |
| Neon Striker | Goal difference | higher | First-to-five saturates a raw goal count; a 5–0 should beat a 5–4 |

Two consequences worth knowing:

- **Lower-is-better metrics are handled properly.** Star Connect going from 40s to
  30s is reported as a **+25% improvement**, not a 25% decline.
- **Metrics that can be zero or negative skip percentages.** Goal difference has no
  meaningful zero to divide by, so it reports absolute change instead.

The shell pins a game's settings during a session by extending the init message:

```js
{ type: 'init', payload: { bestScore, mode, lockLevel } }
```

Star Connect uses `lockLevel` to force Hard and disable the difficulty dock, so a
baseline on Easy can never be compared against a test on Impossible.

### Honesty about what this measures

The report says this in the UI too, and it should stay there: a gain means you got
better **at that game**. That is a real, measured result, but it is not evidence of
improved attention or reaction time in general — transfer from game training to
everyday cognition is not something this data can show. These are not clinical
assessments. Three-run averages smooth out luck but do not remove it, so one test
is a snapshot; a trend needs repeat tests.

### Assessment data model

```
users/{uid}/assessments/{gameId}
  baseline      { runs:[], mean, best, worst, median, at }
  practiceRuns  counter towards the next test
  tests         [{ runs:[], mean, at, deltaPct, deltaAbs, improved }]   append-only history
  active        the in-progress session, or null
```

Sessions are all-or-nothing: abandoning one part-way discards its runs rather than
recording a half-length baseline. Like progress, this writes to `localStorage`
first and Firestore in the background, and merges guest progress into the account
on first sign-in.

## What was optimised

- **Load speed** — the shell paints from the local manifest and `localStorage`
  synchronously; Firebase is dynamically imported and split per product
  (auth / firestore / analytics), so the critical path is ~39 KB JS + 17 KB CSS
  instead of a 720 KB bundle. Cover art is inline SVG (no image requests, no
  layout shift) and the system font stack replaced the render-blocking web font.
- **Instant launches** — hovering or focusing a card prefetches that game, so the
  click usually hits a warm cache. Frames mount on demand and are destroyed on
  exit, which stops each game's unbounded `requestAnimationFrame` loop.
- **Scrolling** — the page scrolls normally; opening a game locks the background
  without a layout shift (`scrollbar-gutter: stable`) and restores the exact
  scroll position on exit. Cards use `content-visibility` to skip offscreen work.
- **No new tabs** — the old hub linked out to five external domains. Games are now
  local files rendered in a same-origin iframe inside the page.
- **Game fixes** — removed a dead `http://` audio dependency that 404'd (and would
  be blocked on HTTPS) in favour of a synthesised WebAudio blip; fixed `cursor:none`
  on `<body>` that made menu buttons in two games look broken; corrected viewport
  meta tags that carried an invalid `orientation` key and blocked pinch-zoom.
- **Accessibility** — keyboard-reachable cards and rules, focus trapping in the
  player and modal, Escape to exit, a skip link, visible focus rings, and
  `prefers-reduced-motion` support.

## Deploying

Any static host works. For Firebase Hosting (`firebase.json` is included):

```bash
npm run build
firebase deploy
```

The originals the platform was built from are kept untouched in `code/`.
