// Starting settings and the six starting display profiles. Every profile is a
// grid (24 columns x 12 rows on a 1920x1080 screen) of widgets. The layout
// editor in the admin page changes these; they're only the first version.

const LEADER_ROLES = [
  'Service Producer',
  'Broadcast Producer',
  'FOH Audio Engineer',
  'Stage Manager',
  'Floor Manager',
  'Encounter Lead',
];

const configDefaults = {
  // Sample mode runs everything on built-in data and a demo clock, so the
  // screens can be tried before any account is connected.
  sampleMode: true,
  demoStart: '10:18', // demo clock time-of-day when the server starts (sample mode)
  timezone: 'America/Chicago',
  campusLabel: 'LCES',
  port: 8080,
  pco: { appId: '', secret: '', serviceTypeId: '427029', refreshMinutes: 5 },
  slack: { botToken: '', refreshHours: 12 },
  propresenter: {
    auditorium: { host: '192.168.10.204', port: 51090, enabled: true }, // auditorium ProPresenter machine (playlist built by hand)
    broadcast: { host: '192.168.10.237', port: 65181, enabled: true }, // broadcast ProPresenter machine
    pollMs: 1000,
  },
  // Shure Axient Digital receivers (AD4D / AD4Q) on the network, e.g.
  // { label: 'AD4Q #1', host: '192.168.10.61', enabled: true }
  wireless: {
    receivers: [
      { label: 'AD4D · Belt packs', host: '192.168.10.202', enabled: true },
      { label: 'AD4Q · Handhelds', host: '192.168.10.243', enabled: true },
      { label: 'AD4Q · Teaching', host: '192.168.10.244', enabled: true },
    ],
  },
  leaderRoles: LEADER_ROLES,
  // When true, a leader account can send messages only on days that person is
  // scheduled in one of the leaderRoles in Planning Center. Admins can always send.
  onlyScheduledLeaders: true,
  messageDefaultSeconds: 60, // messages clear after a minute unless the sender picks otherwise
};

// Order locations appear in on a screen's room picker.
const LOCATIONS = ['Broadcast', 'The Dock', 'The Greenroom', 'FOH', 'Stage', 'Pre-/Post-Show'];

// Preshow dashboards start as a copy of the Live one with the item timer
// swapped for "Encounter starts in" (the preshow timer tile is already there
// where Live has one). Edit them in Admin → Displays.
function preshowFrom(live) {
  const widgets = JSON.parse(JSON.stringify((live && live.widgets) || []));
  for (const x of widgets) {
    if (x.type === 'itemRemaining') {
      x.type = 'countdown';
      x.opts = { target: 'encounterStart', label: 'ENCOUNTER STARTS IN', accent: true, compact: !!(x.opts && x.opts.compact) };
    }
  }
  if (!widgets.some((x) => x.type === 'preshow')) {
    const big = widgets.find((x) => x.type === 'countdown' && x.opts && x.opts.target === 'streamEnd');
    if (big) Object.assign(big, { type: 'preshow', opts: { compact: !!(big.opts && big.opts.compact) } });
  }
  return { widgets };
}

// The preshow host's talking points (edit in Admin → Displays → Preshow Confidence).
const PRESHOW_POINTS = '• Welcome\n• 1, 2, 5\n• Take A Next Step!\n• Pitch to :30 Countdown';

function w(id, type, x, y, wd, h, opts = {}) {
  return { id, type, x, y, w: wd, h, opts };
}

const profiles = {
  broadcast: {
    name: 'Broadcast Control',
    location: 'Broadcast',
    modeSetting: 'auto', // 'auto' (pre-encounter, then live during each Encounter), 'pre' or 'live'
    style: {},
    layouts: {
      live: {
        widgets: [
          w('t', 'title', 0, 0, 4, 2, { title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 4, 0, 4, 2, { seconds: true }),
          w('ir', 'itemRemaining', 8, 0, 4, 2, {}),
          w('se', 'countdown', 12, 0, 4, 2, { target: 'streamEnd', label: 'STREAM ENDS IN', accent: true }),
          w('pf', 'projected', 16, 0, 8, 2, { label: 'ENCOUNTER RUNNING' }),
          w('ros', 'runOfShow', 0, 2, 6, 9, {}),
          w('sn', 'songNow', 6, 2, 9, 4, { showFeel: true, showProgression: true }),
          w('st', 'faces', 6, 6, 9, 5, { group: 'stage', label: 'ON STAGE' }),
          w('sl', 'slide', 15, 2, 9, 3, { which: 'current', source: 'auditorium' }),
          w('cm', 'faces', 15, 5, 9, 3, { group: 'communicators', label: 'COMMUNICATORS' }),
          w('hh', 'handhelds', 15, 8, 9, 3, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
      pre: {
        widgets: [
          w('t', 'title', 0, 0, 4, 2, { title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 4, 0, 4, 2, { seconds: true }),
          w('pos', 'countdown', 8, 0, 4, 2, { target: 'nextStart', label: '{next} STARTS IN' }),
          w('fs', 'countdown', 12, 0, 4, 2, { target: 'nextStreamStart', label: 'STREAM STARTS IN', accent: true }),
          w('ps', 'preshow', 16, 0, 8, 2, {}),
          w('enc', 'encountersToday', 0, 2, 24, 1, { compact: true }),
          w('ros', 'runOfShowDay', 0, 3, 6, 8, {}),
          w('st', 'faces', 6, 3, 9, 4, { group: 'stage', label: 'WHO YOU’LL SEE ON STAGE' }),
          w('cm', 'faces', 6, 7, 9, 4, { group: 'communicators', label: 'COMMUNICATORS' }),
          w('wd', 'worshipDirection', 15, 3, 9, 8, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, { idleText: 'Pre-encounter · switches to Live automatically before each Encounter' }),
        ],
      },
      preshow: {
        widgets: [
          w('t', 'title', 0, 0, 6, 2, { title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 6, 0, 6, 2, { seconds: true }),
          w('es', 'countdown', 12, 0, 6, 2, { target: 'encounterStart', label: 'ENCOUNTER STARTS IN', accent: true }),
          w('ps', 'preshow', 18, 0, 6, 2, {}),
          w('ros', 'runOfShow', 0, 2, 6, 9, {}),
          w('sn', 'songNow', 6, 2, 9, 4, { showFeel: true, showProgression: true }),
          w('st', 'faces', 6, 6, 9, 5, { group: 'stage', label: 'ON STAGE' }),
          w('fu', 'firstUp', 15, 2, 9, 3, {}),
          w('cm', 'faces', 15, 5, 9, 3, { group: 'communicators', label: 'COMMUNICATORS' }),
          w('hh', 'handhelds', 15, 8, 9, 3, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
    },
  },
  'broadcast-audio': {
    name: 'Broadcast Audio',
    location: 'Broadcast',
    modeSetting: 'auto',
    style: {},
    layouts: {
      pre: {
        widgets: [
          w('t', 'title', 0, 0, 4, 2, { title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 4, 0, 4, 2, { seconds: true }),
          w('pos', 'countdown', 8, 0, 4, 2, { target: 'nextStart', label: '{next} STARTS IN' }),
          w('fs', 'countdown', 12, 0, 4, 2, { target: 'nextStreamStart', label: 'STREAM STARTS IN', accent: true }),
          w('ps', 'preshow', 16, 0, 8, 2, {}),
          w('enc', 'encountersToday', 0, 2, 24, 1, { compact: true }),
          w('ros', 'runOfShowDay', 0, 3, 6, 8, {}),
          w('cm', 'faces', 6, 3, 9, 3, { group: 'communicators', label: 'COMMUNICATORS' }),
          w('wd', 'worshipDirection', 6, 6, 9, 5, {}),
          w('mic', 'worshipMics', 15, 3, 9, 5, {}),
          w('hh', 'handhelds', 15, 8, 9, 3, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, { idleText: 'Pre-encounter · switches to Live automatically before each Encounter' }),
        ],
      },
      preshow: {
        widgets: [
          w('t', 'title', 0, 0, 4, 2, { title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 4, 0, 4, 2, { seconds: true }),
          w('pos', 'countdown', 8, 0, 4, 2, { target: 'nextStart', label: '{next} STARTS IN' }),
          w('es', 'countdown', 12, 0, 4, 2, { target: 'encounterStart', label: 'ENCOUNTER STARTS IN', accent: true }),
          w('ps', 'preshow', 16, 0, 8, 2, {}),
          w('ros', 'runOfShow', 0, 2, 6, 9, {}),
          w('cm', 'faces', 6, 2, 11, 3, { group: 'communicators', label: 'COMMUNICATORS' }),
          w('fu', 'firstUp', 6, 5, 11, 2, {}),
          w('sl', 'slide', 6, 7, 11, 3, { which: 'current', source: 'auditorium' }),
          w('sx', 'slide', 6, 10, 11, 1, { which: 'next', source: 'auditorium' }),
          w('wl', 'wirelessList', 17, 2, 7, 5, {}),
          w('hh', 'handhelds', 17, 7, 7, 4, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
      live: {
        widgets: [
          w('t', 'title', 0, 0, 6, 2, { title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 6, 0, 6, 2, { seconds: true }),
          w('ir', 'itemRemaining', 12, 0, 6, 2, {}),
          w('se', 'countdown', 18, 0, 6, 2, { target: 'streamEnd', label: 'STREAM ENDS IN', accent: true }),
          w('ros', 'runOfShow', 0, 2, 6, 9, {}),
          w('sn', 'songNow', 6, 2, 11, 3, { showFeel: true, showProgression: true }),
          w('sl', 'slide', 6, 5, 11, 3, { which: 'current', source: 'auditorium' }),
          w('sx', 'slide', 6, 8, 11, 3, { which: 'next', source: 'auditorium' }),
          w('wl', 'wirelessList', 17, 2, 7, 9, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
    },
  },
  dock: {
    name: 'The Dock',
    location: 'The Dock',
    mode: 'live',
    modeSetting: 'auto',
    style: { collage: true },
    layouts: {
      live: {
        style: { collage: false },
        widgets: [
          w('t', 'title', 0, 0, 6, 1, { kicker: 'THE DOCK', title: 'Who’s Serving Today', compact: true }),
          w('c', 'clock', 6, 0, 6, 1, { compact: true }),
          w('se', 'countdown', 12, 0, 6, 1, { target: 'streamEnd', label: 'STREAM ENDS IN', accent: true, compact: true }),
          w('ns', 'countdown', 18, 0, 6, 1, { target: 'nextStart', label: '{next} STARTS IN', compact: true }),
          w('et', 'encountersToday', 0, 1, 24, 1, { compact: true }),
          w('ros', 'runOfShow', 0, 2, 6, 9, {}),
          w('cr', 'faces', 6, 2, 9, 5, { group: 'stage+communicators', look: 'portrait' }),
          w('bt', 'faces', 6, 7, 9, 4, { group: 'broadcast', label: 'BROADCAST TEAM', look: 'portrait' }),
          w('pr', 'faces', 15, 2, 9, 5, { group: 'production', label: 'PRODUCTION TEAM', look: 'portrait' }),
          w('sm', 'faces', 15, 7, 9, 4, { group: 'service', label: 'SERVICE MANAGEMENT', look: 'portrait' }),
          w('mb', 'messageBar', 0, 11, 24, 1, { legend: true }),
        ],
      },
      preshow: {
        style: { collage: false },
        widgets: [
          w('t', 'title', 0, 0, 6, 1, { kicker: 'THE DOCK', title: 'Who’s Serving Today', compact: true }),
          w('c', 'clock', 6, 0, 6, 1, { compact: true }),
          w('ps', 'preshow', 12, 0, 6, 1, { compact: true }),
          w('es', 'countdown', 18, 0, 6, 1, { target: 'encounterStart', label: 'ENCOUNTER STARTS IN', compact: true }),
          w('et', 'encountersToday', 0, 1, 24, 1, { compact: true }),
          w('ros', 'runOfShow', 0, 2, 6, 9, {}),
          w('cr', 'faces', 6, 2, 9, 5, { group: 'stage+communicators', look: 'portrait' }),
          w('bt', 'faces', 6, 7, 9, 4, { group: 'broadcast', label: 'BROADCAST TEAM', look: 'portrait' }),
          w('pr', 'faces', 15, 2, 9, 5, { group: 'production', label: 'PRODUCTION TEAM', look: 'portrait' }),
          w('sm', 'faces', 15, 7, 9, 4, { group: 'service', label: 'SERVICE MANAGEMENT', look: 'portrait' }),
          w('mb', 'messageBar', 0, 11, 24, 1, { legend: true }),
        ],
      },
      pre: {
        style: { collage: false },
        widgets: [
          w('t', 'title', 0, 0, 8, 1, { kicker: 'THE DOCK', title: 'Who’s Serving Today', compact: true }),
          w('c', 'clock', 8, 0, 8, 1, { compact: true }),
          w('ns', 'countdown', 16, 0, 8, 1, { target: 'nextStart', label: '{next} STARTS IN', accent: true, compact: true }),
          w('et', 'encountersToday', 0, 1, 24, 1, { compact: true }),
          w('ros', 'runOfShowDay', 0, 2, 6, 9, {}),
          w('cr', 'faces', 6, 2, 9, 5, { group: 'stage+communicators', look: 'portrait' }),
          w('bt', 'faces', 6, 7, 9, 4, { group: 'broadcast', label: 'BROADCAST TEAM', look: 'portrait' }),
          w('sm', 'faces', 15, 2, 9, 5, { group: 'service', label: 'SERVICE MANAGEMENT', look: 'portrait' }),
          w('pr', 'faces', 15, 7, 9, 4, { group: 'production', label: 'PRODUCTION TEAM', look: 'portrait' }),
          w('mb', 'messageBar', 0, 11, 24, 1, { legend: true }),
        ],
      },
    },
  },
  greenroom: {
    name: 'The Greenroom',
    location: 'The Greenroom',
    modeSetting: 'auto',
    style: {},
    layouts: {
      preshow: {
        widgets: [
          w('t', 'title', 0, 0, 6, 2, { title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 6, 0, 6, 2, { seconds: true }),
          w('ps', 'preshow', 12, 0, 6, 2, {}),
          w('es', 'countdown', 18, 0, 6, 2, { target: 'encounterStart', label: 'ENCOUNTER STARTS IN', accent: true }),
          w('nn', 'nowNext', 0, 2, 24, 1, {}),
          w('mic', 'worshipMics', 0, 3, 12, 8, {}),
          w('cm', 'faces', 12, 3, 12, 8, { group: 'communicators', label: 'COMMUNICATORS' }),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
      pre: {
        widgets: [
          w('t', 'title', 0, 0, 6, 2, { title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 6, 0, 6, 2, { seconds: true }),
          w('ss', 'countdown', 12, 0, 6, 2, { target: 'nextStreamStart', label: 'STREAM STARTS IN' }),
          w('es', 'countdown', 18, 0, 6, 2, { target: 'encounterStart', label: 'ENCOUNTER STARTS IN' }),
          w('ros', 'runOfShowDay', 0, 2, 6, 9, {}),
          w('mic', 'worshipMics', 6, 2, 18, 9, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
      live: {
        widgets: [
          w('t', 'title', 0, 0, 4, 2, { title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 4, 0, 4, 2, { seconds: true }),
          w('se', 'countdown', 8, 0, 4, 2, { target: 'streamEnd', label: 'STREAM ENDS IN' }),
          w('ns', 'countdown', 12, 0, 4, 2, { target: 'nextStart', label: '{next} STARTS IN' }),
          w('ir', 'itemRemaining', 16, 0, 8, 2, { accent: true }),
          w('ros', 'runOfShow', 0, 2, 6, 9, {}),
          w('sl', 'slide', 6, 2, 11, 5, { which: 'current', source: 'auditorium' }),
          w('sx', 'slide', 6, 7, 11, 4, { which: 'next', source: 'auditorium' }),
          w('wl', 'wirelessList', 17, 2, 7, 9, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
    },
  },
  foh: {
    name: 'FOH ProP',
    location: 'FOH',
    mode: 'live',
    modeSetting: 'auto',
    style: {},
    layouts: {
      live: {
        widgets: [
          w('t', 'title', 0, 0, 4, 2, { kicker: 'FOH PROP', title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 4, 0, 5, 2, { seconds: true }),
          w('ir', 'itemRemaining', 9, 0, 5, 2, { accent: true }),
          w('se', 'countdown', 14, 0, 5, 2, { target: 'streamEnd', label: 'STREAM ENDS IN' }),
          w('pf', 'projected', 19, 0, 5, 2, { label: 'ENCOUNTER RUNNING' }),
          w('ros', 'runOfShow', 0, 2, 6, 9, {}),
          w('sn', 'songNow', 6, 2, 11, 3, { showFeel: false, showProgression: true }),
          w('nd', 'needs', 6, 5, 11, 4, {}),
          w('ky', 'keys', 6, 9, 11, 2, {}),
          w('wl', 'wirelessList', 17, 2, 7, 9, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
      pre: {
        widgets: [
          w('t', 'title', 0, 0, 4, 2, { kicker: 'FOH PROP', title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 4, 0, 5, 2, { seconds: true }),
          w('bs', 'countdown', 9, 0, 5, 2, { target: 'nextBandToStage', label: 'BAND TO STAGE IN' }),
          w('ns', 'countdown', 14, 0, 5, 2, { target: 'nextStart', label: 'ENCOUNTER STARTS IN', accent: true }),
          w('ss', 'countdown', 19, 0, 5, 2, { target: 'nextStreamStart', label: 'STREAM STARTS IN' }),
          w('ros', 'runOfShow', 0, 2, 6, 9, {}),
          w('ky', 'keys', 6, 2, 11, 2, {}),
          w('wd', 'worshipDirection', 6, 4, 11, 7, { compact: true }),
          w('wl', 'wirelessList', 17, 2, 7, 9, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
    },
  },
  // Confidence monitor for the online preshow hosts (replaces the timer on
  // the Broadcast ProPresenter stage display). Big preshow countdown, what's
  // on the stream, and producer messages.
  'preshow-confidence': {
    name: 'Pre-/Post-Show Teleprompter',
    location: 'Pre-/Post-Show',
    modeSetting: 'auto',
    style: { black: true },
    layouts: {
      // Like the old ProPresenter preshow stage display: live time on top, the
      // host's talking points (edited on the Live page), then a very large
      // countdown into and through the 4:30 preshow.
      pre: {
        widgets: [
          w('t', 'title', 0, 0, 12, 1, { title: '{encounter} Encounter', sub: 'phase', compact: true }),
          w('c', 'clock', 12, 0, 12, 1, { seconds: true, compact: true }),
          w('pts', 'text', 0, 1, 12, 3, { label: 'PRESHOW POINTS', source: 'preshowPoints', size: 72 }),
          w('ps', 'preshow', 0, 4, 12, 6, { huge: true, fallback: 'countdown', fallbackOpts: { target: 'nextStart', label: '{next} ENCOUNTER STARTS IN', huge: true } }),
          w('cm', 'faces', 12, 1, 12, 5, { group: 'communicators', label: 'COMMUNICATORS' }),
          w('sm', 'faces', 12, 6, 12, 4, { group: 'service', label: 'SERVICE MANAGEMENT' }),
          w('mb', 'messageBar', 0, 10, 24, 2, { big: true }),
        ],
      },
      preshow: {
        widgets: [
          w('t', 'title', 0, 0, 12, 1, { title: '{encounter} Encounter', sub: 'phase', compact: true }),
          w('c', 'clock', 12, 0, 12, 1, { seconds: true, compact: true }),
          w('pts', 'text', 0, 1, 10, 9, { label: 'PRESHOW POINTS', source: 'preshowPoints', size: 72 }),
          w('ps', 'preshow', 10, 1, 14, 9, { huge: true }),
          w('mb', 'messageBar', 0, 10, 24, 2, { big: true }),
        ],
      },
      live: {
        widgets: [
          w('t', 'title', 0, 0, 6, 2, { title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 6, 0, 6, 2, {}),
          w('se', 'countdown', 12, 0, 6, 2, { target: 'streamEnd', label: 'STREAM ENDS IN', accent: true }),
          w('ns', 'countdown', 18, 0, 6, 2, { target: 'nextStart', label: '{next} STARTS IN' }),
          w('nn', 'nowNext', 0, 2, 24, 1, { compact: true }),
          w('cm', 'faces', 0, 3, 12, 4, { group: 'communicators', label: 'COMMUNICATORS' }),
          w('sm', 'faces', 0, 7, 12, 3, { group: 'service', label: 'SERVICE MANAGEMENT' }),
          w('sl', 'slide', 12, 3, 12, 7, { which: 'current', source: 'auditorium' }),
          w('mb', 'messageBar', 0, 10, 24, 2, { big: true }),
        ],
      },
    },
  },
  // FOH monitor 2: every mic and IEM with faces, battery and RF.
  'foh-wireless': {
    name: 'FOH Audio',
    location: 'FOH',
    mode: 'live',
    modeSetting: 'auto',
    style: {},
    layouts: {
      live: {
        widgets: [
          w('t', 'title', 0, 0, 6, 2, { kicker: 'FOH AUDIO', title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 6, 0, 6, 2, { seconds: true }),
          w('ir', 'itemRemaining', 12, 0, 6, 2, { accent: true }),
          w('se', 'countdown', 18, 0, 6, 2, { target: 'streamEnd', label: 'STREAM ENDS IN' }),
          w('wm', 'worshipMics', 0, 2, 16, 9, {}),
          w('wl', 'wirelessList', 16, 2, 8, 9, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
      pre: {
        widgets: [
          w('t', 'title', 0, 0, 4, 2, { kicker: 'FOH AUDIO', title: '{encounter} Encounter', sub: 'phase' }),
          w('c', 'clock', 4, 0, 4, 2, {}),
          w('ss', 'countdown', 8, 0, 4, 2, { target: 'nextStreamStart', label: 'STREAM STARTS IN' }),
          w('ps', 'preshow', 12, 0, 4, 2, {}),
          w('ns', 'countdown', 16, 0, 8, 2, { target: 'nextStart', label: 'ENCOUNTER STARTS IN', accent: true }),
          w('ros', 'runOfShowDay', 0, 2, 6, 9, {}),
          w('sm', 'faces', 6, 2, 9, 5, { group: 'service', label: 'SERVICE MANAGEMENT', look: 'badge' }),
          w('pr', 'faces', 6, 7, 9, 4, { group: 'production', label: 'PRODUCTION TEAM', look: 'badge' }),
          w('wm', 'worshipMics', 15, 2, 9, 9, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
    },
  },
  // FOH monitor 3: big timers and producer messages.
  'foh-timers': {
    name: 'Service Producer',
    location: 'FOH',
    mode: 'live',
    modeSetting: 'auto',
    style: {},
    layouts: {
      live: {
        widgets: [
          w('c', 'clock', 0, 0, 8, 3, { seconds: true }),
          w('ir', 'itemRemaining', 8, 0, 8, 3, { accent: true }),
          w('se', 'countdown', 16, 0, 8, 3, { target: 'streamEnd', label: 'STREAM ENDS IN' }),
          w('sn', 'songNow', 0, 3, 16, 6, { showFeel: false, showProgression: true }),
          w('pf', 'projected', 16, 3, 8, 2, { label: 'ENCOUNTER RUNNING' }),
          w('pt', 'propTimers', 16, 5, 8, 4, { source: 'auditorium' }),
          w('mb', 'messageBar', 0, 9, 24, 3, { big: true }),
        ],
      },
      pre: {
        widgets: [
          w('c', 'clock', 0, 0, 8, 3, { seconds: true }),
          w('bs', 'countdown', 8, 0, 8, 3, { target: 'nextBandToStage', label: 'BAND TO STAGE IN' }),
          w('ns', 'countdown', 16, 0, 8, 3, { target: 'nextStart', label: '{next} STARTS IN', accent: true }),
          w('ss', 'countdown', 0, 3, 8, 3, { target: 'nextStreamStart', label: 'STREAM STARTS IN' }),
          w('fu', 'firstUp', 8, 3, 16, 3, {}),
          w('et', 'encountersToday', 0, 6, 24, 1, {}),
          w('ky', 'keys', 0, 7, 24, 2, {}),
          w('mb', 'messageBar', 0, 9, 24, 3, { big: true }),
        ],
      },
    },
  },
  stage: {
    name: 'Stage Display',
    location: 'Stage',
    mode: 'live',
    modeSetting: 'auto',
    style: { black: true },
    layouts: {
      live: {
        widgets: [
          w('nn', 'nowNext', 0, 0, 16, 1, { compact: true, nowOnly: true }),
          w('ir', 'itemRemaining', 16, 0, 4, 1, { compact: true, label: 'SONG' }),
          w('c', 'clock', 20, 0, 4, 1, { compact: true }),
          w('sc', 'slide', 0, 1, 24, 7, { which: 'current', source: 'auditorium' }),
          w('sx', 'slide', 0, 8, 24, 2, { which: 'next', source: 'auditorium' }),
          w('mb', 'messageBar', 0, 10, 24, 2, { big: true }),
        ],
      },
      pre: {
        widgets: [
          w('et', 'encountersToday', 0, 0, 18, 1, { compact: true }),
          w('c', 'clock', 18, 0, 6, 1, { compact: true }),
          w('ns', 'countdown', 0, 1, 24, 6, { target: 'nextStart', label: '{next} ENCOUNTER STARTS IN', huge: true }),
          w('fu', 'firstUp', 0, 7, 24, 3, {}),
          w('mb', 'messageBar', 0, 10, 24, 2, { big: true }),
        ],
      },
    },
  },
};

const dbDefaults = {
  accounts: [],
  // Sign-in roles. Pick the role you're serving in today and enter its PIN
  // (set by an admin in Accounts). positions = the Planning Center position
  // names that count as this role, so the app knows who's signed in.
  roles: [
    // FOH Audio: messages and every mic / IEM assignment. Producers can do all of
    // that plus Live control (run of show, preshow, subs, recording, rehearsal).
    { id: 'foh', name: 'FOH Audio', positions: ['FOH Audio Engineer', 'FOH Engineer'], perms: ['messages', 'wireless', 'handhelds'] },
    { id: 'service-producer', name: 'Service Producer', positions: ['Service Producer'], perms: ['messages', 'live', 'subs', 'wireless', 'handhelds'] },
    { id: 'broadcast-producer', name: 'Broadcast Producer', positions: ['Broadcast Producer', 'Producer'], perms: ['messages', 'live', 'subs', 'recording', 'wireless', 'handhelds'] },
    { id: 'stage-manager', name: 'Stage Manager', positions: ['Stage Manager'], perms: ['messages'] },
    { id: 'floor-manager', name: 'Floor Manager', positions: ['Floor Manager'], perms: ['messages', 'handhelds'] },
    // Directors: full access. The Technical Director outranks the other two:
    // only they (and personal admin accounts) manage Roles & PINs and admins.
    { id: 'technical-director', name: 'Technical Director', positions: ['Technical Director'], perms: ['admin', 'roles'] },
    { id: 'production-director', name: 'Production Director', positions: ['Production Director'], perms: ['admin'] },
    { id: 'broadcast-director', name: 'Broadcast Director', positions: ['Broadcast Director'], perms: ['admin'] },
  ],
  sessions: {},
  messages: [],
  quickMessages: [
    'Band to stage',
    'Pastor, 5 minutes',
    'Stretch 2 minutes',
    'Wrap it up',
    'Battery swap · ',
    'Halftime huddle in 5',
  ],
  schedule: {
    // Default Sunday. Times are local (America/Chicago). Stream windows are
    // what the stream-end countdown uses until Resi sync exists.
    encounters: [
      // Broadcast windows: 8:15–9:40 and 9:45–11:40. 11:45 isn't streamed
      // (blank stream times).
      { label: '8:30', start: '08:30', streamStart: '08:15', streamEnd: '09:40', preshowEnd: '08:29:30' },
      { label: '10:00', start: '10:00', streamStart: '09:45', streamEnd: '11:40', preshowEnd: '09:59:30' },
      { label: '11:45', start: '11:45', streamStart: '', streamEnd: '' },
    ],
    positions: '08:15', // "Positions in" countdown (optional widget)
    // Displays set to Automatic switch to their Live layout this many minutes
    // before each Encounter starts, and back to Pre-Encounter this many minutes
    // after that Encounter's stream ends.
    preshowSeconds: 270, // 4:30
    preshowLeadMinutes: 5, // preshow dashboards come up this long before each Encounter
    liveLeadMinutes: 5,
    liveTailMinutes: 5,
    bandToStageMinutes: 4, // greenroom "band to stage" = this many minutes before each Encounter
    overrides: {}, // { 'YYYY-MM-DD': { encounters: [...] } } for special Sundays
  },
  people: {
    // 'Planning Center Name': { slackName, photo, focusX, focusY, zoom }
  },
  nameMap: {
    // Planning Center name -> Slack name, where they differ
    'Matt Jackson': 'MJ',
    'Todd Doxzon': 'PT',
    'Colton Brayton': 'Colton',
    'Craig Carsley': 'Craig',
    'Samuel Petro': 'Sam Petro',
    'Clyde Stackhouse Jr.': 'Clyde Stackhouse',
    'Kaleb Owen': 'Kaleb',
    'Marissa Sutton': 'Marissa',
    'Ben Norvig': 'PBen',
    'Casey Finnerty': 'Case',
    'Casey Reale': 'Casey',
    'Masego Brown': 'Masego',
    'Lana Sivadge': 'Lana',
    'Seth Campbell': 'Seth’s current account',
    'Kappes Chatfield': 'Kap',
    'Ryan Vandergriend': 'Roo',
    'Keyonna Jeter': 'Key',
    'Tamara McMillan': 'Tamara',
    'Anicca Adams': 'Anicca',
    'Carl Grunden': 'Carl',
    'Mark Sole': 'Mark',
    'Trenda Brown': 'Trenda',
    'Tzion Doxzon': 'Tzion',
    'Blaze Doxzon': 'Blaze',
    'Yev Chudiuk': 'Yev',
    'Wazer Tau': 'Wazer',
    'Praise OlaOlorun': 'Praise',
    'Nick Johnson': 'Nick',
    'Bree Bailey': 'Bree Jo',
    'Nathan Shipley - Williamson': 'NathanW',
    "Mike O'Connell": 'Mike O’Connell',
  },
  helpText: {
    'FOH Audio Engineer': 'Mics, IEMs and your mix',
    'Service Producer': 'Flow, timing and the Encounter plan',
    'Broadcast Producer': 'Online and on-camera needs',
    'Stage Manager': 'Stage, cues and transitions',
    'Floor Manager': 'Room, doors and floor needs',
  },
  songs: {},
  profiles,
  live: { manualIndex: null, manualSetAt: null },
};

for (const p of Object.values(dbDefaults.profiles)) if (!p.layouts.live) p.layouts.live = JSON.parse(JSON.stringify(p.layouts.pre));
for (const p of Object.values(dbDefaults.profiles)) if (!p.layouts.preshow) p.layouts.preshow = preshowFrom(p.layouts.live);

// Dashboards designed with Jozef in the Dashboard Builder. Bumping a number
// pushes that default layout to existing installs once, replacing what's there.
const LAYOUT_REVISIONS = {
  'broadcast.pre': 3,
  'broadcast-audio.pre': 3,
  'broadcast-audio.preshow': 4,
  'broadcast-audio.live': 1,
  'dock.pre': 3,
  'dock.preshow': 3,
  'dock.live': 3,
  'greenroom.pre': 1,
  'greenroom.preshow': 1,
  'greenroom.live': 1,
  'preshow-confidence.pre': 3,
  'preshow-confidence.preshow': 4,
  'preshow-confidence.live': 1,
  'foh-wireless.pre': 2,
  'foh-wireless.preshow': 1,
  'foh-wireless.live': 1,
  'foh.pre': 1,
  'foh.preshow': 1,
  'foh.live': 1,
  'broadcast.preshow': 2,
  'broadcast.live': 4,
};

module.exports = { configDefaults, dbDefaults, LEADER_ROLES, LOCATIONS, LAYOUT_REVISIONS, preshowFrom };
