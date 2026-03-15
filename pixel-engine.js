/**
 * pixel-engine.js  v2
 * 像素艺术处理引擎 — 国风专属升级版
 *
 * 新增：
 *  - GUOFENG_PALETTE  国风60色色板（青绿/赭石/朱红/竹绿/墨灰）
 *  - TOD_FILTERS      时间段滤镜 LUT（黎明/正午/黄昏/夜晚）
 *  - applyTOD()       将时段滤镜叠加到 canvas
 *  - pixelizeImage()  全面重写，支持 preserveAlpha 选项
 *  - isoProjectFlat() 修正反变换精度
 */

export const clamp   = v => Math.max(0, Math.min(255, Math.round(v)));
export const clamp01 = v => Math.max(0, Math.min(1, v));

// ─── 星露谷色板（保留，向下兼容）────────────────────────────────
const _SDW_HEX = [
  '#2a1a08','#3d2416','#5a3420','#f0d8a8','#d4a870','#b07840','#8a5828',
  '#1a3818','#2a5828','#3a7838','#5a9848','#80b858','#a8d870','#d0f098',
  '#604020','#7a5030','#9a6840','#b88050','#d0a870',
  '#484840','#686860','#888878','#a8a898','#c8c8b8',
  '#6a3818','#8a5028','#aa7040','#c89058',
  '#183868','#2858a8','#4888d8','#80b8f0','#b8d8f8',
  '#783020','#a84030','#d86040',
  '#f8f0d8','#fff8e8','#c89030','#e8b840','#f8d860',
  '#683888','#9858b8','#c888e8','#881820','#c82830','#f05848',
];
export const SDW_PALETTE_HEX = _SDW_HEX;
export const SDW_PALETTE = _SDW_HEX.map(h => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

// ─── 国风专用色板 ─────────────────────────────────────────────────
const _GF_HEX = [
  // 青绿系·江南水乡
  '#1a2e20','#2d4a3e','#3d6b52','#5a8f6a','#7aaf88','#a0c8a0','#c8e8c8',
  // 赭石系·夯土建筑
  '#3c1808','#5a2810','#7a4020','#a05830','#c07840','#d4a060','#e8c898',
  // 朱红系·宫廷建筑
  '#4a0808','#7a1010','#a82020','#d83030','#e85040','#f07858','#f8b090',
  // 竹绿系
  '#182010','#2a3818','#3a5020','#4e6828','#687c30','#8a9848','#b0c068',
  // 墨灰系·石材
  '#101010','#202020','#383838','#505050','#686868','#888888','#b0b0b0',
  // 靛蓝系·水墨
  '#0a1828','#102840','#184868','#206898','#3090c8','#60b8e8','#a0d8f8',
  // 金黄系·装饰
  '#402800','#684010','#986020','#c08830','#d8a848','#e8c860','#f8e898',
  // 暖褐系·木材
  '#301808','#4a2810','#6a4020','#8a5828','#a87040','#c89060','#e0b888',
  // 浅米系·纸绢
  '#d0c098','#e0d0a8','#f0e8c8','#f8f0e0',
];
export const GUOFENG_PALETTE_HEX = _GF_HEX;
export const GUOFENG_PALETTE = _GF_HEX.map(h => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
});

// ─── 时间段滤镜 ───────────────────────────────────────────────────
export const TOD_FILTERS = {
  dawn:    { r: 1.08, g: 0.90, b: 0.78, overlay: 'rgba(255,160,80,0.12)'  },
  noon:    { r: 1.00, g: 1.00, b: 1.00, overlay: null                     },
  dusk:    { r: 1.12, g: 0.85, b: 0.65, overlay: 'rgba(200,80,20,0.18)'   },
  night:   { r: 0.55, g: 0.60, b: 0.85, overlay: 'rgba(10,20,80,0.42)'    },
};

/**
 * 把时段色调叠加到 canvas 上（渲染完场景后调用）
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {'dawn'|'noon'|'dusk'|'night'} tod
 * @param {number} alpha  叠加强度 0-1
 */
export function applyTOD(ctx, canvas, tod = 'noon', alpha = 1.0) {
  if (tod === 'noon' || alpha <= 0) return;
  const f = TOD_FILTERS[tod];
  if (!f) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (f.overlay) {
    ctx.fillStyle = f.overlay;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.restore();
}

// ─── Color adjustment ─────────────────────────────────────────────
export function colorAdjust(pixels, W, H, contrast = 1.2, sat = 1.25, warm = 6) {
  const out = new Uint8ClampedArray(pixels);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] < 10) continue;
    let r = out[i] / 255, g = out[i + 1] / 255, b = out[i + 2] / 255;
    r = clamp01((r - 0.5) * contrast + 0.5);
    g = clamp01((g - 0.5) * contrast + 0.5);
    b = clamp01((b - 0.5) * contrast + 0.5);
    const mx = Math.max(r,g,b), mn = Math.min(r,g,b), l = (mx+mn)/2;
    if (mx !== mn) {
      const d = mx-mn, sl = l>0.5 ? d/(2-mx-mn) : d/(mx+mn);
      const ns = Math.min(1, sl*sat), q = l<0.5 ? l*(1+ns) : l+ns-l*ns, p = 2*l-q;
      const hv = mx===r ? (g-b)/d+(g<b?6:0) : mx===g ? (b-r)/d+2 : (r-g)/d+4;
      const hh = hv/6;
      const hf = (p,q,t) => { if(t<0)t+=1; if(t>1)t-=1; return t<1/6?p+(q-p)*6*t:t<0.5?q:t<2/3?p+(q-p)*(2/3-t)*6:p; };
      r=hf(p,q,hh+1/3); g=hf(p,q,hh); b=hf(p,q,hh-1/3);
    }
    out[i]   = clamp(r*255+warm);
    out[i+1] = clamp(g*255+warm*0.5);
    out[i+2] = clamp(b*255-warm*0.3);
  }
  return out;
}

// ─── Box-filter downsample ────────────────────────────────────────
export function downsample(pixels, W, H, pw, ph) {
  const out = new Uint8Array(pw * ph * 4);
  const sx = W/pw, sy = H/ph;
  for (let py=0; py<ph; py++) for (let px=0; px<pw; px++) {
    let rr=0,gg=0,bb=0,aa=0,n=0;
    const x0=Math.floor(px*sx), x1=Math.min(W,Math.ceil((px+1)*sx));
    const y0=Math.floor(py*sy), y1=Math.min(H,Math.ceil((py+1)*sy));
    for (let iy=y0; iy<y1; iy++) for (let ix=x0; ix<x1; ix++) {
      const i=(iy*W+ix)*4;
      rr+=pixels[i]; gg+=pixels[i+1]; bb+=pixels[i+2]; aa+=pixels[i+3]; n++;
    }
    const i=(py*pw+px)*4;
    out[i]=rr/n; out[i+1]=gg/n; out[i+2]=bb/n; out[i+3]=aa/n;
  }
  return out;
}

// ─── Median-cut palette ───────────────────────────────────────────
export function medianCut(pixels, n, maxColors) {
  const step = Math.max(1, Math.floor(n/2048));
  const samples = [];
  for (let i=0; i<n; i+=step) {
    const o=i*4; if(pixels[o+3]>10) samples.push([pixels[o],pixels[o+1],pixels[o+2]]);
  }
  if (!samples.length) return [[128,128,128]];
  function split(box, d) {
    if (!d||!box.length) {
      const a=[0,0,0]; box.forEach(c=>{a[0]+=c[0];a[1]+=c[1];a[2]+=c[2];});
      return [box.length?[a[0]/box.length|0,a[1]/box.length|0,a[2]/box.length|0]:[128,128,128]];
    }
    let mn=[255,255,255],mx=[0,0,0];
    box.forEach(c=>c.forEach((v,i)=>{mn[i]=Math.min(mn[i],v);mx[i]=Math.max(mx[i],v);}));
    const rng=mn.map((m,i)=>mx[i]-m), ch=rng.indexOf(Math.max(...rng));
    box.sort((a,b)=>a[ch]-b[ch]); const mid=box.length>>1;
    return [...split(box.slice(0,mid),d-1),...split(box.slice(mid),d-1)];
  }
  return split(samples, Math.ceil(Math.log2(maxColors)));
}

export function nearestColor(r, g, b, palette) {
  let best=palette[0], bestD=Infinity;
  for (const [pr,pg,pb] of palette) {
    const d=2*(r-pr)**2+4*(g-pg)**2+3*(b-pb)**2;
    if (d<bestD){bestD=d;best=[pr,pg,pb];}
  }
  return best;
}

// ─── Floyd-Steinberg dithering (alpha-aware) ──────────────────────
export function quantizeFS(pixels, W, H, palette) {
  const out = new Uint8Array(pixels);
  const err = new Float32Array(W*H*3);
  for (let py=0; py<H; py++) for (let px=0; px<W; px++) {
    const oi=(py*W+px)*4;
    // 透明像素直接清零，防止抖动算法把透明背景染色
    if (out[oi+3]<128) { out[oi]=out[oi+1]=out[oi+2]=0; out[oi+3]=0; continue; }
    const ei=(py*W+px)*3;
    let r=clamp(out[oi]+err[ei]), g=clamp(out[oi+1]+err[ei+1]), b=clamp(out[oi+2]+err[ei+2]);
    const [cr,cg,cb]=nearestColor(r,g,b,palette);
    out[oi]=cr; out[oi+1]=cg; out[oi+2]=cb;
    const dr=r-cr,dg=g-cg,db=b-cb;
    const sp=(ex,ey,f)=>{
      if(ex<0||ex>=W||ey<0||ey>=H) return;
      const i=(ey*W+ex)*3; err[i]+=dr*f; err[i+1]+=dg*f; err[i+2]+=db*f;
    };
    sp(px+1,py,7/16); sp(px-1,py+1,3/16); sp(px,py+1,5/16); sp(px+1,py+1,1/16);
  }
  return out;
}

// ─── Main pixelize ────────────────────────────────────────────────
/**
 * @param {HTMLImageElement|ImageBitmap} imgEl
 * @param {{
 *   tileSize?:number, pixSz?:number, grain?:number, colors?:number,
 *   contrast?:number, sat?:number, warm?:number,
 *   palMode?:'stardew'|'guofeng'|'auto',
 *   preserveAlpha?:boolean
 * }} opts
 */
export async function pixelizeImage(imgEl, {
  tileSize=32, pixSz=3, grain=1, colors=32,
  contrast=1.2, sat=1.25, warm=6,
  palMode='stardew', preserveAlpha=true,
}={}) {
  const srcW = imgEl.naturalWidth ?? imgEl.width;
  const srcH = imgEl.naturalHeight ?? imgEl.height;
  const tmp = new OffscreenCanvas(srcW, srcH);
  tmp.getContext('2d').drawImage(imgEl, 0, 0);
  let pixels = tmp.getContext('2d').getImageData(0,0,srcW,srcH).data;
  pixels = colorAdjust(pixels, srcW, srcH, contrast, sat, warm);

  const effSize = Math.max(4, Math.round(tileSize/grain));
  const pw = Math.max(4, Math.round(effSize/pixSz));
  const small = downsample(pixels, srcW, srcH, pw, pw);

  const palette = palMode==='stardew' ? SDW_PALETTE
                : palMode==='guofeng' ? GUOFENG_PALETTE
                : medianCut(small, pw*pw, colors);
  const q = quantizeFS(small, pw, pw, palette);

  const sc = new OffscreenCanvas(pw, pw);
  const scdata = new ImageData(new Uint8ClampedArray(q), pw, pw);
  if (preserveAlpha) {
    // 把原始 alpha 通道回写（量化只改RGB，不改透明度）
    for (let i=3; i<q.length; i+=4) scdata.data[i] = small[i];
  }
  sc.getContext('2d').putImageData(scdata, 0, 0);

  const out = new OffscreenCanvas(tileSize, tileSize);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(sc, 0, 0, tileSize, tileSize);
  return out;
}

// ─── Isometric top-face projection ────────────────────────────────
export function isoProjectFlat(srcC, tileSize) {
  const TW=tileSize*2, TH=tileSize;
  const out = new OffscreenCanvas(TW, TH);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  const sw=srcC.width, sh=srcC.height;
  const sd=srcC.getContext('2d').getImageData(0,0,sw,sh).data;
  const od=octx.createImageData(TW,TH);
  const d=od.data;
  for (let oy=0; oy<TH; oy++) for (let ox=0; ox<TW; ox++) {
    // 精确 2:1 等轴测反变换
    const fx = ox/TW, fy = oy/TH;
    const u = fx + fy;   // = (tx-ty+tx+ty)/(MW) ... simplified
    const v = fy - fx/2 + 0.5;
    if (u<0||u>1||v<0||v>1) continue;
    const sx=Math.floor(u*sw), sy=Math.floor(v*sh);
    const si=(sy*sw+sx)*4, di=(oy*TW+ox)*4;
    d[di]=sd[si]; d[di+1]=sd[si+1]; d[di+2]=sd[si+2];
    d[di+3]=sd[si+3]>10?255:0;
  }
  octx.putImageData(od, 0, 0);
  return out;
}

// ─── Canvas rotate helper ─────────────────────────────────────────
export function rotateCanvas(src, deg) {
  if (!deg || deg%360===0) return src;
  const sw=src.width??src.naturalWidth, sh=src.height??src.naturalHeight;
  const is90 = (deg===90||deg===270);
  const outW=is90?sh:sw, outH=is90?sw:sh;
  const c=new OffscreenCanvas(outW,outH);
  const ctx=c.getContext('2d');
  ctx.translate(outW/2, outH/2);
  ctx.rotate(deg*Math.PI/180);
  ctx.drawImage(src, -sw/2, -sh/2);
  return c;
}

// ─── Horizontal flip ─────────────────────────────────────────────
export function flipCanvas(src) {
  const sw=src.width, sh=src.height;
  const c=new OffscreenCanvas(sw,sh);
  const ctx=c.getContext('2d');
  ctx.scale(-1,1); ctx.drawImage(src,-sw,0);
  return c;
}
