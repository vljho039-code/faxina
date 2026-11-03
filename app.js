(function () {
  'use strict';

  var CFG = window.FAXINA_CONFIG;
  var R = window.Rotacao;
  var DEMO = !CFG.API_URL;
  var CHAVE_SESSAO = 'faxina:sessao', CHAVE_DADOS = 'faxina:dados', CHAVE_DEMO = 'faxina:demo';

  var app = document.getElementById('app');
  var modal = document.getElementById('modal');
  var estado = { dados: null, contas: [], tela: 'inicio', atualizadoEm: null, erro: null };

  // ---------- armazenamento local (sempre protegido) ----------
  function ler(chave) {
    try { return JSON.parse(localStorage.getItem(chave)); } catch (e) { return null; }
  }
  function gravar(chave, valor) {
    try {
      if (valor === null) localStorage.removeItem(chave);
      else localStorage.setItem(chave, JSON.stringify(valor));
    } catch (e) { /* sem espaço/privado */ }
  }

  // ---------- sessão ----------
  function sessao() { return ler(CHAVE_SESSAO); }
  function conta() { var s = sessao(); return s && s.conta; }
  function token() { var s = sessao(); return s && s.token; }
  function eu() { var c = conta(); return c && c.nome; }
  function souAdmin() { var c = conta(); return !!(c && c.admin); }

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

  // ---------- comunicação ----------
  // POST para o Apps Script. text/plain evita a checagem CORS que ele não responde.
  // No modo demonstração, o mesmo pedido vai para um "servidor" local (demoApi).
  function api(pedido) {
    var envio = DEMO ? Promise.resolve(demoApi(pedido)) : fetch(CFG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(pedido)
    }).then(function (r) { return r.json(); }, function () { throw new Error('Sem conexão. Verifique a internet.'); });
    return envio.then(function (d) {
      if (d.erro) {
        if (d.sessao === false) { gravar(CHAVE_SESSAO, null); estado.tela = 'inicio'; render(); }
        var e = new Error(d.erro);
        e.sessao = d.sessao;
        throw e;
      }
      return d;
    });
  }

  // Toda resposta traz { conta, dados, contas? }: atualiza tudo de uma vez.
  function aplicar(r, forcar) {
    var s = sessao();
    if (r.token) s = { token: r.token };
    if (!s) return r;
    s.conta = r.conta;
    gravar(CHAVE_SESSAO, s);
    estado.contas = r.contas || [];
    estado.dados = r.dados;
    estado.atualizadoEm = Date.now();
    estado.erro = null;
    gravar(CHAVE_DADOS, { dados: r.dados, contas: estado.contas, em: Date.now() });
    if (estado.tela !== 'admin' || forcar) render();
    return r;
  }

  function carregar() {
    if (!token()) { render(); return Promise.resolve(); }
    return api({ acao: 'dados', token: token() }).then(function (r) { aplicar(r); }).catch(function (e) {
      if (e.sessao === false) return;
      estado.erro = estado.dados ? 'Sem conexão. Mostrando a última versão salva.' : 'Não deu para carregar a escala. Verifique a internet.';
      render();
    });
  }

  function registrarSubstituicao(faltou, tarefa) {
    return api({ acao: 'substituicao', token: token(), faltou: faltou, tarefa: tarefa }).then(function (r) { aplicar(r); });
  }

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
    if (m.tipo === 'ajuste') return 'definido pelo admin';
    return '';
  }

  // ---------- telas ----------
  function render() {
    var c = conta();
    if (!c) return telaLogin();
    if (c.trocarSenha) return telaSenhaNova();
    if (!estado.dados) {
      if (!estado.erro) { app.innerHTML = '<p class="carregando">Carregando…</p>'; return; }
      app.innerHTML = '<section class="boas-vindas"><h1>Sem conexão</h1><p>' + esc(estado.erro) + '</p>' +
        '<div class="acoes"><button type="button" class="botao" id="tentar">Tentar de novo</button>' +
        '<button type="button" class="botao secundario" id="sair">Sair</button></div></section>';
      document.getElementById('tentar').onclick = function () { estado.erro = null; render(); carregar(); };
      document.getElementById('sair').onclick = sair;
      return;
    }
    if (estado.tela === 'admin' && c.admin) return telaAdmin();
    if (!c.nome || estado.dados.pessoas.indexOf(c.nome) === -1) return telaSemEscala();
    if (estado.tela === 'detalhes') return telaDetalhes();
    telaInicio();
  }

  function telaLogin() {
    app.innerHTML =
      '<section class="boas-vindas">' +
      '<h1>Faxina 🧽</h1>' +
      '<p>Entre com o login que o admin te passou.</p>' +
      '<form id="form-login" class="formulario cartao-form">' +
      '<label>Usuário<input name="usuario" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>' +
      '<label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>' +
      '<p class="erro" hidden></p>' +
      '<button class="botao" type="submit">Entrar</button></form>' +
      '<p class="nota">Esqueceu a senha? Peça para o admin gerar uma nova.</p>' +
      (DEMO ? '<p class="demo">Modo demonstração: entre com <strong>admin</strong> / <strong>admin</strong>, ' +
        'ou com o nome de alguém (ex.: <strong>gabriel</strong>) e a senha <strong>1234</strong>.</p>' : '') +
      '</section>';
    var form = document.getElementById('form-login');
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var b = form.querySelector('[type=submit]'), erro = form.querySelector('.erro');
      b.disabled = true; b.textContent = 'Entrando…'; erro.hidden = true;
      api({ acao: 'login', usuario: form.usuario.value, senha: form.senha.value }).then(function (r) {
        estado.tela = r.conta.admin && !r.conta.nome ? 'admin' : 'inicio';
        aplicar(r, true);
        window.scrollTo(0, 0);
      }).catch(function (e) {
        b.disabled = false; b.textContent = 'Entrar';
        erro.textContent = e.message; erro.hidden = false;
      });
    };
  }

  // Primeiro acesso (ou senha redefinida pelo admin): cria a senha própria.
  function telaSenhaNova() {
    var c = conta();
    app.innerHTML =
      '<section class="boas-vindas">' +
      '<h1>Crie sua senha</h1>' +
      '<p>Olá, ' + esc(c.nome || c.usuario) + '! Você entrou com uma senha provisória. Escolha uma senha só sua.</p>' +
      '<form id="form-nova" class="formulario cartao-form">' +
      '<input type="text" name="usuario" autocomplete="username" value="' + esc(c.usuario) + '" hidden>' +
      '<label>Senha provisória<input type="password" name="atual" autocomplete="current-password" required></label>' +
      '<label>Nova senha<input type="password" name="nova" autocomplete="new-password" minlength="6" required></label>' +
      '<label>Repita a nova senha<input type="password" name="nova2" autocomplete="new-password" minlength="6" required></label>' +
      '<p class="erro" hidden></p>' +
      '<button class="botao" type="submit">Salvar senha</button></form>' +
      '<p class="rodape"><button type="button" id="sair">Sair</button></p></section>';
    document.getElementById('sair').onclick = sair;
    var f = document.getElementById('form-nova');
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var b = f.querySelector('[type=submit]'), erro = f.querySelector('.erro');
      if (f.nova.value !== f.nova2.value) { erro.textContent = 'As senhas novas não são iguais.'; erro.hidden = false; return; }
      b.disabled = true; b.textContent = 'Salvando…'; erro.hidden = true;
      api({ acao: 'senha', token: token(), atual: f.atual.value, nova: f.nova.value }).then(function (r) {
        estado.tela = r.conta.admin && !r.conta.nome ? 'admin' : 'inicio';
        aplicar(r, true);
        aviso('Senha criada ✓');
      }).catch(function (e) {
        b.disabled = false; b.textContent = 'Salvar senha';
        erro.textContent = e.message; erro.hidden = false;
      });
    };
  }

  function telaSemEscala() {
    var c = conta();
    app.innerHTML =
      '<section class="boas-vindas"><h1>Olá, ' + esc(c.nome || c.usuario) + '</h1>' +
      '<p>' + (c.nome ? 'Você não está na escala da faxina no momento.' : 'Seu login não está ligado a ninguém da escala.') + '</p>' +
      '<div class="acoes">' +
      (c.admin ? '<button type="button" class="botao" id="painel">⚙️ Painel admin</button>' : '') +
      '<button type="button" class="botao secundario" id="sair">Sair</button></div></section>';
    document.getElementById('sair').onclick = sair;
    if (c.admin) document.getElementById('painel').onclick = irAdmin;
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
      (DEMO ? '<p class="demo">Modo demonstração: tudo fica salvo só neste celular.</p>' : '');
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
      (souAdmin() ? '<button type="button" class="botao secundario" id="painel">⚙️ Painel admin</button>' : '') +
      '<button type="button" class="botao secundario" id="minha-senha">Trocar minha senha</button>' +
      '<button type="button" class="botao secundario" id="sair">Sair (' + esc(conta().usuario) + ')</button>' +
      '</div>' +
      '<p class="rodape">' + (estado.erro ? esc(estado.erro) + ' · ' : '') +
      (estado.atualizadoEm ? 'Atualizado às ' + new Date(estado.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' · ' : '') +
      '<button type="button" id="atualizar">Atualizar</button></p>';

    document.getElementById('voltar').onclick = function () { estado.tela = 'inicio'; render(); };
    document.getElementById('sair').onclick = sair;
    document.getElementById('minha-senha').onclick = abrirTrocarSenha;
    document.getElementById('atualizar').onclick = function () { app.querySelector('.rodape').textContent = 'Atualizando…'; carregar(); };
    document.getElementById('cobrir').onclick = function () { abrirCobrir(diaHoje); };
    var painel = document.getElementById('painel');
    if (painel) painel.onclick = irAdmin;
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

  // ---------- trocar a própria senha ----------
  function abrirTrocarSenha() {
    modal.innerHTML =
      '<h3>Trocar minha senha</h3>' +
      '<form class="formulario" id="form-senha">' +
      '<input type="text" name="usuario" autocomplete="username" value="' + esc(conta().usuario) + '" hidden>' +
      '<label>Senha atual<input type="password" name="atual" autocomplete="current-password" required></label>' +
      '<label>Nova senha<input type="password" name="nova" autocomplete="new-password" minlength="6" required></label>' +
      '<label>Repita a nova senha<input type="password" name="nova2" autocomplete="new-password" minlength="6" required></label>' +
      '<p class="erro" hidden></p>' +
      '<div class="acoes" style="margin-top:4px">' +
      '<button class="botao" type="submit">Trocar senha</button>' +
      '<button class="botao secundario" type="button" id="cancelar">Cancelar</button></div></form>';
    var f = modal.querySelector('#form-senha');
    modal.querySelector('#cancelar').onclick = function () { modal.close(); };
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var b = f.querySelector('[type=submit]'), erro = f.querySelector('.erro');
      if (f.nova.value !== f.nova2.value) { erro.textContent = 'As senhas novas não são iguais.'; erro.hidden = false; return; }
      b.disabled = true; b.textContent = 'Salvando…'; erro.hidden = true;
      api({ acao: 'senha', token: token(), atual: f.atual.value, nova: f.nova.value }).then(function (r) {
        modal.close();
        aplicar(r, true);
        aviso('Senha trocada ✓');
      }).catch(function (e) {
        b.disabled = false; b.textContent = 'Trocar senha';
        erro.textContent = e.message; erro.hidden = false;
      });
    };
    modal.showModal();
  }

  function sair() {
    var t = token();
    gravar(CHAVE_SESSAO, null);
    gravar(CHAVE_DADOS, null);
    estado.dados = null; estado.contas = []; estado.tela = 'inicio';
    if (t) api({ acao: 'sair', token: t }).catch(function () {});
    render();
  }

  function irAdmin() {
    estado.tela = 'admin';
    render();
    window.scrollTo(0, 0);
  }

  // ---------- admin: ações ----------
  function ocupado(botao) {
    if (botao) { botao.disabled = true; botao.dataset.texto = botao.textContent; botao.textContent = '…'; }
  }
  function erroAdmin(botao) {
    return function (e) {
      if (botao) { botao.disabled = false; botao.textContent = botao.dataset.texto || botao.textContent; }
      aviso(e.message, true);
      throw e;
    };
  }

  // Salva uma aba inteira na planilha e redesenha o painel com o resultado.
  function salvar(aba, linhas, botao) {
    ocupado(botao);
    return api({ acao: 'salvar', token: token(), aba: aba, linhas: linhas }).then(function (r) {
      aplicar(r, true);
      aviso('Salvo ✓');
      return r;
    }).catch(erroAdmin(botao));
  }

  function acaoConta(pedido, botao) {
    ocupado(botao);
    pedido.token = token();
    return api(pedido).then(function (r) {
      aplicar(r, true);
      if (r.senhaProvisoria) mostrarSenha(r.usuarioCriado, r.senhaProvisoria);
      else aviso('Salvo ✓');
      return r;
    }).catch(erroAdmin(botao));
  }

  function mostrarSenha(usuario, senha) {
    var texto = 'Faxina 🧽\nLink: ' + location.href.split('?')[0] + '\nUsuário: ' + usuario + '\nSenha provisória: ' + senha;
    modal.innerHTML =
      '<h3>Login pronto</h3>' +
      '<p>Passe estes dados para a pessoa. No primeiro acesso ela cria a própria senha.</p>' +
      '<div class="cartao credenciais"><div class="linha"><span class="quem">Usuário</span><span class="oque"><strong>' + esc(usuario) + '</strong></span></div>' +
      '<div class="linha"><span class="quem">Senha provisória</span><span class="oque"><strong>' + esc(senha) + '</strong></span></div></div>' +
      '<p class="nota">Esta senha não aparece de novo. Se perder, gere outra.</p>' +
      '<div class="acoes" style="margin-top:0">' +
      '<button type="button" class="botao" id="copiar">Copiar mensagem</button>' +
      '<button type="button" class="botao secundario" id="ok">Fechar</button></div>';
    modal.querySelector('#ok').onclick = function () { modal.close(); };
    modal.querySelector('#copiar').onclick = function () {
      var b = this;
      var feito = function () { b.textContent = 'Copiado ✓'; };
      if (navigator.share) navigator.share({ text: texto }).then(feito, function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(texto).then(feito, function () { b.textContent = 'Não deu para copiar'; });
    };
    if (!modal.open) modal.showModal();
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

  function botaoRemover(grupo, i, rotulo) {
    return '<button type="button" class="remover" data-grupo="' + grupo + '" data-i="' + i + '" aria-label="Remover ' + esc(rotulo) + '">✕</button>';
  }

  function linhaAdmin(principal, secundario, i, grupo) {
    return '<div class="linha linha-admin"><span class="quem">' + esc(principal) +
      (secundario ? '<span class="sub">' + esc(secundario) + '</span>' : '') + '</span>' +
      botaoRemover(grupo, i, principal) + '</div>';
  }

  function opcoes(lista, sel) {
    return lista.map(function (v) {
      return '<option' + (v === sel ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  }

  function contaDe(nome) {
    return estado.contas.filter(function (c) { return c.nome === nome; })[0];
  }

  function sugerirUsuario(nome) {
    var base = nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '') || 'pessoa';
    var u = base, n = 2;
    while (estado.contas.some(function (c) { return c.usuario === u; })) u = base + n++;
    return u;
  }

  function telaAdmin() {
    var d = estado.dados, h = hoje(), minha = conta();
    var feriados = d.feriados.slice().sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    var ausencias = d.ausencias.slice().sort(function (a, b) { return a.de < b.de ? -1 : 1; });
    var ajustes = (d.ajustes || []).map(function (a, i) { return { a: a, i: i }; })
      .filter(function (x) { return x.a.data >= h; }).sort(function (x, y) { return x.a.data < y.a.data ? -1 : 1; });
    var trocas = d.substituicoes.map(function (s, i) { return { s: s, i: i }; }).reverse().slice(0, 30);
    var semPessoa = estado.contas.filter(function (c) { return !c.nome || d.pessoas.indexOf(c.nome) === -1; });
    var nomesTarefas = d.tarefas.map(function (t) { return t.nome; });

    app.innerHTML =
      '<div class="cabecalho"><button type="button" class="voltar" id="voltar" aria-label="Voltar">‹</button><h1>Painel admin</h1></div>' +

      '<h2>Pessoas e logins</h2><div class="cartao">' +
      (d.pessoas.map(function (p, i) {
        var c = contaDe(p);
        return '<div class="linha linha-admin"><span class="quem">' + esc(p) +
          '<span class="sub">' + (c ? 'login: ' + esc(c.usuario) + (c.admin ? ' · admin' : '') + (c.trocarSenha ? ' · ainda não entrou' : '') : 'sem login') + '</span></span>' +
          '<span class="botoes-linha">' +
          (i > 0 ? '<button type="button" class="mini" data-subir="' + i + '" aria-label="Subir ' + esc(p) + '">↑</button>' : '') +
          (c ? '<button type="button" class="mini" data-senha="' + esc(c.usuario) + '">Nova senha</button>'
             : '<button type="button" class="mini" data-criar="' + esc(p) + '">Criar login</button>') +
          botaoRemover('pessoa', i, p) + '</span></div>';
      }).join('') || '<div class="vazio">Ninguém.</div>') +
      '</div><form class="adicionar grade" id="add-pessoa">' +
      '<input name="nome" placeholder="Nome" required maxlength="40" aria-label="Nome">' +
      '<input name="usuario" placeholder="Usuário (opcional)" maxlength="30" autocapitalize="none" aria-label="Usuário">' +
      '<button class="botao" type="submit">Adicionar pessoa + login</button></form>' +
      '<p class="nota">Ao adicionar, o app gera uma senha provisória para você passar à pessoa. A ordem da lista é a ordem da rotação.</p>' +

      (semPessoa.length ? '<h2>Outros logins</h2><div class="cartao">' + semPessoa.map(function (c) {
        return '<div class="linha linha-admin"><span class="quem">' + esc(c.usuario) +
          '<span class="sub">' + (c.admin ? 'admin' : 'pessoa') + (c.nome ? ' · ' + esc(c.nome) + ' (fora da escala)' : ' · fora da escala') + '</span></span>' +
          '<span class="botoes-linha"><button type="button" class="mini" data-senha="' + esc(c.usuario) + '">Nova senha</button>' +
          (c.usuario === minha.usuario ? '' : '<button type="button" class="remover" data-conta="' + esc(c.usuario) + '" aria-label="Remover login ' + esc(c.usuario) + '">✕</button>') +
          '</span></div>';
      }).join('') + '</div>' : '') +

      '<h2>Administradores</h2><div class="cartao">' +
      estado.contas.map(function (c) {
        var eu = c.usuario === minha.usuario;
        return '<label class="linha linha-admin checkbox"><span class="quem">' + esc(c.nome || c.usuario) +
          '<span class="sub">' + esc(c.usuario) + (eu ? ' · você' : '') + '</span></span>' +
          '<input type="checkbox" data-admin="' + esc(c.usuario) + '"' + (c.admin ? ' checked' : '') + (eu ? ' disabled' : '') + '></label>';
      }).join('') + '</div>' +
      '<p class="nota">Admins podem mudar tarefas, pessoas e logins.</p>' +

      '<h2>Tarefas</h2><div class="cartao">' +
      (d.tarefas.map(function (t, i) {
        return '<div class="linha linha-admin"><span class="quem">' + esc(t.nome) + '</span>' +
          '<span class="botoes-linha"><select class="mini" data-dias="' + i + '" aria-label="Dias de ' + esc(t.nome) + '">' +
          opcoes(OPCOES_DIAS.indexOf(t.dias) === -1 && t.dias ? OPCOES_DIAS.concat([t.dias]) : OPCOES_DIAS, t.dias || 'Seg a Sex') + '</select>' +
          '<button type="button" class="mini" data-renomear="' + i + '" aria-label="Renomear ' + esc(t.nome) + '">✎</button>' +
          botaoRemover('tarefa', i, t.nome) + '</span></div>';
      }).join('') || '<div class="vazio">Nenhuma tarefa.</div>') +
      '</div><form class="adicionar" id="add-tarefa"><input name="nome" placeholder="Nova tarefa" required maxlength="60">' +
      '<select name="dias" aria-label="Dias">' + opcoes(OPCOES_DIAS, 'Seg a Sex') + '</select>' +
      '<button class="botao" type="submit">Adicionar</button></form>' +
      '<p class="nota">Mudar pessoas ou tarefas recalcula a escala desde o início. Se for mudar, atualize também o início da rotação para hoje ou a próxima segunda.</p>' +

      '<h2>Definir quem faz o quê</h2><div class="cartao">' +
      (ajustes.map(function (x) {
        return linhaAdmin(x.a.pessoa + ' → ' + x.a.tarefa, dataBonita(x.a.data), x.i, 'ajuste');
      }).join('') || '<div class="vazio">Nenhum ajuste. A rotação decide sozinha.</div>') +
      '</div><form class="adicionar grade" id="add-ajuste">' +
      '<label>Dia<input type="date" name="data" value="' + h + '" min="' + h + '" required></label>' +
      '<select name="pessoa" aria-label="Pessoa">' + opcoes(d.pessoas) + '</select>' +
      '<select name="tarefa" aria-label="Tarefa">' + opcoes(nomesTarefas.concat([R.FOLGA])) + '</select>' +
      '<button class="botao" type="submit">Definir</button></form>' +
      '<p class="nota">Naquele dia a pessoa faz a tarefa escolhida e quem estava com ela fica com a da pessoa (uma troca). Os outros dias seguem a rotação normal.</p>' +

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

      '<div class="acoes">' +
      '<button type="button" class="botao secundario" id="minha-senha">Trocar minha senha</button>' +
      '<button type="button" class="botao secundario" id="sair">Sair (' + esc(minha.usuario) + ')</button></div>';

    document.getElementById('voltar').onclick = function () { estado.tela = 'inicio'; render(); window.scrollTo(0, 0); };
    document.getElementById('sair').onclick = sair;
    document.getElementById('minha-senha').onclick = abrirTrocarSenha;

    var linhasDe = {
      pessoa: function () { return d.pessoas.map(function (p) { return [p]; }); },
      tarefa: function () { return d.tarefas.map(function (t) { return [t.nome, t.dias]; }); },
      ausencia: function () { return d.ausencias.map(function (a) { return [a.nome, a.de, a.ate, a.motivo || '']; }); },
      feriado: function () { return d.feriados.map(function (f) { return [f.data, f.descricao]; }); },
      troca: function () { return d.substituicoes.map(function (s) { return [s.data, s.faltou, s.cobriu, s.tarefa, s.registrado || '']; }); },
      ajuste: function () { return (d.ajustes || []).map(function (a) { return [a.data, a.pessoa, a.tarefa]; }); }
    };
    var ABA = { pessoa: 'Pessoas', tarefa: 'Tarefas', ausencia: 'Ausencias', feriado: 'Feriados', troca: 'Substituicoes', ajuste: 'Ajustes' };

    app.querySelectorAll('.remover[data-grupo]').forEach(function (b) {
      b.onclick = function () {
        var g = b.dataset.grupo, i = +b.dataset.i;
        var nome = b.closest('.linha').querySelector('.quem').firstChild.textContent;
        var c = g === 'pessoa' && contaDe(nome);
        var apagarLogin = c && !c.admin;
        if (!confirm('Remover "' + nome + '"?' + (apagarLogin ? '\nO login "' + c.usuario + '" também será apagado.' : ''))) return;
        var linhas = linhasDe[g]();
        linhas.splice(i, 1);
        salvar(ABA[g], linhas, b).then(function () {
          if (apagarLogin) return acaoConta({ acao: 'remover-conta', usuario: c.usuario });
        }).catch(function () {});
      };
    });
    app.querySelectorAll('[data-conta]').forEach(function (b) {
      b.onclick = function () {
        if (!confirm('Apagar o login "' + b.dataset.conta + '"?')) return;
        acaoConta({ acao: 'remover-conta', usuario: b.dataset.conta }, b).catch(function () {});
      };
    });
    app.querySelectorAll('[data-senha]').forEach(function (b) {
      b.onclick = function () {
        var u = b.dataset.senha;
        if (!confirm('Gerar uma senha provisória nova para "' + u + '"?\nA senha atual deixa de funcionar e a pessoa sai dos celulares.')) return;
        acaoConta({ acao: 'resetar-senha', usuario: u }, b).catch(function () {});
      };
    });
    app.querySelectorAll('[data-criar]').forEach(function (b) {
      b.onclick = function () {
        var nome = b.dataset.criar;
        var u = prompt('Usuário para ' + nome + ':', sugerirUsuario(nome));
        if (!u) return;
        acaoConta({ acao: 'conta', novo: true, usuario: u, nome: nome, admin: false }, b).catch(function () {});
      };
    });
    app.querySelectorAll('[data-admin]').forEach(function (cb) {
      cb.onchange = function () {
        var c = estado.contas.filter(function (x) { return x.usuario === cb.dataset.admin; })[0];
        acaoConta({ acao: 'conta', usuario: c.usuario, nome: c.nome, admin: cb.checked }).catch(function () { cb.checked = !cb.checked; });
      };
    });
    app.querySelectorAll('[data-subir]').forEach(function (b) {
      b.onclick = function () {
        var i = +b.dataset.subir, linhas = linhasDe.pessoa();
        var x = linhas[i]; linhas[i] = linhas[i - 1]; linhas[i - 1] = x;
        salvar('Pessoas', linhas, b).catch(function () {});
      };
    });
    app.querySelectorAll('[data-dias]').forEach(function (s) {
      s.onchange = function () {
        var linhas = linhasDe.tarefa();
        linhas[+s.dataset.dias][1] = s.value;
        salvar('Tarefas', linhas).catch(function () {});
      };
    });
    app.querySelectorAll('[data-renomear]').forEach(function (b) {
      b.onclick = function () {
        var i = +b.dataset.renomear, antigo = d.tarefas[i].nome;
        var novo = (prompt('Novo nome da tarefa:', antigo) || '').trim();
        if (!novo || novo === antigo) return;
        if (nomesTarefas.indexOf(novo) !== -1) return aviso('Já existe uma tarefa com esse nome.', true);
        var linhas = linhasDe.tarefa();
        linhas[i][0] = novo;
        salvar('Tarefas', linhas, b).catch(function () {});
      };
    });

    function aoEnviar(id, fn) {
      var f = document.getElementById(id);
      f.onsubmit = function (ev) {
        ev.preventDefault();
        var r = fn(f, f.querySelector('[type=submit]'));
        if (r && r.catch) r.catch(function () {});
      };
    }
    aoEnviar('add-pessoa', function (f, b) {
      var nome = f.nome.value.trim();
      if (d.pessoas.indexOf(nome) !== -1) return aviso(nome + ' já está na lista.', true);
      var usuario = f.usuario.value.trim() || sugerirUsuario(nome);
      return salvar('Pessoas', linhasDe.pessoa().concat([[nome]]), b).then(function () {
        if (contaDe(nome)) return;
        return acaoConta({ acao: 'conta', novo: true, usuario: usuario, nome: nome, admin: false });
      });
    });
    aoEnviar('add-tarefa', function (f, b) {
      var nome = f.nome.value.trim();
      if (nomesTarefas.indexOf(nome) !== -1) return aviso('Já existe uma tarefa com esse nome.', true);
      return salvar('Tarefas', linhasDe.tarefa().concat([[nome, f.dias.value]]), b);
    });
    aoEnviar('add-ajuste', function (f, b) {
      var linhas = linhasDe.ajuste().filter(function (l) { return !(l[0] === f.data.value && l[1] === f.pessoa.value); });
      return salvar('Ajustes', linhas.concat([[f.data.value, f.pessoa.value, f.tarefa.value]]), b);
    });
    aoEnviar('form-inicio', function (f, b) {
      return salvar('Config', [['Inicio', f.inicio.value]], b);
    });
    aoEnviar('add-ausencia', function (f, b) {
      if (f.ate.value < f.de.value) return aviso('A data "até" é antes da data "de".', true);
      return salvar('Ausencias', linhasDe.ausencia().concat([[f.nome.value, f.de.value, f.ate.value, f.motivo.value.trim()]]), b);
    });
    aoEnviar('add-feriado', function (f, b) {
      return salvar('Feriados', linhasDe.feriado().concat([[f.data.value, f.descricao.value.trim() || 'Feriado']]), b);
    });
  }

  // ---------- modo demonstração: "servidor" que roda neste celular ----------
  // Imita o script da planilha (mesmas ações e respostas) para dar para testar
  // tudo sem a planilha conectada. As senhas aqui NÃO são protegidas.
  function demoApi(p) {
    var db = ler(CHAVE_DEMO);
    if (!db || !db.contas) {
      var base = JSON.parse(JSON.stringify(CFG.DEMO));
      base.ajustes = base.ajustes || [];
      db = {
        dados: base, sessoes: {},
        contas: [{ usuario: 'admin', nome: '', admin: true, senha: 'admin', trocarSenha: false }].concat(base.pessoas.map(function (n) {
          return { usuario: sugerirDemo(n), nome: n, admin: false, senha: '1234', trocarSenha: false };
        }))
      };
    }
    function salvarDb() { gravar(CHAVE_DEMO, db); }
    function achar(u) { return db.contas.filter(function (c) { return c.usuario === u; })[0]; }
    function norm(u) { return String(u || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '.'); }
    function sugerirDemo(n) { return norm(n).replace(/[^a-z0-9._-]/g, ''); }
    function pub(c) { return { usuario: c.usuario, nome: c.nome, admin: c.admin, trocarSenha: c.trocarSenha }; }
    function resp(c, extra) {
      var r = { conta: pub(c), dados: JSON.parse(JSON.stringify(db.dados)) };
      if (c.admin) r.contas = db.contas.map(pub);
      Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
      salvarDb();
      return r;
    }
    function provisoria() { return String(100000 + Math.floor(Math.random() * 900000)); }

    if (p.acao === 'login') {
      var c0 = achar(norm(p.usuario));
      if (!c0 || c0.senha !== p.senha) return { erro: 'Usuário ou senha incorretos.' };
      var t = Math.random().toString(16).slice(2) + Date.now().toString(16);
      db.sessoes[t] = c0.usuario;
      return resp(c0, { token: t });
    }
    var c = db.sessoes[p.token] && achar(db.sessoes[p.token]);
    if (!c) return { erro: 'Sua sessão expirou. Entre de novo.', sessao: false };
    var d = db.dados;

    switch (p.acao) {
      case 'dados': return resp(c);
      case 'sair': delete db.sessoes[p.token]; salvarDb(); return { ok: true };
      case 'senha':
        if (p.atual !== c.senha) return { erro: 'A senha atual está errada.' };
        if (String(p.nova).length < 6) return { erro: 'A senha nova precisa ter pelo menos 6 caracteres.' };
        if (p.nova === p.atual) return { erro: 'A senha nova precisa ser diferente da atual.' };
        c.senha = p.nova; c.trocarSenha = false;
        return resp(c);
      case 'substituicao':
        var cobriu = c.admin && p.cobriu ? p.cobriu : c.nome, h = hoje();
        if (!cobriu || d.pessoas.indexOf(cobriu) === -1) return { erro: 'Sua conta não está ligada a ninguém da escala.' };
        if (d.substituicoes.some(function (s) { return s.data === h && s.faltou === p.faltou && s.tarefa === p.tarefa; })) {
          return { erro: 'Essa substituição já foi registrada hoje.' };
        }
        d.substituicoes.push({ data: h, faltou: p.faltou, cobriu: cobriu, tarefa: p.tarefa });
        return resp(c);
    }
    if (!c.admin) return { erro: 'Só o admin pode fazer isso.' };
    switch (p.acao) {
      case 'salvar':
        var L = p.linhas;
        if (p.aba === 'Pessoas') d.pessoas = L.map(function (l) { return l[0]; });
        else if (p.aba === 'Tarefas') d.tarefas = L.map(function (l) { return { nome: l[0], dias: l[1] }; });
        else if (p.aba === 'Ausencias') d.ausencias = L.map(function (l) { return { nome: l[0], de: l[1], ate: l[2] || l[1], motivo: l[3] }; });
        else if (p.aba === 'Feriados') d.feriados = L.map(function (l) { return { data: l[0], descricao: l[1] }; });
        else if (p.aba === 'Substituicoes') d.substituicoes = L.map(function (l) { return { data: l[0], faltou: l[1], cobriu: l[2], tarefa: l[3], registrado: l[4] }; });
        else if (p.aba === 'Ajustes') d.ajustes = L.map(function (l) { return { data: l[0], pessoa: l[1], tarefa: l[2] }; });
        else if (p.aba === 'Config') L.forEach(function (l) { if (String(l[0]).toLowerCase() === 'inicio') d.inicio = l[1]; });
        else return { erro: 'Aba não pode ser editada.' };
        return resp(c);
      case 'conta':
        var u = norm(p.usuario), ex = achar(u);
        if (!/^[a-z0-9._-]{2,30}$/.test(u)) return { erro: 'Usuário: use 2 a 30 letras, números, ponto ou traço.' };
        if (p.novo && ex) return { erro: 'Já existe o usuário "' + u + '".' };
        if (p.nome && db.contas.some(function (x) { return x.nome === p.nome && x.usuario !== u; })) return { erro: p.nome + ' já tem um login.' };
        if (ex && ex.admin && !p.admin && db.contas.filter(function (x) { return x.admin; }).length === 1) return { erro: 'Precisa sobrar pelo menos um admin.' };
        if (ex) { ex.nome = p.nome || ''; ex.admin = !!p.admin; return resp(c); }
        var s = provisoria();
        db.contas.push({ usuario: u, nome: p.nome || '', admin: !!p.admin, senha: s, trocarSenha: true });
        return resp(c, { senhaProvisoria: s, usuarioCriado: u });
      case 'remover-conta':
        if (p.usuario === c.usuario) return { erro: 'Você não pode apagar o seu próprio login.' };
        db.contas = db.contas.filter(function (x) { return x.usuario !== p.usuario; });
        Object.keys(db.sessoes).forEach(function (k) { if (db.sessoes[k] === p.usuario) delete db.sessoes[k]; });
        return resp(c);
      case 'resetar-senha':
        var alvo = achar(p.usuario);
        if (!alvo) return { erro: 'Login não encontrado.' };
        var s2 = provisoria();
        alvo.senha = s2; alvo.trocarSenha = true;
        Object.keys(db.sessoes).forEach(function (k) { if (db.sessoes[k] === p.usuario && k !== p.token) delete db.sessoes[k]; });
        return resp(c, { senhaProvisoria: s2, usuarioCriado: alvo.usuario });
    }
    return { erro: 'Ação desconhecida.' };
  }

  // ---------- início ----------
  // Limpa o que as versões antigas (escolha de nome) deixaram.
  ['faxina:nome', 'faxina:admin', 'faxina:demo-subs'].forEach(function (k) { gravar(k, null); });

  var cache = ler(CHAVE_DADOS);
  if (token() && cache && cache.dados) {
    estado.dados = cache.dados;
    estado.contas = cache.contas || [];
    estado.atualizadoEm = cache.em;
  }
  render();
  carregar();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') carregar();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
