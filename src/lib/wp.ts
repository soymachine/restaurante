/**
 * WordPress REST API client
 *
 * SETUP REQUERIDO EN WORDPRESS
 * ────────────────────────────
 * Plugins:
 *   1. Advanced Custom Fields (gratis, wordpress.org)
 *   2. Custom Post Type UI (gratis, wordpress.org)
 *
 * NO se necesita "ACF to REST API": ACF 5.11+ expone campos nativamente con
 * "Show in REST API: Yes" en el field group.
 *
 * Custom Post Type vía CPT UI:
 *   Slug: platos | Show in REST: true | Supports: title, excerpt
 *
 * Taxonomía vía CPT UI:
 *   Slug: categoria_plato | Asociada a: platos | Show in REST: true
 *   Categorías: "To start", "From the garden", "From the fire", "To finish"
 *
 * ACF → Field Groups:
 *   Grupo "Plato" → ubicación: Post Type = platos
 *     - precio (Field type: Text, Field key: precio)
 *     Show in REST API: Yes
 *
 *   Grupo "Restaurant Settings" → ubicación: Page = "Bracero Settings"
 *     (crear Page con slug "bracero-settings", publicada, sin añadir al menú)
 *     Show in REST API: Yes
 *     Campos:
 *       - telefono        (Text)
 *       - email_contacto  (Email)
 *       - horario_comida  (Text)   e.g. "13:00 – 15:30"
 *       - horario_cena    (Text)   e.g. "20:00 – 23:00"
 *       - notas_reservas  (Textarea)
 *       - galeria         (Gallery)
 */

const WP = (import.meta.env.WORDPRESS_API_URL ?? '').replace(/\/$/, '');

// ── helpers ────────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

async function wpGet<T>(path: string): Promise<T | null> {
  if (!WP) return null;
  try {
    const res = await fetch(`${WP}/wp-json${path}`);
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    console.warn(`[WP] unreachable – ${WP}/wp-json${path}`);
    return null;
  }
}

// ── types ──────────────────────────────────────────────────────────────────

export interface WpMenuItem {
  nombre: string;
  descripcion: string;
  precio: string;
}

export interface WpMenuCategory {
  nombre: string;
  descripcion: string;
  platos: WpMenuItem[];
}

export interface WpPost {
  slug: string;
  title: string;
  date: string;
  excerpt: string;
  content: string;
  featuredImage: { url: string; alt: string } | null;
}

export interface WpReservationInfo {
  telefono: string;
  email: string;
  horarioComida: string;
  horarioCena: string;
  notas: string;
}

export interface WpGalleryImage {
  id: number;
  url: string;
  alt: string;
}

// ── raw WP types ───────────────────────────────────────────────────────────

interface RawTerm {
  id: number;
  name: string;
  description: string;
}

interface RawPlato {
  id: number;
  title: { rendered: string };
  excerpt: { rendered: string };
  categoria_plato: number[];
  acf?: { price?: string };
}

interface RawPost {
  slug: string;
  title: { rendered: string };
  date: string;
  excerpt: { rendered: string };
  content: { rendered: string };
  _embedded?: {
    'wp:featuredmedia'?: Array<{ source_url: string; alt_text: string }>;
  };
}

// ACF fields from the "Bracero Settings" page (slug: bracero-settings)
interface RawSettings {
  acf?: {
    telefono?: string;
    email_contacto?: string;
    horario_comida?: string;
    horario_cena?: string;
    notas_reservas?: string;
  };
}

interface RawGaleriaItem {
  id: number;
  _embedded?: {
    'wp:featuredmedia'?: Array<{ source_url: string; alt_text: string }>;
  };
}

// Fetches the settings page once per build
async function fetchSettings(): Promise<RawSettings['acf'] | null> {
  const pages = await wpGet<RawSettings[]>(
    '/wp/v2/pages?slug=bracero-settings&_fields=acf',
  );
  return pages?.[0]?.acf ?? null;
}

// ── fetchers ───────────────────────────────────────────────────────────────

export async function fetchMenu(): Promise<WpMenuCategory[] | null> {
  const [categorias, platos] = await Promise.all([
    wpGet<RawTerm[]>('/wp/v2/categoria_plato?per_page=20&orderby=id&order=asc'),
    wpGet<RawPlato[]>('/wp/v2/platos?per_page=100&_fields=id,title,excerpt,categoria_plato,acf'),
  ]);
  if (!categorias || !platos) return null;

  return categorias.map((cat) => ({
    nombre: cat.name,
    descripcion: cat.description,
    platos: platos
      .filter((p) => p.categoria_plato.includes(cat.id))
      .map((p) => ({
        nombre: p.title.rendered,
        descripcion: stripTags(p.excerpt.rendered),
        precio: p.acf?.price ?? '',
      })),
  }));
}

export async function fetchPosts(perPage = 20): Promise<WpPost[]> {
  const posts = await wpGet<RawPost[]>(
    `/wp/v2/posts?per_page=${perPage}&_embed=wp:featuredmedia`,
  );
  if (!posts) return [];
  return posts.map(mapPost);
}

export async function fetchPost(slug: string): Promise<WpPost | null> {
  const posts = await wpGet<RawPost[]>(
    `/wp/v2/posts?slug=${encodeURIComponent(slug)}&_embed=wp:featuredmedia`,
  );
  if (!posts?.length) return null;
  return { ...mapPost(posts[0]), content: posts[0].content.rendered };
}

export async function fetchReservationInfo(): Promise<WpReservationInfo | null> {
  const acf = await fetchSettings();
  if (!acf) return null;
  return {
    telefono: acf.telefono ?? '',
    email: acf.email_contacto ?? '',
    horarioComida: acf.horario_comida ?? '',
    horarioCena: acf.horario_cena ?? '',
    notas: acf.notas_reservas ?? '',
  };
}

export async function fetchGallery(): Promise<WpGalleryImage[] | null> {
  const items = await wpGet<RawGaleriaItem[]>(
    '/wp/v2/galeria_item?per_page=20&_embed=wp:featuredmedia&orderby=date&order=asc',
  );
  if (!items?.length) return null;

  return items
    .map((item) => {
      const media = item._embedded?.['wp:featuredmedia']?.[0];
      if (!media) return null;
      return { id: item.id, url: media.source_url, alt: media.alt_text };
    })
    .filter((img): img is WpGalleryImage => img !== null);
}

// ── private helpers ────────────────────────────────────────────────────────

function mapPost(p: RawPost): WpPost {
  const media = p._embedded?.['wp:featuredmedia']?.[0];
  return {
    slug: p.slug,
    title: p.title.rendered,
    date: p.date,
    excerpt: stripTags(p.excerpt.rendered),
    content: '',
    featuredImage: media ? { url: media.source_url, alt: media.alt_text } : null,
  };
}
