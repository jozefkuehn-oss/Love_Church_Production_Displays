# Setting up the Mac mini

Step by step, start to finish. Plan on about an hour the first time. Anything in a grey box gets typed into **Terminal** (Applications → Utilities → Terminal), then press Return.

---

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
3. Copy the **Application ID** and the **Secret**.
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

Photos download once and are kept on the Mac, so the screens don't depend on Slack during an Encounter. The hand-cropped starter photos that ship with the app are used first. Fix anyone else in **People**: upload a better headshot, frame it with the sliders, or switch to initials.

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

## 7. Send the screens to the hub

The Mac opens one full-screen Chrome window per output, listed in `scripts/screens.conf`:

```
broadcast  0     0
greenroom  1920  0
dock       3840  0
```

1. Connect the Mac's outputs to the hub, then arrange them side by side in **System Settings → Displays → Arrange**.
2. Edit `scripts/screens.conf` so each display lands on the right output. Use x = 0, 1920, 3840 for side-by-side 1080p outputs.
3. Reopen the windows:
   ```
   bash scripts/start-screens.sh
   ```
4. Route each output to its TV through the hub like any other source.

Any TV, stick or computer on the church network can also run a room directly. Open `http://<mac address>:8080/display` in its browser, full screen. The first time, it asks which room it's in. After that it remembers. To change it later, press **R** on a keyboard or remote, or press and hold the screen for 3 seconds. You can also move it from **Admin → Displays → Screens**.

## 8. Add your leaders

Admin page → **Accounts** → add each leader with their name, their Planning Center name and a starting PIN.

- **Leaders** can send producer messages and use the **Live** tab, on days they're scheduled in a leadership role. You can turn that rule off in Settings.
- **Admins** can change everything.

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
