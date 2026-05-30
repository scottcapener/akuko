"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ── Password strength ───────────────────────────────────────────────────────

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score, label: "Weak", color: "#ef4444" };
  if (score <= 2) return { score, label: "Fair", color: "#f59e0b" };
  if (score <= 3) return { score, label: "Good", color: "#84cc16" };
  return { score, label: "Strong", color: "#c4a882" };
}

// ── Shared UI atoms ─────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-medium tracking-wide uppercase text-[#6b6966] mb-1.5">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-[#1f1f21] text-[#e8e6e3] text-sm px-3 py-2.5 rounded-lg border border-[#2a2a2c] placeholder:text-[#9b9890]/40 focus:outline-none focus:border-[#c4a882]/60 transition-colors ${props.className ?? ""}`}
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
      className="w-full py-2.5 rounded-lg bg-[#c4a882] text-[#18181a] text-sm font-semibold tracking-wide hover:bg-[#d4b892] disabled:opacity-50 transition-colors"
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  return <p className="text-red-400 text-xs mt-2">{msg}</p>;
}

// ── Steps ───────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4;

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const strength = passwordStrength(password);

  // Step 2
  const [phone, setPhone] = useState("");

  // Step 3
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // Step 4
  const [displayName, setDisplayName] = useState("");
  const [penName, setPenName] = useState("");

  // ── Handlers ──────────────────────────────────────────────────────────

  async function handleStep1() {
    setError("");
    if (!email.trim()) { setError("Email is required."); return; }
    if (password.length < 10) { setError("Password must be at least 10 characters."); return; }
    setLoading(true);
    // Sign up creates the user and sends email confirmation (we'll also enroll phone)
    const { error: err } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setStep(2);
  }

  async function handleStep2() {
    setError("");
    // Normalise: ensure starts with +
    const normalised = phone.trim().startsWith("+") ? phone.trim() : `+${phone.trim()}`;
    if (normalised.length < 8) { setError("Enter a valid international phone number."); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.signInWithOtp({ phone: normalised });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setPhone(normalised);
    setResendCooldown(60);
    setStep(3);
  }

  async function handleStep3() {
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
    setStep(4);
  }

  async function handleResend() {
    setError("");
    const { error: err } = await supabase.auth.signInWithOtp({ phone });
    if (err) { setError(err.message); return; }
    setResendCooldown(60);
  }

  async function handleStep4() {
    setError("");
    if (!displayName.trim()) { setError("Display name is required."); return; }
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError("Session expired. Please start again."); setLoading(false); return; }

    // Create profile
    const { error: profileErr } = await supabase.from("profiles").upsert({
      id: user.id,
      display_name: displayName.trim(),
      pen_name: penName.trim() || null,
    });
    if (profileErr) { setError(profileErr.message); setLoading(false); return; }

    // Create first book + chapter
    const { data: book, error: bookErr } = await supabase
      .from("books")
      .insert({ user_id: user.id, title: "Untitled Book" })
      .select()
      .single();
    if (bookErr) { setError(bookErr.message); setLoading(false); return; }

    const { data: chapter, error: chapterErr } = await supabase
      .from("chapters")
      .insert({ book_id: book.id, title: "Chapter 1", position: 0 })
      .select()
      .single();
    if (chapterErr) { setError(chapterErr.message); setLoading(false); return; }

    await supabase.from("scenes").insert({
      chapter_id: chapter.id, label: "", body: "", position: 0,
    });

    setLoading(false);
    router.push("/write");
  }

  // ── Render ────────────────────────────────────────────────────────────

  const stepLabel = ["", "Account", "Phone", "Verify", "Profile"][step];
  const stepProgress = (step / 4) * 100;

  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-[#18181a] px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-4">
          <Link href="/">
            <Image src="/logo.svg" alt="Akuko" width={80} height={23} className="opacity-60" />
          </Link>
          <div className="w-full">
            <div className="flex justify-between text-[10px] text-[#6b6966] uppercase tracking-wide mb-1.5">
              <span>{stepLabel}</span>
              <span>{step} / 4</span>
            </div>
            <div className="h-px bg-[#2a2a2c] rounded-full overflow-hidden">
              <div
                className="h-full bg-[#c4a882] rounded-full transition-all duration-300"
                style={{ width: `${stepProgress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Step 1 — Email + password */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <h1 className="text-[#e8e6e3] text-lg font-semibold">Create your account</h1>
            <div>
              <Label>Email</Label>
              <Input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleStep1()} />
            </div>
            <div>
              <Label>Password</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Minimum 10 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleStep1()}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9b9890]/60 hover:text-[#9b9890] text-xs"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              {password.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-0.5 bg-[#2a2a2c] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${(strength.score / 5) * 100}%`,
                        backgroundColor: strength.color,
                      }}
                    />
                  </div>
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: strength.color }}>
                    {strength.label}
                  </span>
                </div>
              )}
            </div>
            <ErrorMsg msg={error} />
            <PrimaryButton loading={loading} onClick={handleStep1}>Continue</PrimaryButton>
            <p className="text-center text-[#9b9890]/60 text-xs">
              Already have an account?{" "}
              <Link href="/login" className="text-[#9b9890] hover:text-[#c4a882] underline underline-offset-2">Log in</Link>
            </p>
          </div>
        )}

        {/* Step 2 — Phone */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-[#e8e6e3] text-lg font-semibold">Add your phone</h1>
              <p className="text-[#9b9890] text-xs mt-1">We'll send a one-time code to verify.</p>
            </div>
            <div>
              <Label>Phone number (international format)</Label>
              <Input
                type="tel"
                autoComplete="tel"
                placeholder="+1 555 000 0000"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStep2()}
              />
            </div>
            <ErrorMsg msg={error} />
            <PrimaryButton loading={loading} onClick={handleStep2}>Send code</PrimaryButton>
          </div>
        )}

        {/* Step 3 — OTP */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-[#e8e6e3] text-lg font-semibold">Enter the code</h1>
              <p className="text-[#9b9890] text-xs mt-1">Sent to {phone}. Valid for 10 minutes.</p>
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
                onKeyDown={(e) => e.key === "Enter" && handleStep3()}
              />
            </div>
            <ErrorMsg msg={error} />
            <PrimaryButton loading={loading} onClick={handleStep3}>Verify</PrimaryButton>
            <button
              className="text-xs text-[#9b9890]/60 hover:text-[#9b9890] transition-colors disabled:opacity-40"
              disabled={resendCooldown > 0}
              onClick={handleResend}
            >
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}
            </button>
          </div>
        )}

        {/* Step 4 — Display name */}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-[#e8e6e3] text-lg font-semibold">One last thing</h1>
              <p className="text-[#9b9890] text-xs mt-1">How should we call you?</p>
            </div>
            <div>
              <Label>Display name</Label>
              <Input
                type="text"
                autoComplete="name"
                placeholder="Your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStep4()}
              />
            </div>
            <div>
              <Label>Pen name <span className="normal-case text-[#6b6966]/60">(optional)</span></Label>
              <Input
                type="text"
                placeholder="Your writing alias"
                value={penName}
                onChange={(e) => setPenName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStep4()}
              />
            </div>
            <ErrorMsg msg={error} />
            <PrimaryButton loading={loading} onClick={handleStep4}>Start writing</PrimaryButton>
          </div>
        )}
      </div>
    </div>
  );
}
