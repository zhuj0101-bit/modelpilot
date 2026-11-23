# 模板库（多份模板的增删改与选用）— Before / After 视觉证据（工单 #42）

- **基线**：`934f487`（`fix: 暗色主题下选中态不可辨，改为多重冗余编码（工单 #41） (#85)`，
  工单 #42 写的仓库基线）
- **变更**：本分支 `agent/multi-template-library-fd2198f6e506` 的头提交（见 PR）；
  截图在 `node scripts/build-client.mjs` 重建 `lib/client.js` 后采集
- **环境**：Google Chrome 152 headless，1440 宽视口（整页 1700 高；带弹窗的页面
  1200 高），设备像素比 1，浅色 / 深色两套宿主 token
- **场景**：设置 → ModelPilot，路由 `preview-chat`，3 条模型；展开
  `jxf/dsv4.1-pro` 的编辑表单，新增模型表单同时可见：
  - **Before**：`localStorage["modelpilot.default-template.v1"]` 里只有一份单模板
    （上下文 `128000`、输出 `8192`、`text`、`off,low,medium,high`）——即工单描述的
    「只能存一份」的现状
  - **After**：模板库 `localStorage["modelpilot.templates.v1"]` 里两份模板 ——
    「我的 128K 对话」（与基线同一组数值）与「便宜的 64K」（上下文 `64000`、输出
    `4096`、`text`、`off,low`），「最近选用」指向第一份
- **对照的公平性**：before / after 两个页面只有 `lib/client.js` 不同 —— 基线装的是
  `934f487` 的打包产物，变更装的是本分支重建的产物；夹具、模型数据、主题、视口、
  布局宽度完全一致。基线只支持一份模板，所以基线页没有第二份；两边共有的
  「我的 128K 对话」数值完全相同，摘要可直接对比
- **截图不是 mockup**：页面加载仓库**真实打包产物** `lib/client.js`，由与单测共用的
  最小 React 渲染器渲染真实 `Workbench` 组件树，宿主 `--dsw-*` token 与
  `configForms` 快照由夹具提供。没有真实凭据或私人内容；`baseURL` 是
  `https://preview.invalid/v1` 占位地址

## 模板条：Before / After

左：基线 `934f487`；右：变更后。

| 主题 | 编辑表单（模板条） | 新增模型表单（模板条） |
| --- | --- | --- |
| 浅色 | `before-after-edit-light.png` | `before-after-create-light.png` |
| 深色 | `before-after-edit-dark.png` | `before-after-create-dark.png` |

- **Before**：模板条只有一个「填入默认模板」按钮 + 一行「默认模板：上下文 128000（128K）
  · 输出 8192（8K） · text · off,low,medium,high」。新增表单把这个按钮挤在预设 chip 的同一行
  末尾，还需要一个「清除」；模板没有名字，不能选、不能改、不能删。
- **After**：「模板 [下拉] [填入] [存为新模板] [管理]」+ 独立的摘要行
  「模板：我的 128K 对话 · 上下文 128000（128K） · 输出 8192（8K） · text · off,low,medium,high」。
  下拉里是「用户模板（按库顺序）+ 分隔线 + 三份内置预设（标「内置」）」；编辑表单与
  新增表单是同一个组件，两处都能选自己的模板。
- 模板条只改表单、不写配置：截图里编辑表单仍是「改动字段：无（保存已禁用）」。

## 整页与管理面板

| 文件 | 说明 |
| --- | --- |
| `before-light.png` / `before-dark.png` | 基线整页：编辑表单只有「填入默认模板」按钮；新增表单是预设 chip + 按钮 + 摘要 + 清除 |
| `after-light.png` / `after-dark.png` | 变更后整页：编辑表单与新增表单的模板条都是选择器 + 摘要 |
| `after-light-manage.png` / `after-dark-manage.png` | 模板管理面板：两份模板，行内「改名 / 用当前值覆盖 / 删除」，底部说明「用当前值覆盖」读的是哪份表单 |
| `after-light-dialog.png` / `after-dark-dialog.png` | 「存为新模板」对话框：只有名称输入，名字「我的 1M 长文」，底部是「最多 20 个字，不能与库里的其他模板重名」 |

## 覆盖范围与边界

- 选择器 / 摘要 / 存为新模板 / 管理面板在 light、dark 两套 token 下都截图；面板与
  对话框只在变更后存在，因此没有 before 对照。
- 分组视图、模型列表、路由设置卡片与工单前一致（同一份夹具、同一批模型数据）。
- 名称重名 / 超长 / 空名字的就地报错、改名与二次确认、删除到空库的提示由
  `test/client/template-picker.test.mjs` 在真实 DOM 中断言，未逐条截图。
- 模板库是纯前端偏好：只写 `localStorage`，不进入 `configForms` / `settingsOps`
  （截图里的「改动字段：无」与测试里的 `mutations === 0` 是同一件事）。

## 验证

- `node --test "test/**/*.test.mjs"`：见 PR 描述（0 失败；7 项按既有条件跳过）。
- `node scripts/build-client.mjs` 重建 `lib/client.js`；`node scripts/verify-package.mjs .`
  18/18 PASS。
- 未新增依赖，`package.json` 未改。
