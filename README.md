# 🚀 FinanceFlow - Sistema de Controle Financeiro & FIIs com Google Drive

Sistema completo e moderno de controle financeiro pessoal e investimentos em Fundos Imobiliários (FIIs), com suporte para funcionar em **qualquer lugar (computador, tablet ou smartphone)** e salvar seu banco de dados diretamente no seu **Google Drive**.

Inspirado nas interfaces mais recentes do mercado fintech (como Nubank, Revolut e Apple Wallet), com modo escuro premium, gráficos dinâmicos e experiência nativa em dispositivos móveis.

---

## 🌟 Principais Recursos

### 1. 🏦 Gestão de Contas Bancárias & Cartões
- **Múltiplos Bancos com Identidade Visual**: Pré-configurado com as cores e marcas dos principais bancos brasileiros (Nubank, Itaú, Inter, Bradesco, Santander, Banco do Brasil, Caixa, C6 Bank, BTG Pactual, XP Investimentos, Dinheiro/Carteira ou outros).
- **Tipos de Conta**:
  - Conta Corrente
  - Cartão de Crédito (com limite, dia de fechamento, dia de vencimento e controle da fatura atual a vencer)
  - Conta Poupança / Reserva de Emergência
  - Conta de Investimentos / Corretora
  - Dinheiro Físico em Espécie
- **Definições de Finalidade (CASA, PESSOAL ou Novas)**:
  - Classifique cada conta ou despesa como **CASA** (gastos residenciais e familiares) ou **PESSOAL** (gastos individuais).
  - Crie **novas definições personalizadas** (ex: *EMPRESA*, *VIAGENS*, *FILHOS*, *RESERVA*) com cores próprias.
  - Filtre toda a aplicação (dashboard, contas e extrato) por finalidade em um clique.
- **Ajuste de Saldo & Histórico de Evolução**:
  - Ajuste o saldo de qualquer conta a qualquer momento para conciliação bancária.
  - O sistema registra um **snapshot histórico** com: data, saldo anterior, novo saldo, variação e motivo do ajuste, permitindo acompanhar a evolução do patrimônio ao longo do tempo.
- **Total Geral Consolidado**: Mostra o saldo líquido total somando contas correntes e FIIs e deduzindo as faturas de cartões a pagar.

### 2. 🏢 Carteira de FIIs (Fundos Imobiliários)
- Acompanhamento de cotas, preço médio pago, cotação atual de mercado e último provento recebido por cota.
- **Cálculos Automáticos em Tempo Real**:
  - Valor Total Investido (`cotas × preço médio`)
  - Valor Atual de Mercado (`cotas × cotação`)
  - Lucro / Prejuízo em R$ e em %
  - Renda Passiva Mensal Estimada em dividendos
  - Dividend Yield Mensal e Anualizado
  - Diversificação da carteira por FII e por Segmento (Papel, Tijolo - Logística, Shopping, Lajes Corporativas, etc.).

### 3. 💳 Despesas, Receitas & Transferências (Extrato)
- CRUD completo (Adicionar, Editar, Excluir) de lançamentos.
- Especifique com precisão se a despesa veio de uma **determinada conta corrente** ou de um **determinado cartão de crédito**.
- Status dinâmico: alterne entre **✓ Concluído** e **⏳ Pendente** com 1 toque.
- Transferências entre contas com atualização automática de ambos os saldos.
- Filtros avançados por mês/ano, tipo, finalidade, conta e situação.

### 4. 📈 Gráficos de Evolução & Relatórios Visuais
- Gráfico de linha suave com gradiente da **Evolução Patrimonial ao Longo do Tempo**.
- Gráfico de **Despesas por Categoria** (rosca interativa com percentuais).
- Gráfico comparativo de **Gastos: CASA vs PESSOAL**.
- Gráfico de **Evolução de Saldo por Conta Bancária**.
- Gráfico de **Receitas vs Despesas** dos últimos 6 meses.
- Botão de **Modo Privacidade (Olho)** para ocultar valores sensíveis ao usar o app em público.

---

## ☁️ Como Conectar ao seu Google Drive (Banco de Dados na Nuvem)

Você pode usar o aplicativo no seu computador e no seu celular compartilhando a mesma base de dados salva no seu **Google Drive pessoal**, de forma 100% gratuita e privada, usando o **Google Apps Script**:

### Passo a Passo (Leva menos de 2 minutos):
1. Acesse **[script.google.com](https://script.google.com)** com sua conta Google.
2. Clique no botão **"+ Novo projeto"**.
3. Apague o código padrão que estiver no editor.
4. Abra o arquivo **`google-apps-script.js`** (já criado na pasta do projeto) ou clique no botão *"Copiar Código do Script"* nas configurações do FinanceFlow, e cole todo o código no editor do Google Apps Script.
5. Clique em **"Implantar"** (canto superior direito) ➔ **"Nova implantação"**.
6. Clique na **engrenagem** ao lado de "Selecione o tipo" e escolha **"App da Web"**.
7. Preencha as configurações:
   - **Descrição**: `Produção FinanceFlow`
   - **Executar como**: `Eu (seu-email@gmail.com)`
   - **Quem pode acessar**: `Qualquer pessoa` *(necessário para que seu celular consiga se comunicar com seu Drive)*
8. Clique em **"Implantar"**, autorize o acesso à sua conta Google e copie o **URL do App da Web** (que termina com `/exec`).
9. No FinanceFlow, abra a aba **Nuvem & Ajustes** (ou clique no card de status da nuvem), cole a URL copiada e clique em **"Salvar URL & Sincronizar"**.

> 💡 **Nota**: O script criará automaticamente um arquivo chamado `FinanceFlow_Database.json` na raiz do seu Google Drive. Seus dados nunca passam por servidores de terceiros!

---

## 📱 Como Acessar e Alimentar os Dados pelo Celular

O FinanceFlow foi construído com design **Mobile-First** e suporte a **PWA (Progressive Web App)**:

1. **Opção 1: Hospedar gratuitamente no GitHub Pages, Vercel ou Netlify**
   - Suba os arquivos desta pasta para um repositório no GitHub.
   - Ative o **GitHub Pages** (Settings ➔ Pages ➔ Source: main branch).
   - Abra o link gerado no navegador do seu celular (Chrome no Android ou Safari no iPhone).
   - No Chrome: toque nos 3 pontinhos ➔ **"Adicionar à tela inicial"** ou **"Instalar aplicativo"**.
   - No Safari: toque no botão de compartilhar (quadrado com seta) ➔ **"Adicionar à Tela de Início"**.
   - Ele se comportará como um aplicativo nativo instalado, sem barra de endereços do navegador!

2. **Opção 2: Rede Local Wi-Fi**
   - Inicie um servidor local na pasta do projeto executando `npx serve .` ou `python -m http.server 8080`.
   - Acesse pelo IP local do seu computador no navegador do celular (ex: `http://192.168.1.50:8080`).

---

## 💾 Backup e Segurança
- Além do Google Drive, você pode a qualquer momento clicar em **"Exportar Arquivo de Backup (JSON)"** para salvar uma cópia local de segurança dos seus dados no computador ou celular.
- É possível restaurar qualquer backup JSON anterior na aba **Nuvem & Ajustes**.
- Funciona perfeitamente offline: todas as alterações são gravadas instantaneamente no `localStorage` do seu navegador e enviadas para o Google Drive assim que houver conexão.
