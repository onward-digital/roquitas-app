// Formato argentino para montos y fechas.

const NUMERO = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/** 1234.5 → "$ 1.234,50" · -80 → "-$ 80,00" */
export function monto(n) {
  const v = Number(n) || 0;
  return (v < 0 ? '-' : '') + '$ ' + NUMERO.format(Math.abs(v));
}

/**
 * Interpreta lo que escribe la persona: "1.234,56", "1234,56", "1234.56", "4.500", "$ 4500".
 * Devuelve NaN si no es un número.
 */
export function parsearMonto(texto) {
  let t = String(texto ?? '').replace(/[\s$]/g, '');
  if (t === '') return NaN;
  if (t.includes(',')) {
    t = t.replace(/\./g, '').replace(',', '.');      // punto = miles, coma = decimales
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    t = t.replace(/\./g, '');                        // "4.500" son cuatro mil quinientos
  }
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** Número para mostrar dentro de un campo editable: 4500 → "4500", 4500.5 → "4500,50". */
export function paraCampo(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
}

const dos = (n) => String(n).padStart(2, '0');

/** Fecha de hoy según el celular, como "AAAA-MM-DD". */
export function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Mes actual como "AAAA-MM". */
export function mesActual() {
  return hoy().slice(0, 7);
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** "2026-11" → "noviembre 2026" */
export function nombreMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]} ${a}`;
}

/** "2026-11-13" → "Hoy", "Ayer" o "13/11/2026" */
export function fechaCorta(fecha) {
  if (fecha === hoy()) return 'Hoy';
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  const [a, m, d] = fecha.split('-').map(Number);
  if (ayer.getFullYear() === a && ayer.getMonth() + 1 === m && ayer.getDate() === d) return 'Ayer';
  return `${dos(d)}/${dos(m)}/${a}`;
}
