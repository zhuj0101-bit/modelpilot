// ModelPilot workbench — minimal usable screen (P1-07 MVP).
//
// Registers one settings.section: "modelpilot.workbench".
// Flow: pick a pi-ai route → type a model id → review the projected row and
// every warning the engine produced → write it with the host's own
// configForms.mutate (revision-fenced, auto-recovering).
//
// The projection engine is INLINED from src/core by the build step, so this
// screen runs byte-identical logic to the Host-side tests: R1–R7 reasoning
// pre-check, catalog-replacement gate, whitelist filtering, duplicate guards.

import * as React from "react";
import { projectPiAi } from "../core/pi-ai-projection.js";
import { validatePiAiReasoningEfforts, PI_AI_LEVELS, MODALITIES } from "../core/domain.js";

export const name = "model-assistant-client";
export const inject = ["slots", "configForms"];

const SECTION_ID = "modelpilot.workbench";
const LLM_NS = "llm-pi-ai";

/** Read the current pi-ai providers map from a configForms snapshot. */
function providersOf(snapshot) {
  const value = snapshot?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const providers = value.providers;
  return providers && typeof providers === "object" && !Array.isArray(providers) ? providers : {};
}

function userProvidersOf(snapshot) {
  const user = snapshot?.user;
  if (!user || typeof user !== "object" || Array.isArray(user)) return {};
  const providers = user.providers;
  return providers && typeof providers === "object" && !Array.isArray(providers) ? providers : {};
}

/** Convert models.dev-style catalog ids on a route into a Set for the gate. */
function catalogIdsOf(route) {
  const models = Array.isArray(route?.models) ? route.models : [];
  return new Set(models.map((m) => m?.id).filter((id) => typeof id === "string"));
}

/** Route models are the only catalog facts the bundled engine may treat as a
 * replacement target. Computed under useMemo below so the Set identity is
 * stable per route document — a fresh Set each render would re-run projection
 * on every keystroke. */

const s = {
  page: { display: "flex", flexDirection: "column", gap: 16, padding: "4px 2px 32px" },
  h: { fontSize: 16, fontWeight: 600, margin: 0 },
  sub: { fontSize: 12, opacity: 0.66, margin: 0, lineHeight: 1.55 },
  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" },
  field: { display: "flex", flexDirection: "column", gap: 4, minWidth: 148 },
  label: { fontSize: 11, opacity: 0.7, letterSpacing: 0.2 },
  input: {
    padding: "6px 8px", fontSize: 13, borderRadius: 6,
    border: "1px solid rgba(128,128,128,0.32)", background: "transparent",
    color: "inherit", fontFamily: "inherit", minWidth: 0,
  },
  pre: {
    margin: 0, padding: 10, borderRadius: 8, fontSize: 12, lineHeight: 1.5,
    background: "rgba(128,128,128,0.09)", overflowX: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  warn: {
    padding: "8px 10px", borderRadius: 8, fontSize: 12, lineHeight: 1.55,
    background: "rgba(220,150,40,0.12)", border: "1px solid rgba(220,150,40,0.34)",
  },
  err: {
    padding: "8px 10px", borderRadius: 8, fontSize: 12, lineHeight: 1.55,
    background: "rgba(220,80,80,0.12)", border: "1px solid rgba(220,80,80,0.34)",
  },
  ok: {
    padding: "8px 10px", borderRadius: 8, fontSize: 12, lineHeight: 1.55,
    background: "rgba(80,170,110,0.12)", border: "1px solid rgba(80,170,110,0.34)",
  },
  btn: {
    padding: "7px 14px", fontSize: 13, borderRadius: 6, cursor: "pointer",
    border: "1px solid rgba(128,128,128,0.36)", background: "rgba(128,128,128,0.12)",
    color: "inherit", fontFamily: "inherit",
  },
  btnPrimary: {
    padding: "7px 14px", fontSize: 13, borderRadius: 6, cursor: "pointer",
    border: "1px solid rgba(90,140,230,0.55)", background: "rgba(90,140,230,0.22)",
    color: "inherit", fontFamily: "inherit", fontWeight: 600,
  },
  chip: {
    display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 8px",
    borderRadius: 999, fontSize: 11, border: "1px solid rgba(128,128,128,0.3)",
    background: "rgba(128,128,128,0.1)",
  },
};

function Field({ label, children }) {
  return (
    <label style={s.field}>
      <span style={s.label}>{label}</span>
      {children}
    </label>
  );
}

/** The workbench screen. */
function Workbench({ configForms }) {
  const scope = configForms.get(LLM_NS);
  const [snap, setSnap] = React.useState(() => scope.getSnapshot());
  React.useEffect(() => scope.subscribe(() => setSnap(scope.getSnapshot())), [scope]);

  const providers = providersOf(snap);
  const userProviders = userProvidersOf(snap);
  const routes = Object.keys(providers);
  const writable = snap?.writable !== false;

  const [routeId, setRouteId] = React.useState("");
  const [modelId, setModelId] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [contextWindow, setContextWindow] = React.useState("");
  const [maxTokens, setMaxTokens] = React.useState("");
  const [inputText, setInputText] = React.useState(true);
  const [inputImage, setInputImage] = React.useState(false);
  const [efforts, setEfforts] = React.useState(""); // "off,low,high"
  const [ackReplace, setAckReplace] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState(null);

  React.useEffect(() => {
    if (routeId === "" && routes.length > 0) setRouteId(routes[0]);
  }, [routes, routeId]);

  const route = routeId ? providers[routeId] : undefined;
  const userRoute = routeId ? userProviders[routeId] : undefined;
  const routeModels = Array.isArray(route?.models) ? route.models : [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const catalogIds = React.useMemo(() => catalogIdsOf(route), [route]);

  // ── live projection: exactly what the Host engine computed in unit tests ──
  const draft = React.useMemo(() => {
    const levels = efforts
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const d = { id: modelId.trim() };
    if (displayName.trim() !== "") d.name = displayName.trim();
    const cw = Number(contextWindow);
    if (contextWindow.trim() !== "" && Number.isFinite(cw) && cw > 0) d.contextWindow = cw;
    const mt = Number(maxTokens);
    if (maxTokens.trim() !== "" && Number.isFinite(mt) && mt > 0) d.maxTokens = mt;
    const input = [];
    if (inputText) input.push("text");
    if (inputImage) input.push("image");
    if (input.length > 0) d.input = input;
    if (levels.length > 0) d.reasoning = { mode: "effort", levels };
    return d;
  }, [modelId, displayName, contextWindow, maxTokens, inputText, inputImage, efforts]);

  const projection = React.useMemo(() => {
    if (modelId.trim() === "") return undefined;
    try {
      return projectPiAi(draft, { providers, catalogModels: catalogIds }, { routeId });
    } catch (error) {
      return { settingsOps: [], warnings: [{ code: "engine-error", message: String(error?.message ?? error) }], unsupportedControls: [], appliedFields: [], profileOnlyFields: [] };
    }
  }, [draft, providers, routeId, modelId, catalogIds]);

  const gate = projection?.warnings?.find((w) => w.code === "catalog-replacement");
  const blocked = Boolean(gate && !ackReplace);
  const hardStop = (projection?.unsupportedControls ?? []).length > 0;
  const canApply = writable && !busy && modelId.trim() !== "" && projection && !blocked && !hardStop && projection.settingsOps.length > 0;

  async function apply() {
    if (!projection || projection.settingsOps.length === 0) return;
    setBusy(true);
    setToast(null);
    try {
      const ok = await scope.mutate(projection.settingsOps);
      setToast(
        ok
          ? { tone: "good", text: `已写入 ${routeId} / ${draft.id}` }
          : { tone: "bad", text: "写入被宿主拒绝（revision 冲突或校验失败），已重新读取当前配置，请核对后重试" },
      );
      if (ok) {
        setModelId("");
        setDisplayName("");
        setContextWindow("");
        setMaxTokens("");
        setEfforts("");
        setAckReplace(false);
      }
    } catch (error) {
      setToast({ tone: "bad", text: `写入异常：${error?.message ?? error}` });
    } finally {
      setBusy(false);
    }
  }

  // ConfigFormController snapshot shape (0.2.2): {status, value, base, user, revision, writable}.
  // There is no `mode` field — namespace availability is `status`, write access is `writable`.
  const status = snap?.status;

  return (
    <div style={s.page}>
      <div>
        <h2 style={s.h}>ModelPilot · 模型配置助手</h2>
        <p style={s.sub}>
          输入模型 ID，引擎按「档案 → 路由目录 → 模板 → 预设」合成字段，只写字段级最小 patch。
          写入走宿主 configForms（revision 围栏 + 冲突自动重读）。
          {status === "unavailable" ? " 当前 profile 未提供该命名空间。" : ""}
        </p>
      </div>

      {!writable ? <div style={s.warn}>当前配置不可写（writable: false），仅只读预览；请检查是否处于只读连接或内存模式。</div> : null}
      {status === "loading" ? <div style={s.sub}>正在读取 DSH 配置…</div> : null}
      {status === "ready" && routes.length === 0 ? (
        <div style={s.warn}>没有检测到已配置的 pi-ai 路由。请先在「模型」页添加一个 provider。</div>
      ) : null}

      <div style={s.row}>
        <Field label="路由 (provider)">
          <select style={s.input} value={routeId} onChange={(e) => { setRouteId(e.target.value); setAckReplace(false); }}>
            {routes.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="模型 ID（原样写入）">
          <input style={s.input} value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="如 tflow/alpha-32b" />
        </Field>
        <Field label="显示名（可选）">
          <input style={s.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="留空则不写" />
        </Field>
      </div>

      <div style={s.row}>
        <Field label="上下文窗口 (contextWindow)">
          <input style={s.input} value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} placeholder="如 131072" inputMode="numeric" />
        </Field>
        <Field label="输出上限 (maxTokens)">
          <input style={s.input} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} placeholder="如 8192" inputMode="numeric" />
        </Field>
        <Field label="推理档位（逗号分隔，空=不写）">
          <input style={s.input} value={efforts} onChange={(e) => setEfforts(e.target.value)} placeholder="off,low,high" />
        </Field>
      </div>

      <div style={s.row}>
        <label style={{ ...s.chip, cursor: "pointer" }}>
          <input type="checkbox" checked={inputText} onChange={(e) => setInputText(e.target.checked)} /> text
        </label>
        <label style={{ ...s.chip, cursor: "pointer" }}>
          <input type="checkbox" checked={inputImage} onChange={(e) => setInputImage(e.target.checked)} /> image
        </label>
        <span style={{ ...s.chip, opacity: 0.75 }}>
          路由现有条目 {routeModels.length} · 目录条目 {catalogIds.size}
        </span>
      </div>

      {modelId.trim() === "" ? (
        <div style={s.sub}>填入模型 ID 后这里显示将要写入的内容。</div>
      ) : (
        <>
          <div style={s.label}>投影结果（只写这些字段）</div>
          <pre style={s.pre}>{JSON.stringify(projection?.settingsOps ?? [], null, 2)}</pre>

          {(projection?.warnings ?? []).map((w, i) => (
            <div key={`w${i}`} style={s.warn}>
              <strong>{w.code}</strong>：{w.message}
              {w.removedCatalogIds?.length ? `（将从该路由消失：${w.removedCatalogIds.join("、")}）` : ""}
            </div>
          ))}

          {(projection?.unsupportedControls ?? []).map((u, i) => (
            <div key={`u${i}`} style={s.err}>
              不可写：<strong>{u.control}</strong> — {u.reason}
              {u.message ? `（${u.message}）` : ""}
            </div>
          ))}

          {gate ? (
            <label style={{ ...s.warn, display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="checkbox" checked={ackReplace} onChange={(e) => setAckReplace(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                该路由是目录路由，写入 models 会<b>整体替换</b>它的模型目录，上面列出的
                {gate.removedCatalogIds?.length ?? 0} 个条目将从该路由消失。我确认继续。
              </span>
            </label>
          ) : null}

          {routeModels.some((m) => m?.id === modelId.trim()) ? (
            <div style={s.err}>该路由已有同名模型条目，宿主会拒绝重复写入。</div>
          ) : null}
        </>
      )}

      <div style={s.row}>
        <button
          style={canApply ? s.btnPrimary : { ...s.btn, opacity: 0.5, cursor: "not-allowed" }}
          disabled={!canApply}
          onClick={apply}
        >
          {busy ? "写入中…" : "写入 DSH 设置"}
        </button>
        <button
          style={s.btn}
          onClick={() => {
            setModelId("");
            setDisplayName("");
            setContextWindow("");
            setMaxTokens("");
            setEfforts("");
            setAckReplace(false);
            setToast(null);
          }}
        >
          清空
        </button>
      </div>

      {toast ? <div style={toast.tone === "good" ? s.ok : s.err}>{toast.text}</div> : null}

      <p style={s.sub}>
        支持的推理档位：{PI_AI_LEVELS.join(" / ")}　·　输入模态：{MODALITIES.join(" / ")}
        <br />
        maxTokens 同时是该模型的默认请求输出预算（DSH 双重身份），不填则跟随路由默认。
      </p>
    </div>
  );
}

export function apply(ctx) {
  const configForms = ctx.configForms;
  ctx.effect(
    () =>
      configForms.whileServed([LLM_NS], () =>
        ctx.slots.inject("settings.section", () =>
          ctx.slots.register(
            {
              name: "settings.section",
              id: SECTION_ID,
              order: 12,
              label: () => "ModelPilot",
              inject: () => ({ configForms }),
            },
            Workbench,
          ),
        ),
      ),
    "model-assistant: workbench settings page",
  );
}

export default { name, inject, apply };
