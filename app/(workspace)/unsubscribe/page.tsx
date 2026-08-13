"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ensureDevSession } from "@/lib/ensureDevSession";

// Where the share email's "unsubscribe" link lands (SHARED_WITH_YOU.md §6). We
// mint no tokens (§4), so we identify the person the only safe way we can — by
// their signed-in session — then flip their own notify_on_share off. Logged-out
// visitors go through the normal auth gate first (?next=/unsubscribe) and land
// back here. Re-subscribing is one click, or via Settings › Notifications.

type State = "working" | "done" | "error";

export default function UnsubscribePage() {
  const router = useRouter();
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
        router.replace(`/login?next=/unsubscribe`);
        return;
      }
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyOnShare: false }),
      });
      setState(res.ok ? "done" : "error");
    })();
  }, [router]);

  async function resubscribe() {
    const res = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifyOnShare: true }),
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
              You won’t get emails when someone shares a chapter with you. You’ll still see shared
              chapters and comments in the app. Manage this anytime in{" "}
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
