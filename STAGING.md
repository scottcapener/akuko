# Staging environment: `dev.hotcocoa.app`

A step-by-step walkthrough for standing up a staging copy of Hot Cocoa. Work
top to bottom the first time; after that, use the **Ongoing workflow** section
for day-to-day.

Status: **not started** — check off steps as you go.

---

## The one decision that matters

**Staging gets its own Supabase project. It does not touch the production
database.**

Staging exists so you can break things — run half-finished migrations, wipe
tables, test destructive flows — without any chance of corrupting real users'
notes, chapters, and comments. If staging points at the production database,
you lose the entire point and gain a loaded gun. The Supabase free tier allows
two projects, so a dedicated staging project costs nothing.

Everything below assumes: **one Vercel project, a `staging` git branch mapped to
`dev.hotcocoa.app`, and a separate Supabase project behind it.**

```
  main ──────────► hotcocoa.app        ──► Supabase "hot-cocoa" (prod, real users)
  staging ───────► dev.hotcocoa.app    ──► Supabase "hot-cocoa-staging" (throwaway)
       (same Vercel project, two branches, two databases)
```

Why one Vercel project instead of two: one dashboard, one set of build
settings, and Vercel lets you pin a custom domain to a specific branch and scope
env vars per-branch. A second project is a valid alternative (cleaner
"Production" separation, its own cron) — noted at the end if you'd rather.

---

## Step 1 — Create the `staging` branch

```bash
git fetch origin
git checkout main
git pull
git checkout -b staging
git push -u origin staging
```

From now on, staging is a long-lived branch. You merge `main` into it to bring
staging up to date, and open PRs from feature branches into `staging` first,
then promote to `main`. (See **Ongoing workflow**.)

- [ ] `staging` branch pushed to origin

---

## Step 2 — DNS: point `dev.hotcocoa.app` at Vercel

You haven't configured this subdomain yet. Where you do this depends on where
`hotcocoa.app`'s DNS lives (your registrar, or Vercel if you moved nameservers
there).

**If Vercel manages your DNS** (nameservers point to Vercel): skip to Step 3 —
adding the domain in the Vercel dashboard creates the record for you.

**If your registrar manages DNS:** add a CNAME:

| Type  | Name  | Value                    |
| ----- | ----- | ------------------------ |
| CNAME | `dev` | `cname.vercel-dns.com.`  |

Vercel will show you the exact target when you add the domain in Step 3 — use
whatever it displays there rather than trusting this table blindly. DNS can take
a few minutes to a few hours to propagate.

- [ ] `dev` CNAME added (or confirmed Vercel-managed DNS)

---

## Step 3 — Vercel: attach `dev.hotcocoa.app` to the `staging` branch

In the Vercel dashboard for the Hot Cocoa project:

1. **Settings → Domains → Add** → enter `dev.hotcocoa.app`.
2. When prompted, **assign it to a Git branch** and choose `staging` (Vercel:
   "Git Branch" field on the domain). This makes every push to `staging` deploy
   to `dev.hotcocoa.app` as a preview deployment served on that domain.
3. Wait for the domain to show **Valid Configuration** (green). If it complains,
   it's DNS from Step 2 still propagating — Vercel's screen tells you exactly
   which record it expects.

> Note: branch-assigned deployments run in Vercel's **Preview** environment, not
> Production. That matters for env-var scoping (Step 5) and cron (Step 8).

- [ ] `dev.hotcocoa.app` added and assigned to the `staging` branch
- [ ] Domain shows Valid Configuration

---

## Step 4 — Create the staging Supabase project

1. Supabase dashboard → **New project** → name it `hot-cocoa-staging` (same org).
   Pick the same region as production. Save the database password somewhere safe.
2. Grab these three from **Project Settings → API**, you'll need them in Step 5:
   - Project URL (`https://<ref>.supabase.co`)
   - `anon` public key
   - `service_role` key (server-only, secret)

### Apply the schema

The repo tracks 19 plain-SQL migrations in [`supabase/migrations/`](supabase/migrations/)
(`001…` through `019_chapter_updated_at.sql`). There's no Supabase CLI wired up,
so apply them by hand, **in filename order**, against the new project:

- Open the staging project's **SQL Editor**.
- Paste and run each migration file in order, `001` first. Don't skip any — later
  ones depend on earlier tables.
- A quick way to get them all in order for copy-paste:

```bash
ls supabase/migrations/*.sql | sort
```

If you'd rather not paste 19 times, you can concatenate them and run once —
**only** if you've confirmed the files are safe to run back-to-back (they are
ordered and additive):

```bash
# writes a single combined script to your scratch area to paste into the SQL editor
cat $(ls supabase/migrations/*.sql | sort) > /tmp/staging-schema.sql
```

After running, spot-check in **Table Editor** that the expected tables exist.

- [ ] `hot-cocoa-staging` project created
- [ ] All migrations applied in order
- [ ] Tables verified

> Going forward: any new migration you write gets applied to **staging first**,
> then to production when you promote. That's the whole reason staging exists.

---

## Step 5 — Environment variables (scoped to the `staging` branch)

Your app reads these (from `.env.local`): `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_DEV_USER_ID`, `DEV_USER_EMAIL`,
`DEV_USER_PASSWORD`, `RESEND_API_KEY`, plus `CRON_SECRET`.

In Vercel → **Settings → Environment Variables**, add the staging values scoped
to **Preview**, and use Vercel's **branch filter** so they apply specifically to
the `staging` branch (this keeps them from leaking into other preview branches).

| Variable | Staging value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://dev.hotcocoa.app` | Drives auth redirects **and** email links. Must be the staging URL or password-reset/share links point at prod. |
| `NEXT_PUBLIC_SUPABASE_URL` | staging project URL | From Step 4 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon key | From Step 4 |
| `SUPABASE_SERVICE_ROLE_KEY` | staging service_role key | Secret. Never `NEXT_PUBLIC_`. |
| `RESEND_API_KEY` | see Step 7 | Decide test vs. live sending first |
| `CRON_SECRET` | a fresh random string | Different from prod's; see Step 8 |
| `NEXT_PUBLIC_DEV_USER_ID` | see Step 9 | The dev-login bypass |
| `DEV_USER_EMAIL` | see Step 9 | |
| `DEV_USER_PASSWORD` | see Step 9 | |

Double-check the Supabase keys are the **staging** project's. Pasting prod keys
here silently reconnects staging to the production database and undoes Step 4's
entire purpose.

- [ ] All staging env vars set, scoped to the `staging` branch
- [ ] Confirmed Supabase keys belong to `hot-cocoa-staging`

---

## Step 6 — Point Supabase Auth at the staging domain

In the **staging** Supabase project → **Authentication → URL Configuration**:

- **Site URL:** `https://dev.hotcocoa.app`
- **Redirect URLs (allow list):** add
  - `https://dev.hotcocoa.app/auth/callback`
  - `https://dev.hotcocoa.app/**` (covers the `?next=/reset-password` callbacks
    the app builds in `app/forgot-password/page.tsx` and the account page)

Without these, Supabase rejects the OAuth/magic-link/reset redirects and login
silently fails on staging.

- [ ] Site URL set to the staging domain
- [ ] Callback + wildcard redirect URLs allow-listed

---

## Step 7 — Email (Resend)

Your transactional emails (`lib/email/*.ts`) send from a **hardcoded**
`Hot Cocoa <noreply@hotcocoa.app>`; only the *link* base URL comes from
`NEXT_PUBLIC_SITE_URL`. So on staging, links will correctly point at
`dev.hotcocoa.app`, but the From address stays the production domain.

Pick one:

- **Simplest — reuse the production Resend key.** Real emails go out from
  `noreply@hotcocoa.app` with links to `dev.hotcocoa.app`. Fine as long as you
  only trigger email flows on **test accounts** on staging. Risk: a stray test
  emails a real user.
- **Cleaner — a separate Resend setup for staging.** Verify `dev.hotcocoa.app`
  (or a `staging.` subdomain) in Resend, use a staging API key, and change the
  hardcoded `FROM` to read from an env var so staging sends from
  `noreply@dev.hotcocoa.app`. This is a small code change (swap the three
  `const FROM = …` lines for an env-backed helper) and the safest option if
  you'll exercise email flows a lot.

Recommendation: start with the production key + test-accounts-only discipline;
graduate to the env-backed FROM if staging email testing becomes routine.

- [ ] Decided email strategy and set `RESEND_API_KEY` accordingly

---

## Step 8 — Cron

`vercel.json` schedules `/api/cron/backup-sweep` daily at 03:00 UTC. **Vercel
only runs crons for Production deployments**, so on the single-project +
branch-assigned-domain setup, staging **won't** run the sweep. That's the
behavior you want — no reason for staging to run backup jobs.

Still give staging its **own** `CRON_SECRET` (a different random string), so that
if you ever hit `/api/cron/backup-sweep` on staging manually, prod's secret isn't
reused. The route rejects any call without the matching secret.

- [ ] Separate `CRON_SECRET` set for staging
- [ ] Understood: the daily sweep does not auto-run on staging

---

## Step 9 — Dev login bypass

The app has a dev auth preview (`NEXT_PUBLIC_DEV_USER_ID` / `DEV_USER_EMAIL` /
`DEV_USER_PASSWORD`) that lets you reach `/write` without logging in. Two ways to
handle it on staging:

- **Keep it** — convenient for quickly poking at UI on staging. Create a matching
  test user in the **staging** Supabase project and set these three vars to that
  user. (`dev.hotcocoa.app` is a public URL, so anyone who knows the bypass could
  use it — only keep it if that's acceptable for a staging box.)
- **Drop it** — leave these three vars unset on staging so it behaves like real
  auth. Better if you want staging to mirror production login exactly.

Recommendation: **drop it on staging** so you test the real auth path; keep the
bypass for local `.env.local` only.

- [ ] Decided, and set (or intentionally left unset) the three dev vars

---

## Step 10 — First deploy + smoke test

Trigger the first staging build by pushing to the branch (an empty commit is
enough if it's already up to date):

```bash
git checkout staging
git commit --allow-empty -m "chore: trigger first staging deploy"
git push
```

Then, on `https://dev.hotcocoa.app`:

- [ ] Page loads over HTTPS with the staging cert valid
- [ ] Sign up / log in works (confirms Supabase URL + keys + redirect allow-list)
- [ ] Data you create shows up in the **staging** Supabase Table Editor — and
      **not** in production (the critical isolation check)
- [ ] A share or comment email (if you test one) links back to `dev.hotcocoa.app`
- [ ] `/write` behaves as you decided in Step 9

If login fails, it's almost always Step 6 (redirect URLs) or a prod/staging key
mix-up in Step 5.

---

## Ongoing workflow

```
feature branch ──PR──► staging ──(verify on dev.hotcocoa.app)──► PR ──► main ──► prod
```

1. Branch off `staging` (or `main`) for a feature.
2. Open a PR into `staging`; merging deploys to `dev.hotcocoa.app`.
3. **New DB change?** Add the migration file, apply it to the **staging**
   Supabase project, verify on `dev.hotcocoa.app`.
4. Happy? Open a PR from `staging` → `main`. Merging deploys production.
5. **Apply the same migration to the production Supabase project** as part of
   promoting — code and schema move together.
6. Keep staging fresh: periodically `git checkout staging && git merge main`.

Guardrails already in your memory that apply here: fetch before branching, scope
commits to files you changed, and never test destructive flows against live
production content — that's what this whole environment is for.

---

## Alternative: two Vercel projects

If you'd prefer harder separation, create a **second** Vercel project from the
same repo with its **Production branch = `staging`** and `dev.hotcocoa.app` as
its production domain. Trade-offs vs. the branch approach above:

- **Pro:** staging runs in a real "Production" environment (simpler env scoping),
  and its cron *would* run — so you'd explicitly remove the cron from that
  project (or a `vercel.json` override) rather than relying on Vercel skipping it.
- **Con:** two dashboards/projects to keep in sync (build settings, Node version,
  env vars).

Everything else (separate Supabase project, DNS, auth URLs, email, smoke tests)
is identical. Pick one and stay with it.
