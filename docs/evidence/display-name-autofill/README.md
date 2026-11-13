# 显示名跟随模型 ID 自动填充 — 视觉证据

- 基线：`39e1b2e`（`origin/main`，`feat: 推理档位改为复选框组 (#2)`）
- 变更：本分支 `agent/autofill-display-name-2a1a372d79f3`；截图在重新执行 `npm run build` 生成 `lib/client.js` 后采集
- 环境：DSH Web 0.2.2-rc.1，Chrome 152 headless，1440×1000 视口，浅色主题
- 场景：设置 → ModelPilot，路由 `preview-chat`；所有截图使用同一个示例 provider，不含真实凭据或私人内容
- 操作：在「模型 ID」输入框输入值；「显示名」输入框未获得焦点时由联动写入，仅在 `after-manual-display-name.png` 中手动修改

| 文件 | 状态 |
| --- | --- |
| `before-manual-required.png` | 基线：输入 `tflow/alpha-32b` 后，显示名仍为空（占位符 `留空则不写`） |
| `after-autofill.png` | 变更后：输入 `tflow/alpha-32b`，显示名自动变为 `alpha-32b` |
| `after-manual-display-name.png` | 变更后：手动把显示名改为 `我的模型`，再把模型 ID 改为 `other/beta`，显示名保持 `我的模型` |
| `after-clear-restores-autofill.png` | 变更后：点「清空」后输入 `x/y`，显示名自动变为 `y` |
| `after-no-slash.png` | 变更后：输入无斜杠的 `sn-deepseek-v4-1-flash-1017`，显示名等于模型 ID 本身 |
| `after-empty-model-id.png` | 变更后：模型 ID 清空后，显示名同样清空 |
