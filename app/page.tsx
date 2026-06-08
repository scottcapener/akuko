import Image from "next/image";
import Link from "next/link";

export default function LandingPage() {
  return (
    <div className="min-h-full flex flex-col items-center justify-center bg-[#100F0F] px-6 text-center">
      <div className="flex flex-col items-center gap-8 max-w-sm w-full">
        <Image
          src="/logo-L.svg"
          alt="Hakuko"
          width={143}
          height={36}
          priority
        />
        <p className="text-[#413E3C] text-base font-light tracking-wide">
          Make it exist
        </p>
        <Link
          href="/signup"
          className="w-full py-3 rounded-lg bg-[#755C4B] text-[#E1E1DF] text-sm font-semibold tracking-wide hover:bg-[#8B6D5A] transition-colors"
        >
          Start writing
        </Link>
        <p className="text-[#413E3C]/60 text-xs">
          Already have an account?{" "}
          <Link href="/login" className="text-[#413E3C] hover:text-[#755C4B] transition-colors underline underline-offset-2">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
