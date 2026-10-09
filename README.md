# opinionated.dev

Lyle's personal blog at **opinionated.dev** — a static, framework-free site with
first-class multi-author support. A TypeScript post manifest and a typed authors
registry are the single sources of truth; pure renderers generate the committed
`blog/index.html` and `authors.html`; a two-stage Docker build serves only an
explicit whitelist of files.

The pattern mirrors the sibling repos `xeno-web` and `banplasticbottles`, with
one deliberate divergence: multi-author is built in from the start.

## What this is

`opinionated.dev` is **Lyle Shemer's personal blog**: essays and opinions by
Lyle and invited guests. The topics are open — tech, systems, causes, music,
whatever he has opinions about. **The name is the license**: the site is where
he says what he thinks, in his own voice.

That voice is deliberately **first-person, with strong opinions loosely
guarded** — opinionated, but not dogmatic; willing to be argued with. It is
meant to read as a person thinking out loud, not a brand issuing positions. It
is deliberately **not** the calmer business voice at
[xenomorph.dev/blog](https://xenomorph.dev/blog), which stays measured and
corporate; this site is where the person behind it gets to be a person.

Guests write here too, always by pull request. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the guest-post flow and the authorship
rules — in short: **Lyle is the default author, guests are always attributed,
and nothing is anonymous.** Every post resolves to an entry in `src/authors.ts`,
and the build fails loudly if it does not.

## Structure

```
opinionated-dev/
├── index.html                     # landing page
├── authors.html                   # generated + committed (do not hand-edit)
├── blog/
│   ├── index.html                 # generated + committed (do not hand-edit)
│   └── 001-placeholder.html       # hand-authored post (placeholder)
├── css/style.css                  # minimal self-contained stylesheet
├── src/
│   ├── authors.ts                 # single source of truth: Author registry
│   ├── posts.ts                   # single source of truth: Post[] manifest
│   └── render.ts                  # pure renderers + escapeHtml
├── scripts/
│   ├── generate-index.mjs         # dist/*.js -> blog/index.html + authors.html
│   └── stage-site.mjs             # assemble _site/ + fail-loud private-path guard
├── test/                          # node:test suite
├── dist/                          # compiled output (gitignored)
├── Dockerfile                     # node:20-alpine build -> nginx:alpine serve
├── package.json                   # TypeScript is the only dev dependency
└── tsconfig.json
```

## Build

```bash
npm ci          # install dev dependencies (TypeScript only)
npm run build   # tsc -> dist/, then generate blog/index.html + authors.html
npm test        # build, then run the node:test suite
npm run dev     # tsc --watch
```

`blog/index.html` and `authors.html` are **generated, committed** artifacts. Do
not hand-edit them; change the manifest/registry and rebuild.

## Adding a post

1. Add an entry to the `posts` array in `src/posts.ts` (id, slug, title, date,
   summary, author).
2. Author the matching HTML file under `blog/` from `POST_TEMPLATE.md`.
3. If you are a new author, add an entry to `src/authors.ts`.
4. Run `npm run build` and commit `blog/index.html` and `authors.html` with the
   source changes.

See [`POST_TEMPLATE.md`](POST_TEMPLATE.md) for the exact fields and
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the guest-post pull-request flow.

> **Placeholder content.** `blog/001-placeholder.html` is scaffolding, marked in
> source with a `PLACEHOLDER CONTENT` comment. It exists to exercise the
> pipeline and will be replaced once real editorial copy lands.

## Serve

```bash
docker build -t opinionated-dev .
docker run --rm -p 8080:80 opinionated-dev
```

The Dockerfile is a two-stage build: `node:20-alpine` compiles and generates,
`nginx:alpine` serves only the whitelisted static output (`index.html`,
`authors.html`, `css/`, `js/`, `blog/`). `src/`, `scripts/`, `node_modules/`,
`dist/`, `.git/`, `.opencode/`, and `.xen-factory/` are never served. The
staging script enforces the same boundary:

```bash
npm run build:site   # build + stage _site/, failing loudly on any private path
```

Deployment, DNS, and TLS are out of scope for this scaffold.
