import React from 'react';
import Card from '../components/Card';

export default function Home({ onNavigate }) {
  return (
    <div className="content-wrapper">
      <div style={{ textAlign: 'center', margin: '1rem 0' }}>
        <h1 className="title-hero">SYNCBOX</h1>
        <p className="tagline">
          Turn multiple devices into one synchronized speaker.
        </p>
      </div>

      <Card>
        <button 
          className="btn btn-primary"
          onClick={() => onNavigate('create')}
          id="btn-create-room"
        >
          CREATE ROOM
        </button>

        <button 
          className="btn btn-secondary"
          onClick={() => onNavigate('join')}
          id="btn-join-room"
        >
          JOIN ROOM
        </button>
      </Card>

      <div className="mock-notice">
        Frontend Placeholder Stage — Multi-device synchronization & audio backend coming in later phases.
      </div>
    </div>
  );
}
