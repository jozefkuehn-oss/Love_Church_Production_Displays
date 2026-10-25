// Love Church Production Displays — server.
// Serves every display (/display/<profile>), the admin and leader messages page
// (/admin), and pushes a live snapshot to every screen once a second.
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const { Doc, PHOTO_DIR, DATA_DIR } = require('./store');
const { configDefaults, dbDefaults } = require('./defaults');
const { makeAuth } = require('./auth');
const { makeClock } = require('./time');
const { makeEngine } = require('./engine');

const LOG_DIR = path.join(DATA_DIR, 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'server.log'), line + '\n');
  } catch (e) {}
}

const config = new Doc('config.json', configDefaults);
const db = new Doc('db.json', dbDefaults);
const auth = makeAuth(db);
const clock = makeClock(config);
const engine = makeEngine({ config, db, clock, log });

// Bring profiles saved by older versions up to date: every room has a
// Pre-Encounter and a Live layout, and one mode setting (auto / pre / live).
(function migrateProfiles() {
  let changed = false;
  for (const [id, p] of Object.entries(db.data.profiles)) {
    if (p.layouts.huddle && !p.layouts.pre) {
      p.layouts.pre = p.layouts.huddle;
      changed = true;
    }
    if (p.layouts.huddle) {
      delete p.layouts.huddle;
      changed = true;
    }
    if (!p.layouts.pre) {
      p.layouts.pre = structuredClone((dbDefaults.profiles[id] && dbDefaults.profiles[id].layouts.pre) || p.layouts.live);
      changed = true;
    }
    if (!p.modeSetting) {
      p.modeSetting = p.autoMode || !p.mode ? 'auto' : p.mode === 'huddle' ? 'pre' : p.mode;
      changed = true;
    }
    if ('autoMode' in p || 'mode' in p) {
      delete p.autoMode;
      delete p.mode;
      changed = true;
    }
  }
  if (!db.data.devices) {
    db.data.devices = {};
    changed = true;
  }
  if (changed) db.saveNow();
})();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));

const PUBLIC = path.join(__dirname, '..', 'public');
app.use('/static', express.static(PUBLIC, { maxAge: '1h' }));
app.use('/photos', express.static(PHOTO_DIR, { maxAge: '1d' }));
app.use('/seed-photos', express.static(path.join(__dirname, 'seed', 'photos'), { maxAge: '1d' }));

app.get('/', (req, res) => res.redirect('/admin'));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC, 'admin.html')));
app.get('/display', (req, res) => res.sendFile(path.join(PUBLIC, 'chooser.html')));
app.get('/display/:profile', (req, res) => res.sendFile(path.join(PUBLIC, 'display.html')));

const ok = (res, body = { ok: true }) => res.json(body);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- public ----------
app.get('/api/displays', (req, res) => {
  ok(res, Object.entries(db.data.profiles).map(([id, p]) => ({ id, name: p.name })));
});

// A screen picked its room on the picker page.
app.post('/api/devices/:id/choose', (req, res) => {
  const id = req.params.id.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  const profile = (req.body || {}).profile;
  if (!id || !db.data.profiles[profile]) return bad(res, 'Unknown room.');
  const cur = db.data.devices[id] || {};
  db.data.devices[id] = { ...cur, name: cur.name || 'Screen ' + id.slice(0, 4).toUpperCase(), profile, lastSeen: Date.now() };
  db.save();
  ok(res);
});

app.get('/api/setup-needed', (req, res) => ok(res, { needed: db.data.accounts.length === 0 }));

app.post('/api/setup', (req, res) => {
  if (db.data.accounts.length) return bad(res, 'Setup is already done.', 403);
  const { name, pin } = req.body || {};
  if (!name || !/^\d{4,8}$/.test(String(pin || ''))) return bad(res, 'Enter your name and a 4–8 digit PIN.');
  const a = auth.createAccount({ name, pcoName: req.body.pcoName || name, role: 'admin', pin });
  const token = auth.login(a.id, pin);
  setCookie(res, token);
  log(`First admin created: ${a.name}`);
  ok(res, { account: auth.publicAccount(a) });
});

app.get('/api/accounts/public', (req, res) => {
  ok(res, db.data.accounts.map((a) => ({ id: a.id, name: a.name })).sort((x, y) => x.name.localeCompare(y.name)));
});

function setCookie(res, token) {
  res.setHeader('Set-Cookie', `lcd_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`);
}

app.post('/api/login', (req, res) => {
  const { accountId, pin } = req.body || {};
  const token = auth.login(accountId, pin);
  if (!token) return bad(res, 'That PIN didn’t match.', 401);
  setCookie(res, token);
  ok(res, { account: auth.publicAccount(db.data.accounts.find((a) => a.id === accountId)) });
});

app.post('/api/logout', (req, res) => {
  auth.logout(req);
  res.setHeader('Set-Cookie', 'lcd_session=; Path=/; Max-Age=0');
  ok(res);
});

app.get('/api/me', (req, res) => {
  const a = auth.sessionAccount(req);
  ok(res, { account: auth.publicAccount(a), canSend: a ? canSend(a).ok : false, reason: a ? canSend(a).reason : '' });
});

// ---------- leaders: messages + live control ----------
function canSend(account) {
  if (account.role === 'admin') return { ok: true };
  if (!config.data.onlyScheduledLeaders || config.data.sampleMode) return { ok: true };
  const plan = engine.getPlan();
  const roles = config.data.leaderRoles || [];
  const scheduled = plan && plan.people.some((p) => p.name.toLowerCase() === account.pcoName.toLowerCase() && roles.includes(p.position));
  return scheduled ? { ok: true } : { ok: false, reason: 'You can send messages on days you’re scheduled in a leadership role.' };
}

app.get('/api/messages', auth.requireLeader, (req, res) => {
  const since = Date.now() - 18 * 3600e3;
  ok(res, {
    messages: db.data.messages.filter((m) => m.at > since).slice(-100).reverse(),
    quick: db.data.quickMessages,
    displays: Object.entries(db.data.profiles).map(([id, p]) => ({ id, name: p.name })),
    defaultSeconds: config.data.messageDefaultSeconds,
  });
});

app.post('/api/messages', auth.requireLeader, (req, res) => {
  const perm = canSend(req.account);
  if (!perm.ok) return bad(res, perm.reason, 403);
  const { text, level, targets, seconds } = req.body || {};
  const t = String(text || '').trim().slice(0, 140);
  if (!t) return bad(res, 'Type a message first.');
  const secs = Math.max(0, Math.min(3600, Number(seconds ?? config.data.messageDefaultSeconds) || 0));
  const m = {
    id: crypto.randomUUID(),
    text: t,
    level: ['info', 'heads', 'urgent'].includes(level) ? level : 'info',
    targets: Array.isArray(targets) && targets.length ? targets : ['all'],
    from: req.account.name,
    at: Date.now(),
    expiresAt: secs ? Date.now() + secs * 1000 : null,
    cleared: false,
  };
  db.data.messages.push(m);
  if (db.data.messages.length > 2000) db.data.messages = db.data.messages.slice(-1000);
  db.save();
  log(`Message from ${m.from} → ${m.targets.join(',')}: ${m.text}`);
  pushNow();
  ok(res, { message: m });
});

app.post('/api/messages/:id/clear', auth.requireLeader, (req, res) => {
  const m = db.data.messages.find((x) => x.id === req.params.id);
  if (!m) return bad(res, 'Message not found.', 404);
  m.cleared = true;
  m.clearedBy = req.account.name;
  db.save();
  pushNow();
  ok(res);
});

app.post('/api/messages/clear-all', auth.requireLeader, (req, res) => {
  db.data.messages.forEach((m) => {
    if (!m.cleared) {
      m.cleared = true;
      m.clearedBy = req.account.name;
    }
  });
  db.save();
  pushNow();
  ok(res);
});

app.get('/api/live', auth.requireLeader, (req, res) => {
  const s = engine.snapshot();
  ok(res, {
    encounter: s.encounter,
    isLive: s.isLive,
    items: s.items,
    index: s.index,
    indexSource: s.indexSource,
    remaining: s.itemRemainingMs,
    now: s.now,
    propresenter: { auditorium: s.propresenter.auditorium.connected, presentation: s.propresenter.auditorium.presentation || '' },
    unmatched: s.unmatchedPresentation || '',
    links: db.data.presentationLinks || {},
  });
});

// Link a ProPresenter presentation name to a plan item (remembered for future Sundays).
app.post('/api/live-link', auth.requireLeader, (req, res) => {
  const { presentation, item } = req.body || {};
  if (!presentation) return bad(res, 'No presentation name.');
  db.data.presentationLinks = db.data.presentationLinks || {};
  if (item) db.data.presentationLinks[String(presentation)] = String(item);
  else delete db.data.presentationLinks[String(presentation)];
  db.save();
  log(`${req.account.name} linked presentation "${presentation}" → ${item || '(nothing)'}`);
  pushNow();
  ok(res);
});

// Manual "where are we" control for when ProPresenter isn't tracking.
app.post('/api/live/:action', auth.requireLeader, (req, res) => {
  const s = engine.snapshot();
  const live = db.data.live;
  const n = s.items.length;
  if (req.params.action === 'auto') {
    live.manualIndex = null;
  } else if (req.params.action === 'set') {
    live.manualIndex = Math.max(0, Math.min(n - 1, Number(req.body.index) || 0));
  } else if (req.params.action === 'next') {
    live.manualIndex = Math.min(n - 1, (s.index ?? -1) + 1);
  } else if (req.params.action === 'prev') {
    live.manualIndex = Math.max(0, (s.index ?? 1) - 1);
  } else return bad(res, 'Unknown action');
  live.manualEnc = s.encounter && s.encounter.label;
  live.manualSetAt = clock.now();
  db.save();
  pushNow();
  ok(res);
});

// ---------- admin ----------
const SECRET_FIELDS = [['pco', 'secret'], ['slack', 'botToken']];
const MASK = '••••••••';

app.get('/api/config', auth.requireAdmin, (req, res) => {
  const c = structuredClone(config.data);
  for (const [a, b] of SECRET_FIELDS) if (c[a][b]) c[a][b] = MASK;
  ok(res, c);
});

app.put('/api/config', auth.requireAdmin, (req, res) => {
  const body = req.body || {};
  for (const [a, b] of SECRET_FIELDS) if (body[a] && body[a][b] === MASK) body[a][b] = config.data[a][b];
  const wasSample = config.data.sampleMode;
  const allowed = ['sampleMode', 'demoStart', 'timezone', 'campusLabel', 'pco', 'slack', 'propresenter', 'leaderRoles', 'onlyScheduledLeaders', 'messageDefaultSeconds', 'hideItems'];
  for (const k of allowed) if (k in body) config.data[k] = body[k];
  config.saveNow();
  engine.restartProPresenter();
  if (wasSample !== config.data.sampleMode || body.pco) engine.refreshPlan().then(engine.refreshPhotos);
  log(`Settings updated by ${req.account.name}`);
  ok(res);
});

app.post('/api/refresh', auth.requireAdmin, async (req, res) => {
  await engine.refreshPlan();
  await engine.refreshPhotos();
  pushNow();
  ok(res, engine.health());
});

app.get('/api/health', auth.requireLeader, (req, res) => ok(res, engine.health()));

app.get('/api/schedule', auth.requireAdmin, (req, res) => ok(res, db.data.schedule));
app.put('/api/schedule', auth.requireAdmin, (req, res) => {
  const s = req.body || {};
  const hm = /^\d{2}:\d{2}$/;
  for (const e of s.encounters || []) {
    if (!hm.test(e.start) || (e.streamStart && !hm.test(e.streamStart)) || (e.streamEnd && !hm.test(e.streamEnd))) return bad(res, 'Times must be HH:MM (24-hour).');
  }
  db.data.schedule = { ...db.data.schedule, ...s };
  db.save();
  pushNow();
  ok(res);
});

app.get('/api/quick', auth.requireLeader, (req, res) => ok(res, db.data.quickMessages));
app.put('/api/quick', auth.requireAdmin, (req, res) => {
  db.data.quickMessages = (req.body.quick || []).map((s) => String(s).slice(0, 80)).filter(Boolean);
  db.save();
  ok(res);
});

// People: who's scheduled, their photo source and framing.
app.get('/api/people', auth.requireAdmin, (req, res) => {
  const plan = engine.getPlan();
  const slack = engine.getSlackPhotos();
  const names = plan ? [...new Set(plan.people.map((p) => p.name))] : [];
  ok(res, {
    people: names.map((name) => {
      const o = db.data.people[name] || {};
      const positions = plan.people.filter((p) => p.name === name).map((p) => p.position);
      const seed = seedPhoto(name);
      return { name, positions, override: o, slackPhoto: slack[name] || '', seedPhoto: seed, slackName: db.data.nameMap[name] || '' };
    }),
    helpText: db.data.helpText,
  });
});

function seedPhoto(name) {
  const f = name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '-') + '.jpg';
  return fs.existsSync(path.join(__dirname, 'seed', 'photos', f)) ? '/seed-photos/' + f : '';
}

app.put('/api/people/:name', auth.requireAdmin, (req, res) => {
  const name = req.params.name;
  const cur = db.data.people[name] || {};
  const b = req.body || {};
  const num = (v, lo, hi, dflt) => (v === undefined ? dflt : Math.max(lo, Math.min(hi, Number(v))));
  db.data.people[name] = {
    ...cur,
    focusX: num(b.focusX, 0, 100, cur.focusX ?? 50),
    focusY: num(b.focusY, 0, 100, cur.focusY ?? 15),
    zoom: num(b.zoom, 1, 3, cur.zoom ?? 1),
    hidePhoto: b.hidePhoto ?? cur.hidePhoto ?? false,
  };
  if ('slackName' in b) {
    if (b.slackName) db.data.nameMap[name] = String(b.slackName);
    else delete db.data.nameMap[name];
  }
  db.save();
  pushNow();
  ok(res);
});

app.post('/api/people/:name/photo', auth.requireAdmin, (req, res) => {
  const m = String((req.body || {}).dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/);
  if (!m) return bad(res, 'Upload a JPG, PNG or WebP image.');
  const ext = m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg';
  const file = `upload-${crypto.randomBytes(6).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, file), Buffer.from(m[2], 'base64'));
  const name = req.params.name;
  db.data.people[name] = { ...(db.data.people[name] || {}), photo: `/photos/${file}`, hidePhoto: false, focusX: 50, focusY: 15, zoom: 1 };
  db.save();
  pushNow();
  ok(res, { photo: `/photos/${file}` });
});

app.delete('/api/people/:name/photo', auth.requireAdmin, (req, res) => {
  const p = db.data.people[req.params.name];
  if (p) delete p.photo;
  db.save();
  pushNow();
  ok(res);
});

app.put('/api/helptext', auth.requireAdmin, (req, res) => {
  db.data.helpText = req.body || {};
  db.save();
  pushNow();
  ok(res);
});

// Song bank
app.get('/api/songs', auth.requireAdmin, (req, res) => ok(res, db.data.songs));
app.put('/api/songs/:key', auth.requireAdmin, (req, res) => {
  const b = req.body || {};
  const key = engine.songKey(b.title || req.params.key) || req.params.key;
  if (key !== req.params.key) delete db.data.songs[req.params.key];
  db.data.songs[key] = { title: b.title || '', lead: b.lead || '', feel: b.feel || '', progression: b.progression || '', notes: b.notes || '', cue: b.cue || '' };
  db.save();
  pushNow();
  ok(res, { key });
});
app.delete('/api/songs/:key', auth.requireAdmin, (req, res) => {
  delete db.data.songs[req.params.key];
  db.save();
  pushNow();
  ok(res);
});

// Wireless channel assignments (by Planning Center position)
app.get('/api/wireless', auth.requireAdmin, (req, res) => ok(res, db.data.wireless || {}));
app.put('/api/wireless', auth.requireAdmin, (req, res) => {
  db.data.wireless = req.body || {};
  db.save();
  pushNow();
  ok(res);
});

// Display profiles + layouts
app.get('/api/profiles', auth.requireAdmin, (req, res) => ok(res, db.data.profiles));
app.put('/api/profiles/:id', auth.requireAdmin, (req, res) => {
  const id = req.params.id;
  if (!/^[a-z0-9-]{1,30}$/.test(id)) return bad(res, 'Profile ids are lowercase letters, numbers and dashes.');
  const b = req.body || {};
  const cur = db.data.profiles[id] || { name: id, modeSetting: 'auto', style: {}, layouts: { pre: { widgets: [] }, live: { widgets: [] } } };
  db.data.profiles[id] = {
    ...cur,
    name: b.name ?? cur.name,
    modeSetting: ['auto', 'pre', 'live'].includes(b.modeSetting) ? b.modeSetting : cur.modeSetting || 'auto',
    style: b.style ?? cur.style,
    layouts: b.layouts ?? cur.layouts,
  };
  db.save();
  pushNow();
  ok(res);
});
app.post('/api/profiles-mode', auth.requireLeader, (req, res) => {
  const m = (req.body || {}).modeSetting;
  if (!['auto', 'pre', 'live'].includes(m)) return bad(res, 'Pick auto, pre or live.');
  for (const p of Object.values(db.data.profiles)) p.modeSetting = m;
  db.save();
  log(`All displays set to ${m} by ${req.account.name}`);
  pushNow();
  ok(res);
});

app.delete('/api/profiles/:id', auth.requireAdmin, (req, res) => {
  delete db.data.profiles[req.params.id];
  db.save();
  ok(res);
});

// Accounts
app.get('/api/accounts', auth.requireAdmin, (req, res) => ok(res, db.data.accounts.map(auth.publicAccount)));
app.post('/api/accounts', auth.requireAdmin, (req, res) => {
  const { name, pcoName, role, pin } = req.body || {};
  if (!name || !/^\d{4,8}$/.test(String(pin || ''))) return bad(res, 'Enter a name and a 4–8 digit PIN.');
  if (db.data.accounts.some((a) => a.name.toLowerCase() === String(name).toLowerCase())) return bad(res, 'There’s already an account with that name.');
  const a = auth.createAccount({ name, pcoName, role, pin });
  log(`Account created by ${req.account.name}: ${a.name} (${a.role})`);
  ok(res, { account: auth.publicAccount(a) });
});
app.put('/api/accounts/:id', auth.requireAdmin, (req, res) => {
  const a = db.data.accounts.find((x) => x.id === req.params.id);
  if (!a) return bad(res, 'Account not found.', 404);
  const b = req.body || {};
  if (b.name) a.name = String(b.name);
  if (b.pcoName) a.pcoName = String(b.pcoName);
  if (b.role) {
    if (a.role === 'admin' && b.role !== 'admin' && db.data.accounts.filter((x) => x.role === 'admin').length === 1) return bad(res, 'Keep at least one admin.');
    a.role = b.role === 'admin' ? 'admin' : 'leader';
  }
  if (b.pin) {
    if (!/^\d{4,8}$/.test(String(b.pin))) return bad(res, 'PINs are 4–8 digits.');
    const h = auth.hashPin(b.pin);
    a.salt = h.salt;
    a.pinHash = h.hash;
  }
  db.save();
  ok(res);
});
app.delete('/api/accounts/:id', auth.requireAdmin, (req, res) => {
  const a = db.data.accounts.find((x) => x.id === req.params.id);
  if (!a) return bad(res, 'Account not found.', 404);
  if (a.role === 'admin' && db.data.accounts.filter((x) => x.role === 'admin').length === 1) return bad(res, 'Keep at least one admin.');
  db.data.accounts = db.data.accounts.filter((x) => x.id !== a.id);
  for (const [t, s] of Object.entries(db.data.sessions)) if (s.accountId === a.id) delete db.data.sessions[t];
  db.save();
  ok(res);
});

// Screens: every TV or output that has opened /display registers itself here
// so an admin can see it and move it to a different room.
app.get('/api/devices', auth.requireAdmin, (req, res) => {
  const live = new Set([...wss.clients].map((c) => c.device).filter(Boolean));
  ok(
    res,
    Object.entries(db.data.devices)
      .map(([id, d]) => ({ id, ...d, online: live.has(id) }))
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
  );
});
app.put('/api/devices/:id', auth.requireAdmin, (req, res) => {
  const d = db.data.devices[req.params.id];
  if (!d) return bad(res, 'Screen not found.', 404);
  const b = req.body || {};
  if (b.name !== undefined) d.name = String(b.name).slice(0, 40);
  if (b.profile !== undefined) {
    if (!db.data.profiles[b.profile]) return bad(res, 'Unknown room.');
    d.profile = b.profile;
    let sent = false;
    for (const ws of wss.clients)
      if (ws.device === req.params.id && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'assign', profile: b.profile }));
        sent = true;
      }
    // Offline right now: switch it the next time it connects.
    if (sent) delete d.pendingProfile;
    else d.pendingProfile = b.profile;
  }
  db.save();
  ok(res);
});
app.delete('/api/devices/:id', auth.requireAdmin, (req, res) => {
  delete db.data.devices[req.params.id];
  db.save();
  ok(res);
});

// ---------- live push ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const u = new URL(req.url, 'http://x');
  ws.profile = u.searchParams.get('profile') || 'broadcast';
  const device = (u.searchParams.get('device') || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  if (device) {
    ws.device = device;
    const known = db.data.devices[device] || {};
    // The room in the screen's own address wins, unless an admin moved this
    // screen while it was off; then it switches to that room now.
    if (known.pendingProfile && known.pendingProfile !== ws.profile && db.data.profiles[known.pendingProfile]) {
      ws.send(JSON.stringify({ type: 'assign', profile: known.pendingProfile }));
    }
    db.data.devices[device] = {
      name: known.name || u.searchParams.get('name') || 'Screen ' + device.slice(0, 4).toUpperCase(),
      profile: ws.profile,
      lastSeen: Date.now(),
      address: (req.socket.remoteAddress || '').replace('::ffff:', ''),
    };
    db.save();
  }
  sendTo(ws, engine.snapshot());
});

function sendTo(ws, snap) {
  const p = db.data.profiles[ws.profile];
  if (!p) return ws.send(JSON.stringify({ type: 'missing', profile: ws.profile }));
  const mode = snap.modes[ws.profile] || 'live';
  ws.send(
    JSON.stringify({
      type: 'snapshot',
      profile: { id: ws.profile, name: p.name, mode, style: p.style || {}, layout: p.layouts[mode] || p.layouts.live },
      snap,
    })
  );
}

function pushNow() {
  let snap;
  try {
    snap = engine.snapshot();
  } catch (e) {
    log('Snapshot failed: ' + e.stack);
    return;
  }
  for (const ws of wss.clients) if (ws.readyState === 1) sendTo(ws, snap);
}

setInterval(pushNow, 1000);
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 15000);

const PORT = Number(process.env.PORT || config.data.port || 8080);
server.listen(PORT, '0.0.0.0', () => {
  log(`Love Church Displays running on port ${PORT} (${config.data.sampleMode ? 'sample mode' : 'live mode'})`);
  engine.startLoops();
});

process.on('uncaughtException', (e) => log('Uncaught: ' + e.stack));
process.on('unhandledRejection', (e) => log('Unhandled: ' + (e && e.stack ? e.stack : e)));
