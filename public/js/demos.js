// public/js/demos.js
// Catálogo de muebles prediseñados y utilidades de clonación con IDs únicos.
import { DEFAULTS, uid } from './layout.js';

export const DEMOS = [
  {
    id: 'closet-modular',
    name: 'Closet modular completo',
    category: 'Dormitorio',
    description: 'Armario ropero completo de 3 columnas con repisas superiores (maletero), percheros dobles para abrigos y camisas, cajonera triple y torre organizadora de 5 estantes.',
    dimensions: '2022 × 2100 × 550 mm',
    tags: ['Maletero superior', 'Doble perchero', 'Cajonera triple', 'Torre 5 repisas'],
    data: {
      settings: { ...DEFAULTS, height: 2100, depth: 550, thickness: 18, overhang: 0, pullStyle: 'bar' },
      columns: [
        {
          id: 'c1',
          width: 750,
          root: {
            id: 'm-c1',
            type: 'multiple',
            dir: 'v',
            size: 1,
            children: [
              { id: 'c1-top', type: 'shelf', size: 400 },
              { id: 'c1-rail', type: 'rail', size: 1050 },
              { id: 'c1-drawers', type: 'drawer', size: 550, count: 3 }
            ]
          }
        },
        {
          id: 'c2',
          width: 750,
          root: {
            id: 'm-c2',
            type: 'multiple',
            dir: 'v',
            size: 1,
            children: [
              { id: 'c2-top', type: 'shelf', size: 400 },
              { id: 'c2-rail1', type: 'rail', size: 800 },
              { id: 'c2-rail2', type: 'rail', size: 800 }
            ]
          }
        },
        {
          id: 'c3',
          width: 450,
          root: {
            id: 'm-c3',
            type: 'multiple',
            dir: 'v',
            size: 1,
            children: [
              { id: 'c3-s1', type: 'shelf', size: 380 },
              { id: 'c3-s2', type: 'shelf', size: 380 },
              { id: 'c3-s3', type: 'shelf', size: 380 },
              { id: 'c3-s4', type: 'shelf', size: 380 },
              { id: 'c3-s5', type: 'shelf', size: 480 }
            ]
          }
        }
      ]
    }
  },
  {
    id: 'mesa-noche',
    name: 'Mesa de noche moderna',
    category: 'Dormitorio',
    description: 'Mesa de noche compacta y funcional con nicho superior abierto para libros o móvil y dos gavetas inferiores con tiradores gola enrasados.',
    dimensions: '536 × 550 × 400 mm',
    tags: ['Nicho abierto', '2 Gavetas', 'Tirador perfil gola', 'Enrasado'],
    data: {
      settings: { ...DEFAULTS, height: 550, depth: 400, thickness: 18, overhang: 0, pullStyle: 'profile' },
      columns: [
        {
          id: 'col-n',
          width: 500,
          root: {
            id: 'm-n',
            type: 'multiple',
            dir: 'v',
            size: 1,
            children: [
              { id: 'n-niche', type: 'shelf', size: 180 },
              { id: 'n-drawers', type: 'drawer', size: 334, count: 2 }
            ]
          }
        }
      ]
    }
  },
  {
    id: 'centro-tv',
    name: 'Centro de entretenimiento / TV rack',
    category: 'Living / TV',
    description: 'Mueble multimedia de 3 cuerpos para televisor con nicho central para soundbar o consola, cajonera doble de almacenamiento y gabinetes laterales con puertas batientes.',
    dimensions: '1872 × 600 × 420 mm',
    tags: ['Nicho consola', '2 Gavetas amplias', 'Puertas batientes laterales'],
    data: {
      settings: { ...DEFAULTS, height: 600, depth: 420, thickness: 18, overhang: 0, pullStyle: 'profile' },
      columns: [
        {
          id: 'col-tv1',
          width: 500,
          root: {
            id: 'm-tv1',
            type: 'multiple',
            dir: 'v',
            size: 1,
            children: [
              { id: 'tv1-open', type: 'shelf', size: 220 },
              { id: 'tv1-door', type: 'shelf', size: 344, front: 'left-door' }
            ]
          }
        },
        {
          id: 'col-tv2',
          width: 800,
          root: {
            id: 'm-tv2',
            type: 'multiple',
            dir: 'v',
            size: 1,
            children: [
              { id: 'tv2-niche', type: 'shelf', size: 220 },
              { id: 'tv2-drawers', type: 'drawer', size: 344, count: 2 }
            ]
          }
        },
        {
          id: 'col-tv3',
          width: 500,
          root: {
            id: 'm-tv3',
            type: 'multiple',
            dir: 'v',
            size: 1,
            children: [
              { id: 'tv3-open', type: 'shelf', size: 220 },
              { id: 'tv3-door', type: 'shelf', size: 344, front: 'right-door' }
            ]
          }
        }
      ]
    }
  },
  {
    id: 'cocina-bajo',
    name: 'Mueble bajo de cocina modular',
    category: 'Cocina',
    description: 'Módulo inferior estándar de repostero de cocina preparado para encimera: cajonera de 3 niveles (cubiertero + 2 caceroleros hondos) y gabinete de 2 puertas con repisa interna.',
    dimensions: '1254 × 850 × 580 mm',
    tags: ['Cajonera cacerolero (x3)', '2 Puertas con repisa', 'Apto encimera'],
    data: {
      settings: { ...DEFAULTS, height: 850, depth: 580, thickness: 18, overhang: 0, pullStyle: 'profile' },
      columns: [
        {
          id: 'col-k1',
          width: 450,
          root: {
            id: 'm-k1',
            type: 'drawer',
            size: 814,
            count: 3
          }
        },
        {
          id: 'col-k2',
          width: 750,
          root: {
            id: 'm-k2',
            type: 'multiple',
            dir: 'v',
            size: 1,
            front: 'doors',
            children: [
              { id: 'k2-s1', type: 'shelf', size: 400 },
              { id: 'k2-s2', type: 'shelf', size: 396 }
            ]
          }
        }
      ]
    }
  }
];

/**
 * Clona profundamente el proyecto de demostración y reasigna UIDs frescos a todas
 * las columnas y nodos del árbol jerárquico para garantizar total independencia de IDs.
 *
 * @param {string|object} demoId Identificador de demo ('closet-modular', etc.) o demo objeto
 * @returns {{ name: string, data: object } | null}
 */
export function cloneDemoProject(demoId) {
  if (!demoId) return null;
  const demo = typeof demoId === 'string' ? DEMOS.find((d) => d.id === demoId) : demoId;
  if (!demo || !demo.data) return null;

  const copy = JSON.parse(JSON.stringify(demo.data));
  const reassign = (node) => {
    if (!node) return;
    node.id = uid();
    if (Array.isArray(node.children)) {
      node.children.forEach(reassign);
    }
  };

  if (Array.isArray(copy.columns)) {
    copy.columns.forEach((col) => {
      col.id = uid();
      if (col.root) reassign(col.root);
    });
  }

  return { name: demo.name, data: copy };
}

/**
 * Helper de conveniencia para obtener únicamente el payload de datos clonado.
 *
 * @param {string|object} demoId
 * @returns {object|null}
 */
export function cloneDemoData(demoId) {
  const p = cloneDemoProject(demoId);
  return p ? p.data : null;
}
