// dsh-model-assistant — Remote service (namespace "modelAssistant").
//
// P0-02 scope: SRC-mode registration only [p0-evidence-notes N1]:
//   class extends TypertRemoteService (super(ctx, key)) → bindTypertRemote
//   produces the frozen {service, serviceKey, namespace} binding; the gateway's
//   resolveDescriptor falls back to resolveSrcDescriptor, which scans services
//   for the typertRemote binding and builds a src-json descriptor from the
//   prototype's remote-method markers. No ./typert manifest needed until P1.
//
// Marker registration without native decorators: Node 22 executes plain ESM
// without decorator syntax, and `mark()` is not exported from
// dsh-typert-protocol. `markRemoteMethod()` below replicates the decorator's
// initializer protocol byte-for-byte (REMOTE_METHOD_DESCRIPTOR, version 1,
// frozen marker list; protocol lib/index.js L246-263). `remoteMethods()`
// — the gateway's own discovery input — reads the result unchanged, so this
// is the same wire contract @Remote would produce, with zero build step.

import { RemoteError, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

/** Wire namespace of this service. Equals the service key (P0 default). */
export const REMOTE_NAMESPACE = "modelAssistant";

/** Symbol key of the versioned remote-method descriptor on the prototype. */
const REMOTE_METHOD_DESCRIPTOR = "@deepseek-ai/dsh-typert-protocol/remote-methods";

/** Characters allowed in an endpoint segment (protocol validateName rule). */
const SEGMENT_RE = /^[A-Za-z0-9_-]+$/;

function validateSegment(subject, value) {
  if (typeof value !== "string" || !SEGMENT_RE.test(value)) {
    throw new TypeError(`typert-protocol: ${subject} must contain only RPC endpoint segment characters`);
  }
}

/** Replica of protocol `mark()` (L246-263): append one frozen marker. */
function markRemoteMethod(prototype, method, { exportName, mode } = {}) {
  validateSegment("Remote method name", method);
  if (exportName !== void 0) validateSegment("Remote export name", exportName);
  const invocation = Object.freeze({ kind: "direct" });
  const descriptor = prototype[REMOTE_METHOD_DESCRIPTOR];
  const marker = Object.freeze({
    method,
    ...(exportName === void 0 || exportName === method ? {} : { exportName }),
    ...(mode === void 0 ? {} : { mode }),
    invocation,
  });
  const current = descriptor?.methods.find((c) => c.method === method);
  if (current !== void 0) {
    if (current.exportName === marker.exportName && current.mode === marker.mode) return;
    throw new Error(`typert-protocol: Remote method "${method}" has conflicting invocation markers`);
  }
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([...(descriptor?.methods ?? []), marker]),
    }),
  });
}

/**
 * Version capabilities handed to the client on every echo round-trip.
 * [B1 §4.4; supportsConfigure measured at the llm runtime: 0.2.1's
 * prepareCall(config, signal, configure) has length 3; 0.2.0's is 2.]
 */
function versionCapabilities(llm) {
  const probe = typeof llm?.prepareCall === "function" ? llm.prepareCall.length : 0;
  return {
    supportsConfigure: probe >= 3,
    nativeReasoningEditing: probe >= 3, // 0.2.1 ships ModelReasoningEfforts [audit 02-S4]
    probeArgs: probe,
  };
}

/** Declared Remote method table: method name → handler. Order = wire order. */
const REMOTE_METHODS = ["echo", "listTargets"];

/**
 * The plugin's Remote service. The wire namespace is "modelAssistant".
 * Methods throw RemoteError with stable codes; the client discriminates by
 * `error.code`, never instanceof [B1 §2.5].
 */
export class ModelAssistantService extends TypertRemoteService {
  /**
   * @param ctx - owning cordis context; `ctx.llm` (when present) feeds the
   *   capability probe. Absence degrades caps to all-false, never throws.
   */
  constructor(ctx) {
    super(ctx, REMOTE_NAMESPACE);
    this.#ctx = ctx;
  }

  static {
    // Register the markers once, at class definition time — exactly what the
    // @Remote decorators' initializers would do on first instance.
    for (const method of REMOTE_METHODS) markRemoteMethod(ModelAssistantService.prototype, method);
  }

  #ctx;

  /** Liveness + capability handshake. P0-02 probe method. */
  echo({ message, delayMs = 0 } = {}, signal) {
    if (typeof message !== "string" || message.length === 0) {
      throw new RemoteError(
        "modelAssistant/invalid-request",
        "echo requires a non-empty message",
        {},
      );
    }
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 10_000) {
      throw new RemoteError(
        "modelAssistant/invalid-request",
        "echo delayMs must be an integer within [0, 10000]",
        {},
      );
    }
    // ctx.get("llm") via the proxy; direct llm field for hand-built doubles.
    const llm =
      this.#ctx?.llm ?? (typeof this.#ctx?.get === "function" ? this.#ctx.get("llm") : void 0);
    const caps = versionCapabilities(llm);
    if (delayMs === 0) return { message, caps };
    // Long variant: cooperative cancellation probe (OQ-B1-2). Best-effort:
    // a missing/aborted signal resolves normally with cancelled=false.
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ message, caps, cancelled: false }), delayMs);
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer);
          resolve({ message, caps, cancelled: true });
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve({ message, caps, cancelled: true });
          },
          { once: true },
        );
      }
    });
  }

  /** P1 method surface placeholder (documented contract, not yet wired). */
  listTargets() {
    throw new RemoteError("modelAssistant/not-implemented", "listTargets lands in P1", {});
  }
}
