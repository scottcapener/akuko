"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "hc.installHintDismissed";

// One-time hint for iOS Safari users to add Hot Cocoa to their Home Screen — the
// install path that unlocks reliable offline use on iOS (durable storage +
// cold-open; see OFFLINE.md §5.1). Shown only on iOS, only outside standalone
// mode, and only until dismissed. Other platforms surface the browser's own
// install affordance, so no custom prompt is needed there.
export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {}
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isIOS && !standalone) setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setShow(false);
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-xl border border-border-subtle bg-panel p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-sm text-text">
          Add Hot Cocoa to your Home Screen to keep writing offline: tap the Share button, then{" "}
          <span className="font-medium">Add to Home Screen</span>.
        </p>
        <button onClick={dismiss} className="text-sm text-subtle hover:text-text" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  );
}
