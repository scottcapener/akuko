import posthog from "posthog-js";

// Thin wrapper over PostHog so call sites never touch the SDK directly and never
// throw: analytics must not be able to break the writer. A no-op on the server and
// when no key is configured (posthog is only initialised in
// instrumentation-client.ts when NEXT_PUBLIC_POSTHOG_KEY is set).
//
// Privacy rule for every call site: properties are counts, ids, and flags —
// NEVER manuscript text, chapter/book titles, or names.

type Props = Record<string, string | number | boolean | null | undefined>;

export function track(event: string, props?: Props, opts?: { unloading?: boolean }) {
  try {
    if (typeof window === "undefined" || !posthog.__loaded) return;
    // sendBeacon survives a closing tab; a normal fetch would be cancelled.
    posthog.capture(event, props, opts?.unloading ? { transport: "sendBeacon" } : undefined);
  } catch {}
}

export function identify(userId: string) {
  try {
    if (typeof window === "undefined" || !posthog.__loaded) return;
    // Account id only — no email or name is sent to PostHog.
    if (posthog.get_distinct_id() !== userId) posthog.identify(userId);
  } catch {}
}

export function resetIdentity() {
  try {
    if (typeof window === "undefined" || !posthog.__loaded) return;
    posthog.reset();
  } catch {}
}
