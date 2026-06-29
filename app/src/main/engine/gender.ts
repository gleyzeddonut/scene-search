import table from './data/names_gender.json'

const NAMES = table as Record<string, string>

const ROLE_GENDER: Record<string, string> = {
  man: 'male', woman: 'female', boy: 'male', girl: 'female', guy: 'male', gal: 'female',
  gentleman: 'male', lady: 'female', mother: 'female', father: 'male', mom: 'female',
  mum: 'female', dad: 'male', husband: 'male', wife: 'female', son: 'male',
  daughter: 'female', brother: 'male', sister: 'female', grandmother: 'female',
  grandfather: 'male', grandma: 'female', grandpa: 'male', grandson: 'male',
  granddaughter: 'female', aunt: 'female', uncle: 'male', niece: 'female', nephew: 'male',
  king: 'male', queen: 'female', prince: 'male', princess: 'female', waiter: 'male',
  waitress: 'female', actor: 'male', actress: 'female', businessman: 'male',
  businesswoman: 'female', policeman: 'male', policewoman: 'female', widow: 'female',
  widower: 'male', bride: 'female', groom: 'male', girlfriend: 'female', boyfriend: 'male',
  stepmother: 'female', stepfather: 'male', mr: 'male', mrs: 'female', ms: 'female',
  sir: 'male', madam: 'female', maam: 'female'
}

const strip = (s: string) => s.replace(/^[.,'"]+|[.,'"]+$/g, '')

// honorifics/ranks that precede the real name ("DR. DAVID", "SGT. GRANT LEVI"). We
// skip these to find the given name. Gendered ones (MR/MRS…) are still picked up by
// roleGender if no name follows, so skipping them here only ever helps.
const TITLES = new Set([
  'dr', 'mr', 'mrs', 'ms', 'miss', 'mx', 'prof', 'professor', 'doctor',
  'sgt', 'sergeant', 'capt', 'captain', 'lt', 'lieutenant', 'col', 'colonel',
  'gen', 'general', 'maj', 'major', 'cpl', 'corporal', 'pvt', 'private',
  'det', 'detective', 'ofc', 'officer', 'agent', 'sheriff', 'deputy', 'cmdr', 'commander',
  'sir', 'madam', 'maam', 'rev', 'reverend', 'fr', 'father', 'sister', 'brother',
  'st', 'saint', 'lord', 'lady', 'master', 'mistress', 'judge', 'nurse', 'coach',
  'chief', 'mayor', 'senator', 'governor', 'president', 'king', 'queen', 'prince', 'princess',
  'aunt', 'uncle', 'grandma', 'grandpa', 'nana', 'papa', 'sis', 'bro'
])

function fromTable(name: string): string {
  for (const raw of name.split(/\s+/)) {
    const tok = strip(raw.toLowerCase())
    if (!tok || TITLES.has(tok)) continue // skip leading titles to reach the given name
    return NAMES[tok] ?? 'unknown' // first real (non-title) token = the given name
  }
  return 'unknown'
}

function roleGender(name: string): string {
  const found = new Set<string>()
  for (const tok of name.split(/\s+/)) {
    const key = strip(tok.toLowerCase())
    if (key in ROLE_GENDER) found.add(ROLE_GENDER[key])
  }
  return found.size === 1 ? [...found][0] : 'unknown'
}

export function guessGender(name: string): string {
  const g = fromTable(name)
  return g !== 'unknown' ? g : roleGender(name)
}

// pairing from already-resolved genders (so manual overrides can drive it)
export function pairingFromGenders(g: string[]): string | null {
  if (g.length !== 2) return null
  if (g.includes('unknown')) return 'has_unknown'
  if (g[0] === 'male' && g[1] === 'male') return 'MM'
  if (g[0] === 'female' && g[1] === 'female') return 'WW'
  return 'MW'
}

export function scenePairing(characters: string[]): string | null {
  return pairingFromGenders(characters.map(guessGender))
}
