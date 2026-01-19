// server.js (Express + Supabase + Cloudinary + OG endpoint y /news/:id que detecta bots)
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
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

// Config
const PORT = process.env.PORT || 3001;
const FRONTEND_BUILD_PATH = process.env.FRONTEND_BUILD_PATH || path.join(__dirname, 'build'); // opcional, no necesario si front separado
const SITE_URL = process.env.SITE_URL || 'https://www.zonamicroondas.com'; // Recomendado poner en env
const FRONTEND_URL = process.env.FRONTEND_URL || SITE_URL; // por si el frontend tiene otro url

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

// Helper function to generate slug
function generateSlug(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
}

// ----------------- Helpers para OG / metas -----------------
function isBotUserAgent(ua = '') {
  if (!ua) return false;
  ua = ua.toLowerCase();
  const bots = [
    'facebookexternalhit', 'facebot', 'facebook', 'twitterbot', 'linkedinbot',
    'slackbot', 'whatsapp', 'telegrambot', 'pinterest', 'discordbot',
    'embedly', 'bitlybot', 'bufferbot', 'vkshare', 'viber', 'yahoo', 'bingbot', 'googlebot'
  ];
  return bots.some(b => ua.includes(b));
}

function escapeHtml(str = '') {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderNewsHtml({ title, summary, image, url, published_at, author, siteName = 'ZONA MICROONDAS' }) {
  const safeTitle = escapeHtml(title || siteName);
  const safeSummary = escapeHtml(summary || '');
  const safeImage = escapeHtml(image || `${SITE_URL || ''}/images/default-news.jpg`);
  const safeUrl = escapeHtml(url || (SITE_URL ? `${SITE_URL}/news/` : ''));

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${safeTitle}</title>
  <meta name="description" content="${safeSummary}" />

  <!-- Open Graph -->
  <meta property="og:site_name" content="${escapeHtml(siteName)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeSummary}" />
  <meta property="og:image" content="${safeImage}" />
  <meta property="og:url" content="${safeUrl}" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeSummary}" />
  <meta name="twitter:image" content="${safeImage}" />

  <link rel="canonical" href="${safeUrl}" />
  <style>body{font-family:system-ui,Arial;}</style>
</head>
<body>
  <main>
    <h1>${safeTitle}</h1>
    <p>${safeSummary}</p>
    ${image ? `<img src="${safeImage}" alt="${safeTitle}" style="max-width:600px; width:100%;">` : ''}
    <p>Publicado: ${escapeHtml(published_at || '')} ${author ? `| Por ${escapeHtml(author)}` : ''}</p>
    <p><a href="${safeUrl}">Leer en el sitio</a></p>
  </main>
</body>
</html>`;
}

// ----------------- RUTA: /news/:id (detecta bots y redirige usuarios) -----------------
app.get('/news/:id', async (req, res, next) => {
  try {
    const ua = req.get('user-agent') || '';
    const isBot = isBotUserAgent(ua);
    const { id } = req.params;
    const pageUrl = `${FRONTEND_URL.replace(/\/$/, '')}/news/${id}`;

    if (isBot) {
      // Si es bot, devolvemos HTML con OG tags (no redirigimos)
      const { data: news, error } = await supabase
        .from('news')
        .select(`
          id,
          title,
          subtitle,
          summary,
          published_at,
          canonical_slug,
          created_at,
          authors(name),
          news_images(url, position)
        `)
        .eq('id', id)
        .single();

      if (error || !news) {
        const notFoundHtml = renderNewsHtml({
          title: 'Noticia no encontrada',
          summary: 'La noticia solicitada no existe.',
          image: `${SITE_URL}/images/default-news.jpg`,
          url: pageUrl,
          published_at: '',
          author: ''
        });
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.status(404).send(notFoundHtml);
      }

      let mainImage = null;
      if (Array.isArray(news.news_images) && news.news_images.length > 0) {
        const sorted = news.news_images.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
        mainImage = sorted[0].url;
      }

      const html = renderNewsHtml({
        title: news.title,
        summary: news.summary || news.subtitle || '',
        image: mainImage || `${SITE_URL}/images/default-news.jpg`,
        url: pageUrl,
        published_at: news.published_at || news.created_at,
        author: news.authors?.name || ''
      });

      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=300'); // ajustar si es necesario
      return res.status(200).send(html);
    }

    // Si NO es bot -> redirigir al frontend (React) para que el usuario vea la app
    return res.redirect(302, pageUrl);
  } catch (err) {
    console.error('Error en /news/:id:', err);
    return next(err);
  }
});

// ----------------- RUTA DEDICADA: /og/news/:id -----------------
// Mantenerla por si quieres usarla desde vercel/netlify redirigiendo bots explícitamente
app.get('/og/news/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: news, error } = await supabase
      .from('news')
      .select(`
        id,
        title,
        subtitle,
        summary,
        published_at,
        canonical_slug,
        created_at,
        authors(name),
        news_images(url, position)
      `)
      .eq('id', id)
      .single();

    if (error || !news) {
      const notFoundHtml = renderNewsHtml({
        title: 'Noticia no encontrada',
        summary: 'La noticia solicitada no existe.',
        image: `${SITE_URL}/images/default-news.jpg`,
        url: `${FRONTEND_URL.replace(/\/$/, '')}/news/${id}`,
        published_at: '',
        author: ''
      });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(notFoundHtml);
    }

    // Buscar imagen principal (position asc)
    let mainImage = null;
    if (Array.isArray(news.news_images) && news.news_images.length > 0) {
      const sorted = news.news_images.slice().sort((a, b) => (a.position || 0) - (b.position || 0));
      mainImage = sorted[0].url;
    }

    const pageUrl = `${FRONTEND_URL.replace(/\/$/, '')}/news/${news.id}`;

    const html = renderNewsHtml({
      title: news.title,
      summary: news.summary || news.subtitle || '',
      image: mainImage || `${SITE_URL}/images/default-news.jpg`,
      url: pageUrl,
      published_at: news.published_at || news.created_at,
      author: news.authors?.name || ''
    });

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    return res.status(200).send(html);
  } catch (err) {
    console.error('Error en /og/news/:id:', err);
    res.status(500).send('Error interno OG');
  }
});

// ********** Aquí van tus rutas API (las mantuve intactas) **********

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

    const mappedData = (data || []).map(item => ({
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
      .select(`*, authors(name, email), categories(name, slug)`)
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

// ==================== CATEGORÍAS, AUTORES, TAGS y AUTH ====================
// (Asumo que tus otras rutas de categorías, autores, tags y auth siguen igual que antes)
// [Si quieres, las pego también; las dejé fuera por brevedad]

// ------------------ Servir assets estáticos del frontend (opcional) ------------------
if (fs.existsSync(FRONTEND_BUILD_PATH)) {
  app.use(express.static(FRONTEND_BUILD_PATH));
  app.get('*', (req, res) => {
    // Rutas API ya definidas no se tocan
    if (req.path.startsWith('/api') || req.path.startsWith('/og')) {
      return res.status(404).json({ success: false, error: 'Endpoint API no encontrado' });
    }
    const indexPath = path.join(FRONTEND_BUILD_PATH, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    } else {
      return res.status(200).send('<html><body><h1>React app no encontrada (build)</h1></body></html>');
    }
  });
} else {
  console.warn('WARN: No se encontró carpeta build del frontend. Ajusta FRONTEND_BUILD_PATH si es necesario.');
}

// ------------------ Error handlers y arranque ------------------
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 API disponible en http://localhost:${PORT}/api`);
  console.log(`🔗 OG endpoint: ${FRONTEND_URL.replace(/\/$/, '')}/og/news/:id`);
});

process.on('unhandledRejection', (err) => {
  console.error('Error no manejado:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Exception no capturada:', err);
});

module.exports = app;
