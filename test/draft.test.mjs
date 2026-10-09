// Draft-mechanism tests for the first real post (issue #3). Asserts the
// machine-detectable draft facts on both source and rendered artifacts, the
// required beats, and the < 800-word limit. Runs against compiled dist/*.js
// under Node's built-in test runner, like the rest of the suite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { posts } from "../dist/posts.js";
import { authors } from "../dist/authors.js";
import {
  renderIndexHtml,
  renderAuthorIndexHtml,
  unresolvedAuthors,
} from "../dist/render.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const postFile = "001-why-this-blog-exists.html";
const read = (p) => readFileSync(join(root, p), "utf8");

/** Extract article-body prose word count — the TDD's reproducible method. */
function articleBodyWordCount(html) {
  const m = html.match(/<div class="prose">([\s\S]*?)<\/div>/);
  assert.ok(m, "post must contain a .prose block");
  const text = m[1]
    .replace(/<!--[\s\S]*?-->/g, " ") // drop comments
    .replace(/<(h[1-6]|p class="byline")[\s\S]*?<\/\1>/g, " ") // drop headings + byline
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  return (text.match(/\S+/g) || []).length;
}

test("manifest flag is machine-detectable", () => {
  const source = read("src/posts.ts");
  assert.match(source, /draft: true/, "src/posts.ts must contain 'draft: true'");
  const essay = posts.find((p) => p.id === "001");
  assert.ok(essay, "the 001 entry must exist");
  assert.equal(essay.draft, true, "the 001 entry must be a draft");
});

test("author contract intact for the essay", () => {
  assert.deepEqual(unresolvedAuthors(posts, authors), []);
  const essay = posts.find((p) => p.id === "001");
  assert.equal(essay.author, "lyle");
});

test("rendered index carries the draft treatment", () => {
  const html = renderIndexHtml(posts, authors);
  assert.ok(html.includes("draft-badge"), "index must carry the draft badge hook");
  assert.ok(html.includes("Draft"), "index must carry a visible Draft label");
});

test("rendered authors page marks the draft", () => {
  const html = renderAuthorIndexHtml(authors, posts);
  assert.ok(html.includes("(draft)"), "authors page must mark the draft");
});

test("committed artifacts carry the draft treatment too", () => {
  assert.ok(read("blog/index.html").includes("draft-badge"));
  assert.ok(read("authors.html").includes("(draft)"));
});

test("post page source markers", () => {
  const html = read(join("blog", postFile));
  assert.match(html, /DRAFT/, "post file must carry the DRAFT marker");
  assert.ok(
    !html.includes("PLACEHOLDER CONTENT"),
    "post file must not carry placeholder prose",
  );
});

test("no placeholder survives anywhere under blog/", () => {
  for (const name of readdirSync(join(root, "blog"))) {
    assert.ok(
      !read(join("blog", name)).includes("PLACEHOLDER CONTENT"),
      `blog/${name} must not contain PLACEHOLDER CONTENT`,
    );
  }
});

test("essay prose links CONTRIBUTING.md", () => {
  assert.ok(read(join("blog", postFile)).includes("CONTRIBUTING.md"));
});

test("essay article-body prose is fewer than 800 words", () => {
  const words = articleBodyWordCount(read(join("blog", postFile)));
  assert.ok(words < 800, `expected < 800 words, got ${words}`);
});

test("essay post page requires no JavaScript and is noindex", () => {
  const html = read(join("blog", postFile));
  assert.ok(!html.includes("<script"), "post page must not contain <script");
  assert.match(html, /<meta name="robots" content="noindex">/);
});
