// 工单 #17：工作台视觉重做（设计变量 + 三区块 + 反馈）的回归测试。
//
// 两部分：
// - 静态断言：设计变量确实存在、样式对象不再写死圆角 / 字号、三区块与
//   关键 aria-label 都还在；
// - 浏览器断言：在 light / dark 两套宿主 token 下渲染打包产物，读回三个
//   区块的卡片样式、五级字号、hover 过渡、select 外观、chip 滚动与主 / 次
//   操作层级。Chrome 不可用时浏览器部分 skip。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { THEME_TOKENS, findChrome, runPageProbe } from "./layout-harness.mjs";
import { VISUAL_EXTRA_TOKENS, buildVisualHtml } from "./visual-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const source = readFileSync(join(root, "src", "client", "index.jsx"), "utf8");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) probes.set(scheme, runPageProbe(chrome, buildVisualHtml(bundle, scheme)));
  return probes.get(scheme);
}

function rgbOf(hex) {
  const value = hex.replace("#", "").slice(0, 6);
  const number = Number.parseInt(value, 16);
  return `rgb(${(number >> 16) & 0xff}, ${(number >> 8) & 0xff}, ${number & 0xff})`;
}

function extra(scheme, name) {
  return rgbOf(VISUAL_EXTRA_TOKENS[scheme][name]);
}

// ── 静态：设计变量与结构 ──────────────────────────────────────────────────

test("设计变量：圆角三档、间距四档、字号六级", () => {
  assert.match(source, /const RADIUS = Object\.freeze\(\{ sm: 6, md: 10, lg: 14 \}\);/);
  assert.match(source, /const GAP = Object\.freeze\(\{ xs: 4, sm: 8, md: 14, lg: 22 \}\);/);
  const fontBlock = source.slice(source.indexOf("const FONT"), source.indexOf("const ROW_HOVER_MS"));
  assert.equal((fontBlock.match(/--dsw-font-/g) ?? []).length, 6, "FONT 六个档位都引用 DSH 字体 token");
  for (const token of ["xxxs-11", "xxs-12", "xs-13", "xxs-strong-12", "s-strong-14", "base-strong-16"]) {
    assert.ok(fontBlock.includes(`--dsw-font-${token}`), `FONT 使用 ${token}`);
  }
});

test("样式对象不再写死圆角：borderRadius 全部引用 RADIUS", () => {
  assert.equal((source.match(/borderRadius:\s*\d/g) ?? []).length, 0, "no numeric borderRadius");
  const refs = source.match(/borderRadius:\s*RADIUS\.(sm|md|lg)/g) ?? [];
  assert.ok(refs.length >= 10, `borderRadius 引用 RADIUS 至少 10 处，实际 ${refs.length}`);
});

test("样式对象不再写死间距：gap 全部引用 GAP", () => {
  assert.equal((source.match(/gap:\s*\d/g) ?? []).length, 0, "no numeric gap");
  const refs = source.match(/gap:\s*GAP\.(xs|sm|md|lg)/g) ?? [];
  assert.ok(refs.length >= 10, `gap 引用 GAP 至少 10 处，实际 ${refs.length}`);
});

test("样式对象不再写死字号：fontSize 全部引用 FONT", () => {
  assert.equal((source.match(/fontSize:\s*\d/g) ?? []).length, 0, "no numeric fontSize");
  const refs = source.match(/fontSize:\s*FONT\.(hint|caption|body|label|section|title)/g) ?? [];
  assert.ok(refs.length >= 20, `fontSize 引用 FONT 至少 20 处，实际 ${refs.length}`);
});

test("所有字号走 DSH 字体 token 的 longhand（-font-size）", () => {
  const refs = source.match(/--dsw-font-[a-z0-9-]+/g) ?? [];
  assert.ok(refs.length >= 6, `--dsw-font- 至少 6 处，实际 ${refs.length}`);
  // --dsw-font-* 本身是 font 简写，直接赋给 font-size 无效；必须用 longhand。
  for (const ref of refs) assert.match(ref, /-font-size$/, `${ref} 应是 longhand token`);
});

test("三个区块使用 settings-card 卡片语言与统一圆角", () => {
  assert.ok(source.includes('aria-label="当前路由"'), "当前路由区块");
  assert.ok(source.includes('aria-label="该路由的模型列表"'), "模型区块");
  assert.ok(source.includes('aria-label="新增模型"'), "新增模型区块");
  assert.ok(source.includes("--dsw-alias-settings-card-fill"), "卡片底色 token");
  assert.ok(source.includes("--dsw-alias-settings-card-stroke"), "卡片边框 token");
  assert.match(source, /const CARD = Object\.freeze\(\{[\s\S]*?borderRadius: RADIUS\.md/);
  assert.match(source, /const CARD = Object\.freeze\(\{[\s\S]*?settings-card-fill/);
});

test("四个原生 select 统一 s.select（appearance:none + 自绘箭头）", () => {
  assert.equal((source.match(/style=\{s\.select\}/g) ?? []).length, 4, "四个 select 都引用同一个 s.select");
  assert.doesNotMatch(source, /<select[^>]*style=\{s\.input\}/, "select 不再复用 input 样式");
  assert.ok(source.includes('appearance: "none"'), "appearance:none");
  assert.match(source, /const SELECT = Object\.freeze\(\{[\s\S]*?linear-gradient/, "自绘箭头");
});

test("模型行有 hover 反馈与 120ms 过渡，编辑按钮内缩在行内", () => {
  assert.ok(source.includes("onMouseEnter={() => setHoveredRow(rowKey)}"), "行 hover 进入");
  assert.ok(source.includes("onMouseLeave={() => setHoveredRow((current) =>"), "行 hover 离开");
  assert.ok(source.includes("--dsw-alias-interactive-bg-hover"), "hover 使用交互底色 token");
  assert.match(source, /transition: `background-color \$\{ROW_HOVER_MS\}ms ease`/);
  assert.ok(source.includes("modelRowMeta"), "摘要与编辑按钮同一行内");
  assert.match(source, /modelRowMeta: \{[\s\S]*?paddingRight: GAP\.xs/, "编辑按钮距行右边界内缩");
});

test("推理档位 chip 不折行：flex-wrap nowrap + 横向滚动", () => {
  assert.match(source, /levelChips: \{[\s\S]*?flexWrap: "nowrap"/);
  assert.match(source, /levelChips: \{[\s\S]*?overflowX: "auto"/);
  const uses = source.match(/style=\{s\.levelChips\}/g) ?? [];
  assert.ok(uses.length >= 4, `新增 / 编辑两个表单的 chip 与操作行都使用同一容器，实际 ${uses.length}`);
  assert.ok(source.includes("s.levelChipOn"), "选中态 chip 样式");
});

test("主操作独占一行右对齐，次要操作为文字链接", () => {
  assert.match(source, /primaryRow: \{[\s\S]*?justifyContent: "flex-end"/);
  assert.match(source, /linkRow: \{[\s\S]*?justifyContent: "flex-end"/);
  assert.match(source, /<button[\s\S]{0,2000}?style=\{s\.btnLink\}[\s\S]{0,2000}?>\s*清空\s*<\/button>/, "清空降级为链接");
  assert.match(source, /<button[\s\S]{0,2000}?style=\{s\.btnLink\}[\s\S]{0,2000}?>\s*存为默认模板\s*<\/button>/, "存为默认模板降级为链接");
  // 「填入默认模板」被既有模板测试钉住 secondary 按钮样式（token + disabled 态），
  // 保持 btnSmall；它不是与主操作同尺寸的按钮。
  assert.ok(/aria-label="填入默认模板"/.test(source));
});

test("既有 aria-label 全部保留", () => {
  const labels = [
    "路由设置", "展开路由设置", "收起路由设置", "该路由的模型列表", "新增模型",
    "删除路由", "保存路由设置", "路由显示名", "路由接口地址", "路由协议",
    "路由密钥引用", "路由默认上下文", "路由默认输出上限", "路由超时", "路由缓存",
    "路由传输", "填入默认模板", "编辑显示名", "编辑上下文窗口", "编辑输出上限",
    "保存修改", "删除模型", "取消编辑", "选择模型", "搜索模型", "确认目录替换",
    "删除模型确认", "删除路由确认", "确认删除", "取消删除", "确认删除路由",
    "取消删除路由", "展开候选",
  ];
  for (const label of labels) assert.ok(source.includes(`"${label}"`), `保留 aria-label: ${label}`);
});

test("主题 token 只通过带 fallback 的 var() 使用，不新增硬编码浅色", () => {
  const refs = source.match(/var\(--dsw-[a-z0-9-]+/g) ?? [];
  const withFallback = source.match(/var\(--dsw-[a-z0-9-]+,\s*/g) ?? [];
  assert.equal(withFallback.length, refs.length, "每个 var(--dsw-*) 都带 fallback");
  assert.doesNotMatch(source, /background:\s*"#[0-9a-fA-F]{3,8}"/, "不硬编码背景色");
  assert.doesNotMatch(source, /color:\s*"#[0-9a-fA-F]{3,8}"/, "不硬编码文字色");
});

// ── 浏览器：真实 DOM 计算样式与布局 ──────────────────────────────────────

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：三个区块是同一套 settings-card 卡片`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实视觉测量");
    const result = await probe(scheme);
    const expected = {
      background: extra(scheme, "--dsw-alias-settings-card-fill"),
      borderColor: extra(scheme, "--dsw-alias-settings-card-stroke"),
      radius: "10px",
    };
    for (const key of ["current", "models", "form"]) {
      assert.deepEqual(result.cards[key], expected, `${key} 卡片使用 settings-card token`);
    }
    // 路由设置卡片嵌在「当前路由」区块内：只保留分隔线与同一底色，不再叠一层卡片。
    assert.equal(
      result.cards.routeSettings.background,
      extra(scheme, "--dsw-alias-settings-card-fill"),
      "路由设置沿用同一卡片底色",
    );
    assert.equal(result.titles.current, "当前路由");
    assert.match(result.titles.models, /该路由的模型（3 条）/);
    assert.equal(result.titles.form, "新增模型");
  });

  test(`${scheme} 主题：所有可见文字对比度 ≥ 4.5（含 label-tertiary 摘要行）`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实视觉测量");
    const result = await probe(scheme);
    assert.ok(
      result.contrast.ratio >= 4.5,
      `对比度 ${result.contrast.ratio} 不达标：${result.contrast.where}`,
    );
    assert.match(result.contrast.where, /窗口 1M/, "最暗的文字是 tertiary 摘要行");
  });

  test(`${scheme} 主题：五级字号逐级递减且互不相同`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实视觉测量");
    const result = await probe(scheme);
    assert.equal(result.fonts.title, "16px", "页面标题");
    assert.equal(result.fonts.section, "14px", "区块标题");
    assert.equal(result.fonts.body, "13px", "正文 / 输入框");
    assert.equal(result.fonts.label, "12px", "字段标签");
    assert.equal(result.fonts.hint, "11px", "提示 / 摘要");
    assert.equal(new Set(Object.values(result.fonts)).size, 5, "五级字号互不相同");
  });

  test(`${scheme} 主题：模型行 hover 底色 + 120ms 过渡，编辑按钮内缩 ≤ 16px`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实视觉测量");
    const result = await probe(scheme);
    assert.equal(result.hover.beforeHover, "rgba(0, 0, 0, 0)", "默认行无底色");
    assert.equal(result.hover.afterHover, extra(scheme, "--dsw-alias-interactive-bg-hover"), "hover 有底色");
    assert.equal(result.hover.afterLeave, "rgba(0, 0, 0, 0)", "移出后恢复");
    assert.equal(result.hover.transitionDuration, "0.12s", "过渡 120ms");
    assert.ok(result.editInset >= 0 && result.editInset <= 16, `编辑按钮距行右边界 ${result.editInset}px`);
  });

  test(`${scheme} 主题：四个 select appearance:none 且高度一致`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实视觉测量");
    const result = await probe(scheme);
    assert.equal(result.selects.length, 4, "路由 / 协议 / 缓存 / 传输");
    for (const select of result.selects) {
      assert.equal(select.appearance, "none");
      assert.equal(select.height, 29, "与输入框同高，既有布局断言保持 29px");
      assert.equal(select.radius, "6px");
      assert.equal(select.arrow, true, "自绘箭头");
    }
  });

  test(`${scheme} 主题：七个档位 chip 单行不折行，窄容器横向滚动`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实视觉测量");
    const result = await probe(scheme);
    assert.equal(result.chips.wrap, "nowrap");
    assert.equal(result.chips.overflowX, "auto");
    assert.equal(result.chips.tops.length, 7, "七个档位");
    assert.equal(new Set(result.chips.tops).size, 1, "七个 chip 同一行");
    assert.equal(result.chips.selectedBackground, extra(scheme, "--dsw-alias-button-ghost-active-fill"));
    assert.equal(result.chips.unselectedBackground, "rgba(0, 0, 0, 0)");
    assert.equal(result.chips.selectedBorder, extra(scheme, "--dsw-alias-button-ghost-active-border"));
    assert.ok(result.chips.narrow.scrollWidth > result.chips.narrow.clientWidth, "窄容器出现横向滚动");
    assert.equal(new Set(result.chips.narrow.tops).size, 1, "横向滚动时仍不折行");
  });

  test(`${scheme} 主题：主操作独占右对齐一行，次要操作是链接`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实视觉测量");
    const result = await probe(scheme);
    assert.equal(result.actions.primaryText, "写入 DSH 设置");
    assert.equal(result.actions.primaryChildren, 1, "主操作独占一行");
    assert.equal(result.actions.primaryJustify, "flex-end", "右对齐");
    for (const key of ["clear", "saveTemplate"]) {
      assert.equal(result.actions[key].background, "rgba(0, 0, 0, 0)", `${key} 不是实心按钮`);
      assert.equal(result.actions[key].decoration, "underline", `${key} 是文字链接`);
    }
  });
}

// 确保两套主题的额外 token 都被测试消费（避免夹具与断言漂移）。
test("视觉夹具覆盖两套主题的卡片 / 交互 / 字体 token", () => {
  for (const scheme of ["light", "dark"]) {
    assert.ok(Object.hasOwn(THEME_TOKENS, scheme));
    for (const name of [
      "--dsw-alias-settings-card-fill",
      "--dsw-alias-settings-card-stroke",
      "--dsw-alias-interactive-bg-hover",
      "--dsw-alias-button-ghost-active-fill",
    ]) {
      assert.ok(VISUAL_EXTRA_TOKENS[scheme][name], `${scheme} ${name}`);
    }
  }
});
