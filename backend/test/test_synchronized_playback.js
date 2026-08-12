import fs from 'fs';
import path from 'path';
import http from 'http';
import { io as ioClient } from 'socket.io-client';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_URL = 'http://localhost:4000';
const TEMP_TEST_FILE = path.join(__dirname, 'dummy_sync_track.wav');

// Create minimal valid 44-byte WAV header buffer
function createDummyWavBuffer() {
  const buffer = Buffer.alloc(44 + 100);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(140, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(44100, 24);
  buffer.writeUInt32LE(176400, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
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
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="roomCode"\r\n\r\n${roomCode}\r\n`;
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="duration"\r\n\r\n${duration}\r\n`;
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
          resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
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

async function runTests() {
  console.log('--- Starting SyncBox Backend Phase 6 Synchronized Playback Tests ---');

  fs.writeFileSync(TEMP_TEST_FILE, createDummyWavBuffer());

  const createClient = () => {
    return new Promise((resolve, reject) => {
      const socket = ioClient(SERVER_URL, { transports: ['websocket'], forceNew: true });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  };

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

    // 3. Host uploads audio
    await uploadFile(`${SERVER_URL}/upload-audio`, TEMP_TEST_FILE, roomCode, 180);
    console.log(`✓ Host uploaded test audio for room: ${roomCode}`);

    // 4. Speaker joins room
    await new Promise((resolve) => {
      speakerSocket.emit('JOIN_ROOM', { roomCode, deviceName: 'Phone' }, resolve);
    });
    console.log(`✓ Speaker joined room: ${roomCode}`);

    // 5. Host emits CMD_PLAY
    console.log('[Test 2] Host emitting CMD_PLAY to test playAtTimestamp scheduling...');
    const observationTimeBefore = Date.now();

    let speakerCmdPromise = new Promise((resolve) => {
      speakerSocket.once('PLAYBACK_COMMAND', resolve);
    });

    const playRes = await new Promise((resolve) => {
      hostSocket.emit('CMD_PLAY', { roomCode, position: 0 }, resolve);
    });

    const observationTimeAfter = Date.now();

    if (!playRes.success || playRes.playbackState !== 'PLAYING') {
      throw new Error(`CMD_PLAY failed: ${JSON.stringify(playRes)}`);
    }

    const payload = await speakerCmdPromise;

    // 6. Assertions on PLAYBACK_COMMAND payload
    if (payload.command !== 'PLAY') throw new Error(`Expected command 'PLAY', got '${payload.command}'`);
    if (payload.position !== 0) throw new Error(`Expected position 0, got ${payload.position}`);
    if (!payload.serverTime) throw new Error('serverTime missing from payload');
    if (!payload.playAtTimestamp) throw new Error('playAtTimestamp missing from payload');

    const expectedPlayAt = payload.serverTime + 1000;
    const diff = Math.abs(payload.playAtTimestamp - expectedPlayAt);
    if (diff > 5) {
      throw new Error(`Expected playAtTimestamp ~ ${expectedPlayAt}, got ${payload.playAtTimestamp} (diff: ${diff})`);
    }

    if (payload.playAtTimestamp <= observationTimeBefore) {
      throw new Error(`playAtTimestamp (${payload.playAtTimestamp}) is not in the future relative to ${observationTimeBefore}`);
    }

    console.log(`✓ Scheduled PLAYBACK_COMMAND received:`);
    console.log(`  command        : ${payload.command}`);
    console.log(`  position       : ${payload.position} s`);
    console.log(`  serverTime     : ${payload.serverTime} ms`);
    console.log(`  playAtTimestamp: ${payload.playAtTimestamp} ms (${payload.playAtTimestamp - payload.serverTime} ms lead time)`);

    // 7. Verify Speaker command rejection
    console.log('[Test 3] Testing unauthorized Speaker playback command rejection...');
    const unauthorizedRes = await new Promise((resolve) => {
      speakerSocket.emit('CMD_PLAY', { roomCode, position: 0 }, resolve);
    });

    if (unauthorizedRes.success || unauthorizedRes.error !== 'Only the room HOST can issue playback commands.') {
      throw new Error(`Unauthorized command not rejected properly: ${JSON.stringify(unauthorizedRes)}`);
    }
    console.log(`✓ Unauthorized Speaker command rejected correctly: "${unauthorizedRes.error}"`);

    // Cleanup
    hostSocket.disconnect();
    speakerSocket.disconnect();
    if (fs.existsSync(TEMP_TEST_FILE)) fs.unlinkSync(TEMP_TEST_FILE);

    console.log('\n✅ ALL BACKEND PHASE 6 SYNCHRONIZED PLAYBACK TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ BACKEND PHASE 6 TEST FAILED:', err);
    if (fs.existsSync(TEMP_TEST_FILE)) fs.unlinkSync(TEMP_TEST_FILE);
    process.exit(1);
  }
}

runTests();
