import React from 'react';

export default function Playlist({ 
  playlist = [], 
  currentTrackIndex = 0, 
  isShuffle = false, 
  isHost = true, 
  onToggleShuffle, 
  onSelectTrack 
}) {
  if (!playlist || playlist.length === 0) return null;

  const formatTime = (secs) => {
    if (!secs || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div style={{
      backgroundColor: '#1E293B',
      border: '1px solid #334155',
      borderRadius: '12px',
      padding: '1rem',
      marginTop: '1rem',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '0.8rem',
        paddingBottom: '0.5rem',
        borderBottom: '1px solid #334155'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '1.1rem' }}>🎶</span>
          <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#F8FAFC' }}>
            Playlist Queue ({playlist.length} {playlist.length === 1 ? 'Track' : 'Tracks'})
          </span>
        </div>

        {isHost && (
          <button
            type="button"
            onClick={onToggleShuffle}
            style={{
              padding: '0.35rem 0.75rem',
              fontSize: '0.75rem',
              fontWeight: 700,
              borderRadius: '8px',
              border: isShuffle ? '1px solid #10B981' : '1px solid #475569',
              backgroundColor: isShuffle ? 'rgba(16, 185, 129, 0.2)' : 'rgba(51, 65, 85, 0.5)',
              color: isShuffle ? '#34D399' : '#94A3B8',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
              touchAction: 'manipulation',
              transition: 'all 0.2s ease'
            }}
            title={isShuffle ? 'Non-repeating Shuffle Enabled' : 'Sequential Order'}
          >
            <span>🔀 Shuffle:</span>
            <span style={{ color: isShuffle ? '#10B981' : '#CBD5E1', fontWeight: 800 }}>
              {isShuffle ? 'ON' : 'OFF'}
            </span>
          </button>
        )}
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
        maxHeight: '220px',
        overflowY: 'auto'
      }}>
        {playlist.map((track, idx) => {
          const isCurrent = idx === currentTrackIndex;
          return (
            <div
              key={track.songId || idx}
              onClick={() => isHost && onSelectTrack && onSelectTrack(idx)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.55rem 0.75rem',
                borderRadius: '8px',
                backgroundColor: isCurrent ? 'rgba(99, 102, 241, 0.2)' : '#0F172A',
                border: isCurrent ? '1px solid #6366F1' : '1px solid transparent',
                cursor: isHost ? 'pointer' : 'default',
                transition: 'background-color 0.15s ease'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', overflow: 'hidden' }}>
                <span style={{ 
                  fontSize: '0.75rem', 
                  fontWeight: 700, 
                  color: isCurrent ? '#818CF8' : '#64748B',
                  minWidth: '18px'
                }}>
                  {idx + 1}.
                </span>
                <span style={{
                  fontSize: '0.8rem',
                  fontWeight: isCurrent ? 700 : 500,
                  color: isCurrent ? '#F1F5F9' : '#CBD5E1',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '180px'
                }}>
                  {track.name}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {isCurrent && (
                  <span style={{
                    fontSize: '0.6rem',
                    fontWeight: 800,
                    backgroundColor: '#6366F1',
                    color: '#FFFFFF',
                    padding: '0.15rem 0.4rem',
                    borderRadius: '4px',
                    letterSpacing: '0.5px'
                  }}>
                    NOW PLAYING
                  </span>
                )}
                {track.duration > 0 && (
                  <span style={{ fontSize: '0.7rem', color: '#64748B' }}>
                    {formatTime(track.duration)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
