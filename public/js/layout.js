// Motor de cálculo: convierte el árbol de módulos en piezas 3D, celdas 2D, cutlist y precios.
// Todas las medidas internas están en milímetros. Ejes: x = ancho, y = alto, z = fondo (frente en z = depth).

export const DEFAULTS = {
  height: 1400,
  depth: 450,
  thickness: 18,
  backThickness: 20,
  jointClearance: 2,
  frontClearance: 2,
  overhang: 20,
  pullDia: 25,
  pullInset: 40,
  pullGap: 60,
  grooveClearance: 1,
  drawerInset: 20,
  slideClearance: 13,
  drawerThickness: 15,
  drawerBottomThickness: 6,
  pullStyle: 'bar', // manilla por defecto del proyecto
  railOffset: 80, // distancia del perchero al estante superior
  railDia: 25,
  // Precios
  currency: '$',
  priceCarcass: 40, // por m² (laterales, divisiones, tapas)
  priceFront: 70, // por m² (puertas y frentes de gaveta)
  priceBack: 20, // por m² (fondo)
  priceDrawer: 30, // por m² (caja de gaveta)
  pricePullBar: 4, // por manilla de barra
  pricePullKnob: 2, // por pomo
  pricePullProfile: 8, // por perfil/gola
  priceRail: 6, // por metro de barra de perchero
  priceRailBracket: 1.5, // por soporte de barra
  slidePrice: 12, // por par de correderas
  priceSlide: 12, // alias de compatibilidad
  hingePrice: 2, // por bisagra
  priceHinge: 2, // alias de compatibilidad
  slidingTrackPrice: 28, // por juego de rieles y carros
  bifoldHingePrice: 4, // por bisagra de libro para puerta plegable
  bifoldGuidePrice: 8, // por guía corrediza superior para puerta plegable
  gasStrutPrice: 6, // por pistón amortiguador a gas
};

// Catálogo de manillas: cantidad de agujeros por frente y clave de precio.
export const PULLS = {
  bar: { label: 'Manilla de barra', holes: 2, priceKey: 'pricePullBar' },
  knob: { label: 'Pomo', holes: 1, priceKey: 'pricePullKnob' },
  profile: { label: 'Perfil / gola (sin agujeros)', holes: 0, priceKey: 'pricePullProfile' },
  none: { label: 'Sin manilla (push)', holes: 0, priceKey: null },
};

export const SETTING_META = [
  ['depth', 'Fondo', 'mm', 'Profundidad del mueble'],
  ['height', 'Alto total', 'mm', 'Alto exterior del mueble (sin voladizo)'],
  ['thickness', 'Espesor de panel', 'mm', 'Espesor de laterales, tapas, divisiones y frentes'],
  ['backThickness', 'Espesor del fondo', 'mm', 'Espesor del panel trasero'],
  ['jointClearance', 'Holgura de unión', 'mm', 'Holgura entre paneles'],
  ['frontClearance', 'Holgura de frentes', 'mm', 'Separación entre frentes'],
  ['overhang', 'Voladizo lateral', 'mm', 'Cuánto sobresalen los laterales arriba y abajo'],
  ['pullStyle', 'Manilla por defecto', '', 'Se puede cambiar por módulo'],
  ['pullDia', 'Diámetro de agujero', 'mm', 'Agujero de la manilla'],
  ['pullInset', 'Distancia al borde', 'mm', 'Del agujero al borde del frente'],
  ['pullGap', 'Separación de agujeros', 'mm', 'Entre agujeros de la manilla de barra'],
  ['railOffset', 'Perchero: distancia al techo', 'mm', 'Desde el estante superior hasta la barra'],
  ['railDia', 'Perchero: diámetro de barra', 'mm', ''],
  ['grooveClearance', 'Holgura de ranura del fondo', 'mm', ''],
  ['drawerInset', 'Holgura vertical de gaveta', 'mm', ''],
  ['slideClearance', 'Holgura de corredera', 'mm', 'Por lado'],
  ['drawerThickness', 'Espesor caja de gaveta', 'mm', ''],
  ['drawerBottomThickness', 'Espesor fondo de gaveta', 'mm', ''],
  ['currency', 'Moneda', '', 'Símbolo'],
  ['priceCarcass', 'Precio carcasa', '/m²', 'Laterales, divisiones y tapas'],
  ['priceFront', 'Precio frentes', '/m²', 'Puertas y frentes de gaveta'],
  ['priceBack', 'Precio fondo', '/m²', ''],
  ['priceDrawer', 'Precio caja de gaveta', '/m²', ''],
  ['pricePullBar', 'Precio manilla de barra', '/u', ''],
  ['pricePullKnob', 'Precio pomo', '/u', ''],
  ['pricePullProfile', 'Precio perfil / gola', '/u', ''],
  ['priceRail', 'Precio barra de perchero', '/m', ''],
  ['priceRailBracket', 'Precio soporte de barra', '/u', ''],
  ['slidePrice', 'Precio corredera (par)', '/par', ''],
  ['hingePrice', 'Precio bisagra', '/u', ''],
  ['slidingTrackPrice', 'Precio kit corredizo', '/juego', 'Rieles y carros para puertas corredizas'],
  ['bifoldHingePrice', 'Precio bisagra plegable', '/u', 'Bisagras articuladas para puertas acordeón'],
  ['bifoldGuidePrice', 'Precio guía plegable', '/u', 'Guía y carro superior para puerta plegable'],
  ['gasStrutPrice', 'Precio pistón a gas', '/u', 'Pistones amortiguadores para puertas abatibles'],
];

// Contenido de un módulo hoja y puertas que se le pueden superponer.
export const LEAF_TYPES = ['shelf', 'rail', 'drawer'];
export const TYPES = ['multiple', ...LEAF_TYPES];
export const FRONTS = ['none', 'doors', 'left-door', 'right-door', 'sliding', 'bifold', 'lift-up'];
export const LABELS = {
  multiple: 'Contenedor (varios módulos)',
  shelf: 'Abierto / estante',
  rail: 'Perchero',
  drawer: 'Gaveta',
  none: 'Sin puertas',
  doors: 'Dos puertas',
  'left-door': 'Puerta (bisagra izquierda)',
  'right-door': 'Puerta (bisagra derecha)',
  sliding: 'Puertas corredizas (con riel)',
  bifold: 'Puerta plegable / acordeón',
  'lift-up': 'Puerta abatible hacia arriba (pistón a gas)',
  default: 'Por defecto del proyecto',
};

let _id = 0;
export const uid = () => 'm' + Date.now().toString(36) + (_id++).toString(36) + Math.random().toString(36).slice(2, 5);

const norm = (children, avail) => {
  const tot = children.reduce((a, c) => a + (c.size || 1), 0);
  return children.map((c) => ((c.size || 1) / tot) * avail);
};

const round = (n) => Math.round(n * 10) / 10;

export function getColumnHeight(col, settings) {
  if (typeof col?.height === 'number' && Number.isFinite(col.height) && col.height > 0) {
    return col.height;
  }
  return (settings && typeof settings.height === 'number' && Number.isFinite(settings.height) && settings.height > 0)
    ? settings.height
    : DEFAULTS.height;
}

export function computeLayout(project) {
  const s = { ...DEFAULTS, ...(project.settings || {}) };
  const t = s.thickness;
  const cols = project.columns;
  const colHeights = cols.map((c) => getColumnHeight(c, s));
  const maxH = colHeights.length > 0 ? Math.max(...colHeights) : s.height;
  const D = s.depth;
  const bt = s.backThickness;
  const cd = D - bt; // profundidad de carcasa (el fondo ocupa z 0..bt)
  const pieces = [];
  const cells = {};
  const dividers = [];
  const hw = {
    slides: 0,
    hinges: 0,
    pulls: {},
    rails: 0,
    brackets: 0,
    slidingTracks: 0,
    bifoldHinges: 0,
    bifoldGuides: 0,
    gasStruts: 0,
  };
  const add = (p) => pieces.push(p);

  const xs = [];
  const colDividers = [];
  let x = 0;

  // Lateral izquierdo exterior
  const leftLatH = colHeights[0] + 2 * s.overhang;
  add({ name: 'Lateral', label: 'Lateral exterior', cutlistName: 'Lateral exterior', mat: 'carcass', kind: 'side', x, y: -s.overhang, z: 0, sx: t, sy: leftLatH, sz: D, col: 0, sideType: 'outer-left' });
  x += t;
  xs.push(x);
  x += cols[0].width;

  // Laterales intermedios compartidos y divisores de columna
  for (let i = 0; i < cols.length - 1; i++) {
    const sharedH = Math.max(colHeights[i], colHeights[i + 1]) + 2 * s.overhang;
    add({ name: 'Lateral', label: 'Lateral interior', cutlistName: 'Lateral interior', mat: 'carcass', kind: 'side', x, y: -s.overhang, z: 0, sx: t, sy: sharedH, sz: D, col: i + 1, sideType: 'intermediate' });
    const d = { type: 'col', axis: 'h', colIdx: i, x, y: -s.overhang, w: t, h: sharedH, col: i, cursor: 'ew-resize' };
    dividers.push(d);
    colDividers.push(d);
    x += t;
    xs.push(x);
    x += cols[i + 1].width;
  }

  // Lateral derecho exterior
  const rightLatH = colHeights[cols.length - 1] + 2 * s.overhang;
  add({ name: 'Lateral', label: 'Lateral exterior', cutlistName: 'Lateral exterior', mat: 'carcass', kind: 'side', x, y: -s.overhang, z: 0, sx: t, sy: rightLatH, sz: D, col: cols.length, sideType: 'outer-right' });
  const outerD = { type: 'col-outer', axis: 'h', colIdx: cols.length - 1, x, y: -s.overhang, w: t, h: rightLatH, col: cols.length - 1, cursor: 'ew-resize' };
  dividers.push(outerD);
  colDividers.push(outerD);
  const totalW = x + t;

  const pullOf = (n) => (n.pull && n.pull !== 'default' && PULLS[n.pull] ? n.pull : PULLS[s.pullStyle] ? s.pullStyle : 'bar');
  const countPull = (style) => {
    if (style !== 'none') hw.pulls[style] = (hw.pulls[style] || 0) + 1;
  };

  // Puertas que cubren todo el módulo (hoja o contenedor).
  const doorOverlay = (n, cx0, cy0, w, h, col) => {
    const cx = cx0 - t / 2;
    const cy = cy0 - t / 2;
    const cw = w + t;
    const ch = h + t;
    const fc = s.frontClearance;
    const style = pullOf(n);
    const holes = PULLS[style].holes;
    const hingesPer = ch > 1800 ? 4 : ch > 1000 ? 3 : 2;

    const door = (name, px, py, dw, dh, side, holeLayout = 'v', zOffset = 0) => {
      add({
        name,
        role: 'door-front',
        label: LABELS[n.front] || name,
        mat: 'door',
        kind: 'door-front',
        x: px,
        y: py,
        z: D + zOffset,
        sx: dw,
        sy: dh,
        sz: t,
        holes,
        pull: style,
        holeLayout,
        col,
        nodeId: n.id,
        side,
      });
      countPull(style);
    };

    if (n.front === 'doors') {
      const dw = (cw - 3 * fc) / 2;
      door('Puerta', cx + fc, cy + fc, dw, ch - 2 * fc, 'right');
      door('Puerta', cx + 2 * fc + dw, cy + fc, dw, ch - 2 * fc, 'left');
      hw.hinges += hingesPer * 2;
    } else if (n.front === 'left-door') {
      door('Puerta', cx + fc, cy + fc, cw - 2 * fc, ch - 2 * fc, 'right');
      hw.hinges += hingesPer;
    } else if (n.front === 'right-door') {
      door('Puerta', cx + fc, cy + fc, cw - 2 * fc, ch - 2 * fc, 'left');
      hw.hinges += hingesPer;
    } else if (n.front === 'sliding') {
      const dw = (cw - 2 * fc) / 2 + 15;
      const dh = ch - 2 * fc;
      // Puerta corrediza izquierda (carril interno en z = D, se desliza a la derecha al abrir)
      door('Puerta corrediza', cx + fc, cy + fc, dw, dh, 'sliding-inner', 'v', 0);
      // Puerta corrediza derecha (carril externo en z = D + t + 2, se desliza a la izquierda al abrir)
      door('Puerta corrediza', cx + cw - fc - dw, cy + fc, dw, dh, 'sliding-outer', 'v', t + 2);
      hw.slidingTracks = (hw.slidingTracks || 0) + 1;
    } else if (n.front === 'bifold') {
      const dw = (cw - 3 * fc) / 2;
      const dh = ch - 2 * fc;
      // Hoja anclada al lateral del mueble
      door('Puerta plegable', cx + fc, cy + fc, dw, dh, 'bifold-anchor');
      // Hoja plegable central que pliega hacia afuera en acordeón
      door('Puerta plegable', cx + 2 * fc + dw, cy + fc, dw, dh, 'bifold-fold');
      hw.bifoldHinges = (hw.bifoldHinges || 0) + 4;
      hw.bifoldGuides = (hw.bifoldGuides || 0) + 1;
    } else if (n.front === 'lift-up') {
      const dw = cw - 2 * fc;
      const dh = ch - 2 * fc;
      // Puerta abatible superior en z = D + 1 con manilla horizontal inferior
      door('Puerta abatible arriba', cx + fc, cy + fc, dw, dh, 'lift-up', 'h', 1);
      hw.gasStruts = (hw.gasStruts || 0) + 2;
      hw.hinges += 2;
    }
  };

  const leafContents = (n, cx0, cy0, w, h, col, coveredByDoor = false) => {
    const cx = cx0 - t / 2;
    const cy = cy0 - t / 2;
    const cw = w + t;
    const ch = h + t;
    const fc = s.frontClearance;
    if (n.type === 'rail') {
      add({ name: 'Barra de perchero', mat: 'rail', kind: 'rail', x: cx0, y: cy0 + h - s.railOffset - s.railDia, z: bt + cd / 2 - s.railDia / 2, sx: w, sy: s.railDia, sz: s.railDia, col, nodeId: n.id });
      hw.rails += w;
      hw.brackets += 2;
    } else if (n.type === 'drawer') {
      const style = pullOf(n);
      const holes = PULLS[style].holes;
      const cnt = Math.max(1, Math.round(n.count || 1));
      const slot = ch / cnt;
      const inner = h / cnt;
      const sc = s.slideClearance;
      const dt = s.drawerThickness;
      const frontZ = coveredByDoor ? D - t - 10 : D;
      const availD = coveredByDoor ? cd - t - 10 : cd;
      const bw = Math.max(2 * dt + 5, w - 2 * sc);
      const bd = Math.max(2 * dt + 5, availD - 20);
      const bz = frontZ - bd;
      const innerW = Math.max(30, bw - 2 * dt);
      const innerD = Math.max(30, bd - 2 * dt);
      const insetX = coveredByDoor ? fc + 2 : fc;
      const frontX = coveredByDoor ? cx0 + insetX : cx + fc;
      const frontW = coveredByDoor ? Math.max(10, w - 2 * insetX) : Math.max(10, cw - 2 * fc);
      for (let i = 0; i < cnt; i++) {
        const idx = cnt - 1 - i; // el primero queda arriba
        const frontY = coveredByDoor ? cy0 + idx * inner + fc / 2 : cy + idx * slot + fc / 2;
        const frontH = coveredByDoor ? Math.max(10, inner - fc) : Math.max(10, slot - fc);
        add({ name: 'Frente de gaveta', mat: 'front', kind: 'front', x: frontX, y: frontY, z: frontZ, sx: frontW, sy: frontH, sz: t, holes, pull: style, holeLayout: 'h', col, nodeId: n.id, drawerIndex: idx, isInternal: coveredByDoor });
        countPull(style);
        hw.slides += 1;
        const bh = Math.max(10, inner - s.drawerInset);
        const by = cy0 + idx * inner + (inner - bh) / 2;
        const bx = cx0 + sc;
        const base = { mat: 'drawer', kind: 'drawer', col, nodeId: n.id, drawerIndex: idx, isInternal: coveredByDoor };
        add({ ...base, name: 'Lateral de gaveta', x: bx, y: by, z: bz, sx: dt, sy: bh, sz: bd });
        add({ ...base, name: 'Lateral de gaveta', x: bx + bw - dt, y: by, z: bz, sx: dt, sy: bh, sz: bd });
        add({ ...base, name: 'Frente/trasera de gaveta', x: bx + dt, y: by, z: frontZ - dt, sx: innerW, sy: bh, sz: dt });
        add({ ...base, name: 'Frente/trasera de gaveta', x: bx + dt, y: by, z: bz, sx: innerW, sy: bh, sz: dt });
        add({ ...base, name: 'Fondo de gaveta', x: bx + dt, y: by + 4, z: bz + dt, sx: innerW, sy: s.drawerBottomThickness, sz: innerD });
      }
    }
  };

  const placeInner = (n, px, py, w, h, col, coveredByDoor = false) => {
    cells[n.id] = { id: n.id, x: px, y: py, w, h, type: n.type, dir: n.dir, col, front: n.front || 'none' };
    const kids = n.type === 'multiple' ? n.children || [] : [];
    if (!kids.length) {
      leafContents(n, px, py, w, h, col, coveredByDoor);
      return;
    }
    const k = kids.length;
    if (n.dir === 'h') {
      const sizes = norm(kids, w - (k - 1) * t);
      let cx = px;
      kids.forEach((ch, j) => {
        place(ch, cx, py, sizes[j], h, col, coveredByDoor);
        cx += sizes[j];
        if (j < k - 1) {
          add({ name: 'División vertical', mat: 'carcass', kind: 'v', x: cx, y: py, z: bt, sx: t, sy: h, sz: cd, col, nodeId: n.id });
          dividers.push({ axis: 'h', parentId: n.id, prevId: ch.id, nextId: kids[j + 1].id, x: cx, y: py, w: t, h, col });
          cx += t;
        }
      });
    } else {
      const sizes = norm(kids, h - (k - 1) * t);
      let cy = py + h;
      kids.forEach((ch, j) => {
        cy -= sizes[j];
        place(ch, px, cy, w, sizes[j], col, coveredByDoor);
        if (j < k - 1) {
          cy -= t;
          add({ name: 'Estante / división', mat: 'carcass', kind: 'h', x: px, y: cy, z: bt, sx: w, sy: t, sz: cd, col, nodeId: n.id });
          dividers.push({ axis: 'v', parentId: n.id, prevId: ch.id, nextId: kids[j + 1].id, x: px, y: cy, w, h: t, col });
        }
      });
    }
  };

  // Contenido del módulo + puertas opcionales que cubren TODO el módulo (útil para closets).
  const place = (n, px, py, w, h, col, parentCovered = false) => {
    const hasDoor = !parentCovered && n.front && n.front !== 'none' && (n.type !== 'drawer' || n.front === 'doors');
    const isCovered = parentCovered || hasDoor;
    placeInner(n, px, py, w, h, col, isCovered);
    if (hasDoor) doorOverlay(n, px, py, w, h, col);
  };

  cols.forEach((c, i) => {
    const x0 = xs[i];
    const W = c.width;
    const colH = colHeights[i];
    add({ name: 'Tapa superior', mat: 'carcass', kind: 'h', x: x0, y: colH - t, z: bt, sx: W, sy: t, sz: cd, col: i });
    add({ name: 'Base', mat: 'carcass', kind: 'h', x: x0, y: 0, z: bt, sx: W, sy: t, sz: cd, col: i });
    const g = s.grooveClearance;
    add({ name: 'Fondo', mat: 'back', kind: 'back', x: x0 - 10 + g, y: t - 10 + g, z: 0, sx: W + 20 - 2 * g, sy: colH - 2 * t + 20 - 2 * g, sz: bt, col: i });
    place(c.root, x0, t, W, colH - 2 * t, i);
  });

  // Top-border divider handles for 2D vertical drag resizing
  cols.forEach((c, i) => {
    const x0 = xs[i];
    const W = c.width;
    const colH = colHeights[i];
    dividers.push({
      type: 'col-top',
      axis: 'v',
      colIdx: i,
      colId: c.id,
      x: x0,
      y: colH - t,
      w: W,
      h: t,
      cursor: 'ns-resize',
    });
  });

  return { settings: s, maxH, pieces, cells, dividers, colDividers, totalW, hardware: hw, cutlist: buildCutlist(pieces, s, hw) };
}

const PRICE_KEY = {
  carcass: 'priceCarcass',
  front: 'priceFront',
  door: 'priceFront',
  'door-front': 'priceFront',
  back: 'priceBack',
  drawer: 'priceDrawer',
};

const ROLE = {
  Lateral: 'vertical-side',
  'Lateral exterior': 'vertical-side',
  'Lateral interior': 'vertical-side',
  side: 'vertical-side',
  'División vertical': 'vertical-side',
  'Tapa superior': 'horizontal-deck',
  Base: 'horizontal-deck',
  'Estante / división': 'horizontal-deck',
  Fondo: 'back-panel',
  Puerta: 'door-front',
  'Puerta corrediza': 'door-front',
  'Puerta plegable': 'door-front',
  'Puerta abatible arriba': 'door-front',
  'door-front': 'door-front',
  'Frente de gaveta': 'drawer-front',
  'Lateral de gaveta': 'drawer-side',
  'Frente/trasera de gaveta': 'drawer-back',
  'Fondo de gaveta': 'drawer-bottom',
};
const ROLE_ORDER = ['back-panel', 'door-front', 'drawer-back', 'drawer-bottom', 'drawer-front', 'drawer-side', 'horizontal-deck', 'vertical-side'];
const ROLE_PREFIX = { 'back-panel': 'B', 'door-front': 'O', 'drawer-back': 'D', 'drawer-bottom': 'D', 'drawer-front': 'D', 'drawer-side': 'D', 'horizontal-deck': 'H', 'vertical-side': 'S' };

// Orientación según el eje en que la pieza es más delgada.
export function orientationOf(p) {
  const m = Math.min(p.sx, p.sy, p.sz);
  if (m === p.sz) return { o: 'vertical-xy', w: p.sx, h: p.sy, t: p.sz };
  if (m === p.sy) return { o: 'horizontal-xz', w: p.sx, h: p.sz, t: p.sy };
  return { o: 'vertical-yz', w: p.sz, h: p.sy, t: p.sx };
}

export function buildCutlist(pieces, s, hw) {
  const map = new Map();
  const machMap = new Map();
  const mach = (op, role, face, diameter, depth, width, length, through) => {
    const key = [op, role, face, diameter, depth, width, length, through].join('|');
    const r = machMap.get(key) || { op, role, face, diameter, depth, width, length, through, qty: 0 };
    r.qty += 1;
    machMap.set(key, r);
  };
  for (const p of pieces) {
    if (p.kind === 'rail') continue; // barra de perchero: va en herrajes
    const ori = orientationOf(p);
    const cutName = p.cutlistName || p.name;
    const role = p.role || ROLE[cutName] || ROLE[p.name] || ROLE[p.kind] || cutName;
    const w = round(ori.w);
    const h = round(ori.h);
    const T = round(ori.t);
    const key = [role, cutName, ori.o, w, h, T].join('|');
    let r = map.get(key);
    if (!r) {
      const area = (w * h) / 1e6;
      const [L, W] = [Math.max(w, h), Math.min(w, h)];
      const priceKey = PRICE_KEY[p.mat] || PRICE_KEY[p.kind] || 'priceFront';
      r = {
        name: cutName,
        label: p.label,
        baseName: p.name,
        role,
        orientation: ori.o,
        mat: p.mat,
        w,
        h,
        length: L,
        width: W,
        thickness: T,
        qty: 0,
        holes: p.holes || 0,
        unitPrice: area * (s[priceKey] || 0),
        unitArea: area,
      };
      map.set(key, r);
    }
    r.qty += 1;
    // Operaciones de mecanizado
    const groove = (face, length) => mach('rail-cut', role, face, null, 5, 21, round(length), false);
    if (p.kind === 'side' || p.kind === 'h') groove('back', p.kind === 'side' ? p.sy : p.sx);
    if (p.kind === 'drawer' && p.name !== 'Fondo de gaveta') groove('front', Math.max(p.sx, p.sz));
    if (p.holes) for (let i = 0; i < p.holes; i++) mach('through-hole', role, 'front', s.pullDia, round(T), null, null, true);
  }
  const sorted = [...map.values()].sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || b.length - a.length || b.width - a.width
  );
  const counters = {};
  const rows = sorted.map((r) => {
    const pre = ROLE_PREFIX[r.role] || 'X';
    counters[pre] = (counters[pre] || 0) + 1;
    return { ...r, id: pre + counters[pre], total: r.unitPrice * r.qty };
  });
  const machining = [...machMap.values()].sort((a, b) => a.op.localeCompare(b.op) || a.role.localeCompare(b.role));
  const hardware = [];
  Object.entries(hw.pulls || {}).forEach(([style, qty]) => {
    const price = s[PULLS[style].priceKey] || 0;
    hardware.push({ name: PULLS[style].label, qty, unitPrice: price, total: qty * price });
  });
  if (hw.rails) {
    const m = Math.round((hw.rails / 1000) * 100) / 100;
    hardware.push({ name: 'Barra de perchero (m)', qty: m, unitPrice: s.priceRail, total: m * s.priceRail });
    hardware.push({ name: 'Soporte de barra', qty: hw.brackets, unitPrice: s.priceRailBracket, total: hw.brackets * s.priceRailBracket });
  }
  if (hw.slides) hardware.push({ name: 'Corredera (par)', qty: hw.slides, unitPrice: s.slidePrice, total: hw.slides * s.slidePrice });
  if (hw.hinges) hardware.push({ name: 'Bisagra', qty: hw.hinges, unitPrice: s.hingePrice, total: hw.hinges * s.hingePrice });
  if (hw.slidingTracks) {
    const unitPrice = s.slidingTrackPrice ?? 28;
    hardware.push({
      name: 'Kit corredizo (rieles y carros)',
      qty: hw.slidingTracks,
      unitPrice,
      total: hw.slidingTracks * unitPrice,
    });
  }
  if (hw.bifoldHinges) {
    const unitPrice = s.bifoldHingePrice ?? 4;
    hardware.push({
      name: 'Bisagra de libro para puerta plegable',
      qty: hw.bifoldHinges,
      unitPrice,
      total: hw.bifoldHinges * unitPrice,
    });
  }
  if (hw.bifoldGuides) {
    const unitPrice = s.bifoldGuidePrice ?? 8;
    hardware.push({
      name: 'Guía superior para puerta plegable',
      qty: hw.bifoldGuides,
      unitPrice,
      total: hw.bifoldGuides * unitPrice,
    });
  }
  if (hw.gasStruts) {
    const unitPrice = s.gasStrutPrice ?? 6;
    hardware.push({
      name: 'Pistón a gas para puerta abatible',
      qty: hw.gasStruts,
      unitPrice,
      total: hw.gasStruts * unitPrice,
    });
  }
  const panelsTotal = rows.reduce((a, r) => a + r.total, 0);
  const hardwareTotal = hardware.reduce((a, r) => a + r.total, 0);
  const area = rows.reduce((a, r) => a + r.unitArea * r.qty, 0);
  return { rows, machining, hardware, panelsTotal, hardwareTotal, total: panelsTotal + hardwareTotal, area, m2: area };
}

export function cutlistCSV(cl, currency = '$') {
  const q = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const lines = [['Pieza', 'Material', 'Largo mm', 'Ancho mm', 'Espesor mm', 'Cantidad', 'Precio unit.', 'Total'].map(q).join(',')];
  cl.rows.forEach((r) =>
    lines.push([r.name, r.mat, r.length, r.width, r.thickness, r.qty, r.unitPrice.toFixed(2), r.total.toFixed(2)].map(q).join(','))
  );
  cl.hardware.forEach((r) => lines.push([r.name, 'herraje', '', '', '', r.qty, r.unitPrice.toFixed(2), r.total.toFixed(2)].map(q).join(',')));
  lines.push(['TOTAL (' + currency + ')', '', '', '', '', '', '', cl.total.toFixed(2)].map(q).join(','));
  return lines.join('\n');
}
