# Project: Madera Local - Modular Furniture Designer Enhancements

## Architecture
- **Stack**: Vanilla ECMAScript Modules (ESM) running natively in browser via import maps (Three.js), served by Express, backed by SQLite (`node:sqlite`), tested with Node native test runner (`node --test`).
- **Data Flow**:
  1. `project` state in `app.js` holds `settings` (dimensions, clearances, material rates) and `columns` (array of columns, each with `width` and recursive `root` module tree).
  2. `computeLayout(project)` in `layout.js` evaluates geometry:
     - Outer laterals, top/base decks, back panels, shelves, vertical partitions, doors, drawers.
     - Produces `pieces` (3D bounding boxes), `cells` (2D bounding boxes in mm), `dividers` (partition handles), and `cutlist` (aggregated panel rows, hardware catalog, machining operations, and project totals).
  3. `viewer.update(layout)` in `viewer.js` updates Three.js scene meshes in real time.
  4. `drawCanvas()` in `app.js` renders interactive 2D SVG with cells, '+' addition buttons, and drag handles.
  5. `drawCutlist()` in `app.js` renders the tabular cutlist, hardware table, machining table, and pricing summary.
  6. `commit()` / `restore()` in `app.js` manages undo/redo history stacks (`undo`, `redo`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Top Exterior Module Addition | Click top `+` to add a module above, expanding total furniture height without compressing or shrinking existing modules | M1 | R1 Spec & AC 1 |
| 2 | Lateral Column Addition | Click lateral `+` (left/right) to add a new column, expanding total furniture width | M1 | R1 Spec & AC 2 |
| 3 | Immediate Drag Calibration | Newly added module can immediately be resized by dragging its border/divider | M1 | R1 Spec & AC 3 |
| 4 | Reactive Cursor Styling | Show `ns-resize` on horizontal dividers and `ew-resize` on vertical dividers/borders; body cursor lock during drag | M2 | R2 Spec & AC 1 |
| 5 | Divider Drag Resizing | Drag internal dividers to adjust relative dimensions between adjacent cells | M2 | R2 Spec & AC 2 |
| 6 | Column & Border Drag Resizing | Visual handles on inter-column laterals and borders to drag-resize column widths | M2 | R2 Spec & AC 2 |
| 7 | Real-Time 3D/2D Drag Sync | Continuous live updates to 3D viewer and dimensions during drag operations | M2 | R2 Spec & AC 2 |
| 8 | Undo/Redo Drag History | Clean capture of pre-drag state so `Ctrl+Z` / `Ctrl+Y` correctly restores states | M2 | R2 Spec & AC 3 |
| 9 | Tabular-Only Print View | Print preview shows strictly clean tables; hides 2D canvas, 3D viewer, UI chrome, thumbnails | M3 | R3 Spec & AC 1, 2 |
| 10 | Granular Cutlist Table | Individual panel breakdown: ID, Pieza/Rol, Orientación, Dimensiones exactas (Largo × Ancho × Espesor mm), Cant., Precio unit., Precio total | M3 | R3 Spec & AC 1 |
| 11 | Hardware Breakdown Table | Itemized hardware list: correderas, bisagras, tiradores, barras de perchero, soportes | M3 | R3 Spec & AC 1 |
| 12 | Machining Breakdown Table | Granular list of ranuras (grooves) and perforaciones (drillings) with face, length, and specs | M3 | R3 Spec & AC 1 |
| 13 | Prominent Grand Total Display | Prominently displayed calculated final project price and category totals in header/footer | M3 | R3 Spec & AC 3 |
| 14 | Multi-Tier Test Suite | Unit and E2E verification of all acceptance criteria (Tiers 1-4) | M4 | AC Verification |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Exterior Modules (R1) | Top/lateral '+' addition, non-compressing height expansion, immediate drag calibration | none | DONE |
| M2 | 2D Drag Resizing & Undo/Redo (R2) | Reactive cursors, column/divider drag handles, unweighted node fix, 3D sync, Ctrl+Z/Y history | M1 | DONE |
| M3 | Tabular Cutlist Print View (R3) | @media print stylesheet, granular mm dimensions, hardware/machining tables, total price banner | none | IN_PROGRESS |
| M4 | E2E Testing & Acceptance Verification | Multi-tier test suite, boundary cases, adversarial verification, gate audit | M1, M2, M3 | PLANNED |

## Interface Contracts

### M.addOnTop(project, colId, type, addedHeight) ↔ computeLayout
- **Signature**: `addOnTop(project: Project, colId: string, type: string = 'shelf', addedHeight: number = 350): Node`
- **Behavior**:
  - Increases `project.settings.height += addedHeight + project.settings.thickness`.
  - Converts existing relative child node sizes to exact millimeter values based on prior layout calculations, preventing existing modules in all columns from compressing or stretching.
  - Adds new leaf module with `size = addedHeight` at top of target column.
  - Target column module divider becomes immediately draggable.

### Column Drag ↔ Project Model
- **Signature**: Drag handler modifies `project.columns[colIdx].width` and `project.columns[colIdx + 1].width` (or outer width).
- **Invariants**: Minimum column width = 150mm. Total furniture width preserved when dragging inter-column dividers.

### Undo/Redo Stack Contract
- **Contract**:
  - Drag start: `const initialSnapshot = snapshot()`.
  - Drag end: If `snapshot() !== initialSnapshot`, push `initialSnapshot` onto `undo`, reset `redo`, and trigger `save()`.
  - `restore(undo, redo)` on `Ctrl+Z` / `restore(redo, undo)` on `Ctrl+Y` / `Ctrl+Shift+Z`.

### Cutlist Print Contract
- **Contract**:
  - `@media print`: `#canvas`, `#designPane`, `.topbar`, `.dock`, `.btns`, `.rtools`, `.cards`, `.vwr` must have `display: none !important;`.
  - `#cutlist` must have `display: block !important; overflow: visible !important; height: auto !important;`.
  - Table columns must provide exact millimeter dimensions `Largo (mm) × Ancho (mm) × Espesor (mm)`.
  - Final total block must display Subtotal Paneles, Subtotal Herrajes, and TOTAL GENERAL prominently.

## Code Layout
- `public/js/model.js`: Pure data mutations (`addOnTop`, `addColumn`, `leaf`, `wrap`, `setSize`).
- `public/js/layout.js`: Pure geometry and cutlist math (`computeLayout`, `buildCutlist`, `orientationOf`).
- `public/js/app.js`: Interactive 2D canvas, event handlers, cursor management, undo/redo history, cutlist DOM.
- `public/js/viewer.js`: Three.js 3D viewport rendering.
- `public/style.css`: Screen UI styles and print stylesheet (`@media print`).
- `test/layout.test.js`: Core layout and cutlist unit tests.
- `test/e2e_acceptance.test.js`: E2E acceptance criteria test suite.
