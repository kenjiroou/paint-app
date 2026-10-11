(function () {
  'use strict';

  const Paint = (window.Paint = window.Paint || {});

  const MAX_STEPS = 60;
  const MAX_BYTES = 300 * 1024 * 1024;

  // Each entry is { undo(), redo(), bytes }. Entries are applied synchronously,
  // so pressing undo repeatedly always runs in order.
  class History {
    constructor(onChange) {
      this.undoStack = [];
      this.redoStack = [];
      this.onChange = onChange;
    }

    push(entry) {
      this.undoStack.push(entry);
      this.redoStack = [];
      this.trim();
      this.onChange();
    }

    trim() {
      let total = this.undoStack.reduce((sum, entry) => sum + (entry.bytes || 0), 0);
      while (this.undoStack.length > MAX_STEPS || (total > MAX_BYTES && this.undoStack.length > 1)) {
        const removed = this.undoStack.shift();
        total -= removed.bytes || 0;
      }
    }

    undo() {
      const entry = this.undoStack.pop();
      if (!entry) return false;
      entry.undo();
      this.redoStack.push(entry);
      this.onChange();
      return true;
    }

    redo() {
      const entry = this.redoStack.pop();
      if (!entry) return false;
      entry.redo();
      this.undoStack.push(entry);
      this.onChange();
      return true;
    }

    clear() {
      this.undoStack = [];
      this.redoStack = [];
      this.onChange();
    }

    canUndo() {
      return this.undoStack.length > 0;
    }

    canRedo() {
      return this.redoStack.length > 0;
    }
  }

  Paint.History = History;
})();
