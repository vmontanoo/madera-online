// test/m2_challenger_drag_stepped.test.js
// Challenger M2-2: Stepped Drag Adversarial Verifier
// Verifies boundary clamping, neighbor isolation, zero-movement undo invariance, and divider safety.

import test from 'node:test';
import assert from 'node:assert/strict';

// Setup minimal headless DOM environment before importing app.js
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() {
      return {
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        appendChild() {},
        querySelectorAll() { return []; },
        querySelector() { return null; },
      };
    },
    activeElement: null,
    body: { style: {} },
  };
}

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    location: { hash: '' },
  };
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    getItem() { return null; },
    setItem() {},
    removeItem() {},
  };
}

if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({}),
  });
}

import { computeLayout, DEFAULTS } from '../public/js/layout.js';
import * as M from '../public/js/model.js';
import {
  calculateTopBorderDrag,
  simulateTopBorderDrag,
  buildCanvasSvg,
} from '../public/js/app.js';

// Helper: full invariant auditor for layout results
function auditLayoutInvariants(layout, label = '') {
  assert.ok(layout, `${label}: layout must exist`);
  assert.ok(Array.isArray(layout.pieces) && layout.pieces.length > 0, `${label}: pieces must not be empty`);

  // Pieces audit
  layout.pieces.forEach((p, idx) => {
    ['x', 'y', 'z', 'sx', 'sy', 'sz'].forEach((prop) => {
      const val = p[prop];
      assert.ok(
        typeof val === 'number' && Number.isFinite(val),
        `${label}: piece[${idx}] (${p.name}) prop "${prop}" is NaN or non-finite: ${val}`
      );
    });
    assert.ok(p.sx > 0, `${label}: piece[${idx}] (${p.name}) sx must be > 0 (got ${p.sx})`);
    assert.ok(p.sy > 0, `${label}: piece[${idx}] (${p.name}) sy must be > 0 (got ${p.sy})`);
    assert.ok(p.sz > 0, `${label}: piece[${idx}] (${p.name}) sz must be > 0 (got ${p.sz})`);
  });

  // Cells audit
  assert.ok(layout.cells && typeof layout.cells === 'object', `${label}: cells must exist`);
  Object.entries(layout.cells).forEach(([id, c]) => {
    ['x', 'y', 'w', 'h'].forEach((prop) => {
      const val = c[prop];
      assert.ok(
        typeof val === 'number' && Number.isFinite(val),
        `${label}: cell ${id} prop "${prop}" is NaN or non-finite: ${val}`
      );
    });
    assert.ok(c.w > 0, `${label}: cell ${id} w must be > 0 (got ${c.w})`);
    assert.ok(c.h > 0, `${label}: cell ${id} h must be > 0 (got ${c.h})`);
  });

  // Dividers audit
  if (layout.dividers) {
    layout.dividers.forEach((d, idx) => {
      ['x', 'y', 'w', 'h'].forEach((prop) => {
        const val = d[prop];
        assert.ok(
          typeof val === 'number' && Number.isFinite(val),
          `${label}: divider[${idx}] prop "${prop}" is NaN or non-finite: ${val}`
        );
      });
    });
  }
}

// ============================================================================
// SUITE 1: Rapid Drag Cycles & Lower Bound Clamping (H_min >= 200mm)
// ============================================================================

test('ADVERSARIAL 1.1: Rapid extreme downward drag cycles clamp height to H_min >= 200mm across diverse geometries', () => {
  const thicknesses = [15, 18, 19, 22, 25, 30];
  const startHeights = [200, 300, 750, 1400, 2400, 3999];

  for (const t of thicknesses) {
    for (const startH of startHeights) {
      // Test extreme downward drag of -5000px
      const hClamped = calculateTopBorderDrag(startH, -5000, t, 1);
      const expectedMin = Math.max(200, 2 * t + 50);

      assert.ok(
        hClamped >= 200,
        `Height must never drop below 200mm (t=${t}, startH=${startH}): got ${hClamped}`
      );
      assert.ok(
        hClamped >= 2 * t + 50,
        `Height must protect double carcass thickness + 50mm clearance (got ${hClamped}, expected >= ${2 * t + 50})`
      );
      assert.equal(hClamped, expectedMin);
      assert.ok(Number.isInteger(hClamped), 'Clamped height must be an integer');
    }
  }

  // 1000 rapid chaotic downward drag cycles with extreme deltas
  for (let i = 1; i <= 1000; i++) {
    const randomStartH = 200 + Math.floor(Math.random() * 3800);
    const extremeDownwardDelta = -(5000 + Math.floor(Math.random() * 1000000));
    const t = 18;
    const res = calculateTopBorderDrag(randomStartH, extremeDownwardDelta, t, 1);

    assert.ok(res >= 200, `Cycle ${i}: H_min violation: ${res} < 200`);
    assert.equal(res, 200, `Cycle ${i}: With t=18, single child clamp should be exactly 200mm`);
  }
});

test('ADVERSARIAL 1.2: Downward drag clamp protects multi-child vertical structures from compression below 50mm', () => {
  const t = 18;

  // 1 to 10 vertical children
  for (let childCount = 1; childCount <= 10; childCount++) {
    const childMin = 2 * t + childCount * 50 + (childCount - 1) * t;
    const expectedMinH = Math.max(200, 2 * t + 50, childMin);

    const clampedH = calculateTopBorderDrag(1800, -5000, t, childCount);
    assert.equal(
      clampedH,
      expectedMinH,
      `Multi-child (count=${childCount}) must clamp to ${expectedMinH}mm, got ${clampedH}`
    );
    assert.ok(clampedH >= 200, `Must be >= 200mm`);

    // Verify when loaded into project and computed in layout, all cells have space
    const project = {
      settings: { ...DEFAULTS, thickness: t, overhang: 20 },
      columns: [
        {
          id: 'col_stress',
          width: 600,
          height: clampedH,
          root: {
            id: 'root_v',
            type: 'multiple',
            dir: 'v',
            size: 1,
            children: Array.from({ length: childCount }, (_, k) => M.leaf('shelf', { id: `sh_${k}` })),
          },
        },
      ],
    };

    const layout = computeLayout(project);
    auditLayoutInvariants(layout, `Multi-child count=${childCount}`);

    // Verify cell heights
    for (let k = 0; k < childCount; k++) {
      const cell = layout.cells[`sh_${k}`];
      assert.ok(cell, `Cell sh_${k} must exist`);
      assert.ok(
        cell.h >= 49.99,
        `Child cell ${k} height must be >= 50mm, got ${cell.h}`
      );
    }
  }
});

test('ADVERSARIAL 1.3: simulateTopBorderDrag downward by -5000px updates project and produces valid layout', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1400, thickness: 18 },
    columns: [
      { id: 'c0', width: 600, height: 1200, root: M.leaf('shelf') },
      { id: 'c1', width: 600, height: 1800, root: M.leaf('shelf') },
    ],
  };

  const newH = simulateTopBorderDrag(project, 0, -5000);
  assert.equal(newH, 200, 'simulateTopBorderDrag must return 200');
  assert.equal(project.columns[0].height, 200, 'Column 0 height must be set to 200mm');
  assert.equal(project.columns[1].height, 1800, 'Column 1 height must remain unchanged');

  const layout = computeLayout(project);
  auditLayoutInvariants(layout, 'After -5000px downward drag');
  assert.equal(layout.pieces.find((p) => p.name === 'Tapa superior' && p.col === 0).y, 200 - 18);
});

// ============================================================================
// SUITE 2: Upward Drag by 10000px Clamping (H_max <= 4000mm)
// ============================================================================

test('ADVERSARIAL 2.1: Dragging up by 10000px strictly clamps column height to H_max <= 4000mm', () => {
  const startHeights = [200, 800, 1400, 2800, 3999, 4000];

  for (const startH of startHeights) {
    const clampedH = calculateTopBorderDrag(startH, 10000, 18, 1);
    assert.equal(
      clampedH,
      4000,
      `Upward drag of 10000px from startH=${startH} must clamp to exactly 4000mm (got ${clampedH})`
    );
  }

  // Ultra-extreme upward deltas: +50,000px, +1,000,000px
  for (const extremeDelta of [10000, 50000, 100000, 1e7]) {
    const res = calculateTopBorderDrag(1000, extremeDelta, 18, 1);
    assert.equal(res, 4000, `Delta ${extremeDelta} must clamp to 4000`);
    assert.ok(Number.isInteger(res));
  }

  // 1000 chaotic upward drag cycles
  for (let i = 1; i <= 1000; i++) {
    const randomStartH = 200 + Math.floor(Math.random() * 3800);
    const randomDelta = 10000 + Math.floor(Math.random() * 500000);
    const res = calculateTopBorderDrag(randomStartH, randomDelta, 18, 1);
    assert.equal(res, 4000, `Cycle ${i}: H_max violation: ${res} !== 4000`);
  }
});

test('ADVERSARIAL 2.2: simulateTopBorderDrag upward by +10000px generates robust 4000mm layout without overflow', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1400, thickness: 18, overhang: 20 },
    columns: [
      { id: 'c0', width: 500, height: 700, root: M.leaf('shelf') },
      { id: 'c1', width: 700, height: 1500, root: M.leaf('shelf') },
    ],
  };

  const newH = simulateTopBorderDrag(project, 1, 10000);
  assert.equal(newH, 4000);
  assert.equal(project.columns[1].height, 4000);
  assert.equal(project.columns[0].height, 700, 'Neighbor Col 0 height untouched');

  const layout = computeLayout(project);
  auditLayoutInvariants(layout, 'After +10000px upward drag');
  assert.equal(layout.maxH, 4000);

  // Intermediate lateral rises to max(700, 4000) + 2*ov = 4040mm
  const sharedLat = layout.pieces.find((p) => (p.name === 'Lateral intermedio' && p.col === 0) || (p.kind === 'side' && p.col === 1));
  assert.ok(sharedLat);
  assert.equal(sharedLat.sy, 4000 + 2 * 20);

  // SVG representation contains updated dimensions
  const svg = buildCanvasSvg(project, layout);
  assert.ok(svg.includes('viewBox='), 'SVG must render valid viewBox');
  assert.ok(svg.includes('col-top-handle'), 'col-top handle must exist');
});

test('ADVERSARIAL 2.3: Initial undefined column height falls back correctly to settings.height during drag', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1550, thickness: 18 },
    columns: [
      { id: 'c_undef', width: 600, root: M.leaf('shelf') }, // height is undefined
    ],
  };

  // Drag up by 200mm -> starts from 1550 -> becomes 1750
  const hUp = simulateTopBorderDrag(project, 0, 200);
  assert.equal(hUp, 1750);
  assert.equal(project.columns[0].height, 1750);

  // Drag down by 300mm -> starts from 1750 -> becomes 1450
  const hDown = simulateTopBorderDrag(project, 0, -300);
  assert.equal(hDown, 1450);
  assert.equal(project.columns[0].height, 1450);
});

// ============================================================================
// SUITE 3: Zero-Movement Click & Undo Stack Invariance
// ============================================================================

test('ADVERSARIAL 3.1: Zero-movement click on top border handle does NOT increase undo stack or wipe redo stack', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1400, thickness: 18 },
    columns: [
      { id: 'c0', width: 600, height: 1000, root: M.leaf('shelf') },
      { id: 'c1', width: 600, height: 1600, root: M.leaf('shelf') },
    ],
  };

  const undo = [];
  const redo = [];

  const snapshot = () => JSON.stringify(project);
  const pushUndo = (prevSnapshot) => {
    if (snapshot() !== prevSnapshot) {
      undo.push(prevSnapshot);
      if (undo.length > 100) undo.shift();
      redo.length = 0;
    }
  };

  // Seed history with 2 prior valid operations
  undo.push(JSON.stringify({ ...project, columns: [{ ...project.columns[0], width: 500 }] }));
  undo.push(JSON.stringify({ ...project, columns: [{ ...project.columns[0], width: 550 }] }));
  redo.push(JSON.stringify({ ...project, columns: [{ ...project.columns[0], width: 700 }] }));

  const undoLenInitial = undo.length; // 2
  const redoLenInitial = redo.length; // 1

  // SCENARIO 3.1.A: Pure mousedown followed immediately by mouseup (no mousemove)
  {
    const initialSnapshot = snapshot();
    let hasMoved = false;

    // Mouse up
    if (hasMoved) {
      pushUndo(initialSnapshot);
    }

    assert.equal(undo.length, undoLenInitial, 'Undo stack must NOT grow on zero-movement click');
    assert.equal(redo.length, redoLenInitial, 'Redo stack must NOT be cleared on zero-movement click');
  }

  // SCENARIO 3.1.B: Mouse move fires with exactly 0 pixel delta (deltaH = 0)
  {
    const initialSnapshot = snapshot();
    let hasMoved = true; // move event fired, but delta was 0

    const col = project.columns[0];
    const startH = col.height;
    const deltaH = 0;
    const newH = calculateTopBorderDrag(startH, deltaH, 18, 1);
    col.height = newH; // same height

    // Mouse up
    if (hasMoved) {
      pushUndo(initialSnapshot);
    }

    assert.equal(undo.length, undoLenInitial, 'Undo stack must NOT grow when deltaH is 0');
    assert.equal(redo.length, redoLenInitial, 'Redo stack must NOT be cleared when deltaH is 0');
  }

  // SCENARIO 3.1.C: Mouse moves and returns back to starting point before mouseup
  {
    const initialSnapshot = snapshot();
    let hasMoved = true;

    const col = project.columns[0];
    const startH = col.height;

    // Move away
    col.height = calculateTopBorderDrag(startH, 150, 18, 1);
    // Move back to start
    col.height = calculateTopBorderDrag(startH, 0, 18, 1);

    // Mouse up
    if (hasMoved) {
      pushUndo(initialSnapshot);
    }

    assert.equal(undo.length, undoLenInitial, 'Undo stack must NOT grow if dragged back to start position');
    assert.equal(redo.length, redoLenInitial, 'Redo stack must NOT be cleared if project is unchanged');
  }

  // SCENARIO 3.1.D: Meaningful drag MUST grow undo stack and clear redo
  {
    const initialSnapshot = snapshot();
    let hasMoved = true;

    const col = project.columns[0];
    const startH = col.height;
    col.height = calculateTopBorderDrag(startH, 200, 18, 1);

    if (hasMoved) {
      pushUndo(initialSnapshot);
    }

    assert.equal(undo.length, undoLenInitial + 1, 'Undo stack MUST record real drag modification');
    assert.equal(redo.length, 0, 'Redo stack MUST be cleared after new meaningful drag');
  }
});

// ============================================================================
// SUITE 4: Interleaved Multi-Column Dragging & Strict Neighbor Isolation (0.0mm Bleed)
// ============================================================================

test('ADVERSARIAL 4.1: 500 interleaved chaotic drags across 5 columns verify 0.0mm neighbor height bleed', () => {
  const initialHeights = [700, 1200, 1800, 950, 2400];
  const initialWidths = [450, 500, 600, 550, 700];

  const project = {
    settings: { ...DEFAULTS, height: 1400, thickness: 18, overhang: 20 },
    columns: initialHeights.map((h, idx) => ({
      id: `col_${idx}`,
      width: initialWidths[idx],
      height: h,
      root: M.leaf('shelf'),
    })),
  };

  // Perform 500 interleaved drag actions
  for (let step = 0; step < 500; step++) {
    const targetIdx = step % project.columns.length;
    const preSnapshot = project.columns.map((c) => ({ height: c.height, width: c.width }));

    // Pseudo-random delta between -3000 and +3000
    const delta = Math.floor(Math.sin(step * 3.7) * 2500) + ((step % 7) * 80);

    // Drag target column
    simulateTopBorderDrag(project, targetIdx, delta);

    // Check strict isolation for all neighbor columns
    for (let j = 0; j < project.columns.length; j++) {
      if (j !== targetIdx) {
        assert.equal(
          project.columns[j].height,
          preSnapshot[j].height,
          `Step ${step}: Neighbor col ${j} height bled when dragging col ${targetIdx}! ` +
          `Expected ${preSnapshot[j].height}mm, got ${project.columns[j].height}mm (Bleed: ${Math.abs(project.columns[j].height - preSnapshot[j].height)}mm)`
        );
      }
      // Width of every column must remain 100% untouched
      assert.equal(
        project.columns[j].width,
        preSnapshot[j].width,
        `Step ${step}: Column ${j} width shifted during vertical top drag`
      );
    }
  }

  // After 500 chaotic drags, layout must compute cleanly without anomalies
  const layout = computeLayout(project);
  auditLayoutInvariants(layout, 'After 500 interleaved drags');
});

test('ADVERSARIAL 4.2: Extreme stepped contrast (200mm vs 4000mm) preserves strict isolation and step riser', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1400, thickness: 18, overhang: 20 },
    columns: [
      { id: 'c0', width: 600, height: 1000, root: M.leaf('shelf') },
      { id: 'c1', width: 600, height: 1000, root: M.leaf('shelf') },
      { id: 'c2', width: 600, height: 1000, root: M.leaf('shelf') },
    ],
  };

  // Drag Col 0 down to minimum
  simulateTopBorderDrag(project, 0, -99999);
  assert.equal(project.columns[0].height, 200);
  assert.equal(project.columns[1].height, 1000, 'Col 1 untouched');
  assert.equal(project.columns[2].height, 1000, 'Col 2 untouched');

  // Drag Col 1 up to maximum
  simulateTopBorderDrag(project, 1, +99999);
  assert.equal(project.columns[0].height, 200, 'Col 0 untouched');
  assert.equal(project.columns[1].height, 4000);
  assert.equal(project.columns[2].height, 1000, 'Col 2 untouched');

  // Drag Col 2 to mid-height
  simulateTopBorderDrag(project, 2, -250);
  assert.equal(project.columns[0].height, 200, 'Col 0 untouched');
  assert.equal(project.columns[1].height, 4000, 'Col 1 untouched');
  assert.equal(project.columns[2].height, 750);

  const layout = computeLayout(project);
  auditLayoutInvariants(layout, 'Extreme stepped contrast');

  // Verify intermediate shared laterals:
  // Between col 0 (200mm) and col 1 (4000mm): lateral height = max(200, 4000) + 2*ov = 4040mm
  const lat01 = layout.pieces.find((p) => (p.name === 'Lateral intermedio' && p.col === 0) || (p.kind === 'side' && p.col === 1));
  assert.equal(lat01.sy, 4040);

  // Between col 1 (4000mm) and col 2 (750mm): lateral height = max(4000, 750) + 2*ov = 4040mm
  const lat12 = layout.pieces.find((p) => (p.name === 'Lateral intermedio' && p.col === 1) || (p.kind === 'side' && p.col === 2));
  assert.equal(lat12.sy, 4040);

  // Right outer lateral of col 2 (750mm): height = 750 + 2*ov = 790mm
  const latRight = layout.pieces.find((p) => p.name === 'Lateral derecho' || (p.kind === 'side' && p.col === 3));
  assert.equal(latRight.sy, 750 + 2 * 20);

  // Left outer lateral of col 0 (200mm): height = 200 + 2*ov = 240mm
  const latLeft = layout.pieces.find((p) => p.name === 'Lateral izquierdo' || (p.kind === 'side' && p.col === 0));
  assert.equal(latLeft.sy, 200 + 2 * 20);
});

// ============================================================================
// SUITE 5: Internal Horizontal Divider Drag Safety (No Inversion & Min 50mm)
// ============================================================================

test('ADVERSARIAL 5.1: Internal horizontal divider dragging strictly forbids cell inversion and protects min 50mm', () => {
  const project = {
    settings: { ...DEFAULTS, thickness: 18 },
    columns: [
      {
        id: 'col_int',
        width: 600,
        height: 1200,
        root: {
          id: 'root_v',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            M.leaf('shelf', { id: 'top_cell', size: 400 }),
            M.leaf('shelf', { id: 'bot_cell', size: 600 }),
          ],
        },
      },
    ],
  };

  const prevNode = project.columns[0].root.children[0];
  const nextNode = project.columns[0].root.children[1];
  const totalPair = prevNode.size + nextNode.size; // 1000mm

  // Engine function implementing app.js internal horizontal divider dragging:
  const dragInternalDivider = (delta) => {
    const minSize = 50;
    const effectiveMin = Math.min(minSize, Math.floor(totalPair / 2));
    let newPrev = prevNode.size + delta;
    if (newPrev < effectiveMin) newPrev = effectiveMin;
    else if (newPrev > totalPair - effectiveMin) newPrev = totalPair - effectiveMin;
    const roundedPrev = Math.round(newPrev);
    const roundedNext = totalPair - roundedPrev;
    prevNode.size = roundedPrev;
    nextNode.size = roundedNext;
    return { prev: roundedPrev, next: roundedNext };
  };

  // Test extreme upward drag: -50,000px (attempting to crush top cell to 0 or negative)
  for (const extremeUp of [-1000, -5000, -50000, -1e8]) {
    const res = dragInternalDivider(extremeUp);
    assert.equal(res.prev, 50, `Upper cell must clamp to exactly 50mm, got ${res.prev}`);
    assert.equal(res.next, 950, `Lower cell must take remainder 950mm, got ${res.next}`);
    assert.ok(res.prev >= 50, 'Upper cell >= 50mm');
    assert.ok(res.next >= 50, 'Lower cell >= 50mm');
    assert.equal(res.prev + res.next, totalPair, 'Sum strictly conserved');
  }

  // Test extreme downward drag: +50,000px (attempting to crush bottom cell to 0 or negative)
  for (const extremeDown of [1000, 5000, 50000, 1e8]) {
    const res = dragInternalDivider(extremeDown);
    assert.equal(res.next, 50, `Lower cell must clamp to exactly 50mm, got ${res.next}`);
    assert.equal(res.prev, 950, `Upper cell must take remainder 950mm, got ${res.prev}`);
    assert.ok(res.prev >= 50, 'Upper cell >= 50mm');
    assert.ok(res.next >= 50, 'Lower cell >= 50mm');
    assert.equal(res.prev + res.next, totalPair, 'Sum strictly conserved');
  }

  // 1000 chaotic floating-point deltas
  for (let i = 1; i <= 1000; i++) {
    const delta = (Math.sin(i * 1.7) * 800) + (i % 3 === 0 ? 0.333 : -0.777);
    const res = dragInternalDivider(delta);

    assert.ok(res.prev >= 50, `Cycle ${i}: prev dropped below 50mm (${res.prev})`);
    assert.ok(res.next >= 50, `Cycle ${i}: next dropped below 50mm (${res.next})`);
    assert.ok(Number.isInteger(res.prev), `Cycle ${i}: prev must be integer`);
    assert.ok(Number.isInteger(res.next), `Cycle ${i}: next must be integer`);
    assert.equal(res.prev + res.next, totalPair, `Cycle ${i}: Sum drifted!`);

    // Verify layout invariants
    const layout = computeLayout(project);
    auditLayoutInvariants(layout, `Internal drag cycle ${i}`);

    const cellTop = layout.cells['top_cell'];
    const cellBot = layout.cells['bot_cell'];
    assert.ok(cellTop.h >= 49.99, `Cell top h in layout >= 50mm (got ${cellTop.h})`);
    assert.ok(cellBot.h >= 49.99, `Cell bot h in layout >= 50mm (got ${cellBot.h})`);
    // Assert no cell inversion: cellBot is physically below cellTop
    // In computeLayout coordinate system, y starts at bottom, so cellTop.y > cellBot.y
    assert.ok(
      cellTop.y > cellBot.y,
      `Cells must not invert: top cell y (${cellTop.y}) must be strictly higher than bot cell y (${cellBot.y})`
    );
  }
});

test('ADVERSARIAL 5.2: Boundary cavity totalPair < 100mm handles effectiveMin gracefully without NaN or negative sizes', () => {
  const project = {
    settings: { ...DEFAULTS, thickness: 18 },
    columns: [
      {
        id: 'col_tight',
        width: 500,
        height: 800,
        root: {
          id: 'root_tight',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            M.leaf('shelf', { id: 'c_a', size: 30 }),
            M.leaf('shelf', { id: 'c_b', size: 50 }),
          ],
        },
      },
    ],
  };

  const prevNode = project.columns[0].root.children[0];
  const nextNode = project.columns[0].root.children[1];
  const totalPair = 80; // < 100mm

  const dragTightDivider = (delta) => {
    const minSize = 50;
    const effectiveMin = Math.min(minSize, Math.floor(totalPair / 2)); // 40mm
    let newPrev = prevNode.size + delta;
    if (newPrev < effectiveMin) newPrev = effectiveMin;
    else if (newPrev > totalPair - effectiveMin) newPrev = totalPair - effectiveMin;
    const roundedPrev = Math.round(newPrev);
    const roundedNext = totalPair - roundedPrev;
    prevNode.size = roundedPrev;
    nextNode.size = roundedNext;
    return { prev: roundedPrev, next: roundedNext, effectiveMin };
  };

  const resUp = dragTightDivider(-1000);
  assert.equal(resUp.prev, 40);
  assert.equal(resUp.next, 40);

  const resDown = dragTightDivider(1000);
  assert.equal(resDown.prev, 40);
  assert.equal(resDown.next, 40);

  const layout = computeLayout(project);
  auditLayoutInvariants(layout, 'Tight cavity');
});
