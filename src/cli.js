import { readFileSync } from 'node:fs'
import { ls, view, comment, create, edit, attach, cmd } from './commands/issues.js'
import { art } from './commands/art.js'
import { state, type, board } from './commands/pipeline.js'
import { project, org, user } from './commands/admin.js'
import { login, logout } from './commands/auth.js'
import { print } from './render.js'
import { CliError, EXIT } from './errors.js'

const HELP = `yt — a thin YouTrack CLI

  yt login [--token] [--url URL] [--status]   browser OAuth; credential to the keychain
  yt logout                                   clear the stored credential
  yt ls [query] [--fields F] [--top N] [--all]   issues with their state; 50 a page
  yt view <id> [--comments]
  yt new <project> <summary> [-d description | -f file]    -d/-f omitted: stdin
  yt edit <id> [-s summary] [-d description | -f file]
  yt cmd <id...> "<command>" [--as user] [--dry-run]    every other mutation
  yt comment <id> <text>
  yt attach <id> <file...>
  yt art ls|view|new|edit                     knowledge base, listed as a tree
    yt art ls [--project P] [--grep text]     --grep filters titles client-side
  yt board ls|new <project> <name> [--columns "A,B,C"]
    yt board add|rm <project...> <board>      edit an existing board's project list
  yt state ls <project> [--all]               State values; --all shows archived too
  yt state add <project> <name> [--resolved] [--archived] [--after "Other"]
  yt state edit <project> <name> [--rename X] [--resolved|--no-resolved] [--archived|--no-archived]
  yt state order <project> "Open,In Progress,Fixed"
  yt type ls|add|edit|order <project> ...      the same, for issue types
    Both take --field NAME for instances that call the field something else.
  yt project new <shortName> <name> [-d desc] [--leader login] [--org name]
  yt project team <shortName>                  the project team, one login per line
  yt project assign <shortName> <login...>     add users to the project team
  yt org new <name> [-d description]           an organization to hold projects
  yt user new <login> [--name "Full Name"] [--email a@b.c]
    The password is generated and printed to stderr once; it is never a flag.

  YT_URL, YT_TOKEN override the config file and the keychain.
  yt cmd --help  for the command language.

Exit codes: 0 ok, 1 auth, 2 not found, 3 command rejected.`

const commands = {
  ls,
  view,
  comment,
  new: create,
  edit,
  attach,
  cmd,
  art,
  board,
  state,
  type,
  project,
  org,
  user,
  login,
  logout,
  help: async () => print(HELP),
}

export async function run(argv) {
  const [name, ...rest] = argv
  if (!name || name === '--help' || name === '-h') {
    print(HELP)
    return EXIT.OK
  }
  if (name === '--version' || name === '-v') {
    print(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
    return EXIT.OK
  }

  const command = commands[name]
  if (!command) {
    process.stderr.write(`Unknown command: ${name}. Try \`yt help\`.\n`)
    return EXIT.USAGE
  }

  try {
    await command(rest)
    return EXIT.OK
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    return error instanceof CliError ? error.code : EXIT.USAGE
  }
}
