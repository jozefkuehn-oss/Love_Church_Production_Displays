/* Display client: /display/<profile>. Connects to the server, receives the
   live snapshot every second and renders the profile's layout. Reconnects by
   itself if the server restarts or the network drops. */
(function () {
  const profileId = decodeURIComponent(location.pathname.split('/').filter(Boolean)[1] || 'broadcast');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  // URL options for a TV's own launcher (see docs/TV-INTEGRATION.md):
  //   ?device=<id>  stable id from the TV   ?name=<text>  friendly name
  //   ?lock=1       remote can't change the dashboard   ?preview=1  admin preview
  const params = new URLSearchParams(location.search);
  const preview = params.get('preview') === '1';
  const clean = (v) => String(v || '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36);
  // Each screen keeps an id so the admin page can see it and move it between rooms.
  let device = preview ? '' : clean(params.get('device')) || store.get('lcd_device');
  if (!device && !preview) device = clean(crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  if (!preview) {
    store.set('lcd_device', device);
    if (params.get('name')) store.set('lcd_name', params.get('name').slice(0, 40));
    if (params.has('lock')) store.set('lcd_lock', params.get('lock') === '1' ? '1' : '');
    store.set('lcd_room', profileId);
  }
  const locked = preview || store.get('lcd_lock') === '1';
  const changeRoom = () => !locked && location.assign('/display?choose=1');

  // Change rooms: R / Escape / Back on a keyboard or remote, or press and hold 3 s.
  document.addEventListener('keydown', (e) => {
    if (locked) return;
    if (['r', 'R', 'Escape', 'Backspace', 'BrowserBack', 'GoBack'].includes(e.key)) {
      e.preventDefault();
      changeRoom();
    }
  });
  let holdTimer = null;
  const startHold = () => {
    clearTimeout(holdTimer);
    holdTimer = setTimeout(changeRoom, 3000);
  };
  const endHold = () => clearTimeout(holdTimer);
  ['mousedown', 'touchstart'].forEach((ev) => document.addEventListener(ev, startHold, { passive: true }));
  ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach((ev) => document.addEventListener(ev, endHold, { passive: true }));
  const screen = document.getElementById('screen');
  const offline = document.getElementById('offline');
  const cache = new Map(); // widget id -> last html
  let layoutSig = '';

  function fit() {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    screen.style.transform = `scale(${s})`;
  }
  window.addEventListener('resize', fit);
  fit();

  function geometry(style) {
    const collage = !!style.collage;
    const padX = collage ? 0 : 36;
    const padY = collage ? 0 : 28;
    const gap = collage ? 4 : 16;
    const cw = (1920 - 2 * padX - 23 * gap) / 24;
    const ch = (1080 - 2 * padY - 11 * gap) / 12;
    return { gap, cw, ch };
  }

  function render(msg) {
    const { profile, snap } = msg;
    const style = profile.style || {};
    const widgets = (profile.layout && profile.layout.widgets) || [];
    const sig = JSON.stringify([profile.mode, style, widgets]);
    document.body.dataset.mode = profile.mode;
    if (sig !== layoutSig) {
      // Layout changed (or first load): rebuild the grid.
      layoutSig = sig;
      cache.clear();
      screen.className = (style.collage ? 'collage ' : '') + (style.black ? 'black' : '');
      screen.innerHTML = widgets
        .map((w) => `<div class="w" data-id="${w.id}" style="grid-column:${w.x + 1} / span ${w.w};grid-row:${w.y + 1} / span ${w.h}"></div>`)
        .join('');
      document.title = profile.name + ' · Love Church';
    }
    const g = geometry(style);
    for (const w of widgets) {
      const el = screen.querySelector(`[data-id="${CSS.escape(w.id)}"]`);
      const fn = window.LCD.widgets[w.type];
      if (!el) continue;
      let html;
      try {
        html = fn
          ? fn(w.opts || {}, snap, { profileId: profile.id, w: w.w * g.cw + (w.w - 1) * g.gap, h: w.h * g.ch + (w.h - 1) * g.gap })
          : `<div class="missing">Unknown widget “${w.type}”</div>`;
      } catch (e) {
        console.error(w.type, e);
        html = `<div class="missing">${w.type}: ${e.message}</div>`;
      }
      if (cache.get(w.id) !== html) {
        el.innerHTML = html;
        cache.set(w.id, html);
      }
    }
  }

  let ws;
  let lastMsg = 0;
  function connect() {
    const nm = store.get('lcd_name');
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?profile=${encodeURIComponent(profileId)}&device=${encodeURIComponent(device)}${nm ? '&name=' + encodeURIComponent(nm) : ''}`);
    ws.onmessage = (ev) => {
      lastMsg = Date.now();
      offline.hidden = true;
      const msg = JSON.parse(ev.data);
      if (msg.type === 'snapshot') render(msg);
      else if (msg.type === 'assign' && msg.profile && msg.profile !== profileId && !preview) {
        // An admin moved this screen to another room.
        store.set('lcd_room', msg.profile);
        location.replace('/display/' + encodeURIComponent(msg.profile));
      }
      else if (msg.type === 'missing') screen.innerHTML = `<div class="missing" style="grid-column:1/-1;grid-row:1/-1;font-size:32px">No display profile called “${profileId}”. ${locked ? 'Ask an admin to move this screen in Admin → Displays.' : 'Press R to pick this screen’s room.'}</div>`;
    };
    ws.onclose = () => {
      offline.hidden = false;
      setTimeout(connect, 2000);
    };
    ws.onerror = () => ws.close();
  }
  connect();
  // If nothing arrives for 10 s, force a reconnect (covers sleeping Wi-Fi).
  setInterval(() => {
    if (Date.now() - lastMsg > 10000 && ws && ws.readyState === 1) ws.close();
  }, 5000);
})();
