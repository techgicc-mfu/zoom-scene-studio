import React, { useEffect, useRef, useState } from 'react';
import { compileScenePreviewPatch } from '../midi/zoomProtocol';
import { webMidiService } from '../midi/webMidiService';
import { useRigStore } from '../store/rigStore';
import { DspMeter } from './DspMeter';

interface Props {
  zoomConnected: boolean;
}

/**
 * Hear the scene you are editing on the pedal before saving or syncing. While active, every edit (knob, on/off, effect model,
 * scene or rig change) re-sends the scene to the pedal's temporary edit buffer. Nothing is stored on the pedal.
 */
export const AuditionBar: React.FC<Props> = ({ zoomConnected }) => {
  const rig = useRigStore((s) => s.rigs[s.activeRigIndex]);
  const activeScene = useRigStore((s) => s.activeScene);
  const [active, setActive] = useState(false);
  const [msg, setMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const res = webMidiService.sendAudition(compileScenePreviewPatch(rig, activeScene));
      setMsg(res.message);
      if (!res.ok) setActive(false);
    }, 200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active, rig, activeScene]);

  useEffect(() => {
    if (!zoomConnected && active) {
      setActive(false);
      setMsg('The pedal was disconnected, so the audition stopped.');
    }
  }, [zoomConnected, active]);

  useEffect(() => () => webMidiService.stopAudition(), []);

  const toggle = () => {
    if (active) {
      webMidiService.stopAudition();
      setActive(false);
      setMsg('Audition stopped. The pedal still holds the last audition until you switch patches on it. Nothing was saved.');
    } else {
      setActive(true);
    }
  };

  return (
    <section className="audition-bar" aria-label="Audition on the pedal">
      <button type="button" className="top-secondary-btn" disabled={!zoomConnected} onClick={toggle}>
        {active ? '■ Stop audition' : '🔊 Audition this scene (not saved)'}
      </button>
      <span className="audition-note">
        {active
          ? `${msg || 'Auditioning...'} Edits are heard as you make them. Scene trim is not included.`
          : msg || (zoomConnected ? 'Plays your current edit on the pedal without saving it.' : 'Connect the MS-50G to audition.')}
      </span>
      <DspMeter />
    </section>
  );
};
