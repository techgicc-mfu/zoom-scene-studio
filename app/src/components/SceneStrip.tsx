import React from 'react';
import { useRigStore } from '../store/rigStore';
import { SCENE_IDS, SceneId } from '../types/rig';

function formatTrimDb(trimIdx: number): string {
  const db = (trimIdx - 12) * 0.5;
  if (db === 0) return '0.0 dB (Unity)';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

export const SceneStrip: React.FC = () => {
  const rig = useRigStore((s) => s.rigs[s.activeRigIndex]);
  const activeScene = useRigStore((s) => s.activeScene);
  const setScene = useRigStore((s) => s.setScene);
  const renameScene = useRigStore((s) => s.renameScene);
  const setSceneTrim = useRigStore((s) => s.setSceneTrim);
  const copySceneAToCurrent = useRigStore((s) => s.copySceneAToCurrent);

  const currentTrim = rig.sceneTrims[activeScene] ?? 12;

  return (
    <section className="scene-strip-section" aria-label="Scene Selector">
      <div className="scene-buttons-grid">
        {SCENE_IDS.map((sc: SceneId) => {
          const isCurrent = sc === activeScene;
          const trimDb = ((rig.sceneTrims[sc] ?? 12) - 12) * 0.5;
          return (
            <button
              key={sc}
              type="button"
              onClick={() => setScene(sc)}
              className={`scene-switch-btn ${isCurrent ? 'scene-switch-active' : ''}`}
            >
              <div className="scene-switch-top">
                <span>SWITCH {sc}</span>
                {trimDb !== 0 && (
                  <span className="scene-trim-pill">
                    {trimDb > 0 ? `+${trimDb.toFixed(1)}` : trimDb.toFixed(1)} dB
                  </span>
                )}
              </div>
              <div className="scene-switch-label">{rig.sceneNames[sc]}</div>
            </button>
          );
        })}
      </div>

      <div className="scene-detail-bar">
        <div className="scene-name-edit">
          <label htmlFor="scene-label-input">Scene {activeScene} Label:</label>
          <input
            id="scene-label-input"
            type="text"
            value={rig.sceneNames[activeScene]}
            onChange={(e) => renameScene(activeScene, e.target.value)}
          />
        </div>

        <div className="scene-trim-control">
          <label htmlFor="scene-trim-slider">
            Scene {activeScene} Solo Volume Trim: <strong>{formatTrimDb(currentTrim)}</strong>
          </label>
          <input
            id="scene-trim-slider"
            type="range"
            min={0}
            max={24}
            step={1}
            value={currentTrim}
            onChange={(e) => setSceneTrim(activeScene, Number(e.target.value))}
          />
        </div>

        {activeScene !== 'A' && (
          <button
            type="button"
            className="copy-scene-a-btn"
            onClick={copySceneAToCurrent}
            title="Reset this scene's pedals and knobs to match Scene A so you only tweak what changes"
          >
            ↺ Copy Scene A → Scene {activeScene}
          </button>
        )}
      </div>
    </section>
  );
};
