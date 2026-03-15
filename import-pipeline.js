/**
 * import-pipeline.js  v4
 * 素材导入管线
 *
 * v4 新增：
 *  ★ _detectAnchorOffsetY：自动扫描图片 alpha 通道，找到真实地面线位置
 *  ★ _autoDetectSpan：根据图片像素宽度估算推荐 spanW×spanH
 *  ★ autoDetectSpan()：导出函数供 HTML 按钮调用
 *  ★ anchorOffsetY 存储到 tile def，修复建筑偏移 bug
 */

import { pixelizeImage, isoProjectFlat, rotateCanvas, flipCanvas,
         colorAdjust, downsample, medianCut, quantizeFS,
         SDW_PALETTE, GUOFENG_PALETTE } from './pixel-engine.js';
import { registerTile, LAYERS } from './tile-defs.js';
import { clearTileCache, RS } from './iso-renderer.js';

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
  _schedule();
}

// ─── 自动识别功能 ─────────────────────────────────────────────────
/**
 * 检测图片中地面线的归一化 Y 位置
 * 从底部向上扫描，找到第一行有不透明像素的位置
 * 返回值 ∈ [0.5, 1.0]，越靠近 1.0 表示地面越接近图片底部
 */
function _detectAnchorOffsetY(offscreen) {
  const w=offscreen.width, h=offscreen.height;
  if (!w||!h) return 1.0;
  const data=offscreen.getContext('2d').getImageData(0,0,w,h).data;
  // 从底部向上扫描每一行
  for (let y=h-1; y>=0; y--) {
    for (let x=0; x<w; x++) {
      if (data[(y*w+x)*4+3] > 15) {
        // 找到底部最低不透明像素行 y
        // anchorOffsetY = (y+1)/h → 让这一行对准 footprint D 点
        const raw = (y+2) / h; // +2 留一点余量
        return Math.min(1.0, Math.max(0.5, raw));
      }
    }
  }
  return 1.0;
}

/**
 * 从图片宽度估算推荐 span 数
 * 等轴 2:1 中，N×N footprint 的宽度 ≈ N * 2 * TSZ（近似）
 */
function _autoDetectSpan(offscreen, TSZ) {
  const w=offscreen.width, h=offscreen.height;
  if (!w||!h||!TSZ) return 1;
  const data=offscreen.getContext('2d').getImageData(0,0,w,h).data;
  // 找横向边界框
  let minX=w, maxX=0;
  for (let y=0; y<h; y++) for (let x=0; x<w; x++) {
    if (data[(y*w+x)*4+3]>15) { minX=Math.min(minX,x); maxX=Math.max(maxX,x); }
  }
  if (maxX<=minX) return 1;
  const bboxW=maxX-minX+1;
  // 一个 N×N span 的等轴菱形宽 ≈ N * 2 * TSZ
  const spanEst = Math.max(1, Math.round(bboxW / (TSZ * 2)));
  return Math.min(6, spanEst); // 最大 6 格
}

/** 供 HTML 按钮调用：智能识别占位 + 自动更新 span picker */
export function autoDetectSpan() {
  if (!_processed?.isoC) { alert('请先上传图片并等待预览生成'); return; }
  const TSZ = RS.TSZ;
  const span = _autoDetectSpan(_processed.isoC, TSZ);
  _updateSpan(span, span, span, span);
  const aoy = _detectAnchorOffsetY(_processed.isoC);
  _safe('detectedInfo', el => el.textContent = `识别: ${span}×${span} 格 · 地面线 ${Math.round(aoy*100)}%`);
}

// ─── 滑条绑定 ─────────────────────────────────────────────────────
function _bindSliders(){
  const defs={
    mGrain:   ['mGrainV',  v=>v+'px'],
    mPixSz:   ['mPixSzV',  v=>v+'px'],
    mIsoSc:   ['mIsoScV',  v=>v+'%'],
    mColors:  ['mColorsV', v=>v+'色'],
    mContrast:['mContrastV',v=>(v/100).toFixed(2)],
    mSat:     ['mSatV',    v=>(v/100).toFixed(2)],
    mWarm:    ['mWarmV',   v=>(v>=0?'+':'')+v],
    mHeight:  ['mHeightV', v=>v],
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
  document.querySelectorAll('.rot-btn').forEach(btn=>{
    btn.addEventListener('click',()=>setRotation(+btn.dataset.rot, btn));
  });
  _safe('flipBtn',el=>el.addEventListener('click',()=>toggleFlip()));
}

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
function _schedule(){ clearTimeout(_debounce); _debounce=setTimeout(_run,200); }

async function _run(){
  if (!_img) return;
  _setStep(3);
  const grain    = +(_val('mGrain')??1);
  const colors   = +(_val('mColors')??32);
  const contrast = +(_val('mContrast')??120)/100;
  const sat      = +(_val('mSat')??125)/100;
  const warm     = +(_val('mWarm')??5);
  const TSZ      = RS.TSZ;
  const palette  = _palMode==='stardew' ? SDW_PALETTE : _palMode==='guofeng' ? GUOFENG_PALETTE : null;

  if (_fmt==='iso'){
    const scaleRatio=+(_val('mIsoSc')??100)/100;
    const srcW=_img.naturalWidth, srcH=_img.naturalHeight;
    const spanMax=Math.max(_spanW,_spanH);
    const tW=Math.round(TSZ*2*spanMax*scaleRatio);
    const tH=Math.round(srcH/srcW*tW);

    const tmp=new OffscreenCanvas(srcW,srcH);
    tmp.getContext('2d').drawImage(_img,0,0);
    let px=tmp.getContext('2d').getImageData(0,0,srcW,srcH).data;
    px=colorAdjust(px,srcW,srcH,contrast,sat,warm);

    let sc;
    if (palette){
      const pw=Math.max(4,Math.round(tW/Math.max(1,grain)));
      const ph=Math.max(4,Math.round(tH/Math.max(1,grain)));
      const sm=downsample(px,srcW,srcH,pw,ph);
      const q=quantizeFS(sm,pw,ph,palette);
      sc=new OffscreenCanvas(pw,ph);
      const qd=sc.getContext('2d').createImageData(pw,ph);
      for(let i=0;i<q.length;i+=4){
        qd.data[i]=q[i]; qd.data[i+1]=q[i+1]; qd.data[i+2]=q[i+2]; qd.data[i+3]=sm[i+3];
      }
      sc.getContext('2d').putImageData(qd,0,0);
    } else {
      sc=new OffscreenCanvas(srcW,srcH);
      sc.getContext('2d').putImageData(new ImageData(px,srcW,srcH),0,0);
    }

    let isoC=new OffscreenCanvas(tW,tH);
    const ictx=isoC.getContext('2d'); ictx.imageSmoothingEnabled=false;
    ictx.clearRect(0,0,tW,tH);
    ictx.drawImage(sc,0,0,tW,tH);
    if (_rotation) isoC=rotateCanvas(isoC,_rotation);
    if (_flipH)    isoC=flipCanvas(isoC);

    // ★ 自动检测地面线
    const anchorOffsetY = _detectAnchorOffsetY(isoC);
    // ★ 自动识别建议 span
    const suggestedSpan = _autoDetectSpan(isoC, TSZ);

    _processed={mode:'iso', isoC, tW:isoC.width, tH:isoC.height,
                origTSZ:TSZ, isoScale:scaleRatio,
                anchorOffsetY, suggestedSpan};

    // 显示检测结果
    _safe('detectedInfo', el =>
      el.textContent=`地面线: ${Math.round(anchorOffsetY*100)}% · 建议 ${suggestedSpan}×${suggestedSpan} 格`);

    _setStep(4); _renderPreview();

  } else {
    const pixSz=+(_val('mPixSz')??3);
    const pixC=await pixelizeImage(_img,{tileSize:TSZ,pixSz,grain,colors,contrast,sat,warm,palMode:_palMode,preserveAlpha:true});
    let isoC=isoProjectFlat(pixC,TSZ);
    if (_rotation) isoC=rotateCanvas(isoC,_rotation);
    if (_flipH)    isoC=flipCanvas(isoC);
    _processed={mode:'flat', pixC, isoC, tW:isoC.width, tH:isoC.height,
                origTSZ:TSZ, isoScale:1.0, anchorOffsetY:1.0, suggestedSpan:1};
    _safe('detectedInfo', el => el.textContent='平面贴图 → 等轴投影');
    _setStep(4); _renderPreview();
  }
  _safe('confBtn',el=>el.disabled=false);
}

// ─── 确认导入 ─────────────────────────────────────────────────────
export function confirmImport(){
  if (!_processed) return;
  const name     = document.getElementById('mName')?.value.trim()||`素材${++_customCount}`;
  const id       = 'custom_'+Date.now();
  const walkable = document.getElementById('mWalkable')?.checked??true;
  const heightV  = +(_val('mHeight')??0);
  const layerMap = {ground:LAYERS.GROUND,object:LAYERS.OBJ_LOW,building:LAYERS.BUILDING,obstacle:LAYERS.OBSTACLE};
  const layer    = layerMap[_type]??LAYERS.GROUND;

  if (_processed.mode==='iso'){
    const{isoC,tW,tH,origTSZ,isoScale,anchorOffsetY}=_processed;
    const storeC=document.createElement('canvas');
    storeC.width=tW; storeC.height=tH;
    const sctx=storeC.getContext('2d');
    sctx.clearRect(0,0,tW,tH); sctx.drawImage(isoC,0,0);

    registerTile(id,{
      name, layer, cat:'导入', solid:!walkable, height:heightV,
      spanW:_spanW, spanH:_spanH,
      isCustom:true, isIsoTile:true,
      _isoC:storeC, isoW:tW, isoH:tH,
      origTSZ: origTSZ??RS.TSZ,
      isoScale: isoScale??1.0,
      // ★ 保存地面线位置，渲染器用它修正偏移
      anchorOffsetY: anchorOffsetY??1.0,
      flipH: false,
      seam: false,
      tags: ['custom'],
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
      name, layer, cat:'导入', solid:!walkable, height:heightV,
      spanW:_spanW, spanH:_spanH,
      isCustom:true, isIsoTile:false,
      _squareC:sqC,
      origTSZ: origTSZ??RS.TSZ,
      isoScale: 1.0,
      anchorOffsetY: 1.0,
      flipH: false,
      seam: layer===LAYERS.GROUND,
      tags: ['custom'],
      draw:(c,s)=>{c.imageSmoothingEnabled=false;c.drawImage(sqC,0,0,s,s);},
    });
  }
  clearTileCache();
  closeImport();
  _onAdded?.(id, layer);
}

// ─── 预览渲染 ─────────────────────────────────────────────────────
function _renderPreview(){
  const prev=document.getElementById('mprev'); if(!prev) return;
  prev.innerHTML='';
  const addBox=(label,src,w,h,hi=false,note='')=>{
    const box=document.createElement('div'); box.className='pbox';
    const lbl=document.createElement('div'); lbl.className='plbl'+(hi?' hi':'');
    lbl.textContent=label+(note?' · '+note:'');
    const cv=document.createElement('canvas');
    cv.width=src.width??src.naturalWidth; cv.height=src.height??src.naturalHeight;
    cv.style.cssText=`width:${w}px;height:${h}px;image-rendering:pixelated;border:1px solid var(--bdr2);border-radius:3px;background:repeating-conic-gradient(#18181e 0% 25%,#111118 0% 50%) 0 0/6px 6px`;
    cv.getContext('2d').drawImage(src,0,0);
    // 在预览上画地面线
    if (hi && _processed?.anchorOffsetY) {
      const ctx2 = cv.getContext('2d');
      const gy = (cv.height * _processed.anchorOffsetY)|0;
      ctx2.strokeStyle='rgba(60,220,120,0.8)'; ctx2.lineWidth=1; ctx2.setLineDash([3,2]);
      ctx2.beginPath(); ctx2.moveTo(0,gy); ctx2.lineTo(cv.width,gy); ctx2.stroke();
      ctx2.setLineDash([]);
    }
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
    const{isoC,tW,tH,isoScale,anchorOffsetY}=_processed;
    const sc=Math.min(3,Math.max(1,MAX/Math.max(tW,tH))|0);
    const note=`缩放${Math.round(isoScale*100)}% · 地面${Math.round(anchorOffsetY*100)}%`;
    addArr(); addBox('处理结果',isoC,tW*sc,tH*sc,true,note);
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
