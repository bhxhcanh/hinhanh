/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import * as bodySegmentation from '@tensorflow-models/body-segmentation';
import '@tensorflow/tfjs-backend-webgl';
import * as tf from '@tensorflow/tfjs-core';

document.addEventListener('DOMContentLoaded', async () => {
    // Thiết lập backend WebGL cho TensorFlow.js để tăng tốc độ xử lý bằng GPU
    await tf.setBackend('webgl');

    // DOM Elements
    const uploaderSection = document.getElementById('uploader');
    const editorSection = document.getElementById('editor');
    const uploadInput = document.getElementById('upload-input');
    const uploadLabel = document.querySelector('.upload-label');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');

    const tabs = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    // All controls that can be disabled
    const allControls = document.querySelectorAll('.action-btn, .secondary-btn, .reset-btn, input, select');

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

    // Background Removal controls
    const applyRemoveBgBtn = document.getElementById('apply-remove-bg-btn');
    const removeBgLoader = document.getElementById('remove-bg-loader');

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
    let currentImage = null; // Use 'currentImage' to hold the current Image object
    let originalAspectRatio = 1;
    let isCropping = false;
    let isDragging = false;
    let cropRect = { startX: 0, startY: 0, width: 0, height: 0 };
    
    // History State
    let historyStack = [];
    let redoStack = [];

    // AI Model
    let segmenter; // Cache the model for performance
    
    // --- CORE IMAGE HANDLING & UTILITIES ---

    /**
     * Tải một ảnh từ một nguồn (URL dữ liệu) và trả về một Promise.
     * Giải quyết race condition bằng cách đảm bảo ảnh được tải hoàn toàn trước khi tiếp tục.
     * @param {string} src - Nguồn ảnh (data URL).
     * @returns {Promise<HTMLImageElement>}
     */
    const loadImage = (src) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = (err) => reject(new Error('Không thể tải ảnh. Tệp có thể bị hỏng.', { cause: err }));
            img.src = src;
        });
    };

    /**
     * Vô hiệu hóa hoặc kích hoạt tất cả các nút điều khiển để ngăn ngừa lỗi.
     * @param {boolean} enabled - True để kích hoạt, false để vô hiệu hóa.
     */
    const setControlsEnabled = (enabled) => {
        allControls.forEach(control => {
            control.disabled = !enabled;
        });
        // Luôn giữ nút "Tải ảnh mới" được kích hoạt
        resetBtn.disabled = false;
        // Cập nhật trạng thái cho các nút undo/redo một cách riêng biệt
        if (enabled) {
            updateUndoRedoButtons();
        }
    };
    
    const debounce = (func, delay) => {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    };

    // --- UPLOAD & INITIALIZATION ---

    const handleFileUpload = async (file) => {
        if (!file || !file.type.startsWith('image/')) {
            alert('Vui lòng chọn một tệp ảnh hợp lệ.');
            return;
        }
        
        setControlsEnabled(false);
        try {
            const reader = new FileReader();
            const dataUrl = await new Promise((resolve, reject) => {
                reader.onload = e => resolve(e.target.result);
                reader.onerror = err => reject(new Error('Đã xảy ra lỗi khi đọc tệp.', { cause: err }));
                reader.readAsDataURL(file);
            });
            
            const newImage = await loadImage(dataUrl);

            // Thêm bước kiểm tra để đảm bảo ảnh hợp lệ
            if (!newImage.naturalWidth || !newImage.naturalHeight) {
                throw new Error("Tệp ảnh không hợp lệ hoặc bị hỏng và không thể được hiển thị.");
            }

            setupEditor(newImage, true);

        } catch (error) {
            console.error(error);
            alert(error.message);
            resetEditor();
        } finally {
            setControlsEnabled(true);
        }
    };
    
    const setupEditor = (image, isNewUpload = false) => {
        currentImage = image;
        
        handleImageStateChange();

        if (isNewUpload) {
            uploaderSection.classList.add('hidden');
            editorSection.classList.remove('hidden');
            activateTab('resize');
            historyStack = [];
            redoStack = [];
        }
        updateUndoRedoButtons();
    };
    
    const resetEditor = () => {
        uploaderSection.classList.remove('hidden');
        editorSection.classList.add('hidden');
        uploadInput.value = ''; // Clear file input
        currentImage = null;
        isCropping = false;
        historyStack = [];
        redoStack = [];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    // --- EVENT LISTENERS ---

    uploadInput.addEventListener('change', (e) => handleFileUpload(e.target.files[0]));
    uploadLabel.addEventListener('dragover', (e) => { e.preventDefault(); uploadLabel.classList.add('dragover'); });
    uploadLabel.addEventListener('dragleave', () => uploadLabel.classList.remove('dragover'));
    uploadLabel.addEventListener('drop', (e) => { e.preventDefault(); uploadLabel.classList.remove('dragover'); handleFileUpload(e.dataTransfer.files[0]); });
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
    applyRemoveBgBtn.addEventListener('click', applyBackgroundRemoval);
    formatSelect.addEventListener('change', () => { toggleQualitySlider(); updateEstimatedSize(); });
    qualitySlider.addEventListener('input', () => { qualityValue.textContent = qualitySlider.value; debouncedUpdateSize(); });
    downloadBtn.addEventListener('click', downloadImage);
    resetBtn.addEventListener('click', resetEditor);
    undoBtn.addEventListener('click', undo);
    redoBtn.addEventListener('click', redo);


    // --- HISTORY (UNDO/REDO) LOGIC ---
    
    function saveState() {
        if (!currentImage) return;
        redoStack = []; // Clear redo stack on new action
        historyStack.push(currentImage.src);
        if(historyStack.length > 20) { // Limit history size
            historyStack.shift();
        }
        updateUndoRedoButtons();
    }
    
    function updateUndoRedoButtons() {
        undoBtn.disabled = historyStack.length === 0;
        redoBtn.disabled = redoStack.length === 0;
    }

    async function undo() {
        if (historyStack.length === 0) return;
        setControlsEnabled(false);
        try {
            redoStack.push(currentImage.src);
            const prevStateSrc = historyStack.pop();
            const prevImage = await loadImage(prevStateSrc);
            setupEditor(prevImage);
        } catch (error) {
            console.error("Lỗi hoàn tác:", error);
            alert("Không thể hoàn tác. Dữ liệu ảnh trước đó có thể bị lỗi.");
            // Restore state on failure
            historyStack.push(redoStack.pop());
        } finally {
            setControlsEnabled(true);
        }
    }
    
    async function redo() {
        if (redoStack.length === 0) return;
        setControlsEnabled(false);
        try {
            historyStack.push(currentImage.src);
            const nextStateSrc = redoStack.pop();
            const nextImage = await loadImage(nextStateSrc);
            setupEditor(nextImage);
        } catch(error) {
            console.error("Lỗi làm lại:", error);
            alert("Không thể làm lại. Dữ liệu ảnh có thể bị lỗi.");
            // Restore state on failure
            redoStack.push(historyStack.pop());
        } finally {
            setControlsEnabled(true);
        }
    }
    
    function handleImageStateChange() {
        if (!currentImage) return;
        originalAspectRatio = currentImage.naturalWidth / currentImage.naturalHeight;
        
        canvas.width = currentImage.naturalWidth;
        canvas.height = currentImage.naturalHeight;
        
        widthInput.value = currentImage.naturalWidth.toString();
        heightInput.value = currentImage.naturalHeight.toString();
        
        cropRect = { startX: 0, startY: 0, width: 0, height: 0 };
        applyCropBtn.disabled = true;
        updateCropInputs();
        
        redrawCanvasWithOverlay(); // This is now the single source of truth for drawing
        updateEstimatedSize();
        updateUndoRedoButtons();
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
            heightInput.value = Math.round(width / originalAspectRatio).toString();
        } else if (changed === 'height' && height > 0) {
            widthInput.value = Math.round(height * originalAspectRatio).toString();
        }
    }
    
    async function applyResize() {
        const width = parseInt(widthInput.value);
        const height = parseInt(heightInput.value);

        if (!width || !height || width <= 0 || height <= 0) {
            alert('Vui lòng nhập kích thước hợp lệ.');
            return;
        }
        
        setControlsEnabled(false);
        try {
            saveState();

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(currentImage, 0, 0, width, height);
            
            const dataUrl = tempCanvas.toDataURL();
            const newImage = await loadImage(dataUrl);
            setupEditor(newImage);

        } catch (error) {
            console.error("Lỗi thay đổi kích thước:", error);
            alert("Đã xảy ra lỗi khi thay đổi kích thước ảnh.");
        } finally {
            setControlsEnabled(true);
        }
    }
    
    // --- CROP LOGIC ---
    
    function getMousePos(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY
        };
    }

    function startCrop(e) {
        if (!isCropping) return;
        e.preventDefault();
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
        e.preventDefault();
        const pos = getMousePos(e);
        cropRect.width = pos.x - cropRect.startX;
        cropRect.height = pos.y - cropRect.startY;
        redrawCanvasWithOverlay();
        updateCropInputs();
    }
    
    function endCrop() {
        if (!isCropping || !isDragging) return;
        isDragging = false;
        if (Math.abs(cropRect.width) > 5 && Math.abs(cropRect.height) > 5) {
           applyCropBtn.disabled = false;
        } else {
           applyCropBtn.disabled = true;
           cropRect = { startX: 0, startY: 0, width: 0, height: 0 };
           updateCropInputs();
           redrawCanvasWithOverlay();
        }
    }
    
    function updateCropInputs() {
        const x = cropRect.width >= 0 ? cropRect.startX : cropRect.startX + cropRect.width;
        const y = cropRect.height >= 0 ? cropRect.startY : cropRect.startY + cropRect.height;
        cropXInput.value = Math.round(x).toString();
        cropYInput.value = Math.round(y).toString();
        cropWidthInput.value = Math.round(Math.abs(cropRect.width)).toString();
        cropHeightInput.value = Math.round(Math.abs(cropRect.height)).toString();
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
        if (!currentImage) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);

        if (!isCropping || Math.abs(cropRect.width) < 1 || Math.abs(cropRect.height) < 1) return;

        const x = cropRect.width >= 0 ? cropRect.startX : cropRect.startX + cropRect.width;
        const y = cropRect.height >= 0 ? cropRect.startY : cropRect.startY + cropRect.height;
        const width = Math.abs(cropRect.width);
        const height = Math.abs(cropRect.height);

        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.clearRect(x, y, width, height);
        ctx.strokeStyle = '#007bff';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        ctx.restore();
    }
    
    async function applyCrop() {
        const w = Math.abs(cropRect.width);
        const h = Math.abs(cropRect.height);
        if (w < 1 || h < 1) return;
        
        setControlsEnabled(false);
        try {
            saveState();

            const x = cropRect.width >= 0 ? cropRect.startX : cropRect.startX + cropRect.width;
            const y = cropRect.height >= 0 ? cropRect.startY : cropRect.startY + cropRect.height;

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = w;
            tempCanvas.height = h;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.drawImage(currentImage, x, y, w, h, 0, 0, w, h);
            
            const dataUrl = tempCanvas.toDataURL();
            const newImage = await loadImage(dataUrl);
            setupEditor(newImage);

        } catch (error) {
            console.error("Lỗi cắt ảnh:", error);
            alert("Đã xảy ra lỗi khi cắt ảnh.");
        } finally {
            setControlsEnabled(true);
        }
    }

    // --- BACKGROUND REMOVAL (CLIENT-SIDE) ---
    
    async function initializeSegmenter() {
        if (segmenter) return;
        const model = bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation;
        const segmenterConfig = {
            runtime: 'mediapipe', 
            solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation',
            modelType: 'general'
        };
        segmenter = await bodySegmentation.createSegmenter(model, segmenterConfig);
    }
    
    async function applyBackgroundRemoval() {
        setControlsEnabled(false);
        removeBgLoader.classList.remove('hidden');

        try {
            await initializeSegmenter(); 
            const segmentation = await segmenter.segmentPeople(currentImage);
            if (!segmentation || segmentation.length === 0) {
                throw new Error("Không thể nhận dạng được chủ thể trong ảnh.");
            }
            
            const foregroundColor = {r: 255, g: 255, b: 255, a: 255};
            const backgroundColor = {r: 0, g: 0, b: 0, a: 0};
            const binaryMask = await bodySegmentation.toBinaryMask(segmentation, foregroundColor, backgroundColor);
            
            saveState();

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = currentImage.naturalWidth;
            tempCanvas.height = currentImage.naturalHeight;
            const tempCtx = tempCanvas.getContext('2d');

            tempCtx.drawImage(currentImage, 0, 0);
            tempCtx.globalCompositeOperation = 'destination-in';
            tempCtx.drawImage(binaryMask, 0, 0);
            
            const dataUrl = tempCanvas.toDataURL('image/png');
            const newImage = await loadImage(dataUrl);
            setupEditor(newImage);

        } catch (error) {
            console.error('Lỗi xóa nền:', error);
            alert('Không thể xóa nền. Vui lòng thử lại. Lỗi: ' + error.message);
        } finally {
            removeBgLoader.classList.add('hidden');
            setControlsEnabled(true);
        }
    }


    // --- EXPORT LOGIC ---
    
    function toggleQualitySlider() {
        const format = formatSelect.value;
        qualityControl.style.display = (format === 'image/jpeg' || format === 'image/webp') ? 'flex' : 'none';
    }
    
    const debouncedUpdateSize = debounce(updateEstimatedSize, 250);

    function updateEstimatedSize() {
        if (!currentImage) {
            estimatedSizeEl.textContent = '...';
            return;
        }

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
        link.download = `da-chinh-sua.${extension}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // Initial setup
    toggleQualitySlider();
});
