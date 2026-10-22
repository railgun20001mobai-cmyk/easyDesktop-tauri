// ========== 应用初始化 ==========
const fileRenderer = new FileRenderer();

// 页面加载完成后执行
window.addEventListener('pywebviewready', async function () {

        // 初始化事件管理器
        EventManager.init();

        // 【启动优化 P1｜风险:低】一次 bootstrap 取齐 config+version，替代分散的多次 get_config/get_version。
        const boot = await ApiHelper.call('bootstrap');
        const config = boot.config;

        // 初始化设置（透传 config 复用；updateDefaultDirectory 仅更新 UI、不在此处导航）
        await ConfigManager.updateDefaultDirectory(config, false);
        await ThemeManager.initCustomTheme(config);

        // 【启动优化 P0｜风险:中】首屏只渲染一次：唯一一次目录加载+渲染统一走 navigateTo
        // （原先 updateDefaultDirectory、此处、以及末尾 b2d.click() 共渲染 3 次，每次还带 300ms 动画）。
        // 恢复显示模式：view 只写不读的话重启后永远退回网格
        // 图标按 config 直接判，不去 await 那条 110ms 的切换动画，免得拖慢首屏
        if (config["view"] == "list"){
            DisplayModeManager.wantList = true;
            DisplayModeManager.list_view();
        }
        DisplayModeManager.syncIcon();
        await NavigationManager.navigateTo(config["df_dir"]);
        files_data = AppState.files_data; // 同步全局变量
        document.getElementById("v_note").innerText = "v"+boot.version

        // 初始化UI状态
        const updateUIFromConfig = async (config) => {
            const followSystem = config.themeChangeType != "0";
            const currentTheme = config.theme || 'dark';

            // 更新切换开关状态
            const toggleConfigs = [
                // ['followSystemTheme', 'follow_sys'],
                ['autoStartToggle', 'auto_start'],
                ['fullScreenToggle', 'full_screen'],
                ['fdrToggle', 'fdr'],
                ['of_sToggle', 'of_s'],
                ['sysappToggle', 'show_sysApp'],
                ['imgpreToggle', 'imgpre'],
                ['blurToggle','blur_bg'],
                ['showHiddenToggle','show_hidden_file']
            ];

            toggleConfigs.forEach(([elementId, configKey]) => {
                const element = DOMCache.get(elementId);
                if (element) {
                    element.checked = config[configKey];
                }
            });

            // 开机自启动开关打开时才显示优先级按钮
            DOMCache.get('autoStartPriorityBtn').style.display = config.auto_start ? '' : 'none';

            // 更新选择器状态
            DOMCache.get('cf_type_toggle').value = config.cf_type;
            // 自定义热键：把当前组合键显示出来（否则启动后看不到、也没法改）
            if (typeof showHotkeyText === 'function') await showHotkeyText(config);
            DOMCache.get('out_cf_type_toggle').value = config.out_cf_type;
            DOMCache.get('corner_size_toggle').value = config.corner_size;
            DOMCache.get('outPos_toggle').value = config.outPos;
            DOMCache.get('dbc_action_toggle').value = config.dbc_action;
            DOMCache.get("bgType_toggle").value = config.bgType;
            DOMCache.get("themeChangeType_toggle").value = config.themeChangeType;
            // EventManager.updateThemeCardInteraction();


            // 更新缩放
            const scSlider = DOMCache.get('sc_slider');
            scSlider.value = config.scale;
            const blur_ef_input = DOMCache.get('blur_ef_input');
            blur_ef_input.value = Math.floor(100-config.blur_effect);
            DOMCache.get("sc_input").innerText = "缩放比例：" + config.scale + "%";
            DOMCache.get("blur_ef_input_show").innerText = "毛玻璃效果强度：" + Math.floor(100-config.blur_effect) + "%";
            applyGlassSettings(config);   // 打开设置面板时按当前配置摆好生效状态
            await ConfigManager.updateScale(config.scale);

            // 更新主题卡片状态
            const themeCards = DOMCache.getAllBySelector('.theme-card');
            themeCards.forEach(card => card.classList.remove('active'));

            if (!followSystem) {
                const activeCard = DOMCache.getBySelector(`.theme-card[data-theme="${currentTheme}"]`);
                if (activeCard) {
                    activeCard.classList.add('active');
                }
            }

            // EventManager.updateThemeCardInteraction(followSystem);
            EventManager.updateBGInteraction(config.bgType != "1");

            // 加载主题
            if (followSystem) {
                const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                await load_theme(systemTheme);
            } else {
                await load_theme(currentTheme);
            }

            // 更新背景设置
            const blurSlider = DOMCache.get('blurSlider');
            const blurValue = DOMCache.get('blurValue');
            if (blurSlider && blurValue) {
                blurSlider.value = config.ms_ef || 50;
                blurValue.textContent = blurSlider.value;
            }

            await ThemeManager.applyBackgroundSettings(config);
            refreshRangeFills();   // 启动期程序赋值不触发 input 事件，填充进度要手动刷
        };

        // 应用配置
        await updateUIFromConfig(config);

        // 检查任务计划程序（高优先级自启动）状态
        await ApiHelper.call('get_taskScheduler_state');

        // 初始化背景设置
        await initBackgroundSettings(config);

        // 不在应用启动时禁用滚动，保持正常滚动状态
        // 滚动禁用只在打开设置面板时触发
        console.log('应用初始化完成，滚动状态：正常');

        // 【启动优化 P0｜风险:中】删除原 setTimeout 内的 b2d.click() —— 它会再触发一次
        // refreshCurrentPath 导致第 3 次渲染。首屏导航/box1 显示/fit_btnBar 已由上面的
        // NavigationManager.navigateTo 完成，无需再点。
        // setInterval(check_dirChange,1000);

    render_class_btn()
});

// 监听系统主题变化（initThemeSettings 里已注册同逻辑监听，这里不再重复注册）

// 监听鼠标侧键
document.onmousedown = function(event){
    if(event.button == 3){
        DOMCache.get("pathBackBtn").click();
    }
}

// 分类相关
const class_btn_bar =  document.getElementById("class_bar")

// ===== 分类成员缓存（闪屏修复）=====
// 「分类名 -> Set(fileId)」的本地缓存。
// 原先每次过滤都要 await 一次 read_class 的跨桥 IPC，而 change_class 内部又没有 await
// class_filter，导致 render 完成后过滤尚未生效、遮盖被提前揭开 → 闪出一帧「全部」。
// 现在改为：渲染前就拿到成员集合，元素创建时直接写入正确的 display，全程无中间态。
let classCache = null;
function invalidateClassCache(){
    classCache = null;
}
function buildClassCache(data){
    const map = {};
    for(const k in (data || {})){
        map[k] = new Set((data[k] || []).map(it => Utils.generateFileId(it.filePath)));
    }
    return map;
}
// 返回当前分类的 fileId 集合；"全部"/空 返回 null（表示不过滤）
async function getClassIdSet(title){
    if(!title || title === "" || title === "全部") return null;
    if(!classCache){
        const d = await ApiHelper.call('read_class', '');
        classCache = buildClassCache(d.data);
    }
    return classCache[title] || new Set();
}
// 纯同步地把过滤结果应用到已存在的 DOM
function applyClassFilter(allowIds){
    const ctn = document.getElementById("filesContainer")
    const list_ctn = document.getElementById("filesListContainer")
    for(file_item of [...ctn.children,...list_ctn.children]){
        // 拖拽期间容器里会多一个虚槽，它不是图标，别被过滤器顺手改掉显示状态
        if(file_item.classList.contains("ed-drag-slot")) continue;
        file_item.style.display = (!allowIds || allowIds.has(file_item.id)) ? "flex" : "none"
    }
}
async function add_class(){
    var rs = await showFileSelectionDialog()
    if(rs && rs.files_data.length > 0){
        await ApiHelper.call('add_class', rs.files_data ,rs.title);
        invalidateClassCache();
    }
    render_class_btn()
}
async function class_filter(path){
    // 命中缓存时为同步执行，不存在「渲染完成但过滤未生效」的窗口期
    applyClassFilter(await getClassIdSet(path));
}
let last_group = "全部"
async function render_class_btn(){
    var classData =  await ApiHelper.call('read_class', '');
    classCache = buildClassCache(classData.data);   // 顺手更新缓存，省掉后续一次 IPC
    class_btn_bar.innerHTML = '';
    var class_names = ["全部"]
    for(item in classData.data){
        class_names.push(item)
    }
    for(let index of class_names){
        let btn = document.createElement("button")
        if(index!="全部"){
            btn.dataset.reorderable = "1"   // 「全部」固定在首位，不参与排序
        }
        btn.classList.add("class_bar_btn")
        if(index == last_group){
            btn.classList.add("active")
        }
        btn.innerHTML = `<span id="class_title">${index}</span>`
        btn.onclick = function(){ 
            change_class(index)
        }
        btn.addEventListener("contextmenu",async function(e) {
            e.preventDefault();
            const oldName = index;
            const oldPos = Array.from(class_btn_bar.children).indexOf(btn);   // 栏里的位置（「全部」占 children[0]）
            var rs = await showFileSelectionDialog(index)
            if(rs && rs.files_data.length > 0){
                if(oldName != rs.title){
                    await ApiHelper.call("remove_class", oldName)
                }
                await ApiHelper.call('add_class', rs.files_data ,rs.title);
                // 改过名字的话：把它留在栏里的原位置。
                // class_order 里没有的分类，后端 read_class 不会返回 → 分类会在栏里"消失"
                // （改名这个坑踩过：user_class.json 里已经改名了，class_order 还留着旧名字）
                if(oldName != rs.title){
                    const order = Array.from(class_btn_bar.children)
                        .map(b => b.id)
                        .filter(n => n !== "全部" && n !== oldName);
                    const at = Math.max(0, oldPos - 1);
                    order.splice(Math.min(at, order.length), 0, rs.title);
                    await ApiHelper.call("save_classOrder", order);
                }
                invalidateClassCache();
                // 必须用**新名字**：用旧名字去过滤，缓存里查不到 → 返回空集合 → 列表整片变空
                change_class(rs.title)
            }
            render_class_btn()
        });
        btn.id = index;
        class_btn_bar.appendChild(btn);
    }
    // 注：「+ 新建分类」按钮是 HTML 里的静态元素（竖栏底部，id=class_bar_btn），
    // 不再跟着分类列表一起重建——否则每次 render 都会把它的点击绑定丢掉。
    fit_btnBar()
    // 滚轮切过来的分类：按钮重建完了，下一帧把选中项滚进可视区
    if(_railScrollTo){
        const _target = _railScrollTo
        _railScrollTo = null
        requestAnimationFrame(function(){ railEnsureVisible(_target) })
    }
}
/* 滚轮切分类后要把选中项滚进可视区。
   必须挂在按钮重建之后：class_filter → render_class_btn 里的 innerHTML=''
   会把栏的 scrollTop 冲成 0，所以这里只记下目标，由 render_class_btn 收尾时执行。 */
let _railScrollTo = null;
/* 返回 true = 已经处理完（滚动过了、或本来就不需要滚）；false = 按钮还没就绪，等下次。
   做法是"居中"而不是"贴顶"：贴顶对测量误差（缩放/滚动区上沿的零头）很敏感，
   差几个像素就会把选中项裁掉一条；居中留了余量，几像素的误差看不出来。 */
function railEnsureVisible(name){
    if(!name) return true;
    const bar = document.getElementById("class_bar");
    if(!bar) return true;
    if(bar.scrollHeight <= bar.clientHeight + 1) return true;       // 栏内不需要滚动
    const btn = document.getElementById(name);
    if(!btn || !btn.classList.contains('active')) return false;    // 期间又切过 / 还没就绪
    const b = btn.getBoundingClientRect(), c = bar.getBoundingClientRect();
    if(b.top >= c.top && b.bottom <= c.bottom) return true;         // 已经在可视区内，不动
    const want = bar.scrollTop + (b.top - c.top) - (bar.clientHeight - b.height) / 2;
    const maxTop = bar.scrollHeight - bar.clientHeight;
    bar.scrollTop = Math.max(0, Math.min(Math.round(want), maxTop));
    return true;
}

/* 分类顺序（不含栏底的「+ 新建分类」按钮——它在 class_bar 之外）。
   注意「全部」只能出现一次：render_class_btn 渲染出来的第一个按钮 id 就是
   "全部"，如果这里再固定加一个 "全部"，列表里就会出现两个「全部」，
   按下标步进（滚轮切换）时从「全部」往下走会走到那个重复项、等于没切。 */
function class_names_list(){
    const names = ["全部"];
    for(const b of class_btn_bar.children){
        if(b.id && b.id !== "全部" && names.indexOf(b.id) < 0) names.push(b.id);
    }
    return names;
}
/* 分类翻页的方向：1 = 往后翻（新页从右边进来），-1 = 往回翻 */
function classFlipDir(prev, next){
    const names = class_names_list();
    const a = names.indexOf(prev), b = names.indexOf(next);
    if(a < 0 || b < 0 || a === b) return 1;
    return b > a ? 1 : -1;
}

/* 【动效】分类切换做成"手机桌面翻页"：旧内容朝一侧退场 → 过滤生效 → 新内容从另一侧入场。
   全程只动 transform/opacity（合成器合成），不复制 DOM、不触发重排；
   两段 110ms + 190ms，沿用 M3 的"退场快、进场稍慢"节奏。
   纵向翻的一版已废弃，keyframes 也从 frame.css 删除，要再试就照这套类名补一组 translateY 的。
   flipSeq 防连点：新的一次切换开始后，旧的那次在 await 点直接让位。 */
const PAGE_FLIP_CLASSES = ['ed-page-out-left', 'ed-page-out-right', 'ed-page-in-left', 'ed-page-in-right'];
let flipSeq = 0;
async function class_flip(title, dir){
    const my = ++flipSeq;
    const boxes = [DOMCache.get('filesContainer'), DOMCache.get('filesListContainer')].filter(Boolean);
    if(!boxes.length){ await class_filter(title); return; }
    const outCls = dir >= 0 ? 'ed-page-out-left' : 'ed-page-out-right';
    const inCls  = dir >= 0 ? 'ed-page-in-right' : 'ed-page-in-left';
    boxes.forEach(b => b.classList.remove(...PAGE_FLIP_CLASSES));
    boxes.forEach(b => b.classList.add(outCls));
    await new Promise(r => setTimeout(r, 110));
    if(my !== flipSeq) return;
    boxes.forEach(b => b.classList.remove(outCls));
    await class_filter(title);              // 真正的过滤在这里同步生效
    if(my !== flipSeq) return;
    if(boxes[0]) void boxes[0].offsetWidth; // 保证入场动画能重新播放
    boxes.forEach(b => b.classList.add(inCls));
    await new Promise(r => setTimeout(r, 190));
    if(my !== flipSeq) return;
    boxes.forEach(b => b.classList.remove(inCls));
}

async function change_class(title){
    for(let e of class_btn_bar.children){
        if(e.id==title){
            e.className = "class_bar_btn active";
        }else{
            e.className = "class_bar_btn"
        }
    }
    const prev = last_group;
    last_group = title;
    // 【闪屏修复】原先这里没有 await，调用方以为过滤已完成、提前揭开遮盖 → 闪出「全部」
    try{
        await class_flip(title, classFlipDir(prev, title));
    }catch(e){
        console.error("class_filter 失败:", e);
    }
}
async function delete_class(cid){
    await ApiHelper.call("remove_class",cid)
    invalidateClassCache();
    render_class_btn()
    last_group = "全部"
    await class_filter(last_group)
}
/* 【分类栏｜左侧竖向栏】
   原来是"双层 90° 旋转把竖排凑成横排 + 负 marginTop 把内容拉回顶部"，
   几何补偿全靠这里写死，窗口尺寸一变就容易错位。改成真竖排后不需要补偿了，
   这个函数只剩一件事：把分类列表的最大高度限制在当前可视区内，
   多出来的分类在栏内滚动（而不是把整块面板撑出滚动条）。 */
async function fit_btnBar() {
    const bar = document.getElementById("class_bar")
    if(!bar) return
    // body 在用户设置下会被 zoom（scale%），innerHeight 是未缩放的可视高度，
    // 除以 zoom 才得到布局像素下的可视高度（和 ConfigManager.updateScale 里
    // “100/realScale vh”是同一个换算）。
    const zoom = parseFloat(document.body.style.zoom) || 1
    const visible = window.innerHeight / zoom
    const head = document.querySelector(".header")
    const headH = (head ? head.offsetHeight : 51) + 15 + 20  // header 高 + 下间距 + main 上外边距
    const ADD_BTN = 44                                        // 底部"+ 新建分类"按钮（含与列表的间距）
    const maxH = Math.max(160, Math.round(visible - headH - ADD_BTN - 20))
    bar.style.maxHeight = maxH + "px"
}
// 【性能优化】原先这里用 setInterval(fit_btnBar,200) 每 200ms 无条件跑一次，
// 里面全是 offsetWidth/offsetHeight 读取 → 每 5 秒强制一次同步重排，且永不停止。
// 改成：尺寸真正变化时（ResizeObserver / 窗口缩放）才跑，并用 rAF 合并同一帧内的多次触发。
let _fitRafId = null;
function requestFitBtnBar(){
    if(_fitRafId !== null) return;
    _fitRafId = requestAnimationFrame(() => {
        _fitRafId = null;
        fit_btnBar();
    });
}
if(typeof ResizeObserver !== "undefined"){
    const _fitObserver = new ResizeObserver(requestFitBtnBar);
    for(const _id of ["main", "class_bar", "box1"]){
        const _el = document.getElementById(_id);
        if(_el) _fitObserver.observe(_el);
    }
}
window.addEventListener("resize", requestFitBtnBar);
document.getElementById("class_bar_btn").addEventListener("click", add_class);

/* 【竖向栏】滚轮切分类。
   规则：**先滚列表，滚到头才切分类**——
   栏内还能往这个方向滚时，滚轮交还给浏览器滚列表；已经滚到底/顶了，
   再用它切上一个/下一个分类（下滚=下一个）。
   这样"分类多到要滚"和"滚轮切分类"两个需求都满足，不会互相打架。
   注意：判定要按"能否继续滚"而不是"是否有溢出"，否则栏里只要多出
   几十像素就永远切不了分类了（分类栏天生就贴着可视高度）。 */
(function initRailWheelSwitch(){
    const rail = document.getElementById("box1")
    const bar = document.getElementById("class_bar")
    if(!rail || !bar) return
    let last = 0
    rail.addEventListener("wheel", function(e){
        const dir = e.deltaY > 0 ? 1 : -1
        const canScroll = dir > 0
            ? (bar.scrollTop + bar.clientHeight < bar.scrollHeight - 1)
            : (bar.scrollTop > 1)
        if(canScroll) return                       // 栏内还能滚 → 不接管
        e.preventDefault()
        const now = Date.now()
        if(now - last < 200) return
        last = now
        const names = class_names_list()
        let i = names.indexOf(last_group)
        if(i < 0) i = 0
        i += dir
        if(i < 0) i = names.length - 1
        if(i > names.length - 1) i = 0
        const next = names[i]
        if(!next || next === last_group) return
        _railScrollTo = next          // 兜底：万一这轮会重建按钮，交给 render_class_btn 收尾处理
        change_class(next)
        // 正常情况按钮不重建（applyClassFilter 只改条目的 display），下一帧直接滚；
        // 动画期间还有别的布局变动会把滚动位置带偏，所以过一会儿再幂等校正一次。
        requestAnimationFrame(function(){ if(railEnsureVisible(next)) _railScrollTo = null })
        setTimeout(function(){ railEnsureVisible(next) }, 280)
    }, { passive: false })
})();

