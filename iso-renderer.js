/**
 * iso-renderer.js  v2
 * 等轴测渲染引擎 — 国风升级版
 *
 * 修复与升级：
 *  1. 正确 Y-Sort：按屏幕底边 y 排序，不用 tx+ty 近似值
 *  2. 悬崖侧面完全遮盖黑缝（base diamond 画在 elev=0 + 填充到顶）
 *  3. isIsoTile 锚点修正：footprint 右下角菱形 D 点对齐
 *  4. 视口裁切：canvas 外的格子跳过渲染
 *  5. 支持 7 图层
 *  6. 时间段(TOD)颜色叠加
 *  7. 素材翻转标志 flipH 支持
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
  tod:     'noon',   // 时间段: dawn|noon|dusk|night
  todAlpha:0.0,      // 叠加强度 0-1
};
export function updateState(patch) { Object.assign(RS, patch); }

const ELEV_H = () => RS.TSZ * 0.5;

// ─── Tile canvas 缓存 ─────────────────────────────────────────────
const _cache = {};
export function clearTileCache() { Object.keys(_cache).forEach(k=>delete _cache[k]); }

function makeTile(sz, fn) {
  const c=document.createElement('canvas');
  c.width=c.height=sz; fn(c.getContext('2d'),sz); return c;
}

function applyGrain(src, sz) {
  const g=RS.grainSz; if(g<=1) return src;
  const grain=Math.max(1,(sz/g)|0);
  const tmp=document.createElement('canvas'); tmp.width=tmp.height=grain;
  tmp.getContext('2d').drawImage(src,0,0,grain,grain);
  const out=document.createElement('canvas'); out.width=out.height=sz;
  const ctx=out.getContext('2d'); ctx.imageSmoothingEnabled=false;
  ctx.drawImage(tmp,0,0,sz,sz); return out;
}

export function getTileCanvas(id, sz, waterFrame=0) {
  const def=TILES[id]; if(!def) return null;
  if (def.isInvisible) return null; // 障碍层不渲染

  if (def.isWater) {
    const c=makeTile(sz,(ctx,s)=>drawWater(ctx,s,waterFrame));
    return RS.grainSz>1?applyGrain(c,sz):c;
  }
  const key=`${id}_${sz}_g${RS.grainSz}`;
  if (_cache[key]) return _cache[key];

  let base;
  if (def.isCustom && def._squareC) {
    base=makeTile(sz,ctx=>{ctx.imageSmoothingEnabled=false;ctx.drawImage(def._squareC,0,0,sz,sz);});
  } else if (def.draw) {
    base=makeTile(sz,(ctx,s)=>def.draw(ctx,s));
  } else return null;

  _cache[key]=applyGrain(base,sz); return _cache[key];
}

// ─── 坐标变换 ─────────────────────────────────────────────────────
export function tileToWorld(tx, ty, elev=0) {
  const TSZ=RS.TSZ;
  return { wx:(tx-ty)*TSZ, wy:(tx+ty)*TSZ/2-elev*ELEV_H() };
}

export function worldToScreen(wx, wy, canvas) {
  return {
    sx: wx*RS.scale - RS.viewOX + canvas.width/2,
    sy: wy*RS.scale - RS.viewOY + canvas.height/2,
  };
}

export function screenToTile(sx, sy, canvas) {
  const wx=(sx-canvas.width/2+RS.viewOX)/RS.scale;
  const wy=(sy-canvas.height/2+RS.viewOY)/RS.scale;
  const TSZ=RS.TSZ;
  return { tx:Math.floor((wy*2/TSZ+wx/TSZ)/2), ty:Math.floor((wy*2/TSZ-wx/TSZ)/2) };
}

// 格子菱形 D 点（下顶）的屏幕坐标
function diamondD(tx, ty, elev, canvas) {
  const {wx,wy}=tileToWorld(tx,ty,elev);
  const {sx,sy}=worldToScreen(wx,wy,canvas);
  const {TSZ,scale:S}=RS;
  return { x: sx+TSZ*S, y: sy+TSZ*S };
}

// ─── 视口裁切 ─────────────────────────────────────────────────────
function isOnScreen(sx, sy, canvas, margin=64) {
  return sx>-margin && sy>-margin && sx<canvas.width+margin && sy<canvas.height+margin;
}

// ─── 地面菱形绘制（消拼缝） ───────────────────────────────────────
function _drawGroundDiamond(ctx, tc, sx, sy, seam) {
  const {TSZ,scale:S}=RS;
  const EX=seam?1.3:0;
  const U={x:sx+TSZ*S,       y:sy-EX};
  const R={x:sx+TSZ*S*2+EX,  y:sy+TSZ*S/2};
  const D={x:sx+TSZ*S,       y:sy+TSZ*S+EX};
  const L={x:sx-EX,          y:sy+TSZ*S/2};
  ctx.save();
  ctx.beginPath(); ctx.moveTo(U.x,U.y); ctx.lineTo(R.x,R.y); ctx.lineTo(D.x,D.y); ctx.lineTo(L.x,L.y); ctx.closePath();
  ctx.clip();
  const a=(R.x-U.x)/TSZ, b=(R.y-U.y)/TSZ, c=(L.x-U.x)/TSZ, d=(L.y-U.y)/TSZ;
  ctx.setTransform(a,b,c,d,U.x,U.y);
  ctx.drawImage(tc,0,0,TSZ,TSZ);
  ctx.restore();
}

// ─── 悬崖侧面 ────────────────────────────────────────────────────
function _drawCliff(ctx, sx, sy, heightDiff, side, tc) {
  const {TSZ,scale:S}=RS;
  const fH=heightDiff*ELEV_H()*S;
  if (fH<1) return;
  const imgData=tc.getContext('2d').getImageData(0,0,TSZ,TSZ).data;
  const bright=side==='right'?0.42:0.58;
  const cold=side==='right'?12:0;
  const Dx=sx+TSZ*S, Dy=sy+TSZ*S;
  const Rx=sx+TSZ*S*2, Ry=sy+TSZ*S/2;
  const Lx=sx, Ly=sy+TSZ*S/2;
  let P1x,P1y,P2x,P2y;
  if (side==='right'){P1x=Dx;P1y=Dy;P2x=Rx;P2y=Ry;}
  else{P1x=Lx;P1y=Ly;P2x=Dx;P2y=Dy;}

  const steps=Math.max(1,TSZ);
  ctx.save();
  ctx.beginPath(); ctx.moveTo(P1x,P1y); ctx.lineTo(P2x,P2y); ctx.lineTo(P2x,P2y+fH); ctx.lineTo(P1x,P1y+fH); ctx.closePath(); ctx.clip();
  for(let i=0;i<steps;i++){
    const t0=i/steps, t1=(i+1)/steps;
    const srcX=side==='right'?TSZ-1-(i*(TSZ/steps)|0):i*(TSZ/steps)|0;
    const si=(Math.min(TSZ-1,TSZ-1)*TSZ+Math.min(TSZ-1,srcX))*4;
    const pr=imgData[si],pg=imgData[si+1],pb=imgData[si+2];
    const dk=1-0.2;
    ctx.fillStyle=`rgb(${pr*bright*dk|0},${pg*bright*dk|0},${Math.max(0,pb*(bright-cold/255)*dk)|0})`;
    const x0=P1x+(P2x-P1x)*t0, y0=P1y+(P2y-P1y)*t0;
    const x1=P1x+(P2x-P1x)*t1, y1=P1y+(P2y-P1y)*t1;
    ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.lineTo(x1,y1+fH); ctx.lineTo(x0,y0+fH); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle='rgba(0,0,0,0.5)'; ctx.lineWidth=0.7;
  ctx.beginPath(); ctx.moveTo(P1x,P1y+fH); ctx.lineTo(P2x,P2y+fH); ctx.moveTo(P2x,P2y); ctx.lineTo(P2x,P2y+fH); ctx.stroke();
}

// ─── 3D 块体挤出 ─────────────────────────────────────────────────
function _drawBlock(ctx, tc, sx, sy, blockH) {
  const {TSZ,scale:S}=RS;
  const bH=blockH*S; if(bH<1) return;
  const Rx=sx+TSZ*S*2, Ry=sy+TSZ*S/2;
  const Dx=sx+TSZ*S,   Dy=sy+TSZ*S;
  const Lx=sx,         Ly=sy+TSZ*S/2;
  const imgData=tc.getContext('2d').getImageData(0,0,TSZ,TSZ).data;
  const buildFace=(bright,cold,steps)=>{
    const fc=document.createElement('canvas'); fc.width=steps; fc.height=1;
    const fx=fc.getContext('2d');
    for(let i=0;i<steps;i++){
      const si=(Math.min(TSZ-1,TSZ-1)*TSZ+Math.min(TSZ-1,i))*4;
      const pr=imgData[si],pg=imgData[si+1],pb=imgData[si+2];
      fx.fillStyle=`rgb(${pr*bright|0},${pg*bright|0},${Math.max(0,pb*(bright-cold/255))|0})`;
      fx.fillRect(i,0,1,1);
    }
    return fc;
  };
  const rf=buildFace(0.42,12,TSZ), lf=buildFace(0.58,0,TSZ);
  ctx.save(); ctx.imageSmoothingEnabled=false;
  // right face
  ctx.save();
  ctx.beginPath(); ctx.moveTo(Dx,Dy); ctx.lineTo(Rx,Ry); ctx.lineTo(Rx,Ry+bH); ctx.lineTo(Dx,Dy+bH); ctx.closePath(); ctx.clip();
  ctx.setTransform((Rx-Dx)/rf.width,(Ry-Dy)/rf.width,(Dx-Dx)/bH,(Dy+bH-Dy)/bH,Dx,Dy); ctx.drawImage(rf,0,0); ctx.restore();
  // left face
  ctx.save();
  ctx.beginPath(); ctx.moveTo(Lx,Ly); ctx.lineTo(Dx,Dy); ctx.lineTo(Dx,Dy+bH); ctx.lineTo(Lx,Ly+bH); ctx.closePath(); ctx.clip();
  ctx.setTransform((Dx-Lx)/lf.width,(Dy-Ly)/lf.width,(Lx-Lx)/bH,(Ly+bH-Ly)/bH,Lx,Ly); ctx.drawImage(lf,0,0); ctx.restore();
  ctx.restore();
  ctx.strokeStyle='rgba(0,0,0,0.55)'; ctx.lineWidth=0.8;
  ctx.beginPath();
  ctx.moveTo(Rx,Ry); ctx.lineTo(Rx,Ry+bH); ctx.moveTo(Dx,Dy); ctx.lineTo(Dx,Dy+bH);
  ctx.moveTo(Lx,Ly); ctx.lineTo(Lx,Ly+bH); ctx.moveTo(Lx,Ly+bH); ctx.lineTo(Dx,Dy+bH); ctx.lineTo(Rx,Ry+bH); ctx.stroke();
}

// ─── 深度排序（正确 Y-Sort） ──────────────────────────────────────
/**
 * 真正的 Y-Sort：按物件在屏幕上的底边 y 坐标排序
 * 这是 Stardew Valley、Tiled isometric 的标准做法
 */
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
        // Y-Sort: 用 footprint 右下角的菱形 D 点屏幕 y
        const footTx=atx+sw-1, footTy=aty+sh-1;
        const {wx,wy}=tileToWorld(footTx,footTy,elev);
        const {sx,sy}=worldToScreen(wx,wy,canvas);
        const screenBottomY=sy+RS.TSZ*RS.scale;
        // layer 内部用 0.01 偏移确保高层在低层之上
        const depth=screenBottomY+layer*0.01;
        items.push({tx:atx,ty:aty,layer,id,depth,elev,spanW:sw,spanH:sh});
      } else {
        const elev=elevMap?.[ty]?.[tx]?.elev??0;
        const {wx,wy}=tileToWorld(tx,ty,elev);
        const {sx,sy}=worldToScreen(wx,wy,canvas);
        const screenBottomY=sy+RS.TSZ*RS.scale;
        const depth=screenBottomY+layer*0.01;
        items.push({tx,ty,layer,id,depth,elev,spanW:1,spanH:1});
      }
    }
  }
  items.sort((a,b)=>a.depth-b.depth);
  return items;
}

// ─── 主渲染 ──────────────────────────────────────────────────────
export function renderScene(ctx, canvas, {
  layers, elevMap, MW, MH, lVisible, waterFrame=0,
  hoverTx=-1, hoverTy=-1, editMode='paint',
  gridOpacity=0, showElevViz=false,
}) {
  const {TSZ,scale:S}=RS;
  const numLayers=Math.min(lVisible.length, LAYER_COUNT);

  ctx.imageSmoothingEnabled=false;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle='#080a06'; ctx.fillRect(0,0,canvas.width,canvas.height);

  // ── 1. 底色菱形（始终在 elev=0，防止高地露出黑缝）────────────────
  for (let ty=0;ty<MH;ty++) for (let tx=0;tx<MW;tx++){
    const {wx,wy}=tileToWorld(tx,ty,0);
    const {sx,sy}=worldToScreen(wx,wy,canvas);
    if (!isOnScreen(sx,sy,canvas,TSZ*4*S)) continue;
    ctx.fillStyle='#141008';
    ctx.beginPath();
    ctx.moveTo(sx+TSZ*S,sy); ctx.lineTo(sx+TSZ*S*2,sy+TSZ*S/2);
    ctx.lineTo(sx+TSZ*S,sy+TSZ*S); ctx.lineTo(sx,sy+TSZ*S/2);
    ctx.closePath(); ctx.fill();
  }

  // ── 2. 悬崖侧面（高地→低地边缘）────────────────────────────────
  for (let ty=0;ty<MH;ty++) for (let tx=0;tx<MW;tx++){
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

  // ── 3. 排序后渲染所有 tile ────────────────────────────────────────
  const items=getSortedItems(layers,elevMap,MW,MH,lVisible,canvas);
  const gBH=RS.blockH;

  for (const {tx,ty,layer,id,elev,spanW,spanH} of items){
    const def=TILES[id]; if(!def) continue;
    const {wx,wy}=tileToWorld(tx,ty,elev);
    const {sx,sy}=worldToScreen(wx,wy,canvas);
    if (!isOnScreen(sx,sy,canvas,TSZ*(spanW+spanH+2)*S*2)) continue;

    // ── 等轴素材（isIsoTile）────────────────────────────────────────
    if (def.isCustom&&def.isIsoTile&&def._isoC){
      const isoC=def._isoC;
      // footprint 右下角 D 点作为锚点
      const footTx=tx+spanW-1, footTy=ty+spanH-1;
      const {wx:fwx,wy:fwy}=tileToWorld(footTx,footTy,elev);
      const {sx:fsx,sy:fsy}=worldToScreen(fwx,fwy,canvas);
      const anchorX=fsx+TSZ*S, anchorY=fsy+TSZ*S;
      // 宽度适配 span，保持原始宽高比
      const targetW=TSZ*S*2*Math.max(spanW,spanH);
      const targetH=isoC.height/isoC.width*targetW;
      ctx.save(); ctx.imageSmoothingEnabled=false;
      if (def.flipH){
        ctx.translate(anchorX*2,0); ctx.scale(-1,1);
      }
      ctx.drawImage(isoC, Math.round(anchorX-targetW/2), Math.round(anchorY-targetH), Math.round(targetW), Math.round(targetH));
      ctx.restore(); continue;
    }

    const tc=getTileCanvas(id,TSZ,waterFrame); if(!tc) continue;

    if (layer===0||layer===1||layer===2){
      // ── 地面/细节/水体层：菱形投影 ──────────────────────────────
      const blockH=(def.height??0)>0?Math.round(gBH*def.height/10):0;
      if (blockH>0) _drawBlock(ctx,tc,sx,sy,blockH);
      _drawGroundDiamond(ctx,tc,sx,sy,def.seam===true);
    } else {
      // ── 物件/建筑/高物件：竖立，底边对齐 footprint D 点 ─────────
      const footTx=tx+spanW-1, footTy=ty+spanH-1;
      const {wx:fwx,wy:fwy}=tileToWorld(footTx,footTy,elev);
      const {sx:fsx,sy:fsy}=worldToScreen(fwx,fwy,canvas);
      const anchorX=fsx+TSZ*S, anchorY=fsy+TSZ*S;
      const dispW=TSZ*S*2*Math.max(spanW,spanH);
      const dispH=dispW*(tc.height/tc.width);
      const blockH=(def.height??0)>0?Math.round(gBH*def.height/10):0;
      if (blockH>0) _drawBlock(ctx,tc,fsx,fsy,blockH);
      ctx.save(); ctx.imageSmoothingEnabled=false;
      if (def.flipH){ ctx.translate(anchorX*2,0); ctx.scale(-1,1); }
      ctx.drawImage(tc, Math.round(anchorX-dispW/2), Math.round(anchorY-dispH), Math.round(dispW), Math.round(dispH));
      ctx.restore();
    }
  }

  // ── 4. 网格 ───────────────────────────────────────────────────────
  if (gridOpacity>0.005){
    ctx.strokeStyle=`rgba(180,140,40,${gridOpacity})`; ctx.lineWidth=0.5;
    for(let ty2=0;ty2<=MH;ty2++){
      const{wx:ax,wy:ay}=tileToWorld(0,ty2,0),{sx:sax,sy:say}=worldToScreen(ax,ay,canvas);
      const{wx:bx,wy:by}=tileToWorld(MW,ty2,0),{sx:sbx,sy:sby}=worldToScreen(bx,by,canvas);
      ctx.beginPath(); ctx.moveTo(sax+TSZ*S,say); ctx.lineTo(sbx+TSZ*S,sby); ctx.stroke();
    }
    for(let tx2=0;tx2<=MW;tx2++){
      const{wx:ax,wy:ay}=tileToWorld(tx2,0,0),{sx:sax,sy:say}=worldToScreen(ax,ay,canvas);
      const{wx:bx,wy:by}=tileToWorld(tx2,MH,0),{sx:sbx,sy:sby}=worldToScreen(bx,by,canvas);
      ctx.beginPath(); ctx.moveTo(sax+TSZ*S,say); ctx.lineTo(sbx+TSZ*S,sby); ctx.stroke();
    }
  }

  // ── 5. 高度可视化 ─────────────────────────────────────────────────
  if (showElevViz){
    ctx.font=`${Math.max(8,10*S)}px monospace`; ctx.textAlign='center';
    for(let ty2=0;ty2<MH;ty2++) for(let tx2=0;tx2<MW;tx2++){
      const e=elevMap?.[ty2]?.[tx2]?.elev??0; if(!e) continue;
      const{wx,wy}=tileToWorld(tx2,ty2,e);const{sx,sy}=worldToScreen(wx,wy,canvas);
      ctx.fillStyle=`rgba(255,160,40,${0.15+e/8*0.6})`;
      ctx.beginPath(); ctx.moveTo(sx+TSZ*S,sy); ctx.lineTo(sx+TSZ*S*2,sy+TSZ*S/2); ctx.lineTo(sx+TSZ*S,sy+TSZ*S); ctx.lineTo(sx,sy+TSZ*S/2); ctx.closePath(); ctx.fill();
      ctx.fillStyle='rgba(255,255,255,0.85)';
      ctx.fillText(String(e),sx+TSZ*S,sy+TSZ*S/2+4*S);
    }
  }

  // ── 6. 悬停高亮 ───────────────────────────────────────────────────
  if (editMode!=='walk'&&hoverTx>=0&&hoverTy>=0&&hoverTx<MW&&hoverTy<MH){
    const elev=elevMap?.[hoverTy]?.[hoverTx]?.elev??0;
    const{wx,wy}=tileToWorld(hoverTx,hoverTy,elev);const{sx,sy}=worldToScreen(wx,wy,canvas);
    ctx.fillStyle='rgba(240,200,60,0.2)'; ctx.strokeStyle='rgba(240,200,60,0.85)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(sx+TSZ*S,sy); ctx.lineTo(sx+TSZ*S*2,sy+TSZ*S/2); ctx.lineTo(sx+TSZ*S,sy+TSZ*S); ctx.lineTo(sx,sy+TSZ*S/2); ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  // ── 7. 地图边界 ───────────────────────────────────────────────────
  ctx.strokeStyle='rgba(212,160,40,0.4)'; ctx.lineWidth=2;
  const bpts=[[0,0],[MW,0],[MW,MH],[0,MH]].map(([x,y])=>{const{wx,wy}=tileToWorld(x,y,0);return worldToScreen(wx+TSZ,wy,canvas);});
  ctx.beginPath(); ctx.moveTo(bpts[0].sx,bpts[0].sy); bpts.slice(1).forEach(p=>ctx.lineTo(p.sx,p.sy)); ctx.closePath(); ctx.stroke();

  // ── 8. 时间段滤镜（TOD）──────────────────────────────────────────
  if (RS.tod!=='noon'&&RS.todAlpha>0) applyTOD(ctx,canvas,RS.tod,RS.todAlpha);
}

// ─── 小地图 ───────────────────────────────────────────────────────
const MINI_COL={
  grass:'#527a30',grass2:'#426a28',dirt:'#8a6030',path:'#b09060',stone:'#787068',
  water:'#2060a8',sand:'#c8a860',snow:'#d8ecf8',pebble:'#908878',mud:'#4a3420',bamboo_bed:'#687c30',
  flower:'#d84060',bush:'#3a6018',wheat:'#d8a030',chest:'#8a5020',sign:'#8a5020',
  lantern:'#888070',pillar:'#c84020',rock:'#787068',fence:'#9a6028',
  tree:'#2a5010',pine:'#1a3810',bamboo:'#4a6820',plum_tree:'#5a3018',
  house:'#8a2018',
};

export function renderMinimap(mmCanvas, layers, elevMap, MW, MH, lVisible, playerTx, playerTy) {
  const mc=mmCanvas.getContext('2d');
  const mw=mmCanvas.width, mh=mmCanvas.height;
  mc.fillStyle='#0a0806'; mc.fillRect(0,0,mw,mh);
  const tw=mw/(MW+MH), th=mh/(MW+MH);
  const numLayers=Math.min(lVisible.length,LAYER_COUNT);

  for(let L=0;L<numLayers;L++){
    if(!lVisible[L]) continue;
    for(let ty=0;ty<MH;ty++) for(let tx=0;tx<MW;tx++){
      const cell=layers[L]?.[ty]?.[tx]; if(!cell) continue;
      const id=typeof cell==='string'?cell:cell.id;
      const elev=elevMap?.[ty]?.[tx]?.elev??0;
      const isx=((tx-ty)*tw+mw/2)|0;
      const isy=((tx+ty)*th/2-elev*th*0.3)|0;
      mc.fillStyle=MINI_COL[id]??(TILES[id]?.isCustom?'#a8884a':'#888');
      mc.fillRect(isx,isy,Math.max(2,tw*2+.5),Math.max(1,th+.5));
    }
  }
  if (playerTx!==undefined){
    const pisx=((playerTx-playerTy)*tw+mw/2)|0;
    const pisy=((playerTx+playerTy)*th/2)|0;
    mc.fillStyle='#f8f040'; mc.fillRect(pisx-1,pisy-1,3,3);
  }
}
