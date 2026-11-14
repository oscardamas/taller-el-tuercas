const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Carga segura de middlewares de seguridad (evita caídas si falta instalar alguno)
let helmet = null;
let rateLimit = null;
try { helmet = require('helmet'); } catch (e) { console.warn('Aviso: helmet no instalado, continuando sin él.'); }
try { rateLimit = require('express-rate-limit'); } catch (e) { console.warn('Aviso: express-rate-limit no instalado, continuando sin él.'); }

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'tuercas_secreto_super_seguro_2026';

// Confiar en el proxy inverso de Render para identificar correctamente las IPs
app.set('trust proxy', 1);

if (helmet) {
  app.use(helmet({ contentSecurityPolicy: false }));
}

// Limitar el tamaño máximo de los datos JSON recibidos
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Limitador de intentos para el Login (Protección contra fuerza bruta)
const loginLimiter = rateLimit
  ? rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Demasiados intentos fallidos. Por seguridad, espera 15 minutos.' }
    })
  : (req, res, next) => next();

// Detectar base de datos (PostgreSQL en Render o SQLite en local)
const rawDbUrl = process.env.DATABASE_URL;
const usePostgres = rawDbUrl && (rawDbUrl.startsWith('postgres://') || rawDbUrl.startsWith('postgresql://'));
let queryDB;

if (usePostgres) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: rawDbUrl,
    ssl: { rejectUnauthorized: false }
  });

  // Ejecutar cada tabla y columna de forma individual y segura
  (async () => {
    const comandosInit = [
      `CREATE TABLE IF NOT EXISTS clientes (id SERIAL PRIMARY KEY, nombre VARCHAR(255) NOT NULL, telefono VARCHAR(50) NOT NULL UNIQUE, email VARCHAR(255), notas TEXT, fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS vehiculos (id SERIAL PRIMARY KEY, cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE, marca VARCHAR(100) NOT NULL, modelo VARCHAR(100) NOT NULL, anio INTEGER NOT NULL, placas VARCHAR(50) NOT NULL UNIQUE, kilometraje INTEGER DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS servicios (id SERIAL PRIMARY KEY, vehiculo_id INTEGER NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE, fecha VARCHAR(50) NOT NULL, diagnostico TEXT NOT NULL, trabajo_realizado TEXT, costo_piezas NUMERIC(10,2) DEFAULT 0, costo_mano_obra NUMERIC(10,2) DEFAULT 0, estado VARCHAR(50) DEFAULT 'Pendiente', refacciones TEXT, creado_por VARCHAR(100), editado_por VARCHAR(100), proximo_servicio_fecha VARCHAR(50), proximo_servicio_km INTEGER DEFAULT 0, proximo_motivo TEXT, aviso_enviado INTEGER DEFAULT 0)`,
      `ALTER TABLE servicios ADD COLUMN IF NOT EXISTS refacciones TEXT`,
      `ALTER TABLE servicios ADD COLUMN IF NOT EXISTS creado_por VARCHAR(100)`,
      `ALTER TABLE servicios ADD COLUMN IF NOT EXISTS editado_por VARCHAR(100)`,
      `ALTER TABLE servicios ADD COLUMN IF NOT EXISTS proximo_servicio_fecha VARCHAR(50)`,
      `ALTER TABLE servicios ADD COLUMN IF NOT EXISTS proximo_servicio_km INTEGER DEFAULT 0`,
      `ALTER TABLE servicios ADD COLUMN IF NOT EXISTS proximo_motivo TEXT`,
      `ALTER TABLE servicios ADD COLUMN IF NOT EXISTS aviso_enviado INTEGER DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS usuarios (id SERIAL PRIMARY KEY, username VARCHAR(50) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL, rol VARCHAR(20) DEFAULT 'empleado')`
    ];

    for (const sql of comandosInit) {
      try {
        await pool.query(sql);
      } catch (err) {
        console.error('Aviso migración PostgreSQL:', err.message);
      }
    }
    console.log('PostgreSQL: Tablas, auditoría y alertas verificadas.');
    await crearAdminPorDefecto();
  })();

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
    db.run(`CREATE TABLE IF NOT EXISTS servicios (id INTEGER PRIMARY KEY AUTOINCREMENT, vehiculo_id INTEGER NOT NULL, fecha TEXT NOT NULL, diagnostico TEXT NOT NULL, trabajo_realizado TEXT, costo_piezas REAL DEFAULT 0, costo_mano_obra REAL DEFAULT 0, estado TEXT DEFAULT 'Pendiente', refacciones TEXT, creado_por TEXT, editado_por TEXT, proximo_servicio_fecha TEXT, proximo_servicio_km INTEGER DEFAULT 0, proximo_motivo TEXT, aviso_enviado INTEGER DEFAULT 0)`);
    db.run(`ALTER TABLE servicios ADD COLUMN refacciones TEXT`, () => {});
    db.run(`ALTER TABLE servicios ADD COLUMN creado_por TEXT`, () => {});
    db.run(`ALTER TABLE servicios ADD COLUMN editado_por TEXT`, () => {});
    db.run(`ALTER TABLE servicios ADD COLUMN proximo_servicio_fecha TEXT`, () => {});
    db.run(`ALTER TABLE servicios ADD COLUMN proximo_servicio_km INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE servicios ADD COLUMN proximo_motivo TEXT`, () => {});
    db.run(`ALTER TABLE servicios ADD COLUMN aviso_enviado INTEGER DEFAULT 0`, () => {});
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
    const users = await queryDB('SELECT id FROM usuarios LIMIT 1');
    if (users.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await queryDB('INSERT INTO usuarios (username, password, rol) VALUES ($1, $2, $3)', ['admin', hash, 'admin']);
      console.log('✅ Creado usuario administrador por defecto (User: admin | Pass: admin123)');
    }
  } catch (error) { console.error('Error comprobando admin:', error.message); }
}

// --- MIDDLEWARES DE SEGURIDAD ---
const verificarToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(403).json({ error: 'Acceso denegado. Inicia sesión.' });
  }
  
  const token = authHeader.split(' ')[1];
  jwt.verify(token, SECRET_KEY, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'Sesión expirada o inválida.' });
    req.usuario = decoded;
    next();
  });
};

const verificarAdmin = (req, res, next) => {
  if (!req.usuario || req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'No tienes permisos de Administrador.' });
  }
  next();
};

// --- RUTAS DE AUTENTICACIÓN Y USUARIOS ---
app.post('/api/login', loginLimiter, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  if (!username || !password) {
    return res.status(400).json({ error: 'Ingresa usuario y contraseña.' });
  }

  try {
    const users = await queryDB('SELECT * FROM usuarios WHERE username = $1', [username]);
    if (users.length === 0) return res.status(401).json({ error: 'Credenciales incorrectas.' });

    const user = users[0];
    const passwordValida = await bcrypt.compare(password, user.password);
    if (!passwordValida) return res.status(401).json({ error: 'Credenciales incorrectas.' });

    const token = jwt.sign({ id: user.id, username: user.username, rol: user.rol }, SECRET_KEY, { expiresIn: '12h' });
    res.json({ token, username: user.username, rol: user.rol });
  } catch (err) {
    console.error('Error en /api/login:', err.message);
    res.status(500).json({ error: 'Error interno al iniciar sesión.' });
  }
});

app.get('/api/usuarios', verificarToken, verificarAdmin, async (req, res) => {
  try {
    const users = await queryDB('SELECT id, username, rol FROM usuarios ORDER BY id DESC');
    res.json(users);
  } catch (err) {
    console.error('Error en GET /api/usuarios:', err.message);
    res.status(500).json({ error: 'Error al obtener la lista de usuarios.' });
  }
});

app.post('/api/usuarios', verificarToken, verificarAdmin, async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const rol = ['admin', 'empleado'].includes(req.body.rol) ? req.body.rol : 'empleado';

  if (username.length < 3 || username.length > 50) {
    return res.status(400).json({ error: 'El usuario debe tener entre 3 y 50 caracteres.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    await queryDB('INSERT INTO usuarios (username, password, rol) VALUES ($1, $2, $3)', [username, hash, rol]);
    res.json({ message: 'Usuario creado exitosamente.' });
  } catch (err) {
    console.error('Error en POST /api/usuarios:', err.message);
    res.status(400).json({ error: 'El nombre de usuario ya existe o los datos son inválidos.' });
  }
});

app.delete('/api/usuarios/:id', verificarToken, verificarAdmin, async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  if (isNaN(targetId)) return res.status(400).json({ error: 'ID de usuario inválido.' });

  try {
    if (targetId === Number(req.usuario.id)) {
      return res.status(400).json({ error: 'No puedes borrar tu propio usuario.' });
    }
    await queryDB('DELETE FROM usuarios WHERE id = $1', [targetId]);
    res.json({ message: 'Usuario eliminado.' });
  } catch (err) {
    console.error('Error en DELETE /api/usuarios:', err.message);
    res.status(500).json({ error: 'Error al eliminar el usuario.' });
  }
});

// --- RUTAS DEL SISTEMA ---
app.get('/api/clientes/buscar', verificarToken, async (req, res) => {
  const telefono = String(req.query.telefono || '').trim().replace(/[%_]/g, '');
  if (!telefono) return res.status(400).json({ error: 'Ingresa un número de teléfono válido.' });

  try {
    const rows = await queryDB('SELECT * FROM clientes WHERE telefono LIKE $1 ORDER BY id DESC LIMIT 20', [`%${telefono}%`]);
    res.json(rows);
  } catch (err) {
    console.error('Error en búsqueda:', err.message);
    res.status(500).json({ error: 'Error al buscar clientes.' });
  }
});

app.get('/api/clientes/:id/completo', verificarToken, async (req, res) => {
  const clienteId = parseInt(req.params.id, 10);
  if (isNaN(clienteId)) return res.status(400).json({ error: 'ID de cliente inválido.' });

  try {
    const clientes = await queryDB('SELECT * FROM clientes WHERE id = $1', [clienteId]);
    if (clientes.length === 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
    const cliente = clientes[0];
    const vehiculos = await queryDB('SELECT * FROM vehiculos WHERE cliente_id = $1 ORDER BY id DESC', [clienteId]);
    if (vehiculos.length === 0) return res.json({ ...cliente, vehiculos: [] });
    
    const vehiculoIds = vehiculos.map(v => Number(v.id));
    let servicios = [];
    if (usePostgres) {
      servicios = await queryDB('SELECT * FROM servicios WHERE vehiculo_id = ANY($1::int[]) ORDER BY fecha DESC, id DESC', [vehiculoIds]);
    } else {
      const placeholders = vehiculoIds.map(() => '?').join(',');
      servicios = await queryDB(`SELECT * FROM servicios WHERE vehiculo_id IN (${placeholders}) ORDER BY fecha DESC, id DESC`, vehiculoIds);
    }
    const vehiculosConServicios = vehiculos.map(v => ({
      ...v,
      servicios: servicios.filter(s => Number(s.vehiculo_id) === Number(v.id))
    }));
    res.json({ ...cliente, vehiculos: vehiculosConServicios });
  } catch (err) {
    console.error('Error en expediente:', err.message);
    res.status(500).json({ error: 'Error al cargar el expediente del cliente.' });
  }
});

app.post('/api/clientes', verificarToken, async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  const telefono = String(req.body.telefono || '').trim();
  const email = String(req.body.email || '').trim();
  const notas = String(req.body.notas || '').trim();

  if (!nombre || !telefono) {
    return res.status(400).json({ error: 'El nombre y el teléfono son obligatorios.' });
  }

  try {
    const rows = await queryDB('INSERT INTO clientes (nombre, telefono, email, notas) VALUES ($1, $2, $3, $4)', [nombre, telefono, email, notas]);
    res.json({ id: rows[0]?.id, message: 'Cliente registrado.' });
  } catch (err) {
    console.error('Error creando cliente:', err.message);
    if (err.message.toLowerCase().includes('unique')) {
      return res.status(400).json({ error: 'Ese número de teléfono ya está registrado.' });
    }
    res.status(500).json({ error: 'Error al registrar el cliente.' });
  }
});

app.put('/api/clientes/:id', verificarToken, async (req, res) => {
  const clienteId = parseInt(req.params.id, 10);
  const nombre = String(req.body.nombre || '').trim();
  const telefono = String(req.body.telefono || '').trim();
  const email = String(req.body.email || '').trim();
  const notas = String(req.body.notas || '').trim();

  if (isNaN(clienteId) || !nombre || !telefono) {
    return res.status(400).json({ error: 'Datos del cliente incompletos o inválidos.' });
  }

  try {
    await queryDB('UPDATE clientes SET nombre = $1, telefono = $2, email = $3, notas = $4 WHERE id = $5', [nombre, telefono, email, notas, clienteId]);
    res.json({ message: 'Cliente actualizado.' });
  } catch (err) {
    console.error('Error actualizando cliente:', err.message);
    if (err.message.toLowerCase().includes('unique')) {
      return res.status(400).json({ error: 'Ese número de teléfono ya pertenece a otro cliente.' });
    }
    res.status(500).json({ error: 'Error al actualizar el cliente.' });
  }
});

app.post('/api/vehiculos', verificarToken, async (req, res) => {
  const cliente_id = parseInt(req.body.cliente_id, 10);
  const marca = String(req.body.marca || '').trim();
  const modelo = String(req.body.modelo || '').trim();
  const anio = parseInt(req.body.anio, 10);
  const placas = String(req.body.placas || '').trim().toUpperCase();
  const kilometraje = Math.max(0, parseInt(req.body.kilometraje, 10) || 0);

  if (isNaN(cliente_id) || !marca || !modelo || isNaN(anio) || !placas) {
    return res.status(400).json({ error: 'Todos los campos marcados con * son obligatorios.' });
  }

  try {
    const rows = await queryDB('INSERT INTO vehiculos (cliente_id, marca, modelo, anio, placas, kilometraje) VALUES ($1, $2, $3, $4, $5, $6)', [cliente_id, marca, modelo, anio, placas, kilometraje]);
    res.json({ id: rows[0]?.id, message: 'Vehículo registrado.' });
  } catch (err) {
    console.error('Error registrando vehículo:', err.message);
    if (err.message.toLowerCase().includes('unique')) {
      return res.status(400).json({ error: 'Esas placas ya están registradas en el sistema.' });
    }
    res.status(500).json({ error: 'Error al registrar el vehículo.' });
  }
});

app.put('/api/vehiculos/:id', verificarToken, async (req, res) => {
  const vehId = parseInt(req.params.id, 10);
  const marca = String(req.body.marca || '').trim();
  const modelo = String(req.body.modelo || '').trim();
  const anio = parseInt(req.body.anio, 10);
  const placas = String(req.body.placas || '').trim().toUpperCase();
  const kilometraje = Math.max(0, parseInt(req.body.kilometraje, 10) || 0);

  if (isNaN(vehId) || !marca || !modelo || isNaN(anio) || !placas) {
    return res.status(400).json({ error: 'Datos del vehículo inválidos.' });
  }

  try {
    await queryDB('UPDATE vehiculos SET marca = $1, modelo = $2, anio = $3, placas = $4, kilometraje = $5 WHERE id = $6', [marca, modelo, anio, placas, kilometraje, vehId]);
    res.json({ message: 'Vehículo actualizado.' });
  } catch (err) {
    console.error('Error actualizando vehículo:', err.message);
    if (err.message.toLowerCase().includes('unique')) {
      return res.status(400).json({ error: 'Esas placas ya están registradas en otro vehículo.' });
    }
    res.status(500).json({ error: 'Error al actualizar el vehículo.' });
  }
});

// --- RUTAS DE ÓRDENES DE SERVICIO (CON AUDITORÍA Y RECORDATORIOS) ---
app.post('/api/servicios', verificarToken, async (req, res) => {
  const vehiculo_id = parseInt(req.body.vehiculo_id, 10);
  const fecha = String(req.body.fecha || new Date().toISOString().split('T')[0]).trim();
  const diagnostico = String(req.body.diagnostico || '').trim();
  const trabajo_realizado = String(req.body.trabajo_realizado || '').trim();
  const costo_piezas = Math.max(0, parseFloat(req.body.costo_piezas) || 0);
  const costo_mano_obra = Math.max(0, parseFloat(req.body.costo_mano_obra) || 0);
  const estadosValidos = ['Pendiente', 'En Proceso', 'Completado', 'Entregado'];
  const estado = estadosValidos.includes(req.body.estado) ? req.body.estado : 'Pendiente';
  const refacciones = typeof req.body.refacciones === 'string' ? req.body.refacciones : '[]';
  const creado_por = (req.usuario && req.usuario.username) ? req.usuario.username : 'usuario';

  const proximo_servicio_fecha = String(req.body.proximo_servicio_fecha || '').trim();
  const proximo_servicio_km = Math.max(0, parseInt(req.body.proximo_servicio_km, 10) || 0);
  const proximo_motivo = String(req.body.proximo_motivo || '').trim();

  if (isNaN(vehiculo_id)) {
    return res.status(400).json({ error: 'No se identificó el vehículo para esta orden.' });
  }
  if (!diagnostico) {
    return res.status(400).json({ error: 'El motivo de ingreso / falla es obligatorio.' });
  }

  try {
    const rows = await queryDB(
      `INSERT INTO servicios (vehiculo_id, fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado, refacciones, creado_por, proximo_servicio_fecha, proximo_servicio_km, proximo_motivo, aviso_enviado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0)`,
      [vehiculo_id, fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado, refacciones, creado_por, proximo_servicio_fecha, proximo_servicio_km, proximo_motivo]
    );
    res.json({ id: rows[0]?.id, message: 'Orden registrada.' });
  } catch (err) {
    console.error('Error registrando orden:', err.message);
    res.status(500).json({ error: `Error al guardar la orden (${err.code || 'DB'}).` });
  }
});

app.put('/api/servicios/:id', verificarToken, async (req, res) => {
  const srvId = parseInt(req.params.id, 10);
  const fecha = String(req.body.fecha || new Date().toISOString().split('T')[0]).trim();
  const diagnostico = String(req.body.diagnostico || '').trim();
  const trabajo_realizado = String(req.body.trabajo_realizado || '').trim();
  const costo_piezas = Math.max(0, parseFloat(req.body.costo_piezas) || 0);
  const costo_mano_obra = Math.max(0, parseFloat(req.body.costo_mano_obra) || 0);
  const estadosValidos = ['Pendiente', 'En Proceso', 'Completado', 'Entregado'];
  const estado = estadosValidos.includes(req.body.estado) ? req.body.estado : 'Pendiente';
  const refacciones = typeof req.body.refacciones === 'string' ? req.body.refacciones : '[]';
  const editado_por = (req.usuario && req.usuario.username) ? req.usuario.username : 'usuario';

  const proximo_servicio_fecha = String(req.body.proximo_servicio_fecha || '').trim();
  const proximo_servicio_km = Math.max(0, parseInt(req.body.proximo_servicio_km, 10) || 0);
  const proximo_motivo = String(req.body.proximo_motivo || '').trim();

  if (isNaN(srvId)) {
    return res.status(400).json({ error: 'ID de orden inválido.' });
  }
  if (!diagnostico) {
    return res.status(400).json({ error: 'El motivo de ingreso / falla es obligatorio.' });
  }

  try {
    await queryDB(
      `UPDATE servicios
       SET fecha = $1, diagnostico = $2, trabajo_realizado = $3, costo_piezas = $4, costo_mano_obra = $5,
           estado = $6, refacciones = $7, editado_por = $8, proximo_servicio_fecha = $9,
           proximo_servicio_km = $10, proximo_motivo = $11
       WHERE id = $12`,
      [fecha, diagnostico, trabajo_realizado, costo_piezas, costo_mano_obra, estado, refacciones, editado_por, proximo_servicio_fecha, proximo_servicio_km, proximo_motivo, srvId]
    );
    res.json({ message: 'Servicio actualizado.' });
  } catch (err) {
    console.error('Error actualizando orden:', err.message);
    res.status(500).json({ error: `Error al actualizar la orden (${err.code || 'DB'}).` });
  }
});

// --- RUTAS DE ALERTAS DE MANTENIMIENTO ---
app.get('/api/alertas/mantenimiento', verificarToken, async (req, res) => {
  const DIAS_ANTICIPACION = 15;
  const fechaLimiteObj = new Date();
  fechaLimiteObj.setDate(fechaLimiteObj.getDate() + DIAS_ANTICIPACION);
  const fechaLimite = fechaLimiteObj.toISOString().split('T')[0];

  try {
    const rows = await queryDB(
      `SELECT s.id AS servicio_id, s.fecha AS ultimo_servicio_fecha, s.diagnostico,
              s.proximo_servicio_fecha, s.proximo_servicio_km, s.proximo_motivo, s.aviso_enviado,
              v.id AS vehiculo_id, v.marca, v.modelo, v.anio, v.placas, v.kilometraje,
              c.id AS cliente_id, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
       FROM servicios s
       JOIN vehiculos v ON s.vehiculo_id = v.id
       JOIN clientes c ON v.cliente_id = c.id
       WHERE s.proximo_servicio_fecha IS NOT NULL
         AND s.proximo_servicio_fecha != ''
         AND s.proximo_servicio_fecha <= $1
       ORDER BY s.aviso_enviado ASC, s.proximo_servicio_fecha ASC`,
      [fechaLimite]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error obteniendo alertas:', err.message);
    res.status(500).json({ error: 'Error al consultar las alertas de mantenimiento.' });
  }
});

app.put('/api/servicios/:id/aviso-enviado', verificarToken, async (req, res) => {
  const srvId = parseInt(req.params.id, 10);
  const enviado = req.body.enviado ? 1 : 0;
  if (isNaN(srvId)) return res.status(400).json({ error: 'ID de servicio inválido.' });

  try {
    await queryDB('UPDATE servicios SET aviso_enviado = $1 WHERE id = $2', [enviado, srvId]);
    res.json({ message: 'Estado de recordatorio actualizado.' });
  } catch (err) {
    console.error('Error marcando aviso:', err.message);
    res.status(500).json({ error: 'Error al actualizar el estado del aviso.' });
  }
});

app.get('/api/servicios/estado/:estado', verificarToken, async (req, res) => {
  const estadosValidos = ['Pendiente', 'En Proceso', 'Completado', 'Entregado'];
  if (!estadosValidos.includes(req.params.estado)) {
    return res.status(400).json({ error: 'Estado de servicio no válido.' });
  }

  try {
    const rows = await queryDB(
      `SELECT s.id AS servicio_id, s.fecha, s.diagnostico, s.trabajo_realizado, s.costo_piezas, s.costo_mano_obra, s.estado, s.refacciones, s.creado_por, s.editado_por,
              v.id AS vehiculo_id, v.marca, v.modelo, v.anio, v.placas, v.kilometraje,
              c.id AS cliente_id, c.nombre AS cliente_nombre, c.telefono AS cliente_telefono
       FROM servicios s
       JOIN vehiculos v ON s.vehiculo_id = v.id
       JOIN clientes c ON v.cliente_id = c.id
       WHERE s.estado = $1
       ORDER BY s.id DESC`,
      [req.params.estado]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error filtrando por estado:', err.message);
    res.status(500).json({ error: 'Error al consultar órdenes por estado.' });
  }
});

app.listen(PORT, () => console.log(`Servidor seguro activo en puerto ${PORT}`));