// Build-time glue: assemble a clean publish tree `_site/` mirroring the
// Dockerfile's explicit serve whitelist, then verify no private path leaked.
// Plain ESM (.mjs) so TypeScript stays the sole dev dependency.
//
// The whitelist is the privacy boundary: anything not enumerated here
// (src/, scripts/, node_modules/, dist/, .git/, .opencode/, .xen-factory/)
// must never reach the public site.
import { cpSync, existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "_site");

// Exactly the Dockerfile COPY list.
const files = ["index.html", "authors.html"];
const dirs = ["css", "blog"];

// Paths that must never appear in the publish tree.
const FORBIDDEN = [
  "src",
  "scripts",
  "node_modules",
  "dist",
  ".git",
  ".opencode",
  ".xen-factory",
];

/**
 * Return the list of forbidden path basenames present directly under `dir`.
 * Empty array means the tree is clean. Exported for the test suite.
 */
export function checkPublishTree(dir) {
  if (!existsSync(dir)) return [...FORBIDDEN];
  const present = new Set(readdirSync(dir));
  return FORBIDDEN.filter((name) => present.has(name));
}

export function stageSite() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const name of files) {
    cpSync(join(root, name), join(out, name));
  }
  for (const name of dirs) {
    cpSync(join(root, name), join(out, name), { recursive: true });
  }

  const leaked = checkPublishTree(out);
  if (leaked.length > 0) {
    console.error(`stage-site: PRIVATE PATHS LEAKED INTO _site/: ${leaked.join(", ")}`);
    process.exit(1);
  }

  console.log(
    `stage-site: staged ${files.length} files + ${dirs.length} dirs -> _site/`,
  );
}

// Only run when invoked directly (`node scripts/stage-site.mjs`), not when the
// test imports `checkPublishTree`.
if (process.argv[1] && process.argv[1].endsWith("stage-site.mjs")) {
  stageSite();
}
