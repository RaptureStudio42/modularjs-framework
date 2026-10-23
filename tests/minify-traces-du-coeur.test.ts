// les traces du runtime partent du code envoyé quand le niveau de production coupe `log`
//
// la liste `pure` d'esbuild ne vaut que pour un nom GLOBAL : dans le cœur `µ` est une variable du fichier, dans
// un composant une liaison importée, et `µ.log(…)` y restait entier, texte compris. pour le texte du runtime
// (option runtimeSource) le minifieur réécrit donc l'appelé, et lui seul : `µ.log(` et `µ._mjs_logger()` deviennent
// un identifiant libre que `define` pose à null, si bien que l'appel optionnel `MJS_TRACE?.(…)` part avec ses
// arguments. les arguments ne sont jamais touchés : appels imbriqués, chaînes et gabarits restent exacts. une trace
// du runtime ne porte aucun effet de bord (tests/runtime-traces-sans-effet-de-bord.test.ts), ses arguments partent
// avec elle. le code de l'appli, lui, n'est pas touché
//
// l'aide `µ._mjs_logger`, bornée par les repères <trace-logger> dans mjs_init.ts, part avec les traces qu'elle garde

import assert from 'node:assert/strict'
import { cutRuntimeTraces, minifyJs } from '../src/bundler/minify.js'

const CORE = (level: string) => ({ force: true, runtimeSource: true, logLevel: level as any })

// exécute le code réduit (un script sans import ni export) ; le résultat est posé dans globalThis.__res
async function exec(source: string, opts: any): Promise<{ code: string, res: any, written: string[] }> {
  const { code } = await minifyJs(source, opts)
  const g: any   = globalThis
  g.__res        = undefined
  g.__written    = []
  new Function(code)()
  return { code, res: g.__res, written: g.__written }
}

const LOGGER = '// <trace-logger>\nµ._mjs_logger = function() { return µ.level >= 3 ? µ.log : null }\n// </trace-logger>'

describe('cutRuntimeTraces — réécriture du texte, appelé seul', () => {
  it('µ.log( et µ._mjs_logger()?.( deviennent MJS_TRACE?.(, arguments intacts', () => {
    assert.equal(cutRuntimeTraces('µ.log(\'a\', b)'), 'MJS_TRACE?.(\'a\', b)')
    assert.equal(cutRuntimeTraces('return µ._mjs_logger()?.(\'a\' + µ._mjs_txt(\'k\'))'), 'return MJS_TRACE?.(\'a\' + µ._mjs_txt(\'k\'))')
    assert.equal(cutRuntimeTraces('µ.log (x)'), 'MJS_TRACE?. (x)')
  })

  it('un appel imbriqué, des chaînes et des gabarits dans les arguments : le texte des arguments reste octet pour octet', () => {
    const args = 'fn(g(y), \')\', `(${h(\')\')}`, [1, (2)])'
    assert.equal(cutRuntimeTraces(`µ.log(${args})`), `MJS_TRACE?.(${args})`)
  })

  it('une chaîne, un gabarit, un commentaire, une expression régulière qui disent µ.log( ne bougent pas', () => {
    const texte = 'var a = \'µ.log(1)\'\nvar b = "µ.log(2)"\nvar c = `µ.log(3) ${x}`\n// µ.log(4)\n/* µ.log(5) */\nvar d = /µ.log(6)/\nvar e = \'µ._mjs_logger()?.(7)\''
    assert.equal(cutRuntimeTraces(texte), texte)
  })

  it('ce qui n\'est pas l\'appel direct ne bouge pas : µ.warn, µ.error, µ.log sans appel, une autre chaîne d\'accès', () => {
    const texte = 'µ.warn(1)\nµ.error(2)\nvar l = µ.log\nwindow.µ.log(3)\nobj.µ.log(4)\nµ.logs(5)\nxµ.log(6)\nµ.log.call(null, 7)'
    assert.equal(cutRuntimeTraces(texte), texte)
  })

  it('l\'aide est retirée avec ses repères, les lignes restent à leur place', () => {
    const avant = `var a = 1\n${LOGGER}\nvar b = 2\nµ._mjs_logger()?.('t')`
    const apres = cutRuntimeTraces(avant)
    assert.equal(apres.split('\n').length, avant.split('\n').length)
    assert.ok(!apres.includes('_mjs_logger'))
    assert.ok(!apres.includes('trace-logger'))
    assert.ok(apres.startsWith('var a = 1\n'))
    assert.ok(apres.endsWith('\nvar b = 2\nMJS_TRACE?.(\'t\')'))
  })

  it('un autre usage de l\'aide la garde en place : mieux vaut quelques octets qu\'un µ._mjs_logger introuvable', () => {
    const avant = `${LOGGER}\nvar keep = µ._mjs_logger\nµ._mjs_logger()?.('t')`
    const apres = cutRuntimeTraces(avant)
    assert.ok(apres.includes('µ._mjs_logger = function'))
    assert.ok(apres.includes('var keep = µ._mjs_logger'))
    assert.ok(apres.endsWith('MJS_TRACE?.(\'t\')'))
  })

  it('un texte sans trace ressort tel quel', () => {
    const texte = 'var x = 1\nµ.warn(\'a\')\nfunction f() { return x }\n'
    assert.equal(cutRuntimeTraces(texte), texte)
  })
})

describe('minifyJs — texte du runtime, niveau qui coupe `log`', () => {
  for (const level of ['warn', 'error', 'silent']) {
    it(`niveau ${level} : la trace part, texte compris, le reste du programme tourne`, async () => {
      const source = 'var µ = { log: function(m) { globalThis.__written.push(m) } }\nfunction f(x) { µ.log(\'trace-simple-xyz\'); return x + 1 }\nglobalThis.__res = f(1)'
      const { code, res, written } = await exec(source, CORE(level))
      assert.ok(!code.includes('trace-simple-xyz'), code)
      assert.equal(res, 2)
      assert.deepEqual(written, [])
    })
  }

  it('un appel imbriqué µ.log(fn(g(y))) : aucun reste, aucun appel de fn ni de g, un programme valide', async () => {
    const source = 'var µ = { log: function() {} }\nvar calls = []\nfunction g(y) { calls.push(\'g\'); return y }\nfunction fn(x) { calls.push(\'fn\'); return x }\nµ.log(fn(g(1)))\nµ.log(\'a\', fn(g(2)), `b ${g(3)} (${fn(\')\')}`)\nglobalThis.__res = calls.join()'
    const { code, res } = await exec(source, CORE('warn'))
    assert.equal(res, '')
    assert.ok(!code.includes('fn('), code)
  })

  it('une trace dont l\'argument a un effet de bord : il part avec elle (les traces du runtime n\'en ont pas)', async () => {
    const source = 'var µ = { log: function() {} }\nvar i = 0, o = {}\nµ.log(i++, o.k = 5, delete o.z)\nglobalThis.__res = [i, o.k]'
    const { res } = await exec(source, CORE('warn'))
    assert.deepEqual(res, [0, undefined])
  })

  it('return µ.log(…) : le résultat est utilisé, l\'appel part quand même', async () => {
    const source = 'var µ = { log: function() {} }\nfunction f() { return µ.log(\'trace-retour-xyz\') }\nfunction h() { return f() }\nglobalThis.__res = typeof h()'
    const { code, res } = await exec(source, CORE('warn'))
    assert.ok(!code.includes('trace-retour-xyz'), code)
    assert.equal(res, 'undefined')
  })

  it('une trace dans une expression à virgule ou un ternaire : la valeur de l\'expression est celle d\'avant', async () => {
    const source = 'var µ = { log: function() {} }\nvar n = 0\nfunction g() { n++; return 1 }\nvar v = globalThis.__w === undefined ? (µ.log(\'trace-virgule-xyz \' + g()), 7) : 8\nglobalThis.__res = [v, n]'
    const { code, res } = await exec(source, CORE('warn'))
    assert.ok(!code.includes('trace-virgule-xyz'), code)
    assert.deepEqual(res, [7, 0])
  })

  it('chaînes, gabarits, commentaires et expressions régulières qui disent µ.log( sortent intacts', async () => {
    const source = 'var µ = { log: function() {} }\nvar a = \'µ.log(pas-un-appel-1)\'\nvar b = `texte µ.log(pas-un-appel-2) ${1 + 1}`\n// µ.log(commentaire)\nvar c = /µ\\.log\\(pas-un-appel-3\\)/.source\nglobalThis.__res = [a, b, c]'
    const { res } = await exec(source, CORE('warn'))
    assert.deepEqual(res, ['µ.log(pas-un-appel-1)', 'texte µ.log(pas-un-appel-2) 2', 'µ\\.log\\(pas-un-appel-3\\)'])
  })

  it('µ.warn et µ.error restent au niveau warn, comme avant', async () => {
    const source = 'var µ = { log: function() {}, warn: function(m) { globalThis.__written.push(m) }, error: function(m) { globalThis.__written.push(m) } }\nµ.warn(\'avertissement-xyz\')\nµ.error(\'erreur-xyz\')\nµ.log(\'trace-xyz\')'
    const { code, written } = await exec(source, CORE('warn'))
    assert.deepEqual(written, ['avertissement-xyz', 'erreur-xyz'])
    assert.ok(!code.includes('trace-xyz'), code)
  })

  it('µ.warn et µ.error restent aussi aux niveaux error et silent : seul `console` s\'y retire', async () => {
    const source = 'var µ = { warn: function(m) { globalThis.__written.push(m) }, error: function(m) { globalThis.__written.push(m) } }\nµ.warn(\'avertissement-xyz\')\nµ.error(\'erreur-xyz\')\nconsole.warn(\'console-xyz\')'
    for (const level of ['error', 'silent']) {
      const { code, written } = await exec(source, CORE(level))
      assert.deepEqual(written, ['avertissement-xyz', 'erreur-xyz'], level)
      assert.ok(!code.includes('console-xyz'), level)
    }
  })

  it('niveau log : rien ne part, la trace s\'écrit, arguments évalués', async () => {
    const source = 'var µ = { log: function(m) { globalThis.__written.push(m) } }\nvar n = 0\nfunction g() { n++; return \'g\' }\nµ.log(\'trace-simple-xyz \' + g())\nglobalThis.__res = n'
    const { code, res, written } = await exec(source, CORE('log'))
    assert.ok(code.includes('trace-simple-xyz'), code)
    assert.equal(res, 1)
    assert.deepEqual(written, ['trace-simple-xyz g'])
  })

  it('sans runtimeSource (le code d\'une appli) : la trace reste, comme avant', async () => {
    const source = 'var µ = { log: function(m) { globalThis.__written.push(m) } }\nµ.log(\'trace-appli-xyz\')'
    const { code, written } = await exec(source, { force: true, logLevel: 'warn' })
    assert.ok(code.includes('trace-appli-xyz'), code)
    assert.deepEqual(written, ['trace-appli-xyz'])
  })

  it('sans minification : le texte ressort tel quel, jamais de MJS_TRACE', async () => {
    const source = 'µ.log(\'trace-xyz\')\nµ._mjs_logger()?.(\'autre\')\n'
    const { code } = await minifyJs(source, { force: false, runtimeSource: true, logLevel: 'warn' } as any)
    assert.equal(code, source)
  })

  it('jamais de MJS_TRACE dans le code envoyé, à aucun niveau', async () => {
    const source = `var µ = { log: function() {} }\n${LOGGER}\nµ.log(1)\nµ._mjs_logger()?.(2)\nglobalThis.__res = 1`
    for (const level of ['log', 'warn', 'error', 'silent']) {
      const { code } = await minifyJs(source, CORE(level) as any)
      assert.ok(!code.includes('MJS_TRACE'), level + ' : ' + code)
    }
  })

  it('l\'aide part avec les traces au niveau warn, reste au niveau log (la trace gardée s\'écrit)', async () => {
    const source = `var µ = { level: 3, log: function(m) { globalThis.__written.push(m) } }\n${LOGGER}\nfunction f(x) { µ._mjs_logger()?.('trace-gardee-xyz ' + x); return x }\nglobalThis.__res = f(4)`
    const coupe = await exec(source, CORE('warn'))
    assert.ok(!coupe.code.includes('_mjs_logger'), coupe.code)
    assert.ok(!coupe.code.includes('trace-gardee-xyz'), coupe.code)
    assert.equal(coupe.res, 4)
    const garde = await exec(source, CORE('log'))
    assert.ok(garde.code.includes('_mjs_logger'), garde.code)
    assert.deepEqual(garde.written, ['trace-gardee-xyz 4'])
    assert.equal(garde.res, 4)
  })

  it('un usage de l\'aide hors de la forme gardée la laisse en place, le programme tourne', async () => {
    const source = `var µ = { level: 3, log: function() {} }\n${LOGGER}\nvar keep = µ._mjs_logger\nfunction f() { µ._mjs_logger()?.('trace-gardee-xyz') }\nf()\nglobalThis.__res = typeof keep`
    const { code, res } = await exec(source, CORE('warn'))
    assert.ok(code.includes('_mjs_logger'), code)
    assert.ok(!code.includes('trace-gardee-xyz'), code)
    assert.equal(res, 'function')
  })
})
