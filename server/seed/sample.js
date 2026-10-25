// Built-in sample data: the real Oct 25, 2026 plan from Planning Center and the
// Worship Direction from that week's Broadcast Notes. Used while sample mode is
// on, so every screen can be tried before accounts are connected.

const date = '2026-10-25';

const plan = {
  id: '90898002',
  title: 'Orange Sunday · “You Are A Tool”',
  date,
  times: [
    { label: '8:30', start: '08:30' },
    { label: '10:00', start: '10:00' },
    { label: '11:45', start: '11:45' },
  ],
  // [title, type, length seconds, key, servicePosition]
  items: [
    ['TIP TIME', 'header', 0, null, 'during'],
    ['T.I.P. Time [PA]', 'item', 600, null, 'pre'],
    ['Team Huddles', 'item', 600, null, 'pre'],
    ['PRE-ENCOUNTER', 'header', 0, null, 'during'],
    ['Pre-Encounter Set', 'item', 900, null, 'pre'],
    ['VIDEO', 'header', 0, null, 'during'],
    ['Broadcast Pre-Roll', 'item', 300, null, 'pre'],
    ['ONLINE PRE-SHOW [Sam + Burke]', 'item', 0, null, 'pre'],
    ['SZN Intro Video', 'item', 300, null, 'pre'],
    ['Washed (Remix)', 'song', 300, 'B', 'pre'],
    ['WORSHIP', 'header', 0, null, 'during'],
    ['WASHED', 'song', 224, 'B', 'during'],
    ['[Tag] Make A Way', 'song', 186, 'B', 'during'],
    ['Host', 'header', 0, null, 'during'],
    ['Host [Jordan | MJ | Jordan]', 'item', 60, null, 'during'],
    ['Video', 'header', 0, null, 'during'],
    ['Video | Orange Bible Story', 'item', 270, null, 'during'],
    ['Host', 'header', 0, null, 'during'],
    ['Host Moment [Jordan | MJ | Jordan]', 'item', 180, null, 'during'],
    ['Worship', 'header', 0, null, 'during'],
    ['[Shortened] Wild Rushing Wind', 'song', 309, 'D', 'during'],
    ['[TAG] Rest On Us', 'song', 150, 'D', 'during'],
    ['PASTOR RAPPORT', 'header', 0, null, 'during'],
    ['Ministry Moment + Pastor Rapport [PT]', 'item', 180, null, 'during'],
    ['MESSAGE', 'header', 0, null, 'during'],
    ['Message | 8:30A', 'item', 1800, null, 'during'],
    ['Message | 10A + 11:45A', 'item', 2100, null, 'during'],
    ['INVITATION TO RESPOND', 'header', 0, null, 'during'],
    ['Altar Call', 'item', 420, null, 'during'],
    ['You Will Be Saved', 'song', 0, 'D', 'during'],
    ['Outro', 'header', 0, null, 'during'],
    ['Post Host [Jordan | MJ | Jordan]', 'item', 60, null, 'during'],
    ['Post-Encounter', 'header', 0, null, 'during'],
    ['ONLINE POST-SHOW [Sam]', 'item', 120, null, 'post'],
    ['Post-Encounter Set', 'item', 0, null, 'post'],
  ].map(([title, type, length, key, position], i) => ({ id: 's' + i, title, type, length, key, position })),
  // [name, team, position, status]
  people: [
    ['Caleb Grenz', 'Worship', 'Worship Leader', 'C'],
    ['Caleb Grenz', 'Worship', 'Frontline', 'C'],
    ['Austin Loo', 'Worship', 'MD', 'C'],
    ['Austin Loo', 'Worship', 'Bass Guitar', 'C'],
    ['Clyde Stackhouse Jr.', 'Worship', 'Frontline', 'C'],
    ['Linda Carr', 'Worship', 'Frontline', 'C'],
    ['Christina Schroeder', 'Worship', 'Frontline', 'C'],
    ['Craig Carsley', 'Worship', 'Frontline', 'C'],
    ['Craig Carsley', 'Worship', 'Acoustic Guitar', 'C'],
    ['Rachel Hawley', 'Worship', 'Keys', 'C'],
    ['Sam Bryant', 'Worship', 'Drums', 'C'],
    ['Chad Patras', 'Worship', 'Rhythm Electric Guitar', 'C'],
    ['Colton Brayton', 'Worship', 'Lead Electric Guitar', 'U'],
    ['Todd Doxzon', 'Communicators', 'Bible Teacher', 'C'],
    ['Matt Jackson', 'Communicators', 'Encounter Host', 'C'],
    ['Jordan Johnson', 'Communicators', 'Encounter Host', 'C'],
    ['Samuel Petro', 'Communicators', 'Online Host', 'C'],
    ['Burke Florom', 'Communicators', 'Online Co-Host', 'C'],
    ['Adam Deidel', 'Communicators', 'TIP Host', 'C'],
    ['Jozef Kuehn', 'Broadcast Team', 'Broadcast Producer', 'C'],
    ['Kyle Sutton', 'Broadcast Team', 'Video Director', 'C'],
    ['Kaleb Owen', 'Broadcast Team', 'Cam 1', 'C'],
    ['Beckham Kays', 'Broadcast Team', 'Cam 2', 'C'],
    ['Nicole Kays', 'Broadcast Team', 'Cam 3', 'C'],
    ['Brian Kays', 'Broadcast Team', 'Cam 4', 'C'],
    ['Patrick Carsley', 'Broadcast Team', 'Cam 5', 'C'],
    ['Elie Kramo', 'Broadcast Team', 'Cam 6', 'U'],
    ['Adam Deidel', 'Production', 'FOH Audio Engineer', 'C'],
    ['Luke Reelfs', 'Production', 'Broadcast Audio', 'C'],
    ['Kevin Cory', 'Production', 'ProPresenter Operator', 'C'],
    ['David Douglas', 'Production', 'Broadcast ProPresenter Operator', 'C'],
    ['Owen Neighbors', 'Production', 'Lighting Operator', 'C'],
    ['Michaela Dickson', 'Service Management', 'Service Producer', 'C'],
    ['Marissa Sutton', 'Service Management', 'Service Producer', 'C'],
    ['Hector Centeno', 'Service Management', 'Stage Manager', 'C'],
    ['Delaney Reelfs', 'Service Management', 'Floor Manager', 'C'],
  ].map(([name, team, position, s]) => ({ name, team, position, status: s === 'C' ? 'confirmed' : 'unconfirmed' })),
};

// Song bank entries from the Oct 25 Broadcast Notes. Keys are normalized song
// titles (see engine.songKey). Feel always leads with tempo.
const songs = {
  washed: {
    title: 'Washed',
    lead: 'Clyde',
    feel: '139 tempo; driving, celebratory corporate declaration of cleansing. Big full-groove choruses that escalate through post-choruses and refrains.',
    progression: 'Intro → Chorus ×3 → Verse 1 → Verse 2 → Pre-Chorus → Chorus → Verse 3 → Pre-Chorus → Chorus → Post-Chorus ×2 → Tag → Chorus ×2 → Post-Chorus → Refrain 1 → Refrain 2 → Ending',
    notes: 'No transition video — tracks carry it straight into Make A Way (B → B).',
  },
  'make a way': {
    title: '[Tag] Make A Way',
    lead: 'Caleb (Co-Lead)',
    feel: '80 tempo, 6/8; swaying, rolling faith-declaration anthem. Energy shifts from Washed into a wide 6/8 sway. Corporate room moments, smooth pushes and pulls.',
    progression: 'Interlude → Bridge ×4 → Chorus 1 ×2 → Refrain ×4 → Chorus 1 ×2 → Interlude ×4 → Chorus 2 ×6 → Interlude ×2 → Chorus 1 ×2 → Ending',
    notes: '',
    cue: 'Cam 3 pick up host for Host',
  },
  'wild rushing wind': {
    title: '[Shortened] Wild Rushing Wind',
    lead: 'Linda',
    feel: '73 tempo; moderate intensity; big, sweeping, swaying “dawn breaking” corporate anthem. Gently stirring open, picks up into the pre-chorus, breaks down in the chorus, all-in on chorus 2. Crowd focus and vocalist profiles in the big moments.',
    progression: 'Intro (EG) → Verse 1 (Keys) → Verse 2 → Pre-Chorus → Chorus Breakdown (Keys) → Vamp → Pre-Chorus → Chorus All In (EG) → Vamp → Bridge (Crowd) → Bridge → Bridge → Tag 1 ×3 → Vamp → Tracks end into Rest On Us',
    notes: 'CTO-orange lighting — watch color and shading. Shortened: where the tracks end is where the band moves into Rest On Us.',
  },
  'rest on us': {
    title: '[Tag] Rest On Us',
    lead: 'Caleb',
    feel: '72 tempo; band-led, prayerful Spirit invitation. Bridge opens in unison and builds in volume and emotion across four passes in parts, landing in a chorus ×3. Live and flexible — leave space.',
    progression: 'Bridge (Unison) → Bridge ×4 (Parts, Build Volume/Emotion) → Chorus ×3 (Parts)',
    notes: 'No tracks — band-led live, length can flex.',
    cue: 'Cam 3 pick up PT for Pastor Rapport',
  },
  'you will be saved': {
    title: 'You Will Be Saved (Altar)',
    lead: '—',
    feel: '65 tempo; tender altar-call invitation that builds faster than usual. Drums lead into the tom groove almost right away; the band rides that energy up into a full-groove chorus.',
    progression: 'Bridge (Tom Groove, Build Quickly) → Bridge (Bigger) → Chorus (Full Groove, Big Energy)',
    notes: 'Fast build — be ready for the energy jump early.',
    cue: 'Cam 3 pick up host for Post Host',
  },
};

// Starter wireless assignments by Planning Center position. FOH can change
// these in the admin page; once the receivers are networked the battery and
// RF numbers come from the gear instead of the sample generator.
const wireless = {
  'Worship Leader': { mic: 'VOX 1', iem: 'IEM 1' },
  'Frontline#1': { mic: 'VOX 2', iem: 'IEM 3' },
  'Frontline#2': { mic: 'VOX 3', iem: 'IEM 4' },
  'Frontline#3': { mic: 'VOX 4', iem: 'IEM 5' },
  'Frontline#4': { mic: 'VOX 5', iem: 'IEM 6' },
  MD: { mic: 'WIRED', iem: 'IEM 2' },
  Keys: { mic: 'WIRED', iem: 'IEM 7' },
  Drums: { mic: 'WIRED', iem: 'IEM 8' },
  'Rhythm Electric Guitar': { mic: 'WIRED', iem: 'IEM 9' },
  'Lead Electric Guitar': { mic: 'WIRED', iem: 'IEM 10' },
  'Bible Teacher': { mic: 'TEACH' },
  'Encounter Host#1': { mic: 'HH-1' },
  'Encounter Host#2': { mic: 'HH-2' },
};
// The first build's placeholder names; installs still using them get the
// real channel names above.
const oldWirelessMics = ['HH 1', 'TB 1', 'HH 2', 'HH 3', 'HH 4', 'HH 5', 'LAV 1', 'HH 6', 'HH 7'];

module.exports = { date, plan, songs, wireless, oldWirelessMics };
