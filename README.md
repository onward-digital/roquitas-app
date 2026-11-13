# App Roquitas

App para el celular que anota los ingresos y egresos de Roquitas en la planilla de Google Sheets. Es una PWA (una página web que se instala como app) y la planilla es su única base de datos.

- **La app** (`index.html`, `app.js`, etc.) se publica en GitHub Pages.
- **El backend** (`apps-script/`) es un Google Apps Script que se pega dentro de la planilla.

## Despliegue

### 1. Pegar el script en la planilla

1. Abrí la planilla → **Extensiones → Apps Script**.
2. Borrá lo que haya en `Código.gs` y pegá el contenido de `apps-script/Code.gs`.
3. Creá otro archivo de secuencia de comandos llamado `Setup` y pegá `apps-script/Setup.gs`.
4. En **Configuración del proyecto** (el engranaje) tildá "Mostrar el archivo de manifiesto appsscript.json". Volvé al editor y reemplazá su contenido por `apps-script/appsscript.json`.

### 2. Configurar el PIN

En **Configuración del proyecto → Propiedades del script** agregá una propiedad:

- Propiedad: `PIN`
- Valor: el PIN que van a usar Mili y Diego. Que tenga **6 caracteres o más**.

El PIN vive solo ahí. No lo escribas en ningún archivo.

### 3. Correr `setup()`

1. En el editor elegí la función `setup` y tocá **Ejecutar**. La primera vez Google pide permisos: aceptalos.
2. Mirá el **Registro de ejecución**: lista lo que hizo y avisa si alguna fórmula da error.

Qué hace `setup()`:

| Pestaña | Qué pasa |
|---|---|
| Movimientos | Se crea. Acá escribe la app, una fila por movimiento. |
| Config | Se crea con productos, precios de referencia y costo unitario. |
| VENTAS (respaldo) | Copia de VENTAS tal como estaba. Se crea solo si no existe. |
| VENTAS | La tabla pasa a leer las ventas desde Movimientos. Se van las ventas de ejemplo y la fila TOTALES, la guía pasa a la columna O y se agrega la columna M "Canal de venta". |
| Resumen mensual | Se crea. Una fila por mes, toda calculada. |
| Costos y Precios | No se toca. |

Se puede correr todas las veces que haga falta: no borra movimientos, no pisa Config ni el respaldo.

### 4. Publicar la web app

1. **Implementar → Nueva implementación → Aplicación web**.
2. Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier usuario**.
3. Copiá la **URL de la aplicación web** (termina en `/exec`).

### 5. Conectar la app

Abrí `config.js` y reemplazá `PEGAR_ACA_LA_URL_DE_LA_WEB_APP` por esa URL.

### 6. Subir a GitHub Pages

1. Creá un repositorio en GitHub y subí todos los archivos de esta carpeta.
2. En el repositorio: **Settings → Pages → Branch: `main`, carpeta `/ (root)` → Save**.
3. En un par de minutos la app queda en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

Con una cuenta gratuita el repositorio es público. No hay secretos en el código, pero la URL de la web app queda a la vista: lo único que protege la planilla es el PIN.

### 7. Probar

1. Abrí la app, poné el PIN y cargá una venta y un egreso de prueba.
2. En la planilla revisá que aparezcan en **Movimientos**, que la venta se vea en **VENTAS** y que **Resumen mensual** tenga la fila del mes.
3. Menú **Roquitas → Revisar fórmulas (diagnóstico)** (aparece al recargar la planilla): tiene que decir que ninguna fórmula da error.
4. Borrá a mano las filas de prueba de Movimientos.

Este paso importa: las fórmulas de VENTAS y Resumen mensual recién muestran datos cuando hay un movimiento cargado.

## Instalar en el celular

**Android (Chrome)**

1. Abrí la URL de la app en Chrome.
2. Menú ⋮ → **Agregar a la pantalla principal** (o **Instalar app**).
3. Abrila desde el ícono, poné el PIN y elegí quién carga.

**iPhone (Safari)**

1. Abrí la URL en **Safari** (desde Chrome no se puede instalar).
2. Botón **Compartir** → **Agregar a inicio**.
3. Abrila desde el ícono, poné el PIN y elegí quién carga.

El PIN y el nombre se piden una sola vez por celular. En iPhone se piden de nuevo al instalarla, aunque ya los hayas puesto en Safari.

## Uso diario

- **Sin señal:** el movimiento queda guardado en el celular con la etiqueta "sin enviar" y se manda solo al recuperar conexión. En iPhone se manda cuando abrís la app, no en segundo plano.
- **Corregir un error:** la app solo agrega. Para corregir o borrar, editá la fila en la pestaña Movimientos.
- **Cambiar precios o agregar productos:** editá la pestaña Config. Si agregás un producto, corré `setup()` otra vez para que aparezca en Resumen mensual.
- **Ganancia y caja:** la ganancia es ventas menos costo de lo vendido; la caja es ingresos menos egresos. La materia prima solo resta en la caja.
- **Ahorro acumulado:** 50% de toda la ganancia histórica menos los egresos de categoría "Retiro de ahorro".
- **Costo de cada venta:** se guarda al momento de cargarla (columna N de Movimientos). Si después sube el chocolate, las ventas viejas no cambian.
- **PIN equivocado 5 veces:** la app se bloquea 15 minutos para todos y después se libera sola.

## Mantenimiento

- **Cambiar el PIN:** editá la propiedad `PIN` del script. La app lo va a pedir de nuevo en cada celular.
- **Cambiar el script:** después de editar, **Implementar → Administrar implementaciones → lápiz → Versión: Nueva versión → Implementar**. Así la URL no cambia. Si creás una implementación nueva, cambia la URL y hay que actualizar `config.js`.
- **Cambiar la app:** subí los archivos y aumentá el número de `CACHE` en `sw.js` (`roquitas-v1` → `roquitas-v2`). Los celulares toman la versión nueva la segunda vez que abren la app.
- **No escribir a mano** en la tabla de VENTAS ni en Resumen mensual: son calculadas y un valor suelto bloquea las fórmulas.

## Archivos

| Archivo | Para qué |
|---|---|
| `index.html`, `styles.css` | Pantallas y estilo |
| `app.js` | Lógica de pantallas, formulario e historial |
| `api.js` | Llamadas al Apps Script |
| `cola.js` | Cola de movimientos sin enviar |
| `formato.js` | Montos y fechas en formato argentino |
| `config.js` | URL de la web app |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación y uso sin señal |
| `apps-script/Code.gs` | `doPost`, validación, PIN |
| `apps-script/Setup.gs` | `setup()` y diagnóstico |
