import React, { useState, useEffect, useRef } from 'react';
import Card from '../components/Card';
import DeviceItem from '../components/DeviceItem';
import SyncStatus from '../components/SyncStatus';
import PlayerControls from '../components/PlayerControls';
import SpeakerActivation from '../components/SpeakerActivation';
import { audioEngine } from '../audio/AudioEngine';
import { clockSync } from '../audio/ClockSync';
import { socket } from '../socket';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

export default function Room({ roomCode = 'ABC123', isHost = true, initialRoomData = null, onLeaveRoom }) {
  // Speaker Web Audio API activation state
  const [speakerReady, setSpeakerReady] = useState(() => audioEngine.isReady());
  const [isActivating, setIsActivating] = useState(false);
  const [audioError, setAudioError] = useState(null);

  // Per-Device Physical Audio Calibration Offset State & Debug Touch Log
  const [userOffset, setUserOffset] = useState(() => audioEngine.getUserOffset());
  const [lastTouchLog, setLastTouchLog] = useState('');

  // Per-Device Sync Calibration Offset Handler (Touch & Pointer Interception + Live Dynamic Audio Shift)
  const handleAdjustOffset = (deltaSec, e) => {
    if (e) {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }

    const currentOffset = audioEngine.getUserOffset();
    const newOffset = deltaSec === 0 ? 0.0 : Number((currentOffset + deltaSec).toFixed(2));
    
    // 1. Directly mutate AudioEngine offset and localStorage
    audioEngine.setUserOffset(newOffset);

    // 2. Dynamic live playback position shift if audio is currently playing
    if (audioEngine.getPlaybackState() === 'PLAYING') {
      const currentPos = audioEngine.getCurrentPosition();
      const newPos = Math.max(0, currentPos - deltaSec);
      console.log(`[Room Touch Adjust] Shifting live playback from ${currentPos.toFixed(2)}s to ${newPos.toFixed(2)}s`);
      audioEngine.seek(newPos);
    }

    // 3. Update React component state for deterministic UI re-render
    setUserOffset(newOffset);

    // 4. Record touch log for instant visual feedback on mobile touchscreens
    const actionLabel = deltaSec === 0 
      ? 'Reset to 0.00s' 
      : `Tapped ${deltaSec > 0 ? '+' : ''}${deltaSec.toFixed(1)}s (Offset: ${newOffset >= 0 ? '+' : ''}${newOffset.toFixed(2)}s)`;
    setLastTouchLog(actionLabel);
    console.log(`[Room Touch Adjust] ${actionLabel}`);
  };

  // Real Audio Preparation State (NO SONG | SONG SELECTED | PREPARING | READY)
  const [songPrepState, setSongPrepState] = useState(() => {
    return audioEngine.getMetadata() ? 'READY' : 'NO SONG';
  });
  const [songMetadata, setSongMetadata] = useState(() => audioEngine.getMetadata());
  const [fileError, setFileError] = useState(null);

  // Real Backend Devices List State
  const [devices, setDevices] = useState([
    { deviceName: 'This Device', role: isHost ? 'HOST' : 'SPEAKER', status: 'CONNECTED', audioReady: false }
  ]);

  // Diagnostics State
  const [clockStats, setClockStats] = useState(() => clockSync.getSyncStats());
  const [driftStats, setDriftStats] = useState({ driftMs: 0, playbackRate: 1.0 });

  // Player visual playback state
  const [playbackState, setPlaybackState] = useState(() => audioEngine.getPlaybackState());
  const [currentTime, setCurrentTime] = useState(() => audioEngine.getCurrentPosition());

  // Refs for tracking timeline command timestamps
  const lastCommandRef = useRef({ position: 0, serverTime: Date.now() });
  const isResyncingRef = useRef(false);
  const fileInputRef = useRef(null);
  const animFrameRef = useRef(null);

  // Synchronization visual state
  const [syncState, setSyncState] = useState('READY');

  // Socket & Clock Sync Initialization
  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    // Start Phase 6 Clock Synchronization
    clockSync.startAutoSync(socket);
    clockSync.setOnSyncUpdate((stats) => {
      setClockStats({ ...stats });
    });

    if (audioEngine.isReady()) {
      setSpeakerReady(true);
    }

    audioEngine.setOnEndedCallback(() => {
      setPlaybackState('STOPPED');
      setCurrentTime(0);
      setSyncState('READY');
      setDriftStats({ driftMs: 0, playbackRate: 1.0 });
    });

    // Listen for Real-Time Backend Device List Updates
    const handleDeviceUpdate = (data) => {
      if (data && data.devices) {
        setDevices(data.devices);
      }
    };

    // Listen for Backend SONG_SELECTED Broadcast
    const handleSongSelected = async (payload) => {
      console.log('[Room] Received SONG_SELECTED event from server:', payload);
      setSongMetadata({
        name: payload.name,
        duration: payload.duration,
        size: payload.size,
        type: payload.type
      });
      setSongPrepState('SONG SELECTED');

      // If this device is a Speaker, download audio file via HTTP
      if (!isHost && payload.audioUrl) {
        try {
          setSongPrepState('PREPARING');
          const fullAudioUrl = payload.audioUrl.startsWith('http') 
            ? payload.audioUrl 
            : `${BACKEND_URL}${payload.audioUrl}`;

          console.log('[Room] Speaker downloading audio file from:', fullAudioUrl);
          const response = await fetch(fullAudioUrl);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

          const blob = await response.blob();
          const file = new File([blob], payload.name, { type: payload.type || 'audio/mpeg' });

          const meta = await audioEngine.loadAndDecodeAudioFile(file);
          setSongMetadata(meta);
          setSongPrepState('READY');
          console.log('[Room] Speaker audio decoded successfully.');

          // Report AUDIO_READY to backend server
          socket.emit('AUDIO_READY', { roomCode });
        } catch (err) {
          console.error('[Room] Speaker audio download/decode error:', err);
          setSongPrepState('NO SONG');
          setFileError('Failed to download audio file from room host.');
        }
      }
    };

  // Per-Device Sync Calibration Offset Handler (Instant Dynamic Audio Shift)
  const handleAdjustOffset = (deltaSec) => {
    setUserOffset((prevOffset) => {
      let newOffset = 0.0;
      if (deltaSec !== 0) {
        newOffset = Number((prevOffset + deltaSec).toFixed(2));
      }
      console.log(`[Room Offset Adjust] Tapped delta (${deltaSec > 0 ? '+' : ''}${deltaSec}s). New offset: ${newOffset.toFixed(2)}s`);
      audioEngine.setUserOffset(newOffset);

      // If audio is actively playing, dynamically shift active sound position by deltaSec!
      if (audioEngine.getPlaybackState() === 'PLAYING') {
        const currentPos = audioEngine.getCurrentPosition();
        const newPos = Math.max(0, currentPos - deltaSec);
        console.log(`[Room Offset Adjust] Dynamic live audio shift from ${currentPos.toFixed(2)}s to ${newPos.toFixed(2)}s`);
        audioEngine.seek(newPos);
      }
      return newOffset;
    });
  };

  // Listen for Room PLAYBACK_COMMAND Broadcast (Synchronized Initial Start & Playback Commands)
  const handlePlaybackCommand = async (payload) => {
    console.log('[Room] Received PLAYBACK_COMMAND:', payload);
    if (!payload || !payload.command) return;

    const { command, position = 0, serverTime, playAtTimestamp } = payload;
    
    // Store timeline reference
    lastCommandRef.current = {
      position: position,
      serverTime: playAtTimestamp || serverTime || Date.now()
    };

    if (command === 'PLAY') {
      audioEngine.setPlaybackRate(1.000);
      const userOffsetSec = audioEngine.getUserOffset();

      if (playAtTimestamp) {
        const delta = playAtTimestamp - clockSync.getServerTime();

        if (delta > 0) {
          // Future target: schedule Web Audio start compensated for output latency and per-device user offset
          const ctx = audioEngine.getAudioContext();
          const rawTargetAudioCtxTime = clockSync.toAudioContextTime(playAtTimestamp, ctx);
          const outputLatencySec = audioEngine.getOutputLatency();
          const targetAudioCtxTime = Math.max(ctx.currentTime, rawTargetAudioCtxTime - outputLatencySec + userOffsetSec);

          console.log(`[Room] Scheduling playback at AudioContext time ${targetAudioCtxTime.toFixed(3)}s (userOffset: ${userOffsetSec.toFixed(2)}s)`);
          await audioEngine.playScheduled(targetAudioCtxTime, position);
        } else {
          // Late arrival fallback: schedule using userOffset or start immediately
          const lateMs = Math.abs(delta);
          const adjustedPosition = position + (lateMs / 1000);
          const totalDuration = audioEngine.getDuration();
          const clampedPosition = Math.min(adjustedPosition, totalDuration);
          const ctx = audioEngine.getAudioContext();

          if (userOffsetSec !== 0) {
            const delayedTarget = Math.max(ctx.currentTime, ctx.currentTime + userOffsetSec);
            console.log(`[Room] Late arrival with userOffset (${userOffsetSec}s). Scheduling at AudioContext time ${delayedTarget.toFixed(3)}s`);
            await audioEngine.playScheduled(delayedTarget, position);
          } else {
            console.log(`[Room] Late arrival (${lateMs.toFixed(1)}ms late). Starting immediately at pos ${clampedPosition.toFixed(2)}s`);
            await audioEngine.playScheduled(0, clampedPosition);
          }
        }
      } else {
        await audioEngine.play();
      }
      setPlaybackState('PLAYING');
      setSyncState('SYNCED');
      } else if (command === 'PAUSE') {
        audioEngine.pause();
        setPlaybackState('PAUSED');
        setDriftStats({ driftMs: 0, playbackRate: 1.0 });
      } else if (command === 'STOP') {
        audioEngine.stop();
        setPlaybackState('STOPPED');
        setCurrentTime(0);
        setSyncState('READY');
        setDriftStats({ driftMs: 0, playbackRate: 1.0 });
      } else if (command === 'SEEK') {
        audioEngine.seek(position);
        setCurrentTime(audioEngine.getCurrentPosition());
        setPlaybackState(audioEngine.getPlaybackState());
        setDriftStats({ driftMs: 0, playbackRate: 1.0 });
      }
    };

    socket.on('DEVICE_UPDATE', handleDeviceUpdate);
    socket.on('SONG_SELECTED', handleSongSelected);
    socket.on('PLAYBACK_COMMAND', handlePlaybackCommand);

    return () => {
      clockSync.stopAutoSync();
      socket.off('DEVICE_UPDATE', handleDeviceUpdate);
      socket.off('SONG_SELECTED', handleSongSelected);
      socket.off('PLAYBACK_COMMAND', handlePlaybackCommand);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [roomCode, isHost]);

  // Preloaded Room Song Auto-Sync on Join & Mount
  useEffect(() => {
    if (initialRoomData && initialRoomData.selectedAudio && songPrepState === 'NO SONG') {
      console.log('[Room Auto-Sync] Preloaded song detected from initialRoomData:', initialRoomData.selectedAudio);
      handleSongSelected(initialRoomData.selectedAudio);
    } else if (songPrepState === 'NO SONG') {
      socket.emit('GET_ROOM_STATE', { roomCode }, (res) => {
        if (res && res.success && res.room && res.room.selectedAudio) {
          console.log('[Room Auto-Sync] Preloaded song fetched via GET_ROOM_STATE:', res.room.selectedAudio);
          handleSongSelected(res.room.selectedAudio);
        }
      });
    }
  }, [initialRoomData, roomCode]);

  // Mobile Screen-Off & Background Recovery (visibilitychange / pageshow / focus)
  useEffect(() => {
    const handleLifecycleRecovery = async () => {
      if (document.visibilityState === 'visible') {
        console.log('[Room Lifecycle] Device foregrounded. Recovering connection & audio state...');
        if (!socket.connected) {
          socket.connect();
        }
        try {
          const ctx = audioEngine.getAudioContext();
          if (ctx && ctx.state === 'suspended') {
            await ctx.resume();
          }
        } catch (e) {}

        if (speakerReady && songPrepState === 'READY') {
          socket.emit('AUDIO_READY', { roomCode });
        }

        socket.emit('GET_ROOM_STATE', { roomCode }, (res) => {
          if (res && res.success && res.room && res.room.selectedAudio && songPrepState === 'NO SONG') {
            handleSongSelected(res.room.selectedAudio);
          }
        });
      }
    };

    document.addEventListener('visibilitychange', handleLifecycleRecovery);
    window.addEventListener('pageshow', handleLifecycleRecovery);
    window.addEventListener('focus', handleLifecycleRecovery);

    return () => {
      document.removeEventListener('visibilitychange', handleLifecycleRecovery);
      window.removeEventListener('pageshow', handleLifecycleRecovery);
      window.removeEventListener('focus', handleLifecycleRecovery);
    };
  }, [roomCode, speakerReady, songPrepState]);

  // Continuous Real-Time Synchronization Loop (500ms interval)
  useEffect(() => {
    if (playbackState !== 'PLAYING' || songPrepState !== 'READY') {
      audioEngine.setPlaybackRate(1.000);
      setDriftStats({ driftMs: 0, playbackRate: 1.0, status: 'Stopped' });
      return;
    }

    const checkDrift = async () => {
      if (audioEngine.getPlaybackState() !== 'PLAYING') return;

      const serverNow = clockSync.getServerTime();
      const playStartPosition = lastCommandRef.current.position;
      const playStartServerTime = lastCommandRef.current.serverTime;

      // 1. Do not evaluate drift during lead time window before scheduled start
      if (serverNow < playStartServerTime) {
        return;
      }

      const totalDuration = audioEngine.getDuration();
      const elapsedSeconds = Math.max(0, (serverNow - playStartServerTime) / 1000);
      const expectedPosition = Math.min(playStartPosition + elapsedSeconds, totalDuration);

      // 2. End-of-song handling: stop drift correction past buffer duration
      if (expectedPosition >= totalDuration) {
        audioEngine.setPlaybackRate(1.000);
        return;
      }

      // 3. Calculate Client Acoustic Sound Position & Drift relative to User Target Offset (ms)
      const userOffsetSec = audioEngine.getUserOffset();
      const clientPosition = audioEngine.getAcousticPosition();
      const targetExpectedPosition = Math.max(0, expectedPosition - userOffsetSec);
      const driftMs = (clientPosition - targetExpectedPosition) * 1000;
      const absDrift = Math.abs(driftMs);

      let currentRate = audioEngine.getPlaybackRate();

      if (absDrift <= 20) {
        // IN SYNC: |drift| <= 20ms
        audioEngine.setPlaybackRate(1.000);
        currentRate = 1.000;
        setDriftStats({ driftMs, playbackRate: 1.000, status: 'Synced' });
      } else {
        // CONTINUOUS SOFT MICRO-TUNING (No hard resync position skips)
        if (driftMs > 0) {
          // Client ahead -> slow down rate
          const targetRate = absDrift > 500 ? 0.980 : 0.995;
          audioEngine.setPlaybackRate(targetRate);
          currentRate = targetRate;
        } else {
          // Client behind -> speed up rate
          const targetRate = absDrift > 500 ? 1.020 : 1.005;
          audioEngine.setPlaybackRate(targetRate);
          currentRate = targetRate;
        }

        // Restore 1.000 once within <= 10ms
        if (absDrift <= 10) {
          audioEngine.setPlaybackRate(1.000);
          currentRate = 1.000;
        }

        setDriftStats({ driftMs, playbackRate: currentRate, status: 'Soft Micro-Tuning' });
      }
    };

    // Run continuous 500ms monitoring loop
    const driftInterval = setInterval(checkDrift, 500);

    return () => {
      clearInterval(driftInterval);
    };
  }, [playbackState, songPrepState]);

  // requestAnimationFrame UI update loop while playing
  useEffect(() => {
    const updateProgress = () => {
      const currentState = audioEngine.getPlaybackState();
      const pos = audioEngine.getCurrentPosition();

      setPlaybackState(currentState);
      setCurrentTime(pos);

      if (currentState === 'PLAYING') {
        animFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };

    if (playbackState === 'PLAYING') {
      animFrameRef.current = requestAnimationFrame(updateProgress);
    } else {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
      setCurrentTime(audioEngine.getCurrentPosition());
    }

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [playbackState]);

  // Real AudioContext Activation (Speaker View gesture trigger)
  const handleEnableSpeaker = async () => {
    setIsActivating(true);
    setAudioError(null);

    try {
      await audioEngine.activate();
      setSpeakerReady(true);
      if (socket.connected) {
        socket.emit('AUDIO_READY', { roomCode });
      }
    } catch (err) {
      setSpeakerReady(false);
      setAudioError('Unable to activate speaker audio. Please try again.');
    } finally {
      setIsActivating(false);
    }
  };

  // Trigger Host File Picker
  const handleOpenPicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = null;
      fileInputRef.current.click();
    }
  };

  // Handle Local Audio File Selection, Local Decoding, & HTTP Backend Upload
  const handleFileChange = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const selectedFile = files[0];
    setFileError(null);
    setSongPrepState('SONG SELECTED');

    try {
      setSongPrepState('PREPARING');
      
      // 1. Local Web Audio Decoding
      const meta = await audioEngine.loadAndDecodeAudioFile(selectedFile);
      setSongMetadata(meta);
      setPlaybackState('STOPPED');
      setCurrentTime(0);

      // 2. Upload File to Backend Server
      const formData = new FormData();
      formData.append('audio', selectedFile);
      formData.append('roomCode', roomCode);
      formData.append('duration', meta.duration);

      const uploadRes = await fetch(`${BACKEND_URL}/upload-audio`, {
        method: 'POST',
        body: formData
      });

      const uploadJson = await uploadRes.json();
      if (!uploadRes.ok || !uploadJson.success) {
        throw new Error(uploadJson.error || 'Server upload failed');
      }

      setSongPrepState('READY');
      setSpeakerReady(true);
      if (socket.connected) {
        socket.emit('AUDIO_READY', { roomCode });
      }
      console.log('[Room] Host audio uploaded and broadcast via backend server.');
    } catch (err) {
      console.error('[SyncBox Room] File decode/upload error:', err);
      setFileError('Unable to process audio file. Please select a valid MP3, WAV, or OGG file.');
      setSongPrepState('NO SONG');
      setSongMetadata(null);
    }
  };

  // Synchronized Host Playback Controls emitting Socket Events
  const handlePlay = () => {
    if (songPrepState !== 'READY' || !socket.connected) return;
    socket.emit('CMD_PLAY', { roomCode, position: currentTime });
  };

  const handlePause = () => {
    if (!socket.connected) return;
    socket.emit('CMD_PAUSE', { roomCode, position: currentTime });
  };

  const handleStop = () => {
    if (!socket.connected) return;
    socket.emit('CMD_STOP', { roomCode });
  };

  const handleSeek = (targetTime) => {
    if (!socket.connected) return;
    socket.emit('CMD_SEEK', { roomCode, position: targetTime });
  };

  // Handle Leaving Room
  const handleLeave = () => {
    clockSync.stopAutoSync();
    if (socket.connected) {
      socket.emit('LEAVE_ROOM');
      socket.disconnect();
    }
    audioEngine.clearAudioBuffer();
    onLeaveRoom();
  };

  return (
    <div className="content-wrapper">
      <Card>
        {/* Hidden HTML File Input for Host */}
        {isHost && (
          <input 
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="audio/*"
            style={{ display: 'none' }}
            id="hidden-file-input"
          />
        )}

        {/* Room Header & Clock/Drift Diagnostics */}
        <div className="room-header">
          <div className="room-title-group">
            <span className="form-label">ROOM CODE</span>
            <div>
              <span className="room-code-badge">{roomCode}</span>
              <span className={`badge ${isHost ? 'badge-host' : 'badge-speaker'} role-badge-header`}>
                {isHost ? 'HOST VIEW' : 'SPEAKER VIEW'}
              </span>
            </div>
            {/* Extended Diagnostics & Per-Device Calibration Controls */}
            <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span className="badge badge-status-default" style={{ fontSize: '0.65rem', textTransform: 'none' }}>
                🕒 Clock: {clockStats.isSynced ? `Offset ${clockStats.offset >= 0 ? '+' : ''}${clockStats.offset.toFixed(1)}ms • RTT ${clockStats.rtt.toFixed(1)}ms` : 'Syncing...'}
              </span>
              <span className="badge badge-status-default" style={{ fontSize: '0.65rem', textTransform: 'none' }}>
                Drift: {driftStats.driftMs >= 0 ? '+' : ''}${driftStats.driftMs.toFixed(0)}ms • Rate ${driftStats.playbackRate.toFixed(3)}x
              </span>
              <span className="badge badge-status-default" style={{ fontSize: '0.65rem', textTransform: 'none' }}>
                {(() => {
                  const details = audioEngine.getOutputLatencyDetails();
                  const base = details.baseSupported ? `${(details.baseLatencySec * 1000).toFixed(0)}ms` : 'unsupported';
                  const out = details.outputSupported ? `${(details.outputLatencySec * 1000).toFixed(0)}ms` : 'unsupported';
                  const ts = details.timestampSupported ? 'supported' : 'unsupported';
                  return `BaseLat: ${base} • OutLat: ${out} • Timestamp: ${ts}`;
                })()}
              </span>
            </div>

            {/* Speaker Interactive Physical Offset Calibration Bar */}
            {!isHost && (
              <div style={{
                marginTop: '0.8rem',
                padding: '0.8rem 1rem',
                background: 'linear-gradient(135deg, rgba(30,41,59,0.7), rgba(15,23,42,0.8))',
                border: '1px solid rgba(148,163,184,0.15)',
                borderRadius: '12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#A7F3D0', letterSpacing: '0.05em' }}>
                    🎛️ SPEAKER OFFSET CALIBRATION
                  </span>
                  <span style={{ fontSize: '0.7rem', color: '#94A3B8' }}>
                    Step: ±0.1s
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.2rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{
                      width: '3.8rem',
                      height: '3.2rem',
                      fontSize: '1.6rem',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '10px',
                      backgroundColor: '#1E293B',
                      borderColor: '#334155',
                      color: '#F8FAFC',
                      cursor: 'pointer',
                      touchAction: 'manipulation',
                      userSelect: 'none',
                      WebkitUserSelect: 'none'
                    }}
                    onTouchStart={(e) => handleAdjustOffset(-0.1, e)}
                    onClick={(e) => handleAdjustOffset(-0.1, e)}
                    title="Decrement offset by -0.1s (-100ms)"
                  >
                    −
                  </button>

                  <div style={{ textAlign: 'center', minWidth: '7.5rem' }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: userOffset === 0 ? '#F8FAFC' : '#38BDF8', fontFamily: 'monospace' }}>
                      {userOffset >= 0 ? `+${userOffset.toFixed(2)}s` : `${userOffset.toFixed(2)}s`}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: '#94A3B8', marginTop: '0.1rem' }}>
                      {userOffset === 0 ? 'Aligned with Host' : userOffset > 0 ? `${(userOffset * 1000).toFixed(0)}ms Delayed` : `${(Math.abs(userOffset) * 1000).toFixed(0)}ms Advanced`}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{
                      width: '3.8rem',
                      height: '3.2rem',
                      fontSize: '1.6rem',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '10px',
                      backgroundColor: '#1E293B',
                      borderColor: '#334155',
                      color: '#F8FAFC',
                      cursor: 'pointer',
                      touchAction: 'manipulation',
                      userSelect: 'none',
                      WebkitUserSelect: 'none'
                    }}
                    onTouchStart={(e) => handleAdjustOffset(+0.1, e)}
                    onClick={(e) => handleAdjustOffset(+0.1, e)}
                    title="Increment offset by +0.1s (+100ms)"
                  >
                    +
                  </button>
                </div>

                {lastTouchLog && (
                  <div style={{ fontSize: '0.65rem', color: '#10B981', marginTop: '0.4rem', textAlign: 'center', fontWeight: 600 }}>
                    ✓ {lastTouchLog}
                  </div>
                )}

                {userOffset !== 0 && (
                  <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      style={{ background: 'none', border: 'none', color: '#64748B', fontSize: '0.65rem', cursor: 'pointer', textDecoration: 'underline', touchAction: 'manipulation' }}
                      onTouchStart={(e) => handleAdjustOffset(0, e)}
                      onClick={(e) => handleAdjustOffset(0, e)}
                    >
                      Reset to 0.00s
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <button 
            className="link-back" 
            style={{ margin: 0 }}
            onClick={handleLeave}
            id="btn-leave-room"
          >
            Leave Room
          </button>
        </div>

        {/* HOST VIEW */}
        {isHost ? (
          <>
            {/* Connected Devices */}
            <div className="form-group">
              <span className="form-label">Connected Devices ({devices.length})</span>
              <div className="device-list">
                {devices.map((dev, idx) => (
                  <DeviceItem 
                    key={dev.socketId || idx} 
                    name={dev.deviceName} 
                    role={dev.role} 
                    status={dev.audioReady ? 'READY' : dev.status} 
                  />
                ))}
              </div>
            </div>

            {/* Audio Preparation Pipeline Status */}
            <div className="form-group">
              <span className="form-label">Audio Preparation</span>
              <div className="song-pipeline-panel">
                <div className="pipeline-status-row">
                  <span className="device-name">
                    {songMetadata ? songMetadata.name : 'No song selected'}
                  </span>
                  <span className="pipeline-badge">{songPrepState}</span>
                </div>

                {fileError && (
                  <div style={{ color: '#FCA5A5', fontSize: '0.85rem', marginTop: '0.4rem' }}>
                    {fileError}
                  </div>
                )}
              </div>
            </div>

            {/* Player Section */}
            <div className="form-group">
              <PlayerControls 
                songName={songMetadata ? songMetadata.name : 'No song selected'}
                playbackState={playbackState}
                currentTime={currentTime}
                duration={songMetadata ? songMetadata.duration : 0}
                sampleRate={songMetadata ? songMetadata.sampleRate : null}
                channels={songMetadata ? songMetadata.numberOfChannels : null}
                onPlay={handlePlay}
                onPause={handlePause}
                onStop={handleStop}
                onSeek={handleSeek}
                onSelectFileClick={handleOpenPicker}
                isHost={true}
              />
            </div>

            {/* Synchronization Status */}
            <div className="form-group">
              <span className="form-label">Synchronization Status</span>
              <SyncStatus status={songPrepState === 'READY' ? syncState : 'WAITING'} />
            </div>
          </>
        ) : (
          /* SPEAKER VIEW */
          <>
            {/* Connected Devices */}
            <div className="form-group">
              <span className="form-label">Connected Room Devices ({devices.length})</span>
              <div className="device-list">
                {devices.map((dev, idx) => (
                  <DeviceItem 
                    key={dev.socketId || idx} 
                    name={dev.deviceName} 
                    role={dev.role} 
                    status={dev.audioReady ? 'READY' : dev.status} 
                  />
                ))}
              </div>
            </div>

            {/* Real Audio Engine Activation */}
            <div className="form-group">
              <SpeakerActivation 
                isReady={speakerReady} 
                onEnable={handleEnableSpeaker} 
                isActivating={isActivating}
                error={audioError}
              />
            </div>

            {/* Current Song & Prep Status */}
            <div className="form-group">
              <span className="form-label">Current Room Song</span>
              <div className="song-pipeline-panel">
                <div className="pipeline-status-row">
                  <span className="device-name">
                    {songMetadata ? songMetadata.name : 'No song selected'}
                  </span>
                  <span className="pipeline-badge">{songPrepState}</span>
                </div>
              </div>
            </div>

            {/* Synchronization Status */}
            <div className="form-group">
              <span className="form-label">Synchronization Status</span>
              <SyncStatus status={speakerReady && songPrepState === 'READY' ? syncState : 'WAITING'} />
            </div>
          </>
        )}
      </Card>

      <div className="mock-notice">
        Phase 7 Active — Client-Centric Drift Correction (3000ms loop, soft rate micro-correction 1.005/0.995x).
      </div>
    </div>
  );
}
