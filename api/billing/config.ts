import type { VercelRequest, VercelResponse } from '@vercel/node';

const PRICE_ID = String(process.env.PADDLE_PRICE_ID || 'pri_01m3pxczzqkv25fj4mhz66kjmb').trim();
const PRODUCT_ID = String(process.env.PADDLE_PRODUCT_ID || 'pro_01m3px99f58awgx0k8hsd3rd4q').trim();

function clean(value: unknown) {
  return String(value || '').replace(/^Bearer\\s+/i, '').trim();
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const apiKey = clean(process.env.PADDLE_API_KEY);
  const clientToken = clean(process.env.PADDLE_CLIENT_TOKEN);
  const configured = Boolean(apiKey && clientToken);

  const envSetting = String(process.env.PADDLE_ENVIRONMENT || '').trim().toLowerCase();
  const environment =
    envSetting === 'sandbox' || clientToken.startsWith('test_')
      ? 'sandbox'
      : 'live';

  return res.status(200).json({
    configured,
    clientToken,
    priceId: PRICE_ID,
    productId: PRODUCT_ID,
    environment,
  });
}
