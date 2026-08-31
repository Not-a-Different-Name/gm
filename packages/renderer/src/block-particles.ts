import * as THREE from 'three';

interface Particle {
  readonly mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  readonly velocity: THREE.Vector3;
  lifetime: number;
}

const particleGeometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);

export class BlockParticles {
  public readonly object3d = new THREE.Group();
  private readonly particles: Particle[] = [];

  public spawn(position: THREE.Vector3, color: number): void {
    for (let index = 0; index < 14; index += 1) {
      const mesh = new THREE.Mesh(particleGeometry, new THREE.MeshBasicMaterial({ color }));
      mesh.position
        .copy(position)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5
          )
        );
      this.object3d.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 3,
          Math.random() * 3.2,
          (Math.random() - 0.5) * 3
        ),
        lifetime: 0.55 + Math.random() * 0.25
      });
    }
  }

  public update(deltaSeconds: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      if (particle === undefined) {
        continue;
      }
      particle.lifetime -= deltaSeconds;
      particle.velocity.y -= 12 * deltaSeconds;
      particle.mesh.position.addScaledVector(particle.velocity, deltaSeconds);
      particle.mesh.rotation.x += 8 * deltaSeconds;
      particle.mesh.rotation.z += 6 * deltaSeconds;
      if (particle.lifetime <= 0) {
        this.object3d.remove(particle.mesh);
        particle.mesh.material.dispose();
        this.particles.splice(index, 1);
      }
    }
  }
}
