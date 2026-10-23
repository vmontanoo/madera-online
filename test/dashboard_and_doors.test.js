// test/dashboard_and_doors.test.js
// Automated test suite for Milestone 2: Pre-Designed Demos, JSON Import Validation, and Project CRUD Lifecycle.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeLayout, DEFAULTS } from '../public/js/layout.js';
import { DEMOS, cloneDemoProject, cloneDemoData } from '../public/js/demos.js';
import { normalizeProject, defaultProject } from '../public/js/model.js';

// Setup isolated test database for Project CRUD lifecycle
process.env.NODE_ENV = 'test';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, 'test_dashboard_crud.db');
process.env.DATABASE_PATH = testDbPath;

try {
  fs.unlinkSync(testDbPath);
} catch {}

const { app, db } = await import('../server/server.js');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  try {
    fs.unlinkSync(testDbPath);
  } catch {}
});

// ============================================================================
// 1. PRE-DESIGNED DEMOS CATALOG STRUCTURE & GEOMETRY
// ============================================================================

test('DEMOS catalog contains exactly 4 valid pre-designed models', () => {
  assert.equal(DEMOS.length, 4, 'Must export exactly 4 demo models');
  const ids = DEMOS.map((d) => d.id);
  assert.deepEqual(ids, ['closet-modular', 'mesa-noche', 'centro-tv', 'cocina-bajo']);

  DEMOS.forEach((d) => {
    assert.ok(d.id && typeof d.id === 'string', 'Demo must have string id');
    assert.ok(d.name && typeof d.name === 'string', 'Demo must have string name');
    assert.ok(d.category && typeof d.category === 'string', 'Demo must have string category');
    assert.ok(d.description && typeof d.description === 'string', 'Demo must have string description');
    assert.ok(d.dimensions && typeof d.dimensions === 'string', 'Demo must have string dimensions');
    assert.ok(Array.isArray(d.tags) && d.tags.length > 0, 'Demo must have array of tags');
    assert.ok(d.data && d.data.settings && Array.isArray(d.data.columns), 'Demo must contain valid settings and columns');
  });
});

test('Demo 1: Closet modular completo geometry, pieces and hardware', () => {
  const demo = DEMOS.find((d) => d.id === 'closet-modular');
  assert.ok(demo);
  const l = computeLayout(demo.data);

  // Exact dimensions
  assert.equal(l.totalW, 2022, 'Closet total width must be 2022 mm (750 + 750 + 450 + 4*18)');
  assert.equal(l.settings.height, 2100, 'Closet height must be 2100 mm');
  assert.equal(l.settings.depth, 550, 'Closet depth must be 550 mm');

  // Columns & Carcass panels
  assert.equal(demo.data.columns.length, 3, '3 columns');
  assert.equal(l.pieces.filter((p) => p.name === 'Lateral').length, 4, '4 laterals for 3 columns');

  // Column 1: 3 drawers, 1 rail
  assert.ok(l.hardware.slides >= 3, 'At least 3 slide pairs');
  assert.ok(l.pieces.some((p) => p.kind === 'rail' && p.col === 0), 'Rail in col 1');
  assert.equal(l.pieces.filter((p) => p.name === 'Frente de gaveta').length, 3, '3 drawer fronts');

  // Column 2: double rails
  const col2Rails = l.pieces.filter((p) => p.kind === 'rail' && p.col === 1);
  assert.equal(col2Rails.length, 2, 'Col 2 must contain double rails');

  // Column 3: 5 shelves tower
  const col3Cells = Object.values(l.cells).filter((c) => c.col === 2 && c.type === 'shelf');
  assert.equal(col3Cells.length, 5, 'Col 3 must contain 5 shelves');

  // Cutlist & pricing
  assert.ok(l.cutlist.total > 0, 'Total price must be positive');
  assert.ok(l.cutlist.hardware.some((h) => h.name.includes('perchero')), 'Cutlist includes hanging rails');
  assert.ok(l.cutlist.hardware.some((h) => h.name.includes('Corredera')), 'Cutlist includes slides');
});

test('Demo 2: Mesa de noche moderna geometry and drawers', () => {
  const demo = DEMOS.find((d) => d.id === 'mesa-noche');
  assert.ok(demo);
  const l = computeLayout(demo.data);

  assert.equal(l.totalW, 536, 'Nightstand total width must be 536 mm (500 + 2*18)');
  assert.equal(l.settings.height, 550, 'Height 550 mm');
  assert.equal(l.settings.depth, 400, 'Depth 400 mm');

  assert.equal(demo.data.columns.length, 1, '1 column');
  assert.equal(l.pieces.filter((p) => p.name === 'Lateral').length, 2, '2 laterals');

  // 1 upper niche + 2 drawers
  const colCells = Object.values(l.cells);
  assert.ok(colCells.some((c) => c.type === 'shelf'), 'Upper niche exists');
  assert.ok(colCells.some((c) => c.type === 'drawer'), 'Drawers exist');
  assert.equal(l.hardware.slides, 2, 'Exactly 2 slide pairs');
  assert.equal(l.pieces.filter((p) => p.name === 'Frente de gaveta').length, 2);

  assert.ok(l.cutlist.total > 0, 'Total price must be positive');
});

test('Demo 3: Centro de entretenimiento TV rack geometry and doors', () => {
  const demo = DEMOS.find((d) => d.id === 'centro-tv');
  assert.ok(demo);
  const l = computeLayout(demo.data);

  assert.equal(l.totalW, 1872, 'TV center total width must be 1872 mm (500 + 800 + 500 + 4*18)');
  assert.equal(l.settings.height, 600, 'Height 600 mm');
  assert.equal(l.settings.depth, 420, 'Depth 420 mm');

  assert.equal(demo.data.columns.length, 3, '3 columns');
  assert.equal(l.pieces.filter((p) => p.name === 'Lateral').length, 4, '4 laterals');

  // Left door & Right door
  const doors = l.pieces.filter((p) => p.name === 'Puerta');
  assert.equal(doors.length, 2, '2 doors in lateral cabinets');
  assert.equal(l.hardware.hinges, 4, '4 hinges total (2 per door)');

  // Center drawers
  assert.equal(l.hardware.slides, 2, '2 wide drawers in center bay');
  assert.ok(l.cutlist.total > 0);
});

test('Demo 4: Mueble bajo de cocina modular geometry, triple drawers, and 2-door cabinet', () => {
  const demo = DEMOS.find((d) => d.id === 'cocina-bajo');
  assert.ok(demo);
  const l = computeLayout(demo.data);

  assert.equal(l.totalW, 1254, 'Kitchen base total width must be 1254 mm (450 + 750 + 3*18)');
  assert.equal(l.settings.height, 850, 'Kitchen base height 850 mm');
  assert.equal(l.settings.depth, 580, 'Depth 580 mm');

  assert.equal(demo.data.columns.length, 2, '2 columns');
  assert.equal(l.pieces.filter((p) => p.name === 'Lateral').length, 3, '3 laterals');

  // Col 1: 3 drawers
  assert.equal(l.hardware.slides, 3, '3 slide pairs for triple drawer unit');

  // Col 2: 2-door cabinet with internal shelf
  const doors = l.pieces.filter((p) => p.name === 'Puerta');
  assert.equal(doors.length, 2, '2 swinging doors on 750 mm cabinet');
  assert.equal(l.hardware.hinges, 4, '4 hinges for the 2 doors');

  assert.ok(l.cutlist.total > 0);
});

// ============================================================================
// 2. DEMO CLONING & ID ISOLATION TESTS
// ============================================================================

test('cloneDemoProject creates deep copies with disjoint, unique IDs', () => {
  const clone1 = cloneDemoProject('closet-modular');
  const clone2 = cloneDemoProject('closet-modular');

  assert.ok(clone1 && clone1.name && clone1.data);
  assert.ok(clone2 && clone2.name && clone2.data);

  // Template immutability
  const template = DEMOS.find((d) => d.id === 'closet-modular');
  clone1.data.columns[0].width = 999;
  assert.equal(template.data.columns[0].width, 750, 'Template width must not be mutated');
  assert.equal(clone2.data.columns[0].width, 750, 'Sibling clone must not be mutated');

  // Column IDs must be fresh and unique
  assert.notEqual(clone1.data.columns[0].id, template.data.columns[0].id);
  assert.notEqual(clone1.data.columns[0].id, clone2.data.columns[0].id);

  // Nested root and children IDs must be fresh and unique
  const root1 = clone1.data.columns[0].root;
  const root2 = clone2.data.columns[0].root;
  const rootT = template.data.columns[0].root;
  assert.notEqual(root1.id, rootT.id);
  assert.notEqual(root1.id, root2.id);

  assert.notEqual(root1.children[0].id, rootT.children[0].id);
  assert.notEqual(root1.children[0].id, root2.children[0].id);

  // Invalid ID handling
  assert.equal(cloneDemoProject('non-existent-id'), null);
  assert.equal(cloneDemoProject(null), null);

  // cloneDemoData helper
  const dataOnly = cloneDemoData('mesa-noche');
  assert.ok(dataOnly && dataOnly.settings && dataOnly.columns);
  assert.notEqual(dataOnly.columns[0].id, DEMOS.find((d) => d.id === 'mesa-noche').data.columns[0].id);
});

// ============================================================================
// 3. PROJECT NORMALIZATION & JSON IMPORT VALIDATION TESTS
// ============================================================================

// Standalone validation function matching public/js/app.js logic
function validateProjectData(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('El contenido del proyecto no es un objeto válido.');
  }
  if (!Array.isArray(data.columns) || data.columns.length === 0) {
    throw new Error('El proyecto debe contener un arreglo "columns" con al menos una columna.');
  }

  // Validate settings if provided
  if (data.settings && typeof data.settings === 'object') {
    const requiredPositive = ['height', 'depth', 'thickness'];
    for (const key of requiredPositive) {
      if (data.settings[key] !== undefined) {
        const val = data.settings[key];
        if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) {
          throw new Error(`Ajuste inválido: "settings.${key}" (${val}) debe ser un número positivo mayor que cero.`);
        }
      }
    }
    const nonNegative = ['overhang', 'backThickness', 'frontClearance'];
    for (const key of nonNegative) {
      if (data.settings[key] !== undefined) {
        const val = data.settings[key];
        if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
          throw new Error(`Ajuste inválido: "settings.${key}" (${val}) debe ser un número mayor o igual a cero.`);
        }
      }
    }
  }

  // Validate columns and nodes
  data.columns.forEach((col, idx) => {
    if (!col || typeof col !== 'object') {
      throw new Error(`La columna #${idx + 1} no es un objeto válido.`);
    }
    if (typeof col.width !== 'number' || !Number.isFinite(col.width) || col.width <= 0) {
      throw new Error(`Ancho inválido en columna #${idx + 1}: ${col.width}. Debe ser un número positivo.`);
    }
    if (!col.root || typeof col.root !== 'object') {
      throw new Error(`Estructura incompleta en columna #${idx + 1}: falta el nodo "root".`);
    }

    const checkNode = (node, path) => {
      if (!node || typeof node !== 'object') {
        throw new Error(`Nodo inválido en ${path}.`);
      }
      if (node.size !== undefined) {
        if (typeof node.size !== 'number' || !Number.isFinite(node.size) || node.size <= 0) {
          throw new Error(`Medida (size) inválida en ${path}: ${node.size}. Debe ser un número positivo.`);
        }
      }
      if (node.type === 'drawer' && node.count !== undefined) {
        if (typeof node.count !== 'number' || !Number.isFinite(node.count) || node.count < 1) {
          throw new Error(`Cantidad de gavetas (count) inválida en ${path}: ${node.count}. Debe ser un número mayor o igual a 1.`);
        }
      }
      if (node.children !== undefined) {
        if (!Array.isArray(node.children)) {
          throw new Error(`"children" en ${path} debe ser un arreglo.`);
        }
        node.children.forEach((child, childIdx) => {
          checkNode(child, `${path} > hijo #${childIdx + 1}`);
        });
      }
    };

    checkNode(col.root, `Columna #${idx + 1}`);
  });
}

test('normalizeProject fills defaults and ensures unique IDs', () => {
  const raw = {
    columns: [
      { width: 500, root: { type: 'doors', size: 1 } },
      { width: 600, root: { type: 'shelf', size: 1 } }
    ]
  };

  const norm = normalizeProject(raw);
  assert.ok(norm.settings, 'Settings must be initialized');
  assert.equal(norm.settings.thickness, 18);
  assert.ok(norm.columns[0].id, 'Column 1 must have an id');
  assert.ok(norm.columns[1].id, 'Column 2 must have an id');
  assert.notEqual(norm.columns[0].id, norm.columns[1].id);

  // Door migration
  assert.equal(norm.columns[0].root.type, 'shelf');
  assert.equal(norm.columns[0].root.front, 'doors');
});

test('validateProjectData accepts valid direct project and envelope data', () => {
  const direct = {
    settings: { height: 1200, depth: 500, thickness: 18, overhang: 10 },
    columns: [{ width: 600, root: { id: 'm1', type: 'shelf', size: 100 } }]
  };
  assert.doesNotThrow(() => validateProjectData(direct));

  const envelope = {
    name: 'Mueble Envoltorio',
    data: {
      columns: [{ width: 450, root: { id: 'm2', type: 'drawer', size: 200, count: 2 } }]
    }
  };
  assert.doesNotThrow(() => validateProjectData(envelope.data));
});

test('validateProjectData rejects invalid structures and malformed numbers', () => {
  // Non-object or null
  assert.throws(() => validateProjectData(null), /objeto válido/);
  assert.throws(() => validateProjectData('string'), /objeto válido/);

  // Missing or empty columns
  assert.throws(() => validateProjectData({}), /arreglo "columns"/);
  assert.throws(() => validateProjectData({ columns: [] }), /al menos una columna/);

  // Malformed settings
  assert.throws(
    () => validateProjectData({ settings: { height: -500 }, columns: [{ width: 500, root: {} }] }),
    /Ajuste inválido: "settings.height"/
  );
  assert.throws(
    () => validateProjectData({ settings: { thickness: 'abc' }, columns: [{ width: 500, root: {} }] }),
    /Ajuste inválido: "settings.thickness"/
  );
  assert.throws(
    () => validateProjectData({ settings: { overhang: -10 }, columns: [{ width: 500, root: {} }] }),
    /Ajuste inválido: "settings.overhang"/
  );

  // Malformed column width
  assert.throws(
    () => validateProjectData({ columns: [{ width: 0, root: {} }] }),
    /Ancho inválido en columna #1/
  );
  assert.throws(
    () => validateProjectData({ columns: [{ width: -200, root: {} }] }),
    /Ancho inválido en columna #1/
  );

  // Missing root
  assert.throws(
    () => validateProjectData({ columns: [{ width: 500 }] }),
    /falta el nodo "root"/
  );

  // Malformed node size or drawer count
  assert.throws(
    () => validateProjectData({ columns: [{ width: 500, root: { size: -10 } }] }),
    /Medida \(size\) inválida/
  );
  assert.throws(
    () => validateProjectData({ columns: [{ width: 500, root: { type: 'drawer', count: 0 } }] }),
    /Cantidad de gavetas \(count\) inválida/
  );
});

// ============================================================================
// 4. SQLITE DASHBOARD CRUD LIFECYCLE (CREATE, RENAME, DUPLICATE, DELETE)
// ============================================================================

test('Dashboard project CRUD lifecycle with SQLite database', async () => {
  // 1. Register test user
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Dashboard User', email: 'user@madera-dash.com', password: 'password123' }),
  });
  assert.equal(regRes.status, 201);
  const { token, user } = await regRes.json();
  assert.ok(token);
  assert.equal(user.email, 'user@madera-dash.com');

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  // 2. Initial project list must be empty
  const resList1 = await fetch(`${baseUrl}/api/projects`, { headers: authHeaders });
  assert.equal(resList1.status, 200);
  const list1 = await resList1.json();
  assert.deepEqual(list1, [], 'Initial projects list must be empty');

  // 3. Create blank project (simulating "+ Nuevo mueble")
  const defaultProj = defaultProject();
  const createRes1 = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Sin título', data: defaultProj })
  });
  assert.equal(createRes1.status, 201);
  const p1 = await createRes1.json();
  assert.ok(p1.id, 'Created project must have an id');
  assert.equal(p1.name, 'Sin título');

  // Verify list has 1 project
  const list2 = await (await fetch(`${baseUrl}/api/projects`, { headers: authHeaders })).json();
  assert.equal(list2.length, 1);
  assert.equal(list2[0].id, p1.id);
  assert.equal(list2[0].name, 'Sin título');

  // 4. Rename project (simulating "Renombrar" via PUT /api/projects/:id)
  const renameRes = await fetch(`${baseUrl}/api/projects/${p1.id}`, {
    method: 'PUT',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Closet de Prueba Renombrado' })
  });
  assert.equal(renameRes.status, 200);
  const renameBody = await renameRes.json();
  assert.equal(renameBody.ok, true);

  // Verify list reflects new name
  const list3 = await (await fetch(`${baseUrl}/api/projects`, { headers: authHeaders })).json();
  assert.equal(list3.length, 1);
  assert.equal(list3[0].name, 'Closet de Prueba Renombrado');

  // 5. Duplicate project (simulating "Duplicar" via POST /api/projects/:id/duplicate)
  const dupRes = await fetch(`${baseUrl}/api/projects/${p1.id}/duplicate`, {
    method: 'POST',
    headers: authHeaders
  });
  assert.equal(dupRes.status, 201);
  const dupData = await dupRes.json();
  assert.ok(dupData.id);
  assert.notEqual(dupData.id, p1.id);

  // Verify list now has 2 projects and copy is named '<original> copy'
  const list4 = await (await fetch(`${baseUrl}/api/projects`, { headers: authHeaders })).json();
  assert.equal(list4.length, 2);
  const dupItem = list4.find((item) => item.id === dupData.id);
  assert.ok(dupItem);
  assert.equal(dupItem.name, 'Closet de Prueba Renombrado copy');

  // 6. Create project from pre-designed demo (simulating "Abrir plantilla" on "cocina-bajo")
  const demoClone = cloneDemoProject('cocina-bajo');
  assert.ok(demoClone);
  const demoCreateRes = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(demoClone)
  });
  assert.equal(demoCreateRes.status, 201);
  const demoProjRecord = await demoCreateRes.json();
  assert.ok(demoProjRecord.id);

  // Verify list now has 3 projects
  const list5 = await (await fetch(`${baseUrl}/api/projects`, { headers: authHeaders })).json();
  assert.equal(list5.length, 3);
  assert.ok(list5.some((item) => item.id === demoProjRecord.id && item.name === 'Mueble bajo de cocina modular'));

  // 7. Inspect individual project GET /api/projects/:id
  const getSingle = await fetch(`${baseUrl}/api/projects/${demoProjRecord.id}`, { headers: authHeaders });
  assert.equal(getSingle.status, 200);
  const singleProj = await getSingle.json();
  assert.equal(singleProj.id, demoProjRecord.id);
  assert.equal(singleProj.name, 'Mueble bajo de cocina modular');
  assert.ok(singleProj.data && Array.isArray(singleProj.data.columns));
  assert.equal(singleProj.data.columns.length, 2);

  // 8. Delete project (simulating "Eliminar" via DELETE /api/projects/:id)
  const delRes = await fetch(`${baseUrl}/api/projects/${p1.id}`, {
    method: 'DELETE',
    headers: authHeaders
  });
  assert.equal(delRes.status, 200);

  // Verify list now has 2 projects (original deleted, duplicate and demo remain)
  const list6 = await (await fetch(`${baseUrl}/api/projects`, { headers: authHeaders })).json();
  assert.equal(list6.length, 2);
  assert.ok(!list6.some((item) => item.id === p1.id));
  assert.ok(list6.some((item) => item.id === dupData.id));
  assert.ok(list6.some((item) => item.id === demoProjRecord.id));
});

// ============================================================================
// 5. MILESTONE 3: EXPANDED DOOR CATALOG, KINEMATICS & CUTLIST HARDWARE (R3)
// ============================================================================

test('M3.1: Catalog exports all 7 FRONTS and Spanish LABELS', async () => {
  const { FRONTS, LABELS } = await import('../public/js/layout.js');
  const expectedFronts = ['none', 'doors', 'left-door', 'right-door', 'sliding', 'bifold', 'lift-up'];
  assert.deepEqual(FRONTS, expectedFronts);
  assert.equal(FRONTS.length, 7);

  expectedFronts.forEach((f) => {
    assert.ok(LABELS[f], `Front ${f} must have a label in LABELS`);
    assert.ok(typeof LABELS[f] === 'string' && LABELS[f].length > 0);
  });
  assert.equal(LABELS.sliding, 'Puertas corredizas (con riel)');
  assert.equal(LABELS.bifold, 'Puerta plegable / acordeón');
  assert.equal(LABELS['lift-up'], 'Puerta abatible hacia arriba (pistón a gas)');
});

test('M3.2: DEFAULTS contains all hardware pricing fields for new door types', () => {
  assert.equal(DEFAULTS.slidingTrackPrice, 28, 'slidingTrackPrice default must be 28');
  assert.equal(DEFAULTS.bifoldHingePrice, 4, 'bifoldHingePrice default must be 4');
  assert.equal(DEFAULTS.bifoldGuidePrice, 8, 'bifoldGuidePrice default must be 8');
  assert.equal(DEFAULTS.gasStrutPrice, 6, 'gasStrutPrice default must be 6');
});

test('M3.3: All 7 front types produce correct panel dimensions, bounding boxes, and roles', () => {
  const frontCatalog = ['none', 'doors', 'left-door', 'right-door', 'sliding', 'bifold', 'lift-up'];
  const W = 1000;
  const H = 800;
  const D = 450;
  const t = 18;
  const fc = 2; // default frontClearance

  frontCatalog.forEach((front) => {
    const proj = {
      settings: { ...DEFAULTS, height: H, depth: D, thickness: t, frontClearance: fc },
      columns: [{ id: 'col1', width: W, root: { id: 'mod1', type: 'shelf', size: 1, front } }],
    };
    const l = computeLayout(proj);
    const doorPanels = l.pieces.filter((pc) => pc.role === 'door-front');

    if (front === 'none') {
      assert.equal(doorPanels.length, 0, 'front=none must produce 0 door panels');
    } else if (front === 'doors') {
      assert.equal(doorPanels.length, 2, 'doors must produce 2 panels');
      const expectedDw = (W + t - 3 * fc) / 2;
      const expectedDh = H - t - 2 * fc;
      doorPanels.forEach((p) => {
        assert.equal(p.sx, expectedDw);
        assert.equal(p.sy, expectedDh);
        assert.equal(p.sz, t);
        assert.equal(p.z, D);
        assert.equal(p.role, 'door-front');
      });
      assert.ok(doorPanels.some((p) => p.side === 'right'));
      assert.ok(doorPanels.some((p) => p.side === 'left'));
    } else if (front === 'left-door') {
      assert.equal(doorPanels.length, 1);
      const p = doorPanels[0];
      assert.equal(p.sx, W + t - 2 * fc);
      assert.equal(p.sy, H - t - 2 * fc);
      assert.equal(p.z, D);
      assert.equal(p.side, 'right');
    } else if (front === 'right-door') {
      assert.equal(doorPanels.length, 1);
      const p = doorPanels[0];
      assert.equal(p.sx, W + t - 2 * fc);
      assert.equal(p.sy, H - t - 2 * fc);
      assert.equal(p.z, D);
      assert.equal(p.side, 'left');
    } else if (front === 'sliding') {
      assert.equal(doorPanels.length, 2, 'sliding must produce 2 panels');
      const expectedDw = (W + t - 2 * fc) / 2 + 15;
      const expectedDh = H - t - 2 * fc;
      const inner = doorPanels.find((p) => p.side === 'sliding-inner');
      const outer = doorPanels.find((p) => p.side === 'sliding-outer');
      assert.ok(inner, 'Must have sliding-inner panel');
      assert.ok(outer, 'Must have sliding-outer panel');
      assert.equal(inner.sx, expectedDw);
      assert.equal(outer.sx, expectedDw);
      assert.equal(inner.sy, expectedDh);
      assert.equal(outer.sy, expectedDh);
      assert.equal(inner.z, D);
      assert.equal(outer.z, D + t + 2);
    } else if (front === 'bifold') {
      assert.equal(doorPanels.length, 2, 'bifold must produce 2 leaves');
      const expectedDw = (W + t - 3 * fc) / 2;
      const expectedDh = H - t - 2 * fc;
      const anchor = doorPanels.find((p) => p.side === 'bifold-anchor');
      const fold = doorPanels.find((p) => p.side === 'bifold-fold');
      assert.ok(anchor, 'Must have bifold-anchor leaf');
      assert.ok(fold, 'Must have bifold-fold leaf');
      assert.equal(anchor.sx, expectedDw);
      assert.equal(fold.sx, expectedDw);
      assert.equal(anchor.sy, expectedDh);
      assert.equal(fold.sy, expectedDh);
      assert.equal(anchor.z, D);
      assert.equal(fold.z, D);
    } else if (front === 'lift-up') {
      assert.equal(doorPanels.length, 1, 'lift-up must produce 1 panel');
      const p = doorPanels[0];
      assert.equal(p.sx, W + t - 2 * fc);
      assert.equal(p.sy, H - t - 2 * fc);
      assert.equal(p.z, D + 1);
      assert.equal(p.side, 'lift-up');
      assert.equal(p.holeLayout, 'h');
    }
  });
});

test('M3.4: Sliding doors produce 2 panels with exactly 30mm central overlap (+15mm per leaf)', () => {
  const W = 1200;
  const t = 18;
  const fc = 2;
  const proj = {
    settings: { ...DEFAULTS, height: 1000, depth: 500, thickness: t, frontClearance: fc },
    columns: [{ id: 'c1', width: W, root: { id: 'm1', type: 'shelf', size: 1, front: 'sliding' } }],
  };
  const l = computeLayout(proj);
  const sliding = l.pieces.filter((p) => p.role === 'door-front' || p.name === 'Puerta corrediza');
  assert.equal(sliding.length, 2);

  const inner = sliding.find((p) => p.side === 'sliding-inner');
  const outer = sliding.find((p) => p.side === 'sliding-outer');
  assert.ok(inner && outer);

  // Width is (cw - 2 * fc) / 2 + 15
  const netW = W + t - 2 * fc;
  const expectedLeafW = netW / 2 + 15;
  assert.equal(inner.sx, expectedLeafW);
  assert.equal(outer.sx, expectedLeafW);

  // Coordinate overlap calculation
  const overlap = (inner.x + inner.sx) - outer.x;
  assert.equal(Math.round(overlap), 30, 'Overlap between the 2 sliding doors must be exactly 30mm');

  // Verify z positions
  assert.equal(inner.z, 500);
  assert.equal(outer.z, 500 + t + 2);
});

test('M3.5: Cutlist hardware calculations and pricing for sliding, bifold, lift-up, and swinging doors', () => {
  // Test sliding door hardware
  {
    const proj = {
      settings: { ...DEFAULTS, slidingTrackPrice: 32 },
      columns: [{ id: 'c1', width: 1000, root: { id: 'm1', type: 'shelf', size: 1, front: 'sliding' } }],
    };
    const l = computeLayout(proj);
    assert.equal(l.hardware.slidingTracks, 1);
    const trackHw = l.cutlist.hardware.find((h) => h.name.includes('corredizo'));
    assert.ok(trackHw);
    assert.equal(trackHw.qty, 1);
    assert.equal(trackHw.unitPrice, 32);
    assert.equal(trackHw.total, 32);
  }

  // Test bi-fold door hardware: 1 guide kit + 4 bi-fold hinges
  {
    const proj = {
      settings: { ...DEFAULTS, bifoldGuidePrice: 10, bifoldHingePrice: 5 },
      columns: [{ id: 'c1', width: 900, root: { id: 'm1', type: 'shelf', size: 1, front: 'bifold' } }],
    };
    const l = computeLayout(proj);
    assert.equal(l.hardware.bifoldGuides, 1);
    assert.equal(l.hardware.bifoldHinges, 4);

    const guideHw = l.cutlist.hardware.find((h) => h.name.includes('Guía') && h.name.includes('plegable'));
    assert.ok(guideHw);
    assert.equal(guideHw.qty, 1);
    assert.equal(guideHw.unitPrice, 10);
    assert.equal(guideHw.total, 10);

    const hingeHw = l.cutlist.hardware.find((h) => h.name.includes('Bisagra') && h.name.includes('plegable'));
    assert.ok(hingeHw);
    assert.equal(hingeHw.qty, 4);
    assert.equal(hingeHw.unitPrice, 5);
    assert.equal(hingeHw.total, 20);
  }

  // Test lift-up door hardware: 2 gas struts + 2 top hinges
  {
    const proj = {
      settings: { ...DEFAULTS, gasStrutPrice: 7.5, hingePrice: 2.5 },
      columns: [{ id: 'c1', width: 800, root: { id: 'm1', type: 'shelf', size: 1, front: 'lift-up' } }],
    };
    const l = computeLayout(proj);
    assert.equal(l.hardware.gasStruts, 2);
    assert.equal(l.hardware.hinges, 2);

    const gasHw = l.cutlist.hardware.find((h) => h.name.includes('gas'));
    assert.ok(gasHw);
    assert.equal(gasHw.qty, 2);
    assert.equal(gasHw.unitPrice, 7.5);
    assert.equal(gasHw.total, 15);

    const hingeHw = l.cutlist.hardware.find((h) => h.name === 'Bisagra');
    assert.ok(hingeHw);
    assert.equal(hingeHw.qty, 2);
    assert.equal(hingeHw.unitPrice, 2.5);
    assert.equal(hingeHw.total, 5);
  }

  // Test swinging doors hardware integrity (doors: 4 hinges, left-door: 2 hinges)
  {
    const proj = {
      settings: { ...DEFAULTS, height: 800, hingePrice: 2 },
      columns: [
        { id: 'c1', width: 800, root: { id: 'm1', type: 'shelf', size: 1, front: 'doors' } },
        { id: 'c2', width: 500, root: { id: 'm2', type: 'shelf', size: 1, front: 'left-door' } },
      ],
    };
    const l = computeLayout(proj);
    assert.equal(l.hardware.hinges, 6);
    const hingeHw = l.cutlist.hardware.find((h) => h.name === 'Bisagra');
    assert.ok(hingeHw);
    assert.equal(hingeHw.qty, 6);
    assert.equal(hingeHw.total, 12);
  }
});

test('M3.6: Cutlist rows for door panels receive prefix O and maintain strict pricing identity', () => {
  const frontCatalog = ['doors', 'left-door', 'right-door', 'sliding', 'bifold', 'lift-up'];
  frontCatalog.forEach((front) => {
    const proj = {
      settings: { ...DEFAULTS, priceFront: 80 },
      columns: [{ id: 'col1', width: 800, root: { id: 'mod1', type: 'shelf', size: 1, front } }],
    };
    const l = computeLayout(proj);
    const doorRows = l.cutlist.rows.filter((r) => r.role === 'door-front');
    assert.ok(doorRows.length >= 1, `Cutlist must have door-front rows for front=${front}`);

    doorRows.forEach((r) => {
      assert.ok(r.id.startsWith('O'), `Door row id "${r.id}" must start with prefix 'O'`);
      assert.equal(r.role, 'door-front');
      assert.ok(r.unitPrice > 0, 'unitPrice must be positive');
      assert.ok(r.total > 0, 'total must be positive');
    });

    // Arithmetic Pricing Identity
    const calculatedSum = l.cutlist.panelsTotal + l.cutlist.hardwareTotal;
    const diff = Math.abs(calculatedSum - l.cutlist.total);
    assert.ok(diff < 1e-6, `Arithmetic pricing identity violated for front=${front}: delta=${diff}`);
  });
});

test('M3.7: duplicateModule() clones subtrees and assigns fresh unique IDs', async () => {
  const { duplicateModule } = await import('../public/js/model.js');

  // Case 1: Duplicating a sibling inside a container
  const proj1 = {
    settings: { ...DEFAULTS },
    columns: [
      {
        id: 'col1',
        width: 800,
        root: {
          id: 'root1',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            { id: 'leaf1', type: 'shelf', size: 300, front: 'sliding' },
            { id: 'leaf2', type: 'drawer', size: 400, count: 3 },
          ],
        },
      },
    ],
  };

  const dupLeaf1 = duplicateModule(proj1, 'leaf1');
  assert.ok(dupLeaf1, 'Duplicate must return created node');
  assert.ok(dupLeaf1.id && dupLeaf1.id !== 'leaf1', 'Duplicate must have fresh id');
  assert.equal(dupLeaf1.type, 'shelf');
  assert.equal(dupLeaf1.front, 'sliding');
  assert.equal(dupLeaf1.size, 300);

  const colRoot = proj1.columns[0].root;
  assert.equal(colRoot.children.length, 3, 'Container must now have 3 children');
  assert.equal(colRoot.children[0].id, 'leaf1');
  assert.equal(colRoot.children[1].id, dupLeaf1.id, 'Duplicate must be inserted right after original');
  assert.equal(colRoot.children[2].id, 'leaf2');

  // Case 2: Duplicating a nested container module with sub-children
  const dupContainer = duplicateModule(proj1, 'root1');
  assert.ok(dupContainer);
  assert.notEqual(dupContainer.id, 'root1');
  assert.equal(dupContainer.children.length, 3);
  dupContainer.children.forEach((ch, idx) => {
    assert.notEqual(ch.id, colRoot.children[idx].id, 'Descendant children must have unique fresh IDs');
  });

  // Case 3: Duplicating a single column root wraps into vertical container
  const proj2 = {
    settings: { ...DEFAULTS },
    columns: [{ id: 'col_single', width: 600, root: { id: 'only_leaf', type: 'shelf', size: 1, front: 'lift-up' } }],
  };
  const dupRoot = duplicateModule(proj2, 'only_leaf');
  assert.ok(dupRoot);
  assert.equal(proj2.columns[0].root.type, 'multiple');
  assert.equal(proj2.columns[0].root.dir, 'v');
  assert.equal(proj2.columns[0].root.children.length, 2);
  assert.equal(proj2.columns[0].root.children[1].id, dupRoot.id);
  assert.equal(dupRoot.front, 'lift-up');

  // Case 4: Non-existent ID returns null
  assert.equal(duplicateModule(proj2, 'non-existent-id'), null);
});

test('M3.8: VALID_NEW_TYPES in public/js/app.js contains strictly shelf, drawer, rail with no door types', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');

  // Verify export or constant VALID_NEW_TYPES
  assert.ok(appJs.includes("VALID_NEW_TYPES = ['shelf', 'drawer', 'rail']"));

  // Verify that newType selector does NOT include doors
  assert.ok(!appJs.includes("['shelf', 'rail', 'drawer', 'doors'"));

  // Verify 2-Tier dock markup classes exist in app.js
  assert.ok(appJs.includes('dock-tier-primary'));
  assert.ok(appJs.includes('dock-tier-actions'));
  assert.ok(appJs.includes('dock-grid-2'));
  assert.ok(appJs.includes('input-with-unit'));
  assert.ok(appJs.includes('dock-subdiv-group'));
  assert.ok(appJs.includes('btn-subdiv'));
  assert.ok(appJs.includes('tier-2-actions'));
  assert.ok(appJs.includes('btn-tier2'));
  assert.ok(appJs.includes('id="frontSelect"'));
  assert.ok(appJs.includes('id="dupMod"'));
  assert.ok(appJs.includes('id="clearSel"'));
});

test('M3.9: 2-Tier Dock CSS rules are defined in style.css', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

  const requiredClasses = [
    '.dock-tier-primary',
    '.dock-tier-actions',
    '.dock-grid-2',
    '.input-with-unit',
    '.dock-subdiv-group',
    '.btn-subdiv',
    '.tier-2-actions',
    '.btn-tier2',
  ];
  requiredClasses.forEach((cls) => {
    assert.ok(css.includes(cls), `style.css must define class ${cls}`);
  });
});

