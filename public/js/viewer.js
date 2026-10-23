import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';

// ============================================================================
// THEME PALETTES & CONSTANTS (R4 Spec)
// ============================================================================
export const WOOD_PALETTE = {
  side: 0xd4a373,
  h: 0xd4a373,
  v: 0xd4a373,
  front: 0xc89666,
  'door-front': 0xc89666,
  back: 0xbe8c5c,
  drawer: 0xdeb887,
  rail: 0xd4d8dc,
  default: 0xd4a373,
};

export const NEON_PALETTE = {
  side: 0x141416,
  h: 0x141416,
  v: 0x141416,
  front: 0x18181b,
  'door-front': 0x18181b,
  back: 0x101012,
  drawer: 0x1f1f23,
  rail: 0x27272a,
  default: 0x141416,
};

// Legacy fallback palette
export const COLORS = {
  side: 0x2f6fd1,
  h: 0x2fcf6a,
  v: 0x2fcf6a,
  front: 0xe0a81c,
  'door-front': 0xe0a81c,
  back: 0x8a8a8a,
  drawer: 0xb9bcc0,
  rail: 0xd8dde3,
};

function createHeadlessRenderer() {
  const dom = {
    clientWidth: 800,
    clientHeight: 600,
    offsetWidth: 800,
    offsetHeight: 600,
    style: {},
    appendChild() {},
    removeChild() {},
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
    },
  };
  return {
    domElement: dom,
    shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap },
    autoClear: false,
    setPixelRatio() {},
    setSize() {},
    render() {},
    clear() {},
    clearDepth() {},
    getViewport(v) {
      if (v && v.set) v.set(0, 0, 800, 600);
      return v;
    },
    setViewport() {},
    dispose() {},
  };
}

export class Viewer {
  constructor(el, options = {}) {
    this.el = el;
    this.theme = 'realistic'; // 'realistic' | 'neon'
    this.renderMode = 'normal'; // 'normal' | 'open' | 'explode'
    this.explode = 0.6;
    this.explodeDist = 0.6;
    this.hideFronts = false;
    this.fitted = false;
    this.last = null;
    this.lastLayout = null;
    this.layout = null;
    this.running = true;

    // Kinematic animation interpolation targets
    this.targetOpenT = 0.0;
    this.openT = 0.0;
    this.targetExplodeT = 0.0;
    this.explodeT = 0.0;
    this.kinematicNodes = [];
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // 1. WebGL Renderer with PCFSoftShadowMap & Secondary Multi-Pass support
    let renderer = options.renderer;
    if (!renderer) {
      if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        try {
          renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, ...(options.rendererOptions || {}) });
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        } catch {
          renderer = createHeadlessRenderer();
        }
      } else {
        renderer = createHeadlessRenderer();
      }
    }
    this.renderer = renderer;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;

    if (el && this.renderer.domElement && el.appendChild) {
      if (el.style) {
        const currentPos = typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
          ? window.getComputedStyle(el)?.position
          : el.style.position;
        if (!currentPos || currentPos === 'static') {
          el.style.position = 'relative';
        }
      }
      el.appendChild(this.renderer.domElement);
    }

    // 2. Scene & Initial Background
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x23201e);

    // 3. Perspective Camera & Controls
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    this.camera.position.set(2.2, 1.6, 3.2);

    if (this.renderer.domElement) {
      try {
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
      } catch {
        this.controls = { update() {}, target: new THREE.Vector3(), enabled: true };
      }
    } else {
      this.controls = { update() {}, target: new THREE.Vector3(), enabled: true };
    }

    // 4. Studio Lighting Pipeline
    this.hemiLight = new THREE.HemisphereLight(0xfff8ee, 0x3a3530, 1.0);
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfff5e6, 1.8);
    this.dirLight.position.set(2.5, 4.5, 3.5);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 25;
    this.dirLight.shadow.bias = -0.0005;
    this.dirLight.shadow.normalBias = 0.02;
    this.scene.add(this.dirLight);

    // Subtle fill light for realistic ambient contrast
    this.fillLight = new THREE.DirectionalLight(0xcad4e0, 0.35);
    this.fillLight.position.set(-3.5, 2.0, -2.5);
    this.scene.add(this.fillLight);

    // 5. Furniture Mesh Root Group
    this.group = new THREE.Group();
    this.scene.add(this.group);

    // 6. Ground Shadow Receiver & Dotted Floor Grid
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.4 });
    this.floorShadow = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), shadowMat);
    this.floorShadow.rotation.x = -Math.PI / 2;
    this.floorShadow.receiveShadow = true;
    this.scene.add(this.floorShadow);

    this.floorGrid = new THREE.GridHelper(10, 40, 0x3f3f46, 0x1f1f23);
    this.floorGrid.position.y = 0.0005;
    this.floorGrid.visible = false;
    this.scene.add(this.floorGrid);

    // 7. Interactive 3D Orientation Gizmo (ViewHelper)
    this.viewHelper = null;
    if (typeof document !== 'undefined' && this.renderer.domElement) {
      try {
        this.viewHelper = new ViewHelper(this.camera, this.renderer.domElement);
        if (this.viewHelper.setLabels) {
          this.viewHelper.setLabels('X', 'Y', 'Z');
        }
        if (this.viewHelper.setLabelStyle) {
          this.viewHelper.setLabelStyle('bold 22px system-ui, sans-serif', '#ffffff', 14);
        }
      } catch {
        this.viewHelper = null;
      }
    }

    // Pointer click raycasting filter for ViewHelper
    if (this.renderer.domElement && this.renderer.domElement.addEventListener) {
      let pointerDownPos = { x: 0, y: 0 };
      this.renderer.domElement.addEventListener('pointerdown', (e) => {
        pointerDownPos = { x: e.clientX, y: e.clientY };
      });

      this.renderer.domElement.addEventListener('pointerup', (e) => {
        const dx = Math.abs(e.clientX - pointerDownPos.x);
        const dy = Math.abs(e.clientY - pointerDownPos.y);
        if (dx < 6 && dy < 6 && this.viewHelper) {
          if (this.viewHelper.handleClick && this.viewHelper.handleClick(e)) {
            e.stopPropagation();
          }
        }
      });
    }

    // 8. Floating Top Toolbar UI
    this.toolbar = null;
    if (this.el && typeof document !== 'undefined' && document.createElement) {
      this.buildToolbar();
    }

    // 9. Resize Observer
    this.resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined' && this.el) {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.el);
    }

    // 10. 60 FPS Render & Animation Loop
    const raf = typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame
      : (fn) => setTimeout(() => fn(performance.now()), 16);

    const clock = new THREE.Clock();
    const loop = () => {
      if (!this.running) return;
      const delta = clock.getDelta();
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

      // Kinematic smoothing step
      this.updateKinematics(now, delta);

      // ViewHelper camera slerp handling
      if (this.viewHelper && this.viewHelper.animating) {
        if (this.controls) this.controls.enabled = false;
        this.viewHelper.update(delta);
        if (!this.viewHelper.animating && this.controls) {
          this.controls.enabled = true;
          this.controls.update();
        }
      } else if (this.controls) {
        this.controls.update();
      }

      // Sync gizmo center with controls target
      if (this.viewHelper && this.controls && this.controls.target) {
        this.viewHelper.center.copy(this.controls.target);
      }

      // Render main scene with autoClear = false multi-pass
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);

      // Render ViewHelper 128x128 gizmo pass in bottom-right corner
      if (this.viewHelper && this.viewHelper.render) {
        this.viewHelper.render(this.renderer);
      }

      raf(loop);
    };
    raf(loop);
  }

  // Kinematic alias accessors for multi-naming compatibility
  get openProgress() { return this.openT; }
  set openProgress(v) { this.openT = v; }
  get targetOpen() { return this.targetOpenT; }
  set targetOpen(v) { this.targetOpenT = v; }
  get explodeProgress() { return this.explodeT; }
  set explodeProgress(v) { this.explodeT = v; }
  get targetExplode() { return this.targetExplodeT; }
  set targetExplode(v) { this.targetExplodeT = v; }
  get layout() { return this._layout || this.lastLayout; }
  set layout(v) { this._layout = v; this.lastLayout = v; }

  /* ---------------- Top Toolbar UI ---------------- */
  buildToolbar() {
    if (!this.el || typeof document === 'undefined') return;
    const tb = document.createElement('div');
    tb.className = 'viewer-toolbar';
    tb.innerHTML = `
      <div class="viewer-btn-group vtoolbar-group" data-group="mode">
        <button type="button" class="viewer-btn vbtn active" data-mode="normal" title="Mueble cerrado (Normal)">Normal</button>
        <button type="button" class="viewer-btn vbtn" data-mode="open" title="Puertas y gavetas abiertas">Puertas abiertas</button>
        <button type="button" class="viewer-btn vbtn" data-mode="explode" title="Despiece tridimensional">Despiece</button>
      </div>
      <div class="viewer-toolbar-divider vtoolbar-divider"></div>
      <div class="viewer-btn-group vtoolbar-group" data-group="theme">
        <button type="button" class="viewer-btn vbtn active" data-theme="realistic" title="Madera realista">Madera realista</button>
        <button type="button" class="viewer-btn vbtn" data-theme="neon" title="Negro carbón con aristas naranja">Negro carbón</button>
      </div>
      <div class="viewer-toolbar-divider vtoolbar-divider"></div>
      <div class="viewer-btn-group vtoolbar-group" data-group="actions">
        <button type="button" class="viewer-btn vbtn viewer-btn-action vbtn-action" data-action="reset" title="Restablecer cámara y enfocar">Enfocar</button>
      </div>
    `;

    const stop = (e) => {
      if (e && e.stopPropagation) e.stopPropagation();
    };
    tb.addEventListener('pointerdown', stop);
    tb.addEventListener('mousedown', stop);
    tb.addEventListener('click', (e) => {
      stop(e);
      const target = e.target;
      const btn = target?.closest ? target.closest('button') : (target?.tagName === 'BUTTON' ? target : null);
      if (!btn || !btn.dataset) return;
      if (btn.dataset.mode) {
        this.setRenderMode(btn.dataset.mode);
      } else if (btn.dataset.theme) {
        this.setVisualTheme(btn.dataset.theme);
      } else if (btn.dataset.action === 'reset') {
        this.resetCamera();
      }
    });

    this.el.appendChild(tb);
    this.toolbar = tb;
  }

  updateToolbarActiveStates() {
    if (!this.toolbar || !this.toolbar.querySelectorAll) return;
    this.toolbar.querySelectorAll('[data-mode]').forEach((b) => {
      const isActive = b.dataset?.mode === this.renderMode;
      if (b.classList && b.classList.toggle) {
        b.classList.toggle('active', isActive);
      }
    });
    this.toolbar.querySelectorAll('[data-theme]').forEach((b) => {
      const isActive = b.dataset?.theme === this.theme;
      if (b.classList && b.classList.toggle) {
        b.classList.toggle('active', isActive);
      }
    });
  }

  /* ---------------- Render Mode API ---------------- */
  setRenderMode(mode) {
    if (mode !== 'normal' && mode !== 'open' && mode !== 'explode') return;
    this.renderMode = mode;
    if (mode === 'normal') {
      this.targetOpenT = 0.0;
      this.targetExplodeT = 0.0;
    } else if (mode === 'open') {
      this.targetOpenT = 1.0;
      this.targetExplodeT = 0.0;
    } else if (mode === 'explode') {
      this.targetOpenT = 0.0;
      this.targetExplodeT = 1.0;
    }
    this.updateToolbarActiveStates();
  }

  getRenderMode() {
    return this.renderMode;
  }

  /* ---------------- Visual Themes API ---------------- */
  setVisualTheme(theme) {
    if (theme !== 'realistic' && theme !== 'neon') return;
    this.theme = theme;
    const isNeon = theme === 'neon';

    if (isNeon) {
      this.scene.background.setHex(0x09090b);
      this.hemiLight.color.setHex(0x27272a);
      this.hemiLight.groundColor.setHex(0x09090b);
      this.hemiLight.intensity = 0.6;
      this.dirLight.color.setHex(0xffffff);
      this.dirLight.intensity = 1.4;
      this.floorGrid.visible = true;
    } else {
      this.scene.background.setHex(0x23201e);
      this.hemiLight.color.setHex(0xfff8ee);
      this.hemiLight.groundColor.setHex(0x3a3530);
      this.hemiLight.intensity = 1.0;
      this.dirLight.color.setHex(0xfff5e6);
      this.dirLight.intensity = 1.8;
      this.floorGrid.visible = false;
    }

    // In-place material and edge update without geometry re-generation
    this.group.traverse((o) => {
      if (o.isMesh && o.userData && o.userData.piece) {
        const p = o.userData.piece;
        const sel = o.userData.selected;
        const col = isNeon
          ? (NEON_PALETTE[p.kind] || NEON_PALETTE[p.role] || NEON_PALETTE.default)
          : (WOOD_PALETTE[p.kind] || WOOD_PALETTE[p.role] || WOOD_PALETTE.default);
        o.material.color.setHex(col);
        o.material.roughness = isNeon ? 0.88 : (p.kind === 'rail' ? 0.25 : 0.65);
        o.material.metalness = p.kind === 'rail' ? (isNeon ? 0.6 : 0.8) : (isNeon ? 0.08 : 0.05);
        o.material.emissive.setHex(sel ? (isNeon ? 0xff6600 : 0xffaa00) : 0x000000);
        o.material.emissiveIntensity = sel ? 0.6 : 0;
        o.material.needsUpdate = true;
      }
      if (o.isLineSegments && o.userData && o.userData.isEdge) {
        o.material.color.setHex(isNeon ? 0xff6600 : 0x4a3219);
        o.material.opacity = isNeon ? 1.0 : 0.25;
        o.material.transparent = !isNeon;
        o.material.toneMapped = false;
        o.material.needsUpdate = true;
      }
    });

    this.updateToolbarActiveStates();
  }

  getVisualTheme() {
    return this.theme;
  }

  /* ---------------- Camera Reset API ---------------- */
  resetCamera() {
    const S = 0.001;
    const layout = this.layout || this.lastLayout;
    if (!layout) {
      this.camera.position.set(2.2, 1.6, 3.2);
      if (this.controls && this.controls.target) this.controls.target.set(0, 0, 0);
      return;
    }
    const maxH = this.layout?.maxH || (this.layout?.colHeights?.length ? Math.max(...this.layout.colHeights) : this.layout?.settings?.height || 1400);
    const W = layout.totalW * S;
    const H = maxH * S;
    const D = (layout.settings?.depth || 500) * S;
    const size = Math.max(W, H, D);
    if (this.controls && this.controls.target) {
      this.controls.target.set(0, 0, 0);
    }
    this.camera.position.set(size * 1.1, size * 0.8, size * 1.8);
    this.camera.lookAt(0, 0, 0);
    if (this.controls && this.controls.update) {
      this.controls.update();
    }
    if (this.viewHelper) {
      this.viewHelper.center.set(0, 0, 0);
    }
  }

  /* ---------------- Kinematics 60fps Smoothing ---------------- */
  updateKinematics(now, delta) {
    const dt = delta !== undefined ? delta : Math.min(((now || performance.now()) - this.lastTime) / 1000, 0.1);
    this.lastTime = now || (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Delta-time exponential smoothing factor: 1 - exp(-speed * dt)
    const alpha = 1.0 - Math.exp(-7.0 * dt);

    this.openT += (this.targetOpenT - this.openT) * alpha;
    this.explodeT += (this.targetExplodeT - this.explodeT) * alpha;

    // Numerical snap to target
    if (Math.abs(this.openT - this.targetOpenT) < 0.0005) this.openT = this.targetOpenT;
    if (Math.abs(this.explodeT - this.targetExplodeT) < 0.0005) this.explodeT = this.targetExplodeT;

    const oT = this.openT;
    const eT = this.explodeT;
    const exMul = this.explodeDist;

    for (let i = 0; i < this.kinematicNodes.length; i++) {
      this.kinematicNodes[i](oT, eT, exMul);
    }
  }

  resize() {
    const w = this.el?.clientWidth || 800;
    const h = this.el?.clientHeight || 600;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  destroy() {
    this.running = false;
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.toolbar) this.toolbar.remove();
    if (this.viewHelper && this.viewHelper.dispose) this.viewHelper.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement && this.renderer.domElement.remove) {
      this.renderer.domElement.remove();
    }
  }

  setExplode(v) {
    this.explode = v;
    this.explodeDist = v;
    if (this.renderMode === 'explode') {
      this.targetExplodeT = 1.0;
    } else {
      if (this.last) this.update(...this.last);
    }
  }

  setHideFronts(v) {
    this.hideFronts = v;
    if (this.last) this.update(...this.last);
  }

  /* ---------------- Scene Graph Builder ---------------- */
  update(layout, selectedIds = new Set()) {
    this.last = [layout, selectedIds];
    this.lastLayout = layout;
    this.layout = layout;
    this.kinematicNodes = [];

    // Dispose old resources
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    this.group.clear();

    const S = 0.001; // mm to meters
    const maxH = layout.maxH || (layout.colHeights?.length ? Math.max(...layout.colHeights) : layout.settings.height);
    const H = maxH;
    const D = layout.settings.depth;
    const W = layout.totalW;
    const cx = W / 2;
    const cy = H / 2;
    const cz = D / 2;
    const E_BASE = 180; // base explosion displacement in mm
    const isNeon = this.theme === 'neon';

    // Dynamic shadow camera frustum packing
    const maxDim = Math.max(W, H, D) * S;
    const extent = Math.max(1.5, maxDim * 0.9);
    this.dirLight.shadow.camera.left = -extent;
    this.dirLight.shadow.camera.right = extent;
    this.dirLight.shadow.camera.top = extent;
    this.dirLight.shadow.camera.bottom = -extent;
    if (this.dirLight.shadow.camera.updateProjectionMatrix) {
      this.dirLight.shadow.camera.updateProjectionMatrix();
    }

    // Floor receiver and grid elevation
    const yBase = -(H * S) / 2;
    this.floorShadow.position.y = yBase;
    this.floorGrid.position.y = yBase + 0.0005;

    // Helper: Material creator
    const makeMat = (p) => {
      const sel = p.nodeId && selectedIds.has(p.nodeId);
      const col = isNeon
        ? (NEON_PALETTE[p.kind] || NEON_PALETTE[p.role] || NEON_PALETTE.default)
        : (WOOD_PALETTE[p.kind] || WOOD_PALETTE[p.role] || WOOD_PALETTE.default);
      return new THREE.MeshStandardMaterial({
        color: col,
        roughness: isNeon ? 0.88 : (p.kind === 'rail' ? 0.25 : 0.65),
        metalness: p.kind === 'rail' ? (isNeon ? 0.6 : 0.8) : (isNeon ? 0.08 : 0.05),
        emissive: sel ? (isNeon ? 0xff6600 : 0xffaa00) : 0x000000,
        emissiveIntensity: sel ? (isNeon ? 0.6 : 0.55) : 0,
      });
    };

    // Helper: LineSegments edges creator
    const addEdges = (mesh, geo) => {
      const edgeGeo = new THREE.EdgesGeometry(geo);
      const edgeMat = new THREE.LineBasicMaterial({
        color: isNeon ? 0xff6600 : 0x4a3219,
        linewidth: isNeon ? 2 : 1,
        transparent: !isNeon,
        opacity: isNeon ? 1.0 : 0.25,
        toneMapped: false,
      });
      const edges = new THREE.LineSegments(edgeGeo, edgeMat);
      edges.userData = { isEdge: true };
      mesh.add(edges);
    };

    // Partition pieces into drawer assemblies vs other pieces
    const drawerGroupsMap = new Map();
    const otherPieces = [];

    layout.pieces.forEach((p) => {
      if (this.hideFronts && (p.kind === 'front' || p.kind === 'door-front')) return;
      if (p.kind === 'drawer' || (p.kind === 'front' && p.name === 'Frente de gaveta')) {
        const key = p.drawerIndex !== undefined
          ? `${p.nodeId}_${p.drawerIndex}`
          : `${p.nodeId}_${Math.round(p.y / 15) * 15}`;
        let dg = drawerGroupsMap.get(key);
        if (!dg) {
          dg = { nodeId: p.nodeId, col: p.col ?? 0, y: p.y, drawerIndex: p.drawerIndex, pieces: [] };
          drawerGroupsMap.set(key, dg);
        }
        dg.pieces.push(p);
      } else {
        otherPieces.push(p);
      }
    });

    // 1. Process Drawer Assemblies (Kinematic group with staircase progression from bottom to top)
    // Group drawers by horizontal X-overlap so vertically stacked drawers always form a staircase
    // whether they belong to the same module (count > 1) or separate adjacent/nested modules.
    const drawersByStack = [];
    drawerGroupsMap.forEach((dg) => {
      const cell = layout.cells && layout.cells[dg.nodeId];
      const minX = cell ? cell.x : Math.min(...dg.pieces.map((p) => p.x));
      const maxX = cell ? cell.x + cell.w : Math.max(...dg.pieces.map((p) => p.x + p.sx));
      const minY = Math.min(...dg.pieces.map((p) => p.y));
      const maxY = Math.max(...dg.pieces.map((p) => p.y + p.sy));
      dg.minX = minX;
      dg.maxX = maxX;
      dg.minY = minY;
      dg.maxY = maxY;
      dg.centerY = (minY + maxY) / 2;

      let targetStack = drawersByStack.find((stack) => {
        const ref = stack[0];
        if ((ref.col ?? 0) !== (dg.col ?? 0)) return false;
        const overlapX = Math.min(ref.maxX, dg.maxX) - Math.max(ref.minX, dg.minX);
        const minWidth = Math.min(ref.maxX - ref.minX, dg.maxX - dg.minX);
        return overlapX > Math.max(10, minWidth * 0.5);
      });
      if (!targetStack) {
        targetStack = [];
        drawersByStack.push(targetStack);
      }
      targetStack.push(dg);
    });

    drawersByStack.forEach((list) => {
      // Sort drawers vertically from bottom (lowest Y) to top (highest Y)
      list.sort((a, b) => {
        if (a.nodeId === b.nodeId && a.drawerIndex !== undefined && b.drawerIndex !== undefined) {
          return a.drawerIndex - b.drawerIndex;
        }
        if (Math.abs(a.centerY - b.centerY) > 1) {
          return a.centerY - b.centerY;
        }
        return a.y - b.y;
      });
      const N = list.length;

      list.forEach((dg, idx) => {
        // Cascading staircase: bottom drawer (idx 0) opens most (75%), top drawer opens least (35%)
        // If single drawer, opens 65% depth
        const openRatio = N > 1 ? (0.75 - (idx / (N - 1)) * 0.40) : 0.65;

        const dGroup = new THREE.Group();
        dGroup.userData = {
          isDrawerGroup: true,
          pieces: dg.pieces,
          nodeId: dg.nodeId,
          drawerIndex: idx,
          moduleDrawerIndex: dg.drawerIndex !== undefined ? dg.drawerIndex : idx,
          drawerCount: N,
          openRatio,
        };
        this.group.add(dGroup);

        dg.pieces.forEach((p) => {
          const geo = new THREE.BoxGeometry(p.sx * S, p.sy * S, p.sz * S);
          const mat = makeMat(p);
          const mesh = new THREE.Mesh(geo, mat);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.position.set((p.x + p.sx / 2) * S, (p.y + p.sy / 2) * S, (p.z + p.sz / 2) * S);
          mesh.userData = { piece: p, selected: p.nodeId && selectedIds.has(p.nodeId) };
          addEdges(mesh, geo);
          dGroup.add(mesh);
        });

        this.kinematicNodes.push((oT, eT, exMul) => {
          const openOffsetZ = openRatio * D * oT * S;
          const explodeOffsetZ = 1.0 * E_BASE * exMul * eT * S;
          dGroup.position.set(0, 0, openOffsetZ + explodeOffsetZ);
        });
      });
    });

    // 2. Identify Bi-Fold Door Pairs
    const bifoldPairs = new Map();
    otherPieces.forEach((p) => {
      if (p.kind === 'door-front' && (p.side === 'bifold-anchor' || p.side === 'bifold-fold')) {
        let pair = bifoldPairs.get(p.nodeId);
        if (!pair) {
          pair = {};
          bifoldPairs.set(p.nodeId, pair);
        }
        if (p.side === 'bifold-anchor') pair.anchor = p;
        else pair.fold = p;
      }
    });

    const handledPieces = new Set();

    // 3. Process Bi-Fold Doors (2-Tier Kinematic Pivot Chain)
    bifoldPairs.forEach((pair) => {
      if (!pair.anchor || !pair.fold) return;
      const p1 = pair.anchor;
      const p2 = pair.fold;
      handledPieces.add(p1);
      handledPieces.add(p2);

      const pcx = (p1.x + p2.x + p2.sx) / 2;
      const pcy = p1.y + p1.sy / 2;
      const expOx = Math.sign(pcx - cx) * E_BASE * 0.2;
      const expOz = E_BASE * 1.5;

      // Pivot 1: Anchored at left stile of Leaf 1
      const pivotAnchor = new THREE.Group();
      pivotAnchor.position.set(p1.x * S, (p1.y + p1.sy / 2) * S, (p1.z + p1.sz / 2) * S);
      pivotAnchor.userData = { isPivot: true, kind: 'bifold-anchor', piece: p1 };
      this.group.add(pivotAnchor);

      // Leaf 1 Mesh: offset by +sx/2 from left hinge
      const geo1 = new THREE.BoxGeometry(p1.sx * S, p1.sy * S, p1.sz * S);
      const mesh1 = new THREE.Mesh(geo1, makeMat(p1));
      mesh1.castShadow = true;
      mesh1.receiveShadow = true;
      mesh1.position.set((p1.sx / 2) * S, 0, 0);
      mesh1.userData = { piece: p1, selected: p1.nodeId && selectedIds.has(p1.nodeId) };
      addEdges(mesh1, geo1);
      pivotAnchor.add(mesh1);

      // Pivot 2: Parented to Pivot 1 at the hinge seam (x = +p1.sx)
      const pivotFold = new THREE.Group();
      pivotFold.position.set(p1.sx * S, 0, 0);
      pivotFold.userData = { isPivot: true, kind: 'bifold-fold', piece: p2 };
      pivotAnchor.add(pivotFold);

      // Leaf 2 Mesh: offset by +sx/2 from folding hinge
      const geo2 = new THREE.BoxGeometry(p2.sx * S, p2.sy * S, p2.sz * S);
      const mesh2 = new THREE.Mesh(geo2, makeMat(p2));
      mesh2.castShadow = true;
      mesh2.receiveShadow = true;
      mesh2.position.set((p2.sx / 2) * S, 0, 0);
      mesh2.userData = { piece: p2, selected: p2.nodeId && selectedIds.has(p2.nodeId) };
      addEdges(mesh2, geo2);
      pivotFold.add(mesh2);

      this.kinematicNodes.push((oT, eT, exMul) => {
        pivotAnchor.position.set(
          (p1.x + expOx * exMul * eT) * S,
          (p1.y + p1.sy / 2) * S,
          (p1.z + p1.sz / 2 + expOz * exMul * eT) * S
        );
        // Leaf 1 swings open > 90° (-145°) toward the lateral to clear the opening
        pivotAnchor.rotation.y = -(145 * Math.PI / 180) * oT;
        // Leaf 2 folds +100° (> 90°) accordion-style so both leaves clear the lateral edge
        pivotFold.rotation.y = +(100 * Math.PI / 180) * oT;
      });
    });

    // 4. Process Remaining Pieces
    otherPieces.forEach((p) => {
      if (handledPieces.has(p)) return;

      const pcx = p.x + p.sx / 2;
      const pcy = p.y + p.sy / 2;
      const pcz = p.z + p.sz / 2;

      // Compute Explode Displacements (in mm)
      let expOx = 0, expOy = 0, expOz = 0;

      if (p.kind === 'side') {
        expOx = Math.sign(pcx - cx) * E_BASE * 0.9;
      } else if (p.kind === 'h') {
        if (p.name === 'Tapa superior') {
          expOy = E_BASE * 0.8;
        } else if (p.name === 'Base') {
          expOy = -E_BASE * 0.8;
        } else {
          expOy = cy > 0 ? ((pcy - cy) / cy) * E_BASE * 0.4 : 0;
        }
      } else if (p.kind === 'v') {
        expOx = ((pcx - cx) / cx) * E_BASE * 0.4;
      } else if (p.kind === 'back') {
        expOz = -E_BASE * 0.6;
      } else if (p.kind === 'rail') {
        expOy = ((pcy - cy) / cy) * E_BASE * 0.3;
      } else if (p.kind === 'door-front' || p.kind === 'front') {
        expOz = E_BASE * 1.5;
        expOx = Math.sign(pcx - cx) * E_BASE * 0.2;
      }

      const geo = new THREE.BoxGeometry(p.sx * S, p.sy * S, p.sz * S);
      const mat = makeMat(p);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { piece: p, selected: p.nodeId && selectedIds.has(p.nodeId) };
      addEdges(mesh, geo);

      // --- Swinging Doors ---
      if (p.kind === 'door-front' && (p.side === 'right' || p.side === 'left')) {
        // In layout.js, p.side is handle position: handle on right -> hinge on left edge (x = p.x)
        const isLeftHinge = p.side === 'right';
        const pivot = new THREE.Group();
        pivot.userData = { isPivot: true, kind: 'door-swinging', side: isLeftHinge ? 'left-hinge' : 'right-hinge', piece: p };
        this.group.add(pivot);

        const hingeX = isLeftHinge ? p.x : p.x + p.sx;
        const hingeY = pcy;
        const hingeZ = pcz;

        mesh.position.set(isLeftHinge ? (p.sx / 2) * S : -(p.sx / 2) * S, 0, 0);
        pivot.add(mesh);

        this.kinematicNodes.push((oT, eT, exMul) => {
          pivot.position.set(
            (hingeX + expOx * exMul * eT) * S,
            (hingeY + expOy * exMul * eT) * S,
            (hingeZ + expOz * exMul * eT) * S
          );
          // Left hinge swings -90°, Right hinge swings +90°
          const targetAngle = isLeftHinge ? -Math.PI / 2 : +Math.PI / 2;
          const angle = targetAngle * oT;
          pivot.rotation.y = Math.abs(angle) < 1e-9 ? 0 : angle;
        });

      // --- Sliding Doors ---
      } else if (p.kind === 'door-front' && (p.side === 'sliding-inner' || p.side === 'sliding-outer')) {
        const isInner = p.side === 'sliding-inner';
        mesh.userData.isSlidingDoor = true;
        mesh.userData.isInner = isInner;
        this.group.add(mesh);

        const innerLeaf = isInner
          ? p
          : otherPieces.find((op) => op.nodeId === p.nodeId && op.side === 'sliding-inner') || p;
        const outerLeaf = !isInner
          ? p
          : otherPieces.find((op) => op.nodeId === p.nodeId && op.side === 'sliding-outer') || p;
        const vanoMinX = innerLeaf.x;
        const vanoMaxX = outerLeaf.x + outerLeaf.sx;
        const vanoMidX = (vanoMinX + vanoMaxX) / 2;
        const t = layout.settings?.thickness || 18;

        const coveredDrawers = layout.pieces.filter(
          (dp) =>
            (dp.kind === 'drawer' || dp.name === 'Frente de gaveta') &&
            dp.col === p.col &&
            dp.y < p.y + p.sy &&
            dp.y + dp.sy > p.y
        );

        let fullSlideX = (isInner ? -1.0 : +1.0) * p.sx;
        if (coveredDrawers.length > 0) {
          const dMinX = Math.min(...coveredDrawers.map((d) => d.x));
          const dMaxX = Math.max(...coveredDrawers.map((d) => d.x + d.sx));
          if (dMaxX <= vanoMidX + t) {
            // Gavetas en el vano izquierdo: estacionar ambas hojas a la derecha despejando el vano
            fullSlideX = isInner
              ? Math.max(outerLeaf.x - innerLeaf.x, dMaxX + 6 - innerLeaf.x)
              : Math.max(0, dMaxX + 6 - outerLeaf.x);
          } else if (dMinX >= vanoMidX - t) {
            // Gavetas en el vano derecho: estacionar ambas hojas a la izquierda despejando el vano
            fullSlideX = isInner
              ? Math.min(0, dMinX - 6 - (innerLeaf.x + innerLeaf.sx))
              : Math.min(innerLeaf.x - outerLeaf.x, dMinX - 6 - (outerLeaf.x + outerLeaf.sx));
          } else {
            // Gavetas de ancho completo: despejar completamente el vano hacia ambos lados
            fullSlideX = isInner
              ? (dMinX - 6) - (innerLeaf.x + innerLeaf.sx)
              : (dMaxX + 6) - outerLeaf.x;
          }
        }

        this.kinematicNodes.push((oT, eT, exMul) => {
          const slideX = fullSlideX * oT;
          mesh.position.set(
            (pcx + slideX + expOx * exMul * eT) * S,
            (pcy + expOy * exMul * eT) * S,
            (pcz + expOz * exMul * eT) * S
          );
        });

      // --- Lift-Up Flap Door ---
      } else if (p.kind === 'door-front' && p.side === 'lift-up') {
        const pivot = new THREE.Group();
        pivot.userData = { isPivot: true, kind: 'lift-up', piece: p };
        this.group.add(pivot);

        const hingeX = pcx;
        const hingeY = p.y + p.sy; // Top horizontal edge
        const hingeZ = pcz;

        mesh.position.set(0, -(p.sy / 2) * S, 0);
        pivot.add(mesh);

        this.kinematicNodes.push((oT, eT, exMul) => {
          pivot.position.set(
            (hingeX + expOx * exMul * eT) * S,
            (hingeY + expOy * exMul * eT) * S,
            (hingeZ + expOz * exMul * eT) * S
          );
          // Swings upward -80° around X axis
          pivot.rotation.x = -(80 * Math.PI / 180) * oT;
        });

      // --- Static Carcass / Panels (Displaced only in Explode state) ---
      } else {
        this.group.add(mesh);
        this.kinematicNodes.push((oT, eT, exMul) => {
          mesh.position.set(
            (pcx + expOx * exMul * eT) * S,
            (pcy + expOy * exMul * eT) * S,
            (pcz + expOz * exMul * eT) * S
          );
        });
      }
    });

    // Center entire furniture group around (0, 0, 0)
    this.group.position.set(-cx * S, yBase, -(layout.settings.depth / 2) * S);

    // Initial camera fit
    if (!this.fitted) {
      this.resetCamera();
      this.fitted = true;
    }

    // Immediately evaluate kinematics for current frame
    this.updateKinematics(typeof performance !== 'undefined' ? performance.now() : Date.now(), 0.016);
  }
}
