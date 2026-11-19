// un texte traduit (`µt`) d'une branche `{await}` suit la langue dans un vrai navigateur, comme ailleurs dans le gabarit : texte seul, texte
// mêlé à la valeur de la branche ou à une variable, attribut d'une balise de la branche ; branche d'attente, `{success}`, `{error}`, et une
// promesse tenue après la bascule ; page ouverte en français, bascule par un clic (`µlang = 'en'`), retour au français ; fichier de langue
// anglais et fragment anglais de la section servis tout de suite, puis en retard ; développement et production, Chromium, Firefox et WebKit ;
// les textes suivaient déjà, l'attribut (`title={µt('bulle')}`) gardait sa première langue : il n'était écrit qu'à la construction de la
// branche, et aucun effet ne le réécrivait faute de variable réactive lue, alors qu'une bascule de langue ne reconstruit pas la branche

import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { MOTEURS, lancer, construire, relever, type Moteur, type Page, type Reseau } from './helpers/graine-page.js'

const MOTS = {
  fr: { patience: 'Patientez', recu: 'Reçu', panne: 'Panne', bulle: 'Bulle' },
  en: { patience: 'Wait', recu: 'Received', panne: 'Failure', bulle: 'Tooltip' }
}
const SECTIONS: Record<string, [string, Record<string, string>]> = {
  attente: [Object.entries(MOTS.fr).map(([cle, mot]) => cle + ': ' + mot).join('\n') + '\n', MOTS.en]
}

// un enfant par promesse : en attente pour toujours, tenue, rejetée (déjà prise en charge : aucun rejet non rattrapé), tenue par le test après la bascule
const CLES = ['attente', 'tenue', 'rejetee', 'tard']
const PROMESSES = `
window.__promesses = {
  attente: new Promise(function() {}),
  tenue:   Promise.resolve(42),
  rejetee: Promise.reject(new Error('E500')),
  tard:    new Promise(function(res) { window.__tenir = function() { res(43); }; })
};
window.__promesses.rejetee.catch(function() {});
`

// chaque branche : un texte traduit seul, aussi en attribut, puis le même mêlé à une valeur
const enfant = (cle: string): string => [
  "@i18n 'attente'",
  '<script>',
  `$p = window.__promesses.${cle}`,
  '$n = 7',
  '</script>',
  '{await $p}',
  '<p class="a1" title={µt(\'bulle\')}>{µt(\'patience\')}</p>',
  '<p class="a2">{µt(\'patience\')} {$n}</p>',
  '{success v}',
  '<p class="s1" title={µt(\'bulle\')}>{µt(\'recu\')}</p>',
  '<p class="s2">{µt(\'recu\')} {v}</p>',
  '{error err}',
  '<p class="e1" title={µt(\'bulle\')}>{µt(\'panne\')}</p>',
  '<p class="e2">{µt(\'panne\')} {err.message}</p>',
  '{end}'
].join('\n') + '\n'

const COMPOSANTS: Record<string, string> = {
  home: ['<button class="en" @click={µlang = \'en\'}>en</button>', '<button class="fr" @click={µlang = \'fr\'}>fr</button>', ...CLES.map(cle => `<mjs-kid-${cle}></mjs-kid-${cle}>`)].join('\n') + '\n',
  ...Object.fromEntries(CLES.map(cle => ['kid-' + cle, enfant(cle)]))
}

// ce que montre chaque enfant : première classe, texte et `title` de chaque paragraphe ; '-' tant que l'enfant n'est pas là (JavaScript pur)
const LIRE = `(function() {
  var home = document.querySelector('mjs-home');
  var racine = home && (home._shadow || home.shadowRoot);
  var vus = {};
  ${JSON.stringify(CLES)}.forEach(function(cle) {
    var hote = racine && racine.querySelector('mjs-kid-' + cle);
    var r = hote && (hote._shadow || hote.shadowRoot);
    vus[cle] = r ? Array.prototype.map.call(r.querySelectorAll('p'), function(p) { return p.classList[0] + '=' + p.textContent.trim() + (p.title ? ' @' + p.title : ''); }).join(' ; ') : '-';
  });
  return vus;
})()`
const cliquer = (langue: string): string => `(function() { var home = document.querySelector('mjs-home'); (home._shadow || home.shadowRoot).querySelector('button.${langue}').click(); })()`

// ce que la page doit montrer dans une langue ; la promesse du dernier enfant en attente ou tenue
function attendu(langue: 'fr' | 'en', tardTenue: boolean): Record<string, string> {
  const m       = MOTS[langue]
  const attente = `a1=${m.patience} @${m.bulle} ; a2=${m.patience} 7`
  const tenue   = (v: number) => `s1=${m.recu} @${m.bulle} ; s2=${m.recu} ${v}`
  return { attente, tenue: tenue(42), rejetee: `e1=${m.panne} @${m.bulle} ; e2=${m.panne} E500`, tard: tardTenue ? tenue(43) : attente }
}

// relit la page jusqu'à l'état voulu, 8 s au plus : rend le dernier état lu
async function attendre(page: any, voulu: Record<string, string>): Promise<Record<string, string>> {
  const fin = Date.now() + 8000
  let vu    = await page.evaluate(LIRE)
  while (!isDeepStrictEqual(vu, voulu) && Date.now() < fin) {
    await page.waitForTimeout(50)
    vu = await page.evaluate(LIRE)
  }
  return vu
}

const ENVS: Array<'dev' | 'prod'> = ['dev', 'prod']
const RESEAUX: Array<[string, Reseau]> = [['anglais servi tout de suite', {}], ['anglais arrivé tard', { racineEn: 400, retards: { attente: 700 } }]]

describe('µt dans les branches d\'un {await} : la bascule de langue les change (Chromium, Firefox, WebKit)', function () {
  this.timeout(300000)
  const navigateurs: Partial<Record<Moteur, any>> = {}
  const pages: Partial<Record<'dev' | 'prod', Page>> = {}

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
    for (const env of ENVS) pages[env] = await construire({ nom: 'await-langue-' + env, composants: COMPOSANTS, env, sansRendu: true, sections: SECTIONS })
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    for (const env of ENVS) if (pages[env]) await pages[env]!.fermer()
    await terminateSharedWorkerPool()
  })

  for (const m of MOTEURS) {
    for (const env of ENVS) {
      for (const [nom, reseau] of RESEAUX) {
        it(`${m}, ${env}, ${nom} : fr, en, promesse tenue en anglais, retour fr ; texte seul, mêlé, attribut`, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          pages[env]!.poser(reseau)
          const r = await relever(navigateurs[m], pages[env]!.base + '/', [], { initScript: PROMESSES, scenario: async (p: any) => {
            const fr = await attendre(p, attendu('fr', false))
            await p.evaluate(cliquer('en'))
            const aussitot = await p.evaluate(LIRE)
            const en       = await attendre(p, attendu('en', false))
            await p.evaluate('window.__tenir()')
            const tard   = await attendre(p, attendu('en', true))
            await p.evaluate(cliquer('fr'))
            const retour = await attendre(p, attendu('fr', true))
            return { fr, aussitot, en, tard, retour }
          } })
          assert.deepEqual(r.erreurs, [], `erreurs : ${r.erreurs.join(' | ')}`)
          const vu = r.extra
          assert.deepEqual(vu.fr, attendu('fr', false), 'ouvert en français')
          if (reseau.racineEn) assert.notDeepEqual(vu.aussitot, attendu('en', false), 'le dictionnaire anglais arrive après le clic')
          assert.deepEqual(vu.en, attendu('en', false), 'après la bascule en anglais ; console : ' + r.console.join(' | '))
          assert.deepEqual(vu.tard, attendu('en', true), 'promesse tenue après la bascule')
          assert.deepEqual(vu.retour, attendu('fr', true), 'retour au français')
        })
      }
    }
  }
})
