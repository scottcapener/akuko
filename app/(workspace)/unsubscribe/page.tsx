"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";

// Where an email's "unsubscribe" link lands (SHARED_WITH_YOU.md §5/§6). We mint
// no tokens (§4), so we identify the person the only safe way we can — by their
// signed-in session — then flip the matching preference off. `?pref=comment`
// targets comment notifications; anything else (incl. the bare link the share
// email carries) targets share notifications. Logged-out visitors go through the
// normal auth gate first (?next=…) and land back here. Re-subscribing is one
// click, or via Settings › Notifications.

type State = "working" | "done" | "error";

/** The preference each unsubscribe link controls — kept apart so muting comment
 *  emails never also mutes share emails, and vice versa. */
const PREFS = {
  comment: { field: "notifyOnComment", label: "when someone comments on a chapter you shared" },
  share: { field: "notifyOnShare", label: "when someone shares a chapter with you" },
} as const;

// useSearchParams (?pref=…) opts this into client-side rendering, so it must sit
// under a Suspense boundary or the prerender build errors.
export default function UnsubscribePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-full bg-bg flex items-center justify-center px-6 py-16">
          <p className="text-subtle text-sm">Updating your preferences…</p>
        </div>
      }
    >
      <UnsubscribeInner />
    </Suspense>
  );
}

function UnsubscribeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pref = searchParams.get("pref") === "comment" ? PREFS.comment : PREFS.share;
  const [state, setState] = useState<State>("working");
  const [resubscribed, setResubscribed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard StrictMode's double-invoke
    ran.current = true;
    const supabase = createClient();
    (async () => {
      await ensureDevSession(supabase);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace(`/login?next=/unsubscribe?pref=${searchParams.get("pref") ?? ""}`);
        return;
      }
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [pref.field]: false }),
      });
      setState(res.ok ? "done" : "error");
    })();
  }, [router, searchParams, pref.field]);

  async function resubscribe() {
    const res = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [pref.field]: true }),
    });
    if (res.ok) setResubscribed(true);
  }

  return (
    <div className="min-h-full bg-bg flex items-center justify-center px-6 py-16">
      <div className="max-w-sm w-full flex flex-col items-center text-center gap-4">
        {state === "working" && <p className="text-subtle text-sm">Updating your preferences…</p>}

        {state === "error" && (
          <>
            <p className="text-text text-lg font-medium">Something went wrong</p>
            <p className="text-subtle text-sm">
              We couldn’t update your notifications. You can change them in{" "}
              <Link href="/settings" className="text-accent hover:underline">Settings</Link>.
            </p>
          </>
        )}

        {state === "done" && !resubscribed && (
          <>
            <p className="text-text text-lg font-medium">You’re unsubscribed</p>
            <p className="text-subtle text-sm leading-relaxed">
              You won’t get emails {pref.label}. You’ll still see shared chapters and comments in the
              app. Manage this anytime in{" "}
              <Link href="/settings" className="text-accent hover:underline">Settings › Notifications</Link>.
            </p>
            <button onClick={resubscribe} className="text-accent hover:underline text-sm">
              Changed your mind? Re-subscribe
            </button>
          </>
        )}

        {state === "done" && resubscribed && (
          <>
            <p className="text-text text-lg font-medium">You’re subscribed again</p>
            <p className="text-subtle text-sm">
              You’ll get share notifications by email. Manage them in{" "}
              <Link href="/settings" className="text-accent hover:underline">Settings</Link>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
