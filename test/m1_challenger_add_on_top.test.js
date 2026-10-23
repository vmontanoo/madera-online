import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, DEFAULTS, getColumnHeight } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

// Helper to count modules recursively in a column
function countModulesInCol(col) {
  let count = 0;
  const walk = (node) => {
    if (!node) return;
    if (node.type !== 'multiple') {
      count++;
    } else if (Array.isArray(node.children)) {
      node.children.forEach(walk);
    }
  };
  walk(col.root);
  return count;
}

// Helper to snapshot all cell bounding boxes for a column
function snapshotColumnCells(layout, colIdx) {
  const cells = {};
  for (const [id, cell] of Object.entries(layout.cells)) {
    if (cell.col === colIdx) {
      cells[id] = { x: cell.x, y: cell.y, w: cell.w, h: cell.h };
    }
  }
  return cells;
}

// Helper to snapshot all pieces for a column
function snapshotColumnPieces(layout, colIdx) {
  return layout.pieces
    .filter((p) => p.col === colIdx && p.kind !== 'side')
    .map((p) => ({
      name: p.name,
      kind: p.kind,
      x: p.x,
      y: p.y,
      z: p.z,
      sx: p.sx,
      sy: p.sy,
      sz: p.sz,
    }));
}

// ============================================================================
// CHALLENGE 1: INVARIANCE UNDER REPEATED SEQUENTIAL ADDITIONS (5 SEQUENTIAL CALLS)
// ============================================================================

test('CHALLENGE 1: 5 sequential addOnTop calls on column 1 of a 4-column project: zero tolerance invariance on columns 0, 2, and 3', () => {
  const t = 18;
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1400,
      thickness: t,
      overhang: 20,
      backThickness: 20,
    },
    columns: [
      { id: 'col0', width: 500, height: 1000, root: M.leaf('shelf') },
      { id: 'col1', width: 600, height: 1200, root: M.leaf('shelf') },
      {
        id: 'col2',
        width: 700,
        height: 1500,
        root: {
          id: 'col2-root',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            M.leaf('shelf', { size: 400 }),
            M.leaf('drawer', { size: 400, count: 2 }),
            M.leaf('shelf', { size: 628 }),
          ],
        },
      },
      { id: 'col3', width: 800, height: 1700, root: M.leaf('shelf') },
    ],
  };

  const initialSettingsHeight = project.settings.height;

  // Initial baseline layout
  const layout0 = computeLayout(project);

  const baselineCol0ModuleCount = countModulesInCol(project.columns[0]);
  const baselineCol2ModuleCount = countModulesInCol(project.columns[2]);
  const baselineCol3ModuleCount = countModulesInCol(project.columns[3]);

  const baselineCol0Cells = snapshotColumnCells(layout0, 0);
  const baselineCol2Cells = snapshotColumnCells(layout0, 2);
  const baselineCol3Cells = snapshotColumnCells(layout0, 3);

  const baselineCol0Pieces = snapshotColumnPieces(layout0, 0);
  const baselineCol2Pieces = snapshotColumnPieces(layout0, 2);
  const baselineCol3Pieces = snapshotColumnPieces(layout0, 3);

  const additions = [
    { type: 'shelf', h: 300 },
    { type: 'shelf', h: 350 },
    { type: 'shelf', h: 250 },
    { type: 'shelf', h: 400 },
    { type: 'shelf', h: 320 },
  ];

  let expectedCol1Height = 1200;

  additions.forEach((addSpec, step) => {
    expectedCol1Height += addSpec.h + t;

    // Execute addOnTop on column 1
    const addedMod = M.addOnTop(project, 'col1', addSpec.type, addSpec.h, false);
    assert.ok(addedMod, `Step ${step + 1}: addOnTop must return created module`);

    // Target column assertions
    assert.equal(
      project.columns[1].height,
      expectedCol1Height,
      `Step ${step + 1}: Target col 1 height must be exactly ${expectedCol1Height}, got ${project.columns[1].height}`
    );
    assert.equal(
      countModulesInCol(project.columns[1]),
      1 + (step + 1),
      `Step ${step + 1}: Target col 1 must have exactly ${1 + step + 1} modules`
    );

    // Global settings height must remain completely unchanged
    assert.equal(
      project.settings.height,
      initialSettingsHeight,
      `Step ${step + 1}: project.settings.height must remain unchanged (${initialSettingsHeight})`
    );

    // ZERO TOLERANCE: Module counts on sibling columns must be strictly identical to baseline
    assert.equal(
      countModulesInCol(project.columns[0]),
      baselineCol0ModuleCount,
      `Step ${step + 1}: Col 0 received unexpected module(s)`
    );
    assert.equal(
      countModulesInCol(project.columns[2]),
      baselineCol2ModuleCount,
      `Step ${step + 1}: Col 2 received unexpected module(s)`
    );
    assert.equal(
      countModulesInCol(project.columns[3]),
      baselineCol3ModuleCount,
      `Step ${step + 1}: Col 3 received unexpected module(s)`
    );

    // Sibling heights must be strictly identical to baseline
    assert.equal(project.columns[0].height, 1000, `Step ${step + 1}: Col 0 height drifted`);
    assert.equal(project.columns[2].height, 1500, `Step ${step + 1}: Col 2 height drifted`);
    assert.equal(project.columns[3].height, 1700, `Step ${step + 1}: Col 3 height drifted`);

    // Recompute layout and perform ZERO TOLERANCE check on cells and pieces
    const currentLayout = computeLayout(project);

    // Check cells for Col 0
    const curCol0Cells = snapshotColumnCells(currentLayout, 0);
    assert.equal(Object.keys(curCol0Cells).length, Object.keys(baselineCol0Cells).length);
    for (const [id, baseCell] of Object.entries(baselineCol0Cells)) {
      const cur = curCol0Cells[id];
      assert.ok(cur, `Step ${step + 1}: Col 0 cell ${id} missing`);
      const dx = Math.abs(cur.x - baseCell.x);
      const dy = Math.abs(cur.y - baseCell.y);
      const dw = Math.abs(cur.w - baseCell.w);
      const dh = Math.abs(cur.h - baseCell.h);
      assert.ok(dx < 0.0001, `Step ${step + 1}: Col 0 cell ${id} x deviation ${dx}`);
      assert.ok(dy < 0.0001, `Step ${step + 1}: Col 0 cell ${id} y deviation ${dy}`);
      assert.ok(dw < 0.0001, `Step ${step + 1}: Col 0 cell ${id} w deviation ${dw}`);
      assert.ok(dh < 0.0001, `Step ${step + 1}: Col 0 cell ${id} h deviation ${dh}`);
    }

    // Check cells for Col 2
    const curCol2Cells = snapshotColumnCells(currentLayout, 2);
    assert.equal(Object.keys(curCol2Cells).length, Object.keys(baselineCol2Cells).length);
    for (const [id, baseCell] of Object.entries(baselineCol2Cells)) {
      const cur = curCol2Cells[id];
      assert.ok(cur, `Step ${step + 1}: Col 2 cell ${id} missing`);
      const dx = Math.abs(cur.x - baseCell.x);
      const dy = Math.abs(cur.y - baseCell.y);
      const dw = Math.abs(cur.w - baseCell.w);
      const dh = Math.abs(cur.h - baseCell.h);
      assert.ok(dx < 0.0001, `Step ${step + 1}: Col 2 cell ${id} x deviation ${dx}`);
      assert.ok(dy < 0.0001, `Step ${step + 1}: Col 2 cell ${id} y deviation ${dy}`);
      assert.ok(dw < 0.0001, `Step ${step + 1}: Col 2 cell ${id} w deviation ${dw}`);
      assert.ok(dh < 0.0001, `Step ${step + 1}: Col 2 cell ${id} h deviation ${dh}`);
    }

    // Check cells for Col 3
    const curCol3Cells = snapshotColumnCells(currentLayout, 3);
    assert.equal(Object.keys(curCol3Cells).length, Object.keys(baselineCol3Cells).length);
    for (const [id, baseCell] of Object.entries(baselineCol3Cells)) {
      const cur = curCol3Cells[id];
      assert.ok(cur, `Step ${step + 1}: Col 3 cell ${id} missing`);
      const dx = Math.abs(cur.x - baseCell.x);
      const dy = Math.abs(cur.y - baseCell.y);
      const dw = Math.abs(cur.w - baseCell.w);
      const dh = Math.abs(cur.h - baseCell.h);
      assert.ok(dx < 0.0001, `Step ${step + 1}: Col 3 cell ${id} x deviation ${dx}`);
      assert.ok(dy < 0.0001, `Step ${step + 1}: Col 3 cell ${id} y deviation ${dy}`);
      assert.ok(dw < 0.0001, `Step ${step + 1}: Col 3 cell ${id} w deviation ${dw}`);
      assert.ok(dh < 0.0001, `Step ${step + 1}: Col 3 cell ${id} h deviation ${dh}`);
    }

    // Check pieces (top cap, base, back) for Cols 0, 2, 3
    const curCol0Pieces = snapshotColumnPieces(currentLayout, 0);
    assert.deepEqual(curCol0Pieces, baselineCol0Pieces, `Step ${step + 1}: Col 0 pieces modified`);

    const curCol2Pieces = snapshotColumnPieces(currentLayout, 2);
    assert.deepEqual(curCol2Pieces, baselineCol2Pieces, `Step ${step + 1}: Col 2 pieces modified`);

    const curCol3Pieces = snapshotColumnPieces(currentLayout, 3);
    assert.deepEqual(curCol3Pieces, baselineCol3Pieces, `Step ${step + 1}: Col 3 pieces modified`);
  });
});

// ============================================================================
// CHALLENGE 2: CROSS-COLUMN INTERLEAVED ADDITIONS
// ============================================================================

test('CHALLENGE 2: Cross-column interleaved additions (Col 0 -> Col 2 -> Col 0 -> Col 1) track heights independently without neighbor bleed', () => {
  const t = 18;
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1400,
      thickness: t,
    },
    columns: [
      { id: 'c0', width: 600, height: 900, root: M.leaf('shelf') },
      { id: 'c1', width: 600, height: 1200, root: M.leaf('shelf') },
      { id: 'c2', width: 600, height: 1500, root: M.leaf('shelf') },
      { id: 'c3', width: 600, height: 1800, root: M.leaf('shelf') },
    ],
  };

  const initialHeights = { c0: 900, c1: 1200, c2: 1500, c3: 1800 };
  const currentExpectedHeights = { ...initialHeights };

  const interleavings = [
    { targetCol: 'c0', targetIdx: 0, addedH: 350 },
    { targetCol: 'c2', targetIdx: 2, addedH: 400 },
    { targetCol: 'c0', targetIdx: 0, addedH: 250 },
    { targetCol: 'c1', targetIdx: 1, addedH: 300 },
  ];

  interleavings.forEach((op, step) => {
    // Record layout before this step
    const layoutPre = computeLayout(project);
    const nonTargetIndices = [0, 1, 2, 3].filter((i) => i !== op.targetIdx);
    const nonTargetSnapshots = nonTargetIndices.map((i) => ({
      idx: i,
      id: project.columns[i].id,
      height: project.columns[i].height,
      modCount: countModulesInCol(project.columns[i]),
      cells: snapshotColumnCells(layoutPre, i),
      pieces: snapshotColumnPieces(layoutPre, i),
    }));

    // Update expected height for target
    currentExpectedHeights[op.targetCol] += op.addedH + t;

    // Execute addOnTop
    const addedLeaf = M.addOnTop(project, op.targetCol, 'shelf', op.addedH, false);
    assert.ok(addedLeaf, `Interleaved step ${step + 1}: returned leaf must exist`);

    // Verify target column height
    assert.equal(
      project.columns[op.targetIdx].height,
      currentExpectedHeights[op.targetCol],
      `Interleaved step ${step + 1}: Target ${op.targetCol} height mismatch`
    );

    // Compute layout after addition
    const layoutPost = computeLayout(project);

    // Verify all non-target columns experienced ZERO neighbor bleed
    nonTargetSnapshots.forEach((snap) => {
      const col = project.columns[snap.idx];
      assert.equal(
        col.height,
        snap.height,
        `Interleaved step ${step + 1}: Neighbor ${snap.id} height leaked (was ${snap.height}, now ${col.height})`
      );
      assert.equal(
        countModulesInCol(col),
        snap.modCount,
        `Interleaved step ${step + 1}: Neighbor ${snap.id} received unexpected module`
      );

      // Check cell coordinate and size invariance
      const curCells = snapshotColumnCells(layoutPost, snap.idx);
      for (const [cellId, baseCell] of Object.entries(snap.cells)) {
        const curCell = curCells[cellId];
        assert.ok(curCell, `Interleaved step ${step + 1}: Cell ${cellId} disappeared in neighbor ${snap.id}`);
        assert.ok(
          Math.abs(curCell.h - baseCell.h) < 0.0001,
          `Interleaved step ${step + 1}: Neighbor ${snap.id} cell ${cellId} height drifted: base=${baseCell.h}, cur=${curCell.h}`
        );
        assert.ok(
          Math.abs(curCell.y - baseCell.y) < 0.0001,
          `Interleaved step ${step + 1}: Neighbor ${snap.id} cell ${cellId} y drifted: base=${baseCell.y}, cur=${curCell.y}`
        );
      }

      // Check piece invariance
      const curPieces = snapshotColumnPieces(layoutPost, snap.idx);
      assert.deepEqual(curPieces, snap.pieces, `Interleaved step ${step + 1}: Neighbor ${snap.id} pieces changed`);
    });
  });

  // Final confirmation of cumulative heights
  assert.equal(project.columns[0].height, 900 + 350 + t + 250 + t);
  assert.equal(project.columns[1].height, 1200 + 300 + t);
  assert.equal(project.columns[2].height, 1500 + 400 + t);
  assert.equal(project.columns[3].height, 1800);
});

// ============================================================================
// CHALLENGE 3: DEFAULT PARAMETER TEST (addOnTop without 5th argument)
// ============================================================================

test('CHALLENGE 3: addOnTop(project, colId) without 5th argument defaults to single-column stepped mode (allColumns = false)', () => {
  const p = M.defaultProject();
  const initialH = p.settings.height; // 1400
  const t = p.settings.thickness; // 18

  const targetColId = p.columns[1].id;
  const col0Id = p.columns[0].id;
  const col2Id = p.columns[2].id;

  const col0ModCountBefore = countModulesInCol(p.columns[0]);
  const col2ModCountBefore = countModulesInCol(p.columns[2]);

  // Call addOnTop with ONLY 2 arguments!
  const added = M.addOnTop(p, targetColId);
  assert.ok(added, 'Must return new module');
  assert.equal(added.type, 'shelf', 'Default type must be "shelf"');
  assert.equal(added.size, 350, 'Default addedHeight must be 350');

  // Verify single-column stepped behavior:
  // 1. Target column height increases by default 350 + t
  assert.equal(
    p.columns[1].height,
    initialH + 350 + t,
    `Target column height must be ${initialH + 350 + t}, got ${p.columns[1].height}`
  );

  // 2. Sibling columns received 0 new modules
  assert.equal(
    countModulesInCol(p.columns[0]),
    col0ModCountBefore,
    'Sibling column 0 must not receive new modules when 5th arg is omitted'
  );
  assert.equal(
    countModulesInCol(p.columns[2]),
    col2ModCountBefore,
    'Sibling column 2 must not receive new modules when 5th arg is omitted'
  );

  // 3. Sibling columns had heights locked to initial settings.height
  assert.equal(p.columns[0].height, initialH, 'Sibling column 0 height must lock to initial settings.height');
  assert.equal(p.columns[2].height, initialH, 'Sibling column 2 height must lock to initial settings.height');

  // 4. Global project.settings.height remains strictly unmodified
  assert.equal(
    p.settings.height,
    initialH,
    `project.settings.height must remain ${initialH}, got ${p.settings.height}`
  );

  // 5. Compute layout and check that sibling cell heights remain unchanged
  const l = computeLayout(p);
  assert.equal(l.maxH, initialH + 350 + t);
  assert.equal(l.cells[p.columns[0].root.id].h, initialH - 2 * t);
  assert.equal(l.cells[p.columns[2].root.id].h, initialH - 2 * t);
});

// ============================================================================
// CHALLENGE 4: ADVERSARIAL STRESS - SHARED LATERAL INTEGRITY & TOP BORDER DIVIDERS
// ============================================================================

test('CHALLENGE 4: Shared laterals and col-top dividers dynamically recomputed after stepped additions', () => {
  const project = {
    settings: { ...DEFAULTS, overhang: 25, thickness: 18 },
    columns: [
      { id: 'c0', width: 500, height: 1000, root: M.leaf('shelf') },
      { id: 'c1', width: 500, height: 1000, root: M.leaf('shelf') },
    ],
  };

  const t = 18;
  const ov = 25;

  // Initially equal heights: shared lateral sy = 1000 + 2*ov = 1050
  const l0 = computeLayout(project);
  const shared0 = l0.pieces.find((p) => p.kind === 'side' && p.col === 1);
  assert.equal(shared0.sy, 1050);

  // Add on top of c1: 400mm
  M.addOnTop(project, 'c1', 'shelf', 400, false);
  // c1 height becomes 1000 + 400 + 18 = 1418
  assert.equal(project.columns[1].height, 1418);

  const l1 = computeLayout(project);
  const shared1 = l1.pieces.find((p) => p.kind === 'side' && p.col === 1);
  // Shared lateral must rise to max(1000, 1418) + 2*ov = 1418 + 50 = 1468
  assert.equal(shared1.sy, 1468);

  // Top border dividers
  const topDividers = l1.dividers.filter((d) => d.type === 'col-top');
  assert.equal(topDividers.length, 2);
  const td0 = topDividers.find((d) => d.colId === 'c0');
  const td1 = topDividers.find((d) => d.colId === 'c1');
  assert.equal(td0.y, 1000 - t);
  assert.equal(td1.y, 1418 - t);
});
