// TV manager: turns the dashboard TVs on, opens the dashboard app on each one,
// and turns them off again, on a schedule (Sundays 5:00 AM → 3:00 PM by
// default) or from Admin → Displays → TVs.
//
// Each TV is keyed by the same id its screen uses (its serial), so the name
// and dashboard come from Admin → Displays → Screens like any other screen.
// db.data.tvs[id] holds only how to control it:
//   { platform: 'samsung' | 'roku' | 'firetv', ip, mac, appId, token, password, enabled }
const os = require('os');
const path = require('path');
const express = require('express');
const wol = require('./tv/wol');
const samsung = require('./tv/samsung');
const roku = require('./tv/roku');
const firetv = require('./tv/firetv');
const { parts } = require('./time');

const SAMSUNG_APP_ID = 'LvChDisp01.Displays'; // must match tv/samsung/config.xml
const RETRY_MS = 2 * 60 * 1000;
const MAX_TRIES = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PLATFORMS = {
  samsung: 'Samsung (dashboard app)',
  roku: 'Roku TV (video stream)',
  firetv: 'Fire TV Stick (Fully Kiosk)',
};

const SEED = [
  { id: '09KY3CNN901483Y', name: 'Green Room', platform: 'samsung', profile: 'greenroom' },
  { id: '09MR3CUNA06646X', name: 'The Dock', platform: 'samsung', profile: 'dock' },
  { id: '09LH3CVN819232X', name: 'Broadcast Audio', platform: 'samsung', profile: 'broadcast-audio' },
  { id: '2N005X382878', name: 'Broadcast Top', platform: 'roku', profile: 'broadcast', ip: '192.168.10.249' },
  { id: 'PRESHOW-FIRETV', name: 'Preshow Teleprompter', platform: 'firetv', profile: 'preshow-confidence' },
];

function makeTvs({ app, db, config, log, auth, isOnline, streams, port }) {
  const state = {}; // id -> { status, message, at, tries, power, reachable, model }
  const found = new Map(); // ip -> { ip, mac, model, platform, at }: TVs whose app said hello but aren't set up

  // ---------- data ----------
  (function seed() {
    if ((db.data.tvsVersion || 0) >= 1) return;
    db.data.tvs = db.data.tvs || {};
    db.data.devices = db.data.devices || {};
    for (const t of SEED) {
      if (!db.data.tvs[t.id]) db.data.tvs[t.id] = { platform: t.platform, ip: t.ip || '', mac: '', appId: t.platform === 'samsung' ? SAMSUNG_APP_ID : '', enabled: true };
      if (!db.data.devices[t.id] && db.data.profiles[t.profile]) db.data.devices[t.id] = { name: t.name, profile: t.profile, lastSeen: 0 };
    }
    if (!db.data.tvSchedule) db.data.tvSchedule = { enabled: true, days: ['Sunday'], on: '05:00', off: '15:00' };
    db.data.tvsVersion = 1;
    db.save();
  })();

  const tvs = () => db.data.tvs || (db.data.tvs = {});
  const sched = () => db.data.tvSchedule || (db.data.tvSchedule = { enabled: true, days: ['Sunday'], on: '05:00', off: '15:00' });
  const dev = (id) => (db.data.devices && db.data.devices[id]) || {};
  const nameOf = (id) => dev(id).name || id;
  const profileOf = (id) => dev(id).profile || '';
  const set = (id, patch) => (state[id] = { ...(state[id] || {}), ...patch, at: Date.now() });

  // The address the TVs use to reach this Mac.
  function serverBase() {
    if (config.data.publicBase) return String(config.data.publicBase).replace(/\/$/, '');
    for (const list of Object.values(os.networkInterfaces()))
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return `http://${a.address}:${port}`;
    return `http://localhost:${port}`;
  }
  const displayUrl = (id, platform) => {
    const q = new URLSearchParams({ device: id, name: nameOf(id), tv: platform });
    return `${serverBase()}/display?${q}`;
  };
  const saveToken = (tv) => (t) => {
    tv.token = t;
    db.save();
  };

  async function waitFor(fn, ms, every = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await sleep(every);
    }
    return false;
  }

  // ---------- one TV ----------
  async function check(id) {
    const tv = tvs()[id];
    if (!tv || !tv.ip) return set(id, { reachable: false, power: 'unknown' });
    const drv = { samsung, roku, firetv }[tv.platform];
    const i = await drv.info(tv);
    const showing = tv.platform === 'roku' ? !!i.dashboard : tv.platform === 'firetv' ? i.reachable && i.dashboard && isOnline(id) : isOnline(id);
    const patch = { reachable: i.reachable, power: i.power, model: i.model || (state[id] || {}).model || '', showing };
    if (i.mac && !tv.mac) {
      tv.mac = i.mac; // learned from the TV itself
      db.save();
    }
    state[id] = { ...(state[id] || {}), ...patch };
    return state[id];
  }

  async function launchOne(id) {
    const tv = tvs()[id];
    if (!tv) throw new Error('Unknown TV.');
    if (!tv.ip) throw new Error('No IP address saved for this TV.');
    if (!profileOf(id)) throw new Error('Pick a dashboard for this TV first.');
    if (tv.platform === 'samsung') {
      if (tv.mac) await wol.wake(tv.mac, tv.ip).catch(() => {});
      const up = await waitFor(async () => (await samsung.info(tv)).reachable, 60000);
      if (!up) throw new Error('The TV didn’t wake up. Check it has power and “Power On with Mobile” is on.');
      await samsung.powerOnIfStandby(tv, saveToken(tv)).catch(() => {});
      await sleep(3000);
      await samsung.launch(tv, saveToken(tv));
      if (!(await waitFor(() => isOnline(id), 45000, 1500))) throw new Error('The TV is on, but the dashboard app didn’t connect. Is the app installed?');
    } else if (tv.platform === 'roku') {
      await roku.wake(tv).catch(() => {});
      if (!(await waitFor(async () => (await roku.info(tv)).reachable, 45000))) throw new Error('The Roku TV didn’t answer. Check Fast TV Start and Network access.');
      await streams.start(id, profileOf(id), nameOf(id));
      await sleep(2000);
      await roku.launch(tv, { tv: id, server: serverBase() });
      if (!(await waitFor(async () => (await roku.info(tv)).dashboard, 30000))) throw new Error('The Roku is on, but the dashboard app didn’t open. Is it sideloaded?');
    } else if (tv.platform === 'firetv') {
      await firetv.wake(tv);
      await firetv.launch(tv, displayUrl(id, 'firetv'));
      if (!(await waitFor(() => isOnline(id), 45000, 1500))) throw new Error('Fully Kiosk opened, but the dashboard didn’t connect.');
    } else throw new Error('Unknown TV type.');
  }

  // onlyIfDashboard: leave alone any TV someone is using for something else.
  async function offOne(id, onlyIfDashboard) {
    const tv = tvs()[id];
    if (!tv || !tv.ip) throw new Error('No IP address saved for this TV.');
    const s = await check(id);
    if (!s.reachable || s.power !== 'on') {
      if (tv.platform === 'roku') streams.stop(id);
      return 'already off';
    }
    if (onlyIfDashboard && !s.showing) return 'skipped: in use for something else';
    if (tv.platform === 'samsung') await samsung.off(tv, saveToken(tv));
    else if (tv.platform === 'roku') await roku.off(tv);
    else if (tv.platform === 'firetv') await firetv.off(tv);
    if (tv.platform === 'roku') streams.stop(id);
    return 'off';
  }

  // Keeps trying (every 2 minutes, up to 8 times) so a slow Wi-Fi wake or a
  // TV that was unplugged at 5:00 still comes up before people arrive.
  async function launchWithRetries(id, why) {
    const run = ((state[id] || {}).run || 0) + 1;
    set(id, { status: 'trying', message: 'Starting…', tries: 0, run });
    for (let n = 1; n <= MAX_TRIES; n++) {
      if ((state[id] || {}).run !== run) return; // a newer launch/off took over
      set(id, { tries: n, status: 'trying', message: n === 1 ? 'Starting…' : `Trying again (attempt ${n} of ${MAX_TRIES})…` });
      try {
        await launchOne(id);
        set(id, { status: 'ok', message: 'Dashboard on', showing: true });
        log(`TV ${nameOf(id)}: dashboard launched (${why})`);
        return;
      } catch (e) {
        set(id, { status: n === MAX_TRIES ? 'failed' : 'trying', message: e.message });
        log(`TV ${nameOf(id)}: launch attempt ${n} failed: ${e.message}`);
        if (n < MAX_TRIES) await sleep(RETRY_MS);
      }
    }
  }

  async function offWithLog(id, onlyIfDashboard, why) {
    const run = ((state[id] || {}).run || 0) + 1;
    set(id, { run });
    try {
      const r = await offOne(id, onlyIfDashboard);
      set(id, { status: r === 'off' || r === 'already off' ? 'off' : 'skipped', message: r === 'off' ? 'Turned off' : r === 'already off' ? 'Already off' : 'Left on: in use for something else', showing: r === 'skipped: in use for something else' ? undefined : false });
      log(`TV ${nameOf(id)}: ${r} (${why})`);
    } catch (e) {
      set(id, { status: 'failed', message: e.message });
      log(`TV ${nameOf(id)}: turn off failed: ${e.message}`);
    }
  }

  const enabledIds = () => Object.entries(tvs()).filter(([, t]) => t.enabled !== false && t.ip).map(([id]) => id);
  const launchAll = (why) => enabledIds().forEach((id) => launchWithRetries(id, why));
  const offAll = (onlyIfDashboard, why) => enabledIds().forEach((id) => offWithLog(id, onlyIfDashboard, why));

  // ---------- schedule ----------
  // Real church time (not the demo clock). Catches up if the Mac restarts
  // inside the window.
  function tick() {
    const s = sched();
    if (!s.enabled) return;
    const p = parts(Date.now(), config.data.timezone || 'America/Chicago');
    if (!(s.days || []).includes(p.weekday)) return;
    const hhmm = `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
    const runs = (db.data.tvScheduleRuns = db.data.tvScheduleRuns || {});
    if (hhmm >= s.on && hhmm < s.off && runs.on !== p.dateKey) {
      runs.on = p.dateKey;
      db.save();
      log(`TV schedule: turning the dashboard TVs on (${s.on})`);
      launchAll('schedule');
    } else if (hhmm >= s.off && runs.off !== p.dateKey && runs.on === p.dateKey) {
      runs.off = p.dateKey;
      db.save();
      log(`TV schedule: turning the dashboard TVs off (${s.off})`);
      offAll(true, 'schedule');
    }
  }
  setInterval(tick, 20000);
  setTimeout(tick, 5000);
  // Keep the Admin status fresh.
  setInterval(() => Object.keys(tvs()).forEach((id) => check(id).catch(() => {})), 60000);

  // ---------- routes ----------
  const ok = (res, body = { ok: true }) => res.json(body);
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const ipOf = (req) => (req.socket.remoteAddress || '').replace('::ffff:', '');
  const cleanId = (v) => String(v || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36);
  const findByIp = (ip, platform) => Object.entries(tvs()).find(([, t]) => t.ip === ip && (!platform || t.platform === platform));

  function view(id) {
    const t = tvs()[id] || {};
    const d = dev(id);
    return {
      id,
      name: nameOf(id),
      profile: d.profile || '',
      platform: t.platform,
      ip: t.ip || '',
      mac: t.mac || '',
      appId: t.appId || '',
      paired: !!t.token,
      hasPassword: !!t.password,
      enabled: t.enabled !== false,
      online: isOnline(id),
      stream: t.platform === 'roku' ? streams.status(id) : null,
      state: state[id] || {},
    };
  }

  app.get('/api/tvs', auth.requireAdmin, (req, res) =>
    ok(res, {
      tvs: Object.keys(tvs()).map(view),
      schedule: sched(),
      found: [...found.values()].filter((f) => Date.now() - f.at < 3600e3 && !findByIp(f.ip)),
      platforms: PLATFORMS,
      server: serverBase(),
    })
  );

  app.post('/api/tvs', auth.requireAdmin, (req, res) => {
    const b = req.body || {};
    const id = cleanId(b.id) || cleanId(String(b.name || 'TV').toUpperCase().replace(/\s+/g, '-')) + '-' + Date.now().toString(36).toUpperCase();
    if (tvs()[id]) return bad(res, 'There’s already a TV with that id.');
    if (!PLATFORMS[b.platform]) return bad(res, 'Pick a TV type.');
    if (b.profile && !db.data.profiles[b.profile]) return bad(res, 'Unknown dashboard.');
    tvs()[id] = { platform: b.platform, ip: String(b.ip || '').trim(), mac: wol.cleanMac(b.mac) ? b.mac.trim() : '', appId: b.platform === 'samsung' ? SAMSUNG_APP_ID : '', enabled: true };
    const cur = dev(id);
    db.data.devices[id] = { ...cur, name: String(b.name || cur.name || id).slice(0, 40), profile: b.profile || cur.profile || '', lastSeen: cur.lastSeen || 0 };
    db.save();
    ok(res, view(id));
  });

  app.put('/api/tvs/:id', auth.requireAdmin, (req, res) => {
    const t = tvs()[req.params.id];
    if (!t) return bad(res, 'Unknown TV.', 404);
    const b = req.body || {};
    if (b.ip !== undefined) t.ip = String(b.ip).trim();
    if (b.mac !== undefined) {
      if (b.mac && !wol.cleanMac(b.mac)) return bad(res, 'That MAC address doesn’t look right (it’s 12 letters/numbers, like A1:B2:C3:D4:E5:F6).');
      t.mac = String(b.mac).trim();
    }
    if (b.platform !== undefined && PLATFORMS[b.platform]) t.platform = b.platform;
    if (b.appId !== undefined) t.appId = String(b.appId).trim();
    if (b.password !== undefined && b.password !== '') t.password = String(b.password);
    if (b.enabled !== undefined) t.enabled = !!b.enabled;
    if (b.name !== undefined) (db.data.devices[req.params.id] = { ...dev(req.params.id) }).name = String(b.name).slice(0, 40);
    db.save();
    ok(res, view(req.params.id));
  });

  app.delete('/api/tvs/:id', auth.requireAdmin, (req, res) => {
    delete tvs()[req.params.id];
    streams.stop(req.params.id);
    db.save();
    ok(res);
  });

  app.post('/api/tvs/:id/:action', auth.requireAdmin, async (req, res) => {
    const id = req.params.id;
    const t = tvs()[id];
    if (!t) return bad(res, 'Unknown TV.', 404);
    const a = req.params.action;
    try {
      if (a === 'launch') {
        launchWithRetries(id, 'admin');
        return ok(res, view(id));
      }
      if (a === 'off') {
        await offWithLog(id, false, 'admin');
        return ok(res, view(id));
      }
      if (a === 'check') {
        await check(id);
        return ok(res, view(id));
      }
      if (a === 'pair') {
        if (t.platform !== 'samsung') return bad(res, 'Only Samsung TVs need pairing.');
        await samsung.pair(t, saveToken(t));
        return ok(res, view(id));
      }
      bad(res, 'Unknown action.');
    } catch (e) {
      bad(res, e.message);
    }
  });

  app.post('/api/tvs-all/:action', auth.requireAdmin, (req, res) => {
    if (req.params.action === 'launch') launchAll('admin');
    else if (req.params.action === 'off') offAll(false, 'admin');
    else return bad(res, 'Unknown action.');
    ok(res);
  });

  app.put('/api/tv-schedule', auth.requireAdmin, (req, res) => {
    const b = req.body || {};
    const s = sched();
    const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
    const on = b.on !== undefined ? b.on : s.on;
    const offAt = b.off !== undefined ? b.off : s.off;
    if (!hm.test(on) || !hm.test(offAt)) return bad(res, 'Use times like 05:00 and 15:00.');
    if (offAt <= on) return bad(res, 'The off time has to be after the on time.');
    s.on = on;
    s.off = offAt;
    if (Array.isArray(b.days)) s.days = b.days.filter((d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].includes(d));
    if (b.enabled !== undefined) s.enabled = !!b.enabled;
    db.save();
    ok(res, s);
  });

  // ---------- for the TV apps (no sign-in; church network only) ----------
  // The Samsung app asks "who am I?" when it opens. Matched by the TV's IP,
  // then its MAC. Unknown TVs show up in Admin → TVs as "found".
  app.post('/api/tv/hello', (req, res) => {
    const b = req.body || {};
    const ip = ipOf(req);
    const mac = wol.cleanMac(b.mac);
    let hit = findByIp(ip);
    if (!hit && mac) hit = Object.entries(tvs()).find(([, t]) => wol.cleanMac(t.mac) === mac);
    if (hit) {
      const [id, t] = hit;
      let changed = false;
      if (mac && !t.mac) (t.mac = b.mac), (changed = true);
      if (!t.ip || t.ip !== ip) (t.ip = ip), (changed = true);
      if (changed) db.save();
      return ok(res, { device: id, name: nameOf(id), profile: profileOf(id), url: displayUrl(id, t.platform) });
    }
    found.set(ip, { ip, mac: b.mac || '', model: String(b.model || '').slice(0, 40), platform: b.platform || 'samsung', at: Date.now() });
    ok(res, { unknown: true, ip, mac: b.mac || '' });
  });

  // The Roku app asks for its stream. Matched by tv id, else by IP.
  app.get('/api/tv/stream', async (req, res) => {
    let id = cleanId(req.query.tv);
    if (!tvs()[id]) {
      const hit = findByIp(ipOf(req), 'roku');
      id = hit ? hit[0] : '';
    }
    if (!id) return bad(res, 'This TV isn’t set up yet: add it in Admin → Displays → TVs (IP ' + ipOf(req) + ').', 404);
    if (!profileOf(id)) return bad(res, 'Pick a dashboard for this TV in Admin → Displays → TVs.', 409);
    try {
      await streams.start(id, profileOf(id), nameOf(id));
      ok(res, { tv: id, name: nameOf(id), url: `/streams/${id}/index.m3u8`, ready: streams.ready(id) });
    } catch (e) {
      bad(res, e.message, 503);
    }
  });

  app.use(
    '/streams/:id',
    (req, res, next) => {
      streams.watched(req.params.id);
      res.setHeader('Cache-Control', 'no-cache');
      next();
    },
    (req, res, next) => express.static(path.join(streams.STREAM_DIR, cleanId(req.params.id)), { maxAge: 0, etag: false })(req, res, next)
  );

  return { launchAll, offAll, check, tick };
}

module.exports = { makeTvs, SAMSUNG_APP_ID };
