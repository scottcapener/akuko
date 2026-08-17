import { Resend } from "resend";

// Transactional "someone commented on your chapter" email (SHARED_WITH_YOU.md
// §5). Sent to the chapter's AUTHOR when a reader leaves a comment — "leading
// edge": once per commenter's session (see lib/shared/commentNotify.ts for the
// cooldown), carrying no comment content, just a link back to the chapter where
// every comment is visible.
//
// Same delivery + styling contract as lib/email/shareEmail.ts: app-authored mail
// through the Resend API directly (Supabase custom SMTP only carries Auth's own
// templates), gated on RESEND_API_KEY so local/preview envs skip the send rather
// than fail. From noreply@hotcocoa.app. Server-only.

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

export interface CommentEmailParams {
  to: string;
  commenterName: string;
  bookTitle: string;
  chapterTitle: string;
  sharedChapterId: string;
}

/** Send one comment-notification email. Resolves { sent } — false (not an error)
 *  when the Resend key isn't configured, so callers never fail a comment on
 *  email. */
export async function sendCommentEmail(params: CommentEmailParams): Promise<{ sent: boolean }> {
  const rs = resend();
  if (!rs) {
    console.info(`[commentEmail] RESEND_API_KEY unset — skipping email to ${params.to}`);
    return { sent: false };
  }

  const { to, commenterName, chapterTitle } = params;
  try {
    await rs.emails.send({
      from: FROM,
      to,
      subject: `${commenterName} commented on your chapter`,
      html: renderCommentEmail(params),
      text: renderCommentEmailText(params),
    });
    return { sent: true };
  } catch (err) {
    // The comment is already committed by the time we email; a failed send must
    // not surface as a failed comment. Log and move on.
    console.error(`[commentEmail] failed to email ${to} about "${chapterTitle}":`, err);
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

function renderCommentEmail({
  commenterName,
  bookTitle,
  chapterTitle,
  sharedChapterId,
}: CommentEmailParams): string {
  const base = siteUrl();
  const openUrl = `${base}/shared/${sharedChapterId}`;
  const name = esc(commenterName);
  const chapter = esc(chapterTitle);
  const book = esc(bookTitle);

  // Dark brand palette, inline for email-client compatibility; a centered card
  // on a warm-black page (mirrors lib/email/shareEmail.ts).
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
            <div style="font-size:20px;font-weight:700;color:#d4d2ce;margin:0 0 12px;">${name} added a comment</div>
            <div style="font-size:14px;line-height:1.5;color:#9b9890;margin:0 0 24px;">
              ${name} left a comment on <span style="color:#d4d2ce;">${chapter}</span>, from
              <span style="color:#d4d2ce;">${book}</span>. Open the chapter to read it.
            </div>
            <a href="${openUrl}" style="display:block;background:#755c4b;color:#d4d2ce;text-decoration:none;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;padding:12px 20px;border-radius:10px;">Open chapter</a>
          </td></tr>
          <tr><td style="padding:24px 12px 0;">
            <div style="font-size:11px;line-height:1.6;color:#615e5c;font-family:Helvetica,Arial,sans-serif;text-align:center;">
              You're receiving this email because you have an account with Hot Cocoa and someone
              commented on a chapter you shared. If you didn't expect this, you can safely ignore it.
              <br />
              <a href="${base}/unsubscribe?pref=comment" style="color:#615e5c;text-decoration:underline;">Unsubscribe from comment notifications</a>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function renderCommentEmailText({
  commenterName,
  bookTitle,
  chapterTitle,
  sharedChapterId,
}: CommentEmailParams): string {
  const base = siteUrl();
  return [
    `${commenterName} added a comment`,
    ``,
    `${commenterName} left a comment on "${chapterTitle}", from "${bookTitle}". ` +
      `Open the chapter to read it.`,
    ``,
    `Open chapter: ${base}/shared/${sharedChapterId}`,
    ``,
    `You're receiving this email because you have an account with Hot Cocoa and ` +
      `someone commented on a chapter you shared. If you didn't expect this, you ` +
      `can safely ignore it.`,
    ``,
    `Unsubscribe from comment notifications: ${base}/unsubscribe?pref=comment`,
  ].join("\n");
}
