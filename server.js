const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'tuercas_secreto_super_seguro_2026';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Detectar base de datos
const rawDbUrl = process.env.DATABASE_URL;
const usePostgres = rawDbUrl && (rawDbUrl.startsWith('postgres://') || rawDbUrl.startsWith('postgresql://'));
let queryDB;

if (usePostgres) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: rawDbUrl,
    ssl: { rejectUnauthorized: false }
  });

  pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (id SERIAL PRIMARY KEY, nombre VARCHAR(255) NOT NULL, telefono VARCHAR(50) NOT NULL UNIQUE, email VARCHAR(255), notas TEXT, fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS vehiculos (id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE, marca VARCHAR(100) NOT NULL, modelo VARCHAR(100) NOT NULL, anio INTEGER NOT NULL, placas VARCHAR(50) NOT NULL UNIQUE, kilometraje INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS servicios (id SERIAL PRIMARY KEY, vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE, fecha VARCHAR(50) NOT NULL, diagnostico TEXT NOT NULL, trabajo_realizado TEXT, costo_piezas NUMERIC(10,2) DEFAULT 0, costo_mano_obra NUMERIC(10,2) DEFAULT 0, estado VARCHAR(50) DEFAULT 'Pendiente', refacciones TEXT);
    CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL, rol VARCHAR(20) DEFAULT 'empleado');
  `).then(async () => {
    console.log('PostgreSQL: Tablas verificadas.');
    crearAdminPorDefecto();
  }).catch(err => console.error('Error DB:', err.message));

  queryDB = async (text, params = []) => {
    let queryText = text;
    if (queryText.trim().toUpperCase().startsWith('INSERT') && !queryText.toUpperCase().includes('RETURNING')) {
      queryText += ' RETURNING id';
    }
    const res = await pool.query(queryText, params);
    return res.rows;
  };
} else {
  const sqlite3 = require('sqlite3').verbose();
  const db = new sqlite3.Database('taller.db');

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, telefono TEXT NOT NULL UNIQUE, email TEXT, notas TEXT, fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS vehiculos (id INTEGER PRIMARY KEY AUTOINCREMENT, cliente_id INTEGER NOT NULL, marca TEXT NOT NULL, modelo TEXT NOT NULL, anio INTEGER NOT NULL, placas TEXT NOT NULL UNIQUE, kilometraje INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS servicios (id INTEGER PRIMARY KEY AUTOINCREMENT, vehiculo_id INTEGER NOT NULL, fecha TEXT NOT NULL, diagnostico TEXT NOT NULL, trabajo_realizado TEXT, costo_piezas REAL DEFAULT 0, costo_mano_obra REAL DEFAULT 0, estado TEXT DEFAULT 'Pendiente', refacciones TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL, rol TEXT DEFAULT 'empleado')`, () => {
      crearAdminPorDefecto();
    });
  });

  queryDB = (text, params = []) => {
    return new Promise((resolve, reject) => {
      const sql = text.replace(/\$\d+/g, '?');
      if (text.trim().toUpperCase().startsWith('INSERT')) {
        db.run(sql, params, function (err) { err ? reject(err) : resolve([{ id: this.lastID }]); });
      } else if (text.trim().toUpperCase().startsWith('UPDATE') || text.trim().toUpperCase().startsWith('DELETE')) {
        db.run(sql, params, function (err) { err ? reject(err) : resolve([]); });
      } else {
        db.all(sql, params, (err, rows) => { err ? reject(err) : resolve(rows); });
      }
    });
  };
}

// Función para crear el administrador maestro si no hay usuarios
async function crearAdminPorDefecto() {
  try {
    const users = await queryDB('SELECT * FROM usuarios');
    if (users.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await queryDB('INSERT INTO usuarios (username, password, rol) VALUES ($1, $2, $3)', ['admin', hash, 'admin']);
      console.log('✅ Creado usuario administrador por defecto (User: admin | Pass: admin123)');
    }
  } catch (error) { console.error('Error comprobando admin:', error); }
}

// --- MIDDLEWARES DE SEGURIDAD ---
const verificarToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(403).json({ error: 'Acceso denegado. Inicia sesión.' });
  
  const token = authHeader.split(' ')[1];
  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Sesión expirada o inválida.' });
    req.usuario = decoded; // Guardamos los datos del usuario para usarlos en las rutas
    next();
  });
};

const verificarAdmin = (req, res, next) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'No tienes permisos de Administrador.' });
  next();
};

// --- RUTAS DE AUTENTICACIÓN Y USUARIOS ---
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const users = await queryDB('SELECT * FROM usuarios WHERE username = $1', [username]);
    if (users.length === 0) return res.status(401).json({ error: 'Credenciales incorrectas.' });

    const user = users[0];
    const passwordValida = await bcrypt.compare(password, user.password);
    if (!passwordValida) return res.status(401).json({ error: 'Credenciales incorrectas.' });

    const token = jwt.sign({ id: user.id, username: user.username, rol: user.rol }, SECRET_KEY, { expiresIn: '12h' });
    res.json({ token, username: user.username, rol: user.rol });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/usuarios', verificarToken, verificarAdmin, async (req, res) => {
  try {
    const users = await queryDB('SELECT id, username, rol FROM usuarios ORDER BY id DESC');
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/usuarios', verificarToken, verificarAdmin, async (req, res) => {
  const { username, password, rol } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await queryDB('INSERT INTO usuarios (username, password, rol) VALUES ($1, $2, $3)', [username, hash, rol || 'empleado']);
    res.json({ message: 'Usuario creado exitosamente.' });
  } catch (err) {
    res.status(500).json({ error: 'El usuario ya existe o hubo un error.' });
  }
});

app.delete('/api/usuarios/:id', verificarToken, verificarAdmin, async (req, res) => {
  try {
    // Evitar que el admin se borre a sí mismo
    if (Number(req.params.id) === Number(req.usuario.id)) {
      return res.status(400).json({ error: 'No puedes borrar tu propio usuario.' });
    }
    await queryDB('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
    res.json({ message: 'Usuario eliminado.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- RUTAS DEL SISTEMA (AHORA TODAS PROTEGIDAS CON verificarToken) ---
app.get('/api/clientes/buscar', verificarToken, async (req, res) => {
  const { telefono } = req.query;
  try {
    const rows = await queryDB('SELECT * FROM clientes WHERE telefono LIKE $1 ORDER BY id DESC', [`%${telefono}%`]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/clientes/:id/completo', verificarToken, async (req, res) => {
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
    const vehiculosConServicios = vehiculos.map(v => ({ ...v, servicios: servicios.filter(s => s.vehiculo_id === v.id) }));
    res.json({ ...cliente, vehiculos: vehiculosConServicios });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/clientes', verificarToken, async (req, res) => {
  const { nombre, telefono, email, notas } = req.body;
  try {
    const rows = await queryDB('INSERT INTO clientes (nombre, telefono, email, notas) VALUES ($1, $2, $3, $4)', [nombre, telefono, email || '', notas || '']);
    res.json({ id: rows[0]?.id, message: 'Cliente registrado.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/clientes/:id', verificarToken, async (req, res) => {
  const { nombre, telefono, email, notas } = req.body;
  try {
    await queryDB('UPDATE clientes SET nombre = $1, telefono = $2, email = $3, notas = $4 WHERE id = $5', [nombre, telefono, email, notas, req.params.id]);
    res.json({ message: 'Cliente actualizado.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/vehiculos', verificarToken, async (req, res) => {
  const { cliente_id, marca, modelo, anio, placas, kilometraje } = req.body;
  try {
    const rows = await queryDB('INSERT INTO vehiculos (cliente_id, marca, modelo, anio, placas, kilometraje) VALUES ($1, $2, $3, $4, $5, $6)', [cliente_id, marca, modelo, anio, placas.toUpperCase(), kilometraje || 0]);
    res.json({ id: rows[0]?.id, message: 'Vehículo registrado.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/vehiculos/:id', verificarToken, async (req, res) => {
  const { marca, modelo, anio, placas, kilometraje } = req.body;
  try {
    await queryDB('UPDATE vehiculos SET marca = $1, modelo = $2, anio = $3, placas = $4, kilometraje = $5 WHERE id = $6', [marca, modelo, anio, placas.toUpperCase(), kilometraje, req.params.id]);
    res.json({ message: 'Vehículo actualizado.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/servicios', verificarToken, async (req, res) => {
  const { vehiculo_id, fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado, refacciones } = req.body;
  try {
    const rows = await queryDB(`INSERT INTO servicios (vehiculo_id, fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado, refacciones) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [vehiculo_id, fecha || new Date().toISOString().split('T')[0], diagnostico, trabajo_realizado || '', costo_piezas || 0, costo_mano_obra || 0, estado || 'Pendiente', refacciones || '[]']);
    res.json({ id: rows[0]?.id, message: 'Orden registrada.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/servicios/:id', verificarToken, async (req, res) => {
  const { fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado, refacciones } = req.body;
  try {
    await queryDB(`UPDATE servicios SET fecha = $1, diagnostico = $2, trabajo_realizado = $3, costo_piezas = $4, costo_mano_obra = $5, estado = $6, refacciones = $7 WHERE id = $8`, [fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado, refacciones || '[]', req.params.id]);
    res.json({ message: 'Servicio actualizado.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/servicios/estado/:estado', verificarToken, async (req, res) => {
  try {
    const rows = await queryDB(`SELECT s.id AS servicio_id, s.fecha, s.diagnostico, s.trabajo_realizado, s.costo_piezas, s.costo_mano_obra, s.estado, s.refacciones, v.id AS vehiculo_id, v.marca, v.modelo, v.anio, v.placas, v.kilometraje, c.id AS cliente_id, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono FROM servicios s JOIN vehiculos v ON s.vehiculo_id = v.id JOIN clientes c ON v.cliente_id = c.id WHERE s.estado = $1 ORDER BY s.id DESC`, [req.params.estado]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));