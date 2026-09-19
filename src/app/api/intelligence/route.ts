import { NextResponse } from 'next/server';
import { getIntelligenceSnapshot } from '@/lib/mobi-intelligence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await getIntelligenceSnapshot();
  return NextResponse.json(snapshot, {
    headers: {
      'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
