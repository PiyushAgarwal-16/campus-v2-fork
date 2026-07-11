import './setupEnv.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import type { AccessTokenClaims, AccountStatus } from '@campusly/shared-types';
import { requireActiveAccount } from '../src/middleware/requireActiveAccount.js';
import { AuthenticationError, ForbiddenError } from '../src/domain/errors.js';

/**
 * requireActiveAccount guard (Admin Control Center Req 3.1). The decision is
 * made solely from verified token claims (`req.auth`); no I/O is involved.
 */

function makeReq(auth: AccessTokenClaims | undefined): Request {
  return { auth } as unknown as Request;
}

const res = {} as Response;

/** Non-active statuses that must be denied on admin surfaces. */
const BLOCKED_STATUSES: AccountStatus[] = [
  'pending_verification',
  'restricted',
  'suspended',
  'banned',
  'deactivated',
];

function claims(status: AccountStatus): AccessTokenClaims {
  return { sub: 'u1', role: 'admin', status, universityId: 'univ1' };
}

test('requireActiveAccount: calls next() for an active account', () => {
  let called = false;
  requireActiveAccount(makeReq(claims('active')), res, () => {
    called = true;
  });
  assert.equal(called, true);
});

for (const status of BLOCKED_STATUSES) {
  test(`requireActiveAccount: throws ForbiddenError for status "${status}"`, () => {
    assert.throws(
      () =>
        requireActiveAccount(makeReq(claims(status)), res, () => {
          throw new Error('next() must not be called for a non-active account');
        }),
      ForbiddenError,
    );
  });
}

test('requireActiveAccount: throws AuthenticationError when claims are absent (unguarded route)', () => {
  assert.throws(
    () =>
      requireActiveAccount(makeReq(undefined), res, () => {
        throw new Error('next() must not be called without verified claims');
      }),
    AuthenticationError,
  );
});
