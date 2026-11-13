// P0-03：settings mutate 集成测试。
//
// 针对每个受支持宿主的逐字写路径代码（在测试时提取，绝不重新实现）运行
// 遍历器矩阵 + 三个操作模板 + 冲突语义：
//   0.2.0-rc.2 / 0.2.1-rc.2 -> npm 补充包树
//   0.2.2-rc.2             -> 正在运行的安装（F:\AiTools\DSH）
//
// 0.2.2 这一列是让未来宿主升级保持诚实的关键：一旦写路径形态变化，
// 本测试就会失败，而不是悄悄发布一处不一致。

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { hostPackagesRoot } from "../../scripts/host-anchor.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
// 补充包树是旧版宿主发行版临时下载的产物，不属于仓库，
// 因此它不存在时 0.2.0/0.2.1 两列会跳过。
const supplement = join(root, "..", "modelpilot-tmp-npm", "extracted", "dsh-settings");
// "live" 列读取正在运行的安装，无论它装在何处。
const HOST = hostPackagesRoot();

/** 定位某个宿主版本的 dsh-settings 打包产物。 */
function settingsPath(version) {
  if (version === "live") return HOST === undefined ? undefined : join(HOST, "dsh-settings", "lib", "index.js");
  return join(supplement, version, "package", "lib", "index.js");
}

const VERSIONS = ["0.2.0-rc.2", "0.2.1-rc.2", "live"];

/** 在稳定的锚点之间切片打包产物，取出三个纯函数 + SettingsConflictError，
 * 再把它当作 data-URL 模块求值。 */
function loadWalker(version) {
  const src = readFileSync(settingsPath(version), "utf8");
  const start = src.indexOf("function isVolatilePath(");
  const end = src.indexOf("/** Human label for a value that lossless JSON cannot represent");
  const conflictStart = src.indexOf("var SettingsConflictError = class");
  const conflictEnd = src.indexOf("/** Whether a value is a plain data object");
  if (start < 0 || end < 0 || conflictStart < 0 || conflictEnd < 0) {
    throw new Error(`anchors not found in ${version} (${settingsPath(version)})`);
  }
  const code = `
${src.slice(conflictStart, conflictEnd)}
${src.slice(start, end)}
export { isVolatilePath, applyPathOp, SettingsConflictError };
`;
  return import(`data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`);
}

/** 等价的 schema 形态：类 pi-ai 的 providers 节点标记为 volatile。 */
const schemaVolatileRoot = {
  meta: { volatile: false },
  dict: {
    providers: { meta: { volatile: true }, inner: { meta: { volatile: true }, dict: {} } },
    plain: { meta: { volatile: false }, inner: { meta: { volatile: false }, dict: {} } },
  },
};

function makeSection() {
  return {
    providers: {
      "gw.example": {
        models: [
          { id: "m1", contextWindow: 131072, maxTokens: 8192 },
          { id: "m2", contextWindow: 262144, maxTokens: 16384 },
        ],
      },
    },
    plain: { a: 1 },
  };
}

for (const version of VERSIONS) {
  const path = settingsPath(version);
  const skip = path === undefined || !existsSync(path);

  test(`[${version}] 遍历器用例矩阵（逐字宿主代码）`, { skip }, async () => {
    const { applyPathOp, isVolatilePath } = await loadWalker(version);
    const section = makeSection();

    // 1. 用 String(i) 设置深层字段
    const afterSet = applyPathOp(
      section,
      { op: "set", path: ["providers", "gw.example", "models", "0", "maxTokens"], value: 4096 },
      schemaVolatileRoot,
    );
    assert.equal(afterSet.providers["gw.example"].models[0].maxTokens, 4096);

    // 2. unset 深层字段 → 键被移除（合并时应用 schema 默认值）
    const afterUnset = applyPathOp(
      afterSet,
      { op: "unset", path: ["providers", "gw.example", "models", "0", "maxTokens"] },
      schemaVolatileRoot,
    );
    assert.deepEqual(afterUnset.providers["gw.example"].models[0], { id: "m1", contextWindow: 131072 });

    // 3. 追加整行：索引 == 长度
    const afterAppend = applyPathOp(
      afterUnset,
      { op: "set", path: ["providers", "gw.example", "models", "2"], value: { id: "m3", contextWindow: 8192, maxTokens: 2048 } },
      schemaVolatileRoot,
    );
    assert.equal(afterAppend.providers["gw.example"].models.length, 3);

    // 4. unset 整行：splice 删除
    const afterSplice = applyPathOp(
      afterAppend,
      { op: "unset", path: ["providers", "gw.example", "models", "1"] },
      schemaVolatileRoot,
    );
    assert.deepEqual(afterSplice.providers["gw.example"].models.map((m) => m.id), ["m1", "m3"]);

    // 5. 越界拒绝（三种形态）
    assert.throws(
      () => applyPathOp(section, { op: "set", path: ["providers", "gw.example", "models", "5"], value: {} }, schemaVolatileRoot),
      /out of range/,
    );
    assert.throws(
      () => applyPathOp(section, { op: "unset", path: ["providers", "gw.example", "models", "2"] }, schemaVolatileRoot),
      /out of range/,
    );
    assert.throws(
      () => applyPathOp(section, { op: "set", path: ["providers", "gw.example", "models", "2", "id"], value: "x" }, schemaVolatileRoot),
      /out of range/,
    );

    // 6. volatile 级联
    assert.equal(isVolatilePath(schemaVolatileRoot, ["providers", "x", "models", "0", "maxTokens"]), true);
    assert.equal(isVolatilePath(schemaVolatileRoot, ["plain", "a"]), false);
  });

  test(`[${version}] 操作模板产出宿主可消费的路径`, { skip }, async () => {
    const { applyPathOp } = await loadWalker(version);
    const section = makeSection();
    const models = section.providers["gw.example"].models;

    // 模板：appendModelRow → 在 String(currentLength) 处 set
    const row = { id: "m9", contextWindow: 4096, maxTokens: 1024 };
    const after = applyPathOp(section, { op: "set", path: ["providers", "gw.example", "models", String(models.length)], value: row }, schemaVolatileRoot);
    assert.equal(after.providers["gw.example"].models.length, 3);
    assert.deepEqual(after.providers["gw.example"].models[2], row);

    // 模板：setModelField → 按模型 id 定位（绝不缓存索引）
    const locate = (sec, routeId, modelId) => {
      const list = sec.providers[routeId].models;
      const index = list.findIndex((m) => m.id === modelId);
      if (index < 0) throw new Error(`model "${modelId}" not found`);
      return index;
    };
    const i = locate(after, "gw.example", "m9");
    const after2 = applyPathOp(after, { op: "set", path: ["providers", "gw.example", "models", String(i), "maxTokens"], value: 512 }, schemaVolatileRoot);
    assert.equal(after2.providers["gw.example"].models[i].maxTokens, 512);
    assert.equal(after2.providers["gw.example"].models[i].id, "m9");

    // 模板：unsetModelRow → 按定位到的索引 splice
    const after3 = applyPathOp(after2, { op: "unset", path: ["providers", "gw.example", "models", String(i)] }, schemaVolatileRoot);
    assert.equal(after3.providers["gw.example"].models.length, 2);
  });

  test(`[${version}] SettingsConflictError 形态 + 重试重定位`, { skip }, async () => {
    const { SettingsConflictError, applyPathOp } = await loadWalker(version);
    const error = new SettingsConflictError("llm-pi-ai", 7, 9);
    assert.equal(error.code, "SETTINGS_CONFLICT");
    assert.equal(error.expected, 7);
    assert.equal(error.actual, 9);
    assert.match(error.message, /llm-pi-ai/);

    // 重试语义（B1 §3.3 / A2）：冲突后调用方重新读取、
    // 按模型 id 重新定位、重建操作 —— 绝不重放过期索引。
    const section = makeSection();
    const moved = applyPathOp(section, { op: "unset", path: ["providers", "gw.example", "models", "0"] }, schemaVolatileRoot);
    const newIndex = moved.providers["gw.example"].models.findIndex((m) => m.id === "m2");
    assert.equal(newIndex, 0, "relocated by modelId, not by stale index");
    const rebuilt = { op: "set", path: ["providers", "gw.example", "models", String(newIndex), "maxTokens"], value: 999 };
    const applied = applyPathOp(moved, rebuilt, schemaVolatileRoot);
    assert.equal(applied.providers["gw.example"].models[0].maxTokens, 999);
  });
}
