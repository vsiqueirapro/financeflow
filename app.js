/**
 * =========================================================================
 * FINANCEFLOW - CORE JAVASCRIPT APPLICATION ENGINE (V2.0)
 * =========================================================================
 * Sistema de controle financeiro com dados 100% reais:
 * - Contas bancárias
 * - Cartões de crédito dedicados (limite, fatura e despesas de cartão)
 * - FIIs simplificados por saldo atual no momento
 * - Gráficos 100% reais sem dados fictícios
 * - Sincronização Google Drive com suporte a senha secreta
 * =========================================================================
 */

// Bank Preset Styles and Colors
const BANK_PRESETS = {
  'Nubank': { color: '#820ad1', logo: 'Nu' },
  'Itaú': { color: '#ec7000', logo: 'Itaú' },
  'Inter': { color: '#ff7a00', logo: 'Inter' },
  'Bradesco': { color: '#cc092f', logo: 'BBDC' },
  'Santander': { color: '#ec0000', logo: 'SAN' },
  'Banco do Brasil': { color: '#003882', logo: 'BB' },
  'Caixa': { color: '#0066b3', logo: 'CEF' },
  'C6 Bank': { color: '#242424', logo: 'C6' },
  'BTG Pactual': { color: '#001e62', logo: 'BTG' },
  'XP Investimentos': { color: '#111111', logo: 'XP' },
  'Carteira': { color: '#10b981', logo: '💵' },
  'Outro': { color: '#6366f1', logo: 'Bank' }
};

// Initial State Schema
const DEFAULT_STATE = {
  accounts: [],
  cards: [],
  fiis: [],
  transactions: [],
  purposes: [
    { id: 'casa', name: 'CASA', color: '#3b82f6', isDefault: true, description: 'Contas e despesas da residência / família' },
    { id: 'pessoal', name: 'PESSOAL', color: '#10b981', isDefault: true, description: 'Gastos e contas particulares e individuais' }
  ],
  categories: [
    { id: 'moradia', name: 'Moradia / Aluguel', type: 'expense', icon: '🏠', color: '#6366f1' },
    { id: 'mercado', name: 'Supermercado & Alimentação', type: 'expense', icon: '🛒', color: '#f59e0b' },
    { id: 'contas', name: 'Contas (Luz, Água, Net)', type: 'expense', icon: '💡', color: '#06b6d4' },
    { id: 'transporte', name: 'Transporte & Combustível', type: 'expense', icon: '🚗', color: '#ec4899' },
    { id: 'saude', name: 'Saúde & Farmácia', type: 'expense', icon: '💊', color: '#ef4444' },
    { id: 'lazer', name: 'Lazer & Restaurantes', type: 'expense', icon: '🎉', color: '#8b5cf6' },
    { id: 'salario', name: 'Salário & Honorários', type: 'income', icon: '💰', color: '#10b981' },
    { id: 'dividendos', name: 'Proventos FIIs & Investimentos', type: 'income', icon: '📈', color: '#10b981' },
    { id: 'outros', name: 'Outros Gastos', type: 'expense', icon: '🏷️', color: '#94a3b8' }
  ],
  balanceSnapshots: [],
  settings: {
    driveScriptUrl: '',
    driveToken: '',
    autoSync: true,
    lastSyncTime: null,
    privacyMode: false,
    currentYear: 2026,
    currentMonth: 9 // 0-indexed (9 = Outubro)
  }
};

// Global App Variables
let appState = null;
let currentActiveView = 'dashboard';
let globalSelectedPurpose = 'ALL';
let chartsInstances = {};
let syncDebounceTimer = null;

// =========================================================================
// INITIALIZATION & STATE PERSISTENCE
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
  initAppState();
  initDateSelectors();
  initNavigation();
  initPWA();
  renderApp();
  
  if (appState.settings.driveScriptUrl) {
    syncWithGoogleDrive('pull', true);
  }
});

function sanitizeAndMigrateState(rawState) {
  let s = rawState;
  if (!s || typeof s !== 'object') {
    s = JSON.parse(JSON.stringify(DEFAULT_STATE));
  }

  // Ensure all collections are guaranteed arrays
  if (!Array.isArray(s.accounts)) s.accounts = [];
  if (!Array.isArray(s.cards)) s.cards = [];
  if (!Array.isArray(s.fiis)) s.fiis = [];
  if (!Array.isArray(s.transactions)) s.transactions = [];
  if (!Array.isArray(s.purposes) || s.purposes.length === 0) {
    s.purposes = JSON.parse(JSON.stringify(DEFAULT_STATE.purposes));
  }
  if (!Array.isArray(s.categories) || s.categories.length === 0) {
    s.categories = JSON.parse(JSON.stringify(DEFAULT_STATE.categories));
  }
  if (!Array.isArray(s.balanceSnapshots)) s.balanceSnapshots = [];
  if (!s.settings || typeof s.settings !== 'object') {
    s.settings = JSON.parse(JSON.stringify(DEFAULT_STATE.settings));
  }

  // Migrate any legacy credit cards in accounts to the dedicated cards array
  const legacyCreditAccounts = s.accounts.filter(a => a && a.type === 'credit');
  if (legacyCreditAccounts.length > 0) {
    legacyCreditAccounts.forEach(c => {
      if (!s.cards.find(existing => existing.id === c.id)) {
        s.cards.push({
          id: c.id,
          name: c.name,
          bank: c.bankPreset || 'Outro',
          limit: Number(c.creditLimit || 0),
          invoice: Number(c.currentInvoice || 0),
          closingDay: c.closingDay || 20,
          dueDay: c.dueDay || 1,
          purpose: c.purpose || 'pessoal',
          color: c.color || '#820ad1'
        });
      }
    });
    s.accounts = s.accounts.filter(a => a && a.type !== 'credit');
  }

  // Migrate legacy FIIs (if they have shares/currentPrice instead of balance)
  s.fiis.forEach(f => {
    if (f) {
      if (f.balance === undefined) {
        f.balance = (Number(f.shares) || 1) * (Number(f.currentPrice) || Number(f.avgPrice) || 0);
      }
      if (f.monthlyDividend === undefined) {
        f.monthlyDividend = (Number(f.shares) || 1) * (Number(f.lastDividend) || 0);
      }
    }
  });

  return s;
}

function initAppState() {
  const localData = localStorage.getItem('financeflow_state');
  if (localData) {
    try {
      appState = sanitizeAndMigrateState(JSON.parse(localData));
    } catch (e) {
      console.error('Error parsing state:', e);
      appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
    }
  } else {
    appState = JSON.parse(JSON.stringify(DEFAULT_STATE));
  }
}

function saveLocalState() {
  localStorage.setItem('financeflow_state', JSON.stringify(appState));
  if (appState.settings.driveScriptUrl && appState.settings.autoSync) {
    scheduleDriveSync();
  }
}

function saveLocalStateOnly() {
  localStorage.setItem('financeflow_state', JSON.stringify(appState));
}

function scheduleDriveSync() {
  clearTimeout(syncDebounceTimer);
  updateSyncStatus('saving');
  syncDebounceTimer = setTimeout(() => {
    syncWithGoogleDrive('push', true);
  }, 1200);
}

// =========================================================================
// GOOGLE DRIVE SYNC ENGINE (COM SUPORTE A TOKEN DE SEGURANÇA)
// =========================================================================

function validateDriveUrl(url) {
  if (!url) return { valid: false, message: 'Por favor, informe a URL do Web App.' };
  if (url.includes('script.googleusercontent.com')) {
    return {
      valid: false,
      message: 'Atenção: Você colou a URL de redirecionamento temporário (googleusercontent). Volte na aba do Google Apps Script e copie a URL oficial da implantação que termina em "/exec".'
    };
  }
  if (!url.startsWith('https://script.google.com/')) {
    return {
      valid: false,
      message: 'A URL deve começar com "https://script.google.com/macros/s/" e terminar com "/exec".'
    };
  }
  return { valid: true };
}

async function syncWithGoogleDrive(direction = 'push', isBackground = false) {
  const url = appState.settings.driveScriptUrl ? appState.settings.driveScriptUrl.trim() : '';
  if (!url) {
    updateSyncStatus('offline');
    if (!isBackground) {
      openDriveModal();
      showToast('Insira a URL do seu Google Apps Script para sincronizar.', 'info');
    }
    return;
  }

  updateSyncStatus('saving');

  try {
    const token = appState.settings.driveToken || '';

    if (direction === 'push') {
      const payload = {
        action: 'save',
        data: appState,
        token: token
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      const resJson = await response.json();
      if (resJson.status === 'success') {
        appState.settings.lastSyncTime = new Date().toISOString();
        saveLocalStateOnly();
        updateSyncStatus('synced');
        if (!isBackground) showToast('Dados salvos com sucesso no seu Google Drive!', 'success');
      } else {
        throw new Error(resJson.message || 'Erro ao salvar no Drive');
      }
    } else if (direction === 'pull') {
      const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
      const fetchUrl = `${url}${url.includes('?') ? '&' : '?'}action=load${tokenParam}&t=${Date.now()}`;
      const response = await fetch(fetchUrl);
      const resJson = await response.json();

      if (resJson.status === 'success' && resJson.data) {
        const cloudData = resJson.data;
        if (cloudData && typeof cloudData === 'object') {
          const currentUrl = appState.settings.driveScriptUrl;
          const currentToken = appState.settings.driveToken;
          appState = sanitizeAndMigrateState(cloudData);
          if (currentUrl) appState.settings.driveScriptUrl = currentUrl;
          if (currentToken) appState.settings.driveToken = currentToken;
          appState.settings.lastSyncTime = new Date().toISOString();
          saveLocalStateOnly();
          renderApp();
          updateSyncStatus('synced');
          if (!isBackground) showToast('Dados carregados com sucesso do seu Google Drive!', 'success');
        }
      } else {
        throw new Error(resJson.message || 'Falha ao ler dados do Drive');
      }
    }
  } catch (error) {
    console.error('Google Drive sync error:', error);
    updateSyncStatus('error');
    if (!isBackground) {
      showToast(`Erro na sincronização: ${error.message || 'Verifique a URL e a senha do script.'}`, 'error');
    }
  }
}

async function testDriveConnection() {
  const urlInput = document.getElementById('settingsDriveUrl');
  const testUrl = urlInput ? urlInput.value.trim() : appState.settings.driveScriptUrl;
  const tokenInput = document.getElementById('settingsDriveToken');
  const token = (tokenInput ? tokenInput.value : (appState.settings.driveToken || '')).trim();

  const check = validateDriveUrl(testUrl);
  if (!check.valid) {
    alert(check.message);
    return;
  }

  showToast('Testando conexão com o Google Drive...', 'info');
  try {
    const tokenParam = token ? `&token=${encodeURIComponent(token)}` : '';
    const pingUrl = `${testUrl}${testUrl.includes('?') ? '&' : '?'}action=ping${tokenParam}&t=${Date.now()}`;
    const response = await fetch(pingUrl);
    const res = await response.json();
    if (res.status === 'ok' || res.status === 'success') {
      showToast('Conexão estabelecida com sucesso com seu Google Drive!', 'success');
      alert('Conexão estabelecida com sucesso com seu Google Drive!');
    } else {
      showToast(res.message || 'Resposta recebida.', 'info');
      alert(res.message || 'Resposta recebida do Google Drive.');
    }
  } catch (err) {
    showToast('Não foi possível conectar. Verifique a URL e se o script foi implantado como "Qualquer pessoa".', 'error');
    alert('Não foi possível conectar. Verifique a URL e se o script foi implantado como "Qualquer pessoa".');
  }
}

function saveDriveSettings() {
  const urlInput = document.getElementById('settingsDriveUrl');
  const tokenInput = document.getElementById('settingsDriveToken');
  if (urlInput) {
    const cleanUrl = urlInput.value.trim();
    const check = validateDriveUrl(cleanUrl);
    if (!check.valid) {
      alert(check.message);
      return;
    }
    appState.settings.driveScriptUrl = cleanUrl;
    if (tokenInput) {
      appState.settings.driveToken = tokenInput.value.trim();
    }
    saveLocalState();
    showToast('Configurações salvas. Iniciando sincronização...', 'success');
    syncWithGoogleDrive('push');
  }
}

function testDriveConnectionFromModal() {
  const urlInput = document.getElementById('modalDriveUrlInput');
  const tokenInput = document.getElementById('modalDriveTokenInput');
  if (urlInput && urlInput.value) {
    document.getElementById('settingsDriveUrl').value = urlInput.value;
    if (tokenInput) document.getElementById('settingsDriveToken').value = tokenInput.value;
    testDriveConnection();
  } else {
    showToast('Digite a URL do script primeiro.', 'error');
  }
}

function saveDriveSettingsFromModal() {
  const urlInput = document.getElementById('modalDriveUrlInput');
  const tokenInput = document.getElementById('modalDriveTokenInput');
  if (urlInput) {
    const cleanUrl = urlInput.value.trim();
    const check = validateDriveUrl(cleanUrl);
    if (!check.valid) {
      alert(check.message);
      return;
    }
    appState.settings.driveScriptUrl = cleanUrl;
    document.getElementById('settingsDriveUrl').value = cleanUrl;

    if (tokenInput) {
      appState.settings.driveToken = tokenInput.value.trim();
      document.getElementById('settingsDriveToken').value = tokenInput.value.trim();
    }

    saveLocalState();
    closeModal('modalDrive');
    showToast('Google Drive conectado! Sincronizando...', 'success');
    syncWithGoogleDrive('push');
  }
}

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

function updateSyncStatus(status) {
  const dot = document.getElementById('syncStatusDot');
  const title = document.getElementById('syncStatusTitle');
  const sub = document.getElementById('syncStatusSub');
  if (!dot) return;

  dot.className = 'sync-dot';
  if (status === 'synced') {
    dot.classList.add('dot-synced');
    if (title) title.textContent = 'Google Drive';
    if (sub) sub.textContent = 'Sincronizado';
  } else if (status === 'saving') {
    dot.classList.add('dot-saving');
    if (title) title.textContent = 'Salvando no Drive...';
    if (sub) sub.textContent = 'Aguarde um instante';
  } else if (status === 'error') {
    dot.classList.add('dot-error');
    if (title) title.textContent = 'Falha na Nuvem';
    if (sub) sub.textContent = 'Toque para verificar';
  } else {
    dot.classList.add('dot-offline');
    if (title) title.textContent = 'Modo Local (Offline)';
    if (sub) sub.textContent = 'Toque para conectar Drive';
  }
}

// =========================================================================
// NAVIGATION & DATE SELECTOR
// =========================================================================

function initDateSelectors() {
  const now = new Date();
  if (appState.settings.currentYear === undefined) {
    appState.settings.currentYear = now.getFullYear();
    appState.settings.currentMonth = now.getMonth();
  }
  updateMonthDisplay();
}

function updateMonthDisplay() {
  const monthNames = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  const display = document.getElementById('currentMonthDisplay');
  if (display) {
    display.textContent = `${monthNames[appState.settings.currentMonth]} / ${appState.settings.currentYear}`;
  }
}

function changeMonth(delta) {
  let m = appState.settings.currentMonth + delta;
  let y = appState.settings.currentYear;
  if (m < 0) {
    m = 11;
    y--;
  } else if (m > 11) {
    m = 0;
    y++;
  }
  appState.settings.currentMonth = m;
  appState.settings.currentYear = y;
  updateMonthDisplay();
  renderApp();
}

function initNavigation() {
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      switchView(view);
    });
  });

  document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      switchView(view);
    });
  });
}

function switchView(viewName) {
  currentActiveView = viewName;

  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add('active');

  document.querySelectorAll('.sidebar-nav .nav-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-view') === viewName);
  });

  document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-view') === viewName);
  });

  setTimeout(() => {
    renderCharts();
  }, 60);
}

function toggleMobileSidebar() {
  const sidebar = document.getElementById('appSidebar');
  if (sidebar) {
    sidebar.style.display = sidebar.style.display === 'flex' ? 'none' : 'flex';
  }
}

function handlePurposeFilterChange(value) {
  globalSelectedPurpose = value;
  renderApp();
}

function togglePrivacyMode() {
  appState.settings.privacyMode = !appState.settings.privacyMode;
  saveLocalState();
  renderApp();
}

// =========================================================================
// MAIN RENDER PIPELINE
// =========================================================================

function renderApp() {
  appState = sanitizeAndMigrateState(appState);
  renderPurposeSelectors();
  renderDashboard();
  renderAccountsView();
  renderCardsView();
  renderFiisView();
  renderTransactionsView();
  renderCharts();
  renderPurposesSettings();
  updateBadges();

  // Populate Drive settings fields
  const driveInput = document.getElementById('settingsDriveUrl');
  if (driveInput && appState.settings.driveScriptUrl) {
    driveInput.value = appState.settings.driveScriptUrl;
  }
  const tokenInput = document.getElementById('settingsDriveToken');
  if (tokenInput && appState.settings.driveToken) {
    tokenInput.value = appState.settings.driveToken;
  }
  const modalDriveInput = document.getElementById('modalDriveUrlInput');
  if (modalDriveInput && appState.settings.driveScriptUrl) {
    modalDriveInput.value = appState.settings.driveScriptUrl;
  }
  const modalTokenInput = document.getElementById('modalDriveTokenInput');
  if (modalTokenInput && appState.settings.driveToken) {
    modalTokenInput.value = appState.settings.driveToken;
  }
}

function updateBadges() {
  const accBadge = document.getElementById('accountsCountBadge');
  if (accBadge) accBadge.textContent = appState.accounts.length;

  const cardBadge = document.getElementById('cardsCountBadge');
  if (cardBadge) cardBadge.textContent = appState.cards.length;

  const fiiBadge = document.getElementById('fiisCountBadge');
  if (fiiBadge) fiiBadge.textContent = appState.fiis.length;

  const eyeOpen = document.querySelector('.eye-open');
  const eyeClosed = document.querySelector('.eye-closed');
  if (eyeOpen && eyeClosed) {
    eyeOpen.classList.toggle('hidden', appState.settings.privacyMode);
    eyeClosed.classList.toggle('hidden', !appState.settings.privacyMode);
  }
}

function formatCurrency(val) {
  if (appState && appState.settings && appState.settings.privacyMode) {
    return 'R$ ••••••';
  }
  const num = Number(val) || 0;
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// =========================================================================
// DASHBOARD RENDERING & KPIS REAIS
// =========================================================================

function renderDashboard() {
  const filteredAccounts = getFilteredAccounts();
  const filteredCards = getFilteredCards();
  const currentMonth = appState.settings.currentMonth;
  const currentYear = appState.settings.currentYear;

  // 1. Total em Bancos
  let totalBankCash = 0;
  filteredAccounts.forEach(acc => {
    totalBankCash += Number(acc.balance || 0);
  });

  // 2. Total em Faturas de Cartão
  let totalCreditDue = 0;
  filteredCards.forEach(card => {
    totalCreditDue += Number(card.invoice || 0);
  });

  // 3. Total em FIIs
  let totalFiisVal = 0;
  let totalMonthlyDividends = 0;
  appState.fiis.forEach(fii => {
    totalFiisVal += Number(fii.balance || 0);
    totalMonthlyDividends += Number(fii.monthlyDividend || 0);
  });

  // 4. Patrimônio Líquido Geral Consolidado (Contas + FIIs - Faturas a pagar)
  const netWorth = totalBankCash + totalFiisVal - totalCreditDue;

  document.getElementById('dashTotalNetWorth').textContent = formatCurrency(netWorth);
  document.getElementById('dashTotalBankBalance').textContent = formatCurrency(totalBankCash);
  document.getElementById('dashTotalFiisBalance').textContent = formatCurrency(totalFiisVal);
  document.getElementById('dashTotalCreditCardsDue').textContent = formatCurrency(totalCreditDue);

  // 5. Entradas e Saídas do Mês Real
  const monthTransactions = appState.transactions.filter(tx => {
    const txDate = new Date(tx.date);
    const matchesDate = txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth;
    const matchesPurpose = globalSelectedPurpose === 'ALL' || tx.purpose === globalSelectedPurpose;
    return matchesDate && matchesPurpose;
  });

  let monthIncome = 0;
  let monthExpense = 0;
  let incomeCount = 0;
  let expenseCount = 0;

  monthTransactions.forEach(tx => {
    if (tx.type === 'income') {
      monthIncome += Number(tx.amount || 0);
      incomeCount++;
    } else if (tx.type === 'expense') {
      monthExpense += Number(tx.amount || 0);
      expenseCount++;
    }
  });

  const monthResult = monthIncome - monthExpense;
  const savingsRate = monthIncome > 0 ? ((monthResult / monthIncome) * 100) : 0;

  document.getElementById('dashMonthIncome').textContent = formatCurrency(monthIncome);
  document.getElementById('dashMonthIncomeCount').textContent = `${incomeCount} entradas reais no período`;
  document.getElementById('dashMonthExpense').textContent = formatCurrency(monthExpense);
  document.getElementById('dashMonthExpenseCount').textContent = `${expenseCount} despesas registradas`;
  
  const resultEl = document.getElementById('dashMonthResult');
  resultEl.textContent = formatCurrency(monthResult);
  resultEl.className = `kpi-value ${monthResult >= 0 ? 'color-income' : 'color-expense'}`;
  document.getElementById('dashMonthResultPct').textContent = `Taxa de poupança: ${savingsRate.toFixed(1)}%`;

  // 6. Proventos
  document.getElementById('dashEstimatedDividends').textContent = formatCurrency(totalMonthlyDividends);
  const avgYieldMonthly = totalFiisVal > 0 ? (totalMonthlyDividends / totalFiisVal) * 100 : 0;
  document.getElementById('dashPortfolioYieldAvg').textContent = `Yield médio: ${avgYieldMonthly.toFixed(2)}% a.m.`;

  // 7. Previews na Dashboard
  renderDashboardAccountsPreview(filteredAccounts);
  renderDashboardCardsPreview(filteredCards);
  renderDashboardRecentTransactions(monthTransactions);
}

function renderDashboardAccountsPreview(accounts) {
  const container = document.getElementById('dashAccountsPreview');
  if (!container) return;

  if (accounts.length === 0) {
    container.innerHTML = `<p class="text-dim" style="padding: 12px; font-size: 0.85rem;">Nenhuma conta bancária cadastrada.</p>`;
    return;
  }

  container.innerHTML = accounts.slice(0, 4).map(acc => {
    const purposeObj = appState.purposes.find(p => p.id === acc.purpose) || { name: acc.purpose || 'PESSOAL', color: '#10b981' };
    const preset = BANK_PRESETS[acc.bankPreset] || { color: acc.color || '#6366f1', logo: acc.name.substring(0, 2) };

    return `
      <div class="acc-mini-card">
        <div class="acc-mini-left">
          <div class="bank-avatar-badge" style="background: ${acc.color || preset.color}">
            ${preset.logo}
          </div>
          <div>
            <div class="acc-mini-title">${acc.name}</div>
            <div class="acc-mini-sub">
              <span class="card-purpose-badge" style="color: ${purposeObj.color}; border-color: ${purposeObj.color}40; background: ${purposeObj.color}15">
                ${purposeObj.name}
              </span>
              <span>${getAccountTypeLabel(acc.type)}</span>
            </div>
          </div>
        </div>
        <div class="acc-mini-val color-brand">
          ${formatCurrency(acc.balance)}
        </div>
      </div>
    `;
  }).join('');
}

function renderDashboardCardsPreview(cards) {
  const container = document.getElementById('dashCardsPreview');
  if (!container) return;

  if (cards.length === 0) {
    container.innerHTML = `<p class="text-dim" style="padding: 12px; font-size: 0.85rem;">Nenhum cartão de crédito cadastrado.</p>`;
    return;
  }

  container.innerHTML = cards.slice(0, 4).map(card => {
    const purposeObj = appState.purposes.find(p => p.id === card.purpose) || { name: card.purpose || 'PESSOAL', color: '#10b981' };
    const preset = BANK_PRESETS[card.bank] || { color: card.color || '#820ad1', logo: 'CARD' };

    return `
      <div class="acc-mini-card">
        <div class="acc-mini-left">
          <div class="bank-avatar-badge" style="background: ${card.color || preset.color}">
            💳
          </div>
          <div>
            <div class="acc-mini-title">${card.name}</div>
            <div class="acc-mini-sub">
              <span class="card-purpose-badge" style="color: ${purposeObj.color}; border-color: ${purposeObj.color}40; background: ${purposeObj.color}15">
                ${purposeObj.name}
              </span>
              <span>Vence dia ${card.dueDay || '--'}</span>
            </div>
          </div>
        </div>
        <div class="acc-mini-val color-expense">
          -${formatCurrency(card.invoice)}
        </div>
      </div>
    `;
  }).join('');
}

function renderDashboardRecentTransactions(transactions) {
  const tbody = document.getElementById('dashRecentTransactionsBody');
  if (!tbody) return;

  if (transactions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 20px;">Nenhuma movimentação registrada no período selecionado.</td></tr>`;
    return;
  }

  const sorted = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6);

  tbody.innerHTML = sorted.map(tx => {
    const originLabel = getTxOriginLabel(tx);
    const purposeObj = appState.purposes.find(p => p.id === tx.purpose) || { name: tx.purpose || 'PESSOAL', color: '#10b981' };
    const cat = appState.categories.find(c => c.id === tx.category) || { name: tx.category || 'Geral', icon: '🏷️' };
    const isIncome = tx.type === 'income';
    const isCompleted = tx.status === 'completed';

    return `
      <tr>
        <td>${formatDateBR(tx.date)}</td>
        <td><strong>${tx.description}</strong></td>
        <td>${originLabel}</td>
        <td>
          <span class="card-purpose-badge" style="color:${purposeObj.color}; border-color:${purposeObj.color}40; background:${purposeObj.color}15">
            ${purposeObj.name}
          </span>
        </td>
        <td>${cat.icon} ${cat.name}</td>
        <td class="${isIncome ? 'val-positive' : 'val-negative'}">
          ${isIncome ? '+' : '-'}${formatCurrency(tx.amount)}
        </td>
        <td>
          <span class="status-badge ${isCompleted ? 'status-paid' : 'status-pending'}" onclick="toggleTxStatus('${tx.id}')">
            ${isCompleted ? '✓ Concluído' : '⏳ Pendente'}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

function getTxOriginLabel(tx) {
  if (tx.originType === 'card' || tx.cardId) {
    const card = appState.cards.find(c => c.id === (tx.cardId || tx.accountId));
    return card ? `💳 ${card.name}` : '💳 Cartão de Crédito';
  } else {
    const acc = appState.accounts.find(a => a.id === tx.accountId);
    return acc ? `🏦 ${acc.name}` : '🏦 Conta Bancária';
  }
}

// =========================================================================
// ACCOUNTS VIEW (CONTAS BANCÁRIAS)
// =========================================================================

function getFilteredAccounts() {
  if (globalSelectedPurpose === 'ALL') return appState.accounts;
  return appState.accounts.filter(a => a.purpose === globalSelectedPurpose);
}

function renderAccountsView() {
  const container = document.getElementById('accountsCardsGrid');
  if (!container) return;

  const accounts = getFilteredAccounts();

  let cashTotal = 0;
  let casaTotal = 0;
  let pessoalTotal = 0;

  appState.accounts.forEach(acc => {
    const bal = Number(acc.balance || 0);
    cashTotal += bal;
    if (acc.purpose === 'casa') casaTotal += bal;
    if (acc.purpose === 'pessoal') pessoalTotal += bal;
  });

  document.getElementById('accTotalCash').textContent = formatCurrency(cashTotal);
  document.getElementById('accTotalCasa').textContent = formatCurrency(casaTotal);
  document.getElementById('accTotalPessoal').textContent = formatCurrency(pessoalTotal);

  if (accounts.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; background: rgba(255,255,255,0.02); border-radius: var(--radius-lg); border: 1px dashed var(--border-subtle)">
        <p style="color: var(--text-muted); margin-bottom: 12px;">Nenhuma conta bancária cadastrada.</p>
        <button class="btn-primary" onclick="openNewAccountModal()">+ Cadastrar Minha Primeira Conta Bancária</button>
      </div>
    `;
    return;
  }

  container.innerHTML = accounts.map(acc => {
    const purposeObj = appState.purposes.find(p => p.id === acc.purpose) || { name: acc.purpose || 'PESSOAL', color: '#10b981' };
    const preset = BANK_PRESETS[acc.bankPreset] || { color: acc.color || '#6366f1', logo: 'BANK' };
    const cardColor = acc.color || preset.color;

    return `
      <div class="bank-card-item" style="border-top: 4px solid ${cardColor}">
        <div class="card-top-row">
          <div class="card-bank-badge">
            <div class="card-chip"></div>
            <div>
              <span class="card-bank-name">${acc.name}</span>
              <div style="font-size: 0.72rem; color: var(--text-muted)">${acc.bankPreset || 'Banco'} • ${getAccountTypeLabel(acc.type)}</div>
            </div>
          </div>
          <span class="card-purpose-badge" style="color: ${purposeObj.color}; border-color: ${purposeObj.color}50; background: ${purposeObj.color}20">
            ${purposeObj.name}
          </span>
        </div>

        <div class="card-balance-block">
          <span class="card-balance-label">Saldo Disponível Real</span>
          <div class="card-balance-val">
            ${formatCurrency(acc.balance)}
          </div>
        </div>

        <div class="card-actions-row">
          <button class="btn-action-pill" onclick="openAdjustBalanceModal('${acc.id}')" title="Ajustar saldo e registrar evolução">
            ⚖️ Ajustar Saldo
          </button>
          <div>
            <button class="btn-icon-sm" onclick="editAccount('${acc.id}')" title="Editar Conta">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </button>
            <button class="btn-icon-sm" onclick="deleteAccount('${acc.id}')" title="Excluir Conta">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  renderBalanceSnapshotsTable();
}

function getAccountTypeLabel(type) {
  switch (type) {
    case 'checking': return 'Conta Corrente';
    case 'savings': return 'Poupança / Reserva';
    case 'investment': return 'Conta de Investimentos';
    case 'cash': return 'Dinheiro em Espécie';
    default: return 'Conta';
  }
}

function openNewAccountModal() {
  document.getElementById('modalAccountTitle').textContent = 'Cadastrar Conta Bancária';
  document.getElementById('formAccount').reset();
  document.getElementById('accFormId').value = '';
  document.getElementById('accFormBalance').value = '0.00';
  
  handleBankPresetChange('Nubank');
  populatePurposeOptions('accFormPurpose');
  openModal('modalAccount');
}

function editAccount(accId) {
  const acc = appState.accounts.find(a => a.id === accId);
  if (!acc) return;

  document.getElementById('modalAccountTitle').textContent = 'Editar Conta Bancária';
  document.getElementById('accFormId').value = acc.id;
  document.getElementById('accFormName').value = acc.name;
  document.getElementById('accFormBankPreset').value = acc.bankPreset || 'Outro';
  document.getElementById('accFormType').value = acc.type || 'checking';
  document.getElementById('accFormColor').value = acc.color || '#820ad1';
  document.getElementById('accFormBalance').value = acc.balance || '0.00';

  populatePurposeOptions('accFormPurpose', acc.purpose);
  openModal('modalAccount');
}

function handleAccountFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('accFormId').value;
  const name = document.getElementById('accFormName').value.trim();
  const bankPreset = document.getElementById('accFormBankPreset').value;
  const type = document.getElementById('accFormType').value;
  const purpose = document.getElementById('accFormPurpose').value;
  const color = document.getElementById('accFormColor').value;
  const balance = parseFloat(document.getElementById('accFormBalance').value) || 0;

  if (id) {
    const acc = appState.accounts.find(a => a.id === id);
    if (acc) {
      acc.name = name;
      acc.bankPreset = bankPreset;
      acc.type = type;
      acc.purpose = purpose;
      acc.color = color;
      acc.balance = balance;
      showToast('Conta bancária atualizada com sucesso!', 'success');
    }
  } else {
    const newAcc = {
      id: 'acc_' + Date.now(),
      name,
      bankPreset,
      type,
      purpose,
      color,
      balance
    };
    appState.accounts.push(newAcc);

    // Initial snapshot real
    appState.balanceSnapshots.push({
      id: 'snap_' + Date.now(),
      date: new Date().toISOString(),
      accountId: newAcc.id,
      oldBalance: 0,
      newBalance: balance,
      diff: balance,
      reason: 'Saldo Inicial'
    });

    showToast('Conta bancária cadastrada com sucesso!', 'success');
  }

  saveLocalState();
  closeModal('modalAccount');
  renderApp();
}

function deleteAccount(accId) {
  const acc = appState.accounts.find(a => a.id === accId);
  if (!acc) return;

  if (confirm(`Tem certeza que deseja excluir a conta "${acc.name}"?`)) {
    appState.accounts = appState.accounts.filter(a => a.id !== accId);
    saveLocalState();
    renderApp();
    showToast('Conta excluída.', 'info');
  }
}

function handleBankPresetChange(preset) {
  const p = BANK_PRESETS[preset];
  if (p && p.color) {
    document.getElementById('accFormColor').value = p.color;
  }
}

// Adjust Balance Modal
function openAdjustBalanceModal(accId) {
  const acc = appState.accounts.find(a => a.id === accId);
  if (!acc) return;

  const currentVal = Number(acc.balance || 0);

  document.getElementById('adjustAccId').value = acc.id;
  document.getElementById('adjustAccNameDisplay').textContent = `${acc.name} (${getAccountTypeLabel(acc.type)})`;
  document.getElementById('adjustAccOldBalanceDisplay').textContent = formatCurrency(currentVal);
  document.getElementById('adjustNewBalance').value = currentVal.toFixed(2);
  document.getElementById('adjustDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('adjustReason').value = 'Conciliação mensal de saldo';

  openModal('modalAdjustBalance');
}

function handleAdjustBalanceSubmit(e) {
  e.preventDefault();
  const accId = document.getElementById('adjustAccId').value;
  const newBalance = parseFloat(document.getElementById('adjustNewBalance').value);
  const adjustDate = document.getElementById('adjustDate').value;
  const reason = document.getElementById('adjustReason').value.trim();

  const acc = appState.accounts.find(a => a.id === accId);
  if (!acc) return;

  const oldBalance = Number(acc.balance || 0);
  const diff = newBalance - oldBalance;
  acc.balance = newBalance;

  // Real snapshot
  appState.balanceSnapshots.push({
    id: 'snap_' + Date.now(),
    date: adjustDate ? new Date(adjustDate).toISOString() : new Date().toISOString(),
    accountId: acc.id,
    oldBalance,
    newBalance,
    diff,
    reason: reason || 'Ajuste manual'
  });

  saveLocalState();
  closeModal('modalAdjustBalance');
  renderApp();
  showToast('Saldo ajustado e registrado no histórico de evolução!', 'success');
}

function renderBalanceSnapshotsTable() {
  const tbody = document.getElementById('balanceSnapshotsBody');
  if (!tbody) return;

  if (appState.balanceSnapshots.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 20px;">Nenhum ajuste de saldo registrado ainda. Use o botão "Ajustar Saldo" nos cartões para conciliar e registrar a evolução.</td></tr>`;
    return;
  }

  const sorted = [...appState.balanceSnapshots].sort((a, b) => new Date(b.date) - new Date(a.date));

  tbody.innerHTML = sorted.map(snap => {
    const acc = appState.accounts.find(a => a.id === snap.accountId) || { name: 'Conta Excluída', purpose: 'casa' };
    const purposeObj = appState.purposes.find(p => p.id === acc.purpose) || { name: acc.purpose || 'PESSOAL', color: '#10b981' };
    const diff = Number(snap.diff || 0);

    return `
      <tr>
        <td>${formatDateBR(snap.date)}</td>
        <td><strong>${acc.name}</strong></td>
        <td>
          <span class="card-purpose-badge" style="color:${purposeObj.color}; border-color:${purposeObj.color}40; background:${purposeObj.color}15">
            ${purposeObj.name}
          </span>
        </td>
        <td>${formatCurrency(snap.oldBalance)}</td>
        <td><strong>${formatCurrency(snap.newBalance)}</strong></td>
        <td class="${diff >= 0 ? 'val-positive' : 'val-negative'}">
          ${diff >= 0 ? '+' : ''}${formatCurrency(diff)}
        </td>
        <td><small>${snap.reason || 'Conciliação manual'}</small></td>
      </tr>
    `;
  }).join('');
}

// =========================================================================
// VIEW: CARTÕES DE CRÉDITO (AMBIENTE DEDICADO)
// =========================================================================

function getFilteredCards() {
  if (globalSelectedPurpose === 'ALL') return appState.cards;
  return appState.cards.filter(c => c.purpose === globalSelectedPurpose);
}

function filterCardsByPurpose(purposeId) {
  globalSelectedPurpose = purposeId;
  const select = document.getElementById('globalPurposeFilter');
  if (select) select.value = purposeId;
  renderApp();
}

function renderCardsView() {
  const container = document.getElementById('creditCardsGrid');
  if (!container) return;

  const cards = getFilteredCards();

  let totalInvoice = 0;
  let totalLimit = 0;

  appState.cards.forEach(c => {
    totalInvoice += Number(c.invoice || 0);
    totalLimit += Number(c.limit || 0);
  });

  const totalAvailable = Math.max(0, totalLimit - totalInvoice);

  document.getElementById('cardsTotalInvoiceVal').textContent = formatCurrency(totalInvoice);
  document.getElementById('cardsTotalLimitVal').textContent = formatCurrency(totalLimit);
  document.getElementById('cardsTotalAvailableVal').textContent = formatCurrency(totalAvailable);

  if (cards.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; background: rgba(255,255,255,0.02); border-radius: var(--radius-lg); border: 1px dashed var(--border-subtle)">
        <p style="color: var(--text-muted); margin-bottom: 12px;">Nenhum cartão de crédito cadastrado.</p>
        <button class="btn-primary" onclick="openNewCreditCardModal()">+ Cadastrar Cartão de Crédito</button>
      </div>
    `;
    renderCardTransactionsTable([]);
    return;
  }

  container.innerHTML = cards.map(card => {
    const purposeObj = appState.purposes.find(p => p.id === card.purpose) || { name: card.purpose || 'PESSOAL', color: '#10b981' };
    const available = Math.max(0, Number(card.limit || 0) - Number(card.invoice || 0));
    const cardColor = card.color || '#820ad1';

    return `
      <div class="bank-card-item" style="border-top: 4px solid ${cardColor}">
        <div class="card-top-row">
          <div class="card-bank-badge">
            <div class="card-chip"></div>
            <div>
              <span class="card-bank-name">${card.name}</span>
              <div style="font-size: 0.72rem; color: var(--text-muted)">${card.bank} • Cartão de Crédito</div>
            </div>
          </div>
          <span class="card-purpose-badge" style="color: ${purposeObj.color}; border-color: ${purposeObj.color}50; background: ${purposeObj.color}20">
            ${purposeObj.name}
          </span>
        </div>

        <div class="card-balance-block">
          <span class="card-balance-label">Fatura Atual a Pagar</span>
          <div class="card-balance-val color-expense">
            -${formatCurrency(card.invoice)}
          </div>
        </div>

        <div class="card-credit-details">
          <span>Limite: <strong>${formatCurrency(card.limit)}</strong></span>
          <span>Disponível: <strong class="color-emerald">${formatCurrency(available)}</strong></span>
        </div>
        <div class="card-credit-details">
          <span>Fecha dia <strong>${card.closingDay || '--'}</strong></span>
          <span>Vence dia <strong>${card.dueDay || '--'}</strong></span>
        </div>

        <div class="card-actions-row">
          <div>
            <button class="btn-action-pill" onclick="openNewCardExpenseModal('${card.id}')" title="Lançar compra neste cartão">
              💳 + Despesa
            </button>
            <button class="btn-action-pill" onclick="openPayInvoiceModal('${card.id}')" title="Pagar e abater fatura">
              ✅ Pagar Fatura
            </button>
          </div>
          <div>
            <button class="btn-icon-sm" onclick="editCreditCard('${card.id}')" title="Editar Cartão">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </button>
            <button class="btn-icon-sm" onclick="deleteCreditCard('${card.id}')" title="Excluir Cartão">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Render credit card expenses
  const cardTxs = appState.transactions.filter(t => t.originType === 'card' || appState.cards.some(c => c.id === t.accountId));
  renderCardTransactionsTable(cardTxs);
}

function renderCardTransactionsTable(txs) {
  const tbody = document.getElementById('cardTransactionsTableBody');
  if (!tbody) return;

  if (txs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 20px;">Nenhuma despesa de cartão de crédito registrada ainda. Use o botão "+ Despesa no Cartão" para lançar.</td></tr>`;
    return;
  }

  const sorted = [...txs].sort((a, b) => new Date(b.date) - new Date(a.date));

  tbody.innerHTML = sorted.map(tx => {
    const card = appState.cards.find(c => c.id === (tx.cardId || tx.accountId)) || { name: 'Cartão' };
    const purposeObj = appState.purposes.find(p => p.id === tx.purpose) || { name: tx.purpose || 'PESSOAL', color: '#10b981' };
    const cat = appState.categories.find(c => c.id === tx.category) || { name: tx.category || 'Geral', icon: '🏷️' };
    const isCompleted = tx.status === 'completed';

    return `
      <tr>
        <td>${formatDateBR(tx.date)}</td>
        <td><strong>💳 ${card.name}</strong></td>
        <td>${tx.description}</td>
        <td>${cat.icon} ${cat.name}</td>
        <td>
          <span class="card-purpose-badge" style="color:${purposeObj.color}; border-color:${purposeObj.color}40; background:${purposeObj.color}15">
            ${purposeObj.name}
          </span>
        </td>
        <td class="color-expense"><strong>-${formatCurrency(tx.amount)}</strong></td>
        <td>
          <span class="status-badge ${isCompleted ? 'status-paid' : 'status-pending'}" onclick="toggleTxStatus('${tx.id}')">
            ${isCompleted ? '✓ Na Fatura' : '⏳ Pendente'}
          </span>
        </td>
        <td>
          <button class="btn-icon-sm" onclick="editTransaction('${tx.id}')" title="Editar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button class="btn-icon-sm" onclick="deleteTransaction('${tx.id}')" title="Excluir">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function openNewCreditCardModal() {
  document.getElementById('modalCreditCardTitle').textContent = 'Cadastrar Cartão de Crédito';
  document.getElementById('formCreditCard').reset();
  document.getElementById('cardFormId').value = '';
  document.getElementById('cardFormInvoice').value = '0.00';
  document.getElementById('cardFormClosing').value = '20';
  document.getElementById('cardFormDue').value = '1';

  populatePurposeOptions('cardFormPurpose');
  openModal('modalCreditCard');
}

function editCreditCard(cardId) {
  const card = appState.cards.find(c => c.id === cardId);
  if (!card) return;

  document.getElementById('modalCreditCardTitle').textContent = 'Editar Cartão de Crédito';
  document.getElementById('cardFormId').value = card.id;
  document.getElementById('cardFormName').value = card.name;
  document.getElementById('cardFormBank').value = card.bank || 'Outro';
  document.getElementById('cardFormLimit').value = card.limit || '';
  document.getElementById('cardFormInvoice').value = card.invoice || '0.00';
  document.getElementById('cardFormClosing').value = card.closingDay || '';
  document.getElementById('cardFormDue').value = card.dueDay || '';
  document.getElementById('cardFormColor').value = card.color || '#820ad1';

  populatePurposeOptions('cardFormPurpose', card.purpose);
  openModal('modalCreditCard');
}

function handleCreditCardFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('cardFormId').value;
  const name = document.getElementById('cardFormName').value.trim();
  const bank = document.getElementById('cardFormBank').value;
  const purpose = document.getElementById('cardFormPurpose').value;
  const limit = parseFloat(document.getElementById('cardFormLimit').value) || 0;
  const invoice = parseFloat(document.getElementById('cardFormInvoice').value) || 0;
  const closingDay = parseInt(document.getElementById('cardFormClosing').value) || 20;
  const dueDay = parseInt(document.getElementById('cardFormDue').value) || 1;
  const color = document.getElementById('cardFormColor').value;

  if (id) {
    const card = appState.cards.find(c => c.id === id);
    if (card) {
      card.name = name;
      card.bank = bank;
      card.purpose = purpose;
      card.limit = limit;
      card.invoice = invoice;
      card.closingDay = closingDay;
      card.dueDay = dueDay;
      card.color = color;
      showToast('Cartão de crédito atualizado com sucesso!', 'success');
    }
  } else {
    const newCard = {
      id: 'card_' + Date.now(),
      name,
      bank,
      purpose,
      limit,
      invoice,
      closingDay,
      dueDay,
      color
    };
    appState.cards.push(newCard);
    showToast('Cartão de crédito cadastrado com sucesso!', 'success');
  }

  saveLocalState();
  closeModal('modalCreditCard');
  renderApp();
}

function deleteCreditCard(cardId) {
  const card = appState.cards.find(c => c.id === cardId);
  if (!card) return;

  if (confirm(`Tem certeza que deseja excluir o cartão "${card.name}"?`)) {
    appState.cards = appState.cards.filter(c => c.id !== cardId);
    saveLocalState();
    renderApp();
    showToast('Cartão excluído.', 'info');
  }
}

function handleCardPresetChange(preset) {
  const p = BANK_PRESETS[preset];
  if (p && p.color) {
    document.getElementById('cardFormColor').value = p.color;
  }
}

// Pagar Fatura
function openPayInvoiceModal(preselectedCardId) {
  if (appState.cards.length === 0) {
    showToast('Cadastre um cartão de crédito primeiro.', 'info');
    return;
  }
  if (appState.accounts.length === 0) {
    showToast('Cadastre uma conta bancária primeiro para debitar o pagamento.', 'info');
    return;
  }

  const cardSelect = document.getElementById('payInvoiceCard');
  cardSelect.innerHTML = appState.cards.map(c => `
    <option value="${c.id}" ${preselectedCardId === c.id ? 'selected' : ''}>${c.name} (Fatura atual: ${formatCurrency(c.invoice)})</option>
  `).join('');

  const targetCardId = preselectedCardId || appState.cards[0].id;
  const targetCard = appState.cards.find(c => c.id === targetCardId);
  document.getElementById('payInvoiceAmount').value = targetCard ? targetCard.invoice : '0.00';

  const accSelect = document.getElementById('payInvoiceAccount');
  accSelect.innerHTML = appState.accounts.map(a => `
    <option value="${a.id}">${a.name} (Saldo: ${formatCurrency(a.balance)})</option>
  `).join('');

  document.getElementById('payInvoiceDate').value = new Date().toISOString().split('T')[0];
  openModal('modalPayInvoice');
}

function handlePayInvoiceCardChange(cardId) {
  const card = appState.cards.find(c => c.id === cardId);
  if (card) {
    document.getElementById('payInvoiceAmount').value = card.invoice;
  }
}

function handlePayInvoiceSubmit(e) {
  e.preventDefault();
  const cardId = document.getElementById('payInvoiceCard').value;
  const amount = parseFloat(document.getElementById('payInvoiceAmount').value) || 0;
  const accountId = document.getElementById('payInvoiceAccount').value;
  const payDate = document.getElementById('payInvoiceDate').value;

  const card = appState.cards.find(c => c.id === cardId);
  const acc = appState.accounts.find(a => a.id === accountId);

  if (!card || !acc) return;

  // Deduct from bank account
  acc.balance = (Number(acc.balance) || 0) - amount;

  // Abate credit card invoice
  card.invoice = Math.max(0, (Number(card.invoice) || 0) - amount);

  // Record payment transaction
  appState.transactions.push({
    id: 'tx_' + Date.now(),
    date: payDate ? new Date(payDate).toISOString() : new Date().toISOString(),
    type: 'expense',
    description: `Pagamento Fatura ${card.name}`,
    amount: amount,
    accountId: acc.id,
    originType: 'account',
    purpose: card.purpose || 'pessoal',
    category: 'contas',
    status: 'completed'
  });

  // Record snapshot for account
  appState.balanceSnapshots.push({
    id: 'snap_' + Date.now(),
    date: payDate ? new Date(payDate).toISOString() : new Date().toISOString(),
    accountId: acc.id,
    oldBalance: acc.balance + amount,
    newBalance: acc.balance,
    diff: -amount,
    reason: `Pagamento de fatura ${card.name}`
  });

  saveLocalState();
  closeModal('modalPayInvoice');
  renderApp();
  showToast(`Fatura do cartão ${card.name} paga com sucesso!`, 'success');
}

// Quick action: Nova Despesa no Cartão
function openNewCardExpenseModal(preselectedCardId) {
  openNewTransactionModal();
  handleTxTypeRadioChange('expense');
  handleOriginTypeRadioChange('card');
  if (preselectedCardId) {
    document.getElementById('txFormAccount').value = preselectedCardId;
    handleTxAccountChange(preselectedCardId);
  }
}

// =========================================================================
// VIEW: FIIS & INVESTIMENTOS (SIMPLIFICADO POR SALDO NO MOMENTO)
// =========================================================================

function renderFiisView() {
  const tbody = document.getElementById('fiisTableBody');
  if (!tbody) return;

  let totalCurrentVal = 0;
  let totalMonthlyDividends = 0;

  appState.fiis.forEach(fii => {
    totalCurrentVal += Number(fii.balance || 0);
    totalMonthlyDividends += Number(fii.monthlyDividend || 0);
  });

  const avgDY = totalCurrentVal > 0 ? (totalMonthlyDividends / totalCurrentVal) * 100 : 0;
  const annualDY = avgDY * 12;

  document.getElementById('fiiTotalCurrentVal').textContent = formatCurrency(totalCurrentVal);
  document.getElementById('fiiMonthlyDividends').textContent = formatCurrency(totalMonthlyDividends);
  document.getElementById('fiiAverageYield').textContent = `${avgDY.toFixed(2)}% a.m.`;
  document.getElementById('fiiAnnualizedYield').textContent = `~${annualDY.toFixed(2)}% ao ano`;
  document.getElementById('fiiTotalCountDisplay').textContent = `${appState.fiis.length} fundos`;

  if (appState.fiis.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; color: var(--text-dim); padding: 30px;">
          Nenhum FII cadastrado. Clique no botão "+ Cadastrar FII" acima para registrar seus fundos.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = appState.fiis.map(fii => {
    const bal = Number(fii.balance || 0);
    const div = Number(fii.monthlyDividend || 0);
    const dy = bal > 0 ? (div / bal) * 100 : 0;
    const purposeObj = appState.purposes.find(p => p.id === fii.purpose) || { name: fii.purpose || 'PESSOAL', color: '#10b981' };

    return `
      <tr>
        <td><strong>🏢 ${fii.ticker}</strong></td>
        <td><span class="type-pill" style="background: rgba(6, 182, 212, 0.15); color: #06b6d4">${fii.segment || 'Geral'}</span></td>
        <td><strong style="font-size: 1.05rem; color: #fff;">${formatCurrency(bal)}</strong></td>
        <td class="color-emerald"><strong>+${formatCurrency(div)}</strong></td>
        <td>
          <span class="card-purpose-badge" style="color: ${purposeObj.color}; border-color: ${purposeObj.color}40; background: ${purposeObj.color}15">
            ${purposeObj.name}
          </span>
        </td>
        <td><strong>${dy.toFixed(2)}% a.m.</strong></td>
        <td>
          <button class="btn-action-pill" onclick="openAdjustFiiModal('${fii.id}')" title="Ajustar Saldo Atual">
            ⚖️ Ajustar Saldo
          </button>
          <button class="btn-icon-sm" onclick="editFii('${fii.id}')" title="Editar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button class="btn-icon-sm" onclick="deleteFii('${fii.id}')" title="Excluir">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function openNewFiiModal() {
  document.getElementById('modalFiiTitle').textContent = 'Cadastrar Fundo Imobiliário (FII)';
  document.getElementById('formFii').reset();
  document.getElementById('fiiFormId').value = '';
  populatePurposeOptions('fiiFormPurpose');
  openModal('modalFii');
}

function editFii(fiiId) {
  const fii = appState.fiis.find(f => f.id === fiiId);
  if (!fii) return;

  document.getElementById('modalFiiTitle').textContent = 'Editar Fundo Imobiliário';
  document.getElementById('fiiFormId').value = fii.id;
  document.getElementById('fiiFormTicker').value = fii.ticker;
  document.getElementById('fiiFormBalance').value = fii.balance;
  document.getElementById('fiiFormLastDividend').value = fii.monthlyDividend || '';
  document.getElementById('fiiFormSegment').value = fii.segment || 'Geral';

  populatePurposeOptions('fiiFormPurpose', fii.purpose);
  openModal('modalFii');
}

function handleFiiFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('fiiFormId').value;
  const ticker = document.getElementById('fiiFormTicker').value.trim().toUpperCase();
  const balance = parseFloat(document.getElementById('fiiFormBalance').value) || 0;
  const monthlyDividend = parseFloat(document.getElementById('fiiFormLastDividend').value) || 0;
  const segment = document.getElementById('fiiFormSegment').value;
  const purpose = document.getElementById('fiiFormPurpose').value;

  if (id) {
    const fii = appState.fiis.find(f => f.id === id);
    if (fii) {
      fii.ticker = ticker;
      fii.balance = balance;
      fii.monthlyDividend = monthlyDividend;
      fii.segment = segment;
      fii.purpose = purpose;
      showToast('FII atualizado com sucesso!', 'success');
    }
  } else {
    const newFii = {
      id: 'fii_' + Date.now(),
      ticker,
      balance,
      monthlyDividend,
      segment,
      purpose
    };
    appState.fiis.push(newFii);

    // Snapshot inicial real do FII
    appState.balanceSnapshots.push({
      id: 'snap_' + Date.now(),
      date: new Date().toISOString(),
      fiiId: newFii.id,
      oldBalance: 0,
      newBalance: balance,
      diff: balance,
      reason: `Saldo Inicial FII ${ticker}`
    });

    showToast(`FII ${ticker} cadastrado com sucesso!`, 'success');
  }

  saveLocalState();
  closeModal('modalFii');
  renderApp();
}

function openAdjustFiiModal(fiiId) {
  const fii = appState.fiis.find(f => f.id === fiiId);
  if (!fii) return;

  document.getElementById('adjustFiiId').value = fii.id;
  document.getElementById('adjustFiiNameDisplay').textContent = `${fii.ticker} (${fii.segment || 'FII'})`;
  document.getElementById('adjustFiiOldBalanceDisplay').textContent = formatCurrency(fii.balance);
  document.getElementById('adjustFiiNewBalance').value = fii.balance.toFixed(2);
  document.getElementById('adjustFiiDate').value = new Date().toISOString().split('T')[0];

  openModal('modalAdjustFii');
}

function handleAdjustFiiSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('adjustFiiId').value;
  const newBalance = parseFloat(document.getElementById('adjustFiiNewBalance').value) || 0;
  const adjustDate = document.getElementById('adjustFiiDate').value;

  const fii = appState.fiis.find(f => f.id === id);
  if (fii) {
    const oldBalance = Number(fii.balance || 0);
    fii.balance = newBalance;

    // Snapshot de ajuste real do FII
    appState.balanceSnapshots.push({
      id: 'snap_' + Date.now(),
      date: adjustDate ? new Date(adjustDate + 'T12:00:00').toISOString() : new Date().toISOString(),
      fiiId: fii.id,
      oldBalance: oldBalance,
      newBalance: newBalance,
      diff: newBalance - oldBalance,
      reason: `Ajuste Saldo FII ${fii.ticker}`
    });

    showToast(`Saldo do FII ${fii.ticker} atualizado!`, 'success');
    saveLocalState();
    closeModal('modalAdjustFii');
    renderApp();
  }
}

function deleteFii(fiiId) {
  const fii = appState.fiis.find(f => f.id === fiiId);
  if (!fii) return;

  if (confirm(`Deseja remover o FII ${fii.ticker}?`)) {
    appState.fiis = appState.fiis.filter(f => f.id !== fiiId);
    saveLocalState();
    renderApp();
    showToast('FII removido.', 'info');
  }
}

function handleFiiSearch(query) {
  const q = query.toLowerCase();
  const rows = document.querySelectorAll('#fiisTableBody tr');
  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    r.style.display = text.includes(q) ? '' : 'none';
  });
}

// =========================================================================
// VIEW: LANÇAMENTOS (TRANSAÇÕES COM ORIGEM ESPECÍFICA)
// =========================================================================

function renderTransactionsView() {
  populateTxFilterOptions();
  applyTransactionFilters();
}

function populateTxFilterOptions() {
  const accSelect = document.getElementById('txAccountFilter');
  if (accSelect) {
    let html = '<option value="ALL">Todas as Origens</option>';
    html += '<optgroup label="Contas Bancárias">';
    appState.accounts.forEach(a => {
      html += `<option value="acc_${a.id}">🏦 ${a.name}</option>`;
    });
    html += '</optgroup>';
    html += '<optgroup label="Cartões de Crédito">';
    appState.cards.forEach(c => {
      html += `<option value="card_${c.id}">💳 ${c.name}</option>`;
    });
    html += '</optgroup>';
    accSelect.innerHTML = html;
  }

  const purpSelect = document.getElementById('txPurposeFilter');
  if (purpSelect) {
    purpSelect.innerHTML = '<option value="ALL">Todas as Finalidades</option>' + appState.purposes.map(p => `
      <option value="${p.id}">${p.name}</option>
    `).join('');
  }
}

function applyTransactionFilters() {
  const tbody = document.getElementById('transactionsTableBody');
  const emptyState = document.getElementById('emptyTransactionsState');
  if (!tbody) return;

  const searchText = (document.getElementById('txSearchInput')?.value || '').toLowerCase();
  const typeFilter = document.getElementById('txTypeFilter')?.value || 'ALL';
  const originFilter = document.getElementById('txAccountFilter')?.value || 'ALL';
  const purpFilter = document.getElementById('txPurposeFilter')?.value || 'ALL';
  const statusFilter = document.getElementById('txStatusFilter')?.value || 'ALL';

  const currentYear = appState.settings.currentYear;
  const currentMonth = appState.settings.currentMonth;

  const filtered = appState.transactions.filter(tx => {
    const txDate = new Date(tx.date);
    const matchesMonth = txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth;
    if (!matchesMonth) return false;

    if (searchText && !tx.description.toLowerCase().includes(searchText)) return false;
    if (typeFilter !== 'ALL' && tx.type !== typeFilter) return false;
    
    if (originFilter !== 'ALL') {
      if (originFilter.startsWith('acc_')) {
        const accId = originFilter.replace('acc_', '');
        if (tx.accountId !== accId || tx.originType === 'card') return false;
      } else if (originFilter.startsWith('card_')) {
        const cardId = originFilter.replace('card_', '');
        if (tx.cardId !== cardId && tx.accountId !== cardId) return false;
      }
    }

    if (purpFilter !== 'ALL' && tx.purpose !== purpFilter) return false;
    if (statusFilter !== 'ALL' && tx.status !== statusFilter) return false;

    return true;
  });

  let filteredIncome = 0;
  let filteredExpense = 0;
  filtered.forEach(tx => {
    if (tx.type === 'income') filteredIncome += Number(tx.amount || 0);
    if (tx.type === 'expense') filteredExpense += Number(tx.amount || 0);
  });
  const filteredNet = filteredIncome - filteredExpense;

  document.getElementById('filteredIncomeTotal').textContent = formatCurrency(filteredIncome);
  document.getElementById('filteredExpenseTotal').textContent = formatCurrency(filteredExpense);
  const netEl = document.getElementById('filteredNetTotal');
  netEl.textContent = formatCurrency(filteredNet);
  netEl.className = filteredNet >= 0 ? 'color-income' : 'color-expense';

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  const sorted = [...filtered].sort((a, b) => new Date(b.date) - new Date(a.date));

  tbody.innerHTML = sorted.map(tx => {
    const originLabel = getTxOriginLabel(tx);
    const purposeObj = appState.purposes.find(p => p.id === tx.purpose) || { name: tx.purpose || 'PESSOAL', color: '#10b981' };
    const cat = appState.categories.find(c => c.id === tx.category) || { name: tx.category || 'Geral', icon: '🏷️' };
    const isIncome = tx.type === 'income';
    const isCompleted = tx.status === 'completed';

    return `
      <tr>
        <td>${formatDateBR(tx.date)}</td>
        <td>
          <span class="type-pill type-${tx.type}">
            ${tx.type === 'income' ? 'Receita' : tx.type === 'expense' ? 'Despesa' : 'Transf.'}
          </span>
        </td>
        <td><strong>${tx.description}</strong></td>
        <td>${originLabel}</td>
        <td>
          <span class="card-purpose-badge" style="color:${purposeObj.color}; border-color:${purposeObj.color}40; background:${purposeObj.color}15">
            ${purposeObj.name}
          </span>
        </td>
        <td>${cat.icon} ${cat.name}</td>
        <td class="${isIncome ? 'val-positive' : 'val-negative'}">
          ${isIncome ? '+' : '-'}${formatCurrency(tx.amount)}
        </td>
        <td>
          <span class="status-badge ${isCompleted ? 'status-paid' : 'status-pending'}" onclick="toggleTxStatus('${tx.id}')">
            ${isCompleted ? '✓ Concluído' : '⏳ Pendente'}
          </span>
        </td>
        <td>
          <button class="btn-icon-sm" onclick="editTransaction('${tx.id}')" title="Editar">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button class="btn-icon-sm" onclick="deleteTransaction('${tx.id}')" title="Excluir">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function openNewTransactionModal() {
  document.getElementById('modalTransactionTitle').textContent = 'Novo Lançamento';
  document.getElementById('formTransaction').reset();
  document.getElementById('txFormId').value = '';
  document.getElementById('txFormDate').value = new Date().toISOString().split('T')[0];
  
  handleTxTypeRadioChange('expense');
  handleOriginTypeRadioChange('account');
  populatePurposeOptions('txFormPurpose');
  populateCategoryOptionsInTxModal('expense');

  openModal('modalTransaction');
}

function handleTxTypeRadioChange(type) {
  document.querySelectorAll('.type-tab-btn').forEach(btn => btn.classList.remove('active'));
  const activeTab = document.getElementById(`tabType${type.charAt(0).toUpperCase() + type.slice(1)}`);
  if (activeTab) activeTab.classList.add('active');

  const isTransfer = type === 'transfer';
  const isIncome = type === 'income';

  document.getElementById('txDestinationGroup').classList.toggle('hidden', !isTransfer);
  document.getElementById('txCategoryGroup').classList.toggle('hidden', isTransfer);
  document.getElementById('txOriginTypeContainer').classList.toggle('hidden', isTransfer || isIncome);

  if (isIncome || isTransfer) {
    handleOriginTypeRadioChange('account');
  }

  populateCategoryOptionsInTxModal(type);
}

function handleOriginTypeRadioChange(originType) {
  document.getElementById('tabOriginAccount').classList.toggle('active', originType === 'account');
  document.getElementById('tabOriginCard').classList.toggle('active', originType === 'card');

  const select = document.getElementById('txFormAccount');
  const label = document.getElementById('txAccountLabel');

  if (originType === 'card') {
    label.textContent = 'Qual Cartão de Crédito? *';
    select.innerHTML = appState.cards.map(c => `
      <option value="${c.id}">💳 ${c.name} (Fatura: ${formatCurrency(c.invoice)})</option>
    `).join('') || '<option value="">Nenhum cartão cadastrado</option>';
  } else {
    label.textContent = 'Qual Conta Bancária / Dinheiro? *';
    select.innerHTML = appState.accounts.map(a => `
      <option value="${a.id}">🏦 ${a.name} (Saldo: ${formatCurrency(a.balance)})</option>
    `).join('') || '<option value="">Nenhuma conta cadastrada</option>';
  }

  if (select.value) {
    handleTxAccountChange(select.value);
  }
}

function handleTxAccountChange(id) {
  const originType = document.querySelector('input[name="txOriginType"]:checked')?.value || 'account';
  if (originType === 'card') {
    const card = appState.cards.find(c => c.id === id);
    if (card && card.purpose) document.getElementById('txFormPurpose').value = card.purpose;
  } else {
    const acc = appState.accounts.find(a => a.id === id);
    if (acc && acc.purpose) document.getElementById('txFormPurpose').value = acc.purpose;
  }
}

function populateCategoryOptionsInTxModal(type, selectedCatId) {
  const select = document.getElementById('txFormCategory');
  if (!select) return;

  const filteredCats = appState.categories.filter(c => type === 'transfer' ? true : c.type === type);
  select.innerHTML = filteredCats.map(c => `
    <option value="${c.id}" ${selectedCatId === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>
  `).join('');
}

function handleTransactionSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('txFormId').value;
  const desc = document.getElementById('txFormDesc').value.trim();
  const amount = parseFloat(document.getElementById('txFormAmount').value) || 0;
  const date = document.getElementById('txFormDate').value;
  const accountId = document.getElementById('txFormAccount').value;
  const destinationAccountId = document.getElementById('txFormDestination').value;
  const purpose = document.getElementById('txFormPurpose').value;
  const category = document.getElementById('txFormCategory').value;
  const status = document.getElementById('txFormStatus').value;

  const type = document.querySelector('input[name="txType"]:checked')?.value || 'expense';
  const originType = (type === 'income' || type === 'transfer') ? 'account' : (document.querySelector('input[name="txOriginType"]:checked')?.value || 'account');

  if (!accountId) {
    showToast('Selecione uma conta ou cartão.', 'error');
    return;
  }

  if (id) {
    const tx = appState.transactions.find(t => t.id === id);
    if (tx) {
      adjustBalanceForTx(tx, true);

      tx.description = desc;
      tx.amount = amount;
      tx.date = date ? new Date(date).toISOString() : new Date().toISOString();
      tx.accountId = accountId;
      tx.originType = originType;
      tx.cardId = originType === 'card' ? accountId : null;
      tx.destinationAccountId = destinationAccountId;
      tx.purpose = purpose;
      tx.category = category;
      tx.status = status;
      tx.type = type;

      adjustBalanceForTx(tx, false);
      showToast('Lançamento atualizado!', 'success');
    }
  } else {
    const newTx = {
      id: 'tx_' + Date.now(),
      description: desc,
      amount,
      date: date ? new Date(date).toISOString() : new Date().toISOString(),
      accountId,
      originType,
      cardId: originType === 'card' ? accountId : null,
      destinationAccountId,
      purpose,
      category,
      status,
      type
    };

    appState.transactions.push(newTx);
    adjustBalanceForTx(newTx, false);
    showToast('Lançamento registrado com sucesso!', 'success');
  }

  saveLocalState();
  closeModal('modalTransaction');
  renderApp();
}

function adjustBalanceForTx(tx, isRevert = false) {
  if (tx.status !== 'completed') return;
  const multiplier = isRevert ? -1 : 1;

  if (tx.originType === 'card' || tx.cardId) {
    const card = appState.cards.find(c => c.id === (tx.cardId || tx.accountId));
    if (card) {
      card.invoice = (Number(card.invoice) || 0) + (tx.amount * multiplier);
    }
  } else {
    const acc = appState.accounts.find(a => a.id === tx.accountId);
    if (!acc) return;

    if (tx.type === 'expense') {
      acc.balance = (Number(acc.balance) || 0) - (tx.amount * multiplier);
    } else if (tx.type === 'income') {
      acc.balance = (Number(acc.balance) || 0) + (tx.amount * multiplier);
    } else if (tx.type === 'transfer') {
      const destAcc = appState.accounts.find(a => a.id === tx.destinationAccountId);
      acc.balance = (Number(acc.balance) || 0) - (tx.amount * multiplier);
      if (destAcc) {
        destAcc.balance = (Number(destAcc.balance) || 0) + (tx.amount * multiplier);
      }
    }
  }
}

function toggleTxStatus(txId) {
  const tx = appState.transactions.find(t => t.id === txId);
  if (!tx) return;

  const wasCompleted = tx.status === 'completed';
  adjustBalanceForTx(tx, true);
  tx.status = wasCompleted ? 'pending' : 'completed';
  adjustBalanceForTx(tx, false);

  saveLocalState();
  renderApp();
  showToast(`Situação alterada para ${tx.status === 'completed' ? 'Concluído' : 'Pendente'}`, 'info');
}

function editTransaction(txId) {
  const tx = appState.transactions.find(t => t.id === txId);
  if (!tx) return;

  document.getElementById('modalTransactionTitle').textContent = 'Editar Lançamento';
  document.getElementById('txFormId').value = tx.id;
  document.getElementById('txFormDesc').value = tx.description;
  document.getElementById('txFormAmount').value = tx.amount;
  document.getElementById('txFormDate').value = tx.date ? tx.date.split('T')[0] : '';
  document.getElementById('txFormStatus').value = tx.status || 'completed';

  handleTxTypeRadioChange(tx.type);
  const origin = tx.originType || (tx.cardId ? 'card' : 'account');
  handleOriginTypeRadioChange(origin);

  const accSelect = document.getElementById('txFormAccount');
  if (accSelect) accSelect.value = tx.cardId || tx.accountId;

  populatePurposeOptions('txFormPurpose', tx.purpose);
  populateCategoryOptionsInTxModal(tx.type, tx.category);

  openModal('modalTransaction');
}

function deleteTransaction(txId) {
  const tx = appState.transactions.find(t => t.id === txId);
  if (!tx) return;

  if (confirm(`Deseja excluir o lançamento "${tx.description}"?`)) {
    adjustBalanceForTx(tx, true);
    appState.transactions = appState.transactions.filter(t => t.id !== txId);
    saveLocalState();
    renderApp();
    showToast('Lançamento excluído.', 'info');
  }
}

// =========================================================================
// PURPOSES (CASA / PESSOAL / DEFINIÇÕES CUSTOMIZADAS)
// =========================================================================

function renderPurposeSelectors() {
  const select = document.getElementById('globalPurposeFilter');
  if (!select) return;

  const currentValue = globalSelectedPurpose;
  select.innerHTML = `
    <option value="ALL" ${currentValue === 'ALL' ? 'selected' : ''}>🏠 Todas as Finalidades</option>
    ${appState.purposes.map(p => `
      <option value="${p.id}" ${currentValue === p.id ? 'selected' : ''}>
        ${p.id === 'casa' ? '🏡' : p.id === 'pessoal' ? '👤' : '🏷️'} ${p.name}
      </option>
    `).join('')}
  `;

  const accRow = document.getElementById('accountPurposeFilterRow');
  if (accRow) {
    accRow.innerHTML = `
      <button class="pill-filter-btn ${globalSelectedPurpose === 'ALL' ? 'active' : ''}" onclick="filterAccountsByPurpose('ALL')">Todas as Contas</button>
      ${appState.purposes.map(p => `
        <button class="pill-filter-btn ${globalSelectedPurpose === p.id ? 'active' : ''}" onclick="filterAccountsByPurpose('${p.id}')">
          ${p.name}
        </button>
      `).join('')}
    `;
  }
}

function filterAccountsByPurpose(purposeId) {
  globalSelectedPurpose = purposeId;
  const select = document.getElementById('globalPurposeFilter');
  if (select) select.value = purposeId;
  renderApp();
}

function populatePurposeOptions(selectId, selectedId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = appState.purposes.map(p => `
    <option value="${p.id}" ${selectedId === p.id ? 'selected' : ''}>${p.name}</option>
  `).join('');
}

function renderPurposesSettings() {
  const grid = document.getElementById('purposesListGrid');
  const manageList = document.getElementById('purposesManageList');
  if (!grid) return;

  const content = appState.purposes.map(p => `
    <div class="purpose-item-card">
      <div class="purpose-item-left">
        <span class="purpose-color-badge" style="background: ${p.color}"></span>
        <div>
          <span class="purpose-name">${p.name}</span>
          <div style="font-size: 0.72rem; color: var(--text-dim)">${p.description || 'Finalidade de conta/cartão'}</div>
        </div>
      </div>
      <div>
        ${!p.isDefault ? `
          <button class="btn-icon-tiny" onclick="deletePurpose('${p.id}')" title="Excluir Definição">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
          </button>
        ` : '<span style="font-size: 0.65rem; color: var(--text-dim); text-transform: uppercase;">Padrão</span>'}
      </div>
    </div>
  `).join('');

  grid.innerHTML = content;
  if (manageList) manageList.innerHTML = content;
}

function openPurposeManagerModal() {
  renderPurposesSettings();
  openModal('modalPurposes');
}

function openNewPurposeModal() {
  openPurposeManagerModal();
  document.getElementById('newPurposeName').focus();
}

function handleNewPurposeSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('newPurposeName').value.trim().toUpperCase();
  const color = document.getElementById('newPurposeColor').value;
  if (!name) return;

  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (appState.purposes.find(p => p.id === id)) {
    showToast('Já existe uma finalidade com este nome.', 'error');
    return;
  }

  appState.purposes.push({
    id,
    name,
    color,
    isDefault: false,
    description: `Definição customizada ${name}`
  });

  saveLocalState();
  document.getElementById('formNewPurpose').reset();
  renderApp();
  renderPurposesSettings();
  showToast(`Nova finalidade "${name}" criada!`, 'success');
}

function deletePurpose(purposeId) {
  if (confirm('Deseja excluir esta definição de finalidade?')) {
    appState.purposes = appState.purposes.filter(p => p.id !== purposeId);
    saveLocalState();
    renderApp();
    showToast('Finalidade excluída.', 'info');
  }
}

// =========================================================================
// CHARTS & HISTÓRICO 100% REAIS (SEM NENHUM DADO FICTÍCIO)
// =========================================================================

function destroyChart(name) {
  if (chartsInstances[name]) {
    chartsInstances[name].destroy();
    delete chartsInstances[name];
  }
}

function renderCharts() {
  if (typeof Chart === 'undefined') return;

  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";

  renderRealNetWorthEvolutionChart('chartNetWorthEvolution', 'netWorth');
  renderRealNetWorthEvolutionChart('chartNetWorthEvolutionSecond', 'netWorthSecond');
  renderRealCategoryDonutChart();
  renderRealPurposeComparisonChart();
  renderRealFiiAllocationCharts();
  renderRealAccountsEvolutionMultiChart();
  renderRealIncomeVsExpenseMonthlyChart();
}

/**
 * Helper: Calcula o Patrimônio Líquido Real Consolidado em um determinado timestamp histórico
 */
function getConsolidatedNetWorthAtTimestamp(timestamp) {
  let totalAccounts = 0;
  let totalFiis = 0;

  // Saldos das contas até o momento do timestamp
  appState.accounts.forEach(acc => {
    const accSnaps = (appState.balanceSnapshots || [])
      .filter(s => s.accountId === acc.id && new Date(s.date).getTime() <= timestamp)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (accSnaps.length > 0) {
      totalAccounts += Number(accSnaps[accSnaps.length - 1].newBalance || 0);
    }
  });

  // Saldos dos FIIs até o momento do timestamp
  appState.fiis.forEach(fii => {
    const fiiSnaps = (appState.balanceSnapshots || [])
      .filter(s => s.fiiId === fii.id && new Date(s.date).getTime() <= timestamp)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    if (fiiSnaps.length > 0) {
      totalFiis += Number(fiiSnaps[fiiSnaps.length - 1].newBalance || 0);
    }
  });

  // Faturas de cartões deduzem do patrimônio líquido
  let totalInvoices = 0;
  appState.cards.forEach(c => {
    totalInvoices += Number(c.invoice || 0);
  });

  return totalAccounts + totalFiis - totalInvoices;
}

/**
 * Gráfico 1: Evolução Patrimonial 100% Real
 * Baseado estritamente nos snapshots e saldo atual cadastrado
 */
function renderRealNetWorthEvolutionChart(canvasId, instanceKey) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  destroyChart(instanceKey);

  const currentNetWorth = calculateConsolidatedNetWorth();
  let labels = [];
  let values = [];

  const validSnaps = (appState.balanceSnapshots || []).filter(s => s && s.date);

  if (validSnaps.length > 0) {
    // Agrupa datas únicas cronologicamente
    const dateMap = new Map();
    validSnaps.forEach(s => {
      const dStr = formatDateBR(s.date);
      const time = new Date(s.date).getTime();
      if (!dateMap.has(dStr) || dateMap.get(dStr).time < time) {
        dateMap.set(dStr, { str: dStr, time: time });
      }
    });

    const todayStr = formatDateBR(new Date().toISOString());
    if (!dateMap.has(todayStr)) {
      dateMap.set(todayStr, { str: todayStr, time: Date.now() });
    }

    const sortedDates = Array.from(dateMap.values()).sort((a, b) => a.time - b.time);

    if (sortedDates.length === 1) {
      // Se acabou de cadastrar o saldo inicial hoje
      labels = ['Saldo Inicial Cadastrado', 'Posição Atual'];
      values = [currentNetWorth, currentNetWorth];
    } else {
      labels = sortedDates.map(d => d.str === todayStr ? `${d.str} (Atual)` : d.str);
      values = sortedDates.map((d, idx) => {
        if (idx === sortedDates.length - 1 && d.str === todayStr) {
          return currentNetWorth;
        }
        return getConsolidatedNetWorthAtTimestamp(d.time);
      });
    }
  } else {
    if (currentNetWorth !== 0) {
      labels = ['Saldo Inicial Cadastrado', 'Posição Atual'];
      values = [currentNetWorth, currentNetWorth];
    } else {
      labels = ['Cadastre suas contas'];
      values = [0];
    }
  }

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(99, 102, 241, 0.4)');
  gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

  chartsInstances[instanceKey] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Patrimônio Líquido Real',
        data: values,
        borderColor: '#6366f1',
        backgroundColor: gradient,
        borderWidth: 3,
        fill: true,
        tension: 0.2,
        pointBackgroundColor: '#8b5cf6',
        pointBorderColor: '#ffffff',
        pointRadius: 6,
        pointHoverRadius: 9
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Patrimônio Real: ${formatCurrency(ctx.raw)}`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            callback: (v) => 'R$ ' + v.toLocaleString('pt-BR')
          }
        }
      }
    }
  });
}

/**
 * Gráfico 2: Despesas por Categoria (100% Real do mês)
 */
function renderRealCategoryDonutChart() {
  const canvas = document.getElementById('chartCategoryDonut');
  if (!canvas) return;
  destroyChart('categoryDonut');

  const currentMonth = appState.settings.currentMonth;
  const currentYear = appState.settings.currentYear;
  const catTotals = {};

  appState.transactions.forEach(tx => {
    const txDate = new Date(tx.date);
    if (txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth && tx.type === 'expense') {
      const cat = appState.categories.find(c => c.id === tx.category) || { name: 'Outros', color: '#94a3b8' };
      catTotals[cat.name] = (catTotals[cat.name] || 0) + Number(tx.amount || 0);
    }
  });

  const labels = Object.keys(catTotals);
  const data = Object.values(catTotals);
  const palette = ['#6366f1', '#f59e0b', '#06b6d4', '#ec4899', '#ef4444', '#8b5cf6', '#10b981', '#64748b'];

  const legendContainer = document.getElementById('categoryLegendContainer');
  if (legendContainer) {
    if (labels.length === 0) {
      legendContainer.innerHTML = '<span style="font-size:0.8rem; color:var(--text-dim);">Nenhuma despesa lançada neste mês.</span>';
    } else {
      legendContainer.innerHTML = labels.map((l, i) => `
        <div class="legend-item">
          <span class="legend-color-dot" style="background: ${palette[i % palette.length]}"></span>
          <span>${l}: <strong>${formatCurrency(data[i])}</strong></span>
        </div>
      `).join('');
    }
  }

  chartsInstances['categoryDonut'] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: labels.length ? labels : ['Sem despesas'],
      datasets: [{
        data: data.length ? data : [1],
        backgroundColor: data.length ? palette.slice(0, data.length) : ['#334155'],
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw)}`
          }
        }
      },
      cutout: '70%'
    }
  });
}

/**
 * Gráfico 3: Gastos CASA vs PESSOAL (100% Real do mês)
 */
function renderRealPurposeComparisonChart() {
  const canvas = document.getElementById('chartPurposeComparison');
  if (!canvas) return;
  destroyChart('purposeComparison');

  const currentMonth = appState.settings.currentMonth;
  const currentYear = appState.settings.currentYear;
  const purposeTotals = {};

  appState.purposes.forEach(p => { purposeTotals[p.id] = 0; });

  appState.transactions.forEach(tx => {
    const txDate = new Date(tx.date);
    if (txDate.getFullYear() === currentYear && txDate.getMonth() === currentMonth && tx.type === 'expense') {
      const pId = tx.purpose || 'pessoal';
      purposeTotals[pId] = (purposeTotals[pId] || 0) + Number(tx.amount || 0);
    }
  });

  const labels = appState.purposes.map(p => p.name);
  const data = appState.purposes.map(p => purposeTotals[p.id] || 0);
  const colors = appState.purposes.map(p => p.color || '#6366f1');

  chartsInstances['purposeComparison'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Despesas Reais no Mês',
        data,
        backgroundColor: colors,
        borderRadius: 8,
        barThickness: 36
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Gasto Real: ${formatCurrency(ctx.raw)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { callback: (v) => 'R$ ' + v.toLocaleString('pt-BR') }
        }
      }
    }
  });
}

/**
 * Gráfico 4: FIIs Allocation (100% Real)
 */
function renderRealFiiAllocationCharts() {
  const allocCanvas = document.getElementById('chartFiiAllocation');
  const segCanvas = document.getElementById('chartFiiSegment');
  if (!allocCanvas || !segCanvas) return;

  destroyChart('fiiAlloc');
  destroyChart('fiiSeg');

  const fiiLabels = appState.fiis.map(f => f.ticker);
  const fiiData = appState.fiis.map(f => Number(f.balance || 0));

  const segTotals = {};
  appState.fiis.forEach(f => {
    const seg = f.segment || 'Geral';
    segTotals[seg] = (segTotals[seg] || 0) + Number(f.balance || 0);
  });

  const palette = ['#06b6d4', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899'];

  chartsInstances['fiiAlloc'] = new Chart(allocCanvas, {
    type: 'doughnut',
    data: {
      labels: fiiLabels.length ? fiiLabels : ['Sem FIIs'],
      datasets: [{
        data: fiiData.length ? fiiData : [1],
        backgroundColor: fiiData.length ? palette.slice(0, fiiData.length) : ['#334155'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw)}` }
        }
      },
      cutout: '65%'
    }
  });

  chartsInstances['fiiSeg'] = new Chart(segCanvas, {
    type: 'doughnut',
    data: {
      labels: Object.keys(segTotals).length ? Object.keys(segTotals) : ['Sem dados'],
      datasets: [{
        data: Object.values(segTotals).length ? Object.values(segTotals) : [1],
        backgroundColor: palette.slice(0, Object.keys(segTotals).length),
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw)}` }
        }
      },
      cutout: '65%'
    }
  });
}

/**
 * Gráfico 5: Evolução das Contas Bancárias (100% Real)
 */
function renderRealAccountsEvolutionMultiChart() {
  const canvas = document.getElementById('chartAccountsEvolutionMulti');
  if (!canvas) return;
  destroyChart('accountsEvolution');

  if (appState.accounts.length === 0) return;

  const validSnaps = (appState.balanceSnapshots || []).filter(s => s && s.accountId && s.date);
  const dateMap = new Map();
  validSnaps.forEach(s => {
    const dStr = formatDateBR(s.date);
    const time = new Date(s.date).getTime();
    if (!dateMap.has(dStr) || dateMap.get(dStr).time < time) {
      dateMap.set(dStr, { str: dStr, time: time });
    }
  });

  const todayStr = formatDateBR(new Date().toISOString());
  if (!dateMap.has(todayStr)) {
    dateMap.set(todayStr, { str: todayStr, time: Date.now() });
  }

  const sortedDates = Array.from(dateMap.values()).sort((a, b) => a.time - b.time);

  let labels = [];
  let datasets = [];

  if (sortedDates.length <= 1) {
    labels = ['Saldo Inicial', 'Posição Atual'];
    datasets = appState.accounts.map(acc => {
      const b = Number(acc.balance || 0);
      return {
        label: acc.name,
        borderColor: acc.color || '#6366f1',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 6,
        data: [b, b]
      };
    });
  } else {
    labels = sortedDates.map(d => d.str === todayStr ? `${d.str} (Atual)` : d.str);
    datasets = appState.accounts.map(acc => {
      const dataPoints = sortedDates.map((d, idx) => {
        if (idx === sortedDates.length - 1 && d.str === todayStr) {
          return Number(acc.balance || 0);
        }
        const snaps = (appState.balanceSnapshots || [])
          .filter(s => s.accountId === acc.id && new Date(s.date).getTime() <= d.time)
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        return snaps.length > 0 ? Number(snaps[snaps.length - 1].newBalance || 0) : 0;
      });

      return {
        label: acc.name,
        borderColor: acc.color || '#6366f1',
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 5,
        data: dataPoints
      };
    });
  }

  chartsInstances['accountsEvolution'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { callback: (v) => 'R$ ' + v.toLocaleString('pt-BR') }
        }
      }
    }
  });
}

/**
 * Gráfico 6: Receitas vs Despesas (100% Real - Zero dados fictícios)
 */
function renderRealIncomeVsExpenseMonthlyChart() {
  const canvas = document.getElementById('chartIncomeVsExpenseMonthly');
  if (!canvas) return;
  destroyChart('incomeVsExpense');

  const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const currentMonth = appState.settings.currentMonth;
  const currentYear = appState.settings.currentYear;

  // Let's take the last 6 months strictly
  const months = [];
  const incomes = [];
  const expenses = [];

  for (let i = 5; i >= 0; i--) {
    let m = currentMonth - i;
    let y = currentYear;
    if (m < 0) {
      m += 12;
      y -= 1;
    }
    const label = `${monthNames[m]}/${y.toString().slice(-2)}`;
    months.push(label);

    // Sum real transactions for this specific month
    let inc = 0;
    let exp = 0;

    appState.transactions.forEach(tx => {
      const txDate = new Date(tx.date);
      if (txDate.getFullYear() === y && txDate.getMonth() === m && tx.status === 'completed') {
        if (tx.type === 'income') inc += Number(tx.amount || 0);
        if (tx.type === 'expense') exp += Number(tx.amount || 0);
      }
    });

    incomes.push(inc);
    expenses.push(exp);
  }

  chartsInstances['incomeVsExpense'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        { label: 'Receitas Reais', data: incomes, backgroundColor: '#10b981', borderRadius: 6 },
        { label: 'Despesas Reais', data: expenses, backgroundColor: '#f43f5e', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { callback: (v) => 'R$ ' + v.toLocaleString('pt-BR') }
        }
      }
    }
  });
}

function calculateConsolidatedNetWorth() {
  let net = 0;
  appState.accounts.forEach(a => {
    net += Number(a.balance || 0);
  });
  appState.cards.forEach(c => {
    net -= Number(c.invoice || 0);
  });
  appState.fiis.forEach(f => {
    net += Number(f.balance || 0);
  });
  return net;
}

// =========================================================================
// BACKUP & RESTAURAÇÃO
// =========================================================================

function exportDataAsJSON() {
  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(appState, null, 2));
  const downloadAnchor = document.createElement('a');
  const filename = `FinanceFlow_Backup_${new Date().toISOString().split('T')[0]}.json`;
  downloadAnchor.setAttribute('href', dataStr);
  downloadAnchor.setAttribute('download', filename);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast('Arquivo de backup baixado com sucesso!', 'success');
}

function importDataFromJSON(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (imported && typeof imported === 'object') {
        appState = sanitizeAndMigrateState(imported);
        saveLocalState();
        renderApp();
        showToast('Backup restaurado com sucesso!', 'success');
      } else {
        showToast('O arquivo selecionado não é um backup válido.', 'error');
      }
    } catch (err) {
      showToast('Erro ao ler o arquivo JSON: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function confirmResetAllData() {
  if (confirm('ATENÇÃO: Deseja apagar todos os dados e começar do zero absoluto? Essa ação limpará suas contas, cartões e lançamentos.')) {
    const driveUrl = appState.settings.driveScriptUrl;
    const driveToken = appState.settings.driveToken;

    appState = {
      accounts: [],
      cards: [],
      fiis: [],
      transactions: [],
      purposes: DEFAULT_STATE.purposes,
      categories: DEFAULT_STATE.categories,
      balanceSnapshots: [],
      settings: {
        ...DEFAULT_STATE.settings,
        driveScriptUrl: driveUrl,
        driveToken: driveToken
      }
    };
    saveLocalState();
    renderApp();
    showToast('Todos os dados foram resetados.', 'info');
  }
}

function copyBackendScriptCode() {
  const code = `/**
 * FINANCEFLOW - BACKEND DO GOOGLE DRIVE (GOOGLE APPS SCRIPT)
 */
const DB_FILENAME = "FinanceFlow_Database.json";
const API_SECRET_TOKEN = ""; // Opcional: defina sua senha aqui se desejar

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "status";
    if (action === "status" || action === "ping") {
      return createJsonResponse({ status: "success", message: "FinanceFlow Backend ONLINE!", time: new Date().toISOString() });
    }
    if (!isAuthorized(e, null)) {
      return createJsonResponse({ status: "error", message: "Acesso não autorizado: senha incorreta." });
    }
    if (action === "load") {
      const data = loadDataFromDrive();
      return createJsonResponse({ status: "success", data: data });
    }
    return createJsonResponse({ status: "error", message: "Ação não reconhecida" });
  } catch (error) {
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}

function doPost(e) {
  try {
    let postData = null;
    if (e && e.postData && e.postData.contents) {
      postData = JSON.parse(e.postData.contents);
    }
    if (!isAuthorized(e, postData)) {
      return createJsonResponse({ status: "error", message: "Acesso não autorizado: senha incorreta." });
    }
    if (!postData || !postData.data) {
      return createJsonResponse({ status: "error", message: "Nenhum dado recebido" });
    }
    saveDataToDrive(postData.data);
    return createJsonResponse({ status: "success", message: "Dados salvos com sucesso!", timestamp: new Date().toISOString() });
  } catch (error) {
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}

function isAuthorized(e, postData) {
  if (!API_SECRET_TOKEN || API_SECRET_TOKEN.trim() === "") return true;
  const tokenFromGet = e && e.parameter ? e.parameter.token : null;
  const tokenFromPost = postData ? postData.token : null;
  return tokenFromGet === API_SECRET_TOKEN || tokenFromPost === API_SECRET_TOKEN;
}

function loadDataFromDrive() {
  const files = DriveApp.getFilesByName(DB_FILENAME);
  if (files.hasNext()) {
    const file = files.next();
    return JSON.parse(file.getBlob().getDataAsString());
  } else {
    const initialData = { accounts: [], cards: [], fiis: [], transactions: [], balanceSnapshots: [] };
    saveDataToDrive(initialData);
    return initialData;
  }
}

function saveDataToDrive(jsonData) {
  jsonData.lastUpdated = new Date().toISOString();
  const jsonString = JSON.stringify(jsonData, null, 2);
  const files = DriveApp.getFilesByName(DB_FILENAME);
  if (files.hasNext()) {
    files.next().setContent(jsonString);
  } else {
    DriveApp.createFile(DB_FILENAME, jsonString, MimeType.PLAIN_TEXT);
  }
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}`;

  navigator.clipboard.writeText(code).then(() => {
    showToast('Código do Google Apps Script copiado!', 'success');
  }).catch(() => {
    showToast('Abra o arquivo google-apps-script.js para copiar.', 'info');
  });
}

// =========================================================================
// UI HELPERS (MODALS, TOASTS, DATES)
// =========================================================================

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

function openDriveModal() {
  const modalDriveInput = document.getElementById('modalDriveUrlInput');
  if (modalDriveInput) modalDriveInput.value = appState.settings.driveScriptUrl || '';

  const modalTokenInput = document.getElementById('modalDriveTokenInput');
  if (modalTokenInput) modalTokenInput.value = appState.settings.driveToken || '';

  openModal('modalDrive');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

function formatDateBR(dateString) {
  if (!dateString) return '--/--/----';
  const parts = dateString.split('T')[0].split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateString;
}

function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('ServiceWorker registered:', reg.scope))
      .catch(err => console.log('ServiceWorker registration error:', err));
  }
}
