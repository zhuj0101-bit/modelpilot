// 工单 #18：路由设置卡片里的 API key 管理（真实 DOM / headless Chrome）。
//
// 在 light / dark 两套宿主 token 下渲染打包后的 lib/client.js，逐条验收：
// 状态行、设置 / 更换 / 清除、password 输入、逐字节 set、重新 describe、
// settingsOps 不含密钥、只读禁用、失败保留输入、圆点双重编码。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome, runPageProbe } from "./layout-harness.mjs";
import { buildApiKeyHtml } from "./api-key-harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const bundle = readFileSync(join(root, "lib", "client.js"), "utf8");
const chrome = findChrome();
const probes = new Map();

function probe(scheme) {
  if (!probes.has(scheme)) {
    probes.set(scheme, runPageProbe(chrome, buildApiKeyHtml(bundle, scheme)));
  }
  return probes.get(scheme);
}

for (const scheme of ["light", "dark"]) {
  test(`${scheme} 主题：apiKeyEnv 为空 → 状态行说明无法管理密钥，且不给任何写按钮`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.empty.inputValue, "", "建议不自动填");
    assert.equal(result.empty.status, "密钥状态 未设置引用名，无法管理密钥");
    assert.equal(result.empty.hasSet, false);
    assert.equal(result.empty.hasReplace, false);
    assert.equal(result.empty.hasClear, false);
    assert.equal(result.empty.hasPassword, false);
  });

  test(`${scheme} 主题：空引用时显示派生建议与 placeholder，点「采用」才填入`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.empty.placeholder, "PREVIEW_CHAT_API_KEY", "placeholder 用派生建议");
    assert.match(result.empty.suggestion, /建议：\s*PREVIEW_CHAT_API_KEY/);
    assert.equal(result.adopted.value, "PREVIEW_CHAT_API_KEY", "点采用后填入");
    assert.deepEqual(result.adopted.lastDescribe, ["PREVIEW_CHAT_API_KEY"], "按新引用重新 describe");
    assert.match(result.adopted.status, /● 已配置/);
    assert.equal(result.adopted.hasReplace, true);
    assert.equal(result.adopted.hasClear, true);
    assert.equal(result.adopted.hasSet, false);
  });

  test(`${scheme} 主题：点「更换」展开 type=password / aria-label=密钥值 的输入，空值不能保存`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.editor.type, "password");
    assert.equal(result.editor.ariaLabel, "密钥值");
    assert.equal(result.editor.saveDisabledWhenEmpty, true);
    assert.equal(result.editor.hint, true, "说明密钥只写入宿主凭据存储");
  });

  test(`${scheme} 主题：保存后立即重新 describe 并显示已配置，输入原样交给 set（不 trim）`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.saved.setCalls.length, 1);
    assert.equal(result.saved.setCalls[0].ref, "PREVIEW_CHAT_API_KEY");
    assert.equal(result.saved.setCalls[0].value, "  sk-live-Exact  ", "首尾空格必须保留");
    assert.equal(result.saved.valueExact, true);
    assert.match(result.saved.status, /● 已配置/);
    assert.equal(result.saved.editorClosed, true);
    assert.deepEqual(result.saved.lastDescribe, ["PREVIEW_CHAT_API_KEY"], "保存后重新 describe");
    assert.equal(result.saved.hasReplace, true);
    assert.equal(result.saved.hasClear, true);
  });

  test(`${scheme} 主题：密钥不进入 settingsOps，也不进 localStorage / sessionStorage`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.saved.secretInBodyText, false);
    assert.equal(result.saved.secretInStorage, false);
    assert.equal(result.ops.previewContainsSecret, false, "ops 预览不含密钥");
    assert.equal(result.ops.containsSecret, false, "mutate 收到的所有 op 都不含密钥");
    assert.deepEqual(
      result.ops.lastOps.map((op) => op.path),
      [
        ["providers", "preview-chat", "baseURL"],
        ["providers", "preview-chat", "apiKeyEnv"],
      ],
      "只有路由字段的叶子 set",
    );
  });

  test(`${scheme} 主题：改 apiKeyEnv → 状态行显示新 ref 的状态，而不是旧 ref 的`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.changedRef.lastDescribe, ["MISSING_API_KEY"]);
    assert.match(result.changedRef.status, /○ 未配置/, "新引用未配置");
    assert.equal(result.changedRef.hasSet, true);
    assert.equal(result.changedRef.hasReplace, false);
    assert.equal(result.changedRef.hasClear, false);
  });

  test(`${scheme} 主题：取消编辑不调用 set，也不保留输入`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.cancelled.setCalls, 1, "取消不应新增 set");
    assert.equal(result.cancelled.editorClosed, true);
  });

  test(`${scheme} 主题：未配置 → 设置 → 保存 → 已配置，set 仍逐字节一致`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.deepEqual(result.secondSave.lastSet, ["MISSING_API_KEY", "  key-two  "]);
    assert.equal(result.secondSave.valueExact, true);
    assert.match(result.secondSave.status, /● 已配置/);
    assert.equal(result.secondSave.hasClear, true);
  });

  test(`${scheme} 主题：清除是二次确认（自绘弹窗），确认后调用 unset 并刷新状态`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.clearDialog.open, true);
    assert.match(result.clearDialog.text, /MISSING_API_KEY/);
    assert.match(result.clearDialog.text, /不能撤销/);
    assert.equal(result.clearDialog.confirmLabel, "清除");
    assert.equal(result.clearDialog.cancelLabel, "取消");
    assert.equal(result.clearDialog.cancelled, true);
    assert.equal(result.clearDialog.unsetAfterCancel, 0, "取消不调用 unset");
    assert.deepEqual(result.cleared.unsetCalls, ["MISSING_API_KEY"]);
    assert.equal(result.cleared.dialogClosed, true);
    assert.match(result.cleared.status, /○ 未配置/);
    assert.equal(result.cleared.hasSet, true);
    assert.equal(result.cleared.hasClear, false);
  });

  test(`${scheme} 主题：writable:false → 更换 / 清除禁用，文案写明环境变量提供`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.match(
      result.readOnly.status,
      /^密钥状态 ● 已配置（由环境变量提供，不可从此处修改）/,
    );
    assert.equal(result.readOnly.hasReplace, true);
    assert.equal(result.readOnly.replaceDisabled, true);
    assert.equal(result.readOnly.hasClear, true);
    assert.equal(result.readOnly.clearDisabled, true);
    assert.equal(result.readOnly.hasSet, false);
    assert.equal(result.readOnly.hasPassword, false, "禁用时不能展开输入");
  });

  test(`${scheme} 主题：writable:false 且未配置 → 设置禁用，文案同样说明来源`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.match(
      result.readOnlyMissing.status,
      /^密钥状态 ○ 未配置（由环境变量提供，不可从此处修改）/,
    );
    assert.equal(result.readOnlyMissing.hasSet, true);
    assert.equal(result.readOnlyMissing.setDisabled, true);
    assert.equal(result.readOnlyMissing.hasReplace, false);
    assert.equal(result.readOnlyMissing.hasClear, false);
  });

  test(`${scheme} 主题：保存失败 → 显示错误、状态不变、输入保留`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.match(result.failed.status, /○ 未配置/, "失败不能把状态改成已配置");
    assert.match(result.failed.error, /凭据存储拒绝写入/);
    assert.equal(result.failed.inputValue, "sk-fail-value", "失败不清空输入");
    assert.equal(result.failed.editorStillOpen, true);
    assert.equal(result.failed.hasReplace, false);
    assert.deepEqual(result.failed.setCalls, ["PREVIEW_CHAT_API_KEY", "MISSING_API_KEY", "FAILING_API_KEY"]);
  });

  test(`${scheme} 主题：宿主错误消息回显输入时，界面也抹掉明文`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.match(result.echoedError.status, /○ 未配置/, "失败不能改状态");
    assert.match(result.echoedError.error, /\[已隐藏\]/);
    assert.doesNotMatch(result.echoedError.error, /sk-echo-secret/);
    assert.equal(result.echoedError.inputValue, "sk-echo-secret", "输入仍保留给用户重试");
    assert.equal(result.echoedError.bodyHasSecret, false, "页面可见文字不回显明文");
  });

  test(`${scheme} 主题：describe 失败 → 显示错误且不暴露写按钮`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    assert.equal(result.describeError.status, "密钥状态 密钥状态读取失败");
    assert.match(result.describeError.error, /凭据服务不可用/);
    assert.equal(result.describeError.hasSet, false);
    assert.equal(result.describeError.hasReplace, false);
    assert.equal(result.describeError.hasClear, false);
  });

  test(`${scheme} 主题：已配置 / 未配置圆点用形状（● / ○）与颜色双重编码`, async (t) => {
    if (chrome === null) return t.skip("未找到 Chrome/Chromium，跳过真实 DOM 测试");
    const result = await probe(scheme);
    const on = result.saved.dot;
    const off = result.changedRef.dot;
    assert.equal(on.glyph, "●", "已配置是实心圆");
    assert.equal(off.glyph, "○", "未配置是空心圆");
    assert.notEqual(on.background, off.background, "两种状态的底色不同");
    assert.notEqual(on.borderColor, off.borderColor, "两种状态的描边色不同");
    assert.ok(!on.background.includes("0, 0, 0, 0"), "已配置圆点有实色底");
    assert.ok(off.background.includes("0, 0, 0, 0"), "未配置圆点无底色");
  });
}
