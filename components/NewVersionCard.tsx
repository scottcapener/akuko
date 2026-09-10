"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useUpdateAvailable } from "@/lib/useUpdateAvailable";

// ── New version card ──────────────────────────────────────────────────────────
// Floats at the bottom of the book panel, below the Tips card. Appears when a
// newer build has been deployed (see useUpdateAvailable) and offers a one-tap
// refresh. Deliberately minimal — a label + version and a single Update button,
// no dismiss: it's small, out of the way, and simply goes away once the tab is
// refreshed onto the new build.
//
// `onBeforeReload` is the writer's save flush, run best-effort before the reload
// so pending edits land server-side first (they're durable regardless).
export default function NewVersionCard({
  onBeforeReload,
}: {
  onBeforeReload?: () => Promise<void> | void;
}) {
  const { available, version, reloadNow } = useUpdateAvailable(onBeforeReload);
  const [busy, setBusy] = useState(false);

  if (!available) return null;

  const update = async () => {
    setBusy(true);
    await reloadNow(); // navigates away; on the off-chance it doesn't, re-enable
    setBusy(false);
  };

  return (
    <div className="pointer-events-auto rounded-xl border border-border-subtle bg-elevated p-3 shadow-lg">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted">New version available</span>
        {version && <span className="text-[10px] tabular-nums text-subtle">{version}</span>}
      </div>
      <Button onClick={update} disabled={busy} className="mt-2.5">
        {busy ? "Updating…" : "Update"}
      </Button>
    </div>
  );
}
