// migrate-slugs.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // usa SERVICE_ROLE para updates masivos
);

// ---------- helpers ----------
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

async function ensureUniqueSlug(baseSlug) {
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const { data } = await supabase
      .from('news')
      .select('id')
      .eq('canonical_slug', slug)
      .maybeSingle();

    if (!data) return slug;

    slug = `${baseSlug}-${counter}`;
    counter++;
  }
}

// ---------- migration ----------
async function migrate() {
  console.log('🚀 Iniciando migración de slugs...');

  const { data: news, error } = await supabase
    .from('news')
    .select('id, title, canonical_slug');

  if (error) {
    console.error('❌ Error obteniendo noticias:', error);
    process.exit(1);
  }

  for (const item of news) {
    if (!item.canonical_slug) {
      const baseSlug = generateSlug(item.title || `news-${item.id}`);
      const finalSlug = await ensureUniqueSlug(baseSlug);

      const { error: updateError } = await supabase
        .from('news')
        .update({ canonical_slug: finalSlug })
        .eq('id', item.id);

      if (updateError) {
        console.error(`❌ Error actualizando id ${item.id}`, updateError);
      } else {
        console.log(`✅ ${item.id} → ${finalSlug}`);
      }
    }
  }

  console.log('🎉 Migración completada');
  process.exit(0);
}

migrate();
