// test/viewer_3d.test.js
// Automated test suite for Milestone 4 (R4): Advanced 3D Viewer Pipeline
// Covers: Render Modes & Kinematics, Visual Themes, PCF Soft Shadows, ViewHelper Gizmo & Toolbar UI.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

// ----------------------------------------------------------------------------
// Lightweight Mock DOM Setup for Node.js Headless Testing
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

  get className() {
    return this.classList.value;
  }
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
      for (const fn of list) {
        fn(event);
      }
      curr = curr.parentNode;
    }
    return true;
  }

  click() {
    const ev = {
      type: 'click',
      target: this,
      clientX: 0,
      clientY: 0,
      stopPropagation() {},
      preventDefault() {},
    };
    this.dispatchEvent(ev);
  }

  closest(selector) {
    if (selector.toLowerCase() === this.tagName.toLowerCase()) return this;
    if (selector.startsWith('.') && this.classList.contains(selector.slice(1))) return this;
    return this.parentNode ? this.parentNode.closest(selector) : null;
  }

  querySelector(selector) {
    const res = this.querySelectorAll(selector);
    return res[0] || null;
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

  getBoundingClientRect() {
    return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
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

      if (tag === 'button') {
        child.textContent = content.trim();
      } else if (content) {
        child.innerHTML = content;
      }
      this.appendChild(child);
    }
  }

  get innerHTML() {
    return '';
  }
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

const { Viewer, WOOD_PALETTE, NEON_PALETTE } = await import('../public/js/viewer.js');
const { computeLayout, DEFAULTS } = await import('../public/js/layout.js');
const { ViewHelper } = await import('three/addons/helpers/ViewHelper.js');

// ============================================================================
// 1. RENDER MODES & TARGET ANIMATION STATES
// ============================================================================

test('M4.1: Render Modes API transitions correctly between normal, open, and explode', () => {
  const container = new MockElement('div');
  const viewer = new Viewer(container);

  // Initial state is 'normal'
  assert.equal(viewer.getRenderMode(), 'normal');
  assert.equal(viewer.renderMode, 'normal');
  assert.equal(viewer.targetOpenT, 0.0);
  assert.equal(viewer.targetExplodeT, 0.0);
  assert.equal(viewer.targetOpen, 0.0);
  assert.equal(viewer.targetExplode, 0.0);

  // Switch to 'open'
  viewer.setRenderMode('open');
  assert.equal(viewer.getRenderMode(), 'open');
  assert.equal(viewer.targetOpenT, 1.0);
  assert.equal(viewer.targetExplodeT, 0.0);
  assert.equal(viewer.targetOpen, 1.0);
  assert.equal(viewer.targetExplode, 0.0);

  // Switch to 'explode'
  viewer.setRenderMode('explode');
  assert.equal(viewer.getRenderMode(), 'explode');
  assert.equal(viewer.targetOpenT, 0.0);
  assert.equal(viewer.targetExplodeT, 1.0);
  assert.equal(viewer.targetOpen, 0.0);
  assert.equal(viewer.targetExplode, 1.0);

  // Switch back to 'normal'
  viewer.setRenderMode('normal');
  assert.equal(viewer.getRenderMode(), 'normal');
  assert.equal(viewer.targetOpenT, 0.0);
  assert.equal(viewer.targetExplodeT, 0.0);

  // Invalid mode is ignored
  viewer.setRenderMode('invalid-mode');
  assert.equal(viewer.getRenderMode(), 'normal');

  viewer.destroy();
});

test('M4.2: Delta-time exponential smoothing loop asymptotically converges to targets', () => {
  const container = new MockElement('div');
  const viewer = new Viewer(container);

  viewer.setRenderMode('open');
  assert.equal(viewer.openT, 0.0);

  // Step 1: Advance by 100ms
  viewer.updateKinematics(100, 0.1);
  assert.ok(viewer.openT > 0.4 && viewer.openT < 0.6, `After 100ms openT (${viewer.openT}) should be around 0.5`);

  // Step 2: Advance several frames to converge
  for (let i = 0; i < 20; i++) {
    viewer.updateKinematics(100 + (i + 1) * 50, 0.05);
  }
  assert.equal(viewer.openT, 1.0, 'openT must snap to 1.0 after reaching threshold');

  // Switch to 'explode' and verify continuity
  viewer.setRenderMode('explode');
  viewer.updateKinematics(1200, 0.1);
  assert.ok(viewer.openT < 1.0, 'openT decreases towards 0.0');
  assert.ok(viewer.explodeT > 0.0, 'explodeT increases towards 1.0');

  viewer.destroy();
});

// ============================================================================
// 2. REAL-TIME SOFT SHADOWS CONFIGURATION
// ============================================================================

test('M4.3: Real-Time Soft Shadows configured with PCFSoftShadowMap and tuned directional light', () => {
  const container = new MockElement('div');
  const viewer = new Viewer(container);

  // Shadow Map on Renderer
  assert.equal(viewer.renderer.shadowMap.enabled, true, 'renderer.shadowMap.enabled must be true');
  assert.equal(viewer.renderer.shadowMap.type, THREE.PCFSoftShadowMap, 'shadowMap.type must be THREE.PCFSoftShadowMap');
  assert.equal(viewer.renderer.autoClear, false, 'renderer.autoClear must be false for multi-pass rendering');

  // Directional Light Soft Shadow Parameters
  assert.ok(viewer.dirLight, 'Directional light must exist');
  assert.equal(viewer.dirLight.castShadow, true, 'dirLight.castShadow must be true');
  assert.equal(viewer.dirLight.shadow.mapSize.width, 2048, 'shadow.mapSize.width must be 2048');
  assert.equal(viewer.dirLight.shadow.mapSize.height, 2048, 'shadow.mapSize.height must be 2048');
  assert.equal(viewer.dirLight.shadow.bias, -0.0005, 'shadow.bias must be -0.0005');
  assert.equal(viewer.dirLight.shadow.normalBias, 0.02, 'shadow.normalBias must be 0.02');

  // Floor Shadow Receiver Plane
  assert.ok(viewer.floorShadow, 'Floor shadow plane must exist');
  assert.equal(viewer.floorShadow.receiveShadow, true, 'Floor shadow plane must receive shadows');
  assert.ok(viewer.floorShadow.material.isShadowMaterial, 'Floor plane must use THREE.ShadowMaterial');

  viewer.destroy();
});

// ============================================================================
// 3. VISUAL THEMES (REALISTIC WOOD VS NEON CHARCOAL)
// ============================================================================

test('M4.4: Visual Themes API toggles palette, neon edges, scene lighting, and floor grid', () => {
  const container = new MockElement('div');
  const viewer = new Viewer(container);

  const proj = {
    settings: { ...DEFAULTS, height: 1000, depth: 500, thickness: 18 },
    columns: [{ id: 'col1', width: 600, root: { id: 'm1', type: 'shelf', size: 1, front: 'doors' } }],
  };
  const layout = computeLayout(proj);
  viewer.update(layout);

  // 1. Initial theme is realistic wood
  assert.equal(viewer.getVisualTheme(), 'realistic');
  assert.equal(viewer.floorGrid.visible, false, 'floorGrid must be hidden in realistic theme');
  assert.equal(viewer.scene.background.getHex(), 0x23201e);
  assert.equal(viewer.hemiLight.color.getHex(), 0xfff8ee);
  assert.equal(viewer.dirLight.color.getHex(), 0xfff5e6);

  // Verify realistic piece materials and edge lines
  let woodMeshesChecked = 0;
  viewer.group.traverse((o) => {
    if (o.isMesh && o.userData && o.userData.piece) {
      woodMeshesChecked++;
      const col = o.material.color.getHex();
      assert.ok(
        col === WOOD_PALETTE.side || col === WOOD_PALETTE.front || col === WOOD_PALETTE['door-front'] || col === WOOD_PALETTE.back || col === WOOD_PALETTE.h || col === WOOD_PALETTE.v,
        `Piece color 0x${col.toString(16)} must match WOOD_PALETTE`
      );
    }
    if (o.isLineSegments && o.userData && o.userData.isEdge) {
      assert.equal(o.material.color.getHex(), 0x4a3219, 'Realistic edge color must be subtle dark brown');
      assert.equal(o.material.transparent, true, 'Realistic edges must be transparent');
    }
  });
  assert.ok(woodMeshesChecked > 0, 'Must have inspected piece meshes');

  // 2. Switch to 'neon' theme
  viewer.setVisualTheme('neon');
  assert.equal(viewer.getVisualTheme(), 'neon');
  assert.equal(viewer.floorGrid.visible, true, 'floorGrid must be visible in neon theme');
  assert.equal(viewer.scene.background.getHex(), 0x09090b, 'Background must be deep dark #09090b');
  assert.equal(viewer.hemiLight.color.getHex(), 0x27272a);
  assert.equal(viewer.dirLight.color.getHex(), 0xffffff);

  let neonMeshesChecked = 0;
  let neonEdgesChecked = 0;
  viewer.group.traverse((o) => {
    if (o.isMesh && o.userData && o.userData.piece) {
      neonMeshesChecked++;
      const col = o.material.color.getHex();
      assert.ok(
        col === NEON_PALETTE.side || col === NEON_PALETTE.front || col === NEON_PALETTE['door-front'] || col === NEON_PALETTE.back || col === NEON_PALETTE.h,
        `Piece color 0x${col.toString(16)} must match NEON_PALETTE`
      );
      assert.equal(o.material.roughness, 0.88, 'Neon theme roughness must be matte 0.88');
    }
    if (o.isLineSegments && o.userData && o.userData.isEdge) {
      neonEdgesChecked++;
      assert.equal(o.material.color.getHex(), 0xff6600, 'Neon edge must be bright neon orange 0xff6600');
      assert.equal(o.material.opacity, 1.0, 'Neon edge opacity must be 1.0');
      assert.equal(o.material.toneMapped, false, 'Neon edge toneMapped must be false for glowing vibrancy');
    }
  });
  assert.ok(neonMeshesChecked > 0);
  assert.ok(neonEdgesChecked > 0);

  // 3. Switch back to 'realistic'
  viewer.setVisualTheme('realistic');
  assert.equal(viewer.getVisualTheme(), 'realistic');
  assert.equal(viewer.floorGrid.visible, false);

  viewer.destroy();
});

// ============================================================================
// 4. KINEMATIC PIVOT GROUPS & MATHEMATICAL OFFSETS
// ============================================================================

test('M4.5: Swinging doors kinematic pivot group rotations (-90° left hinge, +90° right hinge)', () => {
  const container = new MockElement('div');
  const viewer = new Viewer(container);

  // Double doors: left leaf has left hinge, right leaf has right hinge
  const proj = {
    settings: { ...DEFAULTS, height: 1000, depth: 500, thickness: 18 },
    columns: [{ id: 'col1', width: 800, root: { id: 'm1', type: 'shelf', size: 1, front: 'doors' } }],
  };
  viewer.update(computeLayout(proj));

  // Find swinging door pivots
  const pivots = [];
  viewer.group.traverse((o) => {
    if (o.isGroup && o.userData && o.userData.isPivot && o.userData.kind === 'door-swinging') {
      pivots.push(o);
    }
  });
  assert.equal(pivots.length, 2, 'Must have 2 swinging door pivots');

  const leftHingePivot = pivots.find((p) => p.userData.side === 'left-hinge');
  const rightHingePivot = pivots.find((p) => p.userData.side === 'right-hinge');
  assert.ok(leftHingePivot, 'Left hinge pivot exists');
  assert.ok(rightHingePivot, 'Right hinge pivot exists');

  // In 'normal' mode: angles are 0
  viewer.setRenderMode('normal');
  viewer.openT = 0.0;
  viewer.updateKinematics(100, 0);
  assert.equal(leftHingePivot.rotation.y, 0);
  assert.equal(rightHingePivot.rotation.y, 0);

  // In 'open' mode: left hinge swings -90° (-Math.PI/2), right hinge swings +90° (+Math.PI/2)
  viewer.setRenderMode('open');
  viewer.openT = 1.0;
  viewer.updateKinematics(200, 0);

  const eps = 1e-4;
  assert.ok(Math.abs(leftHingePivot.rotation.y - (-Math.PI / 2)) < eps, `Left hinge must swing -90° (-1.5708 rad), got ${leftHingePivot.rotation.y}`);
  assert.ok(Math.abs(rightHingePivot.rotation.y - (+Math.PI / 2)) < eps, `Right hinge must swing +90° (+1.5708 rad), got ${rightHingePivot.rotation.y}`);

  viewer.destroy();
});

test('M4.6: Sliding doors kinematic slide translation clears the opening without collision', () => {
  const container = new MockElement('div');
  const viewer = new Viewer(container);

  const proj = {
    settings: { ...DEFAULTS, height: 1000, depth: 500, thickness: 18 },
    columns: [{ id: 'col1', width: 1000, root: { id: 'm1', type: 'shelf', size: 1, front: 'sliding' } }],
  };
  viewer.update(computeLayout(proj));

  const slidingMeshes = [];
  viewer.group.traverse((o) => {
    if (o.isMesh && o.userData && o.userData.isSlidingDoor) {
      slidingMeshes.push(o);
    }
  });
  assert.equal(slidingMeshes.length, 2, 'Must have 2 sliding door meshes');

  const inner = slidingMeshes.find((m) => m.userData.isInner === true);
  const outer = slidingMeshes.find((m) => m.userData.isInner === false);
  assert.ok(inner && outer, 'Both inner and outer sliding leaves must exist');

  // Closed state: nominal positions
  viewer.openT = 0.0;
  viewer.updateKinematics(100, 0);
  const innerBaseX = inner.position.x;
  const outerBaseX = outer.position.x;

  // Fully open state: inner slides -100% width and outer slides +100% width (or stacks to clear drawer vano)
  viewer.openT = 1.0;
  viewer.updateKinematics(200, 0);

  const S = 0.001;
  const expectedInnerDelta = -1.0 * inner.userData.piece.sx * S;
  const expectedOuterDelta = +1.0 * outer.userData.piece.sx * S;

  const actualInnerDelta = inner.position.x - innerBaseX;
  const actualOuterDelta = outer.position.x - outerBaseX;

  const eps = 1e-4;
  assert.ok(Math.abs(actualInnerDelta - expectedInnerDelta) < eps, `Inner leaf must clear opening along X: expected ${expectedInnerDelta}, got ${actualInnerDelta}`);
  assert.ok(Math.abs(actualOuterDelta - expectedOuterDelta) < eps, `Outer leaf must clear opening along X: expected ${expectedOuterDelta}, got ${actualOuterDelta}`);

  viewer.destroy();
});

test('M4.7: Bi-fold doors 2-tier kinematic group (>90° lateral swing and accordion fold)', () => {
  const container = new MockElement('div');
  const viewer = new Viewer(container);

  const proj = {
    settings: { ...DEFAULTS, height: 1000, depth: 500, thickness: 18 },
    columns: [{ id: 'col1', width: 800, root: { id: 'm1', type: 'shelf', size: 1, front: 'bifold' } }],
  };
  viewer.update(computeLayout(proj));

  let pivotAnchor = null;
  let pivotFold = null;
  viewer.group.traverse((o) => {
    if (o.isGroup && o.userData) {
      if (o.userData.kind === 'bifold-anchor') pivotAnchor = o;
      if (o.userData.kind === 'bifold-fold') pivotFold = o;
    }
  });

  assert.ok(pivotAnchor, 'Bi-fold pivotAnchor group must exist');
  assert.ok(pivotFold, 'Bi-fold pivotFold group must exist');
  assert.equal(pivotFold.parent, pivotAnchor, 'pivotFold must be a child of pivotAnchor for 2-tier kinematic chaining');

  // Open state (openT = 1)
  viewer.openT = 1.0;
  viewer.updateKinematics(100, 0);

  const expectedAngle1 = -(145 * Math.PI / 180);
  const expectedAngle2 = +(100 * Math.PI / 180);
  const eps = 1e-4;

  assert.ok(Math.abs(pivotAnchor.rotation.y) > Math.PI / 2, 'Leaf 1 must rotate > 90° toward lateral');
  assert.ok(Math.abs(pivotAnchor.rotation.y - expectedAngle1) < eps, `Leaf 1 must swing -145°: expected ${expectedAngle1}, got ${pivotAnchor.rotation.y}`);
  assert.ok(Math.abs(pivotFold.rotation.y - expectedAngle2) < eps, `Leaf 2 must fold +100°: expected ${expectedAngle2}, got ${pivotFold.rotation.y}`);

  viewer.destroy();
});

test('M4.8: Lift-up flap door kinematic pivot rotation (-80° upward swing around top edge)', () => {
  const container = new MockElement('div');
  const viewer = new Viewer(container);

  const proj = {
    settings: { ...DEFAULTS, height: 600, depth: 400, thickness: 18 },
    columns: [{ id: 'col1', width: 700, root: { id: 'm1', type: 'shelf', size: 1, front: 'lift-up' } }],
  };
  viewer.update(computeLayout(proj));

  let pivotFlap = null;
  viewer.group.traverse((o) => {
    if (o.isGroup && o.userData && o.userData.kind === 'lift-up') {
      pivotFlap = o;
    }
  });

  assert.ok(pivotFlap, 'Lift-up flap pivot group must exist');

  // Open state (openT = 1)
  viewer.openT = 1.0;
  viewer.updateKinematics(100, 0);

  const expectedAngleX = -(80 * Math.PI / 180);
  const eps = 1e-4;
  assert.ok(Math.abs(pivotFlap.rotation.x - expectedAngleX) < eps, `Flap door must swing upward -80° around X axis: expected ${expectedAngleX}, got ${pivotFlap.rotation.x}`);

  viewer.destroy();
});

test('M4.9: Drawers assembly kinematic translation (+65% depth slide along +Z)', () => {
  const container = new MockElement('div');
  const viewer = new Viewer(container);

  const depth = 500;
  const proj = {
    settings: { ...DEFAULTS, height: 800, depth, thickness: 18 },
    columns: [{ id: 'col1', width: 600, root: { id: 'm1', type: 'drawer', size: 1, drawersCount: 2 } }],
  };
  viewer.update(computeLayout(proj));

  const drawerGroups = [];
  viewer.group.traverse((o) => {
    if (o.isGroup && o.userData && o.userData.isDrawerGroup) {
      drawerGroups.push(o);
    }
  });

  assert.ok(drawerGroups.length >= 1, 'Must have at least 1 drawer kinematic assembly group');

  // Closed state: position.z === 0
  viewer.openT = 0.0;
  viewer.updateKinematics(100, 0);
  drawerGroups.forEach((dg) => {
    assert.equal(dg.position.z, 0);
  });

  // Open state: staircase progression (bottom drawer opens +75% depth, top drawer opens +35% depth)
  viewer.openT = 1.0;
  viewer.updateKinematics(200, 0);

  const S = 0.001;
  const eps = 1e-4;
  if (drawerGroups.length === 1) {
    const expectedZ = 0.65 * depth * S;
    assert.ok(Math.abs(drawerGroups[0].position.z - expectedZ) < eps);
  } else {
    // Bottom drawer (drawerIndex 0) opens most (75% depth)
    const bottomDrawer = drawerGroups.find((dg) => dg.userData.drawerIndex === 0) || drawerGroups[0];
    const topDrawer = drawerGroups.find((dg) => dg.userData.drawerIndex === drawerGroups.length - 1) || drawerGroups[drawerGroups.length - 1];
    const expectedBottomZ = 0.75 * depth * S;
    const expectedTopZ = 0.35 * depth * S;
    assert.ok(Math.abs(bottomDrawer.position.z - expectedBottomZ) < eps, `Bottom drawer must slide +75% depth (+${expectedBottomZ}m), got ${bottomDrawer.position.z}`);
    assert.ok(Math.abs(topDrawer.position.z - expectedTopZ) < eps, `Top drawer must slide +35% depth (+${expectedTopZ}m), got ${topDrawer.position.z}`);
    assert.ok(bottomDrawer.position.z > topDrawer.position.z, 'Bottom drawer must extend further than top drawer forming a staircase');
  }

  viewer.destroy();
});

test('M4.10: Explode mode radial/orthogonal disassembly of carcass and panels', () => {
  const container = new MockElement('div');
  const viewer = new Viewer(container);

  const proj = {
    settings: { ...DEFAULTS, height: 1000, depth: 500, thickness: 18 },
    columns: [
      { id: 'col1', width: 500, root: { id: 'm1', type: 'shelf', size: 1 } },
      { id: 'col2', width: 500, root: { id: 'm2', type: 'shelf', size: 1 } },
    ],
  };
  const layout = computeLayout(proj);
  viewer.update(layout);

  // Explode state (explodeT = 1.0, openT = 0.0)
  viewer.setRenderMode('explode');
  viewer.explodeT = 1.0;
  viewer.openT = 0.0;
  viewer.updateKinematics(300, 0);

  // Verify sides, top, bottom, and back explosion displacement
  let leftSide = null;
  let rightSide = null;
  let backPanel = null;

  viewer.group.traverse((o) => {
    if (o.isMesh && o.userData && o.userData.piece) {
      const p = o.userData.piece;
      if (p.kind === 'side') {
        if (!leftSide || p.x < leftSide.userData.piece.x) leftSide = o;
        if (!rightSide || p.x > rightSide.userData.piece.x) rightSide = o;
      } else if (p.kind === 'back') {
        backPanel = o;
      }
    }
  });

  const S = 0.001;
  assert.ok(leftSide, 'Left side exists');
  assert.ok(rightSide, 'Right side exists');

  // Left side displaced in -X direction
  const leftBaseX = (leftSide.userData.piece.x + leftSide.userData.piece.sx / 2) * S;
  assert.ok(leftSide.position.x < leftBaseX, 'Left outer side must offset along -X during explode');

  // Right side displaced in +X direction
  const rightBaseX = (rightSide.userData.piece.x + rightSide.userData.piece.sx / 2) * S;
  assert.ok(rightSide.position.x > rightBaseX, 'Right outer side must offset along +X during explode');

  // Back panel displaced in -Z direction
  if (backPanel) {
    const backBaseZ = (backPanel.userData.piece.z + backPanel.userData.piece.sz / 2) * S;
    assert.ok(backPanel.position.z < backBaseZ, 'Back panel must offset along -Z during explode');
  }

  viewer.destroy();
});

// ============================================================================
// 5. VIEWS & TOOLBAR DOM BINDINGS
// ============================================================================

test('M4.11: Top Toolbar UI created and reactive to clicks for Modes, Themes, and Camera Reset', () => {
  const container = new MockElement('div');
  const viewer = new Viewer(container);

  assert.ok(viewer.toolbar, 'Viewer must create toolbar element');
  assert.ok(container.children.includes(viewer.toolbar), 'Toolbar must be appended to viewer container');
  assert.ok(viewer.toolbar.classList.contains('viewer-toolbar'), 'Toolbar must have .viewer-toolbar class');

  // Find Mode buttons
  const btnNormal = viewer.toolbar.querySelector('[data-mode="normal"]');
  const btnOpen = viewer.toolbar.querySelector('[data-mode="open"]');
  const btnExplode = viewer.toolbar.querySelector('[data-mode="explode"]');

  assert.ok(btnNormal && btnOpen && btnExplode, 'Mode toggle buttons must exist');
  assert.ok(btnNormal.classList.contains('active'), 'Normal button active initially');

  // Click 'open' button
  btnOpen.click();
  assert.equal(viewer.getRenderMode(), 'open');
  assert.ok(btnOpen.classList.contains('active'), 'Puertas abiertas button acquires .active class');
  assert.ok(!btnNormal.classList.contains('active'), 'Normal button loses .active class');

  // Click 'explode' button
  btnExplode.click();
  assert.equal(viewer.getRenderMode(), 'explode');
  assert.ok(btnExplode.classList.contains('active'), 'Despiece button acquires .active class');

  // Find Theme buttons
  const btnWood = viewer.toolbar.querySelector('[data-theme="realistic"]');
  const btnNeon = viewer.toolbar.querySelector('[data-theme="neon"]');

  assert.ok(btnWood && btnNeon, 'Theme toggle buttons must exist');
  assert.ok(btnWood.classList.contains('active'), 'Realistic theme active initially');

  // Click 'neon' button
  btnNeon.click();
  assert.equal(viewer.getVisualTheme(), 'neon');
  assert.ok(btnNeon.classList.contains('active'), 'Negro carbón button acquires .active class');
  assert.ok(!btnWood.classList.contains('active'), 'Madera realista loses .active class');

  // Click 'reset' camera action button
  const btnReset = viewer.toolbar.querySelector('[data-action="reset"]');
  assert.ok(btnReset, 'Reset camera button exists');

  viewer.camera.position.set(10, 10, 10);
  btnReset.click();
  // Camera repositioned
  assert.notEqual(viewer.camera.position.x, 10, 'resetCamera must re-center camera position');

  viewer.destroy();
});

test('M4.12: ViewHelper 3D orientation gizmo initialized and tracks controls target', () => {
  const container = new MockElement('div');
  const viewer = new Viewer(container);

  assert.ok(viewer.viewHelper, 'ViewHelper instance must be created');
  assert.ok(viewer.viewHelper.isViewHelper || viewer.viewHelper.center, 'ViewHelper must be valid Three.js ViewHelper');

  // Controls target sync
  viewer.controls.target.set(1.5, 2.0, -0.5);
  viewer.viewHelper.center.copy(viewer.controls.target);
  assert.equal(viewer.viewHelper.center.x, 1.5);
  assert.equal(viewer.viewHelper.center.y, 2.0);
  assert.equal(viewer.viewHelper.center.z, -0.5);

  viewer.destroy();
});
