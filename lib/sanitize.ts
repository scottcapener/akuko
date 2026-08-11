import sanitizeHtml from "sanitize-html";

// Server-side HTML sanitizer for user prose that will render in *another*
// user's browser. The allowlist matches what the editor and docx import emit
// (see SHARED_WITH_YOU.md §Sanitization): inline emphasis + paragraph/line
// structure, and nothing else. No attributes at all — anything outside the
// list is stripped to its text content.
//
// Author Bio uses this today; the Shared With You snapshot (shared_scenes.
// body_html) is the other intended caller. Keep it the single source of truth
// for "what tags are safe to store," so both surfaces agree.
const ALLOWED_TAGS = ["em", "i", "strong", "b", "br", "div", "p"];

export function sanitizeProseHtml(dirty: string): string {
  return sanitizeHtml(dirty, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {},
    // Drop the *contents* of anything script-like rather than unwrapping it to
    // text (the sanitize-html default keeps <script> inner text).
    disallowedTagsMode: "discard",
    allowedSchemes: [],
    // Collapse the document down to text + the allowed inline/block tags.
    parseStyleAttributes: false,
  }).trim();
}
