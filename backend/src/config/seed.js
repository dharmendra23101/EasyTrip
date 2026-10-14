/**
 * Deterministic sample data for development and tests (IMP-095).
 *
 * Everything here is fixed: ids, ratings, timestamps, uids. Nothing is randomised and nothing is
 * derived from the clock, because a fixture that changes between runs turns a real regression into
 * "probably just the seed" — and turns a flaky test into something nobody can reproduce.
 *
 * `rating_sum` / `rating_count` on `places` are deliberately NOT set here. A trigger maintains
 * them from `place_reviews` (migration 006), so writing them by hand would seed a database whose
 * aggregates disagree with its own reviews — and would hide the trigger being missing, which is
 * exactly the bug migration 006 exists to fix.
 */

/** Fixed uids, so a test can assert "this review belongs to that user" without a lookup. */
const USERS = [
  {
    firebase_uid: 'seed-admin-uid',
    email: 'admin@easytrip.test',
    name: 'Ada Admin',
    is_admin: true
  },
  {
    firebase_uid: 'seed-user-uid',
    email: 'traveller@easytrip.test',
    name: 'Tom Traveller',
    is_admin: false
  },
  {
    firebase_uid: 'seed-other-uid',
    email: 'other@easytrip.test',
    name: 'Otto Other',
    is_admin: false
  }
];

/**
 * Four places, chosen to cover the shapes the read paths branch on rather than to look plausible:
 * one fully populated, one with no coordinates, one with no image, one with neither and no reviews.
 */
const PLACES = [
  {
    name: 'Hampi',
    description: 'The ruined capital of Vijayanagara, spread across a boulder-strewn landscape.',
    location: 'Hampi',
    district: 'Ballari',
    state: 'Karnataka',
    locality: 'Hampi Bazaar',
    pin_code: '583239',
    latitude: 15.335,
    longitude: 76.46,
    // The one seeded place whose coordinates are attributed to a geocoder (IMP-127), so the ODbL
    // notice has a fixture that renders it and the three places below have one that must not.
    // Both directions matter: an attribution nobody can see is the bug, and an attribution on
    // hand-typed coordinates is the bug the conditional exists to avoid.
    coordinates_source: 'nominatim',
    primary_image_url: 'https://res.cloudinary.com/demo/image/upload/v1/hampi.jpg',
    themes: ['historical', 'adventure'],
    tags: ['unesco', 'ruins', 'photography'],
    custom_keys: { 'Best Time to Visit': 'October to February', 'Entrance Fee': '₹40' }
  },
  {
    // No coordinates: the detail page's map card and the explore map must both handle this.
    name: 'Coorg',
    description: 'Coffee country in the Western Ghats.',
    location: 'Madikeri',
    district: 'Kodagu',
    state: 'Karnataka',
    locality: null,
    pin_code: '571201',
    latitude: null,
    longitude: null,
    primary_image_url: 'https://res.cloudinary.com/demo/image/upload/v1/coorg.jpg',
    themes: ['nature'],
    tags: ['coffee', 'hills'],
    custom_keys: {}
  },
  {
    // No image: exercises the placeholder SVG path and the gallery-derived fallback.
    name: 'Gokarna',
    description: 'A temple town with a quieter coastline than Goa.',
    location: 'Gokarna',
    district: 'Uttara Kannada',
    state: 'Karnataka',
    locality: null,
    pin_code: '581326',
    latitude: 14.55,
    longitude: 74.32,
    primary_image_url: null,
    themes: ['beach', 'religious'],
    tags: ['temples', 'beaches'],
    custom_keys: { 'Opening Hours': '24 hours' }
  },
  {
    // Neither image nor reviews: the "no ratings yet" branch must not render zero stars.
    name: 'Badami',
    description: 'Rock-cut cave temples above an artificial lake.',
    location: 'Badami',
    district: 'Bagalkot',
    state: 'Karnataka',
    locality: null,
    pin_code: '587201',
    latitude: 15.918,
    longitude: 75.68,
    primary_image_url: null,
    themes: ['historical'],
    tags: ['caves'],
    custom_keys: {}
  }
];

/** Reviews on places 1 and 3 only, so places 2 and 4 exercise the unrated path. */
const REVIEWS = [
  {
    place: 1,
    user_id: 'seed-user-uid',
    user_name: 'Tom Traveller',
    rating: 5,
    comment: 'Unreal at sunrise.'
  },
  {
    place: 1,
    user_id: 'seed-other-uid',
    user_name: 'Otto Other',
    rating: 4,
    comment: 'Bring water and good shoes.'
  },
  {
    place: 3,
    user_id: 'seed-user-uid',
    user_name: 'Tom Traveller',
    rating: 3,
    comment: 'Crowded in season.'
  }
];

/** Gallery rows for place 1 only. */
const IMAGES = [
  {
    place: 1,
    image_url: 'https://res.cloudinary.com/demo/image/upload/v1/hampi-2.jpg',
    caption: 'Virupaksha temple',
    display_order: 1
  },
  {
    place: 1,
    image_url: 'https://res.cloudinary.com/demo/image/upload/v1/hampi-3.jpg',
    caption: 'Stone chariot',
    display_order: 2
  }
];

/**
 * Delete every row and restart the id sequences.
 *
 * Sequences are restarted so seeded ids are 1..4 on every run — without it a second seed produces
 * places 5..8 and every test that references "place 1" silently changes meaning.
 */
async function reset(pool) {
  await pool.query(
    // `user_saved_places` is listed rather than left to CASCADE. TRUNCATE ... CASCADE would reach
    // it anyway through its `places` foreign key, but relying on that means the reset silently
    // stops covering a table the day its FK changes — and a suite that leaves rows behind fails as
    // "test order dependence", which is the hardest kind of failure to attribute.
    'TRUNCATE place_reviews, place_images, review_reports, user_saved_places, trip_items, trip_days, trips, places, users, newsletter_subscribers RESTART IDENTITY CASCADE'
  );
}

/** Insert the fixtures. Assumes an empty database — call `reset` first. */
async function seed(pool) {
  for (const u of USERS) {
    await pool.query(
      'INSERT INTO users (firebase_uid, email, name, is_admin) VALUES ($1, $2, $3, $4)',
      [u.firebase_uid, u.email, u.name, u.is_admin]
    );
  }

  for (const p of PLACES) {
    await pool.query(
      `INSERT INTO places
         (name, description, location, district, state, locality, pin_code, latitude, longitude,
          coordinates_source, primary_image_url, themes, tags, custom_keys, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
      [
        p.name,
        p.description,
        p.location,
        p.district,
        p.state,
        p.locality,
        p.pin_code,
        p.latitude,
        p.longitude,
        p.coordinates_source ?? null,
        p.primary_image_url,
        p.themes,
        p.tags,
        JSON.stringify(p.custom_keys),
        'seed-admin-uid'
      ]
    );
  }

  for (const i of IMAGES) {
    await pool.query(
      'INSERT INTO place_images (place_id, image_url, caption, display_order) VALUES ($1,$2,$3,$4)',
      [i.place, i.image_url, i.caption, i.display_order]
    );
  }

  // Last, so the rating trigger fires with the places already in place.
  for (const r of REVIEWS) {
    await pool.query(
      'INSERT INTO place_reviews (place_id, user_id, user_name, rating, comment) VALUES ($1,$2,$3,$4,$5)',
      [r.place, r.user_id, r.user_name, r.rating, r.comment]
    );
  }
}

/** Wipe and re-seed. What tests call between suites, and what `npm run seed` runs. */
async function reseed(pool) {
  await reset(pool);
  await seed(pool);
}

module.exports = { USERS, PLACES, REVIEWS, IMAGES, reset, seed, reseed };
