import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer Storage Setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp3';
    const uniqueName = `song_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${ext}`;
    cb(null, uniqueName);
  }
});

// File filter strictly for MP3, WAV, OGG
const fileFilter = (req, file, cb) => {
  const allowedMimeTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/vorbis'];
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedExtensions = ['.mp3', '.wav', '.ogg'];

  if (allowedMimeTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid audio format. Only MP3, WAV, and OGG files are supported.'));
  }
};

export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max limit
});

/**
 * Registers HTTP audio routes and handles upload / download pipeline.
 */
export function registerAudioRoutes(app, roomManager, io) {
  // 1. POST /upload-audio (Host File Upload)
  app.post('/upload-audio', (req, res) => {
    upload.single('audio')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: 'File size exceeds maximum 50MB limit.' });
        }
        return res.status(400).json({ success: false, error: err.message || 'Audio upload failed.' });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No audio file provided in upload request.' });
      }

      const roomCode = req.body.roomCode;
      if (!roomCode) {
        // Clean up uploaded file if roomCode is missing
        fs.unlink(req.file.path, () => {});
        return res.status(400).json({ success: false, error: 'roomCode is required.' });
      }

      const room = roomManager.getRoom(roomCode);
      if (!room) {
        fs.unlink(req.file.path, () => {});
        return res.status(404).json({ success: false, error: 'Room not found. Please check your room code.' });
      }

      const songId = path.basename(req.file.filename, path.extname(req.file.filename));
      const audioUrl = `/audio/${songId}`;

      const audioData = {
        songId: songId,
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype,
        duration: req.body.duration ? Number(req.body.duration) : 0,
        filePath: req.file.path,
        audioUrl: audioUrl
      };

      roomManager.setRoomAudio(roomCode, audioData);
      console.log(`[SyncBox Backend] Audio uploaded for room ${roomCode}: ${audioData.name} (${songId})`);

      // Broadcast SONG_SELECTED over Socket.IO to room members
      io.to(room.roomCode).emit('SONG_SELECTED', {
        songId: audioData.songId,
        name: audioData.name,
        size: audioData.size,
        type: audioData.type,
        duration: audioData.duration,
        audioUrl: audioData.audioUrl
      });

      // Broadcast updated device list (audioReady reset to false)
      io.to(room.roomCode).emit('DEVICE_UPDATE', {
        roomCode: room.roomCode,
        devices: Array.from(room.devices.values())
      });

      return res.status(200).json({
        success: true,
        songId: audioData.songId,
        name: audioData.name,
        audioUrl: audioData.audioUrl
      });
    });
  });

  // 2. GET /audio/:songId (Speaker HTTP File Download)
  app.get('/audio/:songId', (req, res) => {
    const { songId } = req.params;
    const audioData = roomManager.getAudioBySongId(songId);

    if (!audioData || !fs.existsSync(audioData.filePath)) {
      return res.status(404).json({ success: false, error: 'Audio file not found.' });
    }

    res.sendFile(path.resolve(audioData.filePath));
  });
}
