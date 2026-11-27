import React from 'react';
import { generateChocolateFcpBlob } from '../midi/chocolateProtocol';
import { useRigStore } from '../store/rigStore';

interface SetupGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SetupGuideModal: React.FC<SetupGuideModalProps> = ({ isOpen, onClose }) => {
  const liveFootCc = useRigStore((s) => s.liveFootCc);

  if (!isOpen) return null;

  const handleDownloadFcp = () => {
    const bytes = generateChocolateFcpBlob(1);
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SceneStudio-ChocolatePlus.fcp';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Wireless and Hardware Setup Guide">
      <div className="modal-panel">
        <div className="modal-header">
          <h2>⚡ Plug-and-Play Hardware & Wireless Setup Guide</h2>
          <button type="button" className="modal-close-btn" onClick={onClose}>
            ✕ Close
          </button>
        </div>

        <p className="modal-intro">
          Follow these one-time steps once (the full plain-English guide is in docs/TUTORIAL.md). After that, you just dial tones on your Pedalboard,
          click <strong>SYNC ALL TO PEDALS</strong>, unplug from your PC, and play wirelessly!
        </p>

        <div className="guide-cards-grid">
          {/* Card 1 */}
          <div className="guide-card">
            <div className="guide-step-badge">ONE-TIME STEP 1</div>
            <h3>Zoom MS-50G Firmware & SCENE.ZDL</h3>
            <ol>
              <li>
                Run <code>scripts\build-firmware.ps1</code> in this project folder to build{' '}
                <code>dist\SCENE.ZDL</code> and the 12-Rig patches for <strong>MIDISTOMP V2.0</strong>.
              </li>
              <li>
                Hold <strong>UP + DOWN</strong> on your MS-50G while plugging in Mini-USB, and flash
                the MIDISTOMP V2.0 updater once (your stock MS-50G amps & drives stay intact).
              </li>
              <li>
                Open <strong>Zoom Effect Manager</strong> and add <code>dist\SCENE.ZDL</code> onto your pedal.
              </li>
            </ol>
          </div>

          {/* Card 2 */}
          <div className="guide-card">
            <div className="guide-step-badge">ONE-TIME STEP 2</div>
            <h3>Wireless MIDI-B Host Mode & Stage Cable</h3>
            <ol>
              <li>
                Plug your M-Vave <strong>MIDI-B</strong> USB stick into power, open the{' '}
                <strong>CubeSuite</strong> phone app over Bluetooth, and switch MIDI-B from{' '}
                <em>Device/OTG</em> to <strong>Host Mode</strong> (it remembers this permanently!).
              </li>
              <li>
                <strong>Onstage Wiring:</strong> Connect a <strong>Powered USB OTG Y-Cable</strong>{' '}
                (5V power in + MIDI-B plugged into USB-A female + Mini-USB into your MS-50G).
              </li>
              <li>
                Turn on your <strong>Chocolate Plus</strong> anywhere on stage—it pairs wirelessly
                to MIDI-B automatically!
              </li>
            </ol>
          </div>

          {/* Card 3 */}
          <div className="guide-card">
            <div className="guide-step-badge">STEP 3 · CONTROLLER & VP-1</div>
            <h3>Chocolate Plus & Salfini VP-1 Pedal</h3>
            <ol>
              <li>
                <strong>Salfini VP-1 Wiring:</strong> Leave the VP-1 <code>INPUT</code> jack{' '}
                <strong>empty</strong>! Plug a <strong>1/4" Stereo TRS cable</strong> (2 black rings)
                from VP-1 <code>OUTPUT</code> into the Chocolate Plus <code>PEDAL</code> jack.
              </li>
              <li>
                When plugging Chocolate Plus into your PC to sync, set its side switch to{' '}
                <strong>U</strong>. Clicking <em>Sync All</em> configures Expression Mode + Short/Long
                switches automatically.
              </li>
              <li>
                Want to load the full switch map in CubeSuite too? Click below for a ready-made preset:
              </li>
            </ol>
            <div className="guide-card-actions">
              <button type="button" className="fcp-download-btn" onClick={handleDownloadFcp}>
                ⬇ Download .fcp Preset for CubeSuite
              </button>
              <span className="live-raw-readout">
                Incoming USB Pedal Raw Value: <strong>{liveFootCc} / 127</strong>
              </span>
            </div>
          </div>

          {/* Card 4 */}
          <div className="guide-card">
            <div className="guide-step-badge">IF SOMETHING GOES WRONG</div>
            <h3>Quick Fixes</h3>
            <ol>
              <li>
                <strong>Chocolate Plus did not confirm:</strong> unplug its USB, side switch on <strong>U</strong>,
                replug, click <em>Scan USB</em>, then <em>Program Chocolate Plus</em>.
              </li>
              <li>
                <strong>Expression pedal does nothing:</strong> use a <strong>stereo TRS</strong> cable (two black
                rings), VP-1 <code>OUTPUT</code> to the Chocolate Plus <code>PEDAL</code> jack, then check the
                bar in <em>Footswitch Test</em>.
              </li>
              <li>
                <strong>Crackling:</strong> watch the <strong>DSP meter</strong>. Near 100 means swap the
                heaviest effect (big reverbs and amps) for a lighter one.
              </li>
              <li>
                <strong>Pedal not found:</strong> use Chrome or Edge, close other MIDI programs, use a data USB cable.
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};
