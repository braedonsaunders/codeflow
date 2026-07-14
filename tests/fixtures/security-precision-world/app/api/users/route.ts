import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.email) {
    return NextResponse.json({ error: 'email required' }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
