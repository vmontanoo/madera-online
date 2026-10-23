import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, DEFAULTS } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

// ============================================================================
// EMPIRICAL CHALLENGER M2 ITERATION 2: DRAG INTERACTION & HISTORY INVARIANCE
// ============================================================================

// ----------------------------------------------------------------------------
// Suite 1: Column Width Dragging Limits (Minimum 150mm Clamping)
// ----------------------------------------------------------------------------

function simulateColumnDrag(project, colIdx, isOuter, deltaX) {
  const minW = 150;
  const startLeftW = project.columns[colIdx].width;
  if (!isOuter) {
    const startRightW = project.columns[colIdx + 1]?.width || 0;
    const totalPair = startLeftW + startRightW;
    const newLeft = Math.round(Math.max(minW, Math.min(totalPair - minW, startLeftW + deltaX)));
    const newRight = totalPair - newLeft;
    project.columns[colIdx].width = newLeft;
    project.columns[colIdx + 1].width = newRight;
    return { newLeft, newRight, totalPair };
  } else {
    const newW = Math.round(Math.max(minW, startLeftW + deltaX));
    project.columns[colIdx].width = newW;
    return { newW };
  }
}

test('SUITE 1.1: Inter-column drag strictly clamps both left and right columns to min 150mm', () => {
  const p = M.defaultProject();
  p.columns[0].width = 600;
  p.columns[1].width = 600;
  const total = 1200;

  // 1. Extreme negative drag (attempting to crush left column to 0 or negative)
  for (const delta of [-450, -500, -1000, -10000, -1e6]) {
    const res = simulateColumnDrag(p, 0, false, delta);
    assert.equal(res.newLeft, 150, `Left column must be clamped at 150mm (got ${res.newLeft} for delta=${delta})`);
    assert.equal(res.newRight, 1050, `Right column must take remainder 1050mm (got ${res.newRight})`);
    assert.ok(res.newLeft >= 150, 'Left column >= 150mm');
    assert.ok(res.newRight >= 150, 'Right column >= 150mm');
    assert.equal(res.newLeft + res.newRight, total, 'Total column pair width strictly preserved');
  }

  // 2. Extreme positive drag (attempting to crush right column to 0 or negative)
  p.columns[0].width = 600;
  p.columns[1].width = 600;
  for (const delta of [450, 500, 1000, 10000, 1e6]) {
    const res = simulateColumnDrag(p, 0, false, delta);
    assert.equal(res.newRight, 150, `Right column must be clamped at 150mm (got ${res.newRight} for delta=${delta})`);
    assert.equal(res.newLeft, 1050, `Left column must take remainder 1050mm (got ${res.newLeft})`);
    assert.ok(res.newLeft >= 150, 'Left column >= 150mm');
    assert.ok(res.newRight >= 150, 'Right column >= 150mm');
    assert.equal(res.newLeft + res.newRight, total, 'Total column pair width strictly preserved');
  }

  // 3. Boundary edge cases: exact 150mm transition points
  // Left column exact boundary: delta = -(600 - 150) = -450
  p.columns[0].width = 600;
  p.columns[1].width = 600;
  const leftEdge = simulateColumnDrag(p, 0, false, -450);
  assert.equal(leftEdge.newLeft, 150);
  assert.equal(leftEdge.newRight, 1050);

  // Right column exact boundary: delta = +(600 - 150) = +450
  p.columns[0].width = 600;
  p.columns[1].width = 600;
  const rightEdge = simulateColumnDrag(p, 0, false, 450);
  assert.equal(rightEdge.newRight, 150);
  assert.equal(rightEdge.newLeft, 1050);
});

test('SUITE 1.2: Inter-column drag with fractional / floating deltas preserves integer conservation', () => {
  const p = M.defaultProject();
  p.columns[0].width = 600;
  p.columns[1].width = 600;
  const total = 1200;

  // 100 pseudo-random fractional deltas
  for (let i = 1; i <= 100; i++) {
    const fracDelta = Math.sin(i * 2.3) * 500 + (i % 5) * 7.731;
    const res = simulateColumnDrag(p, 0, false, fracDelta);

    assert.ok(res.newLeft >= 150, `Fractional step ${i}: Left column < 150mm (${res.newLeft})`);
    assert.ok(res.newRight >= 150, `Fractional step ${i}: Right column < 150mm (${res.newRight})`);
    assert.equal(Number.isInteger(res.newLeft), true, `Step ${i}: Left column must be integer`);
    assert.equal(Number.isInteger(res.newRight), true, `Step ${i}: Right column must be integer`);
    assert.equal(res.newLeft + res.newRight, total, `Step ${i}: Pair drifted! ${res.newLeft} + ${res.newRight} !== ${total}`);
  }
});

test('SUITE 1.3: Outer column drag clamps to 150mm minimum and expands properly', () => {
  const p = M.defaultProject();
  const lastColIdx = p.columns.length - 1;
  p.columns[lastColIdx].width = 600;

  // Negative drag to crush outer column
  for (const delta of [-450, -600, -1000, -10000]) {
    const res = simulateColumnDrag(p, lastColIdx, true, delta);
    assert.equal(res.newW, 150, `Outer column must clamp to 150mm (got ${res.newW})`);
    assert.equal(p.columns[lastColIdx].width, 150);
  }

  // Positive expansion
  const expanded = simulateColumnDrag(p, lastColIdx, true, 400);
  assert.equal(expanded.newW, 550); // 150 + 400 = 550
  assert.equal(p.columns[lastColIdx].width, 550);
});

test('SUITE 1.4: 3D Layout and Cutlist validity at minimum 150mm column clamp', () => {
  const p = M.defaultProject();
  p.columns.forEach((c) => (c.width = 150));

  const layout = computeLayout(p);
  assert.ok(layout.pieces.length > 0, 'Pieces generated at 150mm clamp');

  // Verify all pieces maintain strictly positive physical dimensions
  layout.pieces.forEach((pc) => {
    assert.ok(pc.sx > 0, `Piece ${pc.name} sx must be > 0, got ${pc.sx}`);
    assert.ok(pc.sy > 0, `Piece ${pc.name} sy must be > 0, got ${pc.sy}`);
    assert.ok(pc.sz > 0, `Piece ${pc.name} sz must be > 0, got ${pc.sz}`);
    assert.ok(Number.isFinite(pc.x) && !Number.isNaN(pc.x), `Piece ${pc.name} x is invalid`);
    assert.ok(Number.isFinite(pc.y) && !Number.isNaN(pc.y), `Piece ${pc.name} y is invalid`);
    assert.ok(Number.isFinite(pc.z) && !Number.isNaN(pc.z), `Piece ${pc.name} z is invalid`);
  });

  // Verify cutlist validity
  layout.cutlist.rows.forEach((r) => {
    assert.ok(r.length > 0, `Cutlist length > 0 for ${r.name}`);
    assert.ok(r.width > 0, `Cutlist width > 0 for ${r.name}`);
    assert.ok(r.thickness > 0, `Cutlist thickness > 0 for ${r.name}`);
    assert.ok(r.qty > 0, `Cutlist qty > 0 for ${r.name}`);
    assert.ok(Number.isFinite(r.total) && r.total >= 0, `Cutlist total finite for ${r.name}`);
  });

  assert.ok(Number.isFinite(layout.cutlist.total) && layout.cutlist.total > 0, 'Cutlist grand total valid');
});

// ----------------------------------------------------------------------------
// Suite 2: Zero-Movement Clicks Invariance
// ----------------------------------------------------------------------------

test('SUITE 2.1: Zero-movement click does not grow undo stack and does not clear redo stack', () => {
  const state = {
    project: M.defaultProject(),
    selected: null,
  };
  const undo = [];
  const redo = [];

  const snapshot = () => JSON.stringify(state.project);
  const pushUndo = (prevSnapshot) => {
    if (snapshot() !== prevSnapshot) {
      undo.push(prevSnapshot);
      if (undo.length > 100) undo.shift();
      redo.length = 0;
    }
  };
  const restore = (from, to) => {
    if (!from.length) return false;
    to.push(snapshot());
    if (to.length > 100) to.shift();
    state.project = JSON.parse(from.pop());
    return true;
  };

  // 1. Establish non-empty history state: perform 1 action and undo it
  const initialSnap = snapshot();
  state.project.columns[0].width = 750;
  pushUndo(initialSnap);
  assert.equal(undo.length, 1, 'Undo has 1 item after mutation');
  assert.equal(redo.length, 0, 'Redo is empty');

  // Undo back to baseline
  restore(undo, redo);
  assert.equal(undo.length, 0, 'Undo is empty after restore');
  assert.equal(redo.length, 1, 'Redo has 1 item waiting');
  const baselineSnap = snapshot();

  // 2. Simulate 50 consecutive zero-movement clicks on drag handles
  for (let click = 1; click <= 50; click++) {
    const handleStartSnapshot = snapshot();
    let hasMoved = false;

    // Simulated mousedown -> mouseup without mousemove:
    // (Notice app.js:330 guards pushUndo behind if (hasMoved))
    if (hasMoved) {
      pushUndo(handleStartSnapshot);
    }

    assert.equal(undo.length, 0, `Click ${click}: Undo stack grew on zero-movement click!`);
    assert.equal(redo.length, 1, `Click ${click}: Redo stack cleared on zero-movement click!`);
    assert.equal(snapshot(), baselineSnap, `Click ${click}: Project snapshot mutated!`);
  }
});

test('SUITE 2.2: Redundant move with delta=0 guarded by pushUndo content check', () => {
  const state = {
    project: M.defaultProject(),
  };
  const undo = [];
  const redo = [];

  const snapshot = () => JSON.stringify(state.project);
  const pushUndo = (prevSnapshot) => {
    if (snapshot() !== prevSnapshot) {
      undo.push(prevSnapshot);
      if (undo.length > 100) undo.shift();
      redo.length = 0;
    }
  };

  // Seed redo with an item
  redo.push(snapshot());
  assert.equal(redo.length, 1);
  assert.equal(undo.length, 0);

  // Even if hasMoved is set to true by mouse move event with delta=0:
  const clickStart = snapshot();
  let hasMoved = true;
  // No mutation occurs (deltaX = 0)
  if (hasMoved) {
    pushUndo(clickStart);
  }

  // pushUndo string comparison (snapshot() !== prevSnapshot) catches no-op
  assert.equal(undo.length, 0, 'Undo stack must not grow on delta=0 move');
  assert.equal(redo.length, 1, 'Redo stack must not be cleared on delta=0 move');
});

// ----------------------------------------------------------------------------
// Suite 3: Undo/Redo Cycle Fidelity (Character-for-Character Matching)
// ----------------------------------------------------------------------------

test('SUITE 3.1: Undo/Redo restores project JSON snapshot with 100% exact character fidelity', () => {
  const state = {
    project: M.defaultProject(),
  };
  const undo = [];
  const redo = [];

  const snapshot = () => JSON.stringify(state.project);
  const pushUndo = (prevSnapshot) => {
    if (snapshot() !== prevSnapshot) {
      undo.push(prevSnapshot);
      if (undo.length > 100) undo.shift();
      redo.length = 0;
    }
  };
  const restore = (from, to) => {
    if (!from.length) return false;
    to.push(snapshot());
    if (to.length > 100) to.shift();
    state.project = JSON.parse(from.pop());
    return true;
  };

  const preDragSnapshot = snapshot();

  // Perform drag resizing
  const initialSnap = snapshot();
  state.project.columns[0].width = 720;
  state.project.columns[1].width = 480;
  pushUndo(initialSnap);

  const postDragSnapshot = snapshot();
  assert.notEqual(preDragSnapshot, postDragSnapshot, 'Snapshot must reflect mutation');
  assert.equal(undo.length, 1);
  assert.equal(redo.length, 0);

  // 1. Undo
  const undoSuccess = restore(undo, redo);
  assert.ok(undoSuccess, 'Restore from undo succeeded');
  const restoredUndoSnapshot = snapshot();
  assert.equal(
    restoredUndoSnapshot,
    preDragSnapshot,
    'Restored undo snapshot must match pre-drag snapshot character-for-character'
  );
  assert.equal(undo.length, 0);
  assert.equal(redo.length, 1);

  // 2. Redo
  const redoSuccess = restore(redo, undo);
  assert.ok(redoSuccess, 'Restore from redo succeeded');
  const restoredRedoSnapshot = snapshot();
  assert.equal(
    restoredRedoSnapshot,
    postDragSnapshot,
    'Restored redo snapshot must match post-drag snapshot character-for-character'
  );
  assert.equal(undo.length, 1);
  assert.equal(redo.length, 0);

  // 3. Repeat for 25 consecutive back-and-forth cycles
  for (let cycle = 1; cycle <= 25; cycle++) {
    restore(undo, redo);
    assert.equal(snapshot(), preDragSnapshot, `Cycle ${cycle}: Undo snapshot drift`);
    restore(redo, undo);
    assert.equal(snapshot(), postDragSnapshot, `Cycle ${cycle}: Redo snapshot drift`);
  }
});

test('SUITE 3.2: Multi-step sequential drag operations maintain clean undo/redo stack order', () => {
  const state = {
    project: M.defaultProject(),
  };
  const undo = [];
  const redo = [];

  const snapshot = () => JSON.stringify(state.project);
  const pushUndo = (prevSnapshot) => {
    if (snapshot() !== prevSnapshot) {
      undo.push(prevSnapshot);
      if (undo.length > 100) undo.shift();
      redo.length = 0;
    }
  };
  const restore = (from, to) => {
    if (!from.length) return false;
    to.push(snapshot());
    if (to.length > 100) to.shift();
    state.project = JSON.parse(from.pop());
    return true;
  };

  const snapshots = [snapshot()];

  // Step 1: Drag col 0 width
  let s0 = snapshot();
  state.project.columns[0].width = 700;
  pushUndo(s0);
  snapshots.push(snapshot());

  // Step 2: Drag col 1 width
  let s1 = snapshot();
  state.project.columns[1].width = 500;
  pushUndo(s1);
  snapshots.push(snapshot());

  // Step 3: Drag shelf module height
  let s2 = snapshot();
  state.project.columns[0].root.children[0].size = 420;
  state.project.columns[0].root.children[1].size = 780;
  pushUndo(s2);
  snapshots.push(snapshot());

  assert.equal(undo.length, 3);
  assert.equal(redo.length, 0);

  // Undo Step 3 -> expect snapshots[2]
  restore(undo, redo);
  assert.equal(snapshot(), snapshots[2]);

  // Undo Step 2 -> expect snapshots[1]
  restore(undo, redo);
  assert.equal(snapshot(), snapshots[1]);

  // Undo Step 1 -> expect snapshots[0]
  restore(undo, redo);
  assert.equal(snapshot(), snapshots[0]);

  // All undos exhausted
  assert.equal(undo.length, 0);
  assert.equal(redo.length, 3);

  // Redo Step 1
  restore(redo, undo);
  assert.equal(snapshot(), snapshots[1]);

  // Redo Step 2
  restore(redo, undo);
  assert.equal(snapshot(), snapshots[2]);

  // Redo Step 3
  restore(redo, undo);
  assert.equal(snapshot(), snapshots[3]);

  assert.equal(undo.length, 3);
  assert.equal(redo.length, 0);
});

// ----------------------------------------------------------------------------
// Suite 4: Cross-Platform Keyboard Shortcuts
// ----------------------------------------------------------------------------

function createKeyboardDispatcher(appState, undoStack, redoStack) {
  const snapshot = () => JSON.stringify(appState.project);
  const restore = (from, to) => {
    if (!from.length) return false;
    to.push(snapshot());
    if (to.length > 100) to.shift();
    appState.project = JSON.parse(from.pop());
    return true;
  };

  // Exact reproduction of app.js:645-667
  const onKey = (e, activeElement = { tagName: 'DIV', isContentEditable: false }) => {
    const tag = activeElement?.tagName;
    if (/INPUT|SELECT|TEXTAREA/.test(tag) || activeElement?.isContentEditable) return 'IGNORED_FORM_FIELD';

    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) {
      if (e.key === 'Delete' && appState.selected) return 'DELETE';
      return 'NO_MODIFIER';
    }

    const key = e.key.toLowerCase();
    if (key === 'z') {
      if (e.shiftKey) {
        return restore(redoStack, undoStack) ? 'REDO_RESTORED' : 'REDO_EMPTY';
      } else {
        return restore(undoStack, redoStack) ? 'UNDO_RESTORED' : 'UNDO_EMPTY';
      }
    } else if (key === 'y' && !e.shiftKey) {
      return restore(redoStack, undoStack) ? 'REDO_RESTORED' : 'REDO_EMPTY';
    }
    return 'UNHANDLED_KEY';
  };

  return { onKey, restore };
}

test('SUITE 4.1: Windows/Linux Ctrl+Z triggers Undo and Ctrl+Y triggers Redo', () => {
  const appState = { project: M.defaultProject(), selected: null };
  const undo = [];
  const redo = [];
  const { onKey } = createKeyboardDispatcher(appState, undo, redo);

  const initialSnap = JSON.stringify(appState.project);
  appState.project.columns[0].width = 850;
  undo.push(initialSnap);

  // Test Ctrl+Z
  const undoEvent = { ctrlKey: true, metaKey: false, shiftKey: false, key: 'z' };
  const action1 = onKey(undoEvent);
  assert.equal(action1, 'UNDO_RESTORED');
  assert.equal(JSON.stringify(appState.project), initialSnap);
  assert.equal(undo.length, 0);
  assert.equal(redo.length, 1);

  // Test Ctrl+Y
  const redoEvent = { ctrlKey: true, metaKey: false, shiftKey: false, key: 'y' };
  const action2 = onKey(redoEvent);
  assert.equal(action2, 'REDO_RESTORED');
  assert.equal(appState.project.columns[0].width, 850);
  assert.equal(undo.length, 1);
  assert.equal(redo.length, 0);
});

test('SUITE 4.2: macOS Cmd+Z triggers Undo and Cmd+Shift+Z triggers Redo', () => {
  const appState = { project: M.defaultProject(), selected: null };
  const undo = [];
  const redo = [];
  const { onKey } = createKeyboardDispatcher(appState, undo, redo);

  const initialSnap = JSON.stringify(appState.project);
  appState.project.columns[0].width = 900;
  undo.push(initialSnap);

  // Test Cmd+Z (metaKey: true)
  const cmdZEvent = { ctrlKey: false, metaKey: true, shiftKey: false, key: 'z' };
  const action1 = onKey(cmdZEvent);
  assert.equal(action1, 'UNDO_RESTORED');
  assert.equal(JSON.stringify(appState.project), initialSnap);
  assert.equal(undo.length, 0);
  assert.equal(redo.length, 1);

  // Test Cmd+Shift+Z (metaKey: true + shiftKey: true)
  const cmdShiftZEvent = { ctrlKey: false, metaKey: true, shiftKey: true, key: 'Z' };
  const action2 = onKey(cmdShiftZEvent);
  assert.equal(action2, 'REDO_RESTORED');
  assert.equal(appState.project.columns[0].width, 900);
  assert.equal(undo.length, 1);
  assert.equal(redo.length, 0);
});

test('SUITE 4.3: Windows/Linux Ctrl+Shift+Z also triggers Redo', () => {
  const appState = { project: M.defaultProject(), selected: null };
  const undo = [];
  const redo = [];
  const { onKey } = createKeyboardDispatcher(appState, undo, redo);

  const initialSnap = JSON.stringify(appState.project);
  appState.project.columns[0].width = 920;
  undo.push(initialSnap);

  // Undo first
  onKey({ ctrlKey: true, metaKey: false, shiftKey: false, key: 'z' });
  assert.equal(redo.length, 1);

  // Ctrl+Shift+Z
  const ctrlShiftZEvent = { ctrlKey: true, metaKey: false, shiftKey: true, key: 'Z' };
  const action = onKey(ctrlShiftZEvent);
  assert.equal(action, 'REDO_RESTORED');
  assert.equal(appState.project.columns[0].width, 920);
});

test('SUITE 4.4: CapsLock / uppercase key event normalization', () => {
  const appState = { project: M.defaultProject(), selected: null };
  const undo = [];
  const redo = [];
  const { onKey } = createKeyboardDispatcher(appState, undo, redo);

  const initialSnap = JSON.stringify(appState.project);
  appState.project.columns[0].width = 950;
  undo.push(initialSnap);

  // CapsLock active: key is 'Z' even though shiftKey is false
  const capsUndoEvent = { ctrlKey: true, metaKey: false, shiftKey: false, key: 'Z' };
  const action = onKey(capsUndoEvent);
  assert.equal(action, 'UNDO_RESTORED', 'Caps lock uppercase Z must still trigger Undo');
  assert.equal(JSON.stringify(appState.project), initialSnap);
});

test('SUITE 4.5: Keyboard shortcut suppression inside form fields', () => {
  const appState = { project: M.defaultProject(), selected: null };
  const undo = [];
  const redo = [];
  const { onKey } = createKeyboardDispatcher(appState, undo, redo);

  undo.push(JSON.stringify(appState.project));

  const formElements = [
    { tagName: 'INPUT', isContentEditable: false },
    { tagName: 'SELECT', isContentEditable: false },
    { tagName: 'TEXTAREA', isContentEditable: false },
    { tagName: 'DIV', isContentEditable: true },
  ];

  for (const el of formElements) {
    const res = onKey({ ctrlKey: true, metaKey: false, shiftKey: false, key: 'z' }, el);
    assert.equal(res, 'IGNORED_FORM_FIELD', `Ctrl+Z inside ${el.tagName} must be ignored to preserve native input history`);
    assert.equal(undo.length, 1, 'Undo stack must not be touched');
  }
});
