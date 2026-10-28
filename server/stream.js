// Video streams for TVs that can't run the dashboard themselves (the Roku TVs).
// For each one, the Mac opens the dashboard in an invisible Chrome window,
// grabs its picture through Chrome's DevTools screencast and hands the frames
// to ffmpeg, which writes an HLS stream to data/streams/<tv>/. The Roku app
// plays /streams/<tv>/index.m3u8.
//
// Needs Google Chrome (already required for the Mac's own screens) and ffmpeg
// (brew install ffmpeg). A stream starts when its TV is launched (by the
// schedule, Admin, or the Roku app itself) and stops after 10 minutes with
// nobody watching.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');
const { DATA_DIR } = require('./store');

const STREAM_DIR = path.join(DATA_DIR, 'streams');
const FPS = 10; // dashboards change once a second; 10 fps keeps timers smooth and the Mac cool
const IDLE_MS = 10 * 60 * 1000;

function firstExisting(list) {
  for (const p of list) {
    if (!p) continue;
    if (p.includes('/')) {
      if (fs.existsSync(p)) return p;
    } else {
      try {
        return execFileSync('/usr/bin/env', ['which', p], { encoding: 'utf8' }).trim() || null;
      } catch (e) {}
    }
  }
  return null;
}

function makeStreams({ config, log, port }) {
  const streams = new Map(); // tv id -> state

  const chromePath = () =>
    firstExisting([
      config.data.chromePath,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      'google-chrome',
      'chromium',
      'chromium-browser',
    ]);
  // ffmpeg comes with the app (the ffmpeg-static package, installed by npm),
  // so no Homebrew is needed; a Homebrew or hand-installed one also works.
  let bundled = null;
  try { bundled = require('ffmpeg-static'); } catch (e) {}
  const ffmpegPath = () => firstExisting([config.data.ffmpegPath, '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', bundled, 'ffmpeg']);
  // Apple's hardware encoder keeps CPU use tiny on the Mac mini; fall back to
  // the software one if this ffmpeg doesn't have it.
  const hasEnc = new Map();
  function ffmpegHas(enc) {
    const bin = ffmpegPath();
    const k = bin + '|' + enc;
    if (!hasEnc.has(k)) {
      let out = '';
      try { out = require('child_process').spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8', timeout: 10000 }).stdout || ''; } catch (e) {}
      hasEnc.set(k, out.includes(enc));
    }
    return hasEnc.get(k);
  }
  const encoder = () => config.data.streamEncoder || (process.platform === 'darwin' && ffmpegHas('h264_videotoolbox') ? 'h264_videotoolbox' : 'libx264');

  function ffmpegArgs(dir) {
    const enc = encoder();
    return [
      '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', // silent audio: some players want an audio track
      '-map', '0:v', '-map', '1:a',
      '-c:v', enc,
      ...(enc === 'libx264' ? ['-preset', 'veryfast', '-tune', 'stillimage'] : ['-realtime', '1']),
      '-b:v', '4M', '-maxrate', '5M', '-bufsize', '8M',
      '-pix_fmt', 'yuv420p', '-r', String(FPS),
      '-force_key_frames', 'expr:gte(t,n_forced*2)',
      '-c:a', 'aac', '-b:a', '64k',
      '-f', 'hls', '-hls_time', '2', '-hls_list_size', '6',
      '-hls_flags', 'delete_segments+independent_segments+omit_endlist',
      '-hls_segment_filename', path.join(dir, 'seg%05d.ts'),
      path.join(dir, 'index.m3u8'),
    ];
  }

  function cleanDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true });
  }

  // Talks to the invisible Chrome over the DevTools protocol.
  async function openPage(st, url) {
    const browserWs = await new Promise((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('Chrome didn’t start.')), 20000);
      st.chrome.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) {
          clearTimeout(t);
          resolve(m[1]);
        }
      });
      st.chrome.on('exit', () => reject(new Error('Chrome closed while starting.')));
    });
    const devPort = new URL(browserWs).port;
    let target;
    for (let i = 0; i < 20 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json();
        target = list.find((t) => t.type === 'page');
      } catch (e) {}
      if (!target) await new Promise((r) => setTimeout(r, 300));
    }
    if (!target) throw new Error('Chrome opened no page.');
    const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
    st.cdp = ws;
    let nextId = 1;
    const send = (method, params = {}) => ws.send(JSON.stringify({ id: nextId++, method, params }));
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    ws.on('message', (raw) => {
      let m;
      try {
        m = JSON.parse(raw);
      } catch (e) {
        return;
      }
      if (m.method === 'Page.screencastFrame') {
        st.frame = Buffer.from(m.params.data, 'base64');
        st.lastFrameAt = Date.now();
        send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
      }
    });
    ws.on('close', () => st.wanted && restart(st, 'Chrome connection closed'));
    send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    send('Page.enable');
    send('Page.navigate', { url });
    send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    // Screencast only sends frames when something changes. Nudge it every few
    // seconds so a frozen-looking page still gets fresh frames.
    st.nudge = setInterval(() => send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 }), 30000);
  }

  function kill(st) {
    clearInterval(st.feed);
    clearInterval(st.nudge);
    try {
      st.cdp && st.cdp.close();
    } catch (e) {}
    for (const p of [st.chrome, st.ffmpeg]) {
      try {
        p && !p.killed && p.kill('SIGKILL');
      } catch (e) {}
    }
    st.chrome = st.ffmpeg = st.cdp = null;
    st.running = false;
  }

  function restart(st, why) {
    if (st.restarting) return;
    st.restarting = true;
    st.error = why;
    log(`Stream ${st.id}: ${why}, restarting in 5 s`);
    kill(st);
    setTimeout(() => {
      st.restarting = false;
      if (st.wanted) launch(st).catch((e) => (st.error = e.message));
    }, 5000);
  }

  async function launch(st) {
    const chrome = chromePath();
    const ffmpeg = ffmpegPath();
    if (!chrome) throw new Error('Google Chrome isn’t installed on this Mac.');
    if (!ffmpeg) throw new Error('ffmpeg isn’t installed on this Mac (Terminal: brew install ffmpeg).');
    const dir = path.join(STREAM_DIR, st.id);
    cleanDir(dir);
    st.error = '';
    st.frame = null;
    st.since = Date.now();
    const userDir = path.join(os.tmpdir(), 'lcd-stream-' + st.id);
    st.chrome = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
      '--no-first-run', '--no-default-browser-check', '--disable-extensions',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--window-size=1920,1080', '--force-device-scale-factor=1',
      '--remote-debugging-port=0', `--user-data-dir=${userDir}`, 'about:blank',
    ]);
    st.chrome.on('exit', () => st.wanted && st.running && restart(st, 'Chrome stopped'));
    st.ffmpeg = spawn(ffmpeg, ffmpegArgs(dir));
    let ffErr = '';
    st.ffmpeg.stderr.on('data', (d) => (ffErr = (ffErr + d).slice(-500)));
    st.ffmpeg.stdin.on('error', () => {});
    st.ffmpeg.on('exit', () => st.wanted && st.running && restart(st, 'ffmpeg stopped' + (ffErr ? ': ' + ffErr.trim() : '')));
    st.running = true;
    const q = new URLSearchParams({ device: st.id, name: st.name || st.id, lock: '1' });
    await openPage(st, `http://127.0.0.1:${port}/display/${encodeURIComponent(st.profile)}?${q}`);
    // Feed ffmpeg a steady frame rate from whatever Chrome last painted.
    st.feed = setInterval(() => {
      if (st.frame && st.ffmpeg && st.ffmpeg.stdin.writable) st.ffmpeg.stdin.write(st.frame);
    }, 1000 / FPS);
    log(`Stream ${st.id}: started (${st.profile})`);
  }

  async function start(id, profile, name) {
    let st = streams.get(id);
    if (!st) streams.set(id, (st = { id }));
    st.profile = profile;
    st.name = name;
    st.wanted = true;
    st.lastWatched = Date.now();
    if (st.running || st.restarting) return status(id);
    try {
      await launch(st);
    } catch (e) {
      st.error = e.message;
      kill(st);
      throw e;
    }
    return status(id);
  }

  function stop(id) {
    const st = streams.get(id);
    if (!st) return;
    st.wanted = false;
    kill(st);
    log(`Stream ${id}: stopped`);
  }

  // Called whenever a TV fetches its playlist or a segment.
  function watched(id) {
    const st = streams.get(id);
    if (st) st.lastWatched = Date.now();
  }

  function ready(id) {
    return fs.existsSync(path.join(STREAM_DIR, id, 'index.m3u8'));
  }

  function status(id) {
    const st = streams.get(id);
    if (!st) return { running: false };
    return { running: !!st.running, ready: ready(id), since: st.since || null, error: st.error || '', lastFrameAt: st.lastFrameAt || null };
  }

  setInterval(() => {
    for (const st of streams.values()) if (st.wanted && Date.now() - (st.lastWatched || 0) > IDLE_MS) stop(st.id);
  }, 60000);
  for (const sig of ['exit', 'SIGINT', 'SIGTERM'])
    process.on(sig, () => {
      for (const st of streams.values()) kill(st);
      if (sig !== 'exit') process.exit(0);
    });

  return { start, stop, watched, status, ready, STREAM_DIR };
}

module.exports = { makeStreams, STREAM_DIR };
