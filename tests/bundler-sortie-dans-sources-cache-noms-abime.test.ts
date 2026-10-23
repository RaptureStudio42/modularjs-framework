// Dossier de sortie dans le dossier des sources, production : le cache des noms courts (`.mangle-cache.json`) se versionne avec
// le projet. Une fusion git peut y laisser une valeur qui n'est pas un nom, ou ses lignes de conflit : le chargeur écarte ces
// entrées et la construction les recalcule. La garde des fichiers de l'auteur refusait pourtant de remplacer ce cache abîmé, en
// réclamant une marque que ce fichier ne porte jamais. Un cache reconnaissable à ses clés (propriétés `_mjs_…`, noms réservés à
// `false`) est de nouveau remplacé ; seul un fichier qui n'a pas cette forme est protégé, par une erreur qui ne parle pas de marque.
// Un cache coupé en cours de ligne (écriture ou copie interrompue) finit par un début de paire : il est reconnu et remplacé aussi.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const COMPOSANT = '<p class="carte">carte {$x}</p>\n<script>\n  $x = 1\n</script>\n'

function projet(prefixe: string) {
  const root = mjsTmp(prefixe)
  const src  = join(root, 'app', 'modularjs')
  const out  = join(src, 'out')
  mkdirSync(src, { recursive: true })
  writeFileSync(join(src, 'carte.mjs'), COMPOSANT)
  return { src, out, cache: join(out, '.mangle-cache.json') }
}

// construction de production, avec ce que le constructeur imprime au terminal (le chargeur du cache y avertit)
async function construire(p: { src: string, out: string }) {
  const messages = [] as string[]
  const origine  = { warn: console.warn, error: console.error }
  console.warn  = (...a: any[]) => { messages.push(a.join(' ')) }
  console.error = (...a: any[]) => { messages.push(a.join(' ')) }
  try {
    const b = new Bundler({ sourceDir: p.src, outputDir: p.out, manifestPath: join(p.out, 'bundle.js'), env: 'prod', keepFailedComponents: false })
    try {
      return { erreurs: (await b.compile()).errors.map(e => e.message), messages }
    }
    finally {
      await b.close()
    }
  }
  finally {
    console.warn  = origine.warn
    console.error = origine.error
  }
}

describe('sortie dans le dossier des sources : cache des noms courts abîmé remplacé, fichier de l\'auteur de ce nom protégé', function () {
  this.timeout(240000)
  after(async () => { await terminateSharedWorkerPool() })

  it('valeur qui n\'est pas un nom : entrée écartée, construction faite', async () => {
    const p = projet('cache-noms-valeur-nulle')
    assert.deepEqual((await construire(p)).erreurs, [])
    const cache = JSON.parse(readFileSync(p.cache, 'utf-8'))
    cache._mjs_zzz = null
    writeFileSync(p.cache, JSON.stringify(cache, null, 2))
    assert.deepEqual((await construire(p)).erreurs, [])
    assert.equal(JSON.parse(readFileSync(p.cache, 'utf-8'))._mjs_zzz, undefined, 'entrée abîmée gardée')
  })

  it('lignes de conflit d\'une fusion git : cache remplacé, construction faite', async () => {
    const p = projet('cache-noms-conflit')
    assert.deepEqual((await construire(p)).erreurs, [])
    // le cache ne finit pas par un saut de ligne : un marqueur ajouté à la suite peut se coller à l'accolade finale
    for (const conflit of [(t: string) => `<<<<<<< HEAD\n${t}\n=======\n${t}\n>>>>>>> autre\n`, (t: string) => `<<<<<<< HEAD\n${t}=======\n${t}>>>>>>> autre\n`]) {
      writeFileSync(p.cache, conflit(readFileSync(p.cache, 'utf-8')))
      assert.deepEqual((await construire(p)).erreurs, [])
      assert.doesNotThrow(() => JSON.parse(readFileSync(p.cache, 'utf-8')), 'cache en conflit laissé tel quel')
    }
  })

  it('cache coupé au milieu d\'une ligne (écriture ou copie interrompue) : reconnu, remplacé, construction faite', async () => {
    const p = projet('cache-noms-coupe')
    assert.deepEqual((await construire(p)).erreurs, [])
    const entier = readFileSync(p.cache, 'utf-8')
    const lignes = entier.split('\n')
    const propre = lignes.findIndex(l => l.trimStart().startsWith('"_mjs_'))
    const reserve = lignes.findIndex(l => /^\s*"[^"]+": false,?$/.test(l) && !l.includes('"_mjs_'))
    assert.ok(propre > 0 && reserve > 0, 'le cache porte des clés `_mjs_` et des noms réservés')
    const debut = (n: number): number => lignes.slice(0, n).join('\n').length + 1
    // coupé dans une clé `_mjs_`, juste après les deux-points, dans sa valeur, dans un nom réservé, dans son `false`
    const coupes = [
      debut(propre) + lignes[propre].indexOf('"_mjs_') + 4,
      debut(propre) + lignes[propre].indexOf(':') + 1,
      debut(propre) + lignes[propre].lastIndexOf('"'),
      debut(reserve) + lignes[reserve].indexOf('"') + 2,
      debut(reserve) + lignes[reserve].indexOf('false') + 2,
    ]
    for (const coupe of coupes) {
      writeFileSync(p.cache, entier.slice(0, coupe))
      assert.throws(() => JSON.parse(readFileSync(p.cache, 'utf-8')))
      const { erreurs } = await construire(p)
      assert.deepEqual(erreurs, [], `coupé après « ${entier.slice(debut(entier.slice(0, coupe).split('\n').length - 1), coupe)} »`)
      assert.doesNotThrow(() => JSON.parse(readFileSync(p.cache, 'utf-8')), 'cache coupé laissé tel quel')
    }
  })

  it('fichier de l\'auteur coupé, sans la forme du cache : toujours refusé', async () => {
    const p      = projet('cache-noms-auteur-coupe')
    const auteur = '{\n  "note": "fichier de l au'
    mkdirSync(p.out, { recursive: true })
    writeFileSync(p.cache, auteur)
    const { erreurs } = await construire(p)
    assert.equal(erreurs.length, 1, erreurs.join('\n'))
    assert.equal(readFileSync(p.cache, 'utf-8'), auteur)
  })

  it('fichier de l\'auteur de ce nom : refusé avant toute écriture, sans parler de marque, intact', async () => {
    const p      = projet('cache-noms-auteur')
    const auteur = '{\n  "note": "fichier de l auteur",\n  "valeur": 1\n}\n'
    mkdirSync(p.out, { recursive: true })
    writeFileSync(p.cache, auteur)
    const { erreurs, messages } = await construire(p)
    assert.equal(erreurs.length, 1, erreurs.join('\n'))
    assert.ok(erreurs[0].includes(p.cache), erreurs[0])
    assert.doesNotMatch(erreurs[0], /marque|@generated/)
    assert.equal(messages.some(m => /\bvaleur\b/.test(m)), false, `fichier de l'auteur lu comme un cache : ${messages.join(' | ')}`)
    assert.equal(readFileSync(p.cache, 'utf-8'), auteur)
    assert.equal(existsSync(join(p.out, 'bundle.js')), false, 'manifeste écrit malgré le refus')
  })
})
