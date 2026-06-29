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

function fromTable(name: string): string {
  if (!name) return 'unknown'
  const first = strip(name.split(/\s+/)[0].toLowerCase())
  return NAMES[first] ?? 'unknown'
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

export function scenePairing(characters: string[]): string | null {
  const g = characters.map(guessGender)
  if (g.length !== 2) return null
  if (g.includes('unknown')) return 'has_unknown'
  if (g[0] === 'male' && g[1] === 'male') return 'MM'
  if (g[0] === 'female' && g[1] === 'female') return 'WW'
  return 'MW'
}
