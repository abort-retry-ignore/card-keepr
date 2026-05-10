import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import zlib from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import express from 'express'
import pg from 'pg'

const { Pool } = pg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distDir = path.resolve(__dirname, '../dist')
const port = Number(process.env.PORT || 3006)
const sessionMaxAgeDays = Math.max(1, Number(process.env.SESSION_MAX_AGE_DAYS || 3650))
const sessionMaxAgeMs = sessionMaxAgeDays * 24 * 60 * 60 * 1000
const MIN_PASSWORD_LENGTH = 10
const configuredAdminUsername = String(process.env.APP_LOGIN_USERNAME || '').toLowerCase().trim()

const requiredEnv = ['DATABASE_URL', 'SESSION_SECRET']
for (const name of requiredEnv) {
  if (!process.env[name]) {
    console.error(`Missing required environment variable: ${name}`)
    process.exit(1)
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
})

const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '80mb' }))

// --- Password hashing ---

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password.toLowerCase(), salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  const attempt = crypto.scryptSync(password.toLowerCase(), salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(attempt, 'hex'))
}

function isAdminUsername(username) {
  return username === (configuredAdminUsername || 'admin')
}

function timestampForFile() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function getDatabaseConfig() {
  const url = new URL(process.env.DATABASE_URL)

  return {
    host: url.hostname,
    port: url.port || '5432',
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, ''))
  }
}

function spawnPostgresCommand(command, extraArgs = []) {
  const database = getDatabaseConfig()

  return spawn(command, [
    '-h', database.host,
    '-p', database.port,
    '-U', database.user,
    '-d', database.database,
    ...extraArgs
  ], {
    env: {
      ...process.env,
      PGPASSWORD: database.password
    }
  })
}

function waitForProcess(child) {
  return new Promise((resolve, reject) => {
    let stderr = ''

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve(stderr)
        return
      }

      reject(new Error(stderr.trim() || `${child.spawnfile} exited with code ${code}`))
    })
  })
}

// --- Cookie auth ---

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf('=')
        if (index === -1) return [part, '']
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
      })
  )
}

function sessionSignature(username) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(username).digest('base64url')
}

function buildSessionCookie(username) {
  return `${username}.${sessionSignature(username)}`
}

function getSessionUser(request) {
  const cookies = parseCookies(request.headers.cookie)
  const value = cookies.card_keepr_session
  if (!value) return null

  const index = value.lastIndexOf('.')
  if (index === -1) return null

  const username = value.slice(0, index)
  const signature = value.slice(index + 1)

  if (!username || signature !== sessionSignature(username)) return null
  return username
}

function shouldUseSecureCookies(request) {
  if (process.env.COOKIE_SECURE === 'true') return true
  const forwardedProto = request.headers['x-forwarded-proto']
  return request.secure || forwardedProto === 'https'
}

function setSessionCookie(request, response, username) {
  const secure = shouldUseSecureCookies(request)
  response.cookie('card_keepr_session', buildSessionCookie(username), {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: sessionMaxAgeMs,
    expires: new Date(Date.now() + sessionMaxAgeMs),
    path: '/'
  })
}

function clearSessionCookie(request, response) {
  response.cookie('card_keepr_session', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request),
    expires: new Date(0),
    path: '/'
  })
}

async function requireAuth(request, response, next) {
  const username = getSessionUser(request)
  if (!username) {
    response.status(401).json({ error: 'Authentication required' })
    return
  }

  const result = await pool.query('SELECT id, username FROM users WHERE username = $1', [username])
  if (!result.rowCount) {
    clearSessionCookie(request, response)
    response.status(401).json({ error: 'Authentication required' })
    return
  }

  request.user = result.rows[0].username
  request.userId = result.rows[0].id
  request.isAdmin = isAdminUsername(result.rows[0].username)
  next()
}

function requireAdmin(request, response, next) {
  if (!request.isAdmin) {
    response.status(403).json({ error: 'Admin access required' })
    return
  }

  next()
}

// --- Card helpers ---

function normalizeCard(payload = {}) {
  const toString = value => (typeof value === 'string' ? value.trim() : '')
  const tags = Array.isArray(payload.tags)
    ? payload.tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 12)
    : []

  return {
    title: toString(payload.title),
    issuer: toString(payload.issuer),
    category: toString(payload.category) || 'Other',
    cardholder_name: toString(payload.cardholderName),
    identifier: toString(payload.identifier),
    barcode_value: toString(payload.barcodeValue),
    barcode_format: toString(payload.barcodeFormat) || 'CODE128',
    qr_value: toString(payload.qrValue),
    notes: toString(payload.notes),
    tags,
    color: toString(payload.color) || '#7c3aed',
    favorite: Boolean(payload.favorite),
    front_image_data_url: toString(payload.frontImageDataUrl),
    back_image_data_url: toString(payload.backImageDataUrl),
    expiry_date: toString(payload.expiryDate),
    security_code: toString(payload.securityCode)
  }
}

function mapCard(row) {
  return {
    id: row.id,
    title: row.title,
    issuer: row.issuer,
    category: row.category,
    cardholderName: row.cardholder_name,
    identifier: row.identifier,
    barcodeValue: row.barcode_value,
    barcodeFormat: row.barcode_format,
    qrValue: row.qr_value,
    notes: row.notes,
    tags: row.tags || [],
    color: row.color,
    favorite: row.favorite,
    useCount: row.use_count || 0,
    frontImageDataUrl: row.front_image_data_url,
    backImageDataUrl: row.back_image_data_url,
    expiryDate: row.expiry_date,
    securityCode: row.security_code,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

async function insertCardForUser(userId, card) {
  const result = await pool.query(
    `
      INSERT INTO cards (
        user_id, title, issuer, category, cardholder_name, identifier, barcode_value,
        barcode_format, qr_value, notes, tags, color, favorite,
        front_image_data_url, back_image_data_url, expiry_date, security_code
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17
      )
      RETURNING *
    `,
    [
      userId,
      card.title,
      card.issuer,
      card.category,
      card.cardholder_name,
      card.identifier,
      card.barcode_value,
      card.barcode_format,
      card.qr_value,
      card.notes,
      card.tags,
      card.color,
      card.favorite,
      card.front_image_data_url,
      card.back_image_data_url,
      card.expiry_date,
      card.security_code
    ]
  )

  return mapCard(result.rows[0])
}

// --- Schema ---

async function ensureSchema() {
  // Users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // Cards table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      issuer TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Other',
      cardholder_name TEXT NOT NULL DEFAULT '',
      identifier TEXT NOT NULL DEFAULT '',
      barcode_value TEXT NOT NULL DEFAULT '',
      barcode_format TEXT NOT NULL DEFAULT 'CODE128',
      qr_value TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      color TEXT NOT NULL DEFAULT '#7c3aed',
      favorite BOOLEAN NOT NULL DEFAULT FALSE,
      use_count INTEGER NOT NULL DEFAULT 0,
      front_image_data_url TEXT NOT NULL DEFAULT '',
      back_image_data_url TEXT NOT NULL DEFAULT '',
      expiry_date TEXT NOT NULL DEFAULT '',
      security_code TEXT NOT NULL DEFAULT '',
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  // Migration columns for older installs
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS use_count INTEGER NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE`)
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS expiry_date TEXT NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE cards ADD COLUMN IF NOT EXISTS security_code TEXT NOT NULL DEFAULT ''`)

  // Seed admin user from env if provided and not yet in DB
  const adminUsername = (process.env.APP_LOGIN_USERNAME || '').toLowerCase().trim()
  const adminPassword = process.env.APP_LOGIN_PASSWORD || ''

  if (adminUsername && adminPassword) {
    const existingAdmin = await pool.query('SELECT id FROM users WHERE username = $1', [adminUsername])

    if (!existingAdmin.rowCount && adminPassword.length >= MIN_PASSWORD_LENGTH) {
      await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
        [adminUsername, hashPassword(adminPassword)]
      )
      console.log(`Seeded admin user: ${adminUsername}`)
    } else if (!existingAdmin.rowCount) {
      // Seed even with short password for backward compat with existing .env
      await pool.query(
        'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
        [adminUsername, hashPassword(adminPassword)]
      )
      console.log(`Seeded admin user: ${adminUsername} (password shorter than ${MIN_PASSWORD_LENGTH} chars — consider changing it)`)
    }

    // Migrate orphan cards (no user_id) to admin user
    const adminRow = await pool.query('SELECT id FROM users WHERE username = $1', [adminUsername])
    if (adminRow.rowCount) {
      const adminId = adminRow.rows[0].id
      const migrated = await pool.query('UPDATE cards SET user_id = $1 WHERE user_id IS NULL', [adminId])
      if (migrated.rowCount) {
        console.log(`Migrated ${migrated.rowCount} existing card(s) to user: ${adminUsername}`)
      }
    }
  } else {
    // No admin env vars — still migrate orphan cards to the first user if one exists
    const firstUser = await pool.query('SELECT id, username FROM users ORDER BY id LIMIT 1')
    if (firstUser.rowCount) {
      const migrated = await pool.query('UPDATE cards SET user_id = $1 WHERE user_id IS NULL', [firstUser.rows[0].id])
      if (migrated.rowCount) {
        console.log(`Migrated ${migrated.rowCount} orphan card(s) to user: ${firstUser.rows[0].username}`)
      }
    }
  }
}

// --- Routes ---

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.get('/api/session', async (request, response) => {
  const username = getSessionUser(request)
  response.setHeader('Cache-Control', 'no-store')
  if (!username) {
    response.json({ authenticated: false, username: null, isAdmin: false })
    return
  }
  const result = await pool.query('SELECT id, username FROM users WHERE username = $1', [username])
  if (!result.rowCount) {
    clearSessionCookie(request, response)
    response.json({ authenticated: false, username: null, isAdmin: false })
    return
  }
  response.json({ authenticated: true, username, isAdmin: isAdminUsername(result.rows[0].username) })
})

app.post('/api/register', async (request, response) => {
  const username = String(request.body?.username || '').toLowerCase().trim()
  const password = String(request.body?.password || '')

  if (!username || username.length < 2) {
    response.status(400).json({ error: 'Username must be at least 2 characters.' })
    return
  }

  if (!/^[a-z0-9._-]+$/.test(username)) {
    response.status(400).json({ error: 'Username can only contain letters, numbers, dots, hyphens, and underscores.' })
    return
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    response.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` })
    return
  }

  const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username])
  if (existing.rowCount) {
    response.status(409).json({ error: 'Username already taken.' })
    return
  }

  await pool.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
    [username, hashPassword(password)]
  )

  setSessionCookie(request, response, username)
  response.status(201).json({ ok: true, username, isAdmin: isAdminUsername(username) })
})

app.post('/api/change-password', requireAuth, async (request, response) => {
  const currentPassword = String(request.body?.currentPassword || '')
  const newPassword = String(request.body?.newPassword || '')

  if (!currentPassword) {
    response.status(400).json({ error: 'Current password is required.' })
    return
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    response.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters.` })
    return
  }

  const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [request.userId])
  if (!result.rowCount) {
    response.status(401).json({ error: 'Authentication required' })
    return
  }

  if (!verifyPassword(currentPassword, result.rows[0].password_hash)) {
    response.status(403).json({ error: 'Current password is incorrect.' })
    return
  }

  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(newPassword), request.userId])
  response.json({ ok: true })
})

app.post('/api/login', async (request, response) => {
  const username = String(request.body?.username || '').toLowerCase().trim()
  const password = String(request.body?.password || '')

  if (!username || !password) {
    response.status(401).json({ error: 'Invalid credentials' })
    return
  }

  const result = await pool.query('SELECT username, password_hash FROM users WHERE username = $1', [username])
  if (!result.rowCount) {
    response.status(401).json({ error: 'Invalid credentials' })
    return
  }

  const user = result.rows[0]
  if (!verifyPassword(password, user.password_hash)) {
    response.status(401).json({ error: 'Invalid credentials' })
    return
  }

  setSessionCookie(request, response, user.username)
  response.json({ ok: true, username: user.username, isAdmin: isAdminUsername(user.username) })
})

app.post('/api/logout', (request, response) => {
  clearSessionCookie(request, response)
  response.json({ ok: true })
})

// --- Card CRUD (scoped to user) ---

app.get('/api/cards', requireAuth, async (request, response) => {
  const result = await pool.query(
    'SELECT * FROM cards WHERE user_id = $1 ORDER BY use_count DESC, favorite DESC, last_used_at DESC NULLS LAST, updated_at DESC, id DESC',
    [request.userId]
  )
  response.json({ cards: result.rows.map(mapCard) })
})

app.post('/api/cards', requireAuth, async (request, response) => {
  const card = normalizeCard(request.body)
  if (!card.title) {
    response.status(400).json({ error: 'Title is required' })
    return
  }

  const insertedCard = await insertCardForUser(request.userId, card)
  response.status(201).json({ card: insertedCard })
})

app.get('/api/cards/export', requireAuth, async (request, response) => {
  const result = await pool.query(
    'SELECT * FROM cards WHERE user_id = $1 ORDER BY use_count DESC, favorite DESC, last_used_at DESC NULLS LAST, updated_at DESC, id DESC',
    [request.userId]
  )

  const exportPayload = {
    format: 'card-keepr-user-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    username: request.user,
    cards: result.rows.map(mapCard)
  }

  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Disposition', `attachment; filename="card-keepr-${request.user}-${timestampForFile()}.json"`)
  response.send(JSON.stringify(exportPayload, null, 2))
})

app.post('/api/cards/import', requireAuth, async (request, response) => {
  const payload = request.body || {}
  const items = Array.isArray(payload.cards) ? payload.cards : null

  if (payload.format !== 'card-keepr-user-export' || payload.version !== 1 || !items) {
    response.status(400).json({ error: 'Invalid Card Keepr export file.' })
    return
  }

  let imported = 0
  let failed = 0

  for (const item of items) {
    try {
      const card = normalizeCard(item)
      if (!card.title) {
        failed += 1
        continue
      }

      await insertCardForUser(request.userId, card)
      imported += 1
    } catch {
      failed += 1
    }
  }

  response.json({ ok: true, imported, failed })
})

app.put('/api/cards/:id', requireAuth, async (request, response) => {
  const card = normalizeCard(request.body)
  if (!card.title) {
    response.status(400).json({ error: 'Title is required' })
    return
  }

  const result = await pool.query(
    `
      UPDATE cards
      SET
        title = $3,
        issuer = $4,
        category = $5,
        cardholder_name = $6,
        identifier = $7,
        barcode_value = $8,
        barcode_format = $9,
        qr_value = $10,
        notes = $11,
        tags = $12,
        color = $13,
        favorite = $14,
        front_image_data_url = $15,
        back_image_data_url = $16,
        expiry_date = $17,
        security_code = $18,
        updated_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
    [
      Number(request.params.id),
      request.userId,
      card.title,
      card.issuer,
      card.category,
      card.cardholder_name,
      card.identifier,
      card.barcode_value,
      card.barcode_format,
      card.qr_value,
      card.notes,
      card.tags,
      card.color,
      card.favorite,
      card.front_image_data_url,
      card.back_image_data_url,
      card.expiry_date,
      card.security_code
    ]
  )

  if (!result.rowCount) {
    response.status(404).json({ error: 'Card not found' })
    return
  }

  response.json({ card: mapCard(result.rows[0]) })
})

app.delete('/api/cards/:id', requireAuth, async (request, response) => {
  const result = await pool.query('DELETE FROM cards WHERE id = $1 AND user_id = $2 RETURNING id', [Number(request.params.id), request.userId])
  if (!result.rowCount) {
    response.status(404).json({ error: 'Card not found' })
    return
  }

  response.json({ ok: true })
})

app.post('/api/cards/:id/use', requireAuth, async (request, response) => {
  const result = await pool.query(
    `
      UPDATE cards
      SET
        use_count = use_count + 1,
        last_used_at = NOW()
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `,
    [Number(request.params.id), request.userId]
  )

  if (!result.rowCount) {
    response.status(404).json({ error: 'Card not found' })
    return
  }

  response.json({ card: mapCard(result.rows[0]) })
})

app.post('/api/cards/extract', requireAuth, async (request, response) => {
  const { aiEndpoint, aiModel, aiApiKey, frontImageDataUrl, backImageDataUrl } = request.body || {}

  if (!aiEndpoint || !aiModel || !aiApiKey) {
    response.status(400).json({ error: 'AI endpoint, model, and API key are required. Configure them in Settings.' })
    return
  }

  if (!frontImageDataUrl && !backImageDataUrl) {
    response.status(400).json({ error: 'At least one card image is required. Capture front or back first.' })
    return
  }

  const imageContent = []
  if (frontImageDataUrl) {
    imageContent.push({
      type: 'image_url',
      image_url: { url: frontImageDataUrl, detail: 'high' }
    })
  }
  if (backImageDataUrl) {
    imageContent.push({
      type: 'image_url',
      image_url: { url: backImageDataUrl, detail: 'high' }
    })
  }

  const exampleJson = JSON.stringify({
    title: 'Card name or program name',
    issuer: 'Organization that issued the card',
    category: 'One of: Discount, Membership, Library, ID, Credit Card, Transport, Health, Other',
    cardholderName: 'Name printed on the card',
    identifier: 'Card number, member ID, or account number',
    barcodeValue: 'Numeric or alphanumeric value printed below the barcode',
    barcodeFormat: 'One of: CODE128, CODE39, CODABAR, EAN13, EAN8, UPC, ITF, ITF14',
    qrValue: 'URL or text encoded in a QR code if present',
    notes: 'Any other useful details (branch, terms, phone numbers)',
    tags: 'Comma-separated tags like: groceries, rewards, fitness',
    color: 'A hex accent color matching the card brand (e.g. #e63946)',
    expiryDate: 'Expiry date in MM/YY format (for credit/debit cards)',
    securityCode: 'CVV or security code (for credit/debit cards)'
  }, null, 2)

  const systemPrompt = `You are a card data extraction assistant. The user will show you photos of a physical card (front and/or back). Extract all visible information and return ONLY a valid JSON object with these fields:\n\n${exampleJson}\n\nRules:\n- Return ONLY the JSON object, no markdown fences, no explanation.\n- If a field is not visible or not applicable, use an empty string "".\n- For barcodeValue, read the number or text printed below or near any barcode. If it looks like a standard EAN-13 (13 digits), set barcodeFormat to "EAN13". For UPC (12 digits) use "UPC". Use "ITF" for Interleaved 2 of 5 when the barcode is numeric and matches that style. Use "CODE39" or "CODABAR" when the barcode style or printed text strongly suggests those formats. Otherwise default to "CODE128".\n- For qrValue, if there is a QR code try to infer the URL or content.\n- For color, pick a hex color that matches the dominant brand color of the card.\n- For category, pick the best fit from: Discount, Membership, Library, ID, Credit Card, Transport, Health, Other.\n- For expiryDate and securityCode, extract these only from credit/debit cards. Use MM/YY format for expiry.`

  const chatPayload = {
    model: aiModel,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all card details from these images.' },
          ...imageContent
        ]
      }
    ],
    max_tokens: 1024,
    temperature: 0.1
  }

  try {
    const baseUrl = aiEndpoint.replace(/\/+$/, '')
    const url = `${baseUrl}/chat/completions`

    const aiResponse = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aiApiKey}`
      },
      body: JSON.stringify(chatPayload)
    })

    if (!aiResponse.ok) {
      let detail = ''
      try {
        const errorBody = await aiResponse.json()
        detail = errorBody.error?.message || JSON.stringify(errorBody)
      } catch {
        detail = aiResponse.statusText
      }
      response.status(502).json({ error: `AI API error (${aiResponse.status}): ${detail}` })
      return
    }

    const aiResult = await aiResponse.json()
    const rawContent = aiResult.choices?.[0]?.message?.content || ''

    let extracted
    try {
      const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      extracted = JSON.parse(cleaned)
    } catch {
      response.status(502).json({ error: 'AI returned invalid JSON. Try again or use a different model.', raw: rawContent })
      return
    }

    response.json({ extracted })
  } catch (error) {
    console.error('AI extraction error:', error)
    response.status(502).json({ error: `Failed to contact AI API: ${error.message}` })
  }
})

app.get('/api/admin/backup/sql', requireAuth, requireAdmin, async (_request, response, next) => {
  const pgDump = spawnPostgresCommand('pg_dump', ['--clean', '--if-exists', '--no-owner', '--no-privileges'])
  const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED })

  response.setHeader('Content-Type', 'application/gzip')
  response.setHeader('Content-Disposition', `attachment; filename="card-keepr-${timestampForFile()}.sql.gz"`)

  try {
    await Promise.all([
      pipeline(pgDump.stdout, gzip, response),
      waitForProcess(pgDump)
    ])
  } catch (error) {
    if (!response.headersSent) {
      next(error)
      return
    }

    response.destroy(error)
  }
})

app.post(
  '/api/admin/restore/sql',
  requireAuth,
  requireAdmin,
  express.raw({ type: ['application/gzip', 'application/x-gzip', 'application/octet-stream'], limit: '250mb' }),
  async (request, response) => {
    if (request.headers['x-card-keepr-confirm-restore'] !== 'restore-db') {
      response.status(400).json({ error: 'Restore confirmation missing.' })
      return
    }

    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      response.status(400).json({ error: 'SQL backup file is required.' })
      return
    }

    const psql = spawnPostgresCommand('psql', ['-v', 'ON_ERROR_STOP=1'])

    try {
      await Promise.all([
        pipeline(Readable.from(request.body), zlib.createGunzip(), psql.stdin),
        waitForProcess(psql)
      ])
      response.json({ ok: true })
    } catch (error) {
      response.status(400).json({ error: `Restore failed: ${error.message}` })
    }
  }
)

// --- Static files ---

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { maxAge: '7d', index: false }))

  app.get(/^(?!\/api\/).*/, (_request, response) => {
    response.sendFile(path.join(distDir, 'index.html'))
  })
} else {
  app.get('/', (_request, response) => {
    response.type('text/plain').send('Client build not found. Run "npm run build" for production or use Vite during development.')
  })
}

app.use((error, _request, response, _next) => {
  console.error(error)
  response.status(500).json({ error: 'Internal server error' })
})

await ensureSchema()

app.listen(port, () => {
  console.log(`Card Keepr listening on http://localhost:${port}`)
})
