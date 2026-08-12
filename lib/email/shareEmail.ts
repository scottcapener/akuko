import { Resend } from "resend";

// Transactional "someone shared a chapter with you" email (SHARED_WITH_YOU.md
// §5). Resend is configured for this project as Supabase custom SMTP, which
// only carries Auth's own templates — so app-authored mail goes through the
// Resend API directly with its own key.
//
// Gated on RESEND_API_KEY: until Scott mints the key, sends are skipped (logged)
// so the rest of sharing works without it. From noreply@hotcocoa.app (matches
// signup). Server-only.

const FROM = "Hot Cocoa <noreply@hotcocoa.app>";

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

export interface ShareEmailParams {
  to: string;
  authorName: string;
  authorEmail: string;
  bookTitle: string;
  chapterTitle: string;
  sharedChapterId: string;
}

/** Send one share email. Resolves { sent } — false (not an error) when the
 *  Resend key isn't configured yet, so callers never fail a share on email. */
export async function sendShareEmail(params: ShareEmailParams): Promise<{ sent: boolean }> {
  const rs = resend();
  if (!rs) {
    console.info(`[shareEmail] RESEND_API_KEY unset — skipping email to ${params.to}`);
    return { sent: false };
  }

  const { to, authorName, chapterTitle } = params;
  try {
    await rs.emails.send({
      from: FROM,
      to,
      subject: `${authorName} shared a chapter with you`,
      html: renderShareEmail(params),
      text: renderShareEmailText(params),
    });
    return { sent: true };
  } catch (err) {
    // A share is already committed by the time we email; a failed send must not
    // surface as a failed share. Log and move on.
    console.error(`[shareEmail] failed to email ${to} about "${chapterTitle}":`, err);
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

function renderShareEmail({
  authorName,
  authorEmail,
  bookTitle,
  chapterTitle,
  sharedChapterId,
}: ShareEmailParams): string {
  const base = siteUrl();
  const openUrl = `${base}/shared/${sharedChapterId}`;
  const allUrl = `${base}/shared`;
  const name = esc(authorName);
  const chapter = esc(chapterTitle);
  const book = esc(bookTitle);

  // Dark brand palette, inline for email-client compatibility; a centered card
  // on a warm-black page (mirrors the in-app look).
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
            <div style="font-size:20px;font-weight:700;color:#d4d2ce;margin:0 0 12px;">${name} shared a chapter</div>
            <div style="font-size:14px;line-height:1.5;color:#9b9890;margin:0 0 24px;">
              ${name} (${esc(authorEmail)}) has invited you to read and leave comments on
              <span style="color:#d4d2ce;">${chapter}</span>, from <span style="color:#d4d2ce;">${book}</span>.
            </div>
            <a href="${openUrl}" style="display:block;background:#755c4b;color:#d4d2ce;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:10px;margin:0 0 12px;">Open chapter</a>
            <a href="${allUrl}" style="display:block;background:transparent;color:#9b9890;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:500;padding:10px 20px;border:1px solid #252220;border-radius:10px;">View all shared chapters</a>
          </td></tr>
          <tr><td style="padding:24px 12px 0;">
            <div style="font-size:11px;line-height:1.6;color:#615e5c;font-family:Helvetica,Arial,sans-serif;text-align:center;">
              You're receiving this email because you have an account with Hot Cocoa and ${name}
              invited you to read and comment on their chapter. If you didn't expect this, you can
              safely ignore it.
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderShareEmailText({
  authorName,
  authorEmail,
  bookTitle,
  chapterTitle,
  sharedChapterId,
}: ShareEmailParams): string {
  const base = siteUrl();
  return [
    `${authorName} shared a chapter`,
    ``,
    `${authorName} (${authorEmail}) has invited you to read and leave comments on ` +
      `"${chapterTitle}", from "${bookTitle}".`,
    ``,
    `Open chapter: ${base}/shared/${sharedChapterId}`,
    `View all shared chapters: ${base}/shared`,
    ``,
    `You're receiving this email because you have an account with Hot Cocoa and ` +
      `${authorName} invited you to read and comment on their chapter. If you didn't ` +
      `expect this, you can safely ignore it.`,
  ].join("\n");
}
