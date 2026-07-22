# Security hardening queue

The current public build is suitable for a small launch. These follow-ups are
queued before broader promotion.

- [ ] Add and validate an OAuth `state` value during Spotify PKCE login.
- [ ] Add explicit security headers to Netlify Function responses.
- [ ] Replace the per-instance API limiter with shared rate limiting if traffic grows.
- [ ] Add a short privacy notice explaining what Spotify data is read and retained.
- [ ] Confirm two-factor authentication on Netlify, GitHub, and the domain account.
- [ ] Recheck that `.env` and access tokens are excluded before every release.

Last audit: 2026-07-22

- Production dependency vulnerabilities: 0
- Public secret exposure found: none
- Payment or financial permissions: none
