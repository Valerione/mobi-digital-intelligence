import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    status: 'online',
    service: 'MOBI.DIGITAL GLOBAL INTELLIGENCE',
    timestamp: new Date().toISOString(),
  });
}
