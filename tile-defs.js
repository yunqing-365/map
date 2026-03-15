/**
 * tile-defs.js  v2
 * 国风像素 Tile 定义注册表
 *
 * 升级：
 *  - 7图层系统（地面/地表细节/水体/物件低/建筑/物件高/障碍）
 *  - 国风专用内置素材（石板路、竹林、水榭、屋顶装饰等）
 *  - 地形分组(terrainGroup)支持自动拼接预留
 *  - tile 完整元数据（walkable/friction/tags/biome）
 *  - animFrames 支持：tile 可声明多帧
 */

const _p = s => { const x=Math.sin(s+1)*43758.5453; return x-Math.floor(x); };
export const prng = (x,y,s=0) => _p(x*127.1+y*311.7+s*7919.3);

// ─── 图层常量（7层）────────────────────────────────────────────────
export const LAYERS = {
  GROUND:       0,  // 地面基底（草地/石板/泥土）
  GROUND_DETAIL:1,  // 地表细节（落叶/花纹/痕迹）
  WATER:        2,  // 水体（单独层，做流水效果）
  OBJ_LOW:      3,  // 低矮物件（矮墙/石头/地面花卉）
  BUILDING:     4,  // 建筑主体（房屋/亭台）
  OBJ_HIGH:     5,  // 高层物件（树冠/旗帜/屋脊）
  OBSTACLE:     6,  // 碰撞障碍（不可见碰撞体）
};

export const LAYER_NAMES  = ['地面','地表细节','水体','物件低','建筑','物件高','障碍'];
export const LAYER_COLORS = ['#5a8838','#78a848','#2060a8','#6888a8','#a87848','#508870','#c85858'];
export const LAYER_COUNT  = 7;

// ─── 地面 tile 绘制 ───────────────────────────────────────────────

export function drawGrass(ctx, sz, v=0) {
  const bases=['#527a30','#5e8a38','#486c28','#6a9840'];
  ctx.fillStyle=bases[v%4]; ctx.fillRect(0,0,sz,sz);
  for(let i=0;i<(sz*sz/7)|0;i++){
    const x=prng(i,v,0)*sz|0, y=prng(i,v,1)*sz|0;
    ctx.fillStyle=prng(i,v,2)>.5?'#3a5e20':'#78a848';
    ctx.fillRect(x,y,1,1+(prng(i,v,3)>.7?1:0));
  }
}

export function drawDirt(ctx, sz, v=0) {
  const bases=['#8a6030','#7a5028','#9a7040','#6a4820'];
  ctx.fillStyle=bases[v%4]; ctx.fillRect(0,0,sz,sz);
  for(let i=0;i<(sz*sz/9)|0;i++){
    const x=prng(i,v+10,0)*sz|0, y=prng(i,v+10,1)*sz|0;
    ctx.fillStyle=prng(i,v,5)>.5?'#6a4820':'#a87040';
    ctx.fillRect(x,y,1,1);
  }
}

export function drawStone(ctx, sz) {
  ctx.fillStyle='#787068'; ctx.fillRect(0,0,sz,sz);
  ctx.fillStyle='#686058';
  const s2=(sz/4)|0;
  for(let r=0;r<sz;r+=s2) ctx.fillRect(0,r,sz,1);
  for(let c=0;c<sz;c+=s2) ctx.fillRect(c,0,1,sz);
  ctx.fillStyle='#989080'; ctx.fillRect(1,1,sz-2,1); ctx.fillRect(1,1,1,sz-2);
}

export function drawPath(ctx, sz) {
  ctx.fillStyle='#b09060'; ctx.fillRect(0,0,sz,sz);
  ctx.fillStyle='#907040';
  for(let i=0;i<sz;i+=5) ctx.fillRect(0,i,sz,1);
  for(let i=0;i<sz;i+=6) ctx.fillRect(i,0,1,sz);
}

export function drawSand(ctx, sz) {
  ctx.fillStyle='#c8a860'; ctx.fillRect(0,0,sz,sz);
  for(let i=0;i<(sz*sz/8)|0;i++){
    ctx.fillStyle=prng(i,30)>.5?'#b89850':'#d8b870';
    ctx.fillRect(prng(i,31)*sz|0,prng(i,32)*sz|0,1,1);
  }
}

export function drawSnow(ctx, sz) {
  ctx.fillStyle='#d8ecf8'; ctx.fillRect(0,0,sz,sz);
  for(let i=0;i<(sz*sz/10)|0;i++){
    ctx.fillStyle=prng(i,40)>.5?'#e8f4ff':'#c0d8ec';
    ctx.fillRect(prng(i,41)*sz|0,prng(i,42)*sz|0,1,1);
  }
}

// 国风专属地面 tiles
export function drawPebble(ctx, sz) {
  ctx.fillStyle='#807868'; ctx.fillRect(0,0,sz,sz);
  for(let i=0;i<12;i++){
    const x=prng(i,70)*sz|0, y=prng(i,71)*sz|0;
    const r=Math.max(2, prng(i,72)*sz*0.18|0);
    ctx.fillStyle=prng(i,73)>.5?'#989080':'#686058';
    ctx.fillRect(x-r/2|0,y-r/2|0,r,r);
    ctx.fillStyle='rgba(255,255,255,0.15)'; ctx.fillRect(x-r/2|0,y-r/2|0,1,1);
  }
}

export function drawMudFloor(ctx, sz) {
  // 湿润泥地，带浅水坑光泽
  ctx.fillStyle='#4a3420'; ctx.fillRect(0,0,sz,sz);
  for(let i=0;i<(sz*sz/10)|0;i++){
    ctx.fillStyle=prng(i,80)>.6?'#3a2818':'#5a4030';
    ctx.fillRect(prng(i,81)*sz|0,prng(i,82)*sz|0,1,1);
  }
  // 小水坑光泽
  ctx.fillStyle='rgba(40,80,120,0.3)';
  ctx.fillRect(sz*0.2|0,sz*0.6|0,sz*0.25|0,sz*0.12|0);
}

export function drawBambooBed(ctx, sz) {
  // 竹地面
  ctx.fillStyle='#687c30'; ctx.fillRect(0,0,sz,sz);
  const sw=(sz/6)|0;
  for(let i=0;i<6;i++){
    ctx.fillStyle=i%2===0?'#788c38':'#587028';
    ctx.fillRect(i*sw,0,sw,sz);
    ctx.fillStyle='rgba(0,0,0,0.15)'; ctx.fillRect(i*sw,0,1,sz);
  }
}

// 水面（动画）
export function drawWater(ctx, sz, frame=0) {
  ctx.fillStyle='#1848a0'; ctx.fillRect(0,0,sz,sz);
  for(let r=0;r<sz;r+=3) for(let c=0;c<sz;c+=3){
    const v=(c+r+frame*2)%8;
    ctx.fillStyle=v<4?'#2868c0':'#103880';
    ctx.fillRect(c,r,2,1);
  }
  // 水面高光
  ctx.fillStyle='rgba(160,200,255,0.35)';
  const hx=(frame*3)%sz;
  ctx.fillRect(hx,sz*0.3|0,sz*0.15|0,1);
  ctx.fillRect((hx+sz*0.5)%sz,sz*0.7|0,sz*0.1|0,1);
}

// ─── 物件 tile 绘制 ───────────────────────────────────────────────

export function drawTree(ctx, sz) {
  const hw=sz>>1;
  ctx.fillStyle='#9a6028'; ctx.fillRect(hw-2,sz*.55,4,sz*.45);
  ctx.fillStyle='#7a4818'; ctx.fillRect(hw-1,sz*.55,1,sz*.45);
  ctx.fillStyle='#3a6818'; ctx.fillRect(hw-sz*.42,sz*.08,sz*.84,sz*.5); ctx.fillRect(hw-sz*.3,sz*.02,sz*.6,sz*.58);
  ctx.fillStyle='#5a9828'; ctx.fillRect(hw-sz*.2,sz*.06,sz*.28,sz*.1);
  ctx.fillStyle='#2a5010'; ctx.fillRect(hw+sz*.1,sz*.28,sz*.22,sz*.22);
}

export function drawPine(ctx, sz) {
  const hw=sz>>1;
  ctx.fillStyle='#8a5020'; ctx.fillRect(hw-1,sz*.75,3,sz*.25);
  [['#1e4010',.55,.22,2],['#2a5818',.38,.2,3],['#386828',.22,.19,4],['#4a7830',.07,.18,5]]
    .forEach(([col,top,h,sp])=>{ ctx.fillStyle=col; ctx.fillRect(hw-sp,sz*top,sp*2+1,sz*h); });
}

// 国风竹子（竖立在格子上）
export function drawBamboo(ctx, sz) {
  const hw=sz>>1;
  // 竹节
  const nodeCols=['#485810','#586820','#688030'];
  for(let i=0;i<4;i++){
    const y=sz*(0.8-i*0.22);
    ctx.fillStyle=nodeCols[i%3]; ctx.fillRect(hw-3,y,6,sz*0.2);
    ctx.fillStyle='rgba(0,0,0,0.25)'; ctx.fillRect(hw-3,y+sz*0.2-1,6,1);
  }
  // 叶片
  ctx.fillStyle='#5a8820';
  ctx.fillRect(hw-sz*.2,sz*.04,sz*.3,sz*.08); ctx.fillRect(hw+sz*.05,sz*.12,sz*.25,sz*.08);
  ctx.fillRect(hw-sz*.3,sz*.2,sz*.25,sz*.07);
  ctx.fillStyle='#78a030';
  ctx.fillRect(hw-sz*.18,sz*.05,sz*.15,sz*.04);
}

// 国风梅树
export function drawPlumTree(ctx, sz) {
  const hw=sz>>1;
  // 干
  ctx.fillStyle='#5a3818'; ctx.fillRect(hw-2,sz*.3,4,sz*.7);
  ctx.fillStyle='#3a2010'; ctx.fillRect(hw-1,sz*.3,1,sz*.7);
  // 枝
  ctx.fillStyle='#6a4020';
  ctx.fillRect(hw-sz*.25,sz*.25,sz*.25,2); ctx.fillRect(hw,sz*.15,sz*.2,2);
  ctx.fillRect(hw-sz*.15,sz*.35,sz*.15,2);
  // 花朵（朱红）
  for(let i=0;i<8;i++){
    const bx=hw-sz*.3+prng(i,90)*sz*.6|0, by=sz*.05+prng(i,91)*sz*.45|0;
    ctx.fillStyle='#d83050'; ctx.fillRect(bx,by,3,3);
    ctx.fillStyle='#f06080'; ctx.fillRect(bx,by,1,1);
  }
}

// 国风廊柱
export function drawPillar(ctx, sz) {
  const hw=sz>>1;
  ctx.fillStyle='#c84020'; ctx.fillRect(hw-sz*.15,sz*.1,sz*.3,sz*.85);
  ctx.fillStyle='#a03018'; ctx.fillRect(hw-sz*.15,sz*.1,sz*.05,sz*.85);
  ctx.fillStyle='#e05030'; ctx.fillRect(hw+sz*.08,sz*.1,sz*.05,sz*.85);
  // 顶部斗拱
  ctx.fillStyle='#8a3018'; ctx.fillRect(hw-sz*.2,sz*.1,sz*.4,sz*.06);
  ctx.fillStyle='#602010'; ctx.fillRect(hw-sz*.25,sz*.05,sz*.5,sz*.06);
}

// 国风石灯笼
export function drawLantern(ctx, sz) {
  const hw=sz>>1;
  ctx.fillStyle='#888070'; ctx.fillRect(hw-2,sz*.75,4,sz*.25);
  ctx.fillStyle='#606050'; ctx.fillRect(hw-sz*.18,sz*.38,sz*.36,sz*.38);
  ctx.fillStyle='rgba(255,180,30,0.9)'; ctx.fillRect(hw-sz*.12,sz*.42,sz*.24,sz*.28);
  ctx.fillStyle='#505040'; ctx.fillRect(hw-sz*.2,sz*.36,sz*.4,sz*.05); ctx.fillRect(hw-sz*.2,sz*.74,sz*.4,sz*.05);
  ctx.fillStyle='#808070'; ctx.fillRect(hw-sz*.12,sz*.28,sz*.24,sz*.1);
}

export function drawBush(ctx, sz) {
  ctx.fillStyle='#3a6018'; ctx.fillRect(1,sz*.5,sz-2,sz*.48); ctx.fillRect(3,sz*.38,sz-6,sz*.14); ctx.fillRect(0,sz*.55,sz,sz*.38);
  ctx.fillStyle='#5a8830'; ctx.fillRect(2,sz*.52,3,3);
  ctx.fillStyle='#c02020'; ctx.fillRect(4,sz*.55,1,1); ctx.fillRect(sz-5,sz*.6,1,1);
}

export function drawFlowers(ctx, sz) {
  drawGrass(ctx, sz, 1);
  const cols=['#e84060','#f8a020','#9058e8','#40b8f0'];
  for(let i=0;i<4;i++){
    const fx=3+i*4, fy=4+i*3;
    ctx.fillStyle=cols[i];
    ctx.fillRect(fx,fy-1,1,1); ctx.fillRect(fx-1,fy,1,1); ctx.fillRect(fx+1,fy,1,1); ctx.fillRect(fx,fy+1,1,1);
    ctx.fillStyle='#f8f040'; ctx.fillRect(fx,fy,1,1);
    ctx.fillStyle='#3a5e20'; ctx.fillRect(fx,fy+2,1,2);
  }
}

export function drawRock(ctx, sz) {
  ctx.fillStyle='#787068'; ctx.fillRect(2,sz*.3,sz-4,sz*.65); ctx.fillRect(sz*.1,sz*.22,sz*.8,sz*.7);
  ctx.fillStyle='#989080'; ctx.fillRect(sz*.12,sz*.24,sz*.2,sz*.12);
  ctx.fillStyle='#585048'; ctx.fillRect(sz*.6,sz*.5,sz*.25,sz*.25);
}

export function drawFence(ctx, sz) {
  ctx.fillStyle='#9a6028'; ctx.fillRect(0,sz*.22,sz,2); ctx.fillRect(0,sz*.62,sz,2);
  ctx.fillRect(1,sz*.08,3,sz*.84); ctx.fillRect(sz-4,sz*.08,3,sz*.84);
  ctx.fillStyle='#7a4818'; ctx.fillRect(2,sz*.08,1,sz*.84); ctx.fillRect(sz-3,sz*.08,1,sz*.84);
}

export function drawHouse(ctx, sz) {
  ctx.fillStyle='#c0a870'; ctx.fillRect(0,sz*.45,sz,sz*.55);
  ctx.fillStyle='#a89058'; for(let i=0;i<4;i++) ctx.fillRect(0,sz*.45+i*4,sz,1);
  for(let i=0;i<sz/2;i++){
    ctx.fillStyle=i<sz/4?'#7a2018':'#9a3020';
    ctx.fillRect(i,Math.round(sz*.45-i*.5),sz-i*2,1);
  }
  ctx.fillStyle='#5a1810'; ctx.fillRect(sz/2-1,0,2,sz*.45);
  ctx.fillStyle='#90c0f0'; ctx.fillRect(2,sz*.54,3,3); ctx.fillRect(sz-5,sz*.54,3,3);
  ctx.fillStyle='#7a4018'; ctx.fillRect(sz/2-2,sz*.7,5,sz*.3);
  ctx.fillStyle='#201408'; ctx.fillRect(0,sz*.44,sz,1);
}

export function drawChest(ctx, sz) {
  ctx.fillStyle='#9a6028'; ctx.fillRect(1,sz*.38,sz-2,sz*.58);
  ctx.fillStyle='#b87838'; ctx.fillRect(1,sz*.38,sz-2,sz*.12);
  ctx.fillStyle='#d4a020'; ctx.fillRect(sz/2-2,sz*.5,4,4);
  ctx.fillStyle='#f0c040'; ctx.fillRect(sz/2-1,sz*.52,2,2);
  ctx.fillStyle='#201408'; ctx.fillRect(1,sz*.37,sz-2,1);
}

export function drawSign(ctx, sz) {
  const hw=sz>>1;
  ctx.fillStyle='#9a6028'; ctx.fillRect(hw-1,sz*.38,2,sz*.62);
  ctx.fillStyle='#b87838'; ctx.fillRect(1,sz*.18,sz-2,sz*.22);
  ctx.fillStyle='#e8d888'; ctx.fillRect(3,sz*.24,3,1); ctx.fillRect(7,sz*.24,4,1); ctx.fillRect(12,sz*.24,2,1);
  ctx.fillRect(3,sz*.3,5,1); ctx.fillRect(10,sz*.3,4,1);
  ctx.fillStyle='#201408'; ctx.fillRect(1,sz*.17,sz-2,1);
}

export function drawWheat(ctx, sz) {
  drawDirt(ctx,sz,0);
  for(let i=0;i<4;i++){
    const wx=2+i*(sz/4|0);
    ctx.fillStyle='#9a7020'; ctx.fillRect(wx,sz*.55,1,sz*.45);
    ctx.fillStyle='#d8a030'; ctx.fillRect(wx-1,sz*.25,3,sz*.32);
    ctx.fillStyle='#f0c040'; ctx.fillRect(wx-1,sz*.15,1,sz*.12); ctx.fillRect(wx,sz*.1,1,3);
  }
}

// ─── TILE 注册表（7层）────────────────────────────────────────────
/**
 * 每个 tile 定义:
 *   layer:        LAYERS.XXX  (0-6)
 *   cat:          面板分类
 *   solid:        碰撞
 *   height:       伪3D系数 0-10
 *   spanW/spanH:  占格
 *   seam:         地面消缝
 *   isWater:      水体动画
 *   terrainGroup: 自动拼接组标识（预留）
 *   tags:         ['road','stone',...] 导出用
 *   draw(ctx,sz)
 */
export const TILES = {
  // ── 图层0 地面 ──────────────────────────────────────────────────
  grass:     { name:'草地',  layer:0, cat:'地面', solid:false, height:0, spanW:1,spanH:1, seam:true,  terrainGroup:'grass', tags:['ground'], draw:(c,s)=>drawGrass(c,s,0) },
  grass2:    { name:'深草',  layer:0, cat:'地面', solid:false, height:0, spanW:1,spanH:1, seam:true,  terrainGroup:'grass', tags:['ground'], draw:(c,s)=>drawGrass(c,s,1) },
  dirt:      { name:'泥土',  layer:0, cat:'地面', solid:false, height:0, spanW:1,spanH:1, seam:true,  terrainGroup:'dirt',  tags:['ground'], draw:(c,s)=>drawDirt(c,s,0) },
  path:      { name:'小路',  layer:0, cat:'地面', solid:false, height:0, spanW:1,spanH:1, seam:true,  terrainGroup:'path',  tags:['road'],   draw:(c,s)=>drawPath(c,s) },
  stone:     { name:'石板',  layer:0, cat:'地面', solid:false, height:0, spanW:1,spanH:1, seam:true,  terrainGroup:'stone', tags:['road'],   draw:(c,s)=>drawStone(c,s) },
  sand:      { name:'沙地',  layer:0, cat:'地面', solid:false, height:0, spanW:1,spanH:1, seam:true,  terrainGroup:'sand',  tags:['ground'], draw:(c,s)=>drawSand(c,s) },
  snow:      { name:'雪地',  layer:0, cat:'地面', solid:false, height:0, spanW:1,spanH:1, seam:true,  terrainGroup:'snow',  tags:['ground'], draw:(c,s)=>drawSnow(c,s) },
  pebble:    { name:'碎石',  layer:0, cat:'国风', solid:false, height:0, spanW:1,spanH:1, seam:true,  terrainGroup:'stone', tags:['road'],   draw:(c,s)=>drawPebble(c,s) },
  mud:       { name:'湿泥',  layer:0, cat:'国风', solid:false, height:0, spanW:1,spanH:1, seam:true,  terrainGroup:'dirt',  tags:['ground'], draw:(c,s)=>drawMudFloor(c,s) },
  bamboo_bed:{ name:'竹地',  layer:0, cat:'国风', solid:false, height:0, spanW:1,spanH:1, seam:true,  terrainGroup:'bamboo',tags:['floor'],  draw:(c,s)=>drawBambooBed(c,s) },

  // ── 图层1 地表细节 ───────────────────────────────────────────────
  flower:    { name:'花丛',  layer:1, cat:'植物', solid:false, height:0, spanW:1,spanH:1, seam:false, tags:['decor'],  draw:(c,s)=>drawFlowers(c,s) },
  wheat:     { name:'麦田',  layer:1, cat:'植物', solid:false, height:3, spanW:1,spanH:1, seam:false, tags:['farm'],   draw:(c,s)=>drawWheat(c,s) },

  // ── 图层2 水体 ───────────────────────────────────────────────────
  water:     { name:'水面',  layer:2, cat:'水体', solid:true,  height:0, spanW:1,spanH:1, seam:true,  isWater:true, terrainGroup:'water', tags:['water'], draw:(c,s,f)=>drawWater(c,s,f) },

  // ── 图层3 物件低 ─────────────────────────────────────────────────
  bush:      { name:'灌木',  layer:3, cat:'植物', solid:false, height:4, spanW:1,spanH:1, seam:false, tags:['plant'],  draw:(c,s)=>drawBush(c,s) },
  rock:      { name:'岩石',  layer:3, cat:'障碍', solid:true,  height:4, spanW:1,spanH:1, seam:false, tags:['stone'],  draw:(c,s)=>drawRock(c,s) },
  fence:     { name:'篱笆',  layer:3, cat:'障碍', solid:true,  height:3, spanW:1,spanH:1, seam:false, tags:['fence'],  draw:(c,s)=>drawFence(c,s) },
  chest:     { name:'箱子',  layer:3, cat:'物件', solid:true,  height:5, spanW:1,spanH:1, seam:false, tags:['object'], draw:(c,s)=>drawChest(c,s) },
  sign:      { name:'木牌',  layer:3, cat:'物件', solid:true,  height:3, spanW:1,spanH:1, seam:false, tags:['object'], draw:(c,s)=>drawSign(c,s) },
  lantern:   { name:'石灯',  layer:3, cat:'国风', solid:true,  height:5, spanW:1,spanH:1, seam:false, tags:['decor'],  draw:(c,s)=>drawLantern(c,s) },
  pillar:    { name:'廊柱',  layer:3, cat:'国风', solid:true,  height:8, spanW:1,spanH:1, seam:false, tags:['building'],draw:(c,s)=>drawPillar(c,s) },

  // ── 图层4 建筑 ───────────────────────────────────────────────────
  house:     { name:'小屋',  layer:4, cat:'建筑', solid:true,  height:10,spanW:2,spanH:2, seam:false, tags:['building'],draw:(c,s)=>drawHouse(c,s) },

  // ── 图层5 物件高 ─────────────────────────────────────────────────
  tree:      { name:'橡树',  layer:5, cat:'植物', solid:true,  height:8, spanW:1,spanH:1, seam:false, tags:['plant'],  draw:(c,s)=>drawTree(c,s) },
  pine:      { name:'松树',  layer:5, cat:'植物', solid:true,  height:8, spanW:1,spanH:1, seam:false, tags:['plant'],  draw:(c,s)=>drawPine(c,s) },
  bamboo:    { name:'竹子',  layer:5, cat:'国风', solid:true,  height:9, spanW:1,spanH:1, seam:false, tags:['plant'],  draw:(c,s)=>drawBamboo(c,s) },
  plum_tree: { name:'梅树',  layer:5, cat:'国风', solid:true,  height:8, spanW:1,spanH:1, seam:false, tags:['plant'],  draw:(c,s)=>drawPlumTree(c,s) },

  // ── 图层6 障碍 ───────────────────────────────────────────────────
  // 纯碰撞体，不渲染，供事件/寻路系统读取
  // （isInvisible:true 时渲染器跳过）
};

// ─── Registry API ─────────────────────────────────────────────────
export function registerTile(id, def)  { TILES[id]=def; }
export function unregisterTile(id)     { delete TILES[id]; }
export function getTile(id)            { return TILES[id]??null; }

export function getTilesByLayer(layer) {
  return Object.entries(TILES).filter(([,t])=>t.layer===layer);
}

export function getCategoriesByLayer(layer) {
  const cats=[...new Set(Object.values(TILES).filter(t=>t.layer===layer).map(t=>t.cat))];
  return [...cats.filter(c=>c!=='导入'),...(cats.includes('导入')?['导入']:[])];
}

// 导出用：生成 Tiled 兼容的 tileset 元数据
export function exportTilesetMeta() {
  return Object.entries(TILES).map(([id,t])=>({
    id, name:t.name, layer:t.layer,
    walkable:!t.solid, tags:t.tags??[],
    terrainGroup:t.terrainGroup??null,
  }));
}
