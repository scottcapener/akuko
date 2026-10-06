"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { identify, resetIdentity } from "@/lib/analytics";

// Ties analytics events to the signed-in account (by id only) across every page —
// writer, workspace, marketing — and drops the identity on sign-out so the next
// person on a shared browser isn't merged into the previous profile.
export default function AnalyticsIdentify() {
  useEffect(() => {
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) identify(session.user.id);
      else if (event === "SIGNED_OUT") resetIdentity();
    });
    return () => data.subscription.unsubscribe();
  }, []);
  return null;
}
