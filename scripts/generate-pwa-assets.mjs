import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const publicDir = path.join(rootDir, 'public')
const splashDir = path.join(publicDir, 'apple-splash')

// All iPhone/iPad splash screen sizes (portrait + landscape pairs)
const splashScreens = [
  { width: 1320, height: 2868 },
  { width: 2868, height: 1320 },
  { width: 1290, height: 2796 },
  { width: 2796, height: 1290 },
  { width: 1179, height: 2556 },
  { width: 2556, height: 1179 },
  { width: 1170, height: 2532 },
  { width: 2532, height: 1170 },
  { width: 1125, height: 2436 },
  { width: 2436, height: 1125 },
  { width: 1242, height: 2688 },
  { width: 2688, height: 1242 },
  { width: 828, height: 1792 },
  { width: 1792, height: 828 },
  { width: 1536, height: 2048 },
  { width: 2048, height: 1536 },
  { width: 1668, height: 2388 },
  { width: 2388, height: 1668 },
  { width: 1640, height: 2360 },
  { width: 2360, height: 1640 },
  { width: 2048, height: 2732 },
  { width: 2732, height: 2048 }
]

fs.mkdirSync(publicDir, { recursive: true })
fs.mkdirSync(splashDir, { recursive: true })

// Card Keepr icon: dark rounded square with indigo-to-cyan gradient card shapes and "CK" text
function roundedSquareSvg(size, insetRatio = 0.08) {
  const inset = Math.round(size * insetRatio)
  const innerSize = size - inset * 2
  const radius = Math.round(size * 0.26)
  const innerRadius = Math.round(radius * 0.84)
  // Card shapes scaled to icon size
  const cardW = Math.round(innerSize * 0.50)
  const cardH = Math.round(innerSize * 0.34)
  const cardR = Math.round(innerSize * 0.055)
  // Back card (upper-left area)
  const bx = inset + Math.round(innerSize * 0.10)
  const by = inset + Math.round(innerSize * 0.18)
  // Front card (lower-right, overlapping)
  const fx = inset + Math.round(innerSize * 0.22)
  const fy = inset + Math.round(innerSize * 0.35)
  // CK text below cards
  const textSize = Math.round(innerSize * 0.22)
  const textY = fy + cardH + Math.round(innerSize * 0.14)
  const textX = Math.round(size / 2)

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8b5cf6"/>
          <stop offset="100%" stop-color="#22d3ee"/>
        </linearGradient>
        <radialGradient id="glow" cx="28%" cy="20%" r="80%">
          <stop offset="0%" stop-color="rgba(139,92,246,0.24)"/>
          <stop offset="100%" stop-color="rgba(139,92,246,0)"/>
        </radialGradient>
      </defs>
      <rect width="${size}" height="${size}" rx="${radius}" fill="#0a0a0f"/>
      <rect x="${inset}" y="${inset}" width="${innerSize}" height="${innerSize}" rx="${innerRadius}" fill="#111118"/>
      <rect x="${inset}" y="${inset}" width="${innerSize}" height="${Math.round(innerSize * 0.52)}" rx="${innerRadius}" fill="url(#glow)"/>
      <rect x="${bx}" y="${by}" width="${cardW}" height="${cardH}" rx="${cardR}" fill="#181825" stroke="#34344a" stroke-width="${Math.max(2, Math.round(size * 0.016))}"/>
      <rect x="${fx}" y="${fy}" width="${cardW}" height="${cardH}" rx="${cardR}" fill="url(#cardGrad)"/>
      <line x1="${fx + Math.round(cardW * 0.14)}" y1="${fy + Math.round(cardH * 0.48)}" x2="${fx + Math.round(cardW * 0.74)}" y2="${fy + Math.round(cardH * 0.48)}" stroke="#fff" stroke-width="${Math.max(2, Math.round(size * 0.028))}" stroke-linecap="round" opacity="0.92"/>
      <line x1="${fx + Math.round(cardW * 0.14)}" y1="${fy + Math.round(cardH * 0.72)}" x2="${fx + Math.round(cardW * 0.50)}" y2="${fy + Math.round(cardH * 0.72)}" stroke="#fff" stroke-width="${Math.max(2, Math.round(size * 0.028))}" stroke-linecap="round" opacity="0.70"/>
      <text x="${textX}" y="${textY}" text-anchor="middle" fill="#f8fafc" font-size="${textSize}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="800" letter-spacing="${Math.round(textSize * 0.06)}">CK</text>
    </svg>
  `
}

// Splash screen: dark bg with radial violet/cyan glow, centered icon block + title
function splashSvg(width, height) {
  const portrait = height >= width
  const iconBox = Math.round(Math.min(width, height) * (portrait ? 0.28 : 0.22))
  const iconInset = Math.round(iconBox * 0.13)
  const iconRadius = Math.round(iconBox * 0.25)
  const iconX = Math.round((width - iconBox) / 2)
  const iconY = Math.round(height * (portrait ? 0.23 : 0.2))
  const titleSize = Math.round(Math.min(width, height) * (portrait ? 0.072 : 0.058))
  const subtitleSize = Math.round(titleSize * 0.34)
  const textY = iconY + iconBox + Math.round(titleSize * 1.3)

  // Mini card shapes inside the splash icon block
  const cardW = Math.round(iconBox * 0.40)
  const cardH = Math.round(iconBox * 0.28)
  const cardR = Math.round(iconBox * 0.045)
  const bx = iconX + Math.round(iconBox * 0.14)
  const by = iconY + Math.round(iconBox * 0.16)
  const fx = iconX + Math.round(iconBox * 0.28)
  const fy = iconY + Math.round(iconBox * 0.34)
  const strokeW = Math.max(1, Math.round(iconBox * 0.016))
  const lineW = Math.max(1, Math.round(iconBox * 0.024))

  // CK text inside the icon block
  const ckSize = Math.round(iconBox * 0.17)
  const ckY = fy + cardH + Math.round(iconBox * 0.10)
  const ckX = iconX + Math.round(iconBox / 2)

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stop-color="#07080f"/>
          <stop offset="100%" stop-color="#0f0f1a"/>
        </linearGradient>
        <radialGradient id="gViolet" cx="40%" cy="22%" r="44%">
          <stop offset="0%" stop-color="rgba(139,92,246,0.22)"/>
          <stop offset="100%" stop-color="rgba(139,92,246,0)"/>
        </radialGradient>
        <radialGradient id="gCyan" cx="60%" cy="78%" r="42%">
          <stop offset="0%" stop-color="rgba(34,211,238,0.12)"/>
          <stop offset="100%" stop-color="rgba(34,211,238,0)"/>
        </radialGradient>
        <linearGradient id="panel" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="rgba(255,255,255,0.10)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0.04)"/>
        </linearGradient>
        <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#8b5cf6"/>
          <stop offset="100%" stop-color="#22d3ee"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <rect width="${width}" height="${height}" fill="url(#gViolet)"/>
      <rect width="${width}" height="${height}" fill="url(#gCyan)"/>
      <rect x="${iconX}" y="${iconY}" width="${iconBox}" height="${iconBox}" rx="${iconRadius}" fill="url(#panel)" stroke="rgba(255,255,255,0.10)"/>
      <rect x="${iconX + iconInset}" y="${iconY + iconInset}" width="${iconBox - iconInset * 2}" height="${iconBox - iconInset * 2}" rx="${Math.round(iconRadius * 0.82)}" fill="rgba(139,92,246,0.12)"/>
      <rect x="${bx}" y="${by}" width="${cardW}" height="${cardH}" rx="${cardR}" fill="#181825" stroke="#34344a" stroke-width="${strokeW}"/>
      <rect x="${fx}" y="${fy}" width="${cardW}" height="${cardH}" rx="${cardR}" fill="url(#cardGrad)"/>
      <line x1="${fx + Math.round(cardW * 0.14)}" y1="${fy + Math.round(cardH * 0.48)}" x2="${fx + Math.round(cardW * 0.74)}" y2="${fy + Math.round(cardH * 0.48)}" stroke="#fff" stroke-width="${lineW}" stroke-linecap="round" opacity="0.9"/>
      <line x1="${fx + Math.round(cardW * 0.14)}" y1="${fy + Math.round(cardH * 0.72)}" x2="${fx + Math.round(cardW * 0.50)}" y2="${fy + Math.round(cardH * 0.72)}" stroke="#fff" stroke-width="${lineW}" stroke-linecap="round" opacity="0.65"/>
      <text x="${ckX}" y="${ckY}" text-anchor="middle" fill="#f8fafc" font-size="${ckSize}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="800" opacity="0.85">CK</text>
      <text x="50%" y="${textY}" text-anchor="middle" fill="#f8fafc" font-size="${titleSize}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-weight="700">Card Keepr</text>
      <text x="50%" y="${textY + Math.round(subtitleSize * 1.8)}" text-anchor="middle" fill="rgba(226,232,240,0.80)" font-size="${subtitleSize}" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" letter-spacing="${Math.round(subtitleSize * 0.14)}">YOUR CARDS, YOUR SERVER</text>
    </svg>
  `
}

async function writePng(filePath, svg, size = null) {
  let image = sharp(Buffer.from(svg))
  if (size) {
    image = image.resize(size, size)
  }
  await image.png().toFile(filePath)
}

console.log('Generating PNG icons...')
await writePng(path.join(publicDir, 'icon-192.png'), roundedSquareSvg(192), 192)
await writePng(path.join(publicDir, 'icon-512.png'), roundedSquareSvg(512), 512)
await writePng(path.join(publicDir, 'maskable-icon-192.png'), roundedSquareSvg(192, 0.03), 192)
await writePng(path.join(publicDir, 'maskable-icon-512.png'), roundedSquareSvg(512, 0.03), 512)
await writePng(path.join(publicDir, 'apple-touch-icon.png'), roundedSquareSvg(180), 180)
console.log('  icon-192.png, icon-512.png, maskable-icon-192.png, maskable-icon-512.png, apple-touch-icon.png')

console.log('Generating splash screens...')
for (const screen of splashScreens) {
  const name = `${screen.width}x${screen.height}.png`
  await sharp(Buffer.from(splashSvg(screen.width, screen.height)))
    .png()
    .toFile(path.join(splashDir, name))
  console.log(`  ${name}`)
}

console.log('Done! All PWA assets generated.')
