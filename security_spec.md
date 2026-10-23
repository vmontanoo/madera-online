# Security Specification (`security_spec.md`) — Dajusca.app Firestore

## 1. Data Invariants

1. **Default-Deny Catch-All**: Every path not explicitly matched under `/databases/{database}/documents` is unconditionally denied (`allow read, write: if false;`).
2. **Verified Identity**: Every read/write requires an authenticated user with a verified email (`request.auth != null && request.auth.token.email_verified == true`), or a registered owner UID matching `request.auth.uid`.
3. **PII Split Isolation**: User public profile data lives at `/users/{userId}` while PII (`email`) is strictly isolated in `/users/{userId}/private/{docId}`, guarded by a Master Gate checking parent ownership (`get(/databases/$(database)/documents/users/$(userId)).data.uid == request.auth.uid`).
4. **Strict Ownership & Query Enforcement**: `/projects/{projectId}`, `/clients/{clientId}`, and `/quotes/{quoteId}` enforce `resource.data.ownerId == request.auth.uid` on both `get` and `list` operations without delegating security to client queries.
5. **Relational Integrity on Quotes**: A `QuoteRecord` cannot be created unless its referenced `projectId` exists and belongs to `request.auth.uid`.
6. **Terminal State Locking**: Once a `QuoteRecord` reaches `status == 'archived'`, no further updates are permitted.
7. **Temporal & Immutable Integrity**: `createdAt` and `updatedAt` must equal `request.time`; `ownerId`, `uid`, and `createdAt` are immutable across updates.

## 2. The "Dirty Dozen" Payloads

1. **Unverified Email Spoof**: Authenticated user with `email_verified: false` attempting to create `/users/{uid}`.
2. **Identity Spoofing on Project Create**: Authenticated user setting `ownerId: "victim-uid"` on `/projects/proj_1`.
3. **Shadow Field Injection on Project Update**: Owner updating `/projects/proj_1` with an undeclared field `{"isAdmin": true}`.
4. **ID Poisoning Attack**: Creating `/projects/{200-char-id}` exceeding the 128-character regex guard.
5. **Unbounded Array / Denial-of-Wallet**: Creating `/projects/proj_1` with `columns: []` or 25 columns (`size() > 20`).
6. **PII Lateral Read**: Authenticated user `attacker-uid` attempting `get` on `/users/victim-uid/private/info` or `/clients/client_1`.
7. **Blanket List Scraping**: Authenticated user running an unfiltered `list` query on `/projects` without `where('ownerId', '==', uid)`.
8. **Orphaned Quote Creation**: Creating `/quotes/q_1` referencing a non-existent `projectId` or a project owned by another user.
9. **Immutable Field Mutation**: Owner attempting to change `createdAt` or `ownerId` during an update on `/projects/proj_1`.
10. **Forged Client Timestamp**: Creating `/clients/c_1` with a past/future `createdAt` timestamp instead of `request.time`.
11. **Terminal State Bypass**: Owner attempting to update `/quotes/q_1` after `status` is already `'archived'`.
12. **Value Poisoning on Update**: Owner updating a whitelisted field (`name`) on `/clients/c_1` with a 500-character string or a boolean.
