/**
 * iso-renderer.js
 * 等轴测渲染引擎
 *
 * 关键修正：
 * 1. 拼缝扩展只对 seam:true 的地面 tile 启用
 * 2. 物件/建筑锚点 = 格子菱形的「下顶点」(diamond tip)，图片底边中心对齐该点
 * 3. 等轴素材 (isIsoTile) 同样以下顶点为锚点，不做任何额外偏移
 * 4. 高度系统：每个 elevCell 抬高菱形位置，同时深度排序考虑高度
 * 5. 图层间深度：同一格子先画低层再画高层（layer 是深度的次要排序键）
 *
 * 坐标约定：
 *   tileToWorld(tx, ty, elev) → 世界坐标 (wx, wy)
 *     wx = (tx - ty) * TSZ          —— 菱形「上顶点」的 x
 *     wy = (tx + ty) * TSZ/2 - elev * ELEV_H   —— 菱形「上顶点」的 y
 *   菱形4顶点相对 (wx, wy):
 *     U = (TSZ,   0)       上顶
 *     R = (TSZ*2, TSZ/2)   右顶
 *     D = (TSZ,   TSZ)     下顶  ← 物件锚点
 *     L = (0,     TSZ/2)   左顶
 */

import { TILES, drawWater } from './tile-defs.js';

// ─── Public state (write via updateState) ─────────────────────────
export const RS = {
  TSZ:     24,
  scale:   1.0,
  viewOX:  0,
  viewOY:  0,
  grainSz: 1,
  blockH:  8,    // global block-height multiplier (0 = flat)
};
export function updateState(patch) { Object.assign(RS, patch); }

// elevation height per level in world-px
const ELEV_H = () => RS.TSZ * 0.5;

// ─── Tile canvas cache ────────────────────────────────────────────
const _cache = {};
export function clearTileCache() { Object.keys(_cache).forEach(k => delete _cache[k]); }

function makeTile(sz, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = sz;
  fn(c.getContext('2d'), sz);
  return c;
}

function applyGrain(srcCanvas, sz) {
  const g = RS.grainSz;
  if (g <= 1) return srcCanvas;
  const grain = Math.max(1, (sz / g) | 0);
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = grain;
  tmp.getContext('2d').drawImage(srcCanvas, 0, 0, grain, grain);
  const out = document.createElement('canvas'); out.width = out.height = sz;
  const ctx = out.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, sz, sz);
  return out;
}

export function getTileCanvas(id, sz, waterFrame = 0) {
  const g = RS.grainSz;
  const def = TILES[id]; if (!def) return null;

  // water is always re-drawn with current frame
  if (def.isWater) {
    const c = makeTile(sz, (ctx, s) => drawWater(ctx, s, waterFrame));
    return g > 1 ? applyGrain(c, sz) : c;
  }

  const key = `${id}_${sz}_g${g}`;
  if (_cache[key]) return _cache[key];

  let base;
  if (def.isCustom && def._squareC) {
    base = makeTile(sz, ctx => { ctx.imageSmoothingEnabled = false; ctx.drawImage(def._squareC, 0, 0, sz, sz); });
  } else if (def.draw) {
    base = makeTile(sz, (ctx, s) => def.draw(ctx, s));
  } else return null;

  _cache[key] = applyGrain(base, sz);
  return _cache[key];
}

// ─── Coordinate transforms ────────────────────────────────────────
export function tileToWorld(tx, ty, elev = 0) {
  const TSZ = RS.TSZ;
  return {
    wx: (tx - ty) * TSZ,
    // upper vertex of diamond; elevation lifts tile upward in screen space
    wy: (tx + ty) * TSZ / 2 - elev * ELEV_H(),
  };
}

export function worldToScreen(wx, wy, canvas) {
  return {
    sx: wx * RS.scale - RS.viewOX + canvas.width  / 2,
    sy: wy * RS.scale - RS.viewOY + canvas.height / 2,
  };
}

export function screenToTile(screenX, screenY, canvas) {
  const wx = (screenX - canvas.width  / 2 + RS.viewOX) / RS.scale;
  const wy = (screenY - canvas.height / 2 + RS.viewOY) / RS.scale;
  const TSZ = RS.TSZ;
  const sum  = wy * 2 / TSZ;   // tx + ty
  const diff = wx / TSZ;        // tx - ty
  return { tx: Math.floor((sum + diff) / 2), ty: Math.floor((sum - diff) / 2) };
}

// ─── Low-level draw: ground tile (diamond clip + affine) ──────────
// seam: adds 1.2px outward expansion to hide pixel cracks between adjacent tiles
function _drawGroundDiamond(ctx, tc, sx, sy, seam) {
  const { TSZ, scale: S } = RS;
  const EX = seam ? 1.2 : 0;
  // 4 verts of the diamond in screen space, centred on upper-vertex at (sx,sy)
  const U = { x: sx + TSZ * S,       y: sy - EX };
  const R = { x: sx + TSZ * S * 2 + EX, y: sy + TSZ * S / 2 };
  const D = { x: sx + TSZ * S,       y: sy + TSZ * S + EX };
  const L = { x: sx - EX,             y: sy + TSZ * S / 2 };

  ctx.save();
  ctx.beginPath(); ctx.moveTo(U.x, U.y); ctx.lineTo(R.x, R.y); ctx.lineTo(D.x, D.y); ctx.lineTo(L.x, L.y); ctx.closePath();
  ctx.clip();
  // affine transform: source square → diamond
  // src(0,0)→U  src(TSZ,0)→R  src(0,TSZ)→L
  const a = (R.x - U.x) / TSZ, b = (R.y - U.y) / TSZ;
  const c = (L.x - U.x) / TSZ, d = (L.y - U.y) / TSZ;
  ctx.setTransform(a, b, c, d, U.x, U.y);
  ctx.drawImage(tc, 0, 0, TSZ, TSZ);
  ctx.restore();
}

// ─── Elevation cliff faces ────────────────────────────────────────
// Draws the right or left vertical cliff face when this tile is higher than its neighbor
function _drawCliff(ctx, sx, sy, heightDiff, side, tc) {
  const { TSZ, scale: S } = RS;
  const fH = heightDiff * ELEV_H() * S; // screen-pixels tall
  if (fH < 1) return;

  // Pick edge pixels from tile image for face color
  const imgData = tc.getContext('2d').getImageData(0, 0, TSZ, TSZ).data;
  const bright  = side === 'right' ? 0.42 : 0.58;
  const cold    = side === 'right' ? 12 : 0;

  // Corner points of the cliff face (screen space)
  // Diamond D and R/L points
  const Dx = sx + TSZ * S,       Dy = sy + TSZ * S;       // bottom of diamond
  const Rx = sx + TSZ * S * 2,   Ry = sy + TSZ * S / 2;   // right of diamond
  const Lx = sx,                  Ly = sy + TSZ * S / 2;   // left of diamond

  let P1x, P1y, P2x, P2y; // top-left, top-right of cliff face
  if (side === 'right') { P1x = Dx; P1y = Dy; P2x = Rx; P2y = Ry; }
  else                  { P1x = Lx; P1y = Ly; P2x = Dx; P2y = Dy; }

  // Build face as a strip of vertical columns
  const steps = Math.max(1, TSZ);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(P1x, P1y); ctx.lineTo(P2x, P2y);
  ctx.lineTo(P2x, P2y + fH); ctx.lineTo(P1x, P1y + fH);
  ctx.closePath(); ctx.clip();

  for (let i = 0; i < steps; i++) {
    const t0 = i / steps, t1 = (i + 1) / steps;
    const srcX = (side === 'right') ? TSZ - 1 - (i * (TSZ / steps) | 0) : i * (TSZ / steps) | 0;
    const si   = (Math.min(TSZ - 1, TSZ - 1) * TSZ + Math.min(TSZ - 1, srcX)) * 4;
    const pr = imgData[si], pg = imgData[si+1], pb = imgData[si+2];
    const dk = 1 - 0.2; // slight darkening at bottom done via gradient
    ctx.fillStyle = `rgb(${pr*bright*dk|0},${pg*bright*dk|0},${Math.max(0,pb*(bright-cold/255)*dk)|0})`;
    const x0 = P1x + (P2x - P1x) * t0, y0 = P1y + (P2y - P1y) * t0;
    const x1 = P1x + (P2x - P1x) * t1, y1 = P1y + (P2y - P1y) * t1;
    ctx.beginPath();
    ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
    ctx.lineTo(x1, y1 + fH); ctx.lineTo(x0, y0 + fH);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();

  // outline
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(P1x, P1y + fH); ctx.lineTo(P2x, P2y + fH);
  ctx.moveTo(P2x, P2y); ctx.lineTo(P2x, P2y + fH);
  ctx.stroke();
}

// ─── 3D block extrusion for objects ──────────────────────────────
// Draws right-face + left-face below the ground tile, then top face on top
function _drawBlock(ctx, tc, sx, sy, blockH) {
  const { TSZ, scale: S } = RS;
  const bH = blockH * S;
  if (bH < 1) return;

  const Ux = sx + TSZ * S,       Uy = sy;
  const Rx = sx + TSZ * S * 2,   Ry = sy + TSZ * S / 2;
  const Dx = sx + TSZ * S,       Dy = sy + TSZ * S;
  const Lx = sx,                  Ly = sy + TSZ * S / 2;
  const Rxb = Rx, Ryb = Ry + bH;
  const Dxb = Dx, Dyb = Dy + bH;
  const Lxb = Lx, Lyb = Ly + bH;

  const imgData = tc.getContext('2d').getImageData(0, 0, TSZ, TSZ).data;

  // right face
  const buildFace = (bright, cold, steps) => {
    const fc = document.createElement('canvas'); fc.width = steps; fc.height = 1;
    const fx = fc.getContext('2d');
    for (let i = 0; i < steps; i++) {
      const si = (Math.min(TSZ-1, TSZ-1) * TSZ + Math.min(TSZ-1, i)) * 4;
      const pr = imgData[si], pg = imgData[si+1], pb = imgData[si+2];
      fx.fillStyle = `rgb(${pr*bright|0},${pg*bright|0},${Math.max(0,pb*(bright-cold/255))|0})`;
      fx.fillRect(i, 0, 1, 1);
    }
    return fc;
  };
  const rightFace = buildFace(0.42, 12, TSZ);
  const leftFace  = buildFace(0.58,  0, TSZ);

  ctx.save(); ctx.imageSmoothingEnabled = false;

  // right face (D→R→Rxb→Dxb)
  ctx.save();
  ctx.beginPath(); ctx.moveTo(Dx,Dy); ctx.lineTo(Rx,Ry); ctx.lineTo(Rxb,Ryb); ctx.lineTo(Dxb,Dyb); ctx.closePath(); ctx.clip();
  const rfW = rightFace.width;
  ctx.setTransform((Rx-Dx)/rfW,(Ry-Dy)/rfW,(Dxb-Dx)/bH,(Dyb-Dy)/bH,Dx,Dy);
  ctx.drawImage(rightFace,0,0); ctx.restore();

  // left face (L→D→Dxb→Lxb)
  ctx.save();
  ctx.beginPath(); ctx.moveTo(Lx,Ly); ctx.lineTo(Dx,Dy); ctx.lineTo(Dxb,Dyb); ctx.lineTo(Lxb,Lyb); ctx.closePath(); ctx.clip();
  const lfW = leftFace.width;
  ctx.setTransform((Dx-Lx)/lfW,(Dy-Ly)/lfW,(Lxb-Lx)/bH,(Lyb-Ly)/bH,Lx,Ly);
  ctx.drawImage(leftFace,0,0); ctx.restore();

  ctx.restore();

  // edges
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(Rx,Ry); ctx.lineTo(Rxb,Ryb);
  ctx.moveTo(Dx,Dy); ctx.lineTo(Dxb,Dyb);
  ctx.moveTo(Lx,Ly); ctx.lineTo(Lxb,Lyb);
  ctx.moveTo(Lxb,Lyb); ctx.lineTo(Dxb,Dyb); ctx.lineTo(Rxb,Ryb);
  ctx.stroke();
}

// ─── Depth sort ───────────────────────────────────────────────────
// The canonical iso painter order is: for each "depth bucket" (tx+ty),
// draw lower layers first within the same bucket, then higher.
// Elevation increases depth: a tile at elev 2 should appear in front of
// a tile at elev 0 with the same tx+ty (it's "closer" to viewer).
export function getSortedItems(layers, elevMap, MW, MH, lVisible) {
  const items = [];
  const seen  = new Set();

  for (let layer = 0; layer < 4; layer++) {
    if (!lVisible[layer]) continue;
    for (let ty = 0; ty < MH; ty++) {
      for (let tx = 0; tx < MW; tx++) {
        const cell = layers[layer]?.[ty]?.[tx];
        if (!cell) continue;

        const id  = typeof cell === 'string' ? cell : cell.id;
        const def = TILES[id]; if (!def) continue;

        // skip non-anchor multi-tile cells
       if (typeof cell === 'object' && cell.anchor) {
          const key = `${layer}_${cell.anchor.ax}_${cell.anchor.ay}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const atx = cell.anchor.ax, aty = cell.anchor.ay;
          const elev = elevMap?.[aty]?.[atx]?.elev ?? 0;
          
          // 【核心修复】：以建筑占地的最右下角（视觉最前方）计算深度
          const footTx = atx + (cell.spanW ?? 1) - 1;
          const footTy = aty + (cell.spanH ?? 1) - 1;
          
          // 图层权重：地面 0, 物件 0.1, 建筑 0.2, 障碍 0.3
          const depth = (footTx + footTy) + elev * 0.5 + layer * 0.1; 
          items.push({ tx: atx, ty: aty, layer, id, depth, elev,
                       spanW: cell.spanW ?? 1, spanH: cell.spanH ?? 1 });
        } else {
          const elev = elevMap?.[ty]?.[tx]?.elev ?? 0;
          const depth = (tx + ty) + elev * 0.5 + layer * 0.05;
          items.push({ tx, ty, layer, id, depth, elev, spanW: 1, spanH: 1 });
        }
      }
    }
  }
  items.sort((a, b) => a.depth - b.depth);
  return items;
}

// ─── Main render ──────────────────────────────────────────────────
export function renderScene(ctx, canvas, {
  layers, elevMap, MW, MH, lVisible, waterFrame = 0,
  hoverTx = -1, hoverTy = -1, editMode = 'paint',
  gridOpacity = 0, showElevViz = false,
}) {
  const { TSZ, scale: S } = RS;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#080a06'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ── 1. Dark base diamonds for every cell ─────────────────────────
  for (let ty = 0; ty < MH; ty++) {
    for (let tx = 0; tx < MW; tx++) {
      const elev = elevMap?.[ty]?.[tx]?.elev ?? 0;
      const { wx, wy } = tileToWorld(tx, ty, elev);
      const { sx, sy } = worldToScreen(wx, wy, canvas);
      ctx.fillStyle = '#141008';
      ctx.beginPath();
      ctx.moveTo(sx + TSZ*S,       sy);
      ctx.lineTo(sx + TSZ*S*2,     sy + TSZ*S/2);
      ctx.lineTo(sx + TSZ*S,       sy + TSZ*S);
      ctx.lineTo(sx,               sy + TSZ*S/2);
      ctx.closePath(); ctx.fill();
    }
  }

  // ── 2. Cliff faces (drawn before tiles so tiles overlap them) ────
  for (let ty = 0; ty < MH; ty++) {
    for (let tx = 0; tx < MW; tx++) {
      const elev = elevMap?.[ty]?.[tx]?.elev ?? 0;
      if (elev <= 0) continue;
      const elevR = elevMap?.[ty]?.[tx+1]?.elev ?? 0;
      const elevD = elevMap?.[ty+1]?.[tx]?.elev ?? 0;
      if (elev <= elevR && elev <= elevD) continue;

      const groundId = (typeof layers[0]?.[ty]?.[tx] === 'string')
        ? layers[0][ty][tx] : (layers[0]?.[ty]?.[tx]?.id ?? 'grass');
      const tc = getTileCanvas(groundId ?? 'grass', TSZ, waterFrame);
      if (!tc) continue;

      const { wx, wy } = tileToWorld(tx, ty, elev);
      const { sx, sy } = worldToScreen(wx, wy, canvas);
      if (elev > elevR) _drawCliff(ctx, sx, sy, elev - elevR, 'right', tc);
      if (elev > elevD) _drawCliff(ctx, sx, sy, elev - elevD, 'left',  tc);
    }
  }

  // ── 3. Sorted tiles ───────────────────────────────────────────────
  const items = getSortedItems(layers, elevMap, MW, MH, lVisible);
  const globalBlockH = RS.blockH;

  for (const { tx, ty, layer, id, elev, spanW, spanH } of items) {
    const def = TILES[id]; if (!def) continue;
    const { wx, wy } = tileToWorld(tx, ty, elev);
    const { sx, sy } = worldToScreen(wx, wy, canvas);

    // ── isIsoTile: already a diamond sprite, anchor at diamond D point ──
    // 在 iso-renderer.js 的 renderScene 中
// 找到 isIsoTile 的渲染逻辑，进行如下优化：
    // ── isIsoTile: already a diamond sprite, anchor at diamond D point ──
    if (def.isCustom && def.isIsoTile && def._isoC) {
      const isoC = def._isoC;
      const anchorDx = sx + TSZ * S * (spanW + spanH - 1);        
      const anchorDy = sy + TSZ * S * (spanW + spanH) / 2;        

      const targetW = TSZ * S * 2 * Math.max(spanW, spanH);
      const targetH = isoC.height / isoC.width * targetW;

      ctx.save(); 
      ctx.imageSmoothingEnabled = false;

      // 【新增】：翻转逻辑
      if (window._flipTile) {
        ctx.translate(anchorDx, 0); // 将坐标系平移到锚点中心
        ctx.scale(-1, 1);           // 水平镜像
        ctx.translate(-anchorDx, 0);// 移回原位
      }

      ctx.drawImage(isoC,
        Math.round(anchorDx - targetW / 2),
        Math.round(anchorDy - targetH),          
        Math.round(targetW), Math.round(targetH));
      ctx.restore();
      continue;
    }

    const tc = getTileCanvas(id, TSZ, waterFrame);
    if (!tc) continue;

    if (layer === 0) {
      // ── Ground tile ───────────────────────────────────────────────
      const blockH = (def.height ?? 0) > 0 ? Math.round(globalBlockH * def.height / 10) : 0;
      if (blockH > 0) _drawBlock(ctx, tc, sx, sy, blockH);
      _drawGroundDiamond(ctx, tc, sx, sy, def.seam === true);
    } else {
      // ── Object / building / obstacle ─────────────────────────────
      // Anchor: the «bottom tip» of the footprint diamond
      // For spanW×spanH, the logical anchor cell is (tx+spanW-1, ty+spanH-1)
      // because that's deepest in iso space. But since we sort by anchor (tx,ty),
      // we compute the screen position of the *footprint bottom tip*.

      const footTx = tx + spanW - 1, footTy = ty + spanH - 1;
      const { wx: fwx, wy: fwy } = tileToWorld(footTx, footTy, elev);
      const { sx: fsx, sy: fsy } = worldToScreen(fwx, fwy, canvas);

      // Diamond D = bottom tip = (fsx + TSZ*S, fsy + TSZ*S)
      const anchorX = fsx + TSZ * S;        // horizontal center of bottom tip
      const anchorY = fsy + TSZ * S;        // y of bottom tip

      // Display size: proportional to span, scaled by TSZ
      const dispW = TSZ * S * 2 * Math.max(spanW, spanH);
      const dispH = dispW * (tc.height / tc.width);

      // 3D block side faces (drawn first, behind the sprite)
      const blockH = (def.height ?? 0) > 0 ? Math.round(globalBlockH * def.height / 10) : 0;
      if (blockH > 0) {
        _drawBlock(ctx, tc, fsx, fsy, blockH);
      }

      ctx.save(); 
      ctx.imageSmoothingEnabled = false;

      // 【新增】：翻转逻辑
      if (window._flipTile) {
        ctx.translate(anchorX, 0); // 将坐标系平移到锚点中心
        ctx.scale(-1, 1);          // 水平镜像
        ctx.translate(-anchorX, 0);// 移回原位
      }

      ctx.drawImage(tc,
        Math.round(anchorX - dispW / 2),   
        Math.round(anchorY - dispH),        
        Math.round(dispW), Math.round(dispH));
      ctx.restore();
    }
  }

  // ── 4. Grid ───────────────────────────────────────────────────────
  if (gridOpacity > 0.005) {
    ctx.strokeStyle = `rgba(180,140,40,${gridOpacity})`; ctx.lineWidth = 0.5;
    for (let ty = 0; ty <= MH; ty++) {
      const { wx: ax, wy: ay } = tileToWorld(0,  ty, 0); const { sx: sax, sy: say } = worldToScreen(ax, ay, canvas);
      const { wx: bx, wy: by } = tileToWorld(MW, ty, 0); const { sx: sbx, sy: sby } = worldToScreen(bx, by, canvas);
      ctx.beginPath(); ctx.moveTo(sax + TSZ*S, say); ctx.lineTo(sbx + TSZ*S, sby); ctx.stroke();
    }
    for (let tx = 0; tx <= MW; tx++) {
      const { wx: ax, wy: ay } = tileToWorld(tx, 0,  0); const { sx: sax, sy: say } = worldToScreen(ax, ay, canvas);
      const { wx: bx, wy: by } = tileToWorld(tx, MH, 0); const { sx: sbx, sy: sby } = worldToScreen(bx, by, canvas);
      ctx.beginPath(); ctx.moveTo(sax + TSZ*S, say); ctx.lineTo(sbx + TSZ*S, sby); ctx.stroke();
    }
  }

  // ── 5. Elevation visualisation ────────────────────────────────────
  if (showElevViz) {
    ctx.font = `${Math.max(8, 10 * S)}px monospace`;
    ctx.textAlign = 'center';
    for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
      const e = elevMap?.[ty]?.[tx]?.elev ?? 0; if (!e) continue;
      const { wx, wy } = tileToWorld(tx, ty, e);
      const { sx, sy } = worldToScreen(wx, wy, canvas);
      ctx.fillStyle = `rgba(255,160,40,${0.15 + e / 8 * 0.6})`;
      ctx.beginPath();
      ctx.moveTo(sx+TSZ*S,sy); ctx.lineTo(sx+TSZ*S*2,sy+TSZ*S/2); ctx.lineTo(sx+TSZ*S,sy+TSZ*S); ctx.lineTo(sx,sy+TSZ*S/2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(String(e), sx + TSZ*S, sy + TSZ*S/2 + 4*S);
    }
  }

  // ── 6. Hover highlight ────────────────────────────────────────────
  if (editMode !== 'walk' && hoverTx >= 0 && hoverTy >= 0 && hoverTx < MW && hoverTy < MH) {
    const elev = elevMap?.[hoverTy]?.[hoverTx]?.elev ?? 0;
    const { wx, wy } = tileToWorld(hoverTx, hoverTy, elev);
    const { sx, sy } = worldToScreen(wx, wy, canvas);
    ctx.fillStyle = 'rgba(240,200,60,0.2)'; ctx.strokeStyle = 'rgba(240,200,60,0.85)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx+TSZ*S,sy); ctx.lineTo(sx+TSZ*S*2,sy+TSZ*S/2); ctx.lineTo(sx+TSZ*S,sy+TSZ*S); ctx.lineTo(sx,sy+TSZ*S/2);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // ── 7. Map boundary ───────────────────────────────────────────────
  ctx.strokeStyle = 'rgba(212,160,40,0.4)'; ctx.lineWidth = 2;
  const bpts = [[0,0],[MW,0],[MW,MH],[0,MH]].map(([x,y]) => {
    const { wx, wy } = tileToWorld(x, y, 0); return worldToScreen(wx + TSZ, wy, canvas);
  });
  ctx.beginPath(); ctx.moveTo(bpts[0].sx, bpts[0].sy);
  bpts.slice(1).forEach(p => ctx.lineTo(p.sx, p.sy));
  ctx.closePath(); ctx.stroke();
}

// ─── Minimap ──────────────────────────────────────────────────────
const MINI_COL = {
  grass:'#527a30',grass2:'#426a28',dirt:'#8a6030',path:'#b09060',stone:'#787068',
  water:'#2060a8',sand:'#c8a860',snow:'#d8ecf8',flower:'#d84060',bush:'#3a6018',
  wheat:'#d8a030',chest:'#8a5020',sign:'#8a5020',tree:'#2a5010',pine:'#1a3810',
  house:'#8a2018',rock:'#787068',fence:'#9a6028',
};

export function renderMinimap(mmCanvas, layers, elevMap, MW, MH, lVisible, playerTx, playerTy) {
  const mc = mmCanvas.getContext('2d');
  const mw = mmCanvas.width, mh = mmCanvas.height;
  mc.fillStyle = '#0a0806'; mc.fillRect(0, 0, mw, mh);
  const tw = mw / (MW + MH), th = mh / (MW + MH);

  for (let L = 0; L < 4; L++) {
    if (!lVisible[L]) continue;
    for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
      const cell = layers[L]?.[ty]?.[tx]; if (!cell) continue;
      const id = typeof cell === 'string' ? cell : cell.id;
      const elev = elevMap?.[ty]?.[tx]?.elev ?? 0;
      const isx = ((tx - ty) * tw + mw / 2) | 0;
      const isy = ((tx + ty) * th / 2 - elev * th * 0.3) | 0;
      mc.fillStyle = MINI_COL[id] ?? (TILES[id]?.isCustom ? '#a8884a' : '#888');
      mc.fillRect(isx, isy, Math.max(2, tw * 2 + 0.5), Math.max(1, th + 0.5));
    }
  }
  if (playerTx !== undefined) {
    const pisx = ((playerTx - playerTy) * tw + mw / 2) | 0;
    const pisy = ((playerTx + playerTy) * th / 2) | 0;
    mc.fillStyle = '#f8f040'; mc.fillRect(pisx - 1, pisy - 1, 3, 3);
  }
}
