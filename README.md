# 提示词工具 (Prompt Helper)

一个 Chrome 扩展（Manifest V3），让你在 Gemini 网页版快速插入预设提示词，并精准定位光标到占位符位置。

## 特性

- 浮动按钮一键唤出提示词面板
- 在当前光标位置插入，不覆盖已有内容
- 支持占位符自动定位光标（默认 `【光标】`，可自定义）
- 浮动按钮支持拖拽，位置自动持久化
- 提示词的增删改查，数据本地存储
- 浅色 / 深色模式自适应
- 支持 `prefers-reduced-motion`，键盘可访问（Esc 关闭、Tab 焦点循环）

## 安装

本扩展暂未上架 Chrome Web Store，需要手动加载：

1. 克隆或下载本仓库
2. 打开 Chrome，访问 `chrome://extensions`
3. 开启右上角的 **开发者模式**
4. 点击 **加载已解压的扩展程序**
5. 选择本仓库中的 `prompt-helper/` 目录
6. 打开 [Gemini](https://gemini.google.com/)，右下角应出现 ✦ 浮动按钮

## 使用

1. 在 Gemini 页面点击右下角 ✦ 按钮，打开提示词面板
2. 点击 `+` 添加提示词，填写名称和内容
3. 内容中可使用 `【光标】` 标记希望插入后光标停留的位置
4. 在面板中点击某条提示词，会插入到 Gemini 输入框的当前光标位置；占位符会被移除并把光标定位到该位置

### 占位符

- 默认占位符：`【光标】`
- 兼容旧占位符：`[光标]`
- 可自定义任意字符串作为占位符，会自动加入历史
- 历史项右键可删除

## 技术栈

- Chrome Extension Manifest V3
- 原生 JavaScript（content script，无构建步骤）
- 原生 CSS3（无框架）

## 目录结构

```text
prompt-helper/
├── manifest.json        # 扩展清单
├── content.js           # 核心逻辑（存储 / 面板 / 弹窗 / 注入 / 光标）
├── content.css          # 视觉系统与组件样式
├── icons/               # 扩展图标（16 / 48 / 128）
├── CLAUDE.md            # 开发者文档
└── TEST_CHECKLIST.md    # 回归测试清单
```

## 数据结构

数据存储于 `chrome.storage.local`：

| Key | 说明 |
|---|---|
| `ph_prompts` | 提示词列表 |
| `ph_placeholder_history` | 占位符历史 |
| `ph_button_pos` | 浮动按钮位置 |

单条提示词：
```json
{
  "id": "timestamp+random",
  "name": "用户自定义名称",
  "prompt": "提示词内容，可含占位符",
  "placeholder": "【光标】"
}
```

## 开发

无构建步骤，本地修改 → 重载即可：
1. 修改 `prompt-helper/content.js` 或 `content.css`
2. 在 `chrome://extensions` 中点击本扩展的"重新加载"
3. **刷新 Gemini 页面**（必须，否则页面内仍在运行旧 content script）
4. 回归验证可参考 `prompt-helper/TEST_CHECKLIST.md`

## License

[MIT](LICENSE)
