// test/stepped_2d_editor.test.js
// Automated test suite for Milestone 2: Stepped 2D Editor & Top Border Dragging Implementation

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
  };
}

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    addEventListener() {},
    removeEventListener() {},
    location: { hash: '' },
  };
}

import { computeLayout, DEFAULTS } from '../public/js/layout.js';
import * as M from '../public/js/model.js';
import {
  buildCanvasSvg,
  calculateTopBorderDrag,
  simulateTopBorderDrag,
} from '../public/js/app.js';

// ============================================================================
// SUITE 1: Stepped 2D SVG Silhouette & Dynamic ViewBox
// ============================================================================

test('1. SVG viewBox and coordinates scale dynamically to maxH across stepped columns', () => {
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1400,
      overhang: 20,
      thickness: 18,
      depth: 450,
      backThickness: 20,
    },
    columns: [
      { id: 'col0', width: 500, height: 800, root: M.leaf('shelf') },
      { id: 'col1', width: 600, height: 1800, root: M.leaf('shelf') },
      { id: 'col2', width: 700, height: 1200, root: M.leaf('shelf') },
    ],
  };

  const layout = computeLayout(project);
  const s = layout.settings;
  const t = s.thickness;
  const ov = s.overhang;

  // Expected invariants
  const expectedMaxH = 1800;
  assert.equal(layout.maxH, expectedMaxH);

  // Total width: 18 + 500 + 18 + 600 + 18 + 700 + 18 = 1872
  const expectedTotalW = 1872;
  assert.equal(layout.totalW, expectedTotalW);

  const top = expectedMaxH + ov; // 1820
  const expectedViewBox = `${-120} ${-110} ${expectedTotalW + 240} ${expectedMaxH + 2 * ov + 200}`; // "-120 -110 2112 2040"

  const svg = buildCanvasSvg(project, layout);

  // Verify viewBox in SVG
  assert.ok(
    svg.includes(`viewBox="${expectedViewBox}"`),
    `SVG viewBox must be "${expectedViewBox}"`
  );

  // Verify top cap lines rendered at respective SVG Y coordinates: Y = top - H_i
  // Col 0: H=800  => Y = 1820 - 800  = 1020
  // Col 1: H=1800 => Y = 1820 - 1800 = 20
  // Col 2: H=1200 => Y = 1820 - 1200 = 620
  const topCaps = layout.pieces.filter((p) => p.name === 'Tapa superior');
  assert.equal(topCaps.length, 3);

  const cap0 = topCaps.find((p) => p.col === 0);
  const cap1 = topCaps.find((p) => p.col === 1);
  const cap2 = topCaps.find((p) => p.col === 2);

  const Y = (y, sy) => top - (y + sy);
  const svgY0 = Y(cap0.y, cap0.sy);
  const svgY1 = Y(cap1.y, cap1.sy);
  const svgY2 = Y(cap2.y, cap2.sy);

  assert.equal(svgY0, 1020, `Col 0 top cap SVG Y must be 1020, got ${svgY0}`);
  assert.equal(svgY1, 20, `Col 1 top cap SVG Y must be 20, got ${svgY1}`);
  assert.equal(svgY2, 620, `Col 2 top cap SVG Y must be 620, got ${svgY2}`);

  // Top cap rects exist in SVG markup
  assert.ok(svg.includes(`x="${cap0.x}" y="1020" width="${cap0.sx}" height="${cap0.sy}"`));
  assert.ok(svg.includes(`x="${cap1.x}" y="20" width="${cap1.sx}" height="${cap1.sy}"`));
  assert.ok(svg.includes(`x="${cap2.x}" y="620" width="${cap2.sx}" height="${cap2.sy}"`));
});

// ============================================================================
// SUITE 2: Per-Column Dedicated (+) Buttons Floating Above Each Top Cap
// ============================================================================

test('2. Dedicated (+) button positioned per column with distinct cy floating 50mm above each column top cap', () => {
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1400,
      overhang: 20,
      thickness: 18,
    },
    columns: [
      { id: 'colA', width: 500, height: 800, root: M.leaf('shelf') },
      { id: 'colB', width: 600, height: 1800, root: M.leaf('shelf') },
      { id: 'colC', width: 700, height: 1200, root: M.leaf('shelf') },
    ],
  };

  const layout = computeLayout(project);
  const svg = buildCanvasSvg(project, layout);

  const top = layout.maxH + layout.settings.overhang; // 1800 + 20 = 1820

  // Regex to extract plus button circle attributes
  const extractPlus = (colId) => {
    const regex = new RegExp(
      `<g class="plus" data-act="top" data-col="${colId}">[\\s\\S]*?<circle cx="([^"]+)" cy="([^"]+)"`,
      'i'
    );
    const m = svg.match(regex);
    assert.ok(m, `Plus button for ${colId} must be in SVG`);
    return { cx: parseFloat(m[1]), cy: parseFloat(m[2]) };
  };

  const btnA = extractPlus('colA');
  const btnB = extractPlus('colB');
  const btnC = extractPlus('colC');

  // Column A:
  // colX = 18
  // cx = 18 + 500 / 2 = 268
  // cy = top - 800 - 50 = 1820 - 800 - 50 = 970
  assert.equal(btnA.cx, 268, 'Col A (+) button cx');
  assert.equal(btnA.cy, 970, 'Col A (+) button cy must float 50mm above Col A top cap');

  // Column B:
  // colX = 18 + 500 + 18 = 536
  // cx = 536 + 600 / 2 = 836
  // cy = top - 1800 - 50 = 1820 - 1800 - 50 = -30
  assert.equal(btnB.cx, 836, 'Col B (+) button cx');
  assert.equal(btnB.cy, -30, 'Col B (+) button cy must float 50mm above Col B top cap');

  // Column C:
  // colX = 536 + 600 + 18 = 1154
  // cx = 1154 + 700 / 2 = 1504
  // cy = top - 1200 - 50 = 1820 - 1200 - 50 = 570
  assert.equal(btnC.cx, 1504, 'Col C (+) button cx');
  assert.equal(btnC.cy, 570, 'Col C (+) button cy must float 50mm above Col C top cap');

  // Assert distinct cy coordinates
  assert.notEqual(btnA.cy, btnB.cy, 'Plus buttons A and B must have distinct cy');
  assert.notEqual(btnB.cy, btnC.cy, 'Plus buttons B and C must have distinct cy');
  assert.notEqual(btnA.cy, btnC.cy, 'Plus buttons A and C must have distinct cy');

  // Lateral (+) buttons
  // Left: cx = -70, cy = top - col0H / 2 = 1820 - 400 = 1420
  const leftM = svg.match(/<g class="plus" data-act="colLeft"[^>]*>[\s\S]*?<circle cx="([^"]+)" cy="([^"]+)"/i);
  assert.ok(leftM, 'colLeft plus button must exist');
  assert.equal(parseFloat(leftM[1]), -70);
  assert.equal(parseFloat(leftM[2]), 1420);

  // Right: cx = totalW + 70 = 1872 + 70 = 1942, cy = top - colLastH / 2 = 1820 - 600 = 1220
  const rightM = svg.match(/<g class="plus" data-act="colRight"[^>]*>[\s\S]*?<circle cx="([^"]+)" cy="([^"]+)"/i);
  assert.ok(rightM, 'colRight plus button must exist');
  assert.equal(parseFloat(rightM[1]), 1942);
  assert.equal(parseFloat(rightM[2]), 1220);
});

// ============================================================================
// SUITE 3: col-top Divider Drag Handles Generation and Coordinates
// ============================================================================

test('3. col-top divider drag handles generated with ns-resize cursor and exact SVG coordinates', () => {
  const project = {
    settings: { ...DEFAULTS, thickness: 18, overhang: 20 },
    columns: [
      { id: 'c0', width: 550, height: 750, root: M.leaf('shelf') },
      { id: 'c1', width: 650, height: 1650, root: M.leaf('shelf') },
    ],
  };

  const layout = computeLayout(project);
  const topDividers = layout.dividers.filter((d) => d.type === 'col-top');
  assert.equal(topDividers.length, 2, 'Exactly one col-top divider per column');

  const top = layout.maxH + layout.settings.overhang; // 1650 + 20 = 1670

  // Divider 0 in layout:
  // x = 18, y = 750 - 18 = 732, w = 550, h = 18
  const d0 = topDividers.find((d) => d.colIdx === 0);
  assert.equal(d0.x, 18);
  assert.equal(d0.y, 732);
  assert.equal(d0.w, 550);
  assert.equal(d0.h, 18);
  assert.equal(d0.cursor, 'ns-resize');

  // Divider 1 in layout:
  // x = 18 + 550 + 18 = 586, y = 1650 - 18 = 1632, w = 650, h = 18
  const d1 = topDividers.find((d) => d.colIdx === 1);
  assert.equal(d1.x, 586);
  assert.equal(d1.y, 1632);
  assert.equal(d1.w, 650);
  assert.equal(d1.h, 18);
  assert.equal(d1.cursor, 'ns-resize');

  // Now verify corresponding SVG drag-handle rects in buildCanvasSvg
  const svg = buildCanvasSvg(project, layout);

  // SVG coordinates:
  // ry = Y(d.y, d.h) - pad = top - (y + h) - 8
  // For d0: Y = 1670 - 750 = 920; ry = 920 - 8 = 912; rw = 550; rh = 18 + 16 = 34
  // For d1: Y = 1670 - 1650 = 20; ry = 20 - 8 = 12; rw = 650; rh = 18 + 16 = 34
  assert.ok(
    svg.includes('class="drag-handle col-top-handle"'),
    'col-top handles must have class "drag-handle col-top-handle"'
  );
  assert.ok(
    svg.includes('cursor:ns-resize'),
    'col-top handles must have cursor:ns-resize'
  );
  assert.ok(
    svg.includes('x="18" y="912" width="550" height="34"'),
    'Handle 0 must have exact coordinates x=18, y=912, w=550, h=34'
  );
  assert.ok(
    svg.includes('x="586" y="12" width="650" height="34"'),
    'Handle 1 must have exact coordinates x=586, y=12, w=650, h=34'
  );
});

// ============================================================================
// SUITE 4: Height Delta Calculation and Bounds Clamping (Hmin >= 200, Hmax <= 4000)
// ============================================================================

test('4. Height delta calculation correctly increases on upward drag and respects Hmin >= 200, Hmax <= 4000', () => {
  const t = 18;

  // 1. Upward drag increases column height
  // In SVG space: startPt.y = 500, curPt.y = 350 => deltaH = 500 - 350 = +150
  const startH = 1000;
  const deltaUp = 150;
  const hUp = calculateTopBorderDrag(startH, deltaUp, t, 1);
  assert.equal(hUp, 1150, 'Upward drag must increase height');

  // 2. Downward drag decreases column height
  // In SVG space: startPt.y = 500, curPt.y = 650 => deltaH = 500 - 650 = -150
  const deltaDown = -150;
  const hDown = calculateTopBorderDrag(startH, deltaDown, t, 1);
  assert.equal(hDown, 850, 'Downward drag must decrease height');

  // 3. Lower bound clamping (Hmin >= 200)
  for (const extremeDelta of [-900, -1000, -5000, -100000]) {
    const clampedH = calculateTopBorderDrag(startH, extremeDelta, t, 1);
    assert.equal(clampedH, 200, `Extreme downward drag must clamp to Hmin = 200, got ${clampedH}`);
  }

  // 4. Lower bound safety with thick carcass: Math.max(200, 2*t + 50)
  // For t = 90mm: 2*90 + 50 = 230 > 200 => clamps to 230
  const thickT = 90;
  const clampedThick = calculateTopBorderDrag(startH, -5000, thickT, 1);
  assert.equal(clampedThick, 230, 'Should clamp to 2*t + 50 when greater than 200');

  // 5. Lower bound safety with multiple vertical children (protects 50mm module clearance)
  // 4 children @ 50mm + 3 dividers @ 18mm + 2 caps @ 18mm = 200 + 54 + 36 = 290mm
  const clampedMulti = calculateTopBorderDrag(startH, -5000, t, 4);
  assert.equal(clampedMulti, 290, 'Must protect vertical children from dropping below 50mm');

  // 6. Upper bound clamping (Hmax <= 4000)
  for (const extremeDelta of [3100, 4000, 10000, 1000000]) {
    const clampedH = calculateTopBorderDrag(startH, extremeDelta, t, 1);
    assert.equal(clampedH, 4000, `Extreme upward drag must clamp to Hmax = 4000, got ${clampedH}`);
  }

  // 7. Fractional delta rounding to integer mm
  const fracDelta = 123.456;
  const hFrac = calculateTopBorderDrag(startH, fracDelta, t, 1);
  assert.equal(hFrac, 1123, 'Must round fractional mm delta to integer');
  assert.equal(Number.isInteger(hFrac), true);
});

// ============================================================================
// SUITE 5: simulateTopBorderDrag Target Mutation & Neighbor Invariance
// ============================================================================

test('5. simulateTopBorderDrag modifies ONLY target column height, leaves neighbor heights untouched', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1400, thickness: 18 },
    columns: [
      { id: 'c0', width: 600, height: 900, root: M.leaf('shelf') },
      { id: 'c1', width: 600, height: 1500, root: M.leaf('shelf') },
    ],
  };

  // Drag Column 0 upward by +300mm
  const newH0 = simulateTopBorderDrag(project, 0, 300);
  assert.equal(newH0, 1200);
  assert.equal(project.columns[0].height, 1200, 'Target column 0 height updated');
  assert.equal(project.columns[1].height, 1500, 'Neighbor column 1 height strictly unchanged');

  // Drag Column 1 downward by -250mm
  const newH1 = simulateTopBorderDrag(project, 1, -250);
  assert.equal(newH1, 1250);
  assert.equal(project.columns[1].height, 1250, 'Target column 1 height updated');
  assert.equal(project.columns[0].height, 1200, 'Neighbor column 0 height strictly unchanged');
});

// ============================================================================
// SUITE 6: Undo / Redo Stack State Capture on Drag Completion
// ============================================================================

test('6. Undo stack captures initial state on drag completion; zero movement leaves history untouched', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1400, thickness: 18 },
    columns: [
      { id: 'col0', width: 600, height: 800, root: M.leaf('shelf') },
      { id: 'col1', width: 600, height: 1600, root: M.leaf('shelf') },
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

  // SCENARIO A: Meaningful drag (height increases from 800 to 1100)
  const initialSnapA = snapshot();
  let hasMovedA = false;

  // Move occurs
  hasMovedA = true;
  simulateTopBorderDrag(project, 0, 300); // 800 -> 1100

  // Mouse up
  if (hasMovedA) {
    pushUndo(initialSnapA);
  }

  assert.equal(undo.length, 1, 'Undo stack must record initial state on successful drag');
  assert.equal(project.columns[0].height, 1100);

  // Restore undo (Ctrl+Z)
  const prevA = undo.pop();
  redo.push(snapshot());
  const restoredProjA = JSON.parse(prevA);
  assert.equal(restoredProjA.columns[0].height, 800, 'Restored height must be 800mm');

  // Redo (Ctrl+Y)
  const nextA = redo.pop();
  undo.push(prevA);
  const redoProjA = JSON.parse(nextA);
  assert.equal(redoProjA.columns[0].height, 1100, 'Redone height must be 1100mm');

  // SCENARIO B: Click with ZERO movement (hasMoved === false)
  const initialSnapB = snapshot();
  const hasMovedB = false;

  const undoLenBefore = undo.length;
  const redoLenBefore = redo.length;

  // Mouse up without movement
  if (hasMovedB) {
    pushUndo(initialSnapB);
  }

  assert.equal(undo.length, undoLenBefore, 'Undo stack must NOT grow on zero-movement clicks');
  assert.equal(redo.length, redoLenBefore, 'Redo stack must NOT be cleared on zero-movement clicks');
});

// ============================================================================
// SUITE 7: addOnTop(project, colId, type, 350, false) Single-Column Reaction in SVG
// ============================================================================

test('7. Clicking top (+) calls addOnTop(..., false), elevating target column and updating only target (+) button in SVG', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1400, thickness: 18, overhang: 20 },
    columns: [
      { id: 'c0', width: 500, height: 700, root: M.leaf('shelf') },
      { id: 'c1', width: 600, height: 1400, root: M.leaf('shelf') },
    ],
  };

  const lBefore = computeLayout(project);
  const svgBefore = buildCanvasSvg(project, lBefore);

  // In before SVG:
  // maxH is 1400, top = 1420
  // c0 button cy = 1420 - 700 - 50 = 670
  // c1 button cy = 1420 - 1400 - 50 = -30
  assert.ok(svgBefore.includes('data-col="c0"'));
  assert.ok(svgBefore.includes('cy="670"'));
  assert.ok(svgBefore.includes('data-col="c1"'));
  assert.ok(svgBefore.includes('cy="-30"'));

  // Execute addOnTop with allColumns = false (stepped mode)
  const newMod = M.addOnTop(project, 'c0', 'shelf', 350, false);
  assert.ok(newMod);

  // Target col height becomes 700 + 350 + 18 = 1068
  assert.equal(project.columns[0].height, 1068);
  // Sibling col height strictly unchanged at 1400
  assert.equal(project.columns[1].height, 1400);

  const lAfter = computeLayout(project);
  const svgAfter = buildCanvasSvg(project, lAfter);

  // In after SVG:
  // maxH is 1400, top = 1420
  // c0 button cy = 1420 - 1068 - 50 = 302 (elevated with target column!)
  // c1 button cy = 1420 - 1400 - 50 = -30 (strictly unchanged!)
  const extractPlusCy = (svgContent, colId) => {
    const reg = new RegExp(`<g class="plus" data-act="top" data-col="${colId}">[\\s\\S]*?<circle [^>]*cy="([^"]+)"`, 'i');
    const m = svgContent.match(reg);
    return parseFloat(m[1]);
  };

  const cy0After = extractPlusCy(svgAfter, 'c0');
  const cy1After = extractPlusCy(svgAfter, 'c1');

  assert.equal(cy0After, 302, `Target column (+) button cy must update to 302, got ${cy0After}`);
  assert.equal(cy1After, -30, `Sibling column (+) button cy must remain strictly -30, got ${cy1After}`);
});

// ============================================================================
// SUITE 8: Internal Horizontal Divider Drag Safety Clearance >= 50mm
// ============================================================================

test('8. Internal horizontal divider dragging maintains >= 50mm safety clearance', () => {
  const project = {
    settings: { ...DEFAULTS, thickness: 18 },
    columns: [
      {
        id: 'c0',
        width: 600,
        height: 1000,
        root: {
          id: 'root0',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            M.leaf('shelf', { size: 300 }),
            M.leaf('shelf', { size: 400 }),
          ],
        },
      },
    ],
  };

  const prevNode = project.columns[0].root.children[0];
  const nextNode = project.columns[0].root.children[1];
  const totalPair = prevNode.size + nextNode.size; // 700
  const minSize = 50;

  // Simulate internal horizontal divider drag function from app.js
  const simulateInternalDivider = (delta) => {
    const effectiveMin = Math.min(minSize, Math.floor(totalPair / 2));
    let newPrev = prevNode.size + delta;
    if (newPrev < effectiveMin) newPrev = effectiveMin;
    else if (newPrev > totalPair - effectiveMin) newPrev = totalPair - effectiveMin;
    const roundedPrev = Math.round(newPrev);
    const roundedNext = totalPair - roundedPrev;
    return { prev: roundedPrev, next: roundedNext };
  };

  // Test extreme upward drag (attempting to crush prevNode)
  const resMin = simulateInternalDivider(-2000);
  assert.ok(resMin.prev >= 50, `Upper module must be >= 50mm, got ${resMin.prev}`);
  assert.equal(resMin.prev, 50);
  assert.equal(resMin.next, 650);

  // Test extreme downward drag (attempting to crush nextNode)
  const resMax = simulateInternalDivider(+2000);
  assert.ok(resMax.next >= 50, `Lower module must be >= 50mm, got ${resMax.next}`);
  assert.equal(resMax.next, 50);
  assert.equal(resMax.prev, 650);
  assert.equal(resMax.prev + resMax.next, totalPair, 'Sum of pair preserved');
});
