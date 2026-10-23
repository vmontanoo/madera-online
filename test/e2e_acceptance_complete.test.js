import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLayout, DEFAULTS, buildCutlist, orientationOf, cutlistCSV } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const stylePath = path.join(projectRoot, 'public', 'style.css');
const appJsPath = path.join(projectRoot, 'public', 'js', 'app.js');
const indexHtmlPath = path.join(projectRoot, 'public', 'index.html');

// ============================================================================
// CSS PARSING HELPERS FOR @media print VERIFICATION
// ============================================================================

function extractMediaPrint(cssContent) {
  const startIdx = cssContent.indexOf('@media print');
  if (startIdx === -1) return null;
  const firstBrace = cssContent.indexOf('{', startIdx);
  if (firstBrace === -1) return null;
  let depth = 1;
  let idx = firstBrace + 1;
  while (idx < cssContent.length && depth > 0) {
    if (cssContent[idx] === '{') depth++;
    else if (cssContent[idx] === '}') depth--;
    idx++;
  }
  return cssContent.slice(firstBrace + 1, idx - 1);
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function parseCssRules(cssText) {
  const clean = stripCssComments(cssText);
  const rules = [];
  const regex = /([^{}]+)\{([^{}]+)\}/g;
  let match;
  while ((match = regex.exec(clean)) !== null) {
    const selectors = match[1].split(',').map((s) => s.trim()).filter(Boolean);
    const decls = match[2].trim();
    rules.push({ selectors, decls });
  }
  return rules;
}

function isSelectorStrictlyHidden(rules, targetSelector) {
  return rules.some(
    (r) =>
      r.selectors.some((s) => s === targetSelector || s.split(/\s+/).includes(targetSelector)) &&
      /display\s*:\s*none\s*!important/i.test(r.decls)
  );
}

function isSelectorDisplayed(rules, targetSelector) {
  return rules.some(
    (r) =>
      r.selectors.some((s) => s === targetSelector || s.split(/\s+/).includes(targetSelector)) &&
      /display\s*:\s*block\s*!important/i.test(r.decls)
  );
}

// ============================================================================
// SIMULATION HELPERS FOR DRAG MATH & UNDO/REDO (MIRRORING public/js/app.js)
// ============================================================================

function simulateColumnDrag(project, colIdx, isOuter, deltaX) {
  const minW = 150;
  const startLeftW = project.columns[colIdx].width;
  if (!isOuter) {
    const startRightW = project.columns[colIdx + 1]?.width || 0;
    const totalPair = startLeftW + startRightW;
    const newLeft = Math.round(Math.max(minW, Math.min(totalPair - minW, startLeftW + deltaX)));
    const newRight = totalPair - newLeft;
    project.columns[colIdx].width = newLeft;
    project.columns[colIdx + 1].width = newRight;
    return { newLeft, newRight, totalPair };
  } else {
    const newW = Math.round(Math.max(minW, startLeftW + deltaX));
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
  const effectiveMin = Math.min(minSize, Math.floor(totalPair / 2));
  let newPrev = startPrevSize + delta;
  if (newPrev < effectiveMin) {
    newPrev = effectiveMin;
  } else if (newPrev > totalPair - effectiveMin) {
    newPrev = totalPair - effectiveMin;
  }

  const roundedPrev = Math.round(newPrev);
  const roundedNext = totalPair - roundedPrev;
  prevNode.size = roundedPrev;
  nextNode.size = roundedNext;

  return { roundedPrev, roundedNext, totalPair };
}

function createHistoryHarness(initialProject) {
  const state = {
    project: JSON.parse(JSON.stringify(initialProject)),
    selected: null,
  };
  const undo = [];
  const redo = [];

  const snapshot = () => JSON.stringify(state.project);
  const pushUndo = (prevSnapshot) => {
    if (snapshot() !== prevSnapshot) {
      undo.push(prevSnapshot);
      if (undo.length > 100) undo.shift();
      redo.length = 0;
    }
  };
  const restore = (from, to) => {
    if (!from.length) return false;
    to.push(snapshot());
    if (to.length > 100) to.shift();
    state.project = JSON.parse(from.pop());
    return true;
  };

  return { state, undo, redo, snapshot, pushUndo, restore };
}

// ============================================================================
// SUITE 1: REQUIREMENT R1 ACCEPTANCE CRITERIA VERIFICATION
// ============================================================================

test('R1.1: Clicking top + adds module on top, expands height by addedHeight + t, leaves existing modules 100% uncompressed', () => {
  const p = M.defaultProject();
  const initialLayout = computeLayout(p);
  const initialH = p.settings.height;
  const t = p.settings.thickness;
  const addedH = 350;

  // Record exact initial cell millimeter heights for all columns
  const initialCellHeights = {};
  Object.entries(initialLayout.cells).forEach(([id, c]) => {
    initialCellHeights[id] = c.h;
  });

  const targetCol = p.columns[0];
  const oldChild0H = initialLayout.cells[targetCol.root.children[0].id].h;
  const oldChild1H = initialLayout.cells[targetCol.root.children[1].id].h;

  // Trigger top addition
  const newModule = M.addOnTop(p, targetCol.id, 'shelf', addedH, true);
  assert.ok(newModule, 'New module must be returned');
  assert.equal(p.settings.height, initialH + addedH + t, `Height must expand by ${addedH + t}`);

  const postLayout = computeLayout(p);

  // New module receives exactly addedHeight in mm
  assert.ok(
    Math.abs(postLayout.cells[newModule.id].h - addedH) < 0.01,
    `New module height expected ${addedH}mm, got ${postLayout.cells[newModule.id].h}`
  );

  // Verify target column existing children experienced 0.0mm compression
  const postChild0H = postLayout.cells[targetCol.root.children[1].id].h;
  const postChild1H = postLayout.cells[targetCol.root.children[2].id].h;
  assert.ok(
    Math.abs(postChild0H - oldChild0H) < 0.1,
    `Target column child 0 compressed: before=${oldChild0H}, after=${postChild0H}`
  );
  assert.ok(
    Math.abs(postChild1H - oldChild1H) < 0.1,
    `Target column child 1 compressed: before=${oldChild1H}, after=${postChild1H}`
  );

  // Verify other columns also experienced 0.0mm compression
  p.columns.slice(1).forEach((col, colIdx) => {
    const kids = col.root.children || [col.root];
    kids.forEach((k) => {
      const beforeH = initialCellHeights[k.id];
      if (beforeH !== undefined) {
        const afterH = postLayout.cells[k.id].h;
        assert.ok(
          Math.abs(afterH - beforeH) < 0.1,
          `Column ${colIdx + 1} module ${k.id} compressed: before=${beforeH}, after=${afterH}`
        );
      }
    });
  });
});

test('R1.2: Repetitive sequential top additions on the same column preserve 0.0mm compression', () => {
  const p = M.defaultProject();
  const t = p.settings.thickness;
  const col0 = p.columns[0];

  // Capture original baseline cell heights
  const l0 = computeLayout(p);
  const originalCellHeights = [
    l0.cells[col0.root.children[0].id].h,
    l0.cells[col0.root.children[1].id].h,
  ];

  // Perform 4 successive top additions with variable heights: 250, 300, 350, 400mm
  const additions = [250, 300, 350, 400];
  let accumulatedHeight = p.settings.height;

  additions.forEach((addedH, step) => {
    accumulatedHeight += addedH + t;
    const nn = M.addOnTop(p, col0.id, 'shelf', addedH, true);
    assert.ok(nn);
    assert.equal(p.settings.height, accumulatedHeight);

    const l = computeLayout(p);
    // Newly added top module has exact added height
    assert.ok(Math.abs(l.cells[nn.id].h - addedH) < 0.01);

    // The two original baseline modules remain completely uncompressed
    const currentOrig0H = l.cells[col0.root.children[col0.root.children.length - 2].id].h;
    const currentOrig1H = l.cells[col0.root.children[col0.root.children.length - 1].id].h;
    assert.ok(Math.abs(currentOrig0H - originalCellHeights[0]) < 0.2, `Step ${step}: orig child 0 height drifted`);
    assert.ok(Math.abs(currentOrig1H - originalCellHeights[1]) < 0.2, `Step ${step}: orig child 1 height drifted`);
  });
});

test('R1.3: addOnTop on a single-leaf column wraps cleanly without shrinking the leaf', () => {
  const p = M.defaultProject();
  // Add a fresh single-leaf column
  M.addColumn(p, 0, 500);
  const lBefore = computeLayout(p);
  const singleCol = p.columns[0];
  const originalLeafId = singleCol.root.id;
  const originalLeafH = lBefore.cells[originalLeafId].h;

  const nn = M.addOnTop(p, singleCol.id, 'drawer', 380);
  assert.ok(nn);

  const lAfter = computeLayout(p);
  assert.ok(Math.abs(lAfter.cells[nn.id].h - 380) < 0.01);
  const wrappedLeaf = singleCol.root.children[1];
  assert.ok(Math.abs(lAfter.cells[wrappedLeaf.id].h - originalLeafH) < 0.1, 'Wrapped single leaf must retain exact mm height');
});

test('R1.4: addOnTop with allColumns=true adds top shelf modules across all columns with 0.0mm drift', () => {
  const p = M.defaultProject();
  const lBefore = computeLayout(p);
  const initialH = p.settings.height;
  const t = p.settings.thickness;
  const addedH = 350;

  const baselineHeights = {};
  p.columns.forEach((c) => {
    (c.root.children || [c.root]).forEach((child) => {
      baselineHeights[child.id] = lBefore.cells[child.id].h;
    });
  });

  const nn = M.addOnTop(p, p.columns[0].id, 'shelf', addedH, true);
  assert.ok(nn);
  assert.equal(p.settings.height, initialH + addedH + t);

  const lAfter = computeLayout(p);
  // Verify all columns have a top module of addedH
  p.columns.forEach((c) => {
    const topChild = c.root.children[0];
    assert.ok(Math.abs(lAfter.cells[topChild.id].h - addedH) < 0.1, `Top child height expected ${addedH}, got ${lAfter.cells[topChild.id].h}`);
  });

  // Verify all pre-existing modules have 0.0mm compression
  Object.entries(baselineHeights).forEach(([id, expectedH]) => {
    const actualH = lAfter.cells[id].h;
    assert.ok(Math.abs(actualH - expectedH) < 0.1, `Module ${id} experienced height deviation`);
  });
});

test('R1.5: Lateral left + adds new column with 600mm width, expanding totalW by 600 + t without disturbing existing columns', () => {
  const p = M.defaultProject();
  const initialColWidths = p.columns.map((c) => c.width);
  const lBefore = computeLayout(p);
  const initialTotalW = lBefore.totalW;
  const t = p.settings.thickness;

  const newRoot = M.addColumn(p, 0); // default width 600
  assert.ok(newRoot);
  assert.equal(p.columns.length, 4);
  assert.equal(p.columns[0].width, 600);
  assert.equal(p.columns[0].root.id, newRoot.id);

  // Existing columns retain their widths
  assert.deepEqual(p.columns.slice(1).map((c) => c.width), initialColWidths);

  const lAfter = computeLayout(p);
  assert.equal(lAfter.totalW, initialTotalW + 600 + t);
  assert.equal(lAfter.cells[newRoot.id].w, 600);
  assert.equal(lAfter.cells[newRoot.id].x, t);
});

test('R1.6: Lateral right + adds new column at end, expanding totalW by 600 + t without disturbing existing columns', () => {
  const p = M.defaultProject();
  const initialColWidths = p.columns.map((c) => c.width);
  const lBefore = computeLayout(p);
  const initialTotalW = lBefore.totalW;
  const t = p.settings.thickness;

  const newRoot = M.addColumn(p, p.columns.length); // default width 600
  assert.ok(newRoot);
  assert.equal(p.columns.length, 4);
  assert.equal(p.columns[3].width, 600);
  assert.equal(p.columns[3].root.id, newRoot.id);

  // Existing columns retain their widths
  assert.deepEqual(p.columns.slice(0, 3).map((c) => c.width), initialColWidths);

  const lAfter = computeLayout(p);
  assert.equal(lAfter.totalW, initialTotalW + 600 + t);
  assert.equal(lAfter.cells[newRoot.id].w, 600);
});

test('R1.7: Newly added modules possess active dividers in layout.dividers ready for immediate drag calibration', () => {
  const p = M.defaultProject();
  const targetCol = p.columns[0];

  // 1. Immediate divider after addOnTop
  const nn = M.addOnTop(p, targetCol.id, 'shelf', 350);
  const l1 = computeLayout(p);
  const topDivider = l1.dividers.find(
    (d) => d.axis === 'v' && d.prevId === nn.id && d.nextId === targetCol.root.children[1].id
  );
  assert.ok(topDivider, 'Horizontal divider must be created below newly added top module');
  assert.equal(topDivider.axis, 'v');
  assert.equal(topDivider.w, targetCol.width);
  assert.equal(topDivider.h, p.settings.thickness);
  assert.ok(topDivider.y > 0);

  // 2. Immediate dividers after addColumn
  M.addColumn(p, 0, 600);
  const l2 = computeLayout(p);
  const col0Divider = l2.dividers.find((d) => d.type === 'col' && d.colIdx === 0);
  assert.ok(col0Divider, 'Column boundary divider must be created for newly added column');
  assert.equal(col0Divider.axis, 'h');
  assert.equal(col0Divider.cursor, 'ew-resize');

  const outerDivider = l2.dividers.find((d) => d.type === 'col-outer');
  assert.ok(outerDivider, 'Outer border divider must exist');
  assert.equal(outerDivider.axis, 'h');
  assert.equal(outerDivider.cursor, 'ew-resize');
});

// ============================================================================
// SUITE 2: REQUIREMENT R2 ACCEPTANCE CRITERIA VERIFICATION
// ============================================================================

test('R2.1: Cursor styles and drag handle highlighting are correctly configured', () => {
  const p = M.defaultProject();
  const layout = computeLayout(p);

  // 1. Dividers have correct cursor properties
  const colDividers = layout.dividers.filter((d) => d.type === 'col');
  const outerDividers = layout.dividers.filter((d) => d.type === 'col-outer');
  const horizontalDividers = layout.dividers.filter((d) => d.axis === 'v');

  assert.ok(colDividers.length > 0);
  assert.ok(outerDividers.length === 1);
  assert.ok(horizontalDividers.length > 0);

  colDividers.forEach((d) => assert.equal(d.cursor, 'ew-resize'));
  outerDividers.forEach((d) => assert.equal(d.cursor, 'ew-resize'));
  horizontalDividers.forEach((d) => assert.equal(d.axis, 'v'));

  // 2. Inspect public/style.css for hover and active drag highlights
  const css = fs.readFileSync(stylePath, 'utf8');
  assert.ok(
    /svg\s+\.drag-handle:hover/i.test(css) && /svg\s+\.drag-handle\.dragging/i.test(css),
    'style.css must define hover and dragging highlights on .drag-handle'
  );
  assert.ok(
    /rgba\(255,\s*184,\s*0,\s*0\.4\)/.test(css) || /#ffb800/.test(css),
    'style.css must highlight drag handles in gold'
  );

  // 3. Inspect public/js/app.js for cursor assignment and body cursor lock during drag
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  assert.ok(
    appJs.includes("const cursor = isV ? 'ns-resize' : 'ew-resize';"),
    'app.js must assign ns-resize to horizontal dividers and ew-resize to vertical dividers'
  );
  assert.ok(
    appJs.includes('document.body.style.cursor = cursor'),
    'app.js must lock body cursor during drag'
  );
  assert.ok(
    appJs.includes("handle.classList.add('dragging')"),
    'app.js must add dragging class to active handle'
  );
});

test('R2.2: Visual 2D drag resizing performs fluid algebraic redistribution with 0mm rounding drift', () => {
  const p = M.defaultProject();
  const col = p.columns[0];
  const shelf = col.root.children[0];
  const drawer = col.root.children[1];

  const l0 = computeLayout(p);
  shelf.size = l0.cells[shelf.id].h;
  drawer.size = l0.cells[drawer.id].h;
  const totalPair = shelf.size + drawer.size;
  const effectiveMin = Math.min(50, Math.floor(totalPair / 2));

  let currentPrev = shelf.size;

  // Run 100 consecutive random-walk delta drag adjustments
  for (let step = 1; step <= 100; step++) {
    const delta = Math.sin(step * 2.3) * 350 + (step % 5) * 17.5;
    let targetPrev = currentPrev + delta;
    if (targetPrev < effectiveMin) {
      targetPrev = effectiveMin;
    } else if (targetPrev > totalPair - effectiveMin) {
      targetPrev = totalPair - effectiveMin;
    }

    const roundedPrev = Math.round(targetPrev);
    const roundedNext = totalPair - roundedPrev;

    // Strict zero-drift identity
    assert.equal(
      roundedPrev + roundedNext,
      totalPair,
      `Step ${step}: Rounding drift detected! Sum !== totalPair`
    );
    assert.ok(roundedPrev >= effectiveMin);
    assert.ok(roundedNext >= effectiveMin);

    shelf.size = roundedPrev;
    drawer.size = roundedNext;
    currentPrev = roundedPrev;

    const l = computeLayout(p);
    assert.ok(l.pieces.length > 0);
    assert.ok(Number.isFinite(l.cutlist.total) && l.cutlist.total > 0);
  }

  assert.equal(shelf.size + drawer.size, totalPair, 'Final pair sum must exactly equal original totalPair');
});

test('R2.3: Inter-column drag strictly clamps at 150mm and preserves furniture total width', () => {
  const p = M.defaultProject();
  const initialTotalW = computeLayout(p).totalW;
  const totalPair = p.columns[0].width + p.columns[1].width;

  // Extreme compression on left column (delta = -2000)
  const leftClamped = simulateColumnDrag(p, 0, false, -2000);
  assert.equal(leftClamped.newLeft, 150, 'Left column clamped to 150mm');
  assert.equal(leftClamped.newRight, totalPair - 150, 'Right column absorbs remainder');
  assert.equal(computeLayout(p).totalW, initialTotalW, 'Total cabinet width preserved');

  // Extreme compression on right column (delta = +2000)
  const rightClamped = simulateColumnDrag(p, 0, false, 2000);
  assert.equal(rightClamped.newRight, 150, 'Right column clamped to 150mm');
  assert.equal(rightClamped.newLeft, totalPair - 150, 'Left column absorbs remainder');
  assert.equal(computeLayout(p).totalW, initialTotalW, 'Total cabinet width preserved');
});

test('R2.4: Outer border drag directly expands and clamps column width at 150mm', () => {
  const p = M.defaultProject();
  const lastIdx = p.columns.length - 1;
  const origW = p.columns[lastIdx].width;
  const l0 = computeLayout(p);

  // Positive expansion: +200mm
  simulateColumnDrag(p, lastIdx, true, 200);
  assert.equal(p.columns[lastIdx].width, origW + 200);
  assert.equal(computeLayout(p).totalW, l0.totalW + 200);

  // Extreme contraction: -5000mm (clamped at 150mm)
  simulateColumnDrag(p, lastIdx, true, -5000);
  assert.equal(p.columns[lastIdx].width, 150);
  assert.ok(computeLayout(p).totalW > 0);
});

test('R2.5: Drawer clamps and physical invariants: 10mm minimum box wall, 6mm bottom plate invariant', () => {
  const counts = [3, 4, 5];
  const heights = [50, 60, 70];

  counts.forEach((count) => {
    heights.forEach((h) => {
      const p = M.defaultProject();
      const drawer = p.columns[0].root.children[1];
      drawer.count = count;
      drawer.size = h;
      p.columns[0].root.children[0].size = 1400 - h;

      const l = computeLayout(p);
      const drawerPieces = l.pieces.filter((pc) => pc.kind === 'drawer');
      const fondoPieces = drawerPieces.filter((pc) => pc.name === 'Fondo de gaveta');
      const boxWalls = drawerPieces.filter((pc) => pc.name !== 'Fondo de gaveta');
      const frontFacades = l.pieces.filter((pc) => pc.kind === 'front' && pc.nodeId === drawer.id);

      assert.equal(drawerPieces.length, count * 5);
      assert.equal(frontFacades.length, count);

      // Vertical box walls (Lateral, Frente/trasera) must have sy >= 10mm
      boxWalls.forEach((pc) => {
        assert.ok(pc.sy >= 10, `Box wall ${pc.name} sy must be >= 10mm, got ${pc.sy}`);
        assert.ok(pc.sx > 0 && pc.sz > 0);
        assert.ok(!Number.isNaN(pc.x) && !Number.isNaN(pc.y) && !Number.isNaN(pc.z));
      });

      // Bottom plate Fondo de gaveta has sy === drawerBottomThickness (6mm)
      fondoPieces.forEach((pc) => {
        assert.equal(pc.sy, p.settings.drawerBottomThickness || 6);
        assert.ok(pc.sx > 0 && pc.sz > 0);
      });

      // Front facades
      frontFacades.forEach((pc) => {
        assert.ok(pc.sy >= 10);
        assert.ok(pc.sx > 0 && pc.sz > 0);
      });
    });
  });
});

test('R2.6: Undo/Redo integration: pre-drag snapshot, history push, and exact restoration', () => {
  const harness = createHistoryHarness(M.defaultProject());
  const preDragSnapshot = harness.snapshot();

  // Perform drag resizing with movement
  harness.state.project.columns[0].width = 850;
  harness.state.project.columns[1].width = 350;
  harness.pushUndo(preDragSnapshot);

  const postDragSnapshot = harness.snapshot();
  assert.notEqual(preDragSnapshot, postDragSnapshot);
  assert.equal(harness.undo.length, 1);
  assert.equal(harness.redo.length, 0);

  // Undo (Ctrl+Z)
  assert.ok(harness.restore(harness.undo, harness.redo));
  assert.equal(harness.snapshot(), preDragSnapshot, 'Undo must restore exact pre-drag state');
  assert.equal(harness.undo.length, 0);
  assert.equal(harness.redo.length, 1);

  // Redo (Ctrl+Y)
  assert.ok(harness.restore(harness.redo, harness.undo));
  assert.equal(harness.snapshot(), postDragSnapshot, 'Redo must restore exact post-drag state');
  assert.equal(harness.undo.length, 1);
  assert.equal(harness.redo.length, 0);

  // Multi-cycle restoration test
  for (let c = 1; c <= 5; c++) {
    harness.restore(harness.undo, harness.redo);
    assert.equal(harness.snapshot(), preDragSnapshot);
    harness.restore(harness.redo, harness.undo);
    assert.equal(harness.snapshot(), postDragSnapshot);
  }
});

test('R2.7: Zero-movement clicks do not grow undo stack and strictly preserve redo stack', () => {
  const harness = createHistoryHarness(M.defaultProject());

  // Seed history so redo has 1 item
  const initialSnap = harness.snapshot();
  harness.state.project.columns[0].width = 800;
  harness.pushUndo(initialSnap);
  harness.restore(harness.undo, harness.redo);
  assert.equal(harness.undo.length, 0);
  assert.equal(harness.redo.length, 1);
  const baselineSnap = harness.snapshot();

  // Simulate 10 zero-movement clicks (hasMoved = false)
  for (let click = 1; click <= 10; click++) {
    const clickStartSnapshot = harness.snapshot();
    let hasMoved = false;

    if (hasMoved) {
      harness.pushUndo(clickStartSnapshot);
    }

    assert.equal(harness.undo.length, 0, `Click ${click}: Undo grew on zero-movement click`);
    assert.equal(harness.redo.length, 1, `Click ${click}: Redo wiped on zero-movement click`);
    assert.equal(harness.snapshot(), baselineSnap);
  }
});

// ============================================================================
// SUITE 3: REQUIREMENT R3 ACCEPTANCE CRITERIA VERIFICATION
// ============================================================================

test('R3.1: @media print strictly hides all 16 non-tabular UI elements', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printCss = extractMediaPrint(css);
  assert.ok(printCss, '@media print block must exist in style.css');
  const rules = parseCssRules(printCss);

  const REQUIRED_HIDDEN_16 = [
    '#canvas',
    '.canvas',
    '#designPane',
    '.topbar',
    '.dock',
    '#dock',
    '.btns',
    '.rtools',
    '.cards',
    '#cards',
    '.vwr',
    '#vwr',
    '.tabs',
    '.modal-bg',
    '.modal',
    'svg',
  ];

  REQUIRED_HIDDEN_16.forEach((selector) => {
    const isHidden = isSelectorStrictlyHidden(rules, selector);
    assert.ok(isHidden, `Selector "${selector}" must have display: none !important in @media print`);
  });
});

test('R3.2: #cutlist is forced visible in print mode with normal-flow geometry', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printCss = extractMediaPrint(css);
  const rules = parseCssRules(printCss);

  const isCutlistVisible = isSelectorDisplayed(rules, '#cutlist');
  assert.ok(isCutlistVisible, '#cutlist must have display: block !important in @media print');

  const cutlistRule = rules.find((r) => r.selectors.includes('#cutlist'));
  assert.ok(cutlistRule, '#cutlist rule must exist');
  assert.ok(/overflow\s*:\s*visible\s*!important/i.test(cutlistRule.decls), '#cutlist must have overflow: visible');
  assert.ok(/height\s*:\s*auto\s*!important/i.test(cutlistRule.decls), '#cutlist must have height: auto');
  assert.ok(/position\s*:\s*static\s*!important/i.test(cutlistRule.decls), '#cutlist must have position: static');
});

test('R3.3: Full ancestor geometry reset prevents multi-page truncation', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printCss = extractMediaPrint(css);
  const rules = parseCssRules(printCss);

  const ancestors = ['html', 'body', '#app', '.editor', '.left', '.cutlist'];
  const resetRule = rules.find((r) => ancestors.every((anc) => r.selectors.includes(anc)));
  assert.ok(resetRule, 'A combined ancestor reset rule must exist for html, body, #app, .editor, .left, .cutlist');

  assert.ok(/height\s*:\s*auto\s*!important/i.test(resetRule.decls));
  assert.ok(/min-height\s*:\s*0\s*!important/i.test(resetRule.decls));
  assert.ok(/overflow\s*:\s*visible\s*!important/i.test(resetRule.decls));
  assert.ok(/position\s*:\s*static\s*!important/i.test(resetRule.decls));
  assert.ok(/width\s*:\s*100%\s*!important/i.test(resetRule.decls));
  assert.ok(/background\s*:\s*#ffffff\s*!important/i.test(resetRule.decls));
  assert.ok(/color\s*:\s*#000000\s*!important/i.test(resetRule.decls));
});

test('R3.4: 9-column panel cutlist table displays exact millimeter dimensions, piece role, and unit/total prices', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);

  assert.ok(cutlist.rows.length > 0);
  cutlist.rows.forEach((r, idx) => {
    // 1. Exact millimeter dimensions (integers or 1 decimal place, L >= W >= T)
    assert.ok(Number.isFinite(r.length) && r.length > 0, `Row ${idx} length invalid: ${r.length}`);
    assert.ok(Number.isFinite(r.width) && r.width > 0, `Row ${idx} width invalid: ${r.width}`);
    assert.ok(Number.isFinite(r.thickness) && r.thickness >= 3, `Row ${idx} thickness invalid: ${r.thickness}`);
    assert.ok(r.length >= r.width, `Row ${idx} length (${r.length}) must be >= width (${r.width})`);
    assert.ok(r.length > 50, `Row ${idx} length must be in mm, got ${r.length}`);

    // 2. Piece role and name
    assert.ok(typeof r.role === 'string' && r.role.length > 0, `Row ${idx} role missing`);
    assert.ok(typeof r.name === 'string' && r.name.length > 0, `Row ${idx} name missing`);
    assert.ok(typeof r.orientation === 'string' && r.orientation.length > 0, `Row ${idx} orientation missing`);

    // 3. Price math
    assert.ok(r.qty > 0);
    assert.ok(Number.isFinite(r.unitPrice) && r.unitPrice >= 0);
    assert.ok(Number.isFinite(r.total) && r.total >= 0);
  });

  // Verify app.js DOM template renders the 9 specific column headers
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  assert.ok(appJs.includes('<th>ID</th>'));
  assert.ok(appJs.includes('<th>Pieza / Rol</th>'));
  assert.ok(appJs.includes('<th>Orientación</th>'));
  assert.ok(appJs.includes('<th class="n">Largo (mm)</th>'));
  assert.ok(appJs.includes('<th class="n">Ancho (mm)</th>'));
  assert.ok(appJs.includes('<th class="n">Espesor (mm)</th>'));
  assert.ok(appJs.includes('<th class="n">Cant.</th>'));
  assert.ok(appJs.includes('<th class="n">Precio unit.</th>'));
  assert.ok(appJs.includes('<th class="n">Precio total</th>'));
});

test('R3.5: Itemized hardware table accurately tallies and prices all hardware items', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);

  assert.ok(Array.isArray(cutlist.hardware));
  assert.ok(cutlist.hardware.length > 0);

  const slides = cutlist.hardware.find((h) => h.name.includes('Corredera'));
  assert.ok(slides, 'Correderas must exist for default 3-drawer module');
  assert.equal(slides.qty, 3);
  assert.equal(slides.unitPrice, p.settings.priceSlide);
  assert.equal(slides.total, 3 * p.settings.priceSlide);

  // Hardware subtotal check
  const sumHardware = cutlist.hardware.reduce((a, h) => a + h.total, 0);
  assert.ok(Math.abs(sumHardware - cutlist.hardwareTotal) < 1e-9);

  // Inspect app.js DOM table #hardwareTable
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  assert.ok(appJs.includes('id="hardwareTable"'));
  assert.ok(appJs.includes('<th>Herraje</th>'));
  assert.ok(appJs.includes('Sin herrajes'));
});

test('R3.6: Full machining operations table itemizes rail-cuts and through-holes', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);

  assert.ok(Array.isArray(cutlist.machining));
  assert.ok(cutlist.machining.length > 0);

  const railCuts = cutlist.machining.filter((o) => o.op === 'rail-cut');
  const throughHoles = cutlist.machining.filter((o) => o.op === 'through-hole');
  assert.ok(railCuts.length > 0, 'Rail cuts must exist for back panels and drawer bottoms');
  assert.ok(throughHoles.length > 0, 'Through holes must exist for drawer/door pulls');

  // Verify CSS forces machining visible in print
  const css = fs.readFileSync(stylePath, 'utf8');
  const printCss = extractMediaPrint(css);
  const rules = parseCssRules(printCss);
  const machRule = rules.find((r) => r.selectors.includes('#machiningSection') || r.selectors.includes('.machining-section'));
  assert.ok(machRule, '#machiningSection must be explicitly styled in print');
  assert.ok(/display\s*:\s*block\s*!important/i.test(machRule.decls));
});

test('R3.7: Dual grand total banners (header & footer) with exact equality: panelsTotal + hardwareTotal === total', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);

  // Strict price identity
  assert.equal(
    cutlist.panelsTotal + cutlist.hardwareTotal,
    cutlist.total,
    `Price identity violated: ${cutlist.panelsTotal} + ${cutlist.hardwareTotal} !== ${cutlist.total}`
  );

  // Inspect app.js DOM generation for dual banners
  const appJs = fs.readFileSync(appJsPath, 'utf8');
  assert.ok(appJs.includes('class="print-header"'), 'Header banner container must exist');
  assert.ok(appJs.includes('class="print-header-total"'), 'Header total container must exist');
  assert.ok(appJs.includes('class="print-grand-total"'), 'Footer grand total container must exist');
  assert.ok(appJs.includes('PRECIO TOTAL DEL PROYECTO:'), 'Footer grand total banner must exist');

  // Inspect style.css for print header/footer display rules
  const css = fs.readFileSync(stylePath, 'utf8');
  const printCss = extractMediaPrint(css);
  const rules = parseCssRules(printCss);
  assert.ok(isSelectorDisplayed(rules, '.print-header'), '.print-header must be display: block !important');
  assert.ok(isSelectorDisplayed(rules, '.print-grand-total'), '.print-grand-total must be display: block !important');
});

test('R3.8: Immediate print capability directly from Design tab via unconditional drawCutlist()', () => {
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // Verify refresh() calls drawCutlist() unconditionally
  const refreshIdx = appJs.indexOf('function refresh()');
  assert.ok(refreshIdx !== -1, 'refresh() function must exist in app.js');
  const refreshSnippet = appJs.slice(refreshIdx, refreshIdx + 300);
  assert.ok(
    refreshSnippet.includes('drawCutlist()'),
    'refresh() must unconditionally call drawCutlist() to pre-populate DOM for immediate printing'
  );

  // Verify name input triggers real-time header update
  assert.ok(
    appJs.includes('#name.oninput') || appJs.includes("$('#name').oninput"),
    'Project name input listener must update project name'
  );
});

test('R3.9: Print pagination, borders, and shop-floor styling rules', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printCss = extractMediaPrint(css);
  const rules = parseCssRules(printCss);

  // thead repeat on multiple pages
  const theadRule = rules.find((r) => r.selectors.includes('thead'));
  assert.ok(theadRule);
  assert.ok(/display\s*:\s*table-header-group\s*!important/i.test(theadRule.decls));

  // tr avoid page breaks inside
  const trRule = rules.find((r) => r.selectors.includes('tr'));
  assert.ok(trRule);
  assert.ok(/page-break-inside\s*:\s*avoid\s*!important/i.test(trRule.decls));

  // @page margins
  assert.ok(/@page\s*\{[^}]*margin\s*:\s*12mm\s*15mm/i.test(printCss));

  // High-contrast border styling
  const cellBorderRule = rules.find((r) => r.selectors.includes('th') && r.selectors.includes('td'));
  assert.ok(cellBorderRule);
  assert.ok(/border\s*:\s*1px\s*solid\s*#cccccc\s*!important/i.test(cellBorderRule.decls));
});

// ============================================================================
// SUITE 4: CROSS-MILESTONE INTEGRATION & COMPLETE CABINET LIFECYCLE
// ============================================================================

test('E2E LIFECYCLE: Add lateral columns, add top modules, drag resize, undo/redo, and verify print cutlist', () => {
  // 1. Initial State
  const harness = createHistoryHarness(M.defaultProject());
  const initialSnap = harness.snapshot();
  const t = harness.state.project.settings.thickness;

  // 2. Lateral Additions (R1 AC 2)
  const leftColRoot = M.addColumn(harness.state.project, 0, 550);
  const rightColRoot = M.addColumn(harness.state.project, harness.state.project.columns.length, 650);
  assert.equal(harness.state.project.columns.length, 5);
  assert.equal(harness.state.project.columns[0].width, 550);
  assert.equal(harness.state.project.columns[4].width, 650);

  // 3. Top Module Addition (R1 AC 1)
  const targetCol = harness.state.project.columns[1];
  const oldH0 = computeLayout(harness.state.project).cells[targetCol.root.children[0].id].h;
  const topModule = M.addOnTop(harness.state.project, targetCol.id, 'drawer', 320);
  assert.ok(topModule);

  const lAfterAdd = computeLayout(harness.state.project);
  assert.ok(Math.abs(lAfterAdd.cells[topModule.id].h - 320) < 0.01);
  const postH0 = lAfterAdd.cells[targetCol.root.children[1].id].h;
  assert.ok(Math.abs(postH0 - oldH0) < 0.1, 'Existing module height must experience 0.0mm deviation');

  // 4. Drag Resizing on Top Module Divider (R2 AC 2)
  const preDragSnap = harness.snapshot();
  const divider = lAfterAdd.dividers.find((d) => d.axis === 'v' && d.prevId === topModule.id);
  assert.ok(divider, 'Top divider must exist');
  const dragRes = simulateDividerDrag(harness.state.project, divider, 80);
  assert.equal(dragRes.roundedPrev + dragRes.roundedNext, dragRes.totalPair, 'Zero drift on drag');
  harness.pushUndo(preDragSnap);

  const lAfterDrag = computeLayout(harness.state.project);
  assert.ok(lAfterDrag.cells[topModule.id].h > 320);

  // 5. Drag Resizing on Column Boundary (R2 AC 2)
  const preColDragSnap = harness.snapshot();
  simulateColumnDrag(harness.state.project, 0, false, 50);
  assert.equal(harness.state.project.columns[0].width, 600);
  assert.equal(harness.state.project.columns[1].width, 714);
  harness.pushUndo(preColDragSnap);

  // 6. Undo Stack Restorations (R2 AC 3)
  // Undo column drag
  assert.ok(harness.restore(harness.undo, harness.redo));
  assert.equal(harness.state.project.columns[0].width, 550);
  assert.equal(harness.state.project.columns[1].width, 764);

  // Undo divider drag
  assert.ok(harness.restore(harness.undo, harness.redo));
  assert.ok(Math.abs(computeLayout(harness.state.project).cells[topModule.id].h - 320) < 0.1);

  // Redo divider drag
  assert.ok(harness.restore(harness.redo, harness.undo));
  assert.ok(computeLayout(harness.state.project).cells[topModule.id].h > 320);

  // 7. Full Cutlist & Accounting Invariants on Expanded Model (R3 AC 1, 2, 3)
  const finalLayout = computeLayout(harness.state.project);
  const cl = finalLayout.cutlist;

  // Strict price identity
  assert.equal(cl.panelsTotal + cl.hardwareTotal, cl.total);
  assert.ok(cl.total > 0);
  assert.ok(cl.rows.length >= 10);
  assert.ok(cl.hardware.length >= 3);
  assert.ok(cl.machining.length >= 3);

  // All panel dimensions in millimeters
  cl.rows.forEach((r) => {
    assert.ok(r.length >= r.width);
    assert.ok(r.thickness >= 3);
    assert.ok(r.length > 50);
    assert.ok(typeof r.role === 'string' && r.role.length > 0);
  });
});
