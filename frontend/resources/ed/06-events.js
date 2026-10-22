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
                        PreviewState.running = false
                    }
                }else if(toggleId === "blurToggle"){
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
            const c = cfg || ConfigManager.current || {};
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
                    window.showHotkeyText();
                    hkStart();
                    return
                }
                ApiHelper.updateConfig('cf_type', this.value);
                window.showHotkeyText();
            }catch(e){
                ConfigManager.current = await ApiHelper.getConfig()
                this.value = ConfigManager.current.cf_type
                window.showHotkeyText(ConfigManager.current);
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
                document.body.style.setProperty('--ed-bg-blur', `${parseInt(this.value)}px`);
            });
        }

        DOMCache.get('bgResetBtn').addEventListener('click', async () => {
            await ApiHelper.updateConfig("use_bg", false);
            await ApiHelper.updateConfig("bg", "");
            await ApiHelper.updateConfig("ms_ef", 50);
            blurSlider.value = 50;
            blurValue.textContent = '50';
            ConfigManager.current = await ApiHelper.getConfig();
            ThemeManager.applyBackgroundSettings(ConfigManager.current);
        });

        DOMCache.get('bgCustomBtn').addEventListener('click', async () => {
            try {
                const bgUrl = await ApiHelper.call('set_background');
                if (bgUrl) {
                    await ApiHelper.updateConfig("use_bg", true);
                    await ApiHelper.updateConfig("bg", bgUrl);
                    await ApiHelper.updateConfig("ms_ef", 0);
                    await ApiHelper.updateConfig("bgType", "1");
                    ConfigManager.current = await ApiHelper.getConfig();
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
            // CSS 层面（透明模式的薄纱/增强模式的贴面浓度）拖动中立刻反馈；
            // 系统亚克力的磨砂浓度等松手后再同步——每个 input 事件都重设会让整窗闪
            applyGlassSettings(null, true);
            clearTimeout(applyGlassSettings._sysT);
            applyGlassSettings._sysT = setTimeout(function(){ applyGlassSettings(); }, 350);
        });
        // 背景类型决定毛玻璃能不能生效，改它要重算生效状态和灰显
        const bgTypeSel = DOMCache.get('bgType_toggle');
        if(bgTypeSel) bgTypeSel.addEventListener('change', function(){
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
                if(AppState.panelHidden)return

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

            // 左侧分类栏的空白也算"点空白收起"：#class_bar 是栏底空块与按钮缝隙，#box1 是竖栏右内边距条。
            // 分类按钮与"+ 新建分类"不在此列，点了照常切分类/建分类。
            const BLANK = ["content_box", "main", "filesContainer", "content_col", "box1", "class_bar"];
            const el = event.target;
            // 竖向滚动条压在 clientWidth 之外，按在滚动条上不该把面板收掉
            const onScrollbar = el.clientWidth > 0 && el.scrollHeight > el.clientHeight
                && event.offsetX >= el.clientWidth;
            // 拖拽排序/框选收尾时浏览器会补一个 click，落点常常在空白上：
            // 这个监听和 DragManager 那个是两条独立的，拿不到它的消费逻辑，只能自己判一次标记
            if (BLANK.includes(el.id) && !onScrollbar
                && !DragManager.suppressClick && !Marquee.suppress) {
                ApiHelper.call('close_fullscreen_window');
            }
        });
        document.addEventListener('contextmenu', (e) => {
            // this.handleBlankContextMenu(e);
            console.log(e.target)
            if(ConfigManager.current && ConfigManager.current.df_dir==AppState.currentPath){
                console.log("当前目录")
                // document.getElementById("menuNewGroup").style.display="block"
                // document.getElementById("menuAddToGroup").style.display="block"
                Utils.uiBoxDisplayChange(document.getElementById("menuNewGroup"),block,true)
                Utils.uiBoxDisplayChange(document.getElementById("menuAddToGroup"),block,false)
            }else{
                console.log("非当前目录")
                // document.getElementById("menuNewGroup").style.display="none"
                // document.getElementById("menuAddToGroup").style.display="none"
                Utils.uiBoxDisplayChange(document.getElementById("menuNewGroup"),"none",true)
                Utils.uiBoxDisplayChange(document.getElementById("menuAddToGroup"),"none",false)
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
            const bsr = (ConfigManager.current && ConfigManager.current.scale) ? ConfigManager.current.scale/100 : 1;
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
        const r = await ApiHelper.call("setIcon", AppState.selectedFile.filePath,AppState.selectedFile.edit_ico==undefined)
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

