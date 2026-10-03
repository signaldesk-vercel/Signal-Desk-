import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  api: {
    bodyParser: false,
  },
};

function send(res: VercelResponse, status: number, data: any) {
  return res.status(status).json(data);
}

async function rawBody(req: VercelRequest): Promise<string> {
  if (typeof req.body === 'string') return req.body;
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return send(res, 405, { message: 'Method not allowed' });

  const signature = String(req.headers['paddle-signature'] || '');
  const secret = String(process.env.PADDLE_WEBHOOK_SECRET || '').trim();

  if (!signature || !secret) {
    return send(res, 400, { message: 'Paddle signature is required' });
  }

  try {
    const raw = await rawBody(req);
    const parts = Object.fromEntries(
      signature.split(';').map((part) => {
        const [key, ...value] = part.split('=');
        return [key, value.join('=')];
      })
    );

    const ts = String(parts.ts || '');
    const signatures = signature
      .split(';')
      .filter((part) => part.startsWith('h1='))
      .map((part) => part.slice(3));

    const expected = crypto
      .createHmac('sha256', secret)
      .update(ts + ':' + raw, 'utf8')
      .digest('hex');

    const timestampValid =
      /^\d+$/.test(ts) &&
      Math.abs(Date.now() - Number(ts) * 1000) <= 5000;

    const signatureValid = signatures.some(
      (candidate) =>
        candidate.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))
    );

    if (!timestampValid || !signatureValid) {
      return send(res, 401, { message: 'Invalid Paddle signature' });
    }

    const payload: any = JSON.parse(raw);
    const eventId = String(payload.event_id || payload.id || '');

    if (eventId) {
      const { data: duplicate } = await supabase
        .from('paddle_events')
        .select('id')
        .eq('event_id', eventId)
        .maybeSingle();

      if (duplicate) return send(res, 200, { ok: true, duplicate: true });

      await supabase.from('paddle_events').insert({
        event_id: eventId,
        type: String(payload.event_type || ''),
      });
    }

    if (String(payload.event_type || '').startsWith('subscription.')) {
      const data = payload.data || {};
      const customData = data.custom_data || {};
      const clerkId = String(customData.signaldesk_user_id || '');

      let workspaceId: string | null = null;

      if (clerkId) {
        const { data: user } = await supabase
          .from('clerk_users')
          .select('workspace_id')
          .eq('clerk_id', clerkId)
          .maybeSingle();

        workspaceId = user?.workspace_id || null;
      }

      const record = {
        user_id: null,
        workspace_id: workspaceId,
        subscription_id: String(data.id || ''),
        status: String(data.status || 'unknown'),
        customer_id: String(data.customer_id || ''),
        price_id: String(data.items?.[0]?.price?.id || ''),
      };

      const { data: existing } = await supabase
        .from('billing_subscriptions')
        .select('id')
        .eq('subscription_id', record.subscription_id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('billing_subscriptions')
          .update(record)
          .eq('id', existing.id);
      } else {
        await supabase.from('billing_subscriptions').insert(record);
      }
    }

    return send(res, 200, { ok: true });
  } catch (error: any) {
    return send(res, 500, {
      message: error?.message || 'Webhook processing failed',
    });
  }
}
