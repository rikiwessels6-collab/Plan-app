export type Section =
  | { kind: 'checklist'; key: string; label?: string; rows?: number; placeholder?: string }
  | { kind: 'text'; key: string; label?: string; placeholder?: string; look?: 'sticky' | 'big' }
  | { kind: 'photo'; key: string }
  | { kind: 'photos'; key: string }
  | { kind: 'habit'; key: string }
  | { kind: 'amounts'; key: string; label?: string; budget?: boolean }
  | { kind: 'fields'; key: string; fields: string[] }
  | { kind: 'dates'; key: string }
  | { kind: 'countdown'; key: string }
  | { kind: 'link'; key: string }
  | { kind: 'number'; key: string }
  | { kind: 'slots'; key: string; labels: string[] }
  | { kind: 'month'; key: string }
  | { kind: 'people'; key: string }
  | { kind: 'rating'; key: string }
  | { kind: 'mood'; key: string }
  | { kind: 'gmail'; key: string }
  | { kind: 'agenda'; key: string; days: number; label?: string; quiet?: boolean }
  | { kind: 'swatch'; key: string }
  | { kind: 'place'; key: string }
  | { kind: 'weather'; key: string }
  | { kind: 'timer'; key: string }
  | { kind: 'upcoming'; key: string }

export interface CardType {
  id: string
  name: string
  group: string
  icon: string
  bare?: boolean // photo-style card without header chrome
  sections: Section[]
}

export interface Card {
  id: string
  boardId: string
  type: string
  title: string
  spaceId?: string
  data: Record<string, any>
  /** last-changed time (ms); lets two devices merge their boards card by card */
  u?: number
}

export interface Space {
  id: string
  name: string
  color: string
}

export interface Board {
  id: string
  name: string
}

export interface State {
  boards: Board[]
  boardId: string
  spaces: Space[]
  cards: Card[]
  cols: number
  /** when each deleted card was deleted, so a sync does not bring it back */
  deleted?: Record<string, number>
  updatedAt?: number
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export const SPACE_COLORS = ['#5b8c5a', '#c8763a', '#4a7fa7', '#8a5a9c', '#c9a227', '#b8505a', '#3f8f8a']
