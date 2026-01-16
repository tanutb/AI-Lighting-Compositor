/**
 * Photo Editor - Main JavaScript Engine
 * Professional photo editing tools with undo/redo
 * Performance Optimized Version
 */

'use strict';

// ==========================================
// Global State
// ==========================================

const EditorState = {
    canvas: null,
    ctx: null,
    originalImage: null,
    currentImage: null,
    imageData: null,
    zoom: 1,
    pan: { x: 0, y: 0 },
    currentTool: 'move',
    isDrawing: false,
    lastPoint: null,
    history: [],
    historyIndex: -1,
    maxHistory: 50,

    // Layer system
    layers: [],
    activeLayerIndex: 0,

    // Source filename (for workspace integration)
    sourceFilename: '',

    // Tool settings
    brush: {
        size: 10,
        opacity: 100,
        hardness: 100,
        color: '#007fd4'
    },

    // Adjustments
    adjustments: {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        exposure: 0,
        hue: 0
    },

    // Crop state
    crop: {
        active: false,
        startX: 0,
        startY: 0,
        endX: 0,
        endY: 0,
        ratio: 'free',
        resizingHandle: null
    },

    // Text state
    activeText: null,
    resizingTextHandle: null,

    // Current filter
    currentFilter: 'none'
};

// ==========================================
// Performance: Render State & Utilities
// ==========================================

let renderRequested = false;
let lastRenderTime = 0;
const MIN_RENDER_INTERVAL = 8; // ~120fps cap for smoother brush strokes

// Brush stroke batching
let strokeBuffer = [];
let strokeFlushPending = false;

// Throttle utility for high-frequency events
function throttle(fn, limit) {
    let lastCall = 0;
    return function(...args) {
        const now = performance.now();
        if (now - lastCall >= limit) {
            lastCall = now;
            return fn.apply(this, args);
        }
    };
}

// ==========================================
// Initialization
// ==========================================

function loadImageFromDataUrl(dataUrl, filename) {
    const img = new Image();
    img.onload = () => {
        loadImage(img);
        EditorState.sourceFilename = filename || 'edited-image.png';
        const filenameInput = document.getElementById('export-filename');
        if (filenameInput) {
            filenameInput.value = (EditorState.sourceFilename).replace(/\.[^/.]+$/, '') + '-edited';
        }
        updateStatus('Composite loaded');
        updateLayerList();
    };
    img.onerror = () => {
        const urlParams = new URLSearchParams(window.location.search);
        const imageParam = urlParams.get('image');
        if (imageParam) {
            loadImageFromUrl('/static/uploads/' + imageParam);
        } else {
            updateStatus('Error loading image');
            const dropZone = document.getElementById('drop-zone');
            if (dropZone) {
                dropZone.classList.remove('hidden');
                dropZone.style.display = '';
            }
        }
    };
    img.src = dataUrl;
}

function loadImageFromUrl(url) {
    const finalUrl = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();

    const tryLoad = (useCors) => {
        const img = new Image();
        if (useCors) img.crossOrigin = 'anonymous';

        img.onload = () => {
            try {
                loadImage(img);
                const filename = url.split('/').pop().split('?')[0];
                EditorState.sourceFilename = filename;
                const filenameInput = document.getElementById('export-filename');
                if (filenameInput) {
                    filenameInput.value = filename.replace(/\.[^/.]+$/, '') + '-edited';
                }
                updateStatus('Image loaded');
                updateLayerList();
            } catch (err) {
                console.error("Error in loadImage:", err);
                stopLoadingWithError("Error processing image: " + err.message);
            }
        };

        img.onerror = () => {
            if (useCors) {
                tryLoad(false);
            } else {
                stopLoadingWithError("Error: Could not load image from " + finalUrl);
            }
        };
        img.src = finalUrl;
    };

    tryLoad(true);
}

if (typeof updateStatus === 'undefined') {
    window.updateStatus = function(msg) {
        const el = document.getElementById('status-text');
        if (el) el.textContent = msg;
    };
}

function initCanvas() {
    EditorState.canvas = document.getElementById('main-canvas');
    // Performance optimized context
    EditorState.ctx = EditorState.canvas.getContext('2d', {
        alpha: true,
        desynchronized: true,
        willReadFrequently: false
    });
}

function initEventListeners() {
    const canvas = EditorState.canvas;

    // Canvas mouse events with optimized handlers
    canvas.addEventListener('mousedown', onCanvasMouseDown);
    canvas.addEventListener('mousemove', onCanvasMouseMove);
    canvas.addEventListener('wheel', onCanvasWheel, { passive: false });

    // Touch events for mobile
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    // Crop Handles
    document.querySelectorAll('.crop-handle').forEach(handle => {
        handle.addEventListener('mousedown', (e) => onHandleMouseDown(e, handle));
    });

    // File input
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.addEventListener('change', onFileSelect);

    // Zoom controls
    const zoomIn = document.getElementById('zoom-in');
    const zoomOut = document.getElementById('zoom-out');
    const zoomFit = document.getElementById('zoom-fit');
    if (zoomIn) zoomIn.addEventListener('click', () => setZoom(EditorState.zoom + 0.1));
    if (zoomOut) zoomOut.addEventListener('click', () => setZoom(EditorState.zoom - 0.1));
    if (zoomFit) zoomFit.addEventListener('click', fitToScreen);

    // Undo/Redo
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    if (btnUndo) btnUndo.addEventListener('click', undo);
    if (btnRedo) btnRedo.addEventListener('click', redo);

    // Export
    const btnExport = document.getElementById('btn-export');
    const confirmExport = document.getElementById('confirm-export');
    const cancelExport = document.getElementById('cancel-export');
    if (btnExport) btnExport.addEventListener('click', showExportModal);
    if (confirmExport) confirmExport.addEventListener('click', exportImage);
    if (cancelExport) cancelExport.addEventListener('click', hideExportModal);

    // Export format change
    const exportFormat = document.getElementById('export-format');
    if (exportFormat) {
        exportFormat.addEventListener('change', (e) => {
            const qualityRow = document.getElementById('quality-row');
            if (qualityRow) qualityRow.style.display = e.target.value === 'png' ? 'none' : 'flex';
        });
    }

    const exportQuality = document.getElementById('export-quality');
    if (exportQuality) {
        exportQuality.addEventListener('input', (e) => {
            const valEl = document.getElementById('export-quality-val');
            if (valEl) valEl.textContent = e.target.value + '%';
        });
    }

    // Apply Crop on Double Click
    canvas.addEventListener('dblclick', () => {
        if (EditorState.currentTool === 'crop') {
            applyCrop();
        }
    });

    // Keyboard shortcuts
    initKeyboardShortcuts();
}

function initToolbar() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tool = btn.dataset.tool;

            if (['rotate-left', 'rotate-right', 'flip-h', 'flip-v'].includes(tool)) {
                handleActionTool(tool);
                return;
            }

            setActiveTool(tool);
        });
    });
}

function handleActionTool(tool) {
    saveHistory('Transform');

    let newWidth = EditorState.canvas.width;
    let newHeight = EditorState.canvas.height;

    if (tool === 'rotate-left' || tool === 'rotate-right') {
        const temp = newWidth;
        newWidth = newHeight;
        newHeight = temp;
    }

    EditorState.layers.forEach(layer => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = newWidth;
        tempCanvas.height = newHeight;
        const tempCtx = tempCanvas.getContext('2d');

        const img = layer.canvas;

        switch(tool) {
            case 'rotate-left':
                tempCtx.translate(0, tempCanvas.height);
                tempCtx.rotate(-Math.PI / 2);
                tempCtx.drawImage(img, 0, 0);
                break;
            case 'rotate-right':
                tempCtx.translate(tempCanvas.width, 0);
                tempCtx.rotate(Math.PI / 2);
                tempCtx.drawImage(img, 0, 0);
                break;
            case 'flip-h':
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                tempCtx.translate(tempCanvas.width, 0);
                tempCtx.scale(-1, 1);
                tempCtx.drawImage(img, 0, 0);
                break;
            case 'flip-v':
                tempCanvas.width = img.width;
                tempCanvas.height = img.height;
                tempCtx.translate(0, tempCanvas.height);
                tempCtx.scale(1, -1);
                tempCtx.drawImage(img, 0, 0);
                break;
        }

        layer.canvas = tempCanvas;
        layer.ctx = tempCtx;
    });

    EditorState.canvas.width = newWidth;
    EditorState.canvas.height = newHeight;

    renderAllLayers();
    updateDimensions();
    updateStatus('Applied: ' + tool.replace('-', ' '));
}

function setActiveTool(tool) {
    EditorState.currentTool = tool;

    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    document.querySelectorAll('.tool-panel').forEach(panel => {
        panel.style.display = 'none';
    });

    const panelMap = {
        'brush': 'brush-options',
        'eraser': 'brush-options',
        'resize': 'resize-options',
        'crop': 'crop-options',
        'adjust': 'adjust-options',
        'filters': 'filters-options',
        'text': 'text-options'
    };

    const panel = document.getElementById(panelMap[tool]);
    if (panel) panel.style.display = 'block';

    updateCanvasCursor();

    if (tool === 'crop' && EditorState.originalImage) {
        initCrop();
    } else {
        hideCropOverlay();
    }

    if (tool === 'resize' && EditorState.originalImage) {
        const resizeWidth = document.getElementById('resize-width');
        const resizeHeight = document.getElementById('resize-height');
        if (resizeWidth) resizeWidth.value = EditorState.canvas.width;
        if (resizeHeight) resizeHeight.value = EditorState.canvas.height;
    }

    updateStatus('Tool: ' + tool.charAt(0).toUpperCase() + tool.slice(1));
}

function updateCanvasCursor() {
    const cursors = {
        'move': 'move',
        'crop': 'crosshair',
        'brush': 'crosshair',
        'eraser': 'crosshair',
        'fill': 'crosshair',
        'text': 'text',
        'shapes': 'crosshair'
    };
    EditorState.canvas.style.cursor = cursors[EditorState.currentTool] || 'default';
}

// ==========================================
// Panel Controls
// ==========================================

function initPanelControls() {
    setupSlider('brush-size', 'brush-size-val', 'px', (val) => EditorState.brush.size = val);
    setupSlider('brush-opacity', 'brush-opacity-val', '%', (val) => EditorState.brush.opacity = val);
    setupSlider('brush-hardness', 'brush-hardness-val', '%', (val) => EditorState.brush.hardness = val);

    const brushColor = document.getElementById('brush-color');
    if (brushColor) {
        brushColor.addEventListener('input', (e) => {
            EditorState.brush.color = e.target.value;
            const hexEl = document.getElementById('brush-color-hex');
            if (hexEl) hexEl.textContent = e.target.value;
        });
    }

    setupSlider('adj-brightness', 'adj-brightness-val', '', (val) => EditorState.adjustments.brightness = val);
    setupSlider('adj-contrast', 'adj-contrast-val', '', (val) => EditorState.adjustments.contrast = val);
    setupSlider('adj-saturation', 'adj-saturation-val', '', (val) => EditorState.adjustments.saturation = val);
    setupSlider('adj-exposure', 'adj-exposure-val', '', (val) => EditorState.adjustments.exposure = val);
    setupSlider('adj-hue', 'adj-hue-val', '°', (val) => EditorState.adjustments.hue = val);

    const applyAdj = document.getElementById('apply-adjustments');
    const resetAdj = document.getElementById('reset-adjustments');
    if (applyAdj) applyAdj.addEventListener('click', applyAdjustments);
    if (resetAdj) resetAdj.addEventListener('click', resetAdjustments);

    // Resize controls
    const resizeWidth = document.getElementById('resize-width');
    const resizeHeight = document.getElementById('resize-height');
    const resizeLock = document.getElementById('resize-lock');

    if (resizeWidth && resizeHeight && resizeLock) {
        resizeWidth.addEventListener('input', () => {
            if (resizeLock.checked && EditorState.originalImage) {
                const aspectRatio = EditorState.canvas.width / EditorState.canvas.height;
                resizeHeight.value = Math.round(resizeWidth.value / aspectRatio);
            }
        });

        resizeHeight.addEventListener('input', () => {
            if (resizeLock.checked && EditorState.originalImage) {
                const aspectRatio = EditorState.canvas.width / EditorState.canvas.height;
                resizeWidth.value = Math.round(resizeHeight.value * aspectRatio);
            }
        });
    }

    const applyResize = document.getElementById('apply-resize');
    if (applyResize) applyResize.addEventListener('click', applyResizeHandler);

    // Crop controls
    const applyCropBtn = document.getElementById('apply-crop');
    const cancelCropBtn = document.getElementById('cancel-crop');
    if (applyCropBtn) applyCropBtn.addEventListener('click', applyCrop);
    if (cancelCropBtn) {
        cancelCropBtn.addEventListener('click', () => {
            hideCropOverlay();
            setActiveTool('move');
        });
    }

    // Filter controls
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            EditorState.currentFilter = btn.dataset.filter;

            const intensityRow = document.getElementById('filter-intensity-row');
            if (intensityRow) intensityRow.style.display = btn.dataset.filter === 'none' ? 'none' : 'flex';
        });
    });

    setupSlider('filter-intensity', 'filter-intensity-val', '%');
    const applyFilter = document.getElementById('apply-filter');
    if (applyFilter) applyFilter.addEventListener('click', applyFilterHandler);

    // Text controls
    setupSlider('text-size', 'text-size-val', 'px');

    const textColor = document.getElementById('text-color');
    if (textColor) {
        textColor.addEventListener('input', (e) => {
            const hexEl = document.getElementById('text-color-hex');
            if (hexEl) hexEl.textContent = e.target.value;
            if (EditorState.activeText) {
                EditorState.activeText.color = e.target.value;
                renderTextOverlay();
            }
        });
    }

    const textFont = document.getElementById('text-font');
    if (textFont) {
        textFont.addEventListener('change', (e) => {
            if (EditorState.activeText) {
                EditorState.activeText.font = e.target.value;
                renderTextOverlay();
            }
        });
    }

    const textSize = document.getElementById('text-size');
    if (textSize) {
        textSize.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            const valEl = document.getElementById('text-size-val');
            if (valEl) valEl.textContent = val + 'px';
            if (EditorState.activeText) {
                EditorState.activeText.size = val;
                renderTextOverlay();
            }
        });
    }

    const addText = document.getElementById('add-text');
    if (addText) addText.addEventListener('click', addTextToCanvas);
}

function setupSlider(sliderId, displayId, unit, callback) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);

    if (slider && display) {
        slider.addEventListener('input', () => {
            display.textContent = slider.value + unit;
            if (callback) callback(parseInt(slider.value, 10));
        });
    }
}

// ==========================================
// Drag and Drop
// ==========================================

function initDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const canvasArea = document.querySelector('.canvas-area');

    if (!dropZone || !canvasArea) return;

    dropZone.addEventListener('click', () => {
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.click();
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        canvasArea.addEventListener(eventName, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    canvasArea.addEventListener('dragenter', () => {
        dropZone.classList.add('drag-over');
        dropZone.classList.remove('hidden');
    });

    canvasArea.addEventListener('dragleave', (e) => {
        if (!canvasArea.contains(e.relatedTarget)) {
            dropZone.classList.remove('drag-over');
            if (EditorState.originalImage) dropZone.classList.add('hidden');
        }
    });

    canvasArea.addEventListener('drop', (e) => {
        dropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            loadImageFile(files[0]);
        }
    });
}

function onFileSelect(e) {
    if (e.target.files.length > 0) {
        loadImageFile(e.target.files[0]);
    }
}

function loadImageFile(file) {
    if (!file.type.startsWith('image/')) {
        updateStatus('Error: Please select an image file');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            loadImage(img);
            const filenameInput = document.getElementById('export-filename');
            if (filenameInput) {
                filenameInput.value = file.name.replace(/\.[^/.]+$/, '') + '-edited';
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function loadImage(img) {
    EditorState.originalImage = img;
    EditorState.currentImage = img;
    EditorState.canvas.width = img.width;
    EditorState.canvas.height = img.height;

    // Initialize Layers - Create Background Layer with optimized context
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = img.width;
    bgCanvas.height = img.height;
    const bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true });
    bgCtx.drawImage(img, 0, 0);

    const bgLayer = {
        id: 'base',
        name: 'Background',
        canvas: bgCanvas,
        ctx: bgCtx,
        visible: true,
        opacity: 100,
        x: 0,
        y: 0,
        locked: true
    };

    EditorState.layers = [bgLayer];
    EditorState.activeLayerIndex = 0;

    renderAllLayers();

    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        dropZone.classList.add('hidden');
        dropZone.style.display = 'none';
    }

    EditorState.history = [];
    EditorState.historyIndex = -1;
    saveHistory('Original');

    resetAdjustments();
    fitToScreen();

    updateLayerList();
    updateDimensions();
    updateStatus('Image loaded successfully');
}

// ==========================================
// Canvas Drawing - OPTIMIZED
// ==========================================

function onHandleMouseDown(e, handle) {
    e.stopPropagation();
    if (!EditorState.originalImage) return;

    if (handle.classList.contains('nw')) EditorState.crop.resizingHandle = 'nw';
    else if (handle.classList.contains('ne')) EditorState.crop.resizingHandle = 'ne';
    else if (handle.classList.contains('sw')) EditorState.crop.resizingHandle = 'sw';
    else if (handle.classList.contains('se')) EditorState.crop.resizingHandle = 'se';

    EditorState.isDrawing = true;

    document.addEventListener('mousemove', onCanvasMouseMove);
    document.addEventListener('mouseup', onCanvasMouseUp);
}

function onTextHandleMouseDown(e, handle) {
    e.stopPropagation();
    if (!EditorState.activeText) return;

    if (handle.classList.contains('nw')) EditorState.resizingTextHandle = 'nw';
    else if (handle.classList.contains('ne')) EditorState.resizingTextHandle = 'ne';
    else if (handle.classList.contains('sw')) EditorState.resizingTextHandle = 'sw';
    else if (handle.classList.contains('se')) EditorState.resizingTextHandle = 'se';

    EditorState.isDrawing = true;
    document.addEventListener('mousemove', onCanvasMouseMove);
    document.addEventListener('mouseup', onCanvasMouseUp);
}

function onCanvasMouseDown(e) {
    if (!EditorState.originalImage) return;

    const pos = getCanvasPosition(e);
    EditorState.isDrawing = true;
    EditorState.lastPoint = pos;

    if (EditorState.currentTool === 'move') {
        saveHistory('Move Layer');
    } else if (EditorState.currentTool === 'brush' || EditorState.currentTool === 'eraser') {
        saveHistory('Brush stroke');
        drawBrushPoint(pos);
    } else if (EditorState.currentTool === 'fill') {
        saveHistory('Fill');
        floodFill(Math.floor(pos.x), Math.floor(pos.y), EditorState.brush.color);
    } else if (EditorState.currentTool === 'crop') {
        startCrop(pos);
    } else if (EditorState.currentTool === 'text') {
        if (EditorState.activeText) {
            if (!e.target.closest('.text-box-editor')) {
                finalizeText();
            }
            return;
        }
        startTextBox(pos);
    }

    document.addEventListener('mousemove', onCanvasMouseMove);
    document.addEventListener('mouseup', onCanvasMouseUp);
}

// Optimized mouse move handler
function onCanvasMouseMove(e) {
    const pos = getCanvasPosition(e);

    // Update cursor position (throttled internally)
    updateCursorPositionThrottled(pos);

    if (!EditorState.isDrawing) return;

    // Handle Text Resizing
    if (EditorState.resizingTextHandle && EditorState.activeText) {
        handleTextResize(pos);
        return;
    }

    // Handle Crop Resizing
    if (EditorState.crop.resizingHandle) {
        handleCropResize(pos);
        return;
    }

    // Move Tool Logic
    if (EditorState.currentTool === 'move') {
        const layer = getActiveLayer();
        if (layer && !layer.locked) {
            const dx = pos.x - EditorState.lastPoint.x;
            const dy = pos.y - EditorState.lastPoint.y;
            layer.x += dx;
            layer.y += dy;
            EditorState.lastPoint = pos;
            scheduleRender();
        }
        return;
    }

    // OPTIMIZED: Brush/Eraser - draw immediately without scheduling
    if (EditorState.currentTool === 'brush' || EditorState.currentTool === 'eraser') {
        drawBrushLineDirect(EditorState.lastPoint, pos);
        EditorState.lastPoint = pos;
        return;
    }

    if (EditorState.currentTool === 'crop') {
        updateCrop(pos);
    } else if (EditorState.currentTool === 'text') {
        updateTextBox(pos);
    }
}

function handleTextResize(pos) {
    const handle = EditorState.resizingTextHandle;
    const state = EditorState.activeText;

    let newX = state.x, newY = state.y;
    let newW = state.width, newH = state.height;

    if (handle === 'nw') {
        newW = (state.x + state.width) - pos.x;
        newH = (state.y + state.height) - pos.y;
        newX = pos.x;
        newY = pos.y;
    } else if (handle === 'ne') {
        newW = pos.x - state.x;
        newH = (state.y + state.height) - pos.y;
        newY = pos.y;
    } else if (handle === 'sw') {
        newW = (state.x + state.width) - pos.x;
        newH = pos.y - state.y;
        newX = pos.x;
    } else if (handle === 'se') {
        newW = pos.x - state.x;
        newH = pos.y - state.y;
    }

    if (newW > 20 && newH > 20) {
        state.x = newX;
        state.y = newY;
        state.width = newW;
        state.height = newH;
        renderTextOverlay();
    }
}

function handleCropResize(pos) {
    const handle = EditorState.crop.resizingHandle;
    const x = Math.max(0, Math.min(pos.x, EditorState.canvas.width));
    const y = Math.max(0, Math.min(pos.y, EditorState.canvas.height));

    if (handle === 'nw') {
        EditorState.crop.startX = x;
        EditorState.crop.startY = y;
    } else if (handle === 'ne') {
        EditorState.crop.endX = x;
        EditorState.crop.startY = y;
    } else if (handle === 'sw') {
        EditorState.crop.startX = x;
        EditorState.crop.endY = y;
    } else if (handle === 'se') {
        EditorState.crop.endX = x;
        EditorState.crop.endY = y;
    }

    updateCropOverlay();
}

function onCanvasMouseUp() {
    if (EditorState.isDrawing) {
        EditorState.isDrawing = false;
        EditorState.crop.resizingHandle = null;
        EditorState.resizingTextHandle = null;

        document.removeEventListener('mousemove', onCanvasMouseMove);
        document.removeEventListener('mouseup', onCanvasMouseUp);

        // Ensure final render after brush stroke
        if (EditorState.currentTool === 'brush' || EditorState.currentTool === 'eraser') {
            renderAllLayers();
        }

        if (EditorState.currentTool === 'crop') {
            finishCrop();
        } else if (EditorState.currentTool === 'text') {
            if (EditorState.activeText && EditorState.activeText.creating) {
                EditorState.activeText.creating = false;
                const overlay = document.getElementById('text-overlay-layer');
                const textarea = overlay ? overlay.querySelector('textarea') : null;
                if (textarea) textarea.focus();
            }
        }
    }
}

// ==========================================
// Text Tool Implementation
// ==========================================

function startTextBox(pos) {
    EditorState.activeText = {
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        creating: true,
        content: '',
        color: document.getElementById('text-color')?.value || '#ffffff',
        size: parseInt(document.getElementById('text-size')?.value || '24', 10),
        font: document.getElementById('text-font')?.value || 'Arial'
    };

    renderTextOverlay();
}

function updateTextBox(pos) {
    if (!EditorState.activeText || !EditorState.activeText.creating) return;

    const startX = EditorState.lastPoint.x;
    const startY = EditorState.lastPoint.y;

    const w = pos.x - startX;
    const h = pos.y - startY;

    EditorState.activeText.width = Math.abs(w);
    EditorState.activeText.height = Math.abs(h);
    EditorState.activeText.x = w < 0 ? pos.x : startX;
    EditorState.activeText.y = h < 0 ? pos.y : startY;

    renderTextOverlay();
}

function renderTextOverlay() {
    const layer = document.getElementById('text-overlay-layer');
    const state = EditorState.activeText;

    if (!layer) return;

    if (!state) {
        layer.innerHTML = '';
        layer.style.display = 'none';
        return;
    }

    layer.style.display = 'block';

    const wrapper = document.getElementById('canvas-wrapper');
    const canvas = EditorState.canvas;
    if (!wrapper || !canvas) return;

    const canvasRect = canvas.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();

    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;

    const left = (canvasRect.left - wrapperRect.left) + (state.x * scaleX);
    const top = (canvasRect.top - wrapperRect.top) + (state.y * scaleY);
    const width = Math.max(50, state.width * scaleX);
    const height = Math.max(30, state.height * scaleY);

    if (layer.children.length === 0) {
        layer.innerHTML = `
            <div class="text-box-editor" style="left:${left}px; top:${top}px; width:${width}px; height:${height}px;">
                <div class="text-box-controls">
                    <button class="text-control-btn cancel" title="Cancel">✕</button>
                    <button class="text-control-btn apply" title="Apply">✓</button>
                </div>
                <textarea class="text-box-content" placeholder="Type here..."
                    style="color:${state.color}; font-family:${state.font}; font-size:${state.size * scaleX}px;"></textarea>
                <div class="text-handle nw"></div>
                <div class="text-handle ne"></div>
                <div class="text-handle sw"></div>
                <div class="text-handle se"></div>
            </div>
        `;

        const textarea = layer.querySelector('textarea');
        if (textarea) {
            textarea.addEventListener('input', (e) => {
                state.content = e.target.value;
            });
        }

        const applyBtn = layer.querySelector('.apply');
        const cancelBtn = layer.querySelector('.cancel');
        if (applyBtn) applyBtn.addEventListener('click', finalizeText);
        if (cancelBtn) cancelBtn.addEventListener('click', cancelText);

        layer.querySelectorAll('.text-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => onTextHandleMouseDown(e, handle));
        });
    } else {
        const box = layer.querySelector('.text-box-editor');
        const textarea = layer.querySelector('textarea');
        if (box && textarea) {
            box.style.left = left + 'px';
            box.style.top = top + 'px';
            box.style.width = width + 'px';
            box.style.height = height + 'px';

            textarea.style.color = state.color;
            textarea.style.fontFamily = state.font;
            textarea.style.fontSize = (state.size * scaleX) + 'px';
        }
    }
}

function cancelText() {
    EditorState.activeText = null;
    renderTextOverlay();
}

function finalizeText() {
    const state = EditorState.activeText;
    if (!state || !state.content) {
        cancelText();
        return;
    }

    saveHistory('Add Text');

    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = EditorState.canvas.width;
    layerCanvas.height = EditorState.canvas.height;
    const ctx = layerCanvas.getContext('2d');

    ctx.fillStyle = state.color;
    ctx.font = `${state.size}px "${state.font}"`;
    ctx.textBaseline = 'top';

    const lineHeight = state.size * 1.2;
    const maxWidth = state.width;

    const paragraphs = state.content.split('\n');
    let currentY = state.y;

    paragraphs.forEach(paragraph => {
        if (paragraph === "") {
            currentY += lineHeight;
            return;
        }

        const words = paragraph.split(' ');
        let line = '';

        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = ctx.measureText(testLine);

            if (metrics.width > maxWidth && n > 0) {
                ctx.fillText(line, state.x, currentY);
                line = words[n] + ' ';
                currentY += lineHeight;
            } else {
                line = testLine;
            }
        }
        ctx.fillText(line, state.x, currentY);
        currentY += lineHeight;
    });

    const layer = {
        id: Date.now(),
        name: `Text: ${state.content.substring(0, 10)}...`,
        canvas: layerCanvas,
        ctx: ctx,
        visible: true,
        opacity: 100,
        x: 0,
        y: 0
    };

    EditorState.layers.push(layer);
    EditorState.activeLayerIndex = EditorState.layers.length - 1;

    renderAllLayers();
    updateLayerList();

    cancelText();
}

function onTouchStart(e) {
    if (e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousedown', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        EditorState.canvas.dispatchEvent(mouseEvent);
    }
}

function onTouchMove(e) {
    if (e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent('mousemove', {
            clientX: touch.clientX,
            clientY: touch.clientY
        });
        EditorState.canvas.dispatchEvent(mouseEvent);
    }
}

function onTouchEnd(e) {
    e.preventDefault();
    const mouseEvent = new MouseEvent('mouseup', {});
    EditorState.canvas.dispatchEvent(mouseEvent);
}

// OPTIMIZED: Cache rect for position calculations
let cachedCanvasRect = null;
let lastRectUpdate = 0;

function getCanvasPosition(e) {
    const now = performance.now();
    // Update rect cache every 100ms or on first call
    if (!cachedCanvasRect || now - lastRectUpdate > 100) {
        cachedCanvasRect = EditorState.canvas.getBoundingClientRect();
        lastRectUpdate = now;
    }

    const rect = cachedCanvasRect;
    const scaleX = EditorState.canvas.width / rect.width;
    const scaleY = EditorState.canvas.height / rect.height;

    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY
    };
}

// Throttled cursor position update
const updateCursorPositionThrottled = throttle((pos) => {
    const cursorPosEl = document.getElementById('cursor-pos');
    if (cursorPosEl) {
        cursorPosEl.textContent = `X: ${Math.round(pos.x)}, Y: ${Math.round(pos.y)}`;
    }
}, 50);

// ==========================================
// Brush Tool - HEAVILY OPTIMIZED
// ==========================================

function getActiveLayer() {
    if (!EditorState.layers || EditorState.layers.length === 0) return null;
    return EditorState.layers[EditorState.activeLayerIndex];
}

function drawBrushPoint(pos) {
    const layer = getActiveLayer();
    if (!layer || !layer.visible) return;

    const ctx = layer.ctx;
    const brush = EditorState.brush;

    ctx.save();
    if (EditorState.currentTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
    } else {
        ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = brush.opacity / 100;
    ctx.fillStyle = EditorState.currentTool === 'eraser' ? '#ffffff' : brush.color;

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, brush.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Immediate partial render for responsiveness
    renderBrushArea(pos, brush.size);
}

// OPTIMIZED: Draw brush line directly without scheduling
function drawBrushLineDirect(from, to) {
    const layer = getActiveLayer();
    if (!layer || !layer.visible) return;

    const ctx = layer.ctx;
    const brush = EditorState.brush;

    ctx.save();
    if (EditorState.currentTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = '#ffffff';
    } else {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = brush.color;
    }
    ctx.globalAlpha = brush.opacity / 100;
    ctx.lineWidth = brush.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();

    // Render only the affected area for better performance
    renderBrushArea(from, brush.size, to);
}

// OPTIMIZED: Render only the brush stroke area
function renderBrushArea(pos1, brushSize, pos2) {
    const ctx = EditorState.ctx;
    const canvas = EditorState.canvas;

    // Calculate bounds of affected area
    const padding = brushSize + 2;
    let minX, minY, maxX, maxY;

    if (pos2) {
        minX = Math.max(0, Math.min(pos1.x, pos2.x) - padding);
        minY = Math.max(0, Math.min(pos1.y, pos2.y) - padding);
        maxX = Math.min(canvas.width, Math.max(pos1.x, pos2.x) + padding);
        maxY = Math.min(canvas.height, Math.max(pos1.y, pos2.y) + padding);
    } else {
        minX = Math.max(0, pos1.x - padding);
        minY = Math.max(0, pos1.y - padding);
        maxX = Math.min(canvas.width, pos1.x + padding);
        maxY = Math.min(canvas.height, pos1.y + padding);
    }

    const width = maxX - minX;
    const height = maxY - minY;

    if (width <= 0 || height <= 0) return;

    // Clear the affected area
    ctx.clearRect(minX, minY, width, height);

    // Redraw all layers in the affected area
    EditorState.layers.forEach(layer => {
        if (layer.visible) {
            ctx.globalAlpha = layer.opacity / 100;
            const x = layer.x || 0;
            const y = layer.y || 0;

            // Draw only the portion that overlaps with the affected area
            ctx.drawImage(
                layer.canvas,
                minX - x, minY - y, width, height,
                minX, minY, width, height
            );
            ctx.globalAlpha = 1;
        }
    });
}

// ==========================================
// Flood Fill
// ==========================================

function floodFill(startX, startY, fillColor) {
    const layer = getActiveLayer();
    if (!layer || !layer.visible) return;

    const ctx = layer.ctx;
    const canvas = layer.canvas;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const startIdx = (startY * canvas.width + startX) * 4;
    const startR = data[startIdx];
    const startG = data[startIdx + 1];
    const startB = data[startIdx + 2];
    const startA = data[startIdx + 3];

    const fillRGB = hexToRgb(fillColor);

    if (startR === fillRGB.r && startG === fillRGB.g && startB === fillRGB.b && startA === 255) return;

    const tolerance = 32;
    const width = canvas.width;
    const height = canvas.height;

    // Use typed array for visited tracking (faster than Set for large images)
    const visited = new Uint8Array(width * height);
    const stack = [[startX, startY]];

    while (stack.length > 0) {
        const [x, y] = stack.pop();

        if (x < 0 || x >= width || y < 0 || y >= height) continue;

        const key = y * width + x;
        if (visited[key]) continue;

        const idx = key * 4;

        // Color match check
        if (Math.abs(data[idx] - startR) > tolerance ||
            Math.abs(data[idx + 1] - startG) > tolerance ||
            Math.abs(data[idx + 2] - startB) > tolerance ||
            Math.abs(data[idx + 3] - startA) > tolerance) continue;

        visited[key] = 1;

        data[idx] = fillRGB.r;
        data[idx + 1] = fillRGB.g;
        data[idx + 2] = fillRGB.b;
        data[idx + 3] = 255;

        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    ctx.putImageData(imageData, 0, 0);
    scheduleRender();
    updateStatus('Fill applied');
}

function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : { r: 0, g: 0, b: 0 };
}

// ==========================================
// Crop Tool
// ==========================================

function initCrop() {
    EditorState.crop = {
        active: true,
        startX: 0,
        startY: 0,
        endX: EditorState.canvas.width,
        endY: EditorState.canvas.height,
        ratio: 'free'
    };
    updateCropOverlay();
}

function startCrop(pos) {
    EditorState.crop.startX = pos.x;
    EditorState.crop.startY = pos.y;
    EditorState.crop.endX = pos.x;
    EditorState.crop.endY = pos.y;
}

function updateCrop(pos) {
    EditorState.crop.endX = Math.max(0, Math.min(pos.x, EditorState.canvas.width));
    EditorState.crop.endY = Math.max(0, Math.min(pos.y, EditorState.canvas.height));
    updateCropOverlay();
}

function finishCrop() {
    const crop = EditorState.crop;
    const minX = Math.min(crop.startX, crop.endX);
    const maxX = Math.max(crop.startX, crop.endX);
    const minY = Math.min(crop.startY, crop.endY);
    const maxY = Math.max(crop.startY, crop.endY);

    crop.startX = minX;
    crop.startY = minY;
    crop.endX = maxX;
    crop.endY = maxY;

    updateCropOverlay();
}

function updateCropOverlay() {
    const overlay = document.getElementById('crop-overlay');
    const canvas = EditorState.canvas;
    const wrapper = document.getElementById('canvas-wrapper');

    if (!overlay || !wrapper) return;

    const canvasRect = canvas.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const crop = EditorState.crop;

    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;

    const left = (canvasRect.left - wrapperRect.left) + (Math.min(crop.startX, crop.endX) * scaleX);
    const top = (canvasRect.top - wrapperRect.top) + (Math.min(crop.startY, crop.endY) * scaleY);
    const width = Math.abs(crop.endX - crop.startX) * scaleX;
    const height = Math.abs(crop.endY - crop.startY) * scaleY;

    overlay.style.display = 'block';
    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
    overlay.style.width = width + 'px';
    overlay.style.height = height + 'px';
}

function hideCropOverlay() {
    const overlay = document.getElementById('crop-overlay');
    if (overlay) overlay.style.display = 'none';
    EditorState.crop.active = false;
}

function applyCrop() {
    if (!EditorState.crop.active) return;

    saveHistory('Crop');

    const crop = EditorState.crop;
    const minX = Math.round(Math.min(crop.startX, crop.endX));
    const minY = Math.round(Math.min(crop.startY, crop.endY));
    const width = Math.round(Math.abs(crop.endX - crop.startX));
    const height = Math.round(Math.abs(crop.endY - crop.startY));

    if (width <= 0 || height <= 0) return;

    EditorState.layers.forEach(layer => {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');

        tempCtx.drawImage(layer.canvas, minX, minY, width, height, 0, 0, width, height);

        layer.canvas = tempCanvas;
        layer.ctx = tempCtx;
    });

    EditorState.canvas.width = width;
    EditorState.canvas.height = height;

    // Invalidate canvas rect cache
    cachedCanvasRect = null;

    const overlay = document.getElementById('crop-overlay');
    if (overlay) overlay.style.display = 'none';
    EditorState.crop.active = false;

    renderAllLayers();
    updateDimensions();
    updateStatus('Image cropped');
}

// ==========================================
// Resize Tool
// ==========================================

function applyResizeHandler() {
    const resizeWidth = document.getElementById('resize-width');
    const resizeHeight = document.getElementById('resize-height');

    if (!resizeWidth || !resizeHeight) return;

    const newWidth = parseInt(resizeWidth.value, 10);
    const newHeight = parseInt(resizeHeight.value, 10);

    if (newWidth < 1 || newHeight < 1 || newWidth > 10000 || newHeight > 10000) {
        updateStatus('Invalid dimensions');
        return;
    }

    saveHistory('Resize');

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = newWidth;
    tempCanvas.height = newHeight;
    const tempCtx = tempCanvas.getContext('2d');

    tempCtx.imageSmoothingEnabled = true;
    tempCtx.imageSmoothingQuality = 'high';
    tempCtx.drawImage(EditorState.canvas, 0, 0, newWidth, newHeight);

    EditorState.canvas.width = newWidth;
    EditorState.canvas.height = newHeight;
    EditorState.ctx.drawImage(tempCanvas, 0, 0);

    // Invalidate cache
    cachedCanvasRect = null;

    const newImg = new Image();
    newImg.src = EditorState.canvas.toDataURL();
    EditorState.currentImage = newImg;

    updateDimensions();
    updateStatus(`Resized to ${newWidth} × ${newHeight}`);
}

// ==========================================
// Adjustments
// ==========================================

function applyAdjustments() {
    const layer = getActiveLayer();
    if (!layer || !layer.visible) return;

    saveHistory('Adjustments');

    const adj = EditorState.adjustments;
    const ctx = layer.ctx;
    const canvas = layer.canvas;

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    const brightness = adj.brightness / 100;
    const contrast = (adj.contrast + 100) / 100;
    const saturation = (adj.saturation + 100) / 100;
    const exposure = Math.pow(2, adj.exposure / 100);

    // Process pixels in batches for better performance
    const len = data.length;
    for (let i = 0; i < len; i += 4) {
        let r = data[i];
        let g = data[i + 1];
        let b = data[i + 2];

        r *= exposure;
        g *= exposure;
        b *= exposure;

        r += brightness * 255;
        g += brightness * 255;
        b += brightness * 255;

        r = (r - 128) * contrast + 128;
        g = (g - 128) * contrast + 128;
        b = (b - 128) * contrast + 128;

        const gray = 0.2989 * r + 0.587 * g + 0.114 * b;
        r = gray + saturation * (r - gray);
        g = gray + saturation * (g - gray);
        b = gray + saturation * (b - gray);

        data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
        data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }

    ctx.putImageData(imageData, 0, 0);

    if (adj.hue !== 0) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.filter = `hue-rotate(${adj.hue}deg)`;
        tempCtx.drawImage(canvas, 0, 0);

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(tempCanvas, 0, 0);
    }

    renderAllLayers();
    updateStatus('Adjustments applied');
}

function resetAdjustments() {
    EditorState.adjustments = {
        brightness: 0,
        contrast: 0,
        saturation: 0,
        exposure: 0,
        hue: 0
    };

    const sliders = ['adj-brightness', 'adj-contrast', 'adj-saturation', 'adj-exposure', 'adj-hue'];
    const displays = ['adj-brightness-val', 'adj-contrast-val', 'adj-saturation-val', 'adj-exposure-val', 'adj-hue-val'];

    sliders.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = 0;
    });

    displays.forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) el.textContent = i === 4 ? '0°' : '0';
    });
}

// ==========================================
// Filters
// ==========================================

function applyFilterHandler() {
    const layer = getActiveLayer();
    if (!layer || !layer.visible) return;

    saveHistory('Apply Filter');

    const filter = EditorState.currentFilter;
    const ctx = layer.ctx;
    const canvas = layer.canvas;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const len = data.length;

    switch (filter) {
        case 'grayscale':
            for (let i = 0; i < len; i += 4) {
                const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
                data[i] = avg;
                data[i + 1] = avg;
                data[i + 2] = avg;
            }
            break;

        case 'sepia':
            for (let i = 0; i < len; i += 4) {
                const r = data[i], g = data[i+1], b = data[i+2];
                data[i] = Math.min(255, (r * 0.393) + (g * 0.769) + (b * 0.189));
                data[i+1] = Math.min(255, (r * 0.349) + (g * 0.686) + (b * 0.168));
                data[i+2] = Math.min(255, (r * 0.272) + (g * 0.534) + (b * 0.131));
            }
            break;

        case 'invert':
            for (let i = 0; i < len; i += 4) {
                data[i] = 255 - data[i];
                data[i+1] = 255 - data[i+1];
                data[i+2] = 255 - data[i+2];
            }
            break;

        case 'blur':
            applyConvolution(data, canvas.width, canvas.height, [
                1/9, 1/9, 1/9,
                1/9, 1/9, 1/9,
                1/9, 1/9, 1/9
            ], 1);
            break;

        case 'sharpen':
            applyConvolution(data, canvas.width, canvas.height, [
                0, -1, 0,
                -1, 5, -1,
                0, -1, 0
            ], 0.5);
            break;
    }

    ctx.putImageData(imageData, 0, 0);
    renderAllLayers();
    updateStatus('Filter applied: ' + filter);
}

function applyConvolution(data, width, height, kernel, intensity) {
    const side = Math.round(Math.sqrt(kernel.length));
    const half = Math.floor(side / 2);
    const copy = new Uint8ClampedArray(data);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0, g = 0, b = 0;

            for (let ky = 0; ky < side; ky++) {
                for (let kx = 0; kx < side; kx++) {
                    const px = Math.min(width - 1, Math.max(0, x + kx - half));
                    const py = Math.min(height - 1, Math.max(0, y + ky - half));
                    const idx = (py * width + px) * 4;
                    const weight = kernel[ky * side + kx];

                    r += copy[idx] * weight;
                    g += copy[idx + 1] * weight;
                    b += copy[idx + 2] * weight;
                }
            }

            const idx = (y * width + x) * 4;
            data[idx] = data[idx] + (r - data[idx]) * intensity;
            data[idx + 1] = data[idx + 1] + (g - data[idx + 1]) * intensity;
            data[idx + 2] = data[idx + 2] + (b - data[idx + 2]) * intensity;
        }
    }
}

// ==========================================
// Text Tool (Add to New Layer)
// ==========================================

function addTextToCanvas() {
    const textInput = document.getElementById('text-input');
    const text = textInput ? textInput.value : '';
    if (!text || !EditorState.originalImage) return;

    saveHistory('Add text');

    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = EditorState.canvas.width;
    layerCanvas.height = EditorState.canvas.height;
    const ctx = layerCanvas.getContext('2d');

    const fontSize = document.getElementById('text-size')?.value || '24';
    const fontFamily = document.getElementById('text-font')?.value || 'Arial';
    const color = document.getElementById('text-color')?.value || '#ffffff';

    ctx.font = `${fontSize}px "${fontFamily}"`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';

    const textWidth = ctx.measureText(text).width;
    const x = (EditorState.canvas.width - textWidth) / 2;
    const y = EditorState.canvas.height / 2;

    ctx.fillText(text, x, y);

    const layer = {
        id: Date.now(),
        name: `Text: ${text.substring(0, 10)}...`,
        canvas: layerCanvas,
        ctx: ctx,
        visible: true,
        opacity: 100,
        x: 0,
        y: 0
    };

    EditorState.layers.push(layer);
    EditorState.activeLayerIndex = EditorState.layers.length - 1;

    renderAllLayers();
    updateLayerList();
    updateStatus('Text layer added');
}

// ==========================================
// Background Removal
// ==========================================

const bgRemoveBtn = document.querySelector('[data-tool="bg-remove"]');
if (bgRemoveBtn) {
    bgRemoveBtn.addEventListener('click', () => {
        if (!EditorState.originalImage) {
            updateStatus('Load an image first');
            return;
        }

        saveHistory('Background removal');

        const canvas = EditorState.canvas;
        const ctx = EditorState.ctx;
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        const threshold = 240;
        const len = data.length;

        for (let i = 0; i < len; i += 4) {
            if (data[i] > threshold && data[i + 1] > threshold && data[i + 2] > threshold) {
                data[i + 3] = 0;
            }
        }

        ctx.putImageData(imageData, 0, 0);
        updateStatus('Background removed (basic white removal)');
    });
}

// ==========================================
// Zoom Controls
// ==========================================

function setZoom(newZoom) {
    EditorState.zoom = Math.max(0.1, Math.min(5, newZoom));
    EditorState.canvas.style.transform = `scale3d(${EditorState.zoom}, ${EditorState.zoom}, 1)`;

    const zoomLevel = document.getElementById('zoom-level');
    if (zoomLevel) zoomLevel.textContent = Math.round(EditorState.zoom * 100) + '%';

    // Invalidate rect cache on zoom
    cachedCanvasRect = null;
}

function fitToScreen() {
    if (!EditorState.originalImage) return;

    const wrapper = document.getElementById('canvas-wrapper');
    if (!wrapper) return;

    const wrapperRect = wrapper.getBoundingClientRect();
    const padding = 80;

    const scaleX = (wrapperRect.width - padding) / EditorState.canvas.width;
    const scaleY = (wrapperRect.height - padding) / EditorState.canvas.height;
    const scale = Math.min(scaleX, scaleY, 1);

    setZoom(scale);
}

function onCanvasWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(EditorState.zoom + delta);
}

// ==========================================
// History (Undo/Redo)
// ==========================================

function saveHistory(action) {
    if (EditorState.historyIndex < EditorState.history.length - 1) {
        EditorState.history = EditorState.history.slice(0, EditorState.historyIndex + 1);
    }

    const layerStates = EditorState.layers.map(l => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        opacity: l.opacity,
        locked: l.locked,
        dataURL: l.canvas.toDataURL()
    }));

    EditorState.history.push({
        action: action,
        layers: layerStates,
        width: EditorState.canvas.width,
        height: EditorState.canvas.height
    });

    if (EditorState.history.length > EditorState.maxHistory) {
        EditorState.history.shift();
    } else {
        EditorState.historyIndex++;
    }

    updateHistoryPanel();
}

function undo() {
    if (EditorState.historyIndex <= 0) return;
    EditorState.historyIndex--;
    restoreFromHistory();
}

function redo() {
    if (EditorState.historyIndex >= EditorState.history.length - 1) return;
    EditorState.historyIndex++;
    restoreFromHistory();
}

function restoreFromHistory() {
    const state = EditorState.history[EditorState.historyIndex];

    updateStatus('Restoring history...');

    EditorState.canvas.width = state.width;
    EditorState.canvas.height = state.height;
    cachedCanvasRect = null;

    const newLayers = [];
    let loadedCount = 0;

    state.layers.forEach((layerState, index) => {
        const layerCanvas = document.createElement('canvas');
        layerCanvas.width = state.width;
        layerCanvas.height = state.height;
        const layerCtx = layerCanvas.getContext('2d');

        const img = new Image();
        img.onload = () => {
            layerCtx.drawImage(img, 0, 0);

            newLayers[index] = {
                id: layerState.id,
                name: layerState.name,
                visible: layerState.visible,
                opacity: layerState.opacity,
                locked: layerState.locked,
                canvas: layerCanvas,
                ctx: layerCtx
            };

            loadedCount++;
            if (loadedCount === state.layers.length) {
                EditorState.layers = newLayers;
                if (EditorState.activeLayerIndex >= newLayers.length) {
                    EditorState.activeLayerIndex = newLayers.length - 1;
                }

                renderAllLayers();
                updateLayerList();
                updateDimensions();
                updateHistoryPanel();
                updateStatus('Restored: ' + state.action);
            }
        };
        img.src = layerState.dataURL;
    });
}

function updateHistoryPanel() {
    const list = document.getElementById('history-list');
    if (!list) return;

    list.innerHTML = '';

    EditorState.history.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'history-item' + (index === EditorState.historyIndex ? ' active' : '');
        div.textContent = item.action;
        div.addEventListener('click', () => {
            EditorState.historyIndex = index;
            restoreFromHistory();
        });
        list.appendChild(div);
    });

    const active = list.querySelector('.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
}

// ==========================================
// Export
// ==========================================

function showExportModal() {
    if (!EditorState.originalImage) {
        updateStatus('No image to export');
        return;
    }
    const modal = document.getElementById('modal-export');
    if (modal) modal.style.display = 'flex';
}

function hideExportModal() {
    const modal = document.getElementById('modal-export');
    if (modal) modal.style.display = 'none';
}

function exportImage() {
    const formatEl = document.getElementById('export-format');
    const qualityEl = document.getElementById('export-quality');
    const filenameEl = document.getElementById('export-filename');

    const format = formatEl ? formatEl.value : 'png';
    const quality = qualityEl ? qualityEl.value / 100 : 0.92;
    const filename = filenameEl ? filenameEl.value : 'edited-image';

    let mimeType = 'image/png';
    let ext = 'png';

    if (format === 'jpeg') {
        mimeType = 'image/jpeg';
        ext = 'jpg';
    } else if (format === 'webp') {
        mimeType = 'image/webp';
        ext = 'webp';
    }

    const dataURL = EditorState.canvas.toDataURL(mimeType, quality);

    const link = document.createElement('a');
    link.download = `${filename}.${ext}`;
    link.href = dataURL;
    link.click();

    hideExportModal();
    updateStatus(`Exported as ${filename}.${ext}`);
}

// ==========================================
// Keyboard Shortcuts
// ==========================================

function initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        const key = e.key.toLowerCase();

        if (e.ctrlKey || e.metaKey) {
            if (key === 'z' && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if ((key === 'z' && e.shiftKey) || key === 'y') {
                e.preventDefault();
                redo();
            } else if (key === 's') {
                e.preventDefault();
                showExportModal();
            }
            return;
        }

        const toolShortcuts = {
            'v': 'move',
            'c': 'crop',
            'r': 'resize',
            'b': 'brush',
            'e': 'eraser',
            'g': 'fill',
            't': 'text',
            'a': 'adjust',
            'f': 'filters'
        };

        if (toolShortcuts[key]) {
            setActiveTool(toolShortcuts[key]);
        }

        if (key === '+' || key === '=') setZoom(EditorState.zoom + 0.1);
        if (key === '-') setZoom(EditorState.zoom - 0.1);
        if (key === '0') fitToScreen();

        if (key === 'enter' && EditorState.currentTool === 'crop' && EditorState.crop.active) {
            applyCrop();
        }
    });
}

// ==========================================
// Utilities
// ==========================================

function updateStatus(text) {
    const el = document.getElementById('status-text');
    if (el) el.textContent = text;
}

function updateDimensions() {
    const w = EditorState.canvas.width;
    const h = EditorState.canvas.height;

    const dimEl = document.getElementById('image-dimensions');
    if (dimEl) dimEl.textContent = `${w} × ${h} px`;

    if (EditorState.currentTool === 'resize') {
        const resizeWidth = document.getElementById('resize-width');
        const resizeHeight = document.getElementById('resize-height');
        if (resizeWidth) resizeWidth.value = w;
        if (resizeHeight) resizeHeight.value = h;
    }
}

// ==========================================
// Layer System
// ==========================================

function initLayers() {
    const addBtn = document.getElementById('add-layer-btn');
    if (addBtn) addBtn.addEventListener('click', addNewLayer);

    const flattenBtn = document.getElementById('flatten-layers-btn');
    if (flattenBtn) flattenBtn.addEventListener('click', flattenLayers);

    const sendBtn = document.getElementById('send-to-workspace-btn');
    if (sendBtn) sendBtn.addEventListener('click', sendToWorkspace);
}

function addNewLayer() {
    if (!EditorState.originalImage) {
        updateStatus('Load an image first');
        return;
    }

    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = EditorState.canvas.width;
    layerCanvas.height = EditorState.canvas.height;
    const layerCtx = layerCanvas.getContext('2d');

    const layer = {
        id: Date.now(),
        name: `Layer ${EditorState.layers.length + 1}`,
        canvas: layerCanvas,
        ctx: layerCtx,
        visible: true,
        opacity: 100,
        x: 0,
        y: 0
    };

    EditorState.layers.push(layer);
    EditorState.activeLayerIndex = EditorState.layers.length - 1;

    updateLayerList();
    updateStatus('New layer added');
}

function updateLayerList() {
    const listEl = document.getElementById('layer-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    if (EditorState.layers && EditorState.layers.length > 0) {
        [...EditorState.layers].reverse().forEach((layer, reverseIndex) => {
            const actualIndex = EditorState.layers.length - 1 - reverseIndex;
            const item = createLayerItem(layer, actualIndex);
            listEl.appendChild(item);
        });
    }
}

function createLayerItem(layer, index) {
    const item = document.createElement('div');
    item.className = 'layer-item' + (index === EditorState.activeLayerIndex ? ' active' : '');
    item.innerHTML = `
        <div class="layer-thumb"></div>
        <div class="layer-info">
            <div class="layer-name">${layer.name}</div>
        </div>
        <div class="layer-actions">
            <button class="icon-btn toggle-vis" title="Toggle Visibility">
                <svg viewBox="0 0 24 24"><path d="${layer.visible ?
                    'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z' :
                    'M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z'
                }"/></svg>
            </button>
        </div>
    `;

    item.addEventListener('click', () => {
        EditorState.activeLayerIndex = index;
        updateLayerList();
    });

    const toggleBtn = item.querySelector('.toggle-vis');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            EditorState.layers[index].visible = !EditorState.layers[index].visible;
            scheduleRender();
            updateLayerList();
        });
    }

    return item;
}

// OPTIMIZED: Rendering with requestAnimationFrame
function renderAllLayers() {
    const ctx = EditorState.ctx;
    const canvas = EditorState.canvas;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (EditorState.layers) {
        EditorState.layers.forEach(layer => {
            if (layer.visible) {
                ctx.globalAlpha = layer.opacity / 100;
                const x = layer.x || 0;
                const y = layer.y || 0;
                ctx.drawImage(layer.canvas, x, y);
                ctx.globalAlpha = 1;
            }
        });
    }
}

function scheduleRender() {
    if (renderRequested) return;

    const now = performance.now();
    const elapsed = now - lastRenderTime;

    if (elapsed >= MIN_RENDER_INTERVAL) {
        renderRequested = true;
        requestAnimationFrame(() => {
            renderAllLayers();
            renderRequested = false;
            lastRenderTime = performance.now();
        });
    } else {
        renderRequested = true;
        setTimeout(() => {
            requestAnimationFrame(() => {
                renderAllLayers();
                renderRequested = false;
                lastRenderTime = performance.now();
            });
        }, MIN_RENDER_INTERVAL - elapsed);
    }
}

function flattenLayers() {
    if (!EditorState.originalImage) return;
    if (EditorState.layers.length === 0) {
        updateStatus('No layers to flatten');
        return;
    }

    saveHistory('Flatten layers');

    renderAllLayers();

    const newImg = new Image();
    newImg.onload = () => {
        EditorState.currentImage = newImg;
        EditorState.layers = [];
        updateLayerList();
        updateStatus('Layers flattened');
    };
    newImg.src = EditorState.canvas.toDataURL();
}

// ==========================================
// Workspace Integration
// ==========================================

function sendToWorkspace() {
    if (!EditorState.originalImage) {
        updateStatus('No image to send');
        return;
    }

    renderAllLayers();

    EditorState.canvas.toBlob(async (blob) => {
        const formData = new FormData();
        const filename = EditorState.sourceFilename || 'edited-image.png';
        formData.append('file', blob, filename);

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            if (response.ok) {
                updateStatus('Sent to workspace!');
                setTimeout(() => {
                    window.location.href = '/workspace?filename=' + encodeURIComponent(filename);
                }, 500);
            } else {
                updateStatus('Failed to send to workspace');
            }
        } catch (e) {
            updateStatus('Error sending to workspace');
            console.error(e);
        }
    }, 'image/png');
}

// ==========================================
// Initialization
// ==========================================

window.startLoading = (msg) => {
    updateStatus(msg);
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        dropZone.classList.add('hidden');
        dropZone.style.display = 'none';
    }
};

window.stopLoadingWithError = (msg) => {
    console.error(msg);
    updateStatus(msg);
    alert(msg);
    const dropZone = document.getElementById('drop-zone');
    if (dropZone) {
        dropZone.classList.remove('hidden');
        dropZone.style.display = '';
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const isComposite = urlParams.get('composite');
    const imageParam = urlParams.get('image');

    if (isComposite === 'true' || imageParam) {
        const dropZone = document.getElementById('drop-zone');
        if (dropZone) dropZone.style.display = 'none';
    }

    initCanvas();
    initEventListeners();
    initToolbar();
    initPanelControls();
    initDragAndDrop();
    initLayers();

    if (isComposite === 'true') {
        const compositeData = sessionStorage.getItem('compositeImage');
        const sourceFilename = sessionStorage.getItem('sourceFilename');

        sessionStorage.removeItem('compositeImage');
        sessionStorage.removeItem('sourceFilename');

        if (compositeData && compositeData.length > 100) {
            startLoading('Loading composite...');
            loadImageFromDataUrl(compositeData, sourceFilename || imageParam);
            return;
        }
    }

    if (imageParam && imageParam !== 'undefined' && imageParam !== 'null') {
        const decodedImageParam = decodeURIComponent(imageParam);
        startLoading('Loading image from workspace: ' + decodedImageParam);

        let finalPath = decodedImageParam;
        if (!finalPath.startsWith('/') && !finalPath.startsWith('http')) {
            finalPath = '/static/uploads/' + finalPath;
        }

        loadImageFromUrl(finalPath);
        return;
    }

    if (typeof preloadImage !== 'undefined' && preloadImage && preloadImage !== 'undefined') {
        startLoading('Loading preloaded image: ' + preloadImage);

        let finalPath = preloadImage;
        if (!finalPath.startsWith('/') && !finalPath.startsWith('http')) {
            finalPath = '/static/uploads/' + finalPath;
        }

        loadImageFromUrl(finalPath);
        return;
    }

    updateStatus('Ready - Drop an image to begin');
});
