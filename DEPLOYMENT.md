# Deployment Notes

Hot Cocoa is a Next.js 16 (App Router, Turbopack) app deployed on **Vercel**, with
**Supabase** for auth, database, and storage. Production lives at
**https://hotcocoa.app**.

## Production stack

| Piece | Where | Notes |
|-------|-------|-------|
| Hosting | Vercel (project `hot-cocoa`) | Auto-deploys from `main` |
| Domain | `hotcocoa.app` (Porkbun DNS) | Apex 307-redirects to `www.hotcocoa.app` |
| Auth / DB / Storage | Supabase (`hvtghcpfvmechtbpblow`) | RLS-protected |
| Transactional email | Resend (custom SMTP in Supabase) | Sends from `noreply@hotcocoa.app`; powers signup verification codes |

## DNS (Porkbun)

| Type | Host | Value |
|------|------|-------|
| A | `hotcocoa.app` | `216.198.79.1` (Vercel anycast ingress) |
| CNAME | `www.hotcocoa.app` | `<hash>.vercel-dns-017.com` (new value issued by Vercel for this domain) |

## Supabase auth URL config

- **Site URL**: `https://hotcocoa.app`
- **Redirect URLs**: `https://hotcocoa.app/**`

## Signup verification (email OTP)

Signup is a 3-step flow (`app/signup/page.tsx`): Account → Verify → Profile.
The phone/SMS step was removed. Step 1 calls `signUp`, which emails a 6-digit
code; step 2 confirms it with `verifyOtp({ type: "signup" })`. Requirements:

- **Auth → Providers → Email → "Confirm email" enabled.**
- **Auth → Email Templates → "Confirm signup"** uses `{{ .Token }}` so a code
  (not just a magic link) is sent.
- **Custom SMTP (Resend)** configured under Auth → SMTP Settings, and the email
  send **rate limit raised** under Auth → Rate Limits — the built-in sender's
  default limit is too low for real signups.

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

- [ ] Test live signup end-to-end at https://hotcocoa.app/signup (verify the code
      email arrives from `noreply@hotcocoa.app` and lands in the inbox, not spam)
