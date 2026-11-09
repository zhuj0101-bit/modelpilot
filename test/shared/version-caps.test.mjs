// P0-04: prepareCall dual-track detection (version-capabilities + VerifyTransport).
//
// Facts under test [audit 02-S2]:
//   0.2.0: prepareCall(config, signal)                      → length 2
//   0.2.1: prepareCall(config, signal, configure)           → length 3
// Track A (configure): prepared call is one-shot (INVALID_PREPARED_CALL on
//   second dispatch and on config mutation); configure receives deep-frozen
//   structuredClone of (controls, modelInfo).
// Track B (precheck): resolveCallConfig validates; UNSUPPORTED_REASONING_EFFORT
//   surfaces before any dispatch; explicit stream() is then used.
// Missing/absent runtime → explicit all-false capabilities, never throws.

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const repoRequire = createRequire(pathToFileURL(join(root, "lib", "index.js")).href);
const { LlmError } = repoRequire("@deepseek-ai/dsh-llm");

const caps = await import(pathToFileURL(join(root, "src", "shared", "version-capabilities.js")).href);
const transport = await import(pathToFileURL(join(root, "src", "host", "verify-transport.js")).href);

test("detection matrix: length 2 / 3 / missing / non-function", () => {
  assert.deepEqual(caps.detectVersionCapabilities({ prepareCall: (a, b) => {} }), {
    supportsConfigure: false, probeArgs: 2, nativeReasoningEditing: false,
  });
  assert.deepEqual(caps.detectVersionCapabilities({ prepareCall: (a, b, c) => {} }), {
    supportsConfigure: true, probeArgs: 3, nativeReasoningEditing: true,
  });
  assert.deepEqual(caps.detectVersionCapabilities({}), {
    supportsConfigure: false, probeArgs: 0, nativeReasoningEditing: false,
  });
  assert.deepEqual(caps.detectVersionCapabilities({ prepareCall: "not a function" }), {
    supportsConfigure: false, probeArgs: 0, nativeReasoningEditing: false,
  });
  assert.deepEqual(caps.detectVersionCapabilities(undefined), {
    supportsConfigure: false, probeArgs: 0, nativeReasoningEditing: false,
  });
});

function makeRuntime({ arity, failEffort }) {
  const calls = { prepare: 0, resolve: 0, dispatch: 0, configure: 0 };
  const modelInfo = {
    provider: "pi-ai",
    id: "m1",
    name: "M1",
    context: { contextWindow: 131072 },
    reasoning: { efforts: [{ id: "low" }, { id: "high" }], defaultEffort: "low" },
  };
  const adapterCall = { model: modelInfo, stream: (options) => makeStream(options) };
  const runtime = {};
  const doResolve = (config) => {
    calls.resolve++;
    if (config.reasoningEffort && !["low", "high"].includes(config.reasoningEffort)) {
      throw new LlmError(
        `provider "pi-ai" model "m1" does not support reasoning effort "${config.reasoningEffort}"`,
        "UNSUPPORTED_REASONING_EFFORT",
      );
    }
    const defaulted = config.maxTokens === undefined ? { ...config, maxTokens: 32768 } : config;
    return defaulted;
  };
  if (arity >= 3) {
    runtime.prepareCall = (config, signal, configure) => {
      calls.prepare++;
      let proposed = config;
      if (configure !== undefined) {
        calls.configure++;
        const controls = deepFreeze(structuredClone({ reasoningEffort: config.reasoningEffort, maxTokens: config.maxTokens }));
        const info = deepFreeze(structuredClone(modelInfo));
        proposed = { ...configure(controls, info), provider: config.provider, model: config.model };
      }
      const resolved = doResolve(proposed);
      let dispatched = false;
      return Promise.resolve(Object.freeze({
        config: deepFreeze(structuredClone(resolved)),
        adapterDefaults: deepFreeze({}),
        stream: (options) => {
          calls.dispatch++;
          if (dispatched) throw new LlmError("a prepared LLM call can only be dispatched once", "INVALID_PREPARED_CALL");
          if (JSON.stringify(options) !== JSON.stringify(resolved)) {
            throw new LlmError("prepared LLM call config changed before adapter dispatch", "INVALID_PREPARED_CALL");
          }
          dispatched = true;
          return makeStream(options);
        },
      }));
    };
  } else {
    runtime.prepareCall = (config, signal) => {
      calls.prepare++;
      if (arity === 2) return Promise.resolve({ adapterCall: { ...adapterCall, stream: (o) => { calls.dispatch++; return makeStream(o); } } });
      throw new Error("no adapter");
    };
  }
  runtime.resolveCallConfig = (config) => { calls.resolve++; return Promise.resolve(doResolve(config)); };
  runtime.stream = (options) => { calls.dispatch++; return makeStream(options); };
  runtime.__calls = calls;
  runtime.__modelInfo = modelInfo;
  return runtime;
}

async function* makeStream(options) {
  yield { type: "text", text: "ok:" + (options?.maxTokens ?? "") };
}

function deepFreeze(value) {
  if (value && typeof value === "object") for (const k of Object.keys(value)) deepFreeze(value[k]);
  return Object.freeze(value);
}

test("track A (configure, arity 3): configure called once, frozen inputs, one-shot stream", async () => {
  const runtime = makeRuntime({ arity: 3 });
  const t = transport.createVerifyTransport(runtime);
  assert.equal(t.mode, "configure");
  const result = await t.verify({ provider: "pi-ai", model: "m1", reasoningEffort: "high" });
  assert.equal(runtime.__calls.configure, 1);
  assert.equal(result.fidelity, "driver-confirmed");
  assert.equal(result.config.maxTokens, 32768); // default materialized
  // One-shot enforcement: consume the stream once, then a second dispatch
  // on the same prepared handle must fail [audit 02-S2: INVALID_PREPARED_CALL].
  for await (const chunk of result.stream()) void chunk;
  await assert.rejects(async () => result.dispatchAgain(), /INVALID_PREPARED_CALL|only be dispatched once/);
});

test("track A: config mutation before dispatch → INVALID_PREPARED_CALL", async () => {
  const runtime = makeRuntime({ arity: 3 });
  const t = transport.createVerifyTransport(runtime);
  const result = await t.verify({ provider: "pi-ai", model: "m1", reasoningEffort: "low" });
  await assert.rejects(async () => result.dispatchWithMutatedConfig(), /INVALID_PREPARED_CALL|changed before adapter dispatch/);
});

test("track B (precheck, arity 2): resolveCallConfig validates, then explicit stream", async () => {
  const runtime = makeRuntime({ arity: 2 });
  const t = transport.createVerifyTransport(runtime);
  assert.equal(t.mode, "precheck");
  const result = await t.verify({ provider: "pi-ai", model: "m1", reasoningEffort: "high", maxTokens: 8192 });
  assert.equal(result.fidelity, "driver-confirmed");
  assert.equal(result.config.maxTokens, 8192); // explicit value passes through
  const chunks = [];
  for await (const chunk of result.stream()) chunks.push(chunk);
  assert.equal(chunks.length, 1);
});

test("track B: unsupported effort rejects with UNSUPPORTED_REASONING_EFFORT", async () => {
  const runtime = makeRuntime({ arity: 2 });
  const t = transport.createVerifyTransport(runtime);
  await assert.rejects(
    () => t.verify({ provider: "pi-ai", model: "m1", reasoningEffort: "xhigh" }),
    (error) => error.code === "UNSUPPORTED_REASONING_EFFORT",
  );
});

test("absent runtime: transport degrades explicitly, verify reports unavailable", async () => {
  const t = transport.createVerifyTransport(undefined);
  assert.equal(t.mode, "unavailable");
  const result = await t.verify({ provider: "pi-ai", model: "m1" });
  assert.equal(result.fidelity, "logical-only");
  assert.equal(result.unavailable, true);
});
