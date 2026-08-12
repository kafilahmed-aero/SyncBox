import { io as ioClient } from 'socket.io-client';

const SERVER_URL = 'http://localhost:4000';

async function runTests() {
  console.log('--- Starting SyncBox Backend Phase 2 Socket Tests ---');

  // Helper to connect socket client
  const createClient = () => {
    return new Promise((resolve, reject) => {
      const socket = ioClient(SERVER_URL, {
        transports: ['websocket'],
        forceNew: true
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
    });
  };

  try {
    // 1. Connect Client 1 (Host)
    console.log('[Test 1] Connecting Client 1 (Host)...');
    const client1 = await createClient();
    console.log(`[Test 1] Client 1 connected: ${client1.id}`);

    // 2. Create Room
    let activeRoomCode = null;
    const createRes = await new Promise((resolve) => {
      client1.emit('CREATE_ROOM', { deviceName: 'Laptop' }, resolve);
    });

    if (!createRes.success || !createRes.roomCode || createRes.roomCode.length !== 6) {
      throw new Error(`CREATE_ROOM failed or returned invalid code: ${JSON.stringify(createRes)}`);
    }
    activeRoomCode = createRes.roomCode;
    console.log(`✓ CREATE_ROOM succeeded. Room Code: ${activeRoomCode}, Host Role: ${createRes.room.devices[0].role}`);

    // 3. Connect Client 2 (Speaker 1) & Join Room
    console.log('[Test 2] Connecting Client 2 (Speaker 1) and joining room...');
    const client2 = await createClient();

    let client1UpdatePromise = new Promise((resolve) => {
      client1.once('DEVICE_UPDATE', resolve);
    });

    const joinRes2 = await new Promise((resolve) => {
      client2.emit('JOIN_ROOM', { roomCode: activeRoomCode, deviceName: 'Phone' }, resolve);
    });

    if (!joinRes2.success || joinRes2.room.devices.length !== 2) {
      throw new Error(`JOIN_ROOM failed for Client 2: ${JSON.stringify(joinRes2)}`);
    }

    const deviceUpdate1 = await client1UpdatePromise;
    console.log(`✓ JOIN_ROOM Client 2 succeeded. Client 1 received DEVICE_UPDATE (Total devices: ${deviceUpdate1.devices.length})`);

    // 4. Connect Client 3 (Speaker 2) & Join Room
    console.log('[Test 3] Connecting Client 3 (Speaker 2) and joining room...');
    const client3 = await createClient();

    let client1UpdatePromise2 = new Promise((resolve) => {
      client1.once('DEVICE_UPDATE', resolve);
    });

    const joinRes3 = await new Promise((resolve) => {
      client3.emit('JOIN_ROOM', { roomCode: activeRoomCode, deviceName: 'Tablet' }, resolve);
    });

    if (!joinRes3.success || joinRes3.room.devices.length !== 3) {
      throw new Error(`JOIN_ROOM failed for Client 3: ${JSON.stringify(joinRes3)}`);
    }

    const deviceUpdate2 = await client1UpdatePromise2;
    console.log(`✓ JOIN_ROOM Client 3 succeeded. Client 1 received DEVICE_UPDATE (Total devices: ${deviceUpdate2.devices.length})`);

    // 5. Test Invalid Room Code Join
    console.log('[Test 4] Testing invalid room code join...');
    const invalidRes = await new Promise((resolve) => {
      client2.emit('JOIN_ROOM', { roomCode: 'INVALID' }, resolve);
    });
    if (invalidRes.success) {
      throw new Error('JOIN_ROOM should have failed for invalid room code.');
    }
    console.log(`✓ Invalid room code cleanly rejected: "${invalidRes.error}"`);

    // 6. Test Disconnect Cleanup
    console.log('[Test 5] Disconnecting Client 2...');
    let client1DisconnectUpdatePromise = new Promise((resolve) => {
      client1.once('DEVICE_UPDATE', resolve);
    });

    client2.disconnect();

    const disconnectUpdate = await client1DisconnectUpdatePromise;
    console.log(`✓ Client 2 disconnected. Remaining devices broadcast to room: ${disconnectUpdate.devices.length}`);

    // Cleanup remaining test sockets
    client1.disconnect();
    client3.disconnect();

    console.log('\n✅ ALL BACKEND PHASE 2 TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ BACKEND PHASE 2 TEST FAILED:', err);
    process.exit(1);
  }
}

runTests();
