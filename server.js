const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Detectar DATABASE_URL aceptando prefijos postgres:// y postgresql://
const rawDbUrl = process.env.DATABASE_URL;
const usePostgres = rawDbUrl && (rawDbUrl.startsWith('postgres://') || rawDbUrl.startsWith('postgresql://'));
let queryDB;

if (usePostgres) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: rawDbUrl,
    ssl: { rejectUnauthorized: false }
  });

  // Creación automática de tablas si no existen en PostgreSQL
  pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      nombre VARCHAR(255) NOT NULL,
      telefono VARCHAR(50) NOT NULL UNIQUE,
      email VARCHAR(255),
      notas TEXT,
      fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vehiculos (
      id SERIAL PRIMARY KEY,
      cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      marca VARCHAR(100) NOT NULL,
      modelo VARCHAR(100) NOT NULL,
      anio INTEGER NOT NULL,
      placas VARCHAR(50) NOT NULL UNIQUE,
      kilometraje INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS servicios (
      id SERIAL PRIMARY KEY,
      vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
      fecha VARCHAR(50) NOT NULL,
      diagnostico TEXT NOT NULL,
      trabajo_realizado TEXT,
      costo_piezas NUMERIC(10,2) DEFAULT 0,
      costo_mano_obra NUMERIC(10,2) DEFAULT 0,
      estado VARCHAR(50) DEFAULT 'Pendiente'
    );
  `).then(() => console.log('Modo Producción: Conectado exitosamente a PostgreSQL en Render.'))
    .catch(err => console.error('Error al inicializar tablas en PostgreSQL:', err.message));

  queryDB = async (text, params = []) => {
    let queryText = text;
    if (queryText.trim().toUpperCase().startsWith('INSERT') && !queryText.toUpperCase().includes('RETURNING')) {
      queryText += ' RETURNING id';
    }
    const res = await pool.query(queryText, params);
    return res.rows;
  };
} else {
  // Modo de respaldo en SQLite para desarrollo local
  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database('taller.db', (err) => {
    if (err) console.error('Error al abrir SQLite local:', err.message);
    else console.log('Modo Local: Conectado a SQLite (taller.db).');
  });

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, telefono TEXT NOT NULL UNIQUE, email TEXT, notas TEXT, fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS vehiculos (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER NOT NULL, marca TEXT NOT NULL, modelo TEXT NOT NULL, anio INTEGER NOT NULL, placas TEXT NOT NULL UNIQUE, kilometraje INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS servicios (id INTEGER PRIMARY KEY AUTOINCREMENT, vehiculo_id INTEGER NOT NULL, fecha TEXT NOT NULL, diagnostico TEXT NOT NULL, trabajo_realizado TEXT, costo_piezas REAL DEFAULT 0, costo_mano_obra REAL DEFAULT 0, estado TEXT DEFAULT 'Pendiente')`);
  });

  queryDB = (text, params = []) => {
    return new Promise((resolve, reject) => {
      const sql = text.replace(/\$\d+/g, '?');
      if (text.trim().toUpperCase().startsWith('INSERT')) {
        db.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve([{ id: this.lastID }]);
        });
      } else if (text.trim().toUpperCase().startsWith('UPDATE') || text.trim().toUpperCase().startsWith('DELETE')) {
        db.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve([]);
        });
      } else {
        db.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      }
    });
  };
}

// --- RUTAS API REST ---

app.get('/api/clientes/buscar', async (req, res) => {
  const { telefono } = req.query;
  if (!telefono) return res.status(400).json({ error: 'Ingresa un número de teléfono.' });
  try {
    const rows = await queryDB('SELECT * FROM clientes WHERE telefono LIKE $1 ORDER BY id DESC', [`%${telefono}%`]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clientes/:id/completo', async (req, res) => {
  const clienteId = req.params.id;
  try {
    const clientes = await queryDB('SELECT * FROM clientes WHERE id = $1', [clienteId]);
    if (clientes.length === 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
    const cliente = clientes[0];
    const vehiculos = await queryDB('SELECT * FROM vehiculos WHERE cliente_id = $1 ORDER BY id DESC', [clienteId]);

    if (vehiculos.length === 0) return res.json({ ...cliente, vehiculos: [] });

    const vehiculoIds = vehiculos.map(v => v.id);
    let servicios = [];
    if (usePostgres) {
      servicios = await queryDB('SELECT * FROM servicios WHERE vehiculo_id = ANY($1::int[]) ORDER BY fecha DESC', [vehiculoIds]);
    } else {
      const placeholders = vehiculoIds.map(() => '?').join(',');
      servicios = await queryDB(`SELECT * FROM servicios WHERE vehiculo_id IN (${placeholders}) ORDER BY fecha DESC`, vehiculoIds);
    }

    const vehiculosConServicios = vehiculos.map(v => ({
      ...v,
      servicios: servicios.filter(s => s.vehiculo_id === v.id)
    }));
    res.json({ ...cliente, vehiculos: vehiculosConServicios });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clientes', async (req, res) => {
  const { nombre, telefono, email, notas } = req.body;
  if (!nombre || !telefono) return res.status(400).json({ error: 'Nombre y teléfono son obligatorios.' });
  try {
    const rows = await queryDB(
      'INSERT INTO clientes (nombre, telefono, email, notas) VALUES ($1, $2, $3, $4)',
      [nombre, telefono, email || '', notas || '']
    );
    res.json({ id: rows[0]?.id, message: 'Cliente registrado correctamente.' });
  } catch (err) {
    if (err.message.includes('unique') || err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'El número de teléfono ya está registrado.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clientes/:id', async (req, res) => {
  const { nombre, telefono, email, notas } = req.body;
  try {
    await queryDB('UPDATE clientes SET nombre = $1, telefono = $2, email = $3, notas = $4 WHERE id = $5', [nombre, telefono, email, notas, req.params.id]);
    res.json({ message: 'Cliente actualizado con éxito.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/vehiculos', async (req, res) => {
  const { cliente_id, marca, modelo, anio, placas, kilometraje } = req.body;
  try {
    const rows = await queryDB(
      'INSERT INTO vehiculos (cliente_id, marca, modelo, anio, placas, kilometraje) VALUES ($1, $2, $3, $4, $5, $6)',
      [cliente_id, marca, modelo, anio, placas.toUpperCase(), kilometraje || 0]
    );
    res.json({ id: rows[0]?.id, message: 'Vehículo registrado.' });
  } catch (err) {
    if (err.message.includes('unique') || err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Las placas ya están registradas.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/vehiculos/:id', async (req, res) => {
  const { marca, modelo, anio, placas, kilometraje } = req.body;
  try {
    await queryDB('UPDATE vehiculos SET marca = $1, modelo = $2, anio = $3, placas = $4, kilometraje = $5 WHERE id = $6', [marca, modelo, anio, placas.toUpperCase(), kilometraje, req.params.id]);
    res.json({ message: 'Vehículo actualizado con éxito.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/servicios', async (req, res) => {
  const { vehiculo_id, fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado } = req.body;
  const fechaFinal = fecha || new Date().toISOString().split('T')[0];
  try {
    const rows = await queryDB(
      `INSERT INTO servicios (vehiculo_id, fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [vehiculo_id, fechaFinal, diagnostico, trabajo_realizado || '', costo_piezas || 0, costo_mano_obra || 0, estado || 'Pendiente']
    );
    res.json({ id: rows[0]?.id, message: 'Orden de servicio registrada.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/servicios/:id', async (req, res) => {
  const { fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado } = req.body;
  try {
    await queryDB(
      `UPDATE servicios SET fecha = $1, diagnostico = $2, trabajo_realizado = $3, costo_piezas = $4, costo_mano_obra = $5, estado = $6 WHERE id = $7`,
      [fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado, req.params.id]
    );
    res.json({ message: 'Servicio actualizado con éxito.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/servicios/estado/:estado', async (req, res) => {
  const estado = req.params.estado;
  const sql = `
    SELECT 
      s.id AS servicio_id, s.fecha, s.diagnostico, s.trabajo_realizado, s.costo_piezas, s.costo_mano_obra, s.estado,
      v.id AS vehiculo_id, v.marca, v.modelo, v.anio, v.placas, v.kilometraje,
      c.id AS cliente_id, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
    FROM servicios s
    JOIN vehiculos v ON s.vehiculo_id = v.id
    JOIN clientes c ON v.cliente_id = c.id
    WHERE s.estado = $1
    ORDER BY s.id DESC
  `;
  try {
    const rows = await queryDB(sql, [estado]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor activo en el puerto ${PORT}`);
});