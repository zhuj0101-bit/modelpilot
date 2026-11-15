// 工单 #37：改密钥引用名时清理旧密钥的纯规则测试。
//
// 这里不碰浏览器：旧 / 新引用名怎么归一化、什么情况算「改名」、每种状态下
// 旧密钥删还是留、确认弹窗说什么，都是应该先在纯层钉死的规则；真实 DOM 下
// 的点击顺序与 unset / mutate 调用顺序在 test/client/key-rename.test.mjs。

import test from "node:test";
import assert from "node:assert/strict";
import {
  KEY_RENAME_STATE,
  describeKeyRenameDialog,
  keyRenameRemovesOldKey,
  keyRenameState,
  keyRenameTarget,
} from "../../src/core/key-rename.js";
import { routesSharingKeyRef } from "../../src/core/route-delete.js";

const route = (overrides = {}) => ({ api: "openai-completions", models: [], ...overrides });

const probe = (overrides = {}) => ({
  oldRef: "PREVIEW_CHAT_API_KEY",
  newRef: "PREVIEW_CHAT_KEY_V2",
  changed: true,
  status: "ready",
  configured: true,
  writable: true,
  sharedBy: [],
  ...overrides,
});

// ── 旧 / 新引用名 ──────────────────────────────────────────────────────

test("改引用名目标：旧引用名取路由的 apiKeyEnv，新引用名取表单值，都去首尾空白", () => {
  const providers = { "preview-chat": route({ apiKeyEnv: "  PREVIEW_CHAT_API_KEY  " }) };
  assert.deepEqual(keyRenameTarget("preview-chat", providers, "  PREVIEW_CHAT_KEY_V2  "), {
    oldRef: "PREVIEW_CHAT_API_KEY",
    newRef: "PREVIEW_CHAT_KEY_V2",
    changed: true,
  });
});

test("改引用名目标：引用名没变（含只改首尾空白）不算改名", () => {
  const providers = { "preview-chat": route({ apiKeyEnv: "PREVIEW_CHAT_API_KEY" }) };
  assert.deepEqual(keyRenameTarget("preview-chat", providers, "PREVIEW_CHAT_API_KEY"), {
    oldRef: "PREVIEW_CHAT_API_KEY",
    newRef: "PREVIEW_CHAT_API_KEY",
    changed: false,
  });
  assert.equal(keyRenameTarget("preview-chat", providers, "  PREVIEW_CHAT_API_KEY  ").changed, false);
});

test("改引用名目标：任一引用名为空都不算改名（首次设置 / 清空引用名）", () => {
  // 旧值为空：这次是首次设置密钥引用，没有旧密钥可删。
  assert.deepEqual(keyRenameTarget("preview-chat", { "preview-chat": route() }, "PREVIEW_CHAT_KEY_V2"), {
    oldRef: "",
    newRef: "PREVIEW_CHAT_KEY_V2",
    changed: false,
  });
  // 新值为空：清空引用名同样不按改名处理（本单只处理「改引用名」这条路）。
  assert.deepEqual(
    keyRenameTarget("preview-chat", { "preview-chat": route({ apiKeyEnv: "PREVIEW_CHAT_API_KEY" }) }, "  "),
    { oldRef: "PREVIEW_CHAT_API_KEY", newRef: "", changed: false },
  );
  // 两边都为空。
  assert.deepEqual(keyRenameTarget("preview-chat", { "preview-chat": route() }, ""), {
    oldRef: "",
    newRef: "",
    changed: false,
  });
});

test("改引用名目标：路由不存在 / providers 非法时按空旧引用名处理，不抛错", () => {
  assert.deepEqual(keyRenameTarget("gone", { "preview-chat": route() }, "NEXT_KEY"), {
    oldRef: "",
    newRef: "NEXT_KEY",
    changed: false,
  });
  assert.deepEqual(keyRenameTarget("gone", undefined, "NEXT_KEY"), {
    oldRef: "",
    newRef: "NEXT_KEY",
    changed: false,
  });
  assert.deepEqual(keyRenameTarget("gone", null, "NEXT_KEY"), {
    oldRef: "",
    newRef: "NEXT_KEY",
    changed: false,
  });
});

// ── 状态判定 ────────────────────────────────────────────────────────────

test("状态：引用名没变 / 任一为空 / 两个相同 → unchanged，绝不删密钥", () => {
  assert.equal(keyRenameState(probe({ changed: false })), KEY_RENAME_STATE.unchanged);
  assert.equal(keyRenameState(probe({ oldRef: "" })), KEY_RENAME_STATE.unchanged);
  assert.equal(keyRenameState(probe({ newRef: "" })), KEY_RENAME_STATE.unchanged);
  assert.equal(keyRenameState(probe({ newRef: "PREVIEW_CHAT_API_KEY" })), KEY_RENAME_STATE.unchanged);
  // 即使 describe 说旧密钥存在，也不能在「没改名」时动它。
  assert.equal(
    keyRenameState(probe({ changed: false, configured: true })),
    KEY_RENAME_STATE.unchanged,
  );
});

test("状态：还没查 / 正在查 / 读失败 → unknown（不是 absent，也不能偷偷当 absent）", () => {
  for (const status of ["idle", "loading", "error"]) {
    assert.equal(keyRenameState(probe({ status })), KEY_RENAME_STATE.unknown, status);
  }
  assert.equal(keyRenameState(probe({ status: undefined })), KEY_RENAME_STATE.unknown);
  assert.notEqual(
    keyRenameState(probe({ status: "error" })),
    keyRenameState(probe({ configured: false })),
    "读不到不等于没有密钥",
  );
});

test("状态：旧引用没有存储的密钥 → absent", () => {
  assert.equal(keyRenameState(probe({ configured: false })), KEY_RENAME_STATE.absent);
  assert.equal(keyRenameState(probe({ configured: undefined })), KEY_RENAME_STATE.absent);
});

test("状态：已配置、可写、独占 → movable（唯一会删旧密钥的状态）", () => {
  assert.equal(keyRenameState(probe()), KEY_RENAME_STATE.movable);
  assert.equal(keyRenameState(probe({ sharedBy: [] })), KEY_RENAME_STATE.movable);
});

test("状态：旧引用被别的路由共用 → shared，即使可写也不删", () => {
  assert.equal(keyRenameState(probe({ sharedBy: ["zeta"] })), KEY_RENAME_STATE.shared);
  // 共用优先于只读：先说清「为什么保留」。
  assert.equal(keyRenameState(probe({ writable: false, sharedBy: ["zeta"] })), KEY_RENAME_STATE.shared);
});

test("状态：旧引用由环境变量提供（writable: false）→ readonly，不尝试删除", () => {
  assert.equal(keyRenameState(probe({ writable: false })), KEY_RENAME_STATE.readonly);
});

test("共用判定与 routesSharingKeyRef 一致：另一条路由声明同一引用名 → shared", () => {
  const providers = {
    "preview-chat": route({ apiKeyEnv: "SHARED_API_KEY" }),
    zeta: route({ apiKeyEnv: "SHARED_API_KEY" }),
    alpha: route({ apiKeyEnv: "  SHARED_API_KEY  " }),
    other: route({ apiKeyEnv: "OTHER_API_KEY" }),
  };
  const target = keyRenameTarget("preview-chat", providers, "PREVIEW_CHAT_KEY_V2");
  const sharedBy = routesSharingKeyRef("preview-chat", providers, target.oldRef);
  assert.deepEqual(sharedBy, ["alpha", "zeta"]);
  assert.equal(
    keyRenameState({ ...target, status: "ready", configured: true, writable: true, sharedBy }),
    KEY_RENAME_STATE.shared,
  );
});

test("复用 routesSharingKeyRef：显式引用名被另一条路由声明时列出该路由（字母序）", () => {
  const providers = {
    "preview-chat": route({ apiKeyEnv: "SHARED_API_KEY" }),
    zeta: route({ apiKeyEnv: "SHARED_API_KEY" }),
    alpha: route({ apiKeyEnv: "  SHARED_API_KEY  " }),
    prefix: route({ apiKeyEnv: "SHARED_API_KEY_2" }),
  };
  const target = keyRenameTarget("preview-chat", providers, "PREVIEW_CHAT_KEY_V2");
  assert.deepEqual(routesSharingKeyRef("preview-chat", providers, target.oldRef), ["alpha", "zeta"]);
});

test("改引用名只认显式 apiKeyEnv：旧值为空即首次设置，不回落派生引用名", () => {
  // 与删除路由不同：删除时 apiKeyEnv 为空会回落到 deriveKeyRef(routeId)，因为
  // 那条路由的密钥可能就存在派生名下；改引用名没有「旧显式引用名」，不按改名处理。
  const providers = {
    "preview-chat": route(),
    "preview-chat-copy": route({ apiKeyEnv: "PREVIEW_CHAT_API_KEY" }),
  };
  const target = keyRenameTarget("preview-chat", providers, "PREVIEW_CHAT_KEY_V2");
  assert.deepEqual(target, { oldRef: "", newRef: "PREVIEW_CHAT_KEY_V2", changed: false });
  assert.equal(
    keyRenameState({ ...target, status: "ready", configured: true, writable: true }),
    KEY_RENAME_STATE.unchanged,
  );
});

test("只有 movable 才真的调用 credentials.unset", () => {
  assert.equal(keyRenameRemovesOldKey(KEY_RENAME_STATE.movable), true);
  for (const state of [
    KEY_RENAME_STATE.unchanged,
    KEY_RENAME_STATE.absent,
    KEY_RENAME_STATE.shared,
    KEY_RENAME_STATE.readonly,
    KEY_RENAME_STATE.unknown,
  ]) {
    assert.equal(keyRenameRemovesOldKey(state), false, `${state} 不发 unset`);
  }
  assert.equal(keyRenameRemovesOldKey(undefined), false);
});

// ── 确认弹窗文案 ────────────────────────────────────────────────────────

test("确认弹窗：标题点名旧 / 新引用名，正文说明会删旧密钥且新引用还没配置", () => {
  const copy = describeKeyRenameDialog({ oldRef: "RELAY_API_KEY", newRef: "RELAY_KEY_V2" });
  assert.equal(copy.title, "把密钥引用从 RELAY_API_KEY 改为 RELAY_KEY_V2？");
  assert.equal(
    copy.body,
    "保存后会删除旧密钥 RELAY_API_KEY，且无法恢复。新引用 RELAY_KEY_V2 还没有配置密钥，保存后需要重新填写。",
  );
  assert.match(copy.hint, /先删除旧密钥.*成功后才写入新的引用名.*删除失败会中止保存/);
  assert.equal(copy.confirmLabel, "保存并删除旧密钥");
});

test("确认弹窗：引用名按 credentialRefOf 归一化（首尾空白不算名字的一部分）", () => {
  const copy = describeKeyRenameDialog({ oldRef: "  RELAY_API_KEY  ", newRef: "  RELAY_KEY_V2  " });
  assert.equal(copy.title, "把密钥引用从 RELAY_API_KEY 改为 RELAY_KEY_V2？");
  assert.doesNotMatch(copy.body, /  RELAY/);
});

test("确认弹窗：只出现引用名，不出现任何密钥内容字段", () => {
  const copy = describeKeyRenameDialog({
    oldRef: "RELAY_API_KEY",
    newRef: "RELAY_KEY_V2",
    // 宿主 / 调用方即使误传密钥内容，也不应出现在文案里。
    value: "sk-live-secret",
    secret: "sk-live-secret",
  });
  const text = `${copy.title}\n${copy.body}\n${copy.hint}\n${copy.confirmLabel}`;
  assert.match(text, /RELAY_API_KEY/);
  assert.match(text, /RELAY_KEY_V2/);
  assert.doesNotMatch(text, /sk-live-secret/);
});

test("确认弹窗：缺旧 / 新引用名时仍给出可读文案", () => {
  const copy = describeKeyRenameDialog({});
  assert.equal(copy.title, "把密钥引用从  改为 ？");
  assert.match(copy.body, /保存后会删除旧密钥 ，且无法恢复/);
});
