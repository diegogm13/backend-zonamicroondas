// server.js (completo y corregido)
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();

// Configurar Cloudinary desde .env
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Forzar header JSON UTF-8 solo para rutas /api
app.use('/api', (req, res, next) => {
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});

// === Multer + CloudinaryStorage ===
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'news', // carpeta en Cloudinary
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    public_id: (req, file) => {
      const baseName = file.originalname.split('.')[0].replace(/\s+/g, '-').toLowerCase();
      return `news-${Date.now()}-${baseName}`;
    },
    transformation: [{ quality: 'auto' }]
  }
});

// Opcional: fileFilter para asegurar solo imágenes
const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp/;
  const ext = path.extname(file.originalname).toLowerCase();
  const mimetypeOk = allowed.test(file.mimetype);
  const extOk = allowed.test(ext);
  if (mimetypeOk && extOk) return cb(null, true);
  cb(new Error('Solo se permiten imágenes (jpg, png, webp, gif)'));
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter
});

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 3306,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  charset: 'utf8mb4',
  ssl: {
    rejectUnauthorized: false
  }
});


// ==================== NOTICIAS ====================

// GET /api/news - Obtener todas las noticias (con filtros opcionales)
app.get('/api/news', async (req, res) => {
  try {
    const { status, category_id, author_id, is_featured, limit = 50, offset = 0 } = req.query;
    
    let query = `
      SELECT n.*, 
            a.name AS author_name, 
            c.name AS category_name,
            c.slug AS category_slug,
            (
              SELECT ni.url 
              FROM news_images ni 
              WHERE ni.news_id = n.id 
              ORDER BY ni.position ASC 
              LIMIT 1
            ) AS image_url
      FROM news n
      LEFT JOIN authors a ON n.author_id = a.id
      LEFT JOIN categories c ON n.main_category_id = c.id
      WHERE 1=1
    `;
    let params = [];

    if (status) {
      query += ' AND n.status = ?';
      params.push(status);
    }
    if (category_id) {
      query += ' AND n.main_category_id = ?';
      params.push(parseInt(category_id, 10));
    }
    if (author_id) {
      query += ' AND n.author_id = ?';
      params.push(parseInt(author_id, 10));
    }
    if (typeof is_featured !== 'undefined') {
      query += ' AND n.is_featured = ?';
      params.push(parseInt(is_featured, 10));
    }

    const lim = parseInt(limit, 10) || 50;
    const off = parseInt(offset, 10) || 0;

    query += ' ORDER BY n.published_at DESC, n.created_at DESC LIMIT ? OFFSET ?';
    params.push(lim, off);

    const [rows] = await pool.execute(query, params);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (error) {
    console.error('GET /api/news error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/news/:id - Obtener una noticia específica con todas sus relaciones
app.get('/api/news/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const [news] = await pool.execute(`
      SELECT n.*, 
             a.name as author_name, a.email as author_email,
             c.name as category_name, c.slug as category_slug
      FROM news n
      LEFT JOIN authors a ON n.author_id = a.id
      LEFT JOIN categories c ON n.main_category_id = c.id
      WHERE n.id = ?
    `, [id]);

    if (news.length === 0) {
      return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
    }

    const [images] = await pool.execute(
      'SELECT * FROM news_images WHERE news_id = ? ORDER BY position',
      [id]
    );

    const [blocks] = await pool.execute(
      'SELECT * FROM news_blocks WHERE news_id = ? ORDER BY position',
      [id]
    );

    const [tags] = await pool.execute(`
      SELECT t.* FROM tags t
      INNER JOIN news_tags nt ON t.id = nt.tag_id
      WHERE nt.news_id = ?
    `, [id]);

    const [related] = await pool.execute(`
      SELECT n.*, nr.relation_type
      FROM news n
      INNER JOIN news_related nr ON n.id = nr.related_news_id
      WHERE nr.news_id = ?
    `, [id]);

    res.json({
      success: true,
      data: {
        ...news[0],
        images,
        blocks,
        tags,
        related
      }
    });
  } catch (error) {
    console.error('GET /api/news/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/news - Crear nueva noticia
app.post('/api/news', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const {
      title,
      subtitle,
      summary,
      author_id,
      main_category_id,
      status = 'draft',
      published_at,
      is_featured = 0,
      canonical_slug,
      tags = [],
      blocks = []
    } = req.body;

    const [result] = await connection.execute(`
      INSERT INTO news (title, subtitle, summary, author_id, main_category_id, 
                        status, published_at, is_featured, canonical_slug)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [title, subtitle, summary, author_id, main_category_id, 
        status, published_at, is_featured, canonical_slug]);

    const newsId = result.insertId;

    if (tags.length > 0) {
      const tagValues = tags.map(tagId => [newsId, tagId]);
      await connection.query(
        'INSERT INTO news_tags (news_id, tag_id) VALUES ?',
        [tagValues]
      );
    }

    if (blocks.length > 0) {
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        await connection.execute(`
          INSERT INTO news_blocks (news_id, type, content, media_url, alt_text, position)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [newsId, block.type, block.content, block.media_url, block.alt_text, i]);
      }
    }

    await connection.commit();
    res.status(201).json({ 
      success: true, 
      data: { id: newsId, message: 'Noticia creada exitosamente' }
    });
  } catch (error) {
    await connection.rollback();
    console.error('POST /api/news error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
});

// PUT /api/news/:id - Actualizar noticia existente
app.put('/api/news/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const {
      title,
      subtitle,
      summary,
      author_id,
      main_category_id,
      status,
      published_at,
      is_featured,
      canonical_slug,
      tags,
      blocks
    } = req.body;

    await connection.execute(`
      UPDATE news 
      SET title = ?, subtitle = ?, summary = ?, author_id = ?, 
          main_category_id = ?, status = ?, published_at = ?, 
          is_featured = ?, canonical_slug = ?
      WHERE id = ?
    `, [title, subtitle, summary, author_id, main_category_id, 
        status, published_at, is_featured, canonical_slug, id]);

    if (tags !== undefined) {
      await connection.execute('DELETE FROM news_tags WHERE news_id = ?', [id]);
      if (tags.length > 0) {
        const tagValues = tags.map(tagId => [id, tagId]);
        await connection.query(
          'INSERT INTO news_tags (news_id, tag_id) VALUES ?',
          [tagValues]
        );
      }
    }

    if (blocks !== undefined) {
      await connection.execute('DELETE FROM news_blocks WHERE news_id = ?', [id]);
      if (blocks.length > 0) {
        for (let i = 0; i < blocks.length; i++) {
          const block = blocks[i];
          await connection.execute(`
            INSERT INTO news_blocks (news_id, type, content, media_url, alt_text, position)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [id, block.type, block.content, block.media_url, block.alt_text, i]);
        }
      }
    }

    await connection.commit();
    res.json({ success: true, message: 'Noticia actualizada exitosamente' });
  } catch (error) {
    await connection.rollback();
    console.error('PUT /api/news/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
});

// DELETE /api/news/:id - Eliminar noticia
app.delete('/api/news/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [result] = await pool.execute('DELETE FROM news WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
    }

    res.json({ success: true, message: 'Noticia eliminada exitosamente' });
  } catch (error) {
    console.error('DELETE /api/news/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== IMÁGENES DE NOTICIAS ====================

// Helper: extraer public_id de Cloudinary desde la URL
function getPublicIdFromCloudinaryUrl(url) {
  try {
    // ej: https://res.cloudinary.com/<cloud>/image/upload/v123/news/news-12345.jpg
    const parts = url.split('/');
    const uploadIndex = parts.findIndex(p => p === 'upload');
    if (uploadIndex === -1) return null;

    let publicParts = parts.slice(uploadIndex + 1); // puede empezar con v123
    // remover versión si existe (v123)
    if (publicParts[0] && /^v\d+$/.test(publicParts[0])) publicParts.shift();

    // remove file extension from last part
    const last = publicParts.pop();
    const lastNoExt = last.replace(/\.[^/.]+$/, '');
    publicParts.push(lastNoExt);

    // join with '/'
    return publicParts.join('/');
  } catch (err) {
    return null;
  }
}

// POST /api/news/:id/images - Subir imagen a una noticia (Cloudinary)
app.post('/api/news/:id/images', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { caption, alt_text, position = 0 } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No se proporcionó imagen' });
    }

    // req.file.path contiene la URL pública de Cloudinary cuando se usa multer-storage-cloudinary
    const imageUrl = req.file.path;

    const [result] = await pool.execute(`
      INSERT INTO news_images (news_id, url, caption, alt_text, position)
      VALUES (?, ?, ?, ?, ?)
    `, [id, imageUrl, caption, alt_text, position]);

    res.status(201).json({ 
      success: true, 
      data: { 
        id: result.insertId, 
        url: imageUrl,
        message: 'Imagen subida exitosamente' 
      }
    });
  } catch (error) {
    console.error('POST /api/news/:id/images error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/news/:id/images - Obtener todas las imágenes de una noticia
app.get('/api/news/:id/images', async (req, res) => {
  try {
    const { id } = req.params;
    const [images] = await pool.execute(
      'SELECT * FROM news_images WHERE news_id = ? ORDER BY position',
      [id]
    );
    res.json({ success: true, data: images });
  } catch (error) {
    console.error('GET /api/news/:id/images error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/news/:newsId/images/:imageId - Eliminar imagen específica (DB + Cloudinary)
app.delete('/api/news/:newsId/images/:imageId', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { newsId, imageId } = req.params;

    // Primero obtener la URL para borrar en Cloudinary
    const [rows] = await connection.execute(
      'SELECT * FROM news_images WHERE id = ? AND news_id = ?',
      [imageId, newsId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Imagen no encontrada' });
    }
    const image = rows[0];
    const imageUrl = image.url;

    // Intentar eliminar en Cloudinary (si se puede obtener public_id)
    const publicId = getPublicIdFromCloudinaryUrl(imageUrl);
    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
      } catch (err) {
        // Si falla, seguimos para no bloquear la eliminación en BD
        console.error('Error al eliminar imagen en Cloudinary:', err);
      }
    }

    // Eliminar en BD
    const [result] = await connection.execute(
      'DELETE FROM news_images WHERE id = ?',
      [imageId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Imagen no encontrada al eliminar' });
    }

    res.json({ success: true, message: 'Imagen eliminada exitosamente' });
  } catch (error) {
    console.error('DELETE /api/news/:newsId/images/:imageId error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
});

// ==================== CATEGORÍAS ====================

// GET /api/categories - Obtener todas las categorías (ya existente)
app.get('/api/categories', async (req, res) => {
  try {
    const [categories] = await pool.execute(`
      SELECT c.*, 
             p.name as parent_name 
      FROM categories c
      LEFT JOIN categories p ON c.parent_id = p.id
      ORDER BY c.position, c.name
    `);
    res.json({ success: true, data: categories });
  } catch (error) {
    console.error('GET /api/categories error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/categories - Crear categoría o subcategoría
app.post('/api/categories', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { name, slug, parent_id = null, position = 0, description = null } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ success: false, error: 'name y slug son obligatorios' });
    }

    // si parent_id se proporcionó, verificar que exista
    if (parent_id !== null && parent_id !== '' && parent_id !== undefined) {
      const [parentRows] = await connection.execute('SELECT id FROM categories WHERE id = ?', [parent_id]);
      if (parentRows.length === 0) {
        return res.status(400).json({ success: false, error: 'parent_id no existe' });
      }
    }

    const [result] = await connection.execute(`
      INSERT INTO categories (name, slug, parent_id, position, description)
      VALUES (?, ?, ?, ?, ?)
    `, [name, slug, parent_id || null, position, description]);

    res.status(201).json({ success: true, data: { id: result.insertId, message: 'Categoría creada exitosamente' } });
  } catch (error) {
    console.error('POST /api/categories error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
});

// PUT /api/categories/:id - Actualizar categoría
app.put('/api/categories/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { name, slug, parent_id = null, position, description } = req.body;

    // verificar que la categoría exista
    const [existing] = await connection.execute('SELECT * FROM categories WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Categoría no encontrada' });
    }

    // prevenir que la categoría se ponga como su propio padre
    if (parent_id && parseInt(parent_id, 10) === parseInt(id, 10)) {
      return res.status(400).json({ success: false, error: 'parent_id no puede ser igual al id de la categoría' });
    }

    // si parent_id se proporcionó, verificar que exista
    if (parent_id !== null && parent_id !== '' && parent_id !== undefined) {
      const [parentRows] = await connection.execute('SELECT id FROM categories WHERE id = ?', [parent_id]);
      if (parentRows.length === 0) {
        return res.status(400).json({ success: false, error: 'parent_id no existe' });
      }
    }

    // actualizar (solo campos pasados)
    const fields = [];
    const params = [];

    if (name !== undefined) {
      fields.push('name = ?'); params.push(name);
    }
    if (slug !== undefined) {
      fields.push('slug = ?'); params.push(slug);
    }
    if (parent_id !== undefined) {
      fields.push('parent_id = ?'); params.push(parent_id || null);
    }
    if (position !== undefined) {
      fields.push('position = ?'); params.push(position);
    }
    if (description !== undefined) {
      fields.push('description = ?'); params.push(description);
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: 'No hay campos para actualizar' });
    }

    params.push(id);
    const sql = `UPDATE categories SET ${fields.join(', ')} WHERE id = ?`;
    await connection.execute(sql, params);

    res.json({ success: true, message: 'Categoría actualizada exitosamente' });
  } catch (error) {
    console.error('PUT /api/categories/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
});

// DELETE /api/categories/:id - Eliminar categoría (solo si no tiene hijos ni noticias)
app.delete('/api/categories/:id', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    // verificar existencia
    const [existing] = await connection.execute('SELECT id FROM categories WHERE id = ?', [id]);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Categoría no encontrada' });
    }

    // verificar si tiene subcategorías
    const [children] = await connection.execute('SELECT id FROM categories WHERE parent_id = ?', [id]);
    if (children.length > 0) {
      return res.status(400).json({ success: false, error: 'No se puede eliminar: la categoría tiene subcategorías' });
    }

    // verificar si tiene noticias asociadas (main_category_id)
    const [newsRows] = await connection.execute('SELECT id FROM news WHERE main_category_id = ? LIMIT 1', [id]);
    if (newsRows.length > 0) {
      return res.status(400).json({ success: false, error: 'No se puede eliminar: la categoría está asociada a noticias' });
    }

    // eliminar
    const [result] = await connection.execute('DELETE FROM categories WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      return res.status(500).json({ success: false, error: 'No se pudo eliminar la categoría' });
    }

    res.json({ success: true, message: 'Categoría eliminada exitosamente' });
  } catch (error) {
    console.error('DELETE /api/categories/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
});

// ==================== AUTORES ====================

app.get('/api/authors', async (req, res) => {
  try {
    const [authors] = await pool.execute('SELECT * FROM authors ORDER BY name');
    res.json({ success: true, data: authors });
  } catch (error) {
    console.error('GET /api/authors error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== TAGS ====================

app.get('/api/tags', async (req, res) => {
  try {
    const [tags] = await pool.execute('SELECT * FROM tags ORDER BY name');
    res.json({ success: true, data: tags });
  } catch (error) {
    console.error('GET /api/tags error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tags', async (req, res) => {
  try {
    const { name, slug } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO tags (name, slug) VALUES (?, ?)',
      [name, slug]
    );
    res.status(201).json({ 
      success: true, 
      data: { id: result.insertId, message: 'Tag creado exitosamente' }
    });
  } catch (error) {
    console.error('POST /api/tags error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SERVIDOR ====================

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 API disponible en http://localhost:${PORT}/api`);
});

// Manejo de errores no capturados
process.on('unhandledRejection', (err) => {
  console.error('Error no manejado:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Exception no capturada:', err);
  // opcional: process.exit(1);
});

module.exports = app;

