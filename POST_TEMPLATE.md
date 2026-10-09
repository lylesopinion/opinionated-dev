# Post template

Copy this into a new file under `blog/` named `NNN-<slug>.html` (zero-padded
ordinal + slug; e.g. `002-my-first-real-post.html`), then add the matching entry
to the `posts` array in `src/posts.ts` and rebuild. Do not hand-edit
`blog/index.html` or `authors.html` — those are generated.

## Manifest entry

Add one object to `posts` in `src/posts.ts`:

```ts
{
  id: "002",                                  // zero-padded ordinal
  slug: "002-my-first-real-post.html",        // filename under blog/
  title: "My first real post",
  date: "2026-10-09",                          // ISO 8601 (YYYY-MM-DD)
  summary: "One line shown in the index.",    // optional
  author: "lyle",                             // a key in src/authors.ts
}
```

## New author?

If you are not already in `src/authors.ts`, add yourself:

```ts
{
  id: "your-id",
  displayName: "Your Name",
  bio: "One line about you.",
  link: "https://your-site.example",
} 
```

Every post must resolve to a registry author — the build fails loudly otherwise.

## Post file

Start from an existing post under `blog/` and keep:

- The `<head>` block with a unique `<title>` and `<meta name="description">`.
- The site header/nav and footer, using `../` asset paths (posts live in `blog/`).
- The `<time datetime="YYYY-MM-DD">` matching the manifest `date`.
- A byline containing the author's **display name and bio/link** — not the raw id.
- `<article>`/heading structure with semantic HTML.

Mark any placeholder prose clearly with a `PLACEHOLDER CONTENT` comment so it is
never mistaken for a real article.

## Rebuild

```bash
npm run build     # regenerates blog/index.html and authors.html
```

Commit the post file, the manifest change, and the regenerated artifacts
together.
