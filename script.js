const upload = document.getElementById('upload');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const widthInput = document.getElementById('width');
const heightInput = document.getElementById('height');
const qualityInput = document.getElementById('quality');
const formatInput = document.getElementById('format');
const downloadBtn = document.getElementById('download');

let originalImage = new Image();

upload.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    originalImage.onload = () => {
      canvas.width = originalImage.width;
      canvas.height = originalImage.height;
      ctx.drawImage(originalImage, 0, 0);
      widthInput.value = originalImage.width;
      heightInput.value = originalImage.height;
    };
    originalImage.src = reader.result;
  };
  reader.readAsDataURL(file);
});

function updateCanvas() {
  const width = parseInt(widthInput.value);
  const height = parseInt(heightInput.value);

  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(originalImage, 0, 0, width, height);
}

widthInput.addEventListener('input', updateCanvas);
heightInput.addEventListener('input', updateCanvas);

downloadBtn.addEventListener('click', () => {
  const quality = parseFloat(qualityInput.value);
  const format = formatInput.value;
  const dataUrl = canvas.toDataURL(format, quality);

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `edited_image.${format.split('/')[1]}`;
  link.click();

  // Gửi log (nếu có GAS)
  fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec', {
    method: 'POST',
    body: JSON.stringify({
      action: 'log',
      width: canvas.width,
      height: canvas.height,
      quality,
      format,
      time: new Date().toISOString(),
    }),
    headers: { 'Content-Type': 'application/json' },
  }).catch(err => console.warn('Không thể gửi log', err));
});
