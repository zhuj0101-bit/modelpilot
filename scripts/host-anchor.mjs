// 跨平台解析 DSH 安装锚点。
//
// 测试与打包器需要仓库本身并不依赖的包（`semver`、`@deepseek-ai/dsh-settings` 等）。
// 它们位于 *宿主* 安装中，而宿主路径因平台而异：Windows 桌面安装把它们放在
// resources/app/dsh 下，全局 npm 安装则放在 npm 前缀下。硬编码单一路径会让
// 测试套件只在恰好一台机器上通过，所以改为解析锚点。
//
// 安装位置特殊时可用 DSH_HOST_ROOT 覆盖。

import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

/** 可能存放宿主安装的 `node_modules/@deepseek-ai` 的目录。 */
const CANDIDATES = [
  process.env.DSH_HOST_ROOT,
  // Windows 桌面安装
  "F:/AiTools/DSH/resources/app/dsh",
  "C:/Users/Administrator/AppData/Local/Programs/DSH/resources/app/dsh",
  "C:/Program Files/DSH/resources/app/dsh",
  // 全局 npm 安装
  "/opt/node24/lib/node_modules/@deepseek-ai/dsh",
  "/usr/local/lib/node_modules/@deepseek-ai/dsh",
  "/usr/lib/node_modules/@deepseek-ai/dsh",
].filter(Boolean);

/** 宿主安装的 `node_modules` 目录，或 undefined。 */
export function hostModulesRoot() {
  for (const root of CANDIDATES) {
    if (existsSync(join(root, "node_modules", "@deepseek-ai"))) return join(root, "node_modules");
  }
  // 回退：从模块路径上的任意位置解析一个宿主包。
  try {
    const entry = createRequire(import.meta.url).resolve("@deepseek-ai/dsh-typert-protocol");
    const marker = join("node_modules", "@deepseek-ai");
    const at = entry.lastIndexOf(marker);
    if (at > 0) return entry.slice(0, at + "node_modules".length);
  } catch {
    /* 这种方式无法触达任何宿主安装 */
  }
  return undefined;
}

/** 宿主安装的 `node_modules/@deepseek-ai` 目录，或 undefined。 */
export function hostPackagesRoot() {
  const root = hostModulesRoot();
  return root === undefined ? undefined : join(root, "@deepseek-ai");
}

/** 绑定到宿主安装的 `require`，用于仓库不依赖的包。 */
export function hostRequire() {
  const root = hostModulesRoot();
  if (root === undefined) {
    throw new Error("DSH host installation not found; set DSH_HOST_ROOT to its root directory");
  }
  return createRequire(join(root, "@deepseek-ai", "dsh", "lib", "bin.js"));
}
