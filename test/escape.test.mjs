// Escaping + author-resolution tests. Uses Node's built-in test runner so
// TypeScript stays the sole dev dependency. Runs against the compiled dist/*.js.
import { test } from "node:test";
import assert from "node:assert/strict";

import { posts } from "../dist/posts.js";
import { authors } from "../dist/authors.js";
import {
  escapeHtml,
  renderIndexHtml,
  renderAuthorIndexHtml,
} from "../dist/render.js";

test("escapeHtml escapes the five HTML-significant characters", () => {
  assert.equal(escapeHtml(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
});

test("renderIndexHtml escapes manifest values (title/summary/date)", () => {
  const evilPosts = [
    {
      id: "999",
      slug: `999-a"onmouseover="x.html`,
      title: `<script>alert('x')</script>`,
      date: "2026-01-02",
      summary: `A & B "quoted" 'apostrophe'`,
      author: "evil",
    },
  ];
  const evilAuthors = {
    evil: {
      id: "evil",
      displayName: `<b>Evil</b>`,
      bio: `bio with & and "quotes"`,
      link: "https://example.com/?a=1&b=2",
    },
  };

  const html = renderIndexHtml(evilPosts, evilAuthors);

  assert.ok(!html.includes("<script>"), "raw <script> must not appear");
  assert.ok(!html.includes(`a" onmouseover`), "raw attribute break must not appear");
  assert.ok(html.includes("&lt;script&gt;"), "title must be escaped");
  assert.ok(html.includes("&amp;"), "ampersand must be escaped");
  assert.ok(html.includes("&quot;"), "double quote must be escaped");
  assert.ok(html.includes("&#39;"), "apostrophe must be escaped");
});

test("renderAuthorIndexHtml escapes registry values", () => {
  const evilAuthors = {
    evil: {
      id: "evil",
      displayName: `<img src=x onerror=alert(1)>`,
      bio: `bio & <script>`,
      link: `https://example.com/"`,
    },
  };
  const html = renderAuthorIndexHtml(evilAuthors, []);

  assert.ok(!html.includes("<img src=x onerror"), "raw img must not appear");
  assert.ok(!html.includes("<script>"), "raw script must not appear");
  assert.ok(html.includes("&lt;img"), "displayName must be escaped");
  assert.ok(html.includes("&amp;"), "ampersand must be escaped");
});

test("every post author resolves to a registry key", () => {
  for (const post of posts) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(authors, post.author),
      `post ${post.id} references unknown author "${post.author}"`,
    );
  }
});

test("the first manifest entry is authored by Lyle", () => {
  const first = posts[0];
  assert.equal(first.author, "lyle");
  assert.ok(authors.lyle, "lyle must exist in the registry");
  assert.equal(authors.lyle.displayName, "Lyle Shemer");
});

test("rendered index shows the author display name, not the raw id", () => {
  const html = renderIndexHtml(posts, authors);
  assert.ok(html.includes("Lyle Shemer"), "byline display name must render");
  assert.ok(html.includes(authors.lyle.bio), "author bio must render");
});
