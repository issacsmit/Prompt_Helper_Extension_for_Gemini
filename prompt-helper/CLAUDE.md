# Prompt Helper（提示词工具）项目说明

## 1. 项目目标
Prompt Helper 是一个 Chrome 扩展（Manifest V3），用于在 Gemini 网页版中：
- 快速插入预设提示词；
- 支持占位符定位光标；
- 保持“在当前光标处插入”而非覆盖全文。

核心定位：**提升提示词复用效率，不改变 Gemini 原生工作流**。

---

## 2. 当前功能（稳定）

### 2.1 提示词管理
- 提示词增删改查（名称、内容、占位符）。
- 数据持久化到 `chrome.storage.local`。

### 2.2 面板与交互
- 悬浮按钮打开/关闭面板。
- 悬浮按钮支持拖拽并持久化位置；加载、SPA 重挂与窗口缩放后位置夹取回可视范围。
- 面板根据按钮位置动态计算显示方位。

### 2.3 提示词排序
- 每条词条左侧有六点拖动手柄（SVG，`currentColor`）。
- 细指针可从手柄或词条正文发起拖动；触屏只允许从手柄拖动（手柄 `touch-action: none`）。
- 拖动超过 6px 阈值进入排序态：被拖卡片 `translate3d` 跟手，其余卡片按步距整体位移；列表边缘自动滚动；松手后有回弹动画（尊重 reduced-motion）。
- 从正文发起的拖动会抑制随后的插入点击；从手柄发起不会。
- 焦点在手柄上时 ↑/↓ 方向键移动顺序，焦点跟随。
- 排序走乐观更新：先改内存与 DOM，`savePrompts` 失败则回滚顺序并提示「调整顺序失败」。写入进行中不允许再次排序。

### 2.4 注入与光标
- 定位 Gemini 输入区（`aria-label` 优先，`.ql-editor[contenteditable="true"]` 回退）。
- 注入后触发 `input` + `keyup`，确保 Gemini 感知内容变化；不自动发送。
- 占位符优先级：当前自定义光标 → `【光标】`/`[光标]` → 第一处 `【…】`（可关） → 历史兼容占位符。未实际出现的自定义光标不会阻断后续规则。
- 光标标记被移除后折叠光标；通用 `【主题】` 留在正文中并以选区覆盖整段。
- 光标定位基于 DOM 遍历与偏移计算，支持多段落场景。

### 2.5 UI/可用性
- 统一视觉系统（浅色/深色模式）。
- 主题判定：`html.dark` / `html[data-theme="dark"]` 显式暗色 → 系统偏好回退（`html:not(.light):not([data-theme="light"])` 内的 media query）；宿主显式声明浅色时不会被系统暗色覆盖。
- 删除态视觉已弱化（可识别但不刺眼）。
- 支持 `prefers-reduced-motion`（减少动画）。
- 弹窗与确认框支持 `Esc` 关闭、Tab 焦点循环、关闭后焦点返回；弹窗打开时 Esc 不再连带关闭面板。
- 触屏 / 粗指针下卡片编辑和删除始终可见。

### 2.6 插入设置、状态与跨标签
- 面板标题栏 **插入设置** 控制 `ph_auto_select_bracket_placeholder`（缺省为开）。
- 插入设置内含「检查更新」区块：仅在点击按钮时通过 `update-check.js` 查询 GitHub latest Release（5s 超时，失败静默降级为「暂时无法检查更新」+ 发布页链接）；版本比较按点分数字逐段比较。
- 找不到 Gemini 输入框、保存/设置失败时，在浮动按钮旁显示可见状态。
- `chrome.storage.onChanged` 同步列表、历史和自动选中开关；写入进行中会推迟外部同步。
- SPA 单例恢复：`MutationObserver` 监听文档子树（rAF 去抖），Gemini 重建 DOM 后若浮动按钮/面板被移除会自动重挂载。打开状态记在内存里（不依赖已被卸下的节点）；重挂前清 `listDrag`、overlay 和浮钮拖拽态。`window` 级浮钮监听只绑一次。回调先检查 `chrome.runtime.id`，扩展失效时静默退出。
- 粗指针下卡片编辑/删除始终可见，激活它们不会插入提示词。

---

## 3. 技术与约束

### 3.1 技术栈
- Chrome Extension Manifest V3
- Vanilla JavaScript（content script）
- CSS3（无框架）

### 3.2 关键约束（必须遵守）
1. 不直接依赖页面内部 Quill 实例（无法可靠访问）。
2. 仅通过标准 DOM/Selection/Range API 操作输入区。
3. 任何功能改动必须保持存储结构兼容：
   - `ph_prompts`
   - `ph_placeholder_history`
   - `ph_button_pos`
   - `ph_auto_select_bracket_placeholder`（可新增；缺省视为开启）
4. 注入后必须触发 `input` 与 `keyup`。
5. 占位符匹配必须走 `prompt-engine.js` 的 shipped `prepareInsertion`，插入必须走 `gemini-editor.js` 的 `insertPreparedText`。
6. content script 加载顺序固定：constants → prompt-engine → storage → gemini-editor → update-check → content；新增运行模块须同步更新 manifest、static-guard 测试。
7. 平时不联网；唯一允许的网络请求是用户点击「检查更新」时对 `https://api.github.com/repos/issacsmit/Prompt_Helper_Extension/releases/latest` 的只读查询。

---

## 4. 数据结构

### 4.1 单条提示词
```json
{
  "id": "timestamp+random",
  "name": "用户自定义名称",
  "prompt": "提示词内容，可含占位符",
  "placeholder": "【光标】"
}
```

### 4.2 全局配置
```json
{
  "ph_prompts": [],
  "ph_placeholder_history": ["{{cursor}}", "[[HERE]]"],
  "ph_button_pos": { "left": 100, "top": 500 },
  "ph_auto_select_bracket_placeholder": true
}
```

---

## 5. 目录说明
```text
prompt-helper/
├── manifest.json        # 扩展清单（仅 Gemini）
├── constants.js
├── prompt-engine.js     # prepareInsertion / updatePlaceholderHistory
├── storage.js           # 持久化与 onChanged
├── gemini-editor.js     # 重建输入框、选区、input/keyup
├── update-check.js      # 手动检查 GitHub Release（isNewerVersion / checkForUpdate）
├── content.js           # 面板/弹窗/插入设置/拖动排序/SPA 恢复/状态
├── content.css          # 视觉系统与组件样式（含 dark/reduced-motion/coarse pointer）
├── tests/               # node:test，直接 require shipped 模块
├── TEST_CHECKLIST.md    # 回归验收清单
└── icons/               # 扩展图标
```

---

## 6. 回归验收（每次改动后）
请按 `TEST_CHECKLIST.md` 执行，并先在 `prompt-helper/` 跑 `node --test`。重点看：
- CRUD 是否正常；
- 占位符优先级、`【…】` 选区与插入设置是否正确；
- 找不到编辑器/保存失败是否在浮钮旁可见；
- 跨标签同步是否无需刷新；
- 触屏下编辑/删除可见且不误插入；
- 拖拽位置持久化是否正常；
- 深色模式与减少动画是否生效；
- 键盘可访问性是否无回归。

---

## 7. 近期已完成优化（摘要）
- UI 视觉系统重构（轻量专业风）。
- 删除操作视觉语义优化（降低突兀感）。
- 可访问性增强（ARIA、Esc、焦点管理、Tab 焦点循环）。
- 深色模式与减少动画适配。
- 动画时长由 JS 读取 CSS Token，行为与样式保持一致。
- 文案常量集中与 DEBUG 日志开关。

---

## 8. 后续维护建议
1. 保持“功能逻辑优先稳定，UI 渐进增强”的策略。
2. 新增能力先保证数据结构兼容，再做界面扩展。
3. 每次提交前至少跑一遍 `TEST_CHECKLIST.md`。

---

## 9. 2026-05-03 维护记录：弹窗与保存防卡死

- 弹窗关闭逻辑已改为基于具体 overlay 节点实例管理，打开前会清理残留的 modal/confirm overlay，关闭时会禁用 pointer events，并防止旧关闭定时器误影响新弹窗。
- 编辑/新增提示词的保存链路已增加防重入：保存期间禁用保存与取消按钮，避免连续点击触发并发写入。
- `updatePlaceholderHistory()` 现在只负责内存更新，不再自行调用 `saveData()`；保存按钮统一执行一次持久化，避免同一次操作触发多次 `chrome.storage.local.set`。
- `saveData()` 现在会 reject `chrome.runtime.lastError`，并增加 3 秒超时兜底；保存失败时弹窗保持可操作并显示失败提示，不再表现为界面卡住。
- 删除提示词、删除占位符历史也已补充保存失败兜底，避免严格化 `saveData()` 后产生未处理异常。
- 已增加扩展上下文失效防护：旧 content script 在扩展 reload/update 后触发的 `setTimeout`、`requestAnimationFrame`、`chrome.storage` 回调会静默早退，避免出现 `Extension context invalidated`。
- 后续维护要求：任何会关闭弹窗的异步流程都必须使用 `try/catch` 或等价兜底，不能把 `closeModal()` 放在可能抛错/永久等待的异步调用之后而没有错误处理。
- 开发测试要求：在 `chrome://extensions` 中 reload/update 扩展后，必须刷新 Gemini 页面再继续测试；否则页面内仍可能运行旧 content script，上下文失效类错误不应视为业务逻辑回归。
