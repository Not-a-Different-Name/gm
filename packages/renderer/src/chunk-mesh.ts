import { BLOCK_DEFINITIONS, BlockId, MAX_WATER_LEVEL, WATER_NONE, isOpaqueBlock } from '@gm/core';
import type { Chunk } from '@gm/core';
import * as THREE from 'three';

import { getTextureAtlas, TEXTURE_VARIANT_COUNT, type TextureRegion } from './texture-atlas.js';
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

function getTextureVariant(x: number, y: number, z: number, faceIndex: number): number {
  const hash =
    Math.imul(x, 73_856_093) ^
    Math.imul(y, 19_349_663) ^
    Math.imul(z, 83_492_791) ^
    Math.imul(faceIndex, 2_654_435_761);
  return (hash >>> 0) % TEXTURE_VARIANT_COUNT;
}

function addFace(
  positions: number[],
  colors: number[],
  uvs: number[],
  blockX: number,
  blockY: number,
  blockZ: number,
  face: Face,
  color: THREE.Color,
  region: TextureRegion
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

  const faceUvs = [
    [region.u0, region.v0],
    [region.u0, region.v1],
    [region.u1, region.v1],
    [region.u0, region.v0],
    [region.u1, region.v1],
    [region.u1, region.v0]
  ];
  for (let index = 0; index < corners.length; index += 1) {
    const corner = corners[index]!;
    const uv = faceUvs[index]!;
    positions.push(blockX + corner[0], blockY + corner[1], blockZ + corner[2]);
    colors.push(shadedColor.r, shadedColor.g, shadedColor.b);
    uvs.push(uv[0]!, uv[1]!);
  }
}

// 水源顶面相对整格顶部的下沉量（世界单位）：水源约为满格的 14/16，
// 比岸边地面（整格顶 1.0）略低，符合"水面低于岸边"。
const WATER_SOURCE_DROP = 0.125;
// 每高一级水位额外多下沉的量：流动水越远越薄，水面呈阶梯状向外下降。
const WATER_LEVEL_DROP = 0.19;

// 依据水位计算该顶层水块"顶面"的世界高度（整格底为 blockY）。
// level 0（水源）最高，越薄越低；无水位信息时按水源处理。
function waterSurfaceHeight(blockY: number, level: number): number {
  const clampedLevel = level === WATER_NONE ? 0 : Math.min(level, MAX_WATER_LEVEL);
  return blockY + 1 - WATER_SOURCE_DROP - clampedLevel * WATER_LEVEL_DROP;
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
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const atlas = getTextureAtlas();
  const chunkOriginX = chunk.x * 16;
  const chunkOriginZ = chunk.z * 16;

  for (let y = 0; y < 256; y += 1) {
    for (let z = 0; z < 16; z += 1) {
      for (let x = 0; x < 16; x += 1) {
        const blockId = chunk.getBlock(x, y, z);
        if (blockId === BlockId.Air || blockId === BlockId.Water) {
          continue;
        }

        const color = new THREE.Color(0xffffff);
        for (const [faceIndex, face] of FACES.entries()) {
          const neighbor = lookup.getBlock(
            chunkOriginX + x + face.normal[0],
            y + face.normal[1],
            chunkOriginZ + z + face.normal[2]
          );
          if (!isOpaqueBlock(neighbor)) {
            const textures = BLOCK_DEFINITIONS[blockId].textures;
            const textureId =
              face.normal[1] > 0
                ? textures.top
                : face.normal[1] < 0
                  ? textures.bottom
                  : textures.side;
            addFace(
              positions,
              colors,
              uvs,
              chunkOriginX + x,
              y,
              chunkOriginZ + z,
              face,
              color,
              atlas.getRegion(
                textureId,
                getTextureVariant(chunkOriginX + x, y, chunkOriginZ + z, faceIndex)
              )
            );
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

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: atlas.texture,
    alphaTest: 0.5
  });
  return new THREE.Mesh(geometry, material);
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
          if (neighbor === BlockId.Air || (neighbor !== BlockId.Water && isOpaqueBlock(neighbor))) {
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
