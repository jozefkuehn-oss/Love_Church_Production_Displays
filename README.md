# Love Church Production Displays

Auto-updating, configurable displays for the Love Church Elkhorn South production spaces: Broadcast Control (huddle and live), the Dock, the Greenroom, FOH, and the stage confidence monitor. Leaders send producer messages to any screen from their phones.

**Setting up the Mac mini? Start with [SETUP.md](SETUP.md).**

## What it does

- **Planning Center:** run of show, songs, keys, item lengths and everyone scheduled, with names and roles. Refreshes every few minutes.
- **Slack:** profile photos for the face cards. Hand-cropped starter photos ship with the app, and admins can upload and frame replacements.
- **ProPresenter (7.9+ network API):**
  - The **auditorium** machine tracks where we are in the Encounter.
  - The **broadcast** machine feeds the graphics status box.
- **Schedule:** stream start and end times for each Encounter, which drive the stream-end countdowns and the projected finish.
- **Song bank:** Feel, progression, notes and camera cues for each song.
- **Wireless:** mic and IEM assignments by position, with battery and RF status. These are sample values until the receivers are connected.
- **Producer messages:** each leader signs in with their own name and PIN. They can target any screens, choose an urgency (info, heads-up or urgent), and set the message to clear itself or stay until cleared.

## Displays

| URL | Screen |
|---|---|
| `/display/broadcast` | Broadcast Control: Huddle before the switch time, Live after |
| `/display/dock` | The Dock: edge-to-edge face collage |
| `/display/greenroom` | Greenroom: timers, worship team mics and IEMs, go-to people |
| `/display/foh` | FOH: timing, run of show, what's coming up, set keys, wireless |
| `/display/stage` | Stage confidence: current and next slide, timers, messages |
| `/display` | List of all displays |
| `/admin` | Messages, Live position, and (admins) everything else |

Every display is a 24×12 grid of widgets that you edit in **Admin → Displays**. You can add new displays, such as a lobby screen or LCNO versions, from the same page.

## Running it

```
npm install
npm start          # http://localhost:8080
```

Everything the app stores (settings, credentials, accounts, messages, song bank, uploaded photos, logs) lives in `./data`, which git ignores.

## Layout of the code

```
server/
  index.js        HTTP + WebSocket server, all API routes
  engine.js       works out the live state every second (Encounter, item, timers, people)
  defaults.js     starting settings and the six starting display layouts
  auth.js         leader/admin logins (name + PIN, hashed)
  store.js        JSON-file storage in ./data
  time.js         time-zone-safe clock (demo clock in sample mode)
  sources/        Planning Center, Slack, ProPresenter, wireless connectors
  seed/           sample plan + song bank + starter photos
public/
  display.*       the display client
  widgets.js      every widget a display can show
  admin.*         admin + leader page
scripts/          Mac mini install, screen launcher, updater
```
