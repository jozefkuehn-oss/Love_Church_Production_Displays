/* Admin + leader page. Leaders see Messages and Live; admins also get
   Displays (layout editor), People (photos), Songs, Schedule, Wireless,
   Accounts and Settings. Built to work on a phone. */
(function () {
  const app = document.getElementById('app');
  const tabsEl = document.getElementById('tabs');
  const whoEl = document.getElementById('who');
  const S = { me: null, canSend: false, reason: '', tab: 'messages', timers: [] };

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/login') {
      S.me = null;
      showLogin();
      throw new Error(data.error || 'Please sign in.');
    }
    if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
    return data;
  }

  let toastT;
  function toast(msg, err) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (err ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), err ? 5000 : 2200);
  }
  const fail = (e) => toast(e.message, true);

  function clearTimers() {
    S.timers.forEach(clearInterval);
    S.timers = [];
  }

  const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const dur = (ms) => {
    if (ms == null) return '—';
    const neg = ms < 0;
    const t = Math.round(Math.abs(ms) / 1000);
    return `${neg ? '+' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };

  // ---------------- boot / sign-in ----------------
  async function boot() {
    try {
      const setup = await api('/api/setup-needed');
      if (setup.needed) return showSetup();
      const me = await api('/api/me');
      if (!me.account) return showLogin();
      S.me = me.account;
      S.canSend = me.canSend;
      S.reason = me.reason;
      const hash = location.hash.replace('#', '');
      S.tab = tabsFor().some((t) => t.id === hash) ? hash : 'messages';
      renderShell();
    } catch (e) {
      app.innerHTML = `<p class="muted">${esc(e.message)}</p>`;
    }
  }

  function showSetup() {
    tabsEl.hidden = true;
    whoEl.innerHTML = '';
    app.innerHTML = `<div class="login card"><h1>First-time setup</h1>
      <p class="muted">Create the first admin account. You’ll add other leaders after this.</p>
      <label>Your name<input id="sn" autocomplete="name" placeholder="Jozef Kuehn"></label>
      <label>Name in Planning Center (if different)<input id="spn" placeholder="Same as above"></label>
      <label>Choose a 4–8 digit PIN<input id="sp" inputmode="numeric" type="password" maxlength="8"></label>
      <button class="primary" id="sgo">Create admin account</button></div>`;
    $('#sgo').onclick = async () => {
      try {
        await api('/api/setup', { body: { name: $('#sn').value, pcoName: $('#spn').value || $('#sn').value, pin: $('#sp').value } });
        boot();
      } catch (e) {
        fail(e);
      }
    };
  }

  async function showLogin() {
    clearTimers();
    tabsEl.hidden = true;
    whoEl.innerHTML = '';
    const accounts = await fetch('/api/accounts/public').then((r) => r.json());
    let pin = '';
    app.innerHTML = `<div class="login card"><h1>Sign in</h1>
      <label>Who are you?<select id="la">${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
      <div class="pin-dots" id="pd"></div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '→'].map((k) => `<button data-k="${k}" class="${k === '→' ? 'primary' : ''}">${k}</button>`).join('')}</div>
      <p class="dim">Ask an admin if you need an account or forgot your PIN.</p></div>`;
    const savedId = localStorage.getItem('lcd_last');
    if (savedId && accounts.some((a) => a.id === savedId)) $('#la').value = savedId;
    const dots = () => ($('#pd').innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join(''));
    dots();
    const go = async () => {
      try {
        await api('/api/login', { body: { accountId: $('#la').value, pin } });
        localStorage.setItem('lcd_last', $('#la').value);
        boot();
      } catch (e) {
        pin = '';
        dots();
        fail(e);
      }
    };
    $$('.pinpad button').forEach(
      (b) =>
        (b.onclick = () => {
          const k = b.dataset.k;
          if (k === '⌫') pin = pin.slice(0, -1);
          else if (k === '→') return go();
          else if (pin.length < 8) pin += k;
          dots();
        })
    );
    document.onkeydown = (e) => {
      if (!$('#pd')) return;
      if (/^\d$/.test(e.key) && pin.length < 8) pin += e.key;
      else if (e.key === 'Backspace') pin = pin.slice(0, -1);
      else if (e.key === 'Enter') return go();
      dots();
    };
  }

  // ---------------- shell ----------------
  function tabsFor() {
    const t = [
      { id: 'messages', name: 'Messages' },
      { id: 'live', name: 'Live' },
    ];
    if (S.me && S.me.role === 'admin')
      t.push(
        { id: 'displays', name: 'Displays' },
        { id: 'people', name: 'People' },
        { id: 'songs', name: 'Songs' },
        { id: 'schedule', name: 'Schedule' },
        { id: 'wireless', name: 'Wireless' },
        { id: 'accounts', name: 'Accounts' },
        { id: 'settings', name: 'Settings' }
      );
    return t;
  }

  function renderShell() {
    document.onkeydown = null;
    whoEl.innerHTML = `<span>${esc(S.me.name)}${S.me.role === 'admin' ? ' · admin' : ''}</span><button class="small ghost" id="lo">Sign out</button>`;
    $('#lo').onclick = async () => {
      await api('/api/logout', { body: {} }).catch(() => {});
      showLogin();
    };
    tabsEl.hidden = false;
    tabsEl.innerHTML = tabsFor()
      .map((t) => `<button data-t="${t.id}" class="${t.id === S.tab ? 'on' : ''}">${t.name}</button>`)
      .join('');
    $$('button', tabsEl).forEach(
      (b) =>
        (b.onclick = () => {
          S.tab = b.dataset.t;
          location.hash = S.tab;
          renderShell();
        })
    );
    clearTimers();
    (VIEWS[S.tab] || VIEWS.messages)().catch(fail);
  }

  // ---------------- Messages ----------------
  const LEVELS = [
    { id: 'info', name: 'Info', color: 'var(--pink)' },
    { id: 'heads', name: 'Heads-up', color: 'var(--yellow)' },
    { id: 'urgent', name: 'Urgent', color: 'var(--red)' },
  ];
  const msgState = { targets: ['all'], level: 'info', seconds: null };

  async function viewMessages() {
    const data = await api('/api/messages');
    if (msgState.seconds == null) msgState.seconds = data.defaultSeconds;
    const durations = [
      [30, '30 sec'],
      [60, '1 min'],
      [120, '2 min'],
      [300, '5 min'],
      [600, '10 min'],
      [0, 'Until cleared'],
    ];
    app.innerHTML = `
      ${S.canSend ? '' : `<div class="banner">${esc(S.reason)}</div>`}
      <div class="card">
        <h2 style="margin:0">Send to the displays</h2>
        <textarea id="mt" maxlength="140" placeholder="Type a message…"></textarea>
        <div class="chips" id="qk">${data.quick.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q.trim())}</button>`).join('')}</div>
        <div><div class="dim" style="margin-bottom:6px">Show on</div>
          <div class="chips" id="tg">${[{ id: 'all', name: 'All displays' }, ...data.displays].map((d) => `<button class="chip ${msgState.targets.includes(d.id) ? 'on' : ''}" data-id="${d.id}">${esc(d.name)}</button>`).join('')}</div></div>
        <div class="seg" id="lv">${LEVELS.map((l) => `<button data-l="${l.id}" class="${l.id} ${msgState.level === l.id ? 'on' : ''}">${l.name}</button>`).join('')}</div>
        <div class="row nowrap"><label class="grow">Clear after<select id="md">${durations.map(([v, n]) => `<option value="${v}" ${v === msgState.seconds ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          <button class="primary" id="ms" style="align-self:flex-end;min-width:120px" ${S.canSend ? '' : 'disabled'}>Send</button></div>
      </div>
      <div class="row sp"><h2>On the displays now</h2><button class="small ghost" id="ca">Clear all</button></div>
      <div class="list" id="active"></div>
      <h2>Today’s log</h2><div class="list" id="log"></div>`;

    const mt = $('#mt');
    $$('#qk .chip').forEach(
      (b) =>
        (b.onclick = () => {
          mt.value = b.dataset.q;
          mt.focus();
          mt.setSelectionRange(mt.value.length, mt.value.length);
        })
    );
    $$('#tg .chip').forEach(
      (b) =>
        (b.onclick = () => {
          const id = b.dataset.id;
          if (id === 'all') msgState.targets = ['all'];
          else {
            msgState.targets = msgState.targets.filter((t) => t !== 'all');
            msgState.targets = msgState.targets.includes(id) ? msgState.targets.filter((t) => t !== id) : [...msgState.targets, id];
            if (!msgState.targets.length) msgState.targets = ['all'];
          }
          $$('#tg .chip').forEach((c) => c.classList.toggle('on', msgState.targets.includes(c.dataset.id)));
        })
    );
    $$('#lv button').forEach(
      (b) =>
        (b.onclick = () => {
          msgState.level = b.dataset.l;
          $$('#lv button').forEach((c) => c.classList.toggle('on', c.dataset.l === msgState.level));
        })
    );
    $('#md').onchange = (e) => (msgState.seconds = Number(e.target.value));
    $('#ms').onclick = async () => {
      try {
        await api('/api/messages', { body: { text: mt.value, level: msgState.level, targets: msgState.targets, seconds: msgState.seconds } });
        mt.value = '';
        toast('Sent');
        refresh();
      } catch (e) {
        fail(e);
      }
    };
    $('#ca').onclick = async () => {
      await api('/api/messages/clear-all', { body: {} }).catch(fail);
      refresh();
    };

    const names = Object.fromEntries([['all', 'All'], ...data.displays.map((d) => [d.id, d.name])]);
    function row(m, active) {
      const lvl = LEVELS.find((l) => l.id === m.level) || LEVELS[0];
      return `<div class="msg ${m.cleared ? 'cleared' : ''}"><span class="lvl" style="background:${lvl.color}"></span>
        <div class="grow"><div class="t">${esc(m.text)}</div><div class="m">${esc(m.from)} · ${fmtTime(m.at)} · ${m.targets.map((t) => esc(names[t] || t)).join(', ')}${m.cleared ? ' · cleared' + (m.clearedBy ? ' by ' + esc(m.clearedBy) : '') : ''}</div></div>
        ${active ? `<button class="small" data-clear="${m.id}">Clear</button>` : ''}</div>`;
    }
    async function refresh() {
      const d = await api('/api/messages').catch(() => null);
      if (!d || !$('#active')) return;
      const now = Date.now();
      const active = d.messages.filter((m) => !m.cleared && (!m.expiresAt || m.expiresAt > now));
      $('#active').innerHTML = active.length ? active.map((m) => row(m, true)).join('') : '<p class="dim">Nothing showing right now.</p>';
      $('#log').innerHTML = d.messages.length ? d.messages.map((m) => row(m, false)).join('') : '<p class="dim">No messages yet today.</p>';
      $$('[data-clear]').forEach(
        (b) =>
          (b.onclick = async () => {
            await api(`/api/messages/${b.dataset.clear}/clear`, { body: {} }).catch(fail);
            refresh();
          })
      );
    }
    refresh();
    S.timers.push(setInterval(refresh, 5000));
  }

  // ---------------- Live ----------------
  async function viewLive() {
    app.innerHTML = `<div class="card"><div class="row sp"><div><h2 style="margin:0" id="lh">Live</h2><div class="dim" id="ls"></div></div>
      <div class="row"><button id="lp">◀ Back</button><button class="primary" id="ln">Next ▶</button></div></div>
      <button class="ghost" id="la">Follow ProPresenter / planned timing again</button>
      <p class="dim">Tap an item if the screens are on the wrong part of the plan. Use this when ProPresenter isn’t tracking.</p></div>
      <div class="list" id="li" style="margin-top:12px"></div>`;
    const act = (a, body = {}) => api('/api/live/' + a, { body }).then(load).catch(fail);
    $('#lp').onclick = () => act('prev');
    $('#ln').onclick = () => act('next');
    $('#la').onclick = () => act('auto');
    async function load() {
      const d = await api('/api/live').catch(() => null);
      if (!d || !$('#li')) return;
      $('#lh').textContent = d.encounter ? `${d.encounter.label} Encounter` : 'No Encounter today';
      const src = { propresenter: 'Following Auditorium ProPresenter', manual: 'Set by hand', planned: 'Planned timing' }[d.indexSource];
      $('#ls').innerHTML = `<span class="status"><span class="dot ${d.indexSource === 'propresenter' ? 'ok' : d.indexSource === 'manual' ? 'warn' : ''}"></span>${src}</span> · Item remaining ${dur(d.remaining)}`;
      $('#li').innerHTML = d.items
        .map((it, i) => `<button class="item ${it.status === 'now' ? 'now' : it.status === 'done' ? 'done' : ''}" data-i="${i}"><span class="grow">${esc(it.title)}</span>${it.key ? `<span class="dim">${esc(it.key)}</span>` : ''}</button>`)
        .join('');
      $$('#li .item').forEach((b) => (b.onclick = () => act('set', { index: Number(b.dataset.i) })));
    }
    load();
    S.timers.push(setInterval(load, 2500));
  }

  // ---------------- Displays + layout editor ----------------
  const WIDGETS = {
    title: { name: 'Title', opts: [['kicker', 'text'], ['title', 'text'], ['sub', ['', 'live', 'date', 'encounters']], ['compact', 'bool']] },
    clock: { name: 'Time of day', opts: [['label', 'text'], ['seconds', 'bool'], ['compact', 'bool']] },
    countdown: { name: 'Countdown', opts: [['target', ['streamEnd', 'encounterStart', 'bandToStage', 'positions', 'firstStream', 'streamStart', 'nextEncounter']], ['label', 'text'], ['accent', 'bool'], ['compact', 'bool']] },
    itemRemaining: { name: 'Item remaining', opts: [['label', 'text'], ['accent', 'bool'], ['compact', 'bool']] },
    projected: { name: 'Projected finish / running', opts: [['label', 'text']] },
    runOfShow: { name: 'Run of show (live)', opts: [] },
    runOfShowDay: { name: 'Run of show (full day)', opts: [] },
    songNow: { name: 'Song now', opts: [['showFeel', 'bool'], ['showProgression', 'bool']] },
    songNext: { name: 'Next item', opts: [] },
    worshipDirection: { name: 'Worship direction', opts: [] },
    keys: { name: 'Set keys', opts: [] },
    needs: { name: 'Coming up · needs', opts: [] },
    graphics: { name: 'Broadcast graphics', opts: [] },
    faces: { name: 'Face cards', opts: [['group', ['stage', 'communicators', 'broadcast', 'leadership', 'stage+communicators', 'leadership+stage+communicators']], ['label', 'text'], ['collage', 'bool'], ['columns', 'number'], ['roleColor', 'text']] },
    worshipMics: { name: 'Worship team mics & IEMs', opts: [['columns', 'number']] },
    goto: { name: 'Go-to people', opts: [] },
    wirelessList: { name: 'Wireless list', opts: [] },
    nowNext: { name: 'Now / next strip', opts: [['compact', 'bool'], ['nowOnly', 'bool']] },
    slide: { name: 'ProPresenter slide', opts: [['which', ['current', 'next']], ['source', ['auditorium', 'broadcast']]] },
    messageBar: { name: 'Message bar', opts: [['idleText', 'text'], ['legend', 'bool'], ['big', 'bool']] },
    text: { name: 'Text', opts: [['label', 'text'], ['text', 'text'], ['size', 'number']] },
    image: { name: 'Image', opts: [['src', 'text'], ['fit', ['cover', 'contain']]] },
  };

  async function viewDisplays() {
    const profiles = await api('/api/profiles');
    app.innerHTML = `<div class="row sp"><h1>Displays</h1><button id="np">New display</button></div>
      <p class="muted">Open a display’s link on the computer or TV that shows it. Changes here reach every screen within a second.</p>
      <div class="cards">${Object.entries(profiles)
        .map(
          ([id, p]) => `<div class="card"><div class="row sp"><strong style="font-size:18px">${esc(p.name)}</strong><a href="/display/${id}" target="_blank">Open ↗</a></div>
        <div class="dim">${location.origin}/display/${id}</div>
        ${p.layouts.huddle ? `<label>Mode<select data-mode="${id}"><option value="auto" ${p.autoMode ? 'selected' : ''}>Automatic (huddle, then live)</option><option value="huddle" ${!p.autoMode && p.mode === 'huddle' ? 'selected' : ''}>Huddle</option><option value="live" ${!p.autoMode && p.mode === 'live' ? 'selected' : ''}>Live</option></select></label>` : ''}
        <div class="row"><button class="small" data-edit="${id}" data-l="live">Edit layout</button>${p.layouts.huddle ? `<button class="small" data-edit="${id}" data-l="huddle">Edit huddle layout</button>` : `<button class="small ghost" data-addh="${id}">Add huddle layout</button>`}</div></div>`
        )
        .join('')}</div>`;
    $$('[data-mode]').forEach(
      (s) =>
        (s.onchange = async () => {
          const v = s.value;
          await api('/api/profiles/' + s.dataset.mode, { method: 'PUT', body: v === 'auto' ? { autoMode: true } : { autoMode: false, mode: v } }).catch(fail);
          toast('Mode changed');
        })
    );
    $$('[data-edit]').forEach((b) => (b.onclick = () => editLayout(b.dataset.edit, b.dataset.l, profiles)));
    $$('[data-addh]').forEach(
      (b) =>
        (b.onclick = async () => {
          const p = profiles[b.dataset.addh];
          p.layouts.huddle = structuredClone(p.layouts.live);
          await api('/api/profiles/' + b.dataset.addh, { method: 'PUT', body: { layouts: p.layouts } }).catch(fail);
          viewDisplays();
        })
    );
    $('#np').onclick = async () => {
      const name = prompt('Name for the new display (for example “Lobby”)');
      if (!name) return;
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'display';
      const copy = prompt('Start from which display? (' + Object.keys(profiles).join(', ') + ') — leave empty for blank', 'greenroom');
      const base = profiles[copy] ? structuredClone(profiles[copy]) : { mode: 'live', autoMode: false, style: {}, layouts: { live: { widgets: [] } } };
      await api('/api/profiles/' + id, { method: 'PUT', body: { ...base, name } }).catch(fail);
      viewDisplays();
    };
  }

  function editLayout(id, which, profiles) {
    const prof = structuredClone(profiles[id]);
    const layout = prof.layouts[which];
    let sel = null;
    app.innerHTML = `<div class="row sp"><div><h1 style="margin-bottom:0">${esc(prof.name)}</h1><div class="dim">${which === 'huddle' ? 'Huddle layout' : 'Layout'} · drag to move, drag the corner to resize</div></div>
      <div class="row"><button class="ghost" id="eb">Back</button><button class="primary" id="es">Save</button></div></div>
      <div class="row" style="margin:12px 0">
        <label class="grow">Display name<input id="en" value="${esc(prof.name)}"></label>
        <label class="inline"><input type="checkbox" id="ec" ${prof.style.collage ? 'checked' : ''}> Edge-to-edge collage</label>
        <label class="inline"><input type="checkbox" id="ek" ${prof.style.black ? 'checked' : ''}> Pure black</label>
      </div>
      <div class="editor"><div><div class="canvas" id="cv"><div class="gridline" id="gl"></div></div>
        <h3>Preview</h3><iframe class="preview" id="pv" src="/display/${id}"></iframe></div>
        <div class="card" id="side"></div></div>`;
    const cv = $('#cv');
    const gl = $('#gl');
    function cell() {
      const r = cv.getBoundingClientRect();
      return { w: r.width / 24, h: r.height / 12, r };
    }
    function draw() {
      const c = cell();
      gl.style.backgroundSize = `${c.w}px ${c.h}px`;
      $$('.wbox', cv).forEach((e) => e.remove());
      layout.widgets.forEach((w) => {
        const el = document.createElement('div');
        el.className = 'wbox' + (sel === w.id ? ' sel' : '');
        el.dataset.id = w.id;
        el.style.left = w.x * c.w + 2 + 'px';
        el.style.top = w.y * c.h + 2 + 'px';
        el.style.width = w.w * c.w - 4 + 'px';
        el.style.height = w.h * c.h - 4 + 'px';
        el.innerHTML = `${esc((WIDGETS[w.type] || {}).name || w.type)}<small>${esc(w.opts.label || w.opts.group || w.opts.target || w.opts.title || '')}</small><span class="h"></span>`;
        cv.appendChild(el);
      });
      side();
    }
    function side() {
      const s = $('#side');
      const w = layout.widgets.find((x) => x.id === sel);
      const add = `<label>Add a widget<select id="aw"><option value="">Choose…</option>${Object.entries(WIDGETS).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('')}</select></label>`;
      if (!w) {
        s.innerHTML = `<h3 style="margin:0">Widgets</h3><p class="dim">Tap a box to change it.</p>${add}`;
      } else {
        const spec = WIDGETS[w.type] || { opts: [] };
        s.innerHTML = `<h3 style="margin:0">${esc(spec.name || w.type)}</h3>
          ${spec.opts
            .map(([k, t]) => {
              const v = w.opts[k];
              if (t === 'bool') return `<label class="inline"><input type="checkbox" data-o="${k}" ${v ? 'checked' : ''}> ${k}</label>`;
              if (Array.isArray(t)) return `<label>${k}<select data-o="${k}">${t.map((x) => `<option ${x === (v || '') ? 'selected' : ''}>${x}</option>`).join('')}</select></label>`;
              return `<label>${k}<input data-o="${k}" ${t === 'number' ? 'type="number"' : ''} value="${esc(v ?? '')}"></label>`;
            })
            .join('')}
          <div class="dim">Position ${w.x},${w.y} · size ${w.w}×${w.h}</div>
          <div class="row"><button class="small" id="dup">Duplicate</button><button class="small danger" id="del">Remove</button></div><hr style="border-color:#2c2c30;width:100%">${add}`;
        $$('[data-o]', s).forEach(
          (inp) =>
            (inp.oninput = inp.onchange = () => {
              const k = inp.dataset.o;
              const t = (spec.opts.find((o) => o[0] === k) || [])[1];
              let v = inp.type === 'checkbox' ? inp.checked : inp.value;
              if (t === 'number') v = v === '' ? undefined : Number(v);
              if (v === '' || v === undefined) delete w.opts[k];
              else w.opts[k] = v;
              draw();
            })
        );
        $('#del').onclick = () => {
          layout.widgets = layout.widgets.filter((x) => x !== w);
          sel = null;
          draw();
        };
        $('#dup').onclick = () => {
          const c = structuredClone(w);
          c.id = 'w' + Math.random().toString(36).slice(2, 7);
          c.x = Math.min(24 - c.w, c.x + 1);
          c.y = Math.min(12 - c.h, c.y + 1);
          layout.widgets.push(c);
          sel = c.id;
          draw();
        };
      }
      $('#aw', s).onchange = (e) => {
        const t = e.target.value;
        if (!t) return;
        const nw = { id: 'w' + Math.random().toString(36).slice(2, 7), type: t, x: 0, y: 0, w: 6, h: 3, opts: {} };
        layout.widgets.push(nw);
        sel = nw.id;
        draw();
      };
    }
    let drag = null;
    cv.onpointerdown = (e) => {
      const box = e.target.closest('.wbox');
      if (!box) {
        sel = null;
        return draw();
      }
      const w = layout.widgets.find((x) => x.id === box.dataset.id);
      sel = w.id;
      drag = { w, mode: e.target.classList.contains('h') ? 'size' : 'move', sx: e.clientX, sy: e.clientY, o: { ...w } };
      cv.setPointerCapture(e.pointerId);
      draw();
    };
    cv.onpointermove = (e) => {
      if (!drag) return;
      const c = cell();
      const dx = Math.round((e.clientX - drag.sx) / c.w);
      const dy = Math.round((e.clientY - drag.sy) / c.h);
      const w = drag.w;
      if (drag.mode === 'move') {
        w.x = Math.max(0, Math.min(24 - w.w, drag.o.x + dx));
        w.y = Math.max(0, Math.min(12 - w.h, drag.o.y + dy));
      } else {
        w.w = Math.max(1, Math.min(24 - w.x, drag.o.w + dx));
        w.h = Math.max(1, Math.min(12 - w.y, drag.o.h + dy));
      }
      draw();
    };
    cv.onpointerup = () => (drag = null);
    window.onresize = draw;
    $('#eb').onclick = () => {
      window.onresize = null;
      viewDisplays();
    };
    $('#es').onclick = async () => {
      prof.name = $('#en').value || prof.name;
      prof.style = { ...prof.style, collage: $('#ec').checked, black: $('#ek').checked };
      try {
        await api('/api/profiles/' + id, { method: 'PUT', body: { name: prof.name, style: prof.style, layouts: prof.layouts } });
        profiles[id] = structuredClone(prof);
        toast('Saved — screens update now');
        $('#pv').src = $('#pv').src;
      } catch (e) {
        fail(e);
      }
    };
    requestAnimationFrame(draw);
  }

  // ---------------- People / photos ----------------
  async function viewPeople() {
    const { people, helpText } = await api('/api/people');
    app.innerHTML = `<h1>People &amp; photos</h1>
      <p class="muted">Everyone scheduled on the current plan. Photos come from Slack; upload a better headshot for anyone whose Slack photo doesn’t work, then frame it with the sliders. People without a usable photo show their initials.</p>
      <input id="pf" placeholder="Search names…" style="margin-bottom:12px">
      <div class="list" id="pl"></div>
      <h2>What to go to each leader for</h2><p class="dim">Shown on the Greenroom go-to cards.</p>
      <div class="card" id="ht">${Object.entries(helpText)
        .map(([k, v]) => `<label>${esc(k)}<input data-h="${esc(k)}" value="${esc(v)}"></label>`)
        .join('')}<button class="primary" id="hs">Save</button></div>`;
    function src(p) {
      if (p.override.hidePhoto) return '';
      return p.override.photo || p.seedPhoto || p.slackPhoto || '';
    }
    function card(p) {
      const o = p.override;
      const s = src(p);
      const ini = p.name.split(' ').filter(Boolean).map((x) => x[0]).filter((c) => /[A-Za-z]/.test(c));
      const from = o.hidePhoto ? 'Initials (photo hidden)' : o.photo ? 'Uploaded photo' : p.seedPhoto ? 'Starter photo' : p.slackPhoto ? 'Slack photo' : 'No photo — initials';
      return `<div class="card person" data-n="${esc(p.name)}">
        <div class="pframe">${s ? `<img src="${esc(s)}" style="object-position:${o.focusX ?? 50}% ${o.focusY ?? 15}%;transform:scale(${o.zoom ?? 1});transform-origin:${o.focusX ?? 50}% ${o.focusY ?? 15}%">` : esc((ini[0] || '') + (ini[ini.length - 1] || ''))}</div>
        <div class="kv"><div><strong>${esc(p.name)}</strong> <span class="dim">· ${esc(p.positions.join(', '))}</span></div>
          <div class="dim">${from}</div>
          <div class="grid2"><label>Left ↔ right<input type="range" min="0" max="100" data-f="focusX" value="${o.focusX ?? 50}"></label>
          <label>Up ↕ down<input type="range" min="0" max="100" data-f="focusY" value="${o.focusY ?? 15}"></label>
          <label>Zoom<input type="range" min="1" max="2.5" step="0.05" data-f="zoom" value="${o.zoom ?? 1}"></label>
          <label>Slack name (if different)<input data-f="slackName" value="${esc(p.slackName)}" placeholder="${esc(p.name)}"></label></div>
          <div class="row"><label class="btn small" style="display:inline-flex;align-items:center;min-height:34px;padding:6px 12px;color:#fff;font-size:14px">Upload photo<input type="file" accept="image/*" data-up hidden></label>
          ${o.photo ? '<button class="small ghost" data-rm>Remove upload</button>' : ''}
          <label class="inline"><input type="checkbox" data-f="hidePhoto" ${o.hidePhoto ? 'checked' : ''}> Use initials instead</label></div></div></div>`;
    }
    function draw(filter = '') {
      $('#pl').innerHTML = people.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase())).map(card).join('');
      $$('#pl .person').forEach(bind);
    }
    function bind(el) {
      const p = people.find((x) => x.name === el.dataset.n);
      let t;
      const save = () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const body = {};
          $$('[data-f]', el).forEach((i) => (body[i.dataset.f] = i.type === 'checkbox' ? i.checked : i.type === 'range' ? Number(i.value) : i.value));
          try {
            await api('/api/people/' + encodeURIComponent(p.name), { method: 'PUT', body });
            Object.assign(p.override, body);
            p.slackName = body.slackName;
          } catch (e) {
            fail(e);
          }
        }, 300);
      };
      $$('[data-f]', el).forEach(
        (i) =>
          (i.oninput = () => {
            const img = $('img', el);
            if (img && i.type === 'range') {
              const fx = $('[data-f=focusX]', el).value;
              const fy = $('[data-f=focusY]', el).value;
              img.style.objectPosition = `${fx}% ${fy}%`;
              img.style.transformOrigin = `${fx}% ${fy}%`;
              img.style.transform = `scale(${$('[data-f=zoom]', el).value})`;
            }
            save();
            if (i.dataset.f === 'hidePhoto')
              setTimeout(() => {
                p.override.hidePhoto = i.checked;
                draw($('#pf').value);
              }, 350);
          })
      );
      const up = $('[data-up]', el);
      if (up)
        up.onchange = async () => {
          const f = up.files[0];
          if (!f) return;
          try {
            const dataUrl = await shrink(f, 1400);
            const r = await api('/api/people/' + encodeURIComponent(p.name) + '/photo', { body: { dataUrl } });
            p.override = { ...p.override, photo: r.photo, hidePhoto: false, focusX: 50, focusY: 15, zoom: 1 };
            toast('Photo uploaded');
            draw($('#pf').value);
          } catch (e) {
            fail(e);
          }
        };
      const rm = $('[data-rm]', el);
      if (rm)
        rm.onclick = async () => {
          await api('/api/people/' + encodeURIComponent(p.name) + '/photo', { method: 'DELETE' }).catch(fail);
          delete p.override.photo;
          draw($('#pf').value);
        };
    }
    $('#pf').oninput = (e) => draw(e.target.value);
    $('#hs').onclick = async () => {
      const body = {};
      $$('[data-h]').forEach((i) => (body[i.dataset.h] = i.value));
      await api('/api/helptext', { method: 'PUT', body }).then(() => toast('Saved')).catch(fail);
    };
    draw();
  }

  function shrink(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s);
        c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => reject(new Error('That file isn’t an image I can read.'));
      img.src = URL.createObjectURL(file);
    });
  }

  // ---------------- Songs ----------------
  async function viewSongs() {
    const songs = await api('/api/songs');
    app.innerHTML = `<div class="row sp"><h1>Song bank</h1><button class="primary" id="sn">Add song</button></div>
      <p class="muted">Feel, progression and notes for each song. The displays match songs in the plan by title, ignoring tags like [Tag] or [Shortened]. Start every Feel with the tempo.</p>
      <input id="sf" placeholder="Search songs…" style="margin-bottom:12px"><div class="list" id="sl"></div><div id="se"></div>`;
    function list(f = '') {
      $('#sl').innerHTML = Object.entries(songs)
        .filter(([k, v]) => (v.title || k).toLowerCase().includes(f.toLowerCase()))
        .sort((a, b) => (a[1].title || a[0]).localeCompare(b[1].title || b[0]))
        .map(([k, v]) => `<button class="item" data-k="${esc(k)}"><span class="grow"><strong>${esc(v.title || k)}</strong><br><span class="dim">${esc((v.feel || 'No Feel yet').slice(0, 90))}</span></span></button>`)
        .join('');
      $$('#sl .item').forEach((b) => (b.onclick = () => edit(b.dataset.k)));
    }
    function edit(k) {
      const v = songs[k] || { title: '', lead: '', feel: '', progression: '', notes: '', cue: '' };
      $('#se').innerHTML = `<div class="card" style="margin-top:14px"><h2 style="margin:0">${k ? 'Edit song' : 'New song'}</h2>
        <label>Title<input id="e_title" value="${esc(v.title)}"></label>
        <label>Lead<input id="e_lead" value="${esc(v.lead)}"></label>
        <label>Feel (start with tempo)<textarea id="e_feel">${esc(v.feel)}</textarea></label>
        <label>Progression (sections separated by →)<textarea id="e_progression">${esc(v.progression)}</textarea></label>
        <label>Notes<textarea id="e_notes" style="min-height:60px">${esc(v.notes)}</textarea></label>
        <label>Camera cue (shows on the huddle)<input id="e_cue" value="${esc(v.cue)}"></label>
        <div class="row"><button class="primary" id="e_s">Save</button>${k ? '<button class="danger" id="e_d">Delete</button>' : ''}<button class="ghost" id="e_c">Close</button></div></div>`;
      $('#se').scrollIntoView({ behavior: 'smooth' });
      $('#e_c').onclick = () => ($('#se').innerHTML = '');
      $('#e_s').onclick = async () => {
        const body = Object.fromEntries(['title', 'lead', 'feel', 'progression', 'notes', 'cue'].map((f) => [f, $('#e_' + f).value]));
        if (!body.title) return toast('Give the song a title.', true);
        try {
          const r = await api('/api/songs/' + encodeURIComponent(k || body.title), { method: 'PUT', body });
          if (k && r.key !== k) delete songs[k];
          songs[r.key] = body;
          toast('Saved');
          list($('#sf').value);
          $('#se').innerHTML = '';
        } catch (e) {
          fail(e);
        }
      };
      if (k)
        $('#e_d').onclick = async () => {
          if (!confirm('Delete this song from the bank?')) return;
          await api('/api/songs/' + encodeURIComponent(k), { method: 'DELETE' }).catch(fail);
          delete songs[k];
          list($('#sf').value);
          $('#se').innerHTML = '';
        };
    }
    $('#sf').oninput = (e) => list(e.target.value);
    $('#sn').onclick = () => edit('');
    list();
  }

  // ---------------- Schedule ----------------
  async function viewSchedule() {
    const s = await api('/api/schedule');
    const encRows = (list, key) =>
      list
        .map(
          (e, i) => `<tr><td><input data-k="${key}" data-i="${i}" data-f="label" value="${esc(e.label)}"></td><td><input type="time" data-k="${key}" data-i="${i}" data-f="start" value="${esc(e.start)}"></td>
        <td><input type="time" data-k="${key}" data-i="${i}" data-f="streamStart" value="${esc(e.streamStart || '')}"></td><td><input type="time" data-k="${key}" data-i="${i}" data-f="streamEnd" value="${esc(e.streamEnd || '')}"></td>
        <td><button class="small danger" data-del="${key}" data-i="${i}">✕</button></td></tr>`
        )
        .join('');
    const table = (list, key) => `<div style="overflow-x:auto"><table><tr><th>Encounter</th><th>Starts</th><th>Stream starts</th><th>Stream ends</th><th></th></tr>${encRows(list, key)}</table></div>
      <button class="small" data-add="${key}">Add Encounter</button>`;
    function draw() {
      app.innerHTML = `<h1>Schedule</h1>
        <p class="muted">The normal Sunday. When the Planning Center plan has service times, those start times are used and the stream windows here are matched to them. The stream-end countdowns use these times until Resi sync exists.</p>
        <div class="card"><h2 style="margin:0">Every Sunday</h2>${table(s.encounters, 'default')}
          <div class="grid2"><label>Positions (huddle countdown)<input type="time" id="s_pos" value="${esc(s.positions || '')}"></label>
          <label>Huddle switches to live at<input type="time" id="s_hu" value="${esc(s.huddleUntil || '')}"></label>
          <label>Band to stage (minutes before start)<input type="number" id="s_bs" value="${esc(s.bandToStageMinutes)}"></label></div></div>
        <h2>Special Sundays</h2><p class="dim">Different times for one date (holidays, baptism Sunday). Replaces the normal schedule that day.</p>
        ${Object.entries(s.overrides || {})
          .map(([d, o]) => `<div class="card" style="margin-bottom:12px"><div class="row sp"><strong>${esc(d)}</strong><button class="small danger" data-rmo="${esc(d)}">Remove</button></div>${table(o.encounters, 'o:' + d)}</div>`)
          .join('')}
        <div class="row"><input type="date" id="s_od" style="max-width:220px"><button id="s_oa">Add special Sunday</button></div>
        <div style="margin-top:18px"><button class="primary" id="s_save">Save schedule</button></div>`;
      const listFor = (key) => (key === 'default' ? s.encounters : s.overrides[key.slice(2)].encounters);
      $$('[data-f]').forEach((i) => (i.oninput = () => (listFor(i.dataset.k)[i.dataset.i][i.dataset.f] = i.value)));
      $$('[data-del]').forEach((b) => (b.onclick = () => (listFor(b.dataset.del).splice(b.dataset.i, 1), draw())));
      $$('[data-add]').forEach((b) => (b.onclick = () => (listFor(b.dataset.add).push({ label: '', start: '09:00', streamStart: '08:55', streamEnd: '10:15' }), draw())));
      $$('[data-rmo]').forEach((b) => (b.onclick = () => (delete s.overrides[b.dataset.rmo], draw())));
      $('#s_oa').onclick = () => {
        const d = $('#s_od').value;
        if (!d) return toast('Pick a date first.', true);
        s.overrides = s.overrides || {};
        s.overrides[d] = { encounters: structuredClone(s.encounters) };
        draw();
      };
      $('#s_save').onclick = async () => {
        s.positions = $('#s_pos').value;
        s.huddleUntil = $('#s_hu').value;
        s.bandToStageMinutes = Number($('#s_bs').value) || 4;
        await api('/api/schedule', { method: 'PUT', body: s }).then(() => toast('Schedule saved')).catch(fail);
      };
    }
    draw();
  }

  // ---------------- Wireless ----------------
  async function viewWireless() {
    const w = await api('/api/wireless');
    const rows = Object.entries(w).map(([k, v]) => ({ k, mic: v.mic || '', iem: v.iem || '' }));
    function draw() {
      app.innerHTML = `<h1>Wireless assignments</h1>
        <p class="muted">Which mic and IEM go with each Planning Center position. For positions with more than one person (Frontline, Encounter Host), number them: <code>Frontline#1</code>, <code>Frontline#2</code>… in worship-team order. Use <code>WIRED</code> for wired mics. Battery and RF are sample numbers until the receivers are connected.</p>
        <div class="card"><div style="overflow-x:auto"><table><tr><th>Position</th><th>Mic</th><th>IEM</th><th></th></tr>
        ${rows.map((r, i) => `<tr><td><input data-i="${i}" data-f="k" value="${esc(r.k)}"></td><td><input data-i="${i}" data-f="mic" value="${esc(r.mic)}"></td><td><input data-i="${i}" data-f="iem" value="${esc(r.iem)}"></td><td><button class="small danger" data-d="${i}">✕</button></td></tr>`).join('')}
        </table></div><div class="row"><button class="small" id="wa">Add row</button><button class="primary" id="ws">Save</button></div></div>`;
      $$('[data-f]').forEach((i) => (i.oninput = () => (rows[i.dataset.i][i.dataset.f] = i.value)));
      $$('[data-d]').forEach((b) => (b.onclick = () => (rows.splice(b.dataset.d, 1), draw())));
      $('#wa').onclick = () => (rows.push({ k: '', mic: '', iem: '' }), draw());
      $('#ws').onclick = async () => {
        const body = {};
        rows.filter((r) => r.k).forEach((r) => (body[r.k] = { mic: r.mic, ...(r.iem ? { iem: r.iem } : {}) }));
        await api('/api/wireless', { method: 'PUT', body }).then(() => toast('Saved')).catch(fail);
      };
    }
    draw();
  }

  // ---------------- Accounts ----------------
  async function viewAccounts() {
    const accounts = await api('/api/accounts');
    app.innerHTML = `<h1>Accounts</h1>
      <p class="muted">Each leader signs in with their own name and PIN, so messages show who sent them. Leaders can send messages on days they’re scheduled in a leadership role (Settings). Admins can always send and can change everything here.</p>
      <div class="list">${accounts
        .map(
          (a) => `<div class="msg"><div class="grow"><div class="t">${esc(a.name)} <span class="dim">· ${a.role}</span></div><div class="m">Planning Center name: ${esc(a.pcoName)}</div></div>
        <button class="small" data-pin="${a.id}">New PIN</button><button class="small" data-role="${a.id}" data-r="${a.role === 'admin' ? 'leader' : 'admin'}">Make ${a.role === 'admin' ? 'leader' : 'admin'}</button><button class="small danger" data-del="${a.id}">Remove</button></div>`
        )
        .join('')}</div>
      <div class="card" style="margin-top:16px"><h2 style="margin:0">Add a person</h2>
        <div class="grid2"><label>Name<input id="a_n"></label><label>Name in Planning Center<input id="a_p" placeholder="Same as name"></label>
        <label>Role<select id="a_r"><option value="leader">Leader (send messages)</option><option value="admin">Admin (everything)</option></select></label>
        <label>Starting PIN (4–8 digits)<input id="a_pin" inputmode="numeric"></label></div>
        <button class="primary" id="a_go">Add</button></div>`;
    $('#a_go').onclick = async () => {
      try {
        await api('/api/accounts', { body: { name: $('#a_n').value, pcoName: $('#a_p').value || $('#a_n').value, role: $('#a_r').value, pin: $('#a_pin').value } });
        toast('Added');
        viewAccounts();
      } catch (e) {
        fail(e);
      }
    };
    $$('[data-pin]').forEach(
      (b) =>
        (b.onclick = async () => {
          const pin = prompt('New 4–8 digit PIN');
          if (!pin) return;
          await api('/api/accounts/' + b.dataset.pin, { method: 'PUT', body: { pin } }).then(() => toast('PIN changed')).catch(fail);
        })
    );
    $$('[data-role]').forEach((b) => (b.onclick = () => api('/api/accounts/' + b.dataset.role, { method: 'PUT', body: { role: b.dataset.r } }).then(viewAccounts).catch(fail)));
    $$('[data-del]').forEach(
      (b) =>
        (b.onclick = async () => {
          if (!confirm('Remove this account?')) return;
          await api('/api/accounts/' + b.dataset.del, { method: 'DELETE' }).then(viewAccounts).catch(fail);
        })
    );
  }

  // ---------------- Settings ----------------
  async function viewSettings() {
    const [c, h, quick] = await Promise.all([api('/api/config'), api('/api/health'), api('/api/quick')]);
    const st = (ok, txt, warn) => `<span class="status"><span class="dot ${ok ? 'ok' : warn ? 'warn' : 'bad'}"></span>${esc(txt)}</span>`;
    const pp = (x) => (!x.enabled ? st(false, 'Not set up', true) : x.connected ? st(true, 'Connected' + (x.presentation ? ' · ' + x.presentation : '')) : st(false, x.error || 'Not reachable'));
    app.innerHTML = `<h1>Settings</h1>
      <div class="card"><div class="row sp"><h2 style="margin:0">Status</h2><button class="small" id="rf">Refresh now</button></div>
        <div>Mode: ${c.sampleMode ? st(false, 'Sample mode (built-in data)', true) : st(true, 'Live')}</div>
        <div>Planning Center: ${h.plan.source === 'planningcenter' ? st(true, 'Connected · ' + (h.plan.title || '') + ' ' + (h.plan.date || '')) : st(false, h.plan.error || 'Using sample plan', !h.plan.error)}</div>
        <div>Slack photos: ${h.slack.connected ? (h.slack.error ? st(false, h.slack.error) : st(true, h.slack.photos + ' photos synced')) : st(false, 'Not connected', true)}</div>
        <div>Auditorium ProPresenter: ${pp(h.propresenter.auditorium)}</div>
        <div>Broadcast ProPresenter: ${pp(h.propresenter.broadcast)}</div></div>

      <div class="card" style="margin-top:14px"><h2 style="margin:0">General</h2>
        <label class="inline"><input type="checkbox" id="c_sample" ${c.sampleMode ? 'checked' : ''}> Sample mode — run on built-in data and a demo clock (turn off once Planning Center is connected)</label>
        <div class="grid2"><label>Demo clock starts at (sample mode)<input type="time" id="c_demo" value="${esc(c.demoStart)}"></label>
        <label>Campus label<input id="c_campus" value="${esc(c.campusLabel)}"></label>
        <label>Time zone<input id="c_tz" value="${esc(c.timezone)}"></label>
        <label>Messages clear after (seconds, default)<input type="number" id="c_msgsec" value="${esc(c.messageDefaultSeconds)}"></label></div></div>

      <div class="card" style="margin-top:14px"><h2 style="margin:0">Planning Center</h2>
        <p class="dim">A Planning Center admin creates a Personal Access Token at api.planningcenteronline.com (Developers → Personal Access Tokens) and enters the Application ID and Secret here. Read-only.</p>
        <div class="grid2"><label>Application ID<input id="c_pid" value="${esc(c.pco.appId)}" autocomplete="off"></label>
        <label>Secret<input id="c_psec" type="password" value="${esc(c.pco.secret)}" autocomplete="off"></label>
        <label>Service type ID<input id="c_pst" value="${esc(c.pco.serviceTypeId)}"></label>
        <label>Refresh every (minutes)<input type="number" id="c_prf" value="${esc(c.pco.refreshMinutes)}"></label></div></div>

      <div class="card" style="margin-top:14px"><h2 style="margin:0">Slack photos</h2>
        <p class="dim">Bot User OAuth Token (starts with xoxb-) from a Slack app with the <code>users:read</code> scope.</p>
        <label>Bot token<input id="c_slack" type="password" value="${esc(c.slack.botToken)}" autocomplete="off"></label></div>

      <div class="card" style="margin-top:14px"><h2 style="margin:0">ProPresenter</h2>
        <p class="dim">In ProPresenter: Settings → Network → turn on Network, then copy the IP address and port here.</p>
        ${['auditorium', 'broadcast']
          .map(
            (m) => `<div class="grid2"><label class="inline"><input type="checkbox" id="c_${m}_on" ${c.propresenter[m].enabled ? 'checked' : ''}> ${m === 'auditorium' ? 'Auditorium machine (tracks where we are)' : 'Broadcast machine (graphics status)'}</label>
          <label>IP address<input id="c_${m}_host" value="${esc(c.propresenter[m].host)}" placeholder="192.168.1.50"></label>
          <label>Port<input type="number" id="c_${m}_port" value="${esc(c.propresenter[m].port)}"></label></div>`
          )
          .join('')}</div>

      <div class="card" style="margin-top:14px"><h2 style="margin:0">Leaders &amp; messages</h2>
        <label class="inline"><input type="checkbox" id="c_only" ${c.onlyScheduledLeaders ? 'checked' : ''}> Leaders can send only on days they’re scheduled in a leadership role</label>
        <label>Leadership roles (one Planning Center position per line)<textarea id="c_roles">${esc((c.leaderRoles || []).join('\n'))}</textarea></label>
        <label>Quick message buttons (one per line)<textarea id="c_quick">${esc(quick.join('\n'))}</textarea></label>
        <label>Plan items to hide from run-of-show displays (one per line)<textarea id="c_hide">${esc((c.hideItems || ['Washed (Remix)', 'T.I.P. Time [PA]', 'Team Huddles']).join('\n'))}</textarea></label></div>

      <div style="margin-top:18px"><button class="primary" id="c_save">Save settings</button></div>`;

    $('#rf').onclick = async () => {
      toast('Refreshing…');
      await api('/api/refresh', { body: {} }).catch(fail);
      viewSettings();
    };
    $('#c_save').onclick = async () => {
      const lines = (id) => $(id).value.split('\n').map((s) => s.trim()).filter(Boolean);
      const body = {
        sampleMode: $('#c_sample').checked,
        demoStart: $('#c_demo').value,
        campusLabel: $('#c_campus').value,
        timezone: $('#c_tz').value,
        messageDefaultSeconds: Number($('#c_msgsec').value) || 120,
        pco: { appId: $('#c_pid').value.trim(), secret: $('#c_psec').value.trim(), serviceTypeId: $('#c_pst').value.trim(), refreshMinutes: Number($('#c_prf').value) || 5 },
        slack: { ...c.slack, botToken: $('#c_slack').value.trim() },
        propresenter: {
          ...c.propresenter,
          auditorium: { enabled: $('#c_auditorium_on').checked, host: $('#c_auditorium_host').value.trim(), port: Number($('#c_auditorium_port').value) || 50001 },
          broadcast: { enabled: $('#c_broadcast_on').checked, host: $('#c_broadcast_host').value.trim(), port: Number($('#c_broadcast_port').value) || 50001 },
        },
        onlyScheduledLeaders: $('#c_only').checked,
        leaderRoles: lines('#c_roles'),
        hideItems: lines('#c_hide'),
      };
      try {
        await api('/api/config', { method: 'PUT', body });
        await api('/api/quick', { method: 'PUT', body: { quick: lines('#c_quick') } });
        toast('Settings saved');
        setTimeout(viewSettings, 1500);
      } catch (e) {
        fail(e);
      }
    };
  }

  const VIEWS = {
    messages: viewMessages,
    live: viewLive,
    displays: viewDisplays,
    people: viewPeople,
    songs: viewSongs,
    schedule: viewSchedule,
    wireless: viewWireless,
    accounts: viewAccounts,
    settings: viewSettings,
  };

  boot();
})();
