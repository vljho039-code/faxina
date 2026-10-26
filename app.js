(function () {
  'use strict';

  var CFG = window.FAXINA_CONFIG;
  var R = window.Rotacao;
  var DEMO = !CFG.API_URL;
  var CHAVE_NOME = 'faxina:nome', CHAVE_DADOS = 'faxina:dados', CHAVE_DEMO = 'faxina:demo-subs';
  var CHAVE_ADMIN = 'faxina:admin';

  var app = document.getElementById('app');
  var modal = document.getElementById('modal');
  var estado = { dados: null, tela: 'inicio', atualizadoEm: null, erro: null };

  // ---------- armazenamento local (sempre protegido) ----------
  function ler(chave) {
    try { return JSON.parse(localStorage.getItem(chave)); } catch (e) { return null; }
  }
  function gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem espaço/privado */ }
  }

  // ---------- datas ----------
  function hoje() {
    var teste = new URLSearchParams(location.search).get('hoje');
    if (teste && /^\d{4}-\d{2}-\d{2}$/.test(teste)) return teste;
    return new Intl.DateTimeFormat('en-CA', { timeZone: CFG.FUSO }).format(new Date());
  }
  function dataBonita(s, comDia) {
    var p = s.split('-');
    var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
    var semana = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(dt).replace('-feira', '');
    var dm = p[2] + '/' + p[1];
    return comDia === false ? dm : semana + ', ' + dm;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- dados ----------
  function carregar() {
    if (DEMO) {
      var d = JSON.parse(JSON.stringify(CFG.DEMO));
      d.substituicoes = ler(CHAVE_DEMO) || [];
      definirDados(d);
      return Promise.resolve();
    }
    return fetch(CFG.API_URL, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.erro) throw new Error(d.erro);
        definirDados(d);
        gravar(CHAVE_DADOS, { dados: d, em: Date.now() });
      })
      .catch(function () {
        estado.erro = 'Sem conexão. Mostrando a última versão salva.';
        render();
      });
  }

  function definirDados(d, forcar) {
    estado.dados = d;
    estado.atualizadoEm = Date.now();
    estado.erro = null;
    if (estado.tela !== 'admin' || forcar) render();
  }

  // POST para o Apps Script. text/plain evita a checagem CORS que ele não responde.
  function post(pedido) {
    return fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(pedido)
    })
      .then(function (r) { return r.json(); }, function () { throw new Error('Sem conexão. Verifique a internet.'); })
      .then(function (d) {
        if (d.erro) {
          var e = new Error(d.erro);
          e.sessao = d.sessao;
          throw e;
        }
        return d;
      });
  }

  function registrarSubstituicao(faltou, tarefa) {
    var pedido = { acao: 'substituicao', faltou: faltou, cobriu: eu(), tarefa: tarefa };
    if (DEMO) {
      var subs = ler(CHAVE_DEMO) || [];
      subs.push({ data: hoje(), faltou: faltou, cobriu: eu(), tarefa: tarefa });
      gravar(CHAVE_DEMO, subs);
      return carregar();
    }
    return post(pedido).then(function (d) {
      definirDados(d);
      gravar(CHAVE_DADOS, { dados: d, em: Date.now() });
    });
  }

  function eu() { return ler(CHAVE_NOME); }

  // ---------- cálculo ----------
  function calcular() {
    var d = estado.dados, h = hoje();
    var futuro = R.simular(d, R.somaDias(h, 21));
    var ateHoje = R.simular(d, h);
    return { hoje: h, futuro: futuro, dividas: ateHoje.dividas, dia: R.doDia(futuro, h, eu()) };
  }

  function proximoDia(c) {
    return c.futuro.dias.filter(function (d) { return d.data > c.hoje && !d.feriado && d.itens.length; })[0];
  }

  // Texto extra de um item (pagamento de dívida, cobertura...).
  function etiqueta(it, nomeDe) {
    var m = it.motivo;
    if (!m) return '';
    if (m.tipo === 'pagamento') return 'pagando a dívida com ' + m.credor;
    if (m.tipo === 'recebeu') return m.devedor + ' está pagando a dívida' + (nomeDe === 'eu' ? ' com você' : '');
    if (m.tipo === 'cobriu') return 'no lugar de ' + m.faltou;
    return '';
  }

  // ---------- telas ----------
  function render() {
    if (!estado.dados) { app.innerHTML = '<p class="carregando">Carregando…</p>'; return; }
    if (estado.tela === 'admin' && ler(CHAVE_ADMIN)) return telaAdmin();
    var nome = eu();
    if (!nome || estado.dados.pessoas.indexOf(nome) === -1) return telaNome();
    if (estado.tela === 'detalhes') return telaDetalhes();
    telaInicio();
  }

  function telaNome() {
    app.innerHTML =
      '<section class="boas-vindas">' +
      '<h1>Quem é você?</h1>' +
      '<p>Escolha seu nome. Só precisa fazer isso uma vez neste celular.</p>' +
      '<div class="lista-nomes">' +
      estado.dados.pessoas.map(function (p) {
        return '<button type="button" data-nome="' + esc(p) + '">' + esc(p) + '</button>';
      }).join('') +
      '</div></section>';
    app.querySelectorAll('[data-nome]').forEach(function (b) {
      b.onclick = function () { gravar(CHAVE_NOME, b.dataset.nome); estado.tela = 'inicio'; render(); };
    });
  }

  function linhasTarefa(itens) {
    return itens.map(function (it) {
      var folga = it.tarefa === R.FOLGA;
      var txt = folga ? 'Folga 🎉' : it.tarefa;
      var et = etiqueta(it, 'eu');
      return '<p class="tarefa' + (folga ? ' folga' : '') + '">' + esc(txt) + '</p>' +
        (et ? '<p class="obs">' + esc(et) + '</p>' : '');
    }).join('');
  }

  function telaInicio() {
    var c = calcular(), nome = eu(), corpo = '', aviso = '';
    var inicio = estado.dados.inicio;

    if (c.hoje < inicio) {
      var primeiro = c.futuro.dias.filter(function (d) { return d.itens.length; })[0];
      var meu = primeiro && R.doDia(c.futuro, primeiro.data, nome);
      corpo = '<p class="tarefa folga">Ainda não começou</p>' +
        '<p class="obs">A rotação começa ' + esc(dataBonita(inicio)) + '.' +
        (meu && meu.itens.length ? ' Sua primeira: <strong>' + esc(meu.itens.map(function (i) { return i.tarefa; }).join(' + ')) + '</strong>.' : '') + '</p>';
    } else if (!c.dia || c.dia.feriado) {
      var prox = proximoDia(c);
      var meuProx = prox && R.doDia(c.futuro, prox.data, nome);
      corpo = '<p class="tarefa folga">' + (c.dia && c.dia.feriado ? esc(c.dia.feriado) : 'Sem faxina hoje') + '</p>' +
        (meuProx ? '<p class="obs">' + esc(dataBonita(prox.data)) + ': <strong>' +
          esc(meuProx.ausente ? 'ausente' : meuProx.itens.map(function (i) { return i.tarefa; }).join(' + ')) + '</strong></p>' : '');
    } else if (c.dia.ausente) {
      corpo = '<p class="tarefa folga">Você está ausente hoje</p><p class="obs">Sem tarefa e sem dívida.</p>';
    } else {
      corpo = linhasTarefa(c.dia.itens);
      if (c.dia.cobriramMeu.length) {
        aviso = c.dia.cobriramMeu.map(function (it) {
          return '<div class="aviso"><strong>' + esc(it.pessoa) + '</strong> fez “' + esc(it.tarefa) +
            '” no seu lugar. Você fica devendo 1 tarefa.</div>';
        }).join('');
      }
    }

    var tema = TEMAS[temaAtual()];
    app.innerHTML =
      '<div class="topo"><span class="data">' + esc(dataBonita(c.hoje)) + '</span>' +
      '<span class="direita"><button type="button" class="botao-tema" id="tema" aria-label="Tema: ' + tema.nome +
      '" title="Tema: ' + tema.nome + '">' + tema.icone + '</button>' +
      '<button type="button" class="botao-detalhes" id="ir-detalhes">Rotação ›</button></span></div>' +
      '<section class="principal"><p class="nome">' + esc(nome) + '</p>' + corpo + aviso + '</section>' +
      (estado.erro ? '<p class="demo">' + esc(estado.erro) + '</p>' : '') +
      (DEMO ? '<p class="demo">Modo demonstração: as trocas ficam só neste celular.</p>' : '');
    document.getElementById('ir-detalhes').onclick = function () { estado.tela = 'detalhes'; render(); window.scrollTo(0, 0); };
    document.getElementById('tema').onclick = function () {
      var ordem = ['auto', 'light', 'dark'];
      aplicarTema(ordem[(ordem.indexOf(temaAtual()) + 1) % ordem.length]);
      render();
    };
  }

  // ---------- tema (automático / claro / escuro) ----------
  var TEMAS = {
    auto: { icone: '🌗', nome: 'automático' },
    light: { icone: '☀️', nome: 'claro' },
    dark: { icone: '🌙', nome: 'escuro' }
  };
  function temaAtual() {
    var t = document.documentElement.dataset.theme;
    return t === 'light' || t === 'dark' ? t : 'auto';
  }
  function aplicarTema(t) {
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try { if (t === 'auto') localStorage.removeItem('faxina:tema'); else localStorage.setItem('faxina:tema', t); } catch (e) { /* privado */ }
  }

  function linhasDia(dia, nome) {
    if (dia.feriado) return '<div class="vazio">Feriado: ' + esc(dia.feriado) + '</div>';
    if (!dia.itens.length) return '<div class="vazio">Ninguém escalado.</div>';
    var ordem = estado.dados.pessoas;
    var porPessoa = {};
    dia.itens.forEach(function (it) { (porPessoa[it.pessoa] = porPessoa[it.pessoa] || []).push(it); });
    return ordem.map(function (p) {
      var itens = porPessoa[p];
      var cobertoPor = dia.itens.filter(function (it) {
        return it.motivo && it.motivo.tipo === 'cobriu' && it.motivo.faltou === p;
      }).map(function (it) { return it.pessoa; });
      var oque = itens ? itens.map(function (it) {
        var et = etiqueta(it, p === nome ? 'eu' : 'outro');
        return esc(it.tarefa) + (et ? '<span class="tag">' + esc(et) + '</span>' : '');
      }).join('<br>') : cobertoPor.length
        ? '—<span class="tag">coberto por ' + esc(cobertoPor.join(' e ')) + '</span>'
        : '<span class="tag">ausente</span>';
      return '<div class="linha' + (p === nome ? ' eu' : '') + '"><span class="quem">' + esc(p) +
        '</span><span class="oque">' + oque + '</span></div>';
    }).join('');
  }

  function telaDetalhes() {
    var c = calcular(), nome = eu();
    var diaHoje = c.futuro.dias.filter(function (d) { return d.data === c.hoje; })[0];
    var proximos = c.futuro.dias.filter(function (d) { return d.data > c.hoje; }).slice(0, 5);

    var dividas = {};
    c.dividas.forEach(function (d) {
      var k = d.devedor + '→' + d.credor;
      dividas[k] = dividas[k] || { devedor: d.devedor, credor: d.credor, n: 0 };
      dividas[k].n++;
    });
    var listaDividas = Object.keys(dividas).map(function (k) {
      var d = dividas[k], minha = d.devedor === nome || d.credor === nome;
      var devedor = d.devedor === nome ? 'Você' : d.devedor;
      var credor = d.credor === nome ? 'você' : d.credor;
      return '<div class="linha' + (minha ? ' eu' : '') + '"><span class="quem">' + esc(devedor) + '</span>' +
        '<span class="oque">deve ' + d.n + ' tarefa' + (d.n > 1 ? 's' : '') + ' para ' + esc(credor) + '</span></div>';
    }).join('');

    var possoCobrir = diaHoje && !diaHoje.feriado && diaHoje.presentes.indexOf(nome) !== -1 && opcoesCobrir(diaHoje).length;

    app.innerHTML =
      '<div class="cabecalho"><button type="button" class="voltar" id="voltar" aria-label="Voltar">‹</button><h1>Rotação</h1></div>' +
      '<h2>Hoje · ' + esc(dataBonita(c.hoje)) + '</h2>' +
      '<div class="cartao">' + (diaHoje ? linhasDia(diaHoje, nome) : '<div class="vazio">Sem faxina hoje.</div>') + '</div>' +
      '<h2>Próximos dias</h2>' +
      '<div class="cartao">' + proximos.map(function (d) {
        return '<div class="dia-titulo">' + esc(dataBonita(d.data)) + '</div>' + linhasDia(d, nome);
      }).join('') + '</div>' +
      '<p class="nota">A previsão muda se alguém faltar ou for cobrir outra pessoa.</p>' +
      '<h2>Dívidas</h2>' +
      '<div class="cartao">' + (listaDividas || '<div class="vazio">Ninguém deve nada. 👌</div>') + '</div>' +
      '<div class="acoes">' +
      '<button type="button" class="botao" id="cobrir"' + (possoCobrir ? '' : ' disabled') + '>Fiz no lugar de…</button>' +
      '<button type="button" class="botao secundario" id="trocar">Não sou ' + esc(nome) + ' · trocar nome</button>' +
      (ler(CHAVE_ADMIN) ? '<button type="button" class="botao secundario" id="painel">⚙️ Painel admin</button>' : '') +
      '</div>' +
      '<p class="rodape">' + (estado.erro ? esc(estado.erro) + ' · ' : '') +
      (estado.atualizadoEm ? 'Atualizado às ' + new Date(estado.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' · ' : '') +
      '<button type="button" id="atualizar">Atualizar</button>' +
      (ler(CHAVE_ADMIN) ? '' : ' · <button type="button" id="entrar-admin">Admin</button>') + '</p>';

    document.getElementById('voltar').onclick = function () { estado.tela = 'inicio'; render(); };
    document.getElementById('trocar').onclick = function () { gravar(CHAVE_NOME, null); render(); };
    document.getElementById('atualizar').onclick = function () { app.querySelector('.rodape').textContent = 'Atualizando…'; carregar(); };
    document.getElementById('cobrir').onclick = function () { abrirCobrir(diaHoje); };
    var painel = document.getElementById('painel');
    if (painel) painel.onclick = function () { irAdmin(); };
    var entrar = document.getElementById('entrar-admin');
    if (entrar) entrar.onclick = abrirLogin;
  }

  function opcoesCobrir(dia) {
    var nome = eu();
    return dia.itens.filter(function (it) {
      return it.pessoa !== nome && it.tarefa !== R.FOLGA && !(it.motivo && it.motivo.tipo === 'cobriu');
    });
  }

  // ---------- modal "Fiz no lugar de…" ----------
  function abrirCobrir(dia) {
    var opcoes = opcoesCobrir(dia);
    modal.innerHTML =
      '<h3>Fiz no lugar de…</h3><p>Escolha a tarefa que você fez hoje por outra pessoa.</p>' +
      '<div class="opcoes">' + opcoes.map(function (it, i) {
        return '<button type="button" data-i="' + i + '"><strong>' + esc(it.pessoa) + '</strong><small>' + esc(it.tarefa) + '</small></button>';
      }).join('') + '</div>' +
      '<button type="button" class="botao secundario" id="cancelar" style="width:100%">Cancelar</button>';
    modal.querySelectorAll('[data-i]').forEach(function (b) {
      b.onclick = function () { confirmar(opcoes[+b.dataset.i]); };
    });
    modal.querySelector('#cancelar').onclick = function () { modal.close(); };
    modal.showModal();
  }

  function confirmar(it) {
    modal.innerHTML =
      '<h3>Confirmar</h3><p>Você fez <strong>' + esc(it.tarefa) + '</strong> no lugar de <strong>' + esc(it.pessoa) +
      '</strong> hoje. ' + esc(it.pessoa) + ' vai ficar devendo 1 tarefa para você.</p>' +
      '<div class="acoes" style="margin-top:0">' +
      '<button type="button" class="botao" id="sim">Confirmar</button>' +
      '<button type="button" class="botao secundario" id="nao">Voltar</button></div>';
    modal.querySelector('#nao').onclick = function () { modal.close(); };
    modal.querySelector('#sim').onclick = function () {
      var b = this;
      b.disabled = true; b.textContent = 'Salvando…';
      registrarSubstituicao(it.pessoa, it.tarefa).then(function () {
        modal.close();
      }).catch(function (e) {
        b.disabled = false; b.textContent = 'Tentar de novo';
        var p = modal.querySelector('.erro') || modal.insertBefore(document.createElement('p'), modal.querySelector('.acoes'));
        p.className = 'erro';
        p.textContent = e.message || 'Não foi possível salvar. Verifique a internet.';
      });
    };
  }

  // ---------- admin: login ----------
  function abrirLogin() {
    if (DEMO) {
      modal.innerHTML = '<h3>Admin</h3><p>O painel de admin só funciona com a planilha do Google conectada ' +
        '(ela é quem guarda a senha e salva as mudanças para todos).</p>' +
        '<button type="button" class="botao secundario" id="ok" style="width:100%">Entendi</button>';
      modal.querySelector('#ok').onclick = function () { modal.close(); };
      return modal.showModal();
    }
    modal.innerHTML =
      '<h3>Entrar como admin</h3>' +
      '<form id="form-login" class="formulario">' +
      '<label>Usuário<input name="usuario" autocomplete="username" autocapitalize="none" required></label>' +
      '<label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>' +
      '<p class="erro" hidden></p>' +
      '<div class="acoes" style="margin-top:4px">' +
      '<button class="botao" type="submit">Entrar</button>' +
      '<button class="botao secundario" type="button" id="cancelar">Cancelar</button></div></form>';
    var form = modal.querySelector('#form-login');
    modal.querySelector('#cancelar').onclick = function () { modal.close(); };
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var b = form.querySelector('[type=submit]'), erro = form.querySelector('.erro');
      b.disabled = true; b.textContent = 'Entrando…'; erro.hidden = true;
      post({ acao: 'login', usuario: form.usuario.value, senha: form.senha.value }).then(function (d) {
        gravar(CHAVE_ADMIN, d.token);
        modal.close();
        irAdmin();
      }).catch(function (e) {
        b.disabled = false; b.textContent = 'Entrar';
        erro.textContent = e.message; erro.hidden = false;
      });
    };
    modal.showModal();
    form.usuario.focus();
  }

  function irAdmin() {
    estado.tela = 'admin';
    render();
    window.scrollTo(0, 0);
  }

  function sairAdmin() {
    var token = ler(CHAVE_ADMIN);
    gravar(CHAVE_ADMIN, null);
    if (token && !DEMO) post({ acao: 'sair', token: token }).catch(function () {});
    estado.tela = 'detalhes';
    render();
  }

  // Salva uma aba inteira na planilha e redesenha o painel com o resultado.
  function salvar(aba, linhas, botao) {
    if (botao) { botao.disabled = true; botao.dataset.texto = botao.textContent; botao.textContent = '…'; }
    return post({ acao: 'salvar', token: ler(CHAVE_ADMIN), aba: aba, linhas: linhas }).then(function (d) {
      gravar(CHAVE_DADOS, { dados: d.dados, em: Date.now() });
      definirDados(d.dados, true);
      aviso('Salvo ✓');
    }).catch(erroAdmin(botao));
  }

  function erroAdmin(botao) {
    return function (e) {
      if (botao) { botao.disabled = false; botao.textContent = botao.dataset.texto || botao.textContent; }
      if (e.sessao === false) { gravar(CHAVE_ADMIN, null); estado.tela = 'detalhes'; render(); }
      aviso(e.message, true);
    };
  }

  var avisoTimer;
  function aviso(msg, erro) {
    var el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.className = 'toast' + (erro ? ' toast-erro' : '') + ' visivel';
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { el.className = el.className.replace(' visivel', ''); }, erro ? 5000 : 2000);
  }

  // ---------- admin: painel ----------
  var OPCOES_DIAS = ['Seg a Sex', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex'];

  function linhaAdmin(principal, secundario, i, grupo) {
    return '<div class="linha linha-admin"><span class="quem">' + esc(principal) +
      (secundario ? '<span class="sub">' + esc(secundario) + '</span>' : '') + '</span>' +
      '<button type="button" class="remover" data-grupo="' + grupo + '" data-i="' + i + '" aria-label="Remover ' + esc(principal) + '">✕</button></div>';
  }

  function opcoes(lista, sel) {
    return lista.map(function (v) {
      return '<option' + (v === sel ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  }

  function telaAdmin() {
    var d = estado.dados, h = hoje();
    var feriados = d.feriados.slice().sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    var ausencias = d.ausencias.slice().sort(function (a, b) { return a.de < b.de ? -1 : 1; });
    var trocas = d.substituicoes.map(function (s, i) { return { s: s, i: i }; }).reverse().slice(0, 30);

    app.innerHTML =
      '<div class="cabecalho"><button type="button" class="voltar" id="voltar" aria-label="Voltar">‹</button><h1>Painel admin</h1></div>' +

      '<h2>Pessoas</h2><div class="cartao">' +
      (d.pessoas.map(function (p, i) { return linhaAdmin(p, '', i, 'pessoa'); }).join('') || '<div class="vazio">Ninguém.</div>') +
      '</div><form class="adicionar" id="add-pessoa"><input name="nome" placeholder="Nome" required maxlength="40">' +
      '<button class="botao" type="submit">Adicionar</button></form>' +

      '<h2>Tarefas</h2><div class="cartao">' +
      (d.tarefas.map(function (t, i) { return linhaAdmin(t.nome, t.dias || 'Seg a Sex', i, 'tarefa'); }).join('') || '<div class="vazio">Nenhuma tarefa.</div>') +
      '</div><form class="adicionar" id="add-tarefa"><input name="nome" placeholder="Nova tarefa" required maxlength="60">' +
      '<select name="dias" aria-label="Dias">' + opcoes(OPCOES_DIAS, 'Seg a Sex') + '</select>' +
      '<button class="botao" type="submit">Adicionar</button></form>' +
      '<p class="nota">Mudar pessoas ou tarefas recalcula a escala desde o início. Se for mudar, atualize também o início da rotação para hoje ou a próxima segunda.</p>' +

      '<h2>Início da rotação</h2>' +
      '<form class="adicionar" id="form-inicio"><input type="date" name="inicio" value="' + esc(d.inicio) + '" required>' +
      '<button class="botao" type="submit">Salvar</button></form>' +

      '<h2>Ausências (férias, atestado)</h2><div class="cartao">' +
      (ausencias.map(function (a) {
        return linhaAdmin(a.nome, dataBonita(a.de, false) + (a.ate !== a.de ? ' a ' + dataBonita(a.ate, false) : '') + (a.motivo ? ' · ' + a.motivo : ''),
          d.ausencias.indexOf(a), 'ausencia');
      }).join('') || '<div class="vazio">Nenhuma ausência.</div>') +
      '</div><form class="adicionar grade" id="add-ausencia">' +
      '<select name="nome" aria-label="Pessoa">' + opcoes(d.pessoas) + '</select>' +
      '<input name="motivo" placeholder="Motivo (opcional)" maxlength="40">' +
      '<label>De<input type="date" name="de" value="' + h + '" required></label>' +
      '<label>Até<input type="date" name="ate" value="' + h + '" required></label>' +
      '<button class="botao" type="submit">Adicionar ausência</button></form>' +

      '<h2>Feriados</h2><div class="cartao">' +
      (feriados.map(function (f) {
        return linhaAdmin(f.descricao, dataBonita(f.data, false) + '/' + f.data.slice(0, 4), d.feriados.indexOf(f), 'feriado');
      }).join('') || '<div class="vazio">Nenhum feriado.</div>') +
      '</div><form class="adicionar grade" id="add-feriado">' +
      '<input type="date" name="data" required aria-label="Data">' +
      '<input name="descricao" placeholder="Descrição" maxlength="40">' +
      '<button class="botao" type="submit">Adicionar feriado</button></form>' +

      '<h2>Trocas registradas</h2><div class="cartao">' +
      (trocas.map(function (t) {
        return linhaAdmin(t.s.cobriu + ' no lugar de ' + t.s.faltou, dataBonita(t.s.data, false) + ' · ' + t.s.tarefa, t.i, 'troca');
      }).join('') || '<div class="vazio">Nenhuma troca.</div>') + '</div>' +
      '<p class="nota">Apagar uma troca registrada por engano também apaga a dívida que ela gerou.</p>' +

      '<h2>Trocar minha senha</h2>' +
      '<form class="formulario cartao-form" id="form-senha">' +
      '<label>Senha atual<input type="password" name="atual" autocomplete="current-password" required></label>' +
      '<label>Nova senha<input type="password" name="nova" autocomplete="new-password" minlength="8" required></label>' +
      '<label>Repita a nova senha<input type="password" name="nova2" autocomplete="new-password" minlength="8" required></label>' +
      '<button class="botao" type="submit">Trocar senha</button></form>' +

      '<div class="acoes"><button type="button" class="botao secundario" id="sair">Sair do admin</button></div>';

    document.getElementById('voltar').onclick = function () { estado.tela = 'detalhes'; render(); };
    document.getElementById('sair').onclick = sairAdmin;

    var linhasDe = {
      pessoa: function () { return d.pessoas.map(function (p) { return [p]; }); },
      tarefa: function () { return d.tarefas.map(function (t) { return [t.nome, t.dias]; }); },
      ausencia: function () { return d.ausencias.map(function (a) { return [a.nome, a.de, a.ate, a.motivo || '']; }); },
      feriado: function () { return d.feriados.map(function (f) { return [f.data, f.descricao]; }); },
      troca: function () { return d.substituicoes.map(function (s) { return [s.data, s.faltou, s.cobriu, s.tarefa, s.registrado || '']; }); }
    };
    var ABA = { pessoa: 'Pessoas', tarefa: 'Tarefas', ausencia: 'Ausencias', feriado: 'Feriados', troca: 'Substituicoes' };

    app.querySelectorAll('.remover').forEach(function (b) {
      b.onclick = function () {
        var g = b.dataset.grupo, i = +b.dataset.i;
        var nome = b.closest('.linha').querySelector('.quem').firstChild.textContent;
        if (!confirm('Remover "' + nome + '"?')) return;
        var linhas = linhasDe[g]();
        linhas.splice(i, 1);
        salvar(ABA[g], linhas, b);
      };
    });

    function aoEnviar(id, fn) {
      var f = document.getElementById(id);
      f.onsubmit = function (ev) { ev.preventDefault(); fn(f, f.querySelector('[type=submit]')); };
    }
    aoEnviar('add-pessoa', function (f, b) {
      salvar('Pessoas', linhasDe.pessoa().concat([[f.nome.value.trim()]]), b);
    });
    aoEnviar('add-tarefa', function (f, b) {
      salvar('Tarefas', linhasDe.tarefa().concat([[f.nome.value.trim(), f.dias.value]]), b);
    });
    aoEnviar('form-inicio', function (f, b) {
      salvar('Config', [['Inicio', f.inicio.value]], b);
    });
    aoEnviar('add-ausencia', function (f, b) {
      if (f.ate.value < f.de.value) return aviso('A data "até" é antes da data "de".', true);
      salvar('Ausencias', linhasDe.ausencia().concat([[f.nome.value, f.de.value, f.ate.value, f.motivo.value.trim()]]), b);
    });
    aoEnviar('add-feriado', function (f, b) {
      salvar('Feriados', linhasDe.feriado().concat([[f.data.value, f.descricao.value.trim() || 'Feriado']]), b);
    });
    aoEnviar('form-senha', function (f, b) {
      if (f.nova.value !== f.nova2.value) return aviso('As senhas novas não são iguais.', true);
      b.disabled = true; b.textContent = 'Salvando…';
      post({ acao: 'senha', token: ler(CHAVE_ADMIN), atual: f.atual.value, nova: f.nova.value }).then(function () {
        f.reset(); b.disabled = false; b.textContent = 'Trocar senha';
        aviso('Senha trocada ✓');
      }).catch(function (e) {
        b.dataset.texto = 'Trocar senha';
        erroAdmin(b)(e);
      });
    });
  }

  // ---------- início ----------
  var cache = ler(CHAVE_DADOS);
  if (!DEMO && cache && cache.dados) {
    estado.dados = cache.dados;
    estado.atualizadoEm = cache.em;
    render();
  }
  carregar();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') carregar();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
