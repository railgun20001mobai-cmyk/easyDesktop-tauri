# 架构与契约

## 定位

- 单窗口 Windows 桌面面板：Rust 侧负责窗口生命周期、热区、Win32、文件系统、配置、图标、缩略图和
  WebView2 内存；前端是上游 pywebview 版原样沿用的原生 HTML/CSS/JS。
- 上游为 `vicent-yx/easyDesktop`（Python + pywebview，基线 2.9.0），本项目独立编号（当前 1.1.7）。
  上游源码在 `D:\EasyDesktop\easyDesktop-src`，只作对照，不在本仓库修改。

## 调用链

```text
ed.js → window.pywebview.api.<method>(...args)
      → frontend/pywebview_shim.js（Proxy，动态转发）
      → invoke("pywebview_call", { method, args })
      → src/api.rs::pywebview_call → dispatch(method, args)
      → files / config / icons / preview / win32 / main 中的实现
```

- shim 不维护方法白名单：新增后端方法只需在 `api.rs::dispatch` 加分支，前端即可按方法名调用。
- 只有 3 个 Tauri command：`pywebview_call`、`set_visibility_lock`、`toggle_window`。
- `capabilities/default.json` 只声明 `core:default`；不加载远程内容，不为单个功能放开插件权限。
- `asset:protocol` 的路径范围较宽（桌面文件可能位于任意磁盘），改 CSP/范围前先确认安全影响。

## 模块职责

| 文件 | 负责 | 注意 |
| --- | --- | --- |
| `src/main.rs` | 窗口生命周期、角落热区轮询、焦点补偿、全屏抑制、托盘/热键、滑动动画、可见性锁、日志 | 状态机核心，改动必须真机验证 |
| `src/api.rs` | IPC 分发（约 43 个方法）＋ 历史文件/分类/应用组操作实现 | 1133 行，新实现不要再堆这里 |
| `src/files.rs` | 目录扫描、`desktop_paths()`、排序持久化 | 新建/改名/删除的旧实现仍在 `api.rs` |
| `src/config.rs` | `config.json` / `user_class.json` / `user_groups.json` / `cl_data.json` 读写 | 原子写、损坏备份、版本兼容 |
| `src/icons.rs` | 系统图标提取与缓存、自定义图标 | `.lnk` 目标解析有历史坑 |
| `src/preview.rs` | 图片缩略图、有上限的 LRU | 尺寸与内存强相关 |
| `src/win32.rs` | 前台窗口、全屏检测、圆角、光标、DPI、屏幕尺寸、本地时间 | 仅 Windows |
| `src/webview_mem.rs` | 隐藏后 invisible / low memory / suspend，呼出 resume | 时序不能反 |
| `frontend/resources/ed.js` | 前端主逻辑（4657 行） | 按对象模块组织，见下 |
| `frontend/theme/frame.css` | 布局与动效 token | 与 JS/Rust 时长同步 |

`ed.js` 现有对象模块：`CONSTANTS`、`DisplayModeManager`、`Utils`、`AppState`、`DOMCache`、`ApiHelper`、
`UIUtils`、`DialogManager`、`MenuManager`、`NavigationManager`、`SearchManager`、`ThemeManager`、
`ConfigManager`、`FileOperationManager`、`GroupManager`、`EventManager`、`ItemSelection`、`DragManager`、
`Marquee`。新功能开自己的对象或模块，不往 `AppState` 里堆字段。

## 持久化契约

- 数据目录：优先 exe 所在目录（可写时）；装在 `Program Files` 等只读目录时退回
  `%APPDATA%\EasyDesktop`。开发运行时 exe 在 `target/debug/`，因此开发数据与安装目录隔离。
- 文件：
  - `config.json`：全部设置 + `dir_order` 图标顺序 + `ico` 自定义图标 + `screens_winInfo`。
  - `user_class.json`：`{ "<dir_key>": { "<分类名>": [ { filePath, fileName, fileType, isGroup? } ] } }`。
  - `user_groups.json`：`{ "<groupId>": { "name": "组名", "files": [ { filePath, fileName, ico, ... } ] } }`。
  - `cl_data.json`：标星数据。
  - `desktopICO/`、`background/`：图标缓存与自定义背景；`ed_calls.log`：运行日志（512KB 轮转）。
- `write_json()` 先写 `.tmp` 再 rename；JSON 损坏时改名为 `.corrupt-bak` 再回退默认值，不许静默覆盖现场。
- `config::get()` 返回整份 JSON 的克隆；高频路径不要反复调用。`update(part, data)` 会整文件重写。
- `merge_desktop_order()` 启动时合并扫描结果：保留用户已有相对顺序，新条目按扫描下标插入，无变化不写盘。
- 新增持久化字段必须同时加进 `default_config()`，否则升级后的旧配置读不到该键。

## 窗口与运行模型

- 单主窗口 `main`：启动隐藏、透明、无边框、置顶、`skipTaskbar`、关闭拖放、acrylic 背景。
- 呼出：角落热区轮询 + 全局热键 + 托盘。防打扰：`fdr && foreground_is_fullscreen()` 时不触发。
- 可见性锁：`LOCK_COUNT` 引用计数，设置面板与子对话框共用；计数归零才允许自动收起。
- 收起：滑出（`PANEL_OUT_MS` 240ms）→ `hide()` → WebView2 `SetIsVisible(false)` → 20s 降内存 →
  90s `TrySuspend`。`POWER_GEN` 作废旧定时器，`SLIDE_GEN` 作废被打断的滑动。
- 呼出：先 `SetIsVisible(true)` + `Resume()` 再 `show()`，否则会闪一帧空白。
- 热区武装：收起后鼠标必须先离开热区再进入，避免“收起末尾闪一下”。
- 焦点：后台进程通常抢不到前台，`NEEDS_ACTIVATION` + 限流的 16ms 重试；不要注入 Alt 或附加线程输入队列，
  会与全屏游戏互相抢焦点。
- 日志标记（`ed_calls.log`）：`webview: low memory`、`webview: suspended`、`webview: resume`。

## 前端约定

- 无框架、无打包器，资源构建时内嵌；改 `frontend/` 必须重新构建。
- 动效 token 在 `frame.css`；`ed.js` 的 `DUR` / `REORDER_MS` 与 Rust 的 `PANEL_IN_MS` / `PANEL_OUT_MS`
  必须一致（`DUR`：spring/panel 300、quick 110、fade-in 200、fade-out 150；`REORDER_MS` 600）。
- `AppState` 是路径、文件列表、搜索词等的单一来源；视图按钮从实际 DOM 推导是刻意保留的例外。
- 弹窗显示/隐藏走 `uiBoxDisplayChange()` / `hideWithMotion()`，用 `__edSeq` 作废旧收尾。
- 分类对话框关闭后清空列表 DOM、释放预览缓存；不要给弹窗加全屏 `backdrop-filter`（GPU 合成开销大）。
- 图标按 128px 生成（当前 175% 缩放下约 112 物理像素），预览最长边 192px、JPEG 不超过 80KB；
  改缩放或尺寸策略要同时评估清晰度和常驻内存。

## 已知结构债务

- `ed.js` 4657 行、`api.rs` 1133 行，无自动化测试，是本项目最大的回归风险。
- 版本号分散在 6 个文件，`src/config.rs::init()` 仍把 version 写成 `"1.1.3"`。
- `api.rs` 内仍有文件操作实现，与 `files.rs` 职责重叠；新代码按 `AGENTS.md` 的模块归属放置。
