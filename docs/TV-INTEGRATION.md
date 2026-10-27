# Putting the displays on a TV

For whoever builds the launcher / OS on each TV. Every screen is a normal web
page served by the display server (the Mac) on the church network. A TV needs a
full-screen web view (Chromium/WebKit-class, with WebSockets and ES2019) pointed
at one URL. Nothing else.

Server: `http://<mac-ip>:8080` (the Mac's reserved address). Beta:
`http://192.168.10.237:8080`.

## The two ways to open a screen

**1. Let the screen pick (recommended):** open `/display`.
The first time, it asks *Where is this screen?* (location), then *which
dashboard* if that location has more than one. It remembers the choice
(localStorage) and opens straight to it on every later boot. Navigable with a
remote: arrow keys + Enter; Back returns to locations.

**2. Hard-wire it:** open `/display/<dashboard-id>` directly.

### URL options (work on both)

| Option | Meaning |
|---|---|
| `device=<id>` | A stable id for this TV (letters, numbers, dashes; ≤36). **Strongly recommended**: use the TV's serial (e.g. `device=09KY3CNN901483Y`) so the screen keeps its identity even if the web view's storage is cleared. |
| `name=<text>` | Friendly name shown in Admin → Displays, e.g. `name=FOH%20Left`. |
| `location=<slug>` | `/display` only: skip straight to that location's dashboards, e.g. `location=foh`. |
| `lock=1` | The TV's remote can't change the dashboard (R / Back / long-press do nothing). Admins can still move it from Admin → Displays. `lock=0` unlocks. |
| `choose=1` | `/display` only: show the picker even if a dashboard is already saved. |

Example launcher URLs:

```
http://<mac>:8080/display?location=foh&device=FOH-MON-1&name=FOH%20Left
http://<mac>:8080/display/dock?device=09MR3CUNA06646X&name=Dock%20TV&lock=1
```

## Locations and dashboards

`GET /api/locations` (no sign-in needed) returns the current list, so a native
launcher can draw its own menu:

```json
[
  { "name": "Broadcast Control", "slug": "broadcast-control",
    "dashboards": [ { "id": "broadcast", "name": "Broadcast Control", "url": "/display/broadcast" } ] },
  { "name": "FOH", "slug": "foh",
    "dashboards": [
      { "id": "foh", "name": "FOH · Run of Show", "url": "/display/foh" },
      { "id": "foh-wireless", "name": "FOH · Wireless & Mics", "url": "/display/foh-wireless" },
      { "id": "foh-timers", "name": "FOH · Timers & Messages", "url": "/display/foh-timers" } ] }
]
```

Locations: Broadcast (Broadcast Control, Broadcast Audio), The Dock, The
Greenroom, FOH (FOH Audio, FOH Audio Compact, Service Producer, FOH ProP,
Lighting, Lighting Compact), Stage (Stage Display) and Pre-Show (Pre-Show
Teleprompter). The two Compact dashboards are drawn for a 1920×720 bar
screen. Admins add, rename, re-locate and redesign dashboards in Admin →
Displays; the list above updates by itself.

## Rendering

- The page draws a 1920×1080 canvas and scales it to fit the window, so any
  16:9 panel works (4K is fine). Use the TV's native resolution; no zoom.
- It updates itself over a WebSocket every second and switches between
  Pre-Encounter and Live on its own. No reloads needed.
- If the server or network drops it shows *Reconnecting…* and recovers by
  itself. A launcher only needs to restart the web view if the page itself
  crashes (a 60-second watchdog reload is a reasonable safety net).
- Keep the panel awake: disable screen savers, energy saving and "no signal"
  sleep on the TV.
- No sound, no video autoplay, no pop-ups, no sign-in on display pages.

## Moving a screen later

Admin → Displays lists every screen (by `name`, last seen, IP). Changing its
dashboard there switches the TV within a second, even when locked. If the TV is
off, it switches the next time it connects.
