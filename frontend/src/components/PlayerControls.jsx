import React from 'react';

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return `${mm}:${ss}`;
}

const PlayerControls = React.memo(function PlayerControls({ 
  songName = 'No song selected',
  playbackState = 'STOPPED', 
  currentTime = 0, 
  duration = 0, 
  sampleRate,
  channels,
  onPlay, 
  onPause, 
  onStop, 
  onSeek,
  onSelectFileClick,
  isHost = true,
  songPrepState = 'READY'
}) {
  return (
    <div className="player-controls-container">
      <div className="player-song-info">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="form-label">CURRENT SONG</span>
          {sampleRate && (
            <span className="badge badge-status-default" style={{ fontSize: '0.65rem' }}>
              {(sampleRate / 1000).toFixed(1)}kHz • {channels}ch
            </span>
          )}
        </div>
        <span className="player-song-title">{songName}</span>
      </div>

      {/* Progress & Seeking Bar */}
      <div className="player-timeline">
        <div className="player-timestamps">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
        <input 
          type="range"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="player-slider"
          disabled={playbackState === 'STOPPED' && duration === 0}
          aria-label="Seek progress"
        />
      </div>

      {/* Playback Controls & Select Song Action */}
      <div className="btn-group">
        <button 
          className={`btn btn-control ${playbackState === 'PLAYING' ? 'btn-control-active' : ''}`}
          onClick={onPlay}
          id="btn-player-play"
        >
          {songPrepState === 'PREPARING' ? 'LOADING...' : 'PLAY'}
        </button>
        <button 
          className={`btn btn-control ${playbackState === 'PAUSED' ? 'btn-control-active' : ''}`}
          onClick={onPause}
          id="btn-player-pause"
        >
          PAUSE
        </button>
        <button 
          className={`btn btn-control ${playbackState === 'STOPPED' ? 'btn-control-active' : ''}`}
          onClick={onStop}
          id="btn-player-stop"
        >
          STOP
        </button>
      </div>

      {isHost && (
        <button 
          className="btn btn-secondary" 
          style={{ minHeight: '44px', fontSize: '0.85rem', marginTop: '0.25rem' }}
          onClick={onSelectFileClick}
          id="btn-select-song-file"
        >
          📂 SELECT LOCAL AUDIO FILE
        </button>
      )}
    </div>
  );
});

export default PlayerControls;
