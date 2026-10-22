// ========== API调用封装 ==========
const ApiHelper = {
    async call(method, ...args) {
        var result = await window.pywebview.api[method](...args);
        return result;
    },

    async getConfig() {
        const config = await this.call('get_config');
        // 每次读到后端最新配置就刷新缓存，避免 ConfigManager.current 长期留在旧版本
        if (typeof ConfigManager !== "undefined" && config && typeof config === "object") {
            ConfigManager.current = config;
        }
        return config;
    },

    async updateConfig(key, value) {
        // 同步更新本地配置缓存：不少设置是"发完 IPC 立刻按 config 重绘"，
        // 等后端返回再刷新会让界面读到上一版值
        if (typeof ConfigManager !== "undefined" && ConfigManager.current) {
            ConfigManager.current[key] = value;
        }
        return await this.call('update_config', key, value);
    },

    async getFileInfo(path,quick=true,ign_icno=false) {
        return await this.call('get_fileinfo', path, quick, ign_icno);
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
        NavigationManager.desktopPathCache = null;
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

