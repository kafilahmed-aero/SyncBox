import fs from 'fs';
import path from 'path';
import http from 'http';
import { io as ioClient } from 'socket.io-client';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_URL = 'http://localhost:4000';
const TEMP_TEST_FILE = path.join(__dirname, 'dummy_test_track.wav');

// Create minimal valid 44-byte WAV header buffer
function createDummyWavBuffer() {
  const buffer = Buffer.alloc(44 + 100); // 44 bytes header + 100 bytes PCM data
  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(140, 4);
  buffer.write('WAVE', 8);
  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // Subchunk1Size
  buffer.writeUInt16LE(1, 20);  // AudioFormat (PCM)
  buffer.writeUInt16LE(2, 22);  // NumChannels (Stereo)
  buffer.writeUInt32LE(44100, 24); // SampleRate
  buffer.writeUInt32LE(176400, 28); // ByteRate
  buffer.writeUInt16LE(4, 32);  // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample
  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(100, 40);
  return buffer;
}

// Helper to send HTTP multipart form POST
function uploadFile(url, filePath, roomCode, duration) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const fileContent = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    let body = '';
    // Form field: roomCode
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="roomCode"\r\n\r\n${roomCode}\r\n`;
    // Form field: duration
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="duration"\r\n\r\n${duration}\r\n`;
    // Form field: audio file
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="audio"; filename="${filename}"\r\n`;
    body += `Content-Type: audio/wav\r\n\r\n`;

    const bodyHead = Buffer.from(body, 'utf8');
    const bodyTail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
    const payload = Buffer.concat([bodyHead, fileContent, bodyTail]);

    const req = http.request(`${SERVER_URL}/upload-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': payload.length
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ statusCode: res.statusCode, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Helper to issue GET request for audio download
function downloadAudio(audioUrl) {
  return new Promise((resolve, reject) => {
    http.get(`${SERVER_URL}${audioUrl}`, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          buffer: Buffer.concat(chunks)
        });
      });
    }).on('error', reject);
  });
}

async function runTests() {
  console.log('--- Starting SyncBox Backend Phase 3 Audio Tests ---');

  // Create temporary test WAV file on disk
  fs.writeFileSync(TEMP_TEST_FILE, createDummyWavBuffer());

  const createClient = () => {
    return new Promise((resolve, reject) => {
      const socket = ioClient(SERVER_URL, { transports: ['websocket'], forceNew: true });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  };

  let uploadedFilePathOnServer = null;

  try {
    // 1. Connect Host & Speaker
    console.log('[Test 1] Connecting Host and Speaker sockets...');
    const hostSocket = await createClient();
    const speakerSocket = await createClient();

    // 2. Host creates room
    const createRes = await new Promise((resolve) => {
      hostSocket.emit('CREATE_ROOM', { deviceName: 'Laptop' }, resolve);
    });
    const roomCode = createRes.roomCode;
    console.log(`✓ Host created room: ${roomCode}`);

    // 3. Speaker joins room
    await new Promise((resolve) => {
      speakerSocket.emit('JOIN_ROOM', { roomCode, deviceName: 'Phone' }, resolve);
    });
    console.log(`✓ Speaker joined room: ${roomCode}`);

    // 4. Host uploads audio file
    console.log('[Test 2] Host uploading audio file via HTTP POST /upload-audio...');

    let songSelectedPromise = new Promise((resolve) => {
      speakerSocket.once('SONG_SELECTED', resolve);
    });

    const uploadRes = await uploadFile(`${SERVER_URL}/upload-audio`, TEMP_TEST_FILE, roomCode, 120.5);

    if (uploadRes.statusCode !== 200 || !uploadRes.body.success) {
      throw new Error(`Audio upload failed: ${JSON.stringify(uploadRes.body)}`);
    }

    const { songId, audioUrl } = uploadRes.body;
    console.log(`✓ Audio uploaded successfully. songId: ${songId}, audioUrl: ${audioUrl}`);

    // 5. Speaker receives SONG_SELECTED event
    const songSelectedPayload = await songSelectedPromise;
    if (songSelectedPayload.songId !== songId || songSelectedPayload.audioUrl !== audioUrl) {
      throw new Error(`SONG_SELECTED payload mismatch: ${JSON.stringify(songSelectedPayload)}`);
    }
    console.log(`✓ Speaker received SONG_SELECTED socket event: ${songSelectedPayload.name} (${songSelectedPayload.audioUrl})`);

    // 6. Speaker downloads audio file via HTTP GET
    console.log('[Test 3] Speaker downloading audio file via HTTP GET...');
    const downloadRes = await downloadAudio(audioUrl);
    if (downloadRes.statusCode !== 200 || downloadRes.buffer.length < 44) {
      throw new Error(`Audio download failed: HTTP status ${downloadRes.statusCode}`);
    }
    console.log(`✓ Speaker downloaded audio file successfully (${downloadRes.buffer.length} bytes received)`);

    // 7. Speaker emits AUDIO_READY
    console.log('[Test 4] Speaker emitting AUDIO_READY event...');
    let deviceUpdatePromise = new Promise((resolve) => {
      hostSocket.once('DEVICE_UPDATE', resolve);
    });

    const readyRes = await new Promise((resolve) => {
      speakerSocket.emit('AUDIO_READY', { roomCode }, resolve);
    });
    if (!readyRes.success) throw new Error('AUDIO_READY failed');

    const deviceUpdate = await deviceUpdatePromise;
    const speakerDevice = deviceUpdate.devices.find(d => d.role === 'SPEAKER');
    if (!speakerDevice || !speakerDevice.audioReady) {
      throw new Error(`Speaker audioReady state not updated in DEVICE_UPDATE: ${JSON.stringify(deviceUpdate)}`);
    }
    console.log(`✓ Host received DEVICE_UPDATE confirming speaker audioReady = true`);

    // 8. Test Invalid Room Code Upload Rejection
    console.log('[Test 5] Testing invalid room code upload rejection...');
    const invalidUploadRes = await uploadFile(`${SERVER_URL}/upload-audio`, TEMP_TEST_FILE, 'INVALID_CODE', 100);
    if (invalidUploadRes.statusCode !== 404) {
      throw new Error(`Expected 404 for invalid room code upload, got ${invalidUploadRes.statusCode}`);
    }
    console.log(`✓ Invalid room upload cleanly rejected with HTTP 404`);

    // 9. Room destruction cleans up file on disk
    console.log('[Test 6] Testing temporary file cleanup on room destruction...');
    // Locate the uploaded file on server disk
    const uploadsDir = path.join(__dirname, '../uploads');
    const uploadedFiles = fs.readdirSync(uploadsDir).filter(f => f.includes(songId));
    if (uploadedFiles.length === 0) {
      throw new Error(`Uploaded file for songId ${songId} not found in uploads directory.`);
    }
    uploadedFilePathOnServer = path.join(uploadsDir, uploadedFiles[0]);
    console.log(`  Uploaded file path on disk: ${uploadedFilePathOnServer}`);

    // Disconnect both host and speaker to destroy room
    hostSocket.disconnect();
    speakerSocket.disconnect();

    // Small delay to allow fs.unlink to complete
    await new Promise(r => setTimeout(r, 200));

    if (fs.existsSync(uploadedFilePathOnServer)) {
      throw new Error(`Temporary audio file was not deleted after room destruction: ${uploadedFilePathOnServer}`);
    }
    console.log(`✓ Temporary audio file unlinked successfully upon room destruction.`);

    // Cleanup local test file
    fs.unlinkSync(TEMP_TEST_FILE);

    console.log('\n✅ ALL BACKEND PHASE 3 AUDIO TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ BACKEND PHASE 3 TEST FAILED:', err);
    if (fs.existsSync(TEMP_TEST_FILE)) fs.unlinkSync(TEMP_TEST_FILE);
    process.exit(1);
  }
}

runTests();
