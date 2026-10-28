// Roku TVs (the TCLs). Uses Roku's External Control Protocol on port 8060.
// On the TV: Settings → System → Advanced system settings → Control by mobile
// apps → Network access: Permissive (or Enabled), and Settings → System →
// Power → Fast TV start: On (so it can be turned on over the network).
const timeout = (ms) => AbortSignal.timeout(ms);
const base = (tv) => `http://${tv.ip}:8060`;

async function post(tv, path) {
  const r = await fetch(base(tv) + path, { method: 'POST', signal: timeout(4000) });
  if (r.status === 403) throw new Error('The Roku refused. Set Control by mobile apps → Network access to Permissive.');
  if (!r.ok) throw new Error(`The Roku answered ${r.status}.`);
}

async function info(tv) {
  try {
    const r = await fetch(base(tv) + '/query/device-info', { signal: timeout(3000) });
    const x = await r.text();
    const tag = (n) => (x.match(new RegExp(`<${n}>([^<]*)</${n}>`)) || [])[1] || '';
    const mode = tag('power-mode'); // PowerOn, DisplayOff, Ready, Headless
    let app = '';
    try {
      const a = await (await fetch(base(tv) + '/query/active-app', { signal: timeout(3000) })).text();
      app = (a.match(/<app[^>]*id="([^"]*)"/) || [])[1] || '';
    } catch (e) {}
    return { reachable: true, power: mode === 'PowerOn' ? 'on' : 'standby', model: tag('model-name'), mac: tag('ethernet-mac') || tag('wifi-mac'), app, dashboard: app === 'dev' };
  } catch (e) {
    return { reachable: false, power: 'off' };
  }
}

const wake = (tv) => post(tv, '/keypress/PowerOn');
// The sideloaded app is always id "dev". The stream address goes along so
// the app knows which picture to play.
const launch = (tv, params) => post(tv, '/launch/dev?' + new URLSearchParams(params || {}).toString());
const off = (tv) => post(tv, '/keypress/PowerOff');

module.exports = { info, wake, launch, off };
