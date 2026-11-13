// Resolve the DSH installation anchor across platforms.
//
// The tests and the packager need packages the repo does not depend on
// (`semver`, `@deepseek-ai/dsh-settings`, ...). Those live in the *host*
// installation, whose path differs per platform: a Windows Desktop install
// keeps them under resources/app/dsh, a global npm install keeps them under
// the npm prefix. Hardcoding one path makes the suite pass on exactly one
// machine, so resolve the anchor instead.
//
// Override with DSH_HOST_ROOT when the install lives somewhere unusual.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

/** Directories that may hold `node_modules/@deepseek-ai` for a host install. */
const CANDIDATES = [
  process.env.DSH_HOST_ROOT,
  // Windows Desktop installs
  "F:/AiTools/DSH/resources/app/dsh",
  "C:/Users/Administrator/AppData/Local/Programs/DSH/resources/app/dsh",
  "C:/Program Files/DSH/resources/app/dsh",
  // Global npm installs
  "/opt/node24/lib/node_modules/@deepseek-ai/dsh",
  "/usr/local/lib/node_modules/@deepseek-ai/dsh",
  "/usr/lib/node_modules/@deepseek-ai/dsh",
].filter(Boolean);

/** The `node_modules` directory of the host installation, or undefined. */
export function hostModulesRoot() {
  for (const root of CANDIDATES) {
    if (existsSync(join(root, "node_modules", "@deepseek-ai"))) return join(root, "node_modules");
  }
  // Fall back to resolving a host package from anywhere on the module path.
  try {
    const entry = createRequire(import.meta.url).resolve("@deepseek-ai/dsh-typert-protocol");
    const marker = join("node_modules", "@deepseek-ai");
    const at = entry.lastIndexOf(marker);
    if (at > 0) return entry.slice(0, at + "node_modules".length);
  } catch {
    /* no host install reachable this way */
  }
  return undefined;
}

/** The `node_modules/@deepseek-ai` directory of the host installation, or undefined. */
export function hostPackagesRoot() {
  const root = hostModulesRoot();
  return root === undefined ? undefined : join(root, "@deepseek-ai");
}

/** `require` bound to the host installation, for packages the repo does not depend on. */
export function hostRequire() {
  const root = hostModulesRoot();
  if (root === undefined) {
    throw new Error("DSH host installation not found; set DSH_HOST_ROOT to its root directory");
  }
  return createRequire(join(root, "@deepseek-ai", "dsh", "lib", "bin.js"));
}
