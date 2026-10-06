import posthog from "posthog-js";

// PostHog product analytics. Runs once in the browser before hydration (Next's
// instrumentation-client convention). Deliberately minimal — Hot Cocoa holds
// private manuscripts, so we capture behavior (pageviews, writing sessions, word
// counts), never content:
//   - no autocapture (it records the text of clicked elements)
//   - no session replay, no heatmaps, no surveys
//   - events carry counts and ids only — never prose, titles, or names
// Custom events live in lib/analytics.ts and the writer's session tracker.
const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  posthog.init(key, {
    // Same-origin proxy (see rewrites in next.config.ts) so ad blockers don't
    // silently drop writers from the data.
    api_host: "/ingest",
    ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST?.replace(".i.posthog.com", ".posthog.com"),
    defaults: "2025-11-30",
    // Only people we explicitly identify (signed-in accounts) get a profile;
    // anonymous visitors still count in Web Analytics.
    person_profiles: "identified_only",
    autocapture: false,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_session_recording: true,
    disable_surveys: true,
    // Pageviews incl. client-side navigations (history API).
    capture_pageview: "history_change",
    capture_performance: { web_vitals: true },
    // localStorage only — no analytics cookies, keeping the privacy policy's
    // "essential cookies only" promise true.
    persistence: "localStorage",
    loaded: (ph) => {
      ph.register({
        app_version: process.env.NEXT_PUBLIC_APP_VERSION,
        // So local/dev traffic can be filtered out of dashboards.
        environment: process.env.NODE_ENV,
      });
    },
  });
}
