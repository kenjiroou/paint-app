(function () {
  'use strict';

  const Paint = (window.Paint = window.Paint || {});

  const DB_NAME = 'paint-app';
  const STORE = 'docs';
  const AUTOSAVE_KEY = 'autosave';
  const PROJECT_FORMAT = 'paint-app-project';

  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
          reject(new Error('IndexedDB is not available'));
          return;
        }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  }

  async function put(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function get(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function canvasToBlob(canvas, type = 'image/png') {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), type);
    });
  }

  // Accepts a Blob or a data URL.
  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = source instanceof Blob ? URL.createObjectURL(source) : source;
      image.onload = () => {
        if (source instanceof Blob) URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        if (source instanceof Blob) URL.revokeObjectURL(url);
        reject(new Error('画像を読み込めませんでした'));
      };
      image.src = url;
    });
  }

  function saveAutosave(data) {
    return put(AUTOSAVE_KEY, data);
  }

  function loadAutosave() {
    return get(AUTOSAVE_KEY);
  }

  function toProjectJson(data) {
    return JSON.stringify({ format: PROJECT_FORMAT, version: 1, ...data });
  }

  function parseProjectJson(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('プロジェクトファイルの形式が正しくありません');
    }
    const validSize = (n) => Number.isInteger(n) && n >= 1 && n <= 8192;
    if (
      !data ||
      data.format !== PROJECT_FORMAT ||
      !validSize(data.width) ||
      !validSize(data.height) ||
      !Array.isArray(data.layers) ||
      data.layers.length === 0 ||
      data.layers.some((layer) => typeof layer.image !== 'string' || !layer.image.startsWith('data:image/'))
    ) {
      throw new Error('このアプリのプロジェクトファイルではありません');
    }
    return data;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  Paint.storage = {
    saveAutosave,
    loadAutosave,
    canvasToBlob,
    loadImage,
    toProjectJson,
    parseProjectJson,
    downloadBlob,
  };
})();
