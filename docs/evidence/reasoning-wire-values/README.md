# 推理档位的「API 参数值」— 视觉证据（工单 #23）

- 基线：`977db30`（`origin/main`，路由设置增加默认输入模态字段）
- 变更：本分支 `agent/reasoning-wire-values-a8d3d5715901` 的头提交；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- 环境：DSH Web 0.2.2-rc.1，Chrome 152.0.7977.64 headless（CDP `Page.captureScreenshot`），1440×1400 视口，设备像素比 1
- 场景：设置 → ModelPilot，路由 `preview-chat`，编辑 `jxf/dsv4.1-flash`；该模型的 `reasoningEfforts` 为
  `{ off: null, low: low, medium: medium, high: high_reasoning }`，勾选 `off / low / medium / high`
- 数据：两个临时 DSH profile；除 `lib/client.js` 版本外，provider、baseURL、模型数据、视口与主题完全一致。没有真实凭据或私人内容。

## Light 主题：Before / After

| 文件 | 说明 |
| --- | --- |
| `before-light.png` | 基线：编辑表单只有一列档位 chip；`high_reasoning` 这个线上值与档位名不同，但界面上看不到也改不了 |
| `after-light-collapsed.png` | 变更后：chip 组下方出现默认折叠的「自定义 API 参数值（1 个档位与档位名不同）」，日常仍只看见 chip 组 |
| `after-light-expanded.png` | 展开后：每个勾选中的非 off 档位一行输入框；`high` 预填 `high_reasoning`，`low` / `medium` 留空（= 用档位名）；`off` 没有输入框；下方给出与内置页相同的说明 |
| `after-light-wire-changed.png` | 把 `high` 从 `high_reasoning` 改成 `max`：档位集合不变，但「改动字段：推理档位」、settingsOps 变为 1 条，保存按钮可用 |

## Dark 主题：Before / After

| 文件 | 说明 |
| --- | --- |
| `before-dark.png` | 基线：与 light 主题同一场景，深色下同样只有 chip 组 |
| `after-dark-collapsed.png` | 变更后：折叠摘要与 light 主题一致，输入框 / 摘要 / 说明跟随 `--dsw-*` token |
| `after-dark-expanded.png` | 变更后：展开态，输入框底色、边框、文字均跟随深色 token |
| `after-dark-wire-changed.png` | 变更后：只改 API 参数值也被识别为改动，保存可用 |

## 数据与交互

临时 profile 中的 provider 片段（`cordis.patch.yml`，只保留相关行）：

```yaml
- id: llm-pi-ai
  config:
    providers:
      preview-chat:
        apiKeyEnv: PREVIEW_API_KEY
        api: openai-completions
        baseURL: https://preview.invalid/v1
        models:
          - id: jxf/dsv4.1-flash
            name: jxf/dsv4.1-flash
            contextWindow: 1000000
            maxTokens: 32768
            input: [ text ]
            reasoningEfforts:
              off: null
              low: low
              medium: medium
              high: high_reasoning
```

- 截图由 Chrome DevTools Protocol 直接采集运行中的 DSH Web 预览实例；打开设置、切换 ModelPilot、展开编辑、展开「自定义 API 参数值」、修改输入框都是真实 DOM 操作。
- 基线实例链接 `origin/main` 的打包产物；变更实例链接本分支重建后的 `lib/client.js`；两个实例使用独立的临时 profile，避免截图之间互相污染。
- `baseURL` 是 `https://preview.invalid/v1` 占位地址，全程没有访问真实模型服务；`PREVIEW_API_KEY` 没有配置真实值。

## 主题与对比度

- `test/client/model-edit.test.mjs` 在 light / dark 两套宿主 token 下渲染打包产物，断言 API 参数值输入框、档位标签、留空提示的对比度均 ≥ 4.5，且输入框底色 = `--dsw-alias-bg-layer-1`、文字色 = `--dsw-alias-label-primary`。
- 高级区默认折叠（`<details>` 未设置 `open`）；折叠摘要只显示「N 个档位与档位名不同」，不把七个输入框平铺在主界面。
