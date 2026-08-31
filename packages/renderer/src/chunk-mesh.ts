import { BLOCK_DEFINITIONS, BlockId, isOpaqueBlock } from '@gm/core';
import type { Chunk } from '@gm/core';
import * as THREE from 'three';

import { getTextureAtlas, TEXTURE_VARIANT_COUNT, type TextureRegion } from './texture-atlas.js';

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
  lookup: BlockLookup
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> {
  const positions: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const atlas = getTextureAtlas();
  const waterColor = new THREE.Color(0xffffff);
  const chunkOriginX = chunk.x * 16;
  const chunkOriginZ = chunk.z * 16;

  for (let y = 0; y < 256; y += 1) {
    for (let z = 0; z < 16; z += 1) {
      for (let x = 0; x < 16; x += 1) {
        if (chunk.getBlock(x, y, z) !== BlockId.Water) {
          continue;
        }

        for (const [faceIndex, face] of FACES.entries()) {
          const neighbor = lookup.getBlock(
            chunkOriginX + x + face.normal[0],
            y + face.normal[1],
            chunkOriginZ + z + face.normal[2]
          );
          if (neighbor === BlockId.Air || (neighbor !== BlockId.Water && isOpaqueBlock(neighbor))) {
            addFace(
              positions,
              colors,
              uvs,
              chunkOriginX + x,
              y,
              chunkOriginZ + z,
              face,
              waterColor,
              atlas.getRegion(
                'water',
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
    transparent: true,
    opacity: 0.68,
    depthWrite: false
  });
  return new THREE.Mesh(geometry, material);
}
