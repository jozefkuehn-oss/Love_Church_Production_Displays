# Setting up the dashboard TVs

Every Sunday the Mac turns the dashboard TVs on at 5:00 AM, opens the dashboard
on each one, and turns them off at 3:00 PM. Any TV can be used for something
else in between: press **Back** on its remote, then **Back** again at
*Leave the dashboard?*. At 3:00 a TV being used for something else is left on.

Everything is controlled from **Admin → Displays → TVs**: the schedule, each
TV's dashboard, **Launch now**, **Turn off**, and live status.

| TV | Model | How it shows the dashboard | Dashboard |
|---|---|---|---|
| Green Room | Samsung UN55TU8000 | LC Displays app | The Greenroom |
| The Dock (Wi-Fi) | Samsung UN65TU850D | LC Displays app | The Dock |
| Broadcast Audio | Samsung UN43TU8000 | LC Displays app | Broadcast Audio |
| Broadcast Top | TCL 48FS3750 (Roku TV) | LC Displays Roku app playing a video stream from the Mac | Broadcast Control |
| Preshow | Fire TV Stick on a monitor | Fully Kiosk Browser | Pre-/Post-Show Teleprompter |

These five are already listed in Admin → Displays → TVs. Each needs its
setup below once, then its **IP address** typed into its card.

---

## Before any TV: the network

1. **Reserve an IP address for each TV** (a DHCP reservation, same as the Mac).
   The Mac finds the TVs by IP.
2. **The Dock is on Wi-Fi.** Its Wi-Fi network must let devices talk to each
   other (no "client isolation" or guest network), or the Mac can't wake it
   or open the app. Ask David if unsure.
3. The Mac needs a reserved IP too (see SETUP.md). The TV apps are built with
   that address, so if it ever changes, rebuild the apps.

## On the Mac (once)

Install **ffmpeg**, which makes the Roku TV's video stream:

```
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install ffmpeg
```

(The first line installs Homebrew; skip it if `brew` already works.) Google
Chrome is already on the Mac from SETUP.md; the stream uses it invisibly.

---

## Samsung TVs (Green Room, The Dock, Broadcast Audio)

### On each TV

1. **Settings → General → Network → Expert Settings → Power On with Mobile: On.**
   (On some models: *IP Remote: On* as well.) This lets the Mac turn it on.
2. **Settings → General → System Manager → Time → Sleep Timer: Off**, and
   **Settings → General → Eco Solution → Auto Power Off: Off** (and
   *No Signal Power Off: Off*).
3. **Settings → General → Smart Features → Autorun Last App: On.** A backup:
   if the network wake ever fails, the TV still reopens the dashboard when
   someone turns it on.
4. Turn on **Developer Mode** so the app can be installed: open **Apps**, then
   on the remote press **1 2 3 4 5**. Turn Developer mode **On**, enter the
   **Mac's IP address** as the Host PC IP, and restart the TV (hold the power
   button until it restarts).

### Build and install the app (from the Mac, once per TV)

One-time on the Mac:

1. Install **Tizen Studio** from https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/installing-tv-sdk.html
2. In Tizen Studio's **Package Manager**, install **Samsung Certificate
   Extension** and the **TV Extensions** (Extension SDK tab).
3. In **Tools → Certificate Manager**, make a **Samsung** certificate profile
   (sign in with a free Samsung account). Name it `LoveChurch`. When it asks
   for device IDs (DUIDs), add every Samsung TV: **Tools → Device Manager**
   lists them once they're connected (Remote Device Manager → **+** → the TV's IP).

Then build and install on all three TVs at once (in the app folder):

```
bash tv/samsung/build.sh http://<mac-ip>:8080 LoveChurch <green-room-ip> <dock-ip> <broadcast-audio-ip>
```

### Finish in Admin

1. In **Admin → Displays → TVs**, type each TV's **IP address**. (Its MAC
   address fills itself in the first time the app opens.)
2. Press **Pair**, then press **Allow** on the TV with its remote. You only do
   this once per TV.
3. Press **Launch now**. The TV turns on (if it was off) and opens the
   dashboard.

> If the app opens and says *This TV isn't set up yet*, it shows its IP. A
> **New TV found** card also appears in Admin with an **Add this TV** button.

The Samsung Developer Mode stays on after restarts; the app stays installed.
A big firmware update can occasionally remove sideloaded apps. If a TV
stops opening the dashboard after an update, run the build command for it again.

---

## Roku TV (Broadcast Top)

The Roku can't run the dashboard itself, so the Mac renders it and the Roku
plays it as live video (a few seconds behind; timers keep counting smoothly).

### On the TV

1. **Settings → System → Power → Fast TV start: On.** (Lets the Mac turn it on.)
2. **Settings → System → Advanced system settings → Control by mobile apps →
   Network access: Permissive.** (Lets the Mac open the app and turn it off.)
3. Turn on **Developer mode**: on the remote press **Home ×3, Up ×2, Right,
   Left, Right, Left, Right**. Note the IP it shows, agree, set a developer
   password, and let it restart.

### Build and install (from the Mac)

```
bash tv/roku/build.sh http://<mac-ip>:8080 192.168.10.249 <developer-password>
```

It prints *Install Success*. (Or run it without the IP and password, open
`http://192.168.10.249` in a browser, sign in as `rokudev`, and upload
`tv/roku/build/LC_Displays_Roku.zip`.) The app stays installed through
restarts; Roku allows one sideloaded app at a time.

### Finish in Admin

Broadcast Top's IP is already filled in. Press **Launch now**. The stream
starts on the Mac, the TV turns on and opens the app.

---

## Fire TV Stick (Preshow)

### On the stick

1. **Settings → My Fire TV → Developer Options → Apps from Unknown Sources: On**
   (on newer sticks, first tap *About → Fire TV Stick* 7 times to reveal
   Developer Options).
2. Install the **Downloader** app from the Fire TV app store, open it and enter
   `https://www.fully-kiosk.com/fully-kiosk-browser-latest.apk` (or the Fire TV
   link on fully-kiosk.com) to install **Fully Kiosk Browser**.
3. In Fully Kiosk's settings:
   - **Web Content Settings → Start URL:** `http://<mac-ip>:8080/display?device=PRESHOW-FIRETV&name=Preshow%20Teleprompter&tv=firetv`
   - **Device Management → Launch on Boot: On**, **Keep Screen On: On**
   - **Remote Administration: On**, set a password, *Remote Admin from Local Network: On*
   - **Kiosk Mode:** leave off, so Back and Home still work
   - Buy the PLUS license (a few dollars) to remove the watermark and unlock
     Remote Administration.
4. **Settings → Preferences → Featured Content:** turn off video and audio
   autoplay. **Settings → Display & Sounds → Screensaver: Never.**

### Finish in Admin

Type the stick's **IP address** and the **Fully Kiosk password** into the
Preshow card, then **Launch now**.

The stick turns the monitor on and off over HDMI-CEC if the monitor supports
it; otherwise the monitor wakes and sleeps with the stick's signal.

---

## Day to day

- **Sunday:** nothing to do. Check **Admin → Displays → TVs** if you like:
  green = showing the dashboard; yellow = starting or retrying; red = it gave
  up after 8 tries over about 16 minutes (the message says why).
- **Change what a TV shows:** pick a different dashboard in its card (or in
  Screens). It switches within a second.
- **Change the times or days:** the Schedule card. Changes apply the same day.
- **Use a TV during the week:** Back, then Back again. To bring the dashboard
  back, open **LC Displays** from the TV's apps, or press **Launch now**.
- **Something's wrong:** **Check** refreshes a TV's status; the Mac's log is in
  `data/logs/server.log` (every launch, retry and turn-off is written there).
