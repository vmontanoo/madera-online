// test/stepped_3d_viewer.test.js
// Automated test suite for Milestone 3 (R3): Stepped 3D Viewer & Kinematics
// Covers:
// 1. 3D Piece generation for stepped layouts with independent top caps at H_i - t across distinct column heights
// 2. Floor shadow and grid position scaling to maxH
// 3. Camera target bounding box centered on maxH and orbit distance scaling
// 4. Cascading drawer opening ratios (75% bottom to 35% top) using drawerIndex
// 5. Outer hinge swing door pivot calculations (-90° left, +90° right)
// 6. Explode mode offsets for independent top caps (+E_BASE * 0.8)

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// ----------------------------------------------------------------------------
// Headless DOM Mock Setup for Node.js
// ----------------------------------------------------------------------------
class MockClassList {
  constructor() {
    this._classes = new Set();
  }
  add(...names) { names.forEach((n) => this._classes.add(n)); }
  remove(...names) { names.forEach((n) => this._classes.delete(n)); }
  contains(name) { return this._classes.has(name); }
  toggle(name, force) {
    if (force === true) { this._classes.add(name); return true; }
    if (force === false) { this._classes.delete(name); return false; }
    if (this._classes.has(name)) { this._classes.delete(name); return false; }
    this._classes.add(name); return true;
  }
  get value() { return Array.from(this._classes).join(' '); }
  toString() { return this.value; }
}

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.classList = new MockClassList();
    this._listeners = {};
    this.clientWidth = 800;
    this.clientHeight = 600;
    this.offsetWidth = 800;
    this.offsetHeight = 600;
  }

  get className() { return this.classList.value; }
  set className(val) {
    this.classList._classes = new Set((val || '').split(/\s+/).filter(Boolean));
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.removeChild(this);
    }
  }

  addEventListener(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }

  removeEventListener(event, fn) {
    if (!this._listeners[event]) return;
    this._listeners[event] = this._listeners[event].filter((f) => f !== fn);
  }

  dispatchEvent(event) {
    let curr = this;
    while (curr) {
      const list = curr._listeners[event.type || 'click'] || [];
      for (const fn of list) fn(event);
      curr = curr.parentNode;
    }
    return true;
  }

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (el) => {
      for (const child of el.children) {
        let match = false;
        if (selector.startsWith('.')) {
          if (child.classList.contains(selector.slice(1))) match = true;
        } else if (selector.startsWith('[')) {
          const m = selector.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]+)")?\]/);
          if (m) {
            const attr = m[1].replace(/^data-/, '');
            if (attr in child.dataset) {
              if (!m[2] || child.dataset[attr] === m[2]) match = true;
            }
          }
        } else if (selector.toLowerCase() === child.tagName.toLowerCase()) {
          match = true;
        }
        if (match) results.push(child);
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  querySelector(selector) {
    const res = this.querySelectorAll(selector);
    return res[0] || null;
  }

  set innerHTML(html) {
    this.children = [];
    const regex = /<([a-z0-9]+)([^>]*)>(?:([\s\S]*?)<\/\1>)?/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const tag = match[1];
      const attrs = match[2];
      const content = match[3] || '';
      const child = new MockElement(tag);
      const classM = attrs.match(/class=["']([^"']+)["']/i);
      if (classM) child.className = classM[1];
      const dataMatches = attrs.matchAll(/data-([a-z0-9_-]+)=["']([^"']+)["']/gi);
      for (const dm of dataMatches) {
        child.dataset[dm[1]] = dm[2];
      }
      if (tag === 'button') child.textContent = content.trim();
      else if (content) child.innerHTML = content;
      this.appendChild(child);
    }
  }

  get innerHTML() { return ''; }
}

class MockCanvas extends MockElement {
  constructor() {
    super('canvas');
    this.width = 64;
    this.height = 64;
  }
  getContext(type) {
    if (type === '2d') {
      return {
        beginPath() {},
        arc() {},
        closePath() {},
        fill() {},
        fillText() {},
        font: '',
        textAlign: '',
        fillStyle: '',
      };
    }
    return null;
  }
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') return new MockCanvas();
      return new MockElement(tag);
    },
    createElementNS(ns, tag) {
      return this.createElement(tag);
    },
  };
}

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    devicePixelRatio: 1,
    addEventListener() {},
    removeEventListener() {},
  };
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  };
}

const { Viewer } = await import('../public/js/viewer.js');
const { computeLayout, DEFAULTS } = await import('../public/js/layout.js');
const M = await import('../public/js/model.js');

// ============================================================================
// 1. 3D PIECE GENERATION FOR STEPPED LAYOUT (Independent Top Caps & Carcasses)
// ============================================================================

test('1.1 3D scene generates independent top caps at individual column heights H_i - t', () => {
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1400,
      overhang: 20,
      thickness: 18,
      backThickness: 20,
      depth: 450,
    },
    columns: [
      { id: 'col0', width: 600, height: 800, root: M.leaf('shelf') },
      { id: 'col1', width: 800, height: 1600, root: M.leaf('shelf') },
    ],
  };

  const layout = computeLayout(project);
  assert.equal(layout.maxH, 1600);

  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  const S = 0.001;
  const t = layout.settings.thickness;

  // Find all meshes associated with 'Tapa superior' in viewer.group
  const topCapMeshes = [];
  viewer.group.traverse((obj) => {
    if (obj.isMesh && obj.userData?.piece?.name === 'Tapa superior') {
      topCapMeshes.push(obj);
    }
  });

  assert.equal(topCapMeshes.length, 2, 'Must generate exactly two 3D top cap meshes');

  const cap0Mesh = topCapMeshes.find((m) => m.userData.piece.col === 0);
  const cap1Mesh = topCapMeshes.find((m) => m.userData.piece.col === 1);
  assert.ok(cap0Mesh, 'Col 0 top cap mesh exists');
  assert.ok(cap1Mesh, 'Col 1 top cap mesh exists');

  // Verify elevations in layout mm space and 3D meters
  assert.equal(cap0Mesh.userData.piece.y, 800 - t, 'Col 0 top cap layout y = 782mm');
  assert.equal(cap1Mesh.userData.piece.y, 1600 - t, 'Col 1 top cap layout y = 1582mm');

  // Verify local mesh position Y in meters: (y + sy / 2) * S
  const expectedY0 = (800 - t + t / 2) * S; // 791mm = 0.791m
  const expectedY1 = (1600 - t + t / 2) * S; // 1591mm = 1.591m
  assert.ok(Math.abs(cap0Mesh.position.y - expectedY0) < 1e-6, `Cap 0 mesh position y expected ${expectedY0}, got ${cap0Mesh.position.y}`);
  assert.ok(Math.abs(cap1Mesh.position.y - expectedY1) < 1e-6, `Cap 1 mesh position y expected ${expectedY1}, got ${cap1Mesh.position.y}`);

  viewer.destroy();
});

test('1.2 3D scene generates shared intermediate lateral rising to max(H_prev, H_curr) + 2*ov', () => {
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1400,
      overhang: 20,
      thickness: 18,
      depth: 450,
    },
    columns: [
      { id: 'col0', width: 500, height: 900, root: M.leaf('shelf') },
      { id: 'col1', width: 600, height: 1800, root: M.leaf('shelf') },
    ],
  };

  const layout = computeLayout(project);
  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  const laterals = [];
  viewer.group.traverse((obj) => {
    if (obj.isMesh && obj.userData?.piece?.kind === 'side') {
      laterals.push(obj);
    }
  });

  assert.equal(laterals.length, 3, 'Must have left, shared, and right laterals');
  const shared = laterals.find((l) => l.userData.piece.col === 1);
  assert.ok(shared);

  const S = 0.001;
  const ov = layout.settings.overhang;
  const expectedSharedH = Math.max(900, 1800) + 2 * ov; // 1840mm
  assert.equal(shared.userData.piece.sy, expectedSharedH, 'Shared lateral height must be 1840mm');
  assert.ok(Math.abs(shared.geometry.parameters.height - expectedSharedH * S) < 1e-6);

  viewer.destroy();
});

// ============================================================================
// 2. FLOOR SHADOW AND FLOOR GRID POSITION SCALING TO maxH
// ============================================================================

test('2.1 Floor shadow, grid, and group positions scale strictly to maxH across stepped columns', () => {
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1400, // global settings height
      depth: 500,
    },
    columns: [
      { id: 'col0', width: 600, height: 1000, root: M.leaf('shelf') },
      { id: 'col1', width: 600, height: 2200, root: M.leaf('shelf') }, // maxH = 2200
    ],
  };

  const layout = computeLayout(project);
  assert.equal(layout.maxH, 2200);

  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  const S = 0.001;
  const maxH = 2200;
  const expectedYBase = -(maxH * S) / 2; // -1.1 m

  // Check floor shadow elevation
  assert.equal(viewer.floorShadow.position.y, expectedYBase, `Floor shadow must be at yBase = ${expectedYBase}`);

  // Check floor grid elevation: yBase + 0.0005
  assert.ok(
    Math.abs(viewer.floorGrid.position.y - (expectedYBase + 0.0005)) < 1e-6,
    `Floor grid must be at ${expectedYBase + 0.0005}, got ${viewer.floorGrid.position.y}`
  );

  // Check group origin y alignment
  assert.equal(viewer.group.position.y, expectedYBase, `Group position y must be at yBase = ${expectedYBase}`);

  // Check group origin x and z centering
  const expectedCx = -(layout.totalW / 2) * S;
  const expectedCz = -(layout.settings.depth / 2) * S;
  assert.equal(viewer.group.position.x, expectedCx);
  assert.equal(viewer.group.position.z, expectedCz);

  viewer.destroy();
});

test('2.2 When left column is taller than right column, floor shadow scales to maxH of left column', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1200, depth: 400 },
    columns: [
      { id: 'col0', width: 700, height: 2400, root: M.leaf('shelf') }, // maxH = 2400
      { id: 'col1', width: 700, height: 1200, root: M.leaf('shelf') },
    ],
  };

  const layout = computeLayout(project);
  assert.equal(layout.maxH, 2400);

  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  const expectedYBase = -(2400 * 0.001) / 2; // -1.2 m
  assert.equal(viewer.floorShadow.position.y, expectedYBase);
  assert.equal(viewer.group.position.y, expectedYBase);

  viewer.destroy();
});

// ============================================================================
// 3. CAMERA TARGET BOUNDING BOX CENTERED ON maxH
// ============================================================================

test('3.1 resetCamera() scales camera target and orbit distance to maxH bounding dimensions', () => {
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1200, // settings is 1200, but column is 2000
      depth: 500,
    },
    columns: [
      { id: 'col0', width: 400, height: 800, root: M.leaf('shelf') },
      { id: 'col1', width: 600, height: 2000, root: M.leaf('shelf') }, // maxH = 2000
    ],
  };

  const layout = computeLayout(project);
  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  viewer.resetCamera();

  const S = 0.001;
  const maxH = 2000;
  const W = layout.totalW * S; // 1.054 m
  const H = maxH * S; // 2.0 m
  const D = layout.settings.depth * S; // 0.5 m
  const size = Math.max(W, H, D); // 2.0 m

  const expectedCamX = size * 1.1; // 2.2
  const expectedCamY = size * 0.8; // 1.6
  const expectedCamZ = size * 1.8; // 3.6

  assert.ok(Math.abs(viewer.camera.position.x - expectedCamX) < 1e-5, `Camera X expected ${expectedCamX}, got ${viewer.camera.position.x}`);
  assert.ok(Math.abs(viewer.camera.position.y - expectedCamY) < 1e-5, `Camera Y expected ${expectedCamY}, got ${viewer.camera.position.y}`);
  assert.ok(Math.abs(viewer.camera.position.z - expectedCamZ) < 1e-5, `Camera Z expected ${expectedCamZ}, got ${viewer.camera.position.z}`);

  assert.equal(viewer.controls.target.x, 0);
  assert.equal(viewer.controls.target.y, 0);
  assert.equal(viewer.controls.target.z, 0);

  viewer.destroy();
});

// ============================================================================
// 4. CASCADING DRAWER OPENING RATIOS (75% bottom to 35% top) using drawerIndex
// ============================================================================

test('4.1 Cascading drawer opening ratios: bottom drawer opens 75%, top opens 35%', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1600, depth: 500 },
    columns: [
      {
        id: 'col0',
        width: 600,
        height: 1000,
        root: { id: 'dNode', type: 'drawer', count: 4 }, // 4 drawers: idx 0..3
      },
      {
        id: 'col1',
        width: 600,
        height: 1600,
        root: M.leaf('shelf'),
      },
    ],
  };

  const layout = computeLayout(project);
  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  // Find all drawer groups
  const drawerGroups = [];
  viewer.group.traverse((obj) => {
    if (obj.isGroup && obj.userData?.isDrawerGroup) {
      drawerGroups.push(obj);
    }
  });

  assert.equal(drawerGroups.length, 4, 'Must have 4 drawer groups');

  // Sort groups by drawerIndex ascending (0 = bottom, 3 = top)
  drawerGroups.sort((a, b) => a.userData.drawerIndex - b.userData.drawerIndex);

  // Check expected graduated ratios:
  // idx 0: 0.75 - (0/3)*0.40 = 0.75 (75%)
  // idx 1: 0.75 - (1/3)*0.40 = 0.6167
  // idx 2: 0.75 - (2/3)*0.40 = 0.4833
  // idx 3: 0.75 - (3/3)*0.40 = 0.35 (35%)
  const expectedRatios = [0.75, 0.75 - (1 / 3) * 0.40, 0.75 - (2 / 3) * 0.40, 0.35];

  drawerGroups.forEach((dg, idx) => {
    assert.equal(dg.userData.drawerIndex, idx);
    assert.ok(
      Math.abs(dg.userData.openRatio - expectedRatios[idx]) < 1e-4,
      `Drawer ${idx} openRatio expected ${expectedRatios[idx]}, got ${dg.userData.openRatio}`
    );
  });

  // Activate "open" render mode and verify physical Z displacement in 3D
  viewer.setRenderMode('open');
  // Immediately set openT = 1.0 and evaluate kinematics
  viewer.openT = 1.0;
  viewer.updateKinematics(1000, 0.016);

  const D = layout.settings.depth;
  const S = 0.001;

  drawerGroups.forEach((dg, idx) => {
    const expectedZ = expectedRatios[idx] * D * S;
    assert.ok(
      Math.abs(dg.position.z - expectedZ) < 1e-5,
      `Drawer ${idx} position.z expected ${expectedZ}, got ${dg.position.z}`
    );
  });

  // Strict monotonicity check: bottom drawer opens further out than top drawer
  assert.ok(drawerGroups[0].position.z > drawerGroups[1].position.z);
  assert.ok(drawerGroups[1].position.z > drawerGroups[2].position.z);
  assert.ok(drawerGroups[2].position.z > drawerGroups[3].position.z);

  viewer.destroy();
});

test('4.2 Single drawer opens to default 65% depth', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1000, depth: 400 },
    columns: [
      { id: 'col0', width: 500, height: 1000, root: { id: 'singleD', type: 'drawer', count: 1 } },
    ],
  };

  const layout = computeLayout(project);
  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  const drawerGroups = [];
  viewer.group.traverse((obj) => {
    if (obj.isGroup && obj.userData?.isDrawerGroup) drawerGroups.push(obj);
  });

  assert.equal(drawerGroups.length, 1);
  assert.equal(drawerGroups[0].userData.openRatio, 0.65);

  viewer.setRenderMode('open');
  viewer.openT = 1.0;
  viewer.updateKinematics(1000, 0.016);

  const expectedZ = 0.65 * 400 * 0.001; // 0.26 m
  assert.ok(Math.abs(drawerGroups[0].position.z - expectedZ) < 1e-5);

  viewer.destroy();
});

// ============================================================================
// 5. OUTER HINGE SWING DOOR PIVOT CALCULATIONS (-90° left, +90° right)
// ============================================================================

test('5.1 Double doors pivot around outer hinges and swing outward away from center', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1800, depth: 500 },
    columns: [
      {
        id: 'col0',
        width: 800,
        height: 1800,
        root: { id: 'closetDoors', type: 'shelf', front: 'doors' }, // double swing doors
      },
    ],
  };

  const layout = computeLayout(project);
  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  const pivots = [];
  viewer.group.traverse((obj) => {
    if (obj.isGroup && obj.userData?.kind === 'door-swinging') {
      pivots.push(obj);
    }
  });

  assert.equal(pivots.length, 2, 'Double doors must have 2 outer hinge pivots');

  const leftHingePivot = pivots.find((p) => p.userData.side === 'left-hinge');
  const rightHingePivot = pivots.find((p) => p.userData.side === 'right-hinge');

  assert.ok(leftHingePivot, 'Left hinge pivot found');
  assert.ok(rightHingePivot, 'Right hinge pivot found');

  const S = 0.001;
  const leftPiece = leftHingePivot.userData.piece;
  const rightPiece = rightHingePivot.userData.piece;

  // Left leaf outer hinge is at piece.x
  assert.equal(leftHingePivot.position.x, leftPiece.x * S);
  // Right leaf outer hinge is at piece.x + piece.sx
  assert.equal(rightHingePivot.position.x, (rightPiece.x + rightPiece.sx) * S);

  // Activate "open" render mode and verify outer swing angles:
  // Left leaf swings -90° (-Math.PI/2)
  // Right leaf swings +90° (+Math.PI/2)
  viewer.setRenderMode('open');
  viewer.openT = 1.0;
  viewer.updateKinematics(1000, 0.016);

  assert.ok(
    Math.abs(leftHingePivot.rotation.y - (-Math.PI / 2)) < 1e-5,
    `Left door must swing -90°, got ${leftHingePivot.rotation.y}`
  );
  assert.ok(
    Math.abs(rightHingePivot.rotation.y - (+Math.PI / 2)) < 1e-5,
    `Right door must swing +90°, got ${rightHingePivot.rotation.y}`
  );

  viewer.destroy();
});

test('5.2 Single left-door and right-door swing around respective outer hinges', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1600, depth: 500 },
    columns: [
      { id: 'col0', width: 500, height: 1600, root: { id: 'leftD', type: 'shelf', front: 'left-door' } },
      { id: 'col1', width: 500, height: 1600, root: { id: 'rightD', type: 'shelf', front: 'right-door' } },
    ],
  };

  const layout = computeLayout(project);
  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  const pivots = [];
  viewer.group.traverse((obj) => {
    if (obj.isGroup && obj.userData?.kind === 'door-swinging') pivots.push(obj);
  });

  assert.equal(pivots.length, 2);

  const pLeft = pivots.find((p) => p.userData.piece.nodeId === 'leftD');
  const pRight = pivots.find((p) => p.userData.piece.nodeId === 'rightD');

  assert.equal(pLeft.userData.side, 'left-hinge');
  assert.equal(pRight.userData.side, 'right-hinge');

  viewer.setRenderMode('open');
  viewer.openT = 1.0;
  viewer.updateKinematics(1000, 0.016);

  assert.ok(Math.abs(pLeft.rotation.y - (-Math.PI / 2)) < 1e-5);
  assert.ok(Math.abs(pRight.rotation.y - (+Math.PI / 2)) < 1e-5);

  viewer.destroy();
});

// ============================================================================
// 6. EXPLODE MODE OFFSETS FOR INDEPENDENT TOP CAPS
// ============================================================================

test('6.1 Independent top caps across unequal column heights all explode upward with +E_BASE * 0.8', () => {
  const project = {
    settings: {
      ...DEFAULTS,
      height: 1400,
      overhang: 20,
      thickness: 18,
      depth: 500,
    },
    columns: [
      // Col 0 is short (800mm), Col 1 is tall (2200mm)
      // cy = maxH / 2 = 1100mm. Col 0 top cap is at y=782mm, BELOW the center cy!
      { id: 'col0', width: 600, height: 800, root: M.leaf('shelf') },
      { id: 'col1', width: 800, height: 2200, root: M.leaf('shelf') },
    ],
  };

  const layout = computeLayout(project);
  assert.equal(layout.maxH, 2200);

  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  // Switch to explode mode
  viewer.setRenderMode('explode');
  viewer.explodeT = 1.0;
  viewer.explodeDist = 1.0;
  viewer.updateKinematics(1000, 0.016);

  const S = 0.001;
  const t = layout.settings.thickness;
  const E_BASE = 180;
  const expectedUpwardOffset = E_BASE * 0.8 * S; // 0.144 m

  const topCaps = [];
  viewer.group.traverse((obj) => {
    if (obj.isMesh && obj.userData?.piece?.name === 'Tapa superior') {
      topCaps.push(obj);
    }
  });

  assert.equal(topCaps.length, 2);

  const cap0 = topCaps.find((m) => m.userData.piece.col === 0);
  const cap1 = topCaps.find((m) => m.userData.piece.col === 1);

  // Rest centers:
  const restY0 = (800 - t + t / 2) * S; // 0.791 m
  const restY1 = (2200 - t + t / 2) * S; // 2.191 m

  // Even though Col 0 top cap is below cy (1100mm), it must explode UPWARD by +0.144m
  const expectedExplodedY0 = restY0 + expectedUpwardOffset;
  const expectedExplodedY1 = restY1 + expectedUpwardOffset;

  assert.ok(
    Math.abs(cap0.position.y - expectedExplodedY0) < 1e-5,
    `Col 0 top cap must explode upward to ${expectedExplodedY0}, got ${cap0.position.y}`
  );
  assert.ok(
    Math.abs(cap1.position.y - expectedExplodedY1) < 1e-5,
    `Col 1 top cap must explode upward to ${expectedExplodedY1}, got ${cap1.position.y}`
  );

  // Also verify bases explode downward by -0.144m
  const bases = [];
  viewer.group.traverse((obj) => {
    if (obj.isMesh && obj.userData?.piece?.name === 'Base') bases.push(obj);
  });
  assert.equal(bases.length, 2);
  bases.forEach((b) => {
    const restBaseY = (0 + t / 2) * S;
    const expectedExplodedBaseY = restBaseY - expectedUpwardOffset;
    assert.ok(
      Math.abs(b.position.y - expectedExplodedBaseY) < 1e-5,
      `Base must explode downward to ${expectedExplodedBaseY}, got ${b.position.y}`
    );
  });

  viewer.destroy();
});

// ============================================================================
// 7. MULTI-COLUMN TOPOLOGIES & THEME SWITCHING
// ============================================================================

test('7.1 Three-column stepped layout (700mm, 1400mm, 2100mm) top caps, shared laterals, and camera framing', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1400, overhang: 20, thickness: 18, depth: 400 },
    columns: [
      { id: 'col0', width: 400, height: 700, root: M.leaf('shelf') },
      { id: 'col1', width: 500, height: 1400, root: M.leaf('shelf') },
      { id: 'col2', width: 600, height: 2100, root: M.leaf('shelf') },
    ],
  };

  const layout = computeLayout(project);
  assert.equal(layout.maxH, 2100);

  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  // 3 independent top caps
  const caps = [];
  viewer.group.traverse((obj) => {
    if (obj.isMesh && obj.userData?.piece?.name === 'Tapa superior') caps.push(obj);
  });
  assert.equal(caps.length, 3);
  caps.sort((a, b) => a.userData.piece.col - b.userData.piece.col);

  assert.equal(caps[0].userData.piece.y, 700 - 18);
  assert.equal(caps[1].userData.piece.y, 1400 - 18);
  assert.equal(caps[2].userData.piece.y, 2100 - 18);

  // 4 laterals with heights:
  // Lat 0: 700 + 40 = 740
  // Lat 1 (shared 0-1): max(700, 1400) + 40 = 1440
  // Lat 2 (shared 1-2): max(1400, 2100) + 40 = 2140
  // Lat 3: 2100 + 40 = 2140
  const laterals = [];
  viewer.group.traverse((obj) => {
    if (obj.isMesh && obj.userData?.piece?.kind === 'side') laterals.push(obj);
  });
  assert.equal(laterals.length, 4);
  laterals.sort((a, b) => a.userData.piece.col - b.userData.piece.col);
  assert.equal(laterals[0].userData.piece.sy, 740);
  assert.equal(laterals[1].userData.piece.sy, 1440);
  assert.equal(laterals[2].userData.piece.sy, 2140);
  assert.equal(laterals[3].userData.piece.sy, 2140);

  // Floor elevation matches maxH (2100)
  assert.equal(viewer.floorShadow.position.y, -(2100 * 0.001) / 2);

  viewer.destroy();
});

test('7.2 Multiple drawer units across different stepped columns partition independently by nodeId and drawerIndex', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1800, depth: 450 },
    columns: [
      { id: 'col0', width: 500, height: 900, root: { id: 'dCol0', type: 'drawer', count: 2 } }, // 2 drawers
      { id: 'col1', width: 600, height: 1800, root: { id: 'dCol1', type: 'drawer', count: 3 } }, // 3 drawers
    ],
  };

  const layout = computeLayout(project);
  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  const drawerGroups = [];
  viewer.group.traverse((obj) => {
    if (obj.isGroup && obj.userData?.isDrawerGroup) drawerGroups.push(obj);
  });

  assert.equal(drawerGroups.length, 5, 'Total 5 drawer groups (2 in col0, 3 in col1)');

  const col0Drawers = drawerGroups.filter((g) => g.userData.nodeId === 'dCol0').sort((a, b) => a.userData.drawerIndex - b.userData.drawerIndex);
  const col1Drawers = drawerGroups.filter((g) => g.userData.nodeId === 'dCol1').sort((a, b) => a.userData.drawerIndex - b.userData.drawerIndex);

  assert.equal(col0Drawers.length, 2);
  assert.equal(col1Drawers.length, 3);

  // Col 0: 2 drawers -> idx 0: 0.75, idx 1: 0.35
  assert.equal(col0Drawers[0].userData.openRatio, 0.75);
  assert.equal(col0Drawers[1].userData.openRatio, 0.35);

  // Col 1: 3 drawers -> idx 0: 0.75, idx 1: 0.55, idx 2: 0.35
  assert.equal(col1Drawers[0].userData.openRatio, 0.75);
  assert.equal(col1Drawers[1].userData.openRatio, 0.55);
  assert.equal(col1Drawers[2].userData.openRatio, 0.35);

  viewer.destroy();
});

test('7.3 Visual theme switching (realistic to neon) preserves stepped 3D geometry and maxH floor alignment', () => {
  const project = {
    settings: { ...DEFAULTS, height: 1200, depth: 500 },
    columns: [
      { id: 'col0', width: 600, height: 900, root: M.leaf('shelf') },
      { id: 'col1', width: 600, height: 1900, root: M.leaf('shelf') },
    ],
  };

  const layout = computeLayout(project);
  const container = new MockElement('div');
  const viewer = new Viewer(container);
  viewer.update(layout);

  const initialFloorY = viewer.floorShadow.position.y;
  assert.equal(initialFloorY, -(1900 * 0.001) / 2);

  // Switch theme to neon
  viewer.setVisualTheme('neon');
  assert.equal(viewer.getVisualTheme(), 'neon');
  assert.equal(viewer.floorGrid.visible, true);
  assert.equal(viewer.floorShadow.position.y, initialFloorY, 'Floor position preserved across theme changes');

  // Verify materials updated to neon palette without re-creating scene
  let checkedMesh = 0;
  viewer.group.traverse((obj) => {
    if (obj.isMesh && obj.userData?.piece) {
      assert.equal(obj.material.roughness, 0.88);
      checkedMesh++;
    }
  });
  assert.ok(checkedMesh > 0);

  viewer.destroy();
});

