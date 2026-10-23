// Operaciones sobre el árbol de módulos. Un módulo es:
//  - hoja: { id, type: 'shelf'|'drawer'|'doors'|'left-door'|'right-door', size, count? }
//  - contenedor: { id, type: 'multiple', dir: 'v'|'h', size, children: [...] }   <-- permite módulos DENTRO de módulos
import { uid, DEFAULTS, FRONTS, computeLayout, getColumnHeight } from './layout.js';

export const leaf = (type = 'shelf', extra = {}) => ({ id: uid(), type, size: 1, ...extra });

// Crea una hoja a partir de una "clase" de módulo: shelf | rail | drawer | doors | left-door | right-door
export function makeLeaf(kind = 'shelf') {
  if (FRONTS.includes(kind) && kind !== 'none') return leaf('shelf', { front: kind });
  return leaf(kind, kind === 'drawer' ? { count: 1 } : {});
}
export const newColumn = (width = 600, height) => {
  const col = { id: uid(), width, root: leaf('shelf') };
  if (typeof height === 'number' && Number.isFinite(height) && height > 0) col.height = height;
  return col;
};

// Migra proyectos guardados con el formato antiguo al nuevo y garantiza integridad de settings e IDs.
export function normalizeProject(project) {
  if (!project.settings) project.settings = { ...DEFAULTS };
  else project.settings = { ...DEFAULTS, ...project.settings };

  const seenIds = new Set();
  const ensureId = (obj) => {
    if (!obj.id || typeof obj.id !== 'string' || seenIds.has(obj.id)) {
      obj.id = uid();
    }
    seenIds.add(obj.id);
  };

  const walk = (n) => {
    ensureId(n);
    if (['doors', 'left-door', 'right-door', 'sliding', 'bifold', 'lift-up'].includes(n.type)) {
      n.front = n.type;
      n.type = 'shelf';
    }
    (n.children || []).forEach(walk);
  };

  if (Array.isArray(project.columns)) {
    project.columns.forEach((c) => {
      ensureId(c);
      if (typeof c.height !== 'number' || !Number.isFinite(c.height) || c.height <= 0) delete c.height;
      if (c.root) walk(c.root);
    });
  }
  return project;
}

export function defaultProject() {
  const col = (children) => ({
    id: uid(),
    width: 764,
    root: { id: uid(), type: 'multiple', dir: 'v', size: 1, children },
  });
  return {
    settings: { ...DEFAULTS },
    columns: [
      col([leaf('shelf', { size: 650 }), leaf('drawer', { size: 500, count: 3 })]),
      col([leaf('shelf', { size: 650 }), leaf('shelf', { size: 500, front: 'left-door' })]),
      col([leaf('shelf', { size: 300 }), leaf('shelf', { size: 300 }), leaf('shelf', { size: 300 })]),
    ],
  };
}

// Cambia las puertas que cubren el módulo (hoja o contenedor). 'none' las quita.
export function setFront(project, id, front) {
  const f = find(project, id);
  if (!f) return;
  if (front === 'none') delete f.node.front;
  else f.node.front = front;
}

// Cambia la manilla de un módulo ('default' = la del proyecto).
export function setPull(project, id, pull) {
  const f = find(project, id);
  if (!f) return;
  if (pull === 'default') delete f.node.pull;
  else f.node.pull = pull;
}

export function find(project, id) {
  let res = null;
  const walk = (n, parent, col) => {
    if (res) return;
    if (n.id === id) {
      res = { node: n, parent, col };
      return;
    }
    (n.children || []).forEach((c) => walk(c, n, col));
  };
  project.columns.forEach((c) => walk(c.root, null, c));
  return res;
}

const clone = (n) => JSON.parse(JSON.stringify(n));
const replaceContent = (target, src) => {
  Object.keys(target).forEach((k) => {
    if (k !== 'id' && k !== 'size') delete target[k];
  });
  Object.assign(target, src, { id: target.id, size: target.size });
};

// Congela las alturas relativas de los módulos a sus valores exactos en milímetros según el layout actual.
export function freezeColumnHeights(project, layout) {
  if (!layout || !layout.cells) return;
  const walk = (node) => {
    if (!node) return;
    if (node.type === 'multiple' && Array.isArray(node.children)) {
      if (node.dir === 'v') {
        node.children.forEach((child) => {
          const cell = layout.cells[child.id];
          if (cell && typeof cell.h === 'number') {
            child.size = Math.round(cell.h * 10) / 10;
          }
        });
      }
      node.children.forEach(walk);
    }
  };
  project.columns.forEach((col) => {
    walk(col.root);
  });
}

// Convierte el módulo en un contenedor con [copia del módulo original, nuevo módulo].
export function wrap(node, dir, newNode, before = false, existingSize = null) {
  const copySize = existingSize != null ? existingSize : (dir === 'v' ? (node.size || 1) : 1);
  const copy = { ...clone(node), id: uid(), size: copySize };
  if (!newNode.size) newNode.size = 1;
  replaceContent(node, { type: 'multiple', dir, children: before ? [newNode, copy] : [copy, newNode] });
  return newNode;
}

export function setType(project, id, type) {
  const f = find(project, id);
  if (!f) return;
  const n = f.node;
  if (FRONTS.includes(type) && type !== 'none') return setFront(project, id, type); // compatibilidad
  if (n.type === type) return;
  if (type === 'multiple') {
    // un módulo hoja se convierte en contenedor que conserva el contenido original
    wrap(n, 'v', leaf('shelf'));
  } else {
    delete n.children;
    delete n.dir;
    n.type = type;
    if (type === 'drawer') n.count = n.count || 1;
  }
}

// Agrega un módulo DENTRO del módulo seleccionado (la función clave de esta réplica).
export function addInside(project, id, dir = 'v', type = 'shelf') {
  const f = find(project, id);
  if (!f) return null;
  const n = f.node;
  const nn = makeLeaf(type);
  if (n.type === 'multiple' && n.dir === dir) {
    const avg = n.children.reduce((a, c) => a + c.size, 0) / n.children.length;
    nn.size = avg;
    n.children.push(nn);
    return nn;
  }
  return wrap(n, dir, nn);
}

// Agrega un módulo al lado (dir 'h') o debajo/arriba (dir 'v') del seleccionado.
export function addSibling(project, id, dir = 'v', type = 'shelf', before = false) {
  const f = find(project, id);
  if (!f) return null;
  const nn = makeLeaf(type);
  if (f.parent && f.parent.dir === dir) {
    const i = f.parent.children.indexOf(f.node);
    nn.size = f.node.size;
    f.parent.children.splice(before ? i : i + 1, 0, nn);
    return nn;
  }
  return wrap(f.node, dir, nn, before);
}

// Agrega un módulo arriba de la columna (expandiendo la altura del mueble para no comprimir los existentes).
export function addOnTop(project, colId, type = 'shelf', addedHeight = 350, allColumns = false) {
  const col = project.columns.find((c) => c.id === colId);
  if (!col) return null;
  const t = project.settings.thickness;

  // 1. Calculamos el layout actual y congelamos las alturas de todos los módulos en milímetros
  const initialLayout = computeLayout(project);
  freezeColumnHeights(project, initialLayout);

  const addModuleToCol = (targetCol, moduleType) => {
    const nn = makeLeaf(moduleType);
    nn.size = addedHeight;
    if (targetCol.root.type === 'multiple' && targetCol.root.dir === 'v') {
      targetCol.root.children.unshift(nn);
      return nn;
    }
    const targetH = getColumnHeight(targetCol, project.settings);
    const currentH = initialLayout.cells[targetCol.root.id]?.h || (targetH - 2 * t);
    return wrap(targetCol.root, 'v', nn, true, currentH);
  };

  // 2. Modo escalonado por columna (por defecto allColumns = false)
  if (!allColumns) {
    // Si las columnas hermanas no tienen c.height explícito, fijamos c.height = project.settings.height
    // para que su altura quede explícitamente bloqueada e invariante
    project.columns.forEach((c) => {
      if (c.id !== colId && (typeof c.height !== 'number' || c.height <= 0)) {
        c.height = project.settings.height;
      }
    });

    // Agregamos el nuevo módulo ÚNICAMENTE a la columna objetivo
    const targetModule = addModuleToCol(col, type);

    // Incrementamos únicamente la columna objetivo:
    col.height = (typeof col.height === 'number' && col.height > 0 ? col.height : project.settings.height) + addedHeight + t;

    // NO incrementamos project.settings.height
    return targetModule;
  }

  // 3. Modo legado (allColumns = true)
  const targetModule = addModuleToCol(col, type);
  project.columns.forEach((c) => {
    if (c.id !== colId) {
      addModuleToCol(c, 'shelf');
    }
  });

  // Incrementamos la altura exterior del mueble exactamente en (addedHeight + t)
  project.settings.height += addedHeight + t;

  return targetModule;
}

export function addColumn(project, index, width = 600) {
  const c = newColumn(width);
  if (!project.columns) project.columns = [];
  const idx = typeof index === 'number' ? Math.max(0, Math.min(index, project.columns.length)) : project.columns.length;
  project.columns.splice(idx, 0, c);
  return c.root;
}

export function deleteModule(project, id) {
  const f = find(project, id);
  if (!f) return null;
  if (!f.parent) {
    if (project.columns.length > 1) {
      project.columns.splice(project.columns.indexOf(f.col), 1);
    } else {
      f.col.root = leaf('shelf');
    }
    return null;
  }
  const p = f.parent;
  p.children.splice(p.children.indexOf(f.node), 1);
  if (p.children.length === 1) {
    const only = p.children[0];
    replaceContent(p, clone(only));
  }
  return p.id;
}

// Cambia ancho (axis 'w') o alto (axis 'h') de un módulo; los hermanos se reajustan proporcionalmente.
export function setSize(project, cells, id, axis, valueMm, settings) {
  const f = find(project, id);
  if (!f) return;
  const t = settings.thickness;
  const dirNeeded = axis === 'w' ? 'h' : 'v';
  // sube hasta encontrar el ancestro cuyo padre divide en la dirección necesaria
  let cur = f.node;
  let parent = f.parent;
  const chain = [];
  const collectParents = (n) => {
    const r = find(project, n.id);
    return r;
  };
  let r = collectParents(cur);
  while (r && r.parent) {
    if (r.parent.dir === dirNeeded) {
      cur = r.node;
      parent = r.parent;
      chain.push(cur);
      break;
    }
    r = collectParents(r.parent);
  }
  if (!(parent && parent.dir === dirNeeded && chain.length)) {
    // Sin padre dividido en esa dirección: afecta a la columna / proyecto.
    if (axis === 'w') f.col.width = Math.max(100, valueMm);
    else f.col.height = Math.max(200, valueMm + 2 * t);
    return;
  }
  const kids = parent.children;
  const pc = cells[parent.id];
  const avail = (axis === 'w' ? pc.w : pc.h) - (kids.length - 1) * t;
  const actual = kids.map((k) => (axis === 'w' ? cells[k.id].w : cells[k.id].h));
  const min = 40;
  const v = Math.max(min, Math.min(valueMm, avail - min * (kids.length - 1)));
  const idx = kids.indexOf(cur);
  const others = actual.reduce((a, x, i) => (i === idx ? a : a + x), 0);
  const scale = others > 0 ? (avail - v) / others : 1;
  kids.forEach((k, i) => (k.size = i === idx ? v : actual[i] * scale));
}

// Duplica un módulo conservando tipo, frentes, divisiones y medidas, generando nuevos IDs.
export function duplicateModule(project, id) {
  const f = find(project, id);
  if (!f) return null;
  const cloneTree = (n) => {
    const copy = { ...JSON.parse(JSON.stringify(n)), id: uid() };
    if (Array.isArray(copy.children)) {
      copy.children = copy.children.map(cloneTree);
    }
    return copy;
  };
  const dup = cloneTree(f.node);
  if (f.parent && Array.isArray(f.parent.children)) {
    const idx = f.parent.children.indexOf(f.node);
    f.parent.children.splice(idx + 1, 0, dup);
    return dup;
  } else if (!f.parent && f.col && f.col.root === f.node) {
    // Si es la raíz de la columna, se envuelve en un contenedor vertical con el original y el duplicado
    const orig = cloneTree(f.node);
    orig.size = 1;
    dup.size = 1;
    f.col.root = {
      id: uid(),
      type: 'multiple',
      dir: 'v',
      size: 1,
      children: [orig, dup],
    };
    return dup;
  }
  return null;
}

