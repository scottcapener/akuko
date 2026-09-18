// ── App version ─────────────────────────────────────────────────────────────
// Bumped BY HAND in the same PR that ships a change. This one number is both what
// the "New version available" card shows AND the key it compares to detect a new
// deploy — so if it isn't bumped, the card never appears (except via the
// ChunkLoadError backstop in useUpdateAvailable). PATCH for ordinary
// releases/fixes; MINOR for a feature wave (usually the ones that also get a
// lib/updates.ts entry). Keep package.json's "version" in sync.
//
// A merge to `main` is a Vercel production deploy, which is what actually makes
// the card appear for users sitting on an older tab.
export const APP_VERSION = "0.1.26";
