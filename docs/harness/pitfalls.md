# 已知坑位

每条按“症状 → 根因 → 规则 → 验证”记录，全部来自本项目的真实提交或事故。修 bug 前先扫一遍相关条目。

## 1. 只清输入框，不改变“真正生效”的状态

- 症状：搜索框清空后列表仍停在旧结果；切目录或重新呼出也回不来。
- 根因：多处只把 input 清空、不重渲染；“目录内容未变”的快路径又跳过刷新。
- 规则：关键词必须落到 `AppState.searchKey`；清空、切目录、重新呼出统一走 `syncSearchView()`。
- 证据：`dab5690`。
- 验证：搜索 → 清空 → 点图标进目录 → 面包屑返回 → 收起再呼出，列表每次都是完整目录。

## 2. 新的全局点击收尾绕过 suppressClick，拖动松手把面板收掉

- 症状：拖动分类排序或框选后松手落在空白处，面板被当作“点空白”收起。
- 根因：分类栏空白收起监听与 `DragManager` / `Marquee` 的收尾吞除是两条独立监听，拿不到对方的消费标记。
- 规则：任何新增的全局 click / 收起判定，先检查 `suppressClick` 与 `Marquee.suppress`；滚动条上的点击不算空白。
- 证据：`8601a34`。
- 验证：拖动分类排序、框选后松手在空白、按在滚动条上，三种情况面板都不应收起。

## 3. UWP/MSIX 快捷方式被当成普通文件

- 症状：Kazumi 这类 `.lnk` 没有真实图标，显示静态占位图。
- 根因：`.lnk` 存的是 AUMID，`IShellLink::GetPath` 返回空，扩展名停在 `.lnk`，类型判断只认 `.exe/.url`。
- 规则：目标解析不出来的 `.lnk` 仍按“应用”处理，图标走 `IShellItemImageFactory`，不要回退成普通文件。
- 证据：`fb93353`。
- 验证：放一个 Microsoft Store 应用快捷方式，图标应能正常提取。

## 4. 弹窗关闭后 DOM 与模糊继续占内存

- 症状：分类设置等大列表对话框关掉后，面板隐藏期间内存仍高。
- 根因：列表 DOM 与已解码图标一直保留；弹窗还叠了全屏 `backdrop-filter`。
- 规则：关闭时清空列表 DOM、图标懒加载；弹窗不要加全屏模糊（设置面板/自定义背景的模糊保留）。
- 证据：`bcea439`。
- 验证：打开含上百项的分类设置 → 关闭 → 收起面板 20s，观察内存回落；再次打开无明显变慢。

## 5. 隐藏后不降内存 / 呼出白屏

- 症状：面板收起后 WebView2 常驻内存不降；或呼出先白一帧。
- 根因：`TrySuspend` 前没有 `SetIsVisible(false)` 会失败；呼出时先 `show()` 再 `Resume()` 会白屏。
- 规则：隐藏顺序 = `hide()` → `SetIsVisible(false)` → 20s low → 90s suspend；呼出顺序 =
  `SetIsVisible(true)` + `Resume()` → `show()`。定时器必须带 `POWER_GEN` 代际号；缓存必须有上限和释放时机。
- 预热：`show()` 前要留合成时间，且按 `webview_mem::level()` 分档——正常 60ms、低内存 180ms、
  悬挂 320ms。固定 60ms 在悬挂唤醒时会"窗口先出、图标区空白随后才铺满"。
- 证据：`cee321a`、`0ef0885`。
- 验证：收起 20s 查 `webview: low memory`、90s 查 `webview: suspended`、呼出查 `webview: resume`
  与 `show: warmup ... (level=N)`，且无白帧；久闲（>90s）唤醒重点看首帧图标是否完整。

## 6. 动画被打断留下退场状态

- 症状：快速连点视图切换，面板整片空白；或刚打开的对话框被上一次隐藏收尾关掉。
- 根因：异步收尾没有代际判断，旧回调在新状态生效后才执行。
- 规则：所有异步收尾用 `__edSeq` / `POWER_GEN` / `SLIDE_GEN` 作废；隐藏与打开必须配对处理。
- 证据：README「稳定性」、`01-core.js` 的 `__edSeq`。
- 验证：快速连点视图切换 10 次；快速开关对话框，状态都应正确。

## 7. 窗口对象消失，内部状态仍认为“已展开”

- 症状：面板状态卡死，呼出无效；进程还在，但 `get_webview_window("main")` 返回 `None`。
- 根因：show/hide 路径里 `if let Some` 静默跳过，`WINDOW_VISIBLE` 没回滚，状态机卡在已展开。
- 规则：任何窗口操作在 `None` 时必须回滚可见状态并记日志；必要时重建窗口或退出，不能静默跳过。
- 证据：2026-10-21 实际发生，最终只能强杀重启。
- 验证：正常退出/重启、托盘隐藏、快速开关后，日志中的可见状态与实际窗口一致。

## 8. 仓库搬家后 cargo check 报旧路径

- 症状：`cargo check` 报 `failed to read plugin permissions ... D:\easyDesktop-tauri\target\...`，但该目录已不存在。
- 根因：`target/` 里的 build script 产物记录了旧绝对路径。
- 规则：移动仓库后 `cargo clean`；`target/` 是构建缓存，不入库、不复用、不手工改路径迁就。
- 证据：2026-10-21 搬入 `D:\EasyDesktop\` 后出现。
- 验证：`cargo clean` 后 `cargo check` 通过。

## 9. 版本号漂移

- 症状：程序内版本、安装包版本、README 不一致；`config.json` 的 `version` 被写成 1.1.3。
- 根因：版本号散在 6 个文件，`src/config.rs::init()` 还有一处写死。
- 规则：版本只从 `Cargo.toml` 取（`config::APP_VERSION`）；发版只手动同步 `tauri.conf.json` 与 README。
- 证据：1.2.0 前 `config.rs::init()` 写死 `"1.1.3"`，`api.rs` 另有一份 `1.1.7`。
- 修复：1.2.0 起 `default_config()` / `init()` / `api.rs` 共用 `APP_VERSION`，不再维护第二份字符串。
- 验证：`cargo test` 的 `default_config_uses_package_version`；安装后程序内版本与 exe 属性一致。

## 10. 抢焦点与全屏游戏互相打架

- 症状：全屏游戏前台时面板反复弹出/收起，或抢走焦点。
- 根因：后台进程直接 `SetForegroundWindow`，或注入 Alt / 附加线程输入队列。
- 规则：先判断 `foreground_is_fullscreen()`；抢焦点用温和方式并限流；不要改这段策略而不测全屏游戏。
- 证据：README「稳定性」、`main.rs` 的 `NEEDS_ACTIVATION` / `LAST_ACTIVATE_AT`。
- 验证：全屏游戏前台时移动鼠标到热区，不应弹出；退出全屏后恢复正常。

## 11. 高 DPI 下图标发虚 / 内存反弹

- 症状：换到 250% 缩放后图标模糊；或为清晰度把尺寸调大后内存明显上升。
- 根因：图标按 128px 生成，175% 下约 112 物理像素，是清晰度与内存的折中。
- 规则：改图标/预览尺寸必须同时看两个指标：当前缩放下的清晰度、近百个图标的常驻内存；
  预览保持有上限 LRU。
- 证据：`0ef0885`。
- 验证：175% 与 250% 各看一次网格/整行视图，记录内存。

## 12. 测试碰了真实用户数据

- 症状：开发/测试后分类、排序或配置被改动。
- 根因：直接把 dev exe 放进安装目录，或对 `easyDesktop-app` 下的数据做破坏性测试。
- 规则：开发运行用 `target/debug/`（数据隔离）；破坏性操作在临时目录或副本上做；必须动真实数据时先哈希、
  改后复核；备份最多一份，删除走回收站。
- 验证：见 `verification.md` 的哈希命令。

## 13. 启动排序与渲染排序各写一套

- 症状：启动后写入的 `dir_order` 顺序，与打开面板时看到的顺序不一致；新增文件位置对不上。
- 根因：启动合并用“新增项在完整扫描结果里的下标”，渲染排序用“移除已保存项后剩余列表的下标”；
  两者在“已保存项与新项交错”时结果不同。上游 `merge_lists` 用的是前者。
- 规则：只保留 `order::merge_order` 一份实现，启动与渲染都调用它；改规则先改 `src/order.rs` 的单测。
- 证据：1.2.0 前 `config.rs::merge_desktop_order` 与 `files.rs::order_items` 各写一套。
- 验证：`cargo test` 的 `new_item_uses_original_index_not_remaining_index`；真机新增文件后重启对比顺序。
