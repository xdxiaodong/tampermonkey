// ==UserScript==
// @name         页面声音屏蔽公共脚本
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  屏蔽页面原有 audio/video/WebAudio 声音，并允许用户脚本自己的提示音播放
// @author       张晓东
// @grant        none
// ==/UserScript==

/**
 * 页面声音屏蔽公共脚本
 *
 * 使用方式：
 *
 * 1. 在你的业务脚本头部引入本公共脚本：
 *    // @require https://raw.githubusercontent.com/xdxiaodong/tampermonkey/main/pageSoundBlocker.user.js
 *    // @run-at document-start
 *
 * 2. 启动页面声音屏蔽：
 *    const pageSoundBlocker = createPageSoundBlocker({
 *        blockWebAudio: true,
 *        debug: false
 *    });
 *
 * 3. 播放你自己的通知声音时，把自己的 audio 加入白名单：
 *    const notifyAudio = new Audio('https://example.com/notify.mp3');
 *    pageSoundBlocker.allow(notifyAudio);
 *
 *    function playNotifySound() {
 *        pageSoundBlocker.allow(notifyAudio);
 *        notifyAudio.currentTime = 0;
 *        notifyAudio.play().catch(function (err) {
 *            console.warn('自己的通知声音播放失败：', err);
 *        });
 *    }
 *
 * 4. 如果只想快速启动，也可以直接：
 *    const pageSoundBlocker = blockPageSounds();
 *
 * 说明：
 * - 本脚本会屏蔽页面已有和后续新增的 audio/video。
 * - 本脚本会拦截页面调用 HTMLMediaElement.prototype.play()。
 * - blockWebAudio 为 true 时，会尽量屏蔽页面 AudioContext 播放。
 * - 不要使用浏览器“静音此标签页”，否则你自己的提示音也会被静音。
 */

(function () {
    'use strict';

    const DEFAULT_ALLOW_ATTR = 'data-tm-allow-sound';
    let defaultBlocker = null;

    /**
     * 创建并启动页面声音屏蔽器
     * @param {Object} [options]
     * @param {string} [options.allowAttr='data-tm-allow-sound'] - 白名单属性名，带有该属性的 audio/video 不会被屏蔽
     * @param {boolean} [options.blockWebAudio=true] - 是否尽量屏蔽页面 WebAudio/AudioContext
     * @param {number} [options.interval=1000] - 兜底扫描间隔，毫秒
     * @param {boolean} [options.debug=false] - 是否输出调试日志
     * @returns {{start: Function, stop: Function, blockNow: Function, allow: Function, disallow: Function}}
     */
    function createPageSoundBlocker(options) {
        const config = Object.assign({
            allowAttr: DEFAULT_ALLOW_ATTR,
            blockWebAudio: true,
            interval: 1000,
            debug: false
        }, options || {});

        let started = false;
        let observer = null;
        let timer = null;

        function log() {
            if (!config.debug) return;
            const args = Array.prototype.slice.call(arguments);
            args.unshift('[PageSoundBlocker]');
            console.log.apply(console, args);
        }

        function getRoot() {
            return document.documentElement || document.head || document.body;
        }

        function runWhenDomReady(fn) {
            if (getRoot()) {
                fn();
                return;
            }

            document.addEventListener('DOMContentLoaded', fn, { once: true });
        }

        function injectScript(code) {
            runWhenDomReady(function () {
                const root = getRoot();
                if (!root) return;

                const script = document.createElement('script');
                script.textContent = code;
                root.appendChild(script);
                script.remove();
            });
        }

        function setPageBlockerEnabled(enabled) {
            injectScript(`
                (function() {
                    window.__TM_PAGE_SOUND_BLOCKER_ENABLED__ = ${enabled ? 'true' : 'false'};
                })();
            `);
        }

        function injectPageBlocker() {
            const allowAttr = JSON.stringify(config.allowAttr);
            const blockWebAudio = config.blockWebAudio ? 'true' : 'false';
            const debug = config.debug ? 'true' : 'false';

            injectScript(`
                (function() {
                    window.__TM_PAGE_SOUND_BLOCKER_ENABLED__ = true;
                    window.__TM_PAGE_SOUND_BLOCKER_CONFIG__ = {
                        allowAttr: ${allowAttr},
                        blockWebAudio: ${blockWebAudio},
                        debug: ${debug}
                    };

                    if (window.__TM_PAGE_SOUND_BLOCKER_INSTALLED__) return;
                    window.__TM_PAGE_SOUND_BLOCKER_INSTALLED__ = true;

                    function getConfig() {
                        return window.__TM_PAGE_SOUND_BLOCKER_CONFIG__ || {
                            allowAttr: ${allowAttr},
                            blockWebAudio: ${blockWebAudio},
                            debug: ${debug}
                        };
                    }

                    function isEnabled() {
                        return window.__TM_PAGE_SOUND_BLOCKER_ENABLED__ !== false;
                    }

                    function log() {
                        if (!getConfig().debug) return;
                        var args = Array.prototype.slice.call(arguments);
                        args.unshift('[PageSoundBlocker:Page]');
                        console.log.apply(console, args);
                    }

                    function isAllowed(el) {
                        var attr = getConfig().allowAttr;
                        return !!(el && el.getAttribute && el.hasAttribute(attr));
                    }

                    function blockMedia(el) {
                        if (!isEnabled()) return false;
                        if (!el || isAllowed(el)) return false;

                        try { el.muted = true; } catch (e) {}
                        try { el.volume = 0; } catch (e) {}
                        try { el.pause(); } catch (e) {}
                        return true;
                    }

                    function scanAndBlock() {
                        if (!isEnabled()) return;
                        document.querySelectorAll('audio, video').forEach(blockMedia);
                    }

                    if (window.HTMLMediaElement && HTMLMediaElement.prototype) {
                        var rawPlay = HTMLMediaElement.prototype.play;

                        HTMLMediaElement.prototype.play = function() {
                            if (blockMedia(this)) {
                                log('已拦截页面媒体播放', this);
                                return Promise.resolve();
                            }

                            return rawPlay.apply(this, arguments);
                        };
                    }

                    document.addEventListener('play', function(event) {
                        var el = event.target;
                        if (window.HTMLMediaElement && el instanceof HTMLMediaElement) {
                            blockMedia(el);
                        }
                    }, true);

                    document.addEventListener('volumechange', function(event) {
                        var el = event.target;
                        if (window.HTMLMediaElement && el instanceof HTMLMediaElement) {
                            blockMedia(el);
                        }
                    }, true);

                    var observer = new MutationObserver(function() {
                        scanAndBlock();
                    });

                    function startObserver() {
                        var root = document.documentElement || document.body;
                        if (!root) return;

                        observer.observe(root, {
                            childList: true,
                            subtree: true
                        });

                        scanAndBlock();
                    }

                    if (document.documentElement || document.body) {
                        startObserver();
                    } else {
                        document.addEventListener('DOMContentLoaded', startObserver, { once: true });
                    }

                    // 尽量屏蔽页面 WebAudio。注意：如果页面有复杂 WebAudio 逻辑，此项可能影响页面功能。
                    if (${blockWebAudio}) {
                        var AC = window.AudioContext || window.webkitAudioContext;

                        if (AC && AC.prototype && !AC.prototype.__TM_PAGE_SOUND_BLOCKER_PATCHED__) {
                            Object.defineProperty(AC.prototype, '__TM_PAGE_SOUND_BLOCKER_PATCHED__', {
                                value: true,
                                configurable: true
                            });

                            try {
                                var rawResume = AC.prototype.resume;
                                AC.prototype.resume = function() {
                                    if (isEnabled()) {
                                        log('已拦截页面 AudioContext.resume');
                                        try { this.suspend(); } catch (e) {}
                                        return Promise.resolve();
                                    }

                                    return rawResume.apply(this, arguments);
                                };
                            } catch (e) {}

                            try {
                                var rawCreateBufferSource = AC.prototype.createBufferSource;
                                AC.prototype.createBufferSource = function() {
                                    var source = rawCreateBufferSource.apply(this, arguments);
                                    var rawStart = source.start;

                                    source.start = function() {
                                        if (isEnabled()) {
                                            log('已拦截页面 AudioBufferSource.start');
                                            return;
                                        }

                                        return rawStart.apply(this, arguments);
                                    };

                                    return source;
                                };
                            } catch (e) {}

                            try {
                                var rawCreateOscillator = AC.prototype.createOscillator;
                                AC.prototype.createOscillator = function() {
                                    var osc = rawCreateOscillator.apply(this, arguments);
                                    var rawStart = osc.start;

                                    osc.start = function() {
                                        if (isEnabled()) {
                                            log('已拦截页面 Oscillator.start');
                                            return;
                                        }

                                        return rawStart.apply(this, arguments);
                                    };

                                    return osc;
                                };
                            } catch (e) {}
                        }
                    }
                })();
            `);
        }

        function isAllowed(el) {
            return !!(el && el.hasAttribute && el.hasAttribute(config.allowAttr));
        }

        function blockMediaElement(el) {
            if (!el || isAllowed(el)) return;

            try { el.muted = true; } catch (e) {}
            try { el.volume = 0; } catch (e) {}
            try { el.pause(); } catch (e) {}
        }

        function blockNow() {
            document.querySelectorAll('audio, video').forEach(blockMediaElement);
        }

        function onMediaEvent(event) {
            const el = event.target;

            if (window.HTMLMediaElement && el instanceof HTMLMediaElement) {
                blockMediaElement(el);
            }
        }

        function start() {
            if (started) return controller;
            started = true;

            injectPageBlocker();

            runWhenDomReady(function () {
                blockNow();

                observer = new MutationObserver(blockNow);
                observer.observe(document.documentElement || document.body, {
                    childList: true,
                    subtree: true
                });

                document.addEventListener('play', onMediaEvent, true);
                document.addEventListener('volumechange', onMediaEvent, true);

                timer = window.setInterval(blockNow, config.interval);
                log('页面声音屏蔽已启动');
            });

            return controller;
        }

        function stop() {
            if (!started) return controller;
            started = false;

            if (observer) {
                observer.disconnect();
                observer = null;
            }

            if (timer) {
                window.clearInterval(timer);
                timer = null;
            }

            document.removeEventListener('play', onMediaEvent, true);
            document.removeEventListener('volumechange', onMediaEvent, true);

            setPageBlockerEnabled(false);
            log('页面声音屏蔽已停止');

            return controller;
        }

        function allow(el) {
            if (!el || !el.setAttribute) return el;

            el.setAttribute(config.allowAttr, '1');

            try { el.muted = false; } catch (e) {}
            if (typeof el.volume === 'number' && el.volume === 0) {
                try { el.volume = 1; } catch (e) {}
            }

            return el;
        }

        function disallow(el) {
            if (!el || !el.removeAttribute) return el;

            el.removeAttribute(config.allowAttr);
            blockMediaElement(el);
            return el;
        }

        const controller = {
            start,
            stop,
            blockNow,
            allow,
            disallow
        };

        return start();
    }

    /**
     * 快速启动页面声音屏蔽
     * @param {Object} [options]
     * @returns {{start: Function, stop: Function, blockNow: Function, allow: Function, disallow: Function}}
     */
    function blockPageSounds(options) {
        if (!defaultBlocker) {
            defaultBlocker = createPageSoundBlocker(options);
        } else {
            defaultBlocker.start();
        }

        return defaultBlocker;
    }

    window.createPageSoundBlocker = createPageSoundBlocker;
    window.blockPageSounds = blockPageSounds;

})();
