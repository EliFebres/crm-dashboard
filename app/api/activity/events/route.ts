export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/app/lib/auth/require-auth';
import { activityEmitter, type ActivityLogRow } from '@/app/lib/events';

// GET /api/activity/events (admin-only)
// Server-Sent Events stream — emits each new activity log row as JSON so the
// Activity Dashboard can render them live.
// Optional `?entities=team,office,…` limits the stream to rows with those
// entityTypes (the Settings tables only care about registry changes).
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth.error) return auth.error;
  if (auth.payload.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const entitiesParam = req.nextUrl.searchParams.get('entities');
  const entities = entitiesParam ? new Set(entitiesParam.split(',').filter(Boolean)) : null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (payload: string) => {
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      send(JSON.stringify({ type: 'connected' }));

      const onLog = (row: ActivityLogRow) => {
        if (entities && !(row.entityType && entities.has(row.entityType))) return;
        try {
          send(JSON.stringify({ type: 'log', row }));
        } catch {
          // swallow — dropped frame is fine
        }
      };
      activityEmitter.on('log', onLog);

      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(': ping\n\n'));
      }, 30_000);

      req.signal.addEventListener('abort', () => {
        activityEmitter.off('log', onLog);
        clearInterval(keepAlive);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
