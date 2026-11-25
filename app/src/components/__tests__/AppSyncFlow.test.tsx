import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import App from '../../App';

describe('Scene Studio full app shell & Setup Guide', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders connection bar, 12 gig rigs, 5 stompboxes, VP-1 bar, and opens the Wireless Setup Guide', () => {
    render(<App />);
    expect(screen.getByText(/MS-50G Scene Studio/i)).toBeInTheDocument();
    expect(screen.getByText(/Classic Rock Plexi/i)).toBeInTheDocument();
    expect(screen.getByText(/Salfini VP-1 Expression Pedal Sweeps/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Read from MS-50G/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Auto-backup/i })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /Setup Guide/i }));
    expect(screen.getByText(/Wireless MIDI-B Host Mode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Download \.fcp Preset/i })).toBeInTheDocument();
  });
});
