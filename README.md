# Plan

One visual board for tasks, notes, photos, plans, money and people, with Gmail and Google Calendar on the same board.

- 57 card types (Today, Week, Month, Habit, Budget, Trip, Meals, Goal, Photo, Sticky…) from the **+** button
- Boards, colour-coded spaces, search, adjustable column count
- Drag cards to reorder: drag the header with a mouse, or press and hold it on a phone
- Tap a card's icon to open it full size; delete has Undo
- **Gmail inbox** card: unread mail from every connected account; one tap turns an email into a to-do
- **Calendar** card: the next 7 days, plus "New event" which writes to Google Calendar. Today and Day plan cards show today's events too
- Light, dark or system theme; keyboard shortcuts (`N` new card, `/` search)
- Installable to the home screen and usable offline once hosted over HTTPS
- Everything is stored on the device (IndexedDB). Settings has backup and restore

## Run

```
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/, host anywhere
```

## Connect Google (one-time)

The app talks to Google straight from the browser, so it needs your own OAuth client ID (free):

1. Go to https://console.cloud.google.com, create a project.
2. **APIs & Services → Library**: enable **Gmail API** and **Google Calendar API**.
3. **OAuth consent screen**: External; add your Gmail addresses under **Test users**.
4. **Credentials → Create credentials → OAuth client ID → Web application**. Under **Authorised JavaScript origins** add the address the app runs on (`http://localhost:5173` and your hosted URL).
5. Copy the client ID into **Settings** in the app (or set `VITE_GOOGLE_CLIENT_ID` in `.env`), then **Connect Google account**. Repeat "Add another Google account" for each account.

Scopes requested: `gmail.readonly` (read mail) and `calendar.events` (read and create events).

Limits to know:
- Sign-in sessions last about an hour; the card then shows a **Reconnect** button (one tap, no password). Staying signed in permanently needs a small server holding refresh tokens.
- While the Google project is in "Testing", only the test users you listed can connect. Opening it to the public requires Google's verification because Gmail is a restricted scope.
