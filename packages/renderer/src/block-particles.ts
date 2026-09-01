import * as THREE from 'three';

interface Particle {
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  readonly velocity: THREE.Vector3;
  lifetime: number;
}

const particleGeometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
// 粒子池大小：预分配固定数量网格常驻场景，spawn 只切换 visible，
// 避免每粒新建/销毁网格与材质造成的持续分配和卡顿。
const PARTICLE_POOL_SIZE = 96;

export class BlockParticles {
  public readonly object3d = new THREE.Group();
  private readonly pool: Particle[] = [];
  // 按颜色缓存共享材质：方块颜色只有少数几种，材质数量有界。
  private readonly materialsByColor = new Map<number, THREE.MeshBasicMaterial>();

  public constructor() {
    for (let index = 0; index < PARTICLE_POOL_SIZE; index += 1) {
      const mesh = new THREE.Mesh(particleGeometry, new THREE.MeshBasicMaterial());
      mesh.visible = false;
      this.object3d.add(mesh);
      this.pool.push({ mesh, velocity: new THREE.Vector3(), lifetime: 0 });
    }
  }

  public spawn(position: THREE.Vector3, color: number, count = 14): void {
    for (let index = 0; index < count; index += 1) {
      const particle = this.acquireParticle();
      particle.mesh.material = this.getMaterial(color);
      particle.mesh.position
        .copy(position)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5
          )
        );
      particle.velocity.set(
        (Math.random() - 0.5) * 3,
        Math.random() * 3.2,
        (Math.random() - 0.5) * 3
      );
      particle.mesh.rotation.set(0, 0, 0);
      particle.lifetime = 0.55 + Math.random() * 0.25;
      particle.mesh.visible = true;
    }
  }

  public update(deltaSeconds: number): void {
    for (const particle of this.pool) {
      if (particle.lifetime <= 0) {
        continue;
      }
      particle.lifetime -= deltaSeconds;
      particle.velocity.y -= 12 * deltaSeconds;
      particle.mesh.position.addScaledVector(particle.velocity, deltaSeconds);
      particle.mesh.rotation.x += 8 * deltaSeconds;
      particle.mesh.rotation.z += 6 * deltaSeconds;
      if (particle.lifetime <= 0) {
        particle.mesh.visible = false;
      }
    }
  }

  // 取一个可用的粒子：优先空闲粒子；池满时复用剩余寿命最短（最早弹出）的粒子。
  private acquireParticle(): Particle {
    for (const particle of this.pool) {
      if (particle.lifetime <= 0) {
        return particle;
      }
    }
    return this.pool.reduce((oldest, particle) =>
      particle.lifetime < oldest.lifetime ? particle : oldest
    );
  }

  private getMaterial(color: number): THREE.MeshBasicMaterial {
    let material = this.materialsByColor.get(color);
    if (material === undefined) {
      material = new THREE.MeshBasicMaterial({ color });
      this.materialsByColor.set(color, material);
    }
    return material;
  }
}
