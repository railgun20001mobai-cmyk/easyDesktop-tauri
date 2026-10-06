// ========== 常量定义 ==========
const CONSTANTS = {
    SCRIPT_TYPES: [".py", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".rb", ".go", ".swift", ".kt", ".m", ".pl", ".r", ".sh", ".bash", ".zsh", ".lua", ".scala", ".groovy", ".dart", ".rs", ".jl", ".hs", ".f", ".f90", ".f95", ".v", ".vhd", ".clj", ".ex", ".exs", ".elm", ".purs", ".erl", ".hrl", ".fs", ".fsx", ".fsi", ".ml", ".mli", ".pas", ".pp", ".d", ".nim", ".cr", ".cbl", ".cob", ".ada", ".adb", ".ads"],

    FILE_TYPES: {
        'docx': '文档', 'doc': '文档',
        'xlsx': '电子表格', 'xls': '电子表格',
        'pptx': '演示文稿', 'ppt': '演示文稿',
        'pdf': 'PDF文件',
        'jpg': '图片', 'png': '图片',
        'mp4': '视频', 'mp3': '音频',
        'psd': '设计稿', 'fig': '设计稿',
        'sql': '数据库', 'json': '配置文件',
        'zip': '压缩文件', 'exe': '应用程序',
        'SteamGame':"Steam游戏",
        'lnk': "快捷方式",
    },

    THEME_PATHS: {
        "dark": "/theme/theme.css",
        "light": "/theme/theme.css",
        "zzz": "/theme/theme.css",
        "custom": "/theme/theme.css"
    },

    CLICK_DELAY: 200,
    REMIND_DURATION: 1000,
    ERROR_DISPLAY_TIME: 5000
};
const block="block"
// ========== 显示模式管理 ==========
const DisplayModeManager = {
    btn:document.getElementById("displayToggleBtn"),
    wantList:false,
    listViewShown(){
        const l = DOMCache.get('filesListContainer');
        return !!l && l.style.display !== 'none';
    },
    /* 图标表示「点下去会切到哪一面」：窗格页放行图标，行页放窗格图标 */
    syncIcon(){
        this.btn.innerHTML = this.wantList
            ? '<i class="fas fa-th-large"></i>'
            : '<i class="fas fa-list"></i>';
    },
    /* 启动时先和真实视图对齐一次，之后由点击驱动 wantList */
    syncFromDom(){
        this.wantList = this.listViewShown();
        this.syncIcon();
    },
    async toggleDisplayMode(){
        /* 用 wantList 而不是「当前 DOM」来判目标：切换动画要 110ms，这期间 DOM 还没变，
           按 DOM 判会把用户的第二次点击当成重复点击吞掉。wantList 每点必翻转，
           最后一次点击的意图决定最终视图；收尾再按真实 DOM 纠一次，图标就不会说谎。 */
        const toList = !this.wantList;
        this.wantList = toList;
        this.syncIcon();
        if (toList) await this.list_view(); else await this.grid_view();
        this.wantList = this.listViewShown();
        this.syncIcon();
        await ApiHelper.updateConfig("view", this.wantList ? "list" : "block");
    },
    async list_view(){
        await EventManager.switchToListView();
    },
    async grid_view(){
        await EventManager.switchToGridView();
    }
}

// ========== 工具函数模块 ==========
const Utils = {
    /**
     * UIBox Display Change
     */
    async uiBoxDisplayChange(uiBox, display,ani=true) {
        if (uiBox) {

            if (ani) {
                const opening = ['block','flex'].includes(display);
                if(opening)uiBox.style.display = display
                // 打开时递增序号，作废掉上一次可能还在跑的隐藏收尾
                if(opening)uiBox.__edSeq = (uiBox.__edSeq || 0) + 1;
                // 【动效】按元素类型选动画（时长/曲线定义在 theme/frame.css 的 --md-motion-*）：
                //   对话框 → 弹簧进场；右键菜单 → 更快的一档；设置面板 → 侧滑；其余 → 通用淡入
                // 注：类名要看外层容器和它唯一的孩子（下面会把 uiBox 换成孩子），两边都取一下
                const tag = (uiBox.className || '') + ' ';
                if(uiBox.children.length==1){
                    uiBox = uiBox.children[0]
                }
                const kinds = tag + (uiBox.className || '');
                let cls;
                if (/context-menu/.test(kinds)) {
                    cls = opening ? 'quick-in' : 'quick-out';
                } else if (/settings_box|theme-settings/.test(kinds)) {
                    cls = opening ? 'panel-in' : 'fade-out-up';
                } else if (/overlay|modal|container/.test(kinds)) {
                    cls = opening ? 'spring-in' : 'fade-out-up';
                } else {
                    cls = opening ? 'fade-in-up' : 'fade-out-up';
                }
                // 这几个毫秒数必须和 frame.css 里的令牌一致（JS 读不到 CSS 变量）
                const DUR = { 'spring-in': 300, 'panel-in': 300, 'quick-in': 110, 'quick-out': 110, 'fade-in-up': 200, 'fade-out-up': 150 };
                uiBox.classList.add(cls);
                await new Promise(resolve => setTimeout(resolve, DUR[cls] || 200));
                uiBox.classList.remove(cls);
                if(['none'].includes(display))uiBox.style.display = display
            }else{
                uiBox.style.display = display;

            }
        }
    },

    /**
     * 给元素补一次性动效类（用于没走 uiBoxDisplayChange 的显示点）
     * cls / dur 见 theme/frame.css 的 --md-motion-* 令牌
     */
    playMotion(el, cls, dur) {
        if (!el || !cls) return;
        el.classList.remove(cls);
        void el.offsetWidth; // 强制重排，连续触发时动画能重新播放
        el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), dur || 300);
    },

    /**
     * 有头有尾：按动效收起元素（已经是隐藏状态的直接跳过）
     * 关闭路径本来自己会设 display='none'，改成调用这个，就不会"有头没尾"了。
     */
    async hideWithMotion(el, dur) {
        if (!el || el.style.display === 'none') return;
        const cls = /context-menu/.test(el.className || '') ? 'quick-out' : 'fade-out-up';
        // 每次隐藏/打开都递增序号：淡出期间又被打开的话，这次收尾就作废，
        // 否则会出现"刚打开的对话框被上一次的隐藏收尾关掉"
        const my = (el.__edSeq = (el.__edSeq || 0) + 1);
        el.classList.add(cls);
        await new Promise(r => setTimeout(r, dur || (cls === 'quick-out' ? 110 : 150)));
        if (el.__edSeq !== my) return;
        el.classList.remove(cls);
        el.style.display = 'none';
    },

    /**
     * 网格/列表视图互换：旧视图淡出缩小 → 新视图放大淡入（两个方向都有动效）
     * 新视图的子项由 CSS 的 .ed-view-in > * 依次落入
     */
    async swapView(showId, hideId, showDisplay) {
        const show = DOMCache.get(showId), hide = DOMCache.get(hideId);
        if (!show || !hide) return;
        // 连点保护：新的一次切换开始后，旧的这次在 await 点让位（和分类翻页同理）
        const my = (Utils.__viewSeq = (Utils.__viewSeq || 0) + 1);
        if (hide.style.display !== 'none') {
            hide.classList.add('ed-view-out');
            await new Promise(r => setTimeout(r, 110));
            // 让位也必须把淡出类摘掉：edViewOut 带 fill:both，留在元素上就是
            // 永久 opacity:0。连点时被打断的那次正是「要被显示的那一个」，
            // 于是整个视图区变成全白（脚本还活着，只是看不见）。
            if (Utils.__viewSeq !== my) { hide.classList.remove('ed-view-out'); return; }
            hide.classList.remove('ed-view-out');
            hide.style.display = 'none';
        }
        if (Utils.__viewSeq !== my) return;
        // 上一轮可能没来得及摘干净，进场前先清一次淡出类
        show.classList.remove('ed-view-out');
        show.style.display = showDisplay || 'block';
        show.classList.add('ed-view-in');
        setTimeout(() => show.classList.remove('ed-view-in'), 260);
    },
    /**
     * 获取文件类型显示名称
     */
    getFileType(fileName, fileType) {
        if (fileType == '文件夹') return '文件夹';
        if (fileType == 'SteamGame') return 'Steam游戏';
        // console.log(fileType)

        const ext = fileName.split('.').pop().toLowerCase();
        if (CONSTANTS.SCRIPT_TYPES.includes(ext)) {
            return fileType.slice(1) + '脚本文件';
        }

        return CONSTANTS.FILE_TYPES[ext] || fileType.slice(1) + '文件';
    },

    /**
     * 生成文件DOM元素ID
     */
    generateFileId(filePath) {
        return filePath.replace(/[\\/:]/g, '-');
    },

    /**
     * 检查中文字符
     */
    checkChineseChars(str) {
        const chineseRegex = /[\u4e00-\u9fa5]/;
        const nonChineseRegex = /[^\u4e00-\u9fa5]/;
        const hasChinese = chineseRegex.test(str);
        const hasNonChinese = nonChineseRegex.test(str);

        if (!hasChinese) return { have_cn: false };

        if (hasChinese && !hasNonChinese) {
            return { have_cn: true, origin: str, fix: str };
        }

        const chineseOnly = str.split('').filter(c => chineseRegex.test(c)).join('');
        return { have_cn: true, origin: str, fix: chineseOnly };
    },

    /**
     * 字符串包含检查（忽略特殊字符）
     */
    contains(mainStr, searchStr) {
        const cleanMainStr = mainStr.replace(/[^\w\u4e00-\u9fa5]/g, '');
        const cleanSearchStr = searchStr.replace(/[^\w\u4e00-\u9fa5]/g, '');
        const regex = new RegExp(cleanSearchStr, 'i');
        return regex.test(cleanMainStr);
    },

    /**
     * 防抖函数
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

// ========== 应用状态管理 ==========
const AppState = {
    files_data: [],
    filter_data:[],
    selectedFile: null,
    contextMenu: null,
    dealing: false,
    currentPath: '',
    pathHistory: [],
    currentHistoryIndex: -1,
    timer: null,
    db_click_action: false,
    in_edit: false,
    /* 当前真正生效的搜索关键词。多处代码只把输入框清空、不重新渲染，
       于是出现"框里没字、列表还是上次搜索结果"；用这个字段判断视图是否需要同步。 */
    searchKey: '',

    reset() {
        this.files_data = [];
        this.selectedFile = null;
        this.dealing = false;
        this.db_click_action = false;
        this.in_edit = false;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    },

    setFiles(files) {
        this.files_data = files;
    },

    setSelectedFile(file) {
        this.selectedFile = file;
    },

    addToHistory(path) {
        this.pathHistory = this.pathHistory.slice(0, this.currentHistoryIndex + 1);
        this.pathHistory.push(path);
        this.currentHistoryIndex = this.pathHistory.length - 1;
        this.currentPath = path;
    }
};

// ========== DOM元素缓存 ==========
const DOMCache = {
    elements: {},

    get(id) {
        if (!this.elements[id]) {
            this.elements[id] = document.getElementById(id);
        }
        return this.elements[id];
    },

    getBySelector(selector) {
        return document.querySelector(selector);
    },

    getAllBySelector(selector) {
        return document.querySelectorAll(selector);
    }
};

// ========== API调用封装 ==========
const ApiHelper = {
    async call(method, ...args) {
        var result = await window.pywebview.api[method](...args);
        return result;
    },

    async getConfig() {
        return await this.call('get_config');
    },

    async updateConfig(key, value) {
        return await this.call('update_config', key, value);
    },

    async getFileInfo(path,quick=true,ign_icno=false) {
        var data = await this.call('get_fileinfo', path,quick,ign_icno);
        AppState.filter_data = data["filter_data"];
        return data;
    },

    async openFile(filePath) {
        return await this.call('open_file', filePath);
    },

    async showFile(filePath) {
        return await this.call('show_file', filePath);
    },

    async copyFile(filePath) {
        return await this.call('copy_file', filePath);
    },

    async renameFile(filePath, newName) {
        return await this.call('rename_file', filePath, newName);
    },

    async removeFile(filePath, type = "remove") {
        return await this.call('remove_file', filePath, type);
    },

    async newFile(fileType, currentPath) {
        return await this.call('new_file', fileType, currentPath);
    },

    async putFile(targetPath) {
        return await this.call('put_file', targetPath);
    },

    async loadSearchIndex(data) {
        return await this.call('load_search_index', data);
    },

    async cleanTemp() {
        await this.call('clean_temp');
        clearImgPreviewCache();
        if(typeof invalidateClassCache === "function") invalidateClassCache();
        _desktopPathCache = null;
        UIUtils.showMessage("缓存清理完成",false)
        NavigationManager.refreshCurrentPath();
    },
};

// ========== UI工具类 ==========
const loadingUI = {
    wait:{},
    closeList:[],
    closeAll(){
        for(var i of this.closeList){
            i()
        }
    },
    showLoading(container){
        var wid = setTimeout(()=>{
            var close_func = this.loading_action(container)
            this.closeList.push(close_func);
        },500)
        this.wait[container.id] = wid;
    },
    sets(area,view){
        if(area=="items_ctn"){
            if(view==true){
                this.showLoading(DOMCache.get("filesContainer"))
                this.showLoading(DOMCache.get("filesListContainer"))
            }else{
                this.clearLoading(DOMCache.get("filesContainer"))
                this.clearLoading(DOMCache.get("filesListContainer"))
            }
        }
    },
    loading_action(container) {
        if(container.children.length>0){
            return function hideLoading() {};
        }
        // 确保容器有定位上下文，以便内部绝对定位生效
        if (getComputedStyle(container).position === 'static') {
            container.style.position = 'relative';
        }
        container.style.minHeight = `${window.innerHeight-container.getBoundingClientRect().top}px`;
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
        `;
        // 创建内容包裹层（用于转圈和文字）
        const content = document.createElement('div');
        content.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
            color: #2196F3;
        `;

        // 创建转圈元素（使用CSS动画）
        const spinner = document.createElement('div');
        spinner.style.cssText = `
            width: 40px;
            height: 40px;
            border: 4px solid rgba(0, 0, 0, 0.1);
            border-left-color: #007bff;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin-bottom: 12px;
        `;

        // 创建文字元素
        const text = document.createElement('div');
        text.textContent = '加载中...';
        text.style.cssText = `
            font-size: 14px;
            font-weight: 500;
            letter-spacing: 0.5px;
        `;

        // 组装结构
        content.appendChild(spinner);
        content.appendChild(text);
        overlay.appendChild(content);
        container.appendChild(overlay);

        // 注入旋转动画的keyframes（仅注入一次）
        if (!document.getElementById('loading-spinner-style')) {
            const style = document.createElement('style');
            style.id = 'loading-spinner-style';
            style.textContent = `
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            `;
            document.head.appendChild(style);
        }

        // 返回一个移除加载提示的函数，方便调用者控制隐藏
        return function hideLoading() {
            if (overlay.parentNode === container) {
            container.removeChild(overlay);
            }
        };
    },
    clearLoading(container){
        container.style.minHeight = ""
        clearTimeout(this.wait[container.id])
        this.closeAll()
    },
}
const UIUtils = {
    showMessage(message,isErr=true) {
        const errorBox = document.createElement('div');
        Object.assign(errorBox.style, {
            position: 'fixed',
            top: '-100px',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '20px 30px',
            backgroundColor: isErr?'#ff4d4d':'#2196F3',
            color: 'white',
            fontSize: '16px',
            borderRadius: '12px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            zIndex: '9999',
            opacity: '0',
            transition: 'opacity 0.5s ease, top 0.5s ease',
            textAlign: 'center'
        });

        const text = document.createElement('div');
        text.textContent = message;
        errorBox.appendChild(text);
        document.body.appendChild(errorBox);

        setTimeout(() => {
            errorBox.style.top = '20px';
            errorBox.style.opacity = '1';
        }, 100);

        setTimeout(() => {
            errorBox.style.opacity = '0';
            errorBox.style.top = '-100px';
            setTimeout(() => errorBox.remove(), 500);
        }, CONSTANTS.ERROR_DISPLAY_TIME);
    },

    remindFile(fileElement) {
        if (!fileElement) return;
        fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        fileElement.classList.add("file-item_hover");
        setTimeout(() => {
            fileElement.classList.remove("file-item_hover");
        }, CONSTANTS.REMIND_DURATION);
    },
    remindFiles(fileElements) {
        fileElements.forEach(fileElement => {
            this.remindFile(fileElement);
        });
    },

    // 滚动控制相关的私有变量
    _scrollDisabled: false,
    _preventScrollHandler: null,
    _savedScrollPosition: { top: 0, left: 0 },
    _originalBodyStyles: null,

    disableScroll() {
        if (this._scrollDisabled) return; // 避免重复禁用

        this._scrollDisabled = true;

        // 保存当前滚动位置
        this._savedScrollPosition.top = window.pageYOffset || document.documentElement.scrollTop;
        this._savedScrollPosition.left = window.pageXOffset || document.documentElement.scrollLeft;

        const body = document.body;
        const html = document.documentElement;

        // 保存原始样式
        this._originalBodyStyles = {
            overflow: body.style.overflow,
            paddingRight: body.style.paddingRight
        };

        // 计算滚动条宽度，避免页面跳动
        const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

        // 设置样式阻止滚动，但不改变定位
        body.style.overflow = "hidden";
        html.style.overflow = "hidden";

        // 创建统一的事件处理函数
        this._preventScrollHandler = (e) => {
            const settingsBox = DOMCache.get('themeSettings_box');
            // 只允许设置面板内的滚动
            if (!settingsBox || !settingsBox.contains(e.target)) {
                // 打字不拦：否则禁用滚动期间分类对话框/搜索框无法输入
                if (e.type === 'keydown') {
                    const t = e.target;
                    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
                }
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        };

        // 添加事件监听器
        const events = ['touchmove', 'mousewheel', 'wheel', 'DOMMouseScroll', 'keydown'];
        events.forEach(event => {
            document.addEventListener(event, this._preventScrollHandler, {
                passive: false,
                capture: true
            });
        });

        console.log('滚动已禁用');
    },

    enableScroll() {
        if (!this._scrollDisabled) return; // 避免重复启用

        this._scrollDisabled = false;

        if (this._preventScrollHandler) {
            const events = ['touchmove', 'mousewheel', 'wheel', 'DOMMouseScroll', 'keydown'];
            events.forEach(event => {
                document.removeEventListener(event, this._preventScrollHandler, {
                    passive: false,
                    capture: true
                });
            });
            this._preventScrollHandler = null;
        }

        const body = document.body;
        const html = document.documentElement;

        if (this._originalBodyStyles) {
            body.style.overflow = this._originalBodyStyles.overflow;
            body.style.paddingRight = this._originalBodyStyles.paddingRight;
            this._originalBodyStyles = null;
        } else {
            // 如果没有保存的样式，则清空
            body.style.overflow = "";
            body.style.paddingRight = "";
        }
        html.style.overflow = "";

        // 恢复滚动位置
        window.scrollTo(this._savedScrollPosition.left, this._savedScrollPosition.top);

        console.log('滚动已启用');
    },

    // 获取滚动状态
    isScrollDisabled() {
        return this._scrollDisabled;
    },

    // 调试函数：检查滚动状态
    debugScrollStatus() {
        console.log('=== 滚动状态调试信息 ===');
        console.log('滚动是否被禁用:', this._scrollDisabled);
        console.log('body.style.overflow:', document.body.style.overflow);
        console.log('body.style.position:', document.body.style.position);
        console.log('事件处理器是否存在:', !!this._preventScrollHandler);
        console.log('保存的滚动位置:', this._savedScrollPosition);
        console.log('========================');
    }
};

// ========== 文件渲染器 ==========
const DialogManager = {
    unlockTimer: null,
    unlockDelay: 150,

    lockWindowVisibility() {
        if (this.unlockTimer !== null) {
            clearTimeout(this.unlockTimer);
            this.unlockTimer = null;
        }
        ApiHelper.call('lock_window_visibility');
    },

    releaseWindowVisibility(delay = this.unlockDelay) {
        if (this.unlockTimer !== null) {
            clearTimeout(this.unlockTimer);
        }
        this.unlockTimer = setTimeout(() => {
            this.unlockTimer = null;
            ApiHelper.call('unlock_window_visibility');
        }, delay);
    }
};

class FileRenderer {
    constructor() {
        this.gridContainer = DOMCache.get('filesContainer');
        this.listContainer = DOMCache.get('filesListContainer');
    }
    async changeClass_ani_state(t,class_name){
        if(t==true){
            this.gridContainer.classList.add(class_name);
            this.listContainer.classList.add(class_name);
        }else{
            this.gridContainer.classList.remove(class_name);
            this.listContainer.classList.remove(class_name);
        }
    }

    /**
     * 渲染文件列表
     */
    async render(files,target_ctn=null,ani=true,allowIds=null) {
        // 【性能优化】默认只渲染当前可见的那一个视图。
        // 原先 target_ctn==null 时网格 + 列表两套 DOM 都建，134 项 = 268 个节点，
        // 渲染耗时和内存都翻倍，而用户一次只能看到一种视图。
        if(target_ctn === null){
            target_ctn = (this.gridContainer.style.display === 'none') ? 'list' : 'grid';
        }
        // 两个容器都清空：没渲染的那个保持为空（切换视图时由 ensureViewRendered 按需重建），
        // 这样切回去不会看到过期内容，同时节点数仍只有原来的一半
        this.clearContainers(null);

        // if (!files || files.length === 0) {
        //     this.setEmptyState();
        //     return;
        // }
        for(var file of files){
            if(target_ctn=="grid")await this.renderGridItem(file,allowIds);
            if(target_ctn=="list")await this.renderListItem(file,allowIds);
        }
        if(ani==true)this.changeClass_ani_state(true,"fade-in-up")
        if(ani==true)await new Promise(resolve => setTimeout(resolve, 300));
        if(ani==true)this.changeClass_ani_state(false,"fade-in-up")
        image_preview()
        loadingUI.sets("items_ctn",false)
    }

    clearContainers(target_ctn) {
        if(target_ctn=="grid" || target_ctn==null)this.gridContainer.innerHTML = '';
        if(target_ctn=="list" || target_ctn==null)this.listContainer.innerHTML = '';
    }

    // 【性能优化】配套「只渲染当前视图」：切换视图时若目标视图还没渲染过，再按需补一次
    async ensureViewRendered(mode){
        const ctn = (mode === "list") ? this.listContainer : this.gridContainer;
        if(ctn.children.length > 0) return;
        const files = (typeof AppState !== "undefined" && AppState.files_data) || [];
        if(files.length === 0) return;
        const allowIds = await getClassIdSet(last_group);
        await this.render(files, mode, false, allowIds);
    }

    // setEmptyState() {
    //     this.gridContainer.style.minHeight = "75vh";
    //     this.listContainer.style.minHeight = "75vh";
    // }
    renderGroupIcon(isGrid,file){
        // 2x2 宫格图标
        let gridHtml = `<div class="group-icon-grid" ${isGrid?'':'style="width: 40px;height: 40px;margin-bottom: 0px;margin-left:1.5%"'}>`;
        for (let i = 0; i < 4; i++) {
            if (file.groupIcons && file.groupIcons[i]) {
                gridHtml += `<img draggable="false" src="${file.groupIcons[i]}" alt="">`;
            } else {
                gridHtml += '<div class="group-icon-empty"></div>';
            }
        }
        gridHtml += '</div>';
        return gridHtml;
    }

    createFileElement = async function(file, isGrid = true, allowIds = null) {
        const element = document.createElement('div');
        // 不设 draggable：拖拽交给文件末尾的 DragManager 用指针事件自绘
        // （原生 DnD 期间 Chromium 屏蔽 wheel，做不到「拖着图标滚滚轮翻页」）
        element.dataset.is_cl = file.cl;
        element.id = Utils.generateFileId(file.filePath);
        element.dataset.list_index = file.index;
        // 【闪屏修复】allowIds 非空时，元素插入 DOM 的第一帧即为正确的显示状态，
        // 不再存在「先渲染全部、再隐藏不匹配项」的中间态
        if (allowIds) {
            element.style.display = allowIds.has(element.id) ? "flex" : "none";
        }

        // 组项目特殊渲染
        if (file.isGroup) {
            element.className = isGrid ? 'file-item file-group-item' : 'file-list-item file-group-item';
            element.dataset.group_id = file.groupId;
            const nameClass = isGrid ? 'file-name' : 'file-list-name';
            const typeClass = isGrid ? 'file-type' : 'file-list-type';

            let gridHtml = this.renderGroupIcon(isGrid,file);
            element.innerHTML = `
                ${gridHtml}
                <span draggable="false" ${isGrid==true?'':'style="margin-left:12px;"'} class="${nameClass}">${file.fileName}</span>
                <span draggable="false" class="${typeClass}">应用组</span>
                ${isGrid==false?'':`<div class="group-badge">${file.itemCount}</div>`}
            `;
            this.attachGroupEvents(element, file);
            return element;
        }

        element.className = isGrid ? 'file-item' : 'file-list-item';

        const fileType = Utils.getFileType(file.file, file.fileType);
        const iconClass = isGrid ? 'file-icon' : 'file-list-icon';
        const nameClass = isGrid ? 'file-name' : 'file-list-name';
        const typeClass = isGrid ? 'file-type' : 'file-list-type';

        element.innerHTML = `
            <img draggable = false src="${file.ico}" alt="${file.fileName}" class="${iconClass}">
            <span draggable = false class="${nameClass}">${file.fileName}</span>
            <span draggable = false class="${typeClass}">${fileType}</span>
        `;
        const cl_e = document.createElement("div")

        cl_e.className = isGrid ? 'file-cl' : 'file-list-cl';;
        if(file.cl==false){
            if(document.documentElement.getAttribute('data-theme')=='light'){
                cl_e.innerHTML="<img draggable = false src='./resources/imgs/cl.png'>"
            }else{
                cl_e.innerHTML="<img draggable = false src='./resources/imgs/cl_w.png'>"
            }

        }else{
            cl_e.innerHTML="<img draggable = false src='./resources/imgs/cl-active.png'>"
            cl_e.style.display="block"
        }

        cl_e.onclick=(event) => {event.stopPropagation();change_cl_state(file.filePath, file.cl)};
        cl_e.ondblclick = (event) => {event.stopPropagation();}
        element.insertBefore(cl_e, element.firstChild);
        element.cl = cl_e;

        this.attachFileEvents(element, file);
        return element;
    }

    async renderGridItem(file, allowIds = null) {
        const element = await this.createFileElement(file, true, allowIds);
        this.gridContainer.appendChild(element);
    }

    async renderListItem(file, allowIds = null) {
        const element = await this.createFileElement(file, false, allowIds);
        this.listContainer.appendChild(element);
    }

    attachFileEvents(element, file) {
        // 双击事件
        element.addEventListener('dblclick', () => {
            AppState.db_click_action = true;
            clearTimeout(AppState.timer);
            this.handleFileAction(file, true);
        });

        // 单击事件
        element.addEventListener('click', (e) => {
            // Ctrl / ⌘ + 点击 = 勾选或取消勾选，不打开文件
            if (e.ctrlKey || e.metaKey) { ItemSelection.toggle(element); return; }
            if (ItemSelection.size) ItemSelection.clear();
            DOMCache.get("search_input").value = "";
            syncSearchView();
            AppState.timer = setTimeout(async () => {
                if (AppState.db_click_action) {
                    AppState.db_click_action = false;
                    return;
                }
                this.handleFileAction(file, false);
            }, CONSTANTS.CLICK_DELAY);
        });

        // 右键菜单事件
        element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if(file.sysApp!=undefined)return
            // 组视图内由 showGroupItemContextMenu 接管，跳过普通菜单
            if (GroupManager.currentOpenGroup !== null) return;
            MenuManager.showContextMenu(e, file);
        });
    }

    handleFileAction(file, isDoubleClick) {
        if (file.isGroup) {
            GroupManager.openGroup(file.groupId, file.fileName);
            return;
        }
        // 从组视图内打开文件时，先关闭组视图（恢复 autoClose）
        if (GroupManager.currentOpenGroup !== null) {
            GroupManager.closeGroup();
        }
        if (file.fileType === '文件夹') {
            if (isDoubleClick) {
                if(config["dbc_action"]=="1"){
                    ApiHelper.openFile(file.filePath);
                }else{
                    NavigationManager.navigateTo(file.filePath);
                }
            } else {
                NavigationManager.navigateTo(file.filePath);
            }
        } else if (file.sysApp) {
            ApiHelper.call('open_sysApp', file.filePath);
        } else {
            if (isDoubleClick) {
                if(config["dbc_action"]=="1"){
                    ApiHelper.showFile(file.filePath);
                }else{
                    ApiHelper.openFile(file.filePath);
                }
            } else {
                ApiHelper.openFile(file.filePath);
            }
        }
    }

    attachGroupEvents(element, file) {
        // 单击打开组视图
        element.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey) { ItemSelection.toggle(element); return; }
            if (ItemSelection.size) ItemSelection.clear();
            DOMCache.get("search_input").value = "";
            syncSearchView();
            AppState.timer = setTimeout(() => {
                if (AppState.db_click_action) {
                    AppState.db_click_action = false;
                    return;
                }
                GroupManager.openGroup(file.groupId, file.fileName);
            }, CONSTANTS.CLICK_DELAY);
        });

        // 双击也打开组
        element.addEventListener('dblclick', () => {
            AppState.db_click_action = true;
            clearTimeout(AppState.timer);
            GroupManager.openGroup(file.groupId, file.fileName);
        });

        // 右键菜单
        element.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            GroupManager.showGroupContextMenu(e, file);
        });
    }
}

// ========== 菜单管理器 ==========
const MenuManager = {
    async showContextMenu(e, file) {
        e.preventDefault();
        const config = await ApiHelper.getConfig();

        Utils.hideWithMotion(DOMCache.get('blankMenu'));
        AppState.setSelectedFile(file);

        const contextMenu = DOMCache.get('contextMenu');
        // contextMenu.style.display = 'block';
        Utils.uiBoxDisplayChange(contextMenu,block,true)
        var scale_rate = config["scale"] / 100
        if((e.pageX / scale_rate)>((window.innerWidth-contextMenu.offsetWidth)/scale_rate)){
            contextMenu.style.left = `${(window.innerWidth - contextMenu.offsetWidth) / scale_rate}px`;
        }else{
            contextMenu.style.left = `${e.pageX / scale_rate}px`;
        }
        if((e.pageY / scale_rate)>((window.innerHeight-contextMenu.offsetHeight)/scale_rate)){
            contextMenu.style.top = `${(window.innerHeight - contextMenu.offsetHeight) / scale_rate}px`;
        }else{
            contextMenu.style.top = `${e.pageY / scale_rate}px`;
        }

        this.adjustMenuPosition(contextMenu, e);

        if(file.edit_ico!=undefined){
            DOMCache.get("edit_icon_btn").innerText="恢复默认图标"
        }else{
            DOMCache.get("edit_icon_btn").innerText="自定义图标"
        }
        // 在普通文件右键菜单中显示"添加到组"，隐藏"从组中移除"
        const addToGroupItem = DOMCache.get('menuAddToGroup');
        const removeItem = document.getElementById('menuGroupRemoveItem');
        if(config["df_dir"]==AppState.currentPath){
            if (addToGroupItem) addToGroupItem.style.display = 'flex';
            if (removeItem) removeItem.style.display = 'none';
        }else{
            if (addToGroupItem) addToGroupItem.style.display = 'none';
            if (removeItem) removeItem.style.display = 'none';
        }
        
        disableScroll();
    },

    adjustMenuPosition(menu, e) {
        if (e.pageY + menu.offsetHeight > window.innerHeight) {
            window.scrollTo(0, document.documentElement.scrollHeight);
        }
        if (e.pageX + menu.offsetWidth > window.innerWidth) {
            window.scrollTo(document.body.scrollWidth, window.scrollY);
        }
    },

    hideContextMenu() {
        const contextMenu = DOMCache.get('contextMenu');
        if (contextMenu && contextMenu.style.display !== 'none') {
            // 【动效】菜单收起也带动画（110ms 快速淡出），不要"有头没尾"
            contextMenu.classList.add('quick-out');
            setTimeout(() => {
                contextMenu.classList.remove('quick-out');
                contextMenu.style.display = 'none';
                contextMenu.style.zIndex = '';  // 恢复默认 z-index
            }, 110);
        } else if (contextMenu) {
            contextMenu.style.zIndex = '';
        }
        enableScroll();
    },

    hideAllMenus() {
        this.hideContextMenu();
        Utils.hideWithMotion(DOMCache.get('blankMenu'));
        const groupMenu = DOMCache.get('groupContextMenu');
        if (groupMenu) groupMenu.style.display = 'none';
        const groupSubMenu = DOMCache.get('groupSubMenu');
        if (groupSubMenu) groupSubMenu.style.display = 'none';
        // 隐藏"从组中移除"菜单项
        const removeItem = document.getElementById('menuGroupRemoveItem');
        if (removeItem) removeItem.style.display = 'none';
        enableScroll();
    }
};

// 桌面路径在一次会话内不会变化，缓存起来，省掉每次导航一次跨桥 IPC
let _desktopPathCache = null;
async function getDesktopPathCached(){
    if(_desktopPathCache === null){
        _desktopPathCache = await ApiHelper.call('search_desktop_path');
    }
    return _desktopPathCache;
}

// ========== 导航管理器 ==========
const NavigationManager = {
    async navigateTo(path) {
        // 【闪屏修复】先在渲染前算好过滤集合，避免渲染完再过滤造成的中间态
        const atRoot = (path=="/" || path=="" || path=="desktop" || path==document.getElementById("b2d").dataset.path);
        if(atRoot){
            document.getElementById("box1").style.display="block"
        }else{
            document.getElementById("box1").style.display="none"
        }
        const navAllowIds = atRoot ? await getClassIdSet(last_group) : null;
        fit_btnBar()

        if (path === AppState.currentPath) {
            await this.refreshCurrentPath();
            return;
        }
        DOMCache.get("filesContainer").innerHTML = '';
        DOMCache.get("filesListContainer").innerHTML = '';
        loadingUI.sets("items_ctn",true)
        AppState.addToHistory(path);
        await this.updateBreadcrumb(path || '/');

        const result = await ApiHelper.getFileInfo(path);
        if(AppState.currentPath!=path){
            return
        }
        AppState.setFiles(result.data);
        await fileRenderer.render(result.data,null,true,navAllowIds);
        loadingUI.sets("items_ctn",false)
        scroll_top();
    },

    async refreshCurrentPath(quick_update=true,ani=true,kws_clear=true,ign_icno=false) {
        return new Promise(async (resolve) => { 
            loadingUI.sets("items_ctn",true)
            const result = await ApiHelper.getFileInfo(AppState.currentPath,quick_update,ign_icno);
            if(kws_clear){
                DOMCache.get("search_input").value=""
            }
            // 内容没变就完全不动 DOM（后端 same 恒为 false，前端自己比签名）：
            // 否则每次唤起都全量重渲染+转圈，观感上就是"内容又闪一遍"
            if(JSON.stringify(result.data) === JSON.stringify(AppState.files_data)){
                // 但上面刚把搜索框清空过，视图还停在旧的搜索结果上 —— 这条快路径不能吞掉这次同步
                await syncSearchView();
                loadingUI.sets("items_ctn",false)
                resolve(true)
                return
            }
            AppState.setFiles(result.data);
            loadingUI.sets("items_ctn",false)

            // 【闪屏修复】渲染前先取到当前分类的成员集合，条目出生即为正确显示状态，
            // 不再需要「先渲染全部 → 再隐藏不匹配项 → 揭开遮盖」这套会带来闪屏的时序
            const allowIds = await getClassIdSet(last_group);
            await fileRenderer.render(result.data,null,ani,allowIds);
            // 全量渲染不带搜索过滤，生效键随之清零；框里若还留着关键词就立刻补回过滤
            AppState.searchKey = "";
            await syncSearchView();
            resolve(true);
        });
    },

    async updateBreadcrumb(path) {
        const config = await ApiHelper.getConfig();
        const breadcrumb = DOMCache.get('breadcrumb');
        breadcrumb.innerHTML = '';

        const desktopPath = await getDesktopPathCached();
        const basePath = config.df_dir === "desktop" ? desktopPath : config.df_dir;
        const parts = path.replace(basePath, "").split('\\').filter(part => part.length > 0);

        // 添加根目录项
        const rootItem = document.createElement('span');
        rootItem.className = 'breadcrumb-item';
        rootItem.textContent = config.df_dir_name;
        rootItem.dataset.path = config.df_dir;
        rootItem.id = "b2d";
        breadcrumb.appendChild(rootItem);
        if (path.includes(basePath)){
            var currentPath = basePath+"\\";
        }else{
            var currentPath = ""
        }
        if(parts.length == 1 && parts[0] == "desktop")return
        parts.forEach((part, index) => {
            currentPath += part + "\\";
            
            console.log(part)

            if (index < parts.length - 1) {
                const separator = document.createElement('span');
                separator.className = 'breadcrumb-separator';
                separator.textContent = '›';
                breadcrumb.appendChild(separator);
            }

            const item = document.createElement('span');
            item.className = 'breadcrumb-item';
            item.textContent = part;
            item.dataset.path = currentPath;
            breadcrumb.appendChild(item);
        });
    }
};

// ========== 搜索管理器 ==========
const SearchManager = {
    async performSearch(searchKey=null,render=true) {
        let key = ""
        if(searchKey==null){
            key = DOMCache.get("search_input").value;
        }else{
            key = searchKey;
        }

        if (key === "") {
            // 【修复】清空搜索框后回到当前选中的分类视图，而不是回到「全部」。
            // 注：有关键词时仍是全范围搜索（不受分类限制），这里只恢复「无输入」时的底图。
            if(render==true){
                AppState.searchKey = "";
                await fileRenderer.render(AppState.files_data,null,false,await getClassIdSet(last_group));
            }
            return;
        }

        const groups = AppState.files_data.filter(f => f.isGroup);
        let group_data = []
        for (const group of groups) {
            try {
                const contents = await ApiHelper.call('get_group_contents', group.groupId);
                if (contents.data) {
                    contents.data.forEach(file => {
                        group_data.push(file);
                    });
                }
            } catch (e) { /* 忽略 */ }
        }
        const pyData = await ApiHelper.loadSearchIndex([...AppState.files_data,...group_data]);
        const outData = [];
        const dealKey = Utils.checkChineseChars(key);

        if (dealKey.have_cn) {
            AppState.files_data.forEach(file => {
                if (Utils.contains(file.fileName, dealKey.origin) ||
                    Utils.contains(file.fileName, dealKey.fix)) {
                    outData.push(file);
                }
            });
        } else {
            AppState.files_data.forEach(file => {
                const fileData = pyData[file.fileName];
                if (fileData && (
                    Utils.contains(fileData.sxpy, key) ||
                    Utils.contains(fileData.py, key)
                )) {
                    outData.push(file);
                }
            });
        }

        // 同时搜索组内文件
        for (const group of groups) {
            if (outData.find(f => f.filePath === group.filePath)) continue;
            try {
                const contents = await ApiHelper.call('get_group_contents', group.groupId);
                if (contents.data) {
                    contents.data.forEach(file => {
                        if(dealKey.have_cn){
                            // console.log(file)
                            if (Utils.contains(file.fileName, dealKey.origin) ||
                                Utils.contains(file.fileName, dealKey.fix)) {
                                outData.push(file);
                            }
                        }else{
                            const fileData = pyData[file.fileName];
                            if (fileData && (
                                Utils.contains(fileData.sxpy, key) ||
                                Utils.contains(fileData.py, key)
                            )) {
                                outData.push(file);
                            }
                        }
                        
                    });
                }
            } catch (e) { /* 忽略 */ }
        }

        if(render==true){
            AppState.searchKey = key;
            await fileRenderer.render(outData,null,false);
        }
        return outData;
    }
};

/* 输入框内容与真正生效的过滤不一致时，把视图拉回一致。
   点图标、点面包屑、唤起时的 kws_clear 都只清 value 不重渲染，
   表现就是「搜完打开程序，再唤起时框里没字、列表却还是上次搜的结果」。 */
async function syncSearchView(){
    const box = DOMCache.get("search_input");
    if(!box || box.value === AppState.searchKey) return;
    await SearchManager.performSearch();
}

// ========== 主题管理器 ==========
const ThemeManager = {
    now_theme: 'light',
    customThemeConfig: null,
    originalCustomTheme: null,

    async applyBackgroundSettings(config) {
        // 背景图图层、毛玻璃/磨砂强度、灰显，全部统一走 applyGlassSettings 这一个漏斗。
        // 这里不再自己动背景——两处各管一份逻辑，曾经就漏掉过"切透明模式不清背景图"。
        applyGlassSettings(config);
    },

    async initCustomTheme(config=null) {
        if (!config) config = await ApiHelper.getConfig();  // 【启动优化 P1】可复用启动期 config
        this.originalCustomTheme = config.userTheme || {
            primary: '#667eea',
            secondary: '#28283c',
            secondaryAlpha: 70,
            bgType: 'gradient',
            bgColor: '#1a1a2e',
            bgGradient1: '#1a1a2e',
            bgGradient2: '#16213e',
            mainText: '#e0e0e0',
            subText: '#8a9ba8'
        };
        this.customThemeConfig = JSON.parse(JSON.stringify(this.originalCustomTheme));
        this.applyCustomThemeVariables(this.customThemeConfig);
    },

    applyCustomThemeVariables(config) {
        const root = document.documentElement;
        root.style.setProperty('--custom-primary', config.primary);
        
        const secondary = config.secondary;
        const alpha = config.secondaryAlpha / 100;
        let rgbaSecondary = secondary;
        if (secondary.startsWith('#')) {
            const r = parseInt(secondary.slice(1, 3), 16);
            const g = parseInt(secondary.slice(3, 5), 16);
            const b = parseInt(secondary.slice(5, 7), 16);
            rgbaSecondary = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        }
        root.style.setProperty('--custom-secondary', rgbaSecondary);

        let bg;
        if (config.bgType === 'solid') {
            bg = config.bgColor;
        } else {
            bg = `linear-gradient(135deg, ${config.bgGradient1} 0%, ${config.bgGradient2} 100%)`;
        }
        root.style.setProperty('--custom-bg', bg);
        root.style.setProperty('--custom-text-main', config.mainText);
        root.style.setProperty('--custom-text-sub', config.subText);
    },

    openEditor() {
        const overlay = DOMCache.get('themeEditorOverlay');
        const config = this.customThemeConfig;
        Utils.hideWithMotion(DOMCache.get("themeSettings_box"));

        // 设置表单值
        DOMCache.get('primaryColorPicker').value = config.primary;
        DOMCache.get('secondaryColorPicker').value = config.secondary;
        DOMCache.get('secondaryAlphaPicker').value = config.secondaryAlpha;
        DOMCache.get('secondaryAlphaValue').innerText = config.secondaryAlpha + '%';
        
        DOMCache.get('bgColorPicker').value = config.bgColor;
        DOMCache.get('bgGradient1').value = config.bgGradient1;
        DOMCache.get('bgGradient2').value = config.bgGradient2;
        
        DOMCache.get('mainTextColorPicker').value = config.mainText;
        DOMCache.get('subTextColorPicker').value = config.subText;

        // 背景类型按钮
        const bgBtns = DOMCache.getAllBySelector('.bg-type-btn');
        bgBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === config.bgType);
        });
        DOMCache.get('solidBgPicker').style.display = config.bgType === 'solid' ? 'flex' : 'none';
        DOMCache.get('gradientBgPicker').style.display = config.bgType === 'gradient' ? 'flex' : 'none';

        // 显示弹窗（弹簧进场，与其他对话框节奏一致）
        overlay.style.display = 'flex';
        Utils.playMotion(overlay, 'spring-in', 300);
        ApiHelper.call('lock_window_visibility');
    },

    async saveCustomTheme() {
        this.originalCustomTheme = JSON.parse(JSON.stringify(this.customThemeConfig));
        await ApiHelper.updateConfig('userTheme', this.originalCustomTheme);
        Utils.hideWithMotion(DOMCache.get('themeEditorOverlay'));
        ApiHelper.call('unlock_window_visibility');
        DOMCache.get("themeSettings_box").style.display = 'block';
        Utils.playMotion(DOMCache.get("themeSettings_box"), 'panel-in', 300);
    },

    cancelEdit() {
        this.customThemeConfig = JSON.parse(JSON.stringify(this.originalCustomTheme));
        this.applyCustomThemeVariables(this.customThemeConfig);
        Utils.hideWithMotion(DOMCache.get('themeEditorOverlay'));
        DOMCache.get("themeSettings_box").style.display = 'block';
        Utils.playMotion(DOMCache.get("themeSettings_box"), 'panel-in', 300);
    }
};

// ========== 配置管理器 ==========
const ConfigManager = {
    async updateScale(value) {
        const realScale = value / 100;
        const container = DOMCache.get('content_box');
        container.style.height = (100 / realScale) + 'vh';
        document.body.style.zoom = realScale;
        await ApiHelper.updateConfig("scale", value);
    },

    async updateDefaultDirectory(config=null, navigate=true) {
        // 【启动优化 P0/P1｜风险:中】① config 可由调用方传入复用，省去重复 get_config IPC；
        // ② navigate=false 时只更新默认目录相关 UI、不触发导航渲染——启动时由调用方统一渲染一次，
        //    消除这里多发起的一次 getFileInfo+render（运行期改默认目录仍用默认 navigate=true，行为不变）。
        if (!config) config = await ApiHelper.getConfig();
        const settingBtns = DOMCache.get("dir_btn_box");

        document.getElementById("b2d").dataset.path = config.df_dir;// 此处DOM缓存项不起作用(似乎获取到的已经不是现在的b2d)，故用回getElementById
        document.getElementById("b2d").innerText = config.df_dir_name;
        if (navigate) navigateTo(config.df_dir);// 刷新主页
        DOMCache.get("defeat_dir_show").innerText = "当前选择：" + config.df_dir;

        if (config.df_dir === "desktop") {
            settingBtns.children[0].className = "dir_btn dir_btn_active";
            settingBtns.children[1].className = "dir_btn";
        } else {
            settingBtns.children[0].className = "dir_btn";
            settingBtns.children[1].className = "dir_btn dir_btn_active";
        }
    }
};

// ========== 文件操作管理器 ==========
const FileOperationManager = {
    async renameFile(filePath, newName) {
        const result = await ApiHelper.renameFile(filePath, newName);
        await this.refreshAndRemindFile(result);
        return result;
    },

    async removeFile(filePath, type = "remove") {
        const result = await ApiHelper.removeFile(filePath, type);
        await NavigationManager.refreshCurrentPath(false,false,false,true);
        return result;
    },

    async createNewFile(fileType) {
        const result = await ApiHelper.newFile(fileType, AppState.currentPath);
        await this.refreshAndRemindFile(result);
        return result;
    },

    async pasteFiles() {
        const result = await ApiHelper.putFile(AppState.currentPath);
        await NavigationManager.refreshCurrentPath(false,false,true,true);

        if (result.files) {
            setTimeout(() => {
                var e_list = []
                result.files.forEach(filePath => {
                    const fileId = Utils.generateFileId(filePath);
                    const element = DOMCache.get(fileId);
                    if (element) {
                        e_list.push(element);
                    }
                });
                UIUtils.remindFiles(e_list);
            }, 200);
        }

        return result;
    },

    async refreshAndRemindFile(result) {
        console.log(result)
        await NavigationManager.refreshCurrentPath(false,false,false,true);

        if (result.file) {
            setTimeout(() => {
                const fileId = Utils.generateFileId(result.file);
                const element = DOMCache.get(fileId);
                if (element) {
                    UIUtils.remindFile(element);
                }
            }, 200);
        }
    }
};

// ========== 应用组管理器 ==========
const groupContainer = document.querySelector('.group-view-container');
const GroupManager = {
    currentOpenGroup: null,
    currentGroupName: '',
    isDialogActive: false,  // 标记组对话框是否活跃，防止原始重命名逻辑触发

    async openGroup(groupId, groupName) {
        this.currentOpenGroup = groupId;
        this.currentGroupName = groupName || '';
        const overlay = DOMCache.get('groupViewOverlay');
        const title = DOMCache.get('groupViewTitle');
        const container = DOMCache.get('groupFilesContainer');

        title.textContent = groupName || '应用组';
        container.innerHTML = '<div class="loading-indicator">加载中...</div>';
        // overlay.style.display = 'flex';
        Utils.uiBoxDisplayChange(overlay, "flex",true)
        // UIUtils.disableScroll();

        try {
            const result = await ApiHelper.call('get_group_contents', groupId);
            container.innerHTML = '';
            if (result.data && result.data.length > 0) {
                for (const file of result.data) {
                    file.index = 0;
                    const el = await fileRenderer.createFileElement(file, true);
                    el.dataset.file_path = file.filePath;
                    el.dataset.gid = groupId;
                    // 为组内文件添加"从组中移除"的右键菜单
                    el.addEventListener('contextmenu', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.showGroupItemContextMenu(e, file, groupId);
                    });
                    // 拖拽到组窗口外 = 移出组
                    // el.addEventListener('dragend', (e) => {
                    //     const rect = groupContainer.getBoundingClientRect();
                    //     if (e.clientX < rect.left || e.clientX > rect.right ||
                    //         e.clientY < rect.top || e.clientY > rect.bottom) {
                    //         const fp = el.dataset.file_path;
                    //         if (fp) this.removeFromGroup(groupId, fp);
                    //     }
                    // });
                    container.appendChild(el);
                }
            } else {
                container.innerHTML = '<div class="loading-indicator">组内没有文件</div>';
            }
        } catch (err) {
            console.error('加载组内容失败:', err);
            container.innerHTML = '<div class="loading-indicator">加载失败</div>';
        }
    },

    closeGroup() {
        const overlay = DOMCache.get('groupViewOverlay');
        Utils.hideWithMotion(overlay);
        this.currentOpenGroup = null;
        UIUtils.enableScroll();
    },

    async createGroup() {
        this.isDialogActive = true;
        DialogManager.lockWindowVisibility();
        const renameOverlay = DOMCache.get('renameOverlay');
        const renameInput = DOMCache.get('renameInput');
        const h3 = renameOverlay.querySelector('h3');
        const origTitle = h3.textContent;
        h3.textContent = '新建组';
        renameInput.value = '';
        // renameOverlay.style.display = 'flex';
        Utils.uiBoxDisplayChange(renameOverlay, "flex",true)
        renameInput.focus();

        const confirmBtn = DOMCache.get('renameConfirm');
        const handler = async () => {
            const name = renameInput.value.trim();
            if (!name) return;
            // 把当前所在分类一并传过去：在分类页里建的组要归到该分类下（否则只会出现在"全部"）
            var r = await ApiHelper.call('create_group', name, (typeof last_group === 'string' ? last_group : ''));
            invalidateClassCache();
            Utils.hideWithMotion(renameOverlay);
            h3.textContent = origTitle;
            confirmBtn.removeEventListener('click', handler);
            cancelBtn.removeEventListener('click', cancelHandler);
            this.isDialogActive = false;
            DialogManager.releaseWindowVisibility();
            FileOperationManager.refreshAndRemindFile({file:"__group__:"+r.groupId})
        };
        confirmBtn.addEventListener('click', handler);

        const cancelBtn = DOMCache.get('renameCancel');
        const cancelHandler = () => {
            h3.textContent = origTitle;
            confirmBtn.removeEventListener('click', handler);
            cancelBtn.removeEventListener('click', cancelHandler);
            this.isDialogActive = false;
        };
        cancelBtn.addEventListener('click', cancelHandler);
    },

    async editGroupOrder() {
        const ctn = DOMCache.get('groupFilesContainer');
        var paths = [];
        for(let p of ctn.children){
            paths.push(p.dataset.file_path)
        }
        await ApiHelper.call('edit_group_order', this.currentOpenGroup, paths);
        NavigationManager.refreshCurrentPath();
    },

    async renameGroup(groupId) {
        this.isDialogActive = true;
        DialogManager.lockWindowVisibility();
        const renameOverlay = DOMCache.get('renameOverlay');
        const renameInput = DOMCache.get('renameInput');
        const h3 = renameOverlay.querySelector('h3');
        const origTitle = h3.textContent;
        h3.textContent = '重命名组';
        renameInput.value = this.currentGroupName;
        // renameOverlay.style.display = 'flex';
        Utils.uiBoxDisplayChange(renameOverlay, "flex",true)
        renameInput.focus();

        const confirmBtn = DOMCache.get('renameConfirm');
        const handler = async () => {
            const name = renameInput.value.trim();
            if (!name) return;
            await ApiHelper.call('rename_group', groupId, name);
            Utils.hideWithMotion(renameOverlay);
            h3.textContent = origTitle;
            confirmBtn.removeEventListener('click', handler);
            cancelBtn.removeEventListener('click', cancelHandler);
            this.isDialogActive = false;
            DialogManager.releaseWindowVisibility();
            NavigationManager.refreshCurrentPath();
        };
        confirmBtn.addEventListener('click', handler);

        const cancelBtn = DOMCache.get('renameCancel');
        const cancelHandler = () => {
            h3.textContent = origTitle;
            confirmBtn.removeEventListener('click', handler);
            cancelBtn.removeEventListener('click', cancelHandler);
            this.isDialogActive = false;
        };
        cancelBtn.addEventListener('click', cancelHandler);
    },

    async deleteGroup(groupId) {
        return this.confirmAndDeleteGroup(groupId, this.currentGroupName);
    },

    async confirmAndDeleteGroup(groupId, groupName = '') {
        const overlay = DOMCache.get('groupDeleteConfirm');
        const groupDeleteName = DOMCache.get('groupDeleteName');
        const cancelBtn = DOMCache.get('groupDeleteCancel');
        const confirmBtn = DOMCache.get('groupDeleteConfirmBtn');

        groupDeleteName.textContent = groupName || this.currentGroupName || '未命名应用组';
        // overlay.style.display = 'flex';
        Utils.uiBoxDisplayChange(overlay, "flex",true)
        UIUtils.disableScroll();
        DialogManager.lockWindowVisibility();

        const confirmed = await new Promise((resolve) => {
            let settled = false;

            const cleanup = (result) => {
                if (settled) return;
                settled = true;
                Utils.hideWithMotion(overlay);
                cancelBtn.removeEventListener('click', handleCancel);
                confirmBtn.removeEventListener('click', handleConfirm);
                overlay.removeEventListener('click', handleOverlayClick);
                document.removeEventListener('keydown', handleKeyDown, true);
                if (DOMCache.get('groupViewOverlay').style.display !== 'flex') {
                    UIUtils.enableScroll();
                }
                DialogManager.releaseWindowVisibility();
                resolve(result);
            };

            const handleCancel = () => cleanup(false);
            const handleConfirm = () => cleanup(true);
            const handleOverlayClick = (e) => {
                if (e.target.id === 'groupDeleteConfirm') {
                    cleanup(false);
                }
            };
            const handleKeyDown = (e) => {
                if (overlay.style.display !== 'flex') return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    cleanup(true);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    cleanup(false);
                }
            };

            cancelBtn.addEventListener('click', handleCancel);
            confirmBtn.addEventListener('click', handleConfirm);
            overlay.addEventListener('click', handleOverlayClick);
            document.addEventListener('keydown', handleKeyDown, true);
            confirmBtn.focus();
        });

        if (!confirmed) return;
        await ApiHelper.call('delete_group', groupId);
        this.closeGroup();
        NavigationManager.refreshCurrentPath();
    },

    async addToGroup(groupId, filePaths) {
        await ApiHelper.call('add_to_group', groupId, filePaths);
        await NavigationManager.refreshCurrentPath();
        UIUtils.showMessage("已添加到组",false)
    },

    async removeFromGroup(groupId, filePath) {
        await ApiHelper.call('remove_from_group', groupId, filePath);
        // 如果组视图是打开的，刷新组视图
        if (this.currentOpenGroup === groupId) {
            this.openGroup(groupId, this.currentGroupName);
        }
        NavigationManager.refreshCurrentPath();
    },

    showGroupContextMenu(e, file) {
        MenuManager.hideAllMenus();
        const menu = DOMCache.get('groupContextMenu');
        // menu.style.display = 'block';
        Utils.uiBoxDisplayChange(menu,block,true)
        // 与 showContextMenu 一致：坐标要除以缩放比，否则 scale≠100% 时菜单偏移
        const gsr = (typeof config !== 'undefined' && config && config.scale) ? config.scale/100 : 1;
        menu.style.left = `${Math.min(e.pageX, window.innerWidth - menu.offsetWidth) / gsr}px`;
        menu.style.top = `${Math.min(e.pageY, window.innerHeight - menu.offsetHeight) / gsr}px`;

        // 绑定事件
        DOMCache.get('menuGroupOpen').onclick = () => {
            Utils.hideWithMotion(menu);
            this.openGroup(file.groupId, file.fileName);
        };
        DOMCache.get('menuGroupRename').onclick = () => {
            Utils.hideWithMotion(menu);
            this.currentGroupName = file.fileName;
            this.renameGroup(file.groupId);
        };
        DOMCache.get('menuGroupDelete').onclick = () => {
            Utils.hideWithMotion(menu);
            this.currentGroupName = file.fileName;
            this.confirmAndDeleteGroup(file.groupId, file.fileName);
        };

        disableScroll();
    },

    showGroupItemContextMenu(e, file, groupId) {
        // 复用主右键菜单但添加"从组中移除"选项
        MenuManager.hideAllMenus();
        AppState.setSelectedFile(file);

        const contextMenu = DOMCache.get('contextMenu');
        // contextMenu.style.display = 'block';
        Utils.uiBoxDisplayChange(contextMenu,block,true)
        // 提升 z-index 使右键菜单显示在组视图 overlay 之上
        contextMenu.style.zIndex = '4000';

        // 缩放感知定位 + 边界检测
        const scale = document.body.style.zoom ? parseFloat(document.body.style.zoom) : 1;
        let posX = e.pageX / scale;
        let posY = e.pageY / scale;
        if (posX > (window.innerWidth - contextMenu.offsetWidth) / scale) {
            posX = (window.innerWidth - contextMenu.offsetWidth) / scale;
        }
        if (posY > (window.innerHeight - contextMenu.offsetHeight) / scale) {
            posY = (window.innerHeight - contextMenu.offsetHeight) / scale;
        }
        contextMenu.style.left = `${posX}px`;
        contextMenu.style.top = `${posY}px`;

        // 隐藏"添加到组"，显示"从组中移除"
        const addToGroupItem = DOMCache.get('menuAddToGroup');
        if (addToGroupItem) addToGroupItem.style.display = 'none';

        // 临时添加"从组中移除"菜单项
        let removeItem = document.getElementById('menuGroupRemoveItem');
        if (!removeItem) {
            removeItem = document.createElement('div');
            removeItem.className = 'context-menu-item group-remove';
            removeItem.id = 'menuGroupRemoveItem';
            removeItem.innerHTML = '<i class="fas fa-minus-circle"></i><span>从组中移除</span>';
            contextMenu.appendChild(removeItem);
        }
        // removeItem.style.display = 'flex';
        Utils.uiBoxDisplayChange(removeItem,"flex",false)
        removeItem.onclick = () => {
            this.removeFromGroup(groupId, file.filePath);
            MenuManager.hideContextMenu();
        };

        disableScroll();
    }
};

// ========== 事件管理器 ==========
const EventManager = {
    init() {
        this.initTimeUpdate();
        this.initViewToggle();
        this.initSearchEvents();
        this.initMenuEvents();
        this.initDialogEvents();
        this.initSettingsEvents();
        this.initNavigationEvents();
        this.initKeyboardEvents();
        this.initClickEvents();
    },

    initTimeUpdate() {
        const updateTime = () => {
            const now = new Date();
            const options = {
                year: 'numeric', month: 'long', day: 'numeric',
                weekday: 'long', hour: '2-digit', minute: '2-digit',
                second: '2-digit', hour12: false
            };
            DOMCache.get('current-time').textContent = now.toLocaleDateString('zh-CN', options);
        };

        updateTime();
        setInterval(updateTime, 1000);
    },

    initViewToggle() {
        DOMCache.get('displayToggleBtn').addEventListener('click', async () => {
            DisplayModeManager.toggleDisplayMode();
        });

        // DOMCache.get('listViewBtn').addEventListener('click', async () => {
        //     this.switchToListView();
        //     await ApiHelper.updateConfig("view", "list");
        // });
    },

    switchToGridView() {
        // 【动效】网格/列表互换都带动画（旧视图淡出 → 新视图淡入）
        // 把 swapView 的 Promise 透出去，切换真正落定之后调用方才能同步按钮图标
        const p = Utils.swapView('filesContainer', 'filesListContainer', 'grid');
        if(typeof fileRenderer !== "undefined") fileRenderer.ensureViewRendered("grid");
        return p;
        // DOMCache.get('gridViewBtn').classList.add('active');
        // DOMCache.get('listViewBtn').classList.remove('active');
    },

    switchToListView() {
        const p = Utils.swapView('filesListContainer', 'filesContainer', 'block');
        if(typeof fileRenderer !== "undefined") fileRenderer.ensureViewRendered("list");
        return p;
        // DOMCache.get('gridViewBtn').classList.remove('active');
        // DOMCache.get('listViewBtn').classList.add('active');
    },

    initSearchEvents() {
        const debouncedSearch = Utils.debounce(() => {
            SearchManager.performSearch();
        }, 300);

        DOMCache.get("search_input").addEventListener('input', debouncedSearch);
    },

    initMenuEvents() {
        // 文件右键菜单
        DOMCache.get('menuOpen').addEventListener('click', () => {
            // 从组视图内通过右键菜单打开文件时，先关闭组视图
            if (GroupManager.currentOpenGroup !== null) {
                GroupManager.closeGroup();
            }
            if (AppState.selectedFile.game) {
                ApiHelper.call('open_mhyGame', AppState.selectedFile.filePath, AppState.selectedFile.game);
            } else {
                ApiHelper.openFile(AppState.selectedFile.filePath);
            }
            MenuManager.hideContextMenu();
        });
        DOMCache.get('menuOpenLocation').addEventListener('click',async () => {
            if (AppState.selectedFile.realPath!== undefined) {
                ApiHelper.showFile(AppState.selectedFile.realPath);
            } else {
                ApiHelper.showFile(AppState.selectedFile.filePath);
            }
            MenuManager.hideContextMenu();
        });

        DOMCache.get('menuCopy').addEventListener('click', () => {
            ApiHelper.copyFile(AppState.selectedFile.filePath);
            MenuManager.hideContextMenu();
        });

        DOMCache.get('menuRename').addEventListener('click', this.showRenameDialog);
        DOMCache.get('menuDelete').addEventListener('click', this.showDeleteConfirm);
        DOMCache.get("menuCustomIcon").addEventListener('click',this.setIcon)

        // 添加到组 - 鼠标悬停时展示子菜单
        DOMCache.get('menuAddToGroup').addEventListener('mouseenter', async function() {
            const subMenu = DOMCache.get('groupSubMenu');
            const result = await ApiHelper.call('get_groups');
            const groups = result.data || {};
            const keys = Object.keys(groups);

            subMenu.innerHTML = '';
            if (keys.length === 0) {
                const emptyItem = document.createElement('div');
                emptyItem.className = 'context-menu-item';
                emptyItem.innerHTML = '<span style="color:#999">暂无组，请先新建</span>';
                subMenu.appendChild(emptyItem);
            } else {
                keys.forEach(gid => {
                    const item = document.createElement('div');
                    item.className = 'context-menu-item';
                    item.innerHTML = `<i class="fas fa-layer-group"></i><span>${groups[gid].name}</span>`;
                    item.addEventListener('click', async () => {
                        await GroupManager.addToGroup(gid, [AppState.selectedFile.filePath]);
                        MenuManager.hideAllMenus();
                    });
                    subMenu.appendChild(item);
                });
            }

            // 定位子菜单到"添加到组"右侧，若超出窗口则放左侧
            const parentRect = DOMCache.get('menuAddToGroup').getBoundingClientRect();
            const contextMenuRect = DOMCache.get('contextMenu').getBoundingClientRect();
            const scale = document.body.style.zoom ? parseFloat(document.body.style.zoom) : 1;
            subMenu.style.display = 'block';
            const subMenuWidth = subMenu.offsetWidth;
            if ((parentRect.right + subMenuWidth) > window.innerWidth) {
                subMenu.style.left = ((contextMenuRect.left - subMenuWidth) / scale) + 'px';
            } else {
                subMenu.style.left = (parentRect.right / scale) + 'px';
            }
            subMenu.style.top = (parentRect.top / scale) + 'px';
        });
        DOMCache.get('menuAddToGroup').addEventListener('mouseleave', function(e) {
            // 延迟隐藏，允许鼠标移到子菜单上
            setTimeout(() => {
                const subMenu = DOMCache.get('groupSubMenu');
                if (!subMenu.matches(':hover')) {
                    subMenu.style.display = 'none';
                }
            }, 200);
        });

        // 空白区域右键菜单
        DOMCache.get('menuPaste').addEventListener('click', async () => {
            try {
                const result = await FileOperationManager.pasteFiles();
                if (result.success === false) {
                    UIUtils.showMessage(result.message);
                }
            } catch (error) {
                console.error('粘贴失败:', error);
            }
            Utils.hideWithMotion(DOMCache.get('blankMenu'));
        });

        DOMCache.get('menuNew').addEventListener('click', () => {
            DialogManager.lockWindowVisibility();
            // DOMCache.get('newFileOverlay').style.display = 'flex';
            Utils.uiBoxDisplayChange(DOMCache.get('newFileOverlay'), 'flex',true);
            // Utils.hideWithMotion(DOMCache.get('blankMenu'));
            Utils.uiBoxDisplayChange(DOMCache.get('blankMenu'),"none", false);
        });

        DOMCache.get('menuNewGroup').addEventListener('click', () => {
            // Utils.hideWithMotion(DOMCache.get('blankMenu'));
            Utils.uiBoxDisplayChange(DOMCache.get('blankMenu'),"none", false);
            GroupManager.createGroup();
        });

        // 组视图关闭
        DOMCache.get('closeGroupView').addEventListener('click', () => {
            GroupManager.closeGroup();
        });
        DOMCache.get('groupViewOverlay').addEventListener('click', (e) => {
            if (e.target.id === 'groupViewOverlay') {
                GroupManager.closeGroup();
            }
        });
    },

    initDialogEvents() {
        // 重命名对话框
        DOMCache.get('renameCancel').addEventListener('click', () => {
            DialogManager.releaseWindowVisibility();
            Utils.hideWithMotion(DOMCache.get('renameOverlay'));
            AppState.dealing = false;
        });

        DOMCache.get('renameConfirm').addEventListener('click', async () => {
            // 组操作使用对话框时跳过文件重命名逻辑
            if (GroupManager.isDialogActive) return;
            if (AppState.dealing) return;
            AppState.dealing = true;
            try{
                const newName = DOMCache.get('renameInput').value.trim();
                if (newName) {
                    try{
                        await FileOperationManager.renameFile(AppState.selectedFile.filePath, newName);
                        Utils.hideWithMotion(DOMCache.get('renameOverlay'));
                        DialogManager.releaseWindowVisibility();
                    }catch(e){
                        UIUtils.showMessage(e);
                    }
                }
            }catch(e){}
            AppState.dealing = false;
        });

        // 删除确认对话框
        DOMCache.get('deleteCancel').addEventListener('click', () => {
            Utils.hideWithMotion(DOMCache.get('deleteConfirm'));
            AppState.dealing = false;
        });

        DOMCache.get('deleteConfirmBtn').addEventListener('click', async () => {
            AppState.dealing = true;
            const result = await FileOperationManager.removeFile(AppState.selectedFile.filePath);
            if (result.success === false) {
                UIUtils.showMessage(result.message);
            }
            Utils.hideWithMotion(DOMCache.get('deleteConfirm'));
            AppState.dealing = false;
        });

        DOMCache.get('deleteConfirmBtn_r').addEventListener('click', async () => {
            AppState.dealing = true;
            const result = await FileOperationManager.removeFile(AppState.selectedFile.filePath, "rubbish");
            if (result.success === false) {
                UIUtils.showMessage(result.message);
            }
            Utils.hideWithMotion(DOMCache.get('deleteConfirm'));
            AppState.dealing = false;
        });

        // 新建文件对话框
        DOMCache.get('newFileCancel').addEventListener('click', () => {
            DialogManager.releaseWindowVisibility();
            Utils.hideWithMotion(DOMCache.get('newFileOverlay'));
        });

        DOMCache.get('newFileConfirm').addEventListener('click', async () => {
            const selectedType = DOMCache.get('newFileTypeSelect').value;
            if (selectedType) {
                await FileOperationManager.createNewFile(selectedType);
                Utils.hideWithMotion(DOMCache.get('newFileOverlay'));
                DialogManager.releaseWindowVisibility();
            }
        });

        // 重命名输入框回车确认
        DOMCache.get('renameInput').addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                DOMCache.get('renameConfirm').click();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                DOMCache.get('renameCancel').click();
            }
        });
    },

    initSettingsEvents() {
        const settingsBtn = DOMCache.get('settingsBtn');
        const themePanel = DOMCache.get('themeSettingsPanel');
        const closeBtn = DOMCache.get('closeThemePanel');

        // 关闭设置面板（× / 点外部 / 齿轮 三条路径共用同一套收尾）
        // 【动效】只做一次淡出：卡片先淡出，然后隐藏整个浮层——
        // 注意这里最后**只能**是 display='none'，不能再套一层 hideWithMotion，
        // 否则会出现"淡出两次才关掉"（曾经就是这么错的）。
        let panelSeq = 0;
        let panelClosing = false;
        const openThemePanel = () => {
            ++panelSeq;            // 作废正在进行的收起动作
            panelClosing = false;
            const card = DOMCache.get('themeSettings_box') || themePanel;
            card.classList.remove('fade-out-up');   // 万一淡出还没结束，先复位
            Utils.uiBoxDisplayChange(themePanel, 'flex', true);
            ApiHelper.call("lock_window_visibility");
        };
        const closeThemePanel = async () => {
            const my = ++panelSeq;
            panelClosing = true;
            UIUtils.enableScroll();
            ApiHelper.call("unlock_window_visibility");
            const card = DOMCache.get('themeSettings_box') || themePanel;
            card.classList.add('fade-out-up');
            await new Promise(r => setTimeout(r, 150));
            card.classList.remove('fade-out-up');
            if (my !== panelSeq) return; // 淡出期间又被打开了，别把新打开的面板关掉
            panelClosing = false;
            themePanel.style.display = 'none';
        };

        settingsBtn.addEventListener('click', () => {
            // 正在淡出途中再点一次 = 取消关闭（重开），行为确定，不随时序变化
            if (themePanel.style.display === 'flex' && !panelClosing) {
                // 关闭走和 × 相同的一套（原来这里只设了子元素的 display，
                // 浮层还留着，而且没解锁窗口可见性）
                closeThemePanel();
                return;
            }
            openThemePanel();
        });

        closeBtn.addEventListener('click', closeThemePanel);

        // 【交互】点设置面板以外的区域直接关闭它（不用非得点右上角 ×）。
        // 面板自身、面板里弹出的编辑器/对话框、右键菜单都算"内部"，点了不关。
        document.addEventListener('mousedown', (e) => {
            if (themePanel.style.display !== 'flex') return;
            if (e.button !== 0) return;
            const INSIDE = '.theme-settings-panel, .theme-editor-overlay, .rename-overlay,' +
                           '.file-selection-overlay, .update-overlay, .group-view-overlay,' +
                           '.context-menu, .settings-btn, .message_box';
            if (e.target && e.target.closest && e.target.closest(INSIDE)) return;
            closeThemePanel();
        }, true);

        this.initToggleSettings();
        this.initThemeSettings();
        this.initBackgroundSettings();
        this.initScaleSettings();
        this.initThemeEditorEvents();
    },

    initThemeEditorEvents() {
        const self = this;
        
        // 双击自定义主题卡片打开编辑器
        const customCard = DOMCache.get('customThemeCard');
        if (customCard) {
             customCard.addEventListener('dblclick', () => {
                 ThemeManager.openEditor();
             });
             customCard.addEventListener('contextmenu', (e) => {
                 e.preventDefault();
                 ThemeManager.openEditor();
             });
         }

         // 编辑图标按钮点击
         const themeEditIconBtn = DOMCache.get('themeEditIconBtn');
         if (themeEditIconBtn) {
             themeEditIconBtn.addEventListener('click', (e) => {
                 e.stopPropagation(); // 防止触发卡片的单击应用主题
                 ThemeManager.openEditor();
             });
         }

         // 关闭按钮
        DOMCache.get('closeThemeEditor').addEventListener('click', () => ThemeManager.cancelEdit());
        DOMCache.get('cancelThemeEdit').addEventListener('click', () => ThemeManager.cancelEdit());
        DOMCache.get('confirmThemeEdit').addEventListener('click', () => ThemeManager.saveCustomTheme());

        // 颜色选择器实时预览
        const colorPickers = [
            { id: 'primaryColorPicker', key: 'primary' },
            { id: 'secondaryColorPicker', key: 'secondary' },
            { id: 'bgColorPicker', key: 'bgColor' },
            { id: 'bgGradient1', key: 'bgGradient1' },
            { id: 'bgGradient2', key: 'bgGradient2' },
            { id: 'mainTextColorPicker', key: 'mainText' },
            { id: 'subTextColorPicker', key: 'subText' }
        ];

        colorPickers.forEach(picker => {
            DOMCache.get(picker.id).addEventListener('input', (e) => {
                ThemeManager.customThemeConfig[picker.key] = e.target.value;
                ThemeManager.applyCustomThemeVariables(ThemeManager.customThemeConfig);
            });
        });

        // 透明度预览
        DOMCache.get('secondaryAlphaPicker').addEventListener('input', (e) => {
            const val = e.target.value;
            ThemeManager.customThemeConfig.secondaryAlpha = parseInt(val);
            DOMCache.get('secondaryAlphaValue').innerText = val + '%';
            ThemeManager.applyCustomThemeVariables(ThemeManager.customThemeConfig);
        });

        // 背景类型切换
        const bgBtns = DOMCache.getAllBySelector('.bg-type-btn');
        bgBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.type;
                ThemeManager.customThemeConfig.bgType = type;
                
                bgBtns.forEach(b => b.classList.toggle('active', b === btn));
                DOMCache.get('solidBgPicker').style.display = type === 'solid' ? 'flex' : 'none';
                DOMCache.get('gradientBgPicker').style.display = type === 'gradient' ? 'flex' : 'none';
                
                ThemeManager.applyCustomThemeVariables(ThemeManager.customThemeConfig);
            });
        });

        // 预设点击
        const presets = {
            'classic-dark': { primary: '#667eea', secondary: '#28283c', secondaryAlpha: 70, bgType: 'gradient', bgGradient1: '#1a1a2e', bgGradient2: '#16213e', mainText: '#e0e0e0', subText: '#8a9ba8' },
            'ocean-blue': { primary: '#00c6ff', secondary: '#002147', secondaryAlpha: 70, bgType: 'gradient', bgGradient1: '#004e92', bgGradient2: '#000428', mainText: '#ffffff', subText: '#b0d4ff' },
            'forest-green': { primary: '#a8e063', secondary: '#1b3a2b', secondaryAlpha: 75, bgType: 'gradient', bgGradient1: '#134e5e', bgGradient2: '#71b280', mainText: '#ffffff', subText: '#d4edda' },
            'sunset-orange': { primary: '#ff9068', secondary: '#4a1d1d', secondaryAlpha: 70, bgType: 'gradient', bgGradient1: '#f46b45', bgGradient2: '#eea849', mainText: '#ffffff', subText: '#ffeadb' },
            'sakura-pink': { primary: '#ff758c', secondary: '#4a2c3a', secondaryAlpha: 70, bgType: 'gradient', bgGradient1: '#ff9a9e', bgGradient2: '#fecfef', mainText: '#ffffff', subText: '#ffe0e6' },
            'midnight-purple': { primary: '#9d50bb', secondary: '#240b36', secondaryAlpha: 80, bgType: 'gradient', bgGradient1: '#232526', bgGradient2: '#414345', mainText: '#e0e0e0', subText: '#a0a0a0' },
            'cyberpunk': { primary: '#ff00ff', secondary: '#000000', secondaryAlpha: 80, bgType: 'gradient', bgGradient1: '#000000', bgGradient2: '#120458', mainText: '#00ffff', subText: '#ff00ff' },
            'matcha': { primary: '#8fb9a8', secondary: '#ffffff', secondaryAlpha: 40, bgType: 'gradient', bgGradient1: '#fefad4', bgGradient2: '#d4e4bc', mainText: '#2d342d', subText: '#4e594b' },
            'mocha': { primary: '#a0785a', secondary: '#1a0f0a', secondaryAlpha: 80, bgType: 'gradient', bgGradient1: '#3d2b1f', bgGradient2: '#1a0f0a', mainText: '#f5f5f5', subText: '#d7ccc8' },
            'nordic': { primary: '#5e81ac', secondary: '#ffffff', secondaryAlpha: 50, bgType: 'gradient', bgGradient1: '#eceff4', bgGradient2: '#d8dee9', mainText: '#2e3440', subText: '#4c566a' },
            'golden': { primary: '#f6d365', secondary: '#4a3c1d', secondaryAlpha: 70, bgType: 'gradient', bgGradient1: '#f6d365', bgGradient2: '#fda085', mainText: '#ffffff', subText: '#ffedbc' },
            'deep-sea': { primary: '#48c6ef', secondary: '#0b2d39', secondaryAlpha: 85, bgType: 'gradient', bgGradient1: '#0b2d39', bgGradient2: '#000000', mainText: '#ffffff', subText: '#6f9d98' }
        };

        DOMCache.getAllBySelector('.preset-item').forEach(item => {
            item.addEventListener('click', () => {
                const name = item.dataset.name;
                const preset = presets[name];
                if (preset) {
                    // 合并预设到当前配置
                    ThemeManager.customThemeConfig = { ...ThemeManager.customThemeConfig, ...preset };
                    // 更新 UI 并应用
                    ThemeManager.openEditor(); // 重新调用以刷新输入框
                    ThemeManager.applyCustomThemeVariables(ThemeManager.customThemeConfig);
                }
            });
        });
    },

    initToggleSettings() {
        const toggles = [
            'autoStartToggle', 'fullScreenToggle', 'fdrToggle',
            'of_sToggle', 'sysappToggle',/* 'followSystemTheme',*/'imgpreToggle','blurToggle','showHiddenToggle'
        ];

        const configKeys = [
            'auto_start', 'full_screen', 'fdr',
            'of_s', 'show_sysApp',/* 'follow_sys',*/'imgpre','blur_bg','show_hidden_file'
        ];

        toggles.forEach((toggleId, index) => {
            DOMCache.get(toggleId).addEventListener('change', function () {
                ApiHelper.updateConfig(configKeys[index], this.checked);
                // if (toggleId === 'themeChangeType_toggle') {
                //     EventManager.updateThemeCardInteraction(this.value == "1");
                // }
                if(toggleId === "imgpreToggle"){
                    if(this.checked==true){
                        image_preview()
                    }else{
                        preview_runing = false
                    }
                }else if(toggleId === "blurToggle"){
                    if(typeof config !== "undefined" && config) config.blur_bg = this.checked;
                    applyGlassSettings();   // 内部会调 set_blur_effect，并按依赖规则刷新灰显
                }else if(toggleId === "showHiddenToggle"){
                    console.log("showHiddenToggle")
                    NavigationManager.refreshCurrentPath(false,false,false,true)
                }else if(toggleId === "autoStartToggle"){
                    // 关闭自启动时，同时取消优先级按钮状态
                    if(this.checked==false){
                        setPriorityBtnActive(false);
                    }
                    // 显隐优先级按钮
                    DOMCache.get('autoStartPriorityBtn').style.display = this.checked ? '' : 'none';
                }
            });
        });

        // 开机自启动优先级按钮
        DOMCache.get('autoStartPriorityBtn').addEventListener('click', async function () {
            const isActive = this.classList.contains('active');
            if (isActive) {
                // 当前已是高优先级，点击取消
                await ApiHelper.updateConfig('auto_start_priority', false);
            } else {
                // 点击启用高优先级
                await ApiHelper.updateConfig('auto_start_priority', true);
            }
        });

        // ===== 组合热键：输入框直接录键盘（不再弹对话框）=====
        // 存给后端的是 ctrl+alt+e 这种写法，界面上显示成 Ctrl + Alt + E
        const HOTKEY_LABELS = { ctrl:'Ctrl', alt:'Alt', shift:'Shift', win:'Win', windows:'Win', esc:'Esc', enter:'Enter', space:'Space', tab:'Tab', up:'↑', down:'↓', left:'←', right:'→' };
        const HOTKEY_MODS = ['ctrl','alt','shift','win'];
        function prettyHotkey(str){
            if(!str) return '';
            return String(str).split('+').map(function(p){
                const k = p.trim().toLowerCase();
                if(!k) return '';
                return HOTKEY_LABELS[k] || (k.length === 1 ? k.toUpperCase() : k.charAt(0).toUpperCase()+k.slice(1));
            }).filter(Boolean).join(' + ');
        }
        // 键盘事件 → 后端识别的键名（命名与 hotkey_record.js 的 getKeyName 一致）
        function keyNameOf(e){
            const k = e.key;
            if(k === 'Control') return 'ctrl';
            if(k === 'Alt') return 'alt';
            if(k === 'Shift') return 'shift';
            if(k === 'Meta') return 'win';
            if(k === ' ') return 'space';
            if(k === 'Escape') return 'esc';
            if(k === 'Enter') return 'enter';
            if(k === 'Tab') return 'tab';
            if(k === 'ArrowUp') return 'up';
            if(k === 'ArrowDown') return 'down';
            if(k === 'ArrowLeft') return 'left';
            if(k === 'ArrowRight') return 'right';
            return k.length === 1 ? k.toLowerCase() : k.toLowerCase();
        }

        let hkCapturing = false, hkKeys = [];

        // 显示/隐藏「组合热键」行并回填当前值（cfg 可选，启动阶段全局 config 还没赋值）
        window.showHotkeyText = function (cfg) {
            const row = document.getElementById('hotkey_row');
            const el = DOMCache.get('hotkey_show');
            if (!el || !row) return;
            const c = cfg || (typeof config === 'object' && config) || {};
            row.style.display = (String(c.cf_type) === '4') ? '' : 'none';
            if (hkCapturing) return;   // 录制中不要覆盖正在按的组合
            el.value = prettyHotkey(c.cf_hotkey);
            el.title = '点击后直接按下组合键（例如 Ctrl + Alt + E）';
        };

        function hkStart(){
            const el = DOMCache.get('hotkey_show');
            if(!el || hkCapturing) return;
            hkCapturing = true;
            hkKeys = [];
            el.value = '';              // 清空后显示灰色提示"请输入组合键"
            el.classList.add('capturing');
            el.focus();
        }

        // commit=true 时保存生效；false 表示取消（恢复原值）
        function hkFinish(commit){
            const el = DOMCache.get('hotkey_show');
            if(!el) return;
            if(!hkCapturing) return;
            hkCapturing = false;
            el.classList.remove('capturing');
            const combo = hkKeys.join('+');
            const hasMain = hkKeys.some(function(k){ return HOTKEY_MODS.indexOf(k) === -1; });
            hkKeys = [];
            if(commit && combo && hasMain){
                el.value = prettyHotkey(combo);
                el.blur();
                (async function(){
                    await ApiHelper.updateConfig('cf_hotkey', combo);
                    await ApiHelper.updateConfig('cf_type', '4');
                    if(typeof config === 'object' && config){ config.cf_hotkey = combo; config.cf_type = '4'; }
                })().catch(function(e){ console.error('[ed] 保存组合热键失败', e); });
            }else{
                el.blur();
                window.showHotkeyText();
            }
        }

        {
            const hkEl = DOMCache.get('hotkey_show');
            if (hkEl) {
                // 点一下就清空并开始听键盘（此时显示灰色占位提示）
                hkEl.addEventListener('mousedown', function (e) {
                    e.preventDefault();   // 纯录制，不要光标/选词
                    hkStart();
                });
                hkEl.addEventListener('keydown', function (e) {
                    if(!hkCapturing) return;
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    if(e.key === 'Escape'){ hkFinish(false); return; }   // Esc 取消
                    const n = keyNameOf(e);
                    if(hkKeys.indexOf(n) !== -1) return;
                    hkKeys.push(n);
                    hkEl.value = prettyHotkey(hkKeys.join('+'));
                    // 按下"主键"（非修饰键）即算录完，立刻保存并生效
                    if(HOTKEY_MODS.indexOf(n) === -1) hkFinish(true);
                });
                // 点到别处也结束（按已按下的键提交）
                hkEl.addEventListener('blur', function(){ if(hkCapturing) hkFinish(true); });
            }
        }

        // 选择器设置
        DOMCache.get('cf_type_toggle').addEventListener('change',async function () {
            try{
                if(this.value=="4"){
                    // 选「自定义」：不再弹对话框，直接亮出组合热键那一行并开始录制
                    await ApiHelper.updateConfig('cf_type', this.value);
                    if(typeof config === 'object' && config) config.cf_type = '4';
                    window.showHotkeyText();
                    hkStart();
                    return
                }
                ApiHelper.updateConfig('cf_type', this.value);
                if(typeof config === 'object' && config) config.cf_type = String(this.value);
                window.showHotkeyText();
            }catch(e){
                config = await ApiHelper.getConfig()
                this.value = config.cf_type
                window.showHotkeyText(config);
            }
        });

        DOMCache.get('out_cf_type_toggle').addEventListener('change', function () {
            ApiHelper.updateConfig('out_cf_type', this.value);
        });
        DOMCache.get("outPos_toggle").addEventListener('change', function () {
            ApiHelper.updateConfig('outPos', this.value);
        });
        DOMCache.get("corner_size_toggle").addEventListener('change', function () {
            ApiHelper.updateConfig('corner_size', this.value);
        });
        DOMCache.get("dbc_action_toggle").addEventListener('change', function () {
            ApiHelper.updateConfig('dbc_action', this.value);
        });
        DOMCache.get("bgType_toggle").addEventListener('change', function () {
            ApiHelper.updateConfig('bgType', this.value);
            // 背景绘制统一走 initScaleSettings 里注册的 applyGlassSettings 监听，这里不再直接 load_bgType
            EventManager.updateBGInteraction(this.value != "1");
        });
        DOMCache.get("themeChangeType_toggle").addEventListener('change', function () {
            ApiHelper.updateConfig('themeChangeType', this.value);
            // EventManager.updateThemeCardInteraction();
        });
    },

    initThemeSettings() {
        const themeCards = DOMCache.getAllBySelector('.theme-card');
        const followSystemToggle = DOMCache.get('followSystemTheme');

        themeCards.forEach(card => {
            card.addEventListener('click', function () {
                // if (followSystemToggle.checked) return;

                const theme = this.dataset.theme;
                ApiHelper.updateConfig("theme", theme);
                load_theme(theme);

                themeCards.forEach(c => c.classList.remove('active'));
                this.classList.add('active');
            });
        });

        // 监听系统主题变化
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async (e) => {
            const config = await ApiHelper.getConfig();
            if (config.themeChangeType == "1") {
                const newTheme = e.matches ? 'dark' : 'light';
                load_theme(newTheme);
            }
        });
    },

    async updateThemeCardInteraction() {
        var now_config = await ApiHelper.getConfig()
        let bgState = now_config.bgType != "1";
        const themeCards = DOMCache.getAllBySelector('.theme-card');
        themeCards.forEach(card => {
            card.style.opacity = bgState ? '0.5' : '1';
            card.style.pointerEvents = bgState ? 'none' : 'auto';
        });
    },
    updateBGInteraction(state) {
        const bgtCards = DOMCache.get('bg_setting');
        for(let card of bgtCards.children){
            // 「选择图片/恢复默认」按钮保持可用（选完图会自动切回正常模式）
            if(card.classList.contains('bg-settings')) continue;
            // 标签/滑条的灰显由 applyGlassSettings 的 setting-disabled 类管，内联样式会覆盖类导致灰显失效
            if(card.classList.contains('blur-label') || card.classList.contains('blur-slider')) continue;
            card.style.opacity = state ? '0.5' : '1';
            card.style.pointerEvents = state ? 'none' : 'auto';
        };
    },

    initBackgroundSettings() {
        const blurSlider = DOMCache.get('blurSlider');
        const blurValue = DOMCache.get('blurValue');

        if (blurSlider && blurValue) {
            blurSlider.addEventListener('input', async function () {
                blurValue.textContent = this.value;
                await ApiHelper.updateConfig("ms_ef", parseInt(this.value));
                // 直接改背景图层的模糊变量即可：不必走整套 applyBackgroundSettings，
                // 那会顺带重设一次系统亚克力，拖动时整窗会闪
                if(typeof config !== "undefined" && config) config.ms_ef = parseInt(this.value);
                document.body.style.setProperty('--ed-bg-blur', `${parseInt(this.value)}px`);
            });
        }

        DOMCache.get('bgResetBtn').addEventListener('click', async () => {
            await ApiHelper.updateConfig("use_bg", false);
            await ApiHelper.updateConfig("bg", "");
            await ApiHelper.updateConfig("ms_ef", 50);
            blurSlider.value = 50;
            blurValue.textContent = '50';
            config = await ApiHelper.getConfig();
            ThemeManager.applyBackgroundSettings(config);
        });

        DOMCache.get('bgCustomBtn').addEventListener('click', async () => {
            try {
                const bgUrl = await ApiHelper.call('set_background');
                if (bgUrl) {
                    await ApiHelper.updateConfig("use_bg", true);
                    await ApiHelper.updateConfig("bg", bgUrl);
                    await ApiHelper.updateConfig("ms_ef", 0);
                    await ApiHelper.updateConfig("bgType", "1");
                    config = await ApiHelper.getConfig();
                    setTimeout(() => {
                        window.location.reload();
                        // ThemeManager.applyBackgroundSettings(config);
                    }, 500);
                }
            } catch (error) {
                console.error('设置背景图片失败:', error);
            }
            // setTimeout(() => {
            //     window.location.reload();
            // }, 500);
        });
    },

    initScaleSettings() {
        const scaleSlider = DOMCache.get('sc_slider');
        scaleSlider.addEventListener('input', function () {
            const scaleValue = this.value;
            DOMCache.get("sc_input").innerText = `缩放比例：${scaleValue}%`;
            ConfigManager.updateScale(scaleValue);
        });
        const blur_ef_input = DOMCache.get('blur_ef_input');
        blur_ef_input.addEventListener('input', function () {
            var value = this.value;
            DOMCache.get("blur_ef_input_show").innerText = `毛玻璃效果强度：${value}%`;
            ApiHelper.updateConfig("blur_effect", Math.floor(100-value));
            // 立刻生效：面板背景透明度 + 系统亚克力一起刷新（只写配置是不会变的）
            if(typeof config !== "undefined" && config) config.blur_effect = Math.floor(100-value);
            // CSS 层面（透明模式的薄纱/增强模式的贴面浓度）拖动中立刻反馈；
            // 系统亚克力的磨砂浓度等松手后再同步——每个 input 事件都重设会让整窗闪
            applyGlassSettings(null, true);
            clearTimeout(applyGlassSettings._sysT);
            applyGlassSettings._sysT = setTimeout(function(){ applyGlassSettings(); }, 350);
        });
        // 背景类型决定毛玻璃能不能生效，改它要重算生效状态和灰显
        const bgTypeSel = DOMCache.get('bgType_toggle');
        if(bgTypeSel) bgTypeSel.addEventListener('change', function(){
            if(typeof config !== "undefined" && config) config.bgType = this.value;
            applyGlassSettings();
        });
    },

    initNavigationEvents() {
        DOMCache.get('pathBackBtn').addEventListener('click', async () => {
            const parentPath = await ApiHelper.call('get_parent', AppState.currentPath);
            NavigationManager.navigateTo(parentPath);   // 过滤已在 navigateTo 内于渲染前完成
        });

        DOMCache.get('breadcrumb').addEventListener('click', (e) => {
            if (e.target.classList.contains('breadcrumb-item')) {
                const path = e.target.dataset.path;
                NavigationManager.navigateTo(path);
                DOMCache.get("search_input").value = "";
                syncSearchView();
            }
        });
    },

    initKeyboardEvents() {
        document.addEventListener('keydown', (event) => {
            if (document.activeElement.id !== 'search_input') {
                const searchInput = DOMCache.get('search_input');
                if (DOMCache.get("renameOverlay").style.display === "flex") return;
                if (DOMCache.get("groupDeleteConfirm").style.display === "flex") return;
                if(document.activeElement.id == "categoryInput") return
                if(document.getElementById("fileSelectionDialog").style.display!="none")return;
                if(window_state==false)return

                if (searchInput && !event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1) {
                    searchInput.focus();
                }
            }
        });
    },

    initClickEvents() {
        document.addEventListener('click', (event) => {
            if(event.target.id=="menuAddToGroup")return
            try{if(event.target.parentNode.id=="menuAddToGroup")return}catch(e){}
            MenuManager.hideAllMenus();

            if (["content_box", "main","filesContainer","content_col"].includes(event.target.id)) {
                ApiHelper.call('close_fullscreen_window');
            }
        });
        document.addEventListener('contextmenu', (e) => {
            // this.handleBlankContextMenu(e);
            console.log(e.target)
            if(config.df_dir==AppState.currentPath){
                console.log("当前目录")
                // document.getElementById("menuNewGroup").style.display="block"
                // document.getElementById("menuAddToGroup").style.display="block"
                Utils.uiBoxDisplayChange(document.getElementById("menuNewGroup"),block,true)
                Utils.uiBoxDisplayChange(document.getElementById("menuAddToGroup"),block,false)
            }else{
                console.log("非当前目录")
                // document.getElementById("menuNewGroup").style.display="none"
                // document.getElementById("menuAddToGroup").style.display="none"
                Utils.uiBoxDisplayChange(document.getElementById("menuNewGroup"),none,true)
                Utils.uiBoxDisplayChange(document.getElementById("menuAddToGroup"),none,false)
            }
        });
        // 空白区域右键菜单
        DOMCache.getBySelector('.content_box').addEventListener('contextmenu', (e) => {
            this.handleBlankContextMenu(e);
        });

        // DOMCache.getBySelector('.content_box').addEventListener('contextmenu', (e) => {
        //     this.handleBlankContextMenu(e);
        // });
    },

    handleBlankContextMenu(e) {
        // content_col / box1 是竖向栏改造后新增的"空白区域"（网格下方、分类栏背景），
        // 不补进来的话这两块空白处右键就弹不出菜单了。
        if (e.target.classList.contains('files-grid') || e.target.classList.contains('files-list') || e.target.classList.contains('content_box')
            || e.target.classList.contains('content_col') || e.target.classList.contains('box1')) {
            e.preventDefault();
            MenuManager.hideContextMenu();
            const blankMenu = DOMCache.get('blankMenu');
            // blankMenu.style.display = 'block';
            Utils.uiBoxDisplayChange(blankMenu,block,true)
            const bsr = (typeof config !== 'undefined' && config && config.scale) ? config.scale/100 : 1;
            blankMenu.style.left = `${Math.min(e.pageX, window.innerWidth - blankMenu.offsetWidth) / bsr}px`;
            blankMenu.style.top = `${Math.min(e.pageY, window.innerHeight - blankMenu.offsetHeight) / bsr}px`;
        }
    },

    showRenameDialog() {
        DialogManager.lockWindowVisibility();
        const renameOverlay = DOMCache.get('renameOverlay');
        const renameInput = DOMCache.get('renameInput');

        renameInput.value = AppState.selectedFile.fileName;
        // renameOverlay.style.display = 'flex';
        Utils.uiBoxDisplayChange(renameOverlay,"flex",true)
        renameInput.focus();

        MenuManager.hideContextMenu();
    },

    showDeleteConfirm() {
        const deleteConfirm = DOMCache.get('deleteConfirm');
        const deleteFileName = DOMCache.get('deleteFileName');

        deleteFileName.textContent = AppState.selectedFile.fileName;
        // deleteConfirm.style.display = 'flex';
        Utils.uiBoxDisplayChange(deleteConfirm,"flex",true)

        MenuManager.hideContextMenu();
    },
 
    async setIcon(){
        r=await ApiHelper.call("setIcon", AppState.selectedFile.filePath,AppState.selectedFile.edit_ico==undefined)
        if(r["success"]==true){
            NavigationManager.refreshCurrentPath(false,false,false,true)
        }else{
            if(r["message"]){
                if(r["message"]!="未选择图标"){
                    UIUtils.showMessage(r["message"],true)
                }
            }
        }
        
    }
};

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

        try {
            // 获取文件信息
            const result = await ApiHelper.getFileInfo(AppState.currentPath);
            selections = result.data;

            // 清空加载提示
            fileSelectionList.innerHTML = '';

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
                if(list_data.includes(Utils.generateFileId(item.filePath))){
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

                // 图标
                icon = document.createElement('img');
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
            Utils.hideWithMotion(dialogContainer);
            UIUtils.enableScroll();
            resolve({files_data: selectedItems, title: categoryTitle});
            ApiHelper.call("unlock_window_visibility")
        }

        // 点击对话框外部关闭
        function handleOverlayClick(e) {
            if (e.target === overlay) {
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
// 【性能优化】图片缩略图结果缓存：重渲染时直接复用，不再为每个图片重复一次
// 「PIL 解码 + 缩放 + JPEG 编码 + base64」的跨桥 IPC（原先每次刷新都全量重算）
const imgPreviewCache = new Map()
function clearImgPreviewCache(){
    imgPreviewCache.clear()
}
async function image_preview() {
    try{
        if(preview_runing) return;
        let config = await ApiHelper.getConfig()
        if(config["imgpre"]==false)return
        preview_runing = true;
        for(let file of AppState.files_data){
            if(preview_runing==false) break;
            if(![".png",".jpg",".jpeg",".bmp",".gif"].includes(file.fileType)) continue;
            const el = document.getElementById(Utils.generateFileId(file.filePath));
            // 元素不存在（未渲染 / 已被过滤）时跳过，避免原代码里 te 为 null 直接抛错
            // 中断整个预览循环
            if(!el || !el.children || !el.children[1]) continue;
            let view_img = imgPreviewCache.get(file.filePath);
            if(view_img === undefined){
                view_img = await ApiHelper.call("get_imageBase64", file.filePath);
                if(imgPreviewCache.size > 400) imgPreviewCache.clear();
                imgPreviewCache.set(file.filePath, view_img || null);
            }
            if(view_img){
                el.children[1].src = view_img
            }
        }
        preview_runing = false;
    }catch(e){
        console.log("image_preview error")
        preview_runing = false
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
        document.body.style.backdropFilter = `blur(${Math.round(strength/4)}px)`
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

let enter_click = false;
window.addEventListener("keydown", function(event) {
    if (event.key === 'Enter') {
        // 输入框活跃或对话框打开时不触发文件点击
        // if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
        event.preventDefault();
        if (DOMCache.get("renameOverlay").style.display === "flex") return;
        if (DOMCache.get("groupDeleteConfirm").style.display === "flex") return;
        if (DOMCache.get("themeSettingsPanel").style.display === "flex")return;
        for(let e of [...document.getElementById("filesContainer").children,...document.getElementById("filesListContainer").children]){
            if(e.style.display != "none" && enter_click==false){
                enter_click = true
                e.click()
                setTimeout(function () {
                    enter_click = false
                }, 3000);
                break
            }
        }
    }
});


let dragging = false
boxs = [
    document.getElementById("filesContainer"),
    document.getElementById("filesListContainer"),
    document.getElementById("class_bar"),
    document.getElementById("groupFilesContainer")
]
content_box = document.getElementById("content_box")
boxs[0].dataset.other = "list"
boxs[1].dataset.other = "grid"
/* 当前可见的文件滚动容器（网格 / 列表二选一）。
   布局改成"卡片内滚动"之后，回到顶部、拖拽自动滚动都作用于它，而不是整页。 */
function activeFileScroller(){
    const l = document.getElementById("filesListContainer");
    if(l && l.style.display !== "none") return l;
    return document.getElementById("filesContainer");
}
/* 往上找最近的可滚动祖先（分类栏没有，组视图有） */
function scrollParentOf(el){
    let n = el && el.parentElement;
    while(n && n !== document.body){
        const oy = getComputedStyle(n).overflowY;
        if((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
        n = n.parentElement;
    }
    return null;
}
/* 从元素自身往上找滚动容器（框选用：网格/列表卡片自己是滚动区） */
function scrollerOf(el){
    if(!el) return null;
    const oy = getComputedStyle(el).overflowY;
    if(oy === "auto" || oy === "scroll") return el;
    return scrollParentOf(el);
}
/* body 上有用户设置的 zoom：布局像素 = 视口像素 / zoom */
function zoomFactor(){
    return parseFloat(document.body.style.zoom) || 1;
}

const DRAG_THRESHOLD = 4;   // 位移超过它才算拖拽，否则仍按点击处理
const DRAG_EDGE = 80;       // 距滚动容器上下边缘多近开始自动滚动
const DRAG_EDGE_MAX = 22;   // 完全贴边时每帧滚多少像素
const GHOST_MAX = 3;        // 拖起预览最多画几个真实图标，再多就只加数量气泡
/* 落点判定的迟滞带：以目标中线为中心，左右各留 15% 的「不改口」区间。
   没有它时，指针压在中线上来回蹭几个像素，插槽判定就在「插前面/插后面」之间跳，
   邻居先朝一侧让位、600ms 动画还没跑完又朝反方向让回来，看起来就是抽搐。 */
const DRAG_HYST = 0.15;

/* 重排（让位/展开）动画时长：与 frame.css 的 --md-motion-dur-reorder 成对，
   JS 读不到 CSS 变量，改一处必须同步另一处。 */
const REORDER_MS = 600;
const REORDER_EASE = "cubic-bezier(0.2, 0, 0, 1)";
const ITEM_SEL = ".file-item, .file-list-item, .class_bar_btn";

function reduceMotion(){
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
/* 列表视图的「横向行」又扁又宽（约 1700×68），网格格子接近方形，用形状就能区分。
   两处要按它分叉：落点取哪一侧、预览叠哪个方向。 */
const isRowLike = r => r.height * 1.6 < r.width;

/* 指针落在目标的哪一侧，决定插到它前面还是后面：
   - 列表视图的整行（又扁又宽）只看上下半；早先也按左右半判，指针明明压在第一行，
     却因为偏右被算成"插到这行后面"，看上去就是让位方向和手指方向反了；
   - 网格格子和横向分类栏看左右半，而且左右两整半边都算。原来还叠了一条
     「落在下半也算后面」，等效于只有图标的左上角那一格才插前面，很别扭。
   prevSide 是同一个目标上一次的判定，用来做迟滞（见 DRAG_HYST），换目标就作废。 */
function insertSide(x, y, r, horizontal, prevSide){
    const vertical = !horizontal && isRowLike(r);
    const pos = (vertical ? y - r.top : x - r.left) / (vertical ? r.height : r.width);
    if(prevSide !== 0 && prevSide !== 1) return pos > 0.5 ? 1 : 0;   // 刚换目标：按中线判
    // 同一个目标上：越过中线还不够，要再走 15% 才改口，中间那段维持原判定
    if(prevSide === 0) return pos > 0.5 + DRAG_HYST ? 1 : 0;
    return pos < 0.5 - DRAG_HYST ? 0 : 1;
}
const itemsOf = list => [...list.children].filter(el => el.matches(ITEM_SEL));
/* 参与布局的图标。被拖走的那些是 display:none，offsetLeft 会读成 0，必须排掉 */
const flowItems = list => itemsOf(list).filter(el => !el.classList.contains("ed-drag-taken"));

/* 视口裁剪：屏幕外的位移观众根本看不见，就别给它挂 WAAPI 动画（每个动画=一个合成层）。
   返回 null 表示这个容器不做滚动裁剪。 */
function visibleBand(scroller){
    if(!scroller) return null;
    const sr = scroller.getBoundingClientRect();
    return [sr.top - 60, sr.bottom + 60];
}
function inBand(band, el){
    if(!band) return true;
    const b = el.getBoundingClientRect();
    return b.bottom >= band[0] && b.top <= band[1];
}

/* FLIP：记录位置 → 改 DOM → 先用 transform 反位移回去 → 播放回零。
   位移量用 offsetLeft/offsetTop 而不是 getBoundingClientRect，两个原因：
   一是 offset 不受 body{zoom} 影响（否则还得把位移除缩放比）；
   二是 offset 不受「上一段让位动画还没飞完」的 transform 污染，连续让位不会漂。
   动画走 Web Animations API，避免在元素上留下 inline transition 影响以后悬停。 */
function runFlip(list, mutate){
    if(reduceMotion()){
        mutate();
        return;
    }
    const first = new Map();
    for(const el of flowItems(list)) first.set(el, [el.offsetLeft, el.offsetTop]);
    mutate();
    /* 列表视图 140 行时一次让位会波及目标行往后的每一行：138 个补间 = 138 个合成层，
       起手的「图标收起」那一下就直接掉帧。只补间视口内那十来行。 */
    const band = visibleBand(scrollerOf(list));
    for(const el of flowItems(list)){
        const f = first.get(el);
        if(!f) continue;
        const dx = f[0] - el.offsetLeft, dy = f[1] - el.offsetTop;
        if(!dx && !dy) continue;
        if(!inBand(band, el)) continue;
        el.animate([{transform:`translate(${dx}px, ${dy}px)`}, {transform:"translate(0, 0)"}],
                   {duration:REORDER_MS, easing:REORDER_EASE});
    }
}

/* Ctrl + 点击多选，或 Shift + 拖动框选。
   注意别命名为 Selection：那是浏览器自带的 DOM 接口，顶层 const 会把它遮蔽掉。 */
const ItemSelection = {
    nodes: new Set(),
    /* 整批换成这批节点（框选每帧都要重算，逐个 toggle 太碎） */
    applySet(nodes){
        const next = new Set(nodes);
        for(const el of this.nodes) if(!next.has(el)) el.classList.remove("ed-selected");
        for(const el of next) el.classList.add("ed-selected");
        this.nodes = next;
    },
    toggle(el){
        if(this.nodes.has(el)){
            this.nodes.delete(el);
            el.classList.remove("ed-selected");
        }else{
            this.nodes.add(el);
            el.classList.add("ed-selected");
        }
    },
    replace(el){
        this.clear();
        this.nodes.add(el);
        el.classList.add("ed-selected");
    },
    clear(){
        for(const el of this.nodes) el.classList.remove("ed-selected");
        this.nodes.clear();
    },
    has(el){ return this.nodes.has(el); },
    get size(){ return this.nodes.size; },
    /* 重渲染后旧节点已脱离文档，顺手清掉，免得集合越攒越大 */
    prune(){
        for(const el of [...this.nodes]) if(!el.isConnected) this.nodes.delete(el);
    },
    /* 同一个容器里的选中项，按 DOM 顺序 */
    siblingsOf(el){
        return [...el.parentElement.children].filter(n => this.nodes.has(n));
    }
};

const DragManager = {
    active: false,
    pending: null,        // 按下了但还没到拖拽阈值
    nodes: [],            // 正在拖的节点（DOM 顺序）
    primary: null,        // 手指按住的那一个，整组的落点以它为准
    slot: null,           // 拖拽期间唯一的那个虚槽（整组合成一槽）
    lastPos: -1,          // 虚槽上一次所在的插入位，没挪动就不做 FLIP
    slotTarget: null,     // 上一次判定的目标图标（迟滞要认得「还是同一个」）
    lastSide: null,       // 上一次判定的那一侧
    list: null,
    ghost: null,
    scroller: null,
    px: 0, py: 0,         // 最近一次指针位置（视口坐标）
    grabX: 0, grabY: 0,   // 指针相对图标左上角的偏移
    raf: 0,
    suppressClick: false, // 拖完浏览器还会补一个 click，得吞掉，否则会顺手打开文件

    onDown(e, list){
        if(e.button !== 0) return;
        if(e.shiftKey) return;        // 按住 Shift 的手势归框选（Marquee），两者互斥
        const el = e.target.closest(".file-item, .file-list-item, .class_bar_btn");
        if(!el || !list.contains(el)) return;
        if(e.target.closest(".file-cl, .file-list-cl")) return;   // 分类勾选按钮不参与拖拽
        // 分类栏里「全部」固定在首位，不参与排序
        if(el.classList.contains("class_bar_btn") && el.dataset.reorderable !== "1") return;
        ItemSelection.prune();
        this.suppressClick = false;
        this.pending = { el, list, x: e.clientX, y: e.clientY };
    },

    onMove(e){
        this.px = e.clientX;
        this.py = e.clientY;
        if(this.active){
            e.preventDefault();   // 拖拽期间别把文件名选中成蓝底
            this.hitTest(e.clientX, e.clientY);
            return;
        }
        const p = this.pending;
        if(!p) return;
        if(Math.abs(e.clientX - p.x) < DRAG_THRESHOLD && Math.abs(e.clientY - p.y) < DRAG_THRESHOLD) return;
        this.begin(p, e);
    },

    begin(p, e){
        this.pending = null;
        this.list = p.list;
        // 按下的图标在多选里 → 整组一起拖；否则只拖它，并把它设为唯一选中项
        if(ItemSelection.has(p.el) && ItemSelection.size > 1){
            this.nodes = ItemSelection.siblingsOf(p.el);
        }else{
            ItemSelection.replace(p.el);
            this.nodes = [p.el];
        }
        // primary = 手指按住的那一个。整组的落点以它为准，其余按相对顺序贴着它排；
        // 早先用「nodes[0]（DOM 最靠前的那个）」当锚点，抓第二个图标时就会整组跑偏。
        this.primary = p.el;
        this.active = true;
        this.suppressClick = true;
        dragging = true;
        this.scroller = scrollParentOf(p.el);
        const r = p.el.getBoundingClientRect();
        this.grabX = e.clientX - r.left;
        this.grabY = e.clientY - r.top;
        this.buildGhost(p.el, r);
        document.body.classList.add("ed-dragging");
        ApiHelper.call("lock_window_visibility");
        this.liftSlot(r);            // 整组合成一个虚槽 + 第一次让位
        this.startLoop();
        this.hitTest(e.clientX, e.clientY);
    },

    /* 手机桌面式的第一次重排：N 个图标一起摘出布局，原位只留 1 个虚槽，
       空出来的 N-1 格当场被别的图标填满；此后全程只有这一个虚槽跟落点走。 */
    liftSlot(r){
        const slot = document.createElement("div");
        slot.className = "ed-drag-slot";
        slot.style.width = (r.width / zoomFactor()) + "px";
        slot.style.height = (r.height / zoomFactor()) + "px";
        this.slot = slot;
        this.lastPos = -1;
        this.slotTarget = null;     // 每次起拖重新计，迟滞不带上一把的旧结论
        this.lastSide = null;
        runFlip(this.list, () => {
            for(const n of this.nodes) n.classList.add("ed-drag-taken");
            // nodes[0] 未必还是 this.list 的直接子节点（极端时序下容器刚被重绘过），
            // 直接拿它当参照会让 insertBefore 抛 NotFoundError
            const ref = this.nodes[0].parentElement === this.list ? this.nodes[0] : null;
            this.list.insertBefore(slot, ref);
        });
    },

    buildGhost(el, r){
        const z = zoomFactor();
        const g = document.createElement("div");
        g.className = "ed-drag-ghost";
        g.style.width = (r.width / z) + "px";
        g.style.height = (r.height / z) + "px";

        /* 预览：≤3 个就把真实图标一个个叠出来；再多只画 3 个真实图标 + 数量角标。
           画哪三个：抓住的那个必须在最前（它正压在指针下），另两个取 DOM 顺序里离它最近的。 */
        const anchor = this.nodes.indexOf(el);
        let show = this.nodes;
        if(show.length > GHOST_MAX){
            show = show.map((n, i) => i)
                       .sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b)
                       .slice(0, GHOST_MAX)
                       .sort((a, b) => a - b)
                       .map(i => this.nodes[i]);
        }
        const at = show.indexOf(el);
        /* 列表视图的行接近全屏宽，原来的 7px 斜向错位叠上去等于完全重合，
           看着像渲染坏了；行布局改成纵向叠牌（步长更大、越远越缩）。
           分类栏虽然也是扁的，但它是横向轨道，仍按斜向扇形叠。 */
        const row = this.list !== boxs[2] && isRowLike(r);
        show.forEach((node, i) => {
            const step = i - at;
            const c = this.cloneFor(node);
            c.classList.add(step === 0 ? "ed-ghost-main" : "ed-ghost-copy");
            if(row){
                c.style.transform = step === 0
                    ? "translate(0, 0) scale(1.01)"
                    : `translate(0, ${-step * 12}px) scale(${1 - Math.abs(step) * 0.03})`;
            }else{
                c.style.transform = step === 0
                    ? "translate(0, 0) scale(1.04)"
                    : `translate(${step * 7}px, ${-step * 7}px)`;
            }
            // 离主图标越近压得越高，主图标始终在最上层
            c.style.zIndex = step === 0 ? "10" : String(6 - Math.abs(step));
            g.appendChild(c);
        });
        if(this.nodes.length > show.length){
            const b = document.createElement("div");
            b.className = "ed-ghost-badge";
            b.textContent = String(this.nodes.length);
            g.appendChild(b);
        }
        document.body.appendChild(g);
        this.ghost = g;
        this.placeGhost(this.px, this.py);
    },

    /* 克隆必须摘掉 id：否则文档里出现重复 id，DOMCache / querySelector 会抓错元素 */
    cloneFor(el){
        const c = el.cloneNode(true);
        c.removeAttribute("id");
        c.querySelectorAll("[id]").forEach(x => x.removeAttribute("id"));
        c.classList.remove("ed-selected", "ed-drag-taken");
        return c;
    },

    placeGhost(x, y){
        if(!this.ghost) return;
        const z = zoomFactor();
        this.ghost.style.transform =
            `translate3d(${(x - this.grabX) / z}px, ${(y - this.grabY) / z}px, 0)`;
    },

    hitTest(x, y){
        const under = document.elementFromPoint(x, y);
        if(!under) return;
        const list = this.list;
        const primary = this.primary;
        // 拖到应用组上：只高亮，不排序
        const groupEl = under.closest(".file-group-item");
        list.querySelectorAll(".drag-over-group").forEach(el => {
            if(el !== groupEl) el.classList.remove("drag-over-group");
        });
        if(groupEl && !primary.classList.contains("file-group-item")){
            groupEl.classList.add("drag-over-group");
            return;
        }
        const target = under.closest(ITEM_SEL);
        if(!target || target.parentElement !== list) return;
        if(this.nodes.indexOf(target) >= 0) return;
        if(list === boxs[2] && target.dataset.reorderable !== "1") return;
        if(target.dataset.is_cl !== primary.dataset.is_cl) return;
        const r = target.getBoundingClientRect();
        /* 插到目标的哪一侧，交给 insertSide：行看上下半、格子看左右半。
           连续压在同一个目标上判定时，把上一次的结论一起传进去做迟滞，
           否则指针在中线附近蹭两下，邻居就朝两边来回让位（抽搐）。 */
        const prev = this.slotTarget === target ? this.lastSide : null;
        const side = insertSide(x, y, r, list === boxs[2], prev);
        this.slotTarget = target;
        this.lastSide = side;
        this.placeSlot(target, side);
    },

    /* 把唯一的虚槽挪到目标格的这一侧。整组只占一个格位，所以抓组里第几个
       结果都确定，不会再出现「有时按第一个排、有时按第二个排」。 */
    placeSlot(target, side){
        const others = flowItems(this.list).filter(el => this.nodes.indexOf(el) < 0);
        const t = others.indexOf(target);
        if(t < 0) return;
        const pos = Math.max(0, Math.min(t + side, others.length));
        if(pos === this.lastPos) return;   // 虚槽没真挪动就别 FLIP，否则白甩一堆动画
        this.lastPos = pos;
        const ref = others[pos] || null;
        runFlip(this.list, () => this.list.insertBefore(this.slot, ref));
    },

    startLoop(){
        const step = () => {
            if(!this.active) return;
            this.placeGhost(this.px, this.py);
            this.edgeScroll();
            this.raf = requestAnimationFrame(step);
        };
        this.raf = requestAnimationFrame(step);
    },

    /* 贴边自动滚动：越贴边越快，逐帧直推 scrollTop。
       不再走「setInterval + scrollTo({behavior:'smooth'})」——那样每 50ms 重启一段
       平滑滚动，前一段还没跑完就被打断，观感就是掉帧。 */
    edgeScroll(){
        const s = this.scroller;
        if(!s) return;
        const r = s.getBoundingClientRect();
        let v = 0;
        if(this.py > r.top - 40 && this.py < r.top + DRAG_EDGE){
            v = -Math.ceil(DRAG_EDGE_MAX * (1 - (this.py - r.top) / DRAG_EDGE));
        }else if(this.py < r.bottom + 40 && this.py > r.bottom - DRAG_EDGE){
            v = Math.ceil(DRAG_EDGE_MAX * (1 - (r.bottom - this.py) / DRAG_EDGE));
        }
        if(!v) return;
        const max = s.scrollHeight - s.clientHeight;
        const next = Math.max(0, Math.min(max, s.scrollTop + v));
        if(next === s.scrollTop) return;
        s.scrollTop = next;
        this.hitTest(this.px, this.py);   // 滚动之后落点变了，重算
    },

    /* 拖拽中滚滚轮翻页：原生 drag&drop 期间 Chromium 屏蔽 wheel，这是换掉它的主因 */
    onWheel(e){
        if(!this.active) return;
        e.preventDefault();
        const s = this.scroller;
        if(!s) return;
        s.scrollTop += e.deltaY / zoomFactor();
        this.hitTest(this.px, this.py);
    },

    async end(e){
        this.pending = null;
        if(!this.active) return;
        this.active = false;
        dragging = false;
        cancelAnimationFrame(this.raf);
        document.body.classList.remove("ed-dragging");

        const list = this.list;
        const nodes = this.nodes;
        const primary = this.primary;
        const slot = this.slot;
        this.list = null;
        this.nodes = [];
        this.primary = null;
        this.slot = null;
        this.scroller = null;
        this.lastPos = -1;
        this.slotTarget = null;
        this.lastSide = null;

        if(this.ghost){ this.ghost.remove(); this.ghost = null; }
        ApiHelper.call("unlock_window_visibility");
        if(!primary) return;

        /* 拖拽期间页面被重绘过（图标已经脱离文档）就别落盘，
           否则会把一份缺了被拖项的顺序写进配置 */
        const alive = primary.isConnected && nodes.every(n => n.isConnected);

        const groupTarget = list.querySelector(".drag-over-group");
        const toGroup = groupTarget && !primary.classList.contains("file-group-item");
        if(toGroup){
            /* 拖进应用组：虚槽收回、图标复位，顺序交给刷新重建，不做第二次让位 */
            groupTarget.classList.remove("drag-over-group");
            slot && slot.remove();
            for(const n of nodes) n.classList.remove("ed-drag-taken");
            const groupId = groupTarget.dataset.group_id;
            const paths = alive
                ? nodes
                    .map(n => {
                        const f = AppState.files_data[n.dataset.list_index];
                        return f && f.filePath;
                    })
                    .filter(Boolean)
                : [];
            if(groupId && paths.length) await GroupManager.addToGroup(groupId, paths);
            ItemSelection.clear();
            return;
        }

        /* 第二次重排：松手之后，唯一那个虚槽才展开成 N 格，邻居再滑开让一次 */
        if(alive && slot && slot.parentElement === list){
            runFlip(list, () => {
                for(const n of nodes){
                    n.classList.remove("ed-drag-taken");
                    list.insertBefore(n, slot);   // 都插在同一个虚槽前 → 整组自然连续
                }
                slot.remove();
            });
            if(!reduceMotion()){
                /* 落位那一闪也只给视口内的图标做：框选几十个再松手时，
                   全量 animate 会让松手的那一帧明显卡一下 */
                const band = visibleBand(scrollerOf(list));
                for(const n of nodes){
                    if(!inBand(band, n)) continue;
                    n.animate([{opacity:.3, transform:"scale(1.05)"}, {opacity:1, transform:"scale(1)"}],
                              {duration:REORDER_MS, easing:REORDER_EASE});
                }
            }
        }else{
            slot && slot.remove();
            for(const n of nodes) n.classList.remove("ed-drag-taken");
        }
        if(!alive){ ItemSelection.clear(); return; }

        list.querySelectorAll(".drag-over-group").forEach(el => el.classList.remove("drag-over-group"));

        if(primary.classList.contains("class_bar_btn")){
            const order = [];
            for(const item of boxs[2].children){
                if(item.dataset.reorderable !== "1") continue;
                order.push(item.id);
            }
            await ApiHelper.call("save_classOrder", order);
        }else if(list === boxs[3]){
            const rect = groupContainer.getBoundingClientRect();
            const outside = e.clientX < rect.left || e.clientX > rect.right
                || e.clientY < rect.top || e.clientY > rect.bottom;
            if(outside){
                // 拖出组视图 = 从组里移除；多选时逐个删，最后只刷新一次
                for(const n of nodes){
                    const fp = n.dataset.file_path;
                    if(fp) await ApiHelper.call("remove_from_group", n.dataset.gid, fp);
                }
                if(GroupManager.currentOpenGroup !== null){
                    GroupManager.openGroup(GroupManager.currentOpenGroup, GroupManager.currentGroupName);
                }
                NavigationManager.refreshCurrentPath();
            }else{
                await GroupManager.editGroupOrder();
            }
        }else{
            /* 落盘排到下一帧：DOM 在这段代码里已经定型，但把 141 项序列化 + 一次 IPC
               挤进松手这一帧，正好就是「左键放掉的瞬间」那下卡顿 */
            requestAnimationFrame(() => save_new_order(list.dataset.other));
        }
        ItemSelection.clear();
    }
};

/* Shift + 拖动框选（橡皮筋）。桌面 140 项时 Ctrl 一个个点太慢，画个矩形一圈到底。
   和拖拽互斥：按下时带 Shift 只走这里，DragManager.onDown 见到 Shift 直接放行。 */
const Marquee = {
    active: false,
    box: null,
    list: null,
    sc: null,      // 框选期间的滚动容器，贴边自动滚动靠它
    from: null,    // 起点/终点用「内容坐标」：y = clientY + scrollTop，
    to: null,      // 这样自动滚动时矩形跟着内容走，不会把已经圈过的行甩出框外
    py: 0,         // 最近一次指针视口 y，判断贴边要用
    add: false,    // 起框时按着 Ctrl → 与原有选中取并集
    base: null,    // add 模式下起框前已有的选中项
    suppress: false,
    dirty: false,
    raf: 0,

    down(e, list){
        if(e.button !== 0 || !e.shiftKey) return false;
        // 分类栏是横向短列表，圈它没有意义；勾选小按钮上也不起框
        if(list === boxs[2]) return false;
        if(e.target.closest(".file-cl, .file-list-cl")) return false;
        // 上一把橡皮筋可能因为窗口在按住时被收起而没收到 mouseup，先收拾干净
        if(this.active) this.up();
        ItemSelection.prune();
        this.suppress = false;
        this.list = list;
        this.sc = scrollerOf(list);
        const s0 = this.scrollVp();
        this.from = { x: e.clientX, y: e.clientY + s0 };
        this.to = { x: this.from.x, y: this.from.y };
        this.py = e.clientY;
        this.add = e.ctrlKey || e.metaKey;
        this.base = this.add ? [...ItemSelection.nodes] : [];
        this.active = true;
        this.dirty = false;
        const b = document.createElement("div");
        b.className = "ed-marquee";
        document.body.appendChild(b);
        this.box = b;
        document.body.classList.add("ed-marqueeing");
        e.preventDefault();       // 别顺手把文件名拖成蓝底选区
        this.paint();
        this.select();
        this.startLoop();
        return true;
    },

    /* 滚动量换算成视口像素：scrollTop 是布局像素，而 clientY / getBoundingClientRect
       都是视口像素，body{zoom} 不为 1 时不乘回去，矩形锚点就会跟着滚动漂走 */
    scrollVp(){
        return this.sc ? this.sc.scrollTop * zoomFactor() : 0;
    },

    move(e){
        if(!this.active) return;
        this.py = e.clientY;
        this.to = { x: e.clientX, y: e.clientY + this.scrollVp() };
        this.dirty = true;        // 重算交给 rAF，鼠标事件每帧可能来好几轮
    },

    rect(){
        const f = this.from, t = this.to;
        return { x1: Math.min(f.x, t.x), y1: Math.min(f.y, t.y),
                 x2: Math.max(f.x, t.x), y2: Math.max(f.y, t.y) };
    },

    paint(){
        if(!this.box) return;
        const z = zoomFactor();
        const r = this.rect();
        // from/to 存的是「视口像素」，矩形挂在 zoom 过的 body 上（position:fixed），
        // 所以最后要除缩放比换算回布局像素
        this.box.style.left = (r.x1 / z) + "px";
        this.box.style.top = ((r.y1 - this.scrollVp()) / z) + "px";
        this.box.style.width = ((r.x2 - r.x1) / z) + "px";
        this.box.style.height = ((r.y2 - r.y1) / z) + "px";
    },

    select(){
        if(!this.list) return;
        const r = this.rect();
        // getBoundingClientRect 给的是视口像素，和 from/to 同一坐标系，不用再除 zoom
        const st = this.scrollVp();
        const x1 = r.x1, x2 = r.x2, y1 = r.y1 - st, y2 = r.y2 - st;
        const hit = [];
        for(const el of itemsOf(this.list)){
            if(el.classList.contains("ed-drag-taken")) continue;
            const b = el.getBoundingClientRect();
            // 被分类过滤隐藏掉的项 rect 全 0，不排掉会被原点附近的框误圈
            if(!b.width && !b.height) continue;
            if(b.left < x2 && b.right > x1 && b.top < y2 && b.bottom > y1) hit.push(el);
        }
        if(this.add){
            for(const el of this.base) if(el && el.isConnected) hit.push(el);
        }
        ItemSelection.applySet(hit);
    },

    startLoop(){
        const step = () => {
            if(!this.active) return;
            // 滚动每帧都要判：写成 dirty || edgeScroll() 会在鼠标小幅抖动时短路，
            // 贴边一直挪不动手就不滚了
            const scrolled = this.edgeScroll();
            // 只在矩形真的变了、或页面滚了的时候重算：140 项每帧读一轮 rect 不便宜
            if(this.dirty || scrolled){
                this.dirty = false;
                this.paint();
                this.select();
            }
            this.raf = requestAnimationFrame(step);
        };
        this.raf = requestAnimationFrame(step);
    },

    /* 贴边自动滚动，参数和拖拽共用；同样逐帧直推 scrollTop，不走平滑滚动动画 */
    edgeScroll(){
        const s = this.sc;
        if(!s) return false;
        const r = s.getBoundingClientRect();
        let v = 0;
        if(this.py > r.top - 40 && this.py < r.top + DRAG_EDGE){
            v = -Math.ceil(DRAG_EDGE_MAX * (1 - (this.py - r.top) / DRAG_EDGE));
        }else if(this.py < r.bottom + 40 && this.py > r.bottom - DRAG_EDGE){
            v = Math.ceil(DRAG_EDGE_MAX * (1 - (r.bottom - this.py) / DRAG_EDGE));
        }
        if(!v) return false;
        const before = s.scrollTop;
        s.scrollTop = before + v;
        return s.scrollTop !== before;
    },

    up(){
        if(!this.active) return;
        this.active = false;
        if(this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
        if(this.box) this.box.remove();
        this.box = null;
        this.list = null;
        this.sc = null;
        this.base = null;
        document.body.classList.remove("ed-marqueeing");
        // mousedown/mouseup 落在不同图标上时，浏览器还会补一个 click 到共同祖先，
        // 那个祖先多半不是图标 → 会被当成「点了空白」把刚框到的选中清掉，必须吞掉
        this.suppress = true;
    }
};

for(const list of boxs){
    list.addEventListener("mousedown", (e) => { if(!Marquee.down(e, list)) DragManager.onDown(e, list); });
}
document.addEventListener("mousemove", (e) => { Marquee.move(e); DragManager.onMove(e); });
document.addEventListener("mouseup", (e) => { Marquee.up(); DragManager.end(e); });
/* 指针移出面板时窗口可能被自动收起，那样就永远等不到 mouseup：橡皮筋会留在屏幕上，
   整窗还挂着 crosshair 光标和禁选中。移出即当作松手处理。 */
document.addEventListener("mouseleave", () => { Marquee.up(); });
/* 必须用捕获阶段注册：UIUtils.disableScroll 的滚轮锁定同样挂在 document 捕获阶段并
   stopPropagation，组视图 / 对话框开着时冒泡阶段的 wheel 根本轮不到我们，
   拖拽中滚轮翻页就失效。同阶段按注册顺序执行，这行在页面加载时就挂了，排得前面。 */
document.addEventListener("wheel", (e) => DragManager.onWheel(e), { passive: false, capture: true });
// 捕获阶段：拖拽结束 / 框选结束时浏览器补发的那个 click 要在到达图标之前就拦掉
document.addEventListener("click", (e) => {
    if(DragManager.suppressClick || Marquee.suppress){
        DragManager.suppressClick = false;
        Marquee.suppress = false;
        e.stopPropagation();
        e.preventDefault();
        return;
    }
    if(!e.target.closest(".file-item, .file-list-item, .class_bar_btn")) ItemSelection.clear();
}, true);
document.addEventListener("keydown", (e) => {
    if(e.key !== "Escape") return;
    // 框选进行中按 Esc：先结束拉框再清空，否则下一帧又按矩形把选中填回来
    if(Marquee.active) Marquee.up();
    if(ItemSelection.size) ItemSelection.clear();
});
// 鼠标在窗口外松开时浏览器不会补发 click，suppress 标志会残留并吞掉下一次点击，
// 所以每次重新按下都先清掉
document.addEventListener("mousedown", () => {
    DragManager.suppressClick = false;
    Marquee.suppress = false;
}, true);

async function save_new_order(reload_part){
    if(boxs[0].style.display!="none"){
        target_box = boxs[0]
    }else{
        target_box = boxs[1]
    }
    let new_order = []
    for(let item of target_box.children){
        new_order.push(AppState.files_data[item.dataset.list_index])
    }
    await ApiHelper.call("update_config_order",AppState.currentPath,new_order)
}
async function scroll_top(){
    // 卡片内滚动：回到顶部 = 把当前可见的文件容器滚回顶部（整页本身不滚）
    const scroller = activeFileScroller();
    if(scroller) scroller.scrollTo({
        top: 0,
        behavior: 'smooth',
    })
    window.scrollTo(0, 0);
}