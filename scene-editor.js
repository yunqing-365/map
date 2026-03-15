/**
 * scene-editor.js  v4
 * 场景编辑器主控制器
 *
 * v4 新增：
 *  ★ 放置调整面板（Placement Panel）：选中自定义等轴素材时显示
 *     - 实时调整 isoScale / anchorOffsetY / 旋转 / 翻转
 *     - ghost 预览即时响应
 *  ★ flipMap：每格独立翻转
 *  ★ anchorOffsetY 参与导出和存档
 *  ★ Cocos JSON + 精灵图集导出
 */

import { RS, updateState, renderScene, renderMinimap,
         screenToTile, tileToWorld, worldToScreen,
         clearTileCache, getTileCanvas } from './iso-renderer.js';
import { TILES, LAYER_COUNT, LAYER_NAMES, LAYER_COLORS,
         getCategoriesByLayer, getTile, registerTile, exportTilesetMeta } from './tile-defs.js';
import { initImportPipeline, openImport, closeImport, confirmImport,
         setFmt, setType, setPal, setRotation, toggleFlip,
         autoDetectSpan } from './import-pipeline.js';

// ─── 地图数据 ─────────────────────────────────────────────────────
let MW=26, MH=20;
let layers   = _emptyLayers(MW,MH);
let elevMap  = _emptyElev(MW,MH);
let flipMap  = _emptyFlipMap(MW,MH); // 每格独立翻转

function _emptyLayers(w,h){return Array.from({length:LAYER_COUNT},()=>Array.from({length:h},()=>new Array(w).fill(null)));}
function _emptyElev(w,h){return Array.from({length:h},()=>Array.from({length:w},()=>({elev:0,slope:'flat'})));}
function _emptyFlipMap(w,h){return Array.from({length:LAYER_COUNT},()=>Array.from({length:h},()=>new Array(w).fill(false)));}

// ─── 编辑状态 ─────────────────────────────────────────────────────
let editMode='paint', activeLayer=0, selTile='grass';
let hoverTx=-1, hoverTy=-1, painting=false, dragging=false;
let dragOrigin={}, lastPx=-1, lastPy=-1;
let showGrid=true, showElevViz=false;
let curElev=0, curSlope='flat', waterFrame=0;
let selBoxStart=null, selBox=null;
let _placingFlipH=false;
let lVisible = Array(LAYER_COUNT).fill(true);
let lLocked  = Array(LAYER_COUNT).fill(false);

// ─── 放置调整面板状态 ─────────────────────────────────────────────
let _panelTileId = null; // 面板当前对应的 tile id

// ─── 撤销/重做 ────────────────────────────────────────────────────
const undoStack=[], redoStack=[];
function snapshot(){
  undoStack.push({
    layers:  JSON.parse(JSON.stringify(layers)),
    elevMap: JSON.parse(JSON.stringify(elevMap)),
    flipMap: JSON.parse(JSON.stringify(flipMap)),
  });
  if(undoStack.length>80) undoStack.shift(); redoStack.length=0;
}
export function undo(){
  if(!undoStack.length) return;
  redoStack.push({layers:JSON.parse(JSON.stringify(layers)),elevMap:JSON.parse(JSON.stringify(elevMap)),flipMap:JSON.parse(JSON.stringify(flipMap))});
  const s=undoStack.pop(); layers=s.layers; elevMap=s.elevMap; flipMap=s.flipMap??_emptyFlipMap(MW,MH); _syncMapSize();
}
export function redo(){
  if(!redoStack.length) return;
  undoStack.push({layers:JSON.parse(JSON.stringify(layers)),elevMap:JSON.parse(JSON.stringify(elevMap)),flipMap:JSON.parse(JSON.stringify(flipMap))});
  const s=redoStack.pop(); layers=s.layers; elevMap=s.elevMap; flipMap=s.flipMap??_emptyFlipMap(MW,MH); _syncMapSize();
}

let clipboard=null, ctxTile={tx:-1,ty:-1};

// ─── Canvas ───────────────────────────────────────────────────────
const canvas  = document.getElementById('gc');
const ctx     = canvas.getContext('2d');
const mmCanvas= document.getElementById('minimap');

function resizeCanvas(){
  const wrap=document.getElementById('canvasWrap');
  canvas.width=wrap.clientWidth; canvas.height=wrap.clientHeight;
  ctx.imageSmoothingEnabled=false;
}

// ─── 角色 ─────────────────────────────────────────────────────────
const player={tx:MW/2,ty:MH/2,frame:0,moving:false,dir:'s'};
const keys={};

function drawPlayer(){
  const{TSZ,scale:S}=RS;
  const elev=elevMap[Math.floor(player.ty)]?.[Math.floor(player.tx)]?.elev??0;
  const{wx,wy}=tileToWorld(player.tx,player.ty,elev);
  const{sx,sy}=worldToScreen(wx,wy,canvas);
  const anchorX=sx+TSZ*S, anchorY=sy+TSZ*S, sz=TSZ*S*1.3;
  const f=player.moving?((player.frame>>3)%2):0, leg=f?sz*.12:0;
  ctx.save(); ctx.imageSmoothingEnabled=false;
  ctx.fillStyle='rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(anchorX,anchorY,sz*.22,sz*.07,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#3850a0';
  ctx.fillRect(anchorX-sz*.22,anchorY-sz*.45,sz*.2,sz*.4+leg); ctx.fillRect(anchorX+sz*.02,anchorY-sz*.45,sz*.2,sz*.4-leg);
  ctx.fillStyle='#201408'; ctx.fillRect(anchorX-sz*.25,anchorY-sz*.08+leg,sz*.25,sz*.1); ctx.fillRect(anchorX+.02,anchorY-sz*.08-leg,sz*.25,sz*.1);
  ctx.fillStyle='#d84028'; ctx.fillRect(anchorX-sz*.3,anchorY-sz*.85,sz*.6,sz*.45);
  ctx.fillRect(anchorX-sz*.5,anchorY-sz*.82+leg*.4,sz*.2,sz*.38); ctx.fillRect(anchorX+sz*.3,anchorY-sz*.82-leg*.4,sz*.2,sz*.38);
  ctx.fillStyle='#f0c880'; ctx.fillRect(anchorX-sz*.28,anchorY-sz*1.28,sz*.56,sz*.5);
  ctx.fillStyle='#3a6828'; ctx.fillRect(anchorX-sz*.32,anchorY-sz*1.3,sz*.64,sz*.12); ctx.fillRect(anchorX-sz*.24,anchorY-sz*1.44,sz*.48,sz*.17);
  ctx.fillStyle='#201408'; ctx.fillRect(anchorX-sz*.16,anchorY-sz*1.1,sz*.1,sz*.09); ctx.fillRect(anchorX+sz*.06,anchorY-sz*1.1,sz*.1,sz*.09);
  ctx.restore();
}

// ─── 游戏循环 ─────────────────────────────────────────────────────
function loop(ts){
  requestAnimationFrame(loop);
  waterFrame=Math.floor(ts/150)&63;

  if(editMode==='walk'){
    const sp=0.04; let dx=0,dy=0;
    if(keys['ArrowLeft']||keys['a']){dx-=sp;dy+=sp;player.dir='sw';}
    if(keys['ArrowRight']||keys['d']){dx+=sp;dy-=sp;player.dir='ne';}
    if(keys['ArrowUp']||keys['w']){dx-=sp;dy-=sp;player.dir='nw';}
    if(keys['ArrowDown']||keys['s']){dx+=sp;dy+=sp;player.dir='se';}
    player.moving=dx!==0||dy!==0;
    if(player.moving){
      const nx=player.tx+dx;if(!_isSolid(nx,player.ty)&&!_isSolid(nx,player.ty+.5))player.tx=Math.max(0,Math.min(MW-1,nx));
      const ny2=player.ty+dy;if(!_isSolid(player.tx,ny2)&&!_isSolid(player.tx+.5,ny2))player.ty=Math.max(0,Math.min(MH-1,ny2));
      player.frame++;
    }
    const{wx,wy}=tileToWorld(player.tx,player.ty,0);
    updateState({viewOX:wx*RS.scale,viewOY:wy*RS.scale});
  }

  const gop=parseFloat(document.getElementById('gridOp')?.value??2)/8*0.3;
  renderScene(ctx, canvas, {
    layers, elevMap, MW, MH, lVisible, waterFrame,
    hoverTx, hoverTy, editMode,
    gridOpacity: showGrid ? gop : 0,
    showElevViz,
    flipMap,
    placingTileId: editMode==='paint' ? selTile : null,
    placingFlipH: _placingFlipH,
  });
  if(editMode==='walk') drawPlayer();

  if(selBox&&editMode==='select'){
    const{TSZ,scale:S}=RS;
    const x0=Math.min(selBox.tx1,selBox.tx2), y0=Math.min(selBox.ty1,selBox.ty2);
    const x1=Math.max(selBox.tx1,selBox.tx2), y1=Math.max(selBox.ty1,selBox.ty2);
    const{wx:wax,wy:way}=tileToWorld(x0,y0,0); const{sx:sax,sy:say}=worldToScreen(wax,way,canvas);
    const{wx:wbx,wy:wby}=tileToWorld(x1+1,y1+1,0); const{sx:sbx,sy:sby}=worldToScreen(wbx,wby,canvas);
    ctx.save();
    ctx.strokeStyle='rgba(80,200,255,0.9)'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
    ctx.strokeRect(sax,say,sbx-sax,sby-say);
    ctx.fillStyle='rgba(80,200,255,0.08)'; ctx.fillRect(sax,say,sbx-sax,sby-say);
    ctx.restore();
  }
  renderMinimap(mmCanvas,layers,elevMap,MW,MH,lVisible,player.tx,player.ty);
}

function _isSolid(tx,ty){
  const itx=Math.floor(tx),ity=Math.floor(ty);
  if(itx<0||ity<0||itx>=MW||ity>=MH) return true;
  for(let L=0;L<LAYER_COUNT;L++){const id=_cellId(L,itx,ity);if(id&&TILES[id]?.solid)return true;}
  return false;
}

// ─── 输入 ─────────────────────────────────────────────────────────
const canvasWrap=document.getElementById('canvasWrap');

canvasWrap.addEventListener('mousemove',e=>{
  const r=canvasWrap.getBoundingClientRect();
  const{tx,ty}=screenToTile(e.clientX-r.left,e.clientY-r.top,canvas);
  hoverTx=tx; hoverTy=ty; _updateCoords(tx,ty);
  if(dragging){updateState({viewOX:dragOrigin.vx-(e.clientX-dragOrigin.mx),viewOY:dragOrigin.vy-(e.clientY-dragOrigin.my)});return;}
  if(painting&&editMode!=='walk'){
    if(editMode==='select'&&selBoxStart)selBox={tx1:selBoxStart.tx,ty1:selBoxStart.ty,tx2:tx,ty2:ty};
    else _paintAt(tx,ty);
  }
});

canvasWrap.addEventListener('mousedown',e=>{
  if(e.button===1){dragging=true;dragOrigin={mx:e.clientX,my:e.clientY,vx:RS.viewOX,vy:RS.viewOY};e.preventDefault();return;}
  if(e.button===2){_showCtx(e);return;}
  if(e.button!==0||editMode==='walk') return;
  _hideCtx();
  const r=canvasWrap.getBoundingClientRect();
  const{tx,ty}=screenToTile(e.clientX-r.left,e.clientY-r.top,canvas);
  if(editMode==='fill'){snapshot();_fill(tx,ty);return;}
  if(editMode==='pick'){_pick(tx,ty);return;}
  if(editMode==='select'){selBoxStart={tx,ty};selBox={tx1:tx,ty1:ty,tx2:tx,ty2:ty};painting=true;return;}
  snapshot(); painting=true; lastPx=lastPy=-1; _paintAt(tx,ty);
});

canvasWrap.addEventListener('mouseup',()=>{painting=false;dragging=false;lastPx=lastPy=-1;selBoxStart=null;});
canvasWrap.addEventListener('mouseleave',()=>{hoverTx=hoverTy=-1;painting=false;dragging=false;});
canvasWrap.addEventListener('wheel',e=>{e.preventDefault();_zoom(e.deltaY<0?1.1:0.91);},{passive:false});
canvasWrap.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('mousedown',e=>{if(!e.target.closest('#ctxMenu'))_hideCtx();});

document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  keys[e.key]=true;
  if(e.key===' '){e.preventDefault();setMode(editMode==='walk'?'paint':'walk');}
  if(e.ctrlKey&&e.key==='z'){e.preventDefault();undo();}
  if(e.ctrlKey&&(e.key==='y'||e.key==='Y')){e.preventDefault();redo();}
  if(e.key==='Escape'){closeImport();_hidePlacementPanel();}
  const mk={p:'paint',e:'erase',f:'fill',t:'terrain',i:'pick',g:'walk',s:'select'};
  if(!e.ctrlKey&&mk[e.key]) setMode(mk[e.key]);
  if(e.key==='G') toggleGrid();
  if(e.key==='h'||e.key==='H'){
    e.preventDefault();
    _placingFlipH=!_placingFlipH;
    if(hoverTx>=0&&hoverTy>=0){
      for(let L=LAYER_COUNT-1;L>=0;L--){
        const id=_cellId(L,hoverTx,hoverTy);
        if(id&&TILES[id]){
          snapshot();
          const{ax,ay}=_getAnchor(L,hoverTx,hoverTy);
          flipMap[L][ay][ax]=!flipMap[L][ay][ax]; break;
        }
      }
    }
    document.getElementById('flipHint')&&(document.getElementById('flipHint').textContent=_placingFlipH?'[镜像放置 ON]':'');
    _updatePanelDisplay();
  }
  if(e.key==='Enter'&&editMode==='select'&&selBox) _fillSelBox();
  if(e.key==='Delete'&&editMode==='select'&&selBox) _eraseSelBox();
  // 调整面板快捷键（选中等轴素材时）
  if(e.key===']') adjIsoScale(0.1);
  if(e.key==='[') adjIsoScale(-0.1);
});
document.addEventListener('keyup',e=>{keys[e.key]=false;});

// ─── 编辑操作 ─────────────────────────────────────────────────────
function _paintAt(tx,ty){
  if(tx<0||ty<0||tx>=MW||ty>=MH) return;
  if(tx===lastPx&&ty===lastPy) return;
  lastPx=tx; lastPy=ty;
  if(editMode==='erase'){for(let L=0;L<LAYER_COUNT;L++)if(!lLocked[L])_eraseCell(L,tx,ty);return;}
  if(editMode==='terrain'){elevMap[ty][tx]={elev:curElev,slope:curSlope};return;}
  if(editMode!=='paint'||!selTile) return;
  const def=getTile(selTile); if(!def) return;
  const L=def.layer; if(lLocked[L]) return;
  const sw=def.spanW??1, sh=def.spanH??1;
  if(tx+sw>MW||ty+sh>MH) return;
  for(let dy=0;dy<sh;dy++) for(let dx=0;dx<sw;dx++) _eraseCell(L,tx+dx,ty+dy);
  if(sw>1||sh>1){
    const anchor={ax:tx,ay:ty,spanW:sw,spanH:sh};
    layers[L][ty][tx]={id:selTile,anchor,spanW:sw,spanH:sh};
    for(let dy=0;dy<sh;dy++) for(let dx=0;dx<sw;dx++){if(dy===0&&dx===0)continue;layers[L][ty+dy][tx+dx]={id:selTile,anchor,spanW:sw,spanH:sh};}
  } else {
    layers[L][ty][tx]=selTile;
  }
  flipMap[L][ty][tx]=_placingFlipH;
}

function _eraseCell(L,tx,ty){
  const cell=layers[L]?.[ty]?.[tx]; if(!cell) return;
  if(typeof cell==='object'&&cell.anchor){
    const{ax,ay,spanW,spanH}=cell.anchor;
    for(let dy=0;dy<spanH;dy++) for(let dx=0;dx<spanW;dx++){
      if(ay+dy<MH&&ax+dx<MW){layers[L][ay+dy][ax+dx]=null;flipMap[L][ay+dy][ax+dx]=false;}
    }
  } else { layers[L][ty][tx]=null; flipMap[L][ty][tx]=false; }
}

function _getAnchor(L,tx,ty){
  const cell=layers[L]?.[ty]?.[tx];
  if(cell&&typeof cell==='object'&&cell.anchor) return {ax:cell.anchor.ax,ay:cell.anchor.ay};
  return {ax:tx,ay:ty};
}

function _fill(stx,sty){
  if(stx<0||sty<0||stx>=MW||sty>=MH) return;
  const def=getTile(selTile); if(!def) return;
  const L=def.layer; if(lLocked[L]) return;
  const target=_cellId(L,stx,sty); if(target===selTile) return;
  const stack=[[stx,sty]], vis=new Set();
  while(stack.length){
    const[tx,ty]=stack.pop();
    if(tx<0||ty<0||tx>=MW||ty>=MH) continue;
    const k=`${tx},${ty}`; if(vis.has(k)) continue;
    if(_cellId(L,tx,ty)!==target) continue;
    vis.add(k); layers[L][ty][tx]=selTile; flipMap[L][ty][tx]=_placingFlipH;
    stack.push([tx+1,ty],[tx-1,ty],[tx,ty+1],[tx,ty-1]);
  }
}

function _fillSelBox(){
  if(!selBox||!selTile) return; snapshot();
  const x0=Math.min(selBox.tx1,selBox.tx2),y0=Math.min(selBox.ty1,selBox.ty2);
  const x1=Math.max(selBox.tx1,selBox.tx2),y1=Math.max(selBox.ty1,selBox.ty2);
  const def=getTile(selTile); if(!def) return;
  const L=def.layer;
  for(let ty=y0;ty<=y1;ty++) for(let tx=x0;tx<=x1;tx++){
    if(tx>=0&&ty>=0&&tx<MW&&ty<MH){layers[L][ty][tx]=selTile;flipMap[L][ty][tx]=_placingFlipH;}
  }
  selBox=null;
}

function _eraseSelBox(){
  if(!selBox) return; snapshot();
  const x0=Math.min(selBox.tx1,selBox.tx2),y0=Math.min(selBox.ty1,selBox.ty2);
  const x1=Math.max(selBox.tx1,selBox.tx2),y1=Math.max(selBox.ty1,selBox.ty2);
  for(let L=0;L<LAYER_COUNT;L++) for(let ty=y0;ty<=y1;ty++) for(let tx=x0;tx<=x1;tx++) if(!lLocked[L]) _eraseCell(L,tx,ty);
  selBox=null;
}

function _pick(tx,ty){
  for(let L=LAYER_COUNT-1;L>=0;L--){
    const id=_cellId(L,tx,ty);
    if(id&&TILES[id]){selTile=id;activeLayer=L;setMode('paint');_refreshPalette();_tryShowPanel();break;}
  }
}

function _cellId(L,tx,ty){const c=layers[L]?.[ty]?.[tx];if(!c)return null;return typeof c==='string'?c:c.id;}

// ─── UI ───────────────────────────────────────────────────────────
const MODE_HINTS={
  paint:  '🖌 绘制 — 点击/拖拽（悬停可预览）',
  erase:  '⌫ 擦除 — 点击/拖拽',
  fill:   '🪣 填充 — 点击区域',
  select: '⬜ 框选 — 拖拽选区 | Enter填充 | Del清除',
  terrain:'⛰ 地形 — 设置高度',
  pick:   '💧 吸管 — 点击吸取',
  walk:   '🚶 行走 — WASD',
};

export function setMode(m){
  editMode=m; selBox=null;
  Object.keys(MODE_HINTS).forEach(k=>document.getElementById('t_'+k)?.classList.toggle('active',k===m));
  const el=document.getElementById('modeHint'); if(el) el.textContent=MODE_HINTS[m]??m;
  if(m!=='paint') _hidePlacementPanel();
  else _tryShowPanel();
}

export function switchTab(btn,tab){
  document.querySelectorAll('.ptab').forEach(b=>b.classList.toggle('active',b===btn));
  ['tiles','terrain','layers'].forEach(t=>{const el=document.getElementById('tab-'+t);if(el)el.style.display=t===tab?'flex':'none';});
}

export function toggleGrid(){ showGrid=!showGrid; }
export function toggleElevViz(){ showElevViz=!showElevViz; document.getElementById('elevInfo')?.style&&(document.getElementById('elevInfo').style.display=showElevViz?'block':'none'); }
export function doZoom(f){ updateState({scale:Math.max(.3,Math.min(5,RS.scale*f))}); }
export function resetView(){ updateState({scale:1,viewOX:0,viewOY:0}); }
function _zoom(f){ doZoom(f); }

export function setTOD(tod){
  const alpha=tod==='noon'?0:0.85;
  updateState({tod,todAlpha:alpha});
  document.querySelectorAll('.tod-btn').forEach(b=>b.classList.toggle('active',b.dataset.tod===tod));
}

function _updateCoords(tx,ty){
  const el=document.getElementById('coordsInfo'); if(!el) return;
  if(tx>=0&&ty>=0&&tx<MW&&ty<MH){const e=elevMap[ty][tx].elev;el.textContent=`格 (${tx},${ty})  高 ${e}`;}
  else el.textContent='— , —';
}

function _refreshPalette(){
  const cats=getCategoriesByLayer(activeLayer);
  const catEl=document.getElementById('tileCats'); if(!catEl) return;
  catEl.innerHTML='';
  const firstCat=cats[0]??'';
  cats.forEach(cat=>{
    const b=document.createElement('button'); b.className='tcat'+(cat===firstCat?' active':'');
    b.textContent=cat==='导入'?'★导入':cat;
    b.onclick=()=>{document.querySelectorAll('.tcat').forEach(x=>x.classList.remove('active'));b.classList.add('active');_buildGrid(cat);};
    catEl.appendChild(b);
  });
  _buildGrid(firstCat);
}

function _buildGrid(cat){
  const grid=document.getElementById('tileGrid'); if(!grid) return;
  grid.innerHTML='';
  Object.entries(TILES).filter(([,t])=>t.layer===activeLayer&&t.cat===cat).forEach(([id,def])=>{
    const item=document.createElement('div');
    item.className='titem'+(id===selTile?' active':'')+(def.isCustom?' custom':'');
    item.dataset.id=id;
    const tc=getTileCanvas(id,32,0)??_fallbackCanvas();
    const cv=document.createElement('canvas'); cv.width=cv.height=32; cv.getContext('2d').drawImage(tc,0,0);
    const badge=document.createElement('div'); badge.className='titem-badge'; badge.textContent=def.name;
    item.appendChild(cv); item.appendChild(badge);
    item.onclick=()=>{
      selTile=id; activeLayer=def.layer;
      document.querySelectorAll('.titem').forEach(x=>x.classList.remove('active')); item.classList.add('active');
      if(editMode==='walk')setMode('paint');
      _tryShowPanel();
    };
    grid.appendChild(item);
  });
}
function _fallbackCanvas(){const c=document.createElement('canvas');c.width=c.height=32;c.getContext('2d').fillStyle='#444';c.getContext('2d').fillRect(0,0,32,32);return c;}

function _buildLayerList(){
  const list=document.getElementById('rLayerList'); if(!list) return;
  list.innerHTML='';
  for(let L=0;L<LAYER_COUNT;L++){
    const row=document.createElement('div'); row.className='lrow'+(L===activeLayer?' active':'');
    row.onclick=()=>{activeLayer=L;_refreshPalette();_buildLayerList();};
    const eye=document.createElement('span'); eye.className='leye'+(lVisible[L]?' on':''); eye.textContent=lVisible[L]?'👁':'🚫';
    eye.onclick=e=>{e.stopPropagation();lVisible[L]=!lVisible[L];_buildLayerList();};
    const dot=document.createElement('div'); dot.className='ldot'; dot.style.background=LAYER_COLORS[L];
    const nm=document.createElement('span'); nm.className='lname'; nm.textContent=LAYER_NAMES[L];
    const lock=document.createElement('span'); lock.className='llock'; lock.textContent=lLocked[L]?'🔒':'🔓';
    lock.onclick=e=>{e.stopPropagation();lLocked[L]=!lLocked[L];_buildLayerList();};
    row.appendChild(eye);row.appendChild(dot);row.appendChild(nm);row.appendChild(lock);
    list.appendChild(row);
  }
}

function _buildElevGrid(){
  const g=document.getElementById('elevGrid'); if(!g) return; g.innerHTML='';
  for(let e=0;e<=8;e++){
    const b=document.createElement('button'); b.className='ebtn'+(e===curElev?' active':'');
    b.textContent=e===0?'平':`+${e}`;
    b.onclick=()=>{curElev=e;document.querySelectorAll('.ebtn').forEach(x=>x.classList.remove('active'));b.classList.add('active');};
    g.appendChild(b);
  }
}

export function setSlope(btn){
  curSlope=btn.dataset.slope;
  document.querySelectorAll('.sbtn[data-slope]').forEach(b=>b.classList.toggle('active',b===btn));
}

// ─── 放置调整面板 ─────────────────────────────────────────────────
/** 判断是否应该显示面板（仅等轴自定义素材） */
function _tryShowPanel(){
  const def = TILES[selTile];
  if(editMode==='paint' && def?.isCustom && def?.isIsoTile) {
    _showPlacementPanel();
  } else {
    _hidePlacementPanel();
  }
}

function _showPlacementPanel(){
  const p=document.getElementById('placementPanel'); if(!p) return;
  _panelTileId=selTile;
  p.style.display='flex';
  _updatePanelDisplay();
}

export function _hidePlacementPanel(){
  const p=document.getElementById('placementPanel'); if(p) p.style.display='none';
  _panelTileId=null;
}

export function _updatePanelDisplay(){
  const def = TILES[_panelTileId??selTile]; if(!def) return;
  const scale = def.isoScale??1.0;
  const anchorY = def.anchorOffsetY??1.0;

  const ppScale = document.getElementById('ppScale');
  const ppAnchor = document.getElementById('ppAnchorY');
  const ppAnchorV = document.getElementById('ppAnchorYV');
  const ppTitle = document.getElementById('ppTitle');
  const ppFlip = document.getElementById('ppFlipBtn');
  const ppSpan = document.getElementById('ppSpan');

  if(ppScale) ppScale.textContent = Math.round(scale*100)+'%';
  if(ppAnchor) ppAnchor.value = anchorY;
  if(ppAnchorV) ppAnchorV.textContent = Math.round(anchorY*100)+'%';
  if(ppTitle) ppTitle.textContent = def.name;
  if(ppFlip) ppFlip.classList.toggle('active', _placingFlipH);
  if(ppSpan) ppSpan.textContent = `${def.spanW??1}×${def.spanH??1}`;

  // 渲染小预览
  const pv = document.getElementById('ppPreview');
  if(pv && def._isoC) {
    const pvctx = pv.getContext('2d');
    const pw=pv.width, ph=pv.height;
    pvctx.clearRect(0,0,pw,ph);
    // 棋盘格背景
    for(let y=0;y<ph;y+=8) for(let x=0;x<pw;x+=8){
      pvctx.fillStyle=((x>>3)+(y>>3))%2===0?'#1a1a20':'#111118';
      pvctx.fillRect(x,y,8,8);
    }
    pvctx.imageSmoothingEnabled=false;
    // 绘制素材（居中，尊重 anchorOffsetY）
    const isoC=def._isoC;
    const ratio=isoC.height/isoC.width;
    let dw=pw*0.88, dh=dw*ratio;
    if(dh>ph*0.92){dh=ph*0.92;dw=dh/ratio;}
    const dx=(pw-dw)/2;
    // 锚点在预览高度 85% 处
    const groundLineY = ph*0.86;
    const dy = groundLineY - dh*anchorY;
    pvctx.drawImage(isoC, Math.round(dx), Math.round(dy), Math.round(dw), Math.round(dh));
    // 地面线（绿色虚线）
    pvctx.strokeStyle='rgba(60,220,120,0.75)';
    pvctx.lineWidth=1; pvctx.setLineDash([3,2]);
    pvctx.beginPath(); pvctx.moveTo(0,groundLineY); pvctx.lineTo(pw,groundLineY); pvctx.stroke();
    pvctx.setLineDash([]);
    pvctx.fillStyle='rgba(60,220,120,0.85)';
    pvctx.beginPath(); pvctx.arc(pw/2,groundLineY,2.5,0,Math.PI*2); pvctx.fill();
  }
}

/** 调整等轴缩放（[ 和 ] 键 或 ±按钮）*/
export function adjIsoScale(delta){
  const def=TILES[selTile]; if(!def||!def.isIsoTile) return;
  def.isoScale = Math.max(0.1, Math.min(8.0, (def.isoScale??1.0)+delta));
  clearTileCache();
  _updatePanelDisplay();
}

/** 调整地面线锚点 Y（拖动滑条）*/
export function adjAnchorY(val){
  const def=TILES[selTile]; if(!def||!def.isIsoTile) return;
  def.anchorOffsetY = Math.max(0.3, Math.min(1.5, parseFloat(val)));
  _updatePanelDisplay();
}

/** 旋转素材图像（±90°）*/
export function adjRotate(deg){
  const def=TILES[selTile]; if(!def||!def._isoC) return;
  const src=def._isoC;
  const sw=src.width, sh=src.height;
  const is90=(Math.abs(deg)===90||Math.abs(deg)===270);
  const outW=is90?sh:sw, outH=is90?sw:sh;
  const c=document.createElement('canvas'); c.width=outW; c.height=outH;
  const rctx=c.getContext('2d');
  rctx.translate(outW/2,outH/2); rctx.rotate(deg*Math.PI/180); rctx.drawImage(src,-sw/2,-sh/2);
  def._isoC=c;
  clearTileCache(); _refreshPalette(); _updatePanelDisplay();
}

/** 切换放置翻转（面板按钮）*/
export function adjFlip(){
  _placingFlipH=!_placingFlipH;
  document.getElementById('flipHint')&&(document.getElementById('flipHint').textContent=_placingFlipH?'[镜像放置 ON]':'');
  _updatePanelDisplay();
}

/** 重置到导入时默认值 */
export function adjReset(){
  const def=TILES[selTile]; if(!def) return;
  def.isoScale=1.0; def.anchorOffsetY=1.0; clearTileCache(); _updatePanelDisplay();
}

// ─── 地图设置 ─────────────────────────────────────────────────────
export function resizeMap(){
  const nw=+document.getElementById('mapW').value, nh=+document.getElementById('mapH').value;
  document.getElementById('mapWV').textContent=nw; document.getElementById('mapHV').textContent=nh;
  const nl=_emptyLayers(nw,nh), ne=_emptyElev(nw,nh), nf=_emptyFlipMap(nw,nh);
  for(let L=0;L<LAYER_COUNT;L++) for(let ty=0;ty<nh;ty++) for(let tx=0;tx<nw;tx++){
    nl[L][ty][tx]=ty<MH&&tx<MW?layers[L][ty][tx]:null;
    ne[ty][tx]=ty<MH&&tx<MW?elevMap[ty][tx]:{elev:0,slope:'flat'};
    nf[L][ty][tx]=ty<MH&&tx<MW?(flipMap[L]?.[ty]?.[tx]??false):false;
  }
  MW=nw; MH=nh; layers=nl; elevMap=ne; flipMap=nf;
}

function _syncMapSize(){
  MH=layers[0].length; MW=layers[0][0].length;
  if(flipMap[0]?.length!==MH||flipMap[0]?.[0]?.length!==MW) flipMap=_emptyFlipMap(MW,MH);
  document.getElementById('mapW').value=MW; document.getElementById('mapWV').textContent=MW;
  document.getElementById('mapH').value=MH; document.getElementById('mapHV').textContent=MH;
}

export function changeTSZ(){const v=+document.getElementById('tszSlider').value;document.getElementById('tszV').textContent=v+'px';updateState({TSZ:v});clearTileCache();_refreshPalette();}
export function changeGrain(){const v=+document.getElementById('grainSlider').value;document.getElementById('grainV').textContent=v+'px';updateState({grainSz:v});clearTileCache();_refreshPalette();}
export function updateBlockH(){const v=+document.getElementById('blockHSlider').value;document.getElementById('blockHV').textContent=v+'px';updateState({blockH:v});}
export function updateGridLabel(){const v=+document.getElementById('gridOp').value;document.getElementById('gridOpV').textContent=Math.round(v/8*100)+'%';}

export function fillGround(){for(let ty=0;ty<MH;ty++)for(let tx=0;tx<MW;tx++)if(!layers[0][ty][tx])layers[0][ty][tx]='grass';}
export function clearLayer(){if(!confirm(`清空${LAYER_NAMES[activeLayer]}层？`))return;snapshot();layers[activeLayer]=Array.from({length:MH},()=>new Array(MW).fill(null));}
export function clearAll(){if(!confirm('清空全部？'))return;snapshot();layers=_emptyLayers(MW,MH);elevMap=_emptyElev(MW,MH);flipMap=_emptyFlipMap(MW,MH);}

// ─── 导出 ─────────────────────────────────────────────────────────
export function exportScene(){
  canvas.toBlob(b=>{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='scene.png';a.click();});
}

export function exportTiledJSON(){
  const tiledLayers=[];
  for(let L=0;L<LAYER_COUNT;L++){
    const data=[];
    for(let ty=0;ty<MH;ty++) for(let tx=0;tx<MW;tx++){
      const id=_cellId(L,tx,ty);
      data.push(id?Math.abs([...id].reduce((h,c)=>((h<<5)-h+c.charCodeAt(0),0),0))%10000+1:0);
    }
    tiledLayers.push({id:L,name:LAYER_NAMES[L],type:'tilelayer',width:MW,height:MH,data,visible:lVisible[L],opacity:1,x:0,y:0});
  }
  const json={
    version:'1.10',tiledversion:'1.10.2',orientation:'isometric',renderorder:'right-down',
    width:MW,height:MH,tilewidth:RS.TSZ*2,tileheight:RS.TSZ,
    infinite:false,nextlayerid:LAYER_COUNT+1,nextobjectid:1,
    layers:tiledLayers,
    tilesets:[{firstgid:1,name:'FarmTileset',tilewidth:RS.TSZ*2,tileheight:RS.TSZ,
      tiles:exportTilesetMeta().map((t,i)=>({id:i,class:t.id,properties:[{name:'walkable',type:'bool',value:t.walkable},{name:'tags',type:'string',value:t.tags.join(',')}]}))}],
  };
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(json,null,2)],{type:'application/json'}));
  a.download='scene_tiled.json'; a.click();
}

/** 导出 Cocos Creator 专用 JSON（完整元数据 + anchorOffsetY） */
export function exportCocosJSON(){
  const tileDefinitions={};
  for(const id in TILES){
    const t=TILES[id];
    const def={
      name:t.name, layer:t.layer, layerName:LAYER_NAMES[t.layer],
      walkable:!t.solid, solid:!!t.solid,
      spanW:t.spanW??1, spanH:t.spanH??1, height:t.height??0,
      tags:t.tags??[], terrainGroup:t.terrainGroup??null,
      isWater:!!t.isWater, isCustom:!!t.isCustom, isIsoTile:!!t.isIsoTile,
      isoScale:t.isoScale??1.0,
      anchorOffsetY:t.anchorOffsetY??1.0,  // ★ 地面线位置，Cocos 端对齐用
      origTSZ:t.origTSZ??RS.TSZ,
    };
    if(t.isCustom){
      const src=t._isoC||t._squareC;
      if(src){
        const tmp=document.createElement('canvas');
        tmp.width=src.width; tmp.height=src.height;
        tmp.getContext('2d').drawImage(src,0,0);
        def.spriteDataUrl=tmp.toDataURL('image/png');
        def.spriteWidth=src.width; def.spriteHeight=src.height;
      }
    }
    tileDefinitions[id]=def;
  }

  const layersData=[];
  for(let L=0;L<LAYER_COUNT;L++){
    const cells=[];
    for(let ty=0;ty<MH;ty++) for(let tx=0;tx<MW;tx++){
      const cell=layers[L]?.[ty]?.[tx]; if(!cell) continue;
      const id=typeof cell==='string'?cell:cell.id;
      if(typeof cell==='object'&&cell.anchor){if(cell.anchor.ax!==tx||cell.anchor.ay!==ty)continue;}
      cells.push({
        tx,ty,tileId:id,
        flipH:flipMap[L]?.[ty]?.[tx]??false,
        spanW:typeof cell==='object'?(cell.spanW??1):1,
        spanH:typeof cell==='object'?(cell.spanH??1):1,
      });
    }
    layersData.push({id:L,name:LAYER_NAMES[L],visible:lVisible[L],cells});
  }

  const elevData=[];
  for(let ty=0;ty<MH;ty++) for(let tx=0;tx<MW;tx++){
    const e=elevMap[ty][tx];
    if(e.elev!==0||e.slope!=='flat') elevData.push({tx,ty,elev:e.elev,slope:e.slope});
  }

  const cocosJSON={
    version:'cocos-1.1', editor:'国风场景编辑器 v4',
    exportTime:new Date().toISOString(),
    meta:{
      mapWidth:MW, mapHeight:MH, tileSize:RS.TSZ, tod:RS.tod,
      layerNames:LAYER_NAMES,
      isoAngle:26.565,  // arctan(0.5)，2:1 等轴测
    },
    layers:layersData, elevation:elevData, tileDefinitions,
  };

  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(cocosJSON,null,2)],{type:'application/json'}));
  a.download='scene_cocos.json'; a.click();
}

/** 导出精灵图集 PNG + JSON Atlas */
export function exportSpritesheet(){
  const TSZ=RS.TSZ;
  const ids=Object.keys(TILES).filter(id=>!TILES[id].isInvisible);
  const COLS=8;
  const rows=Math.ceil(ids.length/COLS);
  const sheetW=COLS*TSZ*2, sheetH=rows*TSZ*2;
  const sc=document.createElement('canvas'); sc.width=sheetW; sc.height=sheetH;
  const sctx=sc.getContext('2d'); sctx.imageSmoothingEnabled=false; sctx.clearRect(0,0,sheetW,sheetH);
  const atlas={tileSize:TSZ,sheetWidth:sheetW,sheetHeight:sheetH,tiles:{}};
  ids.forEach((id,i)=>{
    const def=TILES[id]; const col=i%COLS, row=Math.floor(i/COLS);
    const x=col*TSZ*2, y=row*TSZ*2;
    if(def.isCustom&&def.isIsoTile&&def._isoC){
      sctx.drawImage(def._isoC,x,y,TSZ*2,TSZ*2);
      atlas.tiles[id]={x,y,w:TSZ*2,h:TSZ*2,name:def.name,layer:def.layer,
        spanW:def.spanW??1,spanH:def.spanH??1,walkable:!def.solid,
        isIsoTile:true,isoScale:def.isoScale??1.0,anchorOffsetY:def.anchorOffsetY??1.0,tags:def.tags??[]};
    } else {
      const tc=getTileCanvas(id,TSZ,0);
      if(tc) sctx.drawImage(tc,x+TSZ/2,y+TSZ/2,TSZ,TSZ);
      atlas.tiles[id]={x:x+TSZ/2,y:y+TSZ/2,w:TSZ,h:TSZ,name:def.name,layer:def.layer,
        spanW:def.spanW??1,spanH:def.spanH??1,walkable:!def.solid,
        isIsoTile:false,tags:def.tags??[]};
    }
  });
  sc.toBlob(b=>{const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='tileset.png';a.click();});
  setTimeout(()=>{
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([JSON.stringify(atlas,null,2)],{type:'application/json'}));
    a.download='tileset_atlas.json'; a.click();
  },300);
}

/** 完整工程存档（含 flipMap + anchorOffsetY） */
export function saveGame(){
  const customTiles={};
  for(const id in TILES){
    const t=TILES[id]; if(!t.isCustom) continue;
    const c=t._isoC||t._squareC; if(!c) continue;
    const tmp=document.createElement('canvas'); tmp.width=c.width; tmp.height=c.height;
    tmp.getContext('2d').drawImage(c,0,0);
    customTiles[id]={...t,_b64:tmp.toDataURL(),draw:null,_isoC:null,_squareC:null};
  }
  const data=JSON.stringify({v:4,layers,elevMap,flipMap,MW,MH,customTiles,tod:RS.tod});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([data],{type:'application/json'}));
  a.download='map_save.json'; a.click();
  _idbSave(data);
}

export function loadGame(event){
  const file=event.target.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const data=JSON.parse(e.target.result);
      if(!data.layers||!data.elevMap) throw new Error('格式错误');
      MW=data.MW; MH=data.MH;
      layers=data.layers; elevMap=data.elevMap;
      flipMap=data.flipMap??_emptyFlipMap(MW,MH);
      _syncMapSize();
      if(data.tod) setTOD(data.tod);
      if(data.customTiles){
        for(const id in data.customTiles){
          const ct=data.customTiles[id];
          const img=new Image();
          img.onload=()=>{
            const cv=document.createElement('canvas'); cv.width=img.width; cv.height=img.height;
            cv.getContext('2d').drawImage(img,0,0);
            if(ct.isIsoTile) ct._isoC=cv; else ct._squareC=cv;
            ct.draw=(c,s)=>{c.imageSmoothingEnabled=false;c.drawImage(cv,0,0,s,s);};
            registerTile(id,ct); _refreshPalette();
          };
          img.src=ct._b64;
        }
      }
      alert('✅ 存档加载成功！');
    } catch(err){alert('❌ 存档格式错误：'+err.message);}
  };
  reader.readAsText(file); event.target.value='';
}

// ─── IndexedDB ────────────────────────────────────────────────────
let _idb=null;
async function _idbInit(){
  return new Promise((res,rej)=>{
    const req=indexedDB.open('FarmSceneMaker',1);
    req.onupgradeneeded=e=>{e.target.result.createObjectStore('saves');};
    req.onsuccess=e=>{_idb=e.target.result;res();}; req.onerror=rej;
  });
}
function _idbSave(data){
  if(!_idb) return;
  try{const tx=_idb.transaction('saves','readwrite');tx.objectStore('saves').put(data,'autosave');}catch(e){}
}

setInterval(()=>{
  const customTiles={};
  for(const id in TILES){
    const t=TILES[id];if(!t.isCustom)continue;
    const c=t._isoC||t._squareC;if(!c)continue;
    const tmp=document.createElement('canvas');tmp.width=c.width;tmp.height=c.height;
    tmp.getContext('2d').drawImage(c,0,0);
    customTiles[id]={...t,_b64:tmp.toDataURL(),draw:null,_isoC:null,_squareC:null};
  }
  _idbSave(JSON.stringify({v:4,layers,elevMap,flipMap,MW,MH,customTiles,tod:RS.tod}));
},30000);

// ─── 右键菜单 ─────────────────────────────────────────────────────
function _showCtx(e){
  const r=canvasWrap.getBoundingClientRect();
  const{tx,ty}=screenToTile(e.clientX-r.left,e.clientY-r.top,canvas);
  ctxTile={tx,ty};
  const m=document.getElementById('ctxMenu'); if(!m) return;
  m.style.left=e.clientX+'px'; m.style.top=e.clientY+'px'; m.classList.add('open');
}
function _hideCtx(){document.getElementById('ctxMenu')?.classList.remove('open');}

export function ctxAction(act){
  _hideCtx(); const{tx,ty}=ctxTile;
  if(act==='copy'){
    const cells=[];for(let L=0;L<LAYER_COUNT;L++){const id=_cellId(L,tx,ty);if(id)cells.push({L,id,flipH:flipMap[L]?.[ty]?.[tx]??false});}
    clipboard={cells,elev:elevMap[ty]?.[tx]?.elev??0};
  } else if(act==='paste'&&clipboard){
    snapshot(); clipboard.cells.forEach(({L,id,flipH})=>{if(!lLocked[L]&&ty<MH&&tx<MW){layers[L][ty][tx]=id;flipMap[L][ty][tx]=flipH;}});
    if(elevMap[ty]?.[tx]) elevMap[ty][tx].elev=clipboard.elev;
  } else if(act==='pick') _pick(tx,ty);
  else if(act==='flip'){
    for(let L=LAYER_COUNT-1;L>=0;L--){
      const id=_cellId(L,tx,ty);
      if(id&&TILES[id]){snapshot();const{ax,ay}=_getAnchor(L,tx,ty);flipMap[L][ay][ax]=!flipMap[L][ay][ax];break;}
    }
  } else if(act==='erase'){snapshot();for(let L=0;L<LAYER_COUNT;L++)_eraseCell(L,tx,ty);}
}

// ─── Init ─────────────────────────────────────────────────────────
export async function init(){
  resizeCanvas();
  _buildElevGrid(); _buildLayerList(); _refreshPalette(); updateGridLabel();

  ['mapW','mapH'].forEach(id=>document.getElementById(id)?.addEventListener('input',resizeMap));
  document.getElementById('tszSlider')?.addEventListener('input',changeTSZ);
  document.getElementById('grainSlider')?.addEventListener('input',changeGrain);
  document.getElementById('blockHSlider')?.addEventListener('input',updateBlockH);
  document.getElementById('gridOp')?.addEventListener('input',updateGridLabel);

  // 面板滑条联动
  document.getElementById('ppAnchorY')?.addEventListener('input',e=>adjAnchorY(e.target.value));

  initImportPipeline((id,layer)=>{
    activeLayer=layer; _refreshPalette(); selTile=id;
    document.querySelectorAll('.titem').forEach(x=>x.classList.remove('active'));
    document.querySelector(`.titem[data-id="${id}"]`)?.classList.add('active');
    _tryShowPanel();
  });

  const expose={
    setMode,switchTab,toggleGrid,toggleElevViz,doZoom,resetView,undo,redo,
    openImport,closeImport,confirmImport,setFmt,setType,setPal,setRotation,toggleFlip,
    autoDetectSpan,
    setSlope,ctxAction,fillGround,clearLayer,clearAll,
    exportScene,exportTiledJSON,exportCocosJSON,exportSpritesheet,
    saveGame,loadGame,setTOD,
    adjIsoScale,adjAnchorY,adjRotate,adjFlip,adjReset,
    _hidePlacementPanel,
  };
  Object.entries(expose).forEach(([k,v])=>window[k]=v);

  window._selLayer=(L)=>{activeLayer=L;document.querySelectorAll('[id^=ltab]').forEach((b,i)=>b.classList.toggle('active',i===L));_refreshPalette();_buildLayerList();};
  window.selBoxFill=_fillSelBox;
  window.selBoxErase=_eraseSelBox;

  await _idbInit();
  fillGround();
  [[3,3,'tree',5],[7,2,'pine',5],[14,4,'tree',5],[20,2,'bamboo',5],
   [2,8,'rock',3],[5,10,'bush',3],[10,6,'flower',1],
   [14,10,'house',4],[8,12,'lantern',3],[9,12,'lantern',3],
   [5,5,'fence',3],[6,5,'fence',3],[7,5,'fence',3],
   [10,3,'wheat',1],[11,3,'wheat',1],[4,14,'plum_tree',5],
  ].forEach(([tx,ty,id,L])=>{if(ty<MH&&tx<MW)layers[L][ty][tx]=id;});
  for(let tx=18;tx<22;tx++) for(let ty=14;ty<18;ty++) layers[2][ty][tx]='water';
  for(let tx=4;tx<14;tx++) layers[0][8][tx]='stone';
  for(let ty=0;ty<4;ty++) for(let tx=0;tx<4;tx++) elevMap[ty][tx]={elev:2,slope:'flat'};
  elevMap[3][3]={elev:1,slope:'flat'};

  setMode('paint');
  requestAnimationFrame(loop);
}

window.addEventListener('resize',resizeCanvas);
window.addEventListener('load',init);
