# Prompt Helper Regression Checklist

Date: __________  
Tester: __________  
Build/Version: __________

## 1) Smoke
- [ ] Extension loads on `https://gemini.google.com/*`.
- [ ] Floating button is visible and clickable.
- [ ] Panel opens and closes normally.

## 2) Prompt CRUD
- [ ] Add a prompt with name + content, save succeeds.
- [ ] Edit an existing prompt, save succeeds and list updates.
- [ ] Delete prompt path works: open confirm -> cancel does nothing -> delete removes item.

## 3) Placeholder + Cursor
- [ ] Default placeholder (`【光标】`) is removed on insert and cursor lands at marker position.
- [ ] Legacy placeholder (`[光标]`) still works.
- [ ] Custom placeholder works and is stored in history.
- [ ] History right-click menu: delete/cancel both behave correctly.

## 4) Insertion Behavior
- [ ] Insert at current cursor position (not full overwrite).
- [ ] Multi-line content keeps expected line structure.
- [ ] `input`/`keyup` effects still recognized by Gemini send state.

## 5) Floating Button + Panel Position
- [ ] Drag button to a new location and refresh page.
- [ ] Button position restores correctly.
- [ ] Panel appears near button and remains in viewport.

## 6) Keyboard and Accessibility
- [ ] Escape closes panel.
- [ ] Modal supports Escape close.
- [ ] Confirm dialog supports Escape close.
- [ ] Modal/confirm Tab and Shift+Tab stay trapped inside dialog.
- [ ] Focus returns to trigger after modal/confirm close.

## 7) Visual Checks
- [ ] Delete-related controls are recognizable but not overly saturated.
- [ ] Hover/active states look consistent.
- [ ] No clipped text in list items, buttons, or dialogs.

## 8) Theme / Motion
- [ ] Light mode readability and contrast are acceptable.
- [ ] Dark mode readability and contrast are acceptable.
- [ ] With `prefers-reduced-motion: reduce`, transitions are effectively disabled.

## 9) Data Compatibility
- [ ] Existing saved prompts load without migration errors.
- [ ] Storage keys remain:
  - `ph_prompts`
  - `ph_placeholder_history`
  - `ph_button_pos`

## Result
- [ ] PASS
- [ ] FAIL

Notes:
-
-
