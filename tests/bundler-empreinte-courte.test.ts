// empreinte courte des fichiers JS produits par le build — pourquoi ce test existe.
//
// Un fichier compilé s'appelait `<nom>-<8 hexadécimaux>.js` (32 bits). La décision : cinq caractères
// en base 36 (`0-9a-z`, 36^5 = 60 466 176 valeurs), soit une chance sur 60 millions par fichier
// modifié que deux contenus partagent un nom, contre une sur 4 milliards avant. En échange, chaque
// nom perd trois caractères, répétés dans la table du manifeste, dans les imports entre fichiers et
// dans la liste de précache : environ 2 Ko de moins sur un site réel. Tous les fichiers changent de
// nom une seule fois, au premier build qui suit.
//
// L'empreinte est tirée du même hachage de contenu qu'avant (md5) : on prend l'entier de ses 128
// bits modulo 36^5, écrit en base 36 et complété à gauche par des `0`. Un simple
// `parseInt(hex8, 16).toString(36)` aurait une longueur variable et un premier caractère biaisé.
//
// Ce que ce fichier garde :
//   - la forme : cinq caractères `[0-9a-z]` pour les fichiers JS, CSS et JSON du build (composants,
//     modules, effets, cœur, langues), déterministe d'un build à l'autre ;
//   - la conversion : longueur fixe, zéros à gauche, valeurs limites, répartition uniforme ;
//   - un nouveau contenu qui reçoit le nom d'un contenu déjà écrit (même nom, md5 complet différent)
//     est une erreur de build nommée, jamais un fichier écrasé sans bruit (hachage forcé pour la
//     provoquer) ; deux sources de même nom n'ont pas ce risque, le build n'en écrit qu'une ;
//   - la table compacte du manifeste : chaque entrée se décode vers un fichier qui existe ;
//   - la purge : les anciens fichiers à huit caractères d'un build précédent partent, un fichier
//     étranger qui ressemble seulement à un nom haché reste ;
//   - ce qui ne change pas : fragments de traduction (md5 sur 12 caractères) et images copiées.

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool, decodePathValue, encodePathValue } from '../src/bundler/index.js'
import { shortFingerprint, shortFingerprintFromHex } from '../src/bundler/fingerprint.js'

interface Projet { root: string; srcDir: string; outDir: string }

const CINQ = /^[0-9a-z]{5}$/

function projet(prefixe: string, fichiers: Record<string, string | Buffer>): Projet {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  for (const [rel, contenu] of Object.entries(fichiers)) {
    const complet = join(srcDir, rel)
    mkdirSync(dirname(complet), { recursive: true })
    writeFileSync(complet, contenu)
  }
  return { root, srcDir, outDir: join(root, 'out') }
}

function nouveau(p: Projet, extra: Record<string, unknown> = {}): any {
  return new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: join(p.outDir, 'bundle.js'), urlPrefix: '/out', ...extra } as any)
}

// consigne des noms au registre des sorties (`.mjs-outputs.json`, clé `files`), comme l'aurait fait le build qui les a
// écrits : le ménage ne retire que ce que ce registre liste, jamais un fichier sur la seule forme de son nom
function consigner(dossier: string, ...noms: string[]): void {
  const chemin   = join(dossier, '.mjs-outputs.json')
  const registre = JSON.parse(readFileSync(chemin, 'utf-8'))
  registre.files = [...new Set([...(registre.files ?? []), ...noms])].sort()
  writeFileSync(chemin, JSON.stringify(registre, null, 2) + '\n')
}

async function construire(p: Projet, extra: Record<string, unknown> = {}) {
  const bundler = nouveau(p, extra)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  return stats
}

function table(p: Projet): Record<string, string> {
  return JSON.parse(/^const µPaths = (\{.*\});$/m.exec(readFileSync(join(p.outDir, 'bundle.js'), 'utf-8'))![1])
}

const composant = (n: string) => `<script>\n  $x = 1\n</script>\n<p>{$x} ${n}</p>\n`

describe('empreinte courte — la conversion', () => {
  it('rend toujours cinq caractères, complétés à gauche par des zéros', () => {
    assert.equal(shortFingerprintFromHex('0'.repeat(32)), '00000')
    // 36^5 + 7 : le modulo ramène à 7, écrit sur cinq caractères
    assert.equal(shortFingerprintFromHex((60466176n + 7n).toString(16)), '00007')
    // le plus grand entier du domaine, 36^5 - 1
    assert.equal(shortFingerprintFromHex((60466176n - 1n).toString(16)), 'zzzzz')
    assert.equal(shortFingerprintFromHex('f'.repeat(32)).length, 5)
  })

  it('vient du md5 du contenu : même contenu, même empreinte ; contenu différent, empreinte différente', () => {
    const hex = createHash('md5').update('bonjour').digest('hex')
    assert.equal(shortFingerprint('bonjour'), shortFingerprintFromHex(hex))
    assert.equal(shortFingerprint(Buffer.from('bonjour')), shortFingerprint('bonjour'))
    assert.notEqual(shortFingerprint('bonjour'), shortFingerprint('bonsoir'))
    assert.match(shortFingerprint('bonjour'), CINQ)
  })

  it('est uniforme : sur 10 000 empreintes, chaque caractère de chaque position pèse entre 2,0 % et 3,6 % (attendu 2,78 %)', () => {
    const N       = 10000
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'
    const comptes = Array.from({ length: 5 }, () => new Map<string, number>())
    for (let i = 0; i < N; i++) {
      const e = shortFingerprint(`contenu numero ${i}`)
      assert.match(e, CINQ)
      for (let pos = 0; pos < 5; pos++) comptes[pos].set(e[pos], (comptes[pos].get(e[pos]) ?? 0) + 1)
    }
    for (let pos = 0; pos < 5; pos++) {
      for (const c of alphabet) {
        const part = (comptes[pos].get(c) ?? 0) / N * 100
        assert.ok(part >= 2.0 && part <= 3.6, `position ${pos}, caractère ${c} : ${part.toFixed(2)} %`)
      }
    }
  })
})

describe('empreinte courte — les fichiers du build', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('chaque fichier JS du build (composants, module, cœur, effets, langues, groupe) porte cinq caractères base 36', async () => {
    const p = projet('empreinte-forme', {
      'carte.mjs':           '@import marque \'outils.module.civet\'\n\n<p class="carte">{marque}</p>\n',
      'outils.module.civet': 'export marque := \'outils\'\n',
      'accueil.mjs':         '<p fx="fade">accueil</p>\n',
      'i18n/fr.json':        JSON.stringify({ titre: 'Bonjour' })
    })
    await construire(p, { i18n: { default: 'fr' }, forceMinify: true })
    const js = readdirSync(p.outDir).filter(f => f.endsWith('.js') && f !== 'bundle.js')
    assert.ok(js.length >= 4, `fichiers attendus, vus : ${js.join(', ')}`)
    for (const f of js) {
      assert.match(f, /^.+-[0-9a-z]{5}\.js$/, `${f} : cinq caractères base 36 attendus`)
      assert.doesNotMatch(f, /-[a-f0-9]{8}\.js$/, `${f} : plus d'empreinte à huit hexadécimaux`)
    }
    assert.ok(js.some(f => /^mjs_core-[0-9a-z]{5}\.js$/.test(f)), 'le cœur')
    assert.ok(js.some(f => /^carte-[0-9a-z]{5}\.js$/.test(f)), 'le composant')
    assert.ok(js.some(f => /^outils\.module-[0-9a-z]{5}\.js$/.test(f)), 'le module')
    assert.ok(js.some(f => /^mjs_i18n-fr-[0-9a-z]{5}\.js$/.test(f)), 'le fichier de langue')
  })

  it('deux builds du même projet donnent exactement les mêmes noms', async () => {
    const fichiers = { 'a.mjs': composant('a'), 'b.mjs': composant('b') }
    const un   = projet('empreinte-det-1', fichiers)
    const deux = projet('empreinte-det-2', fichiers)
    await construire(un)
    await construire(deux)
    assert.deepEqual(readdirSync(un.outDir).sort(), readdirSync(deux.outDir).sort())
  })

  it('les images copiées gardent leur empreinte à huit hexadécimaux', async () => {
    const p = projet('empreinte-image', {
      'comp.mjs': '<script lang="coffee">\n  chemin = µasset(\'logo.png\')\n</script>\n<p>{chemin}</p>\n',
      'logo.png': Buffer.from([1, 2, 3])
    })
    await construire(p)
    const logos = readdirSync(p.outDir).filter(f => f.startsWith('logo-'))
    assert.equal(logos.length, 1)
    assert.match(logos[0], /^logo-[a-f0-9]{8}\.png$/)
  })

  it('les fragments de traduction gardent leur nom md5 sur douze hexadécimaux', async () => {
    const p = projet('empreinte-fragments', { 'accueil.mjs': '<p>{µt(\'titre\')}</p>\n', 'i18n/fr.json': JSON.stringify({ titre: 'Bonjour' }), 'i18n/fr/section.json': JSON.stringify({ k: 'texte' }) })
    await construire(p, { i18n: { default: 'fr' }, forceMinify: true })
    const noms = readdirSync(join(p.outDir, 'i18n', 'fr'))
    assert.ok(noms.length >= 1, 'au moins un fragment')
    for (const n of noms) assert.match(n, /^[a-f0-9]{12}\.json$/, n)
  })

  describe('collision d\'empreinte', () => {
    it('un fichier modifié dont la nouvelle version reçoit le nom de l\'ancienne : erreur de build nommée, l\'ancien fichier reste intact', async () => {
      const p = projet('empreinte-collision', { 'util.mjs': composant('avant') })
      const bundler = nouveau(p)
      // hachage forcé : tout contenu reçoit la même empreinte courte, l'empreinte complète reste celle du contenu
      bundler.fingerprintOf = (contenu: string | Buffer) => ({ court: 'aaaaa', complet: createHash('md5').update(contenu).digest('hex') })
      const premier = await bundler.compile()
      assert.equal(premier.errors.length, 0, premier.errors.map((e: any) => e.message).join('\n'))
      writeFileSync(join(p.srcDir, 'util.mjs'), composant('apres'))
      let message = ''
      try {
        const stats = await bundler.compile()
        message = stats.errors.map((e: any) => e.message).join('\n')
      } catch (e: any) {
        message = String(e?.message ?? e)
      }
      await bundler.close().catch(() => {})
      assert.match(message, /util-aaaaa\.js/, 'le nom en collision est cité')
      assert.match(message, /empreinte/i)
      assert.ok(readFileSync(join(p.outDir, 'util-aaaaa.js'), 'utf-8').includes('avant'), 'le fichier déjà écrit n\'est pas écrasé')
    })

    it('le même contenu écrit deux fois sous le même nom n\'est pas une collision', async () => {
      const p = projet('empreinte-meme-contenu', { 'a.mjs': composant('a'), 'b.mjs': composant('b') })
      const bundler = nouveau(p)
      await bundler.compile()
      const stats2 = await bundler.compile()
      assert.equal(stats2.errors.length, 0)
      await bundler.close()
    })
  })

  describe('table compacte du manifeste (production, 60 composants)', () => {
    let p: Projet
    let t: Record<string, string>
    before(async () => {
      const fichiers: Record<string, string> = { 'carte.mjs': '<p>carte</p>\n', 'tuto/tuto-ajax.mjs': '<p>ajax</p>\n', 'outils.module.civet': 'export marque := \'outils\'\n' }
      for (let i = 1; i <= 60; i++) fichiers[`fiche-${String(i).padStart(2, '0')}.mjs`] = `<p>fiche ${i}</p>\n`
      p = projet('empreinte-table', fichiers)
      await construire(p, { env: 'prod' })
      t = table(p)
    })

    it('chaque entrée, décodée, est un fichier qui existe ; une valeur compacte finit par cinq caractères base 36', () => {
      assert.ok(Object.keys(t).length >= 60, `table complète, ${Object.keys(t).length} entrées`)
      for (const [cle, v] of Object.entries(t)) {
        const fichier = decodePathValue(cle, v)
        assert.equal(existsSync(join(p.outDir, fichier)), true, `${cle} → ${v} → ${fichier} absent`)
        if (!v.includes('.')) assert.match(v.slice(-5), CINQ, `${cle} : ${v}`)
      }
      assert.match(t['fiche-01'], CINQ, 'valeur compacte = l\'empreinte seule')
      assert.match(t['ajax'], /^tuto-[0-9a-z]{5}$/, 'préfixe de dossier puis empreinte')
    })

    it('le décodeur du manifeste, évalué, rend le même chemin que decodePathValue', () => {
      const src = readFileSync(join(p.outDir, 'bundle.js'), 'utf-8')
      const m   = /^const µPath = .*$/m.exec(src)!
      const µPath = new Function('µPaths', 'µPathsPrefix', `${m[0]}\nreturn µPath;`)(t, '/out/')
      for (const [cle, v] of Object.entries(t)) assert.equal(µPath(cle), '/out/' + decodePathValue(cle, v), cle)
    })

    it('encodePathValue et decodePathValue se renvoient l\'un l\'autre ; un nom à huit hexadécimaux reste entier', () => {
      assert.equal(encodePathValue('carte', 'carte-ab3z9.js'), 'ab3z9')
      assert.equal(decodePathValue('carte', 'ab3z9'), 'carte-ab3z9.js')
      assert.equal(encodePathValue('ajax', 'tuto-ajax-ab3z9.js'), 'tuto-ab3z9')
      assert.equal(decodePathValue('ajax', 'tuto-ab3z9'), 'tuto-ajax-ab3z9.js')
      assert.equal(encodePathValue('logo', 'logo-1a2b3c4d.js'), 'logo-1a2b3c4d.js')
      assert.equal(decodePathValue('carte', 'carte-ab3z9.js'), 'carte-ab3z9.js', 'une valeur avec point est un nom entier')
    })
  })

  describe('purge', () => {
    it('un ancien fichier à huit caractères que le registre consigne est retiré ; un fichier qu\'il ne consigne pas reste, à cinq lettres comme à huit hexadécimaux', async () => {
      const p = projet('empreinte-purge', { 'a.mjs': composant('a') })
      const premier = nouveau(p)
      assert.equal((await premier.compile()).errors.length, 0)
      assert.deepEqual(premier.pruneOrphans().removed, [], 'rien à purger sur un build neuf')
      await premier.close()
      // laissés là : la sortie d'un build précédent (huit hexadécimaux), que le registre consigne, puis des fichiers qui ne
      // sont pas au build
      writeFileSync(join(p.outDir, 'vieux-1a2b3c4d.js'), 'export {}\n')
      writeFileSync(join(p.outDir, 'vieux-1a2b3c4d.js.map'), '{}')
      consigner(p.outDir, 'vieux-1a2b3c4d.js')
      writeFileSync(join(p.outDir, 'theme-light.css'), 'p{}')
      writeFileSync(join(p.outDir, 'rapport-abcde.js'), 'export {}\n')
      writeFileSync(join(p.outDir, 'vendor-0123abcd.js'), 'export {}\n')
      const second = nouveau(p)
      assert.equal((await second.compile()).errors.length, 0)
      const { removed } = second.pruneOrphans()
      await second.close()
      assert.deepEqual(removed.filter(n => n.startsWith('vieux')).sort(), ['vieux-1a2b3c4d.js', 'vieux-1a2b3c4d.js.map'])
      assert.equal(existsSync(join(p.outDir, 'theme-light.css')), true, 'un nom stable à cinq lettres n\'est pas une sortie du build')
      assert.equal(existsSync(join(p.outDir, 'rapport-abcde.js')), true, 'un fichier du projet qui ressemble à un nom haché reste')
      assert.equal(existsSync(join(p.outDir, 'vendor-0123abcd.js')), true, 'un fichier à huit hexadécimaux qu\'aucun build n\'a écrit reste')
    })

    it('un composant supprimé : son fichier à cinq caractères, écrit par un build précédent, est retiré', async () => {
      const p = projet('empreinte-purge-5', { 'a.mjs': composant('a'), 'b.mjs': composant('b') })
      const premier = nouveau(p)
      assert.equal((await premier.compile()).errors.length, 0)
      await premier.close()
      const bJs = readdirSync(p.outDir).find(f => /^b-[0-9a-z]{5}\.js$/.test(f))
      assert.ok(bJs, 'b-<empreinte>.js après le premier build')
      unlinkSync(join(p.srcDir, 'b.mjs'))
      const second = nouveau(p)
      assert.equal((await second.compile()).errors.length, 0)
      const { removed } = second.pruneOrphans()
      await second.close()
      assert.ok(removed.includes(bJs!), `${bJs} retiré, retirés : ${removed.join(', ')}`)
      assert.equal(existsSync(join(p.outDir, bJs!)), false)
    })
  })
})
