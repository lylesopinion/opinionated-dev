# Contributing

Thanks for writing here. `opinionated.dev` is a static blog with a deliberately
small toolchain, and contributions are welcome by pull request.

## The guest-post flow

1. **Fork and branch.** Fork this repository and create a branch off `main`
   (e.g. `post/my-first-post`).
2. **One post per PR.** Each pull request adds exactly one post — one entry in
   `src/posts.ts` plus one HTML file under `blog/`. If you are a new author,
   add yourself to `src/authors.ts` in the same PR.
3. **Start from the template.** Copy `POST_TEMPLATE.md` and follow it: the
   manifest fields (id, slug, title, date, summary, author) and the
   `NNN-<slug>.html` file-naming convention.
4. **Rebuild the committed artifacts.** Run `npm ci && npm run build`, then
   commit the regenerated `blog/index.html` and `authors.html` along with your
   post. They are generated; never hand-edit them.
5. **Open the PR.** A maintainer reviews it.

## What review means here

Review is an **editorial pass**, not a code review. We read for clarity, voice,
accuracy, and fit — we may suggest cuts, restructuring, or a sharper title. We
do not require a particular level of technical polish in the prose. When the
editorial pass is done, the post merges and is published.

## Authorship rules

- **Lyle is the default author** for posts he writes.
- **Guests are always attributed** by name, with a bio and a link, on both the
  post and the `/authors.html` index.
- **Nothing is anonymous.** Every post resolves to an entry in
  `src/authors.ts`; the build fails loudly if an author is missing.

## House rules

- No frameworks and no required client-side JavaScript — pages render without
  JavaScript.
- Semantic HTML: `<article>`, `<time datetime>`, real headings.
- This is a **public** repository: no secrets, tokens, or private data paths in
  source, build, or output.

## Questions

Open an issue if anything here is unclear or you want to pitch a post before
writing it.
