/**
 * Photos of skilled workers, served from /public/images as compressed WebP (about 30 KB
 * each, 7 KB for the small ones). They are illustrations, not real GADMO Pros. When a
 * photo is replaced, give the file a new name (-v2): the service worker caches by name.
 */
export interface Photo {
  src: string;
  small: string;
  alt: string;
  trade: string;
}

const photo = (name: string, trade: string, alt: string): Photo => ({
  src: `/images/${name}-v1.webp`,
  small: `/images/${name}-v1-sm.webp`,
  alt,
  trade,
});

export const PHOTOS = {
  mechanic: photo('mechanic', 'Mechanic', 'A smiling mechanic working on a car engine'),
  tailor: photo('tailor', 'Tailor', 'A tailor at his sewing machine with Ankara fabric'),
  electrician: photo('electrician', 'Electrician', 'An electrician wiring a socket box'),
  hairstylist: photo('hairstylist', 'Hairstylist', 'A hairstylist braiding a client’s hair'),
  baker: photo('baker', 'Baker', 'A baker kneading dough beside fresh loaves'),
  plumber: photo('plumber', 'Plumber', 'A plumber fixing the pipe under a sink'),
  developer: photo('developer', 'Web developer', 'A web developer at her laptop'),
} satisfies Record<string, Photo>;

/** The faces on the home page hero, in order. */
export const HERO_PHOTOS: Photo[] = [
  PHOTOS.electrician,
  PHOTOS.hairstylist,
  PHOTOS.mechanic,
  PHOTOS.baker,
  PHOTOS.tailor,
];

/** The "Become a Pro" section's photo. */
export const PRO_IMAGE: Photo = PHOTOS.plumber;
