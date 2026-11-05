/**
 * GADMO launch catalogue — the single source for service categories.
 *
 * inspection:
 *   R = REQUIRED  the Pro visits first; the customer pays an agreed inspection fee (max ₦5,000)
 *   O = OPTIONAL  the Pro may ask for an inspection if they need to see the work first
 *   N = NONE      no inspection fee: tech, lessons, beauty, events and businesses quote directly
 * emergency: can be requested as an urgent "come now" job
 * licence:   regulated work; a professional licence is checked during verification
 */
export type InspectionCode = 'R' | 'O' | 'N';

export interface CategorySeed {
  slug: string;
  name: string;
  inspection: InspectionCode;
  emergency?: boolean;
  licence?: boolean;
}

export interface GroupSeed {
  slug: string;
  name: string;
  categories: CategorySeed[];
}

const c = (
  slug: string,
  name: string,
  inspection: InspectionCode,
  flags: { emergency?: boolean; licence?: boolean } = {},
): CategorySeed => ({ slug, name, inspection, ...flags });

const E = { emergency: true };
const L = { licence: true };

export const CATALOGUE: GroupSeed[] = [
  {
    slug: 'home-repairs',
    name: 'Home repairs & installation',
    categories: [
      c('electrician', 'Electrician', 'R', E),
      c('plumber', 'Plumber', 'R', E),
      c('locksmith', 'Locksmith', 'R', E),
      c('generator-repair', 'Generator repair', 'R', E),
      c('carpenter', 'Carpenter', 'R'),
      c('painter', 'Painter', 'R'),
      c('tiler', 'Tiler', 'R'),
      c('bricklayer', 'Bricklayer & mason', 'R'),
      c('welder', 'Welder & fabricator', 'R'),
      c('roofer', 'Roofer', 'R'),
      c('pop-ceiling', 'POP ceiling installer', 'R'),
      c('aluminium-works', 'Aluminium windows & doors', 'R'),
      c('glazier', 'Glass & glazier', 'R'),
      c('ac-refrigerator-repair', 'AC & refrigerator repair', 'R'),
      c('home-appliance-repair', 'Home appliance repair (washing machine, cooker)', 'R'),
      c('solar-inverter', 'Solar & inverter installer', 'R'),
      c('borehole-pump', 'Borehole & water pump', 'R'),
      c('cctv-security', 'CCTV & security systems', 'R'),
      c('satellite-tv', 'Satellite TV installer', 'R'),
      c('furniture-upholstery', 'Furniture & upholstery repair', 'R'),
      c('fumigation', 'Fumigation & pest control', 'R'),
      c('septic-tank', 'Septic tank evacuation', 'R'),
      c('interior-decorator', 'Interior decorator', 'O'),
      c('gardener', 'Gardener & landscaping', 'O'),
    ],
  },
  {
    slug: 'auto',
    name: 'Auto & roadside',
    categories: [
      c('auto-mechanic', 'Auto mechanic', 'R', E),
      c('auto-electrician', 'Auto electrician', 'R', E),
      c('vulcanizer', 'Vulcanizer (tyre repair)', 'R', E),
      c('motorcycle-mechanic', 'Motorcycle & keke mechanic', 'R', E),
      c('towing', 'Towing & recovery', 'N', E),
      c('panel-beater', 'Panel beater & spray painter', 'R'),
      c('car-ac-repair', 'Car AC repair', 'R'),
      c('car-wash', 'Car wash & detailing', 'N'),
      c('driver', 'Driver for hire', 'N'),
    ],
  },
  {
    slug: 'cleaning-household',
    name: 'Cleaning & household',
    categories: [
      c('house-cleaner', 'House cleaner', 'O'),
      c('deep-cleaning', 'Post-construction & deep cleaning', 'O'),
      c('rug-upholstery-cleaning', 'Rug & upholstery cleaning', 'O'),
      c('laundry', 'Laundry & dry cleaning', 'N'),
      c('nanny', 'Nanny & babysitter', 'N'),
      c('housekeeper', 'Housekeeper', 'N'),
      c('private-chef', 'Cook & private chef', 'N'),
      c('elderly-caregiver', 'Elderly caregiver', 'N'),
    ],
  },
  {
    slug: 'fashion-beauty',
    name: 'Fashion & beauty',
    categories: [
      c('tailor', 'Tailor & fashion designer', 'N'),
      c('hairstylist', 'Hairstylist', 'N'),
      c('barber', 'Barber', 'N'),
      c('makeup-artist', 'Makeup artist', 'N'),
      c('nail-technician', 'Nail technician', 'N'),
      c('lash-brow-technician', 'Lash & brow technician', 'N'),
      c('gele-stylist', 'Gele & headtie stylist', 'N'),
      c('cobbler', 'Shoemaker & cobbler', 'N'),
      c('massage-spa', 'Massage & spa therapist', 'N'),
    ],
  },
  {
    slug: 'events',
    name: 'Events & entertainment',
    categories: [
      c('event-planner', 'Event planner', 'N'),
      c('event-decorator', 'Event decorator', 'N'),
      c('caterer', 'Caterer', 'N'),
      c('small-chops', 'Small chops & drinks', 'N'),
      c('photographer', 'Photographer', 'N'),
      c('videographer', 'Videographer', 'N'),
      c('dj', 'DJ', 'N'),
      c('mc', 'MC & compere', 'N'),
      c('live-band', 'Live band & musicians', 'N'),
      c('ushers', 'Ushers & event staff', 'N'),
    ],
  },
  {
    slug: 'tech-digital',
    name: 'Tech & digital',
    categories: [
      c('phone-repair', 'Phone & tablet repair', 'N'),
      c('computer-repair', 'Computer & laptop repair', 'N'),
      c('electronics-repair', 'TV & electronics repair', 'N'),
      c('printer-repair', 'Printer & photocopier repair', 'N'),
      c('pos-repair', 'POS terminal repair', 'N'),
      c('it-support', 'IT support & networking', 'N'),
      c('web-developer', 'Website developer', 'N'),
      c('app-developer', 'Mobile app developer', 'N'),
      c('software-developer', 'Software developer', 'N'),
      c('graphic-designer', 'Graphic designer', 'N'),
      c('ui-ux-designer', 'UI/UX designer', 'N'),
      c('social-media-manager', 'Social media manager', 'N'),
      c('digital-marketer', 'Digital marketing & SEO', 'N'),
      c('video-editor', 'Video editor & animator', 'N'),
      c('content-writer', 'Content writer & copywriter', 'N'),
      c('data-analyst', 'Data analyst', 'N'),
      c('cybersecurity', 'Cybersecurity consultant', 'N'),
      c('tech-trainer', 'Computer & coding trainer', 'N'),
    ],
  },
  {
    slug: 'lessons',
    name: 'Lessons & tutoring',
    categories: [
      c('home-tutor', 'Home tutor', 'N'),
      c('exam-prep', 'WAEC, NECO & JAMB preparation', 'N'),
      c('music-teacher', 'Music teacher', 'N'),
      c('language-tutor', 'Language tutor (Yoruba, French and more)', 'N'),
      c('driving-instructor', 'Driving instructor', 'N'),
      c('swimming-instructor', 'Swimming instructor', 'N'),
    ],
  },
  {
    slug: 'professional',
    name: 'Professional services',
    categories: [
      c('accountant', 'Accountant & bookkeeper', 'N'),
      c('tax-consultant', 'Tax consultant', 'N'),
      c('business-registration', 'CAC & business registration agent', 'N'),
      c('business-consultant', 'Business consultant', 'N'),
      c('translator', 'Translator & interpreter', 'N'),
      c('estate-agent', 'Estate agent', 'N'),
      c('lawyer', 'Lawyer', 'N', L),
      c('architect', 'Architect', 'O', L),
      c('land-surveyor', 'Land surveyor', 'O', L),
      c('structural-engineer', 'Structural engineer', 'O', L),
    ],
  },
  {
    slug: 'health-fitness',
    name: 'Health & fitness',
    categories: [
      c('fitness-trainer', 'Fitness trainer', 'N'),
      c('physiotherapist', 'Physiotherapist', 'N', L),
      c('home-nurse', 'Home nurse', 'N', L),
      c('dietitian', 'Dietitian & nutritionist', 'N', L),
    ],
  },
  {
    slug: 'business-rentals',
    name: 'Businesses & rentals',
    categories: [
      c('baker', 'Baker & cakes', 'N'),
      c('event-hall', 'Event hall rental', 'N'),
      c('canopy-chairs-rental', 'Canopy, chairs & tables rental', 'N'),
      c('sound-pa-rental', 'Sound & PA rental', 'N'),
      c('generator-rental', 'Generator rental', 'N'),
      c('car-rental', 'Car & bus rental', 'N'),
      c('truck-hire', 'Truck & van hire', 'N'),
      c('printing-branding', 'Printing & branding', 'N'),
      c('water-supply', 'Water tanker supply', 'N'),
      c('cooking-gas', 'Cooking gas refill & delivery', 'N'),
      c('tractor-hire', 'Tractor & farm equipment hire', 'N'),
    ],
  },
  {
    slug: 'moving-errands',
    name: 'Moving & errands',
    categories: [
      c('movers', 'Movers & packers', 'O'),
      c('dispatch-rider', 'Dispatch rider', 'N'),
      c('errand-runner', 'Errand runner', 'N'),
    ],
  },
  {
    slug: 'farming',
    name: 'Farming & agriculture',
    categories: [
      c('farm-hand', 'Farm hand & labourer', 'N'),
      c('veterinary-doctor', 'Veterinary doctor', 'N', L),
      c('poultry-consultant', 'Poultry consultant', 'N'),
      c('fish-farming-consultant', 'Fish farming consultant', 'N'),
      c('agronomist', 'Agronomist & crop consultant', 'N'),
    ],
  },
];

/**
 * Related skills: a Pro with any skill in a set can also be matched to requests for the
 * others in that set (customers see them on "Choose a Pro"; emergencies go to the nearest
 * online Pro with the exact or a related skill). Hand-picked by the founder's rule that a
 * related Pro must plausibly be able to do the job. A skill can appear in several sets.
 */
export const RELATED: string[][] = [
  // Home repairs
  ['electrician', 'generator-repair', 'solar-inverter', 'cctv-security', 'satellite-tv'],
  ['electrician', 'ac-refrigerator-repair', 'home-appliance-repair'],
  ['plumber', 'borehole-pump', 'septic-tank'],
  ['carpenter', 'furniture-upholstery'],
  ['carpenter', 'roofer', 'pop-ceiling'],
  ['carpenter', 'locksmith'],
  ['aluminium-works', 'glazier', 'welder'],
  ['bricklayer', 'tiler'],
  ['painter', 'pop-ceiling', 'interior-decorator'],
  ['ac-refrigerator-repair', 'car-ac-repair'],
  ['gardener', 'farm-hand'],
  // Auto
  ['auto-mechanic', 'auto-electrician', 'motorcycle-mechanic', 'car-ac-repair'],
  ['auto-mechanic', 'towing'],
  ['driver', 'car-rental', 'driving-instructor'],
  // Cleaning and household
  ['house-cleaner', 'deep-cleaning', 'housekeeper', 'rug-upholstery-cleaning'],
  ['laundry', 'housekeeper'],
  ['nanny', 'housekeeper'],
  ['private-chef', 'caterer'],
  ['elderly-caregiver', 'home-nurse'],
  // Fashion and beauty
  ['hairstylist', 'barber'],
  ['makeup-artist', 'gele-stylist', 'lash-brow-technician'],
  ['nail-technician', 'lash-brow-technician'],
  // Events
  ['event-planner', 'event-decorator', 'ushers'],
  ['caterer', 'small-chops', 'baker'],
  ['photographer', 'videographer', 'video-editor'],
  ['dj', 'mc', 'live-band', 'sound-pa-rental'],
  ['event-hall', 'canopy-chairs-rental', 'event-decorator'],
  // Tech
  ['phone-repair', 'computer-repair', 'electronics-repair'],
  ['computer-repair', 'printer-repair', 'pos-repair'],
  ['computer-repair', 'it-support', 'cybersecurity'],
  ['electronics-repair', 'satellite-tv'],
  ['web-developer', 'app-developer', 'software-developer'],
  ['software-developer', 'data-analyst'],
  ['graphic-designer', 'ui-ux-designer', 'printing-branding'],
  ['social-media-manager', 'digital-marketer', 'content-writer'],
  ['it-support', 'tech-trainer'],
  // Lessons
  ['home-tutor', 'exam-prep', 'language-tutor'],
  ['music-teacher', 'live-band'],
  // Professional
  ['accountant', 'tax-consultant'],
  ['business-registration', 'business-consultant', 'lawyer'],
  ['estate-agent', 'land-surveyor'],
  ['architect', 'structural-engineer', 'land-surveyor'],
  ['translator', 'language-tutor'],
  // Health
  ['fitness-trainer', 'dietitian'],
  ['physiotherapist', 'home-nurse'],
  // Businesses, moving, farming
  ['generator-rental', 'generator-repair'],
  ['car-rental', 'truck-hire'],
  ['truck-hire', 'movers'],
  ['water-supply', 'borehole-pump'],
  ['tractor-hire', 'farm-hand'],
  ['dispatch-rider', 'errand-runner'],
  ['veterinary-doctor', 'poultry-consultant'],
  ['poultry-consultant', 'fish-farming-consultant', 'agronomist'],
];

/** The skills related to these (not including them). */
export function relatedSlugs(slugs: Iterable<string>): string[] {
  const mine = new Set(slugs);
  const out = new Set<string>();
  for (const set of RELATED) {
    if (set.some((s) => mine.has(s))) for (const s of set) if (!mine.has(s)) out.add(s);
  }
  return [...out];
}

export const INSPECTION_POLICY = { R: 'REQUIRED', O: 'OPTIONAL', N: 'NONE' } as const;
