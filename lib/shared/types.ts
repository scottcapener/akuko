// Shared With You — client/server shared shapes.

export interface ShareRecipient {
  email: string;
  /** display_name once the email maps to an account; the raw email while pending. */
  name: string;
  avatarUrl: string | null;
  /** No account yet — access is redeemed when they sign up/log in (§4). */
  pending: boolean;
}

export interface ShareState {
  chapterId: string;
  sharedChapterId: string | null;
  shared: boolean;
  recipients: ShareRecipient[];
  /** The live chapter has edits since the shared copy was last snapshotted, so
   *  the shared copy is behind the author's current draft. Drives the "Update
   *  shared chapter?" prompt on "View as reader". Always false when not shared. */
  stale: boolean;
}

/** Someone the author has shared any chapter with before — the Share modal's
 *  "Recent" quick-list for one-tap re-sharing (SHARED_WITH_YOU.md §3.5). */
export interface RecentPartner {
  email: string;
  /** display_name for an account; the raw email for a no-account invite. */
  name: string;
  avatarUrl: string | null;
}
