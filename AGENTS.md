# AGENTS.md

> 面向在这个仓库里干活的 AI。**项目事实以 [README.md](README.md) 为准**（规则、命令、目录结构、数据格式都在那儿，这里不重复）。本文件只写执行纪律和会直接导致失败的坑。

## 动手前先接受这三条约束

1. **计时逻辑只能在 `src/main/`。** `powerMonitor.getSystemIdleTime()` 只有主进程能调，渲染层拿不到系统空闲时长。任何"把计时挪到前端"的方案都不成立。
2. **记账只认一条公式**：`min(now, lastInputTs + 180000)`。`tracker.js` 里五种结束条件全都建立在它上面，改之前先把这条想透，不要单独给某个结束条件开小灶。
3. **三个阈值是规则不是偏好**：`180`（无操作）、`300`（最低休息）、`2700`（窗口）。用户原话是「3 分钟写死的外部不要操作」。

## 不许做的改动

- **不加暂停功能。** 用户明确要求只有「启动」和「结束」两个状态，提暂停会被否。
- **不把阈值做成设置项。** 设置里只能有主题、字号、开机自启、音效。
- **不在渲染层判断时长。** 渲染层只负责画，所有判断留在主进程。
- **不引前端框架。** 原生 DOM 是刻意选择，为的是启动速度和体积。

## 改了东西必须验证

| 改了 | 必做 |
|---|---|
| `src/main/tracker.js` | `npm test`，6 个用例必须全绿 |
| 任何 UI | 重拍 `docs/screenshots/`，参考下方截图流程 |
| 任何代码 | 打一次包确认 exe 能起来，只跑 dev 不算验证 |

## 本机环境的坑（报错信息有误导性）

1. **`ELECTRON_RUN_AS_NODE=1` 是继承来的。** 不 unset 的话 electron.exe 退化成纯 Node，`require('electron')` 返回路径字符串，`app` 变 undefined，报 `Cannot read properties of undefined (reading 'requestSingleInstanceLock')`。一律用 `npm start`（`scripts/dev.js` 已处理）。

2. **`NODE_OPTIONS` 里挂了安全删除 shim。** 打包时 electron-builder 清理旧产物会被拦，报 `app.asar ... being used by another process`——**文件并没有被占用，是删除操作被拦截了**。打包命令必须写成：

   ```bash
   env -u NODE_OPTIONS -u ELECTRON_RUN_AS_NODE npm run dist
   ```

3. **CSS 文件首行不能有 `'use strict'`。** 踩过一次，表现是布局正常但所有颜色消失，因为整份 `:root` 变量被 CSS 解析器丢掉。

4. **`app.getPath('userData')` 按 productName 取目录名**，中文「每日学习计时器」直接当目录。按 `name` 字段去 `%APPDATA%` 下找会扑空。

5. **开发版和打包版共用同一个 userData 和单实例锁。** 同时跑会互相踢掉，测打包版前先 `Stop-Process -Name electron`。

6. **`release/` 目录曾有文件被系统句柄锁死删不掉**，所以输出目录定在 `dist/`。不要改回去。

## 截图流程

`src/main/index.js` 里有一组调试钩子，只在带环境变量时触发，正常使用无影响：

| 变量 | 作用 |
|---|---|
| `TT_SHOT=<路径前缀>` | 触发截图，产出 `<前缀>-float.png` / `-panel.png` |
| `TT_DEMO=1` | 模拟点开始、截图、再点停止 |
| `TT_SETTINGS=1` | 打开设置面板截一张 |
| `TT_LOGS=1` | 打开记录窗口截一张 |
| `TT_THEME=dark` | 启动时切暗色 |
| `TT_FS=1.2` | 启动时设字号倍率 |
| `TT_DEBUG=1` | 把启动日志写到系统临时目录的 `tt-boot.log` |

**注意**：`TT_THEME` 和 `TT_FS` 会写进 `settings` 并持久化。截完图记得 `node scripts/seed-demo.js --clean` 清掉演示数据，否则下次启动会带着假记录和测试用的字号。

截图前先灌一份像样的数据，空面板截出来没有说服力：

```bash
node scripts/seed-demo.js
```

## 发版

```bash
# 1. 改 package.json 的 version
# 2. 打包
env -u NODE_OPTIONS -u ELECTRON_RUN_AS_NODE npm run dist
# 3. 提交
git add -A && git commit -m "x.y.z：<一句话>"
git push origin main
# 4. 发 release
gh release create vX.Y.Z "dist/time-tracker-setup-X.Y.Z.exe" --title "..." --notes "..." --latest
```

仓库在 `u32-cn/time-tracker`。`u32` 是普通用户账号，当前凭据无权在其下建仓，不要尝试 `gh repo create u32/...`。

## 改动产品规则前

计时规则是用户反复打磨四轮才定下来的（滑动窗口、回溯截断、单一记账公式都推倒重来过）。要动 `tracker.js` 的判定逻辑，**先说明要改什么、为什么现在的实现不满足，等确认后再动手**，不要直接改完再说。
