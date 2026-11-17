import { BODY_MODES } from '../engine/anatomy';
import { UNIFORMS } from '../engine/constants';
import { useStore } from '../state/store';

export function Inspector() {
  const plan = useStore((s) => s.plan);
  const settings = plan.settings;
  const timeline = useStore((s) => s.timeline);
  const setSettings = useStore((s) => s.setSettings);
  const setHeight = useStore((s) => s.setHeight);
  const regenerate = useStore((s) => s.regenerateHeights);
  const showGrid = useStore((s) => s.showGrid);
  const toggleGrid = useStore((s) => s.toggleGrid);
  const showTrails = useStore((s) => s.showTrails);
  const toggleTrails = useStore((s) => s.toggleTrails);
  const body = useStore((s) => s.body);
  const setBody = useStore((s) => s.setBody);

  const cadets = timeline.soldiers.filter((s) => s.role === 'cadet' || s.role === 'marker');
  const warnings = dedupe(timeline.warnings.filter((w) => w.severity !== 'info'));

  return (
    <aside className="panel inspector">
      <div className="panel-head">
        <h2>Parade setting</h2>
      </div>
      <div className="inspector-body">
        <Section title="Parade square">
          <NumField label="Width" value={settings.squareWidth} min={6} max={90} step={0.5} unit="m" onChange={(v) => setSettings({ squareWidth: v })} />
          <NumField label="Depth" value={settings.squareDepth} min={6} max={90} step={0.5} unit="m" onChange={(v) => setSettings({ squareDepth: v })} />
          <NumField label="Start from rear edge" value={settings.startPacesFromEdge} min={1} max={30} step={1} unit="paces" onChange={(v) => setSettings({ startPacesFromEdge: v })} />
          <Select
            label="Facing"
            value={String(settings.headingDeg)}
            options={[
              { value: '0', label: 'Front (+Z)' },
              { value: '90', label: 'Right flank' },
              { value: '180', label: 'Rear' },
              { value: '270', label: 'Left flank' },
            ]}
            onChange={(v) => setSettings({ headingDeg: Number(v) })}
          />
          <div className="row toggles">
            <label className="check">
              <input type="checkbox" checked={showGrid} onChange={toggleGrid} /> 2D grid
            </label>
            <label className="check">
              <input type="checkbox" checked={showTrails} onChange={toggleTrails} /> trails
            </label>
          </div>
        </Section>

        <Section title="Platoon">
          <Slider label="Strength" value={settings.strength} min={1} max={90} step={1} onChange={(v) => setSettings({ strength: v })} hint={`${cadets.length} on parade`} />
          <NumField label="Squads" value={settings.squads} min={1} max={6} step={1} onChange={(v) => setSettings({ squads: v })} />
          <Select
            label="Ranks"
            value={String(settings.ranks)}
            options={[
              { value: '3', label: 'Three ranks' },
              { value: '2', label: 'Two ranks' },
            ]}
            onChange={(v) => setSettings({ ranks: Number(v) === 2 ? 2 : 3 })}
          />
          <NumField label="File interval" value={settings.intervalPaces} min={0.8} max={2} step={0.05} unit="paces" onChange={(v) => setSettings({ intervalPaces: v })} />
          <NumField label="Rank spacing" value={settings.rankSpacingPaces} min={0.6} max={3} step={0.05} unit="paces" onChange={(v) => setSettings({ rankSpacingPaces: v })} />
          <NumField label="Squad interval" value={settings.squadGapPaces} min={0} max={12} step={0.5} unit="paces" onChange={(v) => setSettings({ squadGapPaces: v })} />
          <div className="row toggles">
            <label className="check">
              <input type="checkbox" checked={settings.openOrder} onChange={(e) => setSettings({ openOrder: e.target.checked })} /> open order
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.commander} onChange={(e) => setSettings({ commander: e.target.checked })} /> commander
            </label>
            <label className="check">
              <input type="checkbox" checked={settings.supernumerary} onChange={(e) => setSettings({ supernumerary: e.target.checked })} /> WO rank
            </label>
          </div>
        </Section>

        <Section title="Dress &amp; equipment">
          <Select
            label="Uniform"
            value={settings.uniform}
            options={Object.entries(UNIFORMS).map(([key, value]) => ({ value: key, label: value.label }))}
            onChange={(v) => setSettings({ uniform: v as typeof settings.uniform })}
          />
          <Select
            label="Colours"
            value={String(settings.colours)}
            options={[
              { value: '0', label: 'No colour party' },
              { value: '1', label: 'One colour (officer + 2 escorts)' },
              { value: '2', label: 'Two colours (2 officers, WO, 2 escorts)' },
            ]}
            onChange={(v) => setSettings({ colours: Number(v) as 0 | 1 | 2 })}
          />
          <label className="check">
            <input type="checkbox" checked={settings.armed} onChange={(e) => setSettings({ armed: e.target.checked })} /> rifles issued (Lee-Enfield drill)
          </label>
          <Select
            label="Cadence"
            value={String(settings.cadence)}
            options={[
              { value: '120', label: '120 ppm — quick time' },
              { value: '140', label: '140 ppm — recruit quick time' },
            ]}
            onChange={(v) => setSettings({ cadence: Number(v) })}
          />
          <div className="uniform-swatches">
            {Object.entries(UNIFORMS).map(([key, palette]) => (
              <button
                key={key}
                className={`swatch${settings.uniform === key ? ' on' : ''}`}
                onClick={() => setSettings({ uniform: key as typeof settings.uniform })}
                title={palette.label}
              >
                <span style={{ background: palette.tunic }} />
                <span style={{ background: palette.trousers }} />
                <span style={{ background: palette.beret }} />
              </button>
            ))}
          </div>
        </Section>

        <Section title="Anatomy">
          <div className="body-modes">
            {BODY_MODES.map((mode) => (
              <button
                key={mode.value}
                className={`ghost${body === mode.value ? ' on' : ''}`}
                onClick={() => setBody(mode.value)}
                title={mode.hint}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <p className="muted small anatomy-copy">
            Uniform, bones and muscles are posed by one joint model: hips, knees, ankles, shoulders, elbows,
            wrists, cervical and thoracic spine, each clamped to its physiological range. Mark time lifts the
            thigh to horizontal (90° hip, 90° knee); quick march keeps the knee straight and lifts the foot.
          </p>
        </Section>

        <Section title={`Heights — tallest on the right (${cadets.length})`}>
          <div className="row">
            <button className="ghost" onClick={regenerate}>
                Re-randomise heights
            </button>
            <span className="muted small">seeded</span>
          </div>
          <div className="height-list">
            {cadets.map((soldier) => (
              <label key={soldier.id} className="height-row">
                <span>{soldier.name.replace(' · marker', '')}</span>
                <input
                  type="number"
                  min={1.45}
                  max={2.02}
                  step={0.01}
                  value={soldier.height.toFixed(2)}
                  onChange={(event) => setHeight(soldier.id, Number(event.target.value))}
                />
              </label>
            ))}
          </div>
        </Section>

        <Section title={`Validation${warnings.length ? ` — ${warnings.length}` : ''}`}>
          {!warnings.length && <p className="ok small">No conflicts. The programme matches the manual’s preconditions.</p>}
          <ul className="warning-list">
            {warnings.slice(0, 8).map((warning, i) => (
              <li key={`${warning.message}-${i}`} className={warning.severity}>
                <span className="warning-move">
                  {warning.moveIndex >= 0 ? String(warning.moveIndex + 1).padStart(2, '0') : '—'}
                </span>
                {warning.message}
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </aside>
  );
}

function dedupe(warnings: { message: string; severity: string; moveIndex: number }[]) {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    if (seen.has(w.message)) return false;
    seen.add(w.message);
    return true;
  });
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="section">
      <h3 dangerouslySetInnerHTML={{ __html: title }} />
      {children}
    </section>
  );
}

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="field-input">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        {unit && <em>{unit}</em>}
      </span>
    </label>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <label className="field slider-field">
      <span>
        {label} <b>{value}</b>
        {hint && <em className="hint">{hint}</em>}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
