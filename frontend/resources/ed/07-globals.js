// ========== 全局变量 ==========
let files_data = [];
let selectedFile = null;
let contextMenu = null;
let dealing = false;
let currentPath = '';
let pathHistory = [];
let currentHistoryIndex = -1;
let timer = null;
let db_click_action = false;
let in_edit = false;
let window_state = false
const scripts_type = CONSTANTS.SCRIPT_TYPES;
const blankMenu = DOMCache.get('blankMenu');
const newFileOverlay = DOMCache.get('newFileOverlay');
const newFileTypeSelect = DOMCache.get('newFileTypeSelect');
const newFileCancel = DOMCache.get('newFileCancel');
const newFileConfirm = DOMCache.get('newFileConfirm');
const menuPaste = DOMCache.get('menuPaste');
const menuNew = DOMCache.get('menuNew');

// ========== 全局函数 ==========
function getFileType(fileName, fileType) {
    return Utils.getFileType(fileName, fileType);
}

/**
 * 显示文件选择对话框
 * @returns {Promise<Object>} 包含选中文件列表和分类名的对象
 */
/* 当前打开的「分类设置」对话框的取消入口；没打开时为 null */
let _fileSelectorCancel = null;
/* Rust 侧 hide_panel() 在真正隐藏窗口前 eval 这个，收起面板即取消对话框 */
window.edOnPanelHide = function(){
    panel_hidden = true;
    if(_fileSelectorCancel) _fileSelectorCancel();
    cancelImagePreview();
    schedulePreviewCacheClear();
};

async function showFileSelectionDialog(class_name=null) {
    return new Promise(async (resolve) => {
        setTimeout(enableScroll,200)
        ApiHelper.call("unlock_window_visibility")
        let del_btn = document.getElementById("fileSelectionDelete")
        let list_data = []
        if(class_name!=null){
            let class_data = await ApiHelper.call('read_class', class_name)
            for(item of class_data.files){
                list_data.push(Utils.generateFileId(item.filePath))
            }
            del_btn.style.display="block"
            del_btn.dataset.cid = class_name
        }else{
            document.getElementById("fileSelectionDelete").style.display="none"
        }
        // 获取对话框元素
        const dialogContainer = document.getElementById('fileSelectionDialog');
        const overlay = document.querySelector('.file-selection-overlay');
        const dialogContent = dialogContainer.querySelector('.file-selection-content');
        const fileSelectionList = document.getElementById('fileSelectionList');
        const categoryInput = document.getElementById('categoryInput');
        const categoryErrorMsg = document.getElementById('categoryErrorMsg');
        const cancelBtn = dialogContainer.querySelector('.file-selection-btn');
        const confirmBtn =document.getElementById("fileSelectionConfirm")
        const del_action = async function del_this_class(){
            delete_class(del_btn.dataset.cid)
            handleCancel()
        }
        // 重置对话框状态
        fileSelectionList.innerHTML = '<div class="loading-indicator">加载中...</div>';
        if(class_name!=null){
            categoryInput.value = class_name;
            // 每次打开都新建闭包，直接 remove 旧引用删不掉 → 用元素上的引用记住上一次绑的函数
            if(del_btn._delAction) del_btn.removeEventListener("click", del_btn._delAction, false);
            del_btn._delAction = del_action;
            del_btn.addEventListener("click",del_action,false)
        }else{
            categoryInput.value = '';
        }
        categoryErrorMsg.style.display = 'none';
        categoryErrorMsg.textContent = '';
        // 清空上次的搜索内容：否则下次打开对话框时搜索框还残留上次搜的词
        const csSearchBox = document.getElementById('cs_search_box');
        if (csSearchBox) {
            csSearchBox.value = '';
        }

        // 显示对话框
        // dialogContainer.style.display = 'flex';
        Utils.uiBoxDisplayChange(dialogContainer,"flex",true)

        // 禁用背景滚动
        UIUtils.disableScroll();

        // 初始化变量
        let selections = [];
        const checkedState = new Map();
        /* 面板收起时由 Rust 侧调 window.edOnPanelHide，把这层浮层一起取消掉，
           否则下次唤起会停在"分类设置还开着、但外面的世界已经换了"的状态。
           这里就登记好（handleCancel 是函数声明，已提升），不等列表渲染完，
           免得渲染那次 await 里收起面板会漏掉钩子 */
        _fileSelectorCancel = handleCancel;

        try {
            // 获取文件信息
            const result = await ApiHelper.getFileInfo(AppState.currentPath);
            selections = result.data;

            // 清空加载提示
            fileSelectionList.innerHTML = '';

            // 已选中的排到最前面，一眼能看出这个分类里已经放了哪些；
            // sort 是稳定的，未选中项保持原来的顺序
            const picked = new Set(list_data);
            selections.sort((a, b) =>
                (picked.has(Utils.generateFileId(b.filePath)) ? 1 : 0) -
                (picked.has(Utils.generateFileId(a.filePath)) ? 1 : 0));

            // 渲染每个项目
            selections.forEach(item => {
                const listItem = document.createElement('div');
                listItem.className = 'file-selection-item';

                // 复选框
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.value = item.filePath;
                checkbox.dataset.filePath = item.filePath;

                // 初始状态为未选中
                if(picked.has(Utils.generateFileId(item.filePath))){
                    checkedState.set(item.filePath, true);
                    checkbox.checked = true;
                    listItem.className = 'file-selection-item active';
                }else{
                    checkedState.set(item.filePath, false);
                }

                // 监听勾选状态变化
                checkbox.addEventListener('change', () => {
                    checkedState.set(item.filePath, checkbox.checked);
                });

                // 元素点击监听
                listItem.addEventListener('click', () => {
                    if (checkbox.checked==true) {
                        checkbox.checked = false;
                        listItem.classList.remove('active');
                    } else {
                        checkbox.checked = true;
                        listItem.classList.add('active');
                    }
                    checkedState.set(item.filePath, checkbox.checked);
                });

                // 图标：列表可能上百项，离屏的先不解码，打开对话框更快
                icon = document.createElement('img');
                icon.loading = 'lazy';
                icon.decoding = 'async';
                icon.src = item.fileType=="应用组"?"./resources/imgs/group.png":item.ico;
                

                // 文件名
                const fileName = document.createElement('div');
                fileName.className = 'file-name';
                fileName.textContent = item.fileName;

                // 文件类型
                const fileType = document.createElement('div');
                fileType.className = 'file-type';
                fileType.textContent = item.fileType === '文件夹' ? '文件夹' : item.fileType;

                // 组装列表项
                listItem.appendChild(checkbox);
                listItem.appendChild(icon);
                listItem.appendChild(fileName);
                listItem.appendChild(fileType);
                listItem.dataset.filePath = item.filePath;
                fileSelectionList.appendChild(listItem);
            });

        } catch (error) {
            console.error('获取文件信息失败:', error);
            fileSelectionList.innerHTML = '';

            const errorMsg = document.createElement('div');
            errorMsg.textContent = '获取文件信息失败: ' + error.message;
            errorMsg.className = 'error-message';

            fileSelectionList.appendChild(errorMsg);
        }

        // 取消按钮事件
        function handleCancel() {
            _fileSelectorCancel = null;
            Utils.hideWithMotion(dialogContainer);
            UIUtils.enableScroll();
            resolve({files_data: [], title: ''});
            ApiHelper.call("unlock_window_visibility")
        }

        // 确定按钮事件
        function handleConfirm() {
            const selectedItems = [];
            checkedState.forEach((isChecked, filePath) => {
                if (isChecked) {
                    console.log("checked！")
                    const item = selections.find(item => item.filePath === filePath);
                    if (item) {
                        selectedItems.push(item);
                    }
                }
            });

            // 获取分类名
            const categoryTitle = categoryInput.value.trim();

            // 验证输入
            if (!categoryTitle) {
                categoryErrorMsg.textContent = '分类名不能为空';
                categoryErrorMsg.style.display = 'block';
                return;
            }

            if (selectedItems.length === 0) {
                categoryErrorMsg.textContent = '请选择至少一个文件或文件夹';
                categoryErrorMsg.style.display = 'block';
                return;
            }

            categoryErrorMsg.style.display = 'none';
            _fileSelectorCancel = null;
            Utils.hideWithMotion(dialogContainer);
            UIUtils.enableScroll();
            resolve({files_data: selectedItems, title: categoryTitle});
            ApiHelper.call("unlock_window_visibility")
        }

        // 点击对话框外部关闭
        function handleOverlayClick(e) {
            if (e.target === overlay) {
                _fileSelectorCancel = null;
                Utils.hideWithMotion(dialogContainer);
                UIUtils.enableScroll();
                resolve({files_data: [], title: ''});
                ApiHelper.call("unlock_window_visibility")
            }
        }

        // 绑定事件
        cancelBtn.addEventListener('click', handleCancel);
        confirmBtn.addEventListener('click', handleConfirm);
        overlay.addEventListener('click', handleOverlayClick);

        // 清理事件监听器
        function cleanup() {
            cancelBtn.removeEventListener('click', handleCancel);
            confirmBtn.removeEventListener('click', handleConfirm);
            overlay.removeEventListener('click', handleOverlayClick);
        }

        // 确保在对话框关闭时清理事件
        const observer = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.attributeName === 'style' && dialogContainer.style.display === 'none') {
                    cleanup();
                    // 关掉后把整份列表从 DOM 摘掉：上百个条目连同解码后的图标
                    // 若一直留着，面板隐藏期间会白白占用内存；下次打开会重新构建
                    fileSelectionList.replaceChildren();
                    observer.disconnect();
                }
            });
        });

        observer.observe(dialogContainer, { attributes: true });
    });
}
async function run_fileSelector_search(){
    const fileSelectionList = document.getElementById('fileSelectionList');
    const input_box = document.getElementById('cs_search_box');
    if(input_box.value==""){
        for(let c of fileSelectionList.children){
            c.style.display = "flex";
        }
    }else{
        let result =  await SearchManager.performSearch(input_box.value,false)
        // 转为列表
        result_list = []
        for(let i of result){
            result_list.push(i.filePath)
        }
        for(let c of fileSelectionList.children){
            if(result_list.includes(c.dataset.filePath)){
                c.style.display = "flex";
            }else{
                c.style.display = "none";
            }
        }
    }
}

function open_file(filePath) {
    window.pywebview.api.open_file(filePath);
}

function open_mhyGame(filePath, game) {
    window.pywebview.api.open_mhyGame(filePath, game);
}

function copy_file(filePath) {
    window.pywebview.api.copy_file(filePath);
}

async function rename_file(filePath, newName) {
    return await FileOperationManager.renameFile(filePath, newName);
}

async function remove_file(filePath) {
    return await FileOperationManager.removeFile(filePath);
}

async function remove_file_r(filePath) {
    return await FileOperationManager.removeFile(filePath, "rubbish");
}

async function showContextMenu(e, file) {
    await MenuManager.showContextMenu(e, file);
}

function hideContextMenu() {
    MenuManager.hideContextMenu();
}

function showRenameDialog() {
    EventManager.showRenameDialog();
}

function showDeleteConfirm() {
    EventManager.showDeleteConfirm();
}

async function push(fData = null, useLoadDir = false, path = '') {
    console.log("11")
    let pushAllowIds = null;
    try {
        if (fData === null) {
            let result;
            if((useLoadDir==true && (path=="" || path=="desktop")) || fData==null){
                document.getElementById("box1").style.display = "block"
                // 【闪屏修复】原先在 render 之前对旧 DOM 做过滤（render 会重建 DOM，等于白做）
                pushAllowIds = await getClassIdSet(last_group);
            }else{
                document.getElementById("box1").style.display = "none"
            }
            render_class_btn()
            fit_btnBar()
            if (useLoadDir && path) {
                result = await ApiHelper.getFileInfo(path);
                AppState.currentPath = path;
                AppState.setFiles(result.data);
            } else {
                result = await ApiHelper.getFileInfo("desktop");
                AppState.setFiles(result.data);
            }
            fData = result.data;
        }

        // 同步全局变量
        files_data = fData;
        currentPath = AppState.currentPath;

        await fileRenderer.render(fData,null,true,pushAllowIds);
        AppState.contextMenu = DOMCache.get('contextMenu');

    } catch (error) {
        window.pywebview.api.bug_report("push", error.toString()+"\n"+error.stack.toString());
        console.error(error);
    }
}
let preview_runing = false
let preview_gen = 0
let panel_hidden = false
let _previewCacheClearTimer = null
// 【性能优化】图片缩略图结果缓存：重渲染时直接复用，不再为每个图片重复一次
// 「PIL 解码 + 缩放 + JPEG 编码 + base64」的跨桥 IPC（原先每次刷新都全量重算）
const imgPreviewCache = new Map()
let imgPreviewCacheBytes = 0
// base64 在 JS 里按 UTF-16 计，8M 字符约 16MB
const IMG_PREVIEW_CACHE_MAX_CHARS = 8 * 1024 * 1024

function clearImgPreviewCache(){
    imgPreviewCache.clear()
    imgPreviewCacheBytes = 0
}

function imgPreviewCacheGet(key){
    if(!imgPreviewCache.has(key)) return undefined
    const value = imgPreviewCache.get(key)
    // Map 插入序当 LRU：命中后挪到队尾
    imgPreviewCache.delete(key)
    imgPreviewCache.set(key, value)
    return value
}

function imgPreviewCacheSet(key, value){
    if(imgPreviewCache.has(key)){
        const old = imgPreviewCache.get(key)
        imgPreviewCacheBytes -= old ? old.length : 0
        imgPreviewCache.delete(key)
    }
    imgPreviewCache.set(key, value)
    if(value) imgPreviewCacheBytes += value.length
    while(imgPreviewCacheBytes > IMG_PREVIEW_CACHE_MAX_CHARS && imgPreviewCache.size > 1){
        const oldest = imgPreviewCache.keys().next().value
        const old = imgPreviewCache.get(oldest)
        imgPreviewCacheBytes -= old ? old.length : 0
        imgPreviewCache.delete(oldest)
    }
}

function restorePreviewIcons(){
    document.querySelectorAll('img[data-ed-original-src]').forEach(img => {
        img.src = img.dataset.edOriginalSrc
        delete img.dataset.edOriginalSrc
    })
}

function cancelImagePreview(){
    preview_gen++
    preview_runing = false
}

function schedulePreviewCacheClear(){
    if(_previewCacheClearTimer) clearTimeout(_previewCacheClearTimer)
    // 短暂收起再呼出时保留缓存；隐藏超过 15 秒才真正释放
    _previewCacheClearTimer = setTimeout(async () => {
        _previewCacheClearTimer = null
        if(!panel_hidden) return
        cancelImagePreview()
        restorePreviewIcons()
        clearImgPreviewCache()
        try { await ApiHelper.call("clear_preview_cache") } catch(e) { console.log("clear preview cache error") }
    }, 15000)
}

window.edOnPanelShow = function(){
    panel_hidden = false
    if(_previewCacheClearTimer){
        clearTimeout(_previewCacheClearTimer)
        _previewCacheClearTimer = null
    }
    // 隐藏超过 15 秒会清掉缓存并还原图标；若此次呼出走的是“数据没变”快路径，
    // 不会触发重渲染，需要在这里把预览图补回来
    image_preview()
}

async function image_preview() {
    if(preview_runing) return;
    preview_runing = true;
    const gen = ++preview_gen;
    try{
        let config = await ApiHelper.getConfig()
        if(gen !== preview_gen) return;
        if(config["imgpre"]==false)return
        for(let file of AppState.files_data){
            if(gen !== preview_gen) return;
            if(![".png",".jpg",".jpeg",".bmp",".gif"].includes(file.fileType)) continue;
            const el = document.getElementById(Utils.generateFileId(file.filePath));
            // 元素不存在（未渲染 / 已被过滤）时跳过，避免原代码里 te 为 null 直接抛错
            // 中断整个预览循环
            if(!el || !el.children || !el.children[1]) continue;
            let view_img = imgPreviewCacheGet(file.filePath);
            if(view_img === undefined){
                view_img = await ApiHelper.call("get_imageBase64", file.filePath);
                if(gen !== preview_gen) return;
                imgPreviewCacheSet(file.filePath, view_img || null);
            }
            if(view_img){
                const iconEl = el.children[1];
                if(!iconEl.dataset.edOriginalSrc) iconEl.dataset.edOriginalSrc = iconEl.src;
                iconEl.src = view_img
            }
        }
    }catch(e){
        console.log("image_preview error")
    }finally{
        if(gen === preview_gen) preview_runing = false;
    }
}
async function change_cl_state(filePath, cl){
    await ApiHelper.call('change_cl_state', filePath, cl);
    NavigationManager.refreshCurrentPath();
}

async function set_scale(value) {
    await ConfigManager.updateScale(value);
}

async function pack_df_dir_settings() {
    await ConfigManager.updateDefaultDirectory();
}

function navigateTo(path) {
    NavigationManager.navigateTo(path);
}

async function updateBreadcrumb(path) {
    await NavigationManager.updateBreadcrumb(path);
}

function navigateBack() {
    if (AppState.currentHistoryIndex > 0) {
        AppState.currentHistoryIndex--;
        const path = AppState.pathHistory[AppState.currentHistoryIndex];
        AppState.currentPath = path;
        currentPath = path;
        NavigationManager.navigateTo(path);
    }
}

function navigateForward() {
    if (AppState.currentHistoryIndex < AppState.pathHistory.length - 1) {
        AppState.currentHistoryIndex++;
        const path = AppState.pathHistory[AppState.currentHistoryIndex];
        AppState.currentPath = path;
        currentPath = path;
        NavigationManager.navigateTo(path);
    }
}

async function loadDirectory(path) {
    try {
        const data = await ApiHelper.getFileInfo(path);
        return data.data;
    } catch (error) {
        console.error('Error loading directory:', error);
        return [];
    }
}

async function put_file() {
    return await FileOperationManager.pasteFiles();
}

async function new_file(fileType) {
    return await FileOperationManager.createNewFile(fileType);
}

function hideAllMenus() {
    MenuManager.hideAllMenus();
}

function applyBackgroundSettings(config) {
    ThemeManager.applyBackgroundSettings(config);
}

async function initBackgroundSettings(config=null) {
    if (!config) config = await ApiHelper.getConfig();  // 【启动优化 P1】可复用启动期 config
    const blurSlider = DOMCache.get('blurSlider');
    const blurValue = DOMCache.get('blurValue');

    if (blurSlider && blurValue) {
        blurSlider.value = config.ms_ef;
        blurValue.textContent = blurSlider.value;
    }

    ThemeManager.applyBackgroundSettings(config);
}

function showError(code) {
    UIUtils.showMessage(code);
}

function checkChineseChars(str) {
    return Utils.checkChineseChars(str);
}

function contains(mainStr, searchStr) {
    return Utils.contains(mainStr, searchStr);
}

async function load_search() {
    await SearchManager.performSearch();
}

async function load_theme(theme,from_fit) {

        // 参数验证
        if (!theme) {
            console.warn('load_theme: 主题参数不能为空');
            return false;
        }

        // 验证主题是否存在
        if (!CONSTANTS.THEME_PATHS[theme]) {
            console.warn(`load_theme: 不支持的主题 "${theme}"`);
            return false;
        }

        // 获取主题CSS元素
        const themeCSS = DOMCache.get("theme_css");
        if (!themeCSS) {
            console.error('load_theme: 找不到主题CSS元素');
            return false;
        }
        if(from_fit==true){
            if(theme=="dark"){
                let setting_theme = await ApiHelper.getConfig()
                setting_theme = setting_theme["theme"]
                if(setting_theme!="light"){
                    console.log(setting_theme)
                    load_theme(setting_theme)
                    return 
                }
            }
        }
        // 加载主题
        if (themeCSS.getAttribute('href') !== CONSTANTS.THEME_PATHS[theme]) {
            themeCSS.href = CONSTANTS.THEME_PATHS[theme];
        }
        document.documentElement.setAttribute('data-theme', theme);
        if (theme === 'custom') {
            ThemeManager.applyCustomThemeVariables(ThemeManager.customThemeConfig);
        }
        NavigationManager.refreshCurrentPath();
        render_class_btn()
        console.log(`主题已切换到: ${theme}`);
        if(theme=="light"){
            await ApiHelper.call('load_blur_effect', 'Acrylic');
        }else{
            await ApiHelper.call('load_blur_effect', 'Aero');
        }
        ThemeManager.now_theme = theme;
        config = await ApiHelper.getConfig();
        ThemeManager.applyBackgroundSettings(config);
        return true;

}
/* 【毛玻璃 / 磨砂强度】沿用旧版 src/windowMgr.py 的依赖规则：
     磨砂强度要生效，必须同时满足「毛玻璃开启(blur_bg)」且「背景类型不是正常(bgType!="1")」。
   原因：背景为「正常」时 body 铺的是不透明的主题背景（--bg-gradient），
        系统亚克力被完全盖住 —— 毛玻璃和强度本来就都看不见，不是 bug，是不该叠加。
   这里做两件事：① 真正让面板背景半透明，把系统亚克力透出来；
                ② 把这条依赖显式反映到 UI 上：不生效的那一项整行灰显 + 写明原因。 */
/* 滑块填充（左蓝右灰，原版观感）：把当前进度写进 --fill，CSS 的渐变自己画。
   三个滑块（缩放/毛玻璃强度/磨砂强度）共用；事件用委托，不用逐个绑。 */
function paintRangeFill(input){
    if(!input || input.type !== 'range') return;
    const min = parseFloat(input.min) || 0;
    const max = parseFloat(input.max);
    if(!(max > min)) return;
    const p = Math.max(0, Math.min(100, ((parseFloat(input.value) - min) / (max - min)) * 100));
    input.style.setProperty('--fill', p.toFixed(1) + '%');
}
function refreshRangeFills(){
    ['sc_slider', 'blur_ef_input', 'blurSlider'].forEach(function(id){
        paintRangeFill(document.getElementById(id));
    });
}
(function(){
    // 拖动实时刷；任意点击后兜底刷一次（覆盖配置恢复时程序赋值、打开设置面板等情况）
    document.addEventListener('input', function(e){
        if(e.target && e.target.type === 'range') paintRangeFill(e.target);
    });
    document.addEventListener('click', function(){ refreshRangeFills(); });
    refreshRangeFills();
})();

function applyGlassSettings(cfg, silent){
    if(!cfg) cfg = (typeof config !== "undefined" && config) ? config : null;
    if(!cfg) return;
    const strength = Math.max(10, Math.min(100, Math.floor(100 - (Number(cfg.blur_effect) || 0))));
    const bgNormal = String(cfg.bgType) === "1";          // 背景类型 = 正常
    const glassOn  = (cfg.blur_bg === true) && !bgNormal; // 毛玻璃真正生效？

    // ① 背景统一交给 load_bgType 画：透明=全透+模糊、半透明增强=主题色半透明贴面，
    //    两种模式的差异保留在它那里（不能在这层用同一种 rgba 覆盖，否则两种模式长得一样）。
    //    毛玻璃生效时强度参与；没生效时传 null → load_bgType 按原版固定值画。
    const tid = bgNormal ? "1" : String(cfg.bgType);
    const s   = bgNormal ? undefined : (glassOn ? strength : null);
    const r = load_bgType(tid, s);
    if(r && r.then) r.then(function(){});
    // 自定义背景图：只在「正常」模式显示；切到透明/半透明时必须把图层清掉
    // （背景图在 body::before 上，load_bgType 里的 background:"unset" 够不着它）
    if(bgNormal && cfg.use_bg && cfg.bg){
        document.body.style.setProperty('--ed-bg-image', `url("${cfg.bg}")`);
        document.body.style.setProperty('--ed-bg-blur', `${cfg.ms_ef || 0}px`);
    }else{
        document.body.style.removeProperty('--ed-bg-image');
        document.body.style.removeProperty('--ed-bg-blur');
    }
    // ② 系统亚克力：silent=true 时跳过（拖滑块时反复重设会让整个窗口闪一下）
    if(silent !== true){
        ApiHelper.call('set_blur_effect', (cfg.blur_bg === true), ThemeManager.now_theme);
    }

    // ② 灰显 + 原因
    const rowOf = id => {
        const el = document.getElementById(id);
        return el ? (el.closest('.settings-section') || el.parentElement) : null;
    };
    const mark = (row, off, why) => {
        if(!row) return;
        row.classList.toggle('setting-disabled', !!off);
        row.title = off ? why : '';
        let hint = row.querySelector('.setting-why');
        if(off){
            if(!hint){
                hint = document.createElement('div');
                hint.className = 'setting-why';
                row.appendChild(hint);
            }
            hint.textContent = why;
        }else if(hint){
            hint.remove();
        }
    };
    mark(rowOf('blurToggle'), bgNormal, '背景类型为「正常」时毛玻璃不可见，需先把背景设为「透明」或「半透明增强」');
    mark(rowOf('blur_ef_input'), !glassOn,
        bgNormal ? '背景类型为「正常」时磨砂强度不生效' : '请先开启「毛玻璃」');
    // 「磨砂效果强度」(ms_ef)：给自定义背景图加模糊，只有「正常」背景 + 已选图时才有对象
    // （灰的是文字和滑块本身；「选择图片」按钮保持可用，选完图会自动切回正常模式）
    const msOff = !bgNormal || !(cfg.use_bg && cfg.bg);
    const msWhy = bgNormal ? '请先在上方「选择图片」设置自定义背景，磨砂效果才有作用对象'
                           : '背景类型需为「正常」时，自定义背景才会显示';
    [document.querySelector('.blur-label'), document.getElementById('blurSlider')].forEach(function(el){
        if(!el) return;
        el.classList.toggle('setting-disabled', msOff);
        el.title = msOff ? msWhy : '';
    });
}

async function load_bgType(tid, strength){
    // 【磨砂强度】strength 为数字(10~100)时参与绘制（毛玻璃生效时由 applyGlassSettings 传入）；
    // 为 null/不传时按原版固定值：透明=blur(10px)、半透明增强=0.3（正好等于强度 50%）。
    const fromSlider = (typeof strength === "number");
    if(!fromSlider) strength = 50;
    if(tid=="1"){
        document.body.style.background = ""
        document.body.style.backdropFilter = ""   // 原版漏了这条：从「透明」切回「正常」会残留 blur
    }else if(tid=="2"){
        document.body.style.background = "unset"
        // 透明模式：body 的 backdrop-filter 罩不到桌面（WebView 里 body 后面没有页面内容，
        // 桌面磨砂只能靠系统亚克力那一层），所以毛玻璃生效时再叠一层随强度变化的
        // 浅色薄纱，保证强度滑块在这个模式下也有可见反馈；毛玻璃没开时保持原版纯透明。
        if(fromSlider){
            const a2 = Math.max(0, Math.min(0.6, 0.26 + (strength-50)*0.0068)).toFixed(3)   // 10%→0(原版纯透)，50%→0.26，100%→0.6
            const t2 = (ThemeManager.now_theme=='light') ? "255,255,255" : "0,0,0"
            document.body.style.backgroundColor = `rgba(${t2},${a2})`
        }else{
            document.body.style.backgroundColor = "rgba(0,0,0,0)"
        }
        // body 的 backdrop-filter 在这里没有可模糊的对象，纯属全屏空转
        document.body.style.backdropFilter = ""
    }else{
        document.body.style.background = "unset"
        document.body.style.backdropFilter = ""   // 模式3原本就没有 blur，显式清掉防止从模式2切来残留
        const a = Math.max(0.02, Math.min(0.72, 0.3 + (strength-50)*0.008)).toFixed(3)   // 50%≈原版0.3；10%→0.02，100%→0.72，拉大两端差异
        if(ThemeManager.now_theme=='light'){
            document.body.style.backgroundColor = `rgba(255,255,255,${a})`
        }else{
            document.body.style.backgroundColor = `rgba(0,0,0,${a})`
        }
    }
    // 自定义背景图的显隐统一由 applyGlassSettings 管（它每次都按当前 bgType
    // 设置/清空 --ed-bg-image），这里不再重复处理。
}
async function fit_window() {
    if(setting_mode==false){
        await ApiHelper.call('fit_window_start');
    }else{
        await ApiHelper.call('fit_window_end');
    }
}
function setPriorityBtnActive(active) {
    const btn = DOMCache.get('autoStartPriorityBtn');
    if (!btn) return;
    if (active) {
        btn.classList.add('active');
        btn.innerText = '取消快速自启';
    } else {
        btn.classList.remove('active');
        btn.innerText = '启用快速自启';
    }
}
let setting_mode = false
async function disable_settings() {
    setting_mode = true
    DOMCache.get("fit_btn").innerText = "点击完成调整";
    // DOMCache.get("fit_btn").onclick = async function () {
    //     await ApiHelper.call('fit_window_end');
    // };
    DOMCache.get("closeThemePanel").style.display = "none";
    DOMCache.getAllBySelector(".settings-section").forEach((item) => {
        item.style.display = "none";
    });
    DOMCache.getAllBySelector(".setting_note").forEach((item) => {
        item.style.display = "none";
    });
    window.addEventListener("resize",async function(event) {
        await ApiHelper.call('fit_resize');
    });
}

function disableScroll() {
    UIUtils.disableScroll();
}

function enableScroll() {
    UIUtils.enableScroll();
}

function preventDefault(e) {
    const box = DOMCache.get('themeSettings_box');
    const isInsideBox = box.contains(e.target);
    if (!isInsideBox) {
        e.preventDefault();
    }
}

async function remind_file(file_item) {
    UIUtils.remindFile(file_item);
}

// 调试函数：检查和测试滚动功能
function debugScrollFunction() {
    UIUtils.debugScrollStatus();

    // 提供手动测试接口
    console.log('测试滚动功能:');
    console.log('- 执行 UIUtils.disableScroll() 禁用滚动');
    console.log('- 执行 UIUtils.enableScroll() 启用滚动');
    console.log('- 执行 UIUtils.debugScrollStatus() 查看状态');

    return {
        disable: () => UIUtils.disableScroll(),
        enable: () => UIUtils.enableScroll(),
        status: () => UIUtils.debugScrollStatus(),
        isDisabled: () => UIUtils.isScrollDisabled()
    };
}

async function change_default_dir(path = null) {
    ApiHelper.call('lock_window_visibility');
    try {
        const oldPath = AppState.currentPath;
        const config = await ApiHelper.getConfig();
        const oldDfDir = config["df_dir"];
        const result = await ApiHelper.call('change_default_dir', path);

        ApiHelper.call('unlock_window_visibility');

        if (result["success"] === true) {
            DOMCache.get("b2d").dataset.path = result["data"];
            DOMCache.get("b2d").innerText = result["name"];

            await ConfigManager.updateDefaultDirectory();
            DOMCache.get("b2d").click();
            render_class_btn()
        }
    } catch (error) {
        ApiHelper.call('unlock_window_visibility');
        console.error('更改默认目录失败:', error);
    }
}
async function check_dirChange(){
    var now_data = JSON.stringify(files_data);
    var new_data = await ApiHelper.getFileInfo(AppState.currentPath).data
    var new_data = JSON.stringify(new_data.data)
    if(now_data!=new_data){
        NavigationManager.refreshCurrentPath()
    }
}
