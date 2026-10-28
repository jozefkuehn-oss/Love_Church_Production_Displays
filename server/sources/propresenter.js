// ProPresenter 7.9+ network API poller. In ProPresenter: Settings → Network →
// enable Network, note the IP address and port, and enter them in the admin
// page. Read-only: the dashboard watches, it never drives ProPresenter.

function makeProPresenter(name) {
  const status = {
    name,
    enabled: false,
    connected: false,
    lastOk: 0,
    error: '',
    presentation: '',
    current: { text: '', notes: '' },
    next: { text: '', notes: '' },
    slideIndex: null,
    timers: [],
    stageMessage: '',
    presentationUuid: '',
  };
  let timer = null;
  let tick = 0;
  let slides = []; // active presentation's slide texts (fallback)
  let slidesFor = '';

  async function call(host, port, p) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 900);
    try {
      const res = await fetch(`http://${host}:${port}${p}`, { signal: ctl.signal, headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(t);
    }
  }

  const slideText = (s) => (s && (s.text || (s.slide && s.slide.text))) || '';
  const slideNotes = (s) => (s && (s.notes || (s.slide && s.slide.notes))) || '';

  async function poll(cfg) {
    const { host, port } = cfg;
    try {
      // Some ProPresenter versions answer /v1/status/slide with nothing. Then
      // the text comes from the active presentation's slides + the slide index.
      let slide = null;
      try {
        slide = await call(host, port, '/v1/status/slide');
      } catch (e) {
        if (e.name === 'AbortError') throw e;
      }
      const fromStatus = slide && (slide.current || slide.next);
      if (fromStatus) {
        status.current = { text: slideText(slide.current), notes: slideNotes(slide.current) };
        status.next = { text: slideText(slide.next), notes: slideNotes(slide.next) };
      } else {
        const idx = await call(host, port, '/v1/presentation/slide_index').catch(() => null);
        const pi = idx && (idx.presentation_index || idx);
        const uuid = pi && pi.presentation_id && pi.presentation_id.uuid;
        if (tick % 10 === 0) slidesFor = ''; // pick up edits to the presentation
        if (uuid && uuid !== slidesFor) {
          const active = await call(host, port, '/v1/presentation/active').catch(() => null);
          const pr = active && (active.presentation || active);
          slides = [];
          for (const g of (pr && pr.groups) || []) for (const sl of g.slides || []) slides.push({ text: (sl.text || '').trim(), notes: sl.notes || '' });
          slidesFor = (pr && pr.id && pr.id.uuid) || uuid;
        }
        const i = pi && typeof pi.index === 'number' ? pi.index : -1;
        const cur = i >= 0 ? slides[i] : null;
        const nxt = i >= 0 ? slides[i + 1] : null;
        status.current = { text: (cur && cur.text) || '', notes: (cur && cur.notes) || '' };
        status.next = { text: (nxt && nxt.text) || '', notes: (nxt && nxt.notes) || '' };
      }
      // Timers every poll so they count in real time.
      const timers = await Promise.allSettled([call(host, port, '/v1/timers/current')]).then((r) => r[0]);
      if (timers.status === 'fulfilled' && Array.isArray(timers.value)) {
        status.timers = timers.value.map((t) => ({
          name: (t.id && t.id.name) || t.name || 'Timer',
          time: t.time || '',
          state: t.state || '',
        }));
      }
      // The rest changes less often; ask every other poll.
      if (tick++ % 2 === 0) {
        const [active, idx, msg] = await Promise.allSettled([
          call(host, port, '/v1/presentation/active'),
          call(host, port, '/v1/presentation/slide_index'),
          call(host, port, '/v1/stage/message'),
        ]);
        if (msg.status === 'fulfilled') status.stageMessage = typeof msg.value === 'string' ? msg.value : (msg.value && msg.value.message) || '';
        if (active.status === 'fulfilled' && active.value) {
          const pr = active.value.presentation || active.value;
          status.presentation = (pr.id && pr.id.name) || pr.name || '';
          status.presentationUuid = (pr.id && pr.id.uuid) || pr.uuid || '';
        }
        if (idx.status === 'fulfilled' && idx.value) {
          const pi = idx.value.presentation_index || idx.value;
          status.slideIndex = typeof pi.index === 'number' ? pi.index : null;
          if (pi.presentation_id && pi.presentation_id.uuid) status.presentationUuid = pi.presentation_id.uuid;
        }
      }
      status.connected = true;
      status.lastOk = Date.now();
      status.error = '';
    } catch (e) {
      status.connected = false;
      status.error = e.name === 'AbortError' ? 'No answer (is ProPresenter open with Network enabled?)' : e.message;
    }
  }

  function start(getCfg, pollMs) {
    stop();
    const loop = async () => {
      const cfg = getCfg();
      lastCfg = cfg;
      status.enabled = !!(cfg && cfg.enabled && cfg.host);
      if (status.enabled) await poll(cfg);
      else status.connected = false;
      timer = setTimeout(loop, pollMs);
    };
    loop();
  }
  function stop() {
    clearTimeout(timer);
  }

  // A slide's thumbnail image from ProPresenter (JPEG), for the slide
  // preview widget. Small in-memory cache keyed by presentation + slide.
  const thumbs = new Map();
  let lastCfg = null;
  async function thumbnail(uuid, index) {
    const key = `${uuid}:${index}`;
    if (thumbs.has(key)) return thumbs.get(key);
    if (!lastCfg || !uuid || index == null || index < 0) return null;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    try {
      const res = await fetch(`http://${lastCfg.host}:${lastCfg.port}/v1/presentation/${encodeURIComponent(uuid)}/thumbnail/${index}?quality=480`, { signal: ctl.signal });
      if (!res.ok) return null;
      const img = { type: res.headers.get('content-type') || 'image/jpeg', body: Buffer.from(await res.arrayBuffer()) };
      thumbs.set(key, img);
      if (thumbs.size > 40) thumbs.delete(thumbs.keys().next().value);
      return img;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(t);
    }
  }

  return { status, start, stop, thumbnail };
}

module.exports = { makeProPresenter };
