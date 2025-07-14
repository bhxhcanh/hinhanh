document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const uploaderSection = document.getElementById('uploader');
    const editorSection = document.getElementById('editor');
    const uploadInput = document.getElementById('upload-input');
    const uploadLabel = document.querySelector('.upload-label');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    // Resize controls
    const widthInput = document.getElementById('width-input');
    const heightInput = document.getElementById('height-input');
    const aspectRatioLock = document.getElementById('aspect-ratio-lock');
    const applyResizeBtn = document.getElementById('apply-resize-btn');

    // Crop controls
    const applyCropBtn = document.getElementById('apply-crop-btn');
    const cropXInput = document.getElementById('crop-x');
    const cropYInput = document.getElementById('crop-y');
    const cropWidthInput = document.getElementById('crop-width');
    const cropHeightInput = document.getElementById('crop-height');
    const cropInputs = [cropXInput, cropYInput, cropWidthInput, cropHeightInput];

    // Export controls
    const formatSelect = document.getElementById('format-select');
    const qualityControl = document.getElementById('quality-control');
    const qualitySlider = document.getElementById('quality-slider');
    const qualityValue = document.getElementById('quality-value');
    const estimatedSizeEl = document.getElementById('estimated-size');
    const downloadBtn = document.getElementById('download-btn');
    
    // Footer Buttons
    const resetBtn = document.getElementById('reset-btn');
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    // State
    let originalImage = new Image();
    let editedImage = new Image();
    let originalAspectRatio = 1;
    let isCropping = false;
    let isDragging = false;
    let cropRect = { startX: 0, startY: 0, width: 0, height: 0 };
    
    // History State
    let historyStack = [];
    let redoStack = [];
    
    // --- UTILITY FUNCTIONS ---
    
    const debounce = (func, delay) => {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    };

    // --- UPLOAD & INITIALIZATION ---

    const handleImageUpload = (file) => {
        if (!file || !file.type.startsWith('image/')) {
            alert('Please select a valid image file.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            originalImage.src = e.target.result;
            originalImage.onload = () => {
                editedImage.src = originalImage.src;
                editedImage.onload = () => {
                    setupEditor();
                }
            };
        };
        reader.readAsDataURL(file);
    };
    
    const setupEditor = () => {
        originalAspectRatio = editedImage.naturalWidth / editedImage.naturalHeight;
        updateCanvas(editedImage);
        updateResizeInputs();
        uploaderSection.classList.add('hidden');
        editorSection.classList.remove('hidden');
        activateTab('resize');
        applyCropBtn.disabled = true;
        historyStack = [];
        redoStack = [];
        updateUndoRedoButtons();
        updateEstimatedSize();
    };
    
    const updateCanvas = (imageSource) => {
        canvas.width = imageSource.naturalWidth;
        canvas.height = imageSource.naturalHeight;
        ctx.drawImage(imageSource, 0, 0, imageSource.naturalWidth, imageSource.naturalHeight);
    };
    
    const updateResizeInputs = () => {
        widthInput.value = editedImage.width;
        heightInput.value = editedImage.height;
    }

    const resetEditor = () => {
        uploaderSection.classList.remove('hidden');
        editorSection.classList.add('hidden');
        uploadInput.value = ''; // Clear file input
        originalImage = new Image();
        editedImage = new Image();
        isCropping = false;
        historyStack = [];
        redoStack = [];
    };

    // --- EVENT LISTENERS ---

    uploadInput.addEventListener('change', (e) => handleImageUpload(e.target.files[0]));
    
    uploadLabel.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadLabel.classList.add('dragover');
    });
    uploadLabel.addEventListener('dragleave', () => uploadLabel.classList.remove('dragover'));
    uploadLabel.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadLabel.classList.remove('dragover');
        handleImageUpload(e.dataTransfer.files[0]);
    });

    tabs.forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));

    widthInput.addEventListener('input', () => handleDimensionChange('width'));
    heightInput.addEventListener('input', () => handleDimensionChange('height'));
    applyResizeBtn.addEventListener('click', applyResize);

    canvas.addEventListener('mousedown', startCrop);
    canvas.addEventListener('mousemove', dragCrop);
    canvas.addEventListener('mouseup', endCrop);
    canvas.addEventListener('mouseleave', endCrop);
    applyCropBtn.addEventListener('click', applyCrop);
    cropInputs.forEach(input => input.addEventListener('input', handleCropInputChange));
    
    formatSelect.addEventListener('change', () => {
        toggleQualitySlider();
        updateEstimatedSize();
    });
    qualitySlider.addEventListener('input', () => {
        qualityValue.textContent = qualitySlider.value;
        debouncedUpdateSize();
    });
    downloadBtn.addEventListener('click', downloadImage);
    
    resetBtn.addEventListener('click', resetEditor);
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);


    // --- HISTORY (UNDO/REDO) LOGIC ---
    
    function saveState() {
        redoStack = []; // Clear redo stack on new action
        historyStack.push(editedImage.src);
        updateUndoRedoButtons();
    }
    
    function updateUndoRedoButtons() {
        undoBtn.disabled = historyStack.length === 0;
        redoBtn.disabled = redoStack.length === 0;
    }

    function undo() {
        if (historyStack.length === 0) return;
        redoStack.push(editedImage.src);
        const prevState = historyStack.pop();
        editedImage.src = prevState;
        editedImage.onload = () => {
            handleImageStateChange();
            updateUndoRedoButtons();
        };
    }
    
    function redo() {
        if (redoStack.length === 0) return;
        historyStack.push(editedImage.src);
        const nextState = redoStack.pop();
        editedImage.src = nextState;
        editedImage.onload = () => {
            handleImageStateChange();
            updateUndoRedoButtons();
        };
    }
    
    function handleImageStateChange() {
        originalAspectRatio = editedImage.width / editedImage.height;
        updateCanvas(editedImage);
        updateResizeInputs();
        cropRect = { startX: 0, startY: 0, width: 0, height: 0 };
        applyCropBtn.disabled = true;
        updateCropInputs();
        redrawCanvasWithOverlay();
        updateEstimatedSize();
    }

    // --- TAB LOGIC ---

    function activateTab(activeTab) {
        isCropping = activeTab === 'crop';
        tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === activeTab));
        tabContents.forEach(content => content.classList.toggle('active', content.id === `${activeTab}-controls`));
        redrawCanvasWithOverlay(); 
    }

    // --- RESIZE LOGIC ---
    
    function handleDimensionChange(changed) {
        if (!aspectRatioLock.checked) return;
        const width = parseInt(widthInput.value);
        const height = parseInt(heightInput.value);

        if (changed === 'width' && width > 0) {
            heightInput.value = Math.round(width / originalAspectRatio);
        } else if (changed === 'height' && height > 0) {
            widthInput.value = Math.round(height * originalAspectRatio);
        }
    }
    
    function applyResize() {
        const width = parseInt(widthInput.value);
        const height = parseInt(heightInput.value);

        if (width <= 0 || height <= 0 || !width || !height) {
            alert('Please enter valid dimensions.');
            return;
        }
        
        saveState();

        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = width;
        tempCanvas.height = height;
        tempCtx.drawImage(editedImage, 0, 0, width, height);

        editedImage.src = tempCanvas.toDataURL();
        editedImage.onload = handleImageStateChange;
    }
    
    // --- CROP LOGIC ---
    
    function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        return {
          x: (e.clientX - rect.left) * (canvas.width / rect.width),
          y: (e.clientY - rect.top) * (canvas.height / rect.height)
        };
    }

    function startCrop(e) {
        if (!isCropping) return;
        isDragging = true;
        const pos = getMousePos(e);
        cropRect.startX = pos.x;
        cropRect.startY = pos.y;
        cropRect.width = 0;
        cropRect.height = 0;
        applyCropBtn.disabled = true;
    }
    
    function dragCrop(e) {
        if (!isCropping || !isDragging) return;
        const pos = getMousePos(e);
        cropRect.width = pos.x - cropRect.startX;
        cropRect.height = pos.y - cropRect.startY;
        redrawCanvasWithOverlay();
        updateCropInputs();
    }
    
    function endCrop() {
        if (!isCropping || !isDragging) return;
        isDragging = false;
        if (Math.abs(cropRect.width) > 10 && Math.abs(cropRect.height) > 10) {
           applyCropBtn.disabled = false;
        } else {
           applyCropBtn.disabled = true;
           cropRect = { startX: 0, startY: 0, width: 0, height: 0 };
           updateCropInputs();
           redrawCanvasWithOverlay();
        }
    }
    
    function updateCropInputs() {
        cropXInput.value = Math.round(cropRect.width > 0 ? cropRect.startX : cropRect.startX + cropRect.width);
        cropYInput.value = Math.round(cropRect.height > 0 ? cropRect.startY : cropRect.startY + cropRect.height);
        cropWidthInput.value = Math.round(Math.abs(cropRect.width));
        cropHeightInput.value = Math.round(Math.abs(cropRect.height));
    }
    
    function handleCropInputChange() {
        const x = parseInt(cropXInput.value) || 0;
        const y = parseInt(cropYInput.value) || 0;
        const w = parseInt(cropWidthInput.value) || 0;
        const h = parseInt(cropHeightInput.value) || 0;
        
        cropRect = { startX: x, startY: y, width: w, height: h };
        applyCropBtn.disabled = w <= 0 || h <= 0;
        redrawCanvasWithOverlay();
    }

    function redrawCanvasWithOverlay() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(editedImage, 0, 0, canvas.width, canvas.height);

        if (!isCropping || cropRect.width === 0 || cropRect.height === 0 ) return;

        const x = cropRect.width > 0 ? cropRect.startX : cropRect.startX + cropRect.width;
        const y = cropRect.height > 0 ? cropRect.startY : cropRect.startY + cropRect.height;
        const width = Math.abs(cropRect.width);
        const height = Math.abs(cropRect.height);

        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.clearRect(x, y, width, height);

        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
    }
    
    function applyCrop() {
        if (Math.abs(cropRect.width) < 1 || Math.abs(cropRect.height) < 1) return;
        
        saveState();
        
        const x = cropRect.width > 0 ? cropRect.startX : cropRect.startX + cropRect.width;
        const y = cropRect.height > 0 ? cropRect.startY : cropRect.startY + cropRect.height;
        const width = Math.abs(cropRect.width);
        const height = Math.abs(cropRect.height);

        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        tempCanvas.width = width;
        tempCanvas.height = height;
        
        tempCtx.drawImage(editedImage, x, y, width, height, 0, 0, width, height);
        
        editedImage.src = tempCanvas.toDataURL();
        editedImage.onload = handleImageStateChange;
    }

    // --- EXPORT LOGIC ---
    
    function toggleQualitySlider() {
        const format = formatSelect.value;
        qualityControl.style.display = (format === 'image/jpeg' || format === 'image/webp') ? 'flex' : 'none';
    }
    
    const debouncedUpdateSize = debounce(updateEstimatedSize, 250);

    function updateEstimatedSize() {
        const format = formatSelect.value;
        const quality = (format === 'image/jpeg' || format === 'image/webp') ? parseFloat(qualitySlider.value) : undefined;

        const dataUrl = canvas.toDataURL(format, quality);
        const head = `data:${format};base64,`;
        const bytes = Math.round((dataUrl.length - head.length) * 3 / 4);

        if (bytes > 1024 * 1024) {
            estimatedSizeEl.textContent = `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        } else if (bytes > 1024) {
            estimatedSizeEl.textContent = `${(bytes / 1024).toFixed(1)} KB`;
        } else {
            estimatedSizeEl.textContent = `${bytes} Bytes`;
        }
    }

    function downloadImage() {
        const format = formatSelect.value;
        const quality = parseFloat(qualitySlider.value);
        const extension = format.split('/')[1];
        
        const dataUrl = canvas.toDataURL(format, quality);
        
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `edited-image.${extension}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Initial setup
    toggleQualitySlider();
});
