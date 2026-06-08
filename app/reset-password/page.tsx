"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

export default function ResetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setReady(true);
      } else {
        router.replace("/forgot-password");
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

  if (!ready) return <div className="min-h-full bg-[#100F0F]" />;

  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-[#100F0F] px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex justify-center">
          <Link href="/">
            <Image src="/logo-L.svg" alt="Hakuko" width={98} height={25} />
          </Link>
        </div>

        {done ? (
          <p className="text-[#E1E1DF] text-sm text-center">Password updated. Redirecting…</p>
        ) : (
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
        )}
      </div>
    </div>
  );
}
