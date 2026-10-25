# Love Church Production Displays

Auto-updating, configurable displays for the Love Church Elkhorn South production spaces: Broadcast Control, the Dock, the Greenroom, FOH, and the stage confidence monitor. Each room has a Pre-Encounter screen and a Live screen. Leaders sign in by role and send producer messages to any screen from their phones.

**Setting up the Mac mini? Start with [SETUP.md](SETUP.md).**

## What it does

- **Planning Center:** run of show, songs, keys, item lengths and everyone scheduled, with names and roles. Refreshes every few minutes.
- **Photos for the face cards**, in this order: a photo an admin uploaded, the hand-cropped starter photos that ship with the app, Slack (optional, only if a Slack app can be added), then the person's Planning Center profile photo. Anyone with none shows first and last initials. In **Admin → People**, admins see everyone (today's plan or the full serving roster), tap a face to upload a new photo, drag and zoom to frame it with live previews of the big card, collage tile and FOH circle, or switch someone to initials. Anyone not on the roster can be added by name.
- **ProPresenter (7.9+ network API):**
  - The **auditorium** machine tracks where we are in the Encounter.
  - The **broadcast** machine feeds the graphics status box.
- **Schedule:** stream start and end times for each Encounter, which drive the stream-end countdowns and the projected finish.
- **Song bank:** Feel, progression, notes and camera cues for each song.
- **Wireless:** mic and IEM assignments by position. Mic battery (percent and runtime), transmitter on/off and RF come live from the Shure Axient Digital receivers (AD4D/AD4Q) over the network. The Lectrosonics Duet IEM packs are one-way radio, so IEMs show their assignment only. Sample values are shown until a receiver is added.
- **Producer messages:** leaders sign in by picking the role they're serving in that day (FOH Engineer, Service Producer…) and entering that role's PIN; each role has its own permissions (messages, Live control, This Sunday mics). They can target any screens, choose an urgency (info, heads-up or urgent), and set the message to clear itself or stay until cleared.

## Displays

One app runs every room. Each room has two screens:

- **Pre-Encounter:** before each Encounter and between Encounters. Countdowns to the next Encounter, who's serving, and the brief. On Broadcast Control this is the huddle.
- **Live:** during each Encounter. Run of show, timing, songs, wireless and messages.

On **Automatic** (the default), every room goes Live a few minutes before each Encounter starts and back to Pre-Encounter a few minutes after its stream ends. Set the minutes in **Admin → Schedule**. Any room can also be held on Pre-Encounter or Live in **Admin → Displays**.

**Setting up a screen:** point the TV or output at `http://<mac address>:8080/display`. The first time, it asks which room it's in. Pick with the arrow keys and Enter on a remote, or tap. After that it opens straight to that room every time.

**Changing a screen's room:** press **R** (or Escape or Back) on a keyboard or remote, or press and hold anywhere on the screen for 3 seconds. Admins can also move any screen from **Admin → Displays → Screens**, and it switches within a second.

| URL | Screen |
|---|---|
| `/display` | Room picker (remembers this screen's room) |
| `/display/broadcast` | Broadcast Control: huddle brief, then live |
| `/display/dock` | The Dock: edge-to-edge face collage |
| `/display/greenroom` | Greenroom: countdowns, worship team mics and IEMs, go-to people |
| `/display/foh` | FOH: run of show, keys, what's coming up, wireless |
| `/display/stage` | Stage confidence: countdown and first song, then slides and timers |
| `/admin` | Messages, Live position, and (admins) everything else |

Every screen is a 24×12 grid of widgets that you edit in **Admin → Displays**. You can add new rooms, such as a lobby screen or LCNO versions, from the same page.

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
  auth.js         role sign-in (shared role PINs) + admin accounts, hashed PINs, lockout
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
