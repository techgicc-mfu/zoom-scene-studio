import React, { useRef } from 'react';
import { webMidiService } from '../midi/webMidiService';
import { useRigStore } from '../store/rigStore';
import { SyncProgress } from '../types/rig';

interface TopSyncBarProps {
  zoomConnected: boolean;
  chocolateConnected: boolean;
  statusMessage: string;
  syncProgress: SyncProgress | null;
  onScanUsb: () => void;
  onOpenSetupGuide: () => void;
  onSyncAll: () => void;
  onStatusToast: (msg: string) => void;
}

export const TopSyncBar: React.FC<TopSyncBarProps> = ({
  zoomConnected,
  chocolateConnected,
  statusMessage,
  syncProgress,
  onScanUsb,
  onOpenSetupGuide,
  onSyncAll,
  onStatusToast,
}) => {
  const exportRigPackJson = useRigStore((s) => s.exportRigPackJson);
  const importRigPackJson = useRigStore((s) => s.importRigPackJson);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSaveBackup = () => {
    const json = exportRigPackJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'MS50G-SceneStudio-Rigs.json';
    a.click();
    URL.revokeObjectURL(url);
    onStatusToast('Saved your 12 Gig Rigs to MS50G-SceneStudio-Rigs.json');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const res = importRigPackJson(text);
    if (res.ok) {
      onStatusToast(`Loaded 12 Gig Rigs from ${file.name}`);
      webMidiService.sendScenePreview('A');
    } else {
      onStatusToast(res.error ?? 'Could not load Rig Pack file.');
    }
    e.target.value = '';
  };

  const isSyncing =
    syncProgress !== null && syncProgress.phase !== 'done' && syncProgress.phase !== 'error';

  return (
    <header className="top-sync-bar">
      <div className="top-brand-cluster">
        <span className="brand-title">🎸 MS-50G Scene Studio</span>
        <span className={`conn-pill ${zoomConnected ? 'pill-ok' : 'pill-idle'}`}>
          ● {zoomConnected ? 'MS-50G Connected' : 'MS-50G Not Detected'}
        </span>
        <span className={`conn-pill ${chocolateConnected ? 'pill-ok' : 'pill-idle'}`}>
          ● {chocolateConnected ? 'Chocolate Plus Connected' : 'Chocolate Plus Not Detected'}
        </span>
        <button type="button" className="top-secondary-btn" onClick={onScanUsb}>
          Scan USB
        </button>
      </div>

      <div className="top-actions-cluster">
        <button type="button" className="top-secondary-btn" onClick={handleSaveBackup}>
          Save Rig File
        </button>
        <button
          type="button"
          className="top-secondary-btn"
          onClick={() => fileInputRef.current?.click()}
        >
          Load Rig File
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <button type="button" className="top-guide-btn" onClick={onOpenSetupGuide}>
          ⚡ Wireless & Setup Guide
        </button>
        <button
          type="button"
          className="sync-all-btn"
          disabled={isSyncing}
          onClick={onSyncAll}
        >
          {isSyncing ? 'SYNCING...' : 'SYNC ALL TO PEDALS'}
        </button>
      </div>

      {(statusMessage || syncProgress) && (
        <div className="top-status-strip">
          <span>{syncProgress ? syncProgress.message : statusMessage}</span>
          {syncProgress && syncProgress.total > 0 && (
            <div className="sync-progress-track">
              <div
                className="sync-progress-fill"
                style={{
                  width: `${Math.round((syncProgress.current / syncProgress.total) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      )}
    </header>
  );
};
