# 推理档位复选框组 — 视觉证据

- 基线：`563691a`（`origin/main`，`docs: 仓库文案全面中文化`）
- 变更：本分支 `agent/reasoning-levels-checkbox-96b2d5f2ebe2` 的 PR 头提交（截图在重建 `lib/client.js` 后采集）
- 环境：DSH Web 0.2.2-rc.1，Chrome 152 headless，1440×1000 视口，浅色主题
- 场景：设置 → ModelPilot，路由 `preview-chat`；默认态截图为空模型 ID，其余截图模型 ID 为 `preview-model-new`
- 预览实例使用临时 profile 与示例 provider，不含真实凭据或私人内容。

| 文件 | 状态 |
| --- | --- |
| `before-default.png` | 基线：逗号分隔文本框 |
| `after-default.png` | 变更后：七档复选框，默认勾选 off / low / medium / high |
| `after-off-only.png` | 变更后：只勾 off，R5 守卫提示，写入按钮禁用 |
| `after-none.png` | 变更后：全不选，提示不写 reasoningEfforts |
