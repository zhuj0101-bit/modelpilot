// 工单 #42：模板选择器（真实 DOM / headless Chrome）。
//
// 与 template-fill.test.mjs 同一路径：headless Chrome 渲染打包后的 lib/client.js，
// 由最小 React 渲染器渲染真实 Workbench，做真实点击并读回下拉选项、摘要、表单值、
// 对话框文案与 localStorage 里的模板库。Chrome 不可用时 skip。
//
// 三个页面覆盖全部验收点：
// - empty：空库起步 → 存两份、重名 / 超长报错、选中填入、改名、覆盖、删除到空；
// - seeded：库里已有两份 +「最近选用」指向第二份 —— 等价于「重新打开插件」；
// - legacy：只有旧单模板 key —— 迁移的端到端验证。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import {
  FULL_LIBRARY,
  LEGACY_TEMPLATE,
  SEEDED_LIBRARY,
  buildTemplatePickerHtml,
} from "./template-picker-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

const SEEDS = {
  empty: null,
  seeded: { library: SEEDED_LIBRARY, selection: "tpl-seed-64k" },
  legacy: { legacy: LEGACY_TEMPLATE },
  // 工单 #43：上次选的是内置「长文档」（库还在），等价于「重新打开插件」。
  builtinSeeded: { library: SEEDED_LIBRARY, selection: "builtin:long" },
  // 工单 #43 缺陷 4 / 5：满库禁用、删一份恢复、摘要的「表单已改动」。
  full: { library: FULL_LIBRARY, deleteOne: true },
  // 工单 #43 缺陷 6：覆盖 / 删除的二次确认按 Esc 只收合确认。
  escape: { library: SEEDED_LIBRARY, selection: "tpl-seed-64k", escape: true },
};

function probe(scenario) {
  if (!probes.has(scenario)) {
    probes.set(scenario, runPageProbe(chrome, buildTemplatePickerHtml(bundle, SEEDS[scenario])));
  }
  return probes.get(scenario);
}

const skip = (t) => t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");

const BUILTIN_SUMMARY =
  "内置模板：基础对话 · 上下文 128000（128K） · 输出 8192（8K） · text · off,low,medium,high";

test("空库：下拉只有三份内置预设且都标「内置」，摘要显示内置模板", async (t) => {
  if (chrome === null) return skip(t);
  const { initial } = await probe("empty");
  assert.deepEqual(initial.userOptions, []);
  assert.equal(initial.options.length, 3, "空库时没有用户模板，也没有多余的分隔项");
  assert.deepEqual(initial.builtinOptions.map((option) => option.text), [
    "基础对话（内置）",
    "代码（内置）",
    "长文档（内置）",
  ]);
  for (const option of initial.builtinOptions) assert.match(option.text, /（内置）$/);
  assert.equal(initial.selectValue, "builtin:basic");
  assert.equal(initial.summary, BUILTIN_SUMMARY);
  assert.equal(initial.libraryCount, 0);
  // 首次打开仍然按内置「基础对话」预填表单（工单 #40 的行为不变）。
  assert.deepEqual(initial.createState, {
    contextWindow: "128000",
    maxTokens: "8192",
    text: true,
    image: false,
    levels: ["off", "low", "medium", "high"],
  });
});

test("存一份「我的 128K」：对话框关闭、下拉多一项、摘要与「最近选用」同步", async (t) => {
  if (chrome === null) return skip(t);
  const { dialogOpened, afterFirstSave } = await probe("empty");
  assert.equal(dialogOpened, true);
  assert.equal(afterFirstSave.dialogOpen, false);
  assert.equal(afterFirstSave.userOptions.length, 1);
  assert.equal(afterFirstSave.userOptions[0].text, "我的 128K");
  assert.match(afterFirstSave.selectValue, /^user:tpl-[a-z0-9-]+$/, "id 只含 [a-z0-9-]");
  assert.equal(
    afterFirstSave.summary,
    "模板：我的 128K · 上下文 128000（128K） · 输出 8192（8K） · text · off,low,medium,high",
  );
  assert.equal(afterFirstSave.libraryCount, 1);
  assert.deepEqual(afterFirstSave.library.templates[0].values, {
    version: 1,
    contextWindow: "128000",
    maxTokens: "8192",
    inputText: true,
    inputImage: false,
    reasoningLevels: ["off", "low", "medium", "high"],
  });
  // 工单 #43 缺陷 2：选择改成与下拉 option 同构的编码值 user:<id>。
  assert.equal(afterFirstSave.selectionStored, `user:${afterFirstSave.library.templates[0].id}`);
  assert.equal(afterFirstSave.toast, "已保存模板「我的 128K」");
});

test("选中刚存的「我的 128K」点「填入」：三字段变 128000 / 8192 / text，mutations 为 0", async (t) => {
  if (chrome === null) return skip(t);
  const { firstFill } = await probe("empty");
  assert.deepEqual(firstFill.state, {
    contextWindow: "128000",
    maxTokens: "8192",
    text: true,
    image: false,
    levels: ["off", "low", "medium", "high"],
  });
  assert.equal(firstFill.mutations, 0, "「填入」只改表单，不写配置");
  assert.match(firstFill.summary, /^模板：我的 128K · 上下文 128000（128K）/);
});

test("编辑模型表单与新增模型表单共用同一份库（下拉里立刻能看到）", async (t) => {
  if (chrome === null) return skip(t);
  const { afterFirstSave, edit, editClosed } = await probe("empty");
  assert.equal(editClosed, true);
  assert.equal(edit.userOptions.length, 1);
  assert.equal(edit.userOptions[0].text, "我的 128K");
  assert.equal(edit.selectValue, afterFirstSave.selectValue);
  // 工单 #43 缺陷 5：编辑表单的值来自被编辑的模型（1000000 / 32768 …），与
  // 模板不同，摘要要如实说明；共同部分仍是同一份模板。
  assert.match(edit.summary, /^模板：我的 128K · 上下文 128000（128K） · 输出 8192（8K） · text · off,low,medium,high/);
  assert.match(edit.summary, /（表单已改动，与模板不同）$/);
});

test("存第二份「便宜的 64K」后，下拉两项且顺序与新增顺序一致", async (t) => {
  if (chrome === null) return skip(t);
  const { afterSecondSave } = await probe("empty");
  assert.deepEqual(afterSecondSave.shelfOrder, ["我的 128K", "便宜的 64K"]);
  assert.equal(afterSecondSave.userOptions.length, 2);
  assert.equal(afterSecondSave.libraryCount, 2);
  assert.equal(afterSecondSave.selectValue, afterSecondSave.userOptions[1].value, "新存的自动选中");
  assert.match(afterSecondSave.summary, /^模板：便宜的 64K · 上下文 64000（64K）/);
  assert.equal(afterSecondSave.toast, "已保存模板「便宜的 64K」");
});

test("名称重名：就地报错「已有同名模板」，对话框不关、库不变", async (t) => {
  if (chrome === null) return skip(t);
  const { duplicateName } = await probe("empty");
  assert.equal(duplicateName.dialogOpen, true);
  assert.equal(duplicateName.error, "已有同名模板");
  assert.equal(duplicateName.libraryCount, 2);
  assert.deepEqual(duplicateName.userOptions, ["我的 128K", "便宜的 64K"]);
});

test("名称超过 20 个字：就地报错，库不变；取消可以关窗", async (t) => {
  if (chrome === null) return skip(t);
  const { tooLongName, dialogClosedByCancel } = await probe("empty");
  assert.equal(tooLongName.dialogOpen, true);
  assert.equal(tooLongName.error, "模板名称最多 20 个字");
  assert.equal(tooLongName.libraryCount, 2);
  assert.equal(dialogClosedByCancel, true);
});

test("选中第二份点「填入」：摘要跟随，表单三字段变 64000 / 4096 / text，mutations 为 0", async (t) => {
  if (chrome === null) return skip(t);
  const { afterSecondSave, fill } = await probe("empty");
  assert.equal(fill.selectedValue, afterSecondSave.userOptions[1].value);
  assert.match(fill.summaryAfterSelect, /^模板：便宜的 64K · 上下文 64000（64K）/);
  assert.deepEqual(fill.state, {
    contextWindow: "64000",
    maxTokens: "4096",
    text: true,
    image: false,
    levels: ["off", "low", "medium", "high"],
  });
  assert.equal(fill.mutations, 0, "「填入」只改表单，不写配置");
  assert.equal(fill.selectionStored, fill.selectedValue, "存储值与下拉 option 的 value 同构");
});

test("改名：输入框预填原名，回车后下拉与摘要一起更新，id 不变", async (t) => {
  if (chrome === null) return skip(t);
  const { renaming, beforeRename, afterRename } = await probe("empty");
  assert.equal(renaming.value, "我的 128K");
  assert.deepEqual(afterRename.userOptions, ["128K 对话", "便宜的 64K"]);
  assert.equal(afterRename.idUnchanged, true, "改名不换 id，选择状态不丢");
  assert.equal(afterRename.selectValue, beforeRename.selectValue);
  assert.match(afterRename.summary, /^模板：128K 对话 · 上下文 128000（128K）/);
  assert.equal(afterRename.manageSummary, true);
});

test("改名重名：就地报错、输入框不关、下拉不变", async (t) => {
  if (chrome === null) return skip(t);
  const { renameError } = await probe("empty");
  assert.equal(renameError.error, "已有同名模板");
  assert.equal(renameError.inputStillOpen, true);
  assert.deepEqual(renameError.userOptions, ["128K 对话", "便宜的 64K"]);
});

test("用当前值覆盖：二次确认后 values 变 96000，name 不变，摘要同步", async (t) => {
  if (chrome === null) return skip(t);
  const { overwriteConfirm, afterOverwrite, beforeRename } = await probe("empty");
  assert.equal(overwriteConfirm.hint, true);
  assert.equal(afterOverwrite.name, "128K 对话");
  assert.equal(afterOverwrite.values.contextWindow, "96000");
  assert.equal(afterOverwrite.selectValue, beforeRename.selectValue);
  assert.match(afterOverwrite.summary, /^模板：128K 对话 · 上下文 96000（96K）/);
});

test("删除当前选中的一份：二次确认后回落到第一份用户模板，摘要不显示已删除的名字", async (t) => {
  if (chrome === null) return skip(t);
  const { deleteConfirm, beforeDelete, afterDeleteSelected, beforeRename } = await probe("empty");
  assert.equal(deleteConfirm.hint, true);
  assert.match(beforeDelete.summary, /^模板：便宜的 64K · /);
  assert.deepEqual(afterDeleteSelected.userOptions, ["128K 对话"]);
  assert.equal(afterDeleteSelected.selectValue, beforeRename.selectValue, "回落到第一份用户模板");
  assert.match(afterDeleteSelected.summary, /^模板：128K 对话 · /);
  assert.ok(!afterDeleteSelected.summary.includes("便宜的 64K"), "摘要不能显示已删除模板的名字");
  assert.equal(afterDeleteSelected.libraryCount, 1);
  assert.equal(afterDeleteSelected.selectionStored, beforeRename.selectValue, "存储值与下拉 option 的 value 同构");
});

test("删到空库：只剩三份内置预设，管理面板显示空库提示", async (t) => {
  if (chrome === null) return skip(t);
  const { afterDeleteAll } = await probe("empty");
  assert.deepEqual(afterDeleteAll.userOptions, []);
  assert.deepEqual(afterDeleteAll.builtinOptions, ["基础对话（内置）", "代码（内置）", "长文档（内置）"]);
  assert.equal(afterDeleteAll.selectValue, "builtin:basic");
  assert.match(afterDeleteAll.summary, /^内置模板：基础对话 · /);
  assert.equal(afterDeleteAll.libraryCount, 0);
  assert.equal(afterDeleteAll.emptyText, true);
});

test("重新打开：下拉停在上次选用的那一份，摘要与首次预填都跟着它", async (t) => {
  if (chrome === null) return skip(t);
  const { initial } = await probe("seeded");
  assert.equal(initial.selectValue, "user:tpl-seed-64k");
  assert.equal(
    initial.summary,
    "模板：便宜的 64K · 上下文 64000（64K） · 输出 4096（4K） · text · off,low",
  );
  assert.deepEqual(initial.createState, {
    contextWindow: "64000",
    maxTokens: "4096",
    text: true,
    image: false,
    levels: ["off", "low"],
  });
  assert.equal(initial.libraryCount, 2);
  assert.equal(initial.selectionStored, "tpl-seed-64k");
});

test("旧单模板自动迁移成「我的模板」，旧 key 保留", async (t) => {
  if (chrome === null) return skip(t);
  const { legacy } = await probe("legacy");
  assert.equal(legacy.libraryCount, 1);
  assert.deepEqual(legacy.libraryNames, ["我的模板"]);
  assert.equal(legacy.legacyStillStored, true);
  assert.match(legacy.selectValue, /^user:tpl-[a-z0-9-]+$/);
  assert.equal(
    legacy.summary,
    "模板：我的模板 · 上下文 131072（131K） · 输出 8192（8K） · text + image · off,low",
  );
  assert.deepEqual(legacy.createState, {
    contextWindow: "131072",
    maxTokens: "8192",
    text: true,
    image: true,
    levels: ["off", "low"],
  });
});

test("内置预设只读：管理面板不列出，下拉里可选可填", async (t) => {
  if (chrome === null) return skip(t);
  const { builtinReadOnly, builtinSelect, builtinFill } = await probe("empty");
  assert.equal(builtinReadOnly.manageRows, 0, "内置预设不能改名 / 覆盖 / 删除");
  assert.equal(builtinReadOnly.manageEmptyText, true);
  assert.equal(builtinSelect.selectValue, "builtin:coding");
  // 工单 #43 缺陷 5：此时表单还是之前的值（不是「代码」的 200000 / 16384），
  // 摘要必须说明「表单已改动」，避免被读成「现在要存的就是 200000」。
  assert.equal(
    builtinSelect.summary,
    "内置模板：代码 · 上下文 200000（200K） · 输出 16384（16K） · text · off,low,medium,high（表单已改动，与模板不同）",
  );
  assert.deepEqual(builtinFill.state, {
    contextWindow: "200000",
    maxTokens: "16384",
    text: true,
    image: false,
    levels: ["off", "low", "medium", "high"],
  });
  assert.equal(builtinFill.mutations, 0);
});

// ── 工单 #43 ────────────────────────────────────────────────────────────────

test("选内置预设也写「最近选用」：storage 里是 builtin:<presetId>", async (t) => {
  if (chrome === null) return skip(t);
  const { builtinSelect } = await probe("empty");
  assert.equal(builtinSelect.selectionStored, "builtin:coding");
});

test("重新打开：上次选的是内置预设 → 下拉停在「长文档（内置）」，不跳回旧的 user 模板", async (t) => {
  if (chrome === null) return skip(t);
  const { initial } = await probe("builtinSeeded");
  assert.equal(initial.selectValue, "builtin:long");
  assert.equal(initial.selectionStored, "builtin:long");
  assert.deepEqual(initial.userOptions.map((option) => option.text), ["我的 128K", "便宜的 64K"]);
  assert.match(initial.summary, /^内置模板：长文档 · 上下文 1000000（1M） · 输出 8192（8K） · text · off,low,medium,high$/);
  assert.ok(!initial.summary.includes("便宜的 64K"), "不能静默跳回之前选过的 user 模板");
  // 首次预填也跟着内置「长文档」。
  assert.deepEqual(initial.createState, {
    contextWindow: "1000000",
    maxTokens: "8192",
    text: true,
    image: false,
    levels: ["off", "low", "medium", "high"],
  });
});

test("库满 20 份：「存为新模板」禁用并写明原因；删一份后恢复可点", async (t) => {
  if (chrome === null) return skip(t);
  const { full } = await probe("full");
  assert.equal(full.initial.libraryCount, 20);
  assert.equal(full.initial.disabled, true);
  assert.match(full.initial.title, /已保存 20 份/);
  assert.equal(full.afterDeleteOne.libraryCount, 19);
  assert.equal(full.afterDeleteOne.disabled, false, "删掉一份后不再满额");
  assert.equal(full.afterDeleteOne.title, "", "不满额时没有满额提示");
  assert.equal(full.dialogOpens, true, "恢复可点后能真正打开对话框");
});

test("摘要：表单与模板一致时不提示；改一个字段 →「表单已改动」；改回 → 提示消失", async (t) => {
  if (chrome === null) return skip(t);
  const { summaryMatch } = await probe("full");
  assert.ok(!summaryMatch.initial.includes("表单已改动"), "一致时保持简洁");
  assert.match(summaryMatch.initial, /^模板：模板 1 · 上下文 128000（128K）/);
  assert.match(summaryMatch.afterChange, /（表单已改动，与模板不同）$/);
  assert.ok(!summaryMatch.afterRestore.includes("表单已改动"), "改回原值后提示消失");
});

test("Esc 分层：覆盖 / 删除的二次确认先收合，面板再按一次才关", async (t) => {
  if (chrome === null) return skip(t);
  const { escape } = await probe("escape");
  assert.equal(escape.deleteConfirmShown, true);
  assert.equal(escape.afterDeleteEsc.panelOpen, true, "第一次 Esc 只收起删除确认");
  assert.equal(escape.afterDeleteEsc.confirmShown, false);
  assert.equal(escape.afterSecondEsc.panelOpen, false, "再按一次才关面板");
  assert.equal(escape.overwriteConfirmShown, true);
  assert.equal(escape.afterOverwriteEsc.panelOpen, true, "第一次 Esc 只收起覆盖确认");
  assert.equal(escape.afterOverwriteEsc.confirmShown, false);
  assert.equal(escape.afterOverwriteSecondEsc.panelOpen, false);
});
