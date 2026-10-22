// ========== 导航管理器 ==========
const NavigationManager = {
    /* 桌面路径一次会话内不变，缓存跨桥结果；清理缓存时置 null */
    desktopPathCache: null,
    async navigateTo(path) {
        // 【闪屏修复】先在渲染前算好过滤集合，避免渲染完再过滤造成的中间态
        const atRoot = (path=="/" || path=="" || path=="desktop" || path==document.getElementById("b2d").dataset.path);
        if(atRoot){
            document.getElementById("box1").style.display="block"
        }else{
            document.getElementById("box1").style.display="none"
        }
        const navAllowIds = atRoot ? await getClassIdSet(ClassViewState.current) : null;
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
            const allowIds = await getClassIdSet(ClassViewState.current);
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
                await fileRenderer.render(AppState.files_data,null,false,await getClassIdSet(ClassViewState.current));
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
    /* 最近一次读到的完整配置：设置项改完立刻按它重绘，省掉反复 get_config */
    current: null,
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

