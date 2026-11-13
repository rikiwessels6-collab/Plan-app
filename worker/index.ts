// Plan backend (Cloudflare Worker + D1). Serves the app and a small JSON API:
// passwordless accounts, per-board documents with optimistic concurrency, invites, and photo storage.
// The server never interprets a board: it stores what devices send and enforces who may read or write it.

interface Env {
  DB: D1Database
  ASSETS: Fetcher
}

const MAX_BODY = 1_500_000 // D1 rows are limited to 2 MB
const MAX_DOCS = 200
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const fail = (status: number, error: string, extra?: object) => json({ error, ...extra }, status)

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const random = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)))
const sha = async (s: string) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
// codes people type: no look-alike characters
const code = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('')
const ID = /^[A-Za-z0-9_-]{6,64}$/

async function who(req: Request, env: Env): Promise<string | null> {
  const m = /^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(req.headers.get('authorization') ?? '')
  if (!m) return null
  const row = await env.DB.prepare('SELECT user_id FROM keys WHERE hash = ?').bind(await sha(m[2])).first<{ user_id: string }>()
  return row && row.user_id === m[1] ? row.user_id : null
}
async function newKey(env: Env, user: string) {
  const key = random(32)
  await env.DB.prepare('INSERT INTO keys (hash, user_id, created) VALUES (?, ?, ?)').bind(await sha(key), user, Date.now()).run()
  return { userId: user, key }
}
const role = (env: Env, doc: string, user: string) =>
  env.DB.prepare('SELECT role FROM members WHERE doc_id = ? AND user_id = ?').bind(doc, user).first<{ role: string }>()
async function body(req: Request, max = MAX_BODY): Promise<any> {
  const text = await req.text()
  if (text.length > max) throw new Response(JSON.stringify({ error: 'too large' }), { status: 413 })
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new Response(JSON.stringify({ error: 'bad json' }), { status: 400 })
  }
}

async function api(req: Request, env: Env, path: string[]): Promise<Response> {
  const method = req.method
  const now = Date.now()
  if (path[0] === 'health') return json({ ok: true })

  // ----- accounts: no email or password; each device holds its own secret -----
  if (path[0] === 'account' && method === 'POST') {
    const user = random(12)
    const { name } = await body(req, 2000)
    await env.DB.prepare('INSERT INTO users (id, name, created) VALUES (?, ?, ?)').bind(user, String(name ?? '').slice(0, 60), now).run()
    return json(await newKey(env, user))
  }
  if (path[0] === 'link' && path[1] === 'redeem' && method === 'POST') {
    const { code: c } = await body(req, 2000)
    const row = await env.DB.prepare('DELETE FROM links WHERE code = ? AND expires > ? RETURNING user_id').bind(String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''), now).first<{ user_id: string }>()
    if (!row) return fail(404, 'That code is not valid any more. Make a new one on your other device.')
    return json(await newKey(env, row.user_id))
  }

  const user = await who(req, env)
  if (!user) return fail(401, 'Not signed in')

  if (path[0] === 'me') {
    if (method === 'PUT') {
      const { name } = await body(req, 2000)
      await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(String(name ?? '').slice(0, 60), user).run()
    }
    const me = await env.DB.prepare('SELECT id, name FROM users WHERE id = ?').bind(user).first()
    return json(me)
  }
  if (path[0] === 'link' && path[1] === 'code' && method === 'POST') {
    await env.DB.prepare('DELETE FROM links WHERE user_id = ? OR expires < ?').bind(user, now).run()
    const c = code(8)
    await env.DB.prepare('INSERT INTO links (code, user_id, expires) VALUES (?, ?, ?)').bind(c, user, now + 10 * 60 * 1000).run()
    return json({ code: c, expires: now + 10 * 60 * 1000 })
  }
  if (path[0] === 'signout' && method === 'POST') {
    const m = /\.([A-Za-z0-9_-]+)$/.exec(req.headers.get('authorization') ?? '')!
    await env.DB.prepare('DELETE FROM keys WHERE hash = ?').bind(await sha(m[1])).run()
    return json({ ok: true })
  }

  // ----- invites: a link lets someone join one board -----
  if (path[0] === 'join' && method === 'POST') {
    const { token } = await body(req, 2000)
    const inv = await env.DB.prepare('SELECT doc_id FROM invites WHERE token = ? AND expires > ?').bind(String(token ?? ''), now).first<{ doc_id: string }>()
    if (!inv) return fail(404, 'That invitation has expired. Ask for a new link.')
    await env.DB.prepare('INSERT OR IGNORE INTO members (doc_id, user_id, role, joined) VALUES (?, ?, ?, ?)').bind(inv.doc_id, user, 'editor', now).run()
    return json({ id: inv.doc_id })
  }

  // ----- documents -----
  if (path[0] !== 'docs') return fail(404, 'Not found')
  if (path.length === 1 && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT d.id, d.rev, m.role, (SELECT COUNT(*) FROM members x WHERE x.doc_id = d.id) AS people
       FROM members m JOIN docs d ON d.id = m.doc_id WHERE m.user_id = ?`,
    ).bind(user).all()
    return json({ docs: results })
  }
  const id = path[1]
  if (!id || !ID.test(id)) return fail(400, 'Bad id')
  const mine = await role(env, id, user)

  if (path.length === 2 && method === 'PUT') {
    const { body: text, baseRev } = await body(req)
    if (typeof text !== 'string') return fail(400, 'Missing body')
    const cur = await env.DB.prepare('SELECT rev FROM docs WHERE id = ?').bind(id).first<{ rev: number }>()
    if (!cur) {
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE user_id = ?').bind(user).first<{ n: number }>()
      if ((n?.n ?? 0) >= MAX_DOCS) return fail(403, 'Too many boards')
      // INSERT OR IGNORE: if two devices create it at once, the loser falls through to the conflict below
      const made = await env.DB.prepare('INSERT OR IGNORE INTO docs (id, body, rev, updated) VALUES (?, ?, 1, ?)').bind(id, text, now).run()
      if (made.meta.changes) {
        await env.DB.prepare('INSERT INTO members (doc_id, user_id, role, joined) VALUES (?, ?, ?, ?)').bind(id, user, 'owner', now).run()
        return json({ rev: 1 })
      }
    } else if (!mine) return fail(403, 'Not a member of this board')
    if (!(await role(env, id, user))) return fail(403, 'Not a member of this board')
    // write only if nobody else wrote since this device last read it
    const done = await env.DB.prepare('UPDATE docs SET body = ?, rev = rev + 1, updated = ? WHERE id = ? AND rev = ?').bind(text, now, id, Number(baseRev) || 0).run()
    if (done.meta.changes) return json({ rev: (Number(baseRev) || 0) + 1 })
    const latest = await env.DB.prepare('SELECT body, rev FROM docs WHERE id = ?').bind(id).first()
    return fail(409, 'Changed elsewhere', latest ?? {})
  }

  if (!mine) return fail(404, 'Not found')

  if (path.length === 2 && method === 'GET') return json(await env.DB.prepare('SELECT body, rev FROM docs WHERE id = ?').bind(id).first())
  if (path.length === 2 && method === 'DELETE') {
    // leaving a board; when the last person leaves, the board and its photos are removed
    await env.DB.prepare('DELETE FROM members WHERE doc_id = ? AND user_id = ?').bind(id, user).run()
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM members WHERE doc_id = ?').bind(id).first<{ n: number }>()
    if (!left?.n)
      await env.DB.batch([
        env.DB.prepare('DELETE FROM docs WHERE id = ?').bind(id),
        env.DB.prepare('DELETE FROM blobs WHERE doc_id = ?').bind(id),
        env.DB.prepare('DELETE FROM invites WHERE doc_id = ?').bind(id),
      ])
    return json({ ok: true })
  }
  if (path[2] === 'members' && method === 'GET') {
    const { results } = await env.DB.prepare('SELECT u.id, u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.doc_id = ? ORDER BY m.joined').bind(id).all()
    return json({ members: results, me: user })
  }
  if (path[2] === 'invite' && method === 'POST') {
    const token = random(18)
    await env.DB.prepare('INSERT INTO invites (token, doc_id, created_by, expires) VALUES (?, ?, ?, ?)').bind(token, id, user, now + 7 * 24 * 60 * 60 * 1000).run()
    return json({ token })
  }
  if (path[2] === 'blobs') {
    if (path.length === 3 && method === 'GET') {
      const { results } = await env.DB.prepare('SELECT hash FROM blobs WHERE doc_id = ?').bind(id).all<{ hash: string }>()
      return json({ hashes: results.map((r) => r.hash) })
    }
    const hash = path[3]
    if (!hash || !ID.test(hash)) return fail(400, 'Bad id')
    if (method === 'PUT') {
      const data = await req.text()
      if (data.length > MAX_BODY) return fail(413, 'Photo too large')
      if ((await sha(data)) !== hash) return fail(400, 'Hash does not match')
      await env.DB.prepare('INSERT OR IGNORE INTO blobs (doc_id, hash, data) VALUES (?, ?, ?)').bind(id, hash, data).run()
      return json({ ok: true })
    }
    if (method === 'GET') {
      const row = await env.DB.prepare('SELECT data FROM blobs WHERE doc_id = ? AND hash = ?').bind(id, hash).first<{ data: string }>()
      return row ? new Response(row.data, { headers: { 'content-type': 'text/plain', 'cache-control': 'private, max-age=31536000, immutable' } }) : fail(404, 'Not found')
    }
  }
  return fail(404, 'Not found')
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req)
    try {
      return await api(req, env, url.pathname.slice(5).split('/').filter(Boolean))
    } catch (e) {
      if (e instanceof Response) return e
      console.error(e)
      return fail(500, 'Something went wrong on the server')
    }
  },
}
