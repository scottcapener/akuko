import type { Metadata } from "next";
import UpdateCard from "@/components/UpdateCard";
import { updates } from "@/lib/updates";

// Updates — the full What's New feed, the same entries the writer's modal
// announces one at a time (lib/updates), shown here non-modal and newest first.
//
// A workspace-layout page (it renders inside the Nav Panel shell) but a tertiary
// one, like How to Use: deliberately absent from the Nav Panel's own item lists,
// reached only from the Settings "View updates" link. No entry carries the "NEW"
// badge — that marker belongs to the modal.

export const metadata: Metadata = {
  title: "Updates",
};

export default function UpdatesPage() {
  return (
    <div className="min-h-full bg-bg px-6 py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <h1 className="text-xl font-semibold text-text">Updates</h1>

        <div className="flex flex-col gap-4">
          {updates.map((update) => (
            <article
              key={update.id}
              className="overflow-hidden rounded-xl border border-border-subtle bg-panel"
            >
              <UpdateCard update={update} />
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
