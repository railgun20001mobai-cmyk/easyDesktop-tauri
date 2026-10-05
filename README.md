# easyDesktop（Rust / Tauri 重构版）

把桌面图标收进一个角落面板：桌面上不留图标，鼠标移到屏幕角落（或按自定义热键）就唤出面板，图标、分类、应用组、文件操作都在里面完成。

本仓库是 [vicent-yx/easyDesktop](https://github.com/vicent-yx/easyDesktop)（pywebview + Python 版）的**衍生重写**：界面与交互保留，后端由 Python 换成 Rust，运行时由 pywebview 换成 Tauri v2 / WebView2。上游基线为 `2.9.0`（commit `5108267`），因此本项目同样以 `2.9.0` 对齐版本号。

> 许可证：上游是 **GPL-3.0**，本项目作为衍生作品继续在 GPL-3.0 下发布，见 [LICENSE](LICENSE)。

![license](https://img.shields.io/badge/license-GPL--3.0-green) ![platform](https://img.shields.io/badge/platform-Windows-blue) ![framework](https://img.shields.io/badge/Tauri-v2-orange)

## 功能

**呼出与窗口**
- 角落热区唤出、全局热键唤出（可自定义组合键），面板贴边自动收起
- 全屏程序（游戏）前台时不抢焦点、不误收起；多显示器 / 副屏支持
- 系统托盘图标、开机自启

**视图与布局**
- 网格视图 / 列表视图（整行）双布局，切换带动效；切换按钮图标提示"点下去会切到哪一面"
- 分类栏：按分类过滤、分类排序可拖拽、分类增删改
- 图标级图片缩略图预加载与缓存

**批量操作与拖拽重排**
- `Ctrl` 点击多选、`Shift` 拖动框选（橡皮筋，贴边自动翻页）、`Esc` 取消
- 手机桌面式重排：抓起时原位被其他图标填满不留空，全程只有一个跟手虚槽，其余图标实时让位；松手后虚槽才展开成 N 格
- 拖起预览：≤3 个叠真实图标，>3 个叠前三个 + 数量气泡
- 拖拽期间可用**滚轮**翻页；落点带迟滞带，指针在中线来回蹭不会引起邻居抽搐
- 拖进应用组即加入该组；从组视图拖出即移出该组

**文件操作**
- 单击打开、双击在资源管理器中定位
- 新建文件（docx / xlsx / pptx / txt / 文件夹）、重命名、删除、粘贴剪贴板内容
- 自定义图标（提取 exe/lnk 图标并缓存）
- 搜索（含拼音匹配）

**外观**
- 主题（深色 / 浅色 / 自定义）、毛玻璃与背景图设置、界面缩放

## 技术栈与结构

原生 HTML + CSS + JS 前端（无框架、无打包器），Rust 后端。JS 通过 `pywebview_shim.js` 兼容层把调用转发到 Rust 的单一入口 `pywebview_call`，由它按方法名分发到约 43 个后端方法——这样从 Python 版迁移时前端几乎不用改。窗口权限只声明了 `core:default`（见 `capabilities/default.json`），不开远程 URL、不放开文件系统通配。

```
.
├── src/
│   ├── main.rs        窗口/角落唤出/热键/托盘/自动收起（轮询与动画帧控）
│   ├── api.rs         pywebview_call 分发：文件操作、配置、分类、应用组
│   ├── files.rs       目录扫描、排序持久化、新建/重命名/删除
│   ├── icons.rs       图标提取、缓存、自定义图标
│   ├── preview.rs     图片缩略图 base64
│   ├── config.rs      config.json / user_class.json / user_groups.json 读写
│   └── win32.rs       Win32 FFI：前台窗口、全屏检测、圆角、光标、尺寸
├── frontend/
│   ├── easyFileDesk.html       面板骨架与内联样式
│   ├── pywebview_shim.js       旧 bridge → Tauri invoke 适配层
│   ├── resources/ed.js         前端主逻辑（渲染、拖拽引擎、框选、分类、组、主题）
│   ├── resources/file_icos/    文件类型图标
│   ├── theme/frame.css         布局与动效
│   └── theme/theme.css         配色变量
├── capabilities/default.json   Tauri 权限声明
├── icons/                      应用图标
├── Cargo.toml / build.rs / tauri.conf.json
└── LICENSE
```

## 开发环境

仅支持 Windows（依赖 Win32 API 与 WebView2）。

1. 安装 [Rust](https://www.rust-lang.org/tools/install) stable、[Node.js](https://nodejs.org/) LTS
2. 确保系统有 WebView2 Runtime（Win11 自带；Win10 需安装 [Evergreen Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)）
3. 首次构建需拉取 crates 依赖；依赖已缓存在本机时可用离线模式

```bash
# 开发运行（带热重载）
cargo tauri dev          # 或：npx @tauri-apps/cli@2 dev

# 仅编译 release
cargo build --release

# 打安装包（NSIS）
npx @tauri-apps/cli@2 build --bundles nsis
# 产物：target/release/bundle/nsis/easyDesktop_<version>_x64-setup.exe
```

国内网络访问 crates.io 受限时，加 `CARGO_NET_OFFLINE=true` 使用本地缓存：

```bash
CARGO_NET_OFFLINE=true npx @tauri-apps/cli@2 build --bundles nsis
```

**注意：前端资源是编译期内嵌进 exe 的**（`build > frontendDist: "frontend"`）。只改 `frontend/` 下的文件也必须重新编译打包才会生效；若怀疑嵌进去的是旧资源，先 `cargo clean --package easydesktop` 再打包。

## 运行数据

程序把用户数据写在 **exe 同级目录**，不入仓库、也不要提交：

- `config.json` —— 全部设置（触发方式、视图、分类顺序、目录排序、主题、缩放…）
- `user_class.json` / `user_groups.json` —— 分类与应用组
- `desktopICO/` —— 提取出的图标缓存
- `background/` —— 用户设置的背景图
- `ed_calls.log` —— 调用与窗口行为日志（排查用；内含本机路径）

Bundle identifier 沿用上游的 `com.codevicent.easydesktop`，以保证老用户的开机自启注册项能平滑升级。

## 动效约定

前端动效统一走 CSS 变量形式的 motion token（Material Design 3 节奏：进场减速、退场加速、非对称时长）：

```css
--md-motion-dur-enter / -exit / -quick / -panel / -spring / -panel-in / -panel-out / -reorder
--md-motion-ease-enter / -exit / -spring
```

两处需要人工保持同步：`--md-motion-dur-panel-in/-out` 与 `src/main.rs` 的 `PANEL_IN_MS / PANEL_OUT_MS`；`--md-motion-dur-reorder` 与 `ed.js` 的 `REORDER_MS`（JS 读不到 CSS 变量）。新增动效请复用 token，不要再写死时长和曲线。

## 已知限制

- 仅 Windows；无 macOS / Linux 后端
- 角落唤出靠轮询光标位置实现，省电与灵敏之间取了折中（默认间隔，需要抢焦点时提速）
- 图标提取与缩略图有缓存，改名/换图标后可能需要重新生成
- 毛玻璃效果依赖系统 DWM，部分系统设置下会被禁用

## 致谢

- [vicent-yx/easyDesktop](https://github.com/vicent-yx/easyDesktop) —— 原始项目与全部产品设计
- 上游 README 中感谢的贡献者：@CassianVale（模块化重构）、@achilng（应用组功能）
- [AnInsomniacy/rayburst](https://github.com/AnInsomniacy/rayburst) —— MD3 motion token 与非对称时长/强调缓动的参考实现
- [Tauri](https://tauri.app/)、[Font Awesome](https://fontawesome.com/)、[MiSans](https://misans.com/)

## 第三方资源许可说明

- 代码部分依 GPL-3.0 授权；**仓库内的图片与字体素材不在此授权范围内**，各自保留原权利人的条款。
- `frontend/resources/` 含 Font Awesome 字体与图标、MiSans 字体；`icons/` 为应用图标。
- 内置 `zzz` 主题使用的 `frontend/theme/zzz_bg.png`、`frontend/theme/zzz_font.ttf`、`frontend/resources/theme_previews/3z.png` 为第三方游戏素材，仅作个人学习用途随源码存放。二次分发前请替换为自有素材（主题机制本身通用，删掉这三个文件并移除 `theme.css` 的 `[data-theme="zzz"]` 与 `easyFileDesk.html` 的主题卡片即可）。

## License

GNU General Public License v3.0 only —— 见 [LICENSE](LICENSE)。
本作品为 [vicent-yx/easyDesktop](https://github.com/vicent-yx/easyDesktop) 的衍生作品，依据 GPLv3 分发，须以相同许可证公开完整源码。
