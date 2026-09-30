import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { root, address } from './validation-runtime.mjs'

const require = createRequire(process.env.PLAYWRIGHT_MODULE || 'C:/Users/itall/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json')
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const directory = path.join(root, '.runtime', 'validation-final')
await mkdir(directory, { recursive: true })
const errors = [], writes = []
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => { if (request.url().endsWith('/api/base/index')) writes.push(request.url()) })
try {
  await page.goto(address)
  await page.getByRole('button', { name: 'Mostrar Normalização', exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector('[data-step=normalizing] button')?.disabled)
  assert.equal(await page.locator('.b0-cards>button').count(), 10)
  await page.getByRole('button', { name: 'Mostrar Normalização', exact: true }).click()
  const before = await page.locator('.b0-normalize-comparison article').first().locator('pre').first().textContent()
  const after = await page.locator('.b0-normalize-comparison article').last().locator('pre').first().textContent()
  assert.notEqual(before, after)
  assert.match(before, / {3}|\t/)
  assert.doesNotMatch(after, / {3}|\t|[⇥↵∅]/)
  await page.screenshot({ path: path.join(directory, '00-normalizacao.png'), fullPage: true })
  await page.getByRole('button', { name: 'Mostrar Chunking', exact: true }).click()
  assert.equal(await page.locator('.b0-all-chunks button[data-visible]').count(), 55)
  await page.getByRole('button', { name: 'Mostrar chunk D1-C2', exact: true }).click()
  assert.match(await page.locator('.b0-chunk-text').textContent(), /D1-C2/)
  await page.getByRole('button', { name: 'Mostrar chunk D10-C6', exact: true }).click()
  assert.match(await page.locator('.b0-chunk-text').textContent(), /D10-C6/)
  await page.screenshot({ path: path.join(directory, '00-chunking.png'), fullPage: true })
  await page.getByRole('button', { name: 'Mostrar Embeddings', exact: true }).click()
  assert.equal(await page.locator('.b0-vector-grid>span').count(), 55)
  assert.equal(await page.locator('[role=dialog]').count(), 0)
  assert.deepEqual(writes, [], 'A inspeção da Base pronta não pode reindexar')
  assert.deepEqual(errors, [])
  await writeFile(path.join(directory, 'base-ui.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), viewport: '1440x1000', documents: 10, chunks: 55, normalizationBeforeAfter: true, selectedChunkText: ['D1-C2', 'D10-C6'], embeddings: 55, noReindexOnInspection: true, browser: 'Edge headless, somente localhost', errors }, null, 2))
  console.log('PASS: Base pronta, normalização, 55 quadrados, texto selecionável D1–D10 e 55 embeddings; sem reindexação pela inspeção.')
} finally { await browser.close() }
