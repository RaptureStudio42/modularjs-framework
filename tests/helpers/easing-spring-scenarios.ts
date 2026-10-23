// Scénarios du comportement figé des courbes (mjs_easing) et du ressort (mjs_spring) : la table
// de référence (fixtures/easing-spring-table.json) a été tirée du code d'avant la réécriture ; le
// test rejoue les mêmes scénarios sur le code courant et compare à cette table.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ICI     = dirname(fileURLToPath(import.meta.url))
const RUNTIME = join(ICI, '..', '..', 'src', 'runtime')

const EASING_SRC = readFileSync(join(RUNTIME, 'mjs_easing.ts'), 'utf-8')
const SPRING_SRC = readFileSync(join(RUNTIME, 'mjs_spring.ts'), 'utf-8')

// µ minimal : messages rendus sous forme de clé (le texte de repli n'est pas ce qu'on fige ici)
function poserMu(avertissements: string[]) {
  const mu: any = { log() {}, error() {}, anim: {}, _csp: false, debug: true, _mjs_interpolatorSet: new Set() }
  mu.warn   = function(m: any) { avertissements.push(String(m)) }
  mu._mjs_txt = function(cle: string, args: any) { return '<' + cle + (args ? ' ' + JSON.stringify(args) : '') + '>' }
  mu.Ticker = { ajouts: 0, add() { this.ajouts++ } }
  return mu
}

export function chargerCourbes() {
  const avertissements: string[] = []
  const mu = poserMu(avertissements)
  new Function('µ', EASING_SRC)(mu)
  return { mu, avertissements }
}

export function chargerRessort() {
  const avertissements: string[] = []
  const mu = poserMu(avertissements)
  new Function('µ', SPRING_SRC)(mu)
  return { mu, avertissements }
}

// NaN et ±Infinity ne passent pas par JSON : on les range sous une étiquette lisible
function nombre(v: number) {
  if(Number.isNaN(v)) return 'NaN';
  if(v === Infinity) return 'Infinity';
  if(v === -Infinity) return '-Infinity';
  return v;
}

function aplatir(v: any): any {
  if(typeof v === 'number') return nombre(v);
  if(Array.isArray(v)) return v.map(aplatir);
  if(v && typeof v === 'object') {
    const o: any = {};
    for(const k of Object.keys(v)) o[k] = aplatir(v[k]);
    return o;
  }
  return v;
}

// --- courbes ---------------------------------------------------------------------------------
// t de -0.20 à 1.20 par pas de 0.01 (141 points) : le segment utile 0..1 plus un débord de chaque côté
export const POINTS: number[] = Array.from({ length: 141 }, (_, i) => (i - 20) / 100)

export const NOMS_COURBES = [
  'linear',
  'backIn', 'backOut', 'backInOut',
  'bounceIn', 'bounceOut', 'bounceInOut',
  'circIn', 'circOut', 'circInOut',
  'cubicIn', 'cubicOut', 'cubicInOut',
  'elasticIn', 'elasticOut', 'elasticInOut',
  'expoIn', 'expoOut', 'expoInOut',
  'quadIn', 'quadOut', 'quadInOut',
  'quartIn', 'quartOut', 'quartInOut',
  'quintIn', 'quintOut', 'quintInOut',
  'sineIn', 'sineOut', 'sineInOut'
]

// courbes de Bézier : les quatre du CSS usuel, deux plus nerveuses, une hors contrat (x hors [0,1])
export const BEZIERS: number[][] = [
  [0.25, 0.1, 0.25, 1], [0.42, 0, 1, 1], [0, 0, 0.58, 1], [0.42, 0, 0.58, 1],
  [0.68, -0.55, 0.27, 1.55], [0.1, 2, 0.9, -1], [0, 0, 1, 1], [1.2, 0, 0.5, 1], [0.5, 0, -0.1, 1]
]

export const CHAINES = [
  'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'cubic-bezier(0.25,0.1,0.25,1)',
  'cubic-bezier( 0.42 , 0 , 1 , 1 )', 'cubic-bezier(1.5,0,0,1)', 'bounceOut', 'nimporte', '', 'cubic-bezier(a,b,c,d)'
]

export function tableCourbes() {
  const { mu, avertissements } = chargerCourbes()
  const echantillonner = (f: any) => POINTS.map(function(t) { return nombre(f(t)) })
  const sortie: any = { points: POINTS.length, courbes: {}, beziers: [], chaines: {}, avertissements: [] }
  for(const nom of NOMS_COURBES) sortie.courbes[nom] = echantillonner(mu.easing[nom])
  for(const p of BEZIERS) {
    avertissements.length = 0
    const f = mu.easing.bezier(p[0], p[1], p[2], p[3])
    sortie.beziers.push({ params: p, valeurs: echantillonner(f), repliCubicOut: f === mu.easing.cubicOut, avertissements: avertissements.slice() })
  }
  for(const c of CHAINES) {
    avertissements.length = 0
    const f = mu.easing.resolve(c)
    sortie.chaines[c] = { valeurs: echantillonner(f), avertissements: avertissements.slice() }
  }
  // fonction passée telle quelle, valeur absente
  const id = function(t: number) { return t }
  sortie.resolveFonction = mu.easing.resolve(id) === id
  sortie.resolveVide     = nombre(mu.easing.resolve(null)(0.5)) === nombre(mu.easing.cubicOut(0.5))
  return sortie
}

// --- ressort ---------------------------------------------------------------------------------
// un scénario = valeur de départ, réglages, puis des actions rejouées à des numéros d'image ;
// on note à chaque image l'état du ressort et ce que _mjs_step a rendu
type Action = { image: number, cible?: any, raideur?: any, amortissement?: any, precision?: any, brut?: [string, any] }
type Scenario = { nom: string, depart: any, raideur?: any, amortissement?: any, min?: any, max?: any, precision?: any, actions: Action[], images: number }

export const SCENARIOS: Scenario[] = [
  { nom: 'scalaire-defaut',            depart: 0,   actions: [{ image: 0, cible: 100 }], images: 400 },
  { nom: 'scalaire-negatif',           depart: 50,  actions: [{ image: 0, cible: -20 }], images: 400 },
  { nom: 'raideur-0.3-amort-0.5',      depart: 0,   raideur: 0.3,  amortissement: 0.5,  actions: [{ image: 0, cible: 100 }], images: 400 },
  { nom: 'raideur-0.05-amort-0.95',    depart: 0,   raideur: 0.05, amortissement: 0.95, actions: [{ image: 0, cible: 100 }], images: 600 },
  { nom: 'raideur-1-amort-0.2',        depart: 0,   raideur: 1,    amortissement: 0.2,  actions: [{ image: 0, cible: 10 }], images: 800 },
  { nom: 'raideur-trop-forte-bornee',  depart: 0,   raideur: 5,    amortissement: 0.8,  actions: [{ image: 0, cible: 100 }], images: 400 },
  { nom: 'raideur-limite-stable',      depart: 0,   raideur: 2.38, amortissement: 0.8,  actions: [{ image: 0, cible: 100 }], images: 400 },
  { nom: 'raideur-nan-amort-nan',      depart: 0,   raideur: NaN,  amortissement: NaN,  actions: [{ image: 0, cible: 100 }], images: 400 },
  { nom: 'amortissement-zero-borne',   depart: 0,   raideur: 0.1,  amortissement: 0,    actions: [{ image: 0, cible: 100 }], images: 3000 },
  { nom: 'amortissement-un',           depart: 0,   raideur: 0.5,  amortissement: 1,    actions: [{ image: 0, cible: 100 }], images: 400 },
  { nom: 'amortissement-trop-fort',    depart: 0,   raideur: 0.5,  amortissement: 7,    actions: [{ image: 0, cible: 100 }], images: 400 },
  { nom: 'precision-0.001',            depart: 0,   precision: 0.001, actions: [{ image: 0, cible: 100 }], images: 600 },
  { nom: 'precision-0.5',              depart: 0,   precision: 0.5,   actions: [{ image: 0, cible: 100 }], images: 400 },
  { nom: 'precision-zero-bornee',      depart: 0,   precision: 0,     actions: [{ image: 0, cible: 100 }], images: 600 },
  { nom: 'precision-negative-bornee',  depart: 0,   precision: -3,    actions: [{ image: 0, cible: 100 }], images: 600 },
  { nom: 'precision-nan-bornee',       depart: 0,   precision: NaN,   actions: [{ image: 0, cible: 100 }], images: 600 },
  { nom: 'cible-qui-change-en-route',  depart: 0,   actions: [{ image: 0, cible: 100 }, { image: 15, cible: 40 }, { image: 40, cible: -10 }, { image: 90, cible: 70 }, { image: 91, cible: 70 }], images: 500 },
  { nom: 'cible-change-apres-repos',   depart: 0,   actions: [{ image: 0, cible: 30 }, { image: 250, cible: 60 }], images: 600 },
  { nom: 'cible-identique',            depart: 5,   actions: [{ image: 0, cible: 5 }, { image: 3, cible: 5 }], images: 20 },
  { nom: 'cible-non-finie-ignoree',    depart: 0,   actions: [{ image: 0, cible: 100 }, { image: 5, cible: NaN }, { image: 6, cible: Infinity }, { image: 7, cible: -Infinity }], images: 300 },
  { nom: 'min-max-fixe-la-cible',      depart: 10,  min: 0, max: 50, actions: [{ image: 0, cible: 100 }, { image: 200, cible: -80 }], images: 500 },
  { nom: 'min-max-rabote-le-depassement', depart: 10, raideur: 0.4, amortissement: 0.3, min: 0, max: 12, actions: [{ image: 0, cible: 12 }, { image: 60, cible: 0 }], images: 500 },
  { nom: 'raideur-changee-en-vol',     depart: 0,   actions: [{ image: 0, cible: 100 }, { image: 20, raideur: 0.4 }, { image: 40, amortissement: 0.3 }, { image: 70, raideur: 99 }, { image: 71, amortissement: 0 }], images: 500 },
  { nom: 'precision-changee-en-vol',   depart: 0,   actions: [{ image: 0, cible: 100 }, { image: 30, precision: 0.5 }, { image: 31, precision: 0 }], images: 400 },
  { nom: 'divergence-forcee',          depart: 0,   actions: [{ image: 0, cible: 100 }, { image: 1, brut: ['_mjs_stiffness', 50] }], images: 3000 },
  { nom: 'objet-xy',                   depart: { x: 0, y: 0 }, raideur: 0.3, amortissement: 0.5, actions: [{ image: 0, cible: { x: 100, y: -50 } }], images: 500 },
  { nom: 'objet-change-en-route',      depart: { x: 0, y: 10 }, actions: [{ image: 0, cible: { x: 30, y: 0 } }, { image: 25, cible: { x: -5, y: 80 } }], images: 500 },
  { nom: 'tableau',                    depart: [0, 10, 20], raideur: 0.2, amortissement: 0.7, actions: [{ image: 0, cible: [10, -10, 40] }], images: 500 },
  { nom: 'imbrique',                   depart: { p: { x: 0, y: 0 }, c: [1, 2] , taille: 4 }, actions: [{ image: 0, cible: { p: { x: 40, y: 8 }, c: [5, -2], taille: 9 } }], images: 500 },
  { nom: 'objet-cle-en-plus-a-la-cible', depart: { x: 0 }, actions: [{ image: 0, cible: { x: 20, z: 7 } }], images: 400 },
  { nom: 'objet-cle-absente-de-la-cible', depart: { x: 0, y: 5 }, actions: [{ image: 0, cible: { x: 20 } }], images: 400 },
  { nom: 'tableau-plus-long',          depart: [0, 1], actions: [{ image: 0, cible: [10, 11, 12] }], images: 400 },
  { nom: 'tableau-plus-court',         depart: [0, 1, 2], actions: [{ image: 0, cible: [10, 11] }], images: 400 },
  { nom: 'composante-texte',           depart: { x: 0, label: 'a' }, actions: [{ image: 0, cible: { x: 10, label: 'b' } }], images: 400 },
  { nom: 'nombre-vers-objet',          depart: 5,   actions: [{ image: 0, cible: { x: 10, y: 20 } }], images: 400 },
  { nom: 'objet-vers-nombre',          depart: { x: 5, y: 6 }, actions: [{ image: 0, cible: 30 }], images: 400 },
  { nom: 'objet-vers-tableau',         depart: { x: 5, y: 6 }, actions: [{ image: 0, cible: [1, 2] }], images: 400 },
  { nom: 'tableau-vers-objet',         depart: [5, 6], actions: [{ image: 0, cible: { x: 1, y: 2 } }], images: 400 },
  { nom: 'imbrique-change-de-nature',  depart: { a: { x: 1 }, b: { y: 2 } }, actions: [{ image: 0, cible: { a: [1, 2], b: 7 } }], images: 400 },
  { nom: 'composite-non-fini-ignore',  depart: { x: 0 }, actions: [{ image: 0, cible: { x: NaN } }, { image: 1, cible: { x: 10 } }], images: 400 },
  { nom: 'nombre-seul-sans-min-max-nul', depart: 0, min: 0, actions: [{ image: 0, cible: -5 }], images: 20 }
]

export function jouerScenario(s: Scenario) {
  const { mu, avertissements } = chargerRessort()
  const r = mu.spring(s.depart, s.raideur === undefined ? undefined : s.raideur, s.amortissement === undefined ? undefined : s.amortissement, s.min === undefined ? null : s.min, s.max === undefined ? null : s.max)
  if(s.precision !== undefined) r.precision = s.precision
  const proprietaires: any[] = [{}, { _mjs_dead: true }]
  const notifs = [0, 0]
  proprietaires.forEach(function(o, i) { r._mjs_attachInvalidator(o, function() { notifs[i]++ }) })
  const images: any[] = []
  const depart = { raideur: nombre(r.stiffness), amortissement: nombre(r.damping), precision: nombre(r.precision), courant: aplatir(r.current), vitesse: aplatir(r.velocity), cible: aplatir(r.target) }
  for(let i = 0; i < s.images; i++) {
    for(const a of s.actions) {
      if(a.image !== i) continue;
      if('cible' in a) r.value = a.cible;
      if('raideur' in a) r.stiffness = a.raideur;
      if('amortissement' in a) r.damping = a.amortissement;
      if('precision' in a) r.precision = a.precision;
      if(a.brut) r[a.brut[0]] = a.brut[1];
    }
    const vivant = r._mjs_step()
    images.push([i, vivant, aplatir(r.current), aplatir(r.velocity), nombre(r.stiffness), nombre(r.damping), notifs[0]])
    // plus rien à jouer : on note quelques images de repos puis on s'arrête, sauf si une action reste à venir
    const encore = s.actions.some(function(a) { return a.image > i })
    if(!vivant && !encore) break;
  }
  return { depart, images, cible: aplatir(r.target), ajoutsTicker: mu.Ticker.ajouts, avertissements, proprietaireMortPurge: r._mjs_invalidators.size }
}

export function tableRessort() {
  const sortie: any = {}
  for(const s of SCENARIOS) sortie[s.nom] = jouerScenario(s)
  return sortie
}
