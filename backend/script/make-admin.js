require('dotenv').config({ path: '../.env' });
// `firebase-admin` v13 removed the single-namespace export, so this operator script imports the
// modular API like the server does. No test covers this file — it is a CLI — which is exactly why
// it is worth migrating deliberately rather than leaving it to fail in somebody's hands later.
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// Function to check if file exists
function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch (error) {
    return false;
  }
}

// Initialize Firebase Admin
try {
  // First, check if a service account file exists
  const serviceAccountPath = path.join(__dirname, '../service-account.json');

  if (fileExists(serviceAccountPath)) {
    // Use service account file if it exists
    const serviceAccount = require(serviceAccountPath);
    initializeApp({
      credential: cert(serviceAccount)
    });
    console.log('Firebase initialized with service account file.');
  } else if (
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  ) {
    // Use environment variables if service account file doesn't exist
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      })
    });
    console.log('Firebase initialized with environment variables.');
  } else {
    console.error('Error: No Firebase credentials found.');
    console.error('Please either:');
    console.error('1. Create a service-account.json file in the backend directory, or');
    console.error(
      '2. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY in your .env file'
    );
    process.exit(1);
  }
} catch (error) {
  console.error('Error initializing Firebase:', error);
  process.exit(1);
}

// Initialize PostgreSQL with better error handling
let pool;
try {
  if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL environment variable is not set.');
    console.error('Please set it in your .env file.');
    process.exit(1);
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL
  });
  console.log('PostgreSQL pool initialized.');
} catch (error) {
  console.error('Error initializing PostgreSQL pool:', error);
  process.exit(1);
}

// The email of the user you want to make an admin
const email = process.argv[2];

if (!email) {
  console.error('Please provide an email address as an argument.');
  console.error('Usage: node make-admin.js <email>');
  process.exit(1);
}

async function makeAdmin() {
  try {
    console.log(`Attempting to make ${email} an admin...`);

    // Test database connection
    try {
      await pool.query('SELECT NOW()');
      console.log('Database connection successful.');
    } catch (dbError) {
      console.error('Database connection failed:', dbError.message);
      console.error('Please check your DATABASE_URL environment variable.');
      process.exit(1);
    }

    // Get user from Firebase
    let userRecord;
    try {
      userRecord = await getAuth().getUserByEmail(email);
      console.log(`Found user in Firebase: ${userRecord.uid}`);
    } catch (error) {
      console.error(`Error: User with email ${email} not found in Firebase.`);
      console.error('Make sure the user has registered with Firebase Authentication.');
      process.exit(1);
    }

    // Check if users table exists and create it if it doesn't
    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'users'
        );
      `);

      if (!tableCheck.rows[0].exists) {
        console.log('Users table does not exist. Creating it now...');
        await pool.query(`
          CREATE TABLE users (
            id SERIAL PRIMARY KEY,
            firebase_uid VARCHAR(255) UNIQUE NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            name VARCHAR(255),
            is_admin BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
          CREATE INDEX idx_users_firebase_uid ON users(firebase_uid);
        `);
        console.log('Users table created successfully.');
      }
    } catch (error) {
      console.error('Error checking or creating users table:', error);
      process.exit(1);
    }

    // Check if user exists in database
    const userResult = await pool.query('SELECT * FROM users WHERE firebase_uid = $1', [
      userRecord.uid
    ]);

    if (userResult.rows.length > 0) {
      // User exists, update admin status
      await pool.query(
        'UPDATE users SET is_admin = true, updated_at = NOW() WHERE firebase_uid = $1',
        [userRecord.uid]
      );
      console.log(`Updated existing user ${email} to admin status.`);
    } else {
      // User doesn't exist, add to database
      await pool.query(
        'INSERT INTO users (firebase_uid, email, name, is_admin, created_at, updated_at) VALUES ($1, $2, $3, true, NOW(), NOW())',
        [userRecord.uid, userRecord.email, userRecord.displayName || '']
      );
      console.log(`Added new user ${email} with admin status.`);
    }

    // Also set custom claims in Firebase (optional but recommended)
    try {
      await getAuth().setCustomUserClaims(userRecord.uid, { admin: true });
      console.log('Set admin custom claim in Firebase Authentication.');
    } catch (error) {
      console.warn('Warning: Could not set Firebase custom claims:', error.message);
      console.warn('The user will still be an admin in the database.');
    }

    console.log(`Success! ${email} is now an admin.`);
  } catch (error) {
    console.error('Error making user an admin:', error);
  } finally {
    await pool.end();
    process.exit();
  }
}

makeAdmin();
