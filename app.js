(function () {
  'use strict';

  var CFG = window.FAXINA_CONFIG;
  var R = window.Rotacao;
  var DEMO = !CFG.API_URL;
  var CHAVE_NOME = 'faxina:nome', CHAVE_DADOS = 'faxina:dados', CHAVE_DEMO = 'faxina:demo-subs';

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

  function definirDados(d) {
    estado.dados = d;
    estado.atualizadoEm = Date.now();
    estado.erro = null;
    render();
  }

  function registrarSubstituicao(faltou, tarefa) {
    var pedido = { acao: 'substituicao', faltou: faltou, cobriu: eu(), tarefa: tarefa };
    if (DEMO) {
      var subs = ler(CHAVE_DEMO) || [];
      subs.push({ data: hoje(), faltou: faltou, cobriu: eu(), tarefa: tarefa });
      gravar(CHAVE_DEMO, subs);
      return carregar();
    }
    return fetch(CFG.API_URL, {
      method: 'POST',
      // text/plain evita a checagem CORS que o Apps Script não responde.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(pedido)
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.erro) throw new Error(d.erro);
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

    app.innerHTML =
      '<div class="topo"><span class="data">' + esc(dataBonita(c.hoje)) + '</span>' +
      '<button type="button" class="botao-detalhes" id="ir-detalhes">Rotação ›</button></div>' +
      '<section class="principal"><p class="nome">' + esc(nome) + '</p>' + corpo + aviso + '</section>' +
      (estado.erro ? '<p class="demo">' + esc(estado.erro) + '</p>' : '') +
      (DEMO ? '<p class="demo">Modo demonstração: as trocas ficam só neste celular.</p>' : '');
    document.getElementById('ir-detalhes').onclick = function () { estado.tela = 'detalhes'; render(); window.scrollTo(0, 0); };
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
      '</div>' +
      '<p class="rodape">' + (estado.erro ? esc(estado.erro) + ' · ' : '') +
      (estado.atualizadoEm ? 'Atualizado às ' + new Date(estado.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + ' · ' : '') +
      '<button type="button" id="atualizar">Atualizar</button></p>';

    document.getElementById('voltar').onclick = function () { estado.tela = 'inicio'; render(); };
    document.getElementById('trocar').onclick = function () { gravar(CHAVE_NOME, null); render(); };
    document.getElementById('atualizar').onclick = function () { app.querySelector('.rodape').textContent = 'Atualizando…'; carregar(); };
    document.getElementById('cobrir').onclick = function () { abrirCobrir(diaHoje); };
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
