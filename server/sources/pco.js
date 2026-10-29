// Planning Center Services connector. Uses a Personal Access Token (Application
// ID + Secret) created by a Planning Center admin at
// https://api.planningcenteronline.com/oauth/applications
// Read-only: it never changes anything in Planning Center.
const { parts } = require('../time');

const BASE = 'https://api.planningcenteronline.com/services/v2';

// Planning Center allows 100 requests per 20 seconds per account. Every call
// goes through this pacer, which keeps us under ~70 per 20 s, and a 429 waits
// out PCO's Retry-After and tries again.
const WINDOW_MS = 20000;
const MAX_PER_WINDOW = 70;
const sent = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pace() {
  for (;;) {
    const now = Date.now();
    while (sent.length && now - sent[0] > WINDOW_MS) sent.shift();
    if (sent.length < MAX_PER_WINDOW) {
      sent.push(now);
      return;
    }
    await sleep(WINDOW_MS - (now - sent[0]) + 50);
  }
}

async function get(cfg, path) {
  const url = path.startsWith('http') ? path : BASE + path;
  const auth = Buffer.from(`${cfg.appId}:${cfg.secret}`).toString('base64');
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    await pace();
    res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
    if (res.status !== 429) break;
    const wait = Number(res.headers.get('retry-after')) || 20;
    await sleep(Math.min(60, wait) * 1000 + 250);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Planning Center ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Follow `links.next` so lists longer than one page come back whole.
async function getAll(cfg, path) {
  let next = path;
  const data = [];
  const included = [];
  for (let guard = 0; next && guard < 20; guard++) {
    const page = await get(cfg, next);
    data.push(...(page.data || []));
    included.push(...(page.included || []));
    next = page.links && page.links.next;
  }
  return { data, included };
}

function hhmm(iso, tz) {
  const p = parts(Date.parse(iso), tz);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

function label(hm) {
  const [h, m] = hm.split(':').map(Number);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')}`;
}

// PCO item details are HTML (often pasted from Pages/Word). Turn them into
// plain text, one paragraph per line, blank paragraphs dropped.
function detailsText(html) {
  if (!html) return '';
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// Today's plan if there is one, otherwise the next upcoming plan.
async function fetchPlan(cfg, todayKey, tz, serviceTypeId) {
  const st = serviceTypeId || cfg.serviceTypeId;
  let list;
  try {
    list = await get(cfg, `/service_types/${st}/plans?filter=after&after=${todayKey}&order=sort_date&per_page=1`);
  } catch (e) {
    // Older API behavior: fall back to "future" plans.
    list = await get(cfg, `/service_types/${st}/plans?filter=future&order=sort_date&per_page=1`);
  }
  const p = list.data && list.data[0];
  if (!p) throw new Error('No upcoming plan found in Planning Center for this service type.');
  const planId = p.id;

  const [times, items, people, notes] = await Promise.all([
    getAll(cfg, `/service_types/${st}/plans/${planId}/plan_times?per_page=50`),
    getAll(cfg, `/service_types/${st}/plans/${planId}/items?include=song,key,item_notes&per_page=100`),
    getAll(cfg, `/service_types/${st}/plans/${planId}/team_members?include=team&per_page=100`),
    // Plan notes (and item notes, below) sometimes carry the mic assignments.
    getAll(cfg, `/service_types/${st}/plans/${planId}/notes?per_page=100`).catch(() => ({ data: [], included: [] })),
  ]);
  const noteText = [
    ...notes.data.map((n) => `${n.attributes.category_name || ''}: ${n.attributes.content || ''}`),
    ...items.included.filter((x) => x.type === 'ItemNote').map((n) => `${n.attributes.category_name || ''}: ${n.attributes.content || ''}`),
  ]
    .map((t) => t.replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'))
    .join('\n');

  const teams = {};
  people.included.filter((x) => x.type === 'Team').forEach((t) => (teams[t.id] = t.attributes.name));

  const serviceTimes = times.data
    .filter((t) => t.attributes.time_type === 'service' && t.attributes.starts_at)
    .sort((a, b) => Date.parse(a.attributes.starts_at) - Date.parse(b.attributes.starts_at));

  const date = serviceTimes.length
    ? parts(Date.parse(serviceTimes[0].attributes.starts_at), tz).dateKey
    : (p.attributes.sort_date || '').slice(0, 10);

  return {
    id: planId,
    title: [p.attributes.series_title, p.attributes.title].filter(Boolean).join(' · ') || p.attributes.dates,
    date,
    notes: noteText,
    serviceTypeId: String(st),
    times: serviceTimes.map((t) => {
      const start = hhmm(t.attributes.starts_at, tz);
      // End time from PCO (events use it for how long Live lasts).
      const end = t.attributes.ends_at && Date.parse(t.attributes.ends_at) > Date.parse(t.attributes.starts_at) ? hhmm(t.attributes.ends_at, tz) : '';
      return { label: label(start), start, end };
    }),
    items: items.data
      .sort((a, b) => a.attributes.sequence - b.attributes.sequence)
      .map((it) => ({
        id: it.id,
        title: it.attributes.title,
        type: it.attributes.item_type,
        length: it.attributes.length || 0,
        key: it.attributes.key_name || null,
        position: it.attributes.service_position,
        // The item's "Details" in PCO (where the Message notes go), as text.
        details: detailsText(it.attributes.html_details),
      })),
    people: people.data
      .filter((m) => m.attributes.status !== 'D')
      .map((m) => ({
        name: m.attributes.name,
        team: teams[m.relationships && m.relationships.team && m.relationships.team.data && m.relationships.team.data.id] || '',
        position: m.attributes.team_position_name,
        status: m.attributes.status === 'C' ? 'confirmed' : m.attributes.status === 'U' ? 'unconfirmed' : m.attributes.status,
        photo: m.attributes.photo_thumbnail,
      })),
  };
}

// Everyone assigned to the hosting positions (Encounter Host / Co-Host,
// Online Host / Co-Host) on the Communicators team, whether or not they're on
// this week's plan. Used for the Floor Manager's handheld list.
async function fetchHosts(cfg) {
  const st = cfg.serviceTypeId;
  const pos = await getAll(cfg, `/service_types/${st}/team_positions?include=team&per_page=100`);
  const teams = {};
  pos.included.filter((x) => x.type === 'Team').forEach((t) => (teams[t.id] = t.attributes.name));
  const hostPositions = pos.data.filter((tp) => {
    const team = teams[tp.relationships && tp.relationships.team && tp.relationships.team.data && tp.relationships.team.data.id] || '';
    return /communicators/i.test(team) && /^(encounter|online)\s+(co-?\s*)?host$/i.test(tp.attributes.name.trim());
  });
  const names = new Set();
  for (const tp of hostPositions) {
    const a = await getAll(cfg, `/service_types/${st}/team_positions/${tp.id}/person_team_position_assignments?include=person&per_page=100`);
    a.included.filter((x) => x.type === 'Person').forEach((p) => {
      const n = p.attributes.full_name || [p.attributes.first_name, p.attributes.last_name].filter(Boolean).join(' ');
      if (n) names.add(n.trim());
    });
  }
  return [...names];
}

// PCO full names can carry nicknames: 'Todd "PT" Doxzon', 'Ben (Benjamin)
// Norvig'. Plans show the plain name ("Todd Doxzon"), so match on that.
function plainName(n) {
  return String(n || '').replace(/\([^)]*\)/g, ' ').replace(/"[^"]*"|“[^”]*”/g, ' ').replace(/\s+/g, ' ').trim();
}

// Everyone assigned to each team and each position in Planning Center,
// whether or not they're on this week's plan, plus their PCO photo. Used for
// the Subs lists (a team or position only offers its own people) and photos.
//   { teams: { team: [names] }, positions: { 'team|position': [names] }, photos: { name: url } }
async function fetchTeamRosters(cfg) {
  const st = cfg.serviceTypeId;
  const pos = await getAll(cfg, `/service_types/${st}/team_positions?include=team&per_page=100`);
  const teams = {};
  pos.included.filter((x) => x.type === 'Team').forEach((t) => (teams[t.id] = t.attributes.name));
  const byTeam = {};
  const byPos = {};
  const pics = {};
  const todo = pos.data.slice();
  async function worker() {
    for (let tp = todo.shift(); tp; tp = todo.shift()) {
      const team = teams[tp.relationships && tp.relationships.team && tp.relationships.team.data && tp.relationships.team.data.id] || '';
      if (!team) continue;
      const tset = (byTeam[team] = byTeam[team] || new Set());
      const pset = (byPos[team + '|' + tp.attributes.name] = byPos[team + '|' + tp.attributes.name] || new Set());
      const a = await getAll(cfg, `/service_types/${st}/team_positions/${tp.id}/person_team_position_assignments?include=person&per_page=100`);
      a.included.filter((x) => x.type === 'Person').forEach((p) => {
        const at = p.attributes;
        const n = plainName(at.full_name || [at.first_name, at.last_name].filter(Boolean).join(' '));
        if (!n) return;
        tset.add(n);
        pset.add(n);
        const url = at.photo_url || at.photo_thumbnail_url || '';
        if (url && !/initials|no_photo|default|blank/i.test(url)) pics[n] = url;
      });
    }
  }
  // Two at a time; the pacer above keeps the total under PCO's limit.
  await Promise.all([worker(), worker()]);
  const list = (o) => Object.fromEntries(Object.entries(o).map(([k, set]) => [k, [...set]]));
  return { teams: list(byTeam), positions: list(byPos), photos: pics };
}

// What's happening this week, for the midweek screen: every Services plan in
// the next 7 days across this campus's service types (Hallelujah Night,
// VALOR, Prayer, Young Adult Night…), with service and rehearsal times. Plus
// the PCO Calendar's approved events when the account is allowed to read it.
//   [{ name, kind: 'service'|'rehearsal'|'other'|'event', startMs, endMs, where }]
async function fetchWeek(cfg) {
  const now = Date.now();
  const until = now + 7 * 86400e3;
  const out = [];
  const types = await getAll(cfg, '/service_types?per_page=100');
  for (const st of types.data) {
    const name = String(st.attributes.name || '').trim();
    // Skip the other campus and the kids' check-in types.
    if (!name || st.attributes.archived_at || /^lcno\b|babies|littles|bigs|love kidz|^lcm$/i.test(name)) continue;
    let plans;
    try {
      plans = await get(cfg, `/service_types/${st.id}/plans?filter=future&order=sort_date&per_page=4`);
    } catch (e) {
      continue;
    }
    for (const p of plans.data || []) {
      const sd = Date.parse(p.attributes.sort_date || '');
      if (!sd || sd > until) continue;
      const times = await get(cfg, `/service_types/${st.id}/plans/${p.id}/plan_times?per_page=50`).catch(() => ({ data: [] }));
      const label = name.replace(/^ES\s*\|\s*/i, '').trim();
      const title = p.attributes.title ? `${label} · ${p.attributes.title}` : label;
      for (const t of times.data || []) {
        const a = t.attributes;
        const startMs = Date.parse(a.starts_at || '');
        if (!startMs || startMs > until || Date.parse(a.ends_at || a.starts_at) < now) continue;
        const kind = a.time_type === 'rehearsal' ? 'rehearsal' : a.time_type === 'service' ? 'service' : 'other';
        out.push({ name: kind === 'other' && a.name ? `${title} · ${a.name}` : title, kind, startMs, endMs: Date.parse(a.ends_at || '') || null, where: '' });
      }
    }
  }
  // PCO Calendar (only if this account may read it).
  try {
    const cal = await get(cfg, `https://api.planningcenteronline.com/calendar/v2/event_instances?filter=future,approved&order=starts_at&per_page=100`);
    for (const ev of cal.data || []) {
      const a = ev.attributes;
      const startMs = Date.parse(a.starts_at || '');
      if (!startMs || startMs > until) continue;
      out.push({ name: a.name || 'Event', kind: a.all_day_event ? 'allday' : 'event', startMs, endMs: Date.parse(a.ends_at || '') || null, where: a.location || '' });
    }
  } catch (e) {
    // No Calendar permission: Services plans only.
  }
  // Same thing from both sources: keep one.
  const seen = new Set();
  return out
    .sort((a, b) => a.startMs - b.startMs)
    .filter((e) => {
      const k = e.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) + '|' + Math.round(e.startMs / 600e3);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// Is one of the event service types (REV, All-In, VALOR, AGAPE…) on today?
// Returns { id, name } of the first with a plan dated today, else null.
async function todaysEvent(cfg, todayKey, tz, ids) {
  for (const id of ids || []) {
    let list;
    try {
      list = await get(cfg, `/service_types/${id}/plans?filter=future&order=sort_date&per_page=1&include=service_type`);
    } catch (e) {
      continue;
    }
    const p = list.data && list.data[0];
    if (!p || !p.attributes.sort_date) continue;
    if (parts(Date.parse(p.attributes.sort_date), tz).dateKey !== todayKey) continue;
    const st = (list.included || []).find((x) => x.type === 'ServiceType');
    return { id: String(id), name: String((st && st.attributes.name) || p.attributes.series_title || 'Event').trim() };
  }
  return null;
}

module.exports = { fetchPlan, fetchHosts, fetchTeamRosters, fetchWeek, todaysEvent, plainName, detailsText };
