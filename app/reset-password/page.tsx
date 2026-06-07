"use client";

import { useState, useEffect, Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-medium tracking-wide uppercase text-[#413E3C] mb-1.5">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-[#1C1B1B] text-[#E1E1DF] text-sm px-3 py-2.5 rounded-lg border border-[#252220] placeholder:text-[#413E3C]/50 focus:outline-none focus:border-[#755C4B]/60 transition-colors ${props.className ?? ""}`}
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
      className="w-full py-2.5 rounded-lg bg-[#755C4B] text-[#E1E1DF] text-sm font-semibold tracking-wide hover:bg-[#8B6D5A] disabled:opacity-50 transition-colors"
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

function ResetPasswordForm() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ready, setReady] = useState(false);
  const [exchangeError, setExchangeError] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const code = searchParams.get("code");
    if (!code) {
      setExchangeError("Invalid or expired reset link. Please request a new one.");
      return;
    }
    supabase.auth.exchangeCodeForSession(code).then(({ error: err }) => {
      if (err) {
        setExchangeError("This reset link has expired. Please request a new one.");
      } else {
        setReady(true);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleReset() {
    setError("");
    if (password.length < 10) { setError("Password must be at least 10 characters."); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setDone(true);
    setTimeout(() => router.push("/write"), 1500);
  }

  if (exchangeError) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-red-400 text-sm">{exchangeError}</p>
        <Link href="/forgot-password" className="text-center text-xs text-[#413E3C]/60 hover:text-[#413E3C]">
          Request a new reset link
        </Link>
      </div>
    );
  }

  if (!ready) {
    return <p className="text-[#413E3C] text-sm">Verifying link…</p>;
  }

  if (done) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[#E1E1DF] text-sm">Password updated. Redirecting…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[#E1E1DF] text-lg font-semibold">Set a new password</h1>
        <p className="text-[#413E3C] text-xs mt-1">Minimum 10 characters.</p>
      </div>
      <div>
        <Label>New password</Label>
        <Input
          type="password"
          autoComplete="new-password"
          placeholder="Minimum 10 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleReset()}
        />
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
      <PrimaryButton loading={loading} onClick={handleReset}>Update password</PrimaryButton>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-[#100F0F] px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex justify-center">
          <Link href="/">
            <Image src="/hakuko-logo-large.svg" alt="Hakuko" width={75} height={19} className="opacity-60" />
          </Link>
        </div>
        <Suspense fallback={<p className="text-[#413E3C] text-sm">Loading…</p>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
