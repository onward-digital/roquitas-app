// Llamadas al Apps Script. Todo va por POST con Content-Type text/plain:
// así el navegador no hace preflight de CORS y el PIN nunca viaja en la URL.

import { API_URL } from './config.js';

export class ErrorApi extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

export function apiConfigurada() {
  return !API_URL.includes('PEGAR_ACA');
}

async function llamar(pin, accion, datos) {
  if (!apiConfigurada()) {
    throw new ErrorApi('SIN_CONFIGURAR', 'Falta pegar la URL de la web app en config.js.');
  }
  let respuesta;
  try {
    respuesta = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ pin, accion, ...datos }),
      redirect: 'follow'
    });
  } catch (err) {
    throw new ErrorApi('SIN_CONEXION', 'No hay conexión.');
  }
  let json;
  try {
    json = await respuesta.json();
  } catch (err) {
    throw new ErrorApi('ERROR_INTERNO', 'La planilla respondió algo inesperado.');
  }
  if (!json || json.ok !== true) {
    throw new ErrorApi((json && json.error) || 'ERROR_INTERNO',
      (json && json.mensaje) || 'Algo salió mal.');
  }
  return json;
}

export const agregar = (pin, movimiento) => llamar(pin, 'agregar', { movimiento });
export const listar = (pin, mes, limite = 200) => llamar(pin, 'listar', { mes, limite });
export const borrar = (pin, id, borradoPor) => llamar(pin, 'borrar', { id, borradoPor });
