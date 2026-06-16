/**
 * TASKFLOW — Kanban Board  |  app.js
 *
 * Architecture:
 *   State    — single source of truth (board object)
 *   Storage  — load / save to localStorage
 *   Render   — pure render functions; DOM always reflects state
 *   Events   — all listeners wired at the bottom in init()
 *   Drag     — HTML Drag & Drop API
 *   Modal    — generic open/close helpers
 *
 * No frameworks. No build step. Open index.html and go.
 */

'use strict';

/* ════════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════════ */

const STORAGE_KEY = 'taskflow_board_v1';
const THEME_KEY   = 'taskflow_theme';

const LABEL_META = {
  bug:      { icon: '🔴', text: 'Bug' },
  feature:  { icon: '🟣', text: 'Feature' },
  design:   { icon: '🩷', text: 'Design' },
  research: { icon: '🟡', text: 'Research' },
  docs:     { icon: '🩵', text: 'Docs' },
};

/* ════════════════════════════════════════════════
   STATE
   board = { columns: [ { id, title, color, cards: [card, …] } ] }
   card  = { id, title, desc, priority, label, due, createdAt }
════════════════════════════════════════════════ */

let board = { columns: [] };

// Track drag state
let drag = {
  cardId: null,
  srcColId: null,
  ghostEl: null,  // placeholder DOM element
};

// Track modal editing
let editingCardId  = null;
let editingCardCol = null;

// Active filter state
let activeLabel = 'all';
let activeSearch = '';

/* ════════════════════════════════════════════════
   STORAGE
════════════════════════════════════════════════ */

function loadBoard() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      board = JSON.parse(raw);
    } else {
      board = defaultBoard();
    }
  } catch (e) {
    console.warn('TaskFlow: failed to parse saved board, loading default.', e);
    board = defaultBoard();
  }
}

function saveBoard() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch (e) {
    console.error('TaskFlow: localStorage save failed.', e);
    toast('Could not save — storage may be full.', 'error');
  }
}

function defaultBoard() {
  return {
    columns: [
      {
        id: uid(),
        title: 'To Do',
        color: '#6366f1',
        cards: [
          makeCard('Define project scope',       'Gather requirements and write the spec document.', 'high',   'feature', daysFromNow(4)),
          makeCard('Wireframe landing page',      'Low-fidelity sketches for hero, features, CTA.', 'medium', 'design',  daysFromNow(6)),
          makeCard('Set up repo & CI pipeline',   'GitHub Actions: lint → test → deploy on push.',  'medium', 'docs',    daysFromNow(3)),
          makeCard('Write user stories',          '',                                                'low',    'feature', daysFromNow(7)),
        ],
      },
      {
        id: uid(),
        title: 'In Progress',
        color: '#f59e0b',
        cards: [
          makeCard('Build REST API endpoints',    'Auth, tasks, columns. Document with OpenAPI.',   'high',   'feature', daysFromNow(2)),
          makeCard('Design system tokens',        'Colors, spacing, typography, radius scales.',    'medium', 'design',  daysFromNow(5)),
          makeCard('Fix login redirect bug',      'Users get 404 after OAuth callback on Safari.',  'high',   'bug',     daysFromNow(-1)),
        ],
      },
      {
        id: uid(),
        title: 'Done',
        color: '#10b981',
        cards: [
          makeCard('Set up staging environment', 'Docker Compose + Caddy reverse proxy.',          'medium', 'docs',    daysFromNow(-3)),
          makeCard('Initial design exploration',  '',                                                'low',    'design',  daysFromNow(-5)),
        ],
      },
    ],
  };
}

/* ════════════════════════════════════════════════
   UTILITIES
════════════════════════════════════════════════ */

function uid() {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
}

function makeCard(title, desc = '', priority = 'medium', label = '', due = '') {
  return { id: uid(), title, desc, priority, label, due, createdAt: Date.now() };
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function isOverdue(iso) {
  if (!iso) return false;
  return new Date(iso + 'T00:00:00') < new Date(new Date().toDateString());
}

function escHtml(str) {
  const el = document.createElement('div');
  el.textContent = str || '';
  return el.innerHTML;
}

/** Highlight search term in text, return HTML string */
function highlightText(text, query) {
  if (!query) return escHtml(text);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${escaped})`, 'gi');
  return escHtml(text).replace(re, '<mark>$1</mark>');
}

function getColById(colId) {
  return board.columns.find(c => c.id === colId) || null;
}

function getCardById(cardId) {
  for (const col of board.columns) {
    const card = col.cards.find(c => c.id === cardId);
    if (card) return { card, col };
  }
  return null;
}

/* ════════════════════════════════════════════════
   RENDER
════════════════════════════════════════════════ */

function renderBoard() {
  const boardEl = document.getElementById('board');

  // Sync columns: add missing, remove stale, reorder
  const existingCols = Array.from(boardEl.querySelectorAll('.column'));
  const existingIds  = existingCols.map(el => el.dataset.colId);
  const wantedIds    = board.columns.map(c => c.id);

  // Remove deleted
  existingCols.forEach(el => {
    if (!wantedIds.includes(el.dataset.colId)) el.remove();
  });

  // Add/update
  board.columns.forEach((col, i) => {
    let colEl = boardEl.querySelector(`.column[data-col-id="${col.id}"]`);
    if (!colEl) {
      colEl = buildColumnEl(col);
      boardEl.appendChild(colEl);
    } else {
      updateColumnEl(colEl, col);
    }
    // Reorder in DOM
    boardEl.appendChild(colEl); // move to end in order
  });

  renderCards();
  renderStats();
}

function buildColumnEl(col) {
  const colEl = document.createElement('section');
  colEl.className = 'column';
  colEl.dataset.colId = col.id;
  colEl.setAttribute('aria-label', col.title + ' column');

  colEl.innerHTML = `
    <div class="col-accent" style="--col-color:${col.color}"></div>
    <div class="col-head">
      <div class="col-title-wrap">
        <span class="col-title" role="heading" aria-level="2"
              title="Double-click to rename">${escHtml(col.title)}</span>
        <span class="col-count" aria-label="${col.cards.length} cards">0</span>
      </div>
      <div class="col-actions">
        <button class="col-action-btn del" data-action="delete-col" data-col="${col.id}"
                aria-label="Delete column" title="Delete column">
          <svg viewBox="0 0 20 20" fill="none"><path d="M4 5h12M8 5V3h4v2M6 5l1 11h6l1-11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>
    <div class="card-list" data-col="${col.id}" role="list"
         aria-label="${col.title} cards"></div>
    <div class="add-card-area">
      <textarea class="add-card-input" data-col="${col.id}"
                placeholder="+ Add a card…" rows="1"
                aria-label="Add card to ${col.title}"></textarea>
      <div class="add-card-actions">
        <button class="btn-confirm-add" data-col="${col.id}">Add card</button>
        <button class="btn-cancel-add" data-col="${col.id}">Cancel</button>
      </div>
    </div>`;

  bindColumnEvents(colEl, col);
  return colEl;
}

function updateColumnEl(colEl, col) {
  colEl.querySelector('.col-accent').style.setProperty('--col-color', col.color);
  colEl.querySelector('.col-title').textContent = col.title;
}

function renderCards() {
  board.columns.forEach(col => {
    const listEl = document.querySelector(`.card-list[data-col="${col.id}"]`);
    if (!listEl) return;

    const filtered = col.cards.filter(card => {
      const matchLabel  = activeLabel === 'all' || card.label === activeLabel;
      const matchSearch = !activeSearch || card.title.toLowerCase().includes(activeSearch)
                          || (card.desc && card.desc.toLowerCase().includes(activeSearch));
      return matchLabel && matchSearch;
    });

    // Remove old cards + empty state
    Array.from(listEl.querySelectorAll('.task-card, .col-empty')).forEach(el => el.remove());

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'col-empty';
      empty.innerHTML = `<div class="col-empty-icon" aria-hidden="true">📭</div>
        <p>${activeSearch || activeLabel !== 'all' ? 'No matches here.' : 'No cards yet.<br>Add one below.'}</p>`;
      listEl.appendChild(empty);
    } else {
      filtered.forEach(card => {
        let cardEl = listEl.querySelector(`.task-card[data-card-id="${card.id}"]`);
        if (cardEl) {
          updateCardEl(cardEl, card);
        } else {
          cardEl = buildCardEl(card, col.id);
          listEl.appendChild(cardEl);
        }
      });
    }

    // Update count badge
    const countEl = document.querySelector(`.column[data-col-id="${col.id}"] .col-count`);
    if (countEl) countEl.textContent = col.cards.length;
  });
}

function buildCardEl(card, colId) {
  const el = document.createElement('article');
  el.className = `task-card pri-${card.priority}`;
  el.dataset.cardId = card.id;
  el.dataset.col    = colId;
  el.draggable = true;
  el.setAttribute('role', 'listitem');
  el.setAttribute('tabindex', '0');

  const isDone = getColById(colId)?.title?.toLowerCase().includes('done');
  populateCardEl(el, card, isDone);
  bindCardEvents(el);
  return el;
}

function updateCardEl(el, card) {
  el.className = `task-card pri-${card.priority}`;
  const colId = el.dataset.col;
  const isDone = getColById(colId)?.title?.toLowerCase().includes('done');
  populateCardEl(el, card, isDone);
}

function populateCardEl(el, card, isDone) {
  const overdue  = isOverdue(card.due) && !isDone;
  const labelMeta = card.label ? LABEL_META[card.label] : null;
  const titleHtml = highlightText(card.title, activeSearch);

  el.innerHTML = `
    ${labelMeta ? `<div class="card-label-tag ${card.label}">${labelMeta.text}</div>` : ''}
    <p class="card-title${isDone ? ' done-text' : ''}">${titleHtml}</p>
    ${card.desc ? `<p class="card-desc">${escHtml(card.desc)}</p>` : ''}
    <div class="card-footer">
      ${card.due ? `
        <span class="due-chip${overdue ? ' overdue' : ''}" title="${overdue ? 'Overdue!' : 'Due date'}">
          <svg viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3 8h14M7 2v3M13 2v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          ${fmtDate(card.due)}${overdue ? ' ⚠' : ''}
        </span>` : '<span></span>'}
      <div class="card-actions">
        <button class="card-act-btn" data-action="edit-card" data-card="${card.id}"
                aria-label="Edit card" title="Edit">
          <svg viewBox="0 0 20 20" fill="none"><path d="M4 13.5V16h2.5l7-7-2.5-2.5-7 7zm11.7-6.8a.7.7 0 000-1L14.3 4.3a.7.7 0 00-1 0l-1.2 1.2 2.5 2.5 1.1-1.1z" fill="currentColor"/></svg>
        </button>
        <button class="card-act-btn del" data-action="delete-card" data-card="${card.id}"
                aria-label="Delete card" title="Delete">
          <svg viewBox="0 0 20 20" fill="none"><path d="M4 5h12M8 5V3h4v2M6 5l1 11h6l1-11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    </div>`;
}

function renderStats() {
  const total = board.columns.reduce((s, c) => s + c.cards.length, 0);
  const doneCol = board.columns.find(c => c.title.toLowerCase().includes('done'));
  const done  = doneCol ? doneCol.cards.length : 0;
  const pct   = total ? Math.round((done / total) * 100) : 0;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statDone').textContent  = done;
  document.getElementById('statPct').textContent   = pct + '%';
  const fill = document.getElementById('statFill');
  fill.style.width = pct + '%';
  fill.parentElement.setAttribute('aria-valuenow', pct);
}

/* ════════════════════════════════════════════════
   CARD CRUD
════════════════════════════════════════════════ */

function addCard(colId, title) {
  title = title.trim();
  if (!title) return;
  const col = getColById(colId);
  if (!col) return;
  col.cards.push(makeCard(title));
  saveBoard();
  renderBoard();
  toast('Card added.', 'success');
}

function deleteCard(cardId) {
  const { col } = getCardById(cardId) || {};
  if (!col) return;
  col.cards = col.cards.filter(c => c.id !== cardId);
  saveBoard();
  renderBoard();
  toast('Card deleted.', 'error');
}

function updateCard(cardId, updates) {
  const { card } = getCardById(cardId) || {};
  if (!card) return;
  Object.assign(card, updates);
  saveBoard();
  renderBoard();
  toast('Card updated.', 'success');
}

function moveCardToCol(cardId, destColId) {
  const found = getCardById(cardId);
  if (!found) return;
  const { card, col: srcCol } = found;
  const destCol = getColById(destColId);
  if (!destCol || srcCol.id === destColId) return;
  srcCol.cards = srcCol.cards.filter(c => c.id !== cardId);
  destCol.cards.push(card);
  saveBoard();
  renderBoard();
  toast(`Moved to "${destCol.title}".`, 'success');
}

/* ════════════════════════════════════════════════
   COLUMN CRUD
════════════════════════════════════════════════ */

function addColumn(title, color) {
  title = title.trim();
  if (!title) return;
  board.columns.push({ id: uid(), title, color, cards: [] });
  saveBoard();
  renderBoard();
  // Scroll board to end so new column is visible
  const scroll = document.querySelector('.board-scroll');
  if (scroll) setTimeout(() => scroll.scrollLeft = scroll.scrollWidth, 50);
  toast(`Column "${title}" added.`, 'success');
}

function deleteColumn(colId) {
  const col = getColById(colId);
  if (!col) return;
  if (col.cards.length > 0) {
    if (!confirm(`"${col.title}" has ${col.cards.length} card(s). Delete everything?`)) return;
  }
  board.columns = board.columns.filter(c => c.id !== colId);
  saveBoard();
  renderBoard();
  toast('Column deleted.', 'error');
}

function renameColumn(colId, newTitle) {
  newTitle = newTitle.trim();
  if (!newTitle) return;
  const col = getColById(colId);
  if (!col) return;
  col.title = newTitle;
  saveBoard();
  renderStats();
}

/* ════════════════════════════════════════════════
   DRAG & DROP
════════════════════════════════════════════════ */

function handleDragStart(e) {
  const cardEl = e.currentTarget;
  drag.cardId  = cardEl.dataset.cardId;
  drag.srcColId = cardEl.dataset.col;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', drag.cardId);
  requestAnimationFrame(() => cardEl.classList.add('dragging'));
}

function handleDragEnd(e) {
  const cardEl = e.currentTarget;
  cardEl.classList.remove('dragging', 'drag-above', 'drag-below');
  cleanupDragUI();
  drag.cardId = null;
  drag.srcColId = null;
}

function cleanupDragUI() {
  document.querySelectorAll('.drop-ghost').forEach(el => el.remove());
  document.querySelectorAll('.column.drag-over').forEach(el => el.classList.remove('drag-over'));
  document.querySelectorAll('.task-card.drag-above, .task-card.drag-below').forEach(el => {
    el.classList.remove('drag-above', 'drag-below');
  });
}

function handleColDragOver(e, colId) {
  if (!drag.cardId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const colEl = document.querySelector(`.column[data-col-id="${colId}"]`);
  if (colEl) colEl.classList.add('drag-over');
}

function handleColDragLeave(e, colId) {
  const colEl = document.querySelector(`.column[data-col-id="${colId}"]`);
  const list  = colEl?.querySelector('.card-list');
  if (list && !list.contains(e.relatedTarget) && !colEl.contains(e.relatedTarget)) {
    colEl.classList.remove('drag-over');
  }
}

function handleColDrop(e, destColId) {
  e.preventDefault();
  if (!drag.cardId) return;

  const cardId = e.dataTransfer.getData('text/plain') || drag.cardId;
  const found  = getCardById(cardId);
  if (!found) return cleanupDragUI();

  const { card, col: srcCol } = found;

  // Determine insert position by looking at card elements
  const listEl = document.querySelector(`.card-list[data-col="${destColId}"]`);
  const cardEls = listEl ? Array.from(listEl.querySelectorAll('.task-card')) : [];

  let insertBefore = null; // null = append to end

  for (const el of cardEls) {
    const rect = el.getBoundingClientRect();
    const mid  = rect.top + rect.height / 2;
    if (e.clientY < mid) {
      insertBefore = el.dataset.cardId;
      break;
    }
  }

  // Remove from source
  srcCol.cards = srcCol.cards.filter(c => c.id !== cardId);

  // Insert into destination
  const destCol = getColById(destColId);
  if (!destCol) return cleanupDragUI();

  if (insertBefore) {
    const idx = destCol.cards.findIndex(c => c.id === insertBefore);
    destCol.cards.splice(idx >= 0 ? idx : destCol.cards.length, 0, card);
  } else {
    destCol.cards.push(card);
  }

  saveBoard();
  cleanupDragUI();
  renderBoard();

  if (srcCol.id !== destColId) {
    toast(`Moved to "${destCol.title}".`, 'success');
  }
}

// Card-level dragover for reorder visual hints
function handleCardDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  const cardEl = e.currentTarget;
  if (cardEl.dataset.cardId === drag.cardId) return;
  const rect = cardEl.getBoundingClientRect();
  const mid  = rect.top + rect.height / 2;
  document.querySelectorAll('.task-card.drag-above, .task-card.drag-below').forEach(el => {
    if (el !== cardEl) el.classList.remove('drag-above', 'drag-below');
  });
  cardEl.classList.toggle('drag-above', e.clientY < mid);
  cardEl.classList.toggle('drag-below', e.clientY >= mid);
}

function handleCardDragLeave(e) {
  e.currentTarget.classList.remove('drag-above', 'drag-below');
}

/* ════════════════════════════════════════════════
   MODAL — CARD EDIT
════════════════════════════════════════════════ */

function openCardModal(cardId) {
  const found = getCardById(cardId);
  if (!found) return;
  const { card, col } = found;

  editingCardId  = cardId;
  editingCardCol = col.id;

  document.getElementById('modalHeading').textContent      = 'Edit card';
  document.getElementById('cardTitleInput').value          = card.title;
  document.getElementById('cardDescInput').value           = card.desc || '';
  document.getElementById('cardDueInput').value            = card.due  || '';
  document.getElementById('cardLabelInput').value          = card.label || '';

  const radios = document.querySelectorAll('input[name="cardPriority"]');
  radios.forEach(r => { r.checked = r.value === (card.priority || 'medium'); });

  // Populate move-to buttons (useful on mobile, never hurts on desktop)
  const moveToBtns = document.getElementById('moveToBtns');
  moveToBtns.innerHTML = board.columns
    .filter(c => c.id !== col.id)
    .map(c => `<button class="move-to-btn" data-dest="${c.id}">${c.title} →</button>`)
    .join('');

  moveToBtns.querySelectorAll('.move-to-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      moveCardToCol(editingCardId, btn.dataset.dest);
      closeCardModal();
    });
  });

  showModal('cardModal');
  setTimeout(() => document.getElementById('cardTitleInput').focus(), 60);
}

function closeCardModal() {
  hideModal('cardModal');
  editingCardId  = null;
  editingCardCol = null;
}

function saveCardModal() {
  const title = document.getElementById('cardTitleInput').value.trim();
  if (!title) {
    document.getElementById('cardTitleInput').focus();
    toast('Please enter a title.', 'warning');
    return;
  }
  const priority = document.querySelector('input[name="cardPriority"]:checked')?.value || 'medium';

  updateCard(editingCardId, {
    title,
    desc:     document.getElementById('cardDescInput').value.trim(),
    due:      document.getElementById('cardDueInput').value,
    label:    document.getElementById('cardLabelInput').value,
    priority,
  });
  closeCardModal();
}

/* ════════════════════════════════════════════════
   MODAL — ADD COLUMN
════════════════════════════════════════════════ */

function openColModal() {
  document.getElementById('colNameInput').value = '';
  const radios = document.querySelectorAll('input[name="colColor"]');
  radios[0].checked = true;
  showModal('colModal');
  setTimeout(() => document.getElementById('colNameInput').focus(), 60);
}

function closeColModal() {
  hideModal('colModal');
}

function saveColModal() {
  const name  = document.getElementById('colNameInput').value.trim();
  const color = document.querySelector('input[name="colColor"]:checked')?.value || '#6366f1';
  if (!name) {
    document.getElementById('colNameInput').focus();
    toast('Please enter a column name.', 'warning');
    return;
  }
  addColumn(name, color);
  closeColModal();
}

/* ════════════════════════════════════════════════
   MODAL HELPERS
════════════════════════════════════════════════ */

function showModal(id) {
  const el = document.getElementById(id);
  el.hidden = false;
  el.removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
  el.addEventListener('click', outsideClickClose);
}

function hideModal(id) {
  const el = document.getElementById(id);
  el.hidden = true;
  document.body.style.overflow = '';
  el.removeEventListener('click', outsideClickClose);
}

function outsideClickClose(e) {
  if (e.target === e.currentTarget) {
    hideModal(e.currentTarget.id);
  }
}

/* ════════════════════════════════════════════════
   TOAST
════════════════════════════════════════════════ */

function toast(msg, type = 'info') {
  const zone  = document.getElementById('toastZone');
  const icons = { success: '✅', error: '🗑️', warning: '⚠️', info: 'ℹ️' };
  const el    = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span aria-hidden="true">${icons[type]}</span> ${escHtml(msg)}`;
  zone.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 2800);
}

/* ════════════════════════════════════════════════
   SEARCH & FILTER
════════════════════════════════════════════════ */

function applyFilters() {
  renderCards();
}

/* ════════════════════════════════════════════════
   EXPORT / IMPORT
════════════════════════════════════════════════ */

function exportBoard() {
  const data = JSON.stringify(board, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'taskflow-board.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Board exported.', 'success');
}

function importBoard(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      // Basic validation
      if (!imported.columns || !Array.isArray(imported.columns)) throw new Error('Invalid format');
      board = imported;
      saveBoard();
      renderBoard();
      toast('Board imported successfully.', 'success');
    } catch (err) {
      toast('Import failed: invalid JSON format.', 'error');
    }
  };
  reader.readAsText(file);
}

/* ════════════════════════════════════════════════
   THEME
════════════════════════════════════════════════ */

function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) document.documentElement.dataset.theme = saved;
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, document.documentElement.dataset.theme);
}

/* ════════════════════════════════════════════════
   EVENT BINDING HELPERS
════════════════════════════════════════════════ */

/** Bind events on a newly created column element */
function bindColumnEvents(colEl, col) {
  const listEl = colEl.querySelector('.card-list');
  const addInput = colEl.querySelector('.add-card-input');
  const addBtn   = colEl.querySelector('.btn-confirm-add');
  const cancelBtn = colEl.querySelector('.btn-cancel-add');
  const titleEl  = colEl.querySelector('.col-title');

  // Column drag
  listEl.addEventListener('dragover',  (e) => handleColDragOver(e, col.id));
  listEl.addEventListener('dragleave', (e) => handleColDragLeave(e, col.id));
  listEl.addEventListener('drop',      (e) => handleColDrop(e, col.id));

  // Add card
  addBtn.addEventListener('click', () => {
    addCard(col.id, addInput.value);
    addInput.value = '';
    addInput.blur();
  });
  cancelBtn.addEventListener('click', () => {
    addInput.value = '';
    addInput.blur();
  });
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addCard(col.id, addInput.value);
      addInput.value = '';
    }
    if (e.key === 'Escape') { addInput.value = ''; addInput.blur(); }
  });

  // Inline rename
  titleEl.addEventListener('dblclick', () => {
    titleEl.contentEditable = 'true';
    titleEl.focus();
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  titleEl.addEventListener('blur', () => {
    titleEl.contentEditable = 'false';
    renameColumn(col.id, titleEl.textContent);
  });
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
    if (e.key === 'Escape') {
      titleEl.textContent = getColById(col.id)?.title || '';
      titleEl.blur();
    }
  });

  // Delete column
  colEl.querySelector('[data-action="delete-col"]').addEventListener('click', () => {
    deleteColumn(col.id);
  });

  // Edit / delete card buttons (delegated to list)
  listEl.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-action="edit-card"]');
    const delBtn  = e.target.closest('[data-action="delete-card"]');
    if (editBtn) { e.stopPropagation(); openCardModal(editBtn.dataset.card); }
    if (delBtn)  { e.stopPropagation(); deleteCard(delBtn.dataset.card); }
  });
}

/** Bind drag events on a newly created card element */
function bindCardEvents(cardEl) {
  cardEl.addEventListener('dragstart',  handleDragStart);
  cardEl.addEventListener('dragend',    handleDragEnd);
  cardEl.addEventListener('dragover',   handleCardDragOver);
  cardEl.addEventListener('dragleave',  handleCardDragLeave);

  // Keyboard: Enter or Space opens modal
  cardEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openCardModal(cardEl.dataset.cardId);
    }
    if (e.key === 'Delete') deleteCard(cardEl.dataset.cardId);
  });

  // Double-click opens modal
  cardEl.addEventListener('dblclick', () => openCardModal(cardEl.dataset.cardId));
}

/* ════════════════════════════════════════════════
   INIT — wire all global listeners
════════════════════════════════════════════════ */

function init() {
  loadTheme();
  loadBoard();
  renderBoard();

  // ─── Header ───────────────────────────────────
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);
  document.getElementById('addColBtn').addEventListener('click', openColModal);
  document.getElementById('exportBtn').addEventListener('click', exportBoard);
  document.getElementById('importInput').addEventListener('change', (e) => {
    importBoard(e.target.files[0]);
    e.target.value = ''; // reset so same file can be re-imported
  });

  // ─── Search ───────────────────────────────────
  document.getElementById('searchInput').addEventListener('input', (e) => {
    activeSearch = e.target.value.trim().toLowerCase();
    applyFilters();
  });

  // Ctrl+K focuses search
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      document.getElementById('searchInput').focus();
    }
    if (e.key === 'Escape') {
      closeCardModal();
      closeColModal();
    }
  });

  // ─── Label filters ────────────────────────────
  document.querySelectorAll('.label-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.label-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeLabel = btn.dataset.label;
      applyFilters();
    });
  });

  // ─── Card modal ───────────────────────────────
  document.getElementById('modalClose').addEventListener('click',  closeCardModal);
  document.getElementById('modalCancel').addEventListener('click', closeCardModal);
  document.getElementById('modalSave').addEventListener('click',   saveCardModal);
  document.getElementById('modalDelete').addEventListener('click', () => {
    if (editingCardId) { deleteCard(editingCardId); closeCardModal(); }
  });
  document.getElementById('cardTitleInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveCardModal();
  });
  // Ctrl+Enter in modal saves
  document.getElementById('cardModal').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveCardModal();
  });

  // ─── Column modal ─────────────────────────────
  document.getElementById('colModalClose').addEventListener('click',  closeColModal);
  document.getElementById('colModalCancel').addEventListener('click', closeColModal);
  document.getElementById('colModalSave').addEventListener('click',   saveColModal);
  document.getElementById('colNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveColModal();
  });
}

// ── Start
document.addEventListener('DOMContentLoaded', init);