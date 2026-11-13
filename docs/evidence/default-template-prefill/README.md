# 默认模板与自动回填 — 视觉证据

- 基线：`3d2e378`（`origin/main`，`fix: token 候选下拉与提示行布局 (#12) (#13)`）
- 变更：本分支 `agent/default-template-prefill-92b52662e167` 的头提交；截图在 `npm run build` 重建 `lib/client.js` 后采集
- 环境：DSH Web 0.2.2-rc.1，Chrome 152.0.7977.64 headless，1440×913 视口，浅色主题
- 场景：设置 → ModelPilot，路由 `preview-chat`，示例 provider（`preview-model`），不含真实凭据或私人内容
- 两个预览实例使用独立的临时 profile；变更后实例在首次操作前 `localStorage` 中没有 `modelpilot.default-template.v1`

| 文件 | 状态 |
| --- | --- |
| `before-filled.png` | 基线：上下文窗口 `131072`、输出上限 `8192`、仅勾选 `text`、默认档位 `off / low / medium / high`；没有默认模板按钮或状态行 |
| `before-cleared.png` | 基线：点击「清空」后，上下文窗口与输出上限为空，推理档位全不选 |
| `after-initial.png` | 变更后：没有模板时显示「尚未设置默认模板」，新增「存为默认模板」按钮，空表单 + 默认档位 |
| `after-saved.png` | 变更后：填入相同值后点击「存为默认模板」，状态行显示 `默认模板：上下文 131072（131K） · 输出 8192（8K） · text · off,low,medium,high`，并提示「已保存为默认模板」 |
| `after-reload.png` | 变更后：刷新页面并重新打开 ModelPilot，五个模板字段全部按 localStorage 中的模板回填 |
| `after-clear.png` | 变更后：模型 ID 填 `tflow/alpha-32b`（显示名自动为 `alpha-32b`）后点击「清空」，模型 ID / 显示名为空，其余五个字段回到模板值 |
| `after-write.png` | 变更后：写入 `preview/new-model` 成功后，模型 ID / 显示名清空，其余五个字段回到模板值，提示「已写入 preview-chat / preview/new-model」 |
| `after-removed.png` | 变更后：点击「清除」，状态行回到「尚未设置默认模板」，提示「已清除默认模板」 |
| `after-clear-no-template.png` | 变更后：清除模板后再点「清空」，表单回到空值 + `off / low / medium / high` |
| `after-invalid.png` | 变更后：`text` 与 `image` 都不勾选时点击「存为默认模板」，提示「保存失败：模板至少需要一个输入模态（text 或 image）」 |
| `after-storage-disabled.png` | 变更后：让默认模板 key 的 `getItem` / `setItem` 抛异常以模拟禁用存储，页面正常渲染并显示「尚未设置默认模板」；点击保存提示「保存失败：浏览器未开放本地存储」 |

## 数据核对

- 保存后 `localStorage["modelpilot.default-template.v1"]`：
  ```json
  {"version":1,"contextWindow":"131072","maxTokens":"8192","inputText":true,"inputImage":false,"reasoningLevels":["off","low","medium","high"]}
  ```
- 刷新后与清空后的字段状态：`contextWindow=131072`、`maxTokens=8192`、`text=true`、`image=false`、`reasoningLevels=[off,low,medium,high]`。
- 清除模板后 `localStorage` 中该 key 为 `null`；再点「清空」时 `contextWindow` / `maxTokens` 为空，档位仍为默认四项。

## 说明

- 截图由 Chrome DevTools Protocol 直接采集运行中的 DSH Web 预览实例；表单值用原生输入事件写入，按钮通过真实点击触发。
- 基线实例链接 `origin/main` 检出，变更实例链接本分支检出；除 `lib/client.js` 版本外，两个实例的 provider、视口与主题相同。
