# 上下文窗口 / 输出上限可输入下拉 — 视觉证据

- 基线：`2201393`（`origin/main`，`feat: 模型 ID 自动填充显示名 (#4)`）
- 变更：本分支 `agent/token-input-datalist-e9003efb5337` 的 PR 头提交
- 环境：DSH Web 0.2.2-rc.1，Chrome 152 headless，1440×1000 视口，浅色主题
- 场景：设置 → ModelPilot，路由 `preview-chat`，模型 ID 留空
- 预览实例使用临时 profile 与示例 provider，不含真实凭据或私人内容。

| 文件 | 状态 |
| --- | --- |
| `before-values.png` | 基线：纯文本输入 `131072` / `8192`，下方没有提示 |
| `after-values.png` | 变更后：同样的值，输入框带 datalist 下拉箭头，下方显示 `131K` / `8K` |
| `before-error.png` | 基线：清空上下文窗口后输入 `abc`，原样写入输入框，无校验提示 |
| `after-error.png` | 变更后：同样输入 `abc`，值不写入状态，下方显示红色「请输入正整数」 |

补充：原生 datalist 弹层由浏览器绘制，headless Chrome 的页面截图不包含该弹层；
在同一个预览实例中通过 DOM 核对了两组候选：`contextWindow` 为
`8192 / 32768 / 65536 / 131072 / 200000 / 262144 / 1000000`，
`maxTokens` 为 `4096 / 8192 / 16384 / 32768 / 65536 / 131072`，
两个输入框均带 `inputMode="numeric"` 和对应的 `list` 属性。
