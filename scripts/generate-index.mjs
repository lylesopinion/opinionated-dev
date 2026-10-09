// Build-time glue: import the compiled manifest + registry + renderers from
// dist/ and write the committed artifacts: blog/index.html and authors.html.
// Plain ESM (.mjs) so TypeScript stays the sole dev dep (a compiled build
// script would need @types/node).
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let posts;
let authors;
let renderIndexHtml;
let renderAuthorIndexHtml;
try {
  ({ posts } = await import(join(root, "dist", "posts.js")));
  ({ authors } = await import(join(root, "dist", "authors.js")));
  ({ renderIndexHtml, renderAuthorIndexHtml } = await import(
    join(root, "dist", "render.js")
  ));
} catch (err) {
  console.error(
    "generate-index: could not load dist/*.js — run `tsc` first (npm run build does this).",
  );
  console.error(err);
  process.exit(1);
}

// Invariant: every post's author must resolve to a registry key. Fail loudly.
const unresolved = posts.filter((p) => !authors[p.author]);
if (unresolved.length > 0) {
  console.error(
    `generate-index: ${unresolved.length} post(s) reference an unknown author: ${unresolved
      .map((p) => `${p.id} -> "${p.author}"`)
      .join(", ")}`,
  );
  process.exit(1);
}

const indexHtml = renderIndexHtml(posts, authors);
const authorsHtml = renderAuthorIndexHtml(authors, posts);

mkdirSync(join(root, "blog"), { recursive: true });
writeFileSync(join(root, "blog", "index.html"), indexHtml);
writeFileSync(join(root, "authors.html"), authorsHtml);
console.log(
  `generate-index: wrote blog/index.html (${posts.length} post(s)) and authors.html (${Object.keys(authors).length} author(s))`,
);
