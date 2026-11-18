// 工单 #32 第一批：路由设置卡片 / 九字段编辑 / 删除整条路由的真实 DOM 测试。
//
// 在 light / dark 两套宿主 token 下用 headless Chrome 渲染打包后的 lib/client.js，
// 做真实点击并读回表单值、mutate 参数、计算样式。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_TOKENS, findChrome, runPageProbe } from "./layout-harness.mjs";
import { FALLBACK_API_PROTOCOLS } from "../../src/core/route-edit.js";
import { buildRouteEditHtml } from "./route-edit-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme, variant = "multi:schema") {
  const key = `${scheme}:${variant}`;
  if (!probes.has(key)) {
    const [routeMode, schemaMode] = variant.split(":");
    probes.set(key, runPageProbe(chrome, buildRouteEditHtml(bundle, scheme, { routeMode, schemaMode })));
  }
  return probes.get(key);
}

function rgbOf(hex) {
  const value = hex.replace("#", "").slice(0, 6);
  const number = Number.parseInt(value, 16);
  return `rgb(${(number >> 16) & 0xff}, ${(number >> 8) & 0xff}, ${number & 0xff})`;
}

function token(scheme, name) {
  return rgbOf(THEME_TOKENS[scheme][name]);
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：路由设置卡片默认折叠，摘要显示输出上限 / 上下文 / 模型数`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.initial.collapsed, true, "卡片默认折叠");
    assert.equal(result.initial.summary.replace(/ⓘ/g, "").trim(), "▶ 路由设置 · 输出上限 33K · 上下文 1M · 3 个模型");
    assert.equal(result.initial.route, "preview-chat");
  });

  test(`${scheme} 主题：展开后十个字段预填，未改动时保存禁用`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.expanded.open, true);
    assert.deepEqual(
      {
        displayName: result.expanded.displayName,
        baseURL: result.expanded.baseURL,
        api: result.expanded.api,
        apiKeyEnv: result.expanded.apiKeyEnv,
        defaultContextWindow: result.expanded.defaultContextWindow,
        defaultMaxTokens: result.expanded.defaultMaxTokens,
        cacheRetention: result.expanded.cacheRetention,
        transport: result.expanded.transport,
        timeoutMs: result.expanded.timeoutMs,
      },
      {
        displayName: "Preview Chat",
        baseURL: "https://preview.invalid/v1",
        api: "openai-completions",
        apiKeyEnv: "PREVIEW_CHAT_API_KEY",
        defaultContextWindow: "1000000",
        defaultMaxTokens: "32768",
        cacheRetention: "short",
        transport: "auto",
        timeoutMs: "60000",
      },
    );
    assert.equal(result.expanded.saveDisabled, true);
    assert.equal(result.expanded.deleteDisabled, false);
    assert.equal(result.expanded.changed, true);
    assert.deepEqual(result.expanded.ops, []);
    assert.equal(result.expanded.defaultsHint, true);
    assert.deepEqual(result.expanded.cacheOptions, ["", "none", "short", "long"]);
    assert.deepEqual(result.expanded.transportOptions, ["", "sse", "websocket", "websocket-cached", "auto"]);
    // 第 10 个字段：模态候选来自 schema；路由没声明 defaultInput → 全部不选。
    assert.deepEqual(result.expanded.defaultInputChips, ["text", "image", "audio"]);
    assert.deepEqual(result.expanded.defaultInputChecked, []);
    assert.equal(result.expanded.defaultInputHintSchema, true);
  });

  test(`${scheme} 主题：api 下拉的选项来自宿主 schema`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.expanded.apiOptions, [
      "",
      "openai-completions",
      "openai-responses",
      "azure-openai-responses",
      "openai-codex-responses",
      "anthropic-messages",
      "mistral-conversations",
      "bedrock-converse-stream",
      "preview-experimental",
    ]);
    assert.equal(result.expanded.schemaHint, true);
    assert.equal(result.expanded.fallbackNotice, false);
  });

  test(`${scheme} 主题：改 baseURL + defaultMaxTokens → 2 条 set 叶子路径，保存后摘要同步`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.edit.saveDisabled, false);
    assert.equal(result.edit.changed, true);
    assert.deepEqual(result.edit.ops, [
      { op: "set", path: ["providers", "preview-chat", "baseURL"], value: "https://preview.invalid/v2" },
      { op: "set", path: ["providers", "preview-chat", "defaultMaxTokens"], value: 16384 },
    ]);
    assert.match(result.edit.opsSummary, /将写入的配置项（2 条）/);

    assert.equal(result.save.mutations, 1);
    assert.deepEqual(result.save.lastOps, result.edit.ops);
    assert.match(result.save.summaryAfter, /输出上限 16K/);
    assert.equal(result.save.formAfter.baseURL, "https://preview.invalid/v2");
    assert.equal(result.save.formAfter.defaultMaxTokens, "16384");
    // 路由上的其它字段（models / compat / 宿主未来字段）原样保留。
    assert.equal(result.save.provider.models.length, 3);
    assert.deepEqual(result.save.provider.compat, { supportsReasoningEffort: true });
    assert.deepEqual(result.save.provider.futureHostField, { keep: true });
    assert.equal(result.save.provider.displayName, "Preview Chat");
  });

  test(`${scheme} 主题：清空 displayName → 1 条 unset 叶子路径，不是 set null`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.clear.saveDisabled, false);
    assert.equal(result.clear.changed, true);
    assert.deepEqual(result.clear.ops, [
      { op: "unset", path: ["providers", "preview-chat", "displayName"] },
    ]);
    assert.equal(result.clearSaved.mutations, 2);
    assert.deepEqual(result.clearSaved.lastOps, result.clear.ops);
    assert.equal(result.clearSaved.displayName, undefined);
  });

  test(`${scheme} 主题：删除确认写明模型条数与不可撤销，取消不写入`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.deleteDialog.open, true);
    // 工单 #26：标题带路由 id，正文按密钥状态分两套；这条路由的密钥已配置。
    assert.match(result.deleteDialog.text, /删除路由「preview-chat」？/);
    assert.match(result.deleteDialog.text, /移除该路由的全部配置（3 个模型）/);
    assert.match(result.deleteDialog.text, /并一并删除存储的密钥 PREVIEW_CHAT_API_KEY/);
    assert.match(result.deleteDialog.text, /密钥删除后无法恢复/);
    assert.match(result.deleteDialog.text, /这一步不能撤销/);
    assert.equal(result.deleteDialog.confirmLabel, "删除路由和密钥");
    assert.equal(result.deleteDialog.confirmDisabled, false);
    assert.ok(result.deleteDialog.danger.ratio >= 4.5, `删除按钮对比度 ${result.deleteDialog.danger.ratio}`);
    assert.equal(result.deleteDialog.cancelled, true);
    assert.equal(result.deleteDialog.mutationsAfterCancel, 2);
  });

  test(`${scheme} 主题：确认删除 → 先删密钥，再 1 条 unset 整条路由，选择器切到下一条路由`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    // 工单 #26：密钥先删（引用名从 apiKeyEnv 派生，配置删掉就查不到了）。
    assert.deepEqual(result.remove.unsetCalls, ["PREVIEW_CHAT_API_KEY"]);
    assert.equal(result.remove.mutations, 3);
    assert.deepEqual(result.remove.lastOps, [{ op: "unset", path: ["providers", "preview-chat"] }]);
    assert.deepEqual(result.remove.routes, ["backup-route", "spare-route"]);
    assert.equal(result.remove.routeAfter, "backup-route");
    assert.match(result.remove.summaryAfter, /路由设置 · 输出上限 未设置 · 上下文 未设置 · 1 个模型/);
    assert.match(result.remove.listAfter, /该路由的模型（1 条）/);
  });

  test(`${scheme} 主题：删除期间路由被别处删掉 → stale-route，拒绝写入`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.staleDelete.mutations, result.remove.mutations, "stale-route 不应产生新的 mutate");
    assert.equal(result.staleDelete.message, true);
    assert.equal(result.staleDelete.routeStillMissing, true);
  });

  test(`${scheme} 主题：只剩一个路由时删除禁用并提示「至少要保留一个路由」，协议退回内置清单`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "one:fallback");
    assert.equal(result.deleteDisabled, true);
    assert.equal(result.lastRouteHint, true);
    assert.equal(result.fallbackNotice, true);
    assert.deepEqual(result.apiOptions, ["", ...FALLBACK_API_PROTOCOLS]);
    assert.deepEqual(result.defaultInputChips, ["text", "image"], "模态候选退回内置 text / image");
    assert.deepEqual(result.defaultInputChecked, []);
    assert.equal(result.modalFallbackNotice, true, "标注「使用内置模态清单」");
    assert.equal(result.saveDisabled, true);
    assert.equal(result.mutations, 0);
  });

  test(`${scheme} 主题：卡片 / 下拉 / 删除弹窗跟随 token，primary 与 danger 对比度 ≥ 4.5`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.theme.card.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.equal(result.theme.select.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.equal(result.theme.select.color, token(scheme, "--dsw-alias-label-primary"));
    assert.ok(result.theme.save.ratio >= 4.5, `保存按钮对比度 ${result.theme.save.ratio}`);
    assert.ok(result.theme.danger.ratio >= 4.5, `删除路由按钮对比度 ${result.theme.danger.ratio}`);
    assert.equal(result.deleteDialog.background, token(scheme, "--dsw-alias-bg-layer-1"));
    assert.equal(result.deleteDialog.color, token(scheme, "--dsw-alias-label-primary"));
    assert.ok(result.deleteDialog.danger.ratio >= 4.5, `确认删除按钮对比度 ${result.deleteDialog.danger.ratio}`);
  });

  test(`${scheme} 主题：常驻语义提示已移除，回落依据在悬停里；默认值留空显示内置回落常量`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "usage");
    assert.equal(result.blank.lines, 3, "默认值区块只保留三个字段的当前状态行");
    assert.doesNotMatch(result.blank.block, /未声明窗口 \/ 输出上限 \/ 输入模态的模型回落到这里的默认值/);
    assert.doesNotMatch(result.blank.block, /回落顺序：模型自己 → 内置目录 → 这里/);
    assert.match(result.blank.summaryTip, /只写改动过的字段/);
    assert.match(result.blank.summaryTip, /回落顺序：模型自己 → 内置目录 → 路由默认值/);
    assert.match(result.blank.inputTip, /留空 = 按纯文本处理/);
    assert.match(result.blank.inputTip, /不改压缩阈值/);
    assert.equal(result.blank.windowLine, "默认上下文：留空 → 使用内置默认值 1,000,000（1M）");
    assert.equal(result.blank.outputLine, "默认输出上限：留空 → 使用内置默认值 128,000（128K）");
    assert.equal(
      result.blank.inputLine,
      "默认输入模态：留空 → 使用内置默认值 text（按纯文本处理）",
    );
    assert.equal(result.blank.countButtons, 0, "留空时没有可展开的计数");
    assert.equal(result.blank.mutations, 0);
  });

  test(`${scheme} 主题：计数随表单值实时变化，窗口与输出上限分别统计`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "usage");
    assert.equal(result.windowTyped.windowLine, "默认上下文：当前路由 3 个模型中有 1 个会使用这两个值。");
    assert.equal(result.windowTyped.outputLine, "默认输出上限：留空 → 使用内置默认值 128,000（128K）");
    assert.equal(result.blank.mutations, 0);
    assert.equal(result.windowTyped.mutations, 0, "计数不需要保存就更新");
    assert.equal(result.bothTyped.windowLine, "默认上下文：当前路由 3 个模型中有 1 个会使用这两个值。");
    assert.equal(result.bothTyped.outputLine, "默认输出上限：当前路由 3 个模型中有 2 个会使用这两个值。");
    assert.equal(result.bothTyped.mutations, 0);
    assert.equal(result.windowCleared.windowLine, "默认上下文：留空 → 使用内置默认值 1,000,000（1M）");
    assert.equal(result.windowCleared.outputLine, "默认输出上限：当前路由 3 个模型中有 2 个会使用这两个值。");
    assert.equal(result.windowCleared.windowListGone, true);
    assert.equal(result.windowCleared.mutations, 0);
  });

  test(`${scheme} 主题：点「N 个」就地展开 / 收起清单，每条写清未声明什么`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "usage");
    assert.equal(result.windowExpanded.expanded, true);
    assert.equal(result.windowExpanded.list, "jxf/dsv4.1-flash —— 未声明窗口 / 输出上限");
    assert.equal(result.windowCollapsed.collapsed, true);
    assert.equal(
      result.outputExpanded.list,
      [
        "jxf/dsv4.1-flash —— 未声明窗口 / 输出上限",
        "tx/deepseek-v4.1-chat —— 未声明输出上限（已声明窗口）",
      ].join("\n"),
    );
  });

  test(`${scheme} 主题：全部受影响 / 全部不受影响 / 没有模型 三种边界`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "usage");
    assert.equal(result.allAffected.windowLine, "默认上下文：当前路由 2 个模型全部使用这两个值。");
    assert.equal(result.allAffected.outputLine, "默认输出上限：当前路由 2 个模型全部使用这两个值。");
    assert.equal(result.noneAffected.windowLine, "默认上下文：当前路由 1 个模型都已声明自己的值，这两个输入框不影响它们。");
    assert.equal(result.noneAffected.outputLine, "默认输出上限：当前路由 1 个模型都已声明自己的值，这两个输入框不影响它们。");
    assert.equal(result.empty.hasCountText, false, "路由没有模型时不显示计数行");
    assert.equal(result.empty.emptyListHint, true);
    assert.equal(result.empty.mutations, 0);
  });
  test(`${scheme} 主题：默认输入模态候选来自 schema，预填声明值，计数只数未声明 input 的模型`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "input:schema");
    assert.equal(result.prefill.open, true);
    assert.deepEqual(result.prefill.chips, ["text", "image", "audio"], "候选从 schema 现读");
    assert.deepEqual(result.prefill.checked, ["image"], "只预填路由声明的 image");
    assert.equal(result.prefill.inputTip, true, "留空后果在提示里");
    assert.equal(result.prefill.fallbackNotice, false);
    assert.equal(result.prefill.saveDisabled, true, "未改动时保存禁用");
    assert.deepEqual(result.prefill.ops, []);
    assert.equal(
      result.prefill.countLine,
      "默认输入模态：当前路由 4 个模型中有 2 个会使用这个默认值。",
    );
    assert.equal(result.prefill.countButton, true);
    assert.equal(result.prefill.mutations, 0, "计数不需要保存");
    assert.equal(result.count.expanded, true);
    // input: [] 算已声明；只声明 token 的模型在输入模态计数里仍然受影响。
    assert.equal(
      result.count.list,
      [
        "jxf/undeclared —— 未声明输入模态（路由默认值生效）",
        "jxf/tokens-only —— 未声明输入模态（路由默认值生效）",
      ].join("\n"),
    );
  });

  test(`${scheme} 主题：默认输入模态 chip 选中态可辨识，填充对比度 ≥ 3.0`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "input:schema");
    assert.equal(result.theme.selected.checked, true);
    assert.equal(result.theme.unselected.checked, false);
    // 工单 #41：不能只比对 border 字符串 —— 旧样式 #ffffff1f 与 #81858c 也
    // 「不相等」，但填充只差 1.64，用户依然看不出勾选。这里验真实填充对比度。
    assert.ok(
      result.theme.fillContrast >= 3.0,
      `选中/未选中填充对比度 ${result.theme.fillContrast}`,
    );
    assert.ok(
      result.theme.selected.borderWidth > result.theme.unselected.borderWidth,
      `选中边框 ${result.theme.selected.borderWidth}px 应大于未选中 ${result.theme.unselected.borderWidth}px`,
    );
    assert.ok(result.theme.selected.fontWeight >= 600, `选中字重 ${result.theme.selected.fontWeight}`);
    assert.ok(result.theme.unselected.fontWeight <= 400, `未选中字重 ${result.theme.unselected.fontWeight}`);
    assert.equal(result.theme.selected.mark, true, "选中态文字前应有勾选标记");
    assert.equal(result.theme.unselected.mark, false, "未选中态不应有勾选标记");
    assert.ok(
      result.theme.selected.ratio >= 4.5,
      `选中 chip 文字对比度 ${result.theme.selected.ratio}（${result.theme.selected.color} / ${result.theme.selected.background}）`,
    );
    assert.ok(
      result.theme.unselected.ratio >= 4.5,
      `未选中 chip 文字对比度 ${result.theme.unselected.ratio}`,
    );
  });

  test(`${scheme} 主题：默认输入模态选 text + image → 1 条 set 叶子路径，保存后写入数组`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "input:schema");
    assert.deepEqual(result.select.ops, [
      { op: "set", path: ["providers", "modal-chat", "defaultInput"], value: ["text", "image"] },
    ]);
    assert.equal(result.select.changed, true);
    assert.equal(result.select.saveDisabled, false);
    assert.equal(result.select.mutations, 0, "预览 op 不写盘");
    assert.equal(result.select.countLine, "默认输入模态：当前路由 4 个模型中有 2 个会使用这个默认值。");
    assert.equal(result.saved.mutations, 1);
    assert.deepEqual(result.saved.lastOps, result.select.ops);
    assert.deepEqual(result.saved.provider.defaultInput, ["text", "image"]);
    assert.deepEqual(result.saved.checked, ["text", "image"]);
  });

  test(`${scheme} 主题：默认输入模态全部取消 → 1 条 unset，保存后显示宿主回落 text`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "input:schema");
    assert.deepEqual(result.cleared.checked, []);
    assert.deepEqual(result.cleared.ops, [
      { op: "unset", path: ["providers", "modal-chat", "defaultInput"] },
    ]);
    assert.equal("value" in result.cleared.ops[0], false, "清空必须 unset，不能写 []");
    assert.equal(result.cleared.saveDisabled, false);
    assert.equal(result.clearedSaved.mutations, 2);
    assert.deepEqual(result.clearedSaved.lastOps, result.cleared.ops);
    assert.equal(result.clearedSaved.provider.defaultInput, undefined);
    assert.deepEqual(result.clearedSaved.checked, []);
    assert.equal(
      result.clearedSaved.fallbackLine,
      "默认输入模态：留空 → 使用内置默认值 text（按纯文本处理）",
    );
    assert.equal(result.clearedSaved.countButtonGone, true, "留空时没有可展开的计数");
  });

  test(`${scheme} 主题：默认输入模态点击顺序颠倒仍按候选顺序写入，等集合不产出 op`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "input:schema");
    // 先点 image 再点 text：表单内部顺序被归一化成 ["text","image"]。
    assert.deepEqual(result.clickOrder.checked, ["text", "image"]);
    assert.deepEqual(result.clickOrder.ops, [
      { op: "set", path: ["providers", "modal-chat", "defaultInput"], value: ["text", "image"] },
    ]);
    // 路由原值 ["image","text"]：集合相同，数组逐元素比较后不算改动。
    assert.deepEqual(result.swapped.checked, ["text", "image"]);
    assert.deepEqual(result.swapped.ops, []);
    assert.equal(result.swapped.saveDisabled, true);
    assert.deepEqual(result.swapped.retoggled.checked, ["text", "image"]);
    assert.deepEqual(result.swapped.retoggled.ops, [], "取消再勾回不产生规则不同的数组");
    assert.equal(result.swapped.retoggled.saveDisabled, true);
    assert.equal(result.swapped.retoggled.mutations, 2, "结构比较不触发写入");
  });

  test(`${scheme} 主题：路由未声明 defaultInput 时全部不选，不产出 op`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "input:schema");
    assert.deepEqual(result.blank.checked, []);
    assert.equal(
      result.blank.line,
      "默认输入模态：留空 → 使用内置默认值 text（按纯文本处理）",
    );
    assert.equal(result.blank.saveDisabled, true);
    assert.equal(result.blank.mutations, 2, "切换路由 / 查看空白字段不写入");
  });

  test(`${scheme} 主题：schema 读不到模态清单时退回 text / image 并标注`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme, "input:fallback");
    assert.deepEqual(result.prefill.chips, ["text", "image"]);
    assert.deepEqual(result.prefill.checked, ["image"]);
    assert.equal(result.prefill.fallbackNotice, true, "标注「使用内置模态清单」");
    assert.equal(result.prefill.saveDisabled, true);
    assert.equal(result.prefill.mutations, 0);
  });
}
