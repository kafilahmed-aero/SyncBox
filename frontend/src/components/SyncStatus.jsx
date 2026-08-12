import React from 'react';

export default function SyncStatus({ status = 'WAITING' }) {
  const getSyncStyle = (st) => {
    switch (st) {
      case 'SYNCED':
        return { bg: '#14291F', border: '#22C55E', color: '#4ADE80', dot: '#22C55E' };
      case 'READY':
        return { bg: '#14291F', border: '#16A34A', color: '#86EFAC', dot: '#4ADE80' };
      case 'SYNCING':
        return { bg: '#0F2942', border: '#0284C7', color: '#38BDF8', dot: '#38BDF8' };
      case 'RESYNCHRONIZING':
        return { bg: '#1E1B4B', border: '#6366F1', color: '#A5B4FC', dot: '#818CF8' };
      case 'DRIFT DETECTED':
        return { bg: '#361E16', border: '#EA580C', color: '#FDBA74', dot: '#F97316' };
      case 'WAITING':
      default:
        return { bg: '#262111', border: '#854D0E', color: '#FBBF24', dot: '#EAB308' };
    }
  };

  const style = getSyncStyle(status);

  return (
    <div 
      className="sync-status-card"
      style={{
        backgroundColor: style.bg,
        borderColor: style.border,
        color: style.color
      }}
    >
      <span 
        className="sync-status-dot" 
        style={{ backgroundColor: style.dot }}
      />
      <span className="sync-status-text">{status}</span>
    </div>
  );
}
