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
    selectedFile: null,
    dealing: false,
    currentPath: '',
    pathHistory: [],
    currentHistoryIndex: -1,
    timer: null,
    db_click_action: false,
    /* 当前真正生效的搜索关键词。多处代码只把输入框清空、不重新渲染，
       于是出现"框里没字、列表还是上次搜索结果"；用这个字段判断视图是否需要同步。 */
    searchKey: '',
    /* 面板是否已收起：Rust 收起前调 edOnPanelHide、呼出时调 edOnPanelShow 同步 */
    panelHidden: true,
    /* 「调整面板尺寸」模式：打开时设置项隐藏、只留完成按钮 */
    settingsMode: false,
    /* 当前打开的分类设置对话框的取消入口；没打开时为 null */
    fileSelectorCancel: null,

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

