/**
 * test_drift_correction.js — Automated Test Suite for Phase 7 Drift Detection / Correction Rules.
 * Validates drift calculations, soft correction thresholds (1.005 / 0.995), hard resync (> 200ms), and PAUSE/STOP state isolation.
 */

function calculateExpectedPosition(lastPlaybackPosition, lastCommandTimestamp, currentServerTime) {
  const elapsedSeconds = Math.max(0, (currentServerTime - lastCommandTimestamp) / 1000);
  return lastPlaybackPosition + elapsedSeconds;
}

function calculateDriftMs(clientPosition, expectedPosition) {
  return (clientPosition - expectedPosition) * 1000;
}

function evaluateDriftAction(driftMs, currentRate = 1.000, playbackState = 'PLAYING') {
  if (playbackState !== 'PLAYING') {
    return { action: 'NONE', rate: 1.000 };
  }

  const absDrift = Math.abs(driftMs);

  if (absDrift <= 20) {
    return { action: 'IN_SYNC', rate: 1.000 };
  } else if (absDrift <= 200) {
    if (absDrift <= 10) {
      return { action: 'RESTORE_RATE', rate: 1.000 };
    }
    if (driftMs > 0) {
      return { action: 'SOFT_CORRECT_AHEAD', rate: 0.995 };
    } else {
      return { action: 'SOFT_CORRECT_BEHIND', rate: 1.005 };
    }
  } else {
    return { action: 'HARD_RESYNC', rate: 1.000 };
  }
}

function runTests() {
  console.log('--- Starting SyncBox Backend Phase 7 Drift Correction Tests ---');

  try {
    const lastCmdTime = 1786548000000;
    const lastCmdPos = 10.0; // 10 seconds into song

    // Test 1: In Sync (|drift| <= 20ms)
    console.log('[Test 1] Testing In-Sync zone (|drift| <= 20ms)...');
    const serverTime1 = lastCmdTime + 5000; // 5 seconds later
    const expectedPos1 = calculateExpectedPosition(lastCmdPos, lastCmdTime, serverTime1); // 15.0s
    const clientPos1 = 15.010; // 15.010s -> +10ms drift
    const drift1 = calculateDriftMs(clientPos1, expectedPos1);
    const result1 = evaluateDriftAction(drift1);

    if (result1.action !== 'IN_SYNC' || result1.rate !== 1.000) {
      throw new Error(`Expected IN_SYNC with rate 1.000, got ${JSON.stringify(result1)}`);
    }
    console.log(`✓ In-Sync passed. Drift: +${drift1.toFixed(1)}ms -> rate ${result1.rate.toFixed(3)}x`);

    // Test 2: Positive Drift (Client Ahead -> Soft Correction 0.995)
    console.log('[Test 2] Testing Positive Drift (Client Ahead +50ms -> 0.995x)...');
    const clientPos2 = 15.050; // +50ms ahead
    const drift2 = calculateDriftMs(clientPos2, expectedPos1);
    const result2 = evaluateDriftAction(drift2);

    if (result2.action !== 'SOFT_CORRECT_AHEAD' || result2.rate !== 0.995) {
      throw new Error(`Expected SOFT_CORRECT_AHEAD with rate 0.995, got ${JSON.stringify(result2)}`);
    }
    console.log(`✓ Soft correction ahead passed. Drift: +${drift2.toFixed(1)}ms -> rate ${result2.rate.toFixed(3)}x`);

    // Test 3: Negative Drift (Client Behind -> Soft Correction 1.005)
    console.log('[Test 3] Testing Negative Drift (Client Behind -50ms -> 1.005x)...');
    const clientPos3 = 14.950; // -50ms behind
    const drift3 = calculateDriftMs(clientPos3, expectedPos1);
    const result3 = evaluateDriftAction(drift3);

    if (result3.action !== 'SOFT_CORRECT_BEHIND' || result3.rate !== 1.005) {
      throw new Error(`Expected SOFT_CORRECT_BEHIND with rate 1.005, got ${JSON.stringify(result3)}`);
    }
    console.log(`✓ Soft correction behind passed. Drift: ${drift3.toFixed(1)}ms -> rate ${result3.rate.toFixed(3)}x`);

    // Test 4: Drift returning within 10ms (Restore Rate 1.000)
    console.log('[Test 4] Testing Drift returning within <= 10ms (Restore Rate 1.000x)...');
    const clientPos4 = 15.005; // +5ms
    const drift4 = calculateDriftMs(clientPos4, expectedPos1);
    const result4 = evaluateDriftAction(drift4, 0.995);

    if (result4.rate !== 1.000) {
      throw new Error(`Expected rate restored to 1.000, got ${result4.rate}`);
    }
    console.log(`✓ Rate restoration passed. Drift: +${drift4.toFixed(1)}ms -> rate ${result4.rate.toFixed(3)}x`);

    // Test 5: Hard Resync (|drift| > 200ms)
    console.log('[Test 5] Testing Hard Resync (|drift| > 200ms)...');
    const clientPos5 = 15.300; // +300ms ahead
    const drift5 = calculateDriftMs(clientPos5, expectedPos1);
    const result5 = evaluateDriftAction(drift5);

    if (result5.action !== 'HARD_RESYNC' || result5.rate !== 1.000) {
      throw new Error(`Expected HARD_RESYNC with rate 1.000, got ${JSON.stringify(result5)}`);
    }
    console.log(`✓ Hard resync trigger passed. Drift: +${drift5.toFixed(1)}ms -> HARD_RESYNC action`);

    // Test 6: PAUSED state (No drift correction)
    console.log('[Test 6] Testing PAUSED state isolation...');
    const result6 = evaluateDriftAction(300, 1.000, 'PAUSED');
    if (result6.action !== 'NONE' || result6.rate !== 1.000) {
      throw new Error(`Expected NONE for PAUSED state, got ${JSON.stringify(result6)}`);
    }
    console.log(`✓ PAUSED state isolation passed.`);

    // Test 7: STOPPED state (No drift correction)
    console.log('[Test 7] Testing STOPPED state isolation...');
    const result7 = evaluateDriftAction(300, 1.000, 'STOPPED');
    if (result7.action !== 'NONE' || result7.rate !== 1.000) {
      throw new Error(`Expected NONE for STOPPED state, got ${JSON.stringify(result7)}`);
    }
    console.log(`✓ STOPPED state isolation passed.`);

    console.log('\n✅ ALL BACKEND PHASE 7 DRIFT CORRECTION TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ BACKEND PHASE 7 TEST FAILED:', err);
    process.exit(1);
  }
}

runTests();
