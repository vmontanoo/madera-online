# Original User Request

## 2026-10-22T19:33:49Z

<USER_REQUEST>
Ampliar y optimizar la réplica local del diseñador de muebles modulares (Madera local) implementando tres áreas de trabajo coordinadas: adición fluida de módulos en los extremos exteriores (costados y parte superior) que se puedan arrastrar para definir su tamaño, redimensionamiento visual e intuitivo por arrastre de filas y columnas en el canvas 2D, y generación de una hoja de corte (Cutlist) completa y profesional optimizada para impresión en formato exclusivamente tabular desglosado con detalle de cada pieza y precio final.

Working directory: C:\Users\rosibel m\.gemini\antigravity\scratch\madera-local
Integrity mode: development

## Requirements

### R1. Módulos exteriores con creación por defecto y tamaño ajustable por arrastre
- Al pulsar los botones `+` en los costados (izquierda/derecha) o encima de la estructura, se debe crear un módulo con medida por defecto.
- La estructura general del mueble debe expandirse automáticamente para alojar el nuevo módulo sin alterar ni comprimir las medidas de los módulos ya existentes.
- El módulo recién creado debe quedar listo y permitir arrastrar su borde o divisor inmediatamente para calibrar su medida de forma visual.

### R2. Redimensionamiento visual por selección y arrastre de filas y columnas
- En el modelo 2D, permitir seleccionar y arrastrar los límites de filas, columnas y divisiones de forma precisa y responsiva.
- El arrastre debe redistribuir el espacio entre las secciones afectadas manteniendo las proporciones del resto del diseño.
- Las dimensiones mostradas y el modelo 3D deben actualizarse en tiempo real durante y tras el arrastre.

### R3. Hoja de corte completa optimizada para impresión (formato exclusivamente tabular)
- La vista de impresión (`window.print()` / PDF) y la tabla de cortes deben mostrar un formato exclusivamente tabular limpio, sin miniaturas ni gráficos innecesarios que ocupen espacio en la hoja impresa.
- La tabla debe desglosar individualmente cada tabla/panel: Identificador, Rol/Nombre, Orientación, Dimensiones exactas (Largo x Ancho x Espesor), Cantidad, Precio unitario y Precio total.
- Incluir desglose de herrajes y mecanizados necesarios.
- Mostrar de forma destacada en el pie o encabezado el precio final total calculado del proyecto.

## Acceptance Criteria

### Funcionalidad de Módulos Exteriores (R1)
- [ ] Hacer clic en `+` superior agrega un módulo arriba expandiendo la altura del mueble sin encoger los módulos existentes.
- [ ] Hacer clic en `+` laterales agrega una nueva columna expandiendo el ancho total del mueble.
- [ ] El nuevo módulo puede ser redimensionado directamente arrastrando sus bordes.

### Arrastre de Filas y Columnas (R2)
- [ ] Indicador de cursor (`ns-resize` / `ew-resize`) reactivo sobre los divisores y bordes de filas y columnas.
- [ ] Arrastrar un divisor ajusta fluidamente las dimensiones relativas de las celdas adyacentes.
- [ ] Registro en el historial de desacer/rehacer (`Ctrl+Z` / `Ctrl+Y`) al finalizar el arrastre.

### Impresión Tabular de Hoja de Cortes (R3)
- [ ] Al imprimir (o previsualizar para impresión), el documento muestra únicamente tablas limpias y legibles: paneles cortados, herrajes y totales.
- [ ] No se muestran miniaturas, canvas 2D, visor 3D ni botones de interfaz en la hoja impresa.
- [ ] El precio final total calculado del mueble y los totales por categoría aparecen claramente visibles.

</USER_REQUEST>

## 2026-10-23T00:40:10Z

<USER_REQUEST>
Evolucionar la réplica local de Madera hacia una versión profesional completa: autenticación moderna (registro/login y Google OAuth), nuevo dashboard principal con galería de muebles prediseñados (closet, mesa de noche, centro de entretenimiento, cocina) y pestaña de proyectos con importación/creación, depuración de controles obsoletos y ampliación de tipos de apertura (puertas corredizas, acordeón/plegables y abatibles hacia arriba), y un entorno 3D avanzado con modos de render (normal, puertas abiertas, explosión), temas visuales (a color realista vs. negro con aristas naranja y cuadrícula punteada), sombras y widget tridimensional interactivo de orientación.

Working directory: C:\Users\rosibel m\.gemini\antigravity\scratch\madera-local
Integrity mode: development

## Requirements

### R1. Autenticación y Cuentas (Registro / Login / Google Sign-In)
- Página de registro profesional solicitando nombre/datos del usuario, correo electrónico y contraseña.
- Página de login limpia con opción directa de inicio de sesión con Google (Google Sign-In / OAuth).
- Manejo seguro de sesiones locales y persistencia de perfiles en la base de datos SQLite.

### R2. Dashboard Principal (Demos Prediseñados, Proyectos e Importación)
- Vista principal organizada en dos pestañas:
  1. **Galería de Demos**: muebles prediseñados listos para visualizar o editar:
     - Closet modular completo (con repisas, percheros y gavetas).
     - Mesa de noche moderna.
     - Centro de entretenimiento / TV rack.
     - Mueble bajo de cocina modular.
  2. **Mis Proyectos** (pestaña sombreada/activa): listado de proyectos creados por el usuario con opciones de duplicar, renombrar y eliminar.
- Acceso en la esquina superior del menú principal para:
  - Botón **"Nuevo mueble"** desde cero.
  - Botón **"Importar archivo"** compatible (JSON de proyecto exportado).

### R3. Depuración de Controles y Nuevos Tipos de Apertura y Módulos
- Limpiar y remover botones redundantes u obsoletos del panel de control de módulos acumulados en iteraciones previas.
- Ampliar el catálogo de aperturas y frentes:
  - **Puertas corredizas** (sliding doors superpuestas con riel).
  - **Puertas plegables / acordeón** (bi-fold doors).
  - **Puertas abatibles hacia arriba** (lift-up flap doors con pistones/compases).
- Integración en el Cutlist: cálculo de los herrajes específicos (guías corredizas, bisagras especiales, pistones a gas) y desglose de tableros.

### R4. Visor 3D Avanzado (Modos, Temas Visuales, Sombras y Widget)
- Barra de herramientas superior del visor 3D (similar a la barra de iconos de madera.app):
  - **Estados de visualización**:
    1. *Normal*: mueble cerrado sin explosión ni puertas abiertas.
    2. *Puertas abiertas*: animación/posición de apertura en puertas y gavetas.
    3. *Despiece / Explosión*: separación tridimensional de todos los paneles.
  - **Temas de renderizado**:
    1. *Color y textura*: visualización actual a color/materiales.
    2. *Modo Contorno Naranja sobre Negro*: fondo negro carbón, cuadrícula sutil punteada en el suelo, paneles oscuros y aristas delineadas en naranja brillante exactas a la captura de referencia.
- **Iluminación y Sombras**: sombras suaves en tiempo real sobre el plano base y entre componentes.
- **Widget 3D de Orientación**: pequeño gizmo/widget tridimensional interactivo en la esquina inferior derecha que rota solidariamente con la cámara mostrando la orientación de los ejes y vistas.

## Acceptance Criteria

### Autenticación y Google Sign-In (R1)
- [ ] Vistas de Login y Registro diferenciadas, con campos validados (nombre, correo, password).
- [ ] Botón de Google Sign-In funcional (con flujo OAuth o simulación local de proveedor para desarrollo sin credenciales externas).

### Dashboard y Demos (R2)
- [ ] Pantalla principal con pestañas para "Demos prediseñados" y "Mis proyectos".
- [ ] Al seleccionar cualquier demo (closet, mesa de noche, centro de TV, cocina), se abre en el editor con su geometría preconfigurada.
- [ ] Botones de "+ Nuevo proyecto" e "Importar JSON" accesibles en la cabecera.

### Catálogo de Puertas y Limpieza de UI (R3)
- [ ] Panel inferior sin botones duplicados o en desuso.
- [ ] Selector de puertas con opciones: `corredizas`, `acordeón`, `abatible arriba` además de las batientes existentes.
- [ ] Los herrajes de cada nuevo tipo se calculan y listan correctamente en la hoja de cortes.

### Visor 3D, Modos, Sombras y Widget (R4)
- [ ] Iconos/botones en la esquina superior del 3D para alternar entre: mueble cerrado, puertas abiertas y explosión.
- [ ] Botón de tema para alternar entre vista a color y vista negro con líneas naranja neón idéntica a la imagen.
- [ ] Suelo con cuadrícula de puntos y sombras proyectadas.
- [ ] Widget tridimensional en la esquina inferior derecha que gira sincronizado con el ratón.

</USER_REQUEST>

## 2026-10-23T05:16:05Z

<USER_REQUEST>
# Teamwork Project Prompt

Requested team: "un agente para cada una de estas tareas: modelo y layout de columnas con alturas independientes, editor 2D interactivo con (+) por columna y arrastre de bordes superiores, renderizado 3D de mueble escalonado con tapas individuales y cinemática (gavetas en escalera y puertas en bisagras), y despiece tabular en hoja de corte"

Implementar soporte completo para muebles modulares con alturas independientes por columna (muebles escalonados), permitiendo agregar módulos de tamaño predeterminado sobre cada columna sin alterar las columnas vecinas, ajustar alturas arrastrando el borde superior en 2D, renderizar el mueble escalonado en 3D con tapas independientes y cinemática realista, y calcular el despiece exacto en la hoja de corte.

Working directory: `C:\Users\rosibel m\.gemini\antigravity\scratch\madera-local`
Integrity mode: development

## Reference Images
- Target 3D Model: Stepped cabinet with lower drawer column (staircase opening) and taller shelf/door column.
- Current Defect: All columns trapped inside a single global height rectangle with empty cavities.
- Target 2D/3D Architecture: 2D view showing staggered columns with independent heights, (+) button directly above each column, draggable top borders, and corresponding stepped 3D geometry with individual top caps.

## Requirements

### R1. Modelo de Datos y Layout con Alturas Independientes por Columna
- Cada columna del proyecto puede tener su propia altura individual (`column.height`), con fallback opcional a `project.settings.height`.
- Agregar un módulo sobre una columna (botón `(+)` superior) agrega un módulo de tamaño predeterminado (ej. 350mm o 400mm) aumentando **únicamente** la altura de esa columna específica, sin estirar, comprimir ni agregar módulos a las columnas contiguas.
- El cálculo geométrico de `computeLayout` debe calcular las coordenadas y alturas de cada columna de forma independiente a partir de su base común ($y = 0$).

### R2. Editor 2D Interactivo: Columnas Escalonadas y Arrastre de Bordes
- Renderizado SVG 2D fiel a la interfaz de referencia (imagen 3):
  - Cada columna se dibuja con su propia altura y su propia línea de tapa superior.
  - Cada columna dispone de su propio botón `(+)` centrado inmediatamente encima de su borde superior para añadir un módulo en esa columna.
  - Botones `(+)` laterales a la izquierda de la primera columna y a la derecha de la última columna para añadir columnas nuevas.
- Interacción de arrastre (drag-and-drop):
  - Permitir arrastrar la línea/borde superior de cualquier columna en el lienzo 2D para cambiar interactivamente la altura de esa columna sin alterar las demás.
  - Permitir arrastrar los divisores horizontales interiores para cambiar la proporción de los módulos internos dentro de la columna.

### R3. Generación y Renderizado 3D de Muebles Escalonados
- Estructura y carcasas tridimensionales independientes:
  - Cada columna tiene su propia tapa superior (`Tapa superior`) ubicada exactamente a la altura de esa columna.
  - Los laterales divisorios entre columnas de diferente altura se calculan y generan con la altura correspondiente (el lateral intermedio sube hasta la altura de la columna más alta, quedando expuesto en el escalón como en la referencia).
  - Fondo/trasera: se generan fondos acordes a la silueta escalonada del mueble.
- Cinemática y Aperturas:
  - **Gavetas**: Apertura graduada en cascada / escalera de abajo hacia arriba (la gaveta inferior se abre al 75% y las superiores progresivamente hasta el 35%), mostrando el interior de todas sin ocultarse.
  - **Puertas batientes**: El eje de giro debe ubicarse estrictamente en las bisagras exteriores laterales (para puertas dobles, abren hacia afuera alejándose del centro).

### R4. Despiece y Hoja de Corte Tabular para Muebles Escalonados
- Despiece exacto de tableros adaptado a las alturas escalonadas:
  - Laterales exteriores e interiores clasificados con sus alturas reales individuales.
  - Tapas superiores desglosadas por cada columna con sus medidas individuales de ancho y profundidad.
- Consistencia matemática: la suma de paneles y herrajes debe coincidir exactamente con el total de cotización y presentarse en formato tabular listo para imprimir con `Ctrl + P`.

## Acceptance Criteria

### Modelo y Layout Escalonado (R1)
- [ ] Cada columna soporta una altura independiente y `computeLayout` calcula celdas y piezas con la altura de su respectiva columna.
- [ ] Añadir un módulo con el botón `(+)` superior incrementa únicamente la altura de la columna seleccionada en la medida predeterminada, sin afectar las medidas de las demás columnas.

### Interfaz 2D y Arrastre de Altura (R2)
- [ ] En la vista 2D se visualiza la silueta escalonada de las columnas con diferentes alturas.
- [ ] Cada columna muestra su propio botón `(+)` flotando sobre su borde superior.
- [ ] Al arrastrar verticalmente el borde superior de una columna en 2D, se redimensiona en tiempo real la altura de esa columna.
- [ ] El arrastre de divisores internos dentro de una columna funciona manteniendo las cotas de seguridad mínimas (>= 50mm).

### Visor 3D y Cinemática (R3)
- [ ] El modelo 3D refleja fielmente el diseño escalonado con tapas superiores en cada escalón y laterales compartidos correctamente dimensionados.
- [ ] Al activar el modo "Puertas abiertas", las gavetas se abren en escalera de abajo hacia arriba (más abierta la inferior que la superior).
- [ ] Las puertas batientes dobles y simples pivotan en sus bisagras exteriores abriendo hacia los extremos.

### Hoja de Corte (R4)
- [ ] La tabla de corte refleja las piezas reales con dimensiones desiguales correspondientes a las diferentes alturas de columnas.
- [ ] Todos los tests de la suite (`npm test`) pasan al 100% sin regresiones.

</USER_REQUEST>
