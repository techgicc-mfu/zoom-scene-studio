import React from 'react';
import { DSP_LIMIT, rigDsp } from '../data/dspCost';
import { getEffectDefinition } from '../data/effectCatalog';
import { useRigStore } from '../store/rigStore';

/** Estimated DSP use of the active rig (Zoom's power chart). Effects cost the same whether on or off. */
export const DspMeter: React.FC = () => {
  const rig = useRigStore((s) => s.rigs[s.activeRigIndex]);
  const dsp = rigDsp(rig);
  const pct = Math.min(100, Math.round((dsp.total / DSP_LIMIT) * 100));
  const level = dsp.total > DSP_LIMIT ? 'over' : dsp.total >= 85 ? 'high' : dsp.total >= 65 ? 'mid' : 'ok';
  const heaviest = dsp.slots
    .map((s, i) => ({ s, name: getEffectDefinition(rig.scenes.A[i].fxid)?.shortName ?? `Pedal ${i + 1}` }))
    .sort((a, b) => b.s.cost - a.s.cost)[0];
  return (
    <div className={`dsp-meter dsp-${level}`} title="Estimated from Zoom's published effect power chart. The pedal's own DSP limit decides what really fits.">
      <span className="dsp-label">DSP ≈ {dsp.total}{dsp.exact ? '' : '*'} / {DSP_LIMIT}</span>
      <span className="dsp-bar"><span className="dsp-fill" style={{ width: `${pct}%` }} /></span>
      <span className="dsp-hint">
        {level === 'over'
          ? `Over the limit: the pedal may bypass an effect or glitch. Heaviest: ${heaviest.name} (${heaviest.s.cost}).`
          : level === 'high'
            ? `Close to the limit. Heaviest: ${heaviest.name} (${heaviest.s.cost}).`
            : `Heaviest: ${heaviest.name} (${heaviest.s.cost}).`}
        {dsp.exact ? '' : ' *some effects estimated'}
      </span>
    </div>
  );
};
