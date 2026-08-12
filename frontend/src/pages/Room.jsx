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

export default function Room({ roomCode = 'ABC123', isHost = true, onLeaveRoom }) {
  // Speaker Web Audio API activation state
  const [speakerReady, setSpeakerReady] = useState(() => audioEngine.isReady());
  const [isActivating, setIsActivating] = useState(false);
  const [audioError, setAudioError] = useState(null);

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
        if (playAtTimestamp) {
          const delta = playAtTimestamp - clockSync.getServerTime();

          if (delta > 0) {
            // Future target: schedule Web Audio start
            const ctx = audioEngine.getAudioContext();
            const targetAudioCtxTime = clockSync.toAudioContextTime(playAtTimestamp, ctx);
            console.log(`[Room] Scheduling playback at AudioContext time ${targetAudioCtxTime.toFixed(3)}s (in ${delta.toFixed(1)}ms)`);
            await audioEngine.playScheduled(targetAudioCtxTime, position);
          } else {
            // Late arrival fallback: start immediately at adjusted position
            const lateMs = Math.abs(delta);
            const adjustedPosition = position + (lateMs / 1000);
            const totalDuration = audioEngine.getDuration();
            const clampedPosition = Math.min(adjustedPosition, totalDuration);
            console.log(`[Room] Late command arrival (${lateMs.toFixed(1)}ms late). Starting immediately at adjusted pos ${clampedPosition.toFixed(2)}s`);
            await audioEngine.playScheduled(0, clampedPosition);
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

  // Phase 7.1 Continuous Real-Time Synchronization Loop (500ms interval)
  useEffect(() => {
    if (playbackState !== 'PLAYING' || songPrepState !== 'READY') {
      audioEngine.setPlaybackRate(1.000);
      setDriftStats({ driftMs: 0, playbackRate: 1.0, status: 'Stopped' });
      isResyncingRef.current = false;
      return;
    }

    const checkDrift = async () => {
      if (audioEngine.getPlaybackState() !== 'PLAYING') return;

      // Ignore drift check if hard resync is currently in progress
      if (isResyncingRef.current) return;

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

      // 3. Calculate Client Position & Drift (ms)
      const clientPosition = audioEngine.getCurrentPosition();
      const driftMs = (clientPosition - expectedPosition) * 1000;
      const absDrift = Math.abs(driftMs);

      let currentRate = audioEngine.getPlaybackRate();

      if (absDrift <= 20) {
        // IN SYNC: |drift| <= 20ms
        audioEngine.setPlaybackRate(1.000);
        currentRate = 1.000;
        setDriftStats({ driftMs, playbackRate: 1.000, status: 'Synced' });
      } else if (absDrift <= 200) {
        // SMALL/MEDIUM DRIFT: 20ms < |drift| <= 200ms
        if (driftMs > 0) {
          // Client ahead -> slow down to 0.995
          audioEngine.setPlaybackRate(0.995);
          currentRate = 0.995;
        } else {
          // Client behind -> speed up to 1.005
          audioEngine.setPlaybackRate(1.005);
          currentRate = 1.005;
        }

        // Restore 1.000 once within <= 10ms
        if (absDrift <= 10) {
          audioEngine.setPlaybackRate(1.000);
          currentRate = 1.000;
        }

        setDriftStats({ driftMs, playbackRate: currentRate, status: 'Soft Correcting' });
      } else {
        // LARGE DRIFT: |drift| > 200ms -> HARD RESYNC to FUTURE Server Timestamp
        console.warn(`[Phase 7.1 Sync] Large drift detected (${driftMs.toFixed(1)}ms). Scheduling future hard resync...`);
        isResyncingRef.current = true;
        setDriftStats({ driftMs, playbackRate: 1.000, status: 'Resyncing...' });

        // Schedule future server timestamp (+500ms)
        const resyncServerTime = serverNow + 500;
        const resyncPosition = Math.min(
          playStartPosition + (resyncServerTime - playStartServerTime) / 1000,
          totalDuration
        );

        const ctx = audioEngine.getAudioContext();
        const targetAudioCtxTime = clockSync.toAudioContextTime(resyncServerTime, ctx);

        audioEngine.setPlaybackRate(1.000);
        await audioEngine.playScheduled(targetAudioCtxTime, resyncPosition);

        // Reset resyncing protection flag once target time has passed
        setTimeout(() => {
          isResyncingRef.current = false;
        }, 600);
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
            {/* Phase 7 Diagnostics Badge */}
            <div style={{ marginTop: '0.4rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span className="badge badge-status-default" style={{ fontSize: '0.65rem', textTransform: 'none' }}>
                🕒 Clock Sync: {clockStats.isSynced ? `Offset ${clockStats.offset >= 0 ? '+' : ''}${clockStats.offset.toFixed(1)}ms • RTT ${clockStats.rtt.toFixed(1)}ms` : 'Syncing...'}
              </span>
              <span className="badge badge-status-default" style={{ fontSize: '0.65rem', textTransform: 'none' }}>
                Drift: {driftStats.status === 'Resyncing...' ? 'Resyncing...' : `${driftStats.driftMs >= 0 ? '+' : ''}${driftStats.driftMs.toFixed(0)}ms • Rate ${driftStats.playbackRate.toFixed(3)}x`}
              </span>
            </div>
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
