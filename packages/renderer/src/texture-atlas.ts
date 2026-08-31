import * as THREE from 'three';

const TILE_SIZE = 16;
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
const BASE_COLORS: Readonly<Record<(typeof TEXTURE_IDS)[number], string>> = {
  'grass-top': '#619a43',
  'grass-side': '#77583d',
  dirt: '#765039',
  stone: '#767b80',
  sand: '#d7c37e',
  water: '#3b81c5',
  'wood-top': '#9c7040',
  'wood-side': '#714728',
  leaves: '#3f7040',
  bedrock: '#3c4141'
};

export interface TextureRegion {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

export class TextureAtlas {
  public readonly texture: THREE.CanvasTexture;
  private readonly regions = new Map<string, TextureRegion>();

  public constructor() {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_SIZE * TEXTURE_IDS.length;
    canvas.height = TILE_SIZE;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('无法创建像素纹理画布');
    TEXTURE_IDS.forEach((id, index) => {
      this.drawTile(context, id, index * TILE_SIZE);
      this.regions.set(id, {
        u0: index / TEXTURE_IDS.length,
        v0: 0,
        u1: (index + 1) / TEXTURE_IDS.length,
        v1: 1
      });
    });
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }

  public getRegion(id: string): TextureRegion {
    return this.regions.get(id) ?? this.regions.get('stone')!;
  }

  private drawTile(
    context: CanvasRenderingContext2D,
    id: (typeof TEXTURE_IDS)[number],
    offsetX: number
  ): void {
    const color = new THREE.Color(BASE_COLORS[id]);
    for (let y = 0; y < TILE_SIZE; y += 1)
      for (let x = 0; x < TILE_SIZE; x += 1) {
        const noise = (((x * 13 + y * 7 + id.length * 17) % 9) - 4) * 0.018;
        const variation = color.clone().offsetHSL(0, 0, noise);
        context.fillStyle = `#${variation.getHexString()}`;
        context.fillRect(offsetX + x, y, 1, 1);
      }
    if (id === 'grass-side') {
      context.fillStyle = '#5d9940';
      context.fillRect(offsetX, 0, TILE_SIZE, 4);
    }
    if (id === 'wood-side')
      for (let x = 2; x < TILE_SIZE; x += 5) {
        context.fillStyle = '#59371f';
        context.fillRect(offsetX + x, 0, 1, TILE_SIZE);
      }
    if (id === 'leaves')
      for (let y = 2; y < TILE_SIZE; y += 5) {
        context.fillStyle = '#28592f';
        context.fillRect(offsetX + (y % 7), y, 2, 2);
      }
  }
}

let atlas: TextureAtlas | undefined;
export function getTextureAtlas(): TextureAtlas {
  atlas ??= new TextureAtlas();
  return atlas;
}
