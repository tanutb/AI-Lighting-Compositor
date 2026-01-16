document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // --- Performance: Cache DOM References ---
    const DOM = {
        canvas: document.getElementById('main-canvas'),
        canvasContainer: document.getElementById('canvas-container'),
        addLayerBtn: document.getElementById('add-layer-btn'),
        saveImageBtn: document.getElementById('save-image-btn'),
        opacitySlider: document.getElementById('opacity'),
        valOpacity: document.getElementById('val-opacity'),
        layerControls: document.getElementById('layer-controls'),
        layerList: document.getElementById('layer-list'),
        baseLayerVisBtn: document.getElementById('base-layer-vis-btn'),
        modalPrompt: document.getElementById('modal-prompt'),
        promptInput: document.getElementById('prompt-input'),
        cancelPromptBtn: document.getElementById('cancel-prompt-btn'),
        generateConfirmBtn: document.getElementById('generate-confirm-btn'),
        btnApiKey: document.getElementById('btn-api-key'),
        modalApi: document.getElementById('modal-api'),
        apiKeyInput: document.getElementById('api-key-input'),
        closeApiBtn: document.getElementById('close-api-btn'),
        saveApiBtn: document.getElementById('save-api-btn'),
        btnSysPrompt: document.getElementById('btn-sys-prompt'),
        modalSysPrompt: document.getElementById('modal-sys-prompt'),
        sysPromptInput: document.getElementById('sys-prompt-input'),
        closeSysBtn: document.getElementById('close-sys-btn'),
        saveSysBtn: document.getElementById('save-sys-btn'),
        btnViewMode: document.getElementById('btn-view-mode'),
        leftPanel: document.getElementById('left-panel'),
        rightPanel: document.getElementById('right-panel'),
        resizerLeft: document.getElementById('resizer-left'),
        resizerRight: document.getElementById('resizer-right'),
        zoomInBtn: document.getElementById('zoom-in-btn'),
        zoomOutBtn: document.getElementById('zoom-out-btn'),
        zoomFitBtn: document.getElementById('zoom-fit-btn'),
        zoomLevelDisp: document.getElementById('zoom-level-disp'),
        baseLayerTrack: document.getElementById('base-layer-track')
    };

    // Get 2D context with performance hints
    const ctx = DOM.canvas.getContext('2d', {
        alpha: false,
        desynchronized: true,
        willReadFrequently: false
    });

    // --- State ---
    let baseImage = new Image();
    baseImage.crossOrigin = "anonymous";
    let layers = [];
    window.workspaceLayers = layers;

    let activeLayerId = null;
    let apiKey = localStorage.getItem('gemini_api_key') || '';
    let zoomLevel = 1;
    let isPreviewMode = false;
    let baseLayerVisible = true;

    // --- Performance: Render State ---
    let renderPending = false;
    let layerListDirty = false;
    let lastRenderTime = 0;
    const MIN_RENDER_INTERVAL = 16; // ~60fps cap

    // --- Icons (Template literals, created once) ---
    const ICONS = {
        eyeOpen: `<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`,
        eyeClosed: `<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-4.01.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`,
        trash: `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
        refresh: `<svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>`
    };

    // --- Performance: Throttle & Debounce Utilities ---
    function throttle(fn, delay) {
        let lastCall = 0;
        return function(...args) {
            const now = performance.now();
            if (now - lastCall >= delay) {
                lastCall = now;
                fn.apply(this, args);
            }
        };
    }

    function debounce(fn, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    // --- Initialization ---
    function updateApiStatus() {
        if (!apiKey) {
            DOM.btnApiKey.classList.add('warning');
            DOM.btnApiKey.title = "API Key Missing";
            DOM.btnApiKey.style.color = '#ff6b6b';
        } else {
            DOM.btnApiKey.classList.remove('warning');
            DOM.btnApiKey.title = "API Settings";
            DOM.btnApiKey.style.color = '';
        }
    }

    if (apiKey) {
        DOM.apiKeyInput.value = apiKey;
    }
    updateApiStatus();

    if (typeof uploadedFilename !== 'undefined' && uploadedFilename) {
        baseImage.src = `/static/uploads/${uploadedFilename}`;
        baseImage.onload = () => {
            resizeCanvasToImage();
            fitToScreen();
            scheduleRender();
        };
    }

    function resizeCanvasToImage() {
        if (!baseImage.src) return;
        DOM.canvas.width = baseImage.naturalWidth;
        DOM.canvas.height = baseImage.naturalHeight;
    }

    // --- Zoom Functions (GPU Accelerated) ---
    function setZoom(newZoom) {
        zoomLevel = Math.max(0.1, Math.min(5, newZoom));
        // Use transform3d for GPU acceleration
        DOM.canvas.style.transform = `scale3d(${zoomLevel}, ${zoomLevel}, 1)`;
        DOM.zoomLevelDisp.textContent = Math.round(zoomLevel * 100) + '%';
    }

    function fitToScreen() {
        if (!DOM.canvasContainer || !DOM.canvas.width || DOM.canvas.width === 0) return;

        const padding = 80;
        const availableWidth = DOM.canvasContainer.clientWidth - padding;
        const availableHeight = DOM.canvasContainer.clientHeight - padding;

        const scaleX = availableWidth / DOM.canvas.width;
        const scaleY = availableHeight / DOM.canvas.height;
        const scale = Math.min(scaleX, scaleY, 1);

        setZoom(scale);
    }

    // --- Optimized Rendering Engine ---
    function drawLayers() {
        if (!baseImage.complete) return;

        const width = DOM.canvas.width;
        const height = DOM.canvas.height;

        // Clear with fillRect (faster than clearRect for opaque canvas)
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        // Draw Base (If visible)
        if (baseLayerVisible) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            ctx.drawImage(baseImage, 0, 0);
        }

        // Draw Layers - batch similar operations
        const visibleLayers = layers.filter(l => l.visible && !l.loading && !l.error && l.image);

        if (visibleLayers.length > 0) {
            ctx.globalCompositeOperation = 'screen';

            for (let i = 0; i < visibleLayers.length; i++) {
                const layer = visibleLayers[i];
                ctx.globalAlpha = layer.opacity / 100;
                ctx.drawImage(layer.image, 0, 0, width, height);
            }
        }

        // Reset state
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    function scheduleRender() {
        if (renderPending) return;

        const now = performance.now();
        const elapsed = now - lastRenderTime;

        if (elapsed >= MIN_RENDER_INTERVAL) {
            renderPending = true;
            requestAnimationFrame(() => {
                drawLayers();
                renderPending = false;
                lastRenderTime = performance.now();
            });
        } else {
            renderPending = true;
            setTimeout(() => {
                requestAnimationFrame(() => {
                    drawLayers();
                    renderPending = false;
                    lastRenderTime = performance.now();
                });
            }, MIN_RENDER_INTERVAL - elapsed);
        }
    }

    // --- Preview Mode ---
    function togglePreviewMode() {
        isPreviewMode = !isPreviewMode;

        if (isPreviewMode) {
            document.body.classList.add('preview-mode');

            if (!document.getElementById('close-preview-btn')) {
                const btn = document.createElement('div');
                btn.id = 'close-preview-btn';
                btn.className = 'close-preview-btn';
                btn.textContent = 'Close Preview (Esc)';
                btn.onclick = togglePreviewMode;
                document.body.appendChild(btn);
            }

            scheduleRender();
            requestAnimationFrame(() => {
                requestAnimationFrame(fitToScreen);
            });
        } else {
            document.body.classList.remove('preview-mode');
            requestAnimationFrame(() => {
                requestAnimationFrame(fitToScreen);
            });
        }
    }

    // --- Panel Resizing (Optimized) ---
    function initResizers() {
        let isResizing = false;
        let currentResizer = null;

        function onMouseMove(e) {
            if (!isResizing) return;

            if (currentResizer === 'left') {
                const newWidth = Math.min(600, Math.max(150, e.clientX));
                DOM.leftPanel.style.width = newWidth + 'px';
            } else if (currentResizer === 'right') {
                const newWidth = Math.min(600, Math.max(150, window.innerWidth - e.clientX));
                DOM.rightPanel.style.width = newWidth + 'px';
            }
        }

        function onMouseUp() {
            if (!isResizing) return;
            isResizing = false;
            currentResizer = null;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            DOM.resizerLeft.classList.remove('resizing');
            DOM.resizerRight.classList.remove('resizing');
        }

        DOM.resizerLeft.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isResizing = true;
            currentResizer = 'left';
            DOM.resizerLeft.classList.add('resizing');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        DOM.resizerRight.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isResizing = true;
            currentResizer = 'right';
            DOM.resizerRight.classList.add('resizing');
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });
    }
    initResizers();

    // --- Layer Management ---
    function addLoadingLayer(prompt) {
        const id = Date.now() + Math.random();
        const newLayer = {
            id,
            name: prompt,
            prompt,
            image: null,
            opacity: 100,
            visible: true,
            loading: true,
            error: false
        };
        layers.push(newLayer);
        window.workspaceLayers = layers;
        scheduleLayerListRender();
        return id;
    }

    function updateLayerWithImage(id, imageSrc) {
        const layer = layers.find(l => l.id === id);
        if (!layer) return;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = imageSrc;
        img.onload = () => {
            layer.image = img;
            layer.loading = false;
            layer.error = false;

            selectLayer(id);
            scheduleLayerListRender();
            scheduleRender();
        };
        img.onerror = () => {
            markLayerAsError(layer, "Image Load Error");
        };
    }

    function markLayerAsError(layer, msg) {
        if (!layer.name.includes("(Failed)")) {
            layer.name += " (Failed)";
        }
        layer.loading = false;
        layer.error = true;
        scheduleLayerListRender();
    }

    function deleteLayer(id) {
        if (confirm("Delete this layer?")) {
            const layer = layers.find(l => l.id === id);
            if (layer && layer.image) {
                layer.image = null; // Help GC
            }
            layers = layers.filter(l => l.id !== id);
            window.workspaceLayers = layers;
            if (activeLayerId === id) {
                activeLayerId = null;
                DOM.layerControls.style.display = 'none';
            }
            scheduleLayerListRender();
            scheduleRender();
        }
    }

    async function regenerateLayer(id) {
        const layer = layers.find(l => l.id === id);
        if (!layer) return;

        layer.loading = true;
        layer.error = false;
        if (layer.name.includes("(Failed)")) {
            layer.name = layer.name.replace(" (Failed)", "");
        }

        scheduleLayerListRender();
        await generateSingleLayer(layer.prompt, id);
    }

    // --- Optimized Layer List Rendering with DocumentFragment ---
    let layerListRenderPending = false;

    function scheduleLayerListRender() {
        if (layerListRenderPending) return;
        layerListRenderPending = true;
        requestAnimationFrame(() => {
            renderLayerList();
            layerListRenderPending = false;
        });
    }

    function createLayerElement(layer) {
        const el = document.createElement('div');
        el.className = `layer-item${layer.id === activeLayerId ? ' active' : ''}`;
        el.dataset.layerId = layer.id;

        // Thumbnail
        let thumbContent;
        if (layer.loading) {
            thumbContent = '<div class="mini-spinner"></div>';
        } else if (layer.image && !layer.error) {
            thumbContent = `<img src="${layer.image.src}" class="layer-thumb" loading="lazy">`;
        } else {
            thumbContent = '<div class="layer-thumb layer-thumb-error">!</div>';
        }

        const nameClass = layer.error ? "layer-name error" : "layer-name";
        const statusText = layer.loading ? 'Generating...' : (layer.error ? 'Generation Failed' : layer.opacity + '% Opacity');

        el.innerHTML = `
            <div class="layer-left">
                <div class="layer-thumb-container${layer.error ? ' error' : ''}">${thumbContent}</div>
                <div class="layer-info">
                    <div class="${nameClass}">${layer.name}</div>
                    <div class="layer-desc">${statusText}</div>
                </div>
            </div>
            <div class="layer-actions">
                ${!layer.loading ? `
                    <button class="icon-btn" data-action="regenerate" title="Regenerate Layer">${ICONS.refresh}</button>
                    ${!layer.error ? `<button class="icon-btn" data-action="visibility" title="${layer.visible ? 'Hide Layer' : 'Show Layer'}">${layer.visible ? ICONS.eyeOpen : ICONS.eyeClosed}</button>` : ''}
                    <button class="icon-btn delete-btn" data-action="delete" title="Delete Layer">${ICONS.trash}</button>
                ` : ''}
            </div>
        `;

        return el;
    }

    function renderLayerList() {
        if (layers.length === 0) {
            DOM.layerList.innerHTML = '<div class="empty-state">No layers added.</div>';
            DOM.layerControls.style.display = 'none';
            return;
        }

        DOM.layerControls.style.display = 'block';

        // Use DocumentFragment for batch DOM operations
        const fragment = document.createDocumentFragment();

        for (let i = 0; i < layers.length; i++) {
            fragment.appendChild(createLayerElement(layers[i]));
        }

        DOM.layerList.innerHTML = '';
        DOM.layerList.appendChild(fragment);
    }

    // --- Event Delegation for Layer Actions ---
    DOM.layerList.addEventListener('click', (e) => {
        const target = e.target;
        const layerItem = target.closest('.layer-item');
        if (!layerItem) return;

        const layerId = parseFloat(layerItem.dataset.layerId);
        const actionBtn = target.closest('[data-action]');

        if (actionBtn) {
            e.stopPropagation();
            const action = actionBtn.dataset.action;

            switch (action) {
                case 'regenerate':
                    regenerateLayer(layerId);
                    break;
                case 'visibility':
                    const layer = layers.find(l => l.id === layerId);
                    if (layer) {
                        layer.visible = !layer.visible;
                        actionBtn.innerHTML = layer.visible ? ICONS.eyeOpen : ICONS.eyeClosed;
                        actionBtn.title = layer.visible ? 'Hide Layer' : 'Show Layer';
                        scheduleRender();
                    }
                    break;
                case 'delete':
                    deleteLayer(layerId);
                    break;
            }
        } else {
            selectLayer(layerId);
        }
    });

    function selectLayer(id) {
        const layer = layers.find(l => l.id === id);
        if (layer) {
            activeLayerId = id;
            if (!layer.loading && !layer.error) {
                DOM.opacitySlider.value = layer.opacity;
                DOM.valOpacity.textContent = layer.opacity + '%';
                DOM.layerControls.style.display = 'block';
            } else {
                DOM.layerControls.style.display = 'none';
            }
        }
        scheduleLayerListRender();
    }

    // --- Base Layer Toggle ---
    if (DOM.baseLayerVisBtn) {
        DOM.baseLayerVisBtn.onclick = () => {
            baseLayerVisible = !baseLayerVisible;
            DOM.baseLayerVisBtn.innerHTML = baseLayerVisible ? ICONS.eyeOpen : ICONS.eyeClosed;
            DOM.baseLayerVisBtn.title = baseLayerVisible ? "Hide Base Image" : "Show Base Image";

            if (DOM.baseLayerTrack) {
                DOM.baseLayerTrack.style.opacity = baseLayerVisible ? '1' : '0.5';
            }
            scheduleRender();
        };
    }

    // --- Event Listeners ---

    // Zoom Controls
    DOM.zoomInBtn.addEventListener('click', () => setZoom(zoomLevel + 0.1));
    DOM.zoomOutBtn.addEventListener('click', () => setZoom(zoomLevel - 0.1));
    DOM.zoomFitBtn.addEventListener('click', fitToScreen);

    // Mouse Wheel Zoom (throttled)
    const throttledZoom = throttle((delta) => {
        setZoom(zoomLevel + delta);
    }, 50);

    DOM.canvasContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        throttledZoom(delta);
    }, { passive: false });

    // Preview Mode
    if (DOM.btnViewMode) {
        DOM.btnViewMode.addEventListener('click', togglePreviewMode);
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isPreviewMode) {
            togglePreviewMode();
        }
    });

    // Save Image
    DOM.saveImageBtn.addEventListener('click', () => {
        if (!baseImage.src) return;
        const link = document.createElement('a');
        link.download = `composited_${Date.now()}.png`;
        link.href = DOM.canvas.toDataURL('image/png');
        link.click();
    });

    // Opacity - Optimized with direct RAF
    DOM.opacitySlider.addEventListener('input', (e) => {
        if (!activeLayerId) return;
        const val = parseInt(e.target.value, 10);
        DOM.valOpacity.textContent = val + '%';

        const layer = layers.find(l => l.id === activeLayerId);
        if (layer) {
            layer.opacity = val;
            scheduleRender();
        }
    });

    // Modals
    DOM.addLayerBtn.addEventListener('click', () => {
        DOM.modalPrompt.classList.add('active');
        DOM.promptInput.focus();
    });

    DOM.cancelPromptBtn.addEventListener('click', () => {
        DOM.modalPrompt.classList.remove('active');
    });

    // API Key
    DOM.btnApiKey.addEventListener('click', () => {
        DOM.modalApi.classList.add('active');
    });

    DOM.closeApiBtn.addEventListener('click', () => {
        DOM.modalApi.classList.remove('active');
    });

    DOM.saveApiBtn.addEventListener('click', () => {
        apiKey = DOM.apiKeyInput.value;
        localStorage.setItem('gemini_api_key', apiKey);
        DOM.modalApi.classList.remove('active');
        updateApiStatus();
        alert("API Key Saved!");
    });

    // System Prompt
    DOM.btnSysPrompt.addEventListener('click', async () => {
        DOM.modalSysPrompt.classList.add('active');
        try {
            const res = await fetch('/system-prompt');
            const data = await res.json();
            DOM.sysPromptInput.value = data.content;
        } catch (e) {
            DOM.sysPromptInput.value = "Error loading prompt.";
        }
    });

    DOM.closeSysBtn.addEventListener('click', () => {
        DOM.modalSysPrompt.classList.remove('active');
    });

    DOM.saveSysBtn.addEventListener('click', async () => {
        const content = DOM.sysPromptInput.value;
        try {
            await fetch('/system-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            DOM.modalSysPrompt.classList.remove('active');
            alert("System Prompt Saved");
        } catch (e) {
            alert("Error saving prompt.");
        }
    });

    // Prompt helpers
    window.insertPrompt = (text) => {
        const curVal = DOM.promptInput.value;
        DOM.promptInput.value = curVal ? curVal + ", " + text : text;
        DOM.promptInput.focus();
    };

    // --- Generation Logic ---
    async function generateSingleLayer(promptText, tempLayerId) {
        try {
            const formData = new FormData();
            formData.append('filename', uploadedFilename);
            formData.append('prompt', promptText.trim());
            formData.append('api_key', apiKey);

            const response = await fetch('/generate', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                let errMsg = "Generation failed";
                try {
                    const errData = await response.json();
                    if (errData.error) errMsg = errData.error;
                } catch (e) {}

                if (response.status === 401) {
                    errMsg = "API Key Invalid or Missing. Please check API Settings.";
                    DOM.modalApi.classList.add('active');
                }
                throw new Error(errMsg);
            }

            const data = await response.json();
            updateLayerWithImage(tempLayerId, data.url);

        } catch (err) {
            console.error(err);
            const layer = layers.find(l => l.id === tempLayerId);
            if (layer) {
                markLayerAsError(layer, err.message);
            }
        }
    }

    DOM.generateConfirmBtn.addEventListener('click', async () => {
        if (!apiKey) {
            alert("Please set your Google GenAI API Key in 'API Settings' first.");
            DOM.modalApi.classList.add('active');
            return;
        }

        const rawInput = DOM.promptInput.value.trim();
        if (!rawInput) {
            alert("Please enter a prompt.");
            return;
        }

        DOM.modalPrompt.classList.remove('active');
        DOM.promptInput.value = '';

        const prompts = rawInput.split(/[,\n]+/).map(p => p.trim()).filter(p => p.length > 0);

        if (prompts.length === 0) return;

        // Launch all generations in parallel
        prompts.forEach(pText => {
            const tempId = addLoadingLayer(pText);
            generateSingleLayer(pText, tempId);
        });
    });

    // --- Window Resize Handler (debounced) ---
    const debouncedFitToScreen = debounce(fitToScreen, 200);
    window.addEventListener('resize', debouncedFitToScreen);
});
