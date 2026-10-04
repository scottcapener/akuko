import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SnowBackground from "@/components/SnowBackground";

export default async function LandingPage() {
  // Logged-in visitors skip the marketing page and go straight to writing.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/write");

  return (
    <div className="min-h-full bg-bg text-text">
      {/* Hero */}
      <section className="relative min-h-[100svh] overflow-hidden text-center">
        <SnowBackground />
        {/* Frame: sits over the snow, behind the content. Portrait phones (taller than wide,
            under 640px) get the tall mobile art; everything else, tablets included, gets the wide desktop art. A <picture> loads only the
            matching file. object-cover keeps it filling the hero so no edge is ever revealed. */}
        <picture className="pointer-events-none absolute inset-0">
          <source media="(max-aspect-ratio: 1/1) and (max-width: 639px)" srcSet="/hotcocoa_frame_mobile.png" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hotcocoa_frame.png"
            alt=""
            fetchPriority="high"
            className="h-full w-full object-cover object-center"
          />
        </picture>

        {/* The frame is center-anchored and cover-scaled by s = max(100vw/W, 100svh/1024), where
            W is the image width (1440 desktop, 471 mobile). The center window's midpoint is
            65 (desktop) / 66 (mobile) image-px above the image's vertical middle, so it sits
            that many *s above the hero's middle. Pin the content there. */}
        <div
          className="absolute left-1/2 top-[calc(50svh_-_max(4.51vw,6.35svh))] z-10 flex w-max max-w-full -translate-x-1/2 -translate-y-1/2 flex-col items-center px-6 [@media(max-aspect-ratio:1/1)_and_(max-width:639px)]:top-[calc(50svh_-_max(14.01vw,6.45svh))]"
        >
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
            A cozy writing space for novelists.
          </p>
          <Link
            href="/signup"
            className="inline-block py-3 px-8 rounded-lg bg-accent text-on-accent text-sm font-semibold tracking-wide hover:bg-accent-hi transition-colors"
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
