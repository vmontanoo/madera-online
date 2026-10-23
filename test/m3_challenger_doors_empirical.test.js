// test/m3_challenger_doors_empirical.test.js
// EMPIRICAL CHALLENGER TEST SUITE: Door Geometry, Kinematics & Hardware Invariants
// Milestone M3 Verification: Sizing Extremes, Overlap Invariant, Hardware Counting, Rapid Switching.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, DEFAULTS, FRONTS, LABELS, cutlistCSV } from '../public/js/layout.js';
import { leaf, setFront, setType, duplicateModule, defaultProject } from '../public/js/model.js';

// ============================================================================
// 1. SIZING EXTREMES (3 x 2 x 7 = 42 Configurations)
// ============================================================================

test('CHALLENGE 1: Sizing extremes (W: 100mm, 2000mm, 5000mm x H: 100mm, 3000mm x 7 front types)', () => {
  const widths = [100, 2000, 5000];
  const heights = [100, 3000];
  const allFronts = ['sliding', 'bifold', 'lift-up', 'doors', 'left-door', 'right-door', 'none'];

  for (const W of widths) {
    for (const H of heights) {
      for (const front of allFronts) {
        const proj = {
          settings: { ...DEFAULTS, height: H, depth: 500 },
          columns: [{ id: 'col1', width: W, root: { id: 'mod1', type: 'shelf', size: 1, front } }],
        };

        const l = computeLayout(proj);
        assert.ok(l, `computeLayout must return a result for W=${W}, H=${H}, front=${front}`);
        assert.ok(Array.isArray(l.pieces), 'pieces must be an array');
        assert.ok(l.cutlist, 'cutlist must be generated');

        const doorPieces = l.pieces.filter((p) => p.role === 'door-front' || p.kind === 'door-front');

        if (front === 'none') {
          assert.equal(doorPieces.length, 0, `front=none must produce 0 door panels (W=${W}, H=${H})`);
        } else if (front === 'doors') {
          assert.equal(doorPieces.length, 2, `front=doors must produce 2 door panels (W=${W}, H=${H})`);
          assert.ok(doorPieces.some((p) => p.side === 'right'));
          assert.ok(doorPieces.some((p) => p.side === 'left'));
        } else if (front === 'left-door') {
          assert.equal(doorPieces.length, 1, `front=left-door must produce 1 door panel (W=${W}, H=${H})`);
          assert.equal(doorPieces[0].side, 'right');
        } else if (front === 'right-door') {
          assert.equal(doorPieces.length, 1, `front=right-door must produce 1 door panel (W=${W}, H=${H})`);
          assert.equal(doorPieces[0].side, 'left');
        } else if (front === 'sliding') {
          assert.equal(doorPieces.length, 2, `front=sliding must produce 2 door panels (W=${W}, H=${H})`);
          assert.ok(doorPieces.some((p) => p.side === 'sliding-inner'));
          assert.ok(doorPieces.some((p) => p.side === 'sliding-outer'));
        } else if (front === 'bifold') {
          assert.equal(doorPieces.length, 2, `front=bifold must produce 2 door panels (W=${W}, H=${H})`);
          assert.ok(doorPieces.some((p) => p.side === 'bifold-anchor'));
          assert.ok(doorPieces.some((p) => p.side === 'bifold-fold'));
        } else if (front === 'lift-up') {
          assert.equal(doorPieces.length, 1, `front=lift-up must produce 1 door panel (W=${W}, H=${H})`);
          assert.equal(doorPieces[0].side, 'lift-up');
        }

        // Bounding and validity check for all created door panels
        for (const dp of doorPieces) {
          assert.ok(Number.isFinite(dp.x), `dp.x must be finite for W=${W}, H=${H}, front=${front}`);
          assert.ok(Number.isFinite(dp.y), `dp.y must be finite for W=${W}, H=${H}, front=${front}`);
          assert.ok(Number.isFinite(dp.z), `dp.z must be finite for W=${W}, H=${H}, front=${front}`);
          assert.ok(dp.sx > 0, `dp.sx must be > 0 (got ${dp.sx}) for W=${W}, H=${H}, front=${front}`);
          assert.ok(dp.sy > 0, `dp.sy must be > 0 (got ${dp.sy}) for W=${W}, H=${H}, front=${front}`);
          assert.equal(dp.sz, DEFAULTS.thickness);
          assert.equal(dp.mat, 'door');
          assert.equal(dp.role, 'door-front');
        }
      }
    }
  }
});

// ============================================================================
// 2. OVERLAP VERIFICATION FOR SLIDING DOORS
// ============================================================================

test('CHALLENGE 2: Sliding door width is strictly (cw - 2*fc)/2 + 15 and overlap is strictly 30mm across dimensions and clearances', () => {
  const testCases = [
    { W: 100, H: 100, fc: 2, t: 18 },
    { W: 200, H: 400, fc: 3, t: 18 },
    { W: 600, H: 1000, fc: 2, t: 18 },
    { W: 900, H: 1400, fc: 2, t: 18 },
    { W: 1200, H: 2000, fc: 1, t: 16 },
    { W: 2000, H: 2400, fc: 4, t: 19 },
    { W: 5000, H: 3000, fc: 2, t: 18 },
  ];

  for (const { W, H, fc, t } of testCases) {
    const proj = {
      settings: { ...DEFAULTS, height: H, depth: 550, frontClearance: fc, thickness: t },
      columns: [{ id: 'col1', width: W, root: { id: 'mod1', type: 'shelf', size: 1, front: 'sliding' } }],
    };

    const l = computeLayout(proj);
    const slidingDoors = l.pieces.filter((p) => p.name === 'Puerta corrediza');
    assert.equal(slidingDoors.length, 2, `Must have exactly 2 sliding door pieces for W=${W}`);

    const inner = slidingDoors.find((p) => p.side === 'sliding-inner');
    const outer = slidingDoors.find((p) => p.side === 'sliding-outer');
    assert.ok(inner, 'Must find sliding-inner panel');
    assert.ok(outer, 'Must find sliding-outer panel');

    const cw = W + t;
    const expectedLeafWidth = (cw - 2 * fc) / 2 + 15;

    // 1. Strict leaf width check
    assert.equal(inner.sx, expectedLeafWidth, `Inner door leaf width must strictly equal (cw - 2*fc)/2 + 15 for W=${W}`);
    assert.equal(outer.sx, expectedLeafWidth, `Outer door leaf width must strictly equal (cw - 2*fc)/2 + 15 for W=${W}`);

    // 2. Strict 30mm overlap invariant
    // Inner door right edge = inner.x + inner.sx
    // Outer door left edge = outer.x
    // Overlap = (inner.x + inner.sx) - outer.x
    const innerRight = inner.x + inner.sx;
    const outerLeft = outer.x;
    const overlap = innerRight - outerLeft;
    assert.equal(
      Math.round(overlap * 1e6) / 1e6,
      30,
      `Sliding door overlap must strictly equal 30mm (got ${overlap}) for W=${W}, fc=${fc}, t=${t}`
    );

    // 3. Overall opening coverage: span from inner left to outer right
    const openingLeft = inner.x;
    const openingRight = outer.x + outer.sx;
    const totalCoveredSpan = openingRight - openingLeft;
    const expectedCoveredSpan = 2 * expectedLeafWidth - 30; // 2 leaves minus overlap
    assert.equal(
      Math.round(totalCoveredSpan * 1e6) / 1e6,
      Math.round(expectedCoveredSpan * 1e6) / 1e6,
      'Total covered span must match 2 * leafWidth - 30'
    );

    // 4. Double track depth separation: inner on z=D, outer on z=D+t+2
    const D = 550;
    assert.equal(inner.z, D, `Inner door track must be at z=D (${D})`);
    assert.equal(outer.z, D + t + 2, `Outer door track must be at z=D+t+2 (${D + t + 2})`);
  }
});

// ============================================================================
// 3. HARDWARE COUNTING & COSTING INVARIANT
// ============================================================================

test('CHALLENGE 3: Hardware counting formulas and cutlist arithmetic pricing invariant', () => {
  // Test Case A: Multi-column cabinet with distinct door types
  {
    const proj = {
      settings: {
        ...DEFAULTS,
        height: 1200, // ch > 1000 => hingesPer = 3 for swinging doors
        slidingTrackPrice: 30,
        bifoldHingePrice: 5,
        bifoldGuidePrice: 10,
        gasStrutPrice: 7,
        hingePrice: 3,
      },
      columns: [
        { id: 'c1', width: 900, root: { id: 'm1', type: 'shelf', size: 1, front: 'sliding' } },
        { id: 'c2', width: 800, root: { id: 'm2', type: 'shelf', size: 1, front: 'bifold' } },
        { id: 'c3', width: 700, root: { id: 'm3', type: 'shelf', size: 1, front: 'lift-up' } },
        { id: 'c4', width: 800, root: { id: 'm4', type: 'shelf', size: 1, front: 'doors' } },
        { id: 'c5', width: 500, root: { id: 'm5', type: 'shelf', size: 1, front: 'left-door' } },
        { id: 'c6', width: 500, root: { id: 'm6', type: 'shelf', size: 1, front: 'right-door' } },
        { id: 'c7', width: 600, root: { id: 'm7', type: 'shelf', size: 1, front: 'none' } },
      ],
    };

    const l = computeLayout(proj);
    const hw = l.hardware;

    // Formulas:
    // sliding: 1 track
    assert.equal(hw.slidingTracks, 1, 'Exactly 1 sliding track kit');
    // bifold: 1 guide, 4 bifold hinges
    assert.equal(hw.bifoldGuides, 1, 'Exactly 1 bifold guide kit');
    assert.equal(hw.bifoldHinges, 4, 'Exactly 4 bifold hinges');
    // lift-up: 2 gas struts, 2 hinges
    assert.equal(hw.gasStruts, 2, 'Exactly 2 gas struts');
    // hinges count:
    // lift-up: 2
    // doors: 2 * hingesPer = 2 * 3 = 6
    // left-door: hingesPer = 3
    // right-door: hingesPer = 3
    // Total hinges = 2 + 6 + 3 + 3 = 14
    assert.equal(hw.hinges, 14, 'Total hinges must equal 14 (2 lift-up + 6 doors + 3 left + 3 right)');

    // Verify Cutlist hardware items
    const cl = l.cutlist;
    const trackHw = cl.hardware.find((h) => h.name.includes('corredizo'));
    assert.ok(trackHw);
    assert.equal(trackHw.qty, 1);
    assert.equal(trackHw.unitPrice, 30);
    assert.equal(trackHw.total, 30);

    const bifoldGuideHw = cl.hardware.find((h) => h.name.includes('Guía') && h.name.includes('plegable'));
    assert.ok(bifoldGuideHw);
    assert.equal(bifoldGuideHw.qty, 1);
    assert.equal(bifoldGuideHw.unitPrice, 10);
    assert.equal(bifoldGuideHw.total, 10);

    const bifoldHingeHw = cl.hardware.find((h) => h.name.includes('Bisagra') && h.name.includes('plegable'));
    assert.ok(bifoldHingeHw);
    assert.equal(bifoldHingeHw.qty, 4);
    assert.equal(bifoldHingeHw.unitPrice, 5);
    assert.equal(bifoldHingeHw.total, 20);

    const gasHw = cl.hardware.find((h) => h.name.includes('gas'));
    assert.ok(gasHw);
    assert.equal(gasHw.qty, 2);
    assert.equal(gasHw.unitPrice, 7);
    assert.equal(gasHw.total, 14);

    const hingeHw = cl.hardware.find((h) => h.name === 'Bisagra');
    assert.ok(hingeHw);
    assert.equal(hingeHw.qty, 14);
    assert.equal(hingeHw.unitPrice, 3);
    assert.equal(hingeHw.total, 42);

    // Verify Cutlist Pricing Invariant: cutlist.total === cutlist.panelsTotal + cutlist.hardwareTotal
    const sumPanels = cl.rows.reduce((acc, r) => acc + r.total, 0);
    const sumHardware = cl.hardware.reduce((acc, h) => acc + h.total, 0);

    assert.equal(Math.abs(cl.panelsTotal - sumPanels) < 1e-6, true, 'cl.panelsTotal must match sum of row totals');
    assert.equal(Math.abs(cl.hardwareTotal - sumHardware) < 1e-6, true, 'cl.hardwareTotal must match sum of hardware totals');
    assert.equal(
      Math.abs(cl.total - (cl.panelsTotal + cl.hardwareTotal)) < 1e-6,
      true,
      'cutlist.total must exactly equal cutlist.panelsTotal + cutlist.hardwareTotal'
    );
  }

  // Test Case B: Multiple modules of each type to test accumulation
  {
    const proj = {
      settings: { ...DEFAULTS },
      columns: [
        { id: 'c1', width: 800, root: { id: 'm1', type: 'shelf', size: 1, front: 'sliding' } },
        { id: 'c2', width: 800, root: { id: 'm2', type: 'shelf', size: 1, front: 'sliding' } },
        { id: 'c3', width: 600, root: { id: 'm3', type: 'shelf', size: 1, front: 'bifold' } },
        { id: 'c4', width: 600, root: { id: 'm4', type: 'shelf', size: 1, front: 'bifold' } },
        { id: 'c5', width: 600, root: { id: 'm5', type: 'shelf', size: 1, front: 'bifold' } },
        { id: 'c6', width: 700, root: { id: 'm6', type: 'shelf', size: 1, front: 'lift-up' } },
        { id: 'c7', width: 700, root: { id: 'm7', type: 'shelf', size: 1, front: 'lift-up' } },
      ],
    };
    const l = computeLayout(proj);
    assert.equal(l.hardware.slidingTracks, 2, '2 sliding modules = 2 sliding tracks');
    assert.equal(l.hardware.bifoldGuides, 3, '3 bifold modules = 3 bifold guides');
    assert.equal(l.hardware.bifoldHinges, 12, '3 bifold modules = 12 bifold hinges (3 * 4)');
    assert.equal(l.hardware.gasStruts, 4, '2 lift-up modules = 4 gas struts (2 * 2)');
    assert.equal(l.hardware.hinges, 4, '2 lift-up modules = 4 hinges (2 * 2)');

    assert.equal(
      Math.abs(l.cutlist.total - (l.cutlist.panelsTotal + l.cutlist.hardwareTotal)) < 1e-6,
      true,
      'Total must equal panelsTotal + hardwareTotal'
    );
  }
});

// ============================================================================
// 4. RAPID FRONT SWITCHING ON THE SAME MODULE
// ============================================================================

test('CHALLENGE 4: Rapid front switching across all 7 types on the same module produces zero state corruption', () => {
  const proj = {
    settings: { ...DEFAULTS, height: 1000 },
    columns: [{ id: 'col1', width: 800, root: { id: 'test_node', type: 'shelf', size: 1 } }],
  };

  const frontSequence = [
    'none',
    'sliding',
    'bifold',
    'lift-up',
    'doors',
    'left-door',
    'right-door',
    'sliding',
    'none',
    'bifold',
    'lift-up',
    'none',
  ];

  for (const targetFront of frontSequence) {
    setFront(proj, 'test_node', targetFront);

    // Compute layout fresh
    const l = computeLayout(proj);
    const hw = l.hardware;
    const pieces = l.pieces.filter((p) => p.role === 'door-front' || p.kind === 'door-front');

    if (targetFront === 'none') {
      assert.equal(pieces.length, 0, 'none must produce 0 door pieces');
      assert.equal(hw.slidingTracks, 0, 'no sliding tracks when none');
      assert.equal(hw.bifoldGuides, 0, 'no bifold guides when none');
      assert.equal(hw.bifoldHinges, 0, 'no bifold hinges when none');
      assert.equal(hw.gasStruts, 0, 'no gas struts when none');
      assert.equal(hw.hinges, 0, 'no hinges when none');
    } else if (targetFront === 'sliding') {
      assert.equal(pieces.length, 2, 'sliding must produce 2 door pieces');
      assert.equal(hw.slidingTracks, 1);
      assert.equal(hw.bifoldGuides, 0);
      assert.equal(hw.bifoldHinges, 0);
      assert.equal(hw.gasStruts, 0);
      assert.equal(hw.hinges, 0);
    } else if (targetFront === 'bifold') {
      assert.equal(pieces.length, 2, 'bifold must produce 2 door pieces');
      assert.equal(hw.slidingTracks, 0);
      assert.equal(hw.bifoldGuides, 1);
      assert.equal(hw.bifoldHinges, 4);
      assert.equal(hw.gasStruts, 0);
      assert.equal(hw.hinges, 0);
    } else if (targetFront === 'lift-up') {
      assert.equal(pieces.length, 1, 'lift-up must produce 1 door piece');
      assert.equal(hw.slidingTracks, 0);
      assert.equal(hw.bifoldGuides, 0);
      assert.equal(hw.bifoldHinges, 0);
      assert.equal(hw.gasStruts, 2);
      assert.equal(hw.hinges, 2);
    } else if (targetFront === 'doors') {
      assert.equal(pieces.length, 2, 'doors must produce 2 door pieces');
      assert.equal(hw.slidingTracks, 0);
      assert.equal(hw.bifoldGuides, 0);
      assert.equal(hw.bifoldHinges, 0);
      assert.equal(hw.gasStruts, 0);
      assert.equal(hw.hinges, 4); // ch <= 1000 => hingesPer = 2 => 2 * 2 = 4
    } else if (targetFront === 'left-door' || targetFront === 'right-door') {
      assert.equal(pieces.length, 1, `${targetFront} must produce 1 door piece`);
      assert.equal(hw.slidingTracks, 0);
      assert.equal(hw.bifoldGuides, 0);
      assert.equal(hw.bifoldHinges, 0);
      assert.equal(hw.gasStruts, 0);
      assert.equal(hw.hinges, 2);
    }

    // Pricing invariant check at every single step
    assert.equal(
      Math.abs(l.cutlist.total - (l.cutlist.panelsTotal + l.cutlist.hardwareTotal)) < 1e-6,
      true,
      `Step ${targetFront}: cutlist.total must equal panelsTotal + hardwareTotal`
    );
  }
});

// ============================================================================
// 5. ADVERSARIAL STRESS: DUPLICATION, CUTLIST CSV & NESTED HIERARCHY
// ============================================================================

test('CHALLENGE 5: duplicateModule on expanded doors preserves kinematics and maintains cutlist integrity', () => {
  const proj = {
    settings: { ...DEFAULTS },
    columns: [
      {
        id: 'c1',
        width: 1000,
        root: {
          id: 'container',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            { id: 'leaf_slide', type: 'shelf', size: 500, front: 'sliding' },
            { id: 'leaf_bifold', type: 'shelf', size: 500, front: 'bifold' },
          ],
        },
      },
    ],
  };

  const l1 = computeLayout(proj);
  assert.equal(l1.hardware.slidingTracks, 1);
  assert.equal(l1.hardware.bifoldGuides, 1);
  assert.equal(l1.hardware.bifoldHinges, 4);

  // Duplicate the sliding module
  const dupSlide = duplicateModule(proj, 'leaf_slide');
  assert.ok(dupSlide);
  assert.notEqual(dupSlide.id, 'leaf_slide');
  assert.equal(dupSlide.front, 'sliding');

  const l2 = computeLayout(proj);
  // Now there should be 2 sliding modules and 1 bifold
  assert.equal(l2.hardware.slidingTracks, 2, 'Duplicating sliding leaf must increment slidingTracks to 2');
  assert.equal(l2.hardware.bifoldGuides, 1);
  assert.equal(l2.hardware.bifoldHinges, 4);

  // Check cutlist CSV output
  const csv = cutlistCSV(l2.cutlist);
  assert.ok(csv.includes('Kit corredizo (rieles y carros)'));
  assert.ok(csv.includes('Guía superior para puerta plegable'));
  assert.ok(csv.includes('Bisagra de libro para puerta plegable'));
  assert.ok(csv.includes('TOTAL ($)'));
  assert.ok(csv.includes(l2.cutlist.total.toFixed(2)));
});

// ============================================================================
// 6. CUTLIST ITEMIZATION, PREFIX O AND ROLE MAPPING
// ============================================================================

test('CHALLENGE 6: Cutlist itemization, ID prefix O, and role door-front for all door types', () => {
  const activeFronts = ['sliding', 'bifold', 'lift-up', 'doors', 'left-door', 'right-door'];

  for (const front of activeFronts) {
    const proj = {
      settings: { ...DEFAULTS, priceFront: 75 },
      columns: [{ id: 'col1', width: 800, root: { id: 'm1', type: 'shelf', size: 1, front } }],
    };

    const l = computeLayout(proj);
    const doorRows = l.cutlist.rows.filter((r) => r.role === 'door-front');
    assert.ok(doorRows.length >= 1, `Must have door-front cutlist rows for front=${front}`);

    doorRows.forEach((r) => {
      assert.ok(r.id.startsWith('O'), `Door row ID "${r.id}" must start with 'O'`);
      assert.equal(r.role, 'door-front');
      assert.equal(r.mat, 'door');
      assert.ok(r.unitPrice > 0);
      assert.ok(r.total > 0);
      assert.equal(r.thickness, DEFAULTS.thickness);
    });
  }
});

// ============================================================================
// 7. DRAWER EXCLUSION INVARIANT
// ============================================================================

test('CHALLENGE 7: Drawers ignore n.front to prevent conflicting overlays', () => {
  const proj = {
    settings: { ...DEFAULTS },
    columns: [
      {
        id: 'col1',
        width: 800,
        root: { id: 'm1', type: 'drawer', count: 3, size: 1, front: 'sliding' }, // Invalid configuration
      },
    ],
  };

  const l = computeLayout(proj);
  // Drawer must NOT produce sliding doors
  const doors = l.pieces.filter((p) => p.role === 'door-front');
  assert.equal(doors.length, 0, 'Drawer module must not generate doors even if front is specified');
  assert.equal(l.hardware.slidingTracks, 0, 'No sliding tracks should be counted for drawer module');
  assert.equal(l.hardware.slides, 3, 'Must have 3 slide pairs for 3 drawers');
});

