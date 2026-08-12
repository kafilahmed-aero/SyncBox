import React, { useState } from 'react';
import Card from '../components/Card';
import { socket } from '../socket';

export default function JoinRoom({ onJoinRoom, onNavigate }) {
  const [code, setCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    const finalCode = code.trim().toUpperCase();
    if (!finalCode) {
      setError('Please enter a valid 6-character room code.');
      return;
    }

    setIsJoining(true);
    setError(null);

    let acked = false;
    const timeoutTimer = setTimeout(() => {
      if (!acked) {
        acked = true;
        setIsJoining(false);
        setError('Connection timeout. Unable to reach SyncBox server. Please check your network connection.');
      }
    }, 6000);

    if (!socket.connected) {
      socket.connect();
    }

    socket.emit('JOIN_ROOM', { roomCode: finalCode, deviceName: 'Phone' }, (res) => {
      if (acked) return;
      acked = true;
      clearTimeout(timeoutTimer);
      setIsJoining(false);

      if (res && res.success) {
        onJoinRoom(res.roomCode, false);
      } else {
        setError(res?.error || 'Room not found. Please check your room code.');
      }
    });
  };

  return (
    <div className="content-wrapper">
      <Card 
        title="Join a Room" 
        subtitle="Connect this device as a synchronized speaker."
      >
        <form onSubmit={handleSubmit} className="form-group">
          <label className="form-label" htmlFor="room-code-input">Room Code</label>
          <input
            id="room-code-input"
            type="text"
            className="input-text"
            placeholder="e.g. ET73S2"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />

          {error && (
            <div style={{ color: '#FCA5A5', fontSize: '0.85rem', padding: '0.5rem', backgroundColor: '#2D1517', borderRadius: '4px', marginTop: '0.5rem' }}>
              {error}
            </div>
          )}
          
          <button 
            type="submit" 
            className="btn btn-primary"
            style={{ marginTop: '0.75rem' }}
            disabled={isJoining}
            id="btn-confirm-join"
          >
            {isJoining ? 'JOINING ROOM...' : 'JOIN ROOM'}
          </button>
        </form>

        <button 
          className="link-back" 
          onClick={() => onNavigate('home')}
          id="link-back-home"
        >
          ← Back to Home
        </button>
      </Card>
    </div>
  );
}
