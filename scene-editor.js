/**
 * scene-editor.js
 * 场景编辑器主控制器 — 连接所有模块
 *
 * 依赖: pixel-engine.js, tile-defs.js, iso-renderer.js, import-pipeline.js
 */

import { RS, updateState, renderScene, renderMinimap, screenToTile, tileToWorld, worldToScreen, clearTileCache, getTileCanvas } from './iso-renderer.js';
import { TILES, getCategoriesByLayer, getTile, drawWater } from './tile-defs.js';
import { initImportPipeline, openImport, closeImport, confirmImport, setFmt, setType, setPal } from './import-pipeline.js';

// ─── Map state ────────────────────────────────────────────────────
let MW = 26, MH = 20;

// 4 layers: each cell is null | string id | { id, anchor:{ax,ay,spanW,spanH}, spanW, spanH }
let layers = _emptyLayers(MW, MH);

// Elevation map: each cell { elev:0-8, slope:'flat'|'N'|'S'|'E'|'W'|'NE'|'NW'|'SE'|'SW' }
let elevMap = _emptyElev(MW, MH);

let lVisible = [true, true, true, true];
let lLocked  = [false, false, false, false];

function _emptyLayers(w, h) {
  return Array.from({ length: 4 }, () => Array.from({ length: h }, () => new Array(w).fill(null)));
}
function _emptyElev(w, h) {
  return Array.from({ length: h }, () => Array.from({ length: w }, () => ({ elev: 0, slope: 'flat' })));
}

// ─── Editor state ─────────────────────────────────────────────────
let editMode   = 'paint';
let activeLayer = 0;
let selTile    = 'grass';
let hoverTx    = -1, hoverTy = -1;
let painting   = false, dragging = false;
let dragOrigin = {};
let lastPx     = -1, lastPy = -1;
let showGrid   = true, showElevViz = false;
let curElev    = 0, curSlope = 'flat';
let waterFrame = 0;

// undo/redo
const undoStack = [], redoStack = [];
function snapshot() {
  undoStack.push({ layers: JSON.parse(JSON.stringify(layers)), elevMap: JSON.parse(JSON.stringify(elevMap)) });
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
}
export function undo() {
  if (!undoStack.length) return;
  redoStack.push({ layers: JSON.parse(JSON.stringify(layers)), elevMap: JSON.parse(JSON.stringify(elevMap)) });
  const s = undoStack.pop(); layers = s.layers; elevMap = s.elevMap; _syncMapSize();
}
export function redo() {
  if (!redoStack.length) return;
  undoStack.push({ layers: JSON.parse(JSON.stringify(layers)), elevMap: JSON.parse(JSON.stringify(elevMap)) });
  const s = redoStack.pop(); layers = s.layers; elevMap = s.elevMap; _syncMapSize();
}

// clipboard
let clipboard = null;
let ctxTile = { tx: -1, ty: -1 };

// ─── Canvas setup ─────────────────────────────────────────────────
const canvas  = document.getElementById('gc');
const ctx     = canvas.getContext('2d');
const mmCanvas = document.getElementById('minimap');

function resizeCanvas() {
  const wrap = document.getElementById('canvasWrap');
  canvas.width  = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  ctx.imageSmoothingEnabled = false;
}

// ─── Player ───────────────────────────────────────────────────────
const player = { tx: MW / 2, ty: MH / 2, frame: 0, moving: false, dir: 's' };
const keys = {};

function drawPlayer() {
  const { TSZ, scale: S } = RS;
  const elev = elevMap[Math.floor(player.ty)]?.[Math.floor(player.tx)]?.elev ?? 0;
  const { wx, wy } = tileToWorld(player.tx, player.ty, elev);
  const { sx, sy } = worldToScreen(wx, wy, canvas);
  const anchorX = sx + TSZ * S;        // x of diamond horizontal center
  const anchorY = sy + TSZ * S;        // y of diamond bottom tip
  const sz = TSZ * S * 1.3;
  const f = player.moving ? ((player.frame >> 3) % 2) : 0;
  const leg = f ? sz * 0.12 : 0;

  ctx.save(); ctx.imageSmoothingEnabled = false;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(anchorX, anchorY, sz * 0.22, sz * 0.07, 0, 0, Math.PI * 2); ctx.fill();
  // legs
  ctx.fillStyle = '#3850a0';
  ctx.fillRect(anchorX - sz*.22, anchorY - sz*.45, sz*.2, sz*.4 + leg);
  ctx.fillRect(anchorX + sz*.02, anchorY - sz*.45, sz*.2, sz*.4 - leg);
  // shoes
  ctx.fillStyle = '#201408';
  ctx.fillRect(anchorX - sz*.25, anchorY - sz*.08 + leg, sz*.25, sz*.1);
  ctx.fillRect(anchorX + .02,    anchorY - sz*.08 - leg, sz*.25, sz*.1);
  // body
  ctx.fillStyle = '#d84028'; ctx.fillRect(anchorX - sz*.3, anchorY - sz*.85, sz*.6, sz*.45);
  // arms
  ctx.fillRect(anchorX - sz*.5, anchorY - sz*.82 + leg*.4, sz*.2, sz*.38);
  ctx.fillRect(anchorX + sz*.3, anchorY - sz*.82 - leg*.4, sz*.2, sz*.38);
  // head
  ctx.fillStyle = '#f0c880'; ctx.fillRect(anchorX - sz*.28, anchorY - sz*1.28, sz*.56, sz*.5);
  // hat
  ctx.fillStyle = '#3a6828';
  ctx.fillRect(anchorX - sz*.32, anchorY - sz*1.3, sz*.64, sz*.12);
  ctx.fillRect(anchorX - sz*.24, anchorY - sz*1.44, sz*.48, sz*.17);
  // eyes
  ctx.fillStyle = '#201408';
  ctx.fillRect(anchorX - sz*.16, anchorY - sz*1.1, sz*.1, sz*.09);
  ctx.fillRect(anchorX + sz*.06, anchorY - sz*1.1, sz*.1, sz*.09);
  ctx.restore();
}

// ─── Game loop ────────────────────────────────────────────────────
function loop(ts) {
  requestAnimationFrame(loop);
  waterFrame = Math.floor(ts / 150) & 63;

  if (editMode === 'walk') {
    const sp = 0.04;
    let dx = 0, dy = 0;
    if (keys['ArrowLeft']  || keys['a']) { dx -= sp; dy += sp; player.dir = 'sw'; }
    if (keys['ArrowRight'] || keys['d']) { dx += sp; dy -= sp; player.dir = 'ne'; }
    if (keys['ArrowUp']    || keys['w']) { dx -= sp; dy -= sp; player.dir = 'nw'; }
    if (keys['ArrowDown']  || keys['s']) { dx += sp; dy += sp; player.dir = 'se'; }
    player.moving = dx !== 0 || dy !== 0;
    if (player.moving) {
      const nx = player.tx + dx, ny = player.ty;
      if (!_isSolid(nx, ny) && !_isSolid(nx, ny + 0.5)) player.tx = Math.max(0, Math.min(MW - 1, nx));
      const nx2 = player.tx, ny2 = player.ty + dy;
      if (!_isSolid(nx2, ny2) && !_isSolid(nx2 + 0.5, ny2)) player.ty = Math.max(0, Math.min(MH - 1, ny2));
      player.frame++;
    }
    const { wx, wy } = tileToWorld(player.tx, player.ty, 0);
    updateState({ viewOX: wx * RS.scale, viewOY: wy * RS.scale });
  }

  const gridOpacity = parseFloat(document.getElementById('gridOp')?.value ?? 2) / 8 * 0.3;

  renderScene(ctx, canvas, {
    layers, elevMap, MW, MH, lVisible, waterFrame,
    hoverTx, hoverTy, editMode,
    gridOpacity: showGrid ? gridOpacity : 0,
    showElevViz,
  });

  if (editMode === 'walk') drawPlayer();

  renderMinimap(mmCanvas, layers, elevMap, MW, MH, lVisible, player.tx, player.ty);
}

function _isSolid(tx, ty) {
  const itx = Math.floor(tx), ity = Math.floor(ty);
  if (itx < 0 || ity < 0 || itx >= MW || ity >= MH) return true;
  for (let L = 0; L < 4; L++) {
    const id = _cellId(L, itx, ity);
    if (id && TILES[id]?.solid) return true;
  }
  return false;
}

// ─── Input ────────────────────────────────────────────────────────
const canvasWrap = document.getElementById('canvasWrap');

canvasWrap.addEventListener('mousemove', e => {
  const r = canvasWrap.getBoundingClientRect();
  const { tx, ty } = screenToTile(e.clientX - r.left, e.clientY - r.top, canvas);
  hoverTx = tx; hoverTy = ty;
  _updateCoords(tx, ty);

  if (dragging) {
    updateState({ viewOX: dragOrigin.vx - (e.clientX - dragOrigin.mx), viewOY: dragOrigin.vy - (e.clientY - dragOrigin.my) });
    return;
  }
  if (painting && editMode !== 'walk') _paintAt(tx, ty);
});

canvasWrap.addEventListener('mousedown', e => {
  if (e.button === 1) {
    dragging = true; dragOrigin = { mx: e.clientX, my: e.clientY, vx: RS.viewOX, vy: RS.viewOY };
    e.preventDefault(); return;
  }
  if (e.button === 2) { _showCtx(e); return; }
  if (e.button !== 0 || editMode === 'walk') return;
  _hideCtx();
  const r = canvasWrap.getBoundingClientRect();
  const { tx, ty } = screenToTile(e.clientX - r.left, e.clientY - r.top, canvas);
  if (editMode === 'fill') { snapshot(); _fill(tx, ty); return; }
  if (editMode === 'pick') { _pick(tx, ty); return; }
  snapshot(); painting = true; lastPx = lastPy = -1; _paintAt(tx, ty);
});

canvasWrap.addEventListener('mouseup',    () => { painting = false; dragging = false; lastPx = lastPy = -1; });
canvasWrap.addEventListener('mouseleave', () => { hoverTx = hoverTy = -1; painting = false; dragging = false; });
canvasWrap.addEventListener('wheel',  e => { e.preventDefault(); _zoom(e.deltaY < 0 ? 1.1 : 0.91); }, { passive: false });
canvasWrap.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousedown', e => { if (!e.target.closest('#ctxMenu')) _hideCtx(); });

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  keys[e.key] = true;
  if (e.key === ' ')                         { e.preventDefault(); setMode(editMode === 'walk' ? 'paint' : 'walk'); }
  if (e.ctrlKey && e.key === 'z')            { e.preventDefault(); undo(); }
  if (e.ctrlKey && (e.key==='y'||e.key==='Y')){ e.preventDefault(); redo(); }
  if (e.key === 'Escape')                    closeImport();
  // mode shortcuts
  const modeKeys = { p:'paint', e:'erase', f:'fill', t:'terrain', i:'pick', g:'walk' };
  if (!e.ctrlKey && modeKeys[e.key]) setMode(modeKeys[e.key]);
  if (e.key === 'G') toggleGrid();
});
document.addEventListener('keyup', e => { keys[e.key] = false; });

// ─── Edit operations ──────────────────────────────────────────────
function _paintAt(tx, ty) {
  if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return;
  if (tx === lastPx && ty === lastPy) return;
  lastPx = tx; lastPy = ty;

  if (editMode === 'erase') {
    for (let L = 0; L < 4; L++) if (!lLocked[L]) _eraseCell(L, tx, ty);
    return;
  }
  if (editMode === 'terrain') {
    elevMap[ty][tx] = { elev: curElev, slope: curSlope };
    return;
  }
  if (editMode !== 'paint' || !selTile) return;
  const def = getTile(selTile); if (!def) return;
  const L = def.layer; if (lLocked[L]) return;
  const sw = def.spanW ?? 1, sh = def.spanH ?? 1;
  if (tx + sw > MW || ty + sh > MH) return;

  for (let dy = 0; dy < sh; dy++) for (let dx = 0; dx < sw; dx++) _eraseCell(L, tx + dx, ty + dy);

  if (sw > 1 || sh > 1) {
    const anchor = { ax: tx, ay: ty, spanW: sw, spanH: sh };
    layers[L][ty][tx] = { id: selTile, anchor, spanW: sw, spanH: sh };
    for (let dy = 0; dy < sh; dy++) for (let dx = 0; dx < sw; dx++) {
      if (dy === 0 && dx === 0) continue;
      layers[L][ty + dy][tx + dx] = { id: selTile, anchor, spanW: sw, spanH: sh };
    }
  } else {
    layers[L][ty][tx] = selTile;
  }
}

function _eraseCell(L, tx, ty) {
  const cell = layers[L]?.[ty]?.[tx]; if (!cell) return;
  if (typeof cell === 'object' && cell.anchor) {
    const { ax, ay, spanW, spanH } = cell.anchor;
    for (let dy = 0; dy < spanH; dy++) for (let dx = 0; dx < spanW; dx++) {
      if (ay + dy < MH && ax + dx < MW) layers[L][ay + dy][ax + dx] = null;
    }
  } else layers[L][ty][tx] = null;
}

function _fill(stx, sty) {
  if (stx < 0 || sty < 0 || stx >= MW || sty >= MH) return;
  const def = getTile(selTile); if (!def) return;
  const L = def.layer; if (lLocked[L]) return;
  const target = _cellId(L, stx, sty);
  if (target === selTile) return;
  const stack = [[stx, sty]], vis = new Set();
  while (stack.length) {
    const [tx, ty] = stack.pop();
    if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) continue;
    const k = `${tx},${ty}`; if (vis.has(k)) continue;
    if (_cellId(L, tx, ty) !== target) continue;
    vis.add(k); layers[L][ty][tx] = selTile;
    stack.push([tx+1,ty],[tx-1,ty],[tx,ty+1],[tx,ty-1]);
  }
}

function _pick(tx, ty) {
  for (let L = 3; L >= 0; L--) {
    const id = _cellId(L, tx, ty);
    if (id && TILES[id]) { selTile = id; activeLayer = L; setMode('paint'); _refreshPalette(); break; }
  }
}

function _cellId(L, tx, ty) {
  const c = layers[L]?.[ty]?.[tx]; if (!c) return null;
  return typeof c === 'string' ? c : c.id;
}

// ─── UI ───────────────────────────────────────────────────────────
const MODE_HINTS = {
  paint:   '🖌 绘制 — 点击/拖拽',
  erase:   '⌫ 擦除 — 点击/拖拽',
  fill:    '🪣 填充 — 点击区域',
  terrain: '⛰ 地形 — 设置高度',
  pick:    '💧 吸管 — 点击吸取',
  walk:    '🚶 行走 — WASD',
};

export function setMode(m) {
  editMode = m;
  Object.keys(MODE_HINTS).forEach(k => document.getElementById('t_' + k)?.classList.toggle('active', k === m));
  const el = document.getElementById('modeHint'); if (el) el.textContent = MODE_HINTS[m] ?? m;
}

export function switchTab(btn, tab) {
  document.querySelectorAll('.ptab').forEach(b => b.classList.toggle('active', b === btn));
  ['tiles', 'terrain', 'layers'].forEach(t => {
    const el = document.getElementById('tab-' + t);
    if (el) el.style.display = t === tab ? 'flex' : 'none';
  });
}

export function toggleGrid()    { showGrid = !showGrid; }
export function toggleElevViz() { showElevViz = !showElevViz; document.getElementById('elevInfo')?.style && (document.getElementById('elevInfo').style.display = showElevViz ? 'block' : 'none'); }
export function doZoom(f)       { updateState({ scale: Math.max(0.3, Math.min(5, RS.scale * f)) }); }
export function resetView()     { updateState({ scale: 1, viewOX: 0, viewOY: 0 }); }
function _zoom(f)               { doZoom(f); }

function _updateCoords(tx, ty) {
  const el = document.getElementById('coordsInfo'); if (!el) return;
  if (tx >= 0 && ty >= 0 && tx < MW && ty < MH) {
    const e = elevMap[ty][tx].elev;
    el.textContent = `格 (${tx}, ${ty})  高度 ${e}`;
  } else el.textContent = '— , —';
}

function _refreshPalette() {
  const cats = getCategoriesByLayer(activeLayer);
  const catEl = document.getElementById('tileCats'); if (!catEl) return;
  catEl.innerHTML = '';
  const firstCat = cats[0] ?? '';
  cats.forEach(cat => {
    const b = document.createElement('button'); b.className = 'tcat' + (cat === firstCat ? ' active' : '');
    b.textContent = cat === '导入' ? '★ 导入' : cat;
    b.onclick = () => { document.querySelectorAll('.tcat').forEach(x => x.classList.remove('active')); b.classList.add('active'); _buildGrid(cat); };
    catEl.appendChild(b);
  });
  _buildGrid(firstCat);
}

function _buildGrid(cat) {
  const grid = document.getElementById('tileGrid'); if (!grid) return;
  grid.innerHTML = '';
  Object.entries(TILES).filter(([, t]) => t.layer === activeLayer && t.cat === cat).forEach(([id, def]) => {
    const item = document.createElement('div');
    item.className = 'titem' + (id === selTile ? ' active' : '') + (def.isCustom ? ' custom' : '');
    item.dataset.id = id;
    const tc = getTileCanvas(id, 32, 0) ?? (() => { const c=document.createElement('canvas');c.width=c.height=32;c.getContext('2d').fillStyle='#444';c.getContext('2d').fillRect(0,0,32,32);return c; })();
    const cv = document.createElement('canvas'); cv.width = cv.height = 32; cv.getContext('2d').drawImage(tc, 0, 0);
    const badge = document.createElement('div'); badge.className = 'titem-badge'; badge.textContent = def.name;
    item.appendChild(cv); item.appendChild(badge);
    item.onclick = () => {
      selTile = id; activeLayer = def.layer;
      document.querySelectorAll('.titem').forEach(x => x.classList.remove('active')); item.classList.add('active');
      if (editMode === 'walk') setMode('paint');
    };
    grid.appendChild(item);
  });
}

function _buildLayerList() {
  const list = document.getElementById('rLayerList'); if (!list) return;
  list.innerHTML = '';
  const cols = ['#5a8838','#5888a8','#a87848','#c85858'];
  const names = ['地面层','物件层','建筑层','障碍层'];
  [0,1,2,3].forEach(L => {
    const row = document.createElement('div'); row.className = 'lrow' + (L === activeLayer ? ' active' : '');
    row.onclick = () => { activeLayer = L; _refreshPalette(); _buildLayerList(); };
    const eye  = document.createElement('span'); eye.className = 'leye' + (lVisible[L] ? ' on' : ''); eye.textContent = lVisible[L] ? '👁' : '🚫';
    eye.onclick = e => { e.stopPropagation(); lVisible[L] = !lVisible[L]; _buildLayerList(); };
    const dot  = document.createElement('div'); dot.className = 'ldot'; dot.style.background = cols[L];
    const nm   = document.createElement('span'); nm.className = 'lname'; nm.textContent = names[L];
    const lock = document.createElement('span'); lock.className = 'llock'; lock.textContent = lLocked[L] ? '🔒' : '🔓';
    lock.onclick = e => { e.stopPropagation(); lLocked[L] = !lLocked[L]; _buildLayerList(); };
    row.appendChild(eye); row.appendChild(dot); row.appendChild(nm); row.appendChild(lock);
    list.appendChild(row);
  });
}

function _buildElevGrid() {
  const g = document.getElementById('elevGrid'); if (!g) return;
  g.innerHTML = '';
  for (let e = 0; e <= 8; e++) {
    const b = document.createElement('button'); b.className = 'elev-btn' + (e === curElev ? ' active' : '');
    b.textContent = e === 0 ? '平' : `+${e}`;
    b.onclick = () => { curElev = e; document.querySelectorAll('.elev-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); };
    g.appendChild(b);
  }
}

export function setSlope(btn) {
  curSlope = btn.dataset.slope;
  document.querySelectorAll('.slope-btn[data-slope]').forEach(b => b.classList.toggle('active', b === btn));
}

export function resizeMap() {
  const nw = +document.getElementById('mapW').value, nh = +document.getElementById('mapH').value;
  document.getElementById('mapWV').textContent = nw;
  document.getElementById('mapHV').textContent = nh;
  const nl = _emptyLayers(nw, nh), ne = _emptyElev(nw, nh);
  for (let L = 0; L < 4; L++) for (let ty = 0; ty < nh; ty++) for (let tx = 0; tx < nw; tx++) {
    nl[L][ty][tx] = ty < MH && tx < MW ? layers[L][ty][tx] : null;
    ne[ty][tx]    = ty < MH && tx < MW ? elevMap[ty][tx]  : { elev: 0, slope: 'flat' };
  }
  MW = nw; MH = nh; layers = nl; elevMap = ne;
}

function _syncMapSize() {
  MH = layers[0].length; MW = layers[0][0].length;
  document.getElementById('mapW').value = MW; document.getElementById('mapWV').textContent = MW;
  document.getElementById('mapH').value = MH; document.getElementById('mapHV').textContent = MH;
}

export function changeTSZ() {
  const v = +document.getElementById('tszSlider').value;
  document.getElementById('tszV').textContent = v + 'px';
  updateState({ TSZ: v }); clearTileCache(); _refreshPalette();
}

export function changeGrain() {
  const v = +document.getElementById('grainSlider').value;
  document.getElementById('grainV').textContent = v + 'px';
  updateState({ grainSz: v }); clearTileCache(); _refreshPalette();
}

export function updateBlockH() {
  const v = +document.getElementById('blockHSlider').value;
  document.getElementById('blockHV').textContent = v + 'px';
  updateState({ blockH: v });
}

export function updateGridLabel() {
  const v = +document.getElementById('gridOp').value;
  document.getElementById('gridOpV').textContent = Math.round(v / 8 * 100) + '%';
}

export function fillGround() {
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) if (!layers[0][ty][tx]) layers[0][ty][tx] = 'grass';
}

export function clearLayer() {
  if (!confirm(`清空${['地面','物件','建筑','障碍'][activeLayer]}层？`)) return;
  snapshot(); layers[activeLayer] = Array.from({ length: MH }, () => new Array(MW).fill(null));
}

export function clearAll() {
  if (!confirm('清空所有图层？')) return; snapshot(); layers = _emptyLayers(MW, MH); elevMap = _emptyElev(MW, MH);
}

export function exportScene() {
  // snapshot current view
  const a = document.createElement('a');
  canvas.toBlob(b => { a.href = URL.createObjectURL(b); a.download = 'scene.png'; a.click(); });
}

// ─── Context menu ─────────────────────────────────────────────────
function _showCtx(e) {
  const r = canvasWrap.getBoundingClientRect();
  const { tx, ty } = screenToTile(e.clientX - r.left, e.clientY - r.top, canvas);
  ctxTile = { tx, ty };
  const m = document.getElementById('ctxMenu'); if (!m) return;
  m.style.left = e.clientX + 'px'; m.style.top = e.clientY + 'px';
  m.classList.add('open');
}
function _hideCtx() { document.getElementById('ctxMenu')?.classList.remove('open'); }

export function ctxAction(act) {
  _hideCtx();
  const { tx, ty } = ctxTile;
  if (act === 'copy') {
    const cells = []; for (let L = 0; L < 4; L++) { const id = _cellId(L, tx, ty); if (id) cells.push({ L, id }); }
    clipboard = { cells, elev: elevMap[ty]?.[tx]?.elev ?? 0 };
  } else if (act === 'paste' && clipboard) {
    snapshot();
    clipboard.cells.forEach(({ L, id }) => { if (!lLocked[L] && ty < MH && tx < MW) layers[L][ty][tx] = id; });
    if (elevMap[ty]?.[tx]) elevMap[ty][tx].elev = clipboard.elev;
  } else if (act === 'pick')  { _pick(tx, ty); }
  else if (act === 'erase')   { snapshot(); for (let L = 0; L < 4; L++) _eraseCell(L, tx, ty); }
}

// ─── Init ─────────────────────────────────────────────────────────
export function init() {
  resizeCanvas();
  _buildElevGrid();
  _buildLayerList();
  _refreshPalette();
  updateGridLabel();

  // Wire sliders
  ['mapW','mapH'].forEach(id => document.getElementById(id)?.addEventListener('input', resizeMap));
  document.getElementById('tszSlider')?.addEventListener('input', changeTSZ);
  document.getElementById('grainSlider')?.addEventListener('input', changeGrain);
  document.getElementById('blockHSlider')?.addEventListener('input', updateBlockH);
  document.getElementById('gridOp')?.addEventListener('input', updateGridLabel);

  // Import pipeline
  initImportPipeline((id, layer) => {
    activeLayer = layer;
    document.querySelectorAll('.ltab').forEach((t, i) => t.classList.toggle('active', i === layer));
    _refreshPalette();
    selTile = id;
    document.querySelectorAll('.titem').forEach(x => x.classList.remove('active'));
    document.querySelector(`.titem[data-id="${id}"]`)?.classList.add('active');
  });

  // Expose to HTML onclick
  window.setMode      = setMode;
  window.switchTab    = switchTab;
  window.toggleGrid   = toggleGrid;
  window.toggleElevViz= toggleElevViz;
  window.doZoom       = doZoom;
  window.resetView    = resetView;
  window.undo         = undo;
  window.redo         = redo;
  window.openImport   = openImport;
  window.closeImport  = closeImport;
  window.confirmImport= confirmImport;
  window.setFmt       = setFmt;
  window.setType      = setType;
  window.setPal       = setPal;
  window.setSlope     = setSlope;
  window.ctxAction    = ctxAction;
  window.fillGround   = fillGround;
  window.clearLayer   = clearLayer;
  window.clearAll     = clearAll;
  window.exportScene  = exportScene;

  // Default scene
  fillGround();
  [[3,3,'tree',2],[7,2,'pine',2],[14,4,'tree',2],[20,2,'pine',2],
   [2,8,'rock',3],[5,10,'bush',1],[10,6,'flower',1],
   [14,10,'house',2],
   [5,5,'fence',3],[6,5,'fence',3],[7,5,'fence',3],
   [10,3,'wheat',1],[11,3,'wheat',1]
  ].forEach(([tx,ty,id,L]) => { if (ty<MH && tx<MW) layers[L][ty][tx] = id; });
  for (let tx=18; tx<22; tx++) for (let ty=14; ty<18; ty++) layers[0][ty][tx] = 'water';
  for (let tx=4;  tx<14; tx++) layers[0][8][tx] = 'path';
  // small hill
  for (let ty=0;ty<4;ty++) for (let tx=0;tx<4;tx++) elevMap[ty][tx] = { elev: 2, slope: 'flat' };
  elevMap[3][3] = { elev: 1, slope: 'flat' };

  // Expose layer selector for HTML layer tabs
  window._selLayer = (L) => {
    activeLayer = L;
    document.querySelectorAll('[id^=ltab]').forEach((b, i) => b.classList.toggle('active', i === L));
    _refreshPalette();
    _buildLayerList();
  };

  setMode('paint');
  requestAnimationFrame(loop);
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('load',   init);
