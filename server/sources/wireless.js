// Mic and IEM status. Right now this runs a sample generator (batteries drain
// slowly, one IEM drops RF now and then) so the screens behave realistically.
// When the receivers and IEM transmitters are on the network, a connector for
// that gear (Shure Wireless Workbench / Sennheiser control protocol) slots in
// here and returns the same shape: { 'HH 1': { battery: 0-100, rf: true } }.

function makeWireless() {
  const state = {};
  const started = Date.now();

  function seed(channels) {
    let i = 0;
    for (const ch of channels) {
      if (!ch || ch === 'WIRED' || state[ch]) continue;
      // Deterministic spread so the same channels look the same after a restart.
      const base = [88, 76, 64, 31, 71, 18, 92, 81, 69, 58, 74, 90, 55, 83][i++ % 14];
      state[ch] = { start: base, battery: base, rf: true };
    }
  }

  function tick() {
    const minutes = (Date.now() - started) / 60000;
    for (const [ch, s] of Object.entries(state)) {
      s.battery = Math.max(3, Math.round(s.start - minutes / 3));
      // One channel blips its RF for 20 seconds every few minutes.
      s.rf = !(ch === 'IEM 8' && Math.floor(Date.now() / 20000) % 9 === 0);
    }
    return state;
  }

  return { seed, tick, state };
}

module.exports = { makeWireless };
