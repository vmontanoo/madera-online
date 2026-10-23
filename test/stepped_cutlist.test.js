// test/stepped_cutlist.test.js
// Automated Test Suite for Milestone 4 (R4): Stepped Furniture Cutlist, Panel Classification & Pricing Invariants
// Covers:
// 1. Exterior laterals classification (cols 0 and N) with heights H_0 + 2ov and H_{N-1} + 2ov labeled 'Lateral exterior'
// 2. Intermediate shared laterals classification with heights max(H_{i-1}, H_i) + 2ov labeled 'Lateral interior'
// 3. Independent top caps itemized per column with dimensions (W_i, D)
// 4. Staggered furniture topologies across 2, 3, and 5 columns
// 5. Mathematical pricing consistency: panelsTotal + hardwareTotal === total
// 6. Millimetric woodworking dimension invariants and tabular CSV formatting

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, DEFAULTS, buildCutlist, orientationOf, cutlistCSV } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

// Helper Oracle: Asserts all cutlist accounting and woodworking invariants
function assertCutlistAccountingInvariants(layout, label = '') {
  const { cutlist, settings } = layout;

  // 1. Strict Arithmetic Price Identity Invariant
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

  // 3. Panel Invariants (Millimeters, L >= W, T >= 3mm, <= 1 decimal precision, canonical role)
  assert.ok(cutlist.rows.length > 0, `${label}: cutlist must contain panel rows`);
  cutlist.rows.forEach((r, idx) => {
    assert.ok(r.id && typeof r.id === 'string', `${label}: Row ${idx} invalid id`);
    assert.ok(r.name && typeof r.name === 'string', `${label}: Row ${idx} invalid name`);
    assert.ok(r.role && typeof r.role === 'string', `${label}: Row ${idx} invalid role`);

    // Length, width, thickness in millimeters
    assert.ok(r.length >= 10, `${label}: Row ${idx} (${r.name}) length must be >= 10mm (got ${r.length})`);
    assert.ok(r.width >= 10, `${label}: Row ${idx} (${r.name}) width must be >= 10mm (got ${r.width})`);
    assert.ok(r.thickness >= 3, `${label}: Row ${idx} (${r.name}) thickness must be >= 3mm (got ${r.thickness})`);
    assert.ok(r.length >= r.width, `${label}: Row ${idx} (${r.name}) L (${r.length}) must be >= W (${r.width})`);
    assert.ok(r.thickness > 1.0, `${label}: Row ${idx} thickness looks like meters: ${r.thickness}`);

    // Precision invariant: at most 1 decimal place
    assert.equal(
      Math.round(r.length * 10),
      r.length * 10,
      `${label}: Row ${idx} (${r.name}) length precision exceeds 1 decimal place: ${r.length}`
    );
    assert.equal(
      Math.round(r.width * 10),
      r.width * 10,
      `${label}: Row ${idx} (${r.name}) width precision exceeds 1 decimal place: ${r.width}`
    );

    // Pricing invariants
    assert.ok(r.qty >= 1, `${label}: Row ${idx} qty must be >= 1`);
    assert.ok(r.unitPrice >= 0, `${label}: Row ${idx} unitPrice must be >= 0`);
    assert.ok(Math.abs(r.total - r.unitPrice * r.qty) < 1e-5, `${label}: Row ${idx} total mismatch`);
  });
}

// ============================================================================
// SUITE 1: 2-COLUMN STEPPED FURNITURE (Ascending & Descending)
// ============================================================================

test('M4.1.1: 2-Column Ascending Stepped (800mm, 1600mm) Lateral Classification and Top Caps', () => {
  const ov = 20;
  const t = 18;
  const project = {
    settings: { ...DEFAULTS, overhang: ov, thickness: t, depth: 450, backThickness: 20 },
    columns: [
      { id: 'c0', width: 500, height: 800, root: M.leaf('shelf') },
      { id: 'c1', width: 700, height: 1600, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  const cl = l.cutlist;
  assertCutlistAccountingInvariants(l, '2-Col Ascending');

  // Total width: 18 + 500 + 18 + 700 + 18 = 1254mm
  assert.equal(l.totalW, 1254);
  assert.equal(l.maxH, 1600);

  // Exterior Laterals:
  // Left: Col 0 -> H_0 + 2ov = 800 + 40 = 840mm
  // Right: Col 1 -> H_1 + 2ov = 1600 + 40 = 1640mm
  const extLaterals = cl.rows.filter((r) => r.name === 'Lateral exterior' || (r.name === 'Lateral' && r.label === 'Lateral exterior'));
  assert.ok(extLaterals.length > 0, 'Must have exterior lateral rows');
  
  const leftExt = extLaterals.find((r) => r.length === 840);
  assert.ok(leftExt, 'Left exterior lateral at 840mm must exist');
  assert.equal(leftExt.qty, 1);
  assert.equal(leftExt.role, 'vertical-side');
  assert.equal(leftExt.id.charAt(0), 'S');

  const rightExt = extLaterals.find((r) => r.length === 1640);
  assert.ok(rightExt, 'Right exterior lateral at 1640mm must exist');
  assert.equal(rightExt.qty, 1);
  assert.equal(rightExt.role, 'vertical-side');

  // Intermediate Laterals:
  // Shared between col 0 (800) and col 1 (1600): max(800, 1600) + 2ov = 1640mm
  const intLaterals = cl.rows.filter((r) => r.name === 'Lateral interior' || (r.name === 'Lateral' && r.label === 'Lateral interior'));
  assert.ok(intLaterals.length > 0, 'Must have interior lateral rows');

  const sharedInt = intLaterals.find((r) => r.length === 1640);
  assert.ok(sharedInt, 'Intermediate interior lateral at 1640mm must exist');
  assert.equal(sharedInt.qty, 1);
  assert.equal(sharedInt.role, 'vertical-side');

  // Independent Top Caps:
  // Col 0: Width 500mm, Depth 450 - 20 = 430mm
  // Col 1: Width 700mm, Depth 450 - 20 = 430mm
  const topCaps = cl.rows.filter((r) => r.name === 'Tapa superior');
  assert.equal(topCaps.length, 2, 'Must have 2 distinct top cap rows for distinct widths');
  
  const cap500 = topCaps.find((r) => r.length === 500 || (r.length === 500 && r.width === 430));
  assert.ok(cap500, 'Top cap for 500mm width must exist');
  assert.equal(cap500.qty, 1);
  assert.equal(cap500.role, 'horizontal-deck');
  assert.equal(cap500.id.charAt(0), 'H');

  const cap700 = topCaps.find((r) => r.length === 700 || (r.length === 700 && r.width === 430));
  assert.ok(cap700, 'Top cap for 700mm width must exist');
  assert.equal(cap700.qty, 1);
});

test('M4.1.2: 2-Column Descending Stepped (1900mm, 950mm) Lateral Classification and Top Caps', () => {
  const ov = 25;
  const t = 18;
  const project = {
    settings: { ...DEFAULTS, overhang: ov, thickness: t, depth: 500 },
    columns: [
      { id: 'c0', width: 600, height: 1900, root: M.leaf('shelf') },
      { id: 'c1', width: 600, height: 950, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  const cl = l.cutlist;
  assertCutlistAccountingInvariants(l, '2-Col Descending');

  // Left Exterior: 1900 + 50 = 1950mm
  // Shared Interior: max(1900, 950) + 50 = 1950mm
  // Right Exterior: 950 + 50 = 1000mm
  const extRows = cl.rows.filter((r) => r.name === 'Lateral exterior' || (r.name === 'Lateral' && r.label === 'Lateral exterior'));
  const intRows = cl.rows.filter((r) => r.name === 'Lateral interior' || (r.name === 'Lateral' && r.label === 'Lateral interior'));

  assert.equal(extRows.find((r) => r.length === 1950).qty, 1);
  assert.equal(extRows.find((r) => r.length === 1000).qty, 1);
  assert.equal(intRows.find((r) => r.length === 1950).qty, 1);

  // Equal width top caps (600mm) group into qty 2
  const topCaps = cl.rows.filter((r) => r.name === 'Tapa superior');
  const cap600 = topCaps.find((r) => r.length === 600);
  assert.ok(cap600);
  assert.equal(cap600.qty, 2, 'Top caps with identical dimensions group into qty 2');
});

// ============================================================================
// SUITE 2: 3-COLUMN STEPPED FURNITURE (Pyramid Peak & Inverted Valley)
// ============================================================================

test('M4.2.1: 3-Column Center Peak Pyramid (1000mm, 2000mm, 1400mm) Classification', () => {
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
  const cl = l.cutlist;
  assertCutlistAccountingInvariants(l, '3-Col Center Peak');

  // Left Exterior: 1000 + 40 = 1040mm
  // Shared 1 Interior: max(1000, 2000) + 40 = 2040mm
  // Shared 2 Interior: max(2000, 1400) + 40 = 2040mm
  // Right Exterior: 1400 + 40 = 1440mm
  const extRows = cl.rows.filter((r) => r.name === 'Lateral exterior' || (r.name === 'Lateral' && r.label === 'Lateral exterior'));
  const intRows = cl.rows.filter((r) => r.name === 'Lateral interior' || (r.name === 'Lateral' && r.label === 'Lateral interior'));

  assert.equal(extRows.find((r) => r.length === 1040).qty, 1);
  assert.equal(extRows.find((r) => r.length === 1440).qty, 1);
  // Both intermediate laterals rise to 2040mm: under classification they group to qty 2 of Lateral interior
  const int2040 = intRows.find((r) => r.length === 2040);
  assert.ok(int2040);
  assert.equal(int2040.qty, 2, 'Two shared intermediate laterals of 2040mm group to qty 2');

  // 3 distinct top caps (500, 600, 700mm)
  const topCaps = cl.rows.filter((r) => r.name === 'Tapa superior');
  assert.equal(topCaps.length, 3);
  assert.ok(topCaps.some((r) => r.length === 500 && r.qty === 1));
  assert.ok(topCaps.some((r) => r.length === 600 && r.qty === 1));
  assert.ok(topCaps.some((r) => r.length === 700 && r.qty === 1));
});

test('M4.2.2: 3-Column Inverted Valley (1800mm, 900mm, 1800mm) Discriminator Test', () => {
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
  const cl = l.cutlist;
  assertCutlistAccountingInvariants(l, '3-Col Inverted Valley');

  // Left Exterior: 1800 + 40 = 1840mm
  // Shared 1 Interior: max(1800, 900) + 40 = 1840mm
  // Shared 2 Interior: max(900, 1800) + 40 = 1840mm
  // Right Exterior: 1800 + 40 = 1840mm
  // All 4 laterals have length 1840mm, but classification partitions them into 2 Exterior + 2 Interior!
  const extRows = cl.rows.filter((r) => r.name === 'Lateral exterior' || (r.name === 'Lateral' && r.label === 'Lateral exterior'));
  const intRows = cl.rows.filter((r) => r.name === 'Lateral interior' || (r.name === 'Lateral' && r.label === 'Lateral interior'));

  const ext1840 = extRows.find((r) => r.length === 1840);
  const int1840 = intRows.find((r) => r.length === 1840);

  assert.ok(ext1840, 'Exterior 1840mm laterals row must exist');
  assert.ok(int1840, 'Interior 1840mm laterals row must exist');
  assert.equal(ext1840.qty, 2, 'Must have exactly 2 exterior laterals');
  assert.equal(int1840.qty, 2, 'Must have exactly 2 interior laterals');
});

// ============================================================================
// SUITE 3: 5-COLUMN STEPPED FURNITURE (Staircase & Complex Topologies)
// ============================================================================

test('M4.3.1: 5-Column Continuous Ascending Staircase (700, 1050, 1400, 1750, 2100mm)', () => {
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
  const cl = l.cutlist;
  assertCutlistAccountingInvariants(l, '5-Col Ascending Staircase');

  // Left Exterior: 700 + 40 = 740mm
  // Shared 1 Interior: max(700, 1050) + 40 = 1090mm
  // Shared 2 Interior: max(1050, 1400) + 40 = 1440mm
  // Shared 3 Interior: max(1400, 1750) + 40 = 1790mm
  // Shared 4 Interior: max(1750, 2100) + 40 = 2140mm
  // Right Exterior: 2100 + 40 = 2140mm
  const extRows = cl.rows.filter((r) => r.name === 'Lateral exterior' || (r.name === 'Lateral' && r.label === 'Lateral exterior'));
  const intRows = cl.rows.filter((r) => r.name === 'Lateral interior' || (r.name === 'Lateral' && r.label === 'Lateral interior'));

  assert.equal(extRows.find((r) => r.length === 740).qty, 1);
  assert.equal(extRows.find((r) => r.length === 2140).qty, 1);

  assert.equal(intRows.find((r) => r.length === 1090).qty, 1);
  assert.equal(intRows.find((r) => r.length === 1440).qty, 1);
  assert.equal(intRows.find((r) => r.length === 1790).qty, 1);
  assert.equal(intRows.find((r) => r.length === 2140).qty, 1);

  // Top caps: 5 distinct widths (400, 500, 600, 700, 800)
  const topCaps = cl.rows.filter((r) => r.name === 'Tapa superior');
  assert.equal(topCaps.length, 5);
  widths.forEach((w) => {
    assert.ok(topCaps.some((r) => (r.length === w || r.width === w) && r.qty === 1));
  });
});

test('M4.3.2: 5-Column Complex Multi-Zone with Mixed Drawers, Doors, Rails and Gas Struts', () => {
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1400,
      overhang: 20,
      thickness: 18,
      depth: 550,
      slidingTrackPrice: 28,
      bifoldHingePrice: 4,
      bifoldGuidePrice: 8,
      gasStrutPrice: 6,
    },
    columns: [
      { id: 'c0', width: 500, height: 1600, root: M.leaf('drawer', { count: 3 }) },
      { id: 'c1', width: 600, height: 900, root: M.leaf('shelf') },
      { id: 'c2', width: 800, height: 2200, root: M.leaf('shelf', { front: 'doors' }) },
      { id: 'c3', width: 700, height: 1100, root: M.leaf('rail') },
      { id: 'c4', width: 650, height: 1800, root: M.leaf('shelf', { front: 'lift-up' }) },
    ],
  };

  const l = computeLayout(project);
  const cl = l.cutlist;
  assertCutlistAccountingInvariants(l, '5-Col Multi-Zone Mixed');

  // Verify full hardware accounting:
  // Col 0: 3 drawers -> 3 slides
  assert.equal(cl.hardware.find((h) => h.name === 'Corredera (par)')?.qty, 3);
  // Col 2: double doors (ch=2200-36=2164 > 1800) -> 2 leaves * 4 hinges = 8 hinges
  // Col 4: lift-up door -> 2 hinges + 2 gas struts
  // Total hinges = 8 + 2 = 10
  assert.equal(cl.hardware.find((h) => h.name === 'Bisagra')?.qty, 10);
  assert.equal(cl.hardware.find((h) => h.name.includes('gas'))?.qty, 2);
  // Col 3: rail (700mm = 0.7m + 2 brackets)
  assert.equal(cl.hardware.find((h) => h.name.includes('perchero'))?.qty, 0.7);
  assert.equal(cl.hardware.find((h) => h.name.includes('Soporte'))?.qty, 2);

  // Exterior Laterals:
  // Left: 1600 + 40 = 1640mm
  // Right: 1800 + 40 = 1840mm
  const extRows = cl.rows.filter((r) => r.name === 'Lateral exterior' || (r.name === 'Lateral' && r.label === 'Lateral exterior'));
  assert.equal(extRows.find((r) => r.length === 1640).qty, 1);
  assert.equal(extRows.find((r) => r.length === 1840).qty, 1);

  // Intermediate Laterals:
  // Shared 1: max(1600, 900) + 40 = 1640mm
  // Shared 2: max(900, 2200) + 40 = 2240mm
  // Shared 3: max(2200, 1100) + 40 = 2240mm
  // Shared 4: max(1100, 1800) + 40 = 1840mm
  const intRows = cl.rows.filter((r) => r.name === 'Lateral interior' || (r.name === 'Lateral' && r.label === 'Lateral interior'));
  assert.equal(intRows.find((r) => r.length === 1640).qty, 1);
  assert.equal(intRows.find((r) => r.length === 2240).qty, 2);
  assert.equal(intRows.find((r) => r.length === 1840).qty, 1);

  // Grand Total Equality
  assert.equal(cl.panelsTotal + cl.hardwareTotal, cl.total);
  assert.ok(cl.total > 0);
});

// ============================================================================
// SUITE 4: CUSTOM PRICING RATES & CSV SERIALIZATION
// ============================================================================

test('M4.4.1: Custom Fractional Price Rates Preserve Strict Sum Identity', () => {
  const project = {
    settings: {
      ...DEFAULTS,
      priceCarcass: 42.75,
      priceFront: 77.35,
      priceBack: 21.40,
      priceDrawer: 33.15,
      slidePrice: 14.50,
      hingePrice: 2.75,
      priceRail: 6.90,
      priceRailBracket: 1.85,
    },
    columns: [
      { id: 'c0', width: 500, height: 900, root: M.leaf('shelf') },
      { id: 'c1', width: 600, height: 1700, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  assertCutlistAccountingInvariants(l, 'Custom Rates');
});

test('M4.4.2: cutlistCSV outputs Tabular Rows with Lateral Exterior and Interior Labels', () => {
  const project = {
    settings: { ...DEFAULTS, overhang: 20 },
    columns: [
      { id: 'c0', width: 500, height: 800, root: M.leaf('shelf') },
      { id: 'c1', width: 700, height: 1600, root: M.leaf('shelf') },
    ],
  };

  const l = computeLayout(project);
  const csv = cutlistCSV(l.cutlist, '$');

  assert.ok(typeof csv === 'string');
  assert.ok(csv.includes('Pieza') && csv.includes('Total'));
  assert.ok(csv.includes('840') && csv.includes('1640'));
  assert.ok(csv.includes(l.cutlist.total.toFixed(2)));
});
