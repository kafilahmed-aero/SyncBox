import React from 'react';

export default function SpeakerActivation({ isReady, onEnable, isActivating, error }) {
  return (
    <div className="speaker-activation-card">
      <span className="form-label">Speaker Setup</span>
      
      {!isReady ? (
        <div className="speaker-setup-pending">
          <p className="speaker-setup-msg">Your device is not ready.</p>
          
          {error && (
            <div 
              style={{
                backgroundColor: '#2D1517',
                border: '1px solid #DC2626',
                color: '#FCA5A5',
                padding: '0.6rem 0.8rem',
                borderRadius: '6px',
                fontSize: '0.85rem'
              }}
            >
              {error}
            </div>
          )}

          <button 
            className="btn btn-primary"
            onClick={onEnable}
            disabled={isActivating}
            id="btn-enable-speaker"
          >
            {isActivating ? 'ACTIVATING AUDIO...' : 'ENABLE SPEAKER'}
          </button>
        </div>
      ) : (
        <div className="speaker-setup-ready">
          <span className="badge badge-speaker-ready">
            🔊 SPEAKER READY
          </span>
          <p className="speaker-ready-subtext">
            Web Audio API AudioContext is active and ready on this device.
          </p>
        </div>
      )}
    </div>
  );
}
