import React, { useState } from 'react';
import Header from './components/Header';
import Home from './pages/Home';
import CreateRoom from './pages/CreateRoom';
import JoinRoom from './pages/JoinRoom';
import Room from './pages/Room';
import './styles/index.css';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('home'); // 'home' | 'create' | 'join' | 'room'
  const [roomCode, setRoomCode] = useState('ABC123');
  const [isHost, setIsHost] = useState(true);

  const [initialRoomData, setInitialRoomData] = useState(null);

  const handleNavigate = (screen) => {
    setCurrentScreen(screen);
  };

  const handleCreateRoom = (code = 'ABC123') => {
    setRoomCode(code);
    setIsHost(true);
    setInitialRoomData(null);
    setCurrentScreen('room');
  };

  const handleJoinRoom = (code = 'ABC123', roomData = null) => {
    setRoomCode(code || 'ABC123');
    setIsHost(false);
    setInitialRoomData(roomData);
    setCurrentScreen('room');
  };

  const handleLeaveRoom = () => {
    setInitialRoomData(null);
    setCurrentScreen('home');
  };

  return (
    <div className="app-container">
      <Header onGoHome={() => handleNavigate('home')} />
      
      <main style={{ width: '100%' }}>
        {currentScreen === 'home' && (
          <Home onNavigate={handleNavigate} />
        )}

        {currentScreen === 'create' && (
          <CreateRoom 
            onCreateRoom={handleCreateRoom} 
            onNavigate={handleNavigate} 
          />
        )}

        {currentScreen === 'join' && (
          <JoinRoom 
            onJoinRoom={handleJoinRoom} 
            onNavigate={handleNavigate} 
          />
        )}

        {currentScreen === 'room' && (
          <Room 
            roomCode={roomCode} 
            isHost={isHost}
            initialRoomData={initialRoomData}
            onLeaveRoom={handleLeaveRoom} 
          />
        )}
      </main>
    </div>
  );
}
