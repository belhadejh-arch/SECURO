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

  function adminAccountStatus(user) {
    if (user.isAdmin) return { label: "حساب إداري", className: "badge-green" };
    if (user.isBlocked) return { label: "محظور / غير نشط", className: "badge-orange" };
    return { label: "نشط", className: "badge-green" };
  }

  function adminVipStatus(user) {
    if (!user.userVip) return { label: "غير مشترك", className: "badge-orange" };
    if (user.userVip.isTrial) {
      return { label: "تجريبي — 4 مهام إجمالاً", className: "badge-green" };
    }
    return { label: user.userVip.name || "VIP نشط", className: "badge-green" };
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
     totalDeposits = Number(payload.totalDeposits || 0);
     totalWithdrawals = Number(payload.totalWithdrawals || 0);
     totalDepositCount = Number(payload.totalDepositCount || 0);
     totalWithdrawalCount = Number(payload.totalWithdrawalCount || 0);

    if (!isAdmin) {
      document.getElementById("user-balance").innerText = balance.toFixed(2);
      document.getElementById("wheel-spins-count").innerText = availableSpins;
      if (typeof updateWheelUI === "function") updateWheelUI();
      document.getElementById("user-display-email").innerText = currentUser.email;
      setupUserInviteData();
      updateVipUIState();
      updateDailyRewardUI();
      const trialButton = document.getElementById("btn-trial-activate");
      const trialSuccess = document.getElementById("trial-success-section");
      const profileTrialItem = document.getElementById("profile-trial-cancel-item");
      if (trialButton && trialSuccess) {
        trialButton.style.display = trialUsed ? "none" : "block";
        trialSuccess.style.display = trialActive ? "block" : "none";
      }
      if (profileTrialItem) {
        profileTrialItem.style.display = trialActive ? "flex" : "none";
      }
      const homeBalanceEl = document.getElementById("home-balance");
      if (homeBalanceEl) homeBalanceEl.innerText = balance.toFixed(2);
       const totalDepositsEl = document.getElementById("user-total-deposits");
       const totalWithdrawalsEl = document.getElementById("user-total-withdrawals");
       if (totalDepositsEl) totalDepositsEl.innerText = `$${totalDeposits.toFixed(2)}`;
       if (totalWithdrawalsEl) totalWithdrawalsEl.innerText = `$${totalWithdrawals.toFixed(2)}`;
       const totalDepositCountEl = document.getElementById("user-total-deposit-count");
       const totalWithdrawalCountEl = document.getElementById("user-total-withdrawal-count");
       if (totalDepositCountEl) totalDepositCountEl.innerText = `${totalDepositCount} عملية`;
       if (totalWithdrawalCountEl) totalWithdrawalCountEl.innerText = `${totalWithdrawalCount} عملية`;
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
     if (user.totalDeposits !== undefined) totalDeposits = Number(user.totalDeposits || 0);
     if (user.totalWithdrawals !== undefined) totalWithdrawals = Number(user.totalWithdrawals || 0);
     if (user.totalDepositCount !== undefined) totalDepositCount = Number(user.totalDepositCount || 0);
     if (user.totalWithdrawalCount !== undefined) totalWithdrawalCount = Number(user.totalWithdrawalCount || 0);
    const balanceEl = document.getElementById("user-balance");
    const homeBalanceEl = document.getElementById("home-balance");
    const spinsEl = document.getElementById("wheel-spins-count");
    if (balanceEl) balanceEl.innerText = balance.toFixed(2);
    if (homeBalanceEl) homeBalanceEl.innerText = balance.toFixed(2);
    if (spinsEl) spinsEl.innerText = availableSpins;
     const totalDepositsEl = document.getElementById("user-total-deposits");
     const totalWithdrawalsEl = document.getElementById("user-total-withdrawals");
     if (totalDepositsEl) totalDepositsEl.innerText = `$${totalDeposits.toFixed(2)}`;
     if (totalWithdrawalsEl) totalWithdrawalsEl.innerText = `$${totalWithdrawals.toFixed(2)}`;
     const totalDepositCountEl = document.getElementById("user-total-deposit-count");
     const totalWithdrawalCountEl = document.getElementById("user-total-withdrawal-count");
     if (totalDepositCountEl) totalDepositCountEl.innerText = `${totalDepositCount} عملية`;
     if (totalWithdrawalCountEl) totalWithdrawalCountEl.innerText = `${totalWithdrawalCount} عملية`;
    if (typeof updateWheelUI === "function") updateWheelUI();
    // Update trial cancel button visibility
    const trialButton = document.getElementById("btn-trial-activate");
    const trialSuccess = document.getElementById("trial-success-section");
    const profileTrialItem = document.getElementById("profile-trial-cancel-item");
    if (trialButton && trialSuccess) {
      trialButton.style.display = trialUsed ? "none" : "block";
      trialSuccess.style.display = trialActive ? "block" : "none";
    }
    if (profileTrialItem) {
      profileTrialItem.style.display = trialActive ? "flex" : "none";
    }
    if (typeof updateVipUIState === "function") updateVipUIState();
    if (typeof updateDailyRewardUI === "function") updateDailyRewardUI();
  };

  function enterApp(payload) {
    hydrate(payload);
    document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
    document.getElementById("auth-screen").classList.remove("active");
    if (isAdmin) {
      if (typeof setPlatformMenuMode === "function") setPlatformMenuMode(true);
      document.querySelector(".app-container").classList.remove("nav-visible");
      document.getElementById("admin-screen").classList.add("active");
      document.getElementById("header-title").innerText = "SECURO ADMIN";
      renderAdminDashboard();
      startAdminDashboardRefresh();
    } else {
      if (typeof setPlatformMenuMode === "function") setPlatformMenuMode(false);
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

  // كل مستخدمي الأدمن المحفوظون محلياً للبحث الفوري
  let _allAdminUsers = [];

  function buildUserCard(user) {
    const accountStatus = adminAccountStatus(user);
    const vipStatus = adminVipStatus(user);
    const hasTrial = Boolean(user.trialActive || (user.userVip && user.userVip.isTrial));
    const vipExpiry = user.userVip && user.vipExpiresAt
      ? `<small style="display:block;color:var(--text-muted);margin-top:3px">ينتهي: ${escapeHtml(dateText(user.vipExpiresAt))}</small>`
      : "";
    const totalDep  = Number(user.totalDeposits  || 0).toFixed(2);
    const totalWith = Number(user.totalWithdrawals || 0).toFixed(2);
    return `
      <div class="history-card" style="display:block">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div class="history-info">
            <div class="history-title">👤 ${escapeHtml(user.name)} ${user.isAdmin ? "👑" : ""}</div>
            <div class="history-date">📧 ${escapeHtml(user.email)}</div>
            <div class="history-date" style="margin-top:2px">رمز الإحالة: ${escapeHtml(user.inviteCode)} | تسجيل: ${dateText(user.createdAt)}</div>
            <div class="history-date" style="margin-top:2px">🎡 فرص عجلة الحظ: ${Number(user.availableSpins || 0)}</div>
          </div>
          <div style="text-align:left;white-space:nowrap;min-width:0">
            <strong style="color:#60a5fa;font-size:1.05rem">$${Number(user.balance).toFixed(2)}</strong><br>
            <span class="history-badge ${accountStatus.className}" style="margin-top:4px;display:inline-block">${accountStatus.label}</span>
          </div>
        </div>

        <!-- إجماليات الإيداع والسحب -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;padding:8px 10px;background:rgba(15,23,42,.45);border:1px solid var(--border-color);border-radius:10px">
          <div style="flex:1;min-width:110px;text-align:center">
            <div style="font-size:.68rem;color:var(--text-muted);margin-bottom:2px">إجمالي الإيداع</div>
            <div style="font-weight:800;color:#34d399;font-size:.95rem">$${totalDep}</div>
          </div>
          <div style="width:1px;background:var(--border-color);align-self:stretch"></div>
          <div style="flex:1;min-width:110px;text-align:center">
            <div style="font-size:.68rem;color:var(--text-muted);margin-bottom:2px">إجمالي السحب</div>
            <div style="font-weight:800;color:#f87171;font-size:.95rem">$${totalWith}</div>
          </div>
          <div style="width:1px;background:var(--border-color);align-self:stretch"></div>
          <div style="flex:1;min-width:110px;text-align:center">
            <div style="font-size:.68rem;color:var(--text-muted);margin-bottom:2px">عضوية VIP</div>
            <span class="history-badge ${vipStatus.className}" style="display:inline-block">${escapeHtml(vipStatus.label)}</span>
            ${vipExpiry}
          </div>
        </div>

        <!-- أزرار الإجراءات الخاصة بالمستخدمين فقط -->
        ${!user.isAdmin ? `
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;border-top:1px solid var(--border-color);padding-top:8px">
            <button class="btn btn-green"  style="flex:1;min-width:100px;padding:6px 8px;font-size:.72rem;min-height:38px" onclick="adminAdjustBalance(${user.id},${Number(user.balance).toFixed(2)})">✏️ تعديل الرصيد</button>
            <button class="btn btn-gold"   style="flex:1;min-width:100px;padding:6px 8px;font-size:.72rem;min-height:38px" onclick="adminChangeVip(${user.id})">👑 تغيير VIP</button>
            <button class="btn"            style="flex:1;min-width:100px;padding:6px 8px;font-size:.72rem;min-height:38px;background:#6366f1;color:white" onclick="adminResetTasks(${user.id})">🔄 تصفير المهام</button>
            <button class="btn"            style="flex:1;min-width:100px;padding:6px 8px;font-size:.72rem;min-height:38px;background:#0891b2;color:white" onclick="adminGrantSpin(${user.id})">🎡 منح فرصة عجلة</button>
            ${hasTrial ? `<button class="btn btn-red" style="flex:1;min-width:100px;padding:6px 8px;font-size:.72rem;min-height:38px" onclick="adminCancelTrial(${user.id})">🚫 إلغاء التجربة</button>` : ""}
            <button class="btn ${user.isBlocked ? "btn-green" : "btn-red"}" style="flex:1;min-width:100px;padding:6px 8px;font-size:.72rem;min-height:38px" onclick="adminToggleBlock(${user.id},${!user.isBlocked})">${user.isBlocked ? "✅ رفع الحظر" : "🚫 حظر"}</button>
          </div>
        ` : ""}
      </div>`;
  }

  function renderUsersList(users) {
    const container = document.getElementById("admin-users-list");
    if (!container) return;
    container.innerHTML = users.length
      ? users.map(buildUserCard).join("")
      : '<div class="history-date" style="padding:20px;text-align:center">لا توجد نتائج.</div>';
  }

  window.adminSearchUsers = function () {
    const input = document.getElementById("admin-search-input");
    const clearBtn = document.getElementById("admin-search-clear");
    const q = (input?.value || "").trim().toLowerCase();
    if (clearBtn) clearBtn.style.display = q ? "inline" : "none";
    if (!q) return renderUsersList(_allAdminUsers);
    const filtered = _allAdminUsers.filter((u) =>
      (u.name  || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.inviteCode || "").toLowerCase().includes(q)
    );
    renderUsersList(filtered);
  };

  window.renderAdminDashboard = async function () {
    if (adminRefreshInFlight) return;
    adminRefreshInFlight = true;
    try {
      const data = await api("/api/admin/overview");
      _allAdminUsers = data.users;
      document.getElementById("admin-total-users").innerText = data.stats.users;
      document.getElementById("admin-total-deposits").innerText = `$${Number(data.stats.deposits).toFixed(2)}`;
      document.getElementById("admin-total-withdraws").innerText = `$${Number(data.stats.withdrawals).toFixed(2)}`;
       const adminDepositCount = document.getElementById("admin-total-deposit-count");
       const adminWithdrawalCount = document.getElementById("admin-total-withdrawal-count");
       if (adminDepositCount) adminDepositCount.innerText = `${Number(data.stats.depositCount || 0)} عملية مقبولة`;
       if (adminWithdrawalCount) adminWithdrawalCount.innerText = `${Number(data.stats.withdrawalCount || 0)} عملية مقبولة`;

      // أعد تطبيق فلتر البحث إن وُجد
      const q = (document.getElementById("admin-search-input")?.value || "").trim();
      if (q) {
        window.adminSearchUsers();
      } else {
        renderUsersList(_allAdminUsers);
      }

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
  window.adminAdjustBalance = async function (userId, currentBalance) {
    const input = window.prompt(
      `أدخل قيمة التعديل على الرصيد الحالي ($${Number(currentBalance).toFixed(2)}). استخدم قيمة موجبة للإضافة أو سالبة للخصم:`,
      "",
    );
    if (input === null || !input.trim()) return;
    const amount = Number(input);
    if (!Number.isFinite(amount) || amount === 0) {
      return showApiError(new Error("أدخل قيمة مالية صحيحة غير صفرية"));
    }
    const reason = window.prompt("سبب التعديل (اختياري):", "تعديل إداري للرصيد") || "تعديل إداري للرصيد";
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}/balance`, {
        method: "POST",
        body: JSON.stringify({ amount, reason }),
      });
      await window.renderAdminDashboard();
    } catch (error) {
      showApiError(error);
    }
  };
  window.adminChangeVip = async function (userId) {
    const name = window.prompt("اختر العضوية: VIP 1 أو VIP 2 أو VIP 3 أو VIP 4", "VIP 1");
    if (name === null) return;
    if (!["VIP 1", "VIP 2", "VIP 3", "VIP 4"].includes(name.trim())) {
      return showApiError(new Error("اسم عضوية VIP غير صالح"));
    }
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}/vip`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      await window.renderAdminDashboard();
    } catch (error) {
      showApiError(error);
    }
  };
  window.adminResetTasks = async function (userId) {
    if (!window.confirm("هل تريد تصفير مهام هذا المستخدم لليوم؟")) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}/tasks/reset`, {
        method: "POST",
      });
      await window.renderAdminDashboard();
    } catch (error) {
      showApiError(error);
    }
  };

  window.adminCancelTrial = async function (userId) {
    if (!window.confirm("هل تريد إلغاء الفترة التجريبية لهذا المستخدم؟ لن يتمكن من إعادة تفعيلها.")) return;
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}/trial/cancel`, {
        method: "POST",
      });
      await window.renderAdminDashboard();
    } catch (error) {
      showApiError(error);
    }
  };

  window.adminGrantSpin = async function (userId) {
    const input = window.prompt("كم عدد المحاولات التي تريد منحها لهذا المستخدم؟", "1");
    if (input === null) return;
    const count = Number(input);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      return showApiError(new Error("أدخل عدداً صحيحاً بين 1 و100"));
    }
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}/spins`, {
        method: "POST",
        body: JSON.stringify({ count }),
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