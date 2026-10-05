/**
 * pywebview 兼容层
 *
 * 前端 ed.js 完全沿用旧写法：window.pywebview.api.方法名(...参数)。
 * 这里把它转发到 Tauri 的统一命令 pywebview_call(method, args)，
 * 从而做到「前端零改动」地从 Python 迁移到 Rust。
 */
(function () {
    // 捕获脚本错误，供诊断探针读取
    window.addEventListener("error", function (e) {
        window.__edErr = (e.message || "?") + " @ " + (e.filename || "?") + ":" + (e.lineno || 0);
    });

    // 面板初始是隐藏的：内容先停在"远离态"，这样首次呼出时第一帧就是进场动画的起点
    // （否则可能先闪一帧最终状态再跳回起点，看起来就是"跳变"）
    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(function () {
            try { document.body.classList.add("ed-panel-away"); } catch (e) {}
        }, 0);
    } else {
        document.addEventListener("DOMContentLoaded", function () {
            try { document.body.classList.add("ed-panel-away"); } catch (e) {}
        });
    }

    // ---- 关掉 WebView 自带的浏览器行为 ----
    // 右键不再弹 Edge/Chromium 的默认菜单（返回/刷新/另存为/打印/更多工具）：
    // 应用里有自己的右键菜单，默认菜单对桌面面板毫无用处。
    window.addEventListener("contextmenu", function (e) {
        e.preventDefault();
    });
    // 顺带屏蔽会破坏应用状态的浏览器快捷键：刷新、打印、保存、查看源码
    window.addEventListener("keydown", function (e) {
        var k = (e.key || "").toLowerCase();
        var ctrl = e.ctrlKey || e.metaKey;
        if (k === "f5" || (ctrl && (k === "r" || k === "p" || k === "s" || k === "u"))) {
            e.preventDefault();
        }
    }, true);

    function getInvoke() {
        if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
            return window.__TAURI_INTERNALS__.invoke;
        }
        if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
            return window.__TAURI__.core.invoke;
        }
        if (window.__TAURI__ && window.__TAURI__.tauri && window.__TAURI__.tauri.invoke) {
            return window.__TAURI__.tauri.invoke;
        }
        return null;
    }

    var invoke = getInvoke();
    if (!invoke) {
        console.error("[shim] 未找到 Tauri invoke，前端无法调用后端");
        return;
    }

    var cache = {};
    var api = new Proxy({}, {
        get: function (_, name) {
            if (typeof name !== "string") return undefined;
            if (cache[name]) return cache[name];
            cache[name] = function () {
                var args = Array.prototype.slice.call(arguments);
                return invoke("pywebview_call", { method: name, args: args });
            };
            return cache[name];
        }
    });

    window.pywebview = { api: api };
    window.__ED_TAURI__ = true;
    console.log("[shim] pywebview 兼容层已就绪");

    // 关键：pywebview 会在桥接就绪后派发 pywebviewready，ed.js 的整个初始化都挂在这个事件上。
    // 必须等 DOM 解析完（ed.js 已注册监听）之后再派发。
    function fireReady() {
        try {
            window.dispatchEvent(new Event("pywebviewready"));
            console.log("[shim] pywebviewready 已派发");
        } catch (e) {
            console.error("[shim] 派发 pywebviewready 失败", e);
        }
    }
    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(fireReady, 0);
    } else {
        document.addEventListener("DOMContentLoaded", function () {
            setTimeout(fireReady, 0);
        });
    }
})();
