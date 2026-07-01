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
  const toks = name.split(/\s+/).map((t) => strip(t.toLowerCase())).filter(Boolean)
  // prefer the first non-title token (the given name): "DR. DAVID" → DAVID
  for (const tok of toks) {
    if (TITLES.has(tok)) continue
    return NAMES[tok] ?? 'unknown'
  }
  // every token was a title (a bare "DOCTOR" / "NANA" cue) — look the title up itself
  for (const tok of toks) if (NAMES[tok]) return NAMES[tok]
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

// Pairing from already-resolved genders (so manual overrides can drive it). Unknown-
// gender characters are IGNORED, so a scene whose determinable cast is two men still
// counts as M+M even with extra unknowns (e.g. M+M+U → MM). It needs exactly two known
// genders — a 2-hander where we couldn't gender someone stays "has_unknown", and a
// mixed 3+ cast (M+M+W) has no clean two-person pairing.
export function pairingFromGenders(g: string[]): string | null {
  if (g.length < 2) return null
  const known = g.filter((x) => x !== 'unknown')
  if (known.length !== 2) return g.length === 2 ? 'has_unknown' : null
  if (known[0] === 'male' && known[1] === 'male') return 'MM'
  if (known[0] === 'female' && known[1] === 'female') return 'WW'
  return 'MW'
}

export function scenePairing(characters: string[]): string | null {
  return pairingFromGenders(characters.map(guessGender))
}
