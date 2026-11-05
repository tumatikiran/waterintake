import { use, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { loadCharacterAsset, sourceKey, type CharacterSource } from './assets';
import { createRig, type CharacterRig } from './rig';

interface CharacterModelProps {
  source: CharacterSource;
  /** Receives the rig (and the key of the source it was built from) once it exists, and null when it goes away. */
  onRig?: (rig: CharacterRig | null, key: string) => void;
}

/** Loads a character (suspends while loading) and keeps its animations, face and bottle updated. */
export function CharacterModel({ source, onRig }: CharacterModelProps) {
  const key = sourceKey(source);
  const asset = use(loadCharacterAsset(source));
  const rig = useMemo(() => createRig(asset), [asset]);

  // Dispose only when this rig really goes away (not when callbacks change).
  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => {
    onRig?.(rig, key);
    return () => onRig?.(null, key);
  }, [rig, key, onRig]);

  useFrame((_, dt) => rig.update(Math.min(dt, 1 / 20)));

  return <primitive object={rig.root} />;
}
