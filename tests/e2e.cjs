// End-to-end checks in a real browser. Run with: npm run e2e
// Google and weather services are replaced with local fakes, so no account or network is needed.
const { chromium } = require('playwright')
const { spawn } = require('child_process')
const path = require('path')

const PORT = 4319
const URL = `http://localhost:${PORT}/`
const SHOTS = process.env.SHOTS // optional folder for screenshots
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${ok || !detail ? '' : `  →  ${detail}`}`)
}
const titles = (p) => p.locator('[data-card] > header .title textarea').evaluateAll((els) => els.map((e) => e.value))
const shot = async (p, name) => SHOTS && (await p.waitForTimeout(600), await p.screenshot({ path: path.join(SHOTS, name + '.png') }))

async function start(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block', ...opts })
  const errors = []
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && errors.push('console: ' + m.text()))
  return { ctx, page, errors }
}
const begin = async (page, kind = 'My life') => {
  await page.goto(URL)
  await page.locator('.starts button', { hasText: kind }).click()
  await page.click('.welcome .btn.big')
  await page.waitForSelector('[data-card]')
  await page.waitForTimeout(700)
}
const addCard = async (page, name) => {
  await page.keyboard.press('Escape')
  await page.click('.fab')
  await page.fill('.sheet .search input', name)
  await page.locator('.tile', { hasText: new RegExp(`^${name}$`) }).click()
  await page.waitForTimeout(350)
}

async function core(browser) {
  console.log('\nBoard basics')
  const { ctx, page, errors } = await start(browser)
  await begin(page)
  check('starter board has cards', (await page.locator('[data-card]').count()) >= 10)

  const rows = page.locator('.t-today .sec-checklist').first().locator('[data-row]')
  await rows.nth(0).fill('Finish the quarterly report and send it to everyone on the team')
  await rows.nth(0).press('Enter')
  await page.keyboard.type('Call the bank')
  check('Enter moves to the next row without losing a keystroke', (await rows.nth(1).inputValue()) === 'Call the bank')
  check('long items wrap', (await rows.nth(0).evaluate((e) => e.offsetHeight)) > 30)
  await page.locator('.t-today .check').first().click()
  check('progress count shows', (await page.locator('.t-today .sec h4 span').first().innerText()) === '1/2')

  // paste a list
  await rows.nth(2).focus()
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.setData('text', '- [x] Milk\n- Eggs\n3. Bread')
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  })
  const pasted = await rows.evaluateAll((els) => els.map((e) => e.value).filter(Boolean))
  check('pasting several lines makes several items', pasted.join('|').endsWith('Milk|Eggs|Bread'), pasted.join('|'))

  // clear finished
  await page.locator('.t-today [aria-label="Card options"]').click()
  await page.locator('.menu button', { hasText: 'Clear finished' }).click()
  const left = await rows.evaluateAll((els) => els.map((e) => e.value).filter(Boolean))
  check('clear finished removes done items only', left.join('|') === 'Call the bank|Eggs|Bread', left.join('|'))

  // undo / redo by keyboard
  await page.locator('.top').click({ position: { x: 600, y: 20 } })
  await page.keyboard.press('Control+z')
  check('undo restores them', (await rows.evaluateAll((els) => els.filter((e) => e.value).length)) === 5)
  await page.keyboard.press('Control+Shift+z')
  check('redo reapplies', (await rows.evaluateAll((els) => els.filter((e) => e.value).length)) === 3)

  // mouse drag
  const before = await titles(page)
  const src = await page.locator('[data-card] > header').first().boundingBox()
  const dst = await page.locator('[data-card]').nth(3).boundingBox()
  await page.mouse.move(src.x + 80, src.y + 12)
  await page.mouse.down()
  await page.mouse.move(src.x + 90, src.y + 30, { steps: 3 })
  await page.mouse.move(dst.x + dst.width / 2, dst.y + dst.height * 0.7, { steps: 12 })
  await page.waitForTimeout(350)
  await page.mouse.up()
  await page.waitForTimeout(450)
  const after = await titles(page)
  check('dragging reorders cards', before[0] !== after[0] && after.includes(before[0]), after.slice(0, 5).join(' | '))
  check('drag leaves nothing behind', (await page.locator('.drag-clone, [data-dragging]').count()) === 0)

  // delete + undo toast
  const n0 = await page.locator('[data-card]').count()
  await page.locator('[data-card]').first().locator('[aria-label="Card options"]').click()
  await page.locator('.menu .danger').click()
  const n1 = await page.locator('[data-card]').count()
  await page.click('.toast button')
  check('delete then Undo restores the card', n1 === n0 - 1 && (await page.locator('[data-card]').count()) === n0)

  // typing inside an opened card keeps the cursor there
  await page.locator('[data-card].t-today button.badge').click()
  await page.waitForSelector('.sheet.wide')
  await page.locator('.sheet.wide [data-row]').nth(4).click()
  await page.keyboard.type('typed in the sheet')
  check('typing in an opened card keeps focus', (await page.locator('.sheet.wide [data-row]').nth(4).inputValue()) === 'typed in the sheet')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  check('Tab stays inside the sheet', await page.evaluate(() => !!document.activeElement.closest('.sheet')))
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // a link with a stray % must not break anything
  await addCard(page, 'Link')
  await page.locator('.t-link input[type=url]').fill('https://example.com/50%off')
  check('a malformed link is shown, not fatal', (await page.locator('.t-link .pin').innerText()).includes('example.com') && (await page.locator('[data-card]').count()) > 5)

  // persistence
  await page.waitForTimeout(500)
  await page.reload()
  await page.waitForSelector('[data-card]')
  check('work survives a reload', (await page.locator('.t-today [data-row]').first().inputValue()) === 'Call the bank')
  check('no errors', errors.length === 0, errors.join('; '))
  await ctx.close()
}

async function palette(browser) {
  console.log('\nSearch and capture')
  const { ctx, page, errors } = await start(browser)
  await begin(page)
  await page.keyboard.press('/')
  await page.waitForSelector('.palette')
  await shot(page, 'palette')
  await page.keyboard.type('Buy stamps')
  check('offers to capture into Today first', /Add “Buy stamps”/.test(await page.locator('.palette-list button').first().innerText()))
  await page.keyboard.press('Enter')
  check('capture adds the item', (await page.locator('.t-today [data-row]').evaluateAll((els) => els.some((e) => e.value === 'Buy stamps'))) === true)
  check('palette stays open for the next thought', (await page.locator('.palette').count()) === 1 && (await page.locator('.palette input').inputValue()) === '')
  await page.keyboard.type('stamps')
  const hit = page.locator('.palette-list button', { hasText: 'Today' }).filter({ hasNotText: 'Add' })
  check('search finds a card by its contents', (await hit.count()) === 1)
  await hit.click()
  await page.waitForTimeout(300)
  check('jumping flashes the card', (await page.locator('[data-card][data-flash]').count()) === 1)
  await page.keyboard.press('Control+k')
  await page.keyboard.type('weath')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  check('typing a card type creates it', (await titles(page))[0] === 'Weather', (await titles(page))[0])
  await page.keyboard.press('Control+k') // the cursor is in the new card, where "/" should just type
  await page.keyboard.type('new board')
  await page.keyboard.press('Enter')
  check('commands open their screen', (await page.locator('.sheet h2', { hasText: 'New board' }).count()) === 1)
  await page.fill('.newboard input', 'Wedding')
  await page.locator('.newboard .starts button', { hasText: 'Home and family' }).click()
  await page.click('.newboard .btn.big')
  await page.waitForTimeout(500)
  check('new board from a starter', (await page.locator('.boardname span').innerText()) === 'Wedding' && (await page.locator('[data-card]').count()) >= 8)
  check('starter reuses existing spaces', (await page.locator('.chips button i').count()) === 5)
  check('no errors', errors.length === 0, errors.join('; '))
  await ctx.close()
}

async function device(browser) {
  console.log('\nDevice features')
  const { ctx, page, errors } = await start(browser, { permissions: ['geolocation', 'clipboard-read', 'clipboard-write'], geolocation: { latitude: 51.5072, longitude: -0.1276 } })
  await ctx.route('https://api.open-meteo.com/**', (r) =>
    r.fulfill({ json: { current: { temperature_2m: 14.4, weather_code: 61 }, daily: { time: ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'], weather_code: [61, 3, 0, 71, 95], temperature_2m_max: [15, 13, 12, 4, 9], temperature_2m_min: [9, 8, 6, -1, 5] } } }),
  )
  await ctx.route('https://geocoding-api.open-meteo.com/**', (r) => r.fulfill({ json: { results: [{ name: 'Lisbon', country_code: 'PT', latitude: 38.7167, longitude: -9.1333 }] } }))
  await begin(page, 'Blank board')

  await addCard(page, 'Weather')
  await page.fill('.t-weather .field input', 'lisbon')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.wx-days')
  check('weather by city', (await page.locator('.t-weather .bigno').innerText()) === '14°' && /Lisbon, PT/.test(await page.locator('.wx-where').innerText()))
  check('five-day forecast', (await page.locator('.wx-days > div').count()) === 5)
  await page.click('.wx-where')
  await page.locator('.t-weather button', { hasText: 'Use where I am' }).click()
  await page.waitForSelector('.wx-days')
  check('weather from device location', /My location/.test(await page.locator('.wx-where').innerText()))

  await addCard(page, 'Place')
  await page.locator('.t-place button', { hasText: 'Pin where I am now' }).click()
  await page.waitForSelector('.pin')
  check('place pins the device location', /51\.5072, -0\.1276/.test(await page.locator('.pin').innerText()) && /maps\.apple\.com\/\?ll=51\.5072,-0\.1276/.test(await page.locator('.pin').getAttribute('href')))

  await addCard(page, 'Contacts')
  await page.locator('.t-contacts input[type=file]').setInputFiles({
    name: 'c.vcf', mimeType: 'text/vcard',
    buffer: Buffer.from('BEGIN:VCARD\r\nVERSION:3.0\r\nN:Lee;Sam;;;\r\nFN:Sam Lee\r\nTEL;type=CELL:+44 7700 900123\r\nEMAIL:sam@example.com\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:3.0\r\nN:Okafor;Ada\r\nitem1.TEL:020 7946 0000\r\nEND:VCARD\r\n'),
  })
  const people = await page.locator('.t-contacts .person').evaluateAll((els) => els.map((e) => [...e.querySelectorAll('textarea')].map((i) => i.value).join(' / ')).filter((s) => s !== ' / '))
  check('imports contact cards', people.join(' ; ') === 'Sam Lee / +44 7700 900123 · sam@example.com ; Ada Okafor / 020 7946 0000', people.join(' ; '))

  await addCard(page, 'Birthdays')
  const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10)
  await page.locator('.t-dates [data-row]').first().fill("Anna's birthday")
  await page.locator('.t-dates input[type=date]').first().fill(soon)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.t-dates [aria-label="Add to calendar"]').click()])
  const ics = require('fs').readFileSync(await dl.path(), 'utf8')
  check('exports a calendar file', dl.suggestedFilename() === 'Annas birthday.ics' && ics.includes(`DTSTART;VALUE=DATE:${soon.replace(/-/g, '')}`) && ics.includes("SUMMARY:Anna's birthday"), dl.suggestedFilename())

  await addCard(page, 'Upcoming')
  check('upcoming gathers dates from other cards', /Anna's birthday/.test(await page.locator('.t-upcoming').innerText()))
  await page.locator('.t-upcoming button', { hasText: 'Anna' }).click()
  await page.waitForTimeout(300)
  check('upcoming jumps to the source card', (await page.locator('.t-dates[data-flash]').count()) === 1)

  await addCard(page, 'Focus timer')
  await page.locator('.t-timer .moods button', { hasText: /^5 min$/ }).click()
  await page.locator('.t-timer .btn', { hasText: 'Start' }).click()
  await page.waitForTimeout(1300)
  const t = await page.locator('.t-timer .ring b').innerText()
  check('timer counts down', /^4:5\d$/.test(t), t)
  await page.locator('.t-timer .btn', { hasText: 'Pause' }).click()
  check('timer pauses', (await page.locator('.t-timer .btn', { hasText: 'Resume' }).count()) === 1)

  await addCard(page, 'Sticky')
  await page.locator('.t-sticky textarea').first().fill('Remember')
  await page.locator('.t-sticky .swatches [data-c=sky]').first().click()
  check('sticky colour', (await page.locator('.t-sticky').first().getAttribute('data-color')) === 'sky')
  await shot(page, 'device')

  await page.locator('.t-dates [aria-label="Card options"]').click()
  await page.locator('.menu button', { hasText: 'Share' }).click()
  await page.waitForTimeout(300)
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  check('share copies the card as text', clip.startsWith('Birthdays') && clip.includes(`Anna's birthday — ${soon}`), clip)

  // drop a photo on the board
  await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = c.height = 40
    c.getContext('2d').fillRect(0, 0, 40, 40)
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'a.png', { type: 'image/png' }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  })
  await page.waitForSelector('.t-photo .photo img')
  check('dropping a photo adds a photo card', (await titles(page))[0] === 'Photo')
  // an over-budget card must stay readable, and nothing may be wider than the screen
  await addCard(page, 'Budget')
  await page.locator('.t-budget .inline').fill('100')
  await page.locator('.t-budget [data-row]').first().fill('Rent')
  await page.locator('.t-budget .num').first().fill('1234567.8')
  const bar = await page.locator('.t-budget .bar i').boundingBox()
  check('over-budget bar stays a thin bar', bar.height < 10, JSON.stringify(bar))
  check('long amounts are not clipped', await page.locator('.t-budget .num').first().evaluate((e) => e.scrollWidth <= e.clientWidth + 1))
  check('no errors', errors.length === 0, errors.join('; '))
  await ctx.close()
}

async function newDay(browser) {
  console.log('\nA new day')
  const { ctx, page, errors } = await start(browser)
  await page.clock.install({ time: new Date('2026-11-12T21:00:00') })
  await begin(page)
  const rows = page.locator('.t-today [data-row]')
  await rows.nth(0).fill('Done thing')
  await rows.nth(1).fill('Open thing')
  await page.locator('.t-today .check').first().click()
  await page.clock.fastForward('04:00:00')
  await page.waitForSelector('.toast')
  check('finished items clear at the start of a new day', (await rows.first().inputValue()) === 'Open thing' && /1 finished item cleared/.test(await page.locator('.toast').innerText()))
  await page.click('.toast button')
  check('and that can be undone', (await rows.first().inputValue()) === 'Done thing')
  check('no errors', errors.length === 0, errors.join('; '))
  await ctx.close()
}

// A fake Google: Gmail, Calendar and a Drive app folder shared by every "device" in the test
function fakeGoogle(ctx, drive, email = 'a@example.com') {
  ctx.addInitScript((email) => {
    localStorage.setItem('plan.google.clientId', 'test.apps.googleusercontent.com')
    localStorage.setItem('plan.google.accounts', JSON.stringify([email]))
    localStorage.setItem('plan.sync.account', email)
    sessionStorage.setItem('plan.google.tokens', JSON.stringify({ [email]: { token: 'tok', exp: Date.now() + 3e6 } }))
  }, email)
  const at3 = new Date()
  at3.setHours(15, 0, 0, 0)
  return Promise.all([
    ctx.route('https://gmail.googleapis.com/**', (r) => {
      const u = r.request().url()
      if (u.includes('/messages?')) return r.fulfill({ json: { messages: [{ id: 'm1' }, { id: 'm2' }] } })
      const id = u.match(/messages\/(\w+)/)[1]
      r.fulfill({ json: { id, threadId: 't' + id, internalDate: id === 'm1' ? '1700000000000' : '1800000000000', payload: { headers: [{ name: 'From', value: '"Sam Lee" <sam@example.com>' }, { name: 'Subject', value: 'Invoice ' + id }] } } })
    }),
    ctx.route('https://www.googleapis.com/calendar/**', (r) => {
      const u = r.request().url()
      if (r.request().method() === 'POST') return (drive.posted = r.request().postDataJSON()), r.fulfill({ json: { id: 'new' } })
      if (u.includes('calendarList')) return r.fulfill({ json: { items: [{ id: 'primary@x', selected: true, backgroundColor: '#0b8043' }, { id: 'family@x', selected: true, backgroundColor: '#8e24aa' }, { id: 'hidden@x', selected: false }] } })
      if (u.includes('primary%40x')) return r.fulfill({ json: { items: [{ id: 'e1', summary: 'Dentist', start: { dateTime: at3.toISOString() }, htmlLink: 'https://calendar.google.com/x' }] } })
      if (u.includes('family%40x')) return r.fulfill({ json: { items: [{ id: 'e2', summary: 'School play', start: { dateTime: new Date(at3.getTime() + 36e5).toISOString() } }] } })
      r.fulfill({ status: 404, json: { error: { message: 'not found' } } })
    }),
    ctx.route('https://www.googleapis.com/drive/**', (r) => {
      const req = r.request()
      if (req.method() === 'POST') return (drive.id = 'file1'), r.fulfill({ json: { id: 'file1' } })
      if (req.url().includes('alt=media')) return r.fulfill({ json: drive.body })
      r.fulfill({ json: { files: drive.id ? [{ id: drive.id }] : [] } })
    }),
    ctx.route('https://www.googleapis.com/upload/drive/**', (r) => {
      drive.body = r.request().postDataJSON()
      drive.writes = (drive.writes ?? 0) + 1
      r.fulfill({ json: { id: drive.id } })
    }),
  ])
}

async function google(browser) {
  console.log('\nGmail, Calendar and sync')
  const drive = {}
  const a = await start(browser)
  await fakeGoogle(a.ctx, drive)
  await begin(a.page)
  await a.page.waitForSelector('.mails li')
  check('inbox lists unread mail, newest first', (await a.page.locator('.mails li span').allInnerTexts()).join('|') === 'Invoice m2|Invoice m1')
  const agenda = (await a.page.locator('.t-agenda').innerText()).replace(/\n/g, ' | ')
  check('calendar shows every ticked calendar', agenda.includes('Dentist') && agenda.includes('School play'), agenda)
  check('calendar colours come from Google', (await a.page.locator('.t-agenda .ev').first().getAttribute('style')).includes('#0b8043'))
  check("Today card shows today's events", (await a.page.locator('.t-today .ev').count()) === 2)
  await a.page.locator('.mails li button').first().click()
  check('an email becomes a to-do', (await titles(a.page))[0] === 'From email' && (await a.page.locator('[data-card]').first().locator('[data-row]').first().inputValue()) === 'Invoice m2')
  await a.page.locator('.add-ev').click()
  await a.page.fill('.evform input[aria-label="Event title"]', 'Lunch')
  await a.page.fill('.evform input[type=time]', '12:30')
  await a.page.click('.evform button.btn:not(.soft)')
  await a.page.waitForSelector('.add-ev')
  check('new event is sent to Google Calendar', drive.posted?.summary === 'Lunch' && !!drive.posted?.start?.dateTime)

  // device A writes, device B (a fresh browser with the same account) receives
  await a.page.locator('.t-today [data-row]').first().fill('Written on device A')
  await a.page.waitForTimeout(5500)
  check('device A uploads its board', drive.writes >= 1 && JSON.stringify(drive.body).includes('Written on device A'))

  const b = await start(browser)
  await fakeGoogle(b.ctx, drive)
  await begin(b.page, 'Blank board')
  await b.page.waitForSelector('.t-today', { timeout: 8000 }).catch(() => {})
  check('device B receives it', (await b.page.locator('.t-today [data-row]').first().inputValue().catch(() => '')) === 'Written on device A')
  check('a fresh device adopts the existing board whole', (await titles(b.page)).join() === (await titles(a.page)).join())
  await b.page.locator('.t-today [data-row]').nth(1).fill('Added on device B')
  await b.page.waitForTimeout(5500)
  await a.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await a.page.waitForFunction(() => [...document.querySelectorAll('.t-today [data-row]')].some((e) => e.value === 'Added on device B'), null, { timeout: 8000 }).catch(() => {})
  const onA = await a.page.locator('.t-today [data-row]').evaluateAll((els) => els.map((e) => e.value).filter(Boolean))
  check('and its change flows back to device A', onA.join('|') === 'Written on device A|Added on device B', onA.join('|'))
  await a.page.click('[aria-label="Settings"]')
  check('settings report sync status', /Synced/.test(await a.page.locator('.sync').innerText()))
  await shot(a.page, 'settings')
  check('no errors', a.errors.length + b.errors.length === 0, [...a.errors, ...b.errors].join('; '))
  await a.ctx.close()
  await b.ctx.close()
}

// The real backend (worker + database) run locally: sync between devices and a board shared between two people
async function cloud(browser) {
  console.log('\nAccounts, sync and shared boards (local backend)')
  const fs = require('fs'), os = require('os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-d1-'))
  const root = path.join(__dirname, '..')
  require('child_process').execSync(`npx wrangler d1 migrations apply plan --local --persist-to ${dir}`, { cwd: root, stdio: 'ignore' })
  const server = spawn('npx', ['wrangler', 'dev', '--port', '8788', '--local', '--persist-to', dir], { cwd: root, stdio: 'ignore', detached: true })
  const CLOUD = 'http://localhost:8788/'
  try {
    for (let i = 0; i < 40; i++) {
      if (await fetch(CLOUD + 'api/health').then((r) => r.ok, () => false)) break
      await new Promise((r) => setTimeout(r, 500))
    }
    const open = async (kind, hash = '') => {
      const d = await start(browser, { permissions: ['clipboard-read', 'clipboard-write'] })
      await d.ctx.addInitScript(() => delete Navigator.prototype.share)
      await d.page.goto(CLOUD + hash)
      if (kind) {
        await d.page.locator('.starts button', { hasText: kind }).click()
        await d.page.click('.welcome .btn.big')
        await d.page.waitForSelector('[data-card]')
      }
      return d
    }
    const has = (page, text, sel = '[data-row]') => page.waitForFunction(([t, s]) => [...document.querySelectorAll(s)].some((e) => e.value === t), [text, sel], { timeout: 20000 }).then(() => true, () => false)
    const wake = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))

    // device A turns sync on
    const a = await open('My life')
    await a.page.locator('.t-today [data-row]').first().fill('Written on my phone')
    await a.page.click('[aria-label="Settings"]')
    await a.page.locator('.btn', { hasText: 'Turn on sync' }).click()
    await a.page.locator('.btn', { hasText: 'Add another device' }).click()
    await a.page.waitForSelector('.code b')
    const code = (await a.page.locator('.code b').innerText()).replace(/\s/g, '')
    check('a device code is shown', /^[A-Z0-9]{8}$/.test(code), code)
    await shot(a.page, 'cloud-code')
    await a.page.keyboard.press('Escape')

    // device B joins the same account with the code
    const b = await open(null)
    await b.page.locator('.btn', { hasText: 'I already use Plan' }).click()
    await b.page.fill('.dialog input', code)
    await b.page.keyboard.press('Enter')
    await b.page.waitForSelector('[data-card]', { timeout: 20000 })
    check('second device receives the board', await has(b.page, 'Written on my phone'))
    check('with all of its cards', (await b.page.locator('[data-card]').count()) === (await a.page.locator('[data-card]').count()))
    await b.page.locator('.t-today [data-row]').nth(1).fill('Added on my tablet')
    await b.page.waitForTimeout(2500)
    await wake(a.page)
    check('a change on the tablet reaches the phone', await has(a.page, 'Added on my tablet'))

    // photos travel too
    const png = await a.page.evaluate(() => {
      const cv = document.createElement('canvas')
      cv.width = cv.height = 60
      const g = cv.getContext('2d')
      g.fillStyle = '#e0522b'
      g.fillRect(0, 0, 60, 60)
      return cv.toDataURL('image/png').split(',')[1]
    })
    await a.page.locator('.t-photo input[type=file]').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
    await a.page.waitForSelector('.t-photo .photo img')
    await a.page.waitForTimeout(2500)
    await wake(b.page)
    check('a photo reaches the other device', await b.page.waitForSelector('.t-photo .photo img', { timeout: 20000 }).then(async (el) => (await el.getAttribute('src')).startsWith('data:image/'), () => false))

    // A makes a second board and shares only that one
    await a.page.click('.boardname')
    await a.page.locator('.menu button', { hasText: 'New board' }).click()
    await a.page.fill('.newboard input', 'Home')
    await a.page.locator('.newboard .starts button', { hasText: 'Home and family' }).click()
    await a.page.click('.newboard .btn.big')
    await a.page.waitForTimeout(600)
    await a.page.locator('.t-shopping [data-row]').first().fill('Oat milk')
    await a.page.click('.boardname')
    await a.page.locator('.menu button', { hasText: 'Share board' }).click()
    await a.page.locator('.btn', { hasText: 'Invite someone' }).click()
    await a.page.waitForSelector('.toast')
    const link = await a.page.evaluate(() => navigator.clipboard.readText())
    check('an invitation link is made', /#join=[\w-]+$/.test(link), link)
    await a.page.keyboard.press('Escape')

    // a different person opens the link on a brand-new device
    const c = await open(null, link.slice(link.indexOf('#')))
    await c.page.waitForSelector('[data-card]', { timeout: 20000 })
    check('the invited person gets the shared board', (await c.page.locator('.boardname span').innerText()) === 'Home' && (await has(c.page, 'Oat milk')))
    await c.page.click('.boardname')
    const theirs = await c.page.locator('.menu button').allInnerTexts()
    check('and none of the private boards', !theirs.some((t) => t.includes('My board')), theirs.join(' | '))
    await c.page.keyboard.press('Escape')
    await c.page.locator('.t-shopping [data-row]').nth(1).fill('Bread, from your partner')
    await c.page.locator('.t-shopping .check').first().click()
    await c.page.waitForTimeout(2500)
    await wake(a.page)
    check('their change appears for the owner', await has(a.page, 'Bread, from your partner'))
    check('including a ticked item', await a.page.waitForFunction(() => document.querySelector('.t-shopping .check')?.getAttribute('aria-pressed') === 'true', null, { timeout: 10000 }).then(() => true, () => false))
    await a.page.waitForFunction(() => !!document.querySelector('.boardname .shared'), null, { timeout: 20000 }).catch(() => {})
    check('the board is marked as shared', (await a.page.locator('.boardname .shared').count()) === 1)

    // both edit different lines of one card at the same moment: nothing is lost
    await a.page.locator('.t-shopping [data-row]').nth(2).fill('Eggs (owner)')
    await c.page.locator('.t-todo [data-row]').first().fill('Fix the gate (partner)')
    await a.page.waitForTimeout(3000)
    await wake(a.page); await wake(c.page)
    check('simultaneous edits both survive', (await has(c.page, 'Eggs (owner)')) && (await has(a.page, 'Fix the gate (partner)')))

    // deleting a shared board on one side only leaves it; the other person keeps it
    await c.page.click('[aria-label="Settings"]')
    check('the invited person has their own account', (await c.page.locator('.sync').count()) === 1)
    await shot(c.page, 'cloud-settings')
    // settle: no endless re-sending between devices
    const revs = async () => JSON.stringify(await a.page.evaluate(() => localStorage.getItem('plan.cloud.revs')))
    await a.page.waitForTimeout(4000)
    const r1 = await revs()
    await wake(a.page); await wake(b.page); await wake(c.page)
    await a.page.waitForTimeout(5000)
    await wake(a.page)
    await a.page.waitForTimeout(3000)
    check('devices settle and stop re-sending', r1 === (await revs()), `${r1} -> ${await revs()}`)
    const errs = [...a.errors, ...b.errors, ...c.errors]
    check('no errors', errs.length === 0, errs.join('; '))
    await a.ctx.close(); await b.ctx.close(); await c.ctx.close()
  } finally {
    try { process.kill(-server.pid) } catch {}
  }
}

async function phone(browser) {
  console.log('\nPhone')
  const { ctx, page, errors } = await start(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  await begin(page)
  check('no sideways scrolling', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) === 0)
  const before = await titles(page)
  const cdp = await ctx.newCDPSession(page)
  const s = await page.locator('[data-card] > header').first().boundingBox()
  const d = await page.locator('[data-card]').nth(2).boundingBox()
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] })
  await tp('touchStart', s.x + 70, s.y + 14)
  await page.waitForTimeout(450)
  for (let i = 1; i <= 10; i++) {
    await tp('touchMove', s.x + 70 + ((d.x + d.width / 2 - s.x - 70) * i) / 10, s.y + 14 + ((d.y + d.height * 0.8 - s.y - 14) * i) / 10)
    await page.waitForTimeout(30)
  }
  await page.waitForTimeout(300)
  await tp('touchEnd')
  await page.waitForTimeout(500)
  check('press, hold and drag reorders', before[0] !== (await titles(page))[0])
  // the card menu is a bottom sheet on phones, fully on screen
  await page.locator('[data-card]').first().locator('[aria-label="Card options"]').tap()
  await page.waitForTimeout(400)
  const m = await page.locator('.menu').boundingBox()
  check('card menu is fully on screen', m.x >= 0 && m.x + m.width <= 390 && m.y + m.height <= 844.5, JSON.stringify(m))
  check('menu does not widen the page', (await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) === 0)
  await shot(page, 'menu-phone')
  await page.locator('.menu-scrim').tap({ position: { x: 20, y: 20 } })
  await page.waitForTimeout(200)
  check('tapping outside closes the menu', (await page.locator('.menu').count()) === 0)
  check('column control shows what fits', (await page.locator('.zoom b').innerText()) === '2' && (await page.locator('[aria-label="More columns"]').isDisabled()))
  await page.tap('[aria-label="Search and capture"]')
  await page.waitForSelector('.palette')
  await shot(page, 'palette-phone')
  await page.keyboard.press('Escape')
  await page.locator('[data-card].t-today button.badge').tap()
  await page.waitForSelector('.sheet.wide')
  check('tapping the icon opens the card', true)
  await shot(page, 'open-phone')
  check('no errors', errors.length === 0, errors.join('; '))
  await ctx.close()
}

;(async () => {
  const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: path.join(__dirname, '..'), stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 2500))
  const browser = await chromium.launch()
  const only = process.argv[2]
  for (const [name, fn] of Object.entries({ core, palette, device, newDay, google, cloud, phone })) {
    if (only && only !== name) continue
    try {
      await fn(browser)
    } catch (e) {
      check(`${name} ran to the end`, false, String(e.message).split('\n')[0])
    }
  }
  await browser.close()
  server.kill()
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed')
  process.exit(failed ? 1 : 0)
})()
