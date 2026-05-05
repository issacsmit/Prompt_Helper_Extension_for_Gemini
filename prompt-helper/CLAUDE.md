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
- 悬浮按钮支持拖拽并持久化位置。
- 面板根据按钮位置动态计算显示方位。

### 2.3 注入与光标
- 定位 Gemini 输入区（`aria-label` 优先，`.ql-editor[contenteditable="true"]` 回退）。
- 注入后触发 `input` + `keyup`，确保 Gemini 感知内容变化。
- 支持默认占位符、旧占位符、自定义占位符及回退匹配。
- 光标定位基于 DOM 遍历与偏移计算，支持多段落场景。

### 2.4 UI/可用性
- 统一视觉系统（浅色/深色模式）。
- 删除态视觉已弱化（可识别但不刺眼）。
- 支持 `prefers-reduced-motion`（减少动画）。
- 弹窗与确认框支持 `Esc` 关闭、Tab 焦点循环、关闭后焦点返回。

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
4. 注入后必须触发 `input` 与 `keyup`。

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
  "ph_button_pos": { "left": 100, "top": 500 }
}
```

---

## 5. 目录说明
```text
prompt-helper/
├── manifest.json        # 扩展清单
├── content.js           # 核心逻辑（存储/面板/弹窗/注入/光标）
├── content.css          # 视觉系统与组件样式（含 dark/reduced-motion）
├── TEST_CHECKLIST.md    # 回归验收清单
└── icons/               # 扩展图标
```

---

## 6. 回归验收（每次改动后）
请按 `TEST_CHECKLIST.md` 执行，重点看：
- CRUD 是否正常；
- 占位符与光标定位是否正确；
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
