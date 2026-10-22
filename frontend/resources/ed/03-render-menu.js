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

