/* ==========================================================================
   MegaFauna Casebook: example cases
   Made-up cases that show how a case file fills up, dated relative to today
   so there's always something due. Every record is marked as an example,
   never leaves the device, and one button removes them all.
   ========================================================================== */

import { newId } from './model.js';

const EXAMPLE_NOTE = 'EXAMPLE: not a real document. Made up to show how the MegaFauna Casebook works.';

// A drawn picture standing in for a photo, clearly labelled as an example.
function drawPicture(title, palette) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, 900);
  sky.addColorStop(0, palette.sky);
  sky.addColorStop(1, palette.ground);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1200, 900);
  ctx.fillStyle = palette.shape;
  ctx.globalAlpha = 0.85;
  const toe = (x, y, rx, ry, angle) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2);
    ctx.fill();
  };
  toe(470, 330, 48, 62, -0.4);
  toe(560, 255, 48, 64, -0.1);
  toe(660, 255, 48, 64, 0.1);
  toe(750, 330, 48, 62, 0.4);
  ctx.beginPath();
  ctx.ellipse(610, 470, 135, 110, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 640, 1200, 260);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '600 64px "DM Sans", system-ui, sans-serif';
  ctx.fillText('EXAMPLE PHOTO', 60, 730);
  ctx.font = '400 38px "DM Sans", system-ui, sans-serif';
  ctx.fillText(title, 60, 795);
  ctx.fillText('Not real evidence', 60, 850);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the example picture.'))), 'image/png'));
}

function textFile(name, lines, when) {
  const text = [EXAMPLE_NOTE, '', ...lines, '', EXAMPLE_NOTE, ''].join('\n');
  return new File([text], name, { type: 'text/plain', lastModified: when });
}

// today: 'YYYY-MM-DD'; addDays(iso, n); name: who is using the Casebook.
export function buildExamples({ today, addDays, name }) {
  const lead = name || 'Example investigator';
  const day = (n) => addDays(today, n);
  const at = (n, time) => new Date(`${day(n)}T${time || '10:00'}:00`).toISOString();
  const records = [];
  const files = [];

  function add(kind, fields, created) {
    const r = Object.assign({ id: newId(), kind, example: true, created, updated: created, createdBy: lead, updatedBy: lead, rev: 1 }, fields);
    records.push(r);
    return r;
  }

  function addCase(fields, createdDay, updatedDay) {
    const c = add('case', Object.assign({ checklist: {}, legal: {}, tags: [], lead }, fields), at(createdDay, '11:00'));
    c.updated = at(updatedDay, '18:30');
    const child = (kind, more, n = createdDay) => add(kind, Object.assign({ caseId: c.id }, more), at(n, '12:00'));
    return { c, child };
  }

  /* A poisoning that reached court --------------------------------------- */
  {
    const { child } = addCase({
      ref: 'MWF-EXAMPLE-1',
      title: 'Two community dogs poisoned near a market',
      type: 'poisoning',
      stage: 'court',
      priority: 'high',
      incidentDate: day(-58),
      incidentTime: '22:30',
      reportedDate: day(-57),
      city: 'chandigarh',
      area: 'Sector 22 (example)',
      place: 'Behind the vegetable market, by the row of dhabas (example)',
      lat: 30.7333,
      lng: 76.7794,
      summary: 'A feeder found two of the dogs she feeds collapsed by their feeding spot late at night, with vomit and pieces of meat nearby. One dog died before reaching the vet; the other survived after treatment.\n\nShopkeepers say a man had complained about the dogs barking and had been seen leaving food there that evening. (Example case.)',
      tags: ['Market', 'Repeat area'],
      checklist: { scene: true, cctv: true },
      legal: {
        policeStation: 'Police Station, Sector 17 (example)',
        complaintDate: day(-56),
        firNumber: '000/2026 (example)',
        firDate: day(-55),
        sections: 'BNS s.325; PCA Act 1960 s.11',
        io: 'Investigating officer (example)',
        otherComplaints: 'Written complaint to the Municipal Corporation about the poisoned food (example)',
        court: 'Court of the Judicial Magistrate First Class, Chandigarh (example)',
        courtCase: 'Example/2026',
        nextHearing: day(12),
        lawyer: 'Legal Aid team (example)',
      },
    }, -57, -3);
    child('animal', { name: 'Kalu', species: 'dog', sex: 'male', condition: 'died', description: 'Black adult male, notched left ear (sterilised), red collar', injuries: 'Vomiting, fits, died on the way to the vet. Post-mortem found poison in the stomach.' });
    child('animal', { name: 'Bhoori', species: 'dog', sex: 'female', condition: 'recovered', description: 'Brown adult female, white chest, notched ear', injuries: 'Vomiting and weakness. Treated at the vet and recovered.' });
    child('person', { role: 'reporter', name: 'Feeder (example)', phone: '', notes: 'Feeds about fifteen dogs in the market every night.', confidential: true });
    child('person', { role: 'witness', name: 'Shopkeeper (example)', notes: 'Saw a man leave a packet of meat by the feeding spot at about 10 pm.', confidential: true });
    child('person', { role: 'accused', name: 'Man in a grey shirt (example)', notes: 'Had complained about the dogs barking. Identity known to the police.', confidential: false });
    child('person', { role: 'vet', name: 'Government Veterinary Hospital (example)', confidential: false });

    const photo = child('evidence', { type: 'photo', title: 'Meat left by the feeding spot', capturedDate: day(-58), capturedTime: '22:41', capturedBy: 'Feeder (example)', place: 'Feeding spot behind the market' }, -57);
    files.push({ evidenceId: photo.id, make: async () => new File([await drawPicture('Meat left by the feeding spot', { sky: '#3E5C4F', ground: '#C9B48A', shape: '#F3EADB' })], 'example-feeding-spot.png', { type: 'image/png', lastModified: Date.parse(at(-58, '22:41')) }) });
    const pm = child('evidence', { type: 'postmortem', title: 'Post-mortem report for Kalu', capturedDate: day(-56), capturedBy: lead }, -56);
    files.push({ evidenceId: pm.id, make: async () => textFile('example-post-mortem-kalu.txt', ['POST-MORTEM REPORT (EXAMPLE)', 'Animal: dog, male, adult, black ("Kalu")', 'Findings: signs consistent with poisoning. Stomach contents sent for testing.'], Date.parse(at(-56))) });
    const fir = child('evidence', { type: 'fir', title: 'Copy of the FIR', capturedDate: day(-55), capturedBy: lead }, -55);
    files.push({ evidenceId: fir.id, make: async () => textFile('example-fir-copy.txt', ['FIRST INFORMATION REPORT (EXAMPLE)', 'Sections: BNS s.325; PCA Act 1960 s.11'], Date.parse(at(-55))) });
    child('evidence', { type: 'item', title: 'Packet of the meat, handed to the police', notes: 'Sealed in a plastic bag and handed to the investigating officer at the scene (example).', capturedDate: day(-57), capturedBy: lead }, -57);

    child('entry', { type: 'visit', date: day(-57), time: '08:30', text: 'Visited the spot with the feeder. Photographed the area and collected the remaining meat in a sealed bag.' }, -57);
    child('entry', { type: 'vet', date: day(-57), time: '11:00', text: 'Bhoori admitted for treatment. Post-mortem asked for on Kalu.' }, -57);
    child('entry', { type: 'police', date: day(-56), time: '17:00', text: 'Gave a written complaint at the police station. Received a stamped copy.' }, -56);
    child('entry', { type: 'police', date: day(-55), time: '12:15', text: 'FIR registered. Collected a free copy.' }, -55);
    child('entry', { type: 'court', date: day(-20), time: '11:00', text: 'Police filed the chargesheet. First hearing listed.' }, -20);
    child('entry', { type: 'call', date: day(-3), time: '16:40', text: 'Investigating officer says the forensic report on the meat is still awaited.' }, -3);

    child('task', { title: 'Get the forensic report on the meat', due: day(-2) }, -20);
    child('task', { title: 'Prepare the section 63 certificate for the photos with our lawyer', due: day(7) }, -20);
    child('task', { title: 'Ask the market association for CCTV footage', due: day(-55), done: true, doneOn: day(-56) }, -57);
  }

  /* A fresh, urgent report --------------------------------------------------- */
  {
    const { child } = addCase({
      ref: 'MWF-EXAMPLE-2',
      title: 'Puppy beaten with a stick outside a dhaba',
      type: 'beating',
      stage: 'new',
      priority: 'urgent',
      incidentDate: day(-1),
      incidentTime: '20:15',
      reportedDate: day(0),
      city: 'zirakpur',
      area: 'Patiala Road (example)',
      place: 'Outside a roadside dhaba (example)',
      summary: 'A caller sent photos of a puppy limping after a man hit it with a stick to chase it away from the dhaba. (Example case.)',
    }, 0, 0);
    child('animal', { species: 'dog', sex: 'unknown', condition: 'injured', description: 'Tan puppy, about three months old', injuries: 'Limping on the right front leg; swelling.' });
    child('person', { role: 'reporter', name: 'Caller (example)', notes: 'Sent the photos on WhatsApp.', confidential: true });
    const photo = child('evidence', { type: 'photo', title: 'Puppy’s injured leg', capturedDate: day(-1), capturedTime: '20:32', capturedBy: 'Caller (example)' });
    files.push({ evidenceId: photo.id, make: async () => new File([await drawPicture('Puppy’s injured leg', { sky: '#6B4A2E', ground: '#E9A23B', shape: '#FBF7F0' })], 'example-puppy-leg.png', { type: 'image/png', lastModified: Date.parse(at(-1, '20:32')) }) });
    child('entry', { type: 'call', date: day(0), time: '09:10', text: 'Caller sent photos on WhatsApp and the location of the dhaba.' });
    child('task', { title: 'Take the puppy to a vet and get an injury report', due: day(0) });
    child('task', { title: 'Find out whether the dhaba or nearby shops have CCTV', due: day(1) });
  }

  /* Harassment of a feeder --------------------------------------------------- */
  {
    const { child } = addCase({
      ref: 'MWF-EXAMPLE-3',
      title: 'Feeder threatened for feeding dogs in a housing society',
      type: 'feeder',
      stage: 'investigating',
      priority: 'normal',
      incidentDate: day(-19),
      reportedDate: day(-19),
      city: 'mohali',
      area: 'Sector 70 (example)',
      summary: 'A resident who feeds the dogs of her society was told to stop and threatened by a committee member, who also said the dogs would be removed. (Example case.)',
      tags: ['RWA'],
    }, -19, -15);
    child('animal', { species: 'dog', count: 6, condition: 'unharmed', description: 'Six community dogs, all sterilised and vaccinated' });
    child('person', { role: 'caretaker', name: 'Resident feeder (example)', confidential: true });
    child('person', { role: 'accused', name: 'Committee member (example)', confidential: false });
    const statement = child('evidence', { type: 'statement', title: 'Statement of the feeder', capturedDate: day(-18), capturedBy: lead }, -18);
    files.push({ evidenceId: statement.id, make: async () => textFile('example-statement.txt', ['STATEMENT (EXAMPLE)', 'Describes what was said, when and in front of whom.'], Date.parse(at(-18))) });
    child('entry', { type: 'meeting', date: day(-15), time: '18:00', text: 'Met the committee with the feeder. Explained that community dogs may not be removed and that feeding is allowed at agreed spots.' }, -15);
    child('task', { title: 'Send the committee a letter on the Animal Birth Control Rules, 2023', due: day(3) }, -15);
  }

  /* Two closed cases, for the history -------------------------------------- */
  {
    const { child } = addCase({
      ref: 'MWF-EXAMPLE-4',
      title: 'Cow with an untreated wound tied up in a vacant plot',
      type: 'neglect',
      stage: 'closed',
      outcome: 'resolved',
      closedOn: day(-90),
      priority: 'normal',
      incidentDate: day(-121),
      reportedDate: day(-120),
      city: 'panchkula',
      area: 'Sector 20 (example)',
      summary: 'A cow was left tied without shade or water, with an infected wound on her leg. (Example case.)',
    }, -120, -90);
    child('animal', { species: 'cattle', sex: 'female', condition: 'recovered', description: 'White cow with a brown patch on the neck', injuries: 'Infected wound on the back left leg.' }, -120);
    child('entry', { type: 'visit', date: day(-120), text: 'Found the cow without water. Gave water and called the vet.' }, -120);
    child('entry', { type: 'note', date: day(-90), text: 'Owner agreed to proper care and treatment. Checked again two weeks later: wound healed.' }, -90);
  }
  {
    const { child } = addCase({
      ref: 'MWF-EXAMPLE-5',
      title: 'Dog hit by a car that did not stop',
      type: 'road',
      stage: 'closed',
      outcome: 'insufficient',
      closedOn: day(-200),
      priority: 'normal',
      incidentDate: day(-241),
      reportedDate: day(-240),
      city: 'chandigarh',
      area: 'Madhya Marg (example)',
      summary: 'A dog was hit at night. Nobody noted the number of the car and there was no CCTV. (Example case.)',
    }, -240, -200);
    child('animal', { species: 'dog', condition: 'recovered', description: 'Brown adult dog', injuries: 'Fractured hind leg, treated.' }, -240);
  }

  return { records, files };
}
