import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as THREE from 'three';
import { PDFDocument } from 'pdf-lib';
import { computeLayout, DEFAULTS } from '../public/js/layout.js';

// Set up minimal DOM mocks before importing Viewer
if (typeof globalThis.document === 'undefined') {
  class MockElement {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.style = {};
      this.children = [];
      this.dataset = {};
      this.className = '';
      this.listeners = {};
      this.classList = {
        _set: new Set(),
        add: (...cls) => cls.forEach((c) => this.classList._set.add(c)),
        remove: (...cls) => cls.forEach((c) => this.classList._set.delete(c)),
        toggle: (c, force) => {
          const shouldAdd = force !== undefined ? force : !this.classList._set.has(c);
          if (shouldAdd) this.classList._set.add(c);
          else this.classList._set.delete(c);
          return shouldAdd;
        },
        contains: (c) => this.classList._set.has(c),
      };
    }
    get clientWidth() { return 800; }
    get clientHeight() { return 600; }
    appendChild(child) {
      child.parentElement = this;
      this.children.push(child);
      return child;
    }
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) this.children.splice(idx, 1);
      return child;
    }
    remove() {
      if (this.parentElement) {
        this.parentElement.removeChild(this);
      }
    }
    addEventListener(ev, fn) {
      (this.listeners[ev] = this.listeners[ev] || []).push(fn);
    }
    removeEventListener() {}
    setAttribute() {}
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    }
    querySelector() { return null; }
    querySelectorAll() { return []; }
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
  globalThis.document = {
    createElement(tag) {
      if (tag === 'canvas') return new MockCanvas();
      return new MockElement(tag);
    },
    createElementNS(_ns, tag) {
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
const { app, db } = await import('../server/server.js');

// ============================================================================
// TAREA 1: GAVETAS INTERNAS EN MÓDULOS CON PUERTAS (z = D - t - 10mm)
// ============================================================================

test('Tarea 1: Módulos con puertas (front: doors) permiten gavetas interiores retranqueadas a z = D - t - 10mm', () => {
  const D = 550;
  const t = 18;
  const expectedZ = D - t - 10; // 522 mm

  // Caso A: Módulo contenedor con front: 'doors' e hijos tipo 'drawer'
  const projContainer = {
    settings: { ...DEFAULTS, height: 2000, depth: D, thickness: t },
    columns: [
      {
        id: 'col1',
        width: 800,
        root: {
          id: 'mod_doors',
          type: 'multiple',
          dir: 'v',
          size: 1,
          front: 'doors',
          children: [
            { id: 'upper_rail', type: 'rail', size: 1200 },
            { id: 'inner_drawers', type: 'drawer', size: 700, count: 3 },
          ],
        },
      },
    ],
  };

  const layoutA = computeLayout(projContainer);
  const doorPiecesA = layoutA.pieces.filter((p) => p.kind === 'door-front');
  const drawerFrontsA = layoutA.pieces.filter((p) => p.name === 'Frente de gaveta');
  const drawerSidesA = layoutA.pieces.filter((p) => p.name === 'Lateral de gaveta');

  assert.equal(doorPiecesA.length, 2, 'Debe generar las 2 hojas de puerta batiente');
  assert.equal(drawerFrontsA.length, 3, 'No debe suprimir las 3 gavetas interiores bajo coveredByDoor');
  assert.equal(drawerSidesA.length, 6, 'Debe generar los 6 laterales de las 3 gavetas interiores');
  assert.equal(layoutA.hardware.slides, 3, 'Debe contabilizar los 3 juegos de correderas');

  for (const df of drawerFrontsA) {
    assert.equal(
      df.z,
      expectedZ,
      `El frente de gaveta interior debe estar retranqueado en z = D - t - 10 (${expectedZ}mm), obtenido: ${df.z}mm`
    );
  }

  // Caso B: Módulo directo { type: 'drawer', front: 'doors' }
  const projDirect = {
    settings: { ...DEFAULTS, height: 900, depth: D, thickness: t },
    columns: [
      {
        id: 'col1',
        width: 600,
        root: { id: 'direct_drawer_doors', type: 'drawer', count: 2, size: 1, front: 'doors' },
      },
    ],
  };

  const layoutB = computeLayout(projDirect);
  const doorPiecesB = layoutB.pieces.filter((p) => p.kind === 'door-front');
  const drawerFrontsB = layoutB.pieces.filter((p) => p.name === 'Frente de gaveta');

  assert.equal(doorPiecesB.length, 2, 'Módulo directo con front: doors debe generar 2 puertas');
  assert.equal(drawerFrontsB.length, 2, 'Módulo directo con front: doors debe generar las 2 gavetas internas');
  for (const df of drawerFrontsB) {
    assert.equal(df.z, expectedZ, `Frente de gaveta retranqueado a z = ${expectedZ}mm`);
  }
});

// ============================================================================
// TAREA 2: CINEMÁTICA SIN COLISIÓN EN MODO OPEN (CORREDERAS Y ACORDEÓN > 90°)
// ============================================================================

test('Tarea 2: Puertas correderas despejan el vano de las gavetas y puertas acordeón giran > 90° hacia el lateral sin colisión', () => {
  // 1. Puertas correderas con gavetas en el vano izquierdo
  const projSliding = {
    settings: { ...DEFAULTS, height: 1800, depth: 550, thickness: 18 },
    columns: [
      {
        id: 'col_slide',
        width: 1200,
        root: {
          id: 'm_slide',
          type: 'multiple',
          dir: 'h',
          size: 1,
          front: 'sliding',
          children: [
            { id: 'left_drawers', type: 'drawer', count: 3, size: 600 },
            { id: 'right_shelf', type: 'shelf', size: 600 },
          ],
        },
      },
    ],
  };

  const container1 = globalThis.document.createElement('div');
  const viewer1 = new Viewer(container1);
  const layoutSlide = computeLayout(projSliding);
  viewer1.update(layoutSlide);
  viewer1.setRenderMode('open');
  viewer1.openT = 1.0;
  viewer1.updateKinematics(200, 0);
  viewer1.scene.updateMatrixWorld(true);

  const slidingDoors = [];
  const drawerGroups1 = [];
  viewer1.group.traverse((o) => {
    if (o.isMesh && o.userData?.isSlidingDoor) slidingDoors.push(o);
    if (o.isGroup && o.userData?.isDrawerGroup) drawerGroups1.push(o);
  });

  assert.equal(slidingDoors.length, 2, 'Deben existir 2 hojas de puerta corredera');
  assert.equal(drawerGroups1.length, 3, 'Deben existir 3 grupos cinemáticos de gavetas internas');

  for (const door of slidingDoors) {
    const doorBox = new THREE.Box3().setFromObject(door);
    for (const dg of drawerGroups1) {
      const drawerBox = new THREE.Box3().setFromObject(dg);
      assert.equal(
        doorBox.intersectsBox(drawerBox),
        false,
        `La puerta corredera (${door.userData.piece.side}) no debe colisionar con la gaveta abierta #${dg.userData.drawerIndex}`
      );
    }
  }
  viewer1.destroy();

  // 2. Puertas acordeón (bifold) giran > 90° hacia el lateral y despejan gavetas internas
  const projBifold = {
    settings: { ...DEFAULTS, height: 1600, depth: 550, thickness: 18 },
    columns: [
      {
        id: 'col_bifold',
        width: 800,
        root: {
          id: 'm_bifold',
          type: 'multiple',
          dir: 'v',
          size: 1,
          front: 'bifold',
          children: [
            { id: 'top_rail', type: 'rail', size: 900 },
            { id: 'bot_drawers', type: 'drawer', count: 2, size: 600 },
          ],
        },
      },
    ],
  };

  const container2 = globalThis.document.createElement('div');
  const viewer2 = new Viewer(container2);
  const layoutBifold = computeLayout(projBifold);
  viewer2.update(layoutBifold);
  viewer2.setRenderMode('open');
  viewer2.openT = 1.0;
  viewer2.updateKinematics(200, 0);
  viewer2.scene.updateMatrixWorld(true);

  let pivotAnchor = null;
  let pivotFold = null;
  const drawerGroups2 = [];
  viewer2.group.traverse((o) => {
    if (o.isGroup && o.userData?.kind === 'bifold-anchor') pivotAnchor = o;
    if (o.isGroup && o.userData?.kind === 'bifold-fold') pivotFold = o;
    if (o.isGroup && o.userData?.isDrawerGroup) drawerGroups2.push(o);
  });

  assert.ok(pivotAnchor && pivotFold, 'Deben existir los pivotes bifold-anchor y bifold-fold');
  assert.ok(
    Math.abs(pivotAnchor.rotation.y) > Math.PI / 2,
    `La puerta acordeón debe girar > 90° (${(Math.abs(pivotAnchor.rotation.y) * 180 / Math.PI).toFixed(1)}°) hacia el lateral`
  );
  assert.ok(
    Math.abs(pivotFold.rotation.y) > Math.PI / 2,
    `La hoja plegable debe girar > 90° (${(Math.abs(pivotFold.rotation.y) * 180 / Math.PI).toFixed(1)}°)`
  );

  const bifoldBox = new THREE.Box3().setFromObject(pivotAnchor);
  for (const dg of drawerGroups2) {
    const drawerBox = new THREE.Box3().setFromObject(dg);
    assert.equal(
      bifoldBox.intersectsBox(drawerBox),
      false,
      `Las puertas acordeón abiertas no deben colisionar con la gaveta interna #${dg.userData.drawerIndex}`
    );
  }
  viewer2.destroy();

  // 3. Apertura de escalera en gavetas apiladas en distintos módulos adyacentes vs mismo módulo
  const projStaircaseAdjacent = {
    settings: { ...DEFAULTS, height: 2100, depth: 550, thickness: 18 },
    columns: [
      {
        id: 'col_same_mod',
        width: 750,
        root: {
          id: 'm_c1',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            { id: 'c1_rail', type: 'rail', size: 1400 },
            { id: 'c1_drawers', type: 'drawer', size: 600, count: 3 },
          ],
        },
      },
      {
        id: 'col_adj_mods',
        width: 750,
        root: {
          id: 'm_c2',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            { id: 'c2_rail', type: 'rail', size: 1400 },
            { id: 'c2_d_top', type: 'drawer', size: 200, count: 1 },
            { id: 'c2_d_mid', type: 'drawer', size: 200, count: 1 },
            { id: 'c2_d_bot', type: 'drawer', size: 200, count: 1 },
          ],
        },
      },
    ],
  };

  const container3 = globalThis.document.createElement('div');
  const viewer3 = new Viewer(container3);
  viewer3.update(computeLayout(projStaircaseAdjacent));
  viewer3.setRenderMode('open');
  viewer3.openT = 1.0;
  viewer3.updateKinematics(200, 0);

  const adjGroups = [];
  viewer3.group.traverse((o) => {
    if (o.isGroup && o.userData?.isDrawerGroup && o.userData.nodeId.startsWith('c2_d_')) {
      adjGroups.push(o);
    }
  });

  assert.equal(adjGroups.length, 3, 'Deben existir 3 grupos de gavetas para los 3 módulos adyacentes');
  const botAdj = adjGroups.find((g) => g.userData.nodeId === 'c2_d_bot');
  const midAdj = adjGroups.find((g) => g.userData.nodeId === 'c2_d_mid');
  const topAdj = adjGroups.find((g) => g.userData.nodeId === 'c2_d_top');

  assert.ok(Math.abs(botAdj.userData.openRatio - 0.75) < 1e-4, 'Gaveta inferior adyacente debe abrir al 75%');
  assert.ok(Math.abs(midAdj.userData.openRatio - 0.55) < 1e-4, 'Gaveta media adyacente debe abrir al 55%');
  assert.ok(Math.abs(topAdj.userData.openRatio - 0.35) < 1e-4, 'Gaveta superior adyacente debe abrir al 35%');
  assert.ok(
    botAdj.position.z > midAdj.position.z && midAdj.position.z > topAdj.position.z,
    'Las gavetas en distintos módulos adyacentes deben abrir en escalera (inferior > media > superior)'
  );
  viewer3.destroy();
});

// ============================================================================
// TAREA 3 & TAREA 4: CLIENTES, PRESUPUESTOS CORRELATIVOS Y EXPORTACIÓN PDF
// ============================================================================

test('Tarea 3 y Tarea 4: Tablas clients/quotes, presupuestos correlativos y ruta /api/projects/:id/pdf con pdf-lib', async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Verificar existencia de las tablas clients y quotes en SQLite
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('clients', 'quotes')")
      .all()
      .map((r) => r.name);
    assert.ok(tables.includes('clients'), 'La tabla SQLite clients debe existir');
    assert.ok(tables.includes('quotes'), 'La tabla SQLite quotes debe existir');

    // 2. Registrar un usuario de prueba
    const email = `test_quote_${Date.now()}@maderalocal.cl`;
    const regRes = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Maestro Carpintero', email, password: 'Password123!' }),
    });
    assert.equal(regRes.status, 201);
    const { token } = await regRes.json();
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    // 3. Crear un cliente vía POST /api/clients
    const clientRes = await fetch(`${baseUrl}/api/clients`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'Constructora Andina SpA',
        tax_id: '76.123.456-7',
        email: 'compras@andina.cl',
        phone: '+56 9 5555 4444',
        address: 'Av. Providencia 1234, Santiago',
      }),
    });
    assert.equal(clientRes.status, 201, 'POST /api/clients debe devolver 201');
    const client = await clientRes.json();
    assert.ok(client.id > 0);
    assert.equal(client.name, 'Constructora Andina SpA');
    assert.equal(client.tax_id, '76.123.456-7');

    // 4. Crear un proyecto y asociarlo al cliente
    const projData = {
      settings: { ...DEFAULTS, height: 2000, depth: 550, thickness: 18 },
      columns: [
        {
          id: 'c1',
          width: 800,
          root: {
            id: 'm1',
            type: 'multiple',
            dir: 'v',
            size: 1,
            front: 'doors',
            children: [
              { id: 'r1', type: 'rail', size: 1100 },
              { id: 'd1', type: 'drawer', count: 3, size: 700 },
            ],
          },
        },
      ],
    };

    const projRes = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: 'Closet Ejecutivo Roble', data: projData }),
    });
    assert.equal(projRes.status, 201);
    const project = await projRes.json();

    // Asociar proyecto al cliente mediante PUT /api/projects/:id/client
    const assocRes = await fetch(`${baseUrl}/api/projects/${project.id}/client`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ client_id: client.id }),
    });
    assert.equal(assocRes.status, 200);
    const assocData = await assocRes.json();
    assert.equal(assocData.client_id, client.id);

    // 5. Generar presupuestos correlativos (PRE-0001, PRE-0002, PRE-0003)
    const q1Res = await fetch(`${baseUrl}/api/quotes`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ project_id: project.id }),
    });
    assert.equal(q1Res.status, 201);
    const q1 = await q1Res.json();

    const q2Res = await fetch(`${baseUrl}/api/projects/${project.id}/quotes`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ notes: 'Segunda revisión comercial' }),
    });
    assert.equal(q2Res.status, 201);
    const q2 = await q2Res.json();

    const q3Res = await fetch(`${baseUrl}/api/quotes`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ project_id: project.id }),
    });
    assert.equal(q3Res.status, 201);
    const q3 = await q3Res.json();

    assert.equal(q1.seq, 1);
    assert.equal(q1.quote_number, 'PRE-0001');
    assert.equal(q2.seq, 2);
    assert.equal(q2.quote_number, 'PRE-0002');
    assert.equal(q3.seq, 3);
    assert.equal(q3.quote_number, 'PRE-0003');
    assert.equal(q1.client_id, client.id);
    assert.ok(q1.total > 0, 'El presupuesto debe calcular el monto total automáticamente');

    // 6. Exportar cotización formal en PDF mediante GET /api/projects/:id/pdf
    const pdfRes = await fetch(`${baseUrl}/api/projects/${project.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(pdfRes.status, 200, 'GET /api/projects/:id/pdf debe responder 200 OK');
    assert.ok(
      (pdfRes.headers.get('content-type') || '').includes('application/pdf'),
      'Content-Type debe ser application/pdf'
    );

    const pdfArrayBuffer = await pdfRes.arrayBuffer();
    const pdfBytes = Buffer.from(pdfArrayBuffer);
    assert.ok(pdfBytes.length > 1000, 'El archivo PDF generado no debe estar vacío');
    assert.equal(pdfBytes.subarray(0, 5).toString('ascii'), '%PDF-', 'Debe tener cabecera %PDF- válida');

    // Validar carga con pdf-lib y contenido textual del PDF
    const loadedPdf = await PDFDocument.load(pdfBytes);
    assert.ok(loadedPdf.getPageCount() >= 1, 'El documento PDF debe tener al menos 1 página');

    const rawPdfText = pdfBytes.toString('latin1');
    assert.ok(rawPdfText.includes('MADERA LOCAL'), 'El PDF debe incluir el membrete de MADERA LOCAL');
    assert.ok(rawPdfText.includes('Constructora Andina SpA'), 'El PDF debe incluir el nombre del cliente');
    assert.ok(rawPdfText.includes('76.123.456-7'), 'El PDF debe incluir el RUT/DNI del cliente');
    assert.ok(rawPdfText.includes('PRE-0003'), 'El PDF debe incluir el número de presupuesto correlativo');
    assert.ok(rawPdfText.includes('RESUMEN COMERCIAL'), 'El PDF debe incluir el resumen comercial');
    assert.ok(rawPdfText.includes('LISTA DE CORTES'), 'El PDF debe incluir la lista de cortes');
    assert.ok(rawPdfText.includes('Frente de gaveta'), 'El PDF debe incluir las piezas de la lista de cortes');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
