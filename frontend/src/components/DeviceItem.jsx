import React from 'react';

export default function DeviceItem({ name, role, status }) {
  const getStatusBadgeClass = (st) => {
    switch (st) {
      case 'CONNECTED':
        return 'badge-status-connected';
      case 'READY':
        return 'badge-status-ready';
      case 'PLAYING':
        return 'badge-status-playing';
      case 'PAUSED':
        return 'badge-status-paused';
      case 'SYNCING':
        return 'badge-status-syncing';
      case 'CONNECTING':
        return 'badge-status-connecting';
      case 'SPEAKER NOT ENABLED':
        return 'badge-status-disabled';
      case 'DISCONNECTED':
        return 'badge-status-disconnected';
      default:
        return 'badge-status-default';
    }
  };

  return (
    <div className="device-item">
      <div className="device-info">
        <span className="device-name">{name}</span>
        <span className={`badge ${role === 'HOST' ? 'badge-host' : 'badge-speaker'}`}>
          {role}
        </span>
      </div>
      <span className={`badge ${getStatusBadgeClass(status)}`}>
        {status}
      </span>
    </div>
  );
}
