import React, { useState } from 'react';
import Card from '../components/Card';
import { socket } from '../socket';

export default function CreateRoom({ onCreateRoom, onNavigate }) {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState(null);

  const handleCreate = () => {
    setIsCreating(true);
    setError(null);

    if (!socket.connected) {
      socket.connect();
    }

    socket.emit('CREATE_ROOM', { deviceName: 'Laptop' }, (res) => {
      setIsCreating(false);
      if (res && res.success) {
        onCreateRoom(res.roomCode, true);
      } else {
        setError(res?.error || 'Failed to create room on server.');
      }
    });
  };

  return (
    <div className="content-wrapper">
      <Card 
        title="Create a Room" 
        subtitle="Start a new synchronized listening session on this device."
      >
        <div className="form-group">
          <label className="form-label">Host Device</label>
          <div className="device-item">
            <span className="device-name">This Device</span>
            <span className="badge badge-host">HOST</span>
          </div>
        </div>

        {error && (
          <div style={{ color: '#FCA5A5', fontSize: '0.85rem', padding: '0.5rem', backgroundColor: '#2D1517', borderRadius: '4px' }}>
            {error}
          </div>
        )}

        <button 
          className="btn btn-primary"
          onClick={handleCreate}
          disabled={isCreating}
          id="btn-confirm-create"
        >
          {isCreating ? 'CREATING ROOM...' : 'CREATE ROOM'}
        </button>

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
