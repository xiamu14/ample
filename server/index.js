import express from 'express';
import multer from 'multer';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasNoteContent } from './note-content.js';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://notes:notes@localhost:55432/notes',
});
const uploadsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/uploads');
const app = express();

app.use(express.json({ limit: '10mb' }));

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function checkDate(req, res, next) {
  if (!validDate(req.params.date)) return res.status(400).json({ error: 'Invalid date; expected YYYY-MM-DD' });
  next();
}

const noteColumns = "to_char(date, 'YYYY-MM-DD') AS date, sections, version, updated_at AS \"updatedAt\"";
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.post('/api/link-title', asyncRoute(async (req, res) => {
  let url;
  try {
    url = new URL(req.body?.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch { return res.status(400).json({ error: 'Invalid URL' }); }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { Accept: 'text/html' } });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || !response.body) return res.json({ title: '' });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    while (html.length < 262144) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/head\s*>/i.test(html)) break;
    }
    await reader.cancel();
    const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1]?.trim() || '';
    res.json({ title: title.slice(0, 500) });
  } catch { res.json({ title: '' }); }
}));

app.get('/api/notes', asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT to_char(date, 'YYYY-MM-DD') AS date, sections FROM notes ORDER BY date DESC");
  res.json(result.rows.filter((row) => hasNoteContent(row.sections)).map((row) => row.date));
}));

app.get('/api/notes/:date', checkDate, asyncRoute(async (req, res) => {
  await pool.query('INSERT INTO notes (date) VALUES ($1) ON CONFLICT (date) DO NOTHING', [req.params.date]);
  const result = await pool.query(`SELECT ${noteColumns} FROM notes WHERE date = $1`, [req.params.date]);
  res.json(result.rows[0]);
}));

app.put('/api/notes/:date', checkDate, asyncRoute(async (req, res) => {
  const { sections, version } = req.body || {};
  const document = Array.isArray(sections) && sections.length === 1 ? sections[0] : null;
  const validDocument = document?.type === 'doc' && Array.isArray(document.content) && document.content.length === 2 &&
    document.content.every((section, index) => section.type === 'fixedSection' && section.attrs?.kind === (index === 0 ? 'unfinished' : 'important') && Array.isArray(section.content) && section.content.length > 0);
  if (!validDocument || !Number.isSafeInteger(version) || version < 0 || version >= 2147483647) {
    return res.status(400).json({ error: 'Expected a valid document and a non-negative integer version' });
  }
  const result = await pool.query(
    `UPDATE notes SET legacy_sections = CASE WHEN jsonb_array_length(sections) = 3 THEN COALESCE(legacy_sections, sections) ELSE legacy_sections END,
     sections = $1::jsonb, version = version + 1, updated_at = CURRENT_TIMESTAMP
     WHERE date = $2 AND version = $3 RETURNING ${noteColumns}`,
    [JSON.stringify(sections), req.params.date, version],
  );
  if (!result.rowCount) return res.status(409).json({ error: 'Version conflict' });
  res.json(result.rows[0]);
}));

// Use server-generated names and known extensions, never a client-supplied path.
const mediaExtensions = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/avif': '.avif', 'image/bmp': '.bmp',
  'image/heic': '.heic', 'image/heif': '.heif',
  'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/aac': '.aac',
  'audio/ogg': '.oga', 'audio/wav': '.wav', 'audio/webm': '.weba',
  'audio/flac': '.flac', 'audio/x-wav': '.wav',
  'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv',
  'video/quicktime': '.mov', 'video/x-matroska': '.mkv',
};
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, callback) => callback(null, randomUUID() + mediaExtensions[file.mimetype]),
  }),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!Object.hasOwn(mediaExtensions, file.mimetype)) {
      return callback(Object.assign(new Error('Unsupported media type'), { status: 415 }));
    }
    callback(null, true);
  },
});
app.post('/api/media', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'A file is required' });
  res.status(201).json({ url: `/media/${req.file.filename}`, name: req.file.originalname, type: req.file.mimetype });
});
app.use('/media', express.static(uploadsDir, { setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff') }));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message });
  }
  if (err.status && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await mkdir(uploadsDir, { recursive: true });
  await pool.query(`CREATE TABLE IF NOT EXISTS notes (
    date date PRIMARY KEY,
    sections jsonb NOT NULL DEFAULT '[{},{},{}]'::jsonb,
    version integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query('ALTER TABLE notes ADD COLUMN IF NOT EXISTS legacy_sections jsonb');
  app.listen(3001, '127.0.0.1', () => console.log('API listening on http://127.0.0.1:3001'));
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  pool.end().finally(() => { process.exitCode = 1; });
});
