// ==UserScript==
// @name         Bilibili Subtitle Free Drag (B站字幕自由拖拽)
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Enable free dragging for Bilibili subtitles with intelligent edge detection and a position reset feature. Short subtitles can be partially moved off-screen, while long subtitles are kept fully visible. Click the subtitle button in the player controls to reset the position to the default bottom-center. 解决B站字幕只能垂直拖动的问题，增加水平拖动，并采用智能边缘检测：短字幕可部分移出屏幕，超长字幕则始终保持在屏幕内。新增功能：点击播放器上的字幕按钮，可将字幕位置完美重置到B站默认的底部居中位置。
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/bangumi/play/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // --- CSS样式注入 ---
    GM_addStyle(`
        .bili-subtitle-x-subtitle-panel-wrap {
            max-width: 95vw;
            word-wrap: break-word;
            white-space: normal !important;
            text-align: center;
        }
        .bili-subtitle-x-subtitle-panel-position[data-is-draggable="true"]:hover {
            cursor: move;
            border: 1px dashed rgba(255, 255, 255, 0.7);
            box-sizing: border-box;
        }
    `);

    // --- 【已修正】字幕位置重置逻辑 ---
    function resetSubtitlePosition() {
        const subtitleElement = document.querySelector('.bili-subtitle-x-subtitle-panel-position');
        if (subtitleElement) {
            // 不再计算位置，而是直接移除脚本添加的内联样式
            // 这样可以让字幕恢复到B站CSS所控制的默认位置（底部居中）
            subtitleElement.style.left = '';
            subtitleElement.style.top = '';
            subtitleElement.style.transform = '';
            subtitleElement.style.bottom = ''; // B站可能用bottom定位，也一并清除以防万一

            console.log('Bilibili Subtitle Position: Reset to default.');
        }
    }

    // --- 监听字幕按钮点击，用于触发重置 ---
    function setupResetListener() {
        // 使用轮询以确保在播放器加载后能找到按钮
        const interval = setInterval(() => {
            const subtitleButton = document.querySelector('.bpx-player-ctrl-btn.bpx-player-ctrl-subtitle');
            if (subtitleButton) {
                if (!subtitleButton.dataset.resetListenerAttached) {
                    subtitleButton.dataset.resetListenerAttached = 'true';
                    console.log('Bilibili Subtitle Reset: Button found, attaching listener.');
                    subtitleButton.addEventListener('click', () => {
                        // B站的字幕按钮是切换逻辑，无论是开启还是关闭，我们都尝试重置。
                        // 如果字幕是关闭状态，执行重置也无害。
                        // 如果是开启字幕，字幕元素会在点击后稍有延迟才出现，所以延迟执行。
                        setTimeout(resetSubtitlePosition, 100);
                    });
                }
                clearInterval(interval); // 找到按钮并绑定事件后，停止轮询
            }
        }, 1000);

        // 设置一个超时，以防在某些特殊页面找不到按钮而无限轮询
        setTimeout(() => clearInterval(interval), 30000);
    }


    // --- 核心拖拽逻辑 (已优化) ---
    function makeSubtitleDraggable(subtitleElement) {
        if (subtitleElement.dataset.isDraggable) return;
        subtitleElement.dataset.isDraggable = 'true';

        let isDragging = false;
        let initialMouseX, initialMouseY;
        let initialElemLeft, initialElemTop;

        subtitleElement.onmousedown = function(e) {
            if (e.button !== 0) return; // 只响应鼠标左键
            e.preventDefault();
            e.stopPropagation();

            isDragging = true;
            initialMouseX = e.clientX;
            initialMouseY = e.clientY;

            // --- 精确的初始位置获取，防止拖拽时跳动 ---
            // B站默认可能使用 transform 和 bottom 定位。
            // getBoundingClientRect() 可以获取元素在屏幕上的“所见即所得”的精确位置。
            // 我们用它来计算出元素相对于其父容器的 top/left 值。
            const rect = subtitleElement.getBoundingClientRect();
            // offsetParent 通常是 .bpx-player-video-wrap，这是我们定位的基准
            const parentRect = subtitleElement.offsetParent.getBoundingClientRect();
            initialElemLeft = rect.left - parentRect.left;
            initialElemTop = rect.top - parentRect.top;

            // 在拖动开始时，立刻将字幕的定位方式统一为 top/left，并将计算好的值赋给它。
            // 这样就从B站的定位系统无缝切换到了我们自己的系统，视觉上不会有任何跳动。
            subtitleElement.style.transform = 'none';
            subtitleElement.style.bottom = 'auto';
            subtitleElement.style.left = initialElemLeft + 'px';
            subtitleElement.style.top = initialElemTop + 'px';

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        };

        function onMouseMove(e) {
            if (!isDragging) return;

            const deltaX = e.clientX - initialMouseX;
            const deltaY = e.clientY - initialMouseY;
            let newLeft = initialElemLeft + deltaX;
            let newTop = initialElemTop + deltaY;

            // --- 智能边缘检测 ---
            // 边界容器使用 .bpx-player-video-wrap，它是视频的实际显示区域
            const playerContainer = subtitleElement.closest('.bpx-player-video-wrap');
            if (playerContainer) {
                const playerRect = playerContainer.getBoundingClientRect();
                const subtitleRect = subtitleElement.getBoundingClientRect();

                // 使用 playerContainer 的 clientWidth/clientHeight 更稳定
                const playerWidth = playerContainer.clientWidth;
                const playerHeight = playerContainer.clientHeight;
                const subtitleWidth = subtitleElement.offsetWidth;
                const subtitleHeight = subtitleElement.offsetHeight;

                // 如果字幕宽度本身就超过了播放器宽度，则使用严格模式
                if (subtitleWidth >= playerWidth) {
                    if (newLeft < 0) newLeft = 0;
                    if (newLeft + subtitleWidth > playerWidth) {
                        newLeft = playerWidth - subtitleWidth;
                    }
                } else {
                    // 灵活模式：保证至少有50px可见，方便拖回
                    const minVisibleWidth = 50;
                    if (newLeft > playerWidth - minVisibleWidth) {
                        newLeft = playerWidth - minVisibleWidth;
                    }
                    if (newLeft < -(subtitleWidth - minVisibleWidth)) {
                        newLeft = -(subtitleWidth - minVisibleWidth);
                    }
                }

                // 垂直方向同样采用灵活模式
                const minVisibleHeight = 20;
                if (newTop > playerHeight - minVisibleHeight) {
                    newTop = playerHeight - minVisibleHeight;
                }
                if (newTop < -(subtitleHeight - minVisibleHeight)) {
                    newTop = -(subtitleHeight - minVisibleHeight);
                }
            }

            // 更新字幕位置
            subtitleElement.style.left = newLeft + 'px';
            subtitleElement.style.top = newTop + 'px';
        }

        function onMouseUp() {
            if (!isDragging) return;
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
    }

    // --- 监听字幕元素的出现 ---
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) { // 检查是否是元素节点
                    let targetNode = null;
                     if (node.matches('.bili-subtitle-x-subtitle-panel-position')) {
                        targetNode = node;
                    } else if (node.querySelector) {
                        targetNode = node.querySelector('.bili-subtitle-x-subtitle-panel-position');
                    }
                    if (targetNode) {
                         console.log('Bilibili Subtitle Panel Detected. Applying free-drag.');
                         makeSubtitleDraggable(targetNode);
                    }
                }
            }
        }
    });

    // --- 脚本初始化 ---
    observer.observe(document.body, { childList: true, subtree: true });
    setupResetListener(); // 启动字幕重置按钮的监听

    console.log('Bilibili Subtitle Free Drag script (v2.1, Position Reset Fixed) loaded.');

})();