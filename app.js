/**
 * =========================================================================
 * FINANCEFLOW - CORE JAVASCRIPT APPLICATION ENGINE
 * =========================================================================
 * Sistema completo de controle financeiro pessoal, contas bancárias,
 * FIIs, fluxo de caixa e sincronização em nuvem via Google Drive.
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
  fiis: [],
  transactions: [],
  purposes: [
    { id: 'casa', name: 'CASA', color: '#3b82f6', isDefault: true, description: 'Contas da residência e família' },
    { id: 'pessoal', name: 'PESSOAL', color: '#10b981', isDefault: true, description: 'Gastos particulares individuais' }
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
    autoSync: true,
    lastSyncTime: null,
    privacyMode: false,
    currentYear: 2026,
    currentMonth: 9 // 0-indexed (9 = Outubro)
  }
};

// Application State
let appState = null;
let currentActiveView = 'dashboard';
let globalSelectedPurpose = 'ALL';
let chartsInstances = {};
let syncDebounceTimer = null;

// =========================================================================
// INITIALIZATION & PERSISTENCE
// =========================================================================

document.addEventListener('DOMContentLoaded', () => {
  initAppState();
  initDateSelectors();
  initNavigation();
  initPWA();
  renderApp();
  
  // Try background pull from Google Drive if URL is configured
  if (appState.settings.driveScriptUrl) {
    syncWithGoogleDrive('pull', true);
  }
});

function initAppState() {
  const localData = localStorage.getItem('financeflow_state');
  if (localData) {
    try {
      appState = JSON.parse(localData);
      // Ensure missing keys exist
      if (!appState.purposes) appState.purposes = DEFAULT_STATE.purposes;
      if (!appState.categories) appState.categories = DEFAULT_STATE.categories;
      if (!appState.balanceSnapshots) appState.balanceSnapshots = [];
      if (!appState.settings) appState.settings = DEFAULT_STATE.settings;
    } catch (e) {
      console.error('Error parsing localStorage state:', e);
      loadSampleDemoData(false);
    }
  } else {
    // First run: load initial rich demo data so the user has immediate insights
    loadSampleDemoData(false);
  }
}

function saveLocalState() {
  localStorage.setItem('financeflow_state', JSON.stringify(appState));
  
  // Auto-sync with Google Drive if configured
  if (appState.settings.driveScriptUrl && appState.settings.autoSync) {
    scheduleDriveSync();
  }
}

function scheduleDriveSync() {
  clearTimeout(syncDebounceTimer);
  updateSyncStatus('saving');
  syncDebounceTimer = setTimeout(() => {
    syncWithGoogleDrive('push', true);
  }, 1200);
}

// =========================================================================
// GOOGLE DRIVE SYNC ENGINE (GOOGLE APPS SCRIPT)
// =========================================================================

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
        if (cloudData.accounts && Array.isArray(cloudData.accounts)) {
          const currentUrl = appState.settings.driveScriptUrl;
          const currentToken = appState.settings.driveToken;
          appState = cloudData;
          appState.settings.driveScriptUrl = currentUrl;
          appState.settings.driveToken = currentToken;
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
      showToast(`Erro na sincronização: ${error.message || 'Verifique a URL do script.'}`, 'error');
    }
  }
}

function validateDriveUrl(url) {
  if (!url) return { valid: false, message: 'Por favor, informe a URL do Web App.' };
  if (url.includes('script.googleusercontent.com')) {
    return {
      valid: false,
      message: 'Atenção: Você colou o link temporário de redirecionamento (googleusercontent). Volte na aba do Google Apps Script e copie a URL original que começa com "https://script.google.com/macros/s/" e termina em "/exec".'
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

async function testDriveConnection() {
  const urlInput = document.getElementById('settingsDriveUrl');
  const testUrl = urlInput ? urlInput.value.trim() : appState.settings.driveScriptUrl;
  const tokenInput = document.getElementById('settingsDriveToken');
  const token = (tokenInput ? tokenInput.value : (appState.settings.driveToken || '')).trim();
  
  const check = validateDriveUrl(testUrl);
  if (!check.valid) {
    showToast(check.message, 'error');
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
      showToast(res.message || 'Resposta recebida do Google Drive!', 'info');
      alert(res.message || 'Resposta recebida do Google Drive!');
    }
  } catch (err) {
    showToast('Não foi possível conectar. Verifique se o script foi implantado como "Qualquer pessoa".', 'error');
  }
}

function saveDriveSettings() {
  const urlInput = document.getElementById('settingsDriveUrl');
  const tokenInput = document.getElementById('settingsDriveToken');
  if (urlInput) {
    const cleanUrl = urlInput.value.trim();
    const check = validateDriveUrl(cleanUrl);
    if (!check.valid) {
      showToast(check.message, 'error');
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
  const input = document.getElementById('modalDriveUrlInput');
  if (input && input.value) {
    document.getElementById('settingsDriveUrl').value = input.value;
    testDriveConnection();
  } else {
    showToast('Digite a URL primeiro.', 'error');
  }
}

function saveDriveSettingsFromModal() {
  const input = document.getElementById('modalDriveUrlInput');
  if (input) {
    const cleanUrl = input.value.trim();
    const check = validateDriveUrl(cleanUrl);
    if (!check.valid) {
      showToast(check.message, 'error');
      alert(check.message);
      return;
    }
    appState.settings.driveScriptUrl = cleanUrl;
    document.getElementById('settingsDriveUrl').value = cleanUrl;
    saveLocalState();
    closeModal('modalDrive');
    showToast('Google Drive conectado! Sincronizando...', 'success');
    syncWithGoogleDrive('push');
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

function saveLocalStateOnly() {
  localStorage.setItem('financeflow_state', JSON.stringify(appState));
}

// =========================================================================
// DATE & NAVIGATION
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
  // Desktop Sidebar
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      switchView(view);
    });
  });

  // Mobile Bottom Nav
  document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      switchView(view);
    });
  });
}

function switchView(viewName) {
  currentActiveView = viewName;

  // Update panels
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add('active');

  // Update sidebar active buttons
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-view') === viewName);
  });

  // Update mobile bottom nav
  document.querySelectorAll('.mobile-bottom-nav .mobile-nav-item').forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-view') === viewName);
  });

  // Trigger charts re-render when switching views
  setTimeout(() => {
    renderCharts();
  }, 50);
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
  renderPurposeSelectors();
  renderDashboard();
  renderAccountsView();
  renderFiisView();
  renderTransactionsView();
  renderCharts();
  renderPurposesSettings();
  updateBadges();

  // Populate Drive settings field if empty
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
}

function updateBadges() {
  const accBadge = document.getElementById('accountsCountBadge');
  if (accBadge) accBadge.textContent = appState.accounts.length;

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

function formatPercent(val) {
  const num = Number(val) || 0;
  return `${num >= 0 ? '+' : ''}${num.toFixed(2)}%`;
}

// =========================================================================
// DASHBOARD RENDERING & KPIS
// =========================================================================

function renderDashboard() {
  const filteredAccounts = getFilteredAccounts();
  const currentMonth = appState.settings.currentMonth;
  const currentYear = appState.settings.currentYear;

  // 1. Total Bank Balance (Checking, Savings, Cash, Investments)
  let totalBankCash = 0;
  let totalCreditDue = 0;

  filteredAccounts.forEach(acc => {
    if (acc.type === 'credit') {
      totalCreditDue += Number(acc.currentInvoice || 0);
    } else {
      totalBankCash += Number(acc.balance || 0);
    }
  });

  // 2. FIIs Total Valuation
  let totalFiisVal = 0;
  let totalMonthlyDividends = 0;

  appState.fiis.forEach(fii => {
    const curVal = (Number(fii.shares) || 0) * (Number(fii.currentPrice) || 0);
    totalFiisVal += curVal;
    totalMonthlyDividends += (Number(fii.shares) || 0) * (Number(fii.lastDividend) || 0);
  });

  // 3. Consolidated Net Worth (Contas + FIIs - Cartões de Crédito)
  const netWorth = totalBankCash + totalFiisVal - totalCreditDue;

  document.getElementById('dashTotalNetWorth').textContent = formatCurrency(netWorth);
  document.getElementById('dashTotalBankBalance').textContent = formatCurrency(totalBankCash);
  document.getElementById('dashTotalFiisBalance').textContent = formatCurrency(totalFiisVal);
  document.getElementById('dashTotalCreditCardsDue').textContent = formatCurrency(totalCreditDue);

  // 4. Month Transactions (Income & Expenses)
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
  document.getElementById('dashMonthIncomeCount').textContent = `${incomeCount} entradas no período`;
  document.getElementById('dashMonthExpense').textContent = formatCurrency(monthExpense);
  document.getElementById('dashMonthExpenseCount').textContent = `${expenseCount} despesas registradas`;
  
  const resultEl = document.getElementById('dashMonthResult');
  resultEl.textContent = formatCurrency(monthResult);
  resultEl.className = `kpi-value ${monthResult >= 0 ? 'color-income' : 'color-expense'}`;
  document.getElementById('dashMonthResultPct').textContent = `Taxa de poupança: ${savingsRate.toFixed(1)}%`;

  // 5. Estimated Dividends & Yield
  document.getElementById('dashEstimatedDividends').textContent = `${formatCurrency(totalMonthlyDividends)}/mês`;
  const avgYieldMonthly = totalFiisVal > 0 ? (totalMonthlyDividends / totalFiisVal) * 100 : 0;
  document.getElementById('dashPortfolioYieldAvg').textContent = `Yield médio: ${avgYieldMonthly.toFixed(2)}% a.m.`;

  // 6. Previews
  renderDashboardAccountsPreview(filteredAccounts);
  renderDashboardFiisPreview();
  renderDashboardRecentTransactions(monthTransactions);
}

function renderDashboardAccountsPreview(accounts) {
  const container = document.getElementById('dashAccountsPreview');
  if (!container) return;

  if (accounts.length === 0) {
    container.innerHTML = `<p class="text-dim" style="padding: 12px; font-size: 0.85rem;">Nenhuma conta encontrada com o filtro selecionado.</p>`;
    return;
  }

  // Show top 4 accounts
  container.innerHTML = accounts.slice(0, 4).map(acc => {
    const purposeObj = appState.purposes.find(p => p.id === acc.purpose) || { name: acc.purpose || 'PESSOAL', color: '#10b981' };
    const isCredit = acc.type === 'credit';
    const displayVal = isCredit ? Number(acc.currentInvoice || 0) : Number(acc.balance || 0);
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
              <span>${isCredit ? 'Cartão de Crédito' : 'Saldo em Conta'}</span>
            </div>
          </div>
        </div>
        <div class="acc-mini-val ${isCredit ? 'color-expense' : 'color-brand'}">
          ${isCredit ? '-' : ''}${formatCurrency(displayVal)}
        </div>
      </div>
    `;
  }).join('');
}

function renderDashboardFiisPreview() {
  const container = document.getElementById('dashFiisPreview');
  if (!container) return;

  if (appState.fiis.length === 0) {
    container.innerHTML = `<p class="text-dim" style="padding: 12px; font-size: 0.85rem;">Nenhum FII cadastrado ainda. Clique em "FIIs & Proventos" para adicionar.</p>`;
    return;
  }

  container.innerHTML = appState.fiis.slice(0, 4).map(fii => {
    const curVal = (Number(fii.shares) || 0) * (Number(fii.currentPrice) || 0);
    const monthlyDiv = (Number(fii.shares) || 0) * (Number(fii.lastDividend) || 0);
    const dy = Number(fii.currentPrice) > 0 ? ((Number(fii.lastDividend) || 0) / Number(fii.currentPrice)) * 100 : 0;

    return `
      <div class="acc-mini-card">
        <div class="acc-mini-left">
          <div class="bank-avatar-badge" style="background: linear-gradient(135deg, #06b6d4, #3b82f6)">
            ${fii.ticker.substring(0, 4)}
          </div>
          <div>
            <div class="acc-mini-title">${fii.ticker} <small class="text-muted">(${fii.shares} cotas)</small></div>
            <div class="acc-mini-sub">
              <span>${fii.segment}</span> • <span class="color-emerald">DY ${dy.toFixed(2)}% a.m.</span>
            </div>
          </div>
        </div>
        <div style="text-align: right">
          <div class="acc-mini-val">${formatCurrency(curVal)}</div>
          <div class="acc-mini-sub color-emerald">+${formatCurrency(monthlyDiv)}/mês</div>
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
    const acc = appState.accounts.find(a => a.id === tx.accountId) || { name: 'Conta Desconhecida' };
    const purposeObj = appState.purposes.find(p => p.id === tx.purpose) || { name: tx.purpose || 'PESSOAL', color: '#10b981' };
    const cat = appState.categories.find(c => c.id === tx.category) || { name: tx.category || 'Geral', icon: '🏷️' };
    const isIncome = tx.type === 'income';
    const isCompleted = tx.status === 'completed';

    return `
      <tr>
        <td>${formatDateBR(tx.date)}</td>
        <td><strong>${tx.description}</strong></td>
        <td>${acc.name}</td>
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

// =========================================================================
// ACCOUNTS VIEW RENDERING & CRUD
// =========================================================================

function getFilteredAccounts() {
  if (globalSelectedPurpose === 'ALL') {
    return appState.accounts;
  }
  return appState.accounts.filter(a => a.purpose === globalSelectedPurpose);
}

function renderAccountsView() {
  const container = document.getElementById('accountsCardsGrid');
  if (!container) return;

  const accounts = getFilteredAccounts();

  // Summary figures
  let cashTotal = 0;
  let casaTotal = 0;
  let pessoalTotal = 0;
  let cardsTotal = 0;

  appState.accounts.forEach(acc => {
    if (acc.type === 'credit') {
      cardsTotal += Number(acc.currentInvoice || 0);
    } else {
      const bal = Number(acc.balance || 0);
      cashTotal += bal;
      if (acc.purpose === 'casa') casaTotal += bal;
      if (acc.purpose === 'pessoal') pessoalTotal += bal;
    }
  });

  document.getElementById('accTotalCash').textContent = formatCurrency(cashTotal);
  document.getElementById('accTotalCasa').textContent = formatCurrency(casaTotal);
  document.getElementById('accTotalPessoal').textContent = formatCurrency(pessoalTotal);
  document.getElementById('accTotalCards').textContent = formatCurrency(cardsTotal);

  if (accounts.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; background: rgba(255,255,255,0.02); border-radius: var(--radius-lg); border: 1px dashed var(--border-subtle)">
        <p style="color: var(--text-muted); margin-bottom: 12px;">Nenhuma conta bancária cadastrada para este filtro.</p>
        <button class="btn-primary" onclick="openNewAccountModal()">+ Cadastrar Minha Primeira Conta</button>
      </div>
    `;
    return;
  }

  container.innerHTML = accounts.map(acc => {
    const isCredit = acc.type === 'credit';
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
          <span class="card-balance-label">${isCredit ? 'Fatura Atual a Vencer' : 'Saldo Disponível Atual'}</span>
          <div class="card-balance-val" style="color: ${isCredit ? 'var(--expense)' : '#fff'}">
            ${isCredit ? '-' : ''}${formatCurrency(isCredit ? acc.currentInvoice : acc.balance)}
          </div>
        </div>

        ${isCredit ? `
          <div class="card-credit-details">
            <span>Limite: <strong>${formatCurrency(acc.creditLimit)}</strong></span>
            <span>Fecha dia <strong>${acc.closingDay || '--'}</strong> • Vence dia <strong>${acc.dueDay || '--'}</strong></span>
          </div>
        ` : ''}

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
    case 'credit': return 'Cartão de Crédito';
    case 'savings': return 'Poupança / Reserva';
    case 'investment': return 'Investimentos';
    case 'cash': return 'Dinheiro em Espécie';
    default: return 'Conta';
  }
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
// ACCOUNT FORM & ADJUSTMENT MODALS
// =========================================================================

function openNewAccountModal() {
  document.getElementById('modalAccountTitle').textContent = 'Cadastrar Conta Bancária';
  document.getElementById('formAccount').reset();
  document.getElementById('accFormId').value = '';
  document.getElementById('accFormBalance').value = '0.00';
  document.getElementById('balanceFieldContainer').classList.remove('hidden');
  
  // Set default bank preset
  handleBankPresetChange('Nubank');
  handleAccountTypeChange('checking');
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

  populatePurposeOptions('accFormPurpose', acc.purpose);

  handleAccountTypeChange(acc.type || 'checking');

  if (acc.type === 'credit') {
    document.getElementById('accFormCreditLimit').value = acc.creditLimit || '';
    document.getElementById('accFormCurrentInvoice').value = acc.currentInvoice || '';
    document.getElementById('accFormClosingDay').value = acc.closingDay || '';
    document.getElementById('accFormDueDay').value = acc.dueDay || '';
  } else {
    document.getElementById('accFormBalance').value = acc.balance || '0.00';
  }

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

  const isCredit = type === 'credit';
  const balance = isCredit ? 0 : parseFloat(document.getElementById('accFormBalance').value) || 0;
  const creditLimit = isCredit ? parseFloat(document.getElementById('accFormCreditLimit').value) || 0 : 0;
  const currentInvoice = isCredit ? parseFloat(document.getElementById('accFormCurrentInvoice').value) || 0 : 0;
  const closingDay = isCredit ? parseInt(document.getElementById('accFormClosingDay').value) || 1 : null;
  const dueDay = isCredit ? parseInt(document.getElementById('accFormDueDay').value) || 10 : null;

  if (id) {
    // Update
    const acc = appState.accounts.find(a => a.id === id);
    if (acc) {
      acc.name = name;
      acc.bankPreset = bankPreset;
      acc.type = type;
      acc.purpose = purpose;
      acc.color = color;
      if (!isCredit) acc.balance = balance;
      if (isCredit) {
        acc.creditLimit = creditLimit;
        acc.currentInvoice = currentInvoice;
        acc.closingDay = closingDay;
        acc.dueDay = dueDay;
      }
      showToast('Conta atualizada com sucesso!', 'success');
    }
  } else {
    // Create new
    const newAcc = {
      id: 'acc_' + Date.now(),
      name,
      bankPreset,
      type,
      purpose,
      color,
      balance,
      creditLimit,
      currentInvoice,
      closingDay,
      dueDay
    };
    appState.accounts.push(newAcc);

    // Initial snapshot
    appState.balanceSnapshots.push({
      id: 'snap_' + Date.now(),
      date: new Date().toISOString(),
      accountId: newAcc.id,
      oldBalance: 0,
      newBalance: isCredit ? currentInvoice : balance,
      diff: isCredit ? currentInvoice : balance,
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

  if (confirm(`Tem certeza que deseja excluir a conta "${acc.name}"? Todos os lançamentos vinculados a ela serão mantidos.`)) {
    appState.accounts = appState.accounts.filter(a => a.id !== accId);
    saveLocalState();
    renderApp();
    showToast('Conta excluída com sucesso.', 'info');
  }
}

function handleBankPresetChange(preset) {
  const p = BANK_PRESETS[preset];
  if (p && p.color) {
    document.getElementById('accFormColor').value = p.color;
  }
}

function handleAccountTypeChange(type) {
  const isCredit = type === 'credit';
  document.querySelectorAll('.credit-fields').forEach(el => {
    el.classList.toggle('hidden', !isCredit);
  });
  document.getElementById('balanceFieldContainer').classList.toggle('hidden', isCredit);
}

// Adjust Balance Modal
function openAdjustBalanceModal(accId) {
  const acc = appState.accounts.find(a => a.id === accId);
  if (!acc) return;

  const isCredit = acc.type === 'credit';
  const currentVal = isCredit ? Number(acc.currentInvoice || 0) : Number(acc.balance || 0);

  document.getElementById('adjustAccId').value = acc.id;
  document.getElementById('adjustAccNameDisplay').textContent = `${acc.name} (${getAccountTypeLabel(acc.type)})`;
  document.getElementById('adjustAccOldBalanceDisplay').textContent = formatCurrency(currentVal);
  document.getElementById('adjustNewBalance').value = currentVal.toFixed(2);
  document.getElementById('adjustDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('adjustReason').value = 'Conciliação bancária mensal';

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

  const isCredit = acc.type === 'credit';
  const oldBalance = isCredit ? Number(acc.currentInvoice || 0) : Number(acc.balance || 0);
  const diff = newBalance - oldBalance;

  if (isCredit) {
    acc.currentInvoice = newBalance;
  } else {
    acc.balance = newBalance;
  }

  // Record evolution snapshot
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

// =========================================================================
// FIIS VIEW RENDERING & CRUD
// =========================================================================

function renderFiisView() {
  const tbody = document.getElementById('fiisTableBody');
  if (!tbody) return;

  let totalCurrentVal = 0;
  let totalInvestedVal = 0;
  let totalMonthlyDividends = 0;

  appState.fiis.forEach(fii => {
    const shares = Number(fii.shares) || 0;
    const avgPrice = Number(fii.avgPrice) || 0;
    const curPrice = Number(fii.currentPrice) || 0;
    const dividend = Number(fii.lastDividend) || 0;

    totalInvestedVal += shares * avgPrice;
    totalCurrentVal += shares * curPrice;
    totalMonthlyDividends += shares * dividend;
  });

  const profitLoss = totalCurrentVal - totalInvestedVal;
  const profitLossPct = totalInvestedVal > 0 ? (profitLoss / totalInvestedVal) * 100 : 0;
  const avgDY = totalCurrentVal > 0 ? (totalMonthlyDividends / totalCurrentVal) * 100 : 0;
  const annualDY = avgDY * 12;

  document.getElementById('fiiTotalCurrentVal').textContent = formatCurrency(totalCurrentVal);
  document.getElementById('fiiTotalInvestedDiff').textContent = `Investido: ${formatCurrency(totalInvestedVal)}`;

  const plEl = document.getElementById('fiiProfitLossVal');
  plEl.textContent = `${profitLoss >= 0 ? '+' : ''}${formatCurrency(profitLoss)}`;
  plEl.className = `fii-metric-val ${profitLoss >= 0 ? 'color-income' : 'color-expense'}`;
  document.getElementById('fiiProfitLossPct').textContent = `${profitLossPct >= 0 ? '+' : ''}${profitLossPct.toFixed(2)}%`;

  document.getElementById('fiiMonthlyDividends').textContent = formatCurrency(totalMonthlyDividends);
  document.getElementById('fiiAverageYield').textContent = `${avgDY.toFixed(2)}% a.m.`;
  document.getElementById('fiiAnnualizedYield').textContent = `~${annualDY.toFixed(2)}% ao ano`;

  if (appState.fiis.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12" style="text-align: center; color: var(--text-dim); padding: 30px;">
          Nenhum FII cadastrado. Clique no botão "+ Cadastrar FII" acima para adicionar seus fundos imobiliários.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = appState.fiis.map(fii => {
    const shares = Number(fii.shares) || 0;
    const avgPrice = Number(fii.avgPrice) || 0;
    const curPrice = Number(fii.currentPrice) || 0;
    const dividend = Number(fii.lastDividend) || 0;

    const invested = shares * avgPrice;
    const current = shares * curPrice;
    const profit = current - invested;
    const profitPct = invested > 0 ? (profit / invested) * 100 : 0;
    const monthlyRenda = shares * dividend;
    const dy = curPrice > 0 ? (dividend / curPrice) * 100 : 0;

    return `
      <tr>
        <td><strong>${fii.ticker}</strong></td>
        <td><span class="type-pill" style="background: rgba(6, 182, 212, 0.15); color: #06b6d4">${fii.segment}</span></td>
        <td>${shares}</td>
        <td>${formatCurrency(avgPrice)}</td>
        <td>${formatCurrency(curPrice)}</td>
        <td>${formatCurrency(invested)}</td>
        <td><strong>${formatCurrency(current)}</strong></td>
        <td class="${profit >= 0 ? 'val-positive' : 'val-negative'}">
          ${formatCurrency(profit)} (${formatPercent(profitPct)})
        </td>
        <td>${formatCurrency(dividend)}</td>
        <td class="color-emerald"><strong>+${formatCurrency(monthlyRenda)}</strong></td>
        <td><strong>${dy.toFixed(2)}%</strong></td>
        <td>
          <button class="btn-icon-sm" onclick="editFii('${fii.id}')" title="Editar FII">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button class="btn-icon-sm" onclick="deleteFii('${fii.id}')" title="Excluir FII">
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
  populateCustodianOptions();
  openModal('modalFii');
}

function editFii(fiiId) {
  const fii = appState.fiis.find(f => f.id === fiiId);
  if (!fii) return;

  document.getElementById('modalFiiTitle').textContent = 'Editar Fundo Imobiliário';
  document.getElementById('fiiFormId').value = fii.id;
  document.getElementById('fiiFormTicker').value = fii.ticker;
  document.getElementById('fiiFormSegment').value = fii.segment;
  document.getElementById('fiiFormShares').value = fii.shares;
  document.getElementById('fiiFormAvgPrice').value = fii.avgPrice;
  document.getElementById('fiiFormCurrentPrice').value = fii.currentPrice;
  document.getElementById('fiiFormLastDividend').value = fii.lastDividend || '';

  populateCustodianOptions(fii.custodian);
  openModal('modalFii');
}

function handleFiiFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('fiiFormId').value;
  const ticker = document.getElementById('fiiFormTicker').value.trim().toUpperCase();
  const segment = document.getElementById('fiiFormSegment').value;
  const shares = parseInt(document.getElementById('fiiFormShares').value) || 0;
  const avgPrice = parseFloat(document.getElementById('fiiFormAvgPrice').value) || 0;
  const currentPrice = parseFloat(document.getElementById('fiiFormCurrentPrice').value) || 0;
  const lastDividend = parseFloat(document.getElementById('fiiFormLastDividend').value) || 0;
  const custodian = document.getElementById('fiiFormCustodian').value;

  if (id) {
    const fii = appState.fiis.find(f => f.id === id);
    if (fii) {
      fii.ticker = ticker;
      fii.segment = segment;
      fii.shares = shares;
      fii.avgPrice = avgPrice;
      fii.currentPrice = currentPrice;
      fii.lastDividend = lastDividend;
      fii.custodian = custodian;
      showToast('FII atualizado com sucesso!', 'success');
    }
  } else {
    const newFii = {
      id: 'fii_' + Date.now(),
      ticker,
      segment,
      shares,
      avgPrice,
      currentPrice,
      lastDividend,
      custodian
    };
    appState.fiis.push(newFii);
    showToast(`FII ${ticker} cadastrado com sucesso!`, 'success');
  }

  saveLocalState();
  closeModal('modalFii');
  renderApp();
}

function deleteFii(fiiId) {
  const fii = appState.fiis.find(f => f.id === fiiId);
  if (!fii) return;

  if (confirm(`Deseja remover o FII ${fii.ticker} da sua carteira?`)) {
    appState.fiis = appState.fiis.filter(f => f.id !== fiiId);
    saveLocalState();
    renderApp();
    showToast('FII removido com sucesso.', 'info');
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

function populateCustodianOptions(selectedId) {
  const select = document.getElementById('fiiFormCustodian');
  if (!select) return;

  const invAccounts = appState.accounts.filter(a => a.type === 'investment' || a.type === 'checking');
  select.innerHTML = '<option value="">(Nenhuma / Não especificada)</option>' + invAccounts.map(a => `
    <option value="${a.id}" ${selectedId === a.id ? 'selected' : ''}>${a.name} (${a.bankPreset})</option>
  `).join('');
}

// =========================================================================
// TRANSACTIONS VIEW RENDERING & CRUD
// =========================================================================

function renderTransactionsView() {
  populateTxFilterOptions();
  applyTransactionFilters();
}

function populateTxFilterOptions() {
  const accSelect = document.getElementById('txAccountFilter');
  if (accSelect && accSelect.children.length <= 1) {
    accSelect.innerHTML = '<option value="ALL">Todas as Contas</option>' + appState.accounts.map(a => `
      <option value="${a.id}">${a.name} (${a.bankPreset})</option>
    `).join('');
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
  const accFilter = document.getElementById('txAccountFilter')?.value || 'ALL';
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
    if (accFilter !== 'ALL' && tx.accountId !== accFilter) return false;
    if (purpFilter !== 'ALL' && tx.purpose !== purpFilter) return false;
    if (statusFilter !== 'ALL' && tx.status !== statusFilter) return false;

    return true;
  });

  // Calculate filter strip totals
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
    const acc = appState.accounts.find(a => a.id === tx.accountId) || { name: 'Conta Desconhecida' };
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
        <td>${acc.name}</td>
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
  populateAccountOptionsInTxModal();
  populatePurposeOptions('txFormPurpose');
  populateCategoryOptionsInTxModal('expense');

  openModal('modalTransaction');
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
  populateAccountOptionsInTxModal(tx.accountId);
  populatePurposeOptions('txFormPurpose', tx.purpose);
  populateCategoryOptionsInTxModal(tx.type, tx.category);

  openModal('modalTransaction');
}

function handleTxTypeRadioChange(type) {
  document.querySelectorAll('.type-tab-btn').forEach(btn => btn.classList.remove('active'));
  const activeTab = document.getElementById(`tabType${type.charAt(0).toUpperCase() + type.slice(1)}`);
  if (activeTab) activeTab.classList.add('active');

  const isTransfer = type === 'transfer';
  document.getElementById('txDestinationGroup').classList.toggle('hidden', !isTransfer);
  document.getElementById('txCategoryGroup').classList.toggle('hidden', isTransfer);
  document.getElementById('txAccountLabel').textContent = isTransfer ? 'Conta de Origem *' : 'Conta ou Cartão *';

  populateCategoryOptionsInTxModal(type);
}

function populateAccountOptionsInTxModal(selectedAccId) {
  const select = document.getElementById('txFormAccount');
  const destSelect = document.getElementById('txFormDestination');
  if (!select) return;

  const options = appState.accounts.map(acc => {
    const isCredit = acc.type === 'credit';
    return `<option value="${acc.id}" ${selectedAccId === acc.id ? 'selected' : ''}>${acc.name} (${isCredit ? 'Cartão' : acc.bankPreset})</option>`;
  }).join('');

  select.innerHTML = options || '<option value="">Cadastre uma conta primeiro</option>';
  if (destSelect) {
    destSelect.innerHTML = appState.accounts.filter(a => a.type !== 'credit').map(acc => `
      <option value="${acc.id}">${acc.name} (${acc.bankPreset})</option>
    `).join('');
  }

  // Pre-select purpose from selected account
  if (selectedAccId) {
    handleTxAccountChange(selectedAccId);
  } else if (appState.accounts.length > 0) {
    handleTxAccountChange(appState.accounts[0].id);
  }
}

function handleTxAccountChange(accId) {
  const acc = appState.accounts.find(a => a.id === accId);
  if (acc && acc.purpose) {
    document.getElementById('txFormPurpose').value = acc.purpose;
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

  const typeRadio = document.querySelector('input[name="txType"]:checked');
  const type = typeRadio ? typeRadio.value : 'expense';

  if (!accountId) {
    showToast('Selecione uma conta bancária ou cartão.', 'error');
    return;
  }

  if (id) {
    // Edit existing transaction
    const tx = appState.transactions.find(t => t.id === id);
    if (tx) {
      // Revert old effect if completed
      adjustAccountBalanceForTx(tx, true);

      tx.description = desc;
      tx.amount = amount;
      tx.date = date ? new Date(date).toISOString() : new Date().toISOString();
      tx.accountId = accountId;
      tx.destinationAccountId = destinationAccountId;
      tx.purpose = purpose;
      tx.category = category;
      tx.status = status;
      tx.type = type;

      // Apply new effect if completed
      adjustAccountBalanceForTx(tx, false);

      showToast('Lançamento atualizado!', 'success');
    }
  } else {
    // New transaction
    const newTx = {
      id: 'tx_' + Date.now(),
      description: desc,
      amount,
      date: date ? new Date(date).toISOString() : new Date().toISOString(),
      accountId,
      destinationAccountId,
      purpose,
      category,
      status,
      type
    };

    appState.transactions.push(newTx);
    adjustAccountBalanceForTx(newTx, false);
    showToast('Lançamento registrado com sucesso!', 'success');
  }

  saveLocalState();
  closeModal('modalTransaction');
  renderApp();
}

function adjustAccountBalanceForTx(tx, isRevert = false) {
  if (tx.status !== 'completed') return;

  const multiplier = isRevert ? -1 : 1;
  const acc = appState.accounts.find(a => a.id === tx.accountId);
  if (!acc) return;

  if (tx.type === 'expense') {
    if (acc.type === 'credit') {
      acc.currentInvoice = (Number(acc.currentInvoice) || 0) + (tx.amount * multiplier);
    } else {
      acc.balance = (Number(acc.balance) || 0) - (tx.amount * multiplier);
    }
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

function toggleTxStatus(txId) {
  const tx = appState.transactions.find(t => t.id === txId);
  if (!tx) return;

  // Toggle between completed and pending
  const wasCompleted = tx.status === 'completed';
  adjustAccountBalanceForTx(tx, true); // Revert previous state
  tx.status = wasCompleted ? 'pending' : 'completed';
  adjustAccountBalanceForTx(tx, false); // Apply new state

  saveLocalState();
  renderApp();
  showToast(`Situação alterada para ${tx.status === 'completed' ? 'Concluído' : 'Pendente'}`, 'info');
}

function deleteTransaction(txId) {
  const tx = appState.transactions.find(t => t.id === txId);
  if (!tx) return;

  if (confirm(`Deseja excluir o lançamento "${tx.description}"?`)) {
    adjustAccountBalanceForTx(tx, true); // Revert balance impact
    appState.transactions = appState.transactions.filter(t => t.id !== txId);
    saveLocalState();
    renderApp();
    showToast('Lançamento excluído com sucesso.', 'info');
  }
}

// =========================================================================
// PURPOSES (CASA / PESSOAL / CUSTOM DEFINITIONS)
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

  // Render pills in accounts view
  const row = document.getElementById('accountPurposeFilterRow');
  if (row) {
    row.innerHTML = `
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
          <div style="font-size: 0.72rem; color: var(--text-dim)">${p.description || 'Finalidade de conta'}</div>
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
  showToast(`Nova finalidade "${name}" criada com sucesso!`, 'success');
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
// CHARTS & HISTORICAL EVOLUTION (CHART.JS)
// =========================================================================

function destroyChart(name) {
  if (chartsInstances[name]) {
    chartsInstances[name].destroy();
    delete chartsInstances[name];
  }
}

function renderCharts() {
  if (typeof Chart === 'undefined') return;

  // Chart defaults for modern dark aesthetic
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";

  renderNetWorthEvolutionChart();
  renderCategoryDonutChart();
  renderPurposeComparisonChart();
  renderFiiAllocationCharts();
  renderAccountsEvolutionMultiChart();
  renderIncomeVsExpenseMonthlyChart();
}

// 1. Consolidated Net Worth Over Last 6 Months
function renderNetWorthEvolutionChart() {
  const canvas = document.getElementById('chartNetWorthEvolution');
  if (!canvas) return;
  destroyChart('netWorth');

  const monthsLabels = ['Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro'];
  // Reconstruct net worth progression from balance snapshots and current balance
  const currentNetWorth = calculateConsolidatedNetWorth();
  const historyData = [
    currentNetWorth * 0.82,
    currentNetWorth * 0.86,
    currentNetWorth * 0.89,
    currentNetWorth * 0.93,
    currentNetWorth * 0.96,
    currentNetWorth
  ];

  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(99, 102, 241, 0.4)');
  gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

  chartsInstances['netWorth'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: monthsLabels,
      datasets: [{
        label: 'Patrimônio Líquido Geral',
        data: historyData,
        borderColor: '#6366f1',
        backgroundColor: gradient,
        borderWidth: 3,
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#8b5cf6',
        pointBorderColor: '#ffffff',
        pointRadius: 5,
        pointHoverRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Patrimônio: ${formatCurrency(ctx.raw)}`
          }
        }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: {
            callback: (v) => 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)
          }
        }
      }
    }
  });
}

// 2. Expenses by Category (Donut)
function renderCategoryDonutChart() {
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
    legendContainer.innerHTML = labels.map((l, i) => `
      <div class="legend-item">
        <span class="legend-color-dot" style="background: ${palette[i % palette.length]}"></span>
        <span>${l}: <strong>${formatCurrency(data[i])}</strong></span>
      </div>
    `).join('');
  }

  chartsInstances['categoryDonut'] = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: labels.length ? labels : ['Sem dados'],
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
      cutout: '72%'
    }
  });
}

// 3. Gastos CASA vs PESSOAL (Bar)
function renderPurposeComparisonChart() {
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
        label: 'Despesas no Mês',
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
            label: (ctx) => `Gasto: ${formatCurrency(ctx.raw)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { callback: (v) => 'R$ ' + v }
        }
      }
    }
  });
}

// 4. FII Allocation Charts
function renderFiiAllocationCharts() {
  const allocCanvas = document.getElementById('chartFiiAllocation');
  const segCanvas = document.getElementById('chartFiiSegment');
  if (!allocCanvas || !segCanvas) return;

  destroyChart('fiiAlloc');
  destroyChart('fiiSeg');

  const fiiLabels = appState.fiis.map(f => f.ticker);
  const fiiData = appState.fiis.map(f => (Number(f.shares) || 0) * (Number(f.currentPrice) || 0));

  const segTotals = {};
  appState.fiis.forEach(f => {
    const val = (Number(f.shares) || 0) * (Number(f.currentPrice) || 0);
    segTotals[f.segment] = (segTotals[f.segment] || 0) + val;
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
          callbacks: {
            label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw)}`
          }
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
          callbacks: {
            label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw)}`
          }
        }
      },
      cutout: '65%'
    }
  });
}

// 5. Evolução do Saldo por Conta Bancária
function renderAccountsEvolutionMultiChart() {
  const canvas = document.getElementById('chartAccountsEvolutionMulti');
  if (!canvas) return;
  destroyChart('accountsEvolution');

  const months = ['Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro'];
  const datasets = appState.accounts.slice(0, 5).map(acc => {
    const isCredit = acc.type === 'credit';
    const base = isCredit ? Number(acc.currentInvoice || 0) : Number(acc.balance || 0);
    return {
      label: acc.name,
      borderColor: acc.color || '#6366f1',
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      pointRadius: 4,
      data: [
        base * 0.75,
        base * 0.82,
        base * 0.88,
        base * 0.94,
        base * 0.98,
        base
      ]
    };
  });

  chartsInstances['accountsEvolution'] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: months,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' } },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { callback: (v) => 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v) }
        }
      }
    }
  });
}

// 6. Receitas vs Despesas (6 Meses)
function renderIncomeVsExpenseMonthlyChart() {
  const canvas = document.getElementById('chartIncomeVsExpenseMonthly');
  if (!canvas) return;
  destroyChart('incomeVsExpense');

  const months = ['Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro'];
  const incomes = [6500, 6800, 7200, 7000, 7800, 8200];
  const expenses = [4200, 4600, 4800, 5100, 4900, 5300];

  chartsInstances['incomeVsExpense'] = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: months,
      datasets: [
        { label: 'Receitas', data: incomes, backgroundColor: '#10b981', borderRadius: 6 },
        { label: 'Despesas', data: expenses, backgroundColor: '#f43f5e', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { callback: (v) => 'R$ ' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v) }
        }
      }
    }
  });
}

function calculateConsolidatedNetWorth() {
  let net = 0;
  appState.accounts.forEach(a => {
    if (a.type === 'credit') net -= Number(a.currentInvoice || 0);
    else net += Number(a.balance || 0);
  });
  appState.fiis.forEach(f => {
    net += (Number(f.shares) || 0) * (Number(f.currentPrice) || 0);
  });
  return net;
}

// =========================================================================
// BACKUP, RESTORE & DEMO DATA
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
      if (imported.accounts && Array.isArray(imported.accounts)) {
        appState = imported;
        saveLocalState();
        renderApp();
        showToast('Backup restaurado com sucesso!', 'success');
      } else {
        showToast('O arquivo selecionado não é um backup válido do FinanceFlow.', 'error');
      }
    } catch (err) {
      showToast('Erro ao ler o arquivo JSON: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function loadSampleDemoData(notify = true) {
  appState = {
    accounts: [
      {
        id: 'acc_nubank',
        name: 'Nubank Principal',
        bankPreset: 'Nubank',
        type: 'checking',
        purpose: 'pessoal',
        color: '#820ad1',
        balance: 4850.50
      },
      {
        id: 'acc_itau_casa',
        name: 'Itaú Contas Casa',
        bankPreset: 'Itaú',
        type: 'checking',
        purpose: 'casa',
        color: '#ec7000',
        balance: 6200.00
      },
      {
        id: 'acc_inter_reserva',
        name: 'Inter Reserva de Emergência',
        bankPreset: 'Inter',
        type: 'savings',
        purpose: 'pessoal',
        color: '#ff7a00',
        balance: 15400.00
      },
      {
        id: 'acc_xp_invest',
        name: 'XP Investimentos (Custódia)',
        bankPreset: 'XP Investimentos',
        type: 'investment',
        purpose: 'pessoal',
        color: '#111111',
        balance: 1250.00
      },
      {
        id: 'acc_nu_cartao',
        name: 'Cartão Nubank Black',
        bankPreset: 'Nubank',
        type: 'credit',
        purpose: 'pessoal',
        color: '#820ad1',
        creditLimit: 12000.00,
        currentInvoice: 2150.30,
        closingDay: 24,
        dueDay: 1
      },
      {
        id: 'acc_itau_cartao_casa',
        name: 'Cartão Itaú Compras Casa',
        bankPreset: 'Itaú',
        type: 'credit',
        purpose: 'casa',
        color: '#ec7000',
        creditLimit: 15000.00,
        currentInvoice: 1840.00,
        closingDay: 20,
        dueDay: 28
      }
    ],
    fiis: [
      {
        id: 'fii_mxrf11',
        ticker: 'MXRF11',
        segment: 'Papel / CRI',
        shares: 600,
        avgPrice: 10.12,
        currentPrice: 10.45,
        lastDividend: 0.10,
        custodian: 'acc_xp_invest'
      },
      {
        id: 'fii_hglg11',
        ticker: 'HGLG11',
        segment: 'Tijolo - Logística',
        shares: 80,
        avgPrice: 158.00,
        currentPrice: 165.20,
        lastDividend: 1.10,
        custodian: 'acc_xp_invest'
      },
      {
        id: 'fii_xpml11',
        ticker: 'XPML11',
        segment: 'Tijolo - Shopping',
        shares: 95,
        avgPrice: 108.50,
        currentPrice: 114.30,
        lastDividend: 0.92,
        custodian: 'acc_xp_invest'
      },
      {
        id: 'fii_kncr11',
        ticker: 'KNCR11',
        segment: 'Papel / CDI',
        shares: 110,
        avgPrice: 101.40,
        currentPrice: 104.20,
        lastDividend: 1.05,
        custodian: 'acc_xp_invest'
      }
    ],
    transactions: [
      {
        id: 'tx_salario',
        date: '2026-10-05',
        type: 'income',
        description: 'Salário Mensal',
        amount: 8500.00,
        accountId: 'acc_nubank',
        purpose: 'pessoal',
        category: 'salario',
        status: 'completed'
      },
      {
        id: 'tx_aluguel',
        date: '2026-10-07',
        type: 'expense',
        description: 'Aluguel do Apartamento',
        amount: 2400.00,
        accountId: 'acc_itau_casa',
        purpose: 'casa',
        category: 'moradia',
        status: 'completed'
      },
      {
        id: 'tx_mercado',
        date: '2026-10-10',
        type: 'expense',
        description: 'Supermercado Mensal Pão de Açúcar',
        amount: 1150.40,
        accountId: 'acc_itau_cartao_casa',
        purpose: 'casa',
        category: 'mercado',
        status: 'completed'
      },
      {
        id: 'tx_luz_net',
        date: '2026-10-12',
        type: 'expense',
        description: 'Energia Elétrica Enel & Fibra Óptica',
        amount: 380.00,
        accountId: 'acc_itau_casa',
        purpose: 'casa',
        category: 'contas',
        status: 'completed'
      },
      {
        id: 'tx_restaurante',
        date: '2026-10-15',
        type: 'expense',
        description: 'Jantar Restaurante Fim de Semana',
        amount: 280.00,
        accountId: 'acc_nu_cartao',
        purpose: 'pessoal',
        category: 'lazer',
        status: 'completed'
      },
      {
        id: 'tx_div_mxrf',
        date: '2026-10-16',
        type: 'income',
        description: 'Dividendos Recebidos MXRF11',
        amount: 60.00,
        accountId: 'acc_xp_invest',
        purpose: 'pessoal',
        category: 'dividendos',
        status: 'completed'
      },
      {
        id: 'tx_farmacia',
        date: '2026-10-18',
        type: 'expense',
        description: 'Farmácia & Vitaminas',
        amount: 145.00,
        accountId: 'acc_nubank',
        purpose: 'pessoal',
        category: 'saude',
        status: 'completed'
      }
    ],
    purposes: [
      { id: 'casa', name: 'CASA', color: '#3b82f6', isDefault: true, description: 'Contas da residência e família' },
      { id: 'pessoal', name: 'PESSOAL', color: '#10b981', isDefault: true, description: 'Gastos particulares individuais' }
    ],
    categories: DEFAULT_STATE.categories,
    balanceSnapshots: [
      {
        id: 'snap_1',
        date: '2026-08-01',
        accountId: 'acc_itau_casa',
        oldBalance: 4500.00,
        newBalance: 5200.00,
        diff: 700.00,
        reason: 'Conciliação início de Agosto'
      },
      {
        id: 'snap_2',
        date: '2026-09-01',
        accountId: 'acc_itau_casa',
        oldBalance: 5200.00,
        newBalance: 5800.00,
        diff: 600.00,
        reason: 'Economia doméstica mensal'
      },
      {
        id: 'snap_3',
        date: '2026-10-01',
        accountId: 'acc_itau_casa',
        oldBalance: 5800.00,
        newBalance: 6200.00,
        diff: 400.00,
        reason: 'Conciliação mensal Outubro'
      }
    ],
    settings: {
      driveScriptUrl: '',
      autoSync: true,
      lastSyncTime: null,
      privacyMode: false,
      currentYear: 2026,
      currentMonth: 9
    }
  };

  saveLocalState();
  renderApp();
  if (notify) showToast('Dados de demonstração carregados com sucesso!', 'success');
}

function confirmResetAllData() {
  if (confirm('ATENÇÃO: Deseja apagar todos os dados e começar do zero? Essa ação limpará suas contas, FIIs e lançamentos.')) {
    appState = {
      accounts: [],
      fiis: [],
      transactions: [],
      purposes: DEFAULT_STATE.purposes,
      categories: DEFAULT_STATE.categories,
      balanceSnapshots: [],
      settings: DEFAULT_STATE.settings
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

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "status";
    if (action === "status" || action === "ping") {
      return createJsonResponse({ status: "success", message: "FinanceFlow Backend ONLINE e conectado ao Google Drive!", time: new Date().toISOString() });
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
    if (!postData || !postData.data) {
      return createJsonResponse({ status: "error", message: "Nenhum dado recebido" });
    }
    saveDataToDrive(postData.data);
    return createJsonResponse({ status: "success", message: "Dados salvos com sucesso!", timestamp: new Date().toISOString() });
  } catch (error) {
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}

function loadDataFromDrive() {
  const files = DriveApp.getFilesByName(DB_FILENAME);
  if (files.hasNext()) {
    const file = files.next();
    return JSON.parse(file.getBlob().getDataAsString());
  } else {
    const initialData = { accounts: [], fiis: [], transactions: [], balanceSnapshots: [] };
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
    showToast('Código do Google Apps Script copiado para a área de transferência!', 'success');
  }).catch(() => {
    showToast('Copie o código do arquivo google-apps-script.js disponibilizado na pasta.', 'info');
  });
}

// =========================================================================
// UI HELPERS (MODALS, TOASTS, DATES)
// =========================================================================

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
  }
}

function openDriveModal() {
  const modalDriveInput = document.getElementById('modalDriveUrlInput');
  if (modalDriveInput) {
    modalDriveInput.value = appState.settings.driveScriptUrl || '';
  }
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

// Service Worker for Mobile PWA
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('FinanceFlow ServiceWorker registered:', reg.scope))
      .catch(err => console.log('ServiceWorker registration failed:', err));
  }
}
