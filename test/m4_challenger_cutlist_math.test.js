// test/m4_challenger_cutlist_math.test.js
// EMPIRICAL CHALLENGER 1 (M4 Cutlist Math Challenger)
// Adversarial test suite challenging stepped cutlist math, lateral classification, woodworking dimensional invariants, and pricing identity.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, DEFAULTS, buildCutlist, orientationOf, cutlistCSV } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

// Rigorous Accounting Oracle
function assertAllCutlistInvariants(layout, testLabel = '') {
  const { cutlist } = layout;

  // Invariant 1: Grand Total Strict Identity
  assert.equal(
    cutlist.panelsTotal + cutlist.hardwareTotal,
    cutlist.total,
    `${testLabel}: Grand total identity violated: ${cutlist.panelsTotal} + ${cutlist.hardwareTotal} !== ${cutlist.total}`
  );

  // Invariant 2: Non-negative finite numbers
  assert.ok(Number.isFinite(cutlist.total) && cutlist.total >= 0, `${testLabel}: cutlist.total invalid: ${cutlist.total}`);
  assert.ok(Number.isFinite(cutlist.panelsTotal) && cutlist.panelsTotal >= 0, `${testLabel}: cutlist.panelsTotal invalid`);
  assert.ok(Number.isFinite(cutlist.hardwareTotal) && cutlist.hardwareTotal >= 0, `${testLabel}: cutlist.hardwareTotal invalid`);
  assert.ok(Number.isFinite(cutlist.area) && cutlist.area >= 0, `${testLabel}: cutlist.area invalid`);

  // Invariant 3: Panel Line-Item Summation Parity
  const sumPanels = cutlist.rows.reduce((acc, r) => acc + r.total, 0);
  assert.ok(
    Math.abs(cutlist.panelsTotal - sumPanels) < 1e-7,
    `${testLabel}: panelsTotal (${cutlist.panelsTotal}) !== sum of row totals (${sumPanels})`
  );

  // Invariant 4: Hardware Line-Item Summation Parity
  const sumHardware = cutlist.hardware.reduce((acc, h) => acc + h.total, 0);
  assert.ok(
    Math.abs(cutlist.hardwareTotal - sumHardware) < 1e-7,
    `${testLabel}: hardwareTotal (${cutlist.hardwareTotal}) !== sum of hardware totals (${sumHardware})`
  );

  // Invariant 5: Area Summation Parity
  const sumArea = cutlist.rows.reduce((acc, r) => acc + r.unitArea * r.qty, 0);
  assert.ok(
    Math.abs(cutlist.area - sumArea) < 1e-7,
    `${testLabel}: area (${cutlist.area}) !== sum of row areas (${sumArea})`
  );

  // Invariant 6: Panel Dimensional, Precision and Role Invariants
  const validRoles = [
    'back-panel',
    'door-front',
    'drawer-back',
    'drawer-bottom',
    'drawer-front',
    'drawer-side',
    'horizontal-deck',
    'vertical-side',
  ];
  const rolePrefixes = {
    'back-panel': 'B',
    'door-front': 'O',
    'drawer-back': 'D',
    'drawer-bottom': 'D',
    'drawer-front': 'D',
    'drawer-side': 'D',
    'horizontal-deck': 'H',
    'vertical-side': 'S',
  };

  assert.ok(cutlist.rows.length > 0, `${testLabel}: Cutlist contains no panel rows`);

  cutlist.rows.forEach((r, idx) => {
    // ID prefix matches canonical role
    assert.ok(validRoles.includes(r.role), `${testLabel}: Row ${idx} has invalid role: ${r.role}`);
    const expectedPrefix = rolePrefixes[r.role];
    assert.equal(r.id.charAt(0), expectedPrefix, `${testLabel}: Row ${idx} id ${r.id} prefix !== ${expectedPrefix}`);

    // Dimension bounds (mm)
    assert.ok(r.length >= 10, `${testLabel}: Row ${idx} length < 10mm: ${r.length}`);
    assert.ok(r.width >= 10, `${testLabel}: Row ${idx} width < 10mm: ${r.width}`);
    assert.ok(r.thickness >= 3, `${testLabel}: Row ${idx} thickness < 3mm: ${r.thickness}`);
    assert.ok(r.length >= r.width, `${testLabel}: Row ${idx} length (${r.length}) < width (${r.width})`);

    // Precision invariant: at most 1 decimal place
    assert.equal(
      Math.round(r.length * 10),
      r.length * 10,
      `${testLabel}: Row ${idx} (${r.name}) length precision exceeds 1 decimal place: ${r.length}`
    );
    assert.equal(
      Math.round(r.width * 10),
      r.width * 10,
      `${testLabel}: Row ${idx} (${r.name}) width precision exceeds 1 decimal place: ${r.width}`
    );
    assert.equal(
      Math.round(r.thickness * 10),
      r.thickness * 10,
      `${testLabel}: Row ${idx} (${r.name}) thickness precision exceeds 1 decimal place: ${r.thickness}`
    );

    // Quantity and pricing consistency
    assert.ok(Number.isInteger(r.qty) && r.qty >= 1, `${testLabel}: Row ${idx} qty must be positive integer`);
    assert.ok(r.unitPrice >= 0, `${testLabel}: Row ${idx} unitPrice negative`);
    assert.ok(Math.abs(r.total - r.unitPrice * r.qty) < 1e-5, `${testLabel}: Row ${idx} total !== unitPrice * qty`);
  });
}

// ============================================================================
// CHALLENGE 1: 2-Column Configurations (Ascending, Descending, Equal)
// ============================================================================

test('CHALLENGE 1.1: 2-Column Ascending Stepped Configuration', () => {
  const ov = 20;
  const project = {
    settings: { ...DEFAULTS, overhang: ov, thickness: 18, depth: 450, backThickness: 20 },
    columns: [
      { id: 'c0', width: 500, height: 800, root: M.leaf('shelf') },
      { id: 'c1', width: 700, height: 1600, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  assertAllCutlistInvariants(l, '2-Col Ascending');

  // Verify Backward Compatibility: total 3 pieces with name === 'Lateral'
  const latPieces = l.pieces.filter((p) => p.name === 'Lateral');
  assert.equal(latPieces.length, 3, 'Must have exactly 3 lateral pieces in 3D scene');

  // Exterior Laterals:
  // Left: H_0 + 2ov = 800 + 40 = 840
  // Right: H_1 + 2ov = 1600 + 40 = 1640
  const extRows = l.cutlist.rows.filter((r) => r.name === 'Lateral exterior');
  assert.equal(extRows.length, 2, 'Must have 2 distinct exterior lateral rows');
  const leftExt = extRows.find((r) => r.length === 840);
  const rightExt = extRows.find((r) => r.length === 1640);
  assert.ok(leftExt && leftExt.qty === 1 && leftExt.role === 'vertical-side' && leftExt.id.startsWith('S'));
  assert.ok(rightExt && rightExt.qty === 1 && rightExt.role === 'vertical-side' && rightExt.id.startsWith('S'));

  // Interior Lateral:
  // Shared: max(800, 1600) + 40 = 1640
  const intRows = l.cutlist.rows.filter((r) => r.name === 'Lateral interior');
  assert.equal(intRows.length, 1, 'Must have exactly 1 interior lateral row');
  const shared = intRows.find((r) => r.length === 1640);
  assert.ok(shared && shared.qty === 1 && shared.role === 'vertical-side' && shared.id.startsWith('S'));

  // Top Caps: distinct widths (500mm, 700mm)
  const topCaps = l.cutlist.rows.filter((r) => r.name === 'Tapa superior');
  assert.equal(topCaps.length, 2);
  assert.ok(topCaps.find((r) => r.length === 500 && r.qty === 1));
  assert.ok(topCaps.find((r) => r.length === 700 && r.qty === 1));
});

test('CHALLENGE 1.2: 2-Column Descending Stepped Configuration', () => {
  const ov = 25;
  const project = {
    settings: { ...DEFAULTS, overhang: ov, thickness: 18, depth: 500 },
    columns: [
      { id: 'c0', width: 600, height: 1900, root: M.leaf('shelf') },
      { id: 'c1', width: 600, height: 950, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  assertAllCutlistInvariants(l, '2-Col Descending');

  // Left Exterior: 1900 + 50 = 1950
  // Right Exterior: 950 + 50 = 1000
  // Shared Interior: max(1900, 950) + 50 = 1950
  const extRows = l.cutlist.rows.filter((r) => r.name === 'Lateral exterior');
  const intRows = l.cutlist.rows.filter((r) => r.name === 'Lateral interior');
  assert.equal(extRows.find((r) => r.length === 1950).qty, 1);
  assert.equal(extRows.find((r) => r.length === 1000).qty, 1);
  assert.equal(intRows.find((r) => r.length === 1950).qty, 1);

  // Identical widths (600mm) top caps merge into qty 2
  const topCaps = l.cutlist.rows.filter((r) => r.name === 'Tapa superior');
  assert.equal(topCaps.length, 1);
  assert.equal(topCaps[0].qty, 2);
});

test('CHALLENGE 1.3: 2-Column Equal Height Furniture Grouping', () => {
  const ov = 20;
  const project = {
    settings: { ...DEFAULTS, overhang: ov, thickness: 18, depth: 450 },
    columns: [
      { id: 'c0', width: 500, height: 1200, root: M.leaf('shelf') },
      { id: 'c1', width: 500, height: 1200, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  assertAllCutlistInvariants(l, '2-Col Equal Height');

  // Exterior laterals both have height 1240 -> group to qty: 2 of Lateral exterior
  const extRows = l.cutlist.rows.filter((r) => r.name === 'Lateral exterior');
  assert.equal(extRows.length, 1);
  assert.equal(extRows[0].length, 1240);
  assert.equal(extRows[0].qty, 2);

  // Interior lateral has height 1240 -> qty: 1 of Lateral interior
  const intRows = l.cutlist.rows.filter((r) => r.name === 'Lateral interior');
  assert.equal(intRows.length, 1);
  assert.equal(intRows[0].length, 1240);
  assert.equal(intRows[0].qty, 1);

  // Total laterals count = 2 + 1 = 3
  assert.equal(extRows[0].qty + intRows[0].qty, 3);
});

// ============================================================================
// CHALLENGE 2: 3-Column Configurations (Pyramid, Inverted Valley, Staircase)
// ============================================================================

test('CHALLENGE 2.1: 3-Column Center Peak Pyramid (1000, 2000, 1400mm)', () => {
  const ov = 20;
  const project = {
    settings: { ...DEFAULTS, overhang: ov, thickness: 18, depth: 450 },
    columns: [
      { id: 'c0', width: 500, height: 1000, root: M.leaf('shelf') },
      { id: 'c1', width: 600, height: 2000, root: M.leaf('shelf') },
      { id: 'c2', width: 700, height: 1400, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  assertAllCutlistInvariants(l, '3-Col Pyramid');

  // Left Exterior: 1000 + 40 = 1040
  // Right Exterior: 1400 + 40 = 1440
  const extRows = l.cutlist.rows.filter((r) => r.name === 'Lateral exterior');
  assert.equal(extRows.length, 2);
  assert.equal(extRows.find((r) => r.length === 1040).qty, 1);
  assert.equal(extRows.find((r) => r.length === 1440).qty, 1);

  // Shared 1: max(1000, 2000) + 40 = 2040
  // Shared 2: max(2000, 1400) + 40 = 2040
  // Under classification, both 2040mm interior laterals group into qty 2 of Lateral interior!
  const intRows = l.cutlist.rows.filter((r) => r.name === 'Lateral interior');
  assert.equal(intRows.length, 1);
  assert.equal(intRows[0].length, 2040);
  assert.equal(intRows[0].qty, 2);
});

test('CHALLENGE 2.2: 3-Column Inverted Valley Discriminator (1800, 900, 1800mm)', () => {
  const ov = 20;
  const project = {
    settings: { ...DEFAULTS, overhang: ov, thickness: 18, depth: 450 },
    columns: [
      { id: 'c0', width: 600, height: 1800, root: M.leaf('shelf') },
      { id: 'c1', width: 500, height: 900, root: M.leaf('shelf') },
      { id: 'c2', width: 600, height: 1800, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  assertAllCutlistInvariants(l, '3-Col Inverted Valley');

  // All 4 laterals have length 1840mm!
  // Exterior: Left (1800+40) and Right (1800+40) -> qty 2 Lateral exterior
  // Interior: Shared 1 (max(1800,900)+40) and Shared 2 (max(900,1800)+40) -> qty 2 Lateral interior
  const extRows = l.cutlist.rows.filter((r) => r.name === 'Lateral exterior');
  const intRows = l.cutlist.rows.filter((r) => r.name === 'Lateral interior');

  assert.equal(extRows.length, 1, 'Exterior laterals must form 1 row');
  assert.equal(extRows[0].length, 1840);
  assert.equal(extRows[0].qty, 2, 'Must have qty 2 exterior laterals');

  assert.equal(intRows.length, 1, 'Interior laterals must form 1 row');
  assert.equal(intRows[0].length, 1840);
  assert.equal(intRows[0].qty, 2, 'Must have qty 2 interior laterals');

  // Total laterals count = 4
  assert.equal(extRows[0].qty + intRows[0].qty, 4);
});

// ============================================================================
// CHALLENGE 3: 5-Column Configurations (Staircase & Complex Topologies)
// ============================================================================

test('CHALLENGE 3.1: 5-Column Continuous Ascending Staircase', () => {
  const heights = [700, 1050, 1400, 1750, 2100];
  const widths = [400, 500, 600, 700, 800];
  const ov = 20;

  const project = {
    settings: { ...DEFAULTS, overhang: ov, thickness: 18, depth: 450 },
    columns: heights.map((h, i) => ({
      id: `col_${i}`,
      width: widths[i],
      height: h,
      root: M.leaf('shelf'),
    })),
  };

  const l = computeLayout(project);
  assertAllCutlistInvariants(l, '5-Col Staircase');

  // 6 total laterals: 2 exterior, 4 interior
  const extRows = l.cutlist.rows.filter((r) => r.name === 'Lateral exterior');
  const intRows = l.cutlist.rows.filter((r) => r.name === 'Lateral interior');

  assert.equal(extRows.find((r) => r.length === 740).qty, 1);
  assert.equal(extRows.find((r) => r.length === 2140).qty, 1);

  assert.equal(intRows.find((r) => r.length === 1090).qty, 1);
  assert.equal(intRows.find((r) => r.length === 1440).qty, 1);
  assert.equal(intRows.find((r) => r.length === 1790).qty, 1);
  assert.equal(intRows.find((r) => r.length === 2140).qty, 1);

  // Top caps: 5 distinct widths
  const topCaps = l.cutlist.rows.filter((r) => r.name === 'Tapa superior');
  assert.equal(topCaps.length, 5);
});

test('CHALLENGE 3.2: 5-Column Alternating M-Shape Topography (1200, 2000, 1500, 2200, 1100mm)', () => {
  const heights = [1200, 2000, 1500, 2200, 1100];
  const ov = 15;

  const project = {
    settings: { ...DEFAULTS, overhang: ov, thickness: 18, depth: 500 },
    columns: heights.map((h, i) => ({
      id: `col_${i}`,
      width: 500,
      height: h,
      root: M.leaf('shelf'),
    })),
  };

  const l = computeLayout(project);
  assertAllCutlistInvariants(l, '5-Col M-Shape');

  // Left Ext: 1200 + 30 = 1230
  // Right Ext: 1100 + 30 = 1130
  const extRows = l.cutlist.rows.filter((r) => r.name === 'Lateral exterior');
  assert.equal(extRows.find((r) => r.length === 1230).qty, 1);
  assert.equal(extRows.find((r) => r.length === 1130).qty, 1);

  // Shared 1: max(1200, 2000) + 30 = 2030
  // Shared 2: max(2000, 1500) + 30 = 2030 -> Shared 1 and 2 group into qty 2 of 2030mm!
  // Shared 3: max(1500, 2200) + 30 = 2230
  // Shared 4: max(2200, 1100) + 30 = 2230 -> Shared 3 and 4 group into qty 2 of 2230mm!
  const intRows = l.cutlist.rows.filter((r) => r.name === 'Lateral interior');
  assert.equal(intRows.find((r) => r.length === 2030).qty, 2);
  assert.equal(intRows.find((r) => r.length === 2230).qty, 2);

  // Identical widths (500mm across 5 columns) -> 1 row of Tapa superior with qty 5!
  const topCaps = l.cutlist.rows.filter((r) => r.name === 'Tapa superior');
  assert.equal(topCaps.length, 1);
  assert.equal(topCaps[0].qty, 5);
});

// ============================================================================
// CHALLENGE 4: Single Column Extreme Boundary (N = 1)
// ============================================================================

test('CHALLENGE 4.1: Single Column Edge Case (N = 1)', () => {
  const project = {
    settings: { ...DEFAULTS, overhang: 20 },
    columns: [{ id: 'c0', width: 600, height: 1500, root: M.leaf('shelf') }],
  };

  const l = computeLayout(project);
  assertAllCutlistInvariants(l, 'Single Column N=1');

  // In 1-column furniture, there are exactly 2 exterior laterals and 0 interior laterals
  const extRows = l.cutlist.rows.filter((r) => r.name === 'Lateral exterior');
  const intRows = l.cutlist.rows.filter((r) => r.name === 'Lateral interior');

  assert.equal(extRows.length, 1);
  assert.equal(extRows[0].length, 1540);
  assert.equal(extRows[0].qty, 2);
  assert.equal(intRows.length, 0);

  // Top cap qty 1
  const topCaps = l.cutlist.rows.filter((r) => r.name === 'Tapa superior');
  assert.equal(topCaps.length, 1);
  assert.equal(topCaps[0].qty, 1);
});

// ============================================================================
// CHALLENGE 5: Overhang and Thickness Boundary Stress Testing
// ============================================================================

test('CHALLENGE 5.1: Zero Overhang (overhang = 0)', () => {
  const project = {
    settings: { ...DEFAULTS, overhang: 0, thickness: 18 },
    columns: [
      { id: 'c0', width: 500, height: 1000, root: M.leaf('shelf') },
      { id: 'c1', width: 500, height: 1500, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  assertAllCutlistInvariants(l, 'Zero Overhang');

  const extRows = l.cutlist.rows.filter((r) => r.name === 'Lateral exterior');
  const intRows = l.cutlist.rows.filter((r) => r.name === 'Lateral interior');

  assert.equal(extRows.find((r) => r.length === 1000).qty, 1);
  assert.equal(extRows.find((r) => r.length === 1500).qty, 1);
  assert.equal(intRows.find((r) => r.length === 1500).qty, 1);
});

test('CHALLENGE 5.2: Non-standard Panel Thicknesses (t = 12mm, 25mm)', () => {
  for (const t of [12, 25]) {
    const project = {
      settings: { ...DEFAULTS, thickness: t, overhang: 15 },
      columns: [
        { id: 'c0', width: 600, height: 900, root: M.leaf('shelf') },
        { id: 'c1', width: 600, height: 1400, root: M.leaf('shelf') },
      ],
    };

    const l = computeLayout(project);
    assertAllCutlistInvariants(l, `Thickness t=${t}`);

    const extRows = l.cutlist.rows.filter((r) => r.name === 'Lateral exterior');
    extRows.forEach((r) => assert.equal(r.thickness, t));
  }
});
