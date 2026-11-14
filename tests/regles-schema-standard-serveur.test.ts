// Les règles au serveur de bout en bout : une entrée `.server.mjs` servie par le serveur de développement (même chargeur et même
// pipeline d'actions que `mjs serve`) écrit `@import rules 'modularjs-framework/rules'`, comme la doc (37 · Types). Le paquet est
// installé là où Node le trouve pour un fichier du projet : dans le `node_modules` du projet, ou dans celui d'un dossier parent
// (projet dans `proj/app`, paquet dans `proj/node_modules`). L'import nu reste nu, Node le résout : le cache des entrées compilées
// reste dans le projet (`node_modules/.cache/mjs/server`) ou dans le dossier temporaire, où des liens `node_modules` rendent à Node
// ceux du projet, jamais dans le `node_modules` d'un parent, et un `node_modules` en lecture seule ne casse rien. Une action reçoit toujours ses trois
// arguments (params, body, req) ; le formulaire entier (plusieurs valeurs d'un champ, case cochée, champ vide) est `req.form`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, chmodSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { StaticServer } from '../src/server/index.js'
import { createServeEntry } from '../src/server/serve-entry.js'
import { serverCacheDir } from '../src/cli/server-entry.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

after(() => sweepRegistered())
after(async () => { await terminateSharedWorkerPool() })

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const TEMP   = () => join(tmpdir(), `mjs-server-cache-${process.getuid?.() ?? 'nouid'}`)

const ENTREE = `@import rules 'modularjs-framework/rules'

signup = rules({ age: 'int 18..120', nick: 'Nick', tags: 'string 1..5[]', ok: 'bool', opt: 'int 1..10 | null' }, { types: { Nick: "string 3..20 ! 'admin' | 'root'" } })

export default {
  actions: {
    '/signup': (params, body, req) ->
      r = signup['~standard'].validate(req.form)
      if r.issues then { errors: Object.fromEntries(r.issues.map((i) -> [i.path.join('.'), i.message])) }
      else { redirect: '/welcome?' + new URLSearchParams({ v: JSON.stringify(r.value) }) }
    '/args': (...a) -> { errors: { n: String(a.length), body: JSON.stringify(a[1]), t3: typeof a[3], form: a[2].form.getAll('k').join(','), cle: String(Object.keys(a[2]).includes('form')) } }
    '/def': (params, body, req, opts = { mode: 'defaut' }) -> { errors: { mode: String(opts.mode) } }
  }
}
`

// `ici` : le paquet dans le node_modules du projet (sinon dans celui du dossier parent) ; `ro` : ce node_modules en lecture seule
function projet(ici = false, ro = false) {
  const base   = mjsTmp('regles-serveur')
  const root   = join(base, 'app')
  const nm     = join(ici ? root : base, 'node_modules')
  const paquet = join(nm, 'modularjs-framework')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, 'out'), { recursive: true })
  mkdirSync(paquet, { recursive: true })
  // le paquet installé, réduit à son entrée `./rules` (le paquet publié la construit dans dist/rules.js) : `import` seul, comme lui
  writeFileSync(join(paquet, 'package.json'), JSON.stringify({ name: 'modularjs-framework', type: 'module', exports: { './rules': { types: './rules.d.ts', import: './rules.js' } } }))
  writeFileSync(join(paquet, 'rules.js'), `export * from ${JSON.stringify(pathToFileURL(join(RACINE, 'src/rules/index.ts')).href)}\n`)
  writeFileSync(join(root, 'src', 'home.mjs'), '<h1>Salut</h1>')
  writeFileSync(join(root, 'out', 'manifest.js'), 'µ.paths = {};\nµ.version = "abcd1234";\n')
  writeFileSync(join(root, 'serve.server.mjs'), ENTREE)
  if (ro) chmodSync(nm, 0o555)
  return { base, root, nm, config: { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/manifest.js' } as any }
}

const liste = (d: string) => existsSync(d) ? readdirSync(d, { recursive: true }).map(String).sort() : []

async function servir(p: ReturnType<typeof projet>, f: (post: (chemin: string, body: string, type?: string) => Promise<Response>) => Promise<void>) {
  const entry  = await createServeEntry(p.config, p.root)
  assert.ok(entry, 'entrée serveur chargée')
  const server = new StaticServer({ rootDir: join(p.root, 'out'), port: 0, host: '127.0.0.1', config: p.config, configDir: p.root, manifestPath: join(p.root, 'out', 'manifest.js'), entry: entry ?? undefined })
  await server.start()
  const port = (server.server!.address() as any).port
  try {
    await f((chemin, body, type = 'application/x-www-form-urlencoded') => fetch(`http://127.0.0.1:${port}${chemin}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': type }, body }))
  }
  finally {
    await server.stop()
    entry?.close()
  }
}

function valeur(res: Response): unknown {
  return JSON.parse(new URL(res.headers.get('location')!, 'http://mjs.test').searchParams.get('v')!)
}

describe('règles au serveur de bout en bout — @import du paquet, formulaire entier, 422', () => {
  it('l’écriture de la doc marche avec le paquet d’un node_modules parent : refus champ par champ (422), formulaire accepté (303), en urlencoded et en multipart ; rien n’est écrit dans ce node_modules', async function () {
    this.timeout(30000)
    const p     = projet()
    const avant = liste(p.nm)
    assert.equal(serverCacheDir(p.root), TEMP())
    await servir(p, async (post) => {
      const refus = await post('/signup', 'age=17.6&nick=root&tags=a&tags=beaucoup%20trop&opt=')
      assert.equal(refus.status, 422)
      assert.deepEqual((await refus.json()).props.errors, { 'age': 'Saisissez un nombre entier de 18 à 120', 'nick': 'Cette valeur n\'est pas permise', 'tags.1': 'Saisissez de 1 à 5 caractères' })
      const bon = await post('/signup', 'age=42&nick=bob&tags=a&tags=b&ok=on&opt=')
      assert.equal(bon.status, 303)
      assert.deepEqual(valeur(bon), { age: 42, nick: 'bob', tags: ['a', 'b'], ok: true, opt: null })
      const b     = 'mjsReglesBoundary'
      const parts = [['age', '30'], ['nick', 'ann'], ['tags', 'x'], ['tags', 'y'], ['opt', '3']].map(([n, v]) => `--${b}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`).join('') + `--${b}--\r\n`
      const multi = await post('/signup', parts, `multipart/form-data; boundary=${b}`)
      assert.equal(multi.status, 303)
      assert.deepEqual(valeur(multi), { age: 30, nick: 'ann', tags: ['x', 'y'], ok: false, opt: 3 })
    })
    assert.deepEqual(liste(p.nm), avant)
  })

  it('une action reçoit ses trois arguments, comme toujours : le défaut d’un 4e paramètre est gardé ; le formulaire entier est req.form, hors des clés de req', async function () {
    this.timeout(30000)
    await servir(projet(), async (post) => {
      const args = await post('/args', 'k=1&k=2&t=%C3%A9')
      assert.deepEqual((await args.json()).props.errors, { n: '3', body: '{"k":"2","t":"é"}', t3: 'undefined', form: '1,2', cle: 'false' })
      const b     = 'mjsArgsBoundary'
      const parts = [['k', '3'], ['k', '4']].map(([n, v]) => `--${b}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`).join('') + `--${b}--\r\n`
      const multi = await post('/args', parts, `multipart/form-data; boundary=${b}`)
      assert.deepEqual((await multi.json()).props.errors, { n: '3', body: '{"k":"4"}', t3: 'undefined', form: '3,4', cle: 'false' })
      const def = await post('/def', 'k=1')
      assert.deepEqual((await def.json()).props.errors, { mode: 'defaut' })
    })
  })

  it('le node_modules du projet en lecture seule ne casse rien : les entrées compilées passent au dossier temporaire, le paquet se résout toujours', async function () {
    this.timeout(30000)
    const p     = projet(true, true)
    const avant = liste(p.nm)
    try {
      assert.equal(serverCacheDir(p.root), TEMP())
      await servir(p, async (post) => {
        const bon = await post('/signup', 'age=42&nick=bob&tags=a&ok=on&opt=')
        assert.equal(bon.status, 303)
        assert.deepEqual(valeur(bon), { age: 42, nick: 'bob', tags: ['a'], ok: true, opt: null })
        assert.equal((await post('/signup', 'age=150&nick=bob')).status, 422)
      })
      assert.deepEqual(liste(p.nm), avant)
    }
    finally {
      chmodSync(p.nm, 0o755)
    }
  })

  it('le node_modules du projet accessible en écriture garde les entrées compilées, comme toujours', () => {
    const p = projet(true)
    assert.equal(serverCacheDir(p.root), join(p.nm, '.cache', 'mjs', 'server'))
  })
})
