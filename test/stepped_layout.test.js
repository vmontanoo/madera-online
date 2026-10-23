import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, DEFAULTS, getColumnHeight, orientationOf, buildCutlist } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

test('1. getColumnHeight returns col.height when valid positive number, falls back to settings.height and DEFAULTS.height', () => {
  const settings = { height: 1500 };

  // Explicit positive finite column height
  assert.equal(getColumnHeight({ height: 1200 }, settings), 1200);
  assert.equal(getColumnHeight({ height: 800.5 }, settings), 800.5);

  // Fallback to settings.height when undefined, null, zero, negative, or non-finite
  assert.equal(getColumnHeight({ height: undefined }, settings), 1500);
  assert.equal(getColumnHeight({ height: null }, settings), 1500);
  assert.equal(getColumnHeight({ height: 0 }, settings), 1500);
  assert.equal(getColumnHeight({ height: -200 }, settings), 1500);
  assert.equal(getColumnHeight({ height: NaN }, settings), 1500);
  assert.equal(getColumnHeight({}, settings), 1500);
  assert.equal(getColumnHeight(null, settings), 1500);

  // Fallback to DEFAULTS.height when settings is missing or has invalid height
  assert.equal(getColumnHeight({}, null), DEFAULTS.height);
  assert.equal(getColumnHeight({}, {}), DEFAULTS.height);
  assert.equal(getColumnHeight({}, { height: -50 }), DEFAULTS.height);
  assert.equal(getColumnHeight({}, { height: 0 }), DEFAULTS.height);
});

test('2. Independent column heights with unequal heights (800mm and 1600mm): layout geometry and maxH', () => {
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1400,
      overhang: 20,
      thickness: 18,
      backThickness: 20,
      depth: 450,
      grooveClearance: 1,
    },
    columns: [
      { id: 'col0', width: 600, height: 800, root: M.leaf('shelf') },
      { id: 'col1', width: 800, height: 1600, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  const s = l.settings;
  const t = s.thickness;
  const ov = s.overhang;

  // Bounding height maxH
  assert.equal(l.maxH, 1600);

  // Column heights evaluated correctly
  assert.equal(getColumnHeight(project.columns[0], s), 800);
  assert.equal(getColumnHeight(project.columns[1], s), 1600);

  // Total width: t + 600 + t + 800 + t = 18 + 600 + 18 + 800 + 18 = 1454
  assert.equal(l.totalW, 1454);

  // Outer and shared laterals
  const sidePieces = l.pieces.filter((p) => p.kind === 'side');
  assert.equal(sidePieces.length, 3, 'Must have 3 laterals for 2 columns');

  // Left lateral (flanking only Col 0)
  const leftLat = sidePieces.find((p) => p.col === 0);
  assert.ok(leftLat);
  assert.equal(leftLat.x, 0);
  assert.equal(leftLat.y, -ov);
  assert.equal(leftLat.sy, 800 + 2 * ov, `Left lateral height must be 800 + 2*ov (840mm), got ${leftLat.sy}`);
  assert.equal(leftLat.sx, t);
  assert.equal(leftLat.sz, s.depth);

  // Intermediate shared lateral (between Col 0 at 800 and Col 1 at 1600)
  const sharedLat = sidePieces.find((p) => p.col === 1);
  assert.ok(sharedLat);
  assert.equal(sharedLat.x, t + 600);
  assert.equal(sharedLat.y, -ov);
  assert.equal(sharedLat.sy, Math.max(800, 1600) + 2 * ov, `Intermediate shared lateral must rise to max(800, 1600) + 2*ov (1640mm), got ${sharedLat.sy}`);
  assert.equal(sharedLat.sx, t);

  // Right lateral (flanking Col 1)
  const rightLat = sidePieces.find((p) => p.col === 2);
  assert.ok(rightLat);
  assert.equal(rightLat.x, t + 600 + t + 800);
  assert.equal(rightLat.y, -ov);
  assert.equal(rightLat.sy, 1600 + 2 * ov, `Right lateral height must be 1600 + 2*ov (1640mm), got ${rightLat.sy}`);

  // Independent Top Caps ('Tapa superior')
  const topCaps = l.pieces.filter((p) => p.name === 'Tapa superior');
  assert.equal(topCaps.length, 2, 'Each column must have its own independent top cap');

  const cap0 = topCaps.find((p) => p.col === 0);
  assert.ok(cap0);
  assert.equal(cap0.x, t);
  assert.equal(cap0.y, 800 - t, `Col 0 top cap must sit at y = 800 - t = ${800 - t}, got ${cap0.y}`);
  assert.equal(cap0.sx, 600);
  assert.equal(cap0.sy, t);
  assert.equal(cap0.sz, s.depth - s.backThickness);

  const cap1 = topCaps.find((p) => p.col === 1);
  assert.ok(cap1);
  assert.equal(cap1.x, t + 600 + t);
  assert.equal(cap1.y, 1600 - t, `Col 1 top cap must sit at y = 1600 - t = ${1600 - t}, got ${cap1.y}`);
  assert.equal(cap1.sx, 800);
  assert.equal(cap1.sy, t);

  // Bases at y = 0
  const bases = l.pieces.filter((p) => p.name === 'Base');
  assert.equal(bases.length, 2);
  bases.forEach((b) => assert.equal(b.y, 0));
  assert.equal(bases.find((b) => b.col === 0).sx, 600);
  assert.equal(bases.find((b) => b.col === 1).sx, 800);

  // Stepped back panels ('Fondo')
  const backs = l.pieces.filter((p) => p.kind === 'back');
  assert.equal(backs.length, 2);
  const g = s.grooveClearance;

  const back0 = backs.find((p) => p.col === 0);
  assert.ok(back0);
  assert.equal(back0.y, t - 10 + g);
  assert.equal(back0.sy, 800 - 2 * t + 20 - 2 * g, `Col 0 back panel must have height corresponding to 800mm`);
  assert.equal(back0.sx, 600 + 20 - 2 * g);

  const back1 = backs.find((p) => p.col === 1);
  assert.ok(back1);
  assert.equal(back1.y, t - 10 + g);
  assert.equal(back1.sy, 1600 - 2 * t + 20 - 2 * g, `Col 1 back panel must have height corresponding to 1600mm`);
  assert.equal(back1.sx, 800 + 20 - 2 * g);

  // Internal module cells
  const cell0 = l.cells[project.columns[0].root.id];
  const cell1 = l.cells[project.columns[1].root.id];
  assert.equal(cell0.h, 800 - 2 * t);
  assert.equal(cell1.h, 1600 - 2 * t);
});

test('3. Intermediate shared lateral rises to max(Hi-1, Hi) + 2*ov across multi-column staggered configurations', () => {
  // Test alternating: 1200mm, 2000mm (tall center), 1500mm
  const p1 = {
    settings: { ...DEFAULTS, overhang: 25, thickness: 18 },
    columns: [
      { id: 'c0', width: 500, height: 1200, root: M.leaf('shelf') },
      { id: 'c1', width: 600, height: 2000, root: M.leaf('shelf') },
      { id: 'c2', width: 700, height: 1500, root: M.leaf('shelf') },
    ],
  };

  const l1 = computeLayout(p1);
  const sides1 = l1.pieces.filter((p) => p.kind === 'side');
  assert.equal(sides1.length, 4);

  // Left lateral: 1200 + 50 = 1250
  assert.equal(sides1.find((p) => p.col === 0).sy, 1250);
  // Shared lateral 1 (col 0 & 1): max(1200, 2000) + 50 = 2050
  assert.equal(sides1.find((p) => p.col === 1).sy, 2050);
  // Shared lateral 2 (col 1 & 2): max(2000, 1500) + 50 = 2050
  assert.equal(sides1.find((p) => p.col === 2).sy, 2050);
  // Right lateral: 1500 + 50 = 1550
  assert.equal(sides1.find((p) => p.col === 3).sy, 1550);

  // Test descending staircase: 2200mm, 1800mm, 1200mm
  const p2 = {
    settings: { ...DEFAULTS, overhang: 20, thickness: 18 },
    columns: [
      { id: 'c0', width: 500, height: 2200, root: M.leaf('shelf') },
      { id: 'c1', width: 500, height: 1800, root: M.leaf('shelf') },
      { id: 'c2', width: 500, height: 1200, root: M.leaf('shelf') },
    ],
  };

  const l2 = computeLayout(p2);
  const sides2 = l2.pieces.filter((p) => p.kind === 'side');
  assert.equal(sides2.find((p) => p.col === 0).sy, 2240);
  assert.equal(sides2.find((p) => p.col === 1).sy, Math.max(2200, 1800) + 40); // 2240
  assert.equal(sides2.find((p) => p.col === 2).sy, Math.max(1800, 1200) + 40); // 1840
  assert.equal(sides2.find((p) => p.col === 3).sy, 1240);
});

test('4. Top-border divider handles generated for 2D vertical drag with ns-resize cursor', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1400, thickness: 18 },
    columns: [
      { id: 'colA', width: 650, height: 950, root: M.leaf('shelf') },
      { id: 'colB', width: 750, height: 1750, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  const topDividers = l.dividers.filter((d) => d.type === 'col-top');

  assert.equal(topDividers.length, 2, 'Must have exactly one col-top divider per column');

  // Col A top divider
  const td0 = topDividers.find((d) => d.colIdx === 0);
  assert.ok(td0);
  assert.equal(td0.axis, 'v');
  assert.equal(td0.colId, 'colA');
  assert.equal(td0.x, 18);
  assert.equal(td0.y, 950 - 18);
  assert.equal(td0.w, 650);
  assert.equal(td0.h, 18);
  assert.equal(td0.cursor, 'ns-resize');

  // Col B top divider
  const td1 = topDividers.find((d) => d.colIdx === 1);
  assert.ok(td1);
  assert.equal(td1.axis, 'v');
  assert.equal(td1.colId, 'colB');
  assert.equal(td1.x, 18 + 650 + 18);
  assert.equal(td1.y, 1750 - 18);
  assert.equal(td1.w, 750);
  assert.equal(td1.h, 18);
  assert.equal(td1.cursor, 'ns-resize');
});

test('5. addOnTop(project, colId, "shelf", 350, false) increases only target column height, leaves sibling column height untouched, and sibling modules have zero change', () => {
  const t = 18;
  const project = {
    settings: { ...DEFAULTS, height: 1400, thickness: t },
    columns: [
      { id: 'col0', width: 600, height: 800, root: M.leaf('shelf') },
      {
        id: 'col1',
        width: 800,
        height: 1600,
        root: {
          id: 'col1-root',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            M.leaf('shelf', { size: 600 }),
            M.leaf('drawer', { size: 400, count: 2 }),
            M.leaf('shelf', { size: 564 }),
          ],
        },
      },
    ],
  };

  // Pre-addition layout
  const lBefore = computeLayout(project);
  const col1CellHeightsBefore = project.columns[1].root.children.map((ch) => lBefore.cells[ch.id].h);
  const initialSettingsH = project.settings.height;

  // Add module ON TOP of Column 0 with allColumns = false
  const newMod = M.addOnTop(project, 'col0', 'shelf', 350, false);
  assert.ok(newMod, 'Must return newly created module');

  // 1. Target column height increases by exactly addedHeight + t
  assert.equal(project.columns[0].height, 800 + 350 + t, `Target column height must be ${800 + 350 + t}, got ${project.columns[0].height}`);

  // 2. Sibling column height strictly untouched
  assert.equal(project.columns[1].height, 1600, `Sibling column height must remain strictly 1600, got ${project.columns[1].height}`);

  // 3. Sibling column root has zero new children
  assert.equal(project.columns[1].root.children.length, 3, 'Sibling column must have received zero new children');

  // 4. Global project.settings.height is NOT incremented in stepped mode
  assert.equal(project.settings.height, initialSettingsH, 'project.settings.height must not be incremented in stepped mode');

  // Post-addition layout
  const lAfter = computeLayout(project);

  // Target column new top module received exactly 350mm
  assert.ok(Math.abs(lAfter.cells[newMod.id].h - 350) < 0.1, `New module height was ${lAfter.cells[newMod.id].h}, expected 350`);

  // Sibling column modules experienced 0.0mm deviation
  project.columns[1].root.children.forEach((ch, idx) => {
    const beforeH = col1CellHeightsBefore[idx];
    const afterH = lAfter.cells[ch.id].h;
    assert.ok(Math.abs(afterH - beforeH) < 0.1, `Sibling module ${idx} compressed/drifted: before=${beforeH}, after=${afterH}`);
  });

  // Intermediate shared lateral updated to reflect new target column height
  const sharedLat = lAfter.pieces.find((p) => p.kind === 'side' && p.col === 1);
  assert.equal(sharedLat.sy, Math.max(1168, 1600) + 2 * lAfter.settings.overhang);
});

test('6. addOnTop with allColumns=false locks undefined sibling column heights to project.settings.height', () => {
  const p = M.defaultProject(); // all columns have height undefined
  const initialH = p.settings.height; // 1400
  const t = p.settings.thickness;

  const targetColId = p.columns[0].id;
  const newMod = M.addOnTop(p, targetColId, 'shelf', 350, false);
  assert.ok(newMod);

  // Target column gets (1400 + 350 + t)
  assert.equal(p.columns[0].height, initialH + 350 + t);

  // Sibling columns 1 and 2 must have their heights locked to initial settings.height
  assert.equal(p.columns[1].height, initialH, 'Sibling column 1 must have its height locked to settings.height');
  assert.equal(p.columns[2].height, initialH, 'Sibling column 2 must have its height locked to settings.height');

  // Settings height remains untouched
  assert.equal(p.settings.height, initialH, 'project.settings.height must remain untouched');

  // Compute layout and verify sibling cell millimeter invariance
  const l = computeLayout(p);
  assert.equal(l.maxH, initialH + 350 + t);
  assert.equal(l.cells[p.columns[1].root.id].h, initialH - 2 * t);
  assert.equal(l.cells[p.columns[2].root.id].h, initialH - 2 * t);
});

test('7. addOnTop with allColumns=true maintains legacy behavior expanding all columns and settings.height', () => {
  const p = M.defaultProject();
  const initialH = p.settings.height;
  const t = p.settings.thickness;
  const initialCol1Count = p.columns[1].root.children.length;

  const newMod = M.addOnTop(p, p.columns[0].id, 'shelf', 350, true);
  assert.ok(newMod);

  // All columns expanded
  assert.equal(p.settings.height, initialH + 350 + t);
  assert.equal(p.columns[1].root.children.length, initialCol1Count + 1, 'Sibling column must have received shelf module');

  const l = computeLayout(p);
  assert.ok(l.pieces.length > 0);
  assert.equal(l.settings.height, initialH + 350 + t);
});

test('8. Kinematic grouping: every drawer piece is tagged with integer drawerIndex', () => {
  const project = {
    settings: { ...DEFAULTS },
    columns: [
      {
        id: 'col0',
        width: 600,
        height: 1000,
        root: M.leaf('drawer', { count: 3 }),
      },
    ],
  };

  const l = computeLayout(project);
  const drawerPieces = l.pieces.filter((p) => p.kind === 'drawer' || p.kind === 'front');

  // 3 drawers x (1 front + 2 sides + 2 front/backs + 1 bottom) = 18 pieces
  assert.equal(drawerPieces.length, 3 * 6);

  // Verify each piece has a valid drawerIndex
  drawerPieces.forEach((p) => {
    assert.ok(
      typeof p.drawerIndex === 'number' && Number.isInteger(p.drawerIndex),
      `Piece ${p.name} must have integer drawerIndex, got ${p.drawerIndex}`
    );
    assert.ok(p.drawerIndex >= 0 && p.drawerIndex < 3, `drawerIndex ${p.drawerIndex} out of bounds`);
  });

  // Verify each index idx has exactly 1 front and 5 box pieces
  for (let idx = 0; idx < 3; idx++) {
    const piecesForIdx = drawerPieces.filter((p) => p.drawerIndex === idx);
    assert.equal(piecesForIdx.length, 6, `Drawer ${idx} must have 6 pieces`);
    assert.equal(piecesForIdx.filter((p) => p.name === 'Frente de gaveta').length, 1);
    assert.equal(piecesForIdx.filter((p) => p.name === 'Lateral de gaveta').length, 2);
    assert.equal(piecesForIdx.filter((p) => p.name === 'Frente/trasera de gaveta').length, 2);
    assert.equal(piecesForIdx.filter((p) => p.name === 'Fondo de gaveta').length, 1);
  }
});

test('9. setSize on root module vertically sets f.col.height', () => {
  const p = M.defaultProject();
  const l = computeLayout(p);
  const col0RootId = p.columns[0].root.id;
  const t = p.settings.thickness;

  // Resize root vertically to 1100mm
  M.setSize(p, l.cells, col0RootId, 'h', 1100, p.settings);
  assert.equal(p.columns[0].height, 1100 + 2 * t);
});

test('10. normalizeProject preserves valid column.height', () => {
  const p = {
    columns: [
      { id: 'c1', width: 500, height: 950, root: { id: 'r1', type: 'shelf' } },
      { id: 'c2', width: 600, height: 1850, root: { id: 'r2', type: 'shelf' } },
      { id: 'c3', width: 700, root: { id: 'r3', type: 'shelf' } },
    ],
  };

  const norm = M.normalizeProject(p);
  assert.equal(norm.columns[0].height, 950);
  assert.equal(norm.columns[1].height, 1850);
  assert.equal(norm.columns[2].height, undefined);
  assert.ok(norm.settings);
});

test('11. Stepped cutlist accounting separates unequal laterals and top caps into individual tabular rows', () => {
  const project = {
    settings: { ...DEFAULTS, overhang: 20, thickness: 18 },
    columns: [
      { id: 'c0', width: 500, height: 800, root: M.leaf('shelf') },
      { id: 'c1', width: 700, height: 1600, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  const cl = l.cutlist;

  // Price identity invariant
  assert.equal(cl.panelsTotal + cl.hardwareTotal, cl.total);
  assert.ok(cl.total > 0);

  // Check itemized cutlist rows for laterals
  // Height 840 (Left lateral exterior): qty 1
  const latExt840 = cl.rows.find((r) => r.name === 'Lateral exterior' && r.length === 840);
  assert.ok(latExt840, 'Must have a cutlist row for 840mm lateral exterior');
  assert.equal(latExt840.qty, 1);

  // Height 1640 (Right outer lateral exterior): qty 1
  const latExt1640 = cl.rows.find((r) => r.name === 'Lateral exterior' && r.length === 1640);
  assert.ok(latExt1640, 'Must have a cutlist row for 1640mm lateral exterior');
  assert.equal(latExt1640.qty, 1);

  // Height 1640 (Intermediate shared lateral interior): qty 1
  const latInt1640 = cl.rows.find((r) => r.name === 'Lateral interior' && r.length === 1640);
  assert.ok(latInt1640, 'Must have a cutlist row for 1640mm lateral interior');
  assert.equal(latInt1640.qty, 1);

  // Check itemized cutlist rows for top caps of different widths
  const cap500 = cl.rows.find((r) => r.name === 'Tapa superior' && r.length === 500);
  assert.ok(cap500, 'Must have top cap row for 500mm width');
  assert.equal(cap500.qty, 1);

  const cap700 = cl.rows.find((r) => r.name === 'Tapa superior' && r.length === 700);
  assert.ok(cap700, 'Must have top cap row for 700mm width');
  assert.equal(cap700.qty, 1);
});
