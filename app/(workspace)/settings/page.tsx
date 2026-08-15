"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { useTheme } from "@/lib/useTheme";
import { createClient } from "@/lib/supabase/client";
import { getProfile } from "@/lib/profile";

// ── Toggle row ────────────────────────────────────────────────────────────────
// Same switch treatment as the writer's ••• menu, so a preference flipped here
// looks and behaves identically to flipping it there. Both write the same
// localStorage keys, so the writer picks the change up on its next mount.

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}) {
  // Row is a plain container (not one big button) so the description can hold a
  // link — an <a> nested inside a <button> would be invalid HTML. The label and
  // the switch are each their own toggle target; the switch carries the semantics.
  return (
    <div className={`flex w-full items-center justify-between gap-4 py-3 ${disabled ? "opacity-50" : ""}`}>
      <span className="flex flex-col gap-0.5 min-w-0">
        <button onClick={onChange} disabled={disabled} className="text-sm text-text text-left w-fit disabled:cursor-default">
          {label}
        </button>
        <span className="text-xs text-subtle">{description}</span>
      </span>
      <button
        onClick={onChange}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={`relative w-9 h-5 rounded-full flex-shrink-0 transition-colors ${checked ? "bg-accent" : "bg-hover"}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? "left-4" : "left-0.5"}`} />
      </button>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-text text-sm font-semibold">{title}</h2>
      <p className="text-xs text-subtle leading-relaxed">{note}</p>
    </div>
  );
}

export default function SettingsPage() {
  const [scenesVisible, setScenesVisible] = useLocalStorageState("hc.scenesVisible", true);
  const [linksVisible, setLinksVisible] = useLocalStorageState("hc.linksVisible", true);
  const [tipsEnabled, setTipsEnabled] = useLocalStorageState("hc.tipsEnabled", true);
  const { theme, toggleTheme } = useTheme();

  // Notification prefs are account-level (they govern email the server sends),
  // so unlike the display toggles above they persist to the profile row, not
  // localStorage. null = still loading.
  const [notifyOnShare, setNotifyOnShare] = useState<boolean | null>(null);
  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const profile = await getProfile(user.id);
      setNotifyOnShare(profile.notifyOnShare);
    })();
  }, []);

  async function toggleNotifyOnShare() {
    if (notifyOnShare === null) return;
    const next = !notifyOnShare;
    setNotifyOnShare(next); // optimistic
    const res = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifyOnShare: next }),
    });
    if (!res.ok) setNotifyOnShare(!next); // revert on failure
  }

  return (
    <div className="min-h-full bg-bg px-6 py-10">
      <div className="max-w-2xl mx-auto flex flex-col gap-8">

        <div className="flex items-center justify-between gap-4">
          <h1 className="text-text text-xl font-semibold">Settings</h1>
          <a href="/updates" className="text-sm text-accent hover:underline flex-shrink-0">
            View updates →
          </a>
        </div>

        <div className="flex flex-col gap-3">
          <SectionHeading
            title="Display"
            note="Writer and workspace preferences. These apply on this device."
          />
          <div className="border border-border-subtle rounded-xl px-5 divide-y divide-border-subtle">
            <ToggleRow
              label="Scenes"
              description="Show scene descriptions and the Add scene button in the book panel."
              checked={scenesVisible}
              onChange={() => setScenesVisible((v) => !v)}
            />
            <ToggleRow
              label="Links"
              description="Show the Links section in the library panel."
              checked={linksVisible}
              onChange={() => setLinksVisible((v) => !v)}
            />
            <ToggleRow
              label="Tips"
              description={
                <>
                  Show a tip in the book panel at the start of each day.
                  <br />
                  <a
                    href="/how-to"
                    className="text-accent hover:underline"
                  >
                    How to use Hot Cocoa →
                  </a>
                </>
              }
              checked={tipsEnabled}
              onChange={() => setTipsEnabled((v) => !v)}
            />
            <ToggleRow
              label="Light mode"
              description="Use the light theme instead of the default dark."
              checked={theme === "light"}
              onChange={toggleTheme}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <SectionHeading
            title="Notifications"
            note="How Hot Cocoa emails you. These apply to your account, everywhere."
          />
          <div className="border border-border-subtle rounded-xl px-5">
            <ToggleRow
              label="Shared with you"
              description="Email me when someone shares a chapter with me."
              checked={notifyOnShare ?? true}
              disabled={notifyOnShare === null}
              onChange={toggleNotifyOnShare}
            />
          </div>
        </div>

      </div>
    </div>
  );
}
