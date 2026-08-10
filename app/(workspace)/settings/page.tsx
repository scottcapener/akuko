"use client";

import type { ReactNode } from "react";
import { useLocalStorageState } from "@/lib/useLocalStorageState";
import { useTheme } from "@/lib/useTheme";

// ── Toggle row ────────────────────────────────────────────────────────────────
// Same switch treatment as the writer's ••• menu, so a preference flipped here
// looks and behaves identically to flipping it there. Both write the same
// localStorage keys, so the writer picks the change up on its next mount.

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  onChange: () => void;
}) {
  // Row is a plain container (not one big button) so the description can hold a
  // link — an <a> nested inside a <button> would be invalid HTML. The label and
  // the switch are each their own toggle target; the switch carries the semantics.
  return (
    <div className="flex w-full items-center justify-between gap-4 py-3">
      <span className="flex flex-col gap-0.5 min-w-0">
        <button onClick={onChange} className="text-sm text-text text-left w-fit">
          {label}
        </button>
        <span className="text-xs text-subtle">{description}</span>
      </span>
      <button
        onClick={onChange}
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

export default function SettingsPage() {
  const [scenesVisible, setScenesVisible] = useLocalStorageState("hc.scenesVisible", true);
  const [linksVisible, setLinksVisible] = useLocalStorageState("hc.linksVisible", true);
  const [tipsEnabled, setTipsEnabled] = useLocalStorageState("hc.tipsEnabled", true);
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-full bg-bg px-6 py-10">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">

        <div className="flex flex-col gap-1">
          <h1 className="text-text text-xl font-semibold">Settings</h1>
          <p className="text-xs text-subtle leading-relaxed">
            Display preferences for the writer. These apply across your books on this device.
          </p>
        </div>

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
                  target="_blank"
                  rel="noopener noreferrer"
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
    </div>
  );
}
