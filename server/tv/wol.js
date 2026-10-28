// Wake-on-LAN: sends the "magic packet" that wakes a TV from standby.
// Needs the TV's MAC address and, on the TV, its network-standby setting on
// (Samsung: Power On with Mobile / IP Remote; LG: Turn on via Wi-Fi).
const dgram = require('dgram');

function cleanMac(mac) {
  const hex = String(mac || '').replace(/[^0-9a-fA-F]/g, '');
  return hex.length === 12 ? hex.toLowerCase() : '';
}

function wake(mac, ip) {
  const hex = cleanMac(mac);
  if (!hex) return Promise.reject(new Error('No MAC address saved for this TV.'));
  const m = Buffer.from(hex, 'hex');
  const pkt = Buffer.alloc(102, 0xff);
  for (let i = 0; i < 16; i++) m.copy(pkt, 6 + i * 6);
  // Send to the general broadcast address and, when we know the TV's IP, to
  // its /24 subnet broadcast too (some switches drop one or the other).
  const targets = ['255.255.255.255'];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip || '')) targets.push(ip.replace(/\.\d+$/, '.255'));
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    sock.on('error', () => {});
    sock.bind(() => {
      sock.setBroadcast(true);
      let left = targets.length * 2;
      const done = () => --left <= 0 && (sock.close(), resolve());
      for (const t of targets) for (const port of [9, 7]) sock.send(pkt, port, t, done);
    });
  });
}

module.exports = { wake, cleanMac };
