// 工单 #18：API key 管理（第二批）—— 与宿主一致的纯规则。
//
// 这一层只回答三个问题，不碰任何密钥内容：
//   1. 引用名怎么派生（照抄内置模型页的规则）；
//   2. 路由上的 apiKeyEnv 对应哪个有效引用名（首尾空白不算名字的一部分）；
//   3. 凭据状态（configured / writable）在卡片上显示哪一行文案、露出哪些按钮。
//
// 明文密钥永远不经过这里：它从密码框直接交给宿主 remote.credentials.set，
// 不进入表单、不进入 settingsOps，也不进入任何日志或错误消息。

/** 与内置模型页 `deriveKeyRef` 相同的派生规则：preview-chat → PREVIEW_CHAT_API_KEY。 */
export function deriveKeyRef(provider) {
  const text = typeof provider === "string" ? provider.trim() : "";
  if (text === "") return "";
  return `${text.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
}

/** 路由上的 apiKeyEnv → 有效引用名；首尾空白视为输入噪声，空白串 = 未设置。 */
export function credentialRefOf(apiKeyEnv) {
  return typeof apiKeyEnv === "string" ? apiKeyEnv.trim() : "";
}

/** 卡片文案。集中在这里，避免状态行、按钮和测试各写一份。 */
export const CREDENTIAL_TEXT = Object.freeze({
  emptyRef: "未设置引用名，无法管理密钥",
  loading: "正在读取密钥状态…",
  loadFailed: "密钥状态读取失败",
  configured: "已配置",
  unconfigured: "未配置",
  readOnlySuffix: "（由环境变量提供，不可从此处修改）",
  editorHint: "密钥只写入宿主的凭据存储，不会出现在配置文件中。",
});

/**
 * 凭据状态 → 状态行文案与按钮可见性。
 *
 * 三种「不 ready」的状态都不渲染写按钮：引用名为空时没有可写的对象，
 * 读取中与读取失败时无法判断 writable，宁可不给入口也不硬写。
 *
 * @param {{ref?: string, status?: "idle"|"loading"|"ready"|"error", configured?: boolean, writable?: boolean, error?: string}} state
 * @returns {{kind: string, ref: string, text: string, configured: boolean, writable: boolean,
 *   readOnly: boolean, showSet: boolean, showReplace: boolean, showClear: boolean, error: string}}
 */
export function credentialView(state) {
  const ref = credentialRefOf(state?.ref);
  if (ref === "") {
    return {
      kind: "empty",
      ref: "",
      text: CREDENTIAL_TEXT.emptyRef,
      configured: false,
      writable: true,
      readOnly: false,
      showSet: false,
      showReplace: false,
      showClear: false,
      error: "",
    };
  }

  const status = state?.status ?? "idle";
  if (status === "idle" || status === "loading") {
    return {
      kind: "loading",
      ref,
      text: CREDENTIAL_TEXT.loading,
      configured: false,
      writable: true,
      readOnly: false,
      showSet: false,
      showReplace: false,
      showClear: false,
      error: "",
    };
  }
  if (status === "error") {
    return {
      kind: "error",
      ref,
      text: CREDENTIAL_TEXT.loadFailed,
      configured: false,
      writable: false,
      readOnly: true,
      showSet: false,
      showReplace: false,
      showClear: false,
      error: typeof state?.error === "string" ? state.error : "",
    };
  }

  const configured = state?.configured === true;
  const writable = state?.writable !== false;
  const base = configured ? CREDENTIAL_TEXT.configured : CREDENTIAL_TEXT.unconfigured;
  return {
    kind: "ready",
    ref,
    text: writable ? base : `${base}${CREDENTIAL_TEXT.readOnlySuffix}`,
    configured,
    writable,
    readOnly: !writable,
    // 已配置 → 更换 + 清除；未配置 → 设置。只读时保留对应按钮但禁用。
    showSet: !configured,
    showReplace: configured,
    showClear: configured,
    error: "",
  };
}
