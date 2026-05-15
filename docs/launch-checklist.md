# Launch checklist

Status as of the pre-launch baseline. Steps you (Devin) execute are
marked **[you]**; steps I can do once the prerequisites are met are
marked **[claude]**.

Decision recap: single domain, `nicholaskhan.com`, registered through
Cloudflare. No secondary redirect domain.

## 1. Buy `nicholaskhan.com` — Cloudflare Registrar

Cloudflare Registrar prices at wholesale (~$10.44/yr for `.com` at last
check), no markup, free WHOIS privacy. Requires Cloudflare DNS, which is
what we want anyway.

**[you]**

1. Log in at https://dash.cloudflare.com.
2. Left sidebar → **Domain Registration** → **Register Domains**.
3. Search `nicholaskhan.com`.
   - **Available at standard price** → add to cart, 1-year term, leave
     auto-renew on, check out.
   - **Shown as "premium" / aftermarket-priced or already owned** →
     stop and tell me. We picked this name on the assumption it was a
     normal registration; if it isn't, we should rethink before
     paying a markup.

After purchase, the domain appears under **Websites** in the Cloudflare
dashboard with DNS managed by Cloudflare automatically.

**Tell me when this is done.**

## 2. Create the Netlify site

**[you]** — first time only:

1. https://app.netlify.com → sign up / log in (GitHub login is fine).
2. The repo isn't pushed anywhere yet. Two paths:
   - **A. Push to GitHub first** (recommended — gets you continuous
     deploys from `main`). Create a private repo at github.com/new
     called `khan-art-site`, then locally:
     ```
     git remote add origin git@github.com:<you>/khan-art-site.git
     git push -u origin main
     ```
     Then in Netlify → **Add new site → Import an existing project** →
     GitHub → pick the repo. Netlify auto-detects `netlify.toml` and
     uses Node 20.
   - **B. Manual drop** (faster for first preview, no GitHub yet).
     `netlify deploy --build` from the CLI, or drag-and-drop the
     `dist/` folder. Fine for kicking the tires, but real deploys
     should come from a git remote.

   I'd do A. Tell me when the site is created and I'll verify the
   build there.

## 3. Point `nicholaskhan.com` at Netlify

**[claude]** — once domain exists in Cloudflare and site exists in
Netlify, I'll walk you through (or do via Cloudflare API token if you
want to paste one in) the records below.

In Netlify site dashboard:
- **Domain management → Add a domain** → `nicholaskhan.com` (primary).
- **Add a domain alias** → `www.nicholaskhan.com`.

In Cloudflare DNS for `nicholaskhan.com`:
- `CNAME` apex → `apex-loadbalancer.netlify.com` (Cloudflare's CNAME
  flattening makes this work at the root, no `A` record needed).
- `CNAME www` → `<your-site>.netlify.app`.
- **Proxy status: DNS only (gray cloud)** for both. Leave the
  Cloudflare proxy off during initial setup so Netlify can issue
  Let's Encrypt certs without interference. We can revisit later if we
  want Cloudflare's CDN/firewall in front — Netlify already CDNs, so
  it's optional.

Then in Netlify → **HTTPS → Verify DNS configuration → Provision
certificate**. Takes a few minutes.

## 4. Pre-launch sanity pass

**[claude]** — after the domain is live:

- `https://nicholaskhan.com` serves the site with a valid HTTPS cert.
- `https://www.nicholaskhan.com` and the apex resolve to the same
  content (one canonicalizes to the other — I'd pick apex as canonical).
- API routes (`/api/content.json`, `/api/image`, `/api/thumb`,
  `/api/save`) actually respond in production. They built as an SSR
  function; needs verifying in the wild.
- `/admin/works` loads. **Note:** still no auth in front of it — see
  follow-ups below.

## Known follow-ups (not blocking domain step, flag for after launch)

- **Admin auth.** `/admin/works` has no authentication. Anyone who
  guesses the path can use the editor. Options: Netlify Identity, basic
  auth via Netlify edge function, or moving admin off the public site.
- **Save persistence.** `/api/save.ts` and the image routes read/write
  the local `content/` folder. On Netlify functions the filesystem is
  read-only and ephemeral — anything written there is lost on the next
  deploy. Saves from the admin UI won't persist in production until
  this is reworked (Netlify Blobs, a git commit via API, or external
  storage).
- **Dynamic route warning.** `src/pages/works/[slug].astro` triggered a
  build warning: its `getStaticPaths()` is ignored under SSR. Either
  add `export const prerender = true;` and prerender the works pages,
  or drop the unused `getStaticPaths`. Cosmetic, not a launch blocker.
- **Repo size.** ~1 GB due to `content/` originals. First push to
  GitHub will be slow. Consider Git LFS later if it gets painful.
- **Stale CLAUDE.md.** Still says "Not yet started." Worth a refresh
  once the shape of the project is stable.
