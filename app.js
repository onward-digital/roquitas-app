// Roquitas — pantallas, formulario e historial.
// La planilla es la única base de datos. En el celular solo se guardan el PIN,
// el nombre, los precios de referencia (para poder anotar sin señal) y la cola
// de movimientos pendientes de enviar.

import * as api from './api.js';
import * as cola from './cola.js';
import { monto, parsearMonto, paraCampo, hoy, mesActual, nombreMes, fechaCorta } from './formato.js';

const $ = (id) => document.getElementById(id);

const LS = { pin: 'roquitas.pin', nombre: 'roquitas.nombre', config: 'roquitas.config' };
const PERSONAS = ['Mili', 'Diego'];
const FILTROS = ['Todo', 'Ingresos', 'Egresos'];

// Se usa solo hasta que la planilla manda la configuración real (pestaña Config).
const CONFIG_BASE = {
  productos: [
    { nombre: 'Bolsa 100g', minorista: 4500, mayorista: 4000 },
    { nombre: 'Bolsa 250g', minorista: 10000, mayorista: 8800 }
  ],
  categorias: {
    Ingreso: ['Venta minorista', 'Venta mayorista', 'Otro ingreso'],
    Egreso: ['Materia prima', 'Packaging', 'Gasto', 'Retiro de ahorro', 'Otro egreso']
  },
  medios: ['Efectivo', 'Virtual']
};

const estado = {
  pin: localStorage.getItem(LS.pin) || '',
  nombre: localStorage.getItem(LS.nombre) || '',
  config: leerConfigGuardada(),
  datos: null,
  filtro: 'Todo',
  busqueda: '',
  cargando: false,
  repetir: false,
  sinConexion: false
};

function leerConfigGuardada() {
  try {
    const c = JSON.parse(localStorage.getItem(LS.config) || 'null');
    if (c && Array.isArray(c.productos) && c.productos.length && c.categorias && c.medios) return c;
  } catch (err) { /* se usa la base */ }
  return CONFIG_BASE;
}

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------

function mostrar(vista) {
  document.querySelectorAll('.vista').forEach((v) => { v.hidden = v.id !== 'vista-' + vista; });
  window.scrollTo(0, 0);
}

/** Botones donde uno solo queda elegido. */
function grupo(contenedor, opciones, elegido, alElegir) {
  contenedor.replaceChildren(...opciones.map((op) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'boton';
    b.textContent = op;
    b.dataset.valor = op;
    b.setAttribute('aria-pressed', String(op === elegido));
    b.addEventListener('click', () => alElegir(op));
    return b;
  }));
}

let relojAviso = 0;
function aviso(texto, malo = false) {
  const caja = $('aviso');
  caja.textContent = texto;
  caja.classList.toggle('malo', malo);
  caja.hidden = false;
  clearTimeout(relojAviso);
  relojAviso = setTimeout(() => { caja.hidden = true; }, malo ? 6000 : 3500);
}

function nuevoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const esVenta = (tipo, categoria) => tipo === 'Ingreso' && categoria.startsWith('Venta');

// ---------------------------------------------------------------------------
// Primera vez: PIN y nombre
// ---------------------------------------------------------------------------

let nombreElegido = '';

function pintarIngreso() {
  grupo($('ingreso-nombre'), PERSONAS, nombreElegido, (n) => { nombreElegido = n; pintarIngreso(); });
}

$('form-ingreso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('ingreso-error');
  const boton = $('ingreso-boton');
  const pin = $('ingreso-pin').value.trim();
  error.textContent = '';
  if (!pin) { error.textContent = 'Falta el PIN.'; return; }
  if (!nombreElegido) { error.textContent = 'Elegí quién carga.'; return; }

  boton.disabled = true;
  boton.textContent = 'Verificando…';
  try {
    const datos = await api.listar(pin, mesActual());
    estado.pin = pin;
    estado.nombre = nombreElegido;
    localStorage.setItem(LS.pin, pin);
    localStorage.setItem(LS.nombre, nombreElegido);
    $('ingreso-pin').value = '';
    recibirDatos(datos);
    mostrar('principal');
    pintar();
    refrescar(); // por si quedaron movimientos sin enviar de antes
  } catch (err) {
    error.textContent = err.codigo === 'SIN_CONEXION'
      ? 'No hay conexión. La primera vez hace falta señal para verificar el PIN.'
      : err.message;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});

function salir(mensaje = '') {
  localStorage.removeItem(LS.pin);
  localStorage.removeItem(LS.nombre);
  estado.pin = '';
  estado.nombre = '';
  estado.datos = null;
  nombreElegido = '';
  pintarIngreso();
  $('ingreso-error').textContent = mensaje;
  mostrar('ingreso');
}

$('btn-salir').addEventListener('click', () => {
  const n = cola.pendientes().length;
  const extra = n ? ` Hay ${n} movimiento(s) sin enviar: quedan guardados y se mandan cuando vuelvas a entrar.` : '';
  if (confirm('¿Salir? Vas a tener que poner el PIN de nuevo.' + extra)) salir();
});

// ---------------------------------------------------------------------------
// Pantalla principal
// ---------------------------------------------------------------------------

function recibirDatos(datos) {
  estado.datos = datos;
  estado.sinConexion = false;
  if (datos.config && Array.isArray(datos.config.productos) && datos.config.productos.length) {
    estado.config = datos.config;
    localStorage.setItem(LS.config, JSON.stringify(datos.config));
  }
}

let enCurso = null;

/** Manda lo pendiente y vuelve a leer la planilla. Si ya hay una vuelta en curso, pide otra al terminar. */
function refrescar() {
  if (!estado.pin) return Promise.resolve();
  if (enCurso) { estado.repetir = true; return enCurso; }
  enCurso = (async () => {
    do {
      estado.repetir = false;
      await unaVuelta();
    } while (estado.repetir && estado.pin);
  })().finally(() => { enCurso = null; });
  return enCurso;
}

async function unaVuelta() {
  estado.cargando = true;
  pintarEstado();
  try {
    const r = await cola.enviar(estado.pin);
    r.rechazados.forEach((x) => aviso('La planilla rechazó un movimiento: ' + x.mensaje, true));
    if (r.error) throw r.error;
    recibirDatos(await api.listar(estado.pin, mesActual()));
  } catch (err) {
    if (err.codigo === 'SIN_CONEXION') {
      estado.sinConexion = true;
    } else if (err.codigo === 'PIN_INCORRECTO') {
      salir('El PIN ya no es correcto. Ponelo de nuevo.');
    } else {
      aviso(err.message, true);
    }
  } finally {
    estado.cargando = false;
    pintar();
  }
}

function pintarEstado() {
  const n = cola.pendientes().length;
  const partes = [];
  if (estado.sinConexion) partes.push('Sin conexión.');
  if (n) partes.push(n === 1 ? 'Hay 1 movimiento sin enviar.' : `Hay ${n} movimientos sin enviar.`);
  if (n) partes.push('Se manda solo cuando haya señal.');
  if (!partes.length && estado.cargando) partes.push('Actualizando…');
  $('estado').textContent = partes.join(' ');
  $('estado').hidden = partes.length === 0;
}

function ponerMonto(id, valor) {
  const el = $(id);
  el.textContent = valor === undefined ? '—' : monto(valor);
  el.classList.toggle('negativo', Number(valor) < 0);
}

function pintar() {
  if (!estado.pin) return;
  pintarEstado();
  $('mes').textContent = nombreMes(estado.datos ? estado.datos.mes : mesActual());
  $('quien').textContent = 'Cargando como ' + estado.nombre;

  const t = estado.datos ? estado.datos.totales : {};
  ponerMonto('t-ventas', t.ventas);
  ponerMonto('t-ganancia', t.ganancia);
  ponerMonto('t-caja', t.cajaMes);
  ponerMonto('t-ahorro', t.ahorroAcumulado);
  $('t-caja-sub').textContent = estado.datos ? 'Acumulada: ' + monto(t.cajaAcumulada) : 'ingresos − egresos';
  $('t-ahorro-sub').textContent = estado.datos ? 'Este mes: ' + monto(t.ahorroMes) : '';

  grupo($('filtros'), FILTROS, estado.filtro, (f) => { estado.filtro = f; pintar(); });
  pintarLista();
}

function pintarLista() {
  const pendientes = cola.pendientes();
  const idsPendientes = new Set(pendientes.map((m) => m.id));
  const enviados = (estado.datos ? estado.datos.movimientos : []).filter((m) => !idsPendientes.has(m.id));
  const todos = pendientes.slice().reverse().map((m) => ({ ...m, pendiente: true })).concat(enviados);

  const busca = estado.busqueda.trim().toLowerCase();
  const visibles = todos.filter((m) => {
    if (estado.filtro === 'Ingresos' && m.tipo !== 'Ingreso') return false;
    if (estado.filtro === 'Egresos' && m.tipo !== 'Egreso') return false;
    if (!busca) return true;
    return [m.detalle, m.cliente, m.producto, m.categoria, m.medioPago, m.cargadoPor, fechaCorta(m.fecha)]
      .join(' ').toLowerCase().includes(busca);
  });

  $('lista').replaceChildren(...visibles.map(filaMovimiento));

  const vacia = $('lista-vacia');
  vacia.hidden = visibles.length > 0;
  if (!visibles.length) {
    vacia.textContent = todos.length
      ? 'No hay movimientos que coincidan.'
      : (estado.datos ? 'Todavía no hay movimientos. Anotá el primero.' : 'Sin datos por ahora.');
  }

  // Clientes ya usados, para sugerirlos al anotar una venta.
  const clientes = [...new Set(todos.map((m) => m.cliente).filter(Boolean))].slice(0, 30);
  $('clientes').replaceChildren(...clientes.map((c) => {
    const o = document.createElement('option');
    o.value = c;
    return o;
  }));
}

function filaMovimiento(m) {
  const li = document.createElement('li');

  const texto = document.createElement('div');
  texto.className = 'texto';

  const titulo = document.createElement('div');
  titulo.className = 'titulo';
  if (esVenta(m.tipo, m.categoria)) {
    titulo.textContent = `${m.cantidad} × ${m.producto}` + (m.cliente ? ` · ${m.cliente}` : '');
  } else {
    titulo.textContent = m.detalle || m.categoria;
  }
  if (m.pendiente) {
    const p = document.createElement('span');
    p.className = 'pendiente';
    p.textContent = 'sin enviar';
    titulo.append(p);
  }

  const datos = document.createElement('div');
  datos.className = 'datos';
  datos.textContent = [fechaCorta(m.fecha), m.categoria, m.medioPago, m.cargadoPor]
    .filter(Boolean).join(' · ');

  texto.append(titulo, datos);
  if (esVenta(m.tipo, m.categoria) && m.detalle) {
    const d = document.createElement('div');
    d.className = 'datos';
    d.textContent = m.detalle;
    texto.append(d);
  }

  const valor = document.createElement('div');
  const egreso = m.tipo === 'Egreso';
  valor.className = 'monto ' + (egreso ? 'egreso-m' : 'ingreso-m');
  valor.textContent = monto(egreso ? -m.monto : m.monto);

  li.append(texto, valor);
  return li;
}

$('buscar').addEventListener('input', (e) => { estado.busqueda = e.target.value; pintarLista(); });
$('btn-actualizar').addEventListener('click', refrescar);

// ---------------------------------------------------------------------------
// Anotar un movimiento
// ---------------------------------------------------------------------------

const form = { tipo: 'Ingreso', categoria: '', producto: '', cantidad: 1, medioPago: '' };

function abrirAnotar() {
  const c = estado.config;
  form.tipo = 'Ingreso';
  form.categoria = c.categorias.Ingreso[0];
  form.producto = c.productos[0].nombre;
  form.cantidad = 1;
  form.medioPago = c.medios[0];
  $('f-fecha').value = hoy();
  $('f-cliente').value = '';
  $('f-detalle').value = '';
  $('f-monto').value = '';
  $('f-error').textContent = '';
  ponerPrecioSugerido();
  pintarForm();
  mostrar('anotar');
  history.pushState({ vista: 'anotar' }, '');
}

function precioSugerido() {
  const p = estado.config.productos.find((x) => x.nombre === form.producto);
  if (!p) return 0;
  return form.categoria === 'Venta mayorista' ? p.mayorista : p.minorista;
}

function ponerPrecioSugerido() {
  $('f-precio').value = paraCampo(precioSugerido());
}

function pintarForm() {
  const c = estado.config;
  grupo($('f-tipo'), ['Ingreso', 'Egreso'], form.tipo, (v) => {
    form.tipo = v;
    form.categoria = c.categorias[v][0];
    ponerPrecioSugerido();
    pintarForm();
  });
  grupo($('f-categorias'), c.categorias[form.tipo], form.categoria, (v) => {
    form.categoria = v;
    ponerPrecioSugerido(); // minorista y mayorista tienen distinto precio
    pintarForm();
  });

  const venta = esVenta(form.tipo, form.categoria);
  $('campos-venta').hidden = !venta;
  $('campos-otro').hidden = venta;
  if (!venta) return;

  grupo($('f-productos'), c.productos.map((p) => p.nombre), form.producto, (v) => {
    form.producto = v;
    ponerPrecioSugerido();
    pintarForm();
  });
  grupo($('f-medios'), c.medios, form.medioPago, (v) => { form.medioPago = v; pintarForm(); });
  $('f-cantidad').value = String(form.cantidad);
  pintarTotal();
}

function pintarTotal() {
  const precio = parsearMonto($('f-precio').value);
  const total = form.cantidad > 0 && precio > 0 ? form.cantidad * precio : 0;
  $('f-total').textContent = monto(total);
}

function cambiarCantidad(n) {
  form.cantidad = Math.max(1, Math.min(9999, n));
  $('f-cantidad').value = String(form.cantidad);
  pintarTotal();
}

$('f-menos').addEventListener('click', () => cambiarCantidad(form.cantidad - 1));
$('f-mas').addEventListener('click', () => cambiarCantidad(form.cantidad + 1));
$('f-cantidad').addEventListener('input', (e) => {
  const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
  form.cantidad = n > 0 ? Math.min(9999, n) : 0;
  pintarTotal();
});
$('f-cantidad').addEventListener('blur', () => cambiarCantidad(form.cantidad || 1));
$('f-precio').addEventListener('input', pintarTotal);

$('form-mov').addEventListener('submit', (e) => {
  e.preventDefault();
  const error = $('f-error');
  error.textContent = '';

  const fecha = $('f-fecha').value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { error.textContent = 'Falta la fecha.'; return; }

  const mov = {
    id: nuevoId(),
    fecha,
    tipo: form.tipo,
    categoria: form.categoria,
    detalle: $('f-detalle').value.trim(),
    cliente: '',
    producto: '',
    cantidad: null,
    precioUnitario: null,
    monto: 0,
    medioPago: '',
    cargadoPor: estado.nombre
  };

  if (esVenta(form.tipo, form.categoria)) {
    const precio = parsearMonto($('f-precio').value);
    if (!(form.cantidad > 0)) { error.textContent = 'La cantidad tiene que ser 1 o más.'; return; }
    if (!(precio > 0)) { error.textContent = 'Revisá el precio unitario.'; return; }
    mov.cliente = $('f-cliente').value.trim();
    mov.producto = form.producto;
    mov.cantidad = form.cantidad;
    mov.precioUnitario = precio;
    mov.monto = Math.round(form.cantidad * precio * 100) / 100;
    mov.medioPago = form.medioPago;
  } else {
    const valor = parsearMonto($('f-monto').value);
    if (!(valor > 0)) { error.textContent = 'Poné el monto.'; return; }
    mov.monto = Math.round(valor * 100) / 100;
  }

  // Primero se guarda en el celular; después se intenta mandar.
  cola.encolar(mov);
  history.back();
  mostrar('principal');
  pintar();
  refrescar().then(() => {
    const sigue = cola.pendientes().some((m) => m.id === mov.id);
    if (!sigue) aviso('Listo, quedó anotado.');
    else if (estado.sinConexion) aviso('Quedó guardado en el celular. Se manda cuando haya señal.');
    // Si sigue pendiente por otro motivo, ya se mostró el error de la planilla.
  });
});

$('btn-anotar').addEventListener('click', abrirAnotar);
$('btn-volver').addEventListener('click', () => history.back());
window.addEventListener('popstate', () => {
  if (estado.pin) { mostrar('principal'); pintar(); }
});

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

window.addEventListener('online', refrescar);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refrescar();
});

const esLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
if ('serviceWorker' in navigator && !esLocal) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* la app funciona igual */ });
}

if (estado.pin && estado.nombre) {
  mostrar('principal');
  pintar();
  refrescar();
} else {
  pintarIngreso();
  if (!api.apiConfigurada()) {
    $('ingreso-error').textContent = 'Falta configurar la app: pegá la URL de la web app en config.js.';
  }
  mostrar('ingreso');
}
