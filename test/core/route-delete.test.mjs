// 工单 #26：删除路由时清理密钥的纯规则测试。
//
// 这里不碰浏览器：引用名从哪来、什么情况不删、弹窗在每种状态下说什么，
// 都是应该先在纯层钉死的规则；真实 DOM 下的点击顺序与 confirm 按钮状态
// 在 test/client/route-delete.test.mjs。

import test from "node:test";
import assert from "node:assert/strict";
import {
  ROUTE_DELETE_KEY_STATE,
  buildRouteDeleteTarget,
  describeRouteDeleteDialog,
  routeDeleteKeyState,
  routeDeleteRemovesKey,
  routesSharingKeyRef,
} from "../../src/core/route-delete.js";

const route = (overrides = {}) => ({ api: "openai-completions", models: [], ...overrides });

const probe = (overrides = {}) => ({
  ref: "PREVIEW_CHAT_API_KEY",
  status: "ready",
  configured: false,
  writable: true,
  sharedBy: [],
  ...overrides,
});

// ── 引用名与共用关系 ───────────────────────────────────────────────────

test("删除目标：引用名取 apiKeyEnv（去首尾空白），为空才回落 deriveKeyRef(routeId)", () => {
  assert.equal(
    buildRouteDeleteTarget("preview-chat", {
      "preview-chat": route({ apiKeyEnv: "  CUSTOM_KEY  " }),
    }).ref,
    "CUSTOM_KEY",
  );
  assert.equal(
    buildRouteDeleteTarget("preview-chat", { "preview-chat": route() }).ref,
    "PREVIEW_CHAT_API_KEY",
  );
  assert.equal(
    buildRouteDeleteTarget("preview-chat", { "preview-chat": route({ apiKeyEnv: "   " }) }).ref,
    "PREVIEW_CHAT_API_KEY",
  );
});

test("删除目标：模型数来自 models 数组；路由不存在时按 0 且不抛错", () => {
  const providers = {
    "preview-chat": route({ models: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
    "beta-relay": route({ models: [{ id: "d" }] }),
  };
  assert.equal(buildRouteDeleteTarget("preview-chat", providers).modelCount, 3);
  assert.equal(buildRouteDeleteTarget("beta-relay", providers).modelCount, 1);
  assert.equal(buildRouteDeleteTarget("gone", providers).modelCount, 0);
  assert.equal(buildRouteDeleteTarget("preview-chat", undefined).modelCount, 0);
});

test("共用：另一条路由声明同一个 apiKeyEnv → 列出该路由，字母序", () => {
  const providers = {
    "preview-chat": route({ apiKeyEnv: "SHARED_API_KEY" }),
    zeta: route({ apiKeyEnv: "SHARED_API_KEY" }),
    alpha: route({ apiKeyEnv: "  SHARED_API_KEY  " }),
    other: route({ apiKeyEnv: "OTHER_API_KEY" }),
  };
  assert.deepEqual(routesSharingKeyRef("preview-chat", providers, "SHARED_API_KEY"), ["alpha", "zeta"]);
  assert.deepEqual(buildRouteDeleteTarget("preview-chat", providers).sharedBy, ["alpha", "zeta"]);
});

test("共用：派生引用名同样算共用；自己不算", () => {
  const providers = {
    "preview-chat": route(),
    "preview-chat-copy": route({ apiKeyEnv: "PREVIEW_CHAT_API_KEY" }),
    "beta-relay": route(),
  };
  assert.deepEqual(buildRouteDeleteTarget("preview-chat", providers).sharedBy, ["preview-chat-copy"]);
  assert.deepEqual(buildRouteDeleteTarget("beta-relay", providers).sharedBy, []);
});

test("共用只做精确相等：前缀相同的另一个引用名不算共用（不做通配 / 前缀匹配）", () => {
  const providers = {
    "preview-chat": route({ apiKeyEnv: "PREVIEW_CHAT_API_KEY" }),
    prefix: route({ apiKeyEnv: "PREVIEW_CHAT_API_KEY_2" }),
    suffixed: route({ apiKeyEnv: "MY_PREVIEW_CHAT_API_KEY" }),
  };
  assert.deepEqual(buildRouteDeleteTarget("preview-chat", providers).sharedBy, []);
  assert.deepEqual(routesSharingKeyRef("preview-chat", providers, ""), []);
});

// ── 状态判定 ────────────────────────────────────────────────────────────

test("状态：还没查 / 正在查 → checking（确认按钮此时必须禁用）", () => {
  assert.equal(routeDeleteKeyState(probe({ status: "idle", configured: true })), ROUTE_DELETE_KEY_STATE.checking);
  assert.equal(routeDeleteKeyState(probe({ status: "loading", configured: true })), ROUTE_DELETE_KEY_STATE.checking);
  assert.equal(routeDeleteKeyState({ ref: "X_API_KEY" }), ROUTE_DELETE_KEY_STATE.checking);
});

test("状态：已配置 / 未配置 / 读失败三态严格分开", () => {
  assert.equal(routeDeleteKeyState(probe({ configured: true })), ROUTE_DELETE_KEY_STATE.configured);
  assert.equal(routeDeleteKeyState(probe({ configured: false })), ROUTE_DELETE_KEY_STATE.absent);
  assert.equal(routeDeleteKeyState(probe({ status: "error", error: "boom" })), ROUTE_DELETE_KEY_STATE.unknown);
  assert.notEqual(
    routeDeleteKeyState(probe({ status: "error" })),
    routeDeleteKeyState(probe({ configured: false })),
    "读不到不等于没有密钥",
  );
});

test("状态：被别的路由共用 → shared，即使可写也不删", () => {
  assert.equal(
    routeDeleteKeyState(probe({ configured: true, writable: true, sharedBy: ["zeta"] })),
    ROUTE_DELETE_KEY_STATE.shared,
  );
  // 共用优先于只读：先说清「为什么保留」。
  assert.equal(
    routeDeleteKeyState(probe({ configured: true, writable: false, sharedBy: ["zeta"] })),
    ROUTE_DELETE_KEY_STATE.shared,
  );
});

test("状态：环境变量提供的密钥（writable: false）→ readonly，不尝试删除", () => {
  assert.equal(
    routeDeleteKeyState(probe({ configured: true, writable: false })),
    ROUTE_DELETE_KEY_STATE.readonly,
  );
});

test("状态：引用名为空 → absent（没有可删的对象），不发 unset", () => {
  assert.equal(routeDeleteKeyState(probe({ ref: "" })), ROUTE_DELETE_KEY_STATE.absent);
  assert.equal(routeDeleteRemovesKey(ROUTE_DELETE_KEY_STATE.absent), false);
});

test("只有 configured 才真的调用 credentials.unset", () => {
  assert.equal(routeDeleteRemovesKey(ROUTE_DELETE_KEY_STATE.configured), true);
  for (const state of [
    ROUTE_DELETE_KEY_STATE.checking,
    ROUTE_DELETE_KEY_STATE.absent,
    ROUTE_DELETE_KEY_STATE.shared,
    ROUTE_DELETE_KEY_STATE.readonly,
    ROUTE_DELETE_KEY_STATE.unknown,
  ]) {
    assert.equal(routeDeleteRemovesKey(state), false, `${state} 不发 unset`);
  }
});

// ── 弹窗文案 ────────────────────────────────────────────────────────────

test("无密钥文案：正文写明移除全部配置（N 个模型）且没有存储的密钥，按钮「删除路由」", () => {
  const copy = describeRouteDeleteDialog({
    routeId: "test-relay",
    modelCount: 3,
    ref: "TEST_RELAY_API_KEY",
    keyState: ROUTE_DELETE_KEY_STATE.absent,
  });
  assert.equal(copy.title, "删除路由「test-relay」？");
  assert.equal(copy.body, "这会移除该路由的全部配置（3 个模型）。它没有存储的密钥。");
  assert.equal(copy.confirmLabel, "删除路由");
  assert.equal(copy.confirmDisabled, false);
  assert.ok(copy.hint.length > 0);
});

test("有密钥文案：正文写明一并删除 REF 且无法恢复，按钮「删除路由和密钥」", () => {
  const copy = describeRouteDeleteDialog({
    routeId: "test-relay",
    modelCount: 3,
    ref: "TEST_RELAY_API_KEY",
    keyState: ROUTE_DELETE_KEY_STATE.configured,
  });
  assert.equal(copy.title, "删除路由「test-relay」？");
  assert.equal(
    copy.body,
    "这会移除该路由的全部配置（3 个模型），并一并删除存储的密钥 TEST_RELAY_API_KEY。密钥删除后无法恢复。",
  );
  assert.equal(copy.confirmLabel, "删除路由和密钥");
  assert.equal(copy.confirmDisabled, false);
});

test("共用文案：正文写明密钥仍被其他路由使用、将保留，按钮「删除路由」", () => {
  const copy = describeRouteDeleteDialog({
    routeId: "test-relay",
    modelCount: 2,
    ref: "SHARED_API_KEY",
    keyState: ROUTE_DELETE_KEY_STATE.shared,
    sharedBy: ["beta-relay", "gamma-relay"],
  });
  assert.match(copy.body, /移除该路由的全部配置（2 个模型）/);
  assert.match(copy.body, /密钥 SHARED_API_KEY 仍被其他路由使用（beta-relay、gamma-relay），将保留/);
  assert.equal(copy.confirmLabel, "删除路由");
  assert.doesNotMatch(copy.body, /一并删除/);
});

test("只读文案：正文写明密钥由环境变量提供、不可删除，按钮「删除路由」", () => {
  const copy = describeRouteDeleteDialog({
    routeId: "test-relay",
    modelCount: 1,
    ref: "ENV_KEY",
    keyState: ROUTE_DELETE_KEY_STATE.readonly,
  });
  assert.match(copy.body, /密钥 ENV_KEY 由环境变量提供，不可从此处删除，将保留/);
  assert.equal(copy.confirmLabel, "删除路由");
});

test("读取中文案：正文写「正在检查是否存在存储的密钥…」，确认按钮禁用", () => {
  const copy = describeRouteDeleteDialog({
    routeId: "test-relay",
    modelCount: 3,
    ref: "TEST_RELAY_API_KEY",
    keyState: ROUTE_DELETE_KEY_STATE.checking,
  });
  assert.match(copy.body, /这会移除该路由的全部配置（3 个模型），正在检查是否存在存储的密钥…/);
  assert.equal(copy.confirmDisabled, true);
  assert.equal(copy.confirmLabel, "删除路由");
});

test("读取失败文案：正文写「无法确认是否存在存储的密钥」，只删配置并附提示", () => {
  const copy = describeRouteDeleteDialog({
    routeId: "test-relay",
    modelCount: 3,
    ref: "TEST_RELAY_API_KEY",
    keyState: ROUTE_DELETE_KEY_STATE.unknown,
  });
  assert.match(copy.body, /无法确认是否存在存储的密钥，因此只会删除配置/);
  assert.match(copy.hint, /TEST_RELAY_API_KEY 可能仍保留在宿主的凭据存储中/);
  assert.equal(copy.confirmLabel, "删除路由");
  assert.equal(copy.confirmDisabled, false);
});

test("读取失败文案：提示行带上宿主失败原因，便于排查", () => {
  const copy = describeRouteDeleteDialog({
    routeId: "test-relay",
    modelCount: 1,
    ref: "TEST_RELAY_API_KEY",
    keyState: ROUTE_DELETE_KEY_STATE.unknown,
    error: "凭据服务不可用",
  });
  assert.match(copy.hint, /密钥 TEST_RELAY_API_KEY 可能仍保留在宿主的凭据存储中（凭据服务不可用）/);
  const withoutReason = describeRouteDeleteDialog({
    routeId: "test-relay",
    modelCount: 1,
    ref: "TEST_RELAY_API_KEY",
    keyState: ROUTE_DELETE_KEY_STATE.unknown,
  });
  assert.doesNotMatch(withoutReason.hint, /（）/);
});

test("弹窗文案只出现引用名，不出现任何密钥内容字段", () => {
  const copy = describeRouteDeleteDialog({
    routeId: "test-relay",
    modelCount: 3,
    ref: "TEST_RELAY_API_KEY",
    keyState: ROUTE_DELETE_KEY_STATE.configured,
    // 宿主 / 调用方即使误传密钥内容，也不应出现在文案里。
    value: "sk-live-secret",
    secret: "sk-live-secret",
  });
  const text = `${copy.title}\n${copy.body}\n${copy.hint}\n${copy.confirmLabel}`;
  assert.match(text, /TEST_RELAY_API_KEY/);
  assert.doesNotMatch(text, /sk-live-secret/);
});

test("文案容错：缺 routeId / modelCount / keyState 时仍给出可读文案", () => {
  const copy = describeRouteDeleteDialog({});
  assert.equal(copy.title, "删除路由「」？");
  assert.equal(copy.body, "这会移除该路由的全部配置（0 个模型）。它没有存储的密钥。");
  assert.equal(copy.confirmLabel, "删除路由");
});
