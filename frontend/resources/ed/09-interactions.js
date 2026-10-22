window.addEventListener("keydown", function(event) {
    if (event.key === 'Enter') {
        // 输入框活跃或对话框打开时不触发文件点击
        // if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;
        event.preventDefault();
        if (DOMCache.get("renameOverlay").style.display === "flex") return;
        if (DOMCache.get("groupDeleteConfirm").style.display === "flex") return;
        if (DOMCache.get("themeSettingsPanel").style.display === "flex")return;
        for(let e of [...document.getElementById("filesContainer").children,...document.getElementById("filesListContainer").children]){
            if(e.style.display != "none" && !ItemSelection.enterClick){
                ItemSelection.enterClick = true
                e.click()
                setTimeout(function () {
                    ItemSelection.enterClick = false
                }, 3000);
                break
            }
        }
    }
});


/* 四个可拖拽容器。分类栏是横向轨道，其余三个是网格 / 列表 / 组视图。
   Object.values 的顺序参与事件注册，别随手调换字段。 */
const Layout = {
    grid: document.getElementById("filesContainer"),
    list: document.getElementById("filesListContainer"),
    classBar: document.getElementById("class_bar"),
    groupFiles: document.getElementById("groupFilesContainer"),
};
Layout.grid.dataset.other = "list"
Layout.list.dataset.other = "grid"
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
    /* Enter 打开首个图标的防抖锁：3 秒内连按不重复触发 */
    enterClick: false,
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
        const row = this.list !== Layout.classBar && isRowLike(r);
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
        if(list === Layout.classBar && target.dataset.reorderable !== "1") return;
        if(target.dataset.is_cl !== primary.dataset.is_cl) return;
        const r = target.getBoundingClientRect();
        /* 插到目标的哪一侧，交给 insertSide：行看上下半、格子看左右半。
           连续压在同一个目标上判定时，把上一次的结论一起传进去做迟滞，
           否则指针在中线附近蹭两下，邻居就朝两边来回让位（抽搐）。 */
        const prev = this.slotTarget === target ? this.lastSide : null;
        const side = insertSide(x, y, r, list === Layout.classBar, prev);
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
            for(const item of Layout.classBar.children){
                if(item.dataset.reorderable !== "1") continue;
                order.push(item.id);
            }
            await ApiHelper.call("save_classOrder", order);
        }else if(list === Layout.groupFiles){
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
        if(list === Layout.classBar) return false;
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

for(const list of Object.values(Layout)){
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
    const targetBox = Layout.grid.style.display != "none" ? Layout.grid : Layout.list;
    const new_order = []
    for(let item of targetBox.children){
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