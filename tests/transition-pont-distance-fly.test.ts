// le pont des réglages (mjs_fx_transition.ts) traduit la direction et la distance de *fly en déplacements x et y pour l'animation : la distance se lit avec la lecture
// de longueur de fly (shared/len.ts), qui part avec elle, et non avec une seconde lecture « valeur + unité » écrite dans le pont
// la table est celle que donnait le pont avant qu'il partage la lecture : directions et distances lisibles (nombres, px, %, em, rem, vw, vh), rien (40 px)
// une distance qui ne se lit pas, ou dont l'unité n'est pas l'une de celles-là, vaut le défaut (40 px) comme avant : le pont la refuse avant de la lire, la lecture reste celle de fly

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chargerAnimation } from './helpers/charger-animation.js'

const RUNTIME = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'runtime')

// direction, distance écrite (undefined : non écrite), x et y rendus
const TABLE: [string | number, string | number | undefined, string, string][] = [
    ["up", undefined, "0px", "40px"],
    ["up", 0, "0px", "0px"],
    ["up", 10, "0px", "10px"],
    ["up", 40, "0px", "40px"],
    ["up", 120, "0px", "120px"],
    ["up", 200.5, "0px", "200.5px"],
    ["up", "10%", "0%", "10%"],
    ["up", "5vw", "0vw", "5vw"],
    ["up", "2em", "0em", "2em"],
    ["up", "1.5rem", "0rem", "1.5rem"],
    ["up", "-30px", "0px", "-30px"],
    ["up", ".5em", "0em", "0.5em"],
    ["up", "12", "0px", "12px"],
    ["up", "33vh", "0vh", "33vh"],
    ["down-left", undefined, "28.28px", "-28.28px"],
    ["down-left", 0, "0px", "0px"],
    ["down-left", 10, "7.07px", "-7.07px"],
    ["down-left", 40, "28.28px", "-28.28px"],
    ["down-left", 120, "84.85px", "-84.85px"],
    ["down-left", 200.5, "141.77px", "-141.77px"],
    ["down-left", "10%", "7.07%", "-7.07%"],
    ["down-left", "5vw", "3.54vw", "-3.54vw"],
    ["down-left", "2em", "1.41em", "-1.41em"],
    ["down-left", "1.5rem", "1.06rem", "-1.06rem"],
    ["down-left", "-30px", "-21.21px", "21.21px"],
    ["down-left", ".5em", "0.35em", "-0.35em"],
    ["down-left", "12", "8.49px", "-8.49px"],
    ["down-left", "33vh", "23.33vh", "-23.33vh"],
    [45, undefined, "-28.28px", "28.28px"],
    [45, 0, "0px", "0px"],
    [45, 10, "-7.07px", "7.07px"],
    [45, 40, "-28.28px", "28.28px"],
    [45, 120, "-84.85px", "84.85px"],
    [45, 200.5, "-141.77px", "141.77px"],
    [45, "10%", "-7.07%", "7.07%"],
    [45, "5vw", "-3.54vw", "3.54vw"],
    [45, "2em", "-1.41em", "1.41em"],
    [45, "1.5rem", "-1.06rem", "1.06rem"],
    [45, "-30px", "21.21px", "-21.21px"],
    [45, ".5em", "-0.35em", "0.35em"],
    [45, "12", "-8.49px", "8.49px"],
    [45, "33vh", "-23.33vh", "23.33vh"],
    [90, undefined, "-40px", "0px"],
    [90, 0, "0px", "0px"],
    [90, 10, "-10px", "0px"],
    [90, 40, "-40px", "0px"],
    [90, 120, "-120px", "0px"],
    [90, 200.5, "-200.5px", "0px"],
    [90, "10%", "-10%", "0%"],
    [90, "5vw", "-5vw", "0vw"],
    [90, "2em", "-2em", "0em"],
    [90, "1.5rem", "-1.5rem", "0rem"],
    [90, "-30px", "30px", "0px"],
    [90, ".5em", "-0.5em", "0em"],
    [90, "12", "-12px", "0px"],
    [90, "33vh", "-33vh", "0vh"],
    ["right", undefined, "-40px", "0px"],
    ["right", 0, "0px", "0px"],
    ["right", 10, "-10px", "0px"],
    ["right", 40, "-40px", "0px"],
    ["right", 120, "-120px", "0px"],
    ["right", 200.5, "-200.5px", "0px"],
    ["right", "10%", "-10%", "0%"],
    ["right", "5vw", "-5vw", "0vw"],
    ["right", "2em", "-2em", "0em"],
    ["right", "1.5rem", "-1.5rem", "0rem"],
    ["right", "-30px", "30px", "0px"],
    ["right", ".5em", "-0.5em", "0em"],
    ["right", "12", "-12px", "0px"],
    ["right", "33vh", "-33vh", "0vh"]
]

// ce qu'une variable peut porter : une distance qui ne se lit pas, ou dont l'unité n'est ni px, ni %, ni em, ni rem, ni vw, ni vh
const ILLISIBLES: any[] = ['abc', '', ' ', 'auto', 'NaN', 'Infinity', '--5', '1.2.3', '.', '-', '5.', '+5', '10pt', '5cm', '2ch', '3vmin', '10PX', ' 10', '10 ', '10 px', '1e3', '12px;', '10%%', true, false, null, {}, []]

// la distance par défaut (40 px), pour chaque direction essayée
const DEFAUT: Record<string, [string, string]> = { up: ['0px', '40px'], right: ['-40px', '0px'], '45': ['-28.28px', '28.28px'] }

// direction, distance écrite, x et y rendus : des distances lisibles aux formes limites (zéros, zéros de tête)
const LIMITES: [string | number, string, string, string][] = [
  ['up', '0', '0px', '0px'], ['right', '0', '0px', '0px'], [45, '0', '0px', '0px'], ['up', '0px', '0px', '0px'], ['up', '0%', '0%', '0%'], ['right', '0%', '0%', '0%'],
  ['up', '-0', '0px', '0px'], ['up', '00', '0px', '0px'], ['up', '007', '0px', '7px'], ['right', '007', '-7px', '0px'], [45, '007', '-4.95px', '4.95px']
]

function monter() {
  const µ: any = {}
  new Function('µ', readFileSync(join(RUNTIME, 'mjs_fx.ts'), 'utf-8') + '\n' + readFileSync(join(RUNTIME, 'mjs_fx_transition.ts'), 'utf-8'))(µ)
  chargerAnimation('fly', µ)
  return µ
}

describe('pont de *fly : direction et distance', function () {
  it(`${TABLE.length} directions et distances donnent les mêmes déplacements qu'avant`, () => {
    const µ = monter()
    for (const [direction, distance, x, y] of TABLE) {
      const reglages: any = { direction }
      if (distance !== undefined) reglages.distance = distance
      const o = µ._mjs_fxAnimOpts('fly', reglages)
      assert.deepEqual([o.x, o.y], [x, y], `direction ${JSON.stringify(direction)}, distance ${JSON.stringify(distance)}`)
    }
  })

  it('la distance se lit avec la lecture de longueur de fly, une seule : celle de l\'animation', () => {
    const µ = monter()
    const lues: any[] = []
    const lecture = µ._mjs_animLen
    µ._mjs_animLen = (v: any) => { lues.push(v); return lecture(v) }
    µ._mjs_fxAnimOpts('fly', { direction: 'up', distance: '10%' })
    µ._mjs_fxAnimOpts('fly', { direction: 'up' })
    µ._mjs_fxAnimOpts('fly', { direction: 'up', distance: 'abc' })
    µ._mjs_fxAnimOpts('fly', { direction: 'up', distance: '10pt' })
    assert.deepEqual(lues, ['10%', 40, 40, 40], 'la distance écrite, puis le défaut (40) quand elle n\'est pas écrite ou qu\'elle ne se lit pas')
  })

  it('une distance illisible, ou d\'une unité inconnue (une variable peut la porter, le build ne la voit pas), vaut le défaut de 40 px comme avant', () => {
    const µ = monter()
    for (const valeur of ILLISIBLES) {
      for (const direction of ['up', 'right', 45]) {
        const o = µ._mjs_fxAnimOpts('fly', { direction, distance: valeur })
        assert.deepEqual([o.x, o.y], DEFAUT[String(direction)], `direction ${JSON.stringify(direction)}, distance ${JSON.stringify(valeur)}`)
      }
    }
  })

  it('les distances lisibles aux formes limites (zéro, zéros de tête) restent ce qu\'elles sont : le défaut ne remplace que ce qui ne se lit pas', () => {
    const µ = monter()
    for (const [direction, distance, x, y] of LIMITES) {
      const o = µ._mjs_fxAnimOpts('fly', { direction, distance })
      assert.deepEqual([o.x, o.y], [x, y], `direction ${JSON.stringify(direction)}, distance ${JSON.stringify(distance)}`)
    }
  })
})
