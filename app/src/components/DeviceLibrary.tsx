import React, { useState } from 'react';
import { getEffectDefinition } from '../data/effectCatalog';
import { webMidiService } from '../midi/webMidiService';
import { DeviceFileEntry } from '../midi/zoomFiles';
import { parseZdl, ZdlInfo } from '../midi/zdlParser';
import { decompile48PatchesToRigs, isSceneSlotFxid, unpackRawPatch128 } from '../midi/zoomProtocol';
import { useLibraryStore } from '../store/libraryStore';
import { useRigStore } from '../store/rigStore';
import { SyncProgress } from '../types/rig';

interface Props {
  isOpen: boolean;
  zoomConnected: boolean;
  onClose: () => void;
  onStatus: (msg: string) => void;
}

/** What a patch slot is used for by Scene Studio. */
export function patchRole(idx: number): string {
  if (idx < 12) return `Rig ${String(idx + 1).padStart(2, '0')} · Scene A`;
  if (idx < 48) return `Rig ${String(Math.floor((idx - 12) / 3) + 1).padStart(2, '0')} · Scene ${['B', 'C', 'D'][(idx - 12) % 3]}`;
  return 'Not used by scenes';
}

function download(name: string, content: string | Uint8Array, type = 'text/plain') {
  const part: BlobPart = typeof content === 'string' ? content : (content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const DeviceLibrary: React.FC<Props> = ({ isOpen, zoomConnected, onClose, onStatus }) => {
  const working = useLibraryStore((s) => s.working);
  const original = useLibraryStore((s) => s.original);
  const setFromDevice = useLibraryStore((s) => s.setFromDevice);
  const installed = useLibraryStore((s) => s.installed);
  const setInstalled = useLibraryStore((s) => s.setInstalled);
  const editSlot = useLibraryStore((s) => s.editSlot);
  const editName = useLibraryStore((s) => s.editName);
  const markWritten = useLibraryStore((s) => s.markWritten);
  const revert = useLibraryStore((s) => s.revert);
  const loadRigsFromPedal = useRigStore((s) => s.loadRigsFromPedal);

  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [probeLog, setProbeLog] = useState('');
  const [files, setFiles] = useState<DeviceFileEntry[] | null>(null);
  const [lastMsg, setLastMsg] = useState('');

  if (!isOpen) return null;

  const dirty = (i: number) => {
    const a = original?.[i];
    const b = working?.[i];
    return !!a && !!b && a.some((v, k) => v !== b[k]);
  };

  const handleRead = async () => {
    setBusy(true);
    const res = await webMidiService.readLibrary(setProgress);
    setBusy(false);
    if (res.ok) {
      setFromDevice(res.raw50);
      setLastMsg('Read all 50 presets from the MS-50G. Pick a patch from the list below.');
      onStatus('Read all 50 presets from the MS-50G into the Device Library.');
    } else {
      setLastMsg(res.userMessage);
      onStatus(res.userMessage);
    }
  };

  const handleWrite = async () => {
    if (!working) return;
    if (sel < 48 && !window.confirm(`Patch ${sel + 1} is a scene record (${patchRole(sel)}). Writing it changes that scene on the pedal, and the next Sync All will overwrite it again unless you also load it into the rigs. Write anyway?`)) return;
    setBusy(true);
    const res = await webMidiService.writeLibraryPatch(sel, working[sel], setProgress);
    setBusy(false);
    if (res.ok) markWritten(sel);
    setLastMsg(res.userMessage);
    onStatus(res.userMessage);
  };

  const handleLoadIntoRigs = () => {
    if (!working || working.length < 48) return;
    try {
      loadRigsFromPedal(decompile48PatchesToRigs(working.slice(0, 48)));
      onStatus('Loaded the 12 rigs (48 scene records) from the Device Library into the editor.');
    } catch (e) {
      onStatus(`Could not load the library into the rig editor: ${(e as Error).message}`);
    }
  };

  const handleListFiles = async () => {
    setBusy(true);
    const res = await webMidiService.listDeviceFiles(setProgress);
    setBusy(false);
    if (res.ok) {
      setFiles(res.files);
      setLastMsg(`Found ${res.files.length} files on the MS-50G.`);
      onStatus(`Found ${res.files.length} files on the MS-50G.`);
    } else {
      setLastMsg(res.userMessage);
      onStatus(res.userMessage);
    }
  };

  const handleDownloadFile = async (f: DeviceFileEntry) => {
    setBusy(true);
    const res = await webMidiService.downloadDeviceFile(f.name, setProgress, f.size);
    setBusy(false);
    if (res.ok) {
      download(f.name, res.data, 'application/octet-stream');
      setLastMsg(`Downloaded ${f.name} (${res.data.length.toLocaleString()} bytes). Check your browser's Downloads folder.`);
    } else {
      setLastMsg(res.userMessage);
      setProbeLog(res.trace ?? '');
      onStatus(res.userMessage);
    }
  };

  const handleDownloadAll = async () => {
    if (!files) return;
    setBusy(true);
    const zdls = files.filter((f) => /\.ZDL$/i.test(f.name));
    const res = await webMidiService.downloadAllDeviceFiles(zdls, setProgress, true);
    setBusy(false);
    if (res.ok) {
      const parsed: ZdlInfo[] = [];
      const bad: string[] = [];
      for (const f of res.files) {
        const z = parseZdl(f.data);
        if (z) parsed.push(z);
        else bad.push(f.name);
      }
      setInstalled(parsed);
      download('MS50G-effect-files.zip', res.zip, 'application/zip');
      const msg = `Read ${parsed.length} of ${zdls.length} effects (names, ids, knobs).${bad.length ? ` Could not parse: ${bad.join(', ')}.` : ''} Also saved MS50G-effect-files.zip.${res.failed.length ? ` Could not download ${res.failed.length}: ${res.failed.join('; ')}.` : ''}`;
      setLastMsg(msg);
      if (res.failed.length) setProbeLog(res.trace);
      onStatus(msg);
    } else {
      setLastMsg(res.userMessage);
      setProbeLog(res.trace ?? '');
      onStatus(res.userMessage);
    }
  };

  const handleExport = () => {
    if (!working) return;
    const out = working.map((raw, i) => {
      const u = unpackRawPatch128(raw);
      return {
        patch: i + 1,
        role: patchRole(i),
        name: u.name,
        tempo: u.tempo,
        slots: u.slots6.map((s) => ({
          enabled: s.enabled,
          fxid: '0x' + s.fxid.toString(16).padStart(8, '0'),
          effect: getEffectDefinition(s.fxid)?.name ?? null,
          params: s.params,
        })),
        raw: Array.from(raw).map((b) => b.toString(16).padStart(2, '0')).join(''),
      };
    });
    download('MS50G-DeviceLibrary.json', JSON.stringify(out, null, 2), 'application/json');
  };

  const cur = working?.[sel] ? unpackRawPatch128(working[sel]) : null;
  const isBusyProgress = busy && progress;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Device Library">
      <div className="modal-panel library-panel">
        <div className="modal-header">
          <h2>📚 Device Library</h2>
          <button type="button" className="modal-close-btn" onClick={onClose}>✕ Close</button>
        </div>
        <div className="library-toolbar">
          <button type="button" className="top-secondary-btn" disabled={!zoomConnected || busy} onClick={handleRead}>
            Read all 50 presets
          </button>
          <button type="button" className="top-secondary-btn" disabled={!working || busy} onClick={handleExport}>
            Export library (.json)
          </button>
          <button type="button" className="top-secondary-btn" disabled={!working || busy} onClick={handleLoadIntoRigs}>
            Load scene records into rig editor
          </button>
          <button type="button" className="top-secondary-btn" disabled={!zoomConnected || busy} onClick={handleListFiles}>
            List installed effect files
          </button>
        </div>
        {(isBusyProgress || lastMsg) && <p className="modal-intro library-msg">{isBusyProgress ? progress.message : lastMsg}</p>}

        {files && (
          <div className="library-files">
            <div className="library-probe-head">
              <strong>{files.length} files on the MS-50G ({files.filter((f) => /\.ZDL$/i.test(f.name)).length} effects)</strong>
              <button type="button" className="top-secondary-btn" disabled={busy} onClick={handleDownloadAll}>
                Read all effects (names &amp; knobs) + save .zip
              </button>
            </div>
            <ul className="library-filelist">
              {files.map((f) => (
                <li key={f.name}>
                  <span className="library-filename">{f.name}</span>
                  <span className="library-filesize">{f.size.toLocaleString()} B</span>
                  <button type="button" className="top-secondary-btn" disabled={busy} onClick={() => handleDownloadFile(f)}>
                    Download
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!working && <p className="modal-intro">Connect the MS-50G, click Scan USB, then Read all 50 presets.</p>}

        {working && (
          <div className="library-body">
            <ul className="library-list">
              {working.map((raw, i) => (
                <li key={i}>
                  <button type="button" className={`library-item ${i === sel ? 'library-item-sel' : ''}`} onClick={() => setSel(i)}>
                    <span className="library-num">{String(i + 1).padStart(2, '0')}</span>
                    <span className="library-name">{unpackRawPatch128(raw).name || '(unnamed)'}</span>
                    {dirty(i) && <span className="library-dirty">●</span>}
                    <span className="library-role">{patchRole(i)}</span>
                  </button>
                </li>
              ))}
            </ul>

            {cur && (
              <div className="library-editor">
                <label className="library-field">
                  Name (10 chars)
                  <input value={cur.name} maxLength={10} onChange={(e) => editName(sel, e.target.value)} />
                </label>
                {cur.slots6.map((slot, s) => {
                  const def = getEffectDefinition(slot.fxid);
                  const inst = installed[slot.fxid];
                  const isScene = isSceneSlotFxid(slot.fxid);
                  const fxHex = '0x' + slot.fxid.toString(16).padStart(8, '0');
                  return (
                    <div key={s} className="library-slot">
                      <label className="library-slot-head">
                        <input type="checkbox" checked={slot.enabled} onChange={(e) => editSlot(sel, s, { enabled: e.target.checked })} />
                        <strong>{s + 1}. {def ? def.name : isScene ? 'SCENE.ZDL (Scene Studio engine)' : inst ? `${inst.name} (installed on pedal)` : `Unknown effect ${fxHex}`}</strong>
                        {!def && !isScene && !inst && <span className="library-unknown">not in app catalog</span>}
                      </label>
                      <div className="library-knobs">
                        {slot.params.map((v, p) => {
                          const spec = def?.params[p] ?? (inst?.params[p] ? { name: inst.params[p].name, max: inst.params[p].max } : undefined);
                          if ((def || inst) && !spec && p > 0 && v === 0) return null;
                          return (
                            <label key={p} className="library-knob">
                              {spec?.name ?? `P${p + 1}`}
                              <input
                                type="number"
                                value={v}
                                min={0}
                                max={spec?.max ?? 8191}
                                onChange={(e) => editSlot(sel, s, { params: { [p]: Number(e.target.value) } })}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                <div className="library-actions">
                  <button type="button" className="sync-all-btn" disabled={!zoomConnected || busy || !dirty(sel)} onClick={handleWrite}>
                    Write Patch {sel + 1} to MS-50G
                  </button>
                  <button type="button" className="top-secondary-btn" disabled={busy || !dirty(sel)} onClick={() => revert(sel)}>
                    Revert
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {probeLog && (
          <div className="library-probe">
            <div className="library-probe-head">
              <strong>Log (send this file to Claude if a download failed)</strong>
              <button type="button" className="top-secondary-btn" onClick={() => download('MS50G-probe-log.txt', probeLog)}>
                Download log
              </button>
            </div>
            <pre>{probeLog}</pre>
          </div>
        )}
      </div>
    </div>
  );
};
