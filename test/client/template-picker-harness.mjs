// 工单 #42 的浏览器夹具：模板选择器 / 管理面板 / 存为新模板对话框。
//
// 与 template-fill-harness 同一思路：把打包后的 Workbench 组件树交给最小 React
// 兼容渲染器渲染成真实 DOM，在 headless Chrome 里做真实点击，读回下拉选项、
// 摘要、表单值、对话框文案与 localStorage 里的库。
//
// 三种场景各用一个页面：
// - empty：空库（只有三份内置预设），从零开始建库 → 增删改查全流程；
// - seeded：新 key 里已有两份模板 + 「最近选用」指向第二份（模拟「重新打开插件」）；
// - legacy：只有旧单模板 key（迁移路径的端到端验证）。

import { THEME_TOKEN_FIXTURE, SHIM_SOURCE } from "./layout-harness.mjs";
import { MODEL_EDIT_ROUTE_SOURCE } from "./model-edit-harness.mjs";

export const TEMPLATE_LIBRARY_STORAGE_KEY = "modelpilot.templates.v1";
export const TEMPLATE_SELECTION_STORAGE_KEY = "modelpilot.templates.selected.v1";
export const LEGACY_TEMPLATE_STORAGE_KEY = "modelpilot.default-template.v1";

/** 两份模板的固定种子（seeded 场景；id 固定，测试才能断言下拉值）。 */
export const SEEDED_LIBRARY = Object.freeze({
  version: 1,
  templates: [
    {
      id: "tpl-seed-128k",
      name: "我的 128K",
      values: {
        version: 1,
        contextWindow: "128000",
        maxTokens: "8192",
        inputText: true,
        inputImage: false,
        reasoningLevels: ["off", "low", "medium", "high"],
      },
    },
    {
      id: "tpl-seed-64k",
      name: "便宜的 64K",
      values: {
        version: 1,
        contextWindow: "64000",
        maxTokens: "4096",
        inputText: true,
        inputImage: false,
        reasoningLevels: ["off", "low"],
      },
    },
  ],
});

/** legacy 场景的旧单模板（工单 #29 的存储格式）。 */
export const LEGACY_TEMPLATE = Object.freeze({
  version: 1,
  contextWindow: "131072",
  maxTokens: "8192",
  inputText: true,
  inputImage: true,
  reasoningLevels: ["off", "low"],
});

export const TEMPLATE_PICKER_PROBE_SOURCE = String.raw`
(async () => {
  try {
  const client = window.__CLIENT__;
  if (!client) throw new Error("client bundle did not register");

  // 注入内存 storage：必须在 Workbench 首次渲染（useState 初始化）前完成。
  const seed = window.__PICKER_SEED__ || {};
  const store = new Map();
  if (seed.legacy) store.set("modelpilot.default-template.v1", JSON.stringify(seed.legacy));
  if (seed.library) store.set("modelpilot.templates.v1", JSON.stringify(seed.library));
  if (seed.selection) store.set("modelpilot.templates.selected.v1", seed.selection);
  // 工单 #31 默认紧凑；本夹具不关心列表密度，固定详细模式。
  store.set("modelpilot.model-list-density.v1", "detailed");
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(String(key), String(value)); },
      removeItem: (key) => { store.delete(key); },
    },
  });

${MODEL_EDIT_ROUTE_SOURCE}
  const providers = { "preview-chat": route };
  const snapshot = {
    status: "ready",
    value: { providers },
    user: { providers },
    revision: 1,
    writable: true,
  };
  const mutations = [];
  const setPath = (root, path, value) => {
    let node = root;
    for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
    node[path[path.length - 1]] = value;
  };
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    mutate: async (ops) => {
      const copy = JSON.parse(JSON.stringify(ops));
      mutations.push(copy);
      for (const op of copy) {
        if (op.op === "set") setPath(snapshot.value, op.path, op.value);
      }
      return true;
    },
  };
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

  const byAria = (label) => document.querySelector('[aria-label="' + label + '"]');
  const createCard = () => document.querySelector('section[aria-label="新增模型"]');
  const editor = () => document.querySelector('[aria-label^="编辑表单"]');
  const pickerOf = (label) => document.querySelector('[aria-label="' + label + '"]');
  const createPicker = () => pickerOf("新增模型模板");
  const editPicker = () => pickerOf("编辑模型模板");
  const dialog = () => document.querySelector('[role="dialog"][aria-label="存为新模板"]');
  const manage = () => document.querySelector('[role="dialog"][aria-label="模板管理"]');
  const toast = () => document.querySelector("[data-modelpilot-toast]")?.textContent.trim() ?? "";
  const buttonIn = (root, label) => root === null ? null : root.querySelector('[aria-label="' + label + '"]');
  const click = (element) => {
    if (element === null || element === undefined) throw new Error("click target missing");
    element.click();
  };
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const setSelect = (select, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  };
  // 工单 #41：选中态 chip 文字前多了一个固定宽度的 ✓ 槽；比较标签时剥掉。
  const plainText = (element) => element.textContent.replace(/[\s\u00a0✓]/g, "");
  const checkboxIn = (root, text) =>
    [...(root?.querySelectorAll("label") ?? [])]
      .find((label) => plainText(label) === text && label.querySelector('input[type="checkbox"]') !== null)
      ?.querySelector('input[type="checkbox"]') ?? null;
  const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const createState = () => {
    const root = createCard();
    return {
      contextWindow: byAria("上下文窗口").value,
      maxTokens: byAria("输出上限").value,
      text: checkboxIn(root, "text")?.checked ?? null,
      image: checkboxIn(root, "image")?.checked ?? null,
      levels: LEVELS.filter((level) => checkboxIn(root, level)?.checked),
    };
  };
  const optionsOf = (picker) => picker === null
    ? []
    : [...picker.querySelectorAll("option")].map((option) => ({
      value: option.value,
      text: option.textContent.trim(),
      kind: option.getAttribute("data-template-kind"),
      disabled: option.disabled,
    }));
  const userOptions = (picker) => optionsOf(picker).filter((option) => option.kind === "user");
  const builtinOptions = (picker) => optionsOf(picker).filter((option) => option.kind === "builtin");
  const summaryOf = (picker) => {
    if (picker === null) return "";
    const node = [...picker.querySelectorAll("span")].find(
      (element) => element.textContent.startsWith("模板：") || element.textContent.startsWith("内置模板："),
    );
    return node === undefined ? "" : node.textContent.trim();
  };
  const selectValueOf = (picker) => picker === null ? "" : picker.querySelector("select").value;
  const libraryRaw = () => {
    const raw = store.get("modelpilot.templates.v1");
    return raw === undefined ? null : JSON.parse(raw);
  };
  const libraryCount = () => {
    const raw = libraryRaw();
    return raw === null ? 0 : raw.templates.length;
  };
  const libraryTemplate = (name) => {
    const raw = libraryRaw();
    return raw === null ? null : raw.templates.find((template) => template.name === name) ?? null;
  };
  const selectionStored = () => store.get("modelpilot.templates.selected.v1") ?? null;

  /** 打开「存为新模板」对话框、填名字、点保存。名字非法时对话框保持打开。 */
  const saveAsNew = (name) => {
    click(buttonIn(createPicker(), "存为新模板"));
    setValue(dialog().querySelector('[aria-label="模板名称"]'), name);
    click(dialog().querySelector('[aria-label="保存模板"]'));
  };

  const result = { scheme: getComputedStyle(document.documentElement).colorScheme };
  result.initial = {
    options: optionsOf(createPicker()),
    builtinOptions: builtinOptions(createPicker()),
    userOptions: userOptions(createPicker()),
    selectValue: selectValueOf(createPicker()),
    summary: summaryOf(createPicker()),
    createState: createState(),
    libraryCount: libraryCount(),
    selectionStored: selectionStored(),
  };

  if (seed.library) {
    // seeded 场景：只需读初始状态（「重新打开插件时停在上次选用的那一份」）。
    result.edit = editor() === null ? null : {
      userOptions: userOptions(editPicker()),
      selectValue: selectValueOf(editPicker()),
      summary: summaryOf(editPicker()),
    };
    document.getElementById("result").textContent = JSON.stringify(result);
    return;
  }

  if (seed.legacy) {
    // legacy 场景：旧 key 迁移成一份「我的模板」，旧 key 保留。
    result.legacy = {
      libraryCount: libraryCount(),
      libraryNames: (libraryRaw()?.templates ?? []).map((template) => template.name),
      legacyStillStored: store.has("modelpilot.default-template.v1"),
      selectValue: selectValueOf(createPicker()),
      summary: summaryOf(createPicker()),
      userOptions: userOptions(createPicker()),
      createState: createState(),
    };
    document.getElementById("result").textContent = JSON.stringify(result);
    return;
  }

  // ── 1. 存第一份「我的 128K」（当前表单值） ──
  setValue(byAria("上下文窗口"), "128000");
  setValue(byAria("输出上限"), "8192");
  click(buttonIn(createPicker(), "存为新模板"));
  result.dialogOpened = dialog() !== null;
  setValue(dialog().querySelector('[aria-label="模板名称"]'), "我的 128K");
  click(dialog().querySelector('[aria-label="保存模板"]'));
  result.afterFirstSave = {
    dialogOpen: dialog() !== null,
    selectValue: selectValueOf(createPicker()),
    summary: summaryOf(createPicker()),
    userOptions: userOptions(createPicker()),
    libraryCount: libraryCount(),
    library: libraryRaw(),
    selectionStored: selectionStored(),
    toast: toast(),
  };

  // ── 1b. 选中刚存的「我的 128K」点「填入」：表单变 128000 / 8192 / text，mutations 0 ──
  setValue(byAria("上下文窗口"), "11111");
  setValue(byAria("输出上限"), "2222");
  const mutationsBeforeFirstFill = mutations.length;
  setSelect(createPicker().querySelector("select"), userOptions(createPicker())[0].value);
  click(buttonIn(createPicker(), "填入模板"));
  result.firstFill = {
    state: createState(),
    mutations: mutations.length - mutationsBeforeFirstFill,
    summary: summaryOf(createPicker()),
  };

  // ── 2. 编辑模型表单共用同一份库：打开编辑表单就能看到刚存的那份 ──
  click(byAria("编辑模型 jxf/dsv4.1-flash"));
  result.edit = {
    userOptions: userOptions(editPicker()),
    selectValue: selectValueOf(editPicker()),
    summary: summaryOf(editPicker()),
  };
  click(byAria("取消编辑"));
  result.editClosed = editor() === null;

  // ── 3. 存第二份「便宜的 64K」：下拉顺序与新增顺序一致 ──
  setValue(byAria("上下文窗口"), "64000");
  setValue(byAria("输出上限"), "4096");
  saveAsNew("便宜的 64K");
  result.afterSecondSave = {
    userOptions: userOptions(createPicker()),
    shelfOrder: userOptions(createPicker()).map((option) => option.text),
    selectValue: selectValueOf(createPicker()),
    summary: summaryOf(createPicker()),
    libraryCount: libraryCount(),
    toast: toast(),
  };

  // ── 4. 重名：就地报错、对话框不关、库不变 ──
  click(buttonIn(createPicker(), "存为新模板"));
  setValue(dialog().querySelector('[aria-label="模板名称"]'), "我的 128k");
  click(dialog().querySelector('[aria-label="保存模板"]'));
  result.duplicateName = {
    dialogOpen: dialog() !== null,
    error: dialog()?.querySelector('[role="alert"]')?.textContent.trim() ?? "",
    libraryCount: libraryCount(),
    userOptions: userOptions(createPicker()).map((option) => option.text),
  };

  // ── 5. 超长名字：就地报错、库不变 ──
  setValue(dialog().querySelector('[aria-label="模板名称"]'), "字".repeat(21));
  click(dialog().querySelector('[aria-label="保存模板"]'));
  result.tooLongName = {
    dialogOpen: dialog() !== null,
    error: dialog()?.querySelector('[role="alert"]')?.textContent.trim() ?? "",
    libraryCount: libraryCount(),
  };
  click(dialog().querySelector('[aria-label="取消保存模板"]'));
  result.dialogClosedByCancel = dialog() === null;

  // ── 6. 选中第二份 → 摘要跟随；点「填入」只改表单（mutations 保持 0） ──
  const secondValue = userOptions(createPicker())[1].value;
  setSelect(createPicker().querySelector("select"), secondValue);
  setValue(byAria("上下文窗口"), "55555");
  setValue(byAria("输出上限"), "4444");
  const mutationsBeforeFill = mutations.length;
  const beforeSelectValue = selectValueOf(createPicker());
  const summaryAfterSelect = summaryOf(createPicker());
  click(buttonIn(createPicker(), "填入模板"));
  result.fill = {
    selectedValue: beforeSelectValue,
    summaryAfterSelect,
    state: createState(),
    mutations: mutations.length - mutationsBeforeFill,
    summary: summaryOf(createPicker()),
    selectionStored: selectionStored(),
  };

  // ── 7. 改名：选中第一份后就地输入 + Enter；下拉、摘要一起更新，id 不变 ──
  setSelect(createPicker().querySelector("select"), userOptions(createPicker())[0].value);
  result.beforeRename = {
    selectValue: selectValueOf(createPicker()),
    summary: summaryOf(createPicker()),
  };
  click(buttonIn(createPicker(), "管理模板"));
  result.manageOpened = manage() !== null;
  const idBeforeRename = selectValueOf(createPicker());
  click(buttonIn(manage(), "改名 我的 128K"));
  const renameInput = manage()?.querySelector('[aria-label="重命名模板输入"]');
  result.renaming = {
    value: renameInput === null || renameInput === undefined ? null : renameInput.value,
  };
  setValue(renameInput, "128K 对话");
  manage().querySelector('[aria-label="重命名模板输入"]').dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  result.afterRename = {
    userOptions: userOptions(createPicker()).map((option) => option.text),
    selectValue: selectValueOf(createPicker()),
    idUnchanged: selectValueOf(createPicker()) === idBeforeRename,
    summary: summaryOf(createPicker()),
    manageSummary: manage()?.textContent.includes("128K 对话") ?? false,
  };

  // ── 8. 改名报错：重名 → 就地报错、输入框不关、库不变 ──
  click(buttonIn(manage(), "改名 128K 对话"));
  setValue(manage().querySelector('[aria-label="重命名模板输入"]'), "便宜的 64k");
  manage().querySelector('[aria-label="重命名模板输入"]').dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  result.renameError = {
    error: manage()?.querySelector('[role="alert"]')?.textContent.trim() ?? "",
    inputStillOpen: manage()?.querySelector('[aria-label="重命名模板输入"]') !== null,
    userOptions: userOptions(createPicker()).map((option) => option.text),
  };
  click(buttonIn(manage(), "取消改名"));
  click(buttonIn(manage(), "关闭模板管理"));
  result.manageClosed = manage() === null;

  // ── 9. 用当前值覆盖：先改表单为 96000，再在管理面板确认 ──
  setSelect(createPicker().querySelector("select"), userOptions(createPicker())[0].value);
  setValue(byAria("上下文窗口"), "96000");
  click(buttonIn(createPicker(), "管理模板"));
  click(buttonIn(manage(), "用当前值覆盖 128K 对话"));
  result.overwriteConfirm = {
    hint: manage()?.textContent.includes("用当前表单值覆盖这一份参数？") ?? false,
  };
  click(buttonIn(manage(), "确认覆盖"));
  result.afterOverwrite = {
    library: libraryRaw(),
    values: libraryTemplate("128K 对话")?.values ?? null,
    name: libraryTemplate("128K 对话")?.name ?? null,
    summary: summaryOf(createPicker()),
    selectValue: selectValueOf(createPicker()),
  };

  // ── 10. 删除当前选中的「便宜的 64K」：回落到第一份用户模板，摘要同步更新 ──
  setSelect(createPicker().querySelector("select"), userOptions(createPicker())[1].value);
  result.beforeDelete = { summary: summaryOf(createPicker()) };
  click(buttonIn(manage(), "删除模板 便宜的 64K"));
  result.deleteConfirm = {
    hint: manage()?.textContent.includes("删除后这一份参数不可恢复") ?? false,
  };
  click(buttonIn(manage(), "确认删除模板"));
  result.afterDeleteSelected = {
    userOptions: userOptions(createPicker()).map((option) => option.text),
    selectValue: selectValueOf(createPicker()),
    summary: summaryOf(createPicker()),
    libraryCount: libraryCount(),
    selectionStored: selectionStored(),
  };

  // ── 11. 删到空库：只剩内置预设 + 空库提示文案 ──
  click(buttonIn(manage(), "删除模板 128K 对话"));
  click(buttonIn(manage(), "确认删除模板"));
  result.afterDeleteAll = {
    userOptions: userOptions(createPicker()),
    builtinOptions: builtinOptions(createPicker()).map((option) => option.text),
    selectValue: selectValueOf(createPicker()),
    summary: summaryOf(createPicker()),
    libraryCount: libraryCount(),
    emptyText: manage()?.textContent.includes("还没有自定义模板。改好参数后点「存为新模板」保存一份。") ?? false,
    createState: createState(),
  };
  click(buttonIn(manage(), "关闭模板管理"));

  // ── 12. 内置预设只读：管理面板里没有内置项，下拉里可选可填 ──
  click(buttonIn(createPicker(), "管理模板"));
  result.builtinReadOnly = {
    manageRows: manage()?.querySelectorAll('[aria-label^="模板 "]').length ?? -1,
    manageEmptyText: manage()?.textContent.includes("还没有自定义模板") ?? false,
  };
  click(buttonIn(manage(), "关闭模板管理"));
  setSelect(createPicker().querySelector("select"), "builtin:coding");
  result.builtinSelect = {
    selectValue: selectValueOf(createPicker()),
    summary: summaryOf(createPicker()),
  };
  click(buttonIn(createPicker(), "填入模板"));
  result.builtinFill = { state: createState(), mutations: mutations.length };

  document.getElementById("result").textContent = JSON.stringify(result);
  } catch (error) {
    document.getElementById("result").textContent = JSON.stringify({ __error: String(error), stack: error.stack });
  }
})();
`;

/** 以指定种子组装模板选择器页面（seed 为 null 表示空库）。 */
export function buildTemplatePickerHtml(bundleSource, seed) {
  const payload = seed === null ? "null" : JSON.stringify(seed);
  return [
    "<!doctype html>",
    '<html lang="en" data-scheme="light" style="color-scheme: light">',
    '<head><meta charset="utf-8" />',
    `<style>body { margin: 0; padding: 20px; font-family: system-ui, sans-serif; font-size: 14px; }\n${THEME_TOKEN_FIXTURE}\n#root { max-width: 980px; margin: 0 auto; }\n#result { white-space: pre-wrap; }</style>`,
    "</head><body>",
    '<div id="root"></div>',
    '<pre id="result">pending</pre>',
    `<script>${SHIM_SOURCE}</script>`,
    `<script>${bundleSource}</script>`,
    `<script>window.__PICKER_SEED__ = ${payload};</script>`,
    `<script>${TEMPLATE_PICKER_PROBE_SOURCE}</script>`,
    "</body></html>",
  ].join("\n");
}
