// The live state engine. Every second it works out where we are in the day
// (which Encounter, which plan item, how long is left, whether we'll make the
// stream end) and builds one snapshot that every display renders.
const path = require('path');
const fs = require('fs');
const { parts, zoned } = require('./time');
const { fetchPlan } = require('./sources/pco');
const { syncPhotos } = require('./sources/slack');
const { makeProPresenter } = require('./sources/propresenter');
const { makeWireless } = require('./sources/wireless');
const sample = require('./seed/sample');

const SEED_PHOTO_DIR = path.join(__dirname, 'seed', 'photos');

// ---------- text helpers ----------

// "[Shortened] Wild Rushing Wind (Live)" -> "wild rushing wind"
function songKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const timeToken = (h, m) => `${+h}:${m || '00'}`;

// Item titles carry per-Encounter variations:
//   "Host [Jordan | MJ | Jordan]"  -> the name for this Encounter (by order)
//   "Message | 10A + 11:45A"       -> only in the 10:00 and 11:45 Encounters
function resolveTitle(title, encLabel, encIndex) {
  let t = String(title);
  let include = true;
  const pipe = t.match(/\s\|\s*([0-9:apm +&,]+)$/i);
  if (pipe) {
    const toks = [...pipe[1].matchAll(/(\d{1,2})(?::(\d{2}))?\s*a/gi)].map((m) => timeToken(m[1], m[2]));
    if (toks.length) {
      include = toks.includes(encLabel);
      t = t.slice(0, pipe.index).trim();
    }
  }
  t = t.replace(/\[([^\]]*\|[^\]]*)\]/g, (_, inner) => {
    const opts = inner.split('|').map((s) => s.trim());
    return `[${opts[Math.min(encIndex, opts.length - 1)]}]`;
  });
  return { title: t, include };
}

const hmToMin = (hm) => {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + (m || 0);
};

const POSITION_ORDER = [
  'Worship Leader', 'MD', 'Music Director', 'Frontline', 'Vocals', 'Keys', 'Piano', 'Drums',
  'Bass Guitar', 'Acoustic Guitar', 'Rhythm Electric Guitar', 'Lead Electric Guitar', 'Electric Guitar',
];
const BROADCAST_ORDER = [
  'Broadcast Producer', 'Video Director', 'Technical Director', 'Broadcast ProPresenter Operator', 'Broadcast Audio',
  'Cam 1', 'Cam 2', 'Cam 3', 'Cam 4', 'Cam 5', 'Cam 6', 'Cam 7',
];
const COMMS_ORDER = ['Bible Teacher', 'Encounter Host', 'Online Host', 'Online Co-Host', 'TIP Host'];

const SHORT = {
  'Worship Leader': 'WORSHIP LEADER', MD: 'MD', 'Bass Guitar': 'BASS', 'Acoustic Guitar': 'AG', Frontline: 'FRONTLINE',
  Keys: 'KEYS', Drums: 'DRUMS', 'Rhythm Electric Guitar': 'RHYTHM EG', 'Lead Electric Guitar': 'LEAD EG',
  'Broadcast Producer': 'PRODUCER', 'Video Director': 'VIDEO DIR', 'Broadcast ProPresenter Operator': 'GRAPHICS',
  'Broadcast Audio': 'AUDIO', 'Encounter Host': 'HOST', 'Online Co-Host': 'ONLINE CO-HOST', 'FOH Audio Engineer': 'FOH ENGINEER',
};
const short = (p) => (SHORT[p] || p).toUpperCase();

function initials(name) {
  const p = String(name).replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean);
  if (!p.length) return '?';
  return (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

// ---------- engine ----------

function makeEngine({ config, db, clock, log }) {
  let plan = null;
  let planSource = 'none';
  let planError = '';
  let planFetchedAt = 0;
  let slackPhotos = {};
  let slackError = '';
  let slackSyncedAt = 0;
  const aud = makeProPresenter('auditorium');
  const bc = makeProPresenter('broadcast');
  const wireless = makeWireless();
  const tracking = { encLabel: null, index: null, startedAt: null };

  const cfg = () => config.data;
  const d = () => db.data;

  // ---- data loading ----
  function loadSample() {
    plan = structuredClone(sample.plan);
    planSource = 'sample';
    planError = '';
    clock.setDemo(sample.date);
    // Seed song bank + wireless assignments the first time.
    for (const [k, v] of Object.entries(sample.songs)) if (!d().songs[k]) d().songs[k] = v;
    if (!d().wireless) d().wireless = structuredClone(sample.wireless);
    db.save();
  }

  async function refreshPlan() {
    if (cfg().sampleMode) return loadSample();
    const p = cfg().pco;
    if (!p.appId || !p.secret) {
      planError = 'Planning Center is not connected yet (Settings).';
      if (!plan) loadSample();
      return;
    }
    try {
      const today = parts(clock.now(), cfg().timezone).dateKey;
      plan = await fetchPlan(p, today, cfg().timezone);
      planSource = 'planningcenter';
      planError = '';
      planFetchedAt = Date.now();
      if (!d().wireless) {
        d().wireless = structuredClone(sample.wireless);
        db.save();
      }
    } catch (e) {
      planError = e.message;
      log('Planning Center refresh failed: ' + e.message);
      if (!plan) loadSample();
    }
  }

  async function refreshPhotos() {
    const token = cfg().slack.botToken;
    if (!token || !plan) return;
    try {
      const names = [...new Set(plan.people.map((p) => p.name))];
      const got = await syncPhotos(token, names, d().nameMap || {});
      slackPhotos = { ...slackPhotos, ...got };
      slackSyncedAt = Date.now();
      slackError = '';
    } catch (e) {
      slackError = e.message;
      log('Slack photo sync failed: ' + e.message);
    }
  }

  function startLoops() {
    refreshPlan().then(refreshPhotos);
    setInterval(() => refreshPlan(), Math.max(1, cfg().pco.refreshMinutes || 5) * 60e3);
    setInterval(() => refreshPhotos(), Math.max(1, cfg().slack.refreshHours || 12) * 3600e3);
    aud.start(() => cfg().propresenter.auditorium, cfg().propresenter.pollMs || 1000);
    bc.start(() => cfg().propresenter.broadcast, (cfg().propresenter.pollMs || 1000) * 2);
  }

  function restartProPresenter() {
    aud.start(() => cfg().propresenter.auditorium, cfg().propresenter.pollMs || 1000);
    bc.start(() => cfg().propresenter.broadcast, (cfg().propresenter.pollMs || 1000) * 2);
  }

  // ---- schedule ----
  function encountersFor(dateKey) {
    const s = d().schedule;
    if (s.overrides && s.overrides[dateKey] && s.overrides[dateKey].encounters) return s.overrides[dateKey].encounters;
    const base = s.encounters || [];
    if (plan && plan.times && plan.times.length && plan.date === dateKey) {
      // Use the plan's service times; take stream windows from the schedule by
      // matching start time (or default to 5 min before / plan length after).
      return plan.times.map((t) => {
        const m = base.find((e) => e.start === t.start || e.label === t.label);
        return m ? { ...m, label: t.label, start: t.start } : { label: t.label, start: t.start, streamStart: minus(t.start, 5), streamEnd: plus(t.start, 75) };
      });
    }
    return base;
  }
  const fmtHM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const minus = (hm, n) => fmtHM(hmToMin(hm) - n);
  const plus = (hm, n) => fmtHM(hmToMin(hm) + n);

  // ---- people ----
  function photoFor(name) {
    const o = (d().people || {})[name] || {};
    // Order: an uploaded override, then the hand-cropped starter photo that
    // ships with the app, then the person's Slack photo.
    const f = name.toLowerCase().replace(/[^a-z ]/g, '').trim().replace(/\s+/g, '-') + '.jpg';
    const seed = fs.existsSync(path.join(SEED_PHOTO_DIR, f)) ? '/seed-photos/' + f : '';
    let src = o.photo || seed || slackPhotos[name] || '';
    if (o.hidePhoto) src = '';
    return { photo: src, focusX: o.focusX ?? 50, focusY: o.focusY ?? 15, zoom: o.zoom ?? 1 };
  }

  function buildPeople() {
    if (!plan) return {};
    const byName = new Map();
    for (const p of plan.people) {
      const cur = byName.get(p.name) || { name: p.name, positions: [], teams: new Set(), status: p.status };
      cur.positions.push(p.position);
      cur.teams.add(p.team);
      if (p.status !== 'confirmed') cur.status = p.status;
      byName.set(p.name, cur);
    }
    const card = (person, role, position) => ({
      name: person.name,
      role,
      position,
      initials: initials(person.name),
      pending: person.status !== 'confirmed',
      ...photoFor(person.name),
    });
    const rank = (order, pos) => {
      const i = order.findIndex((o) => pos.startsWith(o));
      return i < 0 ? 99 : i;
    };

    // Worship team: one card per person, positions merged (MD + Bass -> MD · BASS)
    const stage = [];
    let frontN = 0;
    for (const person of byName.values()) {
      const wp = plan.people.filter((p) => p.name === person.name && /worship/i.test(p.team)).map((p) => p.position);
      if (!wp.length) continue;
      const sorted = [...wp].sort((a, b) => rank(POSITION_ORDER, a) - rank(POSITION_ORDER, b));
      let primary = sorted[0];
      let role;
      if (primary === 'Worship Leader') role = 'WORSHIP LEADER';
      else if (primary === 'MD' && wp.includes('Bass Guitar')) role = 'MD · BASS';
      else if (primary === 'Frontline' && wp.includes('Acoustic Guitar')) role = 'FRONTLINE · AG';
      else role = short(primary);
      stage.push({ ...card(person, role, primary), sortKey: rank(POSITION_ORDER, primary) });
    }
    stage.sort((a, b) => a.sortKey - b.sortKey);
    // Frontline numbering for wireless assignments (Frontline#1, #2...)
    stage.forEach((s) => {
      if (s.position === 'Frontline') s.slot = `Frontline#${++frontN}`;
    });

    const fromTeam = (re, order) =>
      plan.people
        .filter((p) => re.test(p.team))
        .sort((a, b) => rank(order, a.position) - rank(order, b.position))
        .map((p) => card(byName.get(p.name), short(p.position), p.position));

    const communicators = fromTeam(/communicator/i, COMMS_ORDER);

    const broadcast = plan.people
      .filter((p) => /broadcast/i.test(p.team) || /^broadcast /i.test(p.position))
      .sort((a, b) => rank(BROADCAST_ORDER, a.position) - rank(BROADCAST_ORDER, b.position))
      .map((p) => card(byName.get(p.name), short(p.position), p.position));

    const leaderRoles = cfg().leaderRoles || [];
    const leadership = plan.people
      .filter((p) => leaderRoles.includes(p.position))
      .sort((a, b) => leaderRoles.indexOf(a.position) - leaderRoles.indexOf(b.position))
      .map((p) => ({ ...card(byName.get(p.name), short(p.position), p.position), help: (d().helpText || {})[p.position] || '' }));

    const dedupe = (list) => {
      const seen = new Set();
      return list.filter((c) => {
        const k = c.name + '|' + c.role;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    };
    return {
      stage,
      communicators: dedupe(communicators),
      broadcast: dedupe(broadcast),
      leadership: dedupe(leadership),
    };
  }

  // ---- wireless ----
  function buildWireless(people) {
    const assign = d().wireless || {};
    const rows = [];
    const add = (c, key) => {
      const a = assign[key] || assign[c.position] || {};
      rows.push({ name: c.name, role: c.role, photo: c.photo, focusX: c.focusX, focusY: c.focusY, zoom: c.zoom, initials: c.initials, mic: a.mic || '', iem: a.iem || '' });
    };
    (people.stage || []).forEach((c) => add(c, c.slot || c.position));
    const n = {};
    (people.communicators || [])
      .filter((c) => ['Bible Teacher', 'Encounter Host'].includes(c.position))
      .forEach((c) => {
        n[c.position] = (n[c.position] || 0) + 1;
        add(c, assign[`${c.position}#${n[c.position]}`] ? `${c.position}#${n[c.position]}` : c.position);
      });
    wireless.seed(rows.flatMap((r) => [r.mic, r.iem]));
    const live = wireless.tick();
    const dev = (ch) => (ch && ch !== 'WIRED' && live[ch] ? { ch, battery: live[ch].battery, rf: live[ch].rf } : { ch, battery: null, rf: true });
    return rows.map((r) => ({ ...r, mic: dev(r.mic), iem: r.iem ? dev(r.iem) : null }));
  }

  // ---- the snapshot ----
  function snapshot() {
    const now = clock.now();
    const tz = cfg().timezone;
    const p = parts(now, tz);
    const dateKey = p.dateKey;
    const nowMin = p.h * 60 + p.mi + p.s / 60;
    const encs = encountersFor(dateKey).map((e, i) => ({
      ...e,
      index: i,
      startMs: zoned(dateKey, e.start, tz),
      streamStartMs: zoned(dateKey, e.streamStart || e.start, tz),
      streamEndMs: zoned(dateKey, e.streamEnd || plus(e.start, 75), tz),
    }));

    // Current Encounter: the one in progress (from 30 min before start to 10
    // min after stream end), otherwise the next one, otherwise the last.
    let enc =
      encs.find((e) => now >= e.startMs - 30 * 60e3 && now <= e.streamEndMs + 10 * 60e3) ||
      encs.find((e) => e.startMs > now) ||
      encs[encs.length - 1] ||
      null;

    // Items for this Encounter.
    const hide = (cfg().hideItems || ['Washed (Remix)', 'T.I.P. Time [PA]', 'Team Huddles']).map((s) => s.toLowerCase());
    let items = [];
    if (plan && enc) {
      for (const it of plan.items) {
        if (it.type === 'header') continue;
        if (hide.includes(String(it.title).toLowerCase())) continue;
        const r = resolveTitle(it.title, enc.label, enc.index);
        if (!r.include) continue;
        items.push({ id: it.id, title: r.title, type: it.type, length: it.length || 0, key: it.key, position: it.position, isSong: it.type === 'song' });
      }
      // Planned start times: "during" items run from the Encounter start;
      // "pre" items stack backwards before it; "post" items follow.
      const during = items.filter((i) => i.position !== 'pre');
      let t = enc.startMs;
      for (const i of during) {
        i.plannedStart = t;
        t += i.length * 1000;
      }
      const pre = items.filter((i) => i.position === 'pre');
      let back = enc.startMs;
      for (let k = pre.length - 1; k >= 0; k--) {
        back -= pre[k].length * 1000;
        pre[k].plannedStart = back;
      }
    }

    // Which item is live?
    const songs = d().songs || {};
    let index = null;
    let indexSource = 'planned';
    const ap = aud.status;
    if (ap.connected && ap.presentation) {
      const k = songKey(ap.presentation);
      const hit = items.findIndex((i) => songKey(i.title) === k || (k && songKey(i.title).includes(k)) || (k && k.includes(songKey(i.title)) && songKey(i.title).length > 3));
      if (hit >= 0) {
        index = hit;
        indexSource = 'propresenter';
      }
    }
    const live = d().live || {};
    if (index === null && live.manualIndex !== null && live.manualEnc === (enc && enc.label) && live.manualIndex < items.length) {
      index = live.manualIndex;
      indexSource = 'manual';
    }
    if (index === null && items.length) {
      index = 0;
      for (let k = 0; k < items.length; k++) if (items[k].plannedStart <= now) index = k;
      if (enc && now < items[0].plannedStart) index = 0;
    }

    // When did the live item start? Track changes; fall back to planned time.
    if (enc && (tracking.encLabel !== enc.label || tracking.index !== index)) {
      const planned = items[index] && items[index].plannedStart;
      tracking.startedAt = indexSource === 'planned' ? planned : now;
      if (indexSource === 'manual' && live.manualSetAt) tracking.startedAt = live.manualSetAt;
      tracking.encLabel = enc.label;
      tracking.index = index;
    }

    let current = items[index] || null;
    let remainingMs = null;
    let driftMs = 0;
    let projectedEnd = null;
    if (current) {
      const started = tracking.startedAt || current.plannedStart;
      remainingMs = current.length ? current.length * 1000 - (now - started) : null;
      driftMs = started - current.plannedStart;
      let rest = Math.max(remainingMs || 0, 0);
      for (let k = index + 1; k < items.length; k++) if (items[k].position !== 'post') rest += items[k].length * 1000;
      projectedEnd = now + rest;
      items.forEach((it, k) => (it.status = k < index ? 'done' : k === index ? 'now' : k === index + 1 ? 'next' : ''));
    }

    const songInfo = (it) => {
      if (!it || !it.isSong) return null;
      const s = songs[songKey(it.title)] || {};
      return { title: it.title, key: it.key, length: it.length, lead: s.lead || '', feel: s.feel || '', progression: s.progression || '', notes: s.notes || '', cue: s.cue || '', inBank: !!songs[songKey(it.title)] };
    };
    const nextItem = items[index + 1] || null;
    const nextSong = items.slice(index + 1).find((i) => i.isSong) || null;

    // Full-day run of show for the huddle (two columns: first Encounter, and the rest).
    const runDay = encs.map((e) => {
      const list = [];
      if (plan) {
        for (const it of plan.items) {
          if (it.type === 'header' || hide.includes(String(it.title).toLowerCase())) continue;
          const r = resolveTitle(it.title, e.label, e.index);
          if (!r.include) continue;
          list.push({ id: it.id, title: r.title, key: it.key, isSong: it.type === 'song', varies: /\[[^\]]*\|/.test(it.title) || /\s\|\s*\d/.test(it.title) });
        }
      }
      return { label: e.label, items: list };
    });

    // Worship direction for every song in the day's plan.
    const daySongs = [];
    if (plan) {
      const seen = new Set();
      for (const it of plan.items) {
        if (it.type !== 'song' || hide.includes(String(it.title).toLowerCase())) continue;
        const k = songKey(it.title);
        if (seen.has(k)) continue;
        seen.add(k);
        const s = songs[k] || {};
        daySongs.push({ title: s.title || it.title, key: it.key, lead: s.lead || '', feel: s.feel || '', progression: s.progression || '', notes: s.notes || '', cue: s.cue || '', inBank: !!songs[k] });
      }
    }

    const people = buildPeople();
    const wl = buildWireless(people);

    // Sample mode: simulate both ProPresenter machines so the slide, graphics
    // and section widgets can be seen before the real machines are connected.
    let sampleProP = null;
    let sampleSection = null;
    if (cfg().sampleMode && !aud.status.enabled && current) {
      const sn = songInfo(current);
      const secs = sn && sn.progression ? sn.progression.split(/\s*→\s*/) : [];
      const frac = current.length && remainingMs != null ? Math.min(0.999, Math.max(0, 1 - remainingMs / (current.length * 1000))) : 0;
      if (secs.length) sampleSection = Math.floor(frac * secs.length);
      const secName = secs.length ? secs[sampleSection].replace(/\s*\(.*\)/, '') : current.title;
      const nextName = secs.length && secs[sampleSection + 1] ? secs[sampleSection + 1].replace(/\s*\(.*\)/, '') : (nextItem ? nextItem.title : '');
      sampleProP = {
        auditorium: {
          enabled: true, connected: true, presentation: current.title,
          current: { text: current.isSong ? `[ ${secName} · lyric line 1 ]\n[ ${secName} · lyric line 2 ]` : current.title, notes: '' },
          next: { text: current.isSong ? `[ ${nextName} · lyric line 1 ]` : nextItem ? nextItem.title : '', notes: '' },
          timers: [],
        },
        broadcast: {
          enabled: true, connected: true, presentation: current.isSong ? 'Lyrics' : 'Lower thirds',
          current: { text: current.title }, next: { text: nextItem && /rapport|message/i.test(nextItem.title) ? 'Lower third · Todd Doxzon' : (nextItem ? nextItem.title : '') },
        },
      };
    }

    // Messages (expiry uses the real clock, not the demo clock).
    const realNow = Date.now();
    const messages = (d().messages || [])
      .filter((m) => !m.cleared && (!m.expiresAt || m.expiresAt > realNow))
      .slice(-5)
      .map((m) => ({ id: m.id, text: m.text, level: m.level, targets: m.targets, from: m.from, at: m.at }));

    // Countdown targets.
    const sched = d().schedule;
    const first = encs[0];
    const targets = {
      encounterStart: enc ? enc.startMs : null,
      streamEnd: enc ? enc.streamEndMs : null,
      streamStart: enc ? enc.streamStartMs : null,
      bandToStage: enc ? enc.startMs - (sched.bandToStageMinutes || 4) * 60e3 : null,
      positions: sched.positions ? zoned(dateKey, sched.positions, tz) : null,
      firstStream: first ? first.streamStartMs : null,
      nextEncounter: (encs.find((e) => e.startMs > now) || {}).startMs || null,
    };

    // Display modes (huddle before huddleUntil for profiles that switch automatically).
    const huddleUntilMs = sched.huddleUntil ? zoned(dateKey, sched.huddleUntil, tz) : null;
    const modes = {};
    for (const [id, pr] of Object.entries(d().profiles)) {
      let mode = pr.mode || 'live';
      if (pr.autoMode && pr.layouts.huddle && huddleUntilMs) mode = now < huddleUntilMs ? 'huddle' : 'live';
      if (!pr.layouts[mode]) mode = 'live';
      modes[id] = mode;
    }

    return {
      now,
      tz,
      date: { key: dateKey, weekday: p.weekday, label: new Date(now).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }) },
      campus: cfg().campusLabel,
      sampleMode: !!cfg().sampleMode,
      plan: plan ? { title: plan.title, date: plan.date, source: planSource } : null,
      encounters: encs.map((e) => ({ label: e.label, start: e.start, streamEnd: e.streamEnd, startMs: e.startMs, streamEndMs: e.streamEndMs })),
      encounter: enc ? { label: enc.label, index: enc.index, startMs: enc.startMs, streamEndMs: enc.streamEndMs } : null,
      items: items.map(({ id, title, key, length, isSong, status, position }) => ({ id, title, key, length, isSong, status, position })),
      index,
      indexSource,
      current: current ? { title: current.title, key: current.key, length: current.length, isSong: current.isSong } : null,
      next: nextItem ? { title: nextItem.title, key: nextItem.key, length: nextItem.length, isSong: nextItem.isSong } : null,
      itemRemainingMs: remainingMs,
      driftMs,
      projectedEnd,
      overStreamMs: projectedEnd && enc ? projectedEnd - enc.streamEndMs : null,
      songNow: songInfo(current),
      songNext: songInfo(nextSong),
      daySongs,
      runDay,
      people,
      wireless: wl,
      messages,
      targets,
      modes,
      section: sampleSection,
      propresenter: sampleProP || {
        auditorium: { connected: aud.status.connected, enabled: aud.status.enabled, presentation: aud.status.presentation, current: aud.status.current, next: aud.status.next, timers: aud.status.timers },
        broadcast: { connected: bc.status.connected, enabled: bc.status.enabled, presentation: bc.status.presentation, current: bc.status.current, next: bc.status.next },
      },
    };
  }

  function health() {
    return {
      sampleMode: !!cfg().sampleMode,
      plan: { source: planSource, error: planError, fetchedAt: planFetchedAt, title: plan && plan.title, date: plan && plan.date },
      slack: { error: slackError, syncedAt: slackSyncedAt, photos: Object.keys(slackPhotos).length, connected: !!cfg().slack.botToken },
      propresenter: { auditorium: { ...aud.status, current: undefined, next: undefined }, broadcast: { ...bc.status, current: undefined, next: undefined } },
    };
  }

  return { startLoops, refreshPlan, refreshPhotos, restartProPresenter, snapshot, health, songKey, getPlan: () => plan, getSlackPhotos: () => slackPhotos };
}

module.exports = { makeEngine, songKey, resolveTitle };
