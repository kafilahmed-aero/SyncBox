import React, { useState } from 'react';
import Header from './components/Header';
import Home from './pages/Home';
import CreateRoom from './pages/CreateRoom';
import JoinRoom from './pages/JoinRoom';
import Room from './pages/Room';
import './styles/index.css';

export default function App() {
  // Load initial session state from sessionStorage (preserves room on page refresh)
  const [currentScreen, setCurrentScreen] = useState(() => {
    try {
      const saved = sessionStorage.getItem('syncbox_active_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.screen === 'room') return 'room';
      }
    } catch (e) {}
    return 'home';
  });

  const [roomCode, setRoomCode] = useState(() => {
    try {
      const saved = sessionStorage.getItem('syncbox_active_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.roomCode) return parsed.roomCode;
      }
    } catch (e) {}
    return 'ABC123';
  });

  const [isHost, setIsHost] = useState(() => {
    try {
      const saved = sessionStorage.getItem('syncbox_active_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.isHost === 'boolean') return parsed.isHost;
      }
    } catch (e) {}
    return true;
  });

  const [initialRoomData, setInitialRoomData] = useState(() => {
    try {
      const saved = sessionStorage.getItem('syncbox_active_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.initialRoomData) return parsed.initialRoomData;
      }
    } catch (e) {}
    return null;
  });

  const handleNavigate = (screen) => {
    setCurrentScreen(screen);
  };

  const handleCreateRoom = (code = 'ABC123') => {
    setRoomCode(code);
    setIsHost(true);
    setInitialRoomData(null);
    setCurrentScreen('room');
    try {
      sessionStorage.setItem('syncbox_active_session', JSON.stringify({
        screen: 'room',
        roomCode: code,
        isHost: true,
        initialRoomData: null
      }));
    } catch (e) {}
  };

  const handleJoinRoom = (code = 'ABC123', roomData = null) => {
    const finalCode = code || 'ABC123';
    setRoomCode(finalCode);
    setIsHost(false);
    setInitialRoomData(roomData);
    setCurrentScreen('room');
    try {
      sessionStorage.setItem('syncbox_active_session', JSON.stringify({
        screen: 'room',
        roomCode: finalCode,
        isHost: false,
        initialRoomData: roomData
      }));
    } catch (e) {}
  };

  const handleLeaveRoom = () => {
    try {
      sessionStorage.removeItem('syncbox_active_session');
    } catch (e) {}
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
