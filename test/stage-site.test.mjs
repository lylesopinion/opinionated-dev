// Publish-tree guard test. Imports the exported checkPublishTree from the
// staging script (which must NOT run its staging side effect on import).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPublishTree } from "../scripts/stage-site.mjs";

test("checkPublishTree returns [] for a clean tree", () => {
  const dir = mkdtempSync(join(tmpdir(), "opinionated-clean-"));
  try {
    mkdirSync(join(dir, "css"));
    mkdirSync(join(dir, "blog"));
    assert.deepEqual(checkPublishTree(dir), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkPublishTree flags a leaked private path", () => {
  const dir = mkdtempSync(join(tmpdir(), "opinionated-leak-"));
  try {
    mkdirSync(join(dir, "src"));
    const leaked = checkPublishTree(dir);
    assert.ok(leaked.includes("src"), "src must be reported as leaked");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkPublishTree reports every forbidden path it finds", () => {
  const dir = mkdtempSync(join(tmpdir(), "opinionated-multi-"));
  try {
    for (const name of ["src", "scripts", "node_modules", "dist"]) {
      mkdirSync(join(dir, name));
    }
    const leaked = checkPublishTree(dir);
    for (const name of ["src", "scripts", "node_modules", "dist"]) {
      assert.ok(leaked.includes(name), `${name} must be reported`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
