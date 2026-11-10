const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
// Definición del puerto para entorno local o producción en la nube
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar la base de datos SQLite
const db = new sqlite3.Database('taller.db', (err) => {
  if (err) console.error('Error al abrir la base de datos:', err.message);
  else console.log('Conexión exitosa a SQLite (taller.db).');
});

// Crear estructuras de tablas relacionales
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      telefono TEXT NOT NULL UNIQUE,
      email TEXT,
      notas TEXT,
      fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS vehiculos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER NOT NULL,
      marca TEXT NOT NULL,
      modelo TEXT NOT NULL,
      anio INTEGER NOT NULL,
      placas TEXT NOT NULL UNIQUE,
      kilometraje INTEGER DEFAULT 0,
      FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS servicios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vehiculo_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,
      diagnostico TEXT NOT NULL,
      trabajo_realizado TEXT,
      costo_piezas REAL DEFAULT 0,
      costo_mano_obra REAL DEFAULT 0,
      estado TEXT DEFAULT 'Pendiente',
      FOREIGN KEY (vehiculo_id) REFERENCES vehiculos(id) ON DELETE CASCADE
    )
  `);
});

// --- RUTAS DE CLIENTES ---

// 1. Buscar cliente por número de teléfono
app.get('/api/clientes/buscar', (req, res) => {
  const { telefono } = req.query;
  if (!telefono) return res.status(400).json({ error: 'Ingresa un número de teléfono.' });

  const sql = 'SELECT * FROM clientes WHERE telefono LIKE ? ORDER BY id DESC';
  db.all(sql, [`%${telefono}%`], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 2. Obtener expediente completo (Cliente + Vehículos + Servicios)
app.get('/api/clientes/:id/completo', (req, res) => {
  const clienteId = req.params.id;

  db.get('SELECT * FROM clientes WHERE id = ?', [clienteId], (err, cliente) => {
    if (err || !cliente) return res.status(404).json({ error: 'Cliente no encontrado.' });

    db.all('SELECT * FROM vehiculos WHERE cliente_id = ? ORDER BY id DESC', [clienteId], (err, vehiculos) => {
      if (err) return res.status(500).json({ error: err.message });

      if (vehiculos.length === 0) {
        return res.json({ ...cliente, vehiculos: [] });
      }

      const vehiculoIds = vehiculos.map(v => v.id);
      const placeholders = vehiculoIds.map(() => '?').join(',');

      db.all(`SELECT * FROM servicios WHERE vehiculo_id IN (${placeholders}) ORDER BY fecha DESC`, vehiculoIds, (err, servicios) => {
        if (err) return res.status(500).json({ error: err.message });

        const vehiculosConServicios = vehiculos.map(v => ({
          ...v,
          servicios: servicios.filter(s => s.vehiculo_id === v.id)
        }));

        res.json({ ...cliente, vehiculos: vehiculosConServicios });
      });
    });
  });
});

// 3. Registrar cliente
app.post('/api/clientes', (req, res) => {
  const { nombre, telefono, email, notas } = req.body;
  if (!nombre || !telefono) return res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });

  const sql = 'INSERT INTO clientes (nombre, telefono, email, notas) VALUES (?, ?, ?, ?)';
  db.run(sql, [nombre, telefono, email || '', notas || ''], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'El número de teléfono ya está registrado.' });
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, message: 'Cliente registrado correctamente.' });
  });
});

// 4. Modificar cliente
app.put('/api/clientes/:id', (req, res) => {
  const { nombre, telefono, email, notas } = req.body;
  const sql = 'UPDATE clientes SET nombre = ?, telefono = ?, email = ?, notas = ? WHERE id = ?';
  db.run(sql, [nombre, telefono, email, notas, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Cliente actualizado con éxito.' });
  });
});

// --- RUTAS DE VEHÍCULOS ---

app.post('/api/vehiculos', (req, res) => {
  const { cliente_id, marca, modelo, anio, placas, kilometraje } = req.body;
  const sql = 'INSERT INTO vehiculos (cliente_id, marca, modelo, anio, placas, kilometraje) VALUES (?, ?, ?, ?, ?, ?)';
  db.run(sql, [cliente_id, marca, modelo, anio, placas.toUpperCase(), kilometraje || 0], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Las placas ya están registradas.' });
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, message: 'Vehículo registrado.' });
  });
});

app.put('/api/vehiculos/:id', (req, res) => {
  const { marca, modelo, anio, placas, kilometraje } = req.body;
  const sql = 'UPDATE vehiculos SET marca = ?, modelo = ?, anio = ?, placas = ?, kilometraje = ? WHERE id = ?';
  db.run(sql, [marca, modelo, anio, placas.toUpperCase(), kilometraje, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Vehículo actualizado con éxito.' });
  });
});

// --- RUTAS DE SERVICIOS / ÓRDENES DE TRABAJO ---

app.post('/api/servicios', (req, res) => {
  const { vehiculo_id, fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado } = req.body;
  const fechaFinal = fecha || new Date().toISOString().split('T')[0];
  const sql = `INSERT INTO servicios (vehiculo_id, fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado)
               VALUES (?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [vehiculo_id, fechaFinal, diagnostico, trabajo_realizado || '', costo_piezas || 0, costo_mano_obra || 0, estado || 'Pendiente'], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID, message: 'Orden de servicio registrada.' });
  });
});

app.put('/api/servicios/:id', (req, res) => {
  const { fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado } = req.body;
  const sql = `UPDATE servicios SET fecha = ?, diagnostico = ?, trabajo_realizado = ?, costo_piezas = ?, costo_mano_obra = ?, estado = ?
               WHERE id = ?`;
  db.run(sql, [fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado, req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Servicio actualizado con éxito.' });
  });
});

// 5. OBTENER VEHÍCULOS Y CLIENTES FILTRADOS POR ESTADO DE SERVICIO
app.get('/api/servicios/estado/:estado', (req, res) => {
  const estado = req.params.estado;
  const sql = `
    SELECT 
      s.id AS servicio_id,
      s.fecha,
      s.diagnostico,
      s.trabajo_realizado,
      s.costo_piezas,
      s.costo_mano_obra,
      s.estado,
      v.id AS vehiculo_id,
      v.marca,
      v.modelo,
      v.anio,
      v.placas,
      v.kilometraje,
      c.id AS cliente_id,
      c.nombre AS cliente_nombre,
      c.telefono AS cliente_telefono
    FROM servicios s
    JOIN vehiculos v ON s.vehiculo_id = v.id
    JOIN clientes c ON v.cliente_id = c.id
    WHERE s.estado = ?
    ORDER BY s.id DESC
  `;

  db.all(sql, [estado], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.listen(PORT, () => {
  console.log(`Servidor activo en http://localhost:${PORT}`);
});