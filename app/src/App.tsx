import React, { useEffect, useState } from 'react';
import { ExpressionBar } from './components/ExpressionBar';
import { PedalBoard } from './components/PedalBoard';
import { RigSidebar } from './components/RigSidebar';
import { SceneStrip } from './components/SceneStrip';
import { SetupGuideModal } from './components/SetupGuideModal';
import { TopSyncBar } from './components/TopSyncBar';
import { webMidiService } from './midi/webMidiService';
import { useRigStore } from './store/rigStore';
import { SyncProgress } from './types/rig';
import './index.css';

export const App: React.FC = () => {
  const rigs = useRigStore((s) => s.rigs);
  const setLiveFootCc = useRigStore((s) => s.setLiveFootCc);

  const [zoomConnected, setZoomConnected] = useState(false);
  const [chocolateConnected, setChocolateConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    'Plug your MS-50G and Chocolate Plus (switch on U) into USB, then click Scan USB.'
  );
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    const unsub = webMidiService.onExpressionSweep((ccVal) => {
      setLiveFootCc(ccVal);
    });
    return unsub;
  }, [setLiveFootCc]);

  const handleScanUsb = async () => {
    setSyncProgress(null);
    const res = await webMidiService.connect();
    setZoomConnected(res.zoomConnected);
    setChocolateConnected(res.chocolateConnected);
    setStatusMessage(res.userMessage);
  };

  const handleSyncAll = async () => {
    const res = await webMidiService.syncAllToHardware(rigs, (prog) => {
      setSyncProgress(prog);
    });
    setStatusMessage(res.userMessage);
  };

  return (
    <div className="studio-shell">
      <TopSyncBar
        zoomConnected={zoomConnected}
        chocolateConnected={chocolateConnected}
        statusMessage={statusMessage}
        syncProgress={syncProgress}
        onScanUsb={handleScanUsb}
        onOpenSetupGuide={() => setGuideOpen(true)}
        onSyncAll={handleSyncAll}
        onStatusToast={(msg) => {
          setSyncProgress(null);
          setStatusMessage(msg);
        }}
      />

      <div className="studio-workspace">
        <RigSidebar />

        <main className="studio-stage">
          <SceneStrip />
          <PedalBoard />
          <ExpressionBar />
        </main>
      </div>

      <SetupGuideModal isOpen={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
};

export default App;
