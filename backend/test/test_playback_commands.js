import fs from 'fs';
import path from 'path';
import http from 'http';
import { io as ioClient } from 'socket.io-client';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_URL = 'http://localhost:4000';
const TEMP_TEST_FILE = path.join(__dirname, 'dummy_cmd_track.wav');

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
  console.log('--- Starting SyncBox Backend Phase 4 Playback Command Tests ---');

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

    // 5. Host CMD_PLAY Test
    console.log('[Test 2] Testing Host CMD_PLAY...');
    let speakerCmdPromise = new Promise((resolve) => {
      speakerSocket.once('PLAYBACK_COMMAND', resolve);
    });

    const playRes = await new Promise((resolve) => {
      hostSocket.emit('CMD_PLAY', { roomCode, position: 0 }, resolve);
    });

    if (!playRes.success || playRes.playbackState !== 'PLAYING') {
      throw new Error(`CMD_PLAY failed: ${JSON.stringify(playRes)}`);
    }

    const cmdPayload1 = await speakerCmdPromise;
    if (cmdPayload1.command !== 'PLAY' || cmdPayload1.position !== 0 || !cmdPayload1.serverTime) {
      throw new Error(`PLAYBACK_COMMAND payload mismatch on PLAY: ${JSON.stringify(cmdPayload1)}`);
    }
    console.log(`✓ CMD_PLAY succeeded. Speaker received PLAYBACK_COMMAND (command: ${cmdPayload1.command}, pos: ${cmdPayload1.position}s, serverTime: ${cmdPayload1.serverTime})`);

    // 6. Host CMD_PAUSE Test
    console.log('[Test 3] Testing Host CMD_PAUSE...');
    speakerCmdPromise = new Promise((resolve) => {
      speakerSocket.once('PLAYBACK_COMMAND', resolve);
    });

    const pauseRes = await new Promise((resolve) => {
      hostSocket.emit('CMD_PAUSE', { roomCode, position: 15.5 }, resolve);
    });

    if (!pauseRes.success || pauseRes.playbackState !== 'PAUSED') {
      throw new Error(`CMD_PAUSE failed: ${JSON.stringify(pauseRes)}`);
    }

    const cmdPayload2 = await speakerCmdPromise;
    if (cmdPayload2.command !== 'PAUSE' || cmdPayload2.position !== 15.5) {
      throw new Error(`PLAYBACK_COMMAND payload mismatch on PAUSE: ${JSON.stringify(cmdPayload2)}`);
    }
    console.log(`✓ CMD_PAUSE succeeded. Speaker received PLAYBACK_COMMAND (command: ${cmdPayload2.command}, pos: ${cmdPayload2.position}s)`);

    // 7. Host CMD_SEEK Test
    console.log('[Test 4] Testing Host CMD_SEEK...');
    speakerCmdPromise = new Promise((resolve) => {
      speakerSocket.once('PLAYBACK_COMMAND', resolve);
    });

    const seekRes = await new Promise((resolve) => {
      hostSocket.emit('CMD_SEEK', { roomCode, position: 45.0 }, resolve);
    });

    if (!seekRes.success || seekRes.position !== 45.0) {
      throw new Error(`CMD_SEEK failed: ${JSON.stringify(seekRes)}`);
    }

    const cmdPayload3 = await speakerCmdPromise;
    if (cmdPayload3.command !== 'SEEK' || cmdPayload3.position !== 45.0) {
      throw new Error(`PLAYBACK_COMMAND payload mismatch on SEEK: ${JSON.stringify(cmdPayload3)}`);
    }
    console.log(`✓ CMD_SEEK succeeded. Speaker received PLAYBACK_COMMAND (command: ${cmdPayload3.command}, pos: ${cmdPayload3.position}s)`);

    // 8. Host CMD_STOP Test
    console.log('[Test 5] Testing Host CMD_STOP...');
    speakerCmdPromise = new Promise((resolve) => {
      speakerSocket.once('PLAYBACK_COMMAND', resolve);
    });

    const stopRes = await new Promise((resolve) => {
      hostSocket.emit('CMD_STOP', { roomCode }, resolve);
    });

    if (!stopRes.success || stopRes.playbackState !== 'STOPPED' || stopRes.position !== 0) {
      throw new Error(`CMD_STOP failed: ${JSON.stringify(stopRes)}`);
    }

    const cmdPayload4 = await speakerCmdPromise;
    if (cmdPayload4.command !== 'STOP' || cmdPayload4.position !== 0) {
      throw new Error(`PLAYBACK_COMMAND payload mismatch on STOP: ${JSON.stringify(cmdPayload4)}`);
    }
    console.log(`✓ CMD_STOP succeeded. Speaker received PLAYBACK_COMMAND (command: ${cmdPayload4.command}, pos: ${cmdPayload4.position}s)`);

    // 9. Unauthorized Speaker Command Rejection Test
    console.log('[Test 6] Testing unauthorized Speaker CMD_PLAY rejection...');
    let unauthorizedBroadcastReceived = false;
    hostSocket.once('PLAYBACK_COMMAND', () => {
      unauthorizedBroadcastReceived = true;
    });

    const unauthorizedRes = await new Promise((resolve) => {
      speakerSocket.emit('CMD_PLAY', { roomCode, position: 0 }, resolve);
    });

    if (unauthorizedRes.success || unauthorizedRes.error !== 'Only the room HOST can issue playback commands.') {
      throw new Error(`Speaker command should have been rejected: ${JSON.stringify(unauthorizedRes)}`);
    }

    await new Promise(r => setTimeout(r, 100));
    if (unauthorizedBroadcastReceived) {
      throw new Error('Unauthorized command was broadcast to room.');
    }
    console.log(`✓ Unauthorized Speaker command cleanly rejected: "${unauthorizedRes.error}"`);

    // Cleanup
    hostSocket.disconnect();
    speakerSocket.disconnect();
    if (fs.existsSync(TEMP_TEST_FILE)) fs.unlinkSync(TEMP_TEST_FILE);

    console.log('\n✅ ALL BACKEND PHASE 4 PLAYBACK COMMAND TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ BACKEND PHASE 4 TEST FAILED:', err);
    if (fs.existsSync(TEMP_TEST_FILE)) fs.unlinkSync(TEMP_TEST_FILE);
    process.exit(1);
  }
}

runTests();
