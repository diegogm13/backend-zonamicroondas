// server.js (Migrado a Supabase)
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
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

// Inicializar Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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
    folder: 'news',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    public_id: (req, file) => {
      const baseName = file.originalname.split('.')[0].replace(/\s+/g, '-').toLowerCase();
      return `news-${Date.now()}-${baseName}`;
    },
    transformation: [{ quality: 'auto' }]
  }
});

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
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter
});

// ==================== NOTICIAS ====================

// GET /api/news - Obtener todas las noticias (con filtros opcionales)
app.get('/api/news', async (req, res) => {
  try {
    const { status, category_id, author_id, is_featured, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('news')
      .select(`
        *,
        authors(name),
        categories(name, slug),
        news_images(url, position)
      `);

    if (status) {
      query = query.eq('status', status);
    }
    if (category_id) {
      query = query.eq('main_category_id', parseInt(category_id, 10));
    }
    if (author_id) {
      query = query.eq('author_id', parseInt(author_id, 10));
    }
    if (typeof is_featured !== 'undefined') {
      query = query.eq('is_featured', parseInt(is_featured, 10));
    }

    const lim = parseInt(limit, 10) || 50;
    const off = parseInt(offset, 10) || 0;

    query = query
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(off, off + lim - 1);

    const { data, error } = await query;

    if (error) throw error;

    // Mapear imagen principal
    const mappedData = data.map(item => ({
      ...item,
      author_name: item.authors?.name,
      category_name: item.categories?.name,
      category_slug: item.categories?.slug,
      image_url: item.news_images?.[0]?.url
    }));

    res.json({ success: true, data: mappedData, count: mappedData.length });
  } catch (error) {
    console.error('GET /api/news error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/news/:id - Obtener una noticia específica con todas sus relaciones
app.get('/api/news/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: news, error } = await supabase
      .from('news')
      .select(`
        *,
        authors(name, email),
        categories(name, slug)
      `)
      .eq('id', id)
      .single();

    if (error || !news) {
      return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
    }

    const { data: images } = await supabase
      .from('news_images')
      .select('*')
      .eq('news_id', id)
      .order('position', { ascending: true });

    const { data: blocks } = await supabase
      .from('news_blocks')
      .select('*')
      .eq('news_id', id)
      .order('position', { ascending: true });

    const { data: tags } = await supabase
      .from('news_tags')
      .select('tags(*)')
      .eq('news_id', id);

    const { data: related } = await supabase
      .from('news_related')
      .select('news(*), relation_type')
      .eq('news_id', id);

    res.json({
      success: true,
      data: {
        ...news,
        author_name: news.authors?.name,
        author_email: news.authors?.email,
        category_name: news.categories?.name,
        category_slug: news.categories?.slug,
        images: images || [],
        blocks: blocks || [],
        tags: tags?.map(t => t.tags) || [],
        related: related || []
      }
    });
  } catch (error) {
    console.error('GET /api/news/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/news - Crear nueva noticia
app.post('/api/news', async (req, res) => {
  try {
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

    const { data: newsData, error: newsError } = await supabase
      .from('news')
      .insert([{
        title,
        subtitle,
        summary,
        author_id,
        main_category_id,
        status,
        published_at,
        is_featured,
        canonical_slug
      }])
      .select()
      .single();

    if (newsError) throw newsError;

    const newsId = newsData.id;

    if (tags.length > 0) {
      const tagValues = tags.map(tagId => ({ news_id: newsId, tag_id: tagId }));
      const { error: tagsError } = await supabase
        .from('news_tags')
        .insert(tagValues);
      if (tagsError) throw tagsError;
    }

    if (blocks.length > 0) {
      const blockValues = blocks.map((block, i) => ({
        news_id: newsId,
        type: block.type,
        content: block.content,
        media_url: block.media_url,
        alt_text: block.alt_text,
        position: i
      }));
      const { error: blocksError } = await supabase
        .from('news_blocks')
        .insert(blockValues);
      if (blocksError) throw blocksError;
    }

    res.status(201).json({
      success: true,
      data: { id: newsId, message: 'Noticia creada exitosamente' }
    });
  } catch (error) {
    console.error('POST /api/news error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/news/:id - Actualizar noticia existente
app.put('/api/news/:id', async (req, res) => {
  try {
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

    const updateData = {};
    if (title !== undefined) updateData.title = title;
    if (subtitle !== undefined) updateData.subtitle = subtitle;
    if (summary !== undefined) updateData.summary = summary;
    if (author_id !== undefined) updateData.author_id = author_id;
    if (main_category_id !== undefined) updateData.main_category_id = main_category_id;
    if (status !== undefined) updateData.status = status;
    if (published_at !== undefined) updateData.published_at = published_at;
    if (is_featured !== undefined) updateData.is_featured = is_featured;
    if (canonical_slug !== undefined) updateData.canonical_slug = canonical_slug;

    const { error: updateError } = await supabase
      .from('news')
      .update(updateData)
      .eq('id', id);

    if (updateError) throw updateError;

    if (tags !== undefined) {
      await supabase
        .from('news_tags')
        .delete()
        .eq('news_id', id);

      if (tags.length > 0) {
        const tagValues = tags.map(tagId => ({ news_id: id, tag_id: tagId }));
        const { error: tagsError } = await supabase
          .from('news_tags')
          .insert(tagValues);
        if (tagsError) throw tagsError;
      }
    }

    if (blocks !== undefined) {
      await supabase
        .from('news_blocks')
        .delete()
        .eq('news_id', id);

      if (blocks.length > 0) {
        const blockValues = blocks.map((block, i) => ({
          news_id: id,
          type: block.type,
          content: block.content,
          media_url: block.media_url,
          alt_text: block.alt_text,
          position: i
        }));
        const { error: blocksError } = await supabase
          .from('news_blocks')
          .insert(blockValues);
        if (blocksError) throw blocksError;
      }
    }

    res.json({ success: true, message: 'Noticia actualizada exitosamente' });
  } catch (error) {
    console.error('PUT /api/news/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/news/:id - Eliminar noticia
app.delete('/api/news/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase
      .from('news')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: 'Noticia eliminada exitosamente' });
  } catch (error) {
    console.error('DELETE /api/news/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== IMÁGENES DE NOTICIAS ====================

function getPublicIdFromCloudinaryUrl(url) {
  try {
    const parts = url.split('/');
    const uploadIndex = parts.findIndex(p => p === 'upload');
    if (uploadIndex === -1) return null;

    let publicParts = parts.slice(uploadIndex + 1);
    if (publicParts[0] && /^v\d+$/.test(publicParts[0])) publicParts.shift();

    const last = publicParts.pop();
    const lastNoExt = last.replace(/\.[^/.]+$/, '');
    publicParts.push(lastNoExt);

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

    const imageUrl = req.file.path;

    const { data: imageData, error } = await supabase
      .from('news_images')
      .insert([{
        news_id: parseInt(id, 10),
        url: imageUrl,
        caption,
        alt_text,
        position: parseInt(position, 10)
      }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data: {
        id: imageData.id,
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
    const { data: images, error } = await supabase
      .from('news_images')
      .select('*')
      .eq('news_id', id)
      .order('position', { ascending: true });

    if (error) throw error;

    res.json({ success: true, data: images || [] });
  } catch (error) {
    console.error('GET /api/news/:id/images error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/news/:newsId/images/:imageId - Eliminar imagen específica
app.delete('/api/news/:newsId/images/:imageId', async (req, res) => {
  try {
    const { newsId, imageId } = req.params;

    const { data: imageData, error: selectError } = await supabase
      .from('news_images')
      .select('*')
      .eq('id', imageId)
      .eq('news_id', newsId)
      .single();

    if (selectError || !imageData) {
      return res.status(404).json({ success: false, error: 'Imagen no encontrada' });
    }

    const publicId = getPublicIdFromCloudinaryUrl(imageData.url);
    if (publicId) {
      try {
        await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
      } catch (err) {
        console.error('Error al eliminar imagen en Cloudinary:', err);
      }
    }

    const { error: deleteError } = await supabase
      .from('news_images')
      .delete()
      .eq('id', imageId);

    if (deleteError) throw deleteError;

    res.json({ success: true, message: 'Imagen eliminada exitosamente' });
  } catch (error) {
    console.error('DELETE /api/news/:newsId/images/:imageId error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== CATEGORÍAS ====================

// GET /api/categories
app.get('/api/categories', async (req, res) => {
  try {
    const { data: categories, error } = await supabase
      .from('categories')
      .select(`
        *,
        parent:parent_id(name)
      `)
      .order('position', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw error;

    const mappedData = categories.map(cat => ({
      ...cat,
      parent_name: cat.parent?.name
    }));

    res.json({ success: true, data: mappedData });
  } catch (error) {
    console.error('GET /api/categories error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/categories
app.post('/api/categories', async (req, res) => {
  try {
    const { name, slug, parent_id = null, position = 0, description = null } = req.body;

    if (!name || !slug) {
      return res.status(400).json({ success: false, error: 'name y slug son obligatorios' });
    }

    if (parent_id !== null && parent_id !== '' && parent_id !== undefined) {
      const { data: parentData } = await supabase
        .from('categories')
        .select('id')
        .eq('id', parent_id)
        .single();

      if (!parentData) {
        return res.status(400).json({ success: false, error: 'parent_id no existe' });
      }
    }

    const { data: categoryData, error } = await supabase
      .from('categories')
      .insert([{
        name,
        slug,
        parent_id: parent_id || null,
        position,
        description
      }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data: { id: categoryData.id, message: 'Categoría creada exitosamente' }
    });
  } catch (error) {
    console.error('POST /api/categories error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/categories/:id
app.put('/api/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, parent_id, position, description } = req.body;

    const { data: existing } = await supabase
      .from('categories')
      .select('*')
      .eq('id', id)
      .single();

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Categoría no encontrada' });
    }

    if (parent_id && parseInt(parent_id, 10) === parseInt(id, 10)) {
      return res.status(400).json({ success: false, error: 'parent_id no puede ser igual al id de la categoría' });
    }

    if (parent_id !== null && parent_id !== '' && parent_id !== undefined) {
      const { data: parentData } = await supabase
        .from('categories')
        .select('id')
        .eq('id', parent_id)
        .single();

      if (!parentData) {
        return res.status(400).json({ success: false, error: 'parent_id no existe' });
      }
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (parent_id !== undefined) updateData.parent_id = parent_id || null;
    if (position !== undefined) updateData.position = position;
    if (description !== undefined) updateData.description = description;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ success: false, error: 'No hay campos para actualizar' });
    }

    const { error } = await supabase
      .from('categories')
      .update(updateData)
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: 'Categoría actualizada exitosamente' });
  } catch (error) {
    console.error('PUT /api/categories/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/categories/:id
app.delete('/api/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing } = await supabase
      .from('categories')
      .select('id')
      .eq('id', id)
      .single();

    if (!existing) {
      return res.status(404).json({ success: false, error: 'Categoría no encontrada' });
    }

    const { data: children } = await supabase
      .from('categories')
      .select('id')
      .eq('parent_id', id);

    if (children && children.length > 0) {
      return res.status(400).json({ success: false, error: 'No se puede eliminar: la categoría tiene subcategorías' });
    }

    const { data: newsRows } = await supabase
      .from('news')
      .select('id')
      .eq('main_category_id', id)
      .limit(1);

    if (newsRows && newsRows.length > 0) {
      return res.status(400).json({ success: false, error: 'No se puede eliminar: la categoría está asociada a noticias' });
    }

    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true, message: 'Categoría eliminada exitosamente' });
  } catch (error) {
    console.error('DELETE /api/categories/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== AUTORES ====================

app.get('/api/authors', async (req, res) => {
  try {
    const { data: authors, error } = await supabase
      .from('authors')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    res.json({ success: true, data: authors || [] });
  } catch (error) {
    console.error('GET /api/authors error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== TAGS ====================

app.get('/api/tags', async (req, res) => {
  try {
    const { data: tags, error } = await supabase
      .from('tags')
      .select('*')
      .order('name', { ascending: true });

    if (error) throw error;

    res.json({ success: true, data: tags || [] });
  } catch (error) {
    console.error('GET /api/tags error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tags', async (req, res) => {
  try {
    const { name, slug } = req.body;

    const { data: tagData, error } = await supabase
      .from('tags')
      .insert([{ name, slug }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      data: { id: tagData.id, message: 'Tag creado exitosamente' }
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

process.on('unhandledRejection', (err) => {
  console.error('Error no manejado:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Exception no capturada:', err);
});

module.exports = app;