// 工单 #18：API key 管理的纯规则测试（派生引用名 / 有效引用名 / 状态文案）。

import test from "node:test";
import assert from "node:assert/strict";
import {
  CREDENTIAL_TEXT,
  credentialRefOf,
  credentialView,
  deriveKeyRef,
} from "../../src/core/api-key.js";

test("deriveKeyRef 与内置模型页同规则：preview-chat → PREVIEW_CHAT_API_KEY", () => {
  assert.equal(deriveKeyRef("preview-chat"), "PREVIEW_CHAT_API_KEY");
  assert.equal(deriveKeyRef("deepseek"), "DEEPSEEK_API_KEY");
});

test("deriveKeyRef 对真实路由名逐字复刻内置 deriveKeyRef", () => {
  // 内置页原文：`${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`
  const builtinDerive = (provider) => `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
  for (const provider of [
    "preview-chat",
    "openrouter",
    "my-gateway-2",
    "llm_tech",
    "a.b.c",
    "route--x",
    "9provider",
  ]) {
    assert.equal(deriveKeyRef(provider), builtinDerive(provider), provider);
  }
});

test("deriveKeyRef 把非字母数字折叠成单个下划线", () => {
  assert.equal(deriveKeyRef("My--Route.v2"), "MY_ROUTE_V2_API_KEY");
  assert.equal(deriveKeyRef("  spaced  route  "), "SPACED_ROUTE_API_KEY");
  assert.equal(deriveKeyRef("route_2"), "ROUTE_2_API_KEY");
});

test("deriveKeyRef 空引用不造出 _API_KEY", () => {
  assert.equal(deriveKeyRef(""), "");
  assert.equal(deriveKeyRef("   "), "");
  assert.equal(deriveKeyRef(undefined), "");
  assert.equal(deriveKeyRef(42), "");
});

test("credentialRefOf 去掉输入噪声的空白；空白串等于未设置", () => {
  assert.equal(credentialRefOf("  PREVIEW_CHAT_API_KEY  "), "PREVIEW_CHAT_API_KEY");
  assert.equal(credentialRefOf(""), "");
  assert.equal(credentialRefOf("   "), "");
  assert.equal(credentialRefOf(undefined), "");
  assert.equal(credentialRefOf(null), "");
});

test("未设置引用名：说明无法管理密钥，且不暴露任何写按钮", () => {
  const view = credentialView({ ref: "", status: "idle" });
  assert.equal(view.kind, "empty");
  assert.equal(view.text, "未设置引用名，无法管理密钥");
  assert.equal(view.showSet, false);
  assert.equal(view.showReplace, false);
  assert.equal(view.showClear, false);
});

test("读取中：显示「正在读取密钥状态…」且不给写按钮", () => {
  for (const status of ["idle", "loading"]) {
    const view = credentialView({ ref: "PREVIEW_CHAT_API_KEY", status });
    assert.equal(view.kind, "loading");
    assert.equal(view.text, CREDENTIAL_TEXT.loading);
    assert.equal(view.showSet, false);
    assert.equal(view.showReplace, false);
    assert.equal(view.showClear, false);
  }
});

test("读取失败：保留宿主原因，且不猜 writable、不给写按钮", () => {
  const view = credentialView({
    ref: "PREVIEW_CHAT_API_KEY",
    status: "error",
    error: "credential provider absent",
  });
  assert.equal(view.kind, "error");
  assert.equal(view.text, CREDENTIAL_TEXT.loadFailed);
  assert.equal(view.error, "credential provider absent");
  assert.equal(view.showSet, false);
  assert.equal(view.showReplace, false);
  assert.equal(view.showClear, false);
});

test("已配置且可写：更换 + 清除，不显示设置", () => {
  const view = credentialView({
    ref: "PREVIEW_CHAT_API_KEY",
    status: "ready",
    configured: true,
    writable: true,
  });
  assert.equal(view.kind, "ready");
  assert.equal(view.configured, true);
  assert.equal(view.readOnly, false);
  assert.equal(view.text, "已配置");
  assert.equal(view.showSet, false);
  assert.equal(view.showReplace, true);
  assert.equal(view.showClear, true);
});

test("未配置且可写：只显示设置", () => {
  const view = credentialView({
    ref: "MISSING_API_KEY",
    status: "ready",
    configured: false,
    writable: true,
  });
  assert.equal(view.text, "未配置");
  assert.equal(view.showSet, true);
  assert.equal(view.showReplace, false);
  assert.equal(view.showClear, false);
});

test("只读部署：文案写明由环境变量提供，按钮保留但由调用方禁用", () => {
  const configured = credentialView({
    ref: "ENV_ONLY_API_KEY",
    status: "ready",
    configured: true,
    writable: false,
  });
  assert.equal(configured.readOnly, true);
  assert.equal(configured.text, "已配置（由环境变量提供，不可从此处修改）");
  assert.equal(configured.showReplace, true);
  assert.equal(configured.showClear, true);

  const missing = credentialView({
    ref: "ENV_ONLY_API_KEY",
    status: "ready",
    configured: false,
    writable: false,
  });
  assert.equal(missing.readOnly, true);
  assert.equal(missing.text, "未配置（由环境变量提供，不可从此处修改）");
  assert.equal(missing.showSet, true);
});

test("writable 缺省按可写处理，避免旧响应把控件误锁死", () => {
  const view = credentialView({ ref: "PREVIEW_CHAT_API_KEY", status: "ready", configured: true });
  assert.equal(view.readOnly, false);
  assert.equal(view.text, "已配置");
});
