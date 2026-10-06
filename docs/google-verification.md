# Getting AgencyOS verified by Google (removes the "Google hasn't verified this app" screen)

Joshua Nunez. AgencyOS asks for two read-only permissions: Search Console (`webmasters.readonly`) and Google Analytics (`analytics.readonly`). Both are "sensitive", not "restricted", so verification is free and needs no security audit. It usually takes days to a couple of weeks.

## Already done in the app
- A public home page at `https://agency.joshnunezseo.com/about` that says what the app does and links to the privacy policy.
- A privacy policy at `https://agency.joshnunezseo.com/privacy` with the Google API Services User Data Policy and Limited Use statement.
- The sign-in page links to both.

## Your clicks in Google Cloud (about 15 minutes)
1. Prove you own the domain: open Google Search Console, add `joshnunezseo.com` as a property (a DNS TXT record in Cloudflare, or it may already be verified).
2. Google Cloud, Google Auth Platform, **Branding**: app name `AgencyOS`, support email `joshnunez.work@gmail.com`, **Application home page** `https://agency.joshnunezseo.com/about`, **Privacy policy** `https://agency.joshnunezseo.com/privacy`, **Terms of service** `https://agency.joshnunezseo.com/terms` (optional), authorized domain `joshnunezseo.com`, developer contact email. A logo is optional.
3. **Data Access**: make sure these scopes are listed: `.../auth/webmasters.readonly`, `.../auth/analytics.readonly` (plus openid, email, profile).
4. **Audience**: keep "In production".
5. **Verification Center**: press **Submit for verification**. Paste the justifications below and the link to your video.

## Text to paste (scope justifications)
- **webmasters.readonly:** AgencyOS is an operating system for digital agencies. An agency administrator connects their Google account so AgencyOS can read monthly totals (clicks, impressions, average position) from Search Console for the websites the agency manages, and show them on the client's results page and in the client report. It only reads. It never changes anything in Search Console.
- **analytics.readonly:** The same administrator connects Google Analytics so AgencyOS can read monthly totals (sessions, users, conversions) for the GA4 properties the agency manages, and show them in the same results page and report. It only reads. It never changes anything in Analytics.
- **Why not a narrower scope:** these are the narrowest read-only scopes Google offers for these two products.

## The demo video (2 to 3 minutes, you record it; unlisted on YouTube)
1. Show the browser address bar on `agency.joshnunezseo.com` and the sign-in page with the About and privacy links.
2. Sign in, open Settings, press **Add Google account**. Show the Google consent screen with the app name and the two permissions (read-only), and approve.
3. Open a client, Results, choose the Search Console site and the GA4 property from the picker, and press Sync.
4. Show the monthly numbers on the results page and in a generated report.
5. Back in Settings, remove the connected Google account to show how access is removed.
Say out loud what each step is doing. English is fine.

## Afterwards
When Google approves, the warning disappears for everyone. If Google asks a question by email, reply from `joshnunez.work@gmail.com`; paste the question here and I will write the answer.
