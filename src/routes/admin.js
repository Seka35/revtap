const express = require('express');
const pool = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.redirect('/admin/login');
}

function buildUrl(code, source) {
  const base = process.env.BASE_URL.replace(/\/$/, '');
  return `${base}/r/${code}?s=${source}`;
}

// ---------- Auth ----------

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', express.urlencoded({ extended: true }), (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin');
  }
  return res.render('login', { error: 'Incorrect password.' });
});

router.get('/logout', (req, res) => {
  req.session = null;
  res.redirect('/admin/login');
});

// Everything below requires auth
router.use(requireAuth);

// ---------- Dashboard ----------

router.get('/', async (req, res) => {
  const filter = req.query.filter || 'all';
  let dateFilterStr = '';
  let currentFilterLabel = 'All Time';
  let groupBy = "TO_CHAR(scanned_at AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD')";

  if (filter === '24h') {
    dateFilterStr = "AND scanned_at >= NOW() - INTERVAL '24 HOURS'";
    currentFilterLabel = 'Last 24h';
    groupBy = "TO_CHAR(scanned_at AT TIME ZONE 'Asia/Makassar', 'MM-DD HH24:00')";
  } else if (filter === 'yesterday') {
    dateFilterStr = "AND (scanned_at AT TIME ZONE 'Asia/Makassar') >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Makassar' - INTERVAL '1 DAY') AND (scanned_at AT TIME ZONE 'Asia/Makassar') < date_trunc('day', NOW() AT TIME ZONE 'Asia/Makassar')";
    currentFilterLabel = 'Yesterday';
    groupBy = "TO_CHAR(scanned_at AT TIME ZONE 'Asia/Makassar', 'MM-DD HH24:00')";
  } else if (filter === 'week') {
    dateFilterStr = "AND (scanned_at AT TIME ZONE 'Asia/Makassar') >= date_trunc('week', NOW() AT TIME ZONE 'Asia/Makassar')";
    currentFilterLabel = 'This Week';
  }

  const { rows: tags } = await pool.query(`
    SELECT t.*,
      COALESCE(s.nfc_count, 0) AS nfc_count,
      COALESCE(s.qr_count, 0) AS qr_count,
      s.last_scan
    FROM tags t
    LEFT JOIN (
      SELECT code, 
             COUNT(*) FILTER (WHERE source = 'nfc') AS nfc_count,
             COUNT(*) FILTER (WHERE source = 'qr') AS qr_count,
             MAX(scanned_at) AS last_scan
      FROM scans 
      WHERE 1=1 ${dateFilterStr}
      GROUP BY code
    ) s ON s.code = t.code
    ORDER BY t.created_at DESC
  `);

  const { rows: totals } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM tags) AS total_tags,
      (SELECT COUNT(*) FROM tags WHERE active) AS active_tags,
      (SELECT COUNT(*) FROM scans WHERE 1=1 ${dateFilterStr}) AS total_scans,
      (SELECT COALESCE(SUM(price_paid),0) FROM tags WHERE active) AS total_revenue
  `);

  const { rows: chartRows } = await pool.query(`
    SELECT 
      ${groupBy} as period,
      COUNT(*) FILTER (WHERE source = 'nfc') as nfc,
      COUNT(*) FILTER (WHERE source = 'qr') as qr
    FROM scans
    WHERE 1=1 ${dateFilterStr}
    GROUP BY period
    ORDER BY period ASC
  `);

  const chartData = chartRows.map(r => ({
    date: r.period,
    nfc: parseInt(r.nfc, 10),
    qr: parseInt(r.qr, 10)
  }));

  res.render('dashboard', { 
    tags, 
    totals: totals[0], 
    baseUrl: process.env.BASE_URL,
    currentFilter: filter,
    currentFilterLabel,
    chartData
  });
});

// ---------- Create tag ----------

router.get('/tags/new', (req, res) => {
  res.render('tag-form', { tag: null, error: null });
});

router.post('/tags', express.urlencoded({ extended: true }), async (req, res) => {
  const { code, business_name, review_url, price_paid, notes, client_whatsapp } = req.body;
  const cleanCode = (code || '').trim().toLowerCase();

  if (!cleanCode || !/^[a-z0-9-]+$/.test(cleanCode)) {
    return res.render('tag-form', {
      tag: req.body,
      error: 'Code must contain only lowercase letters, numbers, and dashes (e.g., a1, cafe-bali-3).'
    });
  }

  try {
    await pool.query(
      `INSERT INTO tags (code, business_name, review_url, price_paid, notes, active, sold_at, client_whatsapp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        cleanCode,
        business_name || null,
        review_url || null,
        price_paid ? parseInt(price_paid, 10) : null,
        notes || null,
        !!review_url,
        review_url ? new Date() : null,
        client_whatsapp || null
      ]
    );
    res.redirect('/admin');
  } catch (err) {
    if (err.code === '23505') {
      return res.render('tag-form', { tag: req.body, error: `The code "${cleanCode}" already exists.` });
    }
    console.error(err);
    res.render('tag-form', { tag: req.body, error: 'Server error, please try again.' });
  }
});

// ---------- Bulk generate empty codes ----------

router.get('/bulk', (req, res) => {
  res.render('bulk-form', { error: null });
});

router.post('/bulk', express.urlencoded({ extended: true }), async (req, res) => {
  const prefix = (req.body.prefix || 'a').trim().toLowerCase();
  const count = Math.min(parseInt(req.body.count, 10) || 0, 200);

  if (!count || !/^[a-z0-9-]+$/.test(prefix)) {
    return res.render('bulk-form', { error: 'Invalid prefix or quantity.' });
  }

  const codes = [];
  for (let i = 1; i <= count; i++) codes.push(`${prefix}${i}`);

  try {
    for (const code of codes) {
      await pool.query(
        `INSERT INTO tags (code, active) VALUES ($1, false) ON CONFLICT (code) DO NOTHING`,
        [code]
      );
    }
    res.redirect(`/admin/print?codes=${codes.join(',')}`);
  } catch (err) {
    console.error(err);
    res.render('bulk-form', { error: 'Server error, please try again.' });
  }
});

// ---------- Print sheet ----------

router.get('/print', async (req, res) => {
  const codes = (req.query.codes || '').split(',').filter(Boolean);
  let tags;
  if (codes.length) {
    const { rows } = await pool.query('SELECT code FROM tags WHERE code = ANY($1) ORDER BY code', [codes]);
    tags = rows;
  } else {
    const { rows } = await pool.query('SELECT code FROM tags ORDER BY code');
    tags = rows;
  }

  const items = tags.map(t => ({
    code: t.code,
    qrUrl: buildUrl(t.code, 'qr')
  }));

  res.render('print', { items });
});

// ---------- Edit / view single tag ----------

router.get('/tags/:code', async (req, res) => {
  const code = req.params.code.toLowerCase();
  const { rows } = await pool.query('SELECT * FROM tags WHERE code = $1', [code]);
  const tag = rows[0];
  if (!tag) return res.status(404).send('Tag not found.');

  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  const { rows: scanRows } = await pool.query(
    'SELECT * FROM scans WHERE code = $1 ORDER BY scanned_at DESC LIMIT $2 OFFSET $3',
    [code, limit, offset]
  );

  const { rows: statsRows } = await pool.query(
    `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE source = 'nfc') AS nfc_count,
      COUNT(*) FILTER (WHERE source = 'qr') AS qr_count
     FROM scans WHERE code = $1`,
    [code]
  );

  const totalScans = parseInt(statsRows[0].total, 10);
  const totalPages = Math.ceil(totalScans / limit) || 1;

  const { rows: osStats } = await pool.query(
    `SELECT os_name, COUNT(*) as count 
     FROM scans WHERE code = $1 AND os_name IS NOT NULL 
     GROUP BY os_name ORDER BY count DESC`,
    [code]
  );

  const { rows: langStats } = await pool.query(
    `SELECT browser_lang, COUNT(*) as count 
     FROM scans WHERE code = $1 AND browser_lang IS NOT NULL 
     GROUP BY browser_lang ORDER BY count DESC LIMIT 5`,
    [code]
  );

  const { rows: heatmapRows } = await pool.query(
    `SELECT
       EXTRACT(ISODOW FROM scanned_at AT TIME ZONE 'Asia/Makassar') AS dow,
       EXTRACT(HOUR FROM scanned_at AT TIME ZONE 'Asia/Makassar') AS hour,
       COUNT(*) AS count
     FROM scans
     WHERE code = $1
     GROUP BY dow, hour`,
    [code]
  );

  const heatmapData = Array.from({ length: 7 }, () => Array(24).fill(0));
  let maxHeat = 0;
  heatmapRows.forEach(r => {
    const d = parseInt(r.dow) - 1;
    const h = parseInt(r.hour);
    const c = parseInt(r.count);
    heatmapData[d][h] = c;
    if (c > maxHeat) maxHeat = c;
  });

  const { rows: chartRows } = await pool.query(`
    SELECT 
      TO_CHAR(scanned_at AT TIME ZONE 'Asia/Makassar', 'YYYY-MM-DD') as period,
      COUNT(*) FILTER (WHERE source = 'nfc') as nfc,
      COUNT(*) FILTER (WHERE source = 'qr') as qr
    FROM scans
    WHERE code = $1
    GROUP BY period
    ORDER BY period ASC
  `, [code]);

  const chartData = chartRows.map(r => ({
    date: r.period,
    nfc: parseInt(r.nfc, 10),
    qr: parseInt(r.qr, 10)
  }));

  const { rows: latestReviews } = await pool.query(
    `SELECT * FROM google_latest_reviews WHERE code = $1 ORDER BY time DESC`,
    [code]
  );
  
  const { rows: reviewHistory } = await pool.query(
    `SELECT rating, user_ratings_total, fetched_at 
     FROM google_reviews_history 
     WHERE code = $1 
     ORDER BY fetched_at ASC`,
    [code]
  );

  const nfcUrl = buildUrl(code, 'nfc');
  const qrUrl = buildUrl(code, 'qr');

  res.render('tag-detail', {
    tag, scans: scanRows, stats: statsRows[0], osStats, langStats, chartData, page, totalPages, nfcUrl, qrUrl, heatmapData, maxHeat,
    latestReviews, reviewHistory
  });
});

router.post('/tags/:code', express.urlencoded({ extended: true }), async (req, res) => {
  const code = req.params.code.toLowerCase();
  let { business_name, review_url, price_paid, notes, active, client_password, client_whatsapp, google_place_id } = req.body;

  if (google_place_id) {
    google_place_id = google_place_id.trim();
    try {
      const url = new URL(google_place_id);
      const placeIdParam = url.searchParams.get('placeid') || url.searchParams.get('place_id');
      if (placeIdParam) {
        google_place_id = placeIdParam;
      }
    } catch (e) {
      // Ignore URL parsing errors, keep the original string
    }
  }

  const { rows } = await pool.query('SELECT * FROM tags WHERE code = $1', [code]);
  const existing = rows[0];
  const wasActive = existing && existing.active;
  const nowActive = !!active;

  await pool.query(
    `UPDATE tags SET
      business_name = $1,
      review_url = $2,
      price_paid = $3,
      notes = $4,
      active = $5,
      sold_at = CASE WHEN $5 AND NOT $6 THEN now() ELSE sold_at END,
      client_password = $7,
      client_whatsapp = $8,
      google_place_id = $9
     WHERE code = $10`,
    [
      business_name || null,
      review_url || null,
      price_paid ? parseInt(price_paid, 10) : null,
      notes || null,
      nowActive,
      wasActive,
      client_password || null,
      client_whatsapp || null,
      google_place_id || null,
      code
    ]
  );

  res.redirect(`/admin/tags/${code}`);
});

const googlePlaces = require('../services/googlePlaces');

router.post('/tags/:code/fetch-google', async (req, res) => {
  const code = req.params.code.toLowerCase();
  const { rows } = await pool.query('SELECT google_place_id FROM tags WHERE code = $1', [code]);
  if (rows.length > 0 && rows[0].google_place_id) {
    await googlePlaces.updateTagGoogleData(code, rows[0].google_place_id);
  }
  res.redirect(`/admin/tags/${code}`);
});

router.post('/tags/:code/delete', async (req, res) => {
  const code = req.params.code.toLowerCase();
  await pool.query('DELETE FROM tags WHERE code = $1', [code]);
  res.redirect('/admin');
});

router.post('/tags/:code/reset', async (req, res) => {
  const code = req.params.code.toLowerCase();
  await pool.query('DELETE FROM scans WHERE code = $1', [code]);
  await pool.query('DELETE FROM google_reviews_history WHERE code = $1', [code]);
  await pool.query('DELETE FROM google_latest_reviews WHERE code = $1', [code]);
  res.redirect(`/admin/tags/${code}`);
});

router.post('/tags/:code/mockup', async (req, res) => {
  const code = req.params.code.toLowerCase();
  const numScans = Math.floor(Math.random() * 50) + 50;
  const devices = [
    { v: 'Apple iPhone 14', os: 'iOS', b: 'Safari' },
    { v: 'Apple iPhone 13', os: 'iOS', b: 'Safari' },
    { v: 'Apple iPhone 15 Pro', os: 'iOS', b: 'Instagram WebView' },
    { v: 'Samsung Galaxy S22', os: 'Android', b: 'Chrome' },
    { v: 'Samsung Galaxy S23', os: 'Android', b: 'Chrome' },
    { v: 'Xiaomi Redmi Note 11', os: 'Android', b: 'Chrome' }
  ];
  const cities = ['Canggu', 'Seminyak', 'Kuta', 'Ubud', 'Denpasar'];
  const langs = ['EN', 'EN', 'EN', 'FR', 'ID', 'RU', 'DE'];
  
  const insertPromises = [];
  
  for (let i = 0; i < numScans; i++) {
    const dev = devices[Math.floor(Math.random() * devices.length)];
    const city = cities[Math.floor(Math.random() * cities.length)];
    const lang = langs[Math.floor(Math.random() * langs.length)];
    const source = Math.random() > 0.3 ? 'nfc' : 'qr';
    const pastDays = Math.random() * 30; // Random time in the past 30 days
    const fakeIp = `114.124.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
    
    const query = `
      INSERT INTO scans (code, source, user_agent, ip_address, device_vendor, os_name, browser_name, browser_lang, country, city, scanned_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW() - INTERVAL '${pastDays} DAYS')
    `;
    
    insertPromises.push(pool.query(query, [
      code, source, 'Mockup', fakeIp, dev.v, dev.os, dev.b, lang, 'ID', city
    ]));
  }
  
  await Promise.all(insertPromises);

  // Mockup Google Reviews
  await pool.query('DELETE FROM google_reviews_history WHERE code = $1', [code]);
  await pool.query('DELETE FROM google_latest_reviews WHERE code = $1', [code]);
  
  let currentRating = 4.2;
  let currentTotal = 110;
  for (let d = 30; d >= 0; d--) {
    if (Math.random() > 0.5) {
      currentTotal += Math.floor(Math.random() * 3);
      currentRating += (Math.random() * 0.05);
      if (currentRating > 4.9) currentRating = 4.9;
    }
    await pool.query(
      `INSERT INTO google_reviews_history (code, rating, user_ratings_total, fetched_at)
       VALUES ($1, $2, $3, NOW() - INTERVAL '${d} DAYS')`,
      [code, currentRating.toFixed(2), currentTotal]
    );
  }

  const fakeNames = ["John Doe", "Made Suardana", "Sarah Smith", "Ketut", "Elena V."];
  const fakeTexts = [
    "Amazing place! Highly recommend it.",
    "Bagus sekali, pelayanannya ramah.",
    "Best experience I had in Bali so far.",
    "Very good quality and fast service.",
    "Loved it, will definitely come back!"
  ];
  for (let i = 0; i < 5; i++) {
    await pool.query(
      `INSERT INTO google_latest_reviews (code, author_name, rating, text, time)
       VALUES ($1, $2, $3, $4, $5)`,
      [code, fakeNames[i], 5, fakeTexts[i], Math.floor(Date.now() / 1000) - (i * 86400)]
    );
  }

  res.redirect(`/admin/tags/${code}`);
});

module.exports = router;
