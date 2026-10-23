import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, DEFAULTS, buildCutlist, orientationOf, cutlistCSV } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

// ============================================================================
// EMPIRICAL STRESS HARNESS: Cutlist Accounting, Math Invariants & Pricing Accuracy
// Milestone M3 Adversarial Challenge Suite
// ============================================================================

// Helper: Validate all cutlist accounting invariants for a given layout
function assertCutlistInvariants(layout, label = '') {
  const { cutlist, settings } = layout;

  // 1. Strict Price Identity Invariant
  // In IEEE-754 arithmetic, cutlist.total was computed as panelsTotal + hardwareTotal
  assert.equal(
    cutlist.panelsTotal + cutlist.hardwareTotal,
    cutlist.total,
    `${label}: Identity violated: panelsTotal (${cutlist.panelsTotal}) + hardwareTotal (${cutlist.hardwareTotal}) !== total (${cutlist.total})`
  );

  // Assert cutlist totals are finite, non-negative, and not NaN
  assert.ok(!Number.isNaN(cutlist.total), `${label}: cutlist.total is NaN`);
  assert.ok(Number.isFinite(cutlist.total), `${label}: cutlist.total is not finite`);
  assert.ok(cutlist.total >= 0, `${label}: cutlist.total is negative: ${cutlist.total}`);

  assert.ok(!Number.isNaN(cutlist.panelsTotal), `${label}: cutlist.panelsTotal is NaN`);
  assert.ok(Number.isFinite(cutlist.panelsTotal), `${label}: cutlist.panelsTotal is not finite`);
  assert.ok(cutlist.panelsTotal >= 0, `${label}: cutlist.panelsTotal is negative: ${cutlist.panelsTotal}`);

  assert.ok(!Number.isNaN(cutlist.hardwareTotal), `${label}: cutlist.hardwareTotal is NaN`);
  assert.ok(Number.isFinite(cutlist.hardwareTotal), `${label}: cutlist.hardwareTotal is not finite`);
  assert.ok(cutlist.hardwareTotal >= 0, `${label}: cutlist.hardwareTotal is negative: ${cutlist.hardwareTotal}`);

  assert.ok(!Number.isNaN(cutlist.area), `${label}: cutlist.area is NaN`);
  assert.ok(Number.isFinite(cutlist.area), `${label}: cutlist.area is not finite`);
  assert.ok(cutlist.area >= 0, `${label}: cutlist.area is negative: ${cutlist.area}`);

  // 2. Sum of rows matches panelsTotal
  const sumPanels = cutlist.rows.reduce((acc, r) => acc + r.total, 0);
  assert.ok(
    Math.abs(cutlist.panelsTotal - sumPanels) < 1e-9,
    `${label}: cutlist.panelsTotal (${cutlist.panelsTotal}) does not match sum of row totals (${sumPanels})`
  );

  // 3. Sum of hardware items matches hardwareTotal
  const sumHardware = cutlist.hardware.reduce((acc, h) => acc + h.total, 0);
  assert.ok(
    Math.abs(cutlist.hardwareTotal - sumHardware) < 1e-9,
    `${label}: cutlist.hardwareTotal (${cutlist.hardwareTotal}) does not match sum of hardware totals (${sumHardware})`
  );

  // 4. Panel Invariants (mm units, L >= W, T >= 3mm, integer or 1 decimal place, never meters)
  cutlist.rows.forEach((r, idx) => {
    // Defined and not NaN
    assert.ok(r.id && typeof r.id === 'string', `${label}: Row ${idx} id missing or not string`);
    assert.ok(r.name && typeof r.name === 'string', `${label}: Row ${idx} name missing`);
    assert.ok(r.role && typeof r.role === 'string', `${label}: Row ${idx} role missing`);
    assert.ok(r.orientation && typeof r.orientation === 'string', `${label}: Row ${idx} orientation missing`);

    // Dimensions
    assert.ok(!Number.isNaN(r.length) && Number.isFinite(r.length), `${label}: Row ${idx} length is NaN/infinite`);
    assert.ok(!Number.isNaN(r.width) && Number.isFinite(r.width), `${label}: Row ${idx} width is NaN/infinite`);
    assert.ok(!Number.isNaN(r.thickness) && Number.isFinite(r.thickness), `${label}: Row ${idx} thickness is NaN/infinite`);

    // Positive mm units
    assert.ok(r.length > 0, `${label}: Row ${idx} (${r.name}) length must be > 0, got ${r.length}`);
    assert.ok(r.width > 0, `${label}: Row ${idx} (${r.name}) width must be > 0, got ${r.width}`);
    assert.ok(r.thickness >= 3, `${label}: Row ${idx} (${r.name}) thickness must be >= 3mm, got ${r.thickness}`);

    // Woodworking invariant: L >= W
    assert.ok(
      r.length >= r.width,
      `${label}: Woodworking invariant violated for row ${idx} (${r.name}): length ${r.length} < width ${r.width}`
    );

    // Millimeter scale check: never in fractional meters (e.g. 0.018m or 0.65m)
    assert.ok(
      r.length >= 10,
      `${label}: Row ${idx} (${r.name}) length appears to be in meters (< 10mm): ${r.length}`
    );
    assert.ok(
      r.width >= 10,
      `${label}: Row ${idx} (${r.name}) width appears to be in meters (< 10mm): ${r.width}`
    );
    assert.ok(
      r.thickness > 1.0,
      `${label}: Row ${idx} (${r.name}) thickness appears to be in meters (< 1.0mm): ${r.thickness}`
    );

    // Precision check: integer or at most 1 decimal place
    assert.equal(
      Math.round(r.length * 10),
      r.length * 10,
      `${label}: Row ${idx} (${r.name}) length exceeds 1 decimal place: ${r.length}`
    );
    assert.equal(
      Math.round(r.width * 10),
      r.width * 10,
      `${label}: Row ${idx} (${r.name}) width exceeds 1 decimal place: ${r.width}`
    );
    assert.equal(
      Math.round(r.thickness * 10),
      r.thickness * 10,
      `${label}: Row ${idx} (${r.name}) thickness exceeds 1 decimal place: ${r.thickness}`
    );

    // Quantities and pricing
    assert.ok(Number.isInteger(r.qty) && r.qty >= 1, `${label}: Row ${idx} qty must be integer >= 1, got ${r.qty}`);
    assert.ok(!Number.isNaN(r.unitPrice) && r.unitPrice >= 0, `${label}: Row ${idx} unitPrice is NaN or negative`);
    assert.ok(!Number.isNaN(r.total) && r.total >= 0, `${label}: Row ${idx} total is NaN or negative`);
    assert.ok(
      Math.abs(r.total - r.unitPrice * r.qty) < 1e-4,
      `${label}: Row ${idx} line total (${r.total}) !== unitPrice * qty (${r.unitPrice * r.qty})`
    );
  });

  // 5. Hardware Invariants
  cutlist.hardware.forEach((h, idx) => {
    assert.ok(h.name && typeof h.name === 'string', `${label}: Hw ${idx} name missing`);
    assert.ok(!Number.isNaN(h.qty) && h.qty > 0, `${label}: Hw ${idx} qty is NaN or <= 0: ${h.qty}`);
    assert.ok(!Number.isNaN(h.unitPrice) && h.unitPrice >= 0, `${label}: Hw ${idx} unitPrice is NaN/negative: ${h.unitPrice}`);
    assert.ok(!Number.isNaN(h.total) && h.total >= 0, `${label}: Hw ${idx} total is NaN/negative: ${h.total}`);
  });

  // 6. Machining Invariants
  cutlist.machining.forEach((m, idx) => {
    assert.ok(m.op && typeof m.op === 'string', `${label}: Machining ${idx} op missing`);
    assert.ok(m.role && typeof m.role === 'string', `${label}: Machining ${idx} role missing`);
    assert.ok(Number.isInteger(m.qty) && m.qty >= 1, `${label}: Machining ${idx} qty must be integer >= 1`);
    if (m.length !== null && m.length !== undefined) {
      assert.ok(!Number.isNaN(m.length) && m.length > 0, `${label}: Machining length is NaN/<= 0`);
    }
  });
}

// ============================================================================
// SUITE 1: Multi-Drawer Banks Stress Test (varying drawer counts, slides & boxes)
// ============================================================================

test('STRESS 1: Multi-column drawer banks (5 columns, 21 drawers total) verify slides, box walls, and pricing', () => {
  const p = M.defaultProject();
  p.settings.height = 1800;
  p.settings.depth = 500;

  // 5 columns with counts: [1, 2, 4, 6, 8] -> 21 drawers total
  p.columns = [
    { id: 'c0', width: 500, root: { id: 'd0', type: 'drawer', count: 1, size: 1 } },
    { id: 'c1', width: 550, root: { id: 'd1', type: 'drawer', count: 2, size: 1 } },
    { id: 'c2', width: 600, root: { id: 'd2', type: 'drawer', count: 4, size: 1 } },
    { id: 'c3', width: 650, root: { id: 'd3', type: 'drawer', count: 6, size: 1 } },
    { id: 'c4', width: 700, root: { id: 'd4', type: 'drawer', count: 8, size: 1 } },
  ];

  const layout = computeLayout(p);
  const { cutlist, hardware } = layout;

  assertCutlistInvariants(layout, 'Stress 1 (Multi-Drawer Banks)');

  // Verify hardware: exactly 21 slide pairs
  const slides = cutlist.hardware.find((h) => h.name === 'Corredera (par)');
  assert.ok(slides, 'Corredera (par) must exist in hardware');
  assert.equal(slides.qty, 21, 'Must have exactly 21 pairs of slides for 21 drawers');
  assert.equal(slides.total, 21 * p.settings.slidePrice);

  // Verify pulls: default style 'bar' -> 21 pulls
  const pulls = cutlist.hardware.find((h) => h.name === 'Manilla de barra');
  assert.ok(pulls, 'Pulls must exist');
  assert.equal(pulls.qty, 21, 'Must have 21 pulls for 21 drawer fronts');

  // Verify drawer box pieces generated:
  // 21 fronts, 42 sides (2 per box), 42 front/back (2 per box), 21 bottoms (1 per box)
  const drawerFronts = layout.pieces.filter((pc) => pc.name === 'Frente de gaveta');
  const drawerSides = layout.pieces.filter((pc) => pc.name === 'Lateral de gaveta');
  const drawerBacks = layout.pieces.filter((pc) => pc.name === 'Frente/trasera de gaveta');
  const drawerBottoms = layout.pieces.filter((pc) => pc.name === 'Fondo de gaveta');

  assert.equal(drawerFronts.length, 21, 'Must have 21 drawer fronts');
  assert.equal(drawerSides.length, 42, 'Must have 42 drawer sides');
  assert.equal(drawerBacks.length, 42, 'Must have 42 drawer backs/fronts');
  assert.equal(drawerBottoms.length, 21, 'Must have 21 drawer bottoms');

  // Verify drawer box walls have sy >= 10mm (clamped by bh = Math.max(10, inner - drawerInset))
  drawerSides.forEach((s) => assert.ok(s.sy >= 10, `Drawer side sy must be >= 10mm, got ${s.sy}`));
  drawerBacks.forEach((b) => assert.ok(b.sy >= 10, `Drawer back sy must be >= 10mm, got ${b.sy}`));
});

// ============================================================================
// SUITE 2: Multi-Door Wardrobes & Height Thresholds Stress Test
// ============================================================================

test('STRESS 2: Multi-door wardrobe spanning hinge threshold boundaries (<=1000mm, 1000-1800mm, >1800mm, double doors)', () => {
  const p = M.defaultProject();
  p.settings.height = 2400;

  // 6 columns:
  // Col 0: short door (h <= 1000) -> 2 hinges
  // Col 1: medium door (1000 < h <= 1800) -> 3 hinges
  // Col 2: tall door (h > 1800) -> 4 hinges
  // Col 3: double short doors -> 2 leaves * 2 hinges = 4 hinges
  // Col 4: double medium doors -> 2 leaves * 3 hinges = 6 hinges
  // Col 5: double tall doors -> 2 leaves * 4 hinges = 8 hinges
  p.columns = [
    {
      id: 'c0',
      width: 500,
      root: {
        id: 'r0',
        type: 'multiple',
        dir: 'v',
        size: 1,
        children: [
          { id: 'c0_door', type: 'shelf', size: 900, front: 'left-door' },
          { id: 'c0_open', type: 'shelf', size: 1400 },
        ],
      },
    },
    {
      id: 'c1',
      width: 500,
      root: {
        id: 'r1',
        type: 'multiple',
        dir: 'v',
        size: 1,
        children: [
          { id: 'c1_door', type: 'shelf', size: 1400, front: 'right-door' },
          { id: 'c1_open', type: 'shelf', size: 900 },
        ],
      },
    },
    {
      id: 'c2',
      width: 500,
      root: { id: 'c2_door', type: 'shelf', size: 2400, front: 'left-door' },
    },
    {
      id: 'c3',
      width: 700,
      root: {
        id: 'r3',
        type: 'multiple',
        dir: 'v',
        size: 1,
        children: [
          { id: 'c3_door', type: 'shelf', size: 900, front: 'doors' },
          { id: 'c3_open', type: 'shelf', size: 1400 },
        ],
      },
    },
    {
      id: 'c4',
      width: 700,
      root: {
        id: 'r4',
        type: 'multiple',
        dir: 'v',
        size: 1,
        children: [
          { id: 'c4_door', type: 'shelf', size: 1400, front: 'doors' },
          { id: 'c4_open', type: 'shelf', size: 900 },
        ],
      },
    },
    {
      id: 'c5',
      width: 700,
      root: { id: 'c5_door', type: 'shelf', size: 2400, front: 'doors' },
    },
  ];

  const layout = computeLayout(p);
  const { cutlist } = layout;

  assertCutlistInvariants(layout, 'Stress 2 (Multi-Door Wardrobes)');

  // Expected hinges: 2 + 3 + 4 + 4 + 6 + 8 = 27 hinges
  const hinges = cutlist.hardware.find((h) => h.name === 'Bisagra');
  assert.ok(hinges, 'Bisagra must be in hardware table');
  assert.equal(hinges.qty, 27, `Must have exactly 27 hinges across all 6 columns, got ${hinges.qty}`);
  assert.equal(hinges.unitPrice, p.settings.hingePrice);
  assert.equal(hinges.total, 27 * p.settings.hingePrice);

  // Expected doors: 1 + 1 + 1 + 2 + 2 + 2 = 9 door panels
  const doorPieces = layout.pieces.filter((pc) => pc.name === 'Puerta');
  assert.equal(doorPieces.length, 9, 'Must have exactly 9 door pieces');

  // Verify all door cutlist rows have role 'door-front' and start with 'O' prefix
  const doorRows = cutlist.rows.filter((r) => r.role === 'door-front');
  doorRows.forEach((r) => {
    assert.equal(r.id.charAt(0), 'O');
    assert.equal(r.name, 'Puerta');
    assert.ok(r.length >= r.width);
    assert.equal(r.thickness, p.settings.thickness);
  });
});

// ============================================================================
// SUITE 3: Multi-Tier Deeply Nested Shelving Hierarchy
// ============================================================================

test('STRESS 3: Deeply nested shelving hierarchy (3-level nesting, 25+ compartments) maintains all positive mm dimensions', () => {
  const p = M.defaultProject();
  p.settings.height = 2000;

  // Build a complex nested grid:
  // Column 0: 5 vertical shelves
  // Column 1: Vertical split into 3 zones, middle zone is horizontally split into 3 cells, each vertically split into 2
  // Column 2: Asymmetric shelving [150, 300, 450, 600, 300]
  p.columns = [
    {
      id: 'c0',
      width: 500,
      root: {
        id: 'c0_root',
        type: 'multiple',
        dir: 'v',
        size: 1,
        children: [
          { id: 's0_1', type: 'shelf', size: 1 },
          { id: 's0_2', type: 'shelf', size: 1 },
          { id: 's0_3', type: 'shelf', size: 1 },
          { id: 's0_4', type: 'shelf', size: 1 },
          { id: 's0_5', type: 'shelf', size: 1 },
        ],
      },
    },
    {
      id: 'c1',
      width: 800,
      root: {
        id: 'c1_root',
        type: 'multiple',
        dir: 'v',
        size: 1,
        children: [
          { id: 'top_zone', type: 'shelf', size: 1 },
          {
            id: 'mid_zone',
            type: 'multiple',
            dir: 'h',
            size: 2,
            children: [
              {
                id: 'sub_col_1',
                type: 'multiple',
                dir: 'v',
                size: 1,
                children: [
                  { id: 'cell_1_top', type: 'shelf', size: 1 },
                  { id: 'cell_1_bot', type: 'shelf', size: 1 },
                ],
              },
              {
                id: 'sub_col_2',
                type: 'multiple',
                dir: 'v',
                size: 1,
                children: [
                  { id: 'cell_2_top', type: 'shelf', size: 1 },
                  { id: 'cell_2_bot', type: 'shelf', size: 1 },
                ],
              },
              {
                id: 'sub_col_3',
                type: 'multiple',
                dir: 'v',
                size: 1,
                children: [
                  { id: 'cell_3_top', type: 'shelf', size: 1 },
                  { id: 'cell_3_bot', type: 'shelf', size: 1 },
                ],
              },
            ],
          },
          { id: 'bot_zone', type: 'shelf', size: 1 },
        ],
      },
    },
    {
      id: 'c2',
      width: 600,
      root: {
        id: 'c2_root',
        type: 'multiple',
        dir: 'v',
        size: 1,
        children: [
          { id: 'asym_1', type: 'shelf', size: 150 },
          { id: 'asym_2', type: 'shelf', size: 300 },
          { id: 'asym_3', type: 'shelf', size: 450 },
          { id: 'asym_4', type: 'shelf', size: 600 },
          { id: 'asym_5', type: 'shelf', size: 300 },
        ],
      },
    },
  ];

  const layout = computeLayout(p);
  assertCutlistInvariants(layout, 'Stress 3 (Deeply Nested Shelves)');

  // Verify internal carcass partitions
  const horizDecks = layout.pieces.filter((pc) => pc.name === 'Estante / división');
  const vertDivs = layout.pieces.filter((pc) => pc.name === 'División vertical');

  assert.ok(horizDecks.length >= 10, 'Must have at least 10 horizontal shelves');
  assert.ok(vertDivs.length >= 2, 'Must have at least 2 internal vertical divisions in mid_zone');

  // Verify carcass partitions are categorized under horizontal-deck and vertical-side roles
  const deckRows = layout.cutlist.rows.filter((r) => r.role === 'horizontal-deck');
  deckRows.forEach((r) => assert.equal(r.id.charAt(0), 'H'));

  const sideRows = layout.cutlist.rows.filter((r) => r.role === 'vertical-side');
  sideRows.forEach((r) => assert.equal(r.id.charAt(0), 'S'));
});

// ============================================================================
// SUITE 4: Hanging Rails & Brackets Multi-Wardrobe Stress
// ============================================================================

test('STRESS 4: Hanging rails across 4 varying column widths verifies meter summation and bracket pair accounting', () => {
  const p = M.defaultProject();
  // Columns widths: 450, 600, 750, 900 -> Total rails = 2700mm = 2.7m
  // 4 rails -> 8 brackets
  p.columns = [
    { id: 'c0', width: 450, root: { id: 'r0', type: 'rail', size: 1 } },
    { id: 'c1', width: 600, root: { id: 'r1', type: 'rail', size: 1 } },
    { id: 'c2', width: 750, root: { id: 'r2', type: 'rail', size: 1 } },
    { id: 'c3', width: 900, root: { id: 'r3', type: 'rail', size: 1 } },
  ];

  const layout = computeLayout(p);
  const { cutlist, settings } = layout;

  assertCutlistInvariants(layout, 'Stress 4 (Hanging Rails)');

  const railHw = cutlist.hardware.find((h) => h.name === 'Barra de perchero (m)');
  const bracketHw = cutlist.hardware.find((h) => h.name === 'Soporte de barra');

  assert.ok(railHw, 'Barra de perchero must exist');
  assert.ok(bracketHw, 'Soporte de barra must exist');

  assert.equal(railHw.qty, 2.7, 'Rail length must equal 2.7m');
  assert.equal(bracketHw.qty, 8, '4 rails must have 8 brackets');

  assert.equal(railHw.unitPrice, settings.priceRail);
  assert.equal(bracketHw.unitPrice, settings.priceRailBracket);

  assert.ok(Math.abs(railHw.total - 2.7 * settings.priceRail) < 1e-4);
  assert.equal(bracketHw.total, 8 * settings.priceRailBracket);

  // Rails are 3D hardware elements: confirm they do NOT appear in cutlist panel rows
  const railPanelRows = cutlist.rows.filter((r) => r.name.toLowerCase().includes('perchero'));
  assert.equal(railPanelRows.length, 0, 'Hanging rail must not be listed as a wooden cutlist panel');
});

// ============================================================================
// SUITE 5: Pull Styles and Mixed Hardware Aggregation
// ============================================================================

test('STRESS 5: All 4 pull styles (bar, knob, profile, none) across drawers and doors aggregate correctly', () => {
  const p = M.defaultProject();
  p.columns = [
    { id: 'c0', width: 500, root: { id: 'm0', type: 'drawer', count: 3, pull: 'bar', size: 1 } },
    { id: 'c1', width: 500, root: { id: 'm1', type: 'shelf', front: 'doors', pull: 'knob', size: 1 } },
    { id: 'c2', width: 500, root: { id: 'm2', type: 'shelf', front: 'left-door', pull: 'profile', size: 1 } },
    { id: 'c3', width: 500, root: { id: 'm3', type: 'drawer', count: 2, pull: 'none', size: 1 } },
  ];

  const layout = computeLayout(p);
  const { cutlist, settings } = layout;

  assertCutlistInvariants(layout, 'Stress 5 (Mixed Pull Styles)');

  // Col 0: 3 drawers with 'bar' -> 3 bar pulls
  const bar = cutlist.hardware.find((h) => h.name === 'Manilla de barra');
  assert.ok(bar);
  assert.equal(bar.qty, 3);
  assert.equal(bar.total, 3 * settings.pricePullBar);

  // Col 1: double doors with 'knob' -> 2 knob pulls
  const knob = cutlist.hardware.find((h) => h.name === 'Pomo');
  assert.ok(knob);
  assert.equal(knob.qty, 2);
  assert.equal(knob.total, 2 * settings.pricePullKnob);

  // Col 2: single door with 'profile' -> 1 profile pull
  const prof = cutlist.hardware.find((h) => h.name === 'Perfil / gola (sin agujeros)');
  assert.ok(prof);
  assert.equal(prof.qty, 1);
  assert.equal(prof.total, 1 * settings.pricePullProfile);

  // Col 3: 2 drawers with 'none' -> 0 pulls added for col 3
  const noneHw = cutlist.hardware.find((h) => h.name.toLowerCase().includes('push') || h.name.toLowerCase().includes('none'));
  assert.equal(noneHw, undefined, 'Hardware for pull "none" must not be generated');

  // Verify machining through-holes:
  // 3 drawers with bar (2 holes each = 6) + 2 doors with knob (1 hole each = 2) = 8 through-holes total
  const throughHoles = cutlist.machining.filter((m) => m.op === 'through-hole');
  const totalHoles = throughHoles.reduce((acc, m) => acc + m.qty, 0);
  assert.equal(totalHoles, 8, `Expected 8 total through-holes (6 bar + 2 knob), got ${totalHoles}`);
});

// ============================================================================
// SUITE 6: Fuzz Testing 50 Complex Randomized Furniture Configurations
// ============================================================================

test('STRESS 6: Fuzz Testing 50 diverse random furniture configurations preserves all 5 invariants', () => {
  const pullStyles = ['bar', 'knob', 'profile', 'none', 'default'];
  const leafTypes = ['shelf', 'rail', 'drawer'];
  const doorFronts = ['none', 'left-door', 'right-door', 'doors'];

  // Seeded deterministic pseudo-random generator
  let seed = 42;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
  const pick = (arr) => arr[randInt(0, arr.length - 1)];

  for (let iter = 1; iter <= 50; iter++) {
    const p = {
      settings: {
        ...DEFAULTS,
        height: randInt(700, 2500),
        depth: randInt(350, 750),
        thickness: pick([15, 18, 19, 22]),
        backThickness: pick([10, 15, 18, 20]),
        pullStyle: pick(['bar', 'knob', 'profile']),
      },
      columns: [],
    };

    const numCols = randInt(1, 5);
    for (let c = 0; c < numCols; c++) {
      const colWidth = randInt(250, 1000);
      const isContainer = rand() > 0.5;

      if (!isContainer) {
        const type = pick(leafTypes);
        const front = type === 'drawer' ? 'none' : pick(doorFronts);
        const count = type === 'drawer' ? randInt(1, 5) : undefined;
        const pull = pick(pullStyles);
        p.columns.push({
          id: `fuzz_c_${c}`,
          width: colWidth,
          root: { id: `mod_${c}`, type, front, count, pull, size: 1 },
        });
      } else {
        const numKids = randInt(2, 4);
        const dir = pick(['v', 'h']);
        const children = [];
        for (let k = 0; k < numKids; k++) {
          const type = pick(leafTypes);
          const front = type === 'drawer' ? 'none' : pick(doorFronts);
          const count = type === 'drawer' ? randInt(1, 4) : undefined;
          const pull = pick(pullStyles);
          children.push({ id: `mod_${c}_${k}`, type, front, count, pull, size: randInt(1, 5) });
        }
        p.columns.push({
          id: `fuzz_c_${c}`,
          width: colWidth,
          root: { id: `cont_${c}`, type: 'multiple', dir, size: 1, children },
        });
      }
    }

    const layout = computeLayout(p);
    assertCutlistInvariants(layout, `Fuzz Iteration ${iter}`);
  }
});

// ============================================================================
// SUITE 7: Machining Invariants & Role Specifics Stress Test
// ============================================================================

test('STRESS 7: Machining operations (rail-cut grooves and through-holes) maintain strictly positive specifications', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);

  assertCutlistInvariants(layoutFor(p), 'Stress 7 (Machining Operations)');

  cutlist.machining.forEach((m, idx) => {
    assert.ok(['rail-cut', 'through-hole'].includes(m.op), `Operation ${m.op} must be standard`);
    assert.ok(m.qty >= 1, 'Qty must be >= 1');

    if (m.op === 'rail-cut') {
      assert.ok(m.length > 0, `Groove length must be > 0, got ${m.length}`);
      assert.ok(m.depth > 0, `Groove depth must be > 0, got ${m.depth}`);
      assert.ok(m.width > 0, `Groove width must be > 0, got ${m.width}`);
      assert.ok(['back', 'front'].includes(m.face), `Groove face must be front or back, got ${m.face}`);
    } else if (m.op === 'through-hole') {
      assert.ok(m.diameter > 0, `Through-hole diameter must be > 0, got ${m.diameter}`);
      assert.ok(m.depth > 0, `Through-hole depth must be > 0, got ${m.depth}`);
      assert.equal(m.face, 'front');
      assert.equal(m.through, true);
    }
  });
});

function layoutFor(p) {
  return computeLayout(p);
}

// ============================================================================
// SUITE 8: Boundary Extreme: Minimalist Single Open Cell Furniture
// ============================================================================

test('STRESS 8: Single-column minimalist open shelf produces exact positive carcass and 0 hardware', () => {
  const p = {
    settings: { ...DEFAULTS },
    columns: [{ id: 'solo_c', width: 400, root: { id: 'solo_leaf', type: 'shelf', size: 1 } }],
  };

  const layout = computeLayout(p);
  const { cutlist } = layout;

  assertCutlistInvariants(layout, 'Stress 8 (Single Open Cell)');

  assert.equal(cutlist.hardware.length, 0, 'No hardware for open shelf');
  assert.equal(cutlist.hardwareTotal, 0, 'Hardware total must be 0');
  assert.equal(cutlist.total, cutlist.panelsTotal, 'Total must equal panelsTotal');

  // Should have 2 laterals, 1 top, 1 base, 1 back = 5 pieces
  assert.equal(layout.pieces.length, 5);
  // Cutlist aggregates: lateral (qty 2), tapa (qty 1), base (qty 1), fondo (qty 1) -> 4 rows
  assert.equal(cutlist.rows.length, 4);
});

// ============================================================================
// SUITE 9: Custom Rates & High-Precision Decimal Rounding Conservation
// ============================================================================

test('STRESS 9: Arbitrary fractional pricing rates maintain panelsTotal + hardwareTotal === total identity', () => {
  const p = M.defaultProject();
  p.settings = {
    ...p.settings,
    priceCarcass: 37.491,
    priceFront: 81.333,
    priceBack: 19.887,
    priceDrawer: 29.999,
    slidePrice: 13.725,
    hingePrice: 2.455,
    priceRail: 7.819,
    priceRailBracket: 1.632,
    pricePullBar: 4.123,
    pricePullKnob: 2.054,
    pricePullProfile: 8.917,
  };

  const layout = computeLayout(p);
  assertCutlistInvariants(layout, 'Stress 9 (Fractional Pricing Rates)');
});

// ============================================================================
// SUITE 10: Cutlist CSV Serialization Parity
// ============================================================================

test('STRESS 10: cutlistCSV produces parsable lines matching cutlist totals', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);
  const csv = cutlistCSV(cutlist, '$');

  assert.ok(typeof csv === 'string');
  const lines = csv.split('\n').filter((l) => l.trim().length > 0);
  assert.ok(lines.length > 5, 'CSV must contain headers, rows, and total');

  // Header line
  assert.ok(lines[0].includes('Pieza'));
  assert.ok(lines[0].includes('Total'));

  // Last line is TOTAL
  const lastLine = lines[lines.length - 1];
  assert.ok(lastLine.includes('TOTAL'));
  assert.ok(lastLine.includes(cutlist.total.toFixed(2)), `Last line must contain ${cutlist.total.toFixed(2)}`);
});
