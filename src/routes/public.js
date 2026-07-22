const express = require('express');
const pool = require('../db');
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');

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

    // --- Tracking logic ---
    const uaString = req.headers['user-agent'] || '';
    const parser = new UAParser(uaString);
    
    // IP extraction (handles Cloudflare and standard proxies like nginx/traefik)
    const ip = req.headers['cf-connecting-ip'] || 
               (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) || 
               req.socket.remoteAddress || 
               null;
    
    // GeoIP lookup
    const geo = ip ? geoip.lookup(ip) : null;
    const country = geo ? geo.country : null;
    const city = geo ? geo.city : null;

    // Accept-Language
    const langHeader = req.headers['accept-language'] || '';
    const browserLang = langHeader ? langHeader.split(',')[0].trim().substring(0, 2).toUpperCase() : null;

    // UA parsing
    const device = parser.getDevice();
    const os = parser.getOS();
    const browser = parser.getBrowser();

    let deviceVendor = device.vendor ? `${device.vendor} ${device.model || ''}`.trim() : null;
    if (!deviceVendor) {
      if (os.name === 'iOS' || os.name === 'Mac OS') deviceVendor = 'Apple Device';
      else if (os.name === 'Android') deviceVendor = 'Android Device';
      else deviceVendor = device.type ? (device.type.charAt(0).toUpperCase() + device.type.slice(1)) : 'Desktop PC';
    }
    const osName = os.name || null;
    const browserName = browser.name || null;

    // Log the scan
    pool.query(
      `INSERT INTO scans (code, source, user_agent, ip_address, device_vendor, os_name, browser_name, browser_lang, country, city) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [code, source, uaString, ip, deviceVendor, osName, browserName, browserLang, country, city]
    ).catch(err => console.error('Failed to log scan:', err));

    if (!tag.active || !tag.review_url) {
      return res.render('not-active', { code });
    }

    // Empêche tout cache (navigateur, in-app browser, proxy/CDN) de figer
    // l'ancienne destination : chaque scan doit relire l'URL à jour.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    return res.redirect(302, tag.review_url);
  } catch (err) {
    console.error(err);
    return res.status(500).send('Something went wrong.');
  }
});

module.exports = router;
