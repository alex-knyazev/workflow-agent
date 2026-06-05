const rulesGrid = document.querySelector("#rules-grid");
const authPanel = document.querySelector("#auth-panel");
const statusBanner = document.querySelector("#status-banner");
const logoutButton = document.querySelector("#logout-button");

logoutButton.addEventListener("click", async () => {
  await logout();
});

void initializeApp();

async function initializeApp() {
  const sessionResponse = await fetch("/api/session");
  if (sessionResponse.ok) {
    setAuthenticatedView(true);
    await loadRules();
    return;
  }

  setAuthenticatedView(false);
  renderLoginForm();
}

async function loadRules() {
  setStatus("Загружаю правила...", "success");

  try {
    const response = await fetch("/api/rules");
    const payload = await response.json();

    if (response.status === 401) {
      setAuthenticatedView(false);
      renderLoginForm();
      setStatus("Сессия истекла. Войдите снова.", "error");
      return;
    }

    if (!response.ok) {
      throw new Error(payload.error || "Не удалось загрузить правила");
    }

    renderRules(payload.rules || []);
    setStatus("Правила загружены.", "success", 1800);
  } catch (error) {
    setStatus(getErrorMessage(error, "Не удалось загрузить правила"), "error");
  }
}

function renderRules(rules) {
  rulesGrid.innerHTML = "";

  for (const rule of rules) {
    rulesGrid.appendChild(createRuleCard(rule));
  }
}

function createRuleCard(rule) {
  const card = document.createElement("article");
  card.className = "rule-card";

  const scheduleEditor =
    rule.schedule.kind === "interval"
      ? renderIntervalEditor(rule)
      : renderCronEditor(rule);

  card.innerHTML = `
    <div class="rule-header">
      <div>
        <h2 class="rule-title">${escapeHtml(rule.name)}</h2>
        <p class="rule-description">${escapeHtml(rule.description)}</p>
      </div>
    </div>
    <div class="rule-badges">
      <span class="badge">${rule.enabled ? "Включено" : "Выключено"}</span>
      <span class="badge badge-neutral">${formatSchedule(rule.schedule)}</span>
    </div>
    <form class="pure-form pure-form-stacked" data-rule-id="${escapeHtml(rule.id)}">
      <label class="inline-toggle">
        <input type="checkbox" name="enabled" ${rule.enabled ? "checked" : ""}>
        <span>Правило активно</span>
      </label>
      <p class="default-note">${buildDefaultNote(rule)}</p>
      ${scheduleEditor}
      <details class="test-actions">
        <summary>Тест</summary>
        <div class="test-actions-buttons">
          <button type="button" class="pure-button test-button" data-action="trigger-live">Стриггерить вручную</button>
          <button type="button" class="pure-button test-button test-button-secondary" data-action="trigger-test">Стриггерить вручную с тестовыми входящими данными</button>
        </div>
      </details>
      <div class="card-actions">
        <button type="submit" class="pure-button save-button">Сохранить</button>
        <span class="meta-text">ID: ${escapeHtml(rule.id)}</span>
      </div>
    </form>
  `;

  const form = card.querySelector("form");
  const triggerLiveButton = form.querySelector(
    "button[data-action='trigger-live']",
  );
  const triggerTestButton = form.querySelector(
    "button[data-action='trigger-test']",
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveRule(form, rule);
  });

  triggerLiveButton.addEventListener("click", async () => {
    await triggerRuleAction(form, rule, "live");
  });

  triggerTestButton.addEventListener("click", async () => {
    await triggerRuleAction(form, rule, "test");
  });

  return card;
}

function renderIntervalEditor(rule) {
  const intervalMinutes = (rule.schedule.intervalMs / 60000)
    .toFixed(2)
    .replace(/\.00$/, "");

  return `
    <div class="form-grid">
      <label>
        Частота, минуты
        <input type="number" name="intervalMinutes" min="0.1" step="0.1" value="${intervalMinutes}">
      </label>
      <label class="inline-toggle">
        <input type="checkbox" name="runImmediately" ${rule.schedule.runImmediately !== false ? "checked" : ""}>
        <span>Запускать сразу после применения</span>
      </label>
    </div>
    <p class="form-hint">Изменение влияет только на это правило и сохраняется в overrides.</p>
  `;
}

function renderCronEditor(rule) {
  const dailyTime = parseDailyCron(rule.schedule.cronExpression);
  const timeZone = rule.schedule.timeZone || "Europe/Moscow";

  if (dailyTime) {
    return `
      <div class="form-grid">
        <label>
          Час запуска
          <input type="number" name="cronHour" min="0" max="23" step="1" value="${dailyTime.hour}">
        </label>
        <label>
          Минута запуска
          <input type="number" name="cronMinute" min="0" max="59" step="1" value="${dailyTime.minute}">
        </label>
        <label class="form-grid-single">
          Time zone
          <input type="text" name="timeZone" value="${escapeAttribute(timeZone)}">
        </label>
      </div>
      <p class="form-hint">Текущее cron-выражение: ${escapeHtml(rule.schedule.cronExpression)}</p>
    `;
  }

  return `
    <div class="form-grid">
      <label class="form-grid-single">
        Cron expression
        <input type="text" name="cronExpression" value="${escapeAttribute(rule.schedule.cronExpression)}">
      </label>
      <label class="form-grid-single">
        Time zone
        <input type="text" name="timeZone" value="${escapeAttribute(timeZone)}">
      </label>
    </div>
  `;
}

async function saveRule(form, rule) {
  const submitButton = form.querySelector("button[type='submit']");
  submitButton.disabled = true;
  setStatus(`Сохраняю правило ${rule.name}...`, "success");

  try {
    const payload = buildPayload(form, rule);
    const response = await fetch(`/api/rules/${encodeURIComponent(rule.id)}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const responseBody = await response.json();

    if (response.status === 401) {
      setAuthenticatedView(false);
      renderLoginForm();
      setStatus("Сессия истекла. Войдите снова.", "error");
      return;
    }

    if (!response.ok) {
      throw new Error(responseBody.error || "Не удалось сохранить правило");
    }

    await loadRules();
    setStatus(`Правило ${rule.name} сохранено.`, "success", 2200);
  } catch (error) {
    setStatus(getErrorMessage(error, "Не удалось сохранить правило"), "error");
  } finally {
    submitButton.disabled = false;
  }
}

async function triggerRuleAction(form, rule, mode) {
  const triggerButtons = form.querySelectorAll(
    "button[data-action^='trigger-']",
  );
  for (const button of triggerButtons) {
    button.disabled = true;
  }

  const isTestMode = mode === "test";
  const actionText = isTestMode ? "тестовый запуск" : "ручной запуск";
  setStatus(`Выполняю ${actionText} для ${rule.name}...`, "success");

  try {
    const endpoint = isTestMode
      ? `/api/rules/${encodeURIComponent(rule.id)}/trigger-test`
      : `/api/rules/${encodeURIComponent(rule.id)}/trigger`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const payload = await response.json();
    if (response.status === 401) {
      setAuthenticatedView(false);
      renderLoginForm();
      setStatus("Сессия истекла. Войдите снова.", "error");
      return;
    }

    if (!response.ok) {
      throw new Error(payload.error || "Не удалось выполнить ручной запуск");
    }

    const result = payload.result || {};
    const matchedIssuesCount = Number(result.matchedIssuesCount || 0);
    const notifiedCount = Number(result.notifiedCount || 0);
    setStatus(
      `${rule.name}: ${actionText} завершен. matched=${matchedIssuesCount}, notified=${notifiedCount}.`,
      "success",
      3500,
    );
  } catch (error) {
    setStatus(
      getErrorMessage(error, "Не удалось выполнить ручной запуск"),
      "error",
    );
  } finally {
    for (const button of triggerButtons) {
      button.disabled = false;
    }
  }
}

function renderLoginForm() {
  rulesGrid.innerHTML = "";
  authPanel.classList.remove("hidden");
  authPanel.innerHTML = `
    <h2 class="auth-title">Вход</h2>
    <p class="auth-subtitle">Авторизуйтесь, чтобы управлять правилами.</p>
    <form id="login-form" class="pure-form pure-form-stacked">
      <label>
        Логин
        <input type="text" name="login" autocomplete="username" required>
      </label>
      <label>
        Пароль
        <input type="password" name="password" autocomplete="current-password" required>
      </label>
      <br/>
      <button type="submit" class="pure-button login-button">Войти</button>
    </form>
  `;

  const loginForm = document.querySelector("#login-form");
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await login(loginForm);
  });
}

async function login(form) {
  const formData = new FormData(form);
  const loginValue = String(formData.get("login") || "").trim();
  const passwordValue = String(formData.get("password") || "");

  if (!loginValue || !passwordValue) {
    setStatus("Введите логин и пароль.", "error");
    return;
  }

  setStatus("Проверяю учетные данные...", "success");

  try {
    const response = await fetch("/api/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        login: loginValue,
        password: passwordValue,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Ошибка авторизации");
    }

    setAuthenticatedView(true);
    authPanel.classList.add("hidden");
    await loadRules();
  } catch (error) {
    setStatus(getErrorMessage(error, "Ошибка авторизации"), "error");
  }
}

async function logout() {
  try {
    await fetch("/api/session", { method: "DELETE" });
  } finally {
    setAuthenticatedView(false);
    renderLoginForm();
    setStatus("Вы вышли из системы.", "success", 1400);
  }
}

function setAuthenticatedView(isAuthenticated) {
  if (isAuthenticated) {
    logoutButton.classList.remove("hidden");
    authPanel.classList.add("hidden");
    return;
  }

  logoutButton.classList.add("hidden");
}

function buildPayload(form, rule) {
  const formData = new FormData(form);
  const enabled = formData.get("enabled") === "on";

  if (rule.schedule.kind === "interval") {
    const intervalMinutes = Number(formData.get("intervalMinutes"));
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      throw new Error("Частота должна быть положительным числом минут.");
    }

    return {
      enabled,
      schedule: {
        kind: "interval",
        intervalMs: Math.round(intervalMinutes * 60000),
        runImmediately: formData.get("runImmediately") === "on",
      },
    };
  }

  const hourField = formData.get("cronHour");
  const minuteField = formData.get("cronMinute");
  const timeZone = String(formData.get("timeZone") || "").trim();

  if (hourField !== null && minuteField !== null) {
    const hour = Number(hourField);
    const minute = Number(minuteField);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      throw new Error("Час запуска должен быть целым числом от 0 до 23.");
    }

    if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
      throw new Error("Минута запуска должна быть целым числом от 0 до 59.");
    }

    return {
      enabled,
      schedule: {
        kind: "cron",
        cronExpression: `${minute} ${hour} * * *`,
        ...(timeZone ? { timeZone } : {}),
      },
    };
  }

  const cronExpression = String(formData.get("cronExpression") || "").trim();
  if (!cronExpression) {
    throw new Error("Cron expression не может быть пустым.");
  }

  return {
    enabled,
    schedule: {
      kind: "cron",
      cronExpression,
      ...(timeZone ? { timeZone } : {}),
    },
  };
}

function buildDefaultNote(rule) {
  const noteParts = [];
  noteParts.push(
    rule.enabledOverridden
      ? `override enabled: ${rule.enabled ? "on" : "off"}`
      : `default enabled: ${rule.defaultEnabled ? "on" : "off"}`,
  );
  noteParts.push(
    rule.scheduleOverridden
      ? `override schedule: ${formatSchedule(rule.schedule)}`
      : `default schedule: ${formatSchedule(rule.defaultSchedule)}`,
  );
  return noteParts.join(" · ");
}

function formatSchedule(schedule) {
  if (schedule.kind === "interval") {
    const minutes = schedule.intervalMs / 60000;
    return `каждые ${trimTrailingZero(minutes)} мин`;
  }

  const dailyTime = parseDailyCron(schedule.cronExpression);
  if (dailyTime) {
    return `ежедневно в ${String(dailyTime.hour).padStart(2, "0")}:${String(dailyTime.minute).padStart(2, "0")}${schedule.timeZone ? ` (${schedule.timeZone})` : ""}`;
  }

  return `cron: ${schedule.cronExpression}`;
}

function parseDailyCron(expression) {
  const match = expression.match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
  if (!match) {
    return null;
  }

  return {
    minute: Number(match[1]),
    hour: Number(match[2]),
  };
}

function setStatus(message, type, timeoutMs = 0) {
  statusBanner.textContent = message;
  statusBanner.className = `status-banner status-banner-${type}`;

  if (timeoutMs > 0) {
    window.setTimeout(() => {
      statusBanner.className = "status-banner status-banner-hidden";
      statusBanner.textContent = "";
    }, timeoutMs);
  }
}

function getErrorMessage(error, fallbackMessage) {
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }

  return fallbackMessage;
}

function trimTrailingZero(value) {
  return value
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
