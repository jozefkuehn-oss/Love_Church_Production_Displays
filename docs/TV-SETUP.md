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

Nothing to install for the Roku TV's video stream: the app brings its own
ffmpeg (installed with the app's packages; no Homebrew needed, works on older
macOS). Google Chrome must be on the Mac (see SETUP.md); the stream uses it
invisibly. If a Homebrew ffmpeg is installed, the app uses that instead.

---

## Samsung TVs (Green Room, The Dock, Broadcast Audio)

Done: The Dock (192.168.10.232) and Broadcast Audio (192.168.10.250). Tizen Studio and
the **LoveChurch** certificate are already set up on the Mac mini.

### 1. On the TV (remote)

1. **Settings → General → Network → Expert Settings → Power On with Mobile: On**
   (and **IP Remote: On** if listed). Lets the Mac turn it on.
2. **Settings → General → Eco Solution → Auto Power Off: Off** and
   **No Signal Power Off: Off**.
3. **Settings → General → Smart Features → Autorun Last App: On.**
4. Note the TV's IP: **Settings → General → Network → Network Status → IP
   Settings**. Have it reserved on the router.
5. **Developer Mode:** open **Apps** (the Apps page itself), press **123** for the
   on-screen number pad, enter **1 2 3 4 5**. Turn it **On**, Host PC IP
   **192.168.10.193**, OK. Then **hold the power button ~5 s** until the TV
   restarts by itself. Apps now shows **Developer Mode** at the top.

### 2. Check and connect (Mac mini, Terminal)

```
ping -c 4 <tv-ip>
nc -vz <tv-ip> 26101
~/tizen-studio/tools/sdb connect <tv-ip>
~/tizen-studio/tools/sdb devices
```

- ping fails: the network blocks the Mac from the TV (ask David).
- nc says *refused*: Developer Mode isn't on yet; redo step 1.5.
- `sdb devices` lists the TV's model: connected.

If Device Manager in Tizen Studio says *failed to connect* but `nc` works, run
`~/tizen-studio/tools/sdb kill-server` and connect again from Terminal.

### 3. Add the TV to the certificate (Tizen Studio, while connected)

The pencil on a certificate only changes its password; it can't add a TV. To
add one, make a **new profile** that reuses the same author certificate:

**Tools → Certificate Manager →** small **+** next to *Certificate Profile* →
**Samsung → TV** → name it the next number (**LoveChurch3**, …) → **Select an
existing author certificate** = `~/SamsungCertificate/LoveChurch/author.p12` →
sign in to Samsung → **Create a new distributor certificate**, **Public** →
check **every** TV's device ID is in the list → finish until it says *created
successfully* → select the new profile and click the **check mark**.

Check it saved: `find ~/SamsungCertificate -name "*.p12"` lists the new folder.
Use the newest profile name in step 4.

Device IDs so far: Dock **KLCPHIWA3IAY2**, Broadcast Audio **SHCMGLVRZTPGC**
(profile **LoveChurch2**).

### 4. Install the app

```
cd ~/Documents/Love_Church_Production_Displays
bash tv/samsung/build.sh http://192.168.10.193:8080 <newest profile> <tv-ip>
```

Look for **Tizen application is successfully installed**. Several TVs at once:
list their IPs after `LoveChurch`, separated by spaces (connect each with
`sdb connect` first).

### 5. Finish in Admin → Displays → TVs

On the TV's card: enter its **IP** → **Pair** (press **Allow** on the TV) →
**Launch now**. Test **Turn off** then **Launch now**, and **Back, Back** on
the remote to leave the dashboard.

### Later

- **Reinstall after app updates to the TV shell only** (tv/samsung files):
  run step 4 again. Dashboard changes don't need a reinstall; they come from
  the Mac.
- A big Samsung firmware update can remove the app. Run step 4 again.
- If the Mac mini's address ever changes, rebuild every TV app (step 4) with the
  new address.

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
