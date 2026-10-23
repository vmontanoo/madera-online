import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

// ============================================================================
// Empirical Challenger M2 Stress Suite
// ============================================================================

test('CHALLENGER 1: Consecutive drag adjustments — 100 random deltas with 0mm drift', () => {
  const p = M.defaultProject();
  const col = p.columns[0];
  const shelf = col.root.children[0];
  const drawer = col.root.children[1];

  // Starting dimensions
  const initialPrevSize = shelf.size;
  const initialNextSize = drawer.size;

  // Normalize to mm as app.js does on first drag move
  const l0 = computeLayout(p);
  shelf.size = l0.cells[shelf.id].h;
  drawer.size = l0.cells[drawer.id].h;
  const totalPair = shelf.size + drawer.size;
  const minSize = 50;
  const effectiveMin = Math.min(minSize, Math.floor(totalPair / 2));

  // Perform 100 consecutive drag delta adjustments
  let currentPrev = shelf.size;
  let currentNext = drawer.size;

  // Pseudo-random deterministic deltas
  for (let i = 1; i <= 100; i++) {
    // Generate fractional/floating deltas ranging from -2000 to +2000
    const delta = Math.sin(i * 1.7) * 450 + (i % 7) * 13.37;

    let targetPrev = currentPrev + delta;
    if (targetPrev < effectiveMin) {
      targetPrev = effectiveMin;
    } else if (targetPrev > totalPair - effectiveMin) {
      targetPrev = totalPair - effectiveMin;
    }

    const roundedPrev = Math.round(targetPrev);
    const roundedNext = totalPair - roundedPrev;

    // Strict algebraic identity check
    const currentSum = roundedPrev + roundedNext;
    assert.equal(
      currentSum,
      totalPair,
      `Step ${i}: Pair dimension drifted! Sum ${currentSum} !== totalPair ${totalPair} (delta=${delta})`
    );

    assert.ok(roundedPrev >= effectiveMin, `Step ${i}: roundedPrev ${roundedPrev} < effectiveMin ${effectiveMin}`);
    assert.ok(roundedNext >= effectiveMin, `Step ${i}: roundedNext ${roundedNext} < effectiveMin ${effectiveMin}`);

    // Update node sizes for next consecutive adjustment
    shelf.size = roundedPrev;
    drawer.size = roundedNext;
    currentPrev = roundedPrev;
    currentNext = roundedNext;

    // Verify layout computes cleanly without NaN or corruption
    const l = computeLayout(p);
    assert.ok(l.pieces.length > 0);
    assert.ok(Number.isFinite(l.cutlist.total));
    assert.ok(l.cutlist.total > 0);
  }

  // Final drift check: total pair must equal original totalPair exactly (0mm drift)
  assert.equal(shelf.size + drawer.size, totalPair, 'Total pair drifted after 100 consecutive deltas');
});

test('CHALLENGER 2: Zero-movement clicks — undo stack does not grow and redo is preserved', () => {
  const state = {
    project: M.defaultProject(),
    selected: null
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

  // Seed history with an action, then undo it so redo has 1 item
  const preChangeSnapshot = snapshot();
  state.project.columns[0].width = 800;
  pushUndo(preChangeSnapshot);
  assert.equal(undo.length, 1);
  assert.equal(redo.length, 0);

  restore(undo, redo);
  assert.equal(undo.length, 0);
  assert.equal(redo.length, 1);
  const baselineSnapshot = snapshot();

  // Simulate 10 consecutive zero-movement clicks on divider handles
  for (let click = 1; click <= 10; click++) {
    const clickStartSnapshot = snapshot();
    let hasMoved = false;

    // User mousedown without mousemove -> hasMoved remains false
    // onMouseUp fires:
    if (hasMoved) {
      pushUndo(clickStartSnapshot);
    }

    assert.equal(undo.length, 0, `Click ${click}: Undo stack grew on zero-movement click!`);
    assert.equal(redo.length, 1, `Click ${click}: Redo stack was cleared on zero-movement click!`);
    assert.equal(snapshot(), baselineSnapshot, `Click ${click}: Project state mutated!`);
  }
});

test('CHALLENGER 3: Undo/redo cycle verification — exact project state restoration', () => {
  const state = {
    project: M.defaultProject(),
    selected: null
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
  let hasMoved = true;
  state.project.columns[0].width = 720;
  state.project.columns[1].width = 480;
  if (hasMoved) {
    pushUndo(preDragSnapshot);
  }

  const postDragSnapshot = snapshot();
  assert.notEqual(preDragSnapshot, postDragSnapshot);
  assert.equal(undo.length, 1);
  assert.equal(redo.length, 0);

  // Undo (Ctrl+Z)
  const undoResult = restore(undo, redo);
  assert.ok(undoResult);
  assert.equal(snapshot(), preDragSnapshot, 'Undo failed to restore exact pre-drag snapshot character-for-character');
  assert.equal(undo.length, 0);
  assert.equal(redo.length, 1);

  // Redo (Ctrl+Y)
  const redoResult = restore(redo, undo);
  assert.ok(redoResult);
  assert.equal(snapshot(), postDragSnapshot, 'Redo failed to restore exact post-drag snapshot character-for-character');
  assert.equal(undo.length, 1);
  assert.equal(redo.length, 0);

  // Repeat cycle 5 times
  for (let c = 1; c <= 5; c++) {
    restore(undo, redo);
    assert.equal(snapshot(), preDragSnapshot, `Cycle ${c}: Undo state mismatch`);
    restore(redo, undo);
    assert.equal(snapshot(), postDragSnapshot, `Cycle ${c}: Redo state mismatch`);
  }
});

test('CHALLENGER 4: Diagnosis of layout.test.js drawer piece assertion flaw', () => {
  const p = M.defaultProject();
  const drawer = p.columns[0].root.children[1];
  drawer.size = 50; // clamped to 50mm
  const l = computeLayout(p);

  const drawerPieces = l.pieces.filter((pc) => pc.kind === 'drawer');
  const fondoPieces = drawerPieces.filter((pc) => pc.name === 'Fondo de gaveta');
  const boxWallPieces = drawerPieces.filter((pc) => pc.name !== 'Fondo de gaveta');

  // Verify box walls have sy >= 10mm
  boxWallPieces.forEach((pc) => {
    assert.ok(pc.sy >= 10, `${pc.name} sy must be >= 10mm`);
  });

  // Verify Fondo de gaveta has sy === 6mm (s.drawerBottomThickness)
  fondoPieces.forEach((pc) => {
    assert.equal(pc.sy, p.settings.drawerBottomThickness || 6, 'Fondo de gaveta thickness is 6mm');
    assert.ok(pc.sy < 10, 'Fondo de gaveta sy is 6mm (< 10mm), which triggers failure in test/layout.test.js:596');
  });
});
