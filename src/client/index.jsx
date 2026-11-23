// ModelPilot 工作台 —— 最小可用界面（P1-07 MVP）。
//
// 注册一个 settings.section："modelpilot.workbench"。
// 流程：选一条 pi-ai 路由 → 输入模型 id → 检查投影出的行和引擎产出的每一条
// 告警 → 用宿主自己的 configForms.mutate 写入（带修订号围栏、自动恢复）。
//
// 投影引擎由构建步骤从 src/core 内联进来，因此这个界面跑的逻辑与宿主侧测试
// 逐字节相同：R1–R7 推理预检、目录替换门禁、白名单过滤、重复条目守卫。

import * as React from "react";
import {
  CREDENTIAL_TEXT,
  credentialRefOf,
  credentialView,
  deriveKeyRef,
} from "../core/api-key.js";
import { estimateContextBudget } from "../core/context-budget.js";
import { buildProbeRequest, loadCatalogEntries, probeFailureText } from "../core/connection-probe.js";
import { projectPiAi } from "../core/pi-ai-projection.js";
import {
  DESCRIBE_BATCH_SIZE,
  OVERVIEW_KEY_TEXT,
  buildRouteOverview,
  credentialCellOf,
  describeBatches,
  describeOverviewSummary,
  overviewCredentialRefs,
} from "../core/route-overview.js";
import {
  buildRouteDeleteTarget,
  describeRouteDeleteDialog,
  routeDeleteKeyState,
  routeDeleteRemovesKey,
  routesSharingKeyRef,
} from "../core/route-delete.js";
import {
  KEY_RENAME_STATE,
  describeKeyRenameDialog,
  keyRenameRemovesOldKey,
  keyRenameState,
  keyRenameTarget,
} from "../core/key-rename.js";
import {
  describeTemplate,
  formToTemplate,
  normalizeTemplate,
  templateMatchesForm,
  templateToForm,
} from "../core/default-template.js";
import {
  TEMPLATE_MAX_COUNT,
  TEMPLATE_NAME_MAX_LENGTH,
  addLibraryTemplate,
  findLibraryTemplate,
  parseTemplateSelectionValue,
  readTemplateLibrary,
  readTemplateSelection,
  removeLibraryTemplate,
  renameLibraryTemplate,
  templateSelectionValue,
  updateLibraryTemplate,
  writeTemplateLibrary,
  writeTemplateSelection,
} from "../core/template-library.js";
import {
  MODEL_PRESETS,
  detectPreset,
  findModelPreset,
  presetToForm,
  presetToTemplate,
} from "../core/model-presets.js";
import { PI_AI_LEVELS, MODALITIES, displayNameFromModelId, humanizeTokenCount } from "../core/domain.js";
import {
  TOKEN_INPUT,
  classifyTokenInput,
  describeModelRowSource,
  diffRow,
  formFromModel,
  splitEditDiff,
  validateEditForm,
} from "../core/model-edit.js";
import { classifyModels, filterModels, planBatchSelection } from "../core/model-selection.js";
import {
  bulkFieldsNotice,
  planBulkDelete,
  planBulkFields,
  sameIdSequence,
  summarizeBulkSelection,
} from "../core/model-bulk.js";
import {
  TOAST_FADE_MS,
  nextToastOnDismiss,
  restoreToastOnFocus,
  toastAria,
  toastDismissDelay,
} from "../core/toast.js";
import {
  DENSITY_COMPACT,
  DENSITY_DETAILED,
  VIEW_FLAT,
  VIEW_GROUPED,
  groupCountText,
  groupKeyOf,
  groupModelRows,
  groupedOrdinalOf,
  readModelListDensity,
  readModelListView,
  selectAllCheckboxState,
  sharedSummaryText,
  writeModelListDensity,
  writeModelListView,
} from "../core/model-list-view.js";
import {
  CACHE_RETENTION_CHOICES,
  ROUTE_DEFAULT_FIELDS,
  TRANSPORT_CHOICES,
  apiChoicesFromSchema,
  buildRouteDeleteOps,
  buildRouteEditOps,
  countRouteDefaultUsers,
  describeHostDefaultFallback,
  describeRouteDefaultInputUsage,
  describeRouteDefaultUsage,
  describeRouteSummary,
  modalityChoicesFromSchema,
  moveModel,
  normalizeModalities,
  routeDefaultCountParts,
  routeDeleteBlockReason,
  routeFieldLabels,
  routeFormFromProvider,
} from "../core/route-edit.js";
import {
  buildRouteCreatePlan,
  defaultProtocolChoice,
  filterCatalogRows,
  routeCatalogRows,
} from "../core/route-create.js";
import {
  allReasoningLevels,
  customReasoningWireCount,
  defaultReasoningLevels,
  noReasoningLevels,
  reasoningLevelsGuard,
  reasoningPolicyFor,
  toggleReasoningLevel,
} from "./reasoning-levels.js";

export const name = "model-assistant-client";
export const inject = ["slots", "configForms", "remote", "remote.llm", "remote.credentials"];

const SECTION_ID = "modelpilot.workbench";
const LLM_NS = "llm-pi-ai";

// token 字段的候选清单按 #5 写死，不做成用户配置。
const CONTEXT_WINDOW_CANDIDATES = Object.freeze([8192, 32768, 65536, 131072, 200000, 262144, 1000000]);
const MAX_TOKENS_CANDIDATES = Object.freeze([4096, 8192, 16384, 32768, 65536, 131072]);

// 中转站地址只填形状，不编造具体域名：用户必须把主机名换成自己的。
const RELAY_BASE_URL_SHAPE = "https://你的中转站域名/v1";

/**
 * 「自定义」新建路由的接口地址格式 chip（工单 #40）。
 * 协议名对刚装插件的用户是黑话，点一下同时把形状与协议都摆好。
 * `api: null` 表示只清空地址，不改协议。
 */
const BASE_URL_PRESETS = Object.freeze([
  Object.freeze({ id: "openai", label: "OpenAI 兼容 …/v1", api: "openai-completions", baseURL: RELAY_BASE_URL_SHAPE }),
  Object.freeze({ id: "anthropic", label: "Anthropic …/v1", api: "anthropic-messages", baseURL: RELAY_BASE_URL_SHAPE }),
  Object.freeze({ id: "empty", label: "留空自己填", api: null, baseURL: "" }),
]);

/**
 * 内置预设的模板值（工单 #42）。
 *
 * 模块级一次收敛：预设是常量，返回值对象也就稳定 —— 每次渲染重建新对象会让
 * 「首次挂载填入表单」的 effect 依赖反复变化（虽然有 ref 守卫，但没必要抖）。
 */
const BUILTIN_TEMPLATE_VALUES = new Map(
  MODEL_PRESETS.map((preset) => [preset.id, normalizeTemplate(presetToTemplate(preset))]),
);

/**
 * 初始选择：读「最近选用」→ 第一份用户模板 → 内置「基础对话」。
 *
 * `explicit` 表示这份选择来自用户（storage 里有值），而不是回落：批量写入的
 * 摘要据此决定要不要写「内置」二字 —— 库为空且用户没选过时，「基础对话」是
 * 隐式回落，不能让用户以为自己配置过它（工单 #43 缺陷 1）。
 */
function initialTemplateChoice(storage) {
  const library = readTemplateLibrary(storage);
  const stored = readTemplateSelection(storage, library);
  if (stored !== null) return { choice: stored, explicit: true };
  if (library.templates.length > 0) {
    return { choice: { kind: "user", id: library.templates[0].id }, explicit: false };
  }
  return { choice: { kind: "builtin", id: MODEL_PRESETS[0].id }, explicit: false };
}

/**
 * 当前选中的模板（工单 #42）。
 *
 * - 选中的用户模板被删除后回落到第一份用户模板；
 * - 用户模板全没了就回落到内置「基础对话」预设；
 * - 内置预设永远可选、只读，返回值对象来自模块级常量。
 */
function resolveTemplateChoice(library, choice) {
  const selected = choice !== null && choice.kind === "user" ? findLibraryTemplate(library, choice.id) : null;
  if (selected !== null) {
    return { kind: "user", id: selected.id, name: selected.name, values: selected.values };
  }
  if ((choice === null || choice.kind === "user") && library.templates.length > 0) {
    const first = library.templates[0];
    return { kind: "user", id: first.id, name: first.name, values: first.values };
  }
  const preset = (choice !== null && choice.kind === "builtin" ? findModelPreset(choice.id) : null)
    ?? MODEL_PRESETS[0];
  return { kind: "builtin", id: preset.id, name: preset.label, values: BUILTIN_TEMPLATE_VALUES.get(preset.id) };
}

/**
 * 模板条下面的摘要：内置预设带「内置模板：<名字>」，用户模板带「模板：<名字>」，
 * 冒号后的数值描述复用 describeTemplate，与工单 #29 的文案格式一致。
 *
 * 工单 #43 缺陷 5：摘要紧贴在表单正上方，光描述模板本身会被读成「现在要存的就是
 * 这些值」；表单被改过就追加一句说明，改回原值后这句自动消失。
 * `form` 为 null（表单未打开 / 不可用）时不比较，也不加这句。
 */
function templateSummaryText(choice, form) {
  const description = describeTemplate(choice.values, humanizeTokenCount);
  const base = choice.kind === "builtin"
    ? `内置模板：${choice.name} · ${description}`
    : `模板：${choice.name} · ${description}`;
  if (form === null || templateMatchesForm(choice.values, form)) return base;
  return `${base}（表单已改动，与模板不同）`;
}

/**
 * 批量写入前的模板摘要（工单 #43 缺陷 1）。
 *
 * 批量写入用「当前选中的模板」生成每一行；这句话必须说清用的是哪一份、值分别是
 * 多少，否则用户在新增表单里选了「长文档」，就会在不知情的情况下把 1M 上下文
 * 写给整批模型。库为空时这一份是隐式回落：写「内置」并标「内置预设」，
 * 不再说「未设置默认模板，将使用内置默认值」—— 那与真实写入值不符。
 */
function batchTemplateHint({ label, kind, values, fallback }) {
  const description = describeTemplate(values, humanizeTokenCount);
  const name = fallback ? `内置「${label}」` : `「${label}」`;
  const marker = kind === "builtin" ? "（内置预设）" : "";
  return `将以${name}的参数写入：${description}${marker}`;
}

/* 工单 #43 缺陷 3：对话框里可聚焦的元素；与 ModelPicker 的 Tab 循环同一套选择器。 */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 把焦点交给某个元素；没有 DOM、元素已脱离文档或不可聚焦时返回 false。 */
function focusElement(element) {
  if (typeof document === "undefined") return false;
  if (element === null || element === undefined || typeof element.focus !== "function") return false;
  if (!document.contains(element)) return false;
  element.focus();
  return true;
}

/**
 * 打开对话框的那个按钮（工单 #43 缺陷 3：关闭后焦点还给它）。
 *
 * 记录的是「哪一份模板条上的哪个按钮」，而不是 DOM 引用：模板条在保存 / 删除 /
 * 改名后会重渲染，旧节点可能已经脱离文档；关闭时按 aria-label 在最新 DOM 里
 * 找回同一个按钮，两个表单各有一份按钮也不会串。
 */
function templateTriggerTargetOf(mode, action) {
  return {
    containerLabel: mode === "edit" ? "编辑模型模板" : "新增模型模板",
    buttonLabel: action === "saveAsNew" ? "存为新模板" : "管理模板",
  };
}

/** 按记录的选择器找回当前 DOM 里的触发按钮；找不到返回 null。 */
function resolveTemplateTrigger(target) {
  if (target === null || typeof document === "undefined") return null;
  const container = document.querySelector(`[aria-label="${target.containerLabel}"]`);
  if (container === null) return null;
  return container.querySelector(`[aria-label="${target.buttonLabel}"]`);
}

/**
 * 模态对话框的焦点管理（工单 #43 缺陷 3）。
 *
 * 两个弹窗共用这一份实现（弹窗本身保持无 hook，状态在 Workbench）：
 * 1. 打开时把焦点移到对话框里第一个可聚焦元素；
 * 2. 返回的函数接在 role="dialog" 的根上，做一个 Tab / Shift+Tab 焦点圈；
 * 3. 关闭时把焦点还给打开它的那个按钮（triggerRef 里的选择器）。
 */
function useDialogFocus(isOpen, dialogRef, triggerRef) {
  React.useEffect(() => {
    if (!isOpen) return undefined;
    const root = dialogRef.current;
    if (root !== null) {
      const focusables = [...root.querySelectorAll(FOCUSABLE_SELECTOR)];
      focusElement(focusables[0] ?? null);
    }
    return () => {
      focusElement(resolveTemplateTrigger(triggerRef.current));
    };
  }, [isOpen]);

  /** Tab / Shift+Tab 圈定：返回 true 表示已处理（调用方不再做 Esc / Enter）。 */
  return function trapTab(event) {
    if (event.key !== "Tab") return false;
    const root = dialogRef.current;
    if (root === null) return false;
    const focusables = [...root.querySelectorAll(FOCUSABLE_SELECTOR)];
    if (focusables.length === 0) {
      event.preventDefault();
      return true;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = typeof document === "undefined" ? null : document.activeElement;
    const inside = active !== null && active !== undefined && root.contains(active);
    if (event.shiftKey) {
      if (!inside || active === first || active === root) {
        event.preventDefault();
        focusElement(last);
        return true;
      }
      return false;
    }
    if (!inside || active === last) {
      event.preventDefault();
      focusElement(first);
      return true;
    }
    return false;
  };
}

/**
 * token 输入是否合法。与 diffRow 共用 classifyTokenInput（工单 #38 问题 3）：
 * 输入层与逻辑层对空串 / 0 / 负数 / 非数字 / 超长数字的判断不允许相反。
 */
function isPositiveTokenCount(text) {
  return classifyTokenInput(text).status === TOKEN_INPUT.VALID;
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

/** credentials.describe / set / unset 的失败响应 → 可展示的文案（永不含密钥内容）。 */
function credentialErrorMessage(response, fallback) {
  const message = response?.error?.message;
  return typeof message === "string" && message !== "" ? message : fallback;
}

/**
 * 从错误文案里抹掉用户刚输入的明文密钥。
 *
 * 宿主自己的错误消息不会回显参数，但客户端仍做这一道保险：任何异常 / 拒绝
 * 文案在展示前都先去掉与输入逐字节相同的片段，避免「错误消息带出密钥」。
 */
function redactSecret(text, secret) {
  const message = typeof text === "string" ? text : String(text ?? "");
  if (typeof secret !== "string" || secret === "") return message;
  return message.split(secret).join("[已隐藏]");
}

/** 把某条路由上 models.dev 风格的目录 id 转成供门禁使用的 Set。 */
function catalogIdsOf(route) {
  const models = Array.isArray(route?.models) ? route.models : [];
  return new Set(models.map((m) => m?.id).filter((id) => typeof id === "string"));
}

const PENDING_UNSET = "未设置";

/** 表单里的 token 字符串 → 正整数；空 / 非法值返回 undefined（不展示预算提示）。 */
function tokenInputOf(text) {
  if (typeof text !== "string" || text.trim() === "") return undefined;
  if (!/^\d+$/.test(text.trim())) return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 预算提示里的整数千分位；负数也保留符号。 */
function formatTokenNumber(value) {
  const number = Math.trunc(Number(value));
  if (!Number.isFinite(number)) return String(value);
  return number.toLocaleString("en-US");
}

/**
 * 宿主会把 compat 物化成对象（可能只有空的 chatTemplateKwargs/Args）。
 * 只有真正声明了内容时才显示「原样保留」提示，避免每条模型都弹同一句。
 */
function hasMeaningfulCompat(compat) {
  if (compat === null || typeof compat !== "object" || Array.isArray(compat)) return false;
  return Object.entries(compat).some(([, value]) => {
    if (value === undefined || value === null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
  });
}

/** 待写入区块展示的是投影后的实际字段值，不是 ops 的 JSON。 */
function describePendingFields(row) {
  const valueText = (value) =>
    value === undefined || value === null || value === "" ? PENDING_UNSET : String(value);
  const input = Array.isArray(row?.input) && row.input.length > 0 ? row.input.join(" / ") : PENDING_UNSET;
  let reasoning = PENDING_UNSET;
  if (row?.reasoningEfforts === false) {
    reasoning = "false（非推理模型）";
  } else if (row?.reasoningEfforts && typeof row.reasoningEfforts === "object") {
    const levels = Object.keys(row.reasoningEfforts);
    if (levels.length > 0) reasoning = levels.join(" / ");
  }
  return [
    `窗口 ${valueText(row?.contextWindow)}`,
    `输出上限 ${valueText(row?.maxTokens)}`,
    `输入模态 ${input}`,
    `推理档位 ${reasoning}`,
  ];
}

/** 路由自带的 models 是打包引擎唯一可以当作替换对象的目录事实。下面用
 * useMemo 计算，好让 Set 的身份按路由文档保持稳定 —— 每次渲染都新建 Set
 * 会导致每敲一个键就重跑一次投影。 */

// ── 设计变量 ──────────────────────────────────────────────────────────────
// 样式对象只从这三组档位取值，不在下面散落硬编码数字：
// 圆角三档（小控件 / 卡片 / 弹窗）、间距四档（紧邻 / 同组 / 跨组 / 区块）。
// 字号全部走 DSH 字体 token；用 longhand 的 -font-size，因为 --dsw-font-*
// 本身是 font 简写，不能直接赋给 font-size。
const RADIUS = Object.freeze({ sm: 6, md: 10, lg: 14 });
const GAP = Object.freeze({ xs: 4, sm: 8, md: 14, lg: 22 });
const FONT = Object.freeze({
  hint: "var(--dsw-font-xxxs-11-font-size, 11px)",         // 字段提示
  caption: "var(--dsw-font-xxs-12-font-size, 12px)",       // 摘要、次要说明
  body: "var(--dsw-font-xs-13-font-size, 13px)",           // 正文、输入框
  label: "var(--dsw-font-xxs-strong-12-font-size, 12px)",  // 字段标签
  section: "var(--dsw-font-s-strong-14-font-size, 14px)",  // 区块标题
  title: "var(--dsw-font-base-strong-16-font-size, 16px)", // 页面标题
});
const ROW_HOVER_MS = 120;

// 三个区块与内置设置页共用同一套卡片语言。fallback 链退到 bg-layer-1 /
// border-l2：旧宿主或测试夹具只提供基础 token 时仍保持可读、可测。
const CARD = Object.freeze({
  display: "flex",
  flexDirection: "column",
  gap: GAP.sm,
  padding: "12px 14px",
  borderRadius: RADIUS.md,
  border: "1px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l2, rgba(128,128,128,0.28)))",
  background: "var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.08)))",
});

// 输入框与 select 共用盒模型；select 只多出 appearance:none + 自绘箭头。
const INPUT = Object.freeze({
  padding: "6px 8px",
  fontSize: FONT.body,
  borderRadius: RADIUS.sm,
  border: "1px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.32))",
  // 关键：不用 transparent。显式透明会让原生 <select> 弹出层退回平台浅色。
  background: "var(--dsw-alias-bg-layer-1, transparent)",
  color: "var(--dsw-alias-label-primary, inherit)",
  fontFamily: "inherit",
  minWidth: 0,
  // 固定盒高：原生 select 与 input 的默认高度不同，同一行 flex-end
  // 对齐时顶边会差 2px（验收判据 6）。
  boxSizing: "border-box",
  height: 29,
  // 显式继承 color-scheme，保证原生下拉、复选框、滚动条都跟随宿主主题。
  colorScheme: "inherit",
});

const SELECT = Object.freeze({
  ...INPUT,
  appearance: "none",
  paddingRight: 28,
  cursor: "pointer",
  // appearance:none 后自绘 ▾：两条 currentColor 斜线，跟随主题文字色。
  backgroundImage:
    "linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)",
  backgroundPosition: "calc(100% - 15px) calc(50% + 1px), calc(100% - 10px) calc(50% + 1px)",
  backgroundSize: "5px 5px, 5px 5px",
  backgroundRepeat: "no-repeat",
});

const s = {
  page: { display: "flex", flexDirection: "column", gap: GAP.md, padding: "4px 2px 32px" },
  h: { fontSize: FONT.title, fontWeight: 600, margin: 0, letterSpacing: -0.2 },
  sub: {
    fontSize: FONT.caption, margin: 0, lineHeight: 1.6,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  row: { display: "flex", gap: GAP.md, flexWrap: "wrap", alignItems: "flex-end" },
  field: { display: "flex", flexDirection: "column", gap: GAP.xs, minWidth: 148 },
  fieldHint: {
    fontSize: FONT.hint, lineHeight: 1.4,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  fieldError: { fontSize: FONT.hint, lineHeight: 1.4, color: "var(--dsw-alias-state-error-primary, #e05252)" },
  // 提示行始终占位：高度固定，内容出现/消失时字段高度不变（问题 3）。
  hintLine: { minHeight: 16, height: 16, lineHeight: "16px", display: "flex", alignItems: "center", gap: GAP.sm },
  label: {
    fontSize: FONT.label, fontWeight: 500, letterSpacing: 0.2,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  // 工单 #30：字段说明不再常驻，改成标签后的 ⓘ（原生 title 悬停）。
  // 字号沿用提示级，且小于标签字号，不撑高字段标签所在的行。
  tip: {
    marginLeft: GAP.xs, fontSize: FONT.hint, lineHeight: 1, fontWeight: 400,
    verticalAlign: "middle", cursor: "help", userSelect: "none",
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  // 区块：标题 / 卡片 / 主操作行 / 次要操作行。三个区块共用同一套卡片语言。
  sectionCard: CARD,
  // 「新增模型」表单卡：fallback 用 bg-base，保证浅色主题下红色字段错误
  // （state-error-primary）在卡片底色上仍有 ≥ 4.5 对比度；宿主提供
  // settings-card-fill 时三个区块仍是同一套底色。
  formCard: {
    ...CARD,
    background: "var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-base, rgba(128,128,128,0.04)))",
  },
  sectionTitle: { fontSize: FONT.section, fontWeight: 600, margin: 0, color: "var(--dsw-alias-label-primary, inherit)" },
  primaryRow: { display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: GAP.xs },
  linkRow: {
    display: "flex", justifyContent: "flex-end", alignItems: "center",
    flexWrap: "wrap", gap: GAP.md, marginTop: GAP.xs,
  },
  comboBox: { position: "relative", display: "flex", alignItems: "stretch" },
  // 路由选择器 + 新建按钮同一行；按钮不参与换行，窄容器下 select 先收缩。
  routePickerRow: { display: "flex", alignItems: "center", gap: GAP.sm, minWidth: 0 },
  newRouteButton: {
    padding: "5px 10px", fontSize: FONT.hint, borderRadius: RADIUS.sm, cursor: "pointer",
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.32))",
    background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1))",
    color: "var(--dsw-alias-label-primary, inherit)", fontFamily: "inherit",
    whiteSpace: "nowrap", flex: "0 0 auto",
  },
  newRouteButtonDisabled: { opacity: 0.55, cursor: "not-allowed" },
  comboToggle: {
    padding: "0 8px", fontSize: FONT.hint, cursor: "pointer", borderRadius: RADIUS.sm,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.32))",
    background: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.1))",
    color: "inherit", fontFamily: "inherit", marginLeft: GAP.xs,
  },
  comboPanel: {
    position: "absolute", top: `calc(100% + ${GAP.xs}px)`, left: 0, right: 0, zIndex: 20,
    maxHeight: 220, overflowY: "auto", padding: GAP.xs, borderRadius: RADIUS.md,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.32))",
    // 不用系统色 Canvas：它在 Firefox / WebView 下不跟随 color-scheme。
    background: "var(--dsw-alias-bg-layer-1, Canvas)",
    boxShadow: "0 6px 20px rgba(0,0,0,0.18)",
  },
  comboItem: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    width: "100%", padding: "5px 8px", fontSize: FONT.caption, borderRadius: RADIUS.sm,
    border: "none", background: "transparent", color: "inherit",
    fontFamily: "inherit", cursor: "pointer", textAlign: "left",
  },
  comboItemActive: { background: "var(--dsw-alias-interactive-bg-hover, rgba(90,140,230,0.22))" },
  comboItemHint: { fontSize: FONT.hint, opacity: 0.6 },
  input: INPUT,
  select: SELECT,
  pre: {
    margin: 0, padding: GAP.sm, borderRadius: RADIUS.md, fontSize: FONT.caption, lineHeight: 1.5,
    background: "var(--dsw-alias-markdown-code-block, rgba(128,128,128,0.09))",
    overflowX: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  // 原始 JSON 只给需要核对的人看：原生 <details> 默认关闭，不占半屏。
  details: {
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))",
    borderRadius: RADIUS.sm, padding: "6px 10px",
  },
  summary: {
    cursor: "pointer", fontSize: FONT.caption, opacity: 0.8, userSelect: "none",
  },
  // 多选确认后的「待写入」区块：先让人核对，再决定清空还是写入。
  pending: {
    display: "flex", flexDirection: "column", gap: GAP.sm, padding: "10px 12px",
    borderRadius: RADIUS.md,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.28))",
    background: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.08))",
  },
  pendingHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: GAP.sm, flexWrap: "wrap" },
  pendingTitle: { fontSize: FONT.body, fontWeight: 600 },
  pendingActions: { display: "flex", alignItems: "center", gap: GAP.sm },
  pendingList: { display: "flex", flexDirection: "column", gap: GAP.xs },
  pendingModel: { display: "flex", flexDirection: "column", gap: GAP.xs },
  pendingName: {
    fontSize: FONT.caption, fontWeight: 600,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    overflowWrap: "anywhere",
  },
  pendingFields: { fontSize: FONT.hint, lineHeight: 1.55, opacity: 0.78, overflowWrap: "anywhere" },
  // 模型列表：一条一行，展开编辑时同一行内表单展开；同时只允许一条展开。
  modelsPanel: { ...CARD, gap: GAP.xs },
  modelRow: {
    display: "flex", flexDirection: "column", gap: GAP.xs,
    padding: "8px 0",
    position: "relative",
    borderTop: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))",
    transition: `background-color ${ROW_HOVER_MS}ms ease`,
  },
  modelRowHover: { background: "var(--dsw-alias-interactive-bg-hover, rgba(90,140,230,0.22))" },
  // 拖动中的行半透明：位置仍由列表顺序决定，松手 / 方向键后才真正换位。
  modelRowDragging: { opacity: 0.45 },
  modelRowFirst: { borderTop: "none", paddingTop: 0 },
  modelRowHead: { display: "flex", alignItems: "baseline", gap: GAP.sm, paddingRight: GAP.xs },
  modelRowHeadCompact: { alignItems: "center" },
  // 拖动手柄：只在行首占一个字符宽，不改变行高；聚焦后方向键也能排序。
  modelHandle: {
    padding: 0, margin: 0, border: "none", background: "transparent",
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
    font: "inherit", fontSize: FONT.caption, lineHeight: 1, cursor: "grab",
    userSelect: "none", flex: "0 0 auto",
  },
  modelHandleDisabled: { opacity: 0.4, cursor: "not-allowed" },
  // 序号只读：想换位置就拖手柄或按方向键（工单 #19 3.4）。
  modelIndex: {
    fontSize: FONT.hint, fontVariantNumeric: "tabular-nums",
    minWidth: 14, textAlign: "right", flex: "0 0 auto", userSelect: "none",
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  // 插入线绝对定位，不占布局高度；颜色只用主题 token，深浅色都跟随宿主。
  dropLine: {
    position: "absolute", left: 0, right: 0, height: 2, zIndex: 2, pointerEvents: "none",
    background: "var(--dsw-alias-brand-primary, var(--dsw-alias-state-business-primary, currentColor))",
  },
  dropLineBefore: { top: -1 },
  dropLineAfter: { bottom: -1 },
  modelRowMeta: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: GAP.sm, paddingRight: GAP.xs },
  // 行内操作：编辑与删除并列在摘要右侧 / 紧凑行末尾，按钮不随摘要压缩（工单 #28 / #31）。
  modelRowActions: { display: "flex", alignItems: "center", gap: GAP.xs, flexShrink: 0, marginLeft: "auto" },
  modelName: {
    fontSize: FONT.caption, fontWeight: 600, overflowWrap: "anywhere",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  // 工单 #27：摘要多了来源标记（↑ / ·目录），不允许换行 —— 窄容器下用
  // 单行省略，完整说明在 title 悬停里。minWidth: 0 是 flex 子项省略的前提。
  modelSummary: {
    fontSize: FONT.hint, lineHeight: 1.55, flex: "1 1 auto", minWidth: 0,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    color: "var(--dsw-alias-label-tertiary, var(--dsw-alias-label-primary, inherit))",
  },
  // 工单 #31：分组容器与组头。组头是可折叠按钮 + 组内共享摘要；
  // 摘要只是说明文字（span，没有点击行为）。
  modelGroups: { display: "flex", flexDirection: "column", gap: GAP.xs },
  modelGroup: { display: "flex", flexDirection: "column" },
  // 组内行缩进一级，组头保持左对齐；折叠时整块不渲染。
  modelGroupRows: { display: "flex", flexDirection: "column", paddingLeft: GAP.sm },
  modelGroupHeader: {
    display: "flex", alignItems: "center", gap: GAP.sm, flexWrap: "wrap",
    padding: "6px 0 2px",
  },
  modelGroupToggle: {
    display: "inline-flex", alignItems: "baseline", gap: GAP.xs,
    padding: 0, margin: 0, border: "none", background: "transparent",
    color: "var(--dsw-alias-label-primary, inherit)", font: "inherit",
    cursor: "pointer", textAlign: "left",
  },
  modelGroupCaret: { fontSize: FONT.hint, lineHeight: 1, userSelect: "none", opacity: 0.8 },
  modelGroupName: {
    fontSize: FONT.caption, fontWeight: 700,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  modelGroupCount: { fontSize: FONT.hint, fontVariantNumeric: "tabular-nums", opacity: 0.72 },
  modelGroupSummary: {
    fontSize: FONT.hint, lineHeight: 1.55, flex: "1 1 auto", minWidth: 0,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    color: "var(--dsw-alias-label-tertiary, var(--dsw-alias-label-primary, inherit))",
    cursor: "default", userSelect: "text",
  },
  // 紧凑模式一行放下短 ID 与操作按钮；行高由字号决定，不再留摘要行。
  modelRowCompact: { padding: "4px 0" },
  modelNameCompact: {
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0,
  },
  // 工单 #32：视觉隐藏但读屏可读。不能用 display:none —— 那会把摘要一起
  // 从可访问树里删掉；clip + 1px 是标准的 sr-only 写法。
  srOnly: {
    position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
    overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap", border: 0,
  },
  // 「平铺 / 分组」「详细 / 紧凑」两组分段按钮共用同一形态（工单 #39 复用
  // 工单 #31 密度开关的既有外形）。
  segmented: {
    display: "inline-flex", alignItems: "center", borderRadius: RADIUS.sm,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.32))",
    overflow: "hidden",
  },
  segmentedButton: {
    padding: "3px 8px", margin: 0, border: "none", background: "transparent",
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
    font: "inherit", fontSize: FONT.hint, cursor: "pointer",
  },
  modelEmpty: {
    display: "flex", alignItems: "center", gap: GAP.sm, flexWrap: "wrap",
    fontSize: FONT.caption, lineHeight: 1.6,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  // 工单 #25：标题行右侧的搜索框与操作按钮同一行，窄容器下按钮先换行。
  modelHeaderActions: {
    display: "flex", alignItems: "center", gap: GAP.sm,
    flexWrap: "wrap", justifyContent: "flex-end",
  },
  modelSearch: { ...INPUT, flex: "0 1 220px", width: 220 },
  modelFilterFooter: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: GAP.sm, flexWrap: "wrap", paddingTop: GAP.xs,
  },
  modelFilterCount: {
    fontSize: FONT.hint,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  // 每行左侧的复选框：与拖动手柄并存，自身不撑高行（行高由文字行决定）。
  modelCheckbox: {
    margin: 0, flex: "0 0 auto", alignSelf: "center",
    colorScheme: "inherit", cursor: "pointer",
  },
  // 批量操作条：全选 / 已选计数 / 三个按钮同一行。
  bulkBar: {
    display: "flex", alignItems: "center", gap: GAP.sm, flexWrap: "wrap",
    padding: "6px 8px", borderRadius: RADIUS.sm,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))",
    background: "var(--dsw-alias-bg-base, rgba(128,128,128,0.04))",
  },
  bulkLabel: {
    display: "inline-flex", alignItems: "center", gap: GAP.xs,
    fontSize: FONT.caption, cursor: "pointer", userSelect: "none",
    color: "var(--dsw-alias-label-primary, inherit)",
  },
  bulkCount: {
    fontSize: FONT.caption,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  bulkActions: { display: "flex", alignItems: "center", gap: GAP.sm, marginLeft: "auto", flexWrap: "wrap" },
  bulkEditor: {
    display: "flex", flexDirection: "column", gap: GAP.sm,
    padding: "9px 11px", borderRadius: RADIUS.sm,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))",
    background: "var(--dsw-alias-bg-base, rgba(128,128,128,0.04))",
  },
  bulkFieldRow: {
    display: "flex", alignItems: "center", gap: GAP.sm,
    flexWrap: "wrap", fontSize: FONT.caption,
  },
  bulkFieldLabel: {
    display: "inline-flex", alignItems: "center", gap: GAP.xs,
    fontSize: FONT.caption, cursor: "pointer", userSelect: "none", minWidth: 128,
    color: "var(--dsw-alias-label-primary, inherit)",
  },
  bulkTokenInput: { ...INPUT, flex: "0 0 auto", width: 128 },
  bulkLevels: { display: "flex", flexWrap: "wrap", gap: GAP.xs },
  bulkHint: {
    fontSize: FONT.hint, lineHeight: 1.5,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  bulkError: { fontSize: FONT.hint, lineHeight: 1.5, color: "var(--dsw-alias-state-error-primary, #e05252)" },
  bulkFooter: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: GAP.sm, flexWrap: "wrap",
  },
  btnDisabled: { opacity: 0.55, cursor: "not-allowed" },
  // 路由设置卡片：嵌在「当前路由」区块内，只留一条分隔线，不再叠一层卡片。
  routeCard: {
    display: "flex", flexDirection: "column", gap: GAP.xs,
    marginTop: GAP.sm, paddingTop: GAP.sm,
    borderTop: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.28))",
    background: "var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.08)))",
  },
  routeSummary: {
    display: "flex", alignItems: "center", gap: GAP.xs,
    width: "100%", padding: 0, border: "none", background: "transparent",
    color: "var(--dsw-alias-label-primary, inherit)", fontFamily: "inherit", textAlign: "left",
    cursor: "pointer", fontSize: FONT.caption, fontWeight: 600, userSelect: "none", lineHeight: 1.6,
  },
  routeBody: { display: "flex", flexDirection: "column", gap: GAP.md, marginTop: GAP.sm },
  // 全部路由总览（工单 #24）：页面顶部的折叠清单，默认只露一行摘要。
  // 标题用区块级字号；展开后是真实表格（表头 + 每行一条路由）。
  overviewSummary: {
    display: "flex", alignItems: "center", gap: GAP.xs,
    width: "100%", padding: 0, border: "none", background: "transparent",
    color: "var(--dsw-alias-label-primary, inherit)", fontFamily: "inherit", textAlign: "left",
    cursor: "pointer", fontSize: FONT.section, fontWeight: 600, userSelect: "none", lineHeight: 1.6,
  },
  overviewBody: { display: "flex", flexDirection: "column", gap: GAP.sm, marginTop: GAP.xs },
  overviewStatus: {
    fontSize: FONT.caption, lineHeight: 1.5,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  overviewNote: {
    fontSize: FONT.hint, lineHeight: 1.5,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  overviewTable: { width: "100%", borderCollapse: "collapse", fontSize: FONT.caption },
  overviewTh: {
    padding: "5px 8px", textAlign: "left", verticalAlign: "bottom",
    fontSize: FONT.label, fontWeight: 500,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
    borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.28))",
  },
  overviewTd: { padding: "6px 8px", textAlign: "left", verticalAlign: "middle" },
  // 行可点：hover 反馈与模型行一致（120ms 背景过渡）。
  overviewRow: { cursor: "pointer", transition: `background-color ${ROW_HOVER_MS}ms ease` },
  overviewRowHover: { background: "var(--dsw-alias-interactive-bg-hover, rgba(90,140,230,0.22))" },
  // 当前路由不靠底色（会和 hover 混淆）：首列加 2px 品牌色竖线 + 「当前」徽标。
  overviewRowCurrent: { cursor: "default" },
  overviewTdCurrent: {
    borderLeft: "2px solid var(--dsw-alias-brand-primary, var(--dsw-alias-state-business-primary, currentColor))",
    paddingLeft: 6,
  },
  overviewRouteId: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: 600,
    fontSize: FONT.body, color: "var(--dsw-alias-label-primary, inherit)",
    overflowWrap: "anywhere",
  },
  overviewCurrentBadge: {
    marginLeft: GAP.sm, padding: "1px 6px", borderRadius: RADIUS.sm, fontSize: FONT.hint,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.32))",
  },
  overviewKey: { display: "inline-flex", alignItems: "center", gap: GAP.xs },
  overviewKeyLoading: {
    fontSize: FONT.body,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  overviewActionCell: { textAlign: "right", whiteSpace: "nowrap" },
  overviewSwitch: {
    padding: "3px 9px", fontSize: FONT.hint, borderRadius: RADIUS.sm, cursor: "pointer",
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.32))",
    background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1))",
    color: "var(--dsw-alias-label-primary, inherit)", fontFamily: "inherit", whiteSpace: "nowrap",
  },
  overviewSwitchDisabled: { opacity: 0.6, cursor: "default" },
  // 连接测试结果：文字色直接取宿主 state-* 主色，左侧同色描边再做一层编码；
  // 底色用中性 layer，避免把宿主的实心 secondary 色当成浅色底。
  connectionResult: {
    padding: "8px 10px", borderRadius: RADIUS.sm, fontSize: FONT.caption, lineHeight: 1.55,
    overflowWrap: "anywhere",
    background: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.08))",
    borderTop: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))",
    borderRight: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))",
    borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))",
  },
  connectionSuccess: {
    color: "var(--dsw-alias-state-success-primary, #2f855a)",
    borderLeft: "3px solid var(--dsw-alias-state-success-primary, #2f855a)",
  },
  connectionWarn: {
    color: "var(--dsw-alias-state-warn-primary, #b7791f)",
    borderLeft: "3px solid var(--dsw-alias-state-warn-primary, #b7791f)",
  },
  connectionError: {
    color: "var(--dsw-alias-state-error-primary, #e05252)",
    borderLeft: "3px solid var(--dsw-alias-state-error-primary, #e05252)",
  },
  // 密钥区块：紧贴在 apiKeyEnv 输入框下方，说明「那条引用背后的值」。
  credentialBlock: {
    display: "flex", flexDirection: "column", gap: GAP.sm,
    padding: "9px 11px", borderRadius: RADIUS.sm,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))",
    background: "var(--dsw-alias-bg-base, rgba(128,128,128,0.04))",
  },
  credentialRow: { display: "flex", alignItems: "center", gap: GAP.sm, flexWrap: "wrap" },
  credentialLabel: {
    fontSize: FONT.label, fontWeight: 500, letterSpacing: 0.2,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  // 圆点同时用字形（● / ○）、描边与底色编码：浅色 / 深色下都不只靠颜色区分。
  // 字形本身仍用 label-primary，保证它是「状态文字」而不是低对比装饰。
  credentialDot: {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 16, height: 16, borderRadius: "50%", boxSizing: "border-box",
    fontSize: FONT.hint, lineHeight: 1,
    color: "var(--dsw-alias-label-primary, inherit)",
  },
  credentialDotOn: {
    background: "var(--dsw-alias-state-success-secondary, rgba(80,170,110,0.16))",
    border: "1px solid var(--dsw-alias-state-success-primary, #2f855a)",
  },
  credentialDotOff: {
    background: "transparent",
    border: "1px solid var(--dsw-alias-border-l4, rgba(128,128,128,0.32))",
  },
  // 「未知」不是「未配置」：用问号字形 + 告警色描边 / 淡底，三态在深浅色下
  // 都能只靠字形区分，颜色只是第二重编码。
  credentialDotUnknown: {
    background: "var(--dsw-alias-state-warn-secondary, rgba(220,150,40,0.14))",
    border: "1px solid var(--dsw-alias-state-warn-primary, #b7791f)",
  },
  credentialText: { fontSize: FONT.body, color: "var(--dsw-alias-label-primary, inherit)" },
  credentialActions: { display: "flex", alignItems: "center", gap: GAP.sm, marginLeft: "auto" },
  credentialEditor: { display: "flex", alignItems: "center", gap: GAP.sm, flexWrap: "wrap" },
  credentialInput: { ...INPUT, flex: "1 1 240px" },
  credentialHint: {
    fontSize: FONT.hint, lineHeight: 1.5,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  credentialSuggestion: {
    display: "flex", alignItems: "center", gap: GAP.sm, flexWrap: "wrap",
    fontSize: FONT.hint, lineHeight: 1.5,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  credentialSuggestionRef: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  // 路由默认值说明块：三行语义 + 每个字段的留空后果 / 实时计数。
  // 字号沿用 FONT.hint（工单 #34 3.1），整块只有 11px，避免抢字段的注意力。
  routeDefaults: {
    display: "flex", flexDirection: "column", gap: GAP.xs,
    fontSize: FONT.hint, lineHeight: 1.55, opacity: 0.62,
  },
  // 行内布局：让「3 个模型中有 <button>2 个</button> 会使用」保持一句话。
  routeDefaultLine: { display: "block" },
  // 计数里的「N 个」就地展开模型清单：不用 <details>，既有测试会精确断言
  // details 清单等于投影预览的数量，折叠状态由 Workbench 持有。
  usageToggle: {
    padding: 0, border: "none", background: "transparent", color: "inherit",
    font: "inherit", cursor: "pointer", textDecoration: "underline", textUnderlineOffset: 2,
  },
  usageList: { display: "flex", flexDirection: "column", gap: GAP.xs, margin: "0 0 2px", paddingLeft: 14, listStyle: "none" },
  usageItem: { fontSize: FONT.hint, lineHeight: 1.55, overflowWrap: "anywhere" },
  // 编辑表单顶部：标题 + 收起按钮（工单 #28）。收起与底部「取消」走同一
  // 条退出路径，有未保存改动时禁用，避免手滑丢草稿。
  editorHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    gap: GAP.sm, flexWrap: "wrap",
    paddingBottom: GAP.xs,
    borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.2))",
  },
  editorTitle: {
    fontSize: FONT.section, fontWeight: 600, minWidth: 0,
    overflowWrap: "anywhere", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  // 编辑表单顶部 / 新增表单的模板条（工单 #42）：模板名 + 下拉 + 三个动作，
  // 摘要单独一行，选中哪一份就显示哪一份的数值。
  templateBar: { display: "flex", alignItems: "center", gap: GAP.sm, flexWrap: "wrap" },
  templateBox: { display: "flex", flexDirection: "column", gap: GAP.xs, flex: "1 1 100%" },
  templateSelect: { ...SELECT, minWidth: 160, maxWidth: 260, flex: "0 1 auto" },
  templateSummary: {
    fontSize: FONT.hint, lineHeight: 1.45,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
  // 模板管理面板：每份模板一行，行内改名 / 覆盖 / 删除的二次确认都在原位展开。
  templateManageList: {
    display: "flex", flexDirection: "column",
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))",
    borderRadius: RADIUS.md,
    maxHeight: 320, overflowY: "auto",
  },
  templateManageRow: {
    display: "flex", flexDirection: "column", gap: GAP.xs,
    padding: "6px 8px", fontSize: FONT.caption,
    borderBottom: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.16))",
  },
  templateManageLine: { display: "flex", alignItems: "center", gap: GAP.sm, flexWrap: "wrap", width: "100%" },
  templateManageName: { fontWeight: 600, minWidth: 96, overflowWrap: "anywhere" },
  templateManageEmpty: { padding: "10px 8px", fontSize: FONT.caption, lineHeight: 1.55 },
  modelEditor: {
    display: "flex", flexDirection: "column", gap: GAP.md, marginTop: GAP.xs, padding: "10px 12px",
    borderRadius: RADIUS.sm,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))",
    background: "var(--dsw-alias-bg-base, rgba(128,128,128,0.04))",
  },
  compatibility: {
    padding: "7px 9px", borderRadius: RADIUS.sm, fontSize: FONT.hint, lineHeight: 1.55,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.28))",
    background: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.08))",
  },
  budget: { fontSize: FONT.hint, lineHeight: 1.55, color: "var(--dsw-alias-label-primary, inherit)" },
  budgetWarn: {
    padding: "6px 9px", borderRadius: RADIUS.sm, fontSize: FONT.hint, lineHeight: 1.55,
    // 工单 #40：首次打开的内置预设会填出预算提示；错误色前景在告警底上只有
    // 3.72 对比度。前景继承主文字色（与 s.warn 一致），告警语义由 ⚠ / 边框 /
    // 底色承担，深色与浅色都 ≥ 4.5。
    background: "var(--dsw-alias-state-warn-tertiary, rgba(220,150,40,0.12))",
    border: "1px solid var(--dsw-alias-state-warn-secondary, rgba(220,150,40,0.34))",
  },
  budgetSuggestion: { marginTop: 2, opacity: 0.92 },
  editorFooter: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: GAP.sm, flexWrap: "wrap" },
  btnDanger: {
    padding: "7px 14px", fontSize: FONT.body, borderRadius: RADIUS.sm, cursor: "pointer",
    border: "1px solid var(--dsw-alias-state-error-primary, rgba(220,80,80,0.55))",
    // 实心错误色 + 前景反色：浅色下白字 / 深色下深字，两边都 ≥ 4.5。
    background: "var(--dsw-alias-state-error-primary, rgba(220,80,80,0.9))",
    color: "var(--dsw-alias-label-primary-foreground, #fff)", fontFamily: "inherit", fontWeight: 600,
  },
  warn: {
    padding: "8px 10px", borderRadius: RADIUS.sm, fontSize: FONT.caption, lineHeight: 1.55,
    background: "var(--dsw-alias-state-warn-tertiary, rgba(220,150,40,0.12))",
    border: "1px solid var(--dsw-alias-state-warn-secondary, rgba(220,150,40,0.34))",
  },
  err: {
    padding: "8px 10px", borderRadius: RADIUS.sm, fontSize: FONT.caption, lineHeight: 1.55,
    background: "var(--dsw-alias-state-error-secondary, rgba(220,80,80,0.12))",
    border: "1px solid var(--dsw-alias-state-error-primary, rgba(220,80,80,0.34))",
  },
  ok: {
    padding: "8px 10px", borderRadius: RADIUS.sm, fontSize: FONT.caption, lineHeight: 1.55,
    background: "var(--dsw-alias-state-success-secondary, rgba(80,170,110,0.12))",
    border: "1px solid var(--dsw-alias-state-success-primary, rgba(80,170,110,0.34))",
  },
  // 常驻 live region 的空闲态：视觉隐藏但仍留在无障碍树里（读屏要能感知
  // 后续的文字变化）。不占版面、不改变布局。
  toastIdle: {
    position: "absolute", width: 1, height: 1, margin: -1, padding: 0, border: 0,
    overflow: "hidden", clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap",
  },
  btn: {
    padding: "7px 14px", fontSize: FONT.body, borderRadius: RADIUS.sm, cursor: "pointer",
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.36))",
    background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.12))",
    color: "var(--dsw-alias-label-primary, inherit)", fontFamily: "inherit",
  },
  btnSmall: {
    padding: "3px 9px", fontSize: FONT.hint, borderRadius: RADIUS.sm, cursor: "pointer",
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.32))",
    background: "var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.1))",
    color: "var(--dsw-alias-label-primary, inherit)", fontFamily: "inherit",
  },
  btnLink: {
    padding: "2px 0", margin: 0, fontSize: FONT.hint, cursor: "pointer",
    border: "none", background: "transparent", color: "var(--dsw-alias-label-primary, inherit)",
    textDecoration: "underline", fontFamily: "inherit", opacity: 0.8,
  },
  levels: { display: "flex", flexDirection: "column", gap: GAP.xs, flex: "1 1 340px", minWidth: 280 },
  // 「API 参数值」高级区：每个勾选中的档位一行，输入框复用 s.input 的 token。
  wireRows: { display: "flex", flexDirection: "column", gap: GAP.sm, paddingTop: GAP.sm },
  wireRow: { display: "flex", alignItems: "center", gap: GAP.sm, flexWrap: "wrap" },
  wireLevel: {
    fontSize: FONT.caption, fontWeight: 600, minWidth: 64,
    color: "var(--dsw-alias-label-primary, inherit)",
  },
  wireInput: { ...INPUT, flex: "1 1 220px" },
  // 七个推理档位是固定集合：不折行，窄容器下横向滚动，顺序始终可读。
  levelChips: {
    display: "flex", flexWrap: "nowrap", overflowX: "auto", overflowY: "hidden",
    gap: GAP.xs, paddingBottom: 2, maxWidth: "100%",
  },
  levelChip: {
    display: "inline-flex", alignItems: "center", gap: GAP.xs, flex: "0 0 auto",
    padding: "3px 8px", borderRadius: RADIUS.sm, fontSize: FONT.hint, whiteSpace: "nowrap",
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))",
    background: "transparent", color: "var(--dsw-alias-label-primary, inherit)", cursor: "pointer",
  },
  chip: {
    display: "inline-flex", alignItems: "center", gap: GAP.xs, padding: "3px 8px",
    borderRadius: RADIUS.sm, fontSize: FONT.hint,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))",
    background: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.1))",
    color: "var(--dsw-alias-label-primary, inherit)",
  },
  // 工单 #41：选中态不再只靠填充深浅，而是四条冗余通道同时表达 ——
  //   填充：主题强调色实底（深浅主题各自跟随 state-business-primary）；
  //   边框：2px 强调色，未选中只有 1px；
  //   字重：600（未选中 400）；
  //   勾选标记：文字前的固定宽度 ✓ 槽（见 ToggleMark）。
  // 选中态每边内边距少 1px，正好抵消边框多出的 1px：连续点击时内容位置与
  // offsetWidth / offsetHeight 都不变，不会带着整行抖动。
  toggleOn: {
    background: "var(--dsw-alias-state-business-primary, rgba(90,140,230,0.75))",
    border: "2px solid var(--dsw-alias-state-business-primary, rgba(90,140,230,0.75))",
    // 强调色实底上必须用「主色前景」而不是 label-primary：暗色主题里
    // label-primary 是浅色，压在浅蓝强调色上只有 2 左右的对比度。
    color: "var(--dsw-alias-label-primary-foreground, var(--dsw-alias-label-primary, inherit))",
    fontWeight: 600,
    padding: "2px 7px",
    boxSizing: "border-box",
    lineHeight: 1.4,
  },
  toggleOff: {
    background: "var(--dsw-alias-bg-base, transparent)",
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.32))",
    fontWeight: 400,
    padding: "3px 8px",
    boxSizing: "border-box",
    lineHeight: 1.4,
  },
  // 停用态既不是选中也不是可用：虚线边框 + 半透明 + 禁止光标。
  toggleDisabled: { cursor: "not-allowed", borderStyle: "dashed", opacity: 0.5 },
  // 固定宽度标记槽：未选中渲染不换行空格，选中渲染 ✓，宽度不抖动。
  toggleMark: { display: "inline-block", width: "1em", textAlign: "center" },
  btnPrimary: {
    padding: "7px 14px", fontSize: FONT.body, borderRadius: RADIUS.sm, cursor: "pointer",
    border: "1px solid var(--dsw-alias-state-business-primary, rgba(90,140,230,0.55))",
    background: "var(--dsw-alias-button-primary-fill, rgba(90,140,230,0.22))",
    // 铺在 brand 底色上的前景色与「页面正文色」互为正反 —— 用 label-primary
    // 会在深浅两个主题下都得到 1.00 对比度（工单 #24 问题 1）。
    color: "var(--dsw-alias-label-primary-foreground, #fff)",
    fontFamily: "inherit", fontWeight: 600,
  },
  // 选择器弹窗：全部用 --dsw-* token 并带 fallback，深浅色都跟随宿主主题。
  // overlay 必须 fixed —— 设置页有滚动容器，absolute 会被裁掉。
  overlay: {
    position: "fixed", inset: 0, zIndex: 100,
    background: "rgba(0,0,0,0.45)",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  dialog: {
    width: "min(560px, calc(100vw - 32px))",
    maxHeight: "min(640px, calc(100vh - 64px))",
    display: "flex", flexDirection: "column",
    borderRadius: RADIUS.lg, padding: GAP.md, gap: GAP.sm,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.32))",
    background: "var(--dsw-alias-bg-layer-1, Canvas)",
    color: "var(--dsw-alias-label-primary, inherit)",
    colorScheme: "inherit",
    boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
  },
  pickerHeader: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: GAP.sm },
  pickerList: {
    flex: "1 1 auto", overflowY: "auto", minHeight: 160,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.24))",
    borderRadius: RADIUS.md, padding: GAP.xs,
  },
  pickerRow: {
    display: "flex", alignItems: "center", gap: GAP.sm, padding: "5px 8px",
    fontSize: FONT.caption, borderRadius: RADIUS.sm, cursor: "pointer",
  },
  pickerRowSelected: { background: "var(--dsw-alias-interactive-bg-hover, rgba(90,140,230,0.22))" },
  pickerRowDisabled: { opacity: 0.45, cursor: "not-allowed" },
  pickerId: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  pickerHint: { fontSize: FONT.hint, opacity: 0.65 },
  pickerFooter: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: GAP.sm, flexWrap: "wrap" },
  // 新建路由弹窗：来源（目录 / 自定义）是单选，两组字段互斥显示。
  // 控件、列表、遮罩全部复用选择器的样式体系，只补一个居中的来源行。
  modeRow: {
    display: "flex", alignItems: "center", gap: GAP.lg, flexWrap: "wrap",
    padding: "2px 2px 0",
  },
  modeOption: {
    display: "inline-flex", alignItems: "center", gap: GAP.xs,
    fontSize: FONT.caption, cursor: "pointer", userSelect: "none",
  },
  // 目录列表在弹窗里占固定高度，搜索词变化只增减行，不推挤底部按钮。
  createList: { minHeight: 176, maxHeight: 260, flex: "1 1 176px" },
  createModelField: { flex: "1 1 100%" },
};

/**
 * 工单 #41：固定宽度的勾选标记槽。
 *
 * 未选中渲染不换行空格而不是空字符串 —— 槽宽恒定，切换时按钮宽度不跳；
 * ✓ 对读屏是冗余信息（原生 checkbox / aria-pressed 已经表达状态），故隐藏。
 */
function ToggleMark({ on }) {
  return <span style={s.toggleMark} aria-hidden="true">{on ? "✓" : "\u00a0"}</span>;
}

/** 字段标签后的说明入口：常驻文案只剩 ⓘ，完整说明放进原生 title 悬停。 */
function Tip({ text }) {
  const value = typeof text === "string" ? text.trim() : "";
  if (value === "") return null;
  return (
    <span style={s.tip} role="img" aria-label={value} title={value}>
      ⓘ
    </span>
  );
}

function Field({ label, children, hint, error, style }) {
  return (
    <label style={style === undefined ? s.field : { ...s.field, ...style }}>
      <span style={s.label}>{label}<Tip text={hint} /></span>
      {children}
      <div style={s.hintLine}>
        {error ? <span style={s.fieldError}>{error}</span> : null}
      </div>
    </label>
  );
}

/**
 * token 数值输入 + 自定义候选下拉。
 *
 * 不用原生 datalist：datalist 会按当前输入值过滤候选项，选中一个之后
 * 其余的就不再可见（工单问题 1）。这里始终渲染完整候选列表。
 */
function TokenCountField({ label, hint, value, candidates, error, note, placeholder, ariaLabel, closeSignal, onChange }) {
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef(null);

  // 选择器弹窗打开时收起候选面板：浮层不与弹窗并存（与旧版行为一致）。
  React.useEffect(() => {
    if (closeSignal) setOpen(false);
  }, [closeSignal]);

  // 点击面板外部或按 Esc 关闭。
  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (boxRef.current !== null && !boxRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <label style={s.field}>
      <span style={s.label}>{label}<Tip text={hint} /></span>
      <div ref={boxRef} style={s.comboBox}>
        <input
          style={s.input}
          value={value}
          onChange={onChange}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          inputMode="numeric"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="none"
        />
        <button
          type="button"
          style={s.comboToggle}
          onClick={() => setOpen((current) => !current)}
          aria-label="展开候选"
          tabIndex={-1}
        >
          ▾
        </button>
        {open ? (
          <div style={s.comboPanel} role="listbox">
            {/* 全部候选，不过滤；当前值高亮 */}
            {candidates.map((n) => (
              <button
                key={n}
                type="button"
                role="option"
                aria-selected={String(n) === value}
                style={String(n) === value ? { ...s.comboItem, ...s.comboItemActive } : s.comboItem}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChange({ target: { value: String(n) } });
                  setOpen(false);
                }}
              >
                {n} <span style={s.comboItemHint}>{humanizeTokenCount(n)}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {/* 固定高度提示行，见问题 3 */}
      <div style={s.hintLine}>
        {error ? (
          <span style={s.fieldError}>请输入正整数</span>
        ) : humanizeTokenCount(value) !== "" ? (
          <span style={s.fieldHint}>{humanizeTokenCount(value)}</span>
        ) : null}
      </div>
      {/* 工单 #38：清空 = 删除字段；提示只在真正会写入删除时出现 */}
      {note ? <div style={s.fieldHint} role="note">{note}</div> : null}
    </label>
  );
}

/**
 * 拉取结果选择器。
 *
 * 勾选集合由父组件持有：改搜索词只影响 visible，不影响 selected ——
 * 因此过滤后勾选状态不丢；关窗时父组件重置集合。
 *
 * 工单 #43 缺陷 1：批量写入用哪一份模板、会写进哪些值，必须在勾选区上方说清楚。
 * `templateFallback` 表示这一份是库为空时的隐式回落（不是用户为此配置过的模板）。
 */
function ModelPicker({
  models,
  existing,
  templateLabel,
  templateKind,
  templateValues,
  templateFallback,
  overridesInUse,
  catalogWarning,
  busy,
  query,
  selected,
  ackReplacement,
  onQueryChange,
  onToggle,
  onSelectAll,
  onAckChange,
  onConfirm,
  onCancel,
}) {
  const dialogRef = React.useRef(null);
  const searchRef = React.useRef(null);

  React.useEffect(() => {
    if (searchRef.current !== null) searchRef.current.focus();
  }, []);

  const entries = classifyModels(models, existing);
  const statusById = new Map(entries.map((entry) => [entry.id, entry]));
  const visible = filterModels(models, query)
    .map((id) => statusById.get(id))
    .filter((entry) => entry !== undefined);
  const selectable = entries.filter((entry) => entry.status === "new");
  const allSelected = selectable.length > 0 && selectable.every((entry) => selected.has(entry.id));
  const selectedEntries = entries.filter((entry) => selected.has(entry.id));
  const writableCount = selectedEntries.filter((entry) => entry.status === "new").length;
  // 跳过计数描述整批拉取结果中被排除的条目，而不是只有用户勾中的冲突项。
  const skippedExists = entries.filter((entry) => entry.status === "exists").length;
  const skippedCasefold = entries.filter((entry) => entry.status === "casefold").length;
  // 目录路由的批量替换必须先确认；单条选择只是回填模型 ID，不需要。
  const acknowledgementMissing = catalogWarning && selected.size >= 2 && !ackReplacement;
  const canConfirm =
    !busy &&
    !overridesInUse &&
    selected.size > 0 &&
    !acknowledgementMissing &&
    !(selected.size >= 2 && writableCount === 0);

  /** Esc 关闭、Enter 确认、Tab 在弹窗内循环。 */
  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key === "Enter") {
      if (event.target?.tagName === "BUTTON" || event.target?.tagName === "TEXTAREA") return;
      if (canConfirm) {
        event.preventDefault();
        onConfirm();
      }
      return;
    }
    if (event.key !== "Tab") return;
    const root = dialogRef.current;
    if (root === null) return;
    const focusables = [...root.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !root.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      style={s.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        style={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="选择模型"
        onKeyDown={handleKeyDown}
      >
        <div style={s.pickerHeader}>
          <span style={s.h}>选择模型</span>
          <span style={s.pickerHint}>已拉取 {models.length} 个</span>
        </div>

        <input
          ref={searchRef}
          style={s.input}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索模型 ID…"
          aria-label="搜索模型"
        />

        {/* 工单 #43 缺陷 1：勾选区上方说明批量写入用的是哪一份模板、具体写入值。 */}
        <div style={s.pickerHint} role="note" data-modelpilot-batch-template>
          {batchTemplateHint({
            label: templateLabel,
            kind: templateKind,
            values: templateValues,
            fallback: templateFallback,
          })}
        </div>

        <label style={{ ...s.pickerRow, cursor: selectable.length === 0 ? "not-allowed" : "pointer" }}>
          <input
            type="checkbox"
            checked={allSelected}
            disabled={selectable.length === 0}
            onChange={() => onSelectAll(!allSelected)}
          />
          <span style={s.pickerId}>全选（可选 {selectable.length} 个）</span>
        </label>

        <div style={s.pickerList}>
          {visible.length === 0 ? (
            <div style={{ ...s.pickerHint, padding: "8px" }}>没有匹配的模型</div>
          ) : visible.map((entry) => {
            const disabled = entry.status === "exists";
            return (
              <label
                key={entry.id}
                style={disabled ? { ...s.pickerRow, ...s.pickerRowDisabled } : s.pickerRow}
              >
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={selected.has(entry.id)}
                  onChange={() => onToggle(entry.id)}
                  aria-label={entry.id}
                />
                <span style={s.pickerId}>{entry.id}</span>
                {entry.status === "exists" ? (
                  <span style={s.pickerHint}>已存在</span>
                ) : entry.status === "casefold" ? (
                  <span style={s.pickerHint}>仅大小写不同</span>
                ) : null}
              </label>
            );
          })}
        </div>

        {catalogWarning ? (
          <label style={{ ...s.warn, display: "flex", gap: GAP.sm, alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={ackReplacement}
              onChange={(event) => onAckChange(event.target.checked)}
              style={{ marginTop: 2 }}
              aria-label="确认目录替换"
            />
            <span>
              该路由的模型来自内置目录，批量写入会<b>整体替换</b>目录。我确认继续。
            </span>
          </label>
        ) : null}

        {overridesInUse ? (
          <div style={s.err}>
            该路由已有旧的模型覆盖设置，写入会被拒绝，无法批量写入。请先清除这些覆盖。
          </div>
        ) : null}

        <div style={s.pickerFooter}>
          <span style={s.pickerHint}>
            将写入 {writableCount} 条模型；已跳过 {skippedExists} 条已存在、{skippedCasefold} 条仅大小写不同
          </span>
          <span style={{ display: "flex", gap: GAP.sm }}>
            <button type="button" style={s.btn} onClick={onCancel}>取消</button>
            <button
              type="button"
              style={canConfirm ? s.btnPrimary : { ...s.btn, opacity: 0.5, cursor: "not-allowed" }}
              disabled={!canConfirm}
              onClick={onConfirm}
            >
              确定（{selected.size}）
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * 新建路由弹窗（工单 #21）。
 *
 * 只负责渲染，状态全部放在 Workbench —— 与路由设置卡片同样的取舍，避免
 * 测试用最小渲染器在条件展开时丢失 hook 槽。视觉复用 ModelPicker 的
 * overlay / dialog / pickerRow 体系，但逻辑不同：这里从宿主目录选提供商，
 * 不去端点拉模型。
 */
function NewRouteDialog({
  mode,
  catalogStatus,
  catalogError,
  catalogTotal,
  query,
  rows,
  selectedId,
  providerId,
  providerIdError,
  providerIdHint,
  baseURL,
  baseURLError,
  baseURLHint,
  baseURLNote,
  api,
  apiChoices,
  apiKeyEnv,
  modelIds,
  modelsError,
  modelsHint,
  catalogKnown,
  catalogProviderName,
  busy,
  error,
  canCreate,
  focusRef,
  onModeChange,
  onQueryChange,
  onSelectProvider,
  onProviderIdChange,
  onProviderIdBlur,
  onBaseURLChange,
  onBaseURLBlur,
  onApplyBaseURLPreset,
  onApiChange,
  onApiKeyEnvChange,
  onModelIdsChange,
  onCancel,
  onConfirm,
  onRetryCatalog,
}) {
  const custom = mode === "custom";
  const footerHint = custom
    ? catalogKnown
      ? "目录已收录这条路由，创建时无需列出模型。"
      : "目录外的路由至少列出 1 条模型，否则会被拒绝。"
    : "从目录选择；已配置的路由不能重复创建。";

  return (
    <div
      style={s.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div style={s.dialog} role="dialog" aria-modal="true" aria-label="新建路由">
        <div style={s.pickerHeader}>
          <span style={s.h}>新建路由<Tip text={footerHint} /></span>
          <span style={s.pickerHint}>
            {custom ? "手填一个目录里没有的提供商" : `目录 ${catalogTotal} 个`}
          </span>
        </div>

        <div style={s.modeRow} role="radiogroup" aria-label="提供商来源">
          <label style={s.modeOption}>
            <input
              type="radio"
              name="modelpilot-new-route-mode"
              checked={!custom}
              onChange={() => onModeChange("catalog")}
              aria-label="从目录选择"
            />
            从目录选择
          </label>
          <label style={s.modeOption}>
            <input
              type="radio"
              name="modelpilot-new-route-mode"
              checked={custom}
              onChange={() => onModeChange("custom")}
              aria-label="自定义"
            />
            自定义
          </label>
        </div>

        {custom ? (
          <>
            <div style={s.row}>
              <Field label="provider id" error={providerIdError} hint={providerIdHint} style={{ flex: "1 1 220px" }}>
                <input
                  ref={focusRef}
                  style={s.input}
                  value={providerId}
                  onChange={(event) => onProviderIdChange(event.target.value)}
                  onBlur={onProviderIdBlur}
                  placeholder="如 my-relay"
                  aria-label="provider id"
                />
              </Field>
              <Field label="接口地址" error={baseURLError} hint={baseURLHint} style={{ flex: "1 1 220px" }}>
                <input
                  style={s.input}
                  value={baseURL}
                  onChange={(event) => onBaseURLChange(event.target.value)}
                  onBlur={onBaseURLBlur}
                  placeholder="https://relay.example.com/v1"
                  aria-label="接口地址"
                />
              </Field>
            </div>
            <div style={s.templateBar} role="group" aria-label="常见接口地址格式">
              <span style={s.fieldHint}>常见格式：</span>
              {BASE_URL_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  style={{ ...s.chip, cursor: "pointer", fontFamily: "inherit" }}
                  aria-label={`接口地址预设 ${preset.label}`}
                  title={preset.id === "empty" ? "清空接口地址，自己输入" : `填入 ${RELAY_BASE_URL_SHAPE} 的形状，并把协议切成 ${preset.api}`}
                  onClick={() => onApplyBaseURLPreset(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {baseURLNote !== "" ? (
              <div style={s.fieldHint} role="status">{baseURLNote}</div>
            ) : null}
            <div style={s.row}>
              <Field label="协议" style={{ flex: "1 1 220px" }}>
                <select
                  style={s.select}
                  value={api}
                  onChange={(event) => onApiChange(event.target.value)}
                  aria-label="协议"
                >
                  {apiChoices.map((choice) => (
                    <option key={choice} value={choice}>{choice}</option>
                  ))}
                </select>
              </Field>
              <Field label="密钥引用" hint="只写引用名，真值在创建后设置" style={{ flex: "1 1 220px" }}>
                <input
                  style={s.input}
                  value={apiKeyEnv}
                  onChange={(event) => onApiKeyEnvChange(event.target.value)}
                  placeholder="如 MY_RELAY_API_KEY"
                  aria-label="密钥引用"
                />
              </Field>
            </div>
            {catalogKnown ? (
              <div style={s.fieldHint}>
                目录已收录该提供商（{catalogProviderName}），无需列出模型。
              </div>
            ) : (
              <Field
                label="模型 ID（至少一条）"
                error={modelsError}
                hint={modelsHint}
                style={s.createModelField}
              >
                <input
                  style={s.input}
                  value={modelIds}
                  onChange={(event) => onModelIdsChange(event.target.value)}
                  placeholder="如 relay/alpha, relay/beta"
                  aria-label="模型 ID"
                />
              </Field>
            )}
          </>
        ) : (
          <>
            <input
              ref={focusRef}
              style={s.input}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="搜索 provider id…"
              aria-label="搜索提供商"
            />
            <div style={{ ...s.pickerList, ...s.createList }} role="listbox" aria-label="可配置提供商">
              {catalogStatus === "loading" ? (
                <div style={{ ...s.pickerHint, padding: "8px" }}>正在读取目录…</div>
              ) : catalogStatus === "failed" ? (
                <div style={s.err}>
                  目录读取失败：{catalogError || "未返回原因"}
                  <button type="button" style={{ ...s.btnSmall, marginLeft: GAP.sm }} onClick={onRetryCatalog}>
                    重试
                  </button>
                </div>
              ) : rows.length === 0 ? (
                <div style={{ ...s.pickerHint, padding: "8px" }}>没有匹配的提供商</div>
              ) : rows.map((row) => {
                const selected = selectedId === row.provider;
                const rowStyle = row.configured
                  ? { ...s.pickerRow, ...s.pickerRowDisabled }
                  : selected
                    ? { ...s.pickerRow, ...s.pickerRowSelected }
                    : s.pickerRow;
                return (
                  <label key={row.provider} style={rowStyle}>
                    <input
                      type="radio"
                      name="modelpilot-new-route-provider"
                      disabled={row.configured}
                      checked={selected}
                      onChange={() => onSelectProvider(row.provider)}
                      aria-label={row.provider}
                    />
                    <span style={s.pickerId}>{row.provider}</span>
                    {row.displayName !== row.provider ? (
                      <span style={s.pickerHint}>{row.displayName}</span>
                    ) : null}
                    <span style={s.pickerHint}>{row.configured ? "已配置" : "未配置"}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {error ? <div style={s.err}>{error}</div> : null}

        <div style={s.pickerFooter}>
          <span style={{ display: "flex", alignItems: "center", gap: GAP.sm, marginLeft: "auto" }}>
            <button
              type="button"
              style={busy ? { ...s.btn, opacity: 0.55, cursor: "not-allowed" } : s.btn}
              disabled={busy}
              onClick={onCancel}
            >
              取消
            </button>
            <button
              type="button"
              style={canCreate ? s.btnPrimary : { ...s.btn, opacity: 0.5, cursor: "not-allowed" }}
              disabled={!canCreate}
              onClick={onConfirm}
            >
              {busy ? "创建中…" : "创建路由"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * maxTokens 的实时影响提示：按 DSH 默认压缩策略估算可用上下文。
 *
 * 窗口或输出为空 / 非法时不渲染，避免显示 0 或 NaN；两处（新增 / 编辑）
 * 复用同一个 estimateContextBudget。具体数字放在输入框下面，底部还有一段
 * 抽象说明。
 *
 * 小窗口装不下 64K 缓冲时（工单 #35）不显示「可用上下文 0」这类数字，而是
 * 用一句话说明任何输出都会立刻触发压缩；窗口连零损失边界都达不到时，
 * 也不再显示「建议 ≤ … 可零损失」这种做不到的建议。
 */
function BudgetHint({ contextWindow, maxTokens }) {
  const windowValue = tokenInputOf(contextWindow);
  const outputValue = tokenInputOf(maxTokens);
  if (windowValue === undefined || outputValue === undefined) return null;
  const estimate = estimateContextBudget(windowValue, outputValue);
  if (estimate === null) return null;

  const explanation = <div style={s.fieldHint}>按默认压缩策略估算；实际以运行时为准。</div>;

  if (estimate.exhausted) {
    return (
      <div style={s.budgetWarn} role="status">
        ⚠ 这个上下文窗口小于 64K 缓冲，任何输出都会立刻触发压缩。建议提高 contextWindow。
        {explanation}
      </div>
    );
  }

  if (estimate.ok) {
    return (
      <div style={s.budget} role="status">
        可用上下文 {formatTokenNumber(estimate.threshold)}（零损失 ✓）
        {explanation}
      </div>
    );
  }

  const severe = estimate.loss > 0.1;
  const percent = (estimate.loss * 100).toFixed(1);
  return (
    <div style={severe ? s.budgetWarn : s.budget} role="status">
      {severe ? "⚠ " : ""}可用上下文 {formatTokenNumber(estimate.threshold)}（比最优少 {percent}%）
      {estimate.freeBoundary > 0 ? (
        <div style={s.budgetSuggestion}>建议 ≤ {formatTokenNumber(estimate.freeBoundary)} 可零损失</div>
      ) : (
        <div style={s.budgetSuggestion}>这个上下文窗口即使不设输出上限也无法做到零损失；建议提高 contextWindow。</div>
      )}
      {explanation}
    </div>
  );
}

const EDIT_FIELD_LABELS = Object.freeze({
  name: "显示名",
  contextWindow: "上下文窗口",
  maxTokens: "输出上限",
  input: "输入模态",
  reasoning: "推理档位",
});

// 与内置模型页 modelReasoningHelpText 同一段说明（工单 #23 验收 16）。
const REASONING_WIRE_HELP_TEXT =
  "API 参数值会写进请求的推理强度字段，默认与档位名相同；如有不同，以模型提供商的文档为准。Off 表示关闭思考，不需要参数值；已写入的值会保留并发送。";

/**
 * 推理档位的「API 参数值」高级区。
 *
 * 默认折叠：日常只看见 chip 组；展开后每个勾选中的非 off 档位一行输入框。
 * 留空 = 用档位名，不写空串；off 没有输入框；与档位名相同的值不写入
 * wireMap。折叠摘要会给出「N 个档位与档位名不同」，让用户不展开也能知道
 * 当前有自定义映射。组件无 hook，供测试夹具直接展开。
 */
function ReasoningApiValues({ levels, apiValues, ariaPrefix, onChange }) {
  const rows = PI_AI_LEVELS.filter((level) => level !== "off" && levels.includes(level));
  const customCount = customReasoningWireCount(levels, apiValues);
  const summary = customCount === 0
    ? "自定义 API 参数值（全部与档位名相同）"
    : `自定义 API 参数值（${customCount} 个档位与档位名不同）`;
  return (
    <details style={s.details} aria-label={`${ariaPrefix}自定义 API 参数值`}>
      <summary style={s.summary}>{summary}</summary>
      <div style={s.wireRows}>
        {rows.length === 0 ? (
          <div style={s.fieldHint}>先勾选至少一个思考档位，才能填写 API 参数值。</div>
        ) : rows.map((level) => (
          <label key={level} style={s.wireRow}>
            <span style={s.wireLevel}>{level}</span>
            <input
              style={s.wireInput}
              value={apiValues?.[level] ?? ""}
              placeholder={level}
              aria-label={`${ariaPrefix} API 参数值 ${level}`}
              onChange={(event) => onChange(level, event.target.value)}
            />
          </label>
        ))}
        <div style={s.fieldHint}>ⓘ 留空 = 与档位名相同。Off 不需要参数值。</div>
        <div style={s.fieldHint}>{REASONING_WIRE_HELP_TEXT}</div>
      </div>
    </details>
  );
}

/**
 * 模板条（工单 #42）：新增模型表单与编辑模型表单共用同一个组件。
 *
 * 结构：`模板 [下拉] [填入] [存为新模板] [管理]` + 下一行摘要。下拉列出用户模板
 * （按库顺序）+ 分隔线 + 三份内置预设（标「内置」、只读）。组件本身无 hook：
 * 状态、库与当前表单值都在 Workbench，「存为新模板」与「用当前值覆盖」因此
 * 能读到触发它的那个表单。
 */
function TemplatePicker({ ariaLabel, value, library, summary, onSelect, onFill, onSaveAsNew, onManage }) {
  // 工单 #43 缺陷 4：库满 20 份时「存为新模板」直接禁用，不再让用户点开一个
  // 注定失败的对话框。Workbench 按 mode 记住是哪个按钮打开的对话框
  // （缺陷 3），关闭后把焦点还给它。
  const full = library.templates.length >= TEMPLATE_MAX_COUNT;
  return (
    <div style={s.templateBox} role="group" aria-label={ariaLabel}>
      <div style={s.templateBar}>
        <span style={s.label}>模板</span>
        <select
          style={s.templateSelect}
          value={value}
          aria-label="选择模板"
          title="选一份模板；「填入」只改表单，不写配置"
          onChange={(event) => onSelect(event.target.value)}
        >
          {library.templates.map((template) => (
            <option key={template.id} value={templateSelectionValue({ kind: "user", id: template.id })} data-template-kind="user">
              {template.name}
            </option>
          ))}
          {library.templates.length > 0 ? <option value="" disabled>────────</option> : null}
          {MODEL_PRESETS.map((preset) => (
            <option key={preset.id} value={templateSelectionValue({ kind: "builtin", id: preset.id })} data-template-kind="builtin">
              {preset.label}（内置）
            </option>
          ))}
        </select>
        <button type="button" style={s.btnSmall} onClick={onFill} aria-label="填入模板">填入</button>
        <button
          type="button"
          style={full ? { ...s.btnSmall, ...s.btnDisabled } : s.btnSmall}
          disabled={full}
          onClick={onSaveAsNew}
          aria-label="存为新模板"
          {...(full ? { title: `已保存 ${TEMPLATE_MAX_COUNT} 份，先删除一份再新增` } : null)}
        >
          存为新模板
        </button>
        <button type="button" style={s.btnSmall} onClick={onManage} aria-label="管理模板">
          管理
        </button>
      </div>
      <span style={s.templateSummary}>{summary}</span>
    </div>
  );
}

/**
 * 「存为新模板」的小对话框（工单 #42）：只有一个名称输入。
 * 名称为空 / 超长 / 重名时就地报错、不关窗；Enter 保存、Esc 取消。
 *
 * 工单 #43 缺陷 3：role="dialog" + aria-modal 就要真的管焦点 —— 打开时聚焦名称
 * 输入（useDialogFocus 在 Workbench 里做），Tab 圈在对话框内，关闭时还焦点。
 */
function TemplateNameDialog({ name, error, dialogRef, onTrapTab, onChange, onCancel, onConfirm }) {
  return (
    <div
      style={s.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        style={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="存为新模板"
        onKeyDown={(event) => {
          if (onTrapTab(event)) return;
          if (event.key === "Escape") onCancel();
          if (event.key === "Enter" && event.target.tagName === "INPUT") onConfirm();
        }}
      >
        <div style={s.pickerHeader}>
          <span style={{ ...s.h, minWidth: 0, overflowWrap: "anywhere" }}>存为新模板</span>
          <span style={s.pickerHint}>当前表单值</span>
        </div>
        <label style={s.field}>
          <span style={s.label}>模板名称</span>
          <input
            style={s.input}
            value={name}
            maxLength={TEMPLATE_NAME_MAX_LENGTH}
            placeholder="如 我的 128K 对话"
            aria-label="模板名称"
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
        {error === "" ? null : <div style={s.err} role="alert">{error}</div>}
        <div style={s.pickerFooter}>
          <span style={s.pickerHint}>最多 {TEMPLATE_NAME_MAX_LENGTH} 个字，不能与库里的其他模板重名</span>
          <span style={{ display: "flex", gap: GAP.sm }}>
            <button type="button" style={s.btn} onClick={onCancel} aria-label="取消保存模板">取消</button>
            <button type="button" style={s.btnPrimary} onClick={onConfirm} aria-label="保存模板">保存</button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * 模板管理面板（工单 #42）：列出库里每一份，行内改名 / 用当前值覆盖 / 删除。
 *
 * 「用当前值覆盖」与「删除」都在原位二次确认：覆盖回答「会覆盖原有参数」，
 * 删除写明「删除后这一份参数不可恢复」。面板本身无 hook，状态在 Workbench。
 *
 * 工单 #43 缺陷 3 / 6：焦点由 Workbench 的 useDialogFocus 管（打开 / Tab / 关闭）；
 * Esc 分层 —— 二次确认展开时先收起确认，再按一次才关面板。
 */
function TemplateManagePanel({
  library,
  state,
  dialogRef,
  renameInputRef,
  onTrapTab,
  currentSummary,
  onClose,
  onBeginRename,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onRequestOverwrite,
  onRequestDelete,
  onConfirmOverwrite,
  onConfirmDelete,
  onCancelConfirm,
}) {
  return (
    <div
      style={s.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        // 工单 #42：模板管理比通用弹窗宽一点 —— 一行要放下名字 + 三个动作。
        style={{ ...s.dialog, width: "min(640px, calc(100vw - 32px))" }}
        role="dialog"
        aria-modal="true"
        aria-label="模板管理"
        onKeyDown={(event) => {
          if (onTrapTab(event)) return;
          if (event.key !== "Escape") return;
          // 工单 #43 缺陷 6：有二次确认时 Esc 只收起确认，不整块关掉面板 ——
          // 与行内改名输入的处理保持一致，用户展开的状态不丢。
          if (state.confirmOverwriteId !== null || state.confirmDeleteId !== null) {
            event.stopPropagation();
            onCancelConfirm();
            return;
          }
          onClose();
        }}
      >
        <div style={s.pickerHeader}>
          <span style={{ ...s.h, minWidth: 0, overflowWrap: "anywhere" }}>模板管理</span>
          <span style={s.pickerHint}>{library.templates.length} / {TEMPLATE_MAX_COUNT} 份</span>
        </div>
        <div style={s.templateManageList}>
          {library.templates.map((template) => {
            const renaming = state.renameId === template.id;
            const overwriting = state.confirmOverwriteId === template.id;
            const deleting = state.confirmDeleteId === template.id;
            return (
              <div key={template.id} style={s.templateManageRow} aria-label={`模板 ${template.name}`}>
                <div style={s.templateManageLine}>
                  {renaming ? (
                    <input
                      ref={renameInputRef}
                      style={{ ...s.input, minWidth: 120 }}
                      value={state.renameName}
                      maxLength={TEMPLATE_NAME_MAX_LENGTH}
                      aria-label="重命名模板输入"
                      onChange={(event) => onRenameChange(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") onRenameCommit();
                        if (event.key === "Escape") {
                          // 先就地取消改名，不再冒泡到面板的 Esc（那会整块关掉）。
                          event.stopPropagation();
                          onRenameCancel();
                        }
                      }}
                    />
                  ) : (
                    <span style={s.templateManageName}>{template.name}</span>
                  )}
                  <span style={{ flex: "1 1 auto" }} />
                  {renaming ? (
                    <>
                      <button type="button" style={s.btnSmall} onClick={onRenameCommit} aria-label="确认改名">确认</button>
                      <button type="button" style={s.btnLink} onClick={onRenameCancel} aria-label="取消改名">取消</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      style={s.btnLink}
                      onClick={() => onBeginRename(template)}
                      aria-label={`改名 ${template.name}`}
                    >
                      改名
                    </button>
                  )}
                  {overwriting ? (
                    <>
                      <span style={s.pickerHint}>用当前表单值覆盖这一份参数？</span>
                      <button type="button" style={s.btnSmall} onClick={onConfirmOverwrite} aria-label="确认覆盖">确认覆盖</button>
                      <button type="button" style={s.btnLink} onClick={onCancelConfirm} aria-label="取消覆盖">取消</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      style={s.btnLink}
                      onClick={() => onRequestOverwrite(template.id)}
                      aria-label={`用当前值覆盖 ${template.name}`}
                    >
                      用当前值覆盖
                    </button>
                  )}
                  {deleting ? (
                    <>
                      <span style={s.pickerHint}>删除后这一份参数不可恢复。</span>
                      <button
                        type="button"
                        style={{ ...s.btnDanger, padding: "3px 9px", fontSize: FONT.hint }}
                        onClick={onConfirmDelete}
                        aria-label="确认删除模板"
                      >
                        确认删除
                      </button>
                      <button type="button" style={s.btnLink} onClick={onCancelConfirm} aria-label="取消删除模板">取消</button>
                    </>
                  ) : (
                    <button
                      type="button"
                      style={s.btnLink}
                      onClick={() => onRequestDelete(template.id)}
                      aria-label={`删除模板 ${template.name}`}
                    >
                      删除
                    </button>
                  )}
                </div>
                <span style={s.templateSummary}>{describeTemplate(template.values, humanizeTokenCount)}</span>
                {renaming && state.renameError !== "" ? (
                  <span style={s.fieldError} role="alert">{state.renameError}</span>
                ) : null}
              </div>
            );
          })}
          {library.templates.length === 0 ? (
            <p style={s.templateManageEmpty}>还没有自定义模板。改好参数后点「存为新模板」保存一份。</p>
          ) : null}
        </div>
        <div style={s.pickerFooter}>
          <span style={s.pickerHint}>{currentSummary}</span>
          <button type="button" style={s.btn} onClick={onClose} aria-label="关闭模板管理">关闭</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 行内编辑表单。每个字段都预填现有值；保存按钮在改动集为空时禁用。
 * 表单状态由 Workbench 持有，便于把 diffRow 与 projectPiAi(update) 接起来。
 */
function EditModelForm({
  model,
  modelId,
  form,
  templatePicker,
  errors,
  formError,
  projection,
  changed,
  canSave,
  busy,
  writable,
  guard,
  onChange,
  onTokenChange,
  onToggleLevel,
  onApiValueChange,
  onSave,
  onCancel,
  onDelete,
  closeTokenPanels,
}) {
  const changedFields = Object.keys(changed);
  const hasChanges = changedFields.length > 0;
  // 工单 #38：diffRow 用 null 标记删除；只有这种「现有值被清空」才显示提示。
  const tokenClearNote = "清空 = 删除该字段，改由路由默认值接管";
  const hasCompat = hasMeaningfulCompat(model?.compat);
  const stale = (projection?.warnings ?? []).find((warning) => warning.code === "stale-index");
  const unsupported = projection?.unsupportedControls ?? [];

  return (
    <div style={s.modelEditor} aria-label={`编辑表单 ${modelId}`}>
      <div style={s.editorHeader}>
        <span style={s.editorTitle}>编辑 {modelId}</span>
        <button
          type="button"
          style={hasChanges ? { ...s.btnSmall, ...s.btnDisabled } : s.btnSmall}
          disabled={hasChanges}
          onClick={onCancel}
          aria-label="收起编辑"
          title={hasChanges ? "有未保存的改动，请先保存或点取消" : "收起编辑表单"}
        >
          × 收起
        </button>
      </div>
      <TemplatePicker {...templatePicker} />

      <div style={s.row}>
        <Field label="显示名（可选）" hint="">
          <input
            style={s.input}
            value={form.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="留空则不写"
            aria-label="编辑显示名"
          />
        </Field>
      </div>

      <div style={s.row}>
        <TokenCountField
          label="上下文窗口 (contextWindow)"
          hint="留空 = 不修改该字段"
          value={form.contextWindow}
          candidates={CONTEXT_WINDOW_CANDIDATES}
          error={errors.contextWindow}
          note={changed.contextWindow === null ? tokenClearNote : ""}
          placeholder="如 131072"
          ariaLabel="编辑上下文窗口"
          closeSignal={closeTokenPanels}
          onChange={(event) => onTokenChange(event, "contextWindow")}
        />
        <TokenCountField
          label="输出上限 (maxTokens)"
          hint="同时限制单次输出，并从上下文窗口预留；填得越大能装的历史越少。"
          value={form.maxTokens}
          candidates={MAX_TOKENS_CANDIDATES}
          error={errors.maxTokens}
          note={changed.maxTokens === null ? tokenClearNote : ""}
          placeholder="如 8192"
          ariaLabel="编辑输出上限"
          closeSignal={closeTokenPanels}
          onChange={(event) => onTokenChange(event, "maxTokens")}
        />
        <div style={s.levels}>
          {form.reasoningDisabled ? (
            <span style={s.sub}>该模型声明为非推理模型，不显示推理档位与 API 参数值。</span>
          ) : (
            <>
              <span style={s.label}>推理档位（多选）<Tip text="全不选 = 不修改现有档位，也不会清空字段" /></span>
              <div style={s.levelChips}>
                {PI_AI_LEVELS.map((level) => {
                  const checked = form.reasoningLevels.includes(level);
                  return (
                    <label key={level} style={checked ? { ...s.levelChip, ...s.toggleOn } : { ...s.levelChip, ...s.toggleOff }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleLevel(level)}
                        aria-label={`编辑档位 ${level}`}
                      />
                      <ToggleMark on={checked} />
                      {level}
                    </label>
                  );
                })}
              </div>
              <div style={s.levelChips}>
                <button type="button" style={s.btnLink} onClick={() => onChange({ reasoningLevels: allReasoningLevels() })}>全选</button>
                <button type="button" style={s.btnLink} onClick={() => onChange({ reasoningLevels: [] })}>全不选</button>
                <button type="button" style={s.btnLink} onClick={() => onChange({ reasoningLevels: defaultReasoningLevels() })}>恢复默认</button>
              </div>
              {guard ? <div style={s.err}>{guard}</div> : null}
              {form.reasoningLevels.length === 0 ? (
                <span style={s.sub}>全不选：不修改现有档位，也不清空该字段。</span>
              ) : null}
              <ReasoningApiValues
                levels={form.reasoningLevels}
                apiValues={form.reasoningApiValues}
                ariaPrefix="编辑"
                onChange={onApiValueChange}
              />
            </>
          )}
        </div>
      </div>

      <BudgetHint contextWindow={form.contextWindow} maxTokens={form.maxTokens} />

      <div style={s.row}>
        <label style={{ ...s.chip, ...(form.inputText ? s.toggleOn : s.toggleOff), cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={form.inputText}
            onChange={(event) => onChange({ inputText: event.target.checked })}
            aria-label="编辑输入模态 text"
          />
          <ToggleMark on={form.inputText} />
          text
        </label>
        <label style={{ ...s.chip, ...(form.inputImage ? s.toggleOn : s.toggleOff), cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={form.inputImage}
            onChange={(event) => onChange({ inputImage: event.target.checked })}
            aria-label="编辑输入模态 image"
          />
          <ToggleMark on={form.inputImage} />
          image
        </label>
      </div>

      {/* 工单 #38 方案 A：取消全部输入模态时给出明确原因，而不是静默禁用保存 */}
      {formError ? <div style={s.fieldError} role="alert">{formError.message}</div> : null}

      {hasCompat ? (
        <div style={s.compatibility}>ⓘ 该模型还有额外配置，保存时会原样保留。</div>
      ) : null}

      {!writable ? <div style={s.warn}>当前配置不可写，保存已禁用；请检查是否处于只读连接或内存模式。</div> : null}

      {stale ? <div style={s.err}>{stale.message} 请取消编辑后重新打开。</div> : null}
      {unsupported.filter((item) => item.reason !== "stale-index").map((item, index) => (
        <div key={`eu${index}`} style={s.err}>
          不可写：<strong>{item.control}</strong> — {item.reason}
          {item.message ? `（${item.message}）` : ""}
        </div>
      ))}

      <details style={s.details}>
        <summary style={s.summary}>
          将写入的配置项（{projection?.settingsOps?.length ?? 0} 条）· 点击展开
        </summary>
        <pre style={s.pre}>{JSON.stringify(projection?.settingsOps ?? [], null, 2)}</pre>
      </details>

      <div style={s.editorFooter}>
        <span style={s.sub}>改动字段：{changedFields.length === 0 ? "无（保存已禁用）" : changedFields.map((field) => EDIT_FIELD_LABELS[field] ?? field).join(" / ")}</span>
        <span style={{ display: "flex", gap: GAP.sm, flexWrap: "wrap" }}>
          <button type="button" style={s.btn} onClick={onCancel} aria-label="取消编辑">取消</button>
          <button
            type="button"
            style={busy ? { ...s.btnDanger, opacity: 0.55, cursor: "not-allowed" } : s.btnDanger}
            disabled={busy}
            onClick={onDelete}
            aria-label="删除模型"
          >
            删除
          </button>
          <button
            type="button"
            style={canSave ? s.btnPrimary : { ...s.btn, opacity: 0.5, cursor: "not-allowed" }}
            disabled={!canSave}
            onClick={onSave}
            aria-label="保存修改"
            title="只写改动过的字段；冲突时会自动重读配置"
          >
            {busy ? "保存中…" : "保存修改"}
          </button>
        </span>
      </div>
    </div>
  );
}

/**
 * 密钥区块：apiKeyEnv 那条引用背后的真实密钥。
 *
 * 状态只来自宿主 credentials.describe 的 configured / writable 两个布尔值；
 * 明文只活在密码框的受控值里，保存时原样交给 credentials.set —— 不 trim、
 * 不加前后缀、不进入 configForms，也不回显到任何提示里。
 */
function CredentialBlock({
  reference,
  suggestion,
  view,
  editorOpen,
  draft,
  busy,
  error,
  onChangeDraft,
  onOpenEditor,
  onCancelEditor,
  onSave,
  onOpenClear,
  onUseSuggestion,
}) {
  const disabledStyle = { ...s.btnSmall, opacity: 0.5, cursor: "not-allowed" };
  const openLabel = view.showReplace ? "更换" : "设置";
  const openAria = view.showReplace ? "更换密钥" : "设置密钥";
  const showEditor = editorOpen && view.kind === "ready" && !view.readOnly;
  const saveDisabled = busy || draft === "";

  return (
    <div style={s.credentialBlock} role="group" aria-label="密钥">
      {reference === "" && suggestion !== "" ? (
        <div style={s.credentialSuggestion} aria-label="密钥引用建议">
          <span>
            建议：<b style={s.credentialSuggestionRef}>{suggestion}</b>
          </span>
          <button type="button" style={s.btnSmall} onClick={onUseSuggestion} aria-label="采用引用名建议">
            采用
          </button>
        </div>
      ) : null}

      <div style={s.credentialRow} role="status" aria-label="密钥状态">
        <span style={s.credentialLabel}>
          密钥状态
          <Tip text={view.readOnly
            ? `${CREDENTIAL_TEXT.editorHint}\n该密钥由部署环境提供，这里只能查看状态。`
            : CREDENTIAL_TEXT.editorHint} />
        </span>
        {view.kind === "ready" ? (
          <React.Fragment>
            <span
              style={{ ...s.credentialDot, ...(view.configured ? s.credentialDotOn : s.credentialDotOff) }}
              aria-hidden="true"
            >
              {view.configured ? "●" : "○"}
            </span>
            <span style={s.credentialText}>{view.text}</span>
          </React.Fragment>
        ) : (
          <span style={s.credentialText}>{view.text}</span>
        )}
        {view.showSet || view.showReplace || view.showClear ? (
          <span style={s.credentialActions}>
            {view.showSet || view.showReplace ? (
              <button
                type="button"
                style={view.readOnly || busy ? disabledStyle : s.btnSmall}
                disabled={view.readOnly || busy}
                onClick={onOpenEditor}
                aria-label={openAria}
              >
                {openLabel}
              </button>
            ) : null}
            {view.showClear ? (
              <button
                type="button"
                style={view.readOnly || busy ? disabledStyle : s.btnSmall}
                disabled={view.readOnly || busy}
                onClick={onOpenClear}
                aria-label="清除密钥"
              >
                清除
              </button>
            ) : null}
          </span>
        ) : null}
      </div>

      {showEditor ? (
        <React.Fragment>
          <div style={s.credentialEditor}>
            <input
              style={s.credentialInput}
              type="password"
              value={draft}
              onChange={onChangeDraft}
              placeholder="输入密钥值"
              aria-label="密钥值"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="button" style={s.btnSmall} disabled={busy} onClick={onCancelEditor} aria-label="取消密钥编辑">
              取消
            </button>
            <button
              type="button"
              style={saveDisabled ? { ...s.btnPrimary, opacity: 0.5, cursor: "not-allowed" } : s.btnPrimary}
              disabled={saveDisabled}
              onClick={onSave}
              aria-label="保存密钥"
            >
              {busy ? "保存中…" : "保存密钥"}
            </button>
          </div>
        </React.Fragment>
      ) : null}

      {error !== "" ? (
        <div style={s.fieldError} role="alert" aria-label="密钥错误">
          {error}
        </div>
      ) : null}
    </div>
  );
}

/** 自绘的二次确认外壳（不用原生 confirm，避免破坏主题）。 */
function ConfirmDialog({
  ariaLabel,
  title,
  badge,
  cancelAria,
  confirmAria,
  confirmLabel,
  busyLabel,
  footerHint,
  busy,
  confirmDisabled = false,
  onCancel,
  onConfirm,
  children,
}) {
  const dialogRef = React.useRef(null);
  const cancelRef = React.useRef(null);

  React.useEffect(() => {
    if (cancelRef.current !== null) cancelRef.current.focus();
  }, []);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const root = dialogRef.current;
    if (root === null) return;
    const focusables = [...root.querySelectorAll("button:not([disabled])")];
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !root.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      style={s.overlay}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        style={s.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onKeyDown={handleKeyDown}
      >
        <div style={s.pickerHeader}>
          <span style={{ ...s.h, minWidth: 0, overflowWrap: "anywhere" }}>{title}</span>
          <span style={s.pickerHint}>{badge}</span>
        </div>
        {children}
        <div style={s.pickerFooter}>
          <span style={s.pickerHint}>{footerHint}</span>
          <span style={{ display: "flex", gap: GAP.sm }}>
            <button ref={cancelRef} type="button" style={s.btn} onClick={onCancel} aria-label={cancelAria}>取消</button>
            <button
              type="button"
              style={busy || confirmDisabled ? { ...s.btnDanger, opacity: 0.55, cursor: "not-allowed" } : s.btnDanger}
              disabled={busy || confirmDisabled}
              onClick={onConfirm}
              aria-label={confirmAria}
            >
              {busy ? busyLabel : confirmLabel}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** 删除单个模型的二次确认。 */
function DeleteConfirmDialog({ routeId, modelId, busy, onCancel, onConfirm }) {
  return (
    <ConfirmDialog
      ariaLabel="删除模型确认"
      title={modelId === "" ? "删除模型" : `删除模型 ${modelId}`}
      badge="二次确认"
      cancelAria="取消删除"
      confirmAria="确认删除"
      confirmLabel="删除"
      busyLabel="删除中…"
      footerHint="模型条目计数会立即同步。"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p style={s.sub}>
        确定要从 <b>{routeId}</b> 删除模型 <b>{modelId}</b> 吗？
      </p>
      <p style={s.sub}>
        删除会立即重写该路由的模型清单（少一条），不会破坏其它模型条目；此操作无法撤销。
      </p>
    </ConfirmDialog>
  );
}

/**
 * 批量删除的二次确认（工单 #33）。
 *
 * 与单条删除一样复用 ConfirmDialog 的 Esc / Tab 行为；正文点名最多 5 条被删
 * 模型，并单独说明其中有多少条当前不可见（折叠分组或搜索过滤），避免用户在
 * 看不见行的情况下误删。文案里的 N 与批量栏的「已选 N 条」来自同一份选择。
 */
function BulkDeleteConfirmDialog({ routeId, count, ids, hiddenCount, busy, onCancel, onConfirm }) {
  const shown = ids.slice(0, 5);
  const remaining = ids.length - shown.length;
  return (
    <ConfirmDialog
      ariaLabel="批量删除模型确认"
      title={`删除 ${count} 条模型`}
      badge="二次确认"
      cancelAria="取消批量删除"
      confirmAria="确认批量删除"
      confirmLabel="批量删除"
      busyLabel="删除中…"
      footerHint="模型条目计数会立即同步。"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p style={s.sub}>
        确定要从 <b>{routeId}</b> 删除以下 {count} 条模型吗？
      </p>
      <p style={s.sub} data-modelpilot-bulk-delete-ids="">
        {shown.join("、")}
      </p>
      {remaining > 0 ? <p style={s.sub}>……另有 {remaining} 条</p> : null}
      {hiddenCount > 0 ? (
        <p style={s.sub}>其中 {hiddenCount} 条位于折叠或未显示的行，当前不可见。</p>
      ) : null}
      <p style={s.sub}>
        批量删除会立即重写该路由的模型清单；此操作无法撤销。
      </p>
    </ConfirmDialog>
  );
}

/**
 * 删除整条路由的二次确认：写明模型条数与不可撤销，并按密钥的真实状态
 * 说明会不会一并删除密钥（工单 #26）。
 *
 * 文案与按钮文字全部来自 {@link describeRouteDeleteDialog}：有没有密钥、
 * 共用、只读、读不到时说法不同，按钮文字直接写清后果。密钥状态还在读取
 * 时确认按钮禁用 —— 绝不在「要不要删密钥」还没确定时就把配置删掉。
 */
function DeleteRouteDialog({ routeId, modelCount, keyRef, keyState, sharedBy, error, busy, onCancel, onConfirm }) {
  const copy = describeRouteDeleteDialog({ routeId, modelCount, ref: keyRef, keyState, sharedBy, error });
  return (
    <ConfirmDialog
      ariaLabel="删除路由确认"
      title={copy.title}
      badge="二次确认"
      cancelAria="取消删除路由"
      confirmAria="确认删除路由"
      confirmLabel={copy.confirmLabel}
      busyLabel="删除中…"
      footerHint={copy.hint}
      busy={busy}
      confirmDisabled={copy.confirmDisabled}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p style={s.sub}>{copy.body}</p>
    </ConfirmDialog>
  );
}

/**
 * 改密钥引用名的二次确认（工单 #37）：旧引用有存储的密钥、可写、且没有别的
 * 路由共用时才会弹出 —— 说明保存前会删除旧密钥且无法恢复，并提醒新引用还
 * 没有密钥、保存后需要重新填写。
 *
 * 文案全部来自 {@link describeKeyRenameDialog}，页脚沿用与删除路由一致的
 * 「先删密钥再写配置」说明。只出现引用名，不出现任何密钥内容。
 */
function KeyRenameDialog({ oldRef, newRef, busy, onCancel, onConfirm }) {
  const copy = describeKeyRenameDialog({ oldRef, newRef });
  return (
    <ConfirmDialog
      ariaLabel="修改密钥引用名确认"
      title={copy.title}
      badge="二次确认"
      cancelAria="取消修改密钥引用名"
      confirmAria="确认修改密钥引用名"
      confirmLabel={copy.confirmLabel}
      busyLabel="保存中…"
      footerHint={copy.hint}
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p style={s.sub}>{copy.body}</p>
    </ConfirmDialog>
  );
}

/**
 * 清除密钥的二次确认：复用同一套自绘确认外壳（与删除模型 / 删除路由一致）。
 * 文案只出现引用名，不出现任何密钥内容 —— 客户端本来也拿不到明文。
 */
function ClearCredentialDialog({ reference, busy, onCancel, onConfirm }) {
  return (
    <ConfirmDialog
      ariaLabel="清除密钥确认"
      title="清除密钥"
      badge="二次确认"
      cancelAria="取消清除密钥"
      confirmAria="确认清除密钥"
      confirmLabel="清除"
      busyLabel="清除中…"
      footerHint="只删除凭据库里的这一条，不改动配置文件。"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p style={s.sub}>
        确定要清除引用 <b>{reference}</b> 的密钥吗？
      </p>
      <p style={s.sub}>
        清除后该引用变为「未配置」，使用它的路由会认证失败；这一步不能撤销。
      </p>
    </ConfirmDialog>
  );
}

/**
 * 全部路由总览（工单 #24）：跨路由的只读清单 + 点行切换。
 *
 * 三种密钥状态（● 已配置 / ○ 未配置 / ? 未知）与「正在读取」分开展示：
 * 查询进行中绝不把任何一行说成「未配置」，读失败也不混进「未配」。
 * 总览自身不编辑路由字段；编辑仍在下方「路由设置」卡片。
 */
function RouteOverviewCard({
  rows,
  overview,
  routeId,
  open,
  hovered,
  onToggle,
  onHover,
  onSwitch,
  onRetry,
}) {
  const status = overview?.status ?? "idle";
  const info = overview?.info ?? {};
  const loading = status === "loading";
  const failed = status === "partial";
  const summary = describeOverviewSummary(rows, info, status);
  const errorText =
    typeof overview?.error === "string" && overview.error !== "" ? `（${overview.error}）` : "";
  const dotStyleFor = (kind) => {
    if (kind === "configured") return s.credentialDotOn;
    if (kind === "unconfigured") return s.credentialDotOff;
    return s.credentialDotUnknown;
  };

  return (
    <section style={s.sectionCard} aria-label="全部路由">
      <button
        type="button"
        style={s.overviewSummary}
        aria-expanded={open}
        aria-label={open ? "收起全部路由" : "展开全部路由"}
        onClick={onToggle}
      >
        {open ? "▾" : "▶"} {summary}
        <Tip text="点任意行切换当前路由；密钥只显示状态。" />
      </button>

      {open ? (
        <div style={s.overviewBody}>
          {loading ? (
            <div style={s.overviewStatus} role="status" aria-label="全部路由密钥状态">
              {OVERVIEW_KEY_TEXT.loading}
            </div>
          ) : null}

          {failed ? (
            <div style={s.warn} role="alert" aria-label="全部路由密钥状态读取失败">
              部分密钥状态读取失败{errorText}，未读取的行显示「? 未知」，已读取的行不受影响。
              <button
                type="button"
                style={s.btnSmall}
                onClick={onRetry}
                aria-label="重试读取全部路由密钥状态"
              >
                重试
              </button>
            </div>
          ) : null}

          {rows.length === 0 ? (
            <div style={s.overviewNote}>
              <div>当前没有配置任何路由。</div>
              <div>先点右上角「+ 新建路由」：从目录里选一个提供商，或选「自定义」填中转站地址。</div>
              <div>第一次用可以先用「基础对话」预设，它会填好上下文窗口与输出上限。</div>
            </div>
          ) : (
            <table style={s.overviewTable} aria-label="全部路由清单">
              <thead>
                <tr>
                  <th style={s.overviewTh} scope="col">路由</th>
                  <th style={s.overviewTh} scope="col">模型数</th>
                  <th style={s.overviewTh} scope="col">密钥</th>
                  <th style={s.overviewTh} scope="col">协议</th>
                  <th style={{ ...s.overviewTh, textAlign: "right" }} scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const current = row.id === routeId;
                  const cell = credentialCellOf(row.ref, info, { loading });
                  const rowStyle = {
                    ...s.overviewRow,
                    ...(current ? s.overviewRowCurrent : null),
                    ...(hovered === row.id ? s.overviewRowHover : null),
                  };
                  return (
                    <tr
                      key={row.id}
                      style={rowStyle}
                      aria-label={`路由 ${row.id}`}
                      onMouseEnter={() => onHover(row.id)}
                      onMouseLeave={() => onHover("")}
                      onClick={() => onSwitch(row.id)}
                    >
                      <td style={current ? { ...s.overviewTd, ...s.overviewTdCurrent } : s.overviewTd}>
                        <span style={s.overviewRouteId}>{row.id}</span>
                        {current ? <span style={s.overviewCurrentBadge}>当前</span> : null}
                      </td>
                      <td style={s.overviewTd}>
                        {row.modelCount === 0 ? "未设置" : row.modelCount}
                      </td>
                      <td style={s.overviewTd}>
                        <span style={s.overviewKey} aria-label={`密钥状态 ${row.id}`}>
                          {cell.kind === "loading" ? (
                            <span style={s.overviewKeyLoading}>…</span>
                          ) : (
                            <React.Fragment>
                              <span
                                style={{ ...s.credentialDot, ...dotStyleFor(cell.kind) }}
                                aria-hidden="true"
                              >
                                {cell.glyph}
                              </span>
                              <span style={s.credentialText}>{cell.text}</span>
                            </React.Fragment>
                          )}
                        </span>
                      </td>
                      <td style={s.overviewTd}>{row.api === "" ? "未指定" : row.api}</td>
                      <td style={{ ...s.overviewTd, ...s.overviewActionCell }}>
                        <button
                          type="button"
                          style={current
                            ? { ...s.overviewSwitch, ...s.overviewSwitchDisabled }
                            : s.overviewSwitch}
                          disabled={current}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSwitch(row.id);
                          }}
                          aria-label={`切换到 ${row.id}`}
                        >
                          {current ? "当前" : "切换"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 路由（provider）级字段编辑卡片。
 *
 * 默认折叠；展开后可编辑十个路由级字段。写入只产出叶子 set / unset，
 * 绝不重建整条路由；删除路由是唯一允许的整条 unset，并且带 stale-route
 * 与「至少要保留一个路由」两道守卫。
 */
function RouteSettingsCard({
  routeId,
  provider,
  routeCount,
  apiChoices,
  modalChoices,
  writable,
  busy,
  open,
  form,
  confirmOpen,
  renameConfirm,
  usageOpen,
  credential,
  deletePlan,
  connectionTest,
  onChange,
  onToggleOpen,
  onOpenConfirm,
  onCloseConfirm,
  onSave,
  onDelete,
  onCancelRename,
  onConfirmRename,
  onToggleUsage,
  onTestConnection,
  onCredentialDraftChange,
  onOpenCredentialEditor,
  onCancelCredentialEditor,
  onSaveCredential,
  onOpenCredentialConfirm,
  onCloseCredentialConfirm,
  onClearCredential,
  onUseCredentialSuggestion,
}) {
  if (form === null) return null;

  const modalChoicesList = Array.isArray(modalChoices?.choices) ? modalChoices.choices : [];
  const modalChoicesSource = modalChoices?.source === "schema" ? "schema" : "fallback";
  const modalitySelection = normalizeModalities(form.defaultInput, modalChoicesList);
  // 路由上已声明、但当前候选清单没读出来的模态（旧 schema 的未来值）也要
  // 显示成 chip，否则用户既看不见也删不掉；它们排在候选之后。
  const declaredOnlyModalities = modalitySelection.filter((value) => !modalChoicesList.includes(value));
  const plan = buildRouteEditOps(routeId, form, provider, { modalities: modalChoicesList });
  const errors = plan.errors;
  const changedLabels = routeFieldLabels(plan.changed);
  const stale = plan.warnings.find((warning) => warning.code === "stale-route");
  const canSave =
    writable &&
    !busy &&
    stale === undefined &&
    plan.ops.length > 0 &&
    Object.keys(errors).length === 0;
  const deleteBlocked = routeDeleteBlockReason(routeCount);
  const deleteDisabled = !writable || busy || deleteBlocked !== null || provider === undefined;
  const routeModels = Array.isArray(provider?.models) ? provider.models : [];
  const modelCount = routeModels.length;
  const apiChoicesList = Array.isArray(apiChoices?.choices) ? apiChoices.choices : [];
  const apiChoicesSource = apiChoices?.source === "schema" ? "schema" : "fallback";
  // 连接测试只看表单里的接口地址：空值 / 非 http(s) 不能发请求；密钥引用为空
  // 不阻止测试 —— 本地 Ollama / vLLM 这类端点本来就不需要鉴权。
  const baseURLText = typeof form.baseURL === "string" ? form.baseURL.trim() : "";
  const testBlockReason = baseURLText === ""
    ? "先填接口地址"
    : /^https?:\/\//i.test(baseURLText)
      ? null
      : "接口地址格式不对";
  const testing = connectionTest?.status === "running";
  const testDisabled = testBlockReason !== null || testing;
  const connectionTone = connectionTest?.status === "done" ? connectionTest.tone : "";
  // 引用名以表单里的 apiKeyEnv 为准（改了引用名就查新条目的状态）；
  // 派生建议只用于空引用时的 placeholder / 「采用」，不自动写入。
  const credentialReference = credential?.reference ?? credentialRefOf(form.apiKeyEnv);
  const keySuggestion = deriveKeyRef(routeId);
  const credentialUi = credentialView(credential);
  const credentialErrorText = credential?.opError ? credential.opError : credentialUi.error;

  // 路由默认值影响谁：按字段分别算，三个字段的受影响集合可能不同
  // （token 字段按值是否声明，模态字段按 input 数组是否声明）。
  // 宿主没有把「已安装目录描述了哪些模型 id」交给设置客户端，而 Workbench 的
  // catalogIds 是「路由当前对外提供的模型 id」（目录替换闸门用），把它当内置
  // 目录会把每条模型都误判成「目录已给值」。因此这里不传 catalogIds：对
  // ModelPilot 管理的自定义路由，内置目录确实为空；目录路由本身没有可枚举的
  // models，计数行不显示。纯函数仍保留 catalogIds 入参，接上目录事实即可用。
  const defaultUsage = countRouteDefaultUsers(routeModels);
  const defaultRows = ROUTE_DEFAULT_FIELDS.map((field) => {
    const modalities = field.kind === "modalities";
    const selection = modalities ? normalizeModalities(form[field.key], modalChoicesList) : null;
    const raw = typeof form[field.key] === "string" ? form[field.key].trim() : "";
    const usage = defaultUsage[field.modelField];
    // 模态字段：全部 chip 不选 = 留空（不声明），不是「空数组」。
    const blank = modalities ? selection.length === 0 : raw === "";
    const valid = modalities ? selection.length > 0 : raw !== "" && isPositiveTokenCount(raw);
    return {
      ...field,
      blank,
      count: usage.count,
      models: usage.models,
      parts: blank || !valid ? null : routeDefaultCountParts(field.key, defaultUsage.total, usage.count),
      expanded: usageOpen?.[field.modelField] === true,
    };
  });

  const hasDefaultNotes = defaultRows.some((row) => row.blank || row.parts !== null);

  function update(field, value) {
    onChange({ [field]: value });
  }

  /** 模态 chip：按候选清单顺序归一化后再写回表单，不按点击顺序。 */
  function toggleModality(value) {
    const next = modalitySelection.includes(value)
      ? modalitySelection.filter((entry) => entry !== value)
      : [...modalitySelection, value];
    update("defaultInput", normalizeModalities(next, modalChoicesList));
  }

  async function save() {
    if (!canSave) return;
    await onSave(form);
  }

  return (
    <section style={s.routeCard} aria-label="路由设置">
      {/* 不用 <details>/<summary>：既有工作台测试断言 details 清单精确等于
          投影预览的数量；这里的折叠状态本来就由 Workbench 持有。 */}
      <button
        type="button"
        style={s.routeSummary}
        aria-expanded={open}
        aria-label={open ? "收起路由设置" : "展开路由设置"}
        onClick={onToggleOpen}
      >
        {open ? "▾" : "▶"} 路由设置 · {describeRouteSummary(provider)}
        <Tip text={"只写改动过的字段，其余原样保留。\n回落顺序：模型自己 → 内置目录 → 路由默认值；默认值不改压缩阈值。"} />
      </button>

      {open ? (
      <div style={s.routeBody}>
        <div style={s.row}>
          <Field label="显示名 (displayName)" hint="留空 = 清空该字段">
            <input
              style={s.input}
              value={form.displayName}
              onChange={(event) => update("displayName", event.target.value)}
              placeholder="如 Preview Chat"
              aria-label="路由显示名"
            />
          </Field>
          <Field label="接口地址 (baseURL)" error={errors.baseURL} hint="以 http:// 或 https:// 开头">
            <input
              style={s.input}
              value={form.baseURL}
              onChange={(event) => update("baseURL", event.target.value)}
              placeholder="https://…"
              aria-label="路由接口地址"
            />
          </Field>
        </div>

        <div style={s.row}>
          <Field
            label="协议 (api)"
            hint="选项随应用版本自动更新"
          >
            <select
              style={s.select}
              value={form.api}
              onChange={(event) => update("api", event.target.value)}
              aria-label="路由协议"
            >
              <option value="">（不声明，回落目录）</option>
              {apiChoicesList.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
              {form.api !== "" && !apiChoicesList.includes(form.api) ? (
                <option value={form.api}>{form.api}（当前值）</option>
              ) : null}
            </select>
          </Field>
        </div>

        <div style={s.row}>
          <Field
            label="密钥引用 (apiKeyEnv)"
            hint="密钥在凭据库中的名称"
            style={{ flex: "0 1 360px" }}
          >
            <input
              style={{ ...s.input, width: "100%" }}
              value={form.apiKeyEnv}
              onChange={(event) => update("apiKeyEnv", event.target.value)}
              placeholder={keySuggestion === "" ? "如 PREVIEW_CHAT_API_KEY" : keySuggestion}
              aria-label="路由密钥引用"
            />
          </Field>
        </div>

        <CredentialBlock
          reference={credentialReference}
          suggestion={keySuggestion}
          view={credentialUi}
          editorOpen={credential.editorOpen}
          draft={credential.draft}
          busy={credential.busy}
          error={credentialErrorText}
          onChangeDraft={onCredentialDraftChange}
          onOpenEditor={onOpenCredentialEditor}
          onCancelEditor={onCancelCredentialEditor}
          onSave={onSaveCredential}
          onOpenClear={onOpenCredentialConfirm}
          onUseSuggestion={onUseCredentialSuggestion}
        />

        {apiChoicesSource === "fallback" ? (
          <div style={s.warn} role="status" aria-label="协议清单来源">
            协议清单读取失败，使用内置列表
          </div>
        ) : null}

        <div style={s.row}>
          <Field label="默认上下文 (defaultContextWindow)" error={errors.defaultContextWindow} hint="留空 = 内置默认值 1,000,000；已声明窗口的模型不受影响">
            <input
              style={s.input}
              value={form.defaultContextWindow}
              onChange={(event) => update("defaultContextWindow", event.target.value)}
              placeholder="如 1000000"
              aria-label="路由默认上下文"
              inputMode="numeric"
            />
          </Field>
          <Field label="默认输出上限 (defaultMaxTokens)" error={errors.defaultMaxTokens} hint="留空 = 内置默认值 128,000；已声明输出上限的模型不受影响">
            <input
              style={s.input}
              value={form.defaultMaxTokens}
              onChange={(event) => update("defaultMaxTokens", event.target.value)}
              placeholder="如 32768"
              aria-label="路由默认输出上限"
              inputMode="numeric"
            />
          </Field>
          <Field label="超时 (timeoutMs)" error={errors.timeoutMs} hint="留空 = 不声明超时，由运行时决定">
            <input
              style={s.input}
              value={form.timeoutMs}
              onChange={(event) => update("timeoutMs", event.target.value)}
              placeholder="如 60000"
              aria-label="路由超时"
              inputMode="numeric"
            />
          </Field>
        </div>

        <div style={s.row}>
          <div style={s.field}>
            <span style={s.label}>
              默认输入模态 (defaultInput)
              <Tip text={"留空 = 按纯文本处理；已声明输入模态的模型不受影响。\n回落顺序：模型自己 → 内置目录 → 这里；不改压缩阈值。"} />
            </span>
            <div style={s.levelChips} role="group" aria-label="路由默认输入模态">
              {[...modalChoicesList, ...declaredOnlyModalities].map((value) => {
                const checked = modalitySelection.includes(value);
                const declaredOnly = !modalChoicesList.includes(value);
                return (
                  <label
                    key={value}
                    style={{ ...s.chip, ...(checked ? s.toggleOn : s.toggleOff), cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleModality(value)}
                      aria-label={`路由输入模态 ${value}`}
                    />
                    <ToggleMark on={checked} />
                    {value}{declaredOnly ? "（当前值）" : ""}
                  </label>
                );
              })}
            </div>
            <div style={s.hintLine}>
              {errors.defaultInput ? <span style={s.fieldError}>{errors.defaultInput}</span> : null}
            </div>
          </div>
        </div>

        {modalChoicesSource === "fallback" ? (
          <div style={s.warn} role="status" aria-label="模态清单来源">
            模态清单读取失败，使用内置模态清单
          </div>
        ) : null}

        {hasDefaultNotes ? (
        <div style={s.routeDefaults} aria-label="路由默认值说明">
          {defaultRows.map((row) => (
            <React.Fragment key={row.key}>
              {row.blank ? (
                <span>{describeHostDefaultFallback(row.key)}</span>
              ) : row.parts === null ? null : (
                <>
                  <div style={s.routeDefaultLine}>
                    <span>{row.parts.prefix}</span>
                    {row.parts.countText === null ? null : (
                      <button
                        type="button"
                        style={s.usageToggle}
                        aria-expanded={row.expanded}
                        aria-label={`${row.expanded ? "收起" : "展开"}使用${row.label}的 ${row.count} 个模型`}
                        onClick={() => onToggleUsage(row.modelField)}
                      >
                        {row.parts.countText}
                      </button>
                    )}
                    <span>{row.parts.suffix}</span>
                  </div>
                  {row.parts.countText !== null && row.expanded ? (
                    <ul style={s.usageList} aria-label={`使用${row.label}的模型清单`}>
                      {row.models.map((model, index) => (
                        <li key={`${typeof model?.id === "string" ? model.id : "model"}:${index}`} style={s.usageItem}>
                          <b>{typeof model?.id === "string" && model.id !== "" ? model.id : "（无 id）"}</b>
                          {" —— "}
                          {row.kind === "modalities"
                            ? describeRouteDefaultInputUsage(model)
                            : describeRouteDefaultUsage(model)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </React.Fragment>
          ))}
        </div>
        ) : null}

        <div style={s.row}>
          <Field label="缓存 (cacheRetention)" hint="留空 = 不声明缓存策略">
            <select
              style={s.select}
              value={form.cacheRetention}
              onChange={(event) => update("cacheRetention", event.target.value)}
              aria-label="路由缓存"
            >
              <option value="">（不声明）</option>
              {CACHE_RETENTION_CHOICES.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
              {form.cacheRetention !== "" && !CACHE_RETENTION_CHOICES.includes(form.cacheRetention) ? (
                <option value={form.cacheRetention}>{form.cacheRetention}（当前值）</option>
              ) : null}
            </select>
          </Field>
          <Field label="传输 (transport)" hint="留空 = 不声明传输方式">
            <select
              style={s.select}
              value={form.transport}
              onChange={(event) => update("transport", event.target.value)}
              aria-label="路由传输"
            >
              <option value="">（不声明）</option>
              {TRANSPORT_CHOICES.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
              {form.transport !== "" && !TRANSPORT_CHOICES.includes(form.transport) ? (
                <option value={form.transport}>{form.transport}（当前值）</option>
              ) : null}
            </select>
          </Field>
        </div>

        {Object.keys(errors).length > 0 ? (
          <div style={s.err}>有字段未通过校验，修正前不会产出任何 op。</div>
        ) : null}
        {stale ? <div style={s.err}>{stale.message}</div> : null}

        <details style={s.details}>
          <summary style={s.summary}>
            将写入的配置项（{plan.ops.length} 条）· 点击展开
          </summary>
          <pre style={s.pre}>{JSON.stringify(plan.ops, null, 2)}</pre>
        </details>

        <div style={s.editorFooter}>
          <span style={s.sub}>
            改动字段：{changedLabels.length === 0 ? "无（保存已禁用）" : changedLabels.join(" / ")}
          </span>
          <span style={{ display: "flex", gap: GAP.sm, flexWrap: "wrap", alignItems: "center" }}>
            {deleteBlocked === null ? null : <span style={s.fieldHint}>{deleteBlocked}</span>}
            {provider === undefined ? <span style={s.fieldHint}>该路由已不存在</span> : null}
            <button
              type="button"
              style={deleteDisabled ? { ...s.btnDanger, opacity: 0.5, cursor: "not-allowed" } : s.btnDanger}
              disabled={deleteDisabled}
              onClick={onOpenConfirm}
              aria-label="删除路由"
            >
              删除路由
            </button>
            <button
              type="button"
              style={testDisabled ? { ...s.btn, opacity: 0.5, cursor: "not-allowed" } : s.btn}
              disabled={testDisabled}
              onClick={() => onTestConnection(form)}
              title={testBlockReason ?? ""}
              aria-label="测试连接"
            >
              {testing ? "测试中…" : "测试连接"}
            </button>
            <button
              type="button"
              style={canSave ? s.btnPrimary : { ...s.btn, opacity: 0.5, cursor: "not-allowed" }}
              disabled={!canSave}
              onClick={save}
              aria-label="保存路由设置"
              title="只写改动过的字段；冲突时会自动重读配置"
            >
              {busy ? "保存中…" : "保存设置"}
            </button>
          </span>
        </div>

        {connectionTest?.status === "done" ? (
          <div
            style={{
              ...s.connectionResult,
              ...(connectionTone === "success"
                ? s.connectionSuccess
                : connectionTone === "warn"
                  ? s.connectionWarn
                  : s.connectionError),
            }}
            role="status"
            aria-label="连接测试结果"
          >
            {connectionTest.text}
          </div>
        ) : null}
      </div>
      ) : null}

      {open && confirmOpen && deletePlan !== undefined ? (
        <DeleteRouteDialog
          routeId={routeId}
          modelCount={deletePlan.modelCount}
          keyRef={deletePlan.ref}
          keyState={deletePlan.keyState}
          sharedBy={deletePlan.sharedBy}
          error={deletePlan.error}
          busy={busy}
          onCancel={onCloseConfirm}
          onConfirm={onDelete}
        />
      ) : null}

      {open && renameConfirm !== null ? (
        <KeyRenameDialog
          oldRef={renameConfirm.oldRef}
          newRef={renameConfirm.newRef}
          busy={busy}
          onCancel={onCancelRename}
          onConfirm={onConfirmRename}
        />
      ) : null}

      {open && credential.confirmOpen ? (
        <ClearCredentialDialog
          reference={credentialReference}
          busy={credential.busy}
          onCancel={onCloseCredentialConfirm}
          onConfirm={onClearCredential}
        />
      ) : null}
    </section>
  );
}

/** 工作台界面。 */
function Workbench({ configForms, discoverModels, credentialOps, listConfigurableProviders }) {
  const scope = configForms.get(LLM_NS);
  const [snap, setSnap] = React.useState(() => scope.getSnapshot());
  React.useEffect(() => scope.subscribe(() => setSnap(scope.getSnapshot())), [scope]);

  const providers = providersOf(snap);
  const userProviders = userProvidersOf(snap);
  const routes = Object.keys(providers);
  const writable = snap?.writable !== false;

  // 总览行每次渲染都从最新快照重算：增删路由、改 apiKeyEnv 后无需手动刷新。
  // 这里刻意不用 useMemo —— 宿主快照可能复用 providers 对象，而渲染读到的
  // 始终是新值；只有引用名真正变化（或重新展开 / 重试）才触发新的 describe。
  const overviewRows = buildRouteOverview(providers);
  const overviewRefs = overviewCredentialRefs(overviewRows);
  const overviewRefsKey = overviewRefs.join("\u0000");

  // 协议清单从宿主命名空间 schema 现读：宿主加了新协议我们自动跟上；读不到
  // （旧宿主 / schema 形态变化 / 描述镜像尚未就绪）时退回内置七种并在卡片上标注。
  const apiChoices = React.useMemo(() => {
    try {
      const schemaOps = configForms?.schema ?? scope?.schema;
      const mirror = typeof configForms?.describe === "function" ? configForms.describe() : undefined;
      const view = mirror?.getSnapshot?.().view?.namespaces?.find?.((row) => row.ns === LLM_NS)
        ?? scope?.mirror?.namespace?.(LLM_NS);
      return apiChoicesFromSchema(schemaOps, view?.schema);
    } catch {
      return apiChoicesFromSchema(undefined, undefined);
    }
  }, [configForms, scope, snap]);

  // 默认输入模态的候选同样从宿主 schema 现读：宿主的 defaultInput 是多选
  // union（当前 text / image），新增模态时这里自动跟上；读不到时退回内置
  // 清单并在卡片上标注。顺序就是 chip 的渲染顺序，也是写入数组的顺序。
  const modalChoices = React.useMemo(() => {
    try {
      const schemaOps = configForms?.schema ?? scope?.schema;
      const mirror = typeof configForms?.describe === "function" ? configForms.describe() : undefined;
      const view = mirror?.getSnapshot?.().view?.namespaces?.find?.((row) => row.ns === LLM_NS)
        ?? scope?.mirror?.namespace?.(LLM_NS);
      return modalityChoicesFromSchema(schemaOps, view?.schema);
    } catch {
      return modalityChoicesFromSchema(undefined, undefined);
    }
  }, [configForms, scope, snap]);
  const modalChoiceValues = Array.isArray(modalChoices?.choices) ? modalChoices.choices : [];

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
  // 每个档位的「API 参数值」输入。空对象 = 全部留空 = 全部用档位名。
  const [reasoningApiValues, setReasoningApiValues] = React.useState({});
  const [ackReplace, setAckReplace] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [toast, setToast] = React.useState(null);
  // 工单 #35：提示是一个常驻的 live region（读屏能播报），成功提示 6 秒后
  // 淡出移除，报错保留；焦点在提示上时暂停计时，卸载时清掉定时器。
  const [toastFocused, setToastFocused] = React.useState(false);
  const toastAriaProps = toastAria(toast?.tone);
  React.useEffect(() => {
    if (toastFocused) {
      const restored = restoreToastOnFocus(toast);
      if (restored !== toast) setToast(restored);
      return undefined;
    }
    const delay = toastDismissDelay(toast, toastFocused);
    if (delay === null) return undefined;
    const timer = window.setTimeout(() => {
      setToast((current) => nextToastOnDismiss(current));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [toast, toastFocused]);

  // 已拉取的远端候选；同时供 datalist 补全和选择器弹窗使用，不自动填充模型 ID。
  const [remoteModels, setRemoteModels] = React.useState([]);
  const [fetchState, setFetchState] = React.useState("idle"); // idle | loading | done | failed
  const [fetchError, setFetchError] = React.useState("");
  // 切换路由后清掉上一条路由的结果；用序号作废未完成的请求。
  const fetchGeneration = React.useRef(0);

  // 选择器弹窗。勾选集合与过滤词分开存，改搜索词不会丢勾选。
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerQuery, setPickerQuery] = React.useState("");
  const [pickerSelected, setPickerSelected] = React.useState(() => new Set());
  const [pickerAckReplace, setPickerAckReplace] = React.useState(false);
  // 最近一次批量投影：确认后先渲染 ops，再调用一次 scope.mutate。
  const [batchProjection, setBatchProjection] = React.useState(null);

  // localStorage 在隐私模式 / 被禁用时会抛异常；用一个惰性 getter 包住，
  // 拿不到就当作没有存储，全部走「无模板」分支。
  const storage = React.useMemo(() => {
    try {
      return typeof window !== "undefined" ? window.localStorage : undefined;
    } catch {
      return undefined;
    }
  }, []);

  // 工单 #42：模板库 + 「最近选用」。库与选择是两份独立偏好：删库里的模板
  // 不删选择 key（读的时候校验），选择指向已删除的模板时由界面回落到第一份
  // 用户模板、再回落到内置「基础对话」。
  const [templateLibrary, setTemplateLibrary] = React.useState(() => readTemplateLibrary(storage));
  // 工单 #43 缺陷 2：readTemplateSelection 返回 { kind, id }，内置预设也持久化；
  // explicit 区分「用户选过」与回落，批量写入摘要的措辞据此决定（缺陷 1）。
  const initialChoice = React.useMemo(() => initialTemplateChoice(storage), [storage]);
  const [templateChoice, setTemplateChoice] = React.useState(initialChoice.choice);
  const [templateChoiceExplicit, setTemplateChoiceExplicit] = React.useState(initialChoice.explicit);
  // 「存为新模板」对话框：{ mode: "create"|"edit", name, error }；null = 关闭。
  const [templateDialog, setTemplateDialog] = React.useState(null);
  // 模板管理面板：mode 决定「用当前值覆盖」读哪份表单；行内的改名 / 覆盖 /
  // 删除二次确认都是这个对象里的字段，null = 面板关闭。
  const [templateManage, setTemplateManage] = React.useState(null);
  // 工单 #43 缺陷 3：两个弹窗共用一份焦点管理（useDialogFocus）—— 打开时聚焦
  // 第一个可聚焦元素、Tab 圈定、关闭时把焦点还给模板条上打开它的那个按钮。
  const templateDialogRef = React.useRef(null);
  const templateManageRef = React.useRef(null);
  const templateRenameInputRef = React.useRef(null);
  const templateTriggerRef = React.useRef(null);
  const trapTemplateDialogTab = useDialogFocus(templateDialog !== null, templateDialogRef, templateTriggerRef);
  const trapTemplateManageTab = useDialogFocus(templateManage !== null, templateManageRef, templateTriggerRef);

  // 工单 #31：列表密度的全局前端偏好；读不到 / 非法值一律回落 compact。
  const [modelDensity, setModelDensity] = React.useState(() => readModelListDensity(storage));

  // 工单 #39：平铺 / 分组的全局前端偏好；读不到 / 非法值一律回落 grouped。
  // 视图只改渲染与拖动语义，不写配置；折叠状态仍由 collapsedGroups 单独保存。
  const [modelView, setModelView] = React.useState(() => readModelListView(storage));

  // 行内编辑：同时只允许一条展开。editModelId 是打开编辑时的 id，
  // 用于 projectPiAi(update) 的 stale-index 校验（防止配置被别处改动）。
  const [editingIndex, setEditingIndex] = React.useState(null);
  const [editForm, setEditForm] = React.useState(null);
  const [editErrors, setEditErrors] = React.useState({ contextWindow: false, maxTokens: false });
  const [editModelId, setEditModelId] = React.useState("");
  // 自绘删除确认的目标；null 表示弹窗关闭。
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  // 模型行 hover 反馈：纯展示状态，不参与任何投影 / 写入。
  const [hoveredRow, setHoveredRow] = React.useState(null);
  // 拖动排序：只记录正在拖哪一行、插入线画在哪；真正写盘在 drop / 方向键时
  // 立即发生。dragCancelled 记录 Esc 取消，让随后的 drop 不再写入。
  const [dragState, setDragState] = React.useState(null);
  const dragCancelled = React.useRef(false);
  const pendingHandleFocus = React.useRef(null);
  // 主模型列表的搜索与批量操作（工单 #25）。查询只影响显示；勾选记的是
  // models 数组里的绝对下标 —— 筛选状态下拖动会被禁用，避免下标错位。
  const [modelQuery, setModelQuery] = React.useState("");
  const [modelSelected, setModelSelected] = React.useState(() => new Set());
  // 工单 #31：分组折叠只是视图状态，不写配置；切换路由时清空。
  const [collapsedGroups, setCollapsedGroups] = React.useState(() => new Set());
  // 批量改字段的表单；null = 收起（初始 / 切换路由 / 写入成功后都回到收起）。
  const [bulkForm, setBulkForm] = React.useState(null);
  const [bulkError, setBulkError] = React.useState("");
  // 批量删除的二次确认；打开后不写盘，确认才走一次 mutate。
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);

  // 路由设置卡片的状态放在 Workbench：卡片组件保持无 hook，测试用的轻量
  // 渲染器（按组件树展开函数调用而不隔离 hook 槽）才能安全地展开它。
  const [routeFormState, setRouteFormState] = React.useState(null);
  const [routeCardOpen, setRouteCardOpen] = React.useState(false);
  const [routeConfirmOpen, setRouteConfirmOpen] = React.useState(false);
  // 改密钥引用名的二次确认（工单 #37）：只有「旧密钥已配置、可写、且没有别的
  // 路由共用」才打开。value 里带着待保存的表单与新旧引用名；确认后按
  // 「先删旧密钥，成功后再写配置」执行，取消则一条配置都不写。
  const [renameConfirm, setRenameConfirm] = React.useState(null);
  // 删除路由前对「这条路由的密钥」做一次只读 describe（工单 #26）：弹窗文案
  // 与按钮文字按真实状态分两套，绝不在状态未定时把配置删掉。generation 作废
  // 上一轮（上一个引用名 / 上一次打开）的迟到结果。
  const [deleteProbe, setDeleteProbe] = React.useState({
    ref: "",
    status: "idle",
    configured: false,
    writable: true,
    error: "",
  });
  const deleteProbeGeneration = React.useRef(0);
  // 连接测试是只读探活：状态只在这里，结果不写配置、不缓存、不自动跑。
  // generation 作废「发起后表单又被改过」或「切了路由」的迟到结果。
  const [connectionTest, setConnectionTest] = React.useState({ status: "idle", tone: "", text: "" });
  const connectionTestGeneration = React.useRef(0);
  // 三个默认值的「哪些模型会用到」清单各自折叠；按模型字段名存。
  const [routeDefaultUsageOpen, setRouteDefaultUsageOpen] = React.useState({ contextWindow: false, maxTokens: false, input: false });

  // 全部路由总览（工单 #24）：默认折叠；只有展开时才批量 describe 所有引用名。
  // info 按引用名缓存三种密钥状态，error 只在某一批失败时出现（该批及之后为未知）。
  const [overviewOpen, setOverviewOpen] = React.useState(false);
  const [overview, setOverview] = React.useState({ status: "idle", info: {}, error: "" });
  const [overviewRefresh, setOverviewRefresh] = React.useState(0);
  const [overviewHover, setOverviewHover] = React.useState("");
  const overviewGeneration = React.useRef(0);

  // 新建路由（工单 #21）：目录读取、表单、校验与提交状态全部留在 Workbench，
  // 弹窗组件保持无 hook；创建成功后用 revealCreatedRoute 让路由卡片自动展开。
  const [createOpen, setCreateOpen] = React.useState(false);
  const [createMode, setCreateMode] = React.useState("catalog");
  const [createCatalog, setCreateCatalog] = React.useState({ status: "idle", entries: [], error: "" });
  // 目录读取的重新触发序号：点「重试」时自增，effect 随之重新读取。
  const [createReload, setCreateReload] = React.useState(0);
  const [createQuery, setCreateQuery] = React.useState("");
  const [createProviderId, setCreateProviderId] = React.useState("");
  const [createBaseURL, setCreateBaseURL] = React.useState("");
  const [createApi, setCreateApi] = React.useState(() => defaultProtocolChoice(apiChoices.choices));
  const [createApiKeyEnv, setCreateApiKeyEnv] = React.useState("");
  const [createModelIds, setCreateModelIds] = React.useState("");
  const [createProviderIdTouched, setCreateProviderIdTouched] = React.useState(false);
  const [createBaseURLTouched, setCreateBaseURLTouched] = React.useState(false);
  // 工单 #40：用户手输过接口地址后再点格式 chip，保留输入并给出提示，
  // 不静默覆盖。空串表示没有提示。
  const [createBaseURLNote, setCreateBaseURLNote] = React.useState("");
  const [createBusy, setCreateBusy] = React.useState(false);
  const [createError, setCreateError] = React.useState("");
  const createFocusRef = React.useRef(null);
  const [revealCreatedRoute, setRevealCreatedRoute] = React.useState(null);

  // 密钥区块：describe 只看 configured / writable；明文只存在于 credentialDraft，
  // 保存成功后立即清空，失败时保留输入方便重试。绝不写入 localStorage。
  const [credential, setCredential] = React.useState({
    ref: "",
    status: "idle",
    configured: false,
    writable: true,
    error: "",
  });
  const credentialGeneration = React.useRef(0);
  // describe 的重新读取信号：保存 / 清除成功后自增，不刷新页面就能拿到新状态。
  const [credentialRefresh, setCredentialRefresh] = React.useState(0);
  const [credentialEditorOpen, setCredentialEditorOpen] = React.useState(false);
  const [credentialDraft, setCredentialDraft] = React.useState("");
  const [credentialBusy, setCredentialBusy] = React.useState(false);
  const [credentialError, setCredentialError] = React.useState("");
  const [credentialConfirmOpen, setCredentialConfirmOpen] = React.useState(false);

  // 工单 #42：当前选中的模板（用户模板或内置预设）。选中的那一份被删除后
  // resolveTemplateChoice 会回落到第一份用户模板 / 内置「基础对话」。
  const selectedTemplate = resolveTemplateChoice(templateLibrary, templateChoice);

  // 工单 #43 缺陷 3：行内改名输入框出现时接住焦点，不要让它掉回 body。
  const renamingTemplateId = templateManage === null ? null : templateManage.renameId;
  React.useEffect(() => {
    if (renamingTemplateId !== null) focusElement(templateRenameInputRef.current);
  }, [renamingTemplateId]);

  // 首次挂载：有模板就填进表单。只跑一次，用户之后的手动编辑不被覆盖。
  const templateApplied = React.useRef(false);
  React.useEffect(() => {
    if (templateApplied.current) return;
    templateApplied.current = true;
    const form = templateToForm(selectedTemplate.values);
    setContextWindow(form.contextWindow);
    setMaxTokens(form.maxTokens);
    setInputText(form.inputText);
    setInputImage(form.inputImage);
    setReasoningLevels(form.reasoningLevels);
    setReasoningApiValues({});
  }, [selectedTemplate.values]);

  const reasoningGuard = reasoningLevelsGuard(reasoningLevels);

  // 新增表单的当前值（工单 #43：模板摘要的「表单已改动」比较也读这一份）。
  const createFormValues = { contextWindow, maxTokens, inputText, inputImage, reasoningLevels };

  // 工单 #40：当前表单值命中哪个内置预设。任何字段被改动都会让它变成 null，
  // chip 的高亮必须跟着消失，不能残留「你还在基础对话上」的假状态。
  const detectedPreset = detectPreset(createFormValues);

  React.useEffect(() => {
    if (routeId === "" && routes.length > 0) setRouteId(routes[0]);
  }, [routes, routeId]);

  const route = routeId ? providers[routeId] : undefined;

  // 删除路由要用的密钥事实（工单 #26）：引用名与共用者每次都从最新快照重算。
  // 弹窗文案、按钮文字与真正删除时的决策都读同一份事实，避免两处各算一遍。
  const deleteRouteTarget = buildRouteDeleteTarget(routeId, providers);

  // 切换路由时收起卡片并重新预填十个字段；不把上一条路由的表单带过来。
  React.useEffect(() => {
    setRouteCardOpen(false);
    setRouteConfirmOpen(false);
    setRenameConfirm(null);
    setRouteDefaultUsageOpen({ contextWindow: false, maxTokens: false, input: false });
    setRouteFormState(routeFormFromProvider(route));
    connectionTestGeneration.current += 1;
    setConnectionTest({ status: "idle", tone: "", text: "" });
  }, [routeId]);

  // 新建路由成功后，路由卡片自动展开并预填新路由的字段。等 providers 快照
  // 里真的出现这条路由再展开：快照更新可能比 mutate 的 resolve 晚一帧。
  React.useEffect(() => {
    if (revealCreatedRoute === null || revealCreatedRoute !== routeId || route === undefined) return;
    setRevealCreatedRoute(null);
    setRouteFormState(routeFormFromProvider(route));
    setRouteCardOpen(true);
  }, [revealCreatedRoute, route, routeId]);

  // 弹窗打开时读宿主目录。只读消费；失败时 custom 模式仍可用。
  React.useEffect(() => {
    if (!createOpen) return undefined;
    let disposed = false;
    setCreateCatalog({ status: "loading", entries: [], error: "" });
    (async () => {
      try {
        const response = await listConfigurableProviders();
        if (disposed) return;
        if (Array.isArray(response)) {
          setCreateCatalog({ status: "ready", entries: response, error: "" });
          return;
        }
        if (response?.ok === true) {
          setCreateCatalog({
            status: "ready",
            entries: Array.isArray(response.value) ? response.value : [],
            error: "",
          });
          return;
        }
        setCreateCatalog({
          status: "failed",
          entries: [],
          error: typeof response?.error?.message === "string" && response.error.message !== ""
            ? response.error.message
            : "未返回原因",
        });
      } catch (error) {
        if (!disposed) {
          setCreateCatalog({
            status: "failed",
            entries: [],
            error: String(error?.message ?? error),
          });
        }
      }
    })();
    return () => {
      disposed = true;
    };
  }, [createOpen, createReload, listConfigurableProviders]);

  // 打开弹窗 / 切换来源后把焦点放到第一输入；Esc 关闭（提交中不关闭）。
  React.useEffect(() => {
    if (!createOpen) return;
    const target = createFocusRef.current;
    if (target !== null && typeof target.focus === "function") target.focus();
  }, [createOpen, createMode]);

  React.useEffect(() => {
    if (!createOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !createBusy) setCreateOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [createOpen, createBusy]);

  const credentialReference = routeFormState === null ? "" : credentialRefOf(routeFormState.apiKeyEnv);

  // 换引用名就是换一条凭据：收起上一轮的编辑器与确认弹窗，状态交给下面的 effect。
  // 卡片收起时也丢弃明文 —— 不让密码停留在已隐藏的 DOM 状态外。
  React.useEffect(() => {
    setCredentialEditorOpen(false);
    setCredentialDraft("");
    setCredentialError("");
    setCredentialConfirmOpen(false);
  }, [credentialReference, routeCardOpen]);

  // 卡片展开时才查询（折叠状态不产生远程调用）。换引用名、保存 / 清除成功后
  // 都重新 describe；generation 作废旧请求，防止旧 ref 的结果覆盖新 ref。
  React.useEffect(() => {
    if (!routeCardOpen || credentialReference === "") {
      credentialGeneration.current += 1;
      setCredential({ ref: credentialReference, status: "idle", configured: false, writable: true, error: "" });
      return undefined;
    }
    const generation = ++credentialGeneration.current;
    setCredential((current) => ({ ...current, ref: credentialReference, status: "loading", error: "" }));
    let disposed = false;
    const settle = (next) => {
      if (disposed || generation !== credentialGeneration.current) return;
      setCredential(next);
    };
    (async () => {
      try {
        const response = await credentialOps.describe([credentialReference]);
        if (response?.ok === true) {
          const info = response.value?.[credentialReference];
          settle({
            ref: credentialReference,
            status: "ready",
            configured: info?.configured === true,
            writable: info?.writable !== false,
            error: "",
          });
          return;
        }
        settle({
          ref: credentialReference,
          status: "error",
          configured: false,
          writable: false,
          error: credentialErrorMessage(response, "未返回原因"),
        });
      } catch (error) {
        settle({
          ref: credentialReference,
          status: "error",
          configured: false,
          writable: false,
          error: String(error?.message ?? error),
        });
      }
    })();
    return () => {
      disposed = true;
    };
  }, [routeCardOpen, credentialReference, credentialRefresh, credentialOps]);

  // 删除弹窗打开时才读取这条路由的密钥状态（工单 #26）：读的是快照里保存的
  // apiKeyEnv 派生的引用名，不是表单里可能还没保存的草稿。只读 describe；
  // 读失败单独成态，绝不把「读不到」当成「没有密钥」。
  React.useEffect(() => {
    const ref = deleteRouteTarget.ref;
    if (!routeConfirmOpen || ref === "") {
      deleteProbeGeneration.current += 1;
      setDeleteProbe({ ref, status: "idle", configured: false, writable: true, error: "" });
      return undefined;
    }
    const generation = ++deleteProbeGeneration.current;
    setDeleteProbe({ ref, status: "loading", configured: false, writable: true, error: "" });
    let disposed = false;
    const settle = (next) => {
      if (disposed || generation !== deleteProbeGeneration.current) return;
      setDeleteProbe(next);
    };
    (async () => {
      try {
        const response = await credentialOps.describe([ref]);
        if (response?.ok === true) {
          const info = response.value?.[ref];
          settle({
            ref,
            status: "ready",
            configured: info?.configured === true,
            writable: info?.writable !== false,
            error: "",
          });
          return;
        }
        settle({
          ref,
          status: "error",
          configured: false,
          writable: false,
          error: credentialErrorMessage(response, "未返回原因"),
        });
      } catch (error) {
        settle({
          ref,
          status: "error",
          configured: false,
          writable: false,
          error: String(error?.message ?? error),
        });
      }
    })();
    return () => {
      disposed = true;
    };
  }, [routeConfirmOpen, deleteRouteTarget.ref, credentialOps]);

  // 引用名对不上（刚切路由 / 刚改 apiKeyEnv）的那一帧按「读取中」渲染：
  // 不能把上一条路由的密钥状态贴到新引用名上，也不能提前放出确认按钮。
  const deleteProbeState = deleteProbe.ref === deleteRouteTarget.ref
    ? deleteProbe
    : {
        ref: deleteRouteTarget.ref,
        status: deleteRouteTarget.ref === "" ? "idle" : "loading",
        configured: false,
        writable: true,
        error: "",
      };
  const deleteKeyState = routeDeleteKeyState({
    ref: deleteRouteTarget.ref,
    status: deleteProbeState.status,
    configured: deleteProbeState.configured,
    writable: deleteProbeState.writable,
    sharedBy: deleteRouteTarget.sharedBy,
  });
  const deletePlan = {
    modelCount: deleteRouteTarget.modelCount,
    ref: deleteRouteTarget.ref,
    sharedBy: deleteRouteTarget.sharedBy,
    keyState: deleteKeyState,
    error: deleteProbeState.error,
  };

  // 总览的批量密钥状态：折叠时直接返回（不发请求）；展开后按 64 个一批查询。
  // 路由增删 / apiKeyEnv 变化（快照订阅重算 refs）与保存 / 清除密钥
  // （credentialRefresh）都会重跑；generation 作废旧请求的迟到结果。
  React.useEffect(() => {
    if (!overviewOpen) {
      overviewGeneration.current += 1;
      return undefined;
    }
    const refs = overviewRefs;
    if (refs.length === 0) {
      overviewGeneration.current += 1;
      setOverview({ status: "ready", info: {}, error: "" });
      return undefined;
    }
    const generation = ++overviewGeneration.current;
    // 重新查询时清空旧结果：读的过程中任何一行都不能显示上一轮的「未配置」。
    setOverview({ status: "loading", info: {}, error: "" });
    let disposed = false;
    (async () => {
      const info = {};
      let failed = false;
      let error = "";
      for (const batch of describeBatches(refs, DESCRIBE_BATCH_SIZE)) {
        let response;
        try {
          response = await credentialOps.describe(batch);
        } catch (failure) {
          if (disposed || generation !== overviewGeneration.current) return;
          failed = true;
          error = String(failure?.message ?? failure);
          break;
        }
        if (disposed || generation !== overviewGeneration.current) return;
        if (response?.ok === true && response.value !== null && typeof response.value === "object") {
          Object.assign(info, response.value);
          continue;
        }
        failed = true;
        error = credentialErrorMessage(response, "未返回原因");
        break;
      }
      if (disposed || generation !== overviewGeneration.current) return;
      setOverview({ status: failed ? "partial" : "ready", info, error });
    })();
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewOpen, overviewRefsKey, overviewRefresh, credentialRefresh, credentialOps]);

  const userRoute = routeId ? userProviders[routeId] : undefined;
  const routeModels = Array.isArray(route?.models) ? route.models : [];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const catalogIds = React.useMemo(() => catalogIdsOf(route), [route]);
  const existingModelIds = routeModels.map((model) => model?.id).filter((id) => typeof id === "string");
  const overridesInUse =
    route?.modelOverrides !== null &&
    typeof route?.modelOverrides === "object" &&
    !Array.isArray(route.modelOverrides) &&
    Object.keys(route.modelOverrides).length > 0;
  // 目录路由：没有 models 数组即由宿主目录提供模型（手工声明的路由必须列出 models）。
  // 批量写入 models 会整体替换宿主目录，必须先确认。
  const catalogWarning = route !== undefined && route.models === undefined;

  // 工单 #31：按 id 第一段分组。分组只是视图，models 数组顺序保持不变；
  // 组内保持数组顺序，组按字母序，「其他」最后。
  const modelGroups = React.useMemo(() => groupModelRows(routeModels), [routeModels]);
  // 序号按分组后的阅读顺序编号；折叠 / 搜索不改变编号，写盘仍用绝对下标。
  const groupedOrdinals = React.useMemo(() => {
    const ordinals = new Map();
    let ordinal = 0;
    for (const group of modelGroups) {
      for (const row of group.rows) {
        ordinal += 1;
        ordinals.set(row.index, ordinal);
      }
    }
    return ordinals;
  }, [modelGroups]);
  /** 一行的展示描述：完整 id（缺 id 时用下标兜底）、显示名、序号与摘要。 */
  const describeModelRow = (index, { shortId, ordinal }) => {
    const model = routeModels[index];
    const rawId = model?.id;
    const modelKey = typeof rawId === "string" && rawId !== "" ? rawId : `#${index}`;
    return {
      index,
      model,
      modelKey,
      shortId: shortId === "" ? modelKey : shortId,
      ordinal,
      summary: describeModelRowSource(model, humanizeTokenCount, route),
    };
  };
  const groupViews = React.useMemo(
    () => modelGroups.map((group) => {
      const rows = group.rows.map((row) => describeModelRow(row.index, {
        shortId: row.shortId,
        ordinal: groupedOrdinals.get(row.index) ?? row.index + 1,
      }));
      return {
        key: group.key,
        rows,
        sharedSummary: sharedSummaryText(rows.map((row) => row.summary.text)),
      };
    }),
    [groupedOrdinals, modelGroups, route],
  );
  // 搜索只筛显示：index 始终是 models 数组的绝对下标；一行是否出现还取决于
  // 所属分组是否展开。匹配逻辑复用 filterModels，避免在界面里再写一套大小写
  // 规则；id 缺失的行只在无搜索词时显示。
  const matchingModelIndexes = React.useMemo(() => {
    const matched = [];
    for (const group of groupViews) {
      for (const row of group.rows) {
        const id = typeof row.model?.id === "string" ? row.model.id : "";
        if (filterModels([id], modelQuery).length === 1) matched.push(row.index);
      }
    }
    return matched;
  }, [groupViews, modelQuery]);
  const matchingIndexSet = React.useMemo(() => new Set(matchingModelIndexes), [matchingModelIndexes]);
  // 组头折叠只看视图状态；分组视图的可见行只含「展开且命中筛选」的行。
  const modelGroupsVisible = React.useMemo(
    () => groupViews.map((group) => {
      const matchingRows = group.rows.filter((row) => matchingIndexSet.has(row.index));
      return {
        ...group,
        matchingRows,
        expanded: !collapsedGroups.has(group.key),
      };
    }),
    [groupViews, matchingIndexSet, collapsedGroups],
  );
  const groupedVisibleModelIndexes = modelGroupsVisible.flatMap((group) => (
    group.expanded ? group.matchingRows.map((row) => row.index) : []
  ));
  // 工单 #39：平铺视图没有折叠，可见行就是命中筛选的全部行，按 models 数组顺序。
  // 全选、隐藏选中与底部计数都以最终的 visibleModelIndexes 为准，两种视图共用。
  const flatVisibleModelIndexes = React.useMemo(
    () => routeModels.map((model, index) => index).filter((index) => matchingIndexSet.has(index)),
    [routeModels, matchingIndexSet],
  );
  const visibleModelIndexes = modelView === VIEW_FLAT
    ? flatVisibleModelIndexes
    : groupedVisibleModelIndexes;
  // 平铺行：序号就是数组下标 + 1；显示完整 id（没有组前缀要去掉）。
  // 行本身仍由同一个 renderModelRow 渲染，分组 / 平铺不复制 JSX。
  const flatModelRows = React.useMemo(
    () => flatVisibleModelIndexes.map((index) => describeModelRow(index, {
      shortId: "",
      ordinal: index + 1,
    })),
    [flatVisibleModelIndexes, routeModels, route],
  );
  const matchingModelCount = matchingModelIndexes.length;
  const routeModelIdKey = routeModels
    .map((model) => (typeof model?.id === "string" ? model.id : `#${model?.id}`))
    .join("\u0000");
  // 工单 #31：搜索命中跨组时，命中的组自动展开，未命中的组收起。只在搜索词
  // 或模型 id 序列变化时调整折叠状态；用户随后仍可手动折叠 / 展开。
  //
  // 工单 #34：区分「搜索词变空」与「模型增删」。前者把搜索态的折叠恢复为
  // 全部展开；后者不碰折叠状态，交给下面的清理 effect 只剔除消失的分组。
  const previousModelQuery = React.useRef(modelQuery);
  React.useEffect(() => {
    const query = modelQuery.trim();
    const wasSearching = previousModelQuery.current.trim() !== "";
    previousModelQuery.current = modelQuery;
    if (query === "") {
      if (wasSearching) setCollapsedGroups((current) => (current.size === 0 ? current : new Set()));
      return;
    }
    setCollapsedGroups((current) => {
      const next = new Set();
      for (const group of groupModelRows(routeModels)) {
        const hasMatch = group.rows.some((row) => {
          const id = typeof row.model?.id === "string" ? row.model.id : "";
          return filterModels([id], modelQuery).length === 1;
        });
        if (!hasMatch) next.add(group.key);
      }
      if (next.size === current.size && [...next].every((key) => current.has(key))) return current;
      return next;
    });
  }, [modelQuery, routeModelIdKey]);
  // 工单 #34：分组消失时剔除它的折叠 key。只删已不存在的 key，现存分组的
  // 折叠状态保留；同名分组重建时因此默认展开，用户能看到刚新增的模型。
  // modelGroups 由 routeModels 派生，id 序列（routeModelIdKey）覆盖其变化。
  React.useEffect(() => {
    const keys = new Set(modelGroups.map((group) => group.key));
    setCollapsedGroups((current) => {
      if (current.size === 0) return current;
      let changed = false;
      const next = new Set();
      for (const key of current) {
        if (keys.has(key)) next.add(key);
        else changed = true;
      }
      return changed ? next : current;
    });
    // modelGroups 随 routeModels 重算，id 序列稳定键覆盖它的变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeModelIdKey]);
  // 全选复选框的三态：可见行里已选 / 半选 / 未选。半选必须在 effect 里写
  // input.indeterminate —— React 没有这个属性。
  const selectedVisibleCount = React.useMemo(() => {
    let count = 0;
    for (const index of visibleModelIndexes) {
      if (modelSelected.has(index)) count += 1;
    }
    return count;
  }, [visibleModelIndexes, modelSelected]);
  const selectAllState = selectAllCheckboxState(visibleModelIndexes.length, selectedVisibleCount);
  const selectAllRef = React.useRef(null);
  // 每次渲染后都写一次：真 React 复用 DOM 节点，半选状态可能残留；测试夹具
  // 会重建节点，只有无依赖的 effect 才能保证新节点也拿到正确值。
  React.useEffect(() => {
    if (selectAllRef.current !== null) selectAllRef.current.indeterminate = selectAllState.some;
  });
  // 隐藏选中 = 已勾选但当前不在可见集合里（折叠分组或搜索过滤）。批量栏与
  // 删除确认都读同一份摘要，数字不会各说各话。
  const bulkSelectionSummary = summarizeBulkSelection(routeModels, modelSelected, visibleModelIndexes);
  const bulkPatch = bulkForm === null ? null : bulkPatchFromForm(bulkForm);
  const bulkLivePlan = bulkPatch === null ? null : planBulkFields(routeModels, modelSelected, bulkPatch, routeId);
  const bulkDeleteBlocked = routeModels.length > 0 && modelSelected.size >= routeModels.length;
  const bulkCanApply =
    bulkForm !== null &&
    writable &&
    !busy &&
    modelSelected.size > 0 &&
    bulkLivePlan?.status === "ok";

  // 切换路由后清掉上一条路由的候选、选择器与批量预览；未完成的请求由 generation 作废。
  React.useEffect(() => {
    fetchGeneration.current += 1;
    setRemoteModels([]);
    setFetchState("idle");
    setFetchError("");
    setPickerOpen(false);
    setPickerQuery("");
    setPickerSelected(new Set());
    setPickerAckReplace(false);
    setBatchProjection(null);
    setEditingIndex(null);
    setEditForm(null);
    setEditModelId("");
    setDeleteTarget(null);
    setHoveredRow(null);
    setDragState(null);
    dragCancelled.current = false;
    pendingHandleFocus.current = null;
    setModelQuery("");
    setModelSelected(new Set());
    setCollapsedGroups(new Set());
    setBulkForm(null);
    setBulkError("");
    setBulkDeleteOpen(false);
  }, [routeId]);

  // 模型增删改（含别处改配置）后下标全变：清空选择与批量表单，避免继续
  // 对着旧下标写入。搜索词不动 —— 用户还在看同一批筛选结果。
  React.useEffect(() => {
    setModelSelected((current) => (current.size === 0 ? current : new Set()));
    setBulkForm(null);
    setBulkError("");
  }, [routeModelIdKey]);

  // 选择被清空时一并收起批量表单：没有选中项就没有可应用的目标，
  // 重新勾选时从默认值开始，不残留上一轮填过的值。
  React.useEffect(() => {
    if (modelSelected.size === 0 && bulkForm !== null) {
      setBulkForm(null);
      setBulkError("");
    }
  }, [modelSelected, bulkForm]);

  // 选择被清空（取消选择 / 列表变化 / 写盘成功）时关闭批量删除确认，
  // 避免弹窗还写着已经不存在的目标。
  React.useEffect(() => {
    if (bulkDeleteOpen && modelSelected.size === 0) setBulkDeleteOpen(false);
  }, [bulkDeleteOpen, modelSelected]);

  // 键盘移动后行的 key 会变，手柄被重建、焦点丢失；写盘成功后把焦点还给
  // 新位置的手柄，保证可以连续按方向键。
  React.useEffect(() => {
    const index = pendingHandleFocus.current;
    if (index === null) return;
    pendingHandleFocus.current = null;
    const handle = typeof document === "undefined"
      ? null
      : document.getElementById(`modelpilot-model-handle-${index}`);
    if (handle !== null && typeof handle.focus === "function") handle.focus();
  });

  // 拖动中按 Esc：不写盘。原生拖放在多数浏览器里也会自己取消，这里再记一个
  // 标记，保证即使随后仍收到 drop 也不会提交。
  React.useEffect(() => {
    if (dragState === null || typeof document === "undefined") return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      dragCancelled.current = true;
      setDragState(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dragState]);

  // ── 实时投影：与宿主引擎在单元测试里算出的结果完全一致 ──
  const draft = React.useMemo(() => {
    const id = modelId.trim();
    const d = { id };
    // 显示名留空时显式写入模型 ID：宿主虽然会回落到 id，但回落链中间一级是
    // 目录基准的 name，显式写才能保证别名严格等于 ID（工单 #24 问题 3）。
    const name = displayName.trim() !== "" ? displayName.trim() : id;
    if (name !== "") d.name = name;
    const cw = Number(contextWindow);
    if (contextWindow.trim() !== "" && Number.isFinite(cw) && cw > 0) d.contextWindow = cw;
    const mt = Number(maxTokens);
    if (maxTokens.trim() !== "" && Number.isFinite(mt) && mt > 0) d.maxTokens = mt;
    const input = [];
    if (inputText) input.push("text");
    if (inputImage) input.push("image");
    if (input.length > 0) d.input = input;
    const reasoning = reasoningPolicyFor(reasoningLevels, reasoningApiValues);
    if (reasoning !== undefined) d.reasoning = reasoning;
    return d;
  }, [modelId, displayName, contextWindow, maxTokens, inputText, inputImage, reasoningLevels, reasoningApiValues]);

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

  // ── 行内编辑：diffRow 只产出真正变化的字段；projectPiAi(update) 再以现有行为基底合并 ──
  const editModel = editingIndex === null ? undefined : routeModels[editingIndex];
  const editDiff = React.useMemo(() => {
    if (editingIndex === null || editForm === null) return {};
    return diffRow(editForm, editModel);
  }, [editingIndex, editForm, editModel]);
  // 工单 #38：diffRow 用 null 表示「删除该字段」，不能塞进投影 draft；
  // 拆成要写入的值 + update 模式的 unset 清单。
  const editSplit = React.useMemo(() => splitEditDiff(editDiff), [editDiff]);
  const editDraft = React.useMemo(() => ({ id: editModelId, ...editSplit.values }), [editModelId, editSplit]);
  const editFormError = React.useMemo(
    () => (editingIndex === null || editForm === null ? null : validateEditForm(editForm, editModel)),
    [editingIndex, editForm, editModel],
  );
  const editProjection = React.useMemo(() => {
    if (editingIndex === null || editModelId === "") return undefined;
    try {
      return projectPiAi(
        editDraft,
        { providers, catalogModels: catalogIds },
        { routeId, mode: "update", index: editingIndex, unset: editSplit.unset },
      );
    } catch (error) {
      return {
        settingsOps: [],
        warnings: [{ code: "engine-error", message: String(error?.message ?? error) }],
        unsupportedControls: [],
        appliedFields: [],
        profileOnlyFields: [],
      };
    }
  }, [editDraft, editSplit, providers, routeId, editingIndex, editModelId, catalogIds]);
  const editGuard = editForm === null ? null : reasoningLevelsGuard(editForm.reasoningLevels);
  const editStale = (editProjection?.warnings ?? []).some((warning) => warning.code === "stale-index");
  const editCanSave =
    writable &&
    !busy &&
    editGuard === null &&
    editFormError === null &&
    Object.keys(editDiff).length > 0 &&
    !editStale &&
    (editProjection?.unsupportedControls?.length ?? 0) === 0 &&
    (editProjection?.settingsOps?.length ?? 0) > 0;

  // 至少两条才谈得上排序；只读 / 写入进行中 / 筛选状态下都禁用 ——
  // 拖动按绝对下标写盘，筛选后可见行与下标对不上（工单 #25 判据 12）。
  const canReorderModels =
    writable && !busy && routeModels.length > 1 && modelQuery.trim() === "";

  // ── 新建路由：目录行、表单校验与唯一一条 set op ──────────────────────
  const createRows = React.useMemo(
    () => routeCatalogRows(createCatalog.entries, { settingsNs: LLM_NS, existingIds: routes }),
    [createCatalog.entries, routes],
  );
  const createVisibleRows = React.useMemo(
    () => filterCatalogRows(createRows, createQuery),
    [createRows, createQuery],
  );
  // 这里用整理后的 llm-pi-ai 目录行判断「宿主目录能不能描述这条路由」，
  // 而不是原始跨命名空间列表：否则 deepseek 之类会被误判成可写。
  const createPlan = React.useMemo(
    () => buildRouteCreatePlan({
      mode: createMode,
      providerId: createProviderId,
      baseURL: createBaseURL,
      api: createApi,
      apiKeyEnv: createApiKeyEnv,
      modelIds: createModelIds,
      catalog: createRows,
      existingIds: routes,
    }),
    [
      createMode,
      createProviderId,
      createBaseURL,
      createApi,
      createApiKeyEnv,
      createModelIds,
      createRows,
      routes,
    ],
  );
  const createCustom = createMode === "custom";
  const createProviderText = createProviderId.trim();
  const createCatalogKnown = createPlan.catalogKnown;
  const createCatalogName =
    createRows.find((row) => row.provider === createProviderText)?.displayName ?? createProviderText;
  const createCanSubmit = !createBusy && createPlan.ok;
  const createProviderIdError =
    createProviderText !== "" || createProviderIdTouched ? createPlan.errors.providerId ?? "" : "";
  // 空地址与非法地址都在本地拦住；打开自定义时先显示中性「必填」提示，
  // 一旦开始填 provider id 或碰过这个输入框，就把宿主规则的原话变红。
  const createBaseURLError =
    createBaseURLTouched || (createCustom && createProviderText !== "")
      ? createPlan.errors.baseURL ?? ""
      : "";
  const createModelsError =
    createCustom &&
    createProviderText !== "" &&
    !createPlan.errors.providerId &&
    !createCatalogKnown
      ? createPlan.errors.models ?? ""
      : "";
  const createProviderIdHint = createProviderText === ""
    ? createCustom
      ? "必填；a-z、0-9、连字符"
      : "从下方目录选择"
    : createCatalogKnown
      ? "目录已描述，可不写模型"
      : "目录未描述，需至少一条模型";
  const createProtocolChoices = React.useMemo(() => {
    const choices = (apiChoices.choices ?? []).filter(
      (choice) => typeof choice === "string" && choice !== "",
    );
    return choices.length > 0 ? choices : ["openai-completions"];
  }, [apiChoices]);

  function openCreateRoute() {
    if (!writable) return;
    setCreateOpen(true);
    setCreateMode("catalog");
    // 先放到「读取中」，避免 effect 尚未跑完时短暂显示「没有匹配的提供商」。
    setCreateCatalog({ status: "loading", entries: [], error: "" });
    setCreateQuery("");
    setCreateProviderId("");
    setCreateBaseURL("");
    setCreateApi(defaultProtocolChoice(apiChoices.choices));
    setCreateApiKeyEnv("");
    setCreateModelIds("");
    setCreateProviderIdTouched(false);
    setCreateBaseURLTouched(false);
    setCreateBaseURLNote("");
    setCreateBusy(false);
    setCreateError("");
  }

  function closeCreateRoute() {
    if (createBusy) return;
    setCreateOpen(false);
  }

  function changeCreateMode(next) {
    if (next !== "catalog" && next !== "custom") return;
    setCreateMode(next);
    // 两种来源的 id 语义不同（目录选中的 id vs 手填 id）；切换时清掉，
    // 避免在自定义里提交一条用户没有写过的目录 id。
    setCreateProviderId("");
    setCreateProviderIdTouched(false);
    setCreateBaseURLTouched(false);
    setCreateBaseURLNote("");
    setCreateError("");
  }

  function changeCreateProviderId(value) {
    setCreateProviderId(value);
    setCreateProviderIdTouched(true);
    setCreateError("");
  }

  function changeCreateBaseURL(value) {
    setCreateBaseURL(value);
    setCreateBaseURLTouched(true);
    setCreateBaseURLNote("");
    setCreateError("");
  }

  /**
   * 工单 #40：套用接口地址格式 chip。
   *
   * 用户手输过地址（createBaseURLTouched）并且当前非空时只提示、不覆盖；
   * 「留空自己填」是明确的清空动作，任何时候都执行，也把「手输过」状态复位，
   * 让用户随后可以重新点其它格式。
   */
  function applyBaseURLPreset(id) {
    const preset = BASE_URL_PRESETS.find((candidate) => candidate.id === id);
    if (preset === undefined) return;
    if (preset.id === "empty") {
      setCreateBaseURL("");
      setCreateBaseURLTouched(false);
      setCreateBaseURLNote("");
      setCreateError("");
      return;
    }
    if (createBaseURLTouched && createBaseURL.trim() !== "") {
      setCreateBaseURLNote("已保留你输入的接口地址；要套用格式请先点「留空自己填」");
      return;
    }
    setCreateBaseURL(preset.baseURL);
    // 协议只切到宿主 schema 真的提供的值，避免 select 落到不存在的选项。
    if (preset.api !== null && createProtocolChoices.includes(preset.api)) {
      setCreateApi(preset.api);
    }
    setCreateBaseURLNote("");
    setCreateError("");
  }

  /** 工单 #40：预设只填表单状态，不写任何配置。 */
  function applyModelPreset(preset) {
    const form = presetToForm(preset);
    if (form === null) return;
    setContextWindow(form.contextWindow);
    setMaxTokens(form.maxTokens);
    setContextWindowError(false);
    setMaxTokensError(false);
    setInputText(form.inputText);
    setInputImage(form.inputImage);
    setReasoningLevels(form.reasoningLevels);
    setReasoningApiValues({});
  }

  /** 把一份模板值整体填进新增表单：只改表单状态，显示名 / 模型 ID 不动。 */
  function applyTemplateValues(values) {
    const form = templateToForm(values);
    setContextWindow(form.contextWindow);
    setMaxTokens(form.maxTokens);
    setContextWindowError(false);
    setMaxTokensError(false);
    setInputText(form.inputText);
    setInputImage(form.inputImage);
    setReasoningLevels(form.reasoningLevels);
    setReasoningApiValues({});
  }

  /** 新增表单的「填入」：选中哪一份就填哪一份（不写配置，mutations 保持 0）。 */
  function fillCreateTemplate() {
    applyTemplateValues(selectedTemplate.values);
  }

  /** 编辑表单 / 新增表单的当前值 → 模板结构；两个模态都没勾时返回 null。 */
  function templateValuesOfMode(mode) {
    if (mode === "edit") {
      if (editForm === null) return null;
      return formToTemplate({
        contextWindow: editForm.contextWindow,
        maxTokens: editForm.maxTokens,
        inputText: editForm.inputText,
        inputImage: editForm.inputImage,
        reasoningLevels: editForm.reasoningLevels,
      });
    }
    return formToTemplate({ contextWindow, maxTokens, inputText, inputImage, reasoningLevels });
  }

  /**
   * 选中一份模板并记住「最近选用」；用户模板与内置预设都写（工单 #43 缺陷 2）。
   * 只写 user 时，改选内置预设后重开插件会被静默改写回旧模板。
   *
   * `explicit: false` 只给界面自己的回落用（删掉当前选用的模板后）：那不是
   * 用户为这批模型选过的模板，批量摘要仍应按「内置回落」措辞说明。
   */
  function chooseTemplate(choice, { explicit = true } = {}) {
    setTemplateChoice(choice);
    setTemplateChoiceExplicit(explicit);
    writeTemplateSelection(storage, choice);
  }

  /** 下拉切换：只改选择与摘要，不把值填进表单。 */
  function changeTemplateChoice(value) {
    const parsed = parseTemplateSelectionValue(value);
    if (parsed === null) return;
    if (parsed.kind === "user" && findLibraryTemplate(templateLibrary, parsed.id) === null) return;
    if (parsed.kind === "builtin" && findModelPreset(parsed.id) === null) return;
    chooseTemplate(parsed);
  }

  /**
   * 打开「存为新模板」对话框；库已满时直接说明（不打开注定失败的对话框）。
   * 记下打开它的按钮，关闭后焦点还给它（工单 #43 缺陷 3）。
   */
  function openTemplateDialog(mode) {
    if (templateLibrary.templates.length >= TEMPLATE_MAX_COUNT) {
      setToast({ tone: "bad", text: `最多保存 ${TEMPLATE_MAX_COUNT} 份模板` });
      return;
    }
    templateTriggerRef.current = templateTriggerTargetOf(mode, "saveAsNew");
    setTemplateDialog({ mode, name: "", error: "" });
  }

  function changeTemplateDialogName(name) {
    setTemplateDialog((current) => (current === null ? current : { ...current, name, error: "" }));
  }

  function closeTemplateDialog() {
    setTemplateDialog(null);
  }

  /** 用触发对话框的那个表单的当前值新建一份模板。 */
  function saveTemplateDialog() {
    if (templateDialog === null) return;
    const values = templateValuesOfMode(templateDialog.mode);
    if (values === null) {
      const message = "模板至少需要一个输入模态（text 或 image）";
      setTemplateDialog((current) => (current === null ? current : { ...current, error: message }));
      setToast({ tone: "bad", text: `保存失败：${message}` });
      return;
    }
    const added = addLibraryTemplate(templateLibrary, templateDialog.name, values);
    if (!added.ok) {
      setTemplateDialog((current) => (current === null ? current : { ...current, error: added.error }));
      return;
    }
    if (!writeTemplateLibrary(storage, added.library)) {
      setTemplateDialog((current) => (current === null ? current : { ...current, error: "浏览器未开放本地存储" }));
      return;
    }
    setTemplateLibrary(added.library);
    chooseTemplate({ kind: "user", id: added.id });
    setTemplateDialog(null);
    setToast({ tone: "good", text: `已保存模板「${added.template.name}」` });
  }

  /** 打开管理面板；mode 决定「用当前值覆盖」读哪份表单。 */
  function openTemplateManage(mode) {
    templateTriggerRef.current = templateTriggerTargetOf(mode, "manage");
    setTemplateManage({
      mode,
      renameId: null,
      renameName: "",
      renameError: "",
      confirmOverwriteId: null,
      confirmDeleteId: null,
    });
  }

  function closeTemplateManage() {
    setTemplateManage(null);
  }

  /** 管理面板的局部状态补丁（行内改名 / 二次确认）。 */
  function patchTemplateManage(patch) {
    setTemplateManage((current) => (current === null ? current : { ...current, ...patch }));
  }

  function beginTemplateRename(template) {
    patchTemplateManage({
      renameId: template.id,
      renameName: template.name,
      renameError: "",
      confirmOverwriteId: null,
      confirmDeleteId: null,
    });
  }

  function changeTemplateRenameName(name) {
    patchTemplateManage({ renameName: name, renameError: "" });
  }

  function cancelTemplateRename() {
    patchTemplateManage({ renameId: null, renameName: "", renameError: "" });
  }

  /** 回车确认改名；空 / 超长 / 重名时就地报错，不关输入框。 */
  function commitTemplateRename() {
    if (templateManage === null || templateManage.renameId === null) return;
    const renamedId = templateManage.renameId;
    const result = renameLibraryTemplate(templateLibrary, renamedId, templateManage.renameName);
    if (!result.ok) {
      patchTemplateManage({ renameError: result.error });
      return;
    }
    if (!writeTemplateLibrary(storage, result.library)) {
      patchTemplateManage({ renameError: "浏览器未开放本地存储" });
      return;
    }
    const renamed = findLibraryTemplate(result.library, renamedId);
    setTemplateLibrary(result.library);
    patchTemplateManage({ renameId: null, renameName: "", renameError: "" });
    setToast({ tone: "good", text: `已改名为「${renamed.name}」` });
  }

  function requestOverwriteTemplate(id) {
    patchTemplateManage({ confirmOverwriteId: id, confirmDeleteId: null, renameId: null, renameError: "" });
  }

  /** 用触发面板的那个表单的当前值覆盖这一份（名字不变）。 */
  function confirmOverwriteTemplate() {
    if (templateManage === null || templateManage.confirmOverwriteId === null) return;
    const id = templateManage.confirmOverwriteId;
    const values = templateValuesOfMode(templateManage.mode);
    if (values === null) {
      patchTemplateManage({ confirmOverwriteId: null });
      setToast({ tone: "bad", text: "保存失败：模板至少需要一个输入模态（text 或 image）" });
      return;
    }
    const result = updateLibraryTemplate(templateLibrary, id, values);
    if (!result.ok) {
      patchTemplateManage({ confirmOverwriteId: null });
      setToast({ tone: "bad", text: `覆盖失败：${result.error}` });
      return;
    }
    if (!writeTemplateLibrary(storage, result.library)) {
      patchTemplateManage({ confirmOverwriteId: null });
      setToast({ tone: "bad", text: "保存失败：浏览器未开放本地存储" });
      return;
    }
    const updated = findLibraryTemplate(result.library, id);
    setTemplateLibrary(result.library);
    patchTemplateManage({ confirmOverwriteId: null });
    setToast({ tone: "good", text: `已用当前表单值覆盖「${updated.name}」` });
  }

  function requestDeleteTemplate(id) {
    patchTemplateManage({ confirmDeleteId: id, confirmOverwriteId: null, renameId: null, renameError: "" });
  }

  /** 删除一份模板；删的正好是当前选中项时回落到第一份用户模板 / 内置「基础对话」。 */
  function confirmDeleteTemplate() {
    if (templateManage === null || templateManage.confirmDeleteId === null) return;
    const id = templateManage.confirmDeleteId;
    const target = findLibraryTemplate(templateLibrary, id);
    const result = removeLibraryTemplate(templateLibrary, id);
    if (!result.ok) {
      patchTemplateManage({ confirmDeleteId: null });
      return;
    }
    if (!writeTemplateLibrary(storage, result.library)) {
      patchTemplateManage({ confirmDeleteId: null });
      setToast({ tone: "bad", text: "保存失败：浏览器未开放本地存储" });
      return;
    }
    setTemplateLibrary(result.library);
    patchTemplateManage({ confirmDeleteId: null });
    if (templateChoice.kind === "user" && templateChoice.id === id) {
      chooseTemplate(result.library.templates.length > 0
        ? { kind: "user", id: result.library.templates[0].id }
        : { kind: "builtin", id: MODEL_PRESETS[0].id }, { explicit: false });
    }
    setToast({ tone: "good", text: `已删除模板「${target.name}」` });
  }

  /** 取消行内的覆盖 / 删除二次确认。 */
  function cancelTemplateConfirm() {
    patchTemplateManage({ confirmOverwriteId: null, confirmDeleteId: null });
  }

  /** 管理面板底部：说明「用当前值覆盖」读的是哪份表单。 */
  function templateFormSummary(mode) {
    if (templateValuesOfMode(mode) === null) return "当前表单没有可保存的模板值（需要勾选 text 或 image）";
    return `「用当前值覆盖」使用${mode === "edit" ? "编辑" : "新增"}表单的当前值`;
  }

  /** 唯一写入路径：先校验出 1 条 set，再调用宿主 mutate。 */
  async function createRoute() {
    if (createBusy) return;
    const plan = buildRouteCreatePlan({
      mode: createMode,
      providerId: createProviderId,
      baseURL: createBaseURL,
      api: createApi,
      apiKeyEnv: createApiKeyEnv,
      modelIds: createModelIds,
      catalog: createRows,
      existingIds: routes,
    });
    if (!plan.ok) {
      setCreateProviderIdTouched(true);
      setCreateBaseURLTouched(true);
      return;
    }
    setCreateBusy(true);
    setCreateError("");
    try {
      const ok = await scope.mutate([plan.op]);
      if (!ok) {
        // 不清空表单：用户核对后可以原样重试（mutate 自带修订号围栏）。
        setCreateError("创建被系统拒绝（配置已变化或校验失败），已重新读取当前配置，请核对后重试");
        return;
      }
      setRevealCreatedRoute(plan.providerId);
      setCreateOpen(false);
      setRouteId(plan.providerId);
      setToast({ tone: "good", text: `已创建路由 ${plan.providerId}` });
    } catch (error) {
      setCreateError(`创建异常：${error?.message ?? error}`);
    } finally {
      setCreateBusy(false);
    }
  }

  /** token 输入：合法值写入状态；非法值不落状态，回显最近一次合法值并给出错误。 */
  function changeTokenCount(event, current, setValue, setError) {
    const state = classifyTokenInput(event.target.value);
    if (state.status === TOKEN_INPUT.INVALID) {
      setError(true);
      event.target.value = current;
      return;
    }
    setValue(state.status === TOKEN_INPUT.EMPTY ? "" : event.target.value);
    setError(false);
  }

  /** 新增表单的「API 参数值」：原样保存输入，trim / 丢弃规则交给 reasoningPolicyFor。 */
  function changeReasoningApiValue(level, value) {
    setReasoningApiValues((current) => ({ ...current, [level]: value }));
  }

  /** 工单 #31：密度是全局前端偏好，写 localStorage；非法值不改变界面。 */
  function changeModelDensity(next) {
    if (next !== DENSITY_COMPACT && next !== DENSITY_DETAILED) return;
    setModelDensity(next);
    writeModelListDensity(storage, next);
  }

  /**
   * 工单 #39：平铺 / 分组也是全局前端偏好，写 localStorage；非法值不改变界面。
   * 切换视图不碰 collapsedGroups —— 折叠状态留给分组视图，切回来时原样恢复。
   */
  function changeModelView(next) {
    if (next !== VIEW_FLAT && next !== VIEW_GROUPED) return;
    setModelView(next);
    writeModelListView(storage, next);
  }

  /** 工单 #31：折叠 / 展开一个分组。纯视图状态，不写配置。 */
  function toggleModelGroup(key) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  /** 打开某一行的编辑表单；换行时前一条自动收起（editingIndex 只有一个）。 */
  function openEditor(index) {
    const model = routeModels[index];
    if (model === undefined) return;
    setEditingIndex(index);
    setEditModelId(typeof model.id === "string" ? model.id : "");
    setEditForm(formFromModel(model));
    setEditErrors({ contextWindow: false, maxTokens: false });
    setDeleteTarget(null);
    setToast(null);
  }

  function closeEditor() {
    setEditingIndex(null);
    setEditForm(null);
    setEditModelId("");
    setEditErrors({ contextWindow: false, maxTokens: false });
    setDeleteTarget(null);
  }

  // ── 模型排序（工单 #19）：拖动 + 键盘，松手 / 按键即写盘 ──────────────
  // 工单 #32：分组视图只允许在本组内换位。
  // 工单 #39：平铺视图恢复全局语义 —— 跨组也允许，Home / End 到全表首末位。

  /** 按 models 数组的绝对下标取分组键；分组算法仍由 groupKeyOf 决定。 */
  function groupKeyOfIndex(index) {
    return groupKeyOf(routeModels[index]?.id);
  }

  /**
   * 这次落点是否要被分组规则拒绝：只有分组视图才有组边界。
   * 平铺视图的排序键是数组位置本身，跨组拖动就是用户想要的全局排序。
   */
  function crossGroupBlocked(from, index) {
    return modelView === VIEW_GROUPED && groupKeyOfIndex(from) !== groupKeyOfIndex(index);
  }

  /** 拖动手柄按下：只记来源，不改列表；拖拽数据用 text/plain 兼容 Firefox。 */
  function beginModelDrag(event, index) {
    if (!canReorderModels) {
      event.preventDefault();
      return;
    }
    dragCancelled.current = false;
    if (event.dataTransfer !== null && event.dataTransfer !== undefined) {
      event.dataTransfer.effectAllowed = "move";
      try {
        event.dataTransfer.setData("text/plain", String(index));
      } catch {
        /* 某些浏览器在合成事件里不允许写 DataTransfer；拖动本身不依赖它 */
      }
    }
    setDragState({ from: index, over: null, edge: null });
  }

  /**
   * 拖动经过某一行：按指针在行的上半 / 下半决定插入线画在行前还是行后。
   * 工单 #32：分组视图落点跨组时不进 dragState.over —— 不画插入线，指针也
   * 显示禁止放置；仍然 preventDefault，让松手能收到 drop 并给出明确的拒绝提示。
   * 工单 #39：平铺视图没有组边界，跨组落点照常画插入线。
   */
  function updateModelDragOver(event, index) {
    if (dragState === null) return;
    event.preventDefault();
    const crossGroup = crossGroupBlocked(dragState.from, index);
    if (event.dataTransfer !== null && event.dataTransfer !== undefined) {
      event.dataTransfer.dropEffect = crossGroup ? "none" : "move";
    }
    if (crossGroup) {
      setDragState((current) => (
        current === null || current.over === null
          ? current
          : { ...current, over: null, edge: null }
      ));
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
    setDragState((current) => (
      current === null || (current.over === index && current.edge === edge)
        ? current
        : { ...current, over: index, edge }
    ));
  }

  function endModelDrag() {
    dragCancelled.current = false;
    setDragState(null);
  }

  /**
   * 松手：把「行前 / 行后插入点」换算成移除来源后的目标下标，再立即写盘。
   * 拖回原位（to === from）不产生任何写入。
   * 工单 #32：分组视图跨组拖动直接丢弃 —— 组间顺序由 id 前缀决定，按绝对
   * 下标重排只会悄悄改变组内顺序，既不是用户拖到的位置也会写脏数据。
   * 工单 #39：平铺视图没有这层拒绝，跨组落点就是真正的全局位置。
   */
  function handleModelDrop(event, index) {
    if (dragState === null) return;
    event.preventDefault();
    const cancelled = dragCancelled.current;
    dragCancelled.current = false;
    const from = dragState.from;
    // 先读落点几何，再清 dragState：清状态触发的重渲染会换掉落点节点，
    // 之后读 event.currentTarget 可能已经不在文档里（几何全 0）。
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
    const slot = index + (edge === "after" ? 1 : 0);
    const to = slot > from ? slot - 1 : slot;
    setDragState(null);
    if (cancelled) return;
    if (crossGroupBlocked(from, index)) {
      setToast({ tone: "bad", text: "只能在同一分组内调整顺序；跨分组无法排序" });
      return;
    }
    if (to === from) return;
    void moveModelTo(from, to);
  }

  /**
   * 手柄聚焦后的方向键，每次立即写盘。
   * 分组视图（工单 #32）：↑ / ↓ 在本组内一位、Home / End 组内首 / 末位 ——
   * 组间顺序由 id 前缀决定，把行挪到别的组名次不会在界面上产生位移。
   * 平铺视图（工单 #39）：Home / End 是整张表的首 / 末位，↑ / ↓ 跨组也连续。
   */
  function handleModelHandleKey(event, index) {
    if (!canReorderModels) return;
    let to;
    if (modelView === VIEW_FLAT) {
      const last = routeModels.length - 1;
      if (event.key === "ArrowUp") to = Math.max(index - 1, 0);
      else if (event.key === "ArrowDown") to = Math.min(index + 1, last);
      else if (event.key === "Home") to = 0;
      else if (event.key === "End") to = last;
      else return;
    } else {
      const group = modelGroupsVisible.find((item) => item.rows.some((row) => row.index === index));
      if (group === undefined || !group.expanded) return;
      const ordinal = group.rows.findIndex((row) => row.index === index);
      if (ordinal < 0) return;
      if (event.key === "ArrowUp") to = group.rows[Math.max(ordinal - 1, 0)].index;
      else if (event.key === "ArrowDown") to = group.rows[Math.min(ordinal + 1, group.rows.length - 1)].index;
      else if (event.key === "Home") to = group.rows[0].index;
      else if (event.key === "End") to = group.rows[group.rows.length - 1].index;
      else return;
    }
    event.preventDefault();
    if (to === index) return;
    void moveModelTo(index, to, { focusHandle: true });
  }

  /**
   * 立即写盘：先按最新快照复核下标（防止拖动期间配置被别处改动），再用
   * moveModel 生成一条整数组 set，只调用一次 mutate。失败时不改本地顺序 ——
   * 列表本来就还停在移动前，正是要回滚到的状态；只用 toast 说明未保存。
   */
  async function moveModelTo(from, to, { focusHandle = false } = {}) {
    if (!writable || busy) return;
    const latestProviders = providersOf(scope.getSnapshot());
    const latestRoute = routeId === "" ? undefined : latestProviders[routeId];
    const latestModels = Array.isArray(latestRoute?.models) ? latestRoute.models : [];
    const currentIds = routeModels.map((model) => model?.id);
    const latestIds = latestModels.map((model) => model?.id);
    const unchanged =
      latestIds.length === currentIds.length && latestIds.every((id, index) => id === currentIds[index]);
    if (!unchanged) {
      setToast({ tone: "bad", text: "模型列表已变化，排序未保存；已重新读取当前配置，请核对后重试" });
      return;
    }
    const result = moveModel(latestModels, from, to, routeId);
    if (result.warning !== undefined) {
      setToast({ tone: "bad", text: result.warning.message });
      return;
    }
    const movedId =
      typeof latestModels[from]?.id === "string" && latestModels[from].id !== ""
        ? latestModels[from].id
        : `第 ${from + 1} 个模型`;
    // 分组视图按组阅读顺序报位次；平铺视图的位次就是数组下标 + 1。
    const movedOrdinal = modelView === VIEW_FLAT
      ? to + 1
      : Array.isArray(result.models)
        ? groupedOrdinalOf(result.models, to)
        : to + 1;
    setBusy(true);
    setToast(null);
    try {
      const ok = await scope.mutate(result.ops);
      if (ok) {
        // 行内编辑 / 删除确认按「打开时的下标」定位；重排后下标全变，继续
        // 展开会编辑到另一条模型，因此成功后收起，让用户按新位置重开。
        closeEditor();
        setDeleteTarget(null);
        setModelSelected(new Set());
        setBulkForm(null);
        if (focusHandle) pendingHandleFocus.current = to;
        setToast({ tone: "good", text: `已把 ${movedId} 移到第 ${movedOrdinal} 位` });
      } else {
        if (focusHandle) pendingHandleFocus.current = from;
        setToast({ tone: "bad", text: "排序未保存（系统拒绝或配置已变化），列表保持原顺序，请核对后重试" });
      }
    } catch (error) {
      if (focusHandle) pendingHandleFocus.current = from;
      setToast({ tone: "bad", text: `排序失败：${error?.message ?? error}；列表保持原顺序` });
    } finally {
      setBusy(false);
    }
  }

  // ── 主列表搜索 / 批量操作（工单 #25）────────────────────────────────────

  /** 批量改字段表单 → planBulkFields 的 patch（只有勾选的字段出现）。 */
  function bulkPatchFromForm(form) {
    const patch = {};
    if (form === null) return patch;
    if (form.maxTokensOn) patch.maxTokens = form.maxTokens;
    if (form.inputOn) {
      const input = [];
      if (form.inputText) input.push("text");
      if (form.inputImage) input.push("image");
      patch.input = input;
    }
    if (form.levelsOn) patch.reasoningLevels = form.levels;
    return patch;
  }

  /** 勾选 / 取消某一行。勾选的是绝对下标，与搜索词无关。 */
  function toggleModelSelected(index) {
    if (busy || !writable) return;
    setModelSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  /** 全选只作用于当前筛选结果；取消全选也只移除这些行。 */
  function selectAllVisible(checked) {
    if (busy || !writable) return;
    setModelSelected((current) => {
      const next = new Set(current);
      for (const index of visibleModelIndexes) {
        if (checked) next.add(index);
        else next.delete(index);
      }
      return next;
    });
  }

  function clearModelSelection() {
    setModelSelected(new Set());
    setBulkForm(null);
    setBulkError("");
    setBulkDeleteOpen(false);
  }

  function openBulkFields() {
    if (busy || !writable || modelSelected.size === 0) return;
    setBulkError("");
    setBulkForm({
      maxTokensOn: false,
      maxTokens: "",
      inputOn: false,
      inputText: true,
      inputImage: false,
      levelsOn: false,
      levels: defaultReasoningLevels(),
    });
  }

  function updateBulkForm(patch) {
    setBulkForm((current) => (current === null ? current : { ...current, ...patch }));
    setBulkError("");
  }

  function toggleBulkLevel(level) {
    setBulkForm((current) => (current === null
      ? current
      : { ...current, levels: toggleReasoningLevel(current.levels, level) }));
    setBulkError("");
  }

  /**
   * 写前按最新快照复核 id 序列（不是长度）：长度相同但顺序变了，
   * 同一下标已经指向另一条模型。列表变了就清空选择并提示，绝不写入。
   */
  function latestModelsForBulk() {
    const latestProviders = providersOf(scope.getSnapshot());
    const latestRoute = routeId === "" ? undefined : latestProviders[routeId];
    const latestModels = Array.isArray(latestRoute?.models) ? latestRoute.models : [];
    const currentIds = routeModels.map((model) => model?.id);
    const latestIds = latestModels.map((model) => model?.id);
    if (!sameIdSequence(currentIds, latestIds)) {
      clearModelSelection();
      setToast({ tone: "bad", text: "模型列表已变化，批量操作未执行；已重新读取当前配置，请核对后重试" });
      return null;
    }
    return latestModels;
  }

  /** 取消所有当前不可见（折叠分组或搜索过滤）的选中行，保留可见选择。 */
  function clearHiddenModelSelection() {
    if (busy || !writable) return;
    const hidden = new Set(bulkSelectionSummary.hiddenIndexes);
    if (hidden.size === 0) return;
    setModelSelected((current) => {
      const next = new Set([...current].filter((index) => !hidden.has(index)));
      return next.size === current.size ? current : next;
    });
  }

  /** 打开批量删除的二次确认；打开本身不写盘。 */
  function requestBulkDelete() {
    if (busy || !writable || modelSelected.size === 0 || bulkDeleteBlocked) return;
    setBulkDeleteOpen(true);
  }

  /** 批量删除：确认后一次 mutate、一条 set 重写整数组，要么全成要么全不成。 */
  async function confirmBulkDelete() {
    if (!bulkDeleteOpen || busy || !writable || modelSelected.size === 0) return;
    const latestModels = latestModelsForBulk();
    if (latestModels === null) {
      setBulkDeleteOpen(false);
      return;
    }
    const plan = planBulkDelete(latestModels, modelSelected, routeId);
    if (plan.status !== "ok") {
      setBulkDeleteOpen(false);
      setToast({ tone: "bad", text: plan.message });
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      const ok = await scope.mutate(plan.ops);
      if (ok) {
        setBulkDeleteOpen(false);
        setToast({ tone: "good", text: `已删除 ${plan.removed.length} 条模型` });
        clearModelSelection();
        closeEditor();
        setDeleteTarget(null);
      } else {
        setToast({ tone: "bad", text: "批量删除被系统拒绝（配置已变化或校验失败），批量操作未执行；已重新读取当前配置，请核对后重试" });
      }
    } catch (error) {
      setToast({ tone: "bad", text: `批量删除异常：${error?.message ?? error}` });
    } finally {
      setBusy(false);
    }
  }

  /** 批量改字段：同样一次 mutate、一条 set；每个模型的其他字段原样保留。 */
  async function applyBulkFields() {
    if (bulkForm === null || busy || !writable || modelSelected.size === 0) return;
    const latestModels = latestModelsForBulk();
    if (latestModels === null) return;
    const selection = modelSelected;
    const plan = planBulkFields(latestModels, selection, bulkPatchFromForm(bulkForm), routeId);
    if (plan.status !== "ok") {
      setBulkError(plan.message ?? "批量修改未执行");
      return;
    }
    setBusy(true);
    setToast(null);
    setBulkError("");
    try {
      const ok = await scope.mutate(plan.ops);
      if (ok) {
        // 工单 #35：N 是真实改动条数；本来就是目标值的行单独说明。
        setToast({ tone: "good", text: bulkFieldsNotice(plan.changed.length, selection.size) });
        clearModelSelection();
        closeEditor();
        setDeleteTarget(null);
      } else {
        setToast({ tone: "bad", text: "批量修改被系统拒绝（配置已变化或校验失败），批量操作未执行；已重新读取当前配置，请核对后重试" });
      }
    } catch (error) {
      setToast({ tone: "bad", text: `批量修改异常：${error?.message ?? error}` });
    } finally {
      setBusy(false);
    }
  }

  function updateEditForm(patch) {
    setEditForm((current) => (current === null ? current : { ...current, ...patch }));
  }

  /**
   * 把当前选中的模板填进编辑表单（工单 #42：与新增表单共用同一个选择器）。
   *
   * templateToForm 不返回 name，浅合并不会动显示名。模板里为空的字段会
   * 如实清空表单值 —— 这是「整体替换」，不是「只覆盖有值的字段」。
   */
  function fillEditTemplate() {
    // 模板不含 API 参数值：整体替换时一并清空，避免旧的映射残留在新档位上。
    const next = { ...templateToForm(selectedTemplate.values), reasoningApiValues: {} };
    updateEditForm(next);
    // 模板只校验结构、不校验 token 文案；与输入层共用判定，坏值立刻标红。
    setEditErrors({
      contextWindow: classifyTokenInput(next.contextWindow).status === TOKEN_INPUT.INVALID,
      maxTokens: classifyTokenInput(next.maxTokens).status === TOKEN_INPUT.INVALID,
    });
  }

  /** 编辑表单的 token 输入：与 diffRow 共用 classifyTokenInput，空串是合法清空。 */
  function changeEditToken(event, field) {
    const state = classifyTokenInput(event.target.value);
    if (state.status === TOKEN_INPUT.INVALID) {
      setEditErrors((current) => ({ ...current, [field]: true }));
      event.target.value = editForm?.[field] ?? "";
      return;
    }
    updateEditForm({ [field]: state.status === TOKEN_INPUT.EMPTY ? "" : event.target.value });
    setEditErrors((current) => ({ ...current, [field]: false }));
  }

  function toggleEditLevel(level) {
    setEditForm((current) => (current === null
      ? current
      : { ...current, reasoningLevels: toggleReasoningLevel(current.reasoningLevels, level) }));
  }

  /** 编辑表单的「API 参数值」：只更新对应档位，空串保留为空串（语义 = 用档位名）。 */
  function changeEditApiValue(level, value) {
    setEditForm((current) => (current === null
      ? current
      : {
        ...current,
        reasoningApiValues: { ...(current.reasoningApiValues ?? {}), [level]: value },
      }));
  }

  /** 保存编辑：恰好一条 set，路径是 models.<打开时的下标>。 */
  async function saveEdit() {
    if (!editCanSave || !editProjection) return;
    setBusy(true);
    setToast(null);
    try {
      const ok = await scope.mutate(editProjection.settingsOps);
      if (ok) {
        setToast({ tone: "good", text: `已更新 ${routeId} / ${editModelId}` });
        closeEditor();
        setModelSelected(new Set());
        setBulkForm(null);
      } else {
        setToast({ tone: "bad", text: "更新被系统拒绝（配置已变化或校验失败），已重新读取当前配置，请核对后重试" });
      }
    } catch (error) {
      setToast({ tone: "bad", text: `更新异常：${error?.message ?? error}` });
    } finally {
      setBusy(false);
    }
  }

  /** 删除请求：打开自绘二次确认弹窗。 */
  function requestDelete() {
    if (editingIndex === null || editModelId === "") return;
    setDeleteTarget({ index: editingIndex, id: editModelId });
  }

  /**
   * 行内删除（工单 #28 / #31）：不必先展开编辑，直接把这一行交给同一个
   * DeleteConfirmDialog；确认后仍走 confirmDelete 的原有写入路径。
   */
  function requestRowDelete(index, model) {
    if (!writable || busy) return;
    const id = typeof model?.id === "string" ? model.id : "";
    if (id === "") return;
    setDeleteTarget({ index, id });
  }

  /**
   * 确认删除。先按最新快照复核下标与 id，防止弹窗打开期间配置被别处改动
   * 而删错行；随后走 projectPiAi(remove) 的一条 set 重写整个 models 数组。
   */
  async function confirmDelete() {
    if (deleteTarget === null) return;
    const latestProviders = providersOf(scope.getSnapshot());
    const latestRoute = latestProviders[routeId];
    const latestModels = Array.isArray(latestRoute?.models) ? latestRoute.models : [];
    if (latestModels[deleteTarget.index]?.id !== deleteTarget.id) {
      setDeleteTarget(null);
      setToast({ tone: "bad", text: "模型下标已失效，配置可能已被别处修改；已重新读取，请核对后重试" });
      return;
    }
    const projectionResult = projectPiAi(
      {},
      { providers: latestProviders },
      { routeId, mode: "remove", index: deleteTarget.index },
    );
    if (projectionResult.settingsOps.length === 0) {
      setDeleteTarget(null);
      setToast({ tone: "bad", text: "删除被拒绝：模型下标已失效，请重新读取后重试" });
      return;
    }
    setBusy(true);
    setToast(null);
    try {
      const ok = await scope.mutate(projectionResult.settingsOps);
      if (ok) {
        setToast({ tone: "good", text: `已删除 ${routeId} / ${deleteTarget.id}` });
        setDeleteTarget(null);
        setModelSelected(new Set());
        setBulkForm(null);
        if (editingIndex === deleteTarget.index) closeEditor();
      } else {
        setToast({ tone: "bad", text: "删除被系统拒绝（配置已变化或校验失败），已重新读取当前配置，请核对后重试" });
      }
    } catch (error) {
      setToast({ tone: "bad", text: `删除异常：${error?.message ?? error}` });
    } finally {
      setBusy(false);
    }
  }

  /** 「+ 新增」回到现有新增表单：滚动到模型 ID 并聚焦；不改动选择器流程。 */
  function focusCreateForm() {
    const input = typeof document === "undefined" ? null : document.getElementById("modelpilot-model-id");
    if (input === null) return;
    if (typeof input.scrollIntoView === "function") input.scrollIntoView({ block: "center" });
    if (typeof input.focus === "function") input.focus();
  }

  /**
   * 从当前路由的端点拉取模型列表。
   *
   * 走宿主的 remote.llm.discoverModels：凭据（apiKeyEnv 指向的条目）由宿主
   * 自己解析，前端既不持有明文 key，也不需要传 apiKey。
   * 只传 provider 和 baseURL；api 用路由上声明的协议。
   */
  async function fetchModels() {
    if (fetchState === "loading") return;
    const latestProviders = providersOf(scope.getSnapshot());
    const latestRoute = routeId ? latestProviders[routeId] : undefined;
    const baseURL = typeof latestRoute?.baseURL === "string" ? latestRoute.baseURL.trim() : "";
    const api = typeof latestRoute?.api === "string" && latestRoute.api !== "" ? latestRoute.api : undefined;
    if (baseURL === "") {
      setFetchState("failed");
      setFetchError("当前路由未配置 baseURL");
      return;
    }
    const generation = ++fetchGeneration.current;
    setFetchState("loading");
    setFetchError("");
    try {
      const response = await discoverModels(LLM_NS, {
        provider: routeId,
        baseURL,
        ...(api === undefined ? {} : { api }),
      });
      if (generation !== fetchGeneration.current) return;
      if (!response.ok) {
        setFetchState("failed");
        setFetchError(response.error?.message ?? "模型发现请求被拒绝");
        return;
      }
      const ids = [...new Set(
        (response.value ?? [])
          .map((entry) => (typeof entry?.id === "string" ? entry.id.trim() : ""))
          .filter((id) => id !== ""),
      )];
      if (ids.length === 0) {
        setFetchState("failed");
        setFetchError("端点返回了空的模型列表");
        return;
      }
      setRemoteModels(ids);
      setFetchState("done");
      // 拉取成功自动打开选择器；空列表 / 失败在上面已经返回，不会开窗。
      setPickerQuery("");
      setPickerSelected(new Set());
      setPickerAckReplace(false);
      setPickerOpen(true);
    } catch (error) {
      if (generation !== fetchGeneration.current) return;
      setFetchState("failed");
      setFetchError(String(error?.message ?? error));
    }
  }

  /** 清空选择器的搜索词、勾选与目录确认；开窗/关窗都调用（不记忆上次）。 */
  function resetPickerState() {
    setPickerQuery("");
    setPickerSelected(new Set());
    setPickerAckReplace(false);
  }

  function openPicker() {
    resetPickerState();
    setPickerOpen(true);
  }

  function closePicker() {
    setPickerOpen(false);
    resetPickerState();
  }

  function togglePickerModel(id) {
    setPickerSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 全选只勾 status:"new"；已存在与默认的「仅大小写不同」保持原状。 */
  function selectAllPicker(select) {
    setPickerSelected((current) => {
      if (!select) return new Set();
      const next = new Set(current);
      for (const entry of classifyModels(remoteModels, existingModelIds)) {
        if (entry.status === "new") next.add(entry.id);
      }
      return next;
    });
  }

  function buildBatchPlan(ids, ackedReplacement) {
    return planBatchSelection(
      ids,
      { providers, catalogModels: catalogIds },
      { routeId, template: selectedTemplate.values, ackedReplacement },
    );
  }

  /** 批量写入：所有 op 合成一个数组，只调用一次 scope.mutate。返回是否成功。 */
  async function applyBatchPlan(plan) {
    setBusy(true);
    setToast(null);
    try {
      const ok = await scope.mutate(plan.ops);
      setToast(
        ok
          ? { tone: "good", text: `已写入 ${routeId} / ${plan.written.length} 个模型` }
          : { tone: "bad", text: "写入被系统拒绝（配置已变化或校验失败），已重新读取当前配置，请核对后重试" },
      );
      if (ok) setAckReplace(false);
      return ok;
    } catch (error) {
      setToast({ tone: "bad", text: `写入异常：${error?.message ?? error}` });
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** 确定：1 个回填单条表单；≥2 个只生成待写入计划并关窗，由用户再点「写入」。 */
  function confirmPicker() {
    if (overridesInUse) return;
    const selectedIds = remoteModels.filter((id) => pickerSelected.has(id));
    if (selectedIds.length === 0) return;
    if (selectedIds.length === 1) {
      const id = selectedIds[0];
      setModelId(id);
      setBatchProjection(null);
      if (!displayNameTouched.current) setDisplayName(displayNameFromModelId(id));
      closePicker();
      return;
    }
    const plan = buildBatchPlan(selectedIds, pickerAckReplace);
    // 新的一批替换旧的一批，不累加 —— 避免把两批混在一起误写。
    setBatchProjection(plan.ops.length > 0 ? plan : null);
    setToast(null);
    closePicker();
    if (plan.ops.length === 0) {
      setToast({ tone: "bad", text: "没有可写入的模型（全部被跳过或投影被拒绝）" });
    }
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
          :           { tone: "bad", text: "写入被系统拒绝（配置已变化或校验失败），已重新读取当前配置，请核对后重试" },
      );
      if (ok) {
        const form = templateToForm(selectedTemplate.values);
        displayNameTouched.current = false;
        setModelId("");
        setDisplayName("");
        setContextWindow(form.contextWindow);
        setMaxTokens(form.maxTokens);
        setContextWindowError(false);
        setMaxTokensError(false);
        setInputText(form.inputText);
        setInputImage(form.inputImage);
        setReasoningLevels(form.reasoningLevels);
        setReasoningApiValues({});
        setAckReplace(false);
        setBatchProjection(null);
        setModelSelected(new Set());
        setBulkForm(null);
      }
    } catch (error) {
      setToast({ tone: "bad", text: `写入异常：${error?.message ?? error}` });
    } finally {
      setBusy(false);
    }
  }

  /** 路由设置卡片：无 hook 的展示组件，状态全部由 Workbench 持有。 */
  function updateRouteForm(patch) {
    // 任何一个字段变了，上一轮测试结论就不再对应当前表单（避免「测过 A 却
    // 以为测的是 B」）；进行中的请求继续按发起时的快照跑，但结果不再落地。
    connectionTestGeneration.current += 1;
    setConnectionTest({ status: "idle", tone: "", text: "" });
    setRouteFormState((current) => (current === null ? current : { ...current, ...patch }));
  }

  /**
   * 测试连接：用表单当前值发起一次真实探活。
   *
   * provider 不能无条件带，也不能无条件不带：
   *   - 宿主只按 request.provider 解析已保存的凭据，不带就根本没有密钥
   *     （旧实现的 401 根因）；
   *   - 但目录有货的 provider 一旦带上，宿主会直接回内置目录、不发 HTTP
   *     请求，探活就变成了读目录。
   * 因此按 declared 分流；目录读不到时保守按 declared（带 provider），至少
   * 让用户看到端点/密钥的真实结果，而不是「没带密钥」的 401。
   * 密钥始终不经过前端：只传 provider，凭据解析完全归宿主。
   */
  async function testConnection(form) {
    if (form === null || connectionTest.status === "running") return;
    const baseURL = typeof form.baseURL === "string" ? form.baseURL.trim() : "";
    if (baseURL === "" || !/^https?:\/\//i.test(baseURL)) return;
    const api = typeof form.api === "string" && form.api.trim() !== "" ? form.api.trim() : undefined;
    const generation = ++connectionTestGeneration.current;
    setConnectionTest({ status: "running", tone: "", text: "" });
    const settle = (tone, text) => {
      if (generation !== connectionTestGeneration.current) return;
      setConnectionTest({ status: "done", tone, text });
    };
    try {
      const entries = await loadCatalogEntries(listConfigurableProviders);
      // 目录是异步读的：这期间表单 / 路由可能已经变了，不要再替旧快照发请求。
      if (generation !== connectionTestGeneration.current) return;
      const { request } = buildProbeRequest({ entries, routeId, baseURL, api });
      const response = await discoverModels(LLM_NS, request);
      if (generation !== connectionTestGeneration.current) return;
      if (response?.ok === true) {
        const count = Array.isArray(response.value) ? response.value.length : 0;
        if (count > 0) settle("success", `连接正常 · 端点返回 ${count} 个模型`);
        else settle("warn", "连接正常，但端点没有返回任何模型");
        return;
      }
      if (response?.error?.code === "DISCOVERY_UNSUPPORTED") {
        settle("error", "该协议没有可读的模型列表，换个协议或手动填写模型");
        return;
      }
      settle("error", probeFailureText(response?.error));
    } catch (error) {
      settle("error", probeFailureText(error));
    }
  }

  /** 打开密钥编辑器：清空上一轮输入与错误，明文只在内存里停留到保存 / 取消。 */
  function openCredentialEditor() {
    setCredentialDraft("");
    setCredentialError("");
    setCredentialEditorOpen(true);
  }

  function cancelCredentialEditor() {
    setCredentialEditorOpen(false);
    setCredentialDraft("");
    setCredentialError("");
  }

  function changeCredentialDraft(event) {
    setCredentialDraft(event.target.value);
    if (credentialError !== "") setCredentialError("");
  }

  /** 把派生建议填进 apiKeyEnv（只改表单，不自动保存）。 */
  function useCredentialSuggestion() {
    const suggestion = deriveKeyRef(routeId);
    if (suggestion !== "") updateRouteForm({ apiKeyEnv: suggestion });
  }

  /**
   * 保存密钥：value 原样交给宿主 credentials.set —— 不 trim、不加前后缀。
   * 失败时不清空输入、不改状态；成功后才关闭编辑器并重新 describe。
   */
  async function saveCredential() {
    if (credentialBusy || credentialReference === "" || credentialDraft === "") return;
    setCredentialBusy(true);
    setCredentialError("");
    try {
      const response = await credentialOps.set(credentialReference, credentialDraft);
      if (response?.ok === true) {
        setCredentialDraft("");
        setCredentialEditorOpen(false);
        setCredentialRefresh((current) => current + 1);
      } else {
        setCredentialError(
          `密钥保存失败：${redactSecret(credentialErrorMessage(response, "凭据服务拒绝写入"), credentialDraft)}`,
        );
      }
    } catch (error) {
      setCredentialError(`密钥保存失败：${redactSecret(String(error?.message ?? error), credentialDraft)}`);
    } finally {
      setCredentialBusy(false);
    }
  }

  /** 清除密钥：确认弹窗之后才调用 credentials.unset，然后重新 describe。 */
  async function clearCredential() {
    if (credentialBusy || credentialReference === "") return;
    setCredentialBusy(true);
    setCredentialError("");
    try {
      const response = await credentialOps.unset(credentialReference);
      setCredentialConfirmOpen(false);
      if (response?.ok === true) {
        setCredentialRefresh((current) => current + 1);
      } else {
        setCredentialError(`密钥清除失败：${credentialErrorMessage(response, "凭据服务拒绝删除")}`);
      }
    } catch (error) {
      setCredentialConfirmOpen(false);
      setCredentialError(`密钥清除失败：${String(error?.message ?? error)}`);
    } finally {
      setCredentialBusy(false);
    }
  }

  function toggleRouteCard() {
    // 收起卡片时确认弹窗一并消失：不能留一个看不见却仍挂着的待确认状态。
    if (routeCardOpen) setRenameConfirm(null);
    setRouteCardOpen((current) => !current);
  }

  /** 总览与下拉框共用同一个切换入口：点当前行不做任何事（不重置表单）。 */
  function selectRoute(nextId) {
    if (nextId === routeId || nextId === "") return;
    setRouteId(nextId);
    setAckReplace(false);
  }

  function toggleOverview() {
    setOverviewOpen((current) => !current);
  }

  function retryOverview() {
    setOverviewRefresh((current) => current + 1);
  }

  /** 就地展开 / 收起某个默认值的受影响模型清单（不弹窗）。 */
  function toggleRouteDefaultUsage(modelField) {
    setRouteDefaultUsageOpen((current) => ({ ...current, [modelField]: !current[modelField] }));
  }

  async function confirmDeleteRoute() {
    await deleteRoute();
    setRouteConfirmOpen(false);
  }

  /** 只读 describe 一个引用名；失败 / 异常统一折成 error 状态，调用方按「读不到」处理。 */
  async function probeCredentialRef(ref) {
    try {
      const response = await credentialOps.describe([ref]);
      if (response?.ok !== true) {
        return {
          status: "error",
          configured: false,
          writable: false,
          error: credentialErrorMessage(response, "未返回原因"),
        };
      }
      const info = response.value?.[ref];
      return {
        status: "ready",
        configured: info?.configured === true,
        writable: info?.writable !== false,
        error: "",
      };
    } catch (error) {
      return {
        status: "error",
        configured: false,
        writable: false,
        error: String(error?.message ?? error),
      };
    }
  }

  /** 确认改引用名：带着弹窗打开时的那份表单，按「先删旧密钥再写配置」重跑一次保存。 */
  async function confirmKeyRename() {
    if (renameConfirm === null) return;
    const pending = renameConfirm;
    try {
      await saveRouteSettings(pending.form, { confirmRename: true });
    } finally {
      // 无论删密钥 / 写配置成功还是失败，弹窗都必须关掉：失败原因在 toast 里。
      setRenameConfirm(null);
    }
  }

  /**
   * 保存路由设置：先按最新快照重算 ops（路由若已被别处删除就拒绝写入），
   * 再走与模型写入相同的修订号围栏。返回新表单供卡片重新预填。
   *
   * 工单 #37：改引用名可能让旧密钥变成界面上再也看不到的永久孤儿。apiKeyEnv
   * 真的变化时先只读 describe 旧引用：
   * - 已配置 + 可写 + 独占 → 先弹二次确认，确认后先 unset 旧密钥、成功后才
   *   写配置；unset 失败就中止保存，一条配置都不写；
   * - 没有存储的密钥 → 照常保存；
   * - 共用 / 环境变量提供 / 读不到 → 照常保存但不删旧密钥，toast 说明原因。
   */
  async function saveRouteSettings(form, options = {}) {
    const latestProviders = providersOf(scope.getSnapshot());
    const plan = buildRouteEditOps(routeId, form, latestProviders[routeId], { modalities: modalChoiceValues });
    if (plan.warnings.length > 0) {
      setToast({ tone: "bad", text: plan.warnings[0].message });
      return { ok: false, form };
    }
    if (Object.keys(plan.errors).length > 0) {
      setToast({ tone: "bad", text: "路由设置有字段未通过校验，未生成写入操作" });
      return { ok: false, form };
    }
    if (plan.ops.length === 0) {
      setToast({ tone: "bad", text: "没有字段发生变化；未生成写入操作" });
      return { ok: false, form };
    }

    // 旧引用只在「apiKeyEnv 真的变了、且新旧引用名都非空且不同」时才可能变孤儿；
    // 首次设置 / 清空引用名不算改名，不碰凭据存储。
    const rename = plan.changed.includes("apiKeyEnv")
      ? keyRenameTarget(routeId, latestProviders, form.apiKeyEnv)
      : { oldRef: "", newRef: "", changed: false };
    let renameState = KEY_RENAME_STATE.unchanged;
    let renameSharedBy = [];
    if (rename.changed) {
      // 共用判定复用删除路由那一套（精确相等，不做前缀 / 通配匹配）。
      renameSharedBy = routesSharingKeyRef(routeId, latestProviders, rename.oldRef);
      const probe = await probeCredentialRef(rename.oldRef);
      renameState = keyRenameState({
        ...rename,
        status: probe.status,
        configured: probe.configured,
        writable: probe.writable,
        sharedBy: renameSharedBy,
      });
      if (keyRenameRemovesOldKey(renameState) && options.confirmRename !== true) {
        // 先不写任何东西：确认弹窗说清会删掉哪个旧密钥，确认后才走下面的写入。
        setRenameConfirm({ form, oldRef: rename.oldRef, newRef: rename.newRef });
        setToast(null);
        return { ok: false, form };
      }
    }

    setBusy(true);
    setToast(null);
    let keyRemoved = false;

    /** 保存成功后对旧密钥去留的补充说明（没有改名 / 没有存储的密钥时为空）。 */
    function renameToastSuffix() {
      if (keyRemoved) return `，并删除旧密钥 ${rename.oldRef}`;
      if (renameState === KEY_RENAME_STATE.shared) {
        return `；旧密钥 ${rename.oldRef} 仍被 ${renameSharedBy.join("、")} 使用，已保留`;
      }
      if (renameState === KEY_RENAME_STATE.readonly) {
        return `；旧引用 ${rename.oldRef} 由环境变量提供，无法删除`;
      }
      if (renameState === KEY_RENAME_STATE.unknown) {
        return `；旧引用 ${rename.oldRef} 的状态未能确认，可能仍保留在凭据存储中`;
      }
      return "";
    }

    try {
      if (keyRenameRemovesOldKey(renameState)) {
        // 弹窗打开后旧引用可能已被别处清除 / 改成只读：确认时重新 describe，
        // 读不到就中止，绝不在状态未定时先删密钥。
        const recheck = await probeCredentialRef(rename.oldRef);
        if (recheck.status !== "ready") {
          const message = `无法确认旧密钥 ${rename.oldRef} 的状态：${recheck.error || "未返回原因"}；路由配置未改动`;
          setToast({ tone: "bad", text: message });
          return { ok: false, form };
        }
        if (recheck.configured) {
          const removed = await credentialOps.unset(rename.oldRef);
          if (removed?.ok !== true) {
            const message = `删除旧密钥失败：${credentialErrorMessage(removed, "凭据服务拒绝删除")}；路由配置未改动`;
            setToast({ tone: "bad", text: message });
            return { ok: false, form };
          }
          keyRemoved = true;
        }
      }
      const ok = await scope.mutate(plan.ops);
      if (!ok) {
        // 密钥已经删掉（顺序在前），配置没写成 —— 必须把这件事说清楚。
        setToast({
          tone: "bad",
          text: keyRemoved
            ? `保存被系统拒绝（配置已变化或校验失败）；旧密钥 ${rename.oldRef} 已删除，路由配置未改动，请核对后重试`
            : "保存被系统拒绝（配置已变化或校验失败），已重新读取当前配置，请核对后重试",
        });
        return { ok: false, form };
      }
      const nextForm = routeFormFromProvider(providersOf(scope.getSnapshot())[routeId]);
      setRouteFormState(nextForm);
      setToast({ tone: "good", text: `已保存路由设置 ${routeId}（${plan.ops.length} 条 op）${renameToastSuffix()}` });
      return { ok: true, form: nextForm };
    } catch (error) {
      const message = String(error?.message ?? error);
      setToast({
        tone: "bad",
        text: keyRemoved
          ? `保存异常：${message}；旧密钥 ${rename.oldRef} 已删除，路由配置未改动，请核对后重试`
          : `保存异常：${message}`,
      });
      return { ok: false, form };
    } finally {
      setBusy(false);
    }
  }

  /**
   * 删除整条路由（工单 #26：先删密钥，再删配置）。
   *
   * 1. 用最新快照复核 stale-route 与「至少保留一个路由」，并重算引用名与
   *    共用关系（弹窗打开后快照可能已经变了）；
   * 2. 只有「弹窗里已确认 + 独占 + 可写」这一种状态才动密钥：先 describe
   *    确认仍然存在，再 unset。describe 或 unset 失败都立刻返回，配置一条
   *    都不动 —— 密钥删不掉却删掉配置，只会留下再也看不到的永久孤儿；
   * 3. 其余状态（没有 / 共用 / 环境变量提供 / 读不到）跳过 unset，只删配置；
   * 4. 最后才发唯一的一条 unset ["providers", routeId]。
   *
   * 顺序不能反：引用名是从路由的 apiKeyEnv 派生的，配置先删就不知道删哪个 ref。
   */
  async function deleteRoute() {
    const latestProviders = providersOf(scope.getSnapshot());
    const plan = buildRouteDeleteOps(routeId, latestProviders);
    if (plan.warnings.length > 0) {
      setToast({ tone: "bad", text: plan.warnings[0].message });
      return { ok: false, message: plan.warnings[0].message };
    }
    const target = buildRouteDeleteTarget(routeId, latestProviders);
    const probe = deleteProbe.ref === target.ref
      ? deleteProbe
      : { ref: target.ref, status: "loading", configured: false, writable: true, error: "" };
    const keyState = routeDeleteKeyState({
      ref: target.ref,
      status: probe.status,
      configured: probe.configured,
      writable: probe.writable,
      sharedBy: target.sharedBy,
    });
    setBusy(true);
    setToast(null);
    let keyRemoved = false;
    try {
      if (routeDeleteRemovesKey(keyState)) {
        const described = await credentialOps.describe([target.ref]);
        if (described?.ok !== true) {
          const message = `无法确认密钥 ${target.ref} 的状态：${credentialErrorMessage(described, "未返回原因")}；路由配置未改动`;
          setToast({ tone: "bad", text: message });
          return { ok: false, message };
        }
        if (described.value?.[target.ref]?.configured === true) {
          const removed = await credentialOps.unset(target.ref);
          if (removed?.ok !== true) {
            const message = `删除密钥失败：${credentialErrorMessage(removed, "凭据服务拒绝删除")}；路由配置未改动`;
            setToast({ tone: "bad", text: message });
            return { ok: false, message };
          }
          keyRemoved = true;
        }
      }
      const ok = await scope.mutate(plan.ops);
      if (!ok) {
        // 密钥已经删掉（顺序在前），配置没删成 —— 必须把这件事说清楚，不能让用户
        // 以为路由还完好无损地带着密钥。
        setToast({
          tone: "bad",
          text: keyRemoved
            ? `删除被系统拒绝（配置已变化或校验失败）；密钥 ${target.ref} 已删除，路由配置未改动，请核对后重试`
            : "删除被系统拒绝（配置已变化或校验失败），已重新读取当前配置，请核对后重试",
        });
        return { ok: false, message: "删除被系统拒绝" };
      }
      const remaining = Object.keys(providersOf(scope.getSnapshot()));
      setRouteId(remaining[0] ?? "");
      const kept = target.sharedBy.length > 0 && target.ref !== ""
        ? `；密钥 ${target.ref} 仍被其他路由使用，将保留`
        : "";
      setToast({
        tone: "good",
        text: keyRemoved ? `已删除路由 ${routeId}，并删除密钥 ${target.ref}` : `已删除路由 ${routeId}${kept}`,
      });
      return { ok: true };
    } catch (error) {
      const message = String(error?.message ?? error);
      setToast({
        tone: "bad",
        text: keyRemoved ? `删除异常：${message}；密钥 ${target.ref} 已删除，请核对路由是否仍在` : `删除异常：${message}`,
      });
      return { ok: false, message };
    } finally {
      setBusy(false);
    }
  }

  // ConfigFormController 快照形态（0.2.2）：{status, value, base, user, revision, writable}。
  // 没有 `mode` 字段 —— 命名空间是否可用看 `status`，写权限看 `writable`。
  const status = snap?.status;

  // describe 结果只在 ref 对得上时才算数：刚改完引用名、effect 还没跑的那一帧
  // 必须显示「读取中」，不能把上一条引用的状态贴到新引用上。
  const credentialStatus = credential.ref === credentialReference
    ? credential.status
    : credentialReference === ""
      ? "idle"
      : "loading";
  const credentialUi = {
    ref: credentialReference,
    status: credentialStatus,
    configured: credential.configured,
    writable: credential.writable,
    error: credential.error,
  };

  // 工单 #42：两处模板条共用同一个组件，只是「填入 / 存为新模板 / 管理」的
  // 目标表单不同 —— 编辑表单读编辑表单的当前值，新增表单读新增表单的当前值。
  // 工单 #43 缺陷 5：摘要按各自表单值比较，改过的表单追加「（表单已改动…）」。
  const editFormValues = editForm === null ? null : {
    contextWindow: editForm.contextWindow,
    maxTokens: editForm.maxTokens,
    inputText: editForm.inputText,
    inputImage: editForm.inputImage,
    reasoningLevels: editForm.reasoningLevels,
  };
  const templatePickerBase = {
    value: templateSelectionValue(selectedTemplate),
    library: templateLibrary,
    onSelect: changeTemplateChoice,
  };
  const createTemplatePicker = {
    ...templatePickerBase,
    ariaLabel: "新增模型模板",
    summary: templateSummaryText(selectedTemplate, createFormValues),
    onFill: fillCreateTemplate,
    onSaveAsNew: () => openTemplateDialog("create"),
    onManage: () => openTemplateManage("create"),
  };
  const editTemplatePicker = {
    ...templatePickerBase,
    ariaLabel: "编辑模型模板",
    summary: templateSummaryText(selectedTemplate, editFormValues),
    onFill: fillEditTemplate,
    onSaveAsNew: () => openTemplateDialog("edit"),
    onManage: () => openTemplateManage("edit"),
  };

  /**
   * 渲染一行模型（工单 #39）：分组视图与平铺视图共用这一份 JSX，调用方只决定
   * 显示名、序号、位置与组头摘要。position 是它在所在容器里的位置（首行不加
   * 上边框）；sharedSummary 是组头已经展示过的摘要，平铺视图没有组头，传 null。
   */
  function renderModelRow(row, position, sharedSummary) {
    const { index, modelKey, model } = row;
    const rowSummary = row.summary;
    const rowKey = `${modelKey}:${index}`;
    const compact = modelDensity === DENSITY_COMPACT;
    const hovered = hoveredRow === rowKey;
    const dragging = dragState !== null && dragState.from === index;
    const rowStyle = {
      ...s.modelRow,
      ...(compact ? s.modelRowCompact : null),
      ...(position === 0 ? s.modelRowFirst : null),
      ...(hovered ? s.modelRowHover : null),
      ...(dragging ? s.modelRowDragging : null),
    };
    // 工单 #31：紧凑与详细共用同一组操作按钮；紧凑时放在标题行，
    // 详细时放在摘要行，避免紧凑模式多占一行。
    const actions = (
      <span style={s.modelRowActions}>
        <button
          type="button"
          // 工单 #27：摘要单行省略时按钮保持原宽，窄容器下不把「编辑」挤成两行。
          style={{ ...s.btnSmall, flexShrink: 0 }}
          onClick={() => openEditor(index)}
          aria-label={`编辑模型 ${modelKey}`}
        >
          编辑
        </button>
        <button
          type="button"
          style={busy || !writable
            ? { ...s.btnSmall, flexShrink: 0, ...s.btnDisabled }
            : { ...s.btnSmall, flexShrink: 0 }}
          disabled={busy || !writable}
          onClick={() => requestRowDelete(index, model)}
          aria-label={`删除模型 ${modelKey}`}
          title="删除模型（需要二次确认）"
        >
          删除
        </button>
      </span>
    );
    return (
      // 工单 #34：div 映射到 ARIA generic 角色，ARIA 1.2 禁止
      // 它拥有可访问名；摘要不再挂行级 aria-label，而是由行内
      // 的 sr-only 节点（紧凑）/ 可见摘要（详细）提供。
      <div
        key={rowKey}
        data-model-key={modelKey}
        style={rowStyle}
        onMouseEnter={() => setHoveredRow(rowKey)}
        onMouseLeave={() => setHoveredRow((current) => (current === rowKey ? null : current))}
        onDragOver={(event) => updateModelDragOver(event, index)}
        onDrop={(event) => handleModelDrop(event, index)}
      >
        {dragState !== null && dragState.over === index ? (
          <div
            title="插入位置"
            aria-hidden="true"
            style={dragState.edge === "after"
              ? { ...s.dropLine, ...s.dropLineAfter }
              : { ...s.dropLine, ...s.dropLineBefore }}
          />
        ) : null}
        <div style={compact ? { ...s.modelRowHead, ...s.modelRowHeadCompact } : s.modelRowHead}>
          <input
            type="checkbox"
            style={s.modelCheckbox}
            checked={modelSelected.has(index)}
            disabled={busy || !writable}
            onChange={() => toggleModelSelected(index)}
            aria-label={`选择模型 ${modelKey}`}
          />
          <button
            type="button"
            id={`modelpilot-model-handle-${index}`}
            draggable={canReorderModels}
            disabled={!canReorderModels}
            style={canReorderModels ? s.modelHandle : { ...s.modelHandle, ...s.modelHandleDisabled }}
            aria-label={`拖动排序 第 ${row.ordinal} 位`}
            title={canReorderModels
              ? modelView === VIEW_FLAT
                ? "拖动排序；聚焦后可用 ↑ / ↓ / Home / End 移动"
                : "拖动排序；聚焦后可用 ↑ / ↓ / Home / End 在本组内移动"
              : modelQuery.trim() !== ""
                ? "筛选状态下不可排序；清空搜索后才能拖动"
                : routeModels.length <= 1
                  ? "只有一个模型，无法排序"
                  : "当前不可排序（配置只读或正在写入）"}
            onDragStart={(event) => beginModelDrag(event, index)}
            onDragEnd={endModelDrag}
            onKeyDown={(event) => handleModelHandleKey(event, index)}
          >
            ⠿
          </button>
          <span style={s.modelIndex}>{row.ordinal}</span>
          <span
            id={`modelpilot-model-name-${index}`}
            style={compact ? { ...s.modelName, ...s.modelNameCompact } : s.modelName}
            {...(compact ? { title: `${modelKey}\n${rowSummary.title}` } : {})}
          >
            {row.shortId}
          </span>
          {compact ? (
            // 视觉隐藏、读屏可读；鼠标用户仍看短 ID 的 title。
            <span style={s.srOnly} data-modelpilot-sr-summary="">{rowSummary.text}</span>
          ) : null}
          {compact ? actions : null}
        </div>
        {compact ? null : (
          <div style={s.modelRowMeta}>
            {sharedSummary === null ? (
              <span style={s.modelSummary} title={rowSummary.title}>{rowSummary.text}</span>
            ) : null}
            {actions}
          </div>
        )}
        {editingIndex === index && editForm !== null ? (
          <EditModelForm
            model={model}
            modelId={editModelId}
            form={editForm}
            templatePicker={editTemplatePicker}
            errors={editErrors}
            formError={editFormError}
            projection={editProjection}
            changed={editDiff}
            canSave={editCanSave}
            busy={busy}
            writable={writable}
            guard={editGuard}
            onChange={updateEditForm}
            onTokenChange={changeEditToken}
            onToggleLevel={toggleEditLevel}
            onApiValueChange={changeEditApiValue}
            onSave={saveEdit}
            onCancel={closeEditor}
            onDelete={requestDelete}
            closeTokenPanels={pickerOpen}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div>
        <h2 style={s.h}>
          ModelPilot · 模型配置助手
          <Tip text={"输入模型 ID 后，按用户档案 → 目录 → 模板 → 预设合成字段。\n只写入改动过的字段，冲突时自动重读配置。"} />
        </h2>
        {status === "unavailable" ? <p style={s.sub}>当前配置档案未提供该命名空间。</p> : null}
      </div>

      {!writable ? <div style={s.warn}>当前配置不可写，仅只读预览；请检查是否处于只读连接或内存模式。</div> : null}
      {status === "loading" ? <div style={s.sub}>正在读取 DSH 配置…</div> : null}
      {status === "ready" && routes.length === 0 ? (
        <div style={s.warn}>
          <div>当前没有配置模型路由。</div>
          <div>先点右上角「+ 新建路由」：从目录里选一个提供商，或选「自定义」填中转站地址。</div>
          <div>第一次用可以先用「基础对话」预设，它会填好上下文窗口与输出上限。</div>
        </div>
      ) : null}

      <RouteOverviewCard
        rows={overviewRows}
        overview={overview}
        routeId={routeId}
        open={overviewOpen}
        hovered={overviewHover}
        onToggle={toggleOverview}
        onHover={setOverviewHover}
        onSwitch={selectRoute}
        onRetry={retryOverview}
      />

      <section style={s.sectionCard} aria-label="当前路由">
        <div style={s.sectionTitle}>当前路由</div>
        <div style={s.row}>
          <div style={{ ...s.field, minWidth: 220 }}>
            <span style={s.label}>路由 (provider)</span>
            <div style={s.routePickerRow}>
              <select
                style={{ ...s.select, flex: "1 1 auto", width: 0 }}
                value={routeId}
                onChange={(e) => selectRoute(e.target.value)}
              >
                {routes.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button
                type="button"
                style={writable
                  ? s.newRouteButton
                  : { ...s.newRouteButton, ...s.newRouteButtonDisabled }}
                disabled={!writable}
                onClick={openCreateRoute}
                aria-label="新建路由"
                title={writable ? "从内置目录新建一条路由，或自定义" : "当前配置不可写，无法创建路由"}
              >
                + 新建路由
              </button>
            </div>
            <div style={s.hintLine} />
          </div>
          <Field label="模型 ID" hint="输入后可在下方预览；ID 会原样写入" style={{ flex: "0 1 190px" }}>
            <div style={s.comboBox}>
              <input
                id="modelpilot-model-id"
                style={{ ...s.input, flex: "1 1 0", width: 0 }}
                value={modelId}
                onChange={(e) => {
                  const next = e.target.value;
                  setModelId(next);
                  if (!displayNameTouched.current) setDisplayName(displayNameFromModelId(next));
                }}
                placeholder="如 tflow/alpha-32b"
                list={remoteModels.length > 0 ? "modelpilot-remote-models" : undefined}
              />
              <button
                type="button"
                style={fetchState === "loading" ? { ...s.comboToggle, opacity: 0.55, cursor: "not-allowed" } : s.comboToggle}
                disabled={fetchState === "loading"}
                onClick={fetchModels}
                title="从当前路由的端点拉取模型列表"
              >
                {fetchState === "loading" ? "…" : "拉取"}
              </button>
            </div>
            {remoteModels.length > 0 ? (
              <datalist id="modelpilot-remote-models">
                {remoteModels.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
            ) : null}
          </Field>
          <Field label="显示名（可选）" hint="">
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

      {routeId !== "" ? (
        <RouteSettingsCard
          routeId={routeId}
          provider={route}
          routeCount={routes.length}
          apiChoices={apiChoices}
          modalChoices={modalChoices}
          writable={writable}
          busy={busy}
          open={routeCardOpen}
          form={routeFormState}
          confirmOpen={routeConfirmOpen}
          renameConfirm={renameConfirm}
          usageOpen={routeDefaultUsageOpen}
          deletePlan={deletePlan}
          credential={{
            ...credentialUi,
            editorOpen: credentialEditorOpen,
            draft: credentialDraft,
            busy: credentialBusy,
            opError: credentialError,
            confirmOpen: credentialConfirmOpen,
          }}
          connectionTest={connectionTest}
          onChange={updateRouteForm}
          onToggleOpen={toggleRouteCard}
          onOpenConfirm={() => setRouteConfirmOpen(true)}
          onCloseConfirm={() => setRouteConfirmOpen(false)}
          onSave={saveRouteSettings}
          onDelete={confirmDeleteRoute}
          onCancelRename={() => setRenameConfirm(null)}
          onConfirmRename={confirmKeyRename}
          onToggleUsage={toggleRouteDefaultUsage}
          onTestConnection={testConnection}
          onCredentialDraftChange={changeCredentialDraft}
          onOpenCredentialEditor={openCredentialEditor}
          onCancelCredentialEditor={cancelCredentialEditor}
          onSaveCredential={saveCredential}
          onOpenCredentialConfirm={() => setCredentialConfirmOpen(true)}
          onCloseCredentialConfirm={() => setCredentialConfirmOpen(false)}
          onClearCredential={clearCredential}
          onUseCredentialSuggestion={useCredentialSuggestion}
        />
      ) : null}
      </section>

      <section style={s.modelsPanel} aria-label="该路由的模型列表">
        <div style={s.pendingHeader}>
          <span style={s.sectionTitle}>该路由的模型（{routeModels.length} 条）</span>
          <div style={s.modelHeaderActions}>
            <input
              id="modelpilot-model-search"
              type="text"
              style={s.modelSearch}
              value={modelQuery}
              onChange={(event) => setModelQuery(event.target.value)}
              placeholder="搜索模型 ID…"
              aria-label="搜索模型列表"
            />
            <button type="button" style={s.btnSmall} onClick={focusCreateForm} aria-label="新增模型">
              + 新增
            </button>
            {/* 工单 #39：平铺 / 分组开关放在密度开关左边，形态与密度一致。 */}
            <div style={s.segmented} role="group" aria-label="列表视图">
              <button
                type="button"
                style={{ ...s.segmentedButton, ...(modelView === VIEW_FLAT ? s.toggleOn : s.toggleOff) }}
                aria-pressed={modelView === VIEW_FLAT}
                aria-label="平铺视图"
                title="平铺：可自由拖动排序"
                onClick={() => changeModelView(VIEW_FLAT)}
              >
                <ToggleMark on={modelView === VIEW_FLAT} />
                平铺
              </button>
              <button
                type="button"
                style={{ ...s.segmentedButton, ...(modelView === VIEW_GROUPED ? s.toggleOn : s.toggleOff) }}
                aria-pressed={modelView === VIEW_GROUPED}
                aria-label="分组视图"
                title="分组：按 id 前缀折叠，组内排序"
                onClick={() => changeModelView(VIEW_GROUPED)}
              >
                <ToggleMark on={modelView === VIEW_GROUPED} />
                分组
              </button>
            </div>
            <div style={s.segmented} role="group" aria-label="列表密度">
              <button
                type="button"
                style={{ ...s.segmentedButton, ...(modelDensity === DENSITY_DETAILED ? s.toggleOn : s.toggleOff) }}
                aria-pressed={modelDensity === DENSITY_DETAILED}
                aria-label="详细视图"
                title="显示每条模型的完整摘要"
                onClick={() => changeModelDensity(DENSITY_DETAILED)}
              >
                <ToggleMark on={modelDensity === DENSITY_DETAILED} />
                详细
              </button>
              <button
                type="button"
                style={{ ...s.segmentedButton, ...(modelDensity === DENSITY_COMPACT ? s.toggleOn : s.toggleOff) }}
                aria-pressed={modelDensity === DENSITY_COMPACT}
                aria-label="紧凑视图"
                title="只显示短 ID，摘要移到悬停提示"
                onClick={() => changeModelDensity(DENSITY_COMPACT)}
              >
                <ToggleMark on={modelDensity === DENSITY_COMPACT} />
                紧凑
              </button>
            </div>
          </div>
        </div>
        {routeModels.length > 0 ? (
          <div style={s.bulkBar} role="group" aria-label="模型批量操作">
            <label style={s.bulkLabel}>
              <input
                ref={selectAllRef}
                type="checkbox"
                data-modelpilot-select-all=""
                checked={selectAllState.all}
                disabled={busy || !writable || visibleModelIndexes.length === 0}
                onChange={(event) => selectAllVisible(event.target.checked)}
                aria-label={selectAllState.label}
              />
              全选
            </label>
            <span style={s.bulkCount}>已选 {modelSelected.size} 条</span>
            {bulkSelectionSummary.hiddenCount > 0 ? (
              <>
                <span style={s.bulkCount} data-modelpilot-hidden-selection="">
                  其中 {bulkSelectionSummary.hiddenCount} 条未显示（折叠分组或搜索过滤）
                </span>
                <button
                  type="button"
                  style={busy || !writable ? { ...s.btnLink, ...s.btnDisabled } : s.btnLink}
                  disabled={busy || !writable}
                  onClick={clearHiddenModelSelection}
                  aria-label="取消这些选择"
                >
                  取消这些选择
                </button>
              </>
            ) : null}
            {bulkDeleteBlocked ? <span style={s.bulkCount}>不能删除全部模型；至少保留一条模型</span> : null}
            <div style={s.bulkActions}>
              <button
                type="button"
                style={busy || !writable || modelSelected.size === 0
                  ? { ...s.btnSmall, ...s.btnDisabled }
                  : s.btnSmall}
                disabled={busy || !writable || modelSelected.size === 0}
                onClick={openBulkFields}
                aria-label="批量改字段"
              >
                批量改字段
              </button>
              <button
                type="button"
                style={busy || !writable || modelSelected.size === 0 || bulkDeleteBlocked
                  ? { ...s.btnSmall, ...s.btnDisabled }
                  : s.btnSmall}
                disabled={busy || !writable || modelSelected.size === 0 || bulkDeleteBlocked}
                onClick={requestBulkDelete}
                aria-label="批量删除"
                title={bulkDeleteBlocked ? "不能删除全部模型；至少保留一条模型" : "删除选中的模型"}
              >
                批量删除
              </button>
              <button
                type="button"
                style={busy || modelSelected.size === 0 ? { ...s.btnSmall, ...s.btnDisabled } : s.btnSmall}
                disabled={busy || modelSelected.size === 0}
                onClick={clearModelSelection}
                aria-label="取消选择"
              >
                取消选择
              </button>
            </div>
          </div>
        ) : null}
        {bulkForm !== null && modelSelected.size > 0 ? (
          <div style={s.bulkEditor} role="group" aria-label="批量修改字段">
            <div style={s.bulkHint}>
              给选中的 {modelSelected.size} 条模型设置同一组字段值；未勾选的字段保持不变。
            </div>
            <div style={s.bulkFieldRow}>
              <label style={s.bulkFieldLabel}>
                <input
                  type="checkbox"
                  checked={bulkForm.maxTokensOn}
                  disabled={busy || !writable}
                  onChange={(event) => updateBulkForm({ maxTokensOn: event.target.checked })}
                  aria-label="批量设置输出上限"
                />
                输出上限 (maxTokens)
              </label>
              <input
                type="text"
                inputMode="numeric"
                style={s.bulkTokenInput}
                value={bulkForm.maxTokens}
                disabled={busy || !bulkForm.maxTokensOn}
                onChange={(event) => updateBulkForm({ maxTokens: event.target.value })}
                placeholder="如 8192"
                aria-label="批量输出上限"
              />
            </div>
            <div style={s.bulkFieldRow}>
              <label style={s.bulkFieldLabel}>
                <input
                  type="checkbox"
                  checked={bulkForm.inputOn}
                  disabled={busy || !writable}
                  onChange={(event) => updateBulkForm({ inputOn: event.target.checked })}
                  aria-label="批量设置输入模态"
                />
                输入模态 (input)
              </label>
              <span style={s.bulkLevels}>
                {MODALITIES.map((modality) => {
                  const key = modality === "text" ? "inputText" : "inputImage";
                  const on = bulkForm[key] === true;
                  const disabled = busy || !bulkForm.inputOn;
                  return (
                    <button
                      key={modality}
                      type="button"
                      style={disabled
                        ? { ...s.chip, ...s.toggleOff, ...s.toggleDisabled }
                        : { ...s.chip, ...(on ? s.toggleOn : s.toggleOff) }}
                      disabled={disabled}
                      aria-label={`批量输入模态 ${modality}`}
                      aria-pressed={on}
                      onClick={() => updateBulkForm({ [key]: !on })}
                    >
                      <ToggleMark on={!disabled && on} />
                      {modality}
                    </button>
                  );
                })}
              </span>
            </div>
            <div style={s.bulkFieldRow}>
              <label style={s.bulkFieldLabel}>
                <input
                  type="checkbox"
                  checked={bulkForm.levelsOn}
                  disabled={busy || !writable}
                  onChange={(event) => updateBulkForm({ levelsOn: event.target.checked })}
                  aria-label="批量设置推理档位"
                />
                推理档位 (reasoningEfforts)
              </label>
              <span style={s.bulkLevels}>
                {PI_AI_LEVELS.map((level) => {
                  const on = bulkForm.levels.includes(level);
                  const disabled = busy || !bulkForm.levelsOn;
                  return (
                    <button
                      key={level}
                      type="button"
                      style={disabled
                        ? { ...s.chip, ...s.toggleOff, ...s.toggleDisabled }
                        : { ...s.chip, ...(on ? s.toggleOn : s.toggleOff) }}
                      disabled={disabled}
                      aria-label={`批量推理档位 ${level}`}
                      aria-pressed={on}
                      onClick={() => toggleBulkLevel(level)}
                    >
                      <ToggleMark on={!disabled && on} />
                      {level}
                    </button>
                  );
                })}
              </span>
            </div>
            {bulkError !== "" ? (
              <div style={s.bulkError}>{bulkError}</div>
            ) : bulkLivePlan !== null && bulkLivePlan.status !== "ok" ? (
              <div style={s.bulkHint}>{bulkLivePlan.message}</div>
            ) : null}
            <div style={s.bulkFooter}>
              <span style={s.bulkHint}>
                将写入 {bulkLivePlan?.status === "ok" ? bulkLivePlan.changed.length : 0} 条模型；应用后清空选择
              </span>
              <span style={{ display: "flex", gap: GAP.sm }}>
                <button
                  type="button"
                  style={bulkCanApply ? s.btnSmall : { ...s.btnSmall, ...s.btnDisabled }}
                  disabled={!bulkCanApply}
                  onClick={applyBulkFields}
                  aria-label="应用批量修改"
                >
                  应用修改
                </button>
                <button
                  type="button"
                  style={s.btnSmall}
                  disabled={busy}
                  onClick={() => {
                    setBulkForm(null);
                    setBulkError("");
                  }}
                  aria-label="收起批量修改"
                >
                  取消
                </button>
              </span>
            </div>
          </div>
        ) : null}
        {routeModels.length === 0 ? (
          <div style={s.modelEmpty}>
            <span>该路由没有模型。可在下方新增，或从端点拉取后批量添加。</span>
            <button type="button" style={s.btnSmall} onClick={focusCreateForm} aria-label="新增模型（空列表）">
              + 新增
            </button>
          </div>
        ) : matchingModelCount === 0 ? (
          <div style={s.modelEmpty} aria-label="没有匹配的模型">
            <span>没有匹配的模型。换个关键词，或清空搜索查看全部。</span>
            <button type="button" style={s.btnSmall} onClick={() => setModelQuery("")} aria-label="清空搜索（无匹配）">
              清空搜索
            </button>
          </div>
        ) : modelView === VIEW_FLAT ? (
          // 工单 #39：平铺视图没有组头，行按 models 数组顺序逐条渲染；
          // 行仍是同一个 renderModelRow，序号就是数组下标 + 1。
          <div style={s.modelGroups}>
            {flatModelRows.map((row, position) => renderModelRow(row, position, null))}
          </div>
        ) : (
          <div style={s.modelGroups}>
            {modelGroupsVisible.map((group) => {
              const searching = modelQuery.trim() !== "";
              const countText = groupCountText(group.rows.length, group.matchingRows.length, searching);
              return (
                <div key={group.key} style={s.modelGroup} data-model-group={group.key}>
                  <div style={s.modelGroupHeader}>
                    <button
                      type="button"
                      style={s.modelGroupToggle}
                      onClick={() => toggleModelGroup(group.key)}
                      aria-expanded={group.expanded}
                      aria-label={`模型分组 ${group.key}（${countText} 条）`}
                      title={group.expanded ? "折叠分组" : "展开分组"}
                    >
                      <span aria-hidden="true" style={s.modelGroupCaret}>{group.expanded ? "▼" : "▶"}</span>
                      <span style={s.modelGroupName}>{group.key}</span>
                      <span style={s.modelGroupCount}>({countText})</span>
                    </button>
                    {group.sharedSummary !== null ? (
                      <span style={s.modelGroupSummary}>{group.sharedSummary}</span>
                    ) : null}
                  </div>
                  {group.expanded ? (
                    <div style={s.modelGroupRows}>
                      {group.matchingRows.map((row, position) => (
                        renderModelRow(row, position, group.sharedSummary)
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {modelQuery.trim() !== "" && routeModels.length > 0 ? (
          <div style={s.modelFilterFooter}>
            <span style={s.modelFilterCount}>
              显示 {visibleModelIndexes.length} / {routeModels.length} 条
            </span>
            <button type="button" style={s.btnLink} onClick={() => setModelQuery("")} aria-label="清空搜索">
              清空搜索
            </button>
          </div>
        ) : null}
      </section>

      {fetchState === "failed" ? <div style={s.err}>拉取失败：{fetchError}</div> : null}
      {fetchState === "done" ? (
        <div style={s.row}>
          <button type="button" style={s.btnSmall} onClick={openPicker}>
            已拉取 {remoteModels.length} 个 · 选择
          </button>
        </div>
      ) : null}

      <section style={s.formCard} aria-label="新增模型">
        <div style={s.sectionTitle}>新增模型</div>
        {/*
          工单 #40：首次打开就能看到三个内置预设。点 chip 只填表单，不写配置；
          chip 的高亮来自 detectPreset —— 用户改过任何一个字段就全部取消高亮。
        */}
        <div style={s.templateBar} role="group" aria-label="模型预设">
          {MODEL_PRESETS.map((preset) => {
            const active = detectedPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                style={{ ...s.chip, ...(active ? s.toggleOn : s.toggleOff), cursor: "pointer", fontFamily: "inherit" }}
                aria-pressed={active}
                aria-label={`预设 ${preset.label}`}
                title={preset.hint}
                onClick={() => applyModelPreset(preset)}
              >
                <ToggleMark on={active} />
                {preset.label}
              </button>
            );
          })}
        </div>
        {/*
          工单 #42：模板条从「一个按钮」升级成选择器 —— 用户模板 + 内置预设
          （只读）同在一个下拉里，选中哪一份，「填入」就填哪一份的值。
        */}
        <TemplatePicker {...createTemplatePicker} />
        <div style={s.row}>
          <TokenCountField
            label="上下文窗口 (contextWindow)"
            hint="留空 = 不写该字段，由运行时决定"
            value={contextWindow}
            candidates={CONTEXT_WINDOW_CANDIDATES}
            error={contextWindowError}
            placeholder="如 131072"
            ariaLabel="上下文窗口"
            closeSignal={pickerOpen}
            onChange={(e) => changeTokenCount(e, contextWindow, setContextWindow, setContextWindowError)}
          />
          <TokenCountField
            label="输出上限 (maxTokens)"
            hint="同时限制单次输出，并从上下文窗口预留；填得越大能装的历史越少。"
            value={maxTokens}
            candidates={MAX_TOKENS_CANDIDATES}
            error={maxTokensError}
            placeholder="如 8192"
            ariaLabel="输出上限"
            closeSignal={pickerOpen}
            onChange={(e) => changeTokenCount(e, maxTokens, setMaxTokens, setMaxTokensError)}
          />
          <div style={s.levels}>
            <span style={s.label}>推理档位（多选）<Tip text="全不选 = 不设置推理档位，不会清空已有配置" /></span>
            <div style={s.levelChips}>
              {PI_AI_LEVELS.map((level) => {
                const checked = reasoningLevels.includes(level);
                return (
                  <label key={level} style={checked ? { ...s.levelChip, ...s.toggleOn } : { ...s.levelChip, ...s.toggleOff }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setReasoningLevels((current) => toggleReasoningLevel(current, level))}
                    />
                    <ToggleMark on={checked} />
                    {level}
                  </label>
                );
              })}
            </div>
            <div style={s.levelChips}>
              <button type="button" style={s.btnLink} onClick={() => setReasoningLevels(allReasoningLevels())}>全选</button>
              <button type="button" style={s.btnLink} onClick={() => setReasoningLevels(noReasoningLevels())}>全不选</button>
              <button type="button" style={s.btnLink} onClick={() => setReasoningLevels(defaultReasoningLevels())}>恢复默认</button>
            </div>
            {reasoningGuard ? <div style={s.err}>{reasoningGuard}</div> : null}
            {reasoningLevels.length === 0 ? (
              <span style={s.sub}>全不选：本次不写入推理档位，沿用内置目录的值。</span>
            ) : null}
            <ReasoningApiValues
              levels={reasoningLevels}
              apiValues={reasoningApiValues}
              ariaPrefix="新增"
              onChange={changeReasoningApiValue}
            />
          </div>
        </div>

      <BudgetHint contextWindow={contextWindow} maxTokens={maxTokens} />

      <div style={s.row}>
        <label style={{ ...s.chip, ...(inputText ? s.toggleOn : s.toggleOff), cursor: "pointer" }}>
          <input type="checkbox" checked={inputText} onChange={(e) => setInputText(e.target.checked)} />
          <ToggleMark on={inputText} />
          text
        </label>
        <label style={{ ...s.chip, ...(inputImage ? s.toggleOn : s.toggleOff), cursor: "pointer" }}>
          <input type="checkbox" checked={inputImage} onChange={(e) => setInputImage(e.target.checked)} />
          <ToggleMark on={inputImage} />
          image
        </label>
        <span style={{ ...s.chip, opacity: 0.75 }}>
          该路由现有模型条目 {routeModels.length} · 目录条目 {catalogIds.size}
        </span>
      </div>

      {batchProjection ? (
        <>
          <div style={s.pending}>
            <div style={s.pendingHeader}>
              <span style={s.pendingTitle}>待写入 {batchProjection.written.length} 条模型</span>
              <span style={s.pendingActions}>
                <button
                  type="button"
                  style={busy ? { ...s.btnSmall, opacity: 0.55, cursor: "not-allowed" } : s.btnSmall}
                  disabled={busy}
                  onClick={() => setBatchProjection(null)}
                >
                  清空
                </button>
                <button
                  type="button"
                  style={busy ? { ...s.btn, opacity: 0.55, cursor: "not-allowed" } : s.btnPrimary}
                  disabled={busy}
                  onClick={async () => {
                    const ok = await applyBatchPlan(batchProjection);
                    // 失败时保留区块，让用户核对后重试（mutate 有修订号围栏，重试安全）。
                    if (ok) setBatchProjection(null);
                  }}
                >
                  {busy ? "写入中…" : "写入"}
                </button>
              </span>
            </div>
            <div style={s.pendingList}>
              {batchProjection.ops.map((op) => {
                const row = op.value ?? {};
                return (
                  <div key={`${op.path.join(".")}:${row.id ?? ""}`} style={s.pendingModel}>
                    <span style={s.pendingName}>{row.id ?? "（无 id）"}</span>
                    <span style={s.pendingFields}>{describePendingFields(row).join(" · ")}</span>
                  </div>
                );
              })}
            </div>
            <div style={s.sub}>
              已跳过 {classifyModels(remoteModels, existingModelIds).filter((entry) => entry.status === "exists").length} 条已存在、
              {classifyModels(remoteModels, existingModelIds).filter((entry) => entry.status === "casefold").length} 条仅大小写不同
            </div>
            {batchProjection.warnings.map((w, i) => (
              <div key={`bw${i}`} style={s.warn}>
                <strong>{w.code}</strong>：{w.message}
                {w.removedCatalogIds?.length ? `（将从该路由消失：${w.removedCatalogIds.join("、")}）` : ""}
              </div>
            ))}
          </div>
          <div style={s.label}>批量写入结果（{batchProjection.written.length} 条）</div>
          <div style={s.sub}>
            {batchProjection.ops.map((op) => `${op.path.join(".")} ← ${op.value?.id ?? ""}`).join(" · ")}
          </div>
          <details style={s.details}>
            <summary style={s.summary}>
              配置项（{batchProjection.ops.length} 条）· 点击展开
            </summary>
            <pre style={s.pre}>{JSON.stringify(batchProjection.ops, null, 2)}</pre>
          </details>
        </>
      ) : null}

      {modelId.trim() === "" ? null : (
        <>
          <div style={s.label}>将写入的字段</div>
          <details style={s.details}>
            <summary style={s.summary}>
              配置项（{projection?.settingsOps?.length ?? 0} 条）· 点击展开
            </summary>
            <pre style={s.pre}>{JSON.stringify(projection?.settingsOps ?? [], null, 2)}</pre>
          </details>

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
            <label style={{ ...s.warn, display: "flex", gap: GAP.sm, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="checkbox" checked={ackReplace} onChange={(e) => setAckReplace(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                该路由的模型来自内置目录，写入会<b>整体替换</b>目录，上列
                {gate.removedCatalogIds?.length ?? 0} 个条目将从该路由消失。我确认继续。
              </span>
            </label>
          ) : null}

          {routeModels.some((m) => m?.id === modelId.trim()) ? (
            <div style={s.err}>该路由已有同名模型条目，无法重复写入。</div>
          ) : null}
        </>
      )}

      <div style={s.primaryRow}>
        <button
          style={canApply ? s.btnPrimary : { ...s.btn, opacity: 0.5, cursor: "not-allowed" }}
          disabled={!canApply}
          onClick={apply}
        >
          {busy ? "写入中…" : "写入 DSH 设置"}
        </button>
      </div>
      <div style={s.linkRow}>
        <button
          type="button"
          style={s.btnLink}
          onClick={() => {
            const form = templateToForm(selectedTemplate.values);
            displayNameTouched.current = false;
            setModelId("");
            setDisplayName("");
            setContextWindow(form.contextWindow);
            setMaxTokens(form.maxTokens);
            setContextWindowError(false);
            setMaxTokensError(false);
            setInputText(form.inputText);
            setInputImage(form.inputImage);
            setReasoningLevels(form.reasoningLevels);
            setReasoningApiValues({});
            setAckReplace(false);
            setBatchProjection(null);
            setToast(null);
          }}
        >
          清空
        </button>
      </div>
      </section>

      {/*
        工单 #35：提示容器常驻 DOM（role=status / aria-live=polite，报错用
        role=alert），这样读屏会在文字变化时播报，而不是遇到「新插入的节点」。
        没有提示时视觉隐藏但不移除；成功提示先淡出（opacity transition）再清空，
        报错不自动消失；焦点在容器内时暂停计时。
      */}
      <div
        data-modelpilot-toast={toast === null ? "" : toast.tone}
        role={toastAriaProps.role}
        aria-live={toastAriaProps.live}
        aria-atomic="true"
        tabIndex={toast === null ? -1 : 0}
        onFocus={() => setToastFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setToastFocused(false);
        }}
        style={
          toast === null
            ? s.toastIdle
            : {
                ...(toast.tone === "good" ? s.ok : s.err),
                opacity: toast.hiding === true ? 0 : 1,
                transition: `opacity ${TOAST_FADE_MS}ms ease`,
              }
        }
      >
        {toast === null ? "" : toast.text}
      </div>

      {pickerOpen ? (
        <ModelPicker
          models={remoteModels}
          existing={existingModelIds}
          templateLabel={selectedTemplate.name}
          templateKind={selectedTemplate.kind}
          templateValues={selectedTemplate.values}
          templateFallback={templateLibrary.templates.length === 0 && !templateChoiceExplicit}
          overridesInUse={overridesInUse}
          catalogWarning={catalogWarning}
          busy={busy}
          query={pickerQuery}
          selected={pickerSelected}
          ackReplacement={pickerAckReplace}
          onQueryChange={setPickerQuery}
          onToggle={togglePickerModel}
          onSelectAll={selectAllPicker}
          onAckChange={setPickerAckReplace}
          onConfirm={confirmPicker}
          onCancel={closePicker}
        />
      ) : null}

      {createOpen ? (
        <NewRouteDialog
          mode={createMode}
          catalogStatus={createCatalog.status}
          catalogError={createCatalog.error}
          catalogTotal={createRows.length}
          query={createQuery}
          rows={createVisibleRows}
          selectedId={createProviderId}
          providerId={createProviderId}
          providerIdError={createProviderIdError}
          providerIdHint={createProviderIdHint}
          baseURL={createBaseURL}
          baseURLError={createBaseURLError}
          baseURLHint="必填，以 http:// 或 https:// 开头"
          baseURLNote={createBaseURLNote}
          api={createApi}
          apiChoices={createProtocolChoices}
          apiKeyEnv={createApiKeyEnv}
          modelIds={createModelIds}
          modelsError={createModelsError}
          modelsHint="逗号分隔；创建后可继续补字段"
          catalogKnown={createCatalogKnown}
          catalogProviderName={createCatalogName}
          busy={createBusy}
          error={createError}
          canCreate={createCanSubmit}
          focusRef={createFocusRef}
          onModeChange={changeCreateMode}
          onQueryChange={setCreateQuery}
          onSelectProvider={(provider) => {
            setCreateProviderId(provider);
            setCreateError("");
          }}
          onProviderIdChange={changeCreateProviderId}
          onProviderIdBlur={() => setCreateProviderIdTouched(true)}
          onBaseURLChange={changeCreateBaseURL}
          onBaseURLBlur={() => setCreateBaseURLTouched(true)}
          onApplyBaseURLPreset={applyBaseURLPreset}
          onApiChange={(value) => {
            setCreateApi(value);
            setCreateError("");
          }}
          onApiKeyEnvChange={(value) => {
            setCreateApiKeyEnv(value);
            setCreateError("");
          }}
          onModelIdsChange={(value) => {
            setCreateModelIds(value);
            setCreateError("");
          }}
          onCancel={closeCreateRoute}
          onConfirm={createRoute}
          onRetryCatalog={() => setCreateReload((current) => current + 1)}
        />
      ) : null}

      {templateDialog !== null ? (
        <TemplateNameDialog
          name={templateDialog.name}
          error={templateDialog.error}
          dialogRef={templateDialogRef}
          onTrapTab={trapTemplateDialogTab}
          onChange={changeTemplateDialogName}
          onCancel={closeTemplateDialog}
          onConfirm={saveTemplateDialog}
        />
      ) : null}

      {templateManage !== null ? (
        <TemplateManagePanel
          library={templateLibrary}
          state={templateManage}
          dialogRef={templateManageRef}
          renameInputRef={templateRenameInputRef}
          onTrapTab={trapTemplateManageTab}
          currentSummary={templateFormSummary(templateManage.mode)}
          onClose={closeTemplateManage}
          onBeginRename={beginTemplateRename}
          onRenameChange={changeTemplateRenameName}
          onRenameCommit={commitTemplateRename}
          onRenameCancel={cancelTemplateRename}
          onRequestOverwrite={requestOverwriteTemplate}
          onRequestDelete={requestDeleteTemplate}
          onConfirmOverwrite={confirmOverwriteTemplate}
          onConfirmDelete={confirmDeleteTemplate}
          onCancelConfirm={cancelTemplateConfirm}
        />
      ) : null}

      {deleteTarget ? (
        <DeleteConfirmDialog
          routeId={routeId}
          modelId={deleteTarget.id}
          busy={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}

      {bulkDeleteOpen ? (
        <BulkDeleteConfirmDialog
          routeId={routeId}
          count={bulkSelectionSummary.count}
          ids={bulkSelectionSummary.ids}
          hiddenCount={bulkSelectionSummary.hiddenCount}
          busy={busy}
          onCancel={() => setBulkDeleteOpen(false)}
          onConfirm={confirmBulkDelete}
        />
      ) : null}
    </div>
  );
}

export function apply(ctx) {
  const configForms = ctx.configForms;
  // 在 apply 作用域里绑定宿主操作：组件只拿到回调，不直接持有服务代理。
  const discoverModels = (namespace, request) => ctx.remote.llm.discoverModels(namespace, request);
  // 密钥走独立命名空间：值只从密码框单向传入宿主，读路径只有 describe 的布尔值。
  const credentialOps = {
    describe: (refs) => ctx.remote.credentials.describe(refs),
    set: (ref, value) => ctx.remote.credentials.set(ref, value),
    unset: (ref) => ctx.remote.credentials.unset(ref),
  };
  // 目录只读消费：宿主列出所有可声明的提供商（含未配置的），客户端不改写它。
  const listConfigurableProviders = () => ctx.remote.llm.listConfigurableProviders();
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
              inject: () => ({ configForms, discoverModels, credentialOps, listConfigurableProviders }),
            },
            Workbench,
          ),
        ),
      ),
    "model-assistant: workbench settings page",
  );
}

export default { name, inject, apply };
