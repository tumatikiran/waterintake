import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { loadCharacterAsset, type CharacterSource } from './assets';
import { createRig } from './rig';

/** Exports a procedural character to a binary glTF file. */
export async function exportGlb(root: THREE.Object3D, clips: THREE.AnimationClip[]): Promise<Uint8Array> {
  const out = await new GLTFExporter().parseAsync(root, { binary: true, animations: clips });
  return new Uint8Array(out as ArrayBuffer);
}

/** Renders a small portrait (PNG data URL) for the character gallery. */
export async function renderThumbnail(source: CharacterSource, size = 256): Promise<string> {
  const asset = await loadCharacterAsset(source);
  const rig = createRig(asset);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#ffffff', '#b8c7dc', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(2.5, 4, 5);
    scene.add(sun);
    rig.root.rotation.y = -0.35;
    scene.add(rig.root);
    rig.expressions.set('happy');
    rig.expressions.snap();
    rig.update(0.4);
    // Head to hips.
    const camera = new THREE.OrthographicCamera(-0.7, 0.7, 2.08, 0.68, 0.1, 50);
    camera.position.set(0, 0, 10);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    rig.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
