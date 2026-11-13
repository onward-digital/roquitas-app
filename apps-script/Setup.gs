/**
 * Roquitas — preparación de la planilla.
 *
 * setup() se puede correr todas las veces que haga falta:
 *  - nunca borra filas de "Movimientos" ni toca "Costos y Precios";
 *  - no pisa "Config" si ya existe (los precios editados a mano se respetan);
 *  - crea "VENTAS (respaldo)" solo si no existe;
 *  - reescribe únicamente las fórmulas propias de "VENTAS" y "Resumen mensual".
 *
 * Las fórmulas usan ";" como separador y no llevan decimales ni matrices
 * literales, para que funcionen con la configuración regional argentina.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Roquitas')
    .addItem('Preparar planilla (setup)', 'setup')
    .addItem('Revisar fórmulas (diagnóstico)', 'diagnostico')
    .addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const informe = [];

  prepararMovimientos_(ss, informe);
  prepararConfig_(ss, informe);
  prepararVentas_(ss, informe);
  prepararResumen_(ss, informe);

  SpreadsheetApp.flush();
  revisarErrores_(ss, informe);

  const texto = informe.join('\n');
  console.log(texto);
  ss.toast('Listo. El detalle está en el registro de ejecución.', 'Roquitas — setup', 8);
  return texto;
}

/** Revisa que las fórmulas no estén dando error. Se puede correr en cualquier momento. */
function diagnostico() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const informe = [];
  SpreadsheetApp.flush();
  revisarErrores_(ss, informe);
  const texto = informe.join('\n');
  console.log(texto);
  ss.toast(texto.slice(0, 200), 'Roquitas — diagnóstico', 10);
  return texto;
}

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------

function prepararMovimientos_(ss, informe) {
  const n = ENCABEZADOS_MOV.length;
  let hoja = ss.getSheetByName(HOJA_MOV);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_MOV, ss.getNumSheets());
    informe.push('✔ Creé la pestaña "' + HOJA_MOV + '".');
  } else {
    informe.push('• La pestaña "' + HOJA_MOV + '" ya existía: no toqué sus filas.');
  }
  if (hoja.getMaxColumns() < n) {
    hoja.insertColumnsAfter(hoja.getMaxColumns(), n - hoja.getMaxColumns());
  }

  // Encabezados: solo se completan los que faltan.
  const actuales = hoja.getRange(1, 1, 1, n).getValues()[0];
  for (let i = 0; i < n; i++) {
    const actual = String(actuales[i]).trim();
    if (actual === '') {
      hoja.getRange(1, i + 1).setValue(ENCABEZADOS_MOV[i]);
    } else if (actual !== ENCABEZADOS_MOV[i]) {
      informe.push('⚠ "' + HOJA_MOV + '" columna ' + (i + 1) + ': dice "' + actual +
        '" y esperaba "' + ENCABEZADOS_MOV[i] + '". No lo cambié.');
    }
  }

  hoja.getRange(1, 1, 1, n).setFontWeight('bold');
  hoja.setFrozenRows(1);
  // Formatos de columna (no modifican los valores).
  hoja.getRange('B2:B').setNumberFormat(FORMATO_FECHA_HORA);
  hoja.getRange('C2:C').setNumberFormat(FORMATO_FECHA);
  hoja.getRange('I2:I').setNumberFormat('0');
  hoja.getRange('J2:K').setNumberFormat(FORMATO_PESOS);
  hoja.getRange('N2:N').setNumberFormat(FORMATO_PESOS);
}

// ---------------------------------------------------------------------------
// Config (precios de referencia editables)
// ---------------------------------------------------------------------------

function prepararConfig_(ss, informe) {
  if (ss.getSheetByName(HOJA_CONFIG)) {
    informe.push('• La pestaña "' + HOJA_CONFIG + '" ya existía: no la toqué.');
    return;
  }
  const hoja = ss.insertSheet(HOJA_CONFIG, ss.getNumSheets());
  hoja.getRange(1, 1, 1, 4)
    .setValues([['Producto', 'Precio minorista', 'Precio mayorista', 'Costo unitario']])
    .setFontWeight('bold');
  hoja.getRange(2, 1, 2, 3).setValues([
    ['Bolsa 100g', 4500, 4000],
    ['Bolsa 250g', 10000, 8800]
  ]);
  // El costo sale de la fila "TOTAL COSTO DIRECTO UNITARIO" de Costos y Precios
  // (columna C = 100g, columna E = 250g). Se busca por etiqueta, no por celda fija.
  hoja.getRange(2, 4).setFormula(formulaCosto_('C'));
  hoja.getRange(3, 4).setFormula(formulaCosto_('E'));
  hoja.getRange('B2:D').setNumberFormat(FORMATO_PESOS);
  hoja.setFrozenRows(1);
  hoja.setColumnWidth(1, 160);
  hoja.getRange('F1').setValue('Cómo usar esta pestaña').setFontWeight('bold');
  hoja.getRange('F2').setValue('Los precios de las columnas B y C son los que la app precarga al anotar una venta.');
  hoja.getRange('F3').setValue('El costo unitario (D) se guarda en cada venta al momento de cargarla.');
  hoja.getRange('F4').setValue('Si agregás un producto, sumá una fila y volvé a correr setup() para actualizar el Resumen mensual.');
  informe.push('✔ Creé la pestaña "' + HOJA_CONFIG + '" con los precios de referencia.');
}

function formulaCosto_(columna) {
  const hoja = "'" + HOJA_COSTOS + "'!";
  return '=INDEX(' + hoja + columna + ':' + columna + ';MATCH("TOTAL COSTO DIRECTO UNITARIO*";' +
    hoja + 'A:A;0))';
}

// ---------------------------------------------------------------------------
// VENTAS
// ---------------------------------------------------------------------------

const COLS_VENTAS = 13;      // A..L originales + M "Canal de venta"
const COL_GUIA = 15;         // la guía pasa a la columna O

/** Ubica las filas clave de VENTAS por su contenido. Devuelve null si no las encuentra. */
function ubicarVentas_(hoja) {
  const ultima = hoja.getLastRow();
  if (ultima < 1) return null;
  const colA = hoja.getRange(1, 1, ultima, 1).getDisplayValues().map(function (r) { return r[0]; });
  const buscar = function (re) {
    for (let i = 0; i < colA.length; i++) if (re.test(colA[i])) return i + 1;
    return 0;
  };
  const filaEnc = buscar(/^\s*Fecha\s*$/i);
  const filaKpiTitulos = buscar(/UNIDADES VENDIDAS/i);
  if (!filaEnc || !filaKpiTitulos) return null;
  return {
    colA: colA,
    filaEnc: filaEnc,
    filaDatos: filaEnc + 1,
    filaKpiTitulos: filaKpiTitulos,
    filaKpi: filaKpiTitulos + 1,
    filaGuia: buscar(/GU[IÍ]A DE REGISTRO/i)
  };
}

function prepararVentas_(ss, informe) {
  const hoja = ss.getSheetByName(HOJA_VENTAS);
  if (!hoja) {
    informe.push('⚠ No encontré la pestaña "' + HOJA_VENTAS + '". No la reconecté.');
    return;
  }
  const u = ubicarVentas_(hoja);
  if (!u) {
    informe.push('⚠ No reconocí la estructura de "' + HOJA_VENTAS +
      '" (busco "Fecha" y "UNIDADES VENDIDAS" en la columna A). No la toqué.');
    return;
  }

  const yaMigrada = hoja.getRange(u.filaDatos, 1).getFormula() !== '';

  if (!yaMigrada) {
    // 1. Respaldo: solo si no existe. Una segunda corrida nunca lo pisa.
    if (!ss.getSheetByName(HOJA_RESPALDO)) {
      hoja.copyTo(ss).setName(HOJA_RESPALDO);
      informe.push('✔ Guardé una copia de "' + HOJA_VENTAS + '" en "' + HOJA_RESPALDO + '".');
    } else {
      informe.push('• "' + HOJA_RESPALDO + '" ya existía: no lo pisé.');
    }

    if (hoja.getMaxColumns() < COL_GUIA) {
      hoja.insertColumnsAfter(hoja.getMaxColumns(), COL_GUIA - hoja.getMaxColumns());
    }
    const maxFilas = hoja.getMaxRows();

    // 2. La guía se muda al costado para que la tabla pueda crecer hacia abajo.
    if (u.filaGuia) {
      const lineas = u.colA.slice(u.filaGuia - 1)
        .filter(function (t) { return String(t).trim() !== ''; })
        .map(function (t) {
          return /^\s*4\./.test(t)
            ? '4. Nuevas ventas: se cargan desde la app Roquitas y quedan en la pestaña "Movimientos". En esta tabla no se escribe a mano.'
            : t;
        });
      const destino = hoja.getRange(u.filaKpiTitulos, COL_GUIA, lineas.length, 1);
      destino.setValues(lineas.map(function (t) { return [t]; }));
      destino.setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW);
      hoja.getRange(u.filaKpiTitulos, COL_GUIA).setFontWeight('bold');
    }

    // 3. Se vacía la zona de la tabla (ventas de ejemplo, TOTALES y guía vieja).
    const zona = hoja.getRange(u.filaDatos, 1, maxFilas - u.filaDatos + 1, COLS_VENTAS);
    zona.breakApart();
    zona.clearContent();
    zona.clearDataValidations();

    // 4. Todas las filas de la tabla toman el formato de la primera fila de datos.
    if (maxFilas > u.filaDatos) {
      hoja.getRange(u.filaDatos, 1, 1, 12)
        .copyFormatToRange(hoja, 1, 12, u.filaDatos + 1, maxFilas);
    }
    // Columna M nueva: mismo aspecto que la columna de texto "Método de Pago" (D).
    hoja.getRange(u.filaEnc, 12).copyFormatToRange(hoja, 13, 13, u.filaEnc, u.filaEnc);
    hoja.getRange(u.filaDatos, 4).copyFormatToRange(hoja, 13, 13, u.filaDatos, maxFilas);
    hoja.setColumnWidth(13, hoja.getColumnWidth(4));

    // 5. Los títulos combinados A:L se estiran hasta M (solo estética).
    try {
      hoja.getRange(1, 1, u.filaEnc - 1, 12).getMergedRanges().forEach(function (mr) {
        if (mr.getColumn() === 1 && mr.getLastColumn() === 12) {
          const fila = mr.getRow(), alto = mr.getNumRows();
          mr.breakApart();
          hoja.getRange(fila, 1, alto, COLS_VENTAS).merge();
        }
      });
    } catch (err) {
      informe.push('• No pude estirar los títulos de "' + HOJA_VENTAS + '" hasta la columna M (es solo estética).');
    }
    informe.push('✔ Reconecté "' + HOJA_VENTAS + '": ahora lee las ventas desde "' + HOJA_MOV + '".');
  } else {
    informe.push('• "' + HOJA_VENTAS + '" ya estaba reconectada: solo actualicé sus fórmulas.');
  }

  // Lo que sigue es idempotente: encabezado de M, fórmula de la tabla y KPIs.
  hoja.getRange(u.filaEnc, 13).setValue('Canal de venta');
  hoja.getRange(u.filaDatos, 1).setFormula(formulaVentas_());

  const titulos = hoja.getRange(u.filaKpiTitulos, 1, 1, 12).getDisplayValues()[0];
  const kpis = [
    [/UNIDADES/i, 'E'],          // Cantidad
    [/FACTURACI/i, 'G'],         // Ingreso Total
    [/CMV/i, 'I'],               // Costo Total
    [/GANANCIA/i, 'J'],          // Ganancia Neta
    [/REINVERSI/i, 'K'],         // Reinversión 50%
    [/AHORRO/i, 'L']             // Ahorro 50%
  ];
  kpis.forEach(function (k) {
    let col = 0;
    for (let i = 0; i < titulos.length; i++) if (k[0].test(titulos[i])) { col = i + 1; break; }
    if (!col) {
      informe.push('⚠ No encontré el KPI ' + k[0] + ' en "' + HOJA_VENTAS + '".');
      return;
    }
    hoja.getRange(u.filaKpi, col).setFormula('=SUM(' + k[1] + u.filaDatos + ':' + k[1] + ')');
  });
}

/**
 * Una sola fórmula para toda la tabla de VENTAS. Columnas que devuelve:
 * Fecha, Canal/Cliente, Producto, Método de Pago, Cantidad, Precio Unitario,
 * Ingreso Total, Costo Unitario, Costo Total, Ganancia Neta, Reinversión 50%,
 * Ahorro 50%, Canal de venta (Minorista/Mayorista, sale de la categoría).
 */
function formulaVentas_() {
  const M = HOJA_MOV + '!';
  return '=IFNA(LET(' +
    'filas;FILTER(' + M + 'A2:N;' + M + 'D2:D="Ingreso";LEFT(' + M + 'E2:E;5)="Venta");' +
    'orden;SORT(filas;3;TRUE;2;TRUE);' +
    'cant;CHOOSECOLS(orden;9);' +
    'ingreso;CHOOSECOLS(orden;11);' +
    'costou;CHOOSECOLS(orden;14);' +
    'costot;ARRAYFORMULA(cant*costou);' +
    'ganancia;ARRAYFORMULA(ingreso-costot);' +
    'HSTACK(CHOOSECOLS(orden;3;7;8;12;9;10;11;14);costot;ganancia;' +
    'ARRAYFORMULA(ganancia/2);ARRAYFORMULA(ganancia/2);' +
    'ARRAYFORMULA(IF(CHOOSECOLS(orden;5)="' + CAT_MAYORISTA + '";"Mayorista";"Minorista")))' +
    ');"")';
}

// ---------------------------------------------------------------------------
// Resumen mensual
// ---------------------------------------------------------------------------

/**
 * Pestaña 100% calculada (no escribir a mano en ella): una fila por mes y una
 * fórmula por columna en la fila 2.
 *  - "Ganancia" = ventas − costo de lo vendido.
 *  - "Caja"     = ingresos − egresos.
 * La materia prima solo resta en la caja, nunca dos veces.
 */
function prepararResumen_(ss, informe) {
  const productos = leerConfig_(ss);
  const M = HOJA_MOV + '!';
  const rango = function (col) { return M + col + '2:' + col; };
  const es = function (col, valor) { return rango(col) + ';"' + String(valor).replace(/"/g, '""') + '"'; };
  const enMes = rango('C') + ';">="&m;' + rango('C') + ';"<"&EDATE(m;1)';
  const hastaMes = rango('C') + ';"<"&EDATE(m;1)';
  const sumar = function (col, condiciones) {
    return 'SUMIFS(' + rango(col) + ';' + condiciones.join(';') + ')';
  };
  const porMes = function (expr) { return '=MAP(A2:A;LAMBDA(m;IF(m="";;' + expr + ')))'; };
  const fila = function (expr) { return '=ARRAYFORMULA(IF(A2:A="";;' + expr + '))'; };
  const venta = [es('D', 'Ingreso'), es('E', 'Venta*')];
  const costoVendido = function (limite) {
    return 'SUMPRODUCT((' + rango('D') + '="Ingreso")*(LEFT(' + rango('E') + ';5)="Venta")*' +
      limite + '*' + rango('I') + '*' + rango('N') + ')';
  };
  const delMes = '(' + rango('C') + '>=m)*(' + rango('C') + '<EDATE(m;1))';
  const hasta = '(' + rango('C') + '<EDATE(m;1))';

  const PESOS = FORMATO_PESOS, UNID = '0';
  const cols = [
    { t: 'Mes', fmt: 'mmmm yyyy',
      f: '=IFNA(SORT(UNIQUE(FILTER(ARRAYFORMULA(EOMONTH(' + rango('C') + ';-1)+1);' +
         rango('C') + '<>""));1;FALSE);"")' },
    { t: 'Ventas', fmt: PESOS, f: porMes(sumar('K', venta.concat(enMes))) },                    // B
    { t: 'Costo de lo vendido', fmt: PESOS, f: porMes(costoVendido(delMes)) },                  // C
    { t: 'Ganancia', fmt: PESOS, f: fila('B2:B-C2:C') },                                        // D
    { t: 'Reinversión 50%', fmt: PESOS, f: fila('D2:D/2') },                                    // E
    { t: 'Ahorro 50%', fmt: PESOS, f: fila('D2:D/2') },                                         // F
    { t: 'Otros ingresos', fmt: PESOS,
      f: porMes(sumar('K', [es('D', 'Ingreso'), es('E', 'Otro ingreso'), enMes])) },            // G
    { t: 'Total egresos', fmt: PESOS, f: porMes(sumar('K', [es('D', 'Egreso'), enMes])) },      // H
    { t: 'Caja del mes', fmt: PESOS, f: fila('B2:B+G2:G-H2:H') },                               // I
    { t: 'Caja acumulada', fmt: PESOS,
      f: porMes(sumar('K', [es('D', 'Ingreso'), hastaMes]) + '-' +
                sumar('K', [es('D', 'Egreso'), hastaMes])) },                                   // J
    { t: 'Retiros de ahorro', fmt: PESOS,
      f: porMes(sumar('K', [es('D', 'Egreso'), es('E', CAT_RETIRO), enMes])) },                 // K
    { t: 'Ahorro disponible (acumulado)', fmt: PESOS,
      f: porMes('(' + sumar('K', venta.concat(hastaMes)) + '-' + costoVendido(hasta) + ')/2-' +
                sumar('K', [es('D', 'Egreso'), es('E', CAT_RETIRO), hastaMes])) },              // L
    { t: 'Ventas minoristas', fmt: PESOS,
      f: porMes(sumar('K', [es('D', 'Ingreso'), es('E', 'Venta minorista'), enMes])) },
    { t: 'Unidades minoristas', fmt: UNID,
      f: porMes(sumar('I', [es('D', 'Ingreso'), es('E', 'Venta minorista'), enMes])) },
    { t: 'Ventas mayoristas', fmt: PESOS,
      f: porMes(sumar('K', [es('D', 'Ingreso'), es('E', CAT_MAYORISTA), enMes])) },
    { t: 'Unidades mayoristas', fmt: UNID,
      f: porMes(sumar('I', [es('D', 'Ingreso'), es('E', CAT_MAYORISTA), enMes])) }
  ];

  // Por producto y por canal.
  productos.forEach(function (p) {
    [['minorista', 'Venta minorista'], ['mayorista', CAT_MAYORISTA]].forEach(function (c) {
      const cond = [es('D', 'Ingreso'), es('E', c[1]), es('H', p.nombre), enMes];
      cols.push({ t: p.nombre + ' · ventas ' + c[0], fmt: PESOS, f: porMes(sumar('K', cond)) });
      cols.push({ t: p.nombre + ' · unidades ' + c[0], fmt: UNID, f: porMes(sumar('I', cond)) });
    });
  });

  cols.push({
    t: 'Días con más movimientos', fmt: '@',
    f: porMes('IFERROR(LET(' +
      'dias;FILTER(' + rango('C') + ';' + rango('C') + '>=m;' + rango('C') + '<EDATE(m;1));' +
      'unicos;UNIQUE(dias);' +
      'cuenta;MAP(unicos;LAMBDA(x;COUNTIF(' + rango('C') + ';x)));' +
      'top;SORTN(HSTACK(unicos;cuenta);3;0;2;FALSE;1;TRUE);' +
      'TEXTJOIN(" · ";TRUE;ARRAYFORMULA(TEXT(CHOOSECOLS(top;1);"d/m")&" ("&CHOOSECOLS(top;2)&")"))' +
      ');"")')
  });

  let hoja = ss.getSheetByName(HOJA_RESUMEN);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_RESUMEN, ss.getNumSheets());
    informe.push('✔ Creé la pestaña "' + HOJA_RESUMEN + '".');
  } else {
    informe.push('• "' + HOJA_RESUMEN + '" ya existía: actualicé sus fórmulas.');
  }
  if (hoja.getMaxColumns() < cols.length) {
    hoja.insertColumnsAfter(hoja.getMaxColumns(), cols.length - hoja.getMaxColumns());
  }
  // Es una pestaña calculada: se regenera entera para que nada bloquee las fórmulas.
  hoja.clearContents();

  hoja.getRange(1, 1, 1, cols.length)
    .setValues([cols.map(function (c) { return c.t; })])
    .setFontWeight('bold')
    .setWrap(true)
    .setVerticalAlignment('middle');
  cols.forEach(function (c, i) {
    hoja.getRange(2, i + 1).setFormula(c.f);
    hoja.getRange(2, i + 1, hoja.getMaxRows() - 1, 1).setNumberFormat(c.fmt);
  });
  hoja.setFrozenRows(1);
  hoja.setFrozenColumns(1);
  hoja.setColumnWidth(cols.length, 260);
}

// ---------------------------------------------------------------------------
// Diagnóstico
// ---------------------------------------------------------------------------

function revisarErrores_(ss, informe) {
  const errores = [];
  const revisar = function (hoja, fila, col, filas, columnas) {
    if (!hoja || filas < 1 || columnas < 1) return;
    const valores = hoja.getRange(fila, col, filas, columnas).getDisplayValues();
    for (let i = 0; i < valores.length; i++) {
      for (let j = 0; j < valores[i].length; j++) {
        if (String(valores[i][j]).charAt(0) === '#') {
          errores.push('"' + hoja.getName() + '" ' +
            hoja.getRange(fila + i, col + j).getA1Notation() + ': ' + valores[i][j]);
        }
      }
    }
  };

  const config = ss.getSheetByName(HOJA_CONFIG);
  if (config && config.getLastRow() >= 2) revisar(config, 2, 1, config.getLastRow() - 1, 4);

  const ventas = ss.getSheetByName(HOJA_VENTAS);
  const u = ventas ? ubicarVentas_(ventas) : null;
  if (u) {
    revisar(ventas, u.filaKpi, 1, 1, 12);
    revisar(ventas, u.filaDatos, 1, 1, COLS_VENTAS);
  }

  const resumen = ss.getSheetByName(HOJA_RESUMEN);
  if (resumen) revisar(resumen, 2, 1, 1, resumen.getLastColumn() || 1);

  if (errores.length) {
    informe.push('⚠ Hay fórmulas con error:');
    errores.forEach(function (e) { informe.push('   ' + e); });
  } else {
    informe.push('✔ Ninguna fórmula está dando error.');
  }
}
