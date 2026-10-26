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
    if (res.status === 401 && path !== '/api/login' && path !== '/api/login-role') {
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
      const p = S.me.perms || [];
      const home = p.includes('handhelds') && !p.includes('wireless') ? 'handhelds' : 'messages';
      S.tab = tabsFor().some((t) => t.id === hash) ? hash : home;
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

  // Sign-in: pick the role you're serving in today, then its PIN.
  // Admins use their personal account from the link at the bottom.
  async function showLogin(mode) {
    clearTimers();
    tabsEl.hidden = true;
    whoEl.innerHTML = '';
    document.onkeydown = null;
    const store = {
      get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    };
    if (mode === 'admin') {
      const accounts = await fetch('/api/accounts/public').then((r) => r.json());
      app.innerHTML = `<div class="login card"><div class="row sp"><h1 style="margin:0">Admin sign-in</h1><button class="small ghost" id="back">Back</button></div>
        <label>Your name<select id="la">${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
        ${pinPadHtml()}<p class="dim">Forgot your PIN? Another admin can reset it.</p></div>`;
      const saved = store.get('lcd_last');
      if (saved && accounts.some((a) => a.id === saved)) $('#la').value = saved;
      $('#back').onclick = () => showLogin();
      return pinPad(async (pin) => {
        await api('/api/login', { body: { accountId: $('#la').value, pin } });
        store.set('lcd_last', $('#la').value);
        boot();
      });
    }
    const roles = await fetch('/api/roles/public').then((r) => r.json());
    const last = store.get('lcd_role');
    app.innerHTML = `<div class="login card" style="max-width:640px"><h1 style="margin:0">What are you serving as today?</h1>
      <p class="muted" style="margin:0">Pick your role, then enter the role PIN.</p>
      <div class="rolegrid">${roles
        .map(
          (r) => `<button class="rolebtn ${r.id === last ? 'last' : ''}" data-r="${esc(r.id)}" ${r.hasPin ? '' : 'disabled'}>
            <span class="rn">${esc(r.name)}</span><span class="rp">${r.hasPin ? (r.person ? 'Today: ' + esc(r.person) : '&nbsp;') : 'No PIN set yet'}</span></button>`
        )
        .join('')}</div>
      <button class="small ghost" id="adm" style="align-self:flex-start">Admin sign-in</button></div>`;
    $('#adm').onclick = () => showLogin('admin');
    $$('.rolebtn').forEach(
      (b) =>
        (b.onclick = () => {
          const r = roles.find((x) => x.id === b.dataset.r);
          app.innerHTML = `<div class="login card"><div class="row sp"><div><div class="dim">Signing in as</div><h1 style="margin:0">${esc(r.name)}</h1>${r.person ? `<div class="muted">${esc(r.person)}</div>` : ''}</div><button class="small ghost" id="back">Back</button></div>
            ${pinPadHtml()}<p class="dim">You stay signed in until midnight.</p></div>`;
          $('#back').onclick = () => showLogin();
          pinPad(async (pin) => {
            await api('/api/login-role', { body: { roleId: r.id, pin } });
            store.set('lcd_role', r.id);
            boot();
          });
        })
    );
  }

  function pinPadHtml() {
    return `<div class="pin-dots" id="pd"></div>
      <div class="pinpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '→'].map((k) => `<button data-k="${k}" class="${k === '→' ? 'primary' : ''}">${k}</button>`).join('')}</div>`;
  }
  function pinPad(submit) {
    let pin = '';
    const dots = () => ($('#pd').innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<span class="${i < pin.length ? 'on' : ''}"></span>`).join(''));
    dots();
    const go = async () => {
      try {
        await submit(pin);
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
      else return;
      dots();
    };
  }

  // ---------------- shell ----------------
  function tabsFor() {
    const perms = (S.me && S.me.perms) || [];
    const t = [{ id: 'messages', name: 'Messages' }];
    if (perms.includes('live')) t.push({ id: 'live', name: 'Live' });
    if (perms.includes('handhelds')) t.push({ id: 'handhelds', name: 'Handhelds' });
    if (S.me && S.me.role !== 'admin' && perms.includes('wireless')) t.push({ id: 'wireless', name: 'Mics' });
    if (S.me && S.me.role === 'admin')
      t.push(
        { id: 'displays', name: 'Displays' },
        { id: 'people', name: 'People' },
        { id: 'songs', name: 'Songs' },
        { id: 'schedule', name: 'Schedule' },
        { id: 'wireless', name: 'Wireless' }
      );
    if (perms.includes('roles')) t.push({ id: 'accounts', name: 'Roles & PINs' });
    if (S.me && S.me.role === 'admin') t.push({ id: 'settings', name: 'Settings' });
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
      <p class="dim">Tap an item if the screens are on the wrong part of the plan. A position set here holds until ProPresenter moves to a different presentation.</p></div>
      <div class="card" id="pl" hidden style="margin-top:12px"></div>
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
      // ProPresenter presentation -> plan item link (the playlist is built by hand).
      const pl = $('#pl');
      const pres = d.propresenter.presentation;
      if (d.propresenter.auditorium && pres) {
        const linked = d.links[pres] || '';
        const sig = pres + '|' + linked + '|' + d.unmatched + '|' + d.items.length;
        if (pl.dataset.sig !== sig) {
          pl.dataset.sig = sig;
          pl.hidden = false;
          pl.innerHTML = `<div class="row sp"><strong>ProPresenter is on “${esc(pres)}”</strong>${d.unmatched ? '<span class="status"><span class="dot warn"></span>Not matched</span>' : '<span class="status"><span class="dot ok"></span>Matched</span>'}</div>
            <label>This presentation is…<select id="plsel"><option value="">${d.unmatched ? 'Pick the plan item' : 'Match by name (automatic)'}</option>${d.items
              .map((it) => `<option value="${esc(it.title)}" ${it.title === linked ? 'selected' : ''}>${esc(it.title)}</option>`)
              .join('')}</select></label>
            <div class="dim">Saved for future Sundays, so you only link a presentation once.</div>`;
          $('#plsel').onchange = (e) => api('/api/live-link', { body: { presentation: pres, item: e.target.value } }).then(() => { toast('Linked'); pl.dataset.sig = ''; load(); }).catch(fail);
        }
      } else pl.hidden = true;
    }
    load();
    S.timers.push(setInterval(load, 2500));
  }

  // ---------------- Displays + layout editor ----------------
  const WIDGETS = {
    title: { name: 'Title', opts: [['kicker', 'text'], ['title', 'text'], ['sub', ['', 'live', 'date', 'encounters']], ['compact', 'bool']] },
    clock: { name: 'Time of day', opts: [['label', 'text'], ['seconds', 'bool'], ['compact', 'bool']] },
    preshow: { name: 'Preshow countdown', opts: [['label', 'text'], ['fallback', ['', 'projected', 'clock', 'itemRemaining']], ['showBeforeMin', 'number']] },
    countdown: { name: 'Countdown', opts: [['target', ['nextStart', 'nextStreamStart', 'nextBandToStage', 'streamEnd', 'encounterStart', 'bandToStage', 'streamStart', 'positions', 'firstStream', 'nextEncounter']], ['label', 'text'], ['accent', 'bool'], ['compact', 'bool'], ['huge', 'bool']] },
    encountersToday: { name: 'Today’s Encounters strip', opts: [['compact', 'bool']] },
    firstUp: { name: 'First up (next Encounter)', opts: [] },
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
    slidePreview: { name: 'ProPresenter slide preview (pictures)', opts: [['source', ['broadcast', 'auditorium']], ['label', 'text'], ['showNext', 'bool']] },
    propTimers: { name: 'ProPresenter timers + stage message', opts: [['source', ['auditorium', 'broadcast']], ['names', 'text'], ['label', 'text']] },
    messageBar: { name: 'Message bar', opts: [['idleText', 'text'], ['legend', 'bool'], ['big', 'bool']] },
    text: { name: 'Text', opts: [['label', 'text'], ['text', 'text'], ['size', 'number']] },
    image: { name: 'Image', opts: [['src', 'text'], ['fit', ['cover', 'contain']]] },
  };

  async function viewDisplays() {
    const [profiles, devices] = await Promise.all([api('/api/profiles'), api('/api/devices').catch(() => [])]);
    const modeSel = (id, p) => `<label>Shows<select data-mode="${id}">
        <option value="auto" ${p.modeSetting === 'auto' ? 'selected' : ''}>Automatic (Pre → Live)</option>
        <option value="pre" ${p.modeSetting === 'pre' ? 'selected' : ''}>Pre-Encounter only</option>
        <option value="live" ${p.modeSetting === 'live' ? 'selected' : ''}>Live only</option></select></label>`;
    const ago = (t) => {
      const m = Math.round((Date.now() - t) / 60000);
      return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago';
    };
    app.innerHTML = `<div class="row sp"><h1>Displays</h1><button id="np">New dashboard</button></div>
      <p class="muted">Every room has a <b>Pre-Encounter</b> screen and a <b>Live</b> screen. On Automatic, a room goes Live a few minutes before each Encounter and back to Pre-Encounter after its stream ends (timing is on the Schedule tab).</p>
      <div class="card"><div class="row sp"><strong>All rooms at once</strong></div>
        <div class="row"><button class="small" data-all="auto">Automatic</button><button class="small" data-all="pre">All Pre-Encounter</button><button class="small" data-all="live">All Live</button></div></div>
      <h2>Screens</h2>
      <p class="muted">Every TV or output that opens <b>${location.origin}/display</b> asks which room it’s in and shows up here. Move a screen to a different room from here and it switches within a second.</p>
      <div class="list">${
        devices.length
          ? devices
              .map(
                (d) => `<div class="card"><div class="row sp"><input class="dn" data-dn="${esc(d.id)}" value="${esc(d.name)}" aria-label="Screen name" style="max-width:240px">
              <span class="status"><span class="dot ${d.online ? 'ok' : ''}"></span>${d.online ? 'Online' : 'Offline · seen ' + ago(d.lastSeen)}</span></div>
              <div class="grid2"><label>Dashboard<select data-dev="${esc(d.id)}">${Object.entries(profiles)
                .map(([id, p]) => `<option value="${id}" ${id === d.profile ? 'selected' : ''}>${esc((p.location || 'Other') + ' — ' + p.name)}</option>`)
                .join('')}</select></label><div class="dim" style="align-self:end">${esc(d.address || '')}</div></div>
              <div class="row"><button class="small ghost" data-forget="${esc(d.id)}">Forget this screen</button></div></div>`
              )
              .join('')
          : '<div class="card dim">No screens have connected yet.</div>'
      }</div>
      <h2>Dashboards</h2>
      <div class="cards">${Object.entries(profiles)
        .map(
          ([id, p]) => `<div class="card"><div class="row sp"><div><div class="dim">${esc(p.location || 'Other')}</div><strong style="font-size:18px">${esc(p.name)}</strong></div><a href="/display/${id}?preview=1" target="_blank">Open ↗</a></div>
        <label>Location<input data-loc="${id}" value="${esc(p.location || '')}" list="locl"></label>
        ${modeSel(id, p)}
        <div class="row"><button class="small" data-edit="${id}" data-l="pre">Edit Pre-Encounter</button><button class="small" data-edit="${id}" data-l="live">Edit Live</button></div></div>`
        )
        .join('')}</div>
      <datalist id="locl">${[...new Set(Object.values(profiles).map((p) => p.location).filter(Boolean))].map((l) => `<option value="${esc(l)}">`).join('')}</datalist>`;
    $$('[data-loc]').forEach(
      (i) =>
        (i.onchange = async () => {
          await api('/api/profiles/' + i.dataset.loc, { method: 'PUT', body: { location: i.value } }).catch(fail);
          toast('Location saved');
        })
    );
    $$('[data-mode]').forEach(
      (s) =>
        (s.onchange = async () => {
          await api('/api/profiles/' + s.dataset.mode, { method: 'PUT', body: { modeSetting: s.value } }).catch(fail);
          toast('Saved');
        })
    );
    $$('[data-all]').forEach(
      (b) =>
        (b.onclick = async () => {
          await api('/api/profiles-mode', { body: { modeSetting: b.dataset.all } }).catch(fail);
          toast('All rooms updated');
          viewDisplays();
        })
    );
    $$('[data-dev]').forEach(
      (s) =>
        (s.onchange = async () => {
          await api('/api/devices/' + s.dataset.dev, { method: 'PUT', body: { profile: s.value } }).catch(fail);
          toast('Screen moved');
        })
    );
    $$('[data-dn]').forEach(
      (i) =>
        (i.onchange = async () => {
          await api('/api/devices/' + i.dataset.dn, { method: 'PUT', body: { name: i.value } }).catch(fail);
          toast('Renamed');
        })
    );
    $$('[data-forget]').forEach(
      (b) =>
        (b.onclick = async () => {
          if (!confirm('Forget this screen? If it is still on, it will ask for its room again next time it starts.')) return;
          await api('/api/devices/' + b.dataset.forget, { method: 'DELETE' }).catch(fail);
          viewDisplays();
        })
    );
    $$('[data-edit]').forEach((b) => (b.onclick = () => editLayout(b.dataset.edit, b.dataset.l, profiles)));
    $('#np').onclick = async () => {
      const name = prompt('Name for the new dashboard (for example “FOH · Lighting”)');
      if (!name) return;
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'display';
      const copy = prompt('Start from which room? (' + Object.keys(profiles).join(', ') + ') — leave empty for blank', 'greenroom');
      const base = profiles[copy] ? structuredClone(profiles[copy]) : { modeSetting: 'auto', style: {}, layouts: { pre: { widgets: [] }, live: { widgets: [] } } };
      const loc = prompt('Which location is it in? (' + [...new Set(Object.values(profiles).map((p) => p.location))].join(', ') + ')', base.location || '');
      await api('/api/profiles/' + id, { method: 'PUT', body: { ...base, name, location: loc || base.location || 'Other' } }).catch(fail);
      viewDisplays();
    };
  }

  function editLayout(id, which, profiles) {
    const prof = structuredClone(profiles[id]);
    const layout = prof.layouts[which];
    let sel = null;
    app.innerHTML = `<div class="row sp"><div><h1 style="margin-bottom:0">${esc(prof.name)}</h1><div class="dim">${which === 'pre' ? 'Pre-Encounter screen' : 'Live screen'} · drag to move, drag the corner to resize</div></div>
      <div class="row"><button class="ghost" id="eb">Back</button><button class="primary" id="es">Save</button></div></div>
      <div class="row" style="margin:12px 0">
        <label class="grow">Display name<input id="en" value="${esc(prof.name)}"></label>
        <label class="inline"><input type="checkbox" id="ec" ${prof.style.collage ? 'checked' : ''}> Edge-to-edge collage</label>
        <label class="inline"><input type="checkbox" id="ek" ${prof.style.black ? 'checked' : ''}> Pure black</label>
      </div>
      <div class="editor"><div><div class="canvas" id="cv"><div class="gridline" id="gl"></div></div>
        <h3>Preview</h3><iframe class="preview" id="pv" src="/display/${id}?preview=1"></iframe></div>
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
  // A grid of faces. Tap anyone to open the photo editor: upload a new photo,
  // drag to move it, pinch / scroll / slider to zoom, and see how it lands on
  // a big card, a wide collage tile and the small FOH circle.
  async function viewPeople() {
    S.peopleScope = S.peopleScope || 'plan';
    let data;
    try {
      data = await api('/api/people' + (S.peopleScope === 'all' ? '?all=1' : ''));
    } catch (e) {
      return fail(e);
    }
    const { people, helpText } = data;
    app.innerHTML = `<h1>People &amp; photos</h1>
      <p class="muted">Tap a face to upload a new photo or adjust how it’s framed. Anyone without a usable photo shows their initials.</p>
      <div class="row" style="margin-bottom:12px">
        <div class="seg" style="min-width:280px"><button class="small ${S.peopleScope === 'plan' ? 'on info' : ''}" data-sc="plan">On today’s plan</button><button class="small ${S.peopleScope === 'all' ? 'on info' : ''}" data-sc="all">Everyone</button></div>
        <input id="pf" class="grow" placeholder="Search names…" style="min-width:180px">
      </div>
      <div class="row" style="margin-bottom:12px"><span class="dim" id="pcount"></span>
        <label class="inline"><input type="checkbox" id="pnone"> Only people showing initials</label></div>
      <div class="pgrid" id="pl"></div>
      <div class="card" style="margin-top:16px"><h3 style="margin:0">Add someone</h3>
        <p class="dim" style="margin:0">For anyone not on the list yet. Use their full name exactly as it appears in Planning Center so the photo matches.</p>
        <div class="row nowrap"><input id="pan" placeholder="First Last"><button class="primary" id="pab">Add</button></div></div>
      <h2>What to go to each leader for</h2><p class="dim">Shown on the Greenroom go-to cards.</p>
      <div class="card" id="ht">${Object.entries(helpText)
        .map(([k, v]) => `<label>${esc(k)}<input data-h="${esc(k)}" value="${esc(v)}"></label>`)
        .join('')}<button class="primary" id="hs">Save</button></div>`;

    const src = (p) => (p.override.hidePhoto ? '' : p.override.photo || p.seedPhoto || p.slackPhoto || '');
    const initials = (name) => {
      const w = name.split(/\s+/).filter((x) => /[A-Za-z]/.test(x[0] || ''));
      return ((w[0] || '')[0] || '') + (w.length > 1 ? w[w.length - 1][0] : '');
    };
    const fromLabel = (p) => {
      const o = p.override;
      return o.hidePhoto ? 'Initials (photo hidden)' : o.photo ? 'Uploaded photo' : p.seedPhoto ? 'Starter photo' : p.slackPhoto ? 'Slack photo' : 'Initials — no photo';
    };
    const imgStyle = (o) => {
      const fx = o.focusX ?? 50, fy = o.focusY ?? 15, z = o.zoom ?? 1;
      return `object-position:${fx}% ${fy}%;transform:scale(${z});transform-origin:${fx}% ${fy}%`;
    };
    const face = (p) => {
      const s = src(p);
      return s ? `<img src="${esc(s)}" alt="" style="${imgStyle(p.override)}">` : `<span>${esc(initials(p.name))}</span>`;
    };

    function draw() {
      const f = $('#pf').value.toLowerCase();
      const onlyNone = $('#pnone').checked;
      const list = people.filter((p) => p.name.toLowerCase().includes(f) && (!onlyNone || !src(p)));
      $('#pcount').textContent = `${list.length} ${list.length === 1 ? 'person' : 'people'} · ${people.filter((p) => !src(p)).length} showing initials`;
      $('#pl').innerHTML = list
        .map(
          (p) => `<button class="pcard" data-n="${esc(p.name)}"><span class="pframe">${face(p)}</span>
            <span class="pn">${esc(p.name)}</span><span class="ps">${esc(p.positions.join(', ') || fromLabel(p))}</span></button>`
        )
        .join('');
      $$('#pl .pcard').forEach((b) => (b.onclick = () => editor(people.find((x) => x.name === b.dataset.n))));
    }

    function editor(p) {
      const o = p.override;
      const dlg = document.createElement('div');
      dlg.className = 'modal';
      dlg.innerHTML = `<div class="mbox" role="dialog" aria-label="Photo for ${esc(p.name)}">
        <div class="row sp"><div><h2 style="margin:0">${esc(p.name)}</h2><div class="dim" data-from></div></div><button class="small ghost" data-x>Done</button></div>
        <div class="ed">
          <div class="edmain"><div class="pframe big" data-stage></div>
            <div class="dim" style="text-align:center">Drag to move · scroll or pinch to zoom</div></div>
          <div class="edside">
            <label>Zoom<input type="range" min="1" max="3" step="0.02" data-z></label>
            <div class="dim">How it looks on the screens</div>
            <div class="prevs"><div class="pframe wide" data-pv></div><div class="pframe circle" data-pv></div></div>
            <div class="row">
              <label class="btn small primary" style="display:inline-flex;align-items:center;min-height:34px;padding:6px 12px;color:#fff;font-size:14px;flex-direction:row">Upload new photo<input type="file" accept="image/*" data-up hidden></label>
              <button class="small" data-reset>Reset framing</button>
            </div>
            <div class="row"><button class="small ghost" data-rm hidden>Remove upload</button>
              <label class="inline"><input type="checkbox" data-hide> Use initials instead</label></div>
            <label>Slack name (if different)<input data-slack placeholder="${esc(p.name)}"></label>
          </div>
        </div></div>`;
      document.body.appendChild(dlg);
      document.body.style.overflow = 'hidden';
      const stage = $('[data-stage]', dlg);
      const zoomEl = $('[data-z]', dlg);
      const st = { fx: o.focusX ?? 50, fy: o.focusY ?? 15, z: o.zoom ?? 1 };
      $('[data-hide]', dlg).checked = !!o.hidePhoto;
      $('[data-slack]', dlg).value = p.slackName || '';

      let saveT;
      const save = (extra = {}) => {
        clearTimeout(saveT);
        saveT = setTimeout(async () => {
          const body = { focusX: Math.round(st.fx * 10) / 10, focusY: Math.round(st.fy * 10) / 10, zoom: st.z, hidePhoto: $('[data-hide]', dlg).checked, slackName: $('[data-slack]', dlg).value.trim(), ...extra };
          try {
            await api('/api/people/' + encodeURIComponent(p.name), { method: 'PUT', body });
            Object.assign(o, { focusX: body.focusX, focusY: body.focusY, zoom: body.zoom, hidePhoto: body.hidePhoto });
            p.slackName = body.slackName;
          } catch (e) {
            fail(e);
          }
        }, 250);
      };
      function paint() {
        const s = src(p);
        $('[data-from]', dlg).textContent = fromLabel(p) + (p.positions.length ? ' · ' + p.positions.join(', ') : '');
        $('[data-rm]', dlg).hidden = !o.photo;
        zoomEl.value = st.z;
        const style = imgStyle({ focusX: st.fx, focusY: st.fy, zoom: st.z });
        const inner = s ? `<img src="${esc(s)}" alt="" draggable="false" style="${style}">` : `<span>${esc(initials(p.name))}</span>`;
        stage.innerHTML = inner + (s ? '<i class="thirds"></i>' : '');
        $$('[data-pv]', dlg).forEach((el) => (el.innerHTML = inner));
      }
      function restyle() {
        const style = imgStyle({ focusX: st.fx, focusY: st.fy, zoom: st.z });
        $$('img', dlg).forEach((i) => i.setAttribute('style', style));
        zoomEl.value = st.z;
      }
      paint();

      // Drag to move. How far the focus point moves per pixel depends on how
      // much of the photo is hidden (cover overflow + zoom).
      const pointers = new Map();
      let last = null, pinch0 = null;
      const slack = () => {
        const img = $('img', stage);
        const r = stage.getBoundingClientRect();
        if (!img || !img.naturalWidth) return { x: 1, y: 1, w: r.width, h: r.height };
        const cover = Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight);
        const ox = (img.naturalWidth * cover - r.width) / r.width, oy = (img.naturalHeight * cover - r.height) / r.height;
        return { x: Math.max(ox + (st.z - 1), 0.25), y: Math.max(oy + (st.z - 1), 0.25), w: r.width, h: r.height };
      };
      const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
      stage.onpointerdown = (e) => {
        stage.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        last = { x: e.clientX, y: e.clientY };
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), z: st.z };
        }
      };
      stage.onpointermove = (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2 && pinch0) {
          const [a, b] = [...pointers.values()];
          st.z = clamp(pinch0.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch0.d), 1, 3);
        } else if (pointers.size === 1 && last) {
          const k = slack();
          st.fx = clamp(st.fx - ((e.clientX - last.x) / (k.w * k.x)) * 100, 0, 100);
          st.fy = clamp(st.fy - ((e.clientY - last.y) / (k.h * k.y)) * 100, 0, 100);
          last = { x: e.clientX, y: e.clientY };
        }
        restyle();
      };
      stage.onpointerup = stage.onpointercancel = (e) => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinch0 = null;
        const rest = [...pointers.values()][0];
        last = rest ? { ...rest } : null;
        save();
      };
      stage.onwheel = (e) => {
        e.preventDefault();
        st.z = clamp(st.z * (e.deltaY < 0 ? 1.06 : 1 / 1.06), 1, 3);
        restyle();
        save();
      };
      zoomEl.oninput = () => {
        st.z = Number(zoomEl.value);
        restyle();
        save();
      };
      $('[data-reset]', dlg).onclick = () => {
        Object.assign(st, { fx: 50, fy: 15, z: 1 });
        restyle();
        save();
      };
      $('[data-hide]', dlg).onchange = () => {
        o.hidePhoto = $('[data-hide]', dlg).checked;
        paint();
        save();
      };
      $('[data-slack]', dlg).oninput = () => save();
      $('[data-up]', dlg).onchange = async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const dataUrl = await shrink(f, 1600);
          const r = await api('/api/people/' + encodeURIComponent(p.name) + '/photo', { body: { dataUrl } });
          Object.assign(o, { photo: r.photo, hidePhoto: false, focusX: 50, focusY: 15, zoom: 1 });
          Object.assign(st, { fx: 50, fy: 15, z: 1 });
          $('[data-hide]', dlg).checked = false;
          paint();
          toast('Photo uploaded — drag and zoom to frame it');
        } catch (err) {
          fail(err);
        }
      };
      $('[data-rm]', dlg).onclick = async () => {
        try {
          await api('/api/people/' + encodeURIComponent(p.name) + '/photo', { method: 'DELETE' });
          delete o.photo;
          paint();
          toast('Upload removed');
        } catch (err) {
          fail(err);
        }
      };
      const close = () => {
        clearTimeout(saveT);
        save();
        document.removeEventListener('keydown', onKey);
        dlg.remove();
        document.body.style.overflow = '';
        draw();
      };
      const onKey = (e) => e.key === 'Escape' && close();
      document.addEventListener('keydown', onKey);
      $('[data-x]', dlg).onclick = close;
      dlg.onclick = (e) => e.target === dlg && close();
    }

    $('#pf').oninput = draw;
    $('#pnone').onchange = draw;
    $$('[data-sc]').forEach(
      (b) =>
        (b.onclick = () => {
          S.peopleScope = b.dataset.sc;
          viewPeople();
        })
    );
    $('#pab').onclick = async () => {
      const name = $('#pan').value.trim();
      if (!name) return;
      try {
        await api('/api/people', { body: { name } });
        S.peopleScope = 'all';
        await viewPeople();
        toast('Added ' + name);
        $('#pf').value = name;
        $('#pf').dispatchEvent(new Event('input'));
      } catch (e) {
        fail(e);
      }
    };
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
        <label>Camera cue (shows on the Broadcast huddle)<input id="e_cue" value="${esc(v.cue)}"></label>
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
        <td><input type="time" step="1" data-k="${key}" data-i="${i}" data-f="preshowEnd" value="${esc(e.preshowEnd || '')}"></td>
        <td><button class="small danger" data-del="${key}" data-i="${i}">✕</button></td></tr>`
        )
        .join('');
    const table = (list, key) => `<div style="overflow-x:auto"><table><tr><th>Encounter</th><th>Starts</th><th>Stream starts</th><th>Stream ends</th><th>Preshow ends</th><th></th></tr>${encRows(list, key)}</table></div>
      <button class="small" data-add="${key}">Add Encounter</button>`;
    function draw() {
      app.innerHTML = `<h1>Schedule</h1>
        <p class="muted">The normal Sunday. When the Planning Center plan has service times, those start times are used and the stream windows here are matched to them. The stream countdowns use these times. Leave both stream times blank for an Encounter that isn’t streamed.</p>
        <div class="card"><h2 style="margin:0">Every Sunday</h2>${table(s.encounters, 'default')}
          <div class="grid2"><label>Positions (huddle countdown)<input type="time" id="s_pos" value="${esc(s.positions || '')}"></label>
          <label>Rooms go Live (minutes before each Encounter)<input type="number" min="0" max="60" id="s_lead" value="${esc(s.liveLeadMinutes ?? 5)}"></label>
          <label>Back to Pre-Encounter (minutes after stream ends)<input type="number" min="0" max="60" id="s_tail" value="${esc(s.liveTailMinutes ?? 5)}"></label>
          <label>Band to stage (minutes before start)<input type="number" id="s_bs" value="${esc(s.bandToStageMinutes)}"></label>
          <label>Preshow length (m:ss)<input id="s_pl" value="${Math.floor((s.preshowSeconds ?? 270) / 60)}:${String((s.preshowSeconds ?? 270) % 60).padStart(2, '0')}"></label></div>
          <p class="dim" style="margin:0">Preshow counts down to each Encounter’s <em>Preshow ends</em> time (leave blank for no preshow). If it runs over, the screens count negative and flash red until ProPresenter leaves the PRESHOW presentation.</p></div>
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
        s.liveLeadMinutes = Math.max(0, Math.min(60, Number($('#s_lead').value) || 0));
        s.liveTailMinutes = Math.max(0, Math.min(60, Number($('#s_tail').value) || 0));
        s.bandToStageMinutes = Number($('#s_bs').value) || 4;
        const pl = /^(\d{1,2}):(\d{2})$/.exec($('#s_pl').value.trim());
        if (pl) s.preshowSeconds = Number(pl[1]) * 60 + Number(pl[2]);
        await api('/api/schedule', { method: 'PUT', body: s }).then(() => toast('Schedule saved')).catch(fail);
      };
    }
    draw();
  }

  // ---------------- Wireless ----------------
  async function viewWireless() {
    // FOH (role sign-in) gets This Sunday plus live receiver status; admins also
    // manage receivers and the standard assignments.
    const admin = S.me.role === 'admin';
    const [w, live, week] = await Promise.all([admin ? api('/api/wireless') : {}, api('/api/wireless-live'), api('/api/wireless-week')]);
    const MICS = ['VOX 1', 'VOX 2', 'VOX 3', 'VOX 4', 'VOX 5', 'HH-1', 'HH-2', 'TEACH', 'BP-1', 'BP-2'];
    const picks = Object.fromEntries(week.rows.map((r) => [r.name, { mic: r.pickMic, iem: r.pickIem }]));
    const rows = Object.entries(w).map(([k, v]) => ({ k, mic: v.mic || '', iem: v.iem || '' }));
    const recv = live.receivers.length ? live.receivers.map((r) => ({ ...r })) : [{ label: '', host: '', enabled: true }];
    app.innerHTML = `<h1>${admin ? 'Wireless' : 'Mics'}</h1>
      <div class="card"><h2 style="margin:0">This Sunday${week.date ? ` · ${esc(week.date)}` : ''}</h2>
        <p class="dim" style="margin:0">Who has which mic on this plan. If the plan’s notes in Planning Center list mic assignments, they’re filled in automatically (<em>Plan notes</em>); otherwise each person starts on their usual (<em>Standard</em>) mic. Change anyone here. Picks reset when the next plan loads.</p>
        <div id="wk" class="wklist"></div>
        <div class="row"><button class="primary" id="wks">Save this Sunday</button><span class="dim" id="wkw"></span></div></div>
      <div class="card" style="margin-top:14px"><h2 style="margin:0">${admin ? 'Mic receivers' : 'Live from the receivers'}</h2>
        ${admin ? `<p class="dim" style="margin:0">Shure Axient Digital (AD4D, AD4Q). Enter each receiver’s IP address (on the receiver: Menu → Network). Battery, runtime and RF come straight from the receivers. IEM packs are one-way radio, so they show their assignment only.</p>
        <div id="rcv"></div>
        <div class="row"><button class="small" id="ra">Add receiver</button><button class="primary" id="rs">Save receivers</button></div>` : ''}
        <div id="rst"></div></div>
      ${admin ? `<h2>Standard assignments</h2>
      <p class="muted">The usual mic and IEM for each Planning Center position — the starting point for every Sunday. Type the mic exactly as the receiver channel is named (like <code>VOX 4</code> or <code>HH-1</code>); spaces, dashes and capitals don’t matter. For positions with more than one person, number them: <code>Frontline#1</code>, <code>Frontline#2</code>… in worship-team order. Use <code>WIRED</code> for wired mics.</p>
      <div class="card"><div style="overflow-x:auto"><table id="wt"></table></div><div class="row"><button class="small" id="wa">Add row</button><button class="primary" id="ws">Save assignments</button></div></div>` : ''}
      <datalist id="chl"></datalist>`;

    function drawRecv() {
      $('#rcv').innerHTML = recv
        .map(
          (r, i) => `<div class="row nowrap" style="margin-bottom:8px"><input data-r="${i}" data-f="label" value="${esc(r.label)}" placeholder="AD4Q #1" style="max-width:160px">
            <input data-r="${i}" data-f="host" value="${esc(r.host)}" placeholder="192.168.10.60" inputmode="decimal">
            <label class="inline" style="flex:none"><input type="checkbox" data-r="${i}" data-f="enabled" ${r.enabled !== false ? 'checked' : ''}> On</label>
            <button class="small danger" data-rd="${i}">✕</button></div>`
        )
        .join('');
      $$('#rcv [data-f]').forEach((el) => (el.oninput = () => (recv[el.dataset.r][el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value.trim())));
      $$('#rcv [data-rd]').forEach((b) => (b.onclick = () => (recv.splice(b.dataset.rd, 1), drawRecv())));
    }
    function drawLive(l) {
      const st = (ok, txt) => `<span class="status"><span class="dot ${ok ? 'ok' : 'bad'}"></span>${esc(txt)}</span>`;
      const recvHtml = l.status
        .map((r) => `<div>${st(r.connected, (r.connected ? 'Connected' : r.error || 'Connecting…') + ' · ' + r.host)}${r.channels.length ? ` <span class="dim">— ${esc(r.channels.join(', '))}</span>` : ''}</div>`)
        .join('');
      const chans = l.channels.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const table = chans.length
        ? `<div style="overflow-x:auto"><table><tr><th>Channel</th><th>Transmitter</th><th>Battery</th><th>RF</th><th>Freq</th></tr>${chans
            .map(
              (c) => `<tr><td><strong>${esc(c.name)}</strong></td><td>${c.tx ? esc(c.txModel) : '<span class="dim">Off</span>'}${c.muted ? ' · muted' : ''}</td>
              <td>${c.battery == null ? '—' : c.battery + '%'}${c.minutes != null ? ` · ${Math.floor(c.minutes / 60)}h ${c.minutes % 60}m` : ''}</td>
              <td>${!c.online ? '—' : c.rf ? st(true, 'Good' + (c.quality != null ? ` (${c.quality}/5)` : '')) : c.tx ? st(false, 'Drop') : '—'}</td><td class="dim">${esc(c.freq)}</td></tr>`
            )
            .join('')}</table></div>`
        : '';
      $('#rst').innerHTML = recvHtml + table;
      $('#chl').innerHTML = chans.map((c) => `<option value="${esc(c.name)}">`).join('') + '<option value="WIRED">';
    }
    function drawWeek() {
      const names = new Set([...MICS, ...live.channels.map((c) => c.name)].filter((m) => m !== 'WIRED'));
      const eff = (r) => picks[r.name].mic || r.defMic;
      const counts = {};
      week.rows.forEach((r) => { const m = eff(r); if (m && m !== 'WIRED' && m !== 'N/A') counts[m.toUpperCase().replace(/[^A-Z0-9]/g, '')] = (counts[m.toUpperCase().replace(/[^A-Z0-9]/g, '')] || 0) + 1; });
      const dup = (m) => m && m !== 'WIRED' && m !== 'N/A' && counts[m.toUpperCase().replace(/[^A-Z0-9]/g, '')] > 1;
      $('#wk').innerHTML = week.rows.length
        ? week.rows
            .map(
              (r, i) => `<div class="wkrow"><div class="wkn"><strong>${esc(r.name)}</strong><span class="dim">${esc(r.role || r.position || '')}</span></div>
              <label class="wkf">Mic<select data-w="${i}" data-f="mic" style="${dup(eff(r)) ? 'outline:2px solid var(--yellow)' : ''}"><option value="">${r.fromNotes && r.fromNotes.mic ? 'Plan notes' : 'Standard'}${r.defMic ? ' (' + esc(r.defMic) + ')' : ''}</option>${[...names]
                .map((m) => `<option ${picks[r.name].mic === m ? 'selected' : ''}>${esc(m)}</option>`)
                .join('')}<option value="WIRED" ${picks[r.name].mic === 'WIRED' ? 'selected' : ''}>MD / Wired</option><option value="N/A" ${picks[r.name].mic === 'N/A' ? 'selected' : ''}>N/A — no mic</option></select></label>
              <label class="wkf">IEM<input data-w="${i}" data-f="iem" value="${esc(picks[r.name].iem)}" placeholder="${esc(r.defIem || '—')}"></label></div>`
            )
            .join('')
        : '<div class="dim">Nobody on this plan uses wireless yet.</div>';
      const d = Object.keys(counts).filter((k) => counts[k] > 1);
      $('#wkw').textContent = d.length ? 'Heads up: the same mic is picked twice (highlighted).' : '';
      $$('#wk [data-w]').forEach((el) => (el.oninput = el.onchange = () => {
        picks[week.rows[el.dataset.w].name][el.dataset.f] = el.value.trim();
        if (el.tagName === 'SELECT') drawWeek();
      }));
    }
    $('#wks').onclick = async () => {
      try {
        await api('/api/wireless-week', { method: 'PUT', body: { byName: picks } });
        toast('Saved — the screens update now');
      } catch (e) {
        fail(e);
      }
    };
    function drawRows() {
      $('#wt').innerHTML = `<tr><th>Position</th><th>Mic</th><th>IEM</th><th></th></tr>${rows
        .map(
          (r, i) => `<tr><td><input data-i="${i}" data-f="k" value="${esc(r.k)}"></td><td><input data-i="${i}" data-f="mic" value="${esc(r.mic)}" list="chl"></td><td><input data-i="${i}" data-f="iem" value="${esc(r.iem)}"></td><td><button class="small danger" data-d="${i}">✕</button></td></tr>`
        )
        .join('')}`;
      $$('#wt [data-f]').forEach((i) => (i.oninput = () => (rows[i.dataset.i][i.dataset.f] = i.value)));
      $$('#wt [data-d]').forEach((b) => (b.onclick = () => (rows.splice(b.dataset.d, 1), drawRows())));
    }
    if (admin) {
      $('#ra').onclick = () => (recv.push({ label: '', host: '', enabled: true }), drawRecv());
      $('#rs').onclick = async () => {
        try {
          await api('/api/wireless-receivers', { method: 'PUT', body: { receivers: recv.filter((r) => r.host) } });
          toast('Saved — connecting to receivers');
        } catch (e) {
          fail(e);
        }
      };
      $('#wa').onclick = () => (rows.push({ k: '', mic: '', iem: '' }), drawRows());
      $('#ws').onclick = async () => {
        const body = {};
        rows.filter((r) => r.k).forEach((r) => (body[r.k] = { mic: r.mic, ...(r.iem ? { iem: r.iem } : {}) }));
        await api('/api/wireless', { method: 'PUT', body }).then(() => toast('Saved')).catch(fail);
      };
    }
    drawWeek();
    if (admin) {
      drawRecv();
      drawRows();
    }
    drawLive(live);
    S.timers.push(setInterval(() => api('/api/wireless-live').then(drawLive).catch(() => {}), 3000));
  }

  // ---------------- Handhelds ----------------
  // Floor Manager / FOH: who has HH-1 and HH-2. Pick from the list (today's
  // communicators + usual hosts, A–Z by first name) or search everyone; a
  // search with no match is used as typed. Save pushes a flashing alert to
  // every screen except the Dock.
  async function viewHandhelds() {
    let data = await api('/api/handhelds');
    const pending = {}; // ch → name chosen but not saved yet
    const fmtMin = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
    function status(l) {
      if (!l) return '';
      if (!l.online) return '<span class="dim">Receiver offline</span>';
      if (!l.tx) return '<span class="dim">Mic off</span>';
      return `<span class="status"><span class="dot ${l.rf === false ? 'bad' : 'ok'}"></span>${l.battery != null ? l.battery + '%' : ''}${l.minutes != null ? ' · ' + fmtMin(l.minutes) : ''}</span>`;
    }
    function draw() {
      app.innerHTML = `<h1>Handhelds</h1>
        <div class="hhgrid">${data.handhelds
          .map((h) => {
            const pick = pending[h.ch];
            return `<div class="card hh" data-ch="${h.ch}">
              <div class="row sp"><div class="hhch">${h.ch}</div>${status(h.live)}</div>
              <div class="hhwho">${h.name ? esc(h.name) : '<span class="dim">Nobody</span>'}</div>
              <select data-p aria-label="Choose who has ${h.ch}"><option value="">Choose a person…</option>${data.quick.map((n) => `<option ${pick === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
              <input data-q placeholder="…or search everyone" autocomplete="off" autocapitalize="words" value="${pick && !data.quick.includes(pick) ? esc(pick) : ''}">
              <div class="hhres" data-res></div>
              <button class="primary hhsave" data-save ${pick && pick !== h.name ? '' : 'disabled'}>${pick && pick !== h.name ? `Save: ${esc(h.ch)} → ${esc(pick)}` : 'Save'}</button>
              ${h.set ? '<button class="small ghost" data-clear style="align-self:flex-start">Clear</button>' : ''}
            </div>`;
          })
          .join('')}</div>`;
      $$('.hh').forEach((card) => {
        const ch = card.dataset.ch;
        const choose = (n) => {
          pending[ch] = n;
          draw();
        };
        $('[data-p]', card).onchange = (e) => e.target.value && choose(e.target.value);
        const q = $('[data-q]', card);
        const res = $('[data-res]', card);
        q.oninput = () => {
          const t = q.value.trim().toLowerCase();
          if (!t) return (res.innerHTML = '');
          const hits = data.everyone.filter((n) => n.toLowerCase().split(/\s+/).some((w) => w.startsWith(t)) || n.toLowerCase().startsWith(t)).slice(0, 6);
          res.innerHTML = hits.length
            ? hits.map((n) => `<button class="item" data-pick="${esc(n)}">${esc(n)}</button>`).join('')
            : `<button class="item" data-pick="${esc(q.value.trim())}">Use “${esc(q.value.trim())}”</button>`;
          $$('[data-pick]', res).forEach((b) => (b.onclick = () => choose(b.dataset.pick)));
        };
        q.onkeydown = (e) => {
          if (e.key !== 'Enter') return;
          const first = $('[data-pick]', res);
          if (first) choose(first.dataset.pick);
          else if (q.value.trim()) choose(q.value.trim());
        };
        const save = async (name) => {
          try {
            await api('/api/handhelds/' + ch, { method: 'PUT', body: { name } });
            toast(name ? `${ch} → ${name} · sent to the screens` : `${ch} cleared`);
            delete pending[ch];
            data = await api('/api/handhelds');
            draw();
          } catch (e) {
            fail(e);
          }
        };
        $('[data-save]', card).onclick = () => pending[ch] && save(pending[ch]);
        const c = $('[data-clear]', card);
        if (c) c.onclick = () => save('');
      });
    }
    draw();
    S.timers.push(
      setInterval(async () => {
        if (Object.keys(pending).length) return;
        if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.hh')) return;
        try {
          data = await api('/api/handhelds');
          draw();
        } catch (e) {}
      }, 5000)
    );
  }

  // ---------------- Accounts ----------------
  async function viewAccounts() {
    const [{ roles, perms }, accounts] = await Promise.all([api('/api/roles'), api('/api/accounts')]);
    const PERM_NAMES = { messages: 'Send messages', live: 'Live control', wireless: 'Mics (This Sunday)', handhelds: 'Handhelds (HH-1/HH-2)', admin: 'Everything (director / admin)', roles: 'Manage Roles & PINs and admins' };
    const list = roles.map((r) => ({ ...r, positionsText: r.positions.join(', '), pin: '' }));
    app.innerHTML = `<h1>Roles &amp; PINs</h1>
      <p class="muted">Leaders sign in by picking the role they’re serving in that day and entering the role’s PIN. Share each PIN only with the people who serve in that role. Sign-ins end at midnight. If Planning Center has exactly one person in that role, their name shows on messages they send.</p>
      <div class="list" id="rl"></div>
      <div class="row" style="margin-top:12px"><button class="small" id="radd">Add role</button><button class="primary" id="rsave">Save roles</button></div>
      <h2>Admins</h2>
      <p class="muted">Admins have their own name and PIN and can change everything. They sign in from <em>Admin sign-in</em> at the bottom of the sign-in screen. The overall administrator’s account can only be changed by them and can’t be removed.</p>
      <div class="list">${accounts
        .map(
          (a) => `<div class="msg"><div class="grow"><div class="t">${esc(a.name)}${a.owner ? ' <span class="dim">· overall administrator</span>' : a.role !== 'admin' ? ' <span class="dim">· older leader account</span>' : ''}</div><div class="m">Planning Center name: ${esc(a.pcoName)}</div></div>
        ${a.owner && a.id !== S.me.id ? '' : `<button class="small" data-pin="${a.id}">New PIN</button>`}${a.role !== 'admin' ? `<button class="small" data-role="${a.id}" data-r="admin">Make admin</button>` : ''}${a.owner ? '' : `<button class="small danger" data-del="${a.id}">Remove</button>`}</div>`
        )
        .join('')}</div>
      <div class="card" style="margin-top:16px"><h2 style="margin:0">Add an admin</h2>
        <div class="grid2"><label>Name<input id="a_n"></label><label>Name in Planning Center<input id="a_p" placeholder="Same as name"></label>
        <label>Starting PIN (4–8 digits)<input id="a_pin" inputmode="numeric"></label></div>
        <button class="primary" id="a_go">Add admin</button></div>`;
    function drawRoles() {
      $('#rl').innerHTML = list
        .map(
          (r, i) => `<div class="card" style="gap:10px">
            <div class="grid2"><label>Role name<input data-i="${i}" data-f="name" value="${esc(r.name)}"></label>
              <label>${r.hasPin ? 'Change PIN (leave blank to keep)' : 'Set PIN (4–8 digits)'}<input data-i="${i}" data-f="pin" type="password" inputmode="numeric" maxlength="8" placeholder="${r.hasPin ? '••••' : 'No PIN yet'}" autocomplete="new-password"></label></div>
            <label>Planning Center positions that count as this role<input data-i="${i}" data-f="positionsText" value="${esc(r.positionsText)}" placeholder="FOH Audio Engineer"></label>
            <div class="row">${perms.map((p) => `<label class="inline"><input type="checkbox" data-i="${i}" data-p="${p}" ${r.perms.includes(p) ? 'checked' : ''}> ${PERM_NAMES[p] || p}</label>`).join('')}
              <span class="grow"></span>${r.person ? `<span class="dim">Today: ${esc(r.person)}</span>` : ''}<button class="small danger" data-rd="${i}">Remove</button></div></div>`
        )
        .join('');
      $$('#rl [data-f]').forEach((el) => (el.oninput = () => (list[el.dataset.i][el.dataset.f] = el.value)));
      $$('#rl [data-p]').forEach(
        (el) =>
          (el.onchange = () => {
            const r = list[el.dataset.i];
            r.perms = el.checked ? [...new Set([...r.perms, el.dataset.p])] : r.perms.filter((x) => x !== el.dataset.p);
          })
      );
      $$('#rl [data-rd]').forEach(
        (b) =>
          (b.onclick = () => {
            if (!confirm(`Remove the ${list[b.dataset.rd].name || 'new'} role? Anyone signed in with it is signed out when you save.`)) return;
            list.splice(b.dataset.rd, 1);
            drawRoles();
          })
      );
    }
    drawRoles();
    $('#radd').onclick = () => {
      list.push({ id: '', name: '', positionsText: '', perms: ['messages'], hasPin: false, pin: '' });
      drawRoles();
    };
    $('#rsave').onclick = async () => {
      try {
        await api('/api/roles', {
          method: 'PUT',
          body: { roles: list.map((r) => ({ id: r.id, name: r.name, positions: r.positionsText.split(',').map((x) => x.trim()).filter(Boolean), perms: r.perms, pin: r.pin || undefined })) },
        });
        toast('Roles saved');
        viewAccounts();
      } catch (e) {
        fail(e);
      }
    };
    $('#a_go').onclick = async () => {
      try {
        await api('/api/accounts', { body: { name: $('#a_n').value, pcoName: $('#a_p').value || $('#a_n').value, role: 'admin', pin: $('#a_pin').value } });
        toast('Admin added');
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
        <p class="dim">A Planning Center admin creates a Personal Access Token at api.planningcenteronline.com (Developers → Personal Access Tokens) and enters the Client ID (Application ID) and Secret here. The Secret starts with pco_pat_. Read-only.</p>
        <div class="grid2"><label>Client ID (Application ID)<input id="c_pid" value="${esc(c.pco.appId)}" autocomplete="off"></label>
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
    handhelds: viewHandhelds,
    accounts: viewAccounts,
    settings: viewSettings,
  };

  boot();
})();
