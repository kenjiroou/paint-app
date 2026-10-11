(function () {
  'use strict';

  const Paint = (window.Paint = window.Paint || {});

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hexToRgb(hex) {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
    const num = Number.parseInt(full, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function rgbToHex(r, g, b) {
    const toHex = (v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // h: 0-360, s/v: 0-1
  function hsvToRgb(h, s, v) {
    const c = v * s;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (hp < 1) [r, g, b] = [c, x, 0];
    else if (hp < 2) [r, g, b] = [x, c, 0];
    else if (hp < 3) [r, g, b] = [0, c, x];
    else if (hp < 4) [r, g, b] = [0, x, c];
    else if (hp < 5) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const m = v - c;
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }

  function rgbToHsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === rn) h = 60 * (((gn - bn) / d) % 6);
      else if (max === gn) h = 60 * ((bn - rn) / d + 2);
      else h = 60 * ((rn - gn) / d + 4);
    }
    return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
  }

  function normalizeHex(text) {
    const value = String(text).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(value) || /^[0-9a-f]{6}$/i.test(value)) {
      const { r, g, b } = hexToRgb(value);
      return rgbToHex(r, g, b);
    }
    return null;
  }

  // Hue ring with a saturation/value square inside it.
  class ColorPicker {
    constructor(canvas, onChange) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.onChange = onChange;
      this.hsv = { h: 0, s: 0, v: 0 };
      this.dragMode = null;
      this.ringCache = null;
      this.size = 0;

      canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
      canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
      canvas.addEventListener('pointerup', (event) => this.onPointerUp(event));
      canvas.addEventListener('pointercancel', (event) => this.onPointerUp(event));

      if ('ResizeObserver' in window) {
        new ResizeObserver(() => this.resize()).observe(canvas);
      }
      this.resize();
    }

    resize() {
      const cssSize = this.canvas.clientWidth || 200;
      const dpr = window.devicePixelRatio || 1;
      const size = Math.round(cssSize * dpr);
      if (size === this.size || size === 0) return;
      this.size = size;
      this.dpr = dpr;
      this.canvas.width = size;
      this.canvas.height = size;
      this.ringCache = null;
      this.draw();
    }

    geometry() {
      const size = this.size;
      const center = size / 2;
      const outer = center - 2 * this.dpr;
      const ringWidth = Math.max(12, size * 0.1);
      const inner = outer - ringWidth;
      const side = (inner - 6 * this.dpr) * Math.SQRT2;
      return { center, outer, inner, side, x0: center - side / 2, y0: center - side / 2 };
    }

    buildRing() {
      const { center, outer, inner } = this.geometry();
      const ring = document.createElement('canvas');
      ring.width = this.size;
      ring.height = this.size;
      const ctx = ring.getContext('2d');
      // Small wedges instead of createConicGradient, for older Safari.
      for (let deg = 0; deg < 360; deg += 1) {
        const a0 = ((deg - 0.7) * Math.PI) / 180;
        const a1 = ((deg + 0.7) * Math.PI) / 180;
        const { r, g, b } = hsvToRgb(deg, 1, 1);
        ctx.fillStyle = rgbToHex(r, g, b);
        ctx.beginPath();
        ctx.arc(center, center, outer, a0, a1);
        ctx.arc(center, center, inner, a1, a0, true);
        ctx.closePath();
        ctx.fill();
      }
      this.ringCache = ring;
    }

    draw() {
      if (!this.size) return;
      if (!this.ringCache) this.buildRing();
      const ctx = this.ctx;
      const { center, outer, inner, side, x0, y0 } = this.geometry();
      const { h, s, v } = this.hsv;

      ctx.clearRect(0, 0, this.size, this.size);
      ctx.drawImage(this.ringCache, 0, 0);

      const hueColor = hsvToRgb(h, 1, 1);
      ctx.fillStyle = rgbToHex(hueColor.r, hueColor.g, hueColor.b);
      ctx.fillRect(x0, y0, side, side);
      const white = ctx.createLinearGradient(x0, 0, x0 + side, 0);
      white.addColorStop(0, 'rgba(255,255,255,1)');
      white.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = white;
      ctx.fillRect(x0, y0, side, side);
      const black = ctx.createLinearGradient(0, y0, 0, y0 + side);
      black.addColorStop(0, 'rgba(0,0,0,0)');
      black.addColorStop(1, 'rgba(0,0,0,1)');
      ctx.fillStyle = black;
      ctx.fillRect(x0, y0, side, side);

      const markerRadius = 6 * this.dpr;
      const angle = (h * Math.PI) / 180;
      const ringRadius = (outer + inner) / 2;
      this.drawMarker(center + Math.cos(angle) * ringRadius, center + Math.sin(angle) * ringRadius, markerRadius);
      this.drawMarker(x0 + s * side, y0 + (1 - v) * side, markerRadius);
    }

    drawMarker(x, y, radius) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.lineWidth = 3 * this.dpr;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.lineWidth = 1 * this.dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
    }

    setColor(hex) {
      const { r, g, b } = hexToRgb(hex);
      const next = rgbToHsv(r, g, b);
      // Keep the hue when the color is gray, so the ring marker does not jump.
      if (next.s === 0 || next.v === 0) next.h = this.hsv.h;
      if (next.v === 0) next.s = this.hsv.s;
      this.hsv = next;
      this.draw();
    }

    getHex() {
      const { r, g, b } = hsvToRgb(this.hsv.h, this.hsv.s, this.hsv.v);
      return rgbToHex(r, g, b);
    }

    localPoint(event) {
      const rect = this.canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * this.size,
        y: ((event.clientY - rect.top) / rect.height) * this.size,
      };
    }

    onPointerDown(event) {
      const point = this.localPoint(event);
      const { center, outer, inner, side, x0, y0 } = this.geometry();
      const dist = Math.hypot(point.x - center, point.y - center);
      if (dist >= inner - 4 * this.dpr && dist <= outer + 4 * this.dpr) {
        this.dragMode = 'hue';
      } else if (point.x >= x0 - 6 && point.x <= x0 + side + 6 && point.y >= y0 - 6 && point.y <= y0 + side + 6) {
        this.dragMode = 'sv';
      } else {
        return;
      }
      event.preventDefault();
      this.canvas.setPointerCapture(event.pointerId);
      this.update(point);
    }

    onPointerMove(event) {
      if (!this.dragMode) return;
      this.update(this.localPoint(event));
    }

    onPointerUp() {
      this.dragMode = null;
    }

    update(point) {
      const { center, side, x0, y0 } = this.geometry();
      if (this.dragMode === 'hue') {
        const angle = Math.atan2(point.y - center, point.x - center);
        this.hsv.h = ((angle * 180) / Math.PI + 360) % 360;
      } else {
        this.hsv.s = clamp((point.x - x0) / side, 0, 1);
        this.hsv.v = clamp(1 - (point.y - y0) / side, 0, 1);
      }
      this.draw();
      this.onChange(this.getHex());
    }
  }

  Paint.color = { clamp, hexToRgb, rgbToHex, hsvToRgb, rgbToHsv, normalizeHex };
  Paint.ColorPicker = ColorPicker;
})();
