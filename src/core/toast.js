// 工单 #35：操作结果提示（toast）的行为规则。
//
// 这里只放与 DOM 无关的部分：哪个 tone 会自动消失、消失前先淡出多久、焦点
// 进入时如何暂停，以及读屏语义。组件负责接上真实的定时器与样式，因此同一套
// 规则既能在单元测试里用假时钟钉死，也能在真实 DOM 测试里被观察。

/** 成功提示的驻留时长：读完一句话的时间，超过就自动收起。 */
export const TOAST_SUCCESS_DISMISS_MS = 6000;

/** 淡出时长；与 CSS transition 的时长保持一致。 */
export const TOAST_FADE_MS = 300;

/**
 * 提示的读屏语义：普通操作结果用 status / polite（不打断当前朗读），
 * 报错用 alert / assertive（需要立刻听见）。
 *
 * @param {string|undefined} tone
 * @returns {{role:string, live:string}}
 */
export function toastAria(tone) {
  if (tone === "bad") return { role: "alert", live: "assertive" };
  return { role: "status", live: "polite" };
}

/**
 * 下一次定时器应该在多少毫秒后触发；null 表示当前不需要定时器。
 *
 * 规则（工单 #35）：
 * - 只有成功提示自动消失，报错留在页面上等用户处理；
 * - 焦点在提示区域内时暂停计时（键盘 / 读屏用户正在读它）；
 * - 先驻留 6 秒，再淡出 300 毫秒，淡出结束后才真正移除。
 *
 * @param {{tone?:string, hiding?:boolean}|null} toast
 * @param {boolean} focused 焦点是否在提示区域内
 * @returns {number|null}
 */
export function toastDismissDelay(toast, focused) {
  if (toast === null || typeof toast !== "object") return null;
  if (focused === true) return null;
  if (toast.tone !== "good") return null;
  return toast.hiding === true ? TOAST_FADE_MS : TOAST_SUCCESS_DISMISS_MS;
}

/**
 * 定时器触发后的下一份提示状态：开始淡出（hiding = true），淡出结束则移除。
 *
 * 不是成功提示时原样返回，调用方据此跳过无意义的重渲染。
 *
 * @param {{tone?:string, hiding?:boolean, text?:string}|null} toast
 * @returns {{tone?:string, hiding?:boolean, text?:string}|null}
 */
export function nextToastOnDismiss(toast) {
  if (toast === null || typeof toast !== "object" || toast.tone !== "good") return toast;
  return toast.hiding === true ? null : { ...toast, hiding: true };
}

/**
 * 焦点进入提示区域时取消淡出：提示重新变成不透明，并保持到焦点离开。
 *
 * @param {{tone?:string, hiding?:boolean, text?:string}|null} toast
 * @returns {{tone?:string, hiding?:boolean, text?:string}|null}
 */
export function restoreToastOnFocus(toast) {
  if (toast === null || typeof toast !== "object" || toast.hiding !== true) return toast;
  return { ...toast, hiding: false };
}
