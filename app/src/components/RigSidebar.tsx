import React, { useState } from 'react';
import { STARTER_TEMPLATES } from '../data/starterTemplates';
import { useRigStore } from '../store/rigStore';

export const RigSidebar: React.FC = () => {
  const rigs = useRigStore((s) => s.rigs);
  const activeRigIndex = useRigStore((s) => s.activeRigIndex);
  const selectRig = useRigStore((s) => s.selectRig);
  const renameRig = useRigStore((s) => s.renameRig);
  const loadTemplate = useRigStore((s) => s.loadTemplateIntoActiveRig);

  const [showTemplates, setShowTemplates] = useState(false);

  return (
    <aside className="rig-sidebar" aria-label="My 12 Gig Rigs">
      <div className="sidebar-section-header">MY 12 GIG RIGS</div>

      <div className="rig-list">
        {rigs.map((rig, idx) => {
          const isSelected = idx === activeRigIndex;
          const numStr = String(idx + 1).padStart(2, '0');
          return (
            <button
              key={idx}
              type="button"
              onClick={() => selectRig(idx)}
              className={`rig-item ${isSelected ? 'rig-item-active' : ''}`}
            >
              <span className="rig-number">{numStr}.</span>
              <span className="rig-title">{rig.name.replace(/^\d+\.\s*/, '')}</span>
            </button>
          );
        })}
      </div>

      <div className="sidebar-rename-box">
        <label htmlFor="rig-name-input" className="sidebar-mini-label">
          Current Rig Name (Max 10 chars on Pedal LCD)
        </label>
        <input
          id="rig-name-input"
          type="text"
          className="rig-name-input"
          value={rigs[activeRigIndex]?.name ?? ''}
          onChange={(e) => renameRig(activeRigIndex, e.target.value)}
        />
      </div>

      <div className="sidebar-templates-box">
        <button
          type="button"
          className="template-toggle-btn"
          onClick={() => setShowTemplates((v) => !v)}
        >
          {showTemplates ? '▲ Hide Genre Starters' : '+ Load Genre Template'}
        </button>

        {showTemplates && (
          <div className="template-cards">
            {STARTER_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="template-card-btn"
                onClick={() => {
                  loadTemplate(tpl.id);
                  setShowTemplates(false);
                }}
              >
                <div className="template-genre">{tpl.genreTag}</div>
                <div className="template-name">{tpl.title}</div>
                <div className="template-desc">{tpl.summary}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
};
