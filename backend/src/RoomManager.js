import fs from 'fs';

/**
 * RoomManager.js — In-memory Room, Device, Audio, & Playback Command Management for SyncBox Backend.
 */

export class RoomManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> Room Object
    this.socketToRoom = new Map(); // socketId -> roomCode
  }

  /**
   * Generates a unique 6-character uppercase room code.
   * Omits easily confused characters (0, O, 1, I).
   */
  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  /**
   * Creates a new room with host device.
   */
  createRoom(hostSocketId, hostDeviceName = 'Laptop') {
    const code = this.generateRoomCode();
    const hostDevice = {
      deviceId: hostSocketId,
      socketId: hostSocketId,
      deviceName: hostDeviceName || 'Laptop',
      role: 'HOST',
      status: 'CONNECTED',
      audioReady: false
    };

    const room = {
      roomCode: code,
      hostId: hostSocketId,
      createdAt: Date.now(),
      playbackState: 'STOPPED',
      lastPlaybackPosition: 0,
      lastCommandTimestamp: null,
      selectedAudio: null,
      playlist: [],
      unplayedIndices: [],
      currentTrackIndex: 0,
      isShuffle: false,
      devices: new Map([[hostSocketId, hostDevice]])
    };

    this.rooms.set(code, room);
    this.socketToRoom.set(hostSocketId, code);

    return {
      success: true,
      roomCode: code,
      room: this.serializeRoom(code)
    };
  }

  /**
   * Adds or re-binds a speaker/host device to an existing room.
   * Supports idempotent socket ID updates upon reconnection.
   */
  joinRoom(roomCode, socketId, deviceName = 'Phone') {
    if (!roomCode) {
      return { success: false, error: 'Room code is required.' };
    }

    const code = String(roomCode).trim().toUpperCase();
    if (!this.rooms.has(code)) {
      return { success: false, error: 'Room not found. Please check your room code.' };
    }

    const room = this.rooms.get(code);
    const requestedName = deviceName || 'Phone';

    // Check if a device with the same deviceName already exists in room
    let existingOldSocketId = null;
    let existingRole = 'SPEAKER';
    let existingAudioReady = false;

    for (const [oldSockId, dev] of room.devices.entries()) {
      if (dev.deviceName === requestedName || (requestedName === 'Laptop' && dev.role === 'HOST')) {
        existingOldSocketId = oldSockId;
        existingRole = dev.role;
        existingAudioReady = dev.audioReady;
        break;
      }
    }

    // Clean up stale old socket mapping if rejoining
    if (existingOldSocketId) {
      room.devices.delete(existingOldSocketId);
      this.socketToRoom.delete(existingOldSocketId);
      if (existingRole === 'HOST' || room.hostId === existingOldSocketId) {
        room.hostId = socketId;
      }
    }

    const device = {
      deviceId: socketId,
      socketId: socketId,
      deviceName: requestedName,
      role: existingRole,
      status: 'CONNECTED',
      audioReady: existingAudioReady
    };

    room.devices.set(socketId, device);
    this.socketToRoom.set(socketId, code);

    return {
      success: true,
      roomCode: code,
      room: this.serializeRoom(code)
    };
  }

  /**
   * Sets current audio data for a room.
   */
  setRoomAudio(roomCode, audioData) {
    if (!roomCode) return null;
    const code = String(roomCode).trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return null;

    // Clean up previous temporary file if different
    if (room.selectedAudio && room.selectedAudio.filePath && room.selectedAudio.filePath !== audioData.filePath) {
      fs.unlink(room.selectedAudio.filePath, (err) => {
        if (err) console.error(`[RoomManager] Error deleting old audio file:`, err.message);
      });
    }

    room.selectedAudio = audioData;

    // Reset audioReady state for devices when a new song is selected
    for (const dev of room.devices.values()) {
      dev.audioReady = false;
    }

    return room;
  }

  /**
   * Finds audio file metadata by songId across active rooms.
   */
  getAudioBySongId(songId) {
    for (const room of this.rooms.values()) {
      if (room.selectedAudio && room.selectedAudio.songId === songId) {
        return room.selectedAudio;
      }
    }
    return null;
  }

  /**
   * Updates audioReady state for a specific device.
   */
  setDeviceAudioReady(socketId, readyState = true) {
    if (!this.socketToRoom.has(socketId)) return null;

    const code = this.socketToRoom.get(socketId);
    const room = this.rooms.get(code);
    if (!room) return null;

    const device = room.devices.get(socketId);
    if (device) {
      device.audioReady = Boolean(readyState);
    }

    return {
      roomCode: code,
      devices: Array.from(room.devices.values())
    };
  }

  /**
   * Updates room playback state and position if issued by the HOST.
   */
  updateRoomPlaybackState(roomCode, socketId, command, position = 0) {
    if (!roomCode) {
      return { success: false, error: 'Room code is required.' };
    }

    const code = String(roomCode).trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) {
      return { success: false, error: 'Room not found. Please check your room code.' };
    }

    // Host Authorization Validation
    if (socketId !== room.hostId) {
      return { success: false, error: 'Only the room HOST can issue playback commands.' };
    }

    const serverTimestamp = Date.now();
    const targetPosition = Math.max(0, Number(position) || 0);
    let playAtTimestamp = undefined;

    if (command === 'PLAY') {
      if (!room.selectedAudio) {
        return { success: false, error: 'No audio selected in room.' };
      }
      room.playbackState = 'PLAYING';
      room.lastPlaybackPosition = targetPosition;
      room.lastCommandTimestamp = serverTimestamp;
      playAtTimestamp = serverTimestamp + 2000; // 2000ms lead time for PLAY
    } else if (command === 'PAUSE') {
      room.playbackState = 'PAUSED';
      room.lastPlaybackPosition = targetPosition;
      room.lastCommandTimestamp = serverTimestamp;
    } else if (command === 'STOP') {
      room.playbackState = 'STOPPED';
      room.lastPlaybackPosition = 0;
      room.lastCommandTimestamp = serverTimestamp;
    } else if (command === 'SEEK') {
      room.lastPlaybackPosition = targetPosition;
      room.lastCommandTimestamp = serverTimestamp;
    } else {
      return { success: false, error: `Invalid playback command: ${command}` };
    }

    return {
      success: true,
      roomCode: code,
      command: command,
      position: room.lastPlaybackPosition,
      serverTime: room.lastCommandTimestamp,
      playAtTimestamp: playAtTimestamp,
      playbackState: room.playbackState
    };
  }

  /**
   * Removes a device from its room. Cleans up room & temporary file if empty.
   */
  leaveRoom(socketId) {
    if (!this.socketToRoom.has(socketId)) {
      return null;
    }

    const code = this.socketToRoom.get(socketId);
    this.socketToRoom.delete(socketId);

    if (!this.rooms.has(code)) {
      return null;
    }

    const room = this.rooms.get(code);
    room.devices.delete(socketId);

    if (room.devices.size === 0) {
      // Clean up temporary audio file on room destruction
      if (room.selectedAudio && room.selectedAudio.filePath) {
        fs.unlink(room.selectedAudio.filePath, (err) => {
          if (err && err.code !== 'ENOENT') {
            console.error(`[RoomManager] Error deleting temporary file on room deletion:`, err.message);
          }
        });
      }

      this.rooms.delete(code);
      return {
        roomCode: code,
        roomDeleted: true,
        devices: []
      };
    }

    return {
      roomCode: code,
      roomDeleted: false,
      devices: Array.from(room.devices.values())
    };
  }

  /**
   * Sets/appends tracks to room playlist and initializes Fisher-Yates unplayed indices pool.
   */
  setRoomPlaylist(roomCode, newTracks = []) {
    if (!roomCode) return null;
    const code = String(roomCode).trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return null;

    if (!Array.isArray(newTracks) || newTracks.length === 0) return room;

    room.playlist = newTracks;
    room.currentTrackIndex = 0;
    room.selectedAudio = newTracks[0];

    // Reset Fisher-Yates unplayed indices pool
    room.unplayedIndices = newTracks.map((_, idx) => idx).filter(idx => idx !== 0);

    // Reset audioReady state for devices
    for (const dev of room.devices.values()) {
      dev.audioReady = false;
    }

    return room;
  }

  /**
   * Returns next track from room playlist (supports Non-Repeating Shuffle & Sequential Endless Loop).
   */
  getNextTrack(roomCode) {
    if (!roomCode) return null;
    const code = String(roomCode).trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room || !room.playlist || room.playlist.length === 0) return null;

    if (room.playlist.length === 1) {
      return {
        track: room.playlist[0],
        currentTrackIndex: 0,
        playlist: room.playlist
      };
    }

    let nextIndex = 0;
    if (room.isShuffle) {
      // Fisher-Yates Non-Repeating Shuffle Pool Algorithm
      if (!room.unplayedIndices || room.unplayedIndices.length === 0) {
        // All songs in playlist have played! Reset pool excluding current track
        room.unplayedIndices = room.playlist
          .map((_, idx) => idx)
          .filter(idx => idx !== room.currentTrackIndex);
      }

      // Pick a random index exclusively from the unplayed pool
      const randomPoolIdx = Math.floor(Math.random() * room.unplayedIndices.length);
      nextIndex = room.unplayedIndices[randomPoolIdx];
      // Remove selected track from unplayed pool
      room.unplayedIndices.splice(randomPoolIdx, 1);
    } else {
      // Sequential Loop Order (0 -> 1 -> 2 -> 0)
      nextIndex = (room.currentTrackIndex + 1) % room.playlist.length;
    }

    room.currentTrackIndex = nextIndex;
    room.selectedAudio = room.playlist[nextIndex];

    // Reset audioReady state for devices
    for (const dev of room.devices.values()) {
      dev.audioReady = false;
    }

    return {
      track: room.selectedAudio,
      currentTrackIndex: nextIndex,
      playlist: room.playlist
    };
  }

  /**
   * Toggles or sets Shuffle mode for room playlist.
   */
  setShuffleMode(roomCode, isShuffle) {
    if (!roomCode) return null;
    const code = String(roomCode).trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return null;

    room.isShuffle = Boolean(isShuffle);
    // Reset unplayed indices pool excluding current track
    if (room.playlist && room.playlist.length > 0) {
      room.unplayedIndices = room.playlist
        .map((_, idx) => idx)
        .filter(idx => idx !== room.currentTrackIndex);
    }

    return room;
  }

  /**
   * Returns formatted JSON-serializable room object.
   */
  serializeRoom(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    // Omit internal filePath from client serialization
    let selectedAudioPublic = null;
    if (room.selectedAudio) {
      const { filePath, ...publicAudio } = room.selectedAudio;
      selectedAudioPublic = publicAudio;
    }

    const publicPlaylist = (room.playlist || []).map(t => {
      const { filePath, ...pub } = t;
      return pub;
    });

    return {
      roomCode: room.roomCode,
      hostId: room.hostId,
      createdAt: room.createdAt,
      playbackState: room.playbackState,
      lastPlaybackPosition: room.lastPlaybackPosition,
      lastCommandTimestamp: room.lastCommandTimestamp,
      selectedAudio: selectedAudioPublic,
      playlist: publicPlaylist,
      currentTrackIndex: room.currentTrackIndex || 0,
      isShuffle: Boolean(room.isShuffle),
      devices: Array.from(room.devices.values())
    };
  }

  /**
   * Returns room code associated with a socket ID.
   */
  getRoomBySocket(socketId) {
    return this.socketToRoom.get(socketId) || null;
  }

  /**
   * Returns active room object.
   */
  getRoom(roomCode) {
    if (!roomCode) return null;
    return this.rooms.get(String(roomCode).trim().toUpperCase()) || null;
  }
}
