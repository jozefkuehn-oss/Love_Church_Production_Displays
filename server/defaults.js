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
  messageDefaultSeconds: 120,
};

// Order locations appear in on a screen's room picker.
const LOCATIONS = ['Broadcast Control', 'The Dock', 'Greenroom', 'FOH', 'Stage'];

function w(id, type, x, y, wd, h, opts = {}) {
  return { id, type, x, y, w: wd, h, opts };
}

const profiles = {
  broadcast: {
    name: 'Broadcast Control',
    location: 'Broadcast Control',
    modeSetting: 'auto', // 'auto' (pre-encounter, then live during each Encounter), 'pre' or 'live'
    style: {},
    layouts: {
      live: {
        widgets: [
          w('t', 'title', 0, 0, 5, 2, { kicker: 'BROADCAST CONTROL', title: '{encounter} Encounter', sub: 'live' }),
          w('c', 'clock', 5, 0, 4, 2, { seconds: true }),
          w('ir', 'itemRemaining', 9, 0, 5, 2, {}),
          w('se', 'countdown', 14, 0, 5, 2, { target: 'streamEnd', label: 'STREAM ENDS IN', accent: true }),
          w('pf', 'projected', 19, 0, 5, 2, {}),
          w('ros', 'runOfShow', 0, 2, 6, 9, {}),
          w('sn', 'songNow', 6, 2, 11, 4, { showFeel: true, showProgression: true }),
          w('nx', 'songNext', 6, 6, 5, 2, {}),
          w('gr', 'graphics', 11, 6, 6, 2, {}),
          w('bt', 'faces', 6, 8, 11, 3, { group: 'broadcast', label: 'BROADCAST TEAM', size: 'small' }),
          w('st', 'faces', 17, 2, 7, 5, { group: 'stage', label: 'ON STAGE' }),
          w('cm', 'faces', 17, 7, 7, 4, { group: 'communicators', label: 'COMMUNICATORS' }),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
      pre: {
        widgets: [
          w('t', 'title', 0, 0, 12, 2, { kicker: 'BROADCAST CONTROL · HUDDLE', title: '{date} · Full-Day Brief', sub: 'encounters' }),
          w('c', 'clock', 12, 0, 4, 2, { seconds: true }),
          w('pos', 'countdown', 16, 0, 4, 2, { target: 'nextStart', label: '{next} STARTS IN' }),
          w('fs', 'countdown', 20, 0, 4, 2, { target: 'nextStreamStart', label: 'STREAM STARTS IN', accent: true }),
          w('st', 'faces', 0, 2, 9, 6, { group: 'stage', label: 'WHO YOU’LL SEE ON STAGE' }),
          w('cm', 'faces', 0, 8, 9, 3, { group: 'communicators', label: 'COMMUNICATORS' }),
          w('wd', 'worshipDirection', 9, 2, 10, 9, {}),
          w('ros', 'runOfShowDay', 19, 2, 5, 9, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, { idleText: 'Pre-encounter · switches to Live automatically before each Encounter' }),
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
        widgets: [
          w('t', 'title', 0, 0, 5, 1, { kicker: 'THE DOCK', title: 'Who’s Serving Today', compact: true }),
          w('nn', 'nowNext', 5, 0, 11, 1, { compact: true }),
          w('c', 'clock', 16, 0, 3, 1, { compact: true }),
          w('se', 'countdown', 19, 0, 5, 1, { target: 'streamEnd', label: 'STREAM ENDS IN', accent: true, compact: true }),
          w('ld', 'faces', 0, 1, 24, 6, { group: 'leadership', collage: true, roleColor: '#FF4FA8', columns: 6 }),
          w('cr', 'faces', 0, 7, 24, 4, { group: 'stage+communicators', collage: true, columns: 8 }),
          w('mb', 'messageBar', 0, 11, 24, 1, { legend: true }),
        ],
      },
      pre: {
        widgets: [
          w('t', 'title', 0, 0, 5, 1, { kicker: 'THE DOCK', title: 'Who’s Serving Today', compact: true }),
          w('et', 'encountersToday', 5, 0, 11, 1, { compact: true }),
          w('c', 'clock', 16, 0, 3, 1, { compact: true }),
          w('ns', 'countdown', 19, 0, 5, 1, { target: 'nextStart', label: '{next} STARTS IN', accent: true, compact: true }),
          w('ld', 'faces', 0, 1, 24, 6, { group: 'leadership', collage: true, roleColor: '#FF4FA8', columns: 6 }),
          w('cr', 'faces', 0, 7, 24, 4, { group: 'stage+communicators', collage: true, columns: 8 }),
          w('mb', 'messageBar', 0, 11, 24, 1, { legend: true }),
        ],
      },
    },
  },
  greenroom: {
    name: 'Greenroom · Team & Mics',
    location: 'Greenroom',
    modeSetting: 'auto',
    style: {},
    layouts: {
      pre: {
        widgets: [
          w('t', 'title', 0, 0, 5, 2, { kicker: 'GREENROOM · PRE-ENCOUNTER', title: '{next} Encounter', sub: 'date' }),
          w('c', 'clock', 5, 0, 5, 2, { seconds: true }),
          w('bs', 'countdown', 10, 0, 5, 2, { target: 'nextBandToStage', label: 'BAND TO STAGE IN', accent: true }),
          w('es', 'countdown', 15, 0, 4, 2, { target: 'nextStart', label: 'ENCOUNTER STARTS IN' }),
          w('ss', 'countdown', 19, 0, 5, 2, { target: 'nextStreamStart', label: 'STREAM STARTS IN' }),
          w('wm', 'worshipMics', 0, 2, 17, 9, {}),
          w('gt', 'goto', 17, 2, 7, 9, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
      live: {
        widgets: [
          w('t', 'title', 0, 0, 5, 2, { kicker: 'GREENROOM', title: '{encounter} Encounter', sub: 'date' }),
          w('c', 'clock', 5, 0, 5, 2, { seconds: true }),
          w('ir', 'itemRemaining', 10, 0, 5, 2, { accent: true }),
          w('es', 'countdown', 15, 0, 4, 2, { target: 'encounterStart', label: 'ENCOUNTER STARTS IN' }),
          w('se', 'countdown', 19, 0, 5, 2, { target: 'streamEnd', label: 'STREAM ENDS IN' }),
          w('wm', 'worshipMics', 0, 2, 17, 9, {}),
          w('gt', 'goto', 17, 2, 7, 9, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
    },
  },
  foh: {
    name: 'FOH · Run of Show',
    location: 'FOH',
    mode: 'live',
    modeSetting: 'auto',
    style: {},
    layouts: {
      live: {
        widgets: [
          w('t', 'title', 0, 0, 4, 2, { kicker: 'FOH · AUDIO & LIGHTING', title: '{encounter} Encounter' }),
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
          w('t', 'title', 0, 0, 4, 2, { kicker: 'FOH · PRE-ENCOUNTER', title: '{next} Encounter' }),
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
  // Second Greenroom TV: big countdowns, what's on now and the go-to people.
  'greenroom-2': {
    name: 'Greenroom · Countdown',
    location: 'Greenroom',
    mode: 'live',
    modeSetting: 'auto',
    style: {},
    layouts: {
      live: {
        widgets: [
          w('t', 'title', 0, 0, 6, 2, { kicker: 'GREENROOM', title: '{encounter} Encounter' }),
          w('c', 'clock', 6, 0, 6, 2, { seconds: true }),
          w('ir', 'itemRemaining', 12, 0, 6, 2, { accent: true }),
          w('se', 'countdown', 18, 0, 6, 2, { target: 'streamEnd', label: 'STREAM ENDS IN' }),
          w('sn', 'songNow', 0, 2, 15, 8, { showFeel: true, showProgression: true }),
          w('gt', 'goto', 15, 2, 9, 8, {}),
          w('mb', 'messageBar', 0, 10, 24, 2, { big: true }),
        ],
      },
      pre: {
        widgets: [
          w('et', 'encountersToday', 0, 0, 18, 1, { compact: true }),
          w('c', 'clock', 18, 0, 6, 1, { compact: true }),
          w('ns', 'countdown', 0, 1, 15, 6, { target: 'nextStart', label: '{next} ENCOUNTER STARTS IN', huge: true }),
          w('bs', 'countdown', 15, 1, 9, 3, { target: 'nextBandToStage', label: 'BAND TO STAGE IN', accent: true }),
          w('ss', 'countdown', 15, 4, 9, 3, { target: 'nextStreamStart', label: 'STREAM STARTS IN' }),
          w('fu', 'firstUp', 0, 7, 24, 3, {}),
          w('mb', 'messageBar', 0, 10, 24, 2, { big: true }),
        ],
      },
    },
  },
  // FOH monitor 2: every mic and IEM with faces, battery and RF.
  'foh-wireless': {
    name: 'FOH · Wireless & Mics',
    location: 'FOH',
    mode: 'live',
    modeSetting: 'auto',
    style: {},
    layouts: {
      live: {
        widgets: [
          w('t', 'title', 0, 0, 6, 2, { kicker: 'FOH · WIRELESS', title: '{encounter} Encounter' }),
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
          w('t', 'title', 0, 0, 6, 2, { kicker: 'FOH · WIRELESS', title: '{next} Encounter' }),
          w('c', 'clock', 6, 0, 6, 2, { seconds: true }),
          w('bs', 'countdown', 12, 0, 6, 2, { target: 'nextBandToStage', label: 'BAND TO STAGE IN' }),
          w('ns', 'countdown', 18, 0, 6, 2, { target: 'nextStart', label: 'ENCOUNTER STARTS IN', accent: true }),
          w('wm', 'worshipMics', 0, 2, 16, 9, {}),
          w('wl', 'wirelessList', 16, 2, 8, 9, {}),
          w('mb', 'messageBar', 0, 11, 24, 1, {}),
        ],
      },
    },
  },
  // FOH monitor 3: big timers and producer messages.
  'foh-timers': {
    name: 'FOH · Timers & Messages',
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
    name: 'Stage Confidence',
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
    { id: 'foh', name: 'FOH Engineer', positions: ['FOH Audio Engineer', 'FOH Engineer'], perms: ['messages', 'live', 'wireless', 'handhelds'] },
    { id: 'service-producer', name: 'Service Producer', positions: ['Service Producer'], perms: ['messages', 'live'] },
    { id: 'broadcast-producer', name: 'Broadcast Producer', positions: ['Broadcast Producer', 'Producer'], perms: ['messages', 'live'] },
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
      { label: '8:30', start: '08:30', streamStart: '08:15', streamEnd: '09:40' },
      { label: '10:00', start: '10:00', streamStart: '09:45', streamEnd: '11:40' },
      { label: '11:45', start: '11:45', streamStart: '', streamEnd: '' },
    ],
    positions: '08:15', // "Positions in" countdown (optional widget)
    // Displays set to Automatic switch to their Live layout this many minutes
    // before each Encounter starts, and back to Pre-Encounter this many minutes
    // after that Encounter's stream ends.
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

module.exports = { configDefaults, dbDefaults, LEADER_ROLES, LOCATIONS };
