import type { CardType, Section } from './types'

const list = (key = 'items', label?: string, rows = 3, placeholder?: string): Section => ({
  kind: 'checklist', key, label, rows, placeholder,
})
const text = (key = 'text', label?: string, placeholder = 'Write here…'): Section => ({
  kind: 'text', key, label, placeholder,
})
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export const GROUPS = ['Daily', 'Time', 'Photos and links', 'Lists', 'People', 'Projects', 'Thinking', 'Money', 'Google']

export const CATALOG: CardType[] = [
  // Daily
  { id: 'today', name: 'Today', group: 'Daily', icon: 'Sun', sections: [
    { kind: 'agenda', key: 'cal', days: 1, quiet: true },
    list('top', 'Top three', 3), list('rest', 'Everything else', 4)] },
  { id: 'day', name: 'Day plan', group: 'Daily', icon: 'Clock', sections: [
    { kind: 'agenda', key: 'cal', days: 1, quiet: true },
    list('am', 'Morning', 3), list('pm', 'Afternoon', 3), list('eve', 'Evening', 2)] },
  { id: 'todo', name: 'To-do', group: 'Daily', icon: 'CircleCheck', sections: [list('items', undefined, 5)] },
  { id: 'next', name: 'Next up', group: 'Daily', icon: 'ArrowRight', sections: [list('items', undefined, 4)] },
  { id: 'note', name: 'Note', group: 'Daily', icon: 'FileText', sections: [text()] },
  { id: 'sticky', name: 'Sticky', group: 'Daily', icon: 'StickyNote', sections: [
    { kind: 'text', key: 'text', placeholder: 'A thought…', look: 'sticky' }, { kind: 'swatch', key: 'color' }] },
  { id: 'inbox', name: 'Brain dump', group: 'Daily', icon: 'Zap', sections: [list('items', undefined, 4, 'Get it out of your head')] },
  { id: 'reminders', name: 'Reminders', group: 'Daily', icon: 'BellRing', sections: [{ kind: 'dates', key: 'dates' }] },
  { id: 'upcoming', name: 'Upcoming', group: 'Daily', icon: 'CalendarCheck', sections: [{ kind: 'upcoming', key: 'up' }] },
  { id: 'timer', name: 'Focus timer', group: 'Daily', icon: 'Hourglass', sections: [{ kind: 'timer', key: 'timer' }] },
  { id: 'weather', name: 'Weather', group: 'Daily', icon: 'CloudSun', sections: [{ kind: 'weather', key: 'wx' }] },

  // Time
  { id: 'week', name: 'Week', group: 'Time', icon: 'CalendarRange', sections: [{ kind: 'slots', key: 'days', labels: WEEK }, text('notes', 'Notes', '')] },
  { id: 'month', name: 'Month', group: 'Time', icon: 'CalendarDays', sections: [{ kind: 'month', key: 'month' }] },
  { id: 'habit', name: 'Habit', group: 'Time', icon: 'Repeat', sections: [{ kind: 'habit', key: 'habit' }] },
  { id: 'countdown', name: 'Countdown', group: 'Time', icon: 'Timer', sections: [{ kind: 'countdown', key: 'cd' }] },
  { id: 'dates', name: 'Birthdays', group: 'Time', icon: 'Cake', sections: [{ kind: 'dates', key: 'dates', yearly: true }] },
  { id: 'event', name: 'Event', group: 'Time', icon: 'PartyPopper', sections: [
    { kind: 'fields', key: 'f', fields: ['When', 'Where', 'Who'] }, list('prep', 'To prepare', 3)] },
  { id: 'review', name: 'Weekly review', group: 'Time', icon: 'Star', sections: [
    text('good', 'What went well', ''), text('hard', 'What was hard', ''), text('next', 'Change for next week', '')] },
  { id: 'someday', name: 'Someday', group: 'Time', icon: 'Cloud', sections: [list('items', undefined, 4)] },
  { id: 'timeline', name: 'Timeline', group: 'Time', icon: 'Milestone', sections: [{ kind: 'dates', key: 'dates' }] },

  // Photos and links
  { id: 'photo', name: 'Photo', group: 'Photos and links', icon: 'Image', bare: true, sections: [{ kind: 'photo', key: 'photo' }] },
  { id: 'grid', name: 'Photo grid', group: 'Photos and links', icon: 'Images', sections: [{ kind: 'photos', key: 'photos' }] },
  { id: 'mood', name: 'Mood', group: 'Photos and links', icon: 'FaceSlightlySmiling', sections: [{ kind: 'mood', key: 'mood' }] },
  { id: 'place', name: 'Place', group: 'Photos and links', icon: 'MapPin', sections: [
    { kind: 'photo', key: 'photo' }, { kind: 'place', key: 'pin' }, { kind: 'fields', key: 'f', fields: ['Address', 'Why go'] }, { kind: 'link', key: 'link' }] },
  { id: 'link', name: 'Link', group: 'Photos and links', icon: 'Link', sections: [{ kind: 'link', key: 'link' }, text('notes', undefined, 'Why it matters')] },

  // Lists
  { id: 'shopping', name: 'Shopping', group: 'Lists', icon: 'ShoppingCart', sections: [list('items', undefined, 5)] },
  { id: 'meals', name: 'Meals', group: 'Lists', icon: 'Utensils', sections: [{ kind: 'slots', key: 'days', labels: WEEK }, text('notes', 'Notes', '')] },
  { id: 'recipe', name: 'Recipe', group: 'Lists', icon: 'ChefHat', sections: [
    { kind: 'photo', key: 'photo' }, list('ing', 'Ingredients', 4), text('method', 'Method', '')] },
  { id: 'packing', name: 'Packing', group: 'Lists', icon: 'Luggage', sections: [list('items', undefined, 6)] },
  { id: 'gifts', name: 'Gift ideas', group: 'Lists', icon: 'Gift', sections: [{ kind: 'amounts', key: 'rows' }] },
  { id: 'wishlist', name: 'Wishlist', group: 'Lists', icon: 'Heart', sections: [{ kind: 'amounts', key: 'rows' }] },
  { id: 'media', name: 'Read and watch', group: 'Lists', icon: 'BookOpen', sections: [list('read', 'Read', 3), list('watch', 'Watch', 3)] },

  // People
  { id: 'contacts', name: 'Contacts', group: 'People', icon: 'Contact', sections: [{ kind: 'people', key: 'people' }] },
  { id: 'person', name: 'Person', group: 'People', icon: 'CircleUser', sections: [
    { kind: 'fields', key: 'f', fields: ['Phone', 'Email', 'Birthday'] }, text('notes', 'Notes', '')] },
  { id: 'call', name: 'Call', group: 'People', icon: 'Phone', sections: [
    { kind: 'fields', key: 'f', fields: ['With', 'When'] }, list('ask', 'To discuss', 3), text('notes', 'Notes', '')] },
  { id: 'waiting', name: 'Waiting on', group: 'People', icon: 'UserRoundCheck', sections: [list('items', undefined, 4, 'Who owes you what')] },
  { id: 'meeting', name: 'Meeting', group: 'People', icon: 'Users', sections: [
    { kind: 'fields', key: 'f', fields: ['When', 'With'] }, list('agenda', 'Agenda', 3), list('actions', 'Actions', 3)] },
  { id: 'client', name: 'Client', group: 'People', icon: 'Briefcase', sections: [
    { kind: 'fields', key: 'f', fields: ['Contact', 'Email', 'Rate'] }, list('open', 'Open work', 3), text('notes', 'Notes', '')] },
  { id: 'standup', name: 'Check-in', group: 'People', icon: 'MessageCircle', sections: [
    list('did', 'Done', 2), list('doing', 'Doing', 2), list('stuck', 'Stuck on', 2)] },

  // Projects
  { id: 'project', name: 'Project', group: 'Projects', icon: 'Folder', sections: [
    text('outcome', 'Outcome', 'What does done look like?'), list('steps', 'Next steps', 4)] },
  { id: 'goal', name: 'Goal', group: 'Projects', icon: 'Target', sections: [
    { kind: 'number', key: 'n' }, text('why', 'Why it matters', ''), list('miles', 'Milestones', 3)] },
  { id: 'vision', name: 'Vision', group: 'Projects', icon: 'Mountain', sections: [
    { kind: 'photo', key: 'photo' }, { kind: 'text', key: 'text', placeholder: 'Where is this heading?', look: 'big' }] },
  { id: 'roadmap', name: 'Now, next, later', group: 'Projects', icon: 'Map', sections: [
    list('now', 'Now', 2), list('next', 'Next', 2), list('later', 'Later', 2)] },
  { id: 'kanban', name: 'To do, doing, done', group: 'Projects', icon: 'Columns3', sections: [
    list('todo', 'To do', 3), list('doing', 'Doing', 2), list('done', 'Done', 2)] },
  { id: 'trip', name: 'Trip', group: 'Projects', icon: 'Plane', sections: [
    { kind: 'photo', key: 'photo' }, { kind: 'fields', key: 'f', fields: ['Dates', 'Stay', 'Transport'] },
    list('book', 'To book', 3), list('see', 'To see', 3)] },
  { id: 'brief', name: 'Brief', group: 'Projects', icon: 'FileCheck', sections: [
    text('goal', 'Goal', ''), text('audience', 'For whom', ''), list('deliver', 'Deliverables', 3)] },
  { id: 'process', name: 'How we do it', group: 'Projects', icon: 'ListChecks', sections: [list('steps', undefined, 5, 'Step')] },
  { id: 'content', name: 'Content plan', group: 'Projects', icon: 'Megaphone', sections: [{ kind: 'slots', key: 'days', labels: WEEK }, list('ideas', 'Ideas', 3)] },
  { id: 'blocker', name: 'Blocker', group: 'Projects', icon: 'OctagonExclamationPoint', sections: [
    text('what', 'What is stuck', ''), list('unblock', 'To unblock', 3)] },

  // Thinking
  { id: 'obstacles', name: 'Obstacles', group: 'Thinking', icon: 'TriangleExclamationPoint', sections: [
    list('ob', 'In the way', 3), list('fix', 'Ways around', 3)] },
  { id: 'priorities', name: 'Priorities', group: 'Thinking', icon: 'LayoutGrid', sections: [
    list('a', 'Urgent and important', 2), list('b', 'Important, not urgent', 2),
    list('c', 'Urgent, not important', 2), list('d', 'Neither', 2)] },
  { id: 'decision', name: 'Decision', group: 'Thinking', icon: 'Scale', sections: [
    text('q', 'The question', ''), list('pro', 'For', 3), list('con', 'Against', 3), text('call', 'Decided', '')] },
  { id: 'journal', name: 'Journal', group: 'Thinking', icon: 'Notebook', sections: [
    list('good', 'Three good things', 3), text('learned', 'What I learned', '')] },
  { id: 'ideas', name: 'Ideas', group: 'Thinking', icon: 'Lightbulb', sections: [list('items', undefined, 4)] },
  { id: 'score', name: 'Score', group: 'Thinking', icon: 'ChartNoAxesColumn', sections: [{ kind: 'rating', key: 'r' }] },

  // Money
  { id: 'money', name: 'Spending', group: 'Money', icon: 'Wallet', sections: [{ kind: 'amounts', key: 'rows' }] },
  { id: 'budget', name: 'Budget', group: 'Money', icon: 'PiggyBank', sections: [{ kind: 'amounts', key: 'rows', budget: true }] },
  { id: 'number', name: 'Number', group: 'Money', icon: 'Gauge', sections: [{ kind: 'number', key: 'n' }] },

  // Google
  { id: 'gmail', name: 'Gmail inbox', group: 'Google', icon: 'Mail', sections: [{ kind: 'gmail', key: 'g' }] },
  { id: 'agenda', name: 'Calendar', group: 'Google', icon: 'CalendarClock', sections: [{ kind: 'agenda', key: 'cal', days: 7 }] },
]

export const typeOf = (id: string): CardType => CATALOG.find((t) => t.id === id) ?? CATALOG[2]
