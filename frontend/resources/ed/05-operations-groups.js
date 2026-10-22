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

