// ModelPilot 工作台 —— 最小可用界面（P1-07 MVP）。
//
// 注册一个 settings.section："modelpilot.workbench"。
// 流程：选一条 pi-ai 路由 → 输入模型 id → 检查投影出的行和引擎产出的每一条
// 告警 → 用宿主自己的 configForms.mutate 写入（带修订号围栏、自动恢复）。
//
// 投影引擎由构建步骤从 src/core 内联进来，因此这个界面跑的逻辑与宿主侧测试
// 逐字节相同：R1–R7 推理预检、目录替换门禁、白名单过滤、重复条目守卫。

import * as React from "react";
import { estimateContextBudget } from "../core/context-budget.js";
import { projectPiAi } from "../core/pi-ai-projection.js";
import {
  describeTemplate,
  formToTemplate,
  readDefaultTemplate,
  removeDefaultTemplate,
  templateToForm,
  writeDefaultTemplate,
} from "../core/default-template.js";
import { PI_AI_LEVELS, MODALITIES, displayNameFromModelId, humanizeTokenCount } from "../core/domain.js";
import { describeModelRow, diffRow, formFromModel } from "../core/model-edit.js";
import { classifyModels, filterModels, planBatchSelection } from "../core/model-selection.js";
import {
  CACHE_RETENTION_CHOICES,
  ROUTE_DEFAULT_FIELDS,
  TRANSPORT_CHOICES,
  apiChoicesFromSchema,
  buildRouteDeleteOps,
  buildRouteEditOps,
  countRouteDefaultUsers,
  describeHostDefaultFallback,
  describeRouteDefaultUsage,
  describeRouteSummary,
  moveModel,
  routeDefaultCountParts,
  routeDeleteBlockReason,
  routeFieldLabels,
  routeFormFromProvider,
} from "../core/route-edit.js";
import {
  allReasoningLevels,
  defaultReasoningLevels,
  noReasoningLevels,
  reasoningLevelsGuard,
  reasoningPolicyFor,
  toggleReasoningLevel,
} from "./reasoning-levels.js";

export const name = "model-assistant-client";
export const inject = ["slots", "configForms", "remote", "remote.llm"];

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
    `contextWindow ${valueText(row?.contextWindow)}`,
    `maxTokens ${valueText(row?.maxTokens)}`,
    `input ${input}`,
    `reasoningEfforts ${reasoning}`,
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
  modelName: {
    fontSize: FONT.caption, fontWeight: 600, overflowWrap: "anywhere",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  modelSummary: {
    fontSize: FONT.hint, lineHeight: 1.55, overflowWrap: "anywhere", flex: "1 1 auto",
    color: "var(--dsw-alias-label-tertiary, var(--dsw-alias-label-primary, inherit))",
  },
  modelEmpty: {
    display: "flex", alignItems: "center", gap: GAP.sm, flexWrap: "wrap",
    fontSize: FONT.caption, lineHeight: 1.6,
    color: "var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit))",
  },
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
  // 编辑表单顶部：填入默认模板 + 模板摘要 / 无模板说明。
  templateBar: { display: "flex", alignItems: "center", gap: GAP.sm, flexWrap: "wrap" },
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
    color: "var(--dsw-alias-state-error-primary, #e05252)",
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
  levelChipOn: {
    background: "var(--dsw-alias-button-ghost-active-fill, var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.1)))",
    border: "1px solid var(--dsw-alias-button-ghost-active-border, var(--dsw-alias-state-business-primary, rgba(90,140,230,0.55)))",
    fontWeight: 500,
  },
  chip: {
    display: "inline-flex", alignItems: "center", gap: GAP.xs, padding: "3px 8px",
    borderRadius: RADIUS.sm, fontSize: FONT.hint,
    border: "1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))",
    background: "var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.1))",
    color: "var(--dsw-alias-label-primary, inherit)",
  },
  chipOn: {
    background: "var(--dsw-alias-button-ghost-active-fill, var(--dsw-alias-bg-layer-1, rgba(128,128,128,0.1)))",
    border: "1px solid var(--dsw-alias-button-ghost-active-border, var(--dsw-alias-state-business-primary, rgba(90,140,230,0.55)))",
  },
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
  pickerRowDisabled: { opacity: 0.45, cursor: "not-allowed" },
  pickerId: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  pickerHint: { fontSize: FONT.hint, opacity: 0.65 },
  pickerFooter: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: GAP.sm, flexWrap: "wrap" },
};

function Field({ label, children, hint, error, style }) {
  return (
    <label style={style === undefined ? s.field : { ...s.field, ...style }}>
      <span style={s.label}>{label}</span>
      {children}
      <div style={s.hintLine}>
        {error ? <span style={s.fieldError}>{error}</span> : hint ? <span style={s.fieldHint}>{hint}</span> : null}
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
function TokenCountField({ label, value, candidates, error, placeholder, ariaLabel, closeSignal, onChange }) {
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
      <span style={s.label}>{label}</span>
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
    </label>
  );
}

/**
 * 拉取结果选择器。
 *
 * 勾选集合由父组件持有：改搜索词只影响 visible，不影响 selected ——
 * 因此过滤后勾选状态不丢；关窗时父组件重置集合。
 */
function ModelPicker({
  models,
  existing,
  hasTemplate,
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

        {!hasTemplate ? <div style={s.pickerHint}>未设置默认模板，将使用内置默认值</div> : null}

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
              <b>catalog-replacement</b>：该路由是目录路由，批量写入 models 会<b>整体替换</b>它的模型目录。我确认继续。
            </span>
          </label>
        ) : null}

        {overridesInUse ? (
          <div style={s.err}>
            该路由已在用 <b>modelOverrides</b>；写 models 数组会被宿主拒绝，无法批量写入。请先在宿主中移除 modelOverrides。
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
 * maxTokens 的实时影响提示：按 DSH 默认压缩策略估算可用上下文。
 *
 * 窗口或输出为空 / 非法时不渲染，避免显示 0 或 NaN；两处（新增 / 编辑）
 * 复用同一个 estimateContextBudget。具体数字放在输入框下面，底部还有一段
 * 抽象说明。
 */
function BudgetHint({ contextWindow, maxTokens }) {
  const windowValue = tokenInputOf(contextWindow);
  const outputValue = tokenInputOf(maxTokens);
  if (windowValue === undefined || outputValue === undefined) return null;
  const estimate = estimateContextBudget(windowValue, outputValue);
  if (estimate === null) return null;

  if (estimate.ok) {
    return (
      <div style={s.budget} role="status">
        可用上下文 {formatTokenNumber(estimate.threshold)}（零损失 ✓）
        <div style={s.fieldHint}>按默认压缩策略估算；实际值以宿主运行时为准。</div>
      </div>
    );
  }

  const severe = estimate.loss > 0.1;
  const percent = (estimate.loss * 100).toFixed(1);
  return (
    <div style={severe ? s.budgetWarn : s.budget} role="status">
      {severe ? "⚠ " : ""}可用上下文 {formatTokenNumber(estimate.threshold)}（比最优少 {percent}%）
      {severe && estimate.freeBoundary > 0 ? (
        <div style={s.budgetSuggestion}>建议 ≤ {formatTokenNumber(estimate.freeBoundary)} 可零损失</div>
      ) : null}
      <div style={s.fieldHint}>按默认压缩策略估算；实际值以宿主运行时为准。</div>
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

/**
 * 行内编辑表单。每个字段都预填现有值；保存按钮在改动集为空时禁用。
 * 表单状态由 Workbench 持有，便于把 diffRow 与 projectPiAi(update) 接起来。
 */
function EditModelForm({
  model,
  modelId,
  form,
  template,
  errors,
  projection,
  changed,
  canSave,
  busy,
  writable,
  guard,
  onChange,
  onTokenChange,
  onToggleLevel,
  onFillTemplate,
  onSave,
  onCancel,
  onDelete,
  closeTokenPanels,
}) {
  const changedFields = Object.keys(changed);
  const hasCompat = hasMeaningfulCompat(model?.compat);
  const stale = (projection?.warnings ?? []).find((warning) => warning.code === "stale-index");
  const unsupported = projection?.unsupportedControls ?? [];

  return (
    <div style={s.modelEditor} aria-label={`编辑表单 ${modelId}`}>
      <div style={s.templateBar}>
        <button
          type="button"
          style={template === null ? { ...s.btnSmall, opacity: 0.55, cursor: "not-allowed" } : s.btnSmall}
          disabled={template === null}
          onClick={onFillTemplate}
          aria-label="填入默认模板"
        >
          填入默认模板
        </button>
        <span style={s.fieldHint}>
          {template === null
            ? "尚未设置默认模板，先在新增表单里「存为默认模板」"
            : `默认模板：${describeTemplate(template, humanizeTokenCount)}`}
        </span>
      </div>

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
          value={form.contextWindow}
          candidates={CONTEXT_WINDOW_CANDIDATES}
          error={errors.contextWindow}
          placeholder="如 131072"
          ariaLabel="编辑上下文窗口"
          closeSignal={closeTokenPanels}
          onChange={(event) => onTokenChange(event, "contextWindow")}
        />
        <TokenCountField
          label="输出上限 (maxTokens)"
          value={form.maxTokens}
          candidates={MAX_TOKENS_CANDIDATES}
          error={errors.maxTokens}
          placeholder="如 8192"
          ariaLabel="编辑输出上限"
          closeSignal={closeTokenPanels}
          onChange={(event) => onTokenChange(event, "maxTokens")}
        />
        <div style={s.levels}>
          <span style={s.label}>推理档位（多选）</span>
          <div style={s.levelChips}>
            {PI_AI_LEVELS.map((level) => {
              const checked = form.reasoningLevels.includes(level);
              return (
                <label key={level} style={checked ? { ...s.levelChip, ...s.levelChipOn } : s.levelChip}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleLevel(level)}
                    aria-label={`编辑档位 ${level}`}
                  />
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
            <span style={s.sub}>全不选：不修改现有 reasoningEfforts（一期只支持修改档位，不清空字段）。</span>
          ) : null}
        </div>
      </div>

      <BudgetHint contextWindow={form.contextWindow} maxTokens={form.maxTokens} />

      <div style={s.row}>
        <label style={form.inputText ? { ...s.chip, ...s.chipOn, cursor: "pointer" } : { ...s.chip, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={form.inputText}
            onChange={(event) => onChange({ inputText: event.target.checked })}
            aria-label="编辑输入模态 text"
          /> text
        </label>
        <label style={form.inputImage ? { ...s.chip, ...s.chipOn, cursor: "pointer" } : { ...s.chip, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={form.inputImage}
            onChange={(event) => onChange({ inputImage: event.target.checked })}
            aria-label="编辑输入模态 image"
          /> image
        </label>
      </div>

      {hasCompat ? (
        <div style={s.compatibility}>ⓘ 该模型还声明了 compat 字段，保存时会原样保留。</div>
      ) : null}

      {!writable ? <div style={s.warn}>当前配置不可写（writable: false），保存已禁用。</div> : null}

      {stale ? <div style={s.err}>{stale.message} 请取消编辑后重新打开。</div> : null}
      {unsupported.filter((item) => item.reason !== "stale-index").map((item, index) => (
        <div key={`eu${index}`} style={s.err}>
          不可写：<strong>{item.control}</strong> — {item.reason}
          {item.message ? `（${item.message}）` : ""}
        </div>
      ))}

      <div style={s.sub}>
        改动字段：{changedFields.length === 0 ? "无（保存已禁用）" : changedFields.map((field) => EDIT_FIELD_LABELS[field] ?? field).join(" / ")}
      </div>

      <details style={s.details}>
        <summary style={s.summary}>
          保存将写入的 settingsOps（{projection?.settingsOps?.length ?? 0} 条）· 点击展开
        </summary>
        <pre style={s.pre}>{JSON.stringify(projection?.settingsOps ?? [], null, 2)}</pre>
      </details>

      <div style={s.editorFooter}>
        <span style={s.sub}>写入走宿主 configForms（修订号围栏 + 冲突自动重读）。</span>
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
          >
            {busy ? "保存中…" : "保存修改"}
          </button>
        </span>
      </div>
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
          <span style={s.h}>{title}</span>
          <span style={s.pickerHint}>{badge}</span>
        </div>
        {children}
        <div style={s.pickerFooter}>
          <span style={s.pickerHint}>{footerHint}</span>
          <span style={{ display: "flex", gap: GAP.sm }}>
            <button ref={cancelRef} type="button" style={s.btn} onClick={onCancel} aria-label={cancelAria}>取消</button>
            <button
              type="button"
              style={busy ? { ...s.btnDanger, opacity: 0.55, cursor: "not-allowed" } : s.btnDanger}
              disabled={busy}
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
      title="删除模型"
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
        删除会用一条 set 重写该路由的 models 数组（长度减一），不会在数组里留下空洞；此操作无法撤销。
      </p>
    </ConfirmDialog>
  );
}

/** 删除整条路由的二次确认：写明模型条数与不可撤销。 */
function DeleteRouteDialog({ routeId, modelCount, busy, onCancel, onConfirm }) {
  return (
    <ConfirmDialog
      ariaLabel="删除路由确认"
      title="删除路由"
      badge="二次确认"
      cancelAria="取消删除路由"
      confirmAria="确认删除路由"
      confirmLabel="删除路由"
      busyLabel="删除中…"
      footerHint="删除后不会影响其它路由。"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p style={s.sub}>
        确定要删除路由 <b>{routeId}</b> 吗？
      </p>
      <p style={s.sub}>
        该路由下有 <b>{modelCount}</b> 个模型，删除后连同模型配置一起消失。这一步不能撤销。
      </p>
    </ConfirmDialog>
  );
}

/**
 * 路由（provider）级字段编辑卡片。
 *
 * 默认折叠；展开后可编辑九个路由级字段。写入只产出叶子 set / unset，
 * 绝不重建整条路由；删除路由是唯一允许的整条 unset，并且带 stale-route
 * 与「至少要保留一个路由」两道守卫。
 */
function RouteSettingsCard({
  routeId,
  provider,
  routeCount,
  apiChoices,
  writable,
  busy,
  open,
  form,
  confirmOpen,
  usageOpen,
  onChange,
  onToggleOpen,
  onOpenConfirm,
  onCloseConfirm,
  onSave,
  onDelete,
  onToggleUsage,
}) {
  if (form === null) return null;

  const plan = buildRouteEditOps(routeId, form, provider);
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

  // 路由默认值影响谁：按字段分别算，两个字段的受影响集合可能不同。
  // 宿主没有把「已安装目录描述了哪些模型 id」交给设置客户端，而 Workbench 的
  // catalogIds 是「路由当前对外提供的模型 id」（目录替换闸门用），把它当内置
  // 目录会把每条模型都误判成「目录已给值」。因此这里不传 catalogIds：对
  // ModelPilot 管理的自定义路由，内置目录确实为空；目录路由本身没有可枚举的
  // models，计数行不显示。纯函数仍保留 catalogIds 入参，接上目录事实即可用。
  const defaultUsage = countRouteDefaultUsers(routeModels);
  const defaultRows = ROUTE_DEFAULT_FIELDS.map((field) => {
    const raw = typeof form[field.key] === "string" ? form[field.key].trim() : "";
    const usage = defaultUsage[field.modelField];
    const blank = raw === "";
    const valid = raw !== "" && isPositiveTokenCount(raw);
    return {
      ...field,
      blank,
      count: usage.count,
      models: usage.models,
      parts: blank || !valid ? null : routeDefaultCountParts(field.key, defaultUsage.total, usage.count),
      expanded: usageOpen?.[field.modelField] === true,
    };
  });

  function update(field, value) {
    onChange({ [field]: value });
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
      </button>

      {open ? (
      <div style={s.routeBody}>
        <span style={s.sub}>
          编辑路由 <b>{routeId}</b> 的字段：只写改过的叶子路径，models / compat 与宿主未来字段原样保留。
        </span>

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
          <Field label="接口地址 (baseURL)" error={errors.baseURL} hint="必须以 http:// 或 https:// 开头">
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
            hint={apiChoicesSource === "schema" ? "选项来自宿主 schema" : "使用内置协议清单"}
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
          <Field label="密钥引用 (apiKeyEnv)" hint="只改引用名">
            <input
              style={s.input}
              value={form.apiKeyEnv}
              onChange={(event) => update("apiKeyEnv", event.target.value)}
              placeholder="如 PREVIEW_CHAT_API_KEY"
              aria-label="路由密钥引用"
            />
          </Field>
        </div>

        <span style={s.sub}>ⓘ 只改引用名，密钥值在第二批管理；这里不读取也不写入任何密钥内容。</span>

        {apiChoicesSource === "fallback" ? (
          <div style={s.warn} role="status" aria-label="协议清单来源">
            协议清单读取失败，使用内置列表
          </div>
        ) : null}

        <div style={s.row}>
          <Field label="默认上下文 (defaultContextWindow)" error={errors.defaultContextWindow} hint="">
            <input
              style={s.input}
              value={form.defaultContextWindow}
              onChange={(event) => update("defaultContextWindow", event.target.value)}
              placeholder="如 1000000"
              aria-label="路由默认上下文"
              inputMode="numeric"
            />
          </Field>
          <Field label="默认输出上限 (defaultMaxTokens)" error={errors.defaultMaxTokens} hint="">
            <input
              style={s.input}
              value={form.defaultMaxTokens}
              onChange={(event) => update("defaultMaxTokens", event.target.value)}
              placeholder="如 32768"
              aria-label="路由默认输出上限"
              inputMode="numeric"
            />
          </Field>
          <Field label="超时 (timeoutMs)" error={errors.timeoutMs} hint="">
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

        <div style={s.routeDefaults} aria-label="路由默认值说明">
          <span>未声明窗口 / 输出上限的模型回落到这两个值；已声明自己的模型不受影响。</span>
          <span>回落顺序：模型自己 → 内置目录 → 这里。</span>
          <span>注意：这里只影响请求参数，不影响 DSH 压缩阈值 —— 后者只认模型自己声明的那一项。</span>
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
                          {describeRouteDefaultUsage(model)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </React.Fragment>
          ))}
        </div>

        <div style={s.row}>
          <Field label="缓存 (cacheRetention)" hint="留空 = 不声明">
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
          <Field label="传输 (transport)" hint="留空 = 不声明">
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

        <div style={s.sub}>
          改动字段：{changedLabels.length === 0 ? "无（保存已禁用）" : changedLabels.join(" / ")}
        </div>

        {Object.keys(errors).length > 0 ? (
          <div style={s.err}>有字段未通过校验，修正前不会产出任何 op。</div>
        ) : null}
        {stale ? <div style={s.err}>{stale.message}</div> : null}

        <details style={s.details}>
          <summary style={s.summary}>
            保存将写入的 settingsOps（{plan.ops.length} 条）· 点击展开
          </summary>
          <pre style={s.pre}>{JSON.stringify(plan.ops, null, 2)}</pre>
        </details>

        <div style={s.editorFooter}>
          <span style={s.sub}>写入走宿主 configForms（修订号围栏 + 冲突自动重读）。</span>
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
              style={canSave ? s.btnPrimary : { ...s.btn, opacity: 0.5, cursor: "not-allowed" }}
              disabled={!canSave}
              onClick={save}
              aria-label="保存路由设置"
            >
              {busy ? "保存中…" : "保存设置"}
            </button>
          </span>
        </div>
      </div>
      ) : null}

      {open && confirmOpen ? (
        <DeleteRouteDialog
          routeId={routeId}
          modelCount={modelCount}
          busy={busy}
          onCancel={onCloseConfirm}
          onConfirm={onDelete}
        />
      ) : null}
    </section>
  );
}

/** 工作台界面。 */
function Workbench({ configForms, discoverModels }) {
  const scope = configForms.get(LLM_NS);
  const [snap, setSnap] = React.useState(() => scope.getSnapshot());
  React.useEffect(() => scope.subscribe(() => setSnap(scope.getSnapshot())), [scope]);

  const providers = providersOf(snap);
  const userProviders = userProvidersOf(snap);
  const routes = Object.keys(providers);
  const writable = snap?.writable !== false;

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

  const [template, setTemplate] = React.useState(() => readDefaultTemplate(storage));

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

  // 路由设置卡片的状态放在 Workbench：卡片组件保持无 hook，测试用的轻量
  // 渲染器（按组件树展开函数调用而不隔离 hook 槽）才能安全地展开它。
  const [routeFormState, setRouteFormState] = React.useState(null);
  const [routeCardOpen, setRouteCardOpen] = React.useState(false);
  const [routeConfirmOpen, setRouteConfirmOpen] = React.useState(false);
  // 两个默认值的「哪些模型会用到」清单各自折叠；按模型字段名存。
  const [routeDefaultUsageOpen, setRouteDefaultUsageOpen] = React.useState({ contextWindow: false, maxTokens: false });

  // 首次挂载：有模板就填进表单。只跑一次，用户之后的手动编辑不被覆盖。
  const templateApplied = React.useRef(false);
  React.useEffect(() => {
    if (templateApplied.current) return;
    templateApplied.current = true;
    if (template === null) return;
    const form = templateToForm(template);
    setContextWindow(form.contextWindow);
    setMaxTokens(form.maxTokens);
    setInputText(form.inputText);
    setInputImage(form.inputImage);
    setReasoningLevels(form.reasoningLevels);
  }, [template]);

  const reasoningGuard = reasoningLevelsGuard(reasoningLevels);

  React.useEffect(() => {
    if (routeId === "" && routes.length > 0) setRouteId(routes[0]);
  }, [routes, routeId]);

  const route = routeId ? providers[routeId] : undefined;

  // 切换路由时收起卡片并重新预填九个字段；不把上一条路由的表单带过来。
  React.useEffect(() => {
    setRouteCardOpen(false);
    setRouteConfirmOpen(false);
    setRouteDefaultUsageOpen({ contextWindow: false, maxTokens: false });
    setRouteFormState(routeFormFromProvider(route));
  }, [routeId]);
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
  }, [routeId]);

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

  // ── 行内编辑：diffRow 只产出真正变化的字段；projectPiAi(update) 再以现有行为基底合并 ──
  const editModel = editingIndex === null ? undefined : routeModels[editingIndex];
  const editDiff = React.useMemo(() => {
    if (editingIndex === null || editForm === null) return {};
    return diffRow(editForm, editModel);
  }, [editingIndex, editForm, editModel]);
  const editDraft = React.useMemo(() => ({ id: editModelId, ...editDiff }), [editModelId, editDiff]);
  const editProjection = React.useMemo(() => {
    if (editingIndex === null || editModelId === "") return undefined;
    try {
      return projectPiAi(
        editDraft,
        { providers, catalogModels: catalogIds },
        { routeId, mode: "update", index: editingIndex },
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
  }, [editDraft, providers, routeId, editingIndex, editModelId, catalogIds]);
  const editGuard = editForm === null ? null : reasoningLevelsGuard(editForm.reasoningLevels);
  const editStale = (editProjection?.warnings ?? []).some((warning) => warning.code === "stale-index");
  const editCanSave =
    writable &&
    !busy &&
    editGuard === null &&
    Object.keys(editDiff).length > 0 &&
    !editStale &&
    (editProjection?.unsupportedControls?.length ?? 0) === 0 &&
    (editProjection?.settingsOps?.length ?? 0) > 0;

  // 至少两条才谈得上排序；只读 / 写入进行中也禁用，避免并发写同一数组。
  const canReorderModels = writable && !busy && routeModels.length > 1;

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

  /** 拖动经过某一行：按指针在行的上半 / 下半决定插入线画在行前还是行后。 */
  function updateModelDragOver(event, index) {
    if (dragState === null) return;
    event.preventDefault();
    if (event.dataTransfer !== null && event.dataTransfer !== undefined) {
      event.dataTransfer.dropEffect = "move";
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
   */
  function handleModelDrop(event, index) {
    if (dragState === null) return;
    event.preventDefault();
    const cancelled = dragCancelled.current;
    dragCancelled.current = false;
    setDragState(null);
    if (cancelled) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
    const slot = index + (edge === "after" ? 1 : 0);
    const to = slot > dragState.from ? slot - 1 : slot;
    if (to === dragState.from) return;
    void moveModelTo(dragState.from, to);
  }

  /** 手柄聚焦后的方向键：↑ / ↓ 一位，Home / End 首 / 末位，每次立即写盘。 */
  function handleModelHandleKey(event, index) {
    if (!canReorderModels) return;
    const last = routeModels.length - 1;
    let to;
    if (event.key === "ArrowUp") to = Math.max(index - 1, 0);
    else if (event.key === "ArrowDown") to = Math.min(index + 1, last);
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = last;
    else return;
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
    setBusy(true);
    setToast(null);
    try {
      const ok = await scope.mutate(result.ops);
      if (ok) {
        // 行内编辑 / 删除确认按「打开时的下标」定位；重排后下标全变，继续
        // 展开会编辑到另一条模型，因此成功后收起，让用户按新位置重开。
        closeEditor();
        setDeleteTarget(null);
        if (focusHandle) pendingHandleFocus.current = to;
        setToast({ tone: "good", text: `已把 ${movedId} 移到第 ${to + 1} 位` });
      } else {
        if (focusHandle) pendingHandleFocus.current = from;
        setToast({ tone: "bad", text: "排序未保存（宿主拒绝或修订号冲突），列表保持原顺序，请核对后重试" });
      }
    } catch (error) {
      if (focusHandle) pendingHandleFocus.current = from;
      setToast({ tone: "bad", text: `排序失败：${error?.message ?? error}；列表保持原顺序` });
    } finally {
      setBusy(false);
    }
  }

  function updateEditForm(patch) {
    setEditForm((current) => (current === null ? current : { ...current, ...patch }));
  }

  /**
   * 把已保存的默认模板填进编辑表单。
   *
   * templateToForm 不返回 name，浅合并不会动显示名。模板里为空的字段会
   * 如实清空表单值 —— 这是「整体替换」，不是「只覆盖有值的字段」。
   */
  function fillEditTemplate() {
    if (template === null) return;
    updateEditForm(templateToForm(template));
    setEditErrors({ contextWindow: false, maxTokens: false });
  }

  /** 编辑表单的 token 输入：与新增流程同样拒绝非法值，回显最近一次合法值。 */
  function changeEditToken(event, field) {
    const next = event.target.value;
    if (next === "" || isPositiveTokenCount(next)) {
      updateEditForm({ [field]: next });
      setEditErrors((current) => ({ ...current, [field]: false }));
      return;
    }
    setEditErrors((current) => ({ ...current, [field]: true }));
    event.target.value = editForm?.[field] ?? "";
  }

  function toggleEditLevel(level) {
    setEditForm((current) => (current === null
      ? current
      : { ...current, reasoningLevels: toggleReasoningLevel(current.reasoningLevels, level) }));
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
      } else {
        setToast({ tone: "bad", text: "更新被宿主拒绝（修订号冲突或校验失败），已重新读取当前配置，请核对后重试" });
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
        if (editingIndex === deleteTarget.index) closeEditor();
      } else {
        setToast({ tone: "bad", text: "删除被宿主拒绝（修订号冲突或校验失败），已重新读取当前配置，请核对后重试" });
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
        setFetchError(response.error?.message ?? "宿主拒绝了模型发现请求");
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
      { routeId, template, ackedReplacement },
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
          : { tone: "bad", text: "写入被宿主拒绝（修订号冲突或校验失败），已重新读取当前配置，请核对后重试" },
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
          :           { tone: "bad", text: "写入被宿主拒绝（修订号冲突或校验失败），已重新读取当前配置，请核对后重试" },
      );
      if (ok) {
        const form = templateToForm(template);
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
        setAckReplace(false);
        setBatchProjection(null);
      }
    } catch (error) {
      setToast({ tone: "bad", text: `写入异常：${error?.message ?? error}` });
    } finally {
      setBusy(false);
    }
  }

  /** 路由设置卡片：无 hook 的展示组件，状态全部由 Workbench 持有。 */
  function updateRouteForm(patch) {
    setRouteFormState((current) => (current === null ? current : { ...current, ...patch }));
  }

  function toggleRouteCard() {
    setRouteCardOpen((current) => !current);
  }

  /** 就地展开 / 收起某个默认值的受影响模型清单（不弹窗）。 */
  function toggleRouteDefaultUsage(modelField) {
    setRouteDefaultUsageOpen((current) => ({ ...current, [modelField]: !current[modelField] }));
  }

  async function confirmDeleteRoute() {
    await deleteRoute();
    setRouteConfirmOpen(false);
  }

  /**
   * 保存路由设置：先按最新快照重算 ops（路由若已被别处删除就拒绝写入），
   * 再走与模型写入相同的修订号围栏。返回新表单供卡片重新预填。
   */
  async function saveRouteSettings(form) {
    const latestProviders = providersOf(scope.getSnapshot());
    const plan = buildRouteEditOps(routeId, form, latestProviders[routeId]);
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
    setBusy(true);
    setToast(null);
    try {
      const ok = await scope.mutate(plan.ops);
      if (!ok) {
        setToast({ tone: "bad", text: "保存被宿主拒绝（修订号冲突或校验失败），已重新读取当前配置，请核对后重试" });
        return { ok: false, form };
      }
      const nextForm = routeFormFromProvider(providersOf(scope.getSnapshot())[routeId]);
      setRouteFormState(nextForm);
      setToast({ tone: "good", text: `已保存路由设置 ${routeId}（${plan.ops.length} 条 op）` });
      return { ok: true, form: nextForm };
    } catch (error) {
      setToast({ tone: "bad", text: `保存异常：${error?.message ?? error}` });
      return { ok: false, form };
    } finally {
      setBusy(false);
    }
  }

  /**
   * 删除整条路由：用最新快照复核 stale-route 与「至少保留一个路由」，
   * 通过后只发一条 unset ["providers", routeId]。
   */
  async function deleteRoute() {
    const latestProviders = providersOf(scope.getSnapshot());
    const plan = buildRouteDeleteOps(routeId, latestProviders);
    if (plan.warnings.length > 0) {
      setToast({ tone: "bad", text: plan.warnings[0].message });
      return { ok: false, message: plan.warnings[0].message };
    }
    setBusy(true);
    setToast(null);
    try {
      const ok = await scope.mutate(plan.ops);
      if (!ok) {
        setToast({ tone: "bad", text: "删除被宿主拒绝（修订号冲突或校验失败），已重新读取当前配置，请核对后重试" });
        return { ok: false, message: "删除被宿主拒绝" };
      }
      const remaining = Object.keys(providersOf(scope.getSnapshot()));
      setRouteId(remaining[0] ?? "");
      setToast({ tone: "good", text: `已删除路由 ${routeId}` });
      return { ok: true };
    } catch (error) {
      setToast({ tone: "bad", text: `删除异常：${error?.message ?? error}` });
      return { ok: false, message: String(error?.message ?? error) };
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

      <section style={s.sectionCard} aria-label="当前路由">
        <div style={s.sectionTitle}>当前路由</div>
        <div style={s.row}>
          <Field label="路由 (provider)" hint="">
            <select style={s.select} value={routeId} onChange={(e) => { setRouteId(e.target.value); setAckReplace(false); }}>
              {routes.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </Field>
          <Field label="模型 ID（原样写入）" hint="" style={{ flex: "0 1 190px" }}>
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
          writable={writable}
          busy={busy}
          open={routeCardOpen}
          form={routeFormState}
          confirmOpen={routeConfirmOpen}
          usageOpen={routeDefaultUsageOpen}
          onChange={updateRouteForm}
          onToggleOpen={toggleRouteCard}
          onOpenConfirm={() => setRouteConfirmOpen(true)}
          onCloseConfirm={() => setRouteConfirmOpen(false)}
          onSave={saveRouteSettings}
          onDelete={confirmDeleteRoute}
          onToggleUsage={toggleRouteDefaultUsage}
        />
      ) : null}
      </section>

      <section style={s.modelsPanel} aria-label="该路由的模型列表">
        <div style={s.pendingHeader}>
          <span style={s.sectionTitle}>该路由的模型（{routeModels.length} 条）</span>
          <button type="button" style={s.btnSmall} onClick={focusCreateForm} aria-label="新增模型">
            + 新增
          </button>
        </div>
        {routeModels.length === 0 ? (
          <div style={s.modelEmpty}>
            <span>该路由没有模型。可在下方新增，或从端点拉取后批量添加。</span>
            <button type="button" style={s.btnSmall} onClick={focusCreateForm} aria-label="新增模型（空列表）">
              + 新增
            </button>
          </div>
        ) : routeModels.map((model, index) => {
          const modelKey = typeof model?.id === "string" && model.id !== "" ? model.id : `#${index}`;
          const rowKey = `${modelKey}:${index}`;
          const hovered = hoveredRow === rowKey;
          const dragging = dragState !== null && dragState.from === index;
          const rowStyle = {
            ...s.modelRow,
            ...(index === 0 ? s.modelRowFirst : null),
            ...(hovered ? s.modelRowHover : null),
            ...(dragging ? s.modelRowDragging : null),
          };
          return (
            <div
              key={rowKey}
              style={rowStyle}
              aria-label={`模型 ${modelKey}`}
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
              <div style={s.modelRowHead}>
                <button
                  type="button"
                  id={`modelpilot-model-handle-${index}`}
                  draggable={canReorderModels}
                  disabled={!canReorderModels}
                  style={canReorderModels ? s.modelHandle : { ...s.modelHandle, ...s.modelHandleDisabled }}
                  aria-label={`拖动排序 第 ${index + 1} 位`}
                  title={canReorderModels
                    ? "拖动排序；聚焦后可用 ↑ / ↓ / Home / End 移动"
                    : routeModels.length <= 1
                      ? "只有一个模型，无法排序"
                      : "当前不可排序（配置只读或正在写入）"}
                  onDragStart={(event) => beginModelDrag(event, index)}
                  onDragEnd={endModelDrag}
                  onKeyDown={(event) => handleModelHandleKey(event, index)}
                >
                  ⠿
                </button>
                <span style={s.modelIndex}>{index + 1}</span>
                <span style={s.modelName}>{modelKey}</span>
              </div>
              <div style={s.modelRowMeta}>
                <span style={s.modelSummary}>{describeModelRow(model, humanizeTokenCount)}</span>
                <button
                  type="button"
                  style={s.btnSmall}
                  onClick={() => openEditor(index)}
                  aria-label={`编辑模型 ${modelKey}`}
                >
                  编辑
                </button>
              </div>
              {editingIndex === index && editForm !== null ? (
                <EditModelForm
                  model={model}
                  modelId={editModelId}
                  form={editForm}
                  template={template}
                  errors={editErrors}
                  projection={editProjection}
                  changed={editDiff}
                  canSave={editCanSave}
                  busy={busy}
                  writable={writable}
                  guard={editGuard}
                  onChange={updateEditForm}
                  onTokenChange={changeEditToken}
                  onToggleLevel={toggleEditLevel}
                  onFillTemplate={fillEditTemplate}
                  onSave={saveEdit}
                  onCancel={closeEditor}
                  onDelete={requestDelete}
                  closeTokenPanels={pickerOpen}
                />
              ) : null}
            </div>
          );
        })}
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
        <div style={s.row}>
          <TokenCountField
            label="上下文窗口 (contextWindow)"
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
            value={maxTokens}
            candidates={MAX_TOKENS_CANDIDATES}
            error={maxTokensError}
            placeholder="如 8192"
            ariaLabel="输出上限"
            closeSignal={pickerOpen}
            onChange={(e) => changeTokenCount(e, maxTokens, setMaxTokens, setMaxTokensError)}
          />
          <div style={s.levels}>
            <span style={s.label}>推理档位（多选；全不选则不写 reasoningEfforts）</span>
            <div style={s.levelChips}>
              {PI_AI_LEVELS.map((level) => {
                const checked = reasoningLevels.includes(level);
                return (
                  <label key={level} style={checked ? { ...s.levelChip, ...s.levelChipOn } : s.levelChip}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setReasoningLevels((current) => toggleReasoningLevel(current, level))}
                    />
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
              <span style={s.sub}>全不选：本次投影不写 reasoningEfforts，沿用目录能力事实。</span>
            ) : null}
          </div>
        </div>

      <BudgetHint contextWindow={contextWindow} maxTokens={maxTokens} />

      <div style={s.row}>
        <label style={inputText ? { ...s.chip, ...s.chipOn, cursor: "pointer" } : { ...s.chip, cursor: "pointer" }}>
          <input type="checkbox" checked={inputText} onChange={(e) => setInputText(e.target.checked)} /> text
        </label>
        <label style={inputImage ? { ...s.chip, ...s.chipOn, cursor: "pointer" } : { ...s.chip, cursor: "pointer" }}>
          <input type="checkbox" checked={inputImage} onChange={(e) => setInputImage(e.target.checked)} /> image
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
          <div style={s.label}>批量投影结果（写出 {batchProjection.written.length} 条）</div>
          <div style={s.sub}>
            {batchProjection.ops.map((op) => `${op.path.join(".")} ← ${op.value?.id ?? ""}`).join(" · ")}
          </div>
          <details style={s.details}>
            <summary style={s.summary}>
              settingsOps（{batchProjection.ops.length} 条）· 点击展开
            </summary>
            <pre style={s.pre}>{JSON.stringify(batchProjection.ops, null, 2)}</pre>
          </details>
        </>
      ) : null}

      {modelId.trim() === "" ? (
        batchProjection ? null : <div style={s.sub}>填入模型 ID 后这里显示将要写入的内容。</div>
      ) : (
        <>
          <div style={s.label}>投影结果（写出的只有这些字段）</div>
          <details style={s.details}>
            <summary style={s.summary}>
              settingsOps（{projection?.settingsOps?.length ?? 0} 条）· 点击展开
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
            const form = templateToForm(template);
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
            setAckReplace(false);
            setBatchProjection(null);
            setToast(null);
          }}
        >
          清空
        </button>
        <button
          type="button"
          style={s.btnLink}
          onClick={() => {
            const next = formToTemplate({ contextWindow, maxTokens, inputText, inputImage, reasoningLevels });
            if (next === null) {
              setToast({ tone: "bad", text: "保存失败：模板至少需要一个输入模态（text 或 image）" });
              return;
            }
            if (!writeDefaultTemplate(storage, next)) {
              setToast({ tone: "bad", text: "保存失败：浏览器未开放本地存储" });
              return;
            }
            setTemplate(readDefaultTemplate(storage));
            setToast({ tone: "good", text: "已保存为默认模板" });
          }}
        >
          存为默认模板
        </button>
        <button
          type="button"
          style={template === null ? { ...s.btnSmall, opacity: 0.55, cursor: "not-allowed" } : s.btnSmall}
          disabled={template === null}
          onClick={() => {
            if (template === null) return;
            const form = templateToForm(template);
            setContextWindow(form.contextWindow);
            setMaxTokens(form.maxTokens);
            setContextWindowError(false);
            setMaxTokensError(false);
            setInputText(form.inputText);
            setInputImage(form.inputImage);
            setReasoningLevels(form.reasoningLevels);
          }}
          aria-label="填入默认模板"
        >
          填入默认模板
        </button>
      </div>

      <div style={s.hintLine}>
        {template === null ? (
          <span style={s.fieldHint}>尚未设置默认模板</span>
        ) : (
          <>
            <span style={s.fieldHint}>默认模板：{describeTemplate(template, humanizeTokenCount)}</span>
            <button
              type="button"
              style={s.btnLink}
              onClick={() => {
                removeDefaultTemplate(storage);
                setTemplate(null);
                setToast({ tone: "good", text: "已清除默认模板" });
              }}
            >
              清除
            </button>
          </>
        )}
      </div>
      </section>

      {toast ? <div style={toast.tone === "good" ? s.ok : s.err}>{toast.text}</div> : null}

      <p style={s.sub}>
        支持的推理档位：{PI_AI_LEVELS.join(" / ")}　·　输入模态：{MODALITIES.join(" / ")}
        <br />
        maxTokens 有两个作用：① 这个模型最多能输出多少；② 每次请求默认预留多少输出量。
        后者会从上下文窗口里扣掉，填得越大能装的历史越少。
      </p>

      {pickerOpen ? (
        <ModelPicker
          models={remoteModels}
          existing={existingModelIds}
          hasTemplate={template !== null}
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

      {deleteTarget ? (
        <DeleteConfirmDialog
          routeId={routeId}
          modelId={deleteTarget.id}
          busy={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      ) : null}
    </div>
  );
}

export function apply(ctx) {
  const configForms = ctx.configForms;
  // 在 apply 作用域里绑定宿主操作：组件只拿到回调，不直接持有服务代理。
  const discoverModels = (namespace, request) => ctx.remote.llm.discoverModels(namespace, request);
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
              inject: () => ({ configForms, discoverModels }),
            },
            Workbench,
          ),
        ),
      ),
    "model-assistant: workbench settings page",
  );
}

export default { name, inject, apply };
