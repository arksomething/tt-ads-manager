import assert from "node:assert/strict";
import test from "node:test";

import {
  CREATOR_PORTAL_COOKIE_NAME,
  CREATOR_PORTAL_SESSION_MAX_AGE_SECONDS,
  createCreatorPortalSessionValue,
  decryptCreatorPortalLinkToken,
  encryptCreatorPortalLinkToken,
  generateCreatorPortalLinkToken,
  getCreatorPortalSessionCookieOptions,
  hashCreatorPortalSecret,
  verifyCreatorPortalSessionValue,
} from "../src/server/creator-portal/tokens.ts";

test("generated creator portal links are difficult to guess", () => {
  const token = generateCreatorPortalLinkToken();

  assert.ok(token.length >= 40);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(token, generateCreatorPortalLinkToken());
});

test("creator portal secrets hash without storing public tokens", () => {
  assert.equal(hashCreatorPortalSecret("private-link").length, 64);
});

test("creator portal session signatures reject tampering", () => {
  const secret = "test-secret-with-at-least-thirty-two-characters";
  const sessionValue = createCreatorPortalSessionValue("access_123", secret);

  assert.equal(
    verifyCreatorPortalSessionValue(sessionValue, secret),
    "access_123",
  );
  assert.equal(
    verifyCreatorPortalSessionValue(sessionValue.replace("access_123", "access_456"), secret),
    null,
  );
  assert.equal(
    verifyCreatorPortalSessionValue(sessionValue, `${secret}-wrong`),
    null,
  );
});

test("creator portal session cookies are scoped to portal pages", () => {
  const cookieOptions = getCreatorPortalSessionCookieOptions();

  assert.equal(CREATOR_PORTAL_COOKIE_NAME, "bv_creator_portal");
  assert.equal(cookieOptions.httpOnly, true);
  assert.equal(cookieOptions.path, "/creator");
  assert.equal(cookieOptions.sameSite, "lax");
  assert.equal(cookieOptions.maxAge, CREATOR_PORTAL_SESSION_MAX_AGE_SECONDS);
});

test("creator portal link tokens can be encrypted for later copying", () => {
  const secret = "test-secret-value-that-is-at-least-32-bytes";
  const token = generateCreatorPortalLinkToken();
  const encrypted = encryptCreatorPortalLinkToken(token, secret);

  assert.notEqual(encrypted, token);
  assert.equal(decryptCreatorPortalLinkToken(encrypted, secret), token);
  assert.equal(
    decryptCreatorPortalLinkToken(
      encrypted,
      "different-secret-value-that-is-at-least-32-bytes",
    ),
    null,
  );
  assert.equal(decryptCreatorPortalLinkToken("not-a-valid-ciphertext", secret), null);
});
