// 工单 #24：全部路由总览 + 批量密钥状态（真实 DOM / headless Chrome）。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，逐条验收：
// 默认折叠不查询、64 个一批的 describe、字母序、三态（未知 ≠ 未配置）、
// 点行切换、折叠不查询、增删路由 / 改 apiKeyEnv / 设置清除密钥后的自动刷新、
// 三态圆点与文案的对比度、行 hover 反馈。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildRouteOverviewHtml } from "./route-overview-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scenario, scheme) {
  const key = `${scenario}:${scheme}`;
  if (!probes.has(key)) {
    probes.set(key, runPageProbe(chrome, buildRouteOverviewHtml(bundle, scheme, scenario)));
  }
  return probes.get(key);
}

/** 只看总览自身的批量调用：卡片的单引用 describe 长度是 1。 */
const overviewCalls = (calls) => calls.filter((refs) => refs.length > 1);

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：默认折叠，只报条数，不发 describe`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("mixed", scheme);
    assert.equal(result.collapsed.header, "▶ 全部路由（6 条）");
    assert.equal(result.collapsed.describes, 0, "折叠不产生远程调用");
    assert.equal(result.collapsed.hasTable, false);
  });

  test(`${scheme} 主题：展开后一次 describe 查完去重引用（共用引用只查一次）`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("mixed", scheme);
    assert.equal(result.expanded.header, "▾ 全部路由（6 条 · 3 条密钥已配 · 3 条未配）");
    assert.equal(result.expanded.expanded, "true");
    assert.deepEqual(result.expanded.describeCalls, [[
      "ALPHA_API_KEY",
      "BETA_RELAY_API_KEY",
      "SHARED_API_KEY",
      "GAMMA_LOCAL_API_KEY",
      "ZETA_API_KEY",
    ]]);
    const refs = result.expanded.describeCalls[0];
    assert.equal(refs.length, 5, "6 条路由、5 个唯一引用");
    assert.equal(refs.filter((ref) => ref === "SHARED_API_KEY").length, 1, "共用引用只查一次");
    assert.equal(new Set(refs).size, refs.length, "没有重复引用");
  });

  test(`${scheme} 主题：行按路由 id 字母序，模型数 0 显示「未设置」、协议空显示「未指定」`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("mixed", scheme);
    assert.deepEqual(result.expanded.rows.map((row) => row.id), [
      "alpha-chat",
      "beta-relay",
      "delta-claude",
      "epsilon-relay",
      "gamma-local",
      "zeta-chat",
    ]);
    const byId = Object.fromEntries(result.expanded.rows.map((row) => [row.id, row.cells]));
    assert.deepEqual(byId["alpha-chat"].slice(1), ["3", "● 已配置", "openai-completions", "切换"]);
    assert.deepEqual(byId["beta-relay"].slice(1), ["2", "○ 未配置", "anthropic-messages", "切换"]);
    assert.deepEqual(byId["gamma-local"].slice(1), ["未设置", "● 已配置", "未指定", "切换"]);
    assert.equal(byId["epsilon-relay"][1], "4");
    assert.equal(byId["delta-claude"][1], "1");
  });

  test(`${scheme} 主题：当前行有「当前」标记，切换按钮禁用；点行切换后下方同步且总览保持展开`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("mixed", scheme);
    const current = result.expanded.rows.find((row) => row.id === "zeta-chat");
    assert.match(current.cells[0], /zeta-chat/, "当前行");
    assert.match(current.cells[0], /当前/, "当前行标记");
    assert.equal(current.cells[4], "当前", "当前行的按钮是「当前」");
    assert.equal(result.switched.selected, "beta-relay");
    assert.equal(result.switched.overviewExpanded, true, "切换后总览保持展开");
    assert.match(result.switched.overviewHeader, /6 条 · 3 条密钥已配 · 3 条未配/);
    assert.match(result.switched.modelsTitle, /该路由的模型（2 条）/);
    assert.equal(result.switched.routeCardExpanded, "false", "路由设置卡片仍折叠");
    assert.equal(result.switched.describes, 1, "切换路由本身不触发新的总览 describe");
  });

  test(`${scheme} 主题：点当前行不做任何事（不重复加载、不重置）`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("mixed", scheme);
    assert.equal(result.currentRowClick.selected, "beta-relay");
    assert.equal(result.currentRowClick.describes, 1, "点当前行不重新查询");
    assert.equal(result.currentRowClick.overviewExpanded, true);
  });

  test(`${scheme} 主题：行 hover 有背景反馈，过渡复用 ROW_HOVER_MS = 120ms`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("mixed", scheme);
    assert.notEqual(result.hover.after, result.hover.before, "hover 后背景变化");
    assert.match(result.hover.transition.property, /background-color/);
    assert.equal(result.hover.transition.duration, "0.12s");
  });

  test(`${scheme} 主题：折叠后不再查询，重新展开才再查一次`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("mixed", scheme);
    assert.equal(result.collapsedAgain.hasTable, false);
    assert.match(result.collapsedAgain.header, /^▶ 全部路由（6 条 · 3 条密钥已配 · 3 条未配）/);
    assert.equal(result.collapsedAgain.describes, 1, "折叠期间没有新请求");
    assert.equal(result.reopened.describes, 2, "重新展开重新读一次");
  });

  test(`${scheme} 主题：设置密钥后总览自动刷新（订阅 credentialRefresh + 新 describe）`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("mixed", scheme);
    assert.deepEqual(result.setKey.setCalls, [{ ref: "BETA_RELAY_API_KEY", value: "  overview-secret  " }]);
    assert.equal(overviewCalls(result.setKey.overviewCalls).length, 3, "初始 1 次 + 重新展开 1 次 + 保存后 1 次");
    assert.equal(result.setKey.keyText, "● 已配置");
    assert.match(result.setKey.header, /4 条密钥已配 · 2 条未配/);
    assert.equal(result.setKey.secretInBodyText, false, "总览不显示密钥明文");
    assert.equal(result.setKey.secretInStorage, false, "密钥不进入 Web Storage");
  });

  test(`${scheme} 主题：清除密钥后总览自动刷新`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("mixed", scheme);
    assert.deepEqual(result.clearKey.unsetCalls, ["BETA_RELAY_API_KEY"]);
    assert.equal(result.clearKey.keyText, "○ 未配置");
    assert.match(result.clearKey.header, /3 条密钥已配 · 3 条未配/);
    assert.ok(result.clearKey.describes > result.setKey.describes, "清除后重新 describe");
  });

  test(`${scheme} 主题：改 apiKeyEnv 并保存后，行与批量请求换成新引用`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("mixed", scheme);
    assert.equal(result.changedRef.selected, "beta-relay");
    assert.equal(result.changedRef.mutations, true, "保存走宿主 configForms");
    assert.equal(result.changedRef.keyText, "● 已配置", "新引用已配置");
    assert.match(result.changedRef.header, /4 条密钥已配 · 2 条未配/);
    const lastOverview = overviewCalls(result.changedRef.overviewCalls).at(-1);
    assert.ok(lastOverview.includes("NEW_BETA_KEY"), "新引用进入批量查询");
    assert.ok(!lastOverview.includes("BETA_RELAY_API_KEY"), "旧引用不再查询");
  });

  test(`${scheme} 主题：增 / 删路由后总览行自动增减，并重查引用`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("mixed", scheme);
    assert.equal(result.addedRoute.hasRow, true, "新增路由出现在总览");
    assert.equal(result.addedRoute.rows, 7);
    assert.match(result.addedRoute.header, /7 条 · 4 条密钥已配 · 3 条未配/);
    assert.ok(
      overviewCalls(result.addedRoute.overviewCalls).at(-1).includes("THETA_ADDED_API_KEY"),
      "空 apiKeyEnv 的新路由按 deriveKeyRef(id) 查询，而不是跳过",
    );
    assert.equal(result.deletedRoute.hasRow, false, "删除的路由从总览消失");
    assert.equal(result.deletedRoute.rows, 6);
    assert.match(result.deletedRoute.header, /6 条 · 3 条密钥已配 · 3 条未配/);
    assert.ok(
      !overviewCalls(result.deletedRoute.overviewCalls).at(-1).includes("ZETA_API_KEY"),
      "删除路由后不再查询它的引用",
    );
  });

  test(`${scheme} 主题：已配置 / 未配置圆点用字形 + 颜色双重编码，圆点与文案对比度 ≥ 4.5`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("mixed", scheme);
    const on = result.expanded.dots.configured;
    const off = result.expanded.dots.unconfigured;
    assert.equal(on.glyph, "●", "已配置是实心圆");
    assert.equal(off.glyph, "○", "未配置是空心圆");
    assert.notEqual(on.background, off.background, "底色不同");
    assert.notEqual(on.borderColor, off.borderColor, "描边不同");
    assert.equal(result.expanded.keyTexts["alpha-chat"], "● 已配置");
    assert.equal(result.expanded.keyTexts["beta-relay"], "○ 未配置");
    for (const [state, dot] of [["已配置", on], ["未配置", off]]) {
      assert.ok(dot.dotContrast >= 4.5, `${state}圆点对比度 ${dot.dotContrast}`);
      assert.ok(dot.labelContrast >= 4.5, `${state}文案对比度 ${dot.labelContrast}`);
    }
  });
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：某批失败 → 该批及之后显示「? 未知」，已成功的不受影响，可重试`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("partial", scheme);
    assert.deepEqual(result.failed.describeLengths, [64, 1], "第一批成功、第二批失败");
    assert.equal(result.failed.rowCount, 65);
    assert.equal(result.failed.firstKey, "● 已配置", "已成功的批次不受影响");
    assert.equal(result.failed.lastKey, "? 未知", "失败批及之后是未知，不是未配置");
    assert.equal(
      result.failed.header,
      "▾ 全部路由（65 条 · 64 条密钥已配 · 0 条未配 · 1 条未知）",
      "未知单独计数，不混进「未配」",
    );
    assert.match(result.failed.warning, /部分密钥状态读取失败（凭据服务不可用）/);
    assert.match(result.failed.warning, /重试/);
    assert.deepEqual(result.retried.describeLengths.slice(0, 2), [64, 1], "失败时确实只读了 2 批");
    assert.equal(result.retried.lastKey, "● 已配置", "重试后成功");
    assert.match(result.retried.header, /65 条密钥已配 · 0 条未配/);
    assert.equal(result.retried.warningPresent, false);
  });

  test(`${scheme} 主题：未知圆点用「?」+ 告警色，与已配置 / 未配置可区分且对比度 ≥ 4.5`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe("partial", scheme);
    const unknown = result.failed.dot;
    const configured = result.failed.firstDot;
    assert.equal(unknown.glyph, "?");
    assert.notEqual(unknown.glyph, configured.glyph, "字形不同");
    assert.notEqual(unknown.background, configured.background, "底色不同");
    assert.notEqual(unknown.borderColor, configured.borderColor, "描边不同");
    assert.ok(unknown.dotContrast >= 4.5, `未知圆点对比度 ${unknown.dotContrast}`);
    assert.ok(result.failed.unknownRowLabelContrast >= 4.5, "未知文案对比度");
  });
}

test("loading：展开后立即显示「正在读取密钥状态…」，不把任何一行说成未配置", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("loading", "light");
  assert.equal(result.loading.statusText, "正在读取密钥状态…");
  assert.match(result.loading.header, /正在读取密钥状态…/);
  assert.ok(!result.loading.bodyText.includes("未配置"), "加载中不能显示未配置");
  assert.deepEqual(Object.values(result.loading.keyTexts), ["…", "…", "…", "…", "…", "…"]);
  assert.equal(result.ready.statusPresent, false, "读取完成后收起状态行");
  assert.equal(result.ready.keyTexts["alpha-chat"], "● 已配置");
  assert.equal(result.ready.keyTexts["beta-relay"], "○ 未配置");
});

test("65 条路由 → 恰好 2 次 describe（64 + 1），每批不超过 64", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("batch65", "light");
  assert.deepEqual(result.batch.describeLengths, [64, 1]);
  assert.equal(result.batch.rowCount, 65);
  assert.equal(result.batch.header, "▾ 全部路由（65 条 · 65 条密钥已配 · 0 条未配）");
  const flat = result.batch.describeCalls.flat();
  assert.equal(flat.length, 65);
  assert.equal(new Set(flat).size, 65);
  assert.ok(result.batch.describeCalls.every((refs) => refs.length <= 64));
});

test("128 条路由 → 恰好 2 次 describe（64 + 64），每批不超过 64", async (t) => {
  if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
  const result = await probe("batch128", "dark");
  assert.deepEqual(result.batch.describeLengths, [64, 64]);
  assert.equal(result.batch.rowCount, 128);
  assert.equal(result.batch.header, "▾ 全部路由（128 条 · 128 条密钥已配 · 0 条未配）");
  const flat = result.batch.describeCalls.flat();
  assert.equal(new Set(flat).size, 128);
  assert.ok(result.batch.describeCalls.every((refs) => refs.length <= 64));
});
