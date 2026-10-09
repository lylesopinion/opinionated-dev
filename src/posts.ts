/**
 * The single source of truth for the blog index.
 *
 * Add one entry per published post (in any order — the renderer sorts by
 * `date` descending). Adding a post is: one entry here + one HTML file under
 * `blog/`, then rebuild. Never hand-edit `blog/index.html`.
 */
export interface Post {
  /** Zero-padded ordinal, e.g. "001" — part of the URL/filename. */
  id: string;
  /** Post page filename under blog/, e.g. "001-why-this-blog-exists.html". */
  slug: string;
  /** Display title. */
  title: string;
  /** ISO 8601 date, used for sorting and the <time datetime> value. */
  date: string;
  /** One-line summary shown in the index (optional). */
  summary?: string;
  /** Author id — a key of the `authors` registry. */
  author: string;
  /**
   * When true, the post is a draft pending approval and is rendered with a
   * visible draft treatment (badge/notice). Machine-detectable via `draft: true`.
   */
  draft?: boolean;
}

export const posts: Post[] = [
  {
    id: "001",
    slug: "001-why-this-blog-exists.html",
    title: "Why this blog exists",
    date: "2026-10-09",
    summary:
      "Why opinionated.dev is separate from the business blog, what to expect (strong opinions, loosely guarded), and how to write back.",
    author: "lyle",
    draft: true,
  },
];
