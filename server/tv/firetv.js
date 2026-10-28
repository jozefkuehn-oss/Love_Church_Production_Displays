// Fire TV Stick running Fully Kiosk Browser, controlled through Fully's
// Remote Administration (Fully → Settings → Remote Administration: on, with a
// password; it listens on port 2323).
const timeout = (ms) => AbortSignal.timeout(ms);

async function cmd(tv, c, extra = {}) {
  const q = new URLSearchParams({ cmd: c, type: 'json', password: tv.password || '', ...extra });
  const r = await fetch(`http://${tv.ip}:2323/?${q}`, { signal: timeout(4000) });
  const t = await r.text();
  let j = {};
  try {
    j = JSON.parse(t);
  } catch (e) {}
  if (j.status === 'Error' || /wrong password/i.test(t)) throw new Error('Fully Kiosk refused: check the Remote Administration password.');
  return j;
}

async function info(tv) {
  try {
    const j = await cmd(tv, 'deviceInfo');
    const on = j.isScreenOn !== false && j.screenOn !== false;
    return { reachable: true, power: on ? 'on' : 'standby', model: j.deviceModel || 'Fire TV', mac: j.mac || '', dashboard: on };
  } catch (e) {
    return { reachable: false, power: 'off' };
  }
}

const wake = (tv) => cmd(tv, 'screenOn');
const launch = async (tv, url) => {
  await cmd(tv, 'screenOn');
  await cmd(tv, 'toForeground');
  await cmd(tv, 'loadURL', { url });
};
const off = (tv) => cmd(tv, 'screenOff');

module.exports = { info, wake, launch, off };
