import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useRigStore } from '../../store/rigStore';
import { SceneStrip } from '../SceneStrip';
import { PedalBoard } from '../PedalBoard';

describe('Real Pedalboard UX', () => {
  beforeEach(() => {
    useRigStore.getState().resetToDefaults();
  });

  afterEach(() => {
    cleanup();
  });

  it('switches scenes A->D, moves pedal knobs, and marks scene-modified knobs with ★ without showing MIDI hex', () => {
    render(
      <div>
        <SceneStrip />
        <PedalBoard />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: /SWITCH D/i }));
    expect(useRigStore.getState().activeScene).toBe('D');
    expect(screen.getAllByText(/★/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/F0 52|Patch 13|CC 15/);
  });

  it('renders uncatalogued pedal fxids safely as Custom Pedal with model swap select & unclamped >150 values', () => {
    const store = useRigStore.getState();
    store.setRawSlotForTest(0, { enabled: true, fxid: 0x09999999, params: [511, 20, 30, 88, 0, 0, 0, 0, 0] });
    render(<PedalBoard />);
    expect(screen.getAllByText(/Custom Pedal \(#161061273\)/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('combobox', { name: /Select effect model for Pedal 1/i })).toBeInTheDocument();
    const knob1 = screen.getByRole('slider', { name: /Custom .* Knob 1/i }) as HTMLInputElement;
    expect(Number(knob1.max)).toBeGreaterThanOrEqual(511);
    expect(Number(knob1.value)).toBe(511);
  });

  it('rejects malformed JSON rig pack imports without bricking store and clamps stale expression targetParam on model swap', () => {
    const store = useRigStore.getState();
    const badRes = store.importRigPackJson(JSON.stringify(new Array(12).fill({ name: 'bad' })));
    expect(badRes.ok).toBe(false);
    // Swapping amp at Pedal 3 (Slot 4) to 2-knob effect resets targetParam=6 back to valid range
    store.setExpression({ targetSlot: 4, targetParam: 6 });
    store.setPedalModel(2, 0x060001a0); // StonePha has 2 params
    expect(useRigStore.getState().rigs[0].expression.targetParam).toBeLessThanOrEqual(2);
  });
});
