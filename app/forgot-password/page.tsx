"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-medium tracking-wide uppercase text-subtle mb-1.5">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-panel text-text text-base px-3 py-2.5 rounded-lg border border-hover placeholder:text-subtle/50 focus:outline-none focus:border-accent/60 transition-colors ${props.className ?? ""}`}
    />
  );
}

function PrimaryButton({
  children,
  loading,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className="w-full py-2.5 rounded-lg bg-accent text-on-accent text-sm font-semibold tracking-wide hover:bg-accent-hi disabled:opacity-50 transition-colors"
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

export default function ForgotPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    setError("");
    if (!email.trim()) { setError("Email is required."); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin}/auth/callback?next=/reset-password`,
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setSent(true);
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-bg px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex justify-center">
          <Link href="/">
            <Image src="/logo-L.svg" alt="Hot Cocoa" width={90} height={52} />
          </Link>
        </div>

        {sent ? (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-text text-lg font-semibold">Check your email</h1>
              <p className="text-subtle text-sm mt-2">
                If an account exists for <span className="text-text/70">{email}</span>, we&apos;ve sent a password reset link. Check your inbox.
              </p>
            </div>
            <Link href="/login" className="text-center text-xs text-subtle/60 hover:text-subtle">
              ← Back to login
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-text text-lg font-semibold">Reset your password</h1>
              <p className="text-subtle text-xs mt-1">Enter your email and we&apos;ll send you a reset link.</p>
            </div>
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              />
            </div>
            {error && <p className="text-error text-xs">{error}</p>}
            <PrimaryButton loading={loading} onClick={handleSubmit}>Send reset link</PrimaryButton>
            <Link href="/login" className="text-center text-xs text-subtle/60 hover:text-subtle">
              ← Back to login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
