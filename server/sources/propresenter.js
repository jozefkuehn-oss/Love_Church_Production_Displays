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
  };
  let timer = null;
  let tick = 0;

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
      const slide = await call(host, port, '/v1/status/slide');
      status.current = { text: slideText(slide && slide.current), notes: slideNotes(slide && slide.current) };
      status.next = { text: slideText(slide && slide.next), notes: slideNotes(slide && slide.next) };
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
        }
        if (idx.status === 'fulfilled' && idx.value) {
          const pi = idx.value.presentation_index || idx.value;
          status.slideIndex = typeof pi.index === 'number' ? pi.index : null;
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

  return { status, start, stop };
}

module.exports = { makeProPresenter };
