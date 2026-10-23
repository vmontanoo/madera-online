// test/m2_challenger_svg_stepped.test.js
// EMPIRICAL CHALLENGER M2-1: Adversarial Verification of Stepped 2D SVG Rendering
// Tests stepped column heights, (+) button positioning, viewBox bounds, and lateral buttons.

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

// Helper to extract all (+) button coordinates from generated SVG
function parsePlusButtons(svg) {
  const topButtons = [];
  const topRegex = /<g class="plus" data-act="top" data-col="([^"]+)">[\s\S]*?<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/gi;
  let m;
  while ((m = topRegex.exec(svg)) !== null) {
    topButtons.push({
      colId: m[1],
      cx: parseFloat(m[2]),
      cy: parseFloat(m[3]),
      r: parseFloat(m[4]),
    });
  }

  const leftRegex = /<g class="plus" data-act="colLeft"[^>]*>[\s\S]*?<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/i;
  const leftMatch = svg.match(leftRegex);
  const leftButton = leftMatch ? {
    act: 'colLeft',
    cx: parseFloat(leftMatch[1]),
    cy: parseFloat(leftMatch[2]),
    r: parseFloat(leftMatch[3]),
  } : null;

  const rightRegex = /<g class="plus" data-act="colRight"[^>]*>[\s\S]*?<circle cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/i;
  const rightMatch = svg.match(rightRegex);
  const rightButton = rightMatch ? {
    act: 'colRight',
    cx: parseFloat(rightMatch[1]),
    cy: parseFloat(rightMatch[2]),
    r: parseFloat(rightMatch[3]),
  } : null;

  return { topButtons, leftButton, rightButton };
}

// Helper to extract viewBox
function parseViewBox(svg) {
  const vbMatch = svg.match(/viewBox="([^"]+)"/);
  assert.ok(vbMatch, 'SVG must contain a valid viewBox attribute');
  const [minX, minY, width, height] = vbMatch[1].split(/\s+/).map(Number);
  return { minX, minY, width, height, maxX: minX + width, maxY: minY + height };
}

// ============================================================================
// SUITE 1: Extreme Staggered Heights Configuration [500, 2500, 900, 3200, 600]
// ============================================================================

test('1. Staggered heights [500, 2500, 900, 3200, 600]: every (+) button cy strictly equals (top - H_i - 50) and never collapses', () => {
  const heights = [500, 2500, 900, 3200, 600];
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1400,
      overhang: 20,
      thickness: 18,
      depth: 450,
    },
    columns: heights.map((h, i) => ({
      id: `col_${i}`,
      width: 400 + i * 50,
      height: h,
      root: M.leaf('shelf'),
    })),
  };

  const layout = computeLayout(project);
  const s = layout.settings;
  const maxH = 3200;
  const ov = s.overhang; // 20
  const top = maxH + ov; // 3220

  assert.equal(layout.maxH, maxH, 'layout.maxH must equal the tallest column (3200)');

  const svg = buildCanvasSvg(project, layout);
  const { topButtons } = parsePlusButtons(svg);

  assert.equal(topButtons.length, 5, 'Must generate exactly 5 column top (+) buttons');

  const expectedCys = heights.map((h) => top - h - 50);
  // [3220 - 500 - 50 = 2670, 3220 - 2500 - 50 = 670, 3220 - 900 - 50 = 2270, 3220 - 3200 - 50 = -30, 3220 - 600 - 50 = 2570]

  topButtons.forEach((btn, idx) => {
    assert.equal(btn.colId, `col_${idx}`);
    assert.equal(btn.cy, expectedCys[idx], `Column ${idx} (+) button cy must strictly equal top - H_i - 50 (${expectedCys[idx]}), got ${btn.cy}`);
  });

  // Verify non-collapse: cy values must not collapse to uniform Y
  const uniqueCys = new Set(topButtons.map((b) => b.cy));
  assert.equal(uniqueCys.size, 5, 'All 5 buttons with distinct heights must have 5 distinct cy coordinates');

  // Verify no buttons share uniform Y
  for (let i = 0; i < topButtons.length; i++) {
    for (let j = i + 1; j < topButtons.length; j++) {
      assert.notEqual(
        topButtons[i].cy,
        topButtons[j].cy,
        `Buttons col_${i} (cy=${topButtons[i].cy}) and col_${j} (cy=${topButtons[j].cy}) must NOT share a uniform Y`
      );
    }
  }
});

// ============================================================================
// SUITE 2: ViewBox Accommodates Tallest Column and Entire Structure Without Clipping
// ============================================================================

test('2. ViewBox accommodates tallest column, bottom overhang, and buttons without clipping across extremes', () => {
  const configs = [
    { label: 'Staggered [500, 2500, 900, 3200, 600]', heights: [500, 2500, 900, 3200, 600] },
    { label: 'Extreme asymmetric [200, 4000]', heights: [200, 4000] },
    { label: 'Single massive column [3800]', heights: [3800] },
    { label: 'Single tiny column [200]', heights: [200] },
    { label: 'Tall center pyramid [800, 1500, 3500, 1500, 800]', heights: [800, 1500, 3500, 1500, 800] },
  ];

  for (const cfg of configs) {
    const project = {
      settings: {
        ...DEFAULTS,
        height: 1400,
        overhang: 25,
        thickness: 18,
      },
      columns: cfg.heights.map((h, i) => ({
        id: `c_${i}`,
        width: 500,
        height: h,
        root: M.leaf('shelf'),
      })),
    };

    const layout = computeLayout(project);
    const svg = buildCanvasSvg(project, layout);
    const vb = parseViewBox(svg);
    const { topButtons, leftButton, rightButton } = parsePlusButtons(svg);

    const s = layout.settings;
    const maxH = Math.max(...cfg.heights);
    const ov = s.overhang;
    const top = maxH + ov;

    // ViewBox expected formula: viewBox="${-120} ${-110} ${totalW + 240} ${maxH + 2*ov + 200}"
    assert.equal(vb.minX, -120, `${cfg.label}: vb minX`);
    assert.equal(vb.minY, -110, `${cfg.label}: vb minY`);
    assert.equal(vb.width, layout.totalW + 240, `${cfg.label}: vb width`);
    assert.equal(vb.height, maxH + 2 * ov + 200, `${cfg.label}: vb height`);

    // Verify all top buttons are within ViewBox with margin
    for (const btn of topButtons) {
      const topEdge = btn.cy - btn.r;
      const bottomEdge = btn.cy + btn.r;
      const leftEdge = btn.cx - btn.r;
      const rightEdge = btn.cx + btn.r;

      assert.ok(
        topEdge >= vb.minY,
        `${cfg.label}: Button ${btn.colId} top edge (${topEdge}) clips above vb.minY (${vb.minY})`
      );
      assert.ok(
        bottomEdge <= vb.maxY,
        `${cfg.label}: Button ${btn.colId} bottom edge (${bottomEdge}) clips below vb.maxY (${vb.maxY})`
      );
      assert.ok(
        leftEdge >= vb.minX,
        `${cfg.label}: Button ${btn.colId} left edge (${leftEdge}) clips before vb.minX (${vb.minX})`
      );
      assert.ok(
        rightEdge <= vb.maxX,
        `${cfg.label}: Button ${btn.colId} right edge (${rightEdge}) clips beyond vb.maxX (${vb.maxX})`
      );
    }

    // Verify lateral buttons are within ViewBox
    assert.ok(leftButton, `${cfg.label}: Left button must exist`);
    assert.ok(
      leftButton.cx - leftButton.r >= vb.minX,
      `${cfg.label}: Left button left edge (${leftButton.cx - leftButton.r}) must be >= vb.minX (${vb.minX})`
    );
    assert.ok(
      leftButton.cy - leftButton.r >= vb.minY && leftButton.cy + leftButton.r <= vb.maxY,
      `${cfg.label}: Left button vertical bounds within ViewBox`
    );

    assert.ok(rightButton, `${cfg.label}: Right button must exist`);
    assert.ok(
      rightButton.cx + rightButton.r <= vb.maxX,
      `${cfg.label}: Right button right edge (${rightButton.cx + rightButton.r}) must be <= vb.maxX (${vb.maxX})`
    );
    assert.ok(
      rightButton.cy - rightButton.r >= vb.minY && rightButton.cy + rightButton.r <= vb.maxY,
      `${cfg.label}: Right button vertical bounds within ViewBox`
    );

    // Verify bottom of carcass lateral overhang in SVG space does not clip:
    // Carcass lateral starts at y = -ov, sy = maxH + 2*ov.
    // In SVG space: top - (-ov) = maxH + ov + ov = maxH + 2*ov.
    // vb.maxY = -110 + maxH + 2*ov + 200 = maxH + 2*ov + 90.
    // Safety margin at bottom = 90mm!
    const carcassBottomSvgY = top + ov;
    assert.ok(
      carcassBottomSvgY <= vb.maxY,
      `${cfg.label}: Carcass bottom overhang (${carcassBottomSvgY}) must not clip beyond vb.maxY (${vb.maxY})`
    );
    assert.equal(vb.maxY - carcassBottomSvgY, 90, `${cfg.label}: Bottom safety margin must be exactly 90mm`);
  }
});

// ============================================================================
// SUITE 3: Lateral (+) Button Positioning Across Stepped Configurations
// ============================================================================

test('3. Lateral (+) buttons are strictly centered on col0 and lastCol heights, not global maxH', () => {
  const testCases = [
    {
      desc: 'col0 very short (400), lastCol very tall (3000)',
      heights: [400, 1600, 3000],
      col0H: 400,
      lastColH: 3000,
    },
    {
      desc: 'col0 very tall (3600), lastCol very short (500)',
      heights: [3600, 2000, 500],
      col0H: 3600,
      lastColH: 500,
    },
    {
      desc: 'col0 and lastCol both short (600), center tall (3200)',
      heights: [600, 3200, 600],
      col0H: 600,
      lastColH: 600,
    },
  ];

  for (const tc of testCases) {
    const project = {
      settings: { ...DEFAULTS, overhang: 20 },
      columns: tc.heights.map((h, i) => ({
        id: `c${i}`,
        width: 500,
        height: h,
        root: M.leaf('shelf'),
      })),
    };

    const layout = computeLayout(project);
    const svg = buildCanvasSvg(project, layout);
    const { leftButton, rightButton } = parsePlusButtons(svg);

    const maxH = Math.max(...tc.heights);
    const top = maxH + 20;

    // Expected left button coordinates
    const expectedLeftX = -70;
    const expectedLeftY = top - tc.col0H / 2;
    assert.equal(leftButton.cx, expectedLeftX, `${tc.desc}: Left button cx`);
    assert.equal(leftButton.cy, expectedLeftY, `${tc.desc}: Left button cy must be centered on col0H (${tc.col0H}), not maxH`);

    // Expected right button coordinates
    const expectedRightX = layout.totalW + 70;
    const expectedRightY = top - tc.lastColH / 2;
    assert.equal(rightButton.cx, expectedRightX, `${tc.desc}: Right button cx`);
    assert.equal(rightButton.cy, expectedRightY, `${tc.desc}: Right button cy must be centered on lastColH (${tc.lastColH}), not maxH`);

    // In asymmetric case, left and right cy must be distinct
    if (tc.col0H !== tc.lastColH) {
      assert.notEqual(
        leftButton.cy,
        rightButton.cy,
        `${tc.desc}: Left and right lateral buttons must have distinct cy for unequal outer column heights`
      );
    } else {
      assert.equal(
        leftButton.cy,
        rightButton.cy,
        `${tc.desc}: Left and right lateral buttons must match cy when outer heights are equal`
      );
    }
  }
});

// ============================================================================
// SUITE 4: Fallback Resolution for Undefined / Partial Column Heights
// ============================================================================

test('4. Columns with undefined, null, or zero heights cleanly fall back to settings.height', () => {
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1500,
      overhang: 20,
    },
    columns: [
      { id: 'c0', width: 500, height: 700, root: M.leaf('shelf') },
      { id: 'c1', width: 500, /* undefined height */ root: M.leaf('shelf') },
      { id: 'c2', width: 500, height: 2100, root: M.leaf('shelf') },
      { id: 'c3', width: 500, height: 0, /* invalid zero */ root: M.leaf('shelf') },
      { id: 'c4', width: 500, height: -200, /* invalid negative */ root: M.leaf('shelf') },
    ],
  };

  const layout = computeLayout(project);
  const svg = buildCanvasSvg(project, layout);
  const { topButtons } = parsePlusButtons(svg);

  const maxH = 2100;
  const top = maxH + 20; // 2120

  // Expected heights after fallback: [700, 1500, 2100, 1500, 1500]
  const expectedCys = [
    top - 700 - 50,  // 2120 - 750 = 1370
    top - 1500 - 50, // 2120 - 1550 = 570
    top - 2100 - 50, // 2120 - 2150 = -30
    top - 1500 - 50, // 2120 - 1550 = 570
    top - 1500 - 50, // 2120 - 1550 = 570
  ];

  topButtons.forEach((btn, idx) => {
    assert.equal(btn.cy, expectedCys[idx], `Column ${idx} cy with fallback resolution`);
  });

  // Verify c1, c3, c4 all resolved to uniform fallback
  assert.equal(topButtons[1].cy, 570);
  assert.equal(topButtons[3].cy, 570);
  assert.equal(topButtons[4].cy, 570);
});

// ============================================================================
// SUITE 5: Monotonic Ascending, Descending, and Sawtooth Staircases
// ============================================================================

test('5. Strict monotonic cy progression across ascending, descending, and sawtooth stairs', () => {
  // Ascending stairs
  const ascHeights = [400, 800, 1200, 1600, 2000, 2400];
  const pAsc = {
    settings: { ...DEFAULTS, overhang: 20 },
    columns: ascHeights.map((h, i) => ({ id: `a${i}`, width: 300, height: h, root: M.leaf('shelf') })),
  };
  const svgAsc = buildCanvasSvg(pAsc, computeLayout(pAsc));
  const { topButtons: btnsAsc } = parsePlusButtons(svgAsc);

  // In SVG coordinates, higher column => smaller (more negative) cy.
  // Therefore, ascending heights must produce strictly monotonically decreasing cy!
  for (let i = 0; i < btnsAsc.length - 1; i++) {
    assert.ok(
      btnsAsc[i].cy > btnsAsc[i + 1].cy,
      `Ascending staircase: cy[${i}] (${btnsAsc[i].cy}) must be strictly > cy[${i+1}] (${btnsAsc[i+1].cy})`
    );
  }

  // Descending stairs
  const descHeights = [2400, 2000, 1600, 1200, 800, 400];
  const pDesc = {
    settings: { ...DEFAULTS, overhang: 20 },
    columns: descHeights.map((h, i) => ({ id: `d${i}`, width: 300, height: h, root: M.leaf('shelf') })),
  };
  const svgDesc = buildCanvasSvg(pDesc, computeLayout(pDesc));
  const { topButtons: btnsDesc } = parsePlusButtons(svgDesc);

  // Descending heights must produce strictly monotonically increasing cy!
  for (let i = 0; i < btnsDesc.length - 1; i++) {
    assert.ok(
      btnsDesc[i].cy < btnsDesc[i + 1].cy,
      `Descending staircase: cy[${i}] (${btnsDesc[i].cy}) must be strictly < cy[${i+1}] (${btnsDesc[i+1].cy})`
    );
  }

  // Sawtooth pattern: [500, 3000, 500, 3000, 500]
  const sawHeights = [500, 3000, 500, 3000, 500];
  const pSaw = {
    settings: { ...DEFAULTS, overhang: 20 },
    columns: sawHeights.map((h, i) => ({ id: `s${i}`, width: 300, height: h, root: M.leaf('shelf') })),
  };
  const svgSaw = buildCanvasSvg(pSaw, computeLayout(pSaw));
  const { topButtons: btnsSaw } = parsePlusButtons(svgSaw);

  for (let i = 0; i < btnsSaw.length - 1; i++) {
    if (i % 2 === 0) {
      assert.ok(btnsSaw[i].cy > btnsSaw[i + 1].cy, `Sawtooth step ${i}: low to high`);
    } else {
      assert.ok(btnsSaw[i].cy < btnsSaw[i + 1].cy, `Sawtooth step ${i}: high to low`);
    }
  }
});

// ============================================================================
// SUITE 6: Top Cap Rect, Drag Handle, and (+) Button Vertical Alignment Invariance
// ============================================================================

test('6. Invariant vertical offset: (+) button circle is strictly 50mm above each column top cap line', () => {
  const heights = [600, 1800, 1100, 2900, 750];
  const project = {
    settings: { ...DEFAULTS, thickness: 18, overhang: 20 },
    columns: heights.map((h, i) => ({ id: `col_${i}`, width: 450, height: h, root: M.leaf('shelf') })),
  };

  const layout = computeLayout(project);
  const svg = buildCanvasSvg(project, layout);
  const { topButtons } = parsePlusButtons(svg);

  const topCaps = layout.pieces.filter((p) => p.name === 'Tapa superior');
  const topDividers = layout.dividers.filter((d) => d.type === 'col-top');

  assert.equal(topCaps.length, heights.length);
  assert.equal(topDividers.length, heights.length);

  const top = layout.maxH + layout.settings.overhang;

  heights.forEach((h, idx) => {
    const cap = topCaps.find((p) => p.col === idx);
    const div = topDividers.find((d) => d.colIdx === idx);
    const btn = topButtons.find((b) => b.colId === `col_${idx}`);

    assert.ok(cap, `Top cap for col ${idx} exists`);
    assert.ok(div, `Top divider for col ${idx} exists`);
    assert.ok(btn, `Plus button for col ${idx} exists`);

    // Top cap SVG top Y coordinate: top - (cap.y + cap.sy) = top - (h - t + t) = top - h
    const capSvgY = top - h;
    // Plus button cy: top - h - 50
    const btnCy = btn.cy;

    // Strict 50mm distance verification
    const diff = capSvgY - btnCy;
    assert.equal(
      diff,
      50,
      `Column ${idx}: Distance between top cap (${capSvgY}) and (+) button cy (${btnCy}) must be strictly 50mm, got ${diff}`
    );

    // Verify top divider SVG coordinate matches top cap with 8px pad
    // ry = capSvgY - 8, rh = 18 + 16 = 34
    const divSvgY = capSvgY - 8;
    assert.ok(
      svg.includes(`y="${divSvgY}" width="${div.w}" height="34"`),
      `Column ${idx}: Drag handle rect must be at y="${divSvgY}"`
    );
  });
});

// ============================================================================
// SUITE 7: addOnTop Invariance and Reactive SVG Button Elevation
// ============================================================================

test('7. addOnTop(..., false) elevates ONLY target (+) button in SVG, preserving all neighbor buttons', () => {
  const project = {
    settings: { ...DEFAULTS, thickness: 18, overhang: 20 },
    columns: [
      { id: 'c0', width: 400, height: 600, root: M.leaf('shelf') },
      { id: 'c1', width: 400, height: 1800, root: M.leaf('shelf') },
      { id: 'c2', width: 400, height: 1200, root: M.leaf('shelf') },
    ],
  };

  const layoutBefore = computeLayout(project);
  const svgBefore = buildCanvasSvg(project, layoutBefore);
  const { topButtons: btnsBefore, leftButton: leftBefore, rightButton: rightBefore } = parsePlusButtons(svgBefore);

  // Elevate col0 with a new module (+350mm)
  M.addOnTop(project, 'c0', 'shelf', 350, false);

  // col0 height should become 600 + 350 + 18 = 968
  assert.equal(project.columns[0].height, 968);
  assert.equal(project.columns[1].height, 1800, 'Sibling c1 height must be untouched');
  assert.equal(project.columns[2].height, 1200, 'Sibling c2 height must be untouched');

  const layoutAfter = computeLayout(project);
  const svgAfter = buildCanvasSvg(project, layoutAfter);
  const { topButtons: btnsAfter, leftButton: leftAfter, rightButton: rightAfter } = parsePlusButtons(svgAfter);

  // maxH is still 1800, top is still 1820
  // c0 before cy = 1820 - 600 - 50 = 1170
  // c0 after cy = 1820 - 968 - 50 = 802
  // Delta cy = 1170 - 802 = 368mm (elevated upward by exactly 368mm)
  assert.equal(btnsBefore[0].cy, 1170);
  assert.equal(btnsAfter[0].cy, 802);
  assert.equal(btnsBefore[0].cy - btnsAfter[0].cy, 368, 'c0 button elevated by exact added height + thickness');

  // Sibling buttons must have EXACT same cy
  assert.equal(btnsAfter[1].cy, btnsBefore[1].cy, 'Sibling c1 (+) button cy strictly unchanged');
  assert.equal(btnsAfter[2].cy, btnsBefore[2].cy, 'Sibling c2 (+) button cy strictly unchanged');

  // Left lateral button cy moves because col0 height changed:
  // before: 1820 - 600 / 2 = 1520
  // after: 1820 - 968 / 2 = 1336
  assert.equal(leftBefore.cy, 1520);
  assert.equal(leftAfter.cy, 1336);

  // Right lateral button cy must remain strictly unchanged:
  // 1820 - 1200 / 2 = 1220
  assert.equal(rightBefore.cy, 1220);
  assert.equal(rightAfter.cy, 1220);
});

// ============================================================================
// SUITE 8: 50 Randomized Stepped Configurations Stress Test
// ============================================================================

test('8. Fuzzing / Stress Generator: 50 randomized stepped configurations maintain all geometry and SVG invariants', () => {
  // Simple LCG pseudo-random generator for reproducibility
  let seed = 123456789;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let iteration = 1; iteration <= 50; iteration++) {
    const colCount = Math.floor(rnd() * 6) + 2; // 2 to 7 columns
    const columns = [];
    for (let c = 0; c < colCount; c++) {
      const w = Math.floor(rnd() * 800) + 200; // 200 to 1000
      const h = Math.floor(rnd() * 3800) + 200; // 200 to 4000
      columns.push({
        id: `fuzz_c_${c}`,
        width: w,
        height: h,
        root: M.leaf('shelf'),
      });
    }

    const ov = Math.floor(rnd() * 30) + 10;
    const t = Math.floor(rnd() * 15) + 15;
    const project = {
      settings: { ...DEFAULTS, overhang: ov, thickness: t },
      columns,
    };

    const layout = computeLayout(project);
    const svg = buildCanvasSvg(project, layout);

    // 1. No NaN or undefined in SVG markup
    assert.ok(!svg.includes('NaN'), `Iter ${iteration}: SVG must not contain NaN`);
    assert.ok(!svg.includes('undefined'), `Iter ${iteration}: SVG must not contain undefined`);

    // 2. ViewBox validity
    const vb = parseViewBox(svg);
    const maxH = Math.max(...columns.map((c) => c.height));
    const top = maxH + ov;

    assert.equal(vb.width, layout.totalW + 240, `Iter ${iteration}: viewBox width`);
    assert.equal(vb.height, maxH + 2 * ov + 200, `Iter ${iteration}: viewBox height`);

    // 3. Plus buttons
    const { topButtons, leftButton, rightButton } = parsePlusButtons(svg);
    assert.equal(topButtons.length, colCount, `Iter ${iteration}: button count`);

    topButtons.forEach((btn, idx) => {
      const colH = columns[idx].height;
      const expectedCy = top - colH - 50;
      assert.equal(
        btn.cy,
        expectedCy,
        `Iter ${iteration}, col ${idx}: cy must be top - colH - 50 (${expectedCy}), got ${btn.cy}`
      );
      // Boundary check
      assert.ok(btn.cy - btn.r >= vb.minY, `Iter ${iteration}: button top >= vb.minY`);
      assert.ok(btn.cy + btn.r <= vb.maxY, `Iter ${iteration}: button bottom <= vb.maxY`);
    });

    // 4. Lateral buttons
    const expectedLeftCy = top - columns[0].height / 2;
    const expectedRightCy = top - columns[colCount - 1].height / 2;
    assert.equal(leftButton.cy, expectedLeftCy, `Iter ${iteration}: left button cy`);
    assert.equal(rightButton.cy, expectedRightCy, `Iter ${iteration}: right button cy`);
  }
});
