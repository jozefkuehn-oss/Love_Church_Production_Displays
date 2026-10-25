// Planning Center Services connector. Uses a Personal Access Token (Application
// ID + Secret) created by a Planning Center admin at
// https://api.planningcenteronline.com/oauth/applications
// Read-only: it never changes anything in Planning Center.
const { parts } = require('../time');

const BASE = 'https://api.planningcenteronline.com/services/v2';

async function get(cfg, path) {
  const url = path.startsWith('http') ? path : BASE + path;
  const auth = Buffer.from(`${cfg.appId}:${cfg.secret}`).toString('base64');
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } });
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

// Today's plan if there is one, otherwise the next upcoming plan.
async function fetchPlan(cfg, todayKey, tz) {
  const st = cfg.serviceTypeId;
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

  const [times, items, people] = await Promise.all([
    getAll(cfg, `/service_types/${st}/plans/${planId}/plan_times?per_page=50`),
    getAll(cfg, `/service_types/${st}/plans/${planId}/items?include=song,key&per_page=100`),
    getAll(cfg, `/service_types/${st}/plans/${planId}/team_members?include=team&per_page=100`),
  ]);

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
    times: serviceTimes.map((t) => {
      const start = hhmm(t.attributes.starts_at, tz);
      return { label: label(start), start };
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

module.exports = { fetchPlan };
