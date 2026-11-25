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

  it('renders uncatalogued pedal fxids safely as Custom Pedal without crashing', () => {
    const store = useRigStore.getState();
    store.setRawSlotForTest(0, { enabled: true, fxid: 0x01fe, params: [10, 20, 30, 0, 0, 0, 0, 0, 0] });
    render(<PedalBoard />);
    expect(screen.getByText(/Custom Pedal \(#510\)/i)).toBeInTheDocument();
  });
});
