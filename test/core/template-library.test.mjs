// 工单 #42：模板库纯逻辑（增删改、查找、读写、最近选用）。
//
// 全部用内存 storage 桩；隐私模式抛异常、损坏 JSON、超上限都在这里覆盖。
// 迁移（旧单模板 key → 库）单独放在 template-library-migration.test.mjs。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const repo = await import(pathToFileURL(join(root, "src", "core", "template-library.js")).href);

const {
  TEMPLATE_LIBRARY_KEY,
  TEMPLATE_MAX_COUNT,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_SELECTION_KEY,
  addLibraryTemplate,
  findLibraryTemplate,
  normalizeLibraryTemplate,
  normalizeTemplateLibrary,
  readTemplateLibrary,
  readTemplateSelection,
  removeLibraryTemplate,
  renameLibraryTemplate,
  updateLibraryTemplate,
  writeTemplateLibrary,
  writeTemplateSelection,
} = repo;

const VALUES = {
  contextWindow: "128000",
  maxTokens: "8192",
  inputText: true,
  inputImage: false,
  reasoningLevels: ["off", "low", "medium", "high"],
};

const VALUES_64K = {
  contextWindow: "64000",
  maxTokens: "4096",
  inputText: true,
  inputImage: false,
  reasoningLevels: ["off", "low"],
};

const NORMALIZED_VALUES = { version: 1, ...VALUES };
const NORMALIZED_64K = { version: 1, ...VALUES_64K };

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

/** 用公开 API 造一个库，保证 id / 结构都合法。 */
function libraryOf(names, values = VALUES) {
  let library = normalizeTemplateLibrary(null);
  for (const name of names) {
    const added = addLibraryTemplate(library, name, values);
    assert.equal(added.ok, true, `fixture 新增失败：${added.error ?? ""}`);
    library = added.library;
  }
  return library;
}

const snapshot = (value) => JSON.parse(JSON.stringify(value));

// ── normalizeLibraryTemplate ────────────────────────────────────────────────

test("normalizeLibraryTemplate：缺 name / name 空白 → null", () => {
  assert.equal(normalizeLibraryTemplate({ id: "tpl-1", values: VALUES }), null);
  assert.equal(normalizeLibraryTemplate({ id: "tpl-1", name: "   ", values: VALUES }), null);
  assert.equal(normalizeLibraryTemplate({ id: "tpl-1", name: "", values: VALUES }), null);
});

test("normalizeLibraryTemplate：两个模态都没勾 → null", () => {
  assert.equal(
    normalizeLibraryTemplate({ id: "tpl-1", name: "我的", values: { ...VALUES, inputText: false, inputImage: false } }),
    null,
  );
});

test("normalizeLibraryTemplate：合法项收敛成 { id, name, values }，values 带 version", () => {
  assert.deepEqual(normalizeLibraryTemplate({ id: "tpl-abc-1", name: "  我的 128K  ", values: VALUES }), {
    id: "tpl-abc-1",
    name: "我的 128K",
    values: NORMALIZED_VALUES,
  });
});

test("normalizeLibraryTemplate：id 非法 / 名字超长 → null", () => {
  assert.equal(normalizeLibraryTemplate({ id: "TPL-1", name: "我的", values: VALUES }), null);
  assert.equal(normalizeLibraryTemplate({ id: "", name: "我的", values: VALUES }), null);
  assert.equal(normalizeLibraryTemplate({ id: "tpl-1", name: "字".repeat(TEMPLATE_NAME_MAX_LENGTH + 1), values: VALUES }), null);
});

// ── normalizeTemplateLibrary ────────────────────────────────────────────────

test("normalizeTemplateLibrary：非对象 / templates 非数组 → 空库", () => {
  for (const value of [null, undefined, 42, "x", [], {}]) {
    assert.deepEqual(normalizeTemplateLibrary(value), { version: 1, templates: [] });
  }
  assert.deepEqual(normalizeTemplateLibrary({ version: 1, templates: {} }), { version: 1, templates: [] });
});

test("normalizeTemplateLibrary：丢弃非法项，保留合法项与顺序", () => {
  const library = normalizeTemplateLibrary({
    version: 1,
    templates: [
      { id: "tpl-a", name: "第一份", values: VALUES },
      { id: "tpl-b", name: "", values: VALUES },
      { id: "tpl-c", name: "第三份", values: { ...VALUES, inputText: false, inputImage: false } },
      { id: "tpl-d", name: "第四份", values: VALUES_64K },
    ],
  });
  assert.deepEqual(library.templates.map((template) => template.id), ["tpl-a", "tpl-d"]);
  assert.deepEqual(library.templates[1].values, NORMALIZED_64K);
});

test("normalizeTemplateLibrary：按 id 去重（保留第一份）", () => {
  const library = normalizeTemplateLibrary({
    templates: [
      { id: "tpl-a", name: "第一份", values: VALUES },
      { id: "tpl-a", name: "重复 id", values: VALUES_64K },
    ],
  });
  assert.equal(library.templates.length, 1);
  assert.equal(library.templates[0].name, "第一份");
});

test(`normalizeTemplateLibrary：超过 ${TEMPLATE_MAX_COUNT} 份 → 截断到上限`, () => {
  const templates = Array.from({ length: TEMPLATE_MAX_COUNT + 5 }, (_, index) => ({
    id: `tpl-${index}`,
    name: `模板 ${index}`,
    values: VALUES,
  }));
  const library = normalizeTemplateLibrary({ templates });
  assert.equal(library.templates.length, TEMPLATE_MAX_COUNT);
  assert.equal(library.templates[TEMPLATE_MAX_COUNT - 1].name, `模板 ${TEMPLATE_MAX_COUNT - 1}`);
});

// ── addLibraryTemplate ──────────────────────────────────────────────────────

test("addLibraryTemplate：正常新增后多一份，返回新 id", () => {
  const library = libraryOf(["我的 128K"]);
  assert.equal(library.templates.length, 1);
  assert.match(library.templates[0].id, /^[a-z0-9-]+$/);
  assert.equal(library.templates[0].name, "我的 128K");
  assert.deepEqual(library.templates[0].values, NORMALIZED_VALUES);

  const added = addLibraryTemplate(library, "便宜的 64K", VALUES_64K);
  assert.equal(added.ok, true);
  assert.equal(added.library.templates.length, 2);
  assert.notEqual(added.id, library.templates[0].id);
  assert.equal(added.library.templates[1].id, added.id);
  // 原库没有被就地改写。
  assert.equal(library.templates.length, 1);
});

test("addLibraryTemplate：名字重名（大小写不同、含前后空格）→ 已有同名模板，库不变", () => {
  const library = libraryOf(["我的 128K"]);
  const before = snapshot(library);
  for (const name of ["我的 128K", "  我的 128k  ", "我的 128K "]) {
    assert.deepEqual(addLibraryTemplate(library, name, VALUES_64K), { ok: false, error: "已有同名模板" });
    assert.deepEqual(library, before);
  }
});

test("addLibraryTemplate：名字为空 / 纯空白 / 超过 20 个字 → 各自对应的 error，库不变", () => {
  const library = libraryOf(["我的 128K"]);
  const before = snapshot(library);
  assert.deepEqual(addLibraryTemplate(library, "", VALUES), { ok: false, error: "请填写模板名称" });
  assert.deepEqual(addLibraryTemplate(library, " \t ", VALUES), { ok: false, error: "请填写模板名称" });
  assert.deepEqual(addLibraryTemplate(library, "字".repeat(TEMPLATE_NAME_MAX_LENGTH + 1), VALUES), {
    ok: false,
    error: "模板名称最多 20 个字",
  });
  // 20 个码点（emoji 算 1 个，UTF-16 长度是 2）是合法的。
  const emoji = "😀".repeat(TEMPLATE_NAME_MAX_LENGTH);
  const added = addLibraryTemplate(library, emoji, VALUES);
  assert.equal(added.ok, true);
  assert.equal(added.library.templates[1].name, emoji);
  // 原库始终没有被就地改写。
  assert.deepEqual(library, before);
});

test(`addLibraryTemplate：已达 ${TEMPLATE_MAX_COUNT} 份 → 最多保存 20 份模板，库不变`, () => {
  let library = libraryOf(Array.from({ length: TEMPLATE_MAX_COUNT }, (_, index) => `模板 ${index}`));
  const before = snapshot(library);
  assert.deepEqual(addLibraryTemplate(library, "第二十一份", VALUES), { ok: false, error: "最多保存 20 份模板" });
  assert.deepEqual(library, before);
});

test("addLibraryTemplate：连续新增两份同名不同大小写 → 第二份被拒", () => {
  const first = addLibraryTemplate(null, "MiXeD", VALUES);
  assert.equal(first.ok, true);
  const second = addLibraryTemplate(first.library, "mixed", VALUES);
  assert.deepEqual(second, { ok: false, error: "已有同名模板" });
  assert.equal(first.library.templates.length, 1);
});

test("addLibraryTemplate：values 两个模态都没勾 → 结构非法，库不变", () => {
  const library = libraryOf(["我的"]);
  const before = snapshot(library);
  const added = addLibraryTemplate(library, "新的", { ...VALUES, inputText: false, inputImage: false });
  assert.equal(added.ok, false);
  assert.equal(typeof added.error, "string");
  assert.deepEqual(library, before);
});

test("addLibraryTemplate：同一毫秒内连续新增两份，id 不冲突且只含 [a-z0-9-]", () => {
  const realNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  try {
    let library = normalizeTemplateLibrary(null);
    const ids = [];
    for (const name of ["第一份", "第二份"]) {
      const added = addLibraryTemplate(library, name, VALUES);
      assert.equal(added.ok, true);
      ids.push(added.id);
      library = added.library;
    }
    assert.notEqual(ids[0], ids[1]);
    for (const id of ids) assert.match(id, /^[a-z0-9-]+$/);
  } finally {
    Date.now = realNow;
  }
});

// ── renameLibraryTemplate ──────────────────────────────────────────────────

test("renameLibraryTemplate：改成自己原来的名字 → 成功（不算重名），id 不变", () => {
  const library = libraryOf(["我的 128K", "便宜的 64K"]);
  const target = library.templates[0];
  const renamed = renameLibraryTemplate(library, target.id, "我的 128K");
  assert.equal(renamed.ok, true);
  assert.equal(renamed.library.templates[0].id, target.id);
  // 大小写 / 空白差异也算「自己」。
  const again = renameLibraryTemplate(library, target.id, "  我的 128k ");
  assert.equal(again.ok, true);
  assert.equal(again.library.templates[0].name, "我的 128k");
  assert.equal(again.library.templates[0].id, target.id);
});

test("renameLibraryTemplate：改成别人的名字 → 被拒，库不变", () => {
  const library = libraryOf(["我的 128K", "便宜的 64K"]);
  const before = snapshot(library);
  const renamed = renameLibraryTemplate(library, library.templates[1].id, "我的 128k");
  assert.deepEqual(renamed, { ok: false, error: "已有同名模板" });
  assert.deepEqual(library, before);
});

test("renameLibraryTemplate：空名字 / 超长 / 未知 id → 被拒", () => {
  const library = libraryOf(["我的 128K"]);
  const id = library.templates[0].id;
  assert.deepEqual(renameLibraryTemplate(library, id, "  "), { ok: false, error: "请填写模板名称" });
  assert.deepEqual(renameLibraryTemplate(library, id, "字".repeat(TEMPLATE_NAME_MAX_LENGTH + 1)), {
    ok: false,
    error: "模板名称最多 20 个字",
  });
  assert.equal(renameLibraryTemplate(library, "tpl-unknown", "新的").ok, false);
});

// ── updateLibraryTemplate ──────────────────────────────────────────────────

test("updateLibraryTemplate：只换 values 不换 name", () => {
  const library = libraryOf(["我的 128K", "便宜的 64K"], VALUES);
  const target = library.templates[0];
  const updated = updateLibraryTemplate(library, target.id, VALUES_64K);
  assert.equal(updated.ok, true);
  assert.equal(updated.library.templates[0].name, "我的 128K");
  assert.equal(updated.library.templates[0].id, target.id);
  assert.deepEqual(updated.library.templates[0].values, NORMALIZED_64K);
  // 另一份不受影响。
  assert.deepEqual(updated.library.templates[1], library.templates[1]);
});

test("updateLibraryTemplate：未知 id / values 非法 → 被拒且库不变", () => {
  const library = libraryOf(["我的 128K"]);
  const before = snapshot(library);
  assert.equal(updateLibraryTemplate(library, "tpl-unknown", VALUES_64K).ok, false);
  assert.equal(
    updateLibraryTemplate(library, library.templates[0].id, { ...VALUES, inputText: false, inputImage: false }).ok,
    false,
  );
  assert.deepEqual(library, before);
});

// ── removeLibraryTemplate ──────────────────────────────────────────────────

test("removeLibraryTemplate：删掉指定的一份，其余顺序不变", () => {
  const library = libraryOf(["一", "二", "三"]);
  const removed = removeLibraryTemplate(library, library.templates[1].id);
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.library.templates.map((template) => template.name), ["一", "三"]);
});

test("removeLibraryTemplate：未知 id → ok:false 且库不变", () => {
  const library = libraryOf(["一"]);
  const before = snapshot(library);
  const removed = removeLibraryTemplate(library, "tpl-unknown");
  assert.equal(removed.ok, false);
  assert.equal(typeof removed.error, "string");
  assert.deepEqual(library, before);
});

test("removeLibraryTemplate：删到空库 → 合法结果", () => {
  const library = libraryOf(["唯一的一份"]);
  const removed = removeLibraryTemplate(library, library.templates[0].id);
  assert.equal(removed.ok, true);
  assert.deepEqual(removed.library, { version: 1, templates: [] });
});

// ── findLibraryTemplate ────────────────────────────────────────────────────

test("findLibraryTemplate：按 id 找到；未知 id / 非字符串 → null", () => {
  const library = libraryOf(["一", "二"]);
  const target = library.templates[1];
  assert.deepEqual(findLibraryTemplate(library, target.id), target);
  assert.equal(findLibraryTemplate(library, "tpl-unknown"), null);
  assert.equal(findLibraryTemplate(library, null), null);
  assert.equal(findLibraryTemplate(null, target.id), null);
});

// ── readTemplateLibrary / writeTemplateLibrary ─────────────────────────────

test("writeTemplateLibrary → readTemplateLibrary：逐份往返一致", () => {
  const storage = memoryStorage();
  const library = libraryOf(["我的 128K", "便宜的 64K"], VALUES);
  assert.equal(writeTemplateLibrary(storage, library), true);
  assert.deepEqual(readTemplateLibrary(storage), library);
  assert.equal(storage.getItem(TEMPLATE_LIBRARY_KEY) !== null, true);
});

test("writeTemplateLibrary：空库是合法结果（删到最后一份）", () => {
  const storage = memoryStorage();
  assert.equal(writeTemplateLibrary(storage, { version: 1, templates: [] }), true);
  assert.deepEqual(readTemplateLibrary(storage), { version: 1, templates: [] });
});

test("writeTemplateLibrary：超上限 / 全非法 / 非对象 → false，storage 不变", () => {
  const storage = memoryStorage();
  writeTemplateLibrary(storage, libraryOf(["已有"]));
  const before = storage.getItem(TEMPLATE_LIBRARY_KEY);
  const over = {
    version: 1,
    templates: Array.from({ length: TEMPLATE_MAX_COUNT + 1 }, (_, index) => ({ id: `tpl-${index}`, name: `模板 ${index}`, values: VALUES })),
  };
  assert.equal(writeTemplateLibrary(storage, over), false);
  assert.equal(writeTemplateLibrary(storage, { version: 1, templates: [{ id: "tpl-a", name: "", values: VALUES }] }), false);
  assert.equal(writeTemplateLibrary(storage, null), false);
  assert.equal(writeTemplateLibrary(storage, { templates: "x" }), false);
  assert.equal(storage.getItem(TEMPLATE_LIBRARY_KEY), before);
});

test("readTemplateLibrary：损坏 JSON / 结构不合法 → 空库，不抛", () => {
  for (const raw of ["{bad", "null", "[]", '"x"', '{"templates":"x"}']) {
    const storage = memoryStorage();
    storage.setItem(TEMPLATE_LIBRARY_KEY, raw);
    assert.deepEqual(readTemplateLibrary(storage), { version: 1, templates: [] });
  }
});

test("storage 不可用：读成空库，写入 / 选择写入返回 false", () => {
  assert.deepEqual(readTemplateLibrary(undefined), { version: 1, templates: [] });
  assert.deepEqual(readTemplateLibrary({ getItem: () => { throw new Error("denied"); } }), { version: 1, templates: [] });
  assert.equal(writeTemplateLibrary(undefined, { version: 1, templates: [] }), false);
  assert.equal(writeTemplateLibrary({ setItem: () => { throw new Error("quota"); } }, { version: 1, templates: [] }), false);
  assert.equal(readTemplateSelection(undefined, null), null);
  assert.equal(readTemplateSelection({ getItem: () => { throw new Error("denied"); } }, null), null);
  assert.equal(writeTemplateSelection(undefined, "tpl-1"), false);
  assert.equal(writeTemplateSelection({ setItem: () => { throw new Error("quota"); } }, "tpl-1"), false);
});

// ── 最近选用 ───────────────────────────────────────────────────────────────

test("readTemplateSelection：没有值 → null", () => {
  const storage = memoryStorage();
  assert.equal(readTemplateSelection(storage, libraryOf(["一"])), null);
});

test("readTemplateSelection：值指向已删除的模板 → null（不是返回那个 id）", () => {
  const storage = memoryStorage();
  const library = libraryOf(["一", "二"]);
  const removedId = library.templates[0].id;
  assert.equal(writeTemplateSelection(storage, removedId), true);
  const afterRemoval = removeLibraryTemplate(library, removedId).library;
  assert.equal(readTemplateSelection(storage, afterRemoval), null);
  // 工单 #43：存储值改成编码值 user:<id>（选择本身不删，回落由界面覆盖）。
  assert.equal(storage.getItem(TEMPLATE_SELECTION_KEY), `user:${removedId}`, "值的删除由界面在回落后覆盖");
});

test("writeTemplateSelection / readTemplateSelection：指向存在的模板时返回该 id", () => {
  const storage = memoryStorage();
  const library = libraryOf(["一", "二"]);
  const id = library.templates[1].id;
  assert.equal(writeTemplateSelection(storage, id), true);
  // 工单 #43：签名从「裸 id」变成 { kind, id }，存储值是与下拉 option 同构的编码值。
  assert.deepEqual(readTemplateSelection(storage, library), { kind: "user", id });
  assert.equal(storage.getItem(TEMPLATE_SELECTION_KEY), `user:${id}`);
});

test("readTemplateSelection：空串 / 非字符串值 → null；writeTemplateSelection 空 id → false", () => {
  const storage = memoryStorage();
  const library = libraryOf(["一"]);
  storage.setItem(TEMPLATE_SELECTION_KEY, "");
  assert.equal(readTemplateSelection(storage, library), null);
  storage.setItem(TEMPLATE_SELECTION_KEY, JSON.stringify(library.templates[0].id));
  assert.equal(readTemplateSelection(storage, library), null);
  assert.equal(writeTemplateSelection(storage, ""), false);
  assert.equal(writeTemplateSelection(storage, null), false);
});

// ── 工单 #43 缺陷 2：最近选用的编码值（内置预设也持久化） ────────────────────

test("writeTemplateSelection / readTemplateSelection：内置预设也持久化", () => {
  const storage = memoryStorage();
  const library = libraryOf(["一"]);
  assert.equal(writeTemplateSelection(storage, { kind: "builtin", id: "long" }), true);
  assert.equal(storage.getItem(TEMPLATE_SELECTION_KEY), "builtin:long", "与下拉 option 的 value 同构");
  assert.deepEqual(readTemplateSelection(storage, library), { kind: "builtin", id: "long" });
  // 换一份内置预设同样持久化（工单 #43 之前这里根本不写 key）。
  assert.equal(writeTemplateSelection(storage, { kind: "builtin", id: "coding" }), true);
  assert.deepEqual(readTemplateSelection(storage, library), { kind: "builtin", id: "coding" });
});

test("writeTemplateSelection / readTemplateSelection：用户模板存成 user:<id>", () => {
  const storage = memoryStorage();
  const library = libraryOf(["一", "二"]);
  const id = library.templates[1].id;
  assert.equal(writeTemplateSelection(storage, { kind: "user", id }), true);
  assert.equal(storage.getItem(TEMPLATE_SELECTION_KEY), `user:${id}`);
  assert.deepEqual(readTemplateSelection(storage, library), { kind: "user", id });
});

test("readTemplateSelection：向后兼容裸 id（#42 的旧格式），按 user:<id> 解释", () => {
  const storage = memoryStorage();
  const library = normalizeTemplateLibrary({
    templates: [{ id: "tpl-1", name: "旧的", values: VALUES }],
  });
  storage.setItem(TEMPLATE_SELECTION_KEY, "tpl-1");
  assert.deepEqual(readTemplateSelection(storage, library), { kind: "user", id: "tpl-1" });
});

test("readTemplateSelection：指向已删除模板 / 未知内置预设 / 非法值 / 损坏数据 → null", () => {
  const storage = memoryStorage();
  const library = libraryOf(["一"]);
  const existing = library.templates[0].id;
  const nullCases = [
    `user:${existing}-deleted`, // 已删除的模板
    "builtin:unknown", // 未知预设
    "builtin:", // 空 id
    "user:", // 空 id
    ":tpl-1", // 没有前缀的空 kind
    "user:a:b", // 拼接错的编码值
    "tpl-1", // 旧格式但库里没有这份
    "", // 空串
    "{bad", // 损坏的数据
    '{"kind":"user","id":"tpl-1"}', // 不是编码值
    JSON.stringify(existing), // 被 JSON 引用过的裸 id
  ];
  for (const raw of nullCases) {
    storage.setItem(TEMPLATE_SELECTION_KEY, raw);
    assert.equal(readTemplateSelection(storage, library), null, `应回落：${raw}`);
  }
  // 指向存在的那份仍然读得出来，证明上面的 null 不是读不到一切。
  storage.setItem(TEMPLATE_SELECTION_KEY, `user:${existing}`);
  assert.deepEqual(readTemplateSelection(storage, library), { kind: "user", id: existing });
});

test("writeTemplateSelection：未知 kind / 空 id / 非字符串、对象 choice → false，不写 key", () => {
  const storage = memoryStorage();
  assert.equal(writeTemplateSelection(storage, { kind: "unknown", id: "x" }), false);
  assert.equal(writeTemplateSelection(storage, { kind: "user", id: "" }), false);
  assert.equal(writeTemplateSelection(storage, { kind: "user", id: "a:b" }), false);
  assert.equal(writeTemplateSelection(storage, null), false);
  assert.equal(writeTemplateSelection(storage, ""), false);
  assert.equal(storage.getItem(TEMPLATE_SELECTION_KEY), null);
});
