// script.js
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';

document.addEventListener('DOMContentLoaded', async () => {
  await tf.setBackend('webgl');

  const uploaderSection = document.getElementById('uploader');
  const editorSection = document.getElementById('editor');
  const uploadInput = document.getElementById('upload-input');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  const widthInput = document.getElementById('width-input');
  const heightInput = document.getElementById('height-input');
  const applyResizeBtn = document.getElementById('apply-resize-btn');
  const resetBtn = document.getElementById('reset-btn');
  const downloadBtn = document.getElementById('download-btn');

  let currentImage = null;

  const loadImage = (src) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = err => reject(err);
      img.src = src;
    });
  };

  const handleFileUpload = async (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      try {
        const img = await loadImage(dataUrl);
        currentImage = img;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        widthInput.value = img.naturalWidth;
        heightInput.value = img.naturalHeight;
        uploaderSection.classList.add('hidden');
        editorSection.classList.remove('hidden');
      } catch (err) {
        alert('Lỗi khi tải ảnh.');
      }
    };
    reader.readAsDataURL(file);
  };

  uploadInput.addEventListener('change', (e) => {
    handleFileUpload(e.target.files[0]);
  });

  applyResizeBtn.addEventListener('click', async () => {
    const width = parseInt(widthInput.value);
    const height = parseInt(heightInput.value);
    if (!width || !height) return;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(currentImage, 0, 0, width, height);
    const dataUrl = tempCanvas.toDataURL();
    const newImg = await loadImage(dataUrl);
    currentImage = newImg;
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(newImg, 0, 0);
  });

  resetBtn.addEventListener('click', () => {
    editorSection.classList.add('hidden');
    uploaderSection.classList.remove('hidden');
    uploadInput.value = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  downloadBtn.addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'image.png';
    link.click();
  });
});
