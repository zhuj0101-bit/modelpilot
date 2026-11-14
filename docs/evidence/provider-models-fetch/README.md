# 拉取模型列表（宿主 discoverModels）— 视觉证据

- 基线：`7b530e9`（`origin/main`，`feat: 支持保存默认模板并自动回填 (#16)`）
- 变更：本分支 `agent/fetch-provider-models-e69abddd3786` 的 PR 头提交（截图在 `npm run build` 重建 `lib/client.js` 后采集）
- 环境：DSH Web 0.2.2-rc.1，Chrome 152 headless，1440×1000 视口，浅色主题
- 场景：设置 → ModelPilot，路由 `newapi-chat`，模型 ID 初始为空
- 预览实例使用临时 profile 与本地 mock `/v1/models`；路由配置为
  `apiKeyEnv: NEWAPI_CHAT_API_KEY`，凭据由宿主从进程环境解析，不含真实凭据或私人内容。
- 成功 / 失败 / 加载三种状态由 mock 驱动：成功返回 3 个 id，失败返回 HTTP 401，加载延迟 4 秒。

| 文件 | 状态 |
| --- | --- |
| `before-model-id.png` | 基线：模型 ID 只能手打，没有拉取按钮，也没有凭据文案 |
| `after-idle.png` | 变更后：模型 ID 输入框右侧有「拉取」按钮；界面不出现「凭据：」文案 |
| `after-success.png` | 变更后：宿主 discoverModels 成功，显示「已拉取 3 个模型：jxf/dsv4.1-flash、other-model、preview-model-gamma」 |
| `after-selected.png` | 变更后：从候选选中 `jxf/dsv4.1-flash`，模型 ID 填入，显示名按工单 2 的规则联动为 `dsv4.1-flash` |
| `after-loading.png` | 变更后：拉取期间按钮变「…」且 `disabled`，模型 ID 仍显示上一次的值 |
| `after-error.png` | 变更后：宿主返回 401 时显示「拉取失败：http://127.0.0.1:9999/v1/models answered 401; check the API key」，已有模型 ID 保留 |

补充：原生 datalist 弹层由浏览器绘制，headless Chrome 的页面截图不包含该弹层；
在同一预览实例中通过 DOM 核对了成功后的候选为
`jxf/dsv4.1-flash / other-model / preview-model-gamma`，模型 ID 输入框带
`list="modelpilot-remote-models"`，datalist 的三项 `option.value` 与宿主
`discoverModels` 返回的 `id` 一致。宿主侧 mock 请求日志确认
`Authorization: Bearer <preview-key>` 已发送，说明宿主成功解析了
`apiKeyEnv`；页面文本中没有该 key。
