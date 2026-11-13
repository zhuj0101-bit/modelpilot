// P0-02：Remote 注册形态测试（不发起宿主 RPC）。
// 在不启动宿主的情况下验证 docs/p0-evidence-notes.md N1 与 B1 §2 中的
// 三个关键事实：
//   1. TypertRemoteService 产出冻结的 typertRemote 绑定
//      {service, serviceKey, namespace}，其中 namespace = "modelAssistant"；
//   2. @Remote("echo") 注册一个方法标记，可通过 remoteMethods() 读取，
//      且 method/exportName 正确；
//   3. 规范端点是 "modelAssistant/echo"（endpointOf(ns, method)）。

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const importLocal = (p) => import(pathToFileURL(p).href);

// typert-protocol + cordis 取自本仓库的 node_modules（peer 范围解析到
// 0.2.0-rc.2）。导入纪律：服务模块与测试必须共享同一个模块域，否则
// RemoteError 的 instanceof 判断会分裂。宿主磁盘上的 hostRequire 只用于
// semver 矩阵（N7），而那部分不依赖模块域。
const repoRequire = createRequire(pathToFileURL(join(root, "lib", "index.js")).href);
const { RemoteError, TypertRemoteService, remoteMethods, bindTypertRemote } = repoRequire(
  "@deepseek-ai/dsh-typert-protocol",
);

const { ModelAssistantService, REMOTE_NAMESPACE } = await importLocal(
  join(root, "lib", "model-assistant-service.js"),
);

/** 真正的 cordis Context（官方 SDK）：Service 构造需要真实的 fiber/reflect
 * 树，手写的替身是错的。`llm` 作为正式服务注入。`makeCtx` 是异步的，因为
 * cordis 插件 fiber 异步解析（插件回调不会同步执行）。 */
const { Context } = repoRequire("@deepseek-ai/cordis");

async function makeCtx({ llm } = {}) {
  const root = new Context();
  const holder = { rawCtx: void 0 };
  root.plugin(function (ctx) {
    if (llm !== void 0) ctx.provide("llm", llm);
  });
  await root.plugin(function (ctx) {
    holder.rawCtx = ctx;
    if (llm !== void 0) ctx.inject(["llm"], () => {});
  });
  if (holder.rawCtx === void 0) throw new Error("plugin ctx never materialized");
  return new Proxy(holder, {
    get(target, prop) {
      if (prop === "llm") return llm; // 注入值，无需访问 cordis
      return target.rawCtx[prop];
    },
  });
}

test("绑定：namespace=modelAssistant，冻结的 {service, serviceKey, namespace}", async () => {
  const ctx = await makeCtx();
  const service = new ModelAssistantService(ctx);
  const binding = service.typertRemote;
  assert.ok(binding, "typertRemote binding exists");
  assert.equal(binding.namespace, REMOTE_NAMESPACE);
  assert.equal(binding.namespace, "modelAssistant");
  assert.equal(binding.serviceKey, REMOTE_NAMESPACE);
  assert.equal(binding.service, service);
  assert.ok(Object.isFrozen(binding), "binding is frozen (bindTypertRemote contract)");
});

test("标记：remoteMethods() 通过 @Remote 暴露 echo", async () => {
  const ctx = await makeCtx();
  const service = new ModelAssistantService(ctx);
  const methods = remoteMethods(service);
  const echo = methods.find((m) => m.method === "echo");
  assert.ok(echo, "echo marker registered");
  assert.equal(echo.exportName ?? echo.method, "echo");
  const listTargets = methods.find((m) => m.method === "listTargets");
  assert.ok(listTargets, "listTargets marker registered");
});

test("端点：modelAssistant/echo 是规范端点", async () => {
  // 依 gateway L568，endpointOf(namespace, method): `<namespace>/<method>`。
  const ctx = await makeCtx();
  const service = new ModelAssistantService(ctx);
  const endpoint = `${service.typertRemote.namespace}/echo`;
  assert.equal(endpoint, "modelAssistant/echo");
});

test("能力：探测驱动的版本能力（2 参 vs 3 参 prepareCall）", async () => {
  const twoArg = { prepareCall: (config, signal) => {} };
  const threeArg = { prepareCall: (config, signal, configure) => {} };
  const ctx2 = await makeCtx({ llm: twoArg });
  const ctx3 = await makeCtx({ llm: threeArg });
  const s2 = new ModelAssistantService(ctx2);
  const s3 = new ModelAssistantService(ctx3);
  const r2 = await s2.echo({ message: "x" });
  const r3 = await s3.echo({ message: "x" });
  assert.deepEqual(r2.caps, { supportsConfigure: false, nativeReasoningEditing: false, probeArgs: 2 });
  assert.deepEqual(r3.caps, { supportsConfigure: true, nativeReasoningEditing: true, probeArgs: 3 });
  // 缺少 llm → 全 false 能力，绝不抛错（B1 保守默认）。
  const r0 = await new ModelAssistantService(await makeCtx()).echo({ message: "x" });
  assert.equal(r0.caps.supportsConfigure, false);
});

test("错误：带稳定错误码的 RemoteError，按 code 判别", async () => {
  const service = new ModelAssistantService(await makeCtx());
  // 只按 code 判别（B1 §2.5 设计规则；同样跨域可靠 ——
  // 结构标记 isDSHRemoteError=true 才是跨域的身份标识）。
  let caught;
  try {
    service.echo({ message: "" });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "sync throw expected");
  console.log("[diag] ctor:", caught?.constructor?.name, "| code:", caught?.code, "| isDSH:", caught?.isDSHRemoteError);
  assert.equal(caught.isDSHRemoteError, true);
  assert.equal(caught.code, "modelAssistant/invalid-request");
  await assert.rejects(
    async () => service.echo({ message: "x", delayMs: -1 }),
    (error) => error.code === "modelAssistant/invalid-request",
  );
  await assert.rejects(
    async () => service.listTargets(),
    (error) => error.code === "modelAssistant/not-implemented",
  );
});

test("取消探测：长 echo 遵守已中止的信号（OQ-B1-2 形态）", async () => {
  const service = new ModelAssistantService(await makeCtx());
  const controller = new AbortController();
  controller.abort();
  const result = await service.echo({ message: "x", delayMs: 5000 }, controller.signal);
  assert.equal(result.cancelled, true);
  // 而没有任何信号时，长 echo 正常返回（尽力而为）。
  const normal = await service.echo({ message: "x", delayMs: 20 });
  assert.equal(normal.cancelled, false);
});

test("bindTypertRemote 直连形态一致性（宿主函数，与类无关）", async () => {
  const ctx = await makeCtx();
  const fakeService = { ctx, name: "modelAssistant" };
  const binding = bindTypertRemote(fakeService, "modelAssistant");
  assert.deepEqual(Object.keys(binding).sort(), ["namespace", "service", "serviceKey"]);
  assert.equal(binding.namespace, "modelAssistant");
});
