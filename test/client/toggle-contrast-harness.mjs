// 工单 #41：选中态「多重冗余编码」的浏览器夹具。
//
// 在一个真实 DOM 里把 10 处「选中 / 未选中」控件都渲染出来，读回 computed
// background / borderWidth / fontWeight / 勾选标记 / 尺寸。断言在
// test/client/toggle-contrast.test.mjs；这里只负责场景与测量。
//
// 夹具刻意不依赖 aria-label 之外的新标记：基线 bd3dc98 上也能跑，好让新
// 测试先红、再改样式变绿。

import { SHIM_SOURCE, THEME_TOKEN_FIXTURE } from "./layout-harness.mjs";

const FIXTURE_SOURCE = String.raw`
(async () => {
  try {
    const client = window.__CLIENT__;
    if (!client) throw new Error("client bundle did not register");

    const previewChat = {
      id: "preview-chat",
      displayName: "Preview Chat",
      baseURL: "https://preview.invalid/v1",
      api: "openai-completions",
      apiKeyEnv: "PREVIEW_CHAT_API_KEY",
      defaultInput: ["image"],
      models: [
        {
          id: "jxf/edit-me",
          name: "jxf/edit-me",
          contextWindow: 128000,
          maxTokens: 8192,
          input: ["text"],
          reasoningEfforts: { off: null, low: "low", medium: "medium" },
        },
        { id: "jxf/second", name: "jxf/second", contextWindow: 128000, maxTokens: 8192, input: ["text"] },
        { id: "tx/third", name: "tx/third", contextWindow: 64000, maxTokens: 4096, input: ["image"] },
      ],
    };
    const providers = { "preview-chat": previewChat };
    const snapshot = {
      status: "ready",
      value: { providers },
      user: { providers },
      revision: 1,
      writable: true,
    };
    const scope = { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: async () => true };

    // 宿主 schema 同形：defaultInput 是 union 数组，驱动路由卡片的候选 chip。
    const schemaOps = {
      rehydrate: (serialized) => serialized,
      nodeAtPath: (root, path) => {
        if (path.length === 3 && path[0] === "providers") return root?.[path[2]];
        if (path.length === 1 && path[0] === "0" && root?.type === "array") return root.inner;
        return undefined;
      },
    };
    const schemaRoot = {
      api: { type: "union", list: [{ value: "openai-completions" }, { value: "anthropic-messages" }] },
      defaultInput: {
        type: "array",
        inner: { type: "union", list: [{ value: "text" }, { value: "image" }] },
      },
    };
    const describe = () => ({
      getSnapshot: () => ({ view: { namespaces: [{ ns: "llm-pi-ai", schema: schemaRoot }] } }),
    });
    const configForms = {
      get: () => scope,
      whileServed: (namespaces, register) => register(new Set(namespaces)),
      describe,
      schema: schemaOps,
    };

    let Workbench;
    let spec;
    const ctx = {
      effect: (fn) => {
        const dispose = fn();
        return typeof dispose === "function" ? dispose : () => {};
      },
      configForms,
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
        credentials: {
          describe: async (refs) => ({
            ok: true,
            value: Object.fromEntries(refs.map((ref) => [ref, { configured: true, writable: true }])),
          }),
          set: async () => ({ ok: true, value: undefined }),
          unset: async () => ({ ok: true, value: undefined }),
        },
      },
    };
    client.apply(ctx);
    if (typeof Workbench !== "function") throw new Error("workbench component not registered");
    window.__renderComponent(Workbench, spec.inject());

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const styleOf = (element) => getComputedStyle(element);
    const byAria = (label) => document.querySelector('[aria-label="' + label + '"]');
    const labelOf = (label) => byAria(label).closest("label");
    const buttonByAria = (label) => [...document.querySelectorAll("button")]
      .find((element) => element.getAttribute("aria-label") === label);
    const createSection = () => document.querySelector('section[aria-label="新增模型"]');
    const stripMark = (text) => String(text).replace(/[\s\u00a0✓]/g, "");

    /** 新增表单里的复选 chip：按去掉勾选标记后的文字定位。 */
    const createChipLabel = (word) => [...createSection().querySelectorAll("label")]
      .find((label) => {
        const input = label.querySelector('input[type="checkbox"]');
        return input !== null && stripMark(label.textContent) === word;
      });

    const parseCssColor = (text) => {
      const value = String(text).trim();
      const match = value.match(/^rgba?\(([^)]+)\)$/);
      if (match === null) {
        if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
        throw new Error("无法解析颜色：" + value);
      }
      const parts = match[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    };
    const over = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: top.a + bottom.a * (1 - top.a),
    });
    /** 从控件自身沿父链合成实际填充色（含半透明层）。 */
    const effectiveBackground = (element) => {
      const layers = [];
      for (let node = element; node; node = node.parentElement) {
        const color = parseCssColor(styleOf(node).backgroundColor);
        if (color.a > 0) layers.push(color);
        if (color.a === 1) break;
      }
      let background = { r: 255, g: 255, b: 255, a: 1 };
      for (let index = layers.length - 1; index >= 0; index--) background = over(layers[index], background);
      return { r: background.r, g: background.g, b: background.b, a: 1 };
    };

    const info = (element) => {
      if (!element) throw new Error("控件未找到");
      const style = styleOf(element);
      return {
        fill: effectiveBackground(element),
        backgroundCss: style.backgroundColor,
        borderWidth: Number.parseFloat(style.borderTopWidth) || 0,
        borderStyle: style.borderTopStyle,
        borderColor: style.borderTopColor,
        opacity: Number(style.opacity),
        cursor: style.cursor,
        fontWeight: Number(style.fontWeight),
        color: style.color,
        text: String(element.textContent).replace(/\s+/g, " ").trim(),
        mark: String(element.textContent).includes("✓"),
        width: element.offsetWidth,
        height: element.offsetHeight,
      };
    };
    const pair = (selectedElement, unselectedElement) => ({
      selected: info(selectedElement),
      unselected: info(unselectedElement),
    });

    const result = { scheme: document.documentElement.dataset.scheme, scenes: {} };

    // 1. 列表视图开关：默认分组（选中）+ 平铺（未选中）。
    result.scenes["view-toggle"] = pair(byAria("分组视图"), byAria("平铺视图"));

    // 2. 列表密度开关：默认紧凑（选中）+ 详细（未选中）。
    result.scenes["density-toggle"] = pair(byAria("紧凑视图"), byAria("详细视图"));

    // 3. 新增模型 · 预设：点「基础对话」后它选中，其余未选中。
    byAria("预设 基础对话").click();
    await sleep(10);
    result.scenes["preset-chips"] = pair(byAria("预设 基础对话"), byAria("预设 代码"));

    // 4 / 5. 新增模型 · 输入模态与推理档位（默认 text 选中、image 未选中；
    //            默认 off/low/medium/high 选中、max 未选中）。
    result.scenes["create-modality"] = pair(createChipLabel("text"), createChipLabel("image"));
    result.scenes["create-levels"] = pair(createChipLabel("off"), createChipLabel("max"));

    // 6. 路由设置 · 默认输入模态：夹具预填 image（选中）、text（未选中）。
    byAria("展开路由设置").click();
    await sleep(10);
    result.scenes["route-default-input"] = pair(labelOf("路由输入模态 image"), labelOf("路由输入模态 text"));

    // 7 / 8. 编辑模型 · 输入模态与推理档位：模型声明 input:["text"] 与
    //        off/low/medium，因此 text / off 选中，image / max 未选中。
    byAria("编辑模型 jxf/edit-me").click();
    await sleep(10);
    result.scenes["edit-modality"] = pair(labelOf("编辑输入模态 text"), labelOf("编辑输入模态 image"));
    result.scenes["edit-levels"] = pair(labelOf("编辑档位 off"), labelOf("编辑档位 max"));

    // 9 / 10 + 停用态：勾选一条模型 → 打开批量改字段。默认两个「启用」复选
    // 框都没勾，chip 处于停用态；勾上后再读选中 / 未选中。
    byAria("选择模型 jxf/edit-me").click();
    await sleep(10);
    byAria("批量改字段").click();
    await sleep(10);
    result.bulkDisabled = {
      modality: info(byAria("批量输入模态 image")),
      level: info(byAria("批量推理档位 max")),
    };
    byAria("批量设置输入模态").click();
    await sleep(10);
    result.scenes["bulk-modality"] = pair(byAria("批量输入模态 text"), byAria("批量输入模态 image"));
    byAria("批量设置推理档位").click();
    await sleep(10);
    result.scenes["bulk-levels"] = pair(byAria("批量推理档位 off"), byAria("批量推理档位 max"));

    // 额外：同一控件连续切换两次，尺寸不变（2px 选中边框不能引起布局抖动）。
    const measureRouteChip = () => info(labelOf("路由输入模态 text"));
    const before = measureRouteChip();
    byAria("路由输入模态 text").click();
    await sleep(10);
    const selected = measureRouteChip();
    byAria("路由输入模态 text").click();
    await sleep(10);
    const after = measureRouteChip();
    result.routeChipJitter = {
      before: { width: before.width, height: before.height },
      selected: { width: selected.width, height: selected.height },
      after: { width: after.width, height: after.height },
    };

    const measureDetailed = () => info(byAria("详细视图"));
    const detailedOff = measureDetailed();
    byAria("详细视图").click();
    await sleep(10);
    const detailedOn = measureDetailed();
    byAria("紧凑视图").click();
    await sleep(10);
    const detailedOffAgain = measureDetailed();
    result.segmentedJitter = {
      off: { width: detailedOff.width, height: detailedOff.height },
      on: { width: detailedOn.width, height: detailedOn.height },
      offAgain: { width: detailedOffAgain.width, height: detailedOffAgain.height },
    };

    document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 指定主题下渲染全部 10 处选中态场景的页面。 */
export function buildToggleContrastHtml(bundleSource, scheme) {
  if (scheme !== "light" && scheme !== "dark") throw new TypeError(`未知主题：${scheme}`);
  return [
    "<!doctype html>",
    `<html lang="en" data-scheme="${scheme}" style="color-scheme: ${scheme}">`,
    '<head><meta charset="utf-8" />',
    `<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}\n#root { max-width: 1100px; margin: 0 auto; }\n#result { white-space: pre-wrap; }</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>${FIXTURE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
