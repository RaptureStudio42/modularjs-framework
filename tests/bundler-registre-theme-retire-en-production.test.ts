// Le registre des variables de thème (`.mjs-theme-vars.json`) n'est plus écrit par un build de production, mais celui qu'avait
// laissé un `mjs dev`, un `mjs build` sans `--prod` ou une version précédente restait dans le même dossier de sortie : le dossier
// publié gardait le chemin des fichiers sources et les commentaires des composants. Le build de production le retire maintenant,
// une fois réussi, s'il a la forme du registre ; un fichier de ce nom qui ne l'a pas (peut-être un fichier à vous) reste intact,
// et un avertissement le nomme.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANT = '<style>\n  // couleur interne du panneau de remboursement manuel\n  :host\n    --mjs-alerte: red\n  p\n    color: var(--mjs-alerte, blue)\n</style>\n<p>a</p>\n'
const FAUTIF    = '<script>\n  $x = [1, 2\n</script>\n<p>{$x}</p>\n'

function projet(prefixe: string) {
  const root = mjsTmp(prefixe)
  const src  = join(root, 'src')
  const out  = join(root, 'public')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'admin-paiements.mjs'), COMPOSANT)
  return { src, out, registre: join(out, '.mjs-theme-vars.json') }
}

async function construire(p: { src: string, out: string }, env: 'dev' | 'prod') {
  const b = new Bundler({ sourceDir: p.src, outputDir: p.out, manifestPath: join(p.out, 'bundle.js'), env, keepFailedComponents: false })
  try {
    const stats = await b.compile()
    return { erreurs: stats.errors.map(e => e.message), avertissements: stats.warnings }
  }
  finally {
    await b.close()
  }
}

describe('bundler — registre des variables de thème laissé dans le dossier publié : retiré par le build de production', function () {
  this.timeout(180000)
  after(async () => { await terminateSharedWorkerPool() })

  it('développement puis production dans le même dossier : registre retiré, pas avant que le build de production réussisse', async () => {
    const p = projet('registre-theme-retire')
    assert.deepEqual((await construire(p, 'dev')).erreurs, [])
    assert.ok(existsSync(p.registre), 'registre du build de développement')
    writeFileSync(join(p.src, 'fautif.mjs'), FAUTIF)
    assert.ok((await construire(p, 'prod')).erreurs.length > 0)
    assert.ok(existsSync(p.registre), 'registre retiré par un build en échec, qui ne publie rien')
    writeFileSync(join(p.src, 'fautif.mjs'), '<p>b</p>\n')
    assert.deepEqual((await construire(p, 'prod')).erreurs, [])
    assert.ok(existsSync(join(p.out, 'bundle.js')), 'le build a bien publié')
    assert.equal(existsSync(p.registre), false, 'registre resté dans le dossier publié')
  })

  it('un fichier de ce nom qui n\'a pas la forme du registre : laissé intact, un avertissement le nomme', async () => {
    const p      = projet('registre-theme-auteur')
    const auteur = '{\n  "note": "fichier de l auteur"\n}\n'
    mkdirSync(p.out, { recursive: true })
    writeFileSync(p.registre, auteur)
    const { erreurs, avertissements } = await construire(p, 'prod')
    assert.deepEqual(erreurs, [])
    assert.equal(readFileSync(p.registre, 'utf-8'), auteur)
    assert.equal(avertissements.filter(a => a.includes(p.registre)).length, 1, avertissements.join('\n'))
  })
})
