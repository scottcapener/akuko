"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-[#2a2a2c] rounded-xl p-5 flex flex-col gap-4">
      <h2 className="text-[11px] font-medium tracking-wide uppercase text-[#6b6966]">{title}</h2>
      {children}
    </section>
  );
}

function SaveButton({ loading, onClick }: { loading?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="px-4 py-2 rounded-lg bg-[#c4a882] text-[#18181a] text-xs font-semibold hover:bg-[#d4b892] disabled:opacity-50 transition-colors self-start"
    >
      {loading ? "Saving…" : "Save"}
    </button>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);

  // Profile fields
  const [displayName, setDisplayName] = useState("");
  const [penName, setPenName] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState("");

  // Email
  const [newEmail, setNewEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailMsg, setEmailMsg] = useState("");

  // Password
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState("");

  // Delete
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUser(user);
      setNewEmail(user.email ?? "");

      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, pen_name")
        .eq("id", user.id)
        .single();
      if (profile) {
        setDisplayName(profile.display_name ?? "");
        setPenName(profile.pen_name ?? "");
      }

      // Active sessions aren't easily listable via the anon client;
      // show current session info instead
      const { data: { session } } = await supabase.auth.getSession();
      if (session) setSessions([session]);

      setLoading(false);
    }
    load();
  }, [router, supabase]);

  async function saveProfile() {
    if (!user) return;
    setProfileSaving(true);
    setProfileMsg("");
    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      display_name: displayName.trim(),
      pen_name: penName.trim() || null,
    });
    setProfileSaving(false);
    setProfileMsg(error ? error.message : "Saved.");
  }

  async function saveEmail() {
    setEmailSaving(true);
    setEmailMsg("");
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    setEmailSaving(false);
    setEmailMsg(error ? error.message : "Confirmation sent to new address.");
  }

  async function savePassword() {
    if (newPassword.length < 10) { setPasswordMsg("Minimum 10 characters."); return; }
    setPasswordSaving(true);
    setPasswordMsg("");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordSaving(false);
    setPasswordMsg(error ? error.message : "Password updated.");
    if (!error) setNewPassword("");
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/");
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== "delete") return;
    setDeleting(true);
    // Delete via API route (requires service role key)
    const res = await fetch("/api/account/delete", { method: "POST" });
    if (res.ok) {
      await supabase.auth.signOut();
      router.push("/");
    } else {
      const { error } = await res.json();
      alert(error ?? "Failed to delete account.");
    }
    setDeleting(false);
  }

  if (loading) {
    return <div className="min-h-full bg-[#18181a]" />;
  }

  return (
    <div className="min-h-full bg-[#18181a] px-6 py-10">
      <div className="max-w-lg mx-auto flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <Link href="/write">
            <Image src="/logo.svg" alt="Akuko" width={72} height={20} className="opacity-60" />
          </Link>
          <button onClick={handleSignOut} className="text-xs text-[#9b9890]/60 hover:text-[#9b9890] transition-colors">
            Sign out
          </button>
        </div>

        <h1 className="text-[#e8e6e3] text-xl font-semibold">Account settings</h1>

        {/* Profile */}
        <Section title="Profile">
          <div>
            <Label>Display name</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
          </div>
          <div>
            <Label>Pen name <span className="normal-case text-[#6b6966]/60">(optional)</span></Label>
            <Input value={penName} onChange={(e) => setPenName(e.target.value)} placeholder="Your writing alias" />
          </div>
          {profileMsg && <p className={`text-xs ${profileMsg === "Saved." ? "text-[#c4a882]" : "text-red-400"}`}>{profileMsg}</p>}
          <SaveButton loading={profileSaving} onClick={saveProfile} />
        </Section>

        {/* Email */}
        <Section title="Email">
          <div>
            <Label>Email address</Label>
            <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
          </div>
          {emailMsg && <p className={`text-xs ${emailMsg.includes("Confirmation") ? "text-[#c4a882]" : "text-red-400"}`}>{emailMsg}</p>}
          <SaveButton loading={emailSaving} onClick={saveEmail} />
        </Section>

        {/* Password */}
        <Section title="Password">
          <div>
            <Label>New password</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Minimum 10 characters" />
          </div>
          {passwordMsg && <p className={`text-xs ${passwordMsg === "Password updated." ? "text-[#c4a882]" : "text-red-400"}`}>{passwordMsg}</p>}
          <SaveButton loading={passwordSaving} onClick={savePassword} />
        </Section>

        {/* Active sessions */}
        <Section title="Active sessions">
          {sessions.length === 0 ? (
            <p className="text-xs text-[#9b9890]/60 italic">No session info available.</p>
          ) : (
            sessions.map((s) => (
              <div key={s.access_token.slice(-8)} className="flex items-center justify-between text-xs text-[#9b9890]">
                <span>Current session</span>
                <span className="text-[#6b6966]">
                  Expires {new Date((s.expires_at ?? 0) * 1000).toLocaleDateString()}
                </span>
              </div>
            ))
          )}
        </Section>

        {/* Delete account */}
        <Section title="Danger zone">
          <p className="text-xs text-[#9b9890]">
            Permanently delete your account and all your data. This cannot be undone.
          </p>
          <div>
            <Label>Type &quot;delete&quot; to confirm</Label>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="delete"
            />
          </div>
          <button
            onClick={handleDeleteAccount}
            disabled={deleteConfirm !== "delete" || deleting}
            className="px-4 py-2 rounded-lg bg-red-900/40 text-red-400 text-xs font-semibold hover:bg-red-900/60 disabled:opacity-30 transition-colors self-start"
          >
            {deleting ? "Deleting…" : "Delete account"}
          </button>
        </Section>
      </div>
    </div>
  );
}
