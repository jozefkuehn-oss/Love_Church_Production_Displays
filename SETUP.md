# Setting up the Mac mini

Step by step, start to finish. Plan on about an hour the first time. Anything in a grey box gets typed into **Terminal** (Applications → Utilities → Terminal), then press Return.

---

## Beta: try it on the broadcast Mac first

You can run the app on the broadcast ProPresenter Mac (192.168.10.237) before the Mac mini arrives. Beta mode runs only the display server, in a Terminal window: nothing starts at login, no windows open on that Mac's screens, and closing the window stops it completely. ProPresenter and Companion aren't touched (Companion uses port 8000; the app uses 8080).

1. Install **Node.js** (LTS) from https://nodejs.org if it isn't there yet.
2. Get the app: in GitHub Desktop, **File → Clone Repository** → `Love_Church_Production_Displays` → **Documents** → **Clone**. (Or on github.com: **Code → Download ZIP** and unzip it into Documents.)
3. In Terminal:
   ```
   cd ~/Documents/Love_Church_Production_Displays
   bash scripts/beta-mac.sh
   ```
4. It prints the addresses, e.g. `http://192.168.10.237:8080/admin`. Open that on your phone, create your admin account, then follow steps 4–9 below. Open `/display` on any TV or laptop to pick a room.
5. To update the beta: stop it (Control-C), **Fetch/Pull** in GitHub Desktop, run step 3 again.

When the Mac mini is ready, copy the beta's `data` folder into the Mac mini's copy of the app before running the installer. Your settings, PINs, mic assignments and uploaded photos come with it.

## 1. Prepare the Mac

1. **Sign in to the Mac** with the account that will run the displays. A dedicated account like "Production Displays" keeps it simple.
2. **Log in automatically:** System Settings → Users & Groups → *Automatically log in as* → choose that account. (If FileVault is on, macOS won't allow this. Turn FileVault off on this Mac or skip this step.)
3. **Never sleep, and come back after a power cut.** Paste this into Terminal and enter the Mac's password when asked:
   ```
   sudo pmset -a sleep 0 displaysleep 0 disksleep 0 autorestart 1 womp 1
   ```
4. **Fixed address on the network:** ask David to reserve an IP address for this Mac (a DHCP reservation). Leaders' phones and the TVs always find it at the same address.
5. **Install three apps:**
   - **Node.js** (LTS) from https://nodejs.org: download the macOS installer and run it.
   - **Google Chrome** from https://www.google.com/chrome. It shows the displays full screen.
   - **GitHub Desktop** from https://desktop.github.com. Sign in with the GitHub account that owns the repo.

## 2. Get the app onto the Mac

1. In GitHub Desktop: **File → Clone Repository** → choose `Love_Church_Production_Displays` → set *Local Path* to your **Documents** folder → **Clone**.
2. In Terminal:
   ```
   cd ~/Documents/Love_Church_Production_Displays
   bash scripts/install-mac.sh
   ```
   At the end it prints the admin address, for example `http://192.168.1.40:8080/admin`. Write it down.

The display server now starts by itself every time the Mac logs in, and restarts itself if it ever stops.

## 3. First sign-in

1. On your phone (on church Wi-Fi), open the admin address.
2. It asks you to **create the first admin account**: your name, your name as it appears in Planning Center, and a 4–8 digit PIN.
3. Everything starts in **Sample mode**, using the Oct 25 plan and a demo clock, so you can look around before connecting anything.

## 4. Connect Planning Center

A Planning Center **organization admin** does this part.

1. Go to https://api.planningcenteronline.com/oauth/applications while signed in to Planning Center.
2. Under **Personal Access Tokens**, click **New Personal Access Token**. Name it "Production Displays".
3. Copy the **Client ID** (also called Application ID) and the **Secret** (it starts with `pco_pat_`). The Secret is only shown once.
4. In the admin page: **Settings → Planning Center**, paste both, and check the **Service type ID** (Sunday Encounters is `427029`).
5. Turn **Sample mode** off and click **Save settings**. **Status** at the top of Settings should say *Planning Center: Connected*.

The app only reads from Planning Center. It never changes anything there.

## 5. Connect Slack photos

Your Slack workspace admin approves this.

1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**. Name it "Production Displays" and pick the Love Church workspace.
2. Left menu: **OAuth & Permissions** → *Bot Token Scopes* → **Add an OAuth Scope** → `users:read`.
3. Top of that page: **Install to Workspace** → **Allow** (or send the request to your Slack admin).
4. Copy the **Bot User OAuth Token**. It starts with `xoxb-`.
5. Admin page → **Settings → Slack photos** → paste it → **Save settings**.

Photos download once and are kept on the Mac, so the screens don't depend on Slack during an Encounter. The hand-cropped starter photos that ship with the app are used first. Fix anyone else in **People**: tap their face, upload a better headshot, drag and zoom to frame it, or switch to initials. Use **Everyone** to reach people who aren't on today's plan, and **Add someone** for new volunteers.

## 6. Connect ProPresenter

Do this on **both** ProPresenter machines (auditorium and broadcast):

1. ProPresenter → **Settings → Network** → turn on **Enable Network**.
2. Note the **IP address** and **Port** shown there.
3. Admin page → **Settings → ProPresenter** → tick the machine, enter its IP and port → **Save settings**.

Both machines are already filled in: **auditorium 192.168.10.204, port 51090** and **broadcast 192.168.10.237, port 65181**. Keep those ports fixed in ProPresenter so they don't change after a restart. If one ever stops connecting, check its port here first.

- The **auditorium** machine tells every screen where we are in the Encounter. When the operator moves to the next song, every display follows.
- The **broadcast** machine feeds the *Broadcast graphics* box on the Broadcast Control screen.
- If ProPresenter is closed or unreachable, the screens fall back to planned timing. A leader can also set the position by hand from the **Live** tab.
- The auditorium playlist is built by hand each week, so presentations are matched to Planning Center items by name. Songs usually match on their own. If the **Live** tab says "Not matched", pick the plan item it belongs to. That link is saved for future Sundays. Keeping presentation names close to the Planning Center item names makes this almost automatic.

## 6b. Connect the wireless mic receivers

The Shure Axient Digital receivers (the AD4D and the two AD4Qs in the wireless rack) report each transmitter's battery, runtime and RF over the network.

1. On each receiver, open **Menu → Network** and note its IP address. It must be on the same network as the Mac. A fixed (static or reserved) address is best so it doesn't change.
2. Admin page → **Wireless → Mic receivers** → add each receiver's IP → **Save receivers**. Each one should turn green within a few seconds and list its channel names (VOX-4, VOX-5…).
3. Under **Assignments**, type each position's mic as the receiver channel name. The mic box suggests the names it found.

The IEMs (Lectrosonics M2T transmitters and M2Ra packs) are one-way radio: the belt packs can't report their battery back, so the screens show IEM assignments without a battery bar.

## 7. Get the screens onto the TVs

There are two ways a TV shows a dashboard:

**Through the switcher / hub (Green Room, Broadcast Bottom, Broadcast Audio, the multiview).** Connect the Mac mini's HDMI outputs to the switcher as sources and route them like any other feed. `scripts/screens.conf` says which room opens on which output (copy `screens.example.conf`): output 1 = Broadcast Control, output 2 = Green Room. Check how many displays your Mac mini model supports (Apple → About This Mac → More Info → Displays); a model with three outputs can add a third room.

**Independent TVs (the Dock, Broadcast Top).** These aren't fed by the switcher, and neither an Apple TV nor a Roku TV can run a web page. Plug a small browser box into the TV's HDMI:
- an Android-based streaming stick (for example a Fire TV Stick) with a kiosk browser app such as Fully Kiosk Browser set to open `http://<mac>:8080/display` at start-up, or
- a Raspberry Pi set to open Chromium full screen at that address.
The first time it opens, pick the room on the screen. It remembers it, and you can move it later from **Displays → Screens**.

The TVs' own web browsers (Samsung Internet, LG webOS) can open the address for a quick test, but they go to sleep and don't reopen it after a power cut, so don't rely on them every Sunday.

## 8. Set the role PINs

Leaders don't need their own accounts. When they open the producer page (`http://<mac>:8080/admin`) on their phone, they pick the role they're serving in that day and enter that role's PIN. They stay signed in until midnight.

Admin page → **Roles & PINs**:

- Set a 4–8 digit PIN for each role and share it only with the people who serve in that role. Roles without a PIN are greyed out on the sign-in screen.
- Choose what each role can do: **Send messages**, **Live control**, **Mics (This Sunday)**, **Speaking mics (HH, TEACH, BP)**, **Everything (director / admin)** and **Manage Roles & PINs and admins**. Defaults:
  - **Technical Director** (David): everything, and the only role that can manage Roles & PINs and admin accounts.
  - **Production Director, Broadcast Director:** everything except Roles & PINs.
  - **FOH Engineer:** messages, Live, Mics and Speaking mics.
  - **Service Producer, Broadcast Producer:** messages and Live.
  - **Floor Manager:** messages and Speaking mics — their phone opens on the Speaking Mics screen to say who has HH-1 / HH-2 (preshow, the host moment, announcements…) and TEACH / BP-1 / BP-2.
  - **Stage Manager:** messages.
- **Planning Center positions** tells the app which scheduled positions count as the role. When exactly one person is scheduled in it, their name shows on the sign-in button and on the messages they send.
- Add or remove roles as the team changes. Changing a PIN doesn't sign anyone out; removing a role does.
- Five wrong PINs in a row locks that role for five minutes.

**Admins** have their own name and PIN (**Admin sign-in** at the bottom of the sign-in screen) and can change everything. Add more admins on the same page. The account created at first setup (Jozef) is the **overall administrator**: it outranks every role, including the Technical Director, and only its owner can change its PIN. It can't be removed.

## 9. Set the schedule

Admin page → **Schedule**: confirm each Encounter's **stream start and end** times. These drive the stream-end countdowns. Use **Special Sundays** for one-off dates.

---

## Everyday

- **Messages:** any leader opens the admin page on their phone → **Messages**, picks a quick message or types one, chooses the screens and urgency, and taps **Send**.
- **Layouts:** **Displays → Edit layout**. Drag boxes to move them, drag the corner to resize, then **Save**. Screens update within a second.
- **Updates:** when there's a new version on GitHub:
  ```
  cd ~/Documents/Love_Church_Production_Displays
  bash scripts/update.sh
  ```
  Your settings, accounts, photos and song bank live in the `data` folder and are never touched by updates.

## If something's wrong

| What you see | What to do |
|---|---|
| A screen says "Reconnecting…" | The Mac is restarting or off the network. It reconnects by itself. If it doesn't come back, restart the Mac. |
| Screens are on the wrong song | Check that the auditorium ProPresenter is open with Network on. In the meantime, use **Live** to set the position. |
| Admin page won't open | Make sure your phone is on church Wi-Fi and you're using the Mac's address. |
| Windows didn't open after a restart | Run `bash scripts/start-screens.sh` |
| Need to see what happened | The log is at `data/logs/server.log` |

**Backups:** copy the `data` folder somewhere safe now and then. It holds all your settings, accounts, the song bank and uploaded photos.

## Testing midweek (Rehearsal)

On the **Live** page, the **Rehearsal** card runs every screen as if it were the
coming Sunday at the time you pick (try 9:45), ticking forward in real time —
with the real Planning Center plan, ProPresenter and wireless receivers. You'll
see Pre-Encounter, the preshow cues and countdown, Preshow, then Live, just like
Sunday. Every screen shows a yellow **REHEARSAL** tag. Tap **End rehearsal** to
go back to real time; it also ends by itself after 3 hours.

## Recording the 11:45

The 11:45 isn't streamed. On Sundays you record it, turn on **Recording the
11:45** on the **Live** page. Then:

- its countdowns read **RECORDING STARTS IN / RECORDING ENDS IN** (11:30–1:25 by
  default; set **recordStart** / **recordEnd** on that Encounter to change it),
- Broadcast Control and Broadcast Audio go Pre-Encounter → Live with no Preshow,
- the **Broadcast team** face cards on every screen become the crew that stays:
  Cam 1–3 and the Broadcast Producer. Broadcast ProP and Broadcast Audio stay
  under **Production**. All six start as whoever Planning Center has in those
  spots; type over any name if someone else fills in, then **Save crew**.

It only applies to that Sunday's plan, so it's off again the next week.
