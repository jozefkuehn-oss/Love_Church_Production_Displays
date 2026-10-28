// Samsung Tizen TVs (2016+). Uses the TV's own network remote:
//   http://<ip>:8001/api/v2/            device info, incl. PowerState on 2018+
//   http://<ip>:8001/api/v2/applications/<appId>   launch an installed app
//   wss://<ip>:8002/api/v2/channels/samsung.remote.control   remote keys
// The first remote connection makes the TV ask "Allow Love Church Displays?";
// once allowed, the TV hands back a token we keep, so it never asks again.
const WebSocket = require('ws');
const NAME = Buffer.from('Love Church Displays').toString('base64');

const timeout = (ms) => AbortSignal.timeout(ms);

async function info(tv) {
  try {
    const r = await fetch(`http://${tv.ip}:8001/api/v2/`, { signal: timeout(3000) });
    const j = await r.json();
    const d = j.device || {};
    // TVs without PowerState answer only when they're on.
    const power = d.PowerState ? (d.PowerState === 'on' ? 'on' : 'standby') : 'on';
    return { reachable: true, power, model: d.modelName || d.model || '', mac: d.wifiMac || '' };
  } catch (e) {
    return { reachable: false, power: 'off' };
  }
}

// Opens the remote channel. Resolves once the TV accepts us.
function connect(tv, onToken, waitMs = 8000) {
  return new Promise((resolve, reject) => {
    const tok = tv.token ? `&token=${encodeURIComponent(tv.token)}` : '';
    const ws = new WebSocket(`wss://${tv.ip}:8002/api/v2/channels/samsung.remote.control?name=${NAME}${tok}`, {
      rejectUnauthorized: false, // the TV uses a self-signed certificate
      handshakeTimeout: 4000,
    });
    const t = setTimeout(() => {
      ws.terminate();
      reject(new Error(tv.token ? 'The TV didn’t answer.' : 'No answer: press Allow on the TV when it asks, then try again.'));
    }, waitMs);
    ws.on('message', (buf) => {
      let m;
      try {
        m = JSON.parse(buf);
      } catch (e) {
        return;
      }
      if (m.event === 'ms.channel.connect') {
        clearTimeout(t);
        if (m.data && m.data.token && m.data.token !== tv.token) onToken(String(m.data.token));
        resolve(ws);
      } else if (m.event === 'ms.channel.unauthorized') {
        clearTimeout(t);
        ws.terminate();
        reject(new Error('The TV said no. On the TV: Settings → General → External Device Manager → Device Connection Manager, allow “Love Church Displays”, then pair again.'));
      }
    });
    ws.on('error', (e) => {
      clearTimeout(t);
      reject(new Error('Can’t reach the TV’s remote control: ' + e.message));
    });
  });
}

async function key(tv, onToken, code) {
  const ws = await connect(tv, onToken);
  ws.send(JSON.stringify({ method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: code, Option: 'false', TypeOfRemote: 'SendRemoteKey' } }));
  await new Promise((r) => setTimeout(r, 400));
  ws.close();
}

async function pair(tv, onToken) {
  const ws = await connect(tv, onToken, 30000);
  ws.close();
}

async function launch(tv, onToken) {
  if (!tv.appId) throw new Error('No app id saved for this TV.');
  // Simple REST launch first; fall back to the remote channel.
  try {
    const r = await fetch(`http://${tv.ip}:8001/api/v2/applications/${encodeURIComponent(tv.appId)}`, { method: 'POST', signal: timeout(4000) });
    if (r.ok) return;
  } catch (e) {}
  const ws = await connect(tv, onToken);
  ws.send(JSON.stringify({ method: 'ms.channel.emit', params: { event: 'ed.apps.launch', to: 'host', data: { appId: tv.appId, action_type: 'DEEP_LINK' } } }));
  await new Promise((r) => setTimeout(r, 600));
  ws.close();
}

// KEY_POWER toggles, so only press it when the TV says it's on.
async function off(tv, onToken) {
  const i = await info(tv);
  if (!i.reachable || i.power !== 'on') return;
  await key(tv, onToken, 'KEY_POWER');
}

// Woken by Wake-on-LAN; some models sit in "standby" with the network up,
// and need the power key once they answer.
async function powerOnIfStandby(tv, onToken) {
  const i = await info(tv);
  if (i.reachable && i.power === 'standby') await key(tv, onToken, 'KEY_POWER');
}

module.exports = { info, pair, launch, off, key, powerOnIfStandby };
