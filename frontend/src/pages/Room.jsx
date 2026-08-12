import React, { useState, useEffect, useRef } from 'react';
import Card from '../components/Card';
import DeviceItem from '../components/DeviceItem';
import SyncStatus from '../components/SyncStatus';
import PlayerControls from '../components/PlayerControls';
import SpeakerActivation from '../components/SpeakerActivation';
import Playlist from '../components/Playlist';
import { audioEngine } from '../audio/AudioEngine';
import { clockSync } from '../audio/ClockSync';
import { socket } from '../socket';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

export default function Room({ roomCode = 'ABC123', isHost = true, initialRoomData = null, onLeaveRoom }) {
  // Speaker Web Audio API activation state
  const [speakerReady, setSpeakerReady] = useState(() => audioEngine.isReady());
  const [isActivating, setIsActivating] = useState(false);
  const [audioError, setAudioError] = useState(null);

  // Playlist Queue & Non-Repeating Shuffle State
  const [playlist, setPlaylist] = useState([]);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isShuffle, setIsShuffle] = useState(false);

  // Per-Device Physical Audio Calibration Offset State & Debug Touch Log
  const [userOffset, setUserOffset] = useState(() => audioEngine.getUserOffset());
  const [lastTouchLog, setLastTouchLog] = useState('');
  const lastTapTimeRef = useRef(0);

  // Per-Device Sync Calibration Offset Handler (Touch & Pointer Interception + 250ms Debounce + Live Dynamic Audio Shift)
  const handleAdjustOffset = (deltaSec, e) => {
    if (e) {
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
    }

    // Swallowing duplicate touch/click synthesized events within 250ms
    const now = Date.now();
    if (now - lastTapTimeRef.current < 250) {
      return;
    }
    lastTapTimeRef.current = now;

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
      : `Tapped ${deltaSec > 0 ? '+' : ''}${deltaSec.toFixed(2)}s (Offset: ${newOffset >= 0 ? '+' : ''}${newOffset.toFixed(2)}s)`;
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

  // Refs for tracking timeline command timestamps, touch debouncing, & local file cache
  const lastCommandRef = useRef({ position: 0, serverTime: Date.now() });
  const isResyncingRef = useRef(false);
  const fileInputRef = useRef(null);
  const animFrameRef = useRef(null);
  const localFilesRef = useRef(new Map());
  const isAutoAdvancingRef = useRef(false);
  const lastUiUpdateRef = useRef(0);
  const pendingPlayRef = useRef(false);

  // Synchronization visual state
  const [syncState, setSyncState] = useState('READY');

  // Reconcile full room state upon reconnect or sync
  const reconcileRoomState = (roomData) => {
    if (!roomData) return;
    if (roomData.devices) setDevices(roomData.devices);
    if (roomData.playlist) setPlaylist(roomData.playlist);
    if (typeof roomData.currentTrackIndex === 'number') setCurrentTrackIndex(roomData.currentTrackIndex);
    if (typeof roomData.isShuffle === 'boolean') setIsShuffle(roomData.isShuffle);
    if (roomData.selectedAudio) {
      processSongSelection(roomData.selectedAudio);
    }
  };

  // Top-Level Helper for Processing & Decoding Selected Audio Track (Safe from Scope Errors)
  const processSongSelection = async (payload) => {
    if (!payload || !payload.name) return;
    console.log('[Room] Processing song selection payload:', payload);
    audioEngine.updateMediaSession(payload);

    // Skip redundant decode if AudioEngine already has this exact track loaded
    const currentMeta = audioEngine.getMetadata();
    if (
      currentMeta && 
      currentMeta.name && 
      payload.name && 
      currentMeta.name.trim().toLowerCase() === payload.name.trim().toLowerCase() && 
      audioEngine.getAudioBuffer()
    ) {
      console.log('[Room] Track already loaded in AudioEngine:', payload.name);
      setSongMetadata(currentMeta);
      setSongPrepState('READY');
      if (socket.connected) {
        socket.emit('AUDIO_READY', { roomCode });
      }

      if (isHost && (isAutoAdvancingRef.current || pendingPlayRef.current)) {
        isAutoAdvancingRef.current = false;
        pendingPlayRef.current = false;
        console.log('[Room Host Auto-Advance/PendingPlay] Already loaded. Triggering CMD_PLAY...');
        setTimeout(() => {
          if (socket.connected) socket.emit('CMD_PLAY', { roomCode, position: 0 });
        }, 150);
      }
      return;
    }

    try {
      setSongPrepState('PREPARING');

      let audioFileToDecode = null;
      const rawName = payload.name || '';
      const normName = rawName.trim().toLowerCase();

      // 1. Check if file is cached in local memory (Host instant decode)
      if (localFilesRef.current.has(rawName)) {
        console.log('[Room] Loading track from local file cache:', rawName);
        audioFileToDecode = localFilesRef.current.get(rawName);
      } else if (localFilesRef.current.has(normName)) {
        console.log('[Room] Loading track from normalized local file cache:', normName);
        audioFileToDecode = localFilesRef.current.get(normName);
      } else if (payload.audioUrl) {
        // 2. Fetch audio file from server URL (Speaker or reconnected Host)
        const fullAudioUrl = payload.audioUrl.startsWith('http') 
          ? payload.audioUrl 
          : `${BACKEND_URL}${payload.audioUrl}`;

        console.log('[Room] Downloading track from server URL:', fullAudioUrl);
        const response = await fetch(fullAudioUrl);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const blob = await response.blob();
        audioFileToDecode = new File([blob], payload.name, { type: payload.type || 'audio/mpeg' });
      }

      if (audioFileToDecode) {
        const meta = await audioEngine.loadAndDecodeAudioFile(audioFileToDecode);
        setSongMetadata(meta);
        setSongPrepState('READY');
        console.log('[Room] Track decoded successfully:', payload.name);

        if (socket.connected) {
          socket.emit('AUDIO_READY', { roomCode });
        }

        if (isHost && isAutoAdvancingRef.current) {
          isAutoAdvancingRef.current = false;
          console.log('[Room Host Auto-Advance] Track decoded. Triggering synchronized CMD_PLAY...');
          setTimeout(() => {
            if (socket.connected) socket.emit('CMD_PLAY', { roomCode, position: 0 });
          }, 150);
        }
      } else {
        setSongMetadata({
          name: payload.name,
          duration: payload.duration,
          size: payload.size,
          type: payload.type
        });
        setSongPrepState('READY');
      }
    } catch (err) {
      console.error('[Room] Track decode error:', err);
      isAutoAdvancingRef.current = false;
      setSongPrepState('NO SONG');
      setFileError('Failed to load audio file for selected track.');
    }
  };

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
      console.log('[Room Track End] Current track ended.');
      setPlaybackState('STOPPED');
      setCurrentTime(0);
      setSyncState('READY');
      setDriftStats({ driftMs: 0, playbackRate: 1.0 });

      if (isHost) {
        console.log('[Room Host Auto-Advance] Requesting NEXT_TRACK from room playlist...');
        isAutoAdvancingRef.current = true;
        socket.emit('NEXT_TRACK', { roomCode }, (res) => {
          if (!res || !res.success) {
            isAutoAdvancingRef.current = false;
          }
        });
      }
    });

    // Listen for Real-Time Backend Device List Updates
    const handleDeviceUpdate = (data) => {
      if (data && data.devices) {
        setDevices(data.devices);
      }
    };

    // Listen for Playlist Updates
    const handlePlaylistUpdate = (data) => {
      if (data) {
        if (data.playlist) setPlaylist(data.playlist);
        if (typeof data.currentTrackIndex === 'number') setCurrentTrackIndex(data.currentTrackIndex);
        if (typeof data.isShuffle === 'boolean') setIsShuffle(data.isShuffle);
      }
    };

    socket.on('PLAYLIST_UPDATE', handlePlaylistUpdate);

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

    // Socket Reconnection Handler (Auto-Rejoin Room Channel)
    const handleConnect = () => {
      console.log(`[Room Socket] Reconnected with ID: ${socket.id}. Auto-rejoining room: ${roomCode}`);
      socket.emit('JOIN_ROOM', { roomCode, deviceName: isHost ? 'Laptop' : 'Phone' }, (res) => {
        if (res && res.success) {
          if (speakerReady && songPrepState === 'READY') {
            socket.emit('AUDIO_READY', { roomCode });
          }
          socket.emit('GET_ROOM_STATE', { roomCode }, (stateRes) => {
            if (stateRes && stateRes.success && stateRes.room) {
              reconcileRoomState(stateRes.room);
            }
          });
        }
      });
    };

    socket.on('connect', handleConnect);
    socket.on('DEVICE_UPDATE', handleDeviceUpdate);
    socket.on('SONG_SELECTED', processSongSelection);
    socket.on('PLAYBACK_COMMAND', handlePlaybackCommand);

    return () => {
      clockSync.stopAutoSync();
      socket.off('connect', handleConnect);
      socket.off('DEVICE_UPDATE', handleDeviceUpdate);
      socket.off('SONG_SELECTED', processSongSelection);
      socket.off('PLAYBACK_COMMAND', handlePlaybackCommand);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [roomCode, isHost]);
  useEffect(() => {
    if (initialRoomData && initialRoomData.selectedAudio && songPrepState === 'NO SONG') {
      console.log('[Room Auto-Sync] Preloaded song detected from initialRoomData:', initialRoomData.selectedAudio);
      processSongSelection(initialRoomData.selectedAudio);
    } else if (songPrepState === 'NO SONG') {
      socket.emit('GET_ROOM_STATE', { roomCode }, (res) => {
        if (res && res.success && res.room) {
          reconcileRoomState(res.room);
        }
      });
    }
  }, [initialRoomData, roomCode, songPrepState]);

  // Mobile Screen-Off & Background Recovery (visibilitychange / pageshow / focus)
  useEffect(() => {
    const handleLifecycleRecovery = async () => {
      if (document.visibilityState === 'visible') {
        console.log('[Room Lifecycle] Device foregrounded. Recovering connection & audio state...');
        
        try {
          const ctx = audioEngine.getAudioContext();
          if (ctx && ctx.state === 'suspended') {
            await ctx.resume();
          }
        } catch (e) {}

        if (!socket.connected) {
          socket.connect();
          socket.emit('JOIN_ROOM', { roomCode, deviceName: isHost ? 'Laptop' : 'Phone' }, (res) => {
            if (res && res.success) {
              if (speakerReady && songPrepState === 'READY') {
                socket.emit('AUDIO_READY', { roomCode });
              }
              socket.emit('GET_ROOM_STATE', { roomCode }, (stateRes) => {
                if (stateRes && stateRes.success && stateRes.room) {
                  reconcileRoomState(stateRes.room);
                }
              });
            }
          });
        }
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
  }, [roomCode, isHost, speakerReady, songPrepState]);

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

  // requestAnimationFrame UI update loop while playing (Throttled to 100ms / 10 FPS to prevent tab freezing)
  useEffect(() => {
    const updateProgress = () => {
      const currentState = audioEngine.getPlaybackState();
      const pos = audioEngine.getCurrentPosition();
      const now = performance.now();

      // Only update time state every ~100ms to eliminate main-thread CPU thrashing
      if (now - lastUiUpdateRef.current >= 100) {
        lastUiUpdateRef.current = now;
        setCurrentTime(pos);
        setPlaybackState(prev => prev !== currentState ? currentState : prev);
      }

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
      setTimeout(() => {
        if (fileInputRef.current) {
          fileInputRef.current.click();
        }
      }, 10);
    }
  };

  // Handle Local Audio File Selection (Multi-File Batch Upload Support)
  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files || files.length === 0) return;

    // Immediately stop active playback and reset state so UI is responsive
    audioEngine.stop();
    setPlaybackState('STOPPED');
    setCurrentTime(0);

    // Cache files locally in memory for instant decoding on track switches
    files.forEach(f => {
      localFilesRef.current.set(f.name, f);
      localFilesRef.current.set(f.name.trim().toLowerCase(), f);
    });

    setFileError(null);
    setSongPrepState('PREPARING');

    try {
      // 1. Local Web Audio Decoding for first track (Host instant decode)
      const meta = await audioEngine.loadAndDecodeAudioFile(files[0]);
      setSongMetadata(meta);
      setSongPrepState('READY');
      setSpeakerReady(true);

      if (socket.connected) {
        socket.emit('AUDIO_READY', { roomCode });
      }

      console.log(`[Room] First track decoded locally: ${files[0].name}. Host ready.`);

      // If user tapped PLAY while decoding, auto-start playback immediately!
      if (pendingPlayRef.current) {
        pendingPlayRef.current = false;
        if (socket.connected) {
          console.log('[Room] Executing pending play command after local decode...');
          socket.emit('CMD_PLAY', { roomCode, position: 0 });
        }
      }

      // 2. Asynchronously upload files to server for room speakers (Background Sync)
      (async () => {
        try {
          const formData = new FormData();
          files.forEach(f => formData.append('audio', f));
          formData.append('roomCode', roomCode);
          formData.append('duration', meta.duration);

          const uploadRes = await fetch(`${BACKEND_URL}/upload-audio`, {
            method: 'POST',
            body: formData
          });

          const uploadJson = await uploadRes.json();
          if (uploadRes.ok && uploadJson.success) {
            if (uploadJson.tracks) {
              setPlaylist(uploadJson.tracks);
            }
            console.log(`[Room] Host uploaded ${files.length} tracks to room playlist in background.`);
          }
        } catch (uploadErr) {
          console.warn('[Room] Background upload warning:', uploadErr);
        }
      })();
    } catch (err) {
      console.error('[SyncBox Room] File decode error:', err);
      setFileError('Unable to process audio files. Please select valid MP3, WAV, or OGG files.');
      setSongPrepState('NO SONG');
      setSongMetadata(null);
    }
  };

  const handleToggleShuffle = () => {
    if (!isHost) return;
    socket.emit('TOGGLE_SHUFFLE', { roomCode, isShuffle: !isShuffle });
  };

  const handleSelectPlaylistTrack = (index) => {
    if (!isHost) return;
    isAutoAdvancingRef.current = false;
    socket.emit('SELECT_TRACK', { roomCode, trackIndex: index });
  };

  // Synchronized Host Playback Controls emitting Socket Events
  const handlePlay = () => {
    if (!socket.connected) return;

    if (songPrepState !== 'READY') {
      console.log('[Room] Play tapped while song is preparing. Queuing auto-play once ready...');
      pendingPlayRef.current = true;
      return;
    }

    isAutoAdvancingRef.current = false;
    pendingPlayRef.current = false;
    socket.emit('CMD_PLAY', { roomCode, position: currentTime });
  };

  const handlePause = () => {
    if (!socket.connected) return;
    isAutoAdvancingRef.current = false;
    socket.emit('CMD_PAUSE', { roomCode, position: currentTime });
  };

  const handleStop = () => {
    if (!socket.connected) return;
    isAutoAdvancingRef.current = false;
    socket.emit('CMD_STOP', { roomCode });
  };

  const handleSeek = (targetTime) => {
    if (!socket.connected) return;
    isAutoAdvancingRef.current = false;
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
        {/* Hidden HTML File Input for Host (Multi-File Batch Selection Support) */}
        {isHost && (
          <input 
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept=".mp3,.wav,.ogg,.m4a,.aac,.flac,audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/aac,audio/flac,audio/mp4"
            multiple
            style={{ display: 'none' }}
            id="hidden-file-input"
          />
        )}

        {/* Room Top Header Bar with Room Code & Styled Red Leave Room Button Box */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.8rem',
          flexWrap: 'wrap',
          marginBottom: '1rem',
          paddingBottom: '0.8rem',
          borderBottom: '1px solid #334155'
        }}>
          <div>
            <span className="form-label" style={{ display: 'block', marginBottom: '0.2rem' }}>ROOM CODE</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span className="room-code-badge">{roomCode}</span>
              <span className={`badge ${isHost ? 'badge-host' : 'badge-speaker'} role-badge-header`}>
                {isHost ? 'HOST VIEW' : 'SPEAKER VIEW'}
              </span>
            </div>
          </div>

          {/* Styled Red Box Button for Leaving Room */}
          <button 
            type="button"
            onClick={handleLeave}
            id="btn-leave-room"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.5rem 0.95rem',
              fontSize: '0.8rem',
              fontWeight: 700,
              backgroundColor: '#3F1D1D',
              border: '1.5px solid #EF4444',
              color: '#FCA5A5',
              borderRadius: '10px',
              cursor: 'pointer',
              touchAction: 'manipulation',
              boxShadow: '0 2px 8px rgba(239, 68, 68, 0.25)',
              transition: 'all 0.2s ease',
              whiteSpace: 'nowrap'
            }}
          >
            <span>🚪</span>
            <span>Leave Room</span>
          </button>
        </div>

        {/* Extended Diagnostics & Per-Device Calibration Controls */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
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
                  Step: ±0.05s
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
                  onTouchStart={(e) => handleAdjustOffset(-0.05, e)}
                  onClick={(e) => handleAdjustOffset(-0.05, e)}
                  title="Decrement offset by -0.05s (-50ms)"
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
                  onTouchStart={(e) => handleAdjustOffset(+0.05, e)}
                  onClick={(e) => handleAdjustOffset(+0.05, e)}
                  title="Increment offset by +0.05s (+50ms)"
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
                songPrepState={songPrepState}
              />
            </div>

            {/* Playlist Queue Section */}
            <Playlist 
              playlist={playlist}
              currentTrackIndex={currentTrackIndex}
              isShuffle={isShuffle}
              isHost={true}
              onToggleShuffle={handleToggleShuffle}
              onSelectTrack={handleSelectPlaylistTrack}
            />

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

            {/* Speaker Playlist View */}
            <Playlist 
              playlist={playlist}
              currentTrackIndex={currentTrackIndex}
              isShuffle={isShuffle}
              isHost={false}
            />

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
