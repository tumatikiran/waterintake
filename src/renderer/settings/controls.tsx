import { useId, type ReactNode } from 'react';

export function Section({ title, description, children, aside }: { title: string; description?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="section">
      <header className="section-head">
        <div>
          <h2>{title}</h2>
          {description && <p className="muted">{description}</p>}
        </div>
        {aside}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="row">
      <div className="row-label">
        <label htmlFor={htmlFor}>{label}</label>
        {hint && <p className="hint">{hint}</p>}
      </div>
      <div className="row-control">{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="toggle"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

export function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Row label={label} hint={hint}>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </Row>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select({ value, options, onChange, label, id }: { value: number; options: { value: number; label: string }[]; onChange: (v: number) => void; label: string; id?: string }) {
  const known = options.some((o) => o.value === value);
  return (
    <select id={id} className="select" aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {!known && <option value={value}>{value} min</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Stepper({ value, min, max, onChange, label, unit }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; unit?: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output aria-live="polite">
        {value}
        {unit && <span className="muted"> {unit}</span>}
      </output>
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

export function Swatches({ value, colors, onChange, label }: { value: string; colors: string[]; onChange: (v: string) => void; label: string }) {
  const id = useId();
  return (
    <div className="swatches" role="radiogroup" aria-labelledby={id}>
      <span id={id} className="sr-only">
        {label}
      </span>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c.toLowerCase() === value.toLowerCase()}
          aria-label={`${label} ${c}`}
          className="swatch"
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}

export function Notice({ kind, children, onClose }: { kind: 'success' | 'error' | 'info'; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <div>{children}</div>
      {onClose && (
        <button type="button" className="icon-btn" aria-label="Dismiss" onClick={onClose}>
          ×
        </button>
      )}
    </div>
  );
}
