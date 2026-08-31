# OddsAPI Smoke Test Checklist

## Core App Load
- Open app with a valid API key and confirm sports catalog loads.
- Refresh page and confirm it restores the same view/scope/range.
- Confirm status bar appears and auto-hides after ~6 seconds.

## Auth and Key Handling
- Save API key and verify app can load data.
- Sign out and verify login modal appears.
- Verify saved API key dropdown still lists masked keys after sign out.
- Verify invalid/placeholder key is rejected.
- Enable Secure Mode and verify saved API key dropdown is hidden.
- Enable Secure Mode and verify API key is not restored after a browser restart.

## Settings and Shortcuts
- Open settings and verify scope/range/filter controls render correctly.
- Confirm `Esc` closes open modal(s), or opens settings if none are open.
- Confirm `S` toggles search and focuses input when enabled.
- Confirm spacebar in settings modal triggers logout (current expected behavior).

## Catalog and Favorites
- Save a sport and verify icon/state changes.
- In favorites scope, verify saved items show red trash action.
- Remove a favorite and verify list/state updates immediately.
- On mobile width, verify sports cards hide Title/Group rows and use relabeled first two rows.

## Results / Upcoming
- Load Results, Live, and Upcoming ranges.
- Verify result sport scope dropdown filters visible results.
- Verify View More works for Upcoming/Recent and persists across refresh.

## Resilience
- Temporarily block network and verify fallback messages show without crashes.
- Re-enable network and verify app recovers on next load action.
- Confirm no console runtime errors during normal navigation.

## Visual Consistency
- Confirm settings modal uses black theme.
- Confirm white-theme inputs render with readable text/focus states.
- Confirm desktop shortcut bar is only visible at 1200px and wider.

## Automated Smoke Suite
- Install deps: `npm install`
- Install browser runtime once: `npx playwright install`
- Run smoke tests: `npm run test:smoke`
