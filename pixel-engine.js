/**
 * pixel-engine.js
 * 像素艺术处理引擎 — 纯算法，无 DOM 依赖，可 Node/Worker 复用
 *
 * exports:
 *   SDW_PALETTE, SDW_PALETTE_HEX
 *   colorAdjust(pixels,W,H,contrast,sat,warm) → Uint8ClampedArray
 *   downsample(pixels,W,H,pw,ph)              → Uint8Array
 *   medianCut(pixels,n,maxColors)             → [[r,g,b],…]
 *   nearestColor(r,g,b,palette)               → [r,g,b]
 *   quantizeFS(pixels,W,H,palette)            → Uint8Array
 *   pixelizeImage(imgEl, opts)                → Promise<OffscreenCanvas>
 *   isoProjectFlat(srcC, tileSize)            → OffscreenCanvas  (正方形→等轴顶面)
 */

// ─── helpers ─────────────────────────────────────────────────────
export const clamp   = v => Math.max(0, Math.min(255, Math.round(v)));
export const clamp01 = v => Math.max(0, Math.min(1, v));

// ─── Stardew Valley standard palette ─────────────────────────────
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

// ─── Color adjustment ─────────────────────────────────────────────
export function colorAdjust(pixels, W, H, contrast = 1.2, sat = 1.25, warm = 6) {
  const out = new Uint8ClampedArray(pixels);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] < 10) continue;
    let r = out[i] / 255, g = out[i + 1] / 255, b = out[i + 2] / 255;
    r = clamp01((r - 0.5) * contrast + 0.5);
    g = clamp01((g - 0.5) * contrast + 0.5);
    b = clamp01((b - 0.5) * contrast + 0.5);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn, sl = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      const ns = Math.min(1, sl * sat), q = l < 0.5 ? l * (1 + ns) : l + ns - l * ns, p = 2 * l - q;
      const hv = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      const hh = hv / 6;
      const hf = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1/6 ? p + (q-p)*6*t : t < 0.5 ? q : t < 2/3 ? p + (q-p)*(2/3-t)*6 : p; };
      r = hf(p, q, hh + 1/3); g = hf(p, q, hh); b = hf(p, q, hh - 1/3);
    }
    out[i]     = clamp(r * 255 + warm);
    out[i + 1] = clamp(g * 255 + warm * 0.5);
    out[i + 2] = clamp(b * 255 - warm * 0.3);
  }
  return out;
}

// ─── Box-filter downsample ────────────────────────────────────────
export function downsample(pixels, W, H, pw, ph) {
  const out = new Uint8Array(pw * ph * 4);
  const sx = W / pw, sy = H / ph;
  for (let py = 0; py < ph; py++) {
    for (let px = 0; px < pw; px++) {
      let rr = 0, gg = 0, bb = 0, aa = 0, n = 0;
      const x0 = Math.floor(px * sx), x1 = Math.min(W, Math.ceil((px + 1) * sx));
      const y0 = Math.floor(py * sy), y1 = Math.min(H, Math.ceil((py + 1) * sy));
      for (let iy = y0; iy < y1; iy++) for (let ix = x0; ix < x1; ix++) {
        const i = (iy * W + ix) * 4;
        rr += pixels[i]; gg += pixels[i+1]; bb += pixels[i+2]; aa += pixels[i+3]; n++;
      }
      const i = (py * pw + px) * 4;
      out[i] = rr/n; out[i+1] = gg/n; out[i+2] = bb/n; out[i+3] = aa/n;
    }
  }
  return out;
}

// ─── Median-cut palette ───────────────────────────────────────────
export function medianCut(pixels, n, maxColors) {
  const step = Math.max(1, Math.floor(n / 2048));
  const samples = [];
  for (let i = 0; i < n; i += step) {
    const o = i * 4; if (pixels[o + 3] > 10) samples.push([pixels[o], pixels[o+1], pixels[o+2]]);
  }
  if (!samples.length) return [[128, 128, 128]];
  function split(box, d) {
    if (!d || !box.length) {
      const a = [0, 0, 0]; box.forEach(c => { a[0]+=c[0]; a[1]+=c[1]; a[2]+=c[2]; });
      return [box.length ? [a[0]/box.length|0, a[1]/box.length|0, a[2]/box.length|0] : [128,128,128]];
    }
    let mn = [255,255,255], mx = [0,0,0];
    box.forEach(c => c.forEach((v, i) => { mn[i] = Math.min(mn[i], v); mx[i] = Math.max(mx[i], v); }));
    const rng = mn.map((m, i) => mx[i] - m), ch = rng.indexOf(Math.max(...rng));
    box.sort((a, b) => a[ch] - b[ch]);
    const mid = box.length >> 1;
    return [...split(box.slice(0, mid), d - 1), ...split(box.slice(mid), d - 1)];
  }
  return split(samples, Math.ceil(Math.log2(maxColors)));
}

// ─── Nearest palette color (perceptual weights) ───────────────────
export function nearestColor(r, g, b, palette) {
  let best = palette[0], bestD = Infinity;
  for (const [pr, pg, pb] of palette) {
    const d = 2*(r-pr)**2 + 4*(g-pg)**2 + 3*(b-pb)**2;
    if (d < bestD) { bestD = d; best = [pr, pg, pb]; }
  }
  return best;
}

// ─── Floyd-Steinberg dithering ────────────────────────────────────
export function quantizeFS(pixels, W, H, palette) {
  const out = new Uint8Array(pixels);
  const err = new Float32Array(W * H * 3);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const oi = (py * W + px) * 4;
      // 【修复】：强制剔除透明像素，防止透明背景被算法染成黑色
      if (out[oi + 3] < 128) {
        out[oi] = 0; out[oi+1] = 0; out[oi+2] = 0; out[oi+3] = 0;
        continue;
      }
      const ei = (py * W + px) * 3;
      let r = clamp(out[oi] + err[ei]), g = clamp(out[oi+1] + err[ei+1]), b = clamp(out[oi+2] + err[ei+2]);
      const [cr, cg, cb] = nearestColor(r, g, b, palette);
      out[oi] = cr; out[oi+1] = cg; out[oi+2] = cb;
      const dr = r-cr, dg = g-cg, db = b-cb;
      const sp = (ex, ey, f) => {
        if (ex < 0 || ex >= W || ey < 0 || ey >= H) return;
        const i = (ey * W + ex) * 3;
        err[i] += dr*f; err[i+1] += dg*f; err[i+2] += db*f;
      };
      sp(px+1, py,   7/16); sp(px-1, py+1, 3/16);
      sp(px,   py+1, 5/16); sp(px+1, py+1, 1/16);
    }
  }
  return out;
}

// ─── Main pixelize function ───────────────────────────────────────
/**
 * @param {HTMLImageElement|ImageBitmap} imgEl
 * @param {{
 *   tileSize?:   number,   输出正方形边长 (= TSZ)
 *   pixSz?:      number,   像素块大小 (1-8)
 *   grain?:      number,   颗粒度放大 (1-6)
 *   colors?:     number,   色板颜色数
 *   contrast?:   number,
 *   sat?:        number,
 *   warm?:       number,
 *   palMode?:    'stardew'|'auto'
 * }} opts
 * @returns {Promise<OffscreenCanvas>}  tileSize × tileSize 的像素化图
 */
export async function pixelizeImage(imgEl, {
  tileSize = 32, pixSz = 3, grain = 1, colors = 32,
  contrast = 1.2, sat = 1.25, warm = 6, palMode = 'stardew',
} = {}) {
  const srcW = imgEl.naturalWidth ?? imgEl.width;
  const srcH = imgEl.naturalHeight ?? imgEl.height;

  const tmp = new OffscreenCanvas(srcW, srcH);
  tmp.getContext('2d').drawImage(imgEl, 0, 0);
  let pixels = tmp.getContext('2d').getImageData(0, 0, srcW, srcH).data;

  pixels = colorAdjust(pixels, srcW, srcH, contrast, sat, warm);

  // grain 控制最终方块粒度：先降到 (tileSize/grain) / pixSz 分辨率
  const effSize = Math.max(4, Math.round(tileSize / grain));
  const pw = Math.max(4, Math.round(effSize / pixSz));
  const ph = pw; // 强制正方形
  const small = downsample(pixels, srcW, srcH, pw, ph);

  const palette = palMode === 'stardew' ? SDW_PALETTE : medianCut(small, pw * ph, colors);
  const q = quantizeFS(small, pw, ph, palette);

  const sc = new OffscreenCanvas(pw, ph);
  sc.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(q), pw, ph), 0, 0);

  const out = new OffscreenCanvas(tileSize, tileSize);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(sc, 0, 0, tileSize, tileSize);
  return out;
}

// ─── Isometric top-face projection (square → diamond) ────────────
/**
 * 把正方形 srcC 做等轴测菱形顶面投影
 * 输出尺寸: tileSize*2 宽, tileSize 高  (2:1 比例)
 * 仅用于「正方形格子贴图」的地面 tile，不用于物件/建筑
 */
export function isoProjectFlat(srcC, tileSize) {
  const TW = tileSize * 2, TH = tileSize;
  const out = new OffscreenCanvas(TW, TH);
  const octx = out.getContext('2d');
  octx.imageSmoothingEnabled = false;
  const sw = srcC.width, sh = srcC.height;
  const sd = srcC.getContext('2d').getImageData(0, 0, sw, sh).data;
  const od = octx.createImageData(TW, TH);
  const d = od.data;

  for (let oy = 0; oy < TH; oy++) {
    for (let ox = 0; ox < TW; ox++) {
      // reverse-map screen (ox,oy) → source (u,v) ∈ [0,1]²
      const u = (ox / TW + oy / TH) / 2 * 2;      // simplified 2:1 inverse
      const v = (oy / TH - ox / TW) / 2 * 2 + 0.5;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      const sx = Math.floor(u * sw), sy = Math.floor(v * sh);
      const si = (sy * sw + sx) * 4;
      const di = (oy * TW + ox) * 4;
      d[di] = sd[si]; d[di+1] = sd[si+1]; d[di+2] = sd[si+2];
      d[di+3] = sd[si+3] > 10 ? 255 : 0;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}
