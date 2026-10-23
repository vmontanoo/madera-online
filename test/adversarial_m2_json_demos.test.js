// test/adversarial_m2_json_demos.test.js
// Adversarial Stress & Clone Isolation Test Suite for Milestone 2 (JSON Import & Demos Catalog).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeLayout, DEFAULTS, uid } from '../public/js/layout.js';
import { DEMOS, cloneDemoProject, cloneDemoData } from '../public/js/demos.js';
import { normalizeProject, defaultProject } from '../public/js/model.js';

// Setup isolated test database for adversarial persistence checks
process.env.NODE_ENV = 'test';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const adversarialDbPath = path.join(__dirname, 'test_adversarial_m2.db');
process.env.DATABASE_PATH = adversarialDbPath;

try {
  fs.unlinkSync(adversarialDbPath);
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
    fs.unlinkSync(adversarialDbPath);
  } catch {}
});

// ============================================================================
// CLIENT-SIDE IMPORT & VALIDATION PIPELINE SPECIFICATION (from public/js/app.js)
// ============================================================================

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

function processImportJson(text, filename = 'imported.json') {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (jsonErr) {
    throw new Error('El archivo no contiene un JSON válido.\nDetalle: ' + jsonErr.message);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('El archivo JSON debe contener un objeto con la definición del proyecto.');
  }

  let name = (typeof parsed.name === 'string' && parsed.name.trim())
    ? parsed.name.trim()
    : filename.replace(/\.[^/.]+$/, '').trim() || 'Proyecto importado';

  let data = null;
  if (Array.isArray(parsed.columns)) {
    data = parsed;
  } else if (parsed.data && typeof parsed.data === 'object' && Array.isArray(parsed.data.columns)) {
    data = parsed.data;
  } else if (typeof parsed.data === 'string') {
    try {
      const nested = JSON.parse(parsed.data);
      if (nested && Array.isArray(nested.columns)) data = nested;
    } catch {}
  }

  if (!data || !Array.isArray(data.columns)) {
    throw new Error('Estructura inválida: debe contener el arreglo de columnas ("columns") o un objeto "{ name, data: { columns } }".');
  }

  validateProjectData(data);
  const normalized = normalizeProject(data);
  return { name, data: normalized };
}

// ============================================================================
// 1. CORRUPTED & TRUNCATED JSON STRINGS
// ============================================================================

test('ADVERSARIAL: Corrupted, truncated, and malformed JSON strings are safely rejected', () => {
  const corruptedPayloads = [
    '', // Empty string
    '   ', // Whitespace only
    '{"name": "Mueble', // Truncated mid-string
    '{"columns": [{"width": 600, "root": {', // Truncated mid-object
    '{"columns": [}', // Mismatched brackets
    '{columns: [{width: 600}]}', // Unquoted keys (invalid JSON)
    '{"columns": [{width: 600,}]}', // Trailing comma
    'undefined',
    'null', // Parsed as null (not an object)
    '[1, 2, 3]', // Parsed as array (not an object)
    '12345', // Primitive number
    '"just a string"', // Primitive string
    '{"name": "Test", "data": "{\\"columns\\": [truncated"}', // Corrupted serialized nested data
    '\x00\x01\x02\xFF\xFE', // Binary garbage
    '<!DOCTYPE html><html><body>Error 404</body></html>' // HTML error response instead of JSON
  ];

  for (const payload of corruptedPayloads) {
    assert.throws(
      () => processImportJson(payload),
      (err) => {
        assert.ok(err instanceof Error, `Must throw Error for payload: ${payload.slice(0, 30)}`);
        return true;
      },
      `Should reject malformed payload: ${payload.slice(0, 30)}`
    );
  }
});

// ============================================================================
// 2. MISSING OR MALFORMED COLUMNS PROPERTY
// ============================================================================

test('ADVERSARIAL: Missing, non-array, and empty columns property are strictly rejected', () => {
  const invalidColumnsCases = [
    {}, // Missing columns completely
    { settings: { height: 2000, depth: 600 } }, // Settings present, but no columns
    { columns: null }, // Null columns
    { columns: undefined }, // Undefined columns
    { columns: 'columns' }, // String instead of array
    { columns: 42 }, // Number instead of array
    { columns: true }, // Boolean instead of array
    { columns: {} }, // Object instead of array
    { columns: [] }, // Empty columns array
    { columns: [null] }, // Array containing null
    { columns: ['invalid'] }, // Array containing string
    { columns: [123] }, // Array containing number
    { columns: [{}] }, // Column object missing width and root
    { columns: [{ width: 600 }] }, // Column missing root
    { columns: [{ root: { type: 'shelf' } }] }, // Column missing width
  ];

  for (const testCase of invalidColumnsCases) {
    const jsonStr = JSON.stringify(testCase);
    assert.throws(
      () => processImportJson(jsonStr),
      /El proyecto debe contener un arreglo "columns" con al menos una columna|Estructura inválida|Estructura incompleta|Ancho inválido|no es un objeto válido/
    );
  }
});

// ============================================================================
// 3. NEGATIVE, NAN, INFINITY, AND INVALID NUMERIC DIMENSIONS
// ============================================================================

test('ADVERSARIAL: Negative numbers, NaN, and ±Infinity in settings dimensions are rejected', () => {
  const invalidSettingsValues = [-1000, -1, 0, NaN, Infinity, -Infinity, '500', null, false];

  for (const badVal of invalidSettingsValues) {
    // 1. Settings.height
    assert.throws(
      () => validateProjectData({
        settings: { height: badVal, depth: 500, thickness: 18 },
        columns: [{ width: 600, root: { type: 'shelf', size: 100 } }]
      }),
      /Ajuste inválido: "settings.height"/,
      `settings.height with ${badVal} must be rejected`
    );

    // 2. Settings.depth
    assert.throws(
      () => validateProjectData({
        settings: { height: 1000, depth: badVal, thickness: 18 },
        columns: [{ width: 600, root: { type: 'shelf', size: 100 } }]
      }),
      /Ajuste inválido: "settings.depth"/,
      `settings.depth with ${badVal} must be rejected`
    );

    // 3. Settings.thickness
    assert.throws(
      () => validateProjectData({
        settings: { height: 1000, depth: 500, thickness: badVal },
        columns: [{ width: 600, root: { type: 'shelf', size: 100 } }]
      }),
      /Ajuste inválido: "settings.thickness"/,
      `settings.thickness with ${badVal} must be rejected`
    );
  }

  // Non-negative settings (overhang, backThickness, frontClearance): < 0 or non-finite rejected
  const invalidNonNegativeValues = [-50, -0.001, NaN, Infinity, -Infinity, '0'];
  for (const badVal of invalidNonNegativeValues) {
    assert.throws(
      () => validateProjectData({
        settings: { overhang: badVal },
        columns: [{ width: 600, root: { type: 'shelf', size: 100 } }]
      }),
      /Ajuste inválido: "settings.overhang"/
    );
    assert.throws(
      () => validateProjectData({
        settings: { backThickness: badVal },
        columns: [{ width: 600, root: { type: 'shelf', size: 100 } }]
      }),
      /Ajuste inválido: "settings.backThickness"/
    );
    assert.throws(
      () => validateProjectData({
        settings: { frontClearance: badVal },
        columns: [{ width: 600, root: { type: 'shelf', size: 100 } }]
      }),
      /Ajuste inválido: "settings.frontClearance"/
    );
  }

  // 0 is valid for nonNegative settings
  assert.doesNotThrow(() => validateProjectData({
    settings: { overhang: 0, backThickness: 0, frontClearance: 0 },
    columns: [{ width: 600, root: { type: 'shelf', size: 100 } }]
  }));
});

test('ADVERSARIAL: Negative numbers, NaN, and ±Infinity in column widths and module sizes are rejected', () => {
  const badNumbers = [-500, -1, 0, NaN, Infinity, -Infinity, '600', true];

  // Column widths
  for (const badWidth of badNumbers) {
    assert.throws(
      () => validateProjectData({
        columns: [{ width: badWidth, root: { type: 'shelf', size: 100 } }]
      }),
      /Ancho inválido en columna #1/,
      `Column width ${badWidth} must be rejected`
    );
  }

  // Node sizes
  for (const badSize of badNumbers) {
    assert.throws(
      () => validateProjectData({
        columns: [{ width: 600, root: { type: 'shelf', size: badSize } }]
      }),
      /Medida \(size\) inválida/,
      `Node size ${badSize} must be rejected`
    );
  }

  // Deeply nested node sizes
  for (const badSize of badNumbers) {
    assert.throws(
      () => validateProjectData({
        columns: [{
          width: 600,
          root: {
            type: 'multiple',
            dir: 'v',
            children: [
              { type: 'shelf', size: 200 },
              {
                type: 'multiple',
                dir: 'h',
                children: [
                  { type: 'shelf', size: badSize }
                ]
              }
            ]
          }
        }]
      }),
      /Medida \(size\) inválida/
    );
  }

  // Drawer counts (< 1 or non-finite)
  const badCounts = [0, -1, -5, NaN, Infinity, -Infinity, '2'];
  for (const badCount of badCounts) {
    assert.throws(
      () => validateProjectData({
        columns: [{ width: 600, root: { type: 'drawer', size: 400, count: badCount } }]
      }),
      /Cantidad de gavetas \(count\) inválida/,
      `Drawer count ${badCount} must be rejected`
    );
  }
});

// ============================================================================
// 4. MISSING SETTINGS OBJECT (AUTO-POPULATION VIA NORMALIZEPROJECT)
// ============================================================================

test('ADVERSARIAL: Missing or partial settings object is completely auto-populated by normalizeProject', () => {
  // Case A: Missing settings object entirely
  const rawNoSettings = {
    columns: [
      { width: 750, root: { type: 'shelf', size: 500 } }
    ]
  };

  const processedA = processImportJson(JSON.stringify(rawNoSettings), 'no-settings.json');
  assert.ok(processedA.data.settings, 'Settings must be created');
  assert.equal(processedA.data.settings.height, DEFAULTS.height);
  assert.equal(processedA.data.settings.depth, DEFAULTS.depth);
  assert.equal(processedA.data.settings.thickness, DEFAULTS.thickness);
  assert.equal(processedA.data.settings.overhang, DEFAULTS.overhang);
  assert.equal(processedA.data.settings.pullStyle, DEFAULTS.pullStyle);

  // Case B: Partial settings object (only height specified)
  const rawPartialSettings = {
    settings: { height: 2400 },
    columns: [
      { width: 800, root: { type: 'shelf', size: 500 } }
    ]
  };

  const processedB = processImportJson(JSON.stringify(rawPartialSettings));
  assert.equal(processedB.data.settings.height, 2400, 'Custom height must be preserved');
  assert.equal(processedB.data.settings.depth, DEFAULTS.depth, 'Missing depth must default');
  assert.equal(processedB.data.settings.thickness, DEFAULTS.thickness, 'Missing thickness must default');

  // Case C: Duplicate IDs in columns and nested nodes must be deduplicated
  const rawDuplicateIds = {
    columns: [
      { id: 'dup-id', width: 600, root: { id: 'dup-id', type: 'shelf', size: 300 } },
      { id: 'dup-id', width: 600, root: { id: 'dup-id', type: 'shelf', size: 300 } }
    ]
  };

  const processedC = processImportJson(JSON.stringify(rawDuplicateIds));
  const ids = [
    processedC.data.columns[0].id,
    processedC.data.columns[0].root.id,
    processedC.data.columns[1].id,
    processedC.data.columns[1].root.id
  ];
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, 4, 'All duplicate IDs must be sanitized to unique UIDs');
});

// ============================================================================
// 5. PROTOTYPE POLLUTION ATTEMPTS
// ============================================================================

test('ADVERSARIAL: Prototype pollution attempts (__proto__, constructor) are neutralized', () => {
  const pollutionPayloads = [
    '{"__proto__": {"polluted": "yes"}, "columns": [{"width": 600, "root": {"type": "shelf"}}]}',
    '{"constructor": {"prototype": {"polluted": "yes"}}, "columns": [{"width": 600, "root": {"type": "shelf"}}]}',
    '{"settings": {"__proto__": {"admin": true}}, "columns": [{"width": 600, "root": {"type": "shelf"}}]}',
    '{"columns": [{"width": 600, "root": {"__proto__": {"injected": 123}, "type": "shelf"}}]}'
  ];

  // Baseline check
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).admin, undefined);
  assert.equal(({}).injected, undefined);

  for (const payload of pollutionPayloads) {
    const result = processImportJson(payload);
    assert.ok(result && result.data);

    // Verify global Object prototype remains unpolluted
    assert.equal(({}).polluted, undefined, 'Object.prototype.polluted must not exist');
    assert.equal(({}).admin, undefined, 'Object.prototype.admin must not exist');
    assert.equal(({}).injected, undefined, 'Object.prototype.injected must not exist');
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(Object.prototype.admin, undefined);
  }
});

// ============================================================================
// 6. EXTREMELY LARGE VALUES (1,000,000 mm STRESS TEST)
// ============================================================================

test('ADVERSARIAL: Extremely large dimensions (1,000,000 mm) calculate without overflow or crash', () => {
  const megaProject = {
    settings: {
      height: 1_000_000, // 1 km high
      depth: 1_000_000,  // 1 km deep
      thickness: 18,
      overhang: 0
    },
    columns: [
      {
        width: 1_000_000, // 1 km wide
        root: {
          type: 'multiple',
          dir: 'v',
          children: [
            { type: 'shelf', size: 500_000 },
            { type: 'drawer', size: 500_000, count: 10 }
          ]
        }
      }
    ]
  };

  const processed = processImportJson(JSON.stringify(megaProject), 'mega.json');
  assert.ok(processed.data);

  // Run layout computation engine
  const layout = computeLayout(processed.data);
  assert.ok(layout);
  assert.equal(layout.totalW, 1_000_036, '1,000,000 + 2*18 mm');
  assert.equal(layout.settings.height, 1_000_000);
  assert.equal(layout.settings.depth, 1_000_000);

  // Cutlist pricing must be a finite positive number without NaN or overflow
  assert.ok(Number.isFinite(layout.cutlist.total), 'Cutlist total must be finite');
  assert.ok(layout.cutlist.total > 0, 'Cutlist total must be positive');
  assert.ok(Number.isFinite(layout.cutlist.m2), 'm2 must be finite');
});

// ============================================================================
// 7. ENVELOPE STRUCTURES WITH SERIALIZED JSON STRINGS IN DATA
// ============================================================================

test('ADVERSARIAL: Envelopes with serialized JSON strings in data are cleanly unpacked and validated', () => {
  // 1. Valid serialized envelope
  const validInner = {
    settings: { height: 1800, depth: 450, thickness: 18 },
    columns: [{ width: 700, root: { type: 'shelf', size: 600 } }]
  };
  const validEnvelope = {
    name: 'Mueble Serializado',
    data: JSON.stringify(validInner)
  };

  const processed1 = processImportJson(JSON.stringify(validEnvelope));
  assert.equal(processed1.name, 'Mueble Serializado');
  assert.equal(processed1.data.columns.length, 1);
  assert.equal(processed1.data.columns[0].width, 700);

  // 2. Serialized envelope with invalid inner JSON
  const invalidSerializedEnvelope = {
    name: 'Mueble Roto',
    data: '{"columns": [{"width": -500}]}' // Negative width inside serialized data
  };
  assert.throws(
    () => processImportJson(JSON.stringify(invalidSerializedEnvelope)),
    /Ancho inválido en columna #1/
  );

  // 3. Serialized envelope with non-JSON string in data
  const corruptSerializedEnvelope = {
    name: 'Mueble Basura',
    data: 'not a json string at all'
  };
  assert.throws(
    () => processImportJson(JSON.stringify(corruptSerializedEnvelope)),
    /Estructura inválida/
  );

  // 4. Object envelope with invalid data type
  const badDataEnvelope = {
    name: 'Mueble Objeto Malo',
    data: 12345
  };
  assert.throws(
    () => processImportJson(JSON.stringify(badDataEnvelope)),
    /Estructura inválida/
  );
});

// ============================================================================
// 8. DEMO CATALOG CLONE ISOLATION & DISJOINT ID GENERATION
// ============================================================================

test('ADVERSARIAL: Mutating a cloned demo project NEVER mutates the source DEMOS catalog', () => {
  const originalDemosSnapshot = JSON.parse(JSON.stringify(DEMOS));

  for (const demo of DEMOS) {
    const clone = cloneDemoProject(demo.id);
    assert.ok(clone, `Clone must succeed for ${demo.id}`);
    assert.equal(clone.name, demo.name);

    // Aggressive mutations on clone
    clone.name = 'MUTATED NAME';
    clone.data.settings.height = 99999;
    clone.data.settings.depth = 88888;
    clone.data.settings.thickness = 99;
    clone.data.settings.extraField = 'injected';

    // Mutate columns
    clone.data.columns[0].width = 12345;
    clone.data.columns[0].root.size = 54321;
    clone.data.columns.push({ id: 'injected-col', width: 999, root: { type: 'shelf' } });

    // Mutate nested children if any
    if (clone.data.columns[0].root.children) {
      clone.data.columns[0].root.children.forEach((c) => {
        c.size = 1111;
        c.type = 'corrupted';
      });
      clone.data.columns[0].root.children.splice(0, 1);
    }

    // Verify source demo in DEMOS has remained completely untouched
    const currentDemo = DEMOS.find((d) => d.id === demo.id);
    const pristineDemo = originalDemosSnapshot.find((d) => d.id === demo.id);

    assert.deepEqual(
      JSON.parse(JSON.stringify(currentDemo)),
      pristineDemo,
      `Source DEMO "${demo.id}" was mutated by clone modifications!`
    );
  }
});

test('ADVERSARIAL: All IDs in cloned demos are completely disjoint from template and sibling clones', () => {
  function collectIds(data) {
    const ids = new Set();
    const walk = (node) => {
      if (!node) return;
      if (node.id) ids.add(node.id);
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    if (Array.isArray(data.columns)) {
      data.columns.forEach((col) => {
        if (col.id) ids.add(col.id);
        if (col.root) walk(col.root);
      });
    }
    return ids;
  }

  for (const demo of DEMOS) {
    const templateIds = collectIds(demo.data);
    assert.ok(templateIds.size > 0, `Template ${demo.id} must have IDs`);

    // Clone 1
    const clone1 = cloneDemoProject(demo.id);
    const clone1Ids = collectIds(clone1.data);

    // Clone 2
    const clone2 = cloneDemoProject(demo.id);
    const clone2Ids = collectIds(clone2.data);

    // 1. Clone 1 IDs must be completely disjoint from Template IDs
    const intersectionWithTemplate = [...clone1Ids].filter((id) => templateIds.has(id));
    assert.equal(
      intersectionWithTemplate.length,
      0,
      `Clone 1 shares IDs with template in ${demo.id}: ${intersectionWithTemplate.join(', ')}`
    );

    // 2. Clone 1 IDs must be completely disjoint from Clone 2 IDs
    const intersectionBetweenClones = [...clone1Ids].filter((id) => clone2Ids.has(id));
    assert.equal(
      intersectionBetweenClones.length,
      0,
      `Clone 1 shares IDs with Clone 2 in ${demo.id}: ${intersectionBetweenClones.join(', ')}`
    );

    // 3. All IDs inside Clone 1 must be unique among themselves
    assert.equal(
      clone1Ids.size,
      templateIds.size,
      `Clone 1 must reassign all nodes without collapsing duplicate IDs in ${demo.id}`
    );
  }
});

// ============================================================================
// 9. SQLITE PERSISTENCE INTEGRATION UNDER ADVERSARIAL PAYLOADS
// ============================================================================

test('ADVERSARIAL: Server project persistence handles imported and normalized projects cleanly', async () => {
  // 1. Register test user
  const regRes = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Adversarial Tester', email: 'adversarial@madera.com', password: 'password123' })
  });
  assert.equal(regRes.status, 201);
  const { token } = await regRes.json();
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 2. Successfully save a project imported from envelope with serialized string
  const rawEnvelope = {
    name: 'Gabinete Importado Alta Resistencia',
    data: JSON.stringify({
      settings: { height: 900, depth: 600, thickness: 18 },
      columns: [
        { width: 800, root: { type: 'multiple', dir: 'v', children: [{ type: 'shelf', size: 400 }, { type: 'drawer', size: 450, count: 2 }] } }
      ]
    })
  };
  const imported = processImportJson(JSON.stringify(rawEnvelope));

  const saveRes = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ name: imported.name, data: imported.data })
  });
  assert.equal(saveRes.status, 201);
  const savedProject = await saveRes.json();
  assert.ok(savedProject.id);

  // 3. Fetch saved project and verify round-trip fidelity
  const fetchRes = await fetch(`${baseUrl}/api/projects/${savedProject.id}`, { headers: authHeaders });
  assert.equal(fetchRes.status, 200);
  const fetched = await fetchRes.json();

  assert.equal(fetched.name, 'Gabinete Importado Alta Resistencia');
  assert.equal(fetched.data.settings.height, 900);
  assert.equal(fetched.data.columns.length, 1);
  assert.equal(fetched.data.columns[0].width, 800);
  assert.equal(fetched.data.columns[0].root.children.length, 2);

  // 4. Verify layout computation succeeds on fetched project data
  const layout = computeLayout(fetched.data);
  assert.equal(layout.totalW, 836);
  assert.ok(layout.cutlist.total > 0);
});
