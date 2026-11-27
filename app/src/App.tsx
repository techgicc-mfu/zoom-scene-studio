import React, { useEffect, useState } from 'react';
import { ExpressionBar } from './components/ExpressionBar';
import { DeviceLibrary } from './components/DeviceLibrary';
import { FootswitchTester } from './components/FootswitchTester';
import { PedalBoard } from './components/PedalBoard';
import { AuditionBar } from './components/AuditionBar';
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
  const loadRigsFromPedal = useRigStore((s) => s.loadRigsFromPedal);

  const [zoomConnected, setZoomConnected] = useState(false);
  const [chocolateConnected, setChocolateConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    'Plug your MS-50G and Chocolate Plus (switch on U) into USB, then click Scan USB.'
  );
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [footTestOpen, setFootTestOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  useEffect(() => {
    const unsubExp = webMidiService.onExpressionSweep((ccVal) => {
      setLiveFootCc(ccVal);
    });
    const unsubConn = webMidiService.onConnectionChange((status) => {
      setZoomConnected(status.zoomConnected);
      setChocolateConnected(status.chocolateConnected);
    });
    return () => {
      unsubExp();
      unsubConn();
    };
  }, [setLiveFootCc]);

  const handleScanUsb = async () => {
    setSyncProgress(null);
    const res = await webMidiService.connect();
    setZoomConnected(res.zoomConnected);
    setChocolateConnected(res.chocolateConnected);
    setStatusMessage(res.userMessage);
  };

  const handleReadFromPedal = async () => {
    const res = await webMidiService.readAllFromHardware((prog) => {
      setSyncProgress(prog);
    });
    if (res.ok && res.rigs) {
      // Safety net: keep a copy of the rigs about to be replaced.
      try {
        const url = URL.createObjectURL(new Blob([useRigStore.getState().exportRigPackJson()], { type: 'application/json' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = 'MS50G-SceneStudio-BeforeRead-Backup.json';
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // backup is best-effort
      }
      loadRigsFromPedal(res.rigs);
    }
    setStatusMessage(res.userMessage);
  };

  const handleSyncAll = async () => {
    const res = await webMidiService.syncAllToHardware(rigs, (prog) => {
      setSyncProgress(prog);
    });
    setStatusMessage(res.userMessage);
  };

  const handleProgramChocolate = async () => {
    const res = await webMidiService.configureChocolateOnly((prog) => {
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
        onReadFromPedal={handleReadFromPedal}
        onOpenSetupGuide={() => setGuideOpen(true)}
        onSyncAll={handleSyncAll}
        onProgramChocolate={handleProgramChocolate}
        onOpenFootswitchTest={() => setFootTestOpen(true)}
        onOpenLibrary={() => setLibraryOpen(true)}
        onStatusToast={(msg) => {
          setSyncProgress(null);
          setStatusMessage(msg);
        }}
      />

      <div className="studio-workspace">
        <RigSidebar />

        <main className="studio-stage">
          <SceneStrip />
          <AuditionBar zoomConnected={zoomConnected} />
          <PedalBoard />
          <ExpressionBar />
        </main>
      </div>

      <SetupGuideModal isOpen={guideOpen} onClose={() => setGuideOpen(false)} />
      <DeviceLibrary
        isOpen={libraryOpen}
        zoomConnected={zoomConnected}
        onClose={() => setLibraryOpen(false)}
        onStatus={setStatusMessage}
      />
      <FootswitchTester
        isOpen={footTestOpen}
        chocolateConnected={chocolateConnected}
        onClose={() => setFootTestOpen(false)}
      />
    </div>
  );
};

export default App;
