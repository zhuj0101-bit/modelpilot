// 工单 #37：改密钥引用名时清理旧密钥 —— 真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，真实点击
// 「保存设置」→ 读改引用名确认弹窗 → 取消 / 确认，并读回
// credentials.describe / unset 与 mutate 的真实调用顺序。Chrome 不可用时 skip。
//
// 纯规则（新旧引用名、六种状态、确认文案）在 test/core/key-rename.test.mjs。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildKeyRenameHtml } from "./key-rename-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) {
    probes.set(scheme, runPageProbe(chrome, buildKeyRenameHtml(bundle, scheme)));
  }
  return probes.get(scheme);
}

/** 保存成功但不需要删旧密钥的场景：没有任何 unset；mutate 之前只有 describe。 */
function assertNoUnset(events, label) {
  assert.deepEqual(
    events.filter((event) => event.startsWith("unset:")),
    [],
    `${label}：不应调用 unset，实际 ${events.join(" → ")}`,
  );
}

/** 事件序列里第一条 unset 之前只能是 describe；unset 之后紧跟 mutate。 */
function assertDescribeThenUnset(ref, events, label) {
  const unsetIndex = events.indexOf(`unset:${ref}`);
  assert.ok(unsetIndex >= 0, `${label}：应调用 unset ${ref}，实际 ${events.join(" → ")}`);
  assert.equal(events.filter((event) => event === `unset:${ref}`).length, 1, `${label}：只删这一个 ref`);
  const before = events.slice(0, unsetIndex);
  assert.ok(before.length > 0, `${label}：unset 之前必须先 describe`);
  assert.ok(before.every((event) => event.startsWith("describe:")), `${label}：unset 之前只有 describe`);
  assert.equal(events[unsetIndex + 1], "mutate", `${label}：unset 之后才写配置`);
  assert.equal(events.filter((event) => event.startsWith("unset:")).length, 1, `${label}：只删一条密钥`);
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：改引用名且旧密钥存在 → 先弹二次确认，不写配置也不删密钥`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.dialog.open, true);
    assert.match(result.dialog.text, /把密钥引用从 PRIMARY_RELAY_API_KEY 改为 PRIMARY_RELAY_KEY_V2？/);
    assert.match(
      result.dialog.text,
      /保存后会删除旧密钥 PRIMARY_RELAY_API_KEY，且无法恢复。新引用 PRIMARY_RELAY_KEY_V2 还没有配置密钥，保存后需要重新填写。/,
    );
    assert.match(result.dialog.text, /先删除旧密钥，成功后才写入新的引用名；删除失败会中止保存。/);
    assert.match(result.dialog.text, /二次确认/);
    assert.equal(result.dialog.confirmLabel, "保存并删除旧密钥");
    assert.equal(result.dialog.confirmDisabled, false);
    assert.deepEqual(result.dialog.events, ["describe:PRIMARY_RELAY_API_KEY"], "确认前只读不写");
    assert.equal(result.dialog.mutations, 0, "弹窗打开时不写配置");
    assert.deepEqual(result.dialog.unset, [], "弹窗打开时不删密钥");
  });

  test(`${scheme} 主题：取消确认 → 配置未写、旧密钥未删`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.cancelled.open, false);
    assert.equal(result.cancelled.mutations, 0);
    assert.deepEqual(result.cancelled.unset, []);
    assert.equal(result.cancelled.provider.apiKeyEnv, "PRIMARY_RELAY_API_KEY");
  });

  test(`${scheme} 主题：确认后先 describe → unset 旧密钥 → 一条 set 写新引用名`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.confirmed.dialogBeforeConfirm.open, true);
    assert.equal(result.confirmed.open, false, "确认后弹窗关闭");
    assertDescribeThenUnset("PRIMARY_RELAY_API_KEY", result.confirmed.events, "改引用名");
    assert.equal(result.confirmed.mutations, 1);
    assert.deepEqual(result.confirmed.lastOps, [
      { op: "set", path: ["providers", "primary-relay", "apiKeyEnv"], value: "PRIMARY_RELAY_KEY_V2" },
    ]);
    assert.equal(result.confirmed.provider.apiKeyEnv, "PRIMARY_RELAY_KEY_V2");
    assert.match(result.confirmed.toast, /已保存路由设置 primary-relay（1 条 op），并删除旧密钥 PRIMARY_RELAY_API_KEY/);
  });

  test(`${scheme} 主题：旧密钥被别的路由共用 → 不弹窗、不 unset，toast 说明保留原因`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.shared.dialogOpen, false);
    assertNoUnset(result.shared.events, "共用密钥");
    assert.equal(result.shared.mutationsDelta, 1);
    assert.deepEqual(result.shared.lastOps, [
      { op: "set", path: ["providers", "shared-relay", "apiKeyEnv"], value: "SHARED_KEY_V2" },
    ]);
    assert.equal(result.shared.provider.apiKeyEnv, "SHARED_KEY_V2");
    assert.match(result.shared.toast, /旧密钥 SHARED_API_KEY 仍被 shared-other 使用，已保留/);
    assert.equal(result.shared.otherProvider.apiKeyEnv, "SHARED_API_KEY", "另一条路由的引用不受影响");
  });

  test(`${scheme} 主题：旧引用由环境变量提供 → 不弹窗、不 unset，toast 说明无法删除`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.readonly.dialogOpen, false);
    assertNoUnset(result.readonly.events, "环境变量提供的密钥");
    assert.equal(result.readonly.mutationsDelta, 1);
    assert.match(result.readonly.toast, /旧引用 ENV_KEY 由环境变量提供，无法删除/);
  });

  test(`${scheme} 主题：旧引用读不到 → 不弹窗、不 unset，toast 提示可能残留`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.unknown.dialogOpen, false);
    assertNoUnset(result.unknown.events, "读不到旧引用");
    assert.equal(result.unknown.mutationsDelta, 1);
    assert.match(result.unknown.toast, /旧引用 UNKNOWN_KEY 的状态未能确认，可能仍保留在凭据存储中/);
  });

  test(`${scheme} 主题：旧引用没有存储的密钥 → 不弹窗、不 unset，照常保存且不加提示`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.absent.dialogOpen, false);
    assertNoUnset(result.absent.events, "没有存储的密钥");
    assert.equal(result.absent.mutationsDelta, 1);
    assert.equal(result.absent.toast, "已保存路由设置 absent-relay（1 条 op）");
  });

  test(`${scheme} 主题：旧引用为空（首次设置密钥）→ 不弹窗、不 unset`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.firstSetupInitialRef, "");
    assert.equal(result.firstSetup.dialogOpen, false);
    assertNoUnset(result.firstSetup.events, "首次设置密钥");
    assert.equal(result.firstSetup.mutationsDelta, 1);
    assert.equal(result.firstSetup.toast, "已保存路由设置 empty-relay（1 条 op）");
  });

  test(`${scheme} 主题：引用名没变（只改别的字段）→ 不弹窗、不碰凭据`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.unchanged.dialogOpen, false);
    assertNoUnset(result.unchanged.events, "引用名没变");
    assert.equal(result.unchanged.mutationsDelta, 1);
    assert.deepEqual(result.unchanged.lastOps, [
      { op: "set", path: ["providers", "plain-relay", "displayName"], value: "Plain Relay" },
    ]);
    assert.equal(result.unchanged.toast, "已保存路由设置 plain-relay（1 条 op）");
  });

  test(`${scheme} 主题：unset 失败 → 中止保存，mutate 未被调用，toast 是错误`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.failing.dialogBeforeConfirm.open, true);
    assert.equal(result.failing.open, false, "失败后弹窗关闭");
    const unsetIndex = result.failing.events.indexOf("unset:FAILING_KEY");
    assert.ok(unsetIndex > 0, `应尝试 unset FAILING_KEY：${result.failing.events.join(" → ")}`);
    assert.ok(
      result.failing.events.slice(0, unsetIndex).every((event) => event.startsWith("describe:")),
      "先 describe 再 unset",
    );
    assert.ok(!result.failing.events.includes("mutate"), "unset 失败后不得写配置");
    assert.equal(result.failing.mutationsDelta, 0);
    assert.match(result.failing.toast, /删除旧密钥失败：宿主拒绝删除（只读凭据）；路由配置未改动/);
    assert.equal(result.failing.provider.apiKeyEnv, "FAILING_KEY", "配置保持旧引用名");
  });
}
