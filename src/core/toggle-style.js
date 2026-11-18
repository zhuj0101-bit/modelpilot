// 工单 #41：选中态「多重冗余编码」的颜色计算工具。
//
// 选中 / 未选中是否真的能区分，不能靠人眼在暗色主题里反复试；这里把
// 「解析颜色 → 叠到实际底色 → 算 WCAG 对比度」做成纯函数，对比度断言直接
// 调用同一套公式，避免测试里再抄一份近似实现。
//
// 只处理 CSS 颜色字符串 / {r,g,b,a} 对象，不碰 DOM、React 或 --dsw-* 变量。

/** 选中态与未选中态填充之间的最低对比度（WCAG 非文本门槛）。 */
export const TOGGLE_MIN_CONTRAST = 3.0;

const HEX_PATTERN = /^#([0-9a-f]{3,8})$/;
const RGB_PATTERN = /^rgba?\(([^)]*)\)$/;

/** 把通道值夹到 0–255，保留原始精度。 */
function channel(value) {
  return Math.min(255, Math.max(0, value));
}

/** 把 alpha 夹到 0–1；百分比写法先换算成小数。 */
function alphaOf(text) {
  if (typeof text !== "string") return Number(text);
  const trimmed = text.trim();
  return trimmed.endsWith("%") ? Number.parseFloat(trimmed) / 100 : Number.parseFloat(trimmed);
}

/**
 * 解析 hex / rgb() / rgba() / 透明色，或已是 {r,g,b,a} 的对象。
 * 无法解析返回 null（调用方据此给出可读的断言失败，而不是静默算成黑色）。
 *
 * @param {unknown} value
 * @returns {{r:number,g:number,b:number,a:number}|null}
 */
export function parseColor(value) {
  if (value !== null && typeof value === "object") {
    const { r, g, b, a = 1 } = value;
    if (![r, g, b, a].every((part) => typeof part === "number" && Number.isFinite(part))) return null;
    return { r: channel(r), g: channel(g), b: channel(b), a: Math.min(1, Math.max(0, a)) };
  }
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  const hex = text.match(HEX_PATTERN);
  if (hex !== null) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      const parts = [...digits].map((char) => Number.parseInt(char + char, 16));
      return { r: parts[0], g: parts[1], b: parts[2], a: digits.length === 4 ? parts[3] / 255 : 1 };
    }
    if (digits.length === 6 || digits.length === 8) {
      const parts = [0, 2, 4, 6].map((start) => Number.parseInt(digits.slice(start, start + 2), 16));
      return { r: parts[0], g: parts[1], b: parts[2], a: digits.length === 8 ? parts[3] / 255 : 1 };
    }
    return null;
  }

  const rgb = text.match(RGB_PATTERN);
  if (rgb === null) return null;
  const parts = rgb[1].split(/[,\s/]+/).filter(Boolean);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [r, g, b] = parts.slice(0, 3).map((part) => Number.parseFloat(part));
  const a = parts.length === 4 ? alphaOf(parts[3]) : 1;
  if (![r, g, b, a].every((part) => Number.isFinite(part))) return null;
  // 只接受小数通道：rgb(100% ...) 这种百分比写法留到真正需要时再加。
  if (parts.slice(0, 3).some((part) => part.trim().endsWith("%"))) return null;
  return { r: channel(r), g: channel(g), b: channel(b), a: Math.min(1, Math.max(0, a)) };
}

/**
 * WCAG 2.0 相对亮度（公式与工单 #41 的复现脚本一致）。
 * 无法解析返回 null。
 *
 * @param {unknown} color
 * @returns {number|null}
 */
export function relativeLuminance(color) {
  const parsed = parseColor(color);
  if (parsed === null) return null;
  const linear = (value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(parsed.r) + 0.7152 * linear(parsed.g) + 0.0722 * linear(parsed.b);
}

/**
 * WCAG 对比度：(亮 + 0.05) / (暗 + 0.05)，范围 1–21。
 * alpha 不参与计算；需要时先用 composite() 叠到实际底色上。
 * 任一颜色无法解析返回 null。
 *
 * @param {unknown} foreground
 * @param {unknown} background
 * @returns {number|null}
 */
export function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  if (first === null || second === null) return null;
  const [high, low] = first >= second ? [first, second] : [second, first];
  return (high + 0.05) / (low + 0.05);
}

/**
 * 按 alpha 把前景色叠到背景色上（source-over）。背景为不透明色时返回值
 * 的 a 恒为 1；背景本身半透明时返回组合后的 alpha，方便继续向上叠。
 * 任一颜色无法解析返回 null。
 *
 * @param {unknown} foreground
 * @param {unknown} background
 * @returns {{r:number,g:number,b:number,a:number}|null}
 */
export function composite(foreground, background) {
  const top = parseColor(foreground);
  const bottom = parseColor(background);
  if (top === null || bottom === null) return null;
  const alpha = top.a + bottom.a * (1 - top.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / alpha,
    g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / alpha,
    b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / alpha,
    a: alpha,
  };
}
