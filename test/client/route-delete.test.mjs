// 工单 #26：删除路由时一并清理存储的密钥 —— 真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，真实点击
// 「删除路由」→ 读弹窗文案 / 按钮文字 / 禁用状态 → 确认，并读回
// credentials.describe / unset 与 mutate 的真实调用顺序。Chrome 不可用时 skip。
//
// 纯规则（引用名、共用判定、每种状态的文案）在 test/core/route-delete.test.mjs。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_TOKENS, findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildRouteDeleteHtml } from "./route-delete-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) {
    probes.set(scheme, runPageProbe(chrome, buildRouteDeleteHtml(bundle, scheme)));
  }
  return probes.get(scheme);
}

function rgbOf(hex) {
  const value = hex.replace("#", "").slice(0, 6);
  const number = Number.parseInt(value, 16);
  return `rgb(${(number >> 16) & 0xff}, ${(number >> 8) & 0xff}, ${number & 0xff})`;
}

function token(scheme, name) {
  return rgbOf(THEME_TOKENS[scheme][name]);
}

/** 不删密钥的场景：没有任何 unset；进入 mutate 之前只有 describe。 */
function assertNoUnsetButMutate(events, label) {
  assert.deepEqual(
    events.filter((event) => event.startsWith("unset:")),
    [],
    `${label}：不应调用 unset，实际 ${events.join(" → ")}`,
  );
  const mutateIndex = events.indexOf("mutate");
  assert.ok(mutateIndex >= 0, `${label}：应删配置，实际 ${events.join(" → ")}`);
  assert.ok(
    events.slice(0, mutateIndex).every((event) => event.startsWith("describe:")),
    `${label}：删配置之前只有 describe`,
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
  assert.equal(events[unsetIndex + 1], "mutate", `${label}：unset 之后才删配置`);
  assert.equal(events.filter((event) => event.startsWith("unset:")).length, 1, `${label}：只删一条密钥`);
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：有密钥的路由，弹窗写明会一并删除密钥，按钮「删除路由和密钥」`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.configured.open, true);
    assert.match(result.configured.text, /删除路由「primary-relay」？/);
    assert.match(result.configured.text, /移除该路由的全部配置（3 个模型）/);
    assert.match(result.configured.text, /并一并删除存储的密钥 PRIMARY_RELAY_API_KEY/);
    assert.match(result.configured.text, /密钥删除后无法恢复/);
    assert.equal(result.configured.confirmLabel, "删除路由和密钥");
    assert.equal(result.configured.confirmDisabled, false);
  });

  test(`${scheme} 主题：取消删除不调用 unset、不写入配置`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.cancelled.open, false);
    assert.deepEqual(result.cancelled.unset, []);
    assert.equal(result.cancelled.mutations, 0);
  });

  test(`${scheme} 主题：确认后先 describe → unset 密钥 → 一条 unset 整条路由`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assertDescribeThenUnset("PRIMARY_RELAY_API_KEY", result.confirmed.events, "有密钥的路由");
    assert.equal(result.confirmed.mutations, 1);
    assert.deepEqual(result.confirmed.lastOps, [{ op: "unset", path: ["providers", "primary-relay"] }]);
    assert.ok(!result.confirmed.routes.includes("primary-relay"));
    assert.equal(result.confirmed.routeAfter, "beta-relay");
    assert.match(result.confirmed.toast, /已删除路由 primary-relay，并删除密钥 PRIMARY_RELAY_API_KEY/);
  });

  test(`${scheme} 主题：没有密钥的路由不调用 unset，只删配置，按钮仍是「删除路由」`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.match(result.absent.text, /移除该路由的全部配置（2 个模型）/);
    assert.match(result.absent.text, /它没有存储的密钥/);
    assert.equal(result.absent.confirmLabel, "删除路由");
    assert.equal(result.absent.confirmDisabled, false);
    assertNoUnsetButMutate(result.absentAfter.events, "没有密钥的路由");
    assert.ok(!result.absentAfter.routes.includes("beta-relay"));
  });

  test(`${scheme} 主题：读不到密钥状态时说明「无法确认」，只删配置并附残留提示`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.match(result.unknown.text, /无法确认是否存在存储的密钥，因此只会删除配置/);
    assert.match(result.unknown.text, /密钥 GAMMA_RELAY_API_KEY 可能仍保留在凭据存储中/);
    assert.equal(result.unknown.confirmLabel, "删除路由");
    assert.equal(result.unknown.confirmDisabled, false);
    assertNoUnsetButMutate(result.unknownAfter.events, "读不到密钥状态的路由");
    assert.equal(result.unknownAfter.mutations, 3);
  });

  test(`${scheme} 主题：密钥被其他路由共用时保留，正文点名共用者，配置照删`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.match(result.shared.text, /移除该路由的全部配置（1 个模型）/);
    assert.match(result.shared.text, /密钥 SHARED_API_KEY 仍被其他路由使用（shared-other），将保留/);
    assert.doesNotMatch(result.shared.text, /一并删除/);
    assert.equal(result.shared.confirmLabel, "删除路由");
    assertNoUnsetButMutate(result.sharedAfter.events, "共用密钥的路由");
    assert.ok(result.sharedAfter.routes.includes("shared-other"), "另一条共用路由不受影响");
    assert.ok(!result.sharedAfter.routes.includes("shared-relay"));
    assert.match(result.sharedAfter.toast, /仍被其他路由使用，将保留/);
  });

  test(`${scheme} 主题：环境变量提供的只读密钥不尝试删除，配置照删`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.match(result.readonly.text, /密钥 ENV_KEY 由环境变量提供，不可从此处删除，将保留/);
    assert.equal(result.readonly.confirmLabel, "删除路由");
    assertNoUnsetButMutate(result.readonlyAfter.events, "环境变量提供的密钥");
    assert.ok(!result.readonlyAfter.routes.includes("env-relay"));
  });

  test(`${scheme} 主题：unset 失败 → 配置一条都不动，报「删除密钥失败…路由配置未改动」`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.failingPlan.confirmLabel, "删除路由和密钥");
    const unsetIndex = result.failing.events.indexOf("unset:FAILING_KEY");
    assert.ok(unsetIndex > 0, `应尝试 unset FAILING_KEY：${result.failing.events.join(" → ")}`);
    assert.ok(
      result.failing.events.slice(0, unsetIndex).every((event) => event.startsWith("describe:")),
      "先 describe 再 unset",
    );
    assert.ok(!result.failing.events.includes("mutate"), "unset 失败后不得删配置");
    assert.match(result.failing.toast, /删除密钥失败：宿主拒绝删除（只读凭据）；路由配置未改动/);
    assert.equal(result.failing.mutationsDelta, 0);
    assert.equal(result.failing.routeStillThere, true);
    assert.equal(result.failing.dialogClosed, true);
  });

  test(`${scheme} 主题：读取密钥状态期间显示「正在检查…」且确认按钮禁用`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.match(result.checking.text, /正在检查是否存在存储的密钥…/);
    assert.equal(result.checking.confirmLabel, "删除路由");
    assert.equal(result.checking.confirmDisabled, true, "状态未定时不允许确认");
    // 读取完成后恢复：按钮启用，并按真实状态换成「删除路由和密钥」。
    assert.equal(result.checked.confirmDisabled, false);
    assert.equal(result.checked.confirmLabel, "删除路由和密钥");
    assertDescribeThenUnset("SLOW_RELAY_API_KEY", result.slowAfter.events, "延迟读取的路由");
    assert.ok(!result.slowAfter.routes.includes("slow-relay"));
  });

  test(`${scheme} 主题：stale-route 守卫不变，确认时不再碰密钥`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.stale.events, [], "路由已不存在时不发任何凭据请求");
    assert.equal(result.stale.mutationsDelta, 0);
    assert.match(result.stale.toast, /stale-route/);
    assert.ok(!result.stale.routes.includes("stale-relay"));
  });

  test(`${scheme} 主题：删除弹窗跟随 token，确认按钮对比度 ≥ 4.5`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.configured.dialogBackground, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.equal(result.configured.dialogColor, token(scheme, "--dsw-alias-label-primary"));
    assert.ok(result.configured.danger.ratio >= 4.5, `确认删除按钮对比度 ${result.configured.danger.ratio}`);
  });

  test(`${scheme} 主题：全部删除流程结束后只剩三条未被删除的路由`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.finalRoutes, ["shared-other", "failing-relay", "spare-relay"]);
  });
}
