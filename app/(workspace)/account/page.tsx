"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import type { Scene } from "@/lib/types";
import { Avatar } from "@/components/ui";
import SceneBlock from "@/components/SceneBlock";
import AvatarCropModal from "@/components/AvatarCropModal";
import { SceneDragProvider } from "@/lib/useSceneDrag";
import {
  getProfile,
  uploadAvatar,
  removeAvatarFile,
  type Profile,
} from "@/lib/profile";

const BIO_SAVE_DEBOUNCE_MS = 700;

// A labelled field: small uppercase caption over its value/control.
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-label-m uppercase text-subtle">{label}</span>
      {children}
    </div>
  );
}

export default function AccountPage() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Edit-profile mode: avatar, display name, and pen name become editable
  // together, committed on Done.
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPen, setDraftPen] = useState("");
  const [draftAvatarUrl, setDraftAvatarUrl] = useState<string | null>(null);
  const [draftAvatarPath, setDraftAvatarPath] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Crop step: a picked-but-not-yet-uploaded image awaiting framing.
  const [cropSrc, setCropSrc] = useState<{ url: string; name: string } | null>(null);

  // Author Bio autosave (independent of edit mode, like the Synopsis).
  const [bioStatus, setBioStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const bioTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bioRef = useRef("");

  // Reset password
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMsg, setResetMsg] = useState("");

  // Delete account
  const [deleteStep, setDeleteStep] = useState<"idle" | "confirm">("idle");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push("/login"); return; }
      setUser(user);
      const p = await getProfile(user.id);
      setProfile(p);
      bioRef.current = p.bio;
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const memberDays = user
    ? Math.max(0, Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86_400_000))
    : 0;

  // ── Edit profile ──────────────────────────────────────────────
  function startEditing() {
    if (!profile) return;
    setDraftName(profile.displayName);
    setDraftPen(profile.penName);
    setDraftAvatarUrl(profile.avatarUrl);
    setDraftAvatarPath(profile.avatarPath);
    setProfileError("");
    setEditing(true);
  }

  // Picking a file no longer uploads directly — it opens the crop modal, which
  // frames the image and hands back a small square JPEG to upload.
  function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setProfileError("");
    setCropSrc({ url: URL.createObjectURL(file), name: file.name });
  }

  function closeCrop() {
    if (cropSrc) URL.revokeObjectURL(cropSrc.url);
    setCropSrc(null);
  }

  async function handleCropConfirm(cropped: File) {
    if (!user) return;
    setUploadingAvatar(true);
    try {
      const { path, signedUrl } = await uploadAvatar(user.id, cropped);
      setDraftAvatarPath(path);
      setDraftAvatarUrl(signedUrl);
      closeCrop();
    } catch {
      setProfileError("Couldn’t upload that image. Try another.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  // Release the object URL if we unmount while a crop is still open.
  useEffect(() => {
    return () => { if (cropSrc) URL.revokeObjectURL(cropSrc.url); };
  }, [cropSrc]);

  async function saveProfile() {
    if (!profile) return;
    const name = draftName.trim();
    if (!name) { setProfileError("Display name is required."); return; }

    setSavingProfile(true);
    setProfileError("");
    const avatarChanged = draftAvatarPath !== profile.avatarPath;
    const res = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: name,
        penName: draftPen,
        ...(avatarChanged ? { avatarPath: draftAvatarPath } : {}),
      }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setProfileError(json.error ?? "Couldn’t save. Try again.");
      setSavingProfile(false);
      return;
    }

    // Clean up the replaced avatar object (best-effort).
    if (avatarChanged && profile.avatarPath) {
      removeAvatarFile(profile.avatarPath).catch(() => {});
    }

    setProfile({
      ...profile,
      displayName: name,
      penName: draftPen.trim(),
      avatarPath: draftAvatarPath,
      avatarUrl: draftAvatarUrl,
    });
    setSavingProfile(false);
    setEditing(false);
  }

  // ── Author Bio ────────────────────────────────────────────────
  const handleBioChange = useCallback(
    (_chapterId: string, _sceneId: string, patch: Partial<Scene>) => {
      if (patch.body === undefined) return;
      bioRef.current = patch.body;
      setBioStatus("saving");
      if (bioTimer.current) clearTimeout(bioTimer.current);
      bioTimer.current = setTimeout(async () => {
        const res = await fetch("/api/account/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bio: bioRef.current }),
        });
        setBioStatus(res.ok ? "saved" : "error");
      }, BIO_SAVE_DEBOUNCE_MS);
    },
    []
  );

  // ── Account actions ───────────────────────────────────────────
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

  if (loading || !profile) return <div className="min-h-full bg-bg" />;

  const bioScene: Scene = { id: "author-bio", label: "", body: profile.bio, updatedAt: "" };
  const displayAvatarUrl = editing ? draftAvatarUrl : profile.avatarUrl;
  const displayName = editing ? draftName : profile.displayName;

  return (
    <div className="relative min-h-full bg-bg flex flex-col">
      {/* Bio save indicator (mirrors the editor's) */}
      {bioStatus !== "idle" && (
        <div
          className={`absolute top-4 right-5 text-[10px] uppercase tracking-widest z-10 ${
            bioStatus === "saving" ? "text-subtle" : bioStatus === "error" ? "text-error" : "text-accent"
          }`}
        >
          {bioStatus === "saving" ? "Saving…" : bioStatus === "error" ? "Save failed" : "Saved"}
        </div>
      )}

      <div className="flex-1 w-full max-w-2xl mx-auto px-6 py-12 flex flex-col gap-9">

        {/* ── Identity header ── */}
        <div className="flex flex-col items-center text-center gap-4 md:flex-row md:text-left md:gap-5">
          {editing ? (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative rounded-full group focus:outline-none focus:ring-2 focus:ring-accent/50"
              title="Change profile picture"
            >
              <Avatar name={displayName} src={displayAvatarUrl} size={88} />
              <span className="absolute inset-0 rounded-full bg-scrim/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-on-accent text-[11px] font-medium">
                  {uploadingAvatar ? "…" : "Change"}
                </span>
              </span>
            </button>
          ) : (
            <Avatar name={displayName} src={displayAvatarUrl} size={88} />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarPick}
            className="hidden"
          />

          <div className="w-full md:flex-1 md:min-w-0 flex flex-col gap-1">
            {editing ? (
              <>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Display name"
                  maxLength={80}
                  className="w-full bg-transparent text-heading-xl text-text placeholder:text-subtle/40 border-b border-border-subtle focus:border-accent/50 focus:outline-none pb-0.5 text-center md:text-left"
                />
                <input
                  value={draftPen}
                  onChange={(e) => setDraftPen(e.target.value)}
                  placeholder="Pen name"
                  maxLength={80}
                  className="w-full bg-transparent text-body-m text-subtle placeholder:text-subtle/40 border-b border-border-subtle focus:border-accent/50 focus:outline-none pb-0.5 text-center md:text-left"
                />
              </>
            ) : (
              <>
                <h1 className="text-heading-xl text-text truncate">
                  {profile.displayName || "—"}
                </h1>
                {profile.penName && (
                  <p className="text-body-m text-subtle truncate">{profile.penName}</p>
                )}
              </>
            )}
          </div>

          {editing ? (
            <button
              onClick={saveProfile}
              disabled={savingProfile || uploadingAvatar}
              className="flex-shrink-0 px-4 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:bg-accent-hi disabled:opacity-50 transition-colors"
            >
              {savingProfile ? "Saving…" : "Done"}
            </button>
          ) : (
            <button
              onClick={startEditing}
              className="flex-shrink-0 px-4 py-2 rounded-lg bg-accent text-on-accent text-xs font-semibold hover:bg-accent-hi transition-colors"
            >
              Edit profile
            </button>
          )}
        </div>

        {profileError && (
          <p className="-mt-4 text-xs text-error text-center md:text-left">{profileError}</p>
        )}

        {/* ── Author Bio ── a fixed, Synopsis-style scene. Wrapped only to
            satisfy SceneBlock's drag context; the locked variant never drags. */}
        <SceneDragProvider>
          <SceneBlock
            scene={bioScene}
            chapterId="profile"
            index={0}
            onSceneChange={handleBioChange}
            fixedLabel="Author bio"
            placeholder="Write here…"
          />
        </SceneDragProvider>

        {/* ── Member for ── */}
        <div className="rounded bg-panel p-8 flex flex-col">
          <span className="text-body-m text-subtle">Member for</span>
          <span className="mt-3 font-serif text-[33px] leading-none text-text tabular-nums">
            {memberDays} {memberDays === 1 ? "day" : "days"}
          </span>
        </div>

        {/* ── Email ── */}
        <Field label="Email">
          <span className="text-sm text-text">{user?.email ?? "—"}</span>
        </Field>

        {/* ── Password ── */}
        <Field label="Password">
          <p className="text-xs text-subtle">
            We&apos;ll send a reset link to your email address. Follow the steps to set a new password.
          </p>
          {resetMsg && (
            <p className={`text-xs ${resetMsg.startsWith("Reset link") ? "text-accent" : "text-error"}`}>
              {resetMsg}
            </p>
          )}
          <button
            onClick={handleResetPassword}
            disabled={resetLoading}
            className="self-start mt-1 px-4 py-2 rounded-lg bg-panel border border-border-subtle text-text text-xs font-medium hover:border-accent/40 disabled:opacity-50 transition-colors"
          >
            {resetLoading ? "Sending…" : "Send reset link"}
          </button>
        </Field>

        {/* ── Log out ── */}
        <button
          onClick={handleSignOut}
          className="self-start text-sm text-text hover:text-accent transition-colors"
        >
          Log out
        </button>

        {/* ── Danger zone ── */}
        <div className="flex flex-col gap-2">
          <span className="text-label-m uppercase text-subtle">Danger zone</span>
          {deleteStep === "idle" && (
            <button
              onClick={() => setDeleteStep("confirm")}
              className="self-start text-sm text-error/80 hover:text-error transition-colors"
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
      </div>

      {/* ── Footer ── */}
      <footer className="w-full max-w-2xl mx-auto px-6 py-6 flex items-center justify-between text-[11px] text-subtle/60">
        <span>© {new Date().getFullYear()} Hot Cocoa</span>
        <div className="flex items-center gap-3">
          <Link href="/terms" className="hover:text-accent transition-colors">Terms of Service</Link>
          <span className="text-subtle/30">·</span>
          <Link href="/privacy" className="hover:text-accent transition-colors">Privacy Policy</Link>
        </div>
      </footer>

      {cropSrc && (
        <AvatarCropModal
          imageUrl={cropSrc.url}
          fileName={cropSrc.name}
          busy={uploadingAvatar}
          onCancel={closeCrop}
          onConfirm={handleCropConfirm}
        />
      )}
    </div>
  );
}
