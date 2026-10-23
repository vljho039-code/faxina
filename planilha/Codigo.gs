/**
 * Faxina — "backend" na Planilha do Google.
 *
 * Como usar (passo a passo completo no README):
 *  1. Crie uma planilha nova em sheets.google.com.
 *  2. Extensões > Apps Script. Apague o que estiver lá e cole este arquivo.
 *  3. Rode a função `configurar` uma vez (botão ▶). Ela cria as abas já preenchidas.
 *  4. Implantar > Nova implantação > App da Web
 *       Executar como: Eu  |  Quem pode acessar: Qualquer pessoa
 *  5. Copie a URL que termina em /exec e coloque no config.js do app.
 */

var FUSO = 'America/Sao_Paulo';

var ABAS = {
  Pessoas: [['Nome'], ['Gabriel'], ['Pietro'], ['Jhonathan'], ['Ryan'], ['Arthur']],
  Tarefas: [
    ['Tarefa', 'Dias'],
    ['Lavar a louça', 'Seg a Sex'],
    ['Tirar lixos', 'Seg a Sex'],
    ['Limpar as mesas', 'Seg a Sex'],
    ['Lavar quintal', 'Seg'],
    ['Passar pano na escada', 'Seg'],
    ['Lavar o banheiro', 'Ter']
  ],
  Ausencias: [['Nome', 'De', 'Até', 'Motivo']],
  Feriados: [
    ['Data', 'Descrição'],
    ['2026-11-02', 'Finados'],
    ['2026-11-20', 'Consciência Negra'],
    ['2026-12-25', 'Natal'],
    ['2027-01-01', 'Confraternização Universal'],
    ['2027-03-26', 'Sexta-feira Santa'],
    ['2027-04-21', 'Tiradentes'],
    ['2027-09-07', 'Independência'],
    ['2027-10-12', 'Nossa Senhora Aparecida'],
    ['2027-11-02', 'Finados'],
    ['2027-11-15', 'Proclamação da República']
  ],
  Substituicoes: [['Data', 'Faltou', 'Cobriu', 'Tarefa', 'Registrado em']],
  Config: [['Chave', 'Valor'], ['Inicio', '2026-10-26']]
};

/** Cria (ou completa) as abas. Pode rodar de novo: não apaga nada que já exista. */
function configurar() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  planilha.setSpreadsheetTimeZone(FUSO);
  Object.keys(ABAS).forEach(function (nome) {
    var aba = planilha.getSheetByName(nome);
    if (aba) return;
    aba = planilha.insertSheet(nome);
    var linhas = ABAS[nome];
    var largura = linhas[0].length;
    // Datas como texto, para não virarem outra coisa por causa de fuso/formato.
    aba.getRange(1, 1, 1000, largura).setNumberFormat('@');
    aba.getRange(1, 1, linhas.length, largura).setValues(linhas);
    aba.getRange(1, 1, 1, largura).setFontWeight('bold');
    aba.setFrozenRows(1);
    aba.autoResizeColumns(1, largura);
  });
  var padrao = planilha.getSheetByName('Página1') || planilha.getSheetByName('Sheet1');
  if (padrao && padrao.getLastRow() === 0 && planilha.getSheets().length > 1) planilha.deleteSheet(padrao);
}

function doGet() {
  return json(lerTudo());
}

// Corpo (texto JSON): { acao: 'substituicao', faltou, cobriu, tarefa }
function doPost(e) {
  var trava = LockService.getScriptLock();
  trava.waitLock(10000);
  try {
    var pedido = JSON.parse(e.postData.contents);
    if (pedido.acao !== 'substituicao') return json({ erro: 'Ação desconhecida.' });

    var dados = lerTudo();
    var hoje = dataTexto(new Date());
    if (dados.pessoas.indexOf(pedido.faltou) === -1 || dados.pessoas.indexOf(pedido.cobriu) === -1) {
      return json({ erro: 'Nome não encontrado na aba Pessoas.' });
    }
    if (pedido.faltou === pedido.cobriu) return json({ erro: 'A pessoa não pode cobrir a si mesma.' });
    var nomesTarefas = dados.tarefas.map(function (t) { return t.nome; });
    if (nomesTarefas.indexOf(pedido.tarefa) === -1) return json({ erro: 'Tarefa não encontrada.' });
    var repetida = dados.substituicoes.some(function (s) {
      return s.data === hoje && s.faltou === pedido.faltou && s.tarefa === pedido.tarefa;
    });
    if (repetida) return json({ erro: 'Essa substituição já foi registrada hoje.' });

    SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Substituicoes').appendRow([
      hoje, pedido.faltou, pedido.cobriu, pedido.tarefa,
      Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd HH:mm')
    ]);
    return json(lerTudo());
  } catch (erro) {
    return json({ erro: String(erro) });
  } finally {
    trava.releaseLock();
  }
}

function lerTudo() {
  var config = {};
  linhas('Config').forEach(function (l) { config[texto(l[0]).toLowerCase()] = l[1]; });
  return {
    inicio: dataTexto(config.inicio) || '2026-10-26',
    pessoas: linhas('Pessoas').map(function (l) { return texto(l[0]); }).filter(Boolean),
    tarefas: linhas('Tarefas').filter(function (l) { return texto(l[0]); })
      .map(function (l) { return { nome: texto(l[0]), dias: texto(l[1]) }; }),
    ausencias: linhas('Ausencias').filter(function (l) { return texto(l[0]) && dataTexto(l[1]); })
      .map(function (l) {
        return { nome: texto(l[0]), de: dataTexto(l[1]), ate: dataTexto(l[2]) || dataTexto(l[1]), motivo: texto(l[3]) };
      }),
    feriados: linhas('Feriados').filter(function (l) { return dataTexto(l[0]); })
      .map(function (l) { return { data: dataTexto(l[0]), descricao: texto(l[1]) || 'Feriado' }; }),
    substituicoes: linhas('Substituicoes').filter(function (l) { return dataTexto(l[0]); })
      .map(function (l) {
        return { data: dataTexto(l[0]), faltou: texto(l[1]), cobriu: texto(l[2]), tarefa: texto(l[3]) };
      }),
    hoje: dataTexto(new Date())
  };
}

function linhas(nomeAba) {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nomeAba);
  if (!aba || aba.getLastRow() < 2) return [];
  return aba.getRange(2, 1, aba.getLastRow() - 1, aba.getLastColumn()).getValues();
}

function texto(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

// Aceita Date, 'AAAA-MM-DD' ou 'DD/MM/AAAA' e devolve 'AAAA-MM-DD'.
function dataTexto(v) {
  if (v instanceof Date) return Utilities.formatDate(v, FUSO, 'yyyy-MM-dd');
  var s = texto(v), m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + '-' + dois(m[2]) + '-' + dois(m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return m[3] + '-' + dois(m[2]) + '-' + dois(m[1]);
  return '';
}

function dois(n) { return ('0' + n).slice(-2); }

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
