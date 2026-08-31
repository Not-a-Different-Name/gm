import { BLOCK_DEFINITIONS, BlockId, isOpaqueBlock } from '@gm/core';
import type { Chunk } from '@gm/core';
import * as THREE from 'three';

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

function addFace(
  positions: number[],
  colors: number[],
  blockX: number,
  blockY: number,
  blockZ: number,
  face: Face,
  color: THREE.Color
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
    positions.push(blockX + corner[0], blockY + corner[1], blockZ + corner[2]);
    colors.push(shadedColor.r, shadedColor.g, shadedColor.b);
  }
}

export function createChunkMesh(
  chunk: Chunk,
  lookup: BlockLookup
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> {
  const positions: number[] = [];
  const colors: number[] = [];
  const chunkOriginX = chunk.x * 16;
  const chunkOriginZ = chunk.z * 16;

  for (let y = 0; y < 256; y += 1) {
    for (let z = 0; z < 16; z += 1) {
      for (let x = 0; x < 16; x += 1) {
        const blockId = chunk.getBlock(x, y, z);
        if (blockId === BlockId.Air || blockId === BlockId.Water) {
          continue;
        }

        const color = new THREE.Color(BLOCK_DEFINITIONS[blockId].color);
        for (const face of FACES) {
          const neighbor = lookup.getBlock(
            chunkOriginX + x + face.normal[0],
            y + face.normal[1],
            chunkOriginZ + z + face.normal[2]
          );
          if (!isOpaqueBlock(neighbor)) {
            addFace(positions, colors, chunkOriginX + x, y, chunkOriginZ + z, face, color);
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  return new THREE.Mesh(geometry, material);
}

export function createWaterMesh(
  chunk: Chunk,
  lookup: BlockLookup
): THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial> {
  const positions: number[] = [];
  const colors: number[] = [];
  const waterColor = new THREE.Color(BLOCK_DEFINITIONS[BlockId.Water].color);
  const chunkOriginX = chunk.x * 16;
  const chunkOriginZ = chunk.z * 16;

  for (let y = 0; y < 256; y += 1) {
    for (let z = 0; z < 16; z += 1) {
      for (let x = 0; x < 16; x += 1) {
        if (chunk.getBlock(x, y, z) !== BlockId.Water) {
          continue;
        }

        for (const face of FACES) {
          const neighbor = lookup.getBlock(
            chunkOriginX + x + face.normal[0],
            y + face.normal[1],
            chunkOriginZ + z + face.normal[2]
          );
          if (neighbor === BlockId.Air || (neighbor !== BlockId.Water && isOpaqueBlock(neighbor))) {
            addFace(positions, colors, chunkOriginX + x, y, chunkOriginZ + z, face, waterColor);
          }
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.68,
    depthWrite: false
  });
  return new THREE.Mesh(geometry, material);
}
