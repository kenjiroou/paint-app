const canvas = document.getElementById('paintCanvas');
const ctx = canvas.getContext('2d');

const colorPicker = document.getElementById('colorPicker');
const colorPreview = document.getElementById('colorPreview');
const sizeSlider = document.getElementById('sizeSlider');
const sizeValue = document.getElementById('sizeValue');
const opacitySlider = document.getElementById('opacitySlider');
const opacityValue = document.getElementById('opacityValue');
const fillToggle = document.getElementById('fillToggle');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const addLayerBtn = document.getElementById('addLayerBtn');
const layersList = document.getElementById('layersList');
const toolButtons = document.querySelectorAll('.tool-btn');

let layers = [];
let activeLayerIndex = 0;
let selectedTool = 'brush';
let brushSize = Number(sizeSlider.value);
let opacity = Number(opacitySlider.value) / 100;
let currentColor = colorPicker.value;
let drawingSession = null;
let history = [];
let historyIndex = -1;

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const full = value.length === 3
    ? value.split('').map((char) => char + char).join('')
    : value;
  const num = Number.parseInt(full, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function createLayer(name) {
  const layerCanvas = document.createElement('canvas');
  layerCanvas.width = canvas.width;
  layerCanvas.height = canvas.height;
  const layerContext = layerCanvas.getContext('2d');

  layerContext.clearRect(0, 0, layerCanvas.width, layerCanvas.height);

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    visible: true,
    locked: false,
    opacity: 1,
    canvas: layerCanvas,
    context: layerContext,
  };
}

function getActiveLayer() {
  return layers[activeLayerIndex] || null;
}

function syncToolButtons() {
  toolButtons.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tool === selectedTool);
  });
}

function updateColorUI() {
  colorPreview.style.background = currentColor;
}

function updateSizeUI() {
  sizeValue.textContent = String(brushSize);
}

function updateOpacityUI() {
  opacityValue.textContent = `${Math.round(opacity * 100)}%`;
}

function renderCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  layers.forEach((layer) => {
    if (!layer.visible) return;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  });
}

function renderLayersList() {
  layersList.innerHTML = '';

  layers.forEach((layer, index) => {
    const item = document.createElement('div');
    item.className = `layer-item ${index === activeLayerIndex ? 'selected' : ''} ${layer.visible ? '' : 'hidden'}`;
    item.dataset.index = String(index);

    item.innerHTML = `
      <div class="layer-main">
        <span class="layer-dot"></span>
        <span class="layer-name">${layer.name}</span>
      </div>
      <div class="layer-actions">
        <button type="button" data-action="toggle-visible" title="Toggle visibility">${layer.visible ? '👁' : '🚫'}</button>
        <button type="button" data-action="toggle-lock" title="Toggle lock">${layer.locked ? '🔒' : '🔓'}</button>
        <button type="button" data-action="move-up" title="Move up">▲</button>
        <button type="button" data-action="move-down" title="Move down">▼</button>
        <button type="button" data-action="duplicate" title="Duplicate">⧉</button>
        <button type="button" data-action="delete" class="danger" title="Delete">🗑</button>
      </div>
    `;

    item.addEventListener('click', (event) => {
      const actionTarget = event.target.closest('[data-action]');
      if (actionTarget) {
        const action = actionTarget.dataset.action;
        handleLayerAction(index, action);
        return;
      }
      activeLayerIndex = index;
      renderLayersList();
      renderCanvas();
    });

    layersList.appendChild(item);
  });
}

function handleLayerAction(index, action) {
  const layer = layers[index];
  if (!layer) return;

  switch (action) {
    case 'toggle-visible':
      layer.visible = !layer.visible;
      break;
    case 'toggle-lock':
      layer.locked = !layer.locked;
      break;
    case 'move-up':
      if (index < layers.length - 1) {
        [layers[index], layers[index + 1]] = [layers[index + 1], layers[index]];
        activeLayerIndex = index + 1;
      }
      break;
    case 'move-down':
      if (index > 0) {
        [layers[index], layers[index - 1]] = [layers[index - 1], layers[index]];
        activeLayerIndex = index - 1;
      }
      break;
    case 'duplicate': {
      const original = layers[index];
      const clone = createLayer(`${original.name} copy`);
      clone.context.drawImage(original.canvas, 0, 0);
      layers.splice(index + 1, 0, clone);
      activeLayerIndex = index + 1;
      break;
    }
    case 'delete':
      if (layers.length === 1) return;
      layers.splice(index, 1);
      activeLayerIndex = Math.min(activeLayerIndex, layers.length - 1);
      break;
    default:
      break;
  }

  pushHistory();
  renderLayersList();
  renderCanvas();
}

function getPointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function addLayer() {
  const layer = createLayer(`Layer ${layers.length + 1}`);
  layers.push(layer);
  activeLayerIndex = layers.length - 1;
  pushHistory();
  renderLayersList();
  renderCanvas();
}

function commitHistory() {
  pushHistory();
  updateUndoRedoState();
}

function captureSnapshot() {
  return layers.map((layer) => {
    const data = layer.canvas.toDataURL('image/png');
    return {
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      data,
    };
  });
}

function pushHistory() {
  const snapshot = captureSnapshot();
  const previous = history[historyIndex];

  if (previous && JSON.stringify(previous) === JSON.stringify(snapshot)) {
    return;
  }

  history = history.slice(0, historyIndex + 1);
  history.push(snapshot);
  if (history.length > 35) history.shift();
  historyIndex = history.length - 1;
  updateUndoRedoState();
}

function applySnapshot(snapshot) {
  snapshot.forEach((item, index) => {
    if (!layers[index]) return;
    const layer = layers[index];
    layer.name = item.name;
    layer.visible = item.visible;
    layer.locked = item.locked;
    layer.opacity = item.opacity;

    const image = new Image();
    image.onload = () => {
      layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      layer.context.drawImage(image, 0, 0, layer.canvas.width, layer.canvas.height);
      renderCanvas();
    };
    image.src = item.data;
  });
  renderLayersList();
}

function undo() {
  if (historyIndex <= 0) return;
  historyIndex -= 1;
  const snapshot = history[historyIndex];
  applySnapshot(snapshot);
  updateUndoRedoState();
}

function redo() {
  if (historyIndex >= history.length - 1) return;
  historyIndex += 1;
  const snapshot = history[historyIndex];
  applySnapshot(snapshot);
  updateUndoRedoState();
}

function updateUndoRedoState() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
}

function setBrushStyle(context, strokeColor) {
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = strokeColor;
  context.lineWidth = brushSize;
}

function drawBrushStroke(start, end) {
  const layer = getActiveLayer();
  if (!layer || layer.locked) return;

  const context = layer.context;
  context.save();
  if (selectedTool === 'eraser') {
    context.globalCompositeOperation = 'destination-out';
    context.lineWidth = brushSize * 2;
  } else {
    context.globalCompositeOperation = 'source-over';
    context.lineWidth = brushSize;
    context.strokeStyle = hexToRgba(currentColor, opacity);
  }
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
  context.restore();
}

function drawShapeOnContext(context, start, end, fillShape) {
  const strokeColor = hexToRgba(currentColor, opacity);
  const lineWidth = brushSize;

  context.save();
  context.lineWidth = lineWidth;
  context.strokeStyle = strokeColor;
  context.fillStyle = strokeColor;

  if (selectedTool === 'line') {
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }

  if (selectedTool === 'rectangle') {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    if (fillShape) {
      context.fillRect(x, y, width, height);
    } else {
      context.strokeRect(x, y, width, height);
    }
  }

  if (selectedTool === 'circle') {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    const cx = start.x;
    const cy = start.y;
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    if (fillShape) {
      context.fill();
    } else {
      context.stroke();
    }
  }

  context.restore();
}

function previewShape(start, end) {
  renderCanvas();

  const active = getActiveLayer();
  if (!active || active.locked) return;

  const previewCtx = ctx;
  previewCtx.save();
  previewCtx.lineWidth = brushSize;
  previewCtx.strokeStyle = hexToRgba(currentColor, opacity);
  previewCtx.fillStyle = hexToRgba(currentColor, opacity);

  if (selectedTool === 'line') {
    previewCtx.beginPath();
    previewCtx.moveTo(start.x, start.y);
    previewCtx.lineTo(end.x, end.y);
    previewCtx.stroke();
  }

  if (selectedTool === 'rectangle') {
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    if (fillToggle.checked) {
      previewCtx.fillRect(x, y, width, height);
    } else {
      previewCtx.strokeRect(x, y, width, height);
    }
  }

  if (selectedTool === 'circle') {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const radius = Math.sqrt(dx * dx + dy * dy);
    previewCtx.beginPath();
    previewCtx.arc(start.x, start.y, radius, 0, Math.PI * 2);
    if (fillToggle.checked) {
      previewCtx.fill();
    } else {
      previewCtx.stroke();
    }
  }

  previewCtx.restore();
}

function onPointerDown(event) {
  const pos = getPointerPosition(event);
  const layer = getActiveLayer();
  if (!layer || layer.locked) return;

  if (selectedTool === 'fill') {
    layer.context.fillStyle = hexToRgba(currentColor, opacity);
    layer.context.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
    commitHistory();
    renderCanvas();
    return;
  }

  if (selectedTool === 'brush' || selectedTool === 'eraser') {
    drawingSession = { type: 'stroke', last: pos };
    drawBrushStroke(pos, pos);
    renderCanvas();
    return;
  }

  drawingSession = { type: 'shape', start: pos, current: pos };
}

function onPointerMove(event) {
  if (!drawingSession) return;

  const pos = getPointerPosition(event);

  if (drawingSession.type === 'stroke') {
    drawBrushStroke(drawingSession.last, pos);
    drawingSession.last = pos;
    renderCanvas();
    return;
  }

  if (drawingSession.type === 'shape') {
    drawingSession.current = pos;
    previewShape(drawingSession.start, pos);
  }
}

function onPointerUp() {
  if (!drawingSession) return;

  if (drawingSession.type === 'shape') {
    const layer = getActiveLayer();
    if (layer && !layer.locked) {
      const ctxLayer = layer.context;
      drawShapeOnContext(ctxLayer, drawingSession.start, drawingSession.current, fillToggle.checked);
      renderCanvas();
    }
  }

  commitHistory();
  drawingSession = null;
}

function clearActiveLayer() {
  const layer = getActiveLayer();
  if (!layer || layer.locked) return;

  layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  renderCanvas();
  commitHistory();
}

function savePng() {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const exportCtx = exportCanvas.getContext('2d');

  exportCtx.fillStyle = '#ffffff';
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

  layers.forEach((layer) => {
    if (!layer.visible) return;
    exportCtx.save();
    exportCtx.globalAlpha = layer.opacity;
    exportCtx.drawImage(layer.canvas, 0, 0);
    exportCtx.restore();
  });

  const link = document.createElement('a');
  link.download = 'painting.png';
  link.href = exportCanvas.toDataURL('image/png');
  link.click();
}

function init() {
  colorPicker.addEventListener('input', (event) => {
    currentColor = event.target.value;
    updateColorUI();
  });

  sizeSlider.addEventListener('input', (event) => {
    brushSize = Number(event.target.value);
    updateSizeUI();
  });

  opacitySlider.addEventListener('input', (event) => {
    opacity = Number(event.target.value) / 100;
    updateOpacityUI();
  });

  toolButtons.forEach((button) => {
    button.addEventListener('click', () => {
      selectedTool = button.dataset.tool;
      syncToolButtons();
    });
  });

  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);
  clearBtn.addEventListener('click', clearActiveLayer);
  saveBtn.addEventListener('click', savePng);
  addLayerBtn.addEventListener('click', addLayer);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointerleave', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      undo();
    }
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
      event.preventDefault();
      redo();
    }
  });

  layers = [createLayer('Layer 1')];
  activeLayerIndex = 0;
  renderLayersList();
  renderCanvas();
  updateColorUI();
  updateSizeUI();
  updateOpacityUI();
  syncToolButtons();
  pushHistory();
  updateUndoRedoState();
}

init();

window.addEventListener('resize', renderCanvas);

export { createLayer, layers };

// End of file
































































































































































































































































n
