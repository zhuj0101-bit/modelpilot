# 多模板遗留缺陷修复 — Before / After 视觉证据（工单 #43）

- **基线（Before）**：`1e762d9`（`feat: 模板支持多份增删改与选用（工单 #42） (#87)`，
  工单 #43 写的仓库基线）
- **变更（After）**：本分支 `agent/template-followup-fixes-6fadda432f60` 的头提交
  （见 PR）；截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- **环境**：Google Chrome 152.0.7977.64 headless，视口 1440×913，设备像素比 1，
  浅色 / 深色两套宿主 `--dsw-*` token
- **场景**：设置 → ModelPilot，路由 `preview-chat`（`models: []`，可写）；
  - 批量选择器场景：点「拉取」→ 端点返回 3 个模型 → 选择器自动打开；
  - 模板条场景：新增模型表单（库里有模板 / 空库 / 满库 20 份）。
- **对照的公平性**：before / after 两个页面只有 `lib/client.js` 不同 —— 基线装的是
  `1e762d9` 的打包产物，变更装的是本分支重建的产物；夹具、`localStorage` 种子、
  模型数据、主题、视口与滚动位置完全一致
- **截图不是 mockup**：页面加载仓库**真实打包产物** `lib/client.js`，由与单测共用的
  最小 React 渲染器渲染真实 `Workbench` 组件树，宿主 token 与 `configForms` /
  `remote` 快照由夹具提供。`baseURL` 是 `https://preview.invalid/v1` 占位地址，
  没有真实凭据或私人内容
- **图像形式**：`compare-*.png` 是「左 Before / 右 After」并排对照，由两张同尺寸
  截图的同一区域裁切后拼接；`after-*.png` 是变更后整页，便于看上下文

## 缺陷 1：批量写入用的模板现在说清楚了

| 文件 | 场景 |
| --- | --- |
| `compare-picker-empty-light.png` | 浅色、库为空、未选过模板：左「未设置默认模板，将使用内置默认值」（与真实写入值不符）；右在勾选区上方写「将以内置「基础对话」的参数写入：上下文 128000（128K） · 输出 8192（8K） · text · off,low,medium,high（内置预设）」 |
| `compare-picker-long-light.png` / `compare-picker-long-dark.png` | 浅色 / 深色、在新增表单选中内置「长文档」后打开选择器：左边没有任何模板信息（用户不知道 20 个模型会被写成 1M 上下文）；右边写「将以「长文档」的参数写入：上下文 1000000（1M） · 输出 8192（8K） · text · off,low,medium,high（内置预设）」 |

- 摘要位于勾选区上方（「全选」行之前），`role="note"`；内置预设额外标「内置预设」，
  库为空时前缀写「内置」——用户能看出这不是自己为此配置过的模板。
- 写入值核对：点「确定（2）」后待写入区块展示「窗口 1000000 · 输出上限 8192 …」，
  写入后 `lastOps` 里两条模型的 `contextWindow` 都是 1000000、`maxTokens` 都是 8192，
  与摘要里的数字一致（`test/client/batch-template-visibility.test.mjs`）。

## 缺陷 5：摘要反映表单是否被改过

| 文件 | 场景 |
| --- | --- |
| `compare-summary-modified-light.png` | 浅色、选中用户模板「我的 128K」、把表单的上下文窗口改成 96000：左摘要仍只写「模板：我的 128K · 上下文 128000（128K） · …」（容易被读成「现在要存的就是 128000」）；右在摘要后追加「（表单已改动，与模板不同）」，表单里的 96000 与摘要里的 128000 不再互相矛盾 |

- 表单值与模板一致时这句不出现（改回原值后消失），保持原来的简洁。

## 缺陷 4：库满 20 份时「存为新模板」禁用

| 文件 | 场景 |
| --- | --- |
| `compare-full-library-light.png` | 浅色、库里 20 份「模板 N」：左「存为新模板」可点（点开才提示「最多保存 20 份模板」）；右按钮禁用（`s.btnDisabled` 的浅化 + `not-allowed` 光标），`title` 为「已保存 20 份，先删除一份再新增」。管理面板里删掉一份后按钮恢复可点（测试断言） |

- 满额时的 toast 分支保留：键盘 / 程序触发时仍有文字反馈。

## 缺陷 3：弹窗焦点管理（DOM 事实，不是视觉差异）

焦点位置在截图上不可见，因此这一项用真实 DOM 读数说明（同一个页面夹具，基线与变更后
各跑一次；读数来自 `test/client/template-dialog-focus.test.mjs` 的同一套探针）：

| 读数 | 基线 `1e762d9` | 变更后 |
| --- | --- | --- |
| 打开「存为新模板」后的 `document.activeElement` | `BODY` | `模板名称` 输入框 |
| 「存为新模板」名称输入的 `maxlength` | 无属性 | `20` |
| 在最后一个可聚焦元素上按 Tab | 不被拦截（`prevented: false`） | 圈回第一个（`prevented: true`） |
| 在第一个可聚焦元素上按 Shift+Tab | 不被拦截 | 圈到最后一个 |
| 焦点在背后表单上时按 Tab | 仍停在对话框外（`inside: false`） | 拉回对话框内（`inside: true`） |
| 关闭「存为新模板」后的 `document.activeElement` | `BODY` | `存为新模板` 按钮 |
| 打开「模板管理」后的焦点 | `BODY` | 第一行的 `改名 我的 128K` 按钮 |
| 点「改名」后的焦点 | `BODY` | `重命名模板输入`（`maxlength=20`） |
| 关闭「模板管理」后的焦点 | `BODY` | `管理模板` 按钮 |

## 缺陷 6：Esc 分层（行为，不是视觉差异）

- 展开删除 / 覆盖的二次确认后按 Esc：确认收合、面板仍开着；再按一次才关面板。
- 由 `test/client/template-picker.test.mjs` 在真实 DOM 里断言（`escape` 场景），
  静态截图看不出差别，因此不单独截图。

## 覆盖范围与边界

- 未覆盖：缺陷 2（选择持久化）没有视觉差异 —— 用 `template-picker.test.mjs` 的
  「重新打开」场景断言（选内置「长文档」后重挂载，下拉与摘要都停在长文档）。
- 截图渲染的是 Workbench 组件树（与既有 `docs/evidence/*` 同一方式），不是完整
  DSH 设置外壳：被修改的控件、宿主 token 与交互都是真实产物，页面没有侧栏 /
  设置弹窗容器。
- 批量写入时按模型逐个选模板、模板导入导出、跨设备同步不在本单范围（未实现）。

## 验证

- `node --test "test/**/*.test.mjs"`：见 PR 描述（0 失败）。
- `node scripts/build-client.mjs` 重建 `lib/client.js`；`node scripts/verify-package.mjs .`
  18/18 PASS。
- 未新增依赖，`package.json` 未改。
