import * as THREE from 'three';

const TILE_SIZE = 16;
const TAU = Math.PI * 2;
// 与图集里的水底色保持一致，确保水面网格与远处图集水面观感统一。
const WATER_BASE = '#326bb1';

// 生成一张可无缝平铺的像素水面纹理：叠加两组周期整除 TILE_SIZE 的正弦波，
// 因此水平与垂直方向都能循环衔接，逐帧滚动偏移时不会出现接缝。
function createWaterTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_SIZE;
  canvas.height = TILE_SIZE;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('无法创建水面纹理画布');
  }

  const base = new THREE.Color(WATER_BASE);
  const color = new THREE.Color();
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const wave =
        Math.sin((y / TILE_SIZE) * TAU * 3) * 0.5 + Math.sin(((x + y) / TILE_SIZE) * TAU * 2) * 0.5;
      color.copy(base).offsetHSL(0, 0, wave * 0.05);
      context.fillStyle = `#${color.getHexString()}`;
      context.fillRect(x, y, 1, 1);
    }
  }

  // 少量固定高光点，随纹理滚动形成粼粼波光。
  const highlight = base.clone().offsetHSL(0, -0.05, 0.16);
  context.fillStyle = `#${highlight.getHexString()}`;
  const spots: readonly (readonly [number, number])[] = [
    [2, 3],
    [11, 2],
    [6, 7],
    [14, 9],
    [4, 12],
    [9, 13]
  ];
  for (const spot of spots) {
    context.fillRect(spot[0], spot[1], 1, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let material: THREE.MeshLambertMaterial | undefined;
let waterTexture: THREE.CanvasTexture | undefined;

// 所有水面网格共享同一材质与纹理：既方便逐帧滚动 UV 制造流动感，
// 也避免区块卸载时误销毁其它区块仍在使用的水面材质。
// 后续接入资源包/模组替换水面外观时，只需改动这里的单一构造点。
export function getWaterMaterial(): THREE.MeshLambertMaterial {
  if (material === undefined) {
    waterTexture = createWaterTexture();
    material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: waterTexture,
      transparent: true,
      opacity: 0.72,
      depthWrite: false
    });
  }
  return material;
}

// 缓慢平移纹理偏移制造轻微流动；两轴速度不同形成对角漂移，波纹不呆板。
export function updateWaterMaterial(elapsedSeconds: number): void {
  if (waterTexture === undefined) {
    return;
  }
  waterTexture.offset.x = (elapsedSeconds * 0.03) % 1;
  waterTexture.offset.y = (elapsedSeconds * 0.05) % 1;
}
