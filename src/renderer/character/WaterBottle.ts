import * as THREE from 'three';
import { BOTTLE } from './bottleSpec';

/** A clear plastic bottle with a water level that can go down as the character drinks. */
export class WaterBottle {
  readonly object = new THREE.Group();
  private readonly water: THREE.Mesh;
  private readonly disposables: Array<{ dispose(): void }> = [];
  private level = 1;

  constructor(capColor = '#2f80ed') {
    this.object.name = 'WaterBottle';
    const { bottom, radius: r, shoulderY, neckRadius, neckTop, capTop, waterBottom } = BOTTLE;
    const profile = [
      [0, bottom],
      [r * 0.75, bottom],
      [r * 0.95, bottom + 0.007],
      [r, bottom + 0.02],
      [r, shoulderY],
      [r * 0.9, shoulderY + 0.018],
      [neckRadius * 1.3, shoulderY + 0.036],
      [neckRadius, shoulderY + 0.046],
      [neckRadius, neckTop],
    ].map(([x, y]) => new THREE.Vector2(x, y));

    const shellGeo = new THREE.LatheGeometry(profile, 28);
    const shellMat = new THREE.MeshStandardMaterial({
      color: '#e4f3ff',
      transparent: true,
      opacity: 0.4,
      roughness: 0.12,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const shell = new THREE.Mesh(shellGeo, shellMat);
    shell.renderOrder = 3;

    const waterGeo = new THREE.CylinderGeometry(r * 0.88, r * 0.88, 1, 24);
    waterGeo.translate(0, 0.5, 0); // grows upwards from its base
    const waterMat = new THREE.MeshStandardMaterial({ color: '#39a0ff', transparent: true, opacity: 0.82, roughness: 0.25 });
    this.water = new THREE.Mesh(waterGeo, waterMat);
    this.water.position.y = waterBottom;
    this.water.renderOrder = 2;

    const labelGeo = new THREE.CylinderGeometry(r * 1.015, r * 1.015, 0.046, 28, 1, true);
    const labelMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, side: THREE.DoubleSide });
    const label = new THREE.Mesh(labelGeo, labelMat);
    label.position.y = -0.025;

    const capGeo = new THREE.CylinderGeometry(neckRadius * 1.18, neckRadius * 1.18, capTop - neckTop + 0.004, 18);
    const capMat = new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.45 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.y = (neckTop + capTop) / 2;

    this.object.add(this.water, shell, label, cap);
    this.object.traverse((o) => (o.frustumCulled = false));
    this.disposables.push(shellGeo, shellMat, waterGeo, waterMat, labelGeo, labelMat, capGeo, capMat);
    this.setLevel(1);
  }

  get waterLevel(): number {
    return this.level;
  }

  /** 1 = full, 0 = empty. */
  setLevel(level: number): void {
    this.level = THREE.MathUtils.clamp(level, 0, 1);
    this.water.scale.y = Math.max(0.0001, this.level * (BOTTLE.waterTop - BOTTLE.waterBottom));
    this.water.visible = this.level > 0.005;
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const d of this.disposables) d.dispose();
  }
}
