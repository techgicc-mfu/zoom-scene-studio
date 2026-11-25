import React from 'react';
import { getEffectDefinition } from '../data/effectCatalog';
import { applyVp1Curve } from '../midi/chocolateProtocol';
import { useRigStore } from '../store/rigStore';
import { Vp1CurveType } from '../types/rig';

export const ExpressionBar: React.FC = () => {
  const rig = useRigStore((s) => s.rigs[s.activeRigIndex]);
  const liveFootCc = useRigStore((s) => s.liveFootCc);
  const setExpression = useRigStore((s) => s.setExpression);

  const exp = rig.expression;
  const chainA = rig.scenes.A;

  // Build plain-English options from the current rig's 5 pedals (MS-50G Slots 2..6)
  const targetOptions: Array<{ key: string; slot: number; param: number; label: string }> = [
    { key: '0:1', slot: 0, param: 1, label: 'Off (Expression Pedal Disabled for This Rig)' },
  ];

  chainA.forEach((pedal, pedalIdx) => {
    const msSlot = pedalIdx + 2; // Slots 2..6
    const def = getEffectDefinition(pedal.fxid);
    if (def) {
      def.params.forEach((p, pIdx) => {
        targetOptions.push({
          key: `${msSlot}:${pIdx + 1}`,
          slot: msSlot,
          param: pIdx + 1,
          label: `Pedal ${pedalIdx + 1} (${def.shortName}) → ${p.name}`,
        });
      });
    } else {
      [1, 2, 3].forEach((pNum) => {
        targetOptions.push({
          key: `${msSlot}:${pNum}`,
          slot: msSlot,
          param: pNum,
          label: `Pedal ${pedalIdx + 1} (Custom #${pedal.fxid}) → Knob ${pNum}`,
        });
      });
    }
  });

  const selectedKey = exp.targetSlot === 0 ? '0:1' : `${exp.targetSlot}:${exp.targetParam}`;
  const effectivePct = applyVp1Curve(liveFootCc, exp.curve, exp.minPct, exp.maxPct);

  return (
    <section className="expression-bar" aria-label="Salfini VP-1 Expression Settings">
      <div className="exp-main-row">
        <div className="exp-target-group">
          <label htmlFor="vp1-target-select">
            🦶 <strong>Salfini VP-1 Expression Pedal Sweeps:</strong>
          </label>
          <select
            id="vp1-target-select"
            className="exp-select"
            value={selectedKey}
            onChange={(e) => {
              const [s, p] = e.target.value.split(':').map(Number);
              setExpression({ targetSlot: s, targetParam: p });
            }}
          >
            {targetOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {exp.targetSlot !== 0 && (
          <div className="exp-range-group">
            <label>
              Heel Min: <strong>{exp.minPct}%</strong>
              <input
                type="range"
                min={0}
                max={100}
                value={exp.minPct}
                onChange={(e) => setExpression({ minPct: Number(e.target.value) })}
              />
            </label>
            <label>
              Toe Max: <strong>{exp.maxPct}%</strong>
              <input
                type="range"
                min={0}
                max={100}
                value={exp.maxPct}
                onChange={(e) => setExpression({ maxPct: Number(e.target.value) })}
              />
            </label>
            <label>
              Feel / Taper:
              <select
                value={exp.curve}
                onChange={(e) => setExpression({ curve: e.target.value as Vp1CurveType })}
              >
                <option value="vp1">Salfini VP-1 Smooth Fix (Recommended)</option>
                <option value="swell">Sunday Worship Swell Taper</option>
                <option value="linear">Standard Linear</option>
              </select>
            </label>
          </div>
        )}
      </div>

      <div className="exp-footer-row">
        <div className="exp-live-meter" title="Live reading when Chocolate Plus + Salfini VP-1 are connected">
          <span>Live Foot Position: {effectivePct}%</span>
          <div className="exp-meter-track">
            <div className="exp-meter-fill" style={{ width: `${effectivePct}%` }} />
          </div>
        </div>
        <div className="foot-legend">
          Chocolate Plus Foot Guide: <strong>Tap A–D</strong> = Scenes A–D ·{' '}
          <strong>Hold A / B</strong> = Prev / Next Gig Rig (01–12) ·{' '}
          <strong>Hold C</strong> = Silent Tuner · <strong>Hold D</strong> = Tap Tempo
        </div>
      </div>
    </section>
  );
};
