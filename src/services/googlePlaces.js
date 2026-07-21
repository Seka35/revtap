const pool = require('../db');

async function fetchGooglePlaceData(placeId) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY is not defined.');
    return null;
  }
  
  let cleanPlaceId = placeId;
  try {
    const url = new URL(placeId);
    const idParam = url.searchParams.get('placeid') || url.searchParams.get('place_id');
    if (idParam) cleanPlaceId = idParam;
  } catch (e) {
    // Not a URL, use as is
  }
  
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${cleanPlaceId}&fields=rating,user_ratings_total,reviews&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === 'OK') {
      return data.result; // { rating, user_ratings_total, reviews: [...] }
    } else {
      console.error(`Google Places API Error for ${placeId}:`, data.status, data.error_message);
      return null;
    }
  } catch (err) {
    console.error(`Fetch failed for ${placeId}:`, err);
    return null;
  }
}

async function searchPlaces(query) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === 'OK') {
      return data.predictions.map(p => ({
        place_id: p.place_id,
        name: p.structured_formatting ? p.structured_formatting.main_text : p.description.split(',')[0],
        formatted_address: p.description
      }));
    }
    console.error('Google API Error:', data.status, data.error_message);
    return [];
  } catch (err) {
    console.error('Search places error:', err);
    return [];
  }
}

async function updateTagGoogleData(code, placeId) {
  const result = await fetchGooglePlaceData(placeId);
  if (!result) return false;

  const { rating, user_ratings_total, reviews } = result;

  if (rating != null && user_ratings_total != null) {
    await pool.query(
      `INSERT INTO google_reviews_history (code, rating, user_ratings_total) VALUES ($1, $2, $3)`,
      [code, rating, user_ratings_total]
    );
  }

  if (reviews && reviews.length > 0) {
    // Delete old latest reviews for this code
    await pool.query(`DELETE FROM google_latest_reviews WHERE code = $1`, [code]);
    // Insert new top 5
    const limit = Math.min(reviews.length, 5);
    for (let i = 0; i < limit; i++) {
      const r = reviews[i];
      await pool.query(
        `INSERT INTO google_latest_reviews (code, author_name, profile_photo_url, rating, text, time)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [code, r.author_name, r.profile_photo_url, r.rating, r.text, r.time]
      );
    }
  }
  return true;
}

async function runDailyJob() {
  console.log('Starting daily Google Places data fetch...');
  const { rows: tags } = await pool.query(`SELECT code, google_place_id FROM tags WHERE active = true AND google_sync = true AND google_place_id IS NOT NULL`);
  for (const tag of tags) {
    console.log(`Fetching data for ${tag.code}...`);
    await updateTagGoogleData(tag.code, tag.google_place_id);
    // Simple delay to avoid rate limits
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('Daily fetch complete.');
}

module.exports = {
  fetchGooglePlaceData,
  updateTagGoogleData,
  runDailyJob,
  searchPlaces
};
