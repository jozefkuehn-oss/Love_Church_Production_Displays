// Time helpers that always work in the church's time zone, whatever time zone
// the Mac itself is set to. In sample mode the clock is a demo clock that
// starts at a chosen time on the sample Sunday and runs forward from there.

function parts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'long',
  });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    y: +p.year,
    mo: +p.month,
    d: +p.day,
    h: +p.hour,
    mi: +p.minute,
    s: +p.second,
    weekday: p.weekday,
    dateKey: `${p.year}-${p.month}-${p.day}`,
  };
}

// Epoch ms for a wall-clock time ("HH:MM") on a date ("YYYY-MM-DD") in tz.
function zoned(dateKey, hhmm, tz) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const [h, mi] = String(hhmm).split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi || 0, 0);
  // How far tz is from UTC at that moment, then correct (twice for DST edges).
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const p = parts(ms, tz);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    ms += guess - asUtc;
  }
  return ms;
}

function makeClock(config) {
  const startedAt = Date.now();
  let demoBase = null;
  return {
    setDemo(dateKey) {
      demoBase = zoned(dateKey, config.data.demoStart || '10:18', config.data.timezone);
    },
    now() {
      if (config.data.sampleMode && demoBase) {
        // Loop the demo every 4 hours so it never runs off the end of Sunday.
        return demoBase + ((Date.now() - startedAt) % (4 * 3600e3));
      }
      return Date.now();
    },
    tz() {
      return config.data.timezone;
    },
  };
}

module.exports = { parts, zoned, makeClock };
