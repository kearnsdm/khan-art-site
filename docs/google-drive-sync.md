# Google Drive sync (Path A — filesystem sync)

This is the "low-tech" Drive integration. Nicholas drops images into a
shared Google Drive folder from his Mac; Google Drive for Desktop syncs
them to a local folder on Devin's Windows machine; the admin scans that
local folder. **No code-level Drive API integration**, no OAuth, no
service accounts. The web admin (`nicholaskhan.com/admin/works`) still
runs only on Devin's machine in this setup — Nicholas's role is "add
files to Drive", Devin's is "open admin, click Save, push to deploy".

## One-time setup

### 1. Make the shared Drive folder

Pick whose Google account "owns" the folder. The user's Google Workspace
account is the natural choice if there is one; a personal Google account
is fine too. **Do this from whichever account will own the folder:**

1. Go to <https://drive.google.com>.
2. **New → Folder** at the top of "My Drive". Name it something stable
   like `Khan Art Site — content`. The exact name doesn't matter for the
   site (the scanner reads whatever you point it at), but pick something
   you'll recognize.
3. Right-click the folder → **Share** → add Nicholas's Google address
   AND Devin's Google address (if different) with **Editor** permission.
   Both of you need read+write access.

### 2. Nicholas's Mac — Drive for Desktop

1. Download Google Drive for Desktop from
   <https://www.google.com/drive/download/>. The Mac version is the same
   installer as everywhere else.
2. Run the installer and sign in with the Google account that has access
   to the shared folder.
3. In Drive for Desktop preferences, choose **"Mirror files"** (not
   "Stream files") for "My Drive". This makes the files actually present
   on disk rather than virtual on-demand — important for big images and
   for reliability.
4. Open Finder → in the sidebar under "Locations" there should be a
   **Google Drive** entry. Inside it, navigate to the shared folder:
   `My Drive → Khan Art Site — content`. *(If it's under "Shared with
   me" instead, right-click the folder and choose "Add shortcut to My
   Drive" so it shows up alongside his own files. Less confusing.)*
5. **That's it for Nicholas.** From now on, whenever he wants to add a
   new painting, he just drags photos into that folder (or saves
   directly from Photos.app, etc.). Drive does the upload in the
   background.

### 3. Devin's Windows — Drive for Desktop + env var

1. Install Google Drive for Desktop from the same URL.
2. Sign in with the Google account that has access to the shared folder.
3. Set "Mirror files" mode (same reason as Nicholas — full local copy).
4. Open File Explorer; the shared folder shows up at something like:
   `G:\My Drive\Khan Art Site — content`
   The drive letter (`G:`) is Drive's default but might be different on
   your machine. Copy the full path.
5. In the project, edit `.env.local` (create it from `.env.example` if
   you haven't yet) and add:
   ```
   CONTENT_ROOT=G:\My Drive\Khan Art Site — content
   ```
   Use a regular Windows path. No quotes, no escaping needed.
6. **Restart** the dev server (`Ctrl+C` then `npm run dev` again — Astro
   only reads env files at startup).

That's it. Open `http://localhost:4321/admin/works` and you should see
whatever's in the shared Drive folder, scanned the same way as before.

## Day-to-day workflow

- **Nicholas** drops new images (or a whole subfolder for a new work)
  into `Khan Art Site — content` on his Mac.
- Drive syncs them: Mac → Drive → your Windows machine. Usually <60 sec.
- **You** open `http://localhost:4321/admin/works`. The new files
  appear, flagged "New · needs review". Decide which to show, set
  title/year/categories/captions, hit Save.
- `git status` shows the changes to `src/data/works.json` and
  `public/works/`. `git add` / `git commit` / `git push`. Netlify
  rebuilds. The new works appear on `nicholaskhan.com` a couple of
  minutes later.

## Folder structure tips

The scanner is permissive — Nicholas doesn't have to follow strict
naming. See `docs/launch-checklist.md` or just play with it. Quick recap
of how the scanner reads the Drive folder:

- **Year-named subfolders** (`2024/`, `2025/`, etc.) get their contents
  walked: each sub-subfolder inside becomes one Work group; each loose
  image directly inside the year folder becomes its own Work group.
- **Other top-level folders** become one Work group with everything they
  contain.
- **Loose images at the top of the Drive folder** become their own
  Work groups.
- **Filenames matching `*Final*`** (case-insensitive) automatically sort
  to the front of a new Work's image list. So `Painting_Final.jpg` ends
  up as the display image when you first see the work in the picker.
- **Subfolders inside a Work** (like `Progress photos/`, `Reference/`)
  are fine — the scanner walks recursively and surfaces all the images.
- **Folders named `Invoices`** (any case) are skipped — Nicholas's
  bookkeeping won't pollute the picker.

## Switching off Drive

If you ever want to go back to the in-repo `content/` folder (e.g.
testing without Drive running), just comment out the `CONTENT_ROOT`
line in `.env.local` and restart the dev server. The scanner falls back
to `<project>/content`.

## What this setup does NOT do

- **Nicholas can't publish from his browser.** He can drop files; you
  still hit Save and push. That's Path B — Drive API integration — and
  it's a bigger build. Stick with this until the publish friction is
  actually a problem.
- **No conflict resolution.** If two people edit the same source folder
  at the same moment, Drive handles the sync the way Drive normally
  does (last write wins, possibly with `(1)`-suffixed copies). Unlikely
  to matter in a 2-person setup.
- **Doesn't run on the Netlify production server.** The production site
  only sees what's in `src/data/works.json` + `public/works/` *as of the
  last deploy*. Drive itself isn't queried from production.

## Troubleshooting

**Admin picker is empty after I set CONTENT_ROOT.**
- Restart the dev server. Env files are read at startup only.
- Check the path actually exists in File Explorer. Watch for typos in
  spaces / em-dashes (`—` vs `-`).
- If Drive uses "Stream files" mode, files may not actually be on disk
  yet. Switch to "Mirror files" in Drive preferences.

**Files appear in Drive on Nicholas's Mac but not on my Windows machine.**
- Check Drive for Desktop's sync status — there's a menu-bar icon (Mac)
  or system tray icon (Windows) that shows pending uploads/downloads.
- Sometimes Drive needs a kick: pause + resume sync.

**Drive folder shows up but admin still shows old in-repo content.**
- The `CONTENT_ROOT` env var didn't take effect. Verify by adding a
  temporary `console.log(process.env.CONTENT_ROOT)` in
  `src/lib/content-scanner.ts` and checking the dev terminal output.

**I can't see Nicholas's files at all.**
- Check the share is in place. Right-click the folder in your Drive,
  Manage Access. He should be listed as Editor.
- If the folder is under "Shared with me" rather than "My Drive", add
  a shortcut to My Drive so Drive for Desktop syncs it.
