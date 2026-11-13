// 工单 #12 验收判据 5–7：真实布局回归。
//
// lib/client.js 是浏览器模块；这里把它和最小 React 渲染器一起放进 headless
// Chrome，测量真实 DOM 的 getBoundingClientRect()。测试在 Chrome 不可用时
// skip（而不是失败），因为仓库的常规单测仍保持无浏览器依赖。
//
// 覆盖：
// - 提示行始终占位：空 / 合法值 / 非法值 / 清空四种状态下 token 输入框 top 不变；
// - 同一行「路由 / 模型 ID / 显示名」输入框 top 对齐；
// - 自定义候选下拉始终列出全部候选，当前值高亮，点击写入并关闭；
// - changeTokenCount 的非法输入拒绝行为（abc / -1 / 0 不写状态）。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildLayoutHtml } from "./layout-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");

/** 找可用的 Chrome/Chromium；找不到返回 null。 */
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8", timeout: 10_000 });
    if (probe.status === 0) return candidate;
  }
  return null;
}

/** 解析 --dump-dom 的文本节点转义，仅处理测量结果里可能出现的字符。 */
function decodeText(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function runLayoutProbe(chrome) {
  const dir = mkdtempSync(join(tmpdir(), "modelpilot-layout-"));
  const page = join(dir, "index.html");
  writeFileSync(page, buildLayoutHtml(bundle));
  try {
    const run = spawnSync(
      chrome,
      [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--allow-file-access-from-files",
        "--window-size=1440,1000",
        "--virtual-time-budget=10000",
        "--dump-dom",
        pathToFileURL(page).href,
      ],
      { encoding: "utf8", timeout: 60_000, maxBuffer: 20 * 1024 * 1024 },
    );
    assert.equal(run.error, undefined, `chrome failed to start: ${run.error?.message}`);
    const match = run.stdout?.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    assert.ok(match, `layout result missing. stderr: ${run.stderr?.slice(-2000)}`);
    return JSON.parse(decodeText(match[1]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("布局回归：提示行不浮动、同行顶边对齐、候选始终全量", (t) => {
  const chrome = findChrome();
  if (chrome === null) {
    t.skip("未找到 Chrome/Chromium，跳过真实布局测量");
    return;
  }
  const result = runLayoutProbe(chrome);

  // 判据 5：空态 → 合法值 → 非法值 → 清空，输入框屏幕坐标不变。
  assert.equal(result.emptyTop, result.filledTop, "合法值出现提示行后输入框 top 不变");
  assert.equal(result.filledTop, result.beforeErrorTop, "错误提示出现前输入框 top 不变");
  for (const invalid of result.invalid) {
    assert.equal(result.beforeErrorTop, invalid.top, `非法输入 ${invalid.input} 后输入框 top 不变`);
  }
  assert.equal(result.beforeErrorTop, result.cleared.top, "清空提示行后输入框 top 不变");
  assert.equal(result.emptyHint, false, "空态不显示 K/M 提示");

  // 判据 6：同一行路由 / 模型 ID / 显示名输入框顶边对齐。
  assert.equal(result.row1Tops.model, result.row1Tops.route, `模型 ID 与路由顶边应对齐：${JSON.stringify(result.row1Tops)}`);
  assert.equal(result.row1Tops.display, result.row1Tops.route, `显示名与路由顶边应对齐：${JSON.stringify(result.row1Tops)}`);
  assert.equal(result.finalRow1Tops.model, result.finalRow1Tops.route);
  assert.equal(result.finalRow1Tops.display, result.finalRow1Tops.route);

  // 判据 1–3：候选全量、高亮、点击写入并关闭。
  assert.deepEqual(result.contextCandidates, ["8192", "32768", "65536", "131072", "200000", "262144", "1000000"]);
  assert.equal(result.contextActive, "131072");
  assert.equal(result.contextPanelOpen, 7);
  assert.deepEqual(result.afterPick, { value: "200000", panelOpen: 0 });
  assert.equal(result.datalists, 0, "原生 datalist 已移除");

  assert.deepEqual(result.maxCandidates, ["4096", "8192", "16384", "32768", "65536", "131072"]);
  assert.equal(result.escapeClosed, true);
  assert.equal(result.outsideBefore, 7);
  assert.equal(result.outsideClosed, true);
  assert.equal(result.inputMode, "numeric");

  // 判据 7：abc / -1 / 0 不写状态，回显上一次合法值并显示红色「请输入正整数」。
  for (const invalid of result.invalid) {
    assert.equal(invalid.value, "200000", `非法输入 ${invalid.input} 不写入状态`);
    assert.equal(invalid.message, true, `非法输入 ${invalid.input} 显示错误提示`);
  }
  assert.equal(result.cleared.hintGone, true);
  assert.deepEqual(result.hints, { contextWindow: true, maxTokens: true });
});
