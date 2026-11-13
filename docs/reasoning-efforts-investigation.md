# `reasoningEfforts` 写入后模型页不显示档位 — 宿主源码调查

- 日期：2026-11-13
- 调查对象：DSH 宿主 `@deepseek-ai/dsh` **0.2.2-rc.1**（运行中的 `dsh web`，包布局 `/opt/node24/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`）
- 交叉核对：`dsh-llm-pi-ai` 0.2.2-rc.2 / 0.2.2-rc.3 的 `resolveModelReasoning`、`reasoningInfo` 与 0.2.2-rc.1 相同
- 范围：只读调查；未修改 `src/` 下任何文件

## 0. 结论（先给答案）

**A —— ModelPilot 应自动写入模型级 `reasoningEfforts`；不存在需要用户去别处打开的「路由级启用推理」开关。**

`pi-ai` 路由没有「启用推理」的布尔开关。模型选择器显示的档位来自宿主的 **模型目录（model catalog）**，其
`model.reasoning` 最终由 `providers.<id>.models[].reasoningEfforts`（或 `modelOverrides.<id>.reasoningEfforts`）
解析而来；路由级 `reasoning` 只是「会话尚未选档时采用的默认档」，不参与启用/禁用，也不是必需的。
因此 ModelPilot 不需要写任何额外的路由级开关，继续把用户勾选的档位投影为模型级 `reasoningEfforts` 即可。

> 如果问题实际指的是 **设置 → 模型** 页面上的「推理等级」编辑器：那是另一个 UI 面，且只对手写
> （`declared === true`）的 `pi-ai` 路由渲染，并嵌在该模型的「模型选项」里；这不是路由级推理开关。
> 详见 §4。

---

## 1. 问题 1：模型选择器渲染档位时读的是哪个字段？

### 1.1 调用链（从配置到菜单）

```
providers.<route>.models[].reasoningEfforts
        │  （或 modelOverrides.<model>.reasoningEfforts）
        ▼
dsh-llm-pi-ai: resolveModelReasoning()  →  { reasoning: true, thinkingLevelMap }
        ▼
dsh-llm-pi-ai: reasoningInfo()          →  { reasoning: { efforts: [...], defaultEffort? } }
        ▼
dsh-llm: resolveModelInfo() / normalizeModelInfo()
        ▼
dsh-api-session-controller: buildModelCatalog()  →  session.modelCatalog()
        ▼
dsh-client-ui-model-selection: ModelCatalogDirectory.load()
        → this.reasoning.set([provider, model], model.reasoning)
        ▼
ModelSelect: effortChoices = reasoning.efforts.map(...)
```

**模型选择器不直接读 `cordis.patch.yml`，也不直接读 `providers.*`。** 它读的是宿主返回的
`model.reasoning`；该对象在 `pi-ai` 适配器里由模型级 `reasoningEfforts` 解析出来。

### 1.2 源码位置与关键片段

#### ① 选择器从 Host catalog 取 `model.reasoning`

`@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:721-729`：

```js
reasoning = new Map();
reasoningFor(selection) {
    return this.reasoning.get(JSON.stringify([selection.provider, selection.model]));
}
```

`.../client.js:752-755`：

```js
const operation = this.ctx.remote.session.modelCatalog().then((response) => {
    if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
    if (generation === this.generation) {
        for (const group of response.value.groups)
            for (const model of group.models)
                this.reasoning.set(JSON.stringify([group.id, model.id]), model.reasoning);
```

菜单项直接来自该对象（`.../client.js:1220-1231`）：

```js
const reasoning = currentChoice?.model.reasoning;
const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort;
...
const effortChoices = (0, react.useMemo)(() => reasoning === void 0 ? [] : [
    ...reasoning.defaultEffort === void 0
        ? [{ key: "provider-default", effort: void 0, label: t("effort.providerDefault") }]
        : [],
    ...reasoning.efforts.map((effort) => ({ key: `effort:${effort.id}`, effort: effort.id, label: effort.name }))
], [reasoning, t]);
```

没有 `reasoning` 时菜单为空，界面明确显示（`.../client.js:1765`）：

```js
"empty.efforts": "当前模型未提供推理等级。"
```

#### ② Host catalog 由 `resolveModelInfo` 组装

`@deepseek-ai/dsh-api-session-controller/lib/index.js:473-495`：

```js
async function buildModelCatalog(ctx, defaultSelection = ...) {
    const providers = ctx.llm.listProviders();
    const catalog = await Promise.all(providers.map(async (provider) => {
        try {
            const models = await ctx.llm.listModels(provider.id);
            const entries = await Promise.all(models.map(async (model) => {
                const resolved = await ctx.llm.resolveModelInfo(provider.id, model.id);
                const reasoning = resolved.reasoning === void 0 ? void 0 : {
                    efforts: resolved.reasoning.efforts.map(...),
                    ...resolved.reasoning.defaultEffort === void 0 ? {} : { defaultEffort: resolved.reasoning.defaultEffort }
                };
                return { id: model.id, name: model.name, ...reasoning === void 0 ? {} : { reasoning }, ... };
            }));
            return { kind: "group", group: { id: provider.id, name: provider.name, models: entries } };
        } catch (error) { ... }
    }));
}
```

`.../index.js:3951-3953` 是浏览器调用的 remote 方法：

```js
modelCatalog() {
    return buildModelCatalog(this.ctx);
}
```

#### ③ `pi-ai` 从 `reasoningEfforts` 解析出模型能力

`@deepseek-ai/dsh-llm-pi-ai/lib/index.js:586-608`：

```js
function resolveModelReasoning(provider, entry, base) {
    const efforts = entry.reasoningEfforts;
    if (efforts === void 0) return { reasoning: base?.reasoning ?? false };
    if (efforts === false) return { reasoning: false };
    ...
    const map = {};
    for (const level of THINKING_LEVELS) {
        const wire = efforts[level];
        if (wire === void 0) map[level] = null;       // 未声明的档位 → 固定为不支持
        else if (wire !== null) map[level] = wire;
    }
    return { reasoning: true, thinkingLevelMap: map };
}
```

`.../index.js:1831-1839` 把它转成目录里的 `reasoning.efforts`：

```js
function reasoningInfo(model, defaultLevel) {
    if (!model.reasoning) return {};
    return { reasoning: {
        efforts: getSupportedThinkingLevels(model).map((level) => ({
            id: ReasoningEffortId(level),
            name: `${level.charAt(0).toUpperCase()}${level.slice(1)}`
        })),
        ...defaultLevel === void 0 ? {} : { defaultEffort: ReasoningEffortId(defaultLevel) }
    } };
}
```

`.../index.js:1951-1965` 是适配器的 `modelInfo`：

```js
modelInfo(snapshot, provider, model) {
    const profile = this.profileOf(snapshot, provider);
    const resolvedModel = this.modelOf(snapshot, provider, model);
    const defaultLevel = describableReasoningLevel(resolvedModel, profile.reasoning);
    ...
    return {
        provider, id: model, name: resolvedModel.name,
        ...
        ...reasoningInfo(resolvedModel, defaultLevel),
        ...
    };
}
```

`.../index.js:1034-1041` 是字段的 schema；`reasoningEfforts` 明确写在 `models` 条目和 `modelOverrides` 条目共用的
`modelFields` 上：

```js
const reasoningEfforts = z.dict(z.union([z.string(), z.const(null)]), z.union(THINKING_LEVELS));
const modelFields = {
    name: z.string(),
    contextWindow: z.number().step(1).min(1),
    maxTokens: z.number().step(1).min(1),
    input: z.array(z.union(MODALITIES)),
    reasoningEfforts: z.union([z.const(false), reasoningEfforts]),
    compat: compatProfile
};
```

`.../index.js:657-678` 说明 `models` 与 `modelOverrides` 两条通道如何进入解析；
`.../index.js:710` 在解析每个模型时合并 `resolveModelReasoning(...)`：

```js
...resolveModelReasoning(provider, entry, base),
...resolveModelCompat(...)
```

#### ④ 核心层校验并透传 `reasoning`

`@deepseek-ai/dsh-llm/lib/index.js:2147-2167`：

```js
const reasoning = resolved.reasoning;
if (reasoning === void 0) return info;
if (reasoning.efforts.length === 0) throw new LlmError(..., "INVALID_MODEL_REASONING");
...
return {
    ...info,
    reasoning: { efforts, ...reasoning.defaultEffort === void 0 ? {} : { defaultEffort: reasoning.defaultEffort } }
};
```

### 1.3 问题 1 的答案

> **读的是 Host catalog 里的 `model.reasoning`（`reasoning.efforts` / `defaultEffort`），不是路由级字段。**
> 对 `pi-ai`，该对象由 `providers.<id>.models[].reasoningEfforts`（或 `modelOverrides.<id>.reasoningEfforts`）
> 经 `resolveModelReasoning()` → `reasoningInfo()` 生成。对手写模型（已安装 catalog 未描述该 id），
> `providers.<id>.models[].reasoningEfforts` 是唯一数据源；内置 catalog 模型未声明 `reasoningEfforts` 时，
> 继承已安装 catalog 的 `reasoning`（`resolveModelReasoning` 的 `base?.reasoning` 分支，`lib/index.js:588`）。

---

## 2. 问题 2：是否存在「路由级启用推理」的开关？

### 2.1 `pi-ai`：不存在启用开关

`pi-ai` 的 profile 里确实有一个路由级字段 `reasoning`，但它**不是启用开关**：

`@deepseek-ai/dsh-llm-pi-ai/lib/index.js:1062`：

```js
reasoning: z.union(THINKING_LEVELS),
```

它只在 `modelInfo` 里作为「默认档」传给 `describableReasoningLevel`：

`.../index.js:1951-1955`：

```js
modelInfo(snapshot, provider, model) {
    const profile = this.profileOf(snapshot, provider);
    const resolvedModel = this.modelOf(snapshot, provider, model);
    const defaultLevel = describableReasoningLevel(resolvedModel, profile.reasoning);
    ...
}
```

而 `reasoningInfo` 是否产出档位，只取决于 **模型**（`model.reasoning`），不取决于路由 `reasoning`：

`.../index.js:1831-1833`：

```js
function reasoningInfo(model, defaultLevel) {
    if (!model.reasoning) return {};
    return { reasoning: { efforts: ... } };
}
```

- 字段名：`providers.<route>.reasoning`
- 默认值：**没有默认值**（schema 未 `.default(...)`，`resolveProfiles` 原样保留；`profile.reasoning` 为 `undefined`）
- 作用：仅当会话/请求没有显式档位时，决定默认选中的档位；**不控制档位是否可选**
- 结论：**不存在**路由级「启用推理」开关；写它既不能打开档位，也不是必需的

DSH 官方文档同样把它定义为「会话尚未选择等级时采用的等级」，而不是开关
（0.2.2-rc.3 发布包 `docs/user/guide/providers.zh.md:159`；本机安装包未附带 `docs/`，见 §7）：

> 路由的 `reasoning` 是会话尚未选择等级时采用的等级；在选择器中选定某个等级后，它会与模型一起保存为新会话的默认值。

### 2.2 `deepseek`：存在 `thinking` 开关（另一个方言）

只有 `llm-deepseek` 适配器有真正的路由级启用/禁用字段：

`@deepseek-ai/dsh-llm-deepseek/lib/index.js:322-328`：

```js
thinking: z.union(["enabled", "disabled"]).volatile(),
reasoningEffort: z.union(["off", "low", "high", "max"]).volatile(),
```

- 字段名：`thinking`
- 取值：`"enabled" | "disabled"`
- 默认值：**未设置即视为 `enabled`**（`modelInfo` 仅在 `thinking === "disabled"` 时降为只提供 `off`；见
  `.../dsh-llm-deepseek/lib/index.js:539-545`）
- 请求侧默认档：`options.reasoningEffort ?? connection.defaults.reasoningEffort ?? (thinking === "disabled" ? "off" : "high")`
  （`.../index.js:1720`）；实际发送 `thinking: { type: effort === "off" ? "disabled" : "enabled" }`（`:1733`）

`deepseek` 的模型级条目**没有** `reasoningEfforts` 字典；其档位集合是固定的 `off/low/high/max`。
因此 `reasoningEfforts` 与 `deepseek` 是不同方言，不能混写（本仓库既有设计也明确拒绝这种跨方言映射）。

### 2.3 问题 2 的答案

> **`pi-ai`：不存在路由级启用推理开关；路由级 `reasoning` 只是可选默认档（无默认值），不控制档位显示。**
> **`deepseek`：存在 `thinking: "enabled" | "disabled"`，默认 `enabled`；但这是 DeepSeek 适配器的路由级开关，
> 不是 ModelPilot 当前 `pi-ai` 投影要写的字段。**

---

## 3. 问题 3：ModelPilot 应该一并写入，还是提示用户？

### 3.1 结论：A

**A —— ModelPilot 应自动写入模型级 `reasoningEfforts`。不存在需要用户去别处打开的额外开关。**

理由：

1. 选择器要显示档位，只需要目标模型的 `model.reasoning` 存在；对 `pi-ai`，这只由模型级
   `reasoningEfforts` 决定（§1）。
2. 路由级 `reasoning` 只是默认档，不决定档位集合（§2.1）。
3. ModelPilot 当前的 `projectPiAi()` 已经生成并写入模型级 `reasoningEfforts`
   （`src/core/pi-ai-projection.js:63-91, 117-119`；`src/core/domain.js:64-89`），写入路径为
   `["providers", <route>, "models", <index>]`，由宿主 `settings.mutate` 落到 profile patch
   （`@deepseek-ai/dsh-settings/lib/index.js:488-499`）。
4. 因此不需要写 `providers.<route>.reasoning`；写了反而会给该路由所有模型设一个默认档，
   超出用户逐模型选择的语义。

**不要**选 B/C：没有「去别处打开的开关」，也没有当前版本不支持的问题。若实际现象是设置页的编辑器不可见，
那是 §4 的 UI 面/路由类型问题，不是缺少推理开关。

### 3.2 如果用户说的是「设置 → 模型」页面

`dsh-client-ui-settings-models` 的「推理等级」编辑器只在 **手写路由** 上渲染：

`@deepseek-ai/dsh-client-ui-settings-models/lib/client.js:2024-2029`：

```js
const reasoningLevels = (0, react.useMemo)(
    () => layout === "pi-ai" && props.declared === true ? reasoningLevelChoices(namespace, schema) : [],
    [layout, props.declared, namespace, schema]
);
```

`props.declared` 来自 `dsh-llm-pi-ai` 的目录项：只有**不在已安装 catalog 中**的路由才是
`declared: true`（`@deepseek-ai/dsh-llm-pi-ai/lib/index.js:2883-2899`，`declared: installed === void 0`）。
此外编辑器位于该模型的「模型选项」内，不在提供商卡片上；源码注释明确说明这是按模型能力设计的：

`.../dsh-client-ui-settings-models/lib/client.js:1655-1660`：

```js
* There is deliberately no provider-scoped reasoning-effort control, here or
* on the editor card: effort is a per-MODEL capability, and the models under
* one provider disagree about it, ...
* Each model row of a hand-declared route declares its own `reasoningEfforts`
* instead, and the composer's model picker offers each model those levels.
```

官方文档也给出同样的定位（0.2.2-rc.3 发布包 `docs/user/guide/providers.zh.md:136,227`）：

> 手动录入的模型在添加等级之前不声明任何等级，因此模型菜单里不会出现推理等级项……
> 如果是自定义模型 API 提供商，在该模型的**模型选项**中打开**推理等级**；其他提供商在
> `cordis.patch.yml` 中给该模型加上 `reasoningEfforts`。

**这不改变 §3.1 的 A 结论**：设置页的 `declared` 条件不是「路由级启用推理开关」，选择器仍按模型级
`reasoningEfforts` 显示档位。

---

## 4. 为什么「写入后仍然看不到」——按源码可判定的原因

模型选择器的档位菜单只有两种状态：`reasoning !== undefined` 时显示
`reasoning.efforts`；否则显示「当前模型未提供推理等级」。对 `pi-ai`，`reasoning` 为空的唯一原因是
**该 provider/model 在 Host catalog 中的模型条目没有解析出 `reasoning: true`**。按源码，可归结为：

1. **写入没有落到当前 Host 的生效 profile**
   - `settings.mutate` 写的是当前 profile 的 patch（`@deepseek-ai/dsh-settings/lib/index.js:488-499`）；
     如果 ModelPilot 连的是另一个 profile / 另一个 DSH 实例，目标实例的 catalog 不会变化。
   - 选择器在 `settings/document-updated` 时会刷新（`@deepseek-ai/dsh-client-ui-model-selection/lib/client.js:1012-1013`），
     但跨实例写入不会触发目标实例的事件。

2. **写到了 `models` 与 `modelOverrides` 的错误通道**
   - `pi-ai` 的 `resolveRouteModels()` 明确拒绝同时使用两者（`@deepseek-ai/dsh-llm-pi-ai/lib/index.js:667`：
     “sets modelOverrides ... beside a models list”）。
   - 带 `modelOverrides` 的路由，`reasoningEfforts` 必须写在
     `providers.<route>.modelOverrides.<model>.reasoningEfforts`，而不是 `models[]`；否则不会成为该模型的
     `entry.reasoningEfforts`（`.../index.js:661-678`）。
   - ModelPilot 当前投影只走 `models`，遇到 `modelOverrides` 会拒绝整个操作
     （`src/core/pi-ai-projection.js:33-40`），不会静默写错。

3. **模型本身没有进入当前路由的可用目录**
   - 若 `models` 条目校验失败，`resolveRouteModels` 会把它从 `serviceableModels` 中剔除
     （`@deepseek-ai/dsh-llm-pi-ai/lib/index.js:715-726`）；选择器不会为该模型提供档位。
   - 若整个 provider 的 `resolveModelInfo` 抛错，`buildModelCatalog` 返回的是 provider failure
     （`@deepseek-ai/dsh-api-session-controller/lib/index.js:504-...`），该组模型都不会出现。

4. **用户看的是设置页，不是选择器**
   - 设置页的编辑器受 `declared === true` 且位于「模型选项」内（§3.2）；内置提供商的路由不会渲染该编辑器，
     即使选择器已经能显示档位。

> 在本机当前生效配置（`~/.dsh/profiles/superagent/cordis.patch.yml`）里，`newapi-chat` 的
> `models[0].reasoningEfforts` 为 `{off: null, low, medium, high, xhigh, max}`；DSH 0.2.2-rc.1 的模型选择器
> 实际显示 `Default / Off / Low / Medium / High / Xhigh / Max`，设置页的「模型选项」也显示对应
> 6 行（`off` 的 API 参数值为空，其余为同名值）。这证明：**有效的模型级 `reasoningEfforts` 不需要任何
> 路由级开关就能让选择器出现档位**。因此，报告中的「看不到」不能归因于缺少路由级启用推理开关；应按
> 上述 1–4 检查写入目标/生效配置/查看的界面。

---

## 5. 复现与验证记录

### 5.1 静态验证

- `dsh-client-ui-model-selection` 的 `reasoningFor` / `effortChoices`：只读 `model.reasoning`
  （`lib/client.js:721-729, 752-755, 1220-1231`）。
- `dsh-api-session-controller.buildModelCatalog`：逐个模型调用 `ctx.llm.resolveModelInfo` 并透传
  `reasoning`（`lib/index.js:473-495`）。
- `dsh-llm-pi-ai.resolveModelReasoning`：`reasoningEfforts` → `{reasoning: true, thinkingLevelMap}`
  （`lib/index.js:586-608`）；`reasoningInfo`：`thinkingLevelMap` → `efforts`
  （`lib/index.js:1831-1839`）。
- `dsh-llm-pi-ai` schema：`reasoningEfforts` 在 `modelFields` 上（`lib/index.js:1034-1041`）；
  `reasoning` 只是路由级可选默认档（`lib/index.js:1062`）。

### 5.2 运行时验证（本机 DSH 0.2.2-rc.1）

- 打开 `http://127.0.0.1:3082` 的模型选择器 → 「推理等级」；对 `jxf/dsv4.1-flash` 实际列出
  `Default / Off / Low / Medium / High / Xhigh / Max`。
- 打开 设置 → 模型 → `newapi-chat` → 自定义设置 → 模型选项 → 推理等级；实际显示
  `off / low / medium / high / xhigh / max` 六行，`off` 的 API 参数值为空，其余为同名值。
- 该验证使用的 `reasoningEfforts` 正是 `providers.newapi-chat.models[0].reasoningEfforts`，没有路由级
  `reasoning` 字段。

### 5.3 测试

```text
node --test test/**/*.test.mjs
# tests 105, pass 99, fail 0, skipped 6
```

`src/` 未改动；文档改动不影响现有测试。6 个 skip 是 0.2.0/0.2.1 版本矩阵（本机未安装对应版本），
不是失败。验收文本中的「98 个测试」是早期计数；当前 main（含 PR #6）的用例数为 105。

---

## 6. 验收对照

| 验收项 | 结果 |
| --- | --- |
| `docs/reasoning-efforts-investigation.md` 已创建 | ✅ |
| 三个问题都有答案，每条标注源码位置 | ✅ §1.2 / §2.1–2.2 / §3.1 |
| 结论明确为 A / B / C 之一 | ✅ **A** |
| 不改动 `src/` | ✅ 仅新增本文档 |
| 现有测试仍通过 | ✅ 99 pass / 0 fail / 6 skipped（105 total） |

---

## 7. 附：路径说明

本文中的宿主路径省略了公共前缀：

```text
/opt/node24/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/
```

例如 `dsh-llm-pi-ai/lib/index.js` 指：

```text
/opt/node24/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js
```

DSH 官方文档引用自 **0.2.2-rc.3 发布包**的 `docs/user/guide/providers.zh.md`（本机安装的
`@deepseek-ai/dsh` 包只带 `lib/`、`types/` 等运行文件，不附带 `docs/`；文档内容与源码中的
`reasoning` 语义一致）。
