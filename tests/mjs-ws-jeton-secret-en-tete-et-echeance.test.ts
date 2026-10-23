// Jetons JWT HS256 de MJS-WS (src/mjs-ws/token.ts) : le secret, l'en-tête et l'échéance.
// - Un secret vide (variable d'environnement absente ou vide) laisserait n'importe qui fabriquer un jeton valide :
//   refusé dès la construction de jwtAuth, et par signToken / verifyToken. Un secret court passe, avec un
//   avertissement unique.
// - `typ` est facultatif (la gem jwt de Ruby ne l'écrit pas) ; `alg` reste strictement HS256, `none` refusé.
// - Un `exp` présent mais illisible ferait un jeton éternel : refusé.
// - Un `exp` égal à maintenant est déjà échu : refusé ; la tolérance d'horloge recule cette borne d'autant.
// Les jetons de ce fichier sont signés à la main (createHmac brut), comme une bibliothèque tierce les écrirait.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { jwtAuth, signToken, verifyToken } from '../src/mjs-ws/token.js'
import { setMessagesLang } from '../src/messages/index.js'

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..')
const SECRET = 'un-secret-de-test-assez-long-pour-hs256'

// un jeton à l'en-tête et à la charge donnés en texte brut, signé HS256
function rawToken(header: string, payload: string, secret = SECRET): string {
  const b64   = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
  const input = b64(header) +'.'+ b64(payload)
  return input +'.'+ createHmac('sha256', secret).update(input).digest('base64url')
}

const authOf = (token: string): unknown => jwtAuth(SECRET)({ protocol: 1, auth: { token } } as never, {} as never)

describe('jetons : le secret', () => {
  afterEach(() => setMessagesLang('fr'))

  it('jwtAuth refuse dès sa construction un secret vide, absent ou qui n\'est pas une chaîne, en français puis en anglais', () => {
    const texts: Record<string, string> = {}
    for (const lang of ['fr', 'en'] as const) {
      setMessagesLang(lang)
      for (const bad of ['', undefined, null, 42, {}, ['secret']]) {
        assert.throws(() => jwtAuth(bad as never), (err: Error) => {
          assert.ok(err.message.includes('jwtAuth'), err.message)
          assert.match(err.message, lang === 'fr' ? /secret manquant ou vide/ : /secret missing or empty/)
          texts[lang] = err.message
          return true
        }, `${lang} : ${JSON.stringify(bad)}`)
      }
    }
    assert.notEqual(texts.fr, texts.en)
  })

  it('signToken et verifyToken refusent aussi un secret vide : un jeton forgé avec la clé vide ne passe plus', () => {
    const forged = rawToken('{"alg":"HS256","typ":"JWT"}', '{"id":"admin","role":"admin"}', '')
    assert.throws(() => signToken({ id: 'admin' }, ''), /signToken/)
    assert.throws(() => verifyToken(forged, ''), /verifyToken/)
    assert.throws(() => verifyToken(forged, undefined as never), /verifyToken/)
  })

  it('un secret de moins de 32 caractères : un avertissement, une seule fois, et les jetons marchent', () => {
    const module = pathToFileURL(join(ROOT, 'src/mjs-ws/token.ts')).href
    const code   = [
      `const { jwtAuth, signToken, verifyToken } = await import(${JSON.stringify(module)})`,
      'const warnings = []',
      'console.warn = (...args) => { warnings.push(args.join(" ")) }',
      'const auth  = jwtAuth("secret-court")',
      'jwtAuth("secret-court")',
      'const token = signToken({ id: "u1" }, "secret-court")',
      'const payload = verifyToken(token, "secret-court")',
      'const identity = auth({ protocol: 1, auth: { token } }, {})',
      'jwtAuth("un-autre-secret-court")',
      'jwtAuth("un-secret-bien-plus-long-que-trente-deux-caracteres")',
      'process.stdout.write(JSON.stringify({ warnings, payload: payload && payload.id, identity: identity && identity.id }))',
    ].join('\n')
    const run = spawnSync(process.execPath, ['--import', 'tsx/esm', '--input-type=module', '-e', code], { cwd: ROOT, encoding: 'utf8', timeout: 20000 })
    assert.equal(run.status, 0, run.stderr)
    const out = JSON.parse(run.stdout)
    assert.equal(out.warnings.length, 1, JSON.stringify(out.warnings))
    assert.match(out.warnings[0], /32/)
    assert.equal(out.payload, 'u1')
    assert.equal(out.identity, 'u1')
  })
})

describe('jetons : l\'en-tête', () => {
  it('un en-tête sans typ, comme l\'écrit la gem jwt de Ruby, est accepté ; typ en minuscules aussi', () => {
    const iat = Math.floor(Date.now() / 1000)
    for (const header of ['{"alg":"HS256"}', '{"alg":"HS256","typ":"jwt"}', '{"typ":"JWT","alg":"HS256"}']) {
      const token = rawToken(header, JSON.stringify({ id: 42, pseudo: 'Zora', iat }))
      assert.deepEqual(verifyToken(token, SECRET), { id: 42, pseudo: 'Zora', iat }, header)
      assert.deepEqual(authOf(token), { id: 42, pseudo: 'Zora', iat }, header)
    }
  })

  it('alg reste strictement HS256 : none, absent ou autre refusés ; un typ qui n\'est pas JWT aussi', () => {
    const payload = '{"id":"admin"}'
    for (const header of ['{"alg":"none"}', '{"alg":"none","typ":"JWT"}', '{"typ":"JWT"}', '{"alg":"HS512","typ":"JWT"}', '{"alg":"hs256"}', '{"alg":"HS256","typ":"JWE"}', '{"alg":"HS256","typ":null}', '{"alg":"HS256","typ":["JWT"]}']) {
      const token = rawToken(header, payload)
      assert.equal(verifyToken(token, SECRET), null, header)
      assert.equal(authOf(token), false, header)
    }
    const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
    assert.equal(verifyToken(b64('{"alg":"none"}') +'.'+ b64(payload) +'.', SECRET), null, 'jeton non signé')
  })
})

describe('jetons : l\'échéance', () => {
  it('un exp présent mais qui n\'est pas un nombre : jeton refusé, jamais éternel', () => {
    const later = Math.floor(Date.now() / 1000) + 3600
    for (const exp of [JSON.stringify(String(later)), 'null', 'true', '{}', '[]', '1e400']) {
      const token = rawToken('{"alg":"HS256","typ":"JWT"}', `{"id":"u1","exp":${exp}}`)
      assert.equal(verifyToken(token, SECRET), null, `exp ${exp}`)
      assert.equal(authOf(token), false, `exp ${exp}`)
    }
  })

  it('un exp numérique : valable avant l\'échéance, refusé après ; sans exp, le jeton reste valable', () => {
    const now = Math.floor(Date.now() / 1000)
    assert.equal((verifyToken(rawToken('{"alg":"HS256","typ":"JWT"}', `{"id":"u1","exp":${now + 3600}}`), SECRET) as { id: string }).id, 'u1')
    assert.equal(verifyToken(rawToken('{"alg":"HS256","typ":"JWT"}', `{"id":"u1","exp":${now - 1}}`), SECRET), null)
    assert.equal((verifyToken(rawToken('{"alg":"HS256","typ":"JWT"}', '{"id":"u1"}'), SECRET) as { id: string }).id, 'u1')
  })

  it('un exp égal à maintenant est déjà échu : refusé ; une seconde plus tard, valable — la tolérance recule la borne d\'autant', () => {
    const realNow = Date.now
    const now     = 1800000000
    // horloge figée au milieu de la seconde `now` : la borne se lit sans course avec le passage à la seconde suivante
    Date.now = () => now * 1000 + 500
    try {
      const tokenAt = (exp: number): string => rawToken('{"alg":"HS256","typ":"JWT"}', `{"id":"u1","exp":${exp}}`)
      const idOf    = (payload: unknown): unknown => (payload as { id?: unknown } | null)?.id ?? null
      assert.equal(verifyToken(tokenAt(now), SECRET), null, 'exp = maintenant')
      assert.equal(authOf(tokenAt(now)), false, 'exp = maintenant, par jwtAuth')
      assert.equal(idOf(verifyToken(tokenAt(now + 1), SECRET)), 'u1', 'exp = maintenant + 1 s')
      assert.equal(verifyToken(tokenAt(now - 30), SECRET, { clockTolerance: 30 }), null, 'exp + tolérance = maintenant')
      assert.equal(idOf(verifyToken(tokenAt(now - 29), SECRET, { clockTolerance: 30 })), 'u1', 'exp + tolérance = maintenant + 1 s')
      assert.equal(jwtAuth(SECRET, { clockTolerance: 30 })({ protocol: 1, auth: { token: tokenAt(now - 30) } } as never, {} as never), false, 'par jwtAuth, avec la tolérance')
    } finally {
      Date.now = realNow
    }
  })
})
