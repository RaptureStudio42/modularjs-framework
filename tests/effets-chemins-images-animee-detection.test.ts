// reconnaître une image animée sans la décoder : un GIF de plusieurs images, un WebP animé, un PNG animé (APNG), un AVIF
// animé. Les images fixes (même format) et tout fichier illisible ne sont jamais prises pour des animations, et rien ne lève.

import assert from 'node:assert/strict'
import { animatedKind } from '../src/bundler/image.js'
import { gifAnime, webpAnime, webpFixe, apngAnime, apngTardif, pngFixe, avifAnime, avifFixe } from './helpers/gif-anime.js'

describe('animatedKind — l\'animation d\'une image, lue dans ses octets', () => {
  it('un GIF d\'une seule image est fixe, un GIF de deux images ou plus est animé', () => {
    assert.equal(animatedKind(gifAnime(1)), null)
    assert.equal(animatedKind(gifAnime(2)), 'gif')
    assert.equal(animatedKind(gifAnime(5, 40, 3)), 'gif')
  })

  it('un GIF dont les images portent chacune leur table de couleurs locale (tailles de 4 à 256 couleurs) : sauter la table, pas ses octets', () => {
    for (const locale of [1, 2, 3, 5, 7]) {
      assert.equal(animatedKind(gifAnime(2, 8, 8, 10, locale)), 'gif', 'deux images, table locale de taille ' + locale)
      assert.equal(animatedKind(gifAnime(1, 8, 8, 10, locale)), null, 'une image, table locale de taille ' + locale)
    }
  })

  it('un PNG dont le bloc acTL arrive après les données de l\'image n\'est pas animé', () => {
    assert.equal(animatedKind(apngTardif()), null)
  })

  it('un WebP animé est reconnu, un WebP fixe (même étendu) non', () => {
    assert.equal(animatedKind(webpAnime()), 'webp')
    assert.equal(animatedKind(webpFixe()), null)
  })

  it('un PNG animé (bloc acTL avant les données) est reconnu, un PNG fixe non', () => {
    assert.equal(animatedKind(apngAnime()), 'apng')
    assert.equal(animatedKind(pngFixe()), null)
  })

  it('un AVIF qui annonce une suite d\'images (marque avis) est reconnu, un AVIF fixe non', () => {
    assert.equal(animatedKind(avifAnime()), 'avif')
    assert.equal(animatedKind(avifFixe()), null)
  })

  it('un fichier tronqué, vide ou qui n\'est pas une image : null, sans lever', () => {
    const gif = gifAnime(3)
    for (const n of [0, 1, 5, 6, 12, 13, 14, 20, 40, gif.length - 1]) assert.equal(animatedKind(gif.subarray(0, n)), n === gif.length - 1 ? 'gif' : null, 'GIF coupé à ' + n)
    for (const buf of [Buffer.alloc(0), Buffer.from('GIF89a'), Buffer.from('RIFF'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.alloc(64, 7), apngAnime().subarray(0, 20), avifAnime().subarray(0, 10)]) {
      assert.doesNotThrow(() => animatedKind(buf))
    }
    assert.equal(animatedKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
    assert.equal(animatedKind(Buffer.alloc(64, 7)), null)
  })

  it('un bloc annoncé plus long que le fichier ne fait pas lire au-delà (GIF, PNG)', () => {
    // le premier bloc de données de la première image annonce 255 octets, le fichier n'en a pas autant
    const gif = Buffer.from(gifAnime(3))
    gif[63] = 255
    assert.equal(animatedKind(gif), null)
    // un bloc PNG de type inconnu qui annonce deux milliards d'octets
    const png = Buffer.from(pngFixe())
    png.writeUInt32BE(0x7fffffff, 33)
    png.write('tEXt', 37, 'latin1')
    assert.equal(animatedKind(png), null)
  })
})
