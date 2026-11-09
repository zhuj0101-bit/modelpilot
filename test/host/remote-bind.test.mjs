// P0-02: Remote registration shape tests (no host RPC).
// Verifies the three load-bearing facts from docs/p0-evidence-notes.md N1 and
// B1 §2 without booting a host:
//   1. TypertRemoteService produces the frozen typertRemote binding
//      {service, serviceKey, namespace} with namespace = "modelAssistant";
//   2. @Remote("echo") registers a method marker readable via remoteMethods()
//      with the right method/exportName;
//   3. the canonical endpoint is "modelAssistant/echo" (endpointOf(ns, method)).

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const importLocal = (p) => import(pathToFileURL(p).href);

// typert-protocol + cordis from THIS repo's node_modules (peer range
// resolves to 0.2.0-rc.2). Import discipline: the service module and the
// tests must share one module realm, or RemoteError instanceof checks split.
// F-disk hostRequire is only for the semver matrix (N7), which is realm-free.
const repoRequire = createRequire(pathToFileURL(join(root, "lib", "index.js")).href);
const { RemoteError, TypertRemoteService, remoteMethods, bindTypertRemote } = repoRequire(
  "@deepseek-ai/dsh-typert-protocol",
);

const { ModelAssistantService, REMOTE_NAMESPACE } = await importLocal(
  join(root, "lib", "model-assistant-service.js"),
);

/** Real cordis Context (official SDK): Service construction needs a genuine
 * fiber/reflect tree, so a hand-rolled double is wrong. `llm` is provided as
 * a proper service. `makeCtx` is async because cordis plugin fibers resolve
 * asynchronously (the plugin callback does not run synchronously). */
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
      if (prop === "llm") return llm; // injected value, no cordis access needed
      return target.rawCtx[prop];
    },
  });
}

test("binding: namespace=modelAssistant, frozen {service, serviceKey, namespace}", async () => {
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

test("markers: remoteMethods() exposes echo via @Remote", async () => {
  const ctx = await makeCtx();
  const service = new ModelAssistantService(ctx);
  const methods = remoteMethods(service);
  const echo = methods.find((m) => m.method === "echo");
  assert.ok(echo, "echo marker registered");
  assert.equal(echo.exportName ?? echo.method, "echo");
  const listTargets = methods.find((m) => m.method === "listTargets");
  assert.ok(listTargets, "listTargets marker registered");
});

test("endpoint: modelAssistant/echo is the canonical endpoint", async () => {
  // endpointOf(namespace, method) per gateway L568: `<namespace>/<method>`.
  const ctx = await makeCtx();
  const service = new ModelAssistantService(ctx);
  const endpoint = `${service.typertRemote.namespace}/echo`;
  assert.equal(endpoint, "modelAssistant/echo");
});

test("caps: probe-driven version capabilities (2-arg vs 3-arg prepareCall)", async () => {
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
  // Absent llm → all-false caps, never throws (B1 conservative default).
  const r0 = await new ModelAssistantService(await makeCtx()).echo({ message: "x" });
  assert.equal(r0.caps.supportsConfigure, false);
});

test("errors: RemoteError with stable codes, discriminated by code", async () => {
  const service = new ModelAssistantService(await makeCtx());
  // Discriminate by code only (B1 §2.5 design rule; also realm-proof — the
  // structural marker isDSHRemoteError=true is the cross-realm identity).
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

test("cancellation probe: long echo honours an already-aborted signal (OQ-B1-2 shape)", async () => {
  const service = new ModelAssistantService(await makeCtx());
  const controller = new AbortController();
  controller.abort();
  const result = await service.echo({ message: "x", delayMs: 5000 }, controller.signal);
  assert.equal(result.cancelled, true);
  // And without any signal the long echo resolves normally (best-effort).
  const normal = await service.echo({ message: "x", delayMs: 20 });
  assert.equal(normal.cancelled, false);
});

test("bindTypertRemote direct-shape parity (host function, independent of class)", async () => {
  const ctx = await makeCtx();
  const fakeService = { ctx, name: "modelAssistant" };
  const binding = bindTypertRemote(fakeService, "modelAssistant");
  assert.deepEqual(Object.keys(binding).sort(), ["namespace", "service", "serviceKey"]);
  assert.equal(binding.namespace, "modelAssistant");
});
