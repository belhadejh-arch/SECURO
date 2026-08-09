const { Pool } = require("pg");
const bcrypt = require("bcryptjs");

const databaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
const email = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const name = String(process.env.ADMIN_NAME || "مدير المنصة").trim();
const password = String(process.env.ADMIN_PASSWORD || "");

if (!databaseUrl || !email || !password) {
  throw new Error("NEON_DATABASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD are required");
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

(async () => {
  const hash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, name, referral_code, is_admin)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       name = EXCLUDED.name,
       is_admin = TRUE,
       updated_at = NOW()
     RETURNING id, email, name, referral_code`,
    [email, hash, name, generateCode()],
  );
  console.log(JSON.stringify(result.rows[0]));
  await pool.end();
})().catch(async (error) => {
  console.error(error.message);
  await pool.end();
  process.exit(1);
});