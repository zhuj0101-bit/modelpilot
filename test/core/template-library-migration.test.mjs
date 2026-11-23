// 工单 #42：旧单模板 key → 模板库的迁移。
//
// 迁移是「读库时」的隐式升级：新 key 不存在、旧 key（DEFAULT_TEMPLATE_KEY）有值时，
// 把旧值转成库里第一份「我的模板」并写回新 key；旧 key 保留不删，便于回滚旧版本
// 插件。因此必须幂等：连续读两次仍然只有一份。

import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const legacy = await import(pathToFileURL(join(root, "src", "core", "default-template.js")).href);
const repo = await import(pathToFileURL(join(root, "src", "core", "template-library.js")).href);

const { DEFAULT_TEMPLATE_KEY } = legacy;
const {
  TEMPLATE_LIBRARY_KEY,
  addLibraryTemplate,
  readTemplateLibrary,
  readTemplateSelection,
  writeTemplateLibrary,
  writeTemplateSelection,
} = repo;

const LEGACY_TEMPLATE = {
  version: 1,
  contextWindow: "131072",
  maxTokens: "8192",
  inputText: true,
  inputImage: true,
  reasoningLevels: ["off", "low"],
};

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(String(key), String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

function storageWithLegacy(template = LEGACY_TEMPLATE) {
  const storage = memoryStorage();
  storage.setItem(DEFAULT_TEMPLATE_KEY, JSON.stringify(template));
  return storage;
}

test("旧 key 有值、新 key 不存在 → 1 份「我的模板」，values 与旧数据一致", () => {
  const storage = storageWithLegacy();
  const library = readTemplateLibrary(storage);
  assert.equal(library.templates.length, 1);
  assert.equal(library.templates[0].name, "我的模板");
  assert.deepEqual(library.templates[0].values, LEGACY_TEMPLATE);
  assert.match(library.templates[0].id, /^[a-z0-9-]+$/);
  // 迁移结果已写回新 key。
  assert.deepEqual(JSON.parse(storage.getItem(TEMPLATE_LIBRARY_KEY)), library);
});

test("迁移幂等：连读两次，库里仍然只有 1 份", () => {
  const storage = storageWithLegacy();
  const first = readTemplateLibrary(storage);
  const second = readTemplateLibrary(storage);
  assert.equal(first.templates.length, 1);
  assert.deepEqual(second, first);
  assert.equal(second.templates.length, 1);
  assert.equal(second.templates[0].name, "我的模板");
});

test("旧 key 与新 key 都有值 → 以新 key 为准，旧值被忽略", () => {
  const storage = storageWithLegacy();
  // 新 key 里已经是一份完全不同的库（比如用户先升级、又删掉了迁移来的那份）。
  const added = addLibraryTemplate(null, "便宜的 64K", {
    contextWindow: "64000",
    maxTokens: "4096",
    inputText: true,
    inputImage: false,
    reasoningLevels: ["off", "low"],
  });
  assert.equal(added.ok, true);
  assert.equal(writeTemplateLibrary(storage, added.library), true);

  const loaded = readTemplateLibrary(storage);
  assert.deepEqual(loaded, added.library);
  assert.equal(loaded.templates.length, 1);
  assert.equal(loaded.templates[0].name, "便宜的 64K");
  // 旧 key 原样保留，没有被删除或改写。
  assert.deepEqual(JSON.parse(storage.getItem(DEFAULT_TEMPLATE_KEY)), LEGACY_TEMPLATE);
});

test("迁移后旧 key 仍然存在（回滚旧版本插件时用户数据还在）", () => {
  const storage = storageWithLegacy();
  readTemplateLibrary(storage);
  assert.notEqual(storage.getItem(DEFAULT_TEMPLATE_KEY), null);
  assert.deepEqual(JSON.parse(storage.getItem(DEFAULT_TEMPLATE_KEY)), LEGACY_TEMPLATE);
});

test("旧 key 是损坏 JSON → 空库，不抛错", () => {
  const storage = memoryStorage();
  storage.setItem(DEFAULT_TEMPLATE_KEY, "{bad");
  assert.deepEqual(readTemplateLibrary(storage), { version: 1, templates: [] });
  // 损坏数据不会被迁移写回新 key。
  assert.equal(storage.getItem(TEMPLATE_LIBRARY_KEY), null);
});

test("旧 key 结构不合法（两个模态都没勾）→ 空库", () => {
  const storage = storageWithLegacy({ ...LEGACY_TEMPLATE, inputText: false, inputImage: false });
  assert.deepEqual(readTemplateLibrary(storage), { version: 1, templates: [] });
});

test("迁移写入失败（隐私模式）：仍然返回迁移结果，重复读取不会变成两份", () => {
  const map = new Map([[DEFAULT_TEMPLATE_KEY, JSON.stringify(LEGACY_TEMPLATE)]]);
  const storage = {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: () => { throw new Error("denied"); },
  };
  const first = readTemplateLibrary(storage);
  const second = readTemplateLibrary(storage);
  for (const library of [first, second]) {
    assert.equal(library.templates.length, 1);
    assert.equal(library.templates[0].name, "我的模板");
    assert.deepEqual(library.templates[0].values, LEGACY_TEMPLATE);
  }
  assert.equal(map.has(TEMPLATE_LIBRARY_KEY), false);
});

test("storage 不可用 → 空库，不抛", () => {
  assert.deepEqual(readTemplateLibrary(undefined), { version: 1, templates: [] });
  assert.deepEqual(readTemplateLibrary({ getItem: () => { throw new Error("denied"); } }), { version: 1, templates: [] });
});

test("迁移后的那一份可以被「最近选用」指向", () => {
  const storage = storageWithLegacy();
  const library = readTemplateLibrary(storage);
  const id = library.templates[0].id;
  assert.equal(readTemplateSelection(storage, library), null);
  assert.equal(writeTemplateSelection(storage, id), true);
  // 工单 #43 缺陷 2：readTemplateSelection 返回 { kind, id }。
  assert.deepEqual(readTemplateSelection(storage, library), { kind: "user", id });
});
