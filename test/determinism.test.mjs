// Determinism test: same inputs must produce byte-identical output, and the
// committed artifacts must match a fresh render (proving nothing is stale).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { posts } from "../dist/posts.js";
import { authors } from "../dist/authors.js";
import { renderIndexHtml, renderAuthorIndexHtml } from "../dist/render.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("rendering is deterministic across repeated calls", () => {
  assert.equal(renderIndexHtml(posts, authors), renderIndexHtml(posts, authors));
  assert.equal(
    renderAuthorIndexHtml(authors, posts),
    renderAuthorIndexHtml(authors, posts),
  );
});

test("committed blog/index.html matches a fresh render", () => {
  const committed = readFileSync(join(root, "blog", "index.html"), "utf8");
  assert.equal(committed, renderIndexHtml(posts, authors));
});

test("committed authors.html matches a fresh render", () => {
  const committed = readFileSync(join(root, "authors.html"), "utf8");
  assert.equal(committed, renderAuthorIndexHtml(authors, posts));
});

test("index is sorted newest-first", () => {
  const html = renderIndexHtml(posts, authors);
  const positions = posts
    .map((post) => ({ date: post.date, at: html.indexOf(post.title) }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  for (let i = 1; i < positions.length; i++) {
    assert.ok(
      positions[i - 1].at < positions[i].at,
      "posts must appear newest-first",
    );
  }
});
