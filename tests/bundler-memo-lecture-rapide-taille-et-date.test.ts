// La lecture rapide des sources (les stores typés d'un projet) est mémoïsée d'un tour de `mjs dev` à l'autre par
// date ET par taille : une source réécrite à la même date mais à une autre taille est relue, comme une source
// réécrite à la même taille mais à une autre date. Le mémo ne se fie jamais à une seule des deux.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs'
import { join, basename } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const JANUARY_1 = 1577836800   // 1er janvier 2020
const JANUARY_2 = 1577923200   // 2 janvier 2020

async function guardAfter(prefix: string, first: { text: string, date: number }, second: { text: string, date: number }): Promise<{ before: boolean, after: boolean }> {
  const root   = mjsTmp(prefix)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  const setting = join(srcDir, 'reglage.mjs')
  const write   = (file: { text: string, date: number }) => { writeFileSync(setting, file.text); utimesSync(setting, file.date, file.date) }
  write(first)
  writeFileSync(join(srcDir, 'champ.mjs'), '<input type="number" value=!{$$volume}>\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
  const guarded = async () => {
    const stats = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    return /µ\._mjs_fx\([^)]*"guard"/.test(readFileSync(join(outDir, basename(stats.manifest['champ'])), 'utf-8'))
  }
  try {
    const before = await guarded()
    write(second)
    return { before, after: await guarded() }
  }
  finally {
    await bundler.close()
  }
}

const TYPED   = '<vars>\n  $$volume  int 0..100\n</vars>\n<p>r</p>\n'
const OTHER   = '<vars>\n  $$volumi  int 0..100\n</vars>\n<p>r</p>\n'
const LONGER  = '<vars>\n  $$volumi  int 0..100\n</vars>\n<p>rr</p>\n'

describe('mémo de lecture rapide des sources — date ET taille', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('même date, autre taille : la source est relue', async () => {
    assert.notEqual(TYPED.length, LONGER.length)
    const { before, after } = await guardAfter('memo-taille', { text: TYPED, date: JANUARY_1 }, { text: LONGER, date: JANUARY_1 })
    assert.equal(before, true, 'le store est typé dans reglage.mjs')
    assert.equal(after, false, 'le store typé a changé de nom : le champ perd son garde')
  })

  it('même taille, autre date : la source est relue', async () => {
    assert.equal(TYPED.length, OTHER.length)
    const { before, after } = await guardAfter('memo-date', { text: TYPED, date: JANUARY_1 }, { text: OTHER, date: JANUARY_2 })
    assert.equal(before, true, 'le store est typé dans reglage.mjs')
    assert.equal(after, false, 'le store typé a changé de nom : le champ perd son garde')
  })
})
