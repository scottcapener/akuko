"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { redeemShares } from "@/lib/shared/redeem";
import { Button, Input, Label, PasswordInput } from "@/components/ui";

// ── Password strength ───────────────────────────────────────────────────────

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  if (score <= 1) return { score, label: "Weak", color: "var(--hc-error)" };
  if (score <= 2) return { score, label: "Fair", color: "var(--hc-warning)" };
  if (score <= 3) return { score, label: "Good", color: "var(--hc-success)" };
  return { score, label: "Strong", color: "var(--hc-accent)" };
}

function ErrorMsg({ msg }: { msg: string }) {
  if (!msg) return null;
  return <p className="text-error text-xs mt-2">{msg}</p>;
}

// ── Steps ───────────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3;

export default function SignupPage() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const strength = passwordStrength(password);

  // Step 2 — email verification code
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // Step 3 — profile
  const [displayName, setDisplayName] = useState("");
  const [penName, setPenName] = useState("");

  // ── Detect returning user from email confirmation ──────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) return;
      // Already has a session. If their profile is complete, they're a
      // finished user who shouldn't be here — send them to the editor.
      const { data: profile, error } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", user.id)
        .maybeSingle();
      // A failed fetch must not be read as "profile incomplete" — bail rather
      // than dropping a finished user into the profile step.
      if (error) return;
      if (profile?.display_name) {
        router.replace("/write");
        return;
      }
      // Mid-signup (email confirmed, profile not finished) — resume at profile step.
      if (step === 1) setStep(3);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────

  async function handleStep1() {
    setError("");
    if (!email.trim()) { setError("Email is required."); return; }
    if (password.length < 10) { setError("Password must be at least 10 characters."); return; }
    setLoading(true);
    // Creates the user and emails a 6-digit confirmation code.
    const { error: err } = await supabase.auth.signUp({ email: email.trim(), password });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setResendCooldown(60);
    setStep(2);
  }

  async function handleStep2() {
    setError("");
    if (otp.trim().length !== 6) { setError("Enter the 6-digit code."); return; }
    setLoading(true);
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp.trim(),
      type: "signup",
    });
    setLoading(false);
    if (err) { setError(err.message); return; }
    setStep(3);
  }

  async function handleResend() {
    setError("");
    const { error: err } = await supabase.auth.resend({ type: "signup", email: email.trim() });
    if (err) { setError(err.message); return; }
    setResendCooldown(60);
  }

  async function handleStep3() {
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

    // Redeem any chapters shared to this email before the account existed (§4).
    await redeemShares(supabase);

    // A returning user (e.g. a legacy account with no display_name, or one
    // bounced here mid-session) may already have books. Only scaffold a starter
    // book for genuinely new accounts — never create a duplicate, which would
    // make an existing user think their library was replaced.
    const { count: bookCount, error: countErr } = await supabase
      .from("books")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if (countErr) { setError(countErr.message); setLoading(false); return; }
    if ((bookCount ?? 0) > 0) {
      setLoading(false);
      router.push("/write");
      return;
    }

    // Create first book + section + chapter
    const { data: book, error: bookErr } = await supabase
      .from("books")
      .insert({ user_id: user.id, title: "Untitled Book" })
      .select()
      .single();
    if (bookErr) { setError(bookErr.message); setLoading(false); return; }

    const { data: section, error: sectionErr } = await supabase
      .from("sections")
      .insert({ book_id: book.id, label: "Chapters", position: 0 })
      .select()
      .single();
    if (sectionErr) { setError(sectionErr.message); setLoading(false); return; }

    const { data: chapter, error: chapterErr } = await supabase
      .from("chapters")
      .insert({ book_id: book.id, section_id: section.id, title: "Chapter 1", position: 0 })
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

  const stepLabel = ["", "Account", "Verify", "Profile"][step];
  const stepProgress = (step / 3) * 100;

  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-bg px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-4">
          <Link href="/">
            <Image src="/logo-L.svg" alt="Hot Cocoa" width={90} height={52} />
          </Link>
          <div className="w-full">
            <div className="flex justify-between text-[10px] text-subtle uppercase tracking-wide mb-1.5">
              <span>{stepLabel}</span>
              <span>{step} / 3</span>
            </div>
            <div className="h-px bg-border-subtle rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-300"
                style={{ width: `${stepProgress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Step 1 — Email + password */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <h1 className="text-text text-lg font-semibold">Create your account</h1>
            <div>
              <Label>Email</Label>
              <Input type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleStep1()} />
            </div>
            <div>
              <Label>Password</Label>
              <PasswordInput
                autoComplete="new-password"
                placeholder="Minimum 10 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStep1()}
              />
              {password.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-0.5 bg-border-subtle rounded-full overflow-hidden">
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
            <Button loading={loading} onClick={handleStep1}>Continue</Button>
            <p className="text-center text-subtle/50 text-[11px] leading-5">
              By creating an account, you agree to our{" "}
              <Link href="/terms" className="text-subtle hover:text-accent underline underline-offset-2">Terms of Service</Link>
              {" "}and{" "}
              <Link href="/privacy" className="text-subtle hover:text-accent underline underline-offset-2">Privacy Policy</Link>.
            </p>
            <p className="text-center text-subtle/60 text-xs">
              Already have an account?{" "}
              <Link href="/login" className="text-subtle hover:text-accent underline underline-offset-2">Log in</Link>
            </p>
          </div>
        )}

        {/* Step 2 — Email verification code */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-text text-lg font-semibold">Check your email</h1>
              <p className="text-subtle text-xs mt-1">We sent a 6-digit code to {email}. Valid for 1 hour.</p>
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
                onKeyDown={(e) => e.key === "Enter" && handleStep2()}
              />
            </div>
            <ErrorMsg msg={error} />
            <Button loading={loading} onClick={handleStep2}>Verify</Button>
            <button
              className="text-xs text-subtle/60 hover:text-subtle transition-colors disabled:opacity-40"
              disabled={resendCooldown > 0}
              onClick={handleResend}
            >
              {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}
            </button>
          </div>
        )}

        {/* Step 3 — Display name */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div>
              <h1 className="text-text text-lg font-semibold">One last thing</h1>
              <p className="text-subtle text-xs mt-1">What should we call you?</p>
            </div>
            <div>
              <Label>Display name</Label>
              <Input
                type="text"
                autoComplete="name"
                placeholder="Your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStep3()}
              />
            </div>
            <div>
              <Label>Pen name <span className="normal-case text-subtle/60">(optional)</span></Label>
              <Input
                type="text"
                placeholder="Your writing alias"
                value={penName}
                onChange={(e) => setPenName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleStep3()}
              />
            </div>
            <ErrorMsg msg={error} />
            <Button loading={loading} onClick={handleStep3}>Start writing</Button>
          </div>
        )}
      </div>
    </div>
  );
}
