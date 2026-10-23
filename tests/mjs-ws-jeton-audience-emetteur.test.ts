// Jetons JWT HS256 de MJS-WS (src/mjs-ws/token.ts) : pour quel site, par qui, à partir de quand.
// - jwtAuth(secret, { audience, issuer, clockTolerance }) : un jeton fait pour un autre site qui partage le même
//   secret est refusé. `aud` (chaîne ou liste) doit contenir l'un des sites attendus, `aud` absent est refusé ;
//   `iss` doit être l'un des émetteurs attendus ; la tolérance d'horloge, en secondes, vaut pour `exp` et `nbf`.
// - `nbf` (pas valable avant) est respecté même sans option : c'est le sens standard d'un jeton.
// - Sans option, rien d'autre ne change : ni `aud` ni `iss` ne sont regardés.
// - Une option invalide lève dès la construction, en français puis en anglais ; une clé inconnue aussi, avec la plus
//   proche en suggestion (`audiance` → `audience`).
// - verifyToken prend les mêmes options en troisième argument ; accountsAuth les transmet à jwtAuth.
// Les jetons de ce fichier sont signés à la main (createHmac brut), comme une bibliothèque tierce les écrirait.

import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { jwtAuth, verifyToken } from '../src/mjs-ws/token.js'
import { accountsAuth } from '../src/mjs-ws/accounts.js'
import { setMessagesLang } from '../src/messages/index.js'

const SECRET = 'un-secret-de-test-assez-long-pour-hs256'

// un jeton HS256 dont la charge est donnée en texte brut
function rawToken(payload: string): string {
  const b64   = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
  const input = b64('{"alg":"HS256","typ":"JWT"}') +'.'+ b64(payload)
  return input +'.'+ createHmac('sha256', SECRET).update(input).digest('base64url')
}

const tokenOf = (payload: Record<string, unknown>): string => rawToken(JSON.stringify(payload))
const nowSec  = (): number => Math.floor(Date.now() / 1000)
const hello   = (token?: string) => (token === undefined ? { protocol: 1 } : { protocol: 1, auth: { token } }) as never

// identifiant rendu par une fonction d'auth pour un jeton de cette charge, `false` quand elle refuse
function idOf(auth: (hello: never, meta: never) => unknown, payload: Record<string, unknown>): unknown {
  const identity = auth(hello(tokenOf(payload)), {} as never)
  return identity === false ? false : (identity as { id?: unknown }).id
}

describe('jetons : pour quel site — audience', () => {
  it('le aud du jeton doit être le site attendu : un jeton fait pour un autre site qui partage le secret est refusé', () => {
    const auth = jwtAuth(SECRET, { audience: 'boutique' })
    assert.equal(idOf(auth, { id: 'u1', aud: 'boutique' }), 'u1')
    assert.equal(idOf(auth, { id: 'u1', aud: 'blog' }), false, 'jeton d\'un autre site')
    assert.equal(idOf(auth, { id: 'u1', aud: 'Boutique' }), false, 'la casse compte')
    assert.equal(idOf(auth, { id: 'u1' }), false, 'aud absent')
    for (const aud of [null, 42, true, {}, { boutique: true }, '']) {
      assert.equal(idOf(auth, { id: 'u1', aud }), false, `aud ${JSON.stringify(aud)}`)
    }
  })

  it('un aud en liste passe s\'il contient le site attendu ; une audience en liste accepte chacun de ses sites', () => {
    const auth = jwtAuth(SECRET, { audience: 'boutique' })
    assert.equal(idOf(auth, { id: 'u1', aud: ['blog', 'boutique'] }), 'u1')
    assert.equal(idOf(auth, { id: 'u1', aud: ['blog', 'forum'] }), false)
    assert.equal(idOf(auth, { id: 'u1', aud: [] }), false)
    assert.equal(idOf(auth, { id: 'u1', aud: [['boutique']] }), false, 'une liste dans la liste ne compte pas')
    const several = jwtAuth(SECRET, { audience: ['boutique', 'boutique-admin'] })
    assert.equal(idOf(several, { id: 'u1', aud: 'boutique-admin' }), 'u1')
    assert.equal(idOf(several, { id: 'u1', aud: ['forum', 'boutique'] }), 'u1')
    assert.equal(idOf(several, { id: 'u1', aud: 'blog' }), false)
  })

  it('verifyToken prend la même option en troisième argument', () => {
    const iat = nowSec()
    assert.deepEqual(verifyToken(tokenOf({ id: 'u1', aud: 'boutique', iat }), SECRET, { audience: 'boutique' }), { id: 'u1', aud: 'boutique', iat })
    assert.equal(verifyToken(tokenOf({ id: 'u1', aud: 'blog' }), SECRET, { audience: 'boutique' }), null)
    assert.equal(verifyToken(tokenOf({ id: 'u1' }), SECRET, { audience: ['boutique'] }), null)
  })
})

describe('jetons : par qui — issuer', () => {
  it('le iss du jeton doit être l\'émetteur attendu, ou l\'un d\'eux', () => {
    const auth = jwtAuth(SECRET, { issuer: 'https://boutique.fr' })
    assert.equal(idOf(auth, { id: 'u1', iss: 'https://boutique.fr' }), 'u1')
    assert.equal(idOf(auth, { id: 'u1', iss: 'https://blog.fr' }), false)
    assert.equal(idOf(auth, { id: 'u1' }), false, 'iss absent')
    assert.equal(idOf(auth, { id: 'u1', iss: ['https://boutique.fr'] }), false, 'un iss est une chaîne, jamais une liste')
    const several = jwtAuth(SECRET, { issuer: ['https://boutique.fr', 'https://comptes.boutique.fr'] })
    assert.equal(idOf(several, { id: 'u1', iss: 'https://comptes.boutique.fr' }), 'u1')
    assert.equal(idOf(several, { id: 'u1', iss: 'https://blog.fr' }), false)
    assert.equal(verifyToken(tokenOf({ id: 'u1', iss: 'https://blog.fr' }), SECRET, { issuer: 'https://boutique.fr' }), null)
  })

  it('audience et issuer ensemble : les deux doivent correspondre', () => {
    const auth = jwtAuth(SECRET, { audience: 'boutique', issuer: 'https://boutique.fr' })
    assert.equal(idOf(auth, { id: 'u1', aud: 'boutique', iss: 'https://boutique.fr' }), 'u1')
    assert.equal(idOf(auth, { id: 'u1', aud: 'boutique', iss: 'https://blog.fr' }), false)
    assert.equal(idOf(auth, { id: 'u1', aud: 'blog', iss: 'https://boutique.fr' }), false)
  })
})

describe('jetons : pas valable avant — nbf', () => {
  it('sans aucune option, un nbf à venir refuse le jeton ; passé ou présent, il passe', () => {
    const now = nowSec()
    assert.equal(verifyToken(tokenOf({ id: 'u1', nbf: now + 60 }), SECRET), null)
    assert.equal(idOf(jwtAuth(SECRET), { id: 'u1', nbf: now + 60 }), false)
    assert.equal((verifyToken(tokenOf({ id: 'u1', nbf: now - 60 }), SECRET) as { id: string }).id, 'u1')
    assert.equal(idOf(jwtAuth(SECRET), { id: 'u1', nbf: now - 60 }), 'u1')
    assert.equal(idOf(jwtAuth(SECRET), { id: 'u1', nbf: now }), 'u1')
  })

  it('un nbf présent mais qui n\'est pas un nombre : jeton refusé', () => {
    const past = nowSec() - 60
    for (const nbf of [JSON.stringify(String(past)), 'null', 'true', '{}', '[]', '1e400', '-1e400']) {
      const token = rawToken(`{"id":"u1","nbf":${nbf}}`)
      assert.equal(verifyToken(token, SECRET), null, `nbf ${nbf}`)
      assert.equal(jwtAuth(SECRET)(hello(token), {} as never), false, `nbf ${nbf}`)
    }
  })
})

describe('jetons : tolérance d\'horloge — clockTolerance', () => {
  it('un jeton expiré depuis 10 s passe avec 30 s de tolérance, pas avec 5', () => {
    const exp = nowSec() - 10
    assert.equal(idOf(jwtAuth(SECRET), { id: 'u1', exp }), false, 'sans tolérance')
    assert.equal(idOf(jwtAuth(SECRET, { clockTolerance: 30 }), { id: 'u1', exp }), 'u1')
    assert.equal(idOf(jwtAuth(SECRET, { clockTolerance: 5 }), { id: 'u1', exp }), false)
    assert.equal((verifyToken(tokenOf({ id: 'u1', exp }), SECRET, { clockTolerance: 30 }) as { id: string }).id, 'u1')
    assert.equal(verifyToken(tokenOf({ id: 'u1', exp }), SECRET, { clockTolerance: 5 }), null)
  })

  it('un jeton valable dans 10 s passe avec 30 s de tolérance, pas avec 5', () => {
    const nbf = nowSec() + 10
    assert.equal(idOf(jwtAuth(SECRET, { clockTolerance: 30 }), { id: 'u1', nbf }), 'u1')
    assert.equal(idOf(jwtAuth(SECRET, { clockTolerance: 5 }), { id: 'u1', nbf }), false)
    assert.equal((verifyToken(tokenOf({ id: 'u1', nbf }), SECRET, { clockTolerance: 30 }) as { id: string }).id, 'u1')
    assert.equal(verifyToken(tokenOf({ id: 'u1', nbf }), SECRET, { clockTolerance: 5 }), null)
  })
})

describe('jetons : options invalides', () => {
  afterEach(() => setMessagesLang('fr'))

  it('jwtAuth refuse dès sa construction une option invalide, en français puis en anglais, en nommant l\'option', () => {
    const cases: Array<[string, unknown]> = []
    for (const bad of [42, '', [], [''], ['boutique', 3], null, {}, true]) cases.push(['audience', { audience: bad }], ['issuer', { issuer: bad }])
    for (const bad of [-1, NaN, Infinity, '30', null, true]) cases.push(['clockTolerance', { clockTolerance: bad }])
    for (const bad of ['boutique', 42, null, ['boutique']]) cases.push(['options', bad])
    const texts: Record<string, string[]> = { fr: [], en: [] }
    for (const lang of ['fr', 'en'] as const) {
      setMessagesLang(lang)
      for (const [option, opts] of cases) {
        assert.throws(() => jwtAuth(SECRET, opts as never), (err: Error) => {
          assert.ok(err.message.includes('jwtAuth'), err.message)
          assert.ok(err.message.includes(option), err.message)
          texts[lang].push(err.message)
          return true
        }, `${lang} : ${option} ${JSON.stringify(opts)}`)
      }
    }
    assert.equal(texts.fr.length, cases.length)
    texts.fr.forEach((text, i) => assert.notEqual(text, texts.en[i], text))
  })

  it('le message montre la valeur reçue', () => {
    assert.throws(() => jwtAuth(SECRET, { clockTolerance: -1 }), /-1/)
    assert.throws(() => jwtAuth(SECRET, { clockTolerance: NaN }), /NaN/)
    assert.throws(() => jwtAuth(SECRET, { audience: [] }), /\[\]/)
    assert.throws(() => jwtAuth(SECRET, { issuer: '' }), /""/)
  })

  it('verifyToken lève aussi sur une option invalide : c\'est une erreur de réglage, pas un jeton refusé', () => {
    const token = tokenOf({ id: 'u1', aud: 'boutique' })
    for (const [option, opts] of [['audience', { audience: '' }], ['issuer', { issuer: [] }], ['clockTolerance', { clockTolerance: -5 }]] as const) {
      assert.throws(() => verifyToken(token, SECRET, opts as never), (err: Error) => err.message.includes('verifyToken') && err.message.includes(option), option)
    }
  })
})

describe('jetons : clé inconnue', () => {
  afterEach(() => setMessagesLang('fr'))

  it('une clé inconnue est refusée dès la construction, avec la plus proche en suggestion, en français puis en anglais', () => {
    const texts: Record<string, string> = {}
    for (const lang of ['fr', 'en'] as const) {
      setMessagesLang(lang)
      assert.throws(() => jwtAuth(SECRET, { audiance: 'boutique' } as never), (err: Error) => {
        assert.ok(err.message.includes('jwtAuth'), err.message)
        assert.ok(err.message.includes('audiance'), err.message)
        assert.match(err.message, lang === 'fr' ? /vouliez-vous dire 'audience' \?/ : /did you mean 'audience'\?/)
        assert.ok(err.message.includes('audience, issuer, clockTolerance'), err.message)
        texts[lang] = err.message
        return true
      }, lang)
    }
    assert.notEqual(texts.fr, texts.en)
  })

  it('les autres fautes de frappe aussi ; une clé sans voisine proche donne seulement la liste des options', () => {
    assert.throws(() => jwtAuth(SECRET, { issuers: 'https://boutique.fr' } as never), /vouliez-vous dire 'issuer' \?/)
    assert.throws(() => jwtAuth(SECRET, { clockTolerence: 30 } as never), /vouliez-vous dire 'clockTolerance' \?/)
    assert.throws(() => jwtAuth(SECRET, { audience: 'boutique', leeway: 30 } as never), (err: Error) => {
      assert.ok(err.message.includes('leeway'), err.message)
      assert.ok(!err.message.includes('vouliez-vous dire'), err.message)
      assert.ok(err.message.includes('audience, issuer, clockTolerance'), err.message)
      return true
    })
    assert.throws(() => jwtAuth(SECRET, { audiance: undefined } as never), /audiance/, 'une clé mal écrite reste refusée même sans valeur')
  })

  it('verifyToken et accountsAuth refusent aussi une clé inconnue', () => {
    const token = tokenOf({ id: 'u1', aud: 'boutique' })
    assert.throws(() => verifyToken(token, SECRET, { audiance: 'boutique' } as never), (err: Error) => err.message.includes('verifyToken') && err.message.includes('\'audience\''))
    assert.throws(() => accountsAuth(SECRET, { audiance: 'boutique' } as never), /vouliez-vous dire 'audience' \?/)
  })
})

describe('jetons : accountsAuth transmet les options à jwtAuth', () => {
  it('le visiteur sans jeton reste anonyme ; un jeton d\'un autre site, d\'un autre émetteur, à venir ou trop vieux est refusé', () => {
    const auth = accountsAuth(SECRET, { audience: 'boutique', issuer: 'https://boutique.fr', clockTolerance: 30 })
    const now  = nowSec()
    const site = { aud: 'boutique', iss: 'https://boutique.fr' }
    assert.equal(auth(hello(), {} as never), undefined, 'sans jeton : anonyme')
    assert.equal(idOf(auth, { id: 'u1', ...site }), 'u1')
    assert.equal(idOf(auth, { id: 'u1', ...site, exp: now - 10 }), 'u1', 'expiré depuis 10 s, tolérance de 30 s')
    assert.equal(idOf(auth, { id: 'u1', ...site, exp: now - 60 }), false)
    assert.equal(idOf(auth, { id: 'u1', ...site, nbf: now + 60 }), false)
    assert.equal(idOf(auth, { id: 'u1', aud: 'blog', iss: 'https://boutique.fr' }), false, 'jeton d\'un autre site')
    assert.equal(idOf(auth, { id: 'u1', aud: 'boutique', iss: 'https://blog.fr' }), false, 'autre émetteur')
  })

  it('une option invalide lève dès sa construction', () => {
    assert.throws(() => accountsAuth(SECRET, { audience: [] }), /audience/)
    assert.throws(() => accountsAuth(SECRET, { clockTolerance: -1 }), /clockTolerance/)
  })
})

describe('jetons : sans option, rien d\'autre ne change', () => {
  it('ni aud ni iss ne sont regardés : un jeton avec ou sans eux passe comme avant ; un jeton expiré reste refusé', () => {
    const auths = [jwtAuth(SECRET), jwtAuth(SECRET, {}), jwtAuth(SECRET, { audience: undefined, issuer: undefined, clockTolerance: undefined }), accountsAuth(SECRET)]
    for (const auth of auths) {
      assert.equal(idOf(auth, { id: 'u1' }), 'u1')
      assert.equal(idOf(auth, { id: 'u1', aud: 'autre-site', iss: 'https://ailleurs.fr' }), 'u1')
      assert.equal(idOf(auth, { sub: 'u2', aud: ['a', 'b'] }), 'u2')
      assert.equal(idOf(auth, { id: 'u1', exp: nowSec() - 1 }), false, 'expiré : refusé, sans tolérance')
    }
    assert.equal((verifyToken(tokenOf({ id: 'u1', aud: 'autre-site' }), SECRET) as { id: string }).id, 'u1')
  })
})
