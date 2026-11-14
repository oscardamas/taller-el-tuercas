// app.js - Gestión de interfaz, seguridad XSS/JWT, auditoría y órdenes de servicio
let clienteActualId = null;
let clienteDataGlobal = null;
let refaccionesTemporales = [];

// --- SISTEMA DE LOGIN Y SEGURIDAD ---
let token = localStorage.getItem('taller_token');
let rolUsuario = localStorage.getItem('taller_rol');

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
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      
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
    const user = document.getElementById('nuevo-user').value.trim();
    const pass = document.getElementById('nuevo-pass').value;
    const rol = document.getElementById('nuevo-rol').value;

    try {
      const res = await fetchSeguro('/api/usuarios', {
        method: 'POST',
        body: JSON.stringify({ username: user, password: pass, rol: rol })
      });
      const data = await res.json();
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
      nombre: document.getElementById('cli-nombre').value.trim(),
      telefono: document.getElementById('cli-telefono').value.trim(),
      email: document.getElementById('cli-email').value.trim(),
      notas: document.getElementById('cli-notas').value.trim()
    };
    try {
      const res = await fetchSeguro('/api/clientes', { method: 'POST', body: JSON.stringify(data) });
      const result = await res.json();
      if (res.ok) {
        document.getElementById('form-cliente').reset();
        cargarExpedienteCompleto(result.id);
      } else {
        alert(result.error || 'Error al registrar cliente.');
      }
    } catch (err) { console.error(err); }
  });

  document.getElementById('form-edit-cliente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-cli-id').value;
    const data = {
      nombre: document.getElementById('edit-cli-nombre').value.trim(),
      telefono: document.getElementById('edit-cli-telefono').value.trim(),
      email: document.getElementById('edit-cli-email').value.trim(),
      notas: document.getElementById('edit-cli-notas').value.trim()
    };
    try {
      const res = await fetchSeguro(`/api/clientes/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      const result = await res.json();
      if (res.ok) {
        cerrarModales();
        cargarExpedienteCompleto(id);
      } else {
        alert(result.error || 'Error al actualizar cliente.');
      }
    } catch (err) { console.error(err); }
  });

  document.getElementById('form-vehiculo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const vehId = document.getElementById('veh-id').value;
    const data = {
      cliente_id: clienteActualId,
      marca: document.getElementById('veh-marca').value.trim(),
      modelo: document.getElementById('veh-modelo').value.trim(),
      anio: parseInt(document.getElementById('veh-anio').value, 10),
      placas: document.getElementById('veh-placas').value.trim(),
      kilometraje: parseInt(document.getElementById('veh-km').value, 10) || 0
    };

    const method = vehId ? 'PUT' : 'POST';
    const url = vehId ? `/api/vehiculos/${vehId}` : '/api/vehiculos';

    try {
      const res = await fetchSeguro(url, { method, body: JSON.stringify(data) });
      const result = await res.json();
      if (res.ok) {
        cerrarModales();
        cargarExpedienteCompleto(clienteActualId);
      } else {
        alert(result.error || 'Error al guardar vehículo.');
      }
    } catch (err) { console.error(err); }
  });

  document.getElementById('form-servicio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const srvId = document.getElementById('srv-id').value;
    const data = {
      vehiculo_id: document.getElementById('srv-vehiculo-id').value,
      fecha: document.getElementById('srv-fecha').value,
      diagnostico: document.getElementById('srv-diagnostico').value.trim(),
      trabajo_realizado: document.getElementById('srv-trabajo').value.trim(),
      refacciones: JSON.stringify(refaccionesTemporales),
      costo_piezas: parseFloat(document.getElementById('srv-costo-piezas').value) || 0,
      costo_mano_obra: parseFloat(document.getElementById('srv-costo-obra').value) || 0,
      estado: document.getElementById('srv-estado').value
    };

    const method = srvId ? 'PUT' : 'POST';
    const url = srvId ? `/api/servicios/${srvId}` : '/api/servicios';

    try {
      const res = await fetchSeguro(url, { method, body: JSON.stringify(data) });
      const result = await res.json();
      if (res.ok) {
        cerrarModales();
        cargarExpedienteCompleto(clienteActualId);
      } else {
        alert(result.error || 'Error al guardar orden.');
      }
    } catch (err) { console.error(err); }
  });

  document.getElementById('btn-nuevo-vehiculo').addEventListener('click', () => { abrirModalVehiculo(); });

  document.getElementById('btn-editar-cliente').addEventListener('click', () => {
    if (!clienteDataGlobal) return;
    document.getElementById('edit-cli-id').value = clienteDataGlobal.id;
    document.getElementById('edit-cli-nombre').value = clienteDataGlobal.nombre;
    document.getElementById('edit-cli-telefono').value = clienteDataGlobal.telefono;
    document.getElementById('edit-cli-email').value = clienteDataGlobal.email || '';
    document.getElementById('edit-cli-notas').value = clienteDataGlobal.notas || '';
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
    const usuarios = await res.json();
    contenedor.innerHTML = usuarios.map(u => `
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
        const err = await res.json();
        alert(err.error || 'No se pudo eliminar el usuario.');
      }
    } catch (e) { console.error(e); }
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

  refaccionesTemporales.push({ descripcion, precio });
  nombreInput.value = '';
  precioInput.value = '';
  nombreInput.focus();

  renderizarRefaccionesFormulario();
}

function eliminarRefaccionDinamica(index) {
  refaccionesTemporales.splice(index, 1);
  renderizarRefaccionesFormulario();
}

function renderizarRefaccionesFormulario() {
  const contenedor = document.getElementById('lista-refacciones');
  contenedor.innerHTML = '';
  let totalPiezas = 0;

  refaccionesTemporales.forEach((item, index) => {
    totalPiezas += item.precio;
    const div = document.createElement('div');
    div.className = 'ref-item';
    div.innerHTML = `
      <span>🔧 ${escapeHtml(item.descripcion)}</span>
      <div>
        <strong>$${Number(item.precio).toFixed(2)}</strong>
        <button type="button" class="ref-item-btn-del" onclick="eliminarRefaccionDinamica(${index})">❌</button>
      </div>
    `;
    contenedor.appendChild(div);
  });

  document.getElementById('srv-costo-piezas').value = totalPiezas.toFixed(2);
  calcularTotalesFormulario();
}

function calcularTotalesFormulario() {
  // Reservado para cálculos reactivos adicionales
}

// --- FUNCIONES AUXILIARES SEGURAS POR ID ---
function editarVehiculoPorId(vehiculoId) {
  if (!clienteDataGlobal || !clienteDataGlobal.vehiculos) return;
  const vehiculo = clienteDataGlobal.vehiculos.find(v => Number(v.id) === Number(vehiculoId));
  if (vehiculo) abrirModalVehiculo(vehiculo);
}

function editarServicioPorId(servicioId) {
  if (!clienteDataGlobal || !clienteDataGlobal.vehiculos) return;
  for (const v of clienteDataGlobal.vehiculos) {
    const servicio = (v.servicios || []).find(s => Number(s.id) === Number(servicioId));
    if (servicio) {
      abrirModalServicio(null, servicio);
      return;
    }
  }
}

function imprimirNotaPorId(servicioId) {
  if (!clienteDataGlobal || !clienteDataGlobal.vehiculos) return;
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
  const telefono = document.getElementById('input-buscar-telefono').value.trim();
  const contenedor = document.getElementById('resultados-busqueda');
  contenedor.innerHTML = '';

  if (!telefono) return;

  try {
    const res = await fetchSeguro(`/api/clientes/buscar?telefono=${encodeURIComponent(telefono)}`);
    const clientes = await res.json();

    if (clientes.length === 0) {
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
  clienteActualId = clienteId;
  try {
    const res = await fetchSeguro(`/api/clientes/${Number(clienteId)}/completo`);
    const data = await res.json();
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
              <button class="btn btn-secondary btn-sm" onclick="editarVehiculoPorId(${Number(v.id)})">✏️ Editar Auto</button>
              <button class="btn btn-sm" onclick="abrirModalServicio(${Number(v.id)})">➕ Nueva Orden</button>
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
    
    // Construcción del texto de auditoría
    const textoCreador = escapeHtml(s.creado_por || 'Sistema / Anterior');
    const textoEditor = s.editado_por ? ` | ✏️ <strong>Editado por:</strong> ${escapeHtml(s.editado_por)}` : '';

    return `
      <div class="service-card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong>📅 Fecha: ${escapeHtml(s.fecha)}</strong>
          <div>
            <span class="badge badge-${estadoClass}">${escapeHtml(s.estado)}</span>
            <button class="btn btn-secondary btn-sm" onclick="editarServicioPorId(${srvId})">✏️ Editar</button>
            <button class="btn btn-sm" style="background-color: #10b981; color: #fff;" onclick="imprimirNotaPorId(${srvId})">📄 PDF</button>
          </div>
        </div>
        <p><strong>Motivo/Falla:</strong> ${escapeHtml(s.diagnostico)}</p>
        <p><strong>Observaciones:</strong> ${escapeHtml(s.trabajo_realizado || 'Sin comentarios registrados')}</p>
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
    const lista = await res.json();

    if (lista.length === 0) {
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
        <button class="btn btn-secondary btn-sm" style="margin-top: 10px;" onclick="cargarExpedienteCompleto(${Number(item.cliente_id)})">Ver expediente completo de ${escapeHtml(item.cliente_nombre)}</button>
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

  let listaRefacciones = [];
  if (servicio.refacciones) {
    try {
      listaRefacciones = typeof servicio.refacciones === 'string' ? JSON.parse(servicio.refacciones) : servicio.refacciones;
    } catch (e) { listaRefacciones = []; }
  }

  let filasTabla = '';
  if (listaRefacciones && listaRefacciones.length > 0) {
    listaRefacciones.forEach(item => {
      filasTabla += `<tr><td>🔧 Refacción: ${escapeHtml(item.descripcion)}</td><td style="text-align: right;">$${Number(item.precio).toFixed(2)}</td></tr>`;
    });
  } else if (Number(servicio.costo_piezas) > 0) {
    filasTabla += `<tr><td>🔧 Refacciones y Consumibles (General)</td><td style="text-align: right;">$${Number(servicio.costo_piezas).toFixed(2)}</td></tr>`;
  }

  filasTabla += `<tr><td>🛠️ Mano de Obra Especializada</td><td style="text-align: right;">$${Number(servicio.costo_mano_obra).toFixed(2)}</td></tr>`;

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
    document.getElementById('veh-id').value = vehiculo.id;
    document.getElementById('veh-marca').value = vehiculo.marca;
    document.getElementById('veh-modelo').value = vehiculo.modelo;
    document.getElementById('veh-anio').value = vehiculo.anio;
    document.getElementById('veh-placas').value = vehiculo.placas;
    document.getElementById('veh-km').value = vehiculo.kilometraje;
  } else {
    document.getElementById('modal-veh-titulo').innerText = 'Registrar Vehículo';
    document.getElementById('veh-id').value = '';
  }
  document.getElementById('modal-vehiculo').classList.remove('hidden');
}

function abrirModalServicio(vehiculoId = null, servicio = null) {
  document.getElementById('form-servicio').reset();
  refaccionesTemporales = [];

  if (servicio) {
    document.getElementById('modal-srv-titulo').innerText = 'Editar Orden de Servicio';
    document.getElementById('srv-id').value = servicio.id;
    document.getElementById('srv-vehiculo-id').value = servicio.vehiculo_id;
    document.getElementById('srv-fecha').value = servicio.fecha;
    document.getElementById('srv-diagnostico').value = servicio.diagnostico;
    document.getElementById('srv-trabajo').value = servicio.trabajo_realizado || '';
    document.getElementById('srv-costo-obra').value = servicio.costo_mano_obra;
    document.getElementById('srv-estado').value = servicio.estado;

    if (servicio.refacciones) {
      try {
        refaccionesTemporales = typeof servicio.refacciones === 'string' ? JSON.parse(servicio.refacciones) : servicio.refacciones;
      } catch (e) { refaccionesTemporales = []; }
    }
  } else {
    document.getElementById('modal-srv-titulo').innerText = 'Nueva Orden de Servicio';
    document.getElementById('srv-id').value = '';
    document.getElementById('srv-vehiculo-id').value = vehiculoId;
    document.getElementById('srv-fecha').value = new Date().toISOString().split('T')[0];
    document.getElementById('srv-costo-obra').value = 0;
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