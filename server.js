const path = require("path");
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");

const DATABASE_URL = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
const SESSION_SECRET = process.env.SESSION_SECRET;
if (!DATABASE_URL) {
  throw new Error("NEON_DATABASE_URL is required");
}
if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET is required");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

const app = express();
const PORT = Number(process.env.PORT || 5000);
const publicDir = path.join(__dirname, "attached_assets");

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));
app.use(
  session({
    store: new pgSession({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  }),
);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const statusNames = {
  pending: "قيد الانتظار",
  accepted: "مقبول",
  rejected: "مرفوض",
};
const rates = [0.1, 0.05, 0.01];

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCode(value) {
  return String(value || "").trim();
}

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    inviteCode: row.referral_code,
    isAdmin: Boolean(row.is_admin),
    balance: money(row.balance),
    userVip: row.user_vip || null,
    completedTasksCount: row.completed_tasks_count || 0,
    taskLastResetDate: row.task_last_reset_date,
    lastClaimDate: row.last_claim_date,
    currentTrialDay: row.current_trial_day || 1,
    trialActive: Boolean(row.trial_active),
    trialUsed: Boolean(row.trial_used),
    availableSpins: row.available_spins || 0,
    createdAt: row.created_at,
  };
}

function appError(res, status, message) {
  return res.status(status).json({ error: message });
}

async function getUserById(id) {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0] || null;
}

async function loadUserPayload(userId) {
  const user = await getUserById(userId);
  if (!user) return null;

  const [deposits, withdrawals, transactions, team, commissions] =
    await Promise.all([
      pool.query(
        `SELECT id, amount, txid, network, status, created_at
         FROM deposit_requests WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      ),
      pool.query(
        `SELECT id, bank, account, amount, status, created_at
         FROM withdrawal_requests WHERE user_id = $1 ORDER BY created_at DESC`,
        [userId],
      ),
      pool.query(
        `SELECT id, type, amount, direction, description, created_at
         FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
        [userId],
      ),
      pool.query(
        `WITH RECURSIVE tree AS (
           SELECT u.id, u.name, u.email, 1 AS level, u.created_at
           FROM users u WHERE u.referred_by = $1
           UNION ALL
           SELECT child.id, child.name, child.email, tree.level + 1, child.created_at
           FROM users child JOIN tree ON child.referred_by = tree.id
           WHERE tree.level < 3
         )
         SELECT id, name, email, level, created_at FROM tree
         ORDER BY created_at DESC`,
        [userId],
      ),
      pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM referral_commissions WHERE beneficiary_id = $1`,
        [userId],
      ),
    ]);

  return {
    user: publicUser(user),
    deposits: deposits.rows.map((item) => ({
      title: `إيداع عبر ${item.network} (مرجع: ${item.txid.slice(0, 8)}...)`,
      amount: `+$${money(item.amount).toFixed(2)}`,
      date: item.created_at,
      status: statusNames[item.status],
      id: item.id,
    })),
    withdrawals: withdrawals.rows.map((item) => ({
      bank: item.bank,
      account: item.account,
      amount: `-$${money(item.amount).toFixed(2)}`,
      date: item.created_at,
      status: statusNames[item.status],
      id: item.id,
    })),
    transactions: transactions.rows.map((item) => ({
      title: item.description,
      amount: `${item.direction === "credit" ? "+" : "-"}$${money(item.amount).toFixed(2)}`,
      date: item.created_at,
      type: item.type,
    })),
    teamMembers: team.rows.map((item) => ({
      name: item.name,
      email: item.email,
      level: item.level,
      date: item.created_at,
    })),
    referralEarnings: money(commissions.rows[0].total),
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return appError(res, 401, "يجب تسجيل الدخول أولاً");
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin) {
    return appError(res, 403, "ليس لديك صلاحية المشرف");
  }
  next();
}

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    appError(res, 503, "قاعدة البيانات غير متاحة حالياً");
  }
});

app.post("/api/auth/register", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  const inviteCode = normalizeCode(req.body.inviteCode);

  if (!name) return appError(res, 400, "يرجى كتابة الاسم الكامل");
  if (!emailPattern.test(email)) return appError(res, 400, "البريد الإلكتروني غير صحيح");
  if (password.length < 6) return appError(res, 400, "كلمة المرور يجب ألا تقل عن 6 أحرف");

  try {
    const result = await withTransaction(async (client) => {
      let referrer = null;
      if (inviteCode) {
        const ref = await client.query(
          "SELECT id FROM users WHERE referral_code = $1",
          [inviteCode],
        );
        if (!ref.rowCount) throw Object.assign(new Error("رمز الدعوة غير صالح"), { status: 400 });
        referrer = ref.rows[0];
      }

      const hash = await bcrypt.hash(password, 12);
      let referralCode;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = String(Math.floor(100000 + Math.random() * 900000));
        const exists = await client.query(
          "SELECT 1 FROM users WHERE referral_code = $1",
          [candidate],
        );
        if (!exists.rowCount) {
          referralCode = candidate;
          break;
        }
      }
      if (!referralCode) throw Object.assign(new Error("تعذر إنشاء رمز الدعوة"), { status: 500 });

      const inserted = await client.query(
        `INSERT INTO users (email, password_hash, name, referral_code, referred_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [email, hash, name, referralCode, referrer ? referrer.id : null],
      );
      const user = inserted.rows[0];
      if (referrer) {
        await client.query(
          "INSERT INTO referrals (referrer_id, referred_user_id) VALUES ($1, $2)",
          [referrer.id, user.id],
        );
      }
      return user;
    });

    await new Promise((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    req.session.userId = result.id;
    req.session.isAdmin = false;
    res.status(201).json({ user: publicUser(result) });
  } catch (error) {
    if (error.code === "23505" && error.constraint === "users_email_key") {
      return appError(res, 409, "هذا البريد الإلكتروني مسجل بالفعل");
    }
    appError(res, error.status || 500, error.status ? error.message : "تعذر إنشاء الحساب");
  }
});

app.post("/api/auth/login", async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const password = String(req.body.password || "");
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return appError(res, 401, "البريد الإلكتروني غير مسجل أو كلمة المرور خاطئة");
    }
    await new Promise((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    req.session.userId = user.id;
    req.session.isAdmin = Boolean(user.is_admin);
    res.json({ user: publicUser(user) });
  } catch {
    appError(res, 500, "تعذر تسجيل الدخول");
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const payload = await loadUserPayload(req.session.userId);
    if (!payload) return appError(res, 401, "انتهت الجلسة");
    res.json(payload);
  } catch {
    appError(res, 500, "تعذر تحميل بيانات الحساب");
  }
});

app.patch("/api/me/state", requireAuth, async (req, res) => {
  const allowed = [
    "userVip",
    "completedTasksCount",
    "taskLastResetDate",
    "lastClaimDate",
    "currentTrialDay",
    "trialActive",
    "trialUsed",
    "availableSpins",
  ];
  const values = {
    userVip: req.body.userVip ?? null,
    completedTasksCount: Number(req.body.completedTasksCount || 0),
    taskLastResetDate: req.body.taskLastResetDate || null,
    lastClaimDate: req.body.lastClaimDate || null,
    currentTrialDay: Number(req.body.currentTrialDay || 1),
    trialActive: Boolean(req.body.trialActive),
    trialUsed: Boolean(req.body.trialUsed),
    availableSpins: Number(req.body.availableSpins || 0),
  };
  if (values.completedTasksCount < 0 || values.availableSpins < 0) {
    return appError(res, 400, "بيانات الحالة غير صحيحة");
  }
  try {
    const result = await pool.query(
      `UPDATE users SET
        user_vip = $1::jsonb, completed_tasks_count = $2,
        task_last_reset_date = $3, last_claim_date = $4,
        current_trial_day = $5, trial_active = $6,
        trial_used = $7, available_spins = $8, updated_at = NOW()
       WHERE id = $9 RETURNING *`,
      [
        values.userVip ? JSON.stringify(values.userVip) : null,
        values.completedTasksCount,
        values.taskLastResetDate,
        values.lastClaimDate,
        values.currentTrialDay,
        values.trialActive,
        values.trialUsed,
        values.availableSpins,
        req.session.userId,
      ],
    );
    res.json({ user: publicUser(result.rows[0]) });
  } catch {
    appError(res, 400, "تعذر حفظ حالة الحساب");
  }
});

app.post("/api/deposit-requests", requireAuth, async (req, res) => {
  const amount = Number(req.body.amount);
  const txid = String(req.body.txid || "").trim();
  if (!Number.isFinite(amount) || amount < 10) return appError(res, 400, "الحد الأدنى للإيداع هو 10 دولارات");
  if (!txid || txid.length > 255) return appError(res, 400, "يرجى إدخال معرف المعاملة");
  try {
    const result = await pool.query(
      `INSERT INTO deposit_requests (user_id, amount, txid)
       VALUES ($1, $2, $3) RETURNING id`,
      [req.session.userId, amount.toFixed(2), txid],
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (error) {
    if (error.code === "23505") return appError(res, 409, "معرف المعاملة مستخدم مسبقاً");
    appError(res, 500, "تعذر إرسال طلب الإيداع");
  }
});

app.post("/api/withdrawal-requests", requireAuth, async (req, res) => {
  const bank = String(req.body.bank || "").trim();
  const account = String(req.body.account || "").trim();
  const amount = Number(req.body.amount);
  if (!bank || !account) return appError(res, 400, "يرجى إدخال بيانات المحفظة");
  if (!Number.isFinite(amount) || amount < 10) return appError(res, 400, "الحد الأدنى للسحب هو 10 دولارات");
  try {
    const result = await withTransaction(async (client) => {
      const locked = await client.query(
        "SELECT balance FROM users WHERE id = $1 FOR UPDATE",
        [req.session.userId],
      );
      if (!locked.rowCount || Number(locked.rows[0].balance) < amount) {
        throw Object.assign(new Error("رصيدك غير كافٍ"), { status: 400 });
      }
      const request = await client.query(
        `INSERT INTO withdrawal_requests (user_id, bank, account, amount)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.session.userId, bank, account, amount.toFixed(2)],
      );
      await client.query(
        "UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2",
        [amount.toFixed(2), req.session.userId],
      );
      await client.query(
        `INSERT INTO transactions
          (user_id, type, amount, direction, description, reference_type, reference_id)
         VALUES ($1, 'سحب', $2, 'debit', $3, 'withdrawal_request', $4)`,
        [req.session.userId, amount.toFixed(2), `حجز طلب سحب (${bank})`, request.rows[0].id],
      );
      return request.rows[0].id;
    });
    res.status(201).json({ id: result });
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر إرسال طلب السحب");
  }
});

app.get("/api/admin/overview", requireAdmin, async (_req, res) => {
  try {
    const [users, deposits, withdrawals, stats] = await Promise.all([
      pool.query(
        `SELECT id, email, name, referral_code, is_admin, balance, user_vip, created_at
         FROM users ORDER BY created_at DESC`,
      ),
      pool.query(
        `SELECT d.id, d.amount, d.txid, d.network, d.status, d.created_at,
                u.name, u.email
         FROM deposit_requests d JOIN users u ON u.id = d.user_id
         ORDER BY d.created_at DESC LIMIT 300`,
      ),
      pool.query(
        `SELECT w.id, w.amount, w.bank, w.account, w.status, w.created_at,
                u.name, u.email
         FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
         ORDER BY w.created_at DESC LIMIT 300`,
      ),
      pool.query(
        `SELECT
          (SELECT COUNT(*) FROM users WHERE is_admin = FALSE) AS users,
          (SELECT COALESCE(SUM(amount), 0) FROM deposit_requests WHERE status = 'accepted') AS deposits,
          (SELECT COALESCE(SUM(amount), 0) FROM withdrawal_requests WHERE status = 'accepted') AS withdrawals`,
      ),
    ]);
    res.json({
      users: users.rows.map(publicUser),
      deposits: deposits.rows,
      withdrawals: withdrawals.rows,
      stats: {
        users: Number(stats.rows[0].users),
        deposits: money(stats.rows[0].deposits),
        withdrawals: money(stats.rows[0].withdrawals),
      },
    });
  } catch {
    appError(res, 500, "تعذر تحميل لوحة الإدارة");
  }
});

app.post("/api/admin/deposits/:id/review", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;
  if (!Number.isInteger(id) || !["accepted", "rejected"].includes(status)) {
    return appError(res, 400, "قرار مراجعة غير صالح");
  }
  try {
    await withTransaction(async (client) => {
      const locked = await client.query(
        "SELECT * FROM deposit_requests WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!locked.rowCount) throw Object.assign(new Error("طلب الإيداع غير موجود"), { status: 404 });
      const request = locked.rows[0];
      if (request.status !== "pending") {
        throw Object.assign(new Error("تمت مراجعة هذا الطلب سابقاً"), { status: 409 });
      }
      await client.query(
        `UPDATE deposit_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW()
         WHERE id = $3`,
        [status, req.session.userId, id],
      );
      if (status !== "accepted") return;

      await client.query(
        "UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2",
        [request.amount, request.user_id],
      );
      await client.query(
        `INSERT INTO transactions
          (user_id, type, amount, direction, description, reference_type, reference_id)
         VALUES ($1, 'إيداع', $2, 'credit', 'قبول طلب الإيداع', 'deposit_request', $3)`,
        [request.user_id, request.amount, id],
      );

      let ancestorId = request.user_id;
      for (let level = 0; level < rates.length; level += 1) {
        const ancestor = await client.query(
          "SELECT referred_by FROM users WHERE id = $1",
          [ancestorId],
        );
        if (!ancestor.rowCount || !ancestor.rows[0].referred_by) break;
        const beneficiaryId = ancestor.rows[0].referred_by;
        const commission = (Number(request.amount) * rates[level]).toFixed(2);
        const inserted = await client.query(
          `INSERT INTO referral_commissions
            (beneficiary_id, source_user_id, deposit_request_id, level, rate, amount)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (beneficiary_id, deposit_request_id, level) DO NOTHING
           RETURNING id`,
          [beneficiaryId, request.user_id, id, level + 1, rates[level], commission],
        );
        if (inserted.rowCount) {
          await client.query(
            "UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2",
            [commission, beneficiaryId],
          );
          await client.query(
            `INSERT INTO transactions
              (user_id, type, amount, direction, description, reference_type, reference_id)
             VALUES ($1, 'إحالة', $2, 'credit', $3, 'deposit_request', $4)`,
            [beneficiaryId, commission, `عمولة إحالة المستوى ${level + 1}`, id],
          );
        }
        ancestorId = beneficiaryId;
      }
    });
    res.json({ ok: true });
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر مراجعة طلب الإيداع");
  }
});

app.post("/api/admin/withdrawals/:id/review", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const status = req.body.status;
  if (!Number.isInteger(id) || !["accepted", "rejected"].includes(status)) {
    return appError(res, 400, "قرار مراجعة غير صالح");
  }
  try {
    await withTransaction(async (client) => {
      const locked = await client.query(
        "SELECT * FROM withdrawal_requests WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!locked.rowCount) throw Object.assign(new Error("طلب السحب غير موجود"), { status: 404 });
      const request = locked.rows[0];
      if (request.status !== "pending") {
        throw Object.assign(new Error("تمت مراجعة هذا الطلب سابقاً"), { status: 409 });
      }
      await client.query(
        `UPDATE withdrawal_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW()
         WHERE id = $3`,
        [status, req.session.userId, id],
      );
      if (status === "rejected") {
        await client.query(
          "UPDATE users SET balance = balance + $1, updated_at = NOW() WHERE id = $2",
          [request.amount, request.user_id],
        );
        await client.query(
          `INSERT INTO transactions
            (user_id, type, amount, direction, description, reference_type, reference_id)
           VALUES ($1, 'استرجاع', $2, 'credit', 'استرجاع طلب السحب المرفوض', 'withdrawal_request', $3)`,
          [request.user_id, request.amount, id],
        );
      }
    });
    res.json({ ok: true });
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر مراجعة طلب السحب");
  }
});

app.use(express.static(publicDir));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`SECURO server listening on port ${PORT}`);
});

process.on("SIGTERM", () => {
  server.close(() => pool.end(() => process.exit(0)));
});