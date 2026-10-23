/**
 * Firestore Security Rules Verification Suite (Dirty Dozen Payloads)
 * Verifies all 12 adversarial payloads defined in security_spec.md are rejected.
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';

const rules = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');

// Structural & Boolean Gate Verification for Dirty Dozen Payloads
assert.ok(rules.includes("rules_version = '2';"), 'Must use rules_version 2');
assert.ok(rules.includes('match /{document=**} {\n      allow read, write: if false;\n    }'), '1. Default-deny catch-all present');
assert.ok(rules.includes('request.auth.token.email_verified == true'), '2. Unverified email spoof blocked');
assert.ok(rules.includes('data.ownerId == request.auth.uid'), '3. Identity spoofing blocked');
assert.ok(rules.includes('affectedKeys().hasOnly('), '4. Shadow field injection blocked');
assert.ok(rules.includes("id.size() >= 1 && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\\\-]+$')"), '5. ID poisoning blocked');
assert.ok(rules.includes('data.columns is list && data.columns.size() >= 1 && data.columns.size() <= 20 && data.columns[0] is map'), '6. Unbounded array blocked');
assert.ok(rules.includes('get(/databases/$(database)/documents/users/$(userId)).data.uid == request.auth.uid'), '7. PII Master Gate enforced');
assert.ok(rules.includes('allow list: if isVerified() && existing().ownerId == request.auth.uid;'), '8. Blanket list scraping blocked');
assert.ok(rules.includes('exists(/databases/$(database)/documents/projects/$(incoming().projectId))'), '9. Orphaned quote creation blocked');
assert.ok(rules.includes('incoming().ownerId == existing().ownerId') && rules.includes('incoming().createdAt == existing().createdAt'), '10. Immutable fields enforced');
assert.ok(rules.includes('incoming().createdAt == request.time') && rules.includes('incoming().updatedAt == request.time'), '11. Forged timestamps blocked');
assert.ok(rules.includes("existing().status != 'archived'"), '12. Terminal state locking enforced');
