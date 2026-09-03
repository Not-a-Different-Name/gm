import { BLOCK_DEFINITIONS, BlockId, isSolidBlock } from '@gm/core';
import * as THREE from 'three';

import type { BlockLookup } from './chunk-mesh.js';
import { getTextureAtlas } from './texture-atlas.js';

interface DropItem {
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial[]>;
  readonly blockId: BlockId;
  readonly velocity: THREE.Vector3;
  readonly bobPhase: number;
  settled: boolean;
  baseY: number;
}

const dropGeometry = new THREE.BoxGeometry(0.28, 0.28, 0.28);
const PICKUP_RADIUS = 1.6;
const MAX_DROPS = 200;
const DROP_GRAVITY = 12;
// 掉出世界过深（掉进无底缝）的兜底清理线。
const CLEANUP_Y = -16;

/**
 * 方块掉落物：破坏方块后弹出的可拾取实体，仅存在于运行时（不存档）。
 * 水非实体方块，掉落物会穿透水沉到水底；走近后自动拾取回调入包。
 */
export class DropItems {
  public readonly object3d = new THREE.Group();
  private readonly items: DropItem[] = [];
  // 按方块缓存六面材质：方块种类有限，避免每个掉落物各建一份。
  private readonly materialsByBlock = new Map<BlockId, THREE.MeshBasicMaterial[]>();
  private readonly lookup: BlockLookup;
  private readonly onPickup: (blockId: BlockId) => void;
  private elapsed = 0;

  public constructor(lookup: BlockLookup, onPickup: (blockId: BlockId) => void) {
    this.lookup = lookup;
    this.onPickup = onPickup;
  }

  public spawn(position: THREE.Vector3, blockId: BlockId): void {
    // 防御：空气与水不是物品，未知 ID 直接忽略。
    if (
      blockId === BlockId.Air ||
      blockId === BlockId.Water ||
      BLOCK_DEFINITIONS[blockId] === undefined
    ) {
      return;
    }
    if (this.items.length >= MAX_DROPS) {
      // 超出上限丢弃最老的掉落物，防止连续破坏无限累积。
      this.removeItem(0, false);
    }
    const mesh = new THREE.Mesh(dropGeometry, this.getMaterials(blockId));
    mesh.position.copy(position);
    this.object3d.add(mesh);
    this.items.push({
      mesh,
      blockId,
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * 3,
        Math.random() * 1.5 + 2.5,
        (Math.random() - 0.5) * 3
      ),
      bobPhase: Math.random() * Math.PI * 2,
      settled: false,
      baseY: position.y
    });
  }

  public update(deltaSeconds: number, playerPosition: THREE.Vector3): void {
    // 钳制单帧步长，避免切后台回来时大步长让掉落物穿过实体方块。
    const delta = Math.min(deltaSeconds, 0.1);
    this.elapsed += delta;
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index]!;
      const position = item.mesh.position;

      // 拾取：与玩家距离（含竖直）小于拾取半径时直接入包。
      const dx = position.x - playerPosition.x;
      const dy = position.y - playerPosition.y;
      const dz = position.z - playerPosition.z;
      if (dx * dx + dy * dy + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) {
        this.removeItem(index, true);
        continue;
      }

      if (item.settled) {
        // 落定后轻浮：在落点高度上做缓慢正弦起伏。
        position.y = item.baseY + Math.sin(this.elapsed * 2 + item.bobPhase) * 0.04;
      } else {
        item.velocity.y -= DROP_GRAVITY * delta;
        position.addScaledVector(item.velocity, delta);
        // 落定检测：下半边所在格已是实体方块时，贴到该格顶面停下（水非实体、直接沉穿）。
        const feetY = Math.floor(position.y - 0.14);
        if (
          isSolidBlock(this.lookup.getBlock(Math.floor(position.x), feetY, Math.floor(position.z)))
        ) {
          position.y = feetY + 1 + 0.14;
          item.velocity.set(0, 0, 0);
          item.settled = true;
          item.baseY = position.y;
        } else if (position.y < CLEANUP_Y) {
          this.removeItem(index, false);
          continue;
        }
      }
      item.mesh.rotation.y += 1.5 * delta;
    }
  }

  private removeItem(index: number, pickedUp: boolean): void {
    const item = this.items[index]!;
    this.object3d.remove(item.mesh);
    this.items.splice(index, 1);
    if (pickedUp) {
      this.onPickup(item.blockId);
    }
  }

  // BoxGeometry 的材质数组顺序为 +x、-x、+y、-y、+z、-z：
  // 四个侧面用侧面贴图，顶/底面用方块定义各自的顶/底贴图（草方块顶面是草皮、木头顶面是年轮）。
  private getMaterials(blockId: BlockId): THREE.MeshBasicMaterial[] {
    let materials = this.materialsByBlock.get(blockId);
    if (materials === undefined) {
      const definition = BLOCK_DEFINITIONS[blockId];
      const atlas = getTextureAtlas();
      const make = (textureId: string): THREE.MeshBasicMaterial => {
        const texture = new THREE.CanvasTexture(atlas.copyTile(textureId, 0, 2));
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;
        // alphaTest 裁掉透明孔洞（树叶贴图镂空），否则孔洞会渲染成黑点。
        return new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5 });
      };
      materials = [
        make(definition.textures.side),
        make(definition.textures.side),
        make(definition.textures.top),
        make(definition.textures.bottom),
        make(definition.textures.side),
        make(definition.textures.side)
      ];
      this.materialsByBlock.set(blockId, materials);
    }
    return materials;
  }
}
