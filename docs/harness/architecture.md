# 架构与契约

## 定位

- 单窗口 Windows 桌面面板：Rust 侧负责窗口生命周期、热区、Win32、文件系统、配置、图标、缩略图和
  WebView2 内存；前端是上游 pywebview 版原样沿用的原生 HTML/CSS/JS。
- 上游为 `vicent-yx/easyDesktop`（Python + pywebview，基线 2.9.0），本项目独立编号（当前 1.2.3）。
  上游源码在 `D:\EasyDesktop\easyDesktop-src`，只作对照，不在本仓库修改。

## 调用链

```text
frontend/resources/ed/*.js → window.pywebview.api.<method>(...args)
      → frontend/pywebview_shim.js（Proxy，动态转发）
      → invoke("pywebview_call", { method, args })
      → src/api/mod.rs::pywebview_call → dispatch(method, args)
      → api/{config,files,classes,groups,window,system}::dispatch
      → files / config / icons / preview / win32 / main 中的实现
```

- shim 不维护方法白名单：新增后端方法只需在对应领域模块的 `METHODS` 与 `dispatch` 里加一条，
  `api/mod.rs` 只负责路由。
- 只有 3 个 Tauri command：`pywebview_call`、`set_visibility_lock`、`toggle_window`。
- 当前对外方法 50 个，按领域拆分后方法名与返回值保持 1.2.0 不变。
- `capabilities/default.json` 只声明 `core:default`；不加载远程内容，不为单个功能放开插件权限。
- `asset:protocol` 的路径范围较宽（桌面文件可能位于任意磁盘），改 CSP/范围前先确认安全影响。

## 模块职责

| 文件 | 负责 | 注意 |
| --- | --- | --- |
| `src/main.rs` | 窗口生命周期、角落热区轮询、焦点补偿、全屏抑制、托盘/热键、滑动动画、可见性锁 | 状态机核心，改动必须真机验证 |
| `src/logging.rs` | 分级日志：`Debug/Info/Warn/Error`、`ED_LOG_LEVEL` 过滤、512KB 轮转 | 业务模块只调 `logging::*`，不要自己开文件写日志 |
| `src/api/mod.rs` | IPC 入口、调用日志、参数归一化、按领域路由 | 50 个方法，只做分发与薄适配 |
| `src/api/config.rs` | bootstrap、配置读写、版本、开机自启 | 自启要真正写系统项 |
| `src/api/files.rs` | 文件列表、导航、新建/改名/删除/复制粘贴、默认目录 | 重逻辑放 `files.rs` |
| `src/api/classes.rs` | 分类读写、class_order、拼音索引 | 分类名变更同步 class_order |
| `src/api/groups.rs` | 应用组增删改、组内排序、组成员 | 删除组要清理分类与排序引用 |
| `src/api/window.rs` | 可见性锁、毛玻璃、调整尺寸、拖拽边缘 | 时长/状态与 `main.rs` 同步 |
| `src/api/system.rs` | 系统项、背景、自定义图标、缓存清理、错误上报 | 图标失败要回前端可见 |
| `src/files.rs` | 目录扫描、`scan_view()`、`desktop_paths()`、条目排序 | 新建/改名/删除的适配仍在 `api/files.rs` |
| `src/order.rs` | 纯函数：保存顺序解析、启动/渲染共用的顺序合并 | 有单测，改规则先改测试 |
| `src/config.rs` | `config.json` / `user_class.json` / `user_groups.json` / `cl_data.json` 读写 | 类型化 `Config`、原子写、锁内读改写、损坏备份、版本来源 |
| `src/icons.rs` | 系统图标提取与缓存、自定义图标 | `.lnk` 目标解析有历史坑 |
| `src/preview.rs` | 图片缩略图、有上限的 LRU | 尺寸与内存强相关 |
| `src/win32.rs` | 前台窗口、全屏检测、圆角、光标、DPI、屏幕尺寸、本地时间 | 仅 Windows |
| `src/webview_mem.rs` | 隐藏后 invisible / low memory / suspend，呼出 resume | 时序不能反 |
| `frontend/resources/ed/` | 前端主逻辑，9 个按序加载的经典脚本 | 加载顺序见下，拆文件不能改变顺序 |
| `frontend/theme/frame.css` | 布局与动效 token | 与 JS/Rust 时长同步 |

前端脚本按加载顺序：

| 文件 | 内容 |
| --- | --- |
| `01-core.js` | `CONSTANTS`、`DisplayModeManager`、`Utils`、`AppState`、`DOMCache` |
| `02-api-ui.js` | `ApiHelper`、`loadingUI`、`UIUtils` |
| `03-render-menu.js` | `DialogManager`、`FileRenderer`、`MenuManager`、桌面路径缓存 |
| `04-navigation.js` | `NavigationManager`、`SearchManager`、`ThemeManager`、`ConfigManager` |
| `05-operations-groups.js` | `FileOperationManager`、`GroupManager` |
| `06-events.js` | `EventManager` 与各类 DOM 事件绑定 |
| `07-globals.js` | DOM 缓存、预览状态与全局函数 |
| `08-init-classes.js` | 启动初始化、分类缓存与切换 |
| `09-interactions.js` | `ItemSelection`、`DragManager`、`Marquee`、保存顺序 |

这些文件是经典脚本，共享同一个全局词法作用域；新增文件必须加在 `easyFileDesk.html` 的最后并保持依赖顺序，
不要改成 module（模块会切断现有全局对象之间的直接引用）。

## 持久化契约

- 数据目录：优先 exe 所在目录（可写时）；装在 `Program Files` 等只读目录时退回
  `%APPDATA%\EasyDesktop`。开发运行时 exe 在 `target/debug/`，因此开发数据与安装目录隔离。
- 文件：
  - `config.json`：全部设置 + `dir_order` 图标顺序 + `ico` 自定义图标 + `screens_winInfo`。
  - `user_class.json`：`{ "<dir_key>": { "<分类名>": [ { filePath, fileName, fileType, isGroup? } ] } }`。
  - `user_groups.json`：`{ "<groupId>": { "name": "组名", "files": [ { filePath, fileName, ico, ... } ] } }`。
  - `cl_data.json`：标星数据。
  - `desktopICO/`、`background/`：图标缓存与自定义背景；`ed_calls.log`：分级运行日志（默认 debug 构建
    记 Debug、release 记 Info；`ED_LOG_LEVEL=debug|info|warn|error` 可覆盖；512KB 轮转）。
- `write_json()` 先写 `.tmp` 再 rename；JSON 损坏时改名为
  `<原名>.corrupt-bak-YYYYMMDD-HHMMSS.json` 再回退默认值，同一秒冲突追加序号，不许静默覆盖现场。
- 主配置是类型化 `Config`：已知字段有明确类型，未知字段保存在 `extra`，前端新增设置项不会被反序列化丢掉。
  `config::get()` 返回 `Config` 克隆；高频路径不要反复调用。`update(part, data)` 在 JSON 边界做
  序列化/反序列化并整文件重写。
- `merge_desktop_order()` 启动时合并扫描结果：保留用户已有相对顺序，新条目按扫描下标插入，无变化不写盘。
- 新增持久化字段必须同时加进 `Config` 与 `Config::default()`；`#[serde(default)]` 会为旧配置补齐缺省值。

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
- 日志格式：`[时间] [rust] LEVEL [scope] message`，标记如 `INFO [webview] resume`、`DEBUG [ipc] get_fileinfo`。
- `AppState` 是路径、文件列表、搜索词、面板可见性等的单一来源；`ConfigManager.current` 是配置的唯一内存副本
  （`ApiHelper.getConfig()` 读后刷新、`updateConfig()` 写后同步），`PreviewState` 管缩略图缓存与代际号，
  `ClassViewState` 管分类选中/缓存/动画序号，`Layout` 管四个拖拽容器，`NavigationManager.desktopPathCache`
  管桌面路径缓存。视图按钮从实际 DOM 推导是刻意保留的例外。

## 前端约定

- 无框架、无打包器，资源构建时内嵌；改 `frontend/` 必须重新构建。
- 动效 token 在 `frame.css`；`01-core.js` 的 `DUR`、`09-interactions.js` 的 `REORDER_MS` 与 Rust 的
  `PANEL_IN_MS` / `PANEL_OUT_MS` 必须一致（`DUR`：spring/panel 300、quick 110、fade-in 200、fade-out 150；
  `REORDER_MS` 600）。
- `AppState` 是路径、文件列表、搜索词等的单一来源；视图按钮从实际 DOM 推导是刻意保留的例外。
- 弹窗显示/隐藏走 `uiBoxDisplayChange()` / `hideWithMotion()`，用 `__edSeq` 作废旧收尾。
- 分类对话框关闭后清空列表 DOM、释放预览缓存；不要给弹窗加全屏 `backdrop-filter`（GPU 合成开销大）。
- 图标按 128px 生成（当前 175% 缩放下约 112 物理像素），预览最长边 192px、JPEG 不超过 80KB；
  改缩放或尺寸策略要同时评估清晰度和常驻内存。

## 已知结构债务

- 前端仍无自动化测试（9 个脚本只做 `node --check` 语法校验），窗口、热区与交互验收仍靠真机清单；
  `06-events.js`（约 894 行）与 `07-globals.js`（约 874 行）是下一步可继续拆的对象。
- Rust 纯函数已有 21 个单测；`api/files.rs` 仍承载文件操作适配，重逻辑继续往 `files.rs` 收。
- 配置已类型化，但 `user_class.json` / `user_groups.json` / `cl_data.json` 仍是 `Value`，可按需再收。
