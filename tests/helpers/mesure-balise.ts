// happy-dom ne fait aucune mise en page : un test donne à une balise la boîte qu'il veut. Le cadre
// interroge la balise par le prototype (jamais par un champ posé sur l'élément, qui serait la méthode
// d'un composant de l'auteur) : la boîte se donne donc par le prototype, une table élément → boîte,
// installée une fois par fenêtre ; les autres balises gardent la mesure de happy-dom.
// Ce prototype est partagé par toutes les fenêtres de happy-dom, donc par tous les tests et tous les fichiers du
// processus : il est rendu tel qu'il était à la fin de chaque test (crochet en bas de ce fichier), la boîte d'un test
// n'est jamais celle du suivant. Une fenêtre qui sert à plusieurs tests reçoit la table de nouveau au premier appel.

const tables    = new WeakMap<object, WeakMap<object, () => any>>()
const installes: Array<{ window: any, proto: any, avant: PropertyDescriptor | undefined }> = []

export function mesurer(window: any, el: any, rect: () => any) {
  let table = tables.get(window)
  if (!table) {
    const posees = new WeakMap<object, () => any>()
    const proto  = window.Element.prototype
    const natif  = proto.getBoundingClientRect
    installes.push({ window, proto, avant: Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect') })
    proto.getBoundingClientRect = function (this: any, ...args: any[]) {
      const f = posees.get(this)
      return f ? f.call(this) : natif.apply(this, args)
    }
    tables.set(window, posees)
    table = posees
  }
  table.set(el, rect)
}

// le prototype comme avant la première boîte, dans l'ordre inverse des poses
export function rendreMesures() {
  while (installes.length) {
    const { window, proto, avant } = installes.pop()!
    if (avant) Object.defineProperty(proto, 'getBoundingClientRect', avant)
    else delete proto.getBoundingClientRect
    tables.delete(window)
  }
}

// crochet racine : tourne après chaque test de chaque fichier qui charge cette aide, échec compris
afterEach(rendreMesures)
