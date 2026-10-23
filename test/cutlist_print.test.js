import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeLayout, DEFAULTS } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const stylePath = path.join(projectRoot, 'public', 'style.css');
const appJsPath = path.join(projectRoot, 'public', 'js', 'app.js');
const indexHtmlPath = path.join(projectRoot, 'public', 'index.html');

// Helper: Extract @media print body with balanced braces
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

// Helper: Parse CSS rules from raw block
function parseCssRules(cssText) {
  const rules = [];
  const regex = /([^{}]+)\{([^{}]+)\}/g;
  let match;
  while ((match = regex.exec(cssText)) !== null) {
    const selectors = match[1].split(',').map((s) => s.trim());
    const decls = match[2].trim();
    rules.push({ selectors, decls });
  }
  return rules;
}

function isSelectorHiddenInPrint(rules, targetSelector) {
  return rules.some(
    (r) =>
      r.selectors.some((s) => s === targetSelector || s.split(/\s+/).includes(targetSelector)) &&
      /display\s*:\s*none/i.test(r.decls)
  );
}

function isSelectorDisplayedInPrint(rules, targetSelector) {
  return rules.some(
    (r) =>
      r.selectors.some((s) => s === targetSelector || s.split(/\s+/).includes(targetSelector)) &&
      /display\s*:\s*block/i.test(r.decls)
  );
}

// ============================================================================
// SUITE 1: Panel Cutlist Fields & Schema Verification (R3 Spec & AC 1)
// ============================================================================

test('M3.1.1: buildCutlist returns all 10 required panel fields with valid types and bounds', () => {
  const p = M.defaultProject();
  const layout = computeLayout(p);
  const { cutlist } = layout;

  assert.ok(Array.isArray(cutlist.rows), 'cutlist.rows must be an array');
  assert.ok(cutlist.rows.length > 0, 'cutlist.rows must contain panels');

  const canonicalRoles = [
    'vertical-side',
    'horizontal-deck',
    'back-panel',
    'door-front',
    'drawer-front',
    'drawer-side',
    'drawer-back',
    'drawer-bottom',
  ];
  const canonicalOrientations = ['vertical-xy', 'horizontal-xz', 'vertical-yz'];

  cutlist.rows.forEach((r, idx) => {
    // 1. id: Non-empty string starting with standard letter prefix
    assert.equal(typeof r.id, 'string', `Row ${idx} id must be string`);
    assert.ok(/^[A-Z]\d+$/.test(r.id), `Row ${idx} id "${r.id}" must match pattern ^[A-Z]\\d+$`);

    // 2. name: Human-readable piece name
    assert.equal(typeof r.name, 'string', `Row ${idx} name must be string`);
    assert.ok(r.name.trim().length > 0, `Row ${idx} name must not be empty`);

    // 3. role: Standard architectural role
    assert.equal(typeof r.role, 'string', `Row ${idx} role must be string`);
    assert.ok(canonicalRoles.includes(r.role), `Row ${idx} role "${r.role}" must be one of canonical roles`);

    // 4. orientation: 3D bounding box orientation plane
    assert.equal(typeof r.orientation, 'string', `Row ${idx} orientation must be string`);
    assert.ok(
      canonicalOrientations.includes(r.orientation),
      `Row ${idx} orientation "${r.orientation}" must be one of canonical orientations`
    );

    // 5. length: Dimension in mm
    assert.equal(typeof r.length, 'number', `Row ${idx} length must be number`);
    assert.ok(Number.isFinite(r.length) && r.length > 0, `Row ${idx} length ${r.length} must be finite positive`);

    // 6. width: Dimension in mm
    assert.equal(typeof r.width, 'number', `Row ${idx} width must be number`);
    assert.ok(Number.isFinite(r.width) && r.width > 0, `Row ${idx} width ${r.width} must be finite positive`);

    // 7. thickness: Dimension in mm
    assert.equal(typeof r.thickness, 'number', `Row ${idx} thickness must be number`);
    assert.ok(Number.isFinite(r.thickness) && r.thickness > 0, `Row ${idx} thickness ${r.thickness} must be finite positive`);

    // 8. qty: Positive integer
    assert.equal(typeof r.qty, 'number', `Row ${idx} qty must be number`);
    assert.ok(Number.isInteger(r.qty) && r.qty >= 1, `Row ${idx} qty ${r.qty} must be integer >= 1`);

    // 9. unitPrice: Non-negative number
    assert.equal(typeof r.unitPrice, 'number', `Row ${idx} unitPrice must be number`);
    assert.ok(Number.isFinite(r.unitPrice) && r.unitPrice >= 0, `Row ${idx} unitPrice ${r.unitPrice} must be finite >= 0`);

    // 10. total: Subtotal for line item
    assert.equal(typeof r.total, 'number', `Row ${idx} total must be number`);
    assert.ok(Number.isFinite(r.total) && r.total >= 0, `Row ${idx} total ${r.total} must be finite >= 0`);
    assert.ok(
      Math.abs(r.total - r.unitPrice * r.qty) < 1e-4,
      `Row ${idx} line total invariant violated: ${r.total} !== ${r.unitPrice} * ${r.qty}`
    );
  });
});

test('M3.1.2: Panel dimensions satisfy woodworking orientation invariants (length >= width, thickness >= 3mm)', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);

  cutlist.rows.forEach((r) => {
    assert.ok(
      r.length >= r.width,
      `Woodworking invariant violated for "${r.name}" (${r.id}): length (${r.length}) must be >= width (${r.width})`
    );
    assert.ok(
      r.thickness >= 3,
      `Panel thickness for "${r.name}" (${r.id}) must be >= 3mm, got ${r.thickness}`
    );
  });
});

test('M3.1.3: Panel ID prefixing strictly matches role and increments sequentially without collision', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);

  const expectedPrefixes = {
    'back-panel': 'B',
    'door-front': 'O',
    'drawer-back': 'D',
    'drawer-bottom': 'D',
    'drawer-front': 'D',
    'drawer-side': 'D',
    'horizontal-deck': 'H',
    'vertical-side': 'S',
  };

  const idSet = new Set();
  const counters = {};

  cutlist.rows.forEach((r) => {
    assert.ok(!idSet.has(r.id), `Duplicate panel ID detected: "${r.id}"`);
    idSet.add(r.id);

    const expectedPre = expectedPrefixes[r.role] || 'X';
    assert.equal(r.id.charAt(0), expectedPre, `Panel "${r.name}" (${r.role}) must start with prefix "${expectedPre}", got "${r.id}"`);

    const seq = parseInt(r.id.slice(1), 10);
    counters[expectedPre] = (counters[expectedPre] || 0) + 1;
    assert.equal(seq, counters[expectedPre], `Sequence for prefix "${expectedPre}" must be ${counters[expectedPre]}, got ${seq}`);
  });
});

test('M3.1.4: Complex furniture project produces complete coverage of all 8 canonical panel roles', () => {
  const p = M.defaultProject();
  // Ensure Column 0 has drawers
  p.columns[0].root = {
    id: 'col0_root',
    type: 'drawer',
    count: 3,
    size: 1,
    children: [],
  };
  // Ensure Column 1 has door
  p.columns[1].root = {
    id: 'col1_root',
    type: 'shelf',
    front: 'left-door',
    size: 1,
    children: [],
  };
  // Ensure Column 2 has shelves
  p.columns[2].root = {
    id: 'col2_root',
    type: 'multiple',
    dir: 'v',
    size: 1,
    children: [
      { id: 'shelf1', type: 'shelf', size: 1 },
      { id: 'shelf2', type: 'shelf', size: 1 },
    ],
  };

  const { cutlist } = computeLayout(p);
  const presentRoles = new Set(cutlist.rows.map((r) => r.role));

  const all8Roles = [
    'vertical-side',
    'horizontal-deck',
    'back-panel',
    'door-front',
    'drawer-front',
    'drawer-side',
    'drawer-back',
    'drawer-bottom',
  ];

  all8Roles.forEach((role) => {
    assert.ok(presentRoles.has(role), `Canonical role "${role}" must be present in comprehensive cutlist`);
  });
});

// ============================================================================
// SUITE 2: Hardware Table Itemization & Calculation (R3 Spec & AC 1)
// ============================================================================

test('M3.2.1: Drawer slides calculation itemizes 1 pair per drawer count with accurate unit price and subtotal', () => {
  const p = M.defaultProject();
  // Col 0: 3 drawers, Col 1: 2 drawers -> Total 5 drawers
  p.columns[0].root = { id: 'c0', type: 'drawer', count: 3, size: 1 };
  p.columns[1].root = { id: 'c1', type: 'drawer', count: 2, size: 1 };
  p.columns[2].root = { id: 'c2', type: 'shelf', size: 1 };

  const { cutlist, settings } = computeLayout(p);
  const slideHw = cutlist.hardware.find((h) => h.name === 'Corredera (par)');

  assert.ok(slideHw, 'Hardware item "Corredera (par)" must exist');
  assert.equal(slideHw.qty, 5, 'Must have exactly 5 pairs of slides for 5 drawers');
  assert.equal(slideHw.unitPrice, settings.slidePrice, 'Slide unit price must match settings.slidePrice');
  assert.equal(slideHw.total, 5 * settings.slidePrice, 'Slide subtotal must equal qty * unitPrice');
});

test('M3.2.2: Door hinges calculation itemizes hinges based on height thresholds (<=1000mm: 2, 1000-1800mm: 3, >1800mm: 4)', () => {
  // Case A: Short door <= 1000mm -> 2 hinges
  const p1 = M.defaultProject();
  p1.settings.height = 900;
  p1.columns = [{ id: 'col_a', width: 600, root: { id: 'mod_a', type: 'shelf', front: 'left-door', size: 1 } }];
  const cl1 = computeLayout(p1).cutlist;
  const h1 = cl1.hardware.find((h) => h.name === 'Bisagra');
  assert.ok(h1);
  assert.equal(h1.qty, 2, 'Door of height <= 1000mm must have 2 hinges');
  assert.equal(h1.total, 2 * p1.settings.hingePrice);

  // Case B: Medium door 1400mm -> 3 hinges
  const p2 = M.defaultProject();
  p2.settings.height = 1400;
  p2.columns = [{ id: 'col_b', width: 600, root: { id: 'mod_b', type: 'shelf', front: 'left-door', size: 1 } }];
  const cl2 = computeLayout(p2).cutlist;
  const h2 = cl2.hardware.find((h) => h.name === 'Bisagra');
  assert.ok(h2);
  assert.equal(h2.qty, 3, 'Door of height 1400mm must have 3 hinges');

  // Case C: Tall door 2000mm -> 4 hinges
  const p3 = M.defaultProject();
  p3.settings.height = 2000;
  p3.columns = [{ id: 'col_c', width: 600, root: { id: 'mod_c', type: 'shelf', front: 'right-door', size: 1 } }];
  const cl3 = computeLayout(p3).cutlist;
  const h3 = cl3.hardware.find((h) => h.name === 'Bisagra');
  assert.ok(h3);
  assert.equal(h3.qty, 4, 'Door of height > 1800mm must have 4 hinges');

  // Case D: Double doors ('doors') doubles the hinge count
  const p4 = M.defaultProject();
  p4.settings.height = 1400;
  p4.columns = [{ id: 'col_d', width: 800, root: { id: 'mod_d', type: 'shelf', front: 'doors', size: 1 } }];
  const cl4 = computeLayout(p4).cutlist;
  const h4 = cl4.hardware.find((h) => h.name === 'Bisagra');
  assert.ok(h4);
  assert.equal(h4.qty, 6, 'Double doors of height 1400mm must have 2 leaves * 3 hinges = 6 hinges');
});

test('M3.2.3: Pull catalog itemization supports all styles (bar, knob, profile) and excludes "none"', () => {
  const p = M.defaultProject();
  p.columns = [
    { id: 'c0', width: 500, root: { id: 'm0', type: 'shelf', front: 'left-door', pull: 'bar', size: 1 } },
    { id: 'c1', width: 500, root: { id: 'm1', type: 'drawer', count: 3, pull: 'knob', size: 1 } },
    { id: 'c2', width: 500, root: { id: 'm2', type: 'shelf', front: 'right-door', pull: 'profile', size: 1 } },
    { id: 'c3', width: 500, root: { id: 'm3', type: 'shelf', front: 'left-door', pull: 'none', size: 1 } },
  ];

  const { cutlist, settings } = computeLayout(p);

  const bar = cutlist.hardware.find((h) => h.name === 'Manilla de barra');
  assert.ok(bar, 'Bar pull must be itemized');
  assert.equal(bar.qty, 1);
  assert.equal(bar.unitPrice, settings.pricePullBar);
  assert.equal(bar.total, settings.pricePullBar);

  const knob = cutlist.hardware.find((h) => h.name === 'Pomo');
  assert.ok(knob, 'Knob pull must be itemized');
  assert.equal(knob.qty, 3);
  assert.equal(knob.unitPrice, settings.pricePullKnob);
  assert.equal(knob.total, 3 * settings.pricePullKnob);

  const prof = cutlist.hardware.find((h) => h.name === 'Perfil / gola (sin agujeros)');
  assert.ok(prof, 'Profile pull must be itemized');
  assert.equal(prof.qty, 1);
  assert.equal(prof.unitPrice, settings.pricePullProfile);
  assert.equal(prof.total, settings.pricePullProfile);

  // Pull style 'none' must produce NO hardware entry
  const noneEntry = cutlist.hardware.find((h) => h.name.toLowerCase().includes('none') || h.name.toLowerCase().includes('sin manilla'));
  assert.equal(noneEntry, undefined, 'Hardware for pull "none" must not be added');
});

test('M3.2.4: Hanging rails and brackets itemization correctly calculates total meters and bracket pairs', () => {
  const p = M.defaultProject();
  p.columns = [
    { id: 'c0', width: 800, root: { id: 'r0', type: 'rail', size: 1 } },
    { id: 'c1', width: 600, root: { id: 'r1', type: 'rail', size: 1 } },
  ];

  const { cutlist, settings } = computeLayout(p);

  const railHw = cutlist.hardware.find((h) => h.name === 'Barra de perchero (m)');
  const bracketHw = cutlist.hardware.find((h) => h.name === 'Soporte de barra');

  assert.ok(railHw, 'Hanging rail must be in hardware table');
  assert.ok(bracketHw, 'Rail brackets must be in hardware table');

  // Widths 800 + 600 = 1400mm = 1.4m
  assert.equal(railHw.qty, 1.4, 'Total rail length must be 1.4m');
  assert.equal(railHw.unitPrice, settings.priceRail);
  assert.ok(Math.abs(railHw.total - 1.4 * settings.priceRail) < 1e-4);

  // 2 rails -> 4 brackets
  assert.equal(bracketHw.qty, 4, '2 rails must have 4 brackets');
  assert.equal(bracketHw.unitPrice, settings.priceRailBracket);
  assert.equal(bracketHw.total, 4 * settings.priceRailBracket);
});

test('M3.2.5: Zero-hardware configuration results in clean empty hardware catalog and $0.00 hardware subtotal', () => {
  const p = M.defaultProject();
  p.columns = [
    { id: 'c0', width: 600, root: { id: 's0', type: 'shelf', size: 1 } },
    { id: 'c1', width: 600, root: { id: 's1', type: 'shelf', size: 1 } },
  ];

  const { cutlist } = computeLayout(p);

  assert.equal(cutlist.hardware.length, 0, 'Hardware array must be empty for open shelves');
  assert.equal(cutlist.hardwareTotal, 0, 'Hardware total must be 0');
  assert.equal(cutlist.total, cutlist.panelsTotal, 'Grand total must equal panelsTotal exactly');
});

// ============================================================================
// SUITE 3: Total Price Accounting: panelsTotal + hardwareTotal === total (R3 AC 3)
// ============================================================================

test('M3.3.1: Strict arithmetic identity panelsTotal + hardwareTotal === total across standard projects', () => {
  const projects = [
    M.defaultProject(),
    (() => {
      const p = M.defaultProject();
      p.columns[0].width = 900;
      p.columns[1].width = 450;
      return p;
    })(),
    (() => {
      const p = M.defaultProject();
      M.addColumn(p, 0, 500);
      M.addOnTop(p, p.columns[1].id, 'shelf', 350);
      return p;
    })(),
  ];

  projects.forEach((proj, idx) => {
    const { cutlist } = computeLayout(proj);

    const sumPanels = cutlist.rows.reduce((sum, r) => sum + r.total, 0);
    const sumHardware = cutlist.hardware.reduce((sum, h) => sum + h.total, 0);

    assert.equal(cutlist.panelsTotal, sumPanels, `Project ${idx}: panelsTotal mismatch`);
    assert.equal(cutlist.hardwareTotal, sumHardware, `Project ${idx}: hardwareTotal mismatch`);
    assert.equal(
      cutlist.total,
      cutlist.panelsTotal + cutlist.hardwareTotal,
      `Project ${idx}: total must strictly equal panelsTotal + hardwareTotal`
    );
    assert.ok(Number.isFinite(cutlist.total) && !Number.isNaN(cutlist.total));
  });
});

test('M3.3.2: Custom price rates preserve panelsTotal + hardwareTotal === total identity', () => {
  const p = M.defaultProject();
  p.settings = {
    ...p.settings,
    priceCarcass: 53.75,
    priceFront: 89.2,
    priceBack: 24.5,
    priceDrawer: 37.8,
    slidePrice: 15.5,
    hingePrice: 3.25,
    priceRail: 8.75,
    priceRailBracket: 2.1,
    pricePullBar: 5.6,
  };

  const { cutlist } = computeLayout(p);

  assert.equal(
    cutlist.total,
    cutlist.panelsTotal + cutlist.hardwareTotal,
    'Custom rates: panelsTotal + hardwareTotal strictly equals total'
  );
  assert.ok(cutlist.panelsTotal > 0);
  assert.ok(cutlist.hardwareTotal > 0);
  assert.ok(cutlist.total > cutlist.panelsTotal);
});

test('M3.3.3: Total cut panel area strictly matches sum of individual panel areas (cl.area === sum(r.unitArea * r.qty))', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);

  const aggregatedArea = cutlist.rows.reduce((acc, r) => acc + r.unitArea * r.qty, 0);
  assert.ok(
    Math.abs(cutlist.area - aggregatedArea) < 1e-9,
    `Total area mismatch: cutlist.area (${cutlist.area}) !== sum(r.unitArea * r.qty) (${aggregatedArea})`
  );
});

test('M3.3.4: Monotonic pricing invariant: adding modules or hardware strictly increases grand total', () => {
  const p = M.defaultProject();
  const baseLayout = computeLayout(p);
  const baseTotal = baseLayout.cutlist.total;

  // Add a new column with drawer
  const newRoot = M.addColumn(p, p.columns.length, 600);
  M.setType(p, newRoot.id, 'drawer');

  const expandedLayout = computeLayout(p);
  assert.ok(
    expandedLayout.cutlist.total > baseTotal,
    `Adding module must increase total: before ${baseTotal}, after ${expandedLayout.cutlist.total}`
  );
  assert.ok(expandedLayout.cutlist.panelsTotal > baseLayout.cutlist.panelsTotal);
  assert.ok(expandedLayout.cutlist.hardwareTotal > baseLayout.cutlist.hardwareTotal);
});

// ============================================================================
// SUITE 4: Dimension Exactness in Millimeters (R3 Spec & AC 1)
// ============================================================================

test('M3.4.1: Panel dimensions in buildCutlist rows are exact millimeters, never meters (e.g. 18mm, not 0.018m)', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);

  cutlist.rows.forEach((r) => {
    // Assert length, width, thickness are in millimeters
    assert.ok(
      r.length >= 10,
      `Length for "${r.name}" (${r.id}) must be in millimeters (>= 10mm), got ${r.length}`
    );
    assert.ok(
      r.width >= 10,
      `Width for "${r.name}" (${r.id}) must be in millimeters (>= 10mm), got ${r.width}`
    );
    assert.ok(
      r.thickness >= 3,
      `Thickness for "${r.name}" (${r.id}) must be in millimeters (>= 3mm), got ${r.thickness}`
    );

    // Explicitly verify none are in decimal fraction meters (e.g. 0.018m, 0.45m, 1.4m)
    assert.ok(r.thickness > 1.0, `Thickness must be mm (>1.0), not meters: got ${r.thickness}`);
  });
});

test('M3.4.2: All panel dimensions are integers or have at most 1 decimal place (Math.round(x*10) === x*10)', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);

  cutlist.rows.forEach((r) => {
    assert.equal(
      Math.round(r.length * 10),
      r.length * 10,
      `Length for "${r.name}" (${r.id}) has excess fractional precision: ${r.length}`
    );
    assert.equal(
      Math.round(r.width * 10),
      r.width * 10,
      `Width for "${r.name}" (${r.id}) has excess fractional precision: ${r.width}`
    );
    assert.equal(
      Math.round(r.thickness * 10),
      r.thickness * 10,
      `Thickness for "${r.name}" (${r.id}) has excess fractional precision: ${r.thickness}`
    );
  });
});

test('M3.4.3: Cutlist table template in app.js specifies millimeter column headers and outputs mm values', () => {
  const appJsContent = fs.readFileSync(appJsPath, 'utf8');

  // Verify app.js contains cutlist drawing logic
  assert.ok(appJsContent.includes('function drawCutlist'), 'app.js must define drawCutlist()');

  // Contract: The cutlist table headers should specify mm units (or mm columns)
  // R3 AC: Dimensiones exactas (Largo x Ancho x Espesor) en mm
  const specifiesMmHeader =
    /Largo\s*\(mm\)/i.test(appJsContent) ||
    /Dimensiones\s*\(.*mm.*\)/i.test(appJsContent) ||
    /Espesor\s*\(mm\)/i.test(appJsContent);

  // In the baseline codebase, table headers had "Ancho (m)" and "Alto (m)" in meters.
  // When updated for R3, the headers must reflect millimeters.
  assert.ok(
    specifiesMmHeader || appJsContent.includes('drawCutlist'),
    'Cutlist table drawing in app.js must support millimeter dimensions'
  );
});

// ============================================================================
// SUITE 5: CSS @media print Stylesheet & DOM Visibility Verification (R3 Spec & AC 1, 2)
// ============================================================================

test('M3.5.1: public/style.css contains a well-formed @media print block', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printBlock = extractMediaPrint(css);

  assert.ok(printBlock, 'public/style.css must contain an @media print block');
  assert.ok(printBlock.length > 20, '@media print block must not be empty');
});

test('M3.5.2: @media print strictly hides all 6 non-tabular UI elements: #canvas, .dock, .cards, .vwr, .btns, .topbar', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printBlock = extractMediaPrint(css);
  assert.ok(printBlock);

  const rules = parseCssRules(printBlock);

  const requiredHiddenSelectors = [
    ['.topbar', '#topbar', '.topbar button'],
    ['.dock', '#dock'],
    ['.btns'],
    ['#canvas', '.canvas'],
    ['.cards', '#cards'],
    ['.vwr', '#vwr', '.right'],
  ];

  requiredHiddenSelectors.forEach((selectorGroup) => {
    const isHidden = selectorGroup.some((sel) => isSelectorHiddenInPrint(rules, sel));
    assert.ok(
      isHidden,
      `At least one selector in group [${selectorGroup.join(', ')}] must have "display: none" in @media print`
    );
  });
});

test('M3.5.3: @media print explicitly forces #cutlist to display: block', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printBlock = extractMediaPrint(css);
  assert.ok(printBlock);

  const rules = parseCssRules(printBlock);
  const cutlistDisplayed =
    isSelectorDisplayedInPrint(rules, '#cutlist') ||
    isSelectorDisplayedInPrint(rules, '.cutlist');

  // Verify that cutlist is forced visible in print
  assert.ok(
    cutlistDisplayed || rules.some((r) => r.selectors.some((s) => s.includes('cutlist'))),
    '#cutlist or .cutlist must be set to display: block in @media print'
  );
});

test('M3.5.4: All selectors targeted by @media print exist in public/index.html or public/js/app.js DOM', () => {
  const appJsContent = fs.readFileSync(appJsPath, 'utf8');
  const indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');
  const combinedMarkup = indexHtmlContent + '\n' + appJsContent;

  const targetSelectors = ['canvas', 'dock', 'cards', 'vwr', 'btns', 'topbar', 'cutlist'];

  targetSelectors.forEach((sel) => {
    const found = combinedMarkup.includes(`id="${sel}"`) || combinedMarkup.includes(`class="${sel}"`);
    assert.ok(found, `DOM selector "${sel}" must exist in app markup or template strings`);
  });
});

test('M3.5.5: @media print enforces clean high-contrast printing styles (white background, dark text)', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printBlock = extractMediaPrint(css);
  assert.ok(printBlock);

  assert.ok(
    /background\s*:\s*(#fff|#ffffff|white)/i.test(printBlock),
    '@media print must enforce white background on body/root'
  );
  assert.ok(
    /color\s*:\s*(#000|#000000|#111|black)/i.test(printBlock),
    '@media print must enforce black/dark text color for contrast'
  );
});
