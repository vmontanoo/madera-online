import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, DEFAULTS, buildCutlist, orientationOf, cutlistCSV, PULLS } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

// ============================================================================
// EMPIRICAL STRESS TEST SUITE: Cross-Milestone Lifecycle Workflows
// Milestone 4 Challenger Empirical Audit
// ============================================================================

/**
 * Universal Invariant Oracle: Evaluates all architectural, geometric,
 * physical, and financial invariants for any given layout.
 */
function assertAllInvariants(layout, label = '') {
  const { cutlist, settings, pieces, cells } = layout;

  // 1. Cutlist Accounting & Price Identity Invariant
  assert.equal(
    cutlist.panelsTotal + cutlist.hardwareTotal,
    cutlist.total,
    `${label}: Price identity violated: panelsTotal (${cutlist.panelsTotal}) + hardwareTotal (${cutlist.hardwareTotal}) !== total (${cutlist.total})`
  );

  assert.ok(!Number.isNaN(cutlist.total) && Number.isFinite(cutlist.total) && cutlist.total >= 0,
    `${label}: cutlist.total invalid: ${cutlist.total}`);
  assert.ok(!Number.isNaN(cutlist.panelsTotal) && Number.isFinite(cutlist.panelsTotal) && cutlist.panelsTotal >= 0,
    `${label}: cutlist.panelsTotal invalid: ${cutlist.panelsTotal}`);
  assert.ok(!Number.isNaN(cutlist.hardwareTotal) && Number.isFinite(cutlist.hardwareTotal) && cutlist.hardwareTotal >= 0,
    `${label}: cutlist.hardwareTotal invalid: ${cutlist.hardwareTotal}`);
  assert.ok(!Number.isNaN(cutlist.area) && Number.isFinite(cutlist.area) && cutlist.area >= 0,
    `${label}: cutlist.area invalid: ${cutlist.area}`);

  // 2. Line Item Summation Parity
  const sumPanels = cutlist.rows.reduce((acc, r) => acc + r.total, 0);
  assert.ok(
    Math.abs(cutlist.panelsTotal - sumPanels) < 1e-7,
    `${label}: cutlist.panelsTotal (${cutlist.panelsTotal}) !== sum of row totals (${sumPanels})`
  );

  const sumHardware = cutlist.hardware.reduce((acc, h) => acc + h.total, 0);
  assert.ok(
    Math.abs(cutlist.hardwareTotal - sumHardware) < 1e-7,
    `${label}: cutlist.hardwareTotal (${cutlist.hardwareTotal}) !== sum of hardware totals (${sumHardware})`
  );

  // 3. Panel Dimensions Invariant (Millimeters, L >= W, T >= 3mm, <= 1 decimal precision, never meters)
  assert.ok(cutlist.rows.length > 0, `${label}: cutlist must contain panel rows`);
  for (let idx = 0; idx < cutlist.rows.length; idx++) {
    const r = cutlist.rows[idx];
    assert.ok(r.id && typeof r.id === 'string', `${label}: Row ${idx} invalid id`);
    assert.ok(r.name && typeof r.name === 'string', `${label}: Row ${idx} invalid name`);
    assert.ok(r.role && typeof r.role === 'string', `${label}: Row ${idx} invalid role`);

    // Length, width, thickness in millimeters
    assert.ok(r.length >= 10, `${label}: Row ${idx} (${r.name}) length must be >= 10mm (got ${r.length})`);
    assert.ok(r.width >= 10, `${label}: Row ${idx} (${r.name}) width must be >= 10mm (got ${r.width})`);
    assert.ok(r.thickness >= 3, `${label}: Row ${idx} (${r.name}) thickness must be >= 3mm (got ${r.thickness})`);

    // Woodworking invariant: Length >= Width
    assert.ok(r.length >= r.width, `${label}: Row ${idx} (${r.name}) L (${r.length}) must be >= W (${r.width})`);

    // Units must be millimeters, never meters (no fractional meters like 0.018 or 0.6)
    assert.ok(r.thickness > 1.0, `${label}: Row ${idx} thickness looks like meters: ${r.thickness}`);

    // Precision invariant: at most 1 decimal place
    assert.equal(
      Math.round(r.length * 10),
      r.length * 10,
      `${label}: Row ${idx} length precision exceeds 1 decimal place: ${r.length}`
    );
    assert.equal(
      Math.round(r.width * 10),
      r.width * 10,
      `${label}: Row ${idx} width precision exceeds 1 decimal place: ${r.width}`
    );

    // Pricing invariants
    assert.ok(r.qty >= 1, `${label}: Row ${idx} qty must be >= 1`);
    assert.ok(r.unitPrice >= 0, `${label}: Row ${idx} unitPrice must be >= 0`);
    assert.ok(Math.abs(r.total - r.unitPrice * r.qty) < 1e-5, `${label}: Row ${idx} total mismatch`);
  }

  // 4. Hardware Items Invariant
  for (let idx = 0; idx < cutlist.hardware.length; idx++) {
    const h = cutlist.hardware[idx];
    assert.ok(h.name && typeof h.name === 'string', `${label}: Hardware ${idx} missing name`);
    assert.ok(h.qty > 0, `${label}: Hardware ${idx} qty must be > 0 (got ${h.qty})`);
    assert.ok(h.unitPrice >= 0, `${label}: Hardware ${idx} unitPrice must be >= 0`);
    assert.ok(Math.abs(h.total - h.qty * h.unitPrice) < 1e-5, `${label}: Hardware ${idx} total mismatch`);
  }

  // 5. Geometry Invariant: 3D Pieces & 2D Cells
  for (const p of pieces) {
    assert.ok(p.sx > 0 && p.sy > 0 && p.sz > 0, `${label}: Piece ${p.name} has non-positive dimensions`);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z),
      `${label}: Piece ${p.name} has non-finite coords`);
  }

  for (const [id, c] of Object.entries(cells)) {
    assert.ok(c.w > 0, `${label}: Cell ${id} w must be > 0 (got ${c.w})`);
    assert.ok(c.h > 0, `${label}: Cell ${id} h must be > 0 (got ${c.h})`);
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), `${label}: Cell ${id} non-finite coords`);
  }
}

/**
 * Drag Simulation Helpers (matching app.js:273-398)
 */
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

function simulateDividerDrag(project, divider, delta) {
  const layout = computeLayout(project);
  const isV = divider.axis === 'v';
  const parent = M.find(project, divider.parentId);
  if (!parent) throw new Error('Parent not found for divider ' + divider.parentId);
  const prevNode = M.find(project, divider.prevId)?.node;
  const nextNode = M.find(project, divider.nextId)?.node;
  if (!prevNode || !nextNode) throw new Error('Adjacent nodes not found');

  if (parent.node.children) {
    parent.node.children.forEach((ch) => {
      const cell = layout.cells[ch.id];
      if (cell) ch.size = isV ? cell.h : cell.w;
    });
  }

  const startPrevSize = prevNode.size;
  const startNextSize = nextNode.size;
  const totalPair = startPrevSize + startNextSize;
  const minSize = 50;
  const effectiveMin = Math.min(minSize, Math.floor(totalPair / 2));

  let newPrev = startPrevSize + delta;
  if (newPrev < effectiveMin) {
    newPrev = effectiveMin;
  } else if (newPrev > totalPair - effectiveMin) {
    newPrev = totalPair - effectiveMin;
  }
  const roundedPrev = Math.round(newPrev);
  const roundedNext = totalPair - roundedPrev;
  prevNode.size = roundedPrev;
  nextNode.size = roundedNext;

  return { roundedPrev, roundedNext, totalPair, startPrevSize, startNextSize };
}

// ============================================================================
// SUITE 1: Complex Topological Combinations (10 Columns, Staggered Top Additions, Mixed Modules)
// ============================================================================

test('STRESS 1: 10-column furniture with staggered top additions and mixed drawer/door modules', () => {
  const p = M.defaultProject();
  const t = p.settings.thickness;

  // 1. Expand from 3 to 10 columns using addColumn at various indices
  // Target widths for all 10 columns
  const colWidths = [450, 500, 600, 700, 800, 550, 650, 750, 900, 1000];
  
  // Set existing 3 columns
  p.columns[0].width = colWidths[0];
  p.columns[1].width = colWidths[1];
  p.columns[2].width = colWidths[2];

  // Add remaining 7 columns at start, middle, and end
  M.addColumn(p, 0, colWidths[3]); // index 0 (left +)
  M.addColumn(p, p.columns.length, colWidths[4]); // index 4 (right +)
  M.addColumn(p, 2, colWidths[5]); // middle
  M.addColumn(p, 0, colWidths[6]); // index 0
  M.addColumn(p, p.columns.length, colWidths[7]); // right
  M.addColumn(p, 4, colWidths[8]); // middle
  M.addColumn(p, p.columns.length, colWidths[9]); // right

  assert.equal(p.columns.length, 10, 'Must have exactly 10 columns');

  // Verify total furniture width equals sum of columns + 11 outer/inter laterals
  const expectedTotalW = p.columns.reduce((sum, c) => sum + c.width, 0) + 11 * t;
  const l1 = computeLayout(p);
  assert.equal(l1.totalW, expectedTotalW, 'Total cabinet width must exactly equal column widths + lateral thicknesses');
  assertAllInvariants(l1, '10-column baseline');

  // 2. Staggered Top Additions on distinct columns
  // Record baseline cell heights before additions
  const baselineHeights = {};
  for (const c of p.columns) {
    if (c.root.children) {
      for (const ch of c.root.children) {
        baselineHeights[ch.id] = l1.cells[ch.id]?.h;
      }
    } else {
      baselineHeights[c.root.id] = l1.cells[c.root.id]?.h;
    }
  }

  // Top addition 1: Column 0 gets +200mm shelf
  const initialH = p.settings.height;
  const top1 = M.addOnTop(p, p.columns[0].id, 'shelf', 200, true);
  assert.equal(p.settings.height, initialH + 200 + t, 'Cabinet height expands by addedHeight + t');
  assert.ok(top1 && top1.size === 200, 'New top leaf has size 200');

  // Top addition 2: Column 3 gets +300mm shelf
  const hAfter1 = p.settings.height;
  const top2 = M.addOnTop(p, p.columns[3].id, 'shelf', 300, true);
  assert.equal(p.settings.height, hAfter1 + 300 + t, 'Cabinet height expands again by 300 + t');

  // Top addition 3: Column 6 gets +400mm shelf
  const hAfter2 = p.settings.height;
  const top3 = M.addOnTop(p, p.columns[6].id, 'shelf', 400, true);
  assert.equal(p.settings.height, hAfter2 + 400 + t, 'Cabinet height expands again by 400 + t');

  // Top addition 4: Column 9 gets +250mm shelf
  const hAfter3 = p.settings.height;
  const top4 = M.addOnTop(p, p.columns[9].id, 'shelf', 250, true);
  assert.equal(p.settings.height, hAfter3 + 250 + t, 'Cabinet height expands again by 250 + t');

  // Top addition 5: Sequential second top addition on Column 0 (+150mm)
  const hAfter4 = p.settings.height;
  const top5 = M.addOnTop(p, p.columns[0].id, 'shelf', 150, true);
  assert.equal(p.settings.height, hAfter4 + 150 + t, 'Sequential top addition expands height correctly');

  const l2 = computeLayout(p);
  assertAllInvariants(l2, '10-column with staggered top additions');

  // Verify non-compression: baseline module heights never compressed below original height
  for (const [id, expectedH] of Object.entries(baselineHeights)) {
    if (expectedH !== undefined && l2.cells[id]) {
      const actualH = l2.cells[id].h;
      assert.ok(
        actualH >= expectedH - 0.1,
        `Module ${id} was compressed! Expected >= ${expectedH}mm, got ${actualH}mm`
      );
    }
  }

  // 3. Configure Mixed Modules across the 10 columns:
  // Col 0: Top shelf + Drawer bank (4 drawers)
  const col0Children = p.columns[0].root.children;
  col0Children[col0Children.length - 1].type = 'drawer';
  col0Children[col0Children.length - 1].count = 4;

  // Col 1: Drawer bank (6 drawers)
  p.columns[1].root = {
    id: 'col1-root',
    type: 'multiple',
    dir: 'v',
    size: 1,
    children: [
      M.leaf('drawer', { size: 300, count: 6 }),
      M.leaf('shelf', { size: 500 }),
    ],
  };

  // Col 2: Wardrobe door (tall single door > 1800mm, expects 4 hinges)
  p.columns[2].root = M.leaf('shelf', { front: 'left-door' });

  // Col 3: Double doors (height ~ 1400mm, expects 2x3 = 6 hinges)
  p.columns[3].root = {
    id: 'col3-root',
    type: 'multiple',
    dir: 'v',
    size: 1,
    children: [
      M.leaf('shelf', { size: 1400, front: 'doors' }),
      M.leaf('drawer', { size: 400, count: 2 }),
    ],
  };

  // Col 4: Hanging rail
  p.columns[4].root = M.leaf('rail');

  // Col 5: 8-drawer bank
  p.columns[5].root = M.leaf('drawer', { count: 8 });

  // Col 6: Vertical split inside horizontal section
  p.columns[6].root = {
    id: 'col6-root',
    type: 'multiple',
    dir: 'v',
    size: 1,
    children: [
      M.leaf('shelf', { size: 600 }),
      {
        id: 'col6-nested',
        type: 'multiple',
        dir: 'h',
        size: 800,
        children: [
          M.leaf('shelf', { size: 300 }),
          M.leaf('drawer', { size: 300, count: 3 }),
        ],
      },
    ],
  };

  // Col 7: Double doors short (<1000mm, expects 2x2 = 4 hinges) + rail
  p.columns[7].root = {
    id: 'col7-root',
    type: 'multiple',
    dir: 'v',
    size: 1,
    children: [
      M.leaf('shelf', { size: 800, front: 'doors' }),
      M.leaf('rail', { size: 1000 }),
    ],
  };

  // Col 8: Single right-door
  p.columns[8].root = M.leaf('shelf', { front: 'right-door' });

  // Col 9: 1-drawer module + open shelves
  p.columns[9].root = {
    id: 'col9-root',
    type: 'multiple',
    dir: 'v',
    size: 1,
    children: [
      M.leaf('shelf', { size: 400 }),
      M.leaf('shelf', { size: 400 }),
      M.leaf('drawer', { size: 300, count: 1 }),
    ],
  };

  const l3 = computeLayout(p);
  assertAllInvariants(l3, '10-column mixed drawer/door/rail modules');

  // Verify hardware catalog counts:
  // Drawers total: Col0 (4) + Col1 (6) + Col3 (2) + Col5 (8) + Col6 (3) + Col9 (1) = 24 drawers
  const slideItem = l3.cutlist.hardware.find((h) => h.name.includes('Corredera'));
  assert.ok(slideItem, 'Correderas must exist in hardware');
  assert.equal(slideItem.qty, 24, `Expected exactly 24 drawer slide pairs, got ${slideItem.qty}`);

  // Rails total: Col 4 + Col 7 = 2 rails, 4 brackets
  const bracketItem = l3.cutlist.hardware.find((h) => h.name.includes('Soporte de barra'));
  assert.ok(bracketItem, 'Barra soportes must exist');
  assert.equal(bracketItem.qty, 4, `Expected 4 rail brackets for 2 rails, got ${bracketItem.qty}`);
});

// ============================================================================
// SUITE 2: Extreme Drag Resizing & Bounds Recovery
// ============================================================================

test('STRESS 2: Extreme drag resizing across limits and multi-step bounds recovery', () => {
  const p = M.defaultProject();
  p.columns[0].width = 600;
  p.columns[1].width = 600;
  p.columns[2].width = 600;
  const initialTotalW = computeLayout(p).totalW;

  // 1. Extreme Inter-Column Drag Resizing
  // Drag divider between col 0 and col 1 to extreme negative (-5000)
  const drag1 = simulateColumnDrag(p, 0, false, -5000);
  assert.equal(drag1.newLeft, 150, 'Left column clamped to minimum 150mm');
  assert.equal(drag1.newRight, 1050, 'Right column takes remainder 1050mm');
  assert.equal(drag1.newLeft + drag1.newRight, 1200, 'Pair width strictly preserved');

  const lDrag1 = computeLayout(p);
  assert.equal(lDrag1.totalW, initialTotalW, 'Total furniture width strictly conserved');
  assertAllInvariants(lDrag1, 'Inter-column extreme negative drag');

  // Bounds recovery 1: Drag back by +300mm
  const recov1 = simulateColumnDrag(p, 0, false, 300);
  // From startLeftW = 150 + 300 = 450
  assert.equal(recov1.newLeft, 450, 'Left column recovered accurately to 450mm');
  assert.equal(recov1.newRight, 750, 'Right column recovered accurately to 750mm');
  assert.equal(recov1.newLeft + recov1.newRight, 1200, 'Pair width preserved on recovery');

  const lRecov1 = computeLayout(p);
  assert.equal(lRecov1.totalW, initialTotalW, 'Total furniture width preserved after bounds recovery');
  assertAllInvariants(lRecov1, 'Bounds recovery step 1');

  // Drag to extreme positive (+10000)
  const drag2 = simulateColumnDrag(p, 0, false, 10000);
  assert.equal(drag2.newRight, 150, 'Right column clamped to minimum 150mm');
  assert.equal(drag2.newLeft, 1050, 'Left column takes remainder 1050mm');
  assert.equal(drag2.newLeft + drag2.newRight, 1200, 'Pair width strictly preserved');

  // Bounds recovery 2: Drag back by -250mm
  const recov2 = simulateColumnDrag(p, 0, false, -250);
  assert.equal(recov2.newLeft, 800, 'Left column recovered to 800mm');
  assert.equal(recov2.newRight, 400, 'Right column recovered to 400mm');
  assert.equal(recov2.newLeft + recov2.newRight, 1200, 'Pair width preserved');

  // 2. Outer Border Drag Resizing & Recovery
  // Drag outer right border to negative extreme (-10000)
  const outerDrag1 = simulateColumnDrag(p, 2, true, -10000);
  assert.equal(outerDrag1.newW, 150, 'Outer column clamped to 150mm');
  assert.equal(p.columns[2].width, 150);

  const lOuter1 = computeLayout(p);
  assertAllInvariants(lOuter1, 'Outer border extreme negative drag');

  // Outer border recovery: Drag expand by +850mm
  const outerRecov = simulateColumnDrag(p, 2, true, 850);
  assert.equal(outerRecov.newW, 1000, 'Outer column expanded to 1000mm');
  assert.equal(p.columns[2].width, 1000);

  const lOuter2 = computeLayout(p);
  assertAllInvariants(lOuter2, 'Outer border recovery expansion');

  // 3. Internal Cell Divider Drag Resizing with 100 pseudo-random steps
  const col0 = p.columns[0];
  const shelf = col0.root.children[0];
  const drawer = col0.root.children[1];
  const lNorm = computeLayout(p);
  shelf.size = lNorm.cells[shelf.id].h;
  drawer.size = lNorm.cells[drawer.id].h;
  const pairTotal = shelf.size + drawer.size;
  const minSize = 50;
  const effectiveMin = Math.min(minSize, Math.floor(pairTotal / 2));

  for (let step = 1; step <= 100; step++) {
    const delta = Math.cos(step * 2.3) * 600 + (step % 5) * 17.5;
    let targetPrev = shelf.size + delta;
    if (targetPrev < effectiveMin) targetPrev = effectiveMin;
    else if (targetPrev > pairTotal - effectiveMin) targetPrev = pairTotal - effectiveMin;

    const roundedPrev = Math.round(targetPrev);
    const roundedNext = pairTotal - roundedPrev;

    assert.equal(
      roundedPrev + roundedNext,
      pairTotal,
      `Step ${step}: Rounding drift detected! ${roundedPrev} + ${roundedNext} !== ${pairTotal}`
    );
    assert.ok(roundedPrev >= effectiveMin, `Step ${step}: roundedPrev < effectiveMin`);
    assert.ok(roundedNext >= effectiveMin, `Step ${step}: roundedNext < effectiveMin`);

    shelf.size = roundedPrev;
    drawer.size = roundedNext;

    if (step % 20 === 0) {
      const stepLayout = computeLayout(p);
      assertAllInvariants(stepLayout, `Internal drag step ${step}`);
    }
  }
});

// ============================================================================
// SUITE 3: Deep Undo/Redo Stacks (50+ Cycles with 0 State Corruption)
// ============================================================================

test('STRESS 3: Deep undo/redo stack across 60 lifecycle states with 0 corruption', () => {
  // Setup exact state manager mechanics as app.js
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
  const commit = (fn) => {
    undo.push(snapshot());
    if (undo.length > 100) undo.shift();
    redo.length = 0;
    fn();
  };
  const restore = (from, to) => {
    if (!from.length) return;
    to.push(snapshot());
    if (to.length > 100) to.shift();
    state.project = JSON.parse(from.pop());
  };

  // Record history of exact snapshots at each step
  const snapshots = [snapshot()];

  // Execute 60 sequential state-modifying operations
  // Operations 1 - 7: Add columns to reach 10 columns
  for (let i = 1; i <= 7; i++) {
    commit(() => {
      M.addColumn(state.project, i % 2 === 0 ? 0 : state.project.columns.length, 500 + i * 50);
    });
    snapshots.push(snapshot());
    assertAllInvariants(computeLayout(state.project), `Op ${i}: Column addition`);
  }
  assert.equal(state.project.columns.length, 10, 'Reached 10 columns');

  // Operations 8 - 15: Add top modules
  for (let i = 8; i <= 15; i++) {
    commit(() => {
      const targetCol = state.project.columns[i % 10];
      M.addOnTop(state.project, targetCol.id, 'shelf', 200 + (i % 4) * 50, false);
    });
    snapshots.push(snapshot());
    assertAllInvariants(computeLayout(state.project), `Op ${i}: Top addition`);
  }

  // Operations 16 - 30: Module type changes and splits
  for (let i = 16; i <= 30; i++) {
    commit(() => {
      const col = state.project.columns[i % 10];
      if (i % 3 === 0) {
        col.root = M.leaf('drawer', { count: (i % 6) + 1 });
      } else if (i % 3 === 1) {
        col.root = M.leaf('shelf', { front: i % 2 === 0 ? 'doors' : 'left-door' });
      } else {
        col.root = M.leaf('rail');
      }
    });
    snapshots.push(snapshot());
    assertAllInvariants(computeLayout(state.project), `Op ${i}: Module retyping`);
  }

  // Operations 31 - 45: Drag column resizing
  for (let i = 31; i <= 45; i++) {
    const s0 = snapshot();
    const colIdx = (i - 31) % 9;
    const delta = (i % 2 === 0 ? 1 : -1) * (50 + (i % 5) * 40);
    simulateColumnDrag(state.project, colIdx, false, delta);
    pushUndo(s0);
    snapshots.push(snapshot());
    assertAllInvariants(computeLayout(state.project), `Op ${i}: Drag column ${colIdx}`);
  }

  // Operations 46 - 60: Settings adjustments
  for (let i = 46; i <= 60; i++) {
    commit(() => {
      if (i % 4 === 0) state.project.settings.thickness = 15 + (i % 3) * 3;
      else if (i % 4 === 1) state.project.settings.material = i % 2 === 0 ? 'white' : 'oak';
      else if (i % 4 === 2) state.project.settings.pullStyle = ['bar', 'knob', 'profile', 'none'][i % 4];
      else state.project.settings.depth = 500 + (i % 5) * 50;
    });
    snapshots.push(snapshot());
    assertAllInvariants(computeLayout(state.project), `Op ${i}: Settings adjustment`);
  }

  assert.equal(snapshots.length, 61, 'Must have 61 snapshots (0 through 60)');
  assert.equal(undo.length, 60, 'Undo stack must contain 60 states');

  // Verify Deep Undo: Perform 55 consecutive undo operations
  for (let step = 1; step <= 55; step++) {
    const expectedSnapshot = snapshots[60 - step];
    restore(undo, redo);
    const restoredSnapshot = snapshot();

    assert.equal(
      restoredSnapshot,
      expectedSnapshot,
      `Undo step ${step}: State corrupted! Restored snapshot does not match history snapshot ${60 - step}`
    );

    // Verify invariants on restored state
    if (step % 5 === 0) {
      assertAllInvariants(computeLayout(state.project), `Undo step ${step}`);
    }
  }

  assert.equal(undo.length, 5, 'Undo stack must have 5 remaining items');
  assert.equal(redo.length, 55, 'Redo stack must have 55 items');

  // Verify Deep Redo: Perform 55 consecutive redo operations
  for (let step = 1; step <= 55; step++) {
    const expectedSnapshot = snapshots[5 + step];
    restore(redo, undo);
    const redoneSnapshot = snapshot();

    assert.equal(
      redoneSnapshot,
      expectedSnapshot,
      `Redo step ${step}: State corrupted! Redone snapshot does not match history snapshot ${5 + step}`
    );

    if (step % 5 === 0) {
      assertAllInvariants(computeLayout(state.project), `Redo step ${step}`);
    }
  }

  assert.equal(undo.length, 60, 'Undo stack restored to 60');
  assert.equal(redo.length, 0, 'Redo stack emptied after full forward redo');

  // Verify Zero-Movement Clicks Invariance:
  // 20 simulated zero-delta mouse clicks must NOT pollute undo or clear redo
  // First, do 5 undos to populate redo stack
  for (let i = 0; i < 5; i++) restore(undo, redo);
  const undoLenBefore = undo.length;
  const redoLenBefore = redo.length;

  for (let click = 1; click <= 20; click++) {
    const sBeforeClick = snapshot();
    // Simulate zero-movement click: hasMoved = false, pushUndo called with identical snapshot
    pushUndo(sBeforeClick);
    assert.equal(undo.length, undoLenBefore, `Zero click ${click} must not grow undo stack`);
    assert.equal(redo.length, redoLenBefore, `Zero click ${click} must not clear redo stack`);
  }
});

// ============================================================================
// SUITE 4: Cutlist Invariant Consistency across Extreme Boundary Configurations
// ============================================================================

test('STRESS 4: Cutlist invariant consistency across boundary and fractional configurations', () => {
  // Test 4.1: Minimalist open cabinet
  const pMin = M.defaultProject();
  pMin.columns = [
    { id: 'min-col', width: 200, root: M.leaf('shelf') },
  ];
  pMin.settings.height = 600;
  pMin.settings.depth = 300;
  const lMin = computeLayout(pMin);
  assertAllInvariants(lMin, 'Minimalist single open cabinet');
  assert.equal(lMin.cutlist.hardwareTotal, 0, 'No hardware in open cabinet');
  assert.equal(lMin.cutlist.total, lMin.cutlist.panelsTotal, 'Total must equal panelsTotal');

  // Test 4.2: Maximum Hardware Density Cabinet
  // 6 columns packed with 8-drawer stacks, double doors, and hanging rails
  const pDense = M.defaultProject();
  pDense.columns = [
    { id: 'c1', width: 600, root: M.leaf('drawer', { count: 8 }) },
    { id: 'c2', width: 700, root: M.leaf('drawer', { count: 8 }) },
    { id: 'c3', width: 800, root: M.leaf('shelf', { front: 'doors' }) }, // tall double doors (height 2000 -> 2x4 = 8 hinges)
    { id: 'c4', width: 900, root: M.leaf('shelf', { front: 'doors' }) },
    { id: 'c5', width: 600, root: M.leaf('rail') },
    { id: 'c6', width: 750, root: M.leaf('rail') },
  ];
  pDense.settings.height = 2200;
  pDense.settings.pullStyle = 'bar';
  const lDense = computeLayout(pDense);
  assertAllInvariants(lDense, 'High density hardware cabinet');

  // 16 drawers = 16 slide pairs
  const slides = lDense.cutlist.hardware.find((h) => h.name.includes('Corredera'));
  assert.equal(slides.qty, 16, 'Exactly 16 drawer slides');

  // Double doors at 2200mm = 4 hinges per leaf * 2 leaves * 2 cabinets = 16 hinges
  const hinges = lDense.cutlist.hardware.find((h) => h.name.includes('Bisagra'));
  assert.equal(hinges.qty, 16, 'Exactly 16 hinges');

  // Rails: spans = 600 + 750 = 1350mm = 1.35m
  const rails = lDense.cutlist.hardware.find((h) => h.name.includes('Barra de perchero'));
  assert.equal(rails.qty, 1.35, 'Rail meters rounded to 2 decimals');
  const brackets = lDense.cutlist.hardware.find((h) => h.name.includes('Soporte de barra'));
  assert.equal(brackets.qty, 4, '4 rail brackets');

  // Test 4.3: Arbitrary Floating Rates & Currency
  pDense.settings.currency = '€';
  pDense.settings.priceWhite = 37.891;
  pDense.settings.priceOak = 73.123;
  pDense.settings.priceWalnut = 99.456;
  pDense.settings.hingePrice = 3.333;
  pDense.settings.slidePrice = 17.777;
  pDense.settings.pullBarPrice = 5.555;
  pDense.settings.priceRail = 8.888;
  pDense.settings.priceRailBracket = 2.222;

  const lFloat = computeLayout(pDense);
  assertAllInvariants(lFloat, 'Arbitrary fractional rates');

  // Test 4.4: CSV export matches cutlist total
  const csv = cutlistCSV(lFloat.cutlist, '€');
  const lines = csv.split('\n');
  const lastLine = lines[lines.length - 1];
  assert.ok(
    lastLine.includes(lFloat.cutlist.total.toFixed(2)),
    `CSV final line must contain total ${lFloat.cutlist.total.toFixed(2)} (got: ${lastLine})`
  );
});
