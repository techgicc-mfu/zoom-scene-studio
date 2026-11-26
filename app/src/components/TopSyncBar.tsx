import React, { useRef, useState } from 'react';
import { webMidiService } from '../midi/webMidiService';
import { useRigStore } from '../store/rigStore';
import { SyncProgress } from '../types/rig';

interface TopSyncBarProps {
  zoomConnected: boolean;
  chocolateConnected: boolean;
  statusMessage: string;
  syncProgress: SyncProgress | null;
  onScanUsb: () => void;
  onReadFromPedal: () => void;
  onOpenSetupGuide: () => void;
  onSyncAll: () => void;
  onProgramChocolate: () => void;
  onOpenFootswitchTest: () => void;
  onStatusToast: (msg: string) => void;
}

export const TopSyncBar: React.FC<TopSyncBarProps> = ({
  zoomConnected,
  chocolateConnected,
  statusMessage,
  syncProgress,
  onScanUsb,
  onReadFromPedal,
  onOpenSetupGuide,
  onSyncAll,
  onProgramChocolate,
  onOpenFootswitchTest,
  onStatusToast,
}) => {
  const exportRigPackJson = useRigStore((s) => s.exportRigPackJson);
  const importRigPackJson = useRigStore((s) => s.importRigPackJson);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [autoBackupBeforeSync, setAutoBackupBeforeSync] = useState(true);

  const downloadJson = (filename: string) => {
    const json = exportRigPackJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveBackup = () => {
    downloadJson('MS50G-SceneStudio-Rigs.json');
    onStatusToast('Saved your 12 Gig Rigs to MS50G-SceneStudio-Rigs.json');
  };

  const handleSyncClick = () => {
    if (autoBackupBeforeSync) {
      downloadJson('MS50G-SceneStudio-PreSync-Backup.json');
    }
    onSyncAll();
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
        <button type="button" className="top-secondary-btn" onClick={onScanUsb} disabled={isSyncing}>
          Scan USB
        </button>
      </div>

      <div className="top-actions-cluster">
        <button
          type="button"
          className="top-secondary-btn"
          disabled={isSyncing}
          onClick={onReadFromPedal}
          title="Import all 12 Gig Rigs & custom pedals currently stored on your MS-50G"
        >
          Read from MS-50G
        </button>
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
        <button
          type="button"
          className="top-secondary-btn"
          disabled={isSyncing || !chocolateConnected}
          onClick={onProgramChocolate}
          title="Re-send only the footswitch & expression settings to the Chocolate Plus (every write is confirmed)"
        >
          Program Chocolate Plus
        </button>
        <button
          type="button"
          className="top-secondary-btn"
          disabled={isSyncing}
          onClick={onOpenFootswitchTest}
          title="See exactly what each Chocolate Plus switch sends"
        >
          Footswitch Test
        </button>
        <button type="button" className="top-guide-btn" onClick={onOpenSetupGuide}>
          ⚡ Wireless & Setup Guide
        </button>
        <label className="backup-toggle-label" title="Download a JSON backup copy right before overwriting your pedal">
          <input
            type="checkbox"
            checked={autoBackupBeforeSync}
            onChange={(e) => setAutoBackupBeforeSync(e.target.checked)}
          />
          Auto-backup
        </label>
        <button
          type="button"
          className="sync-all-btn"
          disabled={isSyncing}
          onClick={handleSyncClick}
        >
          {isSyncing ? 'SYNCING...' : 'SYNC ALL TO PEDALS'}
        </button>
      </div>

      {(statusMessage || syncProgress) && (
        <div
          className={`top-status-strip ${syncProgress?.phase === 'error' ? 'top-status-error' : ''}`}
          role="status"
        >
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
