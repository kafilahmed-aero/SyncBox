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
  // 1. POST /upload-audio (Host File Batch Upload)
  app.post('/upload-audio', (req, res) => {
    upload.array('audio', 20)(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: 'File size exceeds maximum 50MB limit.' });
        }
        return res.status(400).json({ success: false, error: err.message || 'Audio upload failed.' });
      }

      const files = req.files || (req.file ? [req.file] : []);
      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, error: 'No audio files provided in upload request.' });
      }

      const roomCode = req.body.roomCode;
      if (!roomCode) {
        files.forEach(f => fs.unlink(f.path, () => {}));
        return res.status(400).json({ success: false, error: 'roomCode is required.' });
      }

      const room = roomManager.getRoom(roomCode);
      if (!room) {
        files.forEach(f => fs.unlink(f.path, () => {}));
        return res.status(404).json({ success: false, error: 'Room not found. Please check your room code.' });
      }

      const uploadedTracks = files.map((f, idx) => {
        const songId = path.basename(f.filename, path.extname(f.filename));
        const audioUrl = `/audio/${songId}`;
        return {
          songId: songId,
          name: f.originalname,
          size: f.size,
          type: f.mimetype,
          duration: req.body.durations ? (Array.isArray(req.body.durations) ? Number(req.body.durations[idx]) : Number(req.body.durations)) : 0,
          filePath: f.path,
          audioUrl: audioUrl
        };
      });

      const updatedRoom = roomManager.setRoomPlaylist(roomCode, uploadedTracks);
      console.log(`[SyncBox Backend] ${uploadedTracks.length} tracks uploaded for room ${roomCode}`);

      const currentTrack = updatedRoom ? updatedRoom.selectedAudio : uploadedTracks[0];

      // Broadcast SONG_SELECTED for first track over Socket.IO to room members
      if (currentTrack) {
        const { filePath, ...publicAudio } = currentTrack;
        io.to(room.roomCode).emit('SONG_SELECTED', publicAudio);
      }

      // Broadcast PLAYLIST_UPDATE over Socket.IO
      const publicPlaylist = (updatedRoom ? updatedRoom.playlist : uploadedTracks).map(t => {
        const { filePath, ...pub } = t;
        return pub;
      });
      io.to(room.roomCode).emit('PLAYLIST_UPDATE', {
        playlist: publicPlaylist,
        currentTrackIndex: updatedRoom ? updatedRoom.currentTrackIndex : 0,
        isShuffle: updatedRoom ? updatedRoom.isShuffle : false
      });

      // Broadcast updated device list (audioReady reset to false)
      io.to(room.roomCode).emit('DEVICE_UPDATE', {
        roomCode: room.roomCode,
        devices: Array.from(room.devices.values())
      });

      return res.status(200).json({
        success: true,
        tracks: publicPlaylist,
        selectedAudio: currentTrack
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
