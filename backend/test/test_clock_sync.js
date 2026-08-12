import { io as ioClient } from 'socket.io-client';

const SERVER_URL = 'http://localhost:4000';

function getHighResTime() {
  return (performance.timeOrigin || 0) + performance.now();
}

async function runTests() {
  console.log('--- Starting SyncBox Backend Phase 6 Clock Sync Tests ---');

  const createClient = () => {
    return new Promise((resolve, reject) => {
      const socket = ioClient(SERVER_URL, { transports: ['websocket'], forceNew: true });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });
  };

  try {
    // 1. Connect Client
    console.log('[Test 1] Connecting Socket.IO client...');
    const client = await createClient();
    console.log(`✓ Client connected: ${client.id}`);

    // 2. Perform Single SYNC_REQUEST
    console.log('[Test 2] Emitting SYNC_REQUEST with client timestamp t1...');
    const t1 = getHighResTime();

    const response = await new Promise((resolve) => {
      client.emit('SYNC_REQUEST', { t1 }, resolve);
    });

    const t4 = getHighResTime();

    if (!response || response.t1 === undefined || response.t2 === undefined || response.t3 === undefined) {
      throw new Error(`Invalid SYNC_REQUEST response: ${JSON.stringify(response)}`);
    }

    const { t2, t3 } = response;
    const rtt = (t4 - t1) - (t3 - t2);
    const offset = ((t2 - t1) + (t3 - t4)) / 2;

    console.log(`✓ Single SYNC_REQUEST response received:`);
    console.log(`  t1 (client send)    : ${t1.toFixed(2)} ms`);
    console.log(`  t2 (server receive) : ${t2.toFixed(2)} ms`);
    console.log(`  t3 (server response): ${t3.toFixed(2)} ms`);
    console.log(`  t4 (client receive) : ${t4.toFixed(2)} ms`);
    console.log(`  RTT                 : ${rtt.toFixed(2)} ms`);
    console.log(`  Clock Offset        : ${offset >= 0 ? '+' : ''}${offset.toFixed(2)} ms`);

    if (isNaN(rtt) || isNaN(offset)) {
      throw new Error('Calculated RTT or offset is NaN.');
    }

    // 3. Test Sample Burst & Lowest RTT Selection
    console.log('[Test 3] Running 5-sample burst to verify lowest-RTT filtering...');
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const sampleT1 = getHighResTime();
      const res = await new Promise((resolve) => {
        client.emit('SYNC_REQUEST', { t1: sampleT1 }, resolve);
      });
      const sampleT4 = getHighResTime();
      const sRtt = Math.max(0, (sampleT4 - sampleT1) - (res.t3 - res.t2));
      const sOffset = ((res.t2 - sampleT1) + (res.t3 - sampleT4)) / 2;
      samples.push({ rtt: sRtt, offset: sOffset });
    }

    samples.sort((a, b) => a.rtt - b.rtt);
    const bestSample = samples[0];

    console.log(`✓ Burst completed. 5 samples collected.`);
    console.log(`  Lowest RTT Sample: RTT = ${bestSample.rtt.toFixed(2)} ms, Offset = ${bestSample.offset >= 0 ? '+' : ''}${bestSample.offset.toFixed(2)} ms`);

    // 4. Test Estimated Server Time
    const estimatedServerTime = getHighResTime() + bestSample.offset;
    console.log(`✓ Estimated Server Time: ${estimatedServerTime.toFixed(2)} ms`);

    client.disconnect();
    console.log('\n✅ ALL BACKEND PHASE 6 CLOCK SYNC TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ BACKEND PHASE 6 TEST FAILED:', err);
    process.exit(1);
  }
}

runTests();
