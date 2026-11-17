import crypto from 'node:crypto';

function getSignature(request) {
  return request.headers['x-adbnk-signature'] || request.headers['x-signature'];
}

function getPayloadForSigning(request, payload) {
  if (request.method === 'GET') {
    return new URLSearchParams(payload).toString();
  }
  return JSON.stringify(payload);
}

export function verifyAdbnkSignature(request, payload) {
  const secret = process.env.ADBNK_WEBHOOK_SECRET;
  const signature = getSignature(request);

  if (!secret || !signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(getPayloadForSigning(request, payload))
    .digest('hex');

  const provided = signature.replace(/^sha256=/i, '').trim();
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');

  return expectedBuffer.length === providedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
