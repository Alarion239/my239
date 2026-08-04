import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const css = fs.readFileSync(path.join(here, '../src/design/theme.css'), 'utf8')

function readBlock(selector) {
  const match = css.match(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`Missing theme block: ${selector}`)
  const values = Object.fromEntries(
    [...match[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(([, key, value]) => [key, value]),
  )
  return values
}

function luminance(hex) {
  const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255)
  const linear = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrast(first, second) {
  const light = Math.max(luminance(first), luminance(second))
  const dark = Math.min(luminance(first), luminance(second))
  return (light + 0.05) / (dark + 0.05)
}

const pairs = [
  ['text', 'canvas', 4.5],
  ['muted', 'canvas', 4.5],
  ['text-subtle', 'surface', 4.5],
  ['action', 'on-action', 4.5],
  ['action-hover', 'on-action', 4.5],
  ['link', 'canvas', 4.5],
  ['focus', 'canvas', 3],
  ['border-control', 'surface', 3],
  ['selected-text', 'selected', 4.5],
  ['private', 'private-soft', 4.5],
  ['danger', 'danger-soft', 4.5],
  ['on-danger', 'danger', 4.5],
  ['success', 'success-soft', 4.5],
  ['warning', 'warning-soft', 4.5],
  ['info', 'info-soft', 4.5],
  ['status-accepted', 'status-accepted-soft', 4.5],
  ['status-rejected', 'status-rejected-soft', 4.5],
  ['status-checking', 'status-checking-soft', 4.5],
  ['status-grading', 'status-grading-soft', 4.5],
  ['status-appeal', 'status-appeal-soft', 4.5],
  ['status-unsolved', 'status-unsolved-soft', 4.5],
]

for (const [mode, selector] of [['light', ':root'], ['dark', '\\.dark']]) {
  const values = readBlock(selector)
  for (const [foreground, background, minimum] of pairs) {
    const value = contrast(values[foreground], values[background])
    if (value < minimum) {
      throw new Error(`${mode}: ${foreground} on ${background} is ${value.toFixed(2)}:1; expected at least ${minimum}:1`)
    }
    console.log(`${mode}: ${foreground} on ${background} ${value.toFixed(2)}:1`)
  }
}

console.log('Theme contrast checks passed.')
