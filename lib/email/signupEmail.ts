import { Resend } from "resend";

// Internal "someone finished signing up" notification. Fires when a new user
// completes the signup wizard (profile written with a display name) — see
// app/signup/page.tsx handleStep3 and app/api/notify-signup/route.ts.
//
// Styled to match the "shared a chapter" email (lib/email/shareEmail.ts): same
// dark card on a warm-black page. No buttons — just the new user's name and
// email. Gated on RESEND_API_KEY (set in production): when the key is absent —
// e.g. a local/preview env — sends are skipped (logged) so signup never fails
// on a missing email. Server-only.

const FROM = "Hot Cocoa <noreply@hotcocoa.app>";

/** Where the notification is delivered. Overridable so it never hardcodes an
 *  inbox in the repo; falls back to Scott's address. */
function notifyTo(): string {
  return process.env.SIGNUP_NOTIFY_EMAIL || "scottcapener@gmail.com";
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://hotcocoa.app").replace(/\/$/, "");
}

let client: Resend | null = null;
function resend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  client ??= new Resend(key);
  return client;
}

export interface SignupEmailParams {
  name: string;
  email: string;
}

/** Send the new-signup notification. Resolves { sent } — false (not an error)
 *  when the Resend key isn't configured yet, so signup never fails on email. */
export async function sendSignupEmail(params: SignupEmailParams): Promise<{ sent: boolean }> {
  const rs = resend();
  if (!rs) {
    console.info(`[signupEmail] RESEND_API_KEY unset — skipping notification for ${params.email}`);
    return { sent: false };
  }

  try {
    await rs.emails.send({
      from: FROM,
      to: notifyTo(),
      subject: `New signup: ${params.name}`,
      html: renderSignupEmail(params),
      text: renderSignupEmailText(params),
    });
    return { sent: true };
  } catch (err) {
    console.error(`[signupEmail] failed to notify about ${params.email}:`, err);
    return { sent: false };
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSignupEmail({ name, email }: SignupEmailParams): string {
  const base = siteUrl();
  const displayName = esc(name);
  const displayEmail = esc(email);

  // Dark brand palette, inline for email-client compatibility; a centered card
  // on a warm-black page (mirrors the "shared a chapter" email).
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#100f0f;color:#d4d2ce;font-family:Georgia,'Times New Roman',serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#100f0f;padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
          <tr><td align="center" style="padding:8px 0 28px;">
            <img src="${base}/email-logo.png" alt="Hot Cocoa" width="196" height="36" style="display:block;margin:0 auto;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" />
          </td></tr>
          <tr><td style="background:#18181a;border:1px solid #1c1b1b;border-radius:16px;padding:32px 28px;" align="center">
            <div style="font-size:20px;font-weight:700;color:#d4d2ce;margin:0 0 20px;">New signup</div>
            <div style="font-size:13px;line-height:1.6;color:#9b9890;font-family:Helvetica,Arial,sans-serif;">
              <div style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#615e5c;">Name</div>
              <div style="font-size:15px;color:#d4d2ce;margin:0 0 18px;">${displayName}</div>
              <div style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#615e5c;">Email</div>
              <div style="font-size:15px;color:#d4d2ce;">
                <a href="mailto:${displayEmail}" style="color:#d4d2ce;text-decoration:none;">${displayEmail}</a>
              </div>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderSignupEmailText({ name, email }: SignupEmailParams): string {
  return [`New signup`, ``, `Name: ${name}`, `Email: ${email}`].join("\n");
}
