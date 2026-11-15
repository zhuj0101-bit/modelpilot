// 工单 #30：提示文案精简（说明进 hover，状态常驻）的真实 DOM 验收。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，逐条读回：
// 初始可见的旧说明已消失、字段标签的 ⓘ 保留完整信息、条件文案只在条件
// 成立时出现、状态行不受影响。Chrome 不可用时 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildHintCopyHtml } from "./hint-copy-trim-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildHintCopyHtml(bundle, scheme)));
  return probes.get(scheme);
}

const skip = (t) => t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：初始页不再常驻功能说明，旧实现细节全部消失`, async (t) => {
    if (chrome === null) return skip(t);
    const { initial } = await probe(scheme);
    assert.deepEqual(initial.oldExplanation, [], "初始页不应出现旧的说明句");
    assert.doesNotMatch(initial.body, /合成字段，只写字段级最小补丁/);
    assert.doesNotMatch(initial.body, /填入模型 ID 后这里显示将要写入的内容/);
    assert.doesNotMatch(initial.body, /支持的推理档位：/);
    assert.doesNotMatch(initial.body, /maxTokens 有两个作用/);
    assert.match(initial.headerTip, /按用户档案 → 目录 → 模板 → 预设合成字段/);
    assert.match(initial.headerTip, /只写入改动过的字段，冲突时自动重读配置/);
    assert.match(initial.modelIdTip, /输入后可在下方预览/);
    assert.match(initial.reasoningTip, /全不选 = 不设置推理档位/);
    assert.match(initial.maxTokensTip, /填得越大能装的历史越少/);
  });

  test(`${scheme} 主题：展开路由设置后，字段说明在 ⓘ hover 里，静态长句已移除`, async (t) => {
    if (chrome === null) return skip(t);
    const { expanded } = await probe(scheme);
    assert.deepEqual(expanded.oldExplanation, [], "展开后也不应出现实现名词");
    assert.equal(expanded.staticSemanticsGone, true, "静态三行语义已移除");
    assert.match(expanded.summaryTip, /只写改动过的字段/);
    assert.match(expanded.summaryTip, /回落顺序：模型自己 → 内置目录 → 路由默认值/);
    assert.match(expanded.summaryTip, /默认值不改压缩阈值/);
    assert.match(expanded.displayNameTip, /留空 = 清空该字段/);
    assert.match(expanded.baseUrlTip, /http:\/\/ 或 https:\/\//);
    assert.match(expanded.apiTip, /选项随应用版本自动更新/);
    assert.match(expanded.keyRefTip, /密钥在凭据库中的名称/);
    assert.match(expanded.contextTip, /留空 = 内置默认值 1,000,000/);
    assert.match(expanded.maxTokensTip, /留空 = 内置默认值 128,000/);
    assert.match(expanded.timeoutTip, /留空 = 不声明超时/);
    assert.match(expanded.inputTip, /留空 = 按纯文本处理/);
    assert.match(expanded.inputTip, /已声明输入模态的模型不受影响/);
    assert.match(expanded.cacheTip, /留空 = 不声明缓存策略/);
    assert.match(expanded.transportTip, /留空 = 不声明传输方式/);
    assert.match(expanded.credentialTip, /密钥单独保存，不会写进配置文件/);
  });

  test(`${scheme} 主题：默认值当前状态行保留，且只在条件成立时出现`, async (t) => {
    if (chrome === null) return skip(t);
    const { expanded } = await probe(scheme);
    assert.equal(expanded.defaultLines.length, 3, "三个默认值字段各一行当前状态");
    assert.ok(expanded.defaultLines.some((line) => line.startsWith("默认上下文：")));
    assert.ok(expanded.defaultLines.some((line) => line.startsWith("默认输出上限：")));
    assert.ok(expanded.defaultLines.some((line) => line.startsWith("默认输入模态：")));
    assert.ok(!expanded.defaultLines.some((line) => line.includes("未声明窗口 / 输出上限 / 输入模态的模型回落到这里的默认值")));
  });

  test(`${scheme} 主题：筛选状态下不可排序只在搜索非空时出现在悬停里`, async (t) => {
    if (chrome === null) return skip(t);
    const { filter } = await probe(scheme);
    assert.doesNotMatch(filter.emptyTitle, /筛选状态下不可排序/);
    assert.equal(filter.emptyBody, false, "搜索为空时页面文字不出现条件说明");
    assert.match(filter.typedTitle, /筛选状态下不可排序/);
    assert.equal(filter.typedBody, false, "条件说明只进 title，不常驻");
    assert.doesNotMatch(filter.clearedTitle, /筛选状态下不可排序/);
  });

  test(`${scheme} 主题：每个 ⓘ 的悬停说明都是短句，不塞整段`, async (t) => {
    if (chrome === null) return skip(t);
    const { initial, expanded } = await probe(scheme);
    for (const tip of [...initial.tips, ...expanded.tips]) {
      for (const line of tip.split("\n")) {
        assert.ok(line.length <= 40, `悬停说明过长（${line.length}）：${line}`);
      }
    }
  });
}
