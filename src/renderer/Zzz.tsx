/** Floating "z z z" above a dozing companion. Shown by CSS while the stage's data-companion is "sleeping". */
export function Zzz() {
  return (
    <div className="zzz" aria-hidden data-testid="zzz">
      <span>z</span>
      <span>z</span>
      <span>z</span>
    </div>
  );
}
