# Auto-upload from Google Drive

The plan: use **Google Drive for Desktop** to sync a shared folder between Nicholas's computer and yours. That shared folder *is* this site's `content/` folder. Nicholas adds paintings to Drive → they appear on your computer automatically → you (or Nicholas, via the picker) decide what's public.

No API integration, no OAuth, no separate "upload" button — Drive's normal sync is the upload.

## One-time setup (you do this once on your machine)

1. Install **Google Drive for Desktop**: <https://www.google.com/drive/download/>
2. Sign into the Google account that will own the shared folder. The user's Google Workspace account is the natural choice.
3. In Google Drive (web), create a folder called something like `Khan Art Site — content` at the top level of "My Drive".
4. Share that folder with Nicholas (his Google account) with **Editor** permission.
5. In Drive for Desktop, choose to mirror "My Drive" to your computer (Settings → "Stream files" vs "Mirror files" → pick **Mirror**).
6. Find the local path Drive maps to (typically `G:\My Drive\Khan Art Site — content\` or `~/My Drive/Khan Art Site — content`).
7. Move the existing site content there:
   - Move every folder currently under `khan-art-site/content/` into `Khan Art Site — content/`
   - Replace `khan-art-site/content` with a [directory junction / symlink](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/mklink) pointing at the Drive folder. Windows command (PowerShell, admin):
     ```powershell
     # Run from inside khan-art-site/
     Remove-Item content -Recurse -Force
     New-Item -ItemType Junction -Path "content" -Target "G:\My Drive\Khan Art Site — content"
     ```
   - Alternative: don't symlink; instead, change `CONTENT_ROOT` in `src/lib/content-scanner.ts` to the absolute Drive path.

## Nicholas's setup (he does this once on his computer)

1. He installs **Google Drive for Desktop** on his machine and signs in with his Google account.
2. He accepts the share invite for `Khan Art Site — content`.
3. The folder appears under "Shared with me" — he adds a shortcut to "My Drive" so it appears as a normal folder on his computer.
4. From now on, when Nicholas wants to add a new painting, he drops a folder into that shared folder. That's it.

## Day-to-day workflow

- Nicholas adds `2026.1_Whatever/` with photos to the Drive folder.
- Drive syncs it to your computer within seconds.
- You run `npm run dev`, open `http://localhost:4321/admin/works`, and the new folder shows up in the picker (along with thumbnails of every file inside).
- You decide with Nicholas which photo is primary, which additional photos to show, what section it belongs in, and whether it appears on the home page.
- Hit Save. The site updates immediately in your browser.
- Commit and deploy when ready.

## Future enhancement

If/when you want Nicholas to use the picker himself without your machine running:

- Deploy the admin route behind a password (e.g. Cloudflare Access, basic auth)
- Or switch from the desktop-sync model to direct Google Drive API integration (server reads Drive contents on demand)

Both are larger pieces of work; not needed for v1.
