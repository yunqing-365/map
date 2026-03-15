/**
 * import-pipeline.js  v2
 * 素材导入管线 — 国风升级版
 *
 * 新增：
 *  - 旋转支持：0°/90°/180°/270°
 *  - 水平翻转
 *  - 国风色板（GUOFENG）
 *  - iso 模式保留 alpha（不再有黑底）
 *  - origTSZ 记录，支持缩放后正确还原
 */

import { pixelizeImage, isoProjectFlat, rotateCanvas, flipCanvas,
         colorAdjust, downsample, medianCut, quantizeFS,
         SDW_PALETTE, GUOFENG_PALETTE } from './pixel-engine.js';
import { registerTile, LAYERS } from './tile-defs.js';
import { clearTileCache, RS } from './iso-renderer.js';

// ─── 状态 ─────────────────────────────────────────────────────────
let _img=null, _fmt='flat', _type='ground', _palMode='stardew';
let _spanW=1, _spanH=1, _rotation=0, _flipH=false;
let _processed=null, _customCount=0, _debounce=null, _onAdded=null;
let _spanDrag=null;

// ─── Public API ───────────────────────────────────────────────────
export function initImportPipeline(onAdded) {
  _onAdded=onAdded;
  _bindFile(); _buildSpanPicker(); _bindSliders(); _bindButtons();
  document.getElementById('importModal').addEventListener('click',e=>{
    if(e.target===document.getElementById('importModal')) closeImport();
  });
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&document.getElementById('importModal').classList.contains('open')) closeImport();
  });
}

export function openImport(){
  document.getElementById('importModal').classList.add('open'); _setStep(1);
}

export function closeImport(){
  document.getElementById('importModal').classList.remove('open');
  _img=null; _processed=null; _rotation=0; _flipH=false;
  _safe('mdropThumb',el=>{el.width=1;el.height=1;el.getContext('2d').clearRect(0,0,1,1);});
  _safe('mdrop',el=>el.classList.remove('loaded'));
  _safe('mName',el=>el.value='');
  _safe('confBtn',el=>el.disabled=true);
  _safe('mprev',el=>el.innerHTML='<div style="font-size:9px;color:var(--muted)">上传图片后自动预览</div>');
  // 重置旋转/翻转按钮
  document.querySelectorAll('.rot-btn').forEach(b=>b.classList.toggle('active',b.dataset.rot==='0'));
  _safe('flipBtn',el=>el.classList.remove('active'));
}

// ─── 文件绑定 ─────────────────────────────────────────────────────
function _bindFile(){
  const drop=document.getElementById('mdrop'), fin=document.getElementById('fileInput');
  if(!drop||!fin) return;
  drop.addEventListener('click',()=>fin.click());
  drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag');});
  drop.addEventListener('dragleave',()=>drop.classList.remove('drag'));
  drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag');if(e.dataTransfer.files[0])_loadFile(e.dataTransfer.files[0]);});
  fin.addEventListener('change',e=>{if(e.target.files[0])_loadFile(e.target.files[0]);e.target.value='';});
}

function _loadFile(file){
  if(!file.type.startsWith('image/')) return;
  const url=URL.createObjectURL(file);
  const img=new Image();
  img.onload=()=>{
    _img=img;
    const thumb=document.getElementById('mdropThumb');
    if(thumb){thumb.width=img.width;thumb.height=img.height;thumb.getContext('2d').drawImage(img,0,0);}
    _safe('mdrop',el=>el.classList.add('loaded'));
    const nameEl=document.getElementById('mName');
    if(nameEl&&!nameEl.value) nameEl.value=file.name.replace(/\.[^.]+$/,'').slice(0,14);
    _setStep(2); _schedule();
  };
  img.src=url;
}

// ─── Span picker ──────────────────────────────────────────────────
function _buildSpanPicker(){
  const sp=document.getElementById('spanPicker'); if(!sp) return;
  sp.innerHTML='';
  for(let r=1;r<=4;r++) for(let c=1;c<=6;c++){
    const cell=document.createElement('div');
    cell.className='span-cell'; cell.dataset.r=r; cell.dataset.c=c; cell.textContent=`${c}×${r}`;
    cell.addEventListener('mousedown',ev=>{_spanDrag={c,r};_updateSpan(c,r,c,r);ev.preventDefault();});
    cell.addEventListener('mouseover',()=>{if(_spanDrag)_updateSpan(_spanDrag.c,_spanDrag.r,c,r);});
    sp.appendChild(cell);
  }
  document.addEventListener('mouseup',()=>{_spanDrag=null;});
  _updateSpan(1,1,1,1);
}

function _updateSpan(c1,r1,c2,r2){
  _spanW=Math.max(c1,c2); _spanH=Math.max(r1,r2);
  document.querySelectorAll('.span-cell').forEach(el=>{
    const c=+el.dataset.c,r=+el.dataset.r;
    el.classList.toggle('sel',c===_spanW&&r===_spanH);
    el.classList.toggle('inrange',c<=_spanW&&r<=_spanH&&!(c===_spanW&&r===_spanH));
  });
  _safe('spanDisplay',el=>el.textContent=`${_spanW}×${_spanH} 格`);
}

// ─── 滑条绑定 ─────────────────────────────────────────────────────
function _bindSliders(){
  const defs={
    mGrain:  ['mGrainV', v=>v+'px'],
    mPixSz:  ['mPixSzV', v=>v+'px'],
    mIsoSc:  ['mIsoScV', v=>v+'%'],
    mColors: ['mColorsV',v=>v+'色'],
    mContrast:['mContrastV',v=>(v/100).toFixed(2)],
    mSat:    ['mSatV',   v=>(v/100).toFixed(2)],
    mWarm:   ['mWarmV',  v=>(v>=0?'+':'')+v],
    mHeight: ['mHeightV',v=>v],
  };
  Object.entries(defs).forEach(([id,[vid,fmt]])=>{
    const el=document.getElementById(id); if(!el) return;
    const upd=()=>{_safe(vid,v=>v.textContent=fmt(el.value));_schedule();};
    el.addEventListener('input',upd); upd();
  });
}

// ─── 按钮绑定 ─────────────────────────────────────────────────────
function _bindButtons(){
  _safe('fmtFlat',el=>el.addEventListener('click',()=>setFmt('flat')));
  _safe('fmtIso', el=>el.addEventListener('click',()=>setFmt('iso')));
  document.querySelectorAll('.mbtn[data-type]').forEach(btn=>
    btn.addEventListener('click',()=>setType(btn.dataset.type)));
  _safe('palSDW', el=>el.addEventListener('click',()=>setPal('stardew')));
  _safe('palGF',  el=>el.addEventListener('click',()=>setPal('guofeng')));
  _safe('palAuto',el=>el.addEventListener('click',()=>setPal('auto')));
  _safe('confBtn',el=>el.addEventListener('click',confirmImport));
  // 旋转按钮
  document.querySelectorAll('.rot-btn').forEach(btn=>{
    btn.addEventListener('click',()=>setRotation(+btn.dataset.rot, btn));
  });
  // 翻转按钮
  _safe('flipBtn',el=>el.addEventListener('click',()=>toggleFlip()));
}

// ─── 导出 UI handlers ────────────────────────────────────────────
export function setFmt(fmt){
  _fmt=fmt;
  _safe('fmtFlat',el=>el.classList.toggle('active',fmt==='flat'));
  _safe('fmtIso', el=>el.classList.toggle('active',fmt==='iso'));
  _safe('mFlatRow',el=>el.style.display=fmt==='flat'?'':'none');
  _safe('mIsoRow', el=>el.style.display=fmt==='iso' ?'':'none');
  _schedule();
}

export function setType(type){
  _type=type;
  document.querySelectorAll('.mbtn[data-type]').forEach(b=>b.classList.toggle('active',b.dataset.type===type));
}

export function setPal(mode){
  _palMode=mode;
  _safe('palSDW', el=>el.classList.toggle('active',mode==='stardew'));
  _safe('palGF',  el=>el.classList.toggle('active',mode==='guofeng'));
  _safe('palAuto',el=>el.classList.toggle('active',mode==='auto'));
  _schedule();
}

export function setRotation(deg, btn){
  _rotation=deg;
  document.querySelectorAll('.rot-btn').forEach(b=>b.classList.toggle('active',+b.dataset.rot===deg));
  _schedule();
}

export function toggleFlip(){
  _flipH=!_flipH;
  _safe('flipBtn',el=>el.classList.toggle('active',_flipH));
  _schedule();
}

// ─── 处理管线 ─────────────────────────────────────────────────────
function _schedule(){ clearTimeout(_debounce); _debounce=setTimeout(_run,150); }

async function _run(){
  if (!_img) return;
  _setStep(3);
  const grain    = +(_val('mGrain')??1);
  const colors   = +(_val('mColors')??32);
  const contrast = +(_val('mContrast')??120)/100;
  const sat      = +(_val('mSat')??125)/100;
  const warm     = +(_val('mWarm')??5);
  const TSZ      = RS.TSZ;

  const palette = _palMode==='stardew' ? SDW_PALETTE
                : _palMode==='guofeng' ? GUOFENG_PALETTE
                : null; // null = auto (medianCut)

  if (_fmt==='iso'){
    // 等轴素材：直接保留原图最高画质，只做色调统一
    const scaleRatio=+(_val('mIsoSc')??100)/100;
    const srcW=_img.naturalWidth, srcH=_img.naturalHeight;
    const spanMax=Math.max(_spanW,_spanH);
    const tW=Math.round(TSZ*2*spanMax*scaleRatio);
    const tH=Math.round(srcH/srcW*tW);

    // 色调处理（保留 alpha）
    const tmp=new OffscreenCanvas(srcW,srcH);
    tmp.getContext('2d').drawImage(_img,0,0);
    let px=tmp.getContext('2d').getImageData(0,0,srcW,srcH).data;
    px=colorAdjust(px,srcW,srcH,contrast,sat,warm);

    // 量化（可选，如果选了色板）
    let sc;
    if (palette){
      const pw=Math.max(4,Math.round(tW/Math.max(1,grain)));
      const ph=Math.max(4,Math.round(tH/Math.max(1,grain)));
      const sm=downsample(px,srcW,srcH,pw,ph);
      const q=quantizeFS(sm,pw,ph,palette);
      sc=new OffscreenCanvas(pw,ph);
      const qd=sc.getContext('2d').createImageData(pw,ph);
      for(let i=0;i<q.length;i+=4){
        qd.data[i]=q[i]; qd.data[i+1]=q[i+1]; qd.data[i+2]=q[i+2];
        qd.data[i+3]=sm[i+3]; // 保留原始 alpha！
      }
      sc.getContext('2d').putImageData(qd,0,0);
    } else {
      // 不量化，直接缩放
      sc=new OffscreenCanvas(srcW,srcH);
      sc.getContext('2d').putImageData(new ImageData(px,srcW,srcH),0,0);
    }

    let isoC=new OffscreenCanvas(tW,tH);
    const ictx=isoC.getContext('2d'); ictx.imageSmoothingEnabled=false;
    ictx.clearRect(0,0,tW,tH);
    ictx.drawImage(sc,0,0,tW,tH);

    // 应用旋转和翻转
    if (_rotation) isoC=rotateCanvas(isoC,_rotation);
    if (_flipH)    isoC=flipCanvas(isoC);

    _processed={mode:'iso',isoC,tW:isoC.width,tH:isoC.height,origTSZ:TSZ};
    _setStep(4); _renderPreview();

  } else {
    // 正方形→等轴测投影
    const pixSz=+(_val('mPixSz')??3);
    const palMode=_palMode;
    const pixC=await pixelizeImage(_img,{tileSize:TSZ,pixSz,grain,colors,contrast,sat,warm,palMode,preserveAlpha:true});
    let isoC=isoProjectFlat(pixC,TSZ);
    if (_rotation) isoC=rotateCanvas(isoC,_rotation);
    if (_flipH)    isoC=flipCanvas(isoC);
    _processed={mode:'flat',pixC,isoC,tW:isoC.width,tH:isoC.height,origTSZ:TSZ};
    _setStep(4); _renderPreview();
  }
  _safe('confBtn',el=>el.disabled=false);
}

// ─── 确认导入 ─────────────────────────────────────────────────────
export function confirmImport(){
  if (!_processed) return;
  const name    = document.getElementById('mName')?.value.trim()||`素材${++_customCount}`;
  const id      = 'custom_'+Date.now();
  const walkable= document.getElementById('mWalkable')?.checked??true;
  const heightV = +(_val('mHeight')??0);
  const layerMap= {ground:LAYERS.GROUND,object:LAYERS.OBJ_LOW,building:LAYERS.BUILDING,obstacle:LAYERS.OBSTACLE};
  const layer   = layerMap[_type]??LAYERS.GROUND;

  if (_processed.mode==='iso'){
    const{isoC,tW,tH,origTSZ}=_processed;
    const storeC=document.createElement('canvas');
    storeC.width=tW; storeC.height=tH;
    const sctx=storeC.getContext('2d');
    sctx.clearRect(0,0,tW,tH); // 确保透明背景
    sctx.drawImage(isoC,0,0);

    registerTile(id,{
      name,layer,cat:'导入',solid:!walkable,height:heightV,
      spanW:_spanW,spanH:_spanH,
      isCustom:true,isIsoTile:true,
      _isoC:storeC,isoW:tW,isoH:tH,
      origTSZ:origTSZ??RS.TSZ,
      flipH:false,
      seam:false,
      tags:['custom'],
      draw:(c,s)=>{c.imageSmoothingEnabled=false;c.drawImage(storeC,0,0,s,s);},
    });
  } else {
    const{pixC,origTSZ}=_processed;
    const TSZ2=RS.TSZ;
    const grainV=+(_val('mGrain')??1);
    const sqC=document.createElement('canvas'); sqC.width=sqC.height=TSZ2;
    const sctx=sqC.getContext('2d'); sctx.imageSmoothingEnabled=false;
    if(grainV>1){
      const g=Math.max(1,(TSZ2/grainV)|0);
      const tmp=document.createElement('canvas'); tmp.width=tmp.height=g;
      tmp.getContext('2d').drawImage(pixC,0,0,g,g);
      sctx.drawImage(tmp,0,0,TSZ2,TSZ2);
    } else sctx.drawImage(pixC,0,0,TSZ2,TSZ2);

    registerTile(id,{
      name,layer,cat:'导入',solid:!walkable,height:heightV,
      spanW:_spanW,spanH:_spanH,
      isCustom:true,isIsoTile:false,
      _squareC:sqC,
      origTSZ:origTSZ??RS.TSZ,
      flipH:false,
      seam:layer===LAYERS.GROUND,
      tags:['custom'],
      draw:(c,s)=>{c.imageSmoothingEnabled=false;c.drawImage(sqC,0,0,s,s);},
    });
  }

  clearTileCache();
  closeImport();
  _onAdded?.(id,layer);
}

// ─── 预览渲染 ─────────────────────────────────────────────────────
function _renderPreview(){
  const prev=document.getElementById('mprev'); if(!prev) return;
  prev.innerHTML='';
  const addBox=(label,src,w,h,hi=false)=>{
    const box=document.createElement('div'); box.className='pbox';
    const lbl=document.createElement('div'); lbl.className='plbl'+(hi?' hi':''); lbl.textContent=label;
    const cv=document.createElement('canvas');
    cv.width=src.width??src.naturalWidth; cv.height=src.height??src.naturalHeight;
    cv.style.cssText=`width:${w}px;height:${h}px;image-rendering:pixelated;border:1px solid var(--bdr2);border-radius:3px;background:repeating-conic-gradient(#18181e 0% 25%,#111118 0% 50%) 0 0/6px 6px`;
    cv.getContext('2d').drawImage(src,0,0);
    box.appendChild(lbl); box.appendChild(cv); prev.appendChild(box);
  };
  const addArr=()=>{const a=document.createElement('div');a.className='parrow';a.textContent='→';prev.appendChild(a);};
  const MAX=160;
  const srcW=_img.naturalWidth,srcH=_img.naturalHeight;
  addBox('原图',_img,Math.min(MAX,srcW),Math.round(srcH/srcW*Math.min(MAX,srcW)));
  if(_processed.mode==='flat'){
    const{pixC,isoC}=_processed;
    const sc=Math.min(4,Math.max(1,MAX/Math.max(pixC.width,pixC.height))|0);
    addArr(); addBox('像素化',pixC,pixC.width*sc,pixC.height*sc);
    addArr(); addBox('等轴顶面',isoC,isoC.width*(sc>2?2:sc),isoC.height*(sc>2?2:sc),true);
  } else {
    const{isoC,tW,tH}=_processed;
    const sc=Math.min(3,Math.max(1,MAX/Math.max(tW,tH))|0);
    addArr(); addBox('色调处理',isoC,tW*sc,tH*sc,true);
  }
}

function _setStep(n){
  const lbs=['步骤1·上传','步骤2·参数','步骤3·处理中','步骤4·预览','步骤5·确认'];
  _safe('stepLbl',el=>el.textContent=lbs[n-1]);
  _safe('stepNum',el=>el.textContent=`${n}/5`);
  for(let i=1;i<=5;i++) _safe(`s${i}`,el=>el.className='step'+(i<n?' done':i===n?' cur':''));
}

function _safe(id,fn){const el=document.getElementById(id);if(el)fn(el);}
function _val(id){return document.getElementById(id)?.value;}
