const path = require("path");
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const { randomInt } = require("crypto");

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
const frontendUrl = String(process.env.FRONTEND_URL || "").trim().replace(/\/+$/, "");
const allowedOrigins = frontendUrl
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === "production";
const cookieSameSite = process.env.COOKIE_SAME_SITE || (isProduction ? "none" : "lax");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));

function requestOriginIsAllowed(req, origin) {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  const forwardedProtocol = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const protocol = forwardedProtocol || req.protocol;
  return origin === `${protocol}://${req.get("host")}`;
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  }
  if (req.method === "OPTIONS") {
    return origin && requestOriginIsAllowed(req, origin)
      ? res.sendStatus(204)
      : res.sendStatus(403);
  }
  if (
    origin &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
    !requestOriginIsAllowed(req, origin)
  ) {
    return appError(res, 403, "مصدر الطلب غير مسموح");
  }
  next();
});
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
      sameSite: cookieSameSite,
      secure: isProduction || cookieSameSite === "none",
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
const dailyRewardAmount = 0.1;
const trialDurationDays = 30; // backup expiry; trial ends after 4 total tasks
const trialMaxTasks = 4;
const vipProducts = {
  "VIP 1": { price: 14, totalTasks: 3, totalReward: 1.2 },
  "VIP 2": { price: 24, totalTasks: 6, totalReward: 2.5 },
  "VIP 3": { price: 54, totalTasks: 8, totalReward: 7 },
  "VIP 4": { price: 120, totalTasks: 10, totalReward: 18 },
};
const wheelSectors = [
  { label: "حظ سعيد", amount: 0 },
  { label: "$0.50", amount: 0.5 },
  { label: "$1.00", amount: 1 },
  { label: "$2.00", amount: 2 },
  { label: "حظ سعيد", amount: 0 },
  { label: "$3.00", amount: 3 },
  { label: "$50.00", amount: 50 },
  { label: "$100.00", amount: 100 },
];
const allowedWheelSectors = [0, 1, 2, 4, 5];
const taskMinimumDurationMs = 60 * 1000;

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeCode(value) {
  return String(value || "").trim();
}

function money(value) {
  return Number(Number(value || 0).toFixed(2));
}

function dateOnly(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value).slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    inviteCode: row.referral_code,
    isAdmin: Boolean(row.is_admin),
    isBlocked: Boolean(row.is_blocked),
    isActive: !Boolean(row.is_blocked),
    balance: money(row.balance),
    reservedBalance: money(row.reserved_balance),
    availableBalance: money(Number(row.balance) - Number(row.reserved_balance)),
    userVip: row.user_vip || null,
    completedTasksCount: row.completed_tasks_count || 0,
    taskLastResetDate: dateOnly(row.task_last_reset_date),
    lastClaimDate: dateOnly(row.last_claim_date),
    currentTrialDay: row.current_trial_day || 1,
    trialTasksCompleted: Number(row.trial_tasks_completed || 0),
    trialActive: Boolean(row.trial_active),
    trialUsed: Boolean(row.trial_used),
    vipExpiresAt: row.vip_expires_at || null,
    availableSpins: Number(row.available_spins || 0),
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

function parseMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Number(amount.toFixed(2));
}

function parseBalanceAdjustment(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return null;
  return Number(amount.toFixed(2));
}

function currentDateSql() {
  return "CURRENT_DATE";
}

async function syncDailyTaskState(clientOrPool, userId) {
  await clientOrPool.query(
    `UPDATE users
     SET completed_tasks_count = 0,
         task_last_reset_date = ${currentDateSql()},
         current_trial_day = CASE
           WHEN user_vip->>'isTrial' = 'true' AND task_last_reset_date IS NOT NULL
             THEN current_trial_day + 1
           ELSE current_trial_day
         END,
         updated_at = NOW()
     WHERE id = $1
       AND (task_last_reset_date IS NULL OR task_last_reset_date < CURRENT_DATE)`,
    [userId],
  );
}

async function syncVipState(clientOrPool, userId) {
  await clientOrPool.query(
    `UPDATE users
     SET user_vip = NULL,
         vip_expires_at = NULL,
         trial_active = FALSE,
         updated_at = NOW()
     WHERE id = $1
       AND vip_expires_at IS NOT NULL
       AND vip_expires_at <= NOW()`,
    [userId],
  );
}

async function loadUserPayload(userId) {
  await syncVipState(pool, userId);
  await syncDailyTaskState(pool, userId);
  const user = await getUserById(userId);
  if (!user) return null;

  const [deposits, withdrawals, transactions, taskAttempts, team, commissions, commissionsByLevel, totals] =
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
        `SELECT task_index, comment, started_at, completed_at
         FROM task_attempts
         WHERE user_id = $1 AND task_day = CURRENT_DATE
         ORDER BY task_index`,
        [userId],
      ),
      pool.query(
          `WITH RECURSIVE tree AS (
           SELECT u.id, u.name, u.email, 1 AS level, u.created_at
           FROM users u
           WHERE u.referred_by = $1
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
      pool.query(
        `SELECT level, COALESCE(SUM(amount), 0) AS total
         FROM referral_commissions
         WHERE beneficiary_id = $1
         GROUP BY level`,
        [userId],
      ),
      pool.query(
        `SELECT
           (SELECT COALESCE(SUM(amount), 0) FROM deposit_requests
            WHERE user_id = $1 AND status = 'accepted') AS total_deposits,
           (SELECT COUNT(*) FROM deposit_requests
            WHERE user_id = $1 AND status = 'accepted') AS total_deposit_count,
           (SELECT COALESCE(SUM(amount), 0) FROM withdrawal_requests
            WHERE user_id = $1 AND status = 'accepted') AS total_withdrawals,
           (SELECT COUNT(*) FROM withdrawal_requests
            WHERE user_id = $1 AND status = 'accepted') AS total_withdrawal_count`,
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
    taskStatuses: taskAttempts.rows.map((item) => ({
      taskIndex: Number(item.task_index),
      comment: item.comment,
      startedAt: item.started_at,
      completedAt: item.completed_at,
      completed: Boolean(item.completed_at),
    })),
    teamMembers: team.rows.map((item) => ({
      name: item.name,
      email: item.email,
      level: item.level,
      date: item.created_at,
    })),
    referralEarnings: money(commissions.rows[0].total),
    referralEarningsByLevel: Object.fromEntries(
      commissionsByLevel.rows.map((item) => [item.level, money(item.total)]),
    ),
    totalDeposits: money(totals.rows[0].total_deposits),
    totalWithdrawals: money(totals.rows[0].total_withdrawals),
    totalDepositCount: Number(totals.rows[0].total_deposit_count || 0),
    totalWithdrawalCount: Number(totals.rows[0].total_withdrawal_count || 0),
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return appError(res, 401, "يجب تسجيل الدخول أولاً");
  getUserById(req.session.userId)
    .then((user) => {
      if (!user) {
        req.session.destroy(() => {});
        return appError(res, 401, "انتهت الجلسة");
      }
      if (user.is_blocked) {
        req.session.destroy(() => {});
        return appError(res, 403, "تم حظر هذا الحساب. يرجى التواصل مع الإدارة");
      }
      req.currentUser = user;
      req.session.isAdmin = Boolean(user.is_admin);
      next();
    })
    .catch(() => appError(res, 503, "تعذر التحقق من الحساب"));
}

function requireUser(req, res, next) {
  requireAuth(req, res, () => {
    if (req.currentUser.is_admin) {
      return appError(res, 403, "هذه العملية متاحة لحسابات المستخدمين فقط");
    }
    next();
  });
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return appError(res, 403, "ليس لديك صلاحية المشرف");
  }
  requireAuth(req, res, () => {
    if (!req.currentUser.is_admin) return appError(res, 403, "ليس لديك صلاحية المشرف");
    next();
  });
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

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
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
          "SELECT id FROM users WHERE referral_code = $1 FOR SHARE",
          [inviteCode],
        );
        if (!ref.rowCount) throw Object.assign(new Error("رمز الدعوة غير صالح"), { status: 400 });
        referrer = ref.rows[0];
      }

      const hash = await bcrypt.hash(password, 12);
      let referralCode;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = String(randomInt(100000, 1000000));
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

    await regenerateSession(req);
    req.session.userId = result.id;
    req.session.isAdmin = false;
    await saveSession(req);
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
    if (user.is_blocked) {
      return appError(res, 403, "تم حظر هذا الحساب. يرجى التواصل مع الإدارة");
    }
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.isAdmin = Boolean(user.is_admin);
    await saveSession(req);
    res.json({ user: publicUser(user) });
  } catch (error) {
    console.error("Login failed:", error.code || error.message);
    appError(res, 500, "تعذر تسجيل الدخول");
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((error) => {
    res.clearCookie("connect.sid", { path: "/" });
    if (error) {
      console.error("Logout failed:", error.code || error.message);
      return appError(res, 500, "تعذر تسجيل الخروج");
    }
    res.json({ ok: true });
  });
});

app.get("/api/auth/session", async (req, res) => {
  if (!req.session.userId) return res.json({ authenticated: false });
  try {
    const user = await getUserById(req.session.userId);
    if (!user || user.is_blocked) {
      req.session.destroy(() => {});
      if (user?.is_blocked) {
        return appError(res, 403, "تم حظر هذا الحساب. يرجى التواصل مع الإدارة");
      }
      return res.json({ authenticated: false });
    }
    res.json({ authenticated: true, user: publicUser(user) });
  } catch (error) {
    console.error("Session check failed:", error.code || error.message);
    appError(res, 503, "تعذر التحقق من الجلسة");
  }
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

// Account state is server-owned. Never accept a client-supplied balance,
// reward, task count, VIP object, or spin count.
app.patch("/api/me/state", requireUser, (_req, res) =>
  appError(res, 405, "لا يمكن تعديل حالة الحساب مباشرة"),
);

app.post("/api/rewards/daily", requireUser, async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE users
         SET balance = balance + $1,
             last_claim_date = CURRENT_DATE,
             updated_at = NOW()
         WHERE id = $2
           AND (last_claim_date IS NULL OR last_claim_date <> CURRENT_DATE)
         RETURNING *`,
        [dailyRewardAmount, req.session.userId],
      );
      if (!updated.rowCount) {
        const exists = await client.query("SELECT 1 FROM users WHERE id = $1", [req.session.userId]);
        if (!exists.rowCount) throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
        throw Object.assign(new Error("تم استلام مكافأة اليوم مسبقاً"), { status: 409 });
      }
      await client.query(
        `INSERT INTO transactions
          (user_id, type, amount, direction, description, reference_type, reference_id)
          VALUES ($1, 'مكافأة', $2, 'credit', 'مكافأة تسجيل الدخول اليومية', 'daily_reward', NULL)`,
        [req.session.userId, dailyRewardAmount],
      );
      return publicUser(updated.rows[0]);
    });
    res.json({ user: result, amount: dailyRewardAmount });
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر استلام المكافأة اليومية");
  }
});

app.post("/api/vip/trial", requireUser, async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      await syncVipState(client, req.session.userId);
      const locked = await client.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [req.session.userId]);
      if (!locked.rowCount) throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
      const user = locked.rows[0];
      if (user.trial_used) throw Object.assign(new Error("لقد استخدمت الفترة التجريبية سابقاً"), { status: 409 });
      if (user.user_vip) throw Object.assign(new Error("لديك عضوية VIP نشطة حالياً"), { status: 409 });
      const vip = { name: "الفترة التجريبية (Trial)", price: 0, totalTasks: trialMaxTasks, totalReward: trialMaxTasks * 1, isTrial: true };
      const updated = await client.query(
        `UPDATE users SET user_vip = $1::jsonb, trial_active = TRUE, trial_used = TRUE,
          current_trial_day = 1, trial_tasks_completed = 0, completed_tasks_count = 0,
          task_last_reset_date = CURRENT_DATE,
           vip_expires_at = NOW() + ($2 * INTERVAL '1 day'),
          updated_at = NOW() WHERE id = $3 RETURNING *`,
        [JSON.stringify(vip), trialDurationDays, req.session.userId],
      );
      return publicUser(updated.rows[0]);
    });
    res.json({ user: result });
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر تفعيل الفترة التجريبية");
  }
});

app.post("/api/vip/purchase", requireUser, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const product = vipProducts[name];
  if (!product) return appError(res, 400, "عضوية VIP غير صالحة");
  try {
    await withTransaction(async (client) => {
      await syncVipState(client, req.session.userId);
      const locked = await client.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [req.session.userId]);
      if (!locked.rowCount) throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
      const user = locked.rows[0];
      if (Number(user.balance) - Number(user.reserved_balance) < product.price) {
        throw Object.assign(new Error("رصيدك المتاح غير كافٍ"), { status: 400 });
      }
      // A trial membership may be upgraded to a paid VIP at any time.
      // Keep paid memberships protected from accidental replacement.
      if (user.user_vip && !user.user_vip.isTrial) {
        throw Object.assign(new Error("لديك عضوية VIP نشطة حالياً"), { status: 409 });
      }
      const vip = { name, ...product, isTrial: false };
      await client.query(
        `UPDATE users SET balance = balance - $1, user_vip = $2::jsonb,
          trial_active = FALSE, trial_tasks_completed = 0, completed_tasks_count = 0,
          task_last_reset_date = CURRENT_DATE,
           vip_expires_at = NOW() + INTERVAL '365 days',
           available_spins = available_spins + 1, updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [product.price.toFixed(2), JSON.stringify(vip), req.session.userId],
      );
      await client.query(
        `INSERT INTO transactions
          (user_id, type, amount, direction, description, reference_type, reference_id)
         VALUES ($1, 'شراء', $2, 'debit', $3, 'vip_purchase', NULL)`,
        [req.session.userId, product.price.toFixed(2), `شراء عضوية ${name}`],
      );
    });
    // Return the complete, freshly-loaded task state with the purchase result.
    // This makes the new VIP task list available immediately after confirmation
    // instead of leaving the client with the previous membership's task cache.
    const payload = await loadUserPayload(req.session.userId);
    res.json(payload);
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر شراء العضوية");
  }
});

app.post("/api/wheel/spin", requireUser, async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      const locked = await client.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [req.session.userId]);
      if (!locked.rowCount) throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
      const user = locked.rows[0];
      if (Number(user.available_spins) < 1) {
        throw Object.assign(new Error("لا توجد محاولات حظ متاحة"), { status: 400 });
      }
      const sectorIndex = allowedWheelSectors[randomInt(allowedWheelSectors.length)];
      const amount = wheelSectors[sectorIndex].amount;
      const updated = await client.query(
        `UPDATE users SET available_spins = available_spins - 1,
          balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [amount.toFixed(2), req.session.userId],
      );
      if (amount > 0) {
        await client.query(
          `INSERT INTO transactions
            (user_id, type, amount, direction, description, reference_type, reference_id)
           VALUES ($1, 'عجلة الحظ', $2, 'credit', 'جائزة عجلة الحظ', 'wheel_spin', NULL)`,
          [req.session.userId, amount.toFixed(2)],
        );
      }
      return { user: publicUser(updated.rows[0]), sectorIndex, amount };
    });
    res.json(result);
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر تدوير عجلة الحظ");
  }
});

app.post("/api/tasks/:taskIndex/start", requireUser, async (req, res) => {
  const taskIndex = Number(req.params.taskIndex);
  if (!Number.isInteger(taskIndex) || taskIndex < 0) return appError(res, 400, "مهمة غير صالحة");
  const comment = String(req.body.comment || "").trim();
  if (comment.length < 5 || comment.length > 2000) return appError(res, 400, "يرجى كتابة تعليق صحيح");
  try {
    const result = await withTransaction(async (client) => {
      await syncVipState(client, req.session.userId);
      await syncDailyTaskState(client, req.session.userId);
      const locked = await client.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [req.session.userId]);
      const user = locked.rows[0];
      const vip = user && user.user_vip;
      if (!user || !vip) throw Object.assign(new Error("لا توجد عضوية نشطة"), { status: 400 });
       if (taskIndex >= Number(vip.totalTasks)) {
         throw Object.assign(new Error("رقم المهمة غير صالح لهذه العضوية"), { status: 400 });
       }
      const existing = await client.query(
         `SELECT task_index, started_at, completed_at FROM task_attempts
         WHERE user_id = $1 AND task_day = CURRENT_DATE AND task_index = $2`,
        [req.session.userId, taskIndex],
      );
      if (existing.rowCount) {
         return {
           taskIndex: Number(existing.rows[0].task_index),
           startedAt: existing.rows[0].started_at,
           completed: Boolean(existing.rows[0].completed_at),
         };
      }
       if (taskIndex !== Number(user.completed_tasks_count)) {
         throw Object.assign(new Error("يجب تنفيذ المهام بالترتيب"), { status: 400 });
       }
      const inserted = await client.query(
         `INSERT INTO task_attempts (user_id, task_day, task_index, comment)
          VALUES ($1, CURRENT_DATE, $2, $3)
          RETURNING task_index, started_at`,
        [req.session.userId, taskIndex, comment],
      );
       return {
         taskIndex: Number(inserted.rows[0].task_index),
         startedAt: inserted.rows[0].started_at,
         completed: false,
       };
    });
    res.json({ ...result, minimumDurationSeconds: 60 });
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر بدء المهمة");
  }
});

app.post("/api/tasks/:taskIndex/complete", requireUser, async (req, res) => {
  const taskIndex = Number(req.params.taskIndex);
  if (!Number.isInteger(taskIndex) || taskIndex < 0) return appError(res, 400, "مهمة غير صالحة");
  const comment = String(req.body.comment || "").trim();
  if (comment.length < 5 || comment.length > 2000) return appError(res, 400, "يرجى كتابة تعليق صحيح");
  try {
    const result = await withTransaction(async (client) => {
      await syncVipState(client, req.session.userId);
      await syncDailyTaskState(client, req.session.userId);
      const locked = await client.query("SELECT * FROM users WHERE id = $1 FOR UPDATE", [req.session.userId]);
      const user = locked.rows[0];
      const vip = user && user.user_vip;
      if (!user || !vip) throw Object.assign(new Error("لا توجد عضوية نشطة"), { status: 400 });
       if (taskIndex >= Number(vip.totalTasks)) {
         throw Object.assign(new Error("رقم المهمة غير صالح لهذه العضوية"), { status: 400 });
       }
      const attempt = await client.query(
         `SELECT *, EXTRACT(EPOCH FROM (NOW() - started_at)) AS elapsed_seconds
         FROM task_attempts
         WHERE user_id = $1 AND task_day = CURRENT_DATE AND task_index = $2 FOR UPDATE`,
        [req.session.userId, taskIndex],
      );
      if (!attempt.rowCount) throw Object.assign(new Error("يجب بدء المهمة أولاً"), { status: 400 });
       if (Number(attempt.rows[0].task_index) !== taskIndex) {
         throw Object.assign(new Error("معرّف المهمة لا يطابق المهمة المسجلة"), { status: 400 });
       }
       if (attempt.rows[0].completed_at) {
         return {
           user: publicUser(user),
           reward: 0,
           alreadyCompleted: true,
           taskIndex,
         };
       }
       if (taskIndex !== Number(user.completed_tasks_count)) {
         throw Object.assign(new Error("يجب تنفيذ المهام بالترتيب"), { status: 400 });
       }
      if (attempt.rows[0].comment !== comment) {
        throw Object.assign(new Error("تعليق المهمة لا يطابق التعليق المسجل عند البدء"), { status: 400 });
      }
      if (Number(attempt.rows[0].elapsed_seconds) * 1000 < taskMinimumDurationMs) {
        throw Object.assign(new Error("يجب الانتظار دقيقة كاملة قبل إكمال المهمة"), { status: 400 });
      }
      const totalRewardCents = Math.round(Number(vip.totalReward) * 100);
      const taskCount = Number(vip.totalTasks);
      const completedBefore = Number(user.completed_tasks_count);
      const baseRewardCents = Math.floor(totalRewardCents / taskCount);
      const rewardCents =
        completedBefore === taskCount - 1
          ? totalRewardCents - baseRewardCents * (taskCount - 1)
          : baseRewardCents;
      const reward = rewardCents / 100;
        const updated = await client.query(
         `UPDATE users
          SET balance = balance + $1,
              completed_tasks_count = completed_tasks_count + 1,
              trial_tasks_completed = trial_tasks_completed + $3,
              updated_at = NOW()
          WHERE id = $2 RETURNING *`,
         [reward.toFixed(2), req.session.userId, vip.isTrial ? 1 : 0],
       );
       const completedAttempt = await client.query(
         `UPDATE task_attempts
          SET completed_at = NOW()
          WHERE id = $1 AND completed_at IS NULL
          RETURNING id, completed_at`,
         [attempt.rows[0].id],
       );
       if (!completedAttempt.rowCount) {
         throw Object.assign(new Error("تم إكمال المهمة مسبقاً"), { status: 409 });
       }
      await client.query(
        `INSERT INTO transactions
          (user_id, type, amount, direction, description, reference_type, reference_id)
         VALUES ($1, 'مهمة', $2, 'credit', $3, 'task_attempt', $4)`,
        [req.session.userId, reward.toFixed(2), `عمولة تقييم فندق (${vip.name})`, attempt.rows[0].id],
      );

      // Auto-cancel after completing trialMaxTasks tasks in this trial.
      let trialCancelled = false;
      if (vip.isTrial) {
        if (Number(updated.rows[0].trial_tasks_completed) >= trialMaxTasks) {
          await client.query(
            `UPDATE users SET trial_active = FALSE, user_vip = NULL, vip_expires_at = NULL,
             trial_used = TRUE, updated_at = NOW() WHERE id = $1`,
            [req.session.userId],
          );
          trialCancelled = true;
        }
      }

      const finalUser = trialCancelled
        ? await getUserById(req.session.userId)
        : updated.rows[0];
       return { user: publicUser(finalUser), reward, taskIndex, alreadyCompleted: false, trialCancelled };
    });
    res.json(result);
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر إكمال المهمة");
  }
});

app.post("/api/deposit-requests", requireUser, async (req, res) => {
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

app.post("/api/withdrawal-requests", requireUser, async (req, res) => {
  const bank = String(req.body.bank || "").trim();
  const account = String(req.body.account || "").trim();
  const amount = Number(req.body.amount);
  if (!bank || !account) return appError(res, 400, "يرجى إدخال بيانات المحفظة");
  if (!Number.isFinite(amount) || amount < 10) return appError(res, 400, "الحد الأدنى للسحب هو 10 دولارات");
  try {
    const result = await withTransaction(async (client) => {
      const locked = await client.query(
        "SELECT balance, reserved_balance FROM users WHERE id = $1 FOR UPDATE",
        [req.session.userId],
      );
      if (!locked.rowCount) {
        throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
      }
      const availableBalance =
        Number(locked.rows[0].balance) - Number(locked.rows[0].reserved_balance);
      if (availableBalance < amount) {
        throw Object.assign(new Error("رصيدك غير كافٍ"), { status: 400 });
      }
      const request = await client.query(
        `INSERT INTO withdrawal_requests (user_id, bank, account, amount)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [req.session.userId, bank, account, amount.toFixed(2)],
      );
      await client.query(
        `UPDATE users SET reserved_balance = reserved_balance + $1, updated_at = NOW()
         WHERE id = $2`,
        [amount.toFixed(2), req.session.userId],
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
        `SELECT u.id, u.email, u.name, u.referral_code, u.is_admin, u.is_blocked,
                u.balance, u.reserved_balance, u.user_vip, u.created_at,
                u.vip_expires_at, u.trial_active, u.trial_used,
                u.available_spins, u.completed_tasks_count,
                u.task_last_reset_date, u.last_claim_date, u.current_trial_day,
                COALESCE(d.total_dep, 0) AS total_deposits,
                COALESCE(w.total_with, 0) AS total_withdrawals
         FROM users u
         LEFT JOIN (
           SELECT user_id, SUM(amount) AS total_dep
           FROM deposit_requests WHERE status = 'accepted'
           GROUP BY user_id
         ) d ON d.user_id = u.id
         LEFT JOIN (
           SELECT user_id, SUM(amount) AS total_with
           FROM withdrawal_requests WHERE status = 'accepted'
           GROUP BY user_id
         ) w ON w.user_id = u.id
         ORDER BY u.created_at DESC`,
      ),
      pool.query(
        `SELECT d.id, d.amount, d.txid, d.network, d.status, d.created_at,
                u.name, u.email
         FROM deposit_requests d JOIN users u ON u.id = d.user_id
          ORDER BY d.created_at DESC`,
      ),
      pool.query(
        `SELECT w.id, w.amount, w.bank, w.account, w.status, w.created_at,
                u.name, u.email
         FROM withdrawal_requests w JOIN users u ON u.id = w.user_id
          ORDER BY w.created_at DESC`,
      ),
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM users WHERE is_admin = FALSE) AS users,
           (SELECT COALESCE(SUM(amount), 0) FROM deposit_requests WHERE status = 'accepted') AS deposits,
           (SELECT COUNT(*) FROM deposit_requests WHERE status = 'accepted') AS deposit_count,
           (SELECT COALESCE(SUM(amount), 0) FROM withdrawal_requests WHERE status = 'accepted') AS withdrawals,
           (SELECT COUNT(*) FROM withdrawal_requests WHERE status = 'accepted') AS withdrawal_count`,
      ),
    ]);
    res.json({
      users: users.rows.map((row) => ({
        ...publicUser(row),
        totalDeposits: money(row.total_deposits),
        totalWithdrawals: money(row.total_withdrawals),
      })),
      deposits: deposits.rows,
      withdrawals: withdrawals.rows,
      stats: {
        users: Number(stats.rows[0].users),
        deposits: money(stats.rows[0].deposits),
        withdrawals: money(stats.rows[0].withdrawals),
        depositCount: Number(stats.rows[0].deposit_count || 0),
        withdrawalCount: Number(stats.rows[0].withdrawal_count || 0),
      },
    });
  } catch {
    appError(res, 500, "تعذر تحميل لوحة الإدارة");
  }
});

app.post("/api/admin/users/:id/status", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const blocked = req.body.blocked;
  if (!Number.isInteger(userId) || userId <= 0 || typeof blocked !== "boolean") {
    return appError(res, 400, "بيانات حالة الحساب غير صحيحة");
  }
  if (userId === req.session.userId) {
    return appError(res, 400, "لا يمكنك تغيير حالة حساب المشرف الحالي");
  }
  try {
    const result = await pool.query(
      `UPDATE users
       SET is_blocked = $1, updated_at = NOW()
       WHERE id = $2 AND is_admin = FALSE
       RETURNING *`,
      [blocked, userId],
    );
    if (!result.rowCount) return appError(res, 404, "المستخدم غير موجود أو حساب إداري");
    res.json({ user: publicUser(result.rows[0]) });
  } catch {
    appError(res, 500, "تعذر تحديث حالة المستخدم");
  }
});

app.post("/api/admin/users/:id/balance", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const adjustment = parseBalanceAdjustment(req.body.amount);
  const reason = String(req.body.reason || "تعديل إداري للرصيد").trim().slice(0, 255);
  if (!Number.isInteger(userId) || userId <= 0 || adjustment === null || adjustment === 0) {
    return appError(res, 400, "قيمة تعديل الرصيد غير صحيحة");
  }
  try {
    const result = await withTransaction(async (client) => {
      const locked = await client.query(
        "SELECT * FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );
      if (!locked.rowCount || locked.rows[0].is_admin) {
        throw Object.assign(new Error("المستخدم غير موجود أو حساب إداري"), { status: 404 });
      }
      const user = locked.rows[0];
      const currentBalance = Number(user.balance);
      const reservedBalance = Number(user.reserved_balance);
      const nextBalance = currentBalance + adjustment;
      if (nextBalance < reservedBalance) {
        throw Object.assign(new Error("لا يمكن خفض الرصيد أسفل المبلغ المحجوز"), { status: 409 });
      }
      const updated = await client.query(
        `UPDATE users SET balance = $1, updated_at = NOW()
         WHERE id = $2 RETURNING *`,
        [nextBalance.toFixed(2), userId],
      );
      await client.query(
        `INSERT INTO transactions
          (user_id, type, amount, direction, description, reference_type, reference_id)
         VALUES ($1, 'إدارة', $2, $3, $4, 'admin_balance_adjustment', $5)`,
        [
          userId,
          Math.abs(adjustment).toFixed(2),
          adjustment > 0 ? "credit" : "debit",
          reason || "تعديل إداري للرصيد",
          req.session.userId,
        ],
      );
      return publicUser(updated.rows[0]);
    });
    res.json({ user: result });
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر تعديل رصيد المستخدم");
  }
});

app.post("/api/admin/users/:id/vip", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const name = String(req.body.name || "").trim();
  const product = vipProducts[name];
  if (!Number.isInteger(userId) || userId <= 0 || !product) {
    return appError(res, 400, "عضوية VIP غير صالحة");
  }
  try {
    const result = await pool.query(
      `UPDATE users
       SET user_vip = $1::jsonb,
           vip_expires_at = NOW() + INTERVAL '365 days',
           trial_active = FALSE,
           trial_used = TRUE,
           trial_tasks_completed = 0,
           completed_tasks_count = 0,
           task_last_reset_date = CURRENT_DATE,
           updated_at = NOW()
       WHERE id = $2 AND is_admin = FALSE
       RETURNING *`,
      [JSON.stringify({ name, ...product, isTrial: false }), userId],
    );
    if (!result.rowCount) return appError(res, 404, "المستخدم غير موجود أو حساب إداري");
    res.json({ user: publicUser(result.rows[0]) });
  } catch {
    appError(res, 500, "تعذر تغيير عضوية المستخدم");
  }
});

app.post("/api/admin/users/:id/tasks/reset", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return appError(res, 400, "معرّف المستخدم غير صحيح");
  }
  try {
    const result = await withTransaction(async (client) => {
      const user = await client.query(
        "SELECT * FROM users WHERE id = $1 FOR UPDATE",
        [userId],
      );
      if (!user.rowCount || user.rows[0].is_admin) {
        throw Object.assign(new Error("المستخدم غير موجود أو حساب إداري"), { status: 404 });
      }
      await client.query(
        "DELETE FROM task_attempts WHERE user_id = $1 AND task_day = CURRENT_DATE",
        [userId],
      );
      const updated = await client.query(
        `UPDATE users
         SET completed_tasks_count = 0, task_last_reset_date = CURRENT_DATE, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [userId],
      );
      return publicUser(updated.rows[0]);
    });
    res.json({ user: result });
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر تصفير مهام المستخدم");
  }
});

// User self-cancel trial
app.post("/api/vip/trial/cancel", requireUser, async (req, res) => {
  try {
    const result = await withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT * FROM users
         WHERE id = $1 AND is_admin = FALSE
           AND (trial_active = TRUE OR (user_vip IS NOT NULL AND user_vip->>'isTrial' = 'true'))
         FOR UPDATE`,
        [req.session.userId],
      );
      if (!locked.rowCount) {
        throw Object.assign(new Error("لا توجد فترة تجريبية نشطة"), { status: 404 });
      }
      const updated = await client.query(
        `UPDATE users
         SET trial_active = FALSE, trial_used = TRUE, user_vip = NULL,
             vip_expires_at = NULL, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.session.userId],
      );
      return publicUser(updated.rows[0]);
    });
    res.json({ user: result });
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر إلغاء الفترة التجريبية");
  }
});

async function updateOwnPassword(userId, currentPassword, newPassword) {
  return withTransaction(async (client) => {
    const locked = await client.query(
      "SELECT password_hash FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    if (!locked.rowCount) {
      throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
    }
    const match = await bcrypt.compare(currentPassword, locked.rows[0].password_hash);
    if (!match) {
      throw Object.assign(new Error("كلمة المرور الحالية غير صحيحة"), { status: 401 });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await client.query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2",
      [hash, userId],
    );
  });
}

function validatePasswordChange(req, res) {
  const currentPassword = String(req.body.currentPassword || "");
  const newPassword = String(req.body.newPassword || "");
  if (!currentPassword) {
    appError(res, 400, "يرجى إدخال كلمة المرور الحالية");
    return null;
  }
  if (newPassword.length < 6) {
    appError(res, 400, "كلمة المرور الجديدة يجب ألا تقل عن 6 أحرف");
    return null;
  }
  if (currentPassword === newPassword) {
    appError(res, 400, "كلمة المرور الجديدة يجب أن تختلف عن الحالية");
    return null;
  }
  return { currentPassword, newPassword };
}

// A user changes their own password. The current password is checked server-side
// and the new bcrypt hash is persisted in PostgreSQL.
app.post("/api/me/password", requireAuth, async (req, res) => {
  const values = validatePasswordChange(req, res);
  if (!values) return;
  try {
    await updateOwnPassword(req.session.userId, values.currentPassword, values.newPassword);
    res.json({ ok: true });
  } catch (error) {
    console.error("Password update failed:", error.code || error.message);
    appError(res, error.status || 500, error.status ? error.message : "تعذر تغيير كلمة المرور");
  }
});

// The admin control panel uses a dedicated route, but still changes only the
// currently authenticated admin's own password.
app.post("/api/admin/password", requireAdmin, async (req, res) => {
  const values = validatePasswordChange(req, res);
  if (!values) return;
  try {
    await updateOwnPassword(req.session.userId, values.currentPassword, values.newPassword);
    res.json({ ok: true });
  } catch (error) {
    console.error("Admin password update failed:", error.code || error.message);
    appError(res, error.status || 500, error.status ? error.message : "تعذر تغيير كلمة مرور المشرف");
  }
});

// Admin grant wheel spin
app.post("/api/admin/users/:id/spins", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const count = Number(req.body.count || 1);
  if (!Number.isInteger(userId) || userId <= 0) return appError(res, 400, "معرّف المستخدم غير صحيح");
  if (!Number.isInteger(count) || count < 1 || count > 100) return appError(res, 400, "عدد المحاولات غير صحيح");
  try {
    const result = await pool.query(
      `UPDATE users SET available_spins = available_spins + $1, updated_at = NOW()
       WHERE id = $2 AND is_admin = FALSE RETURNING *`,
      [count, userId],
    );
    if (!result.rowCount) return appError(res, 404, "المستخدم غير موجود أو حساب إداري");
    res.json({ user: publicUser(result.rows[0]) });
  } catch {
    appError(res, 500, "تعذر منح محاولات عجلة الحظ");
  }
});

app.post("/api/admin/users/:id/trial/cancel", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return appError(res, 400, "معرّف المستخدم غير صحيح");
  }
  try {
    const result = await withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT * FROM users
         WHERE id = $1 AND is_admin = FALSE
           AND (trial_active = TRUE OR (user_vip IS NOT NULL AND user_vip->>'isTrial' = 'true'))
         FOR UPDATE`,
        [userId],
      );
      if (!locked.rowCount) {
        throw Object.assign(new Error("المستخدم غير موجود أو لا توجد فترة تجريبية نشطة"), { status: 404 });
      }
      const updated = await client.query(
        `UPDATE users
         SET trial_active = FALSE, trial_used = TRUE, user_vip = NULL,
             vip_expires_at = NULL, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [userId],
      );
      return publicUser(updated.rows[0]);
    });
    res.json({ user: result });
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر إلغاء الفترة التجريبية");
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
      if (status === "accepted") {
        const updatedUser = await client.query(
          `UPDATE users
           SET balance = balance - $1, reserved_balance = reserved_balance - $1, updated_at = NOW()
           WHERE id = $2 AND balance >= $1 AND reserved_balance >= $1
           RETURNING id`,
          [request.amount, request.user_id],
        );
        if (!updatedUser.rowCount) {
          throw Object.assign(new Error("رصيد المستخدم غير كافٍ لقبول طلب السحب"), { status: 409 });
        }
        await client.query(
          `INSERT INTO transactions
            (user_id, type, amount, direction, description, reference_type, reference_id)
           VALUES ($1, 'سحب', $2, 'debit', 'قبول وتنفيذ طلب السحب', 'withdrawal_request', $3)`,
          [request.user_id, request.amount, id],
        );
      }
      await client.query(
        `UPDATE withdrawal_requests SET status = $1, reviewed_by = $2, reviewed_at = NOW()
         WHERE id = $3`,
        [status, req.session.userId, id],
      );
      if (status === "rejected") {
        const released = await client.query(
          `UPDATE users SET reserved_balance = reserved_balance - $1, updated_at = NOW()
           WHERE id = $2 AND reserved_balance >= $1`,
          [request.amount, request.user_id],
        );
        if (!released.rowCount) {
          throw Object.assign(new Error("تعذر تحرير المبلغ المحجوز لهذا الطلب"), { status: 409 });
        }
      }
    });
    res.json({ ok: true });
  } catch (error) {
    appError(res, error.status || 500, error.status ? error.message : "تعذر مراجعة طلب السحب");
  }
});

app.get("/index_1786306377933.html", (_req, res) =>
  res.sendFile(path.join(publicDir, "index.html")),
);
app.use(express.static(publicDir));
app.get("/{*splat}", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

if (require.main === module) {
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`SECURO server listening on port ${PORT}`);
  });

  process.on("SIGTERM", () => {
    server.close(() => pool.end(() => process.exit(0)));
  });
}

module.exports = app;