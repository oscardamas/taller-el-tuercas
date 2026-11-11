// app.js - Gestión de interfaz de cliente y órdenes de servicio
let clienteActualId = null;
let clienteDataGlobal = null;

document.addEventListener('DOMContentLoaded', () => {
  // Evento Búsqueda por teléfono
  document.getElementById('btn-buscar').addEventListener('click', buscarClientePorTelefono);
  document.getElementById('input-buscar-telefono').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') buscarClientePorTelefono();
  });

  // Evento Registrar Cliente
  document.getElementById('form-cliente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      nombre: document.getElementById('cli-nombre').value,
      telefono: document.getElementById('cli-telefono').value,
      email: document.getElementById('cli-email').value,
      notas: document.getElementById('cli-notas').value
    };
    const res = await fetch('/api/clientes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (res.ok) {
      document.getElementById('form-cliente').reset();
      cargarExpedienteCompleto(result.id);
    } else {
      alert(result.error);
    }
  });

  // Evento Guardar Edición Cliente
  document.getElementById('form-edit-cliente').addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-cli-id').value;
    const data = {
      nombre: document.getElementById('edit-cli-nombre').value,
      telefono: document.getElementById('edit-cli-telefono').value,
      email: document.getElementById('edit-cli-email').value,
      notas: document.getElementById('edit-cli-notas').value
    };
    await fetch(`/api/clientes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    cerrarModales();
    cargarExpedienteCompleto(id);
  });

  // Evento Guardar Vehículo
  document.getElementById('form-vehiculo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const vehId = document.getElementById('veh-id').value;
    const data = {
      cliente_id: clienteActualId,
      marca: document.getElementById('veh-marca').value,
      modelo: document.getElementById('veh-modelo').value,
      anio: parseInt(document.getElementById('veh-anio').value),
      placas: document.getElementById('veh-placas').value,
      kilometraje: parseInt(document.getElementById('veh-km').value) || 0
    };

    const method = vehId ? 'PUT' : 'POST';
    const url = vehId ? `/api/vehiculos/${vehId}` : '/api/vehiculos';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (res.ok) {
      cerrarModales();
      cargarExpedienteCompleto(clienteActualId);
    } else {
      const err = await res.json();
      alert(err.error);
    }
  });

  // Evento Guardar Orden de Servicio
  document.getElementById('form-servicio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const srvId = document.getElementById('srv-id').value;
    const data = {
      vehiculo_id: document.getElementById('srv-vehiculo-id').value,
      fecha: document.getElementById('srv-fecha').value,
      diagnostico: document.getElementById('srv-diagnostico').value,
      trabajo_realizado: document.getElementById('srv-trabajo').value,
      costo_piezas: parseFloat(document.getElementById('srv-costo-piezas').value) || 0,
      costo_mano_obra: parseFloat(document.getElementById('srv-costo-obra').value) || 0,
      estado: document.getElementById('srv-estado').value
    };

    const method = srvId ? 'PUT' : 'POST';
    const url = srvId ? `/api/servicios/${srvId}` : '/api/servicios';

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      cerrarModales();
      cargarExpedienteCompleto(clienteActualId);
    }
  });

  // Botón Abrir Modal Nuevo Vehículo
  document.getElementById('btn-nuevo-vehiculo').addEventListener('click', () => {
    abrirModalVehiculo();
  });

  // Botón Abrir Modal Editar Cliente
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

// 1. Buscar cliente por número de teléfono
async function buscarClientePorTelefono() {
  const telefono = document.getElementById('input-buscar-telefono').value.trim();
  const contenedor = document.getElementById('resultados-busqueda');
  contenedor.innerHTML = '';

  if (!telefono) return;

  try {
    const res = await fetch(`/api/clientes/buscar?telefono=${encodeURIComponent(telefono)}`);
    const clientes = await res.json();

    if (clientes.length === 0) {
      contenedor.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No se encontraron clientes registrados con ese número.</p>';
      return;
    }

    // Carga automática del expediente si solo existe un único cliente con ese número
    if (clientes.length === 1) {
      cargarExpedienteCompleto(clientes[0].id);
      contenedor.innerHTML = '';
      return;
    }

    // Si existen múltiples coincidencias, se despliega la lista interactiva
    clientes.forEach(c => {
      const div = document.createElement('div');
      div.className = 'result-item';
      div.innerHTML = `<strong>${c.nombre}</strong> — 📞 ${c.telefono} ${c.email ? `(${c.email})` : ''}`;
      div.onclick = () => {
        cargarExpedienteCompleto(c.id);
        contenedor.innerHTML = '';
      };
      contenedor.appendChild(div);
    });
  } catch (error) {
    console.error('Error al realizar la búsqueda de cliente:', error);
  }
}

// 2. Cargar expediente completo
async function cargarExpedienteCompleto(clienteId) {
  clienteActualId = clienteId;
  const res = await fetch(`/api/clientes/${clienteId}/completo`);
  const data = await res.json();
  clienteDataGlobal = data;

  const expedienteEl = document.getElementById('expediente-cliente');
  expedienteEl.classList.remove('hidden');
  document.getElementById('exp-nombre').innerText = `👤 ${data.nombre}`;
  document.getElementById('exp-datos').innerHTML = `
    <p><strong>Teléfono:</strong> ${data.telefono}</p>
    <p><strong>Email:</strong> ${data.email || 'No registrado'}</p>
    <p><strong>Notas:</strong> ${data.notas || 'Sin observaciones'}</p>
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
          <h4>🚘 ${v.marca} ${v.modelo} (${v.anio}) - Placas: ${v.placas}</h4>
          <div>
            <button class="btn btn-secondary btn-sm" onclick='abrirModalVehiculo(${JSON.stringify(v)})'>✏️ Editar Auto</button>
            <button class="btn btn-sm" onclick="abrirModalServicio(${v.id})">➕ Nueva Orden</button>
          </div>
        </div>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 4px;">Kilometraje: ${v.kilometraje ? v.kilometraje.toLocaleString() : 0} km</p>
        <div class="services-list">
          <h5>Historial de Servicios:</h5>
          ${renderizarServicios(v.servicios)}
        </div>
      `;
      contVehiculos.appendChild(card);
    });
  }

  // Desplazamiento suave para enfocar el expediente en la pantalla
  expedienteEl.scrollIntoView({ behavior: 'smooth' });
}

// 3. Renderizar tarjetas de servicios
function renderizarServicios(servicios) {
  if (!servicios || servicios.length === 0) {
    return '<p style="color: var(--text-muted); font-size: 0.85rem;">No hay órdenes de trabajo registradas.</p>';
  }

  return servicios.map(s => {
    const total = (Number(s.costo_piezas) + Number(s.costo_mano_obra)).toFixed(2);
    const estadoClass = s.estado.replace(/\s+/g, '-');
    const servicioJSON = JSON.stringify(s).replace(/'/g, "&apos;").replace(/"/g, "&quot;");

    return `
      <div class="service-card">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong>📅 Fecha: ${s.fecha}</strong>
          <div>
            <span class="badge badge-${estadoClass}">${s.estado}</span>
            <button class="btn btn-secondary btn-sm" onclick='abrirModalServicio(null, ${servicioJSON})'>✏️ Editar</button>
            <button class="btn btn-sm" style="background-color: #10b981; color: #fff;" onclick='imprimirNota(${servicioJSON})'>📄 PDF</button>
          </div>
        </div>
        <p><strong>Motivo/Falla:</strong> ${s.diagnostico}</p>
        <p><strong>Trabajo:</strong> ${s.trabajo_realizado || 'En diagnóstico'}</p>
        <p><strong>Desglose:</strong> Piezas: $${Number(s.costo_piezas).toFixed(2)} | Mano de Obra: $${Number(s.costo_mano_obra).toFixed(2)} ➔ <strong>Total: $${total}</strong></p>
      </div>
    `;
  }).join('');
}

// 4. Filtrar y listar vehículos por estado del servicio
async function filtrarPorEstado(estado) {
  const contenedor = document.getElementById('contenedor-estado-servicios');
  contenedor.innerHTML = '';

  if (!estado) {
    contenedor.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">Selecciona un estado para consultar los vehículos activos.</p>';
    return;
  }

  const res = await fetch(`/api/servicios/estado/${encodeURIComponent(estado)}`);
  const lista = await res.json();

  if (lista.length === 0) {
    contenedor.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">No hay órdenes registradas con el estado "${estado}".</p>`;
    return;
  }

  lista.forEach(item => {
    const total = (Number(item.costo_piezas) + Number(item.costo_mano_obra)).toFixed(2);
    const estadoClass = item.estado.replace(/\s+/g, '-');

    const card = document.createElement('div');
    card.className = 'vehicle-card';
    card.style.marginBottom = '12px';
    card.innerHTML = `
      <div class="vehicle-header">
        <h4>🚘 ${item.marca} ${item.modelo} (${item.anio}) — Placas: ${item.placas}</h4>
        <span class="badge badge-${estadoClass}">${item.estado}</span>
      </div>
      <p style="margin: 4px 0;"><strong>👤 Cliente:</strong> ${item.cliente_nombre} | 📞 <strong>Tel:</strong> ${item.cliente_telefono}</p>
      <p style="margin: 4px 0;"><strong>📅 Fecha Ingreso:</strong> ${item.fecha} | <strong>KM:</strong> ${item.kilometraje ? item.kilometraje.toLocaleString() : 0} km</p>
      <div class="service-card" style="margin-top: 8px;">
        <p><strong>Diagnóstico / Falla:</strong> ${item.diagnostico}</p>
        <p><strong>Trabajo Realizado:</strong> ${item.trabajo_realizado || 'Pendiente de ejecución'}</p>
        <p><strong>Costo Estimado/Total:</strong> $${total} MXN</p>
      </div>
      <button class="btn btn-secondary btn-sm" style="margin-top: 10px;" onclick="cargarExpedienteCompleto(${item.cliente_id})">Ver expediente completo de ${item.cliente_nombre}</button>
    `;
    contenedor.appendChild(card);
  });
}

// 5. Generar PDF / Nota imprimible
function imprimirNota(servicio) {
  if (!clienteDataGlobal) {
    alert('No hay información de cliente cargada.');
    return;
  }

  // Conversión explícita a Number para asegurar la búsqueda del vehículo
  const vehiculo = (clienteDataGlobal.vehiculos || []).find(v => Number(v.id) === Number(servicio.vehiculo_id)) || {};
  const total = (Number(servicio.costo_piezas) + Number(servicio.costo_mano_obra)).toFixed(2);

  const ventanaImpresion = window.open('', '_blank', 'width=800,height=700');

  const contenidoHTML = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Nota_de_Servicio_${servicio.id}_${clienteDataGlobal.nombre.replace(/\s+/g, '_')}</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 30px; color: #1e293b; line-height: 1.5; }
        .header { text-align: center; border-bottom: 2px solid #ff4500; padding-bottom: 12px; margin-bottom: 20px; }
        .header h1 { margin: 0; font-size: 24px; color: #ff4500; text-transform: uppercase; }
        .header p { margin: 3px 0; font-size: 13px; color: #64748b; }
        .folio { font-weight: bold; color: #ff4500; font-size: 14px; margin-top: 5px; }
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
        <h1>⚙️ TALLER EL TUERCAS — COMPROBANTE DE SERVICIO</h1>
        <p>Servicio Mecánico e Ingeniería Automotriz</p>
        <div class="folio">Orden N°: #${servicio.id} | Fecha: ${servicio.fecha}</div>
      </div>

      <div class="grid">
        <div class="box">
          <div class="box-title">👤 Datos del Cliente</div>
          <p><strong>Nombre:</strong> ${clienteDataGlobal.nombre}</p>
          <p><strong>Teléfono / WhatsApp:</strong> ${clienteDataGlobal.telefono}</p>
          <p><strong>Email:</strong> ${clienteDataGlobal.email || 'No registrado'}</p>
        </div>
        <div class="box">
          <div class="box-title">🚗 Datos del Vehículo</div>
          <p><strong>Vehículo:</strong> ${vehiculo.marca || ''} ${vehiculo.modelo || ''} (${vehiculo.anio || ''})</p>
          <p><strong>Placas / Matrícula:</strong> ${vehiculo.placas || 'N/A'}</p>
          <p><strong>Kilometraje:</strong> ${vehiculo.kilometraje ? vehiculo.kilometraje.toLocaleString() + ' km' : 'N/A'}</p>
        </div>
      </div>

      <div class="service-details">
        <div class="box-title">📋 Detalle del Servicio</div>
        <p><strong>Motivo de Ingreso / Falla Reportada:</strong> ${servicio.diagnostico}</p>
        <p><strong>Trabajo Realizado:</strong> ${servicio.trabajo_realizado || 'En diagnóstico'}</p>
        <p><strong>Estado Actual:</strong> <strong>${servicio.estado}</strong></p>
      </div>

      <table>
        <thead>
          <tr>
            <th>Concepto / Descripción</th>
            <th style="text-align: right; width: 140px;">Importe ($)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Refacciones y Consumibles</td>
            <td style="text-align: right;">$${Number(servicio.costo_piezas).toFixed(2)}</td>
          </tr>
          <tr>
            <td>Mano de Obra Especializada</td>
            <td style="text-align: right;">$${Number(servicio.costo_mano_obra).toFixed(2)}</td>
          </tr>
        </tbody>
      </table>

      <div class="total-container">
        <p>Total Importe: <span class="total-amount">$${total} MXN</span></p>
      </div>

      <div class="footer">
        <p>Gracias por su confianza. Taller El Tuercas.</p>
      </div>

      <script>
        window.onload = function() { window.print(); };
      </script>
    </body>
    </html>
  `;

  ventanaImpresion.document.write(contenidoHTML);
  ventanaImpresion.document.close();
}

// Controladores de Modales
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
  if (servicio) {
    document.getElementById('modal-srv-titulo').innerText = 'Editar Orden de Servicio';
    document.getElementById('srv-id').value = servicio.id;
    document.getElementById('srv-vehiculo-id').value = servicio.vehiculo_id;
    document.getElementById('srv-fecha').value = servicio.fecha;
    document.getElementById('srv-diagnostico').value = servicio.diagnostico;
    document.getElementById('srv-trabajo').value = servicio.trabajo_realizado;
    document.getElementById('srv-costo-piezas').value = servicio.costo_piezas;
    document.getElementById('srv-costo-obra').value = servicio.costo_mano_obra;
    document.getElementById('srv-estado').value = servicio.estado;
  } else {
    document.getElementById('modal-srv-titulo').innerText = 'Nueva Orden de Servicio';
    document.getElementById('srv-id').value = '';
    document.getElementById('srv-vehiculo-id').value = vehiculoId;
    document.getElementById('srv-fecha').value = new Date().toISOString().split('T')[0];
  }
  document.getElementById('modal-servicio').classList.remove('hidden');
}

function cerrarModales() {
  document.getElementById('modal-cliente').classList.add('hidden');
  document.getElementById('modal-vehiculo').classList.add('hidden');
  document.getElementById('modal-servicio').classList.add('hidden');
}