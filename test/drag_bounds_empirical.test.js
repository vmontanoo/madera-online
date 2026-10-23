import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, DEFAULTS } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

// Helper to simulate the drag mathematics exactly as implemented in public/js/app.js:285-360
function simulateColumnDrag(project, colIdx, isOuter, deltaX) {
  const minW = 150;
  const startLeftW = project.columns[colIdx].width;
  if (!isOuter) {
    const startRightW = project.columns[colIdx + 1]?.width || 0;
    const totalPair = startLeftW + startRightW;
    let newLeft = Math.round(Math.max(minW, Math.min(totalPair - minW, startLeftW + deltaX)));
    let newRight = totalPair - newLeft;
    project.columns[colIdx].width = newLeft;
    project.columns[colIdx + 1].width = newRight;
    return { newLeft, newRight, totalPair };
  } else {
    let newW = Math.round(Math.max(minW, startLeftW + deltaX));
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

  // Normalize sibling sizes from layout.cells in mm as done in app.js:331-337
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
  let newPrev = startPrevSize + delta;
  let newNext = startNextSize - delta;
  if (newPrev < minSize) {
    newPrev = minSize;
    newNext = totalPair - minSize;
  } else if (newNext < minSize) {
    newNext = minSize;
    newPrev = totalPair - minSize;
  }

  prevNode.size = Math.round(newPrev);
  nextNode.size = Math.round(newNext);

  return { newPrev: prevNode.size, newNext: nextNode.size, totalPair, startPrevSize, startNextSize };
}

// Invariant auditor for computeLayout results
function auditLayoutInvariants(layout, label = '') {
  const anomalies = [];

  // 1. Audit pieces
  if (!layout.pieces || !Array.isArray(layout.pieces) || layout.pieces.length === 0) {
    anomalies.push({ type: 'PIECES_MISSING', message: `${label}: pieces array is missing or empty` });
  } else {
    layout.pieces.forEach((p, idx) => {
      ['x', 'y', 'z', 'sx', 'sy', 'sz'].forEach((prop) => {
        const val = p[prop];
        if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
          anomalies.push({ type: 'NAN_COORDINATE', piece: p.name, prop, val, message: `${label}: piece[${idx}] (${p.name || 'unnamed'}) has invalid ${prop}: ${val}` });
        }
      });
      // Check dimensions are strictly positive
      if (p.sx <= 0) anomalies.push({ type: 'NEGATIVE_DIMENSION', piece: p.name, axis: 'sx', val: p.sx, message: `${label}: piece[${idx}] (${p.name}) sx <= 0: ${p.sx}` });
      if (p.sy <= 0) anomalies.push({ type: 'NEGATIVE_DIMENSION', piece: p.name, axis: 'sy', val: p.sy, message: `${label}: piece[${idx}] (${p.name}) sy <= 0: ${p.sy}` });
      if (p.sz <= 0) anomalies.push({ type: 'NEGATIVE_DIMENSION', piece: p.name, axis: 'sz', val: p.sz, message: `${label}: piece[${idx}] (${p.name}) sz <= 0: ${p.sz}` });
      if (!p.name) anomalies.push({ type: 'UNDEFINED_PROP', pieceIndex: idx, prop: 'name', message: `${label}: piece[${idx}] has undefined name` });
      if (!p.mat) anomalies.push({ type: 'UNDEFINED_PROP', pieceIndex: idx, prop: 'mat', message: `${label}: piece[${idx}] has undefined mat` });
      if (!p.kind) anomalies.push({ type: 'UNDEFINED_PROP', pieceIndex: idx, prop: 'kind', message: `${label}: piece[${idx}] has undefined kind` });
    });
  }

  // 2. Audit cells
  if (!layout.cells || Object.keys(layout.cells).length === 0) {
    anomalies.push({ type: 'CELLS_MISSING', message: `${label}: cells object is missing or empty` });
  } else {
    Object.entries(layout.cells).forEach(([id, c]) => {
      ['x', 'y', 'w', 'h'].forEach((prop) => {
        const val = c[prop];
        if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
          anomalies.push({ type: 'NAN_CELL_COORDINATE', cellId: id, prop, val, message: `${label}: cell[${id}] has invalid ${prop}: ${val}` });
        }
      });
      if (c.w <= 0) anomalies.push({ type: 'NEGATIVE_CELL_DIMENSION', cellId: id, axis: 'w', val: c.w, message: `${label}: cell[${id}] w <= 0: ${c.w}` });
      if (c.h <= 0) anomalies.push({ type: 'NEGATIVE_CELL_DIMENSION', cellId: id, axis: 'h', val: c.h, message: `${label}: cell[${id}] h <= 0: ${c.h}` });
    });
  }

  // 3. Audit dividers
  if (!layout.dividers || !Array.isArray(layout.dividers)) {
    anomalies.push({ type: 'DIVIDERS_MISSING', message: `${label}: dividers is not an array` });
  } else {
    layout.dividers.forEach((d, idx) => {
      ['x', 'y', 'w', 'h'].forEach((prop) => {
        const val = d[prop];
        if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
          anomalies.push({ type: 'NAN_DIVIDER_COORDINATE', dividerIndex: idx, prop, val, message: `${label}: divider[${idx}] (${d.type || d.axis}) has invalid ${prop}: ${val}` });
        }
      });
    });
  }

  // 4. Audit cutlist
  if (!layout.cutlist) {
    anomalies.push({ type: 'CUTLIST_MISSING', message: `${label}: cutlist is missing` });
  } else {
    if (typeof layout.cutlist.total !== 'number' || Number.isNaN(layout.cutlist.total) || layout.cutlist.total < 0) {
      anomalies.push({ type: 'INVALID_CUTLIST_TOTAL', val: layout.cutlist.total, message: `${label}: cutlist.total invalid: ${layout.cutlist.total}` });
    }
    layout.cutlist.rows.forEach((r, idx) => {
      ['length', 'width', 'thickness', 'qty', 'unitPrice', 'total'].forEach((prop) => {
        const val = r[prop];
        if (typeof val !== 'number' || Number.isNaN(val) || !Number.isFinite(val)) {
          anomalies.push({ type: 'NAN_CUTLIST_ROW', rowIndex: idx, prop, val, message: `${label}: cutlist.rows[${idx}] (${r.name}) has invalid ${prop}: ${val}` });
        }
      });
      if (r.length <= 0) anomalies.push({ type: 'NEGATIVE_CUTLIST_DIMENSION', rowIndex: idx, prop: 'length', val: r.length, message: `${label}: cutlist.rows[${idx}] (${r.name}) length <= 0: ${r.length}` });
      if (r.width <= 0) anomalies.push({ type: 'NEGATIVE_CUTLIST_DIMENSION', rowIndex: idx, prop: 'width', val: r.width, message: `${label}: cutlist.rows[${idx}] (${r.name}) width <= 0: ${r.width}` });
      if (r.thickness <= 0) anomalies.push({ type: 'NEGATIVE_CUTLIST_DIMENSION', rowIndex: idx, prop: 'thickness', val: r.thickness, message: `${label}: cutlist.rows[${idx}] (${r.name}) thickness <= 0: ${r.thickness}` });
      if (r.qty <= 0) anomalies.push({ type: 'NEGATIVE_CUTLIST_QTY', rowIndex: idx, val: r.qty, message: `${label}: cutlist.rows[${idx}] (${r.name}) qty <= 0: ${r.qty}` });
    });
  }

  return anomalies;
}

test('EMPIRICAL 1: Divider drag clamping behavior under extreme deltas', () => {
  const p = M.defaultProject();
  const l0 = computeLayout(p);
  const divV = l0.dividers.find((d) => d.axis === 'v');
  assert.ok(divV, 'A vertical-axis divider (horizontal shelf) must exist');

  // Extreme negative delta: -100,000 mm
  const resNeg = simulateDividerDrag(p, divV, -100000);
  assert.equal(resNeg.newPrev, 50, 'Extreme negative delta must clamp prevNode to minSize 50mm');
  assert.equal(resNeg.newNext, Math.round(resNeg.totalPair - 50), 'Extreme negative delta must allocate remainder to nextNode');
  assert.ok(resNeg.newNext >= 50, 'NextNode must be >= 50mm');
  assert.ok(Math.abs((resNeg.newPrev + resNeg.newNext) - resNeg.totalPair) <= 1, 'Total height pair preserved within integer rounding');

  // Extreme positive delta: +100,000 mm
  const resPos = simulateDividerDrag(p, divV, +100000);
  assert.equal(resPos.newNext, 50, 'Extreme positive delta must clamp nextNode to minSize 50mm');
  assert.equal(resPos.newPrev, Math.round(resPos.totalPair - 50), 'Extreme positive delta must allocate remainder to prevNode');
  assert.ok(resPos.newPrev >= 50, 'PrevNode must be >= 50mm');
  assert.ok(Math.abs((resPos.newPrev + resPos.newNext) - resPos.totalPair) <= 1, 'Total height pair preserved within integer rounding');
});

test('EMPIRICAL 2: Horizontal divider drag on newly created module via addOnTop', () => {
  const p = M.defaultProject();
  const col = p.columns[0];
  const nn = M.addOnTop(p, col.id, 'shelf', 350);
  assert.ok(nn);

  const lAfterAdd = computeLayout(p);
  const topDiv = lAfterAdd.dividers.find((d) => d.axis === 'v' && d.prevId === nn.id);
  assert.ok(topDiv, 'Divider immediately below added top module must exist');

  // Drag upward to minimum (extreme negative delta)
  const resNeg = simulateDividerDrag(p, topDiv, -5000);
  assert.equal(resNeg.newPrev, 50, 'Added module clamped to minSize 50mm on upward drag');
  assert.ok(Math.abs(resNeg.newNext - (resNeg.totalPair - 50)) <= 1);

  // Drag downward to shrink next sibling to minimum (extreme positive delta)
  const resPos = simulateDividerDrag(p, topDiv, +5000);
  assert.equal(resPos.newNext, 50, 'Lower sibling clamped to minSize 50mm on downward drag');
  assert.ok(Math.abs(resPos.newPrev - (resPos.totalPair - 50)) <= 1);
});

test('EMPIRICAL 3: Drag vertical divider (dir: h) bounds clamping to minSize 50mm', () => {
  const p = M.defaultProject();
  // Create horizontal division inside column 1
  const t = p.columns[1].root.children[0];
  const nn = M.addInside(p, t.id, 'h', 'shelf');
  assert.ok(nn);

  const l0 = computeLayout(p);
  const divH = l0.dividers.find((d) => d.axis === 'h' && d.parentId === t.id);
  assert.ok(divH, 'Horizontal axis divider (vertical partition) must exist');

  // Extreme negative delta
  const resNeg = simulateDividerDrag(p, divH, -99999);
  assert.equal(resNeg.newPrev, 50, 'Left sibling clamped to 50mm on extreme left drag');
  assert.ok(Math.abs(resNeg.newNext - (resNeg.totalPair - 50)) <= 1);
  assert.ok(resNeg.newNext >= 50);

  // Extreme positive delta
  const resPos = simulateDividerDrag(p, divH, +99999);
  assert.equal(resPos.newNext, 50, 'Right sibling clamped to 50mm on extreme right drag');
  assert.ok(Math.abs(resPos.newPrev - (resPos.totalPair - 50)) <= 1);
  assert.ok(resPos.newPrev >= 50);
});

test('EMPIRICAL 4: Drag inter-column divider bounds clamping to minWidth 150mm', () => {
  const p = M.defaultProject();
  const initialWidths = p.columns.map((c) => c.width);
  const totalPair01 = initialWidths[0] + initialWidths[1];

  // Test extreme left drag: delta = -50000 mm
  const resNeg = simulateColumnDrag(p, 0, false, -50000);
  assert.equal(resNeg.newLeft, 150, 'Left column must clamp to minW 150mm on extreme left drag');
  assert.equal(resNeg.newRight, totalPair01 - 150, 'Right column gets remainder of totalPair');
  assert.ok(resNeg.newRight >= 150, 'Right column must be >= 150mm');
  assert.equal(resNeg.newLeft + resNeg.newRight, totalPair01, 'Pair sum must equal original totalPair');
  assert.equal(p.columns[0].width, 150);
  assert.equal(p.columns[1].width, totalPair01 - 150);
  assert.equal(p.columns[2].width, initialWidths[2], 'Column 2 width must remain untouched');

  let l = computeLayout(p);
  let errors = auditLayoutInvariants(l, 'Inter-column drag extreme left');
  assert.deepEqual(errors, []);

  // Test extreme right drag: delta = +50000 mm
  const resPos = simulateColumnDrag(p, 0, false, +50000);
  assert.equal(resPos.newRight, 150, 'Right column must clamp to minW 150mm on extreme right drag');
  assert.equal(resPos.newLeft, totalPair01 - 150, 'Left column gets remainder of totalPair');
  assert.ok(resPos.newLeft >= 150, 'Left column must be >= 150mm');
  assert.equal(resPos.newLeft + resPos.newRight, totalPair01, 'Pair sum must equal original totalPair');
  assert.equal(p.columns[0].width, totalPair01 - 150);
  assert.equal(p.columns[1].width, 150);

  l = computeLayout(p);
  errors = auditLayoutInvariants(l, 'Inter-column drag extreme right');
  assert.deepEqual(errors, []);
});

test('EMPIRICAL 5: Drag outer lateral border divider to extreme small and large bounds', () => {
  const p = M.defaultProject();
  const lastIdx = p.columns.length - 1;
  const initialLastW = p.columns[lastIdx].width;

  // Extreme negative drag: try to shrink below 150mm
  const resNeg = simulateColumnDrag(p, lastIdx, true, -10000);
  assert.equal(resNeg.newW, 150, 'Outer border drag must clamp column width to minW 150mm');
  assert.equal(p.columns[lastIdx].width, 150);

  let l = computeLayout(p);
  let errors = auditLayoutInvariants(l, 'Outer border shrunk to 150mm');
  assert.deepEqual(errors, []);

  // Clean state: expand column to 5000mm from original width
  const p2 = M.defaultProject();
  const deltaTo5000 = 5000 - initialLastW;
  const resPos = simulateColumnDrag(p2, lastIdx, true, deltaTo5000);
  assert.equal(resPos.newW, 5000, 'Outer border drag expands column width to 5000mm');
  assert.equal(p2.columns[lastIdx].width, 5000);

  l = computeLayout(p2);
  errors = auditLayoutInvariants(l, 'Outer border expanded to 5000mm');
  assert.deepEqual(errors, []);
});

test('EMPIRICAL 6: Multi-column cascade resize to boundary limits (all columns at 150mm)', () => {
  const p = M.defaultProject();
  p.columns.forEach((c) => (c.width = 150));

  const l = computeLayout(p);
  const expectedTotalW = 150 * 3 + p.settings.thickness * 4;
  assert.equal(l.totalW, expectedTotalW);

  const errors = auditLayoutInvariants(l, 'All columns at 150mm minimum');
  assert.deepEqual(errors, []);
});

test('EMPIRICAL 7: Massive furniture coordinate math stress-test (5000mm H x 5000mm per col)', () => {
  const p = M.defaultProject();
  p.settings.height = 5000;
  p.columns.forEach((c) => (c.width = 5000));

  const l = computeLayout(p);
  const errors = auditLayoutInvariants(l, 'Massive 5000x15000 furniture');
  assert.deepEqual(errors, []);
  assert.ok(l.cutlist.total > 0);
  assert.ok(Number.isFinite(l.cutlist.total));
});

test('EMPIRICAL 8: Multi-drawer clamping vulnerability diagnosis (3-drawer module clamped to 50mm)', () => {
  // Test what happens when a 3-drawer module is clamped to minSize 50mm
  const p = M.defaultProject();
  // Column 0 has [shelf, drawer(count: 3)]
  const shelf = p.columns[0].root.children[0];
  const drawer = p.columns[0].root.children[1];
  assert.equal(drawer.type, 'drawer');
  assert.equal(drawer.count, 3);

  // Set drawer module height directly to 50mm (the clamped boundary)
  drawer.size = 50;
  shelf.size = 1300;

  const l = computeLayout(p);
  const anomalies = auditLayoutInvariants(l, '3-drawer module at minSize 50mm');

  // Verify that empirical challenger uncovers this exact negative-dimension defect:
  const negativePieces = anomalies.filter((a) => a.type === 'NEGATIVE_DIMENSION');
  const negativeCutlist = anomalies.filter((a) => a.type === 'NEGATIVE_CUTLIST_DIMENSION');

  console.log(`[CHALLENGER FINDING] 3-drawer module at 50mm produced ${negativePieces.length} negative piece dimensions and ${negativeCutlist.length} negative cutlist rows`);

  // Assert that negative-dimension defect is eliminated by 10mm clamp
  assert.equal(negativePieces.length, 0, 'Negative pieces eliminated by 10mm clamp');
  assert.equal(negativeCutlist.length, 0, 'Negative cutlist rows eliminated by 10mm clamp');
});

test('EMPIRICAL 9: Drawer module with narrow width (<56mm) produces negative drawer box dimensions', () => {
  // If a drawer module has width = 50mm (e.g. inside a narrow horizontal container or column)
  const p = M.defaultProject();
  p.columns[0].width = 50; // Set column width directly to 50mm (below 56mm threshold)
  p.columns[0].root = { id: 'd0', type: 'drawer', count: 1, size: 500 };

  const l = computeLayout(p);
  const anomalies = auditLayoutInvariants(l, '1-drawer module in 50mm wide column');
  const negativePieces = anomalies.filter((a) => a.type === 'NEGATIVE_DIMENSION');

  console.log(`[CHALLENGER FINDING] Drawer in 50mm wide column produced ${negativePieces.length} negative piece dimensions`);
  // Clamped at bw >= 2*dt+5 and inner >= 30mm prevents negative piece inversion
  assert.equal(negativePieces.length, 0, 'Negative pieces eliminated by drawer clamp');
});

test('EMPIRICAL 10: Underflow condition when totalPair < 2 * minSize in small container', () => {
  // When a furniture container has available height < 100mm (e.g. height = 116mm, avail = 80mm)
  const p = M.defaultProject();
  p.settings.height = 116; // 116 - 2 * 18 = 80mm available inside column
  p.columns[0].root.children[0].type = 'shelf';
  p.columns[0].root.children[1].type = 'shelf';

  const l0 = computeLayout(p);
  const divV = l0.dividers.find((d) => d.axis === 'v');

  // Simulate dragging divider with negative delta
  const res = simulateDividerDrag(p, divV, -20);

  console.log(`[CHALLENGER FINDING] Underflow when totalPair < 100mm: totalPair=${res.totalPair}, newPrev=${res.newPrev}, newNext=${res.newNext}`);
  assert.ok(res.totalPair < 100, `Expected totalPair < 100, got ${res.totalPair}`);
  assert.equal(res.newPrev, 50, 'newPrev clamped to minSize 50mm');
  assert.ok(res.newNext < 50, `newNext violated minSize 50mm: ${res.newNext} < 50mm`);
});

