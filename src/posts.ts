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
  /** Post page filename under blog/, e.g. "001-placeholder.html". */
  slug: string;
  /** Display title. */
  title: string;
  /** ISO 8601 date, used for sorting and the <time datetime> value. */
  date: string;
  /** One-line summary shown in the index (optional). */
  summary?: string;
  /** Author id — a key of the `authors` registry. */
  author: string;
}

export const posts: Post[] = [
  {
    id: "001",
    slug: "001-placeholder.html",
    title: "Placeholder: this blog exists",
    date: "2026-10-09",
    summary:
      "A placeholder first post so the pipeline is exercisable end-to-end before real editorial copy lands.",
    author: "lyle",
  },
];
