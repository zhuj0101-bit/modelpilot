// ModelPilot 工作台 —— 最小可用界面（P1-07 MVP）。
//
// 注册一个 settings.section："modelpilot.workbench"。
// 流程：选一条 pi-ai 路由 → 输入模型 id → 检查投影出的行和引擎产出的每一条
// 告警 → 用宿主自己的 configForms.mutate 写入（带修订号围栏、自动恢复）。
//
// 投影引擎由构建步骤从 src/core 内联进来，因此这个界面跑的逻辑与宿主侧测试
// 逐字节相同：R1–R7 推理预检、目录替换门禁、白名单过滤、重复条目守卫。

import * as React from "react";
import { projectPiAi } from "../core/pi-ai-projection.js";
import { PI_AI_LEVELS, MODALITIES, displayNameFromModelId, humanizeTokenCount } from "../core/domain.js";
import {
  allReasoningLevels,
  defaultReasoningLevels,
  noReasoningLevels,
  reasoningLevelsGuard,
  reasoningPolicyFor,
  toggleReasoningLevel,
} from "./reasoning-levels.js";

export const name = "model-assistant-client";
export const inject = ["slots", "configForms"];

const SECTION_ID = "modelpilot.workbench";
const LLM_NS = "llm-pi-ai";

// token 字段的候选清单按 #5 写死，不做成用户配置。
const CONTEXT_WINDOW_CANDIDATES = Object.freeze([8192, 32768, 65536, 131072, 200000, 262144, 1000000]);
const MAX_TOKENS_CANDIDATES = Object.freeze([4096, 8192, 16384, 32768, 65536, 131072]);

/** 输入只接受十进制正整数；空字符串表示「不写该字段」。 */
function isPositiveTokenCount(text) {
  return /^\d+$/.test(text) && Number(text) > 0;
}

/** 从 configForms 快照里读取当前的 pi-ai providers 映射。 */
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

/** 把某条路由上 models.dev 风格的目录 id 转成供门禁使用的 Set。 */
function catalogIdsOf(route) {
  const models = Array.isArray(route?.models) ? route.models : [];
  return new Set(models.map((m) => m?.id).filter((id) => typeof id === "string"));
}

/** 路由自带的 models 是打包引擎唯一可以当作替换对象的目录事实。下面用
 * useMemo 计算，好让 Set 的身份按路由文档保持稳定 —— 每次渲染都新建 Set
 * 会导致每敲一个键就重跑一次投影。 */

const s = {
  page: { display: "flex", flexDirection: "column", gap: 16, padding: "4px 2px 32px" },
  h: { fontSize: 16, fontWeight: 600, margin: 0 },
  sub: { fontSize: 12, opacity: 0.66, margin: 0, lineHeight: 1.55 },
  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" },
  field: { display: "flex", flexDirection: "column", gap: 4, minWidth: 148 },
  fieldHint: { fontSize: 11, lineHeight: 1.4, opacity: 0.62 },
  fieldError: { fontSize: 11, lineHeight: 1.4, color: "#e05252" },
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
  btnSmall: {
    padding: "3px 9px", fontSize: 11, borderRadius: 6, cursor: "pointer",
    border: "1px solid rgba(128,128,128,0.32)", background: "rgba(128,128,128,0.1)",
    color: "inherit", fontFamily: "inherit",
  },
  levels: { display: "flex", flexDirection: "column", gap: 6, flex: "1 1 340px", minWidth: 280 },
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

/** 工作台界面。 */
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
  // 用户手动改过显示名后，模型 ID 的后续变化不再覆盖它；「清空」可恢复联动。
  const displayNameTouched = React.useRef(false);
  const [contextWindow, setContextWindow] = React.useState("");
  const [maxTokens, setMaxTokens] = React.useState("");
  const [contextWindowError, setContextWindowError] = React.useState(false);
  const [maxTokensError, setMaxTokensError] = React.useState(false);
  const [inputText, setInputText] = React.useState(true);
  const [inputImage, setInputImage] = React.useState(false);
  const [reasoningLevels, setReasoningLevels] = React.useState(() => defaultReasoningLevels());
  const [ackReplace, setAckReplace] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState(null);

  const reasoningGuard = reasoningLevelsGuard(reasoningLevels);

  React.useEffect(() => {
    if (routeId === "" && routes.length > 0) setRouteId(routes[0]);
  }, [routes, routeId]);

  const route = routeId ? providers[routeId] : undefined;
  const userRoute = routeId ? userProviders[routeId] : undefined;
  const routeModels = Array.isArray(route?.models) ? route.models : [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const catalogIds = React.useMemo(() => catalogIdsOf(route), [route]);

  // ── 实时投影：与宿主引擎在单元测试里算出的结果完全一致 ──
  const draft = React.useMemo(() => {
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
    const reasoning = reasoningPolicyFor(reasoningLevels);
    if (reasoning !== undefined) d.reasoning = reasoning;
    return d;
  }, [modelId, displayName, contextWindow, maxTokens, inputText, inputImage, reasoningLevels]);

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
  // 只勾 off 时组件上方已给出专门说明，避免同一原因再显示一遍引擎诊断。
  const unsupported = (projection?.unsupportedControls ?? []).filter(
    (u) => !(reasoningGuard !== null && u.reason === "efforts-only-off"),
  );
  const canApply = writable && !busy && reasoningGuard === null && modelId.trim() !== "" && projection && !blocked && !hardStop && projection.settingsOps.length > 0;

  /** token 输入：合法值写入状态；非法值不落状态，回显最近一次合法值并给出错误。 */
  function changeTokenCount(event, current, setValue, setError) {
    const next = event.target.value;
    if (next === "" || isPositiveTokenCount(next)) {
      setValue(next);
      setError(false);
      return;
    }
    setError(true);
    event.target.value = current;
  }

  async function apply() {
    if (!projection || projection.settingsOps.length === 0) return;
    setBusy(true);
    setToast(null);
    try {
      const ok = await scope.mutate(projection.settingsOps);
      setToast(
        ok
          ? { tone: "good", text: `已写入 ${routeId} / ${draft.id}` }
          :           { tone: "bad", text: "写入被宿主拒绝（修订号冲突或校验失败），已重新读取当前配置，请核对后重试" },
      );
      if (ok) {
        displayNameTouched.current = false;
        setModelId("");
        setDisplayName("");
        setContextWindow("");
        setMaxTokens("");
        setContextWindowError(false);
        setMaxTokensError(false);
        setReasoningLevels(noReasoningLevels());
        setAckReplace(false);
      }
    } catch (error) {
      setToast({ tone: "bad", text: `写入异常：${error?.message ?? error}` });
    } finally {
      setBusy(false);
    }
  }

  // ConfigFormController 快照形态（0.2.2）：{status, value, base, user, revision, writable}。
  // 没有 `mode` 字段 —— 命名空间是否可用看 `status`，写权限看 `writable`。
  const status = snap?.status;

  return (
    <div style={s.page}>
      <div>
        <h2 style={s.h}>ModelPilot · 模型配置助手</h2>
        <p style={s.sub}>
          输入模型 ID，引擎按「用户档案 → 路由目录 → 模板 → 预设」合成字段，只写字段级最小补丁。
          写入走宿主 configForms（修订号围栏 + 冲突自动重读）。
          {status === "unavailable" ? " 当前配置档案未提供该命名空间。" : ""}
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
          <input
            style={s.input}
            value={modelId}
            onChange={(e) => {
              const next = e.target.value;
              setModelId(next);
              if (!displayNameTouched.current) setDisplayName(displayNameFromModelId(next));
            }}
            placeholder="如 tflow/alpha-32b"
          />
        </Field>
        <Field label="显示名（可选）">
          <input
            style={s.input}
            value={displayName}
            onChange={(e) => {
              displayNameTouched.current = true;
              setDisplayName(e.target.value);
            }}
            placeholder="留空则不写"
          />
        </Field>
      </div>

      <div style={s.row}>
        <Field label="上下文窗口 (contextWindow)">
          <input
            style={s.input}
            value={contextWindow}
            onChange={(e) => changeTokenCount(e, contextWindow, setContextWindow, setContextWindowError)}
            placeholder="如 131072"
            inputMode="numeric"
            list="modelpilot-context-window-candidates"
          />
          <datalist id="modelpilot-context-window-candidates">
            {CONTEXT_WINDOW_CANDIDATES.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {contextWindowError ? (
            <span style={s.fieldError}>请输入正整数</span>
          ) : humanizeTokenCount(contextWindow) !== "" ? (
            <span style={s.fieldHint}>{humanizeTokenCount(contextWindow)}</span>
          ) : null}
        </Field>
        <Field label="输出上限 (maxTokens)">
          <input
            style={s.input}
            value={maxTokens}
            onChange={(e) => changeTokenCount(e, maxTokens, setMaxTokens, setMaxTokensError)}
            placeholder="如 8192"
            inputMode="numeric"
            list="modelpilot-max-tokens-candidates"
          />
          <datalist id="modelpilot-max-tokens-candidates">
            {MAX_TOKENS_CANDIDATES.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {maxTokensError ? (
            <span style={s.fieldError}>请输入正整数</span>
          ) : humanizeTokenCount(maxTokens) !== "" ? (
            <span style={s.fieldHint}>{humanizeTokenCount(maxTokens)}</span>
          ) : null}
        </Field>
        <div style={s.levels}>
          <span style={s.label}>推理档位（多选；全不选则不写 reasoningEfforts）</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PI_AI_LEVELS.map((level) => (
              <label key={level} style={{ ...s.chip, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={reasoningLevels.includes(level)}
                  onChange={() => setReasoningLevels((current) => toggleReasoningLevel(current, level))}
                />
                {level}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button type="button" style={s.btnSmall} onClick={() => setReasoningLevels(allReasoningLevels())}>全选</button>
            <button type="button" style={s.btnSmall} onClick={() => setReasoningLevels(noReasoningLevels())}>全不选</button>
            <button type="button" style={s.btnSmall} onClick={() => setReasoningLevels(defaultReasoningLevels())}>恢复默认</button>
          </div>
          {reasoningGuard ? <div style={s.err}>{reasoningGuard}</div> : null}
          {reasoningLevels.length === 0 ? (
            <span style={s.sub}>全不选：本次投影不写 reasoningEfforts，沿用目录能力事实。</span>
          ) : null}
        </div>
      </div>

      <div style={s.row}>
        <label style={{ ...s.chip, cursor: "pointer" }}>
          <input type="checkbox" checked={inputText} onChange={(e) => setInputText(e.target.checked)} /> text
        </label>
        <label style={{ ...s.chip, cursor: "pointer" }}>
          <input type="checkbox" checked={inputImage} onChange={(e) => setInputImage(e.target.checked)} /> image
        </label>
        <span style={{ ...s.chip, opacity: 0.75 }}>
          该路由现有模型条目 {routeModels.length} · 目录条目 {catalogIds.size}
        </span>
      </div>

      {modelId.trim() === "" ? (
        <div style={s.sub}>填入模型 ID 后这里显示将要写入的内容。</div>
      ) : (
        <>
          <div style={s.label}>投影结果（写出的只有这些字段）</div>
          <pre style={s.pre}>{JSON.stringify(projection?.settingsOps ?? [], null, 2)}</pre>

          {(projection?.warnings ?? []).map((w, i) => (
            <div key={`w${i}`} style={s.warn}>
              <strong>{w.code}</strong>：{w.message}
              {w.removedCatalogIds?.length ? `（将从该路由消失：${w.removedCatalogIds.join("、")}）` : ""}
            </div>
          ))}

          {unsupported.map((u, i) => (
            <div key={`u${i}`} style={s.err}>
              不可写：<strong>{u.control}</strong> — {u.reason}
              {u.message ? `（${u.message}）` : ""}
            </div>
          ))}

          {gate ? (
            <label style={{ ...s.warn, display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="checkbox" checked={ackReplace} onChange={(e) => setAckReplace(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                该路由是目录路由，写入 models 会<b>整体替换</b>它的模型目录，上列
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
            displayNameTouched.current = false;
            setModelId("");
            setDisplayName("");
            setContextWindow("");
            setMaxTokens("");
            setContextWindowError(false);
            setMaxTokensError(false);
            setReasoningLevels(noReasoningLevels());
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
        maxTokens 同时充当该模型的默认请求输出预算（DSH 双重身份），不填则跟随路由默认。
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
