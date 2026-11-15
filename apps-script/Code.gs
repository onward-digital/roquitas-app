/**
 * Roquitas — backend de la app (Google Apps Script vinculado a la planilla).
 *
 * doPost recibe JSON como text/plain (evita el preflight de CORS):
 *   { pin, accion: "agregar", movimiento: {...} }
 *   { pin, accion: "listar", mes: "2026-11", limite: 100 }
 *   { pin, accion: "borrar", id, borradoPor }
 * doGet es solo un chequeo de vida: el PIN nunca viaja en la URL.
 *
 * El PIN vive en Propiedades del script (clave PIN), nunca en el código.
 */

const VERSION = '1.0.0';

const HOJA_MOV = 'Movimientos';
const HOJA_CONFIG = 'Config';
const HOJA_COSTOS = 'Costos y Precios';
const HOJA_VENTAS = 'VENTAS';
const HOJA_RESPALDO = 'VENTAS (respaldo)';
const HOJA_RESUMEN = 'Resumen mensual';
const HOJA_ELIMINADOS = 'Eliminados';

// Columnas de "Movimientos" (A..N). El orden es parte del contrato con las fórmulas.
const ENCABEZADOS_MOV = [
  'ID', 'Cargado el', 'Fecha', 'Tipo', 'Categoría', 'Detalle', 'Cliente/Canal',
  'Producto', 'Cantidad', 'Precio Unitario', 'Monto', 'Medio de Pago',
  'Cargado por', 'Costo Unitario'
];

const CATEGORIAS = {
  Ingreso: ['Venta minorista', 'Venta mayorista', 'Otro ingreso'],
  Egreso: ['Materia prima', 'Packaging', 'Gasto', 'Retiro de ahorro', 'Otro egreso']
};
const CAT_MAYORISTA = 'Venta mayorista';
const CAT_RETIRO = 'Retiro de ahorro';
const MEDIOS = ['Efectivo', 'Virtual'];
const PERSONAS = ['Mili', 'Diego'];

const FORMATO_FECHA = 'dd/mm/yyyy';
const FORMATO_FECHA_HORA = 'dd/mm/yyyy hh:mm';
const FORMATO_PESOS = '"$"#,##0.00';

// Bloqueo temporal por PIN incorrecto.
const MAX_FALLOS = 5;
const BLOQUEO_SEG = 15 * 60;

function doGet() {
  return responder_({ ok: true, version: VERSION });
}

function doPost(e) {
  let pedido;
  try {
    pedido = JSON.parse(e.postData.contents);
  } catch (err) {
    return responder_(error_('DATOS_INVALIDOS', 'El pedido no es un JSON válido.'));
  }
  try {
    if (!pedido || typeof pedido !== 'object') {
      return responder_(error_('DATOS_INVALIDOS', 'El pedido está vacío.'));
    }
    const errorPin = chequearPin_(pedido.pin);
    if (errorPin) return responder_(errorPin);

    if (pedido.accion === 'agregar') return responder_(agregar_(pedido.movimiento));
    if (pedido.accion === 'listar') return responder_(listar_(pedido));
    if (pedido.accion === 'borrar') return responder_(borrar_(pedido));
    return responder_(error_('DATOS_INVALIDOS', 'Acción desconocida.'));
  } catch (err) {
    console.error(err);
    return responder_(error_('ERROR_INTERNO', String((err && err.message) || err)));
  }
}

// ---------------------------------------------------------------------------
// PIN
// ---------------------------------------------------------------------------

/**
 * Devuelve null si el PIN es correcto, o un objeto de error.
 * Tras MAX_FALLOS intentos fallidos bloquea a todos por BLOQUEO_SEG (el caché
 * vence solo, así que el bloqueo es temporal). Mientras dura, ni el PIN correcto
 * pasa: si pasara, el bloqueo no frenaría a quien está probando PINs.
 */
function chequearPin_(pin) {
  const cache = CacheService.getScriptCache();
  if (cache.get('pin_bloqueado')) {
    return error_('DEMASIADOS_INTENTOS',
      'Hubo demasiados intentos con un PIN incorrecto. Probá de nuevo en 15 minutos.');
  }
  const pinReal = PropertiesService.getScriptProperties().getProperty('PIN');
  if (!pinReal) {
    return error_('ERROR_INTERNO', 'Falta configurar el PIN en las Propiedades del script.');
  }
  if (typeof pin === 'string' && pin === pinReal) return null;

  const fallos = Number(cache.get('pin_fallos') || 0) + 1;
  if (fallos >= MAX_FALLOS) {
    cache.put('pin_bloqueado', '1', BLOQUEO_SEG);
    cache.remove('pin_fallos');
    return error_('DEMASIADOS_INTENTOS',
      'Hubo demasiados intentos con un PIN incorrecto. Probá de nuevo en 15 minutos.');
  }
  cache.put('pin_fallos', String(fallos), BLOQUEO_SEG);
  return error_('PIN_INCORRECTO', 'El PIN no es correcto.');
}

// ---------------------------------------------------------------------------
// agregar
// ---------------------------------------------------------------------------

function agregar_(m) {
  if (!m || typeof m !== 'object') return invalido_('Falta el movimiento.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();

  const id = texto_(m.id, 64);
  if (!id) return invalido_('Falta el ID del movimiento.');

  if (typeof m.fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.fecha)) {
    return invalido_('La fecha tiene que ser AAAA-MM-DD.');
  }
  // Medianoche en la zona horaria de la planilla: queda como fecha pura (Date real).
  const fecha = Utilities.parseDate(m.fecha, tz, 'yyyy-MM-dd');
  if (Utilities.formatDate(fecha, tz, 'yyyy-MM-dd') !== m.fecha) {
    return invalido_('La fecha no existe.');
  }

  const tipo = m.tipo;
  if (!CATEGORIAS[tipo]) return invalido_('El tipo tiene que ser Ingreso o Egreso.');
  const categoria = m.categoria;
  if (CATEGORIAS[tipo].indexOf(categoria) === -1) {
    return invalido_('La categoría no corresponde a un ' + tipo.toLowerCase() + '.');
  }
  const cargadoPor = texto_(m.cargadoPor, 30);
  if (PERSONAS.indexOf(cargadoPor) === -1) return invalido_('Falta quién carga (Mili o Diego).');

  const detalle = texto_(m.detalle, 300);
  const esVenta = esVenta_(tipo, categoria);

  let cliente = '', producto = '', cantidad = '', precio = '', costo = '', medio = '';
  let monto;

  if (esVenta) {
    const productos = leerConfig_(ss);
    const p = productos.filter(function (x) { return x.nombre === m.producto; })[0];
    if (!p) return invalido_('El producto no existe en la pestaña Config.');
    producto = p.nombre;

    cantidad = Number(m.cantidad);
    if (!(cantidad > 0) || Math.floor(cantidad) !== cantidad || cantidad > 100000) {
      return invalido_('La cantidad tiene que ser un número entero mayor a cero.');
    }
    precio = Number(m.precioUnitario);
    if (!(precio > 0) || precio > 1e9) return invalido_('El precio unitario tiene que ser mayor a cero.');
    if (MEDIOS.indexOf(m.medioPago) === -1) return invalido_('Falta el medio de pago.');
    medio = m.medioPago;
    cliente = texto_(m.cliente, 120);

    // El monto de una venta lo calcula el servidor.
    monto = redondear_(cantidad * precio);

    // Costo congelado al momento de la venta.
    if (!(p.costo > 0)) {
      return error_('ERROR_INTERNO',
        'No pude leer el costo unitario de "' + producto + '" en la pestaña Config.');
    }
    costo = p.costo;
  } else {
    monto = redondear_(Number(m.monto));
    if (!(monto > 0) || monto > 1e12) return invalido_('El monto tiene que ser mayor a cero.');
    if (m.medioPago) {
      if (MEDIOS.indexOf(m.medioPago) === -1) return invalido_('El medio de pago no es válido.');
      medio = m.medioPago;
    }
  }

  const fila = [id, new Date(), fecha, tipo, categoria, detalle, cliente, producto,
    cantidad, precio, monto, medio, cargadoPor, costo];

  // El chequeo de duplicado y el alta van juntos bajo el mismo candado: si dos
  // pedidos con el mismo ID llegan a la vez, solo uno escribe.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const hoja = hojaMov_(ss);
    if (buscarFila_(hoja, id)) return { ok: true, id: id, duplicado: true };
    // Si ya fue eliminado, un reintento tardío de la cola de un celular no lo revive.
    const eliminados = ss.getSheetByName(HOJA_ELIMINADOS);
    if (eliminados && buscarFila_(eliminados, id)) return { ok: true, id: id, duplicado: true };
    hoja.appendRow(fila);
    const f = hoja.getLastRow();
    hoja.getRange(f, 2).setNumberFormat(FORMATO_FECHA_HORA);
    hoja.getRange(f, 3).setNumberFormat(FORMATO_FECHA);
    hoja.getRange(f, 10, 1, 2).setNumberFormat(FORMATO_PESOS);
    hoja.getRange(f, 14).setNumberFormat(FORMATO_PESOS);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, id: id, duplicado: false };
}

// ---------------------------------------------------------------------------
// borrar
// ---------------------------------------------------------------------------

/**
 * Saca un movimiento de "Movimientos". No lo destruye: primero copia la fila a
 * "Eliminados" (con cuándo y quién) y recién después la borra.
 * Si el ID no está, responde ok con yaBorrado: true, así un reintento no da error.
 * "Eliminados" no entra en ningún cálculo ni en listar.
 */
function borrar_(pedido) {
  const id = texto_(pedido.id, 64);
  if (!id) return invalido_('Falta el ID del movimiento.');
  const borradoPor = texto_(pedido.borradoPor, 30);
  if (PERSONAS.indexOf(borradoPor) === -1) return invalido_('Falta quién elimina (Mili o Diego).');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const hoja = hojaMov_(ss);
    const fila = buscarFila_(hoja, id);
    if (!fila) return { ok: true, id: id, yaBorrado: true };

    const n = ENCABEZADOS_MOV.length;
    const valores = hoja.getRange(fila, 1, 1, n).getValues()[0].map(function (v) {
      // Un texto editado a mano que empiece con "=" no tiene que volverse fórmula.
      return typeof v === 'string' ? v.replace(/^[=+]+\s*/, '') : v;
    });

    const eliminados = hojaEliminados_(ss);
    eliminados.appendRow(valores.concat([new Date(), borradoPor]));
    const f = eliminados.getLastRow();
    eliminados.getRange(f, 2).setNumberFormat(FORMATO_FECHA_HORA);
    eliminados.getRange(f, 3).setNumberFormat(FORMATO_FECHA);
    eliminados.getRange(f, 10, 1, 2).setNumberFormat(FORMATO_PESOS);
    eliminados.getRange(f, 14).setNumberFormat(FORMATO_PESOS);
    eliminados.getRange(f, n + 1).setNumberFormat(FORMATO_FECHA_HORA);

    // Sheets no deja borrar la única fila que queda debajo de los encabezados.
    if (hoja.getMaxRows() - hoja.getFrozenRows() <= 1) hoja.insertRowAfter(hoja.getMaxRows());
    hoja.deleteRow(fila);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, id: id, yaBorrado: false };
}

/** Devuelve la pestaña "Eliminados"; la crea con sus encabezados si no existe. */
function hojaEliminados_(ss) {
  let hoja = ss.getSheetByName(HOJA_ELIMINADOS);
  if (hoja) return hoja;
  const encabezados = ENCABEZADOS_MOV.concat(['Eliminado el', 'Eliminado por']);
  hoja = ss.insertSheet(HOJA_ELIMINADOS, ss.getNumSheets());
  hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]).setFontWeight('bold');
  hoja.setFrozenRows(1);
  return hoja;
}

/** Número de fila (desde 2) donde está el ID en la columna A, o 0 si no está. */
function buscarFila_(hoja, id) {
  const ultima = hoja.getLastRow();
  if (ultima < 2) return 0;
  const ids = hoja.getRange(2, 1, ultima - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === id) return i + 2;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// listar
// ---------------------------------------------------------------------------

function listar_(pedido) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();

  const mes = (typeof pedido.mes === 'string' && /^\d{4}-\d{2}$/.test(pedido.mes))
    ? pedido.mes
    : Utilities.formatDate(new Date(), tz, 'yyyy-MM');
  const limite = Math.min(Math.max(parseInt(pedido.limite, 10) || 100, 1), 500);

  const hoja = hojaMov_(ss);
  const ultima = hoja.getLastRow();
  const filas = ultima >= 2
    ? hoja.getRange(2, 1, ultima - 1, ENCABEZADOS_MOV.length).getValues()
    : [];

  let ventas = 0, costoMes = 0, otrosIngresos = 0, egresos = 0;
  let cajaAcumulada = 0, gananciaHistorica = 0, retirosAhorro = 0;
  const movimientos = [];

  filas.forEach(function (r) {
    if (!r[0] || !esFecha_(r[2])) return; // fila vacía o tocada a mano sin fecha válida

    const fecha = Utilities.formatDate(r[2], tz, 'yyyy-MM-dd');
    const tipo = String(r[3]);
    const categoria = String(r[4]);
    const monto = Number(r[10]) || 0;
    const delMes = fecha.slice(0, 7) === mes;
    const venta = esVenta_(tipo, categoria);

    if (tipo === 'Ingreso') {
      cajaAcumulada += monto;
      if (venta) {
        const costo = (Number(r[8]) || 0) * (Number(r[13]) || 0);
        gananciaHistorica += monto - costo;
        if (delMes) { ventas += monto; costoMes += costo; }
      } else if (delMes) {
        otrosIngresos += monto;
      }
    } else if (tipo === 'Egreso') {
      cajaAcumulada -= monto;
      if (categoria === CAT_RETIRO) retirosAhorro += monto;
      if (delMes) egresos += monto;
    }

    movimientos.push({
      id: String(r[0]),
      cargadoEl: esFecha_(r[1]) ? Utilities.formatDate(r[1], tz, "yyyy-MM-dd'T'HH:mm:ssXXX") : '',
      fecha: fecha,
      tipo: tipo,
      categoria: categoria,
      detalle: String(r[5]),
      cliente: String(r[6]),
      producto: String(r[7]),
      cantidad: r[8] === '' ? null : Number(r[8]),
      precioUnitario: r[9] === '' ? null : Number(r[9]),
      monto: monto,
      medioPago: String(r[11]),
      cargadoPor: String(r[12]),
      orden: movimientos.length
    });
  });

  movimientos.sort(function (a, b) {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1;
    if (a.cargadoEl !== b.cargadoEl) return a.cargadoEl < b.cargadoEl ? 1 : -1;
    return b.orden - a.orden; // mismo segundo: primero el que está más abajo en la planilla
  });
  movimientos.forEach(function (m) { delete m.orden; });

  const ganancia = ventas - costoMes;
  return {
    ok: true,
    version: VERSION,
    mes: mes,
    totales: {
      // Del mes pedido
      ventas: redondear_(ventas),
      costo: redondear_(costoMes),
      ganancia: redondear_(ganancia),               // ventas − costo de lo vendido
      reinversion: redondear_(ganancia / 2),
      ahorroMes: redondear_(ganancia / 2),
      otrosIngresos: redondear_(otrosIngresos),
      egresos: redondear_(egresos),
      cajaMes: redondear_(ventas + otrosIngresos - egresos), // ingresos − egresos
      // Históricos
      cajaAcumulada: redondear_(cajaAcumulada),
      retirosAhorro: redondear_(retirosAhorro),
      // 50% de la ganancia histórica menos los retiros de ahorro
      ahorroAcumulado: redondear_(gananciaHistorica / 2 - retirosAhorro)
    },
    movimientos: movimientos.slice(0, limite),
    config: {
      productos: leerConfig_(ss).map(function (p) {
        return { nombre: p.nombre, minorista: p.minorista, mayorista: p.mayorista };
      }),
      categorias: CATEGORIAS,
      medios: MEDIOS
    }
  };
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Lee productos, precios de referencia y costo unitario de la pestaña Config. */
function leerConfig_(ss) {
  const hoja = ss.getSheetByName(HOJA_CONFIG);
  if (!hoja) throw new Error('Falta la pestaña "' + HOJA_CONFIG + '". Hay que correr setup().');
  const ultima = hoja.getLastRow();
  if (ultima < 2) return [];
  return hoja.getRange(2, 1, ultima - 1, 4).getValues()
    .filter(function (r) { return String(r[0]).trim() !== ''; })
    .map(function (r) {
      return {
        nombre: String(r[0]).trim(),
        minorista: Number(r[1]) || 0,
        mayorista: Number(r[2]) || 0,
        costo: Number(r[3]) || 0
      };
    });
}

function hojaMov_(ss) {
  const hoja = ss.getSheetByName(HOJA_MOV);
  if (!hoja) throw new Error('Falta la pestaña "' + HOJA_MOV + '". Hay que correr setup().');
  return hoja;
}

function esVenta_(tipo, categoria) {
  return tipo === 'Ingreso' && String(categoria).indexOf('Venta') === 0;
}

function esFecha_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

/** Texto recortado; sin "=" ni "+" al inicio para que la planilla no lo tome como fórmula. */
function texto_(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\r\n\t]+/g, ' ').trim().replace(/^[=+]+\s*/, '').slice(0, max);
}

function redondear_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function error_(codigo, mensaje) {
  return { ok: false, error: codigo, mensaje: mensaje };
}

function invalido_(mensaje) {
  return error_('DATOS_INVALIDOS', mensaje);
}

function responder_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
