/* ==========================================================================
   MegaFauna Care
   Report an animal in need, keep records for the community animals you look
   after, and log feeding rounds. Everything is saved on this device only:
   records in localStorage, photos in IndexedDB.
   ========================================================================== */

(function () {
  'use strict';

  /* Settings for the foundation ------------------------------------------ */

  const CONFIG = {
    orgName: 'Megafauna Welfare Foundation',
    shortName: 'MegaFauna',
    // TODO: the foundation's WhatsApp number with the country code, digits
    // only (for example '919876543210'). Reports then open in that chat.
    // While it is empty, people choose who to send the report to.
    whatsappNumber: '',
    // TODO: the foundation's public email address. When it is set, reports
    // also get an "Email" button.
    email: '',
    donateUrl: 'https://give.do/ngos/megafauna-welfare-foundation',
    websiteUrl: '../',
    policeNumber: '112',
  };

  // Set by the single-file preview build, where the host page handles the
  // theme and file downloads, and service workers aren't available.
  const PREVIEW = Boolean(window.MWF_PREVIEW);
  const STORE_KEY = 'megafauna-care';
  const BACKUP_APP = 'megafauna-care';
  const VERSION = 1;

  /* What the app knows about --------------------------------------------- */

  const SPECIES = {
    dog: { label: 'Dog', plural: 'Dogs', young: 'Puppy' },
    cat: { label: 'Cat', plural: 'Cats', young: 'Kitten' },
    cattle: { label: 'Cow or bull', plural: 'Cattle', young: 'Calf' },
    other: { label: 'Other', plural: 'Others', young: 'Young' },
  };

  const SEXES = { female: 'Female', male: 'Male', unknown: 'Not sure' };
  const AGES = { young: 'Young', adult: 'Adult', senior: 'Senior', unknown: 'Not sure' };
  const STERILISED = { yes: 'Yes', no: 'No', unknown: 'Not sure' };

  // active: still needs regular care, so it counts towards reminders
  const STATUSES = {
    street: { label: 'Lives on the street', tone: '', active: true },
    treatment: { label: 'In treatment', tone: 'info', active: true },
    shelter: { label: 'In a shelter or foster home', tone: '', active: true },
    adopted: { label: 'Adopted', tone: 'good', active: false },
    missing: { label: 'Missing', tone: 'warn', active: false },
    died: { label: 'Passed away', tone: '', active: false },
  };

  // months: how often it is usually repeated. soon: days of warning before
  // it falls due.
  const RECORD_TYPES = {
    rabies: { label: 'Anti-rabies vaccine', short: 'Rabies vaccine', icon: 'syringe', months: 12, soon: 30, hint: 'Clinic or drive, vaccine name, batch number' },
    vaccine: { label: 'Other vaccine', short: 'Other vaccine', icon: 'syringe', months: 12, soon: 30, hint: 'For example DHPPi for dogs, or a combination vaccine for cats' },
    sterilised: { label: 'Sterilisation', short: 'Sterilisation', icon: 'ear', months: 0, soon: 0, hint: 'Where it was done, and whether the ear was notched' },
    deworm: { label: 'Deworming', short: 'Deworming', icon: 'pill', months: 3, soon: 14, hint: 'Medicine and dose' },
    ticks: { label: 'Tick and flea treatment', short: 'Ticks and fleas', icon: 'bug', months: 1, soon: 7, hint: 'Product used' },
    treatment: { label: 'Vet visit or treatment', short: 'Vet visit', icon: 'vet', months: 0, soon: 0, hint: 'What the vet found and what was given' },
    injury: { label: 'Injury or illness', short: 'Injury or illness', icon: 'bandage', months: 0, soon: 0, hint: 'What happened and where the wound is' },
    collar: { label: 'Reflective collar fitted', short: 'Reflective collar', icon: 'collar', months: 0, soon: 0, hint: 'Colour of the collar' },
    note: { label: 'Note', short: 'Note', icon: 'note', months: 0, soon: 0, hint: 'Anything worth remembering' },
  };
  const DUE_TYPES = ['rabies', 'vaccine', 'deworm', 'ticks'];

  const FOODS = {
    rice: 'Rice',
    roti: 'Roti',
    chicken: 'Chicken',
    eggs: 'Eggs',
    dogfood: 'Dog food',
    catfood: 'Cat food',
    water: 'Fresh water',
  };

  const SITUATIONS = [
    { id: 'accident', label: 'Hit by a vehicle', aid: 'accident', urgent: true },
    { id: 'injured', label: 'Injured or bleeding', aid: 'bleeding' },
    { id: 'maggots', label: 'Wound with maggots', aid: 'maggots' },
    { id: 'sick', label: 'Sick or very weak', aid: 'sick' },
    { id: 'poison', label: 'Suspected poisoning', aid: 'poison', urgent: true },
    { id: 'heat', label: 'Heatstroke', aid: 'heat', urgent: true },
    { id: 'trapped', label: 'Trapped or tangled', aid: 'trapped' },
    { id: 'babies', label: 'Puppies or kittens in danger', aid: 'babies' },
    { id: 'cruelty', label: 'Cruelty or abuse', aid: 'cruelty' },
    { id: 'other', label: 'Something else', aid: '' },
  ];

  const REPORT_ANIMALS = {
    dog: 'Dog',
    cat: 'Cat',
    cattle: 'Cow or bull',
    bird: 'Bird',
    monkey: 'Monkey',
    equine: 'Horse or donkey',
    other: 'Other',
  };

  const SIGNS = {
    cantwalk: "Can't stand or walk",
    bleeding: 'Bleeding a lot',
    breathing: 'Struggling to breathe',
    unresponsive: 'Not responding',
    fits: 'Having fits',
    traffic: 'In the middle of traffic',
  };

  const SEEN = { now: 'Just now', hour: 'In the last hour', today: 'Earlier today', before: 'Yesterday or before' };
  const STILL = { yes: 'Yes', no: 'No, it moved away', unsure: 'Not sure' };

  const FIRST_AID = {
    accident: {
      title: 'Hit by a vehicle',
      dos: [
        'Make sure you are safe from traffic first. Ask someone to slow vehicles down.',
        'If the animal has to be moved off the road, slide a blanket, sack or board under its whole body and lift it level, keeping its back straight.',
        'Keep it warm, quiet and out of the sun while you wait.',
      ],
      donts: [
        "Don't lift it by the legs, neck or scruff.",
        "Don't force food or water on it, and never give human medicine.",
      ],
    },
    bleeding: {
      title: 'Injured or bleeding',
      dos: [
        'If it is safe to get close, press a clean cloth firmly on the wound for a few minutes to slow the bleeding.',
        'A towel laid loosely over the head calms many frightened animals.',
        'Note where the wound is and roughly how big, so the team brings the right supplies.',
      ],
      donts: [
        "Don't put kerosene, phenyl or other chemicals on a wound.",
        "Don't give human painkillers. Paracetamol and ibuprofen can poison dogs and cats.",
      ],
    },
    maggots: {
      title: 'Wound with maggots',
      dos: [
        'Get help the same day. Maggot wounds spread fast and can kill an animal.',
        'Keep flies off by loosely covering the wound with clean gauze or cloth.',
        'Note exactly where the animal rests. Animals in pain often hide.',
      ],
      donts: [
        "Don't pour kerosene, phenyl, acid or other chemicals into the wound. They burn the flesh and can poison the animal.",
        "Don't try to dig the maggots out yourself.",
      ],
    },
    sick: {
      title: 'Sick or very weak',
      dos: [
        'Offer clean water in a bowl, and help it into shade if you can do so safely.',
        'Note what you see: vomiting, diarrhoea, discharge from the eyes or nose, shivering, or not eating.',
        'Keep puppies and kittens warm and dry.',
      ],
      donts: [
        "Don't give human medicines.",
        "Don't force-feed.",
      ],
    },
    poison: {
      title: 'Suspected poisoning',
      dos: [
        'Get the animal to a vet as fast as you can. Minutes matter.',
        'Put any leftover bait, packet or vomit in a bag. It helps the vet, and it is evidence.',
        'Note who was around and what you saw. Poisoning an animal is a crime under section 325 of the Bharatiya Nyaya Sanhita.',
      ],
      donts: [
        "Don't make the animal vomit unless a vet tells you to.",
        "Don't give milk, oil or salt water.",
      ],
    },
    heat: {
      title: 'Heatstroke',
      intro: 'Watch for heavy panting, drooling, bright red gums, wobbling or collapse.',
      dos: [
        'Move the animal into shade straight away.',
        'Wet its body with cool water, especially the belly and paws, and let it drink small amounts.',
        'Fan it if you can.',
      ],
      donts: [
        "Don't use ice or ice-cold water.",
        "Don't leave a wet towel lying on it. It traps the heat.",
      ],
    },
    trapped: {
      title: 'Trapped or tangled',
      dos: [
        'Keep people back and talk softly. A trapped animal panics easily.',
        'For a bird caught in kite string, cover its head with a cloth and cut the string close to its body with scissors.',
        'For an animal in a drain, pit or pipe, tell the team how deep it is and what is in the way.',
      ],
      donts: [
        "Don't pull string or wire that is wrapped around a leg or wing. It cuts deeper.",
        "Don't climb into deep drains or wells yourself.",
      ],
      note: "Nylon and other synthetic kite string ('Chinese manjha') has been banned across India by the National Green Tribunal since 2017.",
    },
    babies: {
      title: 'Puppies or kittens in danger',
      dos: [
        'Watch from a distance for a couple of hours first. The mother is often nearby looking for food.',
        'If they are in immediate danger from traffic, rain or a drain, move them a short way to a safe, dry spot close by.',
        'Keep tiny ones warm.',
      ],
      donts: [
        "Don't give cow's milk. It upsets their stomachs.",
        "Don't take them far from where you found them, or the mother may not find them.",
      ],
    },
    cruelty: {
      title: 'Cruelty or abuse',
      dos: [
        `If someone is hurting an animal right now and it isn't safe to step in, call the police on ${CONFIG.policeNumber}.`,
        'From a safe distance, take photos or video, and note the date, time, place and any vehicle numbers.',
        'Write down the names and numbers of people who saw it and are willing to back you up.',
      ],
      donts: [
        "Don't confront anyone if it puts you at risk.",
        "Don't edit or delete the original photos and videos. They may be needed as evidence.",
      ],
      note: 'Cruelty to animals is an offence under the Prevention of Cruelty to Animals Act, 1960. Killing, poisoning or maiming an animal is punishable with up to five years in prison under section 325 of the Bharatiya Nyaya Sanhita, 2023.',
    },
  };

  const STEPS = [
    ['Keep yourself and the animal safe', 'Approach slowly and quietly. A frightened or hurt animal may bite. If it is near traffic, alert drivers and keep a safe distance.'],
    ['Note the exact location', 'A landmark, sector number and a photo or short video help the rescue team find the animal quickly and judge what it needs.'],
    ['Contact us or a nearby vet', 'Share the location and photos. Tell us whether the animal can move, is bleeding, or seems to be in pain.'],
    ['Offer water and shade, never medicine', "Don't give human medicines. Many common painkillers are poisonous to animals. Water and shade are safe ways to help."],
    ['Stay nearby if you can', "Keep an eye on the animal until help arrives so it doesn't wander off or get lost."],
  ];

  const LAWS = [
    { ref: 'Constitution of India, Article 51A(g)', title: 'Compassion is a duty', text: 'Every citizen has a fundamental duty to have compassion for living creatures.' },
    { ref: 'Prevention of Cruelty to Animals Act, 1960 · BNS, 2023 s.325', title: 'Cruelty is a crime', text: "Beating, torturing or causing an animal unnecessary pain is an offence. Killing, poisoning or maiming an animal is punishable with up to five years' imprisonment." },
    { ref: 'Animal Birth Control Rules, 2023', title: 'Sterilise, vaccinate, return', text: 'Community dogs are to be sterilised, vaccinated against rabies and released back in the same area they were picked up from.' },
    { ref: 'Good practice for feeders', title: 'Feed with care', text: "Use a designated or agreed spot away from play areas and entrances, feed at regular times and clean up afterwards. If you're harassed for feeding, talk to us." },
  ];

  const CARE = [
    { icon: 'bowl', title: 'Feed at the same spot and time', text: 'Choose a spot your neighbours agree on, away from play areas, gates and entrances. Use bowls or leaves rather than plastic, and clean up afterwards. Animals that know your routine are also easier to catch for sterilisation and vaccination.' },
    { icon: 'ear', title: 'Look for the ear notch', text: 'Under the Animal Birth Control Rules, community dogs are sterilised, vaccinated and returned to their area. A small V-shaped notch in one ear usually means a dog has already been sterilised.' },
    { icon: 'syringe', title: 'Keep up with rabies boosters', text: 'Vets usually advise a yearly anti-rabies booster for community dogs. The WHO says vaccinating at least 70% of the dogs in an area stops rabies spreading. The Today screen shows how the dogs you look after are doing.' },
    { icon: 'scale', title: 'If you are stopped from feeding', text: "Stay calm and don't argue. Ask your RWA or the municipal corporation where the designated feeding spots are, and get in touch with us. Our Legal Aid Project can help." },
  ];

  // Months are 1 to 12. Written for the weather and festivals of the Tricity.
  const SEASON_TIPS = [
    { months: [4, 5, 6], icon: 'sun', title: 'Summer heat', text: 'Days in the Tricity can pass 40°C. Keep bowls of fresh water in the shade and refill them twice a day. Heavy panting, drooling and wobbling are signs of heatstroke.' },
    { months: [7, 8, 9], icon: 'rain', title: 'Monsoon', text: 'Wet weather brings ticks, skin infections and maggot wounds. Check the animals you feed for wounds and get them seen quickly.' },
    { months: [10, 11], icon: 'sparkle', title: 'Festival season', text: 'Firecrackers around Diwali terrify dogs and cats. Leave a quiet, sheltered corner open for them and keep feeding times regular. Report anyone throwing crackers at animals.' },
    { months: [12, 1, 2], icon: 'snow', title: 'Cold nights', text: 'Old jute sacks or blankets in a dry corner help animals through winter nights. Cats and puppies often crawl into car engines for warmth, so knock on the bonnet before you start.' },
    { months: [1, 2], icon: 'kite', title: 'Kite-flying season', text: 'Kite string injures birds and other animals. Look out for animals tangled in string, and never pull it free: cut it close to the body.' },
    { months: [3], icon: 'syringe', title: 'Vaccination check', text: 'Before the summer, look through the Animals tab for anyone who is due their yearly anti-rabies booster.' },
  ];

  /* Small helpers -------------------------------------------------------- */

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

  // html`...` escapes every value it is given unless the value is already
  // Safe, so text people type can never turn into markup.
  class Safe {
    constructor(text) { this.s = text; }
    toString() { return this.s; }
  }
  const raw = (text) => new Safe(text);

  function show(value) {
    if (value == null || value === false || value === true) return '';
    if (value instanceof Safe) return value.s;
    if (Array.isArray(value)) return value.map(show).join('');
    return esc(value);
  }

  function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += show(values[i]) + strings[i + 1];
    return new Safe(out);
  }

  const checked = (on) => (on ? raw(' checked') : '');
  const selected = (on) => (on ? raw(' selected') : '');
  const icon = (name, className) => html`<svg class="icon${className ? ' ' + className : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

  function uid() {
    const bytes = new Uint8Array(6);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else bytes.forEach((_, i) => { bytes[i] = Math.floor(Math.random() * 256); });
    return Date.now().toString(36) + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('');
  }

  const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const oneOf = (value, options, fallback) => (typeof value === 'string' && has(options, value) ? value : fallback);
  const str = (value, max) => (typeof value === 'string' ? value : value == null ? '' : String(value)).slice(0, max || 2000);
  const clampInt = (value, min, max, fallback) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };

  function groupBy(list, keyOf) {
    const groups = new Map();
    for (const item of list) {
      const key = keyOf(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    return groups;
  }

  const collator = new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' });
  const unique = (list) => Array.from(new Set(list));

  function debounce(fn, wait) {
    let timer = 0;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  /* Dates ---------------------------------------------------------------- */
  // Dates are kept as local 'YYYY-MM-DD' strings so they never shift with
  // time zones.

  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDate(new Date());

  function parseDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function isDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    return isoDate(parseDate(value)) === value;
  }

  const isTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

  function dayNumber(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  }

  const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);

  function addDays(iso, n) {
    const d = parseDate(iso);
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }

  function addMonths(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const lastDay = new Date(y, m - 1 + n + 1, 0).getDate();
    return isoDate(new Date(y, m - 1 + n, Math.min(d, lastDay)));
  }

  const DATE_STYLES = {
    medium: { day: 'numeric', month: 'short', year: 'numeric' },
    short: { day: 'numeric', month: 'short' },
    month: { month: 'short', year: 'numeric' },
    weekday: { weekday: 'short', day: 'numeric', month: 'short' },
    long: { weekday: 'long', day: 'numeric', month: 'long' },
  };

  function fmtDate(iso, style) {
    if (!isDate(iso)) return '';
    return parseDate(iso).toLocaleDateString('en-IN', DATE_STYLES[style || 'medium']);
  }

  // "21 Oct" within this year, "21 Oct 2025" otherwise
  const fmtDay = (iso) => fmtDate(iso, iso.slice(0, 4) === today().slice(0, 4) ? 'short' : 'medium');

  function fmtTime(hhmm) {
    if (!isTime(hhmm)) return '';
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }

  function relDay(iso) {
    const n = daysBetween(today(), iso);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n > 0 ? `in ${n} days` : `${-n} days ago`;
  }

  const fmtNum = (n) => Number(n).toLocaleString('en-IN');
  const plural = (n, one, many) => `${fmtNum(n)} ${n === 1 ? one : many || one + 's'}`;

  /* Saving --------------------------------------------------------------- */

  let storageWorks = true;

  function emptyState() {
    return {
      version: VERSION,
      animals: [],
      records: [],
      feedings: [],
      settings: { theme: 'system', name: '', phone: '', lastBackup: '' },
      started: false,
    };
  }

  function safeId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : uid();
  }

  function cleanAnimal(a) {
    return {
      id: safeId(a.id),
      name: str(a.name, 80),
      species: oneOf(a.species, SPECIES, 'dog'),
      sex: oneOf(a.sex, SEXES, 'unknown'),
      age: oneOf(a.age, AGES, 'unknown'),
      area: str(a.area, 120),
      spot: str(a.spot, 160),
      markings: str(a.markings, 600),
      sterilised: oneOf(a.sterilised, STERILISED, 'unknown'),
      status: oneOf(a.status, STATUSES, 'street'),
      caretaker: str(a.caretaker, 120),
      notes: str(a.notes, 4000),
      photo: a.photo === true,
      example: a.example === true,
      created: str(a.created, 40) || new Date().toISOString(),
    };
  }

  function cleanRecord(r) {
    return {
      id: safeId(r.id),
      animalId: str(r.animalId, 64),
      type: oneOf(r.type, RECORD_TYPES, 'note'),
      date: isDate(r.date) ? r.date : today(),
      due: isDate(r.due) ? r.due : '',
      notes: str(r.notes, 4000),
      example: r.example === true,
      created: str(r.created, 40) || new Date().toISOString(),
    };
  }

  function cleanFeeding(f) {
    return {
      id: safeId(f.id),
      date: isDate(f.date) ? f.date : today(),
      time: isTime(f.time) ? f.time : '',
      spot: str(f.spot, 160),
      count: clampInt(f.count, 0, 10000, 0),
      food: Array.isArray(f.food) ? unique(f.food.filter((x) => has(FOODS, x))) : [],
      amount: str(f.amount, 160),
      notes: str(f.notes, 2000),
      example: f.example === true,
      created: str(f.created, 40) || new Date().toISOString(),
    };
  }

  // Everything loaded from storage or a backup file passes through here, so
  // the rest of the app can trust the shape of the data.
  function cleanState(data) {
    const fresh = emptyState();
    const list = (value, clean) => (Array.isArray(value) ? value.filter((x) => x && typeof x === 'object').map(clean) : []);
    const animals = list(data.animals, cleanAnimal);
    const ids = new Set(animals.map((a) => a.id));
    const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};
    return {
      version: VERSION,
      animals,
      records: list(data.records, cleanRecord).filter((r) => ids.has(r.animalId)),
      feedings: list(data.feedings, cleanFeeding),
      settings: {
        theme: oneOf(settings.theme, { system: 1, light: 1, dark: 1 }, fresh.settings.theme),
        name: str(settings.name, 80),
        phone: str(settings.phone, 40),
        lastBackup: isDate(settings.lastBackup) ? settings.lastBackup : '',
      },
      started: data.started === true,
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      localStorage.setItem(STORE_KEY + ':check', '1');
      localStorage.removeItem(STORE_KEY + ':check');
      if (saved && typeof saved === 'object') return cleanState(saved);
    } catch (err) {
      storageWorks = false;
    }
    return emptyState();
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      storageWorks = true;
    } catch (err) {
      storageWorks = false;
      toast(PREVIEW ? "Couldn't save on this device." : "Couldn't save on this device. Download a backup from More to keep your records.");
    }
  }

  let state = loadState();

  /* Photos (IndexedDB) --------------------------------------------------- */

  const photoDB = (() => {
    let opening = null;

    function open() {
      if (!opening) {
        opening = new Promise((resolve) => {
          try {
            const request = indexedDB.open('megafauna-care', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('photos');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
          } catch (err) {
            resolve(null);
          }
        });
      }
      return opening;
    }

    async function run(mode, work) {
      const db = await open();
      if (!db) throw new Error('Photo storage is not available in this browser.');
      return new Promise((resolve, reject) => {
        const tx = db.transaction('photos', mode);
        const request = work(tx.objectStore('photos'));
        tx.oncomplete = () => resolve(request ? request.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }

    return {
      get: (id) => run('readonly', (s) => s.get(id)).catch(() => null),
      put: (id, blob) => run('readwrite', (s) => s.put(blob, id)),
      remove: (id) => run('readwrite', (s) => s.delete(id)).catch(() => undefined),
      clear: () => run('readwrite', (s) => s.clear()).catch(() => undefined),
    };
  })();

  const photoURLs = new Map();

  async function photoURL(id) {
    if (!photoURLs.has(id)) {
      const blob = await photoDB.get(id);
      photoURLs.set(id, blob ? URL.createObjectURL(blob) : '');
    }
    return photoURLs.get(id);
  }

  function forgetPhoto(id) {
    const url = photoURLs.get(id);
    if (url) URL.revokeObjectURL(url);
    photoURLs.delete(id);
  }

  function hydratePhotos(root) {
    root.querySelectorAll('[data-photo]').forEach(async (el) => {
      const url = await photoURL(el.dataset.photo);
      if (url && el.isConnected && !el.querySelector('img')) setAvatarImage(el, url);
    });
  }

  function setAvatarImage(el, url) {
    const old = el.querySelector('img');
    if (old) old.remove();
    if (!url) return;
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    el.appendChild(img);
  }

  // Shrinks a photo before saving it, so hundreds of animals still fit.
  function resizeImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't read that photo. Try another one."))), 'image/jpeg', 0.82);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("That file isn't a photo this browser can read. Try a JPG or PNG."));
      };
      img.src = url;
    });
  }

  const blobToDataURL = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

  function dataURLToBlob(url) {
    const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(url);
    if (!match) return null;
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] });
  }

  /* What the records mean ------------------------------------------------ */

  const findAnimal = (id) => state.animals.find((a) => a.id === id);
  const isActive = (a) => STATUSES[a.status].active;
  const keepsRecords = (a) => a.species === 'dog' || a.species === 'cat';

  // "Cow" or "Bull" reads better than "Cow or bull" once the sex is known.
  function kindLabel(a) {
    if (a.species === 'cattle') return a.sex === 'male' ? 'Bull' : 'Cow';
    return a.species === 'other' ? 'Animal' : SPECIES[a.species].label;
  }

  const displayName = (a) => a.name.trim() || `Unnamed ${kindLabel(a).toLowerCase()}`;

  const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created);

  // Records grouped by animal, newest first. Built once per screen.
  function recordIndex() {
    const index = groupBy(state.records, (r) => r.animalId);
    for (const list of index.values()) list.sort(newestFirst);
    return index;
  }

  function latest(index, animalId, type) {
    const list = index.get(animalId);
    return (list && list.find((r) => r.type === type)) || null;
  }

  // A rabies vaccine with no "next due" date still runs out after a year.
  function dueDateOf(record) {
    if (!record) return '';
    if (record.due) return record.due;
    return record.type === 'rabies' ? addMonths(record.date, 12) : '';
  }

  // Where an animal stands on one kind of regular care:
  // none, done (no repeat planned), ok, soon or overdue.
  function careStatus(index, a, type) {
    const record = latest(index, a.id, type);
    if (!record) return { state: 'none', record: null, due: '', days: 0 };
    const due = dueDateOf(record);
    if (!due) return { state: 'done', record, due: '', days: 0 };
    const days = daysBetween(today(), due);
    const state = days < 0 ? 'overdue' : days <= RECORD_TYPES[type].soon ? 'soon' : 'ok';
    return { state, record, due, days };
  }

  const isProtected = (status) => status.state === 'ok' || status.state === 'soon' || status.state === 'done';

  function dueList(index) {
    const items = [];
    for (const a of state.animals) {
      if (!isActive(a)) continue;
      for (const type of DUE_TYPES) {
        const status = careStatus(index, a, type);
        if (status.state === 'overdue' || status.state === 'soon') items.push(Object.assign({ animal: a, type }, status));
      }
    }
    return items.sort((x, y) => x.days - y.days);
  }

  function needsAttention(index, a) {
    if (!isActive(a)) return false;
    if (a.status === 'treatment') return true;
    if (keepsRecords(a) && careStatus(index, a, 'rabies').state === 'none') return true;
    return DUE_TYPES.some((type) => {
      const s = careStatus(index, a, type).state;
      return s === 'overdue' || s === 'soon';
    });
  }

  function dogCoverage(index) {
    const dogs = state.animals.filter((a) => a.species === 'dog' && isActive(a));
    return {
      total: dogs.length,
      sterilised: dogs.filter((a) => a.sterilised === 'yes').length,
      vaccinated: dogs.filter((a) => isProtected(careStatus(index, a, 'rabies'))).length,
    };
  }

  function feedingDays(count) {
    const totals = new Map();
    for (const f of state.feedings) totals.set(f.date, (totals.get(f.date) || 0) + f.count);
    const end = today();
    return Array.from({ length: count }, (_, i) => {
      const date = addDays(end, i - count + 1);
      return { date, value: totals.get(date) || 0, logged: totals.has(date) };
    });
  }

  const areas = () => unique(state.animals.map((a) => a.area.trim()).filter(Boolean)).sort(collator.compare);
  const spots = () => unique(state.feedings.map((f) => f.spot.trim()).filter(Boolean)).sort(collator.compare);
  const hasExamples = () => state.animals.some((a) => a.example) || state.feedings.some((f) => f.example);

  /* Shared pieces of interface ------------------------------------------- */

  const main = document.getElementById('main');
  const sheet = document.getElementById('sheet');
  const confirmDialog = document.getElementById('confirm');

  function chip(tone, iconName, label) {
    return html`<span class="chip${tone ? ' chip-' + tone : ''}">${iconName ? icon(iconName) : ''}${label}</span>`;
  }

  function avatar(a, size) {
    const letter = (Array.from(a.name.trim())[0] || SPECIES[a.species].label[0]).toUpperCase();
    const photo = a.photo ? raw(` data-photo="${esc(a.id)}"`) : '';
    return html`<span class="avatar avatar-${a.species}${size ? ' avatar-' + size : ''}"${photo} aria-hidden="true">${letter}</span>`;
  }

  function statusChip(a) {
    if (a.status === 'street') return '';
    const s = STATUSES[a.status];
    return chip(s.tone, s.tone === 'info' ? 'vet' : '', s.label);
  }

  function sterilisedChip(a) {
    if (a.sterilised === 'yes') return chip('good', 'ear', 'Sterilised');
    if (a.sterilised === 'no') return chip('warn', 'ear', 'Not sterilised');
    return chip('', 'ear', 'Sterilised? Not sure');
  }

  function rabiesChip(index, a) {
    const s = careStatus(index, a, 'rabies');
    if (s.state === 'none') return chip('bad', 'syringe', 'No rabies vaccine');
    if (s.state === 'overdue') return chip('bad', 'syringe', 'Rabies vaccine overdue');
    if (s.state === 'soon') return chip('warn', 'syringe', `Rabies due ${fmtDay(s.due)}`);
    return chip('good', 'syringe', `Rabies vaccine till ${fmtDate(s.due, 'month')}`);
  }

  function animalChips(index, a) {
    const chips = [statusChip(a)];
    if (keepsRecords(a) && a.status !== 'died') {
      chips.push(sterilisedChip(a));
      if (isActive(a)) chips.push(rabiesChip(index, a));
    }
    if (a.example) chips.push(chip('', '', 'Example'));
    return chips;
  }

  function examplesNotice() {
    if (!hasExamples()) return '';
    return html`<div class="notice">
      ${icon('info')}
      <div class="notice-body">
        <p><strong>These are example records</strong> to show you how the app works. Remove them when you're ready to add your own.</p>
        <div class="btn-row"><button class="btn btn-sm btn-outline" type="button" data-action="remove-examples">Remove examples</button></div>
      </div>
    </div>`;
  }

  function storageNotice() {
    if (storageWorks) return '';
    return html`<div class="notice notice-warn">
      ${icon('warn')}
      <div class="notice-body"><p><strong>This browser isn't saving your records.</strong> Private browsing or blocked site data can cause this. Anything you add will be lost when you close the page${PREVIEW ? '' : ', unless you download a backup from More'}.</p></div>
    </div>`;
  }

  function radioPills(name, options, value, extraClass) {
    return html`<div class="pills${extraClass ? ' ' + extraClass : ''}">${Object.keys(options).map((key) => html`<label class="pill"><input type="radio" name="${name}" value="${key}"${checked(key === value)}><span>${options[key]}</span></label>`)}</div>`;
  }

  function checkPills(name, options, values) {
    return html`<div class="pills">${Object.keys(options).map((key) => html`<label class="pill"><input type="checkbox" name="${name}" value="${key}"${checked(values.includes(key))}><span>${icon('check', 'tick')}${options[key]}</span></label>`)}</div>`;
  }

  let toastTimer = 0;
  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3500);
  }

  async function copyText(text, doneMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(doneMessage);
      return;
    } catch (err) {
      // Fall through to the older way of copying.
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (err) { copied = false; }
    area.remove();
    if (copied) toast(doneMessage);
    else openTextSheet('Copy this text', text);
  }

  /* Dialogs -------------------------------------------------------------- */

  let sheetOptions = null;

  function openSheet(options) {
    sheetOptions = options;
    sheet.innerHTML = html`<form class="sheet-form" data-form="sheet" novalidate>
      <div class="sheet-head">
        <h2 id="sheet-title">${options.title}</h2>
        <button class="icon-btn" type="button" data-action="close-sheet" aria-label="Close">${icon('x')}</button>
      </div>
      <div class="sheet-body">
        ${options.body}
        <p class="error" id="sheet-error" role="alert" hidden></p>
      </div>
      <div class="sheet-foot">
        ${options.onDelete ? html`<button class="btn btn-danger" type="button" data-action="sheet-delete">${icon('trash')} Delete</button>` : ''}
        <span class="spacer"></span>
        ${options.submitLabel ? html`<button class="btn btn-outline" type="button" data-action="close-sheet">Cancel</button>
        <button class="btn btn-primary" type="submit">${options.submitLabel}</button>` : html`<button class="btn btn-primary" type="button" data-action="close-sheet">Done</button>`}
      </div>
    </form>`.s;
    sheet.setAttribute('aria-labelledby', 'sheet-title');
    const form = sheet.querySelector('form');
    if (options.onMount) options.onMount(form);
    if (typeof sheet.showModal === 'function') sheet.showModal();
    else sheet.setAttribute('open', '');
  }

  function closeSheet() {
    if (sheet.open) sheet.close();
  }

  sheet.addEventListener('close', () => {
    sheet.innerHTML = '';
    sheetOptions = null;
  });

  // A tap on the dimmed area around the sheet closes it.
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) closeSheet();
  });

  function sheetError(message) {
    const el = document.getElementById('sheet-error');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  function openTextSheet(title, text) {
    openSheet({
      title,
      body: html`<p class="muted">Select the text below and copy it.</p>
        <label class="visually-hidden" for="copy-text">Text to copy</label>
        <textarea class="sheet-text" id="copy-text" readonly>${text}</textarea>`,
      onMount(form) {
        setTimeout(() => form.querySelector('textarea').select(), 50);
      },
    });
  }

  // The page can't use confirm(), so destructive actions ask here.
  function confirmAction({ title, text, confirmLabel, danger = true }) {
    return new Promise((resolve) => {
      confirmDialog.innerHTML = html`<form class="confirm-form" method="dialog">
        <h2 id="confirm-title">${title}</h2>
        ${text ? html`<p>${text}</p>` : ''}
        <div class="btn-row confirm-actions">
          <button class="btn btn-outline" value="cancel" autofocus>Cancel</button>
          <button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" value="ok">${confirmLabel}</button>
        </div>
      </form>`.s;
      confirmDialog.returnValue = '';
      confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), { once: true });
      if (typeof confirmDialog.showModal === 'function') confirmDialog.showModal();
      else resolve(false);
    });
  }

  /* Today ---------------------------------------------------------------- */

  function viewToday() {
    const index = recordIndex();
    const due = dueList(index);
    const cover = dogCoverage(index);
    const unvaccinated = state.animals.filter((a) => keepsRecords(a) && isActive(a) && careStatus(index, a, 'rabies').state === 'none').length;
    const notSterilised = state.animals.filter((a) => keepsRecords(a) && isActive(a) && a.sterilised === 'no').length;
    const month = new Date().getMonth() + 1;
    const tips = SEASON_TIPS.filter((t) => t.months.includes(month)).slice(0, 2);

    return html`<div class="view">
      <header class="view-head">
        <div>
          <p class="eyebrow">${fmtDate(today(), 'long')}</p>
          <h1 tabindex="-1">Today</h1>
        </div>
      </header>

      ${storageNotice()}
      ${examplesNotice()}

      <a class="cta" href="#report">
        <span class="cta-icon">${icon('aid')}</span>
        <span class="cta-text">
          <strong>Found an animal in need?</strong>
          <span>Get the rescue team the details they need in a minute.</span>
        </span>
        ${icon('chevron-right', 'cta-chev')}
      </a>

      <section class="section" aria-labelledby="due-title">
        <div class="section-head">
          <h2 id="due-title">Needs attention</h2>
          ${due.length ? html`<span class="count-badge" aria-label="${plural(due.length, 'item')}">${due.length}</span>` : ''}
        </div>
        ${due.length
          ? html`<ul class="list">${due.slice(0, 8).map(dueRow)}</ul>`
          : state.animals.length
            ? html`<p class="empty-line">${icon('check')} No vaccines or treatments due in the next few weeks.</p>`
            : html`<p class="muted">Add the dogs, cats and cows you look after. This is where you'll see who is due a vaccine or treatment.</p>
              <div class="btn-row"><a class="btn btn-outline" href="#add-animal">${icon('plus')} Add an animal</a></div>`}
        ${due.length > 8 ? html`<a class="btn btn-quiet btn-sm" href="#animals" data-action="filter-link" data-flag="attention">See all ${due.length} ${icon('chevron-right')}</a>` : ''}
        ${unvaccinated || notSterilised ? html`<div class="btn-row">
          ${unvaccinated ? html`<a class="btn btn-sm btn-outline" href="#animals" data-action="filter-link" data-flag="rabies">${icon('syringe')} ${plural(unvaccinated, 'animal')} with no rabies vaccine</a>` : ''}
          ${notSterilised ? html`<a class="btn btn-sm btn-outline" href="#animals" data-action="filter-link" data-flag="unsterilised">${icon('ear')} ${fmtNum(notSterilised)} not sterilised</a>` : ''}
        </div>` : ''}
      </section>

      ${cover.total ? coverageCard(cover) : ''}
      ${feedingCard()}
      ${tips.map((tip) => html`<aside class="tip">
        <span class="tip-icon">${icon(tip.icon)}</span>
        <div class="tip-body"><h2 class="tip-title">${tip.title}</h2><p>${tip.text}</p></div>
      </aside>`)}
      ${backupReminder()}
    </div>`;
  }

  function dueRow(item) {
    const a = item.animal;
    const type = RECORD_TYPES[item.type];
    const when = item.days < 0 ? `overdue by ${plural(-item.days, 'day')}` : item.days === 0 ? 'due today' : `due ${relDay(item.due)}`;
    return html`<li class="due-row">
      <a class="row" href="#animal-${a.id}">
        ${avatar(a)}
        <span class="row-main">
          <span class="row-title">${displayName(a)}</span>
          <span class="row-sub">${type.short}, <span class="tone-${item.state === 'overdue' ? 'bad' : 'warn'}">${when}</span></span>
        </span>
      </a>
      <button class="btn btn-sm btn-outline" type="button" data-action="add-record" data-animal="${a.id}" data-type="${item.type}" aria-label="Record ${type.short} for ${displayName(a)}">${icon('check')} Done</button>
    </li>`;
  }

  function coverageCard(cover) {
    return html`<section class="section card" aria-labelledby="cover-title">
      <div class="section-head">
        <h2 id="cover-title">Dogs you look after</h2>
        <span class="muted small">${plural(cover.total, 'dog')}</span>
      </div>
      ${meter('Vaccinated against rabies', cover.vaccinated, cover.total, 70)}
      ${meter('Sterilised', cover.sterilised, cover.total, 0)}
      <p class="small muted">The WHO says vaccinating at least 70% of the dogs in an area stops rabies spreading.</p>
    </section>`;
  }

  function meter(label, count, total, target) {
    const pct = total ? Math.round((count / total) * 100) : 0;
    const status = target ? (pct >= target ? chip('good', 'check', 'On target') : chip('warn', 'warn', 'Below target')) : '';
    const description = `${label}: ${count} of ${total} dogs, ${pct}%${target ? `. Target ${target}%` : ''}`;
    return html`<div class="meter">
      <div class="meter-top">
        <span class="meter-label">${label}</span>
        <span class="meter-value"><strong>${fmtNum(count)}</strong> of ${fmtNum(total)} · ${pct}%</span>
      </div>
      <div class="meter-track" role="img" aria-label="${description}">
        <div class="meter-fill" style="width:${pct}%"></div>
        ${target ? html`<span class="meter-target" style="left:${target}%"></span>` : ''}
      </div>
      ${target ? html`<div class="meter-foot">${status}<span class="meter-scale" style="left:${target}%" aria-hidden="true">${target}% target</span></div>` : ''}
    </div>`;
  }

  function feedingCard() {
    const week = feedingDays(7);
    const meals = week.reduce((sum, d) => sum + d.value, 0);
    const daysFed = week.filter((d) => d.logged).length;
    const max = Math.max(1, ...week.map((d) => d.value));
    return html`<section class="section card" aria-labelledby="feed-title">
      <div class="section-head">
        <h2 id="feed-title">Feeding this week</h2>
        <a class="btn btn-quiet btn-sm" href="#feeding">Feeding log ${icon('chevron-right')}</a>
      </div>
      ${daysFed ? html`<div class="week">
        <div class="week-figure">
          <span class="big-num">${fmtNum(meals)}</span>
          <span class="muted">${daysFed === 7 ? 'meals served, with a round every day' : `meals served, with rounds on ${daysFed} of the last 7 days`}</span>
        </div>
        <div class="spark" aria-hidden="true">${week.map((d) => html`<span class="spark-bar${d.value ? ' has-value' : ''}" style="height:${d.value ? Math.max(10, Math.round((d.value / max) * 100)) : 6}%"></span>`)}</div>
      </div>` : html`<p class="muted">No rounds logged in the last 7 days. Log each round to see how many animals you feed.</p>`}
      <div class="btn-row"><button class="btn btn-primary" type="button" data-action="log-feeding">${icon('plus')} Log a feeding round</button></div>
    </section>`;
  }

  function backupReminder() {
    const own = state.animals.filter((a) => !a.example).length + state.feedings.filter((f) => !f.example).length;
    if (PREVIEW || own < 3) return '';
    const last = state.settings.lastBackup;
    if (last && daysBetween(last, today()) < 30) return '';
    return html`<div class="notice notice-warn">
      ${icon('download')}
      <div class="notice-body">
        <p><strong>${last ? `Your last backup was ${fmtDay(last)}.` : "You haven't backed up your records yet."}</strong> They're only saved on this device. A backup file lets you get them back if you clear your browser or change phones.</p>
        <div class="btn-row"><a class="btn btn-sm btn-outline" href="#more">Back up now</a></div>
      </div>
    </div>`;
  }

  /* Animals -------------------------------------------------------------- */

  const animalFilter = { q: '', species: 'all', flag: '' };

  // Called whenever the whole set of records changes, so an old filter
  // can't hide everything.
  function resetAnimalFilter() {
    animalFilter.q = '';
    animalFilter.species = 'all';
    animalFilter.flag = '';
  }

  const FLAGS = {
    attention: 'Needs attention',
    rabies: 'No rabies vaccine',
    unsterilised: 'Not sterilised',
  };

  function matchesFlag(index, a, flag) {
    if (flag === 'attention') return needsAttention(index, a);
    if (flag === 'rabies') return keepsRecords(a) && isActive(a) && careStatus(index, a, 'rabies').state === 'none';
    if (flag === 'unsterilised') return keepsRecords(a) && isActive(a) && a.sterilised === 'no';
    return true;
  }

  function viewAnimals() {
    return html`<div class="view">
      <header class="view-head">
        <h1 tabindex="-1">Animals</h1>
        <a class="btn btn-primary" href="#add-animal">${icon('plus')} Add animal</a>
      </header>
      ${examplesNotice()}
      ${state.animals.length ? html`<div class="toolbar">
        <label class="search">
          <span class="visually-hidden">Search animals</span>
          ${icon('search')}
          <input id="animal-search" type="search" placeholder="Search by name, area or markings" value="${animalFilter.q}" data-input="search" autocomplete="off">
        </label>
        <div class="toolbar-filters" id="animal-filters">${animalFilterButtons()}</div>
      </div>` : ''}
      <div id="animal-results">${animalResults()}</div>
    </div>`;
  }

  function animalFilterButtons() {
    const index = recordIndex();
    const count = (species) => state.animals.filter((a) => species === 'all' || a.species === species).length;
    const speciesKeys = ['all'].concat(Object.keys(SPECIES).filter((key) => count(key) > 0));
    const speciesButtons = speciesKeys.map((key) => html`<button class="filter" type="button" data-action="filter" data-kind="species" data-value="${key}" aria-pressed="${String(animalFilter.species === key)}">${key === 'all' ? 'All' : SPECIES[key].plural} <span class="num">${count(key)}</span></button>`);
    const flagButtons = Object.keys(FLAGS).map((key) => {
      const n = state.animals.filter((a) => matchesFlag(index, a, key)).length;
      return html`<button class="filter" type="button" data-action="filter" data-kind="flag" data-value="${key}" aria-pressed="${String(animalFilter.flag === key)}">${FLAGS[key]} <span class="num">${n}</span></button>`;
    });
    return html`<div class="filters" role="group" aria-label="Show animals">${speciesButtons}</div>
      <div class="filters" role="group" aria-label="Show only">${flagButtons}</div>`;
  }

  function animalResults() {
    if (!state.animals.length) {
      return html`<div class="empty">
        <h2>Keep track of the animals you look after</h2>
        <p class="muted">Add the dogs, cats and cows on your feeding round. You'll see who is sterilised, who needs a rabies booster, and where each one lives.</p>
        <div class="btn-row">
          <a class="btn btn-primary" href="#add-animal">${icon('plus')} Add your first animal</a>
          <button class="btn btn-outline" type="button" data-action="load-examples">Show example animals</button>
        </div>
      </div>`;
    }
    const index = recordIndex();
    const q = animalFilter.q.trim().toLowerCase();
    const list = state.animals.filter((a) => {
      if (animalFilter.species !== 'all' && a.species !== animalFilter.species) return false;
      if (!matchesFlag(index, a, animalFilter.flag)) return false;
      if (!q) return true;
      return [a.name, a.area, a.spot, a.markings, a.caretaker, a.notes, SPECIES[a.species].label, kindLabel(a)].join(' ').toLowerCase().includes(q);
    });
    if (!list.length) {
      return html`<p class="empty-line">No animals match. <button class="btn-link" type="button" data-action="clear-filters">Show all animals</button></p>`;
    }
    const groups = groupBy(list, (a) => a.area.trim() || 'No area given');
    const order = Array.from(groups.keys()).sort(collator.compare);
    const byName = (a, b) => Number(isActive(b)) - Number(isActive(a)) || Number(!a.name.trim()) - Number(!b.name.trim()) || collator.compare(a.name, b.name);
    return html`${order.map((area) => html`<section class="group" aria-label="${area}">
      <h2 class="group-title">${area} <span>${groups.get(area).length}</span></h2>
      <ul class="list">${groups.get(area).sort(byName).map((a) => animalRow(index, a))}</ul>
    </section>`)}`;
  }

  function animalRow(index, a) {
    const details = [kindLabel(a), a.sex !== 'unknown' ? SEXES[a.sex] : '', a.spot.trim()].filter(Boolean).join(' · ');
    return html`<li><a class="row" href="#animal-${a.id}">
      ${avatar(a)}
      <span class="row-main">
        <span class="row-title">${displayName(a)}</span>
        <span class="row-sub">${details}</span>
        <span class="chips">${animalChips(index, a)}</span>
      </span>
      ${icon('chevron-right', 'chev')}
    </a></li>`;
  }

  function refreshAnimalList(focusKind, focusValue) {
    const filters = document.getElementById('animal-filters');
    const results = document.getElementById('animal-results');
    if (filters) filters.innerHTML = animalFilterButtons().s;
    if (results) {
      results.innerHTML = animalResults().s;
      hydratePhotos(results);
    }
    if (focusKind) {
      const button = document.querySelector(`.filter[data-kind="${focusKind}"][data-value="${focusValue}"]`);
      if (button) button.focus();
    }
  }

  const onSearch = debounce((input) => {
    animalFilter.q = input.value;
    const results = document.getElementById('animal-results');
    if (!results) return;
    results.innerHTML = animalResults().s;
    hydratePhotos(results);
  }, 120);

  /* One animal ----------------------------------------------------------- */

  function ageLabel(a) {
    if (a.age === 'unknown') return '';
    return a.age === 'young' ? SPECIES[a.species].young : AGES[a.age];
  }

  function notFound() {
    return html`<div class="view">
      <a class="back" href="#animals">${icon('chevron-left')} Animals</a>
      <h1 tabindex="-1">Animal not found</h1>
      <p class="muted">It may have been deleted, or the link is from another phone. Records are only saved on the device they were added on.</p>
    </div>`;
  }

  function viewAnimal(route) {
    const a = findAnimal(route.id);
    if (!a) return notFound();
    const index = recordIndex();
    const records = index.get(a.id) || [];
    const name = displayName(a);
    const meta = [kindLabel(a), a.sex !== 'unknown' ? SEXES[a.sex] : '', ageLabel(a)].filter(Boolean).join(' · ');
    const sterilisedOn = latest(index, a.id, 'sterilised');
    const where = [a.area.trim(), a.spot.trim()].filter(Boolean).join(' · ');

    return html`<div class="view">
      <a class="back" href="#animals">${icon('chevron-left')} Animals</a>

      <header class="profile-head">
        ${avatar(a, 'lg')}
        <div class="profile-id">
          <h1 tabindex="-1">${name}</h1>
          <p class="muted">${meta}</p>
          <div class="chips">${statusChip(a)}${a.example ? chip('', '', 'Example') : ''}</div>
        </div>
      </header>

      <div class="btn-row">
        <button class="btn btn-primary" type="button" data-action="add-record" data-animal="${a.id}">${icon('plus')} Add health record</button>
        <button class="btn btn-outline" type="button" data-action="share-animal" data-id="${a.id}">${icon('share')} Share</button>
        <a class="btn btn-outline" href="#edit-${a.id}">${icon('edit')} Edit</a>
      </div>

      <section class="section" aria-labelledby="health-title">
        <h2 id="health-title">Health</h2>
        <div class="health-grid">${healthTiles(index, a)}</div>
      </section>

      <section class="section" aria-labelledby="about-title">
        <h2 id="about-title">About ${name}</h2>
        <dl class="facts">
          <div><dt>Where to find them</dt><dd>${where || 'Not recorded'}</dd></div>
          <div><dt>Sterilised</dt><dd>${a.sterilised === 'yes' ? (sterilisedOn ? `Yes, on ${fmtDate(sterilisedOn.date)}` : 'Yes') : STERILISED[a.sterilised]}</dd></div>
          ${a.markings.trim() ? html`<div class="wide"><dt>How to recognise them</dt><dd>${a.markings}</dd></div>` : ''}
          ${a.caretaker.trim() ? html`<div><dt>Looked after by</dt><dd>${a.caretaker}</dd></div>` : ''}
          <div><dt>Status</dt><dd>${STATUSES[a.status].label}</dd></div>
          ${a.notes.trim() ? html`<div class="wide"><dt>Notes</dt><dd>${a.notes}</dd></div>` : ''}
        </dl>
      </section>

      <section class="section" aria-labelledby="history-title">
        <h2 id="history-title">History</h2>
        ${records.length ? timeline(records) : html`<p class="muted">No health records yet. Add vaccinations, sterilisation, treatments and notes as they happen.</p>`}
      </section>

      <div class="danger-zone">
        <button class="btn btn-danger" type="button" data-action="delete-animal" data-id="${a.id}">${icon('trash')} Delete ${name}</button>
      </div>
    </div>`;
  }

  function healthTiles(index, a) {
    const types = keepsRecords(a) ? ['sterilised', 'rabies', 'deworm', 'ticks'] : ['rabies', 'deworm'];
    return types.map((type) => (type === 'sterilised' ? sterilisedTile(index, a) : careTile(index, a, type)));
  }

  function careTile(index, a, type) {
    const t = RECORD_TYPES[type];
    const s = careStatus(index, a, type);
    let tone = 'good';
    let line = '';
    let meta = s.record ? `Last: ${fmtDay(s.record.date)}` : 'Add a record';
    if (s.state === 'none') {
      tone = type === 'rabies' && keepsRecords(a) ? 'bad' : '';
      line = 'Not recorded';
    } else if (s.state === 'overdue') {
      tone = 'bad';
      line = `Overdue since ${fmtDay(s.due)}`;
    } else if (s.state === 'soon') {
      tone = 'warn';
      line = s.days === 0 ? 'Due today' : `Due ${relDay(s.due)}`;
    } else {
      line = s.due ? `Next due ${fmtDay(s.due)}` : 'Done';
    }
    if (!isActive(a)) {
      tone = '';
      meta = s.record ? `Last: ${fmtDay(s.record.date)}` : meta;
    }
    return html`<button class="health-tile" type="button" data-action="add-record" data-animal="${a.id}" data-type="${type}" aria-label="${t.short}: ${line}. ${meta}. Add a record">
      <span class="tile-label">${icon(t.icon)} ${t.short}</span>
      <span class="tile-state${tone ? ' tone-' + tone : ''}">${line}</span>
      <span class="tile-meta">${meta}</span>
    </button>`;
  }

  function sterilisedTile(index, a) {
    const record = latest(index, a.id, 'sterilised');
    let tone = '';
    let line = 'Not sure';
    let meta = 'Check for an ear notch';
    if (a.sterilised === 'yes') {
      tone = 'good';
      line = 'Sterilised';
      meta = record ? fmtDate(record.date) : 'Date not recorded';
    } else if (a.sterilised === 'no') {
      tone = 'warn';
      line = 'Not sterilised';
      meta = 'Add a record when it is done';
    }
    return html`<button class="health-tile" type="button" data-action="add-record" data-animal="${a.id}" data-type="sterilised" aria-label="Sterilisation: ${line}. ${meta}. Add a record">
      <span class="tile-label">${icon('ear')} Sterilisation</span>
      <span class="tile-state${tone ? ' tone-' + tone : ''}">${line}</span>
      <span class="tile-meta">${meta}</span>
    </button>`;
  }

  function timeline(records) {
    return html`<ol class="timeline">${records.map((r) => {
      const t = RECORD_TYPES[r.type];
      const due = dueDateOf(r);
      return html`<li>
        <span class="tl-icon">${icon(t.icon)}</span>
        <div class="tl-body">
          <p class="tl-title">${t.label}</p>
          <p class="tl-meta">${fmtDate(r.date)}${due ? `, next due ${fmtDate(due)}` : ''}</p>
          ${r.notes.trim() ? html`<p class="tl-notes">${r.notes}</p>` : ''}
        </div>
        <button class="icon-btn" type="button" data-action="edit-record" data-id="${r.id}" aria-label="Edit ${t.label} from ${fmtDate(r.date)}">${icon('edit')}</button>
      </li>`;
    })}</ol>`;
  }

  function animalCard(a) {
    const index = recordIndex();
    const about = [kindLabel(a).toLowerCase(), a.sex !== 'unknown' ? SEXES[a.sex].toLowerCase() : '', ageLabel(a).toLowerCase()].filter(Boolean).join(', ');
    const lines = [`${displayName(a)} (${about})`];
    const where = [a.area.trim(), a.spot.trim()].filter(Boolean).join(', ');
    if (where) lines.push(`Where: ${where}`);
    if (a.markings.trim()) lines.push(`Recognise by: ${a.markings.trim()}`);
    const sterilisedOn = latest(index, a.id, 'sterilised');
    if (keepsRecords(a)) {
      lines.push(`Sterilised: ${a.sterilised === 'yes' ? (sterilisedOn ? `yes, on ${fmtDate(sterilisedOn.date)}` : 'yes') : a.sterilised === 'no' ? 'no' : 'not known'}`);
    }
    for (const type of DUE_TYPES) {
      const r = latest(index, a.id, type);
      if (r) lines.push(`${RECORD_TYPES[type].label}: ${fmtDate(r.date)}${dueDateOf(r) ? ` (next due ${fmtDate(dueDateOf(r))})` : ''}`);
    }
    if (a.status !== 'street') lines.push(`Status: ${STATUSES[a.status].label}`);
    if (a.caretaker.trim()) lines.push(`Looked after by: ${a.caretaker.trim()}`);
    lines.push('', `Shared from MegaFauna Care, ${CONFIG.orgName}`);
    return lines.join('\n');
  }

  async function shareAnimal(id) {
    const a = findAnimal(id);
    if (!a) return;
    const text = animalCard(a);
    if (!PREVIEW && navigator.share) {
      try {
        await navigator.share({ title: displayName(a), text });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        openTextSheet(`Share ${displayName(a)}`, text);
        return;
      }
    }
    copyText(text, `${displayName(a)}'s details are copied. Paste them into WhatsApp or a message.`);
  }

  async function deleteAnimal(id) {
    const a = findAnimal(id);
    if (!a) return;
    const name = displayName(a);
    const count = state.records.filter((r) => r.animalId === id).length;
    const ok = await confirmAction({
      title: `Delete ${name}?`,
      text: `${count ? `This also deletes ${plural(count, 'health record')}. ` : ''}If ${name} has been adopted or has died, you can change their status instead and keep the records.`,
      confirmLabel: `Delete ${name}`,
    });
    if (!ok) return;
    state.animals = state.animals.filter((x) => x.id !== id);
    state.records = state.records.filter((r) => r.animalId !== id);
    if (a.photo) {
      photoDB.remove(id);
      forgetPhoto(id);
    }
    save();
    navigate('#animals', true);
    toast(`${name} deleted`);
  }

  // Changing an example animal makes it yours, so removing the examples
  // won't take it away.
  function adoptExample(a) {
    if (!a.example) return;
    a.example = false;
    for (const r of state.records) if (r.animalId === a.id) r.example = false;
  }

  /* Add or edit an animal ------------------------------------------------ */

  // A photo picked in the form, kept until the form is saved.
  let pendingPhoto = { blob: null, removed: false };

  function viewAnimalForm(route) {
    const editing = route.name === 'edit';
    const a = editing ? findAnimal(route.id) : null;
    if (editing && !a) return notFound();
    const lastAdded = state.animals[state.animals.length - 1];
    const v = a || {
      name: '', species: 'dog', sex: 'unknown', age: 'unknown', area: lastAdded ? lastAdded.area : '', spot: '', markings: '',
      sterilised: 'unknown', status: 'street', caretaker: state.settings.name, notes: '', photo: false,
    };
    const backHref = editing ? `#animal-${a.id}` : '#animals';
    const ageOptions = Object.assign({}, AGES, { young: SPECIES[v.species].young });

    return html`<div class="view">
      <a class="back" href="${backHref}">${icon('chevron-left')} ${editing ? displayName(a) : 'Animals'}</a>
      <h1 tabindex="-1">${editing ? `Edit ${displayName(a)}` : 'Add an animal'}</h1>

      <form class="form" data-form="animal" data-id="${editing ? a.id : ''}" novalidate>
        <div class="field">
          <span class="field-label">Photo <span class="optional">(optional)</span></span>
          <div class="photo-field">
            ${avatar(Object.assign({}, v, { id: editing ? a.id : '', photo: Boolean(editing && a.photo) }), 'lg')}
            <div class="photo-actions">
              <label class="btn btn-outline file-btn">${icon('camera')} <span id="photo-label">${editing && a.photo ? 'Change photo' : 'Add a photo'}</span>
                <input class="visually-hidden" id="photo-input" type="file" accept="image/*" data-input="photo">
              </label>
              <button class="btn btn-quiet btn-sm" type="button" id="photo-remove" data-action="remove-photo"${editing && a.photo ? '' : raw(' hidden')}>Remove photo</button>
              <p class="hint">A clear photo of the face and markings helps others recognise them.</p>
            </div>
          </div>
        </div>

        <div class="field">
          <label for="f-name">Name <span class="optional">(optional)</span></label>
          <input id="f-name" name="name" type="text" value="${v.name}" placeholder="What do people call them?" autocomplete="off" maxlength="80">
        </div>

        <fieldset class="field"><legend>Animal</legend>${radioPills('species', mapLabels(SPECIES), v.species)}</fieldset>
        <fieldset class="field"><legend>Sex</legend>${radioPills('sex', SEXES, v.sex)}</fieldset>
        <fieldset class="field"><legend>Age</legend>${radioPills('age', ageOptions, v.age)}</fieldset>

        <div class="field">
          <label for="f-area">Area</label>
          <input id="f-area" name="area" type="text" value="${v.area}" placeholder="For example Sector 22-C, or Phase 7, Mohali" list="area-list" autocomplete="off" maxlength="120" required aria-describedby="f-area-error">
          <datalist id="area-list">${areas().map((x) => html`<option value="${x}"></option>`)}</datalist>
          <p class="error" id="f-area-error" hidden>Add the area so you can find them again.</p>
        </div>

        <div class="field">
          <label for="f-spot">Spot or landmark <span class="optional">(optional)</span></label>
          <input id="f-spot" name="spot" type="text" value="${v.spot}" placeholder="For example outside Shastri Market, gate 2" autocomplete="off" maxlength="160">
        </div>

        <div class="field">
          <label for="f-markings">How to recognise them <span class="optional">(optional)</span></label>
          <textarea id="f-markings" name="markings" rows="2" maxlength="600" placeholder="Colour, markings, ear notch, collar, a limp…">${v.markings}</textarea>
        </div>

        <fieldset class="field">
          <legend>Sterilised?</legend>
          <p class="hint">Sterilised community dogs usually have a small V-shaped notch in one ear.</p>
          ${radioPills('sterilised', STERILISED, v.sterilised)}
        </fieldset>

        <div class="field">
          <label for="f-status">Where are they now?</label>
          <select id="f-status" name="status">${Object.keys(STATUSES).map((key) => html`<option value="${key}"${selected(key === v.status)}>${STATUSES[key].label}</option>`)}</select>
        </div>

        <div class="field">
          <label for="f-caretaker">Who looks after them <span class="optional">(optional)</span></label>
          <input id="f-caretaker" name="caretaker" type="text" value="${v.caretaker}" placeholder="Feeder or caretaker's name" autocomplete="off" maxlength="120">
        </div>

        <div class="field">
          <label for="f-notes">Notes <span class="optional">(optional)</span></label>
          <textarea id="f-notes" name="notes" rows="4" maxlength="4000" placeholder="Temperament, health history, anything a rescuer should know">${v.notes}</textarea>
        </div>

        <div class="form-actions">
          <button class="btn btn-primary" type="submit">${icon('check')} ${editing ? 'Save changes' : 'Add animal'}</button>
          <a class="btn btn-outline" href="${backHref}">Cancel</a>
        </div>
      </form>
    </div>`;
  }

  function mapLabels(options) {
    const out = {};
    for (const key of Object.keys(options)) out[key] = options[key].label;
    return out;
  }

  function onSpeciesChange(input) {
    const form = input.form;
    const young = form.querySelector('input[name="age"][value="young"] + span');
    if (young) young.textContent = SPECIES[input.value].young;
    const preview = form.querySelector('.photo-field .avatar');
    if (preview) {
      preview.className = `avatar avatar-${input.value} avatar-lg`;
      if (!form.elements.name.value.trim() && !preview.querySelector('img')) preview.textContent = SPECIES[input.value].label[0];
    }
  }

  async function onPhotoChosen(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    try {
      const blob = await resizeImage(file, 960);
      pendingPhoto = { blob, removed: false };
      const preview = document.querySelector('.photo-field .avatar');
      if (preview) setAvatarImage(preview, URL.createObjectURL(blob));
      document.getElementById('photo-label').textContent = 'Change photo';
      document.getElementById('photo-remove').hidden = false;
    } catch (err) {
      toast(err.message);
    }
  }

  function removePhoto() {
    pendingPhoto = { blob: null, removed: true };
    const preview = document.querySelector('.photo-field .avatar');
    if (preview) setAvatarImage(preview, '');
    document.getElementById('photo-label').textContent = 'Add a photo';
    document.getElementById('photo-remove').hidden = true;
  }

  async function submitAnimal(form) {
    const values = Object.fromEntries(new FormData(form));
    const areaInput = form.elements.area;
    const areaError = document.getElementById('f-area-error');
    if (!String(values.area || '').trim()) {
      areaError.hidden = false;
      areaInput.setAttribute('aria-invalid', 'true');
      areaInput.focus();
      return;
    }
    areaError.hidden = true;
    areaInput.removeAttribute('aria-invalid');

    const existing = form.dataset.id ? findAnimal(form.dataset.id) : null;
    const animal = cleanAnimal(Object.assign({}, existing || {}, values, {
      id: existing ? existing.id : uid(),
      area: String(values.area).trim(),
      name: String(values.name || '').trim(),
      created: existing ? existing.created : new Date().toISOString(),
      photo: existing ? existing.photo : false,
      example: false,
    }));

    if (pendingPhoto.blob) {
      try {
        await photoDB.put(animal.id, pendingPhoto.blob);
        forgetPhoto(animal.id);
        animal.photo = true;
      } catch (err) {
        toast("Couldn't save the photo on this device. Everything else was saved.");
      }
    } else if (pendingPhoto.removed && animal.photo) {
      await photoDB.remove(animal.id);
      forgetPhoto(animal.id);
      animal.photo = false;
    }
    pendingPhoto = { blob: null, removed: false };

    if (existing) {
      adoptExample(existing);
      Object.assign(existing, animal);
    } else {
      state.animals.push(animal);
    }
    save();
    toast(existing ? 'Changes saved' : `${displayName(animal)} added`);
    navigate(`#animal-${animal.id}`, true);
  }

  /* Health records ------------------------------------------------------- */

  function openRecordSheet({ animalId, type, record }) {
    const a = findAnimal(record ? record.animalId : animalId);
    if (!a) return;
    const editing = Boolean(record);
    const r = record || { type: has(RECORD_TYPES, type) ? type : 'rabies', date: today(), due: '', notes: '' };

    openSheet({
      title: editing ? 'Edit health record' : `Health record for ${displayName(a)}`,
      submitLabel: editing ? 'Save changes' : 'Save record',
      body: html`
        <div class="field">
          <label for="r-type">What was done</label>
          <select id="r-type" name="type">${Object.keys(RECORD_TYPES).map((key) => html`<option value="${key}"${selected(key === r.type)}>${RECORD_TYPES[key].label}</option>`)}</select>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="r-date">Date</label>
            <input id="r-date" name="date" type="date" value="${r.date}" max="${today()}" required>
          </div>
          <div class="field">
            <label for="r-due">Next due <span class="optional">(optional)</span></label>
            <input id="r-due" name="due" type="date" value="${r.due}">
          </div>
        </div>
        <p class="hint" id="r-due-hint"></p>
        <div class="field">
          <label for="r-notes">Notes <span class="optional">(optional)</span></label>
          <textarea id="r-notes" name="notes" rows="3" maxlength="4000" placeholder="${RECORD_TYPES[r.type].hint}">${r.notes}</textarea>
        </div>`,
      onDelete: editing ? () => deleteRecord(record) : null,
      onMount(form) {
        // Keep "next due" in step with the type and date until it is changed by hand.
        let dueEdited = editing;
        const hint = form.querySelector('#r-due-hint');
        const suggest = () => {
          const t = RECORD_TYPES[form.elements.type.value];
          form.elements.notes.placeholder = t.hint;
          hint.textContent = t.months ? `Usually repeated every ${t.months === 12 ? 'year' : plural(t.months, 'month')}. Follow your vet's advice.` : '';
          if (dueEdited) return;
          form.elements.due.value = t.months && isDate(form.elements.date.value) ? addMonths(form.elements.date.value, t.months) : '';
        };
        form.elements.due.addEventListener('input', () => { dueEdited = true; });
        form.elements.type.addEventListener('change', suggest);
        form.elements.date.addEventListener('change', suggest);
        suggest();
      },
      onSubmit(form) {
        const type = oneOf(form.elements.type.value, RECORD_TYPES, 'note');
        const date = form.elements.date.value;
        const due = form.elements.due.value;
        if (!isDate(date)) {
          sheetError('Choose the date it was done.');
          form.elements.date.focus();
          return false;
        }
        if (date > today()) {
          sheetError("The date can't be in the future. Use “Next due” for things still to come.");
          form.elements.date.focus();
          return false;
        }
        if (due && !isDate(due)) {
          sheetError('Choose a valid next due date, or leave it empty.');
          form.elements.due.focus();
          return false;
        }
        if (due && due <= date) {
          sheetError('The next due date has to be after the date it was done.');
          form.elements.due.focus();
          return false;
        }
        const fields = { type, date, due, notes: form.elements.notes.value.trim().slice(0, 4000), example: false };
        if (record) Object.assign(record, fields);
        else state.records.push(Object.assign({ id: uid(), animalId: a.id, created: new Date().toISOString() }, fields));
        if (type === 'sterilised') a.sterilised = 'yes';
        adoptExample(a);
        save();
        toast(record ? 'Record updated' : `${RECORD_TYPES[type].short} recorded for ${displayName(a)}`);
        return true;
      },
    });
  }

  async function deleteRecord(record) {
    const ok = await confirmAction({
      title: 'Delete this record?',
      text: `${RECORD_TYPES[record.type].label} on ${fmtDate(record.date)}. This can't be undone.`,
      confirmLabel: 'Delete record',
    });
    if (!ok) return;
    state.records = state.records.filter((r) => r.id !== record.id);
    save();
    closeSheet();
    render();
    toast('Record deleted');
  }

  /* Feeding -------------------------------------------------------------- */

  let showAllFeedings = false;

  function viewFeeding() {
    const days = feedingDays(14);
    const week = days.slice(7);
    const meals = week.reduce((sum, d) => sum + d.value, 0);
    const daysFed = week.filter((d) => d.logged).length;
    const weekStart = week[0].date;
    const weekSpots = unique(state.feedings.filter((f) => f.date >= weekStart).map((f) => f.spot.trim().toLowerCase()).filter(Boolean)).length;
    const entries = state.feedings.slice().sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.created.localeCompare(a.created));
    const cutoff = addDays(today(), -30);
    const shown = showAllFeedings ? entries : entries.filter((f) => f.date >= cutoff);
    const hidden = entries.length - shown.length;

    return html`<div class="view">
      <header class="view-head">
        <h1 tabindex="-1">Feeding</h1>
        <button class="btn btn-primary" type="button" data-action="log-feeding">${icon('plus')} Log feeding</button>
      </header>
      ${examplesNotice()}

      <div class="stats">
        <div class="stat"><span class="stat-value">${fmtNum(meals)}</span><span class="stat-label">meals in the last 7 days</span></div>
        <div class="stat"><span class="stat-value">${daysFed} of 7</span><span class="stat-label">days with a round</span></div>
        <div class="stat"><span class="stat-value">${fmtNum(weekSpots)}</span><span class="stat-label">${weekSpots === 1 ? 'feeding spot' : 'feeding spots'} this week</span></div>
      </div>

      <section class="section card" aria-labelledby="chart-title">
        <div class="section-head">
          <h2 id="chart-title">Meals per day</h2>
          <span class="muted small">Last 14 days</span>
        </div>
        <div class="chart" id="feed-chart"></div>
        <details class="table-toggle">
          <summary>${icon('chevron-down')} Show as a table</summary>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th scope="col">Day</th><th scope="col" class="num">Meals</th></tr></thead>
              <tbody>${days.slice().reverse().map((d) => html`<tr><td>${fmtDate(d.date, 'weekday')}</td><td class="num">${d.logged ? fmtNum(d.value) : 'No round'}</td></tr>`)}</tbody>
            </table>
          </div>
        </details>
      </section>

      <section class="section" aria-labelledby="log-title">
        <h2 id="log-title">Feeding log</h2>
        ${shown.length ? feedingLog(shown) : html`<p class="muted">${entries.length ? 'No rounds in the last 30 days.' : 'No rounds logged yet. Log each round to see how many animals you feed.'}</p>`}
        ${hidden > 0 ? html`<button class="btn btn-outline" type="button" data-action="show-all-feedings">Show ${plural(hidden, 'older round')}</button>` : ''}
      </section>

      <aside class="tip">
        <span class="tip-icon">${icon('bowl')}</span>
        <div class="tip-body">
          <h2 class="tip-title">Feed with care</h2>
          <p>Use a designated or agreed spot away from play areas and entrances, feed at regular times and clean up afterwards. If you're harassed for feeding, talk to us.</p>
        </div>
      </aside>
    </div>`;
  }

  function feedingLog(entries) {
    const days = groupBy(entries, (f) => f.date);
    return Array.from(days.keys()).map((date) => {
      const list = days.get(date);
      const total = list.reduce((sum, f) => sum + f.count, 0);
      const n = daysBetween(date, today());
      const title = n === 0 ? 'Today' : n === 1 ? 'Yesterday' : fmtDate(date, 'weekday');
      return html`<section class="day-group" aria-label="${title}">
        <h3 class="day-title">${title} <span class="muted">${plural(total, 'meal')}</span></h3>
        <ul class="list">${list.map(feedingRow)}</ul>
      </section>`;
    });
  }

  function feedingRow(f) {
    const details = [fmtTime(f.time), f.food.map((x) => FOODS[x]).join(', '), f.amount.trim()].filter(Boolean).join(' · ');
    return html`<li><button class="row" type="button" data-action="edit-feeding" data-id="${f.id}" aria-label="Edit round at ${f.spot}${f.time ? ', ' + fmtTime(f.time) : ''}">
      <span class="fed"><span><strong>${fmtNum(f.count)}</strong><small>fed</small></span></span>
      <span class="row-main">
        <span class="row-title">${f.spot || 'Feeding round'}</span>
        ${details ? html`<span class="row-sub">${details}</span>` : ''}
        ${f.notes.trim() ? html`<span class="row-note">${f.notes}</span>` : ''}
      </span>
      ${icon('edit', 'chev')}
    </button></li>`;
  }

  function openFeedingSheet(entry) {
    const editing = Boolean(entry);
    const now = new Date();
    const last = state.feedings.slice().sort((a, b) => b.created.localeCompare(a.created))[0];
    const f = entry || {
      date: today(),
      time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      spot: last ? last.spot : areas()[0] || '',
      count: last ? last.count : 10,
      food: last ? last.food : [],
      amount: '',
      notes: '',
    };
    const spotOptions = unique(spots().concat(areas()));

    openSheet({
      title: editing ? 'Edit feeding round' : 'Log a feeding round',
      submitLabel: editing ? 'Save changes' : 'Save round',
      body: html`
        <div class="field-row">
          <div class="field">
            <label for="fd-date">Date</label>
            <input id="fd-date" name="date" type="date" value="${f.date}" max="${today()}" required>
          </div>
          <div class="field">
            <label for="fd-time">Time <span class="optional">(optional)</span></label>
            <input id="fd-time" name="time" type="time" value="${f.time}">
          </div>
        </div>
        <div class="field">
          <label for="fd-spot">Where</label>
          <input id="fd-spot" name="spot" type="text" value="${f.spot}" list="spot-list" placeholder="For example Sector 22 market" autocomplete="off" maxlength="160" required>
          <datalist id="spot-list">${spotOptions.map((x) => html`<option value="${x}"></option>`)}</datalist>
        </div>
        <div class="field">
          <label for="fd-count">Animals fed</label>
          <div class="stepper">
            <button class="icon-btn" type="button" data-action="step" data-step="-1" aria-label="One fewer">${icon('minus')}</button>
            <input id="fd-count" name="count" type="number" inputmode="numeric" min="0" max="10000" value="${f.count}">
            <button class="icon-btn" type="button" data-action="step" data-step="1" aria-label="One more">${icon('plus')}</button>
          </div>
        </div>
        <fieldset class="field">
          <legend>What you gave <span class="optional">(optional)</span></legend>
          ${checkPills('food', FOODS, f.food)}
        </fieldset>
        <div class="field">
          <label for="fd-amount">How much <span class="optional">(optional)</span></label>
          <input id="fd-amount" name="amount" type="text" value="${f.amount}" placeholder="For example 3 kg rice, 1 kg chicken" autocomplete="off" maxlength="160">
        </div>
        <div class="field">
          <label for="fd-notes">Anything to note <span class="optional">(optional)</span></label>
          <textarea id="fd-notes" name="notes" rows="2" maxlength="2000" placeholder="A new dog, someone limping, a regular who didn't come…">${f.notes}</textarea>
        </div>`,
      onDelete: editing ? () => deleteFeeding(entry) : null,
      onSubmit(form) {
        const date = form.elements.date.value;
        const spot = form.elements.spot.value.trim();
        const count = clampInt(form.elements.count.value, 0, 10000, -1);
        if (!isDate(date) || date > today()) {
          sheetError('Choose the date of the round. It can’t be in the future.');
          form.elements.date.focus();
          return false;
        }
        if (!spot) {
          sheetError('Add where you fed, so you can see your rounds by spot.');
          form.elements.spot.focus();
          return false;
        }
        if (count < 0) {
          sheetError('Add how many animals you fed.');
          form.elements.count.focus();
          return false;
        }
        const fields = cleanFeeding({
          id: entry ? entry.id : uid(),
          date,
          time: form.elements.time.value,
          spot,
          count,
          food: Array.from(form.querySelectorAll('input[name="food"]:checked'), (input) => input.value),
          amount: form.elements.amount.value.trim(),
          notes: form.elements.notes.value.trim(),
          example: false,
          created: entry ? entry.created : new Date().toISOString(),
        });
        if (entry) Object.assign(entry, fields);
        else state.feedings.push(fields);
        save();
        toast(entry ? 'Round updated' : `Round saved: ${plural(count, 'meal')}`);
        return true;
      },
    });
  }

  async function deleteFeeding(entry) {
    const ok = await confirmAction({
      title: 'Delete this feeding round?',
      text: `${entry.spot}, ${fmtDate(entry.date)}. This can't be undone.`,
      confirmLabel: 'Delete round',
    });
    if (!ok) return;
    state.feedings = state.feedings.filter((f) => f.id !== entry.id);
    save();
    closeSheet();
    render();
    toast('Round deleted');
  }

  // The 14-day column chart. Drawn to the card's real width so the text
  // stays a readable size on every screen.
  function niceTop(max) {
    if (max <= 0) return 10;
    const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
    for (const step of [1, 2, 4, 6, 8, 10]) {
      const top = step * magnitude;
      if (top >= max && Number.isInteger(top / 2)) return top;
    }
    return 10 * magnitude;
  }

  function barPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + rr}A${rr},${rr} 0 0 1 ${x + rr},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + h}Z`;
  }

  function drawFeedingChart() {
    const el = document.getElementById('feed-chart');
    if (!el) return;
    const days = feedingDays(14);
    const width = Math.max(240, Math.floor(el.clientWidth));
    const height = 190;
    const m = { top: 22, right: 4, bottom: 26, left: 32 };
    const plotW = width - m.left - m.right;
    const plotH = height - m.top - m.bottom;
    const max = Math.max(0, ...days.map((d) => d.value));
    const top = niceTop(max);
    const y = (v) => m.top + plotH - (v / top) * plotH;
    const slot = plotW / days.length;
    const barW = Math.min(24, Math.max(4, slot - 6));
    const end = today();
    let peak = -1;
    days.forEach((d, i) => { if (d.value > 0 && (peak < 0 || d.value >= days[peak].value)) peak = i; });

    let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="group" aria-label="Meals per day, last 14 days">`;
    for (const v of [0, top / 2, top]) {
      svg += `<line class="grid" x1="${m.left}" x2="${width - m.right}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text class="axis" x="${m.left - 8}" y="${y(v)}" dy="0.32em" text-anchor="end">${esc(fmtNum(v))}</text>`;
    }
    days.forEach((d, i) => {
      const x = m.left + i * slot + (slot - barW) / 2;
      const label = `${fmtDate(d.date, 'weekday')}: ${d.logged ? plural(d.value, 'meal') : 'no round logged'}`;
      svg += `<g class="col" data-i="${i}" tabindex="0" role="img" aria-label="${esc(label)}">`;
      svg += `<rect class="hit" x="${m.left + i * slot}" y="${m.top}" width="${slot}" height="${plotH}" rx="4" fill="transparent"/>`;
      if (d.value > 0) svg += `<path class="bar" d="${barPath(x, y(d.value), barW, y(0) - y(d.value), 4)}"/>`;
      svg += `<text class="axis${d.date === end ? ' is-today' : ''}" x="${x + barW / 2}" y="${height - 8}" text-anchor="middle">${Number(d.date.slice(8))}</text>`;
      svg += '</g>';
    });
    if (peak >= 0) {
      const x = m.left + peak * slot + slot / 2;
      svg += `<text class="value" x="${x}" y="${y(days[peak].value) - 7}" text-anchor="middle">${esc(fmtNum(days[peak].value))}</text>`;
    }
    svg += '</svg>';
    el.innerHTML = `${svg}<div class="chart-tip" hidden></div>`;

    const tip = el.querySelector('.chart-tip');
    let active = null;
    const show = (g) => {
      const i = Number(g.dataset.i);
      const d = days[i];
      if (active) active.classList.remove('is-active');
      active = g;
      g.classList.add('is-active');
      const strong = document.createElement('strong');
      strong.textContent = d.logged ? plural(d.value, 'meal') : 'No round logged';
      const when = document.createElement('span');
      when.textContent = fmtDate(d.date, 'weekday');
      tip.replaceChildren(strong, when);
      tip.hidden = false;
      const cx = m.left + i * slot + slot / 2;
      tip.style.left = `${Math.min(width - 64, Math.max(64, cx))}px`;
      tip.style.top = `${Math.max(16, y(d.value) - 4)}px`;
    };
    const hide = () => {
      if (active) active.classList.remove('is-active');
      active = null;
      tip.hidden = true;
    };
    el.querySelectorAll('.col').forEach((g) => {
      g.addEventListener('pointerenter', () => show(g));
      g.addEventListener('pointerdown', () => show(g));
      g.addEventListener('focus', () => show(g));
      g.addEventListener('pointerleave', hide);
      g.addEventListener('blur', hide);
    });
  }

  window.addEventListener('resize', debounce(drawFeedingChart, 150));

  /* Report an animal in need --------------------------------------------- */

  let report = null;

  function newReport() {
    return {
      situation: '', animal: 'dog', count: 1, signs: [], area: '', landmark: '', coords: null,
      seen: 'now', still: 'yes', details: '', name: state.settings.name, phone: state.settings.phone,
    };
  }

  function buildReport(r) {
    const situation = SITUATIONS.find((s) => s.id === r.situation);
    const signs = r.signs.filter((key) => has(SIGNS, key)).map((key) => SIGNS[key]);
    const urgent = Boolean((situation && situation.urgent) || signs.length);
    const where = [r.area.trim(), r.landmark.trim()].filter(Boolean).join(', ');
    const lines = [urgent ? '*URGENT: animal needs help*' : '*Animal needs help*'];
    lines.push(`What: ${situation ? situation.label : '(choose what is happening)'}`);
    lines.push(`Animal: ${REPORT_ANIMALS[r.animal] || 'Animal'}${r.count > 1 ? ` × ${r.count}` : ''}`);
    if (signs.length) lines.push(`Warning signs: ${signs.join(', ')}`);
    lines.push(`Where: ${where || (r.coords ? 'see the map link' : '(add the area)')}`);
    if (r.coords) lines.push(`Map: ${mapLink(r.coords)}`);
    lines.push(`Seen: ${SEEN[r.seen] || SEEN.now}`);
    lines.push(`Still there: ${STILL[r.still] || STILL.unsure}`);
    if (r.details.trim()) lines.push('', r.details.trim());
    const by = [r.name.trim(), r.phone.trim()].filter(Boolean).join(', ');
    if (by) lines.push('', `Reported by ${by}`);
    lines.push('', 'Sent from the MegaFauna Care app');
    return lines.join('\n');
  }

  const mapLink = (c) => `https://www.google.com/maps/search/?api=1&query=${c.lat.toFixed(5)},${c.lng.toFixed(5)}`;

  function whatsappLink(r) {
    const text = encodeURIComponent(buildReport(r));
    return CONFIG.whatsappNumber ? `https://wa.me/${CONFIG.whatsappNumber}?text=${text}` : `https://wa.me/?text=${text}`;
  }

  function mailLink(r) {
    const situation = SITUATIONS.find((s) => s.id === r.situation);
    const subject = `${situation ? situation.label : 'Animal in need'}${r.area.trim() ? `, ${r.area.trim()}` : ''}`;
    return `mailto:${CONFIG.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(buildReport(r).replace(/\*/g, ''))}`;
  }

  function viewReport() {
    if (!report) report = newReport();
    const r = report;
    return html`<div class="view">
      <header class="view-head">
        <div>
          <h1 tabindex="-1">Report an animal in need</h1>
          <p class="lead">Fill in what you can. You'll get a message ready to send to the ${CONFIG.shortName} rescue team.</p>
        </div>
      </header>

      <div class="notice notice-alert">
        ${icon('phone')}
        <div class="notice-body"><p><strong>Someone hurting an animal right now?</strong> If it isn't safe to step in, call the police on <a href="tel:${CONFIG.policeNumber}">${CONFIG.policeNumber}</a>.</p></div>
      </div>

      <form class="form" data-form="report" novalidate>
        <fieldset class="field" id="q-situation">
          <legend>What's happening?</legend>
          ${radioPills('situation', mapSituations(), r.situation, 'pills-grid')}
          <p class="error" id="situation-error" hidden>Choose what's happening.</p>
        </fieldset>

        <div id="report-aid">${reportAid(r)}</div>

        <fieldset class="field">
          <legend>Which animal?</legend>
          ${radioPills('animal', REPORT_ANIMALS, r.animal)}
        </fieldset>

        <div class="field field-narrow">
          <label for="rp-count">How many animals?</label>
          <input id="rp-count" name="count" type="number" inputmode="numeric" min="1" max="99" value="${r.count}">
        </div>

        <fieldset class="field">
          <legend>Can you see any of these? <span class="optional">(tick all that apply)</span></legend>
          ${checkPills('signs', SIGNS, r.signs)}
        </fieldset>

        <fieldset class="field" id="q-where">
          <legend>Where is it?</legend>
          <div class="field">
            <label for="rp-area">Area or sector</label>
            <input id="rp-area" name="area" type="text" value="${r.area}" placeholder="For example Sector 22-C, Chandigarh" autocomplete="off" maxlength="120">
          </div>
          <div class="field">
            <label for="rp-landmark">Nearest landmark <span class="optional">(optional)</span></label>
            <input id="rp-landmark" name="landmark" type="text" value="${r.landmark}" placeholder="For example opposite the gurdwara, near the bus stop" autocomplete="off" maxlength="160">
          </div>
          <div class="locate" id="report-location">${locationBlock(r)}</div>
          <p class="error" id="where-error" hidden>Add the area, or your current location, so the team can find the animal.</p>
        </fieldset>

        <div class="field-row">
          <div class="field">
            <label for="rp-seen">When did you see it?</label>
            <select id="rp-seen" name="seen">${Object.keys(SEEN).map((key) => html`<option value="${key}"${selected(key === r.seen)}>${SEEN[key]}</option>`)}</select>
          </div>
          <div class="field">
            <label for="rp-still">Is it still there?</label>
            <select id="rp-still" name="still">${Object.keys(STILL).map((key) => html`<option value="${key}"${selected(key === r.still)}>${STILL[key]}</option>`)}</select>
          </div>
        </div>

        <div class="field">
          <label for="rp-details">What else should the team know? <span class="optional">(optional)</span></label>
          <textarea id="rp-details" name="details" rows="3" maxlength="1500" placeholder="Colour and size, the injury, whether it lets people come close…">${r.details}</textarea>
        </div>

        <fieldset class="field">
          <legend>Your details <span class="optional">(optional, so the team can call you back)</span></legend>
          <div class="field-row">
            <div class="field">
              <label for="rp-name">Name</label>
              <input id="rp-name" name="name" type="text" value="${r.name}" autocomplete="name" maxlength="80">
            </div>
            <div class="field">
              <label for="rp-phone">Phone</label>
              <input id="rp-phone" name="phone" type="tel" value="${r.phone}" autocomplete="tel" inputmode="tel" maxlength="40">
            </div>
          </div>
          <p class="hint">Saved on this device for your next report.</p>
        </fieldset>
      </form>

      <section class="section" aria-labelledby="message-title">
        <h2 id="message-title">Your message</h2>
        <pre class="report-preview" id="report-preview">${buildReport(r)}</pre>
        <div class="btn-row">
          <a class="btn btn-accent" id="send-whatsapp" href="${whatsappLink(r)}" target="_blank" rel="noopener" data-action="send-report">${icon('chat')} ${CONFIG.whatsappNumber ? 'Send on WhatsApp' : 'Share on WhatsApp'}</a>
          <button class="btn btn-outline" type="button" data-action="copy-report">${icon('copy')} Copy message</button>
          ${CONFIG.email ? html`<a class="btn btn-outline" id="send-email" href="${mailLink(r)}" data-action="send-report">${icon('mail')} Email</a>` : ''}
        </div>
        <p class="hint">${icon('camera')} After sending, add photos or a short video in the same chat. They help the team judge what to bring.</p>
        <div><button class="btn btn-quiet btn-sm" type="button" data-action="reset-report">Start a new report</button></div>
      </section>
    </div>`;
  }

  function mapSituations() {
    const out = {};
    for (const s of SITUATIONS) out[s.id] = s.label;
    return out;
  }

  function locationBlock(r) {
    if (r.coords) {
      return html`<p class="loc-ok">${icon('pin')} Location added
        <span class="muted">(accurate to about ${fmtNum(Math.max(1, Math.round(r.coords.acc)))} m)</span>
        <button class="btn-link" type="button" data-action="clear-location">Remove</button></p>`;
    }
    return html`<button class="btn btn-outline" type="button" data-action="locate">${icon('locate')} Add my current location</button>
      <p class="hint" id="locate-status" role="status"></p>`;
  }

  function aidContent(aid) {
    return html`${aid.intro ? html`<p>${aid.intro}</p>` : ''}
      <div><p class="list-label">Do</p><ul class="dos">${aid.dos.map((line) => html`<li>${icon('check')}<span>${line}</span></li>`)}</ul></div>
      <div><p class="list-label">Don't</p><ul class="donts">${aid.donts.map((line) => html`<li>${icon('x')}<span>${line}</span></li>`)}</ul></div>
      ${aid.note ? html`<p class="aid-note">${aid.note}</p>` : ''}`;
  }

  function reportAid(r) {
    const situation = SITUATIONS.find((s) => s.id === r.situation);
    const aid = situation && situation.aid ? FIRST_AID[situation.aid] : null;
    const body = aid ? aidContent(aid) : html`<ol class="steps">${STEPS.map(([title, text]) => html`<li><h3>${title}</h3><p>${text}</p></li>`)}</ol>`;
    return html`<details class="aid aid-report"${aid ? raw(' open') : ''}>
      <summary>${icon('aid')} ${aid ? `What to do now: ${aid.title.toLowerCase()}` : 'What to do while you wait'} ${icon('chevron-down', 'chev')}</summary>
      <div class="aid-body">${body}</div>
    </details>`;
  }

  function onReportInput(el) {
    if (!report) return;
    switch (el.name) {
      case 'situation':
        report.situation = el.value;
        setReportError('situation', false);
        document.getElementById('report-aid').innerHTML = reportAid(report).s;
        break;
      case 'animal':
        report.animal = el.value;
        break;
      case 'signs':
        report.signs = Array.from(el.form.querySelectorAll('input[name="signs"]:checked'), (input) => input.value);
        break;
      case 'count':
        report.count = clampInt(el.value, 1, 99, 1);
        break;
      case 'area':
      case 'landmark':
        report[el.name] = el.value;
        if (report.area.trim()) setReportError('where', false);
        break;
      case 'seen':
      case 'still':
      case 'details':
      case 'name':
      case 'phone':
        report[el.name] = el.value;
        break;
      default:
        return;
    }
    refreshReportMessage();
  }

  function refreshReportMessage() {
    const preview = document.getElementById('report-preview');
    if (!preview) return;
    preview.textContent = buildReport(report);
    document.getElementById('send-whatsapp').href = whatsappLink(report);
    const email = document.getElementById('send-email');
    if (email) email.href = mailLink(report);
  }

  function setReportError(name, on) {
    const el = document.getElementById(`${name}-error`);
    if (el) el.hidden = !on;
  }

  function validateReport() {
    const noSituation = !report.situation;
    const noPlace = !report.area.trim() && !report.coords;
    setReportError('situation', noSituation);
    setReportError('where', noPlace);
    if (!noSituation && !noPlace) return true;
    const box = document.getElementById(noSituation ? 'q-situation' : 'q-where');
    box.scrollIntoView({ block: 'center' });
    const input = box.querySelector('input');
    if (input) input.focus({ preventScroll: true });
    toast(noSituation ? "Choose what's happening first" : 'Add where the animal is');
    return false;
  }

  function rememberReporter() {
    state.settings.name = report.name.trim();
    state.settings.phone = report.phone.trim();
    save();
  }

  function locate(button) {
    const status = document.getElementById('locate-status');
    const fail = (message) => {
      button.disabled = false;
      if (status) status.textContent = message;
    };
    if (!('geolocation' in navigator)) {
      fail("This browser can't share your location. Type the area instead.");
      return;
    }
    button.disabled = true;
    if (status) status.textContent = 'Finding your location…';
    try {
      navigator.geolocation.getCurrentPosition((position) => {
        report.coords = { lat: position.coords.latitude, lng: position.coords.longitude, acc: position.coords.accuracy };
        setReportError('where', false);
        const box = document.getElementById('report-location');
        if (box) box.innerHTML = locationBlock(report).s;
        refreshReportMessage();
      }, (err) => {
        fail(err && err.code === 1
          ? 'Location is blocked for this page. Allow it in your browser settings, or type the area instead.'
          : "Couldn't find your location. Type the area instead.");
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    } catch (err) {
      fail("Couldn't find your location. Type the area instead.");
    }
  }

  /* Guide ---------------------------------------------------------------- */

  const GUIDE_SECTIONS = { steps: 'Animal in need', aid: 'First aid', law: 'Know the law', care: 'Looking after animals', about: 'About us' };

  function viewGuide() {
    return html`<div class="view">
      <header class="view-head">
        <div>
          <h1 tabindex="-1">Guide</h1>
          <p class="lead">What to do for an animal in need, the law that protects them, and how to look after the animals on your street.</p>
        </div>
      </header>

      <nav class="jump" aria-label="On this page">${Object.keys(GUIDE_SECTIONS).map((key) => html`<button class="filter" type="button" data-action="jump" data-target="guide-${key}">${GUIDE_SECTIONS[key]}</button>`)}</nav>

      <section class="section" id="guide-steps" aria-labelledby="steps-title">
        <h2 id="steps-title">Found an injured or sick animal?</h2>
        <p class="muted">A few calm minutes can save a life. Follow these steps, then get in touch so our team can help.</p>
        <ol class="steps">${STEPS.map(([title, text]) => html`<li><h3>${title}</h3><p>${text}</p></li>`)}</ol>
        <div class="btn-row"><a class="btn btn-accent" href="#report">${icon('aid')} Report an animal</a></div>
      </section>

      <section class="section" id="guide-aid" aria-labelledby="aid-title">
        <h2 id="aid-title">First aid while help is on the way</h2>
        <p class="muted">General guidance for people without veterinary training. It doesn't replace a vet.</p>
        <div class="aid-list">${Object.keys(FIRST_AID).map((key) => html`<details class="aid">
          <summary>${icon('aid')} ${FIRST_AID[key].title} ${icon('chevron-down', 'chev')}</summary>
          <div class="aid-body">${aidContent(FIRST_AID[key])}</div>
        </details>`)}</div>
      </section>

      <section class="section" id="guide-law" aria-labelledby="law-title">
        <h2 id="law-title">Know the law</h2>
        <p class="muted">Indian law protects animals. Knowing it is the first step to standing up for them.</p>
        <div class="law-grid">${LAWS.map((law) => html`<article class="law-card">
          <p class="law-ref">${law.ref}</p>
          <h3>${law.title}</h3>
          <p>${law.text}</p>
        </article>`)}</div>
        <p class="small muted">This is general information, not legal advice. Laws, rules and court orders change and can apply differently from place to place. If you're facing a specific situation, contact us and our Legal Aid Project can guide you.</p>
      </section>

      <section class="section" id="guide-care" aria-labelledby="care-title">
        <h2 id="care-title">Looking after community animals</h2>
        <ul class="care-list">${CARE.map((item) => html`<li>
          <span class="tip-icon">${icon(item.icon)}</span>
          <div class="tip-body"><h3>${item.title}</h3><p>${item.text}</p></div>
        </li>`)}</ul>
      </section>

      <section class="section card" id="guide-about" aria-labelledby="about-org-title">
        <h2 id="about-org-title">About ${CONFIG.orgName}</h2>
        <p>We are a Chandigarh-based non-profit protecting stray and neglected animals across the Tricity through daily feeding, emergency veterinary aid, legal aid and community education.</p>
        <div class="btn-row">
          <a class="btn btn-accent" href="${CONFIG.donateUrl}" target="_blank" rel="noopener">${icon('heart')} Donate via Give.do</a>
          <a class="btn btn-outline" href="${CONFIG.websiteUrl}">Visit our website</a>
        </div>
      </section>
    </div>`;
  }

  /* More: details, backups and settings ---------------------------------- */

  let installPrompt = null;

  function viewMore() {
    const animals = state.animals.length;
    const records = state.records.length;
    const feedings = state.feedings.length;
    const photos = state.animals.filter((a) => a.photo).length;
    const last = state.settings.lastBackup;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

    return html`<div class="view">
      <header class="view-head">
        <div>
          <h1 tabindex="-1">More</h1>
          <p class="lead">Your details, backups and settings.</p>
        </div>
      </header>

      <section class="section card" aria-labelledby="details-title">
        <h2 id="details-title">Your details</h2>
        <p class="muted small">Added to your reports so the rescue team can call you back, and used as the caretaker for new animals. Kept on this device only.</p>
        <div class="field-row">
          <div class="field">
            <label for="m-name">Name</label>
            <input id="m-name" type="text" value="${state.settings.name}" data-setting="name" autocomplete="name" maxlength="80">
          </div>
          <div class="field">
            <label for="m-phone">Phone</label>
            <input id="m-phone" type="tel" value="${state.settings.phone}" data-setting="phone" autocomplete="tel" inputmode="tel" maxlength="40">
          </div>
        </div>
      </section>

      ${PREVIEW ? '' : html`<section class="section card" aria-labelledby="theme-title">
        <h2 id="theme-title">Appearance</h2>
        <fieldset class="field">
          <legend class="visually-hidden">Theme</legend>
          ${radioPills('theme', { system: 'Match my phone', light: 'Light', dark: 'Dark' }, state.settings.theme)}
        </fieldset>
      </section>`}

      ${PREVIEW || standalone ? '' : html`<section class="section card" aria-labelledby="install-title">
        <h2 id="install-title">Add to your home screen</h2>
        <p class="muted">Install the app to open it like any other app. It keeps working with a weak signal.</p>
        ${installPrompt
          ? html`<div class="btn-row"><button class="btn btn-primary" type="button" data-action="install">${icon('install')} Install MegaFauna Care</button></div>`
          : html`<ul class="howto">
            <li><strong>Android, in Chrome:</strong> open the ⋮ menu, then tap <em>Add to Home screen</em> or <em>Install app</em>.</li>
            <li><strong>iPhone, in Safari:</strong> tap the Share button, then <em>Add to Home Screen</em>.</li>
          </ul>`}
      </section>`}

      <section class="section card" aria-labelledby="backup-title">
        <h2 id="backup-title">Your records</h2>
        <p>${plural(animals, 'animal')}${photos ? ` (${plural(photos, 'photo')})` : ''}, ${plural(records, 'health record')} and ${plural(feedings, 'feeding round')} are saved on this device. Nothing is uploaded anywhere.</p>
        <p class="muted small">${last ? `Last backup: ${fmtDate(last)}.` : "You haven't made a backup yet."} If you clear your browser's data or lose this phone, a backup file is the only way to get your records back. You can also use one to move your records to a new phone.</p>
        <div class="btn-row">
          ${PREVIEW ? '' : html`<button class="btn btn-primary" type="button" data-action="download-backup">${icon('download')} Download a backup</button>`}
          <label class="btn btn-outline file-btn">${icon('upload')} Restore a backup
            <input class="visually-hidden" type="file" accept="application/json,.json" data-input="restore">
          </label>
        </div>
      </section>

      <section class="section card" aria-labelledby="examples-title">
        <h2 id="examples-title">Example records</h2>
        ${hasExamples()
          ? html`<p class="muted">Example animals and feeding rounds are showing. Removing them leaves your own records alone.</p>
            <div class="btn-row"><button class="btn btn-outline" type="button" data-action="remove-examples">Remove examples</button></div>`
          : html`<p class="muted">Add a few example animals and feeding rounds to see how the app works. You can remove them again in one go.</p>
            <div class="btn-row"><button class="btn btn-outline" type="button" data-action="load-examples">Show examples</button></div>`}
      </section>

      <section class="section card" aria-labelledby="erase-title">
        <h2 id="erase-title">Erase everything</h2>
        <p class="muted">Deletes all animals, photos, health records and feeding rounds from this device.</p>
        <div class="btn-row"><button class="btn btn-danger" type="button" data-action="erase-all">${icon('trash')} Erase all records</button></div>
      </section>

      <p class="about-app">MegaFauna Care is a free app from ${CONFIG.orgName}, a non-profit for the street animals of Chandigarh, Mohali and Panchkula. <a href="${CONFIG.websiteUrl}">Visit our website</a> or <a href="${CONFIG.donateUrl}" target="_blank" rel="noopener">donate via Give.do</a>.</p>
    </div>`;
  }

  const saveSettingsSoon = debounce(save, 400);

  function onSettingInput(input) {
    const key = input.dataset.setting;
    if (key !== 'name' && key !== 'phone') return;
    state.settings[key] = input.value.slice(0, key === 'name' ? 80 : 40);
    if (report) report[key] = state.settings[key];
    saveSettingsSoon();
  }

  function applyTheme() {
    if (PREVIEW) return;
    const theme = state.settings.theme;
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    const bars = { light: '#FBF7F0', dark: '#0E1612' };
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      const own = (meta.getAttribute('media') || '').includes('dark') ? bars.dark : bars.light;
      meta.setAttribute('content', theme === 'system' ? own : bars[theme]);
    });
  }

  async function downloadBackup() {
    const photos = {};
    for (const a of state.animals) {
      if (!a.photo) continue;
      const blob = await photoDB.get(a.id);
      if (blob) photos[a.id] = await blobToDataURL(blob);
    }
    const data = {
      app: BACKUP_APP,
      version: VERSION,
      exported: new Date().toISOString(),
      animals: state.animals,
      records: state.records,
      feedings: state.feedings,
      settings: { name: state.settings.name, phone: state.settings.phone },
      photos,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `megafauna-care-backup-${today()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    state.settings.lastBackup = today();
    save();
    render();
    toast('Backup downloaded. Keep the file somewhere safe, like Google Drive or your email.');
  }

  async function restoreBackup(input) {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    let data = null;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      data = null;
    }
    if (!data || data.app !== BACKUP_APP || !Array.isArray(data.animals)) {
      toast("That file isn't a MegaFauna Care backup. Choose the .json file the app downloaded.");
      return;
    }
    const next = cleanState(Object.assign({}, data, {
      settings: Object.assign({}, state.settings, {
        name: data.settings && typeof data.settings.name === 'string' ? data.settings.name : state.settings.name,
        phone: data.settings && typeof data.settings.phone === 'string' ? data.settings.phone : state.settings.phone,
      }),
      started: true,
    }));
    const when = typeof data.exported === 'string' && isDate(data.exported.slice(0, 10)) ? ` from ${fmtDate(data.exported.slice(0, 10))}` : '';
    const ok = await confirmAction({
      title: 'Replace your records with this backup?',
      text: `The backup${when} has ${plural(next.animals.length, 'animal')}, ${plural(next.records.length, 'health record')} and ${plural(next.feedings.length, 'feeding round')}. Everything on this device now will be replaced.`,
      confirmLabel: 'Replace my records',
    });
    if (!ok) return;

    await photoDB.clear();
    for (const id of Array.from(photoURLs.keys())) forgetPhoto(id);
    const photos = data.photos && typeof data.photos === 'object' ? data.photos : {};
    for (const a of next.animals) {
      a.photo = false;
      const blob = typeof photos[a.id] === 'string' ? dataURLToBlob(photos[a.id]) : null;
      if (!blob) continue;
      try {
        await photoDB.put(a.id, blob);
        a.photo = true;
      } catch (err) {
        // Keep the record even if its photo can't be stored.
      }
    }
    next.settings.lastBackup = state.settings.lastBackup;
    state = next;
    resetAnimalFilter();
    save();
    render();
    toast(`Backup restored: ${plural(state.animals.length, 'animal')}`);
  }

  async function eraseAll() {
    const ok = await confirmAction({
      title: 'Erase all records?',
      text: "This deletes every animal, photo, health record and feeding round on this device. It can't be undone. Download a backup first if you might need them.",
      confirmLabel: 'Erase everything',
    });
    if (!ok) return;
    const settings = state.settings;
    state = emptyState();
    state.settings = settings;
    state.started = true;
    await photoDB.clear();
    for (const id of Array.from(photoURLs.keys())) forgetPhoto(id);
    report = null;
    resetAnimalFilter();
    save();
    navigate('#today', true);
    toast('All records erased');
  }

  /* Example records ------------------------------------------------------ */
  // Realistic records from two feeding spots, dated relative to today so
  // that there is always something due.

  function buildExamples() {
    const created = new Date().toISOString();
    const ago = (n) => addDays(today(), -n);
    const animal = (fields) => Object.assign({
      id: uid(), name: '', species: 'dog', sex: 'unknown', age: 'adult', area: '', spot: '', markings: '',
      sterilised: 'unknown', status: 'street', caretaker: '', notes: '', photo: false, example: true, created,
    }, fields);

    const bholu = animal({ name: 'Bholu', sex: 'male', area: 'Sector 22', spot: 'Shastri Market, gate 2', markings: 'Brown with a white chest. Notch in the left ear.', sterilised: 'yes', caretaker: 'Priya', notes: 'Friendly, lets people check his ears. Guards the market at night.' });
    const kalu = animal({ name: 'Kalu', sex: 'male', age: 'senior', area: 'Sector 22', spot: 'Behind the gurdwara', markings: 'All black, grey around the muzzle. Notch in the right ear.', sterilised: 'yes', caretaker: 'Priya' });
    const chutki = animal({ name: 'Chutki', sex: 'female', age: 'young', area: 'Sector 22', spot: 'Shastri Market, by the tea stall', markings: 'Small and fawn, with white paws. Very shy.', sterilised: 'no', caretaker: 'Priya', notes: 'Hard to catch. Comes out for food around 8 pm, so that is the best time to bring the ABC van.' });
    const billo = animal({ name: 'Billo', species: 'cat', sex: 'female', area: 'Sector 22', spot: 'Dhaba near the bus stop', markings: 'Grey tabby with a kinked tail.', sterilised: 'no', caretaker: 'Priya' });
    const sheru = animal({ name: 'Sheru', sex: 'male', area: 'Sector 15', spot: 'Market parking', markings: 'Large and tan. Limps on the back left leg.', sterilised: 'yes', status: 'treatment', caretaker: 'Aman', notes: 'Wound on the back left leg, dressed every two days.' });
    const laali = animal({ name: 'Laali', sex: 'female', area: 'Sector 15', spot: 'Outside the school gate', markings: 'Reddish brown, orange reflective collar.', sterilised: 'yes', caretaker: 'Aman' });
    const moti = animal({ name: 'Moti', sex: 'male', age: 'young', area: 'Sector 15', spot: 'Market parking', markings: 'White with brown patches on the back.', sterilised: 'unknown', caretaker: 'Aman' });
    const gauri = animal({ name: 'Gauri', species: 'cattle', sex: 'female', age: 'senior', area: 'Sector 15', spot: 'Behind the market, by the garbage point', markings: 'White cow, one horn broken.', caretaker: 'Aman', notes: 'Eats plastic from the garbage point. Reported to the municipal corporation.' });

    const record = (a, type, daysAgo, notes) => {
      const date = ago(daysAgo);
      const months = RECORD_TYPES[type].months;
      return { id: uid(), animalId: a.id, type, date, due: months ? addMonths(date, months) : '', notes: notes || '', example: true, created };
    };

    const records = [
      record(bholu, 'sterilised', 420, 'ABC drive. Left ear notched.'),
      record(bholu, 'rabies', 350, 'Free vaccination drive, Sector 22 market.'),
      record(bholu, 'deworm', 80),
      record(bholu, 'collar', 120, 'Orange reflective collar.'),
      record(kalu, 'sterilised', 700),
      record(kalu, 'rabies', 200, 'Vaccination drive.'),
      record(kalu, 'deworm', 100),
      record(chutki, 'deworm', 30),
      record(billo, 'rabies', 100),
      record(sheru, 'sterilised', 500),
      record(sheru, 'rabies', 380),
      record(sheru, 'injury', 6, 'Deep cut on the back left leg, probably from a fence.'),
      record(sheru, 'treatment', 5, 'Wound cleaned and dressed at the clinic. Antibiotics for 7 days.'),
      record(laali, 'sterilised', 300),
      record(laali, 'rabies', 90),
      record(laali, 'collar', 60, 'Orange reflective collar.'),
      record(laali, 'ticks', 25),
      record(moti, 'rabies', 150),
      record(moti, 'deworm', 40),
      record(gauri, 'deworm', 60),
      record(gauri, 'note', 10, 'Reported plastic eating at the garbage point to the municipal corporation.'),
    ];

    const feedings = [];
    const feed = (date, time, spot, count, food, notes) => feedings.push({ id: uid(), date, time, spot, count, food, amount: '', notes: notes || '', example: true, created });
    for (let i = 13; i >= 0; i--) {
      const date = ago(i);
      if (i !== 9) feed(date, '07:30', 'Sector 15 market', 5 + ((i * 3) % 4), ['roti', 'eggs', 'water'], i === 3 ? 'Moti limping a little on the front right leg. Keep an eye on it.' : '');
      if (i !== 0 && i !== 4 && i !== 9) feed(date, '20:15', 'Sector 22, Shastri Market', 8 + (i % 4), ['rice', 'chicken'], i === 6 ? 'New brown pup by the tea stall.' : '');
    }

    return { animals: [bholu, kalu, chutki, billo, sheru, laali, moti, gauri], records, feedings };
  }

  function loadExamples() {
    const examples = buildExamples();
    state.animals.push(...examples.animals);
    state.records.push(...examples.records);
    state.feedings.push(...examples.feedings);
    resetAnimalFilter();
    save();
  }

  async function removeExamples() {
    const ok = await confirmAction({
      title: 'Remove the example records?',
      text: 'The example animals, their health records and the example feeding rounds will be deleted. Your own records stay.',
      confirmLabel: 'Remove examples',
      danger: false,
    });
    if (!ok) return;
    const ids = new Set(state.animals.filter((a) => a.example).map((a) => a.id));
    state.animals = state.animals.filter((a) => !a.example);
    state.records = state.records.filter((r) => !r.example && !ids.has(r.animalId));
    state.feedings = state.feedings.filter((f) => !f.example);
    resetAnimalFilter();
    save();
    if (current && (current.name === 'animal' || current.name === 'edit') && !findAnimal(parseRoute(routeHash).id)) navigate('#animals', true);
    else render();
    toast('Examples removed');
  }

  /* Buttons -------------------------------------------------------------- */

  const ACTIONS = {
    skip() {
      main.focus();
    },
    'close-sheet'() {
      closeSheet();
    },
    'sheet-delete'() {
      if (sheetOptions && sheetOptions.onDelete) sheetOptions.onDelete();
    },
    'remove-examples'() {
      removeExamples();
    },
    'load-examples'() {
      loadExamples();
      render();
      toast('Example records added');
    },
    'add-record'(el) {
      openRecordSheet({ animalId: el.dataset.animal, type: el.dataset.type });
    },
    'edit-record'(el) {
      const record = state.records.find((r) => r.id === el.dataset.id);
      if (record) openRecordSheet({ record });
    },
    'share-animal'(el) {
      shareAnimal(el.dataset.id);
    },
    'delete-animal'(el) {
      deleteAnimal(el.dataset.id);
    },
    'remove-photo'() {
      removePhoto();
    },
    filter(el) {
      const { kind, value } = el.dataset;
      if (kind === 'species') animalFilter.species = value;
      else animalFilter.flag = animalFilter.flag === value ? '' : value;
      refreshAnimalList(kind, value);
    },
    'clear-filters'() {
      resetAnimalFilter();
      const search = document.getElementById('animal-search');
      if (search) search.value = '';
      refreshAnimalList();
    },
    'filter-link'(el) {
      resetAnimalFilter();
      animalFilter.flag = el.dataset.flag || '';
      return true;
    },
    'log-feeding'() {
      openFeedingSheet(null);
    },
    'edit-feeding'(el) {
      const entry = state.feedings.find((f) => f.id === el.dataset.id);
      if (entry) openFeedingSheet(entry);
    },
    'show-all-feedings'() {
      showAllFeedings = true;
      render();
    },
    step(el) {
      const input = el.closest('.stepper').querySelector('input');
      input.value = Math.min(10000, Math.max(0, clampInt(input.value, 0, 10000, 0) + Number(el.dataset.step)));
    },
    locate(el) {
      locate(el);
    },
    'clear-location'() {
      report.coords = null;
      document.getElementById('report-location').innerHTML = locationBlock(report).s;
      refreshReportMessage();
    },
    'send-report'(el) {
      if (!validateReport()) return false;
      rememberReporter();
      el.href = el.id === 'send-email' ? mailLink(report) : whatsappLink(report);
      return true;
    },
    'copy-report'() {
      if (!validateReport()) return;
      rememberReporter();
      copyText(buildReport(report), 'Message copied. Paste it into WhatsApp or a text message.');
    },
    async 'reset-report'() {
      const ok = await confirmAction({ title: 'Start a new report?', text: 'This clears the form. Your name and phone number stay.', confirmLabel: 'Start again', danger: false });
      if (!ok) return;
      report = newReport();
      render();
      window.scrollTo(0, 0);
    },
    jump(el) {
      const target = document.getElementById(el.dataset.target);
      if (!target) return;
      target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      const heading = target.querySelector('h2');
      if (heading) {
        heading.setAttribute('tabindex', '-1');
        heading.focus({ preventScroll: true });
      }
    },
    'download-backup'() {
      downloadBackup();
    },
    'erase-all'() {
      eraseAll();
    },
    async install() {
      if (!installPrompt) return;
      installPrompt.prompt();
      try { await installPrompt.userChoice; } catch (err) { /* The person closed the prompt. */ }
      installPrompt = null;
      render();
    },
  };

  const FORMS = {
    animal: submitAnimal,
    report() {
      // Enter in a report field shouldn't do anything surprising.
    },
    sheet(form) {
      if (!sheetOptions || !sheetOptions.onSubmit) return;
      sheetError('');
      if (sheetOptions.onSubmit(form) === false) return;
      closeSheet();
      render();
    },
  };

  /* Screens and navigation ----------------------------------------------- */

  const VIEWS = {
    today: { tab: 'today', title: 'Today', render: viewToday },
    animals: { tab: 'animals', title: 'Animals', render: viewAnimals },
    animal: { tab: 'animals', title: (route) => (findAnimal(route.id) ? displayName(findAnimal(route.id)) : 'Animal'), render: viewAnimal },
    'add-animal': { tab: 'animals', title: 'Add an animal', render: viewAnimalForm, enter: resetPendingPhoto },
    edit: { tab: 'animals', title: 'Edit animal', render: viewAnimalForm, enter: resetPendingPhoto },
    feeding: { tab: 'feeding', title: 'Feeding', render: viewFeeding, mount: drawFeedingChart },
    report: { tab: 'report', title: 'Report an animal in need', render: viewReport },
    guide: { tab: 'guide', title: 'Guide', render: viewGuide, mount: jumpToSection },
    more: { tab: 'more', title: 'More', render: viewMore },
  };

  function resetPendingPhoto() {
    pendingPhoto = { blob: null, removed: false };
  }

  function jumpToSection(route) {
    if (!route.section) return;
    const target = document.getElementById(`guide-${route.section}`);
    if (target) target.scrollIntoView({ block: 'start' });
  }

  let routeHash = location.hash;
  let current = null;
  const scrollMemory = new Map();

  function parseRoute(hash) {
    const token = (hash || '').replace(/^#/, '');
    let match = token.match(/^animal-([A-Za-z0-9_-]+)$/);
    if (match) return { name: 'animal', id: match[1] };
    match = token.match(/^edit-([A-Za-z0-9_-]+)$/);
    if (match) return { name: 'edit', id: match[1] };
    match = token.match(/^guide-([a-z]+)$/);
    if (match) return { name: 'guide', section: match[1] };
    if (has(VIEWS, token) && token !== 'animal' && token !== 'edit') return { name: token };
    return { name: 'today' };
  }

  function navigate(hash, replace) {
    routeHash = hash;
    try {
      if (replace) history.replaceState(null, '', hash);
      else if (location.hash !== hash) history.pushState(null, '', hash);
    } catch (err) {
      // Some embedded views block history changes. The app still works.
    }
    render({ focus: true, fresh: true });
  }

  function onHistoryChange() {
    if (location.hash === routeHash) return;
    routeHash = location.hash;
    // The back button closes any open sheet or question along with the screen.
    closeSheet();
    if (confirmDialog.open) confirmDialog.close();
    render({ focus: true, restoreScroll: true });
  }

  window.addEventListener('popstate', onHistoryChange);
  window.addEventListener('hashchange', onHistoryChange);

  function render(options) {
    const opts = options || {};
    const route = parseRoute(routeHash);
    const key = routeHash || '#today';
    const changed = !current || current.key !== key || opts.fresh;
    if (current && current.key !== key) scrollMemory.set(current.key, window.scrollY);
    const view = VIEWS[route.name];
    if (changed && view.enter) view.enter(route);

    main.innerHTML = view.render(route).s;
    current = { key, name: route.name };

    const title = typeof view.title === 'function' ? view.title(route) : view.title;
    document.title = `${title} · MegaFauna Care`;
    document.querySelectorAll('[data-tab]').forEach((el) => {
      if (el.dataset.tab === view.tab) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });

    if (view.mount) view.mount(route);
    hydratePhotos(main);

    if (changed && !route.section) window.scrollTo(0, opts.restoreScroll ? scrollMemory.get(key) || 0 : 0);
    if (changed && opts.focus) {
      const heading = main.querySelector('h1');
      if (heading) heading.focus({ preventScroll: true });
    }
  }

  /* Events --------------------------------------------------------------- */

  document.addEventListener('click', (event) => {
    const actionEl = event.target.closest('[data-action]');
    if (actionEl && !actionEl.disabled) {
      const handler = ACTIONS[actionEl.dataset.action];
      if (handler && handler(actionEl, event) !== true) {
        event.preventDefault();
        return;
      }
    }
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    closeSheet();
    navigate(link.getAttribute('href'));
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    const handler = FORMS[form.dataset.form];
    if (!handler) return;
    event.preventDefault();
    handler(form);
  });

  function onFieldEvent(event) {
    const el = event.target;
    if (!(el instanceof HTMLElement)) return;
    if (el.closest('[data-form="report"]')) {
      onReportInput(el);
      return;
    }
    if (el.dataset.input === 'search') {
      if (event.type === 'input') onSearch(el);
      return;
    }
    if (event.type !== 'change' && el.dataset.setting) {
      onSettingInput(el);
      return;
    }
    if (event.type !== 'change') return;
    if (el.dataset.input === 'photo') onPhotoChosen(el);
    else if (el.dataset.input === 'restore') restoreBackup(el);
    else if (el.name === 'theme') {
      state.settings.theme = oneOf(el.value, { system: 1, light: 1, dark: 1 }, 'system');
      save();
      applyTheme();
    } else if (el.name === 'species' && el.closest('[data-form="animal"]')) onSpeciesChange(el);
    else if (el.name === 'area' && el.closest('[data-form="animal"]') && el.value.trim()) {
      el.removeAttribute('aria-invalid');
      document.getElementById('f-area-error').hidden = true;
    }
  }

  document.addEventListener('input', onFieldEvent);
  document.addEventListener('change', onFieldEvent);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    if (current && current.name === 'more') render();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    toast('MegaFauna Care is on your home screen');
  });

  /* Start ---------------------------------------------------------------- */

  function registerServiceWorker() {
    if (PREVIEW || !('serviceWorker' in navigator)) return;
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (location.protocol !== 'https:' && !local) return;
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline use is a bonus; the app works without it.
    });
  }

  if (!state.started) {
    loadExamples();
    state.started = true;
    save();
  }
  applyTheme();
  render();
  registerServiceWorker();
})();
