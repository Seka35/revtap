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

  const { rows: scanRows } = await pool.query(
    `SELECT * FROM scans WHERE code = $1 ${dateFilterStr} ORDER BY scanned_at DESC LIMIT 50`,
    [code]
  );

  const { rows: statsRows } = await pool.query(
    `SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE source = 'nfc') AS nfc_count,
      COUNT(*) FILTER (WHERE source = 'qr') AS qr_count
     FROM scans WHERE code = $1 ${dateFilterStr}`,
    [code]
  );

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

  res.render('client-dashboard', {
    code,
    business_name: tag.business_name,
    client_whatsapp: tag.client_whatsapp,
    scans: scanRows,
    stats: statsRows[0],
    currentFilter: filter,
    currentFilterLabel,
    chartData
  });
});

module.exports = router;
