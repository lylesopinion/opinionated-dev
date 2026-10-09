/**
 * The authors registry — the single source of truth for attribution.
 *
 * Add one entry per author. A post's `author` field (in `posts.ts`) must be a
 * key of this record; the build fails loudly otherwise. Guests are always
 * attributed; there are no anonymous posts.
 */
export interface Author {
  /** Key into the registry, e.g. "lyle". Matches `Post.author`. */
  id: string;
  /** Canonical byline shown on posts and the authors index. */
  displayName: string;
  /** Short attribution blurb. */
  bio: string;
  /** Author's site/profile URL. */
  link: string;
}

export const authors: Record<string, Author> = {
  lyle: {
    id: "lyle",
    displayName: "Lyle Shemer",
    bio: "Lyle writes about building systems that improve themselves, and about the strange new things showing up in ordinary workflows.",
    link: "https://opinionated.dev",
  },
};
