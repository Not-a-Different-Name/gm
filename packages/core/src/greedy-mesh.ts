import { BLOCK_DEFINITIONS, BlockId, isOpaqueBlock } from './block.js';

// 纹理变体数量：渲染层图集为每种纹理平铺若干个变体，网格构建时按面所在层挑选其一。
// 常量放在 core，让贪心网格与图集共用同一事实来源。
export const TEXTURE_VARIANT_COUNT = 4;

/** 面方向描述：法线 + 扫描层级轴与面内两轴（0=x，1=y，2=z）。 */
export interface GreedyDirection {
  readonly normal: readonly [number, number, number];
  /** 扫描层级轴：该方向的面沿此轴逐层切割。 */
  readonly layerAxis: 0 | 1 | 2;
  /** 面内 u 轴（矩形宽方向）。 */
  readonly uAxis: 0 | 1 | 2;
  /** 面内 v 轴（矩形高方向）。 */
  readonly vAxis: 0 | 1 | 2;
}

// 六个面方向，与渲染层 FACES 表同序（+X、-X、+Y、-Y、+Z、-Z）。
// u/v 轴的选取不影响合并正确性，只决定扫描顺序与矩形宽高方向。
export const GREEDY_DIRECTIONS: readonly GreedyDirection[] = [
  { normal: [1, 0, 0], layerAxis: 0, uAxis: 2, vAxis: 1 },
  { normal: [-1, 0, 0], layerAxis: 0, uAxis: 2, vAxis: 1 },
  { normal: [0, 1, 0], layerAxis: 1, uAxis: 0, vAxis: 2 },
  { normal: [0, -1, 0], layerAxis: 1, uAxis: 0, vAxis: 2 },
  { normal: [0, 0, 1], layerAxis: 2, uAxis: 0, vAxis: 1 },
  { normal: [0, 0, -1], layerAxis: 2, uAxis: 0, vAxis: 1 }
];

/** 贪心扫描产出的可合并矩形：同方向同方块的共面区域。 */
export interface GreedyRect {
  readonly directionIndex: number;
  /** 面内锚点：沿 u 轴与 v 轴的起始格（0 起始）。 */
  readonly u0: number;
  readonly v0: number;
  /** 沿法线轴的层级（0 起始）。 */
  readonly layer: number;
  /** 面内宽高（格数，沿 u 轴 × v 轴）。 */
  readonly width: number;
  readonly height: number;
  readonly blockId: BlockId;
  /** 该方向使用的纹理标识（顶面/底面/侧面由方块定义导出）。 */
  readonly textureId: string;
  /** 纹理变体：只由该面所在层(沿法线坐标)与朝向决定，与合并边界无关——
      同层同朝向的格共享同一变体，破坏/放置邻居方块后幸存面的贴图朝向保持不变。 */
  readonly variant: number;
}

export interface GreedyMeshOptions {
  /** 扫描区域三轴尺寸 [x, y, z]（通常为区块尺寸）。 */
  readonly size: readonly [number, number, number];
  /** 面方向在 GREEDY_DIRECTIONS 中的下标。 */
  readonly directionIndex: number;
  /** 本地坐标查询；越界坐标由调用方决定返回什么（如 Air）。 */
  readonly getBlock: (x: number, y: number, z: number) => BlockId;
  /** 邻居是否遮住本格；默认复用 isOpaqueBlock（不透明即遮挡）。 */
  readonly occludes?: (blockId: BlockId) => boolean;
}

/** 面级纹理变体：只由该面所在层(沿法线坐标)与朝向哈希而来，同参数必同结果。
    不掺入矩形锚点与宽高：合并边界随方块增删而变化时，幸存面的变体保持不变。 */
export function getPlaneVariant(
  layerCoordinate: number,
  directionIndex: number,
  variantCount = TEXTURE_VARIANT_COUNT
): number {
  const hash = Math.imul(layerCoordinate, 73_856_093) ^ Math.imul(directionIndex, 8_669_849_089);
  return (hash >>> 0) % variantCount;
}

// 由 (u, v, layer) 还原本地三维坐标：层级轴取 layer，u/v 轴取面内坐标。
function localCoordinate(
  direction: GreedyDirection,
  u: number,
  v: number,
  layer: number
): [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  result[direction.layerAxis] = layer;
  result[direction.uAxis] = u;
  result[direction.vAxis] = v;
  return result;
}

// 对某一面方向做 2D 贪心扫描：把区域切成沿法线轴的一叠层面，每层先建"产面遮罩"，
// 再行合并 + 整行匹配向下扩展出同方块矩形，消费过的区域清零防止重复产出。
// 复杂度：每层 O(面积) 建遮罩 + O(Σ矩形面积) 清零，扫描顺序固定、结果确定。
export function generateGreedyMesh(options: GreedyMeshOptions): GreedyRect[] {
  const direction = GREEDY_DIRECTIONS[options.directionIndex];
  if (direction === undefined) {
    throw new RangeError(`面方向下标无效：${options.directionIndex}`);
  }
  const occludes = options.occludes ?? isOpaqueBlock;
  const layerCount = options.size[direction.layerAxis];
  const uCount = options.size[direction.uAxis];
  const vCount = options.size[direction.vAxis];
  const [nx, ny, nz] = direction.normal;
  const rects: GreedyRect[] = [];
  // 每层复用的遮罩：值 = 产面方块的 blockId，0 = 不产面（Air/水/被邻居遮挡）。
  // blockId 均小于 255，Uint8 足够。
  const mask = new Uint8Array(uCount * vCount);

  for (let layer = 0; layer < layerCount; layer += 1) {
    // 本层所有面共享同一变体（只依赖层坐标与朝向）：矩形怎么合并/拆分都不影响贴图朝向。
    const variant = getPlaneVariant(layer, options.directionIndex);
    for (let v = 0; v < vCount; v += 1) {
      for (let u = 0; u < uCount; u += 1) {
        const [x, y, z] = localCoordinate(direction, u, v, layer);
        const blockId = options.getBlock(x, y, z);
        // 空气与水不产生实心面；被不透明邻居遮挡的面同样剔除（与逐面构建语义一致）。
        if (blockId === BlockId.Air || blockId === BlockId.Water) {
          mask[v * uCount + u] = 0;
          continue;
        }
        const neighbor = options.getBlock(x + nx, y + ny, z + nz);
        mask[v * uCount + u] = occludes(neighbor) ? 0 : blockId;
      }
    }

    for (let v = 0; v < vCount; v += 1) {
      for (let u = 0; u < uCount; u += 1) {
        const blockId = mask[v * uCount + u]!;
        if (blockId === 0) {
          continue;
        }
        // 行合并：沿 u 轴向右吞并同方块格。
        let width = 1;
        while (u + width < uCount && mask[v * uCount + u + width] === blockId) {
          width += 1;
        }
        // 跨行扩展：整行完全匹配才向下延伸。
        let height = 1;
        expand: while (v + height < vCount) {
          const row = v + height;
          for (let column = u; column < u + width; column += 1) {
            if (mask[row * uCount + column] !== blockId) {
              break expand;
            }
          }
          height += 1;
        }
        for (let dv = 0; dv < height; dv += 1) {
          for (let du = 0; du < width; du += 1) {
            mask[(v + dv) * uCount + u + du] = 0;
          }
        }

        const definition = BLOCK_DEFINITIONS[blockId as BlockId];
        rects.push({
          directionIndex: options.directionIndex,
          u0: u,
          v0: v,
          layer,
          width,
          height,
          blockId: blockId as BlockId,
          textureId:
            ny > 0
              ? definition.textures.top
              : ny < 0
                ? definition.textures.bottom
                : definition.textures.side,
          variant
        });
      }
    }

    mask.fill(0);
  }

  return rects;
}
