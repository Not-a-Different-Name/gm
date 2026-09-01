import { SeededRandom } from '@gm/core';
import * as THREE from 'three';

// 单个云平面的边长（世界单位）。每层用 5×5 个平面覆盖 480×480，
// 超出雾距 300 的边缘隐入雾中，相机飞出边缘后也总有一圈云可见。
const CLOUD_PLANE_SIZE = 96;
// 每层平面数量（单轴）。
const CLOUD_GRID_COUNT = 5;
// 云贴图的像素尺寸与"像素格"边长：8px 一格、整贴图即 4×4 格。
const CLOUD_TILE_SIZE = 32;
const CLOUD_PIXEL_SIZE = 8;
// 贴图 repeat：单张贴图铺满整个 96 格平面（32 × 3）。
const CLOUD_TILE_REPEAT = CLOUD_PLANE_SIZE / CLOUD_TILE_SIZE;

interface CloudLayerDefinition {
  /** 云层世界高度。地表 ≤142、树冠 ≤145，168/180 远高于任何地形。 */
  readonly height: number;
  /** 纹理每秒西向漂移量（贴图重复单位）；低慢高快形成视差。 */
  readonly drift: number;
}

const CLOUD_LAYERS: readonly CloudLayerDefinition[] = [
  { height: 168, drift: 0.008 },
  { height: 180, drift: 0.014 }
];

interface CloudLayer {
  readonly definition: CloudLayerDefinition;
  readonly group: THREE.Group;
  readonly texture: THREE.CanvasTexture;
}

// 生成一张可无缝平铺的像素云贴图：白底透明、随机散布方形云团（与方块日月同一像素语言），
// 团内透明度逐像素抖动避免呆板，再挖 2-3 个整格透明孔洞让云层透出天空。
// 坐标取模回卷，团块跨贴图边缘时 repeat 平铺仍无缝衔接。
// 形状由种子命名空间的随机源决定：同一种子每次生成的云层完全一致。
function createCloudTexture(random: SeededRandom): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = CLOUD_TILE_SIZE;
  canvas.height = CLOUD_TILE_SIZE;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('无法创建云层贴图画布');
  }

  const image = context.createImageData(CLOUD_TILE_SIZE, CLOUD_TILE_SIZE);
  const cellCount = CLOUD_TILE_SIZE / CLOUD_PIXEL_SIZE;
  // 5-6 个云团：中心落在像素格中心，半径 1-2 格，切比雪夫距离取方形团块。
  const clusterCount = random.nextInt(5, 7);
  for (let index = 0; index < clusterCount; index += 1) {
    const centerX = random.nextInt(0, cellCount) * CLOUD_PIXEL_SIZE + CLOUD_PIXEL_SIZE / 2;
    const centerY = random.nextInt(0, cellCount) * CLOUD_PIXEL_SIZE + CLOUD_PIXEL_SIZE / 2;
    const radius = random.nextInt(1, 3) * CLOUD_PIXEL_SIZE;
    for (let y = centerY - radius; y <= centerY + radius; y += 1) {
      for (let x = centerX - radius; x <= centerX + radius; x += 1) {
        if (Math.max(Math.abs(x - centerX), Math.abs(y - centerY)) > radius) {
          continue;
        }
        const pixelX = ((x % CLOUD_TILE_SIZE) + CLOUD_TILE_SIZE) % CLOUD_TILE_SIZE;
        const pixelY = ((y % CLOUD_TILE_SIZE) + CLOUD_TILE_SIZE) % CLOUD_TILE_SIZE;
        const offset = (pixelY * CLOUD_TILE_SIZE + pixelX) * 4;
        image.data[offset] = 255;
        image.data[offset + 1] = 255;
        image.data[offset + 2] = 255;
        // 约 0.85 的透明度并逐像素轻微抖动，云团边缘不呆板。
        image.data[offset + 3] = Math.round((0.85 + (random.next() - 0.5) * 0.2) * 255);
      }
    }
  }

  // 2-3 个整格透明孔洞：云团覆盖了大半贴图，孔洞大概率落在团内，云层因此蓬松有层次。
  const holeCount = random.nextInt(2, 4);
  for (let index = 0; index < holeCount; index += 1) {
    const holeX = random.nextInt(0, cellCount) * CLOUD_PIXEL_SIZE;
    const holeY = random.nextInt(0, cellCount) * CLOUD_PIXEL_SIZE;
    for (let y = 0; y < CLOUD_PIXEL_SIZE; y += 1) {
      for (let x = 0; x < CLOUD_PIXEL_SIZE; x += 1) {
        const offset = ((holeY + y) * CLOUD_TILE_SIZE + holeX + x) * 4;
        image.data[offset + 3] = 0;
      }
    }
  }
  context.putImageData(image, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(CLOUD_TILE_REPEAT, CLOUD_TILE_REPEAT);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export interface CloudsOptions {
  /** 世界种子：同一种子下云层形状与漂移完全一致。 */
  readonly seed: string | number;
}

/**
 * 像素云层：两层方形云平面挂在天空组内（跟随相机、水下自动隐藏），
 * 云形由种子确定性生成，材质随日月光照自然昼夜变暗、远缘隐入雾中。
 */
export class Clouds {
  public readonly object3d = new THREE.Group();

  private readonly layers: readonly CloudLayer[];

  public constructor(options: CloudsOptions) {
    this.layers = CLOUD_LAYERS.map((definition) => {
      // 每层独立随机命名空间：改某一层高度/漂移不影响另一层的云形。
      const texture = createCloudTexture(
        new SeededRandom(options.seed).fork(`clouds-${definition.height}`)
      );
      const material = new THREE.MeshLambertMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        // 双面：飞行穿云时从上方/侧面也能看到云面。
        side: THREE.DoubleSide,
        fog: true,
        // 只剔除完全透明的像素；云团半透明像素与天空正常混合。
        alphaTest: 0.03
      });
      const group = new THREE.Group();
      const geometry = new THREE.PlaneGeometry(CLOUD_PLANE_SIZE, CLOUD_PLANE_SIZE);
      for (let row = 0; row < CLOUD_GRID_COUNT; row += 1) {
        for (let column = 0; column < CLOUD_GRID_COUNT; column += 1) {
          const plane = new THREE.Mesh(geometry, material);
          plane.rotation.x = -Math.PI / 2;
          plane.position.set(
            (column - (CLOUD_GRID_COUNT - 1) / 2) * CLOUD_PLANE_SIZE,
            definition.height,
            (row - (CLOUD_GRID_COUNT - 1) / 2) * CLOUD_PLANE_SIZE
          );
          group.add(plane);
        }
      }
      this.object3d.add(group);
      return { definition, group, texture };
    });
  }

  // 每帧：云层水平跟随相机（竖直固定在世界高度，飞行穿云时云在身下），
  // 并滚动纹理向西漂移；挂在天空组里，水下随 sky.object3d 一起隐藏。
  // 正余数写法保证负坐标下取模不错位一整格平面。暂停时照常漂移（与水面波纹一致）。
  public update(elapsedSeconds: number, cameraPosition: THREE.Vector3): void {
    const remainderX =
      cameraPosition.x - Math.floor(cameraPosition.x / CLOUD_PLANE_SIZE) * CLOUD_PLANE_SIZE;
    const remainderZ =
      cameraPosition.z - Math.floor(cameraPosition.z / CLOUD_PLANE_SIZE) * CLOUD_PLANE_SIZE;
    for (const layer of this.layers) {
      layer.group.position.set(
        -remainderX,
        layer.definition.height - cameraPosition.y,
        -remainderZ
      );
      layer.texture.offset.x = -elapsedSeconds * layer.definition.drift;
    }
  }
}
