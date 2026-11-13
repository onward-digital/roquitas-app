// Cola local de movimientos pendientes de enviar.
// Todo movimiento pasa primero por acá; se borra recién cuando la planilla lo
// confirma. Como cada uno lleva su ID, reintentar nunca duplica filas.

import { agregar } from './api.js';

const CLAVE = 'roquitas.cola';

function leer() {
  try {
    const lista = JSON.parse(localStorage.getItem(CLAVE) || '[]');
    return Array.isArray(lista) ? lista : [];
  } catch (err) {
    return [];
  }
}

function guardar(lista) {
  localStorage.setItem(CLAVE, JSON.stringify(lista));
}

export function pendientes() {
  return leer();
}

export function encolar(movimiento) {
  const lista = leer();
  lista.push(movimiento);
  guardar(lista);
}

let enviando = null;

/**
 * Manda los pendientes en orden. Se detiene ante el primer problema que no sea
 * del movimiento en sí (sin señal, PIN, error de la planilla) y los deja en la cola.
 * Devuelve { enviados, rechazados: [{movimiento, mensaje}], error }.
 */
export function enviar(pin) {
  if (!enviando) {
    enviando = enviarTodo(pin).finally(() => { enviando = null; });
  }
  return enviando;
}

async function enviarTodo(pin) {
  const resultado = { enviados: 0, rechazados: [], error: null };
  for (const movimiento of leer()) {
    try {
      await agregar(pin, movimiento);
      resultado.enviados++;
    } catch (err) {
      if (err.codigo !== 'DATOS_INVALIDOS') {
        resultado.error = err;
        break;
      }
      // La planilla lo rechazó por sus datos: reintentar no lo va a arreglar.
      resultado.rechazados.push({ movimiento, mensaje: err.message });
    }
    guardar(leer().filter((m) => m.id !== movimiento.id));
  }
  return resultado;
}
