# easyDesktop（Rust / Tauri 重构版）

一个 Windows 桌面增强工具：把桌面图标收进贴边面板，桌面本身保持干净，需要时鼠标移到屏幕角落（或按快捷键）就把面板唤出来，打开文件、进目录、分类筛选、应用组、新建与重命名都在这一处完成。

本仓库是 [vicent-yx/easyDesktop](https://github.com/vicent-yx/easyDesktop)（pywebview + Python 版）的重写版：交互与功能对齐上游，后端换成 Rust，运行时换成 Tauri v2 / WebView2，不再需要 Python 环境。上游基线为 `2.9.0`（commit `5108267`），本项目独立编号，自 `1.0.0` 起。

![license](https://img.shields.io/badge/license-GPL--3.0-green) ![platform](https://img.shields.io/badge/platform-Windows-blue) ![framework](https://img.shields.io/badge/Tauri-v2-orange)

## 快速开始

1. 到 [Releases](https://github.com/railgun20001mobai-cmyk/easyDesktop-tauri/releases) 下载 `easyDesktop-tauri_1.0.0_x64-setup.exe` 安装
2. 启动后面板默认停在屏幕角落，鼠标移到左下角即可唤出，移开后自动收起
3. 想彻底腾出桌面：在桌面右键 → 查看 → 取消勾选"显示桌面图标"，之后所有桌面文件都通过面板访问
4. 程序常驻托盘，点托盘图标或齿轮可进入设置；卸载用安装目录里的 `uninstall.exe`

需要 WebView2 Runtime（Windows 11 自带，Windows 10 可在设置中勾选自动下载或另行安装）。

## 界面与用法

**唤出与收起**
- 角落热区唤出，或自定义全局热键唤出（组合键可在设置里改）
- 面板可停靠位置、收起方式（离开面板即收 / 失焦即收）、热区大小都可配置
- 全屏程序前台时不会误弹、不会抢焦点；支持多显示器与副屏
- 系统托盘常驻，支持开机自启（可选以较高优先级启动）

**浏览与打开**
- 面板展示当前目录内容，默认为桌面；单击图标进入子目录，面包屑与返回按钮可逐级回退
- 右键菜单：打开、在资源管理器中显示、复制、粘贴、重命名、删除、新建文件 / 文件夹 / 应用组、自定义图标
- 新建支持 docx / xlsx / pptx / txt 与文件夹；粘贴支持从资源管理器复制的内容
- 顶部搜索框过滤当前目录，支持拼音输入
- 图片文件可预生成缩略图并缓存

**分类与应用组**
- 分类栏按规则归集文件，点击即可过滤；分类可新建、重命名、删除，顺序可拖拽调整
- 应用组把多个程序收进一个图标：拖文件到组图标上即加入，从组视图拖出即移出

**多选与拖拽排序**
- `Ctrl` + 点击逐个多选，`Shift` + 拖动框选一片，`Esc` 取消
- 拖动图标或整组图标可重排顺序，其余图标实时让位，松手落定
- 多选拖动时以叠放的图标作为预览，数量较多时显示数量角标
- 拖拽过程中可用滚轮翻页，长列表不必反复松手重来
- 排序结果按目录持久化，重启后保持

**外观**
- 深色 / 浅色 / 自定义主题，可改配色
- 毛玻璃强度、背景图、界面缩放均可调

## 技术实现

前端为原生 HTML + CSS + JS（无框架、无打包器），后端为 Rust。JS 侧通过 `pywebview_shim.js` 兼容层把调用转发到 Rust 的单一入口 `pywebview_call`，由它按方法名分发到约 43 个后端方法，因此前端与上游 Python 版基本可以逐条对照。窗口权限只声明 `core:default`（见 `capabilities/default.json`），不注册额外插件权限、不加载远程内容；由于桌面文件可能位于任意磁盘位置，本地资源协议（`asset:protocol`）的路径范围放得较宽。

```
.
├── src/
│   ├── main.rs        窗口、角落唤出与自动收起、热键、托盘、面板动画
│   ├── api.rs         pywebview_call 分发：文件操作、配置、分类、应用组
│   ├── files.rs       目录扫描、排序持久化、新建 / 重命名 / 删除
│   ├── icons.rs       系统图标提取与缓存、自定义图标
│   ├── preview.rs     图片缩略图
│   ├── config.rs      config.json / user_class.json / user_groups.json 读写
│   └── win32.rs       Win32 互操作：前台窗口、全屏检测、圆角、光标、尺寸
├── frontend/
│   ├── easyFileDesk.html       面板骨架与内联样式
│   ├── pywebview_shim.js       调用桥适配层
│   ├── resources/ed.js         前端主逻辑：渲染、拖拽、框选、分类、应用组、主题
│   ├── resources/file_icos/    文件类型图标
│   ├── theme/frame.css         布局与动效
│   └── theme/theme.css         配色变量
├── capabilities/default.json   Tauri 权限声明
├── icons/                      应用图标
└── Cargo.toml / build.rs / tauri.conf.json
```

## 构建

环境：Windows 10 / 11、Rust stable、Node.js LTS。

```bash
# 开发调试（前端改动热重载）
npx @tauri-apps/cli@2 dev

# 编译 release
cargo build --release

# 生成 NSIS 安装包，产物在 target/release/bundle/nsis/
npx @tauri-apps/cli@2 build --bundles nsis
```

网络受限而依赖已在本地缓存时，可加 `CARGO_NET_OFFLINE=true` 离线构建。

注意：`frontend/` 下的资源是**编译期内嵌**进 exe 的（`tauri.conf.json` 的 `build.frontendDist`），只改前端同样需要重新编译打包；若产物疑似未更新，先执行 `cargo clean --package easydesktop` 再构建。

## 数据与备份

用户数据全部保存在安装目录，卸载程序不会静默删除，迁移新机时整体拷走即可：

| 文件 / 目录 | 内容 |
| --- | --- |
| `config.json` | 全部设置：触发方式、热键、面板尺寸与位置、视图、主题、缩放、各目录的图标顺序 |
| `user_class.json` | 分类定义与成员 |
| `user_groups.json` | 应用组 |
| `desktopICO/` | 提取出的图标缓存，可安全删除（会自动重建） |
| `background/` | 自定义背景图 |
| `ed_calls.log` | 运行日志，用于排查问题；内含本机路径，公开贴出前请先脱敏 |

## 常见问题

**鼠标移到角落没反应**
检查设置里的触发方式与停靠位置是否被改动；确认托盘里程序在运行；若开了全局热键，可直接用热键唤出。

**面板挡住全屏游戏 / 游戏里唤不出**
设置里可切换为"仅失焦收起"，并调整收起判定；全屏程序前台时面板不会主动抢焦点。

**没有毛玻璃效果**
毛玻璃依赖系统 DWM 的透明效果，系统"性能选项"里关闭透明或远程桌面环境下会被禁用。

**改了文件名，图标没变**
图标有缓存，删除安装目录下的 `desktopICO/` 后重启程序即可重新提取。

## 贡献

欢迎 issue 和 PR。改前端请留意动效统一使用 `theme/frame.css` 里的 motion token（Material Design 3 节奏：进场减速、退场加速、非对称时长）；其中 `--md-motion-dur-panel-in / -panel-out` 需与 `src/main.rs` 的 `PANEL_IN_MS / PANEL_OUT_MS` 一致，`--md-motion-dur-reorder` 需与 `frontend/resources/ed.js` 的 `REORDER_MS` 一致。

## 许可与声明

- 代码依 **GPL-3.0** 授权，全文见 [LICENSE](LICENSE)。本作品为 [vicent-yx/easyDesktop](https://github.com/vicent-yx/easyDesktop) 的衍生作品，依同一许可证分发，须公开完整源码。
- 仓库内的图片与字体素材不在 GPL 授权范围内，各自保留原权利人条款：`frontend/resources/` 含 Font Awesome 与 MiSans 字体，`icons/` 为应用图标；内置 `zzz` 主题所用素材来自第三方游戏，再分发前请自行替换（移除 `frontend/theme/zzz_bg.png`、`zzz_font.ttf`、`frontend/resources/theme_previews/3z.png`，以及 `theme.css` 中 `[data-theme="zzz"]` 与 `easyFileDesk.html` 的对应主题卡片即可）。

## 致谢

- [vicent-yx/easyDesktop](https://github.com/vicent-yx/easyDesktop) —— 原始项目与全部产品设计
- 上游贡献者 @CassianVale（模块化重构）、@achilng（应用组功能）
- [Tauri](https://tauri.app/) 提供 Rust 桌面运行时；[Material Design 3](https://m3.material.io/) 与 [rayburst](https://github.com/AnInsomniacy/rayburst) 为动效节奏参考
