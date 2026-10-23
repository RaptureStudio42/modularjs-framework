// attendre des IMAGES dessinées, pas une durée, avant de lire la page — pour les tests en navigateur réel.
// WebKit ne recalcule le style d'une animation, ne livre un défilement, un changement de taille (ResizeObserver) ni une
// visibilité (IntersectionObserver) qu'en dessinant une image ; sous charge il peut rester plusieurs secondes sans en
// dessiner, et une lecture faite entre-temps rend l'état de la dernière image dessinée : une lettre encore cachée alors que
// son animation se dit finie, une avancée d'avant le défilement, un double à l'ancienne taille, un trait tracé pour la boîte
// d'avant. Une pause de 300 ms passe aussi sans image : seules deux images de suite prouvent que ce que la page devait
// recalculer l'a été. Le plafond (8 s) évite de rester suspendu à une page qui ne dessinera plus.

// dans la page : deux images dessinées (deux requestAnimationFrame de suite) ou le plafond ; rend le temps attendu, en ms
export const deuxImagesDansLaPage = (plafond = 8000) => {
  const debut = performance.now()
  return Promise.race([new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))), new Promise((ok) => setTimeout(ok, plafond))]).then(() => Math.round(performance.now() - debut))
}

// côté test : attend deux images dessinées dans la page
export const deuxImages = (page: any, plafond?: number): Promise<number> => page.evaluate(deuxImagesDansLaPage, plafond)

// pour le code qui tourne DANS la page (un parcours évalué d'un bloc) : posée avant lui, `window.deuxImages(plafond?)` y existe
export const poseDeuxImages = (page: any) => page.addInitScript(`window.deuxImages = ${deuxImagesDansLaPage}`)
