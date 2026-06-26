import Image from "next/image";
import Link from "next/link";

const steps = [
  {
    num: "01",
    label: "Create an account",
    desc: "Sign up with your email. We send a quick verification code to keep your account secure.",
  },
  {
    num: "02",
    label: "Start your book",
    desc: "You land directly in your first chapter. No setup, no templates. Just start writing.",
  },
  {
    num: "03",
    label: "Write at your own pace",
    desc: "Your work saves automatically. Come back whenever you're ready.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-full bg-bg text-text">
      {/* Hero */}
      <section className="flex flex-col items-center text-center px-6 py-32 sm:py-44">
        <p className="text-muted text-xs tracking-widest uppercase mb-8">
          Bring your story to life.
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
          A writing space for first-time novelists.
        </p>
        <Link
          href="/signup"
          className="inline-block py-3 px-8 rounded-lg bg-accent text-text text-sm font-semibold tracking-wide hover:bg-accent-hi transition-colors"
        >
          Start writing — it&apos;s free
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
      </section>

      {/* How it works */}
      <section className="px-6 py-20 border-t border-elevated">
        <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-8">
          {steps.map(({ num, label, desc }) => (
            <div key={num} className="flex flex-col gap-2">
              <span className="text-subtle text-xs mb-1">{num}</span>
              <h3 className="text-text text-sm font-semibold">{label}</h3>
              <p className="text-muted text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* About */}
      <section className="px-6 py-20 border-t border-elevated flex justify-center">
        <div className="max-w-[480px]">
          <p className="text-muted text-sm leading-relaxed">
            Hot Cocoa is an independent writing platform made for people who want
            to write their first book and actually finish it. Your writing is
            private by default, belongs to you completely, and is never used to
            train AI systems.
          </p>
          <p className="text-subtle text-xs mt-5">Made by Scott Capener</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-10 border-t border-elevated text-center">
        <p className="text-subtle text-xs">© 2026 Hot Cocoa</p>
      </footer>
    </div>
  );
}
