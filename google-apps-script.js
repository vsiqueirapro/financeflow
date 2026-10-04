/**
 * =========================================================================
 * FINANCEFLOW - BACKEND DO GOOGLE DRIVE (GOOGLE APPS SCRIPT)
 * =========================================================================
 * Este script roda gratuitamente nos servidores do Google e atua como seu
 * banco de dados na nuvem, salvando e carregando os dados do FinanceFlow
 * diretamente no seu Google Drive pessoal.
 * =========================================================================
 */

const DB_FILENAME = "FinanceFlow_Database.json";

// =========================================================================
// CHAVE DE SEGURANÇA / SENHA SECRETA (OPCIONAL)
// Para blindagem total: se você definir uma senha aqui (ex: "MinhaSenha@123"),
// ninguém conseguirá ler ou salvar dados sem enviar essa mesma senha no app.
// Deixe vazio ("") para permitir acesso apenas com a sua URL secreta de 70 caracteres.
// =========================================================================
const API_SECRET_TOKEN = ""; 

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "status";

    // Se o usuário abrir o link direto no navegador (sem parâmetros), mostra tela de confirmação de status
    if (action === "status") {
      const isProtected = API_SECRET_TOKEN && API_SECRET_TOKEN.trim().length > 0;
      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>FinanceFlow Backend - Conectado</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 36px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); max-width: 480px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            .badge { display: inline-block; background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3); padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 14px; margin-bottom: 16px; }
            h2 { margin: 0 0 10px; font-size: 24px; }
            p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin-bottom: 20px; }
            .box { background: #0b1120; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 13px; color: #38bdf8; word-break: break-all; margin-bottom: 16px; text-align: left; }
            .security-pill { display: inline-block; font-size: 12px; padding: 4px 10px; border-radius: 6px; background: rgba(99,102,241,0.15); color: #a5b4fc; border: 1px solid rgba(99,102,241,0.3); margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="card">
            <span class="badge">● ONLINE & CONECTADO</span>
            <h2>Backend do FinanceFlow Ativo!</h2>
            <p>Seu servidor pessoal no Google Drive está funcionando perfeitamente e pronto para sincronizar seus dados do computador e celular.</p>
            <div class="box">Arquivo no Google Drive: <strong>FinanceFlow_Database.json</strong></div>
            <div class="security-pill">${isProtected ? '🔒 Proteção por Senha Ativada' : '🔑 Protegido por URL Secreta Criptografada'}</div>
            <p style="font-size: 12px; color: #64748b; margin-top: 16px;">Para conectar, certifique-se de copiar o <strong>URL do App da Web</strong> (que termina com <strong>/exec</strong>) e colar no aplicativo FinanceFlow.</p>
          </div>
        </body>
        </html>
      `;
      return HtmlService.createHtmlOutput(html).setTitle("FinanceFlow Backend Ativo");
    }

    // Validação de token se configurado
    if (!isAuthorized(e, null)) {
      return createJsonResponse({ status: "error", message: "Acesso não autorizado: chave de segurança incorreta ou não fornecida." });
    }

    if (action === "ping") {
      return createJsonResponse({ status: "ok", message: "Conexão com Google Drive ativa!", time: new Date().toISOString() });
    }

    if (action === "load") {
      const data = loadDataFromDrive();
      return createJsonResponse({ status: "success", data: data });
    }

    // Suporte a salvamento via GET (útil para contornar qualquer restrição CORS em navegadores móveis)
    if (action === "save" && e.parameter.payload) {
      const payloadString = Utilities.newBlob(Utilities.base64Decode(e.parameter.payload)).getDataAsString();
      const jsonData = JSON.parse(payloadString);
      saveDataToDrive(jsonData);
      return createJsonResponse({ status: "success", message: "Salvo com sucesso no Google Drive", timestamp: new Date().toISOString() });
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

    // Validação de token se configurado
    if (!isAuthorized(e, postData)) {
      return createJsonResponse({ status: "error", message: "Acesso não autorizado: chave de segurança incorreta ou não fornecida." });
    }

    if (!postData || !postData.data) {
      return createJsonResponse({ status: "error", message: "Nenhum dado recebido no payload" });
    }

    saveDataToDrive(postData.data);

    return createJsonResponse({
      status: "success",
      message: "Dados salvos com sucesso no seu Google Drive!",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}

function isAuthorized(e, postData) {
  if (!API_SECRET_TOKEN || API_SECRET_TOKEN.trim() === "") {
    return true; // Sem senha configurada, confia na URL secreta criptografada
  }
  const tokenFromGet = e && e.parameter ? e.parameter.token : null;
  const tokenFromPost = postData ? postData.token : null;
  return tokenFromGet === API_SECRET_TOKEN || tokenFromPost === API_SECRET_TOKEN;
}

/**
 * Carrega o arquivo JSON do Google Drive
 */
function loadDataFromDrive() {
  const files = DriveApp.getFilesByName(DB_FILENAME);
  if (files.hasNext()) {
    const file = files.next();
    const content = file.getBlob().getDataAsString();
    try {
      const parsed = JSON.parse(content);
      if (!parsed.cards) parsed.cards = [];
      if (!parsed.accounts) parsed.accounts = [];
      if (!parsed.fiis) parsed.fiis = [];
      if (!parsed.transactions) parsed.transactions = [];
      if (!parsed.balanceSnapshots) parsed.balanceSnapshots = [];
      return parsed;
    } catch (e) {
      return createInitialData();
    }
  } else {
    return createInitialData();
  }
}

function createInitialData() {
  const initialData = {
    accounts: [],
    cards: [],
    fiis: [],
    transactions: [],
    purposes: [
      { id: "casa", name: "CASA", color: "#3b82f6", description: "Despesas e contas da residência / família" },
      { id: "pessoal", name: "PESSOAL", color: "#10b981", description: "Gastos e contas particulares e individuais" }
    ],
    categories: [],
    balanceSnapshots: [],
    lastUpdated: new Date().toISOString()
  };
  saveDataToDrive(initialData);
  return initialData;
}

/**
 * Salva ou atualiza o arquivo JSON no Google Drive
 */
function saveDataToDrive(jsonData) {
  jsonData.lastUpdated = new Date().toISOString();
  const jsonString = JSON.stringify(jsonData, null, 2);
  const files = DriveApp.getFilesByName(DB_FILENAME);
  
  if (files.hasNext()) {
    const file = files.next();
    file.setContent(jsonString);
  } else {
    DriveApp.createFile(DB_FILENAME, jsonString, MimeType.PLAIN_TEXT);
  }
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
