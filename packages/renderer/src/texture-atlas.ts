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
  'grass-top': '#587d42',
  'grass-side': '#6f513c',
  dirt: '#71513f',
  stone: '#70777a',
  sand: '#cdbb86',
  water: '#2f70b2',
  'wood-top': '#8d6942',
  'wood-side': '#68492f',
  leaves: '#355a3a',
  bedrock: '#3f4444'
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
    context.clearRect(offsetX, 0, TILE_SIZE, TILE_SIZE);
    context.fillStyle = BASE_COLORS[id];
    context.fillRect(offsetX, 0, TILE_SIZE, TILE_SIZE);
    const baseColor = new THREE.Color(BASE_COLORS[id]);
    for (let index = 0; index < 5; index += 1) {
      const x = (index * 5 + id.length * 3) % 14;
      const y = (index * 7 + id.length) % 14;
      const variation = baseColor.clone().offsetHSL(0, 0, index % 2 === 0 ? 0.04 : -0.045);
      context.fillStyle = `#${variation.getHexString()}`;
      context.fillRect(offsetX + x, y, 2 + (index % 2), 2);
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
    if (id === 'leaves') {
      context.fillStyle = '#27492f';
      context.fillRect(offsetX + 2, 3, 5, 3);
      context.fillRect(offsetX + 9, 8, 4, 4);
      context.clearRect(offsetX + 1, 11, 2, 2);
      context.clearRect(offsetX + 11, 2, 2, 2);
      context.clearRect(offsetX + 7, 7, 1, 2);
      context.clearRect(offsetX + 14, 13, 2, 1);
    }
  }
}

let atlas: TextureAtlas | undefined;
export function getTextureAtlas(): TextureAtlas {
  atlas ??= new TextureAtlas();
  return atlas;
}
