// cache sur disque (`mjs build --prod --cache`), chaque construction dans un dossier de sortie NEUF : un module repris du cache ne
// cite jamais l'adresse hachée d'une dépendance qui a changé depuis. Cas rejoué : pendant une construction d'essai, la classe Wallet
// et le composant app-header changent sur le disque juste après que la construction a lu leur source (un autre écrivain dans
// l'arbre) ; les modules qui s'en servent prennent l'empreinte de la version suivante, leur code l'adresse de celle d'avant. La
// construction suivante, sur les sources finales, recompile Wallet et app-header : elle ne doit pas reprendre ces modules tels quels
// (leur import viserait un fichier absent de sa sortie). Second cas : un fichier gardé sous `files/` retiré par une autre
// construction (son élagage) entre la lecture du cache et la reprise de l'unité : l'unité est recompilée, jamais omise. Dans les deux
// cas, chaque adresse .js citée existe, et la sortie est identique à l'octet à celle d'une construction complète des mêmes sources

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { files, gaps, write } from './helpers/construction-cache.js'

const wallet = (v: string): string => `class Wallet\n  version = -> '${v}'\n  gems = (w) -> w.gems + ${v.length}\n`
const header = (v: string): string => `<script lang="js">\n  $n = µWallet.gems({ gems: 2 });\n</script>\n\n<header class="entete">{$n} ${v} {µWallet.version()}</header>\n`
const page   = (nom: string): string => `<script lang="js">\n  $total = µWallet.gems({ gems: 1 });\n  @add = function() { $total++; };\n</script>\n\n<section class="${nom}">\n  <button @click={@add()}>{$total}</button>\n</section>\n`

function projet(prefixe: string): string {
  const root = mjsTmp(prefixe)
  const src  = join(root, 'app/modularjs')
  write(join(root, 'mjs.config.json'), '{}\n')
  write(join(root, 'node_modules/.keep'), '')
  write(join(src, 'Wallet.class.mjs'), wallet('v1'))
  write(join(src, 'app-header.mjs'), header('v1'))
  write(join(src, 'app-layout.page.mjs'), `@import default AppHeader 'app-header.mjs'\n\n<div class="mise-en-page">\n  <@app-header></@app-header>\n</div>\n`)
  for (const nom of ['budget-page', 'economy-page', 'shop-page']) write(join(src, `${nom}.mjs`), page(nom))
  write(join(src, 'about-page.mjs'), '<p class="about">about</p>\n')
  return root
}

interface Sortie { dir: string, out: string, erreurs: string[], bilan: string | null }

// construction de production par l'API, comme `mjs build --prod [--cache]` dans un dossier neuf (`<dir>/public/assets/modularJS_compiled`) ;
// `avant` reçoit l'instance avant son compile() (les doublures de la course)
let rang = 0
async function construire(root: string, cache: boolean, avant?: (b: any) => void): Promise<Sortie> {
  const dir = join(root, 'runs', String(++rang))
  const out = join(dir, 'public/assets/modularJS_compiled')
  const ici = process.cwd()
  process.chdir(root)
  try {
    const b: any = new Bundler({ sourceDir: join(root, 'app/modularjs'), outputDir: out, manifestPath: join(dir, 'bundle.js'), env: 'prod', colorsEnabled: false, ...(cache ? { cache: true } : {}) } as any)
    avant?.(b)
    const s = await b.compile()
    await b.close()
    return { dir, out, erreurs: s.errors.map((e: Error) => e.message), bilan: b.diskCacheLine }
  }
  finally {
    process.chdir(ici)
  }
}

// adresses .js gravées dans les modules de la sortie, sous son préfixe public, sans fichier dans la sortie
function citesAbsents(out: string): string[] {
  const absents: string[] = []
  for (const [rel, data] of files(out)) {
    if (!rel.endsWith('.js')) continue
    for (const m of data.toString('utf-8').matchAll(/\/assets\/modularJS_compiled\/([^"'`\s)]+\.js)(?=["'`])/g)) if (!existsSync(join(out, m[1]))) absents.push(`${rel} → ${m[1]}`)
  }
  return absents
}

async function justeEtComplete(root: string, s: Sortie, cas: string): Promise<void> {
  assert.deepEqual(s.erreurs, [], `${cas} : erreurs`)
  assert.deepEqual(citesAbsents(s.out), [], `${cas} : adresses citées sans fichier (${s.bilan})`)
  const complete = await construire(root, false)
  assert.deepEqual(complete.erreurs, [], `${cas} : construction complète`)
  assert.deepEqual(gaps(s.dir, complete.dir), [], `${cas} : écarts avec une construction complète des mêmes sources (${s.bilan})`)
}

describe('cache sur disque : un module repris cite l\'adresse à jour de sa dépendance', function () {
  this.timeout(180_000)
  after(async () => { await terminateSharedWorkerPool() })

  it('dépendance changée pendant une construction d\'essai : la construction suivante recompile ses modules, aucune adresse citée n\'est absente', async function () {
    const root = projet('cache-dependance-course')
    const src  = join(root, 'app/modularjs')
    const premiere = await construire(root, true)
    assert.deepEqual(premiere.erreurs, [])
    // l'essai part sur v2 ; juste après sa lecture de chaque source, l'autre écrivain pose v3, que verra la construction réelle
    write(join(src, 'Wallet.class.mjs'), wallet('v2'))
    write(join(src, 'app-header.mjs'), header('v2'))
    const essai = await construire(root, true, b => {
      const module = b.readScriptModule.bind(b)
      const source = b.mjsSource.bind(b)
      b.readScriptModule = async (file: string): Promise<string> => {
        const lu = await module(file)
        if (file.endsWith('Wallet.class.mjs')) write(join(src, 'Wallet.class.mjs'), wallet('v3'))
        return lu
      }
      b.mjsSource = (file: string): string => {
        const lu = source(file)
        if (file.endsWith('app-header.mjs') && lu.includes(' v2 ')) write(join(src, 'app-header.mjs'), header('v3'))
        return lu
      }
    })
    assert.deepEqual(essai.erreurs, [])
    assert.match(readFileSync(join(src, 'Wallet.class.mjs'), 'utf-8'), /v3/, 'la course a eu lieu')
    const reelle = await construire(root, true)
    assert.match(reelle.bilan ?? '', /^cache : \d+ fichiers? repris/, `le cache sert : ${reelle.bilan}`)
    await justeEtComplete(root, reelle, 'construction réelle après l\'essai')
  })

  it('fichier gardé retiré par une autre construction pendant la reprise : l\'unité est recompilée, la sortie est complète', async function () {
    const root  = projet('cache-dependance-elague')
    const gardes = join(root, 'node_modules/.cache/mjs/build/files')
    assert.deepEqual((await construire(root, true)).erreurs, [])
    const garde = readdirSync(gardes).find(f => /^app-header-\w{5}\.js$/.test(f))
    assert.ok(garde !== undefined, `fichier gardé d'app-header : ${readdirSync(gardes).join(', ')}`)
    // l'élagage d'une autre construction le retire après la lecture du cache, avant la reprise des unités (phase d'émission)
    const reprise = await construire(root, true, b => {
      const emettre = b.emitPendingUnits.bind(b)
      b.emitPendingUnits = async (...args: unknown[]): Promise<unknown> => {
        rmSync(join(gardes, garde), { force: true })
        return emettre(...args)
      }
    })
    assert.ok(existsSync(join(reprise.out, garde)) || readdirSync(reprise.out).some(f => /^app-header-\w{5}\.js$/.test(f)), 'app-header dans la sortie')
    await justeEtComplete(root, reprise, 'reprise après l\'élagage d\'une autre construction')
  })
})
