// app.js
// Observação: este app lê data.json em 2 formatos:
// 1) array (formato antigo)
// 2) { meta: {...}, registros: [...] } (formato novo)

const DAYS = [
  { key: 'SEG', label: 'Seg' },
  { key: 'TER', label: 'Ter' },
  { key: 'QUA', label: 'Qua' },
  { key: 'QUI', label: 'Qui' },
  { key: 'SEX', label: 'Sex' },
];

let data = [];
let activeDay = guessTodayKey();

// Estado da UI (o que você mexe)
let uiState = {
  rota: 'TODAS',
  ag: 'TODOS',
  periodo: 'AMBOS',
  query: ''
};

// Estado aplicado (só muda quando clica OK)
let appliedState = { ...uiState };

const $days = document.getElementById('days');
const $list = document.getElementById('list');
const $meta = document.getElementById('meta');
const $updatedAt = document.getElementById('updatedAt');
const $q = document.getElementById('q');
const $footer = document.getElementById('footer');
const $refreshBtn = document.getElementById('refreshBtn');
const $applyBtn = document.getElementById('applyBtn');
const $rota = document.getElementById('rota');
const $ag = document.getElementById('ag');
const $periodo = document.getElementById('periodo');

function guessTodayKey() {
  const map = ['DOM','SEG','TER','QUA','QUI','SEX','SAB'];
  const k = map[new Date().getDay()];
  return (k === 'DOM' || k === 'SAB') ? 'SEG' : k;
}

function normalize(s) {
  return (s ?? '')
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function isISODateString(v){
  const s = (v ?? '').toString().trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s);
}

function toHHmm(v){
  if (v == null) return '';
  const s = v.toString().trim();

  // Ex: "15:00-17:00" ou "15:00 - 17:00"
  const range = s.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (range) return `${range[1]}-${range[2]}`;

  // Ex: "15:00"
  const hm = s.match(/^\d{1,2}:\d{2}$/);
  if (hm) return s;

  // Ex: ISO "1899-12-30T16:00:00.000Z"
  if (isISODateString(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const hh = String(d.getHours()).padStart(2,'0');
      const mm = String(d.getMinutes()).padStart(2,'0');
      return `${hh}:${mm}`;
    }
  }

  // qualquer outro texto: retorna como está
  return s;
}

function hasTimeValue(v){
  const t = toHHmm(v).trim();
  if (!t) return false;
  if (t === '0' || t === '00:00') return false;
  return true;
}

function extractFirstTime(s) {
  const t = toHHmm(s);
  const m = (t || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return 9999;
  return parseInt(m[1].padStart(2,'0') + m[2], 10);
}

function rowStartTime(row) {
  return Math.min(extractFirstTime(row.manha), extractFirstTime(row.tarde));
}

function isAgendado(row) {
  return (row.agendado || '').toString().trim().toUpperCase() === 'S';
}

function matchesQuery(row, q) {
  if (!q) return true;
  const hay = normalize([
    row.rota,
    row.medico_nome, row.especialidade, row.cidade, row.bairro, row.endereco,
    row.observacao, row.telefone, row.celular, row.email,
    row.manha, row.tarde,
    row.agendado
  ].join(' | '));
  return hay.includes(q);
}

function buildWazeLink(row) {
  const parts = [];
  if (row.endereco) parts.push(row.endereco);
  if (row.bairro) parts.push(row.bairro);
  if (row.cidade) parts.push(row.cidade);
  const q = parts.filter(Boolean).join(', ');
  if (!q) return null;

  return `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes`;
}

function renderDays() {
  $days.innerHTML = '';
  DAYS.forEach(d => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-btn' + (d.key === activeDay ? ' active' : '');
    btn.textContent = d.label;
    btn.onclick = () => {
      activeDay = d.key;
      // ao trocar o dia, já atualiza (dia é navegação, não filtro)
      renderDays();
      render();
    };
    $days.appendChild(btn);
  });
}

function render() {
  const q = normalize(appliedState.query);
  const rota = appliedState.rota;
  const ag = appliedState.ag;
  const periodo = appliedState.periodo;

  const filtered = data
    .filter(r => (r.dia_semana || '').toUpperCase() === activeDay)
    .filter(r => (rota === 'TODAS' ? true : (r.rota || '') === rota))
    .filter(r => {
      const v = (r.agendado || '').toString().trim().toUpperCase();
      if (ag === 'S') return v === 'S';
      if (ag === 'N') return v === 'N' || v === '';
      return true;
    })
    .filter(r => {
      if (periodo === 'MANHA') return hasTimeValue(r.manha);
      if (periodo === 'TARDE') return hasTimeValue(r.tarde);
      return true;
    })
    .filter(r => matchesQuery(r, q))
    .sort((a,b) => rowStartTime(a) - rowStartTime(b));

  $meta.textContent = `${filtered.length} atendimento(s) em ${activeDay} • Total de registros: ${data.length}`;
  $list.innerHTML = '';

  if (filtered.length === 0) {
    const div = document.createElement('div');
    div.className = 'empty';
    div.textContent = 'Nenhum atendimento encontrado para este dia com esse filtro.';
    $list.appendChild(div);
    return;
  }

  filtered.forEach(r => {
    const card = document.createElement('div');
    card.className = 'card';

    const title = document.createElement('div');
    title.className = 'title';

    const name = document.createElement('p');
    name.className = 'name';
    name.textContent = r.medico_nome || '(Sem nome)';

    const time = document.createElement('div');
    time.className = 'time';

    if (isAgendado(r)) {
      const badge = document.createElement('span');
      badge.className = 'badge-ag';
      badge.textContent = 'AGENDADO';
      time.appendChild(badge);
    } else {
      const parts = [];
      if (hasTimeValue(r.manha)) parts.push(`Manhã: ${toHHmm(r.manha)}`);
      if (hasTimeValue(r.tarde)) parts.push(`Tarde: ${toHHmm(r.tarde)}`);
      time.textContent = parts.length ? parts.join(' • ') : '';
    }

    title.appendChild(name);
    title.appendChild(time);

    const sub = document.createElement('div');
    sub.className = 'sub';
    const pieces = [r.especialidade, r.cidade, r.rota ? `Rota: ${r.rota}` : ''].filter(Boolean);
    sub.textContent = pieces.join(' • ');

    const pills = document.createElement('div');
    pills.className = 'pills';

    const pillItems = [
      r.bairro ? `Bairro: ${r.bairro}` : '',
      r.telefone ? `Tel: ${r.telefone}` : '',
      r.celular ? `Cel: ${r.celular}` : '',
      r.email ? `E-mail: ${r.email}` : '',
    ].filter(Boolean);

    pillItems.forEach(t => {
      const p = document.createElement('span');
      p.className = 'pill';
      p.textContent = t;
      pills.appendChild(p);
    });

    const addr = document.createElement('div');
    addr.className = 'addr';
    const waze = buildWazeLink(r);

    if (waze) {
      const a = document.createElement('a');
      a.href = waze;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const label = [r.endereco, r.cep ? `CEP: ${r.cep}` : ''].filter(Boolean).join(' • ') || 'Abrir no Waze';
      a.textContent = label + ' • (Abrir no Waze)';
      addr.appendChild(a);
    } else {
      const addrPieces = [r.endereco, r.cep ? `CEP: ${r.cep}` : ''].filter(Boolean);
      if (addrPieces.length) addr.textContent = addrPieces.join(' • ');
    }

    const obs = document.createElement('div');
    obs.className = 'obs';
    if (r.observacao) obs.textContent = `Obs: ${r.observacao}`;

    card.appendChild(title);
    card.appendChild(sub);
    if (pills.childNodes.length) card.appendChild(pills);
    if (addr.textContent || addr.childNodes.length) card.appendChild(addr);
    if (r.observacao) card.appendChild(obs);

    $list.appendChild(card);
  });
}

function setUpdatedAtText(payload, fallbackTotal) {
  if (Array.isArray(payload)) {
    $updatedAt.textContent = '';
    return;
  }
  const meta = payload?.meta || {};
  const total = (typeof meta.total_registros === 'number') ? meta.total_registros : fallbackTotal;

  if (meta.updated_at) {
    const d = new Date(meta.updated_at);
    const ok = !isNaN(d.getTime());
    $updatedAt.textContent = ok
      ? `Última atualização: ${d.toLocaleString('pt-BR')} • Registros: ${total}`
      : `Registros: ${total}`;
  } else {
    $updatedAt.textContent = `Registros: ${total}`;
  }
}

async function load() {
  try {
    $meta.textContent = 'Carregando…';
    $list.innerHTML = '';

    const url = './data.json?v=' + Date.now();
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Falha ao carregar data.json');

    const payload = await res.json();

    if (Array.isArray(payload)) {
      data = payload;
      setUpdatedAtText(payload, data.length);
    } else {
      data = Array.isArray(payload.registros) ? payload.registros : [];
      setUpdatedAtText(payload, data.length);
    }

    renderDays();
    render();

    $footer.textContent = `Dica: no celular, toque no endereço para abrir no Waze.`;
  } catch (e) {
    $meta.textContent = 'Erro ao carregar dados.';
    $updatedAt.textContent = '';
    $list.innerHTML = `<div class="empty">${String(e.message || e)}<br><br>
    Dica: confirme se <b>data.json</b> está no mesmo diretório do <b>index.html</b>.
    </div>`;
  }
}

/* =========================
   Eventos (UI -> uiState)
   Aplicação só no OK
========================= */

$q.addEventListener('input', (ev) => {
  uiState.query = ev.target.value || '';
});

// Enter na busca aplica filtros
$q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') applyFilters();
});

$rota.addEventListener('change', (e) => {
  uiState.rota = e.target.value;
});

$ag.addEventListener('change', (e) => {
  uiState.ag = e.target.value;
});

$periodo.addEventListener('click', (e) => {
  const btn = e.target.closest('.toggle-btn');
  if (!btn) return;
  uiState.periodo = btn.dataset.p;

  // marca ativo visualmente (mesmo antes de aplicar)
  [...$periodo.querySelectorAll('.toggle-btn')].forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
});

function applyFilters(){
  appliedState = { ...uiState };
  render();
}

$applyBtn.addEventListener('click', applyFilters);

// Recarrega o JSON e mantém filtros aplicados
$refreshBtn.addEventListener('click', async () => {
  await load();
});

load();
