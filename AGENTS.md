# easyDesktop-tauri — Agent 工作规范

Windows 桌面图标面板：Rust + Tauri v2 后端，原生 HTML/CSS/JS 前端，无框架、无打包器。本仓库是
[vicent-yx/easyDesktop](https://github.com/vicent-yx/easyDesktop) 的 Rust 重写衍生版（GPL-3.0）；上游
Python 版在 `D:\EasyDesktop\easyDesktop-src`，只作对照，不在本仓库修改。

本文件是所有 agent（Qoder / CodeBuddy / Trae / DeepSeek Harness）的唯一入口。Qoder、CodeBuddy、DeepSeek
Harness 会直接读根目录的 `AGENTS.md`；Trae 若没自动带上，在设置里开启「将 AGENTS.md 包含在上下文」。
仓库里的 `.trae/rules/project_rules.md` 与 `.codebuddy/rules/project_rules.md` 只是指向本文件的指针。

## 开始前读什么

- 改代码：`docs/harness/architecture.md`（模块边界、IPC、持久化契约）
- 修 bug / 加交互：`docs/harness/pitfalls.md`（真实踩过的坑）
- 验收：`docs/harness/verification.md`（真机清单）
- 用户用法与构建说明：`README.md`，不要复制进本文件。

## 命令（Windows，仓库根目录）

```bash
cargo test                                   # 纯函数单测
npx @tauri-apps/cli@2 dev                    # 开发运行，前端改动可热重载
cargo build --release                        # release 编译
npx @tauri-apps/cli@2 build --bundles nsis   # NSIS 安装包 → target/release/bundle/nsis/
```

- 前端资源在构建时内嵌：只改 `frontend/` 也要重新构建才进安装包。
- 仓库搬家后若报 `failed to read plugin permissions ... <旧路径>`，是 `target/` 里残留了旧绝对路径；先
  `cargo clean` 再重试，不要改路径去迁就旧缓存。
- `cargo test` 覆盖排序合并、拼音索引、版本来源等纯函数（当前 15 个用例）；不覆盖窗口/前端，UI 验收仍按
  `docs/harness/verification.md` 真机走。
- 前端脚本拆在 `frontend/resources/ed/`，按 `01`→`09` 顺序加载；拆文件不能改变依赖顺序，改完至少跑
  `node --check` 逐文件校验。
- 开发运行的配置数据在 `target/debug/`，与安装目录 `D:\EasyDesktop\easyDesktop-app` 的用户数据隔离。

## 硬性约束

- **唯一 IPC 通道**：前端业务调用只走 `window.pywebview.api.<method>(...)` → `pywebview_call` →
  `api/mod.rs::dispatch` → 领域模块。新增后端方法在对应领域模块的 `METHODS` 与 `dispatch` 各加一条，
  不新增 Tauri command（确实无法走 dispatch 时先说明），不放宽 `capabilities/default.json`。
- **模块归属**：窗口/热区/焦点/托盘/动画→`main.rs`；文件系统→`files.rs`；排序合并→`order.rs`；持久化→
  `config.rs`；图标→`icons.rs`；缩略图→`preview.rs`；Win32→`win32.rs`；WebView2 内存→`webview_mem.rs`；
  `api/` 下按领域只做分发与薄适配，重逻辑回落到对应模块。历史遗留：`api/files.rs` 仍有文件操作适配，
  新逻辑不要再往里堆。
- **依赖接口而非实现**：Rust 跨模块只用 `pub` 函数/类型，不直接读写别模块的 `static`；JS 模块之间用对象
  方法，不新增裸全局变量。
- **组合优先**：不引入 trait 继承层次或 JS 类继承；复用靠组合、小函数。
- **全局状态要交代**：新增 `Atomic*` / `OnceLock` / `Mutex` / `static` 必须说明生命周期、重置点和线程安全；
  业务逻辑尽量写成纯函数，副作用留在 `main.rs` / `api/` 边界。
- **单一状态源**：搜索用 `AppState.searchKey`，排序用 `dir_order`；不要让 DOM 和状态各说一套（视图按钮从
  DOM 推导是已固化的例外）。
- **异步收尾要能作废**：动画、隐藏、低内存定时器用 `__edSeq` / `POWER_GEN` / `SLIDE_GEN` 代际号；新增同类
  逻辑照做。
- **窗口可能消失**：`get_webview_window("main")` 可能返回 `None`。任何 show/hide 都要回滚 `WINDOW_VISIBLE`
  等状态并记日志，不能 `if let Some` 静默跳过（真实发生过状态卡死）。
- **用户数据只读**：不碰 `D:\EasyDesktop\easyDesktop-app` 下的 `config.json`、`user_class.json`、
  `user_groups.json`、`cl_data.json`。需要迁移/清理时先哈希核对，改后复核；备份最多一份，删除走回收站。
- **Git**：不 push、不 force push、不改写历史；本地提交用中文 `type: 描述`（feat/fix/perf/style/docs/chore），
  提交前展示 diff。
- **先问再做**：新增依赖/插件、改权限/CSP、动发布/安装目录、改系统关联（注册表/快捷方式/自启任务）。

## 版本与同步

- 版本唯一来源是 `Cargo.toml`；Rust 代码统一用 `config::APP_VERSION`（`env!("CARGO_PKG_VERSION")`），
  不要手写版本字符串。`Cargo.lock` 由 cargo 自动更新。
- 发版时同步 `tauri.conf.json` 和 `README.md`（徽章 + 安装包文件名）。
- 动效时长三处同步：`frontend/theme/frame.css` 的 `--md-motion-*`、`01-core.js` 的 `DUR` /
  `09-interactions.js` 的 `REORDER_MS`、`src/main.rs` 的 `PANEL_IN_MS` / `PANEL_OUT_MS`。

## 完成定义

1. 一次只做一个可验证的增量，不把不相关改动混在一起。
2. `cargo test` 与 `cargo check` 通过（当前基线：15 个单测全过，`cargo check` exit 0、无警告）。
3. 改 UI/窗口/热区/托盘/内存：按 `docs/harness/verification.md` 真机走一遍，并检查 `ed_calls.log` 无异常。
4. 改数据：四个数据文件改动前后哈希一致（除非本次就是要改数据）。
5. 发版：六处版本号一致 + NSIS 包实际安装/升级一次 + 真机清单通过。
