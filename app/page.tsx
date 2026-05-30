import Image from "next/image";
import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-[#18181a] px-6 text-center">
      <div className="flex flex-col items-center gap-8 max-w-sm w-full">
        <Image
          src="/hakuko-logo-large.svg"
          alt="Hakuko"
          width={120}
          height={28}
          className="opacity-60"
          priority
        />
        <p className="text-[#9b9890] text-base font-light tracking-wide">
          your story starts here
        </p>
        <Link
          href="/signup"
          className="w-full py-3 rounded-lg bg-[#c4a882] text-[#18181a] text-sm font-semibold tracking-wide hover:bg-[#d4b892] transition-colors"
        >
          Start writing
        </Link>
        <p className="text-[#9b9890]/60 text-xs">
          Already have an account?{" "}
          <Link href="/login" className="text-[#9b9890] hover:text-[#c4a882] transition-colors underline underline-offset-2">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
