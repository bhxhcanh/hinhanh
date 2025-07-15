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
        resetBtn.disabled = false;
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
            setupEditor(newImage, true); // true indicates a new upload

        } catch (error) {
            console.error(error);
            alert(error.message);
            resetEditor();
        } finally {
            setControlsEnabled(true);
        }
    };
    
    /**
     * **[ĐÃ SỬA]** Hàm trung tâm để thiết lập trình chỉnh sửa cho một ảnh mới.
     * Chịu trách nhiệm cập nhật canvas, điều khiển và lịch sử.
     * @param {HTMLImageElement} image - Đối tượng ảnh để hiển thị.
     * @param {boolean} isNewUpload - True nếu đây là ảnh mới tải lên.
     */
    const setupEditor = (image, isNewUpload = false) => {
        currentImage = image;

        // 1. Cập nhật canvas và các giá trị trạng thái dựa trên ảnh
        canvas.width = currentImage.naturalWidth;
        canvas.height = currentImage.naturalHeight;
        originalAspectRatio = canvas.width / canvas.height;
        widthInput.value = canvas.width;
        heightInput.value = canvas.height;

        // 2. Reset các điều khiển cắt ảnh
        cropRect = { startX: 0, startY: 0, width: 0, height: 0 };
        updateCropInputs();
        applyCropBtn.disabled = true;

        // 3. Xử lý UI và lịch sử cho lần tải lên mới
        if (isNewUpload) {
            uploaderSection.classList.add('hidden');
            editorSection.classList.remove('hidden');
            historyStack = [];
            redoStack = [];
            activateTab('resize'); // Kích hoạt tab mặc định, sẽ tự động vẽ lại canvas
        } else {
            // Đối với undo/redo hoặc các chỉnh sửa khác, chỉ cần vẽ lại canvas
            redrawCanvasWithOverlay();
        }
        
        // 4. Cập nhật các thành phần UI khác
        updateEstimatedSize();
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
            setupEditor(prevImage); // Luôn gọi hàm setupEditor trung tâm
        } catch (error) {
            console.error("Lỗi hoàn tác:", error);
            alert("Không thể hoàn tác. Dữ liệu ảnh trước đó có thể bị lỗi.");
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
            setupEditor(nextImage); // Luôn gọi hàm setupEditor trung tâm
        } catch(error) {
            console.error("Lỗi làm lại:", error);
            alert("Không thể làm lại. Dữ liệu ảnh có thể bị lỗi.");
            redoStack.push(historyStack.pop());
        } finally {
            setControlsEnabled(true);
        }
    }
    
    // --- [XÓA BỎ] Hàm handleImageStateChange() đã bị xóa vì logic của nó được tích hợp vào setupEditor ---

    // --- TAB LOGIC ---

    function activateTab(activeTab) {
        isCropping = activeTab === 'crop';
        tabs.forEach(tab => tab.classList.toggle('active', tab.dataset.tab === activeTab));
        tabContents.forEach(content => content.classList.toggle('active', content.id === `${activeTab}-controls`));
        redrawCanvasWithOverlay(); // Kích hoạt tab sẽ vẽ lại canvas
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
