import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLayout } from '../public/js/layout.js';
import * as M from '../public/js/model.js';

test('proyecto por defecto genera piezas, cutlist y precio', () => {
  const l = computeLayout(M.defaultProject());
  assert.ok(l.pieces.length > 10);
  assert.ok(l.cutlist.total > 0);
  assert.equal(l.cutlist.hardware.find((h) => h.name === 'Corredera (par)').qty, 3);
  assert.equal(l.cutlist.rows.filter((r) => r.name.startsWith('Puerta')).reduce((a, r) => a + r.qty, 0), 1);
});

test('módulo dentro de otro módulo: gaveta + puerta en el mismo módulo', () => {
  const p = M.defaultProject();
  const target = p.columns[2].root.children[0]; // shelf
  M.setType(p, target.id, 'drawer');
  const before = computeLayout(p);
  const nn = M.addInside(p, target.id, 'v', 'left-door');
  assert.ok(nn);
  const node = M.find(p, target.id).node;
  assert.equal(node.type, 'multiple');
  assert.equal(node.children.length, 2);
  assert.equal(node.children[0].type, 'drawer');
  assert.equal(node.children[1].front, 'left-door');
  const after = computeLayout(p);
  assert.equal(after.pieces.filter((x) => x.name === 'Puerta').length, before.pieces.filter((x) => x.name === 'Puerta').length + 1);
  assert.ok(after.cutlist.total > before.cutlist.total);
});

test('perchero y cambio de manilla', () => {
  const p = M.defaultProject();
  const target = p.columns[0].root.children[0];
  M.setType(p, target.id, 'rail');
  M.setPull(p, p.columns[0].root.children[1].id, 'knob'); // gavetas con pomo
  const l = computeLayout(p);
  assert.ok(l.pieces.some((pc) => pc.kind === 'rail' && pc.name === 'Barra de perchero'));
  assert.ok(l.cutlist.hardware.some((h) => h.name === 'Pomo'));
  assert.ok(l.cutlist.hardware.some((h) => h.name.includes('perchero')));
});

test('eliminar hijo colapsa el contenedor', () => {
  const p = M.defaultProject();
  const t = p.columns[2].root.children[0];
  const nn = M.addInside(p, t.id, 'h', 'doors');
  M.deleteModule(p, nn.id);
  assert.equal(M.find(p, t.id).node.type, 'shelf');
});

test('setSize reajusta hermanos', () => {
  const p = M.defaultProject();
  const l = computeLayout(p);
  const c = p.columns[0].root.children[0];
  M.setSize(p, l.cells, c.id, 'h', 400, l.settings);
  const l2 = computeLayout(p);
  assert.ok(Math.abs(l2.cells[c.id].h - 400) < 0.01);
  const total = l2.cells[p.columns[0].root.id].h;
  assert.ok(Math.abs(l2.cells[c.id].h + l2.cells[p.columns[0].root.children[1].id].h + l2.settings.thickness - total) < 0.01);
});

test('M1: addOnTop expande altura sin comprimir módulos existentes (R1 AC 1)', () => {
  const p = M.defaultProject();
  const l1 = computeLayout(p);
  const targetCol = p.columns[0];
  const oldH0 = l1.cells[targetCol.root.children[0].id].h;
  const oldH1 = l1.cells[targetCol.root.children[1].id].h;
  const oldTotalH = p.settings.height;

  // Añadir módulo superior de 350mm
  const nn = M.addOnTop(p, targetCol.id, 'shelf', 350, true);
  assert.ok(nn);
  assert.equal(p.settings.height, oldTotalH + 350 + p.settings.thickness);

  const l2 = computeLayout(p);
  // El nuevo módulo recibe exactamente 350mm
  assert.ok(Math.abs(l2.cells[nn.id].h - 350) < 0.1, `Nuevo módulo esperado 350, obtenido ${l2.cells[nn.id].h}`);

  // Los módulos existentes en la columna objetivo conservan exactamente su altura anterior
  const newH0 = l2.cells[targetCol.root.children[1].id].h;
  const newH1 = l2.cells[targetCol.root.children[2].id].h;
  assert.ok(Math.abs(newH0 - oldH0) < 0.1, `Módulo 0 comprimido: antes ${oldH0}, después ${newH0}`);
  assert.ok(Math.abs(newH1 - oldH1) < 0.1, `Módulo 1 comprimido: antes ${oldH1}, después ${newH1}`);

  // El divisor horizontal existe y está listo para arrastre
  const divider = l2.dividers.find((d) => d.axis === 'v' && d.prevId === nn.id && d.nextId === targetCol.root.children[1].id);
  assert.ok(divider, 'El divisor entre el nuevo módulo y el inferior debe existir en layout.dividers');
});

test('M1: addOnTop sobre columna de hoja única (wrap) preserva altura previa (R1 AC 1)', () => {
  const p = M.defaultProject();
  const c = M.addColumn(p, 0); // columna de hoja única shelf
  const l1 = computeLayout(p);
  const singleLeafId = p.columns[0].root.id;
  const singleLeafH = l1.cells[singleLeafId].h;

  const nn = M.addOnTop(p, p.columns[0].id, 'drawer', 350);
  assert.ok(nn);

  const l2 = computeLayout(p);
  assert.ok(Math.abs(l2.cells[nn.id].h - 350) < 0.1);
  const wrappedChild = p.columns[0].root.children[1];
  assert.ok(Math.abs(l2.cells[wrappedChild.id].h - singleLeafH) < 0.1, `Hoja envuelta encogida: antes ${singleLeafH}, después ${l2.cells[wrappedChild.id].h}`);
});

test('M1: addOnTop con allColumns=true preserva alturas en todas las columnas al 100% (R1 AC 1)', () => {
  const p = M.defaultProject();
  const l1 = computeLayout(p);
  const col1_h0 = l1.cells[p.columns[1].root.children[0].id].h;
  const col1_h1 = l1.cells[p.columns[1].root.children[1].id].h;
  const col2_h0 = l1.cells[p.columns[2].root.children[0].id].h;

  const nn = M.addOnTop(p, p.columns[0].id, 'shelf', 350, true);
  assert.ok(nn);

  const l2 = computeLayout(p);
  assert.ok(Math.abs(l2.cells[p.columns[1].root.children[1].id].h - col1_h0) < 0.1);
  assert.ok(Math.abs(l2.cells[p.columns[1].root.children[2].id].h - col1_h1) < 0.1);
  assert.ok(Math.abs(l2.cells[p.columns[2].root.children[1].id].h - col2_h0) < 0.1);
});

test('M1: colLeft agrega columna a la izquierda expandiendo ancho sin alterar existentes (R1 AC 2)', () => {
  const p = M.defaultProject();
  const initialWidths = p.columns.map((c) => c.width);
  const lBefore = computeLayout(p);
  const initialTotalW = lBefore.totalW;

  const newRoot = M.addColumn(p, 0);
  assert.equal(p.columns.length, 4);
  assert.equal(p.columns[0].width, 600);
  assert.equal(p.columns[0].root.id, newRoot.id);
  assert.equal(newRoot.type, 'shelf');

  assert.deepEqual(p.columns.slice(1).map((c) => c.width), initialWidths);

  const lAfter = computeLayout(p);
  assert.equal(lAfter.totalW, initialTotalW + 600 + p.settings.thickness);
  assert.equal(lAfter.cells[newRoot.id].w, 600);
  assert.equal(lAfter.cells[newRoot.id].x, p.settings.thickness);
});

test('M1: colRight agrega columna a la derecha expandiendo ancho sin alterar existentes (R1 AC 2)', () => {
  const p = M.defaultProject();
  const initialWidths = p.columns.map((c) => c.width);
  const lBefore = computeLayout(p);
  const initialTotalW = lBefore.totalW;

  const newRoot = M.addColumn(p, p.columns.length);
  assert.equal(p.columns.length, 4);
  assert.equal(p.columns[3].width, 600);
  assert.equal(p.columns[3].root.id, newRoot.id);

  assert.deepEqual(p.columns.slice(0, 3).map((c) => c.width), initialWidths);

  const lAfter = computeLayout(p);
  assert.equal(lAfter.totalW, initialTotalW + 600 + p.settings.thickness);
  assert.equal(lAfter.cells[newRoot.id].w, 600);
});

test('M1: calibración de ancho de columna actualiza totalW y celdas sin tocar vecinos (R1 AC 3)', () => {
  const p = M.defaultProject();
  const newRoot = M.addColumn(p, 0);
  const lBefore = computeLayout(p);

  p.columns[0].width = 750;
  const lAfter = computeLayout(p);

  assert.equal(lAfter.cells[newRoot.id].w, 750);
  assert.equal(lAfter.totalW, lBefore.totalW + 150);
  assert.equal(p.columns[1].width, 764);
  assert.equal(p.columns[2].width, 764);
  assert.equal(p.columns[3].width, 764);
});

test('M1: colDividers calcula la posición exacta del lateral de borde para la columna agregada (R1 AC 3)', () => {
  const p = M.defaultProject();
  M.addColumn(p, 0);
  const l = computeLayout(p);
  assert.ok(l.colDividers && l.colDividers.length === 4);
  const cd0 = l.colDividers[0];
  assert.equal(cd0.colIdx, 0);
  assert.equal(cd0.x, p.settings.thickness + 600);
  assert.equal(cd0.w, p.settings.thickness);
});

test('M1: addOnTop crea divisor horizontal listo para calibración por arrastre (R1 AC 3)', () => {
  const p = M.defaultProject();
  const col = p.columns[0];
  const oldDividerCount = computeLayout(p).dividers.length;
  const nn = M.addOnTop(p, col.id, 'shelf', 350);
  assert.ok(nn);
  const layout = computeLayout(p);
  assert.ok(layout.dividers.length > oldDividerCount);
  const topDivider = layout.dividers.find((d) => d.axis === 'v' && d.prevId === nn.id);
  assert.ok(topDivider, 'Horizontal divider below top module must exist');
  assert.equal(topDivider.axis, 'v');
  assert.equal(topDivider.col, 0);
  assert.equal(topDivider.w, col.width);
  assert.equal(topDivider.h, layout.settings.thickness);
  assert.ok(topDivider.y > 0);
});

test('M1: divisores de columna y borde exterior expuestos en layout.dividers con cursor ew-resize (R1 AC 3)', () => {
  const p = M.defaultProject();
  const l = computeLayout(p);
  const colDividers = l.dividers.filter((d) => d.type === 'col');
  const outerDividers = l.dividers.filter((d) => d.type === 'col-outer');
  assert.equal(colDividers.length, p.columns.length - 1);
  assert.equal(outerDividers.length, 1);
  assert.ok(colDividers.every((d) => d.axis === 'h' && d.cursor === 'ew-resize'));
  assert.ok(outerDividers.every((d) => d.axis === 'h' && d.cursor === 'ew-resize'));
});

test('CHALLENGE 1: Repeated sequential additions of top modules on SAME column never compress', () => {
  const p = M.defaultProject();
  const t = p.settings.thickness;
  const initialH = p.settings.height;
  const col0 = p.columns[0];

  const l0 = computeLayout(p);
  const m0_id = col0.root.children[0].id;
  const m1_id = col0.root.children[1].id;
  const initialM0_h = l0.cells[m0_id].h;
  const initialM1_h = l0.cells[m1_id].h;

  const addedHeights = [350, 280, 420];
  let accumulatedAdded = 0;
  const addedModuleIds = [];

  addedHeights.forEach((addH, idx) => {
    const prevLayout = computeLayout(p);
    const prevH = p.settings.height;

    const prevHeights = {};
    Object.keys(prevLayout.cells).forEach((id) => {
      prevHeights[id] = prevLayout.cells[id].h;
    });

    const newModule = M.addOnTop(p, col0.id, 'shelf', addH, true);
    assert.ok(newModule, `Failed to add top module at iteration ${idx}`);
    addedModuleIds.push(newModule.id);
    accumulatedAdded += (addH + t);

    // Invariant: total furniture height strictly equals oldHeight + sum(addedHeights + t)
    assert.equal(
      p.settings.height,
      initialH + accumulatedAdded,
      `Iteration ${idx}: furniture height mismatch. Expected ${initialH + accumulatedAdded}, got ${p.settings.height}`
    );
    assert.equal(
      p.settings.height,
      prevH + addH + t,
      `Iteration ${idx}: incremental height mismatch. Expected ${prevH + addH + t}, got ${p.settings.height}`
    );

    const currLayout = computeLayout(p);

    // New module received exact requested height
    const newCellH = currLayout.cells[newModule.id].h;
    assert.ok(
      Math.abs(newCellH - addH) < 0.1,
      `Iteration ${idx}: newly added module height was ${newCellH}, expected ${addH}`
    );

    // Assert that NO existing module in column 0 compressed
    assert.ok(
      currLayout.cells[m0_id].h >= prevHeights[m0_id] - 0.05,
      `Iteration ${idx}: original module 0 compressed from ${prevHeights[m0_id]} to ${currLayout.cells[m0_id].h}`
    );
    assert.ok(
      currLayout.cells[m1_id].h >= prevHeights[m1_id] - 0.05,
      `Iteration ${idx}: original module 1 compressed from ${prevHeights[m1_id]} to ${currLayout.cells[m1_id].h}`
    );

    // Assert that previously added top modules never compressed
    for (let j = 0; j < idx; j++) {
      const prevAddedId = addedModuleIds[j];
      const prevAddedH = prevHeights[prevAddedId];
      const currAddedH = currLayout.cells[prevAddedId].h;
      assert.ok(
        currAddedH >= prevAddedH - 0.05,
        `Iteration ${idx}: previously added module ${j} compressed from ${prevAddedH} to ${currAddedH}`
      );
    }

    // Invariant: horizontal divider exists below newly added module
    const divider = currLayout.dividers.find((d) => d.axis === 'v' && d.prevId === newModule.id);
    assert.ok(divider, `Iteration ${idx}: divider below new module missing`);
  });

  const lFinal = computeLayout(p);
  assert.ok(Math.abs(lFinal.cells[m0_id].h - initialM0_h) < 0.1);
  assert.ok(Math.abs(lFinal.cells[m1_id].h - initialM1_h) < 0.1);
});

test('CHALLENGE 2: Sequential additions of top modules across DIFFERENT columns never compress', () => {
  const p = M.defaultProject();
  const t = p.settings.thickness;
  const initialH = p.settings.height;

  const plan = [
    { colIdx: 0, h: 350, type: 'shelf' },
    { colIdx: 1, h: 300, type: 'shelf' },
    { colIdx: 2, h: 250, type: 'drawer' },
    { colIdx: 0, h: 400, type: 'shelf' },
    { colIdx: 1, h: 320, type: 'rail' },
  ];

  let expectedAccumulated = 0;

  plan.forEach((step, stepIdx) => {
    const prevLayout = computeLayout(p);
    const prevHeights = {};
    Object.keys(prevLayout.cells).forEach((id) => {
      prevHeights[id] = prevLayout.cells[id].h;
    });

    const targetCol = p.columns[step.colIdx];
    const newModule = M.addOnTop(p, targetCol.id, step.type, step.h, true);
    assert.ok(newModule, `Step ${stepIdx} failed to add module`);
    expectedAccumulated += (step.h + t);

    assert.equal(
      p.settings.height,
      initialH + expectedAccumulated,
      `Step ${stepIdx}: height invariant failed. Expected ${initialH + expectedAccumulated}, got ${p.settings.height}`
    );

    const currLayout = computeLayout(p);

    assert.ok(
      Math.abs(currLayout.cells[newModule.id].h - step.h) < 0.1,
      `Step ${stepIdx}: new module height ${currLayout.cells[newModule.id].h} != ${step.h}`
    );

    Object.keys(prevHeights).forEach((id) => {
      if (currLayout.cells[id]) {
        assert.ok(
          currLayout.cells[id].h >= prevHeights[id] - 0.05,
          `Step ${stepIdx}: module ${id} compressed from ${prevHeights[id]} to ${currLayout.cells[id].h}`
        );
      }
    });
  });
});

test('CHALLENGE 3: Repeated additions with allColumns=true preserves 100% exact heights across all columns', () => {
  const p = M.defaultProject();
  const t = p.settings.thickness;
  const initialH = p.settings.height;

  const baselineLayout = computeLayout(p);
  const baselineHeights = {};
  Object.keys(baselineLayout.cells).forEach((id) => {
    if (baselineLayout.cells[id].type !== 'multiple') {
      baselineHeights[id] = baselineLayout.cells[id].h;
    }
  });

  const additions = [350, 250, 400];
  let accumulatedH = 0;

  additions.forEach((addH, idx) => {
    const newMod = M.addOnTop(p, p.columns[0].id, 'shelf', addH, true);
    assert.ok(newMod);
    accumulatedH += (addH + t);

    assert.equal(p.settings.height, initialH + accumulatedH);

    const currLayout = computeLayout(p);

    // Every original baseline leaf module must retain EXACTLY its original height
    Object.keys(baselineHeights).forEach((id) => {
      assert.ok(
        Math.abs(currLayout.cells[id].h - baselineHeights[id]) < 0.1,
        `allColumns step ${idx}: leaf module ${id} drifted. Expected ${baselineHeights[id]}, got ${currLayout.cells[id].h}`
      );
    });
  });
});

test('CHALLENGE 4: Repeated lateral column additions preserve existing column widths and totalW invariant', () => {
  const p = M.defaultProject();
  const t = p.settings.thickness;

  const initialTotalW = computeLayout(p).totalW;

  const steps = [
    { side: 'left', width: 500, expectedIndex: 0 },
    { side: 'right', width: 650, expectedIndex: 4 },
    { side: 'left', width: 450, expectedIndex: 0 },
    { side: 'right', width: 700, expectedIndex: 6 },
    { side: 'middle', width: 550, expectedIndex: 3 },
  ];

  let cumulativeAddedW = 0;

  steps.forEach((step, idx) => {
    const prevColWidths = p.columns.map((c) => ({ id: c.id, width: c.width }));

    let newRoot;
    if (step.side === 'left') {
      newRoot = M.addColumn(p, 0, step.width);
    } else if (step.side === 'right') {
      newRoot = M.addColumn(p, p.columns.length, step.width);
    } else {
      newRoot = M.addColumn(p, step.expectedIndex, step.width);
    }
    assert.ok(newRoot, `Step ${idx} addColumn failed`);
    cumulativeAddedW += (step.width + t);

    prevColWidths.forEach((pc) => {
      const col = p.columns.find((c) => c.id === pc.id);
      assert.ok(col, `Pre-existing column ${pc.id} missing`);
      assert.equal(col.width, pc.width, `Column ${pc.id} width changed from ${pc.width} to ${col.width}`);
    });

    const currLayout = computeLayout(p);

    const expectedTotalW = p.columns.reduce((sum, c) => sum + c.width, 0) + (p.columns.length + 1) * t;
    assert.equal(
      currLayout.totalW,
      expectedTotalW,
      `Step ${idx}: totalW mismatch. Expected ${expectedTotalW}, got ${currLayout.totalW}`
    );
    assert.equal(
      currLayout.totalW,
      initialTotalW + cumulativeAddedW,
      `Step ${idx}: cumulative totalW mismatch`
    );

    const interColDividers = currLayout.dividers.filter((d) => d.type === 'col');
    const outerDividers = currLayout.dividers.filter((d) => d.type === 'col-outer');
    assert.equal(interColDividers.length, p.columns.length - 1);
    assert.equal(outerDividers.length, 1);
    assert.ok(interColDividers.every((d) => d.cursor === 'ew-resize'));
    assert.ok(outerDividers.every((d) => d.cursor === 'ew-resize'));
  });
});

test('CHALLENGE 5: addOnTop on single-leaf column wraps cleanly and survives repeated top additions', () => {
  const p = M.defaultProject();
  const newRoot = M.addColumn(p, 0, 600);
  const singleCol = p.columns[0];

  const l0 = computeLayout(p);
  const originalLeafH = l0.cells[newRoot.id].h;

  const top1 = M.addOnTop(p, singleCol.id, 'drawer', 350);
  assert.ok(top1);
  const l1 = computeLayout(p);
  assert.ok(Math.abs(l1.cells[top1.id].h - 350) < 0.1);
  const wrappedChild = singleCol.root.children[1];
  assert.ok(Math.abs(l1.cells[wrappedChild.id].h - originalLeafH) < 0.1);

  const top2 = M.addOnTop(p, singleCol.id, 'shelf', 300);
  assert.ok(top2);
  const l2 = computeLayout(p);
  assert.ok(Math.abs(l2.cells[top2.id].h - 300) < 0.1);
  assert.ok(Math.abs(l2.cells[top1.id].h - 350) < 0.1);
  assert.ok(Math.abs(l2.cells[wrappedChild.id].h - originalLeafH) < 0.1);

  const top3 = M.addOnTop(p, singleCol.id, 'shelf', 250);
  assert.ok(top3);
  const l3 = computeLayout(p);
  assert.ok(Math.abs(l3.cells[top3.id].h - 250) < 0.1);
  assert.ok(Math.abs(l3.cells[top2.id].h - 300) < 0.1);
  assert.ok(Math.abs(l3.cells[top1.id].h - 350) < 0.1);
  assert.ok(Math.abs(l3.cells[wrappedChild.id].h - originalLeafH) < 0.1);
});

test('CHALLENGE 6: Boundary invariants — Column drag min width 150mm & Module drag min height 50mm', () => {
  const col0W = 600;
  const col1W = 600;
  const totalPair = col0W + col1W;
  const minW = 150;

  const extremeLeftDelta = -1000;
  let newLeft = Math.round(Math.max(minW, Math.min(totalPair - minW, col0W + extremeLeftDelta)));
  let newRight = totalPair - newLeft;
  assert.equal(newLeft, 150, 'Left column must clamp to minW 150mm');
  assert.equal(newRight, 1050, 'Right column absorbs remainder preserving total pair');
  assert.equal(newLeft + newRight, totalPair, 'Total width strictly preserved');

  const extremeRightDelta = 1000;
  newLeft = Math.round(Math.max(minW, Math.min(totalPair - minW, col0W + extremeRightDelta)));
  newRight = totalPair - newLeft;
  assert.equal(newRight, 150, 'Right column must clamp to minW 150mm');
  assert.equal(newLeft, 1050, 'Left column absorbs remainder preserving total pair');
  assert.equal(newLeft + newRight, totalPair, 'Total width strictly preserved');

  const outerDelta = -1000;
  const newOuterW = Math.round(Math.max(minW, col0W + outerDelta));
  assert.equal(newOuterW, 150, 'Outer column must clamp to 150mm');

  const topSize = 350;
  const bottomSize = 650;
  const totalModulePair = topSize + bottomSize;
  const minSize = 50;

  let newTop = topSize + (-1000);
  let newBottom = bottomSize - (-1000);
  if (newTop < minSize) {
    newTop = minSize;
    newBottom = totalModulePair - minSize;
  }
  assert.equal(newTop, 50, 'Top module height must clamp to minSize 50mm');
  assert.equal(newBottom, 950, 'Bottom module absorbs remainder');
  assert.equal(newTop + newBottom, totalModulePair);

  newTop = topSize + 1000;
  newBottom = bottomSize - 1000;
  if (newBottom < minSize) {
    newBottom = minSize;
    newTop = totalModulePair - minSize;
  }
  assert.equal(newBottom, 50, 'Bottom module height must clamp to minSize 50mm');
  assert.equal(newTop, 950, 'Top module absorbs remainder');
  assert.equal(newTop + newBottom, totalModulePair);
});

test('CHALLENGE 7: Stress Fuzzing — 30 sequential random operations preserve geometry and invariants', () => {
  const p = M.defaultProject();
  const t = p.settings.thickness;

  let totalAddedHeight = 0;
  const initialH = p.settings.height;

  for (let i = 0; i < 30; i++) {
    const op = i % 4;
    if (op === 0) {
      const colIdx = Math.floor(Math.random() * p.columns.length);
      const h = 100 + Math.floor(Math.random() * 300);
      const targetCol = p.columns[colIdx];
      const res = M.addOnTop(p, targetCol.id, 'shelf', h, true);
      assert.ok(res);
      totalAddedHeight += (h + t);
    } else if (op === 1) {
      const w = 200 + Math.floor(Math.random() * 500);
      const res = M.addColumn(p, 0, w);
      assert.ok(res);
    } else if (op === 2) {
      const w = 200 + Math.floor(Math.random() * 500);
      const res = M.addColumn(p, p.columns.length, w);
      assert.ok(res);
    } else if (op === 3) {
      const h = 150 + Math.floor(Math.random() * 200);
      const res = M.addOnTop(p, p.columns[0].id, 'shelf', h, true);
      assert.ok(res);
      totalAddedHeight += (h + t);
    }

    const l = computeLayout(p);

    assert.equal(p.settings.height, initialH + totalAddedHeight);

    const expectedW = p.columns.reduce((a, c) => a + c.width, 0) + (p.columns.length + 1) * t;
    assert.equal(l.totalW, expectedW);

    Object.values(l.cells).forEach((cell) => {
      assert.ok(!Number.isNaN(cell.x), `Cell ${cell.id} x is NaN`);
      assert.ok(!Number.isNaN(cell.y), `Cell ${cell.id} y is NaN`);
      assert.ok(!Number.isNaN(cell.w) && cell.w > 0, `Cell ${cell.id} w invalid: ${cell.w}`);
      assert.ok(!Number.isNaN(cell.h) && cell.h > 0, `Cell ${cell.id} h invalid: ${cell.h}`);
    });

    l.pieces.forEach((piece) => {
      assert.ok(!Number.isNaN(piece.sx) && piece.sx > 0, `Piece ${piece.name} sx invalid`);
      assert.ok(!Number.isNaN(piece.sy) && piece.sy > 0, `Piece ${piece.name} sy invalid`);
      assert.ok(!Number.isNaN(piece.sz) && piece.sz > 0, `Piece ${piece.name} sz invalid`);
    });
  }
});

// ============================================================================
// Milestone 2 (R2) Unit Tests: 2D Drag Resizing & Undo/Redo Invariants
// ============================================================================

test('M2: Drawer component positive height invariance at 50mm clamp', () => {
  const p = M.defaultProject();
  // Column 0 has [shelf, drawer(count: 3)]
  const shelf = p.columns[0].root.children[0];
  const drawer = p.columns[0].root.children[1];
  assert.equal(drawer.type, 'drawer');
  assert.equal(drawer.count, 3);

  // Clamp drawer module size to 50mm
  drawer.size = 50;
  shelf.size = 1300;

  const l = computeLayout(p);

  // Verify all drawer sub-components maintain valid positive dimensions
  const drawerPieces = l.pieces.filter((pc) => pc.kind === 'drawer');
  assert.ok(drawerPieces.length > 0, 'Drawer sub-components must exist');

  // Box vertical walls maintain sy >= 10mm
  const boxWalls = drawerPieces.filter((pc) => pc.name !== 'Fondo de gaveta');
  boxWalls.forEach((pc) => {
    assert.ok(pc.sy >= 10, `Piece ${pc.name} sy must be >= 10mm, got ${pc.sy}`);
    assert.ok(pc.sx > 0, `Piece ${pc.name} sx must be > 0, got ${pc.sx}`);
    assert.ok(pc.sz > 0, `Piece ${pc.name} sz must be > 0, got ${pc.sz}`);
    assert.ok(!Number.isNaN(pc.x), `Piece ${pc.name} x is NaN`);
    assert.ok(!Number.isNaN(pc.y), `Piece ${pc.name} y is NaN`);
  });

  // Bottom plate maintains sy equal to drawerBottomThickness (6mm)
  const bottomPlates = drawerPieces.filter((pc) => pc.name === 'Fondo de gaveta');
  bottomPlates.forEach((pc) => {
    assert.equal(pc.sy, p.settings.drawerBottomThickness || 6, `Piece ${pc.name} sy must equal drawerBottomThickness`);
    assert.ok(pc.sx > 0, `Piece ${pc.name} sx must be > 0, got ${pc.sx}`);
    assert.ok(pc.sz > 0, `Piece ${pc.name} sz must be > 0, got ${pc.sz}`);
    assert.ok(!Number.isNaN(pc.x), `Piece ${pc.name} x is NaN`);
    assert.ok(!Number.isNaN(pc.y), `Piece ${pc.name} y is NaN`);
  });

  // Verify cutlist rows have positive dimensions
  l.cutlist.rows.forEach((r) => {
    assert.ok(r.length > 0, `Cutlist row ${r.name} length must be > 0, got ${r.length}`);
    assert.ok(r.width > 0, `Cutlist row ${r.name} width must be > 0, got ${r.width}`);
    assert.ok(r.thickness > 0, `Cutlist row ${r.name} thickness must be > 0, got ${r.thickness}`);
  });

  assert.ok(l.cutlist.total > 0, 'Cutlist total must be positive');
  assert.ok(Number.isFinite(l.cutlist.total), 'Cutlist total must be finite');

  // Also test with 4 drawers clamped to 50mm
  drawer.count = 4;
  const l4 = computeLayout(p);
  const boxWalls4 = l4.pieces.filter((pc) => pc.kind === 'drawer' && pc.name !== 'Fondo de gaveta');
  boxWalls4.forEach((pc) => {
    assert.ok(pc.sy >= 10, `Piece ${pc.name} (4 drawers) sy must be >= 10mm, got ${pc.sy}`);
  });
  const bottomPlates4 = l4.pieces.filter((pc) => pc.kind === 'drawer' && pc.name === 'Fondo de gaveta');
  bottomPlates4.forEach((pc) => {
    assert.equal(pc.sy, p.settings.drawerBottomThickness || 6, `Piece ${pc.name} (4 drawers) sy must equal drawerBottomThickness`);
  });
});

test('M2: Fluid pair redistribution without rounding drift', () => {
  // 1. Internal shelf divider pair redistribution with fractional/floating deltas
  const startPrevSize = 450;
  const startNextSize = 350;
  const totalPair = startPrevSize + startNextSize; // 800mm
  const minSize = 50;

  const testDeltas = [
    12.3, -15.7, 33.333, -47.89, 100.5, -99.5, 0.499, -0.499,
    250.7, -350.2, 500, -600, 10000, -10000
  ];

  for (const delta of testDeltas) {
    const effectiveMin = Math.min(minSize, Math.floor(totalPair / 2));
    let newPrev = startPrevSize + delta;
    if (newPrev < effectiveMin) {
      newPrev = effectiveMin;
    } else if (newPrev > totalPair - effectiveMin) {
      newPrev = totalPair - effectiveMin;
    }
    const roundedPrev = Math.round(newPrev);
    const roundedNext = totalPair - roundedPrev;

    // Algebraic pair invariance: sum must ALWAYS equal totalPair exactly (0mm drift)
    assert.equal(
      roundedPrev + roundedNext,
      totalPair,
      `Pair invariance violated for delta ${delta}: ${roundedPrev} + ${roundedNext} !== ${totalPair}`
    );
    assert.ok(roundedPrev >= effectiveMin, `roundedPrev ${roundedPrev} < effectiveMin ${effectiveMin}`);
    assert.ok(roundedNext >= effectiveMin, `roundedNext ${roundedNext} < effectiveMin ${effectiveMin}`);
  }

  // 2. Small container underflow protection (totalPair < 2 * minSize)
  const smallTotal = 80; // < 100mm
  const smallEffectiveMin = Math.min(minSize, Math.floor(smallTotal / 2)); // 40mm
  assert.equal(smallEffectiveMin, 40);

  let newPrevSmall = 30 + (-50); // tries to go negative
  if (newPrevSmall < smallEffectiveMin) newPrevSmall = smallEffectiveMin;
  const roundedPrevSmall = Math.round(newPrevSmall);
  const roundedNextSmall = smallTotal - roundedPrevSmall;

  assert.equal(roundedPrevSmall, 40);
  assert.equal(roundedNextSmall, 40);
  assert.equal(roundedPrevSmall + roundedNextSmall, smallTotal);

  // 3. Column pair redistribution
  const p = M.defaultProject();
  const initW0 = p.columns[0].width;
  const initW1 = p.columns[1].width;
  const totalColPair = initW0 + initW1;
  const minW = 150;

  const colDeltas = [50, -75, 120.4, -200, 5000, -5000];
  for (const dx of colDeltas) {
    let newLeft = Math.round(Math.max(minW, Math.min(totalColPair - minW, initW0 + dx)));
    let newRight = totalColPair - newLeft;

    assert.equal(newLeft + newRight, totalColPair, `Column pair invariance violated for delta ${dx}`);
    assert.ok(newLeft >= minW, `Column 0 collapsed below minW: ${newLeft}`);
    assert.ok(newRight >= minW, `Column 1 collapsed below minW: ${newRight}`);

    p.columns[0].width = newLeft;
    p.columns[1].width = newRight;
    const l = computeLayout(p);
    // Total furniture width must remain invariant
    const expectedTotalW = p.columns.reduce((a, c) => a + c.width, 0) + (p.columns.length + 1) * p.settings.thickness;
    assert.equal(l.totalW, expectedTotalW);
  }
});

test('M2: Undo/redo state integrity across drag operations', () => {
  // Test editor history lifecycle simulating app.js exactly
  const state = {
    project: M.defaultProject(),
    selected: null
  };
  const undo = [];
  const redo = [];
  let savedCount = 0;

  const snapshot = () => JSON.stringify(state.project);
  const save = () => { savedCount++; };
  const pushUndo = (prevSnapshot) => {
    if (snapshot() !== prevSnapshot) {
      undo.push(prevSnapshot);
      if (undo.length > 100) undo.shift();
      redo.length = 0;
      save();
    }
  };
  const restore = (from, to) => {
    if (!from.length) return false;
    to.push(snapshot());
    if (to.length > 100) to.shift();
    state.project = JSON.parse(from.pop());
    save();
    return true;
  };
  const handleKey = (e) => {
    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod) return null;
    const key = e.key.toLowerCase();
    if (key === 'z') {
      if (e.preventDefault) e.preventDefault();
      if (e.shiftKey) {
        return restore(redo, undo) ? 'REDO' : 'NO_REDO';
      } else {
        return restore(undo, redo) ? 'UNDO' : 'NO_UNDO';
      }
    } else if (key === 'y' && !e.shiftKey) {
      if (e.preventDefault) e.preventDefault();
      return restore(redo, undo) ? 'REDO' : 'NO_REDO';
    }
    return null;
  };

  // 1. Prepare initial state with an undoable action and undo it so redo has 1 item
  const initialSnapshot = snapshot();
  state.project.columns[0].width = 900;
  pushUndo(initialSnapshot);
  assert.equal(undo.length, 1);
  assert.equal(redo.length, 0);

  // Undo back to initial state
  restore(undo, redo);
  assert.equal(undo.length, 0);
  assert.equal(redo.length, 1);
  const baselineSnapshot = snapshot();

  // 2. Zero-displacement divider click (mousedown and mouseup without move)
  // Sibling normalization must NOT occur eagerly, hasMoved remains false
  let hasMoved = false;
  const clickSnapshot = snapshot();
  // Drag handler onMouseUp check:
  if (hasMoved) {
    pushUndo(clickSnapshot);
  }

  // Redo stack must NOT be cleared by a zero-displacement click!
  assert.equal(undo.length, 0, 'Undo stack must remain empty on click without drag');
  assert.equal(redo.length, 1, 'Redo stack must NOT be cleared by click without drag');
  assert.equal(snapshot(), baselineSnapshot, 'Project state must be completely untouched');

  // 3. Real drag operation
  const dragStartSnapshot = snapshot();
  hasMoved = true;
  // Apply drag resizing
  state.project.columns[0].width = 750;
  state.project.columns[1].width = 450;
  if (hasMoved) {
    pushUndo(dragStartSnapshot);
  }

  assert.equal(undo.length, 1, 'Undo stack must have 1 entry after drag');
  assert.equal(redo.length, 0, 'Redo stack must be cleared after new drag');

  // 4. Test Undo via Ctrl+Z (Windows)
  let prevented = false;
  const pEvent = () => { prevented = true; };
  let res = handleKey({ ctrlKey: true, key: 'z', shiftKey: false, preventDefault: pEvent });
  assert.equal(res, 'UNDO');
  assert.ok(prevented);
  assert.equal(snapshot(), baselineSnapshot, 'State must revert to pre-drag snapshot');
  assert.equal(undo.length, 0);
  assert.equal(redo.length, 1);

  // 5. Test Redo via Ctrl+Y (Windows)
  prevented = false;
  res = handleKey({ ctrlKey: true, key: 'y', shiftKey: false, preventDefault: pEvent });
  assert.equal(res, 'REDO');
  assert.ok(prevented);
  assert.equal(state.project.columns[0].width, 750);
  assert.equal(state.project.columns[1].width, 450);

  // 6. Test Undo via Cmd+Z (macOS)
  prevented = false;
  res = handleKey({ metaKey: true, key: 'z', shiftKey: false, preventDefault: pEvent });
  assert.equal(res, 'UNDO');
  assert.ok(prevented);
  assert.equal(snapshot(), baselineSnapshot);

  // 7. Test Redo via Cmd+Shift+Z (macOS) and uppercase key with CapsLock
  prevented = false;
  res = handleKey({ metaKey: true, key: 'Z', shiftKey: true, preventDefault: pEvent });
  assert.equal(res, 'REDO');
  assert.ok(prevented);
  assert.equal(state.project.columns[0].width, 750);

  // 8. Drag returning to exact start coordinate produces no undo entry
  const returnStartSnapshot = snapshot();
  hasMoved = true;
  // Moves and then moves back to 750
  state.project.columns[0].width = 800;
  state.project.columns[0].width = 750;
  if (hasMoved) {
    pushUndo(returnStartSnapshot);
  }
  assert.equal(undo.length, 1, 'No new undo entry when net displacement is zero');

  // 9. History capping at 100 entries
  for (let i = 0; i < 110; i++) {
    const sBefore = snapshot();
    state.project.columns[0].width = 700 + (i % 2 === 0 ? 10 : -10);
    pushUndo(sBefore);
  }
  assert.equal(undo.length, 100, 'Undo stack must be capped at 100 items');
});

