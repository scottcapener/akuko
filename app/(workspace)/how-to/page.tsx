import type { Metadata } from "next";
import { fetchTips } from "@/lib/tips";

// How to Use Hot Cocoa — the full, ordered list of tips.
//
// A workspace-layout page (it renders inside the Nav Panel shell) but a tertiary
// one: it is deliberately absent from the Nav Panel's own item lists, reached
// only from the writer's Tips card and the Settings toggle, and always opened in
// a new tab. Server-rendered from the same daily-cached sheet as the card.

// Must be a static literal (Next validates segment config at build time); keep in
// sync with TIPS_REVALIDATE_SECONDS in lib/tips.ts. 60 * 60 * 24 = one day.
export const revalidate = 86400;

export const metadata: Metadata = {
  title: "How to Use Hot Cocoa",
};

export default async function HowToPage() {
  const tips = await fetchTips();

  return (
    <div className="min-h-full bg-bg px-6 py-10">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">

        <div className="flex flex-col gap-1">
          <h1 className="text-text text-xl font-semibold">How to use Hot Cocoa</h1>
          <p className="text-xs text-subtle leading-relaxed">
            A few tips to help you get the most out of Hot Cocoa, from the basics on up.
          </p>
        </div>

        <ol className="border border-border-subtle rounded-xl px-5 divide-y divide-border-subtle">
          {tips.map((tip, i) => (
            <li key={i} className="flex items-baseline gap-4 py-3.5">
              <span className="text-xs text-subtle tabular-nums w-5 flex-shrink-0">
                {i + 1}
              </span>
              <span className="text-sm text-text leading-relaxed">{tip}</span>
            </li>
          ))}
        </ol>

      </div>
    </div>
  );
}
