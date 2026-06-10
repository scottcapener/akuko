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
      className={`w-full bg-[#1C1B1B] text-[#E1E1DF] text-base px-3 py-2.5 rounded-lg border border-[#252220] placeholder:text-[#413E3C]/50 focus:outline-none focus:border-[#755C4B]/60 transition-colors ${props.className ?? ""}`}
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

type Step = "credentials" | "otp";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<Step>("credentials");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");

  // Already logged in? Skip the login form.
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) router.replace("/write");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin() {
    setError("");
    if (!email.trim() || !password) { setError("Email and password are required."); return; }
    setLoading(true);

    const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (err) { setError(err.message); return; }

    // Check if MFA / phone factor is enrolled
    const factors = data.user?.factors ?? [];
    const phoneFactor = factors.find((f) => f.factor_type === "phone" && f.status === "verified");

    if (phoneFactor) {
      // Phone enrolled — need OTP challenge
      const { data: phoneData } = await supabase.auth.getUser();
      const userPhone = phoneData.user?.phone ?? "";
      setPhone(userPhone);
      setStep("otp");
      // Send OTP
      await supabase.auth.signInWithOtp({ phone: userPhone });
    } else {
      router.push("/write");
    }
  }

  async function handleOtp() {
    setError("");
    if (otp.trim().length !== 6) { setError("Enter the 6-digit code."); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.verifyOtp({
      phone,
      token: otp.trim(),
      type: "sms",
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    router.push("/write");
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-[#100F0F] px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex justify-center">
          <Link href="/">
            <Image src="/logo-L.svg" alt="Hakuko" width={98} height={25} />
          </Link>
        </div>

        {step === "credentials" && (
          <div className="flex flex-col gap-4">
            <h1 className="text-[#E1E1DF] text-lg font-semibold">Welcome back</h1>
            <div>
              <Label>Email</Label>
              <Input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
            </div>
            <div>
              <Label>Password</Label>
              <Input type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleLogin()} />
              <div className="flex justify-end mt-1.5">
                <Link href="/forgot-password" className="text-[11px] text-[#413E3C]/60 hover:text-[#755C4B] transition-colors">Forgot password?</Link>
              </div>
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <PrimaryButton loading={loading} onClick={handleLogin}>Log in</PrimaryButton>
            <p className="text-center text-[#413E3C]/60 text-xs">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="text-[#413E3C] hover:text-[#755C4B] underline underline-offset-2">Sign up</Link>
            </p>
          </div>
        )}

        {step === "otp" && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-[#E1E1DF] text-lg font-semibold">Verify your phone</h1>
              <p className="text-[#413E3C] text-xs mt-1">A code was sent to {phone}.</p>
            </div>
            <div>
              <Label>6-digit code</Label>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && handleOtp()}
              />
            </div>
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <PrimaryButton loading={loading} onClick={handleOtp}>Verify</PrimaryButton>
            <button className="text-xs text-[#413E3C]/60 hover:text-[#413E3C]" onClick={() => setStep("credentials")}>
              ← Back
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
