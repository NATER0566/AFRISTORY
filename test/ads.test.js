import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADBNK_ZONE_CODE,
  ADBNK_ZONE_ID_MAP,
  normalizeAdbnkPayload,
  validateAdbnkRecord,
  verifyWithAdbnk,
} from '../server/routes/ads.js';

test('normalizes documented callback field aliases', () => {
  assert.deepEqual(normalizeAdbnkPayload({
    transaction_id: 'rt_1',
    key_id: 'key_1',
    user_id: 'user_1',
    custom_data: 'episode_1',
    zone_id: '12345',
  }), {
    transactionId: 'rt_1',
    signature: null,
    keyId: 'key_1',
    userId: 'user_1',
    customData: 'episode_1',
    zoneId: '12345',
    pendingId: null,
  });
});

test('accepts a mapped Shape 1 record and rejects mismatched association', () => {
  ADBNK_ZONE_ID_MAP['12345'] = ADBNK_ZONE_CODE;
  const record = { valid: true, zone_id: '12345', user_id: 'user_1', custom_data: 'episode_1' };
  assert.deepEqual(validateAdbnkRecord(record, { userId: 'user_1', episodeId: 'episode_1' }), { valid: true });
  assert.equal(validateAdbnkRecord(record, { userId: 'other', episodeId: 'episode_1' }).valid, false);
  delete ADBNK_ZONE_ID_MAP['12345'];
});

test('rejects an unmapped zone and invalid provider result', () => {
  assert.equal(validateAdbnkRecord({ valid: false }, {}).valid, false);
  assert.equal(validateAdbnkRecord({ valid: true, zone_id: 'unknown' }, {}).reason, 'zone_unmapped');
});

test('requires all provider verification fields', async () => {
  await assert.rejects(
    verifyWithAdbnk({ transactionId: 'rt_1', signature: 'sig_1' }),
    error => error.statusCode === 400
  );
});

test('accepts a provider valid response and rejects provider failures', async () => {
  const valid = await verifyWithAdbnk({
    transactionId: 'rt_1',
    signature: 'sig_1',
    keyId: 'key_1',
    fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: { valid: true } }), { status: 200 }),
  });
  assert.equal(valid.valid, true);

  const invalid = await verifyWithAdbnk({
      transactionId: 'rt_1',
      signature: 'sig_1',
      keyId: 'key_1',
      fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: { valid: false } }), { status: 200 }),
    });
  assert.equal(invalid.valid, false);
});

test('surfaces provider timeout as an aborted request', async () => {
  await assert.rejects(
    verifyWithAdbnk({
      transactionId: 'rt_1',
      signature: 'sig_1',
      keyId: 'key_1',
      fetchImpl: async (_url, options) => {
        options.signal.dispatchEvent(new Event('abort'));
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      },
    }),
    error => error.name === 'AbortError'
  );
});
