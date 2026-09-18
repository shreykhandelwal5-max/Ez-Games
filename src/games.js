/**
 * The game catalogue. Everything the shell renders -- cards, artwork, rules,
 * the player chrome and the stats labels -- is driven from this one manifest,
 * so adding a sixth game means adding one entry plus one HTML file.
 *
 * Cover art is inline SVG rather than hosted images: no network request, no
 * layout shift, and the grid paints instantly on a cold cache.
 */
export const GAMES = [
  {
    id: 'gabba-cricket',
    title: 'Gabba Cricket',
    skill: 'Timing & anticipation',
    // Runs scored before five wickets: a fixed stopping rule, so runs compare.
    metric: { key: 'score', direction: 'higher', label: 'Runs per innings', unit: 'runs' },
    testNote: 'Every innings ends at five wickets, so scores are directly comparable.',
    tagline: 'Time the shot, build the innings',
    file: 'games/gabba-cricket.html',
    accent: '#ec4899',
    accent2: '#7c3aed',
    scoreLabel: 'Runs',
    scoreUnit: 'runs',
    goal: 'Score as many runs as you can before you lose 5 wickets.',
    controls: [
      ['Move', 'Mouse moves the batter across the crease'],
      ['Swing', 'Click to play the shot as the ball arrives'],
      ['Shot type', 'Q for a grounded stroke, W for a lofted drive'],
    ],
    tips: [
      'Three dot balls in a row costs you a wicket, so keep the strike rotating.',
      'Lofted shots score sixes but can be caught; strokes are the safer four.',
      'Pace and spin both ramp up after delivery 35.',
    ],
    art: `<defs><linearGradient id="a1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs>
      <rect width="400" height="230" fill="#0b1020"/>
      <ellipse cx="200" cy="215" rx="230" ry="105" fill="#064e3b" opacity=".55"/>
      <path d="M150 230 L175 120 L225 120 L250 230Z" fill="url(#a1)" opacity=".35"/>
      <rect x="193" y="96" width="14" height="46" rx="3" fill="#e2e8f0"/>
      <circle cx="272" cy="86" r="27" fill="#ec4899" opacity=".22"/>
      <circle cx="272" cy="86" r="15" fill="#ec4899"/>
      <g fill="#fff" opacity=".5"><circle cx="70" cy="150" r="4"/><circle cx="330" cy="150" r="4"/><circle cx="120" cy="182" r="4"/></g>`,
  },
  {
    id: 'zen-snake',
    title: 'Zen Snake',
    skill: 'Sustained attention & tracking',
    // A fixed 210-second clock makes raw score a clean rate measure.
    metric: { key: 'score', direction: 'higher', label: 'Points in 210s', unit: 'points' },
    testNote: 'The clock is always 210 seconds, so score is a clean rate measure.',
    tagline: 'Hold the light, absorb the aura',
    file: 'games/zen-snake.html',
    accent: '#00f2ff',
    accent2: '#bc13fe',
    scoreLabel: 'Score',
    scoreUnit: 'points',
    goal: 'Absorb as many drifting orbs as you can before the 210-second timer runs out.',
    controls: [
      ['Move', 'Your glowing trail follows the mouse'],
      ['Absorb', 'Hover over an orb and hold for 1.5s to collect it'],
      ['Pause', 'P or Space'],
    ],
    tips: [
      'Orbs keep drifting while you charge, so track them rather than chase them.',
      'Each orb is worth 10; camp where two orbs are converging.',
      'The timer never stops, so keep moving between captures.',
    ],
    art: `<defs><radialGradient id="a2"><stop offset="0" stop-color="#00f2ff"/><stop offset="1" stop-color="#00f2ff" stop-opacity="0"/></radialGradient>
      <radialGradient id="a2b"><stop offset="0" stop-color="#bc13fe"/><stop offset="1" stop-color="#bc13fe" stop-opacity="0"/></radialGradient></defs>
      <rect width="400" height="230" fill="#12102b"/>
      <circle cx="110" cy="80" r="46" fill="url(#a2b)"/><circle cx="300" cy="170" r="50" fill="url(#a2)"/>
      <path d="M20 190 C110 190 100 60 200 60 S300 170 380 110" stroke="#00f2ff" stroke-width="14" fill="none" opacity=".5" stroke-linecap="round"/>
      <path d="M20 190 C110 190 100 60 200 60 S300 170 380 110" stroke="#fff" stroke-width="4" fill="none" opacity=".7" stroke-linecap="round"/>
      <g fill="#fff" opacity=".45"><circle cx="60" cy="50" r="2"/><circle cx="350" cy="40" r="2"/><circle cx="250" cy="205" r="2"/></g>`,
  },
  {
    id: 'star-connect',
    title: 'Star Connect',
    skill: 'Visual search & precision',
    // Score here is the difficulty the player picked, not how well they did, so
    // the test locks the difficulty and measures completion time instead.
    metric: { key: 'duration', direction: 'lower', label: 'Time on Hard', unit: 'seconds' },
    lockLevel: 'hard',
    testNote: 'Tests lock the difficulty to Hard and measure how fast you finish.',
    tagline: 'Trace the constellation, in order',
    file: 'games/star-connect.html',
    accent: '#00f2ff',
    accent2: '#bc13fe',
    scoreLabel: 'Levels cleared',
    scoreUnit: 'levels',
    progressKind: 'levels',
    levels: ['easy', 'medium', 'hard', 'legendary', 'impossible'],
    goal: 'Link every star in sequence to complete the constellation, across five difficulties.',
    controls: [
      ['Draw', 'Press on the lit star, then drag to the next number'],
      ['Level', 'Pick a difficulty from the dock at the bottom'],
    ],
    tips: [
      'The cyan halo always marks your next target.',
      'On Impossible the stars drift, so lead your cursor ahead of them.',
      'All five difficulties are open from the start, so jump straight to Impossible if you dare.',
    ],
    art: `<rect width="400" height="230" fill="#020814"/>
      <g stroke="#bc13fe" stroke-width="2.5" fill="none" opacity=".85"><path d="M60 150 L120 70 L200 120 L280 60 L345 140 L200 190 Z"/></g>
      <circle cx="280" cy="60" r="20" fill="#00f2ff" opacity=".18"/>
      <g fill="#00f2ff"><circle cx="60" cy="150" r="6"/><circle cx="120" cy="70" r="6"/><circle cx="200" cy="120" r="6"/><circle cx="280" cy="60" r="6"/><circle cx="345" cy="140" r="6"/><circle cx="200" cy="190" r="6"/></g>
      <g fill="#fff" opacity=".35"><circle cx="30" cy="40" r="2"/><circle cx="370" cy="200" r="2"/><circle cx="160" cy="30" r="2"/><circle cx="90" cy="210" r="2"/></g>`,
  },
  {
    id: 'gravity-fall',
    title: 'Gravity Fall',
    skill: 'Divided attention & reaction',
    metric: { key: 'score', direction: 'higher', label: 'Score per life', unit: 'points' },
    testNote: 'One life per run with the same ramp, so scores are comparable.',
    tagline: 'Catch the orbs, defuse the bombs',
    file: 'games/gravity-fall.html',
    accent: '#bc13fe',
    accent2: '#00f2ff',
    scoreLabel: 'Score',
    scoreUnit: 'points',
    goal: 'Catch falling orbs on your platform and never let a bomb touch it.',
    controls: [
      ['Move', 'Mouse steers the platform left and right'],
      ['Defuse', 'Click a falling object to detonate it early'],
    ],
    tips: [
      'Shooting a bomb out of the air is worth 30, triple an orb catch.',
      'Every 200 points raises the level, and everything falls faster.',
      'When the screen is crowded, defuse rather than dodge.',
    ],
    art: `<defs><linearGradient id="a4" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bc13fe" stop-opacity=".55"/><stop offset="1" stop-color="#020617" stop-opacity="0"/></linearGradient></defs>
      <rect width="400" height="230" fill="#010206"/><rect width="400" height="230" fill="url(#a4)"/>
      <g stroke="#fff" opacity=".18" stroke-width="2"><path d="M120 22 L120 46"/><path d="M250 2 L250 22"/><path d="M300 72 L300 94"/></g>
      <g><circle cx="120" cy="60" r="11" fill="#bc13fe"/><circle cx="250" cy="36" r="11" fill="#bc13fe"/><circle cx="300" cy="110" r="15" fill="#ff3131"/><circle cx="170" cy="132" r="15" fill="#ff3131"/></g>
      <rect x="130" y="195" width="140" height="11" rx="5" fill="#00f2ff" opacity=".35"/>
      <rect x="130" y="185" width="140" height="11" rx="5" fill="#00f2ff"/>`,
  },
  {
    id: 'neon-striker',
    title: 'Neon Striker',
    skill: 'Reaction speed & prediction',
    // First-to-five saturates a raw goal count, so measure the margin.
    metric: { key: 'goalDiff', direction: 'higher', label: 'Goal difference', unit: 'goals' },
    testNote: 'Measured as your goals minus the CPU’s, so a 5-0 beats a 5-4.',
    tagline: 'Air hockey, first to five',
    file: 'games/neon-striker.html',
    accent: '#00d2ff',
    accent2: '#ff00ff',
    scoreLabel: 'Wins',
    scoreUnit: 'wins',
    progressKind: 'match',
    goal: 'Beat the CPU to five goals. The match ends the moment either side reaches 5.',
    controls: [
      ['Move', 'Mouse controls your striker on the left half'],
      ['Power shot', 'Hold right-click to charge a faster strike'],
    ],
    tips: [
      'Power shots nearly double puck speed, so save them for open angles.',
      'The CPU tracks the puck lazily on your half; attack from the wings.',
      'Meet the puck moving forward rather than waiting on the goal line.',
    ],
    art: `<rect width="400" height="230" fill="#fff"/>
      <g stroke="#eee" stroke-width="2"><path d="M200 0 L200 230"/></g>
      <circle cx="200" cy="115" r="52" stroke="#f1f1f1" stroke-width="2" fill="none"/>
      <rect x="6" y="70" width="9" height="90" rx="5" fill="#00d2ff"/>
      <rect x="385" y="70" width="9" height="90" rx="5" fill="#ff00ff"/>
      <circle cx="110" cy="115" r="30" fill="#00d2ff"/><circle cx="300" cy="140" r="30" fill="#ff00ff"/>
      <circle cx="205" cy="95" r="12" fill="#1a1a1a"/>`,
  },
];

export const GAME_BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));
