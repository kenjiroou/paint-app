(function () {
  'use strict';

  const Paint = (window.Paint = window.Paint || {});

  // Scanline flood fill. Returns a mask (1 = fill) and its bounding box,
  // or null when the start point is outside the image.
  function floodFill(imageData, startX, startY, tolerance, expand) {
    const { width, height, data } = imageData;
    if (startX < 0 || startY < 0 || startX >= width || startY >= height) return null;

    const start = (startY * width + startX) * 4;
    const tr = data[start];
    const tg = data[start + 1];
    const tb = data[start + 2];
    const ta = data[start + 3];

    const matches = (pixel) => {
      const i = pixel * 4;
      const a = data[i + 3];
      if (a === 0 && ta === 0) return true;
      return (
        Math.abs(data[i] - tr) <= tolerance &&
        Math.abs(data[i + 1] - tg) <= tolerance &&
        Math.abs(data[i + 2] - tb) <= tolerance &&
        Math.abs(a - ta) <= tolerance
      );
    };

    const mask = new Uint8Array(width * height);
    let minX = startX;
    let maxX = startX;
    let minY = startY;
    let maxY = startY;
    const stack = [startX, startY];

    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      const row = y * width;
      if (mask[row + x] || !matches(row + x)) continue;

      let left = x;
      while (left > 0 && !mask[row + left - 1] && matches(row + left - 1)) left -= 1;
      let right = x;
      while (right < width - 1 && !mask[row + right + 1] && matches(row + right + 1)) right += 1;

      for (let i = left; i <= right; i += 1) mask[row + i] = 1;
      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      for (const ny of [y - 1, y + 1]) {
        if (ny < 0 || ny >= height) continue;
        const nrow = ny * width;
        let inRun = false;
        for (let i = left; i <= right; i += 1) {
          const open = !mask[nrow + i] && matches(nrow + i);
          if (open && !inRun) {
            stack.push(i, ny);
            inRun = true;
          } else if (!open) {
            inRun = false;
          }
        }
      }
    }

    // Grow the area a little so anti-aliased line edges do not leave a gap.
    for (let step = 0; step < expand; step += 1) {
      const x0 = Math.max(0, minX - 1);
      const x1 = Math.min(width - 1, maxX + 1);
      const y0 = Math.max(0, minY - 1);
      const y1 = Math.min(height - 1, maxY + 1);
      const grown = [];
      for (let y = y0; y <= y1; y += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const i = y * width + x;
          if (mask[i]) continue;
          if (
            (x > 0 && mask[i - 1]) ||
            (x < width - 1 && mask[i + 1]) ||
            (y > 0 && mask[i - width]) ||
            (y < height - 1 && mask[i + width])
          ) {
            grown.push(i);
          }
        }
      }
      grown.forEach((i) => {
        mask[i] = 1;
      });
      minX = x0;
      maxX = x1;
      minY = y0;
      maxY = y1;
    }

    return { mask, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
  }

  Paint.floodFill = floodFill;
})();
