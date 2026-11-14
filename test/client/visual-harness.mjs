// 工单 #17 的视觉回归夹具。
//
// 与 model-edit-harness 相同的思路：把打包后的 Workbench 交给最小 React
// 兼容渲染器渲染成真实 DOM，在 headless Chrome 里读回计算样式与布局。
// 额外提供 settings-card / ghost-active / 字体 token，用来验证这些设计变量
// 真的被样式对象消费，而不是只出现在源码里。
//
// 断言在 visual-redesign.test.mjs 里；Chrome 不可用时测试 skip。

import { SHIM_SOURCE, THEME_TOKENS, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";
import { MODEL_EDIT_ROUTE_SOURCE } from "./model-edit-harness.mjs";

/** 宿主内置页使用的卡片 / 交互 / 字体 token（测试里给确定值）。 */
export const VISUAL_EXTRA_TOKENS = Object.freeze({
  light: Object.freeze({
    "--dsw-alias-settings-card-fill": "#eef1f6",
    "--dsw-alias-settings-card-stroke": "#d4d9e2",
    "--dsw-alias-label-secondary": "#4b5058",
    "--dsw-alias-label-tertiary": "#5f646c",
    "--dsw-alias-interactive-bg-hover": "#e6ecf8",
    "--dsw-alias-button-ghost-active-fill": "#dde6f7",
    "--dsw-alias-button-ghost-active-border": "#3b6fd4",
    "--dsw-font-xxxs-11-font-size": "11px",
    "--dsw-font-xxs-12-font-size": "12px",
    "--dsw-font-xs-13-font-size": "13px",
    "--dsw-font-xxs-strong-12-font-size": "12px",
    "--dsw-font-s-strong-14-font-size": "14px",
    "--dsw-font-base-strong-16-font-size": "16px",
  }),
  dark: Object.freeze({
    "--dsw-alias-settings-card-fill": "#24262b",
    "--dsw-alias-settings-card-stroke": "#3a3d44",
    "--dsw-alias-label-secondary": "#c3c6cc",
    "--dsw-alias-label-tertiary": "#b9bcc4",
    "--dsw-alias-interactive-bg-hover": "#2c2f36",
    "--dsw-alias-button-ghost-active-fill": "#323b4d",
    "--dsw-alias-button-ghost-active-border": "#7aa4ee",
    "--dsw-font-xxxs-11-font-size": "11px",
    "--dsw-font-xxs-12-font-size": "12px",
    "--dsw-font-xs-13-font-size": "13px",
    "--dsw-font-xxs-strong-12-font-size": "12px",
    "--dsw-font-s-strong-14-font-size": "14px",
    "--dsw-font-base-strong-16-font-size": "16px",
  }),
});

function extraRule(scheme) {
  return `  :root[data-scheme="${scheme}"] {\n${Object.entries(VISUAL_EXTRA_TOKENS[scheme])
    .map(([name, value]) => `    ${name}: ${value};`)
    .join("\n")}\n  }`;
}

/** 基础 token 在前、额外 token 在后：同名 token 以额外值为准。 */
export const VISUAL_TOKEN_FIXTURE = [
  THEME_TOKEN_FIXTURE,
  extraRule("light"),
  extraRule("dark"),
].join("\n");

export const VISUAL_PROBE_SOURCE = String.raw`
(async () => {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

${MODEL_EDIT_ROUTE_SOURCE}
  const providers = { "preview-chat": route };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };
  const scope = { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: async () => true };
  const configForms = { get: () => scope };
  let Workbench;
  let spec;
  const ctx = {
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    configForms: { get: () => scope, whileServed: (namespaces, register) => register(new Set(namespaces)) },
    slots: {
      inject: (name, register) => register(),
      register: (registeredSpec, component) => {
        spec = registeredSpec;
        Workbench = component;
        return () => {};
      },
    },
    remote: {
      llm: { discoverModels: async () => ({ ok: true, value: [] }) },
      // 工单 #18：密钥区块注入的宿主管道。夹具默认所有引用都已配置且可写；
      // 具体状态机由 test/client/api-key-harness.mjs 单独覆盖。
      credentials: {
        describe: async (refs) => ({ ok: true, value: Object.fromEntries(refs.map((ref) => [ref, { configured: true, writable: true }])) }),
        set: async () => ({ ok: true, value: undefined }),
        unset: async () => ({ ok: true, value: undefined }),
      },
    },
  };
  client.apply(ctx);
  if (typeof Workbench !== "function") throw new Error("workbench component not registered");
  window.__renderComponent(Workbench, spec.inject());

  const styleOf = (element) => getComputedStyle(element);
  const rect = (element) => element.getBoundingClientRect();
  const card = (label) => document.querySelector('section[aria-label="' + label + '"]');
  const buttons = () => [...document.querySelectorAll("button")];
  const buttonByText = (text) => buttons().find((element) => element.textContent.trim() === text);
  const row = (id) => document.querySelector('[aria-label="模型 ' + id + '"]');

  const currentCard = card("当前路由");
  const modelsCard = card("该路由的模型列表");
  const formCard = card("新增模型");
  const routeCard = card("路由设置");

  const cardInfo = (element) => ({
    background: styleOf(element).backgroundColor,
    borderColor: styleOf(element).borderTopColor,
    radius: styleOf(element).borderTopLeftRadius,
  });

  const result = { scheme: styleOf(document.documentElement).colorScheme };
  result.cards = {
    current: cardInfo(currentCard),
    models: cardInfo(modelsCard),
    form: cardInfo(formCard),
    routeSettings: cardInfo(routeCard),
  };
  result.titles = {
    current: currentCard.firstElementChild.textContent.trim(),
    models: modelsCard.firstElementChild.textContent.trim(),
    form: formCard.firstElementChild.textContent.trim(),
  };

  // ── 五级字号：页面标题 / 区块标题 / 字段标签 / 正文 / 提示 ──
  const summary = [...row("jxf/dsv4.1-flash").querySelectorAll("span")]
    .find((element) => element.textContent.includes("窗口 1M"));
  result.fonts = {
    title: styleOf(document.querySelector("h2")).fontSize,
    section: styleOf(currentCard.firstElementChild).fontSize,
    label: styleOf(currentCard.querySelector("label > span")).fontSize,
    body: styleOf(currentCard.querySelector("input")).fontSize,
    hint: styleOf(summary).fontSize,
  };

  // ── 模型行 hover：底色变化 + 120ms 过渡 + 编辑按钮内缩 ──
  const firstRow = row("jxf/dsv4.1-flash");
  const beforeHover = styleOf(firstRow).backgroundColor;
  const editInset = rect(firstRow).right - rect(firstRow.querySelector('[aria-label^="编辑模型"]')).right;
  const transitionDuration = styleOf(firstRow).transitionDuration;
  firstRow.dispatchEvent(new MouseEvent("mouseenter"));
  const hovered = row("jxf/dsv4.1-flash");
  const afterHover = styleOf(hovered).backgroundColor;
  hovered.dispatchEvent(new MouseEvent("mouseleave"));
  const afterLeave = styleOf(row("jxf/dsv4.1-flash")).backgroundColor;
  result.hover = { beforeHover, afterHover, afterLeave, transitionDuration };
  result.editInset = editInset;

  // ── 四个原生 select：appearance:none、同高、同箭头 ──
  document.querySelector('[aria-label="展开路由设置"]').click();
  const selects = [...document.querySelectorAll("select")];
  result.selects = selects.map((element) => ({
    appearance: styleOf(element).appearance,
    height: Number(rect(element).height.toFixed(2)),
    radius: styleOf(element).borderTopLeftRadius,
    arrow: styleOf(element).backgroundImage.includes("linear-gradient"),
  }));

  // ── 推理档位 chip：不折行、窄容器横向滚动、选中 / 未选中底色 ──
  const levelLabels = [...document.querySelectorAll("label")]
    .filter((element) => element.querySelector('input[type="checkbox"]'));
  const offLabel = levelLabels.find((element) => element.textContent.trim() === "off");
  const minimalLabel = levelLabels.find((element) => element.textContent.trim() === "minimal");
  const chipContainer = offLabel.parentElement;
  const chipTops = () => [...chipContainer.children].map((element) => Math.round(rect(element).top));
  result.chips = {
    wrap: styleOf(chipContainer).flexWrap,
    overflowX: styleOf(chipContainer).overflowX,
    tops: chipTops(),
    selectedBackground: styleOf(offLabel).backgroundColor,
    unselectedBackground: styleOf(minimalLabel).backgroundColor,
    selectedBorder: styleOf(offLabel).borderTopColor,
  };
  chipContainer.style.flex = "0 0 150px";
  chipContainer.style.width = "150px";
  result.chips.narrow = {
    scrollWidth: chipContainer.scrollWidth,
    clientWidth: chipContainer.clientWidth,
    tops: chipTops(),
  };

  // ── 主操作独占一行右对齐；次要操作是文字链接 ──
  const write = buttonByText("写入 DSH 设置");
  const primaryRow = write.parentElement;
  const linkOf = (text) => {
    const element = buttonByText(text);
    return {
      background: styleOf(element).backgroundColor,
      decoration: styleOf(element).textDecorationLine,
    };
  };
  result.actions = {
    primaryChildren: primaryRow.children.length,
    primaryJustify: styleOf(primaryRow).justifyContent,
    primaryText: write.textContent.trim(),
    clear: linkOf("清空"),
    saveTemplate: linkOf("存为默认模板"),
    fillTemplate: linkOf("填入默认模板"),
  };

  // ── 所有可见文字的对比度（含 label-tertiary 摘要行）──
  const parseColor = (text) => {
    const match = String(text).match(/rgba?\(([^)]+)\)/);
    if (!match) return { r: 0, g: 0, b: 0, a: 0 };
    const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const v = value / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (foreground, background) => {
    const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return Number(((high + 0.05) / (low + 0.05)).toFixed(2));
  };
  const effectiveBackground = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const color = parseColor(styleOf(node).backgroundColor);
      if (color.a > 0) layers.push(color);
      if (color.a === 1) break;
    }
    let background = { r: 255, g: 255, b: 255, a: 1 };
    for (let index = layers.length - 1; index >= 0; index--) background = over(layers[index], background);
    return background;
  };
  let worst = { ratio: Infinity, where: "" };
  for (const element of document.querySelectorAll("span, div, label, button, p, option")) {
    const text = (element.textContent || "").trim();
    if (text === "") continue;
    if (element.closest("button[disabled]")) continue;
    const ratio = contrast(parseColor(styleOf(element).color), effectiveBackground(element));
    if (ratio < worst.ratio) worst = { ratio, where: element.tagName + ":" + text.slice(0, 24) };
  }
  result.contrast = worst;

  document.getElementById("result").textContent = JSON.stringify(result);
})();
`;

export function buildVisualHtml(bundleSource, scheme) {
  if (!Object.hasOwn(THEME_TOKENS, scheme)) throw new TypeError(`未知主题：${scheme}`);
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    "<style>body { margin: 0; font-family: system-ui, sans-serif; font-size: 14px; }",
    VISUAL_TOKEN_FIXTURE,
    "</style>",
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${VISUAL_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
