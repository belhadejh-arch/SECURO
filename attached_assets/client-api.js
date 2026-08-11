(function () {
  "use strict";

  const statusLabels = {
    pending: "قيد الانتظار",
    accepted: "مقبول",
    rejected: "مرفوض",
  };
  const configuredApiBaseUrl =
    window.SECURO_API_URL ||
    document.querySelector('meta[name="securo-api-url"]')?.content ||
    "__BACKEND_URL__";
  const apiBaseUrl =
    configuredApiBaseUrl === "__BACKEND_URL__"
      ? ""
      : configuredApiBaseUrl.replace(/\/+$/, "");
  let adminRefreshInterval = null;
  let adminRefreshInFlight = false;

  async function api(url, options) {
    const requestUrl = /^https?:\/\//i.test(url) ? url : `${apiBaseUrl}${url}`;
    let response;
    try {
      response = await fetch(requestUrl, {
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(options && options.headers) },
        ...options,
      });
    } catch (error) {
      console.error("API request failed:", requestUrl, error);
      throw new Error("تعذر الاتصال بالخادم. يرجى المحاولة مرة أخرى.");
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "حدث خطأ غير متوقع");
    return body;
  }
  window.securoApi = api;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function dateText(value) {
    if (!value) return "";
    return new Date(value).toLocaleString("ar-DZ", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function showApiError(error) {
    if (typeof openLoginErrorModal === "function") {
      openLoginErrorModal(error.message || "تعذر تنفيذ العملية");
    } else {
      alert(error.message || "تعذر تنفيذ العملية");
    }
  }
  window.showApiError = showApiError;

  function hydrate(payload) {
    currentUser = payload.user;
    isAdmin = Boolean(payload.user.isAdmin);
    balance = Number(payload.user.availableBalance ?? payload.user.balance ?? 0);
    availableSpins = Number(payload.user.availableSpins || 0);
    userVip = payload.user.userVip || null;
    completedTasksCount = Number(payload.user.completedTasksCount || 0);
    taskLastResetDate = payload.user.taskLastResetDate || null;
    taskStatuses = payload.taskStatuses || [];
    lastClaimDate = payload.user.lastClaimDate || null;
    currentTrialDay = Number(payload.user.currentTrialDay || 1);
    trialActive = Boolean(payload.user.trialActive);
    trialUsed = Boolean(payload.user.trialUsed);
    depositLogs = payload.deposits || [];
    withdrawLogs = payload.withdrawals || [];
    txLogs = payload.transactions || [];
    teamMembers = payload.teamMembers || [];
    referralEarnings = Number(payload.referralEarnings || 0);
     referralEarningsByLevel = payload.referralEarningsByLevel || {};

    if (!isAdmin) {
      document.getElementById("user-balance").innerText = balance.toFixed(2);
      document.getElementById("wheel-spins-count").innerText = availableSpins;
      document.getElementById("user-display-email").innerText = currentUser.email;
      setupUserInviteData();
      updateVipUIState();
      updateDailyRewardUI();
      const trialButton = document.getElementById("btn-trial-activate");
      const trialSuccess = document.getElementById("trial-success-section");
      if (trialButton && trialSuccess) {
        trialButton.style.display = trialUsed ? "none" : "block";
        trialSuccess.style.display = trialUsed ? "block" : "none";
      }
      if (typeof startTaskDaySync === "function") startTaskDaySync();
    }
  }

  window.syncServerUser = function (user) {
    if (!user) return;
    currentUser = user;
    isAdmin = Boolean(user.isAdmin);
    balance = Number(user.availableBalance ?? user.balance ?? 0);
    availableSpins = Number(user.availableSpins || 0);
    userVip = user.userVip || null;
    completedTasksCount = Number(user.completedTasksCount || 0);
    taskLastResetDate = user.taskLastResetDate || null;
    lastClaimDate = user.lastClaimDate || null;
    currentTrialDay = Number(user.currentTrialDay || 1);
    trialActive = Boolean(user.trialActive);
    trialUsed = Boolean(user.trialUsed);
    const balanceEl = document.getElementById("user-balance");
    const spinsEl = document.getElementById("wheel-spins-count");
    if (balanceEl) balanceEl.innerText = balance.toFixed(2);
    if (spinsEl) spinsEl.innerText = availableSpins;
    if (typeof updateVipUIState === "function") updateVipUIState();
    if (typeof updateDailyRewardUI === "function") updateDailyRewardUI();
  };

  function enterApp(payload) {
    hydrate(payload);
    document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
    document.getElementById("auth-screen").classList.remove("active");
    if (isAdmin) {
      document.querySelector(".app-container").classList.remove("nav-visible");
      document.getElementById("admin-screen").classList.add("active");
      document.getElementById("header-title").innerText = "SECURO ADMIN";
      renderAdminDashboard();
      startAdminDashboardRefresh();
    } else {
      stopAdminDashboardRefresh();
      document.getElementById("bottom-nav").style.display = "flex";
      document.querySelector(".app-container").classList.add("nav-visible");
      document.getElementById("header-title").innerText = "SECURO";
      switchTab("home");
    }
  }

  window.handleAuth = async function () {
    const email = document.getElementById("auth-email").value.trim().toLowerCase();
    const password = document.getElementById("auth-pass").value;
    const name = document.getElementById("reg-name").value.trim();
    const inviteCode = document.getElementById("invite-code-input").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return showApiError(new Error("يرجى كتابة بريد إلكتروني صحيح"));
    }
    if (password.length < 6) {
      return showApiError(new Error("كلمة المرور يجب ألا تقل عن 6 أحرف"));
    }
    const button = document.getElementById("auth-btn");
    button.disabled = true;
    try {
      const endpoint = isSignup ? "/api/auth/register" : "/api/auth/login";
      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify(
          isSignup
            ? { name, email, password, inviteCode }
            : { email, password },
        ),
      });
      const payload = await api("/api/me");
      enterApp(payload);
      if (isSignup) {
        showCopyToast("تم إنشاء الحساب بنجاح ✅", "تم ربط حسابك بقاعدة البيانات ويمكنك الآن استخدام المنصة.");
      }
    } catch (error) {
      showApiError(error);
    } finally {
      button.disabled = false;
    }
  };

  window.setupUserInviteData = function () {
    const code = currentUser && currentUser.inviteCode ? currentUser.inviteCode : "";
    const codeInput = document.getElementById("my-invite-code");
    const linkInput = document.getElementById("my-invite-link");
    if (codeInput) codeInput.value = code;
    if (linkInput) {
      linkInput.value = `${window.location.origin}${window.location.pathname}?invite=${encodeURIComponent(code)}`;
    }
  };

  window.saveUserData = async function () {
    // State mutations are intentionally server-only. Kept as a compatibility
    // no-op for older UI code so it cannot submit forged account state.
  };

  window.submitDeposit = async function () {
    const amount = Number(document.getElementById("deposit-amount").value);
    const txid = document.getElementById("deposit-txid").value.trim();
    if (!Number.isFinite(amount) || amount < 10) {
      return showApiError(new Error("الحد الأدنى للإيداع هو 10 دولارات"));
    }
    if (!txid) return showApiError(new Error("يرجى إدخال معرف المعاملة"));
    try {
      await api("/api/deposit-requests", {
        method: "POST",
        body: JSON.stringify({ amount, txid }),
      });
      closeDepositModal();
      document.getElementById("deposit-amount").value = "";
      document.getElementById("deposit-txid").value = "";
      document.getElementById("deposit-success-msg").innerHTML =
        `تم إرسال طلب إيداع بقيمة <strong>$${amount.toFixed(2)}</strong> بنجاح.<br>رقم المرجع (TxID): ${escapeHtml(txid)}<br>سيتم إضافة المبلغ إلى رصيدك بعد قبول الإدارة.`;
      document.getElementById("deposit-success-modal").style.display = "flex";
      await refreshMe();
    } catch (error) {
      showApiError(error);
    }
  };

  window.submitWithdraw = async function () {
    const bank = document.getElementById("withdraw-bank").value;
    const account = document.getElementById("withdraw-account").value.trim();
    const amount = Number(document.getElementById("withdraw-amount").value);
    if (!account) return showApiError(new Error("يرجى إدخال عنوان المحفظة الرقمية"));
    if (!Number.isFinite(amount) || amount < 10) {
      return showApiError(new Error("الحد الأدنى للسحب هو 10 دولارات"));
    }
    if (amount > balance) {
      closeWithdrawModal();
      document.getElementById("insufficient-msg").innerText =
        `رصيدك الحالي ($${balance.toFixed(2)}) أقل من المبلغ المطلوب ($${amount.toFixed(2)}).`;
      document.getElementById("insufficient-modal").style.display = "flex";
      return;
    }
    try {
      await api("/api/withdrawal-requests", {
        method: "POST",
        body: JSON.stringify({ bank, account, amount }),
      });
      closeWithdrawModal();
      document.getElementById("withdraw-amount").value = "";
      document.getElementById("withdraw-account").value = "";
      document.getElementById("withdraw-success-modal").style.display = "flex";
      await refreshMe();
    } catch (error) {
      showApiError(error);
    }
  };

  async function refreshMe() {
    if (!currentUser || isAdmin) return;
    try {
      enterApp(await api("/api/me"));
    } catch (error) {
      console.error("Failed to refresh account", error);
    }
  }
  window.refreshServerMe = refreshMe;

  window.renderDepositsList = function () {
    const container = document.getElementById("deposit-history-list");
    container.innerHTML = depositLogs.length
      ? depositLogs.map((item) => `
        <div class="history-card">
          <div class="history-info">
            <div class="history-title">💳 ${escapeHtml(item.title)}</div>
            <div class="history-date">📅 ${dateText(item.date)}</div>
          </div>
          <div style="text-align:left">
            <div style="font-weight:bold;color:#34d399">${escapeHtml(item.amount)}</div>
            <span class="history-badge badge-orange">${escapeHtml(item.status)}</span>
          </div>
        </div>`).join("")
      : '<div style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد عمليات إيداع مسجلة بعد.</div>';
  };

  window.renderWithdrawsList = function () {
    const container = document.getElementById("withdraw-history-list");
    container.innerHTML = withdrawLogs.length
      ? withdrawLogs.map((item) => `
        <div class="history-card">
          <div class="history-info">
            <div class="history-title">🏦 ${escapeHtml(item.bank)} (${escapeHtml(item.account)})</div>
            <div class="history-date">📅 ${dateText(item.date)}</div>
          </div>
          <div style="text-align:left">
            <div style="font-weight:bold;color:#f87171">${escapeHtml(item.amount)}</div>
            <span class="history-badge badge-orange">${escapeHtml(item.status)}</span>
          </div>
        </div>`).join("")
      : '<div style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد عمليات سحب سابقة.</div>';
  };

  window.renderTxList = function () {
    const container = document.getElementById("tx-history-list");
    container.innerHTML = txLogs.length
      ? txLogs.map((item) => `
        <div class="history-card">
          <div class="history-info">
            <div class="history-title">${escapeHtml(item.title)}</div>
            <div class="history-date">📅 ${dateText(item.date)}</div>
          </div>
          <div style="text-align:left">
            <div style="font-weight:bold;color:${item.amount.startsWith("+") ? "#34d399" : "#f87171"}">${escapeHtml(item.amount)}</div>
            <span class="history-badge badge-green">${escapeHtml(item.type)}</span>
          </div>
        </div>`).join("")
      : '<div style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد معاملات مسجلة بعد.</div>';
  };

  window.renderTeamScreen = function () {
    const levels = [1, 2, 3].map((level) => teamMembers.filter((member) => member.level === level).length);
    [1, 2, 3].forEach((level) => {
      document.getElementById(`lvl${level}-count`).innerText = `${levels[level - 1]} شخص`;
    });
    document.getElementById("total-team-count").innerText = teamMembers.length;
    document.getElementById("total-referral-earnings").innerText = referralEarnings.toFixed(2);
     [1, 2, 3].forEach((level) => {
       const element = document.getElementById(`lvl${level}-earnings`);
       if (element) element.innerText = `$${Number(referralEarningsByLevel[level] || 0).toFixed(2)}`;
     });
    const container = document.getElementById("team-members-list");
    container.innerHTML = teamMembers.length
      ? teamMembers.map((member) => `
        <div class="history-card">
          <div class="history-info">
            <div class="history-title">👤 ${escapeHtml(member.name)}</div>
            <div class="history-date">📧 ${escapeHtml(member.email)} | 📅 ${dateText(member.date)}</div>
          </div>
          <span class="level-badge lvl-${member.level}">المستوى ${member.level}</span>
        </div>`).join("")
      : '<div style="text-align:center;padding:30px;color:var(--text-muted)">لا توجد إحالات مسجلة بعد.</div>';
  };

  async function adminReview(kind, id, status) {
    try {
      await api(`/api/admin/${kind}/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await renderAdminDashboard();
    } catch (error) {
      showApiError(error);
    }
  }

  function adminRequestCard(item, kind) {
    const isDeposit = kind === "deposits";
    const amount = Number(item.amount).toFixed(2);
    const detail = isDeposit
      ? `TxID: ${escapeHtml(item.txid)} | ${escapeHtml(item.network)}`
      : `${escapeHtml(item.bank)} | ${escapeHtml(item.account)}`;
    const buttons = item.status === "pending"
      ? `<div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-green" style="padding:8px;font-size:.78rem" onclick="adminReview('${kind}',${item.id},'accepted')">✅ قبول</button>
          <button class="btn btn-red" style="padding:8px;font-size:.78rem" onclick="adminReview('${kind}',${item.id},'rejected')">❌ رفض</button>
        </div>`
      : "";
    return `<div class="history-card" style="display:block">
      <div style="display:flex;justify-content:space-between;gap:8px">
        <div class="history-info">
          <div class="history-title">${isDeposit ? "💳" : "💸"} ${escapeHtml(item.name)} — ${escapeHtml(item.email)}</div>
          <div class="history-date">📅 ${dateText(item.created_at)}<br>${detail}</div>
        </div>
        <div style="text-align:left;white-space:nowrap">
          <div style="font-weight:bold;color:${isDeposit ? "#34d399" : "#f87171"}">$${amount}</div>
          <span class="history-badge ${item.status === "accepted" ? "badge-green" : "badge-orange"}">${statusLabels[item.status]}</span>
        </div>
      </div>${buttons}</div>`;
  }

  window.renderAdminDashboard = async function () {
    if (adminRefreshInFlight) return;
    adminRefreshInFlight = true;
    try {
      const data = await api("/api/admin/overview");
      document.getElementById("admin-total-users").innerText = data.stats.users;
      document.getElementById("admin-total-deposits").innerText = `$${Number(data.stats.deposits).toFixed(2)}`;
      document.getElementById("admin-total-withdraws").innerText = `$${Number(data.stats.withdrawals).toFixed(2)}`;
      document.getElementById("admin-users-list").innerHTML = data.users.map((user, index) => `
        <div class="history-card" style="display:block">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <div class="history-info">
              <div class="history-title">👤 ${escapeHtml(user.name)} ${user.isAdmin ? "👑" : ""}</div>
              <div class="history-date">📧 ${escapeHtml(user.email)} | رمز الإحالة: ${escapeHtml(user.inviteCode)}</div>
            </div>
            <div style="text-align:left;white-space:nowrap">
              <strong>$${Number(user.balance).toFixed(2)}</strong><br>
              <span class="history-badge ${user.isBlocked ? "badge-orange" : "badge-green"}">${user.isBlocked ? "محظور / غير نشط" : "نشط"}</span><br>
              <small>${dateText(user.createdAt)}</small>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;border-top:1px solid var(--border-color);padding-top:8px">
            <button class="btn btn-green" style="flex:1;padding:6px 10px;font-size:.75rem" onclick="adminEditBalance(${index})">✏️ تعديل الرصيد</button>
            <button class="btn btn-gold" style="flex:1;padding:6px 10px;font-size:.75rem" onclick="adminChangeVip(${index})">👑 تغيير VIP</button>
            <button class="btn" style="flex:1;padding:6px 10px;font-size:.75rem;background:#6366f1;color:white" onclick="adminResetTasks(${index})">🔄 تصفير المهام</button>
            ${!user.isAdmin ? `<button class="btn ${user.isBlocked ? "btn-green" : "btn-red"}" style="flex:1;padding:6px 10px;font-size:.75rem" onclick="adminToggleBlock(${user.id},${!user.isBlocked})">${user.isBlocked ? "✅ رفع الحظر" : "🚫 حظر المستخدم"}</button>` : ""}
          </div>
        </div>`).join("") || '<div class="history-date">لا توجد حسابات.</div>';
      document.getElementById("admin-deposit-requests").innerHTML = data.deposits.map((item) => adminRequestCard(item, "deposits")).join("")
        || '<div class="history-date">لا توجد طلبات إيداع.</div>';
      document.getElementById("admin-withdrawal-requests").innerHTML = data.withdrawals.map((item) => adminRequestCard(item, "withdrawals")).join("")
        || '<div class="history-date">لا توجد طلبات سحب.</div>';
    } catch (error) {
      showApiError(error);
    } finally {
      adminRefreshInFlight = false;
    }
  };
  window.adminToggleBlock = async function (userId, blocked) {
    const action = blocked ? "حظر هذا المستخدم" : "رفع الحظر عن هذا المستخدم";
    if (!window.confirm(`${action}؟ سيتم الاحتفاظ بكل بياناته ومعاملاته وإحالاته.`)) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
        method: "POST",
        body: JSON.stringify({ blocked }),
      });
      await window.renderAdminDashboard();
    } catch (error) {
      showApiError(error);
    }
  };
  function startAdminDashboardRefresh() {
    stopAdminDashboardRefresh();
    adminRefreshInterval = window.setInterval(() => {
      if (isAdmin && document.getElementById("admin-screen")?.classList.contains("active")) {
        renderAdminDashboard();
      }
    }, 5000);
  }
  function stopAdminDashboardRefresh() {
    if (adminRefreshInterval) {
      window.clearInterval(adminRefreshInterval);
      adminRefreshInterval = null;
    }
  }
  window.adminReview = adminReview;

  window.logout = async function () {
    stopAdminDashboardRefresh();
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    currentUser = null;
    isAdmin = false;
    document.getElementById("bottom-nav").style.display = "none";
    document.querySelector(".app-container").classList.remove("nav-visible");
    document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
    document.getElementById("auth-screen").classList.add("active");
    document.getElementById("header-title").innerText = "SECURO";
    document.getElementById("auth-email").value = "";
    document.getElementById("auth-pass").value = "";
    document.getElementById("reg-name").value = "";
  };

  async function showInviteRegistration(invite) {
    const inviteInput = document.getElementById("invite-code-input");
    const authScreen = document.getElementById("auth-screen");
    const bottomNav = document.getElementById("bottom-nav");
    const normalizedInvite = String(invite || "").trim();
    if (!normalizedInvite || !inviteInput) return false;

    // An invitation link always starts a fresh registration flow. Do not let a
    // previously saved session route this browser into an existing account.
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    currentUser = null;
    isAdmin = false;
    if (!isSignup && typeof window.toggleAuth === "function") window.toggleAuth();
    inviteInput.value = normalizedInvite;
    inviteInput.readOnly = true;
    if (authScreen) authScreen.classList.add("active");
    if (bottomNav) bottomNav.style.display = "none";
    document.querySelector(".app-container").classList.remove("nav-visible");
    document.getElementById("header-title").innerText = "SECURO";
    return true;
  }

  window.addEventListener("load", async () => {
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (await showInviteRegistration(invite)) return;
    try {
      const session = await api("/api/auth/session");
      if (session.authenticated) enterApp(await api("/api/me"));
    } catch {
      // تبقى شاشة الدخول ظاهرة إذا تعذر فحص الجلسة.
    }
  });
})();