// Shure Axient Digital receivers (AD4D, AD4Q) over the network.
//
// Each receiver speaks Shure's ASCII command protocol on TCP port 2202:
//   send  < GET 1 CHAN_NAME >        reply  < REP 1 CHAN_NAME {VOX-4                          } >
//   send  < SET 1 METER_RATE 01000 > then the receiver streams
//         < SAMPLE 1 ALL 005 000 045 062 BB 31 099 31 085 >  once a second.
// We keep one connection per receiver, ask for the transmitter battery every
// few seconds and read RF/link quality from the metering samples.
//
// Everything is keyed by the channel name set on the receiver (VOX-4,
// PASTOR…), so the Wireless tab just uses those names.

const net = require('net');

const PORT = 2202;
const POLL_PARAMS = ['CHAN_NAME', 'TX_MODEL', 'TX_BATT_BARS', 'TX_BATT_CHARGE_PERCENT', 'TX_BATT_MINS', 'TX_MUTE_MODE_STATUS', 'FREQUENCY'];

function makeReceiver(host) {
  const st = {
    host,
    connected: false,
    error: '',
    model: '',
    channels: {}, // 1..4 → { name, txModel, battBars, battPct, battMins, quality, ant, rssi:[], peak, sampleAt, txAt }
  };
  let sock = null;
  let buf = '';
  let pollT = null;
  let retryT = null;
  let stopped = false;
  let backoff = 2000;

  const ch = (n) => (st.channels[n] = st.channels[n] || { n, name: '', rssi: [] });
  const send = (s) => sock && !sock.destroyed && sock.write(s + '\r\n');

  function handle(line) {
    const m = line.match(/^<\s*(REP|SAMPLE)\s+(\d)\s+(\S+)\s*(.*?)\s*>$/);
    if (!m) return;
    const [, kind, nStr, key, rest] = m;
    const n = Number(nStr);
    if (kind === 'SAMPLE' && key === 'ALL') {
      // qual audBitmap audPeak audRms antStats [bitmap rssi] per antenna
      const f = rest.split(/\s+/);
      const c = ch(n);
      c.quality = num3(f[0]);
      c.peak = f[2] != null ? Number(f[2]) - 120 : null;
      c.ant = f[4] || '';
      c.rssi = [];
      for (let i = 6; i < f.length; i += 2) c.rssi.push(Number(f[i]) - 120);
      c.sampleAt = Date.now();
      return;
    }
    if (kind !== 'REP' || n === 0) {
      if (key === 'MODEL' || key === 'DEVICE_ID') st.model = st.model || rest.replace(/[{}]/g, '').trim();
      return;
    }
    const c = ch(n);
    const v = rest.replace(/[{}]/g, '').trim();
    switch (key) {
      case 'CHAN_NAME': c.name = v; break;
      case 'TX_MODEL': c.txModel = v; c.txAt = Date.now(); break;
      case 'TX_BATT_BARS': c.battBars = num3(v); break;
      case 'TX_BATT_CHARGE_PERCENT': c.battPct = num3(v); break;
      case 'TX_BATT_MINS': { const x = Number(v); c.battMins = x >= 65533 ? null : x; break; }
      case 'TX_MUTE_MODE_STATUS': c.muted = v === 'MUTE'; break;
      case 'FREQUENCY': c.freq = v ? (Number(v) / 1000).toFixed(3) : ''; break;
      case 'CHAN_QUALITY': case 'CHANNEL_QUALITY': c.quality = num3(v); break;
    }
  }
  const num3 = (v) => { const x = Number(v); return Number.isFinite(x) && x !== 255 ? x : null; };

  function poll() {
    for (const p of POLL_PARAMS) send(`< GET 0 ${p} >`);
  }

  function connect() {
    if (stopped) return;
    clearTimeout(retryT);
    sock = net.createConnection({ host, port: PORT });
    sock.setTimeout(15000);
    sock.setEncoding('ascii');
    sock.on('connect', () => {
      st.connected = true;
      st.error = '';
      backoff = 2000;
      send('< GET 0 MODEL >');
      poll();
      for (let i = 1; i <= 4; i++) send(`< SET ${i} METER_RATE 01000 >`);
      clearInterval(pollT);
      pollT = setInterval(poll, 5000);
    });
    sock.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('>')) !== -1) {
        const line = buf.slice(buf.indexOf('<') === -1 ? 0 : buf.indexOf('<'), i + 1).trim();
        buf = buf.slice(i + 1);
        if (line.startsWith('<')) handle(line);
      }
      if (buf.length > 10000) buf = '';
    });
    // No traffic for 15 s (metering is every second) means the link is dead.
    sock.on('timeout', () => sock.destroy(new Error('No response')));
    sock.on('error', (e) => (st.error = e.code === 'ECONNREFUSED' ? 'Refused (is third-party control on?)' : e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT' ? 'Can’t reach it on the network' : e.message));
    sock.on('close', () => {
      st.connected = false;
      clearInterval(pollT);
      if (stopped) return;
      retryT = setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30000);
    });
  }

  function stop() {
    stopped = true;
    clearInterval(pollT);
    clearTimeout(retryT);
    if (sock) sock.destroy();
  }

  connect();
  return { st, stop };
}

function makeShure() {
  let receivers = [];
  let key = '';

  // hosts: ['192.168.10.50', ...]
  function configure(hosts) {
    const clean = [...new Set((hosts || []).map((h) => String(h).trim()).filter(Boolean))];
    const k = clean.join(',');
    if (k === key) return;
    key = k;
    receivers.forEach((r) => r.stop());
    receivers = clean.map(makeReceiver);
  }

  const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Live status for every named channel, keyed by normalised channel name.
  function channels() {
    const out = {};
    const now = Date.now();
    for (const r of receivers) {
      for (const c of Object.values(r.st.channels)) {
        if (!c.name) continue;
        const fresh = r.st.connected && c.sampleAt && now - c.sampleAt < 10000;
        const txOn = !!c.txModel && c.txModel !== 'UNKNOWN';
        const battery = c.battPct != null ? c.battPct : c.battBars != null ? c.battBars * 20 : null;
        out[norm(c.name)] = {
          name: c.name,
          host: r.st.host,
          n: c.n,
          online: fresh,
          tx: txOn,
          txModel: txOn ? c.txModel : '',
          battery: txOn ? battery : null,
          minutes: txOn ? c.battMins : null,
          quality: c.quality,
          // RF is good when the transmitter is on and the link quality is up.
          rf: fresh && txOn && (c.quality == null || c.quality > 0),
          rssi: c.rssi,
          muted: !!c.muted,
          freq: c.freq || '',
        };
      }
    }
    return out;
  }

  function status() {
    return receivers.map((r) => ({
      host: r.st.host,
      connected: r.st.connected,
      error: r.st.connected ? '' : r.st.error,
      model: r.st.model,
      channels: Object.values(r.st.channels).filter((c) => c.name).map((c) => c.name),
    }));
  }

  return { configure, channels, status, norm };
}

module.exports = { makeShure };
