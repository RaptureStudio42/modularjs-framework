// deux enfants liés à deux sens à une ligne de liste (`n=!{p.n}`), qui écrivent leur prop dans `µawake` (`$n += 1`, `$n += 100`), définis
// APRÈS le rendu de la liste ; l'un d'eux est absent du manifeste (un composant compilé à part, que la page charge elle-même). Chacun reçoit
// la valeur du parent telle qu'elle est, un nombre, comme un enfant défini avant la liste : 102 et 111, dans un ordre de définition comme
// dans l'autre. Avant le correctif, l'enfant absent du manifeste ne recevait qu'un attribut, relu en texte : `"1" + 100 + 1` affichait 11001
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { attendre, pause } from './helpers/coeur-monter.js'

const ENFANT  = '<script>\n  µawake -> $n += 1\n</script>\n<p class="e">{$n}</p>\n'
const ENFANTX = '<script>\n  µawake -> $n += 100\n</script>\n<p class="e">{$n}</p>\n'
const LISTE   = `<script>\n  $l = [{ id: 'a', n: 1 }, { id: 'b', n: 10 }]\n</script>\n{for p in $l by id}<div class="r"><@enfant n=!{p.n}></@enfant><@enfantx n=!{p.n}></@enfantx></div>{end}\n`

type Fichiers = Record<'coeur' | 'liste' | 'enfant' | 'enfantx', string>
let construit: Promise<Fichiers> | null = null

// le cœur et un fichier par composant, d'une construction de développement
function construire(): Promise<Fichiers> {
  construit ??= (async () => {
    const root   = mjsTmp('liaison-deux-sens-hors-manifeste')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'liste.mjs'), LISTE)
    writeFileSync(join(srcDir, 'enfant.mjs'), ENFANT)
    writeFileSync(join(srcDir, 'enfantx.mjs'), ENFANTX)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const js   = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const lire = (re: RegExp) => js.filter((f) => re.test(f)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    const out  = { coeur: lire(/^mjs_/), liste: lire(/^liste\b/), enfant: lire(/^enfant\b/), enfantx: lire(/^enfantx\b/) }
    assert.ok(out.coeur && out.liste && out.enfant && out.enfantx, 'un fichier par composant : ' + js.join(', '))
    return out
  })()
  return construit
}

// la liste rendue, ses enfants encore inconnus ; puis chaque enfant défini, dans l'ordre donné : ce que montre chaque ligne
async function jouer(ordre: Array<'enfant' | 'enfantx'>): Promise<string[]> {
  const f      = await construire()
  const window = new Window({ url: 'http://localhost/', settings: { disableCSSFileLoading: true } } as any) as any
  window.eval(`${f.coeur}\nglobalThis.µ = µ;`)
  // le manifeste de la construction : la liste et l'enfant du projet ; l'enfant compilé à part n'y est pas
  window.eval(`µ.paths = { liste: '/out/liste.js', enfant: '/out/enfant.js' };`)
  window.eval(f.liste)
  window.document.body.innerHTML = '<mjs-liste></mjs-liste>'
  const liste = window.document.querySelector('mjs-liste')
  await attendre(() => !!liste._shadow && liste._shadow.querySelectorAll('.r mjs-enfantx').length === 2)
  for (const nom of ordre) {
    window.eval(f[nom])
    await pause(80)
  }
  await pause(150)
  return Array.from(liste._shadow.querySelectorAll('.r')).map((r: any) => Array.from(r.children).map((e: any) => {
    const t = e._shadow && e._shadow.querySelector('.e')
    return t ? t.textContent : 'null'
  }).join(' '))
}

describe('liaison à deux sens : un enfant absent du manifeste, défini après la liste, reçoit la valeur du parent telle qu\'elle est', function () {
  this.timeout(60000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  it('l\'enfant compilé à part défini d\'abord, puis celui du projet : 102 et 111', async () => {
    assert.deepEqual(await jouer(['enfantx', 'enfant']), ['102 102', '111 111'])
  })

  it('l\'enfant du projet défini d\'abord, puis celui compilé à part : 102 et 111', async () => {
    assert.deepEqual(await jouer(['enfant', 'enfantx']), ['102 102', '111 111'])
  })
})
