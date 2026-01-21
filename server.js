// server.js - Versión corregida y mejorada
require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();

// ----------------------- Configs -----------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('⚠️  Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env');
}

const JWT_SECRET = process.env.JWT_SECRET || 'please-change-me';
if (JWT_SECRET === 'please-change-me') {
  console.warn('⚠️  Usando JWT_SECRET por defecto. Cambia esto en producción.');
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ----------------------- Middlewares -----------------------
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Forzar header JSON UTF-8 solo para rutas /api
app.use('/api', (req, res, next) => {
  if (!res.getHeader('Content-Type')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});

// ----------------------- Multer + Cloudinary Storage -----------------------
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'news',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
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

// ----------------------- Helpers -----------------------
function generateSlug(text) {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

async function ensureUniqueSlug(baseSlug, excludeId = null, maxAttempts = 100) {
  let slug = baseSlug;
  for (let counter = 0; counter < maxAttempts; counter++) {
    let query = supabase
      .from('news')
      .select('id', { count: 'exact' })
      .eq('canonical_slug', slug)
      .limit(1);

    if (excludeId) {
      query = query.neq('id', excludeId);
    }

    const { data: rows, error } = await query;
    if (error) {
      throw error;
    }

    if (!rows || rows.length === 0) {
      return slug;
    }

    slug = `${baseSlug}-${counter + 1}`;
  }
  throw new Error('No se pudo generar un slug único tras varios intentos');
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getPublicIdFromCloudinaryUrl(url) {
  try {
    if (!url) return null;
    const parts = url.split('/');
    const uploadIndex = parts.findIndex(p => p === 'upload');
    if (uploadIndex === -1) return null;

    let publicParts = parts.slice(uploadIndex + 1);
    // quitar versión si existe
    if (publicParts[0] && /^v\d+$/.test(publicParts[0])) publicParts.shift();

    const last = publicParts.pop();
    const lastNoExt = last.replace(/\.[^/.]+$/, '');
    publicParts.push(lastNoExt);

    return publicParts.join('/');
  } catch (err) {
    return null;
  }
}

function generateNewsHTML(newsData, categorySlug) {
  const title = newsData.title || 'ZONA MICROONDAS';
  const description = (newsData.summary || 'Noticias de Querétaro').substring(0, 160);
  const imageUrl = newsData.images?.[0]?.url || 'https://www.zonamicroondas.com/LOGO_ZM.png';
  const articleUrl = categorySlug
    ? `https://www.zonamicroondas.com/${categorySlug}/articulos/${newsData.canonical_slug}`
    : `https://www.zonamicroondas.com/news/${newsData.canonical_slug}`;

  const publishedDate = newsData.published_at || newsData.created_at || new Date().toISOString();
  const authorName = newsData.author_name || 'Zona Microondas';
  const categoryName = newsData.category_name || 'Noticias';

  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeAuthor = escapeHtml(authorName);
  const safeCategory = escapeHtml(categoryName);

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <link rel="icon" href="/favicon.ico" />
  <link rel="apple-touch-icon" href="/logo192.png" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#b1121a" />
  <title>${safeTitle} | ZONA MICROONDAS</title>
  <meta name="description" content="${safeDescription}" />
  <meta name="author" content="${safeAuthor}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${articleUrl}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDescription}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:image:secure_url" content="${imageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${safeTitle}" />
  <meta property="og:site_name" content="ZONA MICROONDAS" />
  <meta property="og:locale" content="es_MX" />
  <meta property="article:published_time" content="${publishedDate}" />
  <meta property="article:author" content="${safeAuthor}" />
  <meta property="article:section" content="${safeCategory}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@ZONAMICROONDAS" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDescription}" />
  <meta name="twitter:image" content="${imageUrl}" />
  <meta name="twitter:image:alt" content="${safeTitle}" />
  <link rel="canonical" href="${articleUrl}" />
  <link rel="manifest" href="/manifest.json" />
</head>
<body>
  <noscript>Necesitas habilitar JavaScript para ejecutar esta aplicación.</noscript>
  <div id="root">
    <article style="max-width: 800px; margin: 50px auto; padding: 20px; font-family: Arial, sans-serif;">
      <h1>${safeTitle}</h1>
      ${imageUrl !== 'https://www.zonamicroondas.com/LOGO_ZM.png' ? `<img src="${imageUrl}" alt="${safeTitle}" style="width: 100%; height: auto; margin: 20px 0;" />` : ''}
      <p style="color: #666; margin: 20px 0; font-size: 16px; line-height: 1.6;">${safeDescription}</p>
      <p style="text-align: center; color: #999;">Cargando artículo completo...</p>
    </article>
  </div>
</body>
</html>`;
}

// ----------------------- RUTAS / API -----------------------

// --- NEWS API ---
// Importante: declarar rutas relacionadas con /api primero para evitar colisiones
// GET /api/news (listar)
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

    if (status) query = query.eq('status', status);
    if (category_id) query = query.eq('main_category_id', parseInt(category_id, 10));
    if (author_id) query = query.eq('author_id', parseInt(author_id, 10));
    if (typeof is_featured !== 'undefined') query = query.eq('is_featured', parseInt(is_featured, 10));

    const lim = parseInt(limit, 10) || 50;
    const off = parseInt(offset, 10) || 0;

    query = query
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(off, off + lim - 1);

    const { data, error } = await query;
    if (error) throw error;

    const mappedData = (data || []).map(item => ({
      ...item,
      author_name: item.authors?.name,
      category_name: item.categories?.name,
      category_slug: item.categories?.slug,
      image_url: (item.news_images || [])[0]?.url,
      canonical_slug: item.canonical_slug
    }));

    res.json({ success: true, data: mappedData, count: mappedData.length });
  } catch (error) {
    console.error('GET /api/news error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/news/slug/:slug (debe ir antes de /api/news/:id)
app.get('/api/news/slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { data: news, error } = await supabase
      .from('news')
      .select(`
        *,
        authors(name, email),
        categories(name, slug)
      `)
      .eq('canonical_slug', slug)
      .single();

    if (error || !news) {
      return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
    }

    const { data: images } = await supabase
      .from('news_images')
      .select('*')
      .eq('news_id', news.id)
      .order('position', { ascending: true });

    const { data: blocks } = await supabase
      .from('news_blocks')
      .select('*')
      .eq('news_id', news.id)
      .order('position', { ascending: true });

    const { data: tags } = await supabase
      .from('news_tags')
      .select('tags(*)')
      .eq('news_id', news.id);

    const { data: related } = await supabase
      .from('news_related')
      .select('news(*), relation_type')
      .eq('news_id', news.id);

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
    console.error('GET /api/news/slug/:slug error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/news/:id (por id)
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

    // Generar slug si hace falta (no abortamos si falla)
    if (!news.canonical_slug) {
      try {
        const base = generateSlug(news.title || `news-${news.id}`);
        const final = await ensureUniqueSlug(base, parseInt(id, 10));
        const { error: upErr } = await supabase
          .from('news')
          .update({ canonical_slug: final })
          .eq('id', id);

        if (!upErr) {
          news.canonical_slug = final;
        } else {
          console.error('Error updating canonical_slug for id', id, upErr);
        }
      } catch (slugErr) {
        console.error('Error generating slug for news id', id, slugErr);
      }
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

// POST /api/news
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

    let finalSlug = canonical_slug ? generateSlug(canonical_slug) : null;
    if (finalSlug) finalSlug = await ensureUniqueSlug(finalSlug);
    else if (title) {
      const base = generateSlug(title);
      finalSlug = await ensureUniqueSlug(base);
    }

    const { data: newsData, error: newsError } = await supabase
      .from('news')
      .insert([{
        title, subtitle, summary, author_id, main_category_id, status, published_at, is_featured, canonical_slug: finalSlug
      }])
      .select()
      .single();

    if (newsError) throw newsError;
    const newsId = newsData.id;

    if (tags.length > 0) {
      const tagValues = tags.map(tagId => ({ news_id: newsId, tag_id: tagId }));
      const { error: tagsError } = await supabase.from('news_tags').insert(tagValues);
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
      const { error: blocksError } = await supabase.from('news_blocks').insert(blockValues);
      if (blocksError) throw blocksError;
    }

    res.status(201).json({ success: true, data: { id: newsId, canonical_slug: finalSlug, message: 'Noticia creada exitosamente' } });
  } catch (error) {
    console.error('POST /api/news error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/news/:id
app.put('/api/news/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, subtitle, summary, author_id, main_category_id,
      status, published_at, is_featured, canonical_slug, tags, blocks
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

    if (canonical_slug !== undefined) {
      let finalSlug = canonical_slug ? generateSlug(canonical_slug) : null;
      if (finalSlug) finalSlug = await ensureUniqueSlug(finalSlug, parseInt(id, 10));
      updateData.canonical_slug = finalSlug;
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase.from('news').update(updateData).eq('id', id);
      if (updateError) throw updateError;
    }

    if (tags !== undefined) {
      await supabase.from('news_tags').delete().eq('news_id', id);
      if (tags.length > 0) {
        const tagValues = tags.map(tagId => ({ news_id: id, tag_id: tagId }));
        const { error: tagsError } = await supabase.from('news_tags').insert(tagValues);
        if (tagsError) throw tagsError;
      }
    }

    if (blocks !== undefined) {
      await supabase.from('news_blocks').delete().eq('news_id', id);
      if (blocks.length > 0) {
        const blockValues = blocks.map((block, i) => ({
          news_id: id,
          type: block.type,
          content: block.content,
          media_url: block.media_url,
          alt_text: block.alt_text,
          position: i
        }));
        const { error: blocksError } = await supabase.from('news_blocks').insert(blockValues);
        if (blocksError) throw blocksError;
      }
    }

    res.json({ success: true, message: 'Noticia actualizada exitosamente' });
  } catch (error) {
    console.error('PUT /api/news/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/news/:id
app.delete('/api/news/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('news').delete().eq('id', id);
    if (error) throw error;
    res.json({ success: true, message: 'Noticia eliminada exitosamente' });
  } catch (error) {
    console.error('DELETE /api/news/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------- IMÁGENES -----------------------

// POST /api/news/:id/images - Subir imagen (verifica noticia antes)
app.post('/api/news/:id/images', upload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { caption = null, alt_text = null, position = 0 } = req.body;

    // Verificar que exista la noticia antes de proceder
    const { data: existingNews, error: newsErr } = await supabase.from('news').select('id').eq('id', parseInt(id, 10)).single();
    if (newsErr || !existingNews) {
      // Si multer subió algo, intentar limpiar
      if (req.file && req.file.path) {
        const pubId = getPublicIdFromCloudinaryUrl(req.file.path);
        if (pubId) {
          try { await cloudinary.uploader.destroy(pubId, { resource_type: 'image' }); } catch (e) { /* ignore */ }
        }
      }
      return res.status(404).json({ success: false, error: 'Noticia no encontrada' });
    }

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

    if (error) {
      // limpiar imagen subida en cloudinary si falla el insert
      const pubId = getPublicIdFromCloudinaryUrl(imageUrl);
      if (pubId) {
        try { await cloudinary.uploader.destroy(pubId, { resource_type: 'image' }); } catch (e) { console.error('Error cleaning up cloudinary:', e); }
      }
      throw error;
    }

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

// GET /api/news/:id/images
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

// DELETE /api/news/:newsId/images/:imageId
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

    const { error: deleteError } = await supabase.from('news_images').delete().eq('id', imageId);
    if (deleteError) throw deleteError;

    res.json({ success: true, message: 'Imagen eliminada exitosamente' });
  } catch (error) {
    console.error('DELETE /api/news/:newsId/images/:imageId error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------- CATEGORIES -----------------------
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

    const mappedData = (categories || []).map(cat => ({ ...cat, parent_name: cat.parent?.name }));
    res.json({ success: true, data: mappedData });
  } catch (error) {
    console.error('GET /api/categories error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const { name, slug, parent_id = null, position = 0, description = null } = req.body;
    if (!name || !slug) return res.status(400).json({ success: false, error: 'name y slug son obligatorios' });

    if (parent_id !== null && parent_id !== '' && parent_id !== undefined) {
      const { data: parentData } = await supabase.from('categories').select('id').eq('id', parent_id).single();
      if (!parentData) return res.status(400).json({ success: false, error: 'parent_id no existe' });
    }

    const { data: categoryData, error } = await supabase.from('categories').insert([{
      name, slug: generateSlug(slug), parent_id: parent_id || null, position, description
    }]).select().single();

    if (error) throw error;
    res.status(201).json({ success: true, data: { id: categoryData.id, message: 'Categoría creada exitosamente' } });
  } catch (error) {
    console.error('POST /api/categories error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, parent_id, position, description } = req.body;

    const { data: existing } = await supabase.from('categories').select('*').eq('id', id).single();
    if (!existing) return res.status(404).json({ success: false, error: 'Categoría no encontrada' });

    if (parent_id && parseInt(parent_id, 10) === parseInt(id, 10)) {
      return res.status(400).json({ success: false, error: 'parent_id no puede ser igual al id de la categoría' });
    }

    if (parent_id !== null && parent_id !== '' && parent_id !== undefined) {
      const { data: parentData } = await supabase.from('categories').select('id').eq('id', parent_id).single();
      if (!parentData) return res.status(400).json({ success: false, error: 'parent_id no existe' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = generateSlug(slug);
    if (parent_id !== undefined) updateData.parent_id = parent_id || null;
    if (position !== undefined) updateData.position = position;
    if (description !== undefined) updateData.description = description;

    if (Object.keys(updateData).length === 0) return res.status(400).json({ success: false, error: 'No hay campos para actualizar' });

    const { error } = await supabase.from('categories').update(updateData).eq('id', id);
    if (error) throw error;

    res.json({ success: true, message: 'Categoría actualizada exitosamente' });
  } catch (error) {
    console.error('PUT /api/categories/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('categories').select('id').eq('id', id).single();
    if (!existing) return res.status(404).json({ success: false, error: 'Categoría no encontrada' });

    const { data: children } = await supabase.from('categories').select('id').eq('parent_id', id);
    if (children && children.length > 0) return res.status(400).json({ success: false, error: 'No se puede eliminar: la categoría tiene subcategorías' });

    const { data: newsRows } = await supabase.from('news').select('id').eq('main_category_id', id).limit(1);
    if (newsRows && newsRows.length > 0) return res.status(400).json({ success: false, error: 'No se puede eliminar: la categoría está asociada a noticias' });

    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) throw error;

    res.json({ success: true, message: 'Categoría eliminada exitosamente' });
  } catch (error) {
    console.error('DELETE /api/categories/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------- AUTHORS -----------------------
app.get('/api/authors', async (req, res) => {
  try {
    const { data: authors, error } = await supabase.from('authors').select('*').order('name', { ascending: true });
    if (error) throw error;
    res.json({ success: true, data: authors || [] });
  } catch (error) {
    console.error('GET /api/authors error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/authors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: author, error } = await supabase.from('authors').select('*').eq('id', id).single();
    if (error || !author) return res.status(404).json({ success: false, error: 'Autor no encontrado' });
    res.json({ success: true, data: author });
  } catch (error) {
    console.error('GET /api/authors/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/authors', async (req, res) => {
  try {
    const { name, email = null, bio = null } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name es obligatorio' });

    const slug = generateSlug(name);
    const { data: existingSlug } = await supabase.from('authors').select('id').eq('slug', slug).limit(1);

    let finalSlug = slug;
    if (existingSlug && existingSlug.length > 0) finalSlug = `${slug}-${Date.now()}`;

    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return res.status(400).json({ success: false, error: 'El email no tiene un formato válido' });

      const { data: existingEmail } = await supabase.from('authors').select('id').eq('email', email).limit(1);
      if (existingEmail && existingEmail.length > 0) return res.status(400).json({ success: false, error: 'Ya existe un autor con ese email' });
    }

    const { data: authorData, error } = await supabase.from('authors').insert([{ name, slug: finalSlug, email, bio }]).select().single();
    if (error) throw error;

    res.status(201).json({ success: true, data: { id: authorData.id, slug: finalSlug, message: 'Autor creado exitosamente' } });
  } catch (error) {
    console.error('POST /api/authors error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/authors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, email, bio } = req.body;

    const { data: existing } = await supabase.from('authors').select('*').eq('id', id).single();
    if (!existing) return res.status(404).json({ success: false, error: 'Autor no encontrado' });

    if (slug !== undefined && slug !== existing.slug) {
      const { data: slugExists } = await supabase.from('authors').select('id').eq('slug', slug).neq('id', id).limit(1);
      if (slugExists && slugExists.length > 0) return res.status(400).json({ success: false, error: 'Ya existe otro autor con ese slug' });
    }

    if (email !== undefined && email !== null && email !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) return res.status(400).json({ success: false, error: 'El email no tiene un formato válido' });
      const { data: emailExists } = await supabase.from('authors').select('id').eq('email', email).neq('id', id).limit(1);
      if (emailExists && emailExists.length > 0) return res.status(400).json({ success: false, error: 'Ya existe otro autor con ese email' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (slug !== undefined) updateData.slug = slug;
    if (email !== undefined) updateData.email = email || null;
    if (bio !== undefined) updateData.bio = bio;

    if (Object.keys(updateData).length === 0) return res.status(400).json({ success: false, error: 'No hay campos para actualizar' });

    const { error } = await supabase.from('authors').update(updateData).eq('id', id);
    if (error) throw error;

    res.json({ success: true, message: 'Autor actualizado exitosamente' });
  } catch (error) {
    console.error('PUT /api/authors/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/authors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing } = await supabase.from('authors').select('id').eq('id', id).single();
    if (!existing) return res.status(404).json({ success: false, error: 'Autor no encontrado' });

    const { data: newsRows } = await supabase.from('news').select('id').eq('author_id', id).limit(1);
    if (newsRows && newsRows.length > 0) return res.status(400).json({ success: false, error: 'No se puede eliminar: el autor tiene noticias asociadas' });

    const { error } = await supabase.from('authors').delete().eq('id', id);
    if (error) throw error;

    res.json({ success: true, message: 'Autor eliminado exitosamente' });
  } catch (error) {
    console.error('DELETE /api/authors/:id error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------- TAGS -----------------------
app.get('/api/tags', async (req, res) => {
  try {
    const { data: tags, error } = await supabase.from('tags').select('*').order('name', { ascending: true });
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
    const { data: tagData, error } = await supabase.from('tags').insert([{ name, slug: generateSlug(slug || name) }]).select().single();
    if (error) throw error;
    res.status(201).json({ success: true, data: { id: tagData.id, message: 'Tag creado exitosamente' } });
  } catch (error) {
    console.error('POST /api/tags error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------- AUTH (mejorado: bcrypt + JWT) -----------------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email y contraseña son obligatorios' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return res.status(400).json({ success: false, error: 'Email inválido' });

    const { data: existingUser } = await supabase.from('users').select('id').eq('email', email).single();
    if (existingUser) return res.status(400).json({ success: false, error: 'El email ya está registrado' });

    const hashed = await bcrypt.hash(password, 10);
    const { data: newUser, error } = await supabase.from('users').insert([{
      email, password: hashed, name: name || email.split('@')[0], role: 'admin'
    }]).select('id, email, name, role, created_at').single();

    if (error) throw error;

    const token = jwt.sign({ id: newUser.id, email: newUser.email, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, data: { user: newUser, token, message: 'Usuario registrado exitosamente' } });
  } catch (error) {
    console.error('POST /api/auth/register error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: 'Email y contraseña son obligatorios' });

    const { data: user, error } = await supabase.from('users').select('id, email, password, name, role').eq('email', email).single();
    if (error || !user) return res.status(401).json({ success: false, error: 'Credenciales inválidas' });

    const ok = await bcrypt.compare(password, user.password || '');
    if (!ok) return res.status(401).json({ success: false, error: 'Credenciales inválidas' });

    const { password: _, ...userWithoutPassword } = user;
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ success: true, data: { user: userWithoutPassword, token, message: 'Login exitoso' } });
  } catch (error) {
    console.error('POST /api/auth/login error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/auth/verify', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1] || req.query.token;
    if (!token) return res.status(401).json({ success: false, error: 'No autenticado' });

    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const { data: user, error } = await supabase.from('users').select('id, email, name, role, created_at').eq('id', payload.id).single();
      if (error || !user) return res.status(401).json({ success: false, error: 'Usuario no encontrado' });
      res.json({ success: true, data: { user } });
    } catch (e) {
      return res.status(401).json({ success: false, error: 'Token inválido' });
    }
  } catch (error) {
    console.error('GET /api/auth/verify error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------- REDIRECCIÓN (ruta pública) -----------------------
app.get('/news/by-id/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: newsRow, error: fetchErr } = await supabase
      .from('news')
      .select('id, title, canonical_slug, main_category_id')
      .eq('id', parseInt(id, 10))
      .single();

    if (fetchErr || !newsRow) {
      return res.status(404).send('Noticia no encontrada');
    }

    let slug = newsRow.canonical_slug;
    if (!slug) {
      try {
        const base = generateSlug(newsRow.title || `news-${newsRow.id}`);
        const final = await ensureUniqueSlug(base, parseInt(id, 10));
        const { error: upErr } = await supabase.from('news').update({ canonical_slug: final }).eq('id', id);
        if (!upErr) slug = final;
      } catch (err) {
        console.error('Error generando slug (by-id):', err);
      }
    }

    let categorySlug = null;
    if (newsRow.main_category_id) {
      const { data: cat, error: catErr } = await supabase.from('categories').select('slug').eq('id', newsRow.main_category_id).single();
      if (!catErr && cat) categorySlug = cat.slug;
    }

    if (!slug) return res.status(404).send('Noticia no encontrada');

    if (categorySlug) return res.redirect(301, `/${encodeURIComponent(categorySlug)}/articulos/${encodeURIComponent(slug)}`);
    return res.redirect(301, `/news/${encodeURIComponent(slug)}`);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error interno');
  }
});

// ----------------------- SERVIR REACT ESTÁTICO -----------------------
app.use(express.static(path.join(__dirname, 'build')));

// ----------------------- RUTAS DINÁMICAS PARA META TAGS (SSR ligero) -----------------------
// Estas rutas son públicas (no /api) y devuelven HTML para bots / OG tags.
// Deben ir DESPUÉS de app.use(express.static(...)) para priorizar archivos estáticos.
app.get('/:categorySlug/articulos/:slug', async (req, res) => {
  try {
    const { slug, categorySlug } = req.params;
    console.log(`📄 Petición de noticia: ${categorySlug}/articulos/${slug}`);

    const { data: news, error } = await supabase
      .from('news')
      .select(`
        *,
        authors(name, email),
        categories(name, slug)
      `)
      .eq('canonical_slug', slug)
      .single();

    if (error || !news) {
      console.log(`❌ Noticia no encontrada: ${slug}`);
      return res.sendFile(path.join(__dirname, 'build', 'index.html'));
    }

    const { data: images } = await supabase.from('news_images').select('*').eq('news_id', news.id).order('position', { ascending: true });

    const newsData = {
      ...news,
      author_name: news.authors?.name,
      author_email: news.authors?.email,
      category_name: news.categories?.name,
      category_slug: news.categories?.slug,
      images: images || []
    };

    const html = generateNewsHTML(newsData, categorySlug);
    res.send(html);
  } catch (error) {
    console.error('❌ Error en ruta dinámica:', error);
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  }
});

app.get('/news/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    console.log(`📄 Petición de noticia: /news/${slug}`);

    const { data: news, error } = await supabase
      .from('news')
      .select(`
        *,
        authors(name, email),
        categories(name, slug)
      `)
      .eq('canonical_slug', slug)
      .single();

    if (error || !news) {
      console.log(`❌ Noticia no encontrada: ${slug}`);
      return res.sendFile(path.join(__dirname, 'build', 'index.html'));
    }

    const { data: images } = await supabase.from('news_images').select('*').eq('news_id', news.id).order('position', { ascending: true });

    const newsData = {
      ...news,
      author_name: news.authors?.name,
      category_name: news.categories?.name,
      category_slug: news.categories?.slug,
      images: images || []
    };

    const html = generateNewsHTML(newsData, null);
    res.send(html);
  } catch (error) {
    console.error('❌ Error en ruta /news/:slug:', error);
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
  }
});

// Catch-all: cualquier otra ruta sirve index.html (DEBE IR AL FINAL)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// ----------------------- INICIAR SERVIDOR -----------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 API disponible en http://localhost:${PORT}/api`);
  console.log(`🌐 Sirviendo archivos estáticos de React desde /build`);
});

// Manejo global de errores no capturados
process.on('unhandledRejection', (err) => {
  console.error('Error no manejado:', err);
});
process.on('uncaughtException', (err) => {
  console.error('Exception no capturada:', err);
});

module.exports = app;
