// The live state engine. Every second it works out where we are in the day
// (which Encounter, which plan item, how long is left, whether we'll make the
// stream end) and builds one snapshot that every display renders.
const path = require('path');
const fs = require('fs');
const { parts, zoned } = require('./time');
const { fetchPlan, fetchHosts } = require('./sources/pco');
const { syncPhotos } = require('./sources/slack');
const { makeProPresenter } = require('./sources/propresenter');
const { makeWireless } = require('./sources/wireless');
const { makeShure } = require('./sources/shure');
const { parseMicNotes } = require('./micnotes');
const sample = require('./seed/sample');
const photos = require('./photos');

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
// Face-card order and labels follow Planning Center's teams.
const PRODUCTION_ORDER = [
  'FOH Audio Engineer', 'Monitor Engineer', 'Broadcast Audio', 'ProPresenter Operator',
  'Broadcast ProPresenter Operator', 'Lighting Director', 'Lighting Operator',
];
const SERVICE_ORDER = ['Service Producer', 'Stage Manager', 'Floor Manager'];
const BROADCAST_ORDER = [
  'Cam 1', 'Cam 2', 'Cam 3', 'Cam 4', 'Cam 5', 'Cam 6', 'Cam 7',
  'Video Director', 'Technical Director', 'Broadcast Producer',
];
const COMMS_ORDER = ['Encounter Host', 'Online Host', 'Online Co-Host', 'Bible Teacher', 'TIP Host'];

// Handhelds, the teaching mic and belt packs: the mics that move between people.
const SPOKEN_MICS = ['HH-1', 'HH-2', 'TEACH', 'BP-1', 'BP-2'];

// Who stays to record an unstreamed Encounter (the 11:45), by PCO position.
const RECORD_CREW = ['Cam 1', 'Cam 2', 'Cam 3', 'Broadcast ProPresenter Operator', 'Broadcast Audio', 'Broadcast Producer'];
// Dashboards that skip Preshow (Pre-Encounter straight to Live) for a recording.
const RECORD_SKIP_PRESHOW = ['broadcast', 'broadcast-audio'];

const DEFAULT_PRESHOW_POINTS = '• Welcome\n• 1, 2, 5\n• Take A Next Step!\n• Pitch to :30 Countdown';

const SHORT = {
  'Worship Leader': 'WORSHIP LEADER', MD: 'MD', 'Bass Guitar': 'BASS', 'Acoustic Guitar': 'AG', Frontline: 'FRONTLINE',
  Keys: 'KEYS', Drums: 'DRUMS', 'Rhythm Electric Guitar': 'RHYTHM EG', 'Lead Electric Guitar': 'LEAD EG',
  'Video Director': 'TECHNICAL DIRECTOR', 'Broadcast Producer': 'BROADCAST PRODUCER',
  'FOH Audio Engineer': 'FOH AUDIO', 'Broadcast Audio': 'BROADCAST AUDIO', 'ProPresenter Operator': 'FOH PROP',
  'Broadcast ProPresenter Operator': 'BROADCAST PROP', 'Lighting Operator': 'LIGHTING',
  'Encounter Host': 'ENCOUNTER HOST', 'Online Host': 'ONLINE HOST', 'Online Co-Host': 'ONLINE CO-HOST',
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
  const shure = makeShure();
  let lastWirelessRows = [];
  let lastHandhelds = [];
  const receiverHosts = () => ((cfg().wireless || {}).receivers || []).filter((r) => r && r.host && r.enabled !== false).map((r) => r.host);
  const tracking = { encLabel: null, index: null, startedAt: null };
  let anchor = null; // last ProPresenter match { enc, index, at }
  const propChange = { name: '', at: 0 }; // when the auditorium presentation last changed

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
    else if (Object.values(d().wireless).some((a) => a && sample.oldWirelessMics.includes(a.mic)) && Object.values(d().wireless).every((a) => !a || !a.mic || a.mic === 'WIRED' || sample.oldWirelessMics.includes(a.mic))) {
      d().wireless = structuredClone(sample.wireless);
    }
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

  // Usual Encounter / Online hosts from Planning Center (refreshed with photos).
  let hosts = [];
  async function refreshHosts() {
    const p = cfg().pco;
    if (cfg().sampleMode || !p.appId || !p.secret) return;
    try {
      hosts = await fetchHosts(p);
    } catch (e) {
      log('Planning Center hosts list failed: ' + e.message);
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
    refreshPlan().then(refreshPhotos).then(refreshHosts);
    setInterval(() => refreshHosts(), 6 * 3600e3);
    setInterval(() => refreshPlan(), Math.max(1, cfg().pco.refreshMinutes || 5) * 60e3);
    setInterval(() => refreshPhotos(), Math.max(1, cfg().slack.refreshHours || 12) * 3600e3);
    aud.start(() => cfg().propresenter.auditorium, cfg().propresenter.pollMs || 1000);
    bc.start(() => cfg().propresenter.broadcast, (cfg().propresenter.pollMs || 1000) * 2);
    shure.configure(receiverHosts());
  }

  function restartWireless() {
    shure.configure(receiverHosts());
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
    // ships with the app, then the person's Slack photo, then Planning Center.
    const seed = photos.seedPhoto(name);
    // Planning Center profile photo as the last resort (skips its default
    // initials / no-photo avatars). Lets faces work without a Slack app.
    const pcoPerson = plan && plan.people.find((pp) => pp.name === name && pp.photo);
    const pco = pcoPerson && !/initials|no_photo|default|blank/i.test(pcoPerson.photo) ? pcoPerson.photo : '';
    let src = o.photo || seed || slackPhotos[name] || pco || '';
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
      .filter((p) => /broadcast/i.test(p.team))
      .sort((a, b) => rank(BROADCAST_ORDER, a.position) - rank(BROADCAST_ORDER, b.position))
      .map((p) => card(byName.get(p.name), short(p.position), p.position));

    // Production team (audio, ProPresenter, lighting) and service management
    // (service producers, stage manager, floor manager), straight from PCO teams.
    const production = fromTeam(/production/i, PRODUCTION_ORDER);
    const service = fromTeam(/service management|service producer|stage management/i, SERVICE_ORDER);

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
      production: dedupe(production),
      service: dedupe(service),
      leadership: dedupe(leadership),
    };
  }

  // ---- wireless ----
  let notesCache = { key: null, out: {} };
  function notesMics(people) {
    if (!plan || !plan.notes) return {};
    const list = [...(people.stage || []), ...(people.communicators || [])];
    const nameMap = d().nameMap || {};
    const key = plan.notes + '|' + list.map((c) => c.name).join(',');
    if (notesCache.key !== key) {
      const ppl = [...new Map(list.map((c) => [c.name, { name: c.name, aliases: [nameMap[c.name]].filter(Boolean) }])).values()];
      notesCache = { key, out: parseMicNotes(plan.notes, ppl) };
    }
    return notesCache.out;
  }

  function buildWireless(people) {
    const assign = d().wireless || {};
    // This Sunday's picks (Wireless tab) override the standing assignments,
    // but only for the plan they were made for.
    const wk = d().wirelessWeek && plan && d().wirelessWeek.date === plan.date ? d().wirelessWeek.byName || {} : {};
    // Assignments written in the plan's notes come next; standard ones last.
    const nm = notesMics(people);
    const rows = [];
    // standard = false: no standing assignment (spoken-word mics are set each
    // week by producers / the Floor Manager, or written in the plan notes).
    const add = (c, key, standard = true) => {
      const std = standard ? assign[key] || assign[c.position] || {} : {};
      const n = nm[c.name] || {};
      const a = { mic: n.mic || std.mic || '', iem: n.iem || std.iem || '' };
      const w = wk[c.name] || {};
      // 'N/A' = this person has no mic / IEM this week.
      const pick = (v, dflt) => (v === 'N/A' ? '' : v != null && v !== '' ? v : dflt);
      const mic = pick(w.mic, a.mic);
      const iem = pick(w.iem, a.iem);
      rows.push({ name: c.name, role: c.role, position: c.position, photo: c.photo, focusX: c.focusX, focusY: c.focusY, zoom: c.zoom, initials: c.initials, mic, iem, defMic: a.mic, defIem: a.iem, fromNotes: { mic: !!n.mic, iem: !!n.iem } });
    };
    (people.stage || []).forEach((c) => add(c, c.slot || c.position));
    const n = {};
    (people.communicators || [])
      .filter((c) => ['Bible Teacher', 'Encounter Host'].includes(c.position))
      .forEach((c) => {
        n[c.position] = (n[c.position] || 0) + 1;
        add(c, c.position, false);
      });
    // Handhelds (HH-1, HH-2) move around during the day — preshow, host
    // moment… The Floor Manager says who has each one right now, and that
    // wins over everything else for that channel.
    const hh = d().wirelessWeek && plan && d().wirelessWeek.date === plan.date ? d().wirelessWeek.handhelds || {} : {};
    const nrm = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const everyone = Object.values(people).flat();
    for (const [ch, h] of Object.entries(hh)) {
      if (!h || !h.name) continue;
      for (const r of rows) if (r.name !== h.name && nrm(r.mic) === nrm(ch)) r.mic = '';
      let r = rows.find((x) => x.name === h.name);
      if (!r) {
        const c = everyone.find((x) => x && x.name === h.name) || { name: h.name, initials: initials(h.name), ...photoFor(h.name) };
        r = { name: c.name, role: (h.moment || c.role || '').toUpperCase(), position: c.position || '', photo: c.photo, focusX: c.focusX, focusY: c.focusY, zoom: c.zoom, initials: c.initials, mic: '', iem: '', defMic: '', defIem: '', fromNotes: {} };
        rows.push(r);
      }
      r.mic = ch;
      r.handheld = h.moment || '';
    }
    // Real receivers win. Mics come from the Shure receivers by channel name.
    // IEMs are one-way radio (the belt packs can't report back), so in live
    // mode they show the assignment only, with no battery or RF.
    // In sample mode, keep the demo numbers until a receiver actually answers.
    const real = receiverHosts().length > 0 && (!cfg().sampleMode || shure.status().some((r) => r.connected));
    let mic, iem;
    if (real) {
      const ch = shure.channels();
      mic = (name) => {
        if (!name || name === 'WIRED') return { ch: name, battery: null, rf: null };
        const c = ch[shure.norm(name)];
        if (!c) return { ch: name, battery: null, rf: null, missing: true };
        if (!c.online) return { ch: c.name, battery: null, rf: null };
        if (!c.tx) return { ch: c.name, battery: null, rf: null, off: true };
        return { ch: c.name, battery: c.battery, minutes: c.minutes, rf: c.rf, muted: c.muted };
      };
      iem = (name) => ({ ch: name, battery: null, rf: null });
    } else if (cfg().sampleMode) {
      wireless.seed(rows.flatMap((r) => [r.mic, r.iem]).concat(SPOKEN_MICS));
      const live = wireless.tick();
      mic = iem = (name) => (name && name !== 'WIRED' && live[name] ? { ch: name, battery: live[name].battery, rf: live[name].rf } : { ch: name, battery: null, rf: null });
    } else {
      mic = iem = (name) => ({ ch: name, battery: null, rf: null });
    }
    // Spoken-word mics on their own, assigned or not, for the status box.
    lastHandhelds = SPOKEN_MICS.map((ch) => {
      const who = rows.find((x) => nrm(x.mic) === nrm(ch));
      const dev = mic(ch);
      return { ch, ...dev, name: who ? who.name : '', role: who ? who.role : '', moment: who ? who.handheld || '' : '', photo: who && who.photo, focusX: who && who.focusX, focusY: who && who.focusY, initials: who ? who.initials : '' };
    });
    lastWirelessRows = rows.map((r) => ({ name: r.name, position: r.position, role: r.role, mic: r.mic, iem: r.iem, defMic: r.defMic, defIem: r.defIem, fromNotes: r.fromNotes, handheld: r.handheld || '' }));
    return rows.map((r) => ({ ...r, mic: mic(r.mic), iem: r.iem ? iem(r.iem) : null }));
  }

  // ---- recording an unstreamed Encounter ----
  // Turned on per Sunday from the Live page; the crew can be changed there.
  function recordingOn() {
    const r = d().recording;
    return r && r.on && plan && r.date === plan.date ? r : null;
  }
  function recordCrew() {
    const r = recordingOn();
    if (!r || !plan) return [];
    return RECORD_CREW.map((pos) => {
      const name = (r.crew || {})[pos] || (plan.people.find((p) => p.position === pos) || {}).name || '';
      const pp = plan.people.find((p) => p.name === name);
      return { position: pos, name, role: short(pos), initials: name ? initials(name) : '', pending: pp ? pp.status !== 'confirmed' : false, ...(name ? photoFor(name) : {}) };
    });
  }

  // ---- the snapshot ----
  function snapshot() {
    const now = clock.now();
    const tz = cfg().timezone;
    const p = parts(now, tz);
    const dateKey = p.dateKey;
    const nowMin = p.h * 60 + p.mi + p.s / 60;
    // An Encounter with no stream times in the Schedule isn't streamed: its
    // stream countdowns read "Not streamed" and Live mode lasts 75 minutes.
    const rec = recordingOn();
    const encs = encountersFor(dateKey).map((e, i) => {
      let noStream = !e.streamStart && !e.streamEnd;
      // Recording this one: it gets a record window (Schedule, or 15 min
      // before start until 100 min after) and is treated like a stream.
      const recorded = !!(noStream && rec && rec.label === e.label);
      if (recorded) {
        noStream = false;
        e = { ...e, streamStart: e.recordStart || plus(e.start, -15), streamEnd: e.recordEnd || plus(e.start, 100) };
      }
      return {
        ...e,
        index: i,
        noStream,
        recorded,
        startMs: zoned(dateKey, e.start, tz),
        streamStartMs: noStream ? null : zoned(dateKey, e.streamStart || e.start, tz),
        streamEndMs: noStream ? null : zoned(dateKey, e.streamEnd || plus(e.start, 75), tz),
      };
    });

    // Three phases per Encounter:
    //   Pre-Encounter  until preshow (5 min before the Encounter start)
    //   Preshow        5 min before start → start
    //   Live           start → a few minutes after the stream ends (or 75 min)
    // Displays on Automatic switch their dashboard to match.
    const sched0 = d().schedule;
    const psLead = (sched0.preshowLeadMinutes ?? 5) * 60e3;
    const tail = (sched0.liveTailMinutes ?? 5) * 60e3;
    encs.forEach((e) => {
      e.preshowFrom = e.startMs - psLead;
      e.liveFrom = e.startMs;
      e.liveUntil = (e.streamEndMs ?? e.startMs + 75 * 60e3) + tail;
    });
    const activeEnc = encs.find((e) => now >= e.preshowFrom && now <= e.liveUntil) || null;
    const liveEnc = activeEnc && now >= activeEnc.liveFrom ? activeEnc : null;
    const preshowEnc = activeEnc && !liveEnc ? activeEnc : null;
    const upcoming = encs.find((e) => e.preshowFrom > now) || null;
    let enc = activeEnc || upcoming || encs[encs.length - 1] || null;
    const nextEnc = activeEnc ? upcoming : enc && enc.preshowFrom > now ? enc : null;

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
    // The auditorium playlist is built by hand each week, so presentations are
    // matched to plan items by name: first through any links set on the Live
    // page (presentation name -> plan item), then by comparing titles. When the
    // operator is on something that matches nothing (walk-in loop, a blank
    // look), the last match is carried forward on planned timing.
    const ap = aud.status;
    let unmatched = '';
    if (ap.connected && ap.presentation !== propChange.name) {
      propChange.name = ap.presentation;
      propChange.at = now;
    }
    if (ap.connected && ap.presentation) {
      const links = d().presentationLinks || {};
      const linked = links[ap.presentation];
      const k = songKey(ap.presentation);
      const flat = (x) => x.replace(/\s+/g, '');
      const hiddenPres = hide.includes(String(ap.presentation).toLowerCase());
      // Score every plan item against the presentation name: an explicit link
      // or an exact title wins, then one name containing the other (spaces
      // ignored, so "PRESHOW" finds "Online Pre-Show"). Ties go to the item
      // nearest after where we already are, so a presentation reused for two
      // segments (e.g. "Host Moment") walks forward instead of jumping back.
      let hit = -1;
      if (!hiddenPres) {
        const from = anchor && anchor.enc === (enc && enc.label) ? anchor.index : 0;
        let best = { score: 0, dist: Infinity, i: -1 };
        items.forEach((it, i) => {
          const ik = songKey(it.title);
          let score = 0;
          if (linked && songKey(linked) === ik) score = 4;
          else if (ik && ik === k) score = 3;
          else if (ik && k && flat(ik) === flat(k)) score = 3;
          else if (ik && k && ik.length > 3 && (flat(ik).includes(flat(k)) || flat(k).includes(flat(ik)))) score = 1 + (it.isSong ? 0.5 : 0);
          // Generic presentations reused every week ("Video Element") match the
          // week's item of the same kind ("Video | Orange Bible Story").
          else if (ik && k && k.split(' ')[0].length > 3 && ik.split(' ')[0] === k.split(' ')[0] && !it.isSong) score = 0.5;
          if (!score) return;
          const dist = i >= from ? i - from : 1000 + (from - i);
          if (score > best.score || (score === best.score && dist < best.dist)) best = { score, dist, i };
        });
        hit = best.i;
      }
      if (hit >= 0) {
        index = hit;
        indexSource = 'propresenter';
        if (!anchor || anchor.enc !== (enc && enc.label) || anchor.index !== hit) anchor = { enc: enc && enc.label, index: hit, at: now };
      } else {
        unmatched = ap.presentation;
        if (anchor && anchor.enc === (enc && enc.label) && anchor.index < items.length) {
          let k2 = anchor.index;
          let t = anchor.at + (items[k2].length || 0) * 1000;
          while (k2 < items.length - 1 && items[k2].length && now >= t) {
            k2++;
            t += (items[k2].length || 0) * 1000;
          }
          index = k2;
          indexSource = 'propresenter';
        }
      }
    }
    // A position set by hand on the Live page wins until ProPresenter moves to
    // a different presentation (or someone taps "Follow ProPresenter again").
    const live = d().live || {};
    const manualValid = live.manualIndex !== null && live.manualEnc === (enc && enc.label) && live.manualIndex < items.length;
    if (manualValid && (index === null || (live.manualSetAt || 0) >= propChange.at)) {
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
    // From the end of the 10:00 until the recording wraps, the Broadcast team
    // everywhere is just the crew staying to record.
    if (enc && enc.recorded) people.broadcast = recordCrew().filter((c) => c.name);
    const wl = buildWireless(people);
    // Singers in VOX order (VOX 1 … VOX 5, from this week's mic plan), then
    // everyone else in their usual order.
    const vox = (name) => {
      const r = wl.find((x) => x.name === name);
      const m = r && r.mic && /^VOX\s*-?\s*(\d+)$/i.exec(String(r.mic.ch || '').trim());
      return m ? Number(m[1]) : 99;
    };
    if (people.stage) people.stage = people.stage.map((c, i) => ({ c, i, v: vox(c.name) })).sort((a, b) => a.v - b.v || a.i - b.i).map((x) => x.c);
    wl.sort((a, b) => vox(a.name) - vox(b.name));

    // Sample mode: simulate both ProPresenter machines so the slide, graphics
    // and section widgets can be seen before the real machines are connected.
    let sampleProP = null;
    let sampleSection = null;
    if (cfg().sampleMode && current && (!aud.status.connected || !bc.status.connected)) {
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
          timers: (() => {
            const left = Math.max(0, Math.round((remainingMs || 0) / 1000));
            const f = (t) => `00:${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
            return [{ name: 'Song', time: f(left), state: 'running' }, { name: 'Message', time: '00:35:00', state: 'stopped' }];
          })(),
          stageMessage: '',
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
      .map((m) => ({ id: m.id, text: m.text, level: m.level, flash: !!m.flash, targets: m.targets, from: m.from, at: m.at }));

    // Preshow: a built-in 4:30 countdown (no ProPresenter needed). By default
    // it runs on the Schedule's "Preshow ends" time; a producer can also start
    // it by hand (Live tab → Start preshow). If it runs past zero it counts
    // negative and flashes red until the Encounter starts.
    const preshow = (() => {
      const sch = d().schedule;
      const len = (sch.preshowSeconds ?? 270) * 1000;
      const ctlAll = d().preshowCtl || {};
      for (const e of encs) {
        const ctl = ctlAll[`${dateKey}|${e.label}`] || {};
        if (ctl.endedAt) continue;
        let startMs, endMs;
        if (ctl.startedAt) {
          startMs = ctl.startedAt;
          endMs = startMs + len;
        } else {
          if (!e.preshowEnd || !/^\d{2}:\d{2}(:\d{2})?$/.test(e.preshowEnd)) continue;
          endMs = zoned(dateKey, e.preshowEnd.slice(0, 5), tz) + (Number(e.preshowEnd.slice(6, 8)) || 0) * 1000;
          startMs = endMs - len;
        }
        // Running over counts negative until the Encounter starts, then the
        // timer goes away on its own.
        const overUntil = Math.max(endMs, e.startMs);
        if (now >= overUntil) continue;
        const state = now < startMs ? 'waiting' : now < endMs ? 'running' : 'over';
        return { label: e.label, state, startMs, endMs, manual: !!ctl.startedAt, remainingMs: state === 'waiting' ? len : endMs - now };
      }
      return null;
    })();

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
      nextStart: nextEnc ? nextEnc.startMs : null,
      nextStreamStart: nextEnc ? nextEnc.streamStartMs : null,
      // Which stream countdowns are empty because that Encounter isn't streamed.
      notStreamed: [...(enc && enc.noStream ? ['streamStart', 'streamEnd'] : []), ...(nextEnc && nextEnc.noStream ? ['nextStreamStart'] : [])],
      nextBandToStage: nextEnc ? nextEnc.startMs - (sched.bandToStageMinutes || 4) * 60e3 : null,
    };

    // Display modes: Automatic follows the phases; Pre / Preshow / Live are fixed.
    const modes = {};
    for (const [id, pr] of Object.entries(d().profiles)) {
      const setting = pr.modeSetting || 'auto';
      let mode = setting === 'auto' ? (liveEnc ? 'live' : preshowEnc ? 'preshow' : 'pre') : setting;
      if (setting === 'auto' && mode === 'preshow' && preshowEnc.recorded && RECORD_SKIP_PRESHOW.includes(id)) mode = 'pre';
      if (!pr.layouts[mode]) mode = pr.layouts.live ? 'live' : Object.keys(pr.layouts)[0];
      modes[id] = mode;
    }

    return {
      now,
      tz,
      date: { key: dateKey, weekday: p.weekday, label: new Date(now).toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'short', day: 'numeric' }) },
      campus: cfg().campusLabel,
      sampleMode: !!cfg().sampleMode,
      rehearsal: clock.rehearsal() ? { time: clock.rehearsal().time, date: clock.rehearsal().dateKey } : null,
      plan: plan ? { title: plan.title, date: plan.date, source: planSource } : null,
      encounters: encs.map((e) => ({ label: e.label, start: e.start, streamEnd: e.streamEnd, startMs: e.startMs, streamEndMs: e.streamEndMs })),
      encounter: enc ? { label: enc.label, index: enc.index, startMs: enc.startMs, streamEndMs: enc.streamEndMs, recorded: !!enc.recorded } : null,
      recording: rec ? { label: rec.label } : null,
      isLive: !!liveEnc,
      isPreshow: !!preshowEnc,
      nextEncounter: nextEnc ? { label: nextEnc.label, startMs: nextEnc.startMs, streamStartMs: nextEnc.streamStartMs, recorded: !!nextEnc.recorded } : null,
      preshow,
      // Pre-Show Teleprompter talking points (edited on the Live page).
      preshowPoints: d().preshowPoints != null ? d().preshowPoints : DEFAULT_PRESHOW_POINTS,
      encounterStates: encs.map((e) => ({ label: e.label, state: e === liveEnc ? 'live' : e === preshowEnc ? 'preshow' : now > e.liveUntil ? 'done' : e === nextEnc ? 'next' : 'later' })),
      items: items.map(({ id, title, key, length, isSong, status, position }) => ({ id, title, key, length, isSong, status, position })),
      index,
      indexSource,
      unmatchedPresentation: unmatched,
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
      handhelds: lastHandhelds,
      messages,
      targets,
      modes,
      section: sampleSection,
      // A real, connected machine always wins; in sample mode a machine that
      // isn't connected is simulated.
      propresenter: {
        auditorium: aud.status.connected || !sampleProP
          ? { connected: aud.status.connected, enabled: aud.status.enabled, presentation: aud.status.presentation, current: aud.status.current, next: aud.status.next, timers: aud.status.timers, stageMessage: aud.status.stageMessage, thumb: thumbKeys(aud.status) }
          : sampleProP.auditorium,
        broadcast: bc.status.connected || !sampleProP
          ? { connected: bc.status.connected, enabled: bc.status.enabled, presentation: bc.status.presentation, current: bc.status.current, next: bc.status.next, timers: bc.status.timers, stageMessage: bc.status.stageMessage, thumb: thumbKeys(bc.status) }
          : sampleProP.broadcast,
      },
    };
  }

  // Thumbnail ids for the current and next slide (null when unknown).
  function thumbKeys(st) {
    if (!st.connected || !st.presentationUuid || st.slideIndex == null) return null;
    return { uuid: st.presentationUuid, current: st.slideIndex, next: st.slideIndex + 1 };
  }
  async function propThumbnail(source, uuid, index) {
    const m = source === 'broadcast' ? bc : aud;
    return m.thumbnail(uuid, index);
  }

  // Live tab buttons: start the preshow now, end it, or go back to the schedule.
  function preshowAction(action, label) {
    const tz = cfg().timezone;
    const now = clock.now();
    const dateKey = parts(now, tz).dateKey;
    const snap = snapshot();
    const lab = label || (snap.preshow && snap.preshow.label) || (snap.nextEncounter && snap.nextEncounter.label) || (snap.encounter && snap.encounter.label);
    if (!lab) return null;
    const all = (d().preshowCtl = d().preshowCtl || {});
    for (const k of Object.keys(all)) if (!k.startsWith(dateKey + '|')) delete all[k]; // keep today only
    let key = `${dateKey}|${lab}`;
    // Reset undoes the most recent start/end today, whichever Encounter it was.
    if (action === 'reset' && !label) {
      const recent = Object.entries(all).sort((x, y) => Math.max(y[1].startedAt || 0, y[1].endedAt || 0) - Math.max(x[1].startedAt || 0, x[1].endedAt || 0))[0];
      if (recent) key = recent[0];
    }
    if (action === 'start') all[key] = { startedAt: now };
    else if (action === 'end') all[key] = { ...(all[key] || {}), endedAt: now };
    else delete all[key];
    db.save();
    return lab;
  }

  function health() {
    return {
      sampleMode: !!cfg().sampleMode,
      plan: { source: planSource, error: planError, fetchedAt: planFetchedAt, title: plan && plan.title, date: plan && plan.date },
      slack: { error: slackError, syncedAt: slackSyncedAt, photos: Object.keys(slackPhotos).length, connected: !!cfg().slack.botToken },
      propresenter: { auditorium: { ...aud.status, current: undefined, next: undefined }, broadcast: { ...bc.status, current: undefined, next: undefined } },
      wireless: { receivers: shure.status() },
    };
  }

  return { recordCrew, RECORD_CREW, preshowAction, propThumbnail, startLoops, refreshPlan, refreshPhotos, restartProPresenter, restartWireless, wirelessChannels: () => shure.channels(), wirelessRows: () => lastWirelessRows, getHosts: () => hosts, refreshHosts, snapshot, health, songKey, getPlan: () => plan, getSlackPhotos: () => slackPhotos };
}

module.exports = { makeEngine, songKey, resolveTitle };
