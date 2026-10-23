import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout, DEFAULTS } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

// ============================================================================
// Empirical Challenger M2_2 Stress Harness
// Multi-Drawer Clamping (3, 4, 5 drawers @ 50, 60, 70mm), Column Clamping (150mm),
// and SVG CTM Coordinate Resilience.
// ============================================================================

// ----------------------------------------------------------------------------
// Suite 1: Multi-Drawer Clamping Matrix (3, 4, 5 drawers x 50, 60, 70mm)
// ----------------------------------------------------------------------------
const DRAWER_COUNTS = [3, 4, 5];
const CLAMP_HEIGHTS = [50, 60, 70];

for (const count of DRAWER_COUNTS) {
  for (const height of CLAMP_HEIGHTS) {
    test(`Multi-drawer boundary test: count=${count}, clampedHeight=${height}mm`, () => {
      const p = M.defaultProject();
      const col = p.columns[0];
      const shelf = col.root.children[0];
      const drawer = col.root.children[1];

      assert.equal(drawer.type, 'drawer');
      drawer.count = count;
      drawer.size = height;
      shelf.size = 1400 - height;

      const layout = computeLayout(p);

      // 1. Audit all pieces generated
      assert.ok(layout.pieces && layout.pieces.length > 0, 'Pieces must be generated');

      const drawerPieces = layout.pieces.filter((pc) => pc.kind === 'drawer');
      const frontPieces = layout.pieces.filter((pc) => pc.kind === 'front' && pc.nodeId === drawer.id);

      assert.equal(drawerPieces.length, count * 5, `Expected ${count * 5} drawer box pieces (2 sides, 2 front/backs, 1 bottom per drawer)`);
      assert.equal(frontPieces.length, count, `Expected ${count} drawer front facades`);

      // 2. Strict dimension assertions
      // Box height components (Lateral and Frente/trasera) must have sy >= 10mm
      const boxVerticalPieces = drawerPieces.filter((pc) => pc.name === 'Lateral de gaveta' || pc.name === 'Frente/trasera de gaveta');
      boxVerticalPieces.forEach((pc) => {
        assert.ok(pc.sy >= 10, `Piece ${pc.name} sy must be >= 10mm, got ${pc.sy}`);
        assert.ok(pc.sx > 0, `Piece ${pc.name} sx must be > 0, got ${pc.sx}`);
        assert.ok(pc.sz > 0, `Piece ${pc.name} sz must be > 0, got ${pc.sz}`);
        assert.ok(!Number.isNaN(pc.x) && Number.isFinite(pc.x), `Piece ${pc.name} x is NaN or non-finite: ${pc.x}`);
        assert.ok(!Number.isNaN(pc.y) && Number.isFinite(pc.y), `Piece ${pc.name} y is NaN or non-finite: ${pc.y}`);
        assert.ok(!Number.isNaN(pc.z) && Number.isFinite(pc.z), `Piece ${pc.name} z is NaN or non-finite: ${pc.z}`);
      });

      // Front facades must also have sy >= 10mm
      frontPieces.forEach((pc) => {
        assert.ok(pc.sy >= 10, `Drawer front facade sy must be >= 10mm, got ${pc.sy}`);
        assert.ok(pc.sx > 0, `Drawer front facade sx must be > 0, got ${pc.sx}`);
        assert.ok(pc.sz > 0, `Drawer front facade sz must be > 0, got ${pc.sz}`);
        assert.ok(!Number.isNaN(pc.y) && Number.isFinite(pc.y), `Drawer front facade y is NaN: ${pc.y}`);
      });

      // Bottom panels (Fondo de gaveta) have horizontal orientation; thickness sy must be strictly positive (6mm)
      const bottomPieces = drawerPieces.filter((pc) => pc.name === 'Fondo de gaveta');
      bottomPieces.forEach((pc) => {
        assert.ok(pc.sy > 0, `Fondo de gaveta sy must be strictly positive, got ${pc.sy}`);
        assert.equal(pc.sy, p.settings.drawerBottomThickness, `Fondo de gaveta sy must equal drawerBottomThickness (6mm)`);
        assert.ok(pc.sx > 0, `Fondo de gaveta sx must be > 0, got ${pc.sx}`);
        assert.ok(pc.sz > 0, `Fondo de gaveta sz must be > 0, got ${pc.sz}`);
        assert.ok(!Number.isNaN(pc.y) && Number.isFinite(pc.y), `Fondo de gaveta y is NaN: ${pc.y}`);
      });

      // 3. Cutlist audit: zero negative cutlist rows, zero NaN values
      assert.ok(layout.cutlist, 'Cutlist must exist');
      assert.ok(layout.cutlist.rows.length > 0, 'Cutlist rows must exist');
      assert.ok(layout.cutlist.total > 0, `Cutlist total must be positive, got ${layout.cutlist.total}`);
      assert.ok(Number.isFinite(layout.cutlist.total), `Cutlist total must be finite, got ${layout.cutlist.total}`);

      layout.cutlist.rows.forEach((r, idx) => {
        assert.ok(r.length > 0, `Cutlist row[${idx}] (${r.name}) length must be > 0, got ${r.length}`);
        assert.ok(r.width > 0, `Cutlist row[${idx}] (${r.name}) width must be > 0, got ${r.width}`);
        assert.ok(r.thickness > 0, `Cutlist row[${idx}] (${r.name}) thickness must be > 0, got ${r.thickness}`);
        assert.ok(r.qty > 0, `Cutlist row[${idx}] (${r.name}) qty must be > 0, got ${r.qty}`);
        assert.ok(r.unitPrice >= 0, `Cutlist row[${idx}] (${r.name}) unitPrice must be >= 0, got ${r.unitPrice}`);
        assert.ok(r.total >= 0, `Cutlist row[${idx}] (${r.name}) total must be >= 0, got ${r.total}`);
        assert.ok(!Number.isNaN(r.length), `Cutlist row[${idx}] (${r.name}) length is NaN`);
        assert.ok(!Number.isNaN(r.width), `Cutlist row[${idx}] (${r.name}) width is NaN`);
        assert.ok(!Number.isNaN(r.thickness), `Cutlist row[${idx}] (${r.name}) thickness is NaN`);
        assert.ok(!Number.isNaN(r.total), `Cutlist row[${idx}] (${r.name}) total is NaN`);
      });
    });
  }
}

// ----------------------------------------------------------------------------
// Suite 2: Column Clamping at 150mm & Inter-Column Dragging Invariants
// ----------------------------------------------------------------------------

function simulateInterColumnDrag(startLeftW, startRightW, deltaX) {
  const minW = 150;
  const totalPair = startLeftW + startRightW;
  const newLeft = Math.round(Math.max(minW, Math.min(totalPair - minW, startLeftW + deltaX)));
  const newRight = totalPair - newLeft;
  return { newLeft, newRight, totalPair };
}

function simulateOuterColumnDrag(startW, deltaX) {
  const minW = 150;
  return Math.round(Math.max(minW, startW + deltaX));
}

test('Column clamping at 150mm: inter-column drag cannot reduce width below 150mm', () => {
  const startLeft = 600;
  const startRight = 600;
  const total = 1200;

  // Extreme negative drag deltas (trying to push left column below 150mm)
  const extremeNegDeltas = [-451, -500, -600, -1000, -10000, -1e6];
  for (const delta of extremeNegDeltas) {
    const res = simulateInterColumnDrag(startLeft, startRight, delta);
    assert.equal(res.newLeft, 150, `Left column must be clamped at 150mm for delta ${delta}`);
    assert.equal(res.newRight, total - 150, `Right column must absorb remainder for delta ${delta}`);
    assert.ok(res.newRight >= 150, `Right column must be >= 150mm`);
    assert.equal(res.newLeft + res.newRight, total, `Pair sum must strictly equal ${total}`);
  }

  // Extreme positive drag deltas (trying to push right column below 150mm)
  const extremePosDeltas = [451, 500, 600, 1000, 10000, 1e6];
  for (const delta of extremePosDeltas) {
    const res = simulateInterColumnDrag(startLeft, startRight, delta);
    assert.equal(res.newRight, 150, `Right column must be clamped at 150mm for delta ${delta}`);
    assert.equal(res.newLeft, total - 150, `Left column must absorb remainder for delta ${delta}`);
    assert.ok(res.newLeft >= 150, `Left column must be >= 150mm`);
    assert.equal(res.newLeft + res.newRight, total, `Pair sum must strictly equal ${total}`);
  }

  // Outer column drag
  for (const delta of [-500, -1000, -1e6]) {
    const newW = simulateOuterColumnDrag(startLeft, delta);
    assert.equal(newW, 150, `Outer column must clamp to 150mm for negative delta ${delta}`);
  }
});

test('Project geometry validity when columns are clamped at 150mm', () => {
  const p = M.defaultProject();
  p.columns[0].width = 150;
  p.columns[1].width = 150;
  p.columns[2].width = 150;

  const layout = computeLayout(p);
  assert.ok(layout.pieces.length > 0);
  layout.pieces.forEach((pc) => {
    assert.ok(pc.sx > 0, `Piece ${pc.name} sx must be > 0 at 150mm col, got ${pc.sx}`);
    assert.ok(pc.sy > 0, `Piece ${pc.name} sy must be > 0 at 150mm col, got ${pc.sy}`);
    assert.ok(pc.sz > 0, `Piece ${pc.name} sz must be > 0 at 150mm col, got ${pc.sz}`);
    assert.ok(!Number.isNaN(pc.x) && !Number.isNaN(pc.y) && !Number.isNaN(pc.z));
  });

  layout.cutlist.rows.forEach((r) => {
    assert.ok(r.length > 0 && r.width > 0 && r.thickness > 0);
    assert.ok(!Number.isNaN(r.total) && r.total >= 0);
  });
});

// ----------------------------------------------------------------------------
// Suite 3: Coordinate Stability & SVG CTM Detachment Simulation
// ----------------------------------------------------------------------------

test('Coordinate stability: simulated SVG CTM changes and detachment during drag', () => {
  // Mock SVG Matrix
  class MockSVGMatrix {
    constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
      this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
    }
    inverse() {
      // 2D affine inverse
      const det = this.a * this.d - this.b * this.c;
      if (det === 0) throw new Error('Degenerate matrix');
      return new MockSVGMatrix(
        this.d / det,
        -this.b / det,
        -this.c / det,
        this.a / det,
        (this.c * this.f - this.d * this.e) / det,
        (this.b * this.e - this.a * this.f) / det
      );
    }
  }

  class MockDOMPoint {
    constructor(x = 0, y = 0) {
      this.x = x; this.y = y;
    }
    matrixTransform(m) {
      return {
        x: this.x * m.a + this.y * m.c + m.e,
        y: this.x * m.b + this.y * m.d + m.f,
      };
    }
  }

  // Simulate app.js getSvgCoords logic:
  // Scenario A: Normal drag with cached invCTM, DOM element detached on next tick
  let isConnected = true;
  const mockInitialCTM = new MockSVGMatrix(2, 0, 0, 2, 100, 50); // 2x zoom, translated (100, 50)
  const invCTM = mockInitialCTM.inverse();
  const pt = new MockDOMPoint();

  const mockSvgEl = {
    getScreenCTM() {
      if (!isConnected) return null; // SVG detached during DOM re-render!
      return mockInitialCTM;
    }
  };

  const mockContainer = {
    querySelector(selector) {
      if (selector === 'svg') return mockSvgEl;
      return null;
    }
  };

  const getSvgCoords = (evt) => {
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    if (invCTM) return pt.matrixTransform(invCTM);
    const curSvg = mockContainer.querySelector('svg');
    const curCtm = curSvg?.getScreenCTM();
    return curCtm ? pt.matrixTransform(curCtm.inverse()) : { x: evt.clientX, y: evt.clientY };
  };

  // Turn 1: mouse down (connected)
  const coords1 = getSvgCoords({ clientX: 300, clientY: 250 });
  assert.equal(coords1.x, (300 - 100) / 2); // 100
  assert.equal(coords1.y, (250 - 50) / 2);  // 100

  // Turn 2: DOM re-rendered, SVG detached!
  isConnected = false;
  // Calling getSvgCoords MUST NOT throw even though getScreenCTM() returns null!
  assert.doesNotThrow(() => {
    const coords2 = getSvgCoords({ clientX: 400, clientY: 350 });
    assert.equal(coords2.x, (400 - 100) / 2); // 150
    assert.equal(coords2.y, (350 - 50) / 2);  // 150
  });

  // Scenario B: Fallback when invCTM was initially null
  const getSvgCoordsNoCache = (evt) => {
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const nullInv = null;
    if (nullInv) return pt.matrixTransform(nullInv);
    const curSvg = mockContainer.querySelector('svg');
    const curCtm = curSvg?.getScreenCTM();
    return curCtm ? pt.matrixTransform(curCtm.inverse()) : { x: evt.clientX, y: evt.clientY };
  };

  // With detached SVG and no cached CTM, fallback must return client coordinates without exception
  assert.doesNotThrow(() => {
    const coordsFallback = getSvgCoordsNoCache({ clientX: 420, clientY: 530 });
    assert.equal(coordsFallback.x, 420);
    assert.equal(coordsFallback.y, 530);
  });
});
