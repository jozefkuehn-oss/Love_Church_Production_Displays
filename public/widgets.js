/* Every widget a display can show. Each one is a function that takes its
   options, the live snapshot and its size on screen, and returns HTML. The
   display only replaces a widget's HTML when it actually changed. */
(function () {
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function dur(ms) {
    if (ms == null || isNaN(ms)) return '—';
    const neg = ms < 0;
    let t = Math.round(Math.abs(ms) / 1000);
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    const body = h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    return (neg ? '+' : '') + body;
  }
  const lenFmt = (sec) => (sec ? dur(sec * 1000) : '—');

  function clockText(ms, tz, seconds) {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', second: seconds ? '2-digit' : undefined, hour12: true });
    return f.format(new Date(ms)).replace(/\s?[AP]M$/i, '');
  }
  const ampm = (ms, tz) => (/PM/i.test(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: true }).format(new Date(ms))) ? 'PM' : 'AM');

  const fill = (tpl, s) =>
    String(tpl || '')
      .replace('{encounter}', s.encounter ? s.encounter.label : '')
      .replace('{next}', s.nextEncounter ? s.nextEncounter.label : s.encounter ? s.encounter.label : '')
      .replace('{date}', s.date ? s.date.label : '')
      .replace('{campus}', s.campus || '');

  // ---------- face cards ----------
  function fitGrid(n, W, H, gap, aspect, fixedCols) {
    if (!n) return { cols: 1, w: W, h: H };
    if (fixedCols) {
      const rows = Math.ceil(n / fixedCols);
      return { cols: fixedCols, rows, w: (W - gap * (fixedCols - 1)) / fixedCols, h: (H - gap * (rows - 1)) / rows };
    }
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      let w = (W - gap * (cols - 1)) / cols;
      let h = w / aspect;
      if (h * rows + gap * (rows - 1) > H) {
        h = (H - gap * (rows - 1)) / rows;
        w = h * aspect;
      }
      if (!best || w * h > best.w * best.h) best = { cols, rows, w, h };
    }
    return best;
  }

  function photoImg(c) {
    if (!c.photo) return `<span class="ini" style="font-size:${Math.round((c._w || 160) / 3.2)}px">${esc(c.initials)}</span>`;
    const z = c.zoom && c.zoom !== 1 ? `transform:scale(${c.zoom});transform-origin:${c.focusX}% ${c.focusY}%;` : '';
    return `<img src="${esc(c.photo)}" alt="" style="object-position:${c.focusX != null ? c.focusX : 50}% ${c.focusY != null ? c.focusY : 15}%;${z}">`;
  }

  function faceCard(c, size, extra = {}) {
    const w = size.w;
    c._w = w;
    const nameSize = Math.max(13, Math.min(30, Math.round(w / 9)));
    const roleSize = Math.max(10, Math.min(14, Math.round(w / 20)));
    const roleColor = extra.roleColor || c._roleColor || '';
    return `<div class="face" style="${extra.fixed ? `height:${Math.round(size.h)}px;` : ''}">
      ${photoImg(c)}
      ${c.pending && !extra.noPending ? '<span class="pend">PENDING</span>' : ''}
      ${extra.inner || ''}
      <div class="ov" style="padding:${Math.max(6, w / 24)}px ${Math.max(8, w / 18)}px">
        <div class="role" style="font-size:${roleSize}px;${roleColor ? 'color:' + roleColor : ''}">${esc(c.role)}</div>
        <div class="nm" style="font-size:${nameSize}px">${esc(c.name)}</div>
        ${extra.help ? `<div class="help" style="font-size:${Math.max(12, Math.min(16, w / 14))}px">${esc(extra.help)}</div>` : ''}
        ${extra.below || ''}
      </div>
      ${extra.ring || ''}
    </div>`;
  }

  function groupPeople(s, group) {
    const P = s.people || {};
    return group
      .split('+')
      .flatMap((g) => (P[g] || []).map((c) => ({ ...c, _roleColor: g === 'communicators' ? 'var(--blue)' : g === 'leadership' ? 'var(--pink-text)' : '' })));
  }

  // ---------- device row ----------
  // d: { ch, battery (0-100|null), minutes (runtime|null), rf (true|false|null = unknown), off }
  const battText = (d) => (d.minutes != null ? `${Math.floor(d.minutes / 60)}h${String(d.minutes % 60).padStart(2, '0')}` : d.battery + '%');
  const rfClass = (d) => (d.rf === false ? 'drop' : d.rf ? '' : 'none');
  function devRow(d) {
    if (!d) return '';
    if (d.off) return `<div class="dev"><span class="ch">${esc(d.ch)}</span><span class="b"></span><span class="p" style="color:var(--dim)">OFF</span><span class="rf none"></span></div>`;
    if (d.battery == null) return `<div class="dev"><span class="ch">${esc(d.ch || '—')}</span><span class="b"></span><span class="p"></span><span class="rf ${rfClass(d)}"></span></div>`;
    const col = d.battery < 20 ? 'var(--red)' : d.battery < 35 ? 'var(--yellow)' : 'var(--green)';
    return `<div class="dev"><span class="ch">${esc(d.ch)}</span><span class="b"><i style="width:${d.battery}%;background:${col}"></i></span><span class="p" style="color:${d.battery < 35 ? col : '#fff'}">${battText(d)}</span><span class="rf ${rfClass(d)}"></span></div>`;
  }
  const devAlert = (d) => d && !d.off && ((d.battery != null && d.battery < 20) || d.rf === false);
  const devWarn = (d) => d && d.battery != null && d.battery < 35;

  // ---------- widgets ----------
  const W = {};

  W.title = (o, s, ctx) => {
    let sub = '';
    if (o.sub === 'live') {
      const src = s.indexSource === 'propresenter' ? 'following Auditorium ProPresenter' : s.indexSource === 'manual' ? 'manual position' : 'planned timing';
      sub = `<div class="sub"><span class="dot"></span><span>Live · ${src}</span></div>`;
    } else if (o.sub === 'date') sub = `<div class="sub">${esc(s.date.label)}</div>`;
    else if (o.sub === 'encounters') sub = `<div class="sub">Encounters ${esc((s.encounters || []).map((e) => e.label).join(' · '))}</div>`;
    return `<div class="title ${o.compact ? 'compact' : ''}"><div class="kicker">${esc(fill(o.kicker, s))}</div><div class="big" style="${!o.compact && ctx && ctx.w < 420 ? 'font-size:34px' : ''}">${esc(fill(o.title, s))}</div>${sub}</div>`;
  };

  W.clock = (o, s, ctx) => {
    const secs = o.seconds && !o.compact;
    // Shrink the digits in narrow boxes so the AM/PM always fits.
    const fs = !o.compact && ctx && ctx.w ? Math.min(58, Math.floor((ctx.w - 48) / (secs ? 5.4 : 4.1))) : null;
    return `<div class="stat ${o.compact ? 'compact' : ''}"><div class="k">${esc(o.label || 'TIME OF DAY')}</div><div class="v" style="white-space:nowrap;${fs ? `font-size:${fs}px` : ''}">${clockText(s.now, s.tz, secs)}<span class="ampm">${ampm(s.now, s.tz)}</span></div></div>`;
  };

  const COUNT_LABELS = { streamEnd: 'STREAM ENDS IN', encounterStart: 'ENCOUNTER STARTS IN', bandToStage: 'BAND TO STAGE IN', positions: 'POSITIONS IN', firstStream: 'FIRST STREAM IN', nextEncounter: 'NEXT ENCOUNTER IN', streamStart: 'STREAM STARTS IN' };
  W.countdown = (o, s) => {
    const target = s.targets && s.targets[o.target];
    const left = target ? target - s.now : null;
    let cls = o.accent ? 'accent' : '';
    let text = dur(left);
    if (left != null && left <= 0) text = { streamEnd: 'Ended', encounterStart: 'Started', nextStart: 'Starting', bandToStage: 'On stage', nextBandToStage: 'On stage', streamStart: 'Live', nextStreamStart: 'Live', firstStream: 'Live' }[o.target] || 'Now';
    if (left == null && /^next/.test(o.target)) text = 'Done for today';
    if (left == null && ((s.targets && s.targets.notStreamed) || []).includes(o.target)) text = 'Not streamed';
    if (o.huge) {
      return `<div class="stat huge ${cls}"><div class="k">${esc(fill(o.label || COUNT_LABELS[o.target] || '', s))}</div><div class="v">${text}</div></div>`;
    }
    if (o.target === 'streamEnd' && left != null && left > 0) {
      if (left <= 2 * 60e3) cls += ' alert flash';
      else if (left <= 5 * 60e3) cls += ' alert';
      else if (left <= 10 * 60e3 && !o.accent) cls += ' warn';
    }
    return `<div class="stat ${cls} ${o.compact ? 'compact' : ''}"><div class="k">${esc(fill(o.label || COUNT_LABELS[o.target] || '', s))}</div><div class="v">${text}</div></div>`;
  };

  // Today's Encounters as a strip: done, live now, next, later.
  W.encountersToday = (o, s) => {
    const st = s.encounterStates || [];
    if (!st.length) return `<div class="et"><span class="n2">No Encounters scheduled today</span></div>`;
    const tag = { live: 'LIVE', next: 'NEXT', done: 'DONE', later: '' };
    return `<div class="et ${o.compact ? 'compact' : ''}"><span class="lab">TODAY</span>${st
      .map((e) => `<span class="enc ${e.state}">${tag[e.state] ? `<b>${tag[e.state]}</b>` : ''}${esc(e.label)}</span>`)
      .join('')}</div>`;
  };

  // First song (or first item) of the upcoming Encounter, for the stage and greenroom.
  W.firstUp = (o, s) => {
    const items = (s.items || []).filter((i) => i.position !== 'pre');
    const first = items.find((i) => i.isSong) || items[0];
    if (!first) return `<div class="panel" style="height:100%"><div class="label">FIRST UP</div><div class="dim">Waiting for the plan…</div></div>`;
    const song = (s.daySongs || []).find((d) => d.title.toLowerCase().includes(first.title.replace(/\[[^\]]*\]/g, '').trim().toLowerCase()));
    const lead = song && song.lead && song.lead !== '—' ? ` · Lead ${esc(song.lead)}` : '';
    return `<div class="panel firstup" style="height:100%"><div class="label pink">FIRST UP</div><div class="fu-t">${esc(first.title)}</div><div class="fu-s">${first.key ? 'Key ' + esc(first.key) : ''}${lead}</div></div>`;
  };

  W.itemRemaining = (o, s) => {
    const r = s.itemRemainingMs;
    const over = r != null && r < 0;
    return `<div class="stat ${o.accent ? 'accent' : ''} ${over ? 'alert' : ''} ${o.compact ? 'compact' : ''}"><div class="k">${esc(o.label || (over ? 'ITEM OVER BY' : 'ITEM REMAINING'))}</div><div class="v">${r == null ? '—' : dur(over ? r : r)}</div></div>`;
  };

  W.projected = (o, s) => {
    if (o.label) {
      // FOH style: how far behind/ahead of plan the Encounter is running.
      const d = s.driftMs || 0;
      const cls = d > 60e3 ? 'warn' : d < -60e3 ? 'good' : '';
      return `<div class="stat ${cls}"><div class="k">${esc(o.label)}</div><div class="v">${d >= 0 ? '+' : '−'}${dur(Math.abs(d)).replace('+', '')}<small>${d >= 0 ? 'behind plan' : 'ahead'}</small></div></div>`;
    }
    const ov = s.overStreamMs;
    if (ov == null) return `<div class="stat"><div class="k">PROJECTED FINISH</div><div class="v">—</div></div>`;
    const cls = ov > 2 * 60e3 ? 'alert' : ov > 0 ? 'warn' : 'good';
    const v = ov > 0 ? `+${dur(ov).replace('+', '')}<small>past stream end</small>` : `−${dur(-ov).replace('+', '')}<small>to spare</small>`;
    return `<div class="stat ${cls}"><div class="k">PROJECTED FINISH</div><div class="v">${v}</div></div>`;
  };

  W.runOfShow = (o, s, ctx) => {
    const all = s.items || [];
    const fits = Math.max(4, Math.floor(((ctx ? ctx.h : 800) - 70) / 44));
    let startAt = 0;
    if (all.length > fits && s.index != null) startAt = Math.max(0, Math.min(all.length - fits, s.index - 3));
    const rows = all
      .slice(startAt, startAt + fits)
      .map((it) => `<div class="it ${it.status || ''}"><span class="dot"></span><span class="grow ell">${esc(it.title)}</span>${it.key ? `<span class="key">${esc(it.key)}</span>` : ''}<span class="len">${lenFmt(it.length)}</span></div>`)
      .join('');
    return `<div class="panel ros" style="height:100%"><div class="row"><div class="label grow">RUN OF SHOW</div><div style="font-size:15px;color:var(--dim)">${s.plan && s.plan.source === 'planningcenter' ? 'Planning Center' : 'Sample plan'}</div></div>${rows || '<div class="missing">No plan loaded</div>'}</div>`;
  };

  W.songNow = (o, s, ctx) => {
    const tight = ctx && ctx.h < 330;
    const sn = s.songNow;
    const cur = s.current;
    if (!cur) return `<div class="panel song-now" style="height:100%"><div class="missing">Waiting for the plan…</div></div>`;
    if (!sn) {
      return `<div class="panel song-now" style="height:100%"><div class="label pink">NOW</div><div class="t">${esc(cur.title)}</div>${cur.length ? `<div class="meta">${lenFmt(cur.length)} planned</div>` : ''}</div>`;
    }
    const pct = cur.length && s.itemRemainingMs != null ? Math.min(100, Math.max(0, 100 - (s.itemRemainingMs / (cur.length * 1000)) * 100)) : 0;
    const songIdx = (s.items || []).filter((i) => i.isSong).findIndex((i) => i.title === cur.title);
    const songCount = (s.items || []).filter((i) => i.isSong).length;
    const chipStyle = tight ? 'font-size:13px;padding:4px 9px' : sn.progression.length > 160 ? 'font-size:14px;padding:5px 10px' : '';
    const chips = o.showProgression && sn.progression ? `<div class="chips" style="gap:6px">${sn.progression.split(/\s*→\s*/).map((c, i) => `<span class="chip ${s.section === i ? 'on' : ''}" style="${chipStyle}">${esc(c)}</span>`).join('')}</div>` : '';
    const tSize = tight ? 34 : sn.title.length > 22 ? 40 : 50;
    return `<div class="panel song-now" style="height:100%;padding:24px 30px">
      <div class="row"><div class="label pink grow">NOW${songCount ? ` · SONG ${songIdx + 1} OF ${songCount}` : ''}</div><div class="meta">${[sn.lead && 'Lead ' + sn.lead, sn.key && 'Key ' + sn.key, cur.length && lenFmt(cur.length)].filter(Boolean).map(esc).join(' · ')}</div></div>
      <div class="t" style="font-size:${tSize}px">${esc(sn.title)}</div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      ${o.showFeel && sn.feel ? `<div class="feel" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:${tight ? 16 : 19}px">${esc(sn.feel)}</div>` : ''}
      ${!sn.inBank ? '<div class="flag">Not in the song bank yet — add it in the admin page</div>' : ''}
      ${chips}
    </div>`;
  };

  W.songNext = (o, s, ctx) => {
    const roomy = !ctx || ctx.h > 260;
    const n = s.next;
    const sn = s.songNext;
    if (!n) return `<div class="panel" style="height:100%"><div class="label">NEXT</div><div class="missing">End of plan</div></div>`;
    const showSong = sn && n.isSong;
    return `<div class="panel" style="height:100%"><div class="label">NEXT</div>
      <div class="small-t">${esc(n.title)}</div>
      <div style="font-size:17px;color:var(--muted)">${[n.key && 'Key ' + n.key, n.length && lenFmt(n.length), showSong && sn.lead && 'Lead ' + sn.lead].filter(Boolean).map(esc).join(' · ')}</div>
      ${roomy && showSong && sn.feel ? `<div style="font-size:16px;line-height:1.35;color:var(--text-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(sn.feel)}</div>` : ''}
      ${showSong && !sn.inBank ? '<div class="flag">Not in the song bank yet</div>' : ''}
    </div>`;
  };

  W.graphics = (o, s) => {
    const b = s.propresenter.broadcast;
    let body;
    if (!b.enabled) body = '<div class="missing">Broadcast ProPresenter isn’t set up yet (admin → Settings)</div>';
    else if (!b.connected) body = '<div class="missing" style="color:var(--yellow)">Can’t reach Broadcast ProPresenter</div>';
    else
      body = `<div class="row"><span class="pill">LIVE</span><span class="grow ell" style="font-size:21px;font-weight:600">${esc(b.presentation || '')}${b.current.text ? ' · ' + esc(b.current.text.split('\n')[0]) : ''}</span></div>
        <div class="row"><span class="pill grey">NEXT</span><span class="grow ell" style="font-size:21px;font-weight:600;color:var(--text-2)">${esc((b.next.text || '').split('\n')[0] || '—')}</span></div>`;
    return `<div class="panel" style="height:100%"><div class="row"><div class="label grow">BROADCAST GRAPHICS</div></div>${body}</div>`;
  };

  W.faces = (o, s, ctx) => {
    const list = groupPeople(s, o.group || 'stage');
    const collage = !!o.collage;
    const headH = o.label && !collage ? 30 : 0;
    const gap = collage ? 4 : 8;
    const fit = fitGrid(list.length, ctx.w, ctx.h - headH, gap, collage ? 0.8 : 0.8, o.columns);
    // Non-collage cards may grow taller (down to a 0.6 portrait) to use the space.
    const rowH = (ctx.h - headH - gap * (fit.rows - 1)) / fit.rows;
    const size = collage ? { w: fit.w, h: fit.h } : { w: fit.w, h: Math.min(rowH, fit.w / 0.6) };
    const cards = list.map((c) => faceCard(c, size, { roleColor: o.roleColor, fixed: true })).join('');
    const labelColor = /communicators$/.test(o.group) ? 'blue' : 'pink';
    return `<div class="faces-wrap">${headH ? `<div class="label ${labelColor}">${esc(o.label)}</div>` : ''}
      <div class="faces" style="grid-template-columns:repeat(${fit.cols}, ${collage ? 'minmax(0,1fr)' : Math.floor(size.w) + 'px'});${collage ? `grid-auto-rows:minmax(0,1fr)` : ''}">${cards || '<div class="missing">Nobody scheduled</div>'}</div></div>`;
  };

  W.worshipMics = (o, s, ctx) => {
    const stageNames = new Set((s.people.stage || []).map((c) => c.name));
    const rows = (s.wireless || []).filter((r) => stageNames.has(r.name));
    const headH = 32;
    const fit = fitGrid(rows.length, ctx.w, ctx.h - headH, 12, 0.72, o.columns || (rows.length > 8 ? 5 : 4));
    const size = { w: fit.w, h: fit.h };
    const cards = rows
      .map((r) => {
        const alert = devAlert(r.mic) || devAlert(r.iem);
        const warn = !alert && (devWarn(r.mic) || devWarn(r.iem));
        const c = { ...r, pending: false };
        return faceCard(c, size, {
          fixed: true,
          below: `<div style="display:flex;flex-direction:column;gap:7px;margin-top:8px">${devRow(r.mic)}${devRow(r.iem)}</div>`,
          ring: alert ? '<span class="ring" style="box-shadow:inset 0 0 0 4px var(--red)"></span>' : warn ? '<span class="ring" style="box-shadow:inset 0 0 0 4px var(--yellow)"></span>' : '',
          inner: alert ? '<span class="tag" style="background:var(--red);color:#fff">CHECK</span>' : warn ? '<span class="tag" style="background:var(--yellow);color:#111">LOW</span>' : '',
        });
      })
      .join('');
    return `<div class="faces-wrap" style="gap:12px"><div class="row"><div class="label pink grow">WORSHIP TEAM · MICS &amp; IEMS</div>
      <div class="row" style="gap:20px;font-size:15px;color:var(--muted)"><span class="row" style="gap:8px"><span class="rf"></span>RF good</span><span class="row" style="gap:8px"><span class="rf drop"></span>RF drop</span></div></div>
      <div class="faces" style="gap:12px;grid-template-columns:repeat(${fit.cols}, ${Math.floor(size.w)}px)">${cards || '<div class="missing">No worship team scheduled</div>'}</div></div>`;
  };

  W.goto = (o, s, ctx) => {
    const roles = o.roles || ['FOH Audio Engineer', 'Service Producer', 'Broadcast Producer'];
    const list = (s.people.leadership || []).filter((c) => roles.includes(c.position));
    const fit = fitGrid(list.length, ctx.w - 36, ctx.h - 36 - 50, 10, 0.75, list.length > 2 ? 2 : 1);
    const cards = list.map((c) => faceCard({ ...c, pending: false }, { w: fit.w, h: fit.h }, { fixed: true, help: c.help })).join('');
    return `<div class="goto"><div class="row"><span class="pill" style="font-size:14px;padding:6px 12px;border-radius:8px">NEED SOMETHING?</span><span style="font-size:20px;font-weight:800">Your Go-To People</span></div>
      <div class="faces" style="gap:10px;grid-template-columns:repeat(${fit.cols}, ${Math.floor(fit.w)}px)">${cards || '<div class="missing">No go-to people scheduled</div>'}</div></div>`;
  };

  W.wirelessList = (o, s) => {
    const rows = (s.wireless || [])
      .flatMap((r) => [r.mic && r.mic.ch && r.mic.ch !== 'WIRED' ? { r, d: r.mic } : null, r.iem && r.iem.ch ? { r, d: r.iem } : null])
      .filter(Boolean)
      .sort((a, b) => (a.d.ch.startsWith('IEM') - b.d.ch.startsWith('IEM')) || a.d.ch.localeCompare(b.d.ch, undefined, { numeric: true }));
    const html = rows
      .map(({ r, d }) => {
        const alert = devAlert(d);
        const col = d.battery < 20 ? 'var(--red)' : d.battery < 35 ? 'var(--yellow)' : 'var(--green)';
        return `<div class="wl-row ${alert ? 'alert' : ''}">
          <span style="width:52px;font-size:14px;font-weight:800;color:var(--muted)">${esc(d.ch)}</span>
          <span class="av">${r.photo ? `<img src="${esc(r.photo)}" alt="" style="object-position:${r.focusX}% ${r.focusY}%">` : esc(r.initials)}</span>
          <span class="grow" style="font-size:17px;font-weight:600;line-height:1.1">${esc(r.name)}</span>
          <span style="width:56px;height:10px;border-radius:5px;background:var(--line);overflow:hidden"><i style="display:block;height:100%;width:${d.battery || 0}%;background:${col}"></i></span>
          <span style="width:52px;text-align:right;font-size:17px;font-weight:700;color:${d.off ? 'var(--dim)' : d.battery < 35 ? col : '#fff'}">${d.off ? 'OFF' : d.battery == null ? '' : battText(d)}</span>
          <span class="rf ${rfClass(d)}"></span></div>`;
      })
      .join('');
    return `<div class="panel" style="height:100%;gap:8px"><div class="row"><div class="label grow">WIRELESS</div><div style="font-size:14px;color:var(--dim)">Battery · RF</div></div>${html}</div>`;
  };

  function needTags(it, s) {
    const t = it.title.toLowerCase();
    const tags = [];
    if (it.isSong) {
      const k = it.key ? 'Key ' + it.key : '';
      if (k) tags.push(k);
      const song = (s.daySongs || []).find((x) => x.title.toLowerCase().includes(t.replace(/\[[^\]]*\]\s*/g, '')) || t.includes(x.title.toLowerCase()));
      if (song && song.lead) tags.push('Lead ' + song.lead);
      if (song && /no tracks/i.test(song.notes)) tags.push('No tracks');
      else tags.push('Tracks + lyrics');
    } else if (/message/.test(t)) tags.push('Pastor mic', 'Band off', 'Message timer');
    else if (/rapport|ministry/.test(t)) tags.push('Pastor mic', 'Band under');
    else if (/host/.test(t)) tags.push('Host mic');
    else if (/video|roll|intro/.test(t)) tags.push('Video roll', 'Playback audio');
    else if (/altar/.test(t)) tags.push('Pastor mic', 'Keys pad');
    return tags;
  }

  W.needs = (o, s) => {
    const idx = s.index == null ? -1 : s.index;
    const up = (s.items || []).slice(idx + 1, idx + 4);
    let acc = s.itemRemainingMs != null ? Math.max(0, s.itemRemainingMs) : 0;
    const rows = up
      .map((it, i) => {
        const when = i === 0 ? 'NEXT' : '+' + dur(acc).replace('+', '');
        acc += (it.length || 0) * 1000;
        return `<div class="need"><span class="when">${when}</span><div class="grow" style="display:flex;flex-direction:column;gap:8px"><div class="tt">${esc(it.title)}${it.key ? ' · Key ' + esc(it.key) : ''}</div><div class="chips">${needTags(it, s).map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div></div></div>`;
      })
      .join('');
    return `<div class="panel" style="height:100%"><div class="label">COMING UP · WHAT IT NEEDS</div>${rows || '<div class="missing">Nothing left in the plan</div>'}</div>`;
  };

  W.keys = (o, s) => {
    const songs = (s.items || []).filter((i) => i.isSong);
    const tiles = songs.map((it) => `<div class="keytile ${it.status === 'now' ? 'now' : it.status === 'done' ? 'done' : ''}"><div class="k">${esc(it.key || '—')}</div><div class="n">${esc(it.title)}</div></div>`).join('');
    return `<div class="panel" style="height:100%"><div class="label">SET KEYS · LIVE ARRANGEMENT</div><div class="keys" style="grid-template-columns:repeat(${Math.max(1, songs.length)}, minmax(0,1fr))">${tiles}</div></div>`;
  };

  W.worshipDirection = (o, s) => {
    const cards = (s.daySongs || [])
      .map(
        (sg) => `<div class="card">
        <div class="row" style="gap:10px;align-items:baseline"><span class="t">${esc(sg.title)}</span>${sg.key ? `<span class="key">KEY ${esc(sg.key)}</span>` : ''}${sg.lead ? `<span style="font-size:13px;font-weight:600;color:var(--muted)">Lead ${esc(sg.lead)}</span>` : ''}${sg.cue ? `<span class="cue" style="margin-left:auto;font-size:13px">${esc(sg.cue)}</span>` : ''}</div>
        ${sg.feel ? `<div class="f"><b>Feel </b>${esc(sg.feel)}</div>` : ''}
        ${sg.progression ? `<div class="pg"><b>Progression </b>${esc(sg.progression)}</div>` : ''}
        ${sg.notes ? `<div class="nt"><b>Notes </b>${esc(sg.notes)}</div>` : ''}
        ${!sg.inBank ? '<div class="nt">Not in the song bank yet</div>' : ''}
      </div>`
      )
      .join('');
    return `<div class="wd"><div class="row"><div class="label grow">WORSHIP DIRECTION</div><div style="font-size:13px;color:var(--dim)">Song bank</div></div>${cards}</div>`;
  };

  W.runOfShowDay = (o, s) => {
    // Merge Encounters whose run of show is identical except for per-Encounter names.
    // Encounters with the same items (by plan item) share a column; where a
    // name differs between them it's shown inline, e.g. "Host [MJ / Jordan]".
    const cols = [];
    for (const e of s.runDay || []) {
      const sig = e.items.map((i) => i.id).join('|');
      const last = cols[cols.length - 1];
      if (last && last.sig === sig) {
        last.labels.push(e.label);
        e.items.forEach((it, k) => {
          const cur = last.items[k];
          if (cur.title !== it.title && !cur._alts.includes(it.title)) cur._alts.push(it.title);
        });
      } else cols.push({ sig, labels: [e.label], items: e.items.map((i) => ({ ...i, _alts: [i.title] })) });
    }
    const merged = (i) => {
      if (i._alts.length < 2) return i.title;
      const inner = i._alts.map((t) => (t.match(/\[([^\]]*)\]/) || [])[1]).filter(Boolean);
      return inner.length === i._alts.length ? i.title.replace(/\[[^\]]*\]/, `[${[...new Set(inner)].join(' / ')}]`) : i._alts.join(' / ');
    };
    const html = cols
      .map(
        (c) => `<div class="col"><div class="h">${esc(c.labels.join(' & '))}</div>${c.items
          .map((i) => `<div class="i ${i.varies ? 'var' : i.isSong ? 'song' : ''}">${esc(merged(i))}${i.key ? ' — ' + esc(i.key) : ''}</div>`)
          .join('')}</div>`
      )
      .join('');
    return `<div class="panel" style="height:100%;padding:16px"><div class="label">RUN OF SHOW</div><div class="rd" style="grid-template-columns:repeat(${Math.max(1, cols.length)}, minmax(0,1fr))">${html}</div></div>`;
  };

  W.nowNext = (o, s) => {
    const cur = s.current;
    const nx = s.next;
    if (!cur) return `<div class="nn"><span class="n2">Waiting for the plan…</span></div>`;
    return `<div class="nn"><span class="pill">NOW</span><span class="n1 ell">${esc(cur.title)}</span>${!o.nowOnly && nx ? `<span style="color:var(--dim);font-size:20px">→</span><span class="n2 ell">${esc(nx.title)}</span>` : ''}</div>`;
  };

  W.slide = (o, s) => {
    const p = s.propresenter[o.source || 'auditorium'];
    const sl = p && p[o.which === 'next' ? 'next' : 'current'];
    if (!p || !p.enabled) return `<div class="slide ${o.which}"><span class="wait">${o.which === 'next' ? '' : 'Auditorium ProPresenter isn’t set up yet'}</span></div>`;
    if (!p.connected) return `<div class="slide ${o.which}"><span class="wait" style="color:var(--yellow)">Waiting for ProPresenter…</span></div>`;
    const text = (sl && sl.text) || '';
    if (o.which === 'next') return `<div class="slide next"><span class="lab">NEXT</span><span>${esc(text)}</span></div>`;
    return `<div class="slide current">${esc(text) || '<span class="wait">(blank slide)</span>'}</div>`;
  };

  // What's on screen now / next, as ProPresenter's own slide pictures.
  // opts: source auditorium|broadcast, label, showNext (default true).
  W.slidePreview = (o, s) => {
    const src = o.source || 'broadcast';
    const p = s.propresenter && s.propresenter[src];
    const label = esc(o.label || (src === 'broadcast' ? 'BROADCAST GRAPHICS' : 'AUDITORIUM SCREENS'));
    if (!p || !p.enabled) return `<div class="panel" style="height:100%"><div class="label">${label}</div><div class="dim">ProPresenter isn’t set up yet</div></div>`;
    if (!p.connected) return `<div class="panel" style="height:100%"><div class="label">${label}</div><div style="color:var(--yellow)">Waiting for ProPresenter…</div></div>`;
    const t = p.thumb;
    const pic = (which, idx, text) =>
      `<div class="sp-box"><span class="sp-tag ${which}">${which === 'cur' ? 'LIVE' : 'NEXT'}</span>${
        t ? `<img src="/prop-thumb/${src}/${encodeURIComponent(t.uuid)}/${idx}" alt="" onerror="this.style.display='none'">` : ''
      }<span class="sp-txt">${esc((text || '').split('\n')[0])}</span></div>`;
    return `<div class="panel sp" style="height:100%"><div class="row"><div class="label grow">${label}</div><span class="dim ell" style="max-width:50%">${esc(p.presentation || '')}</span></div>
      <div class="sp-row">${pic('cur', t ? t.current : 0, p.current && p.current.text)}${o.showNext === false ? '' : pic('nxt', t ? t.next : 0, p.next && p.next.text)}</div></div>`;
  };

  // ProPresenter timers (and the stage message), live from the machine.
  // opts: source auditorium|broadcast, names "Message, Countdown" (blank =
  // every timer that's running or has time on it), label.
  W.propTimers = (o, s) => {
    const p = s.propresenter && s.propresenter[o.source || 'auditorium'];
    const head = `<div class="label">${esc(o.label || 'PROPRESENTER TIMERS')}</div>`;
    if (!p || !p.enabled) return `<div class="panel" style="height:100%">${head}<div class="dim">ProPresenter isn’t set up yet</div></div>`;
    if (!p.connected) return `<div class="panel" style="height:100%">${head}<div style="color:var(--yellow)">Waiting for ProPresenter…</div></div>`;
    const want = String(o.names || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    let list = (p.timers || []).filter((t) => (want.length ? want.includes(t.name.toLowerCase()) : /running|overrun/i.test(t.state)));
    if (!list.length && !want.length) list = (p.timers || []).slice(0, 3);
    const rows = list
      .map((t) => {
        const over = /overrun|complete/i.test(t.state) || /^-/.test(t.time);
        const run = /running|overrun/i.test(t.state);
        return `<div class="pt ${over ? 'over' : ''}"><span class="ptn">${esc(t.name)}</span><span class="ptt">${esc(String(t.time).replace(/^00:/, ''))}</span><span class="pts">${run ? '●' : '❚❚'}</span></div>`;
      })
      .join('');
    const sm = p.stageMessage ? `<div class="ptmsg"><span class="badge">STAGE</span>${esc(p.stageMessage)}</div>` : '';
    return `<div class="panel" style="height:100%;gap:10px">${head}${rows || '<div class="dim">No timers running</div>'}${sm}</div>`;
  };

  W.messageBar = (o, s, ctx) => {
    const mine = (s.messages || []).filter((m) => m.targets.includes('all') || m.targets.includes(ctx.profileId));
    const m = mine[mine.length - 1];
    const legend = o.legend ? '<span class="legend"><span style="color:var(--pink-text)">LEADERSHIP</span><span>WORSHIP</span><span style="color:var(--blue)">COMMUNICATORS</span></span>' : '';
    const sample = s.sampleMode ? '<span class="sample-tag">Sample mode</span>' : '';
    if (!m) return `<div class="mb idle ${o.big ? 'big' : ''}"><span class="badge">MESSAGE</span><span class="txt">${esc(o.idleText || '')}</span>${legend}${sample}</div>`;
    const badge = m.level === 'urgent' ? 'URGENT' : m.level === 'heads' ? 'HEADS UP' : 'PRODUCER';
    return `<div class="mb ${m.level} ${m.flash ? 'flash' : ''} ${o.big ? 'big' : ''}"><span class="badge">${m.flash ? 'MIC CHANGE' : badge}</span><span class="txt">${esc(m.text)}</span><span class="from">— ${esc(m.from)}</span>${sample}</div>`;
  };

  W.text = (o) => `<div class="panel" style="height:100%"><div class="label">${esc(o.label || '')}</div><div style="font-size:${o.size || 24}px;font-weight:600;white-space:pre-line">${esc(o.text || '')}</div></div>`;

  W.image = (o) => `<div style="height:100%;border-radius:16px;overflow:hidden;background:#000">${o.src ? `<img src="${esc(o.src)}" alt="" style="width:100%;height:100%;object-fit:${o.fit || 'cover'}">` : '<div class="missing">No image chosen</div>'}</div>`;

  window.LCD = { widgets: W, dur, esc };
})();
