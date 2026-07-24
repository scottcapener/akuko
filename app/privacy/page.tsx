import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import LegalDocument from "@/components/LegalDocument";

export const metadata: Metadata = {
  title: "Privacy Policy — Hot Cocoa",
  description:
    "What Hot Cocoa collects, why, and the control you have. We never sell your data or train AI on your writing.",
};

export default function PrivacyPage() {
  const markdown = fs.readFileSync(
    path.join(process.cwd(), "content/legal/privacy-policy.md"),
    "utf8",
  );

  return (
    <div className="min-h-full bg-bg text-text">
      <div className="mx-auto max-w-2xl px-6 py-14">
        <header className="mb-12 flex items-center justify-between">
          <Link href="/" aria-label="Hot Cocoa home">
            <Image src="/logo-S.svg" alt="Hot Cocoa" width={126} height={24} className="logo-inline" />
          </Link>
          <Link
            href="/"
            className="text-xs text-subtle/70 hover:text-subtle transition-colors"
          >
            ← Back to Hot Cocoa
          </Link>
        </header>

        <article>
          <LegalDocument markdown={markdown} />
        </article>

        <footer className="mt-16 pt-6 border-t border-border-subtle text-xs text-subtle/70">
          <Link href="/terms" className="hover:text-accent transition-colors">
            Terms of Service
          </Link>
        </footer>
      </div>
    </div>
  );
}
