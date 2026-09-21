import { Resend } from "resend";

// Internal "an author sent feedback" notification. Fires when someone submits
// the Give Feedback form in the writer's Main Menu — see components/FeedbackModal.tsx
// and app/api/feedback/route.ts.
//
// Styled to match the "shared a chapter" / "new signup" emails
// (lib/email/shareEmail.ts, lib/email/signupEmail.ts): the same dark card on a
// warm-black page, name + email + the feedback message. Reply-To is set to the
// author's own address so a reply in the inbox goes straight back to them.
// Gated on RESEND_API_KEY (set in production): when the key is absent — e.g. a
// local/preview env — sends are skipped (logged) so the form still succeeds.
// Server-only.

const FROM = "Hot Cocoa <noreply@hotcocoa.app>";

/** Where feedback is delivered. Overridable so it never hardcodes an inbox in
 *  the repo; falls back to Scott's address (mirrors the signup notification). */
function notifyTo(): string {
  return process.env.FEEDBACK_NOTIFY_EMAIL || "scottcapener@gmail.com";
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

export interface FeedbackEmailParams {
  name: string;
  email: string;
  message: string;
}

/** Send the feedback notification. Resolves { sent } — false (not an error)
 *  when the Resend key isn't configured yet, so the form never fails on email. */
export async function sendFeedbackEmail(params: FeedbackEmailParams): Promise<{ sent: boolean }> {
  const rs = resend();
  if (!rs) {
    console.info(`[feedbackEmail] RESEND_API_KEY unset — skipping feedback from ${params.email}`);
    return { sent: false };
  }

  try {
    await rs.emails.send({
      from: FROM,
      to: notifyTo(),
      // A real address routes replies straight to the author; skip it if we
      // somehow have no email so Resend doesn't reject the send.
      replyTo: params.email || undefined,
      subject: `Hot Cocoa feedback from ${params.name}`,
      html: renderFeedbackEmail(params),
      text: renderFeedbackEmailText(params),
    });
    return { sent: true };
  } catch (err) {
    console.error(`[feedbackEmail] failed to send feedback from ${params.email}:`, err);
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

function renderFeedbackEmail({ name, email, message }: FeedbackEmailParams): string {
  const base = siteUrl();
  const displayName = esc(name);
  const displayEmail = esc(email);
  // Preserve the author's line breaks in the HTML card.
  const displayMessage = esc(message).replace(/\n/g, "<br />");

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
          <tr><td style="background:#18181a;border:1px solid #1c1b1b;border-radius:16px;padding:32px 28px;">
            <div style="font-size:20px;font-weight:700;color:#d4d2ce;margin:0 0 20px;text-align:center;">New feedback</div>
            <div style="font-size:13px;line-height:1.6;color:#9b9890;font-family:Helvetica,Arial,sans-serif;">
              <div style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#615e5c;">From</div>
              <div style="font-size:15px;color:#d4d2ce;margin:0 0 18px;">
                ${displayName} &lt;<a href="mailto:${displayEmail}" style="color:#d4d2ce;text-decoration:none;">${displayEmail}</a>&gt;
              </div>
              <div style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#615e5c;">Feedback</div>
              <div style="font-size:15px;line-height:1.6;color:#d4d2ce;">${displayMessage}</div>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderFeedbackEmailText({ name, email, message }: FeedbackEmailParams): string {
  return [`New Hot Cocoa feedback`, ``, `From: ${name} <${email}>`, ``, message].join("\n");
}
