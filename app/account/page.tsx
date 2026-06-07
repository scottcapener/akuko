"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium tracking-wide uppercase text-[#413E3C]">{label}</span>
      <span className="text-sm text-[#E1E1DF]">{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-[#1C1B1B]" />;
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
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/reset-password`,
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

  if (loading) return <div className="min-h-full bg-[#100F0F]" />;

  return (
    <div className="min-h-full bg-[#100F0F] px-6 py-10">
      <div className="max-w-sm mx-auto flex flex-col gap-6">

        {/* Back link */}
        <Link href="/write" className="text-xs text-[#413E3C]/60 hover:text-[#413E3C] transition-colors self-start">
          ← Back to Akuko
        </Link>

        <h1 className="text-[#E1E1DF] text-xl font-semibold">Account</h1>

        {/* Info */}
        <div className="border border-[#1C1B1B] rounded-xl p-5 flex flex-col gap-4">
          <Row label="Email" value={user?.email ?? "—"} />
          <Divider />
          <Row label="Member for" value={`${memberDays} ${memberDays === 1 ? "day" : "days"}`} />
        </div>

        {/* Password reset */}
        <div className="border border-[#1C1B1B] rounded-xl p-5 flex flex-col gap-3">
          <p className="text-[11px] font-medium tracking-wide uppercase text-[#413E3C]">Password</p>
          <p className="text-xs text-[#413E3C]">We&apos;ll send a reset link to your email address.</p>
          {resetMsg && (
            <p className={`text-xs ${resetMsg.startsWith("Reset link") ? "text-[#755C4B]" : "text-red-400"}`}>
              {resetMsg}
            </p>
          )}
          <button
            onClick={handleResetPassword}
            disabled={resetLoading}
            className="self-start px-4 py-2 rounded-lg bg-[#1C1B1B] border border-[#252220] text-[#E1E1DF] text-xs font-medium hover:border-[#755C4B]/40 disabled:opacity-50 transition-colors"
          >
            {resetLoading ? "Sending…" : "Send reset link"}
          </button>
        </div>

        {/* Log out */}
        <div className="border border-[#1C1B1B] rounded-xl p-5">
          <button
            onClick={handleSignOut}
            className="text-sm text-[#755C4B] hover:text-[#8B6D5A] transition-colors font-medium"
          >
            Log out
          </button>
        </div>

        {/* Delete account */}
        <div className="border border-[#1C1B1B] rounded-xl p-5 flex flex-col gap-3">
          <p className="text-[11px] font-medium tracking-wide uppercase text-[#413E3C]">Danger zone</p>

          {deleteStep === "idle" && (
            <button
              onClick={() => setDeleteStep("confirm")}
              className="self-start text-xs text-red-500/70 hover:text-red-400 transition-colors"
            >
              Delete account…
            </button>
          )}

          {deleteStep === "confirm" && (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-[#E1E1DF]/80 leading-relaxed">
                This will permanently delete your account and{" "}
                <span className="text-[#E1E1DF] font-medium">all your books, chapters, and scenes</span>.
                {" "}There is no way to recover your content after this.
              </p>
              {deleteError && <p className="text-xs text-red-400">{deleteError}</p>}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="px-4 py-2 rounded-lg bg-red-900/40 text-red-400 text-xs font-semibold hover:bg-red-900/60 disabled:opacity-50 transition-colors"
                >
                  {deleting ? "Deleting…" : "Yes, delete everything"}
                </button>
                <button
                  onClick={() => { setDeleteStep("idle"); setDeleteError(""); }}
                  className="text-xs text-[#413E3C]/60 hover:text-[#413E3C] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
