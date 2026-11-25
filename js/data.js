// Maple Street people (L02 section 13) for the vertical slice, applicants (L03), and Walt's tips (L01).
const CUSTOMERS = [
    { id: 'walt', house: 1, name: 'Walt', who: 'Your mentor', archetype: 'Mentor', yard: 'walt', tasks: ['mow', 'trim'],
      expect: 1, budget: 0, start: 'tutorial', blurb: "Mowed half this street for 30 years. His knees are done. Today he watches you." },
    { id: 'okafor', house: 2, name: 'Mrs. Okafor', who: 'The Nice Lady', archetype: 'Nice Lady', yard: 'okafor', tasks: ['mow'],
      expect: 2.5, budget: 45, start: 'list', day: 0, gossip: 1.5, tipChance: 0.6,
      blurb: "Lemonade on the porch. Tells the whole block everything you do, good or bad." },
    { id: 'feldman', house: 3, name: 'Gus Feldman', who: 'The Measurer', archetype: 'Measurer', yard: 'feldman', tasks: ['mow', 'trim'],
      expect: 4, budget: 50, start: 'list', day: 1,
      blurb: "Wants exactly three inches. Checks with a ruler. Notices every missed strip." },
    { id: 'henderson', house: 4, name: 'The Hendersons', who: 'The Loyalists', archetype: 'Loyalist', yard: 'henderson', tasks: ['mow', 'trim'],
      expect: 3, budget: 65, start: 'list', day: 2,
      blurb: "A young family. Slow to trust, but once they do, they tell everyone." },
    { id: 'brandt', house: 5, name: 'Kyle Brandt', who: 'The Dog Owner', archetype: 'Dog Owner', yard: 'brandt', tasks: ['mow'],
      expect: 3, budget: 55, start: 'knock', dog: 'Biscuit',
      blurb: "His dog Biscuit is \"friendly.\" Biscuit loves mowers. Not in a good way." },
    { id: 'moretti', house: 10, name: 'Vince Moretti', who: 'The Haggler', archetype: 'Haggler', yard: 'moretti', tasks: ['mow', 'edge'],
      expect: 3, budget: 34, start: 'knock', haggle: true,
      blurb: "Wants a deal every time. But he pays cash, on the spot, every time." },
    { id: 'ditmore', house: 6, name: 'Pam and Ron Ditmore', who: 'The Critics', archetype: 'Critic', yard: 'ditmore', tasks: ['mow', 'trim', 'edge', 'blow'],
      expect: 4.5, budget: 85, start: 'knock', needRep: 25,
      blurb: "Always one thing wrong. Pay well if you can live with the notes." },
];

// Houses that aren't in the vertical slice yet: shown on the street, not interested for now.
const LOCKED_HOUSES = [
    { house: 7, name: 'The rental at 14', note: 'Owner lives out of state' },
    { house: 8, name: 'Mr. Delgado', note: 'Busy with his roses' },
    { house: 9, name: 'Brenda Kowalski', note: 'Never seems to be home' },
    { house: 11, name: 'Mrs. Lindqvist', note: 'Watching from the window' },
    { house: 12, name: 'Earl Tucker', note: 'Has mowed his own yard for 40 years' },
];

// One-time jobs from around the block: overgrown yards, today only, pay extra (L02 section 9).
const ODD_JOBS = [
    { name: 'The Parks on Elm St', note: "Back from vacation. The yard got away from them.", yard: 'feldman~m' },
    { name: 'A house for sale on Elm St', note: "Realtor needs it sharp for a showing.", yard: 'okafor~m', tasks: ['mow', 'trim', 'edge'] },
    { name: 'Mr. Abernathy on Oak Ct', note: "Broke his ankle. Grass is up to his knees.", yard: 'moretti~m' },
    { name: 'The Nguyens on Oak Ct', note: "Party Saturday. Want it looking good.", yard: 'henderson~m', tasks: ['mow', 'trim'] },
    { name: 'A rental on Birch Ln', note: "Tenant moved out. Landlord wants it cleaned up.", yard: 'ditmore~m' },
    { name: 'Mrs. Castillo on Birch Ln', note: "Her regular guy quit on her.", yard: 'walt~m', tasks: ['mow', 'trim'] },
    { name: 'The Bauers on Elm St', note: "New baby. No time for the yard.", yard: 'brandt~m' },
];

const APPLICANTS = [
    { name: 'Tyler', age: 17, stats: { speed: 4, precision: 2, care: 2, stamina: 5, people: 4, mechanic: 1 }, traits: ['Rookie Nerves', 'Eager'], wage: 12,
      line: "Keeps losing his phone in the grass." },
    { name: 'Jenny', age: 24, stats: { speed: 2, precision: 6, care: 5, stamina: 3, people: 2, mechanic: 2 }, traits: ['Perfectionist', 'Steady'], wage: 13,
      line: "Slow. Perfect stripes. Never late." },
    { name: 'Marcus', age: 21, stats: { speed: 6, precision: 2, care: 2, stamina: 4, people: 5, mechanic: 1 }, traits: ['Corner Cutter', 'Chatty'], wage: 13,
      line: "Fast, and the customers love him." },
    { name: 'Big Ray', age: 46, stats: { speed: 3, precision: 3, care: 4, stamina: 6, people: 1, mechanic: 7 }, traits: ['Gearhead', 'Steady'], wage: 14,
      line: "Quiet. Can fix any engine you put in front of him." },
    { name: 'Lou', age: 63, stats: { speed: 2, precision: 4, care: 6, stamina: 2, people: 5, mechanic: 3 }, traits: ['Early Bird', 'Steady'], wage: 12,
      line: "Retired mailman. Knows every dog on the block by name." },
];

// Two of each applicant's six stats and one trait are on the card; the rest shows once they work for you.
const SHOWN_STATS = { Tyler: ['speed', 'stamina'], Jenny: ['precision', 'care'], Marcus: ['speed', 'people'], 'Big Ray': ['mechanic', 'stamina'], Lou: ['care', 'people'] };

const TRAIT_TEXT = {
    'Rookie Nerves': 'More mistakes on first visits. Fades with experience.',
    'Eager': 'Learns fast.',
    'Perfectionist': 'Best stripes on the crew, 20% slower.',
    'Steady': 'Never great, never bad, never late.',
    'Corner Cutter': 'Fast, but sometimes skips trimming and edging.',
    'Chatty': 'Customers love them. Loses time talking.',
    'Gearhead': 'Fixes broken mowers on the spot.',
    'Early Bird': 'Faster in the morning, slower after 3 p.m.',
};

// Walt's tips: two lines, one per new system (L01 onboarding).
const WALT = {
    day1: "Morning. First job's my yard, so I can watch. Tap it on the street, then Go mow.",
    firstYard: "Lanes, back and forth. Then trim what the mower can't reach. Hit Finish job when you're done.",
    firstPaid: "That's how it works: good yard, they pay, the street talks. Next one's Mrs. Okafor.",
    knock: "Want more work? Knock on doors. It takes half an hour, but that's how you get new customers.",
    quote: "Price it fair. Too high, they say no. Too low, you're working for free.",
    breakdown: "That old mower coughs. Do maintenance at the end of the day, or save up for a better one at Rosa's.",
    hire: "You can't mow it all yourself. Rosa's has a job board. Post for help.",
    hired: "A worker needs their own mower. Rosa sells a good one. Then assign them jobs in the morning.",
    plan: "Mow a yard clean once and your crew follows the way you did it.",
    dog: "That's Biscuit. He won't hurt you, but he won't move for you either. Text Kyle.",
    rep25: "The street is noticing. The Ditmores might talk to you now. They're picky.",
    weekend: "Week's done. Friday's payday. Workers get paid whether you had a good week or not.",
};
