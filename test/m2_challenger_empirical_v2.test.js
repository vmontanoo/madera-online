// test/m2_challenger_empirical_v2.test.js
// Empirical Challenger M2-2 Verification Suite:
// Mathematical & Geometric Validation of the 4 Demos + SQLite Project CRUD Lifecycle & IDOR Protection.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeLayout, DEFAULTS } from '../public/js/layout.js';
import { DEMOS, cloneDemoProject, cloneDemoData } from '../public/js/demos.js';
import { normalizeProject, defaultProject } from '../public/js/model.js';

// Setup isolated test database for Challenger M2-2 verification
process.env.NODE_ENV = 'test';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const testDbPath = path.join(__dirname, 'test_m2_challenger_empirical_v2.db');
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
// 1. MATHEMATICAL & GEOMETRIC INTEGRITY OF THE 4 DEMO PRESETS
// ============================================================================

test('DEMO 1: Closet modular completo — Geometry, Cutlist Pieces & Hardware Totals', () => {
  const demo = DEMOS.find((d) => d.id === 'closet-modular');
  assert.ok(demo, 'closet-modular must be defined in DEMOS');

  // Mathematical total width verification:
  // 3 columns: 750 + 750 + 450 = 1950 mm
  // 4 laterals (thickness t = 18 mm): 4 * 18 = 72 mm
  // Total expected width = 1950 + 72 = 2022 mm
  const t = demo.data.settings.thickness || 18;
  assert.equal(t, 18, 'Panel thickness must be 18 mm');
  const sumCols = demo.data.columns.reduce((acc, c) => acc + c.width, 0);
  assert.equal(sumCols, 1950, 'Sum of column widths must be 1950 mm (750 + 750 + 450)');
  const expectedTotalW = sumCols + (demo.data.columns.length + 1) * t;
  assert.equal(expectedTotalW, 2022, 'Calculated formula total width must be 2022 mm');

  const layout = computeLayout(demo.data);

  // Exact geometric assertions
  assert.equal(layout.totalW, 2022, 'Closet total width must equal exactly 2022 mm');
  assert.equal(layout.settings.height, 2100, 'Closet height must equal 2100 mm');
  assert.equal(layout.settings.depth, 550, 'Closet depth must equal 550 mm');

  // Carcass structural integrity
  const laterals = layout.pieces.filter((p) => p.name === 'Lateral');
  assert.equal(laterals.length, 4, 'Must have exactly 4 carcass laterals (N + 1 for 3 columns)');
  laterals.forEach((lat) => {
    assert.equal(lat.sx, 18, 'Lateral thickness must be 18 mm');
    assert.equal(lat.sz, 550, 'Lateral depth must be 550 mm');
  });

  // Cutlist pieces verification
  assert.ok(layout.pieces.length > 0, 'Pieces list must contain items');
  assert.ok(layout.cutlist.rows.length > 0, 'Cutlist rows count must be > 0');
  assert.ok(layout.cutlist.area > 0, 'Total board area must be positive');

  // Hardware totals positive
  assert.ok(layout.hardware.slides > 0, 'Hardware slides must be positive');
  assert.equal(layout.hardware.slides, 3, 'Must have exactly 3 pairs of drawer slides (3 drawers in col 1)');
  assert.ok(layout.hardware.rails > 0, 'Hardware rails length must be positive');
  assert.ok(layout.hardware.brackets >= 6, 'Must have at least 6 rail brackets (3 hanging rails * 2 brackets)');
  assert.ok(layout.cutlist.hardwareTotal > 0, 'Hardware total cost must be positive');

  // Price calculated
  assert.ok(layout.cutlist.panelsTotal > 0, 'Panels total cost must be positive');
  assert.ok(layout.cutlist.total > 0, 'Total cutlist price must be calculated and > 0');
  assert.equal(
    layout.cutlist.total,
    layout.cutlist.panelsTotal + layout.cutlist.hardwareTotal,
    'Total price must strictly equal panelsTotal + hardwareTotal'
  );
});

test('DEMO 2: Mesa de noche moderna — Geometry & Drawers Hardware', () => {
  const demo = DEMOS.find((d) => d.id === 'mesa-noche');
  assert.ok(demo, 'mesa-noche must be defined in DEMOS');

  // Mathematical total width verification:
  // 1 column: 500 mm
  // 2 laterals: 2 * 18 = 36 mm
  // Total expected width = 500 + 36 = 536 mm
  const t = demo.data.settings.thickness || 18;
  const sumCols = demo.data.columns.reduce((acc, c) => acc + c.width, 0);
  assert.equal(sumCols, 500, 'Sum of column widths must be 500 mm');
  const expectedTotalW = sumCols + (demo.data.columns.length + 1) * t;
  assert.equal(expectedTotalW, 536, 'Calculated formula total width must be 536 mm');

  const layout = computeLayout(demo.data);

  // Exact geometric assertions
  assert.equal(layout.totalW, 536, 'Mesa de noche total width must equal exactly 536 mm');
  assert.equal(layout.settings.height, 550, 'Mesa de noche height must equal 550 mm');
  assert.equal(layout.settings.depth, 400, 'Mesa de noche depth must equal 400 mm');

  // Structural carcass
  const laterals = layout.pieces.filter((p) => p.name === 'Lateral');
  assert.equal(laterals.length, 2, 'Must have 2 laterals');

  // Drawer & pulls hardware
  assert.ok(layout.hardware.slides > 0, 'Slides hardware count must be positive');
  assert.equal(layout.hardware.slides, 2, 'Must have exactly 2 drawer slide pairs');

  const drawerFronts = layout.pieces.filter((p) => p.name === 'Frente de gaveta');
  assert.equal(drawerFronts.length, 2, 'Must have 2 drawer fronts');

  // Pulls hardware verification (profile/gola)
  assert.equal(layout.settings.pullStyle, 'profile', 'Pull style must be profile');
  assert.ok(layout.hardware.pulls['profile'] > 0, 'Profile pulls hardware count must be > 0');
  assert.equal(layout.hardware.pulls['profile'], 2, 'Must have 2 profile pulls');

  // Cutlist & pricing
  assert.ok(layout.cutlist.rows.length > 0, 'Cutlist rows must be > 0');
  assert.ok(layout.cutlist.total > 0, 'Total price must be calculated and > 0');
});

test('DEMO 3: Centro de entretenimiento / TV rack — Geometry, Doors & Drawers', () => {
  const demo = DEMOS.find((d) => d.id === 'centro-tv');
  assert.ok(demo, 'centro-tv must be defined in DEMOS');

  // Mathematical total width verification:
  // 3 columns: 500 + 800 + 500 = 1800 mm
  // 4 laterals: 4 * 18 = 72 mm
  // Total expected width = 1800 + 72 = 1872 mm
  const t = demo.data.settings.thickness || 18;
  const sumCols = demo.data.columns.reduce((acc, c) => acc + c.width, 0);
  assert.equal(sumCols, 1800, 'Sum of column widths must be 1800 mm (500 + 800 + 500)');
  const expectedTotalW = sumCols + (demo.data.columns.length + 1) * t;
  assert.equal(expectedTotalW, 1872, 'Calculated formula total width must be 1872 mm');

  const layout = computeLayout(demo.data);

  // Exact geometric assertions
  assert.equal(layout.totalW, 1872, 'Centro de TV total width must equal exactly 1872 mm');
  assert.equal(layout.settings.height, 600, 'Height must be 600 mm');
  assert.equal(layout.settings.depth, 420, 'Depth must be 420 mm');

  // Carcass laterals
  assert.equal(layout.pieces.filter((p) => p.name === 'Lateral').length, 4, '4 laterals for 3 bays');

  // Doors assertions
  const doors = layout.pieces.filter((p) => p.name === 'Puerta');
  assert.equal(doors.length, 2, 'Must have exactly 2 doors (left bay and right bay)');
  assert.ok(doors.some((d) => d.side === 'right'), 'Left bay door opens with hinge on side');
  assert.ok(doors.some((d) => d.side === 'left'), 'Right bay door opens with hinge on side');
  assert.equal(layout.hardware.hinges, 4, 'Must have 4 hinges (2 per door for height <= 1000mm)');

  // Drawers assertions
  const drawerFronts = layout.pieces.filter((p) => p.name === 'Frente de gaveta');
  assert.equal(drawerFronts.length, 2, 'Must have 2 center drawer fronts');
  assert.equal(layout.hardware.slides, 2, 'Must have 2 slide pairs');

  // Cutlist & pricing
  assert.ok(layout.cutlist.total > 0, 'Total price must be positive');
  assert.ok(layout.cutlist.hardwareTotal > 0, 'Hardware total must be positive');
});

test('DEMO 4: Mueble bajo de cocina modular — Geometry & Structure', () => {
  const demo = DEMOS.find((d) => d.id === 'cocina-bajo');
  assert.ok(demo, 'cocina-bajo must be defined in DEMOS');

  // Mathematical total width verification:
  // 2 columns: 450 + 750 = 1200 mm
  // 3 laterals: 3 * 18 = 54 mm
  // Total expected width = 1200 + 54 = 1254 mm
  const t = demo.data.settings.thickness || 18;
  const sumCols = demo.data.columns.reduce((acc, c) => acc + c.width, 0);
  assert.equal(sumCols, 1200, 'Sum of column widths must be 1200 mm (450 + 750)');
  const expectedTotalW = sumCols + (demo.data.columns.length + 1) * t;
  assert.equal(expectedTotalW, 1254, 'Calculated formula total width must be 1254 mm');

  const layout = computeLayout(demo.data);

  // Exact geometric assertions
  assert.equal(layout.totalW, 1254, 'Cocina bajo total width must equal exactly 1254 mm');
  assert.equal(layout.settings.height, 850, 'Kitchen base height must equal 850 mm');
  assert.equal(layout.settings.depth, 580, 'Kitchen base depth must equal 580 mm');

  // Carcass laterals
  assert.equal(layout.pieces.filter((p) => p.name === 'Lateral').length, 3, '3 laterals for 2 bays');

  // Column 1: 3-drawer cacerolero unit
  assert.equal(layout.hardware.slides, 3, 'Must have 3 slide pairs');
  assert.equal(layout.pieces.filter((p) => p.name === 'Frente de gaveta').length, 3, '3 drawer fronts');

  // Column 2: 2-door cabinet
  const doors = layout.pieces.filter((p) => p.name === 'Puerta');
  assert.equal(doors.length, 2, 'Must have 2 swinging doors');
  assert.equal(layout.hardware.hinges, 4, 'Must have 4 hinges for the 2 doors');

  // Cutlist & pricing
  assert.ok(layout.cutlist.total > 0, 'Total price must be positive');
  assert.ok(layout.cutlist.rows.length > 0, 'Cutlist rows must exist');
});

test('DEMO CATALOG: Deep Cloning & UID Isolation', () => {
  const clone = cloneDemoProject('closet-modular');
  assert.ok(clone);
  assert.equal(clone.name, 'Closet modular completo');

  const original = DEMOS.find((d) => d.id === 'closet-modular');

  // Mutating the clone must not affect the original demo template
  clone.data.columns[0].width = 9999;
  assert.equal(original.data.columns[0].width, 750, 'Original template must remain unaffected');

  // Ensure all cloned column IDs and node IDs are unique non-empty strings
  const originalColIds = new Set(original.data.columns.map((c) => c.id));
  const cloneColIds = new Set(clone.data.columns.map((c) => c.id));
  assert.equal(cloneColIds.size, 3, 'Clone must have 3 distinct column IDs');
  for (const id of cloneColIds) {
    assert.ok(!originalColIds.has(id), `Cloned ID ${id} must not collide with original ID`);
  }
});

// ============================================================================
// 2. SQLITE PROJECT CRUD LIFECYCLE (CREATE, RENAME, DUPLICATE, DELETE)
// ============================================================================

test('SQLITE CRUD: Full Lifecycle Verification (Create, Rename, Duplicate, Delete)', async () => {
  // Step 1: Register test user (User A)
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Challenger User A',
      email: 'user_a_challenger@test.com',
      password: 'StrongPassword123!'
    })
  });
  assert.equal(regRes.status, 201, 'User A registration must return 201 Created');
  const regData = await regRes.json();
  assert.ok(regData.token, 'Must return session token');
  const userA = regData.user;
  assert.ok(userA && userA.id, 'User A must have an id');

  // Verify User A exists in SQLite users table
  const userARow = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(userA.id);
  assert.ok(userARow, 'User A row must exist in SQLite');
  assert.equal(userARow.email, 'user_a_challenger@test.com');
  assert.equal(userARow.name, 'Challenger User A');

  const authHeadersA = {
    Authorization: `Bearer ${regData.token}`,
    'Content-Type': 'application/json'
  };

  // Step 2: Create a new project via POST /api/projects
  const initialProjectData = defaultProject();
  const createRes = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: authHeadersA,
    body: JSON.stringify({
      name: 'Initial Project',
      data: initialProjectData
    })
  });
  assert.equal(createRes.status, 201, 'POST /api/projects must return 201 Created');
  const createdProject = await createRes.json();
  assert.ok(createdProject.id, 'Project must have an id');
  assert.equal(createdProject.name, 'Initial Project');
  const projAId = createdProject.id;

  // Direct SQLite assertion on project creation
  const projRowAfterCreate = db.prepare('SELECT id, user_id, name, data, created_at, updated_at FROM projects WHERE id = ?').get(projAId);
  assert.ok(projRowAfterCreate, 'Project record must exist in SQLite projects table');
  assert.equal(projRowAfterCreate.user_id, userA.id, 'Project user_id must match User A');
  assert.equal(projRowAfterCreate.name, 'Initial Project');
  const parsedData = JSON.parse(projRowAfterCreate.data);
  assert.ok(Array.isArray(parsedData.columns), 'Stored data must have columns array');

  // Step 3: Rename project via PUT /api/projects/:id with { name: 'Renamed Project' }
  const renameRes = await fetch(`${baseUrl}/api/projects/${projAId}`, {
    method: 'PUT',
    headers: authHeadersA,
    body: JSON.stringify({ name: 'Renamed Project' })
  });
  assert.equal(renameRes.status, 200, 'PUT /api/projects/:id must return 200 OK');
  const renameBody = await renameRes.json();
  assert.equal(renameBody.ok, true, 'PUT response must have { ok: true }');

  // Direct SQLite assertion: Verify name is updated in SQLite
  const projRowAfterRename = db.prepare('SELECT id, user_id, name, updated_at FROM projects WHERE id = ?').get(projAId);
  assert.ok(projRowAfterRename);
  assert.equal(projRowAfterRename.name, 'Renamed Project', 'Project name in SQLite MUST be updated to "Renamed Project"');
  assert.ok(projRowAfterRename.updated_at >= projRowAfterCreate.updated_at, 'updated_at timestamp must be updated');

  // Verify GET /api/projects/:id returns updated name
  const getRenamedRes = await fetch(`${baseUrl}/api/projects/${projAId}`, { headers: authHeadersA });
  assert.equal(getRenamedRes.status, 200);
  const getRenamedJson = await getRenamedRes.json();
  assert.equal(getRenamedJson.name, 'Renamed Project');

  // Step 4: Duplicate project via POST /api/projects/:id/duplicate
  const duplicateRes = await fetch(`${baseUrl}/api/projects/${projAId}/duplicate`, {
    method: 'POST',
    headers: authHeadersA
  });
  assert.equal(duplicateRes.status, 201, 'POST /api/projects/:id/duplicate must return 201 Created');
  const duplicateBody = await duplicateRes.json();
  assert.ok(duplicateBody.id, 'Duplicate must return new project id');
  const dupProjId = duplicateBody.id;
  assert.notEqual(dupProjId, projAId, 'Duplicate ID must be different from original ID');

  // Direct SQLite assertion: Verify duplicate exists with ' copy' suffix
  const dupRowInDb = db.prepare('SELECT id, user_id, name, data FROM projects WHERE id = ?').get(dupProjId);
  assert.ok(dupRowInDb, 'Duplicate project row must exist in SQLite');
  assert.equal(dupRowInDb.user_id, userA.id, 'Duplicate must belong to User A');
  assert.equal(dupRowInDb.name, 'Renamed Project copy', 'Duplicate name must have " copy" suffix');
  assert.equal(dupRowInDb.data, projRowAfterCreate.data, 'Duplicate project data must match original project data');

  // Step 5: Delete original project via DELETE /api/projects/:id
  const deleteRes = await fetch(`${baseUrl}/api/projects/${projAId}`, {
    method: 'DELETE',
    headers: authHeadersA
  });
  assert.equal(deleteRes.status, 200, 'DELETE /api/projects/:id must return 200 OK');
  const deleteBody = await deleteRes.json();
  assert.equal(deleteBody.ok, true);

  // Direct SQLite assertion: Verify original deleted while duplicate remains
  const originalCheckInDb = db.prepare('SELECT * FROM projects WHERE id = ?').get(projAId);
  assert.equal(originalCheckInDb, undefined, 'Original project must be deleted from SQLite');

  const dupCheckInDb = db.prepare('SELECT * FROM projects WHERE id = ?').get(dupProjId);
  assert.ok(dupCheckInDb, 'Duplicate project MUST still exist in SQLite');
  assert.equal(dupCheckInDb.id, dupProjId);
  assert.equal(dupCheckInDb.name, 'Renamed Project copy');

  // Verify User A list contains only the duplicate project
  const listAfterDelete = await (await fetch(`${baseUrl}/api/projects`, { headers: authHeadersA })).json();
  assert.equal(listAfterDelete.length, 1);
  assert.equal(listAfterDelete[0].id, dupProjId);
  assert.equal(listAfterDelete[0].name, 'Renamed Project copy');
});

// ============================================================================
// 3. IDOR (INSECURE DIRECT OBJECT REFERENCE) PROTECTION & SECURITY ISOLATION
// ============================================================================

test('SECURITY & IDOR: User B cannot inspect, rename, duplicate, or delete User A\'s project', async () => {
  // Step 1: Register User A and create a project
  const regARes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Victim User A',
      email: 'victim_a@test.com',
      password: 'PasswordA123!'
    })
  });
  assert.equal(regARes.status, 201);
  const { token: tokenA, user: userA } = await regARes.json();

  const createProjRes = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Top Secret Project A',
      data: defaultProject()
    })
  });
  assert.equal(createProjRes.status, 201);
  const { id: secretProjId } = await createProjRes.json();
  assert.ok(secretProjId);

  // Step 2: Register User B (Attacker)
  const regBRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Attacker User B',
      email: 'attacker_b@test.com',
      password: 'PasswordB123!'
    })
  });
  assert.equal(regBRes.status, 201);
  const { token: tokenB, user: userB } = await regBRes.json();
  assert.notEqual(userB.id, userA.id, 'User B must have distinct ID');

  const authHeadersB = {
    Authorization: `Bearer ${tokenB}`,
    'Content-Type': 'application/json'
  };

  // 1. IDOR Read Attack: User B tries to GET User A's project
  const getAttackRes = await fetch(`${baseUrl}/api/projects/${secretProjId}`, { headers: authHeadersB });
  assert.equal(getAttackRes.status, 404, 'GET /api/projects/:id by unauthorized user must return 404 Not Found');
  const getAttackBody = await getAttackRes.json();
  assert.equal(getAttackBody.error, 'No encontrado');

  // 2. IDOR Rename/Update Attack: User B tries to PUT User A's project
  const renameAttackRes = await fetch(`${baseUrl}/api/projects/${secretProjId}`, {
    method: 'PUT',
    headers: authHeadersB,
    body: JSON.stringify({ name: 'HACKED BY USER B' })
  });
  assert.equal(renameAttackRes.status, 404, 'PUT /api/projects/:id by unauthorized user must return 404 Not Found');

  // Direct SQLite check: Name in database must remain UNTOUCHED
  const checkDbAfterRenameAttack = db.prepare('SELECT name FROM projects WHERE id = ?').get(secretProjId);
  assert.equal(checkDbAfterRenameAttack.name, 'Top Secret Project A', 'Project name in SQLite MUST NOT be modified by attacker');

  // 3. IDOR Duplicate Attack: User B tries to duplicate User A's project into B's account
  const dupAttackRes = await fetch(`${baseUrl}/api/projects/${secretProjId}/duplicate`, {
    method: 'POST',
    headers: authHeadersB
  });
  assert.equal(dupAttackRes.status, 404, 'POST /api/projects/:id/duplicate by unauthorized user must return 404 Not Found');

  // Direct SQLite check: User B still has 0 projects
  const userBProjects = db.prepare('SELECT * FROM projects WHERE user_id = ?').all(userB.id);
  assert.equal(userBProjects.length, 0, 'User B must not have any duplicated projects');

  // 4. IDOR Delete Attack: User B tries to DELETE User A's project
  const delAttackRes = await fetch(`${baseUrl}/api/projects/${secretProjId}`, {
    method: 'DELETE',
    headers: authHeadersB
  });
  assert.equal(delAttackRes.status, 404, 'DELETE /api/projects/:id by unauthorized user must return 404 Not Found');

  // Direct SQLite check: User A's project MUST still exist in database
  const checkDbAfterDelAttack = db.prepare('SELECT * FROM projects WHERE id = ?').get(secretProjId);
  assert.ok(checkDbAfterDelAttack, 'Project MUST NOT be deleted by attacker');
  assert.equal(checkDbAfterDelAttack.id, secretProjId);
  assert.equal(checkDbAfterDelAttack.name, 'Top Secret Project A');

  // 5. User B's project list must be completely empty
  const userBListRes = await fetch(`${baseUrl}/api/projects`, { headers: authHeadersB });
  assert.equal(userBListRes.status, 200);
  const userBList = await userBListRes.json();
  assert.deepEqual(userBList, [], 'User B list must be empty and not leak User A projects');
});

// ============================================================================
// 4. ADVERSARIAL BOUNDARY & UNEXPECTED INPUT CHECKS
// ============================================================================

test('ADVERSARIAL: Unauthenticated requests and non-existent IDs are properly rejected', async () => {
  // Unauthenticated requests should be 401
  const unauthGet = await fetch(`${baseUrl}/api/projects`);
  assert.equal(unauthGet.status, 401, 'Unauthenticated GET /api/projects must return 401');

  const unauthPost = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Malicious' })
  });
  assert.equal(unauthPost.status, 401, 'Unauthenticated POST /api/projects must return 401');

  // Register valid user to test non-existent IDs
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Boundary Tester',
      email: 'boundary@test.com',
      password: 'Password123!'
    })
  });
  const { token } = await regRes.json();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Non-existent numeric ID
  assert.equal((await fetch(`${baseUrl}/api/projects/99999999`, { headers })).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/projects/99999999`, { method: 'PUT', headers, body: JSON.stringify({ name: 'X' }) })).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/projects/99999999/duplicate`, { method: 'POST', headers })).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/projects/99999999`, { method: 'DELETE', headers })).status, 404);

  // String / SQL Injection attempts in ID parameter
  assert.equal((await fetch(`${baseUrl}/api/projects/abc`, { headers })).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/projects/' OR '1'='1`, { headers })).status, 404);
});
