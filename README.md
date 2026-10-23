# Dajusca.app — Diseñador Modular 2D/3D, Cotizador y Hoja de Corte

Aplicación web de **Dajusca** diseñada para **carpinteros, mueblistas y clientes** que necesitan diseñar closets y muebles modulares en 2D/3D, obtener una **hoja de corte profesional (cutlist)** al milímetro y emitir **cotizaciones formales en PDF** al instante, sin la complejidad de un ERP.

## Características principales

- **Diseño Paramétrico 2D Interactivo**:
  - Creación de columnas escalonadas (alturas independientes), subdivisiones verticales/horizontales y redimensionamiento en tiempo real arrastrando divisores.
  - Historial completo de Deshacer / Rehacer (`Ctrl+Z` / `Ctrl+Y`).
- **Visualizador 3D en Tiempo Real (Three.js)**:
  - Vista normal, modo **Puertas abiertas** (con cinemática sin colisión para puertas batientes, correderas, plegables en acordeón `> 90°`, abatibles superiores y apertura en escalera para gavetas apiladas en el mismo módulo o en módulos adyacentes) y vista de **Despiece (Explode)**.
  - Temas visuales: *Madera realista* con sombras suaves y *Negro carbón (CAD/Neón)*.
- **Gavetas Internas y Herrajes**:
  - Soporte para gavetas interiores retranqueadas (`z = D - t - 10 mm`) dentro de módulos con puertas.
  - Conteo automático de correderas telescópicas, bisagras cazoleta, rieles corredizos, kits acordeón, pistones a gas, barras de perchero y tiradores.
- **Presupuestos Correlativos y Clientes (SQLite)**:
  - Registro ligero de clientes y asociación directa a cada proyecto.
  - Numeración correlativa automática de presupuestos (`PRE-0001`, `PRE-0002`, ...).
- **Hoja de Corte y Exportación PDF / CSV**:
  - Desglose exacto de tableros (`Largo × Ancho × Espesor mm`), orientación de veta, herrajes y operaciones de mecanizado (`rail-cut` y `through-hole`).
  - Generación de **Cotización Formal en PDF** (`pdf-lib`) con membrete de **Dajusca.app**, datos del cliente, resumen comercial y tabla de cortes lista para taller.

## Requisitos e Instalación

```bash
npm install
npm start
```

El servidor se iniciará en `http://localhost:3000`.

## Pruebas automatizadas

```bash
npm test
```
