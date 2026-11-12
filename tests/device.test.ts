import { describe, expect, it } from 'vitest'
import { cardText, ics, mapsUrl, parseVcards } from '../src/device'

describe('calendar files', () => {
  it('writes an all-day event that ends the next day', () => {
    const out = ics([{ title: 'Mum, Dad; 40 years', date: '2026-12-31' }], new Date('2026-11-12T10:00:00Z'))
    expect(out).toContain('DTSTART;VALUE=DATE:20261231')
    expect(out).toContain('DTEND;VALUE=DATE:20270101')
    expect(out).toContain(String.raw`SUMMARY:Mum\, Dad\; 40 years`)
    expect(out).toContain('DTSTAMP:20261112T100000Z')
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
})

describe('contact cards', () => {
  it('reads names, phones and emails, including folded lines and grouped fields', () => {
    const got = parseVcards(
      'BEGIN:VCARD\nVERSION:3.0\nN:Lee;Sam;;;\nFN:Sam\n  Lee\nTEL;type=CELL:+44 7700 900123\nEMAIL;type=INTERNET:sam@example.com\nEND:VCARD\n' +
        'BEGIN:VCARD\nN:Okafor;Ada\nitem1.TEL:020 7946 0000\nEND:VCARD\nBEGIN:VCARD\nORG:Acme\\, Ltd;\nEND:VCARD\n',
    )
    expect(got).toEqual([
      { name: 'Sam Lee', note: '+44 7700 900123 · sam@example.com' },
      { name: 'Ada Okafor', note: '020 7946 0000' },
      { name: 'Acme, Ltd', note: '' },
    ])
  })
  it('ignores text that is not a contact card', () => {
    expect(parseVcards('hello')).toEqual([])
  })
})

describe('sharing', () => {
  it('turns a card into readable text', () => {
    const text = cardText({
      id: '1', boardId: 'b', type: 'today', title: 'Today',
      data: { _day: '2026-11-12', top: [{ text: 'Dentist', done: true }, { text: 'Call Mum', done: false }, { text: '', done: false }] },
    })
    expect(text).toBe('Today\n\nTOP THREE\n☑ Dentist\n☐ Call Mum')
  })
  it('includes budgets and totals', () => {
    const text = cardText({ id: '1', boardId: 'b', type: 'budget', title: 'Budget', data: { rows: { budget: 100, rows: [{ label: 'Rent', amount: 60 }, { label: 'Food', amount: 25 }] } } })
    expect(text).toBe('Budget\n\nRent: 60\nFood: 25\nTotal: 85\nBudget: 100')
  })
  it('links a pinned place', () => {
    expect(mapsUrl(51.5, -0.12, 'Café Luna')).toBe('https://maps.apple.com/?ll=51.5,-0.12&q=Caf%C3%A9%20Luna')
  })
})
