// Cole aqui a URL do App da Web do Google Apps Script (termina em /exec).
// Enquanto estiver vazia, o app roda em MODO DEMONSTRAÇÃO: usa a lista padrão
// e guarda as substituições só neste celular.
window.FAXINA_CONFIG = {
  API_URL: '',
  FUSO: 'America/Sao_Paulo',
  DEMO: {
    inicio: '2026-10-26',
    pessoas: ['Gabriel', 'Pietro', 'Jhonathan', 'Ryan', 'Arthur'],
    tarefas: [
      { nome: 'Lavar a louça', dias: 'Seg a Sex' },
      { nome: 'Tirar lixos', dias: 'Seg a Sex' },
      { nome: 'Limpar as mesas', dias: 'Seg a Sex' },
      { nome: 'Lavar quintal', dias: 'Seg' },
      { nome: 'Passar pano na escada', dias: 'Seg' },
      { nome: 'Lavar o banheiro', dias: 'Ter' }
    ],
    ausencias: [],
    feriados: [
      { data: '2026-11-02', descricao: 'Finados' },
      { data: '2026-11-20', descricao: 'Consciência Negra' },
      { data: '2026-12-25', descricao: 'Natal' }
    ],
    substituicoes: []
  }
};
