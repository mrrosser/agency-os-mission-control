# Local recipient-copy support — 2026-10-19

Status: locally prepared and reviewed; not deployed or release-ready. All proposed recipient copy remains unapproved.

The isolated implementation adds optional recipient-scoped greeting and first-paragraph records for the existing approved-design format. Identity, candidate fingerprint, exact content, renderer implementation and normalized rendered output are frozen into audience/action approval. Both creation replay paths bind the layer. Approval requires an explicit current copy-review fingerprint and all-recipient previews. Later variants are visible in review; checkbox assent does not survive a changed pilot or content binding.

The shared parent artifact and exact shared-content comparison remain intact. A personalized completed parent must also retain its exact copy-review approval binding. Existing consent, suppression, prior-invitation, duplicate, cadence, capability and ambiguous-outcome protections remain in place. Historical renderer, MIME, greeting and permission sources are unchanged.

## Validation

- Full unit/smoke run: 2,362/2,370 passed across 270 files. All eight failures were Windows sandbox EACCES connecting to local gRPC fixture servers.
- Focused local compatibility rerun: 18/18 passed, including all eight failed cases. Its eight connections were permitted only to literal 127.0.0.1 server ports opened in the same process; no external connections executed.
- New feature cases: 79/79 passed under strict offline isolation.
- Independent focused review: 170/170 passed, including actual claim and provider transaction-boundary drift, all variants, approval replay, UI assent invalidation and parent completion.
- TypeScript passed. ESLint passed with the two existing unrelated Google callback unused-variable warnings.
- Gitleaks patch scan: zero findings.
- Independent five-mode source/runtime comparison preserves legacy renderer/MIME implementation fingerprints, all pilot fingerprints, approved/launched snapshots and previews. This does not prove production-bundled function-source parity.
- Private mapping outside the repository reproduces all twenty proposed messages exactly after inert-link placeholder normalization. Four opening changes and two greeting changes affect five recipients; sixteen openings and eighteen greetings stay unchanged.

## Limitations

The production build failed within the offline boundary: eight existing Google Fonts connection attempts were blocked before execution, and a generated `.next/types` directory returned EPERM. The guard was not relaxed. No complete production build or production-bundled `Function.toString()` parity has been established.

No fresh registry audit ran. Package manifests match the earlier same-day audit exactly; that historical audit reported eighteen moderate and zero high/critical findings. This is not a current advisory refresh.

No deployment, PR, merge, live smoke, pilot creation, capability issuance, provider call, DNS lookup, contact write, consent write or email send occurred. Owner approval of the exact recipients and proposed copy, current relationship/permission/prior-send checks, authorized fresh domain checks, and the separate application approval/launch workflow remain outstanding.

## Evidence outside this isolated repository

The workspace contains the final code freeze, code patch, complete patch, aggregate readiness receipt, private mapping, original test receipts and independent review artifacts under the `CRM_RECIPIENT_COPY_` / `CRM_NEXT_TWENTY_RECIPIENT_COPY_` prefixes. The canonical source checkout remains clean at a55a81cc0394f7ec5f7a7c37e73ceaff27f163cf (deployed tree 9437c0a64fe82e2a86852f5fc7bcbf9ad46ffc73). No private recipient identity or proposed personal prose is included in source or tests.
