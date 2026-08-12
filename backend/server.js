import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { RoomManager } from './src/RoomManager.js';
import { registerAudioRoutes } from './src/audioHandler.js';

const PORT = process.env.PORT || 4000;
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  ...(process.env.CLIENT_ORIGIN ? [process.env.CLIENT_ORIGIN] : ['https://sync-box-blond.vercel.app'])
];

const app = express();
const roomManager = new RoomManager();

// Express Middleware
app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST']
}));
app.use(express.json());

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Create HTTP Server
const server = http.createServer(app);

// Initialize Socket.IO with consistent CORS rules
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST']
  }
});

// Mount Audio HTTP Routes (POST /upload-audio, GET /audio/:songId)
registerAudioRoutes(app, roomManager, io);

// Socket.IO Room & Device Management Handlers
io.on('connection', (socket) => {
  console.log(`[SyncBox Backend] Client connected: ${socket.id}`);

  // 1. CREATE_ROOM
  socket.on('CREATE_ROOM', (data = {}, callback) => {
    const deviceName = data.deviceName || 'Laptop';
    const result = roomManager.createRoom(socket.id, deviceName);

    socket.join(result.roomCode);
    console.log(`[SyncBox Backend] Room created: ${result.roomCode} by Host ${socket.id} (${deviceName})`);

    if (typeof callback === 'function') {
      callback(result);
    }

    // Broadcast device update to room members
    io.to(result.roomCode).emit('DEVICE_UPDATE', {
      roomCode: result.roomCode,
      devices: result.room.devices
    });
  });

  // 2. JOIN_ROOM
  socket.on('JOIN_ROOM', (data = {}, callback) => {
    const { roomCode, deviceName } = data;
    const result = roomManager.joinRoom(roomCode, socket.id, deviceName || 'Phone');

    if (result.success) {
      socket.join(result.roomCode);
      console.log(`[SyncBox Backend] Client ${socket.id} (${deviceName || 'Phone'}) joined room: ${result.roomCode}`);

      // Broadcast updated device list to all room members
      io.to(result.roomCode).emit('DEVICE_UPDATE', {
        roomCode: result.roomCode,
        devices: result.room.devices
      });

      // If room already has selected audio, notify newly joined device
      const room = roomManager.getRoom(result.roomCode);
      if (room && room.selectedAudio) {
        const { filePath, ...publicAudio } = room.selectedAudio;
        socket.emit('SONG_SELECTED', publicAudio);
      }
    } else {
      console.log(`[SyncBox Backend] Join failed for ${socket.id} on code '${roomCode}': ${result.error}`);
    }

    if (typeof callback === 'function') {
      callback(result);
    }
  });

  // GET_ROOM_STATE (Fetch complete room state for newly joined or reconnected devices)
  socket.on('GET_ROOM_STATE', (data = {}, callback) => {
    const roomCode = data.roomCode || roomManager.getRoomBySocket(socket.id);
    const serialized = roomManager.serializeRoom(roomCode);
    if (typeof callback === 'function') {
      callback({ success: !!serialized, room: serialized });
    }
  });

  // 3. LEAVE_ROOM
  socket.on('LEAVE_ROOM', (data = {}, callback) => {
    const result = roomManager.leaveRoom(socket.id);

    if (result) {
      socket.leave(result.roomCode);
      console.log(`[SyncBox Backend] Client ${socket.id} left room: ${result.roomCode}`);

      if (!result.roomDeleted) {
        io.to(result.roomCode).emit('DEVICE_UPDATE', {
          roomCode: result.roomCode,
          devices: result.devices
        });
      } else {
        console.log(`[SyncBox Backend] Room ${result.roomCode} deleted (empty)`);
      }
    }

    if (typeof callback === 'function') {
      callback({ success: true });
    }
  });

  // 4. AUDIO_READY
  socket.on('AUDIO_READY', (data = {}, callback) => {
    const result = roomManager.setDeviceAudioReady(socket.id, true);

    if (result) {
      console.log(`[SyncBox Backend] Client ${socket.id} reported AUDIO_READY in room ${result.roomCode}`);
      io.to(result.roomCode).emit('DEVICE_UPDATE', {
        roomCode: result.roomCode,
        devices: result.devices
      });
    }

    if (typeof callback === 'function') {
      callback({ success: true });
    }
  });

  // 5. SYNC_REQUEST (Clock Synchronization)
  socket.on('SYNC_REQUEST', (data = {}, callback) => {
    const t2 = Date.now();
    const t3 = Date.now();

    if (typeof callback === 'function') {
      callback({
        t1: data.t1,
        t2: t2,
        t3: t3
      });
    }
  });

  // 6. PLAYBACK COMMANDS (CMD_PLAY, CMD_PAUSE, CMD_STOP, CMD_SEEK)
  const handlePlaybackCommand = (commandType, socket, data = {}, callback) => {
    const { roomCode, position } = data;
    const result = roomManager.updateRoomPlaybackState(roomCode, socket.id, commandType, position);

    if (result.success) {
      console.log(`[SyncBox Backend] Host issued ${commandType} at ${result.position}s in room ${result.roomCode}`);
      const payload = {
        command: commandType,
        position: result.position,
        serverTime: result.serverTime
      };

      if (commandType === 'PLAY' && result.playAtTimestamp) {
        payload.playAtTimestamp = result.playAtTimestamp;
      }

      io.to(result.roomCode).emit('PLAYBACK_COMMAND', payload);
    } else {
      console.log(`[SyncBox Backend] Playback command ${commandType} rejected for ${socket.id}: ${result.error}`);
    }

    if (typeof callback === 'function') {
      callback(result);
    }
  };

  socket.on('CMD_PLAY', (data, cb) => handlePlaybackCommand('PLAY', socket, data, cb));
  socket.on('CMD_PAUSE', (data, cb) => handlePlaybackCommand('PAUSE', socket, data, cb));
  socket.on('CMD_STOP', (data, cb) => handlePlaybackCommand('STOP', socket, data, cb));
  socket.on('CMD_SEEK', (data, cb) => handlePlaybackCommand('SEEK', socket, data, cb));

  // 7. DISCONNECT
  socket.on('disconnect', (reason) => {
    console.log(`[SyncBox Backend] Client disconnected: ${socket.id} (Reason: ${reason})`);
    
    const result = roomManager.leaveRoom(socket.id);
    if (result) {
      if (!result.roomDeleted) {
        io.to(result.roomCode).emit('DEVICE_UPDATE', {
          roomCode: result.roomCode,
          devices: result.devices
        });
      } else {
        console.log(`[SyncBox Backend] Room ${result.roomCode} deleted (empty on disconnect)`);
      }
    }
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`[SyncBox Backend] Server running on http://localhost:${PORT}`);
  console.log(`[SyncBox Backend] Health check available at http://localhost:${PORT}/health`);
});
