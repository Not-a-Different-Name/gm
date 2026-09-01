import * as THREE from 'three';

const TILE_SIZE = 16;
export const TEXTURE_VARIANT_COUNT = 4;
const TEXTURE_IDS = [
  'grass-top',
  'grass-side',
  'dirt',
  'stone',
  'sand',
  'water',
  'wood-top',
  'wood-side',
  'leaves',
  'bedrock'
] as const;
type TextureId = (typeof TEXTURE_IDS)[number];

// 纹理包含完整底色，网格顶点色只负责朝向明暗，不再重复乘方块颜色。
const BASE_COLORS: Readonly<Record<TextureId, string>> = {
  'grass-top': '#557348',
  'grass-side': '#745344',
  dirt: '#765546',
  stone: '#7d7f7f',
  sand: '#cdbb86',
  water: '#326bb1',
  'wood-top': '#8d6942',
  'wood-side': '#68492f',
  leaves: '#31513a',
  bedrock: '#3f4444'
};

// 草的顶部覆盖色，供草方块侧面的草檐复用。
const GRASS_CAP = '#55774b';

export interface TextureRegion {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

// FNV-1a：把纹理标识散列成 RNG 种子，保证每格纹理在每次运行时都一致。
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// mulberry32：轻量确定性伪随机数，取值 [0, 1)。
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export class TextureAtlas {
  public readonly texture: THREE.CanvasTexture;
  // 图集源画布：copyTile 从中按像素区抠出单个方块图标（热键栏、掉落物用）。
  private readonly canvas: HTMLCanvasElement;
  private readonly regions = new Map<string, TextureRegion>();

  public constructor() {
    this.canvas = document.createElement('canvas');
    const tileCount = TEXTURE_IDS.length * TEXTURE_VARIANT_COUNT;
    this.canvas.width = TILE_SIZE * tileCount;
    this.canvas.height = TILE_SIZE;
    const context = this.canvas.getContext('2d');
    if (context === null) throw new Error('无法创建像素纹理画布');
    TEXTURE_IDS.forEach((id, textureIndex) => {
      for (let variant = 0; variant < TEXTURE_VARIANT_COUNT; variant += 1) {
        const tileIndex = textureIndex * TEXTURE_VARIANT_COUNT + variant;
        this.drawTile(context, id, tileIndex * TILE_SIZE, variant);
        this.regions.set(`${id}:${variant}`, {
          u0: tileIndex / tileCount,
          v0: 0,
          u1: (tileIndex + 1) / tileCount,
          v1: 1
        });
      }
    });
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  public getRegion(id: string, variant = 0): TextureRegion {
    const normalizedVariant =
      ((variant % TEXTURE_VARIANT_COUNT) + TEXTURE_VARIANT_COUNT) % TEXTURE_VARIANT_COUNT;
    return this.regions.get(`${id}:${normalizedVariant}`) ?? this.regions.get('stone:0')!;
  }

  /** 把某个方块纹理抠成独立画布（整数倍放大、关闭平滑），供热键栏图标与掉落物贴图使用。 */
  public copyTile(id: string, variant = 0, scale = 2): HTMLCanvasElement {
    const region = this.getRegion(id, variant);
    const sourceX = Math.round(region.u0 * this.canvas.width);
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE * scale;
    canvas.height = TILE_SIZE * scale;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('无法创建方块图标画布');
    context.imageSmoothingEnabled = false;
    context.drawImage(
      this.canvas,
      sourceX,
      0,
      TILE_SIZE,
      TILE_SIZE,
      0,
      0,
      canvas.width,
      canvas.height
    );
    return canvas;
  }

  // ---- 绘制基元 --------------------------------------------------------

  // 在基础色上偏移明度（可选色相/饱和度），得到同族的深浅变体。
  private tone(base: THREE.Color, deltaL: number, deltaH = 0, deltaS = 0): THREE.Color {
    return base.clone().offsetHSL(deltaH, deltaS, deltaL);
  }

  private paint(
    context: CanvasRenderingContext2D,
    offsetX: number,
    x: number,
    y: number,
    color: THREE.Color
  ): void {
    if (x < 0 || x >= TILE_SIZE || y < 0 || y >= TILE_SIZE) return;
    context.fillStyle = `#${color.getHexString()}`;
    context.fillRect(offsetX + Math.floor(x), Math.floor(y), 1, 1);
  }

  // 逐格铺满对称的明度噪声，形成不规则但均值居中的底面。
  private fillNoise(
    context: CanvasRenderingContext2D,
    offsetX: number,
    random: () => number,
    base: THREE.Color,
    amplitude: number,
    hueJitter = 0
  ): void {
    for (let y = 0; y < TILE_SIZE; y += 1) {
      for (let x = 0; x < TILE_SIZE; x += 1) {
        const roll = random();
        let deltaL = 0;
        if (roll < 0.12) deltaL = amplitude;
        else if (roll < 0.24) deltaL = -amplitude;
        else if (roll < 0.44) deltaL = amplitude * 0.5;
        else if (roll < 0.64) deltaL = -amplitude * 0.5;
        const deltaH = hueJitter === 0 ? 0 : (random() - 0.5) * hueJitter;
        this.paint(context, offsetX, x, y, this.tone(base, deltaL, deltaH));
      }
    }
  }

  // 撒若干单像素杂点（矿粒、砂砾、草尖等）。
  private scatter(
    context: CanvasRenderingContext2D,
    offsetX: number,
    random: () => number,
    base: THREE.Color,
    count: number,
    deltaL: number,
    deltaH = 0
  ): void {
    for (let index = 0; index < count; index += 1) {
      const x = Math.floor(random() * TILE_SIZE);
      const y = Math.floor(random() * TILE_SIZE);
      this.paint(context, offsetX, x, y, this.tone(base, deltaL, deltaH));
    }
  }

  // ---- 逐方块纹理 ------------------------------------------------------

  private drawTile(
    context: CanvasRenderingContext2D,
    id: TextureId,
    offsetX: number,
    variant: number
  ): void {
    context.clearRect(offsetX, 0, TILE_SIZE, TILE_SIZE);
    const random = mulberry32(hashString(`${id}:${variant}`));
    const base = new THREE.Color(BASE_COLORS[id]);
    switch (id) {
      case 'grass-top':
        this.drawGrassTop(context, offsetX, random, base);
        break;
      case 'grass-side':
        this.drawGrassSide(context, offsetX, random, base);
        break;
      case 'dirt':
        this.drawDirt(context, offsetX, random, base);
        break;
      case 'stone':
        this.drawStone(context, offsetX, random, base);
        break;
      case 'sand':
        this.drawSand(context, offsetX, random, base);
        break;
      case 'water':
        this.drawWater(context, offsetX, random, base);
        break;
      case 'wood-top':
        this.drawWoodTop(context, offsetX, random, base);
        break;
      case 'wood-side':
        this.drawWoodSide(context, offsetX, random, base);
        break;
      case 'leaves':
        this.drawLeaves(context, offsetX, random, base);
        break;
      case 'bedrock':
        this.drawBedrock(context, offsetX, random, base);
        break;
    }
  }

  private drawGrassTop(
    context: CanvasRenderingContext2D,
    offsetX: number,
    random: () => number,
    base: THREE.Color
  ): void {
    this.fillNoise(context, offsetX, random, base, 0.028, 0.012);
    for (let clump = 0; clump < 3; clump += 1) {
      const cx = Math.floor(random() * (TILE_SIZE - 1));
      const cy = Math.floor(random() * (TILE_SIZE - 1));
      const shade = this.tone(base, random() < 0.5 ? -0.045 : 0.04);
      this.paint(context, offsetX, cx, cy, shade);
      this.paint(context, offsetX, cx + 1, cy, shade);
      if (random() < 0.5) this.paint(context, offsetX, cx, cy + 1, shade);
    }
  }

  private drawGrassSide(
    context: CanvasRenderingContext2D,
    offsetX: number,
    random: () => number,
    base: THREE.Color
  ): void {
    // 侧面主体是泥土。
    this.fillNoise(context, offsetX, random, base, 0.055);
    this.scatter(context, offsetX, random, base, 5, -0.07);
    this.scatter(context, offsetX, random, base, 3, 0.055);
    // 顶部草檐：高度不齐并向下滴几缕，形成经典草地悬垂。
    const grass = new THREE.Color(GRASS_CAP);
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const capHeight = 3 + Math.floor(random() * 3);
      for (let y = 0; y < capHeight; y += 1) {
        this.paint(context, offsetX, x, y, this.tone(grass, (random() - 0.5) * 0.07));
      }
      if (random() < 0.4) {
        const dripHeight = capHeight + 1 + Math.floor(random() * 2);
        for (let y = capHeight; y < dripHeight; y += 1) {
          this.paint(context, offsetX, x, y, this.tone(grass, -0.035));
        }
      }
    }
  }

  private drawDirt(
    context: CanvasRenderingContext2D,
    offsetX: number,
    random: () => number,
    base: THREE.Color
  ): void {
    this.fillNoise(context, offsetX, random, base, 0.065);
    // 小石砾：偶尔两像素成团。
    for (let index = 0; index < 6; index += 1) {
      const x = Math.floor(random() * TILE_SIZE);
      const y = Math.floor(random() * TILE_SIZE);
      const pebble = this.tone(base, -0.085, 0, -0.01);
      this.paint(context, offsetX, x, y, pebble);
      if (random() < 0.4) this.paint(context, offsetX, x + 1, y, pebble);
    }
    this.scatter(context, offsetX, random, base, 4, 0.06);
  }

  private drawStone(
    context: CanvasRenderingContext2D,
    offsetX: number,
    random: () => number,
    base: THREE.Color
  ): void {
    this.fillNoise(context, offsetX, random, base, 0.024);
    for (let cluster = 0; cluster < 3; cluster += 1) {
      const x = Math.floor(random() * (TILE_SIZE - 1));
      const y = Math.floor(random() * TILE_SIZE);
      const detail = this.tone(base, random() < 0.5 ? -0.04 : 0.038);
      this.paint(context, offsetX, x, y, detail);
      this.paint(context, offsetX, x + 1, y, detail);
    }
  }

  private drawSand(
    context: CanvasRenderingContext2D,
    offsetX: number,
    random: () => number,
    base: THREE.Color
  ): void {
    this.fillNoise(context, offsetX, random, base, 0.05);
    this.scatter(context, offsetX, random, base, 16, 0.06);
    this.scatter(context, offsetX, random, base, 12, -0.06);
    // 两道极淡的横向沙纹。
    for (let ripple = 0; ripple < 2; ripple += 1) {
      const y = 4 + ripple * 6 + Math.floor(random() * 2);
      for (let x = 0; x < TILE_SIZE; x += 1) {
        if (random() < 0.7) this.paint(context, offsetX, x, y, this.tone(base, -0.05));
      }
    }
  }

  private drawWater(
    context: CanvasRenderingContext2D,
    offsetX: number,
    random: () => number,
    base: THREE.Color
  ): void {
    // 错位的横向波纹，模拟水面层次。
    for (let y = 0; y < TILE_SIZE; y += 1) {
      for (let x = 0; x < TILE_SIZE; x += 1) {
        const band = (Math.floor(y / 2) + Math.floor(x / 6)) % 2;
        this.paint(context, offsetX, x, y, this.tone(base, band === 0 ? 0.05 : -0.05));
      }
    }
    this.scatter(context, offsetX, random, base, 6, 0.14);
  }

  private drawWoodTop(
    context: CanvasRenderingContext2D,
    offsetX: number,
    random: () => number,
    base: THREE.Color
  ): void {
    // 以切比雪夫距离画同心方环，形成端面年轮。
    const center = (TILE_SIZE - 1) / 2;
    for (let y = 0; y < TILE_SIZE; y += 1) {
      for (let x = 0; x < TILE_SIZE; x += 1) {
        const ring = Math.floor(Math.max(Math.abs(x - center), Math.abs(y - center)));
        const deltaL = (ring % 2 === 0 ? 0.05 : -0.05) + (random() - 0.5) * 0.04;
        this.paint(context, offsetX, x, y, this.tone(base, deltaL));
      }
    }
    // 中心木髓。
    const pith = this.tone(base, -0.16);
    this.paint(context, offsetX, 7, 7, pith);
    this.paint(context, offsetX, 8, 7, pith);
    this.paint(context, offsetX, 7, 8, pith);
    this.paint(context, offsetX, 8, 8, pith);
  }

  private drawWoodSide(
    context: CanvasRenderingContext2D,
    offsetX: number,
    random: () => number,
    base: THREE.Color
  ): void {
    // 每列一个基调，形成竖直树皮纹；每隔几列压一道深沟。
    const columnDeltas: number[] = [];
    for (let x = 0; x < TILE_SIZE; x += 1) {
      columnDeltas.push(x % 4 === 3 ? -0.12 : (random() - 0.5) * 0.08);
    }
    for (let y = 0; y < TILE_SIZE; y += 1) {
      for (let x = 0; x < TILE_SIZE; x += 1) {
        const deltaL = columnDeltas[x]! + (random() - 0.5) * 0.05;
        this.paint(context, offsetX, x, y, this.tone(base, deltaL));
      }
    }
    // 偶尔一个树节。
    if (random() < 0.5) {
      const knotX = 3 + Math.floor(random() * 9);
      const knotY = 4 + Math.floor(random() * 8);
      this.paint(context, offsetX, knotX, knotY, this.tone(base, -0.2));
      this.paint(context, offsetX, knotX, knotY - 1, this.tone(base, -0.08));
      this.paint(context, offsetX, knotX, knotY + 1, this.tone(base, -0.08));
      this.paint(context, offsetX, knotX - 1, knotY, this.tone(base, -0.08));
      this.paint(context, offsetX, knotX + 1, knotY, this.tone(base, -0.08));
    }
  }

  private drawLeaves(
    context: CanvasRenderingContext2D,
    offsetX: number,
    random: () => number,
    base: THREE.Color
  ): void {
    // 唯一带 alpha 镂空的纹理：透明像素会被材质的 alphaTest 剔除成孔洞。
    for (let y = 0; y < TILE_SIZE; y += 1) {
      for (let x = 0; x < TILE_SIZE; x += 1) {
        if (random() < 0.14) {
          continue; // 留作透明孔洞
        }
        const roll = random();
        let deltaL: number;
        if (roll < 0.3) deltaL = 0.1;
        else if (roll < 0.6) deltaL = -0.1;
        else if (roll < 0.8) deltaL = 0.04;
        else deltaL = -0.05;
        this.paint(context, offsetX, x, y, this.tone(base, deltaL, (random() - 0.5) * 0.04));
      }
    }
    // 几处更深的阴影叶簇，增加体积感。
    for (let cluster = 0; cluster < 4; cluster += 1) {
      const cx = 1 + Math.floor(random() * (TILE_SIZE - 2));
      const cy = 1 + Math.floor(random() * (TILE_SIZE - 2));
      const shade = this.tone(base, -0.16);
      this.paint(context, offsetX, cx, cy, shade);
      this.paint(context, offsetX, cx + 1, cy, shade);
      this.paint(context, offsetX, cx, cy + 1, shade);
    }
    // 几个更大的边缘缺口，让轮廓更蓬松。
    for (let gap = 0; gap < 4; gap += 1) {
      const gx = Math.floor(random() * (TILE_SIZE - 1));
      const gy = Math.floor(random() * (TILE_SIZE - 1));
      context.clearRect(offsetX + gx, gy, 2, 1);
    }
  }

  private drawBedrock(
    context: CanvasRenderingContext2D,
    offsetX: number,
    random: () => number,
    base: THREE.Color
  ): void {
    // 高对比的杂乱明暗块，营造坚不可摧的基岩质感。
    for (let y = 0; y < TILE_SIZE; y += 1) {
      for (let x = 0; x < TILE_SIZE; x += 1) {
        const roll = random();
        let deltaL: number;
        if (roll < 0.2) deltaL = -0.2;
        else if (roll < 0.4) deltaL = -0.1;
        else if (roll < 0.6) deltaL = 0;
        else if (roll < 0.8) deltaL = 0.12;
        else deltaL = 0.22;
        this.paint(context, offsetX, x, y, this.tone(base, deltaL));
      }
    }
    // 几处两像素的明暗团块打破规律。
    for (let blob = 0; blob < 5; blob += 1) {
      const bx = Math.floor(random() * (TILE_SIZE - 1));
      const by = Math.floor(random() * (TILE_SIZE - 1));
      const deltaL = random() < 0.5 ? -0.24 : 0.24;
      this.paint(context, offsetX, bx, by, this.tone(base, deltaL));
      this.paint(context, offsetX, bx + 1, by, this.tone(base, deltaL));
    }
  }
}

let atlas: TextureAtlas | undefined;
export function getTextureAtlas(): TextureAtlas {
  atlas ??= new TextureAtlas();
  return atlas;
}
