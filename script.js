const canvas = document.getElementById('paintCanvas');
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const colorValue = document.getElementById('colorValue');
const sizeSlider = document.getElementById('sizeSlider');
const sizeValue = document.getElementById('sizeValue');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const toolButtons = document.querySelectorAll('.tool-button');

let drawing = false;
let mode = 'brush';
let currentColor = colorPicker.value;
let brushSize = Number(sizeSlider.value);
let history = [];
let historyIndex = -1;

function setCanvasBackground() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function updateColorText() {
  colorValue.textContent = currentColor.toUpperCase();
}

function updateSizeText() {
  sizeValue.textContent = `${brushSize} px`;
}

function syncToolButtons() {
  toolButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === mode);
  });
}

function resetCanvas() {
  setCanvasBackground();
  history = [];
  historyIndex = -1;
  pushHistory();
  updateUndoRedoState();
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function prepareStrokeStyle() {
  if (mode === 'eraser') {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = brushSize * 2;
  } else {
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = brushSize;
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function startDrawing(event) {
  drawing = true;
  const point = getCanvasPoint(event);
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(point.x, point.y);
  prepareStrokeStyle();
  ctx.stroke();
}

function draw(event) {
  if (!drawing) return;

  const point = getCanvasPoint(event);
  prepareStrokeStyle();
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function stopDrawing() {
  if (!drawing) return;

  drawing = false;
  ctx.beginPath();
  pushHistory();
  updateUndoRedoState();
}

function pushHistory() {
  const snapshot = canvas.toDataURL();
  const isDuplicate = history[historyIndex] === snapshot;

  if (isDuplicate) {
    return;
  }

  history = history.slice(0, historyIndex + 1);
  history.push(snapshot);
  if (history.length > 30) {
    history.shift();
  }
  historyIndex = history.length - 1;
}

function updateUndoRedoState() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
}

function restoreFromHistory(index) {
  if (index < 0 || index >= history.length) return;

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  img.src = history[index];
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  restoreFromHistory(historyIndex);
  updateUndoRedoState();
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex += 1;
  restoreFromHistory(historyIndex);
  updateUndoRedoState();
}

function clearCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  setCanvasBackground();
  pushHistory();
  updateUndoRedoState();
}

function saveCanvasPng() {
  const link = document.createElement('a');
  link.download = 'painting.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

colorPicker.addEventListener('input', (event) => {
  currentColor = event.target.value;
  updateColorText();
});

sizeSlider.addEventListener('input', (event) => {
  brushSize = Number(event.target.value);
  updateSizeText();
});

toolButtons.forEach((button) => {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    syncToolButtons();
  });
});

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
clearBtn.addEventListener('click', clearCanvas);
saveBtn.addEventListener('click', saveCanvasPng);

canvas.addEventListener('pointerdown', startDrawing);
canvas.addEventListener('pointermove', draw);
canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointerleave', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);

updateColorText();
updateSizeText();
syncToolButtons();
resetCanvas();
