# Prompt Helper Regression Checklist

Date: __________  
Tester: __________  
Build/Version: __________

Automated suite (does **not** replace live Gemini checks): from `prompt-helper/` run `node --test` twice. All cases must pass.

## 1) Smoke
- [ ] Extension loads on `https://gemini.google.com/*`.
- [ ] Floating button is visible and clickable.
- [ ] Panel opens and closes normally.
- [ ] Panel header shows an **插入设置** control.

## 2) Prompt CRUD
- [ ] Add a prompt with name + content, save succeeds.
- [ ] Edit an existing prompt, save succeeds and list updates.
- [ ] Delete prompt path works: open confirm -> cancel does nothing -> delete removes item.
- [ ] Save failure shows a visible status near the floating button (not only console) and the form stays usable.

## 3) Placeholder + Cursor
- [ ] Default placeholder (`【光标】`) is removed on insert and cursor lands at marker position (first match only; later copies stay).
- [ ] Legacy placeholder (`[光标]`) still works when the default marker is absent.
- [ ] Custom placeholder wins over earlier `【光标】` / `[光标]` / history, is removed, and is stored in history.
- [ ] A configured custom cursor that is **not** in the body does not block later rules (`【…】` auto-select or history).
- [ ] History right-click menu: delete/cancel both behave correctly.

## 4) 【…】 auto-select and 插入设置
- [ ] Default (missing `ph_auto_select_bracket_placeholder`): inserting `请把【主题】写成【风格】。` keeps `【主题】` in the editor, selects that whole token, and leaves `【风格】` unselected.
- [ ] Typing after that insert replaces the selected `【主题】`.
- [ ] **插入设置** can turn `【…】` auto-select off. Off skips only generic `【…】` selection; `【光标】` / `[光标]` / custom cursor are unchanged.
- [ ] With auto-select off and no cursor/history marker, `【主题】` stays in the text and the caret collapses at the end.
- [ ] With auto-select off, placeholder history still matches and removes the history marker.
- [ ] The flag persists in `chrome.storage.local` as `ph_auto_select_bracket_placeholder`; another Gemini tab of this extension updates without reload.

## 5) Insertion Behavior
- [ ] Insert at current cursor position (not full overwrite).
- [ ] Multi-line content keeps expected line structure.
- [ ] `input`/`keyup` still bubble so Gemini send state updates.
- [ ] Extension does not auto-send.
- [ ] Gemini editor not found: visible status near the floating button (e.g. “未找到 Gemini 输入框”).

## 6) Floating Button + Panel Position + Status
- [ ] Drag button to a new location and refresh page.
- [ ] Button position restores correctly.
- [ ] Panel appears near button and remains in viewport.
- [ ] Status toast is anchored to the floating button (prefer above, fallback below, clamped in viewport) and follows drag/resize.

## 7) Keyboard and Accessibility
- [ ] Escape closes panel.
- [ ] Modal supports Escape close.
- [ ] Confirm dialog supports Escape close.
- [ ] 插入设置 dialog supports Escape close.
- [ ] Modal/confirm/settings Tab and Shift+Tab stay trapped inside dialog.
- [ ] Focus returns to trigger after modal/confirm/settings close.

## 8) Touch / coarse pointer card actions
- [ ] Fine pointer: edit/delete may appear on hover or `:focus-within`.
- [ ] Coarse/touch (`hover: none` / `pointer: coarse`): each card’s edit and delete stay visible and usable.
- [ ] Activating edit or delete does **not** insert the prompt.

## 9) Visual Checks
- [ ] Delete-related controls are recognizable but not overly saturated.
- [ ] Hover/active states look consistent.
- [ ] No clipped text in list items, buttons, or dialogs.

## 10) Theme / Motion
- [ ] Light mode readability and contrast are acceptable.
- [ ] Dark mode readability and contrast are acceptable.
- [ ] With `prefers-reduced-motion: reduce`, transitions are effectively disabled.

## 11) Data Compatibility + cross-tab
- [ ] Existing saved prompts load without migration errors.
- [ ] Storage keys remain:
  - `ph_prompts`
  - `ph_placeholder_history`
  - `ph_button_pos`
  - `ph_auto_select_bracket_placeholder` (new; missing means on)
- [ ] Prompt list, placeholder history, and the auto-select flag sync across other Gemini tabs via `chrome.storage.onChanged` without a manual reload.

## Result
- [ ] PASS
- [ ] FAIL

Notes:
-
-
