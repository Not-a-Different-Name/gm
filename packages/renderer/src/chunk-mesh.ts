import {
  BlockId,
  CHUNK_SIZE,
  WORLD_HEIGHT,
  generateGreedyMesh,
  waterSurfaceHeight
} from '@gm/core';
import type { Chunk, GreedyRect } from '@gm/core';
import * as THREE from 'three';

import { buildChunkMeshGeometry } from './chunk-mesh-geometry.js';
import { getSolidMaterial } from './solid-material.js';
import { getTextureAtlas } from './texture-atlas.js';
import { getWaterMaterial } from './water-material.js';

interface Face {
  readonly normal: readonly [number, number, number];
  readonly vertices: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number]
  ];
  readonly shade: number;
}

const FACES: readonly Face[] = [
  {
    normal: [1, 0, 0],
    vertices: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1]
    ],
    shade: 0.82
  },
  {
    normal: [-1, 0, 0],
    vertices: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0]
    ],
    shade: 0.7
  },
  {
    normal: [0, 1, 0],
    vertices: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0]
    ],
    shade: 1
  },
  {
    normal: [0, -1, 0],
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1]
    ],
    shade: 0.55
  },
  {
    normal: [0, 0, 1],
    vertices: [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1]
    ],
    shade: 0.88
  },
  {
    normal: [0, 0, -1],
    vertices: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0]
    ],
    shade: 0.64
  }
];

export interface BlockLookup {
  getBlock(x: number, y: number, z: number): BlockId;
}

// 水面渲染额外需要的查询：某格的水位（0=水源满级，1..MAX 越远越薄，WATER_NONE 无水）。
export interface WaterLevelLookup extends BlockLookup {
  getWaterLevel(x: number, y: number, z: number): number;
}

// 水面 UV 直接取世界坐标（每个世界单位对应一次平铺），
// 让波纹纹理跨方块无缝连续，配合 RepeatWrapping 与逐帧偏移滚动形成流动感。
// 顶点高度：位于方块顶面的顶点（corner[1] === 1）压到 surfaceHeight（顶层水按水位分级低于岸边）；
// 其余顶点落到 bottomY——普通情况下是方块底面（整格侧面），
// 相邻水面更低时传邻居水面高度，只画两条水面之间露出的侧面条带。
function addWaterFace(
  positions: number[],
  colors: number[],
  uvs: number[],
  blockX: number,
  blockZ: number,
  face: Face,
  color: THREE.Color,
  surfaceHeight: number,
  bottomY: number
): void {
  const corners = [
    face.vertices[0],
    face.vertices[1],
    face.vertices[2],
    face.vertices[0],
    face.vertices[2],
    face.vertices[3]
  ];
  const shadedColor = color.clone().multiplyScalar(face.shade);

  for (const corner of corners) {
    const worldX = blockX + corner[0];
    const worldY = corner[1] === 1 ? surfaceHeight : bottomY;
    const worldZ = blockZ + corner[2];
    positions.push(worldX, worldY, worldZ);
    colors.push(shadedColor.r, shadedColor.g, shadedColor.b);
    // 依朝向选取两个世界轴作为 UV，保证相邻方块的纹理坐标天然衔接。
    if (face.normal[1] !== 0) {
      uvs.push(worldX, worldZ);
    } else if (face.normal[0] !== 0) {
      uvs.push(worldZ, worldY);
    } else {
      uvs.push(worldX, worldY);
    }
  }
}

export function createChunkMesh(
  chunk: Chunk,
  lookup: BlockLookup
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> {
  const chunkOriginX = chunk.x * CHUNK_SIZE;
  const chunkOriginZ = chunk.z * CHUNK_SIZE;
  // 本地坐标查询：区块内直接读 chunk，越界转发给世界查询（可能顺带生成邻居数据），
  // 与旧逐面构建的邻居查询语义一致。
  const getLocalBlock = (x: number, y: number, z: number): BlockId => {
    if (x >= 0 && x < CHUNK_SIZE && y >= 0 && y < WORLD_HEIGHT && z >= 0 && z < CHUNK_SIZE) {
      return chunk.getBlock(x, y, z);
    }
    return lookup.getBlock(chunkOriginX + x, y, chunkOriginZ + z);
  };

  // 六个方向分别做贪心扫描，把同方向同方块的共面区域合并成矩形
  // （产面与剔除语义和旧逐面构建一致，见 core 的 generateGreedyMesh）。
  const rects: GreedyRect[] = [];
  for (let directionIndex = 0; directionIndex < 6; directionIndex += 1) {
    rects.push(
      ...generateGreedyMesh({
        size: [CHUNK_SIZE, WORLD_HEIGHT, CHUNK_SIZE],
        directionIndex,
        getBlock: getLocalBlock
      })
    );
  }

  const atlas = getTextureAtlas();
  const data = buildChunkMeshGeometry(rects, (textureId, variant) =>
    atlas.getRegion(textureId, variant)
  );

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
  // 自定义属性：着色器注入按 region 做逐块平铺。
  geometry.setAttribute('aRegion', new THREE.Float32BufferAttribute(data.regions, 4));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return new THREE.Mesh(geometry, getSolidMaterial());
}

export function createWaterMesh(
  chunk: Chunk,
  lookup: WaterLevelLookup
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const waterColor = new THREE.Color(0xffffff);
  const chunkOriginX = chunk.x * 16;
  const chunkOriginZ = chunk.z * 16;

  for (let y = 0; y < 256; y += 1) {
    for (let z = 0; z < 16; z += 1) {
      for (let x = 0; x < 16; x += 1) {
        if (chunk.getBlock(x, y, z) !== BlockId.Water) {
          continue;
        }

        const worldX = chunkOriginX + x;
        const worldZ = chunkOriginZ + z;
        // 顶层水块：正上方不是水，其顶面按水位分级下压，使水面低于岸边并呈阶梯坡。
        const isSurfaceTop = lookup.getBlock(worldX, y + 1, worldZ) !== BlockId.Water;
        const surfaceHeight = isSurfaceTop
          ? waterSurfaceHeight(y, lookup.getWaterLevel(worldX, y, worldZ))
          : y + 1;

        for (const [, face] of FACES.entries()) {
          const neighbor = lookup.getBlock(
            worldX + face.normal[0],
            y + face.normal[1],
            worldZ + face.normal[2]
          );
          // 水体作为整体只渲染与空气接触的外表面：与实体方块相邻的侧/底面全部剔除，
          // 水下地形与岸壁直接可见，不被半透明蓝色水膜覆盖（也不会在海底落差处形成整堵水墙）。
          if (neighbor === BlockId.Air) {
            addWaterFace(
              positions,
              colors,
              uvs,
              worldX,
              worldZ,
              face,
              waterColor,
              surfaceHeight,
              y
            );
          } else if (neighbor === BlockId.Water && face.normal[1] === 0) {
            // 相邻同为水：比较双方水面高度。邻居水面更低时，本块在两条水面之间
            // 露出一截侧面，补画该条带；邻居水体完全覆盖本面时继续剔除。
            const neighborX = worldX + face.normal[0];
            const neighborZ = worldZ + face.normal[2];
            const neighborSurface =
              lookup.getBlock(neighborX, y + 1, neighborZ) === BlockId.Water
                ? y + 1
                : waterSurfaceHeight(y, lookup.getWaterLevel(neighborX, y, neighborZ));
            if (neighborSurface < surfaceHeight) {
              addWaterFace(
                positions,
                colors,
                uvs,
                worldX,
                worldZ,
                face,
                waterColor,
                surfaceHeight,
                neighborSurface
              );
            }
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // 复用共享水面材质：逐帧滚动其纹理偏移即可让所有水面一起流动。
  return new THREE.Mesh(geometry, getWaterMaterial());
}
