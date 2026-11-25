import React from 'react';
import {
  CATEGORY_META,
  EFFECT_CATALOG,
  getEffectDefinition,
} from '../data/effectCatalog';
import { useRigStore } from '../store/rigStore';
import { EffectCategory } from '../types/rig';

const CATEGORY_ORDER: EffectCategory[] = [
  'comp',
  'pedal',
  'drive',
  'amp',
  'mod',
  'delay',
  'reverb',
];

export const PedalBoard: React.FC = () => {
  const rig = useRigStore((s) => s.rigs[s.activeRigIndex]);
  const activeScene = useRigStore((s) => s.activeScene);
  const togglePedal = useRigStore((s) => s.togglePedal);
  const setPedalParam = useRigStore((s) => s.setPedalParam);
  const setPedalModel = useRigStore((s) => s.setPedalModel);

  const currentChain = rig.scenes[activeScene];
  const baselineChainA = rig.scenes.A;

  return (
    <section className="pedalboard-grid" aria-label="5-Pedal Signal Chain">
      {currentChain.map((slot, pedalIdx) => {
        const baseSlotA = baselineChainA[pedalIdx];
        const def = getEffectDefinition(slot.fxid);
        const categoryInfo = def
          ? CATEGORY_META[def.category]
          : { label: 'Custom Effect', color: '#94a3b8', badgeBg: '#334155' };

        const enabledDiffers = activeScene !== 'A' && slot.enabled !== baseSlotA.enabled;

        // Determine raw indices to show for uncatalogued custom pedals (minimum 3, plus any active >2)
        const rawVisibleIndices = def
          ? []
          : [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(
              (idx) => idx < 3 || (slot.params[idx] ?? 0) !== 0 || (baseSlotA.params[idx] ?? 0) !== 0
            );

        return (
          <div
            key={pedalIdx}
            className={`stompbox-card ${slot.enabled ? 'stompbox-on' : 'stompbox-off'}`}
            style={{ borderTopColor: categoryInfo.color }}
          >
            {/* Top Header: Slot Position + On/Off Footswitch Toggle */}
            <div className="stompbox-header">
              <span
                className="stompbox-category-pill"
                style={{ backgroundColor: categoryInfo.badgeBg, color: '#f8fafc' }}
              >
                PEDAL {pedalIdx + 1} · {categoryInfo.label}
              </span>
              <button
                type="button"
                onClick={() => togglePedal(pedalIdx)}
                className={`stompbox-led-btn ${slot.enabled ? 'led-lit' : 'led-dim'}`}
                aria-label={`Toggle ${def ? def.shortName : `Custom Pedal (#${slot.fxid})`}`}
              >
                <span className="led-dot" />
                {slot.enabled ? 'ON' : 'OFF'}
                {enabledDiffers && <span className="diff-star" title="Changed from Scene A"> ★</span>}
              </button>
            </div>

            {/* Model Picker: keeps Custom Pedal (#fxid) selectable & swappable to any catalog effect */}
            {!def && (
              <div className="custom-pedal-banner">
                <strong>Custom Pedal (#{slot.fxid})</strong>
                <span className="custom-pedal-sub">
                  Preserved safely from your MS-50G (swap below anytime)
                </span>
              </div>
            )}
            <select
              aria-label={`Select effect model for Pedal ${pedalIdx + 1}`}
              className="stompbox-model-select"
              value={slot.fxid}
              onChange={(e) => setPedalModel(pedalIdx, Number(e.target.value))}
            >
              {!def && (
                <option value={slot.fxid}>
                  Custom Pedal (#{slot.fxid}) — Preserved
                </option>
              )}
              {CATEGORY_ORDER.map((cat) => (
                <optgroup key={cat} label={CATEGORY_META[cat].label}>
                  {EFFECT_CATALOG.filter((fx) => fx.category === cat).map((fx) => (
                    <option key={fx.fxid} value={fx.fxid}>
                      {fx.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            {/* Knobs / Sliders */}
            <div className="stompbox-knobs">
              {def
                ? def.params.map((pSpec, pIdx) => {
                    const val = slot.params[pIdx] ?? pSpec.defaultValue;
                    const valA = baseSlotA.params[pIdx] ?? pSpec.defaultValue;
                    const paramDiffers = activeScene !== 'A' && val !== valA;
                    const showTimeWarning = Boolean(pSpec.warnOnSceneDiff && paramDiffers);

                    return (
                      <div
                        key={pSpec.name}
                        className={`knob-row ${paramDiffers ? 'knob-row-changed' : ''}`}
                      >
                        <div className="knob-label-line">
                          <span className="knob-name">
                            {pSpec.name}
                            {paramDiffers && (
                              <span className="diff-star" title={`Scene A is ${valA}`}> ★</span>
                            )}
                          </span>
                          <span className="knob-val">
                            {val}
                            {pSpec.unit ? ` ${pSpec.unit}` : ''}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={pSpec.min}
                          max={Math.max(pSpec.max, val)}
                          value={val}
                          aria-label={`${def.shortName} ${pSpec.name}`}
                          onChange={(e) => setPedalParam(pedalIdx, pIdx, Number(e.target.value))}
                        />
                        {showTimeWarning && (
                          <div className="delay-time-warning">
                            ⚠ Changing Delay Time mid-echo briefly warps pitch (keep Time at {valA} ms for seamless trails).
                          </div>
                        )}
                      </div>
                    );
                  })
                : rawVisibleIndices.map((pIdx) => {
                    const val = slot.params[pIdx] ?? 0;
                    const valA = baseSlotA.params[pIdx] ?? 0;
                    const paramDiffers = activeScene !== 'A' && val !== valA;
                    const safeMax = Math.max(150, val, valA);
                    return (
                      <div key={pIdx} className={`knob-row ${paramDiffers ? 'knob-row-changed' : ''}`}>
                        <div className="knob-label-line">
                          <span className="knob-name">
                            Knob {pIdx + 1}
                            {paramDiffers && <span className="diff-star"> ★</span>}
                          </span>
                          <span className="knob-val">{val}</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={safeMax}
                          value={val}
                          aria-label={`Custom #${slot.fxid} Knob ${pIdx + 1}`}
                          onChange={(e) => setPedalParam(pedalIdx, pIdx, Number(e.target.value))}
                        />
                      </div>
                    );
                  })}
            </div>
          </div>
        );
      })}
    </section>
  );
};
