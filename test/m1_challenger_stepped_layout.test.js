import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, DEFAULTS, getColumnHeight, orientationOf, buildCutlist } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

/**
 * Adversarial Challenger Test Suite: Stepped Furniture Layout Geometry
 * Milestone: M1 (Stepped Layout Geometry Verification)
 * Agent: Challenger M1-1
 */

// Helper to create test project with specified column widths and heights
function makeProject(columnDefs, settingsOverrides = {}) {
  const settings = {
    ...DEFAULTS,
    overhang: 20,
    thickness: 18,
    backThickness: 20,
    depth: 450,
    ...settingsOverrides,
  };

  const columns = columnDefs.map((def, idx) => {
    let width = 600;
    let height = undefined;
    let root = M.leaf('shelf');

    if (typeof def === 'number') {
      height = def;
    } else if (typeof def === 'object' && def !== null) {
      width = def.width ?? 600;
      height = def.height;
      root = def.root || M.leaf('shelf');
    }

    const col = { id: `col_${idx}`, width, root };
    if (height !== undefined) {
      col.height = height;
    }
    return col;
  });

  return { settings, columns };
}

// ============================================================================
// TOPOLOGY 1: Stepped Staircase Ascending (700, 1050, 1400, 1750, 2100mm)
// ============================================================================

test('CHALLENGE 1: Ascending staircase (700, 1050, 1400, 1750, 2100mm) geometric invariants', () => {
  const heights = [700, 1050, 1400, 1750, 2100];
  const p = makeProject(heights.map((h, i) => ({
    height: h,
    width: 500 + i * 50,
    root: i % 2 === 1 ? M.leaf('drawer', { count: 3 }) : M.leaf('shelf'),
  })));

  const l = computeLayout(p);
  const ov = l.settings.overhang;
  const t = l.settings.thickness;
  const N = heights.length;

  // 1. Bounding height maxH
  assert.equal(l.maxH, Math.max(...heights), `maxH must equal max(colHeights) = 2100, got ${l.maxH}`);

  // 2. Laterals count: N + 1
  const sidePieces = l.pieces.filter((piece) => piece.kind === 'side');
  assert.equal(sidePieces.length, N + 1, `Must have ${N + 1} laterals for ${N} columns`);

  // 3. Left outer lateral (col === 0)
  const leftLat = sidePieces.find((piece) => piece.col === 0);
  assert.ok(leftLat, 'Left lateral must exist');
  assert.equal(leftLat.sy, heights[0] + 2 * ov, `Left lateral must be strictly colHeights[0] + 2*ov (${heights[0] + 2 * ov}), got ${leftLat.sy}`);
  assert.equal(leftLat.y, -ov);
  assert.equal(leftLat.sx, t);

  // 4. Right outer lateral (col === N)
  const rightLat = sidePieces.find((piece) => piece.col === N);
  assert.ok(rightLat, 'Right lateral must exist');
  assert.equal(rightLat.sy, heights[N - 1] + 2 * ov, `Right lateral must be strictly colHeights[N-1] + 2*ov (${heights[N - 1] + 2 * ov}), got ${rightLat.sy}`);
  assert.equal(rightLat.y, -ov);
  assert.equal(rightLat.sx, t);

  // 5. Intermediate shared laterals
  for (let i = 1; i < N; i++) {
    const sharedLat = sidePieces.find((piece) => piece.col === i);
    assert.ok(sharedLat, `Shared lateral at index ${i} must exist`);
    const expectedH = Math.max(heights[i - 1], heights[i]) + 2 * ov;
    assert.equal(sharedLat.sy, expectedH, `Shared lateral ${i} must be max(${heights[i-1]}, ${heights[i]}) + 2*ov (${expectedH}), got ${sharedLat.sy}`);
    assert.equal(sharedLat.y, -ov);
  }

  // 6. Top caps: exactly N top caps, each at colHeights[i] - t
  const topCaps = l.pieces.filter((piece) => piece.name === 'Tapa superior');
  assert.equal(topCaps.length, N, `Must have ${N} top caps`);
  for (let i = 0; i < N; i++) {
    const cap = topCaps.find((piece) => piece.col === i);
    assert.ok(cap, `Top cap for col ${i} must exist`);
    assert.equal(cap.y, heights[i] - t, `Col ${i} top cap must sit at y = colHeights[${i}] - t = ${heights[i] - t}, got ${cap.y}`);
    assert.equal(cap.sy, t, `Top cap thickness must be t = ${t}`);
    assert.equal(cap.sx, p.columns[i].width, `Top cap width must match col width`);
  }

  // 7. Drawer pieces integer drawerIndex check
  const drawerPieces = l.pieces.filter((piece) => piece.kind === 'drawer' || piece.kind === 'front');
  assert.ok(drawerPieces.length > 0, 'Must have drawer pieces');
  for (const dp of drawerPieces) {
    assert.ok(Number.isInteger(dp.drawerIndex), `Drawer piece ${dp.name} must have integer drawerIndex, got ${dp.drawerIndex}`);
    assert.ok(dp.drawerIndex >= 0 && dp.drawerIndex < 3, `drawerIndex must be within [0, 2], got ${dp.drawerIndex}`);
  }
});

// ============================================================================
// TOPOLOGY 2: Stepped Staircase Descending (2100, 1750, 1400, 1050, 700mm)
// ============================================================================

test('CHALLENGE 2: Descending staircase (2100, 1750, 1400, 1050, 700mm) geometric invariants', () => {
  const heights = [2100, 1750, 1400, 1050, 700];
  const p = makeProject(heights.map((h, i) => ({
    height: h,
    width: 600,
    root: M.leaf('drawer', { count: (i % 3) + 1 }),
  })));

  const l = computeLayout(p);
  const ov = l.settings.overhang;
  const t = l.settings.thickness;
  const N = heights.length;

  assert.equal(l.maxH, Math.max(...heights));

  const sidePieces = l.pieces.filter((piece) => piece.kind === 'side');
  assert.equal(sidePieces.length, N + 1);

  // Left lateral: colHeights[0] + 2ov = 2100 + 40 = 2140
  assert.equal(sidePieces.find((p) => p.col === 0).sy, heights[0] + 2 * ov);

  // Right lateral: colHeights[N-1] + 2ov = 700 + 40 = 740
  assert.equal(sidePieces.find((p) => p.col === N).sy, heights[N - 1] + 2 * ov);

  // Intermediate shared laterals
  for (let i = 1; i < N; i++) {
    const sharedLat = sidePieces.find((p) => p.col === i);
    const expectedH = Math.max(heights[i - 1], heights[i]) + 2 * ov;
    assert.equal(sharedLat.sy, expectedH);
  }

  // Top caps
  const topCaps = l.pieces.filter((p) => p.name === 'Tapa superior');
  assert.equal(topCaps.length, N);
  for (let i = 0; i < N; i++) {
    const cap = topCaps.find((p) => p.col === i);
    assert.equal(cap.y, heights[i] - t);
  }

  // Drawers integer drawerIndex
  const drawerPieces = l.pieces.filter((p) => p.drawerIndex !== undefined);
  assert.ok(drawerPieces.length > 0);
  for (const dp of drawerPieces) {
    assert.ok(Number.isInteger(dp.drawerIndex), `Drawer piece ${dp.name} must have integer drawerIndex`);
    assert.ok(dp.drawerIndex >= 0);
  }
});

// ============================================================================
// TOPOLOGY 3: Alternating Peaks and Valleys (1800, 900, 2000, 800, 1900mm)
// ============================================================================

test('CHALLENGE 3: Alternating peaks and valleys (1800, 900, 2000, 800, 1900mm) geometric invariants', () => {
  const heights = [1800, 900, 2000, 800, 1900];
  const p = makeProject(heights.map((h, i) => ({
    height: h,
    width: 550,
    root: i === 2 ? M.leaf('shelf', { front: 'doors' }) : M.leaf('drawer', { count: 2 }),
  })));

  const l = computeLayout(p);
  const ov = l.settings.overhang;
  const t = l.settings.thickness;
  const N = heights.length;

  assert.equal(l.maxH, 2000);

  const sidePieces = l.pieces.filter((p) => p.kind === 'side');
  assert.equal(sidePieces.length, N + 1);

  // Left lateral: 1800 + 2ov
  assert.equal(sidePieces.find((p) => p.col === 0).sy, 1800 + 2 * ov);

  // Shared 1 (1800 vs 900): max is 1800 + 2ov
  assert.equal(sidePieces.find((p) => p.col === 1).sy, 1800 + 2 * ov);

  // Shared 2 (900 vs 2000): max is 2000 + 2ov
  assert.equal(sidePieces.find((p) => p.col === 2).sy, 2000 + 2 * ov);

  // Shared 3 (2000 vs 800): max is 2000 + 2ov
  assert.equal(sidePieces.find((p) => p.col === 3).sy, 2000 + 2 * ov);

  // Shared 4 (800 vs 1900): max is 1900 + 2ov
  assert.equal(sidePieces.find((p) => p.col === 4).sy, 1900 + 2 * ov);

  // Right lateral: 1900 + 2ov
  assert.equal(sidePieces.find((p) => p.col === N).sy, 1900 + 2 * ov);

  // Top caps
  for (let i = 0; i < N; i++) {
    const cap = l.pieces.find((p) => p.name === 'Tapa superior' && p.col === i);
    assert.ok(cap);
    assert.equal(cap.y, heights[i] - t);
  }

  // Divider handles (col-top)
  const topDividers = l.dividers.filter((d) => d.type === 'col-top');
  assert.equal(topDividers.length, N);
  topDividers.forEach((d) => {
    assert.equal(d.cursor, 'ns-resize');
    assert.equal(d.axis, 'v');
    assert.equal(d.y, heights[d.colIdx] - t);
    assert.equal(d.h, t);
    assert.equal(d.w, 550);
  });
});

// ============================================================================
// TOPOLOGY 4: Single Column Furniture
// ============================================================================

test('CHALLENGE 4: Single column furniture (tall: 2100mm)', () => {
  const p = makeProject([{ height: 2100, width: 700, root: M.leaf('drawer', { count: 4 }) }]);
  const l = computeLayout(p);
  const ov = l.settings.overhang;
  const t = l.settings.thickness;

  // Single column maxH
  assert.equal(l.maxH, 2100);

  // Exactly 2 laterals (left and right), no shared laterals
  const sidePieces = l.pieces.filter((p) => p.kind === 'side');
  assert.equal(sidePieces.length, 2);

  const leftLat = sidePieces.find((p) => p.col === 0);
  const rightLat = sidePieces.find((p) => p.col === 1);
  assert.equal(leftLat.sy, 2100 + 2 * ov);
  assert.equal(rightLat.sy, 2100 + 2 * ov);

  // Exactly 1 top cap
  const topCaps = l.pieces.filter((p) => p.name === 'Tapa superior');
  assert.equal(topCaps.length, 1);
  assert.equal(topCaps[0].y, 2100 - t);
  assert.equal(topCaps[0].sx, 700);

  // All 4 drawers have integer indices 0, 1, 2, 3
  const drawerPieces = l.pieces.filter((p) => p.drawerIndex !== undefined);
  assert.equal(drawerPieces.length, 4 * 6); // 6 pieces per drawer
  for (const dp of drawerPieces) {
    assert.ok(Number.isInteger(dp.drawerIndex));
    assert.ok(dp.drawerIndex >= 0 && dp.drawerIndex <= 3);
  }
});

// ============================================================================
// ADVERSARIAL STRESS TEST: Bounding Height maxH When All Columns Are Shorter Than settings.height
// ============================================================================

test('CHALLENGE 5 [CRITICAL STRESS]: Bounding height maxH when all column heights are below settings.height', () => {
  // Scenario: Nightstand / mesa de noche: col heights are 600mm and 750mm, but default settings.height is 1400mm
  const p = {
    settings: { ...DEFAULTS, height: 1400 },
    columns: [
      { id: 'col0', width: 500, height: 600, root: M.leaf('drawer', { count: 2 }) },
      { id: 'col1', width: 500, height: 750, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(p);
  const colHeights = [600, 750];
  const maxColH = Math.max(...colHeights); // 750

  // The mission requirement explicitly states:
  // "Bounding height maxH equals max(colHeights)."
  // When settings.height (1400) > maxColH (750), layout.js erroneously returns 1400
  assert.equal(
    l.maxH,
    maxColH,
    `Adversarial failure: maxH was ${l.maxH}, but max(colHeights) is ${maxColH}. layout.js line 132 erroneously uses Math.max(...colHeights, s.height)!`
  );
});

// ============================================================================
// ADVERSARIAL STRESS TEST: Single Column Shorter Than settings.height
// ============================================================================

test('CHALLENGE 6 [CRITICAL STRESS]: Single column furniture shorter than settings.height (e.g. 500mm mesa de noche vs 1400mm)', () => {
  const p = {
    settings: { ...DEFAULTS, height: 1400 },
    columns: [{ id: 'col0', width: 600, height: 500, root: M.leaf('drawer', { count: 2 }) }],
  };

  const l = computeLayout(p);
  assert.equal(
    l.maxH,
    500,
    `Adversarial failure: single-column maxH was ${l.maxH}, expected 500. Unused settings.height (1400) polluted maxH!`
  );
});

// ============================================================================
// ADVERSARIAL STRESS TEST: Exhaustive Drawer Index Verifications
// ============================================================================

test('CHALLENGE 7: Multi-column drawer configurations maintain strictly integer drawerIndex across all drawer sub-components', () => {
  const counts = [1, 2, 4, 6];
  const p = makeProject(counts.map((cnt, i) => ({
    height: 1200 + i * 200,
    width: 600,
    root: M.leaf('drawer', { count: cnt }),
  })));

  const l = computeLayout(p);

  // Group drawer pieces by col and verify drawerIndex
  for (let c = 0; c < counts.length; c++) {
    const cnt = counts[c];
    const colPieces = l.pieces.filter((piece) => piece.col === c && piece.drawerIndex !== undefined);
    // Each drawer has: Frente de gaveta, 2 Laterales de gaveta, 2 Frente/trasera, 1 Fondo = 6 pieces
    assert.equal(colPieces.length, cnt * 6, `Col ${c} must have exactly ${cnt * 6} drawer pieces`);

    const indices = new Set();
    for (const piece of colPieces) {
      assert.ok(Number.isInteger(piece.drawerIndex), `Piece ${piece.name} must have integer drawerIndex`);
      assert.ok(piece.drawerIndex >= 0 && piece.drawerIndex < cnt, `drawerIndex ${piece.drawerIndex} out of bounds [0, ${cnt - 1}]`);
      indices.add(piece.drawerIndex);
    }
    assert.equal(indices.size, cnt, `All drawer indices from 0 to ${cnt - 1} must be represented`);
  }
});

// ============================================================================
// ADVERSARIAL STRESS TEST: Randomized Fuzzing Harness (100 Topologies)
// ============================================================================

test('CHALLENGE 8: Randomized fuzzing over 100 stepped topologies with aligned settings', () => {
  // Deterministic seed pseudo-random generator
  let seed = 123456789;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  for (let run = 0; run < 100; run++) {
    const colCount = Math.floor(rand() * 8) + 1; // 1 to 8 columns
    const heights = [];
    const widths = [];
    const cols = [];

    for (let c = 0; c < colCount; c++) {
      const h = Math.round(400 + rand() * 2000); // 400mm to 2400mm
      const w = Math.round(300 + rand() * 600); // 300mm to 900mm
      heights.push(h);
      widths.push(w);
      const isDrawer = rand() > 0.5;
      const drawerCount = Math.floor(rand() * 4) + 1;
      cols.push({
        id: `c_${run}_${c}`,
        width: w,
        height: h,
        root: isDrawer ? M.leaf('drawer', { count: drawerCount }) : M.leaf('shelf'),
      });
    }

    const ov = Math.round(rand() * 30);
    const t = 15 + Math.floor(rand() * 10);
    const p = {
      settings: { ...DEFAULTS, overhang: ov, thickness: t, height: Math.max(...heights) },
      columns: cols,
    };

    const l = computeLayout(p);

    // 1. maxH
    assert.equal(l.maxH, Math.max(...heights), `Run ${run}: maxH mismatch`);

    // 2. Laterals
    const sidePieces = l.pieces.filter((piece) => piece.kind === 'side');
    assert.equal(sidePieces.length, colCount + 1, `Run ${run}: laterals count mismatch`);

    // Left lateral
    assert.equal(sidePieces.find((piece) => piece.col === 0).sy, heights[0] + 2 * ov, `Run ${run}: left lateral`);

    // Right lateral
    assert.equal(sidePieces.find((piece) => piece.col === colCount).sy, heights[colCount - 1] + 2 * ov, `Run ${run}: right lateral`);

    // Intermediate shared laterals
    for (let i = 1; i < colCount; i++) {
      const expectedH = Math.max(heights[i - 1], heights[i]) + 2 * ov;
      assert.equal(sidePieces.find((piece) => piece.col === i).sy, expectedH, `Run ${run}: shared lateral ${i}`);
    }

    // 3. Top caps
    const topCaps = l.pieces.filter((piece) => piece.name === 'Tapa superior');
    assert.equal(topCaps.length, colCount, `Run ${run}: top caps count mismatch`);
    for (let i = 0; i < colCount; i++) {
      const cap = topCaps.find((piece) => piece.col === i);
      assert.equal(cap.y, heights[i] - t, `Run ${run}: cap ${i} y position`);
      assert.equal(cap.sx, widths[i], `Run ${run}: cap ${i} width`);
    }

    // 4. Drawer pieces
    const drawerPieces = l.pieces.filter((piece) => piece.drawerIndex !== undefined);
    for (const dp of drawerPieces) {
      assert.ok(Number.isInteger(dp.drawerIndex), `Run ${run}: non-integer drawerIndex in ${dp.name}`);
    }
  }
});

// ============================================================================
// CHALLENGE 9: Stepped Cutlist Tabular Itemization & Math Consistency
// ============================================================================

test('CHALLENGE 9: Stepped Cutlist separates unequal laterals and top caps into individual tabular rows', () => {
  const project = {
    settings: { ...DEFAULTS, overhang: 20, thickness: 18 },
    columns: [
      { id: 'c0', width: 500, height: 700, root: M.leaf('shelf') },
      { id: 'c1', width: 600, height: 1050, root: M.leaf('shelf') },
      { id: 'c2', width: 700, height: 1400, root: M.leaf('shelf') },
      { id: 'c3', width: 800, height: 1750, root: M.leaf('shelf') },
      { id: 'c4', width: 900, height: 2100, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  const cl = l.cutlist;

  // Price identity invariant
  assert.equal(cl.panelsTotal + cl.hardwareTotal, cl.total);
  assert.ok(cl.total > 0);

  // Lateral rows should be itemized by height and classification:
  // Col heights: 700, 1050, 1400, 1750, 2100
  // Left lat: 740 (Lateral exterior)
  // Shared 1: max(700, 1050) + 40 = 1090 (Lateral interior)
  // Shared 2: max(1050, 1400) + 40 = 1440 (Lateral interior)
  // Shared 3: max(1400, 1750) + 40 = 1790 (Lateral interior)
  // Shared 4: max(1750, 2100) + 40 = 2140 (Lateral interior)
  // Right lat: 2100 + 40 = 2140 (Lateral exterior)
  const extRows = cl.rows.filter((r) => r.name === 'Lateral exterior');
  const intRows = cl.rows.filter((r) => r.name === 'Lateral interior');
  assert.equal(extRows.length, 2, 'Must have 2 exterior lateral rows');
  assert.equal(intRows.length, 4, 'Must have 4 interior lateral rows');
  assert.equal(extRows.find((r) => r.length === 740).qty, 1);
  assert.equal(extRows.find((r) => r.length === 2140).qty, 1);
  assert.equal(intRows.find((r) => r.length === 1090).qty, 1);
  assert.equal(intRows.find((r) => r.length === 1440).qty, 1);
  assert.equal(intRows.find((r) => r.length === 1790).qty, 1);
  assert.equal(intRows.find((r) => r.length === 2140).qty, 1);

  // Top caps rows should be itemized by width (500, 600, 700, 800, 900)
  const capRows = cl.rows.filter((r) => r.name === 'Tapa superior');
  assert.equal(capRows.length, 5, 'Must have 5 distinct top cap rows');
});

// ============================================================================
// CHALLENGE 10: Top-border Divider Handles For Interactive 2D Dragging
// ============================================================================

test('CHALLENGE 10: Every stepped column has a col-top divider handle with ns-resize cursor at y = colH - t', () => {
  const heights = [700, 1050, 1400, 1750, 2100];
  const widths = [500, 550, 600, 650, 700];
  const project = {
    settings: { ...DEFAULTS, thickness: 18 },
    columns: heights.map((h, i) => ({
      id: `c_${i}`,
      width: widths[i],
      height: h,
      root: M.leaf('shelf'),
    })),
  };

  const l = computeLayout(project);
  const topDividers = l.dividers.filter((d) => d.type === 'col-top');

  assert.equal(topDividers.length, heights.length, 'Must have exactly one col-top handle per column');

  let runningX = 18;
  heights.forEach((h, i) => {
    const d = topDividers.find((td) => td.colIdx === i);
    assert.ok(d, `col-top handle for column ${i} must exist`);
    assert.equal(d.axis, 'v');
    assert.equal(d.cursor, 'ns-resize');
    assert.equal(d.x, runningX);
    assert.equal(d.y, h - 18);
    assert.equal(d.w, widths[i]);
    assert.equal(d.h, 18);
    assert.equal(d.colId, `c_${i}`);
    runningX += widths[i] + 18;
  });
});
