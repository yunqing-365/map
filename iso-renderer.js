/**
 * iso-renderer.js  v4
 * 等轴测渲染引擎
 *
 * v4 修复/新增：
 *  ★ anchorOffsetY：修复建筑视觉位置与 footprint 格子不对齐的 bug
 *     - def.anchorOffsetY = 图片中地面线的归一化 Y 位置（0=顶部, 1=底部, 默认 1.0）
 *     - 渲染公式: drawY = anchorY - targetH * anchorOffsetY
 *  ★ Ghost 预览：显示地面锚线（绿色虚线）帮助对齐
 *  ★ 每格独立翻转（flipMap）
 *  ★ isoScale 缩放
 */

import { TILES, LAYER_COUNT, drawWater } from './tile-defs.js';
import { applyTOD } from './pixel-engine.js';

// ─── 渲染状态 ─────────────────────────────────────────────────────
export const RS = {
  TSZ:     24,
  scale:   1.0,
  viewOX:  0,
  viewOY:  0,
  grainSz: 1,
  blockH:  8,
  tod:     'noon',
  todAlpha:0.0,
};
export function updateState(patch) { Object.assign(RS, patch); }

const ELEV_H = () => RS.TSZ * 0.5;

// ─── Tile canvas 缓存 ─────────────────────────────────────────────
const _cache = {};
export function clearTileCache() { Object.keys(_cache).forEach(k => delete _cache[k]); }

function makeTile(sz, fn) {
  const c = document.createElement('canvas');
  c.width = c.height = sz; fn(c.getContext('2d'), sz); return c;
}

function applyGrain(src, sz) {
  const g = RS.grainSz; if (g <= 1) return src;
  const grain = Math.max(1, (sz/g)|0);
  const tmp = document.createElement('canvas'); tmp.width = tmp.height = grain;
  tmp.getContext('2d').drawImage(src, 0, 0, grain, grain);
  const out = document.createElement('canvas'); out.width = out.height = sz;
  const ctx = out.getContext('2d'); ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, sz, sz); return out;
}

export function getTileCanvas(id, sz, waterFrame=0) {
  const def = TILES[id]; if (!def) return null;
  if (def.isInvisible) return null;
  if (def.isWater) {
    const bucket = Math.floor(waterFrame / 4);
    const wKey = `water_${sz}_b${bucket}`;
    if (!_cache[wKey]) {
      const c = makeTile(sz, (ctx, s) => drawWater(ctx, s, waterFrame));
      _cache[wKey] = RS.grainSz > 1 ? applyGrain(c, sz) : c;
      const allW = Object.keys(_cache).filter(k => k.startsWith(`water_${sz}_b`));
      if (allW.length > 3) delete _cache[allW[0]];
    }
    return _cache[wKey];
  }
  const key = `${id}_${sz}_g${RS.grainSz}`;
  if (_cache[key]) return _cache[key];
  let base;
  if (def.isCustom && def._squareC) {
    base = makeTile(sz, ctx => { ctx.imageSmoothingEnabled = false; ctx.drawImage(def._squareC, 0, 0, sz, sz); });
  } else if (def.draw) {
    base = makeTile(sz, (ctx, s) => def.draw(ctx, s));
  } else return null;
  _cache[key] = applyGrain(base, sz); return _cache[key];
}

// ─── 坐标变换 ─────────────────────────────────────────────────────
export function tileToWorld(tx, ty, elev=0) {
  const TSZ = RS.TSZ;
  return { wx: (tx-ty)*TSZ, wy: (tx+ty)*TSZ/2 - elev*ELEV_H() };
}
export function worldToScreen(wx, wy, canvas) {
  return {
    sx: wx*RS.scale - RS.viewOX + canvas.width/2,
    sy: wy*RS.scale - RS.viewOY + canvas.height/2,
  };
}
export function screenToTile(sx, sy, canvas) {
  const wx = (sx - canvas.width/2 + RS.viewOX) / RS.scale;
  const wy = (sy - canvas.height/2 + RS.viewOY) / RS.scale;
  const TSZ = RS.TSZ;
  return { tx: Math.floor((wy*2/TSZ + wx/TSZ)/2), ty: Math.floor((wy*2/TSZ - wx/TSZ)/2) };
}

// ─── 视口裁切 ─────────────────────────────────────────────────────
function isOnScreen(sx, sy, canvas, margin=64) {
  return sx > -margin && sy > -margin && sx < canvas.width+margin && sy < canvas.height+margin;
}

// ─── 地面菱形 ─────────────────────────────────────────────────────
function _drawGroundDiamond(ctx, tc, sx, sy, seam) {
  const {TSZ, scale:S} = RS;
  const EX = seam ? 1.3 : 0;
  const U={x:sx+TSZ*S, y:sy-EX}, R={x:sx+TSZ*S*2+EX, y:sy+TSZ*S/2};
  const D={x:sx+TSZ*S, y:sy+TSZ*S+EX}, L={x:sx-EX, y:sy+TSZ*S/2};
  ctx.save();
  ctx.beginPath(); ctx.moveTo(U.x,U.y); ctx.lineTo(R.x,R.y); ctx.lineTo(D.x,D.y); ctx.lineTo(L.x,L.y); ctx.closePath();
  ctx.clip();
  const a=(R.x-U.x)/TSZ, b=(R.y-U.y)/TSZ, c=(L.x-U.x)/TSZ, d=(L.y-U.y)/TSZ;
  ctx.setTransform(a,b,c,d,U.x,U.y);
  ctx.drawImage(tc, 0, 0, TSZ, TSZ);
  ctx.restore();
}

// ─── 悬崖侧面 ─────────────────────────────────────────────────────
function _drawCliff(ctx, sx, sy, heightDiff, side, tc) {
  const {TSZ, scale:S} = RS;
  const fH = heightDiff * ELEV_H() * S;
  if (fH < 1) return;
  const imgData = tc.getContext('2d').getImageData(0, 0, TSZ, TSZ).data;
  const bright = side === 'right' ? 0.42 : 0.58;
  const cold   = side === 'right' ? 12 : 0;
  const Dx=sx+TSZ*S, Dy=sy+TSZ*S, Rx=sx+TSZ*S*2, Ry=sy+TSZ*S/2, Lx=sx, Ly=sy+TSZ*S/2;
  let P1x,P1y,P2x,P2y;
  if (side === 'right') {P1x=Dx;P1y=Dy;P2x=Rx;P2y=Ry;} else {P1x=Lx;P1y=Ly;P2x=Dx;P2y=Dy;}
  const steps = Math.max(1, TSZ);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(P1x,P1y); ctx.lineTo(P2x,P2y); ctx.lineTo(P2x,P2y+fH); ctx.lineTo(P1x,P1y+fH); ctx.closePath(); ctx.clip();
  for (let i=0; i<steps; i++) {
    const srcX = side==='right' ? TSZ-1-(i*(TSZ/steps)|0) : i*(TSZ/steps)|0;
    const si = (Math.min(TSZ-1,TSZ-1)*TSZ + Math.min(TSZ-1,srcX))*4;
    const pr=imgData[si], pg=imgData[si+1], pb=imgData[si+2];
    const dk=0.8;
    ctx.fillStyle = `rgb(${pr*bright*dk|0},${pg*bright*dk|0},${Math.max(0,pb*(bright-cold/255)*dk)|0})`;
    const x0=P1x+(P2x-P1x)*i/steps, y0=P1y+(P2y-P1y)*i/steps;
    const x1=P1x+(P2x-P1x)*(i+1)/steps, y1=P1y+(P2y-P1y)*(i+1)/steps;
    ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.lineTo(x1,y1+fH); ctx.lineTo(x0,y0+fH); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=0.7;
  ctx.beginPath(); ctx.moveTo(P1x,P1y+fH); ctx.lineTo(P2x,P2y+fH); ctx.moveTo(P2x,P2y); ctx.lineTo(P2x,P2y+fH); ctx.stroke();
}

// ─── 3D 块体挤出 ──────────────────────────────────────────────────
function _drawBlock(ctx, tc, sx, sy, blockH) {
  const {TSZ, scale:S} = RS;
  const bH = blockH*S; if (bH < 1) return;
  const Rx=sx+TSZ*S*2, Ry=sy+TSZ*S/2, Dx=sx+TSZ*S, Dy=sy+TSZ*S, Lx=sx, Ly=sy+TSZ*S/2;
  const imgData = tc.getContext('2d').getImageData(0, 0, TSZ, TSZ).data;
  const buildFace = (bright, cold) => {
    const fc=document.createElement('canvas'); fc.width=TSZ; fc.height=1;
    const fx=fc.getContext('2d');
    for (let i=0; i<TSZ; i++) {
      const si=(Math.min(TSZ-1,TSZ-1)*TSZ+Math.min(TSZ-1,i))*4;
      const pr=imgData[si], pg=imgData[si+1], pb=imgData[si+2];
      fx.fillStyle=`rgb(${pr*bright|0},${pg*bright|0},${Math.max(0,pb*(bright-cold/255))|0})`;
      fx.fillRect(i,0,1,1);
    }
    return fc;
  };
  const rf=buildFace(0.42,12), lf=buildFace(0.58,0);
  ctx.save(); ctx.imageSmoothingEnabled=false;
  ctx.save();
  ctx.beginPath(); ctx.moveTo(Dx,Dy); ctx.lineTo(Rx,Ry); ctx.lineTo(Rx,Ry+bH); ctx.lineTo(Dx,Dy+bH); ctx.closePath(); ctx.clip();
  ctx.setTransform((Rx-Dx)/rf.width,(Ry-Dy)/rf.width,0,bH/1,Dx,Dy); ctx.drawImage(rf,0,0); ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.moveTo(Lx,Ly); ctx.lineTo(Dx,Dy); ctx.lineTo(Dx,Dy+bH); ctx.lineTo(Lx,Ly+bH); ctx.closePath(); ctx.clip();
  ctx.setTransform((Dx-Lx)/lf.width,(Dy-Ly)/lf.width,0,bH/1,Lx,Ly); ctx.drawImage(lf,0,0); ctx.restore();
  ctx.restore();
  ctx.strokeStyle='rgba(0,0,0,0.55)'; ctx.lineWidth=0.8;
  ctx.beginPath();
  ctx.moveTo(Rx,Ry); ctx.lineTo(Rx,Ry+bH); ctx.moveTo(Dx,Dy); ctx.lineTo(Dx,Dy+bH);
  ctx.moveTo(Lx,Ly); ctx.lineTo(Lx,Ly+bH); ctx.moveTo(Lx,Ly+bH); ctx.lineTo(Dx,Dy+bH); ctx.lineTo(Rx,Ry+bH); ctx.stroke();
}

// ─── 深度排序 ────────────────────────────────────────────────────
export function getSortedItems(layers, elevMap, MW, MH, lVisible, canvas) {
  const items=[], seen=new Set();
  const numLayers=Math.min(lVisible.length, LAYER_COUNT);
  for (let layer=0; layer<numLayers; layer++) {
    if (!lVisible[layer]) continue;
    for (let ty=0; ty<MH; ty++) for (let tx=0; tx<MW; tx++) {
      const cell=layers[layer]?.[ty]?.[tx];
      if (!cell) continue;
      const id=typeof cell==='string'?cell:cell.id;
      const def=TILES[id]; if(!def||def.isInvisible) continue;
      if (typeof cell==='object'&&cell.anchor) {
        const key=`${layer}_${cell.anchor.ax}_${cell.anchor.ay}`;
        if (seen.has(key)) continue; seen.add(key);
        const atx=cell.anchor.ax, aty=cell.anchor.ay;
        const sw=cell.spanW??1, sh=cell.spanH??1;
        const elev=elevMap?.[aty]?.[atx]?.elev??0;
        const footTx=atx+sw-1, footTy=aty+sh-1;
        const {wx,wy}=tileToWorld(footTx,footTy,elev);
        const {sx,sy}=worldToScreen(wx,wy,canvas);
        const depth=sy+RS.TSZ*RS.scale+layer*0.01;
        items.push({tx:atx, ty:aty, layer, id, depth, elev, spanW:sw, spanH:sh});
      } else {
        const elev=elevMap?.[ty]?.[tx]?.elev??0;
        const {wx,wy}=tileToWorld(tx,ty,elev);
        const {sx,sy}=worldToScreen(wx,wy,canvas);
        const depth=sy+RS.TSZ*RS.scale+layer*0.01;
        items.push({tx, ty, layer, id, depth, elev, spanW:1, spanH:1});
      }
    }
  }
  items.sort((a,b)=>a.depth-b.depth);
  return items;
}

// ─── 等轴素材渲染核心（含 anchorOffsetY 修正）────────────────────
/**
 * anchorOffsetY 定义：
 *   图片中"地面接触线"在图片高度中的比例（0=顶部, 1=底部）
 *   默认 1.0 = 地面在图片最底部（无透明空白）
 *   如图片底部有20%空白: anchorOffsetY = 0.80
 *
 * 渲染公式: drawY = anchorY - targetH * anchorOffsetY
 *   → 让图片的第 anchorOffsetY 处（地面线）对准等轴 footprint 的 D 点
 */
function _drawIsoTile(ctx, def, tx, ty, elev, spanW, spanH, shouldFlip, canvas) {
  const {TSZ, scale:S} = RS;
  const isoC = def._isoC;
  const footTx=tx+spanW-1, footTy=ty+spanH-1;
  const {wx:fwx,wy:fwy}=tileToWorld(footTx,footTy,elev);
  const {sx:fsx,sy:fsy}=worldToScreen(fwx,fwy,canvas);
  // 锚点 = footprint 最前角的 D 点（等轴 2:1 的最底部点）
  const anchorX = fsx + TSZ*S;
  const anchorY = fsy + TSZ*S;
  const isoScale = def.isoScale ?? 1.0;
  // targetW 以 footprint 的实际像素宽度为基准
  const targetW = TSZ*S*2*Math.max(spanW,spanH) * isoScale;
  const targetH = isoC.height / isoC.width * targetW;
  // ★ 核心修正：anchorOffsetY 确保地面线对齐 footprint D 点
  const anchorOffsetY = def.anchorOffsetY ?? 1.0;
  const drawX = Math.round(anchorX - targetW/2);
  const drawY = Math.round(anchorY - targetH * anchorOffsetY);
  ctx.save(); ctx.imageSmoothingEnabled=false;
  if (shouldFlip) { ctx.translate(anchorX*2, 0); ctx.scale(-1,1); }
  ctx.drawImage(isoC, drawX, drawY, Math.round(targetW), Math.round(targetH));
  ctx.restore();
}

// ─── 主渲染 ──────────────────────────────────────────────────────
export function renderScene(ctx, canvas, {
  layers, elevMap, MW, MH, lVisible, waterFrame=0,
  hoverTx=-1, hoverTy=-1, editMode='paint',
  gridOpacity=0, showElevViz=false,
  flipMap=null,
  placingTileId=null, placingFlipH=false,
}) {
  const {TSZ, scale:S} = RS;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#080a06'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ── 1. 底色菱形 ────────────────────────────────────────────────
  for (let ty=0; ty<MH; ty++) for (let tx=0; tx<MW; tx++) {
    const {wx,wy}=tileToWorld(tx,ty,0);
    const {sx,sy}=worldToScreen(wx,wy,canvas);
    if (!isOnScreen(sx,sy,canvas,TSZ*4*S)) continue;
    ctx.fillStyle='#141008';
    ctx.beginPath();
    ctx.moveTo(sx+TSZ*S,sy); ctx.lineTo(sx+TSZ*S*2,sy+TSZ*S/2);
    ctx.lineTo(sx+TSZ*S,sy+TSZ*S); ctx.lineTo(sx,sy+TSZ*S/2);
    ctx.closePath(); ctx.fill();
  }

  // ── 2. 悬崖侧面 ────────────────────────────────────────────────
  for (let ty=0; ty<MH; ty++) for (let tx=0; tx<MW; tx++) {
    const elev=elevMap?.[ty]?.[tx]?.elev??0;
    if (elev<=0) continue;
    const elevR=elevMap?.[ty]?.[tx+1]?.elev??0;
    const elevD=elevMap?.[ty+1]?.[tx]?.elev??0;
    if (elev<=elevR&&elev<=elevD) continue;
    const groundId=(typeof layers[0]?.[ty]?.[tx]==='string')?layers[0][ty][tx]:(layers[0]?.[ty]?.[tx]?.id??'grass');
    const tc=getTileCanvas(groundId??'grass',TSZ,waterFrame); if(!tc) continue;
    const {wx,wy}=tileToWorld(tx,ty,elev);
    const {sx,sy}=worldToScreen(wx,wy,canvas);
    if (!isOnScreen(sx,sy,canvas,TSZ*8*S)) continue;
    if (elev>elevR) _drawCliff(ctx,sx,sy,elev-elevR,'right',tc);
    if (elev>elevD) _drawCliff(ctx,sx,sy,elev-elevD,'left',tc);
  }

  // ── 3. 排序渲染 ────────────────────────────────────────────────
  const items=getSortedItems(layers,elevMap,MW,MH,lVisible,canvas);
  const gBH=RS.blockH;

  for (const {tx,ty,layer,id,elev,spanW,spanH} of items) {
    const def=TILES[id]; if(!def) continue;
    const {wx,wy}=tileToWorld(tx,ty,elev);
    const {sx,sy}=worldToScreen(wx,wy,canvas);
    if (!isOnScreen(sx,sy,canvas,TSZ*(spanW+spanH+4)*S*2)) continue;

    const shouldFlip = flipMap?.[layer]?.[ty]?.[tx] ?? def.flipH ?? false;

    if (def.isCustom && def.isIsoTile && def._isoC) {
      _drawIsoTile(ctx, def, tx, ty, elev, spanW, spanH, shouldFlip, canvas);
      continue;
    }

    const tc=getTileCanvas(id,TSZ,waterFrame); if(!tc) continue;

    if (layer<=2) {
      const blockH=(def.height??0)>0?Math.round(gBH*def.height/10):0;
      if (blockH>0) _drawBlock(ctx,tc,sx,sy,blockH);
      _drawGroundDiamond(ctx,tc,sx,sy,def.seam===true);
    } else {
      const footTx=tx+spanW-1, footTy=ty+spanH-1;
      const {wx:fwx,wy:fwy}=tileToWorld(footTx,footTy,elev);
      const {sx:fsx,sy:fsy}=worldToScreen(fwx,fwy,canvas);
      const anchorX=fsx+TSZ*S, anchorY=fsy+TSZ*S;
      const dispW=TSZ*S*2*Math.max(spanW,spanH);
      const dispH=dispW*(tc.height/tc.width);
      const blockH=(def.height??0)>0?Math.round(gBH*def.height/10):0;
      if (blockH>0) _drawBlock(ctx,tc,fsx,fsy,blockH);
      ctx.save(); ctx.imageSmoothingEnabled=false;
      if (shouldFlip) { ctx.translate(anchorX*2,0); ctx.scale(-1,1); }
      ctx.drawImage(tc, Math.round(anchorX-dispW/2), Math.round(anchorY-dispH), Math.round(dispW), Math.round(dispH));
      ctx.restore();
    }
  }

  // ── 4. 网格 ────────────────────────────────────────────────────
  if (gridOpacity>0.005) {
    ctx.strokeStyle=`rgba(180,140,40,${gridOpacity})`; ctx.lineWidth=0.5;
    for (let ty2=0; ty2<=MH; ty2++) {
      const{wx:ax,wy:ay}=tileToWorld(0,ty2,0),  {sx:sax,sy:say}=worldToScreen(ax,ay,canvas);
      const{wx:bx,wy:by}=tileToWorld(MW,ty2,0), {sx:sbx,sy:sby}=worldToScreen(bx,by,canvas);
      ctx.beginPath(); ctx.moveTo(sax+TSZ*S,say); ctx.lineTo(sbx+TSZ*S,sby); ctx.stroke();
    }
    for (let tx2=0; tx2<=MW; tx2++) {
      const{wx:ax,wy:ay}=tileToWorld(tx2,0,0),  {sx:sax,sy:say}=worldToScreen(ax,ay,canvas);
      const{wx:bx,wy:by}=tileToWorld(tx2,MH,0), {sx:sbx,sy:sby}=worldToScreen(bx,by,canvas);
      ctx.beginPath(); ctx.moveTo(sax+TSZ*S,say); ctx.lineTo(sbx+TSZ*S,sby); ctx.stroke();
    }
  }

  // ── 5. 高度可视化 ────────────────────────────────────────────────
  if (showElevViz) {
    ctx.font=`${Math.max(8,10*S)}px monospace`; ctx.textAlign='center';
    for (let ty2=0; ty2<MH; ty2++) for (let tx2=0; tx2<MW; tx2++) {
      const e=elevMap?.[ty2]?.[tx2]?.elev??0; if(!e) continue;
      const{wx,wy}=tileToWorld(tx2,ty2,e); const{sx,sy}=worldToScreen(wx,wy,canvas);
      ctx.fillStyle=`rgba(255,160,40,${0.15+e/8*0.6})`;
      ctx.beginPath(); ctx.moveTo(sx+TSZ*S,sy); ctx.lineTo(sx+TSZ*S*2,sy+TSZ*S/2); ctx.lineTo(sx+TSZ*S,sy+TSZ*S); ctx.lineTo(sx,sy+TSZ*S/2); ctx.closePath(); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.85)';
      ctx.fillText(String(e),sx+TSZ*S,sy+TSZ*S/2+4*S);
    }
  }

  // ── 6. 悬停高亮 + Ghost 预览 ──────────────────────────────────
  if (editMode!=='walk' && hoverTx>=0 && hoverTy>=0 && hoverTx<MW && hoverTy<MH) {
    const hElev=elevMap?.[hoverTy]?.[hoverTx]?.elev??0;
    const gDef=(editMode==='paint'&&placingTileId)?TILES[placingTileId]:null;
    const gSpanW=gDef?.spanW??1, gSpanH=gDef?.spanH??1;

    // 占位格轮廓（全 span）
    ctx.save(); ctx.lineWidth=1.5;
    for (let dy=0; dy<(gDef?gSpanH:1); dy++) {
      for (let dx=0; dx<(gDef?gSpanW:1); dx++) {
        const htx=hoverTx+dx, hty=hoverTy+dy;
        if (htx>=MW||hty>=MH) continue;
        const ce=elevMap?.[hty]?.[htx]?.elev??0;
        const {wx,wy}=tileToWorld(htx,hty,ce);
        const {sx,sy}=worldToScreen(wx,wy,canvas);
        const isAnchor=(dx===0&&dy===0);
        ctx.fillStyle=isAnchor?'rgba(240,200,60,0.14)':'rgba(240,200,60,0.06)';
        ctx.strokeStyle=isAnchor?'rgba(240,200,60,0.9)':'rgba(240,200,60,0.4)';
        ctx.beginPath();
        ctx.moveTo(sx+TSZ*S,sy); ctx.lineTo(sx+TSZ*S*2,sy+TSZ*S/2);
        ctx.lineTo(sx+TSZ*S,sy+TSZ*S); ctx.lineTo(sx,sy+TSZ*S/2);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    ctx.restore();

    // Ghost 素材预览
    if (gDef && editMode==='paint' && !gDef.isInvisible) {
      ctx.save();
      ctx.globalAlpha=0.62;
      ctx.imageSmoothingEnabled=false;

      if (gDef.isCustom && gDef.isIsoTile && gDef._isoC) {
        // 等轴素材 ghost（使用相同的 anchorOffsetY 修正）
        _drawIsoTile(ctx, gDef, hoverTx, hoverTy, hElev, gSpanW, gSpanH, placingFlipH, canvas);

        // ★ 地面锚线：绿色虚线，帮助用户看清地面对齐位置
        ctx.globalAlpha=0.9;
        const footTx=hoverTx+gSpanW-1, footTy=hoverTy+gSpanH-1;
        const {wx:fwx,wy:fwy}=tileToWorld(footTx,footTy,hElev);
        const {sx:fsx,sy:fsy}=worldToScreen(fwx,fwy,canvas);
        const anchorX=fsx+TSZ*S, anchorY=fsy+TSZ*S;
        const isoScale=gDef.isoScale??1.0;
        const targetW=TSZ*S*2*Math.max(gSpanW,gSpanH)*isoScale;
        // 画地面线：水平方向跨越 footprint
        ctx.strokeStyle='rgba(60,220,120,0.85)';
        ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
        ctx.beginPath();
        ctx.moveTo(anchorX-targetW*0.55, anchorY);
        ctx.lineTo(anchorX+targetW*0.55, anchorY);
        ctx.stroke();
        ctx.setLineDash([]);
        // 中心锚点圆
        ctx.fillStyle='rgba(60,220,120,0.9)';
        ctx.beginPath(); ctx.arc(anchorX, anchorY, 3, 0, Math.PI*2); ctx.fill();

      } else {
        const tc=getTileCanvas(placingTileId,TSZ,waterFrame);
        if (tc) {
          if (gDef.layer<=2) {
            const {wx,wy}=tileToWorld(hoverTx,hoverTy,hElev);
            const {sx,sy}=worldToScreen(wx,wy,canvas);
            _drawGroundDiamond(ctx,tc,sx,sy,false);
          } else {
            const footTx=hoverTx+gSpanW-1, footTy=hoverTy+gSpanH-1;
            const {wx:fwx,wy:fwy}=tileToWorld(footTx,footTy,hElev);
            const {sx:fsx,sy:fsy}=worldToScreen(fwx,fwy,canvas);
            const anchorX=fsx+TSZ*S, anchorY=fsy+TSZ*S;
            const dispW=TSZ*S*2*Math.max(gSpanW,gSpanH);
            const dispH=dispW*(tc.height/tc.width);
            if (placingFlipH) { ctx.translate(anchorX*2,0); ctx.scale(-1,1); }
            ctx.drawImage(tc, Math.round(anchorX-dispW/2), Math.round(anchorY-dispH), Math.round(dispW), Math.round(dispH));
          }
        }
      }
      ctx.restore();
    }
  }

  // ── 7. 地图边界 ────────────────────────────────────────────────
  ctx.strokeStyle='rgba(212,160,40,0.4)'; ctx.lineWidth=2;
  const bpts=[[0,0],[MW,0],[MW,MH],[0,MH]].map(([x,y])=>{
    const {wx,wy}=tileToWorld(x,y,0); return worldToScreen(wx+TSZ,wy,canvas);
  });
  ctx.beginPath(); ctx.moveTo(bpts[0].sx,bpts[0].sy); bpts.slice(1).forEach(p=>ctx.lineTo(p.sx,p.sy)); ctx.closePath(); ctx.stroke();

  // ── 8. TOD 滤镜 ───────────────────────────────────────────────
  if (RS.tod!=='noon'&&RS.todAlpha>0) applyTOD(ctx,canvas,RS.tod,RS.todAlpha);
}

// ─── 小地图 ───────────────────────────────────────────────────────
const MINI_COL={
  grass:'#527a30',grass2:'#426a28',dirt:'#8a6030',path:'#b09060',stone:'#787068',
  water:'#2060a8',sand:'#c8a860',snow:'#d8ecf8',pebble:'#908878',mud:'#4a3420',bamboo_bed:'#687c30',
  flower:'#d84060',bush:'#3a6018',wheat:'#d8a030',chest:'#8a5020',sign:'#8a5020',
  lantern:'#888070',pillar:'#c84020',rock:'#787068',fence:'#9a6028',
  tree:'#2a5010',pine:'#1a3810',bamboo:'#4a6820',plum_tree:'#5a3018',house:'#8a2018',
};
export function renderMinimap(mmCanvas, layers, elevMap, MW, MH, lVisible, playerTx, playerTy) {
  const mc=mmCanvas.getContext('2d');
  const mw=mmCanvas.width, mh=mmCanvas.height;
  mc.fillStyle='#0a0806'; mc.fillRect(0,0,mw,mh);
  const tw=mw/(MW+MH), th=mh/(MW+MH);
  const numLayers=Math.min(lVisible.length,LAYER_COUNT);
  for (let L=0; L<numLayers; L++) {
    if (!lVisible[L]) continue;
    for (let ty=0; ty<MH; ty++) for (let tx=0; tx<MW; tx++) {
      const cell=layers[L]?.[ty]?.[tx]; if(!cell) continue;
      const id=typeof cell==='string'?cell:cell.id;
      const elev=elevMap?.[ty]?.[tx]?.elev??0;
      const isx=((tx-ty)*tw+mw/2)|0, isy=((tx+ty)*th/2-elev*th*0.3)|0;
      mc.fillStyle=MINI_COL[id]??(TILES[id]?.isCustom?'#a8884a':'#888');
      mc.fillRect(isx,isy,Math.max(2,tw*2+.5),Math.max(1,th+.5));
    }
  }
  if (playerTx!==undefined) {
    const pisx=((playerTx-playerTy)*tw+mw/2)|0, pisy=((playerTx+playerTy)*th/2)|0;
    mc.fillStyle='#f8f040'; mc.fillRect(pisx-1,pisy-1,3,3);
  }
}
