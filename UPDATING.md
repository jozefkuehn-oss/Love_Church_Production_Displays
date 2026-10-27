# Updating the Displays app — quick guide

Everything you set up on the Mac (PINs, permissions, people photos, schedule,
dashboards you changed, subs, messages) lives in the **`data`** folder.
**Updates never touch it,** and a backup is made first in **`data-backups`**.

> Never update during an Encounter. Screens blink for a few seconds while the
> app restarts.

---

## First time on the Mac mini (do once)

1. Install **Node.js** (LTS) from <https://nodejs.org> if it isn't there yet.
2. On GitHub, open the app's page → green **Code** button → **Download ZIP**.
3. Unzip it and move the folder to **Documents**.
4. **Moving from the beta Mac?** Copy the **`data`** folder from the beta Mac's
   app folder into this new folder (replace the empty one if there is one).
   That brings over your PINs, photos, settings and dashboard changes.
5. In the folder, **right-click → Open** on **`Install on this Mac.command`**
   (right-click the first time so macOS lets it run).
6. When it says **Done**, it shows the address for the control app, like
   `http://192.168.10.xx:8080/admin`. The app now starts by itself whenever the
   Mac starts.

## Updating (any time after that)

**Easiest — from your phone or any computer:**

1. Open the control app → **Settings**.
2. The **Updates** card says **Update available** when there's a new version.
3. Tap **Update now** → **OK**. Wait about a minute; the page reloads itself.

**Or on the Mac itself:**

1. Double-click **`Update Displays.command`** in the app folder.
2. Wait for **Done**, then press Return to close the window.

That's it. Screens reconnect on their own.

## On the beta Mac (the one using "Start Displays")

Same two ways to update. Afterwards the app is stopped, so double-click
**`Start Displays (beta).command`** to start it again.

## If something goes wrong

- **Update failed:** nothing was changed; the app keeps running the old
  version. The **Last update log** on the Settings card (or
  `data/logs/update.log`) says why — usually the Mac was offline.
- **Need your old settings back:** quit the app, open **`data-backups`**,
  double-click the newest `data-….tgz`, and put the `data` folder it makes in
  place of the current one. Start the app again. (The 5 newest backups are kept.)
- **Still stuck:** send Claude the update log.
