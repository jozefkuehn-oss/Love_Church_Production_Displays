# Love Church Production Displays — project notes for Claude

Read this first. It's the hand-off from the sessions that built the app (Oct 2026),
so a new session (for example, on the church's Claude account) starts with the context.

## Who and what

- **Owner/designer:** Jozef Kuehn, Broadcast Director, Love Church Elkhorn South (LCES).
  David is the Technical Director. Jozef keeps overall admin in the app and that must
  never be changeable: his account has `owner: true` and the server refuses edits,
  demotion, PIN changes or removal of the owner by anyone (see `server/auth.js`). Keep it that way.
- **What it is:** a self-hosted, auto-updating dashboard app for the church's
  production TVs, like MxU. A Node/Express + WebSocket server on a **Mac mini**
  (`192.168.10.193:8080`, reserve this address) pushes a snapshot every second to
  every screen. TVs open `/display` and the control app is `/admin`.
- **Weekly gatherings** are called **Encounters** (Sunday 8:30 / 10:00 / 11:45; the
  11:45 isn't streamed but is sometimes recorded). **Event nights** (REV Rally,
  All-In Leadership Night, VALOR, AGAPE) run like a service but aren't streamed.

## How Jozef works (please follow)

- He is precise and iterative and designs layouts in a mock **builder** (an artifact,
  see "Tools outside the repo"), then sends them back to be applied. Apply his
  layouts exactly.
- **Nothing may be cut off** on a screen (wireless list, worship direction, song
  text, run of show). Blocks scale or reflow; the live run of show stays windowed.
- **Time of day is always hh:mm:ss.**
- Song **Feel** text always **starts with the tempo**.
- Use PCO's names and order for positions (e.g. PCO "Video Director" = TECHNICAL DIRECTOR).
- Explain in plain words; he's not a developer but runs the Terminal steps you give.
  Commands must be copy-paste ready with real values (no `<placeholders>`; zsh
  breaks on `<`).
- **Never save, commit or repeat credentials or PINs** pasted in chat. PCO
  client ID and secret are typed into Admin → Settings on the Mac; PINs into the app.

## Run, test, ship

```
npm install
node server/index.js            # http://localhost:8080  (data in ./data)
LCD_DATA_DIR=/tmp/x PORT=8099 node server/index.js   # throwaway test instance
```

- Sample mode (built-in Oct 25 plan + demo clock) runs without Planning Center.
- **Updates are not automatic.** After you push to `main`, Jozef runs
  `bash scripts/update.sh` on the Mac (or Admin → Settings → Update). It backs up
  `data/`, downloads the zip from GitHub, runs `npm install` and restarts the
  launchd service. `data/` (settings, PINs, photos, layouts he changed) is never
  touched. See UPDATING.md.
- Check old TV browsers: TV pages are rewritten for old JS at serve time
  (`server/legacy.js`, esbuild target chrome58). Still avoid CSS that old browsers
  lack, like `inset` and flex `gap`. The oldest TV is a 2016 Fire TV Stick (Chrome 59);
  the Samsungs are Tizen 5.5 (Chrome 69).
- Commit with clear messages and push to `main`.

## Layout of the code

- `server/index.js`: Express routes, WebSocket, **migrations** (gated by
  `db.data.profilesVersion` (now 14), `rolesVersion` (5) and config flags; newer migrations must run
  after older ones), `sendTo()` (picks each screen's layout; midweek swap).
- `server/engine.js`: the snapshot: Encounters, phases (pre → preshow → live),
  live item (follows FOH ProPresenter by presentation name, or manual), item
  remaining, subs, recording, rehearsal clock, midweek, event nights, photos.
- `server/defaults.js`: default dashboards (`w(id,type,x,y,w,h,opts)` on a 24×12 grid,
  8 rows for Compact 1920×720), roles and permissions, `LAYOUT_REVISIONS` (bump a key to push a
  re-designed default layout to existing installs once).
- `public/widgets.js`: every widget (`W.<type>`), plus `fitBox` (scale to fit).
  `public/admin.js` is the control app; `WIDGETS` + `WIDGET_DESC` describe the
  widgets for the layout editor. **Add a description for any new widget.**
- `server/sources/`: `pco.js` (Planning Center Services; paced under 100 req/20 s,
  retries 429), `propresenter.js` (FOH = auditorium `192.168.10.204:51090`;
  `/v1/status/slide` returns empty there, so slide text comes from the active
  presentation + slide index), `shure.js`/`wireless.js` (mic/IEM RF + battery),
  `photocache.js`, `ghphotos.js`, `slack.js` (unused: no Slack app token).
- `server/tvs.js`, `server/tv/*`, `tv/`, `server/stream.js`: the TV layer (power,
  launch, Sunday 5:00–15:00 schedule) and TV apps. See docs/TV-SETUP.md.

## Screens (all run independently over the network; nothing via the switcher)

| TV | Device | How | Dashboard |
|---|---|---|---|
| Broadcast Top | TCL 48FS3750 Roku TV `.249` | Roku app plays an HLS stream the Mac renders (headless Chrome + bundled ffmpeg) | Broadcast Control |
| Broadcast Audio | Samsung UN43TU8000 `.250` | Tizen app (LC Displays) | Broadcast Audio |
| The Dock (Wi-Fi) | Samsung UN65TU850D `.232` | Tizen app | The Dock |
| Green Room | Samsung UN55TU8000 | Tizen app (**not set up yet**) | The Greenroom |
| Pre-/Post-Show | 2016 Fire TV Stick + Dell monitor | Fully Kiosk 1.59.2 (last for Android 5) | Pre-/Post-Show Teleprompter |

Samsung signing: Tizen Studio is on the Mac. A certificate's distributor device-ID list
can't be edited: make a new profile (LoveChurch2, 3…) reusing
`~/SamsungCertificate/LoveChurch/author.p12` and list **every** TV's DUID
(Dock `KLCPHIWA3IAY2`, Broadcast Audio `SHCMGLVRZTPGC`). Current profile: **LoveChurch2**.

## Features and decisions (don't undo without asking)

- **Dashboards** (locations): Broadcast (Broadcast Control, Broadcast Audio), The Dock,
  The Greenroom, FOH (FOH Audio, FOH Audio Compact, Service Producer, FOH ProP,
  Lighting, Lighting Compact), Stage (Stage Display), Pre-/Post-Show (Teleprompter),
  plus the shared **Midweek** dashboard (`location: '_Midweek'`, hidden from the room picker).
  Designed so far: Broadcast Control, Broadcast Audio, The Dock, The Greenroom,
  Teleprompter, FOH Audio, Midweek. **FOH ProP** (`foh`) was designed by Jozef in the
  control app, so its layout lives only in the Mac's `data/`. Never bump
  `LAYOUT_REVISIONS` for `foh.*` (that would overwrite his layout); ask him for a copy
  (Displays → export, or read it from his data) if the defaults should match.
- **Face cards** follow PCO teams/positions; looks per block (portrait / badge / round / fill);
  names never cover faces.
- **Speaking mics** HH-1, HH-2, TEACH, BP-1, BP-2: only assigned ones show; several handed
  out back to back combine into one MIC CHANGE banner.
- **Messages** clear after 1 minute by default.
- **Permissions** are tiers per role, editable by admins in Admin → Permissions. FOH Audio =
  messages + all mics/IEMs + speaking mics; producers more; Recording the 11:45 =
  Broadcast Producer; Rehearsal = admins.
- **Rehearsal mode** (admin): runs the Sunday clock midweek for testing.
- **Recording the 11:45**: Cams 1–3, Broadcast ProP, Broadcast Audio, Broadcast Producer
  stay; from the last worship song before the Message through Post Host;
  Broadcast Control/Audio skip Preshow.
- **Subs**: per Encounter or all day, pick a team first; suggestions are people PCO has
  in that position first, then the team. Communicators are narrower (hosts ↔ hosts only, else
  that exact position).
- **Photos**: order is uploaded (Admin → People) → Slack → Planning Center (hourly) for
  anyone without Slack; per person "Use their Planning Center photo instead". The Mac has
  **no Slack token**; Slack photos come from a **weekly scheduled Claude task** (Sat 4:13 PM
  Central) that uses the Slack connector and `scripts/slack_photos.py`, pushes to
  `server/seed/photos` + `server/seed/slack-photos.json`, and the Mac pulls changes from
  GitHub hourly (`ghphotos.js`). If the account changes, recreate that task.
- **Song bank**: 42 songs imported from the Broadcast Notes song repository (Admin → Songs).
- **Message notes** widget (for FOH ProP): PCO Message item's Details, or typed on the
  Live page; highlights and scrolls to the paragraph matching the ProPresenter slide.
- **Midweek** (Mon–Sat, no Encounter that day, no rehearsal): every TV shows the
  Midweek dashboard: This week (Services plans for this campus, next 7 days; PCO Calendar
  too if the PCO login is allowed to read it), clock/date, announcements (Live page), messages.
- **Event nights**: if a plan for REV 380989, All-In 1367267, VALOR 1718542 or AGAPE
  1207771 (Settings list) is dated today, screens run that plan, unstreamed, Live until
  PCO's end time, and "Encounter" labels become the event name.
- Sunday Encounters service type: **427029** (`ES | Sunday Encounters`). LCNO = the
  North Omaha campus (excluded).

## Still to do

- Design dashboards: FOH Audio Compact, Service Producer, Lighting, Lighting Compact,
  Stage Display.
- Set up the Green Room Samsung (new certificate profile with all three DUIDs).
- Band call time (default 4 min before start): Jozef to confirm.
- Watch the first real event night (VALOR) and the first real midweek day.
- Moving to the church's Claude account: connect PCO + Slack there, give it GitHub
  access (or transfer this repo to a church org and update the repo address in
  `scripts/update.sh`, `server/index.js` (version check) and `server/sources/ghphotos.js`),
  recreate the weekly photo task, delete the old one.

## Tools outside the repo (from the earlier sessions)

The mock **Dashboard Builder**, the read-only **Dashboard Review** (+ PDF) and the
interactive **Control App Demo** were Claude artifacts in Jozef's personal account.
They aren't in the repo. If they're needed again, rebuild from `public/widgets.js` +
`public/display.css` and the profiles in `server/defaults.js`.
