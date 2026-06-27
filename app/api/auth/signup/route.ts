export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { queryUsers, executeUsers } from '@/app/lib/db/users';
import { hashPassword } from '@/app/lib/auth/password';
import { signJWT, SESSION_COOKIE, COOKIE_OPTIONS } from '@/app/lib/auth/jwt';
import { rowToUser } from '@/app/lib/auth/types';
import { emitUserChange } from '@/app/lib/events';
import { logActivity } from '@/app/lib/activity/log';

const VALID_TEAMS = [
  'Portfolio Consulting Group',
  'Equity Specialist',
  'Fixed Income Specialist',
  'Leadership',
  'Guest',
];
const VALID_OFFICES = ['Austin', 'Charlotte', 'Santa Monica', 'UK', 'Sydney'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { firstName, lastName, email, password, confirmPassword, title, team, office } = body;

    // Validate required fields
    if (!firstName || !lastName || !email || !password || !confirmPassword || !title || !team || !office) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address.' }, { status: 400 });
    }

    // Validate password strength
    if (password.length < 10) {
      return NextResponse.json({ error: 'Password must be at least 10 characters.' }, { status: 400 });
    }
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return NextResponse.json({ error: 'Password must contain at least one letter and one number.' }, { status: 400 });
    }

    // Validate passwords match
    if (password !== confirmPassword) {
      return NextResponse.json({ error: 'Passwords do not match.' }, { status: 400 });
    }

    // Validate enum fields
    if (!VALID_TEAMS.includes(team)) {
      return NextResponse.json({ error: 'Invalid team selection.' }, { status: 400 });
    }
    if (!VALID_OFFICES.includes(office)) {
      return NextResponse.json({ error: 'Invalid office selection.' }, { status: 400 });
    }

    // Check for duplicate email
    const existing = await queryUsers('SELECT id FROM users WHERE email = ?', [email.toLowerCase()]);
    if (existing.length > 0) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 });
    }

    // Determine if this is the first user (auto-admin + active)
    const countResult = await queryUsers<{ count: number }>('SELECT COUNT(*) AS count FROM users');
    const isFirstUser = Number(countResult[0]?.count ?? 0) === 0;

    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    const role = isFirstUser ? 'admin' : 'user';
    const status = isFirstUser ? 'active' : 'pending';

    if (isFirstUser) {
      await executeUsers(
        `INSERT INTO users (id, email, first_name, last_name, title, department, team, office, role, status, password_hash, created_at, approved_at)
         VALUES (?, ?, ?, ?, ?, 'Default', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [id, email.toLowerCase(), firstName.trim(), lastName.trim(), title.trim(), team, office, role, status, passwordHash]
      );
    } else {
      await executeUsers(
        `INSERT INTO users (id, email, first_name, last_name, title, department, team, office, role, status, password_hash, created_at)
         VALUES (?, ?, ?, ?, ?, 'Default', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [id, email.toLowerCase(), firstName.trim(), lastName.trim(), title.trim(), team, office, role, status, passwordHash]
      );
    }

    if (!isFirstUser) {
      emitUserChange('created');
      void logActivity(req, {
        action: 'auth.signup',
        entityType: 'user',
        entityId: id,
        details: { team, office, firstUser: false },
        userOverride: { id, email: email.toLowerCase(), name: `${firstName.trim()} ${lastName.trim()}` },
      });
      return NextResponse.json(
        { message: 'Registration successful. Your account is pending admin approval.' },
        { status: 201 }
      );
    }

    // First user: sign JWT and set session cookie
    const jwt = await signJWT({
      sub: id,
      email: email.toLowerCase(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      role: 'admin',
      status: 'active',
      team: team,
    });

    const rows = await queryUsers('SELECT * FROM users WHERE id = ?', [id]);
    const user = rowToUser(rows[0] as Record<string, unknown>);

    void logActivity(req, {
      action: 'auth.signup',
      entityType: 'user',
      entityId: id,
      details: { team, office, firstUser: true },
      userOverride: { id, email: email.toLowerCase(), name: `${firstName.trim()} ${lastName.trim()}` },
    });

    const response = NextResponse.json({ user, isFirstUser: true }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, jwt, COOKIE_OPTIONS);
    return response;
  } catch (err) {
    console.error('[POST /api/auth/signup]', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
