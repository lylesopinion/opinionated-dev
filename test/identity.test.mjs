// Editorial-identity invariants: the authorship contract, the "Write for this
// blog" CTA, and the no-JavaScript house rule. Runs against the compiled
// dist/*.js under Node's built-in test runner (TypeScript stays the sole dev
// dependency). See the TDD on issue #1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const goodAuthors = {
  lyle: {
    id: "lyle",
    displayName: "Lyle Shemer",
    bio: "Writes here.",
    link: "https://opinionated.dev",
  },
};

test("unresolvedAuthors returns [] when every post resolves", () => {
  assert.deepEqual(unresolvedAuthors(posts, authors), []);
});

test("unresolvedAuthors flags a post whose author is absent", () => {
  const badPosts = [
    {
      id: "001",
      slug: "001-x.html",
      title: "x",
      date: "2026-10-09",
      author: "nobody",
    },
  ];
  const unresolved = unresolvedAuthors(badPosts, goodAuthors);
  assert.equal(unresolved.length, 1);
  assert.match(unresolved[0], /001/);
  assert.match(unresolved[0], /nobody/);
});

test("unresolvedAuthors returns one entry per unresolved post", () => {
  const badPosts = [
    {
      id: "001",
      slug: "001-a.html",
      title: "a",
      date: "2026-10-09",
      author: "ghost",
    },
    {
      id: "002",
      slug: "002-b.html",
      title: "b",
      date: "2026-10-09",
      author: "phantom",
    },
  ];
  assert.equal(unresolvedAuthors(badPosts, goodAuthors).length, 2);
});

test("unresolvedAuthors requires an own property, not a prototype key", () => {
  const evilPosts = [
    {
      id: "001",
      slug: "001-x.html",
      title: "x",
      date: "2026-10-09",
      author: "constructor",
    },
  ];
  assert.equal(unresolvedAuthors(evilPosts, goodAuthors).length, 1);
});

test("authors index carries a 'Write for this blog' CTA to CONTRIBUTING.md", () => {
  const html = renderAuthorIndexHtml(authors, posts);
  const cta = html.match(/<a [^>]*href="\.?\/?CONTRIBUTING\.md"[^>]*>([^<]*)<\/a>/);
  assert.ok(cta, "authors index must link to CONTRIBUTING.md");
  assert.match(cta[1], /write for this blog/i);
});

test("rendered pages show the author display name and bio, not the raw id", () => {
  const index = renderIndexHtml(posts, authors);
  const authorIndex = renderAuthorIndexHtml(authors, posts);
  assert.ok(index.includes("Lyle Shemer"), "byline display name must render");
  assert.ok(index.includes(authors.lyle.bio), "byline bio must render");
  assert.ok(
    authorIndex.includes("Lyle Shemer"),
    "author entry display name must render",
  );
  assert.ok(authorIndex.includes(authors.lyle.bio), "author bio must render");
});

test("generated pages require no JavaScript", () => {
  assert.ok(!renderIndexHtml(posts, authors).includes("<script"));
  assert.ok(!renderAuthorIndexHtml(authors, posts).includes("<script"));
  for (const file of ["authors.html", join("blog", "index.html")]) {
    assert.ok(
      !readFileSync(join(root, file), "utf8").includes("<script"),
      `${file} must not contain <script`,
    );
  }
});

test("README states the positioning, contrast, license, and voice", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8").replace(
    /\s+/g,
    " ",
  );
  assert.match(readme, /personal blog/i);
  assert.match(readme, /Lyle Shemer/);
  assert.match(readme, /invited guests/i);
  assert.match(readme, /xenomorph\.dev\/blog/);
  assert.match(readme, /the name is the license/i);
  assert.match(readme, /first-person/i);
  assert.match(readme, /strong opinions loosely guarded/i);
});

test("CONTRIBUTING documents the author contract and the authorship rule", () => {
  const contributing = readFileSync(join(root, "CONTRIBUTING.md"), "utf8");
  assert.match(contributing, /src\/authors\.ts/);
  assert.match(contributing, /fails loudly/i);
  assert.match(contributing, /Lyle is the default author/i);
  assert.match(contributing, /Guests are always attributed/i);
  assert.match(contributing, /Nothing is anonymous/i);
});
