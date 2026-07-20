const express = require('express');
const pool = require('../db');

const router = express.Router();

// Middleware to ensure client is authenticated for a specific tag
function requireClientAuth(req, res, next) {
  const code = req.params.code.toLowerCase();
  if (req.session && req.session.clientAuth && req.session.clientAuth[code]) {
    return next();
  }
  return res.redirect(`/client/${code}/login`);
}

router.get('/:code/login', async (req, res) => {
  const code = req.params.code.toLowerCase();
  const { rows } = await pool.query('SELECT business_name, client_password FROM tags WHERE code = $1', [code]);
  const tag = rows[0];

  if (!tag) return res.status(404).send('Tag not found.');
  if (!tag.client_password) return res.status(403).send('Client access is not enabled for this card.');

  res.render('client-login', { code, business_name: tag.business_name, error: null });
});

router.post('/:code/login', express.urlencoded({ extended: true }), async (req, res) => {
  const code = req.params.code.toLowerCase();
  const { password } = req.body;

  const { rows } = await pool.query('SELECT business_name, client_password FROM tags WHERE code = $1', [code]);
  const tag = rows[0];

  if (!tag || !tag.client_password) {
    return res.status(403).send('Access denied.');
  }

  if (password === tag.client_password) {
    if (!req.session.clientAuth) req.session.clientAuth = {};
    req.session.clientAuth[code] = true;
    return res.redirect(`/client/${code}`);
  }

  return res.render('client-login', { code, business_name: tag.business_name, error: 'Incorrect password.' });
});

router.get('/:code/logout', (req, res) => {
  const code = req.params.code.toLowerCase();
  if (req.session && req.session.clientAuth) {
    req.session.clientAuth[code] = false;
  }
  res.redirect(`/client/${code}/login`);
});

router.get('/:code', requireClientAuth, async (req, res) => {
  const code = req.params.code.toLowerCase();
  
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
  
  const { rows: tagRows } = await pool.query('SELECT business_name, client_whatsapp FROM tags WHERE code = $1', [code]);
  const tag = tagRows[0];

  const page = parseInt(req.query.page) || 1;
  const limit = 10;
  const offset = (page - 1) * limit;

  const { rows: scanRows } = await pool.query(
    `SELECT * FROM scans WHERE code = $1 ${dateFilterStr} ORDER BY scanned_at DESC LIMIT $2 OFFSET $3`,
    [code, limit, offset]
  );

  const { rows: statsRows } = await pool.query(
    `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE source = 'nfc') AS nfc_count,
      COUNT(*) FILTER (WHERE source = 'qr') AS qr_count
     FROM scans WHERE code = $1 ${dateFilterStr}`,
    [code]
  );

  const totalScans = parseInt(statsRows[0].total, 10) || 0;
  const totalPages = Math.ceil(totalScans / limit) || 1;

  const { rows: chartRows } = await pool.query(`
    SELECT 
      ${groupBy} as period,
      COUNT(*) FILTER (WHERE source = 'nfc') as nfc,
      COUNT(*) FILTER (WHERE source = 'qr') as qr
    FROM scans
    WHERE code = $1 ${dateFilterStr}
    GROUP BY period
    ORDER BY period ASC
  `, [code]);

  const chartData = chartRows.map(r => ({
    date: r.period,
    nfc: parseInt(r.nfc, 10),
    qr: parseInt(r.qr, 10)
  }));

  const { rows: osStats } = await pool.query(
    `SELECT os_name, COUNT(*) as count 
     FROM scans WHERE code = $1 AND os_name IS NOT NULL ${dateFilterStr}
     GROUP BY os_name ORDER BY count DESC`,
    [code]
  );

  const { rows: langStats } = await pool.query(
    `SELECT browser_lang, COUNT(*) as count 
     FROM scans WHERE code = $1 AND browser_lang IS NOT NULL ${dateFilterStr}
     GROUP BY browser_lang ORDER BY count DESC LIMIT 5`,
    [code]
  );

  const { rows: heatmapRows } = await pool.query(
    `SELECT
       EXTRACT(ISODOW FROM scanned_at AT TIME ZONE 'Asia/Makassar') AS dow,
       EXTRACT(HOUR FROM scanned_at AT TIME ZONE 'Asia/Makassar') AS hour,
       COUNT(*) AS count
     FROM scans
     WHERE code = $1 ${dateFilterStr}
     GROUP BY dow, hour`
    , [code]
  );

  // Initialize 7x24 matrix (day 1-7, hour 0-23)
  const heatmapData = Array.from({ length: 7 }, () => Array(24).fill(0));
  let maxHeat = 0;
  heatmapRows.forEach(r => {
    // dow is 1 (Mon) to 7 (Sun). array index is dow - 1
    const d = parseInt(r.dow) - 1;
    const h = parseInt(r.hour);
    const c = parseInt(r.count);
    heatmapData[d][h] = c;
    if (c > maxHeat) maxHeat = c;
  });

  res.render('client-dashboard', {
    code,
    business_name: tag.business_name,
    client_whatsapp: tag.client_whatsapp,
    scans: scanRows,
    stats: statsRows[0],
    osStats,
    langStats,
    currentFilter: filter,
    currentFilterLabel,
    chartData,
    page,
    totalPages,
    heatmapData,
    maxHeat
  });
});

module.exports = router;
