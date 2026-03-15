/**
 * tile-defs.js
 * Tile 定义注册表 + 所有程序绘制函数
 *
 * 每个 tile 定义:
 *   id       string   唯一键
 *   name     string   显示名
 *   layer    0-3      0=地面 1=物件 2=建筑 3=障碍
 *   cat      string   面板分类标签
 *   solid    bool     是否阻挡角色
 *   height   number   伪3D挤出高度系数 (0=平面, 1-10)
 *   spanW    number   横向占格数
 *   spanH    number   纵向占格数
 *   seam     bool     是否需要消除拼缝扩展 (仅地面tile)
 *   isWater  bool     需要按 waterFrame 动画
 *   draw(ctx, sz)     程序绘制到正方形 ctx
 *
 * 自定义导入 tile 额外字段:
 *   isCustom  bool
 *   isIsoTile bool    true=已是等轴素材，直接贴图; false=正方形，需投影
 *   _squareC  Canvas  (isIsoTile=false 时) 像素化后的正方形源图
 *   _isoC     Canvas  (isIsoTile=true  时) 已处理的等轴菱形图
 *   isoW,isoH number  _isoC 的实际像素宽高
 */

// ─── pseudo-random (seeded, deterministic) ────────────────────────
const _pr = s => { const x = Math.sin(s + 1) * 43758.5453; return x - Math.floor(x); };
export const prng = (x, y, s = 0) => _pr(x * 127.1 + y * 311.7 + s * 7919.3);

// ─── Ground tile draw functions ───────────────────────────────────

export function drawGrass(ctx, sz, variant = 0) {
  const bases = ['#527a30', '#5e8a38', '#486c28', '#6a9840'];
  ctx.fillStyle = bases[variant % 4]; ctx.fillRect(0, 0, sz, sz);
  for (let i = 0; i < (sz * sz / 7) | 0; i++) {
    const x = prng(i, variant, 0) * sz | 0, y = prng(i, variant, 1) * sz | 0;
    ctx.fillStyle = prng(i, variant, 2) > 0.5 ? '#3a5e20' : '#78a848';
    ctx.fillRect(x, y, 1, 1 + (prng(i, variant, 3) > 0.7 ? 1 : 0));
  }
}

export function drawDirt(ctx, sz, variant = 0) {
  const bases = ['#8a6030', '#7a5028', '#9a7040', '#6a4820'];
  ctx.fillStyle = bases[variant % 4]; ctx.fillRect(0, 0, sz, sz);
  for (let i = 0; i < (sz * sz / 9) | 0; i++) {
    const x = prng(i, variant + 10, 0) * sz | 0, y = prng(i, variant + 10, 1) * sz | 0;
    ctx.fillStyle = prng(i, variant, 5) > 0.5 ? '#6a4820' : '#a87040';
    ctx.fillRect(x, y, 1, 1);
  }
}

export function drawPath(ctx, sz) {
  ctx.fillStyle = '#b09060'; ctx.fillRect(0, 0, sz, sz);
  ctx.fillStyle = '#907040';
  for (let i = 0; i < sz; i += 5) ctx.fillRect(0, i, sz, 1);
  for (let i = 0; i < sz; i += 6) ctx.fillRect(i, 0, 1, sz);
}

export function drawStone(ctx, sz) {
  ctx.fillStyle = '#787068'; ctx.fillRect(0, 0, sz, sz);
  ctx.fillStyle = '#686058';
  const step = (sz / 4) | 0;
  for (let r = 0; r < sz; r += step) ctx.fillRect(0, r, sz, 1);
  for (let c = 0; c < sz; c += step) ctx.fillRect(c, 0, 1, sz);
  ctx.fillStyle = '#989080';
  ctx.fillRect(1, 1, sz - 2, 1); ctx.fillRect(1, 1, 1, sz - 2);
}

export function drawSand(ctx, sz) {
  ctx.fillStyle = '#c8a860'; ctx.fillRect(0, 0, sz, sz);
  for (let i = 0; i < (sz * sz / 8) | 0; i++) {
    ctx.fillStyle = prng(i, 30) > 0.5 ? '#b89850' : '#d8b870';
    ctx.fillRect(prng(i, 31) * sz | 0, prng(i, 32) * sz | 0, 1, 1);
  }
}

export function drawSnow(ctx, sz) {
  ctx.fillStyle = '#d8ecf8'; ctx.fillRect(0, 0, sz, sz);
  for (let i = 0; i < (sz * sz / 10) | 0; i++) {
    ctx.fillStyle = prng(i, 40) > 0.5 ? '#e8f4ff' : '#c0d8ec';
    ctx.fillRect(prng(i, 41) * sz | 0, prng(i, 42) * sz | 0, 1, 1);
  }
}

// water is animated — caller passes `frame`
export function drawWater(ctx, sz, frame = 0) {
  ctx.fillStyle = '#2060a8'; ctx.fillRect(0, 0, sz, sz);
  for (let r = 0; r < sz; r += 3) {
    for (let c = 0; c < sz; c += 3) {
      const v = (c + r + frame * 2) % 8;
      ctx.fillStyle = v < 4 ? '#3080c8' : '#1850a0';
      ctx.fillRect(c, r, 2, 1);
    }
  }
  ctx.fillStyle = '#80b8f0';
  ctx.fillRect(2, 2, 2, 1); ctx.fillRect(sz - 5, sz - 4, 2, 1);
}

// ─── Object tile draw functions ───────────────────────────────────
// 这些 tile 绘制在透明背景上，渲染时以「底边中心」对齐菱形下顶点

export function drawTree(ctx, sz) {
  const hw = sz >> 1;
  // trunk
  ctx.fillStyle = '#9a6028'; ctx.fillRect(hw - 2, sz * 0.55, 4, sz * 0.45);
  ctx.fillStyle = '#7a4818'; ctx.fillRect(hw - 1, sz * 0.55, 1, sz * 0.45);
  // canopy
  ctx.fillStyle = '#3a6818';
  ctx.fillRect(hw - sz * .42, sz * .08, sz * .84, sz * .5);
  ctx.fillRect(hw - sz * .3,  sz * .02, sz * .6,  sz * .58);
  ctx.fillStyle = '#5a9828'; ctx.fillRect(hw - sz * .2, sz * .06, sz * .28, sz * .1);
  ctx.fillStyle = '#2a5010'; ctx.fillRect(hw + sz * .1, sz * .28, sz * .22, sz * .22);
}

export function drawPine(ctx, sz) {
  const hw = sz >> 1;
  ctx.fillStyle = '#8a5020'; ctx.fillRect(hw - 1, sz * .75, 3, sz * .25);
  [['#1e4010', .55, .22, 2, .2], ['#2a5818', .38, .2, 3, .19], ['#386828', .22, .19, 4, .19], ['#4a7830', .07, .18, 5, .18]]
    .forEach(([col, top, h, spread, _]) => { ctx.fillStyle = col; ctx.fillRect(hw - spread, sz * top, spread * 2 + 1, sz * h); });
}

export function drawBush(ctx, sz) {
  ctx.fillStyle = '#3a6018';
  ctx.fillRect(1,       sz * .5, sz - 2, sz * .48);
  ctx.fillRect(3,       sz * .38, sz - 6, sz * .14);
  ctx.fillRect(0,       sz * .55, sz, sz * .38);
  ctx.fillStyle = '#5a8830'; ctx.fillRect(2, sz * .52, 3, 3);
  ctx.fillStyle = '#c02020';
  ctx.fillRect(4, sz * .55, 1, 1); ctx.fillRect(sz - 5, sz * .6, 1, 1);
}

export function drawFlowers(ctx, sz) {
  drawGrass(ctx, sz, 1);
  const cols = ['#e84060', '#f8a020', '#9058e8', '#40b8f0'];
  for (let i = 0; i < 4; i++) {
    const fx = 3 + i * 4, fy = 4 + i * 3;
    ctx.fillStyle = cols[i];
    ctx.fillRect(fx, fy - 1, 1, 1); ctx.fillRect(fx - 1, fy, 1, 1);
    ctx.fillRect(fx + 1, fy, 1, 1); ctx.fillRect(fx, fy + 1, 1, 1);
    ctx.fillStyle = '#f8f040'; ctx.fillRect(fx, fy, 1, 1);
    ctx.fillStyle = '#3a5e20'; ctx.fillRect(fx, fy + 2, 1, 2);
  }
}

export function drawWheat(ctx, sz) {
  drawDirt(ctx, sz, 0);
  for (let i = 0; i < 4; i++) {
    const wx = 2 + i * (sz / 4 | 0);
    ctx.fillStyle = '#9a7020'; ctx.fillRect(wx, sz * .55, 1, sz * .45);
    ctx.fillStyle = '#d8a030'; ctx.fillRect(wx - 1, sz * .25, 3, sz * .32);
    ctx.fillStyle = '#f0c040'; ctx.fillRect(wx - 1, sz * .15, 1, sz * .12); ctx.fillRect(wx, sz * .1, 1, 3);
  }
}

export function drawChest(ctx, sz) {
  ctx.fillStyle = '#9a6028'; ctx.fillRect(1, sz * .38, sz - 2, sz * .58);
  ctx.fillStyle = '#b87838'; ctx.fillRect(1, sz * .38, sz - 2, sz * .12);
  ctx.fillStyle = '#d4a020'; ctx.fillRect(sz / 2 - 2, sz * .5, 4, 4);
  ctx.fillStyle = '#f0c040'; ctx.fillRect(sz / 2 - 1, sz * .52, 2, 2);
  ctx.fillStyle = '#201408'; ctx.fillRect(1, sz * .37, sz - 2, 1);
}

export function drawSign(ctx, sz) {
  const hw = sz >> 1;
  ctx.fillStyle = '#9a6028'; ctx.fillRect(hw - 1, sz * .38, 2, sz * .62);
  ctx.fillStyle = '#b87838'; ctx.fillRect(1, sz * .18, sz - 2, sz * .22);
  ctx.fillStyle = '#e8d888';
  ctx.fillRect(3, sz * .24, 3, 1); ctx.fillRect(7, sz * .24, 4, 1); ctx.fillRect(12, sz * .24, 2, 1);
  ctx.fillRect(3, sz * .3, 5, 1); ctx.fillRect(10, sz * .3, 4, 1);
  ctx.fillStyle = '#201408'; ctx.fillRect(1, sz * .17, sz - 2, 1);
}

export function drawFence(ctx, sz) {
  ctx.fillStyle = '#9a6028';
  ctx.fillRect(0, sz * .22, sz, 2); ctx.fillRect(0, sz * .62, sz, 2);
  ctx.fillRect(1, sz * .08, 3, sz * .84); ctx.fillRect(sz - 4, sz * .08, 3, sz * .84);
  ctx.fillStyle = '#7a4818';
  ctx.fillRect(2, sz * .08, 1, sz * .84); ctx.fillRect(sz - 3, sz * .08, 1, sz * .84);
}

export function drawRock(ctx, sz) {
  ctx.fillStyle = '#787068';
  ctx.fillRect(2, sz * .3, sz - 4, sz * .65); ctx.fillRect(sz * .1, sz * .22, sz * .8, sz * .7);
  ctx.fillStyle = '#989080'; ctx.fillRect(sz * .12, sz * .24, sz * .2, sz * .12);
  ctx.fillStyle = '#585048'; ctx.fillRect(sz * .6, sz * .5, sz * .25, sz * .25);
}

export function drawHouse(ctx, sz) {
  // wall
  ctx.fillStyle = '#c0a870'; ctx.fillRect(0, sz * .45, sz, sz * .55);
  ctx.fillStyle = '#a89058';
  for (let i = 0; i < 4; i++) ctx.fillRect(0, sz * .45 + i * 4, sz, 1);
  // roof
  for (let i = 0; i < sz / 2; i++) {
    ctx.fillStyle = i < sz / 4 ? '#7a2018' : '#9a3020';
    ctx.fillRect(i, Math.round(sz * .45 - i * .5), sz - i * 2, 1);
  }
  ctx.fillStyle = '#5a1810'; ctx.fillRect(sz / 2 - 1, 0, 2, sz * .45);
  // windows
  ctx.fillStyle = '#90c0f0'; ctx.fillRect(2, sz * .54, 3, 3); ctx.fillRect(sz - 5, sz * .54, 3, 3);
  // door
  ctx.fillStyle = '#7a4018'; ctx.fillRect(sz / 2 - 2, sz * .7, 5, sz * .3);
  ctx.fillStyle = '#201408'; ctx.fillRect(0, sz * .44, sz, 1);
}

// ─── Tile registry ────────────────────────────────────────────────
/**
 * TILES: { [id]: TileDef }
 *
 * layer: 0=地面  1=物件  2=建筑  3=障碍
 * seam:  true = 地面tile，渲染时扩1px消缝。物件/建筑/障碍设 false。
 */
export const TILES = {
  // ── Ground ──────────────────────────────────────────────────────
  grass:  { name:'草地', layer:0, cat:'地面', solid:false, height:0, spanW:1, spanH:1, seam:true,  draw:(c,s)=>drawGrass(c,s,0) },
  grass2: { name:'深草', layer:0, cat:'地面', solid:false, height:0, spanW:1, spanH:1, seam:true,  draw:(c,s)=>drawGrass(c,s,1) },
  dirt:   { name:'泥土', layer:0, cat:'地面', solid:false, height:0, spanW:1, spanH:1, seam:true,  draw:(c,s)=>drawDirt(c,s,0) },
  path:   { name:'小路', layer:0, cat:'地面', solid:false, height:0, spanW:1, spanH:1, seam:true,  draw:(c,s)=>drawPath(c,s) },
  stone:  { name:'石板', layer:0, cat:'地面', solid:false, height:0, spanW:1, spanH:1, seam:true,  draw:(c,s)=>drawStone(c,s) },
  sand:   { name:'沙地', layer:0, cat:'地面', solid:false, height:0, spanW:1, spanH:1, seam:true,  draw:(c,s)=>drawSand(c,s) },
  snow:   { name:'雪地', layer:0, cat:'地面', solid:false, height:0, spanW:1, spanH:1, seam:true,  draw:(c,s)=>drawSnow(c,s) },
  water:  { name:'水面', layer:0, cat:'地面', solid:true,  height:0, spanW:1, spanH:1, seam:true,  isWater:true, draw:(c,s,f)=>drawWater(c,s,f) },

  // ── Objects (layer 1) ────────────────────────────────────────────
  flower: { name:'花丛', layer:1, cat:'植物', solid:false, height:0, spanW:1, spanH:1, seam:false, draw:(c,s)=>drawFlowers(c,s) },
  bush:   { name:'灌木', layer:1, cat:'植物', solid:false, height:4, spanW:1, spanH:1, seam:false, draw:(c,s)=>drawBush(c,s) },
  wheat:  { name:'麦田', layer:1, cat:'植物', solid:false, height:3, spanW:1, spanH:1, seam:false, draw:(c,s)=>drawWheat(c,s) },
  chest:  { name:'箱子', layer:1, cat:'物件', solid:true,  height:5, spanW:1, spanH:1, seam:false, draw:(c,s)=>drawChest(c,s) },
  sign:   { name:'木牌', layer:1, cat:'物件', solid:true,  height:3, spanW:1, spanH:1, seam:false, draw:(c,s)=>drawSign(c,s) },

  // ── Buildings (layer 2) ──────────────────────────────────────────
  tree:   { name:'橡树', layer:2, cat:'植物', solid:true,  height:8,  spanW:1, spanH:1, seam:false, draw:(c,s)=>drawTree(c,s) },
  pine:   { name:'松树', layer:2, cat:'植物', solid:true,  height:8,  spanW:1, spanH:1, seam:false, draw:(c,s)=>drawPine(c,s) },
  house:  { name:'小屋', layer:2, cat:'建筑', solid:true,  height:10, spanW:2, spanH:2, seam:false, draw:(c,s)=>drawHouse(c,s) },

  // ── Obstacles (layer 3) ──────────────────────────────────────────
  rock:   { name:'岩石', layer:3, cat:'障碍', solid:true,  height:4, spanW:1, spanH:1, seam:false, draw:(c,s)=>drawRock(c,s) },
  fence:  { name:'篱笆', layer:3, cat:'障碍', solid:true,  height:3, spanW:1, spanH:1, seam:false, draw:(c,s)=>drawFence(c,s) },
};

// ─── Registry API ─────────────────────────────────────────────────
export function registerTile(id, def)  { TILES[id] = def; }
export function unregisterTile(id)     { delete TILES[id]; }

export function getTile(id)            { return TILES[id] ?? null; }

export function getTilesByLayer(layer) {
  return Object.entries(TILES).filter(([, t]) => t.layer === layer);
}

export function getCategoriesByLayer(layer) {
  const cats = [...new Set(Object.values(TILES).filter(t => t.layer === layer).map(t => t.cat))];
  return [...cats.filter(c => c !== '导入'), ...(cats.includes('导入') ? ['导入'] : [])];
}
