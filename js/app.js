(function () {
  'use strict';

  const Paint = window.Paint;
  const { History, ColorPicker, floodFill, storage } = Paint;
  const { clamp, hexToRgb, rgbToHex, normalizeHex } = Paint.color;

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);

  const stage = $('stage');
  const view = $('viewCanvas');
  const vctx = view.getContext('2d');
  const toastEl = $('toast');

  const undoButtons = [$('undoBtn'), $('mUndoBtn')];
  const redoButtons = [$('redoBtn'), $('mRedoBtn')];
  const zoomLabel = $('zoomLabel');
  const saveStatus = $('saveStatus');
  const docTitle = $('docTitle');
  const toolButtons = Array.from(document.querySelectorAll('.tool-btn'));
  const optionGroups = Array.from(document.querySelectorAll('[data-opt]'));

  const opt = {
    brushType: $('optBrushType'),
    size: $('optSize'),
    sizeNum: $('optSizeNum'),
    opacity: $('optOpacity'),
    opacityNum: $('optOpacityNum'),
    strength: $('optStrength'),
    strengthValue: $('optStrengthValue'),
    stabilizer: $('optStabilizer'),
    stabilizerValue: $('optStabilizerValue'),
    pressure: $('optPressure'),
    fillShape: $('optFillShape'),
    tolerance: $('optTolerance'),
    toleranceValue: $('optToleranceValue'),
    expand: $('optExpand'),
    expandValue: $('optExpandValue'),
    reference: $('optReference'),
  };

  const layerList = $('layerList');
  const layerOpacity = $('layerOpacity');
  const layerOpacityValue = $('layerOpacityValue');
  const layerBlend = $('layerBlend');
  const layerClip = $('layerClip');
  const layerAlphaLock = $('layerAlphaLock');
  const layerLock = $('layerLock');

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  const TOOL_OPTIONS = {
    brush: ['brushType', 'size', 'opacity', 'stabilizer', 'pressure'],
    eraser: ['brushType', 'size', 'opacity', 'stabilizer', 'pressure'],
    blur: ['size', 'strength', 'stabilizer', 'pressure'],
    fill: ['opacity', 'tolerance', 'expand', 'reference'],
    eyedropper: ['pickHint'],
    line: ['size', 'opacity', 'shapeHint'],
    rect: ['size', 'opacity', 'fillShape', 'shapeHint'],
    ellipse: ['size', 'opacity', 'fillShape', 'shapeHint'],
    hand: ['handHint'],
  };

  const TOOL_KEYS = { b: 'brush', e: 'eraser', s: 'blur', g: 'fill', i: 'eyedropper', l: 'line', u: 'rect', o: 'ellipse', h: 'hand' };
  const STROKE_TOOLS = ['brush', 'eraser', 'blur'];
  const SHAPE_TOOLS = ['line', 'rect', 'ellipse'];

  const BLEND_MODES = [
    ['source-over', '通常'],
    ['multiply', '乗算'],
    ['screen', 'スクリーン'],
    ['overlay', 'オーバーレイ'],
    ['lighter', '加算・発光'],
    ['darken', '比較(暗)'],
    ['lighten', '比較(明)'],
    ['color-burn', '焼き込みカラー'],
    ['color-dodge', '覆い焼きカラー'],
    ['hard-light', 'ハードライト'],
    ['soft-light', 'ソフトライト'],
    ['difference', '差の絶対値'],
    ['exclusion', '除外'],
    ['hue', '色相'],
    ['saturation', '彩度'],
    ['color', 'カラー'],
    ['luminosity', '輝度'],
  ];
  const BLEND_LABELS = Object.fromEntries(BLEND_MODES);

  const DEFAULT_PALETTE = [
    '#000000', '#ffffff', '#6b7280', '#ef4444', '#f97316', '#facc15',
    '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#a16207',
    '#fde3cf', '#f5c6a5', '#1e3a8a', '#14532d',
  ];

  const DEFAULT_SETTINGS = {
    tool: 'brush',
    color: '#1f2937',
    pressure: true,
    fingerDraw: true,
    recent: [],
    palette: DEFAULT_PALETTE,
    tools: {
      brush: { brushType: 'pen', size: 8, opacity: 100, stabilizer: 3 },
      eraser: { brushType: 'pen', size: 24, opacity: 100, stabilizer: 2 },
      blur: { size: 40, strength: 4, stabilizer: 0 },
      fill: { opacity: 100, tolerance: 12, expand: 1, reference: 'layer' },
      line: { size: 4, opacity: 100 },
      rect: { size: 4, opacity: 100, fillShape: false },
      ellipse: { size: 4, opacity: 100, fillShape: false },
      eyedropper: {},
      hand: {},
    },
  };

  const SETTINGS_KEY = 'paint-app:settings';
  const MAX_ZOOM = 32;
  const MIN_ZOOM = 0.05;
  const MAX_SIZE = 200;
  const LONG_PRESS_MS = 450;
  const TAP_MS = 350;
  const TAP_MOVE = 12;

  const supportsFilter = (() => {
    const ctx = document.createElement('canvas').getContext('2d');
    return typeof ctx.filter === 'string';
  })();

  // ---------------------------------------------------------------------------
  // Settings (per-viewer conveniences, stored in localStorage)
  // ---------------------------------------------------------------------------

  function loadSettings() {
    const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        ['tool', 'color', 'pressure', 'fingerDraw'].forEach((key) => {
          if (key in saved) settings[key] = saved[key];
        });
        if (Array.isArray(saved.recent)) settings.recent = saved.recent.filter(normalizeHex).slice(0, 16);
        if (Array.isArray(saved.palette)) settings.palette = saved.palette.filter(normalizeHex).slice(0, 48);
        if (saved.tools) {
          Object.keys(settings.tools).forEach((name) => {
            Object.assign(settings.tools[name], saved.tools[name] || {});
          });
        }
      }
    } catch {
      // Storage can be blocked; defaults are fine.
    }
    if (!TOOL_OPTIONS[settings.tool]) settings.tool = 'brush';
    if (!normalizeHex(settings.color)) settings.color = DEFAULT_SETTINGS.color;
    return settings;
  }

  let settingsTimer = null;
  function saveSettings() {
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => {
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      } catch {
        // Ignore: settings are a convenience only.
      }
    }, 300);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  const settings = loadSettings();
  let tool = settings.tool;
  let currentColor = normalizeHex(settings.color);

  const doc = {
    name: '無題',
    width: 1280,
    height: 720,
    background: 'white',
    layers: [], // index 0 is the bottom layer
    activeId: null,
  };

  const viewState = { scale: 1, rotation: 0, cx: 0, cy: 0 };
  let stageW = 0;
  let stageH = 0;
  let stageRect = stage.getBoundingClientRect();
  let dpr = window.devicePixelRatio || 1;
  let hasFitted = false;

  let action = null; // current pointer interaction
  const touches = new Map();
  let tapState = null;
  let longPress = null;
  let spaceDown = false;
  let altDown = false;
  const hover = { x: 0, y: 0, visible: false, type: 'mouse' };
  let pickPreview = null;

  const history = new History(onHistoryChange);

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  // Document-sized work buffers.
  const composite = makeCanvas(1, 1);
  const compCtx = composite.getContext('2d');
  const strokeCanvas = makeCanvas(1, 1);
  const strokeCtx = strokeCanvas.getContext('2d');
  const liveCanvas = makeCanvas(1, 1);
  const liveCtx = liveCanvas.getContext('2d');
  const groupCanvas = makeCanvas(1, 1);
  const groupCtx = groupCanvas.getContext('2d');
  const clipCanvas = makeCanvas(1, 1);
  const clipCtx = clipCanvas.getContext('2d');

  function resizeBuffers() {
    [composite, strokeCanvas, liveCanvas, groupCanvas, clipCanvas].forEach((canvas) => {
      canvas.width = doc.width;
      canvas.height = doc.height;
    });
  }

  const checkerPattern = (() => {
    const tile = makeCanvas(16, 16);
    const ctx = tile.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(0, 0, 8, 8);
    ctx.fillRect(8, 8, 8, 8);
    return tile;
  })();

  // ---------------------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------------------

  let layerSeq = 0;

  function createLayer(name) {
    const canvas = makeCanvas(doc.width, doc.height);
    layerSeq += 1;
    return {
      id: `l${Date.now().toString(36)}${layerSeq.toString(36)}`,
      name,
      visible: true,
      locked: false,
      alphaLock: false,
      clip: false,
      opacity: 1,
      blend: 'source-over',
      canvas,
      ctx: canvas.getContext('2d'),
      thumbEl: null,
      thumbDirty: true,
    };
  }

  function nextLayerName() {
    let max = 0;
    doc.layers.forEach((layer) => {
      const match = /^レイヤー (\d+)$/.exec(layer.name);
      if (match) max = Math.max(max, Number(match[1]));
    });
    return `レイヤー ${max + 1}`;
  }

  function activeIndex() {
    const index = doc.layers.findIndex((layer) => layer.id === doc.activeId);
    return index === -1 ? doc.layers.length - 1 : index;
  }

  function activeLayer() {
    return doc.layers[activeIndex()];
  }

  // ---------------------------------------------------------------------------
  // Compositing
  // ---------------------------------------------------------------------------

  function isLiveLayer(layer) {
    return action && action.type === 'draw' && action.usesBuffer && action.layer === layer;
  }

  function applyStrokeBuffer(ctx, { erase, opacity, alphaLock }) {
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.globalCompositeOperation = erase ? 'destination-out' : alphaLock ? 'source-atop' : 'source-over';
    ctx.drawImage(strokeCanvas, 0, 0);
    ctx.restore();
  }

  // While a stroke is in progress, the active layer is shown as layer + stroke buffer.
  // The stroke is drawn opaque into the buffer and the opacity is applied once,
  // so overlapping segments do not create darker spots.
  function layerSource(layer, withLive) {
    if (withLive && transformSession && transformSession.layer === layer) {
      liveCtx.globalCompositeOperation = 'copy';
      liveCtx.globalAlpha = 1;
      liveCtx.drawImage(layer.canvas, 0, 0);
      liveCtx.globalCompositeOperation = 'source-over';
      drawFloating(liveCtx, transformSession, layer.alphaLock);
      return liveCanvas;
    }
    if (!withLive || !isLiveLayer(layer)) return layer.canvas;
    liveCtx.globalCompositeOperation = 'copy';
    liveCtx.globalAlpha = 1;
    liveCtx.drawImage(layer.canvas, 0, 0);
    liveCtx.globalCompositeOperation = 'source-over';
    applyStrokeBuffer(liveCtx, { erase: action.erase, opacity: action.opacity, alphaLock: layer.alphaLock });
    return liveCanvas;
  }

  function drawLayerImage(target, source, opacity, blend) {
    target.globalAlpha = opacity;
    target.globalCompositeOperation = blend;
    target.drawImage(source, 0, 0);
    target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over';
  }

  function composeInto(target, withLive) {
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over';
    target.clearRect(0, 0, doc.width, doc.height);

    const layers = doc.layers;
    let i = 0;
    while (i < layers.length) {
      const base = layers[i];
      let j = i + 1;
      while (j < layers.length && layers[j].clip) j += 1;

      if (base.visible && base.opacity > 0) {
        const baseSource = layerSource(base, withLive);
        const clips = layers.slice(i + 1, j).filter((layer) => layer.visible && layer.opacity > 0);
        if (clips.length === 0) {
          drawLayerImage(target, baseSource, base.opacity, base.blend);
        } else {
          groupCtx.globalAlpha = 1;
          groupCtx.globalCompositeOperation = 'copy';
          groupCtx.drawImage(baseSource, 0, 0);
          clips.forEach((clip) => {
            clipCtx.globalCompositeOperation = 'copy';
            clipCtx.globalAlpha = clip.opacity;
            clipCtx.drawImage(layerSource(clip, withLive), 0, 0);
            clipCtx.globalAlpha = 1;
            clipCtx.globalCompositeOperation = 'destination-in';
            clipCtx.drawImage(baseSource, 0, 0);
            groupCtx.globalCompositeOperation = clip.blend;
            groupCtx.drawImage(clipCanvas, 0, 0);
          });
          groupCtx.globalCompositeOperation = 'source-over';
          drawLayerImage(target, groupCanvas, base.opacity, base.blend);
        }
      }
      i = j;
    }
    target.restore();
  }

  let compositeDirty = true;
  function ensureComposite() {
    if (!compositeDirty) return;
    composeInto(compCtx, true);
    compositeDirty = false;
  }

  function invalidate() {
    compositeDirty = true;
    requestRender();
  }

  // ---------------------------------------------------------------------------
  // View transform
  // ---------------------------------------------------------------------------

  function viewMatrix() {
    const { scale, rotation, cx, cy } = viewState;
    const cos = Math.cos(rotation) * scale;
    const sin = Math.sin(rotation) * scale;
    const hx = doc.width / 2;
    const hy = doc.height / 2;
    return { a: cos, b: sin, c: -sin, d: cos, e: cx - (cos * hx - sin * hy), f: cy - (sin * hx + cos * hy) };
  }

  function screenToDoc(x, y) {
    const { scale, rotation, cx, cy } = viewState;
    const dx = x - cx;
    const dy = y - cy;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return {
      x: (cos * dx + sin * dy) / scale + doc.width / 2,
      y: (-sin * dx + cos * dy) / scale + doc.height / 2,
    };
  }

  function setViewAround(docPoint, screenPoint, scale, rotation) {
    viewState.scale = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    viewState.rotation = rotation;
    const cos = Math.cos(rotation) * viewState.scale;
    const sin = Math.sin(rotation) * viewState.scale;
    const dx = docPoint.x - doc.width / 2;
    const dy = docPoint.y - doc.height / 2;
    viewState.cx = screenPoint.x - (cos * dx - sin * dy);
    viewState.cy = screenPoint.y - (sin * dx + cos * dy);
    onViewChanged();
  }

  function zoomAt(screenPoint, factor) {
    const docPoint = screenToDoc(screenPoint.x, screenPoint.y);
    setViewAround(docPoint, screenPoint, viewState.scale * factor, viewState.rotation);
  }

  function stageCenter() {
    return { x: stageW / 2, y: stageH / 2 };
  }

  function fitView() {
    const pad = stageW < 600 ? 16 : 40;
    const scale = Math.min((stageW - pad * 2) / doc.width, (stageH - pad * 2) / doc.height);
    viewState.scale = clamp(scale, MIN_ZOOM, MAX_ZOOM);
    viewState.rotation = 0;
    viewState.cx = stageW / 2;
    viewState.cy = stageH / 2;
    onViewChanged();
  }

  function setZoom100() {
    zoomAt(stageCenter(), 1 / viewState.scale);
  }

  function rotateBy(degrees) {
    const center = stageCenter();
    const docPoint = screenToDoc(center.x, center.y);
    const next = snapRotation(viewState.rotation + (degrees * Math.PI) / 180);
    setViewAround(docPoint, center, viewState.scale, next);
  }

  function normalizeAngle(angle) {
    let a = angle % (Math.PI * 2);
    if (a > Math.PI) a -= Math.PI * 2;
    if (a <= -Math.PI) a += Math.PI * 2;
    return a;
  }

  function snapRotation(angle) {
    const a = normalizeAngle(angle);
    const quarter = Math.PI / 2;
    const nearest = Math.round(a / quarter) * quarter;
    return Math.abs(a - nearest) < (4 * Math.PI) / 180 ? normalizeAngle(nearest) : a;
  }

  function onViewChanged() {
    const percent = Math.round(viewState.scale * 100);
    const degrees = Math.round((viewState.rotation * 180) / Math.PI);
    zoomLabel.textContent = degrees ? `${percent}% ${degrees}°` : `${percent}%`;
    requestRender();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(render);
  }

  const stageBg = getComputedStyle(document.documentElement).getPropertyValue('--stage-bg').trim() || '#d9dde5';

  function render() {
    renderQueued = false;
    ensureComposite();

    vctx.setTransform(1, 0, 0, 1, 0, 0);
    vctx.fillStyle = stageBg;
    vctx.fillRect(0, 0, view.width, view.height);

    const m = viewMatrix();
    vctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.e, dpr * m.f);

    vctx.save();
    vctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
    vctx.shadowBlur = 18 * dpr;
    vctx.fillStyle = doc.background === 'white' ? '#ffffff' : vctx.createPattern(checkerPattern, 'repeat');
    vctx.fillRect(0, 0, doc.width, doc.height);
    vctx.restore();

    vctx.imageSmoothingEnabled = viewState.scale < 2;
    vctx.imageSmoothingQuality = 'high';
    vctx.drawImage(composite, 0, 0);

    vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay();
  }

  function drawOverlay() {
    if (transformSession) {
      drawTransformOverlay();
      return;
    }
    if (pickPreview) {
      const { x, y, color, touch } = pickPreview;
      const cy = touch ? y - 70 : y;
      vctx.beginPath();
      vctx.arc(x, cy, 28, 0, Math.PI * 2);
      vctx.fillStyle = color;
      vctx.fill();
      vctx.lineWidth = 4;
      vctx.strokeStyle = '#ffffff';
      vctx.stroke();
      vctx.lineWidth = 1;
      vctx.strokeStyle = 'rgba(0,0,0,0.45)';
      vctx.stroke();
      return;
    }

    if (!hover.visible || hover.type === 'touch' || stage.dataset.cursor !== 'none') return;
    const size = settings.tools[tool].size || 1;
    const radius = Math.max(1.5, (size / 2) * viewState.scale);
    vctx.beginPath();
    vctx.arc(hover.x, hover.y, radius, 0, Math.PI * 2);
    vctx.lineWidth = 3;
    vctx.strokeStyle = 'rgba(255,255,255,0.85)';
    vctx.stroke();
    vctx.lineWidth = 1;
    vctx.strokeStyle = 'rgba(17,24,39,0.85)';
    vctx.stroke();
    if (radius < 4) {
      vctx.fillStyle = 'rgba(17,24,39,0.85)';
      vctx.fillRect(hover.x - 0.5, hover.y - 6, 1, 3);
      vctx.fillRect(hover.x - 0.5, hover.y + 3, 1, 3);
      vctx.fillRect(hover.x - 6, hover.y - 0.5, 3, 1);
      vctx.fillRect(hover.x + 3, hover.y - 0.5, 3, 1);
    }
  }

  function onStageResize() {
    stageRect = stage.getBoundingClientRect();
    const prevW = stageW;
    const prevH = stageH;
    stageW = stageRect.width;
    stageH = stageRect.height;
    dpr = window.devicePixelRatio || 1;
    view.width = Math.max(1, Math.round(stageW * dpr));
    view.height = Math.max(1, Math.round(stageH * dpr));
    if (!hasFitted && stageW > 0 && stageH > 0 && doc.layers.length) {
      hasFitted = true;
      fitView();
      return;
    }
    viewState.cx += (stageW - prevW) / 2;
    viewState.cy += (stageH - prevH) / 2;
    requestRender();
  }

  // ---------------------------------------------------------------------------
  // History helpers
  // ---------------------------------------------------------------------------

  function onHistoryChange() {
    undoButtons.forEach((button) => {
      button.disabled = !history.canUndo();
    });
    redoButtons.forEach((button) => {
      button.disabled = !history.canRedo();
    });
    scheduleAutosave();
  }

  function pixelsChanged(layer) {
    layer.thumbDirty = true;
    scheduleThumbs();
    invalidate();
  }

  function pushPixelEntry(layer, rect, before, after) {
    history.push({
      bytes: before.data.length * 2,
      undo() {
        layer.ctx.putImageData(before, rect.x, rect.y);
        pixelsChanged(layer);
      },
      redo() {
        layer.ctx.putImageData(after, rect.x, rect.y);
        pixelsChanged(layer);
      },
    });
  }

  const LAYER_PROPS = ['name', 'visible', 'locked', 'alphaLock', 'clip', 'opacity', 'blend'];

  function snapshotStructure() {
    return {
      order: doc.layers.slice(),
      activeId: doc.activeId,
      background: doc.background,
      props: doc.layers.map((layer) => {
        const props = { layer };
        LAYER_PROPS.forEach((key) => {
          props[key] = layer[key];
        });
        return props;
      }),
    };
  }

  function restoreStructure(snapshot) {
    doc.layers = snapshot.order.slice();
    snapshot.props.forEach((props) => {
      LAYER_PROPS.forEach((key) => {
        props.layer[key] = props[key];
      });
    });
    doc.activeId = snapshot.activeId;
    doc.background = snapshot.background;
    structureChanged();
  }

  function sameStructure(a, b) {
    if (a.background !== b.background || a.order.length !== b.order.length) return false;
    for (let i = 0; i < a.order.length; i += 1) {
      if (a.order[i] !== b.order[i]) return false;
      if (LAYER_PROPS.some((key) => a.props[i][key] !== b.props[i][key])) return false;
    }
    return true;
  }

  function pushStructureEntry(before, after) {
    if (sameStructure(before, after)) return;
    const layerBytes = doc.width * doc.height * 4;
    history.push({
      bytes: before.order.length !== after.order.length ? layerBytes : 0,
      undo: () => restoreStructure(before),
      redo: () => restoreStructure(after),
    });
  }

  function changeStructure(mutate) {
    const before = snapshotStructure();
    mutate();
    pushStructureEntry(before, snapshotStructure());
    structureChanged();
  }

  function structureChanged() {
    renderLayers();
    updateLayerProps();
    invalidate();
  }

  // ---------------------------------------------------------------------------
  // Drawing: strokes, blur, shapes, fill, eyedropper
  // ---------------------------------------------------------------------------

  function emptyBox() {
    return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  }

  function growBox(box, x, y, radius) {
    box.x0 = Math.min(box.x0, x - radius);
    box.y0 = Math.min(box.y0, y - radius);
    box.x1 = Math.max(box.x1, x + radius);
    box.y1 = Math.max(box.y1, y + radius);
  }

  function boxToRect(box) {
    const x = clamp(Math.floor(box.x0), 0, doc.width);
    const y = clamp(Math.floor(box.y0), 0, doc.height);
    const x1 = clamp(Math.ceil(box.x1), 0, doc.width);
    const y1 = clamp(Math.ceil(box.y1), 0, doc.height);
    if (x1 <= x || y1 <= y) return null;
    return { x, y, w: x1 - x, h: y1 - y };
  }

  function pressureOf(event) {
    if (!settings.pressure || event.pointerType !== 'pen') return 1;
    return event.pressure > 0 ? event.pressure : 0.5;
  }

  function stabilizerFollow(level) {
    return 1 / (1 + level * 0.8);
  }

  function canDrawOn(layer) {
    if (!layer.visible) {
      toast('非表示のレイヤーには描けません');
      return false;
    }
    if (layer.locked) {
      toast('このレイヤーはロックされています');
      return false;
    }
    return true;
  }

  function startToolAction(event, point) {
    const layer = activeLayer();
    if (!canDrawOn(layer)) return;
    const docPoint = screenToDoc(point.x, point.y);

    if (tool === 'fill') {
      fillAt(layer, docPoint);
      return;
    }
    if (tool === 'brush' || tool === 'eraser') beginStroke(event, layer, docPoint);
    else if (tool === 'blur') beginBlur(event, layer, docPoint);
    else if (SHAPE_TOOLS.includes(tool)) beginShape(event, layer, docPoint);
  }

  // --- Brush / eraser -------------------------------------------------------

  function makeAirStamp(color) {
    const size = 128;
    const stamp = makeCanvas(size, size);
    const ctx = stamp.getContext('2d');
    const { r, g, b } = hexToRgb(color);
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gradient.addColorStop(0.5, `rgba(${r},${g},${b},0.5)`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return stamp;
  }

  function beginStroke(event, layer, docPoint) {
    const s = settings.tools[tool];
    const erase = tool === 'eraser';
    const color = erase ? '#000000' : currentColor;
    strokeCtx.clearRect(0, 0, doc.width, doc.height);
    const p = pressureOf(event);
    action = {
      type: 'draw',
      kind: 'stroke',
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      layer,
      usesBuffer: true,
      erase,
      color,
      opacity: s.opacity / 100,
      size: s.size,
      brushType: s.brushType,
      stamp: s.brushType === 'air' ? makeAirStamp(color) : null,
      follow: stabilizerFollow(s.stabilizer),
      smoothed: { x: docPoint.x, y: docPoint.y, p },
      raw: { x: docPoint.x, y: docPoint.y, p },
      pts: [],
      carry: 0,
      bbox: emptyBox(),
    };
    addStrokePoint(action, { x: docPoint.x, y: docPoint.y, p });
    invalidate();
  }

  function strokeWidth(a, p) {
    return Math.max(0.5, a.size * (0.15 + 0.85 * p));
  }

  function feedStroke(a, raw) {
    a.raw = raw;
    const sm = a.smoothed;
    sm.x += (raw.x - sm.x) * a.follow;
    sm.y += (raw.y - sm.y) * a.follow;
    sm.p += (raw.p - sm.p) * Math.max(a.follow, 0.5);
    const last = a.pts[a.pts.length - 1];
    if (last && Math.hypot(sm.x - last.x, sm.y - last.y) < 0.4) return;
    addStrokePoint(a, { x: sm.x, y: sm.y, p: sm.p });
  }

  function addStrokePoint(a, point) {
    if (a.brushType === 'air') {
      addAirPoint(a, point);
      return;
    }
    const ctx = strokeCtx;
    const pts = a.pts;
    pts.push(point);
    if (pts.length > 3) pts.shift();
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const width = strokeWidth(a, point.p);
    growBox(a.bbox, point.x, point.y, width / 2 + 2);

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, width / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const [p0, p1, p2] = pts;
    ctx.beginPath();
    if (pts.length === 2) {
      ctx.lineWidth = strokeWidth(a, (p0.p + p1.p) / 2);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
    } else {
      ctx.lineWidth = strokeWidth(a, p1.p);
      ctx.moveTo((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
      ctx.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    }
    ctx.stroke();
  }

  function finishPenTail(a) {
    const pts = a.pts;
    if (pts.length < 2) return;
    const p1 = pts[pts.length - 2];
    const p2 = pts[pts.length - 1];
    strokeCtx.beginPath();
    strokeCtx.lineWidth = strokeWidth(a, p2.p);
    strokeCtx.moveTo((p1.x + p2.x) / 2, (p1.y + p2.y) / 2);
    strokeCtx.lineTo(p2.x, p2.y);
    strokeCtx.stroke();
  }

  function stampAir(a, x, y, p) {
    const width = strokeWidth(a, p);
    strokeCtx.globalAlpha = 0.08 + 0.12 * p;
    strokeCtx.drawImage(a.stamp, x - width / 2, y - width / 2, width, width);
    strokeCtx.globalAlpha = 1;
    growBox(a.bbox, x, y, width / 2 + 2);
  }

  function addAirPoint(a, point) {
    const last = a.pts[a.pts.length - 1];
    a.pts = [point];
    if (!last) {
      stampAir(a, point.x, point.y, point.p);
      return;
    }
    const dist = Math.hypot(point.x - last.x, point.y - last.y);
    const spacing = Math.max(1, a.size * 0.08);
    let t = spacing - a.carry;
    while (t <= dist) {
      const k = t / dist;
      stampAir(a, last.x + (point.x - last.x) * k, last.y + (point.y - last.y) * k, last.p + (point.p - last.p) * k);
      t += spacing;
    }
    a.carry = dist - (t - spacing);
  }

  function catchUpSmoothing(a, feed) {
    if (a.follow >= 1) return;
    for (let i = 0; i < 40; i += 1) {
      if (Math.hypot(a.smoothed.x - a.raw.x, a.smoothed.y - a.raw.y) < 0.5) break;
      feed(a, a.raw);
    }
  }

  function commitBuffer(a) {
    const rect = boxToRect(a.bbox);
    if (rect) {
      const layer = a.layer;
      const before = layer.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
      applyStrokeBuffer(layer.ctx, { erase: a.erase, opacity: a.opacity, alphaLock: layer.alphaLock });
      const after = layer.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
      pushPixelEntry(layer, rect, before, after);
      if (!a.erase) addRecentColor(a.color);
      pixelsChanged(layer);
    }
    strokeCtx.clearRect(0, 0, doc.width, doc.height);
  }

  function finishStroke(a) {
    catchUpSmoothing(a, feedStroke);
    if (a.brushType !== 'air') finishPenTail(a);
    action = null;
    commitBuffer(a);
    invalidate();
  }

  // --- Blur -----------------------------------------------------------------

  function beginBlur(event, layer, docPoint) {
    if (!supportsFilter) {
      toast('このブラウザはぼかしツールに対応していません');
      return;
    }
    const s = settings.tools.blur;
    const backup = makeCanvas(doc.width, doc.height);
    backup.getContext('2d').drawImage(layer.canvas, 0, 0);
    const pad = Math.ceil(s.strength * 3) + 2;
    const scratchSize = Math.ceil(s.size + pad * 2) + 2;
    const p = pressureOf(event);
    action = {
      type: 'draw',
      kind: 'blur',
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      layer,
      usesBuffer: false,
      size: s.size,
      strength: s.strength,
      pad,
      scratch: makeCanvas(scratchSize, scratchSize),
      backup,
      follow: stabilizerFollow(s.stabilizer),
      smoothed: { x: docPoint.x, y: docPoint.y, p },
      raw: { x: docPoint.x, y: docPoint.y, p },
      last: null,
      carry: 0,
      bbox: emptyBox(),
    };
    blurStamp(action, docPoint.x, docPoint.y, p);
    action.last = { x: docPoint.x, y: docPoint.y, p };
    pixelsChanged(layer);
  }

  function blurStamp(a, x, y, p) {
    const radius = Math.max(1, (a.size / 2) * (0.3 + 0.7 * p));
    const rx = Math.floor(x - radius - a.pad);
    const ry = Math.floor(y - radius - a.pad);
    const size = Math.ceil(radius * 2 + a.pad * 2);
    const sx = Math.max(0, rx);
    const sy = Math.max(0, ry);
    const sw = Math.min(doc.width, rx + size) - sx;
    const sh = Math.min(doc.height, ry + size) - sy;
    if (sw <= 0 || sh <= 0) return;

    const sctx = a.scratch.getContext('2d');
    sctx.clearRect(0, 0, a.scratch.width, a.scratch.height);
    sctx.filter = `blur(${Math.max(0.5, a.strength * p)}px)`;
    sctx.drawImage(a.layer.canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    sctx.filter = 'none';

    const lctx = a.layer.ctx;
    lctx.save();
    lctx.beginPath();
    lctx.arc(x, y, radius, 0, Math.PI * 2);
    lctx.clip();
    lctx.globalCompositeOperation = a.layer.alphaLock ? 'source-atop' : 'copy';
    lctx.drawImage(a.scratch, 0, 0, sw, sh, sx, sy, sw, sh);
    lctx.restore();
    growBox(a.bbox, x, y, radius + 2);
  }

  function feedBlur(a, raw) {
    a.raw = raw;
    const sm = a.smoothed;
    sm.x += (raw.x - sm.x) * a.follow;
    sm.y += (raw.y - sm.y) * a.follow;
    sm.p += (raw.p - sm.p) * Math.max(a.follow, 0.5);
    const last = a.last;
    const dist = Math.hypot(sm.x - last.x, sm.y - last.y);
    const spacing = Math.max(2, a.size * 0.2);
    let t = spacing - a.carry;
    while (t <= dist) {
      const k = t / dist;
      blurStamp(a, last.x + (sm.x - last.x) * k, last.y + (sm.y - last.y) * k, last.p + (sm.p - last.p) * k);
      t += spacing;
    }
    a.carry = dist - (t - spacing);
    a.last = { x: sm.x, y: sm.y, p: sm.p };
  }

  function finishBlur(a) {
    catchUpSmoothing(a, feedBlur);
    action = null;
    const rect = boxToRect(a.bbox);
    if (rect) {
      const before = a.backup.getContext('2d').getImageData(rect.x, rect.y, rect.w, rect.h);
      const after = a.layer.ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
      pushPixelEntry(a.layer, rect, before, after);
    }
    pixelsChanged(a.layer);
  }

  // --- Shapes ---------------------------------------------------------------

  function beginShape(event, layer, docPoint) {
    const s = settings.tools[tool];
    action = {
      type: 'draw',
      kind: 'shape',
      shape: tool,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      layer,
      usesBuffer: true,
      erase: false,
      color: currentColor,
      opacity: s.opacity / 100,
      size: s.size,
      filled: Boolean(s.fillShape),
      start: docPoint,
      end: docPoint,
      shift: event.shiftKey,
      alt: false,
      bbox: emptyBox(),
    };
    strokeCtx.clearRect(0, 0, doc.width, doc.height);
  }

  function shapeGeometry(a) {
    const { x: x0, y: y0 } = a.start;
    let dx = a.end.x - x0;
    let dy = a.end.y - y0;
    if (a.shape === 'line') {
      if (a.shift) {
        const length = Math.hypot(dx, dy);
        const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        dx = Math.cos(angle) * length;
        dy = Math.sin(angle) * length;
      }
      return a.alt
        ? { x0: x0 - dx, y0: y0 - dy, x1: x0 + dx, y1: y0 + dy }
        : { x0, y0, x1: x0 + dx, y1: y0 + dy };
    }
    if (a.shift) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx < 0 ? -1 : 1) * m;
      dy = (dy < 0 ? -1 : 1) * m;
    }
    const sx = a.alt ? x0 - dx : x0;
    const sy = a.alt ? y0 - dy : y0;
    const ex = x0 + dx;
    const ey = y0 + dy;
    return { x0: Math.min(sx, ex), y0: Math.min(sy, ey), x1: Math.max(sx, ex), y1: Math.max(sy, ey) };
  }

  function drawShapeBuffer(a) {
    const ctx = strokeCtx;
    ctx.clearRect(0, 0, doc.width, doc.height);
    const g = shapeGeometry(a);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = a.size;
    ctx.strokeStyle = a.color;
    ctx.fillStyle = a.color;
    ctx.beginPath();
    if (a.shape === 'line') {
      ctx.moveTo(g.x0, g.y0);
      ctx.lineTo(g.x1, g.y1);
      ctx.stroke();
    } else {
      if (a.shape === 'rect') ctx.rect(g.x0, g.y0, g.x1 - g.x0, g.y1 - g.y0);
      else ctx.ellipse((g.x0 + g.x1) / 2, (g.y0 + g.y1) / 2, (g.x1 - g.x0) / 2, (g.y1 - g.y0) / 2, 0, 0, Math.PI * 2);
      if (a.filled) ctx.fill();
      else ctx.stroke();
    }
    ctx.restore();
    a.bbox = emptyBox();
    growBox(a.bbox, Math.min(g.x0, g.x1), Math.min(g.y0, g.y1), a.size + 2);
    growBox(a.bbox, Math.max(g.x0, g.x1), Math.max(g.y0, g.y1), a.size + 2);
  }

  function updateShape(a, docPoint, event) {
    a.end = docPoint;
    a.shift = event.shiftKey;
    a.alt = event.altKey;
    drawShapeBuffer(a);
    invalidate();
  }

  function finishShape(a) {
    action = null;
    const g = shapeGeometry(a);
    if (Math.hypot(g.x1 - g.x0, g.y1 - g.y0) < 1) {
      strokeCtx.clearRect(0, 0, doc.width, doc.height);
      invalidate();
      return;
    }
    commitBuffer(a);
    invalidate();
  }

  // --- Fill -----------------------------------------------------------------

  function fillAt(layer, docPoint) {
    const x = Math.floor(docPoint.x);
    const y = Math.floor(docPoint.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return;
    const s = settings.tools.fill;

    let source;
    if (s.reference === 'canvas') {
      ensureComposite();
      source = compCtx.getImageData(0, 0, doc.width, doc.height);
    } else {
      source = layer.ctx.getImageData(0, 0, doc.width, doc.height);
    }
    const result = floodFill(source, x, y, Math.round(s.tolerance * 2.55), s.expand);
    if (!result) return;
    const { mask, bbox } = result;

    const { r, g, b } = hexToRgb(currentColor);
    const tile = new ImageData(bbox.w, bbox.h);
    for (let row = 0; row < bbox.h; row += 1) {
      const srcRow = (bbox.y + row) * doc.width + bbox.x;
      for (let col = 0; col < bbox.w; col += 1) {
        if (!mask[srcRow + col]) continue;
        const i = (row * bbox.w + col) * 4;
        tile.data[i] = r;
        tile.data[i + 1] = g;
        tile.data[i + 2] = b;
        tile.data[i + 3] = 255;
      }
    }
    const tileCanvas = makeCanvas(bbox.w, bbox.h);
    tileCanvas.getContext('2d').putImageData(tile, 0, 0);

    const before = layer.ctx.getImageData(bbox.x, bbox.y, bbox.w, bbox.h);
    layer.ctx.save();
    layer.ctx.globalAlpha = s.opacity / 100;
    layer.ctx.globalCompositeOperation = layer.alphaLock ? 'source-atop' : 'source-over';
    layer.ctx.drawImage(tileCanvas, bbox.x, bbox.y);
    layer.ctx.restore();
    const after = layer.ctx.getImageData(bbox.x, bbox.y, bbox.w, bbox.h);
    pushPixelEntry(layer, bbox, before, after);
    addRecentColor(currentColor);
    pixelsChanged(layer);
  }

  // --- Eyedropper -----------------------------------------------------------

  function colorAt(point) {
    const d = screenToDoc(point.x, point.y);
    const x = Math.floor(d.x);
    const y = Math.floor(d.y);
    if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
    ensureComposite();
    const [r, g, b, a] = compCtx.getImageData(x, y, 1, 1).data;
    if (doc.background === 'white') {
      const k = a / 255;
      return rgbToHex(r * k + 255 * (1 - k), g * k + 255 * (1 - k), b * k + 255 * (1 - k));
    }
    return a === 0 ? null : rgbToHex(r, g, b);
  }

  function startPick(event, point) {
    action = { type: 'pick', pointerId: event.pointerId, pointerType: event.pointerType };
    pickAt(point, event.pointerType === 'touch');
  }

  function pickAt(point, touch) {
    const color = colorAt(point);
    if (!color) return;
    setColor(color);
    pickPreview = { x: point.x, y: point.y, color, touch };
    requestRender();
  }

  function finishPick() {
    action = null;
    pickPreview = null;
    requestRender();
  }

  // ---------------------------------------------------------------------------
  // Image import and layer transform
  // ---------------------------------------------------------------------------

  // While placing, the image floats over its destination layer and is only
  // drawn into the layer pixels when the user confirms.
  let transformSession = null;
  const accentColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4666ff';
  const tfTarget = $('tfTarget');
  const tfScale = $('tfScale');
  const tfAngle = $('tfAngle');
  const imageFileInput = $('imageFileInput');

  function blockedByTransform() {
    if (!transformSession) return false;
    toast('先に画像の配置を「確定」するか「キャンセル」してください');
    return true;
  }

  function drawFloating(ctx, t, alphaLock) {
    ctx.save();
    ctx.globalCompositeOperation = alphaLock ? 'source-atop' : 'source-over';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(t.cx, t.cy);
    ctx.rotate(t.angle);
    ctx.scale(t.scale * (t.flipX ? -1 : 1), t.scale * (t.flipY ? -1 : 1));
    ctx.drawImage(t.source, -t.sw / 2, -t.sh / 2);
    ctx.restore();
  }

  function fitScale(t) {
    const cos = Math.abs(Math.cos(t.angle));
    const sin = Math.abs(Math.sin(t.angle));
    const boxW = t.sw * cos + t.sh * sin;
    const boxH = t.sw * sin + t.sh * cos;
    return Math.min(doc.width / boxW, doc.height / boxH);
  }

  function minTransformScale(t) {
    return 2 / Math.max(t.sw, t.sh);
  }

  function importImage() {
    if (blockedByTransform()) return;
    imageFileInput.value = '';
    imageFileInput.click();
  }

  imageFileInput.addEventListener('change', async () => {
    const file = imageFileInput.files && imageFileInput.files[0];
    if (!file) return;
    let image;
    try {
      image = await storage.loadImage(file);
    } catch {
      toast('この画像は読み込めません。PNG・JPEG・WebP などを選んでください');
      return;
    }
    if (!image.naturalWidth || !image.naturalHeight) {
      toast('この画像は読み込めません。PNG・JPEG・WebP などを選んでください');
      return;
    }
    beginTransform({ mode: 'import', source: image, sw: image.naturalWidth, sh: image.naturalHeight });
  });

  function contentBounds(layer) {
    const { data } = layer.ctx.getImageData(0, 0, doc.width, doc.height);
    let x0 = doc.width;
    let y0 = doc.height;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < doc.height; y += 1) {
      const row = y * doc.width;
      for (let x = 0; x < doc.width; x += 1) {
        if (data[(row + x) * 4 + 3] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  function transformActiveLayer() {
    if (blockedByTransform()) return;
    const layer = activeLayer();
    if (!canDrawOn(layer)) return;
    const bounds = contentBounds(layer);
    if (!bounds) {
      toast('このレイヤーには何も描かれていません');
      return;
    }
    const source = makeCanvas(bounds.w, bounds.h);
    source.getContext('2d').drawImage(layer.canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
    beginTransform({
      mode: 'layer',
      source,
      sw: bounds.w,
      sh: bounds.h,
      layer,
      cx: bounds.x + bounds.w / 2,
      cy: bounds.y + bounds.h / 2,
    });
  }

  function beginTransform({ mode, source, sw, sh, layer, cx, cy }) {
    cancelAction();
    closeSheet();
    const t = {
      mode,
      source,
      sw,
      sh,
      cx: cx ?? doc.width / 2,
      cy: cy ?? doc.height / 2,
      scale: 1,
      angle: 0,
      flipX: false,
      flipY: false,
      layer: null,
      tempLayer: null,
      originalActiveId: doc.activeId,
      beforeStructure: snapshotStructure(),
      beforePixels: null,
    };
    transformSession = t;

    if (mode === 'import') {
      t.scale = fitScale(t);
      buildTargetOptions();
      tfTarget.value = 'bottom';
      setTransformTarget('bottom');
    } else {
      t.layer = layer;
      t.beforePixels = layer.ctx.getImageData(0, 0, doc.width, doc.height);
      layer.ctx.clearRect(0, 0, doc.width, doc.height);
      pixelsChanged(layer);
    }

    $('tfTargetField').hidden = mode !== 'import';
    $('optionBar').classList.add('is-transforming');
    $('transformBar').hidden = false;
    $('transformActions').hidden = false;
    document.body.classList.add('is-transforming');
    syncTransformInputs();
    updateCursor();
    invalidate();
  }

  function buildTargetOptions() {
    const options = [
      ['bottom', '背景(一番下に新しいレイヤー)'],
      ['above', '新しいレイヤー(選択中のレイヤーの上)'],
    ].map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    });
    for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
      const layer = doc.layers[i];
      const option = document.createElement('option');
      option.value = `layer:${layer.id}`;
      option.textContent = layer.locked ? `${layer.name}(ロック中)` : layer.name;
      option.disabled = layer.locked;
      options.push(option);
    }
    tfTarget.replaceChildren(...options);
  }

  function setTransformTarget(value) {
    const t = transformSession;
    if (t.tempLayer) {
      doc.layers.splice(doc.layers.indexOf(t.tempLayer), 1);
      t.tempLayer = null;
    }
    if (value === 'bottom' || value === 'above') {
      const layer = createLayer(value === 'bottom' ? '下絵' : nextLayerName());
      const originIndex = doc.layers.findIndex((l) => l.id === t.originalActiveId);
      const index = value === 'bottom' ? 0 : (originIndex === -1 ? doc.layers.length - 1 : originIndex) + 1;
      doc.layers.splice(index, 0, layer);
      t.tempLayer = layer;
      t.layer = layer;
    } else {
      t.layer = doc.layers.find((l) => `layer:${l.id}` === value) || activeLayer();
    }
    doc.activeId = t.layer.id;
    structureChanged();
  }

  function syncTransformInputs() {
    const t = transformSession;
    if (!t) return;
    if (document.activeElement !== tfScale) tfScale.value = Math.round(t.scale * 1000) / 10;
    if (document.activeElement !== tfAngle) tfAngle.value = Math.round((normalizeAngle(t.angle) * 180) / Math.PI);
    $('tfFlipH').setAttribute('aria-pressed', String(t.flipX));
    $('tfFlipV').setAttribute('aria-pressed', String(t.flipY));
  }

  function endTransform() {
    transformSession = null;
    $('optionBar').classList.remove('is-transforming');
    $('transformBar').hidden = true;
    $('transformActions').hidden = true;
    document.body.classList.remove('is-transforming');
    structureChanged();
    updateCursor();
  }

  function applyTransform() {
    const t = transformSession;
    if (!t) return;
    if (action && action.type === 'transform') finishAction();
    const layer = t.layer;
    if (layer.locked) {
      toast('配置先のレイヤーがロックされています');
      return;
    }
    if (t.tempLayer) {
      drawFloating(layer.ctx, t, layer.alphaLock);
      const before = t.beforeStructure;
      const after = snapshotStructure();
      history.push({
        bytes: doc.width * doc.height * 4,
        undo: () => restoreStructure(before),
        redo: () => restoreStructure(after),
      });
    } else {
      const before = t.beforePixels || layer.ctx.getImageData(0, 0, doc.width, doc.height);
      drawFloating(layer.ctx, t, layer.alphaLock);
      const after = layer.ctx.getImageData(0, 0, doc.width, doc.height);
      pushPixelEntry(layer, { x: 0, y: 0, w: doc.width, h: doc.height }, before, after);
    }
    pixelsChanged(layer);
    endTransform();
    toast(t.mode === 'import' ? `「${layer.name}」に画像を配置しました` : '変形しました');
  }

  function cancelTransform() {
    const t = transformSession;
    if (!t) return;
    if (action && action.type === 'transform') cancelAction();
    if (t.tempLayer) doc.layers.splice(doc.layers.indexOf(t.tempLayer), 1);
    if (t.mode === 'layer') {
      t.layer.ctx.putImageData(t.beforePixels, 0, 0);
      pixelsChanged(t.layer);
    }
    doc.activeId = t.originalActiveId;
    endTransform();
  }

  function docToScreen(p) {
    const m = viewMatrix();
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  }

  function transformCorners(t) {
    const hw = (t.sw * t.scale) / 2;
    const hh = (t.sh * t.scale) / 2;
    const cos = Math.cos(t.angle);
    const sin = Math.sin(t.angle);
    return [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ].map(([x, y]) => docToScreen({ x: t.cx + x * cos - y * sin, y: t.cy + x * sin + y * cos }));
  }

  function rotateHandle(corners) {
    const t = transformSession;
    const top = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
    const center = docToScreen({ x: t.cx, y: t.cy });
    let dx = top.x - center.x;
    let dy = top.y - center.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) {
      dx = 0;
      dy = -1;
    } else {
      dx /= length;
      dy /= length;
    }
    return { top, handle: { x: top.x + dx * 30, y: top.y + dy * 30 } };
  }

  function drawTransformOverlay() {
    const corners = transformCorners(transformSession);
    const { top, handle } = rotateHandle(corners);
    vctx.save();
    vctx.beginPath();
    corners.forEach((p, i) => (i ? vctx.lineTo(p.x, p.y) : vctx.moveTo(p.x, p.y)));
    vctx.closePath();
    vctx.moveTo(top.x, top.y);
    vctx.lineTo(handle.x, handle.y);
    vctx.lineWidth = 3;
    vctx.strokeStyle = 'rgba(255,255,255,0.9)';
    vctx.stroke();
    vctx.lineWidth = 1.5;
    vctx.strokeStyle = accentColor;
    vctx.stroke();

    vctx.fillStyle = '#ffffff';
    corners.forEach((p) => {
      vctx.beginPath();
      vctx.rect(p.x - 6, p.y - 6, 12, 12);
      vctx.fill();
      vctx.stroke();
    });
    vctx.beginPath();
    vctx.arc(handle.x, handle.y, 7, 0, Math.PI * 2);
    vctx.fill();
    vctx.stroke();
    vctx.restore();
  }

  function hitTransform(point, pointerType) {
    const t = transformSession;
    const tolerance = pointerType === 'touch' ? 26 : 12;
    const corners = transformCorners(t);
    const { handle } = rotateHandle(corners);
    if (Math.hypot(point.x - handle.x, point.y - handle.y) <= tolerance) return 'rotate';
    if (corners.some((c) => Math.hypot(point.x - c.x, point.y - c.y) <= tolerance)) return 'scale';
    const d = screenToDoc(point.x, point.y);
    const cos = Math.cos(-t.angle);
    const sin = Math.sin(-t.angle);
    const lx = ((d.x - t.cx) * cos - (d.y - t.cy) * sin) / t.scale;
    const ly = ((d.x - t.cx) * sin + (d.y - t.cy) * cos) / t.scale;
    if (Math.abs(lx) <= t.sw / 2 && Math.abs(ly) <= t.sh / 2) return 'move';
    return 'rotate';
  }

  function updateTransformHoverCursor(point, pointerType) {
    if (spaceDown || tool === 'hand') return;
    const kind = hitTransform(point, pointerType);
    stage.dataset.cursor = kind === 'move' ? 'move' : kind === 'scale' ? 'resize' : 'rotate';
  }

  function startTransformDrag(event, point) {
    const t = transformSession;
    action = {
      type: 'transform',
      kind: hitTransform(point, event.pointerType),
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      start: screenToDoc(point.x, point.y),
      saved: { cx: t.cx, cy: t.cy, scale: t.scale, angle: t.angle },
    };
  }

  function updateTransformDrag(point, event) {
    const t = transformSession;
    const a = action;
    const d = screenToDoc(point.x, point.y);
    const { cx, cy, scale, angle } = a.saved;
    if (a.kind === 'move') {
      t.cx = cx + (d.x - a.start.x);
      t.cy = cy + (d.y - a.start.y);
    } else if (a.kind === 'scale') {
      const r0 = Math.max(1e-6, Math.hypot(a.start.x - cx, a.start.y - cy));
      const r = Math.hypot(d.x - cx, d.y - cy);
      t.scale = clamp(scale * (r / r0), minTransformScale(t), 20);
    } else {
      const a0 = Math.atan2(a.start.y - cy, a.start.x - cx);
      const a1 = Math.atan2(d.y - cy, d.x - cx);
      let next = angle + (a1 - a0);
      if (event.shiftKey) {
        const step = Math.PI / 12;
        next = Math.round(next / step) * step;
      }
      t.angle = normalizeAngle(next);
    }
    syncTransformInputs();
    invalidate();
  }

  function bindTransformUI() {
    tfTarget.addEventListener('change', () => {
      if (transformSession) setTransformTarget(tfTarget.value);
    });
    tfScale.addEventListener('change', () => {
      const t = transformSession;
      if (!t) return;
      const value = Number(tfScale.value);
      if (value > 0) t.scale = clamp(value / 100, minTransformScale(t), 20);
      syncTransformInputs();
      invalidate();
    });
    tfAngle.addEventListener('change', () => {
      const t = transformSession;
      if (!t) return;
      t.angle = normalizeAngle(((Number(tfAngle.value) || 0) * Math.PI) / 180);
      syncTransformInputs();
      invalidate();
    });
    const rotate = (deg) => {
      const t = transformSession;
      if (!t) return;
      t.angle = normalizeAngle(t.angle + (deg * Math.PI) / 180);
      syncTransformInputs();
      invalidate();
    };
    $('tfRotLeft').addEventListener('click', () => rotate(-90));
    $('tfRotRight').addEventListener('click', () => rotate(90));
    $('tfFlipH').addEventListener('click', () => {
      if (!transformSession) return;
      transformSession.flipX = !transformSession.flipX;
      syncTransformInputs();
      invalidate();
    });
    $('tfFlipV').addEventListener('click', () => {
      if (!transformSession) return;
      transformSession.flipY = !transformSession.flipY;
      syncTransformInputs();
      invalidate();
    });
    $('tfFit').addEventListener('click', () => {
      const t = transformSession;
      if (!t) return;
      t.scale = fitScale(t);
      t.cx = doc.width / 2;
      t.cy = doc.height / 2;
      syncTransformInputs();
      invalidate();
    });
    $('tfApply').addEventListener('click', applyTransform);
    $('tfCancel').addEventListener('click', cancelTransform);
  }

  // ---------------------------------------------------------------------------
  // Pointer input, gestures
  // ---------------------------------------------------------------------------

  function localPoint(event) {
    return { x: event.clientX - stageRect.left, y: event.clientY - stageRect.top };
  }

  function clearLongPress() {
    if (longPress) clearTimeout(longPress.timer);
    longPress = null;
  }

  function armLongPress(point) {
    clearLongPress();
    longPress = {
      x: point.x,
      y: point.y,
      timer: setTimeout(() => {
        if (!action || action.type !== 'draw') return;
        const { pointerId, pointerType } = action;
        const at = { x: longPress.x, y: longPress.y };
        cancelAction();
        action = { type: 'pick', pointerId, pointerType };
        pickAt(at, true);
      }, LONG_PRESS_MS),
    };
  }

  function cancelAction() {
    clearLongPress();
    if (!action) return;
    if (action.type === 'draw') {
      if (action.kind === 'blur') {
        const lctx = action.layer.ctx;
        lctx.save();
        lctx.globalCompositeOperation = 'copy';
        lctx.drawImage(action.backup, 0, 0);
        lctx.restore();
        pixelsChanged(action.layer);
      }
      strokeCtx.clearRect(0, 0, doc.width, doc.height);
    }
    if (action.type === 'transform' && transformSession) {
      Object.assign(transformSession, action.saved);
      syncTransformInputs();
    }
    pickPreview = null;
    action = null;
    updateCursor();
    invalidate();
  }

  function startPan(event, point) {
    action = {
      type: 'pan',
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      sx: point.x,
      sy: point.y,
      cx0: viewState.cx,
      cy0: viewState.cy,
    };
    updateCursor();
  }

  function startGesture() {
    const ids = Array.from(touches.keys()).slice(0, 2);
    const a = touches.get(ids[0]);
    const b = touches.get(ids[1]);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    action = {
      type: 'gesture',
      pointerType: 'touch',
      ids,
      dist0: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      angle0: Math.atan2(b.y - a.y, b.x - a.x),
      scale0: viewState.scale,
      rotation0: viewState.rotation,
      anchor: screenToDoc(mid.x, mid.y),
    };
  }

  function updateGesture() {
    const a = touches.get(action.ids[0]);
    const b = touches.get(action.ids[1]);
    if (!a || !b) return;
    const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const scale = action.scale0 * (dist / action.dist0);
    const rotation = snapRotation(action.rotation0 + (angle - action.angle0));
    setViewAround(action.anchor, mid, scale, rotation);
  }

  function noteInputType(event) {
    if (event.pointerType === 'pen' && settings.fingerDraw && !penSeen) {
      penSeen = true;
      settings.fingerDraw = false;
      $('fingerDrawToggle').checked = false;
      saveSettings();
      toast('ペンを検出しました。指は移動と拡大・縮小に使います');
    }
  }
  let penSeen = false;

  function onPointerDown(event) {
    stageRect = stage.getBoundingClientRect();
    const point = localPoint(event);
    noteInputType(event);
    closeMenu();

    if (event.target !== view) return;
    if (event.pointerType === 'touch') {
      onTouchDown(event, point);
      return;
    }
    if (action) return;
    stage.setPointerCapture(event.pointerId);

    if (event.button === 1 || spaceDown || tool === 'hand') {
      event.preventDefault();
      startPan(event, point);
      return;
    }
    if (event.button !== 0) return;
    if (transformSession) {
      startTransformDrag(event, point);
      return;
    }
    if (altDown || tool === 'eyedropper') {
      startPick(event, point);
      return;
    }
    startToolAction(event, point);
  }

  function onTouchDown(event, point) {
    // Ignore the palm while a pen is drawing.
    if (action && action.pointerType !== 'touch') return;
    stage.setPointerCapture(event.pointerId);
    touches.set(event.pointerId, { x: point.x, y: point.y, sx: point.x, sy: point.y });

    if (touches.size === 1) {
      tapState = { start: performance.now(), max: 1, moved: false };
      if (transformSession && tool !== 'hand') {
        startTransformDrag(event, point);
        return;
      }
      if (!settings.fingerDraw || tool === 'hand') {
        startPan(event, point);
        return;
      }
      if (tool === 'eyedropper') {
        startPick(event, point);
        return;
      }
      startToolAction(event, point);
      if (action && action.type === 'draw') armLongPress(point);
      return;
    }

    if (tapState) tapState.max = Math.max(tapState.max, touches.size);
    if (action && action.type !== 'gesture') cancelAction();
    if (!action) startGesture();
  }

  function processDrawMove(event) {
    const events = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
    const list = events.length ? events : [event];
    const a = action;
    list.forEach((e) => {
      const point = localPoint(e);
      const d = screenToDoc(point.x, point.y);
      const raw = { x: d.x, y: d.y, p: pressureOf(e) };
      if (a.kind === 'stroke') feedStroke(a, raw);
      else if (a.kind === 'blur') feedBlur(a, raw);
    });
    if (a.kind === 'shape') {
      const point = localPoint(event);
      updateShape(a, screenToDoc(point.x, point.y), event);
    } else if (a.kind === 'blur') {
      pixelsChanged(a.layer);
    } else {
      invalidate();
    }
  }

  function onPointerMove(event) {
    const point = localPoint(event);
    if (event.pointerType !== 'touch') {
      hover.x = point.x;
      hover.y = point.y;
      hover.visible = true;
      hover.type = event.pointerType;
    }
    if (event.pointerType === 'touch' && touches.has(event.pointerId)) {
      const t = touches.get(event.pointerId);
      t.x = point.x;
      t.y = point.y;
      if (tapState && Math.hypot(t.x - t.sx, t.y - t.sy) > TAP_MOVE) tapState.moved = true;
    }

    if (!action) {
      if (transformSession) updateTransformHoverCursor(point, event.pointerType);
      else if (stage.dataset.cursor === 'none') requestRender();
      return;
    }

    if (action.type === 'gesture') {
      if (touches.has(event.pointerId)) updateGesture();
      return;
    }
    if (action.pointerId !== event.pointerId) return;

    if (longPress && Math.hypot(point.x - longPress.x, point.y - longPress.y) > 10) clearLongPress();

    if (action.type === 'pan') {
      viewState.cx = action.cx0 + (point.x - action.sx);
      viewState.cy = action.cy0 + (point.y - action.sy);
      onViewChanged();
    } else if (action.type === 'pick') {
      pickAt(point, event.pointerType === 'touch');
    } else if (action.type === 'draw') {
      processDrawMove(event);
    } else if (action.type === 'transform') {
      updateTransformDrag(point, event);
    }
  }

  function finishAction() {
    const a = action;
    clearLongPress();
    if (!a) return;
    if (a.type === 'draw') {
      if (a.kind === 'stroke') finishStroke(a);
      else if (a.kind === 'blur') finishBlur(a);
      else finishShape(a);
    } else if (a.type === 'pick') {
      finishPick();
    } else {
      action = null;
    }
    updateCursor();
  }

  function onPointerUp(event) {
    if (event.pointerType === 'touch') {
      onTouchUp(event);
      return;
    }
    if (action && action.pointerId === event.pointerId) finishAction();
  }

  function onTouchUp(event) {
    if (!touches.has(event.pointerId)) return;
    touches.delete(event.pointerId);

    if (action) {
      if (action.type === 'gesture') {
        if (touches.size >= 2) startGesture();
        else action = touches.size === 1 ? { type: 'wait', pointerType: 'touch' } : null;
      } else if (action.type === 'wait') {
        if (touches.size === 0) action = null;
      } else if (action.pointerId === event.pointerId) {
        finishAction();
      }
    }

    if (touches.size === 0) {
      if (tapState && !tapState.moved && performance.now() - tapState.start < TAP_MS) {
        if (tapState.max === 2) undo();
        else if (tapState.max >= 3) redo();
      }
      tapState = null;
      action = action && action.type === 'wait' ? null : action;
    }
  }

  function onPointerCancel(event) {
    if (event.pointerType === 'touch') {
      touches.delete(event.pointerId);
      if (touches.size === 0) {
        tapState = null;
        cancelAction();
      }
      return;
    }
    if (action && action.pointerId === event.pointerId) cancelAction();
  }

  function onWheel(event) {
    event.preventDefault();
    stageRect = stage.getBoundingClientRect();
    const point = localPoint(event);
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 33;
    if (event.deltaMode === 2) delta *= stageH;
    const factor = Math.exp(-clamp(delta, -200, 200) * (event.ctrlKey ? 0.01 : 0.0015));
    zoomAt(point, factor);
  }

  function updateCursor() {
    let cursor = 'crosshair';
    if (action && action.type === 'pan') cursor = 'grabbing';
    else if (spaceDown || tool === 'hand') cursor = 'grab';
    else if (transformSession) cursor = 'move';
    else if (altDown || tool === 'eyedropper') cursor = 'crosshair';
    else if (STROKE_TOOLS.includes(tool)) cursor = 'none';
    stage.dataset.cursor = cursor;
    requestRender();
  }

  // ---------------------------------------------------------------------------
  // Undo / redo
  // ---------------------------------------------------------------------------

  function undo() {
    if (blockedByTransform()) return;
    if (action && action.type !== 'gesture' && action.type !== 'wait') cancelAction();
    if (!history.undo()) toast('これ以上元に戻せません');
  }

  function redo() {
    if (blockedByTransform()) return;
    if (action && action.type !== 'gesture' && action.type !== 'wait') cancelAction();
    if (!history.redo()) toast('これ以上やり直せません');
  }

  // ---------------------------------------------------------------------------
  // Tool options UI
  // ---------------------------------------------------------------------------

  function sizeToSlider(size) {
    return Math.round(Math.sqrt((size - 1) / (MAX_SIZE - 1)) * 1000);
  }

  function sliderToSize(value) {
    return Math.max(1, Math.round(1 + (MAX_SIZE - 1) * (value / 1000) ** 2));
  }

  function setTool(next) {
    if (!TOOL_OPTIONS[next]) return;
    if (transformSession && next !== 'hand' && next !== tool && blockedByTransform()) return;
    if (action && action.type === 'draw') cancelAction();
    tool = next;
    settings.tool = next;
    toolButtons.forEach((button) => {
      const active = button.dataset.tool === tool;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $('mToolIcon').setAttribute('href', `#i-${tool === 'eyedropper' ? 'eyedropper' : tool}`);
    syncOptionBar();
    updateCursor();
    saveSettings();
  }

  function syncOptionBar() {
    const visible = TOOL_OPTIONS[tool];
    optionGroups.forEach((group) => {
      group.hidden = !visible.includes(group.dataset.opt);
    });
    const s = settings.tools[tool];
    if ('brushType' in s) opt.brushType.value = s.brushType;
    if ('size' in s) {
      if (document.activeElement !== opt.size) opt.size.value = sizeToSlider(s.size);
      opt.sizeNum.value = s.size;
    }
    if ('opacity' in s) {
      opt.opacity.value = s.opacity;
      opt.opacityNum.value = s.opacity;
    }
    if ('strength' in s) {
      opt.strength.value = s.strength;
      opt.strengthValue.textContent = s.strength;
    }
    if ('stabilizer' in s) {
      opt.stabilizer.value = s.stabilizer;
      opt.stabilizerValue.textContent = s.stabilizer;
    }
    if ('fillShape' in s) opt.fillShape.checked = s.fillShape;
    if ('tolerance' in s) {
      opt.tolerance.value = s.tolerance;
      opt.toleranceValue.textContent = `${s.tolerance}%`;
    }
    if ('expand' in s) {
      opt.expand.value = s.expand;
      opt.expandValue.textContent = `${s.expand}px`;
    }
    if ('reference' in s) opt.reference.value = s.reference;
    opt.pressure.checked = settings.pressure;
  }

  function setToolSetting(key, value) {
    settings.tools[tool][key] = value;
    syncOptionBar();
    saveSettings();
    requestRender();
  }

  function changeSize(factor) {
    const s = settings.tools[tool];
    if (!('size' in s)) return;
    const next = factor > 1 ? Math.max(s.size + 1, Math.round(s.size * factor)) : Math.min(s.size - 1, Math.round(s.size * factor));
    setToolSetting('size', clamp(next, 1, MAX_SIZE));
  }

  function bindOptionBar() {
    opt.brushType.addEventListener('change', () => setToolSetting('brushType', opt.brushType.value));
    opt.size.addEventListener('input', () => setToolSetting('size', sliderToSize(Number(opt.size.value))));
    opt.sizeNum.addEventListener('change', () => {
      setToolSetting('size', clamp(Math.round(Number(opt.sizeNum.value) || 1), 1, MAX_SIZE));
    });
    opt.opacity.addEventListener('input', () => setToolSetting('opacity', Number(opt.opacity.value)));
    opt.opacityNum.addEventListener('change', () => {
      setToolSetting('opacity', clamp(Math.round(Number(opt.opacityNum.value) || 100), 1, 100));
    });
    opt.strength.addEventListener('input', () => setToolSetting('strength', Number(opt.strength.value)));
    opt.stabilizer.addEventListener('input', () => setToolSetting('stabilizer', Number(opt.stabilizer.value)));
    opt.fillShape.addEventListener('change', () => setToolSetting('fillShape', opt.fillShape.checked));
    opt.tolerance.addEventListener('input', () => setToolSetting('tolerance', Number(opt.tolerance.value)));
    opt.expand.addEventListener('input', () => setToolSetting('expand', Number(opt.expand.value)));
    opt.reference.addEventListener('change', () => setToolSetting('reference', opt.reference.value));
    opt.pressure.addEventListener('change', () => {
      settings.pressure = opt.pressure.checked;
      saveSettings();
    });
  }

  // ---------------------------------------------------------------------------
  // Color UI
  // ---------------------------------------------------------------------------

  const picker = new ColorPicker($('colorWheel'), (hex) => setColor(hex, { fromPicker: true }));
  const hexInput = $('hexInput');
  let paletteEditing = false;

  function setColor(hex, { fromPicker = false } = {}) {
    currentColor = hex;
    settings.color = hex;
    if (!fromPicker) picker.setColor(hex);
    if (document.activeElement !== hexInput) hexInput.value = hex;
    $('currentSwatch').style.background = hex;
    $('mColorSwatch').style.background = hex;
    saveSettings();
  }

  function addRecentColor(hex) {
    const list = settings.recent.filter((c) => c !== hex);
    list.unshift(hex);
    settings.recent = list.slice(0, 16);
    renderSwatches();
    saveSettings();
  }

  function makeSwatch(hex, onClick, label) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.style.background = hex;
    button.title = hex;
    button.setAttribute('aria-label', label || hex);
    if (hex === currentColor) button.classList.add('is-current');
    button.addEventListener('click', onClick);
    return button;
  }

  function renderSwatches() {
    const recent = $('recentColors');
    recent.replaceChildren(...settings.recent.map((hex) => makeSwatch(hex, () => setColor(hex))));
    if (!settings.recent.length) {
      const empty = document.createElement('p');
      empty.className = 'panel-hint';
      empty.textContent = '描いた色がここに並びます';
      recent.append(empty);
    }
    const palette = $('paletteColors');
    palette.classList.toggle('is-editing', paletteEditing);
    palette.replaceChildren(
      ...settings.palette.map((hex, index) =>
        makeSwatch(
          hex,
          () => {
            if (paletteEditing) {
              settings.palette.splice(index, 1);
              renderSwatches();
              saveSettings();
            } else {
              setColor(hex);
            }
          },
          paletteEditing ? `${hex} を削除` : hex,
        ),
      ),
    );
  }

  function bindColorUI() {
    hexInput.addEventListener('change', () => {
      const hex = normalizeHex(hexInput.value);
      if (hex) setColor(hex);
      else {
        toast('#RRGGBB の形で入力してください');
        hexInput.value = currentColor;
      }
    });
    $('paletteAddBtn').addEventListener('click', () => {
      if (settings.palette.includes(currentColor)) {
        toast('この色はもうパレットにあります');
        return;
      }
      settings.palette.push(currentColor);
      renderSwatches();
      saveSettings();
    });
    $('paletteEditBtn').addEventListener('click', (event) => {
      paletteEditing = !paletteEditing;
      event.currentTarget.setAttribute('aria-pressed', String(paletteEditing));
      event.currentTarget.textContent = paletteEditing ? '完了' : '編集';
      $('paletteHint').hidden = !paletteEditing;
      renderSwatches();
    });
  }

  // ---------------------------------------------------------------------------
  // Layer panel
  // ---------------------------------------------------------------------------

  function iconSvg(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function thumbSize() {
    const scale = Math.min(52 / doc.width, 38 / doc.height);
    return { w: Math.max(4, Math.round(doc.width * scale)), h: Math.max(4, Math.round(doc.height * scale)) };
  }

  function drawThumb(layer) {
    const canvas = layer.thumbEl;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = ctx.createPattern(checkerPattern, 'repeat');
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(layer.canvas, 0, 0, canvas.width, canvas.height);
    layer.thumbDirty = false;
  }

  let thumbTimer = null;
  function scheduleThumbs() {
    if (thumbTimer) return;
    thumbTimer = setTimeout(() => {
      thumbTimer = null;
      doc.layers.forEach((layer) => {
        if (layer.thumbDirty) drawThumb(layer);
      });
    }, 150);
  }

  function iconButton(icon, act, label, pressed) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-btn';
    button.dataset.act = act;
    button.setAttribute('aria-label', label);
    button.title = label;
    if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
    button.append(iconSvg(icon));
    return button;
  }

  function renderLayers() {
    const { w, h } = thumbSize();
    const rows = [];
    const activeId = activeLayer() && activeLayer().id;

    for (let i = doc.layers.length - 1; i >= 0; i -= 1) {
      const layer = doc.layers[i];
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.dataset.id = layer.id;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(layer.id === activeId));
      if (layer.id === activeId) row.classList.add('is-active');
      if (!layer.visible) row.classList.add('is-hidden');
      if (layer.clip && i > 0) row.classList.add('is-clip');

      if (layer.clip && i > 0) {
        const mark = iconSvg('clip');
        mark.classList.add('clip-mark');
        row.append(mark);
      }

      const thumb = document.createElement('canvas');
      thumb.className = 'layer-thumb';
      thumb.width = w * 2;
      thumb.height = h * 2;
      thumb.style.width = `${w}px`;
      thumb.style.height = `${h}px`;
      layer.thumbEl = thumb;
      drawThumb(layer);
      row.append(thumb);

      const info = document.createElement('div');
      info.className = 'layer-info';
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = layer.name;
      const meta = document.createElement('span');
      meta.className = 'layer-meta';
      const parts = [`${Math.round(layer.opacity * 100)}%`];
      if (layer.blend !== 'source-over') parts.push(BLEND_LABELS[layer.blend]);
      if (layer.alphaLock) parts.push('透明保護');
      meta.textContent = parts.join(' · ');
      info.append(name, meta);
      row.append(info);

      row.append(
        iconButton(layer.visible ? 'eye' : 'eye-off', 'visible', layer.visible ? '非表示にする' : '表示する', layer.visible),
        iconButton(layer.locked ? 'lock' : 'unlock', 'lock', layer.locked ? 'ロックを解除' : 'ロックする', layer.locked),
      );
      rows.push(row);
    }

    const bg = document.createElement('div');
    bg.className = 'layer-row background-row';
    const bgThumb = document.createElement('span');
    bgThumb.className = `layer-thumb bg-thumb ${doc.background === 'white' ? 'is-white' : 'is-transparent'}`;
    bgThumb.style.width = `${w}px`;
    bgThumb.style.height = `${h}px`;
    const bgInfo = document.createElement('div');
    bgInfo.className = 'layer-info';
    const bgName = document.createElement('span');
    bgName.className = 'layer-name';
    bgName.textContent = '背景';
    const bgMeta = document.createElement('span');
    bgMeta.className = 'layer-meta';
    bgMeta.textContent = doc.background === 'white' ? '白' : '透明';
    bgInfo.append(bgName, bgMeta);
    const bgToggle = document.createElement('button');
    bgToggle.type = 'button';
    bgToggle.className = 'text-btn';
    bgToggle.dataset.act = 'background';
    bgToggle.textContent = doc.background === 'white' ? '透明にする' : '白にする';
    bg.append(bgThumb, bgInfo, bgToggle);
    rows.push(bg);

    layerList.replaceChildren(...rows);
  }

  function updateLayerProps() {
    const layer = activeLayer();
    if (!layer) return;
    const index = activeIndex();
    layerOpacity.value = Math.round(layer.opacity * 100);
    layerOpacityValue.textContent = `${Math.round(layer.opacity * 100)}%`;
    layerBlend.value = layer.blend;
    layerClip.checked = layer.clip;
    layerClip.disabled = index === 0;
    layerAlphaLock.checked = layer.alphaLock;
    layerLock.checked = layer.locked;
    $('layerUpBtn').disabled = index === doc.layers.length - 1;
    $('layerDownBtn').disabled = index === 0;
    $('mergeDownBtn').disabled = index === 0;
    $('deleteLayerBtn').disabled = doc.layers.length === 1;
  }

  function selectLayer(id) {
    if (doc.activeId === id) return;
    doc.activeId = id;
    renderLayers();
    updateLayerProps();
  }

  function addLayer() {
    changeStructure(() => {
      const layer = createLayer(nextLayerName());
      doc.layers.splice(activeIndex() + 1, 0, layer);
      doc.activeId = layer.id;
    });
  }

  function duplicateLayer() {
    const source = activeLayer();
    changeStructure(() => {
      const copy = createLayer(`${source.name} のコピー`);
      LAYER_PROPS.forEach((key) => {
        if (key !== 'name') copy[key] = source[key];
      });
      copy.ctx.drawImage(source.canvas, 0, 0);
      doc.layers.splice(activeIndex() + 1, 0, copy);
      doc.activeId = copy.id;
    });
  }

  function moveLayer(direction) {
    const index = activeIndex();
    const target = index + direction;
    if (target < 0 || target >= doc.layers.length) return;
    changeStructure(() => {
      const [layer] = doc.layers.splice(index, 1);
      doc.layers.splice(target, 0, layer);
    });
  }

  async function deleteLayer() {
    if (doc.layers.length === 1) return;
    const layer = activeLayer();
    const ok = await confirmAction({
      title: 'レイヤーを削除',
      message: `「${layer.name}」を削除します。元に戻すで復元できます。`,
      okLabel: '削除',
      danger: true,
    });
    if (!ok) return;
    changeStructure(() => {
      const index = doc.layers.indexOf(layer);
      doc.layers.splice(index, 1);
      doc.activeId = doc.layers[Math.max(0, index - 1)].id;
    });
  }

  async function clearLayer() {
    const layer = activeLayer();
    if (layer.locked) {
      toast('このレイヤーはロックされています');
      return;
    }
    const ok = await confirmAction({
      title: 'レイヤーを消去',
      message: `「${layer.name}」に描いた内容をすべて消します。元に戻すで復元できます。`,
      okLabel: '消去',
      danger: true,
    });
    if (!ok) return;
    const rect = { x: 0, y: 0, w: doc.width, h: doc.height };
    const before = layer.ctx.getImageData(0, 0, doc.width, doc.height);
    layer.ctx.clearRect(0, 0, doc.width, doc.height);
    const after = layer.ctx.getImageData(0, 0, doc.width, doc.height);
    pushPixelEntry(layer, rect, before, after);
    pixelsChanged(layer);
  }

  function baseIndexOf(index) {
    let i = index;
    while (i > 0 && doc.layers[i].clip) i -= 1;
    return i;
  }

  function mergeDown() {
    const index = activeIndex();
    if (index === 0) {
      toast('下にレイヤーがありません');
      return;
    }
    const top = doc.layers[index];
    const target = doc.layers[index - 1];
    if (!top.visible) {
      toast('非表示のレイヤーは結合できません');
      return;
    }
    if (target.locked) {
      toast('下のレイヤーがロックされています');
      return;
    }

    const before = target.ctx.getImageData(0, 0, doc.width, doc.height);
    clipCtx.globalCompositeOperation = 'copy';
    clipCtx.globalAlpha = top.opacity;
    clipCtx.drawImage(top.canvas, 0, 0);
    clipCtx.globalAlpha = 1;
    if (top.clip) {
      clipCtx.globalCompositeOperation = 'destination-in';
      clipCtx.drawImage(doc.layers[baseIndexOf(index - 1)].canvas, 0, 0);
    }
    clipCtx.globalCompositeOperation = 'source-over';
    target.ctx.save();
    target.ctx.globalCompositeOperation = top.blend;
    target.ctx.drawImage(clipCanvas, 0, 0);
    target.ctx.restore();
    const after = target.ctx.getImageData(0, 0, doc.width, doc.height);

    const beforeStructure = snapshotStructure();
    doc.layers.splice(index, 1);
    doc.activeId = target.id;
    const afterStructure = snapshotStructure();

    history.push({
      bytes: before.data.length * 2 + doc.width * doc.height * 4,
      undo() {
        target.ctx.putImageData(before, 0, 0);
        restoreStructure(beforeStructure);
        pixelsChanged(target);
      },
      redo() {
        target.ctx.putImageData(after, 0, 0);
        restoreStructure(afterStructure);
        pixelsChanged(target);
      },
    });
    structureChanged();
    pixelsChanged(target);
  }

  async function renameLayer(layer = activeLayer()) {
    const input = $('renameInput');
    input.value = layer.name;
    const result = await openDialog($('renameDialog'), () => input.select());
    if (result !== 'ok') return;
    const name = input.value.trim();
    if (!name) return;
    changeStructure(() => {
      layer.name = name;
    });
  }

  let propsEditBefore = null;

  function bindLayerPanel() {
    BLEND_MODES.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      layerBlend.append(option);
    });

    layerList.addEventListener('click', (event) => {
      const actButton = event.target.closest('[data-act]');
      const row = event.target.closest('.layer-row');
      if (!row) return;
      if (actButton) {
        const act = actButton.dataset.act;
        if (act === 'background') {
          changeStructure(() => {
            doc.background = doc.background === 'white' ? 'transparent' : 'white';
          });
          return;
        }
        const layer = doc.layers.find((l) => l.id === row.dataset.id);
        if (!layer) return;
        changeStructure(() => {
          if (act === 'visible') layer.visible = !layer.visible;
          if (act === 'lock') layer.locked = !layer.locked;
        });
        return;
      }
      if (row.dataset.id) selectLayer(row.dataset.id);
    });

    layerList.addEventListener('dblclick', (event) => {
      const row = event.target.closest('.layer-row');
      if (!row || !row.dataset.id || event.target.closest('[data-act]')) return;
      const layer = doc.layers.find((l) => l.id === row.dataset.id);
      if (layer) renameLayer(layer);
    });

    layerOpacity.addEventListener('input', () => {
      if (!propsEditBefore) propsEditBefore = snapshotStructure();
      const layer = activeLayer();
      layer.opacity = Number(layerOpacity.value) / 100;
      layerOpacityValue.textContent = `${layerOpacity.value}%`;
      invalidate();
    });
    layerOpacity.addEventListener('change', () => {
      if (propsEditBefore) pushStructureEntry(propsEditBefore, snapshotStructure());
      propsEditBefore = null;
      renderLayers();
    });

    layerBlend.addEventListener('change', () => {
      changeStructure(() => {
        activeLayer().blend = layerBlend.value;
      });
    });
    layerClip.addEventListener('change', () => {
      changeStructure(() => {
        activeLayer().clip = layerClip.checked;
      });
    });
    layerAlphaLock.addEventListener('change', () => {
      changeStructure(() => {
        activeLayer().alphaLock = layerAlphaLock.checked;
      });
    });
    layerLock.addEventListener('change', () => {
      changeStructure(() => {
        activeLayer().locked = layerLock.checked;
      });
    });

    $('addLayerBtn').addEventListener('click', addLayer);
    $('dupLayerBtn').addEventListener('click', duplicateLayer);
    $('layerUpBtn').addEventListener('click', () => moveLayer(1));
    $('layerDownBtn').addEventListener('click', () => moveLayer(-1));
    $('mergeDownBtn').addEventListener('click', mergeDown);
    $('renameLayerBtn').addEventListener('click', () => renameLayer());
    $('clearLayerBtn').addEventListener('click', clearLayer);
    $('deleteLayerBtn').addEventListener('click', deleteLayer);
    $('transformLayerBtn').addEventListener('click', transformActiveLayer);
  }

  // ---------------------------------------------------------------------------
  // Dialogs, toast, menu, sheets
  // ---------------------------------------------------------------------------

  function openDialog(dialog, onOpen) {
    return new Promise((resolve) => {
      dialog.returnValue = '';
      dialog.showModal();
      if (onOpen) onOpen();
      dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true });
    });
  }

  document.querySelectorAll('[data-dialog-cancel]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog').close('cancel'));
  });

  async function confirmAction({ title, message, okLabel = 'OK', danger = false }) {
    $('confirmTitle').textContent = title;
    $('confirmMessage').textContent = message;
    const ok = $('confirmOk');
    ok.textContent = okLabel;
    ok.classList.toggle('danger', danger);
    return (await openDialog($('confirmDialog'))) === 'ok';
  }

  let toastTimer = null;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2400);
  }

  const menu = $('mainMenu');
  const menuBtn = $('menuBtn');

  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    menuBtn.setAttribute('aria-expanded', 'false');
  }

  function bindMenu() {
    menuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.menu-wrap')) closeMenu();
    });
    menu.addEventListener('click', (event) => {
      const item = event.target.closest('[data-menu]');
      if (!item) return;
      closeMenu();
      const name = item.dataset.menu;
      if (transformSession && name !== 'help') {
        blockedByTransform();
        return;
      }
      if (name === 'new') openNewDialog();
      if (name === 'open') openProject();
      if (name === 'save') saveProject();
      if (name === 'export') openExportDialog();
      if (name === 'help') openDialog($('helpDialog'));
      if (name === 'import') importImage();
    });
    const fingerToggle = $('fingerDrawToggle');
    fingerToggle.checked = settings.fingerDraw;
    fingerToggle.addEventListener('change', () => {
      settings.fingerDraw = fingerToggle.checked;
      saveSettings();
    });
  }

  const mobileQuery = window.matchMedia('(max-width: 899px)');
  const backdrop = $('sheetBackdrop');
  let openSheetEl = null;

  function openSheet(id) {
    closeSheet();
    openSheetEl = $(id);
    openSheetEl.classList.add('is-open');
    backdrop.hidden = false;
  }

  function closeSheet() {
    if (!openSheetEl) return;
    openSheetEl.classList.remove('is-open');
    openSheetEl = null;
    backdrop.hidden = true;
  }

  function bindSheets() {
    document.querySelectorAll('[data-open-sheet]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = button.dataset.openSheet;
        if (openSheetEl && openSheetEl.id === id) closeSheet();
        else openSheet(id);
      });
    });
    document.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', closeSheet));
    backdrop.addEventListener('click', closeSheet);
    mobileQuery.addEventListener('change', closeSheet);
  }

  // ---------------------------------------------------------------------------
  // Documents: new, autosave, project files, export
  // ---------------------------------------------------------------------------

  function setDocName(name) {
    doc.name = name || '無題';
    docTitle.textContent = doc.name;
  }

  function resetDocument(width, height) {
    cancelAction();
    doc.width = width;
    doc.height = height;
    doc.layers = [];
    resizeBuffers();
  }

  function newDocument(width, height) {
    resetDocument(width, height);
    doc.background = 'white';
    const layer = createLayer('レイヤー 1');
    doc.layers.push(layer);
    doc.activeId = layer.id;
    setDocName('無題');
    history.clear();
    afterDocumentLoaded();
  }

  function afterDocumentLoaded() {
    structureChanged();
    if (stageW > 0) {
      hasFitted = true;
      fitView();
    }
  }

  async function loadDocument(data) {
    const images = await Promise.all(data.layers.map((layer) => storage.loadImage(layer.image)));
    resetDocument(data.width, data.height);
    doc.background = data.background === 'transparent' ? 'transparent' : 'white';
    data.layers.forEach((item, index) => {
      const layer = createLayer(String(item.name || `レイヤー ${index + 1}`).slice(0, 60));
      layer.visible = item.visible !== false;
      layer.locked = Boolean(item.locked);
      layer.alphaLock = Boolean(item.alphaLock);
      layer.clip = Boolean(item.clip);
      layer.opacity = clamp(Number(item.opacity ?? 1), 0, 1);
      layer.blend = BLEND_LABELS[item.blend] ? item.blend : 'source-over';
      layer.ctx.drawImage(images[index], 0, 0);
      doc.layers.push(layer);
    });
    const active = doc.layers[clamp(Number(data.activeIndex) || 0, 0, doc.layers.length - 1)];
    doc.activeId = active.id;
    setDocName(data.name);
    history.clear();
    afterDocumentLoaded();
  }

  function layerMeta(layer) {
    const meta = {};
    LAYER_PROPS.forEach((key) => {
      meta[key] = layer[key];
    });
    return meta;
  }

  async function serializeForAutosave() {
    const layers = await Promise.all(
      doc.layers.map(async (layer) => ({ ...layerMeta(layer), image: await storage.canvasToBlob(layer.canvas) })),
    );
    return {
      name: doc.name,
      width: doc.width,
      height: doc.height,
      background: doc.background,
      activeIndex: activeIndex(),
      layers,
      savedAt: Date.now(),
    };
  }

  let autosaveTimer = null;
  let autosaveWarned = false;

  function setSaveStatus(text) {
    saveStatus.textContent = text;
  }

  function scheduleAutosave() {
    setSaveStatus('保存待ち…');
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(runAutosave, 1500);
  }

  async function runAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if ((action && action.type === 'draw') || transformSession) {
      scheduleAutosave();
      return;
    }
    try {
      await storage.saveAutosave(await serializeForAutosave());
      setSaveStatus('自動保存済み');
    } catch (error) {
      console.warn('Autosave failed', error);
      setSaveStatus('自動保存できません');
      if (!autosaveWarned) {
        autosaveWarned = true;
        toast('自動保存できませんでした。メニューからプロジェクトを保存してください');
      }
    }
  }

  function safeFileName(name) {
    return (name || '').replace(/[\\/:*?"<>|]/g, '_').trim() || defaultFileBase();
  }

  // ASCII default, because some browsers ignore non-ASCII download names.
  function defaultFileBase() {
    if (doc.name && doc.name !== '無題') return doc.name;
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `paint-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  function saveProject() {
    const json = storage.toProjectJson({
      name: doc.name,
      width: doc.width,
      height: doc.height,
      background: doc.background,
      activeIndex: activeIndex(),
      layers: doc.layers.map((layer) => ({ ...layerMeta(layer), image: layer.canvas.toDataURL('image/png') })),
    });
    storage.downloadBlob(new Blob([json], { type: 'application/json' }), `${safeFileName(defaultFileBase())}.paintproj`);
    toast('プロジェクトを保存しました');
  }

  const openFileInput = $('openFileInput');

  async function openProject() {
    const ok = await confirmAction({
      title: 'プロジェクトを開く',
      message: '今のキャンバスを閉じて、選んだプロジェクトを開きます。残したい場合は先にプロジェクトを保存してください。',
      okLabel: 'ファイルを選ぶ',
    });
    if (!ok) return;
    openFileInput.value = '';
    openFileInput.click();
  }

  openFileInput.addEventListener('change', async () => {
    const file = openFileInput.files && openFileInput.files[0];
    if (!file) return;
    try {
      const data = storage.parseProjectJson(await file.text());
      if (!data.name) data.name = file.name.replace(/\.paintproj$|\.json$/i, '');
      await loadDocument(data);
      scheduleAutosave();
      toast('プロジェクトを開きました');
    } catch (error) {
      toast(error.message || 'ファイルを開けませんでした');
    }
  });

  function openNewDialog() {
    const preset = $('newPreset');
    const width = $('newWidth');
    const height = $('newHeight');
    const applyPreset = () => {
      if (preset.value === 'custom') return;
      const [w, h] = preset.value.split('x').map(Number);
      width.value = w;
      height.value = h;
    };
    preset.onchange = applyPreset;
    width.oninput = () => {
      preset.value = 'custom';
    };
    height.oninput = width.oninput;
    const current = `${doc.width}x${doc.height}`;
    preset.value = Array.from(preset.options).some((o) => o.value === current) ? current : 'custom';
    width.value = doc.width;
    height.value = doc.height;
    openDialog($('newDialog')).then((result) => {
      if (result !== 'ok') return;
      const w = clamp(Math.round(Number(width.value)), 16, 4096);
      const h = clamp(Math.round(Number(height.value)), 16, 4096);
      newDocument(w, h);
      scheduleAutosave();
    });
  }

  function openExportDialog() {
    const name = $('exportName');
    const transparent = $('exportTransparent');
    name.value = safeFileName(defaultFileBase());
    transparent.checked = doc.background === 'transparent';
    openDialog($('exportDialog'), () => name.select()).then(async (result) => {
      if (result !== 'ok') return;
      await exportPng(safeFileName(name.value.replace(/\.png$/i, '')), transparent.checked);
    });
  }

  async function exportPng(filename, transparent) {
    const out = makeCanvas(doc.width, doc.height);
    const ctx = out.getContext('2d');
    if (!transparent) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, doc.width, doc.height);
    }
    const flat = makeCanvas(doc.width, doc.height);
    composeInto(flat.getContext('2d'), false);
    ctx.drawImage(flat, 0, 0);
    storage.downloadBlob(await storage.canvasToBlob(out), `${filename}.png`);
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  function isTyping(target) {
    return target && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
  }

  function refreshShapeModifiers(event) {
    if (action && action.type === 'draw' && action.kind === 'shape') {
      action.shift = event.shiftKey;
      action.alt = event.altKey;
      drawShapeBuffer(action);
      invalidate();
    }
  }

  function onKeyDown(event) {
    if (document.querySelector('dialog[open]')) return;
    if (transformSession && !isTyping(event.target)) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelTransform();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        applyTransform();
        return;
      }
    }
    if (event.key === 'Escape') {
      closeMenu();
      closeSheet();
      return;
    }
    const typing = isTyping(event.target) && event.target.type !== 'range' && event.target.type !== 'checkbox';
    if (typing) return;

    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;

    if (mod) {
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === 'y') {
        event.preventDefault();
        redo();
      } else if (key === 's') {
        event.preventDefault();
        saveProject();
      } else if (key === 'o') {
        event.preventDefault();
        openProject();
      } else if (key === '0') {
        event.preventDefault();
        fitView();
      } else if (key === '=' || key === '+' || key === ';') {
        event.preventDefault();
        zoomAt(stageCenter(), 1.25);
      } else if (key === '-') {
        event.preventDefault();
        zoomAt(stageCenter(), 0.8);
      }
      return;
    }

    if (event.key === ' ') {
      event.preventDefault();
      if (!spaceDown) {
        spaceDown = true;
        updateCursor();
      }
      return;
    }
    if (event.key === 'Alt') {
      event.preventDefault();
      altDown = true;
      refreshShapeModifiers(event);
      updateCursor();
      return;
    }
    if (event.key === 'Shift') {
      refreshShapeModifiers(event);
      return;
    }

    if (key === '[') changeSize(1 / 1.15);
    else if (key === ']') changeSize(1.15);
    else if (key === 'r') rotateBy(event.shiftKey ? -15 : 15);
    else if (!event.repeat && TOOL_KEYS[key]) setTool(TOOL_KEYS[key]);
  }

  function onKeyUp(event) {
    if (event.key === ' ') {
      if (!isTyping(event.target)) event.preventDefault();
      spaceDown = false;
      updateCursor();
    } else if (event.key === 'Alt') {
      altDown = false;
      refreshShapeModifiers(event);
      updateCursor();
    } else if (event.key === 'Shift') {
      refreshShapeModifiers(event);
    }
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function bindEvents() {
    // Enter leaves text and number fields so tool shortcuts work again.
    document.querySelectorAll('input[type="text"], input[type="number"]').forEach((input) => {
      if (input.closest('dialog')) return;
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') input.blur();
      });
    });

    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerCancel);
    stage.addEventListener('pointerleave', () => {
      hover.visible = false;
      requestRender();
    });
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('contextmenu', (event) => event.preventDefault());
    // Safari: stop the page itself from zooming on pinch.
    document.addEventListener('gesturestart', (event) => event.preventDefault());

    toolButtons.forEach((button) => {
      button.addEventListener('click', () => {
        setTool(button.dataset.tool);
        if (mobileQuery.matches) closeSheet();
      });
    });

    undoButtons.forEach((button) => button.addEventListener('click', undo));
    redoButtons.forEach((button) => button.addEventListener('click', redo));
    $('zoomInBtn').addEventListener('click', () => zoomAt(stageCenter(), 1.25));
    $('zoomOutBtn').addEventListener('click', () => zoomAt(stageCenter(), 0.8));
    zoomLabel.addEventListener('click', setZoom100);
    $('fitBtn').addEventListener('click', fitView);
    $('rotateLeftBtn').addEventListener('click', () => rotateBy(-15));
    $('rotateRightBtn').addEventListener('click', () => rotateBy(15));

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', () => {
      spaceDown = false;
      altDown = false;
      updateCursor();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && autosaveTimer) runAutosave();
    });

    new ResizeObserver(onStageResize).observe(stage);
    window.addEventListener('resize', () => {
      stageRect = stage.getBoundingClientRect();
    });

    bindOptionBar();
    bindColorUI();
    bindLayerPanel();
    bindTransformUI();
    bindMenu();
    bindSheets();
  }

  async function init() {
    bindEvents();
    setColor(currentColor);
    renderSwatches();
    setTool(tool);

    let restored = false;
    try {
      const saved = await storage.loadAutosave();
      if (saved && Array.isArray(saved.layers) && saved.layers.length) {
        await loadDocument(saved);
        restored = true;
        setSaveStatus('自動保存済み');
      }
    } catch (error) {
      console.warn('Could not restore autosave', error);
    }
    if (!restored) newDocument(1280, 720);
    onHistoryChange();
    if (restored) setSaveStatus('自動保存済み');

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  init();
})();
