import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SteamBackground from "@/components/SteamBackground";

export default async function LandingPage() {
  // Logged-in visitors skip the marketing page and go straight to writing.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/write");

  return (
    <div className="min-h-full bg-bg text-text">
      {/* Hero */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-6 py-24 text-center">
        <SteamBackground />

        <div className="relative z-10 flex flex-col items-center">
          <p className="text-muted text-xs tracking-widest uppercase mb-8">
            Bring your stories home.
          </p>
          <h1>
            <Image
              src="/logo-L.svg"
              alt="Hot Cocoa"
              width={150}
              height={87}
              priority
            />
          </h1>
          <p className="text-muted text-base mt-6 mb-10 max-w-xs leading-relaxed">
            A warm, cozy writing space for novelists.
          </p>
          <Link
            href="/signup"
            className="inline-block py-3 px-8 rounded-lg bg-accent text-text text-sm font-semibold tracking-wide hover:bg-accent-hi transition-colors"
          >
            Start writing
          </Link>
          <p className="text-subtle/80 text-xs mt-6">
            Already have an account?{" "}
            <Link
              href="/login"
              className="text-subtle hover:text-muted underline underline-offset-2 transition-colors"
            >
              Log in
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
