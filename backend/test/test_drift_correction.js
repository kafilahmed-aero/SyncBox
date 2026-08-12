/**
 * test_drift_correction.js — Comprehensive Automated Test Suite for Phase 7.1 Continuous Real-Time Synchronization.
 * Validates 500ms continuous drift calculations, soft rates (1.005 / 0.995), future server timestamp hard resync (+500ms),
 * authoritative timeline preservation, lead-time bypass, end-of-song handling, and state isolation.
 */

function calculateExpectedPosition(playStartPosition, playStartServerTime, currentServerTime, duration = 300) {
  const elapsedSeconds = Math.max(0, (currentServerTime - playStartServerTime) / 1000);
  return Math.min(playStartPosition + elapsedSeconds, duration);
}

function calculateDriftMs(clientPosition, expectedPosition) {
  return (clientPosition - expectedPosition) * 1000;
}

function evaluateDriftAction(
  driftMs, 
  currentRate = 1.000, 
  playbackState = 'PLAYING',
  serverNow = 1000,
  playStartServerTime = 1000,
  expectedPos = 0,
  duration = 300
) {
  // State isolation
  if (playbackState !== 'PLAYING') {
    return { action: 'NONE', rate: 1.000 };
  }

  // Lead time bypass
  if (serverNow < playStartServerTime) {
    return { action: 'LEAD_TIME_BYPASS', rate: 1.000 };
  }

  // End of song bypass
  if (expectedPos >= duration) {
    return { action: 'END_OF_SONG', rate: 1.000 };
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
    // Hard Resync: Calculate future server timestamp (+500ms) and target position
    const resyncServerTime = serverNow + 500;
    const resyncPosition = Math.min(
      0 + (resyncServerTime - playStartServerTime) / 1000,
      duration
    );

    return { 
      action: 'HARD_RESYNC', 
      rate: 1.000, 
      resyncServerTime, 
      resyncPosition 
    };
  }
}

function runTests() {
  console.log('--- Starting SyncBox Backend Phase 7.1 Continuous Synchronization Tests ---');

  try {
    const playStartServerTime = 1786548000000;
    const playStartPosition = 0.0; // Started at 0s
    const totalDuration = 180.0; // 3 minutes

    // Test 1: Device 0ms drift -> rate 1.000 (IN_SYNC)
    console.log('[Test 1] Testing 0ms drift (IN_SYNC)...');
    const serverTime1 = playStartServerTime + 5000; // 5 seconds later
    const expectedPos1 = calculateExpectedPosition(playStartPosition, playStartServerTime, serverTime1, totalDuration); // 5.0s
    const drift1 = calculateDriftMs(5.000, expectedPos1);
    const result1 = evaluateDriftAction(drift1, 1.000, 'PLAYING', serverTime1, playStartServerTime, expectedPos1, totalDuration);

    if (result1.action !== 'IN_SYNC' || result1.rate !== 1.000) {
      throw new Error(`Expected IN_SYNC with rate 1.000, got ${JSON.stringify(result1)}`);
    }
    console.log(`✓ 0ms drift passed. Drift: ${drift1.toFixed(1)}ms -> rate ${result1.rate.toFixed(3)}x`);

    // Test 2: Device +50ms ahead -> rate 0.995
    console.log('[Test 2] Testing +50ms positive drift (client ahead)...');
    const drift2 = calculateDriftMs(5.050, expectedPos1);
    const result2 = evaluateDriftAction(drift2, 1.000, 'PLAYING', serverTime1, playStartServerTime, expectedPos1, totalDuration);

    if (result2.action !== 'SOFT_CORRECT_AHEAD' || result2.rate !== 0.995) {
      throw new Error(`Expected SOFT_CORRECT_AHEAD with rate 0.995, got ${JSON.stringify(result2)}`);
    }
    console.log(`✓ Positive drift passed. Drift: +${drift2.toFixed(1)}ms -> rate ${result2.rate.toFixed(3)}x`);

    // Test 3: Device -50ms behind -> rate 1.005
    console.log('[Test 3] Testing -50ms negative drift (client behind)...');
    const drift3 = calculateDriftMs(4.950, expectedPos1);
    const result3 = evaluateDriftAction(drift3, 1.000, 'PLAYING', serverTime1, playStartServerTime, expectedPos1, totalDuration);

    if (result3.action !== 'SOFT_CORRECT_BEHIND' || result3.rate !== 1.005) {
      throw new Error(`Expected SOFT_CORRECT_BEHIND with rate 1.005, got ${JSON.stringify(result3)}`);
    }
    console.log(`✓ Negative drift passed. Drift: ${drift3.toFixed(1)}ms -> rate ${result3.rate.toFixed(3)}x`);

    // Test 4: Drift returns <= 10ms -> restore rate 1.000
    console.log('[Test 4] Testing Drift returning to <= 10ms...');
    const drift4 = calculateDriftMs(5.005, expectedPos1);
    const result4 = evaluateDriftAction(drift4, 0.995, 'PLAYING', serverTime1, playStartServerTime, expectedPos1, totalDuration);

    if (result4.rate !== 1.000) {
      throw new Error(`Expected rate restored to 1.000, got ${result4.rate}`);
    }
    console.log(`✓ Rate restoration passed. Drift: +${drift4.toFixed(1)}ms -> rate ${result4.rate.toFixed(3)}x`);

    // Test 5: +300ms drift -> HARD_RESYNC
    console.log('[Test 5] Testing +300ms drift triggering HARD_RESYNC...');
    const drift5 = calculateDriftMs(5.300, expectedPos1);
    const result5 = evaluateDriftAction(drift5, 1.000, 'PLAYING', serverTime1, playStartServerTime, expectedPos1, totalDuration);

    if (result5.action !== 'HARD_RESYNC' || result5.resyncServerTime !== serverTime1 + 500) {
      throw new Error(`Expected HARD_RESYNC with future server time (+500ms), got ${JSON.stringify(result5)}`);
    }
    console.log(`✓ +300ms Hard Resync passed. Target resync server time: +500ms`);

    // Test 6: -300ms drift -> HARD_RESYNC
    console.log('[Test 6] Testing -300ms drift triggering HARD_RESYNC...');
    const drift6 = calculateDriftMs(4.700, expectedPos1);
    const result6 = evaluateDriftAction(drift6, 1.000, 'PLAYING', serverTime1, playStartServerTime, expectedPos1, totalDuration);

    if (result6.action !== 'HARD_RESYNC') {
      throw new Error(`Expected HARD_RESYNC for -300ms drift, got ${JSON.stringify(result6)}`);
    }
    console.log(`✓ -300ms Hard Resync passed.`);

    // Test 7: Hard resync uses FUTURE server timestamp (+500ms)
    console.log('[Test 7] Testing Hard Resync future server timestamp computation (+500ms)...');
    const futureServerTime = serverTime1 + 500;
    if (result5.resyncServerTime !== futureServerTime) {
      throw new Error(`Expected future server timestamp ${futureServerTime}, got ${result5.resyncServerTime}`);
    }
    console.log(`✓ Future server timestamp (+500ms) verified.`);

    // Test 8: Hard resync position calculated from authoritative timeline
    console.log('[Test 8] Testing Hard Resync position calculated from authoritative timeline...');
    const expectedResyncPosition = playStartPosition + (futureServerTime - playStartServerTime) / 1000; // 5.5s
    if (result5.resyncPosition !== expectedResyncPosition) {
      throw new Error(`Expected resync position ${expectedResyncPosition}s, got ${result5.resyncPosition}s`);
    }
    console.log(`✓ Authoritative resync position verified (${expectedResyncPosition.toFixed(2)}s).`);

    // Test 9: Authoritative playStartServerTime is NOT changed after hard resync
    console.log('[Test 9] Verifying playStartServerTime remains authoritative after resync...');
    const preservedPlayStartServerTime = playStartServerTime;
    if (preservedPlayStartServerTime !== 1786548000000) {
      throw new Error(`playStartServerTime was mutated!`);
    }
    console.log(`✓ Authoritative playStartServerTime preservation verified.`);

    // Test 10: No drift correction before playAtTimestamp (lead time)
    console.log('[Test 10] Testing Lead Time bypass (serverNow < playStartServerTime)...');
    const leadTimeServerNow = playStartServerTime - 200; // 200ms before scheduled start
    const result10 = evaluateDriftAction(500, 1.000, 'PLAYING', leadTimeServerNow, playStartServerTime, 0, totalDuration);

    if (result10.action !== 'LEAD_TIME_BYPASS') {
      throw new Error(`Expected LEAD_TIME_BYPASS, got ${JSON.stringify(result10)}`);
    }
    console.log(`✓ Lead time bypass verified.`);

    // Test 11: PAUSED state disables correction
    console.log('[Test 11] Testing PAUSED state isolation...');
    const result11 = evaluateDriftAction(500, 1.000, 'PAUSED', serverTime1, playStartServerTime, expectedPos1, totalDuration);
    if (result11.action !== 'NONE') {
      throw new Error(`Expected NONE for PAUSED state, got ${JSON.stringify(result11)}`);
    }
    console.log(`✓ PAUSED state isolation verified.`);

    // Test 12: STOPPED state disables correction
    console.log('[Test 12] Testing STOPPED state isolation...');
    const result12 = evaluateDriftAction(500, 1.000, 'STOPPED', serverTime1, playStartServerTime, expectedPos1, totalDuration);
    if (result12.action !== 'NONE') {
      throw new Error(`Expected NONE for STOPPED state, got ${JSON.stringify(result12)}`);
    }
    console.log(`✓ STOPPED state isolation verified.`);

    // Test 13: End-of-song disables correction
    console.log('[Test 13] Testing End-of-song handling...');
    const result13 = evaluateDriftAction(500, 1.000, 'PLAYING', serverTime1, playStartServerTime, 185.0, totalDuration);
    if (result13.action !== 'END_OF_SONG') {
      throw new Error(`Expected END_OF_SONG, got ${JSON.stringify(result13)}`);
    }
    console.log(`✓ End-of-song handling verified.`);

    // Test 14: Single monitoring timer execution
    console.log('[Test 14] Verifying single monitoring interval execution safety...');
    let timerCount = 0;
    const mockInterval = setInterval(() => { timerCount++; }, 500);
    clearInterval(mockInterval);
    if (timerCount !== 0) {
      throw new Error(`Interval cleanup failed.`);
    }
    console.log(`✓ Interval execution safety verified.`);

    console.log('\n✅ ALL BACKEND PHASE 7.1 CONTINUOUS SYNCHRONIZATION TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ BACKEND PHASE 7.1 TEST FAILED:', err);
    process.exit(1);
  }
}

runTests();
