// Motor da rotação de faxina. Puro (sem DOM), roda no navegador e no Node.
//
// Regras:
// - Só dias úteis (seg-sex) que não sejam feriado, a partir da data de início.
// - Cada pessoa presente recebe 1 item por dia; quem sobra fica de "Folga",
//   que também entra no rodízio.
// - Para cada tarefa, ninguém repete antes de todos os presentes terem feito
//   (rodada por tarefa). Desempate: quem está há mais tempo sem fazê-la.
// - Ausência planejada: a pessoa sai da escala daquele dia, sem dívida.
// - Substituição (B cobriu A): A fica devendo 1 tarefa a B. No próximo dia útil
//   em que os dois estão presentes e B tem uma tarefa real, A faz a tarefa de B
//   e B folga. A rotação em si não muda: o turno conta para quem estava escalado.
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Rotacao = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FOLGA = 'Folga';
  var DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
  var DIAS_UTEIS = [1, 2, 3, 4, 5];

  // ---- datas (sempre 'AAAA-MM-DD', aritmética em UTC para evitar fuso) ----
  function paraUTC(s) {
    var p = s.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }
  function deUTC(ms) {
    return new Date(ms).toISOString().slice(0, 10);
  }
  function somaDias(s, n) {
    return deUTC(paraUTC(s) + n * 86400000);
  }
  function diaDaSemana(s) {
    return new Date(paraUTC(s)).getUTCDay();
  }

  // "Seg a Sex", "todos", "seg", "seg, qua", "segunda" -> [1,3]
  function lerDias(texto) {
    var t = String(texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!t.trim() || /todos|diari|seg\s*a\s*sex/.test(t)) return DIAS_UTEIS.slice();
    var dias = [];
    DIAS.forEach(function (d, i) {
      if (t.indexOf(d) !== -1 && dias.indexOf(i) === -1) dias.push(i);
    });
    return dias.length ? dias : DIAS_UTEIS.slice();
  }

  function normalizar(dados) {
    var pessoas = (dados.pessoas || []).filter(Boolean);
    var tarefas = (dados.tarefas || []).map(function (t) {
      return { nome: t.nome, dias: Array.isArray(t.dias) ? t.dias : lerDias(t.dias) };
    });
    var feriados = {};
    (dados.feriados || []).forEach(function (f) { feriados[f.data || f] = f.descricao || 'Feriado'; });
    return {
      inicio: dados.inicio,
      pessoas: pessoas,
      tarefas: tarefas,
      feriados: feriados,
      ausencias: dados.ausencias || [],
      substituicoes: (dados.substituicoes || []).slice().sort(function (a, b) {
        return a.data < b.data ? -1 : a.data > b.data ? 1 : 0;
      })
    };
  }

  function ausente(cfg, nome, data) {
    return cfg.ausencias.some(function (a) {
      return a.nome === nome && a.de <= data && data <= (a.ate || a.de);
    });
  }

  // Escolhe a melhor distribuição pessoa -> vaga.
  // Custo: (1) quantas vezes alguém repete antes do fim da rodada,
  //        (2) soma de "quando fez por último" (menor = esperou mais).
  // Busca exaustiva com poda; com ~5-8 pessoas é instantânea.
  function distribuir(presentes, vagas, estado) {
    var n = presentes.length, m = vagas.length;
    var custos = presentes.map(function (p) {
      return vagas.map(function (v) {
        var repete = estado.rodada[v][p] ? 1 : 0;
        var ultimo = estado.ultimo[v][p];
        return repete * 1e7 + (ultimo === undefined ? -1 : ultimo) + 1;
      });
    });
    var melhor = Infinity, melhorEscolha = null, usada = new Array(m), escolha = new Array(n);
    // Cada vaga recebe no máximo 1 pessoa por passada; se houver mais vagas que
    // pessoas, as que sobrarem voltam numa próxima passada. Se houver mais pessoas
    // que vagas (só acontece nas passadas extras), algumas ficam sem (-1).
    var pulos = Math.max(0, n - m);
    (function busca(i, acum, pulou) {
      if (acum >= melhor) return;
      if (i === n) { melhor = acum; melhorEscolha = escolha.slice(); return; }
      for (var j = 0; j < m; j++) {
        if (usada[j]) continue;
        usada[j] = true; escolha[i] = j;
        busca(i + 1, acum + custos[i][j], pulou);
        usada[j] = false;
      }
      if (pulou < pulos) { escolha[i] = -1; busca(i + 1, acum, pulou + 1); }
    })(0, 0, 0);
    return melhorEscolha;
  }

  function registrarTurno(estado, tarefa, pessoa, dia, presentes) {
    var r = estado.rodada[tarefa];
    // Rodada completa (todos os presentes já fizeram) -> começa outra.
    if (presentes.every(function (p) { return r[p]; })) {
      r = estado.rodada[tarefa] = {};
    }
    r[pessoa] = true;
    estado.ultimo[tarefa][pessoa] = dia;
  }

  function todoDiaUtil(t) {
    return DIAS_UTEIS.every(function (d) { return t.dias.indexOf(d) !== -1; });
  }

  // Monta a escala de um dia útil. Retorna { nome: [tarefas...] } (rotação pura).
  //
  // Tarefas de todo dia seguem um quadrado latino: a pessoa i, no dia de rotação k,
  // pega o "símbolo" (i + k + floor(k/N)) mod N. Em cada bloco de N dias cada
  // pessoa passa por cada símbolo uma vez, então toda tarefa diária passa por
  // todos antes de repetir. O deslocamento extra a cada bloco faz quem fica com
  // os símbolos "de sobra" na segunda mudar de semana em semana.
  // Quem fica com símbolo de sobra recebe as demais tarefas do dia (semanais,
  // as de quem está ausente) pelo histórico, ou folga.
  function escalaDoDia(cfg, estado, pendentes, presentes) {
    var N = cfg.pessoas.length;
    var diarias = cfg.tarefas.filter(todoDiaUtil).map(function (t) { return t.nome; });
    var noCiclo = diarias.slice(0, N);
    var k = estado.k, desloc = Math.floor(k / N);

    var escala = {}, sobra = [], monte = diarias.slice(N).concat(pendentes);
    cfg.pessoas.forEach(function (p, i) {
      var s = (i + k + desloc) % N;
      var presente = presentes.indexOf(p) !== -1;
      if (s < noCiclo.length) {
        if (presente) escala[p] = [noCiclo[s]];
        else monte.unshift(noCiclo[s]);
      } else if (presente) {
        escala[p] = [];
        sobra.push(p);
      }
    });
    presentes.forEach(function (p) {
      if (escala[p].length) registrarTurno(estado, escala[p][0], p, estado.dia, presentes);
    });

    // Rodadas do monte que já foram completadas pelos presentes reiniciam.
    monte.forEach(function (v) {
      var r = estado.rodada[v];
      if (presentes.every(function (p) { return r[p]; })) estado.rodada[v] = {};
    });

    // 1ª passada: quem está de sobra pega no máximo 1. Se ainda restar tarefa
    // (muita gente ausente), distribui entre todos os presentes, 1 por vez.
    var candidatos = sobra.length ? sobra : presentes;
    while (monte.length && candidatos.length) {
      var escolha = distribuir(candidatos, monte, estado), usadas = {};
      escolha.forEach(function (j, i) {
        if (j < 0) return;
        escala[candidatos[i]].push(monte[j]);
        usadas[j] = true;
        registrarTurno(estado, monte[j], candidatos[i], estado.dia, presentes);
      });
      monte = monte.filter(function (_, j) { return !usadas[j]; });
      candidatos = presentes;
    }
    presentes.forEach(function (p) { if (!escala[p].length) escala[p] = [FOLGA]; });
    return escala;
  }

  // Simula do início até `ate` (inclusive). Retorna a lista de dias úteis
  // com escala final (já com substituições e pagamentos de dívida) e as dívidas abertas.
  function simular(dados, ate) {
    var cfg = normalizar(dados);
    var estado = { dia: 0, k: 0, rodada: {}, ultimo: {} };
    var atrasadas = []; // semanais que caíram em feriado vão para o próximo dia útil
    cfg.tarefas.forEach(function (t) { estado.rodada[t.nome] = {}; estado.ultimo[t.nome] = {}; });
    estado.rodada[FOLGA] = {}; estado.ultimo[FOLGA] = {};

    var dividas = []; // { devedor, credor, desde, tarefa }
    var dias = [];
    var iSub = 0;
    if (!cfg.inicio || !cfg.pessoas.length) return { dias: dias, dividas: dividas };

    for (var data = cfg.inicio; data <= ate; data = somaDias(data, 1)) {
      var dow = diaDaSemana(data);
      if (DIAS_UTEIS.indexOf(dow) === -1) continue;
      var doDiaSemana = cfg.tarefas.filter(function (t) {
        return !todoDiaUtil(t) && t.dias.indexOf(dow) !== -1;
      }).map(function (t) { return t.nome; });
      var pendentes = atrasadas.concat(doDiaSemana.filter(function (t) { return atrasadas.indexOf(t) === -1; }));
      if (cfg.feriados[data]) {
        atrasadas = pendentes;
        dias.push({ data: data, feriado: cfg.feriados[data], itens: [] });
        continue;
      }
      atrasadas = [];
      var presentes = cfg.pessoas.filter(function (p) { return !ausente(cfg, p, data); });
      if (!presentes.length) { dias.push({ data: data, itens: [], presentes: [] }); continue; }
      var escala = escalaDoDia(cfg, estado, pendentes, presentes);
      estado.dia++;
      estado.k++;

      // itens: { pessoa, tarefa, escalado, motivo }
      var itens = [];
      presentes.forEach(function (p) {
        escala[p].forEach(function (t) { itens.push({ pessoa: p, tarefa: t, escalado: p }); });
      });

      // Pagamento de dívidas (ordem de criação; 1 por devedor e 1 por credor por dia).
      var pagou = {}, recebeu = {};
      dividas = dividas.filter(function (d) {
        if (d.desde >= data || pagou[d.devedor] || recebeu[d.credor]) return true;
        if (presentes.indexOf(d.devedor) === -1 || presentes.indexOf(d.credor) === -1) return true;
        var item = itens.filter(function (it) {
          return it.pessoa === d.credor && it.tarefa !== FOLGA;
        })[0];
        if (!item) return true;
        item.pessoa = d.devedor;
        item.motivo = { tipo: 'pagamento', credor: d.credor };
        // Se o devedor estava de folga, a folga dá lugar ao pagamento.
        itens = itens.filter(function (it) { return !(it.pessoa === d.devedor && it.tarefa === FOLGA); });
        itens.push({ pessoa: d.credor, tarefa: FOLGA, escalado: d.credor, motivo: { tipo: 'recebeu', devedor: d.devedor } });
        pagou[d.devedor] = recebeu[d.credor] = true;
        return false;
      });

      // Substituições registradas neste dia.
      while (iSub < cfg.substituicoes.length && cfg.substituicoes[iSub].data < data) iSub++;
      while (iSub < cfg.substituicoes.length && cfg.substituicoes[iSub].data === data) {
        var s = cfg.substituicoes[iSub++];
        var alvo = itens.filter(function (it) {
          return it.pessoa === s.faltou && it.tarefa === s.tarefa && !(it.motivo && it.motivo.tipo === 'cobriu');
        })[0];
        if (!alvo || s.cobriu === s.faltou || cfg.pessoas.indexOf(s.cobriu) === -1) continue;
        alvo.pessoa = s.cobriu;
        alvo.motivo = { tipo: 'cobriu', faltou: s.faltou };
        dividas.push({ devedor: s.faltou, credor: s.cobriu, desde: data, tarefa: s.tarefa });
      }

      dias.push({ data: data, itens: itens, presentes: presentes });
    }
    // Pessoas removidas da lista não carregam dívida.
    dividas = dividas.filter(function (d) {
      return cfg.pessoas.indexOf(d.devedor) !== -1 && cfg.pessoas.indexOf(d.credor) !== -1;
    });
    return { dias: dias, dividas: dividas };
  }

  // Visão de um dia para uma pessoa.
  function doDia(resultado, data, nome) {
    var dia = resultado.dias.filter(function (d) { return d.data === data; })[0];
    if (!dia) return null;
    return {
      data: data,
      feriado: dia.feriado,
      ausente: !dia.feriado && dia.presentes.indexOf(nome) === -1,
      itens: dia.itens.filter(function (it) { return it.pessoa === nome; }),
      cobriramMeu: dia.itens.filter(function (it) {
        return it.motivo && it.motivo.tipo === 'cobriu' && it.motivo.faltou === nome;
      })
    };
  }

  function proximosDiasUteis(desde, n, incluirDesde) {
    var lista = [], d = incluirDesde ? desde : somaDias(desde, 1);
    while (lista.length < n) {
      if (DIAS_UTEIS.indexOf(diaDaSemana(d)) !== -1) lista.push(d);
      d = somaDias(d, 1);
    }
    return lista;
  }

  return {
    FOLGA: FOLGA,
    simular: simular,
    doDia: doDia,
    lerDias: lerDias,
    somaDias: somaDias,
    diaDaSemana: diaDaSemana,
    proximosDiasUteis: proximosDiasUteis
  };
});
