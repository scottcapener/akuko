"use client";

import { ConfirmModal } from "@/components/ui/ConfirmModal";

// Deleting a shared chapter also stops sharing. Stop sharing BEFORE deleting the
// live chapter: the shared snapshot is keyed by chapter_id, which the delete nulls
// out (§7), so the DELETE must land first or the snapshot lingers orphaned.
async function stopSharing(chapterId: string) {
  try {
    await fetch(`/api/share?chapterId=${encodeURIComponent(chapterId)}`, { method: "DELETE" });
  } catch {
    // Best-effort; still delete the chapter (its snapshot just lingers).
  }
}

// Single source of truth for the delete-chapter confirmation — shown from both the
// book panel (right-click on a chapter) and the editor's sharing menu. When the
// chapter is shared, deleting also revokes reader access and their comments; that
// is the default now, not an opt-in checkbox.
export function DeleteChapterModal({
  chapterId,
  chapterTitle,
  shared,
  onDelete,
  onClose,
}: {
  chapterId: string;
  chapterTitle: string;
  shared: boolean;
  onDelete: (chapterId: string) => void;
  onClose: () => void;
}) {
  return (
    <ConfirmModal
      message={
        <>
          Delete <strong className="text-text">{chapterTitle}</strong>?{" "}
          All scenes and library items will be permanently deleted.
          {shared && (
            <> This chapter is shared — deleting it also stops sharing, so your readers lose access and their comments are deleted.</>
          )}
        </>
      }
      confirmLabel={shared ? "Delete chapter and stop sharing" : "Delete chapter"}
      onConfirm={async () => {
        if (shared) await stopSharing(chapterId);
        onDelete(chapterId);
        onClose();
      }}
      onCancel={onClose}
    />
  );
}
