/**
 * EduMovil - Backend en Google Apps Script
 *
 * Este script va VINCULADO a la hoja de cálculo (Extensiones > Apps Script).
 * Hojas que usa (se crean solas con setup() o en la primera llamada):
 *   - Viajes : un registro por viaje (pendiente o pagado)
 *   - Pagos  : un registro por pago (los pagos se hacen fuera de la app;
 *              aquí solo se anota cuánto pagó cada uno)
 *   - Config : clave / valor (tarifa y usuarios)
 *
 * Cada viaje es un tramo (Ida o Vuelta) y cuesta costoViaje.
 * La app envía "operaciones" con un id generado en el cliente. Si una
 * operación llega dos veces (reintento offline), se ignora la segunda.
 */

const HOJA_VIAJES = 'Viajes';
const HOJA_PAGOS = 'Pagos';
const HOJA_CONFIG = 'Config';

const COLS_VIAJES = ['id', 'usuario', 'fecha', 'trayecto', 'costo', 'estado', 'creado', 'pagoId'];
const TRAYECTOS = ['Ida', 'Vuelta'];
const COLS_PAGOS = ['id', 'usuario', 'monto', 'viajes', 'fecha'];

const CONFIG_POR_DEFECTO = [
  ['costoViaje', 2300, 'Tarifa fija por viaje (CLP)'],
  ['usuarios', 'Samir,Feña,Tamara,Karina,Ezequiel', 'Separados por coma']
];

const MAX_PAGOS_DEVUELTOS = 100;

// ---------------------------------------------------------------------------
// Entradas web
// ---------------------------------------------------------------------------

// La app (index.html) está publicada en GitHub Pages y llama a esta Web App.

/** GET: devuelve el estado en JSON (útil para probar la URL en el navegador). */
function doGet() {
  return salidaJson(procesar({}));
}

/** POST: recibe { ops: [...] }, las aplica y devuelve el estado actualizado. */
function doPost(e) {
  let cuerpo = {};
  try {
    cuerpo = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return salidaJson({ ok: false, error: 'JSON inválido' });
  }
  return salidaJson(procesar(cuerpo));
}

function salidaJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// Núcleo
// ---------------------------------------------------------------------------

function procesar(cuerpo) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    asegurarHojas(ss);
    const config = leerConfig(ss);

    const resultados = (cuerpo.ops || []).map(function (op) {
      try {
        return { id: op.id, ok: true, detalle: aplicarOperacion(ss, config, op) };
      } catch (err) {
        return { id: op.id, ok: false, error: String(err.message || err) };
      }
    });

    return { ok: true, resultados: resultados, estado: leerEstado(ss, config) };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  } finally {
    lock.releaseLock();
  }
}

function aplicarOperacion(ss, config, op) {
  switch (op.tipo) {
    case 'agregarViaje': return agregarViaje(ss, config, op);
    case 'eliminarViaje': return eliminarViaje(ss, op);
    case 'pagar': return registrarPago(ss, op);
    default: throw new Error('Operación desconocida: ' + op.tipo);
  }
}

function agregarViaje(ss, config, op) {
  if (config.usuarios.indexOf(op.usuario) === -1) throw new Error('Usuario no válido');
  if (TRAYECTOS.indexOf(op.trayecto) === -1) throw new Error('Trayecto no válido');
  const fecha = new Date(op.fecha);
  if (isNaN(fecha.getTime())) throw new Error('Fecha no válida');

  const hoja = ss.getSheetByName(HOJA_VIAJES);
  if (buscarFila(hoja, op.id) > 0) return 'duplicado';

  hoja.appendRow([
    op.id,
    op.usuario,
    fecha,
    op.trayecto,
    config.costoViaje, // la tarifa la decide el servidor
    'pendiente',
    new Date(),
    ''
  ]);
  return 'creado';
}

function eliminarViaje(ss, op) {
  const hoja = ss.getSheetByName(HOJA_VIAJES);
  const fila = buscarFila(hoja, op.viajeId);
  if (fila < 0) return 'no-existe';
  const estado = hoja.getRange(fila, COLS_VIAJES.indexOf('estado') + 1).getValue();
  if (estado !== 'pendiente') throw new Error('No se puede eliminar un viaje ya pagado');
  hoja.deleteRow(fila);
  return 'eliminado';
}

/**
 * Registra un pago (total o un abono de cualquier monto) y marca como pagados
 * los viajes pendientes más antiguos que alcance a cubrir. Lo que sobra queda
 * como abono y se descuenta de la deuda.
 */
function registrarPago(ss, op) {
  const hojaPagos = ss.getSheetByName(HOJA_PAGOS);
  if (buscarFila(hojaPagos, op.id) > 0) return 'duplicado';

  const monto = Math.round(Number(op.monto));
  if (!(monto > 0)) throw new Error('Monto no válido');

  const cuenta = cuentaDe(ss, op.usuario);
  if (monto > cuenta.deuda) throw new Error('El monto es mayor que la deuda');

  const hoja = ss.getSheetByName(HOJA_VIAJES);
  const cEstado = COLS_VIAJES.indexOf('estado') + 1;
  const cPago = COLS_VIAJES.indexOf('pagoId') + 1;
  let credito = cuenta.abono + monto;
  let cantidad = 0;
  cuenta.pendientes.forEach(function (v) {
    if (credito >= v.costo) {
      hoja.getRange(v.fila, cEstado).setValue('pagado');
      hoja.getRange(v.fila, cPago).setValue(op.id);
      credito -= v.costo;
      cantidad++;
    }
  });

  hojaPagos.appendRow([op.id, op.usuario, monto, cantidad, new Date(op.fecha || Date.now())]);
  return 'pagado';
}

/**
 * Situación de un usuario:
 *   abono  = lo pagado que todavía no completa un viaje
 *          = total pagado - costo de los viajes ya marcados como pagados
 *   deuda  = costo de los viajes pendientes - abono
 */
function cuentaDe(ss, usuario) {
  const viajes = filasComoObjetos(ss.getSheetByName(HOJA_VIAJES), COLS_VIAJES);
  const pagado = filasComoObjetos(ss.getSheetByName(HOJA_PAGOS), COLS_PAGOS)
    .filter(function (p) { return p.usuario === usuario; })
    .reduce(function (a, p) { return a + (Number(p.monto) || 0); }, 0);

  let cubierto = 0;
  let pendiente = 0;
  const pendientes = [];
  viajes.forEach(function (v) {
    if (v.usuario !== usuario) return;
    const costo = Number(v.costo) || 0;
    if (v.estado === 'pagado') cubierto += costo;
    if (v.estado === 'pendiente') {
      pendiente += costo;
      pendientes.push({ fila: v._fila, fecha: aIso(v.fecha), trayecto: v.trayecto, costo: costo });
    }
  });
  pendientes.sort(ordenViajes);

  const abono = Math.max(0, pagado - cubierto);
  return { abono: abono, deuda: Math.max(0, pendiente - abono), pendientes: pendientes };
}

/** Más antiguo primero; el mismo día, la ida antes que la vuelta. */
function ordenViajes(a, b) {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  return TRAYECTOS.indexOf(a.trayecto) - TRAYECTOS.indexOf(b.trayecto);
}

function leerEstado(ss, config) {
  const viajes = filasComoObjetos(ss.getSheetByName(HOJA_VIAJES), COLS_VIAJES)
    .filter(function (v) { return v.estado === 'pendiente'; })
    .map(function (v) {
      return {
        id: String(v.id),
        usuario: v.usuario,
        fecha: aIso(v.fecha),
        trayecto: v.trayecto,
        costo: Number(v.costo) || 0
      };
    });

  const abonos = {};
  config.usuarios.forEach(function (u) { abonos[u] = cuentaDe(ss, u).abono; });

  const pagos = filasComoObjetos(ss.getSheetByName(HOJA_PAGOS), COLS_PAGOS)
    .map(function (p) {
      return {
        id: String(p.id),
        usuario: p.usuario,
        monto: Number(p.monto) || 0,
        viajes: Number(p.viajes) || 0,
        fecha: aIso(p.fecha)
      };
    })
    .sort(function (a, b) { return a.fecha < b.fecha ? 1 : -1; })
    .slice(0, MAX_PAGOS_DEVUELTOS);

  return { config: config, viajes: viajes, abonos: abonos, pagos: pagos, servidor: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Utilidades de hoja
// ---------------------------------------------------------------------------

/** Ejecuta esto una vez desde el editor para crear las hojas. */
function setup() {
  asegurarHojas(SpreadsheetApp.getActiveSpreadsheet());
}

function asegurarHojas(ss) {
  crearHojaSiFalta(ss, HOJA_VIAJES, COLS_VIAJES, function (h) {
    h.getRange('C:C').setNumberFormat('dd/MM/yyyy');
    h.getRange('E:E').setNumberFormat('$#,##0');
    h.getRange('G:G').setNumberFormat('dd/MM/yyyy HH:mm');
  });
  crearHojaSiFalta(ss, HOJA_PAGOS, COLS_PAGOS, function (h) {
    h.getRange('C:C').setNumberFormat('$#,##0');
    h.getRange('E:E').setNumberFormat('dd/MM/yyyy HH:mm');
  });
  crearHojaSiFalta(ss, HOJA_CONFIG, ['clave', 'valor', 'nota'], function (h) {
    h.getRange(2, 1, CONFIG_POR_DEFECTO.length, 3).setValues(CONFIG_POR_DEFECTO);
    h.setColumnWidth(2, 260);
  });
}

function crearHojaSiFalta(ss, nombre, columnas, alCrear) {
  if (ss.getSheetByName(nombre)) return;
  const h = ss.insertSheet(nombre);
  h.getRange(1, 1, 1, columnas.length).setValues([columnas])
    .setFontWeight('bold').setBackground('#001D4D').setFontColor('#ffffff');
  h.setFrozenRows(1);
  if (alCrear) alCrear(h);
}

function leerConfig(ss) {
  const filas = ss.getSheetByName(HOJA_CONFIG).getDataRange().getValues().slice(1);
  const c = {};
  CONFIG_POR_DEFECTO.forEach(function (d) { c[d[0]] = d[1]; });
  filas.forEach(function (f) { if (f[0] !== '') c[String(f[0]).trim()] = f[1]; });

  return {
    costoViaje: Number(c.costoViaje) || 0,
    usuarios: String(c.usuarios).split(',').map(function (u) { return u.trim(); }).filter(String)
  };
}

function buscarFila(hoja, id) {
  if (!id || hoja.getLastRow() < 2) return -1;
  const encontrado = hoja.getRange(2, 1, hoja.getLastRow() - 1, 1)
    .createTextFinder(String(id)).matchEntireCell(true).findNext();
  return encontrado ? encontrado.getRow() : -1;
}

function filasComoObjetos(hoja, columnas) {
  const datos = hoja.getDataRange().getValues().slice(1);
  return datos
    .map(function (f, i) {
      const o = { _fila: i + 2 };
      columnas.forEach(function (c, j) { o[c] = f[j]; });
      return o;
    })
    .filter(function (o) { return o[columnas[0]] !== ''; });
}

function aIso(valor) {
  if (valor instanceof Date) return valor.toISOString();
  const d = new Date(valor);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}
