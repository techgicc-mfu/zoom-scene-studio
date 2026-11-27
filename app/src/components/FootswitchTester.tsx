import React, { useEffect, useState } from 'react';
import { describeFootswitchMessage } from '../midi/chocolateProtocol';
import { webMidiService } from '../midi/webMidiService';

interface FootswitchTesterProps {
  isOpen: boolean;
  chocolateConnected: boolean;
  onClose: () => void;
}

interface LogEntry {
  id: number;
  label: string;
  expected: boolean;
}

const SWITCHES = ['A', 'B', 'C', 'D'] as const;

/**
 * Live view of what the Chocolate Plus actually sends over USB. Press each switch (tap and hold):
 * every tap should light its own switch and say "Scene A/B/C/D". A switch that stays dark, or shows
 * "Unexpected", did not take Scene Studio's settings.
 */
export const FootswitchTester: React.FC<FootswitchTesterProps> = ({
  isOpen,
  chocolateConnected,
  onClose,
}) => {
  const [log, setLog] = useState<LogEntry[]>([]);
  const [seen, setSeen] = useState<Record<number, boolean>>({});
  const [flash, setFlash] = useState<number | null>(null);
  const [expr, setExpr] = useState<number | null>(null);
  const [exprMin, setExprMin] = useState(127);
  const [exprMax, setExprMax] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    let nextId = 0;
    const unsub = webMidiService.onChocolateMidi((data) => {
      const info = describeFootswitchMessage(data[0], data[1] ?? 0, data[2] ?? 0);
      if ((data[0] & 0xf0) === 0xb0 && (data[1] === 16 || data[1] === 11)) {
        const v = data[2] ?? 0; // expression pedal: shown as a live bar, not logged (sweeps are noisy)
        setExpr(v);
        setExprMin((m) => Math.min(m, v));
        setExprMax((m) => Math.max(m, v));
        return;
      }
      setLog((prev) => [{ id: nextId++, label: info.label, expected: info.expected }, ...prev].slice(0, 12));
      if (info.switchIndex !== null && info.expected) {
        const sw = info.switchIndex;
        setSeen((prev) => ({ ...prev, [sw]: true }));
        setFlash(sw);
        setTimeout(() => setFlash((f) => (f === sw ? null : f)), 400);
      }
    });
    return unsub;
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Footswitch Tester">
      <div className="modal-panel">
        <div className="modal-header">
          <h2>🦶 Chocolate Plus Footswitch Test</h2>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <p className="modal-intro">
          {chocolateConnected
            ? 'Tap A, B, C and D, then hold each one. Every tap should light its switch and read "Scene A/B/C/D". A switch that stays dark or shows "Unexpected" did not take the settings — click Program Chocolate Plus and test again.'
            : 'Plug the Chocolate Plus in over USB (side switch on U) and click Scan USB first.'}
        </p>
        <div style={{ display: 'flex', gap: 12, margin: '12px 0' }}>
          {SWITCHES.map((name, i) => (
            <div
              key={name}
              data-testid={`fs-${name}`}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '14px 0',
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 20,
                border: '2px solid',
                borderColor: seen[i] ? '#3fb950' : '#555',
                background: flash === i ? '#3fb950' : 'transparent',
                color: flash === i ? '#000' : seen[i] ? '#3fb950' : '#aaa',
                transition: 'background 120ms',
              }}
            >
              {name}
              <div style={{ fontSize: 11, fontWeight: 400 }}>{seen[i] ? 'OK' : 'not seen yet'}</div>
            </div>
          ))}
        </div>
        <div data-testid="fs-expr" style={{ margin: '4px 0 14px' }}>
          <div style={{ fontSize: 13, marginBottom: 4 }}>
            Expression pedal (move it heel to toe):{' '}
            <b>{expr === null ? 'not seen yet' : `${expr} / 127`}</b>
            {expr !== null && (
              <span style={{ color: exprMax - exprMin > 100 ? '#3fb950' : '#f0883e' }}>
                {' '}· range seen {exprMin}–{exprMax}
                {exprMax - exprMin > 100 ? ' ✓ full sweep' : ' (keep sweeping to the ends)'}
              </span>
            )}
          </div>
          <div style={{ height: 12, borderRadius: 6, background: '#2a2f3a', overflow: 'hidden' }}>
            <div style={{ width: `${((expr ?? 0) / 127) * 100}%`, height: '100%', background: '#3fb950' }} />
          </div>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontFamily: 'monospace', fontSize: 13 }}>
          {log.length === 0 && <li style={{ color: '#888' }}>Waiting for a footswitch press…</li>}
          {log.map((e) => (
            <li key={e.id} style={{ color: e.expected ? '#3fb950' : '#f0883e', padding: '2px 0' }}>
              {e.expected ? '✓' : '⚠'} {e.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
