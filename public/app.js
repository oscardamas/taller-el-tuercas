// app.js - Gestión de interfaz, seguridad XSS/JWT, auditoría y alertas de mantenimiento (v5)
let clienteActualId = null;
let clienteDataGlobal = null;
let refaccionesTemporales = [];
let alertasMantenimientoGlobal = [];

// --- PARÁMETROS AJUSTABLES DE RECORDATORIOS ---
const CODIGO_PAIS_WHATSAPP = '52';
const NOMBRE_TALLER = 'Tu Taller Mecánico';

// --- SISTEMA DE LOGIN Y SEGURIDAD ---
let token = localStorage.getItem('taller_token');
let rolUsuario = localStorage.getItem('taller_rol');

// Helpers seguros para leer/escribir elementos sin que falle si alguno no existe
function setValorElemento(id, valor) {
  const el = document.getElementById(id);
  if (el) el.value = valor;
}

function getValorElemento(id, defecto = '') {
  const el = document.getElementById(id);
  return el ? el.value : defecto;
}

// Parseo seguro de refacciones para evitar errores si viene "null"
function parseRefacciones(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

// Lectura segura de respuestas HTTP (evita bloqueos si Render devuelve HTML)
async function leerJsonSeguro(res) {
  const texto = await res.text();
  try {
    return texto ? JSON.parse(texto) : {};
  } catch (e) {
    return { error: `El servidor respondió de forma inesperada (Código HTTP ${res.status}). Intenta de nuevo.` };
  }
}

// Función de saneamiento para prevenir ataques XSS al mostrar textos en HTML
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Función Wrapper para inyectar el Token en cada petición HTTP
async function fetchSeguro(url, options = {}) {
  if (!token) {
    cerrarSesion();
    throw new Error('Sin sesión activa');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
  const config = { ...options, headers: { ...headers, ...options.headers } };
  
  const res = await fetch(url, config);
  if (res.status === 401 || res.status === 403) {
    cerrarSesion();
    alert('Tu sesión ha expirado o no tienes permisos para realizar esta acción.');
    throw new Error('No autorizado');
  }
  return res;
}

document.addEventListener('DOMContentLoaded', () => {
  verificarSesionActiva();

  // --- EVENTOS DE LOGIN Y SESIÓN ---
  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = getValorElemento('login-user').trim();
    const password = getValorElemento('login-pass');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await leerJsonSeguro(res);
      
      if (res.ok) {
        token = data.token;
        rolUsuario = data.rol;
        localStorage.setItem('taller_token', token);
        localStorage.setItem('taller_rol', rolUsuario);
        document.getElementById('form-login').reset();
        verificarSesionActiva();
      } else {
        alert(data.error || 'Error al iniciar sesión.');
      }
    } catch (error) {
      console.error('Error en login:', error);
      alert('No se pudo conectar con el servidor.');
    }
  });

  document.getElementById('btn-logout').addEventListener('click', cerrarSesion);
  document.getElementById('btn-admin-usuarios').addEventListener('click', abrirModalUsuarios);

  // --- EVENTOS DE ADMINISTRACIÓN DE USUARIOS ---
  document.getElementById('form-nuevo-usuario').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = getValorElemento('nuevo-user').trim();
    const pass = getValorElemento('nuevo-pass');
    const rol = getValorElemento('nuevo-rol', 'empleado');

    try {
      const res = await fetchSeguro('/api/usuarios', {
        method: 'POST',
        body: JSON.stringify({ username: user, password: pass, rol: rol })
      });
      const data = await leerJsonSeguro(res);
      if (res.ok) {
        document.getElementById('form-nuevo-usuario').reset();
        cargarUsuarios();
      } else {
        alert(data.error || 'Error al crear usuario.');
      }
    } catch (err) {
      console.error(err);
    }
  });

  // --- EVENTOS DEL SISTEMA DE TALLER ---
  document.getElementById('btn-buscar').addEventListener('click', buscarClientePorTelefono);
  document.getElementById('input-buscar-telefono').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') buscarClientePorTelefono();
  });

  document.getElementById('btn-agregar-refaccion').addEventListener('click', agregarRefaccionDinamica);
  document.getElementById('ref-precio').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      agregarRefaccionDinamica();
    }
  });

  document.getElementById('srv-costo-obra').addEventListener('input', calcularTotalesFormulario);

  document.getElementById('form-cliente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      nombre: getValorElemento('cli-nombre').trim(),
      telefono: getValorElemento('cli-telefono').trim(),
      email: getValorElemento('cli-email').trim(),
      notas: getValorElemento('cli-notas').trim()
    };
    try {
      const res = await fetchSeguro('/api/clientes', { method: 'POST', body: JSON.stringify(data) });
      const result = await leerJsonSeguro(res);
      if (res.ok) {
        document.getElementById('form-cliente').reset();
        cargarExpedienteCompleto(result.id);
      } else {
        alert(result.error || 'Error al registrar cliente.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al guardar el cliente.');
    }
  });

  document.getElementById('form-edit-cliente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = getValorElemento('edit-cli-id');
    const data = {
      nombre: getValorElemento('edit-cli-nombre').trim(),
      telefono: getValorElemento('edit-cli-telefono').trim(),
      email: getValorElemento('edit-cli-email').trim(),
      notas: getValorElemento('edit-cli-notas').trim()
    };
    try {
      const res = await fetchSeguro(`/api/clientes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      const result = await leerJsonSeguro(res);
      if (res.ok) {
        cerrarModales();
        cargarExpedienteCompleto(id);
        cargarAlertasMantenimiento();
      } else {
        alert(result.error || 'Error al actualizar cliente.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al actualizar el cliente.');
    }
  });

  document.getElementById('form-vehiculo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const vehId = getValorElemento('veh-id');
    const data = {
      cliente_id: clienteActualId,
      marca: getValorElemento('veh-marca').trim(),
      modelo: getValorElemento('veh-modelo').trim(),
      anio: parseInt(getValorElemento('veh-anio'), 10),
      placas: getValorElemento('veh-placas').trim(),
      kilometraje: parseInt(getValorElemento('veh-km'), 10) || 0
    };

    const method = vehId ? 'PUT' : 'POST';
    const url = vehId ? `/api/vehiculos/${vehId}` : '/api/vehiculos';

    try {
      const res = await fetchSeguro(url, { method, body: JSON.stringify(data) });
      const result = await leerJsonSeguro(res);
      if (res.ok) {
        cerrarModales();
        cargarExpedienteCompleto(clienteActualId);
        cargarAlertasMantenimiento();
      } else {
        alert(result.error || 'Error al guardar vehículo.');
      }
    } catch (err) {
      console.error(err);
      alert('Error de conexión al guardar el vehículo.');
    }
  });

  // --- GUARDAR / EDITAR ORDEN DE SERVICIO ---
  document.getElementById('form-servicio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnGuardar = document.getElementById('btn-guardar-servicio');
    const srvId = getValorElemento('srv-id');

    const data = {
      vehiculo_id: getValorElemento('srv-vehiculo-id'),
      fecha: getValorElemento('srv-fecha'),
      diagnostico: getValorElemento('srv-diagnostico').trim(),
      trabajo_realizado: getValorElemento('srv-trabajo').trim(),
      refacciones: JSON.stringify(Array.isArray(refaccionesTemporales) ? refaccionesTemporales : []),
      costo_piezas: parseFloat(getValorElemento('srv-costo-piezas')) || 0,
      costo_mano_obra: parseFloat(getValorElemento('srv-costo-obra')) || 0,
      estado: getValorElemento('srv-estado', 'Pendiente'),
      proximo_servicio_fecha: getValorElemento('srv-proximo-fecha'),
      proximo_servicio_km: parseInt(getValorElemento('srv-proximo-km'), 10) || 0,
      proximo_motivo: getValorElemento('srv-proximo-motivo').trim()
    };

    const method = srvId ? 'PUT' : 'POST';
    const url = srvId ? `/api/servicios/${srvId}` : '/api/servicios';

    if (btnGuardar) {
      btnGuardar.disabled = true;
      btnGuardar.innerText = 'Guardando...';
    }

    try {
      const res = await fetchSeguro(url, { method, body: JSON.stringify(data) });
      const result = await leerJsonSeguro(res);
      if (res.ok) {
        cerrarModales();
        if (clienteActualId) {
          await cargarExpedienteCompleto(clienteActualId);
        }
        cargarAlertasMantenimiento();
      } else {
        alert(result.error || 'No se pudo guardar la orden de servicio.');
      }
    } catch (err) {
      console.error('Error al guardar orden:', err);
      if (err.message !== 'No autorizado') {
        alert('Ocurrió un error al comunicarse con el servidor al guardar la orden.');
      }
    } finally {
      if (btnGuardar) {
        btnGuardar.disabled = false;
        btnGuardar.innerText = 'Guardar Orden';
      }
    }
  });

  document.getElementById('btn-nuevo-vehiculo').addEventListener('click', () => { abrirModalVehiculo(); });

  document.getElementById('btn-editar-cliente').addEventListener('click', () => {
    if (!clienteDataGlobal) return;
    setValorElemento('edit-cli-id', clienteDataGlobal.id);
    setValorElemento('edit-cli-nombre', clienteDataGlobal.nombre);
    setValorElemento('edit-cli-telefono', clienteDataGlobal.telefono);
    setValorElemento('edit-cli-email', clienteDataGlobal.email || '');
    setValorElemento('edit-cli-notas', clienteDataGlobal.notas || '');
    document.getElementById('modal-cliente').classList.remove('hidden');
  });
});

// --- FUNCIONES DE SEGURIDAD ---
function verificarSesionActiva() {
  if (token) {
    document.getElementById('login-overlay').classList.add('hidden');
    document.getElementById('main-container').style.display = 'block';
    if (rolUsuario === 'admin') {
      document.getElementById('btn-admin-usuarios').classList.remove('hidden');
    } else {
      document.getElementById('btn-admin-usuarios').classList.add('hidden');
    }
    cargarAlertasMantenimiento();
  } else {
    document.getElementById('login-overlay').classList.remove('hidden');
    document.getElementById('main-container').style.display = 'none';
  }
}

function cerrarSesion() {
  token = null;
  rolUsuario = null;
  clienteActualId = null;
  clienteDataGlobal = null;
  localStorage.removeItem('taller_token');
  localStorage.removeItem('taller_rol');
  document.getElementById('expediente-cliente').classList.add('hidden');
  verificarSesionActiva();
}

async function abrirModalUsuarios() {
  await cargarUsuarios();
  document.getElementById('modal-usuarios').classList.remove('hidden');
}

async function cargarUsuarios() {
  const contenedor = document.getElementById('lista-usuarios');
  contenedor.innerHTML = '<p style="color: var(--text-muted);">Cargando usuarios...</p>';
  try {
    const res = await fetchSeguro('/api/usuarios');
    const usuarios = await leerJsonSeguro(res);
    contenedor.innerHTML = (Array.isArray(usuarios) ? usuarios : []).map(u => `
      <div class="result-item" style="display:flex; justify-content:space-between; align-items:center;">
        <span>👤 <strong>${escapeHtml(u.username)}</strong> <small style="color: var(--text-muted);">(${escapeHtml(u.rol)})</small></span>
        <button class="ref-item-btn-del" onclick="eliminarUsuario(${Number(u.id)})">Borrar</button>
      </div>
    `).join('');
  } catch (e) {
    contenedor.innerHTML = '<p style="color: #ef4444;">Error al cargar la lista.</p>';
  }
}

async function eliminarUsuario(id) {
  if (confirm('¿Seguro que deseas eliminar este usuario del sistema?')) {
    try {
      const res = await fetchSeguro(`/api/usuarios/${Number(id)}`, { method: 'DELETE' });
      if (res.ok) {
        cargarUsuarios();
      } else {
        const err = await leerJsonSeguro(res);
        alert(err.error || 'No se pudo eliminar el usuario.');
      }
    } catch (e) { console.error(e); }
  }
}

// --- SISTEMA DE ALERTAS Y RECORDATORIOS DE MANTENIMIENTO ---
function establecerFechaProxima(meses) {
  const fechaBaseInput = getValorElemento('srv-fecha');
  const fechaBase = fechaBaseInput ? new Date(fechaBaseInput + 'T12:00:00') : new Date();
  fechaBase.setMonth(fechaBase.getMonth() + meses);
  setValorElemento('srv-proximo-fecha', fechaBase.toISOString().split('T')[0]);
}

async function cargarAlertasMantenimiento() {
  const contenedor = document.getElementById('contenedor-alertas');
  if (!contenedor) return;
  try {
    const res = await fetchSeguro('/api/alertas/mantenimiento');
    if (!res.ok) return;
    const data = await leerJsonSeguro(res);
    alertasMantenimientoGlobal = Array.isArray(data) ? data : [];
    renderizarAlertasMantenimiento();
  } catch (error) {
    console.error('Error cargando alertas:', error);
    contenedor.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No se pudieron cargar las alertas.</p>';
  }
}

function calcularDiasDiferencia(fechaObjetivoStr) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const objetivo = new Date(fechaObjetivoStr + 'T00:00:00');
  const diffMs = objetivo - hoy;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function generarEnlaceWhatsApp(alerta) {
  const soloNumeros = String(alerta.cliente_telefono || '').replace(/\D/g, '');
  const telefonoFinal = soloNumeros.length === 10 ? `${CODIGO_PAIS_WHATSAPP}${soloNumeros}` : soloNumeros;

  const servicioDetalle = alerta.proximo_motivo
    ? `su servicio de *${alerta.proximo_motivo}*`
    : 'su servicio de mantenimiento preventivo';

  const kmDetalle = Number(alerta.proximo_servicio_km) > 0
    ? ` (o al alcanzar los ${Number(alerta.proximo_servicio_km).toLocaleString()} km)`
    : '';

  const mensaje = `Hola *${alerta.cliente_nombre}*, te saludamos de *${NOMBRE_TALLER}* 🔧. Te recordamos que tu *${alerta.marca} ${alerta.modelo}* (Placas: *${alerta.placas}*) tiene programado ${servicioDetalle} para la fecha *${alerta.proximo_servicio_fecha}*${kmDetalle}. ¿Gustas que te agendemos una cita?`;

  return `https://wa.me/${telefonoFinal}?text=${encodeURIComponent(mensaje)}`;
}

function renderizarAlertasMantenimiento() {
  const contenedor = document.getElementById('contenedor-alertas');
  const filtro = getValorElemento('filtro-alertas-tipo', 'pendientes');
  const contadorEl = document.getElementById('contador-alertas');
  if (!contenedor || !contadorEl) return;

  const pendientesCount = alertasMantenimientoGlobal.filter(a => Number(a.aviso_enviado) === 0).length;
  contadorEl.innerText = pendientesCount;

  const listaFiltrada = filtro === 'pendientes'
    ? alertasMantenimientoGlobal.filter(a => Number(a.aviso_enviado) === 0)
    : alertasMantenimientoGlobal;

  if (listaFiltrada.length === 0) {
    contenedor.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">✅ No hay recordatorios de mantenimiento pendientes por enviar en este momento.</p>';
    return;
  }

  contenedor.innerHTML = listaFiltrada.map(alerta => {
    const dias = calcularDiasDiferencia(alerta.proximo_servicio_fecha);
    const yaAvisado = Number(alerta.aviso_enviado) === 1;
    const urlWhatsApp = generarEnlaceWhatsApp(alerta);

    let etiquetaTiempo = '';
    let claseTarjeta = 'alert-card';

    if (dias < 0) {
      etiquetaTiempo = `🔴 Vencido hace ${Math.abs(dias)} día(s)`;
      claseTarjeta += ' alert-vencida';
    } else if (dias === 0) {
      etiquetaTiempo = '🔴 ¡Toca HOY!';
      claseTarjeta += ' alert-vencida';
    } else {
      etiquetaTiempo = `🟡 Próximo en ${dias} día(s)`;
      claseTarjeta += ' alert-proxima';
    }

    return `
      <div class="${claseTarjeta}">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <strong>🚘 ${escapeHtml(alerta.marca)} ${escapeHtml(alerta.modelo)} (${Number(alerta.anio)}) — Placas: ${escapeHtml(alerta.placas)}</strong>
            <span class="badge" style="margin-left: 8px; background: #1e293b; color: #f8fafc;">${etiquetaTiempo}</span>
            ${yaAvisado ? '<span class="badge badge-Completado" style="margin-left: 6px;">✔ Avisado</span>' : ''}
          </div>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <a href="${urlWhatsApp}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-whatsapp" onclick="marcarAvisoEnviado(${Number(alerta.servicio_id)}, true)">💬 Enviar WhatsApp</a>
            ${!yaAvisado
              ? `<button type="button" class="btn btn-secondary btn-sm" onclick="marcarAvisoEnviado(${Number(alerta.servicio_id)}, true)">✔ Marcar Avisado</button>`
              : `<button type="button" class="btn btn-secondary btn-sm" onclick="marcarAvisoEnviado(${Number(alerta.servicio_id)}, false)">↩ Reabrir Aviso</button>`
            }
            <button type="button" class="btn btn-secondary btn-sm" onclick="cargarExpedienteCompleto(${Number(alerta.cliente_id)})">📂 Ver Expediente</button>
          </div>
        </div>
        <p style="margin: 8px 0 4px 0; font-size: 0.92rem;">
          <strong>👤 Cliente:</strong> ${escapeHtml(alerta.cliente_nombre)} | 📞 <strong>Tel:</strong> ${escapeHtml(alerta.cliente_telefono)} | <strong>Fecha Programada:</strong> ${escapeHtml(alerta.proximo_servicio_fecha)}
          ${Number(alerta.proximo_servicio_km) > 0 ? ` | <strong>Meta KM:</strong> ${Number(alerta.proximo_servicio_km).toLocaleString()} km` : ''}
        </p>
        <p style="margin: 0; font-size: 0.88rem; color: var(--text-muted);">
          <strong>🔧 Servicio Recomendado:</strong> ${escapeHtml(alerta.proximo_motivo || 'Mantenimiento preventivo general')} <em>(Última visita: ${escapeHtml(alerta.ultimo_servicio_fecha)})</em>
        </p>
      </div>
    `;
  }).join('');
}

async function marcarAvisoEnviado(servicioId, estadoEnviado) {
  try {
    const res = await fetchSeguro(`/api/servicios/${Number(servicioId)}/aviso-enviado`, {
      method: 'PUT',
      body: JSON.stringify({ enviado: estadoEnviado })
    });
    if (res.ok) {
      cargarAlertasMantenimiento();
    }
  } catch (error) {
    console.error('Error actualizando estado de aviso:', error);
  }
}

// --- LÓGICA DE REFACCIONES DINÁMICAS ---
function agregarRefaccionDinamica() {
  const nombreInput = document.getElementById('ref-nombre');
  const precioInput = document.getElementById('ref-precio');
  const descripcion = nombreInput.value.trim();
  const precio = Math.max(0, parseFloat(precioInput.value) || 0);

  if (!descripcion) {
    alert('Ingresa una descripción o nombre para la refacción.');
    return;
  }

  if (!Array.isArray(refaccionesTemporales)) refaccionesTemporales = [];
  refaccionesTemporales.push({ descripcion, precio });
  nombreInput.value = '';
  precioInput.value = '';
  nombreInput.focus();

  renderizarRefaccionesFormulario();
}

function eliminarRefaccionDinamica(index) {
  if (!Array.isArray(refaccionesTemporales)) refaccionesTemporales = [];
  refaccionesTemporales.splice(index, 1);
  renderizarRefaccionesFormulario();
}

function renderizarRefaccionesFormulario() {
  const contenedor = document.getElementById('lista-refacciones');
  if (!contenedor) return;
  contenedor.innerHTML = '';
  let totalPiezas = 0;

  const listaSegura = Array.isArray(refaccionesTemporales) ? refaccionesTemporales : [];
  listaSegura.forEach((item, index) => {
    const precioItem = Number(item.precio) || 0;
    totalPiezas += precioItem;
    const div = document.createElement('div');
    div.className = 'ref-item';
    div.innerHTML = `
      <span>🔧 ${escapeHtml(item.descripcion)}</span>
      <div>
        <strong>$${precioItem.toFixed(2)}</strong>
        <button type="button" class="ref-item-btn-del" onclick="eliminarRefaccionDinamica(${index})">❌</button>
      </div>
    `;
    contenedor.appendChild(div);
  });

  setValorElemento('srv-costo-piezas', totalPiezas.toFixed(2));
  calcularTotalesFormulario();
}

function calcularTotalesFormulario() {
  // Reservado para cálculos reactivos adicionales
}

// --- FUNCIONES AUXILIARES SEGURAS POR ID ---
function editarVehiculoPorId(vehiculoId) {
  if (!clienteDataGlobal || !Array.isArray(clienteDataGlobal.vehiculos)) return;
  const vehiculo = clienteDataGlobal.vehiculos.find(v => Number(v.id) === Number(vehiculoId));
  if (vehiculo) abrirModalVehiculo(vehiculo);
}

function editarServicioPorId(servicioId) {
  if (!clienteDataGlobal || !Array.isArray(clienteDataGlobal.vehiculos)) return;
  for (const v of clienteDataGlobal.vehiculos) {
    const servicio = (v.servicios || []).find(s => Number(s.id) === Number(servicioId));
    if (servicio) {
      abrirModalServicio(null, servicio);
      return;
    }
  }
}

function imprimirNotaPorId(servicioId) {
  if (!clienteDataGlobal || !Array.isArray(clienteDataGlobal.vehiculos)) return;
  for (const v of clienteDataGlobal.vehiculos) {
    const servicio = (v.servicios || []).find(s => Number(s.id) === Number(servicioId));
    if (servicio) {
      imprimirNota(servicio);
      return;
    }
  }
}

// --- FUNCIONES CORE DEL TALLER ---
async function buscarClientePorTelefono() {
  const telefono = getValorElemento('input-buscar-telefono').trim();
  const contenedor = document.getElementById('resultados-busqueda');
  contenedor.innerHTML = '';

  if (!telefono) return;

  try {
    const res = await fetchSeguro(`/api/clientes/buscar?telefono=${encodeURIComponent(telefono)}`);
    const clientes = await leerJsonSeguro(res);

    if (!Array.isArray(clientes) || clientes.length === 0) {
      contenedor.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No se encontraron clientes registrados con ese número.</p>';
      return;
    }

    if (clientes.length === 1) {
      cargarExpedienteCompleto(clientes[0].id);
      contenedor.innerHTML = '';
      return;
    }

    clientes.forEach(c => {
      const div = document.createElement('div');
      div.className = 'result-item';
      div.innerHTML = `<strong>${escapeHtml(c.nombre)}</strong> — 📞 ${escapeHtml(c.telefono)} ${c.email ? `(${escapeHtml(c.email)})` : ''}`;
      div.onclick = () => {
        cargarExpedienteCompleto(c.id);
        contenedor.innerHTML = '';
      };
      contenedor.appendChild(div);
    });
  } catch (error) { console.error('Error al buscar cliente:', error); }
}

async function cargarExpedienteCompleto(clienteId) {
  if (!clienteId) return;
  clienteActualId = clienteId;
  try {
    const res = await fetchSeguro(`/api/clientes/${Number(clienteId)}/completo`);
    const data = await leerJsonSeguro(res);
    if (!res.ok) {
      alert(data.error || 'No se pudo cargar el expediente.');
      return;
    }
    clienteDataGlobal = data;

    const expedienteEl = document.getElementById('expediente-cliente');
    expedienteEl.classList.remove('hidden');
    document.getElementById('exp-nombre').innerText = `👤 ${data.nombre}`;
    document.getElementById('exp-datos').innerHTML = `
      <p><strong>Teléfono:</strong> ${escapeHtml(data.telefono)}</p>
      <p><strong>Email:</strong> ${escapeHtml(data.email || 'No registrado')}</p>
      <p><strong>Notas:</strong> ${escapeHtml(data.notas || 'Sin observaciones')}</p>
    `;

    const contVehiculos = document.getElementById('exp-vehiculos');
    contVehiculos.innerHTML = '';

    if (!data.vehiculos || data.vehiculos.length === 0) {
      contVehiculos.innerHTML = '<p style="color: var(--text-muted);">Sin vehículos registrados.</p>';
    } else {
      data.vehiculos.forEach(v => {
        const card = document.createElement('div');
        card.className = 'vehicle-card';
        card.innerHTML = `
          <div class="vehicle-header">
            <h4>🚘 ${escapeHtml(v.marca)} ${escapeHtml(v.modelo)} (${Number(v.anio)}) - Placas: ${escapeHtml(v.placas)}</h4>
            <div>
              <button type="button" class="btn btn-secondary btn-sm" onclick="editarVehiculoPorId(${Number(v.id)})">✏️ Editar Auto</button>
              <button type="button" class="btn btn-sm" onclick="abrirModalServicio(${Number(v.id)})">➕ Nueva Orden</button>
            </div>
          </div>
          <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">Kilometraje: ${v.kilometraje ? Number(v.kilometraje).toLocaleString() : 0} km</p>
          <div class="services-list">
            <h5>Historial de Servicios:</h5>
            ${renderizarServicios(v.servicios)}
          </div>
        `;
        contVehiculos.appendChild(card);
      });
    }
    expedienteEl.scrollIntoView({ behavior: 'smooth' });
  } catch (err) { console.error(err); }
}

function renderizarServicios(servicios) {
  if (!servicios || servicios.length === 0) {
    return '<p style="color: var(--text-muted); font-size: 0.85rem;">No hay órdenes de trabajo registradas.</p>';
  }

  return servicios.map(s => {
    const total = (Number(s.costo_piezas) + Number(s.costo_mano_obra)).toFixed(2);
    const estadoClass = escapeHtml(s.estado).replace(/\s+/g, '-');
    const srvId = Number(s.id);
    
    const textoCreador = escapeHtml(s.creado_por || 'Sistema / Anterior');
    const textoEditor = s.editado_por ? ` | ✏️ <strong>Editado por:</strong> ${escapeHtml(s.editado_por)}` : '';

    const infoProximo = s.proximo_servicio_fecha
      ? `<p style="color: #f59e0b; font-size: 0.85rem;">🔔 <strong>Próximo Mantenimiento:</strong> ${escapeHtml(s.proximo_servicio_fecha)} ${Number(s.proximo_servicio_km) > 0 ? `(${Number(s.proximo_servicio_km).toLocaleString()} km)` : ''} ${s.proximo_motivo ? `— ${escapeHtml(s.proximo_motivo)}` : ''}</p>`
      : '';

    return `
      <div class="service-card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong>📅 Fecha: ${escapeHtml(s.fecha)}</strong>
          <div>
            <span class="badge badge-${estadoClass}">${escapeHtml(s.estado)}</span>
            <button type="button" class="btn btn-secondary btn-sm" onclick="editarServicioPorId(${srvId})">✏️ Editar</button>
            <button type="button" class="btn btn-sm" style="background-color: #10b981; color: #fff;" onclick="imprimirNotaPorId(${srvId})">📄 PDF</button>
          </div>
        </div>
        <p><strong>Motivo/Falla:</strong> ${escapeHtml(s.diagnostico)}</p>
        <p><strong>Observaciones:</strong> ${escapeHtml(s.trabajo_realizado || 'Sin comentarios registrados')}</p>
        ${infoProximo}
        <p><strong>Desglose:</strong> Piezas: $${Number(s.costo_piezas).toFixed(2)} | Mano de Obra: $${Number(s.costo_mano_obra).toFixed(2)} ➔ <strong>Total: $${total}</strong></p>
        <p style="font-size: 0.78rem; color: var(--text-muted); border-top: 1px dashed var(--border); padding-top: 6px; margin-top: 8px; margin-bottom: 0;">
          📝 <strong>Registrado por:</strong> ${textoCreador}${textoEditor}
        </p>
      </div>
    `;
  }).join('');
}

async function filtrarPorEstado(estado) {
  const contenedor = document.getElementById('contenedor-estado-servicios');
  contenedor.innerHTML = '';

  if (!estado) {
    contenedor.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">Selecciona un estado para consultar los vehículos activos.</p>';
    return;
  }

  try {
    const res = await fetchSeguro(`/api/servicios/estado/${encodeURIComponent(estado)}`);
    const lista = await leerJsonSeguro(res);

    if (!Array.isArray(lista) || lista.length === 0) {
      contenedor.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">No hay órdenes registradas con el estado "${escapeHtml(estado)}".</p>`;
      return;
    }

    lista.forEach(item => {
      const total = (Number(item.costo_piezas) + Number(item.costo_mano_obra)).toFixed(2);
      const estadoClass = escapeHtml(item.estado).replace(/\s+/g, '-');
      const textoCreador = escapeHtml(item.creado_por || 'Sistema / Anterior');
      const textoEditor = item.editado_por ? ` | ✏️ <strong>Editado por:</strong> ${escapeHtml(item.editado_por)}` : '';

      const card = document.createElement('div');
      card.className = 'vehicle-card';
      card.style.marginBottom = '12px';
      card.innerHTML = `
        <div class="vehicle-header">
          <h4>🚘 ${escapeHtml(item.marca)} ${escapeHtml(item.modelo)} (${Number(item.anio)}) — Placas: ${escapeHtml(item.placas)}</h4>
          <span class="badge badge-${estadoClass}">${escapeHtml(item.estado)}</span>
        </div>
        <p style="margin: 4px 0;"><strong>👤 Cliente:</strong> ${escapeHtml(item.cliente_nombre)} | 📞 <strong>Tel:</strong> ${escapeHtml(item.cliente_telefono)}</p>
        <p style="margin: 4px 0;"><strong>📅 Fecha Ingreso:</strong> ${escapeHtml(item.fecha)} | <strong>KM:</strong> ${item.kilometraje ? Number(item.kilometraje).toLocaleString() : 0} km</p>
        <div class="service-card" style="margin-top: 8px;">
          <p><strong>Diagnóstico / Falla:</strong> ${escapeHtml(item.diagnostico)}</p>
          <p><strong>Observaciones:</strong> ${escapeHtml(item.trabajo_realizado || 'Pendiente')}</p>
          <p><strong>Costo Estimado/Total:</strong> $${total} MXN</p>
          <p style="font-size: 0.78rem; color: var(--text-muted); border-top: 1px dashed var(--border); padding-top: 6px; margin-top: 8px; margin-bottom: 0;">
            📝 <strong>Registrado por:</strong> ${textoCreador}${textoEditor}
          </p>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top: 10px;" onclick="cargarExpedienteCompleto(${Number(item.cliente_id)})">Ver expediente completo de ${escapeHtml(item.cliente_nombre)}</button>
      `;
      contenedor.appendChild(card);
    });
  } catch (error) { console.error(error); }
}

function imprimirNota(servicio) {
  if (!clienteDataGlobal) {
    alert('No hay información de cliente cargada.');
    return;
  }

  const vehiculo = (clienteDataGlobal.vehiculos || []).find(v => Number(v.id) === Number(servicio.vehiculo_id)) || {};
  const total = (Number(servicio.costo_piezas) + Number(servicio.costo_mano_obra)).toFixed(2);
  const atendidoPor = escapeHtml(servicio.editado_por || servicio.creado_por || 'Personal Autorizado');
  const listaRefacciones = parseRefacciones(servicio.refacciones);

  let filasTabla = '';
  if (listaRefacciones.length > 0) {
    listaRefacciones.forEach(item => {
      filasTabla += `<tr><td>🔧 Refacción: ${escapeHtml(item.descripcion)}</td><td style="text-align: right;">$${Number(item.precio).toFixed(2)}</td></tr>`;
    });
  } else if (Number(servicio.costo_piezas) > 0) {
    filasTabla += `<tr><td>🔧 Refacciones y Consumibles (General)</td><td style="text-align: right;">$${Number(servicio.costo_piezas).toFixed(2)}</td></tr>`;
  }

  filasTabla += `<tr><td>🛠️ Mano de Obra Especializada</td><td style="text-align: right;">$${Number(servicio.costo_mano_obra).toFixed(2)}</td></tr>`;

  const bloqueProximoServicio = servicio.proximo_servicio_fecha
    ? `<div style="background: #fffbeb; border: 1px solid #f59e0b; padding: 10px; border-radius: 6px; margin-top: 15px; font-size: 13px;">
         <strong>🔔 Recordatorio de Próximo Mantenimiento:</strong> ${escapeHtml(servicio.proximo_servicio_fecha)}
         ${Number(servicio.proximo_servicio_km) > 0 ? ` | <strong>Kilometraje sugerido:</strong> ${Number(servicio.proximo_servicio_km).toLocaleString()} km` : ''}
         ${servicio.proximo_motivo ? `<br><strong>Servicio recomendado:</strong> ${escapeHtml(servicio.proximo_motivo)}` : ''}
       </div>`
    : '';

  const ventanaImpresion = window.open('', '_blank', 'width=800,height=700');
  const contenidoHTML = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Nota_de_Servicio_${Number(servicio.id)}_${escapeHtml(clienteDataGlobal.nombre).replace(/\s+/g, '_')}</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; color: #1e293b; line-height: 1.5; }
        .header { text-align: center; border-bottom: 2px solid #ff4500; padding-bottom: 12px; margin-bottom: 20px; }
        .header h1 { margin: 0; font-size: 24px; color: #ff4500; text-transform: uppercase; }
        .header p { margin: 4px 0 0 0; font-size: 13px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; }
        .folio { font-weight: bold; color: #ff4500; font-size: 14px; margin-top: 6px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
        .box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; font-size: 13px; }
        .box-title { font-weight: bold; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-bottom: 8px; text-transform: uppercase; font-size: 12px; }
        .box p { margin: 3px 0; }
        .service-details { background: #fff; border: 1px solid #e2e8f0; padding: 15px; border-radius: 6px; margin-bottom: 20px; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
        th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; }
        th { background-color: #f1f5f9; color: #334155; }
        .total-container { text-align: right; margin-top: 20px; font-size: 15px; }
        .total-amount { font-size: 22px; color: #ff4500; font-weight: bold; }
        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 15px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>⚙️ TU TALLER MECANICO ⚙️</h1>
        <p>SERVICIO MECANICO AUTOMOTRIZ</p>
        <div class="folio">Orden N°: #${Number(servicio.id)} | Fecha: ${escapeHtml(servicio.fecha)}</div>
      </div>
      <div class="grid">
        <div class="box">
          <div class="box-title">👤 Datos del Cliente</div>
          <p><strong>Nombre:</strong> ${escapeHtml(clienteDataGlobal.nombre)}</p>
          <p><strong>Teléfono / WhatsApp:</strong> ${escapeHtml(clienteDataGlobal.telefono)}</p>
          <p><strong>Email:</strong> ${escapeHtml(clienteDataGlobal.email || 'No registrado')}</p>
        </div>
        <div class="box">
          <div class="box-title">🚗 Datos del Vehículo</div>
          <p><strong>Vehículo:</strong> ${escapeHtml(vehiculo.marca || '')} ${escapeHtml(vehiculo.modelo || '')} (${vehiculo.anio ? Number(vehiculo.anio) : ''})</p>
          <p><strong>Placas / Matrícula:</strong> ${escapeHtml(vehiculo.placas || 'N/A')}</p>
          <p><strong>Kilometraje:</strong> ${vehiculo.kilometraje ? Number(vehiculo.kilometraje).toLocaleString() + ' km' : 'N/A'}</p>
        </div>
      </div>
      <div class="service-details">
        <div class="box-title">📋 Detalle del Servicio</div>
        <p><strong>Motivo de Ingreso / Falla Reportada:</strong> ${escapeHtml(servicio.diagnostico)}</p>
        <p><strong>Comentarios Generales:</strong> ${escapeHtml(servicio.trabajo_realizado || 'Sin observaciones registradas')}</p>
        <p><strong>Estado Actual:</strong> <strong>${escapeHtml(servicio.estado)}</strong> | <strong>Atendido por:</strong> ${atendidoPor}</p>
      </div>
      <table>
        <thead>
          <tr><th>Concepto / Desglose de Refacción y Trabajo</th><th style="text-align: right; width: 140px;">Importe ($)</th></tr>
        </thead>
        <tbody>
          ${filasTabla}
        </tbody>
      </table>
      ${bloqueProximoServicio}
      <div class="total-container">
        <p>Total Importe: <span class="total-amount">$${total} MXN</span></p>
      </div>
      <div class="footer">
        <p>Gracias por su confianza. Tu Taller Mecánico.</p>
      </div>
      <script>window.onload = function() { window.print(); };</script>
    </body>
    </html>
  `;
  ventanaImpresion.document.write(contenidoHTML);
  ventanaImpresion.document.close();
}

function abrirModalVehiculo(vehiculo = null) {
  document.getElementById('form-vehiculo').reset();
  if (vehiculo) {
    document.getElementById('modal-veh-titulo').innerText = 'Editar Vehículo';
    setValorElemento('veh-id', vehiculo.id);
    setValorElemento('veh-marca', vehiculo.marca);
    setValorElemento('veh-modelo', vehiculo.modelo);
    setValorElemento('veh-anio', vehiculo.anio);
    setValorElemento('veh-placas', vehiculo.placas);
    setValorElemento('veh-km', vehiculo.kilometraje);
  } else {
    document.getElementById('modal-veh-titulo').innerText = 'Registrar Vehículo';
    setValorElemento('veh-id', '');
  }
  document.getElementById('modal-vehiculo').classList.remove('hidden');
}

function abrirModalServicio(vehiculoId = null, servicio = null) {
  const form = document.getElementById('form-servicio');
  if (form) form.reset();
  refaccionesTemporales = [];

  if (servicio) {
    document.getElementById('modal-srv-titulo').innerText = 'Editar Orden de Servicio';
    setValorElemento('srv-id', servicio.id);
    setValorElemento('srv-vehiculo-id', servicio.vehiculo_id);
    setValorElemento('srv-fecha', servicio.fecha || new Date().toISOString().split('T')[0]);
    setValorElemento('srv-diagnostico', servicio.diagnostico || '');
    setValorElemento('srv-trabajo', servicio.trabajo_realizado || '');
    setValorElemento('srv-costo-obra', servicio.costo_mano_obra || 0);
    setValorElemento('srv-estado', servicio.estado || 'Pendiente');
    setValorElemento('srv-proximo-fecha', servicio.proximo_servicio_fecha || '');
    setValorElemento('srv-proximo-km', servicio.proximo_servicio_km || '');
    setValorElemento('srv-proximo-motivo', servicio.proximo_motivo || '');

    refaccionesTemporales = parseRefacciones(servicio.refacciones);
  } else {
    document.getElementById('modal-srv-titulo').innerText = 'Nueva Orden de Servicio';
    setValorElemento('srv-id', '');
    setValorElemento('srv-vehiculo-id', vehiculoId);
    setValorElemento('srv-fecha', new Date().toISOString().split('T')[0]);
    setValorElemento('srv-costo-obra', 0);
    setValorElemento('srv-proximo-fecha', '');
    setValorElemento('srv-proximo-km', '');
    setValorElemento('srv-proximo-motivo', '');
  }

  renderizarRefaccionesFormulario();
  document.getElementById('modal-servicio').classList.remove('hidden');
}

function cerrarModales() {
  document.getElementById('modal-cliente').classList.add('hidden');
  document.getElementById('modal-vehiculo').classList.add('hidden');
  document.getElementById('modal-servicio').classList.add('hidden');
  document.getElementById('modal-usuarios').classList.add('hidden');
}