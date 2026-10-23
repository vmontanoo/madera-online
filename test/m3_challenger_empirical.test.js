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

// Helper: Strip CSS comments
function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Helper: Parse CSS rules from raw block
function parseCssRules(cssText) {
  const clean = stripCssComments(cssText);
  const rules = [];
  const regex = /([^{}]+)\{([^{}]+)\}/g;
  let match;
  while ((match = regex.exec(clean)) !== null) {
    const selectors = match[1].split(',').map((s) => s.trim()).filter(Boolean);
    const decls = match[2].trim();
    rules.push({ selectors, decls });
  }
  return rules;
}

// Helper: Check if selector has display: none !important in rules
function isSelectorStrictlyHidden(rules, selector) {
  return rules.some(
    (r) =>
      r.selectors.some((s) => s === selector || s.split(/\s+/).includes(selector)) &&
      /display\s*:\s*none\s*!important/i.test(r.decls)
  );
}

// Helper: Check if selector has display: block !important in rules
function isSelectorStrictlyBlock(rules, selector) {
  return rules.some(
    (r) =>
      r.selectors.some((s) => s === selector || s.split(/\s+/).includes(selector)) &&
      /display\s*:\s*block\s*!important/i.test(r.decls)
  );
}

// ============================================================================
// SUITE 1: Print Stylesheet Suppression & Forced Cutlist Visibility
// ============================================================================

test('CHALLENGER-M3-1.1: Balanced braces and well-formed @media print block in style.css', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  assert.ok(css.includes('@media print'), 'style.css must contain @media print');
  const printBlock = extractMediaPrint(css);
  assert.ok(printBlock, '@media print block must be extractable with balanced braces');
  assert.ok(printBlock.length > 200, '@media print block must be substantive');
});

test('CHALLENGER-M3-1.2: Strictly verify ALL 16 non-tabular UI elements are hidden with display:none !important', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printBlock = extractMediaPrint(css);
  const rules = parseCssRules(printBlock);

  const requiredSuppressedElements = [
    '#canvas',
    '.canvas',
    '#designPane',
    '.topbar',
    '.dock',
    '#dock',
    '.btns',
    '.rtools',
    '.cards',
    '#cards',
    '.vwr',
    '#vwr',
    '.tabs',
    '.modal-bg',
    '.modal',
    'svg',
  ];

  requiredSuppressedElements.forEach((sel) => {
    const hidden = isSelectorStrictlyHidden(rules, sel);
    assert.ok(
      hidden,
      `Non-tabular element "${sel}" MUST have "display: none !important" in @media print`
    );
  });
});

test('CHALLENGER-M3-1.3: Strictly verify #cutlist is forced visible with display: block !important and overflow: visible', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printBlock = extractMediaPrint(css);
  const rules = parseCssRules(printBlock);

  const cutlistRule = rules.find((r) => r.selectors.includes('#cutlist'));
  assert.ok(cutlistRule, '#cutlist selector rule must exist in @media print');

  assert.ok(
    /display\s*:\s*block\s*!important/i.test(cutlistRule.decls),
    '#cutlist must have display: block !important'
  );
  assert.ok(
    /overflow\s*:\s*visible\s*!important/i.test(cutlistRule.decls),
    '#cutlist must have overflow: visible !important'
  );
  assert.ok(
    /height\s*:\s*auto\s*!important/i.test(cutlistRule.decls),
    '#cutlist must have height: auto !important'
  );
  assert.ok(
    /position\s*:\s*static\s*!important/i.test(cutlistRule.decls),
    '#cutlist must have position: static !important'
  );
});

test('CHALLENGER-M3-1.4: Ancestor geometry reset (html, body, #app, .editor, .left, .cutlist) prevents truncation', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printBlock = extractMediaPrint(css);
  const rules = parseCssRules(printBlock);

  const ancestorRule = rules.find(
    (r) =>
      r.selectors.includes('html') &&
      r.selectors.includes('body') &&
      r.selectors.includes('#app') &&
      r.selectors.includes('.editor') &&
      r.selectors.includes('.left')
  );
  assert.ok(ancestorRule, 'Ancestor reset rule must target html, body, #app, .editor, .left');
  assert.ok(
    /overflow\s*:\s*visible\s*!important/i.test(ancestorRule.decls),
    'Ancestors must have overflow: visible !important'
  );
  assert.ok(
    /height\s*:\s*auto\s*!important/i.test(ancestorRule.decls),
    'Ancestors must have height: auto !important'
  );
  assert.ok(
    /background\s*:\s*#ffffff\s*!important/i.test(ancestorRule.decls),
    'Ancestors must enforce white background in print'
  );
});

test('CHALLENGER-M3-1.5: Print page rules and table pagination controls (@page, thead, tr page-break)', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printBlock = extractMediaPrint(css);

  assert.ok(/@page\s*\{[^}]*margin\s*:/i.test(printBlock), '@media print must define @page margin');

  const rules = parseCssRules(printBlock);
  const theadRule = rules.find((r) => r.selectors.includes('thead'));
  assert.ok(theadRule, 'thead rule must exist in @media print');
  assert.ok(
    /display\s*:\s*table-header-group\s*!important/i.test(theadRule.decls),
    'thead must be table-header-group !important for multi-page repeat'
  );

  const trRule = rules.find((r) => r.selectors.includes('tr'));
  assert.ok(trRule, 'tr rule must exist in @media print');
  assert.ok(
    /page-break-inside\s*:\s*avoid\s*!important/i.test(trRule.decls) ||
      /break-inside\s*:\s*avoid\s*!important/i.test(trRule.decls),
    'tr must avoid page-break-inside'
  );
});

// ============================================================================
// SUITE 2: DOM Simulation — Tab Switches, Inline Display Overrides, Ctrl+P Readiness
// ============================================================================

// Lightweight DOM element simulator for app.js lifecycle verification
class MockElement {
  constructor(tag, id = '', className = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.className = className;
    this.style = {};
    this.dataset = {};
    this._innerHTML = '';
    this.textContent = '';
    this.children = [];
    this.classList = {
      _classes: new Set(className ? className.split(/\s+/) : []),
      contains: (c) => this.classList._classes.has(c),
      add: (c) => this.classList._classes.add(c),
      remove: (c) => this.classList._classes.delete(c),
      toggle: (c, force) => {
        if (force === undefined) {
          if (this.classList._classes.has(c)) {
            this.classList._classes.delete(c);
            return false;
          }
          this.classList._classes.add(c);
          return true;
        }
        if (force) this.classList._classes.add(c);
        else this.classList._classes.delete(c);
        return force;
      },
    };
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = String(val);
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    // Match based on id or class or data attributes
    const matchEl = (el) => {
      if (selector.startsWith('#') && el.id === selector.slice(1)) return true;
      if (selector.startsWith('.') && el.classList.contains(selector.slice(1))) return true;
      if (selector === el.tagName.toLowerCase()) return true;
      return false;
    };
    const walk = (el) => {
      if (matchEl(el)) results.push(el);
      el.children.forEach(walk);
    };
    this.children.forEach(walk);
    return results;
  }
}

// Function to simulate app.js cutlist rendering and state machine
function createMockApp(initialProject = M.defaultProject(), initialName = 'Mueble Test') {
  const state = {
    name: initialName,
    project: M.normalizeProject(initialProject),
    selected: null,
    tab: 'design',
    newType: 'drawer',
    cutSel: null,
    showMach: true,
  };
  state.project.settings = { ...DEFAULTS, ...state.project.settings };

  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmtMoney = (v) => state.project.settings.currency + v.toFixed(2);

  // Simulated DOM nodes
  const dom = {
    app: new MockElement('div', 'app'),
    nameInput: new MockElement('input', 'name'),
    priceSpan: new MockElement('span', 'price'),
    designPane: new MockElement('div', 'designPane'),
    cutlist: new MockElement('div', 'cutlist'),
    cards: new MockElement('div', 'cards'),
    vwr: new MockElement('div', 'vwr'),
    rtools: new MockElement('div', '', 'rtools'),
    tabDesign: new MockElement('button'),
    tabCutlist: new MockElement('button'),
  };

  dom.nameInput.value = state.name;
  dom.designPane.style.display = 'contents';
  dom.cutlist.style.display = 'none';
  dom.cards.style.display = 'none';
  dom.vwr.style.display = 'block';
  dom.tabDesign.dataset.tab = 'design';
  dom.tabDesign.classList.add('on');
  dom.tabCutlist.dataset.tab = 'cutlist';

  let layout = null;

  function drawCutlist() {
    const cl = layout.cutlist;
    const s = layout.settings;
    const cur = s.currency || '$';
    const dateStr = '2026-10-22';

    dom.cutlist.innerHTML = `
      <div class="print-header">
        <div class="print-header-top">
          <h1 class="print-title">${esc(state.name || 'Mueble modular')} — Hoja de Corte</h1>
          <div class="print-header-total">
            <span class="print-total-label">PRECIO TOTAL:</span>
            <span class="print-total-val">${fmtMoney(cl.total)}</span>
          </div>
        </div>
        <div class="print-meta">
          <span><b>Dimensiones generales:</b> ${layout.totalW} × ${s.height} × ${s.depth} mm</span>
          <span class="sep">·</span>
          <span><b>Fecha:</b> ${dateStr}</span>
        </div>
      </div>

      <div class="btns" style="margin-bottom:12px">
        <button id="csv">Exportar CSV</button>
        <button id="print">Imprimir / PDF</button>
        <label class="muted"><input type="checkbox" id="mach" ${state.showMach ? 'checked' : ''}> Mostrar operaciones de mecanizado</label>
      </div>

      <div class="cutlist-section">
        <h3>Tabla de cortes (Desglose de paneles)</h3>
        <table class="cutlist-table" id="cutlistTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Pieza / Rol</th>
              <th>Orientación</th>
              <th class="n">Largo (mm)</th>
              <th class="n">Ancho (mm)</th>
              <th class="n">Espesor (mm)</th>
              <th class="n">Cant.</th>
              <th class="n">Precio unit.</th>
              <th class="n">Precio total</th>
            </tr>
          </thead>
          <tbody>
            ${cl.rows.map((r) => `
              <tr data-id="${r.id}" style="cursor:pointer;${r.id === state.cutSel ? 'background:#ffb800;color:#111' : ''}">
                <td><b>${r.id}</b></td>
                <td><b>${esc(r.name)}</b> <span class="muted">(${esc(r.role)})</span></td>
                <td>${esc(r.orientation)}</td>
                <td class="n">${r.length}</td>
                <td class="n">${r.width}</td>
                <td class="n">${r.thickness}</td>
                <td class="n">${r.qty}</td>
                <td class="n">${fmtMoney(r.unitPrice)}</td>
                <td class="n">${fmtMoney(r.total)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="7">Subtotal Paneles (${cl.area.toFixed(2)} m²)</td>
              <td colspan="2" class="n">${fmtMoney(cl.panelsTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="hardware-section">
        <h3>Desglose de herrajes</h3>
        <table class="hardware-table" id="hardwareTable">
          <thead>
            <tr>
              <th>Herraje</th>
              <th class="n">Cantidad</th>
              <th class="n">Precio unit.</th>
              <th class="n">Precio total</th>
            </tr>
          </thead>
          <tbody>
            ${cl.hardware.map((r) => `
              <tr>
                <td><b>${esc(r.name)}</b></td>
                <td class="n">${r.qty}</td>
                <td class="n">${fmtMoney(r.unitPrice)}</td>
                <td class="n">${fmtMoney(r.total)}</td>
              </tr>
            `).join('') || '<tr><td colspan="4" class="muted">Sin herrajes</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3">Subtotal Herrajes</td>
              <td class="n">${fmtMoney(cl.hardwareTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="machining-section" id="machiningSection" style="${state.showMach ? '' : 'display:none'}">
        <h3>Desglose de mecanizados y operaciones</h3>
        <p class="muted mach-note">rail-cut = ranura para encajar fondo o piso de gaveta · through-hole = perforación pasante para tiradores.</p>
        <table class="machining-table" id="machiningTable">
          <thead>
            <tr>
              <th>Operación / Mecanizado</th>
              <th>Pieza / Cara</th>
              <th>Especificación</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            ${cl.machining.map((o) => `
              <tr>
                <td><b>${o.op === 'rail-cut' ? 'Ranura (rail-cut)' : o.op === 'through-hole' ? 'Perforación pasante (through-hole)' : esc(o.op)}</b></td>
                <td><b>${esc(o.role)}</b> · Cara ${esc(o.face)}</td>
                <td>${o.op === 'rail-cut' ? `Ranura ${o.width || 21} × ${o.depth} mm (Largo: ${o.length} mm)` : `Ø ${o.diameter} mm × ${o.depth} mm prof.`}</td>
                <td>${o.qty} ${o.qty === 1 ? 'operación' : 'operaciones'} (${o.op === 'rail-cut' ? 'Encaje de fondo / gaveta' : 'Fijación de tirador'})</td>
              </tr>
            `).join('') || '<tr><td colspan="4" class="muted">Sin operaciones de mecanizado</td></tr>'}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3">Total Operaciones</td>
              <td class="n">${cl.machining.reduce((a, o) => a + o.qty, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="print-grand-total">
        <div class="grand-total-row">
          <span>Subtotal Paneles / Piezas (${cl.area.toFixed(2)} m²):</span>
          <b>${fmtMoney(cl.panelsTotal)}</b>
        </div>
        <div class="grand-total-row">
          <span>Subtotal Herrajes y Accesorios:</span>
          <b>${fmtMoney(cl.hardwareTotal)}</b>
        </div>
        <div class="grand-total-banner">
          <span>PRECIO TOTAL DEL PROYECTO:</span>
          <span>${fmtMoney(cl.total)}</span>
        </div>
      </div>
    `;
  }

  function refresh() {
    layout = computeLayout(state.project);
    dom.priceSpan.textContent = fmtMoney(layout.cutlist.total);
    drawCutlist();
  }

  function switchTab(newTab) {
    state.tab = newTab;
    dom.tabDesign.classList.toggle('on', newTab === 'design');
    dom.tabCutlist.classList.toggle('on', newTab === 'cutlist');
    dom.designPane.style.display = newTab === 'design' ? 'contents' : 'none';
    dom.cutlist.style.display = newTab === 'cutlist' ? 'block' : 'none';
    dom.cards.style.display = newTab === 'cutlist' ? 'block' : 'none';
    dom.vwr.style.display = newTab === 'cutlist' ? 'none' : 'block';
    dom.rtools.style.display = newTab === 'cutlist' ? 'none' : 'flex';
    refresh();
  }

  function handleNameInput(newValue) {
    dom.nameInput.value = newValue;
    state.name = newValue || 'Sin título';
    refresh();
  }

  // Initial refresh
  refresh();

  return {
    state,
    dom,
    refresh,
    switchTab,
    handleNameInput,
    getLayout: () => layout,
  };
}

test('CHALLENGER-M3-2.1: On initial load (Design tab active), #cutlist is pre-populated and ready for Ctrl+P', () => {
  const app = createMockApp();

  // State is on design tab
  assert.equal(app.state.tab, 'design');
  // Inline display is none
  assert.equal(app.dom.cutlist.style.display, 'none');

  // Verify innerHTML is ALREADY populated with complete cutlist content
  const html = app.dom.cutlist.innerHTML;
  assert.ok(html.includes('class="print-header"'), '#cutlist must contain .print-header');
  assert.ok(html.includes('id="cutlistTable"'), '#cutlist must contain #cutlistTable');
  assert.ok(html.includes('id="hardwareTable"'), '#cutlist must contain #hardwareTable');
  assert.ok(html.includes('id="machiningTable"'), '#cutlist must contain #machiningTable');
  assert.ok(html.includes('class="print-grand-total"'), '#cutlist must contain .print-grand-total');

  // In CSS, #cutlist has `display: block !important;` which overrides `style="display:none"`
  // during print, so Ctrl+P works immediately from Design tab without needing tab switch.
});

test('CHALLENGER-M3-2.2: Tab transitions (Design -> Cutlist -> Design) keep #cutlist continuously populated', () => {
  const app = createMockApp();

  // 1. Initially Design
  assert.equal(app.state.tab, 'design');
  assert.equal(app.dom.cutlist.style.display, 'none');
  const initialHtml = app.dom.cutlist.innerHTML;
  assert.ok(initialHtml.length > 500);

  // 2. Switch to Cutlist
  app.switchTab('cutlist');
  assert.equal(app.state.tab, 'cutlist');
  assert.equal(app.dom.cutlist.style.display, 'block');
  assert.equal(app.dom.designPane.style.display, 'none');
  assert.ok(app.dom.cutlist.innerHTML.includes('Tabla de cortes'));

  // 3. Switch back to Design
  app.switchTab('design');
  assert.equal(app.state.tab, 'design');
  assert.equal(app.dom.cutlist.style.display, 'none');
  assert.equal(app.dom.designPane.style.display, 'contents');

  // Verify #cutlist is still fully populated
  assert.ok(app.dom.cutlist.innerHTML.includes('id="cutlistTable"'));
  assert.ok(app.dom.cutlist.innerHTML.includes('class="print-grand-total"'));
});

test('CHALLENGER-M3-2.3: Design modifications (addOnTop, addColumn, resize) immediately update #cutlist tables', () => {
  const app = createMockApp();
  const initialPrice = app.getLayout().cutlist.total;
  const initialPiecesCount = app.getLayout().cutlist.rows.reduce((a, r) => a + r.qty, 0);
  const initialArea = app.getLayout().cutlist.area;

  // Add module on top
  const colId = app.state.project.columns[0].id;
  M.addOnTop(app.state.project, colId, 'shelf', 350);
  app.refresh();

  const afterTopPrice = app.getLayout().cutlist.total;
  const afterTopPiecesCount = app.getLayout().cutlist.rows.reduce((a, r) => a + r.qty, 0);
  const afterTopArea = app.getLayout().cutlist.area;

  assert.ok(afterTopPrice > initialPrice, 'Price must increase after addOnTop');
  assert.ok(afterTopPiecesCount > initialPiecesCount, 'Total panel pieces quantity must increase after addOnTop');
  assert.ok(afterTopArea > initialArea, 'Total panel area must increase after addOnTop');

  // Verify DOM reflects updated dimensions and price
  const htmlAfterTop = app.dom.cutlist.innerHTML;
  assert.ok(
    htmlAfterTop.includes(`${app.state.project.settings.currency}${afterTopPrice.toFixed(2)}`),
    'Cutlist DOM must display new total price'
  );
  assert.ok(
    htmlAfterTop.includes(`${app.getLayout().totalW} × ${app.state.project.settings.height} ×`),
    'Cutlist DOM must display updated dimensions'
  );

  // Add column
  M.addColumn(app.state.project, 'right');
  app.refresh();

  const afterColPrice = app.getLayout().cutlist.total;
  assert.ok(afterColPrice > afterTopPrice, 'Price must increase after addColumn');
  const htmlAfterCol = app.dom.cutlist.innerHTML;
  assert.ok(
    htmlAfterCol.includes(`${app.state.project.settings.currency}${afterColPrice.toFixed(2)}`),
    'Cutlist DOM must display post-column price'
  );
});

// ============================================================================
// SUITE 3: Real-Time Synchronization & Sanitization
// ============================================================================

test('CHALLENGER-M3-3.1: Typing in #name updates .print-title in real-time immediately', () => {
  const app = createMockApp(M.defaultProject(), 'Proyecto Inicial');

  assert.ok(app.dom.cutlist.innerHTML.includes('Proyecto Inicial — Hoja de Corte'));

  // Simulate typing new project name
  app.handleNameInput('Armario Principal de Dormitorio');

  assert.ok(
    app.dom.cutlist.innerHTML.includes('Armario Principal de Dormitorio — Hoja de Corte'),
    'Cutlist .print-title must update to "Armario Principal de Dormitorio — Hoja de Corte"'
  );
  assert.equal(app.state.name, 'Armario Principal de Dormitorio');
});

test('CHALLENGER-M3-3.2: Typing empty string falls back safely to "Sin título — Hoja de Corte"', () => {
  const app = createMockApp(M.defaultProject(), 'Nombre Anterior');

  // Simulate clearing the input
  app.handleNameInput('');

  assert.ok(
    app.dom.cutlist.innerHTML.includes('Sin título — Hoja de Corte'),
    'Empty name input must fall back to "Sin título — Hoja de Corte"'
  );
  assert.equal(app.state.name, 'Sin título');
});

test('CHALLENGER-M3-3.3: Special characters and potential XSS are safely escaped in .print-title', () => {
  const app = createMockApp();

  const maliciousName = '<script>alert("pwned")</script> & "Mueble <Especial>"';
  app.handleNameInput(maliciousName);

  const html = app.dom.cutlist.innerHTML;
  assert.ok(
    !html.includes('<script>'),
    'Must not contain unescaped <script> tag'
  );
  assert.ok(
    html.includes('&lt;script&gt;alert(&quot;pwned&quot;)&lt;/script&gt; &amp; &quot;Mueble &lt;Especial&gt;&quot; — Hoja de Corte'),
    'Must contain escaped HTML entities'
  );
});

// ============================================================================
// SUITE 4: Granular Woodworking Millimeter Precision & Pricing Identities
// ============================================================================

test('CHALLENGER-M3-4.1: Millimeter precision invariant — length, width, thickness are >= 3mm and integers/1-decimal', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);

  cutlist.rows.forEach((r) => {
    assert.ok(r.length >= 10, `Piece ${r.name} length ${r.length}mm must be >= 10mm`);
    assert.ok(r.width >= 10, `Piece ${r.name} width ${r.width}mm must be >= 10mm`);
    assert.ok(r.thickness >= 3, `Piece ${r.name} thickness ${r.thickness}mm must be >= 3mm`);

    // Verify it is NOT decimal meters
    assert.ok(r.thickness > 1.0, `Piece ${r.name} thickness ${r.thickness} must be mm, not decimal meters`);
    assert.equal(
      Math.round(r.length * 10),
      r.length * 10,
      `Piece ${r.name} length ${r.length} has excess precision`
    );
  });
});

test('CHALLENGER-M3-4.2: Arithmetic pricing identity invariant: panelsTotal + hardwareTotal === total', () => {
  const p = M.defaultProject();
  const { cutlist } = computeLayout(p);

  const calculatedTotal = cutlist.panelsTotal + cutlist.hardwareTotal;
  const delta = Math.abs(calculatedTotal - cutlist.total);
  assert.ok(delta < 0.001, `Total ${cutlist.total} must equal panelsTotal ${cutlist.panelsTotal} + hardwareTotal ${cutlist.hardwareTotal}`);
});

test('CHALLENGER-M3-4.3: Hardware catalog itemization and non-empty rows for drawer units', () => {
  const p = M.defaultProject(); // Contains drawer and shelf
  const { cutlist } = computeLayout(p);

  assert.ok(Array.isArray(cutlist.hardware), 'cutlist.hardware must be an array');
  assert.ok(cutlist.hardware.length > 0, 'Default project must contain hardware (slides, handles, hinges)');

  cutlist.hardware.forEach((h) => {
    assert.ok(typeof h.name === 'string' && h.name.length > 0, 'Hardware name must be non-empty');
    assert.ok(typeof h.qty === 'number' && h.qty > 0, 'Hardware qty must be positive number');
    assert.ok(typeof h.unitPrice === 'number' && h.unitPrice >= 0, 'Hardware unitPrice must be non-negative');
    assert.ok(typeof h.total === 'number' && h.total >= 0, 'Hardware total must be non-negative');
    assert.equal(
      Math.round(h.qty * h.unitPrice * 100) / 100,
      Math.round(h.total * 100) / 100,
      `Hardware ${h.name} qty * unitPrice must equal total`
    );
  });
});

// ============================================================================
// SUITE 5: Adversarial Inputs & Rapid UI Synchronization Stress
// ============================================================================

test('CHALLENGER-M3-5.1: 100 rapid consecutive keystrokes on #name update DOM with 0 desynchronization', () => {
  const app = createMockApp(M.defaultProject(), 'Start');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 _-';

  let currentString = '';
  for (let i = 0; i < 100; i++) {
    const char = alphabet[i % alphabet.length];
    currentString += char;
    app.handleNameInput(currentString);

    // Verify .print-title immediately matches currentString at step i
    const expectedTitle = `${currentString} — Hoja de Corte`;
    assert.ok(
      app.dom.cutlist.innerHTML.includes(expectedTitle),
      `Step ${i}: .print-title must match "${expectedTitle}"`
    );
    assert.equal(app.state.name, currentString);
  }
});

test('CHALLENGER-M3-5.2: Complex Unicode, emojis, JSON, and multiline strings in #name', () => {
  const app = createMockApp();
  const testCases = [
    'Estantería Nórdica 🌲 · 100% Roble Macizo · Edición Especial #042',
    '{"project": "hack", "__proto__": {"polluted": true}}',
    'Mueble con comillas "dobles" y \'simples\' y `backticks` y ampersand &',
    'Línea 1\nLínea 2\tTabulado\r\nLínea 3',
  ];

  testCases.forEach((tc) => {
    app.handleNameInput(tc);
    // Escaped version check
    const esc = (s) =>
      String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const expected = `${esc(tc)} — Hoja de Corte`;
    assert.ok(
      app.dom.cutlist.innerHTML.includes(expected),
      `Input "${tc}" must be properly escaped and rendered in DOM`
    );
  });
});

test('CHALLENGER-M3-5.3: Rapid tab switches (50 consecutive toggles) maintain clean DOM state', () => {
  const app = createMockApp();

  for (let i = 0; i < 50; i++) {
    const targetTab = i % 2 === 0 ? 'cutlist' : 'design';
    app.switchTab(targetTab);

    assert.equal(app.state.tab, targetTab);
    assert.equal(app.dom.cutlist.style.display, targetTab === 'cutlist' ? 'block' : 'none');
    assert.equal(app.dom.designPane.style.display, targetTab === 'design' ? 'contents' : 'none');

    // #cutlist must remain fully formed in both states
    assert.ok(app.dom.cutlist.innerHTML.includes('id="cutlistTable"'));
    assert.ok(app.dom.cutlist.innerHTML.includes('class="print-grand-total"'));
  }
});

// ============================================================================
// SUITE 6: Boundary Geometries & Extreme Cutlist States
// ============================================================================

test('CHALLENGER-M3-6.1: Minimalist furniture (single column, single open shelf, no hardware)', () => {
  const minimalProject = {
    settings: { ...DEFAULTS },
    columns: [
      {
        id: 'col_min',
        width: 600,
        root: { id: 'leaf_min', type: 'shelf', size: 1 },
      },
    ],
  };

  const app = createMockApp(minimalProject, 'Mueble Mínimo');

  const layout = app.getLayout();
  assert.ok(layout.cutlist.rows.length >= 4, 'Must have at least 4 carcass panels (sides, top, base)');
  assert.equal(layout.cutlist.hardware.length, 0, 'Must have 0 hardware pieces');
  assert.equal(layout.cutlist.hardwareTotal, 0, 'Hardware total must be 0');
  assert.equal(layout.cutlist.total, layout.cutlist.panelsTotal, 'Total must equal panels total');

  // Verify DOM fallback renders cleanly
  const html = app.dom.cutlist.innerHTML;
  assert.ok(html.includes('Sin herrajes'), 'Hardware table must render "Sin herrajes" fallback');
  assert.ok(html.includes('Subtotal Herrajes'), 'Subtotal Herrajes row must exist');
});

test('CHALLENGER-M3-6.2: Massive modular furniture (8 columns, multi-nested shelves and drawers)', () => {
  const bigProject = {
    settings: { ...DEFAULTS, height: 2600, depth: 650 },
    columns: [],
  };

  for (let c = 0; c < 8; c++) {
    bigProject.columns.push({
      id: `col_${c}`,
      width: 500,
      root: {
        id: `root_${c}`,
        type: 'multiple',
        dir: 'v',
        size: 1,
        children: [
          { id: `s_${c}_1`, type: 'shelf', size: 400 },
          { id: `d_${c}`, type: 'drawer', size: 600, count: 4 },
          { id: `s_${c}_2`, type: 'shelf', size: 500, front: 'left-door' },
          { id: `s_${c}_3`, type: 'shelf', size: 400 },
        ],
      },
    });
  }

  const startTime = Date.now();
  const app = createMockApp(bigProject, 'Megaproyecto Modular');
  const elapsedMs = Date.now() - startTime;

  assert.ok(elapsedMs < 200, `Megaproyecto layout and cutlist generation took too long: ${elapsedMs}ms`);

  const layout = app.getLayout();
  assert.ok(layout.cutlist.rows.length >= 10, 'Must generate diverse panel types');
  assert.ok(layout.cutlist.hardware.length > 0, 'Must generate hardware items');
  assert.ok(layout.cutlist.machining.length > 0, 'Must generate machining operations');

  // Verify sequential ID numbering invariants
  const seenIds = new Set();
  layout.cutlist.rows.forEach((r) => {
    assert.ok(!seenIds.has(r.id), `Duplicate cutlist row ID: ${r.id}`);
    seenIds.add(r.id);
  });
});

// ============================================================================
// SUITE 7: Print Specificity, Interactive Overrides & Machining Invariance
// ============================================================================

test('CHALLENGER-M3-7.1: app.js never sets inline !important, ensuring CSS @media print specificity wins', () => {
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // Search for any style.setProperty(..., 'important') or style.cssText with !important
  const setsInlineImportant =
    /style\.setProperty\([^)]*!important/i.test(appJs) ||
    /style\.[a-zA-Z]+\s*=\s*['"][^'"]*!important/i.test(appJs);

  assert.equal(
    setsInlineImportant,
    false,
    'app.js must never set inline !important, allowing author print stylesheet rules to override inline styles'
  );
});

test('CHALLENGER-M3-7.2: @media print forces machining section visible regardless of on-screen checkbox toggle', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printBlock = extractMediaPrint(css);
  const rules = parseCssRules(printBlock);

  const machRule = rules.find((r) => r.selectors.includes('#machiningSection') || r.selectors.includes('.machining-section'));
  assert.ok(machRule, '#machiningSection rule must exist in @media print');
  assert.ok(
    /display\s*:\s*block\s*!important/i.test(machRule.decls),
    '#machiningSection must be display: block !important so printouts always include machining specs'
  );
});

test('CHALLENGER-M3-7.3: @media print resets interactive row highlights to transparent', () => {
  const css = fs.readFileSync(stylePath, 'utf8');
  const printBlock = extractMediaPrint(css);
  const rules = parseCssRules(printBlock);

  const trHighlightRule = rules.find((r) => r.selectors.some((s) => s.includes('tr[data-id]')));
  assert.ok(trHighlightRule, 'tr[data-id] rule must exist in @media print');
  assert.ok(
    /background\s*:\s*transparent\s*!important/i.test(trHighlightRule.decls),
    'Interactive selected row background must be overridden to transparent in print'
  );
});

