import { pool } from "../db.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/* ======================================================
   POST /api/news
   Crear noticia completa
====================================================== */
export const createNews = asyncHandler(async (req, res) => {
  const {
    title,
    subtitle,
    summary,
    author_id,
    main_category_id,
    status = "draft",
    published_at = null,
    blocks = [],
    images = [],
    tags = [],
    related_ids = []
  } = req.body;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    const [newsResult] = await conn.query(
      `INSERT INTO news
      (title, subtitle, summary, author_id, main_category_id, status, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, subtitle, summary, author_id, main_category_id, status, published_at]
    );

    const newsId = newsResult.insertId;

    // Blocks
    for (const block of blocks) {
      await conn.query(
        `INSERT INTO news_blocks
        (news_id, type, content, media_url, alt_text, position)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
          newsId,
          block.type,
          block.content || null,
          block.media_url || null,
          block.alt_text || null,
          block.position || 0
        ]
      );
    }

    // Images
    for (const img of images) {
      await conn.query(
        `INSERT INTO news_images
        (news_id, url, caption, alt_text, position)
        VALUES (?, ?, ?, ?, ?)`,
        [
          newsId,
          img.url,
          img.caption || null,
          img.alt_text || null,
          img.position || 0
        ]
      );
    }

    // Tags
    for (const tagId of tags) {
      await conn.query(
        `INSERT IGNORE INTO news_tags (news_id, tag_id)
         VALUES (?, ?)`,
        [newsId, tagId]
      );
    }

    // Related
    for (const relId of related_ids) {
      await conn.query(
        `INSERT IGNORE INTO news_related (news_id, related_news_id)
         VALUES (?, ?)`,
        [newsId, relId]
      );
    }

    await conn.commit();
    res.status(201).json({ id: newsId });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/* ======================================================
   GET /api/news
   Lista resumida (sin blocks)
====================================================== */
export const listNews = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT 
      n.id,
      n.title,
      n.subtitle,
      n.summary,
      n.status,
      n.published_at,
      c.name AS category,
      a.name AS author
    FROM news n
    LEFT JOIN categories c ON n.main_category_id = c.id
    LEFT JOIN authors a ON n.author_id = a.id
    ORDER BY n.created_at DESC`
  );

  res.json(rows);
});

/* ======================================================
   GET /api/news/:id
   Detalle completo
====================================================== */
export const getNewsById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const [[news]] = await pool.query(
    `SELECT * FROM news WHERE id = ?`,
    [id]
  );

  if (!news) {
    return res.status(404).json({ message: "Noticia no encontrada" });
  }

  const [blocks] = await pool.query(
    `SELECT * FROM news_blocks
     WHERE news_id = ?
     ORDER BY position ASC`,
    [id]
  );

  const [images] = await pool.query(
    `SELECT * FROM news_images
     WHERE news_id = ?
     ORDER BY position ASC`,
    [id]
  );

  const [tags] = await pool.query(
    `SELECT t.id, t.name, t.slug
     FROM tags t
     INNER JOIN news_tags nt ON nt.tag_id = t.id
     WHERE nt.news_id = ?`,
    [id]
  );

  const [related] = await pool.query(
    `SELECT n.id, n.title, n.summary
     FROM news_related r
     INNER JOIN news n ON n.id = r.related_news_id
     WHERE r.news_id = ?`,
    [id]
  );

  res.json({
    ...news,
    blocks,
    images,
    tags,
    related
  });
});

/* ======================================================
   PUT /api/news/:id
   Editar noticia (sync total)
====================================================== */
export const updateNews = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const {
    title,
    subtitle,
    summary,
    author_id,
    main_category_id,
    status,
    published_at,
    blocks = [],
    images = [],
    tags = [],
    related_ids = []
  } = req.body;

  const conn = await pool.getConnection();
  await conn.beginTransaction();

  try {
    await conn.query(
      `UPDATE news SET
        title = ?,
        subtitle = ?,
        summary = ?,
        author_id = ?,
        main_category_id = ?,
        status = ?,
        published_at = ?
       WHERE id = ?`,
      [
        title,
        subtitle,
        summary,
        author_id,
        main_category_id,
        status,
        published_at,
        id
      ]
    );

    // Sync blocks
    await conn.query(`DELETE FROM news_blocks WHERE news_id = ?`, [id]);
    for (const block of blocks) {
      await conn.query(
        `INSERT INTO news_blocks
        (news_id, type, content, media_url, alt_text, position)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          block.type,
          block.content || null,
          block.media_url || null,
          block.alt_text || null,
          block.position || 0
        ]
      );
    }

    // Sync images
    await conn.query(`DELETE FROM news_images WHERE news_id = ?`, [id]);
    for (const img of images) {
      await conn.query(
        `INSERT INTO news_images
        (news_id, url, caption, alt_text, position)
        VALUES (?, ?, ?, ?, ?)`,
        [
          id,
          img.url,
          img.caption || null,
          img.alt_text || null,
          img.position || 0
        ]
      );
    }

    // Sync tags
    await conn.query(`DELETE FROM news_tags WHERE news_id = ?`, [id]);
    for (const tagId of tags) {
      await conn.query(
        `INSERT INTO news_tags (news_id, tag_id)
         VALUES (?, ?)`,
        [id, tagId]
      );
    }

    // Sync related
    await conn.query(`DELETE FROM news_related WHERE news_id = ?`, [id]);
    for (const relId of related_ids) {
      await conn.query(
        `INSERT INTO news_related (news_id, related_news_id)
         VALUES (?, ?)`,
        [id, relId]
      );
    }

    await conn.commit();
    res.json({ success: true });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

/* ======================================================
   DELETE /api/news/:id
====================================================== */
export const deleteNews = asyncHandler(async (req, res) => {
  const { id } = req.params;

  await pool.query(
    `DELETE FROM news WHERE id = ?`,
    [id]
  );

  res.json({
    success: true,
    message: "Noticia eliminada correctamente"
  });
});
