# 提示文案精简：说明进 hover，状态常驻（工单 #30）

- 基线：`4ab7a3e`（`origin/main`，`feat: 模型行摘要标注值来源（工单 #27） (#57)`）
- 基线打包产物：`lib/client.js` SHA-256 `e3d79a9c3ba3e3769c2795d72489a5f8c68bac5d681f2b77e7d8e4422486a5bd`
- 变更后打包产物：`lib/client.js` SHA-256 `9dd3a7a499dffe11c6991ec9cc6303c08cb6e35f89c129d99264b9e819e6eb11`（连续两次构建同值）
- 环境：Chrome 152 headless，页面视口 1440×1200、设备像素比 1；宿主 `--dsw-*` token 由仓库既有的 light / dark 夹具提供，`color-scheme` 分别为 `light` / `dark`
- 场景：Workbench 工作台，一条路由 `preview-chat`，三个模型（`acme/declared` / `acme/route-defaults` / `acme/empty-input`）；路由默认值 1M / 128K / text + image
- 数据不含真实凭据或私人内容；`baseURL` 是 `https://preview.invalid/v1` 占位地址

## 采集方式

截图不是 mockup：页面加载的是仓库真实打包产物 `lib/client.js`（before 为基线 `4ab7a3e` 的产物，after 为本分支产物），由与单测共用的最小 React 兼容渲染器渲染真实的 `Workbench` 组件树；路由数据、宿主 token、`configForms` 快照与 `credentials` 夹具完全一致，before / after 两份页面只有 `lib/client.js` 不同。

- `initial`：默认折叠态（页面初始可见区域）
- `expanded`：点开「路由设置」后的十个路由级字段与默认值说明

局限：这些截图来自夹具驱动的 headless Chrome 页面，不是运行中的 DSH Web 实例。`ⓘ` 使用浏览器原生 `title`，页面截图不会自动展开悬停；悬停内容由 `test/client/hint-copy-trim.test.mjs` 在 light / dark 下逐字读回 `title` 断言。

## Before / After

| 文件 | 说明 |
| --- | --- |
| `compare-light-initial.png` / `compare-dark-initial.png` | 初始页并排对照（左基线，右变更后） |
| `compare-light-expanded.png` / `compare-dark-expanded.png` | 展开「路由设置」并排对照（左基线，右变更后） |
| `before-light-initial.png` / `before-dark-initial.png` | 基线初始页：页头两行长说明、`推理档位（多选；全不选则不写 reasoningEfforts）`、`填入模型 ID 后这里显示将要写入的内容。`、页脚两行参考说明同时常驻 |
| `after-light-initial.png` / `after-dark-initial.png` | 变更后初始页：这些功能说明全部离场，只在对应标签后保留 `ⓘ`；可见文字只剩状态（如「尚未设置默认模板」「已选 0 条」）与模型行摘要 |
| `before-light-expanded.png` / `before-dark-expanded.png` | 基线展开：路由字段说明常驻（`编辑路由 preview-chat 的字段：只写改过的叶子路径…`）、字段下方逐条提示、四行默认值语义块、`写入走宿主 configForms…` |
| `after-light-expanded.png` / `after-dark-expanded.png` | 变更后展开：字段说明进标签的 `ⓘ`；四行静态语义移除，只保留三个字段的**条件状态行**（本场景为「留空 → 使用内置默认值 …」）；`configForms` 说明改为保存按钮的悬停解释 |

## 变化清单（对应验收判据）

1. **初始可见的说明性文案减少到 3 行以内**：变更后初始页为 **0 行**功能说明；`尚未设置默认模板`、`已选 N 条`、`该路由现有模型条目 N · 目录条目 N` 等属于状态，继续常驻。
2. **每个被移除的说明都在对应标签的 `ⓘ` 里**：
   - 页头说明 → 标题后的 `ⓘ`（合成链 + 只写改动字段 / 冲突重读）
   - 模型 ID 的空态说明 → `模型 ID` 标签的 `ⓘ`
   - `推理档位（多选；全不选则不写 reasoningEfforts）` → `推理档位（多选）` 标签的 `ⓘ`
   - 上下文窗口 / 输出上限的语义 → 两个 token 字段标签的 `ⓘ`
   - 路由显示名 / 接口地址 / 协议 / 密钥引用 / 默认上下文 / 默认输出上限 / 超时 / 默认输入模态 / 缓存 / 传输的逐字段说明 → 各标签的 `ⓘ`
   - 默认值回落链与「不影响压缩阈值」→ `路由设置` 摘要的 `ⓘ` 与 `默认输入模态` 的 `ⓘ`
   - 密钥只写入凭据存储 / 只读来源 → `密钥状态` 标签的 `ⓘ`
   - 全部路由的「点行切换 / 密钥只显示状态」→ 总览摘要的 `ⓘ`
   - 新建路由弹窗的底部选择说明 → 弹窗标题的 `ⓘ`
   - `maxTokens 有两个作用…` → 新增 / 编辑表单输出上限的 `ⓘ`
3. **实现名词从提示文案中消失**：`不写空数组`、`宿主回落`、`宿主`、`configForms`、`reasoningEfforts`、`settingsOps`、`catalog-replacement`、`modelOverrides`、`writable: false` 不再出现在用户可见的说明句里；原始 ops JSON 仍保留在「点击展开」的技术预览中。
4. **危险操作后果一句不少**：删除模型 / 删除路由 / 清除密钥三个确认弹窗的正文与后果句保留，既有 `route-delete` / `model-edit` / `api-key` 测试全部通过。
5. **状态文案常驻不变**：`已配置` / `未配置` / `连接正常 · 端点返回 N 个模型` / `连接失败` 等状态行未改动；`api-key` / `connection-test` 测试通过。
6. **条件文案只在条件成立时出现**：搜索为空时页面文字与拖动手柄 `title` 都不出现「筛选状态下不可排序」；搜索非空时只出现在手柄 `title` 中。默认值区块仅在存在状态行时渲染；「至少保留一条模型」只在批量删除会被阻止时出现。
7. **测试断言同步更新**：`api-key` / `connection-test` / `model-edit` / `model-picker` / `new-route` / `route-delete` / `route-edit` / `route-overview` / `template-fill` / `projection route-edit` 中受文案影响的断言已更新；新增 `test/client/hint-copy-trim.test.mjs`（10 项）逐条验收本工单。
8. **测试全绿**：`node --test 'test/**/*.test.mjs'` → **697 tests，691 pass，6 skipped，0 fail**（基线 687：681 pass + 6 skipped；新增 10 项）。`node scripts/verify-package.mjs .` → 18/18 PASS。

## 测试与产物验证

```text
$ node --test 'test/**/*.test.mjs'
ℹ tests 697
ℹ pass 691
ℹ fail 0
ℹ skipped 6

$ node scripts/build-client.mjs   # 连续两次
9dd3a7a499dffe11c6991ec9cc6303c08cb6e35f89c129d99264b9e819e6eb11
9dd3a7a499dffe11c6991ec9cc6303c08cb6e35f89c129d99264b9e819e6eb11

$ node scripts/verify-package.mjs .
PASS 1 … PASS 18
```

## 本批没有做

- 没有删危险操作提示，也没有把状态文案（已配置 / 未配置 / 连接正常 / 连接失败）移进 hover。
- 没有把「筛选状态下不可排序」「至少保留一条模型」改成常驻说明；它们仍只在条件成立时出现。
- 没有改字段标签里的配置键名（如 `上下文窗口 (contextWindow)`）；本工单处理的是解释性提示文案，不是字段命名。
- 没有把原始 ops JSON 预览删掉；它是「点击展开」里的技术核对材料，不是常驻提示。
