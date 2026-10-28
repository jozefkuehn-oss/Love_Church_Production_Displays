/* Samsung TV dashboard app. A thin shell: asks the display server which
   screen this TV is, then shows that screen's dashboard full screen.
   - Back on the remote: the dashboard asks "Leave the dashboard?"; Back again
     exits the app (the TV goes back to its home screen / inputs).
   - If the server or network drops, the dashboard reconnects by itself; if
     the page ever stops answering for a minute, this shell reloads it.
   - Switching away (another app or input) unloads the dashboard, so the
     server knows this TV isn't showing it and won't turn it off at 3:00. */
(function () {
  var SERVER = String(window.LCD_SERVER || '').replace(/\/$/, '');
  var frame = document.getElementById('frame');
  var panel = document.getElementById('panel');
  var titleEl = document.getElementById('title');
  var msgEl = document.getElementById('msg');
  var lastAlive = 0;
  var showing = false;
  var helloTimer = null;
  var fallbackUrl = '';

  function tryIt(fn, dflt) {
    try { return fn(); } catch (e) { return dflt; }
  }
  // Keep the TV's screen saver from kicking in over the dashboard.
  function noScreenSaver() {
    tryIt(function () {
      webapis.appcommon.setScreenSaver(webapis.appcommon.AppCommonScreenSaverState.SCREEN_SAVER_OFF);
    });
  }
  var mac = tryIt(function () { return webapis.network.getMac(); }, '');
  var model = tryIt(function () { return webapis.productinfo.getRealModel(); }, '') || tryIt(function () { return webapis.productinfo.getModel(); }, '');
  var duid = tryIt(function () { return webapis.productinfo.getDuid(); }, '');

  function say(title, msg) {
    titleEl.textContent = title;
    msgEl.innerHTML = msg || '';
    panel.hidden = false;
    frame.hidden = true;
    showing = false;
  }
  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }

  function show(url) {
    clearTimeout(helloTimer);
    lastAlive = Date.now();
    frame.src = url;
    frame.hidden = false;
    panel.hidden = true;
    showing = true;
    noScreenSaver();
    setTimeout(function () {
      tryIt(function () { frame.contentWindow.focus(); });
    }, 1500);
  }

  function hello() {
    clearTimeout(helloTimer);
    var x = new XMLHttpRequest();
    x.open('POST', SERVER + '/api/tv/hello');
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 8000;
    x.onload = function () {
      var j = tryIt(function () { return JSON.parse(x.responseText); }, null);
      if (!j) return retry();
      if (j.url) return show(j.url);
      // Not set up in Admin yet: show what to enter, keep checking, and allow
      // picking a dashboard right here instead.
      var id = 'SAM-' + (String(mac || duid || '').replace(/[^a-zA-Z0-9]/g, '').slice(-12).toUpperCase() || Date.now().toString(36));
      fallbackUrl = SERVER + '/display?device=' + encodeURIComponent(id) + '&tv=tizen';
      say('This TV isn’t set up yet',
        'In <b>Admin → Displays → TVs</b>, tap <b>Add</b> on this TV (IP <b>' + esc(j.ip || '?') + '</b>' + (mac ? ', MAC <b>' + esc(mac) + '</b>' : '') + ').<br>' +
        'Checking again every 10 seconds. Press <b>OK</b> to pick a dashboard here instead, or <b>Back</b> to exit.');
      helloTimer = setTimeout(hello, 10000);
    };
    x.onerror = x.ontimeout = retry;
    x.send(JSON.stringify({ platform: 'samsung', mac: mac, model: model, duid: duid }));
  }
  function retry() {
    say('Connecting…', 'Can’t reach the display server at <b>' + esc(SERVER) + '</b> yet. Check this TV is on the church network. Trying again every 5 seconds.');
    helloTimer = setTimeout(hello, 5000);
  }

  function start() {
    fallbackUrl = '';
    say('Starting…', '');
    hello();
  }
  function stop() {
    clearTimeout(helloTimer);
    frame.src = 'about:blank'; // closes the dashboard's connection
    showing = false;
  }
  function exit() {
    stop();
    tryIt(function () { tizen.application.getCurrentApplication().exit(); });
  }

  // From the dashboard page.
  window.addEventListener('message', function (e) {
    var d = e.data || {};
    if (d.lcd === 'alive') lastAlive = Date.now();
    else if (d.lcd === 'exit') exit();
  });
  // Watchdog: the page posts "alive" every 10 s.
  setInterval(function () {
    if (showing && Date.now() - lastAlive > 60000) {
      lastAlive = Date.now();
      start();
    }
  }, 15000);

  // Keys reach this shell only when the dashboard isn't focused.
  document.addEventListener('keydown', function (e) {
    var back = e.keyCode === 10009 || e.keyCode === 27 || e.keyCode === 8;
    if (showing) {
      tryIt(function () { frame.contentWindow.focus(); });
      if (back) {
        e.preventDefault();
        frame.contentWindow.postMessage({ lcd: 'back' }, '*');
      }
      return;
    }
    if (back) {
      e.preventDefault();
      return exit();
    }
    if ((e.keyCode === 13 || e.keyCode === 29443) && fallbackUrl) show(fallbackUrl);
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
    else start();
  });

  start();
})();
