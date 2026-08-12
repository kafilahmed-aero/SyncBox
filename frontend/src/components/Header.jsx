import React from 'react';

export default function Header({ onGoHome }) {
  return (
    <header className="site-header">
      <div className="brand" onClick={onGoHome} role="button" tabIndex={0}>
        <div className="brand-icon">
          {/* Simple inline SVG audio wave icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38BDF8" strokeWidth="2.5" strokeLinecap="round">
            <line x1="4" y1="9" x2="4" y2="15" />
            <line x1="8" y1="5" x2="8" y2="19" />
            <line x1="12" y1="3" x2="12" y2="21" />
            <line x1="16" y1="7" x2="16" y2="17" />
            <line x1="20" y1="10" x2="20" y2="14" />
          </svg>
        </div>
        <span className="brand-title">SYNCBOX</span>
      </div>
      <span className="phase-badge">Phase 1 UI</span>
    </header>
  );
}
