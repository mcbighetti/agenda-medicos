// app.js — versão robusta + filtros corretos + ordem alfabética
const RAW_DATA_URL_BASE = "https://raw.githubusercontent.com/mcbighetti/agenda-medicos/main/data.json";

const DAYS = [
  { key: 'SEG', label: 'Seg' },
  { key: 'TER', label: 'Ter' },
  { key: 'QUA', label: 'Qua' },
  { key: 'QUI', label: 'Qui' },
  { key: 'SEX', label: 'Sex' },
];

let data = [];
let activeDay = guessTodayKey();

// UI state (o que você mexe)
let uiState = { rota: 'TODAS', ag: 'TODOS', periodo: 'AMBOS', query: '' };
// Estado aplicado (só muda quando clica OK)
let appliedState = { ...uiState };

// elementos (podem ser null — vamos proteger)
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

function getField(row, candidates) {
  for (const key of candidates) if (key in row) return row[key];
  const keys = Object.keys(row);
  for (const k of keys) {
    const nk = normalize(k).replace(/\s+/g,'');
    for (const c of candidates) {
      const nc = normalize(c).replace(/\s+/g,'');
      if (nk === nc) return row[k];
    }
  }
  return undefined;
}

function isISODateString(v){
  const s = (v ?? '').toString().trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z)?$/.test(s);
}

function excelFractionToHHmm(n){
  if (typeof n !== 'number') return '';
  if (!(n >= 0 && n < 1)) return '';
  const totalMinutes = Math.round(n * 24 * 60);
  const hh = String(Math.floor(totalMinutes / 60) % 24).padStart(2,'0');
  const mm = String(totalMinutes % 60).padStart(2,'0');
  return `${hh}:${mm}`;
}

// Extrai 1 ou 2 horários de QUALQUER texto
function extractTimeRange(raw){
  if (raw == null) return { start: '', end: '', raw: '' };

  if (typeof raw === 'number') {
    const hhmm = excelFractionToHHmm(raw);
    return { start: hhmm, end: '', raw: hhmm };
  }

  const s = raw.toString().trim();
  if (!s) return { start: '', end: '', raw: '' };

  if (isISODateString(s)) {
    const m = s.match(/T(\d{2}):(\d{2}):/);
    const hhmm = m ? `${m[1]}:${m[2]}` : '';
    return { start: hhmm, end: '', raw: hhmm || s };
  }

  const times = [...s.matchAll(/(\d{1,2}):(\d{2})/g)].map(m => {
    const hh = String(m[1]).padStart(2,'0');
    const mm = m[2];
    return `${hh}:${mm}`;
  });

  if (times.length === 0) return { start: '', end: '', raw: s };
  if (times.length === 1) return { start: times[0], end: '', raw: s };

  return { start: times[0], end: times[1], raw: s };
}

function hasTimeValue(v){
  const { start, end, raw } = extractTimeRange(v);
  if ((start || end || '').trim()) return true;
  return /(\d{1,2}):(\d{2})/.test(String(raw || ''));
}

function displayRange(v){
  const { start, end, raw } = extractTimeRange(v);
  if (start && end) return `${start} às ${end}`;
  if (start) return `${start}`;
  const t = (raw || '').toString().trim();
  return t;
}

function isAgendado(row) {
  const ag = getField(row, ['agendado','AGENDADO','AGENDADO?','Agendado']);
  return (ag || '').toString().trim().toUpperCase() === 'S';
}

function matchesQuery(row, q) {
  if (!q) return true;

  const manha = getField(row, ['manha','MANHA','MANHÃ','Manhã','Manha']);
  const tarde = getField(row, ['tarde','TARDE','Tarde']);
  const ag = getField(row, ['agendado','AGENDADO','AGENDADO?','Agendado']);

  const hay = normalize([
    row.rota, row.medico_nome, row.especialidade, row.cidade, row.bairro, row.endereco,
    row.observacao, row.telefone, row.celular, row.email,
    String(manha ?? ''), String(tarde ?? ''), String(ag ?? '')
  ].join(' | '));

  return hay.includes(q);
}

function buildWazeLink(row) {
  const parts = [];
  if (row.endereco) parts.push(row.endereco);
  if (row.bairro) parts.push(row.bairro);
  if (row.cidade) parts.push(row.cidade);
  const qq = parts.filter(Boolean).join(', ');
  if (!qq) return null;
  return `https://waze.com/ul?q=${encodeURIComponent(qq)}&navigate=yes`;
}

function renderDays() {
  if (!$days) return;
  $days.innerHTML = '';

  DAYS.forEach(d => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'day-btn' + (d.key === activeDay ? ' active' : '');
    btn.textContent = d.label;
    btn.onclick = () => {
      activeDay = d.key;
      renderDays();
      render();
    };
    $days.appendChild(btn);
  });
}

function setUpdatedAtText(payload, fallbackTotal) {
  if (!$updatedAt) return;

  if (Array.isArray(payload)) {
    $updatedAt.textContent = `Registros: ${fallbackTotal}`;
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

function makeTimeBlock(manha, tarde){
  const wrap = document.createElement('div');
  wrap.className = 'times';

  if (hasTimeValue(manha)) {
    const row = document.createElement('div');
    row.className = 'time-row';
    row.innerHTML = `<span class="time-label">Manhã</span><span class="time-value">${displayRange(manha)}</span>`;
    wrap.appendChild(row);
  }

  if (hasTimeValue(tarde)) {
    const row = document.createElement('div');
    row.className = 'time-row';
    row.innerHTML = `<span class="time-label">Tarde</span><span class="time-value">${displayRange(tarde)}</span>`;
    wrap.appendChild(row);
  }

  return wrap;
}

/**
 * ✅ Regra de período (como você pediu):
 * - MANHA: só quem tem horário de manhã naquele dia
 * - TARDE: só quem tem horário de tarde naquele dia
 * - AMBOS: quem tem manhã OU tarde
 *
 * Importante: AGENDADO NÃO "fura" essa regra.
 */
function matchPeriodo(row, periodo){
  const manha = getField(row, ['manha','MANHA','MANHÃ','Manhã','Manha']);
  const tarde = getField(row, ['tarde','TARDE','Tarde']);

  const hasM = hasTimeValue(manha);
  const hasT = hasTimeValue(tarde);

  if (periodo === 'MANHA') return hasM;
  if (periodo === 'TARDE') return hasT;
  return (hasM || hasT); // AMBOS
}

function render() {
  if (!$list || !$meta) return;

  const q = normalize(appliedState.query);
  const rota = appliedState.rota;
  const agFilter = appliedState.ag;
  const periodo = appliedState.periodo;

  const filtered = data
    .filter(r => (r.dia_semana || '').toUpperCase() === activeDay)
    .filter(r => (rota === 'TODAS' ? true : (r.rota || '') === rota))
    .filter(r => {
      const ag = getField(r, ['agendado','AGENDADO','AGENDADO?','Agendado']);
      const v = (ag || '').toString().trim().toUpperCase();
      if (agFilter === 'S') return v === 'S';
      if (agFilter === 'N') return v === 'N' || v === '';
      return true;
    })
    .filter(r => matchPeriodo(r, periodo))
    .filter(r => matchesQuery(r, q))
    // ✅ ordem alfabética
    .sort((a,b) => (a.medico_nome || '').localeCompare((b.medico_nome || ''), 'pt-BR', { sensitivity: 'base' }));

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

    const right = document.createElement('div');
    if (isAgendado(r)) {
      const badge = document.createElement('span');
      badge.className = 'badge-ag';
      badge.textContent = 'AGENDADO';
      right.appendChild(badge);
    }

    title.appendChild(name);
    title.appendChild(right);

    const sub = document.createElement('div');
    sub.className = 'sub';
    const pieces = [r.especialidade, r.cidade, r.rota ? `Rota: ${r.rota}` : ''].filter(Boolean);
    sub.textContent = pieces.join(' • ');

    const manha = getField(r, ['manha','MANHA','MANHÃ','Manhã','Manha']);
    const tarde = getField(r, ['tarde','TARDE','Tarde']);
    const timeBlock = makeTimeBlock(manha, tarde);

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
    if (timeBlock.childNodes.length) card.appendChild(timeBlock);
    if (pills.childNodes.length) card.appendChild(pills);
    if (addr.textContent || addr.childNodes.length) card.appendChild(addr);
    if (r.observacao) card.appendChild(obs);

    $list.appendChild(card);
  });
}

async function load() {
  try {
    if ($meta) $meta.textContent = 'Carregando…';
    if ($refreshBtn) $refreshBtn.disabled = true;

    const url = RAW_DATA_URL_BASE + "?v=" + Date.now();
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

    if ($footer) $footer.textContent = `Dica: no celular, toque no endereço para abrir no Waze.`;
  } catch (e) {
    if ($meta) $meta.textContent = 'Erro ao carregar dados.';
    if ($updatedAt) $updatedAt.textContent = '';
    if ($list) $list.innerHTML = `<div class="empty">${String(e.message || e)}<br><br>
      Se travar em "Carregando…", abra o console (F12) e veja o erro. Normalmente é ID faltando no index.html.
    </div>`;
    // log para diagnóstico
    console.error(e);
  } finally {
    if ($refreshBtn) $refreshBtn.disabled = false;
  }
}

/* Eventos (com proteção null) */
if ($q) {
  $q.addEventListener('input', (ev) => { uiState.query = ev.target.value || ''; });
  $q.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyFilters(); });
}
if ($rota) $rota.addEventListener('change', (e) => { uiState.rota = e.target.value; });
if ($ag) $ag.addEventListener('change', (e) => { uiState.ag = e.target.value; });

if ($periodo) {
  $periodo.addEventListener('click', (e) => {
    const btn = e.target.closest('.toggle-btn');
    if (!btn) return;
    uiState.periodo = btn.dataset.p;
    [...$periodo.querySelectorAll('.toggle-btn')].forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
}

function applyFilters(){
  appliedState = { ...uiState };
  render();
}

if ($applyBtn) $applyBtn.addEventListener('click', applyFilters);
if ($refreshBtn) $refreshBtn.addEventListener('click', async () => { await load(); });

load();
