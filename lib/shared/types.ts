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
}
