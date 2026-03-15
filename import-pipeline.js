/**
 * import-pipeline.js
 * 素材导入管线 — 管理 import modal 的完整生命周期
 *
 * 依赖: pixel-engine.js, tile-defs.js, iso-renderer.js
 *
 * 使用方 (scene-editor.js):
 *   import { initImportPipeline, openImport } from './import-pipeline.js';
 *   initImportPipeline(onTileAdded);   // 初始化一次
 *   openImport();                       // 打开 modal
 */

import { pixelizeImage, isoProjectFlat, colorAdjust, downsample, medianCut, quantizeFS, SDW_PALETTE } from './pixel-engine.js';
import { registerTile }   from './tile-defs.js';
import { clearTileCache, RS } from './iso-renderer.js';

// ─── State ────────────────────────────────────────────────────────
let _img        = null;   // uploaded HTMLImageElement
let _fmt        = 'flat'; // 'flat' | 'iso'
let _type       = 'ground';
let _palMode    = 'stardew';
let _spanW      = 1, _spanH = 1;
let _processed  = null;   // { mode, pixC?, isoC, tW?, tH? }
let _customCount = 0;
let _debounce   = null;
let _onAdded    = null;   // callback(id, layer)

let _spanDrag = null;

// ─── Public API ───────────────────────────────────────────────────
export function initImportPipeline(onTileAdded) {
  _onAdded = onTileAdded;
  _bindFileInput();
  _buildSpanPicker();
  _bindSliders();
  _bindButtons();
  // ESC / backdrop close
  document.getElementById('importModal').addEventListener('click', e => {
    if (e.target === document.getElementById('importModal')) closeImport();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('importModal').classList.contains('open')) closeImport();
  });
}

export function openImport() {
  document.getElementById('importModal').classList.add('open');
  _setStep(1);
}

export function closeImport() {
  document.getElementById('importModal').classList.remove('open');
  _img = null; _processed = null;
  _safe('mdropThumb', el => { el.width = 1; el.height = 1; el.getContext('2d').clearRect(0,0,1,1); });
  _safe('mdrop',      el => el.classList.remove('loaded'));
  _safe('mName',      el => el.value = '');
  _safe('confBtn',    el => el.disabled = true);
  _safe('mprev',      el => el.innerHTML = '<div style="font-size:9px;color:var(--muted)">上传图片后自动预览</div>');
}

// ─── File binding ─────────────────────────────────────────────────
function _bindFileInput() {
  const drop = document.getElementById('mdrop');
  const fin  = document.getElementById('fileInput');
  if (!drop || !fin) return;

  drop.addEventListener('click', () => fin.click());
  drop.addEventListener('dragover',  e => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('drag');
    if (e.dataTransfer.files[0]) _loadFile(e.dataTransfer.files[0]);
  });
  fin.addEventListener('change', e => { if (e.target.files[0]) _loadFile(e.target.files[0]); e.target.value = ''; });
}

function _loadFile(file) {
  if (!file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    _img = img;
    const thumb = document.getElementById('mdropThumb');
    if (thumb) { thumb.width = img.width; thumb.height = img.height; thumb.getContext('2d').drawImage(img, 0, 0); }
    _safe('mdrop', el => el.classList.add('loaded'));
    const nameEl = document.getElementById('mName');
    if (nameEl && !nameEl.value) nameEl.value = file.name.replace(/\.[^.]+$/, '').slice(0, 14);
    _setStep(2);
    _schedule();
  };
  img.src = url;
}

// ─── Span picker ──────────────────────────────────────────────────
function _buildSpanPicker() {
  const sp = document.getElementById('spanPicker'); if (!sp) return;
  sp.innerHTML = '';
  for (let r = 1; r <= 4; r++) {
    for (let c = 1; c <= 6; c++) {
      const cell = document.createElement('div');
      cell.className = 'span-cell'; cell.dataset.r = r; cell.dataset.c = c;
      cell.textContent = `${c}×${r}`;
      cell.addEventListener('mousedown', ev => { _spanDrag = { c, r }; _updateSpan(c, r, c, r); ev.preventDefault(); });
      cell.addEventListener('mouseover', () => { if (_spanDrag) _updateSpan(_spanDrag.c, _spanDrag.r, c, r); });
      sp.appendChild(cell);
    }
  }
  document.addEventListener('mouseup', () => { _spanDrag = null; });
  _updateSpan(1, 1, 1, 1);
}

function _updateSpan(c1, r1, c2, r2) {
  _spanW = Math.max(c1, c2); _spanH = Math.max(r1, r2);
  document.querySelectorAll('.span-cell').forEach(el => {
    const c = +el.dataset.c, r = +el.dataset.r;
    el.classList.toggle('sel',     c === _spanW && r === _spanH);
    el.classList.toggle('inrange', c <= _spanW && r <= _spanH && !(c === _spanW && r === _spanH));
  });
  _safe('spanDisplay', el => el.textContent = `${_spanW}×${_spanH} 格`);
}

// ─── Sliders ──────────────────────────────────────────────────────
function _bindSliders() {
  const defs = {
    mGrain:   ['mGrainV',    v => v + 'px'],
    mPixSz:   ['mPixSzV',    v => v + 'px'],
    mIsoSc:   ['mIsoScV',    v => v + '%'],
    mColors:  ['mColorsV',   v => v + '色'],
    mContrast:['mContrastV', v => (v / 100).toFixed(2)],
    mSat:     ['mSatV',      v => (v / 100).toFixed(2)],
    mWarm:    ['mWarmV',     v => (v >= 0 ? '+' : '') + v],
    mHeight:  ['mHeightV',   v => v],
  };
  Object.entries(defs).forEach(([id, [vid, fmt]]) => {
    const el = document.getElementById(id); if (!el) return;
    const update = () => { _safe(vid, v => v.textContent = fmt(el.value)); _schedule(); };
    el.addEventListener('input', update);
    update();
  });
}

// ─── Buttons ──────────────────────────────────────────────────────
function _bindButtons() {
  _safe('fmtFlat', el => el.addEventListener('click', () => setFmt('flat')));
  _safe('fmtIso',  el => el.addEventListener('click', () => setFmt('iso')));

  document.querySelectorAll('.mbtn[data-type]').forEach(btn =>
    btn.addEventListener('click', () => setType(btn.dataset.type)));

  _safe('palSDW',  el => el.addEventListener('click', () => setPal('stardew')));
  _safe('palAuto', el => el.addEventListener('click', () => setPal('auto')));
  _safe('confBtn', el => el.addEventListener('click', confirmImport));
}

// ─── Exported UI handlers (called from HTML onclick) ──────────────
export function setFmt(fmt) {
  _fmt = fmt;
  _safe('fmtFlat', el => el.classList.toggle('active', fmt === 'flat'));
  _safe('fmtIso',  el => el.classList.toggle('active', fmt === 'iso'));
  _safe('mFlatRow',el => el.style.display = fmt === 'flat' ? '' : 'none');
  _safe('mIsoRow', el => el.style.display = fmt === 'iso'  ? '' : 'none');
  _schedule();
}

export function setType(type) {
  _type = type;
  document.querySelectorAll('.mbtn[data-type]').forEach(b => b.classList.toggle('active', b.dataset.type === type));
}

export function setPal(mode) {
  _palMode = mode;
  _safe('palSDW',  el => el.classList.toggle('active', mode === 'stardew'));
  _safe('palAuto', el => el.classList.toggle('active', mode === 'auto'));
  _schedule();
}

// ─── Processing pipeline ──────────────────────────────────────────
function _schedule() { clearTimeout(_debounce); _debounce = setTimeout(_run, 150); }

async function _run() {
  if (!_img) return;
  _setStep(3);

  const grain    = +(_val('mGrain')    ?? 1);
  const colors   = +(_val('mColors')   ?? 32);
  const contrast = +(_val('mContrast') ?? 120) / 100;
  const sat      = +(_val('mSat')      ?? 125) / 100;
  const warm     = +(_val('mWarm')     ?? 5);
  const TSZ      = RS.TSZ; // match current scene tile size

if (_fmt === 'iso') {
    // 【核心修复】：不再强制降采样和抖动，直接渲染原图以保留最高画质！
    const scaleRatio = +(_val('mIsoSc') ?? 100) / 100;
    const srcW = _img.naturalWidth, srcH = _img.naturalHeight;
    const spanMax = Math.max(_spanW, _spanH);
    const tW   = Math.round(RS.TSZ * 2 * spanMax * scaleRatio);
    const tH   = Math.round(srcH / srcW * tW);

    const isoC = new OffscreenCanvas(tW, tH);
    const ictx = isoC.getContext('2d'); 
    ictx.imageSmoothingEnabled = false;
    
    // 直接绘制原图，消除一切噪点
    ictx.drawImage(_img, 0, 0, tW, tH);

    _processed = { mode: 'iso', isoC, tW, tH };
    _setStep(4);
    _renderPreview();

  } else {
    // ... 下面的 flat 逻辑保持不变 ...
    // Flat square → pixelize → iso-project top face
    const pixSz = +(_val('mPixSz') ?? 3);
    const pixC  = await pixelizeImage(_img, { tileSize: TSZ, pixSz, grain, colors, contrast, sat, warm, palMode: _palMode });
    const isoC  = isoProjectFlat(pixC, TSZ);
    _processed  = { mode: 'flat', pixC, isoC, tW: TSZ * 2, tH: TSZ };
    _setStep(4);
    _renderPreview();
  }

  _safe('confBtn', el => el.disabled = false);
}

// ─── Confirm ──────────────────────────────────────────────────────
export function confirmImport() {
  if (!_processed) return;
  const name    = document.getElementById('mName')?.value.trim() || `素材${++_customCount}`;
  const id      = 'custom_' + Date.now();
  const walkable= document.getElementById('mWalkable')?.checked ?? true;
  const heightV = +(_val('mHeight') ?? 0);
  const layerMap = { ground: 0, object: 1, building: 2, obstacle: 3 };
  const layer   = layerMap[_type] ?? 0;

  if (_processed.mode === 'iso') {
    // Convert OffscreenCanvas → regular Canvas for storage
    const { isoC, tW, tH } = _processed;
    const canvas = document.createElement('canvas');
    canvas.width = tW; canvas.height = tH;
    canvas.getContext('2d').drawImage(isoC, 0, 0);

    registerTile(id, {
      name, layer, cat: '导入', solid: !walkable, height: heightV,
      spanW: _spanW, spanH: _spanH,
      isCustom: true, isIsoTile: true,
      _isoC: canvas, isoW: tW, isoH: tH,
      seam:false,
      seam: false,
      // draw() used only for palette thumbnail — squeeze to square
      draw: (c, s) => { c.imageSmoothingEnabled = false; c.drawImage(canvas, 0, 0, s, s); },
    });
  } else {
    const { pixC } = _processed;
    const TSZ = RS.TSZ;
    // Apply grain to stored canvas
    const grainV = +(_val('mGrain') ?? 1);
    const squareC = document.createElement('canvas'); squareC.width = squareC.height = TSZ;
    const sctx = squareC.getContext('2d'); sctx.imageSmoothingEnabled = false;
    if (grainV > 1) {
      const g = Math.max(1, (TSZ / grainV) | 0);
      const tmp = document.createElement('canvas'); tmp.width = tmp.height = g;
      tmp.getContext('2d').drawImage(pixC, 0, 0, g, g);
      sctx.drawImage(tmp, 0, 0, TSZ, TSZ);
    } else {
      sctx.drawImage(pixC, 0, 0, TSZ, TSZ);
    }

    registerTile(id, {
      name, layer, cat: '导入', solid: !walkable, height: heightV,
      spanW: _spanW, spanH: _spanH,
      isCustom: true, isIsoTile: false,
      _squareC: squareC,
      seam: layer === 0,   // ground-layer custom tiles can use seam
      draw: (c, s) => { c.imageSmoothingEnabled = false; c.drawImage(squareC, 0, 0, s, s); },
    });
  }

  clearTileCache();
  closeImport();
  _onAdded?.(id, layer);
}

// ─── Preview rendering ────────────────────────────────────────────
function _renderPreview() {
  const prev = document.getElementById('mprev'); if (!prev) return;
  prev.innerHTML = '';

  const addBox = (label, src, w, h, hi = false) => {
    const box = document.createElement('div'); box.className = 'pbox';
    const lbl = document.createElement('div'); lbl.className = 'plbl' + (hi ? ' hi' : ''); lbl.textContent = label;
    const cv  = document.createElement('canvas');
    cv.width  = src.width ?? src.naturalWidth;
    cv.height = src.height ?? src.naturalHeight;
    cv.style.cssText = `width:${w}px;height:${h}px;image-rendering:pixelated;
      border:1px solid var(--bdr2);border-radius:3px;
      background:repeating-conic-gradient(#18181e 0% 25%,#111118 0% 50%) 0 0/6px 6px`;
    cv.getContext('2d').drawImage(src, 0, 0);
    box.appendChild(lbl); box.appendChild(cv); prev.appendChild(box);
  };
  const addArrow = () => { const a = document.createElement('div'); a.className = 'parrow'; a.textContent = '→'; prev.appendChild(a); };

  const MAX = 160;
  const srcW = _img.naturalWidth, srcH = _img.naturalHeight;
  const ow = Math.min(MAX, srcW), oh = Math.round(srcH / srcW * ow);
  addBox('原图', _img, ow, oh);

  if (_processed.mode === 'flat') {
    const { pixC, isoC } = _processed;
    const scale = Math.min(4, Math.max(1, MAX / Math.max(pixC.width, pixC.height)) | 0);
    addArrow();
    addBox('像素化', pixC, pixC.width * scale, pixC.height * scale, false);
    addArrow();
    addBox('等轴顶面 ⬡', isoC, isoC.width * (scale > 2 ? 2 : scale), isoC.height * (scale > 2 ? 2 : scale), true);
  } else {
    const { isoC, tW, tH } = _processed;
    const sc = Math.min(3, Math.max(1, MAX / Math.max(tW, tH)) | 0);
    addArrow();
    addBox('色调统一 ⬡', isoC, tW * sc, tH * sc, true);
  }
}

// ─── Step indicator ───────────────────────────────────────────────
function _setStep(n) {
  const labels = ['步骤1·上传','步骤2·参数','步骤3·处理中','步骤4·预览','步骤5·确认'];
  _safe('stepLbl', el => el.textContent = labels[n - 1]);
  _safe('stepNum', el => el.textContent = `${n}/5`);
  for (let i = 1; i <= 5; i++) {
    _safe(`s${i}`, el => el.className = 'step' + (i < n ? ' done' : i === n ? ' cur' : ''));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────
function _safe(id, fn) { const el = document.getElementById(id); if (el) fn(el); }
function _val(id)       { return document.getElementById(id)?.value; }
