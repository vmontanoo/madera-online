import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLayout, DEFAULTS, FRONTS } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const appJsPath = path.join(projectRoot, 'public', 'js', 'app.js');
const modelJsPath = path.join(projectRoot, 'public', 'js', 'model.js');
const styleCssPath = path.join(projectRoot, 'public', 'style.css');

// Helper to collect all node IDs in a tree
function collectAllModuleIds(project) {
  const ids = [];
  const walk = (n) => {
    if (!n) return;
    ids.push(n.id);
    if (Array.isArray(n.children)) {
      n.children.forEach(walk);
    }
  };
  (project.columns || []).forEach((c) => walk(c.root));
  return ids;
}

// Helper to clone a project deeply
function cloneProject(p) {
  return JSON.parse(JSON.stringify(p));
}

// ============================================================================
// SUITE 1: Deep Module Duplication & Zero UID Collisions Across 50 Duplications
// ============================================================================

test('CHALLENGER-M3-2.1: Deeply nested module hierarchy duplication preserves structure with fresh UIDs', () => {
  // Construct a 4-level deep modular tree:
  // Column 1 -> Container V ('root1')
  //   -> Child 1: Shelf ('shelf_top', 300mm)
  //   -> Child 2: Container H ('sub_h', 600mm)
  //        -> Subchild 2A: Shelf with sliding door ('leaf_sliding', 250mm)
  //        -> Subchild 2B: Container V ('sub_v', 350mm)
  //             -> Leaf 1: Drawer unit count=3 ('leaf_drawer', 200mm)
  //             -> Leaf 2: Shelf with bifold door ('leaf_bifold', 200mm)
  //             -> Leaf 3: Shelf with lift-up door ('leaf_liftup', 200mm)
  const project = {
    settings: { ...DEFAULTS },
    columns: [
      {
        id: 'col_1',
        width: 800,
        root: {
          id: 'root1',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            { id: 'shelf_top', type: 'shelf', size: 300 },
            {
              id: 'sub_h',
              type: 'multiple',
              dir: 'h',
              size: 600,
              children: [
                { id: 'leaf_sliding', type: 'shelf', size: 250, front: 'sliding' },
                {
                  id: 'sub_v',
                  type: 'multiple',
                  dir: 'v',
                  size: 350,
                  children: [
                    { id: 'leaf_drawer', type: 'drawer', size: 200, count: 3 },
                    { id: 'leaf_bifold', type: 'shelf', size: 200, front: 'bifold' },
                    { id: 'leaf_liftup', type: 'shelf', size: 200, front: 'lift-up', pull: 'profile' },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  };

  const initialIds = collectAllModuleIds(project);
  assert.equal(initialIds.length, 8, 'Initial tree must contain exactly 8 modules');

  // Duplicate the complex sub_h container module
  const dup = M.duplicateModule(project, 'sub_h');
  assert.ok(dup, 'duplicateModule must return the cloned module node');

  // Verify container 'root1' now has 3 children
  const colRoot = project.columns[0].root;
  assert.equal(colRoot.children.length, 3, 'Root container must now contain 3 children');
  assert.equal(colRoot.children[0].id, 'shelf_top');
  assert.equal(colRoot.children[1].id, 'sub_h');
  assert.equal(colRoot.children[2].id, dup.id, 'Duplicate must be placed right after sub_h');

  // Verify that all IDs in the cloned tree are fresh and unique
  const postIds = collectAllModuleIds(project);
  assert.equal(postIds.length, 14, 'Tree must now contain 8 + 6 = 14 modules');
  const uniquePostIds = new Set(postIds);
  assert.equal(uniquePostIds.size, 14, 'All 14 module IDs must be strictly unique');

  // Verify internal structure of the cloned container
  assert.equal(dup.type, 'multiple');
  assert.equal(dup.dir, 'h');
  assert.equal(dup.size, 600);
  assert.equal(dup.children.length, 2);

  const dupChildA = dup.children[0];
  const dupChildB = dup.children[1];
  assert.equal(dupChildA.type, 'shelf');
  assert.equal(dupChildA.front, 'sliding');
  assert.notEqual(dupChildA.id, 'leaf_sliding');

  assert.equal(dupChildB.type, 'multiple');
  assert.equal(dupChildB.dir, 'v');
  assert.notEqual(dupChildB.id, 'sub_v');
  assert.equal(dupChildB.children.length, 3);

  const [dupDrawer, dupBifold, dupLiftup] = dupChildB.children;
  assert.equal(dupDrawer.type, 'drawer');
  assert.equal(dupDrawer.count, 3);
  assert.notEqual(dupDrawer.id, 'leaf_drawer');

  assert.equal(dupBifold.type, 'shelf');
  assert.equal(dupBifold.front, 'bifold');
  assert.notEqual(dupBifold.id, 'leaf_bifold');

  assert.equal(dupLiftup.type, 'shelf');
  assert.equal(dupLiftup.front, 'lift-up');
  assert.equal(dupLiftup.pull, 'profile');
  assert.notEqual(dupLiftup.id, 'leaf_liftup');

  // Verify computeLayout runs successfully on the duplicated structure
  const layout = computeLayout(project);
  assert.ok(layout, 'computeLayout must succeed on duplicated nested project');
  assert.ok(layout.pieces.length > 10, 'Must produce 3D carcass and door pieces');
  assert.ok(layout.cutlist.total > 0, 'Must compute a valid total price');
});

test('CHALLENGER-M3-2.2: Stress test 50 consecutive duplications with ZERO UID collisions', () => {
  const baseProject = {
    settings: { ...DEFAULTS },
    columns: [
      {
        id: 'col_stress',
        width: 1000,
        root: {
          id: 'root_stress',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            {
              id: 'target_module',
              type: 'multiple',
              dir: 'h',
              size: 500,
              children: [
                { id: 'sub_1', type: 'shelf', size: 250, front: 'doors' },
                {
                  id: 'sub_2',
                  type: 'multiple',
                  dir: 'v',
                  size: 250,
                  children: [
                    { id: 'sub_2_1', type: 'drawer', size: 100, count: 2 },
                    { id: 'sub_2_2', type: 'shelf', size: 150, front: 'sliding' },
                  ],
                },
              ],
            },
          ],
        },
      },
    ],
  };

  const project = cloneProject(baseProject);
  const initialIds = new Set(collectAllModuleIds(project));
  const allGeneratedIds = new Set(initialIds);

  const NUM_DUPLICATIONS = 50;
  const NODES_PER_TARGET = 5; // target_module (1) + sub_1 (1) + sub_2 (1) + sub_2_1 (1) + sub_2_2 (1)

  for (let i = 0; i < NUM_DUPLICATIONS; i++) {
    const dup = M.duplicateModule(project, 'target_module');
    assert.ok(dup, `Duplication #${i + 1} must succeed`);
    assert.ok(typeof dup.id === 'string' && dup.id.length > 0, `Duplication #${i + 1} must produce non-empty id`);

    // Collect all IDs inside this specific clone
    const cloneIds = [];
    const walkClone = (n) => {
      cloneIds.push(n.id);
      if (Array.isArray(n.children)) n.children.forEach(walkClone);
    };
    walkClone(dup);

    assert.equal(cloneIds.length, NODES_PER_TARGET, `Duplication #${i + 1} must have exactly ${NODES_PER_TARGET} nodes`);

    // Verify zero collisions with any previously generated IDs
    for (const id of cloneIds) {
      assert.ok(
        !allGeneratedIds.has(id),
        `CRITICAL: ID collision detected at iteration ${i + 1} for UID "${id}"`
      );
      allGeneratedIds.add(id);
    }
  }

  // Total unique IDs must equal initial (6) + 50 * 5 = 256
  const expectedTotal = initialIds.size + NUM_DUPLICATIONS * NODES_PER_TARGET;
  assert.equal(allGeneratedIds.size, expectedTotal, `Expected ${expectedTotal} unique IDs across 50 duplications`);

  // Verify root children count: 1 original + 50 duplicates = 51
  assert.equal(project.columns[0].root.children.length, 51);

  // Verify computeLayout executes cleanly without error
  const layout = computeLayout(project);
  assert.ok(layout.totalW > 0);
  assert.ok(layout.cutlist.total > 0);
  assert.ok(Number.isFinite(layout.cutlist.total));
});

test('CHALLENGER-M3-2.3: Cascading duplication (duplicate clone, then duplicate clone child)', () => {
  const project = {
    settings: { ...DEFAULTS },
    columns: [
      {
        id: 'c1',
        width: 800,
        root: {
          id: 'v_root',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            {
              id: 'box_a',
              type: 'multiple',
              dir: 'h',
              size: 400,
              children: [
                { id: 'leaf_a1', type: 'shelf', size: 200, front: 'left-door' },
                { id: 'leaf_a2', type: 'shelf', size: 200, front: 'right-door' },
              ],
            },
          ],
        },
      },
    ],
  };

  // Step 1: Duplicate box_a -> clone_1
  const clone1 = M.duplicateModule(project, 'box_a');
  assert.ok(clone1);
  assert.notEqual(clone1.id, 'box_a');

  // Step 2: Duplicate clone_1 -> clone_2
  const clone2 = M.duplicateModule(project, clone1.id);
  assert.ok(clone2);
  assert.notEqual(clone2.id, clone1.id);
  assert.notEqual(clone2.id, 'box_a');

  // Step 3: Duplicate a child inside clone_2
  const targetChild = clone2.children[0];
  const cloneChild = M.duplicateModule(project, targetChild.id);
  assert.ok(cloneChild);
  assert.notEqual(cloneChild.id, targetChild.id);

  // clone_2 must now have 3 children
  const foundClone2 = M.find(project, clone2.id);
  assert.equal(foundClone2.node.children.length, 3);
  assert.equal(foundClone2.node.children[1].id, cloneChild.id);

  // Overall uniqueness
  const allIds = collectAllModuleIds(project);
  const idSet = new Set(allIds);
  assert.equal(idSet.size, allIds.length, 'All IDs across cascading duplication chain must be unique');
});

// ============================================================================
// SUITE 2: Root Column Duplication (!f.parent) & Wrapper Integrity
// ============================================================================

test('CHALLENGER-M3-2.4: Duplicating column root module wraps column into vertical container', () => {
  const project = {
    settings: { ...DEFAULTS },
    columns: [
      {
        id: 'col_single',
        width: 700,
        root: { id: 'single_shelf', type: 'shelf', size: 1, front: 'bifold', pull: 'knob' },
      },
    ],
  };

  // Check state before duplication
  const fBefore = M.find(project, 'single_shelf');
  assert.ok(fBefore);
  assert.equal(fBefore.parent, null, 'Root module must have no parent');
  assert.equal(fBefore.col.root.id, 'single_shelf');

  // Duplicate the root module
  const dup = M.duplicateModule(project, 'single_shelf');
  assert.ok(dup, 'duplicateModule must return the duplicate node');

  // The column root must now be a container multiple 'v'
  const newRoot = project.columns[0].root;
  assert.equal(newRoot.type, 'multiple', 'New column root must be a multiple container');
  assert.equal(newRoot.dir, 'v', 'New column root must have vertical direction');
  assert.equal(newRoot.size, 1);
  assert.notEqual(newRoot.id, 'single_shelf', 'New column root must have a new unique ID');
  assert.equal(newRoot.children.length, 2, 'New column root must have exactly 2 children');

  const [origChild, dupChild] = newRoot.children;

  // Verify origChild properties
  assert.equal(origChild.type, 'shelf');
  assert.equal(origChild.front, 'bifold');
  assert.equal(origChild.pull, 'knob');
  assert.equal(origChild.size, 1);

  // Verify dupChild properties
  assert.equal(dupChild.id, dup.id);
  assert.equal(dupChild.type, 'shelf');
  assert.equal(dupChild.front, 'bifold');
  assert.equal(dupChild.pull, 'knob');
  assert.equal(dupChild.size, 1);

  // Verify IDs are distinct
  assert.notEqual(origChild.id, dupChild.id);
  assert.notEqual(newRoot.id, origChild.id);
  assert.notEqual(newRoot.id, dupChild.id);

  // Verify computeLayout produces correct 2-tiered cell geometry
  const layout = computeLayout(project);
  assert.ok(layout.cells[origChild.id], 'Original child cell must exist in layout');
  assert.ok(layout.cells[dupChild.id], 'Duplicate child cell must exist in layout');
  assert.ok(layout.cells[newRoot.id], 'Wrapper container cell must exist in layout');

  // Each child should get roughly half height (minus thickness of middle shelf)
  const cellOrig = layout.cells[origChild.id];
  const cellDup = layout.cells[dupChild.id];
  assert.ok(Math.abs(cellOrig.h - cellDup.h) < 2, 'Both halves must have symmetric height');
});

test('CHALLENGER-M3-2.5: Duplicating root of column in multi-column furniture does not affect other columns', () => {
  const project = {
    settings: { ...DEFAULTS },
    columns: [
      { id: 'c1', width: 500, root: { id: 'root_c1', type: 'shelf', size: 1 } },
      { id: 'c2', width: 600, root: { id: 'root_c2', type: 'drawer', size: 1, count: 4 } },
      { id: 'c3', width: 500, root: { id: 'root_c3', type: 'rail', size: 1 } },
    ],
  };

  // Duplicate column 2 root
  const dup = M.duplicateModule(project, 'root_c2');
  assert.ok(dup);

  // Verify c1 and c3 roots are untouched
  assert.equal(project.columns[0].root.id, 'root_c1');
  assert.equal(project.columns[0].root.type, 'shelf');

  assert.equal(project.columns[2].root.id, 'root_c3');
  assert.equal(project.columns[2].root.type, 'rail');

  // Verify c2 root is wrapped
  const c2Root = project.columns[1].root;
  assert.equal(c2Root.type, 'multiple');
  assert.equal(c2Root.dir, 'v');
  assert.equal(c2Root.children.length, 2);
  assert.equal(c2Root.children[0].type, 'drawer');
  assert.equal(c2Root.children[0].count, 4);
  assert.equal(c2Root.children[1].type, 'drawer');
  assert.equal(c2Root.children[1].count, 4);
});

test('CHALLENGER-M3-2.6: Repeated root duplication wraps vertically into nested hierarchies', () => {
  const project = {
    settings: { ...DEFAULTS },
    columns: [{ id: 'col1', width: 600, root: { id: 'init_mod', type: 'shelf', size: 1 } }],
  };

  // 1st duplication on single leaf root
  const dup1 = M.duplicateModule(project, 'init_mod');
  assert.ok(dup1);
  const root1 = project.columns[0].root;
  assert.equal(root1.type, 'multiple');
  assert.equal(root1.children.length, 2);

  // 2nd duplication on the newly formed container root
  const dup2 = M.duplicateModule(project, root1.id);
  assert.ok(dup2);
  const root2 = project.columns[0].root;
  assert.equal(root2.type, 'multiple');
  assert.equal(root2.children.length, 2);
  assert.equal(root2.children[1].id, dup2.id);

  // Verify all nodes are valid
  const allIds = collectAllModuleIds(project);
  assert.equal(new Set(allIds).size, allIds.length);

  const layout = computeLayout(project);
  assert.ok(layout.cutlist.total > 0);
});

// ============================================================================
// SUITE 3: Adversarial Edge Cases & Fault Tolerance
// ============================================================================

test('CHALLENGER-M3-2.7: duplicateModule on non-existent IDs returns null safely', () => {
  const project = M.defaultProject();

  const nonExistentIds = [
    'non-existent',
    'm999999999',
    '',
    '   ',
    '__proto__',
    'constructor',
    'null',
    'undefined',
    12345,
    null,
    undefined,
    {},
    [],
  ];

  nonExistentIds.forEach((id) => {
    assert.doesNotThrow(() => {
      const result = M.duplicateModule(project, id);
      assert.equal(result, null, `duplicateModule with id "${id}" must return null`);
    });
  });
});

test('CHALLENGER-M3-2.8: duplicateModule on already deleted module returns null safely', () => {
  const project = M.defaultProject();
  const targetId = project.columns[0].root.children[0].id;
  assert.ok(targetId);

  // Delete the module
  const delResult = M.deleteModule(project, targetId);
  assert.ok(delResult !== undefined);

  // Confirm targetId no longer exists
  assert.equal(M.find(project, targetId), null);

  // Attempt to duplicate the deleted module
  const dupResult = M.duplicateModule(project, targetId);
  assert.equal(dupResult, null, 'Duplicating deleted module must return null');
});

test('CHALLENGER-M3-2.9: duplicateModule on project with empty columns returns null', () => {
  const emptyProject = {
    settings: { ...DEFAULTS },
    columns: [],
  };

  assert.doesNotThrow(() => {
    const res = M.duplicateModule(emptyProject, 'any-id');
    assert.equal(res, null, 'Empty columns must return null');
  });
});

test('CHALLENGER-M3-2.10: Duplicating after intermediate sibling deletions preserves contiguous indices', () => {
  const project = {
    settings: { ...DEFAULTS },
    columns: [
      {
        id: 'c1',
        width: 800,
        root: {
          id: 'v_root',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            { id: 'mod_1', type: 'shelf', size: 100 },
            { id: 'mod_2', type: 'shelf', size: 100 },
            { id: 'mod_3', type: 'shelf', size: 100 },
            { id: 'mod_4', type: 'shelf', size: 100 },
          ],
        },
      },
    ],
  };

  // Delete mod_2
  M.deleteModule(project, 'mod_2');
  const root = project.columns[0].root;
  assert.equal(root.children.length, 3);
  assert.deepEqual(root.children.map((c) => c.id), ['mod_1', 'mod_3', 'mod_4']);

  // Duplicate mod_3
  const dup3 = M.duplicateModule(project, 'mod_3');
  assert.ok(dup3);
  assert.equal(root.children.length, 4);
  assert.deepEqual(root.children.map((c) => c.id), ['mod_1', 'mod_3', dup3.id, 'mod_4']);

  // Verify no undefined or sparse slots
  root.children.forEach((c, idx) => {
    assert.ok(c && typeof c === 'object', `Slot ${idx} must contain valid object`);
    assert.ok(c.id, `Slot ${idx} must have non-empty id`);
  });
});

test('CHALLENGER-M3-2.11: Module duplication with extreme parameters (count=10, custom pull, 0 size fallback)', () => {
  const project = {
    settings: { ...DEFAULTS },
    columns: [
      {
        id: 'c1',
        width: 900,
        root: {
          id: 'v_root',
          type: 'multiple',
          dir: 'v',
          size: 1,
          children: [
            { id: 'extreme_drawer', type: 'drawer', size: 555.55, count: 10, pull: 'profile' },
          ],
        },
      },
    ],
  };

  const dup = M.duplicateModule(project, 'extreme_drawer');
  assert.ok(dup);
  assert.equal(dup.type, 'drawer');
  assert.equal(dup.count, 10);
  assert.equal(dup.size, 555.55);
  assert.equal(dup.pull, 'profile');
  assert.notEqual(dup.id, 'extreme_drawer');

  // Verify computeLayout handles high drawer count
  const layout = computeLayout(project);
  assert.equal(layout.hardware.slides, 20, '10 drawers * 2 modules = 20 drawer slides');
});

// ============================================================================
// SUITE 4: UI Constants Validation (VALID_NEW_TYPES & Dock UI Integrity)
// ============================================================================

test('CHALLENGER-M3-2.12: VALID_NEW_TYPES in public/js/app.js strictly contains shelf, drawer, rail with NO door types', () => {
  assert.ok(fs.existsSync(appJsPath), 'public/js/app.js must exist');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // 1. Verify exact export definition
  const exportMatch = appJs.match(/export\s+const\s+VALID_NEW_TYPES\s*=\s*\[([^\]]+)\]/);
  assert.ok(exportMatch, 'VALID_NEW_TYPES must be exported as an array in app.js');

  const rawElements = exportMatch[1]
    .split(',')
    .map((s) => s.trim().replace(/['"]/g, ''))
    .filter(Boolean);

  // 2. Exactly three structural classes
  assert.deepEqual(
    rawElements,
    ['shelf', 'drawer', 'rail'],
    `VALID_NEW_TYPES must be exactly ['shelf', 'drawer', 'rail'], but was [${rawElements.join(', ')}]`
  );

  // 3. Statically assert NO door types exist in VALID_NEW_TYPES
  const forbiddenDoorTypes = ['doors', 'left-door', 'right-door', 'sliding', 'bifold', 'lift-up'];
  forbiddenDoorTypes.forEach((dt) => {
    assert.ok(
      !rawElements.includes(dt),
      `CRITICAL: VALID_NEW_TYPES must NOT include door type "${dt}"`
    );
  });
});

test('CHALLENGER-M3-2.13: FRONT_OPTIONS in public/js/app.js contains all 7 front options with Spanish labels', () => {
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // Verify FRONT_OPTIONS export
  assert.ok(appJs.includes('export const FRONT_OPTIONS'), 'FRONT_OPTIONS must be exported in app.js');

  const expectedFrontIds = ['none', 'doors', 'left-door', 'right-door', 'sliding', 'bifold', 'lift-up'];
  expectedFrontIds.forEach((id) => {
    assert.ok(
      appJs.includes(`id: '${id}'`),
      `FRONT_OPTIONS must define option with id: '${id}'`
    );
  });
});

test('CHALLENGER-M3-2.14: 2-Tier Dock UI architecture in public/js/app.js has #dupMod and pruned #newType', () => {
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // 1. Tier 1: Primary Controls & Geometry
  assert.ok(appJs.includes('dock-tier-primary'), 'Dock must contain dock-tier-primary');
  assert.ok(appJs.includes('dock-grid-2'), 'Dock must contain dock-grid-2');
  assert.ok(appJs.includes('id="frontSelect"'), 'Dock must contain dedicated #frontSelect');
  assert.ok(appJs.includes('id="newType"'), 'Dock must contain subdivision selector #newType');

  // 2. Pruned newType selector strictly uses VALID_NEW_TYPES
  assert.ok(
    appJs.includes('typeOpts(state.newType || \'shelf\', VALID_NEW_TYPES)'),
    '#newType options must be populated from VALID_NEW_TYPES'
  );

  // 3. Tier 2: Actions & Deletion
  assert.ok(appJs.includes('dock-tier-actions'), 'Dock must contain dock-tier-actions');
  assert.ok(appJs.includes('id="dupMod"'), 'Dock must contain duplication button #dupMod');
  assert.ok(appJs.includes('id="clearSel"'), 'Dock must contain deselect button #clearSel');
  assert.ok(appJs.includes('id="del"'), 'Dock must contain delete button #del');

  // 4. Verify duplication click binding
  assert.ok(
    appJs.includes("bind('#dupMod', 'onclick'"),
    '#dupMod must be bound to onclick handler'
  );
  assert.ok(
    appJs.includes('M.duplicateModule(state.project, sid)'),
    '#dupMod onclick must call M.duplicateModule'
  );

  // 5. Verify clear selection click binding
  assert.ok(
    appJs.includes("bind('#clearSel', 'onclick'"),
    '#clearSel must be bound to onclick handler'
  );
});

test('CHALLENGER-M3-2.15: 2D Canvas SVG renderer properly handles door-front kind alongside front', () => {
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // Verify that door-front pieces are recognized as frontals in drawCanvas
  assert.ok(
    appJs.includes("p.kind === 'front' || p.kind === 'door-front'"),
    'drawCanvas in app.js must recognize p.kind === "door-front" as frontal piece'
  );
});

test('CHALLENGER-M3-2.16: style.css defines styling for 2-Tier Dock and duplication button', () => {
  const css = fs.readFileSync(styleCssPath, 'utf8');

  const requiredClasses = [
    '.dock-tier',
    '.dock-tier-primary',
    '.dock-tier-actions',
    '.tier-label',
    '.dock-grid-2',
    '.dock-field',
    '.input-with-unit',
    '.dock-subdiv-group',
    '.subdiv-header',
    '.subdiv-select',
    '.subdiv-buttons',
    '.btn-subdiv',
    '.tier-2-actions',
    '.btn-tier2',
  ];

  requiredClasses.forEach((cls) => {
    assert.ok(css.includes(cls), `style.css must define selector "${cls}"`);
  });
});
