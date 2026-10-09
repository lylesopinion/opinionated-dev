import type { Post } from "./posts.js";
import type { Author } from "./authors.js";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Escape a string for safe interpolation into HTML text/attribute context. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The load-bearing authorship contract: return every post whose `author` is not
 * a key of the `authors` registry, each as `"<postId> -> \"<author>\""`. An
 * empty result means every post is attributed; a non-empty one means anonymous
 * or misattributed posts exist. The build calls this and fails loudly on a
 * non-empty result, so a missing author can never reach a published page.
 */
export function unresolvedAuthors(
  posts: Post[],
  authors: Record<string, Author>,
): string[] {
  return posts
    .filter(
      (post) => !Object.prototype.hasOwnProperty.call(authors, post.author),
    )
    .map((post) => `${post.id} -> "${post.author}"`);
}

/** Render an ISO date (YYYY-MM-DD) as a human-readable, unambiguous label. */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const monthName = MONTHS[Number(month) - 1] ?? month;
  return `${monthName} ${Number(day)}, ${year}`;
}

/** Sort newest-first without mutating the input. */
function newestFirst(posts: Post[]): Post[] {
  return [...posts].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
  );
}

/**
 * Shared <head> + chrome. `prefix` is the relative path back to the site root
 * ("../" from blog/, "" from the root). All interpolated values are constants
 * here except `title`/`description`, which callers pass pre-escaped.
 */
function pageShell(opts: {
  title: string;
  description: string;
  prefix: string;
  main: string;
}): string {
  const { title, description, prefix, main } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="stylesheet" href="${prefix}css/style.css">
</head>
<body>

  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="${prefix}index.html">
        <span>opinionated<span class="dim">.dev</span></span>
      </a>
      <nav class="site-nav" aria-label="Main navigation">
        <a class="nav-link" href="${prefix}index.html">Home</a>
        <a class="nav-link" href="${prefix}blog/index.html">Blog</a>
        <a class="nav-link" href="${prefix}authors.html">Authors</a>
      </nav>
    </div>
  </header>

  <main>
${main}
  </main>

  <footer class="site-footer">
    <div class="container">
      <p class="footer-note">opinionated.dev — written by a small group of authors. No anonymous posts.</p>
      <p class="footer-note"><a href="${prefix}authors.html">Authors</a> &middot; <a href="${prefix}blog/index.html">Blog</a></p>
    </div>
  </footer>

</body>
</html>
`;
}

/** A byline for a post card or post page — display name, bio, link. */
export function renderByline(author: Author): string {
  const name = escapeHtml(author.displayName);
  const bio = escapeHtml(author.bio);
  const link = escapeHtml(author.link);
  return `<p class="byline"><a class="author-name" href="${link}">${name}</a><span class="author-bio">${bio}</span></p>`;
}

function renderCard(post: Post, authors: Record<string, Author>): string {
  const href = escapeHtml(post.slug);
  const title = escapeHtml(post.title);
  const summary = post.summary
    ? `\n            <p class="post-summary">${escapeHtml(post.summary)}</p>`
    : "";
  const author = authors[post.author];
  const byline = author ? `\n            ${renderByline(author)}` : "";
  return `          <article class="card">
            <h3><a class="post-title" href="${href}">${title}</a></h3>
            <time class="post-date" datetime="${escapeHtml(post.date)}">${escapeHtml(
    formatDate(post.date),
  )}</time>${summary}${byline}
          </article>`;
}

/**
 * Pure function: render the complete blog index document (`blog/index.html`)
 * from the post manifest and authors registry. Sorts newest-first; escapes
 * every interpolated value.
 */
export function renderIndexHtml(
  posts: Post[],
  authors: Record<string, Author>,
): string {
  const entries = newestFirst(posts)
    .map((post) => renderCard(post, authors))
    .join("\n");

  const main = `    <section class="page-hero">
      <div class="container">
        <h1>Blog</h1>
        <p class="lead">Essays and opinions, in the first person — strong views, loosely guarded, and nothing like the calmer business blog.</p>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="grid">
${entries}
        </div>
      </div>
    </section>`;

  return pageShell({
    title: "Blog — opinionated.dev",
    description: "Posts from opinionated.dev.",
    prefix: "../",
    main,
  });
}

function renderAuthorEntry(
  author: Author,
  posts: Post[],
): string {
  const name = escapeHtml(author.displayName);
  const bio = escapeHtml(author.bio);
  const link = escapeHtml(author.link);
  const authored = newestFirst(posts.filter((p) => p.author === author.id));
  const items = authored
    .map(
      (post) =>
        `              <li><a href="blog/${escapeHtml(post.slug)}">${escapeHtml(
          post.title,
        )}</a></li>`,
    )
    .join("\n");
  const postList = authored.length
    ? `\n            <ul class="author-posts">\n${items}\n            </ul>`
    : "";

  return `          <article class="author-card">
            <h2><a class="author-name" href="${link}">${name}</a></h2>
            <p class="author-bio">${bio}</p>${postList}
          </article>`;
}

/**
 * Pure function: render the complete authors index document (`authors.html`)
 * from the authors registry and post manifest. Every author gets an entry
 * with name, bio, link, and their posts.
 */
export function renderAuthorIndexHtml(
  authors: Record<string, Author>,
  posts: Post[],
): string {
  const entries = Object.values(authors)
    .map((author) => renderAuthorEntry(author, posts))
    .join("\n");

  const main = `    <section class="page-hero">
      <div class="container">
        <h1>Authors</h1>
        <p class="lead">Everyone who writes here. Guests are always attributed.</p>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="grid">
${entries}
        </div>
        <p class="cta"><a href="CONTRIBUTING.md">Write for this blog</a> — guests are always attributed, by pull request.</p>
      </div>
    </section>`;

  return pageShell({
    title: "Authors — opinionated.dev",
    description: "The authors of opinionated.dev.",
    prefix: "",
    main,
  });
}
