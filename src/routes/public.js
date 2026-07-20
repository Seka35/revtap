const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /r/:code?s=nfc|qr  (mounted at /r in server.js, so this route is just /:code)
// This is the URL written on the NFC tag and encoded in the QR code.
// It looks up the destination review URL and redirects there, logging the scan first.
router.get('/:code', async (req, res) => {
  const code = req.params.code.toLowerCase();
  const source = req.query.s === 'qr' ? 'qr' : (req.query.s === 'nfc' ? 'nfc' : null);

  try {
    const { rows } = await pool.query('SELECT * FROM tags WHERE code = $1', [code]);
    const tag = rows[0];

    if (!tag) {
      return res.status(404).render('not-found', { code });
    }

    // Log the scan (fire and forget style, but awaited to keep it simple/reliable)
    pool.query(
      'INSERT INTO scans (code, source, user_agent) VALUES ($1, $2, $3)',
      [code, source, req.headers['user-agent'] || null]
    ).catch(err => console.error('Failed to log scan:', err));

    if (!tag.active || !tag.review_url) {
      return res.render('not-active', { code });
    }

    return res.redirect(302, tag.review_url);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Something went wrong.');
  }
});

module.exports = router;
