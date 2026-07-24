"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium tracking-wide uppercase text-subtle">{label}</span>
      <span className="text-sm text-text">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border-subtle" />;
}

export default function AccountPage() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Reset password
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState("");

  // Delete account
  const [deleteStep, setDeleteStep] = useState<"idle" | "confirm">("idle");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.push("/login"); return; }
      setUser(user);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const memberDays = user
    ? Math.max(0, Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86_400_000))
    : 0;

  async function handleResetPassword() {
    if (!user?.email) return;
    setResetLoading(true);
    setResetMsg("");
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback?next=/reset-password`,
    });
    setResetLoading(false);
    setResetMsg(error ? error.message : "Reset link sent — check your email.");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError("");
    const res = await fetch("/api/account/delete", { method: "POST" });
    if (res.ok) {
      await supabase.auth.signOut();
      router.push("/");
    } else {
      const json = await res.json();
      setDeleteError(json.error ?? "Something went wrong.");
      setDeleting(false);
    }
  }

  if (loading) return <div className="min-h-full bg-bg" />;

  return (
    <div className="min-h-full bg-bg px-6 py-10">
      <div className="max-w-sm mx-auto flex flex-col gap-6">

        {/* Back link */}
        <Link href="/write" className="text-xs text-subtle/60 hover:text-subtle transition-colors self-start">
          ← Back to Hot Cocoa
        </Link>

        <h1 className="text-text text-xl font-semibold">Account</h1>

        {/* Info */}
        <div className="border border-border-subtle rounded-xl p-5 flex flex-col gap-4">
          <Row label="Email" value={user?.email ?? "—"} />
          <Divider />
          <Row label="Member for" value={`${memberDays} ${memberDays === 1 ? "day" : "days"}`} />
        </div>

        {/* Password reset */}
        <div className="border border-border-subtle rounded-xl p-5 flex flex-col gap-3">
          <p className="text-[11px] font-medium tracking-wide uppercase text-subtle">Password</p>
          <p className="text-xs text-subtle">We&apos;ll send a reset link to your email address.</p>
          {resetMsg && (
            <p className={`text-xs ${resetMsg.startsWith("Reset link") ? "text-accent" : "text-error"}`}>
              {resetMsg}
            </p>
          )}
          <Button
            variant="secondary"
            onClick={handleResetPassword}
            disabled={resetLoading}
            className="self-start"
          >
            {resetLoading ? "Sending…" : "Send reset link"}
          </Button>
        </div>

        {/* Log out */}
        <div className="border border-border-subtle rounded-xl p-5">
          <button
            onClick={handleSignOut}
            className="text-sm text-accent hover:text-accent-hi transition-colors font-medium"
          >
            Log out
          </button>
        </div>

        {/* Delete account */}
        <div className="border border-border-subtle rounded-xl p-5 flex flex-col gap-3">
          <p className="text-[11px] font-medium tracking-wide uppercase text-subtle">Danger zone</p>

          {deleteStep === "idle" && (
            <button
              onClick={() => setDeleteStep("confirm")}
              className="self-start text-xs text-red-500/70 hover:text-error transition-colors"
            >
              Delete account…
            </button>
          )}

          {deleteStep === "confirm" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-text/80 leading-relaxed">
                This will permanently delete your account and{" "}
                <span className="text-text font-medium">all your books, chapters, and scenes</span>.
                {" "}There is no way to recover your content after this.
              </p>
              {deleteError && <p className="text-xs text-error">{deleteError}</p>}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="px-4 py-2 rounded-lg bg-red-900/40 text-error text-xs font-semibold hover:bg-red-900/60 disabled:opacity-50 transition-colors"
                >
                  {deleting ? "Deleting…" : "Yes, delete everything"}
                </button>
                <button
                  onClick={() => { setDeleteStep("idle"); setDeleteError(""); }}
                  className="text-xs text-subtle/60 hover:text-subtle transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Legal */}
        <div className="flex items-center gap-4 pt-2 text-[11px] text-subtle/60">
          <Link href="/terms" className="hover:text-accent transition-colors">Terms of Service</Link>
          <span className="text-subtle/30">·</span>
          <Link href="/privacy" className="hover:text-accent transition-colors">Privacy Policy</Link>
        </div>

      </div>
    </div>
  );
}
