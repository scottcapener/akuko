# Deployment Notes

Hakuko is a Next.js 16 (App Router, Turbopack) app deployed on **Vercel**, with
**Supabase** for auth, database, and storage. Production lives at
**https://hakuko.app**.

## Production stack

| Piece | Where | Notes |
|-------|-------|-------|
| Hosting | Vercel (project `akuko`) | Auto-deploys from `main` |
| Domain | `hakuko.app` (Porkbun DNS) | Apex 307-redirects to `www.hakuko.app` |
| Auth / DB / Storage | Supabase (`hvtghcpfvmechtbpblow`) | RLS-protected |
| SMS OTP | Twilio | Phone verification pending as of launch |

## DNS (Porkbun)

| Type | Host | Value |
|------|------|-------|
| A | `hakuko.app` | `216.198.79.1` (Vercel anycast ingress) |
| CNAME | `www.hakuko.app` | `<hash>.vercel-dns-017.com` (from Vercel) |

## Supabase auth URL config

- **Site URL**: `https://hakuko.app`
- **Redirect URLs**: `https://hakuko.app/**`

## Hard-won gotchas (read before debugging a prod issue)

1. **Framework preset MUST be `nextjs`.** The Vercel project was created with
   `framework: null`, which made it build successfully but serve only `/public`
   static assets — every App Router route returned a platform `NOT_FOUND` (404).
   This is now pinned in `vercel.json` (`"framework": "nextjs"`). Do not remove.

2. **No Edge middleware / proxy.** On Vercel + Next.js 16.2.6, the Edge layer was
   unreliable: the new `proxy.ts` convention builds locally but isn't deployed as
   an invocable function (→ platform 404 on matched routes), and the legacy
   `middleware.ts` deploys but fails to invoke (→ `MIDDLEWARE_INVOCATION_FAILED`
   500). Route gating is therefore done **in-page** with client-side guards:
   - `/write`, `/account`: redirect to `/login` if no authenticated user.
   - `/login`: redirect to `/write` if already authenticated.
   - `/signup`: detects an existing session on mount, resumes at the right step,
     and redirects to `/write` if the profile is already complete.
   Security is unaffected — Supabase RLS + server-side `getUser` are the real
   boundary; the redirects are only UX.

3. **Diagnosing a prod 404/500**: curl the route and read `x-vercel-error`.
   - `NOT_FOUND` + `/public` assets still 200 → framework/serve config issue.
   - `MIDDLEWARE_INVOCATION_FAILED` → an Edge function is throwing; prefer
     in-page guards over middleware here.

## Local dev

```bash
npm run dev      # http://localhost:3000
npm run build    # production build (verifies routes + types)
```

Requires Node 20.9+ (project uses nvm; `nvm use` / Node 22 locally).
`.env.local` holds Supabase keys (never commit it).

## Remaining launch checklist

- [ ] Test live signup end-to-end at https://hakuko.app/signup
- [ ] Re-enable "Confirm email" in Supabase (Auth → Providers → Email)
- [ ] Resubmit Twilio number verification with `https://hakuko.app/signup` as the
      opt-in URL (requires the public site, which is now live)
