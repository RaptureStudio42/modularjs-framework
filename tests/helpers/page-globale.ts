// pose sur globalThis les globales d'une page (fenêtre happy-dom) le temps d'un test, ou les retire le temps d'un test « sans
// navigateur », et rend la fonction qui les remet telles qu'elles étaient (absentes : retirées) : un fichier de tests ne laisse
// jamais sa page aux fichiers joués après lui dans le même processus

type Rendre = () => void

function retenir(noms: string[]): Rendre {
  const g: any = globalThis
  const avant  = noms.map((k) => [k, Object.getOwnPropertyDescriptor(g, k)] as const)
  return () => {
    for (const [k, d] of avant) {
      if (d) Object.defineProperty(g, k, d)
      else delete g[k]
    }
  }
}

// `siAbsentes` : ne pose que ce qui manque (une page posée par un autre fichier du processus reste la sienne)
export function poserPage(valeurs: Record<string, unknown>, siAbsentes = false): Rendre {
  const g: any = globalThis
  const rendre = retenir(Object.keys(valeurs))
  for (const [k, v] of Object.entries(valeurs)) {
    if (!siAbsentes || g[k] === undefined) g[k] = v
  }
  return rendre
}

export function retirerPage(noms: string[]): Rendre {
  const g: any = globalThis
  const rendre = retenir(noms)
  for (const k of noms) delete g[k]
  return rendre
}
