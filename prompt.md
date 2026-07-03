Google OAuth is fully working.

The Google popup appears, I can select my account, grant permission, and the backend verifies the Google ID token.

However, after verification the backend responds:

"Your email is not from a recognized campus. AnonymousU is for verified students only."

The account I used is:

*@poornima.edu.in

This domain is intended to be supported.

Do NOT guess.

Trace the entire backend authentication flow and identify the exact reason for the rejection.

Requirements:

1. Find the exact line of code that produces the message:
   "Your email is not from a recognized campus. AnonymousU is for verified students only."

2. Trace the authentication flow from:
   POST /auth/google
   until the rejection occurs.

3. Log (without exposing secrets):
   - verified Google email
   - extracted email domain
   - hd claim
   - campus lookup input
   - lookup result
   - final rejection reason

4. Determine whether the rejection is caused by:
   - a hardcoded whitelist
   - the campuses database/table
   - missing seed data
   - regex/domain parsing
   - Google hd claim
   - another validation step

5. Search the entire repository for:
   - poornima
   - edu.in
   - recognized campus
   - campus domain
   - allowed domains

6. If poornima.edu.in is missing from the configured campuses, add it in the correct place (seed/config/database), not as a temporary hardcoded exception.

7. If the lookup logic is incorrect (for example, extracting the wrong domain), fix the logic instead.

8. Verify by performing a real login with a poornima.edu.in account and confirm authentication succeeds.

Do not stop after identifying the issue. Fix the root cause and verify the complete login flow.