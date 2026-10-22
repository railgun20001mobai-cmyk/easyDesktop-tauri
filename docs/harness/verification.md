# 验收清单

## 0. 环境与边界

- Windows 10/11 + WebView2 Runtime；Rust stable；Node.js LTS。
- 仓库根目录：`D:\EasyDesktop\easyDesktop-tauri`。
- 开发运行的数据在 `target/debug/`；不要为了测试把 dev exe 拷进 `D:\EasyDesktop\easyDesktop-app`。
- 安装目录下的 4 个数据文件默认只读；破坏性操作只在临时目录或副本上做。

## 1. 编译与构建

```bash
cargo test
cargo check
```

- 单测覆盖排序合并、拼音索引、配置反序列化、版本来源、日志级别过滤；当前 21 个用例必须全过。
- 前端拆分后先逐文件 `node --check frontend/resources/ed/*.js`，再按下方真机清单验证加载顺序。
- 若报 `failed to read plugin permissions ... D:\easyDesktop-tauri\...`：这是搬家前 `target/` 的旧绝对路径，
  执行 `cargo clean`（只删构建缓存）后重跑。
- 单测不覆盖窗口/前端，不能替代第 2 节真机清单。
- release：

```bash
cargo build --release
npx @tauri-apps/cli@2 build --bundles nsis
```

产物在 `target/release/bundle/nsis/`。

## 2. 真机清单

每项都在真实桌面上操作，不能只看代码。

- [ ] 启动/退出：托盘图标出现；托盘左键呼出/收起；托盘菜单退出正常。
- [ ] 热区：左下角呼出；移开自动收起；收起后鼠标不离开热区不会反复闪出。
- [ ] 点击桌面收起（`out_cf_type=2`）；全屏模式下点分类栏/图标区空白可收起，拖拽/框选松手不误收。
- [ ] 设置面板锁：打开设置/子对话框时鼠标移出不会收起；关闭后恢复自动收起。
- [ ] 分类：切换、滚轮切分类、新建/改名/删除、拖拽排序、角标移入移出、分类设置取消。
- [ ] 排序一致性：新增/删除一个桌面文件后重启，启动合并后的顺序与面板显示一致；已保存的相对顺序不变。
- [ ] 搜索：输入过滤、清空恢复、切目录后不残留、收起再呼出不残留。
- [ ] 视图：网格/列表切换；快速连点 10 次不空白；多选、框选、拖拽重排正常。
- [ ] 文件：新建、重命名、删除、粘贴、打开、在资源管理器中显示。
- [ ] 图标：普通 exe、UWP/MSIX 快捷方式、自定义图标、图片预览、缩略图缓存。
- [ ] 应用组：创建、改名、删除、加入/移出、分类里同步。
- [ ] 全屏程序前台：热区不弹出、不抢焦点；退出全屏后恢复。
- [ ] 多显示器/副屏：热区、坐标、尺寸正确；175% 与 250% 缩放各看一次。
- [ ] 收起 20s 后日志出现 `INFO [webview] low memory`；90s 后 `INFO [webview] suspended`；呼出先
      `INFO [webview] resume`，无白帧。
- [ ] 检查 `ed_calls.log`：无 panic/error/重复异常；日志不超过 512KB；release 版默认只有 INFO 及以上，
      不应出现大量 `DEBUG [ipc]` 调用记录。
- [ ] 分级过滤：以 `ED_LOG_LEVEL=warn` 启动开发版，确认 `INFO`/`DEBUG` 不再写入、`WARN`/`ERROR` 正常。

## 3. 内存回归

- 方法：收起面板，分别在 5s / 25s / 95s 记录主进程“私有工作集”，再呼出记录一次；同时看日志三阶段标记。
- 参考（2026-10-21，7 个进程，只作趋势参考）：私有工作集约 164MB → 115MB → 52MB，呼出后约 78MB；
  总工作集约 483MB → 143MB。不要把数字当硬阈值，关注“是否按阶段下降、呼出是否恢复”。
- 注意：降的是常驻内存，私有提交量仍在 220–250MB 左右；被换出的页再次使用需要读回，属正常代价。

## 4. 数据安全

```bash
cd /d/EasyDesktop/easyDesktop-app
sha256sum config.json user_class.json user_groups.json cl_data.json
```

- 改动前后各跑一次并比对；除非本次就是修改数据，否则必须完全一致。
- 涉及删除/重命名/迁移的测试，先在临时目录建样本；不要拿真实桌面分类做实验。
- 需要备份时最多留一份，删除走回收站；不要在 `D:\` 堆备份文件夹。

## 5. 发布

1. 版本以 `Cargo.toml` 为唯一来源（`Cargo.lock` 自动跟随）；同步 `tauri.conf.json` 与 README 的徽章/安装包名。
2. `cargo test` / `cargo check` 通过；`cargo build --release` 通过；`npx @tauri-apps/cli@2 build --bundles nsis` 生成安装包。
3. 在旧版本上实际覆盖安装/升级一次；4 个数据文件哈希不变；分类与排序正常。
4. 跑完第 2 节真机清单。
5. push / tag / 发布到 GitHub 前先获得明确同意；永远不要 push 到 upstream。

## 6. 记录

在提交信息或交接说明里写清：走了哪些项、哪些没走、为什么；内存/版本/数据哈希的实测值。
