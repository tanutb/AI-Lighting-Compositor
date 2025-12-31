document.addEventListener('DOMContentLoaded', () => {
    // --- UI Elements ---
    const canvas = document.getElementById('main-canvas');
    const ctx = canvas.getContext('2d');
    
    // Controls
    const addLayerBtn = document.getElementById('add-layer-btn');
    const opacitySlider = document.getElementById('opacity');
    const valOpacity = document.getElementById('val-opacity');
    const layerControls = document.getElementById('layer-controls');
    
    // Layer List
    const layerList = document.getElementById('layer-list');
    
    // Base Layer Visibility
    const baseLayerVisBtn = document.getElementById('base-layer-vis-btn');
    let baseLayerVisible = true;
    
    // Modals
    const modalPrompt = document.getElementById('modal-prompt');
    const promptInput = document.getElementById('prompt-input');
    const cancelPromptBtn = document.getElementById('cancel-prompt-btn');
    const generateConfirmBtn = document.getElementById('generate-confirm-btn');
    
    const btnApiKey = document.getElementById('btn-api-key');
    const modalApi = document.getElementById('modal-api');
    const apiKeyInput = document.getElementById('api-key-input');
    const closeApiBtn = document.getElementById('close-api-btn');
    const saveApiBtn = document.getElementById('save-api-btn');

    const btnSysPrompt = document.getElementById('btn-sys-prompt');
    const modalSysPrompt = document.getElementById('modal-sys-prompt');
    const sysPromptInput = document.getElementById('sys-prompt-input');
    const closeSysBtn = document.getElementById('close-sys-btn');
    const saveSysBtn = document.getElementById('save-sys-btn');

    // Panels
    const leftPanel = document.getElementById('left-panel');
    const rightPanel = document.getElementById('right-panel');
    const resizerLeft = document.getElementById('resizer-left');
    const resizerRight = document.getElementById('resizer-right');

    // --- State ---
    let baseImage = new Image();
    let layers = []; // Array of objects: { id, name, image, opacity, visible, loading, error }
    let activeLayerId = null;
    let apiKey = localStorage.getItem('gemini_api_key') || '';
    
    // --- Icons ---
    const ICON_EYE_OPEN = `<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
    const ICON_EYE_CLOSED = `<svg viewBox="0 0 24 24"><path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-4.01.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;
    const ICON_TRASH = `<svg viewBox="0 0 24 24"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
    const ICON_WAND = `<svg viewBox="0 0 24 24"><path d="M7.5 5.6L10 7 8.6 4.5 10 2 7.5 3.4 5 2 6.4 4.5 5 7zM19.5 15.4L22 14l-2.5-1.4L21 10l-2.6 1.5L16 10l1.4 2.6L16 14l2.6-1.5L20 15.4zM14.34 6.12l-3.38-3.37C10.57 2.36 10.06 2 9.5 2s-1.07.36-1.46.75L2.75 8.04c-.39.39-.75.9-.75 1.46s.36 1.07.75 1.46l3.37 3.38c.39.39.9.75 1.46.75s1.07-.36 1.46-.75l5.3-5.3c.78-.78.78-2.05 0-2.84zM11.3 15l-1.66-1.66 3.63-3.63 1.66 1.66L11.3 15z"/></svg>`;


    // --- Initialization ---

    function updateApiStatus() {
        if (!apiKey) {
            btnApiKey.classList.add('warning');
            btnApiKey.title = "API Key Missing";
            btnApiKey.style.color = '#ff6b6b';
        } else {
            btnApiKey.classList.remove('warning');
            btnApiKey.title = "API Settings";
            btnApiKey.style.color = '';
        }
    }

    if (apiKey) {
        apiKeyInput.value = apiKey;
    }
    updateApiStatus();

    if (typeof uploadedFilename !== 'undefined' && uploadedFilename) {
        baseImage.src = `/static/uploads/${uploadedFilename}`;
        baseImage.onload = () => {
            resizeCanvasToImage();
        };
    }

    function resizeCanvasToImage() {
        if (!baseImage.src) return;
        canvas.width = baseImage.naturalWidth;
        canvas.height = baseImage.naturalHeight;
        render();
    }

    // --- Rendering Engine ---

    function render() {
        if (!baseImage.complete) return;
        const width = canvas.width;
        const height = canvas.height;

        ctx.clearRect(0, 0, width, height);

        // 1. Draw Base (If visible)
        if (baseLayerVisible) {
            ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
            ctx.drawImage(baseImage, 0, 0);
        }

        // 2. Draw Layers
        layers.forEach(layer => {
            // Skip invisible or loading layers or failed layers
            if (!layer.visible || layer.loading || layer.error) return;
            
            // Default to Screen mode for lighting, fallback to source-over
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = layer.opacity / 100;
            // SCALE: Draw image to fill canvas (matching base image)
            ctx.drawImage(layer.image, 0, 0, width, height);
        });

        // Reset
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    // --- Panel Resizing ---
    
    function initResizers() {
        // Left Panel
        resizerLeft.addEventListener('mousedown', (e) => {
            e.preventDefault();
            document.addEventListener('mousemove', resizeLeft);
            document.addEventListener('mouseup', stopResizeLeft);
            resizerLeft.classList.add('resizing');
        });
        
        function resizeLeft(e) {
            const newWidth = e.clientX;
            if (newWidth > 150 && newWidth < 600) {
                leftPanel.style.width = newWidth + 'px';
            }
        }
        function stopResizeLeft() {
            document.removeEventListener('mousemove', resizeLeft);
            document.removeEventListener('mouseup', stopResizeLeft);
            resizerLeft.classList.remove('resizing');
        }

        // Right Panel
        resizerRight.addEventListener('mousedown', (e) => {
            e.preventDefault();
            document.addEventListener('mousemove', resizeRight);
            document.addEventListener('mouseup', stopResizeRight);
            resizerRight.classList.add('resizing');
        });

        function resizeRight(e) {
            // Right panel width = Window Width - Mouse X
            const newWidth = window.innerWidth - e.clientX;
            if (newWidth > 150 && newWidth < 600) {
                rightPanel.style.width = newWidth + 'px';
            }
        }
        function stopResizeRight() {
            document.removeEventListener('mousemove', resizeRight);
            document.removeEventListener('mouseup', stopResizeRight);
            resizerRight.classList.remove('resizing');
        }
    }
    initResizers();


    // --- Layer Management ---

    function addLoadingLayer(name) {
        const id = Date.now() + Math.random(); // Unique ID
        const newLayer = {
            id: id,
            name: name,
            image: null,
            opacity: 100,
            visible: true,
            loading: true,
            error: false
        };
        layers.push(newLayer);
        renderLayerList();
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
            layer.src = imageSrc; // Keep URL for alignment
            layer.loading = false;
            
            // Auto-select if it's the only one or user preference
            selectLayer(id);
            renderLayerList();
            render();
        };
        img.onerror = () => {
            markLayerAsError(layer, "Image Load Error");
        };
    }

    function markLayerAsError(layer, msg) {
        layer.name += " (Failed)";
        layer.loading = false;
        layer.error = true;
        renderLayerList();
    }
    
    function deleteLayer(id) {
        if (confirm("Delete this layer?")) {
            layers = layers.filter(l => l.id !== id);
            if (activeLayerId === id) {
                activeLayerId = null;
                layerControls.style.display = 'none';
            }
            renderLayerList();
            render();
        }
    }

    async function alignLayer(id) {
        const layer = layers.find(l => l.id === id);
        if (!layer || layer.loading || layer.error) return;

        // Show loading state
        const originalName = layer.name;
        layer.name += " (Aligning...)";
        renderLayerList();

        try {
            const formData = new FormData();
            formData.append('base_filename', uploadedFilename);
            formData.append('layer_url', layer.src);

            const response = await fetch('/align-layer', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                 const d = await response.json();
                 throw new Error(d.error || "Alignment failed");
            }

            const data = await response.json();
            
            // Reload image (cache bust)
            const newSrc = data.url + "?t=" + Date.now();
            updateLayerWithImage(id, newSrc);
            
            layer.name = originalName + " (Aligned)";
            
        } catch (e) {
            alert("Alignment Error: " + e.message);
            layer.name = originalName; // Reset name
        } finally {
            renderLayerList();
            render();
        }
    }

    function renderLayerList() {
        layerList.innerHTML = '';
        if (layers.length === 0) {
            layerList.innerHTML = '<div class="empty-state">No layers added.</div>';
            layerControls.style.display = 'none';
            return;
        }
        
        layerControls.style.display = 'block';

        layers.forEach(layer => {
            const el = document.createElement('div');
            el.className = `layer-item ${layer.id === activeLayerId ? 'active' : ''}`;
            
            // Thumbnail Area
            let thumbContent;
            if (layer.loading) {
                thumbContent = `<div class="mini-spinner"></div>`;
            } else if (layer.image && !layer.error) {
                thumbContent = `<img src="${layer.image.src}" class="layer-thumb" style="width:40px;height:40px;object-fit:cover;">`;
            } else {
                thumbContent = `<div class="layer-thumb" style="width:40px;height:40px;background:#330000;display:flex;align-items:center;justify-content:center;color:#ff5555;font-size:20px;">!</div>`;
            }

            // Thumbnail & Info Wrapper
            const leftDiv = document.createElement('div');
            leftDiv.style.display = 'flex';
            leftDiv.style.alignItems = 'center';
            leftDiv.style.flex = '1';
            leftDiv.style.overflow = 'hidden';
            
            // Error Styling
            let nameClass = "layer-name";
            if (layer.error) nameClass += " error";

            leftDiv.innerHTML = `
                <div style="width:40px;height:40px;margin-right:10px;display:flex;align-items:center;justify-content:center;background:#000;border:1px solid ${layer.error ? '#ff5555' : '#555'};">
                    ${thumbContent}
                </div>
                <div class="layer-info">
                    <div class="${nameClass}">${layer.name}</div>
                    <div class="layer-desc">${layer.loading ? 'Generating...' : (layer.error ? 'Generation Failed' : layer.opacity + '% Opacity')}</div>
                </div>
            `;
            leftDiv.onclick = () => selectLayer(layer.id);

            // Actions
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'layer-actions';
            
            if (!layer.loading) {
                if (!layer.error) {
                    // Align Button
                    const btnAlign = document.createElement('button');
                    btnAlign.className = 'icon-btn';
                    btnAlign.innerHTML = ICON_WAND;
                    btnAlign.title = "Auto-Align Layer";
                    btnAlign.onclick = (e) => {
                        e.stopPropagation();
                        alignLayer(layer.id);
                    };
                    actionsDiv.appendChild(btnAlign);

                    // Eye Button
                    const btnEye = document.createElement('button');
                    btnEye.className = 'icon-btn';
                    // Render based on CURRENT state
                    btnEye.innerHTML = layer.visible ? ICON_EYE_OPEN : ICON_EYE_CLOSED;
                    btnEye.title = layer.visible ? "Hide Layer" : "Show Layer";
                    
                    // DIRECT CLICK HANDLER for instant update
                    btnEye.onclick = (e) => {
                        e.stopPropagation(); // Stop selection
                        
                        // 1. Toggle State
                        layer.visible = !layer.visible;
                        
                        // 2. Immediate Icon Update (No full rebuild)
                        btnEye.innerHTML = layer.visible ? ICON_EYE_OPEN : ICON_EYE_CLOSED;
                        btnEye.title = layer.visible ? "Hide Layer" : "Show Layer";
                        
                        // 3. Render Canvas
                        render();
                    };
                    actionsDiv.appendChild(btnEye);
                }
                
                // Delete Button
                const btnTrash = document.createElement('button');
                btnTrash.className = 'icon-btn delete-btn';
                btnTrash.innerHTML = ICON_TRASH;
                btnTrash.title = "Delete Layer";
                btnTrash.onclick = (e) => {
                    e.stopPropagation();
                    deleteLayer(layer.id);
                };
                actionsDiv.appendChild(btnTrash);
            }

            el.appendChild(leftDiv);
            el.appendChild(actionsDiv);
            
            layerList.appendChild(el);
        });
    }

    function selectLayer(id) {
        const layer = layers.find(l => l.id === id);
        if (layer) {
            activeLayerId = id;
            if (!layer.loading && !layer.error) {
                opacitySlider.value = layer.opacity;
                valOpacity.textContent = layer.opacity + '%';
                layerControls.style.display = 'block';
            } else {
                layerControls.style.display = 'none';
            }
        }
        // Update selection styles without full rebuild to avoid flicker, 
        // OR just rebuild (list is usually short). 
        // For simplicity and correctness with the eye button fix, 
        // let's stick to rebuild for selection changes, but NOT for toggles.
        renderLayerList();
    }

    // --- Base Layer Toggle ---
    if (baseLayerVisBtn) {
        baseLayerVisBtn.onclick = () => {
            baseLayerVisible = !baseLayerVisible;
            baseLayerVisBtn.innerHTML = baseLayerVisible ? ICON_EYE_OPEN : ICON_EYE_CLOSED;
            baseLayerVisBtn.title = baseLayerVisible ? "Hide Base Image" : "Show Base Image";
            
            const track = document.getElementById('base-layer-track');
            if (track) {
                track.style.opacity = baseLayerVisible ? '1' : '0.5';
            }
            render();
        };
    }

    // --- Event Listeners ---

    // Opacity
    opacitySlider.addEventListener('input', (e) => {
        if (!activeLayerId) return;
        const val = parseInt(e.target.value);
        valOpacity.textContent = val + '%';
        
        const layer = layers.find(l => l.id === activeLayerId);
        if (layer) {
            layer.opacity = val;
            render();
            // Optional: Update desc in list without rebuild
            // But opacity changes are high frequency, rebuilding is expensive.
            // Let's just update canvas. Description update can wait or be omitted for perf.
        }
    });

    // Modals
    addLayerBtn.addEventListener('click', () => {
        modalPrompt.classList.add('active');
        promptInput.focus();
    });

    cancelPromptBtn.addEventListener('click', () => {
        modalPrompt.classList.remove('active');
    });

    // API Key
    btnApiKey.addEventListener('click', () => {
        modalApi.classList.add('active');
    });

    closeApiBtn.addEventListener('click', () => {
        modalApi.classList.remove('active');
    });

    saveApiBtn.addEventListener('click', () => {
        apiKey = apiKeyInput.value;
        localStorage.setItem('gemini_api_key', apiKey);
        modalApi.classList.remove('active');
        updateApiStatus();
        alert("API Key Saved!");
    });

    // System Prompt
    btnSysPrompt.addEventListener('click', async () => {
        modalSysPrompt.classList.add('active');
        try {
            const res = await fetch('/system-prompt');
            const data = await res.json();
            sysPromptInput.value = data.content;
        } catch (e) {
            sysPromptInput.value = "Error loading prompt.";
        }
    });

    closeSysBtn.addEventListener('click', () => {
        modalSysPrompt.classList.remove('active');
    });

    saveSysBtn.addEventListener('click', async () => {
        const content = sysPromptInput.value;
        try {
            await fetch('/system-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            modalSysPrompt.classList.remove('active');
            alert("System Prompt Saved");
        } catch (e) {
            alert("Error saving prompt.");
        }
    });

    // Prompt helpers
    window.insertPrompt = (text) => {
        const curVal = promptInput.value;
        promptInput.value = curVal ? curVal + ", " + text : text;
        promptInput.focus();
    };

    // --- Generation Logic (Parallel Batch) ---

    // Helper for single request
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
                // Try to get error message
                let errMsg = "Generation failed";
                try {
                    const errData = await response.json();
                    if (errData.error) errMsg = errData.error;
                } catch(e) {}
                
                if (response.status === 401) {
                     errMsg = "API Key Invalid or Missing. Please check API Settings.";
                     modalApi.classList.add('active');
                }
                throw new Error(errMsg);
            }

            const data = await response.json();
            updateLayerWithImage(tempLayerId, data.url);

        } catch (err) {
            console.error(err);
            // Error Handling Logic
            const layer = layers.find(l => l.id === tempLayerId);
            if(layer) {
                markLayerAsError(layer, err.message);
            }
        }
    }

    generateConfirmBtn.addEventListener('click', async () => {
        // Check API Key
        if (!apiKey) {
            alert("Please set your Google GenAI API Key in 'API Settings' first.");
            modalApi.classList.add('active');
            return;
        }

        const rawInput = promptInput.value.trim();
        if (!rawInput) {
            alert("Please enter a prompt.");
            return;
        }

        modalPrompt.classList.remove('active');
        promptInput.value = ''; 
        
        const prompts = rawInput.split(/[,\n]+/).map(p => p.trim()).filter(p => p.length > 0);

        if (prompts.length === 0) return;

        prompts.forEach(pText => {
            const tempId = addLoadingLayer(pText);
            generateSingleLayer(pText, tempId);
        });
    });
});
